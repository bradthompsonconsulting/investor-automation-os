/**
 * Board 15 cleanup (Brad's Test check, 2026-10-06) — an ended read session
 * shows a clear sign-in recovery screen, never "Failed to load dashboard"
 * with the raw 401 JSON.
 *
 * Offline. Vite serves scripts/harness/read-session-recovery (the REAL
 * Layout, ReadAccess and Dashboard with the real GHL client) in headless
 * Chromium. Every /.netlify/functions request, app-read-session included, is
 * answered here; the test decides when the session ends. The sign-in popup
 * is a stub page that posts the same message the real one does. Nothing
 * leaves the machine; no write is expected.
 *
 * Reproduces Brad's report: signed in, the Dashboard loads; the session ends
 * server-side while the page still believes it is signed in (e.g. the expiry
 * timer was delayed by sleep); opening the Dashboard reads 401 from the
 * read-auth boundary.
 *
 * Proves: the recovery screen appears with "Sign in again"; the Dashboard's
 * error and the raw refusal JSON are not shown; the nav locks; signing in
 * again removes the screen and the Dashboard reloads its data fresh.
 * Also: the expiry timer path shows the same screen.
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/read-session-recovery/index.html';

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

let signedIn = true;
let expiresAt = () => new Date(Date.now() + 3600_000).toISOString();
let log = [];
const READS = new Set(['ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations']);
const REFUSAL = { error: 'Read sign-in required.', by: 'iaos-app-read-auth' };
const EMPTY_DIGEST = { weekStartCT: '2026-10-05', weekEndCT: '2026-10-11', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [],
  totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } };
const CONTACT = { id: 'fixtureContact', firstName: 'Recovery', lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null };

function answer(fn, method) {
  if (fn === 'app-read-session') {
    if (method === 'DELETE') { signedIn = false; return { status: 200, body: { signedIn: false } }; }
    return { status: 200, body: signedIn ? { signedIn: true, expiresAt: expiresAt() } : { signedIn: false } };
  }
  if (!READS.has(fn)) return { status: 404, body: { error: `fixture does not model ${fn}` } };
  if (!signedIn) return { status: 401, body: REFUSAL };
  switch (fn) {
    case 'ghl-contacts': return { status: 200, body: [CONTACT] };
    case 'ghl-mailers': return { status: 200, body: EMPTY_DIGEST };
    case 'ghl-opportunities': return { status: 200, body: { pipelineId: 'fixture-pipeline', stages: [], opportunities: [] } };
    default: return { status: 200, body: [] };
  }
}

// The stub popup: the same message the real /app-read-login.html posts after a successful sign-in.
const POPUP = `<!doctype html><title>stub read sign-in</title><script>
  window.opener.postMessage({ type: "iaos-app-read-signed-in" }, location.origin);
</script>`;

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(`${base}/app-read-login.html`)) {
        signedIn = true; // the stub stands in for a successful sign-in, which sets the cookie
        return route.fulfill({ status: 200, contentType: 'text/html', body: POPUP });
      }
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      const method = route.request().method();
      log.push({ fn, method, signedIn });
      const res = answer(fn, method);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });
    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const visible = (testId) => page.getByTestId(testId).isVisible().catch(() => false);
    const visibleText = (s) => page.getByText(s, { exact: false }).first().isVisible().catch(() => false);
    const until = async (fn, label, ms = 30000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(100); }
      throw new Error(`timed out waiting for: ${label}`);
    };
    const dashboardLoaded = async () => (await visibleText('Recovery Fixture')) || (await page.getByRole('heading', { name: 'Dashboard' }).isVisible().catch(() => false));
    const readsSince = (i) => log.slice(i).filter((r) => READS.has(r.fn));

    // 0 — signed in, the Dashboard loads.
    await until(dashboardLoaded, 'Dashboard loaded while signed in');
    check('signed in: the Dashboard loads and no recovery screen is shown', !(await visible('read-access-recovery')));

    // 1 — Brad's report: the session ends server-side; the page still believes it is signed in.
    signedIn = false;
    await go(`${HARNESS}/elsewhere`);
    await until(() => visible('elsewhere'), 'another page');
    const beforeLapse = log.length;
    await go(HARNESS);   // the Dashboard mounts and reads -> 401 from the read-auth boundary
    await until(() => visible('read-access-recovery'), 'recovery screen after a refused read');
    check('the Dashboard\'s reads were refused 401 (the reproduction happened)', readsSince(beforeLapse).length > 0 && readsSince(beforeLapse).every((r) => !r.signedIn), readsSince(beforeLapse));
    check('the recovery screen says the sign-in has ended', await visibleText('Your sign-in has ended'));
    check('the recovery screen offers "Sign in again"', await page.getByRole('button', { name: 'Sign in again' }).isVisible());
    await page.waitForTimeout(500);
    check('"Failed to load dashboard" is not shown', !(await visibleText('Failed to load dashboard')));
    const shown = await page.locator('body').innerText();
    check('no raw refusal JSON or status code is shown', !/iaos-app-read-auth|→ 401|\{"error"/.test(shown), shown.slice(0, 400));
    check('the nav is locked while signed out', await visible('sidebar-locked'));
    check('the signed-in status line is gone', !(await visible('read-access-signed-in')));

    // 2 — signing in again removes the screen and reloads the Dashboard.
    const beforeSignIn = log.length;
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await until(async () => !(await visible('read-access-recovery')), 'recovery screen gone after sign-in');
    await until(dashboardLoaded, 'Dashboard reloaded after sign-in');
    const reloaded = readsSince(beforeSignIn);
    check('the Dashboard reloaded its data with the new session', ['ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations'].every((fn) => reloaded.some((r) => r.fn === fn && r.signedIn)), reloaded);
    check('after sign-in the Dashboard shows data, not the earlier failure', (await visibleText('Recovery Fixture')) && !(await visibleText('Failed to load dashboard')));
    check('the signed-in status line and nav are back', (await visible('read-access-signed-in')) && !(await visible('sidebar-locked')));

    // 3 — the expiry timer path shows the same screen.
    expiresAt = () => new Date(Date.now() + 2500).toISOString();
    await page.reload();
    await until(dashboardLoaded, 'Dashboard loaded with a short session');
    signedIn = false;
    await until(() => visible('read-access-recovery'), 'recovery screen after the expiry timer', 15000);
    check('expiry timer: the recovery screen appears with the expired message', await visibleText('Read session expired'));
    check('expiry timer: the Dashboard is hidden behind it', !(await visibleText('Recovery Fixture')));

    // 4 — an explicit sign-out still goes to the plain sign-in landing, not the recovery screen.
    signedIn = true;
    expiresAt = () => new Date(Date.now() + 3600_000).toISOString();
    await page.reload();
    await until(dashboardLoaded, 'Dashboard loaded before sign-out');
    await page.getByTestId('read-access-signed-in').getByRole('button', { name: 'Sign out' }).click();
    await until(() => visibleText('Sign in to IAOS'), 'sign-in landing after sign-out');
    check('explicit sign-out shows the sign-in landing, not the recovery screen', !(await visible('read-access-recovery')));

    check('no write was sent', !log.some((r) => r.fn === 'ghl-write' || r.fn.includes('write')), log.filter((r) => r.fn.includes('write')));
    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
  }
  console.log(`\nRead session recovery: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
