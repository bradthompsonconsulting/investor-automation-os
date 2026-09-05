/**
 * Underwriting calculation core -- test runner.
 *
 * Compiles the TypeScript core to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases. No GHL, no
 * network, no fixture. Exits nonzero on any failure.
 *
 * app/package.json sets "type": "module", so the temp directory is given
 * its own package.json declaring commonjs. Without it, Node reads the
 * emitted .js as ESM and require() fails before any test runs.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-underwriting-test');
const SRC = path.join(APP, 'src', 'lib', 'underwriting');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + path.join(SRC, 'types.ts') + '" "' + path.join(SRC, 'compute.ts') +
    '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const compiled = path.join(TMP, 'compute.js');
if (!fs.existsSync(compiled)) {
  console.error('ABORT: expected compiled output at ' + compiled);
  cleanup();
  process.exit(11);
}

const { computeUnderwriting, computeAcquisitionPosition, UnitsError } = require(compiled);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 63;
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

// PB-D56 section IV starter policy, in decimal fractions.
function starter(over) {
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

// ---- 1. Golden path: the zone 4 worked example.
{
  const r = computeUnderwriting(starter());
  check('golden status', r.status, 'resolved');
  check('golden baseBuyerCapacity', r.figures.baseBuyerCapacity, 190250, 0.5);
  check('golden financingFactor', r.figures.financingFactor, 0.049, 1e-9);
  check('golden endBuyerMaxPrice', r.figures.endBuyerMaxPrice, 181363, 1);
  check('golden assignmentSpread', r.figures.assignmentSpread, 5000);
  check('golden sellerMAO', r.figures.sellerMAO, 176363, 1);
  check('golden warnings', r.warnings.length, 0);
  check('golden breakdown rows', r.breakdown.length, 10);
}

// ---- 2. Units: 10% enters as 0.10 and yields $31,500 on $315,000.
{
  const r = computeUnderwriting(starter());
  const selling = r.breakdown.find(l => l.label === 'End-Buyer Selling Costs');
  check('units selling costs', selling.amount, -31500, 0.5);
}

// ---- 3. Units guard rejects human percentage units.
{
  let threw = false, msg = '';
  try { computeUnderwriting(starter({ sellingCostPct: V(10) })); }
  catch (e) { threw = e instanceof UnitsError; msg = e.message; }
  check('units guard throws on 10 where 0.10 expected', threw, true);
  check('units guard names the field', msg.indexOf('sellingCostPct') >= 0, true);
}

// ---- 4. Finite guard rejects NaN.
{
  let threw = false;
  try { computeUnderwriting(starter({ arv: D(NaN) })); }
  catch (e) { threw = e instanceof UnitsError; }
  check('finite guard throws on NaN arv', threw, true);
}

// ---- 5. Financing Off is a legitimate zero, not missing.
{
  const r = computeUnderwriting(starter({ financing: { kind: 'off', level: 'investor_policy' } }));
  check('financing off status', r.status, 'resolved');
  check('financing off k', r.figures.financingFactor, 0);
  check('financing off endBuyerMax equals capacity', r.figures.endBuyerMaxPrice, r.figures.baseBuyerCapacity, 1e-9);
  check('financing off provenance', r.provenance.financingEnabled, 'investor_policy');
  check('financing off ltv provenance null', r.provenance.financingLtv, null);
}

// ---- 6. Financing unresolved is not zero.
{
  const r = computeUnderwriting(starter({ financing: { kind: 'unresolved', reason: 'absent' } }));
  check('financing unresolved status', r.status, 'unresolved');
  check('financing unresolved names financing', r.missing.indexOf('financing') >= 0, true);
}

// ---- 7. Financing On with one missing term is unresolved.
{
  const r = computeUnderwriting(starter({
    financing: { kind: 'on', level: 'iaos_starter', ltv: U(), rate: V(0.12), points: V(0.02) }
  }));
  check('financing missing ltv status', r.status, 'unresolved');
  check('financing missing ltv names it', r.missing.indexOf('financing.ltv') >= 0, true);
}

// ---- 8. Manual at exactly the minimum: no warning.
{
  const r = computeUnderwriting(starter({ assignment: { kind: 'manual', amount: 5000 } }));
  check('manual at minimum status', r.status, 'resolved');
  check('manual at minimum spread', r.figures.assignmentSpread, 5000);
  check('manual at minimum no warning', r.warnings.length, 0);
}

// ---- 9. Manual one cent below the minimum: warns, does not block.
{
  const r = computeUnderwriting(starter({ assignment: { kind: 'manual', amount: 4999.99 } }));
  check('manual below minimum status', r.status, 'resolved');
  check('manual below minimum warns', r.warnings.length, 1);
  check('manual below minimum code', r.warnings[0].code, 'MANUAL_SPREAD_BELOW_STANDARD_MINIMUM');
  check('manual below minimum spread', r.warnings[0].spread, 4999.99);
  check('manual below minimum minimum', r.warnings[0].minimum, 5000);
}

// ---- 10. Profit share floors at the standard minimum.
// Required profit = 315000 * 0.15 = 47250; 25% = 11812.50 > 5000.
{
  const r = computeUnderwriting(starter({ assignment: { kind: 'profit_share' } }));
  check('profit share status', r.status, 'resolved');
  check('profit share spread', r.figures.assignmentSpread, 11812.5, 0.001);
  check('profit share provenance', r.provenance.profitSharePct, 'iaos_starter');
}

// ---- 10b. Profit share below the standard minimum is floored, silently.
// ARV 133000 -> required profit 19950 -> 25% = 4987.50, under the 5000 floor.
// PB-D56 line 2096 specifies max(share, minimum). Unlike manual, no warning
// is emitted -- the floor is a derived rule, not a deliberate exception.
{
  const r = computeUnderwriting(starter({
    arv: D(133000),
    assignment: { kind: 'profit_share' },
  }));
  check('profit share floored status', r.status, 'resolved');
  check('profit share floored spread', r.figures.assignmentSpread, 5000);
  check('profit share floored emits no warning', r.warnings.length, 0);
}

// ---- 11. Profit share does not fall back when its percentage is unresolved.
{
  const r = computeUnderwriting(starter({
    assignment: { kind: 'profit_share' },
    profitSharePct: U(),
  }));
  check('profit share unresolved status', r.status, 'unresolved');
  check('profit share unresolved names pct', r.missing.indexOf('profitSharePct') >= 0, true);
}

// ---- 12. Standard mode does not consume profitSharePct.
{
  const r = computeUnderwriting(starter({ profitSharePct: U() }));
  check('standard ignores unresolved profitSharePct', r.status, 'resolved');
  check('standard profitSharePct provenance null', r.provenance.profitSharePct, null);
}

// ---- 13. Holding is both components or neither.
{
  const r = computeUnderwriting(starter({ holdMonths: U() }));
  check('holding partial status', r.status, 'unresolved');
  check('holding partial names months', r.missing.indexOf('holdMonths') >= 0, true);
  check('holding partial does not name carry', r.missing.indexOf('monthlyCarry') >= 0, false);
}

// ---- 14. Gate 1: missing ARV.
{
  const r = computeUnderwriting(starter({ arv: U() }));
  check('missing arv status', r.status, 'unresolved');
  check('missing arv names arv', r.missing.indexOf('arv') >= 0, true);
}

// ---- 15. Missing inputs accumulate rather than short-circuit.
{
  const r = computeUnderwriting(starter({ arv: U(), repairs: U(), closingCost: U() }));
  check('accumulate status', r.status, 'unresolved');
  check('accumulate count', r.missing.length, 3);
}

// ---- 16. Provenance is reported per assumption, from mixed levels.
{
  const r = computeUnderwriting(starter({
    monthlyCarry: V(500, 'investor_policy'),
    holdMonths: V(8, 'deal_override'),
  }));
  check('mixed provenance carry', r.provenance.monthlyCarry, 'investor_policy');
  check('mixed provenance months', r.provenance.holdMonths, 'deal_override');
  check('mixed provenance selling', r.provenance.sellingCostPct, 'iaos_starter');
}

// ---- 17. Acquisition position, three states.
{
  check('position unknown', computeAcquisitionPosition({ sellerMAO: 176363, askingPrice: null }),
    { position: 'asking_unknown' });
  check('position within', computeAcquisitionPosition({ sellerMAO: 176363, askingPrice: 170000 }),
    { position: 'within_range', acquisitionCushion: 6363 });
  check('position above', computeAcquisitionPosition({ sellerMAO: 176363, askingPrice: 180000 }),
    { position: 'above_range', gapToUnderwriting: 3637 });
  check('position boundary equal is within', computeAcquisitionPosition({ sellerMAO: 176363, askingPrice: 176363 }),
    { position: 'within_range', acquisitionCushion: 0 });
}

// ---- 18. B8-03/INV-46: new Figures fields on the golden path. Additive
// only -- proves extending Figures did not disturb the proven numbers
// above (checks 1-17 are byte-identical to before this issue).
{
  const r = computeUnderwriting(starter());
  check('golden requiredBuyerProfit', r.figures.requiredBuyerProfit, 47250, 0.5);
  check('golden standardMinimumAssignmentSpread', r.figures.standardMinimumAssignmentSpread, 5000);
  check('golden standardMinimumLevel', r.figures.standardMinimumLevel, 'iaos_starter');
  check('golden buyerProfitSharePct', r.figures.buyerProfitSharePct, 0.25);
  check('golden buyerProfitSharePctLevel', r.figures.buyerProfitSharePctLevel, 'iaos_starter');
}

// ---- 19. B8-03/INV-46: figures.buyerProfitSharePct resolves even in
// standard mode, where it was previously never read at all. provenance.
// profitSharePct is a DIFFERENT field and stays null exactly as case 12
// already proves -- this case does not weaken that one.
{
  const r = computeUnderwriting(starter({ assignment: { kind: 'standard' } }));
  check('standard mode figures.buyerProfitSharePct resolves', r.figures.buyerProfitSharePct, 0.25);
  check('standard mode provenance.profitSharePct stays null', r.provenance.profitSharePct, null);
}

// ---- 20. B8-03/INV-46: figures.buyerProfitSharePct is null only for the
// synthetic construction of an unresolved profitSharePct outside
// profit_share mode -- overall status is unaffected, matching case 12.
{
  const r = computeUnderwriting(starter({ assignment: { kind: 'standard' }, profitSharePct: U() }));
  check('synthetic unresolved profitSharePct status stays resolved', r.status, 'resolved');
  check('synthetic unresolved figures.buyerProfitSharePct is null', r.figures.buyerProfitSharePct, null);
  check('synthetic unresolved figures.buyerProfitSharePctLevel is null', r.figures.buyerProfitSharePctLevel, null);
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
