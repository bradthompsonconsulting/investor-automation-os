/**
 * Storage correction (PR #131 plan v6 §14) -- the WIRE HARNESS.
 *
 * An in-memory Netlify Blobs HTTP service that the REAL @netlify/blobs 11.1.0
 * client talks to through `fetch`. It implements the edge (cached) and uncached
 * (strong) origins, `If-Match` / `If-None-Match` on every PUT and DELETE,
 * metadata, listing, and injectable faults:
 *
 *   status(n)            answer n without applying (401, 403, 429, 5xx, 412 ...)
 *   reset                throw a transport error without applying
 *   hang                 never answer until the request is aborted
 *   ackLost              APPLY the request, then throw (acknowledgement lost)
 *   ackLostStatus(n)     APPLY the request, then answer n (e.g. 503)
 *   delayThenApply(ms)   hold, then apply and answer normally
 *   before(fn)           run fn just before the request is served
 *
 * An "eventual" mode serves stale snapshots on the CACHED origin; any ownership
 * read that reaches the cached origin is recorded as a violation (tests fail).
 */
'use strict';
const EDGE = 'https://edge.blobs.test';
const UNCACHED = 'https://uncached.blobs.test';
const SITE = 'site-wire';

function createWire(options = {}) {
  const stores = new Map();            // storeName -> Map(key -> {body: Buffer, etag, meta})
  let etagSeq = 0;
  const rules = [];                    // {match(req), action, times, used}
  const log = [];                      // every served request: {origin, method, store, key, status, failure}
  const violations = [];
  let eventual = false;
  const stale = new Map();             // `${store}\u0000${key}` -> snapshot or null (served on the cached origin)
  let latency = null;                  // (req) => ms
  const next = options.next || null;   // non-blob fetch (the GHL fake)

  const storeOf = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  const parse = (url) => {
    const u = new URL(url);
    const origin = u.origin === UNCACHED ? 'uncached' : u.origin === EDGE ? 'edge' : null;
    if (!origin) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== SITE) throw new Error('wire: unexpected site ' + parts[0]);
    const store = decodeURIComponent(parts[1] || '');
    const key = parts.length > 2 ? parts.slice(2).map(decodeURIComponent).join('/') : null;
    return { origin, store, key, params: u.searchParams };
  };
  const headersOf = (init) => {
    const h = {};
    const src = init && init.headers ? init.headers : {};
    if (typeof src.forEach === 'function') src.forEach((v, k) => { h[k.toLowerCase()] = v; });
    else for (const [k, v] of Object.entries(src)) h[k.toLowerCase()] = v;
    return h;
  };
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
  });
  const never = (signal) => new Promise((_, reject) => {
    if (!signal) return; // hangs forever: the test must abort it
    if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; return reject(e); }
    signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
  });

  function apply(req) {
    const s = storeOf(req.store);
    const cur = req.key !== null ? s.get(req.key) : undefined;
    if (req.method === 'PUT') {
      if (req.headers['if-none-match'] === '*' && cur) return { status: 412 };
      if (req.headers['if-match'] !== undefined && (!cur || cur.etag !== req.headers['if-match'])) return { status: 412 };
      const etag = `"w-${++etagSeq}"`;
      s.set(req.key, { body: req.body, etag, meta: req.headers['x-amz-meta-user'] || null, contentType: req.headers['content-type'] || null });
      return { status: 200, etag };
    }
    if (req.method === 'DELETE') {
      if (req.headers['if-match'] !== undefined && (!cur || cur.etag !== req.headers['if-match'])) return { status: 412 };
      s.delete(req.key);
      return { status: 204 };
    }
    if (req.method === 'GET' && req.key === null) {
      const prefix = req.params.get('prefix') || '';
      const blobs = [...s.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, etag: v.etag }));
      return { status: 200, json: { blobs, directories: [] } };
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      let rec = cur;
      if (req.origin === 'edge' && eventual) {
        const sk = req.store + '\u0000' + req.key;
        if (stale.has(sk)) rec = stale.get(sk) || undefined;
      }
      if (!rec) return { status: 404 };
      return { status: 200, etag: rec.etag, body: rec.body, meta: rec.meta, contentType: rec.contentType };
    }
    return { status: 405 };
  }
  function respond(r) {
    const headers = new Headers();
    if (r.etag) headers.set('etag', r.etag);
    if (r.meta) headers.set('x-amz-meta-user', r.meta);
    if (r.json) { headers.set('content-type', 'application/json'); return new Response(JSON.stringify(r.json), { status: r.status, headers }); }
    if (r.contentType) headers.set('content-type', r.contentType);
    return new Response(r.body !== undefined && r.status !== 204 ? r.body : null, { status: r.status, headers });
  }

  async function fetchImpl(url, init = {}) {
    const p = parse(String(url));
    if (!p) { if (next) return next(url, init); throw new Error('wire: no route for ' + url); }
    const method = String(init.method || 'GET').toUpperCase();
    let body = init.body;
    if (typeof body === 'string') body = Buffer.from(body, 'utf8');
    else if (body instanceof ArrayBuffer) body = Buffer.from(body);
    else if (ArrayBuffer.isView(body)) body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    else if (body && typeof body.arrayBuffer === 'function') body = Buffer.from(await body.arrayBuffer());
    const req = { ...p, method, headers: headersOf(init), body: body || Buffer.alloc(0) };
    const entry = { origin: p.origin, method, store: p.store, key: p.key };
    log.push(entry);
    if (options.ownershipStores && p.origin === 'edge' && method === 'GET' && p.key !== null && options.ownershipStores.includes(p.store)) {
      violations.push({ kind: 'ownership read on the cached origin', store: p.store, key: p.key });
    }
    const signal = init.signal;
    if (signal && signal.aborted) { entry.failure = 'aborted'; const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (latency) { const ms = latency(req); if (ms > 0) { try { await sleep(ms, signal); } catch (e) { entry.failure = 'aborted'; throw e; } } }
    const rule = rules.find((r) => r.used < r.times && r.match(req));
    if (rule) {
      rule.used++;
      const a = rule.action;
      if (a.before) await a.before(req);
      if (a.kind === 'status') { entry.status = a.status; return respond({ status: a.status, ...(a.headers ? {} : {}) , json: a.json }); }
      if (a.kind === 'rateLimit') { entry.status = 429; const r = respond({ status: 429 }); r.headers.set('x-ratelimit-reset', String(a.reset)); return r; }
      if (a.kind === 'reset') { entry.failure = 'reset'; throw new TypeError('fetch failed (wire reset)'); }
      if (a.kind === 'hang') { entry.failure = 'hang'; await never(signal); }
      if (a.kind === 'delayThenApply') { try { await sleep(a.ms, null); } catch { /* ignore */ } }
      if (a.kind === 'ackLost' || a.kind === 'ackLostStatus') {
        const r = apply(req); entry.applied = r.status;
        if (a.kind === 'ackLost') { entry.failure = 'ack-lost'; throw new TypeError('fetch failed (wire: applied, acknowledgement lost)'); }
        entry.status = a.status; return respond({ status: a.status });
      }
    }
    const r = apply(req);
    entry.status = r.status;
    return respond(r);
  }

  const api = {
    EDGE, UNCACHED, SITE,
    fetch: fetchImpl,
    log, violations, stores,
    /** NETLIFY_BLOBS_CONTEXT value for this wire. */
    context(extra = {}) { return Buffer.from(JSON.stringify({ edgeURL: EDGE, uncachedEdgeURL: UNCACHED, siteID: SITE, token: 'wire-token', deployID: 'wire-deploy', primaryRegion: 'us-east-2', ...extra })).toString('base64'); },
    /** Lambda-compatibility context: no uncachedEdgeURL (strong reads impossible). */
    lambdaContext() { return Buffer.from(JSON.stringify({ edgeURL: EDGE, siteID: SITE, token: 'wire-token', deployID: 'wire-deploy' })).toString('base64'); },
    /** Adds a fault rule. match: (req) => boolean. */
    on(match, action, times = 1) { const r = { match, action, times, used: 0 }; rules.push(r); return r; },
    clearRules() { rules.length = 0; },
    status: (n, json) => ({ kind: 'status', status: n, json }),
    rateLimit: (resetEpochSeconds) => ({ kind: 'rateLimit', reset: resetEpochSeconds }),
    reset: () => ({ kind: 'reset' }),
    hang: () => ({ kind: 'hang' }),
    ackLost: () => ({ kind: 'ackLost' }),
    ackLostStatus: (n) => ({ kind: 'ackLostStatus', status: n }),
    delayThenApply: (ms) => ({ kind: 'delayThenApply', ms }),
    before: (fn) => ({ kind: 'pass', before: fn }),
    /** Matchers. */
    put: (store, keyPred) => (req) => req.method === 'PUT' && req.store === 'site:' + store && (typeof keyPred === 'function' ? keyPred(req.key, req) : keyPred === undefined || req.key === keyPred),
    get: (store, keyPred) => (req) => req.method === 'GET' && req.key !== null && req.store === 'site:' + store && (typeof keyPred === 'function' ? keyPred(req.key, req) : keyPred === undefined || req.key === keyPred),
    any: (store) => (req) => store === undefined || req.store === 'site:' + store,
    setEventual(on) { eventual = !!on; },
    /** Snapshot the current value of a key; the cached origin keeps serving it while eventual mode is on. */
    freeze(store, key) { const rec = storeOf('site:' + store).get(key); stale.set('site:' + store + '\u0000' + key, rec ? { ...rec } : null); },
    setLatency(fn) { latency = fn; },
    /** Direct inspection (never through the SDK). */
    keys(store) { return [...storeOf('site:' + store).keys()]; },
    json(store, key) { const r = storeOf('site:' + store).get(key); return r ? JSON.parse(r.body.toString('utf8')) : null; },
    etag(store, key) { const r = storeOf('site:' + store).get(key); return r ? r.etag : null; },
    raw(store, key) { return storeOf('site:' + store).get(key) || null; },
    /** Seeds a record directly (fixtures only). */
    seed(store, key, value) { const etag = `"w-${++etagSeq}"`; storeOf('site:' + store).set(key, { body: Buffer.from(JSON.stringify(value), 'utf8'), etag, meta: null, contentType: 'application/json' }); return etag; },
    remove(store, key) { storeOf('site:' + store).delete(key); },
    clear() { stores.clear(); rules.length = 0; log.length = 0; violations.length = 0; stale.clear(); eventual = false; latency = null; },
    count(pred) { return log.filter(pred).length; },
  };
  return api;
}
module.exports = { createWire, EDGE, UNCACHED, SITE };
