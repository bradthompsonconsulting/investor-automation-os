/**
 * Seller Call Workspace -- Offer Readiness input assembly test runner.
 * B8-07 / INV-50.
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
const FLOOR = 16;
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

// ============================================================
// repairsCondition: SUPPORTED when an approved total is on file, UNKNOWN
// otherwise -- a real signal, not a guess.
// ============================================================
{
  const withRepairs = buildOfferReadinessInputs({ known: { arv: null, repairs: 41000, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  check('approved repairs on file -> repairsCondition SUPPORTED', withRepairs.repairsCondition, 'SUPPORTED');

  const withoutRepairs = buildOfferReadinessInputs({ known: { arv: null, repairs: null, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  check('no repairs on file -> repairsCondition UNKNOWN', withoutRepairs.repairsCondition, 'UNKNOWN');

  const zeroRepairs = buildOfferReadinessInputs({ known: { arv: null, repairs: 0, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  check('an approved $0 repairs total is still SUPPORTED (a real approved value, not absence)', zeroRepairs.repairsCondition, 'SUPPORTED');
}

// ============================================================
// arv: ALWAYS null -- never fabricated from a raw dollar amount, even
// when one is present. This is the core "do not manufacture ARV
// evidence" proof.
// ============================================================
{
  const withArv = buildOfferReadinessInputs({ known: { arv: 250000, repairs: null, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  check('ARV dollar amount present -> arv category input still null (no fabricated evidence state)', withArv.arv, null);

  const withoutArv = buildOfferReadinessInputs({ known: { arv: null, repairs: null, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  check('no ARV on file -> arv category input null', withoutArv.arv, null);
}

// ============================================================
// The other three categories stay UNKNOWN, unchanged -- out of this
// issue's scope.
// ============================================================
{
  const inputs = buildOfferReadinessInputs({ known: { arv: 250000, repairs: 41000, askingPrice: 260000 }, dealEconomics: GOLDEN_ECONOMICS });
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
  const inputs = buildOfferReadinessInputs({ known: { arv: null, repairs: null, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  check('dealEconomics object is passed through unchanged (same reference-equal shape)', inputs.dealEconomics, GOLDEN_ECONOMICS);
}

// ============================================================
// End-to-end: the assembled inputs actually change Offer Readiness's
// deal_economics-adjacent behavior correctly through computeOfferReadiness
// -- proves the wiring, not just the shape.
// ============================================================
{
  const inputsWithRepairs = buildOfferReadinessInputs({ known: { arv: null, repairs: 41000, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  const readinessWithRepairs = computeOfferReadiness(inputsWithRepairs);
  check('repairs approved -> readiness.categories.repairs_condition is SUPPORTED end-to-end', readinessWithRepairs.categories.repairs_condition, 'SUPPORTED');

  const inputsNoRepairs = buildOfferReadinessInputs({ known: { arv: null, repairs: null, askingPrice: null }, dealEconomics: GOLDEN_ECONOMICS });
  const readinessNoRepairs = computeOfferReadiness(inputsNoRepairs);
  check('repairs not approved -> readiness.categories.repairs_condition is UNKNOWN end-to-end', readinessNoRepairs.categories.repairs_condition, 'UNKNOWN');
}

// ============================================================
// Structural proof: no second economics/underwriting engine.
// ============================================================
{
  const src = fs.readFileSync(path.join(LIB, 'seller-call-readiness-inputs.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./underwriting/compute"') === -1, true);
  check('source does not call computeUnderwriting', src.indexOf('computeUnderwriting') === -1, true);
  check('source does not call computeBoard8Economics', src.indexOf('computeBoard8Economics') === -1, true);
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
