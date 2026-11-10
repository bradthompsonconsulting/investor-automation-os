/**
 * B15-29 (INV-137) -- in-memory FAKE of the Netlify Blobs EDGE API as @netlify/blobs 11.1.0 uses it after
 * `connectLambda(event)` (Lambda-compatibility functions): ONE request per operation to
 * <edgeURL>/<siteID>/site:<store>/<key> with `authorization: Bearer <token>` (the event's `blobs` context).
 * Conditional PUTs honour If-None-Match: * and If-Match and answer 412 when the precondition fails. No socket is
 * opened: `fetch` is a plain function.
 *
 * ETag modes:
 *   'content'   (default) CONTENT-ADDRESSED: the ETag is a digest of the stored bytes, so re-writing identical bytes
 *               keeps the same ETag (the r5 liveness assumption U1).
 *   'per-write' every successful write gets a NEW ETag even for identical bytes (U1 false): proves that case fails
 *               CLOSED (the second check answers 412 -> refused), never open.
 *
 * Shows OUR code's behaviour only. It cannot prove provider guarantees (U1-U4).
 *
 * Fault rules (consumed once each, first match wins): { method?, key?, status?, throw?, hang?, ignoreAbort?,
 * stallBody?, apply?, delayMs?, lie?, noEtag? }.
 *   status    answer this status (for a PUT with apply:true the write is applied first)
 *   throw     reject (transport error); with apply:true a PUT is applied first (applied, acknowledgement lost)
 *   hang      never answer; rejects on abort unless ignoreAbort
 *   stallBody 200 headers, a body that never ends (GET)
 *   lie       a PUT answered 200 + an etag WITHOUT storing (provider false success)
 *   noEtag    a PUT applied and answered 200 WITHOUT an ETag header
 * Every request is logged: { method, key, ifMatch, ifNoneMatch, body, status, at }. `mutations` lists every applied
 * PUT that CREATED a key or CHANGED its bytes, and every DELETE (an identical-bytes re-write is not a mutation).
 */
'use strict';
const crypto = require('node:crypto');

const EDGE = 'https://blobs-edge.fake.invalid';

function createFakeBlobs({ siteID, token = 'fixture-lambda-blobs-token', clock = () => Date.now(), etagMode = 'content' } = {}) {
  const store = new Map();            // `${site}|${store}|${key}` -> { text, etag }
  const log = [];
  const mutations = [];
  let rules = [];
  let n = 0;
  let mode = etagMode;
  const k = (site, s, key) => `${site}|${s}|${key}`;
  const etagFor = (text) => (mode === 'content' ? `"c-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 24)}"` : `"w-${++n}"`);

  function abortable(signal, ignoreAbort) {
    return new Promise((_, reject) => {
      if (ignoreAbort || !signal) return;
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }
  function applyPut(id, key, body, headers, entry) {
    const cur = store.get(id);
    const inm = headers['if-none-match'];
    const im = headers['if-match'];
    if (inm === '*' && cur) return { status: 412 };
    if (im && (!cur || cur.etag !== im)) return { status: 412 };
    const etag = cur && cur.text === body && mode === 'content' ? cur.etag : etagFor(body);
    if (!cur || cur.text !== body) mutations.push({ key, created: !cur, conditional: inm ? 'if-none-match' : im ? 'if-match' : null, at: clock() });
    store.set(id, { text: body, etag });
    entry.applied = true;
    return { status: 200, etag };
  }

  async function fetchImpl(input, init = {}) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init.headers || {}).forEach((v, name) => { headers[name.toLowerCase()] = v; });
    const u = new URL(url);
    if (u.origin !== EDGE) throw new Error('fake blobs: unexpected URL ' + url);
    const [site, storeName, ...rest] = u.pathname.slice(1).split('/').map(decodeURIComponent);
    const key = rest.join('/');
    const body = typeof init.body === 'string' ? init.body : init.body == null ? '' : String(init.body);
    const entry = { method, site, storeName, key, ifMatch: headers['if-match'] || null, ifNoneMatch: headers['if-none-match'] || null, body: method === 'PUT' ? body : undefined, at: clock(), status: null };
    log.push(entry);
    const rule = rules.find((r) => (!r.method || r.method === method) && (!r.key || r.key === key));
    if (rule) rules = rules.filter((r) => r !== rule);
    const answer = (status, h = {}, b = null) => { entry.status = status; return new Response(b, { status, headers: h }); };
    if (headers.authorization !== `Bearer ${token}` || site !== siteID) return answer(401);
    const id = k(site, storeName, key);
    if (method === 'DELETE') { mutations.push({ key, deleted: true, at: clock() }); store.delete(id); return answer(204); }
    if (rule && rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
    if (method === 'GET') {
      if (rule && rule.hang) return abortable(init.signal, rule.ignoreAbort);
      if (rule && rule.throw) throw new TypeError('fetch failed (fixture)');
      if (rule && rule.status) return answer(rule.status);
      const cur = store.get(id);
      if (rule && rule.stallBody) { entry.status = 200; return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { etag: cur ? cur.etag : '"stall"' } }); }
      if (!cur) return answer(404);
      return answer(200, { etag: cur.etag }, cur.text);
    }
    if (method !== 'PUT') return answer(405);
    if (rule && rule.lie) return answer(200, { etag: '"lie"' });
    if (rule && rule.hang) { if (rule.apply) applyPut(id, key, body, headers, entry); return abortable(init.signal, rule.ignoreAbort); }
    if (rule && rule.throw) { if (rule.apply) applyPut(id, key, body, headers, entry); throw new TypeError('fetch failed (fixture)'); }
    if (rule && rule.status) { if (rule.apply) applyPut(id, key, body, headers, entry); return answer(rule.status); }
    const out = applyPut(id, key, body, headers, entry);
    if (rule && rule.noEtag && out.status === 200) return answer(200);
    return answer(out.status, out.etag ? { etag: out.etag } : {});
  }

  /** The Lambda event's `blobs` field (base64 JSON { url, token }), as Netlify supplies it to a function. */
  const lambdaBlobs = Buffer.from(JSON.stringify({ url: EDGE, token })).toString('base64');

  return {
    fetch: fetchImpl,
    handles: (url) => String(url).startsWith(EDGE + '/'),
    lambdaBlobs,
    log,
    mutations,
    store,
    setEtagMode: (m) => { mode = m; },
    rule: (...r) => { rules.push(...r); },
    clearRules: () => { rules = []; },
    reset: () => { store.clear(); log.length = 0; mutations.length = 0; rules = []; mode = etagMode; },
    /** Write a raw value at a key (test setup / operator action only, never through the module). */
    put: (storeName, key, text) => { store.set(k(siteID, 'site:' + storeName, key), { text, etag: etagFor(text) }); },
    /** Remove a value at a key (test setup only). */
    remove: (storeName, key) => { store.delete(k(siteID, 'site:' + storeName, key)); },
    keys: () => [...store.keys()],
    get: (storeName, key) => store.get(k(siteID, 'site:' + storeName, key)) || null,
  };
}

module.exports = { createFakeBlobs, EDGE };
