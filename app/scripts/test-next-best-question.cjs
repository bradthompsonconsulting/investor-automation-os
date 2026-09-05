/**
 * Adaptive Next Best Question / MSK guidance -- test runner. B8-06 / INV-49.
 *
 * Compiles next-best-question.ts and its dependencies to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no AI call, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-next-best-question-test');
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
  path.join(UW, 'next-best-question.ts'),
  path.join(LIB, 'arv-reconciliation.ts'),
  path.join(LIB, 'comp-classification.ts'),
  path.join(LIB, 'propstream-comp-csv.ts'),
];

try {
  execSync(
    'npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') +
    ' --outDir "' + TMP + '" --module commonjs --target es2020 --strict --removeComments',
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
const nbqPath = path.join(TMP, 'underwriting', 'next-best-question.js');
for (const p of [computePath, board8Path, readinessPath, nbqPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeUnderwriting } = require(computePath);
const { computeBoard8Economics } = require(board8Path);
const { computeOfferReadiness } = require(readinessPath);
const { computeNextBestQuestion, CATEGORY_PRIORITY } = require(nbqPath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 38;
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
const UNAVAILABLE_ECONOMICS = computeBoard8Economics(computeUnderwriting(underwritingInputs({ arv: { kind: 'unresolved', reason: 'absent' } })));
const NONE = { kind: 'none' };
const NO_FACTS = { arv: null, repairs: null, askingPrice: null };

function fullySupportedReadinessInputs(over) {
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
// Validation: stop asking underwriting questions at Offer Ready.
// ============================================================
{
  const readiness = computeOfferReadiness(fullySupportedReadinessInputs());
  check('setup: fully supported -> OFFER_READY', readiness.status, 'OFFER_READY');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS);
  check('Offer Ready -> kind is offer_ready', nbq.kind, 'offer_ready');
  check('Offer Ready message names it explicitly', nbq.message.indexOf('Offer Ready') === 0, true);
}

// ============================================================
// Validation: OVERRIDDEN also stops asking, gated on effectiveStatus.
// ============================================================
{
  const readiness = computeOfferReadiness(fullySupportedReadinessInputs({
    propertyIdentity: 'UNKNOWN',
    humanAction: { kind: 'overridden', at: '2026-09-05T12:00:00.000Z', operator: 'Brad Thompson', reason: 'Proceeding at investor discretion.' },
  }));
  check('setup: raw status stays NOT_READY under override', readiness.status, 'NOT_READY');
  check('setup: effectiveStatus is OFFER_READY under override', readiness.effectiveStatus, 'OFFER_READY');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS);
  check('overridden -> no further question, gated on effectiveStatus not raw status', nbq.kind, 'offer_ready');
}

// ============================================================
// Validation: APPROVED on a non-ready deal does NOT stop questions
// (APPROVED never elevates effectiveStatus per B8-04's own corrected rule).
// ============================================================
{
  const readiness = computeOfferReadiness(fullySupportedReadinessInputs({
    propertyIdentity: 'UNKNOWN',
    humanAction: { kind: 'approved', at: '2026-09-05T12:00:00.000Z', operator: 'Brad Thompson' },
  }));
  check('setup: APPROVED does not elevate effectiveStatus', readiness.effectiveStatus, 'NOT_READY');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS);
  check('APPROVED on a non-ready deal still asks a question', nbq.kind, 'question');
}

// ============================================================
// Validation: correct single next knowledge objective, one UNKNOWN
// category, with a plain-English "why it matters."
// ============================================================
{
  const readiness = computeOfferReadiness(fullySupportedReadinessInputs({ sellerPricePosition: 'UNKNOWN' }));
  const nbq = computeNextBestQuestion(readiness, NO_FACTS);
  check('single UNKNOWN category -> question kind', nbq.kind, 'question');
  check('single UNKNOWN category -> correct category selected', nbq.source, { kind: 'category', category: 'seller_price_position', level: 'UNKNOWN' });
  check('question text asks about seller price position', nbq.question.toLowerCase().indexOf('seller') >= 0, true);
  check('whyItMatters is a non-empty plain-English explanation', typeof nbq.whyItMatters === 'string' && nbq.whyItMatters.length > 20, true);
}

// ============================================================
// Validation: priority order among multiple UNKNOWN categories follows
// CATEGORY_PRIORITY (the contract's own listed order), not script/alpha
// order. property_identity (first in priority) beats seller_price_position
// (last), regardless of which was set second.
// ============================================================
{
  const readinessA = computeOfferReadiness(fullySupportedReadinessInputs({ propertyIdentity: 'UNKNOWN', sellerPricePosition: 'UNKNOWN' }));
  const nbqA = computeNextBestQuestion(readinessA, NO_FACTS);
  check('multiple UNKNOWN: property_identity (higher priority) wins over seller_price_position', nbqA.source.category, 'property_identity');

  // Same two categories UNKNOWN, readiness recomputed with the OTHER
  // fields changed first -- proves the result depends only on CURRENT
  // state, never on which fact was resolved/discovered in which order
  // (nonlinear conversation support).
  const readinessB = computeOfferReadiness(fullySupportedReadinessInputs({ sellerPricePosition: 'UNKNOWN', propertyIdentity: 'UNKNOWN', repairsCondition: 'SUPPORTED', arv: 'HIGH' }));
  const nbqB = computeNextBestQuestion(readinessB, NO_FACTS);
  check('order-of-construction independence: same result regardless of field order', nbqB.source.category, nbqA.source.category);
}

// ============================================================
// Validation: material unknown outranks every category, including
// UNKNOWN ones -- the strongest tier per the contract's own words.
// ============================================================
{
  const readiness = computeOfferReadiness(fullySupportedReadinessInputs({
    propertyIdentity: 'UNKNOWN',
    materialUnknowns: [{ code: 'TITLE_CLOUD', description: 'Possible unreleased lien mentioned by the seller.' }],
  }));
  const nbq = computeNextBestQuestion(readiness, NO_FACTS);
  check('material unknown outranks an UNKNOWN category', nbq.source, { kind: 'material_unknown', unknownCode: 'TITLE_CLOUD' });
  check('material unknown question surfaces the description, not the raw reason string', nbq.question, 'Resolve before continuing: Possible unreleased lien mentioned by the seller.');
}

// ============================================================
// Validation: PRELIMINARY tier only reached when no UNKNOWN/material
// unknown exists; same priority order applies within it.
// ============================================================
{
  const readiness = computeOfferReadiness(fullySupportedReadinessInputs({ transactionAssumptions: 'PRELIMINARY', sellerPricePosition: 'PRELIMINARY' }));
  check('setup: PRELIMINARY-only -> REVIEW_NEEDED', readiness.status, 'REVIEW_NEEDED');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS);
  check('PRELIMINARY tier: earlier-priority category wins (transaction_assumptions over seller_price_position)', nbq.source, { kind: 'category', category: 'transaction_assumptions', level: 'PRELIMINARY' });
}

// ============================================================
// Validation: never re-asks a fact already known -- question text
// acknowledges the known raw ARV/repairs number instead of asking for
// it from scratch.
// ============================================================
{
  const readinessNoFacts = computeOfferReadiness(fullySupportedReadinessInputs({ arv: 'INSUFFICIENT' }));
  const nbqNoFacts = computeNextBestQuestion(readinessNoFacts, NO_FACTS);
  check('ARV UNKNOWN, no raw ARV on file -> asks whether a valuation has been run', nbqNoFacts.question, 'Has a valuation (ARV) been run for this property yet?');

  const nbqWithFact = computeNextBestQuestion(readinessNoFacts, { arv: 250000, repairs: null, askingPrice: null });
  check('ARV UNKNOWN, raw ARV already on file -> acknowledges it instead of re-asking from zero', nbqWithFact.question, 'Confirm the $250,000 ARV on file is still current and comp-supported.');
  check('never re-asks: the two phrasings differ', nbqNoFacts.question !== nbqWithFact.question, true);

  const readinessRepairsUnknown = computeOfferReadiness(fullySupportedReadinessInputs({ repairsCondition: 'UNKNOWN' }));
  const nbqRepairsNoFact = computeNextBestQuestion(readinessRepairsUnknown, NO_FACTS);
  check('repairs UNKNOWN, no raw repairs on file -> generic condition question', nbqRepairsNoFact.question, 'Walk through the property\'s condition — roof, HVAC, foundation, recent updates.');
  const nbqRepairsWithFact = computeNextBestQuestion(readinessRepairsUnknown, { arv: null, repairs: 41000, askingPrice: null });
  check('repairs UNKNOWN, raw repairs already on file -> confirms the number instead of re-asking', nbqRepairsWithFact.question, 'Walk the property\'s condition to confirm the $41,000 repair estimate on file is defensible.');
}

// ============================================================
// Validation: responds correctly to a newly discovered material fact --
// a fully offer-ready deal becomes NOT_READY and re-asks the instant a
// material unknown appears, with no cache to invalidate.
// ============================================================
{
  const before = computeNextBestQuestion(computeOfferReadiness(fullySupportedReadinessInputs()), NO_FACTS);
  check('before new fact: offer_ready', before.kind, 'offer_ready');

  const after = computeNextBestQuestion(
    computeOfferReadiness(fullySupportedReadinessInputs({
      materialUnknowns: [{ code: 'UNDISCLOSED_LIEN', description: 'Second lien surfaced mid-call.' }],
    })),
    NO_FACTS,
  );
  check('after new material fact: question kind, no longer offer_ready', after.kind, 'question');
  check('after new material fact: names the exact new fact', after.source, { kind: 'material_unknown', unknownCode: 'UNDISCLOSED_LIEN' });
}

// ============================================================
// Validation: deal_economics category, both levels, exercised directly
// (UNKNOWN via unavailable B8-03 output; PRELIMINARY via a hand-built
// fixture mirroring board8-economics.ts's one synthetic case).
// ============================================================
{
  const readinessUnavailable = computeOfferReadiness(fullySupportedReadinessInputs({ dealEconomics: UNAVAILABLE_ECONOMICS }));
  check('setup: unavailable economics -> deal_economics category UNKNOWN', readinessUnavailable.categories.deal_economics, 'UNKNOWN');
  const nbqUnavailable = computeNextBestQuestion(readinessUnavailable, NO_FACTS);
  check('deal_economics UNKNOWN -> Gate 1 question', nbqUnavailable.question, 'Get ARV and repairs on file — underwriting cannot calculate anything until both are present.');

  const handBuiltPartialEconomics = {
    status: 'calculated', endBuyerMaxPrice: 181363, requiredBuyerProfit: 47250,
    maxSupportedOffer: 176363, standardMinimumAssignmentSpread: 5000, standardMinimumLevel: 'iaos_starter',
    target: { status: 'unavailable', reason: 'hand-built fixture, no share pct' },
  };
  const readinessPartial = computeOfferReadiness(fullySupportedReadinessInputs({ dealEconomics: handBuiltPartialEconomics }));
  check('setup: partial economics -> deal_economics category PRELIMINARY', readinessPartial.categories.deal_economics, 'PRELIMINARY');
  const nbqPartial = computeNextBestQuestion(readinessPartial, NO_FACTS);
  check('deal_economics PRELIMINARY -> names the specific policy gap', nbqPartial.question.indexOf('Buyer Profit Share Percentage') >= 0, true);
}

// ============================================================
// Determinism: identical inputs, called twice, produce byte-identical
// results.
// ============================================================
{
  const readiness = computeOfferReadiness(fullySupportedReadinessInputs({ arv: 'LOW' }));
  const first = computeNextBestQuestion(readiness, { arv: 250000, repairs: 41000, askingPrice: 260000 });
  const second = computeNextBestQuestion(JSON.parse(JSON.stringify(readiness)), { arv: 250000, repairs: 41000, askingPrice: 260000 });
  check('determinism: identical inputs produce identical NextBestQuestion', first, second);
}

// ============================================================
// CATEGORY_PRIORITY matches the contract's own listed order exactly.
// ============================================================
{
  check('CATEGORY_PRIORITY matches DEAL_ECONOMICS_OFFER_READINESS_V1.md verbatim', CATEGORY_PRIORITY, [
    'property_identity', 'repairs_condition', 'arv', 'deal_economics', 'transaction_assumptions', 'seller_price_position',
  ]);
}

// ============================================================
// Structural proof: no second readiness/economics engine, and no
// motivation/timeline blocking language anywhere in the COMPILED output.
// Compiled with --removeComments (TypeScript keeps comments by default),
// so this checks runtime strings only, not the documentation prose above
// that correctly explains the exclusion.
// ============================================================
{
  const src = fs.readFileSync(path.join(UW, 'next-best-question.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./compute"') === -1, true);
  check('source does not call computeUnderwriting', src.indexOf('computeUnderwriting') === -1, true);
  check('source does not import board8-economics (no economics recomputation surface)', src.indexOf('board8-economics') === -1, true);
  check('source does not declare its own computeOfferReadiness', /\b(function|const)\s+computeOfferReadiness\s*[=(]/.test(src.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);

  const compiled = fs.readFileSync(nbqPath, 'utf8').toLowerCase();
  check('compiled output contains no "motivation" runtime string', compiled.indexOf('motivation') === -1, true);
  check('compiled output contains no "timeline" runtime string', compiled.indexOf('timeline') === -1, true);
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
