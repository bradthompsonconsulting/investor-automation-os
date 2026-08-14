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
    '" "' + path.join(SRC, 'resolver.ts') +
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

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 87;

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
