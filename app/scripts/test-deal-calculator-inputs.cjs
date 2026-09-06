/**
 * Standalone Deal Calculator -- input assembly test runner. B8-09 / INV-52.
 *
 * Compiles the pure input-assembly module and its resolver/compute
 * dependencies to a temp directory, loads the emitted JavaScript, and runs
 * deterministic table-driven cases. No GHL, no network, no fixture beyond
 * plain objects.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-deal-calculator-inputs-test');
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

const resolverPath = path.join(TMP, 'underwriting', 'resolver.js');
const computePath = path.join(TMP, 'underwriting', 'compute.js');
const board8Path = path.join(TMP, 'underwriting', 'board8-economics.js');
const inputsPath = path.join(TMP, 'deal-calculator-inputs.js');
for (const p of [resolverPath, computePath, board8Path, inputsPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { parseOpportunityValues, parseContactSeeds, resolveDealFacts, resolveInputs, parsePolicy } = require(resolverPath);
const { computeUnderwriting } = require(computePath);
const { computeBoard8Economics } = require(board8Path);
const { buildDealCalculatorInputs, parseNonNegativeAmountInput, DEFAULT_ASSIGNMENT_MODE } = require(inputsPath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 34;
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

// The eleven Investor Policy fixture ids/raw values, GHL human units.
const POLICY_IDS = {
  sellingCostPct: 'id_sellingCostPct', closingCost: 'id_closingCost',
  monthlyCarry: 'id_monthlyCarry', holdMonths: 'id_holdMonths',
  buyerProfitPct: 'id_buyerProfitPct', financingEnabled: 'id_financingEnabled',
  financingLtv: 'id_financingLtv', financingRate: 'id_financingRate',
  financingPoints: 'id_financingPoints', standardMinimum: 'id_standardMinimum',
  profitSharePct: 'id_profitSharePct',
};
const POLICY_VALUES = [
  { id: POLICY_IDS.sellingCostPct, value: '10' },
  { id: POLICY_IDS.closingCost, value: '2500' },
  { id: POLICY_IDS.monthlyCarry, value: '500' },
  { id: POLICY_IDS.holdMonths, value: '5' },
  { id: POLICY_IDS.buyerProfitPct, value: '15' },
  { id: POLICY_IDS.financingEnabled, value: 'On' },
  { id: POLICY_IDS.financingLtv, value: '70' },
  { id: POLICY_IDS.financingRate, value: '12' },
  { id: POLICY_IDS.financingPoints, value: '2' },
  { id: POLICY_IDS.standardMinimum, value: '5000' },
  { id: POLICY_IDS.profitSharePct, value: '25' },
];

// ============================================================
// Basic construction: ARV + Repairs present, default (Standard) mode,
// full policy -> resolves, matching the golden fixture already
// cross-checked elsewhere (test-board8-economics.cjs,
// test-seller-call-deal-bar.cjs): endBuyerMaxPrice/maxSupportedOffer
// ~176363.20305052432.
// ============================================================
{
  check('DEFAULT_ASSIGNMENT_MODE is Standard -- the one mode requiring no further input', DEFAULT_ASSIGNMENT_MODE, 'standard');

  const inputs = buildDealCalculatorInputs({
    arv: 315000, repairs: 41000, assignment: { mode: 'standard' },
    policyValues: POLICY_VALUES, policyIds: POLICY_IDS,
  });
  const result = computeUnderwriting(inputs);
  check('ARV + Repairs + full policy + Standard mode -> resolved', result.status, 'resolved');

  const board8 = computeBoard8Economics(result);
  check('board8 status is calculated', board8.status, 'calculated');
  check('endBuyerMaxPrice matches the cross-checked golden fixture', Math.round(board8.endBuyerMaxPrice), 181363);
  check('maxSupportedOffer matches the cross-checked golden fixture', Math.round(board8.maxSupportedOffer), 176363);
}

// ============================================================
// ARV/Repairs absent -> unresolved, naming exactly what is missing --
// never a silent default, never zero.
// ============================================================
{
  const noArv = buildDealCalculatorInputs({
    arv: null, repairs: 41000, assignment: { mode: 'standard' },
    policyValues: POLICY_VALUES, policyIds: POLICY_IDS,
  });
  const noArvResult = computeUnderwriting(noArv);
  check('no ARV -> unresolved', noArvResult.status, 'unresolved');
  check('no ARV -> missing names arv', noArvResult.missing.includes('arv'), true);

  const noRepairs = buildDealCalculatorInputs({
    arv: 315000, repairs: null, assignment: { mode: 'standard' },
    policyValues: POLICY_VALUES, policyIds: POLICY_IDS,
  });
  const noRepairsResult = computeUnderwriting(noRepairs);
  check('no Repairs -> unresolved', noRepairsResult.status, 'unresolved');
  check('no Repairs -> missing names repairs', noRepairsResult.missing.includes('repairs'), true);

  const noneAtAll = buildDealCalculatorInputs({
    arv: null, repairs: null, assignment: { mode: 'standard' },
    policyValues: [], policyIds: POLICY_IDS,
  });
  const noneResult = computeUnderwriting(noneAtAll);
  check('cold open, nothing entered, no policy read yet -> unresolved (never a fabricated number)', noneResult.status, 'unresolved');
  check('cold open missing list names both Gate 1 inputs', noneResult.missing.includes('arv') && noneResult.missing.includes('repairs'), true);
}

// ============================================================
// Empty policyValues (GHL not yet read, or read failed) still fully
// resolves via IAOS Starter -- the calculator works standalone even with
// no live policy connection.
// ============================================================
{
  const inputs = buildDealCalculatorInputs({
    arv: 315000, repairs: 41000, assignment: { mode: 'standard' },
    policyValues: [], policyIds: POLICY_IDS,
  });
  const result = computeUnderwriting(inputs);
  check('empty policyValues still resolves via IAOS Starter fallback', result.status, 'resolved');
  check('every provenance level with no policy read is iaos_starter', Object.values(result.provenance).filter((l) => l !== null).every((l) => l === 'iaos_starter'), true);
}

// ============================================================
// Assignment mode variations: profit_share resolves; manual WITH an
// amount resolves; manual WITHOUT an amount is unresolved (resolveInputs's
// own existing rule, reused verbatim, not reimplemented).
// ============================================================
{
  const profitShare = buildDealCalculatorInputs({
    arv: 315000, repairs: 41000, assignment: { mode: 'profit_share' },
    policyValues: POLICY_VALUES, policyIds: POLICY_IDS,
  });
  check('profit_share mode resolves', computeUnderwriting(profitShare).status, 'resolved');

  const manualWithAmount = buildDealCalculatorInputs({
    arv: 315000, repairs: 41000, assignment: { mode: 'manual', amount: 8000 },
    policyValues: POLICY_VALUES, policyIds: POLICY_IDS,
  });
  check('manual mode with an amount resolves', computeUnderwriting(manualWithAmount).status, 'resolved');

  const manualNoAmount = buildDealCalculatorInputs({
    arv: 315000, repairs: 41000, assignment: { mode: 'manual', amount: null },
    policyValues: POLICY_VALUES, policyIds: POLICY_IDS,
  });
  const manualNoAmountResult = computeUnderwriting(manualNoAmount);
  check('manual mode with NO amount -> unresolved (resolveInputs\'s own existing rule, reused, not reimplemented)', manualNoAmountResult.status, 'unresolved');
  check('manual-no-amount missing names assignmentMode', manualNoAmountResult.missing.includes('assignmentMode'), true);
}

// ============================================================
// SAME ECONOMICS AS SELLER CALL / UNDERWRITING FOR IDENTICAL INPUTS.
// Cross-checks buildDealCalculatorInputs's DealFacts-direct path against
// the REAL Opportunity-parsing path (parseOpportunityValues + resolveDealFacts)
// with equivalent fixture data -- both funnel through the SAME
// resolveInputs/computeUnderwriting, so identical Figures here is the
// strongest available proof neither path silently diverges.
// ============================================================
{
  const OPP_IDS = { arv: 'opp_arv', repairs: 'opp_repairs', askingPrice: 'opp_ask', assignmentMode: 'opp_mode' };
  const CONTACT_IDS = { arv: 'c_arv', repairs: 'c_repairs', askingPrice: 'c_ask' };

  const oppFields = [
    { id: OPP_IDS.arv, fieldValueNumber: 315000 },
    { id: OPP_IDS.repairs, fieldValueNumber: 41000 },
    { id: OPP_IDS.assignmentMode, fieldValueString: 'Standard Minimum' },
  ];
  const oppValues = parseOpportunityValues(oppFields, OPP_IDS);
  const contactSeeds = parseContactSeeds([], CONTACT_IDS);
  const dealFactsPath = resolveDealFacts(oppValues, contactSeeds);
  const { policy } = parsePolicy(POLICY_VALUES, POLICY_IDS);
  const overridesPath = require(resolverPath).parseDealOverrides([]);
  const sellerCallStyleInputs = resolveInputs(dealFactsPath, overridesPath, policy);
  const sellerCallResult = computeUnderwriting(sellerCallStyleInputs);

  const calculatorInputs = buildDealCalculatorInputs({
    arv: 315000, repairs: 41000, assignment: { mode: 'standard' },
    policyValues: POLICY_VALUES, policyIds: POLICY_IDS,
  });
  const calculatorResult = computeUnderwriting(calculatorInputs);

  check('both paths resolve', [sellerCallResult.status, calculatorResult.status], ['resolved', 'resolved']);
  check('IDENTICAL figures for identical inputs (same ARV, Repairs, Standard mode, same policy)', calculatorResult.figures, sellerCallResult.figures);

  const calculatorBoard8 = computeBoard8Economics(calculatorResult);
  const sellerCallBoard8 = computeBoard8Economics(sellerCallResult);
  check('IDENTICAL Board 8 economics (Target, Max) for identical inputs', calculatorBoard8, sellerCallBoard8);
}

// ============================================================
// parseNonNegativeAmountInput: distinguishes empty from invalid, rejects
// negative/malformed/NaN/infinite, but -- unlike the acquisition-price
// parser -- ACCEPTS zero (a legitimate $0 repairs/manual-spread answer).
// ============================================================
{
  check('empty string -> empty', parseNonNegativeAmountInput(''), { kind: 'empty' });
  check('whitespace-only -> empty', parseNonNegativeAmountInput('   '), { kind: 'empty' });

  const zero = parseNonNegativeAmountInput('0');
  check('zero -> value 0 (a legitimate $0 answer, unlike the acquisition-price parser)', zero, { kind: 'value', value: 0 });

  const negative = parseNonNegativeAmountInput('-1000');
  check('negative -> invalid', negative.kind, 'invalid');

  const malformed = parseNonNegativeAmountInput('abc');
  check('malformed text -> invalid', malformed.kind, 'invalid');

  const nanLiteral = parseNonNegativeAmountInput('NaN');
  check('the literal text "NaN" -> invalid', nanLiteral.kind, 'invalid');

  const infinite = parseNonNegativeAmountInput('Infinity');
  check('Infinity -> invalid', infinite.kind, 'invalid');

  const formatted = parseNonNegativeAmountInput('$41,000');
  check('a formatted positive amount ($41,000) is preserved', formatted, { kind: 'value', value: 41000 });

  const plain = parseNonNegativeAmountInput('41000');
  check('a plain positive amount parses exactly', plain, { kind: 'value', value: 41000 });
}

// ============================================================
// Structural proof: this module consumes resolver.ts/compute.ts, never
// recomputes the waterfall, the eleven-value policy hierarchy, or the
// 25%/$5,000 Target/Max formula.
// ============================================================
{
  const src = fs.readFileSync(path.join(LIB, 'deal-calculator-inputs.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./underwriting/compute"') === -1, true);
  check('source does not reimplement the 25%/$5,000 Target/Max formula', src.indexOf('Math.max') === -1, true);
  check('source imports resolveInputs/parseDealOverrides/parsePolicy rather than reimplementing the hierarchy', /import\s*\{[^}]*resolveInputs[^}]*\}\s*from\s*"\.\/underwriting\/resolver"/.test(src), true);
  check('source contains no network/GHL surface', ['fetch(', 'ghl.', 'PROXY', 'customFields', '.notes.'].every((t) => src.indexOf(t) === -1), true);

  // Checked against compiled output (comments stripped), not source text:
  // the module's own header comment explains that the PAGE (not this
  // module) calls computeUnderwriting, which would false-positive a plain
  // source-text substring check (same class of mistake as
  // arv-approval-note.ts's ghl.notes.list discussion earlier this board).
  const compiledNoComments = execSync(
    'npx tsc "' + path.join(LIB, 'deal-calculator-inputs.ts') + '" --outDir "' + TMP + '-nocomments" --module commonjs --target es2020 --removeComments',
    { cwd: APP }
  ) && fs.readFileSync(path.join(TMP + '-nocomments', 'deal-calculator-inputs.js'), 'utf8');
  fs.rmSync(TMP + '-nocomments', { recursive: true, force: true });
  check('compiled output never calls computeUnderwriting (type/prose mentions only)', /computeUnderwriting/.test(compiledNoComments), false);
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
