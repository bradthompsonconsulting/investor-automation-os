/**
 * B15-19 (INV-128) -- Spock's hosted Test finding: the Lead Queue said "Showing 1 of 1 — scroll for the rest." when
 * every row was already on screen. The scroll instruction is shown only when the list really has more than fits in
 * its box (measured on the element); "Showing X of Y", the queue, its filters, order and links are unchanged.
 *
 * Offline: the REAL Dashboard (scripts/harness/dashboard-callback-popover, unchanged); every /.netlify/functions
 * request is answered here from fictional fixtures (N plain contacts with a phone, so the Lead Queue holds exactly N);
 * any write is counted and refused; any other request is aborted and counted.
 *
 *   Q0 / Q1 / Q13  0, 1 and 13 contacts (every row fits in the list box): "Showing N of N." with no scroll instruction;
 *                  the heading count, the contact rows and the queue accounting line show N
 *   Q15            15 contacts: the box (15 x 44px) also holds the header and its rows are 48px, so the last rows sit
 *                  below the fold -- the instruction is KEPT ("Showing 15 of 15 — scroll for the rest.")
 *   Q16            16 contacts: "Showing 15 of 16 — scroll for the rest." is kept; the list scrolls
 *   R              at a narrow window the instruction follows whether the list really scrolls (measured, not counted)
 *   NAV            a Lead Queue name still links to that contact
 *   W              no write; nothing left the machine; no page errors; no unmodelled read
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s Dashboard.tsx; with the base 9e8c8fd, Q0, Q1 and Q13 must FAIL.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/dashboard-callback-popover/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const PAGE = path.join(APP, 'src/pages/Dashboard.tsx');
const before = { name: 'b15-19-before', enforce: 'pre', load(id) {
  if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE) return null;
  return execFileSync('git', ['show', `${BEFORE}:app/src/pages/Dashboard.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
} };

let checks = 0, failures = 0;
const FLOOR = 23;   // literal count of check() calls executed on a full run; a shorter run fails
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: `lq${String(i + 1).padStart(2, '0')}`, firstName: `Lee${i + 1}`, lastName: 'Example',
  phone: `+1555555${String(1000 + i).slice(-4)}`, email: '', address1: `${i + 1} Example St`, city: 'Sampletown', state: 'TX', postalCode: '75000',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null }));
const MAILERS = { weekStartCT: TODAY, weekEndCT: TODAY, thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [], totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } };

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
  const writes = [], foreign = [], unmodelled = [], pageErrors = [];
  if (BEFORE) console.log(`NEGATIVE CONTROL: Dashboard.tsx from ${BEFORE}; this run must fail.`);

  async function open(n, width = 1400) {
    const rows = people(n);
    const context = await browser.newContext({ viewport: { width, height: 1200 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace(/^.*\/\.netlify\/functions\//, '');
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (req.method() !== 'GET') { writes.push(fn); return json(409, { error: 'offline test: refused', outcome: 'not_sent' }); }
      if (fn === 'ghl-contacts') return json(200, rows);
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'fixture-pipeline', stages: [], opportunities: [] });
      if (fn === 'ghl-conversations') return json(200, []);
      if (fn === 'ghl-mailers') return json(200, MAILERS);
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'call-log-barrier') return json(200, { entries: [] });
      unmodelled.push(`${fn}${u.search}`); return json(404, { error: 'unmodelled' });
    });
    await page.goto(`${base}${HARNESS}`);
    const end = Date.now() + 30000;
    // the queue has loaded once its accounting line appears
    while (Date.now() < end && (await page.getByTestId('dashboard-lead-queue-accounting').count()) === 0) await page.waitForTimeout(100);
    await page.waitForTimeout(400);
    const sentence = page.getByTestId('dashboard-lead-queue-showing');
    const fallback = page.locator('p', { hasText: 'Sellers to cold-call next' }).first();
    const text = ((await sentence.count()) ? await sentence.innerText() : await fallback.innerText()).replace(/\s+/g, ' ').trim();
    const m = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('*')].find((e) => e.children.length > 0 && /^Lead Queue/.test(e.textContent.trim()) && e.textContent.trim().length < 40);
      const p = [...document.querySelectorAll('p')].find((e) => /Sellers to cold-call next/.test(e.textContent));
      let box = p; while (box && !(box.querySelector && box.querySelector('table'))) box = box.nextElementSibling;
      const table = box ? box.querySelector('table') : null; const scroller = table ? table.parentElement : null;
      const linked = table ? [...table.querySelectorAll('tbody tr')].filter((t) => t.querySelector('a[href*="/contacts/"]')) : [];
      return { heading: heading ? heading.textContent.replace(/\s+/g, ' ').trim() : null, rows: table ? linked.length : -1,
        scrolls: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null,
        firstLink: linked[0] ? new URL(linked[0].querySelector('a[href*="/contacts/"]').href).pathname : null };
    });
    const acc = page.getByTestId('dashboard-lead-queue-accounting');
    const accounting = (await acc.count()) ? (await acc.innerText()).trim() : null;
    return { context, page, text, accounting, ...m };
  }

  try {
    for (const n of [0, 1, 13]) {
      const r = await open(n);
      check(`Q${n} ${n} in the queue, every row fits: "Showing ${n} of ${n}." with no scroll instruction`, r.text.endsWith(`Showing ${n} of ${n}.`) && !/scroll/i.test(r.text), r.text);
      check(`Q${n} the count is unchanged: heading ${n}, ${n} contact rows`, !!r.heading && r.heading.includes(String(n)) && r.rows === n, { heading: r.heading, rows: r.rows });
      check(`Q${n} the queue accounting line is still shown`, !!r.accounting && r.accounting.length > 0, r.accounting);
      if (n > 0) check(`Q${n} nothing to scroll: the list box holds every row`, r.scrolls === false, r.scrolls);
      if (n === 1) check('NAV a Lead Queue name still links to that contact', !!r.firstLink && r.firstLink.endsWith('/contacts/lq01'), r.firstLink);
      await r.context.close();
    }
    const f15 = await open(15);
    check('Q15 the last rows are below the fold (the box also holds the header): the list scrolls and the instruction is KEPT',
      f15.scrolls === true && f15.text.endsWith('Showing 15 of 15 — scroll for the rest.'), { text: f15.text, scrolls: f15.scrolls });
    check('Q15 the count is unchanged: heading 15, 15 contact rows', !!f15.heading && f15.heading.includes('15') && f15.rows === 15, { heading: f15.heading, rows: f15.rows });
    await f15.context.close();
    const r = await open(16);
    check('Q16 more than fits: "Showing 15 of 16 — scroll for the rest." is kept', r.text.endsWith('Showing 15 of 16 — scroll for the rest.'), r.text);
    check('Q16 the count is unchanged: heading 16, all 16 contact rows in the list', !!r.heading && r.heading.includes('16') && r.rows === 16, { heading: r.heading, rows: r.rows });
    check('Q16 the list really scrolls (its box is shorter than its rows)', r.scrolls === true, r.scrolls);
    check('Q16 the queue accounting line is still shown', !!r.accounting && r.accounting.length > 0, r.accounting);
    await r.context.close();
    for (const [n, w] of [[13, 760], [1, 760]]) {
      const x = await open(n, w);
      check(`R ${n} contacts at a ${w}px window: the instruction is shown exactly when the list really scrolls`, x.scrolls === /scroll for the rest/.test(x.text), { text: x.text, scrolls: x.scrolls });
      await x.context.close();
    }
    check('W no write was attempted', writes.length === 0, writes);
    check('W nothing left the machine; no page errors', foreign.length === 0 && pageErrors.length === 0, { foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
    check('W no unmodelled read', unmodelled.length === 0, [...new Set(unmodelled)].slice(0, 5));
  } catch (e) {
    check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-19 Lead Queue "Showing": ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
