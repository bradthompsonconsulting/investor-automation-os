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
const FLOOR = 36;
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
    propertyIdentityConfirmed: false,
    transactionAssumptionsRecorded: false,
    sellerPricePositionRecorded: false,
    humanAction: { kind: 'none' },
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
// B8-13 / INV-68: propertyIdentity / transactionAssumptions /
// sellerPricePosition are each a plain boolean the caller has already
// derived from a durable carrier -- SUPPORTED once true, UNKNOWN
// otherwise, no PRELIMINARY tier, same binary shape as repairsCondition.
// ============================================================
{
  const allFalse = build({ arv: 250000, repairs: 41000, askingPrice: 260000 }, { repairsApprovalProven: true, arvEvidenceState: 'HIGH' });
  check('propertyIdentityConfirmed false -> propertyIdentity UNKNOWN', allFalse.propertyIdentity, 'UNKNOWN');
  check('transactionAssumptionsRecorded false -> transactionAssumptions UNKNOWN', allFalse.transactionAssumptions, 'UNKNOWN');
  check('sellerPricePositionRecorded false -> sellerPricePosition UNKNOWN', allFalse.sellerPricePosition, 'UNKNOWN');
  check('materialUnknowns is empty (never invented)', allFalse.materialUnknowns, []);
  check('humanAction defaults to none when caller supplies none', allFalse.humanAction, { kind: 'none' });

  const allTrue = build({ arv: 250000, repairs: 41000, askingPrice: 260000 }, {
    propertyIdentityConfirmed: true, transactionAssumptionsRecorded: true, sellerPricePositionRecorded: true,
  });
  check('propertyIdentityConfirmed true -> propertyIdentity SUPPORTED', allTrue.propertyIdentity, 'SUPPORTED');
  check('transactionAssumptionsRecorded true -> transactionAssumptions SUPPORTED', allTrue.transactionAssumptions, 'SUPPORTED');
  check('sellerPricePositionRecorded true -> sellerPricePosition SUPPORTED', allTrue.sellerPricePosition, 'SUPPORTED');

  const approved = { kind: 'approved', at: '2026-09-08T00:00:00.000Z', operator: null, reason: 'looks fine' };
  const withApproved = build({ arv: null, repairs: null, askingPrice: null }, { humanAction: approved });
  check('humanAction (approved) passes through verbatim, never recomputed', withApproved.humanAction, approved);

  const overridden = { kind: 'overridden', at: '2026-09-08T00:00:00.000Z', operator: null, reason: 'proceeding anyway' };
  const withOverridden = build({ arv: null, repairs: null, askingPrice: null }, { humanAction: overridden });
  check('humanAction (overridden) passes through verbatim, never recomputed', withOverridden.humanAction, overridden);
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

  // B8-13 / INV-68 end-to-end: all six categories genuinely SUPPORTED (no
  // override involved) actually reaches OFFER_READY through the unchanged
  // computeOfferReadiness aggregation rule -- proves the new carriers wire
  // all the way through, not just that the three booleans map correctly.
  const allSix = build({ arv: 250000, repairs: 41000, askingPrice: 260000 }, {
    repairsApprovalProven: true, arvEvidenceState: 'HIGH',
    propertyIdentityConfirmed: true, transactionAssumptionsRecorded: true, sellerPricePositionRecorded: true,
  });
  const readinessAllSix = computeOfferReadiness(allSix);
  check('all six categories SUPPORTED -> effectiveStatus OFFER_READY end-to-end, humanAction none', readinessAllSix.effectiveStatus, 'OFFER_READY');
  check('genuinely OFFER_READY -> zero reasons', readinessAllSix.reasons, []);

  // A real OVERRIDDEN human action, read back from the new carrier and
  // passed through, elevates an objectively NOT_READY status -- proves the
  // carrier's `humanAction` actually reaches the unchanged override rule.
  const notReadyButOverridden = build({ arv: null, repairs: null, askingPrice: null }, {
    humanAction: { kind: 'overridden', at: '2026-09-08T00:00:00.000Z', operator: null, reason: 'proceeding anyway' },
  });
  const readinessOverridden = computeOfferReadiness(notReadyButOverridden);
  check('NOT_READY evidence + overridden humanAction -> effectiveStatus OFFER_READY end-to-end', readinessOverridden.effectiveStatus, 'OFFER_READY');
  check('...but raw status still reports NOT_READY (override never hides the underlying evidence)', readinessOverridden.status, 'NOT_READY');
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
