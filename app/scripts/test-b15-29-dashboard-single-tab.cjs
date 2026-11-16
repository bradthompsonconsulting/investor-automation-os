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
const WRITE_DEADLINE_MS = arg('write-deadline-ms', null) !== null ? Number(arg('write-deadline-ms')) : CONTRACT === 'r3' ? 20000 : null;
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
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (blobs.handles(u)) return blobs.fetch(url, init);
  ghlCalls += 1;
  return new Response(JSON.stringify({ contacts: [], opportunities: [], conversations: [], pipelines: [{ id: 'fixture-pipeline', name: 'P', stages: [] }], events: [], meta: { total: 0 }, total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
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
async function bindSession(n) {
  const g = await rev.beginSession(sid(n), 'test', { event: NF });
  if (g.kind !== 'issued') throw new Error('fixture bind: ' + JSON.stringify(g));
  return { sid: sid(n), epoch: g.epoch, aetag: g.aetag, setag: g.setag, cookie: readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), sid(n), g.epoch, { aetag: g.aetag, setag: g.setag }).token };
}
const ev = ({ method = 'GET', cookie = null, headers = {}, body = '' } = {}) => ({ httpMethod: method, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE, ...(cookie ? { cookie: `${readAuth.READ_COOKIE}=${cookie}` } : {}), ...headers }, body, blobs: blobs.lambdaBlobs });
const fresh = (latencyMs) => { blobs.reset(); blobs.put('iaos-session-authority', 'authority', anchorText()); blobs.setConflictMode(latencyMs ? { latencyMs } : null); ghlCalls = 0; };

let checks = 0, failures = 0; const RESULTS = [];
async function check(name, fn) { checks += 1; try { await fn(); console.log('PASS  ' + name); } catch (e) { failures += 1; console.log('FAIL  ' + name + ' -- ' + (e && e.message)); } }

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const HARNESS = '/scripts/harness/one-login-dashboard/index.html';
  const server = await createServer({ root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** ONE browser context, ONE tab, the session's cookie injected on every function request. */
  /* Server-side accounting per tab: every function request is a log entry with its start / end time and status; the
     number of SESSION-CHECKED handler executions from this tab in flight at once (inflight / maxInflight: the D2 lane
     bound); handlers that are still running after the browser gave up (aborted / closed page) keep running here, as
     a Lambda would, and are counted in the global PENDING until they settle. */
  async function openTab(cookie) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const tab = { log: [], foreign: [], errs: [], inflight: 0, maxInflight: 0, fulfillFailed: 0 };
    await ctx.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.endsWith('/app-read-login.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>login</title>' });
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { tab.foreign.push(url); return route.abort(); }
      const U = new URL(url); const fn = U.pathname.replace(/^.*\/\.netlify\/functions\//, '');
      const entry = { fn, method: req.method(), t0: Date.now() }; tab.log.push(entry);
      const h = handlerFor(fn);
      if (!h) { entry.status = 404; entry.t1 = Date.now(); return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no handler"}' }).catch(() => { tab.fulfillFailed += 1; }); }
      const headers = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE };
      for (const [k, v] of Object.entries(req.headers())) if (!['cookie', 'host', 'origin', 'referer'].includes(k)) headers[k] = v;
      if (tab.cookie) headers.cookie = `${readAuth.READ_COOKIE}=${tab.cookie}`;
      const q = {}; U.searchParams.forEach((v, k) => { q[k] = v; });
      const checked = !UNCHECKED_FNS.has(fn);
      if (checked) { tab.inflight += 1; tab.maxInflight = Math.max(tab.maxInflight, tab.inflight); }
      PENDING += 1;
      let res;
      try { res = await h({ httpMethod: req.method(), headers, body: req.postData() || '', blobs: blobs.lambdaBlobs, queryStringParameters: Object.keys(q).length ? q : undefined, rawUrl: url, path: U.pathname }); }
      catch (e) { res = { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: '{"error":"handler threw"}' }; entry.threw = true; }
      finally { PENDING -= 1; if (checked) tab.inflight -= 1; }
      entry.status = res.statusCode; entry.t1 = Date.now(); entry.ms = entry.t1 - entry.t0;
      const hdrs = {}; for (const [k, v] of Object.entries(res.headers || {})) if (k.toLowerCase() !== 'set-cookie') hdrs[k] = String(v);
      if (tab.holdDelivery && tab.holdDelivery.fn === fn) { entry.heldMs = tab.holdDelivery.ms; await sleep(tab.holdDelivery.ms); }   // origin already processed; only DELIVERY waits
      entry.deliveredAt = Date.now();
      return route.fulfill({ status: res.statusCode, headers: hdrs, body: res.body || '' }).catch(() => { tab.fulfillFailed += 1; entry.undelivered = true; });
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
  // ── EXPIRED / GENERATION: the session is revoked while a queued burst is in progress; nothing sent after the revoke is authorized ──
  {
    fresh(100); const S = await bindSession(9);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await rendered(T); await settleServer();
    const base0 = T.log.length;
    const burstP = T.page.evaluate(async () => { const r = await import('/src/lib/read-session.ts');
      return Promise.all(Array.from({ length: 8 }, () => r.readFetch('/.netlify/functions/ghl-contacts').then((x) => x.status, (e) => 'threw:' + (e && e.name)))); });
    for (let i = 0; i < 200 && !T.log.slice(base0).some((e) => e.status !== undefined); i++) await sleep(10);
    const v = await rev.revokeSession(S.sid, S.epoch, 'test', { event: NF }); const tRevoked = Date.now();
    const burst = await burstP; await settleServer();
    const afterRevoke = T.log.slice(base0).filter((e) => e.t0 > tRevoked);
    const row = { scenario: 'EXPIRED', revoke: v.kind, burst, startedAfterRevoke: afterRevoke.map((e) => `${e.fn}:${e.status}`), n503: T.log.slice(base0).filter((e) => e.status === 503).length };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('EXPIRED (100 ms): a revoke lands while a queued burst is in progress -> every request STARTED after the verified revoke is refused (never 200); the burst settles; nothing stuck', async () => {
      assert.equal(v.kind, 'verified');
      // Non-vacuous under a lane: queued requests start AFTER the revoke (on an unbounded client they may all have started before).
      if (LANE_MAX > 0) assert.ok(afterRevoke.length > 0, 'non-vacuous: some queued request started after the revoke ' + JSON.stringify(row));
      assert.deepEqual(afterRevoke.filter((e) => e.status === 200).map((e) => e.fn), [], JSON.stringify(row));
      assert.equal(unfinished(T), 0); assert.equal(PENDING, 0);
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
    await check(`WRITE-ABANDON (isolated; delivery held ${WRITE_HOLD_MS} ms): the first write is sent EXACTLY ONCE and never re-sent automatically; total writes over hold + 5 s = first + only the operator's explicit second attempt; the server-side write settles (0 pending, 0 Blob in flight)${WRITE_DEADLINE_MS ? `; the caller gives up by ${WRITE_DEADLINE_MS} ms (+1 s) with an error (uncertain), not a success` : '; caller outcome RECORDED only'}${CONTRACT === 'r3' ? '; r3: the first error is LaneUncertain, the second write is rejected LaneNotSent(uncertain_pending) with 0 requests sent, and a read still answers 200' : ''}`, async () => {
      assert.equal(row.firstWritesSent, 1, JSON.stringify(row));
      assert.equal(row.totalWritesOverWindow, row.firstWritesSent + row.secondWritesSent, 'no automatic re-send ' + JSON.stringify(row));
      assert.equal(row.serverPending, 0); assert.equal(row.blobInflight, 0); assert.equal(row.unfinished, 0);
      if (WRITE_DEADLINE_MS) { assert.equal(outcome.kind, 'error', JSON.stringify(outcome)); assert.ok(outcome.ms <= WRITE_DEADLINE_MS + 1000, JSON.stringify(outcome)); }
      if (CONTRACT === 'r3') {
        assert.equal(outcome.name, 'LaneUncertain', JSON.stringify(outcome));
        assert.deepEqual([second.write && second.write.name, second.write && second.write.reason, row.secondWritesSent], ['LaneNotSent', 'uncertain_pending', 0], JSON.stringify(second));
        assert.equal(second.read, 200, 'reads proceed while the write hold exists ' + JSON.stringify(second));
      }
    });
    await T.ctx.close();
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
  console.log(`B15-29 one-operator single-tab Dashboard: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error('CRASH', e && e.stack); process.exit(2); });
