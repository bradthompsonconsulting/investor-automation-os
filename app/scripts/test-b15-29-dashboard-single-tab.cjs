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
const K = Number(arg('k', '5'));
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
  'ghl-calendar-events', 'ghl-underwriting-policy', 'call-log-barrier', 'ghl-contact', 'ghl-contact-conversations', 'ghl-proxy']);
const PROTECTED_READERS = ['ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations'];
const anchorText = (epoch = 'fixture-epoch-0001') => JSON.stringify({ env: 'test', epoch, kind: 'iaos-session-revocation-authority', siteID: SITE, state: 'open', v: 1 });
const sid = (n) => Buffer.alloc(16, n).toString('base64url');
const NF = { headers: { 'x-nf-site-id': SITE }, blobs: blobs.lambdaBlobs };
async function bindSession(n) {
  const g = await rev.beginSession(sid(n), 'test', { event: NF });
  if (g.kind !== 'issued') throw new Error('fixture bind: ' + JSON.stringify(g));
  return { sid: sid(n), epoch: g.epoch, cookie: readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), sid(n), g.epoch, { aetag: g.aetag, setag: g.setag }).token };
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
  async function openTab(cookie) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const log = []; const foreign = [];
    await ctx.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.endsWith('/app-read-login.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>login</title>' });
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const U = new URL(url); const fn = U.pathname.replace(/^.*\/\.netlify\/functions\//, '');
      const entry = { fn, method: req.method(), t0: Date.now() }; log.push(entry);
      const h = handlerFor(fn);
      if (!h) { entry.status = 404; return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no handler"}' }); }
      const headers = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE };
      for (const [k, v] of Object.entries(req.headers())) if (!['cookie', 'host', 'origin', 'referer'].includes(k)) headers[k] = v;
      if (cookie) headers.cookie = `${readAuth.READ_COOKIE}=${cookie}`;
      const q = {}; U.searchParams.forEach((v, k) => { q[k] = v; });
      let res;
      try { res = await h({ httpMethod: req.method(), headers, body: req.postData() || '', blobs: blobs.lambdaBlobs, queryStringParameters: Object.keys(q).length ? q : undefined, rawUrl: url, path: U.pathname }); }
      catch (e) { entry.status = 'threw'; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"handler threw"}' }); }
      entry.status = res.statusCode; entry.ms = Date.now() - entry.t0;
      const hdrs = {}; for (const [k, v] of Object.entries(res.headers || {})) if (k.toLowerCase() !== 'set-cookie') hdrs[k] = String(v);
      return route.fulfill({ status: res.statusCode, headers: hdrs, body: res.body || '' });
    });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    return { ctx, page, log, foreign, errs };
  }
  const account = (log) => { const by = {}; for (const e of log) { const k = `${e.fn}:${e.status}`; by[k] = (by[k] || 0) + 1; } return by; };
  const withCheckLog = async (fn) => { const w0 = console.warn; const lines = []; console.warn = (...a) => { const l = a.map(String).join(' '); if (l.startsWith('[iaos-session-check]')) lines.push(JSON.parse(l.slice(21))); else w0(...a); };
    try { return { out: await fn(), lines }; } finally { console.warn = w0; } };
  const classes = (lines) => lines.reduce((a, l) => { const k = `${l.op}:${l.kind}:${l.reason}`; a[k] = (a[k] || 0) + 1; return a; }, {});

  // ── T-L: single-tab Dashboard loads at each latency ──
  for (const L of LATENCIES) {
    const runs = [];
    for (let k = 0; k < K; k++) {
      fresh(L); const S = await bindSession(1);
      const { out: T, lines } = await withCheckLog(async () => { const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await sleep(2500);
        T.text = await T.page.evaluate(() => document.body.innerText).catch(() => ''); return T; });
      const by = account(T.log); const n503 = T.log.filter((e) => e.status === 503).length;
      const row = { scenario: `T-L${L}`, run: k + 1, n503, requests: T.log.length, byFnStatus: by, conflict409s: blobs.conflictAnswers(), ghlCalls, checkClasses: classes(lines),
        signedIn: /Sign out/i.test(T.text), unavailableBanner: /IAOS can.t confirm your sign-in/.test(T.text), pageErrors: T.errs.length, foreign: T.foreign.length,
        unexpectedFns: [...new Set(T.log.map((e) => e.fn).filter((f) => !ALLOWED_FNS.has(f)))], maxMs: Math.max(0, ...T.log.map((e) => e.ms || 0)) };
      RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row)); runs.push(row);
      await T.ctx.close();
    }
    await check(`T-L${L} one tab x${K}: ZERO 503; status signed in; every protected Dashboard reader 200; saving token primed (app-write-token 200); no page error, no foreign request, only allowlisted functions`, async () => {
      const bad = runs.filter((r) => r.n503 > 0 || !r.signedIn || r.unavailableBanner || r.pageErrors || r.foreign || r.unexpectedFns.length
        || PROTECTED_READERS.some((f) => !(r.byFnStatus[`${f}:200`] >= 1)) || !(r.byFnStatus['app-write-token:200'] >= 1));
      assert.deepEqual(bad.map((r) => ({ run: r.run, n503: r.n503, signedIn: r.signedIn, by: r.byFnStatus })), [], `${bad.length}/${K} runs failed`);
    });
  }
  // ── NAV: navigate away (unmount) and back (remount) in the same tab ──
  {
    fresh(40); const S = await bindSession(2);
    const T = await openTab(S.cookie); await T.page.goto(`${base}${HARNESS}`); await sleep(2500);
    const first = T.log.length;
    await T.page.evaluate(() => window.__iaosNavigate('/away')); await sleep(300);
    await T.page.evaluate(() => window.__iaosNavigate('/')); await sleep(2500);
    const after = T.log.slice(first); const row = { scenario: 'NAV', requestsFirst: first, requestsAfter: after.length, byFnStatusAfter: account(after), n503: T.log.filter((e) => e.status === 503).length };
    RESULTS.push(row); console.log('RESULT ' + JSON.stringify(row));
    await check('NAV away and back in the same tab (latency 40 ms): the protected readers run again and answer 200; zero 503 across the whole tab', async () => {
      assert.ok(PROTECTED_READERS.some((f) => row.byFnStatusAfter[`${f}:200`] >= 1), JSON.stringify(row.byFnStatusAfter));
      assert.equal(row.n503, 0, JSON.stringify(account(T.log)));
    });
    await T.ctx.close();
  }
  // ── SAVE (direct, real handlers): the saving token authorizes a write; malformed refused ──
  await check('SAVE: a signed-in operator mints a saving token (200, never printed) and the protected writer answers 200 {ok:true,sent:false}; a malformed body -> 400 malformed', async () => {
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
