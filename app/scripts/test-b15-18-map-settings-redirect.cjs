/**
 * B15-18 (INV-127) -- direct /map and /settings visits go to the Dashboard.
 *
 * Scope (Linear INV-127, Jeff 2026-10-12, per Jess's ruling): "the independent
 * Map/Settings cleanup (direct /map and /settings go to Dashboard)". Map and
 * Settings left the sidebar in PR #127 (F57/F58); their routes still opened
 * empty pages.
 *
 * BEHAVIOUR, rendered. Vite serves scripts/harness/app-routes -- the REAL App
 * (BrowserRouter, Layout, ReadAccess gate, every route) -- in headless
 * Chromium, starting at the path under test, and every /.netlify/functions
 * request is answered here (offline; no live request). Checks:
 *   - direct /map and /settings land on /dashboard (signed in: the
 *     Dashboard renders; signed out: the read sign-in screen, and no data
 *     read is attempted -- the gate is unchanged);
 *   - the redirect replaces history (no extra entry, so Back cannot bounce
 *     into a loop) and the URL is stable afterwards;
 *   - normal navigation still works: /dashboard and /pipeline load directly,
 *     a sidebar click reaches its page, and an in-app move to /settings
 *     redirects too.
 *
 * NEGATIVE CONTROL: `node scripts/test-b15-18-map-settings-redirect.cjs
 * --before=b9a84f2` renders that revision's App (empty Map/Settings pages)
 * and must FAIL (exit 1).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/app-routes');
const HARNESS = '/scripts/harness/app-routes/index.html';
const BEFORE_FILE = path.join(HARNESS_DIR, 'AppBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;
/** Checks run, counted from the finished file: /map 6 + /settings 4 + signed-out 3 x 2 + navigation 5 + source 2 = 23. */
const FLOOR = 23;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
if (BEFORE_REV) {
  const src = execFileSync('git', ['show', `${BEFORE_REV}:app/src/App.tsx`], { cwd: APP, encoding: 'utf8' });
  fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\//g, 'from "../../../src/'));
  console.log(`NEGATIVE CONTROL: rendering the App from ${BEFORE_REV}; this run must fail.`);
}

const DASHBOARD_TEXT = 'What needs your attention today.';
const SIGN_IN_TEXT = 'Sign in to IAOS';
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => {
    clearTimeout(watchdog);
    await browser.close().catch(() => {}); await server.close().catch(() => {});
    if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
    process.exit(code);
  };

  /** One fresh page; signedIn decides the read-session answer. Every function call is logged and answered offline. */
  async function open(start, signedIn) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const log = []; const foreign = []; const pageErrors = [];
    const session = { signedIn };
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      log.push(`${route.request().method()} ${fn}`);
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'app-read-session') {
        return session.signedIn
          ? json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() })
          : json(200, { signedIn: false });
      }
      // Empty but valid reads, so the real pages render rather than error.
      if (fn === 'ghl-contacts') return json(200, []);
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'p-test', stages: [], opportunities: [] });
      if (fn === 'ghl-conversations') return json(200, []);
      if (fn === 'ghl-mailers') return json(200, { weekStartCT: '2026-10-19', weekEndCT: '2026-10-25', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [], totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } });
      return json(404, { error: `fixture: ${fn} not answered` });
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(start)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 60000 });
    return { context, page, log, foreign, pageErrors, session };
  }
  const pathOf = (page) => page.evaluate(() => window.location.pathname);
  const settle = (page) => page.waitForTimeout(1500);
  const dataReads = (log) => log.filter((x) => x !== 'GET app-read-session');

  try {
    // 1. Direct /map and /settings, signed in.
    for (const start of ['/map', '/settings']) {
      const s = await open(start, true);
      await s.page.getByText(DASHBOARD_TEXT).waitFor({ timeout: 30000 }).catch(() => {});
      await settle(s.page);
      const h = await s.page.evaluate(() => ({ now: window.history.length, atMount: window.__iaosHistoryAtMount }));
      if (start === '/map') {
        check('harness renders the expected App source', (await s.page.evaluate(() => window.__iaosAppSource)) === (BEFORE_REV ? 'before' : 'current'));
        check('signed in: direct /map lands on /dashboard', (await pathOf(s.page)) === '/dashboard', await pathOf(s.page));
        check('signed in: /map shows the Dashboard', await s.page.getByText(DASHBOARD_TEXT).isVisible().catch(() => false));
        check('signed in: /map redirect replaces history (no new entry)', h.now === h.atMount, h);
        check('signed in: /map stays on /dashboard (no loop)', (await pathOf(s.page)) === '/dashboard');
        check('signed in: /map makes no foreign request and no page error', s.foreign.length === 0 && s.pageErrors.length === 0, { foreign: s.foreign, pageErrors: s.pageErrors });
      } else {
        check('signed in: direct /settings lands on /dashboard', (await pathOf(s.page)) === '/dashboard', await pathOf(s.page));
        check('signed in: /settings shows the Dashboard', await s.page.getByText(DASHBOARD_TEXT).isVisible().catch(() => false));
        check('signed in: /settings redirect replaces history (no new entry)', h.now === h.atMount, h);
        check('signed in: /settings shows no Settings page heading', (await s.page.locator('main h1', { hasText: /^Settings$/ }).count()) === 0);
      }
      await s.context.close();
    }

    // 2. Direct /map and /settings, signed out. The read gate wraps every
    //    route, so nothing behind it -- the redirect included -- renders until
    //    sign-in: the sign-in screen shows at the requested URL, no data is
    //    read, and once the session is signed in the redirect applies. (The
    //    session check is re-run through ReadAccess's own session event; the
    //    Google popup itself is not exercised offline.)
    for (const start of ['/map', '/settings']) {
      const s = await open(start, false);
      await s.page.getByText(SIGN_IN_TEXT).waitFor({ timeout: 30000 }).catch(() => {});
      await settle(s.page);
      check(`signed out: ${start} shows only the read sign-in screen (gate unchanged), no data read`,
        (await s.page.getByText(SIGN_IN_TEXT).isVisible().catch(() => false)) && dataReads(s.log).length === 0
          && s.log.filter((x) => x === 'GET app-read-session').length <= 3, s.log);
      s.session.signedIn = true;
      await s.page.evaluate(() => window.dispatchEvent(new Event('iaos-read-session-lost')));
      await s.page.getByText(DASHBOARD_TEXT).waitFor({ timeout: 30000 }).catch(() => {});
      await settle(s.page);
      check(`after sign-in: ${start} lands on /dashboard and shows it`,
        (await pathOf(s.page)) === '/dashboard' && (await s.page.getByText(DASHBOARD_TEXT).isVisible().catch(() => false)), await pathOf(s.page));
      check(`after sign-in: ${start} stays put (no loop) with no page error`,
        (await pathOf(s.page)) === '/dashboard' && s.pageErrors.length === 0 && s.foreign.length === 0, { pageErrors: s.pageErrors, foreign: s.foreign });
      await s.context.close();
    }

    // 3. Normal navigation still works.
    {
      const s = await open('/dashboard', true);
      await s.page.getByText(DASHBOARD_TEXT).waitFor({ timeout: 30000 }).catch(() => {});
      check('direct /dashboard stays /dashboard', (await pathOf(s.page)) === '/dashboard');
      await s.page.locator('a[href="/pipeline"]').first().click();
      await s.page.waitForFunction(() => window.location.pathname === '/pipeline', null, { timeout: 15000 }).catch(() => {});
      check('a sidebar link still navigates (Pipeline)', (await pathOf(s.page)) === '/pipeline', await pathOf(s.page));
      await s.page.evaluate(() => { window.history.pushState(null, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); });
      await s.page.waitForFunction(() => window.location.pathname === '/dashboard', null, { timeout: 15000 }).catch(() => {});
      check('an in-app move to /settings also lands on /dashboard', (await pathOf(s.page)) === '/dashboard', await pathOf(s.page));
      await s.page.goBack();
      await settle(s.page);
      check('Back from the redirect returns to Pipeline, not into /settings', (await pathOf(s.page)) === '/pipeline', await pathOf(s.page));
      await s.context.close();
    }
    {
      const s = await open('/pipeline', true);
      await settle(s.page);
      check('direct /pipeline still opens Pipeline (other routes untouched)', (await pathOf(s.page)) === '/pipeline' && (await s.page.locator('main h1', { hasText: /^Pipeline$/ }).count()) === 1, await pathOf(s.page));
      await s.context.close();
    }

    // 4. Source: the change is exactly the two routes.
    const app = fs.readFileSync(path.join(APP, 'src/App.tsx'), 'utf8');
    check('source: /map and /settings routes are replace-redirects to /dashboard',
      /<Route path="map"\s+element=\{<Navigate to="\/dashboard" replace \/>\} \/>/.test(app) && /<Route path="settings"\s+element=\{<Navigate to="\/dashboard" replace \/>\} \/>/.test(app));
    check('source: MapPage and Settings are no longer routed', !/MapPage|<Settings \/>/.test(app));
  } catch (e) {
    check('suite ran to completion', false, String(e));
  }
  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}
main();
