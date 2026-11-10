/**
 * B15-29 (INV-137) professional login experience -- REAL page, headless Chromium, offline (spec SPEC_LOGIN_EXPERIENCE §5).
 *
 * Vite serves scripts/harness/login-experience (the REAL Layout + OneLoginAccess + OneLoginScreen + reminder dialog +
 * REAL saving module around a workspace page whose draft lives only in component memory) for any /ws/... deep link.
 * The REAL sign-in popup page public/app-read-login.html (+ .js) is served as-is; ONLY Google's GIS script is
 * replaced by an in-process stub (its button hands the page a fixture credential). Every /.netlify/functions request
 * is answered by the REAL handlers in this process (app-read-session, app-write-token, app-signout; every save runs
 * requireAppWriter + sessionWriteRefusal). The revocation store is the in-memory fake Blob API; Google tokeninfo is a
 * fixture. The one-sign-in switch is ON only in this process's in-memory config. Nothing leaves the machine: any
 * other outbound request is aborted and counted (L0).
 *
 * The server expiry is controlled by issuing the SAME bound session (same sid, epoch and store ETags) with an earlier
 * sign-in instant, so the real status answer reports an `expiresAt` days, or seconds, away.
 *
 * Screenshots are written ONLY when LOGIN_UI_SHOTS names a directory (never into the repository by default).
 *
 * r4 (Bones R3-2 + delayed status): section 8 holds chosen server answers (computed at arrival, delivered later) to
 * prove that a pending old-session mint and a delayed old status answer are discarded after Log In Again (A->A), that
 * a sign-in with a DIFFERENT account (A->B) remounts the page and clears operator-scoped data, that logout after a
 * replacement revokes the NEW session, and that a late "signed in" never repaints after a newer "revoked".
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
const SITE = '07ca1f1a-60fd-4229-a076-528970957912';
const EPOCH = 'fixture-epoch-0001';
const DAY = 24 * 3600_000;
Object.assign(process.env, {
  IAOS_ENV: 'test',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid,second@example.invalid',
  IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid,second@example.invalid',
  IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
});
delete process.env.IAOS_VOICE_SESSION_SECRET;

const blobs = createFakeBlobs({ siteID: SITE });
blobs.put('iaos-session-authority', 'authority', JSON.stringify({ env: 'test', epoch: EPOCH, kind: 'iaos-session-revocation-authority', siteID: SITE, state: 'open', v: 1 }));
let googleEmail = 'brad@example.invalid';
global.fetch = async (url, init) => {
  const u = String(url);
  if (blobs.handles(u)) return blobs.fetch(url, init);
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    return new Response(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'offline-read-client', email: googleEmail, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) }), { status: 200 });
  }
  throw new Error('unexpected server-side outbound request: ' + u);
};
const cfg = require(path.join(APP, 'shared/ghl-config.ts'));
cfg.getConfig('test').oneLogin = cfg.ONE_LOGIN_ENABLED;   // in-memory, this process only
cfg.getConfig('test').oneLoginTestSessionSeconds = null;   // pinned in-process: these checks are 30-day checks, whatever the committed Test lifetime
const readAuth = require(path.join(FUNCTIONS, 'lib/app-read-auth.ts'));
const writeAuth = require(path.join(FUNCTIONS, 'lib/app-write-auth.ts'));
const rev = require(path.join(FUNCTIONS, 'lib/session-revocation.ts'));
const H = {
  session: require(path.join(FUNCTIONS, 'app-read-session.ts')).handler,
  token: require(path.join(FUNCTIONS, 'app-write-token.ts')).handler,
  signout: require(path.join(FUNCTIONS, 'app-signout.ts')).handler,
};
const HARNESS = '/scripts/harness/login-experience/index.html';
const SHOTS = process.env.LOGIN_UI_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let checks = 0, failures = 0;
/* B15-29 test reliability (Bones HOLD b877cea): every failing check's NAME is kept and printed again just before the
   summary, so a truncated or filtered log still identifies the failing assertion. */
const failedNames = [];
function check(name, ok, detail) {
  checks += 1; if (!ok) { failures += 1; failedNames.push(name); }
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── the browser's one IAOS session cookie (the harness is http; the __Host- cookie is modelled by this jar) ──
let jar = null;
const setCookies = [];
const claims = () => JSON.parse(Buffer.from(jar.split('.')[1], 'base64url'));
const jarSid = () => (jar ? claims().sid : null);
/** A real sign-in through the REAL handler (binds a new session at the fake store) -- used to seed a session directly. */
const signInJar = async () => {
  const res = await H.session({ httpMethod: 'POST', headers: { origin: ORIGIN, 'x-nf-site-id': SITE }, blobs: blobs.lambdaBlobs, body: JSON.stringify({ googleIdToken: 'fixture-google-token' }) });
  if (res.statusCode !== 200) throw new Error('fixture sign-in failed: ' + res.body);
  setCookies.push(res.headers['Set-Cookie']);
  jar = /__Host-iaos_read=([^;]+)/.exec(res.headers['Set-Cookie'])[1];
};
/** The SAME bound session, re-issued as if signed in `agoMs` ago: the server then reports expiresAt = that + 30 days. */
const signedInAgo = (agoMs) => {
  const c = claims();
  jar = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now() - agoMs, c.sid, c.epoch, { aetag: c.aetag, setag: c.setag }).token;
  return claims().exp * 1000;
};
/** What the server says right now for this jar (direct handler call; not logged as a page request). */
const serverStatus = async () => JSON.parse((await H.session({ httpMethod: 'GET', headers: { cookie: `${readAuth.READ_COOKIE}=${jar}`, 'x-nf-site-id': SITE }, blobs: blobs.lambdaBlobs })).body);

let log = [];
const applied = [];
const outbound = [];
/** r4: hold the NEXT matching function answer -- computed when the request arrives, delivered only on release(). */
const holds = [];
const hold = (fn, method) => { const h = { fn, method, taken: false, entered: false }; h.promise = new Promise((r) => { h.release = r; }); holds.push(h); return h; };
// Google Identity Services, stubbed: renders one button; clicking it hands the page a fixture ID token.
const GIS_STUB = `window.google = { accounts: { id: {
  initialize(o) { window.__gis = o; },
  renderButton(el) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Sign in with Google (stub)';
    b.setAttribute('data-testid', 'gis-button'); b.onclick = () => window.__gis.callback({ credential: 'fixture-google-token' }); el.appendChild(b); },
} } };`;

const watchdog = setTimeout(() => { console.error('FAIL  the login-experience page suite did not finish within 9 minutes -- stopped'); process.exit(1); }, 9 * 60_000);

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
    if (url.startsWith('https://accounts.google.com/gsi/client')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB });
    // Any deep link under /ws/ is the harness page; the browser keeps the deep-link URL.
    if (url.startsWith(`${base}/ws/`) && request.resourceType() === 'document') return route.continue({ url: `${base}${HARNESS}` });
    if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
    if (!url.includes('/.netlify/functions/')) { outbound.push(url); return route.abort(); }
    const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
    const headers = await request.allHeaders();
    const event = { httpMethod: request.method(), headers: {}, body: request.postData() || '' };
    for (const [k, v] of Object.entries(headers)) if (!['cookie', 'origin'].includes(k)) event.headers[k] = v;
    if (headers.origin !== undefined) event.headers.origin = headers.origin === base ? ORIGIN : headers.origin;
    if (jar) event.headers.cookie = `${readAuth.READ_COOKIE}=${jar}`;
    event.headers['x-nf-site-id'] = SITE;
    event.blobs = blobs.lambdaBlobs;
    const entry = { tab, fn, method: request.method() };
    log.push(entry);
    let res;
    if (fn === 'app-read-session') res = await H.session(event);
    else if (fn === 'app-write-token') res = await H.token(event);
    else if (fn === 'app-signout') res = await H.signout(event);
    else if (fn === 'ghl-write') {
      entry.auth = event.headers.authorization || null;
      try { writeAuth.requireAppWriter(event); } catch { res = { statusCode: 401, headers: {}, body: JSON.stringify({ error: 'Application write sign-in required' }) }; }
      if (!res) res = await rev.sessionWriteRefusal(event);
      if (!res) { applied.push({ tab, body: JSON.parse(event.body).args.body }); res = { statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) }; }
    } else res = { statusCode: 404, headers: {}, body: JSON.stringify({ error: 'fixture does not model ' + fn }) };
    entry.status = res.statusCode;
    const sc = res.headers && res.headers['Set-Cookie'];
    if (sc) { entry.setCookie = true; setCookies.push(sc); const m = /__Host-iaos_read=([^;]*)/.exec(sc); if (m) jar = m[1] || null; }
    if (fn === 'app-read-session' && request.method() === 'GET') { try { entry.expiresAt = JSON.parse(res.body).expiresAt; entry.state = JSON.parse(res.body).state; } catch { /* not JSON */ } }
    if (fn === 'app-write-token') { try { entry.token = JSON.parse(res.body).token || null; } catch { /* not JSON */ } }
    const h = holds.find((x) => !x.taken && x.fn === fn && (!x.method || x.method === request.method()) && tab !== 'popup');
    if (h) { h.taken = true; h.entered = true; entry.held = true; await h.promise; }
    const done = route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body });
    if (h) { await done; h.fulfilled = true; }   // reliability: a test waits for this instead of a fixed sleep
    return done;
  };
  const names = new WeakMap();
  const routed = new WeakSet();
  const tabOf = (request) => { try { return names.get(request.frame().page()) || 'popup'; } catch { return 'worker'; } };
  const newCtx = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
    // Reliability: count each /.netlify/functions answer the PAGE has received, so a test can wait for a delayed answer
    // to have reached the app (then let it settle) instead of sleeping a fixed time. Counting only; responses untouched.
    await ctx.addInitScript(() => {
      const f = window.fetch.bind(window); const w = window; w.__iaosAnswers = {};
      window.fetch = async (...a) => {
        const r = await f(...a);
        try { const u = String((a[0] && a[0].url) || a[0]); const m = /\/\.netlify\/functions\/([\w-]+)/.exec(u); if (m) w.__iaosAnswers[m[1]] = (w.__iaosAnswers[m[1]] || 0) + 1; } catch { /* counting only */ }
        return r;
      };
    });
    routed.add(ctx); await ctx.route('**/*', (r) => router(r, tabOf(r.request())));
    return ctx;
  };
  const newTab = async (ctx, tab, at = '/ws/seller-call/42?tab=notes', init) => {
    const p = await ctx.newPage();
    names.set(p, tab);
    p.on('pageerror', (e) => console.error('pageerror', tab, String(e)));
    if (init) await p.addInitScript(init);
    await p.goto(`${base}${at}`);
    return p;
  };
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = (p, id) => p.getByTestId(id).first().isVisible().catch(() => false);
  const txt = (p, id) => p.getByTestId(id).first().textContent({ timeout: 3000 }).catch(() => null);
  const has = (p, s) => p.getByText(s, { exact: false }).first().isVisible().catch(() => false);
  const msgText = async (p) => ((await p.getByTestId('one-login-card').locator('[role="status"],[role="alert"]').first().textContent().catch(() => '')) || '').trim();
  const shot = async (p, name, opts = {}) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name), ...opts }); };
  const rootInert = (p) => p.evaluate(() => document.getElementById('root').hasAttribute('inert'));
  const draftValue = (p) => p.getByTestId('draft').inputValue().catch(() => null);
  const mounts = (p) => p.evaluate(() => window.__workspaceMounts || 0);
  const activeTestId = (p) => p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
  /* Reliability helpers (replace fixed sleeps). settled: two animation frames -- React has committed and the browser
     painted whatever state is current now. reminderDecided: the session reminder is computed in the SAME render as the
     signed-in status line (OneLoginAccess), so once that line is shown and the page has settled, the reminder decision
     for the current status is final -- an absence check after this is not vacuous. */
  const settled = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))).catch(() => false);
  const reminderDecided = async (p) => (await until(() => shown(p, 'read-access-signed-in'), 20000)) && (await settled(p)) && (await settled(p));
  const answers = (p, fn) => p.evaluate((k) => (window.__iaosAnswers && window.__iaosAnswers[k]) || 0, fn).catch(() => -1);
  const statusAnswersFor = (tab) => log.filter((e) => e.tab === tab && e.fn === 'app-read-session' && e.method === 'GET' && e.status !== undefined).length;
  const overlayOnTop = (p, id) => p.evaluate((tid) => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!(el && el.closest(`[data-testid="${tid}"]`)); }, id);
  /** Click the IAOS button, then Google's (stubbed) button in the REAL popup page. Returns the popup page. */
  const signInViaPopup = async (ctx, p, opts) => { try { return await signInViaPopupOnce(ctx, p, opts); } catch { return null; } };
  const signInViaPopupOnce = async (ctx, p, { beforeGoogle } = {}) => {
    const popupP = ctx.waitForEvent('page', { timeout: 20000 });
    await p.getByRole('button', { name: 'Sign In to IAOS', exact: true }).click({ timeout: 8000 }).catch(() => {});
    const pop = await popupP;
    await pop.getByTestId('gis-button').waitFor({ timeout: 20000 });
    if (beforeGoogle) await beforeGoogle(pop);
    await pop.getByTestId('gis-button').click({ timeout: 8000 }).catch(() => {});
    return pop;
  };

  try {
    // ════════════════ 1. entrance: deep link, layout, popup flow ════════════════
    const ctx1 = await newCtx();
    const A = await newTab(ctx1, 'A');
    await until(() => shown(A, 'one-login-sign-in'));
    check('L1 entrance: a full-page screen with the IAOS mark, "Welcome to IAOS" and ONE button "Sign In to IAOS"; the app is not rendered',
      await shown(A, 'one-login-entrance') && await shown(A, 'iaos-mark') && await has(A, 'INVESTOR') && await has(A, 'AUTOMATION OS') &&
      (await A.getByRole('heading', { name: 'Welcome to IAOS' }).count()) === 1 &&
      (await A.getByTestId('one-login-card').getByRole('button').count()) === 1 &&
      (await A.getByRole('button', { name: 'Sign In to IAOS', exact: true }).count()) === 1 &&
      await has(A, 'Secure sign-in with your authorized Google account.') &&
      (await A.getByTestId('draft').count()) === 0 && (await A.getByTestId('route').count()) === 0);
    check('L1 no registration fields: the entrance has no input, select or textarea', (await A.locator('input, select, textarea').count()) === 0);
    check('L1 the entrance covers the whole viewport (opaque navy page) and the rest of the page is inert',
      await overlayOnTop(A, 'one-login-entrance') && await rootInert(A) &&
      (await A.evaluate(() => getComputedStyle(document.querySelector('[data-testid="one-login-entrance"]')).backgroundColor)) === 'rgb(7, 20, 46)');
    check('L2 the deep link is kept on the entrance screen (URL untouched)', new URL(A.url()).pathname + new URL(A.url()).search === '/ws/seller-call/42?tab=notes', A.url());
    const statusBefore = log.filter((e) => e.tab === 'A').map((e) => `${e.method} ${e.fn}`);
    check('L2 before sign-in the entrance made only the status check (no protected read, no write)', statusBefore.length >= 1 && statusBefore.every((s) => s === 'GET app-read-session'), statusBefore);

    for (const [w, h, name] of [[1440, 900, 'entrance-1440x900.png'], [768, 1024, 'entrance-768x1024.png'], [375, 812, 'entrance-375x812.png']]) {
      await A.setViewportSize({ width: w, height: h });
      await until(async () => (await A.evaluate(() => innerWidth).catch(() => 0)) === w, 5000);
      await settled(A); await settled(A);
      const m = await A.evaluate(() => {
        const card = document.querySelector('[data-testid="one-login-card"]').getBoundingClientRect();
        const btn = document.querySelector('[data-testid="one-login-sign-in"]').getBoundingClientRect();
        const se = document.scrollingElement;
        const layer = document.querySelector('[data-testid="one-login-entrance"]');
        return { sw: se.scrollWidth, cw: se.clientWidth, lsw: layer.scrollWidth, lcw: layer.clientWidth, cardW: card.width, cardL: card.left, cardR: card.right, btnH: btn.height, btnW: btn.width, vw: innerWidth };
      });
      const cardOk = w < 480 ? Math.abs(m.cardW - (w - 32)) <= 1 && Math.abs(m.cardL - 16) <= 1 : Math.abs(m.cardW - 420) <= 1;
      check(`L3 responsive ${w}x${h}: no horizontal overflow; card ${w < 480 ? 'full width inside a 16 px gutter' : '420 px, centred'}; button >= 44 px tall, full card width`,
        m.sw <= m.cw && m.lsw <= m.lcw && cardOk && m.cardL >= 0 && m.cardR <= m.vw && m.btnH >= 44 && m.btnW > m.cardW - 90, m);
      await shot(A, name);
    }
    await A.setViewportSize({ width: 1440, height: 900 });

    // L18 a11y basics on the entrance
    const a11y = await A.evaluate(() => {
      const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
      const card = document.querySelector('[data-testid="one-login-card"]');
      const h1 = card.querySelector('h1'); const btn = card.querySelector('[data-testid="one-login-sign-in"]');
      const dialog = card.closest('[role="dialog"]') || card;
      return {
        heading: ratio(getComputedStyle(h1).color, getComputedStyle(card).backgroundColor),
        button: ratio(getComputedStyle(btn).color, getComputedStyle(btn).backgroundColor),
        modal: dialog.getAttribute('aria-modal'), labelledBy: document.getElementById(dialog.getAttribute('aria-labelledby') || '')?.textContent,
        btnBg: getComputedStyle(btn).backgroundColor, cardBg: getComputedStyle(card).backgroundColor,
      };
    });
    check('L18 a11y: the screen is a labelled aria-modal dialog ("Welcome to IAOS"); primary text contrast >= 7:1 on the card; button text >= 4.5:1 on CTA blue #005CE6; card #1B2433',
      a11y.modal === 'true' && a11y.labelledBy === 'Welcome to IAOS' && a11y.heading >= 7 && a11y.button >= 4.5 && a11y.btnBg === 'rgb(0, 92, 230)' && a11y.cardBg === 'rgb(27, 36, 51)', a11y);
    check('L18 a11y: the focused element on entry is the labelled "Sign In to IAOS" button', (await activeTestId(A)) === 'one-login-sign-in');
    {
      const inside = [];
      for (let i = 0; i < 5; i += 1) { await A.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab'); inside.push(await A.evaluate(() => !!document.activeElement.closest('[data-iaos-layer]'))); }
      check('L18 a11y: Tab / Shift+Tab never leave the entrance dialog (focus trap)', inside.every(Boolean), inside);
    }

    // L5 popup blocked (separate tab with window.open returning null)
    const AB = await newTab(ctx1, 'AB', '/ws/pipeline', () => { window.open = () => null; });
    await until(() => shown(AB, 'one-login-sign-in'));
    await AB.getByRole('button', { name: 'Sign In to IAOS', exact: true }).click({ timeout: 8000 }).catch(() => {});
    await until(async () => (await msgText(AB)) !== '');
    check('L5 popup blocked: "Allow pop-ups for IAOS to sign in." as an alert; still the entrance, no app',
      (await AB.getByRole('alert').filter({ hasText: 'Allow pop-ups for IAOS to sign in.' }).count()) === 1 && (await AB.getByTestId('draft').count()) === 0);
    await AB.close();

    // L4 / L6 / L8 popup flow through the REAL popup page (GIS stubbed)
    log = [];
    let pop;
    {
      const popupP = ctx1.waitForEvent('page', { timeout: 20000 });
      await A.getByRole('button', { name: 'Sign In to IAOS', exact: true }).click({ timeout: 8000 }).catch(() => {});
      pop = await popupP;
      await until(async () => (await msgText(A)) === 'Opening secure sign-in…');
      const btn = A.getByTestId('one-login-sign-in');
      check('L8 working: "Opening secure sign-in…"; the button is busy and disabled (aria-busy, aria-disabled)',
        (await msgText(A)) === 'Opening secure sign-in…' && (await btn.getAttribute('aria-busy', { timeout: 3000 }).catch(() => null)) === 'true' && (await btn.getAttribute('aria-disabled', { timeout: 3000 }).catch(() => null)) === 'true');
      await pop.getByTestId('gis-button').waitFor({ timeout: 20000 });
      check('L4 the REAL popup page is restyled: the IAOS mark, "Sign in to IAOS", Google\'s button, the secure-sign-in footer; navy page, #1B2433 card',
        await has(pop, 'INVESTOR') && await has(pop, 'AUTOMATION OS') && (await pop.getByRole('heading', { name: 'Sign in to IAOS' }).count()) === 1 &&
        await shown(pop, 'gis-button') && await has(pop, 'Secure sign-in with your authorized Google account.') &&
        (await pop.evaluate(() => getComputedStyle(document.querySelector('.card')).backgroundColor)) === 'rgb(27, 36, 51)');
      await shot(pop, 'popup-sign-in.png');
      googleEmail = 'intruder@example.invalid';
      await pop.getByTestId('gis-button').click({ timeout: 8000 }).catch(() => {});
      await until(() => has(pop, "This Google account isn't authorized for IAOS."));
      check('L6 not authorized: the popup says "This Google account isn\'t authorized for IAOS."; the opener is still the entrance and nothing is signed in',
        await has(pop, "This Google account isn't authorized for IAOS.") && await shown(A, 'one-login-entrance') && (await A.getByTestId('draft').count()) === 0 && jar === null);
      googleEmail = 'brad@example.invalid';
      await pop.getByTestId('gis-button').click({ timeout: 8000 }).catch(() => {});
    }
    await until(() => shown(A, 'draft'));
    check('L4 popup flow -> the app opens at the original deep link /ws/seller-call/42?tab=notes (URL and route)',
      (await txt(A, 'route')) === '/ws/seller-call/42?tab=notes' && new URL(A.url()).pathname + new URL(A.url()).search === '/ws/seller-call/42?tab=notes');
    check('L4 after sign-in: entrance gone, nothing inert, signed-in status line, the popup was closed, no page reload',
      !(await shown(A, 'one-login-entrance')) && !(await rootInert(A)) && await shown(A, 'read-access-signed-in') && pop.isClosed() &&
      log.filter((e) => e.tab === 'A' && e.fn === 'app-read-session' && e.method === 'GET').length === 1);
    check('L4 the sign-in was the ONE real POST from the popup (session bound, persistent cookie); the opener sent no write',
      log.filter((e) => e.fn === 'app-read-session' && e.method === 'POST').length === 2 && log.filter((e) => e.fn === 'app-read-session' && e.method === 'POST' && e.status === 200).length === 1 &&
      log.filter((e) => e.tab === 'A' && e.method !== 'GET' && e.fn !== 'app-write-token').length === 0);

    // L8b popup closed without signing in -> idle (new context, nothing signed in)
    jar = null;
    const ctx1b = await newCtx();
    const A2 = await newTab(ctx1b, 'A2', '/ws/pipeline');
    await until(() => shown(A2, 'one-login-sign-in'));
    {
      const popupP = ctx1b.waitForEvent('page', { timeout: 20000 });
      await A2.getByRole('button', { name: 'Sign In to IAOS', exact: true }).click({ timeout: 8000 }).catch(() => {});
      const p2 = await popupP; await p2.waitForLoadState().catch(() => {}); await p2.close();
      await until(async () => (await msgText(A2)) === '' && (await A2.getByTestId('one-login-sign-in').getAttribute('aria-busy', { timeout: 3000 }).catch(() => null)) === null, 5000);
      check('L8 popup closed without signing in: back to idle (no message, button enabled), still the entrance',
        (await msgText(A2)) === '' && (await A2.getByTestId('one-login-sign-in').getAttribute('aria-busy', { timeout: 3000 }).catch(() => null)) === null && await shown(A2, 'one-login-entrance'));
    }
    await ctx1b.close();
    await ctx1.close();

    // ════════════════ 2. outage at the entrance ════════════════
    await signInJar();
    for (let i = 0; i < 12; i += 1) blobs.rule({ method: 'PUT', status: 500 });
    const ctx2 = await newCtx();
    const O = await newTab(ctx2, 'O');
    await until(() => shown(O, 'one-login-try-again'));
    check('L7 entrance outage is never a sign-in prompt: "IAOS sign-in is temporarily unavailable. Try again." with Try again and NO sign-in button',
      (await msgText(O)) === 'IAOS sign-in is temporarily unavailable. Try again.' && await shown(O, 'one-login-try-again') &&
      (await O.getByRole('button', { name: /sign in/i }).count()) === 0 && !(await has(O, 'signed out')));
    blobs.clearRules();
    await O.getByTestId('one-login-try-again').click({ timeout: 5000 }).catch(() => {});   // absent under a mutation: the next check reports it
    await until(() => shown(O, 'draft'));
    check('L7 Try again (store back): signed in at the deep link', (await txt(O, 'route')) === '/ws/seller-call/42?tab=notes');
    await ctx2.close();

    // ════════════════ 3. expiry: 1-day reminder, overlay at expiresAt + 1 s, re-sign-in ════════════════
    await signInJar();
    const exp3 = signedInAgo(30 * DAY - 7000);   // the server's expiry is 7 s away
    const ctx3 = await newCtx();
    const X = await newTab(ctx3, 'X');
    await until(() => shown(X, 'session-reminder'));
    check('L12 at T1 (expiry < 1 day away) the 1-day reminder is shown: "Your IAOS session expires within 24 hours. …"',
      ((await txt(X, 'session-reminder-text')) || '') === 'Your IAOS session expires within 24 hours. Log in again now to keep your workflow uninterrupted.');
    await X.getByTestId('session-reminder-later').click({ timeout: 8000 }).catch(() => {});
    await until(async () => !(await shown(X, 'session-reminder')));
    await X.getByTestId('draft').click({ timeout: 8000 }).catch(() => {});
    await X.getByTestId('draft').fill('Seller agreed to 142k, wants a 30-day close -- NOT saved', { timeout: 8000 }).catch(() => {});
    const xWrites = log.filter((e) => e.tab === 'X' && e.fn === 'ghl-write').length;
    while (Date.now() < exp3 + 1000) await sleep(100);
    await until(() => shown(X, 'read-access-recovery'), 10000);
    const xs = await X.evaluate(() => { const el = document.querySelector('[data-testid="one-login-app"]'); return { app: el ? getComputedStyle(el).visibility : 'unmounted' }; });
    check('L9 at expiresAt + 1 s the overlay is shown: "Your 30-day session has ended. Sign in to continue — your unsaved work is still here."; no signed-in status line; the app is not painted',
      await shown(X, 'read-access-recovery') && (await msgText(X)) === 'Your 30-day session has ended. Sign in to continue — your unsaved work is still here.' &&
      !(await shown(X, 'read-access-signed-in')) && !(await shown(X, 'route')) && xs.app === 'hidden' && await overlayOnTop(X, 'read-access-recovery'));
    check('L9 the server agrees: the status answer for this cookie is signed_out (never signed in after expiresAt)', (await serverStatus()).signedIn === false &&
      log.filter((e) => e.tab === 'X' && e.fn === 'app-read-session' && e.method === 'GET').slice(-1)[0].state === 'signed_out');
    check('L9 the expired overlay keeps the typed draft (the app stays mounted, never remounted)', (await draftValue(X)) === 'Seller agreed to 142k, wants a 30-day close -- NOT saved' && (await mounts(X)) === 1);
    check('L9 the overlay is aria-modal over an inert app root', (await X.getByTestId('read-access-recovery').getByRole('dialog').getAttribute('aria-modal', { timeout: 3000 }).catch(() => null)) === 'true' && await rootInert(X));
    {
      const inside = [];
      for (let i = 0; i < 6; i += 1) { await X.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab'); inside.push(await X.evaluate(() => !!document.activeElement.closest('[data-iaos-layer]'))); }
      await X.getByTestId('draft').focus().catch(() => {});
      check('L10 focus trap: Tab / Shift+Tab stay inside the overlay, and the inert draft cannot take focus', inside.every(Boolean) && (await activeTestId(X)) !== 'draft', inside);
    }
    {
      const r = await X.evaluate(async () => { const m = await import('/src/lib/app-write-session.ts'); try { await m.appWriteFetch('/.netlify/functions/ghl-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'note.create', targetId: 'x', requestId: 'expired-1', args: { body: 'should never apply' } }) }); return 'sent'; } catch (e) { return 'refused:' + e.message; } });
      check('L9 writes refused after expiry: a save is refused before sending ("Saving paused…"), nothing reaches a writer, nothing is applied',
        r.startsWith('refused:Saving paused') && log.filter((e) => e.tab === 'X' && e.fn === 'ghl-write').length === xWrites && !applied.some((a) => a.body === 'should never apply'), r);
    }
    await shot(X, 'overlay-expired-1440x900.png');
    const oldSid3 = jarSid();
    await signInViaPopup(ctx3, X);
    await until(async () => !(await shown(X, 'read-access-recovery')) && await shown(X, 'route'));
    await until(async () => (await activeTestId(X)) === 'draft' && await shown(X, 'read-access-signed-in'), 10000);
    await settled(X);
    check('L11 after re-sign-in the same page shows the same draft (same route, not remounted, nothing re-sent)',
      (await draftValue(X)) === 'Seller agreed to 142k, wants a 30-day close -- NOT saved' && (await txt(X, 'route')) === '/ws/seller-call/42?tab=notes' &&
      (await mounts(X)) === 1 && log.filter((e) => e.tab === 'X' && e.fn === 'ghl-write').length === xWrites);
    check('L11 the overlay is gone, the app root is no longer inert, and focus is back in the draft', !(await rootInert(X)) && (await activeTestId(X)) === 'draft');
    check('L11 the re-sign-in is a NEW session (new sid) and the status line is back', jarSid() !== oldSid3 && await shown(X, 'read-access-signed-in'));
    await ctx3.close();

    // ════════════════ 4. 5-day boundary, Remind Me Later ════════════════
    await signInJar();
    const exp4 = signedInAgo(25 * DAY - 4000);   // T5 is 4 s away
    const T5 = exp4 - 5 * DAY;
    const ctx4 = await newCtx();
    const R = await newTab(ctx4, 'R');
    await until(() => shown(R, 'draft'));
    const decidedBeforeT5 = await reminderDecided(R);
    check('L12 no reminder before T5 (expiry 5 days + 4 s away)', decidedBeforeT5 && Date.now() < T5 && !(await shown(R, 'session-reminder')), { decidedBeforeT5, msToT5: T5 - Date.now() });
    await until(() => shown(R, 'session-reminder'), 10000);
    check('L12 at T5 the 5-day reminder appears with no reload (timer to the checkpoint): "Your IAOS session expires within 5 days. …"; Remind Me Later + Log In Again',
      Date.now() >= T5 && ((await txt(R, 'session-reminder-text')) || '') === 'Your IAOS session expires within 5 days. Log in again now to keep your workflow uninterrupted.' &&
      await shown(R, 'session-reminder-later') && await shown(R, 'session-reminder-log-in') && (await R.getByTestId('session-reminder').getAttribute('aria-modal', { timeout: 3000 }).catch(() => null)) === 'true' && await rootInert(R));
    await shot(R, 'reminder-5-day-1440x900.png');
    const before = log.length; const cookiesBefore = setCookies.length; const statusBeforeLater = await serverStatus();
    await R.getByTestId('session-reminder-later').click({ timeout: 8000 }).catch(() => {});
    const closedLater = await until(async () => !(await shown(R, 'session-reminder')), 10000);
    const settledLater = (await settled(R)) && (await settled(R));
    // Bones P2-2 (280a974): count EXACTLY. (1) Up to the barrier the dismissal has added NO request. (2) The barrier is
    // ONE explicit status check this test triggers; after it is answered the only new request is that check -- so an
    // extra status GET caused by the dismissal (control N48) or any other request (control U2) fails the check.
    const preBarrier = log.slice(before);
    const barrierAt = statusAnswersFor('R');
    await R.evaluate(() => window.dispatchEvent(new Event('focus')));
    const barrierAnswered = await until(() => statusAnswersFor('R') > barrierAt, 20000);
    const settledBarrier = (await settled(R)) && (await settled(R));
    const statusAfterLater = await serverStatus();
    const sinceLater = log.slice(before);
    check('L13 Remind Me Later sends no request and changes no cookie; the server expiresAt is unchanged',
      closedLater && settledLater && barrierAnswered && settledBarrier &&
      preBarrier.length === 0 && sinceLater.length === 1 &&
      sinceLater[0].tab === 'R' && sinceLater[0].fn === 'app-read-session' && sinceLater[0].method === 'GET' &&
      setCookies.length === cookiesBefore && statusAfterLater.expiresAt === statusBeforeLater.expiresAt && Date.parse(statusAfterLater.expiresAt) === exp4,
      { closedLater, settledLater, barrierAnswered, settledBarrier, preBarrier: preBarrier.map((e) => `${e.tab} ${e.method} ${e.fn}`),
        requests: sinceLater.map((e) => `${e.tab} ${e.method} ${e.fn}`), before: statusBeforeLater.expiresAt, after: statusAfterLater.expiresAt });
    check('L13 Remind Me Later closes the reminder; the app is interactive again', !(await shown(R, 'session-reminder')) && !(await rootInert(R)));
    await R.getByTestId('nav-pipeline').click({ timeout: 8000 }).catch(() => {});
    await until(async () => (await txt(R, 'route')) === '/ws/pipeline');
    const decidedNav = await reminderDecided(R);
    check('L13 Remind Me Later: no re-show after navigation', decidedNav && (await txt(R, 'route')) === '/ws/pipeline' && !(await shown(R, 'session-reminder')), { decidedNav });
    const reloadAt = statusAnswersFor('R');
    await R.reload();
    await until(() => shown(R, 'draft'));
    // A FRESH status answer after the reload, then the reminder decision for it.
    const freshAfterReload = await until(() => statusAnswersFor('R') > reloadAt, 20000);
    const decidedReload = await reminderDecided(R);
    check('L13 Remind Me Later: no re-show after reload', freshAfterReload && decidedReload && await shown(R, 'draft') && !(await shown(R, 'session-reminder')), { freshAfterReload, decidedReload });
    const R2 = await newTab(ctx4, 'R2', '/ws/pipeline');
    await until(() => shown(R2, 'draft'));
    const freshR2 = await until(() => statusAnswersFor('R2') > 0, 20000);
    const decidedR2 = await reminderDecided(R2);
    check('L13 Remind Me Later: no re-show in another tab of the same browser', freshR2 && decidedR2 && !(await shown(R2, 'session-reminder')), { freshR2, decidedR2 });
    check('L13 nothing on the way extended the session (server expiresAt still the original)', Date.parse((await serverStatus()).expiresAt) === exp4 &&
      log.filter((e) => (e.tab === 'R' || e.tab === 'R2') && e.fn === 'app-read-session' && e.expiresAt).every((e) => Date.parse(e.expiresAt) === exp4));
    await ctx4.close();

    // ════════════════ 5. 1-day boundary after a 5-day dismissal (memory fallback: storage throws); Log In Again + Cancel ════════════════
    await signInJar();
    const exp5 = signedInAgo(29 * DAY - 5000);   // T1 is 5 s away; T5 has passed
    const T1 = exp5 - DAY;
    const ctx5 = await newCtx();
    await ctx5.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('fixture', 'QuotaExceededError'); }; Storage.prototype.getItem = function () { throw new DOMException('fixture', 'SecurityError'); }; });
    const L = await newTab(ctx5, 'L');
    await until(() => shown(L, 'session-reminder'));
    check('L12 only the latest due checkpoint, and a late visit never overstates: between T5 and T1, 1 day + 5 s left, the 5-day reminder says "within 2 days"', Date.now() < T1 && ((await txt(L, 'session-reminder-text')) || '').includes('expires within 2 days.'));
    await L.getByTestId('session-reminder-later').click({ timeout: 8000 }).catch(() => {});
    await L.getByTestId('nav-pipeline').click({ timeout: 8000 }).catch(() => {});
    const navL = await until(async () => (await txt(L, 'route')) === '/ws/pipeline', 20000);
    const decidedL = await reminderDecided(L);
    check('L14 storage unavailable: the dismissal is kept in memory (no re-show on navigation)', navL && decidedL && !(await shown(L, 'session-reminder')), { navL, decidedL });
    await L.getByTestId('draft').click({ timeout: 8000 }).catch(() => {});
    await L.getByTestId('draft').fill('typed before the 1-day reminder', { timeout: 8000 }).catch(() => {});
    await until(() => shown(L, 'session-reminder'), 10000);
    check('L12 at T1 the 1-day reminder appears (a different checkpoint is not covered by the 5-day dismissal)',
      Date.now() >= T1 && ((await txt(L, 'session-reminder-text')) || '') === 'Your IAOS session expires within 24 hours. Log in again now to keep your workflow uninterrupted.');
    check('L15 the reminder is modal: the app behind it is inert and keeps its draft', await rootInert(L) && (await draftValue(L)) === 'typed before the 1-day reminder');
    await L.getByTestId('session-reminder-log-in').click({ timeout: 8000 }).catch(() => {});
    await until(() => shown(L, 'one-login-relogin'));
    check('L15 Log In Again opens the sign-in overlay above the mounted, inert app (aria-modal, Sign In to IAOS + Cancel)',
      await shown(L, 'one-login-relogin') && await rootInert(L) && (await L.getByTestId('one-login-relogin').getByRole('dialog').getAttribute('aria-modal', { timeout: 3000 }).catch(() => null)) === 'true' &&
      await shown(L, 'one-login-sign-in') && await shown(L, 'one-login-cancel') && (await mounts(L)) === 1 && (await draftValue(L)) === 'typed before the 1-day reminder');
    await shot(L, 'overlay-log-in-again-1440x900.png');
    { const n = log.length; const sid = jarSid();
      await L.getByTestId('one-login-cancel').click({ timeout: 8000 }).catch(() => {});
      await until(async () => !(await shown(L, 'one-login-relogin')) && (await activeTestId(L)) === 'draft', 10000);
      await settled(L);
      check('L15 Cancel closes the overlay without touching the session (no request, same sid); focus back in the draft',
        !(await shown(L, 'one-login-relogin')) && !(await rootInert(L)) && log.length === n && jarSid() === sid && (await activeTestId(L)) === 'draft'); }
    await ctx5.close();

    // ════════════════ 5b. Log In Again end to end (working storage) ════════════════
    await signInJar();
    const exp6 = signedInAgo(29 * DAY - 5000);
    const ctx6 = await newCtx();
    const G = await newTab(ctx6, 'G');
    await until(() => shown(G, 'session-reminder'));
    await G.getByTestId('session-reminder-later').click({ timeout: 8000 }).catch(() => {});
    await G.getByTestId('draft').click({ timeout: 8000 }).catch(() => {});
    await G.getByTestId('draft').fill('Seller call notes kept through Log In Again', { timeout: 8000 }).catch(() => {});
    await until(() => shown(G, 'session-reminder'), 10000);   // the 1-day checkpoint
    await shot(G, 'reminder-1-day-1440x900.png');
    await G.getByTestId('session-reminder-log-in').click({ timeout: 8000 }).catch(() => {});
    await until(() => shown(G, 'one-login-relogin'));
    const oldSid6 = jarSid();
    const beforeLogIn = Date.now();
    await signInViaPopup(ctx6, G);
    await until(async () => !(await shown(G, 'one-login-relogin')));
    await until(async () => jarSid() !== oldSid6 && await shown(G, 'read-access-signed-in') && (await activeTestId(G)) === 'draft', 20000);
    await reminderDecided(G);
    const st6 = await serverStatus();
    const newExp = Date.parse(st6.expiresAt);
    check('L15 Log In Again: a NEW session (new sid) whose server expiresAt is 30 days out (not the old one, not extended in place)',
      jarSid() !== oldSid6 && Math.abs(newExp - (beforeLogIn + 30 * DAY)) <= 15_000 && newExp > exp6, { oldSid6, newSid: jarSid(), newExp: st6.expiresAt, old: new Date(exp6).toISOString() });
    check('L15 the old session is left to expire, not revoked (its store record is still active)',
      (blobs.get('iaos-write-receipts', rev.sessionKey('test', oldSid6)) || {}).text === rev.sessionRecordText('test', EPOCH, oldSid6, 'active'));
    check('L15 back on the same page with the draft intact and focus restored; no reminder for the new session',
      (await draftValue(G)) === 'Seller call notes kept through Log In Again' && (await txt(G, 'route')) === '/ws/seller-call/42?tab=notes' &&
      (await mounts(G)) === 1 && !(await rootInert(G)) && (await activeTestId(G)) === 'draft' && !(await shown(G, 'session-reminder')));
    await G.getByTestId('save').click({ timeout: 8000 }).catch(() => {});
    await until(async () => ((await txt(G, 'save-result')) || '') !== '');
    check('L15 the next save under the new session is sent once and applied', ((await txt(G, 'save-result')) || '') === 'Save answered 200' &&
      applied.filter((a) => a.body === 'Seller call notes kept through Log In Again').length === 1);
    await ctx6.close();

    // ════════════════ 6. Logout: this tab -> entrance; the other tab -> overlay on its next protected request ════════════════
    await signInJar();
    const ctx7 = await newCtx();
    const LA = await newTab(ctx7, 'LA');
    const LB = await newTab(ctx7, 'LB', '/ws/pipeline');
    await until(async () => await shown(LA, 'draft') && await shown(LB, 'draft'));
    await LB.getByTestId('draft').fill('tab B notes, unsaved', { timeout: 8000 }).catch(() => {});
    await until(async () => log.filter((e) => e.tab === 'LB' && e.fn === 'app-write-token' && e.status === 200).length >= 1);
    await LA.getByRole('button', { name: 'Sign out' }).click({ timeout: 8000 }).catch(() => {});
    await until(() => shown(LA, 'one-login-entrance'));
    check('L16 Logout (server-confirmed): this tab shows the entrance screen with "You\'ve signed out of IAOS." and the Sign In button; the page is gone',
      await shown(LA, 'one-login-entrance') && (await msgText(LA)) === "You've signed out of IAOS." && await shown(LA, 'one-login-sign-in') && (await LA.getByTestId('draft').count()) === 0 &&
      log.filter((e) => e.fn === 'app-signout' && e.status === 200).length === 1);
    await LB.getByTestId('save').click({ timeout: 8000 }).catch(() => {});
    await until(() => shown(LB, 'read-access-recovery'));
    check('L16 the other tab: its next protected request (a save) is refused by the server and the overlay says "You\'ve signed out of IAOS."; its draft is kept',
      await shown(LB, 'read-access-recovery') && (await msgText(LB)) === "You've signed out of IAOS." && (await draftValue(LB)) === 'tab B notes, unsaved' && !applied.some((a) => a.body === 'tab B notes, unsaved'));
    await ctx7.close();

    // ════════════════ 7. outage while signed in ════════════════
    await signInJar();
    const ctx8 = await newCtx();
    const U = await newTab(ctx8, 'U');
    await until(() => shown(U, 'draft'));
    await U.getByTestId('draft').fill('kept through an outage', { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 12; i += 1) blobs.rule({ method: 'PUT', status: 500 });
    await U.evaluate(() => window.dispatchEvent(new Event('focus')));
    await until(() => shown(U, 'one-login-try-again'));
    check('L17 signed-in outage is never a sign-in prompt: the overlay says "IAOS sign-in is temporarily unavailable. Try again." with Try again, no sign-in button, not "signed out"',
      await shown(U, 'read-access-recovery') && (await msgText(U)) === 'IAOS sign-in is temporarily unavailable. Try again.' &&
      (await U.getByRole('button', { name: /sign in/i }).count()) === 0 && !(await has(U, 'signed out')) && (await draftValue(U)) === 'kept through an outage');
    blobs.clearRules();
    await U.getByTestId('one-login-try-again').click({ timeout: 5000 }).catch(() => {});   // absent under a mutation: the next check reports it
    await until(() => shown(U, 'route'));
    check('L17 Try again (store back): the same page and draft', (await draftValue(U)) === 'kept through an outage' && (await mounts(U)) === 1);
    await ctx8.close();

    // ════════════════ 8. r4: session replacement isolation (A->A, A->B), logout after replacement, delayed answers ════════════════
    const tokSid = (t) => JSON.parse(Buffer.from(String(t).replace(/^Bearer /, '').split('.')[1], 'base64url')).sid;
    const tokSub = (t) => JSON.parse(Buffer.from(String(t).replace(/^Bearer /, '').split('.')[1], 'base64url')).sub;
    /** Sign in, wait for the 1-day reminder (T1 a few seconds away), type a draft, save once; returns at the reminder. */
    const toT1WithDraft = async (ctx, tab, draft) => {
      await signInJar(); signedInAgo(29 * DAY - 5000);
      const p = await newTab(ctx, tab);
      await until(() => shown(p, 'session-reminder'));
      await p.getByTestId('session-reminder-later').click({ timeout: 8000 }).catch(() => {});
      await p.getByTestId('draft').click({ timeout: 8000 }).catch(() => {});
      await p.getByTestId('draft').fill(draft, { timeout: 8000 }).catch(() => {});
      await p.getByTestId('save').click({ timeout: 8000 }).catch(() => {});
      await until(async () => ((await txt(p, 'save-result')) || '') === 'Save answered 200');
      await until(() => shown(p, 'session-reminder'), 12000);   // the 1-day checkpoint
      return p;
    };
    {
      const ctx9 = await newCtx();
      const Q = await toT1WithDraft(ctx9, 'Q', 'A-to-A unsaved seller notes');
      const oldSid = jarSid();
      // A pending mint under the OLD session (held), and a delayed OLD status answer (held, "signed in" + the old handle).
      const mintHold = hold('app-write-token');
      await Q.evaluate(async () => { const m = await import('/src/lib/app-write-session.ts'); m.clearAppWriteToken(); m.primeAppWriteSession(); });
      await until(() => mintHold.entered);
      const statusHold = hold('app-read-session', 'GET');
      await Q.evaluate(() => window.dispatchEvent(new Event('focus')));
      await until(() => statusHold.entered);
      const heldMint = log.filter((e) => e.held && e.fn === 'app-write-token').slice(-1)[0];
      await Q.getByTestId('session-reminder-log-in').click({ timeout: 8000 }).catch(() => {});
      await until(() => shown(Q, 'one-login-relogin'));
      await signInViaPopup(ctx9, Q);
      await until(async () => !(await shown(Q, 'one-login-relogin')) && await shown(Q, 'read-access-signed-in'));
      const newSid = jarSid();
      const ansMint = await answers(Q, 'app-write-token'); const ansStatus = await answers(Q, 'app-read-session');
      mintHold.release(); statusHold.release();
      // The delayed OLD answers have actually reached the page (route fulfilled AND counted by the page), then settle.
      // Bones P2-1 (280a974): the delivery wait's result is CONSUMED -- a missing or late-past-deadline answer fails here
      // (and the stale-answer check below), never passes on an unchanged screen.
      const delivered19 = await until(async () => mintHold.fulfilled && statusHold.fulfilled &&
        (await answers(Q, 'app-write-token')) > ansMint && (await answers(Q, 'app-read-session')) > ansStatus, 20000);
      const settled19 = (await settled(Q)) && (await settled(Q));
      check('L19 prerequisite: the delayed OLD mint and status answers were delivered to the page and processed',
        delivered19 && settled19 && !!mintHold.fulfilled && !!statusHold.fulfilled,
        { delivered19, settled19, mintFulfilled: !!mintHold.fulfilled, statusFulfilled: !!statusHold.fulfilled, answers: { mint: await answers(Q, 'app-write-token'), status: await answers(Q, 'app-read-session'), ansMint, ansStatus } });
      check('L19 A->A Log In Again: a NEW session; the same page (not remounted) keeps the unsaved draft; no account-changed notice',
        newSid !== oldSid && (await draftValue(Q)) === 'A-to-A unsaved seller notes' && (await mounts(Q)) === 1 && !(await shown(Q, 'one-login-account-changed')) &&
        await shown(Q, 'read-access-signed-in'), { oldSid, newSid, mounts: await mounts(Q) });
      check('L19 the delayed OLD status answer delivered after the replacement is discarded (still signed in, no overlay)',
        delivered19 && settled19 && await shown(Q, 'read-access-signed-in') && !(await shown(Q, 'read-access-recovery')), { delivered19, settled19 });
      const n = log.filter((e) => e.tab === 'Q' && e.fn === 'ghl-write').length;
      await Q.getByTestId('save').click({ timeout: 8000 }).catch(() => {});
      // The write's log entry exists before its status is recorded: wait for the STATUS, not just the entry.
      await until(async () => { const a = log.filter((e) => e.tab === 'Q' && e.fn === 'ghl-write').slice(n); return a.length === 1 && a[0].status !== undefined; });
      const after = log.filter((e) => e.tab === 'Q' && e.fn === 'ghl-write').slice(n);
      check('L19 the PENDING old-session mint answered after the replacement is never used: the next save carries a token freshly minted under the NEW session',
        after.length === 1 && after[0].status === 200 && heldMint && heldMint.token && tokSid(heldMint.token) === oldSid &&
        after[0].auth !== `Bearer ${heldMint.token}` && tokSid(after[0].auth) === newSid,
        { after: after.map((e) => ({ status: e.status, sid: e.auth && tokSid(e.auth) })), oldSid, newSid });
      check('L19 after the replacement no write carried an old-session token', log.filter((e) => e.tab === 'Q' && e.fn === 'ghl-write').slice(n).every((e) => tokSid(e.auth) === newSid));
      await Q.getByRole('button', { name: 'Sign out' }).click({ timeout: 8000 }).catch(() => {});
      await until(() => shown(Q, 'one-login-entrance'));
      check('L20 logout after the replacement revokes the NEW session (the handle came from the new status answer); the replaced session is left to expire (still active)',
        (blobs.get('iaos-write-receipts', rev.sessionKey('test', newSid)) || {}).text === rev.sessionRecordText('test', EPOCH, newSid, 'revoked') &&
        (blobs.get('iaos-write-receipts', rev.sessionKey('test', oldSid)) || {}).text === rev.sessionRecordText('test', EPOCH, oldSid, 'active'));
      await ctx9.close();
    }
    {
      const ctx10 = await newCtx();
      const W = await toT1WithDraft(ctx10, 'W', "operator A's private draft");
      const oldSid = jarSid();
      await W.evaluate(() => { try { sessionStorage.setItem('iaos.dispositionOverride.v1', '{"fixture":{"disposition":"A data","at":"x"}}'); } catch { /* storage */ } });
      await W.getByTestId('session-reminder-log-in').click({ timeout: 8000 }).catch(() => {});
      await until(() => shown(W, 'one-login-relogin'));
      googleEmail = 'second@example.invalid';
      await signInViaPopup(ctx10, W);
      await until(() => shown(W, 'one-login-account-changed'));
      googleEmail = 'brad@example.invalid';
      const newSid = jarSid();
      check('L21 A->B: a neutral notice says the account changed and that the previous account\'s unsaved work was cleared',
        await shown(W, 'one-login-account-changed') && await has(W, 'Signed in with a different account') &&
        await has(W, 'Unsaved work from the previous account was cleared from this page.') && claims().sub === 'second@example.invalid' && newSid !== oldSid);
      await W.getByTestId('one-login-account-continue').click({ timeout: 8000 }).catch(() => {});
      await until(async () => !(await shown(W, 'one-login-account-changed')));
      check('L21 A->B: the routed app was REMOUNTED -- A\'s draft is gone; the deep link is kept; signed in',
        (await draftValue(W)) === '' && (await mounts(W)) === 2 && (await txt(W, 'route')) === '/ws/seller-call/42?tab=notes' && await shown(W, 'read-access-signed-in'),
        { draft: await draftValue(W), mounts: await mounts(W) });
      check('L21 A->B: operator-scoped page data (session-local overrides) was cleared', (await W.evaluate(() => { try { return sessionStorage.getItem('iaos.dispositionOverride.v1'); } catch { return 'unreadable'; } })) === null);
      await W.getByTestId('draft').fill('operator B note', { timeout: 8000 }).catch(() => {});
      const n = log.filter((e) => e.tab === 'W' && e.fn === 'ghl-write').length;
      await W.getByTestId('save').click({ timeout: 8000 }).catch(() => {});
      await until(async () => ((await txt(W, 'save-result')) || '') === 'Save answered 200');
      const w = log.filter((e) => e.tab === 'W' && e.fn === 'ghl-write').slice(n);
      check('L21 A->B: B\'s save carries a token of B\'s NEW session (sub B, new sid); A\'s token is never sent under B',
        w.length === 1 && tokSub(w[0].auth) === 'second@example.invalid' && tokSid(w[0].auth) === newSid, w.map((e) => e.auth && [tokSub(e.auth), tokSid(e.auth)]));
      await W.getByRole('button', { name: 'Sign out' }).click({ timeout: 8000 }).catch(() => {});
      await until(() => shown(W, 'one-login-entrance'));
      check('L21 A->B then Sign out: B\'s session is revoked; A\'s replaced session was left to expire',
        (blobs.get('iaos-write-receipts', rev.sessionKey('test', newSid)) || {}).text === rev.sessionRecordText('test', EPOCH, newSid, 'revoked') &&
        (blobs.get('iaos-write-receipts', rev.sessionKey('test', oldSid)) || {}).text === rev.sessionRecordText('test', EPOCH, oldSid, 'active'));
      await ctx10.close();
    }
    {
      // Delayed status ordering, one session: an OLDER "signed in" answer delivered after a NEWER "revoked" one.
      await signInJar();
      const ctx11 = await newCtx();
      const V = await newTab(ctx11, 'V');
      await until(() => shown(V, 'draft'));
      await V.getByTestId('draft').fill('kept under the revoked overlay', { timeout: 8000 }).catch(() => {});
      const late = hold('app-read-session', 'GET');
      await V.evaluate(() => window.dispatchEvent(new Event('focus')));
      await until(() => late.entered);
      const lateEntry = log.filter((e) => e.held && e.tab === 'V' && e.fn === 'app-read-session').slice(-1)[0];
      const c = claims();
      if ((await rev.revokeSession(c.sid, c.epoch, 'test', { event: { headers: { 'x-nf-site-id': SITE }, blobs: blobs.lambdaBlobs } })).kind !== 'verified') throw new Error('fixture revoke failed');
      await V.evaluate(() => window.dispatchEvent(new Event('focus')));
      await until(() => shown(V, 'read-access-recovery'));
      const overlayFirst = await shown(V, 'read-access-recovery');
      // Jeff (N40 not caught on 3311102): an end-state check missed a TRANSIENT repaint -- under the mutation the late
      // "signed in" applied, then a follow-up check re-showed the overlay within the wait. Record EVERY DOM change in the
      // window: the signed-in line must never appear and the overlay must never leave.
      await V.evaluate(() => {
        const w = window; w.__l22 = { sawSignedIn: false, overlayGone: false, mutations: 0 };
        const probe = () => {
          w.__l22.mutations += 1;
          if (document.querySelector('[data-testid="read-access-signed-in"]')) w.__l22.sawSignedIn = true;
          if (!document.querySelector('[data-testid="read-access-recovery"]')) w.__l22.overlayGone = true;
        };
        w.__l22o = new MutationObserver(probe);
        w.__l22o.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      });
      const ansLate = await answers(V, 'app-read-session');
      late.release();
      // The late answer has reached the page and been processed (observer still recording every DOM change).
      // Bones P2-1 (280a974): delivery is a REQUIRED prerequisite (consumed, not discarded); the observer stays connected
      // until the answer has been delivered AND processed (settled), and only then is read.
      const delivered22 = await until(async () => late.fulfilled && (await answers(V, 'app-read-session')) > ansLate, 20000);
      const settled22 = (await settled(V)) && (await settled(V)) && (await settled(V));
      const answers22 = await answers(V, 'app-read-session');
      const l22 = await V.evaluate(() => { const w = window; w.__l22o.disconnect(); return w.__l22; });
      check('L22 prerequisite: the late "signed in" answer was delivered to the page and processed while observed',
        delivered22 && settled22 && !!late.fulfilled && answers22 > ansLate && l22 && l22.mutations >= 0,
        { delivered22, settled22, fulfilled: !!late.fulfilled, answers22, ansLate });
      check('L22 delayed status: an OLDER "signed in" answer delivered after a NEWER "revoked" one is discarded -- the overlay stays, no signed-in status line repaints (not even transiently)',
        delivered22 && settled22 && !!late.fulfilled && answers22 > ansLate &&
        lateEntry && lateEntry.state === 'signed_in' && overlayFirst && await shown(V, 'read-access-recovery') && !(await shown(V, 'read-access-signed-in')) &&
        !l22.sawSignedIn && !l22.overlayGone &&
        (await msgText(V)) === "You've signed out of IAOS." && (await draftValue(V)) === 'kept under the revoked overlay', { delivered22, settled22, l22 });
      await ctx11.close();
    }

    // ════════════════ 9. Jess 2026-11-10: a server-issued Test-scaled session (60 minutes) on the real page ════════════════
    {
      const TESTCFG = cfg.getConfig('test');
      try {
        TESTCFG.oneLoginTestSessionSeconds = 3600;   // in-memory, this process only: the server now ISSUES 60-minute sessions
        await signInJar();
        const realExp = claims().exp; const realIat = claims().iat;
        check('L23 the real sign-in issued a 60-minute session (server lifetime, exp - iat = 3600)', realExp - realIat === 3600, { lifetime: realExp - realIat });
        const MIN = 60_000;
        const exp9 = signedInAgo(50 * MIN - 20000);   // T5 (exp - 10 min) is 20 s away (page start-up included)
        const ctx9 = await newCtx();
        const S9 = await newTab(ctx9, 'S9', '/ws/seller-call/42?tab=notes&sessionSeconds=3600');
        await until(() => shown(S9, 'draft'));
        const status9 = (await txt(S9, 'read-access-signed-in')) || '';
        check('L24 the status line says Test session and shows the end TIME of the 60-minute session',
          /^Signed in · Test session ends \d{1,2}:\d{2}/.test(status9), { status9 });
        const decided9 = await reminderDecided(S9);
        check('L24 no reminder before the scaled T5 (exp - 10 min)', decided9 && Date.now() < exp9 - 10 * MIN && !(await shown(S9, 'session-reminder')), { decided9, msToT5: exp9 - 10 * MIN - Date.now() });
        await until(() => shown(S9, 'session-reminder'), 30000);
        check('L25 at the scaled T5 the reminder appears with no reload: "Your IAOS Test session expires within 10 minutes. …"',
          Date.now() >= exp9 - 10 * MIN && ((await txt(S9, 'session-reminder-text')) || '') === 'Your IAOS Test session expires within 10 minutes. Log in again now to keep your workflow uninterrupted.',
          { text: await txt(S9, 'session-reminder-text') });
        await S9.getByTestId('session-reminder-later').click({ timeout: 8000 }).catch(() => {});
        await until(async () => !(await shown(S9, 'session-reminder')), 10000);
        await S9.getByTestId('draft').click({ timeout: 8000 }).catch(() => {});
        await S9.getByTestId('draft').fill('kept through the Test expiry', { timeout: 8000 }).catch(() => {});
        // T1 (exp - 2 min) 4 s away, then the expiry itself: the overlay with the Test copy, and the draft is kept.
        const exp9b = signedInAgo(58 * MIN - 4000);
        await S9.evaluate(() => window.dispatchEvent(new Event('focus')));
        // The re-issued session has a NEW expiry, so its own T5 is due first (dismiss it); then the T1 checkpoint arrives.
        await until(async () => {
          if (!(await shown(S9, 'session-reminder'))) return false;
          if (((await txt(S9, 'session-reminder-text')) || '') === 'Your IAOS Test session expires within 2 minutes. Log in again now to keep your workflow uninterrupted.') return true;
          await S9.getByTestId('session-reminder-later').click({ timeout: 3000 }).catch(() => {}); return false;
        }, 20000);
        check('L26 at the scaled T1 the reminder says "within 2 minutes" (never days or 24 hours)',
          Date.now() >= exp9b - 2 * MIN && ((await txt(S9, 'session-reminder-text')) || '') === 'Your IAOS Test session expires within 2 minutes. Log in again now to keep your workflow uninterrupted.',
          { text: await txt(S9, 'session-reminder-text') });
        await S9.getByTestId('session-reminder-later').click({ timeout: 8000 }).catch(() => {});
        signedInAgo(60 * MIN - 3000);   // the server's expiry is 3 s away
        await S9.evaluate(() => window.dispatchEvent(new Event('focus')));
        await until(() => shown(S9, 'read-access-recovery'), 20000);
        check('L27 past the scaled expiry the server refuses (status signed_out) and the page shows the overlay with the Test copy; the unsaved draft stays',
          (await serverStatus()).state === 'signed_out' && (await msgText(S9)) === 'Your Test session has ended. Sign in to continue — your unsaved work is still here.' &&
          (await draftValue(S9)) === 'kept through the Test expiry', { msg: await msgText(S9), draft: await draftValue(S9) });
        await ctx9.close();
      } finally { TESTCFG.oneLoginTestSessionSeconds = null; }
    }

    check('L0 nothing left the machine: no outbound request other than the stubbed Google script', outbound.length === 0, outbound);
    if (checks < 73) { failures += 1; console.error(`FAIL  check floor -- ${checks} checks ran, the floor is 73`); }
    if (failedNames.length) console.error(`FAILED CHECKS (${failedNames.length}): ${failedNames.map((n) => JSON.stringify(n)).join(' | ')}`);
    console.log(`B15-29 login experience (real page): ${checks - failures}/${checks} checks passed`);
    await exit(failures ? 1 : 0);
  } catch (e) {
    console.error('FAIL  suite aborted -- ' + (e && e.stack));
    await exit(1);
  }
}
main();
