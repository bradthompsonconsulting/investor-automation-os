/**
 * Seller Call Workspace -- Offer Readiness input assembly test runner.
 * B8-07 / INV-50, including the Jess Gate correction (2026-09-05) that
 * added `repairsApprovalProven` and `arvEvidenceState`.
 *
 * Compiles the pure input-assembly module and its dependencies to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-readiness-inputs-test');
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
  path.join(UW, 'offer-readiness.ts'),
  path.join(LIB, 'arv-reconciliation.ts'),
  path.join(LIB, 'comp-classification.ts'),
  path.join(LIB, 'propstream-comp-csv.ts'),
  path.join(LIB, 'seller-call-readiness-inputs.ts'),
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
const readinessPath = path.join(TMP, 'underwriting', 'offer-readiness.js');
const inputsPath = path.join(TMP, 'seller-call-readiness-inputs.js');
for (const p of [computePath, board8Path, readinessPath, inputsPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeUnderwriting } = require(computePath);
const { computeBoard8Economics } = require(board8Path);
const { computeOfferReadiness } = require(readinessPath);
const { buildOfferReadinessInputs } = require(inputsPath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 27;
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

const GOLDEN_ECONOMICS = computeBoard8Economics(computeUnderwriting(underwritingInputs()));

function build(known, overrides) {
  return buildOfferReadinessInputs(Object.assign({
    known,
    dealEconomics: GOLDEN_ECONOMICS,
    repairsApprovalProven: false,
    arvEvidenceState: null,
  }, overrides || {}));
}

// ============================================================
// repairsCondition: SUPPORTED only when BOTH an approved-looking total is
// on file AND the caller proves it actually passed the approval gate.
// This is the Jess Gate correction's core repairs proof.
// ============================================================
{
  const proven = build({ arv: null, repairs: 41000, askingPrice: null }, { repairsApprovalProven: true });
  check('repairs on file + approval proven -> repairsCondition SUPPORTED', proven.repairsCondition, 'SUPPORTED');

  const unproven = build({ arv: null, repairs: 41000, askingPrice: null }, { repairsApprovalProven: false });
  check('repairs on file but approval NOT proven -> repairsCondition UNKNOWN (do not trust an unverified total)', unproven.repairsCondition, 'UNKNOWN');

  const noRepairs = build({ arv: null, repairs: null, askingPrice: null }, { repairsApprovalProven: true });
  check('no repairs on file, even if the flag claims proven -> repairsCondition UNKNOWN (nothing to approve)', noRepairs.repairsCondition, 'UNKNOWN');

  const zeroRepairsProven = build({ arv: null, repairs: 0, askingPrice: null }, { repairsApprovalProven: true });
  check('an approved $0 repairs total is still SUPPORTED when proven (a real approved value, not absence)', zeroRepairsProven.repairsCondition, 'SUPPORTED');

  const zeroRepairsUnproven = build({ arv: null, repairs: 0, askingPrice: null }, { repairsApprovalProven: false });
  check('an unproven $0 repairs total is UNKNOWN, same rule as any other unproven total', zeroRepairsUnproven.repairsCondition, 'UNKNOWN');
}

// ============================================================
// arv: passed through directly from arvEvidenceState -- Board #7's own
// classification, never derived from the dollar amount.
// ============================================================
{
  for (const state of ['HIGH', 'MODERATE', 'LOW', 'INSUFFICIENT']) {
    const inputs = build({ arv: 250000, repairs: null, askingPrice: null }, { arvEvidenceState: state });
    check('arvEvidenceState ' + state + ' passes through unchanged', inputs.arv, state);
  }

  const noEvidence = build({ arv: 250000, repairs: null, askingPrice: null }, { arvEvidenceState: null });
  check('ARV dollar amount present but no evidence state -> arv category input null (no fabricated evidence)', noEvidence.arv, null);

  const noArvAtAll = build({ arv: null, repairs: null, askingPrice: null }, { arvEvidenceState: null });
  check('no ARV on file -> arv category input null', noArvAtAll.arv, null);
}

// ============================================================
// The other three categories stay UNKNOWN, unchanged -- out of this
// issue's scope.
// ============================================================
{
  const inputs = build({ arv: 250000, repairs: 41000, askingPrice: 260000 }, { repairsApprovalProven: true, arvEvidenceState: 'HIGH' });
  check('propertyIdentity stays UNKNOWN (out of scope for this issue)', inputs.propertyIdentity, 'UNKNOWN');
  check('transactionAssumptions stays UNKNOWN (out of scope for this issue)', inputs.transactionAssumptions, 'UNKNOWN');
  check('sellerPricePosition stays UNKNOWN (out of scope for this issue)', inputs.sellerPricePosition, 'UNKNOWN');
  check('materialUnknowns is empty (never invented)', inputs.materialUnknowns, []);
  check('humanAction defaults to none (no approve/override control here)', inputs.humanAction, { kind: 'none' });
}

// ============================================================
// dealEconomics is consumed verbatim, never recomputed.
// ============================================================
{
  const inputs = build({ arv: null, repairs: null, askingPrice: null });
  check('dealEconomics object is passed through unchanged (same reference-equal shape)', inputs.dealEconomics, GOLDEN_ECONOMICS);
}

// ============================================================
// End-to-end: the assembled inputs actually change Offer Readiness's
// category outcomes correctly through computeOfferReadiness -- proves the
// wiring, not just the shape.
// ============================================================
{
  const inputsRepairsProven = build({ arv: null, repairs: 41000, askingPrice: null }, { repairsApprovalProven: true });
  const readinessRepairsProven = computeOfferReadiness(inputsRepairsProven);
  check('repairs approved (proven) -> readiness.categories.repairs_condition SUPPORTED end-to-end', readinessRepairsProven.categories.repairs_condition, 'SUPPORTED');

  const inputsRepairsUnproven = build({ arv: null, repairs: 41000, askingPrice: null }, { repairsApprovalProven: false });
  const readinessRepairsUnproven = computeOfferReadiness(inputsRepairsUnproven);
  check('repairs on file but unproven -> readiness.categories.repairs_condition UNKNOWN end-to-end', readinessRepairsUnproven.categories.repairs_condition, 'UNKNOWN');

  const inputsArvHigh = build({ arv: 250000, repairs: null, askingPrice: null }, { arvEvidenceState: 'HIGH' });
  const readinessArvHigh = computeOfferReadiness(inputsArvHigh);
  check('ARV evidence HIGH -> readiness.categories.arv SUPPORTED end-to-end', readinessArvHigh.categories.arv, 'SUPPORTED');

  const inputsArvLow = build({ arv: 250000, repairs: null, askingPrice: null }, { arvEvidenceState: 'LOW' });
  const readinessArvLow = computeOfferReadiness(inputsArvLow);
  check('ARV evidence LOW -> readiness.categories.arv PRELIMINARY end-to-end', readinessArvLow.categories.arv, 'PRELIMINARY');

  const inputsArvInsufficient = build({ arv: 250000, repairs: null, askingPrice: null }, { arvEvidenceState: 'INSUFFICIENT' });
  const readinessArvInsufficient = computeOfferReadiness(inputsArvInsufficient);
  check('ARV evidence INSUFFICIENT -> readiness.categories.arv UNKNOWN end-to-end', readinessArvInsufficient.categories.arv, 'UNKNOWN');

  const inputsNoArv = build({ arv: null, repairs: null, askingPrice: null }, { arvEvidenceState: null });
  const readinessNoArv = computeOfferReadiness(inputsNoArv);
  check('no ARV evidence at all -> readiness.categories.arv UNKNOWN end-to-end', readinessNoArv.categories.arv, 'UNKNOWN');
}

// ============================================================
// Structural proof: no second economics/underwriting engine, no second
// ARV evidence classifier.
// ============================================================
{
  const src = fs.readFileSync(path.join(LIB, 'seller-call-readiness-inputs.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./underwriting/compute"') === -1, true);
  check('source does not call computeUnderwriting', src.indexOf('computeUnderwriting') === -1, true);
  check('source does not call computeBoard8Economics', src.indexOf('computeBoard8Economics') === -1, true);
  check('source does not reimplement ARV evidence-state classification (imports the type only)', src.indexOf('function') === -1 || src.indexOf('baseEvidenceState') === -1, true);
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
