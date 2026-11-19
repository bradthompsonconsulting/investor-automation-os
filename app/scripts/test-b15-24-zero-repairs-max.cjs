/**
 * B15-24 (CAPTAIN GO 2026-11-19, "Max Offer with $0 repairs") -- the REAL Deal Calculator page
 * (scripts/harness/deal-calculator), offline, synthetic records. With every other required input present, Max Offer is
 * calculated with a $0 repair deduction when no repair amount is recorded or entered -- including a blank Quick figure,
 * which stays blank on screen and reads as "Known repairs (incomplete) $0", exactly like a fresh Itemized estimate.
 * The expected Max is computed here with the page's OWN formula modules (buildDealCalculatorInputs ->
 * computeUnderwriting -> computeBoard8Economics, IAOS Starter policy, default assignment mode) and compared with the
 * displayed figure; no number is typed into this file.
 *
 *   Q1-Q3  Quick: blank -> Max at $0 (provisional; input still blank); an entered 25,000 -> Max at 25,000 (labels
 *          normal); the figure erased again -> Max back at $0
 *   I1-I4  Itemized: fresh = Known $0 incomplete, Max at $0; HVAC Repair default -> Max at 2,500; Roof Replace default ->
 *          Max at 17,500; repair-only Clear -> Max back at $0
 *   N1-N2  not substituted: an invalid Quick entry is an error, Max waits; without ARV, Max waits
 *   L1     a linked deal with recorded repairs (30,000) still uses its figure (deal-first precedence unchanged)
 *   W      reads only; nothing left the page; no page errors
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s DealCalculator.tsx; with f116662a (blank Quick = not entered) the
 * $0 checks must FAIL.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
require(path.join(APP, 'scripts/harness/ts-loader.cjs'));
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const CFG = getConfig('test');
const { buildDealCalculatorInputs, DEFAULT_ASSIGNMENT_MODE } = require(path.join(APP, 'src/lib/deal-calculator-inputs.ts'));
const { computeUnderwriting } = require(path.join(APP, 'src/lib/underwriting/compute.ts'));
const { computeBoard8Economics } = require(path.join(APP, 'src/lib/underwriting/board8-economics.ts'));
const { money } = require(path.join(APP, 'src/lib/authoritative-figures.ts'));
const TABLE = require(path.join(APP, 'src/data/approved_repair_table.json')).rows;
const PAGE = '/scripts/harness/deal-calculator/index.html';
const PAGE_FILE = path.join(APP, 'src/pages/DealCalculator.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const before = { name: 'b15-24-zero-before', enforce: 'pre', load(id) {
  if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE_FILE) return null;
  return execFileSync('git', ['show', `${BEFORE}:app/src/pages/DealCalculator.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
} };

/** Literal check() call sites in this file: Q1-Q3, I1-I4, N1-N2, L1, W = 11. */
const FLOOR = 11;
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 500)}`}`); }

/** The existing formula: Max Offer (Board 8 max supported offer) for an ARV and a repair figure. */
const expectedMax = (arv, repairs) => {
  const b8 = computeBoard8Economics(computeUnderwriting(buildDealCalculatorInputs({ arv, repairs, assignment: { mode: DEFAULT_ASSIGNMENT_MODE }, policyValues: [], policyIds: CFG.customValues })));
  if (b8.status !== 'calculated') throw new Error(`formula did not calculate for arv=${arv} repairs=${repairs}: ${JSON.stringify(b8).slice(0, 200)}`);
  return money(b8.maxSupportedOffer);
};
const ARV = 300000, TEST = 150000;
const def = (sys) => TABLE.find((r) => r.system === sys);
const HVAC = def('hvac').repairDefault, ROOF_REPLACE = def('roof').severeDefault;

const C_ARV = 'QkWl09I9yXGz8OIcs5Xd', C_REP = 'SU4n8ylrXnUm8xDi729R';
const contacts = { 'c-ann': { arv: '300000', rep: '12000' } };
const opportunities = [{ id: 'o-ann', contactId: 'c-ann', contactName: 'c-ann', opportunityName: 'o-ann -- Fixture Rd', phone: '', email: '', stageId: CFG.stages.sellerCallCompleted,
  customFields: [{ id: CFG.opportunityFacts.arv, fieldValueNumber: 320000 }, { id: CFG.opportunityFacts.repairs, fieldValueNumber: 30000 }] }];
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 4 minutes -- stopped'); process.exit(1); }, 4 * 60_000);

async function listen(createServer, react) {
  for (let port = 5180; port <= 5189; port += 1) {
    const server = await createServer({ root: APP, configFile: false, plugins: [before, react()], logLevel: 'error', clearScreen: false,
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
      optimizeDeps: { entries: [PAGE.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
    try { await server.listen(); return server; } catch { await server.close().catch(() => {}); }
  }
  throw new Error('no free port in 5180-5189');
}

async function main() {
  if (BEFORE) console.log(`NEGATIVE CONTROL: serving DealCalculator.tsx from ${BEFORE}; this run must fail.`);
  const exp = { r0: expectedMax(ARV, 0), r25: expectedMax(ARV, 25000), hvac: expectedMax(ARV, HVAC), hvacRoof: expectedMax(ARV, HVAC + ROOF_REPLACE), deal: expectedMax(320000, 30000) };
  console.log(`NOTE  expected Max from the formula: ${JSON.stringify(exp)} (ARV ${ARV}; HVAC Repair ${HVAC}; Roof Replace ${ROOF_REPLACE})`);
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await listen(createServer, react);
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const requests = [], foreign = [], pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 }, timezoneId: 'America/Chicago' });
    await context.route('**/*', async (route) => {
      const r = route.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(`${r.method()} ${url}`); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      requests.push(`${r.method()} ${fn}`);
      if (r.method() !== 'GET') return json(405, { error: 'fixture: reads only' });
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'p1', stages: [], opportunities });
      const m = fn === 'ghl-proxy' && /^\/contacts\/([^/]+)$/.exec(u.searchParams.get('path') || '');
      if (m && contacts[m[1]]) { const c = contacts[m[1]]; return json(200, { contact: { id: m[1], firstName: m[1], lastName: '', customFields: [{ id: C_ARV, value: c.arv }, { id: C_REP, value: c.rep }] } }); }
      return json(404, { error: `fixture does not model ${fn}` });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const T = (id) => page.getByTestId(id);
    const settle = () => page.waitForTimeout(250);
    const go = async (q = '') => {
      await page.goto(`${base}${PAGE}${q ? `?${q}` : ''}`); await page.evaluate(() => localStorage.clear());
      await page.goto(`${base}${PAGE}${q ? `?${q}` : ''}`); await T('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 });
      if (q.includes('contactId=')) await page.waitForFunction(() => !/Linking the contact/.test(document.querySelector('[data-testid="deal-calc-draft-status"]')?.textContent || ''), null, { timeout: 15000 });
      await settle();
    };
    const bar = () => page.evaluate(() => Object.fromEntries([...document.querySelector('[data-testid="deal-calc-primary-bar"]').children].map((c, i) => [['arv', 'repairs', 'test', 'target', 'max', 'spread'][i], { label: c.children[0]?.textContent?.trim(), value: c.children[1]?.textContent?.trim() }])));
    const quickVal = async () => ((await T('deal-calc-repairs-quick-input').count()) ? T('deal-calc-repairs-quick-input').inputValue() : null);
    const spread = async () => (await T('deal-calc-spread-status').innerText()).replace(/\s+/g, ' ').trim();
    const total = async () => ((await T('deal-calc-repairs-detailed-total').count()) ? (await T('deal-calc-repairs-detailed-total').innerText()).replace(/\s+/g, ' ').trim() : null);
    const snap = async () => ({ quick: await quickVal(), bar: await bar(), spread: await spread() });
    const start = async () => { await go(); await T('deal-calc-arv-input').fill(String(ARV)); await T('deal-calc-test-price-input').fill(String(TEST)); await settle(); };

    // ── Q: Quick ──
    await start(); const q1 = await snap();
    check(`Q1 blank Quick, ARV and Test Price entered: Max ${exp.r0} (the formula at $0 repairs); the box stays blank; Repairs shows "$0" as known repairs, incomplete, and the Max is provisional`,
      q1.quick === '' && q1.bar.max.value === exp.r0 && q1.bar.repairs.value === '$0' && /incomplete/i.test(q1.bar.repairs.label) && /Provisional max/.test(q1.bar.max.label) && /Provisional — repairs incomplete/.test(q1.spread), q1);
    await T('deal-calc-repairs-quick-input').fill('25000'); await settle(); const q2 = await snap();
    check(`Q2 an entered 25,000 recalculates: Max ${exp.r25}; normal labels (Repairs / Max), not provisional`,
      q2.bar.max.value === exp.r25 && q2.bar.repairs.value === '$25,000' && q2.bar.repairs.label === 'Repairs' && q2.bar.max.label === 'Max' && !/Provisional/.test(q2.spread), q2);
    await T('deal-calc-repairs-quick-input').fill(''); await settle(); const q3 = await snap();
    check(`Q3 the figure erased again: Max back to ${exp.r0}, provisional, box blank`, q3.quick === '' && q3.bar.max.value === exp.r0 && /Provisional max/.test(q3.bar.max.label), q3);

    // ── I: Itemized ──
    await start(); await T('deal-calc-repairs-mode-toggle').click(); await settle();
    const i1 = { ...(await snap()), total: await total() };
    check(`I1 fresh Itemized: "Known repairs $0 — estimate incomplete", Max ${exp.r0}, provisional`,
      /Known repairs \$0(?![\d,])/.test(i1.total || '') && /incomplete/.test(i1.total || '') && i1.bar.max.value === exp.r0 && /Provisional max/.test(i1.bar.max.label), i1);
    await T('deal-calc-repair-hvac-repair').click(); await settle(); const i2 = { ...(await snap()), hvac: await T('deal-calc-repair-hvac-amount').inputValue() };
    check(`I2 HVAC Repair loads its existing default ${money(HVAC)} and recalculates Max ${exp.hvac}`, i2.hvac === String(HVAC) && i2.bar.max.value === exp.hvac, i2);
    await T('deal-calc-repair-roof-severe').click(); await settle(); const i3 = { ...(await snap()), roof: await T('deal-calc-repair-roof-amount').inputValue() };
    check(`I3 Roof Replace loads its existing default ${money(ROOF_REPLACE)} and recalculates Max ${exp.hvacRoof}`, i3.roof === String(ROOF_REPLACE) && i3.bar.max.value === exp.hvacRoof, i3);
    await T('deal-calc-repairs-clear').click(); await settle(); const i4 = { ...(await snap()), total: await total() };
    check(`I4 repair-only Clear: Known repairs $0 and Max back to ${exp.r0}`, /Known repairs \$0(?![\d,])/.test(i4.total || '') && i4.bar.max.value === exp.r0, i4);

    // ── N: no substitution where it does not apply ──
    await start(); await T('deal-calc-repairs-quick-input').fill('abc'); await settle();
    const n1 = { ...(await snap()), error: (await T('deal-calc-repairs-error').count()) ? await T('deal-calc-repairs-error').innerText() : null };
    check('N1 an invalid Quick entry is an error and is NOT read as $0: Max waits ("Not yet calculated")', !!n1.error && n1.bar.max.value === 'Not yet calculated', n1);
    await go(); await T('deal-calc-test-price-input').fill(String(TEST)); await settle(); const n2 = await snap();
    check('N2 without an ARV, Max waits ("Not yet calculated") even though repairs default to $0', n2.bar.max.value === 'Not yet calculated', n2);

    // ── L: deal-first precedence unchanged ──
    await go('contactId=c-ann'); const l1 = await snap();
    check(`L1 a linked deal with recorded repairs keeps its figure: 30,000 "On the deal in GHL", Max ${exp.deal}`, l1.quick === '30000' && l1.bar.max.value === exp.deal && l1.bar.repairs.label === 'Repairs', l1);

    check('W reads only (GET); nothing left the page; no page errors', requests.every((x) => x.startsWith('GET ')) && foreign.length === 0 && pageErrors.length === 0, { foreign, pageErrors });
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  clearTimeout(watchdog);
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-24 Max Offer with $0 repairs: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
