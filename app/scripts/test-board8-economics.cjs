/**
 * Board #8 shared deal/offer engine -- test runner. B8-03 / INV-46.
 *
 * Compiles board8-economics.ts and its dependencies to a temp directory,
 * loads the emitted JavaScript, and runs deterministic table-driven cases.
 * No GHL, no network, no fixture. Exits nonzero on any failure.
 *
 * app/package.json sets "type": "module", so the temp directory is given
 * its own package.json declaring commonjs. Without it, Node reads the
 * emitted .js as ESM and require() fails before any test runs.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-board8-economics-test');
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

// SOURCES spans two directories (underwriting/ and its parent lib/), so
// tsc's outDir mirrors that structure rather than emitting flat files --
// OBSERVED by inspecting .tmp-inspect during development. compute.ts and
// board8-economics.ts land under an `underwriting` subdirectory; the
// arv-reconciliation family lands at TMP's root.
const computePath = path.join(TMP, 'underwriting', 'compute.js');
const board8Path = path.join(TMP, 'underwriting', 'board8-economics.js');
for (const p of [computePath, board8Path]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeUnderwriting } = require(computePath);
const {
  computeBoard8Economics,
  computeExpectedSpread,
  mapArvEvidenceToBoard8,
} = require(board8Path);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 43;
let failures = 0;
let checks = 0;

function check(name, actual, expected, tol) {
  checks++;
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) <= (tol === undefined ? 1e-6 : tol)
    : JSON.stringify(actual) === JSON.stringify(expected);
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
const U = (reason) => ({ kind: 'unresolved', reason: reason || 'absent' });

// Same PB-D56 section IV starter policy fixture test-underwriting-core.cjs
// uses, so figures compared across the two harnesses are the same fixture.
function inputs(over) {
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

// ============================================================
// 1. Golden path: verified numbers, both Target and Max present.
// endBuyerMaxPrice ~181363 (test-underwriting-core.cjs case 1).
// requiredBuyerProfit = 315000 * 0.15 = 47250.
// 25% of 47250 = 11812.5, which exceeds the 5000 minimum, so
// targetWholesaleProfit = 11812.5 (not floored).
// ============================================================
{
  const u = computeUnderwriting(inputs());
  const b = computeBoard8Economics(u);
  check('golden status', b.status, 'calculated');
  check('golden endBuyerMaxPrice', b.endBuyerMaxPrice, 181363, 1);
  check('golden requiredBuyerProfit', b.requiredBuyerProfit, 47250, 0.5);
  check('golden maxSupportedOffer', b.maxSupportedOffer, 176363, 1);
  check('golden target status', b.target.status, 'calculated');
  check('golden targetWholesaleProfit', b.target.targetWholesaleProfit, 11812.5, 0.001);
  check('golden targetAcquisitionPrice', b.target.targetAcquisitionPrice, 169550.5, 1);
  check('golden buyerProfitSharePctLevel', b.target.buyerProfitSharePctLevel, 'iaos_starter');
}

// ============================================================
// 2. Validation item 2: Target uses max(25% of Required Buyer Profit, $5,000).
// Low ARV floors to the minimum: ARV 100000 -> repairs kept at 41000 is
// too large relative to ARV for a realistic deal, so use repairs 10000.
// requiredBuyerProfit = 100000 * 0.15 = 15000; 25% = 3750 < 5000 -> floored.
// ============================================================
{
  const u = computeUnderwriting(inputs({ arv: D(100000), repairs: D(10000) }));
  const b = computeBoard8Economics(u);
  check('low-ARV requiredBuyerProfit', b.requiredBuyerProfit, 15000, 0.5);
  check('low-ARV targetWholesaleProfit floors at minimum', b.target.targetWholesaleProfit, 5000);
}

// ============================================================
// 3. Validation item 3: Max uses the existing $5,000 minimum, NEVER the
// deal's active assignment spread -- proven across all three modes with
// the SAME ARV/repairs/policy, so endBuyerMaxPrice is identical in all
// three (assignment mode does not affect it) while assignmentSpread
// itself differs sharply.
// ============================================================
{
  const standard = computeUnderwriting(inputs({ assignment: { kind: 'standard' } }));
  const profitShare = computeUnderwriting(inputs({ assignment: { kind: 'profit_share' } }));
  const manual = computeUnderwriting(inputs({ assignment: { kind: 'manual', amount: 20000 } }));

  check('endBuyerMaxPrice identical across assignment modes (standard vs profit_share)',
    standard.figures.endBuyerMaxPrice, profitShare.figures.endBuyerMaxPrice, 1e-6);
  check('endBuyerMaxPrice identical across assignment modes (standard vs manual)',
    standard.figures.endBuyerMaxPrice, manual.figures.endBuyerMaxPrice, 1e-6);

  check('standard mode active assignmentSpread', standard.figures.assignmentSpread, 5000);
  check('profit_share mode active assignmentSpread differs from minimum', profitShare.figures.assignmentSpread, 11812.5, 0.001);
  check('manual mode active assignmentSpread differs from minimum', manual.figures.assignmentSpread, 20000);

  const bStandard = computeBoard8Economics(standard);
  const bProfitShare = computeBoard8Economics(profitShare);
  const bManual = computeBoard8Economics(manual);

  check('Max Supported Offer identical across assignment modes (standard vs profit_share)',
    bStandard.maxSupportedOffer, bProfitShare.maxSupportedOffer, 1e-6);
  check('Max Supported Offer identical across assignment modes (standard vs manual)',
    bStandard.maxSupportedOffer, bManual.maxSupportedOffer, 1e-6);
  check('Max Supported Offer uses the $5,000 minimum, not the active spread',
    bProfitShare.maxSupportedOffer, bProfitShare.endBuyerMaxPrice - 5000, 1e-6);
}

// ============================================================
// 4. Validation item 4: Target never exceeds Max -- across every fixture
// used elsewhere in this file, checked structurally rather than by one
// spot value.
// ============================================================
{
  const fixtures = [
    inputs(),
    inputs({ arv: D(100000), repairs: D(10000) }),
    inputs({ assignment: { kind: 'profit_share' } }),
    inputs({ assignment: { kind: 'manual', amount: 20000 } }),
    inputs({ arv: D(500000), repairs: D(60000) }),
  ];
  let allWithinBound = true;
  for (const inp of fixtures) {
    const b = computeBoard8Economics(computeUnderwriting(inp));
    if (b.status === 'calculated' && b.target.status === 'calculated') {
      if (b.target.targetAcquisitionPrice > b.maxSupportedOffer + 1e-6) allWithinBound = false;
    }
  }
  check('Target never exceeds Max, across every fixture', allWithinBound, true);
}

// ============================================================
// 5. Validation item 5: Target equals Max when 25% of Required Buyer
// Profit is $5,000 or less (the low-ARV fixture above floors exactly).
// ============================================================
{
  const u = computeUnderwriting(inputs({ arv: D(100000), repairs: D(10000) }));
  const b = computeBoard8Economics(u);
  check('Target equals Max at the floor', b.target.targetAcquisitionPrice, b.maxSupportedOffer, 1e-9);
}

// Exact boundary: 25% of Required Buyer Profit === $5,000 precisely.
// Required Buyer Profit = 5000 / 0.25 = 20000 = ARV * 0.15 -> ARV = 133333.33...
{
  const arv = 5000 / 0.25 / 0.15;
  const u = computeUnderwriting(inputs({ arv: D(arv), repairs: D(10000) }));
  const b = computeBoard8Economics(u);
  check('boundary requiredBuyerProfit is exactly 20000', b.requiredBuyerProfit, 20000, 1e-6);
  check('boundary targetWholesaleProfit is exactly the minimum', b.target.targetWholesaleProfit, 5000, 1e-6);
  check('boundary Target equals Max exactly at the 25%=minimum crossover', b.target.targetAcquisitionPrice, b.maxSupportedOffer, 1e-6);
}

// ============================================================
// 6. Validation item 6: Expected Spread changes only with its explicit
// reference price and the governing economics (endBuyerMaxPrice) -- not
// with assignment mode, and not with referenceKind's label alone.
// ============================================================
{
  const u = computeUnderwriting(inputs());
  const ebm = u.figures.endBuyerMaxPrice;

  const s1 = computeExpectedSpread({ endBuyerMaxPrice: ebm, referenceKind: 'current_offer', referencePrice: 150000 });
  const s2 = computeExpectedSpread({ endBuyerMaxPrice: ebm, referenceKind: 'current_offer', referencePrice: 160000 });
  check('spread changes by exactly the reference-price delta', s1.expectedSpread - s2.expectedSpread, 10000, 1e-6);

  const s3 = computeExpectedSpread({ endBuyerMaxPrice: ebm + 5000, referenceKind: 'current_offer', referencePrice: 150000 });
  check('spread changes by exactly the endBuyerMaxPrice delta', s3.expectedSpread - s1.expectedSpread, 5000, 1e-6);

  // Same ARV/repairs/policy, three different assignment modes -- proven
  // above (case 3) to share one endBuyerMaxPrice. Expected Spread at the
  // SAME reference price must therefore be identical across all three.
  const standard = computeUnderwriting(inputs({ assignment: { kind: 'standard' } }));
  const profitShare = computeUnderwriting(inputs({ assignment: { kind: 'profit_share' } }));
  const manual = computeUnderwriting(inputs({ assignment: { kind: 'manual', amount: 20000 } }));
  const spreadStandard = computeExpectedSpread({ endBuyerMaxPrice: standard.figures.endBuyerMaxPrice, referenceKind: 'current_offer', referencePrice: 150000 });
  const spreadProfitShare = computeExpectedSpread({ endBuyerMaxPrice: profitShare.figures.endBuyerMaxPrice, referenceKind: 'current_offer', referencePrice: 150000 });
  const spreadManual = computeExpectedSpread({ endBuyerMaxPrice: manual.figures.endBuyerMaxPrice, referenceKind: 'current_offer', referencePrice: 150000 });
  check('Expected Spread unaffected by assignment mode (standard vs profit_share)', spreadStandard.expectedSpread, spreadProfitShare.expectedSpread, 1e-6);
  check('Expected Spread unaffected by assignment mode (standard vs manual)', spreadStandard.expectedSpread, spreadManual.expectedSpread, 1e-6);

  // referenceKind changes the label, never the number, for the same price.
  const sCurrentOffer = computeExpectedSpread({ endBuyerMaxPrice: ebm, referenceKind: 'current_offer', referencePrice: 150000 });
  const sTestPrice = computeExpectedSpread({ endBuyerMaxPrice: ebm, referenceKind: 'test_price', referencePrice: 150000 });
  check('Expected Spread number identical regardless of referenceKind label', sCurrentOffer.expectedSpread, sTestPrice.expectedSpread, 1e-9);
  check('referenceKind is carried through, not discarded (current_offer)', sCurrentOffer.referenceKind, 'current_offer');
  check('referenceKind is carried through, not discarded (test_price)', sTestPrice.referenceKind, 'test_price');
}

// ============================================================
// 7. Validation item 1: identical inputs and assumptions must produce
// identical authoritative economics regardless of caller/interface.
// Two independently constructed input objects, standing in for two
// different UI callers (Seller Call vs standalone Deal Calculator),
// deep-equal end to end.
// ============================================================
{
  const callerA = inputs();
  const callerB = JSON.parse(JSON.stringify(inputs())); // simulates a second caller building its own object
  const rA = computeBoard8Economics(computeUnderwriting(callerA));
  const rB = computeBoard8Economics(computeUnderwriting(callerB));
  check('identical inputs across two simulated callers produce identical Board8Economics', rA, rB);

  const spreadA = computeExpectedSpread({ endBuyerMaxPrice: rA.endBuyerMaxPrice, referenceKind: 'current_offer', referencePrice: 150000 });
  const spreadB = computeExpectedSpread({ endBuyerMaxPrice: rB.endBuyerMaxPrice, referenceKind: 'test_price', referencePrice: 150000 });
  check('identical economics across callers produce identical Expected Spread number', spreadA.expectedSpread, spreadB.expectedSpread, 1e-9);
}

// ============================================================
// 8. Validation item 7: missing or stale/unapproved inputs cannot
// silently become supported/actionable values.
// ============================================================
{
  // 8a. Base underwriting unresolved -> Board8Economics is "unavailable",
  // never "calculated", and names what is missing.
  const missingArv = computeUnderwriting(inputs({ arv: U() }));
  const b = computeBoard8Economics(missingArv);
  check('unresolved base -> Board8Economics unavailable', b.status, 'unavailable');
  check('unresolved base names the missing field', b.missing.indexOf('arv') >= 0, true);

  // 8b. The one synthetic case where buyerProfitSharePct fails to
  // resolve: Max stays available (does not need it); Target does not.
  const u = computeUnderwriting(inputs({ assignment: { kind: 'standard' }, profitSharePct: U() }));
  const b2 = computeBoard8Economics(u);
  check('Max stays calculated when only Target\'s input is missing', b2.status, 'calculated');
  check('Target is unavailable, never a silent guess', b2.target.status, 'unavailable');

  // 8c. No reference price -> Expected Spread is unavailable, never a
  // silent zero or a spread computed against a stand-in value.
  const noRef = computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'current_offer', referencePrice: null });
  check('missing Current Offer -> Expected Spread unavailable', noRef.status, 'unavailable');
  const noRef2 = computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'test_price', referencePrice: null });
  check('missing Test Price -> Expected Spread unavailable', noRef2.status, 'unavailable');

  // 8d. Non-finite inputs throw rather than silently propagating NaN.
  let threw = false;
  try { computeExpectedSpread({ endBuyerMaxPrice: 181363, referenceKind: 'current_offer', referencePrice: NaN }); }
  catch (e) { threw = e instanceof RangeError; }
  check('non-finite referencePrice throws rather than propagating NaN', threw, true);
}

// ============================================================
// 9. ARV evidence mapping -- HIGH/MODERATE -> SUPPORTED, LOW ->
// PRELIMINARY, INSUFFICIENT -> UNKNOWN. Brad's 2026-09-05 amendment.
// ============================================================
{
  check('ARV HIGH maps to SUPPORTED', mapArvEvidenceToBoard8('HIGH'), 'SUPPORTED');
  check('ARV MODERATE maps to SUPPORTED', mapArvEvidenceToBoard8('MODERATE'), 'SUPPORTED');
  check('ARV LOW maps to PRELIMINARY', mapArvEvidenceToBoard8('LOW'), 'PRELIMINARY');
  check('ARV INSUFFICIENT maps to UNKNOWN', mapArvEvidenceToBoard8('INSUFFICIENT'), 'UNKNOWN');
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
