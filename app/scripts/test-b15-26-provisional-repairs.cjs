/**
 * B15-26 (INV-134) with B15-01 (INV-100) -- incomplete repairs are presented
 * as provisional (Jess ruling 2026-10-21 on Spock's Test finding: a green
 * "Meets" spread status was shown while all 7 repair rows were unknown).
 *
 * Part A (pure; compiled with tsc, no network): the spread status, bar labels
 * and net wording, against the ruling's exact text, with every number and
 * every complete-repairs output unchanged.
 *
 * Part B (real page; offline): Vite serves scripts/harness/deal-calculator,
 * which renders the REAL DealCalculator in headless Chromium. Every
 * /.netlify/functions request is answered here (only the underwriting-policy
 * read is expected); any other network request is aborted and counted. No
 * GHL, no write. Repair cases: all unknown, partially answered, invalid,
 * explicit $0/Good, fully answered -- completeness comes from the estimate's
 * own flag, never from a $0 total.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-b15-26-provisional-repairs-test');
/** Literal check() call-site count in this file (Part A 22 + Part B 31), never back-filled from a passing run. */
const FLOOR = 53;
const HEADLINE = 'Provisional — repairs incomplete.';
const support = (x) => `Based on known repairs of ${x}. Complete the repair estimate before assessing profitability.`;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ============================================================
// Part A -- pure functions.
// ============================================================
function partA() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
  const SOURCES = ['src/lib/deal-calculator-bar.ts', 'src/lib/wholesaler-net-proceeds.ts', 'src/lib/provisional-repairs.ts',
    'src/lib/underwriting/compute.ts', 'src/lib/underwriting/board8-economics.ts'].map((s) => path.join(APP, s));
  try {
    execSync(`node "${path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc')}" ${SOURCES.map((s) => `"${s}"`).join(' ')} --outDir "${TMP}" --module commonjs --target es2020 --strict --skipLibCheck`,
      { cwd: APP, stdio: 'inherit' });
  } catch (e) {
    console.error('ABORT: TypeScript compilation failed. Nothing tested.');
    process.exit(10);
  }
  const bar = require(path.join(TMP, 'deal-calculator-bar.js'));
  const net = require(path.join(TMP, 'wholesaler-net-proceeds.js'));
  const { computeUnderwriting } = require(path.join(TMP, 'underwriting', 'compute.js'));
  const { computeBoard8Economics, computeExpectedSpread } = require(path.join(TMP, 'underwriting', 'board8-economics.js'));

  const V = (v) => ({ kind: 'value', value: v, level: 'iaos_starter' });
  const D = (v) => ({ kind: 'value', value: v });
  const result = computeUnderwriting({
    arv: D(300000), repairs: D(0), sellingCostPct: V(0.10), closingCost: V(2500), monthlyCarry: V(500), holdMonths: V(5),
    buyerProfitPct: V(0.15), financing: { kind: 'on', level: 'iaos_starter', ltv: V(0.70), rate: V(0.12), points: V(0.02) },
    assignment: { kind: 'standard' }, standardMinimum: V(5000), profitSharePct: V(0.25),
  });
  const b8 = computeBoard8Economics(result);
  const active = { mode: 'standard', requiredSpread: result.figures.assignmentSpread };
  const spreadAt = (tp) => computeExpectedSpread({ endBuyerMaxPrice: b8.endBuyerMaxPrice, referenceKind: 'test_price', referencePrice: tp });
  const meetsTp = b8.maxSupportedOffer - 20000, shortTp = b8.maxSupportedOffer + 2000, negTp = b8.endBuyerMaxPrice + 3000;
  const INC0 = { incomplete: true, knownRepairs: 0 };
  const COMPLETE = { incomplete: false, knownRepairs: 0 };

  const meets = bar.buildSpreadStatus(b8, spreadAt(meetsTp), active, 'standard');
  check('A1 fixture: without completeness the status is the unchanged green meets', meets.kind === 'meets' && meets.text.startsWith('Meets '), meets);
  check('A2 complete repairs: status byte-identical to the no-argument call', same(bar.buildSpreadStatus(b8, spreadAt(meetsTp), active, 'standard', COMPLETE), meets));
  const prov = bar.buildSpreadStatus(b8, spreadAt(meetsTp), active, 'standard', INC0);
  check('A3 incomplete + would-meet: kind provisional (never meets)', prov.kind === 'provisional', prov);
  check('A4 provisional text is exactly the ruling headline + supporting text', prov.text === `${HEADLINE} ${support('$0')}`, prov.text);
  check('A5 provisional text carries no "meets"/"minimum" wording', !/meets|minimum/i.test(prov.text), prov.text);
  const knownProv = bar.buildSpreadStatus(b8, spreadAt(meetsTp), active, 'standard', { incomplete: true, knownRepairs: 12500.4 });
  check('A6 known repairs shown through the one whole-dollar formatter', knownProv.text === `${HEADLINE} ${support('$12,500')}`, knownProv.text);

  const short = bar.buildSpreadStatus(b8, spreadAt(shortTp), active, 'standard');
  const shortInc = bar.buildSpreadStatus(b8, spreadAt(shortTp), active, 'standard', INC0);
  check('A7 incomplete + short: kind and shortfalls preserved', short.kind === 'short' && shortInc.kind === 'short' && same(shortInc.shortfalls, short.shortfalls), shortInc);
  check('A8 incomplete + short: the full warning kept verbatim inside headline + support', shortInc.text === `${HEADLINE} ${short.text} ${support('$0')}`, shortInc.text);
  const neg = bar.buildSpreadStatus(b8, spreadAt(negTp), active, 'standard');
  const negInc = bar.buildSpreadStatus(b8, spreadAt(negTp), active, 'standard', INC0);
  check('A9 incomplete + negative: stays negative, full warning kept verbatim', neg.kind === 'negative' && negInc.kind === 'negative' && negInc.text === `${HEADLINE} ${neg.text} ${support('$0')}`, negInc);
  const neutral = bar.buildSpreadStatus(b8, spreadAt(null), active, 'standard');
  check('A10 incomplete + Unknown input (no Test Price): neutral returned unchanged', neutral.kind === 'neutral' && same(bar.buildSpreadStatus(b8, spreadAt(null), active, 'standard', INC0), neutral), neutral);

  const cellsIn = { arv: 300000, repairs: 0, testPrice: meetsTp, board8: b8, expectedSpread: spreadAt(meetsTp) };
  const plain = bar.buildDealCalculatorBarCells(cellsIn);
  const inc = bar.buildDealCalculatorBarCells({ ...cellsIn, repairsIncomplete: true });
  check('A11 complete cells keep the original six labels', same(plain.map((c) => c.label), ['ARV', 'Repairs', 'Test Price', 'Target', 'Max', 'Spread']));
  check('A12 incomplete cells: "Known repairs (incomplete)" and "Provisional spread"', same(inc.map((c) => c.label), ['ARV', 'Known repairs (incomplete)', 'Test Price', 'Target', 'Max', 'Provisional spread']));
  check('A13 incomplete cells: every key and value identical (numbers unchanged)', same(inc.map((c) => [c.key, c.value]), plain.map((c) => [c.key, c.value])));
  check('A14 repairsIncomplete false = absent (byte-identical cells)', same(bar.buildDealCalculatorBarCells({ ...cellsIn, repairsIncomplete: false }), plain));

  const money = bar.formatWholeDollars;
  const est = { kind: 'estimated', grossSpread: 25000, totalCosts: 1500, net: 23500 };
  check('A15 complete net text unchanged', net.netProceedsText(est, money) === 'Estimated net at modeled buyer price: $23,500 = gross spread $25,000 - your costs $1,500.'
    && net.netProceedsText(est, money, COMPLETE) === net.netProceedsText(est, money));
  check('A16 incomplete estimated net: "Provisional estimated net", same amounts, support text',
    net.netProceedsText(est, money, INC0) === `Provisional estimated net: $23,500 = provisional gross spread $25,000 - your costs $1,500. ${support('$0')}`,
    net.netProceedsText(est, money, INC0));
  const below = { kind: 'estimated', grossSpread: 1000, totalCosts: 4000, net: -3000 };
  check('A17 incomplete below-zero net keeps "(below zero)"', net.netProceedsText(below, money, INC0).startsWith('Provisional estimated net: -$3,000 (below zero)'));
  const unk = { kind: 'unknown', unknown: ['Legal / attorney review'] };
  check('A18 missing wholesaler costs still read Unknown, unchanged, when repairs are incomplete',
    net.netProceedsText(unk, money, INC0) === net.netProceedsText(unk, money) && net.netProceedsText(unk, money).startsWith('Net not estimated. Unknown:'));
  check('A19 no type / no gross unchanged when repairs are incomplete',
    net.netProceedsText({ kind: 'no_type' }, money, INC0) === net.netProceedsText({ kind: 'no_type' }, money)
      && net.netProceedsText({ kind: 'no_gross' }, money, INC0) === net.netProceedsText({ kind: 'no_gross' }, money));
  check('A20 accessible label: provisional only for an estimated net on incomplete repairs',
    net.netResultLabel(est, INC0) === 'Provisional estimated net' && net.netResultLabel(est, COMPLETE) === net.NET_RESULT_LABEL
      && net.netResultLabel(unk, INC0) === net.NET_RESULT_LABEL && net.netResultLabel(est) === net.NET_RESULT_LABEL);
  const computed = net.computeNetProceeds({ type: 'assignment', entries: { legal: { kind: 'amount', amount: 1000 }, assignment_title_fee: { kind: 'not_applicable' }, jv_share: { kind: 'not_applicable' }, marketing: { kind: 'not_applicable' } }, grossSpread: spreadAt(meetsTp) });
  check('A21 net arithmetic itself takes no completeness input (same result object)', computed.kind === 'estimated' && computed.net === spreadAt(meetsTp).expectedSpread - 1000, computed);
  const src = fs.readFileSync(path.join(APP, 'src/pages/DealCalculator.tsx'), 'utf8');
  check('A22 page: completeness is the estimate\'s own flag, never inferred from an amount',
    /repairsMode === "detailed" \? \{ incomplete: detailedEstimate\.incomplete, knownRepairs: detailedEstimate\.total \} : null/.test(src)
      && !/incomplete:\s*[^,}]*(total|repairs)\s*===\s*0/.test(src));
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ============================================================
// Part B -- the real page.
// ============================================================
async function partB() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/deal-calculator/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const log = [];
  const foreign = [];
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      log.push({ fn, method: route.request().method() });
      if (fn === 'ghl-underwriting-policy') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ values: [] }) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `fixture does not model ${fn}` }) });
    });
    const T = (id) => page.getByTestId(id);
    const settle = () => page.waitForTimeout(250);
    const fresh = async () => {
      await page.goto(`${base}/scripts/harness/deal-calculator/index.html`);
      await T('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 });
    };
    /** Raw label text (CSS uppercases it on screen; textContent is the source text) and the six values. */
    const barState = async () => page.evaluate(() => {
      const barEl = document.querySelector('[data-testid="deal-calc-primary-bar"]');
      return Array.from(barEl.children).map((cell) => ({ label: cell.children[0].textContent, value: cell.children[1].textContent }));
    });
    const status = async () => ({ kind: await T('deal-calc-spread-status').getAttribute('data-spread-status'), text: (await T('deal-calc-spread-status').textContent()).trim(),
      color: await T('deal-calc-spread-status').evaluate((el) => getComputedStyle(el).color) });
    const itemized = async () => { await T('deal-calc-repairs-mode-toggle').click(); await T('repair-preliminary-total').waitFor(); };
    const SYSTEMS = ['roof', 'hvac', 'electrical_whole_house', 'electrical_panel', 'plumbing_sewer', 'foundation', 'windows'];
    const AMBER = 'rgb(245, 158, 11)', GREEN = 'rgb(34, 197, 94)';
    const PLAIN = ['ARV', 'Repairs', 'Test Price', 'Target', 'Max', 'Spread'];
    const PROV = ['ARV', 'Known repairs (incomplete)', 'Test Price', 'Target', 'Max', 'Provisional spread'];

    // B0 -- quick mode, nothing entered: Repairs Unknown keeps the neutral "enter Repairs" status.
    await fresh();
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('100000');
    await settle();
    const b0 = await status();
    check('B0 quick mode, no repairs: neutral status naming Repairs (Unknown preserved)', b0.kind === 'neutral' && /Repairs/.test(b0.text), b0);

    // Reference: quick total $0 (an operator-entered complete figure) -- the unchanged green meets.
    await T('deal-calc-repairs-quick-input').fill('0');
    await settle();
    const ref0 = { bar: await barState(), st: await status() };
    check('B1 reference quick $0: unchanged green meets with the original labels', ref0.st.kind === 'meets' && ref0.st.color === GREEN && same(ref0.bar.map((c) => c.label), PLAIN), ref0);

    // 1 -- all 7 rows unknown.
    await fresh();
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('100000');
    await itemized();
    await settle();
    const all = { bar: await barState(), st: await status() };
    check('B2 all unknown: status kind provisional, amber, never meets', all.st.kind === 'provisional' && all.st.color === AMBER, all.st);
    check('B3 all unknown: exact ruled headline + supporting text ($0 known)', all.st.text === `${HEADLINE} ${support('$0')}`, all.st.text);
    check('B4 all unknown: no "Meets"/"minimum" on the page status', !/meets|minimum/i.test(all.st.text));
    check('B5 all unknown: bar labels "Known repairs (incomplete)" and "Provisional spread"', same(all.bar.map((c) => c.label), PROV), all.bar);
    check('B6 all unknown: every bar value identical to the quick-$0 reference (numbers unchanged)', same(all.bar.map((c) => c.value), ref0.bar.map((c) => c.value)), { all: all.bar, ref: ref0.bar });
    check('B7 all unknown: the repair summary still reads the Oct 19 "Known repairs: $0 — estimate incomplete"',
      (await T('repair-estimate-status').textContent()).trim() === 'Known repairs: $0 — estimate incomplete');

    // Net panel on incomplete repairs: Unknown costs stay Unknown; an estimated net is provisional.
    await T('deal-calc-net-type-assignment').click();
    await settle();
    const netUnknown = { text: (await T('deal-calc-net-result').textContent()).trim(), prov: await T('deal-calc-net-result').getAttribute('data-net-provisional'), label: await T('deal-calc-net-result').getAttribute('aria-label') };
    check('B8 missing wholesaler costs: net still "Net not estimated. Unknown: …", not provisional', netUnknown.text.startsWith('Net not estimated. Unknown:') && netUnknown.prov === 'false' && netUnknown.label === 'Estimated net at modeled buyer price', netUnknown);
    const naBoxes = page.locator('[data-testid="deal-calc-net-panel"] input[type="checkbox"][data-testid$="-na"]');
    for (let i = 0; i < await naBoxes.count(); i++) await naBoxes.nth(i).check();
    await settle();
    const netProv = { text: (await T('deal-calc-net-result').textContent()).trim(), prov: await T('deal-calc-net-result').getAttribute('data-net-provisional'), label: await T('deal-calc-net-result').getAttribute('aria-label') };
    const spreadVal = all.bar[5].value;
    check('B9 all costs N/A on incomplete repairs: "Provisional estimated net" with the unchanged spread amount',
      netProv.prov === 'true' && netProv.label === 'Provisional estimated net'
        && netProv.text === `Provisional estimated net: ${spreadVal} = provisional gross spread ${spreadVal} - your costs $0. ${support('$0')}`, netProv);

    // Short and negative on incomplete repairs: warnings kept inside the provisional wording.
    const maxText = all.bar[4].value;
    const max = Number(maxText.replace(/[$,]/g, ''));
    await T('deal-calc-test-price-input').fill(String(max + 2000));
    await settle();
    const shortSt = await status();
    check('B10 incomplete + below minimum: stays "short" (amber), full shortfall warning kept, wrapped provisional',
      shortSt.kind === 'short' && shortSt.text.startsWith(HEADLINE) && /short of the \$5,000 standard minimum/.test(shortSt.text) && shortSt.text.endsWith(support('$0')), shortSt);
    await T('deal-calc-test-price-input').fill(String(max + 20000));
    await settle();
    const negSt = await status();
    check('B11 incomplete + negative: stays "negative" (red), the negative warning kept, wrapped provisional',
      negSt.kind === 'negative' && negSt.text.startsWith(`${HEADLINE} Negative spread:`) && negSt.text.endsWith(support('$0')) && negSt.color === 'rgb(239, 68, 68)', negSt);

    // 2 -- partially answered: Roof Good, HVAC Repair ($2,500), the rest unknown.
    await fresh();
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('100000');
    await itemized();
    await T('deal-calc-repair-roof-good').click();
    await T('deal-calc-repair-hvac-repair').click();
    await settle();
    const part = { bar: await barState(), st: await status() };
    check('B12 partial: provisional with known repairs $2,500', part.st.kind === 'provisional' && part.st.text === `${HEADLINE} ${support('$2,500')}`, part.st);
    check('B13 partial: bar shows Known repairs (incomplete) $2,500 and Provisional spread', part.bar[1].label === 'Known repairs (incomplete)' && part.bar[1].value === '$2,500' && part.bar[5].label === 'Provisional spread', part.bar);

    // 3 -- invalid: six rows Good, Roof amount "$" (punctuation only -> not an answer).
    await fresh();
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('100000');
    await itemized();
    for (const s of SYSTEMS.filter((x) => x !== 'roof')) await T(`deal-calc-repair-${s}-good`).click();
    await T('deal-calc-repair-roof-amount').fill('$');
    await settle();
    const inval = { bar: await barState(), st: await status() };
    check('B14 invalid "$" on the last row: still incomplete -> provisional, known $0', inval.st.kind === 'provisional' && inval.st.text === `${HEADLINE} ${support('$0')}`, inval.st);
    check('B15 invalid: Roof stays visibly unresolved', await T('repair-unresolved-roof').isVisible().catch(() => false));
    await T('deal-calc-repair-misc-amount').fill('abc');
    await settle();
    const invalMisc = await status();
    check('B16 invalid Misc amount also keeps it provisional', invalMisc.kind === 'provisional', invalMisc);

    // 4 -- explicit $0 / Good on every row: COMPLETE at a $0 total -> the unchanged green meets.
    await fresh();
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('100000');
    await itemized();
    for (const s of SYSTEMS.filter((x) => x !== 'roof')) await T(`deal-calc-repair-${s}-good`).click();
    await T('deal-calc-repair-roof-amount').fill('0');
    await settle();
    const zero = { bar: await barState(), st: await status() };
    check('B17 explicit $0 + Good on all 7 rows: complete at $0 -> green meets (completeness not inferred from $0)', zero.st.kind === 'meets' && zero.st.color === GREEN, zero.st);
    check('B18 explicit $0/Good: status text identical to the quick-$0 reference', zero.st.text === ref0.st.text, { zero: zero.st.text, ref: ref0.st.text });
    check('B19 explicit $0/Good: original labels and identical values', same(zero.bar, ref0.bar), { zero: zero.bar, ref: ref0.bar });
    check('B20 explicit $0/Good: summary is not "estimate incomplete"', !/incomplete/.test((await T('repair-estimate-status').textContent()) || ''));
    await T('deal-calc-net-type-assignment').click();
    const naBoxes2 = page.locator('[data-testid="deal-calc-net-panel"] input[type="checkbox"][data-testid$="-na"]');
    for (let i = 0; i < await naBoxes2.count(); i++) await naBoxes2.nth(i).check();
    await settle();
    const netComplete = { text: (await T('deal-calc-net-result').textContent()).trim(), prov: await T('deal-calc-net-result').getAttribute('data-net-provisional'), label: await T('deal-calc-net-result').getAttribute('aria-label') };
    check('B21 complete repairs: net reads the unchanged "Estimated net at modeled buyer price: …"',
      netComplete.prov === 'false' && netComplete.label === 'Estimated net at modeled buyer price' && netComplete.text.startsWith(`Estimated net at modeled buyer price: ${zero.bar[5].value} =`), netComplete);

    // 5 -- fully answered with amounts: six Repair + Windows Good = $18,500, complete.
    await fresh();
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('100000');
    await T('deal-calc-repairs-quick-input').fill('18500');
    await settle();
    const ref185 = { bar: await barState(), st: await status() };
    await fresh();
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('100000');
    await itemized();
    for (const s of SYSTEMS.filter((x) => x !== 'windows')) await T(`deal-calc-repair-${s}-repair`).click();
    await T('deal-calc-repair-windows-good').click();
    await settle();
    const full = { bar: await barState(), st: await status() };
    check('B22 fully answered: total $18,500, not incomplete', (await T('repair-preliminary-total').textContent()).trim() === '$18,500' && !/incomplete/.test((await T('repair-estimate-status').textContent()) || ''));
    check('B23 fully answered: original labels', same(full.bar.map((c) => c.label), PLAIN), full.bar);
    check('B24 fully answered: bar values and status identical to quick $18,500 (complete behaviour unchanged)', same(full.bar, ref185.bar) && same(full.st, ref185.st), { full, ref185 });
    check('B25 fully answered: status is not provisional', full.st.kind !== 'provisional' && !full.st.text.startsWith(HEADLINE), full.st);

    // Repair-only Clear returns to incomplete -> provisional again.
    await T('deal-calc-repairs-clear').click();
    await settle();
    const cleared = await status();
    check('B26 repair-only Clear: back to known $0 incomplete -> provisional', cleared.kind === 'provisional' && cleared.text === `${HEADLINE} ${support('$0')}`, cleared);

    check('B27 the page sent no write', !log.some((r) => r.method !== 'GET' || /write/.test(r.fn)), log);
    check('B28 no request left the machine', foreign.length === 0, foreign);
    check('B29 no page errors', pageErrors.length === 0, pageErrors);
    check('B30 only the underwriting-policy read was requested', log.every((r) => r.fn === 'ghl-underwriting-policy'), log);
  } catch (e) {
    console.error(e);
    failures += 1;
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

(async () => {
  partA();
  await partB();
  if (checks < FLOOR) { failures += 1; console.error(`FLOOR  only ${checks} checks ran (floor ${FLOOR})`); }
  console.log(`\nB15-26 provisional repairs: ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''}`);
  process.exit(failures ? 1 : 0);
})();
