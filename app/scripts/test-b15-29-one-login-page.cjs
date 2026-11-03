/**
 * B15-29 (INV-137) one IAOS sign-in -- REAL page, headless Chromium, offline.
 *
 * Vite serves scripts/harness/one-login (the REAL Layout + OneLoginAccess gate + REAL saving module around a
 * minimal draft page). Every /.netlify/functions request is answered by the REAL handlers in this process:
 * app-read-session (status, handle), app-write-token, app-signout, and for every save the REAL per-save checks
 * requireAppWriter + sessionWriteRefusal. The cookie jar stands in for the browser's __Host- cookie (http harness);
 * the harness origin is mapped to the configured https origin and only that. The revocation store is the
 * in-memory fake Blob API. The one-sign-in switch is ON only in this process's in-memory config. Nothing leaves
 * the machine.
 *
 *   P1 one sign-in: status line "Signed in until … · Sign out"; no "Enable saving"; a save gets its token silently
 *   P2 a second tab is signed in by the same session without any sign-in step
 *   P3 Sign out in tab A is confirmed only after the server's verified revocation: "Signed out of IAOS."
 *   P4 tab B -- with NO BroadcastChannel and a localStorage that throws -- cannot save after A's Sign out: its
 *      earlier token is refused by the server (Variant S), nothing is applied, the recovery screen appears and
 *      B's unsaved draft is still on the (hidden, mounted) page
 *   P5 revocation store unavailable: "IAOS can't confirm your sign-in right now" + Try again, NO sign-in prompt,
 *      draft kept; recovery on Try again with the page not remounted
 *   P6 Sign out not confirmed (provider false success): "Sign-out not confirmed" + Try Sign out again with the
 *      SAME handle; then confirmed
 *   P7 the IAOS session ends mid-call: the save is NOT sent, "Saving paused" shown, draft kept; after signing in
 *      again the operator's save is sent once
 */
'use strict';
process.env.NODE_ENV = 'test';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { createFakeBlobs } = require('./lib/b15-29-fake-blobs.cjs');

const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
Module._resolveFilename = ((original) => function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return original.call(this, name, parent, ...rest);
})(Module._resolveFilename);

const ORIGIN = 'https://proof.example.invalid';
const SITE = 'fixture-site-id';
const BLOB_TOKEN = 'fixture-blob-token-not-real';
Object.assign(process.env, {
  IAOS_ENV: 'test',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
  IAOS_SESSION_REVOCATION_SITE_ID: SITE,
  IAOS_SESSION_REVOCATION_TOKEN: BLOB_TOKEN,
});
delete process.env.IAOS_VOICE_SESSION_SECRET;

const blobs = createFakeBlobs({ siteID: SITE, token: BLOB_TOKEN });
const nodeFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.netlify.com/') || u.startsWith('https://signed.blobs.invalid/')) return blobs.fetch(url, init);
  throw new Error('unexpected server-side outbound request: ' + u);
};
const cfg = require(path.join(APP, 'shared/ghl-config.ts'));
cfg.getConfig('test').oneLogin = cfg.ONE_LOGIN_ENABLED;   // in-memory, this process only
const readAuth = require(path.join(FUNCTIONS, 'lib/app-read-auth.ts'));
const writeAuth = require(path.join(FUNCTIONS, 'lib/app-write-auth.ts'));
const rev = require(path.join(FUNCTIONS, 'lib/session-revocation.ts'));
const H = {
  session: require(path.join(FUNCTIONS, 'app-read-session.ts')).handler,
  token: require(path.join(FUNCTIONS, 'app-write-token.ts')).handler,
  signout: require(path.join(FUNCTIONS, 'app-signout.ts')).handler,
};
const HARNESS = '/scripts/harness/one-login/index.html';

let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── the browser's one IAOS session ──
let jar = null;
const signInJar = () => { jar = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), require('node:crypto').randomBytes(16).toString('base64url')).token; };
const jarSid = () => (jar ? JSON.parse(Buffer.from(jar.split('.')[1], 'base64url')).sid : null);
let log = [];
const applied = [];
const POPUP = `<!doctype html><title>stub read sign-in</title><script>window.opener.postMessage({ type: "iaos-app-read-signed-in" }, location.origin);</script>`;

const watchdog = setTimeout(() => { console.error('FAIL  the one-login page suite did not finish within 8 minutes -- stopped'); process.exit(1); }, 8 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  const router = async (route, tab) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith(`${base}/app-read-login.html`)) { signInJar(); return route.fulfill({ status: 200, contentType: 'text/html', body: POPUP }); }
    if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
    if (!url.includes('/.netlify/functions/')) return route.abort();
    const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
    const headers = await request.allHeaders();
    const event = { httpMethod: request.method(), headers: {}, body: request.postData() || '' };
    for (const [k, v] of Object.entries(headers)) if (!['cookie', 'origin'].includes(k)) event.headers[k] = v;
    if (headers.origin !== undefined) event.headers.origin = headers.origin === base ? ORIGIN : headers.origin;
    if (jar) event.headers.cookie = `${readAuth.READ_COOKIE}=${jar}`;
    const entry = { tab, fn, method: request.method() };
    log.push(entry);
    let res;
    if (fn === 'app-read-session') res = await H.session(event);
    else if (fn === 'app-write-token') res = await H.token(event);
    else if (fn === 'app-signout') res = await H.signout(event);
    else if (fn === 'ghl-write') {
      try { writeAuth.requireAppWriter(event); } catch { res = { statusCode: 401, body: JSON.stringify({ error: 'Application write sign-in required' }) }; }
      if (!res) res = await rev.sessionWriteRefusal(event);
      if (!res) { applied.push({ tab, body: JSON.parse(event.body).args.body }); res = { statusCode: 200, body: JSON.stringify({ ok: true }) }; }
    } else res = { statusCode: 404, body: JSON.stringify({ error: 'fixture does not model ' + fn }) };
    entry.status = res.statusCode;
    return route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body });
  };
  const names = new WeakMap();
  const routed = new WeakSet();
  const tabOf = (request) => { try { return names.get(request.frame().page()) || 'popup'; } catch { return 'worker'; } };
  const newTab = async (ctx, tab) => {
    if (!routed.has(ctx)) { routed.add(ctx); await ctx.route('**/*', (r) => router(r, tabOf(r.request()))); }
    const p = await ctx.newPage();
    names.set(p, tab);
    p.on('pageerror', (e) => console.error('pageerror', tab, String(e)));
    await p.goto(`${base}${HARNESS}`);
    return p;
  };
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  const shown = (p, id) => p.getByTestId(id).first().isVisible().catch(() => false);
  const text = (p, id) => p.getByTestId(id).first().innerText().catch(() => '');
  const has = (p, s) => p.getByText(s, { exact: false }).first().isVisible().catch(() => false);

  try {
    // ── P1 ──
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { delete window.BroadcastChannel; Storage.prototype.setItem = function () { throw new DOMException('fixture', 'QuotaExceededError'); }; Storage.prototype.getItem = function () { throw new DOMException('fixture', 'SecurityError'); }; });
    const popups = [];
    ctx.on('page', (p) => popups.push(p));
    const A = await newTab(ctx, 'A');
    await until(() => has(A, 'Sign in to IAOS'));
    check('P1 before sign-in only the sign-in landing is shown; no page mounts', await has(A, 'Sign in to IAOS') && (await A.getByTestId('draft').count()) === 0);
    await A.getByRole('button', { name: 'Sign in' }).click();
    await until(() => shown(A, 'read-access-signed-in'));
    const status = await text(A, 'read-access-signed-in');
    check('P1 one sign-in: the status line reads "Signed in until … · Sign out"', /^Signed in until .+ · Sign out$/.test(status.trim()), status);
    check('P1 no saving control: no "Enable saving", "Turn off saving" or "View only"', !(await has(A, 'Enable saving')) && !(await has(A, 'Turn off saving')) && !(await has(A, 'View only')));
    await A.getByTestId('draft').fill('note from tab A');
    log = [];
    await A.getByTestId('save').click();
    await until(async () => (await text(A, 'save-result')).length > 0);
    check('P1 the save gets its saving token silently and is sent once (no second sign-in window)', (await text(A, 'save-result')) === 'Save answered 200' &&
      log.filter((e) => e.fn === 'ghl-write').length === 1 && applied.length === 1 && log.every((e) => e.fn !== 'app-write-session') && popups.length === 2, { log, popups: popups.length });

    // ── P2 ──
    const B = await newTab(ctx, 'B');
    await until(() => shown(B, 'read-access-signed-in'));
    check('P2 a second tab is signed in by the same session with no sign-in step', await shown(B, 'read-access-signed-in') && popups.length === 3, popups.length);
    await B.getByTestId('draft').fill('unsaved seller notes in tab B');
    await until(async () => log.filter((e) => e.tab === 'B' && e.fn === 'app-write-token' && e.status === 200).length >= 1);
    const bTokenBefore = log.filter((e) => e.tab === 'B' && e.fn === 'app-write-token' && e.status === 200).length;
    check('P2 tab B already holds a saving token issued BEFORE Sign out (identity primed at sign-in)', bTokenBefore >= 1);

    // ── P3 ──
    const sidA = jarSid();
    await A.getByRole('button', { name: 'Sign out' }).click();
    await until(() => has(A, 'Signed out of IAOS.'));
    const so = log.filter((e) => e.fn === 'app-signout');
    check('P3 tab A: "Signed out of IAOS." only after the server verified the revocation (200 revoked)', await has(A, 'Signed out of IAOS.') && so.length === 1 && so[0].status === 200, so);
    check('P3 the revocation record for exactly that session exists in the store', !!blobs.get('iaos-write-receipts', rev.revocationKey('test', sidA)));
    check('P3 no request from tab A cleared or set a cookie (DELETE is never sent)', log.every((e) => !(e.fn === 'app-read-session' && e.method === 'DELETE')));

    // ── P4 ── (tab B has not been focused; no channel or storage exists)
    const writesBefore = log.filter((e) => e.tab === 'B' && e.fn === 'ghl-write').length;
    const appliedBefore = applied.length;
    await B.getByTestId('save').click();
    await until(() => shown(B, 'read-access-recovery'));
    const bWrites = log.filter((e) => e.tab === 'B' && e.fn === 'ghl-write');
    check('P4 tab B (no BroadcastChannel, throwing storage): its earlier token is refused by the server (401) and NOTHING is applied', bWrites.length - writesBefore === 1 && applied.length === appliedBefore &&
      bWrites.slice(writesBefore).every((e) => e.status === 401), bWrites);
    check('P4 tab B shows the recovery screen ("Signed out of IAOS. Sign in to continue.")', await has(B, 'Signed out of IAOS. Sign in to continue.'));
    check('P4 tab B\'s unsaved draft is still on the mounted (hidden) page', (await B.getByTestId('draft').inputValue()) === 'unsaved seller notes in tab B');
    check('P4 tab B made no further write and no token was issued to it after the Sign out', log.filter((e) => e.tab === 'B' && e.fn === 'app-write-token' && e.status === 200).length === bTokenBefore);

    // ── P5 ── unavailable store, in a new context
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const C = await newTab(ctx2, 'C');
    await until(() => has(C, 'Sign in to IAOS'));
    await C.getByRole('button', { name: 'Sign in' }).click();
    await until(() => shown(C, 'read-access-signed-in'));
    await C.getByTestId('draft').fill('draft kept through an outage');
    for (let i = 0; i < 6; i += 1) blobs.rule({ stage: 'blob', method: 'GET', status: 500 });
    await C.evaluate(() => window.dispatchEvent(new Event('focus')));
    await until(() => has(C, "IAOS can't confirm your sign-in right now"));
    check('P5 store unavailable: "IAOS can\'t confirm your sign-in right now" with Try again', await has(C, "IAOS can't confirm your sign-in right now") && await shown(C, 'one-login-try-again'));
    check('P5 NO sign-in prompt and NOT "signed out" during the outage', (await C.getByRole('button', { name: /Sign in/ }).count()) === 0 && !(await has(C, 'Signed out')));
    check('P5 the draft is kept on the mounted page', (await C.getByTestId('draft').inputValue()) === 'draft kept through an outage');
    blobs.clearRules();
    await C.getByTestId('one-login-try-again').click();
    await until(() => shown(C, 'read-access-signed-in'));
    check('P5 Try again (store back): signed in, the same page with the same draft (not remounted)', await shown(C, 'draft') && (await C.getByTestId('draft').inputValue()) === 'draft kept through an outage');

    // ── P6 ── Sign out not confirmed, then the same handle confirmed
    const sidC = jarSid();
    blobs.rule({ stage: 'blob', method: 'PUT', lie: true });
    await C.getByRole('button', { name: 'Sign out' }).click();
    await until(() => has(C, 'Sign-out not confirmed.'));
    check('P6 provider false success: "Sign-out not confirmed." with Try Sign out again; never "Signed out"', await has(C, 'Sign-out not confirmed.') && await shown(C, 'one-login-retry-sign-out') && !(await has(C, 'Signed out of IAOS.')));
    const firstHandle = log.filter((e) => e.fn === 'app-signout').length;
    await C.getByTestId('one-login-retry-sign-out').click();
    await until(() => has(C, 'Signed out of IAOS.'));
    check('P6 Try Sign out again: confirmed; the record is for the ORIGINAL session', await has(C, 'Signed out of IAOS.') && !!blobs.get('iaos-write-receipts', rev.revocationKey('test', sidC)) && log.filter((e) => e.fn === 'app-signout').length === firstHandle + 1);

    // ── P7 ── the session ends mid-call
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const D = await newTab(ctx3, 'D');
    await until(() => has(D, 'Sign in to IAOS'));
    await D.getByRole('button', { name: 'Sign in' }).click();
    await until(() => shown(D, 'read-access-signed-in'));
    await D.getByTestId('draft').fill('first save');
    await D.getByTestId('save').click();
    await until(async () => (await text(D, 'save-result')) === 'Save answered 200');
    // The session ends (expired cookie) and the cached token is past its own life: the next save must renew.
    jar = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now() - readAuth.READ_SESSION_SECONDS * 1000 - 1000, jarSid()).token;
    await D.evaluate(async () => { const m = await import('/src/lib/app-write-session.ts'); m.clearAppWriteToken(); });
    await D.getByTestId('draft').fill('seller said yes to 142k -- not saved yet');
    const dWrites = log.filter((e) => e.tab === 'D' && e.fn === 'ghl-write').length;
    await D.getByTestId('save').click();
    await until(() => shown(D, 'read-access-recovery'));
    check('P7 the IAOS session ended: the save is NOT sent and the page says saving is paused', log.filter((e) => e.tab === 'D' && e.fn === 'ghl-write').length === dWrites &&
      (await D.getByTestId('save-result').innerText().catch(() => '')).startsWith('Saving paused: your IAOS sign-in has ended.'));
    check('P7 the recovery screen offers "Sign in again"; the draft is kept', await D.getByRole('button', { name: 'Sign in again' }).isVisible() && (await D.getByTestId('draft').inputValue()) === 'seller said yes to 142k -- not saved yet');
    await D.getByRole('button', { name: 'Sign in again' }).click();
    await until(() => shown(D, 'read-access-signed-in'));
    check('P7 after signing in again nothing was re-sent automatically', log.filter((e) => e.tab === 'D' && e.fn === 'ghl-write').length === dWrites);
    await D.getByTestId('save').click();
    await until(async () => (await text(D, 'save-result')) === 'Save answered 200' && log.filter((e) => e.tab === 'D' && e.fn === 'ghl-write').length === dWrites + 1);
    check('P7 the operator\'s own save is then sent exactly once', log.filter((e) => e.tab === 'D' && e.fn === 'ghl-write').length === dWrites + 1 && applied[applied.length - 1].body === 'seller said yes to 142k -- not saved yet');

    console.log(`B15-29 one IAOS sign-in (real page): ${checks - failures}/${checks} checks passed`);
    await exit(failures ? 1 : 0);
  } catch (e) {
    console.error('FAIL  suite aborted -- ' + (e && e.stack));
    await exit(1);
  }
}
main();
