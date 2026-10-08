/**
 * B15-09 (INV-108) — only the CURRENT opportunities read may change the
 * Pipeline (Bones: an older request finishing later restored stale rows and
 * contact links).
 *
 * Offline. Vite serves scripts/harness/pipeline-requests (the REAL Layout
 * and Pipeline with the real GHL client) in headless Chromium. Every
 * /.netlify/functions request is answered here; each ghl-opportunities read
 * is HELD until the scenario releases it, so responses can arrive in any
 * order. A read recovery is driven the way the app sees one: the session
 * ends, then returns, and the page re-reads without remounting. Nothing
 * leaves the machine.
 *
 * Proves:
 *   R1 reversed order: the newer read's rows and contact links stay when the
 *      older read answers last.
 *   R2 stale failure: an older read failing after the newer one succeeded
 *      does not replace the rows with an error.
 *   R3 loading state: an older read answering while the newer one is still
 *      pending neither ends loading nor shows its rows.
 *   R4 the current read's own failure is still shown, and a later stale
 *      success does not hide it.
 *   R5 unmount: a read still pending when the page is left changes nothing
 *      and raises nothing; returning shows that visit's read.
 *
 * NEGATIVE CONTROL: `node scripts/test-pipeline-requests.cjs --before=<rev>`
 * renders <rev>'s Pipeline page instead (via `git show`) and must FAIL
 * (exit 1) for a revision without the fix -- e.g. --before=3de480e.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/pipeline-requests');
const HARNESS = '/scripts/harness/pipeline-requests/index.html';
const BEFORE_FILE = path.join(HARNESS_DIR, 'PipelineBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 16;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
if (BEFORE_REV) {
  const src = execFileSync('git', ['show', `${BEFORE_REV}:app/src/pages/Pipeline.tsx`], { cwd: APP, encoding: 'utf8' });
  fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\.\//g, 'from "../../../src/'));
  console.log(`NEGATIVE CONTROL: rendering the Pipeline page from ${BEFORE_REV}; this run must fail.`);
}

// ── Fixture ──────────────────────────────────────────────────────────────────
const STAGES = [{ id: 'stage-new', name: 'New Lead - Seller', position: 0 }];
const pipelineBody = (label, contactId) => ({
  pipelineId: 'fixture-pipeline', stages: STAGES,
  opportunities: [{ id: `${label}-opp`, contactId, contactName: `${label} Seller`, opportunityName: `${label} deal`, phone: '', email: '', stageId: 'stage-new', customFields: [] }],
});
let signedIn = true;
let held = [];          // pending ghl-opportunities routes, in arrival order
let foreign = [];

const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

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
  const exit = async (code) => {
    clearTimeout(watchdog);
    await browser.close().catch(() => {}); await server.close().catch(() => {});
    if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
    process.exit(code);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'app-read-session') return json(200, signedIn ? { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() } : { signedIn: false });
      if (route.request().method() !== 'GET') { foreign.push(`${route.request().method()} ${fn}`); return json(405, { error: 'fixture: reads only' }); }
      if (fn === 'ghl-opportunities') { held.push(route); return undefined; }
      if (fn === 'ghl-contacts') return json(200, []);   // read by later Pipeline revisions; empty here
      return json(404, { error: `fixture: ${fn} not answered` });
    });

    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const until = async (fn, label, ms = 30000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for: ${label}`);
    };
    const settle = () => page.waitForTimeout(600);
    const visibleText = (s) => page.getByText(s, { exact: false }).first().isVisible().catch(() => false);
    const rows = () => page.$$eval('tbody tr', (trs) => trs.map((tr) => {
      const a = tr.querySelector('a[data-testid^="pipeline-row-contact-"]');
      return { contact: tr.cells[0] ? tr.cells[0].innerText.trim() : '', href: a ? a.getAttribute('href') : null };
    }).filter((r) => r.contact));
    const skeleton = () => page.$$eval('tbody tr', (trs) => trs.length > 0 && trs.every((tr) => !tr.innerText.trim()));
    const answer = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const waitHeld = (n) => until(async () => held.length >= n, `${n} opportunities read(s) pending`);
    const freshPipeline = async () => {
      held = []; signedIn = true;
      await page.goto(`${base}${HARNESS}`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await go('/pipeline');
      await waitHeld(1);
    };
    /** The session ends and returns; ReadAccess signals recovery and the page re-reads without remounting. */
    const recover = async () => {
      signedIn = false;
      await page.evaluate(() => window.dispatchEvent(new Event('iaos-read-session-lost')));
      await until(() => page.getByTestId('read-access-recovery').first().isVisible().catch(() => false), 'recovery screen');
      signedIn = true;
      await page.evaluate(() => window.dispatchEvent(new Event('iaos-read-session-lost')));
      await until(async () => !(await page.getByTestId('read-access-recovery').first().isVisible().catch(() => false)), 'signed in again');
    };

    const source = async () => page.evaluate(() => window.__iaosPipelineSource);

    // ═══ R1 reversed order ═══════════════════════════════════════════════════
    await freshPipeline();
    check('harness renders the expected Pipeline source', (await source()) === (BEFORE_REV ? 'before' : 'current'), await source());
    await recover();
    await waitHeld(2);
    {
      const [older, newer] = held;
      await answer(newer, 200, pipelineBody('Newer', 'contact-newer'));
      await until(() => visibleText('Newer Seller'), 'newer rows');
      await answer(older, 200, pipelineBody('Stale', 'contact-stale'));
      await settle();
      const r = await rows();
      check('R1 the newer read\'s row stays when the older read answers last', r.map((x) => x.contact).join('|') === 'Newer Seller', r);
      check('R1 its contact link is the newer one', r.length === 1 && r[0].href === '/contacts/contact-newer', r);
      check('R1 no stale row or stale contact link appears', !(await visibleText('Stale Seller')) && !(await page.$('a[href="/contacts/contact-stale"]')));
    }

    // ═══ R2 stale failure ════════════════════════════════════════════════════
    await freshPipeline();
    await recover();
    await waitHeld(2);
    {
      const [older, newer] = held;
      await answer(newer, 200, pipelineBody('Newer', 'contact-newer'));
      await until(() => visibleText('Newer Seller'), 'newer rows');
      await answer(older, 500, { error: 'fixture: older read failed' });
      await settle();
      check('R2 an older failure does not replace the rows with an error', !(await visibleText('Failed to load pipeline')));
      check('R2 the newer rows and link are still shown', (await rows()).map((x) => x.href).join('|') === '/contacts/contact-newer', await rows());
    }

    // ═══ R3 loading belongs to the current read ══════════════════════════════
    await freshPipeline();
    await recover();
    await waitHeld(2);
    {
      const [older, newer] = held;
      await answer(older, 200, pipelineBody('Stale', 'contact-stale'));
      await settle();
      check('R3 an older answer while the newer read is pending does not show its rows', !(await visibleText('Stale Seller')));
      check('R3 ...and does not end loading (skeleton still shown, no empty state)', (await skeleton()) && !(await visibleText('No opportunities found')));
      await answer(newer, 200, pipelineBody('Newer', 'contact-newer'));
      await until(() => visibleText('Newer Seller'), 'newer rows');
      check('R3 the current read then ends loading with its own rows', (await rows()).map((x) => x.contact).join('|') === 'Newer Seller', await rows());
    }

    // ═══ R4 the current failure is still reported ════════════════════════════
    await freshPipeline();
    await recover();
    await waitHeld(2);
    {
      const [older, newer] = held;
      await answer(newer, 500, { error: 'fixture: current read failed' });
      await until(() => visibleText('Failed to load pipeline'), 'current failure shown');
      check('R4 the current read\'s failure is shown with its detail', await visibleText('fixture: current read failed'));
      await answer(older, 200, pipelineBody('Stale', 'contact-stale'));
      await settle();
      check('R4 a later stale success does not hide the current failure', await visibleText('Failed to load pipeline'));
      check('R4 ...nor slip in its rows', !(await visibleText('Stale Seller')));
    }

    // ═══ R5 unmount ══════════════════════════════════════════════════════════
    await freshPipeline();
    {
      const errorsBefore = pageErrors.length;
      const [first] = held;
      await go('/elsewhere');
      await until(() => page.getByTestId('elsewhere').isVisible().catch(() => false), 'left the Pipeline');
      await answer(first, 200, pipelineBody('Stale', 'contact-stale'));
      await settle();
      check('R5 a read answering after the page was left raises no page error', pageErrors.length === errorsBefore, pageErrors.slice(errorsBefore));
      await go('/pipeline');
      await waitHeld(2);
      await answer(held[1], 200, pipelineBody('Return', 'contact-return'));
      await until(() => visibleText('Return Seller'), 'return visit rows');
      check('R5 returning shows that visit\'s read only', (await rows()).map((x) => x.href).join('|') === '/contacts/contact-return', await rows());
    }

    check('no page errors in any scenario', pageErrors.length === 0, pageErrors);
    check('nothing left the machine and nothing but reads was sent', foreign.length === 0, foreign);
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }

  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE_REV ? ` (negative control vs ${BEFORE_REV})` : ''}`);
  if (checks !== FLOOR) {
    console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`);
    return exit(2);
  }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main();
