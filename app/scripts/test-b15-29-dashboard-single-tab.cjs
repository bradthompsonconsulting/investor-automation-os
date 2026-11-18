/**
 * B15-29 (INV-137) ONE-operator, ONE-tab Dashboard acceptance (Captain directive 2026-11-15; Jeff). Offline.
 *
 * The REAL Dashboard harness page (scripts/harness/one-login-dashboard: Layout + OneLoginAccess single-flight +
 * Dashboard) runs in Chromium; EVERY /.netlify/functions request is answered by the REAL Netlify handler run in this
 * Node process (app-read-session, app-write-token, ghl-* readers, iaos-runtime-config, ...) through the REAL
 * lib/session-revocation.ts against the fake Blob edge in CONFLICT mode (same-key in-flight overlap -> 409; latency
 * L ms; real timers). The session is bound at origin by the real beginSession and carried by the real signed read
 * cookie (cookie transport injected: __Host- cookies cannot be set on the http test origin). GHL upstream: a fixture
 * answering empty lists. Committed config: TEST oneLogin ENABLED (H5), as deployed.
 *
 * Scenarios (one browser context, ONE tab):
 *   T-L{10,40,100}  K loads each: status signed in; every protected Dashboard reader 200; the saving token primed
 *                   (app-write-token 200); ZERO 503; no page error; only allowlisted functions; no foreign request
 *   NAV             load -> navigate away (unmount) -> back (remount): the readers run again, zero 503
 *   SAVE (direct)   mint a saving token for the session, then protected-noop {"probe":"a6"} -> 200 {ok:true,sent:false};
 *                   {"probe":"x"} -> 400 malformed (the token is never printed or stored)
 *   DENY (direct)   no cookie / tampered cookie / revoked session / legacy cookie under One Login ON -> every reader
 *                   401 with ZERO GHL upstream calls; mint after revocation -> 401; writer without token -> exact 401
 *   ACCOUNTING      per scenario: requests by function and status; GHL upstream calls; 409 answers; check-log classes
 *
 * Exit 0 iff every assertion holds. Usage: node scripts/test-b15-29-dashboard-single-tab.cjs [--k=5] [--latencies=10,40,100]
 * The single-tab zero-503 assertion is the D2 acceptance target; on a client without D2 it is EXPECTED to fail at
 * realistic latency (baseline), which this suite reports per run.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { createFakeBlobs } = require('./lib/b15-29-fake-blobs.cjs');
const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
Module._resolveFilename = ((original) => function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) for (const ext of ['.ts', '.tsx']) { const c = path.resolve(path.dirname(parent.filename), name + ext); if (fs.existsSync(c)) return c; }
  return original.call(this, name, parent, ...rest);
})(Module._resolveFilename);
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const K = Number(arg('k', '10'));
/* The D2 client contract under test: at most LANE_MAX session-checked requests from ONE tab in flight at the server at
   once (Scotty's lane: 1). Measured server-side per tab. --lane-max=0 disables the bound (baseline characterisation). */
const LANE_MAX = Number(arg('lane-max', '1'));
/* ABNORMAL (isolated) write-abandon scenario: the protected writer's response DELIVERY is held for WRITE_HOLD_MS (the
   origin has already processed it). Set above the client's write deadline (r2: 20 000 ms) so the caller gives up while
   the server-side work exists. WRITE_DEADLINE_MS, when given, is the client contract to expect an abort by (r3 value
   from Scotty); without it the outcome is only RECORDED. No expectation is made that a later save proceeds. */
const WRITE_HOLD_MS = Number(arg('write-hold-ms', '25000'));
/* --contract=r3 (Scotty's D2 r3 amendment, PROVISIONAL until Bones reviews it, 02_SCOTTY_D2_r3_AMENDMENT.md sha256
   2fe7d8b6…ccd7): write deadline 20 000 ms -> LaneUncertain (dispatched); the no-op writer's key is "*" (conflicts with
   every write) -> a later write is rejected at once with LaneNotSent("uncertain_pending") and NOTHING is sent; reads
   still proceed; no automatic release or retry. Without --contract the client outcome is recorded only. */
const CONTRACT = arg('contract', null);
/* --contract=r6: assert the D2 lane contract (Scotty r4 + r5 + r6, design ACCEPTED by Bones 2026-11-17) against a
   client that implements it. r4 is accepted as an alias for the r4-era rows. Without it, lane checks are NOT-RUN. */
const LANE = CONTRACT === 'r6' || CONTRACT === 'r4';
/* --only=J1,J4,D,SC,...  run only the named lane / rendered scenarios (and skip the healthy-load and earlier browser rows). */
const ONLY = arg('only', null);
const want = (id) => !ONLY || ONLY.split(',').includes(id);
/* --mutation=skip-logout | bypass-stall | dup-send | no-replace  NEGATIVE CONTROLS: the named precondition must then FAIL (J1/D4/D5 sign-out; J4 stall). */
const MUTATION = arg('mutation', null);
const fx = require('./harness/seller-call-offer-ready-fixture.cjs');
const WRITE_DEADLINE_MS = arg('write-deadline-ms', null) !== null ? Number(arg('write-deadline-ms')) : (CONTRACT === 'r3' || CONTRACT === 'r4') ? 20000 : null;
const LATENCIES = arg('latencies', '10,40,100').split(',').map(Number);
const ORIGIN = 'https://proof.example.invalid';
const SITE = '07ca1f1a-60fd-4229-a076-528970957912';
Object.assign(process.env, {
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client', IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid', IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client', IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid', IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN, GHL_PRIVATE_API_KEY: 'offline-fixture', IAOS_ENV: 'test',
});
const blobs = createFakeBlobs({ siteID: SITE });
let ghlCalls = 0;
/* GHL upstream fixture. Lists answer empty; for the r4 J-rows it is STATEFUL for the single-record reads and writes the
   REAL ghl-write uses: GET/PUT /contacts/:id (customFields {id,value}), GET/POST /contacts/:id/notes, GET/PUT
   /opportunities/:id (customFields {id,fieldValue}), each bound to the committed Test locationId (the boundary checks it). */
const GHL = { contacts: new Map(), opps: new Map(), notes: [], list: [], failNote: null, fx: false,
  resetAll() { this.contacts.clear(); this.opps.clear(); this.notes.length = 0; this.list = []; this.failNote = null; this.fx = false; },
  /** Lead Queue rows for the rendered Dashboard: contacts WITH a phone (the Lead Queue filter). */
  seedList(ids) { this.list = ids.map((id, i) => ({ id, firstName: 'Fixture', lastName: 'Lead' + (i + 1), phone: '+1555555011' + i, tags: [], customFields: [], dateAdded: '2026-11-01T00:00:00.000Z' })); } };
let ghlWritesToGhl = 0;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (blobs.handles(u)) return blobs.fetch(url, init);
  ghlCalls += 1;
  const m = String(init.method || 'GET').toUpperCase(); const U = new URL(u); const LOC = cfgLoc(); let mm;
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (GHL.fx) { const r = fxUpstream(m, U, init, LOC, J); if (r) return r; }
  if (U.pathname === '/contacts' || U.pathname === '/contacts/') return J({ contacts: GHL.list, meta: {} });
  if ((mm = U.pathname.match(/^\/contacts\/([A-Za-z0-9_-]+)\/notes$/))) {
    if (m === 'POST' && GHL.failNote === 'post500') return J({ message: 'fixture fault' }, 500);
    if (m === 'POST' && GHL.failNote === 'noReadback') return J({ note: { id: 'fxn-ghost', body: JSON.parse(init.body || '{}').body, contactId: mm[1] } }, 201);
    if (m === 'POST') { ghlWritesToGhl += 1; const n = { id: 'fxn' + (GHL.notes.length + 1), body: JSON.parse(init.body || '{}').body, dateAdded: new Date().toISOString(), contactId: mm[1] }; GHL.notes.push(n); return J({ note: n }, 201); }
    return J({ notes: GHL.notes.filter((n) => n.contactId === mm[1]) });
  }
  if ((mm = U.pathname.match(/^\/contacts\/([A-Za-z0-9_-]+)$/)) && !['search', 'upsert'].includes(mm[1])) {
    const c = GHL.contacts.get(mm[1]) || { id: mm[1], locationId: LOC, customFields: [] }; GHL.contacts.set(mm[1], c);
    if (m === 'PUT') { ghlWritesToGhl += 1; for (const f of JSON.parse(init.body).customFields || []) { c.customFields = c.customFields.filter((x) => x.id !== f.id); if (f.field_value !== '' && f.field_value !== null) c.customFields.push({ id: f.id, value: f.field_value }); } }
    return J({ contact: c });
  }
  if ((mm = U.pathname.match(/^\/opportunities\/([A-Za-z0-9_-]+)$/)) && !['search', 'pipelines'].includes(mm[1])) {
    const o = GHL.opps.get(mm[1]) || { id: mm[1], locationId: LOC, contactId: 'ZyXwVuTsRqPoNmLkJiHg', customFields: [] }; GHL.opps.set(mm[1], o);
    if (m === 'PUT') { ghlWritesToGhl += 1; for (const f of JSON.parse(init.body).customFields || []) { o.customFields = o.customFields.filter((x) => x.id !== f.id); o.customFields.push({ id: f.id, fieldValue: f.field_value }); } }
    return J({ opportunity: o });
  }
  return J({ contacts: [], opportunities: [], conversations: [], pipelines: [{ id: 'fixture-pipeline', name: 'P', stages: [] }], events: [], meta: { total: 0 }, total: 0 });
};
/* SC: ghl-write's own GHL calls for the Seller Call fixture contact / deal go to the SAME state the page's readers are
   answered from (seller-call-offer-ready-fixture.cjs), so the page's readback sees exactly what the real handler wrote. */
function fxUpstream(m, U, init, LOC, J) {
  let mm;
  if ((mm = U.pathname.match(/^\/contacts\/([A-Za-z0-9_-]+)\/notes$/)) && mm[1] === fx.CONTACT) {
    if (m === 'POST') { ghlWritesToGhl += 1; const n = { id: 'rh-' + (fx.state.notes.length + 1), body: JSON.parse(init.body || '{}').body, dateAdded: new Date().toISOString() }; fx.state.notes.push(n); return J({ note: { ...n, contactId: fx.CONTACT } }, 201); }
    return J({ notes: fx.state.notes.map((x) => ({ ...x })) });
  }
  if ((mm = U.pathname.match(/^\/contacts\/([A-Za-z0-9_-]+)$/)) && mm[1] === fx.CONTACT) {
    if (m === 'PUT') { ghlWritesToGhl += 1; for (const f of JSON.parse(init.body).customFields || []) { fx.state.contactFields = fx.state.contactFields.filter((x) => x.id !== f.id); if (f.field_value !== '' && f.field_value !== null) fx.state.contactFields.push({ id: f.id, value: f.field_value }); } }
    return J({ contact: { id: fx.CONTACT, locationId: LOC, firstName: fx.FIRST, lastName: 'Fixture', customFields: fx.state.contactFields.map((f) => ({ ...f })) } });
  }
  if ((mm = U.pathname.match(/^\/opportunities\/([A-Za-z0-9_-]+)$/)) && mm[1] === fx.OPP) {
    const o = fx.answer({ kind: 'opp-read', target: fx.OPP }).body.opportunity; return J({ opportunity: { ...o, locationId: LOC } });
  }
  return null;
}
const cfgLoc = () => require(path.join(APP, 'shared/ghl-config.ts')).getConfig('test').locationId;
const cfg = require(path.join(APP, 'shared/ghl-config.ts'));
const readAuth = require(path.join(FUNCTIONS, 'lib/app-read-auth.ts'));
const rev = require(path.join(FUNCTIONS, 'lib/session-revocation.ts'));
assert.equal(cfg.getConfig('test').oneLogin, cfg.ONE_LOGIN_ENABLED, 'committed TEST One Login ENABLED (H5) -- this suite tests the deployed configuration');
assert.equal(cfg.getConfig('production').oneLogin, cfg.ONE_LOGIN_DISABLED, 'committed PRODUCTION One Login DISABLED');
const handlers = new Map();
const handlerFor = (fn) => { if (!handlers.has(fn)) { const p = path.join(FUNCTIONS, fn + '.ts'); handlers.set(fn, fs.existsSync(p) ? require(p).handler : null); } return handlers.get(fn); };
const ALLOWED_FNS = new Set(['iaos-runtime-config', 'app-read-session', 'app-write-token', 'ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations',
  'ghl-calendar-events', 'ghl-underwriting-policy', 'call-log-barrier', 'ghl-contact', 'ghl-contact-conversations', 'ghl-proxy',
  'protected-noop', 'protected-noop-read', 'app-signout']);
/* Functions that run NO session check (excluded from the per-tab in-flight bound). */
const UNCHECKED_FNS = new Set(['iaos-runtime-config']);
let PENDING = 0;   // server-side handler executions not yet settled, across every tab (aborted requests included)
const PROTECTED_READERS = ['ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations'];
const anchorText = (epoch = 'fixture-epoch-0001') => JSON.stringify({ env: 'test', epoch, kind: 'iaos-session-revocation-authority', siteID: SITE, state: 'open', v: 1 });
const sid = (n) => Buffer.alloc(16, n).toString('base64url');
const NF = { headers: { 'x-nf-site-id': SITE }, blobs: blobs.lambdaBlobs };
async function revokeSession(S) { return rev.revokeSession(S.sid, S.epoch, 'test', { event: NF }); }
async function bindSession(n) {
  const g = await rev.beginSession(sid(n), 'test', { event: NF });
  if (g.kind !== 'issued') throw new Error('fixture bind: ' + JSON.stringify(g));
  return { sid: sid(n), epoch: g.epoch, aetag: g.aetag, setag: g.setag, cookie: readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), sid(n), g.epoch, { aetag: g.aetag, setag: g.setag }).token };
}
const ev = ({ method = 'GET', cookie = null, headers = {}, body = '' } = {}) => ({ httpMethod: method, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE, ...(cookie ? { cookie: `${readAuth.READ_COOKIE}=${cookie}` } : {}), ...headers }, body, blobs: blobs.lambdaBlobs });
const fresh = (latencyMs) => { blobs.reset(); blobs.put('iaos-session-authority', 'authority', anchorText()); blobs.setConflictMode(latencyMs ? { latencyMs } : null); ghlCalls = 0; };

let checks = 0, failures = 0; const RESULTS = [];
let notRun = 0;
/** A check of the D2 LANE CONTRACT itself: NOT-RUN (never PASS) unless --contract=r6 is given. */
async function laneCheck(name, fn) { if (!LANE) { notRun += 1; console.log('NOT-RUN (requires the unimplemented D2 client lane; --contract=r6)  ' + name); return; } return check(name, fn); }
async function check(name, fn) { checks += 1; try { await fn(); console.log('PASS  ' + name); } catch (e) { failures += 1; console.log('FAIL  ' + name + ' -- ' + (e && e.message)); } }

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const HARNESS = '/scripts/harness/one-login-dashboard/index.html';
  const server = await createServer({ root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1), 'scripts/harness/app-routes/index.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** ONE browser context, ONE tab, the session's cookie injected on every function request. */
  /* Server-side accounting per tab: every function request is a log entry with its start / end time and status; the
     number of SESSION-CHECKED handler executions from this tab in flight at once (inflight / maxInflight: the D2 lane
     bound); handlers that are still running after the browser gave up (aborted / closed page) keep running here, as
     a Lambda would, and are counted in the global PENDING until they settle. */
  async function openTab(cookie, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Chicago', locale: 'en-US' });
    const tab = { log: [], foreign: [], errs: [], inflight: 0, maxInflight: 0, fulfillFailed: 0, fxReaders: !!opts.fxReaders };
    if (opts.initOverride) await ctx.addInitScript((o) => { window.__iaosHarnessOverride = o; }, opts.initOverride);
    await ctx.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.endsWith('/app-read-login.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>login</title>' });
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { tab.foreign.push(url); return route.abort(); }
      const U = new URL(url); const fn = U.pathname.replace(/^.*\/\.netlify\/functions\//, '');
      const entry = { fn, method: req.method(), t0: Date.now() }; tab.log.push(entry);
      if (fn === 'ghl-write') { try { const p = JSON.parse(req.postData() || '{}'); entry.op = p.operation; entry.requestId = p.requestId; entry.payload = require('crypto').createHash('sha256').update(JSON.stringify([p.operation, p.targetId, p.args])).digest('hex').slice(0, 16); } catch { /* unparseable: recorded without op */ } }
      // SC: content readers answered at function level from the Seller Call fixture (session/token/sign-out/write stay REAL).
      if (tab.fxReaders && req.method() === 'GET' && !['app-read-session', 'iaos-runtime-config'].includes(fn)) {
        const a = fx.answer(fx.classify(url, 'GET', null)); entry.status = a.status; entry.t1 = Date.now(); entry.fx = true;
        return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) }).catch(() => { tab.fulfillFailed += 1; });
      }
      const h = handlerFor(fn);
      if (!h) { entry.status = 404; entry.t1 = Date.now(); return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no handler"}' }).catch(() => { tab.fulfillFailed += 1; }); }
      const headers = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE };
      for (const [k, v] of Object.entries(req.headers())) if (!['cookie', 'host', 'origin', 'referer'].includes(k)) headers[k] = v;
      if (tab.cookie) headers.cookie = `${readAuth.READ_COOKIE}=${tab.cookie}`;
      const q = {}; U.searchParams.forEach((v, k) => { q[k] = v; });
      const checked = !UNCHECKED_FNS.has(fn);
      if (checked) { tab.inflight += 1; tab.maxInflight = Math.max(tab.maxInflight, tab.inflight); }
      PENDING += 1;
      // J1: the SERVER execution itself is held (a slow Lambda): the handler starts only after holdServer.ms.
      if (tab.holdServer && tab.holdServer.fn === fn && !(tab.holdServer.count-- <= 0)) { entry.serverHeldMs = tab.holdServer.ms; await sleep(tab.holdServer.ms); }
      let res;
      try { res = await h({ httpMethod: req.method(), headers, body: req.postData() || '', blobs: blobs.lambdaBlobs, queryStringParameters: Object.keys(q).length ? q : undefined, rawUrl: url, path: U.pathname }); }
      catch (e) { res = { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: '{"error":"handler threw"}' }; entry.threw = true; }
      finally { PENDING -= 1; if (checked) tab.inflight -= 1; }
      entry.status = res.statusCode; entry.t1 = Date.now(); entry.ms = entry.t1 - entry.t0;
      if (fn === 'app-read-session') { try { const b = JSON.parse(res.body || '{}'); entry.statusSays = { signedIn: b.signedIn === true, state: typeof b.state === 'string' ? b.state : null }; } catch { entry.statusSays = { unparseable: true }; } }
      const hdrs = {}; for (const [k, v] of Object.entries(res.headers || {})) if (k.toLowerCase() !== 'set-cookie') hdrs[k] = String(v);
      if (tab.holdDelivery && tab.holdDelivery.fn === fn && !(tab.holdDelivery.count !== undefined && tab.holdDelivery.count-- <= 0)) { entry.heldMs = tab.holdDelivery.ms; await sleep(tab.holdDelivery.ms); }   // origin already processed; only DELIVERY waits
      // J6′: a malformed reply for one function (the server processed the request; only the delivered body differs).
      if (tab.rewrite && tab.rewrite.fn === fn && tab.rewrite.count-- > 0) { entry.rewritten = true; res = { ...res, body: tab.rewrite.body }; }
      // D6 popup: the status answer's expiresAt is moved so the session reminder falls due during the test (page clock).
      if (tab.patchJson && tab.patchJson.fn === fn && res.statusCode === 200) { try { res = { ...res, body: JSON.stringify(tab.patchJson.patch(JSON.parse(res.body))) }; entry.patched = true; } catch { /* non-JSON: delivered as is */ } }
      entry.deliveredAt = Date.now();
      // --mutation=dup-send (NEGATIVE CONTROL for SC2): the FIRST ghl-write of a tab is replayed once to the server, as a
      // client that blindly re-sent would; SC2's one-send-per-item precondition must then FAIL.
      if (MUTATION === 'dup-send' && fn === 'ghl-write' && tab.dupArmed) { tab.dupArmed = false; const dup = { ...entry, dup: true, t0: Date.now() }; tab.log.push(dup); const r2 = await h({ httpMethod: req.method(), headers, body: req.postData() || '', blobs: blobs.lambdaBlobs, rawUrl: url, path: U.pathname }); dup.status = r2.statusCode; dup.t1 = Date.now(); }
      return route.fulfill({ status: res.statusCode, headers: hdrs, body: res.body || '' }).catch(() => { tab.fulfillFailed += 1; entry.undelivered = true; });
    });
    /* J4: an in-page fetch STALL for one function, set per page by window.__iaosStall = { fn, mode } -- 'body': headers
       arrive at once, then a body stream that never ends and ignores cancel(); 'abort': a fetch that never settles and
       ignores its AbortSignal. Nothing reaches the server for a stalled request. Off unless the test sets it. */
    await ctx.addInitScript(() => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const s = window.__iaosStall; const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (s && url.includes('/.netlify/functions/' + s.fn)) {
          window.__iaosStallHits = (window.__iaosStallHits || 0) + 1;
          if (s.mode === 'abort') return new Promise(() => {});
          return Promise.resolve(new Response(new ReadableStream({ start() {}, pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return real(input, init);
      };
    });
    tab.cookie = cookie;
    tab.ctx = ctx; tab.page = await ctx.newPage(); tab.page.on('pageerror', (e) => tab.errs.push(String(e).slice(0, 160)));
    return tab;
  }
  /** Rendered completion: the Dashboard's count notes render only once every reader has delivered (loading false). */
  const rendered = async (T, ms = 8000) => T.page.waitForSelector('[data-testid="dashboard-count-notes"]', { timeout: ms }).then(() => true).catch(() => false);
  /** Settle: wait until no server-side handler is pending (bounded), then report anything stuck. */
  const settleServer = async (ms = 6000) => { const t0 = Date.now(); while (PENDING > 0 && Date.now() - t0 < ms) await sleep(25); return { pending: PENDING, blobInflight: blobs.inflightTotal() }; };
  const unfinished = (T) => T.log.filter((e) => e.status === undefined).length;
  const account = (log) => { const by = {}; for (const e of log) { const k = `${e.fn}:${e.status}`; by[k] = (by[k] || 0) + 1; } return by; };
  const withCheckLog = async (fn) => { const w0 = console.warn; const lines = []; console.warn = (...a) => { const l = a.map(String).join(' '); if (l.startsWith('[iaos-session-check]')) lines.push(JSON.parse(l.slice(21))); else w0(...a); };
    try { return { out: await fn(), lines }; } finally { console.warn = w0; } };
  const classes = (lines) => lines.reduce((a, l) => { const k = `${l.op}:${l.kind}:${l.reason}`; a[k] = (a[k] || 0) + 1; return a; }, {});

  // WARM-UP (not counted): one load of each harness page so Vite's first-request dependency optimisation (and its
  // page reload) happens before any measured run.
  { fresh(0); const S = await bindSession(99); const W = await openTab(S.cookie); await W.page.goto(`${base}${HARNESS}`); await rendered(W, 90000); await W.page.goto(`${base}/scripts/harness/app-routes/index.html`).catch(() => {}); await W.page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 }).catch(() => {}); await settleServer(); await W.ctx.close(); }
  if (!ONLY) {
  // ── T-L: single-tab Dashboard loads at each latency ──
  for (const L of LATENCIES) {
    const runs = [];
    for (let k = 0; k < K; k++) {
      fresh(L); const S = await bindSession(1);
      const { out: T, lines } = await withCheckLog(async () => { const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`);
        T.rendered = await rendered(T); await sleep(300);
        T.text = await T.page.evaluate(() => document.body.innerText).catch(() => ''); return T; });
      const srv = await settleServer();
      const by = account(T.log); const n503 = T.log.filter((e) => e.status === 503).length;
      const row = { scenario: `T-L${L}`, run: k + 1, n503, requests: T.log.length, byFnStatus: by, conflict409s: blobs.conflictAnswers(), ghlCalls, checkClasses: classes(lines),
        rendered: T.rendered, signedIn: /Sign out/i.test(T.text), unavailableBanner: /IAOS can.t confirm your sign-in/.test(T.text), pageErrors: T.errs.length, foreign: T.foreign.length,
        unexpectedFns: [...new Set(T.log.map((e) => e.fn).filter((f) => !ALLOWED_FNS.has(f)))], maxMs: Math.max(0, ...T.log.map((e) => e.ms || 0)),
        maxInflight: T.maxInflight, unfinished: unfinished(T), serverPending: srv.pending, blobInflight: srv.blobInflight };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row)); runs.push(row);
      await T.ctx.close();
    }
    await check(`T-L${L} one tab x${K}: ZERO 503; status signed in; every protected Dashboard reader 200; saving token primed (app-write-token 200); Dashboard rendered complete; no page error, no foreign request, only allowlisted functions`, async () => {
      const bad = runs.filter((r) => r.n503 > 0 || !r.signedIn || !r.rendered || r.unavailableBanner || r.pageErrors || r.foreign || r.unexpectedFns.length
        || PROTECTED_READERS.some((f) => !(r.byFnStatus[`${f}:200`] >= 1)) || !(r.byFnStatus['app-write-token:200'] >= 1));
      assert.deepEqual(bad.map((r) => ({ run: r.run, n503: r.n503, signedIn: r.signedIn, rendered: r.rendered, by: r.byFnStatus })), [], `${bad.length}/${K} runs failed`);
    });
    await check(`T-L${L} one tab x${K}: no stuck request or unfinished work (every request answered; 0 server handlers pending; 0 Blob writes in flight) and at most ${LANE_MAX || 'unbounded'} session-checked request(s) from the tab in flight at once`, async () => {
      const bad = runs.filter((r) => r.unfinished || r.serverPending || r.blobInflight || (LANE_MAX > 0 && r.maxInflight > LANE_MAX));
      assert.deepEqual(bad.map((r) => ({ run: r.run, unfinished: r.unfinished, pending: r.serverPending, blob: r.blobInflight, maxInflight: r.maxInflight })), [], `${bad.length}/${K} runs failed`);
    });
  }
  // ── NAV: navigate away (unmount) and back (remount) in the same tab ──
  {
    fresh(40); const S = await bindSession(2);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T);
    const first = T.log.length;
    await T.page.evaluate(() => window.__iaosNavigate('/away')); await sleep(300);
    await T.page.evaluate(() => window.__iaosNavigate('/')); const again = await rendered(T); await settleServer();
    const after = T.log.slice(first); const row = { scenario: 'NAV', requestsFirst: first, requestsAfter: after.length, byFnStatusAfter: account(after), n503: T.log.filter((e) => e.status === 503).length, renderedAgain: again, maxInflight: T.maxInflight };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('NAV away and back in the same tab (latency 40 ms): the protected readers run again and answer 200; the Dashboard renders complete again; zero 503 across the whole tab', async () => {
      assert.ok(PROTECTED_READERS.some((f) => row.byFnStatusAfter[`${f}:200`] >= 1), JSON.stringify(row.byFnStatusAfter));
      assert.ok(again, 'rendered again'); assert.equal(row.n503, 0, JSON.stringify(account(T.log)));
    });
    await T.ctx.close();
  }
  // ── SAVE-IN-PAGE: an authorized save issued WHILE the Dashboard is loading, through the app's own write client, then a readback ──
  {
    fresh(40); const S = await bindSession(6);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`);
    const save = await T.page.evaluate(async () => {
      const w = await import('/src/lib/app-write-session.ts'); const r = await import('/src/lib/read-session.ts');
      const out = {};
      for (let i = 0; i < 100 && !document.body.innerText.includes('Sign out'); i++) await new Promise((x) => setTimeout(x, 20));   // signed-in status confirmed, readers still loading
      try { const res = await w.appWriteFetch('/.netlify/functions/protected-noop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"probe":"a6"}' }); out.saveStatus = res.status; out.saveBody = await res.text(); }
      catch (e) { out.saveThrew = String(e && e.name); }
      try { const rb = await r.readFetch('/.netlify/functions/protected-noop-read'); out.readbackStatus = rb.status; } catch (e) { out.readbackThrew = String(e && e.name); }
      return out;
    });
    const done = await rendered(T); await settleServer();
    const row = { scenario: 'SAVE-IN-PAGE', ...save, rendered: done, n503: T.log.filter((e) => e.status === 503).length, byFnStatus: account(T.log), maxInflight: T.maxInflight };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('TRANSPORT-IN-PAGE (40 ms; the no-op authorization TRANSPORT through the app write client -- NOT a persisted business save): a write sent while the Dashboard is still loading -> 200 {"ok":true,"sent":false}; the readback -> 204; the Dashboard still renders complete; zero 503; the token never reaches the test output', async () => {
      assert.deepEqual([row.saveStatus, row.saveBody, row.readbackStatus], [200, '{"ok":true,"sent":false}', 204], JSON.stringify(row));
      assert.ok(row.rendered); assert.equal(row.n503, 0, JSON.stringify(row.byFnStatus));
      assert.ok(!/eyJ/.test(JSON.stringify(row)), 'no token-shaped value in the evidence');
    });
    await T.ctx.close();
  }
  // ── QUEUE: a burst of reads from the app's read client in ONE tab: all answered, bounded concurrency, no 503 ──
  {
    fresh(40); const S = await bindSession(7);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
    const base0 = T.log.length; T.maxInflight = 0;
    const burst = await T.page.evaluate(async () => { const r = await import('/src/lib/read-session.ts');
      const xs = await Promise.all(Array.from({ length: 12 }, () => r.readFetch('/.netlify/functions/ghl-contacts').then((x) => x.status, (e) => 'threw:' + (e && e.name)))); return xs; });
    await settleServer();
    const row = { scenario: 'QUEUE', burst, maxInflight: T.maxInflight, requests: T.log.length - base0, n503: T.log.slice(base0).filter((e) => e.status === 503).length };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check(`QUEUE (40 ms): 12 concurrent reads from the app read client in one tab -> all 200, zero 503, at most ${LANE_MAX || 'unbounded'} session-checked request(s) in flight, every request answered`, async () => {
      assert.deepEqual(row.burst, Array(12).fill(200), JSON.stringify(row)); assert.equal(row.n503, 0);
      if (LANE_MAX > 0) assert.ok(row.maxInflight <= LANE_MAX, 'maxInflight ' + row.maxInflight);
      assert.equal(unfinished(T), 0);
    });
    await T.ctx.close();
  }
  // ── CANCEL: unmount the Dashboard right after the load starts: no new work keeps being started ──
  {
    fresh(100); const S = await bindSession(8);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`);
    await T.page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 8000 });   // the harness router is mounted (load in progress)
    // Unmount only once the reader phase has begun (status confirmed and at least one protected reader started), so the
    // check exercises queued / in-flight reader work, not an empty page.
    for (let i = 0; i < 400 && !T.log.some((e) => e.fn.startsWith('ghl-')); i++) await sleep(5);
    await T.page.evaluate(() => window.__iaosNavigate('/away')); const tUnmount = Date.now();
    const loadRequestsAtUnmount = T.log.length;
    await sleep(2000); await settleServer();
    const late = T.log.filter((e) => e.t0 > tUnmount + 300 && e.fn !== 'iaos-runtime-config');
    const row = { scenario: 'CANCEL', startedAfterUnmountPlus300ms: late.map((e) => e.fn), requestsAtUnmount: loadRequestsAtUnmount, requests: T.log.length, unfinished: unfinished(T), pending: PENDING };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('CANCEL (100 ms): after the Dashboard unmounts, no session-checked request is STARTED more than 300 ms later (queued work is cancelled, not drained); every started request is answered; 0 handlers pending', async () => {
      assert.ok(row.requestsAtUnmount >= 2, 'non-vacuous: the reader phase had begun at unmount ' + JSON.stringify(row));
      assert.deepEqual(row.startedAfterUnmountPlus300ms, [], JSON.stringify(row)); assert.equal(row.unfinished, 0); assert.equal(row.pending, 0);
    });
    await T.ctx.close();
  }
  // ── LOGOUT (UI): the operator clicks Sign out; the tab is signed out; nothing protected is answered with data afterwards ──
  {
    fresh(40); const S = await bindSession(10);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
    const base0 = T.log.length;
    await T.page.getByRole('button', { name: 'Sign out' }).click(); await sleep(1500); await settleServer();
    const tAfter = Date.now(); await T.page.reload(); await sleep(2500); await settleServer();
    const text = await T.page.evaluate(() => document.body.innerText).catch(() => '');
    const signout = T.log.slice(base0).filter((e) => e.fn === 'app-signout').map((e) => e.status);
    const after = T.log.filter((e) => e.t0 > tAfter);
    const row = { scenario: 'LOGOUT', signout, afterReload: account(after), signedInShown: /Sign out/.test(text) };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('LOGOUT (UI): Sign out -> app-signout 200 (server-verified); after a reload the tab is not signed in and no protected reader answers 200', async () => {
      assert.deepEqual(row.signout, [200], JSON.stringify(row));
      assert.equal(after.filter((e) => e.fn.startsWith('ghl-') && e.status === 200).length, 0, JSON.stringify(row.afterReload));
      assert.equal(row.signedInShown, false);
    });
    await T.ctx.close();
  }
  // ── INVALID credentials in the tab: a tampered cookie ──
  {
    fresh(40); const S = await bindSession(11);
    const T = await openTab(S.cookie.slice(0, -2) + (S.cookie.endsWith('A') ? 'BB' : 'AA')); await T.page.goto(`${base}${HARNESS}`); await sleep(2500); await settleServer();
    const text = await T.page.evaluate(() => document.body.innerText).catch(() => '');
    const row = { scenario: 'INVALID', byFnStatus: account(T.log), signedInShown: /Sign out/.test(text), n503: T.log.filter((e) => e.status === 503).length };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('INVALID (UI): a tampered session cookie -> the tab is not signed in, no protected reader answers 200, no 503 (a refusal, not an outage)', async () => {
      assert.equal(T.log.filter((e) => e.fn.startsWith('ghl-') && e.status === 200).length, 0, JSON.stringify(row));
      assert.equal(row.signedInShown, false); assert.equal(row.n503, 0);
    });
    await T.ctx.close();
  }
  // ── ABORT: the tab is closed mid-load; server-side work keeps running (as a Lambda would) and must settle without harm ──
  {
    fresh(100); const S = await bindSession(12);
    const anchorBefore = blobs.get('iaos-session-authority', 'authority').text;
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`);
    // Close only while protected reader work is IN FLIGHT at the server (started, not answered), so abandoned server-side work is exercised.
    for (let i = 0; i < 600 && !T.log.some((e) => e.fn.startsWith('ghl-') && e.status === undefined); i++) await sleep(5);
    const inFlightAtClose = T.log.filter((e) => e.status === undefined).length;
    await T.page.close(); const srv = await settleServer(8000);
    const after = await rev.checkSession({ sid: S.sid, epoch: S.epoch, aetag: S.aetag, setag: S.setag }, 'test', { event: NF });
    const row = { scenario: 'ABORT', inFlightAtClose, requests: T.log.length, undelivered: T.log.filter((e) => e.undelivered).length, unfinished: unfinished(T), ...srv, sessionAfter: after.kind,
      anchorUnchanged: blobs.get('iaos-session-authority', 'authority').text === anchorBefore };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('ABORT (100 ms): requests abandoned by a closed tab keep running server-side and all settle (0 pending, 0 Blob in flight); the session is still active and the anchor bytes unchanged (no partial state)', async () => {
      assert.ok(row.inFlightAtClose >= 1, 'non-vacuous: server work was in flight at close ' + JSON.stringify(row));
      assert.equal(row.pending, 0, JSON.stringify(row)); assert.equal(row.blobInflight, 0);
      assert.equal(row.sessionAfter, 'active'); assert.ok(row.anchorUnchanged);
    });
    await T.ctx.close();
  }
  // ── ABNORMAL (isolated, last browser scenario): a write whose response is not delivered in time (ghost / abandoned
  //    server work). Explicit accounting; excluded from the healthy one-in-flight assertions; NO expectation that a
  //    later save proceeds automatically. ──
  {
    fresh(40); const S = await bindSession(13);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
    const base0 = T.log.length; T.holdDelivery = { fn: 'protected-noop', ms: WRITE_HOLD_MS };
    const t0 = Date.now();
    const outcome = await T.page.evaluate(async () => {
      const w = await import('/src/lib/app-write-session.ts'); const t = performance.now();
      try { const r = await w.appWriteFetch('/.netlify/functions/protected-noop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"probe":"a6"}' }); return { kind: 'response', status: r.status, ms: Math.round(performance.now() - t) }; }
      catch (e) { return { kind: 'error', name: String(e && e.name), ms: Math.round(performance.now() - t) }; }
    });
    // The caller has its outcome. Only under the r3 contract: a SECOND write attempt (operator-initiated, same "*" key)
    // and a read, while the hold exists -- recorded always, asserted only with --contract=r3.
    const n0 = T.log.filter((e) => e.fn === 'protected-noop').length;
    const second = await T.page.evaluate(async () => {
      const w = await import('/src/lib/app-write-session.ts'); const r = await import('/src/lib/read-session.ts'); const out = {}; const t = performance.now();
      try { const x = await w.appWriteFetch('/.netlify/functions/protected-noop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"probe":"a6"}' }); out.write = { kind: 'response', status: x.status }; }
      catch (e) { out.write = { kind: 'error', name: String(e && e.name), reason: e && e.reason ? String(e.reason) : null }; }
      out.writeMs = Math.round(performance.now() - t);
      try { const rb = await r.readFetch('/.netlify/functions/ghl-contacts'); out.read = rb.status; } catch (e) { out.read = 'threw:' + String(e && e.name); }
      return out;
    }).catch((e) => ({ evaluateFailed: String(e).slice(0, 80) }));
    const secondWritesSent = T.log.filter((e) => e.fn === 'protected-noop').length - n0;
    await sleep(Math.max(0, WRITE_HOLD_MS + 5000 - (Date.now() - t0))); await settleServer(10000);
    const writes = T.log.slice(base0).filter((e) => e.fn === 'protected-noop');
    const first = writes.slice(0, n0 - T.log.slice(0, base0).filter((e) => e.fn === 'protected-noop').length);
    const row = { scenario: 'WRITE-ABANDON', contract: CONTRACT, holdMs: WRITE_HOLD_MS, outcome, firstWritesSent: first.length, writeServerStatus: first.map((e) => e.status),
      writeDelivered: first.map((e) => !e.undelivered), second, secondWritesSent, totalWritesOverWindow: writes.length,
      serverPending: PENDING, blobInflight: blobs.inflightTotal(), unfinished: unfinished(T),
      otherRequestsDuringHold: T.log.slice(base0).filter((e) => e.fn !== 'protected-noop' && e.t0 >= t0 && e.t0 <= t0 + WRITE_HOLD_MS).map((e) => `${e.fn}:${e.status}`) };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check(`WRITE-ABANDON (isolated; delivery held ${WRITE_HOLD_MS} ms): the first write is sent EXACTLY ONCE and never re-sent automatically; total writes over hold + 5 s = first + only the operator's explicit second attempt; the server-side write settles (0 pending, 0 Blob in flight)${WRITE_DEADLINE_MS ? `; the caller gives up by ${WRITE_DEADLINE_MS} ms (+1 s) with an error (uncertain), not a success` : '; caller outcome RECORDED only'}${(CONTRACT === 'r3' || CONTRACT === 'r4') ? '; r3/r4: the first error is LaneUncertain, the second write is rejected LaneNotSent(uncertain_pending) with 0 requests sent, and a read still answers 200' : ''}`, async () => {
      assert.equal(row.firstWritesSent, 1, JSON.stringify(row));
      assert.equal(row.totalWritesOverWindow, row.firstWritesSent + row.secondWritesSent, 'no automatic re-send ' + JSON.stringify(row));
      assert.equal(row.serverPending, 0); assert.equal(row.blobInflight, 0); assert.equal(row.unfinished, 0);
      if (WRITE_DEADLINE_MS) { assert.equal(outcome.kind, 'error', JSON.stringify(outcome)); assert.ok(outcome.ms <= WRITE_DEADLINE_MS + 1000, JSON.stringify(outcome)); }
      if (CONTRACT === 'r3' || CONTRACT === 'r4') {
        assert.equal(outcome.name, 'LaneUncertain', JSON.stringify(outcome));
        assert.deepEqual([second.write && second.write.name, second.write && second.write.reason, row.secondWritesSent], ['LaneNotSent', 'uncertain_pending', 0], JSON.stringify(second));
        assert.equal(second.read, 200, 'reads proceed while the write hold exists ' + JSON.stringify(second));
      }
    });
    await T.ctx.close();
  }
  }
  if (!ONLY || want('EXPIRED')) {
  // ── EXPIRED / GENERATION: the session is revoked while a queued burst is in progress. Bones (2026-11-17) asked to
  //    SEPARATE (1) the revoke PRECONDITION (did the server-side revoke return verified?) from (2) the AUTHORIZATION
  //    assertion (after the revocation is VERIFIED, nothing is authorized), and to record the exact outcome, timing,
  //    retry/verification path and every request after verification. Neither assertion is weakened: (1) still FAILS on
  //    an unconfirmed revoke; (2) FAILS if verification is never established. The verification path is the test's own:
  //    an unconfirmed revoke is retried (same bytes, idempotent; at most 3 more attempts) and a revocation counts as
  //    VERIFIED only on a "verified" result. A status reply (app-read-session) is classified by what it SAYS, never by
  //    its HTTP 200 alone. ──
  {
    fresh(100); const S = await bindSession(9);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
    const base0 = T.log.length;
    const burstP = T.page.evaluate(async () => { const r = await import('/src/lib/read-session.ts');
      return Promise.all(Array.from({ length: 8 }, () => r.readFetch('/.netlify/functions/ghl-contacts').then((x) => x.status, (e) => 'threw:' + (e && e.name)))); });
    for (let i = 0; i < 200 && !T.log.slice(base0).some((e) => e.status !== undefined); i++) await sleep(10);
    const attempts = [];
    const once = async () => { const t0 = Date.now(); const { out, lines } = await withCheckLog(() => rev.revokeSession(S.sid, S.epoch, 'test', { event: NF }));
      attempts.push({ kind: out.kind, reason: out.reason || null, t0, t1: Date.now(), ms: Date.now() - t0, checkLog: lines.map((l) => ({ op: l.op, kind: l.kind, reason: l.reason, ms: l.ms })) }); return out; };
    const v = await once(); const tRevoked = attempts[0].t1;
    let tVerified = v.kind === 'verified' ? tRevoked : null;
    for (let k = 0; k < 3 && tVerified === null; k++) { const r = await once(); if (r.kind === 'verified') tVerified = attempts[attempts.length - 1].t1; }
    const burst = await burstP; await settleServer();
    // Non-vacuous BY CONSTRUCTION (item 29): with the item 29 fix the revoke absorbs the contention itself and may return
    // after the queued burst has already finished, so "some queued request started after the revoke" is no longer
    // guaranteed by timing. The proof is SERVER-side (the client may itself stop sending after its 401s): the OLD
    // session, presented directly to every protected reader handler after verification, one after another, x2 ->
    // each exactly 401. (Concurrent same-session checks can answer a fail-closed 503 under same-key contention -- the
    // known, pre-existing check behaviour, never a 200; the queued in-page burst above already covers concurrency.)
    await settleServer();
    const g0 = ghlCalls;
    let postBurst = null;
    if (tVerified !== null) { postBurst = []; for (const f of [...PROTECTED_READERS, ...PROTECTED_READERS]) postBurst.push(`${f}:${(await handlerFor(f)(ev({ cookie: S.cookie }))).statusCode}`); }
    const postBurstGhl = ghlCalls - g0;
    await settleServer();
    const serverView = await (async () => { const r = await handlerFor('ghl-contacts')(ev({ cookie: S.cookie })); let reason = null; try { reason = JSON.parse(r.body).reason || null; } catch { /* none */ } return { status: r.statusCode, reason }; })();   // independent: the old session at a real protected reader afterwards
    const describe = (e) => ({ fn: e.fn, status: e.status, t0: e.t0, ...(e.statusSays ? { says: e.statusSays } : {}) });
    const afterFirst = T.log.slice(base0).filter((e) => e.t0 > tRevoked);
    const afterVerified = tVerified === null ? null : T.log.slice(base0).filter((e) => e.t0 > tVerified);
    const authorizedAfter = (list) => list.filter((e) => (e.fn === 'app-read-session' ? !!(e.statusSays && e.statusSays.signedIn) : e.status === 200));
    const row = { scenario: 'EXPIRED', firstRevoke: v.kind, firstReason: v.reason || null, attempts, tRevoked, tVerified, burst, postBurst, postBurstGhl,
      startedAfterFirstRevoke: afterFirst.map(describe), startedAfterVerified: afterVerified && afterVerified.map(describe),
      authorizedAfterFirst: authorizedAfter(afterFirst).map(describe), authorizedAfterVerified: afterVerified && authorizedAfter(afterVerified).map(describe),
      serverViewAfter: serverView, n503: T.log.slice(base0).filter((e) => e.status === 503).length };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('EXPIRED (100 ms) PRECONDITION: the server-side revoke issued while a queued burst is in progress returns VERIFIED on its first attempt (an "unconfirmed" result FAILS here and is reported with its reason and check log)', async () => {
      assert.equal(v.kind, 'verified', JSON.stringify({ first: attempts[0] }));
    });
    await check('EXPIRED (100 ms) AUTHORIZATION: once the revocation is VERIFIED (first attempt, or the recorded retry), every request STARTED afterwards is refused -- no protected reader answers 200 and no status reply says signedIn:true; the OLD session presented directly to every protected reader afterwards (x2, one after another) is refused 401 with zero GHL calls (non-vacuous by construction); the old session is then 401 "revoked" at a real reader; the burst settles; nothing stuck (FAILS if verification is never established)', async () => {
      assert.ok(tVerified !== null, 'revocation never VERIFIED ' + JSON.stringify(attempts.map((x) => [x.kind, x.reason])));
      assert.ok(Array.isArray(postBurst) && postBurst.length === 2 * PROTECTED_READERS.length && postBurst.every((x) => x.endsWith(':401')), 'non-vacuous: every post-verification protected read refused 401 ' + JSON.stringify(postBurst));
      assert.equal(postBurstGhl, 0, 'zero GHL calls for the post-verification reads');
      assert.deepEqual(row.authorizedAfterVerified, [], JSON.stringify(row.startedAfterVerified));
      assert.deepEqual([serverView.status, serverView.reason], [401, 'revoked'], JSON.stringify(serverView));
      assert.equal(unfinished(T), 0); assert.equal(PENDING, 0);
    });
    await T.ctx.close();
  }
  }
  // ── D2 lane rows (Scotty's D2 r4 §6 + r5/r6, design ACCEPTED by Bones 2026-11-17: 07_SCOTTY_D2_r6_DELTA.md sha256
  //    1e524f3c…49b5). End-to-end through the REAL ghl-write + CC r3 session check + the stateful GHL fixture + the
  //    browser. Two kinds of check:
  //      check(...)      PRECONDITIONS and behaviour that hold with or without the lane (asserted on every run);
  //      laneCheck(...)  the lane contract itself -- reported NOT-RUN unless --contract=r6 is given against a client that
  //                      implements the lane. Nothing lane-only is ever printed as PASS on the current client.
  //    Scotty owns the lane-unit / classifier / exact fake-clock rows (P1–P10, P6a–P7′); none are duplicated here. ──
  const C = 'ZyXwVuTsRqPoNmLkJiHg', D = 'DdDdDdDdDdDdDdDdDdDd', O = 'AbCdEfGhIjKlMnOpQrSt';
  const R4 = LANE;
  const LANE_KEY = 'iaosLane.unresolved.v1';
  /** One save through the app's REAL client (ghl.ts → write-command → appWriteFetch → lane), outcome only (never a token). */
  const save = (T, kind, a) => T.page.evaluate(async ({ kind, a }) => {
    const g = (await import('/src/lib/ghl.ts')).ghl; const t = performance.now();
    try {
      if (kind === 'note') await g.notes.create(a.c, a.t);
      else if (kind === 'field') await g.contacts.setLastCallAttempt(a.c, new Date().toISOString());
      else if (kind === 'opp') await g.opportunities.setAskingPrice(a.o, 150000);
      return { kind: 'ok', ms: Math.round(performance.now() - t) };
    } catch (e) { return { kind: 'error', name: String(e && e.name), reason: e && e.reason ? String(e.reason) : null, msg: String(e && e.message).slice(0, 120), ms: Math.round(performance.now() - t) }; }
  }, { kind, a }).catch((e) => ({ kind: 'evaluate_failed', msg: String(e).slice(0, 80) }));
  const laneStore = (T) => T.page.evaluate((k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return 'unparseable'; } }, LANE_KEY).catch(() => 'page_gone');
  const writesTo = (T, from = 0) => T.log.slice(from).filter((e) => e.fn === 'ghl-write').length;
  const recs = (st) => (st && Array.isArray(st.records) ? st.records : []);
  const held = (st, key) => recs(st).filter((r) => r.key === key).length;
  const pending = (x) => x && x.name === 'LaneNotSent' && x.reason === 'uncertain_pending';
  const uncertainOutcome = (x) => x && x.name === 'LaneUncertain';
  const directReader = async (cookie) => { const r = await handlerFor('ghl-contacts')(ev({ cookie })); let reason = null; try { reason = JSON.parse(r.body).reason || null; } catch { /* none */ } return { status: r.statusCode, reason }; };
  /** Sign out through the real UI; a failed click is a FAILED PRECONDITION, never swallowed. --mutation=skip-logout skips it (negative control). */
  const signOutUi = async (T) => {
    if (MUTATION === 'skip-logout') return { clicked: false, mutation: true };
    const n0 = T.log.filter((e) => e.fn === 'app-signout').length;
    try { await T.page.getByRole('button', { name: 'Sign out' }).click({ timeout: 6000 }); } catch (e) { return { clicked: false, error: String(e).slice(0, 100) }; }
    for (let i = 0; i < 200 && !T.log.slice(0).filter((e) => e.fn === 'app-signout').slice(n0).some((e) => e.status !== undefined); i++) await sleep(25);
    const so = T.log.filter((e) => e.fn === 'app-signout').slice(n0);
    return { clicked: true, signoutStatus: so.map((e) => e.status) };
  };
  /** Install the J4 stall. --mutation=bypass-stall leaves the stall OFF (negative control: the stall precondition must then fail). */
  const installStall = (T, s) => (MUTATION === 'bypass-stall' ? Promise.resolve() : T.page.evaluate((x) => { window.__iaosStall = x; }, s));
  const openDash = async (n, { list = true } = {}) => {
    fresh(10); GHL.resetAll(); if (list) GHL.seedList([C, D]); const S = await bindSession(n);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
    return { S, T };
  };
  /** A tab whose first ghl-write response DELIVERY is held past the 20 s write deadline (the origin processes it). */
  const uncertainTab = async (n, firstKind, firstArg) => {
    const { S, T } = await openDash(n);
    T.holdDelivery = { fn: 'ghl-write', ms: WRITE_HOLD_MS, count: 1 };
    const first = await save(T, firstKind, firstArg);
    return { S, T, first };
  };

  // ── J1 reload before timeout, server still pending; decisive sign-out / revocation / replacement-readiness ──
  if (want('J1')) {
    const { S, T } = await openDash(20);
    T.holdServer = { fn: 'ghl-write', ms: WRITE_HOLD_MS, count: 1 };
    const b0 = T.log.length;
    void save(T, 'note', { c: C, t: 'J1 note' });
    for (let i = 0; i < 400 && !T.log.slice(b0).some((e) => e.fn === 'ghl-write'); i++) await sleep(10);
    const firstWrite = T.log.slice(b0).find((e) => e.fn === 'ghl-write');
    const pendingAtReload = !!firstWrite && firstWrite.status === undefined;
    await T.page.reload(); const reRendered = await rendered(T);
    const afterReload = await laneStore(T);
    const w0 = writesTo(T);
    const second = await save(T, 'note', { c: C, t: 'J1 second' });
    const secondWrites = writesTo(T) - w0;
    await sleep(WRITE_HOLD_MS + 2000); await settleServer(10000);
    const firstSettled = !!firstWrite && firstWrite.status !== undefined;
    const afterServer = await laneStore(T);
    const so = await signOutUi(T); await settleServer();
    const oldCookieAfter = await directReader(S.cookie);
    const S2 = await bindSession(21); T.cookie = S2.cookie; await T.page.reload(); const replacementReady = await rendered(T); await settleServer();
    const afterSignInOut = await laneStore(T);
    const w1 = writesTo(T); const third = await save(T, 'note', { c: C, t: 'J1 third' }); const thirdWrites = writesTo(T) - w1;
    await settleServer(30000);
    const row = { scenario: 'J1', contract: CONTRACT, mutation: MUTATION, pendingAtReload, reRendered, firstSettled, afterReload, second, secondWrites, afterServer, signOut: so, oldCookieAfter, replacementReady, afterSignInOut, third, thirdWrites };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('J1 preconditions (decisive): the first write was STILL PENDING on the server at the reload; the page re-rendered; the server write later completed; Sign out was actually clicked and app-signout answered 200; the OLD session is then refused 401 "revoked" at a real reader; the replacement session renders the Dashboard', async () => {
      assert.ok(row.pendingAtReload, 'pending at reload'); assert.ok(row.reRendered, 're-rendered'); assert.ok(row.firstSettled, 'server write settled');
      assert.ok(row.signOut.clicked, 'Sign out clicked ' + JSON.stringify(row.signOut)); assert.deepEqual(row.signOut.signoutStatus, [200], JSON.stringify(row.signOut));
      assert.deepEqual([row.oldCookieAfter.status, row.oldCookieAfter.reason], [401, 'revoked'], JSON.stringify(row.oldCookieAfter));
      assert.ok(row.replacementReady, 'replacement session rendered');
    });
    await laneCheck(`J1 lane: the record is in ${LANE_KEY} after the reload (dispatching|uncertain, contact:C); a same-contact save -> LaneNotSent(uncertain_pending), 0 ghl-write; the record survives the server completing AND the verified sign-out + replacement sign-in, where a same-contact save is still refused with 0 ghl-write`, async () => {
      const r1 = recs(row.afterReload).filter((r) => r.key === `contact:${C}`);
      assert.ok(r1.length === 1 && ['dispatching', 'uncertain'].includes(r1[0].state), JSON.stringify(row.afterReload));
      assert.ok(pending(row.second), JSON.stringify(row.second)); assert.equal(row.secondWrites, 0);
      assert.equal(held(row.afterServer, `contact:${C}`), 1, 'kept after the server completed');
      assert.equal(held(row.afterSignInOut, `contact:${C}`), 1, 'kept across sign-out + sign-in');
      assert.ok(pending(row.third), JSON.stringify(row.third)); assert.equal(row.thirdWrites, 0);
    });
    await T.ctx.close();
  }
  // ── J2 identical pre-existing note does not clear the hold ──
  if (want('J2')) {
    fresh(10); GHL.resetAll(); GHL.notes.push({ id: 'fxn-pre', body: 'J2 identical text', dateAdded: '2026-01-01T00:00:00.000Z', contactId: C });
    const S = await bindSession(22);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
    T.holdDelivery = { fn: 'ghl-write', ms: WRITE_HOLD_MS, count: 1 };
    const first = await save(T, 'note', { c: C, t: 'J2 identical text' });
    const readback = await T.page.evaluate(async (c) => { const g = (await import('/src/lib/ghl.ts')).ghl; try { const r = await g.notes.list(c); return (r.notes || []).map((n) => n.body); } catch (e) { return 'threw:' + (e && e.name); } }, C);
    const st = await laneStore(T); const w0 = writesTo(T);
    const second = await save(T, 'note', { c: C, t: 'J2 other' }); const secondWrites = writesTo(T) - w0;
    await sleep(3000); await settleServer(30000);
    const row = { scenario: 'J2', contract: CONTRACT, first, readback, store: st, second, secondWrites };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('J2 precondition: the readback lists the pre-existing identical text T', async () => {
      assert.ok(Array.isArray(row.readback) && row.readback.includes('J2 identical text'), JSON.stringify(row.readback));
    });
    await laneCheck('J2 lane: a save of T on C times out (LaneUncertain); the record is NOT removed by the identical readback; a save on C -> LaneNotSent(uncertain_pending), 0 ghl-write', async () => {
      assert.ok(uncertainOutcome(row.first), JSON.stringify(row.first));
      assert.equal(held(row.store, `contact:${C}`), 1, JSON.stringify(row.store));
      assert.ok(pending(row.second), JSON.stringify(row.second)); assert.equal(row.secondWrites, 0);
    });
    await T.ctx.close();
  }
  // ── J3 symmetric contact-wide conflict prevention ──
  if (want('J3')) {
    const a = await uncertainTab(23, 'note', { c: C, t: 'J3 note' });
    let w0 = writesTo(a.T); const field = await save(a.T, 'field', { c: C }); const fieldWrites = writesTo(a.T) - w0;
    w0 = writesTo(a.T); const opp = await save(a.T, 'opp', { o: O }); const oppWrites = writesTo(a.T) - w0;
    w0 = writesTo(a.T); const other = await save(a.T, 'note', { c: D, t: 'J3 on D' }); const otherWrites = writesTo(a.T) - w0;
    await sleep(3000); await settleServer(30000); await a.T.ctx.close();
    const b = await uncertainTab(24, 'opp', { o: O });
    w0 = writesTo(b.T); const noteAfterStar = await save(b.T, 'note', { c: C, t: 'J3 after star' }); const noteAfterStarWrites = writesTo(b.T) - w0;
    await sleep(3000); await settleServer(30000); await b.T.ctx.close();
    const row = { scenario: 'J3', contract: CONTRACT, firstContact: a.first, field, fieldWrites, opp, oppWrites, other, otherWrites, firstStar: b.first, noteAfterStar, noteAfterStarWrites };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await laneCheck('J3 lane symmetry: an uncertain contact:C blocks a contact-field save on C and an opportunity ("*") save (uncertain_pending, 0 ghl-write); a save on contact D proceeds (1 ghl-write, ok); an uncertain "*" blocks a note save on C', async () => {
      assert.ok(uncertainOutcome(row.firstContact) && uncertainOutcome(row.firstStar), JSON.stringify([row.firstContact, row.firstStar]));
      assert.ok(pending(row.field) && row.fieldWrites === 0, JSON.stringify(row.field));
      assert.ok(pending(row.opp) && row.oppWrites === 0, JSON.stringify(row.opp));
      assert.deepEqual([row.other.kind, row.otherWrites], ['ok', 1], JSON.stringify(row.other));
      assert.ok(pending(row.noteAfterStar) && row.noteAfterStarWrites === 0, JSON.stringify(row.noteAfterStar));
    });
  }
  // ── J4 deadline with a never-ending body / an abort-ignoring fetch; decisive stall precondition ──
  if (want('J4')) {
    const out = {};
    for (const [fn, mode, label] of [['ghl-write', 'body', 'save, never-ending body'], ['ghl-write', 'abort', 'save, abort-ignoring fetch'], ['ghl-contacts', 'body', 'reader, never-ending body'], ['ghl-contacts', 'abort', 'reader, abort-ignoring fetch']]) {
      const { T } = await openDash(30);
      await installStall(T, { fn, mode });
      const t0 = Date.now(); const w0 = writesTo(T);
      const res = fn === 'ghl-write' ? await Promise.race([save(T, 'note', { c: C, t: 'J4' }), sleep(70000).then(() => ({ kind: 'not_settled_70s' }))])
        : await Promise.race([T.page.evaluate(async () => { const r = await import('/src/lib/read-session.ts'); const t = performance.now(); try { const x = await r.readFetch('/.netlify/functions/ghl-contacts'); await x.text(); return { kind: 'ok', status: x.status, ms: Math.round(performance.now() - t) }; } catch (e) { return { kind: 'error', name: String(e && e.name), ms: Math.round(performance.now() - t) }; } }).catch((e) => ({ kind: 'evaluate_failed', msg: String(e).slice(0, 80) })), sleep(40000).then(() => ({ kind: 'not_settled_40s' }))]);
      const wallMs = Date.now() - t0;
      const stallHits = await T.page.evaluate(() => window.__iaosStallHits || 0).catch(() => null);
      const store = await laneStore(T);
      let follow = null, followWrites = null;
      if (fn === 'ghl-write' && res.kind === 'error') { await T.page.evaluate(() => { window.__iaosStall = null; }).catch(() => {}); const f0 = writesTo(T); follow = await save(T, 'note', { c: C, t: 'J4 follow' }); followWrites = writesTo(T) - f0; }
      out[label] = { ...res, wallMs, stallHits, serverWritesDuringStall: writesTo(T) - w0 - (followWrites || 0), store, follow, followWrites };
      await T.ctx.close();
    }
    const row = { scenario: 'J4', contract: CONTRACT, mutation: MUTATION, out }; RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('J4 precondition (decisive): the injected stall was REACHED in every case (stallHits >= 1) and the stalled request never reached the server (0 ghl-write while stalled)', async () => {
      for (const [label, r] of Object.entries(out)) { assert.ok(r.stallHits >= 1, `${label}: stall not reached ${JSON.stringify(r)}`); if (label.startsWith('save')) assert.equal(r.serverWritesDuringStall, 0, label); }
    });
    await laneCheck('J4 lane: each stalled SAVE settles as dispatched-uncertain (LaneUncertain) within 52 s (+2 s diagnostic tolerance) with its contact:C hold retained and a following same-contact save refused (uncertain_pending, 0 ghl-write); each stalled READ fails safely (error, no hold) within 22 s (+2 s). Exact 22/30/52 s arithmetic is Scotty\'s fake-clock P6a–P7′.', async () => {
      for (const [label, r] of Object.entries(out)) {
        if (label.startsWith('save')) {
          assert.ok(r.kind === 'error' && r.name === 'LaneUncertain' && r.wallMs <= 54000, `${label}: ${JSON.stringify(r)}`);
          assert.equal(held(r.store, `contact:${C}`), 1, `${label}: hold ${JSON.stringify(r.store)}`);
          assert.ok(pending(r.follow) && r.followWrites === 0, `${label}: follow ${JSON.stringify(r.follow)}`);
        } else {
          assert.ok(r.kind === 'error' && r.wallMs <= 24000, `${label}: ${JSON.stringify(r)}`);
          assert.equal(recs(r.store).length, 0, `${label}: a read creates no hold`);
        }
      }
    });
  }
  // ── J5 (corrected, R5-1) healthy note confirmed by the {note:{id}} envelope -> released -> the attempt marker follows ──
  if (want('J5')) {
    const { T } = await openDash(31);
    const res = await save(T, 'note', { c: C, t: 'J5 healthy' });
    const mid = await laneStore(T);
    const res2 = await save(T, 'field', { c: C }); await settleServer();
    const st = await laneStore(T);
    const noteResp = T.log.filter((e) => e.fn === 'ghl-write').map((e) => e.status);
    const row = { scenario: 'J5', contract: CONTRACT, res, mid, res2, store: st, writeStatuses: noteResp, ghlNotes: GHL.notes.map((n) => n.body), cFields: (GHL.contacts.get(C) || {}).customFields || [] };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('J5 healthy: the real ghl-write answers the note with the {note:{id,...}} envelope (200), the note is stored in the fixture, and the following lastCallAttempt write succeeds and lands on contact C', async () => {
      assert.equal(row.res.kind, 'ok', JSON.stringify(row.res)); assert.ok(row.ghlNotes.includes('J5 healthy'));
      assert.equal(row.res2.kind, 'ok', JSON.stringify(row.res2)); assert.deepEqual(row.writeStatuses, [200, 200]); assert.ok(row.cFields.length >= 1, 'attempt fields written');
    });
    await laneCheck(`J5 lane (R5-1): after the confirmed note, ${LANE_KEY} holds NO contact:C record (released on the nested note.id envelope), so the attempt marker was not blocked; no record remains at the end`, async () => {
      assert.equal(held(row.mid, `contact:${C}`), 0, JSON.stringify(row.mid)); assert.equal(recs(row.store).length, 0, JSON.stringify(row.store));
    });
    await T.ctx.close();
  }
  // ── F1 regression: a COMPLETE in-deadline but UNCERTAIN/ambiguous ghl-write response must RETAIN the hold ──
  if (want('F1')) {
    const out = {};
    for (const mode of ['post500', 'noReadback']) {
      const { T } = await openDash(32);
      GHL.failNote = mode;
      const first = await save(T, 'note', { c: C, t: `F1 ${mode}` });
      const firstStatus = (T.log.filter((e) => e.fn === 'ghl-write').slice(-1)[0] || {}).status;
      const st0 = await laneStore(T);
      GHL.failNote = null;
      let w0 = writesTo(T); const sameField = await save(T, 'field', { c: C }); const sameFieldWrites = writesTo(T) - w0;
      w0 = writesTo(T); const star = await save(T, 'opp', { o: O }); const starWrites = writesTo(T) - w0;
      w0 = writesTo(T); const otherC = await save(T, 'note', { c: D, t: 'F1 on D' }); const otherWrites = writesTo(T) - w0;
      await T.page.reload(); await rendered(T); await settleServer();
      const st1 = await laneStore(T);
      w0 = writesTo(T); const afterReload = await save(T, 'note', { c: C, t: 'F1 after reload' }); const afterReloadWrites = writesTo(T) - w0;
      await settleServer(10000);
      out[mode] = { first, firstStatus, st0, sameField, sameFieldWrites, star, starWrites, otherC, otherWrites, st1, afterReload, afterReloadWrites };
      await T.ctx.close();
    }
    const row = { scenario: 'F1', contract: CONTRACT, out }; RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('F1 precondition: the REAL ghl-write answers each fixture fault IN DEADLINE with an uncertain/ambiguous 409 (never 200), and the caller gets an error (not a success)', async () => {
      for (const [mode, r] of Object.entries(out)) { assert.equal(r.firstStatus, 409, `${mode}: ${JSON.stringify(r.first)}`); assert.equal(r.first.kind, 'error', mode); }
    });
    await laneCheck('F1 lane (r5/r6 release rule): the uncertain 409 RETAINS contact:C; same-contact and "*" saves send 0 requests (uncertain_pending) before AND after a reload; contact D proceeds', async () => {
      for (const [mode, r] of Object.entries(out)) {
        assert.equal(held(r.st0, `contact:${C}`), 1, `${mode} st0`); assert.equal(held(r.st1, `contact:${C}`), 1, `${mode} st1`);
        assert.ok(pending(r.sameField) && r.sameFieldWrites === 0, `${mode} same`); assert.ok(pending(r.star) && r.starWrites === 0, `${mode} star`);
        assert.ok(pending(r.afterReload) && r.afterReloadWrites === 0, `${mode} reload`);
        assert.deepEqual([r.otherC.kind, r.otherWrites], ['ok', 1], `${mode} D`);
      }
    });
  }
  // ── J6 / J6′ (R5-2): call-log reservation -> ordinary save -> readback; malformed reservation reply -> "*" retained ──
  if (want('J6')) {
    const out = {};
    for (const variant of ['J6', 'J6prime']) {
      const { T } = await openDash(33);
      if (variant === 'J6prime') T.rewrite = { fn: 'call-log-barrier', count: 1, body: '{"state":"reserved-ish"}' };
      const op = 'j6op' + Math.random().toString(36).slice(2, 14);
      const begin = await T.page.evaluate(async ({ c, op }) => {
        const m = await import('/src/lib/call-log-barrier-client.ts');
        try { const r = await m.beginOperation(c, op, 'No Answer', 'Call (reported by Brad in IAOS): No Answer'); return { kind: 'ok', state: r && r.state }; }
        catch (e) { return { kind: 'error', name: String(e && e.name), reason: e && e.reason ? String(e.reason) : null, msg: String(e && e.message).slice(0, 120) }; }
      }, { c: C, op }).catch((e) => ({ kind: 'evaluate_failed', msg: String(e).slice(0, 80) }));
      const beginEntry = T.log.filter((e) => e.fn === 'call-log-barrier').slice(-1)[0] || {}; const beginStatus = beginEntry.status; const rewritten = !!beginEntry.rewritten; const rewriteLeft = T.rewrite ? T.rewrite.count : null;
      const st0 = await laneStore(T);
      const w0 = writesTo(T); const after = await save(T, 'note', { c: C, t: `${variant} ordinary save` }); const afterWrites = writesTo(T) - w0;
      const readback = await T.page.evaluate(async (c) => { const g = (await import('/src/lib/ghl.ts')).ghl; try { const r = await g.notes.list(c); return (r.notes || []).map((n) => n.body); } catch (e) { return 'threw:' + (e && e.name); } }, C);
      await settleServer(10000);
      out[variant] = { begin, beginStatus, rewritten, rewriteLeft, st0, after, afterWrites, readback };
      await T.ctx.close();
    }
    const row = { scenario: 'J6', contract: CONTRACT, out }; RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('J6 healthy: the REAL call-log-barrier reserves (200 {state:"reserved"}); an ordinary note save then succeeds (1 ghl-write) and the readback lists it', async () => {
      const r = out.J6; assert.deepEqual([r.beginStatus, r.begin.kind, r.begin.state], [200, 'ok', 'reserved'], JSON.stringify(r.begin));
      assert.deepEqual([r.after.kind, r.afterWrites], ['ok', 1], JSON.stringify(r.after)); assert.ok(Array.isArray(r.readback) && r.readback.includes('J6 ordinary save'), JSON.stringify(r.readback));
    });
    await check('J6′ precondition (decisive): the REAL call-log-barrier handled the reservation (200), the malformed body rewrite actually happened and was consumed (count 0), and the client saw the malformed answer (not state "reserved")', async () => {
      const p = out.J6prime; assert.equal(p.beginStatus, 200, JSON.stringify(p)); assert.equal(p.rewritten, true); assert.equal(p.rewriteLeft, 0);
      assert.ok(!(p.begin.kind === 'ok' && p.begin.state === 'reserved'), 'the client consumed the malformed body ' + JSON.stringify(p.begin));
    });
    await laneCheck('J6 lane: a definitively completed reservation releases the transport hold (no record after begin); J6′: a MALFORMED reservation reply (200 {state:"reserved-ish"}) RETAINS "*", and the next save is refused uncertain_pending with 0 ghl-write', async () => {
      assert.equal(recs(out.J6.st0).length, 0, JSON.stringify(out.J6.st0));
      const p = out.J6prime; assert.equal(held(p.st0, '*'), 1, JSON.stringify(p.st0)); assert.ok(pending(p.after) && p.afterWrites === 0, JSON.stringify(p.after));
    });
  }
  // ── D: the RENDERED Dashboard note box (real UI, real readers, one sign-in, real ghl-write, fixture readback) ──
  const noteRow = (T, id) => T.page.locator(`tr:has(a[href$="/contacts/${id}"])`).first();   // the Lead Queue row: its name link
  const noteInput = (T, id) => noteRow(T, id).locator('input[placeholder^="Note"], input[placeholder="Saving…"]').first();
  const typeNote = async (T, id, text) => { const i = noteInput(T, id); try { await i.click({ timeout: 6000 }); await i.fill(text); await i.press('Tab'); return true; } catch (e) { T.typeFailed = String(e).slice(0, 80); return false; } };
  const queueDebug = (T) => T.page.evaluate(() => ({ links: [...document.querySelectorAll('[data-testid="dashboard-contact-link"]')].map((a) => a.getAttribute('data-contact-id')), acct: (document.querySelector('[data-testid="dashboard-lead-queue-accounting"]') || {}).textContent || null, inputs: [...document.querySelectorAll('input')].map((i) => i.placeholder).slice(0, 8) })).catch((e) => String(e).slice(0, 60));
  const rowText = (T, id) => noteRow(T, id).innerText({ timeout: 2000 }).catch(() => '');
  const enableSavingShown = (T) => T.page.getByRole('button', { name: 'Enable saving' }).count().catch(() => -1);
  const waitWrites = async (T, from, n, ms = 15000) => { const t0 = Date.now(); while (writesTo(T, from) < n && Date.now() - t0 < ms) await sleep(25); };
  const writeOps = (T, from) => T.log.slice(from).filter((e) => e.fn === 'ghl-write').map((e) => `${e.op}:${e.status}`);
  if (want('D')) {
    // D1 healthy rendered save, started while the Dashboard is still loading (save during load)
    {
      fresh(10); GHL.resetAll(); GHL.seedList([C, D]); const S = await bindSession(40);
      const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`);
      await noteInput(T, C).waitFor({ timeout: 15000 }).catch(() => {}); await settleServer();
      // Overlap made deterministic: a reader from the app's own read client whose SERVER execution is held 4 s.
      T.holdServer = { fn: 'ghl-mailers', ms: 4000, count: 1 };
      const r0 = T.log.length;
      void T.page.evaluate(async () => { const r = await import('/src/lib/read-session.ts'); try { const x = await r.readFetch('/.netlify/functions/ghl-mailers'); await x.text(); } catch { /* recorded by the server log */ } });
      for (let i = 0; i < 200 && !T.log.slice(r0).some((e) => e.fn === 'ghl-mailers' && e.serverHeldMs); i++) await sleep(10);
      const heldReader = T.log.slice(r0).find((e) => e.fn === 'ghl-mailers' && e.serverHeldMs);
      const b0 = T.log.length;
      const typed = await typeNote(T, C, 'D1 rendered note');
      const loadingWhenTyped = !!heldReader && heldReader.status === undefined;
      await waitWrites(T, b0, 2); await settleServer(10000); await sleep(300);
      const row = { scenario: 'D1', typed, typeFailed: T.typeFailed || null, heldReaderStatus: heldReader ? heldReader.status : 'never', loadingWhenTyped, ops: writeOps(T, b0), mints: T.log.slice(b0).filter((e) => e.fn === 'app-write-token').map((e) => e.status), draft: await noteInput(T, C).inputValue().catch(() => null), text: (await rowText(T, C)).slice(0, 200), enableSaving: await enableSavingShown(T), ghlNotes: GHL.notes.map((n) => n.body), cFields: ((GHL.contacts.get(C) || {}).customFields || []).length, errs: T.errs };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
      await check('D1 rendered Dashboard note save submitted WHILE a reader is provably still pending on the server (decisive overlap): exactly note.create:200 then contact.lastCallAttempt:200; the held reader then answers 200; the fixture holds the note and the attempt fields; the draft clears; no error in the row; no "Enable saving" button; no page error', async () => {
        assert.ok(row.typed && row.loadingWhenTyped, 'overlap precondition: the held reader was pending when the note was submitted ' + JSON.stringify(row));
        assert.equal(row.heldReaderStatus, 200, 'the held reader settled 200');
        assert.deepEqual(row.ops, ['note.create:200', 'contact.lastCallAttempt:200'], JSON.stringify(row.ops));
        assert.ok(row.ghlNotes.includes('D1 rendered note')); assert.ok(row.cFields >= 1); assert.equal(row.draft, '');
        assert.ok(!/couldn't|refused|unconfirmed|Not sent/i.test(row.text), row.text); assert.equal(row.enableSaving, 0); assert.deepEqual(row.errs, []);
      });
      await laneCheck(`D1 lane: no ${LANE_KEY} record remains after the confirmed rendered save`, async () => { assert.equal(recs(await laneStore(T)).length, 0); });
      await T.ctx.close();
    }
    // D2 refused-not-applied (the session is revoked under the open page): the server refuses BEFORE any GHL write; draft kept, error shown, nothing written
    {
      const { S, T } = await openDash(41);
      await revokeSession(S); const g0 = ghlWritesToGhl; const b0 = T.log.length;
      await typeNote(T, C, 'D2 refused draft'); await waitWrites(T, b0, 1, 8000); await settleServer(); await sleep(500);
      const row = { scenario: 'D2', ops: writeOps(T, b0), mints: T.log.slice(b0).filter((e) => e.fn === 'app-write-token').map((e) => e.status), ghlWrites: ghlWritesToGhl - g0, draft: await noteInput(T, C).inputValue().catch(() => null), text: (await rowText(T, C)).slice(0, 200), notice: await T.page.evaluate(() => (document.body.innerText.match(/[^\n]*(sign[ -]?in|signed out|session|refused|not saved)[^\n]*/gi) || []).slice(0, 4)).catch(() => null) };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
      await check('D2 rendered refusal (session revoked under the open page): the write is refused 401 before any GHL write (0 land); the page shows the signed-out notice ("You\'ve signed out" + "Sign in again to continue where you left off."); the typed draft is KEPT in the box; nothing is re-sent automatically', async () => {
        assert.ok(Array.isArray(row.notice) && row.notice.some((t) => t.includes("You've signed out")) && row.notice.some((t) => t.includes('Sign in again to continue where you left off.')), 'visible notice ' + JSON.stringify(row.notice));
        assert.equal(row.ghlWrites, 0); assert.equal(row.draft, 'D2 refused draft', JSON.stringify(row)); assert.deepEqual(row.ops, ['note.create:401'], JSON.stringify(row));
        assert.ok(row.ops.filter((o) => o.startsWith('note.create')).length <= 1, 'no automatic resend');
      });
      await T.ctx.close();
    }
    // D3 dispatched-uncertain (delivery held past the write deadline): no blind resend, draft kept, the attempt marker is not written
    {
      const { T } = await openDash(42);
      T.holdDelivery = { fn: 'ghl-write', ms: WRITE_HOLD_MS, count: 1 };
      const b0 = T.log.length; await typeNote(T, C, 'D3 uncertain draft');
      await sleep(WRITE_HOLD_MS + 4000); await settleServer(10000); await sleep(500);
      const st = await laneStore(T);
      const ui = await noteRow(T, C).evaluate((tr) => { const errs = [...tr.querySelectorAll('div')].filter((d) => getComputedStyle(d).color === 'rgb(248, 113, 113)' && d.textContent.trim()).map((d) => d.textContent.trim()); const i = tr.querySelector('input[placeholder]'); return { errs, disabled: i ? i.disabled : null, placeholder: i ? i.placeholder : null }; }).catch((e) => ({ failed: String(e).slice(0, 60) }));
      const row = { scenario: 'D3', ops: writeOps(T, b0), draft: await noteInput(T, C).inputValue().catch(() => null), ui, store: st };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
      await check('D3 rendered uncertain save: the note is sent EXACTLY once and never re-sent automatically over hold + 4 s (recorded: what the current client shows)', async () => {
        assert.equal(row.ops.filter((o) => o.startsWith('note.create')).length, 1, JSON.stringify(row.ops));
      });
      await laneCheck('D3 lane: the save ends uncertain within the 20 s write deadline -- the row shows an error, the typed draft is KEPT, NO attempt-marker write is sent, and contact:C is held', async () => {
        assert.equal(row.draft, 'D3 uncertain draft'); assert.ok(row.ui.errs && row.ui.errs.length === 1, 'an actual error message in the row ' + JSON.stringify(row.ui)); assert.equal(row.ui.disabled, false, 'settled: input re-enabled'); assert.ok(!row.ops.some((o) => o.startsWith('contact.lastCallAttempt')), JSON.stringify(row.ops));
        assert.equal(held(row.store, `contact:${C}`), 1);
      });
      await T.ctx.close();
    }
    // D4 queued save cancelled by Sign out: a reader is held so the save must QUEUE behind it (lane), then Sign out
    {
      const { S, T } = await openDash(43);
      T.holdServer = { fn: 'ghl-contacts', ms: 6000, count: 1 };
      const r0 = T.log.length;
      void T.page.evaluate(async () => { const r = await import('/src/lib/read-session.ts'); try { await r.readFetch('/.netlify/functions/ghl-contacts'); } catch { /* recorded by server log */ } });
      for (let i = 0; i < 200 && !T.log.slice(r0).some((e) => e.fn === 'ghl-contacts' && e.serverHeldMs); i++) await sleep(10);
      const heldReader = T.log.slice(r0).find((e) => e.fn === 'ghl-contacts' && e.serverHeldMs);
      const b0 = T.log.length; const g0 = ghlWritesToGhl;
      const typed = await typeNote(T, C, 'D4 queued draft');
      const submitted = await noteInput(T, C).evaluate((i) => i.disabled || i.placeholder === 'Saving…').catch(() => false);   // the row entered its saving state
      const atSignOut = { readerPending: !!heldReader && heldReader.status === undefined, writesDispatched: writesTo(T, b0) };
      const so = await signOutUi(T); await sleep(7000); await settleServer(10000);
      const row = { scenario: 'D4', typed, submitted, atSignOut, signOut: so, ops: writeOps(T, b0), ghlWrites: ghlWritesToGhl - g0, oldCookieAfter: await directReader(S.cookie) };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
      await check('D4 preconditions (decisive): the held reader was REACHED and still pending on the server at the moment of Sign out; the note was typed and the row entered its saving state (a real UI submission); Sign out clicked and confirmed (app-signout 200); the old session then refused 401 "revoked"', async () => {
        assert.ok(row.typed && row.submitted, 'UI submission ' + JSON.stringify(row)); assert.ok(row.atSignOut.readerPending, 'held reader pending at Sign out ' + JSON.stringify(row.atSignOut));
        assert.ok(row.signOut.clicked, JSON.stringify(row.signOut)); assert.deepEqual(row.signOut.signoutStatus, [200]);
        assert.deepEqual([row.oldCookieAfter.status, row.oldCookieAfter.reason], [401, 'revoked']);
      });
      await laneCheck('D4 lane: the save was QUEUED (0 ghl-write dispatched at the moment of Sign out) behind the held reader, and Sign out cancels it -- 0 ghl-write requests are ever sent and 0 GHL writes land', async () => {
        assert.equal(row.atSignOut.writesDispatched, 0, 'queued, not dispatched, at Sign out');
        assert.equal(row.ops.length, 0, JSON.stringify(row.ops)); assert.equal(row.ghlWrites, 0);
      });
      await T.ctx.close();
    }
    // D5 session replacement: a save whose server execution is held; Sign out; new session; the OLD completion must not
    //    alter the new session's row (draft / error) and the new session needs no second sign-in
    {
      const { S, T } = await openDash(44);
      T.holdServer = { fn: 'ghl-write', ms: 8000, count: 1 };
      const b0 = T.log.length; await typeNote(T, C, 'D5 old-session note'); await sleep(500);
      const so = await signOutUi(T);
      const S2 = await bindSession(45); T.cookie = S2.cookie; await T.page.reload(); const ready = await rendered(T);
      await noteInput(T, C).fill('D5 new-session draft').catch(() => {});
      await sleep(9000); await settleServer(10000); await sleep(300);
      const row = { scenario: 'D5', signOut: so, ready, ops: writeOps(T, b0), newDraft: await noteInput(T, C).inputValue().catch(() => null), text: (await rowText(T, C)).slice(0, 200), enableSaving: await enableSavingShown(T), oldCookieAfter: await directReader(S.cookie) };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
      await check('D5 session replacement: Sign out confirmed and the old session revoked; the replacement session renders with no "Enable saving"; the OLD session\'s late completion does not touch the new session\'s draft or row', async () => {
        assert.ok(row.signOut.clicked); assert.deepEqual(row.signOut.signoutStatus, [200]); assert.deepEqual([row.oldCookieAfter.status, row.oldCookieAfter.reason], [401, 'revoked']);
        assert.ok(row.ready); assert.equal(row.enableSaving, 0); assert.equal(row.newDraft, 'D5 new-session draft');
        assert.ok(!/D5 old-session note/.test(row.text), row.text);
      });
      await T.ctx.close();
    }
  }
  // ── D6 / SC3 (Bones I1): LIVE-PAGE stale-completion isolation, NO reload. A save is DISPATCHED and processed by the
  //    server; only its response DELIVERY is held. The SAME operator's session is then replaced in the open page --
  //    (status) the page's own status check (focus) sees a new session tag, or (popup) after a revoke the page's sign-in
  //    popup posts "iaos-app-read-signed-in" -- and only then is the old success / error response released. The old
  //    caller continuation must not clear or alter the new session's drafts/UI and must not issue its follow-on
  //    marker. --mutation=no-replace skips the replacement (negative control: the lane assertions must then FAIL,
  //    because the old continuation legitimately completes). Preconditions are asserted on every run. ──
  const redErrors = (T, id) => noteRow(T, id).evaluate((tr) => [...tr.querySelectorAll('div')].filter((d) => getComputedStyle(d).color === 'rgb(248, 113, 113)' && d.textContent.trim()).map((d) => d.textContent.trim())).catch(() => null);
  if (want('D6')) {
    /* Triggers as agreed with Scotty (Relay/direct 2026-11-17):
       STATUS: the replacement (a new same-operator session tag) is QUEUED behind the held save -- the status check
         cannot pre-empt it. So the old answer lands first and its OWN result is legitimate (success clears the C draft;
         an old 409 shows its error truthfully). What is stale is the FOLLOW-ON: the queued status answer is applied
         before the lastCallAttempt is dispatched, so that follow-on must never be sent.
       POPUP: the 1-day session reminder's Log In Again falls due WHILE the save is out (page clock), the relogin popup
         posts "iaos-app-read-signed-in", THEN the old answer is released. The old continuation must change nothing. */
    const out = {};
    const ONE_DAY = 24 * 3600 * 1000;
    for (const [via, outcome] of [['status', 'success'], ['status', 'error'], ['popup', 'success'], ['popup', 'error']]) {
      const label = `${via}/${outcome}`;
      fresh(10); GHL.resetAll(); GHL.seedList([C, D]); const S = await bindSession(46);
      const T = await openTab(S.cookie);
      if (via === 'popup') {
        await T.page.clock.install();
        const expiresAt = new Date(Date.now() + ONE_DAY + 8000).toISOString();
        T.patchJson = { fn: 'app-read-session', patch: (b) => (b && b.signedIn ? { ...b, expiresAt } : b) };
      }
      await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
      let laterShown = false;
      if (via === 'popup') {
        await T.page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
        laterShown = await T.page.getByTestId('session-reminder-later').click({ timeout: 8000 }).then(() => true).catch(() => false);
        await settleServer();
      }
      if (outcome === 'error') GHL.failNote = 'post500';
      const HOLD = via === 'popup' ? 15000 : 9000; T.holdDelivery = { fn: 'ghl-write', ms: HOLD, count: 1 };
      const b0 = T.log.length;
      const typed = await typeNote(T, C, 'D6 old-session note');
      for (let i = 0; i < 1500 && !T.log.slice(b0).some((e) => e.fn === 'ghl-write' && e.status !== undefined); i++) await sleep(10);
      const oldWrite = T.log.slice(b0).find((e) => e.fn === 'ghl-write');
      const processedBeforeReplace = !!oldWrite && oldWrite.status !== undefined && oldWrite.deliveredAt === undefined;
      const tRep = Date.now(); const s0 = T.log.length;
      const rep = { skipped: MUTATION === 'no-replace' };
      if (!rep.skipped) {
        const S2 = await bindSession(47); T.cookie = S2.cookie;   // the session object is never logged
        if (via === 'status') {
          await T.page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
        } else {
          await T.page.clock.fastForward(9000);
          rep.reminder = await T.page.getByTestId('session-reminder-log-in').click({ timeout: 8000 }).then(() => true).catch(() => false);
          const signIn = T.page.getByTestId('one-login-sign-in');
          const [pop] = await Promise.all([T.ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), signIn.click({ timeout: 8000 }).catch(() => null)]);
          if (pop) { await pop.waitForLoadState('domcontentloaded').catch(() => {}); rep.posted = await pop.evaluate(() => { window.opener.postMessage({ type: 'iaos-app-read-signed-in' }, location.origin); return true; }).catch(() => false); }
          rep.postedAt = Date.now();
        }
      }
      if (via === 'status') await noteInput(T, D).fill('D6 new-session draft', { timeout: 4000 }).catch(() => {});
      GHL.failNote = null;
      await sleep(HOLD + 4000); await settleServer(10000); await sleep(500);
      const afterRelease = T.log.slice(b0).filter((e) => oldWrite && e !== oldWrite);
      const statusAfter = T.log.slice(s0).filter((e) => e.fn === 'app-read-session' && e.status === 200);
      const row = { scenario: 'D6', variant: label, mutation: MUTATION, typed, laterShown, oldWriteStatus: oldWrite && oldWrite.status, processedBeforeReplace,
        deliveredAfterReplace: !!oldWrite && oldWrite.deliveredAt >= tRep, postedBeforeRelease: via !== 'popup' || rep.skipped || (!!rep.postedAt && !!oldWrite && rep.postedAt < oldWrite.deliveredAt),
        replacement: rep, statusAnsweredAfter: statusAfter.length,
        followOn: afterRelease.filter((e) => e.fn === 'ghl-write').map((e) => `${e.op}:${e.status}`),
        cDraftAfter: await noteInput(T, C).inputValue().catch(() => null), dDraftAfter: via === 'status' ? await noteInput(T, D).inputValue().catch(() => null) : null,
        cInput: await noteRow(T, C).evaluate((tr) => { const i = tr.querySelector('input[placeholder]'); return i ? { disabled: i.disabled, placeholder: i.placeholder } : null; }).catch(() => null),
        cErrors: await redErrors(T, C), dErrors: await redErrors(T, D), errs: T.errs };
      out[label] = row; RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
      await T.ctx.close();
    }
    await check('D6 preconditions (decisive, every variant): the old save was DISPATCHED and PROCESSED by the server while its response was undelivered; the replacement step ran in the OPEN page with no reload; status path: a status answer under the new session followed; popup path: the 5-day reminder was dismissed, the 1-day reminder Log In Again and the relogin sign-in opened the popup, which POSTED its message BEFORE the old answer was released', async () => {
      for (const [label, r] of Object.entries(out)) {
        assert.ok(r.typed && r.processedBeforeReplace && r.deliveredAfterReplace, `${label}: ordering ${JSON.stringify(r)}`);
        if (r.replacement.skipped) continue;
        if (label.startsWith('status')) assert.ok(r.statusAnsweredAfter >= 1, `${label}: no status answer after the replacement`);
        else assert.ok(r.laterShown && r.replacement.reminder && r.replacement.posted && r.postedBeforeRelease, `${label}: popup ${JSON.stringify(r.replacement)}`);
      }
    });
    await laneCheck('D6 lane (I1, live page): status path -- the old answer\'s own result is kept truthfully (success: C draft cleared, no red text; 409: its error shown, C draft kept) but its FOLLOW-ON lastCallAttempt is never sent, and the new session\'s D draft is unchanged; popup path -- the released old success or 409 changes NOTHING (C draft kept, no red text, 0 further ghl-write); both paths: the C note box is editable again with its normal placeholder', async () => {
      for (const [label, r] of Object.entries(out)) {
        assert.deepEqual(r.followOn, [], `${label}: follow-on ${JSON.stringify(r.followOn)}`);
        assert.deepEqual(r.cInput, { disabled: false, placeholder: 'Note (any text = attempted)…' }, `${label}: marker ${JSON.stringify(r.cInput)}`);
        assert.equal((r.dErrors || []).length, 0, `${label}: D ${JSON.stringify(r.dErrors)}`);
        if (label === 'status/success') { assert.equal(r.cDraftAfter, ''); assert.equal((r.cErrors || []).length, 0, JSON.stringify(r.cErrors)); }
        if (label === 'status/error') { assert.equal(r.cDraftAfter, 'D6 old-session note'); assert.equal((r.cErrors || []).length, 1, JSON.stringify(r.cErrors)); }
        if (label.startsWith('status')) assert.equal(r.dDraftAfter, 'D6 new-session draft');
        if (label.startsWith('popup')) { assert.equal(r.cDraftAfter, 'D6 old-session note', label); assert.equal((r.cErrors || []).length, 0, `${label}: ${JSON.stringify(r.cErrors)}`); }
      }
    });
  }
  if (want('SC3')) {
    const T0 = cfg.getConfig('test'); const prevScs = T0.sellerConversationSave; T0.sellerConversationSave = cfg.SELLER_CONVERSATION_SAVE_ENABLED;
    try {
      fresh(10); GHL.resetAll(); fx.reset(); GHL.fx = true; const S = await bindSession(52);
      const T = await openTab(S.cookie, { fxReaders: true, initOverride: { sellerConversationSave: true, oneLogin: true } });
      T.holdDelivery = { fn: 'ghl-write', ms: 9000, count: 1 };
      await T.page.goto(`${base}/scripts/harness/app-routes/index.html?start=${encodeURIComponent(`/contacts/${fx.CONTACT}/seller-call`)}`);
      const ok = await T.page.getByTestId('sc-card').waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
      await T.page.getByTestId('sc-readiness-status').waitFor({ timeout: 30000 }).catch(() => {}); await sleep(300);
      const tid = (id) => T.page.getByTestId(id);
      const press = async (id) => { try { await tid(id).click({ timeout: 4000 }); return true; } catch { return false; } };
      const fill = async (id, v) => { try { await tid(id).fill(v, { timeout: 4000 }); return true; } catch { return false; } };
      await press('sc-nav-opening'); await fill('sc-field-opening-response', 'Open to talking');
      await press('sc-nav-occupancy'); await tid('sc-field-occupancy-occupancy').selectOption('Tenant Occupied').catch(() => {});
      await press('sc-nav-timing'); await fill('sc-field-timing-timing', 'Close by March 1');
      await fill('sc-call-notes', 'SC3 old-session call.'); await press('sc-nav-summary');
      const b0 = T.log.length; await press('sc-save');
      for (let i = 0; i < 1500 && !T.log.slice(b0).some((e) => e.fn === 'ghl-write' && e.status !== undefined); i++) await sleep(10);
      const oldWrite = T.log.slice(b0).find((e) => e.fn === 'ghl-write'); const tRep = Date.now();
      const processedBeforeReplace = !!oldWrite && oldWrite.status !== undefined && oldWrite.deliveredAt === undefined;
      const s0 = T.log.length; let rep = { skipped: MUTATION === 'no-replace' };
      if (!rep.skipped) { const S2 = await bindSession(53); T.cookie = S2.cookie; await T.page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); }
      await fill('sc-call-notes', 'SC3 new-session notes.');
      const w1 = T.log.length;
      await sleep(12000); await settleServer(10000); await sleep(500);
      const results = await T.page.locator('[data-testid="sc-save-plan"] > li').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid').replace('sc-save-item-', ''), e.getAttribute('data-result')])).catch(() => null);
      const row = { scenario: 'SC3', mutation: MUTATION, ok, processedBeforeReplace, deliveredAfterReplace: !!oldWrite && oldWrite.deliveredAt >= tRep, replacement: rep,
        laterWrites: T.log.slice(w1).filter((e) => e.fn === 'ghl-write' && e !== oldWrite).map((e) => `${e.op}:${e.status}`), statusAnsweredAfter: T.log.slice(s0).filter((e) => e.fn === 'app-read-session' && e.status === 200).length, notesAfter: await tid('sc-call-notes').inputValue().catch(() => null), results, errs: T.errs };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
      await check('SC3 preconditions (decisive): the first Save-at-Summary item was dispatched and processed while its response was undelivered at the same-operator replacement (status path, NO reload); a status answer under the new session followed (it is queued behind the held item); the old response was released afterwards', async () => {
        assert.ok(row.ok && row.processedBeforeReplace && row.deliveredAfterReplace, JSON.stringify(row)); if (!row.replacement.skipped) assert.ok(row.statusAnsweredAfter >= 1, 'a status answer under the new session followed');
      });
      await laneCheck('SC3 lane (I1, Seller Call continuation): the queued replacement is applied before the next item -- the OLD Save-at-Summary continuation sends NO further item writes, and the new session\'s call-notes draft is unchanged', async () => {
        assert.deepEqual(row.laterWrites, [], JSON.stringify(row.laterWrites)); assert.equal(row.notesAfter, 'SC3 new-session notes.');
      });
      await T.ctx.close();
    } finally { T0.sellerConversationSave = prevScs; GHL.fx = false; }
  }
  // ── SC: the RENDERED Seller Call "Save at Summary" (real App route, one sign-in, real ghl-write) ──
  //    Readers are answered at FUNCTION level by scripts/harness/seller-call-offer-ready-fixture.cjs (as in the
  //    accepted rendered Seller Call suite); ghl-write's own GHL reads and writes go to the SAME fixture state, so the
  //    page's readback sees exactly what the real handler wrote. sellerConversationSave is switched ON IN THIS PROCESS
  //    ONLY (server) and in the harness projection (browser); the committed configuration is unchanged.
  if (want('SC')) {
    const T0 = cfg.getConfig('test'); const prevScs = T0.sellerConversationSave; T0.sellerConversationSave = cfg.SELLER_CONVERSATION_SAVE_ENABLED;
    try {
      const SC_PAGE = '/scripts/harness/app-routes/index.html';
      const scOpen = async (n, hold = null) => {
        fresh(10); GHL.resetAll(); fx.reset(); GHL.fx = true; const S = await bindSession(n);
        const T = await openTab(S.cookie, { fxReaders: true, initOverride: { sellerConversationSave: true, oneLogin: true } });
        if (hold) T.holdDelivery = hold;
        await T.page.goto(`${base}${SC_PAGE}?start=${encodeURIComponent(`/contacts/${fx.CONTACT}/seller-call`)}`);
        const ok = await T.page.getByTestId('sc-card').waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
        await T.page.getByTestId('sc-readiness-status').waitFor({ timeout: 30000 }).catch(() => {});
        await sleep(300); return { S, T, ok };
      };
      const tid = (T, id) => T.page.getByTestId(id);
      const press = async (T, id) => { try { await tid(T, id).click({ timeout: 4000 }); return true; } catch { return false; } };
      const fill = async (T, id, v) => { try { await tid(T, id).fill(v, { timeout: 4000 }); return true; } catch { return false; } };
      const typeCall = async (T) => {
        await press(T, 'sc-nav-opening'); await fill(T, 'sc-field-opening-response', 'Open to talking');
        await press(T, 'sc-nav-occupancy'); await tid(T, 'sc-field-occupancy-occupancy').selectOption('Tenant Occupied').catch(() => {});
        await press(T, 'sc-nav-timing'); await fill(T, 'sc-field-timing-timing', 'Close by March 1');
        await press(T, 'sc-nav-price'); await fill(T, 'sc-field-price-amount', '410000');
        await fill(T, 'sc-call-notes', 'SC one-login rendered call.');
        await press(T, 'sc-nav-summary');
      };
      const items = async (T) => T.page.locator('[data-testid="sc-save-plan"] > li').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid').replace('sc-save-item-', ''), e.getAttribute('data-result')])).catch(() => null);
      const waitIdle = async (T, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await tid(T, 'sc-save').textContent().catch(() => '')) === 'Save') return; await sleep(100); } };
      // SC1 healthy
      {
        const { T, ok } = await scOpen(50);
        await typeCall(T); const plan = await items(T);
        const n0 = fx.state.notes.length; const b0 = T.log.length;
        await press(T, 'sc-save'); await waitIdle(T); await settleServer(10000); await sleep(300);
        const res = await items(T);
        const created = fx.state.notes.slice(n0).map((x) => x.body.split('\n')[0]);
        const occ = fx.state.contactFields.filter((f) => f.id === cfg.getConfig('test').fields.occupancyStatus).map((f) => f.value);
        const b1 = T.log.length; await press(T, 'sc-save'); await sleep(1500); await settleServer();
        const row = { scenario: 'SC1', ok, plan, ops: writeOps(T, b0).slice(0, writesTo(T, b0) - writesTo(T, b1)), results: res, created, occupancy: occ, resaveOps: writeOps(T, b1), notes: await tid(T, 'sc-call-notes').inputValue().catch(() => null), enableSaving: await enableSavingShown(T), errs: T.errs };
        RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
        await check('SC1 rendered Seller Call Save at Summary (one sign-in, REAL ghl-write): every planned item (note, timing, price, occupancy) confirmed by the real handler -- exactly note.create x3 + contact.occupancy, all 200; the fixture readback holds the new conversation / assumptions / price-position notes and occupancy "Tenant Occupied"; the call notes draft stays on screen; a second Save sends nothing; no "Enable saving"; no page error', async () => {
          assert.ok(row.ok, 'Seller Call rendered'); assert.ok(Array.isArray(row.results) && row.results.length > 0 && row.results.every(([, r]) => r === 'confirmed'), JSON.stringify(row.results));
          assert.ok(row.ops.length > 0 && row.ops.every((o) => o.endsWith(':200')), JSON.stringify(row.ops));
          assert.deepEqual(row.created, ['IAOS SELLER CONVERSATION — iaos-seller-conversation-v1', 'IAOS TRANSACTION ASSUMPTIONS — iaos-transaction-assumptions-v2', 'IAOS SELLER PRICE POSITION — iaos-seller-price-position-v1'], JSON.stringify(row.created));
          assert.deepEqual(row.ops, ['note.create:200', 'note.create:200', 'note.create:200', 'contact.occupancy:200'], 'exactly the expected writes');
          assert.equal(JSON.stringify(row.occupancy).includes('Tenant Occupied'), true, 'occupancy readback ' + JSON.stringify(row.occupancy));
          assert.equal(row.resaveOps.length, 0, JSON.stringify(row.resaveOps)); assert.equal(row.notes, 'SC one-login rendered call.'); assert.equal(row.enableSaving, 0); assert.deepEqual(row.errs, []);
        });
        await laneCheck(`SC1 lane: no ${LANE_KEY} record remains after the confirmed Save at Summary`, async () => { assert.equal(recs(await laneStore(T)).length, 0); });
        await T.ctx.close();
      }
      // SC2 dispatched-uncertain first item: delivery held past the write deadline
      {
        const { T, ok } = await scOpen(51, { fn: 'ghl-write', ms: WRITE_HOLD_MS, count: 1 }); T.dupArmed = true;
        await typeCall(T); const b0 = T.log.length;
        await press(T, 'sc-save'); await sleep(WRITE_HOLD_MS + 5000); await waitIdle(T, 30000); await settleServer(10000);
        const res = await items(T); const st = await laneStore(T);
        const texts = []; for (const [id] of (res || [])) texts.push(await tid(T, `sc-save-text-${id}`).textContent({ timeout: 500 }).catch(() => null));
        const sent = T.log.slice(b0).filter((e) => e.fn === 'ghl-write');
        const row = { scenario: 'SC2', ok, mutation: MUTATION, ops: writeOps(T, b0), requestIds: sent.map((e) => e.requestId), payloads: sent.map((e) => e.payload), results: res, texts, notes: await tid(T, 'sc-call-notes').inputValue().catch(() => null), store: st };
        RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
        await check('SC2 rendered uncertain first item: the plan holds exactly the four items (note, timing, price, occupancy); every write carries a request id and NO request id or payload is sent twice (at most one send per item; --mutation=dup-send must FAIL this); the call notes draft stays on screen', async () => {
          assert.ok(row.ok); assert.deepEqual((row.results || []).map(([id]) => id), ['note', 'timing', 'price', 'occupancy'], 'exactly the four planned items');
          assert.ok(row.requestIds.length >= 1 && row.requestIds.every(Boolean), 'every write carries a request id ' + JSON.stringify(row.requestIds));
          assert.equal(new Set(row.requestIds).size, row.requestIds.length, 'no request id sent twice ' + JSON.stringify(row.requestIds));
          assert.equal(new Set(row.payloads).size, row.payloads.length, 'no payload sent twice ' + JSON.stringify(row.payloads));
          assert.ok(row.requestIds.length <= 4, 'at most one send per planned item'); assert.equal(row.notes, 'SC one-login rendered call.');
        });
        await laneCheck('SC2 lane: the first item ends data-result "uncertain" at the 20 s write deadline, contact:<fixture contact> is held, and NO later item is sent -- each later item shows data-result "refused" with a message including uncertain_pending (Scotty flags A/B: LaneNotSent maps to refused); drafts kept', async () => {
          assert.equal(row.ops.length, 1, JSON.stringify(row.ops)); assert.equal(held(row.store, `contact:${fx.CONTACT}`), 1);
          assert.ok(row.results && row.results[0] && row.results[0][1] === 'uncertain', JSON.stringify(row.results));
          assert.equal(row.results.length, 4); assert.equal(row.texts.length, 4);
          assert.ok(row.results.slice(1).every(([, x]) => x === 'refused') && row.texts.slice(1).every((t) => typeof t === 'string' && t.includes('uncertain_pending')), JSON.stringify([row.results, row.texts]));
        });
        await T.ctx.close();
      }
    } finally { T0.sellerConversationSave = prevScs; GHL.fx = false; }
  }
  // ── EXPIRY vs REVOCATION (direct, real handlers): two different refusals ──
  await check('EXPIRY vs REVOCATION: a TIME-EXPIRED session (cookie issued 31 days ago) is refused 401 at the cookie, before any session-store access, with no "revoked" reason; a REVOKED session is refused 401 with reason "revoked" after the store check; both with zero GHL', async () => {
    fresh(0); const S = await bindSession(14);
    const expired = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now() - 31 * 24 * 3600 * 1000, S.sid, S.epoch, { aetag: S.aetag, setag: S.setag }).token;
    const b0 = blobs.log.length; ghlCalls = 0;
    const e = await handlerFor('ghl-contacts')(ev({ cookie: expired }));
    const eb = JSON.parse(e.body);
    assert.deepEqual([e.statusCode, ghlCalls, blobs.log.length - b0], [401, 0, 0], 'expired: 401, 0 GHL, 0 store requests ' + e.body);
    assert.notEqual(eb.reason, 'revoked', 'expiry is not reported as revocation');
    assert.equal((await rev.revokeSession(S.sid, S.epoch, 'test', { event: NF })).kind, 'verified');
    const b1 = blobs.log.length; ghlCalls = 0;
    const r = await handlerFor('ghl-contacts')(ev({ cookie: S.cookie }));
    assert.deepEqual([r.statusCode, JSON.parse(r.body).reason, ghlCalls], [401, 'revoked', 0], r.body);
    assert.ok(blobs.log.length - b1 >= 1, 'revocation is decided by the session-store check');
    RESULTS.push({ scenario: 'EXPIRY-vs-REVOKED', expired: { status: e.statusCode, by: eb.by, reason: eb.reason || null }, revoked: { status: r.statusCode, reason: JSON.parse(r.body).reason } });
  });
  // ── SAVE (direct, real handlers): the saving token authorizes a write; malformed refused ──
  await check('SAVE (direct; the no-op authorization transport -- NOT a persisted business save): a signed-in operator mints a saving token (200, never printed) and the protected writer answers 200 {ok:true,sent:false}; a malformed body -> 400 malformed', async () => {
    fresh(0); const S = await bindSession(3);
    const mint = await handlerFor('app-write-token')(ev({ method: 'POST', cookie: S.cookie, headers: { 'x-iaos-session': 'saving-token' } }));
    assert.equal(mint.statusCode, 200, 'mint status');
    const tok = JSON.parse(mint.body).token; assert.ok(typeof tok === 'string' && tok.split('.').length === 3, 'token shape');
    const w = await handlerFor('protected-noop')(ev({ method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: '{"probe":"a6"}' }));
    assert.deepEqual([w.statusCode, JSON.parse(w.body)], [200, { ok: true, sent: false }]);
    const m = await handlerFor('protected-noop')(ev({ method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: '{"probe":"x"}' }));
    assert.deepEqual([m.statusCode, JSON.parse(m.body)], [400, { error: 'malformed' }]);
  });
  // ── DENY (direct, real handlers): refusals before any GHL request ──
  await check('DENY: no cookie / tampered cookie / revoked session / a LEGACY read cookie under One Login ON -> every protected reader 401 with ZERO GHL upstream calls', async () => {
    fresh(0); const S = await bindSession(4);
    const legacy = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token;
    const tampered = S.cookie.slice(0, -2) + (S.cookie.endsWith('A') ? 'BB' : 'AA');
    const rows = [];
    for (const [label, cookie] of [['no cookie', null], ['tampered', tampered], ['legacy (pre-One-Login) cookie', legacy]]) {
      for (const f of PROTECTED_READERS) { ghlCalls = 0; const r = await handlerFor(f)(ev({ cookie })); rows.push([label, f, r.statusCode, ghlCalls]); }
    }
    assert.equal((await rev.revokeSession(S.sid, S.epoch, 'test', { event: NF })).kind, 'verified');
    for (const f of PROTECTED_READERS) { ghlCalls = 0; const r = await handlerFor(f)(ev({ cookie: S.cookie })); rows.push(['revoked', f, r.statusCode, ghlCalls]); }
    RESULTS.push({ scenario: 'DENY', rows }); console.log('RESULT ' + JSON.stringify({ scenario: 'DENY', rows }));
    assert.deepEqual(rows.filter(([, , st, g]) => st !== 401 || g !== 0), [], 'every refusal 401 with 0 GHL');
  });
  await check('DENY: after a verified sign-out the session cannot mint a saving token (401); a writer request without a token -> exact 401 {"error":"Application write sign-in required"}', async () => {
    fresh(0); const S = await bindSession(5);
    assert.equal((await rev.revokeSession(S.sid, S.epoch, 'test', { event: NF })).kind, 'verified');
    const mint = await handlerFor('app-write-token')(ev({ method: 'POST', cookie: S.cookie, headers: { 'x-iaos-session': 'saving-token' } }));
    assert.equal(mint.statusCode, 401, mint.body); assert.ok(!/eyJ/.test(mint.body), 'no token-shaped value');
    const w = await handlerFor('protected-noop')(ev({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"probe":"a6"}' }));
    assert.equal(w.statusCode, 401); assert.equal(JSON.parse(w.body).error, 'Application write sign-in required');
  });

  await browser.close(); await server.close();
  const byL = LATENCIES.map((L) => { const rs = RESULTS.filter((r) => r.scenario === `T-L${L}`); return { latencyMs: L, runs: rs.length, runsWith503: rs.filter((r) => r.n503 > 0).length, total503: rs.reduce((a, r) => a + r.n503, 0) }; });
  console.log('SUMMARY ' + JSON.stringify({ singleTab: byL }));
  console.log(`B15-29 one-operator single-tab Dashboard: ${checks - failures}/${checks} checks passed; ${notRun} lane checks NOT-RUN${LANE ? '' : ' (no --contract)'}${MUTATION ? `; MUTATION=${MUTATION}` : ''}${ONLY ? `; ONLY=${ONLY}` : ''}`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e && e.stack); process.exit(2); });
