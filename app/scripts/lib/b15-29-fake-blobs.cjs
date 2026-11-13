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
 * stallBody?, apply?, delayMs?, lie?, noEtag?, headers?, errorBody?, before? }. (G1: `headers` adds response headers to a
 * `status` answer; `errorBody` gives it a body -- see errorBodyOf; `before(entry)` runs when the rule matches, e.g. to move
 * a test clock.)
 *   status    answer this status (for a PUT with apply:true the write is applied first)
 *   throw     reject (transport error); with apply:true a PUT is applied first (applied, acknowledgement lost)
 *   hang      never answer; rejects on abort unless ignoreAbort
 *   stallBody 200 headers, a body that never ends (GET)
 *   lie       a PUT answered 200 + an etag WITHOUT storing (provider false success)
 *   noEtag    a PUT applied and answered 200 WITHOUT an ETag header
 * `bodyIncludes` (optional) restricts a rule to a PUT whose body contains that text (e.g. one racer's label).
 * B15-29 A1a confirm controls (Bones 26 item 5), all opt-in and per rule:
 *   skip         let the first `skip` matching requests pass, then match (the n-th write of the same bytes)
 *   lieEtag      with lie: 'current' answers the key's CURRENT ETag (an acknowledgement echoing the original ETag)
 *   storeAs      apply the PUT but STORE the body with its "label" replaced by this text (actual wrong stored bytes)
 *   answerEtagOf with storeAs: 'body' answers the ETag of the bytes that were SENT, not of those stored
 *   interfere    before this request is evaluated, a concurrent writer stores the body with its "label" replaced by
 *                this text (a racing mutation before a confirmation); recorded in `mutations` as conditional 'interfere'
 * `force` (with status + apply) applies THAT one PUT despite its precondition, then answers the rule's status: a
 * provider that wrongly applied a write it reported as refused. Every other request keeps its preconditions.
 *
 * Read modes (B15-29 A1a, 2026-11-12): 'strong' (default) answers every GET from the store. 'eventual' models the
 * Netlify edge cache that @netlify/blobs uses after connectLambda (no uncachedEdgeURL): the FIRST GET of a key is
 * answered from the store and remembered, and every later GET of that key gets the remembered answer even after the
 * key changes (updates may be stale up to 60 s on the real edge). Writes are always evaluated against the store.
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
  /* B15-29 P-1 tests (Jeff work order T3): a provider that IGNORES a precondition, so the probe can be shown to FAIL.
     Default off; reset() turns it off again. */
  let ignore = { ifMatch: false, ifNoneMatch: false };
  let readMode = 'strong';
  const readCache = new Map();        // eventual mode: id -> { status, etag, text } of the first GET
  const k = (site, s, key) => `${site}|${s}|${key}`;
  const etagFor = (text) => (mode === 'content' ? `"c-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 24)}"` : `"w-${++n}"`);

  /* G1 error bodies for a `status` rule (PV15-PV17): `errorBody` is a string, or
     { bytes: n, chunks?: [sizes] }  n deterministic bytes (byte i = 97 + i % 26), as one chunk unless `chunks` given;
     { stall: 'cancel' }             never enqueues; honours cancel (counted);
     { stall: 'ignore' }             never enqueues; ignores abort; cancel() is counted and NEVER settles;
     { stall: 'oneByte' }            enqueues one byte, then stalls (honours cancel).
     { bytes: n, chunks: [sizes], pull: true }  the same bytes, one chunk per pull (pulls counted in `bodyPulls`);
     `bodyCancels` counts cancel() calls on these bodies. */
  let bodyCancels = 0;
  let bodyPulls = 0;
  const patternBytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = 97 + (i % 26); return b; };
  function errorBodyOf(rule) {
    const eb = rule.errorBody;
    if (eb == null) return null;
    if (typeof eb === 'string') return eb;
    if (typeof eb.bytes === 'number') {
      const all = patternBytes(eb.bytes); const sizes = eb.chunks || [eb.bytes];
      if (eb.pull) {
        let i = 0; let at = 0;
        return new ReadableStream({ pull(c) { bodyPulls += 1; if (i >= sizes.length) { c.close(); return; } c.enqueue(all.subarray(at, at + sizes[i])); at += sizes[i]; i += 1; }, cancel() { bodyCancels += 1; } }, { highWaterMark: 0 });
      }
      return new ReadableStream({ start(c) { let at = 0; for (const s of sizes) { c.enqueue(all.subarray(at, at + s)); at += s; } c.close(); } });
    }
    if (eb.stall === 'cancel') return new ReadableStream({ start() {}, cancel() { bodyCancels += 1; } });
    if (eb.stall === 'ignore') return new ReadableStream({ start() {}, pull() { return new Promise(() => {}); }, cancel() { bodyCancels += 1; return new Promise(() => {}); } });
    if (eb.stall === 'oneByte') return new ReadableStream({ start(c) { c.enqueue(patternBytes(1)); }, cancel() { bodyCancels += 1; } });
    throw new Error('fake blobs: unknown errorBody');
  }
  function abortable(signal, ignoreAbort) {
    return new Promise((_, reject) => {
      if (ignoreAbort || !signal) return;
      if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }
  function applyPut(id, key, body, headers, entry, force = false, answered = null) {
    const cur = store.get(id);
    const inm = headers['if-none-match'];
    const im = headers['if-match'];
    if (inm === '*' && cur && !ignore.ifNoneMatch && !force) return { status: 412 };
    if (im && (!cur || cur.etag !== im) && !ignore.ifMatch && !force) return { status: 412 };
    const etag = cur && mode === 'sticky' ? cur.etag : cur && cur.text === body && mode === 'content' ? cur.etag : etagFor(body);   // 'sticky' (A1a control): a key keeps its first ETag even when its bytes change
    /* G1 (PV8, r4 U1): a FORCED application records what an independent inspection needs -- that it was forced, the
       status it was answered with, the ETag stored before it (so a stale condition is provable) and the condition sent. */
    const label = (/"label":"([^"]*)"/.exec(body) || [])[1] || null;
    const forcedInfo = force ? { forced: true, answered, storedEtagBefore: cur ? cur.etag : null, ifMatch: im || null } : {};
    if (!cur || cur.text !== body) mutations.push({ key, created: !cur, conditional: inm ? 'if-none-match' : im ? 'if-match' : null, at: clock(), label, ...forcedInfo });
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
    const rule = rules.find((r) => {
      if (!((!r.method || r.method === method) && (!r.key || r.key === key) && (!r.bodyIncludes || (method === 'PUT' && body.includes(r.bodyIncludes))))) return false;
      if (r.skip > 0) { r.skip -= 1; return false; }
      return true;
    });
    if (rule) rules = rules.filter((r) => r !== rule);
    const answer = (status, h = {}, b = null) => { entry.status = status; return new Response(b, { status, headers: h }); };
    if (rule && typeof rule.before === 'function') rule.before(entry);
    if (headers.authorization !== `Bearer ${token}` || site !== siteID) return answer(401);
    const id = k(site, storeName, key);
    if (method === 'DELETE') { mutations.push({ key, deleted: true, at: clock() }); store.delete(id); return answer(204); }
    if (rule && rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
    if (method === 'GET' && readMode === 'eventual' && !rule && readCache.has(id)) {
      const c = readCache.get(id);
      return answer(c.status, c.etag ? { etag: c.etag } : {}, c.text);
    }
    if (method === 'GET') {
      if (rule && rule.hang) return abortable(init.signal, rule.ignoreAbort);
      if (rule && rule.throw) throw new TypeError('fetch failed (fixture)');
      if (rule && rule.status) return answer(rule.status);
      const cur = store.get(id);
      if (rule && rule.stallBody) { entry.status = 200; return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { etag: cur ? cur.etag : '"stall"' } }); }
      if (!cur) return answer(404);
      if (readMode === 'eventual' && !readCache.has(id)) readCache.set(id, { status: 200, etag: cur.etag, text: cur.text });
      return answer(200, { etag: cur.etag }, cur.text);
    }
    if (method !== 'PUT') return answer(405);
    const relabel = (text) => text.replace(/"label":"[^"]*"/, () => `"label":"${rule.storeAs || rule.interfere}"`);
    if (rule && rule.interfere) {
      const tx = relabel(body); const prev = store.get(id);
      store.set(id, { text: tx, etag: etagFor(tx) }); mutations.push({ key, created: !prev, conditional: 'interfere', at: clock() });
    }
    if (rule && rule.lie) return answer(200, { etag: rule.lieEtag === 'current' ? (store.get(id) ? store.get(id).etag : '"lie"') : (rule.lieEtag || '"lie"') });
    if (rule && rule.storeAs) {
      const out = applyPut(id, key, relabel(body), headers, entry);
      return answer(out.status, out.status === 200 ? { etag: rule.answerEtagOf === 'body' ? etagFor(body) : out.etag } : {});
    }
    if (rule && rule.hang) { if (rule.apply) applyPut(id, key, body, headers, entry); return abortable(init.signal, rule.ignoreAbort); }
    if (rule && rule.throw) { if (rule.apply) applyPut(id, key, body, headers, entry); throw new TypeError('fetch failed (fixture)'); }
    if (rule && rule.status) {
      const out = rule.apply ? applyPut(id, key, body, headers, entry, !!rule.force, rule.status) : null;
      const h = { ...(rule.status === 200 && out && out.etag ? { etag: out.etag } : {}), ...(rule.headers || {}) };
      return answer(rule.status, h, errorBodyOf(rule));
    }
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
    patternBytes,
    bodyCancels: () => bodyCancels,
    bodyPulls: () => bodyPulls,
    setEtagMode: (m) => { mode = m; },
    /** B15-29 P-1 tests: { ifMatch?, ifNoneMatch? } -- the fake ignores that precondition (a provider defect). */
    /** B15-29 A1a: 'strong' (default) or 'eventual' (edge-cached GETs; see the header). reset() restores 'strong'. */
    setReadMode: (m) => { if (m !== 'strong' && m !== 'eventual') throw new Error('read mode'); readMode = m; readCache.clear(); },
    setIgnoreConditions: (o) => { ignore = { ifMatch: !!(o && o.ifMatch), ifNoneMatch: !!(o && o.ifNoneMatch) }; },
    rule: (...r) => { rules.push(...r); },
    clearRules: () => { rules = []; },
    reset: () => { store.clear(); log.length = 0; mutations.length = 0; rules = []; bodyCancels = 0; bodyPulls = 0; mode = etagMode; ignore = { ifMatch: false, ifNoneMatch: false }; readMode = 'strong'; readCache.clear(); },
    /** Write a raw value at a key (test setup / operator action only, never through the module). */
    put: (storeName, key, text) => { store.set(k(siteID, 'site:' + storeName, key), { text, etag: etagFor(text) }); },
    /** Remove a value at a key (test setup only). */
    remove: (storeName, key) => { store.delete(k(siteID, 'site:' + storeName, key)); },
    keys: () => [...store.keys()],
    get: (storeName, key) => store.get(k(siteID, 'site:' + storeName, key)) || null,
  };
}

module.exports = { createFakeBlobs, EDGE };
