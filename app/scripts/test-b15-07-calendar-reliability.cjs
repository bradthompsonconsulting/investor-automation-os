/**
 * B15-07 (INV-106) -- calendar reliability: an unavailable calendar is never shown as an empty one, each failure is
 * named for what it is, a failed refresh keeps the last good read visible but labelled, and GHL's own Calendars are
 * always one click away. Read-only.
 *
 * Offline (fictional data; every request is a fixture; nothing leaves the machine):
 *   U  the pure classifier (src/lib/calendar-read-state.ts);
 *   S  the REAL ghl-calendar-events handler (unchanged by this work) with a stubbed GHL -- regression of the server
 *      contract the page relies on (no partial result, access-denied code, read-session boundary, GET only);
 *   R  the REAL App (scripts/harness/app-routes) on /calendars in headless Chromium;
 *   X  source checks.
 *
 * NEGATIVE CONTROL: `node scripts/test-b15-07-calendar-reliability.cjs --before=<rev>` renders <rev>'s Calendars page
 * (and classifier, if any) and must FAIL (exit 1).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
const HARNESS_DIR = path.join(APP, 'scripts/harness/app-routes');
const HARNESS = '/scripts/harness/app-routes/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const APP_BEFORE = path.join(HARNESS_DIR, 'AppBefore.tsx');
const CAL_BEFORE = path.join(HARNESS_DIR, 'CalendarsBefore.tsx');
const STATE_BEFORE = path.join(APP, 'src', 'lib', '_b15_07_before_calendar_state.ts');

/** Literal check() call sites: U 2 + S 8 + R 10 + X 1 = 21. */
const FLOOR = 21;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`);
}
const tryOr = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const cleanup = () => [APP_BEFORE, CAL_BEFORE, STATE_BEFORE].forEach((f) => { if (fs.existsSync(f)) fs.rmSync(f); });
cleanup(); process.on('exit', cleanup);
const show = (p) => execFileSync('git', ['show', `${BEFORE}:app/${p}`], { cwd: APP, encoding: 'utf8' });
const src = (p) => (BEFORE ? tryOr(() => show(p), '') : tryOr(() => fs.readFileSync(path.join(APP, p), 'utf8'), '')).replace(/\r\n/g, '\n');
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) for (const ext of ['.ts', '.tsx']) { const c = path.resolve(path.dirname(parent.filename), name + ext); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
Object.assign(process.env, {
  IAOS_ENV: 'test', GHL_PRIVATE_API_KEY: 'offline-fixture',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client', IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid', IAOS_APP_READ_ALLOWED_ORIGIN: 'https://proof.example.invalid',
});
const cfg = require('../shared/ghl-config.ts');
cfg.getConfig('test').supplementalReadBudget = { enabled: cfg.SUPPLEMENTAL_READ_BUDGET_DISABLED, budgetId: 'offline-disabled', ceiling: 0 };
const TEST_LOCATION = cfg.getConfig('test').locationId;
const readAuth = require('../netlify/functions/lib/app-read-auth.ts');
const COOKIE = `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;
const DAY = 86_400_000;
const evAt = (d, h) => new Date(Date.now() + d * DAY + h * 3_600_000).toISOString();

async function main() {
  // ───────────────────────── U: the pure classifier ─────────────────────────
  const stateSrc = BEFORE ? tryOr(() => show('src/lib/calendar-read-state.ts'), null) : null;
  if (stateSrc) fs.writeFileSync(STATE_BEFORE, stateSrc);
  const CS = BEFORE ? (stateSrc ? tryOr(() => require(STATE_BEFORE), null) : null) : tryOr(() => require('../src/lib/calendar-read-state.ts'), null);
  const kinds = ['ghl_calendar_access_denied', 'iaos_read_sign_in_required', 'iaos_read_unconfigured', null, 'supplemental_read_exhausted', 'x'].map((c) => tryOr(() => CS.calendarFailureKind(c), null));
  check('U1 each failure is named: GHL access denied, IAOS sign-in, IAOS unconfigured; anything else is temporary', JSON.stringify(kinds) === JSON.stringify(['access_denied', 'sign_in', 'unconfigured', 'temporary', 'temporary', 'temporary']), kinds);
  const rc = [[401, 'iaos-app-read-auth'], [503, 'iaos-app-read-unconfigured'], [401, undefined], [503, 'other'], [500, 'iaos-app-read-auth']].map(([s, b]) => tryOr(() => CS.readAuthCode(s, b), 'ERR'));
  check('U2 only the read-auth boundary\'s own markers count as IAOS sign-in states; a bare 401/503 (e.g. from GHL) never does', JSON.stringify(rc) === JSON.stringify(['iaos_read_sign_in_required', 'iaos_read_unconfigured', null, null, null]), rc);

  // ───────────────────────── S: the real ghl-calendar-events handler ─────────────────────────
  for (const k of Object.keys(require.cache)) if (k.startsWith(FUNCTIONS)) delete require.cache[k];
  const handler = require(path.join(FUNCTIONS, 'ghl-calendar-events.ts')).handler;
  let calls = []; let scenario = {}; const allCalls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const rec = { method: init.method || 'GET', path: u.pathname, cal: u.searchParams.get('calendarId') }; calls.push(rec); allCalls.push(rec);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/calendars/') return scenario.list ? scenario.list() : json({ calendars: [{ id: 'calA', name: 'Seller Calls', isActive: true }, { id: 'calB', name: 'Investor Calls', isActive: true }] });
    if (u.pathname === '/calendars/events') return scenario.events(u.searchParams.get('calendarId'), json);
    throw new Error('unexpected ' + u.pathname);
  };
  const run = async (cookie = COOKIE) => { const r = await handler({ httpMethod: 'GET', headers: cookie ? { cookie } : {}, queryStringParameters: {} }); return { status: r.statusCode, body: tryOr(() => JSON.parse(r.body), r.body) }; };
  scenario = { events: (cal, json) => json({ events: cal === 'calA' ? [{ id: 'e2', calendarId: 'calA', title: 'Seller call — Fixture Two', startTime: evAt(2, 1), endTime: evAt(2, 2), appointmentStatus: 'confirmed', contactId: 'k2' }] : [{ id: 'e1', calendarId: 'calB', title: 'Investor call — Fixture One', startTime: evAt(1, 1), endTime: evAt(1, 2), appointmentStatus: 'confirmed', contactId: 'k1' }] }) };
  calls = []; const s1 = await run();
  check('S1 success: both calendars read and merged oldest-first (200, 2 calendars, 2 events)', s1.status === 200 && s1.body.calendars?.length === 2 && s1.body.events?.map((e) => e.id).join() === 'e1,e2', s1.body);
  scenario = { events: (cal, json) => json({ events: [] }) };
  const s2 = await run();
  check('S2 empty calendars: 200 with 2 calendars and 0 events (a real empty agenda)', s2.status === 200 && s2.body.calendars?.length === 2 && s2.body.events?.length === 0, s2.body);
  scenario = { list: () => new Response(JSON.stringify({ calendars: [] }), { status: 200 }), events: () => { throw new Error('no events read expected'); } };
  const s3 = await run();
  check('S3 no active calendars: 200 with calendars: [] (the page must not call this "no appointments")', s3.status === 200 && s3.body.calendars?.length === 0 && s3.body.events?.length === 0, s3.body);
  scenario = { events: (cal, json) => json({ statusCode: 401, message: 'The token is not authorized for this scope.' }, 401) };
  const s4 = await run();
  check('S4 GHL 401 "token is not authorized for this scope" -> 502 ghl_calendar_access_denied, no events returned', s4.status === 502 && s4.body.code === 'ghl_calendar_access_denied' && !('events' in s4.body), s4.body);
  scenario = { events: (cal, json) => (cal === 'calA' ? json({ events: [{ id: 'eA', startTime: evAt(1, 1), endTime: evAt(1, 2) }] }) : json({ message: 'upstream' }, 500)) };
  const s5 = await run();
  check('S5 a failure after another calendar succeeded -> the whole read fails (500); never a partial or zero agenda', s5.status === 500 && !('events' in (typeof s5.body === 'object' ? s5.body : {})), s5.body);
  scenario = { events: (cal, json) => json({ message: 'Too many requests' }, 429) };
  const s6 = await run();
  check('S6 GHL 429 -> a temporary failure (500, no access-denied code, no events)', s6.status === 500 && s6.body.code === undefined && !('events' in s6.body), s6.body);
  calls = []; const s7 = await run(null);
  check('S7 existing boundary: no IAOS read session -> 401 with the read-auth marker, before ANY GHL request', s7.status === 401 && s7.body?.by === 'iaos-app-read-auth' && calls.length === 0, [s7, calls.length]);
  check('S8 zero writes: every GHL request the calendar function made across S1-S7 was a GET to /calendars/ or /calendars/events',
    allCalls.length >= 8 && allCalls.every((c) => c.method === 'GET' && (c.path === '/calendars/' || c.path === '/calendars/events')), allCalls.map((c) => c.method + ' ' + c.path));

  // ───────────────────────── R: the REAL App on /calendars ─────────────────────────
  if (BEFORE) {
    const repoint = (t) => t.replace(/from "\.\.\//g, 'from "../../../src/').replace(/(from|import) "\.\//g, '$1 "../../../src/pages/')
      .replace(/from "\.\.\/\.\.\/\.\.\/src\/lib\/calendar-read-state"/g, stateSrc ? 'from "../../../src/lib/_b15_07_before_calendar_state"' : 'from "../../../src/lib/calendar-read-state"');
    fs.writeFileSync(CAL_BEFORE, repoint(show('src/pages/Calendars.tsx')));
    fs.writeFileSync(APP_BEFORE, fs.readFileSync(path.join(APP, 'src/App.tsx'), 'utf8')
      .replace('from "./pages/Calendars"', 'from "./CalendarsBefore"').replace(/from "\.\/(?!CalendarsBefore)/g, 'from "../../../src/'));
  }
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const methods = []; const foreign = []; const pageErrors = []; const handoffs = [];
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); cleanup(); process.exit(code); };
  const OK = (events, calendars = [{ id: 'calA', name: 'Seller Calls' }]) => ({ status: 200, body: { window: { startTime: Date.now(), endTime: Date.now() + 30 * DAY }, calendars, events } });
  const EV = (id, title, d) => ({ id, calendarId: 'calA', calendarName: 'Seller Calls', title, startTime: evAt(d, 15), endTime: evAt(d, 16), status: 'confirmed', contactId: 'k-' + id, assignedUserId: '', notes: '' });
  let answers = []; let held = null;
  async function open() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (/^https:\/\/[^/]*(gohighlevel\.com|leadconnectorhq\.com)\//.test(url)) { handoffs.push(url); return route.abort(); }
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (fn === 'app-read-session') return json({ signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (fn === 'ghl-calendar-events') {
        if (held) { await held; held = null; }
        const a = answers.length > 1 ? answers.shift() : answers[0];
        return json(a.body, a.status);
      }
      return json({ error: `fixture: ${fn} not answered` }, 404);
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent('/calendars')}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 60000 });
    return { context, page };
  }
  const text = async (page, sel, want, ms = 15000) => { const t0 = Date.now(); let t = null; while (Date.now() - t0 < ms) { t = await page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel).catch(() => null); if (t && (!want || want.test(t))) return t; await page.waitForTimeout(100); } return t; };
  const bodyText = (page) => page.locator('body').innerText().catch(() => '');
  try {
    // R1 + R2: loading while the read is held, then a success with freshness and the always-visible GHL link
    let release; held = new Promise((r) => { release = r; });
    answers = [OK([EV('a1', 'Seller call — Fixture A', 1), EV('a2', 'Investor call — Fixture B', 2)])];
    let { context, page } = await open();
    const loadingTxt = await text(page, 'body', /Loading appointments…/, 15000);
    const loadingOk = !!loadingTxt && /Loading appointments…/.test(loadingTxt) && !/No upcoming appointments/.test(loadingTxt);
    release();
    const upd = await text(page, '[data-testid="calendar-updated"]', /Updated /);
    const hdr = await page.evaluate(() => { const a = document.querySelector('[data-testid="calendars-header-ghl"]'); return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: a.innerText } : null; }).catch(() => null);
    const b1 = await bodyText(page);
    check('R1 success: the appointments show with "Updated <time>"; "Open Calendars in GHL" is in the header for this location (new tab, no opener)',
      /Seller call — Fixture A/.test(b1) && /Investor call — Fixture B/.test(b1) && !!upd && /Updated /.test(upd) &&
      !!hdr && hdr.href === `https://app.gohighlevel.com/v2/location/${TEST_LOCATION}/calendars/view` && hdr.target === '_blank' && hdr.rel === 'noopener noreferrer' && /Open Calendars in GHL/.test(hdr.text), [upd, hdr]);
    check('R2 loading is its own state ("Loading appointments…"), never "no appointments"', loadingOk, loadingTxt);
    // R8: a failed REFRESH keeps the last good read, labelled, and drops "Updated"
    answers = [{ status: 500, body: { error: 'GET /calendars/events → 503: upstream' } }];
    await page.getByTestId('calendar-refresh').click().catch(() => {});
    const stale = await text(page, '[data-testid="calendar-stale"]', /out of date/);
    const b8 = await bodyText(page);
    check('R8 failed refresh: the error is shown AND the last successful read stays visible, labelled "may be out of date" (not current: no "Updated")',
      !!stale && /Showing the last successful read from .+\. It may be out of date\./.test(stale) && /Seller call — Fixture A/.test(stale) &&
      /Appointments couldn.t be loaded from GHL right now\./.test(b8) && !(await page.getByTestId('calendar-updated').count().catch(() => 1)), stale);
    // R9: the handoff is navigation only (captured, not sent), from the header
    const before = handoffs.length;
    await page.getByTestId('calendars-header-ghl').click().catch(() => {});
    { const t0 = Date.now(); while (handoffs.length === before && Date.now() - t0 < 8000) await page.waitForTimeout(100); }
    check('R9 handoff: "Open Calendars in GHL" opens GHL Calendars for this location in a new tab (captured, not sent)', handoffs.length > before && handoffs[handoffs.length - 1].includes(`/v2/location/${TEST_LOCATION}/calendars/view`), handoffs.slice(-1));
    await context.close();
    // R3 empty, R4 no calendars
    answers = [OK([])]; ({ context, page } = await open());
    const e3 = await text(page, '[data-testid="calendar-empty"]', /No upcoming appointments/);
    const b3 = await bodyText(page);
    check('R3 empty calendars: "No upcoming appointments in the next 30 days", and no unavailable card', !!e3 && !/couldn.t be loaded|can.t be shown/.test(b3), e3);
    await context.close();
    answers = [OK([], [])]; ({ context, page } = await open());
    const e4 = await text(page, '[data-testid="calendar-no-calendars"]', /no active calendars/);
    const b4 = await bodyText(page);
    check('R4 no active calendars: said so, never "No upcoming appointments"', !!e4 && !/No upcoming appointments/.test(b4), [e4, b4.slice(0, 160)]);
    await context.close();
    // R5 access denied (GHL scope)
    answers = [{ status: 502, body: { code: 'ghl_calendar_access_denied', error: 'GET /calendars/events → 401: {"message":"The token is not authorized for this scope."}' } }];
    ({ context, page } = await open());
    const c5 = await text(page, '[data-testid="calendar-unavailable"]', /GHL refused/);
    const b5 = await bodyText(page);
    check('R5 GHL scope refusal: the accepted access-denied explanation + the GHL link; no "Try again", never "No upcoming appointments"',
      !!c5 && /GHL refused IAOS access to calendars for this account\./.test(c5) && /Open Calendars in GHL/.test(c5) && !/Try again/.test(c5) && !/No upcoming appointments/.test(b5), c5);
    await context.close();
    // R6 temporary failure, then Try again succeeds
    answers = [{ status: 500, body: { error: 'GET /calendars/events → 429: Too many requests' } }, OK([EV('r1', 'Seller call — Retried', 1)])];
    ({ context, page } = await open());
    const c6 = await text(page, '[data-testid="calendar-unavailable"]', /couldn.t be loaded/);
    await page.getByTestId('calendar-retry').click().catch(() => {});
    const after6 = await text(page, 'body', /Seller call — Retried/);
    check('R6 temporary failure: "couldn\'t be loaded from GHL right now" with Try again; trying again reads afresh and shows the appointments',
      !!c6 && /Try again/.test(c6) && !!after6 && /Seller call — Retried/.test(after6) && !(await page.getByTestId('calendar-unavailable').count().catch(() => 1)), [c6, (after6 || '').slice(0, 120)]);
    await context.close();
    // R7 IAOS read sign-in lapsed (the boundary's marker): named as sign-in, not blamed on GHL
    answers = [{ status: 401, body: { error: 'Read sign-in required.', by: 'iaos-app-read-auth' } }];
    ({ context, page } = await open());
    const c7 = await text(page, '[data-testid="calendar-unavailable"]', /sign in/);
    check('R7 IAOS read sign-in lapse: "can\'t be shown until you sign in to IAOS again" -- not "couldn\'t be loaded from GHL", not "GHL refused"',
      !!c7 && /sign in to IAOS again/.test(c7) && !/couldn.t be loaded from GHL|GHL refused/.test(c7), c7);
    await context.close();
    check('R10 reads only (GET) for every request in the rendered runs; nothing left the machine except captured GHL hand-offs; no page errors',
      methods.every((m) => m === 'GET') && foreign.length === 0 && pageErrors.length === 0, { methods: [...new Set(methods)], foreign, pageErrors });
  } catch (e) { console.error(`FAIL  rendered: ${e.message}`); failures += 1; }

  // ───────────────────────── X: source ─────────────────────────
  const pg = src('src/pages/Calendars.tsx'); const fnSrc = src('netlify/functions/ghl-calendar-events.ts');
  check('X1 read-only and reused: the page has no write or window.open and links via ghlCalendarsUrl() in the header and the card; the server stays GET-only and unchanged in contract',
    !/appWriteFetch|writeCommand|confirmedCommand|window\.open/.test(pg) && (pg.match(/href=\{ghlCalendarsUrl\(\)\}/g) || []).length === 2 &&
    /data-testid="calendars-header-ghl"/.test(pg) && !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(fnSrc) && /CALENDAR_ACCESS_DENIED = "ghl_calendar_access_denied"/.test(fnSrc));

  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK'); return exit(0);
}
main().catch((e) => { console.error(`FAIL  startup: ${e && e.stack || e}`); cleanup(); process.exit(2); });
