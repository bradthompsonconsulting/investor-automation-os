/**
 * Standalone Deal Calculator primary bar -- test runner. B8-09 / INV-52.
 *
 * Compiles the pure bar formatter and its B8-03 dependency to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no React, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-deal-calculator-bar-test');
const UW = path.join(APP, 'src', 'lib', 'underwriting');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(UW, 'types.ts'),
  path.join(UW, 'resolver-types.ts'),
  path.join(UW, 'starters.ts'),
  path.join(UW, 'resolver.ts'),
  path.join(UW, 'compute.ts'),
  path.join(UW, 'board8-economics.ts'),
  path.join(LIB, 'arv-reconciliation.ts'),
  path.join(LIB, 'comp-classification.ts'),
  path.join(LIB, 'propstream-comp-csv.ts'),
  path.join(LIB, 'deal-calculator-inputs.ts'),
  path.join(LIB, 'deal-calculator-bar.ts'),
];

try {
  execSync(
    'npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') +
    ' --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const computePath = path.join(TMP, 'underwriting', 'compute.js');
const board8Path = path.join(TMP, 'underwriting', 'board8-economics.js');
const barPath = path.join(TMP, 'deal-calculator-bar.js');
for (const p of [computePath, board8Path, barPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeUnderwriting } = require(computePath);
const { computeBoard8Economics, computeExpectedSpread } = require(board8Path);
const { buildDealCalculatorBarCells, buildSpreadStatus, formatWholeDollars, DEAL_CALC_BAR_LABELS } = require(barPath);
const { buildDealCalculatorInputs } = require(path.join(TMP, 'deal-calculator-inputs.js'));

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 81;
let failures = 0;
let checks = 0;

function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log('PASS  ' + name);
  } else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

const V = (v, level) => ({ kind: 'value', value: v, level: level || 'iaos_starter' });
const D = (v) => ({ kind: 'value', value: v });

function underwritingInputs(over) {
  return Object.assign({
    arv: D(315000),
    repairs: D(41000),
    sellingCostPct: V(0.10),
    closingCost: V(2500),
    monthlyCarry: V(500),
    holdMonths: V(5),
    buyerProfitPct: V(0.15),
    financing: { kind: 'on', level: 'iaos_starter', ltv: V(0.70), rate: V(0.12), points: V(0.02) },
    assignment: { kind: 'standard' },
    standardMinimum: V(5000),
    profitSharePct: V(0.25),
  }, over || {});
}

const GOLDEN_RESULT = computeUnderwriting(underwritingInputs());
const GOLDEN_ECONOMICS = computeBoard8Economics(GOLDEN_RESULT);
const UNAVAILABLE_ECONOMICS = computeBoard8Economics(computeUnderwriting(underwritingInputs({ arv: { kind: 'unresolved', reason: 'absent' } })));

// ============================================================
// Exact order and labels.
// ============================================================
{
  const cells = buildDealCalculatorBarCells({ arv: 315000, repairs: 41000, testPrice: null, board8: GOLDEN_ECONOMICS, expectedSpread: null });
  check('exactly six cells', cells.length, 6);
  check('cell keys in exact order', cells.map((c) => c.key), ['arv', 'repairs', 'test_price', 'target', 'max', 'spread']);
  check('cell labels in exact order', cells.map((c) => c.label), DEAL_CALC_BAR_LABELS.slice());
  check('DEAL_CALC_BAR_LABELS matches the required sequence', DEAL_CALC_BAR_LABELS.slice(), ['ARV', 'Repairs', 'Test Price', 'Target', 'Max', 'Spread']);
}

// ============================================================
// ARV / Repairs / Test Price -- honest known-vs-waiting, all three
// operator-entered, none ever fabricated.
// ============================================================
{
  const known = buildDealCalculatorBarCells({ arv: 315000, repairs: 41000, testPrice: 150000, board8: null, expectedSpread: null });
  check('ARV known renders as a value', known[0].value.kind, 'value');
  check('ARV known renders the exact formatted amount', known[0].value.text, '$315,000');
  check('Repairs known renders as a value', known[1].value.kind, 'value');
  check('Repairs known renders the exact formatted amount', known[1].value.text, '$41,000');
  check('Test Price known renders as a value', known[2].value.kind, 'value');
  check('Test Price known renders the exact formatted amount', known[2].value.text, '$150,000');

  const missing = buildDealCalculatorBarCells({ arv: null, repairs: null, testPrice: null, board8: null, expectedSpread: null });
  check('ARV missing renders as waiting, never a fabricated number', missing[0].value.kind, 'waiting');
  check('Repairs missing renders as waiting, never a fabricated number', missing[1].value.kind, 'waiting');
  check('Test Price missing renders as waiting -- IAOS never invents an opening test price', missing[2].value.kind, 'waiting');
}

// ============================================================
// Target / Max -- read from B8-03's Board8Economics only. Golden fixture
// values cross-checked against test-board8-economics.cjs's own golden
// path assertions (endBuyerMaxPrice ~181363, target ~169550.5, max ~176363).
// ============================================================
{
  check('setup: golden economics is calculated', GOLDEN_ECONOMICS.status, 'calculated');
  const cells = buildDealCalculatorBarCells({ arv: 315000, repairs: 41000, testPrice: null, board8: GOLDEN_ECONOMICS, expectedSpread: null });
  const target = cells.find((c) => c.key === 'target');
  const max = cells.find((c) => c.key === 'max');
  check('Target renders as a value from B8-03 output', target.value.kind, 'value');
  check('Target renders the exact B8-03 figure', target.value.text, '$169,551');
  check('Max renders as a value from B8-03 output', max.value.kind, 'value');
  check('Max renders the exact B8-03 figure', max.value.text, '$176,363');

  const unavailableCells = buildDealCalculatorBarCells({ arv: null, repairs: null, testPrice: null, board8: UNAVAILABLE_ECONOMICS, expectedSpread: null });
  check('Target waits honestly when B8-03 is unavailable', unavailableCells.find((c) => c.key === 'target').value.kind, 'waiting');
  check('Max waits honestly when B8-03 is unavailable', unavailableCells.find((c) => c.key === 'max').value.kind, 'waiting');
}

// ============================================================
// Spread -- Expected Spread @ Test Price. Calculated only when B8-03's
// ExpectedSpread is itself calculated with referenceKind "test_price";
// honest waiting otherwise, naming Test Price by name.
// ============================================================
{
  const calculatedSpread = computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'test_price', referencePrice: 150000 });
  const cellsCalculated = buildDealCalculatorBarCells({ arv: 315000, repairs: 41000, testPrice: 150000, board8: GOLDEN_ECONOMICS, expectedSpread: calculatedSpread });
  check('Spread renders as a value when B8-03 Expected Spread calculated', cellsCalculated.find((c) => c.key === 'spread').value.kind, 'value');
  check('Spread renders the exact B8-03 figure', cellsCalculated.find((c) => c.key === 'spread').value.text, '$31,363');

  const unavailableSpread = computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'test_price', referencePrice: null });
  const cellsUnavailable = buildDealCalculatorBarCells({ arv: 315000, repairs: 41000, testPrice: null, board8: GOLDEN_ECONOMICS, expectedSpread: unavailableSpread });
  const spreadCell = cellsUnavailable.find((c) => c.key === 'spread');
  check('Spread waits honestly with no Test Price', spreadCell.value.kind, 'waiting');
  check('Spread reason names Test Price specifically, matching B8-03s own reason text', spreadCell.value.text.toLowerCase().indexOf('test price') >= 0, true);

  const noSpreadComputedYet = buildDealCalculatorBarCells({ arv: 315000, repairs: 41000, testPrice: null, board8: GOLDEN_ECONOMICS, expectedSpread: null });
  check('Spread waits before any ExpectedSpread has been computed at all', noSpreadComputedYet.find((c) => c.key === 'spread').value.kind, 'waiting');
}

// ============================================================
// B15-26 (INV-134) -- spread status, warnings only. Two checks (Jess
// ruling 2026-10-07, option a): the Standard Minimum AND the active
// assignment mode's own required spread (figures.assignmentSpread), green
// only when both are met. Golden economics: endBuyerMaxPrice
// 181,363.203..., Standard Minimum $5,000, 25% of Buyer Profit spread
// $11,812.50. Every status carries text; color is never the only signal.
// ============================================================
{
  const NOTE = ' This is not a net-profit check.';
  const run = (assignment, testPrice) => {
    const result = computeUnderwriting(underwritingInputs({ assignment }));
    const b8 = computeBoard8Economics(result);
    const spread = computeExpectedSpread({ endBuyerMaxPrice: b8.endBuyerMaxPrice, referenceKind: 'test_price', referencePrice: testPrice });
    return buildSpreadStatus(b8, spread, { mode: assignment.kind, requiredSpread: result.figures.assignmentSpread });
  };
  const EBM = GOLDEN_ECONOMICS.endBuyerMaxPrice;
  const STD = { kind: 'standard' };
  const PS = { kind: 'profit_share' };

  // Standard Minimum mode: the two requirements are one number.
  check('standard: exactly at Max (spread $5,000) is green', run(STD, EBM - 5000).kind, 'meets');
  check('standard: green text names the standard minimum and says it is not a net-profit check', run(STD, EBM - 5000).text, 'Meets the $5,000 standard minimum.' + NOTE);
  check('standard: $3,363.20 spread is amber with the exact shortfall', run(STD, 178000).text, '$1,637 short of the $5,000 standard minimum.');
  check('standard: shortfall carried is exact and unrounded', Math.abs(run(STD, 178000).shortfalls[0].shortfall - (5000 - (EBM - 178000))) < 1e-9, true);

  // 25% of Buyer Profit mode (the calculator default) -- the review's blocker.
  const psAtMax = run(PS, EBM - 5000);
  check('profit_share: meeting $5,000 but missing the mode spread is NOT green', psAtMax.kind, 'short');
  check('profit_share: names the met minimum and the missed mode requirement with its shortfall', psAtMax.text,
    'Meets the $5,000 standard minimum, but $6,813 short of the 25% of Buyer Profit spread ($11,813).');
  check('profit_share: the one shortfall is the mode requirement, exact', psAtMax.shortfalls.map((f) => [f.requirement, f.required, Math.round(f.shortfall * 1e6) / 1e6]), [['assignment_mode', 11812.5, 6812.5]]);
  check('profit_share: spread exactly at the mode requirement is green, naming both', run(PS, EBM - 11812.5).text,
    'Meets the $5,000 standard minimum and the 25% of Buyer Profit spread ($11,813).' + NOTE);
  check('profit_share: margin is measured over the higher requirement', run(PS, 150000).text,
    'Meets the $5,000 standard minimum and the 25% of Buyer Profit spread ($11,813), $19,551 above.' + NOTE);
  check('profit_share: both missed are both named', run(PS, 178000).text,
    '$1,637 short of the $5,000 standard minimum; $8,449 short of the 25% of Buyer Profit spread ($11,813).');

  // Manual mode, above and below the standard minimum.
  const m15 = run({ kind: 'manual', amount: 15000 }, EBM - 5000);
  check('manual $15,000: meeting $5,000 but not $15,000 is amber', m15.kind, 'short');
  check('manual $15,000: names the missed Manual spread', m15.text, 'Meets the $5,000 standard minimum, but $10,000 short of the Manual spread ($15,000).');
  check('manual $15,000: meeting both is green', run({ kind: 'manual', amount: 15000 }, EBM - 15000).kind, 'meets');
  const m3 = run({ kind: 'manual', amount: 3000 }, EBM - 3000);
  check('manual $3,000: meeting the Manual spread but not $5,000 is amber, never green', m3.kind, 'short');
  check('manual $3,000: names the met Manual spread and the missed standard minimum', m3.text, 'Meets the Manual spread ($3,000), but $2,000 short of the $5,000 standard minimum.');
  check('manual $3,000: meeting $5,000 meets both', run({ kind: 'manual', amount: 3000 }, EBM - 5000).kind, 'meets');

  // Negative.
  check('negative spread is red and names both requirements', run(PS, 190000).text,
    "Negative spread: this Test Price is $8,637 above the end buyer's maximum price, so there is no assignment spread. Required: the $5,000 standard minimum and the 25% of Buyer Profit spread ($11,813).");
  check('negative in standard mode is red', run(STD, 190000).kind, 'negative');

  // Neutral: no implied success.
  const noTest = buildSpreadStatus(GOLDEN_ECONOMICS, computeExpectedSpread({ endBuyerMaxPrice: EBM, referenceKind: 'test_price', referencePrice: null }), { mode: 'standard', requiredSpread: 5000 });
  check('no Test Price -> neutral, naming the missing input', [noTest.kind, noTest.text], ['neutral', 'No spread check yet: enter a Test Price.']);
  check('no economics -> neutral', buildSpreadStatus(UNAVAILABLE_ECONOMICS, null, null).kind, 'neutral');
  check('no active requirement -> neutral', buildSpreadStatus(GOLDEN_ECONOMICS, null, null).kind, 'neutral');

// ============================================================
// B15-26 partial (Batch 4): the neutral status names the inputs actually
// missing, through the calculator's own input builder and the shared
// engine, exactly as the page computes it. Copy only.
// ============================================================
{
  const POLICY_IDS = {
    sellingCostPct: 'id_sellingCostPct', closingCost: 'id_closingCost', monthlyCarry: 'id_monthlyCarry', holdMonths: 'id_holdMonths',
    buyerProfitPct: 'id_buyerProfitPct', financingEnabled: 'id_financingEnabled', financingLtv: 'id_financingLtv', financingRate: 'id_financingRate',
    financingPoints: 'id_financingPoints', standardMinimum: 'id_standardMinimum', profitSharePct: 'id_profitSharePct',
  };
  // The page's own path: empty Investor Policy resolves to the IAOS Starter values.
  const page = (arv, repairs, assignment, testPrice = null) => {
    const result = computeUnderwriting(buildDealCalculatorInputs({ arv, repairs, assignment, policyValues: [], policyIds: POLICY_IDS }));
    const board8 = computeBoard8Economics(result);
    const expected = computeExpectedSpread({ endBuyerMaxPrice: board8.status === 'calculated' ? board8.endBuyerMaxPrice : 0, referenceKind: 'test_price', referencePrice: board8.status === 'calculated' ? testPrice : null });
    const active = result.status === 'resolved' ? { mode: assignment.mode, requiredSpread: result.figures.assignmentSpread } : null;
    return buildSpreadStatus(board8, expected, active, assignment.mode);
  };
  const MANUAL_EMPTY = { mode: 'manual', amount: null };
  const n = (s) => [s.kind, s.text];

  check('the reported finding: Manual with no amount, ARV and Repairs present, names only the Manual amount',
    n(page(315000, 41000, MANUAL_EMPTY)), ['neutral', 'No spread check yet: enter the Manual assignment amount.']);
  check('...and never asks for ARV or Repairs it already has', /ARV|Repairs/.test(page(315000, 41000, MANUAL_EMPTY).text), false);
  check('missing ARV only', n(page(null, 41000, { mode: 'standard' })), ['neutral', 'No spread check yet: enter ARV.']);
  check('missing Repairs only', n(page(315000, null, { mode: 'standard' })), ['neutral', 'No spread check yet: enter Repairs.']);
  check('missing ARV and Repairs', page(null, null, { mode: 'profit_share' }).text, 'No spread check yet: enter ARV and Repairs.');
  check('missing ARV and the Manual amount', page(null, 41000, MANUAL_EMPTY).text, 'No spread check yet: enter ARV and the Manual assignment amount.');
  check('missing Repairs and the Manual amount', page(315000, null, MANUAL_EMPTY).text, 'No spread check yet: enter Repairs and the Manual assignment amount.');
  check('missing all three', page(null, null, MANUAL_EMPTY).text, 'No spread check yet: enter ARV, Repairs and the Manual assignment amount.');
  check('a Manual amount of $0 is an amount: not reported missing; the check proceeds to Test Price',
    n(page(315000, 41000, { mode: 'manual', amount: 0 })), ['neutral', 'No spread check yet: enter a Test Price.']);
  check('a Manual amount of $0 with a Test Price is checked like any other amount', page(315000, 41000, { mode: 'manual', amount: 0 }, 150000).kind !== 'neutral', true);
  check('Repairs of $0 is a value: only the Manual amount is missing', page(315000, 0, MANUAL_EMPTY).text, 'No spread check yet: enter the Manual assignment amount.');
  check('Standard and 25% modes never mention a Manual amount', [page(null, null, { mode: 'standard' }).text, page(null, null, { mode: 'profit_share' }).text].some((t) => /Manual/.test(t)), false);
  check('an engine gap this page cannot name gets a generic statement, never a wrong name',
    buildSpreadStatus(computeBoard8Economics({ status: 'unresolved', missing: ['arv', 'sellingCostPct'] }), null, null, 'standard').text,
    "No spread check yet: Max can't be calculated from the current inputs.");
  check('an unresolved assignment outside Manual is not called the Manual amount',
    buildSpreadStatus(computeBoard8Economics({ status: 'unresolved', missing: ['assignmentMode'] }), null, null, 'standard').text,
    "No spread check yet: Max can't be calculated from the current inputs.");
}

  // Walkthrough 2 figures through the shared engine (ARV 639,863, repairs 20,000).
  const wt2 = (testPrice) => {
    const result = computeUnderwriting(underwritingInputs({ arv: D(639863), repairs: D(20000) }));
    const b8 = computeBoard8Economics(result);
    return buildSpreadStatus(b8, computeExpectedSpread({ endBuyerMaxPrice: b8.endBuyerMaxPrice, referenceKind: 'test_price', referencePrice: testPrice }), { mode: 'standard', requiredSpread: result.figures.assignmentSpread });
  };
  check('Walkthrough 2 at 430,000 is amber', wt2(430000).kind, 'short');
  check('Walkthrough 2 at 440,000 is red', wt2(440000).kind, 'negative');

  // Exact classification, shared display rounding. Synthetic B8-03-shaped
  // objects pin the exact spread so each sub-dollar edge is tested directly.
  const b8With = (minimum) => ({ status: 'calculated', endBuyerMaxPrice: 0, requiredBuyerProfit: 0, maxSupportedOffer: 0, standardMinimumAssignmentSpread: minimum, standardMinimumLevel: 'iaos_starter', target: { status: 'unavailable', reason: 'n/a' } });
  const spreadOf = (spread) => ({ status: 'calculated', referenceKind: 'test_price', referencePrice: 0, endBuyerMaxPrice: 0, expectedSpread: spread });
  const exact = (spread, minimum = 5000) => buildSpreadStatus(b8With(minimum), spreadOf(spread), { mode: 'standard', requiredSpread: minimum });
  const cell = (spread) => buildDealCalculatorBarCells({ arv: null, repairs: null, testPrice: null, board8: null, expectedSpread: spreadOf(spread) }).find((c) => c.key === 'spread').value.text;

  check('-0.5: red, never amber', exact(-0.5).kind, 'negative');
  check('-0.5: cell shows -$1 (halves away from zero)', cell(-0.5), '-$1');
  check('-0.4: a negative fraction stays red', exact(-0.4).kind, 'negative');
  check('-0.4: cell shows $0, never -$0', cell(-0.4), '$0');
  check('-0.4: text says less than $1 above', exact(-0.4).text, "Negative spread: this Test Price is less than $1 above the end buyer's maximum price, so there is no assignment spread. Required: the $5,000 standard minimum.");
  check('-6,352.50: cell and text agree on $6,353', [cell(-6352.5), exact(-6352.5).text.indexOf('$6,353 above') >= 0], ['-$6,353', true]);
  check('4,999.50 displays $5,000 but is amber', [cell(4999.5), exact(4999.5).kind], ['$5,000', 'short']);
  check('4,999.50: sub-dollar shortfall reads "Less than $1 below"', exact(4999.5).text, 'Less than $1 below the $5,000 standard minimum.');
  check('4,999.99: one cent short is amber', exact(4999.99).kind, 'short');
  check('4,999.00: exactly $1 short shows the amount', exact(4999).text, '$1 short of the $5,000 standard minimum.');
  check('5,000.00 exactly is green', exact(5000).kind, 'meets');
  check('5,000.50: green with no sub-dollar margin amount', exact(5000.5).text, 'Meets the $5,000 standard minimum.' + NOTE);
  check('fractional minimum compared exactly', exact(5000.25, 5000.5).kind, 'short');
  check('0 exactly is amber, not red', exact(0).kind, 'short');
  check('formatWholeDollars never shows -$0', [formatWholeDollars(-0), formatWholeDollars(-0.49), formatWholeDollars(0.5), formatWholeDollars(169550.5)], ['$0', '$0', '$1', '$169,551']);
}

// ============================================================
// Structural proof: this module consumes B8-03, never recomputes it. No
// `computeUnderwriting` call, no import of compute.ts, no bare
// max(...0.25...) or endBuyerMaxPrice-minus-arithmetic duplicated here.
// ============================================================
{
  const src = fs.readFileSync(path.join(LIB, 'deal-calculator-bar.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./underwriting/compute"') === -1 && src.indexOf("'./underwriting/compute'") === -1, true);
  check('source does not call computeUnderwriting', src.indexOf('computeUnderwriting') === -1, true);
  check('source does not reimplement the 25%/$5,000 formula', src.indexOf('0.25') === -1 && src.indexOf('Math.max') === -1, true);
  check('source contains no network/GHL surface', ['fetch(', 'ghl.', 'PROXY', 'customFields'].every((t) => src.indexOf(t) === -1), true);
}

cleanup();

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
