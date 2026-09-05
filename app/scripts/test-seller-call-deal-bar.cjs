/**
 * Seller Call Workspace deal bar -- test runner. B8-05 / INV-48.
 *
 * Compiles the pure deal-bar formatter and its B8-03 dependency to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no React, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-deal-bar-test');
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
  path.join(UW, 'compute.ts'),
  path.join(UW, 'board8-economics.ts'),
  path.join(LIB, 'arv-reconciliation.ts'),
  path.join(LIB, 'comp-classification.ts'),
  path.join(LIB, 'propstream-comp-csv.ts'),
  path.join(LIB, 'seller-call-deal-bar.ts'),
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
const dealBarPath = path.join(TMP, 'seller-call-deal-bar.js');
for (const p of [computePath, board8Path, dealBarPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeUnderwriting } = require(computePath);
const { computeBoard8Economics, computeExpectedSpread } = require(board8Path);
const { buildDealBarCells, DEAL_BAR_LABELS } = require(dealBarPath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 30;
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
  const cells = buildDealBarCells({ arv: 315000, repairs: 41000, board8: GOLDEN_ECONOMICS, expectedSpread: null });
  check('exactly seven cells', cells.length, 7);
  check('cell keys in exact order', cells.map((c) => c.key), ['arv', 'repairs', 'seller_position', 'current_offer', 'target', 'max', 'spread']);
  check('cell labels in exact order', cells.map((c) => c.label), DEAL_BAR_LABELS.slice());
  check('DEAL_BAR_LABELS matches the required sequence', DEAL_BAR_LABELS.slice(), ['ARV', 'Repairs', 'Seller Position', 'Current Offer', 'Target', 'Max', 'Spread']);
}

// ============================================================
// ARV / Repairs -- honest known-vs-waiting.
// ============================================================
{
  const known = buildDealBarCells({ arv: 315000, repairs: 41000, board8: null, expectedSpread: null });
  check('ARV known renders as a value', known[0].value.kind, 'value');
  check('ARV known renders the exact formatted amount', known[0].value.text, '$315,000');
  check('Repairs known renders as a value', known[1].value.kind, 'value');
  check('Repairs known renders the exact formatted amount', known[1].value.text, '$41,000');

  const missing = buildDealBarCells({ arv: null, repairs: null, board8: null, expectedSpread: null });
  check('ARV missing renders as waiting, never a fabricated number', missing[0].value.kind, 'waiting');
  check('Repairs missing renders as waiting, never a fabricated number', missing[1].value.kind, 'waiting');
}

// ============================================================
// Seller Position / Current Offer -- ALWAYS waiting, regardless of every
// other input, because no carrier is authorized. This is the core proof
// that this module never invents a value for either.
// ============================================================
{
  const withEverythingSupported = buildDealBarCells({
    arv: 315000, repairs: 41000, board8: GOLDEN_ECONOMICS,
    expectedSpread: computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'current_offer', referencePrice: 150000 }),
  });
  const sellerPosition = withEverythingSupported.find((c) => c.key === 'seller_position');
  const currentOffer = withEverythingSupported.find((c) => c.key === 'current_offer');
  check('Seller Position always waits, even with full economics available', sellerPosition.value.kind, 'waiting');
  check('Seller Position waiting text matches rail.ts verbatim', sellerPosition.value.text, 'WAITING on negotiation carrier');
  check('Current Offer always waits, even with full economics available', currentOffer.value.kind, 'waiting');
  check('Current Offer waiting text matches rail.ts verbatim', currentOffer.value.text, 'WAITING on negotiation semantics / carrier contract');
}

// ============================================================
// Target / Max -- read from B8-03's Board8Economics only. Golden fixture
// values cross-checked against test-board8-economics.cjs's own golden
// path assertions (endBuyerMaxPrice ~181363, target ~169550.5, max ~176363).
// ============================================================
{
  check('setup: golden economics is calculated', GOLDEN_ECONOMICS.status, 'calculated');
  const cells = buildDealBarCells({ arv: 315000, repairs: 41000, board8: GOLDEN_ECONOMICS, expectedSpread: null });
  const target = cells.find((c) => c.key === 'target');
  const max = cells.find((c) => c.key === 'max');
  check('Target renders as a value from B8-03 output', target.value.kind, 'value');
  check('Target renders the exact B8-03 figure', target.value.text, '$169,551');
  check('Max renders as a value from B8-03 output', max.value.kind, 'value');
  check('Max renders the exact B8-03 figure', max.value.text, '$176,363');

  const unavailableCells = buildDealBarCells({ arv: null, repairs: null, board8: UNAVAILABLE_ECONOMICS, expectedSpread: null });
  check('Target waits honestly when B8-03 is unavailable', unavailableCells.find((c) => c.key === 'target').value.kind, 'waiting');
  check('Max waits honestly when B8-03 is unavailable', unavailableCells.find((c) => c.key === 'max').value.kind, 'waiting');
}

// ============================================================
// Spread -- Expected Spread @ Current Offer. Calculated only when B8-03's
// ExpectedSpread is itself calculated; honest waiting otherwise, naming
// the reason (which always references Current Offer when that is why).
// ============================================================
{
  const calculatedSpread = computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'current_offer', referencePrice: 150000 });
  const cellsCalculated = buildDealBarCells({ arv: 315000, repairs: 41000, board8: GOLDEN_ECONOMICS, expectedSpread: calculatedSpread });
  check('Spread renders as a value when B8-03 Expected Spread calculated', cellsCalculated.find((c) => c.key === 'spread').value.kind, 'value');
  check('Spread renders the exact B8-03 figure', cellsCalculated.find((c) => c.key === 'spread').value.text, '$31,363');

  const unavailableSpread = computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'current_offer', referencePrice: null });
  const cellsUnavailable = buildDealBarCells({ arv: 315000, repairs: 41000, board8: GOLDEN_ECONOMICS, expectedSpread: unavailableSpread });
  const spreadCell = cellsUnavailable.find((c) => c.key === 'spread');
  check('Spread waits honestly with no Current Offer', spreadCell.value.kind, 'waiting');
  check('Spread reason names Current Offer, matching B8-03s own reason text', spreadCell.value.text.toLowerCase().indexOf('current offer') >= 0, true);

  const noSpreadComputedYet = buildDealBarCells({ arv: 315000, repairs: 41000, board8: GOLDEN_ECONOMICS, expectedSpread: null });
  check('Spread waits before any ExpectedSpread has been computed at all', noSpreadComputedYet.find((c) => c.key === 'spread').value.kind, 'waiting');
}

// ============================================================
// Structural proof: this module consumes B8-03, never recomputes it.
// No `computeUnderwriting` call, no import of compute.ts, and no bare
// max(...0.25...) or endBuyerMaxPrice-minus-arithmetic duplicated here.
// ============================================================
{
  const src = fs.readFileSync(path.join(LIB, 'seller-call-deal-bar.ts'), 'utf8');
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
