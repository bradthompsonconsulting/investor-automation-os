/**
 * R2 (Board #15 Captain walkthrough) -- Mailers task rows and the No Address list link an identifiable contact's
 * name to that contact. The Dashboard Mailers tile is not part of this change.
 *
 * Offline: the REAL Layout + Mailers page (scripts/harness/mailers, unchanged); every /.netlify/functions request is
 * answered here from a fictional digest; any write is counted and refused.
 *
 *   M1  a task row's name links to /contacts/<id>; M2 an unnamed task row's placeholder links too
 *   M3  a No Address row's name links; M4 a row with no contact id keeps a plain name
 *   M5  clicking a name navigates to the contact; nothing is written (stopPropagation keeps the row's own controls out)
 *   M6  the Dashboard tile is untouched (Dashboard.tsx has no diff from the base) -- source check
 *   W   no write, no foreign request, no page error
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s Mailers.tsx; with the base 9e8c8fd, M1-M3 and M5 must FAIL.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/mailers/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const PAGE = path.join(APP, 'src/pages/Mailers.tsx');
const before = { name: 'r2-before', enforce: 'pre', load(id) {
  if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE) return null;
  return execFileSync('git', ['show', `${BEFORE}:app/src/pages/Mailers.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
} };
let checks = 0, failures = 0;
const FLOOR = 7;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const task = (taskId, contactId, contactName, hasAddress) => ({ taskId, contactId, contactName, address: hasAddress ? '9 Mail Rd, Sampletown, TX 75000' : '', hasAddress,
  tier: 'warm', mailerType: 'Primary', touchNumber: 1, dueDate: `${TODAY}T15:00:00.000Z`, dueDateCT: TODAY, completed: false, hasBusinessName: false, companyName: null });
const DIGEST = { weekStartCT: TODAY, weekEndCT: TODAY,
  thisWeekReady: [{ key: 'warm-primary', label: 'Warm · Primary', rows: [task('t1', 'cMia', 'Mia Example', true), task('t2', 'cNoName', '', true)] }],
  thisWeekBusiness: [], overdue: [],
  noAddress: [task('t3', 'cNed', 'Ned Example', false), task('t4', '', 'Orphan Row', false)],
  totals: { ready: 2, business: 0, overdue: 0, noAddress: 2, byMailerType: {} } };

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({ root: APP, configFile: false, plugins: [before, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const writes = [], foreign = [], pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace(/^.*\/\.netlify\/functions\//, '');
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: '2030-01-01T00:00:00.000Z' });
      if (req.method() !== 'GET') { writes.push(fn); return json(409, { error: 'offline test: refused', outcome: 'not_sent' }); }
      if (fn === 'ghl-mailers') return json(200, DIGEST);
      return json(404, { error: `not answered: ${fn}` });
    });
    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/mailers'));
    await page.getByText('Mia Example').first().waitFor({ timeout: 30000 });
    // No Address may be collapsed: open it if a toggle exists.
    const na = page.locator('button', { hasText: 'No Address' }).first();
    if (await na.count() && !(await page.getByText('Ned Example').count())) { await na.click(); await page.waitForTimeout(300); }
    const linkOf = (text) => page.evaluate((t) => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() === t)
      .map((e) => { const a = e.closest('a'); return a ? new URL(a.href).pathname : null; }), text);
    const mia = await linkOf('Mia Example'); const unnamed = await linkOf('Unnamed contact'); const ned = await linkOf('Ned Example'); const orphan = await linkOf('Orphan Row');
    check('M1 a task row\'s contact name links to the contact', mia.some((p) => p && p.endsWith('/contacts/cMia')), mia);
    check('M2 an unnamed task row\'s placeholder links to its contact', unnamed.some((p) => p && p.endsWith('/contacts/cNoName')), unnamed);
    check('M3 a No Address row\'s name links to the contact', ned.some((p) => p && p.endsWith('/contacts/cNed')), ned);
    check('M4 a row with no contact id keeps a plain name (nothing guessed)', orphan.length > 0 && orphan.every((x) => x === null), orphan);
    // M5: clicking the name navigates; nothing written.
    const link = page.locator('a', { hasText: 'Mia Example' }).first();
    const hadLink = (await link.count()) > 0;
    if (hadLink) await link.click();
    await page.waitForTimeout(500);
    const pathNow = await page.evaluate(() => location.pathname);
    check('M5 clicking the name opens the contact; nothing is written', hadLink && pathNow.endsWith('/contacts/cMia') && writes.length === 0, { hadLink, pathNow });
    const TILE = /<Tile icon=\{MailIcon\} label="Mailers ready this week"[^\n]*\/>/;
    const tileNow = (require('node:fs').readFileSync(path.join(APP, 'src/pages/Dashboard.tsx'), 'utf8').match(TILE) || [null])[0];
    const tileBase = (execFileSync('git', ['show', '9e8c8fd10b32eba66d978ef6448367356c4b2bf8:app/src/pages/Dashboard.tsx'], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 }).match(TILE) || [null])[0];
    check('M6 the Dashboard Mailers tile is untouched (its source line equals the base exactly)', !!tileNow && tileNow === tileBase, [tileNow, tileBase]);
    check('W no write; no foreign request; no page errors', writes.length === 0 && foreign.length === 0 && pageErrors.length === 0, { writes, foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
  } catch (e) {
    check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nR2 Mailers contact links: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
