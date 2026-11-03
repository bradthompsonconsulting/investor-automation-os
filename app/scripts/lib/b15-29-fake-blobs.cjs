/**
 * B15-29 (INV-137) -- in-memory FAKE of the Netlify Blobs API as @netlify/blobs 11.1.0 uses it in API mode
 * (siteID + token, no edge URL): a sign request to https://api.netlify.com/api/v1/blobs/<site>/<store>/<key>
 * with `accept: application/json;type=signed-url`, answered with { url }, then ONE request to that signed URL.
 * Conditional PUTs honour If-None-Match: * and If-Match. No socket is opened: `fetch` is a plain function.
 *
 * Shows OUR code's behaviour only. It cannot prove provider guarantees (read-after-write freshness in API mode,
 * conditional-create atomicity, real status codes).
 *
 * Fault rules (consumed once each, first match wins): { stage: 'sign'|'blob', method?, status?, throw?, hang?,
 * ignoreAbort?, stallBody?, apply?, delayMs? }.
 *   status   answer this status (for a blob PUT with apply:true the write is applied first)
 *   throw    reject (transport error); with apply:true a blob PUT is applied first (applied, acknowledgement lost)
 *   hang     never answer; rejects on abort unless ignoreAbort
 *   stallBody  200 headers, a body that never ends
 *   lie      a blob PUT answered 200 + etag WITHOUT storing (provider false success)
 */
'use strict';
const crypto = require('node:crypto');

function createFakeBlobs({ siteID, token, clock = () => Date.now() } = {}) {
  const store = new Map();            // `${site}|${store}|${key}` -> { text, etag }
  const signed = new Map();           // id -> { site, storeName, key, method }
  const log = [];
  let rules = [];
  let etagN = 0;
  const violations = [];
  const k = (site, s, key) => `${site}|${s}|${key}`;

  function abortable(signal, ignoreAbort) {
    return new Promise((_, reject) => {
      if (ignoreAbort || !signal) return;
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }
  function applyPut(s, body, headers) {
    const key = k(s.site, s.storeName, s.key);
    const cur = store.get(key);
    const inm = headers['if-none-match'];
    const im = headers['if-match'];
    if (!inm && !im) violations.push('unconditional_put');
    if (inm === '*' && cur) return { status: 412 };
    if (im && (!cur || cur.etag !== im)) return { status: 412 };
    const etag = `"fake-e${++etagN}"`;
    store.set(key, { text: body, etag });
    return { status: 200, etag };
  }

  async function fetchImpl(input, init = {}) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init.headers || {}).forEach((v, name) => { headers[name.toLowerCase()] = v; });
    const u = new URL(url);
    const isSign = u.origin === 'https://api.netlify.com' && u.pathname.startsWith('/api/v1/blobs/') && headers.accept === 'application/json;type=signed-url';
    const stage = isSign ? 'sign' : 'blob';
    const rule = rules.find((r) => r.stage === stage && (!r.method || r.method === method));
    if (rule) rules = rules.filter((r) => r !== rule);
    if (isSign) {
      const [site, storeName, ...rest] = u.pathname.slice('/api/v1/blobs/'.length).split('/').map(decodeURIComponent);
      const entry = { stage, method, site, storeName, key: rest.join('/'), auth: headers.authorization === `Bearer ${token}`, at: clock() };
      log.push(entry);
      if (rule && rule.hang) return abortable(init.signal, rule.ignoreAbort);
      if (rule && rule.throw) throw new TypeError('fetch failed (fixture)');
      if (rule && rule.status) return new Response(null, { status: rule.status });
      if (!entry.auth || site !== siteID) return new Response(null, { status: 401 });
      const id = crypto.randomUUID();
      signed.set(id, { site, storeName, key: entry.key, method });
      return new Response(JSON.stringify({ url: `https://signed.blobs.invalid/s/${id}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.origin !== 'https://signed.blobs.invalid') throw new Error('fake blobs: unexpected URL ' + url);
    const s = signed.get(u.pathname.slice('/s/'.length));
    const body = typeof init.body === 'string' ? init.body : init.body == null ? '' : String(init.body);
    const entry = { stage, method, signedOk: !!s, key: s && s.key, ifNoneMatch: headers['if-none-match'] || null, ifMatch: headers['if-match'] || null, at: clock() };
    log.push(entry);
    if (!s || s.method.toUpperCase() !== method) return new Response(null, { status: 403 });
    if (method === 'DELETE') { violations.push('delete'); return new Response(null, { status: 204 }); }
    if (rule && rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
    if (method === 'GET') {
      if (rule && rule.hang) return abortable(init.signal, rule.ignoreAbort);
      if (rule && rule.throw) throw new TypeError('fetch failed (fixture)');
      if (rule && rule.status) return new Response(null, { status: rule.status });
      const cur = store.get(k(s.site, s.storeName, s.key));
      if (rule && rule.stallBody) return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { etag: cur ? cur.etag : '"stall"' } });
      if (!cur) return new Response(null, { status: 404 });
      return new Response(cur.text, { status: 200, headers: { etag: cur.etag } });
    }
    // PUT
    if (rule && rule.lie) return new Response(null, { status: 200, headers: { etag: '"lie"' } });
    if (rule && rule.hang) { if (rule.apply) applyPut(s, body, headers); return abortable(init.signal, rule.ignoreAbort); }
    if (rule && rule.throw) { if (rule.apply) applyPut(s, body, headers); throw new TypeError('fetch failed (fixture)'); }
    if (rule && rule.status) { if (rule.apply) applyPut(s, body, headers); return new Response(null, { status: rule.status }); }
    const out = applyPut(s, body, headers);
    return new Response(null, { status: out.status, headers: out.etag ? { etag: out.etag } : {} });
  }

  return {
    fetch: fetchImpl,
    log,
    violations,
    store,
    rule: (...r) => { rules.push(...r); },
    clearRules: () => { rules = []; },
    reset: () => { store.clear(); signed.clear(); log.length = 0; violations.length = 0; rules = []; },
    /** Write a raw value at a key (test setup only, never through the module). */
    put: (storeName, key, text) => { store.set(k(siteID, 'site:' + storeName, key), { text, etag: `"seed${++etagN}"` }); },
    keys: () => [...store.keys()],
    get: (storeName, key) => store.get(k(siteID, 'site:' + storeName, key)) || null,
  };
}

module.exports = { createFakeBlobs };
