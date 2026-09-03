/**
 * Repair Estimation V1 calculation core -- test runner.
 *
 * Compiles the TypeScript core to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases. No GHL, no
 * network, no fixture, no persistence. Exits nonzero on any failure.
 *
 * app/package.json sets "type": "module", so the temp directory is given
 * its own package.json declaring commonjs. Without it, Node reads the
 * emitted .js as ESM and require() fails before any test runs.
 *
 * Cases are drawn from the governing 2026-09-02 amendment in
 * docs/ESTIMATED_REPAIRS_STANDARD.md. Every expected value is transcribed
 * from that document, never from a passing run.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-repair-estimation-test');
const SRC = path.join(APP, 'src', 'lib', 'repair-estimation');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + path.join(SRC, 'types.ts') + '" "' + path.join(SRC, 'reference.ts') +
    '" "' + path.join(SRC, 'compute.ts') +
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

const {
  computeRepairEstimate,
  FMTM_ALLOWANCE_LABEL,
  INSPECTION_DISCLOSURE,
} = require(compiled);
const { REFERENCE_TABLE, findReferenceRow } = require(path.join(TMP, 'reference.js'));

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 115;
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

/** The thrown error's "Name: message", or '' when nothing was thrown. */
function errOf(fn) {
  try { fn(); } catch (e) { return e.name + ': ' + e.message; }
  return '';
}

const NO_CONTEXT = { squareFeet: null, bathroomCount: null };

function est(lines, property) {
  return computeRepairEstimate({ lines: lines, property: property || NO_CONTEXT });
}

/** A major-system line answered from the authorized reference table. */
function ref(id, system, condition, extra) {
  return Object.assign({
    id: id,
    label: id,
    component: 'major_system',
    pricing: { kind: 'reference', system: system, condition: condition },
  }, extra || {});
}

// ---- 1. The three outcomes exist and do not collapse into one another.
{
  const r = est([
    { id: 'a', label: 'Siding', component: 'major_system', pricing: { kind: 'no_repair' } },
    { id: 'b', label: 'Deck', component: 'major_system', pricing: { kind: 'amount', amount: 4000, provenance: 'MANUAL' } },
    { id: 'c', label: 'Sewer scope', component: 'major_system', pricing: { kind: 'unpriced_risk', reason: 'not yet scoped' } },
  ]);
  check('no_repair outcome kind', r.lines[0].outcome.kind, 'no_repair');
  check('no_repair carries no amount', r.lines[0].outcome.amount, undefined);
  check('priced outcome kind', r.lines[1].outcome.kind, 'priced');
  check('priced amount', r.lines[1].outcome.amount, 4000);
  check('unpriced outcome kind', r.lines[2].outcome.kind, 'unpriced_risk');
  check('unpriced carries no amount', r.lines[2].outcome.amount, undefined);
  check('unpriced risk is listed', r.unpricedRisks.length, 1);
  check('unpriced risk keeps its reason', r.unpricedRisks[0].reason, 'not yet scoped');
  check('unpriced does not enter the subtotal', r.resolvedSubtotal, 4000);
}

// ---- 2. The authorized reference table, row by row, exactly as written.
{
  check('table has exactly six rows', REFERENCE_TABLE.length, 6);

  check('roof replace amount', est([ref('r', 'roof', 'replace')]).lines[0].outcome.amount, 15000);
  check('roof replace provenance', est([ref('r', 'roof', 'replace')]).lines[0].outcome.provenance, 'IAOS_POLICY');
  check('roof unknown amount', est([ref('r', 'roof', 'unknown')]).lines[0].outcome.amount, 15000);

  check('whole-house electrical replace amount', est([ref('e', 'electrical_whole_house', 'replace')]).lines[0].outcome.amount, 12500);
  check('whole-house electrical provenance', est([ref('e', 'electrical_whole_house', 'replace')]).lines[0].outcome.provenance, 'IAOS_POLICY');
  check('whole-house electrical unknown amount', est([ref('e', 'electrical_whole_house', 'unknown')]).lines[0].outcome.amount, 12500);

  check('plumbing major amount', est([ref('p', 'plumbing_sewer', 'major')]).lines[0].outcome.amount, 12500);
  check('plumbing provenance', est([ref('p', 'plumbing_sewer', 'major')]).lines[0].outcome.provenance, 'IAOS_POLICY');
  check('plumbing unknown amount', est([ref('p', 'plumbing_sewer', 'unknown')]).lines[0].outcome.amount, 12500);

  check('foundation material issue amount', est([ref('f', 'foundation', 'material_issue')]).lines[0].outcome.amount, 15000);
  check('foundation provenance', est([ref('f', 'foundation', 'material_issue')]).lines[0].outcome.provenance, 'IAOS_POLICY');
  check('foundation unknown amount', est([ref('f', 'foundation', 'unknown')]).lines[0].outcome.amount, 15000);

  check('hvac replace amount', est([ref('h', 'hvac', 'replace')]).lines[0].outcome.amount, 6500);
  check('hvac provenance is BOOK not policy', est([ref('h', 'hvac', 'replace')]).lines[0].outcome.provenance, 'BOOK');
  check('hvac unknown amount', est([ref('h', 'hvac', 'unknown')]).lines[0].outcome.amount, 6500);

  check('electrical panel replace amount', est([ref('x', 'electrical_panel', 'replace')]).lines[0].outcome.amount, 2500);
  check('electrical panel provenance is BOOK', est([ref('x', 'electrical_panel', 'replace')]).lines[0].outcome.provenance, 'BOOK');
}

// ---- 3. No square-footage bands: reserves ignore house size entirely.
{
  const small = est([ref('r', 'roof', 'unknown')], { squareFeet: 900, bathroomCount: 1 });
  const large = est([ref('r', 'roof', 'unknown')], { squareFeet: 3400, bathroomCount: 4 });
  check('roof reserve at 900 sf', small.lines[0].outcome.amount, 15000);
  check('roof reserve at 3400 sf', large.lines[0].outcome.amount, 15000);
  check('reserve is unaffected by house size', small.resolvedSubtotal, large.resolvedSubtotal);
}

// ---- 4. The panel row is not reachable from Unknown; that is the
//         whole-house reserve, and the two must stay distinct.
{
  const r = est([ref('x', 'electrical_panel', 'unknown')]);
  check('panel unknown is not priced', r.lines[0].outcome.kind, 'unpriced_risk');
  check('panel unknown does not borrow the whole-house reserve', r.resolvedSubtotal, 0);
  check('findReferenceRow panel/unknown is null', findReferenceRow('electrical_panel', 'unknown'), null);
}

// ---- 5. Unmatched known repairs stay blank; nothing is invented.
{
  const r = est([ref('w', 'windows', 'replace')]);
  check('windows has no authorized row', r.lines[0].outcome.kind, 'unpriced_risk');
  check('windows is not silently zero', r.resolvedSubtotal, 0);
  check('roof repair is not priced from the replace row', est([ref('r', 'roof', 'repair')]).lines[0].outcome.kind, 'unpriced_risk');
  check('good condition is a real zero', est([ref('r', 'roof', 'good')]).lines[0].outcome.kind, 'no_repair');
}

// ---- 6. The operator may enter a known amount manually.
{
  const r = est([
    { id: 'w', label: 'Windows', component: 'major_system', pricing: { kind: 'amount', amount: 7200, provenance: 'MANUAL' } },
  ]);
  check('manual amount is priced', r.lines[0].outcome.amount, 7200);
  check('manual amount keeps MANUAL provenance', r.lines[0].outcome.provenance, 'MANUAL');
  check('manual amount is not presented as BOOK', r.byProvenance.BOOK, 0);
  check('manual amount is not presented as policy', r.byProvenance.IAOS_POLICY, 0);
}

// ---- 7. Foundation override is permitted; the others are not.
{
  const r = est([ref('f', 'foundation', 'material_issue', undefined)]);
  check('foundation defaults to the reserve', r.lines[0].outcome.amount, 15000);

  const o = est([{
    id: 'f', label: 'Foundation', component: 'major_system',
    pricing: { kind: 'reference', system: 'foundation', condition: 'material_issue', override: { amount: 9000 } },
  }]);
  check('foundation override amount', o.lines[0].outcome.amount, 9000);
  check('overridden amount becomes MANUAL, not policy', o.lines[0].outcome.provenance, 'MANUAL');

  check('roof override is rejected', errOf(function () {
    est([{ id: 'r', label: 'Roof', component: 'major_system',
      pricing: { kind: 'reference', system: 'roof', condition: 'replace', override: { amount: 1 } } }]);
  }).indexOf('RepairInputError') === 0, true);

  check('override without a row is rejected', errOf(function () {
    est([{ id: 'w', label: 'Windows', component: 'major_system',
      pricing: { kind: 'reference', system: 'windows', condition: 'replace', override: { amount: 1 } } }]);
  }).indexOf('RepairInputError') === 0, true);
}

// ---- 8. Kitchen and appliances are independent. No pairing, no tiering,
//         no hidden quality multiplier.
{
  const kitchenOnly = est([
    { id: 'k', label: 'Kitchen', component: 'fixed_package', packageKey: 'kitchen', pricing: { kind: 'amount', amount: 12000, provenance: 'BOOK' } },
  ]);
  const both = est([
    { id: 'k', label: 'Kitchen', component: 'fixed_package', packageKey: 'kitchen', pricing: { kind: 'amount', amount: 12000, provenance: 'BOOK' } },
    { id: 'ap', label: 'Appliances', component: 'fixed_package', packageKey: 'appliances', pricing: { kind: 'amount', amount: 3200, provenance: 'BOOK' } },
  ]);
  const appliancesOnly = est([
    { id: 'ap', label: 'Appliances', component: 'fixed_package', packageKey: 'appliances', pricing: { kind: 'amount', amount: 3200, provenance: 'BOOK' } },
  ]);
  check('kitchen alone', kitchenOnly.components.fixedPackageRepairs, 12000);
  check('appliances alone', appliancesOnly.components.fixedPackageRepairs, 3200);
  check('kitchen is unchanged by selecting appliances', both.lines[0].outcome.amount, 12000);
  check('appliances are unchanged by selecting kitchen', both.lines[1].outcome.amount, 3200);
  check('packages add, they do not multiply', both.components.fixedPackageRepairs, 15200);
  check('no pairing surcharge appears', both.resolvedSubtotal, 15200);
}

// ---- 9. Bathroom count is context, never a quantity.
{
  const ctx = { squareFeet: 1500, bathroomCount: 3 };
  const none = est([], ctx);
  check('three bathrooms produce no lines on their own', none.lines.length, 0);
  check('three bathrooms produce no dollars on their own', none.resolvedSubtotal, 0);

  const one = est([
    { id: 'b1', label: 'Hall bath', component: 'fixed_package', packageKey: 'bathroom', pricing: { kind: 'amount', amount: 5200, provenance: 'BOOK' } },
  ], ctx);
  check('only the bathroom needing work is priced', one.resolvedSubtotal, 5200);

  const changed = est([
    { id: 'b1', label: 'Hall bath', component: 'fixed_package', packageKey: 'bathroom', pricing: { kind: 'amount', amount: 5200, provenance: 'BOOK' } },
  ], { squareFeet: 1500, bathroomCount: 9 });
  check('bathroom count does not change the total', changed.resolvedSubtotal, 5200);
}

// ---- 10. Square footage prefills, is correctable, and is never invented.
{
  const scaled = {
    id: 's', label: 'Interior paint', component: 'scaling',
    pricing: { kind: 'scaled', ratePerUnit: 3.42, unit: 'sf', provenance: 'BOOK', quantity: null },
  };
  const missing = est([scaled], NO_CONTEXT);
  check('missing sqft leaves the line unpriced', missing.lines[0].outcome.kind, 'unpriced_risk');
  check('missing sqft is not silently zero', missing.resolvedSubtotal, 0);
  check('missing sqft selects no band', missing.components.scalingRepairs, 0);

  const prefilled = est([scaled], { squareFeet: 1500, bathroomCount: null });
  check('imported sqft prefills the quantity', prefilled.components.scalingRepairs, 5130);

  const corrected = est([{
    id: 's', label: 'Interior paint', component: 'scaling',
    pricing: { kind: 'scaled', ratePerUnit: 3.42, unit: 'sf', provenance: 'BOOK', quantity: 2000 },
  }], { squareFeet: 1500, bathroomCount: null });
  check('operator correction overrides the prefill', corrected.components.scalingRepairs, 6840);

  const lf = est([{
    id: 'l', label: 'Fascia', component: 'scaling',
    pricing: { kind: 'scaled', ratePerUnit: 4, unit: 'lf', provenance: 'BOOK', quantity: null },
  }], { squareFeet: 1500, bathroomCount: null });
  check('lf never borrows building sqft', lf.lines[0].outcome.kind, 'unpriced_risk');
}

// ---- 11. Unknown condition is a reserve, and the disclosure split holds.
{
  const r = est([
    { id: 'k', label: 'Kitchen', component: 'fixed_package', packageKey: 'kitchen', pricing: { kind: 'amount', amount: 12000, provenance: 'BOOK' } },
    ref('r', 'roof', 'unknown'),
    ref('h', 'hvac', 'unknown'),
    ref('p', 'plumbing_sewer', 'major'),
  ]);
  check('unknown roof is classified as a reserve', r.lines[1].origin, 'unknown_condition');
  check('unknown hvac is classified as a reserve', r.lines[2].origin, 'unknown_condition');
  check('an established major condition is indicated, not a reserve', r.lines[3].origin, 'indicated');
  check('unknown reserves subtotal', r.components.unknownRiskReserves, 21500);
  check('indicated subtotal excludes reserves', r.indicatedSubtotal, 24500);
  check('major-system bucket holds only indicated work', r.components.majorSystemRepairs, 12500);
  check('fixed package bucket', r.components.fixedPackageRepairs, 12000);
  check('conservative resolved subtotal', r.resolvedSubtotal, 46000);
  check('indicated plus reserves equals the subtotal',
    r.indicatedSubtotal + r.components.unknownRiskReserves, r.resolvedSubtotal);
}

// ---- 12. The five components decompose the subtotal exactly once.
{
  const r = est([
    { id: 's', label: 'Paint', component: 'scaling', pricing: { kind: 'scaled', ratePerUnit: 2, unit: 'sf', provenance: 'BOOK', quantity: 1000 } },
    { id: 'k', label: 'Kitchen', component: 'fixed_package', packageKey: 'kitchen', pricing: { kind: 'amount', amount: 12000, provenance: 'BOOK' } },
    ref('p', 'plumbing_sewer', 'major'),
    ref('r', 'roof', 'unknown'),
  ]);
  const c = r.components;
  check('components sum to the resolved subtotal',
    c.scalingRepairs + c.fixedPackageRepairs + c.majorSystemRepairs + c.unknownRiskReserves,
    r.resolvedSubtotal);
  check('provenance sums to the resolved subtotal',
    r.byProvenance.BOOK + r.byProvenance.IAOS_POLICY + r.byProvenance.MANUAL,
    r.resolvedSubtotal);
  check('BOOK share', r.byProvenance.BOOK, 14000);
  check('IAOS POLICY share', r.byProvenance.IAOS_POLICY, 27500);
  check('MANUAL share', r.byProvenance.MANUAL, 0);
}

// ---- 13. The inherited allowance: exact label and BOOK-only basis.
{
  const r = est([
    ref('r', 'roof', 'replace'),
    ref('h', 'hvac', 'replace'),
    { id: 'm', label: 'Windows', component: 'major_system', pricing: { kind: 'amount', amount: 7200, provenance: 'MANUAL' } },
  ]);
  const a = r.components.fmtmAllowance;
  check('inherited allowance label is preserved exactly',
    a.label, 'FMTM 10% allowance — historical purpose unverified');
  check('exported label constant matches', FMTM_ALLOWANCE_LABEL, a.label);
  check('allowance rate is ten percent', a.ratePct, 10);
  check('allowance is priced', a.outcome.kind, 'priced');
  check('allowance basis includes resolved BOOK only', a.outcome.basis, 6500);
  check('allowance excludes IAOS POLICY amount', a.outcome.basis === r.byProvenance.IAOS_POLICY, false);
  check('allowance excludes MANUAL amount', a.outcome.basis === r.byProvenance.MANUAL, false);
  check('allowance is ten percent of BOOK basis', a.outcome.amount, 650);

  const noBook = est([
    ref('r', 'roof', 'replace'),
    { id: 'm', label: 'Windows', component: 'major_system', pricing: { kind: 'amount', amount: 7200, provenance: 'MANUAL' } },
  ]).components.fmtmAllowance;
  check('policy and manual alone produce a zero basis', noBook.outcome.basis, 0);
  check('policy and manual alone produce a zero allowance', noBook.outcome.amount, 0);
}

// ---- 14. A subtotal carrying unresolved risk is not a complete allowance.
{
  const withRisk = est([
    ref('r', 'roof', 'replace'),
    { id: 'w', label: 'Windows', component: 'major_system', pricing: { kind: 'unpriced_risk', reason: 'condition not established' } },
  ]);
  check('risk present blocks completeness', withRisk.isCompleteAllowance, false);
  check('risk is visible, not omitted', withRisk.unpricedRisks.length, 1);
  check('risk does not reduce the resolved subtotal', withRisk.resolvedSubtotal, 15000);

  const noRisk = est([ref('r', 'roof', 'replace')]);
  check('no risk produces a complete allowance', noRisk.isCompleteAllowance, true);
  check('no risk leaves an empty risk list', noRisk.unpricedRisks.length, 0);
}

// ---- 15. Disclosure is explicit and always present.
{
  const r = est([]);
  check('disclosure is present on an empty estimate', r.disclosure, INSPECTION_DISCLOSURE);
  check('disclosure names inspection', r.disclosure.indexOf('subject to inspection') !== -1, true);
  check('disclosure denies being a contractor bid', r.disclosure.indexOf('not a contractor bid') !== -1, true);
  check('empty estimate is zero, not unpriced', r.resolvedSubtotal, 0);
}

// ---- 16. Validation. Bad input is rejected, never silently corrected.
{
  const bad = function (lines, property) { return errOf(function () { est(lines, property); }); };

  check('negative amount rejected',
    bad([{ id: 'a', label: 'A', component: 'major_system', pricing: { kind: 'amount', amount: -1, provenance: 'MANUAL' } }]).indexOf('RepairInputError') === 0, true);
  check('non-finite amount rejected',
    bad([{ id: 'a', label: 'A', component: 'major_system', pricing: { kind: 'amount', amount: Number.NaN, provenance: 'MANUAL' } }]).indexOf('RepairInputError') === 0, true);
  check('infinite amount rejected',
    bad([{ id: 'a', label: 'A', component: 'major_system', pricing: { kind: 'amount', amount: Number.POSITIVE_INFINITY, provenance: 'MANUAL' } }]).indexOf('RepairInputError') === 0, true);
  check('blank identifier rejected',
    bad([{ id: '  ', label: 'A', component: 'major_system', pricing: { kind: 'no_repair' } }]).indexOf('RepairInputError') === 0, true);
  check('blank label rejected',
    bad([{ id: 'a', label: '', component: 'major_system', pricing: { kind: 'no_repair' } }]).indexOf('RepairInputError') === 0, true);
  check('duplicate identifier rejected',
    bad([
      { id: 'a', label: 'A', component: 'major_system', pricing: { kind: 'no_repair' } },
      { id: 'a', label: 'A again', component: 'major_system', pricing: { kind: 'no_repair' } },
    ]).indexOf('duplicate identifier') !== -1, true);
  check('blank risk explanation rejected',
    bad([{ id: 'a', label: 'A', component: 'major_system', pricing: { kind: 'unpriced_risk', reason: '   ' } }]).indexOf('RepairInputError') === 0, true);
  check('fixed package without a package key rejected',
    bad([{ id: 'a', label: 'A', component: 'fixed_package', pricing: { kind: 'amount', amount: 1, provenance: 'BOOK' } }]).indexOf('RepairInputError') === 0, true);
  check('package key on a non-package line rejected',
    bad([{ id: 'a', label: 'A', component: 'scaling', packageKey: 'kitchen', pricing: { kind: 'amount', amount: 1, provenance: 'BOOK' } }]).indexOf('RepairInputError') === 0, true);
  check('origin contradicting an unknown condition rejected',
    bad([ref('r', 'roof', 'unknown', { origin: 'indicated' })]).indexOf('contradicts') !== -1, true);
  check('negative rate rejected',
    bad([{ id: 's', label: 'S', component: 'scaling', pricing: { kind: 'scaled', ratePerUnit: -2, unit: 'sf', provenance: 'BOOK', quantity: 100 } }]).indexOf('RepairInputError') === 0, true);
  check('negative quantity rejected',
    bad([{ id: 's', label: 'S', component: 'scaling', pricing: { kind: 'scaled', ratePerUnit: 2, unit: 'sf', provenance: 'BOOK', quantity: -100 } }]).indexOf('RepairInputError') === 0, true);
  check('non-positive imported sqft rejected',
    bad([{ id: 's', label: 'S', component: 'scaling', pricing: { kind: 'scaled', ratePerUnit: 2, unit: 'sf', provenance: 'BOOK', quantity: null } }],
      { squareFeet: 0, bathroomCount: null }).indexOf('RepairInputError') === 0, true);
  check('valid input throws nothing',
    bad([ref('r', 'roof', 'replace')]), '');
}

// ---- 17. Determinism: the same input yields the same result, and the
//          engine holds no state between calls.
{
  const build = function () {
    return est([
      ref('r', 'roof', 'unknown'),
      { id: 'k', label: 'Kitchen', component: 'fixed_package', packageKey: 'kitchen', pricing: { kind: 'amount', amount: 12000, provenance: 'BOOK' } },
    ], { squareFeet: 1500, bathroomCount: 2 });
  };
  check('repeat call is identical', JSON.stringify(build()), JSON.stringify(build()));
  check('line order does not change the subtotal',
    est([ref('r', 'roof', 'unknown'), ref('h', 'hvac', 'replace')]).resolvedSubtotal,
    est([ref('h', 'hvac', 'replace'), ref('r', 'roof', 'unknown')]).resolvedSubtotal);
}

// ---- 18. Static contract checks on the source itself.
//          Geography is not a V1 pricing input, and the detailed cost book
//          is not wired into the live calculation layer.
{
  const stripComments = function (s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  };
  const sources = ['types.ts', 'reference.ts', 'compute.ts'].map(function (f) {
    return { file: f, code: stripComments(fs.readFileSync(path.join(SRC, f), 'utf8')).toLowerCase() };
  });
  const forbidden = ['zip', 'geograph', 'market', 'localiz', 'craftsman', 'dfw', 'baseline_unlocalized'];
  let hits = [];
  sources.forEach(function (s) {
    forbidden.forEach(function (term) {
      if (s.code.indexOf(term) !== -1) hits.push(s.file + ':' + term);
    });
  });
  check('no geographic pricing input in the source', hits, []);

  let bookImports = [];
  sources.forEach(function (s) {
    if (s.code.indexOf('repair_bid_sheet') !== -1) bookImports.push(s.file);
  });
  check('the cost book is not imported into the calculation layer', bookImports, []);

  const computeSrc = fs.readFileSync(path.join(SRC, 'compute.ts'), 'utf8');
  check('bathroom count is never read for pricing',
    stripComments(computeSrc).indexOf('bathroomCount'), -1);
  check('no offer or MAO economics in the calculation layer',
    /\boffer_|\bmao\b|assignmentFee/i.test(stripComments(computeSrc)), false);
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
