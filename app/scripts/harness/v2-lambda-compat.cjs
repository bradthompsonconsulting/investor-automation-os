/**
 * Storage correction -- the compatibility layer that lets the EXISTING server
 * suites (written against an in-memory store and Lambda-style handlers) run
 * against the migrated code UNCHANGED IN INTENT:
 *
 *  - the store is the REAL verified adapter over the REAL @netlify/blobs client
 *    and the wire harness (store `iaos-ownership-v2`), so every fault is a wire
 *    fault the adapter must classify;
 *  - `receipts` is a Map-like VIEW of that store (get/set/has/delete/keys/size/
 *    clear/entries) for the suites' direct inspection and seeding;
 *  - the suites' fault arrays keep their meaning:
 *      failNext(op, key)        -> that request fails without applying (an exhausted 5xx: uncertain)
 *      applyThenThrow(op, key)  -> the write APPLIES, then the acknowledgement is lost
 *      staleNext(key)           -> no effect on ownership reads: they are strong (a cached-origin read
 *                                  would be recorded as a violation)
 *      beforeRead({pred, fn})   -> fn runs once just before that key is read
 *  - `handlerOf(mod)` turns a modern-runtime default export into the old
 *    `(event) => {statusCode, headers, body}` shape, on a published production
 *    deploy, adding the page's activation echo to authenticated requests;
 *  - `reset()` clears the wire and seeds the v2 authorization records a released
 *    deployment has (fixtures only).
 */
'use strict';
const { setupV2Env } = require('./v2-env.cjs');

function createCompat(options = {}) {
  const env = setupV2Env(options);
  const S = env.S;
  const wire = env.wire;
  const arrays = { failNext: [], applyThenThrow: [], staleNext: [], beforeRead: [] };
  const take = (list, ...args) => { const i = list.findIndex((f) => f(...args)); if (i < 0) return false; list.splice(i, 1); return true; };
  // The suites' fault arrays are consulted on every ownership request, in a small wrapper around the wire's fetch.
  const baseFetch = wire.fetch;
  const failStreak = new Map();
  wire.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin !== wire.EDGE && u.origin !== wire.UNCACHED) return baseFetch(url, init);
    const method = String(init.method || 'GET').toUpperCase();
    const parts = u.pathname.split('/').filter(Boolean);
    const store = decodeURIComponent(parts[1] || '');
    const key = parts.length > 2 ? parts.slice(2).map(decodeURIComponent).join('/') : null;
    if (store === 'site:' + S && key !== null) {
      const op = method === 'PUT' ? 'setJSON' : method === 'DELETE' ? 'delete' : 'get';
      const streakKey = op + '\u0000' + key;
      if (failStreak.get(streakKey) > 0) { failStreak.set(streakKey, failStreak.get(streakKey) - 1); return new Response(null, { status: 503 }); }
      if (op === 'get') {
        const i = arrays.beforeRead.findIndex((h) => h.pred(key));
        if (i >= 0) { const [h] = arrays.beforeRead.splice(i, 1); await h.fn(); }
        if (take(arrays.failNext, 'get', key) || take(arrays.failNext, 'getWithMetadata', key)) { failStreak.set(streakKey, 2); return new Response(null, { status: 503 }); }
        take(arrays.staleNext, key);
      } else {
        if (take(arrays.failNext, op, key)) { failStreak.set(streakKey, 2); return new Response(null, { status: 503 }); }
        if (take(arrays.applyThenThrow, op, key)) { await baseFetch(url, init); throw new TypeError('compat: write applied, acknowledgement lost'); }
      }
    }
    return baseFetch(url, init);
  };
  const vs = require('../../netlify/functions/lib/verified-store.ts');
  vs.transport.fetch = wire.fetch;
  const prevGlobal = global.fetch;
  global.fetch = (url, init) => {
    const u = new URL(String(url));
    if (u.origin === wire.EDGE || u.origin === wire.UNCACHED) return wire.fetch(url, init);
    return (env.hooks.ghlFetch || prevGlobal)(url, init);
  };

  const receipts = {
    get: (k) => wire.json(S, k),
    set: (k, v) => { wire.seed(S, k, v); return receipts; },
    has: (k) => wire.keys(S).includes(k),
    delete: (k) => { const had = receipts.has(k); wire.remove(S, k); return had; },
    keys: () => wire.keys(S).filter((k) => !k.startsWith('authz/'))[Symbol.iterator](),
    entries: () => wire.keys(S).filter((k) => !k.startsWith('authz/')).map((k) => [k, wire.json(S, k)])[Symbol.iterator](),
    get size() { return wire.keys(S).filter((k) => !k.startsWith('authz/')).length; },
    clear: () => { for (const k of wire.keys(S)) if (!k.startsWith('authz/')) wire.remove(S, k); },
    forEach: (fn) => { for (const k of wire.keys(S)) if (!k.startsWith('authz/')) fn(wire.json(S, k), k); },
    [Symbol.iterator]() { return receipts.entries(); },
  };
  /** The old (event) => result shape for a modern-runtime handler module. */
  function handlerOf(mod, fn = 'fn', ctxOver = {}) {
    return async (event) => {
      const headers = { ...(event.headers || {}) };
      const authed = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
      if (authed && !Object.keys(headers).some((h) => h.toLowerCase() === 'x-iaos-activation')) headers['x-iaos-activation'] = env.ACTIVATION_ID;
      for (const k of Object.keys(headers)) if (/^x-nf-/.test(k)) delete headers[k];
      return env.invoke(mod, { fn, httpMethod: event.httpMethod, headers, body: event.body, queryStringParameters: event.queryStringParameters, json: event.json }, env.deployContext(ctxOver));
    };
  }
  function reset() {
    arrays.failNext.length = 0; arrays.applyThenThrow.length = 0; arrays.staleNext.length = 0; arrays.beforeRead.length = 0;
    failStreak.clear();
    env.reset();
  }
  /** A verified store for direct library calls (its own invocation scope). */
  const { InvocationScope } = require('../../netlify/functions/lib/invocation-scope.ts');
  const store = () => new vs.VerifiedStore(new InvocationScope('ghl-write'), S);
  return { ...env, arrays, receipts, handlerOf, reset, store };
}
const { randomUUID } = require('node:crypto');
/** A v2-format id (the only ids v2 accepts). */
const v2Id = () => `v2-${randomUUID()}`;
module.exports = { createCompat, v2Id };
