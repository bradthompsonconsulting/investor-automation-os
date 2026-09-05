/**
 * Offer Readiness + evidence/trust state engine -- test runner. B8-04 / INV-47.
 *
 * Compiles offer-readiness.ts and its dependencies to a temp directory,
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
const TMP = path.join(APP, '.tmp-offer-readiness-test');
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

// SOURCES spans two directories, so tsc's outDir mirrors that structure --
// see test-board8-economics.cjs, which established the same layout.
const computePath = path.join(TMP, 'underwriting', 'compute.js');
const board8Path = path.join(TMP, 'underwriting', 'board8-economics.js');
const readinessPath = path.join(TMP, 'underwriting', 'offer-readiness.js');
for (const p of [computePath, board8Path, readinessPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeUnderwriting } = require(computePath);
const { computeBoard8Economics } = require(board8Path);
const { computeOfferReadiness } = require(readinessPath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 65;
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

// Same PB-D56 section IV starter policy fixture the other two harnesses use.
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
const UNAVAILABLE_ECONOMICS = computeBoard8Economics(computeUnderwriting(underwritingInputs({ arv: { kind: 'unresolved', reason: 'absent' } })));

const NONE = { kind: 'none' };

/** All six categories SUPPORTED (ARV via HIGH), no material unknowns, no human action. */
function fullySupportedInputs(over) {
  return Object.assign({
    propertyIdentity: 'SUPPORTED',
    repairsCondition: 'SUPPORTED',
    arv: 'HIGH',
    transactionAssumptions: 'SUPPORTED',
    sellerPricePosition: 'SUPPORTED',
    dealEconomics: GOLDEN_ECONOMICS,
    materialUnknowns: [],
    humanAction: NONE,
  }, over || {});
}

// ============================================================
// Validation item 1: same inputs always produce the same readiness
// result and reasons -- two independently constructed input objects.
// ============================================================
{
  const a = fullySupportedInputs();
  const b = JSON.parse(JSON.stringify(fullySupportedInputs())); // Board8Economics survives JSON round-trip: plain data, no functions
  const rA = computeOfferReadiness(a);
  const rB = computeOfferReadiness(b);
  check('determinism: identical inputs produce identical result', rA, rB);
}

// ============================================================
// Validation item 2: fully supported material inputs can produce
// OFFER READY.
// ============================================================
{
  const r = computeOfferReadiness(fullySupportedInputs());
  check('fully supported -> OFFER_READY', r.status, 'OFFER_READY');
  check('fully supported -> effectiveStatus OFFER_READY', r.effectiveStatus, 'OFFER_READY');
  check('fully supported -> no reasons', r.reasons.length, 0);
  check('fully supported -> arv category SUPPORTED', r.categories.arv, 'SUPPORTED');
  check('fully supported -> deal_economics category SUPPORTED', r.categories.deal_economics, 'SUPPORTED');
}

// ============================================================
// Validation item 3: UNKNOWN material evidence produces NOT READY.
// ============================================================
{
  const r = computeOfferReadiness(fullySupportedInputs({ sellerPricePosition: 'UNKNOWN' }));
  check('one UNKNOWN category -> NOT_READY', r.status, 'NOT_READY');
  check('one UNKNOWN category -> reason present', r.reasons.some((x) => x.kind === 'category' && x.category === 'seller_price_position' && x.level === 'UNKNOWN'), true);
}

// ============================================================
// Validation item 4: PRELIMINARY material evidence produces REVIEW
// NEEDED, never silently becoming SUPPORTED.
// ============================================================
{
  const r = computeOfferReadiness(fullySupportedInputs({ transactionAssumptions: 'PRELIMINARY' }));
  check('one PRELIMINARY category -> REVIEW_NEEDED', r.status, 'REVIEW_NEEDED');
  check('PRELIMINARY category value is not silently SUPPORTED', r.categories.transaction_assumptions, 'PRELIMINARY');
  check('one PRELIMINARY category -> reason present', r.reasons.some((x) => x.kind === 'category' && x.category === 'transaction_assumptions' && x.level === 'PRELIMINARY'), true);
}

// ============================================================
// Validation item 5: a calculated Target/Max can exist while readiness
// remains NOT_READY or REVIEW_NEEDED -- the core "calculated is not
// actionable" proof. GOLDEN_ECONOMICS is fully "calculated" (verified
// below), yet overall readiness is NOT_READY because one OTHER category
// is UNKNOWN.
// ============================================================
{
  check('setup: GOLDEN_ECONOMICS is calculated', GOLDEN_ECONOMICS.status, 'calculated');
  check('setup: GOLDEN_ECONOMICS target is calculated', GOLDEN_ECONOMICS.target.status, 'calculated');

  const r = computeOfferReadiness(fullySupportedInputs({ propertyIdentity: 'UNKNOWN' }));
  check('calculated economics + one UNKNOWN category -> NOT_READY', r.status, 'NOT_READY');
  check('calculated economics + one UNKNOWN category -> deal_economics category still SUPPORTED', r.categories.deal_economics, 'SUPPORTED');

  const r2 = computeOfferReadiness(fullySupportedInputs({ propertyIdentity: 'PRELIMINARY' }));
  check('calculated economics + one PRELIMINARY category -> REVIEW_NEEDED', r2.status, 'REVIEW_NEEDED');
}

// ============================================================
// Validation item 6: a new material fact can revoke prior OFFER_READY
// deterministically -- there is no cache to bust, only a new call.
// ============================================================
{
  const before = computeOfferReadiness(fullySupportedInputs());
  check('before new fact: OFFER_READY', before.status, 'OFFER_READY');

  const after = computeOfferReadiness(fullySupportedInputs({
    materialUnknowns: [{ code: 'UNDISCLOSED_LIEN', description: 'Seller mentioned a second lien not yet confirmed on title.' }],
  }));
  check('after new material fact: NOT_READY', after.status, 'NOT_READY');
  check('after new material fact: reason names it', after.reasons.some((x) => x.kind === 'material_unknown' && x.unknownCode === 'UNDISCLOSED_LIEN'), true);
}

// ============================================================
// Validation item 7 (corrected per Jess Gate, 2026-09-05): human
// APPROVED/OVERRIDDEN actions are distinguishable from evidence quality
// AND from each other. status/reasons stay what they objectively are.
// Only OVERRIDDEN may elevate effectiveStatus; APPROVED never does --
// it can only ever agree with an already-OFFER_READY status.
// ============================================================
{
  const notReadyInputs = fullySupportedInputs({ sellerPricePosition: 'UNKNOWN' });

  const noAction = computeOfferReadiness(notReadyInputs);
  check('no human action: status NOT_READY', noAction.status, 'NOT_READY');
  check('no human action: effectiveStatus equals status', noAction.effectiveStatus, noAction.status);

  const overridden = computeOfferReadiness(Object.assign({}, notReadyInputs, {
    humanAction: { kind: 'overridden', at: '2026-09-05T12:00:00.000Z', operator: 'Brad Thompson', reason: 'Seller price position confirmed verbally; proceeding.' },
  }));
  check('overridden: raw status UNCHANGED (still NOT_READY)', overridden.status, 'NOT_READY');
  check('overridden: reasons UNCHANGED (still present)', overridden.reasons.length > 0, true);
  check('overridden: effectiveStatus is OFFER_READY', overridden.effectiveStatus, 'OFFER_READY');
  check('overridden: humanAction carried through', overridden.humanAction.kind, 'overridden');
  check('overridden: status and effectiveStatus differ', overridden.status !== overridden.effectiveStatus, true);

  // APPROVED must NEVER elevate a non-ready objective status -- this is
  // the exact distinction Jess Gate found collapsed and required fixed.
  const approvedOnNotReady = computeOfferReadiness(Object.assign({}, notReadyInputs, {
    humanAction: { kind: 'approved', at: '2026-09-05T12:00:00.000Z', operator: 'Brad Thompson' },
  }));
  check('APPROVED cannot bypass UNKNOWN: raw status stays NOT_READY', approvedOnNotReady.status, 'NOT_READY');
  check('APPROVED cannot bypass UNKNOWN: effectiveStatus stays NOT_READY, NOT elevated', approvedOnNotReady.effectiveStatus, 'NOT_READY');
  check('APPROVED cannot bypass UNKNOWN: status equals effectiveStatus (no silent elevation)', approvedOnNotReady.status, approvedOnNotReady.effectiveStatus);
  check('APPROVED cannot bypass UNKNOWN: reasons still present', approvedOnNotReady.reasons.length > 0, true);

  // A human action attached to an ALREADY offer-ready result changes nothing observable.
  const alreadyReady = computeOfferReadiness(fullySupportedInputs({
    humanAction: { kind: 'approved', at: '2026-09-05T12:00:00.000Z', operator: 'Brad Thompson' },
  }));
  check('approved on already-ready deal: status still OFFER_READY', alreadyReady.status, 'OFFER_READY');
  check('approved on already-ready deal: effectiveStatus still OFFER_READY', alreadyReady.effectiveStatus, 'OFFER_READY');
}

// ============================================================
// Jess Gate correction, explicit proof set: APPROVED cannot bypass
// PRELIMINARY evidence, UNKNOWN evidence, or unresolved material
// unknowns -- each tested individually so no single case could pass by
// accident of the others.
// ============================================================
{
  const approvedAction = { kind: 'approved', at: '2026-09-05T18:00:00.000Z', operator: 'Brad Thompson' };

  // (a) PRELIMINARY evidence.
  const preliminaryInputs = fullySupportedInputs({ transactionAssumptions: 'PRELIMINARY' });
  const preliminaryNoAction = computeOfferReadiness(preliminaryInputs);
  check('setup: PRELIMINARY evidence alone -> REVIEW_NEEDED', preliminaryNoAction.status, 'REVIEW_NEEDED');
  const preliminaryApproved = computeOfferReadiness(Object.assign({}, preliminaryInputs, { humanAction: approvedAction }));
  check('APPROVED cannot bypass PRELIMINARY: status stays REVIEW_NEEDED', preliminaryApproved.status, 'REVIEW_NEEDED');
  check('APPROVED cannot bypass PRELIMINARY: effectiveStatus stays REVIEW_NEEDED', preliminaryApproved.effectiveStatus, 'REVIEW_NEEDED');

  // (b) UNKNOWN evidence.
  const unknownInputs = fullySupportedInputs({ repairsCondition: 'UNKNOWN' });
  const unknownNoAction = computeOfferReadiness(unknownInputs);
  check('setup: UNKNOWN evidence alone -> NOT_READY', unknownNoAction.status, 'NOT_READY');
  const unknownApproved = computeOfferReadiness(Object.assign({}, unknownInputs, { humanAction: approvedAction }));
  check('APPROVED cannot bypass UNKNOWN evidence: status stays NOT_READY', unknownApproved.status, 'NOT_READY');
  check('APPROVED cannot bypass UNKNOWN evidence: effectiveStatus stays NOT_READY', unknownApproved.effectiveStatus, 'NOT_READY');

  // (c) Unresolved material unknowns.
  const materialUnknownInputs = fullySupportedInputs({
    materialUnknowns: [{ code: 'TITLE_CLOUD', description: 'Possible unreleased lien found in a title search mentioned by the seller.' }],
  });
  const materialUnknownNoAction = computeOfferReadiness(materialUnknownInputs);
  check('setup: material unknown alone -> NOT_READY', materialUnknownNoAction.status, 'NOT_READY');
  const materialUnknownApproved = computeOfferReadiness(Object.assign({}, materialUnknownInputs, { humanAction: approvedAction }));
  check('APPROVED cannot bypass a material unknown: status stays NOT_READY', materialUnknownApproved.status, 'NOT_READY');
  check('APPROVED cannot bypass a material unknown: effectiveStatus stays NOT_READY', materialUnknownApproved.effectiveStatus, 'NOT_READY');
  check('APPROVED cannot bypass a material unknown: reason still names it', materialUnknownApproved.reasons.some((x) => x.kind === 'material_unknown' && x.unknownCode === 'TITLE_CLOUD'), true);

  // Contrast: OVERRIDDEN legitimately elevates all three of the above,
  // proving the distinction is in the action kind, not in some other
  // hidden condition.
  const overriddenAction = { kind: 'overridden', at: '2026-09-05T18:00:00.000Z', operator: 'Brad Thompson', reason: 'Proceeding at investor discretion.' };
  check('OVERRIDDEN elevates PRELIMINARY case', computeOfferReadiness(Object.assign({}, preliminaryInputs, { humanAction: overriddenAction })).effectiveStatus, 'OFFER_READY');
  check('OVERRIDDEN elevates UNKNOWN case', computeOfferReadiness(Object.assign({}, unknownInputs, { humanAction: overriddenAction })).effectiveStatus, 'OFFER_READY');
  check('OVERRIDDEN elevates material-unknown case', computeOfferReadiness(Object.assign({}, materialUnknownInputs, { humanAction: overriddenAction })).effectiveStatus, 'OFFER_READY');
}

// ============================================================
// Validation item 8: ARV mapping exactly follows HIGH/MODERATE ->
// SUPPORTED, LOW -> PRELIMINARY, INSUFFICIENT -> UNKNOWN.
// ============================================================
{
  check('ARV HIGH -> category SUPPORTED', computeOfferReadiness(fullySupportedInputs({ arv: 'HIGH' })).categories.arv, 'SUPPORTED');
  check('ARV MODERATE -> category SUPPORTED', computeOfferReadiness(fullySupportedInputs({ arv: 'MODERATE' })).categories.arv, 'SUPPORTED');
  check('ARV LOW -> category PRELIMINARY', computeOfferReadiness(fullySupportedInputs({ arv: 'LOW' })).categories.arv, 'PRELIMINARY');
  check('ARV INSUFFICIENT -> category UNKNOWN', computeOfferReadiness(fullySupportedInputs({ arv: 'INSUFFICIENT' })).categories.arv, 'UNKNOWN');
  check('ARV LOW -> overall REVIEW_NEEDED (not silently ready)', computeOfferReadiness(fullySupportedInputs({ arv: 'LOW' })).status, 'REVIEW_NEEDED');
  check('ARV INSUFFICIENT -> overall NOT_READY', computeOfferReadiness(fullySupportedInputs({ arv: 'INSUFFICIENT' })).status, 'NOT_READY');
}

// ============================================================
// Validation item 9: non-material seller facts do not become universal
// blockers. No category or mechanism here ever references motivation,
// timeline, mortgage balance, or title -- an empty materialUnknowns list
// reaches OFFER_READY even though none of those was ever supplied or
// addressed anywhere in the inputs.
// ============================================================
{
  const r = computeOfferReadiness(fullySupportedInputs({ materialUnknowns: [] }));
  check('empty materialUnknowns + all SUPPORTED -> OFFER_READY (no hidden checklist)', r.status, 'OFFER_READY');
}

// ============================================================
// Validation item 10: reasons identify the exact blocking/review
// condition rather than returning only a boolean.
// ============================================================
{
  const r = computeOfferReadiness(fullySupportedInputs({
    propertyIdentity: 'UNKNOWN',
    transactionAssumptions: 'PRELIMINARY',
    materialUnknowns: [{ code: 'BOUNDARY_DISPUTE', description: 'Neighbor disputes the rear property line.' }],
  }));
  check('multi-blocker: exactly three reasons', r.reasons.length, 3);
  check('multi-blocker: property_identity UNKNOWN reason code', r.reasons.some((x) => x.kind === 'category' && x.code === 'PROPERTY_IDENTITY_UNKNOWN'), true);
  check('multi-blocker: transaction_assumptions PRELIMINARY reason code', r.reasons.some((x) => x.kind === 'category' && x.code === 'TRANSACTION_ASSUMPTIONS_PRELIMINARY'), true);
  check('multi-blocker: material unknown reason names its own code', r.reasons.some((x) => x.kind === 'material_unknown' && x.unknownCode === 'BOUNDARY_DISPUTE'), true);
  check('multi-blocker: material unknown message includes description', r.reasons.find((x) => x.kind === 'material_unknown').message.indexOf('rear property line') >= 0, true);
}

// ============================================================
// Validation item 11: B8-03 economics are consumed/referenced rather
// than recomputed. Structural proof (the source never imports or calls
// the underwriting compute path) plus a behavioral proof (an
// independently-hand-built Board8Economics object, never produced by
// computeUnderwriting at all, is read correctly).
// ============================================================
{
  const src = fs.readFileSync(path.join(UW, 'offer-readiness.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./compute"') === -1 && src.indexOf("'./compute'") === -1, true);
  check('source does not call computeUnderwriting', src.indexOf('computeUnderwriting') === -1, true);

  const handBuiltEconomics = {
    status: 'calculated',
    endBuyerMaxPrice: 999999,
    requiredBuyerProfit: 1,
    maxSupportedOffer: 2,
    standardMinimumAssignmentSpread: 3,
    standardMinimumLevel: 'deal_override',
    target: { status: 'unavailable', reason: 'hand-built fixture, no share pct' },
  };
  const r = computeOfferReadiness(fullySupportedInputs({ dealEconomics: handBuiltEconomics }));
  check('hand-built Board8Economics is read, not recomputed (PRELIMINARY)', r.categories.deal_economics, 'PRELIMINARY');
}

// ============================================================
// Validation item 12: no hidden fallback converts UNKNOWN or missing
// evidence into SUPPORTED.
// ============================================================
{
  check('arv: null (never run) -> UNKNOWN, never SUPPORTED', computeOfferReadiness(fullySupportedInputs({ arv: null })).categories.arv, 'UNKNOWN');

  const allUnknown = computeOfferReadiness({
    propertyIdentity: 'UNKNOWN',
    repairsCondition: 'UNKNOWN',
    arv: null,
    transactionAssumptions: 'UNKNOWN',
    sellerPricePosition: 'UNKNOWN',
    dealEconomics: UNAVAILABLE_ECONOMICS,
    materialUnknowns: [],
    humanAction: NONE,
  });
  check('all UNKNOWN -> NOT_READY, never upgraded', allUnknown.status, 'NOT_READY');
  check('all UNKNOWN -> six reasons, one per category', allUnknown.reasons.length, 6);
  check('UNAVAILABLE_ECONOMICS -> deal_economics category UNKNOWN', allUnknown.categories.deal_economics, 'UNKNOWN');
}

// ============================================================
// Validation item 13: no Production mutation or speculative carrier
// creation. Structural proof: the module contains no GHL client, no
// network call, no fetch, no field id, no note-ledger writer.
// ============================================================
{
  const src = fs.readFileSync(path.join(UW, 'offer-readiness.ts'), 'utf8');
  const forbidden = ['fetch(', 'XMLHttpRequest', 'ghl.', 'PROXY', 'customFields', 'setApprovedArv', 'setEstimatedRepairs', 'process.env', '.notes.create'];
  const found = forbidden.filter((token) => src.indexOf(token) !== -1);
  check('module contains no network/GHL/carrier-writing surface', found, []);
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
