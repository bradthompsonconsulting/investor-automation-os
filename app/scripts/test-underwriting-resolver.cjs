/**
 * Underwriting resolver -- test runner.
 *
 * Compiles the TypeScript resolver and its dependencies to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no fixture record.
 *
 * app/package.json sets "type": "module", so the temp directory gets its
 * own package.json declaring commonjs. Without it, Node reads the emitted
 * .js as ESM and require() fails before any test runs.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-resolver-test');
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
    '" "' + path.join(SRC, 'starters.ts') + '" "' + path.join(SRC, 'resolver-types.ts') +
    '" "' + path.join(SRC, 'resolver.ts') + '" "' + path.join(SRC, 'view-model.ts') +
    '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const resolverPath = path.join(TMP, 'resolver.js');
const computePath  = path.join(TMP, 'compute.js');
for (const p of [resolverPath, computePath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const {
  parsePolicy,
  parseOpportunityValues,
  parseContactSeeds,
  parseDealOverrides,
  resolveDealFacts,
  resolveInputs,
} = require(resolverPath);
const { computeUnderwriting } = require(computePath);

const viewModelPath = path.join(TMP, 'view-model.js');
if (!fs.existsSync(viewModelPath)) {
  console.error('ABORT: expected compiled output at ' + viewModelPath);
  cleanup();
  process.exit(11);
}
const { toViewModel } = require(viewModelPath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 133;

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

/* ---- fixture identifiers. Deliberately not production ids. ---- */
const CV_IDS = {
  sellingCostPct:   'cv-selling',
  closingCost:      'cv-closing',
  monthlyCarry:     'cv-carry',
  holdMonths:       'cv-months',
  buyerProfitPct:   'cv-profit',
  financingEnabled: 'cv-fin-on',
  financingLtv:     'cv-fin-ltv',
  financingRate:    'cv-fin-rate',
  financingPoints:  'cv-fin-points',
  standardMinimum:  'cv-min',
  profitSharePct:   'cv-share',
};
const OPP_IDS = {
  arv: 'opp-arv', repairs: 'opp-repairs',
  askingPrice: 'opp-ask', assignmentMode: 'opp-mode',
};
const CONTACT_IDS = { arv: 'c-arv', repairs: 'c-repairs', askingPrice: 'c-ask' };

/** Full, valid investor policy in GHL's human units. */
function fullPolicyValues(over) {
  const base = {
    'cv-selling': '10', 'cv-closing': '2500', 'cv-carry': '500',
    'cv-months': '5', 'cv-profit': '15', 'cv-fin-on': 'On',
    'cv-fin-ltv': '70', 'cv-fin-rate': '12', 'cv-fin-points': '2',
    'cv-min': '5000', 'cv-share': '25',
  };
  const merged = Object.assign({}, base, over || {});
  return Object.entries(merged)
    .filter(([, v]) => v !== undefined)
    .map(([id, value]) => ({ id, value }));
}

const noOverrides = () => parseDealOverrides([]);
const emptyPolicy = () => parsePolicy([], CV_IDS).policy;

/* ---- 1. Unit conversion: human units in, decimal fractions out. ---- */
{
  const { policy, issues } = parsePolicy(fullPolicyValues(), CV_IDS);
  check('units selling 10 -> 0.10', policy.sellingCostPct.value, 0.10);
  check('units profit 15 -> 0.15', policy.buyerProfitPct.value, 0.15);
  check('units ltv 70 -> 0.70', policy.financingLtv.value, 0.70);
  check('units rate 12 -> 0.12', policy.financingRate.value, 0.12);
  check('units points 2 -> 0.02', policy.financingPoints.value, 0.02);
  check('units share 25 -> 0.25', policy.profitSharePct.value, 0.25);
  check('dollars closing unconverted', policy.closingCost.value, 2500);
  check('dollars carry unconverted', policy.monthlyCarry.value, 500);
  check('count months unconverted', policy.holdMonths.value, 5);
  check('dollars minimum unconverted', policy.standardMinimum.value, 5000);
  check('valid policy raises no issues', issues.length, 0);
  check('policy level is investor_policy', policy.sellingCostPct.level, 'investor_policy');
}

/* ---- 2. Absent is unresolved WITHOUT an issue. ---- */
{
  const { policy, issues } = parsePolicy([], CV_IDS);
  check('absent policy unresolved', policy.sellingCostPct.kind, 'unresolved');
  check('absent policy raises no issue', issues.length, 0);
}

/* ---- 3. Malformed is unresolved WITH an issue, and isolated. ---- */
{
  const { policy, issues } = parsePolicy(fullPolicyValues({ 'cv-carry': 'abc' }), CV_IDS);
  check('malformed carry unresolved', policy.monthlyCarry.kind, 'unresolved');
  check('malformed raises one issue', issues.length, 1);
  check('issue names the key', issues[0].key, 'monthlyCarry');
  check('issue carries the raw value', issues[0].raw, 'abc');
  check('other ten still resolve', policy.sellingCostPct.value, 0.10);
}

/* ---- 4. Percentage above 100 is malformed, not clamped. ---- */
{
  const { policy, issues } = parsePolicy(fullPolicyValues({ 'cv-selling': '150' }), CV_IDS);
  check('pct over 100 unresolved', policy.sellingCostPct.kind, 'unresolved');
  check('pct over 100 raises issue', issues.length, 1);
  check('pct over 100 not clamped', policy.sellingCostPct.value, undefined);
}

/* ---- 5. Financing switch: only "On" is recognized. ---- */
{
  const on = parsePolicy(fullPolicyValues(), CV_IDS);
  check('financing On resolves true', on.policy.financingEnabled.value, true);

  // Unrolled deliberately. A loop makes the static call-site count
  // understate the runtime count, and the floor must be a literal grep
  // from the file rather than a number back-filled from a passing run.
  const offA = parsePolicy(fullPolicyValues({ 'cv-fin-on': 'Off' }), CV_IDS).policy;
  check('financing Off unresolved', offA.financingEnabled.kind, 'unresolved');
  check('financing Off not false', offA.financingEnabled.value, undefined);

  const offB = parsePolicy(fullPolicyValues({ 'cv-fin-on': 'off' }), CV_IDS).policy;
  check('financing off unresolved', offB.financingEnabled.kind, 'unresolved');
  check('financing off not false', offB.financingEnabled.value, undefined);

  const offC = parsePolicy(fullPolicyValues({ 'cv-fin-on': 'false' }), CV_IDS).policy;
  check('financing false unresolved', offC.financingEnabled.kind, 'unresolved');
  check('financing false not false', offC.financingEnabled.value, undefined);

  const offD = parsePolicy(fullPolicyValues({ 'cv-fin-on': '0' }), CV_IDS).policy;
  check('financing 0 unresolved', offD.financingEnabled.kind, 'unresolved');
  check('financing 0 not false', offD.financingEnabled.value, undefined);

  const offE = parsePolicy(fullPolicyValues({ 'cv-fin-on': 'ON' }), CV_IDS).policy;
  check('financing ON case-sensitive unresolved', offE.financingEnabled.kind, 'unresolved');
  check('financing ON not false', offE.financingEnabled.value, undefined);

  const offF = parsePolicy(fullPolicyValues({ 'cv-fin-on': 'no' }), CV_IDS).policy;
  check('financing no unresolved', offF.financingEnabled.kind, 'unresolved');
  check('financing no not false', offF.financingEnabled.value, undefined);

  const offG = parsePolicy(fullPolicyValues({ 'cv-fin-on': ' ' }), CV_IDS).policy;
  check('financing blank unresolved', offG.financingEnabled.kind, 'unresolved');
  check('financing blank not false', offG.financingEnabled.value, undefined);
}

/* ---- 6. Strict opportunity reads: no cross-key coercion. ---- */
{
  const wrongKey = parseOpportunityValues(
    [{ id: 'opp-arv', fieldValueString: '315000' }], OPP_IDS);
  check('NUMERICAL under fieldValueString reads absent', wrongKey.arv.kind, 'unresolved');

  const rightKey = parseOpportunityValues(
    [{ id: 'opp-arv', fieldValueNumber: 315000 }], OPP_IDS);
  check('NUMERICAL under fieldValueNumber reads', rightKey.arv.value, 315000);

  const numericString = parseOpportunityValues(
    [{ id: 'opp-arv', fieldValueNumber: '315000' }], OPP_IDS);
  check('numeric string at the right key reads', numericString.arv.value, 315000);
}

/* ---- 7. Assignment mode parsing, exact option strings. ---- */
{
  const std = parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS);
  check('mode Standard Minimum', std.assignmentMode.value, 'standard');
  const ps = parseOpportunityValues([{ id: 'opp-mode', fieldValueString: '25% of Buyer Profit' }], OPP_IDS);
  check('mode 25% of Buyer Profit', ps.assignmentMode.value, 'profit_share');
  const man = parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Manual' }], OPP_IDS);
  check('mode Manual', man.assignmentMode.value, 'manual');
  const bad = parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Whatever' }], OPP_IDS);
  check('unrecognized mode unresolved', bad.assignmentMode.kind, 'unresolved');
  const absent = parseOpportunityValues([], OPP_IDS);
  check('absent mode unresolved', absent.assignmentMode.kind, 'unresolved');
}

/* ---- 8. Seed-then-supersede. ---- */
{
  const oppHas = parseOpportunityValues([{ id: 'opp-arv', fieldValueNumber: 300000 }], OPP_IDS);
  const contactHas = parseContactSeeds([{ id: 'c-arv', value: '250000' }], CONTACT_IDS);
  const both = resolveDealFacts(oppHas, contactHas);
  check('opportunity wins over contact', both.arv.value, 300000);

  const oppEmpty = parseOpportunityValues([], OPP_IDS);
  const seeded = resolveDealFacts(oppEmpty, contactHas);
  check('contact seeds when opportunity absent', seeded.arv.value, 250000);

  const neither = resolveDealFacts(oppEmpty, parseContactSeeds([], CONTACT_IDS));
  check('both absent is unresolved', neither.arv.kind, 'unresolved');
  check('reason names both sources',
    neither.arv.reason.indexOf('opportunity or the contact') >= 0, true);
}

/* ---- 9. Assignment FAILS CLOSED. Never Standard by accident. ---- */
{
  const policy = parsePolicy(fullPolicyValues(), CV_IDS).policy;

  const noMode = resolveInputs(
    resolveDealFacts(parseOpportunityValues([], OPP_IDS), parseContactSeeds([], CONTACT_IDS)),
    noOverrides(), policy);
  check('absent mode -> assignment unresolved', noMode.assignment.kind, 'unresolved');

  const badMode = resolveInputs(
    resolveDealFacts(
      parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Nonsense' }], OPP_IDS),
      parseContactSeeds([], CONTACT_IDS)),
    noOverrides(), policy);
  check('unrecognized mode -> assignment unresolved', badMode.assignment.kind, 'unresolved');

  const manualNoAmount = resolveInputs(
    resolveDealFacts(
      parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Manual' }], OPP_IDS),
      parseContactSeeds([], CONTACT_IDS)),
    noOverrides(), policy);
  check('manual without amount -> assignment unresolved', manualNoAmount.assignment.kind, 'unresolved');
  check('manual without amount reason names it',
    manualNoAmount.assignment.reason.indexOf('no amount') >= 0, true);
}

/* ---- 10. Unresolved assignment blocks the core. ---- */
{
  const facts = resolveDealFacts(
    parseOpportunityValues(
      [{ id: 'opp-arv', fieldValueNumber: 315000 }, { id: 'opp-repairs', fieldValueNumber: 41000 }],
      OPP_IDS),
    parseContactSeeds([], CONTACT_IDS));
  const inputs = resolveInputs(facts, noOverrides(), parsePolicy(fullPolicyValues(), CV_IDS).policy);
  const r = computeUnderwriting(inputs);
  check('unresolved assignment blocks the core', r.status, 'unresolved');
  check('core names assignmentMode', r.missing.indexOf('assignmentMode') >= 0, true);
}

/* ---- 11. Hierarchy: override beats policy beats starter. ---- */
{
  const policy = parsePolicy(fullPolicyValues(), CV_IDS).policy;
  const overrides = noOverrides();
  overrides.holdMonths = { kind: 'value', value: 8, level: 'deal_override' };

  const facts = resolveDealFacts(
    parseOpportunityValues(
      [{ id: 'opp-arv', fieldValueNumber: 315000 },
       { id: 'opp-repairs', fieldValueNumber: 41000 },
       { id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds([], CONTACT_IDS));

  const inputs = resolveInputs(facts, overrides, policy);
  check('override wins', inputs.holdMonths.value, 8);
  check('override level', inputs.holdMonths.level, 'deal_override');
  check('policy wins where no override', inputs.sellingCostPct.value, 0.10);
  check('policy level', inputs.sellingCostPct.level, 'investor_policy');
}

/* ---- 12. Starter is the floor when policy is absent. ---- */
{
  const facts = resolveDealFacts(
    parseOpportunityValues(
      [{ id: 'opp-arv', fieldValueNumber: 315000 },
       { id: 'opp-repairs', fieldValueNumber: 41000 },
       { id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds([], CONTACT_IDS));
  const inputs = resolveInputs(facts, noOverrides(), emptyPolicy());
  check('starter selling', inputs.sellingCostPct.value, 0.10);
  check('starter level', inputs.sellingCostPct.level, 'iaos_starter');
  check('starter closing', inputs.closingCost.value, 2500);
  check('starter months', inputs.holdMonths.value, 5);
  check('starter minimum', inputs.standardMinimum.value, 5000);
}

/* ---- 13. Mixed-source financing: four levels, four provenances. ---- */
{
  // Switch from override, LTV from policy, rate from starter, points from override.
  const policy = parsePolicy(fullPolicyValues({ 'cv-fin-rate': undefined }), CV_IDS).policy;
  const overrides = noOverrides();
  overrides.financingEnabled = { kind: 'value', value: true, level: 'deal_override' };
  overrides.financingPoints = { kind: 'value', value: 0.03, level: 'deal_override' };

  const facts = resolveDealFacts(
    parseOpportunityValues(
      [{ id: 'opp-arv', fieldValueNumber: 315000 },
       { id: 'opp-repairs', fieldValueNumber: 41000 },
       { id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds([], CONTACT_IDS));

  const inputs = resolveInputs(facts, overrides, policy);
  check('mixed financing is on', inputs.financing.kind, 'on');
  check('mixed switch level', inputs.financing.level, 'deal_override');
  check('mixed ltv from policy', inputs.financing.ltv.level, 'investor_policy');
  check('mixed ltv value', inputs.financing.ltv.value, 0.70);
  check('mixed rate falls to starter', inputs.financing.rate.level, 'iaos_starter');
  check('mixed rate value', inputs.financing.rate.value, 0.12);
  check('mixed points from override', inputs.financing.points.level, 'deal_override');
  check('mixed points value', inputs.financing.points.value, 0.03);

  const r = computeUnderwriting(inputs);
  check('mixed financing computes', r.status, 'resolved');
  check('mixed provenance ltv', r.provenance.financingLtv, 'investor_policy');
  check('mixed provenance rate', r.provenance.financingRate, 'iaos_starter');
  check('mixed provenance points', r.provenance.financingPoints, 'deal_override');
  check('mixed provenance switch', r.provenance.financingEnabled, 'deal_override');
}

/* ---- 14. An unrecognized policy switch falls to the starter, not Off. ---- */
/* NOT a test that an unresolved switch blocks financing: no level can    */
/* currently produce false, and the starter is true, so that path is      */
/* unreachable. It becomes reachable when the OFF token is observed.      */
{
  const policy = parsePolicy(fullPolicyValues({ 'cv-fin-on': 'Off' }), CV_IDS).policy;
  const overrides = noOverrides();
  overrides.financingEnabled = { kind: 'unresolved', reason: 'none' };

  const facts = resolveDealFacts(
    parseOpportunityValues(
      [{ id: 'opp-arv', fieldValueNumber: 315000 },
       { id: 'opp-repairs', fieldValueNumber: 41000 },
       { id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds([], CONTACT_IDS));

  // Starter is true, so the switch resolves; this proves the terms do not
  // rescue an unresolved switch when one occurs.
  const inputs = resolveInputs(facts, overrides, policy);
  check('switch falls to starter when policy unrecognized', inputs.financing.kind, 'on');
  check('switch starter level', inputs.financing.level, 'iaos_starter');
}

/* ---- 15. End to end: resolver output reproduces the worked example. ---- */
{
  const policy = parsePolicy(fullPolicyValues(), CV_IDS).policy;
  const facts = resolveDealFacts(
    parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds(
      [{ id: 'c-arv', value: '315000' }, { id: 'c-repairs', value: '41000' }], CONTACT_IDS));
  const inputs = resolveInputs(facts, noOverrides(), policy);
  const r = computeUnderwriting(inputs);

  check('end-to-end resolved', r.status, 'resolved');
  check('end-to-end arv from contact seed', inputs.arv.value, 315000);
  check('end-to-end baseBuyerCapacity', r.figures.baseBuyerCapacity, 190250, 0.5);
  check('end-to-end financingFactor', r.figures.financingFactor, 0.049, 1e-9);
  check('end-to-end endBuyerMaxPrice', r.figures.endBuyerMaxPrice, 181363, 1);
  check('end-to-end assignmentSpread', r.figures.assignmentSpread, 5000);
  check('end-to-end sellerMAO', r.figures.sellerMAO, 176363, 1);
  check('end-to-end no warnings', r.warnings.length, 0);
}

/* ================================================================== */
/* View model -- page state interpretation                            */
/* ================================================================== */

const OPP = { id: 'opp-1', name: 'Main Street' };
const OPP2 = { id: 'opp-2', name: 'Oak Avenue' };

/** A resolved UnderwritingResult built through the real pipeline. */
function resolvedResult(over) {
  const policy = parsePolicy(fullPolicyValues(), CV_IDS).policy;
  const facts = resolveDealFacts(
    parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds(
      [{ id: 'c-arv', value: '315000' }, { id: 'c-repairs', value: '41000' }], CONTACT_IDS));
  return computeUnderwriting(resolveInputs(facts, noOverrides(), policy));
}

/** DealFacts with everything absent. Overridden per case. */
function emptyFacts(over) {
  return Object.assign({
    arv: { kind: 'unresolved', reason: 'absent' },
    repairs: { kind: 'unresolved', reason: 'absent' },
    askingPrice: null,
    assignmentMode: { kind: 'unresolved', reason: 'absent' },
    manualSpread: null,
  }, over || {});
}

/** DealFacts carrying the golden-path ARV and repairs. */
function goldenFacts(over) {
  return emptyFacts(Object.assign({
    arv: { kind: 'value', value: 315000 },
    repairs: { kind: 'value', value: 41000 },
    assignmentMode: { kind: 'value', value: 'standard', level: 'deal_override' },
  }, over || {}));
}

function vmInput(over) {
  return Object.assign({
    loading: false,
    fetchError: null,
    computeError: null,
    candidates: [OPP],
    selected: OPP,
    result: null,
    facts: goldenFacts(),
    issues: [],
  }, over || {});
}

/* ---- 16. Loading beats every other input. ---- */
{
  const s = toViewModel(vmInput({
    loading: true, fetchError: 'boom', candidates: [], selected: null,
  }));
  check('vm loading wins', s.state, 'loading');
}

/* ---- 17. Fetch error beats candidates and selection. ---- */
{
  const s = toViewModel(vmInput({ fetchError: 'network down' }));
  check('vm fetch_error state', s.state, 'fetch_error');
  check('vm fetch_error message', s.message, 'network down');
}

/* ---- 18. No candidates yields no_opportunity. ---- */
{
  const s = toViewModel(vmInput({ candidates: [], selected: null }));
  check('vm no_opportunity', s.state, 'no_opportunity');
}

/* ---- 19. Candidates with no selection yields awaiting_selection. ---- */
{
  const s = toViewModel(vmInput({ candidates: [OPP, OPP2], selected: null }));
  check('vm awaiting_selection', s.state, 'awaiting_selection');
  check('vm awaiting_selection candidates', s.candidates.length, 2);
}

/* ---- 20. ONE candidate with no selection is still awaiting_selection.
   The auto-select rule lives in the page, not here. This pins the page's
   obligation: if it ever stops auto-selecting, a selector for one item
   appears and this check is what says so. ---- */
{
  const s = toViewModel(vmInput({ candidates: [OPP], selected: null }));
  check('vm one candidate unselected is awaiting_selection', s.state, 'awaiting_selection');
  check('vm one candidate count', s.candidates.length, 1);
}

/* ---- 21. Selection precedes the compute-error branch. A compute error
   before selection means the page calculated early; awaiting_selection is
   the correct report. ---- */
{
  const s = toViewModel(vmInput({
    candidates: [OPP, OPP2], selected: null,
    computeError: { field: 'sellingCostPct', message: 'bad units' },
  }));
  check('vm selection precedes compute error', s.state, 'awaiting_selection');
}

/* ---- 22. Compute error after selection yields configuration_error. ---- */
{
  const s = toViewModel(vmInput({
    computeError: { field: 'sellingCostPct', message: 'violates units invariant' },
  }));
  check('vm configuration_error state', s.state, 'configuration_error');
  check('vm configuration_error field', s.field, 'sellingCostPct');
  check('vm configuration_error names opportunity', s.opportunity.id, 'opp-1');
}

/* ---- 23. Selected, no error, no result is an orchestration error --
   never a fetch error. A fetch may have succeeded perfectly. ---- */
{
  const s = toViewModel(vmInput({ result: null }));
  check('vm orchestration_error state', s.state, 'orchestration_error');
  check('vm orchestration_error is not fetch_error', s.state === 'fetch_error', false);
}

/* ---- 24. Unresolved result. ---- */
{
  const facts = resolveDealFacts(
    parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds([], CONTACT_IDS));
  const r = computeUnderwriting(
    resolveInputs(facts, noOverrides(), parsePolicy(fullPolicyValues(), CV_IDS).policy));
  const s = toViewModel(vmInput({ result: r, facts: emptyFacts() }));
  check('vm unresolved state', s.state, 'unresolved');
  check('vm unresolved names missing', s.missing.indexOf('arv') >= 0, true);
  check('vm unresolved names opportunity', s.opportunity.name, 'Main Street');
  check('vm unresolved labels are operator language', s.missingLabels.indexOf('ARV') >= 0, true);
  check('vm unresolved labels drop raw keys', s.missingLabels.indexOf('arv') >= 0, false);
}

/* ---- 24b. Known facts survive an unresolved calculation. The rail must
   not blank ARV and repairs in the exact state where the operator is
   being told what is missing. ---- */
{
  // ARV and repairs present, assignment mode absent -- the Neelima case.
  const facts = goldenFacts({ assignmentMode: { kind: 'unresolved', reason: 'not set' } });
  const policy = parsePolicy(fullPolicyValues(), CV_IDS).policy;
  const r = computeUnderwriting(resolveInputs(facts, noOverrides(), policy));
  const s = toViewModel(vmInput({ result: r, facts }));
  check('vm known-facts precondition is unresolved', s.state, 'unresolved');
  check('vm known arv survives unresolved', s.known.arv, 315000);
  check('vm known repairs survives unresolved', s.known.repairs, 41000);
  check('vm unresolved blocker is assignment mode', s.missing.indexOf('assignmentMode') >= 0, true);
  check('vm assignment mode label', s.missingLabels.indexOf('Assignment Mode') >= 0, true);
}

/* ---- 24c. An unmapped missing key falls back to its raw name rather
   than disappearing from the list. ---- */
{
  const r = { status: 'unresolved', missing: ['arv', 'somethingNew'] };
  const s = toViewModel(vmInput({ result: r, facts: emptyFacts() }));
  check('vm unmapped key count preserved', s.missingLabels.length, 2);
  check('vm unmapped key falls back raw', s.missingLabels.indexOf('somethingNew') >= 0, true);
}

/* ---- 25. Resolved with no asking price: position is asking_unknown. ---- */
{
  const s = toViewModel(vmInput({ result: resolvedResult() }));
  check('vm resolved state', s.state, 'resolved');
  check('vm resolved position unknown', s.position.position, 'asking_unknown');
  check('vm resolved sellerMAO', s.figures.sellerMAO, 176363, 1);
  check('vm resolved no warnings', s.warnings.length, 0);
  check('vm resolved known arv', s.known.arv, 315000);
  check('vm resolved known repairs', s.known.repairs, 41000);
}

/* ---- 26. Position is DERIVED from facts, not passed. Ask below MAO. ---- */
{
  const s = toViewModel(vmInput({
    result: resolvedResult(), facts: goldenFacts({ askingPrice: 170000 }),
  }));
  check('vm within_range', s.position.position, 'within_range');
  check('vm within_range cushion', s.position.acquisitionCushion, 6363, 1);
  check('vm within_range known ask', s.known.askingPrice, 170000);
}

/* ---- 27. Ask above MAO. ---- */
{
  const s = toViewModel(vmInput({
    result: resolvedResult(), facts: goldenFacts({ askingPrice: 180000 }),
  }));
  check('vm above_range', s.position.position, 'above_range');
  check('vm above_range gap', s.position.gapToUnderwriting, 3637, 1);
}

/* ---- 28. A non-finite asking price becomes configuration_error rather
   than throwing out of toViewModel. Every path returns a state. ---- */
{
  let threw = false;
  let s = null;
  try {
    s = toViewModel(vmInput({
      result: resolvedResult(), facts: goldenFacts({ askingPrice: NaN }),
    }));
  } catch (e) { threw = true; }
  check('vm NaN ask does not throw', threw, false);
  check('vm NaN ask is configuration_error', s === null ? '(threw)' : s.state, 'configuration_error');
  check('vm NaN ask names askingPrice', s === null ? '(threw)' : s.field, 'askingPrice');
}

/* ---- 29. Issues are a banner, never a state. Calculation status,
   acquisition position and policy warnings stay independent. ---- */
{
  const withIssue = parsePolicy(fullPolicyValues({ 'cv-carry': 'abc' }), CV_IDS);
  check('vm banner precondition: one issue', withIssue.issues.length, 1);

  const facts = resolveDealFacts(
    parseOpportunityValues([{ id: 'opp-mode', fieldValueString: 'Standard Minimum' }], OPP_IDS),
    parseContactSeeds(
      [{ id: 'c-arv', value: '315000' }, { id: 'c-repairs', value: '41000' }], CONTACT_IDS));
  const r = computeUnderwriting(resolveInputs(facts, noOverrides(), withIssue.policy));

  const s = toViewModel(vmInput({
    result: r, issues: withIssue.issues,
  }));
  check('vm issues still resolved', s.state, 'resolved');
  check('vm issues position unknown', s.position.position, 'asking_unknown');
  check('vm issues preserved on banner', s.banner.issues.length, 1);
  check('vm issues name the key', s.banner.issues[0].key, 'monthlyCarry');
  check('vm malformed carry fell through to starter', s.figures.baseBuyerCapacity, 190250, 0.5);
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
