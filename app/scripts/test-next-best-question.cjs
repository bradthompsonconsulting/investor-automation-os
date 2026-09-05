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
const FLOOR = 54;
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

/** True/false check with a plain boolean expectation, for readability at call sites that assert a predicate. */
function checkTrue(name, actual) { check(name, actual, true); }

const V = (v, level) => ({ kind: 'value', value: v, level: level || 'iaos_starter' });
const D = (v) => ({ kind: 'value', value: v });
const U = (reason) => ({ kind: 'unresolved', reason: reason || 'absent' });

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
const UNAVAILABLE_ECONOMICS_ARV_ONLY = computeBoard8Economics(computeUnderwriting(underwritingInputs({ arv: U() })));
const UNAVAILABLE_ECONOMICS_REPAIRS_ONLY = computeBoard8Economics(computeUnderwriting(underwritingInputs({ repairs: U() })));
const UNAVAILABLE_ECONOMICS_BOTH = computeBoard8Economics(computeUnderwriting(underwritingInputs({ arv: U(), repairs: U() })));
// Gate 1 (arv, repairs) fully present and supported; a DIFFERENT, non-Gate-1
// input (sellingCostPct) is what's actually unresolved. This is exactly the
// case Jess Gate named: ARV/repairs must NOT be blamed here.
const UNAVAILABLE_ECONOMICS_NON_GATE1 = computeBoard8Economics(computeUnderwriting(underwritingInputs({ sellingCostPct: U() })));
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

/** Builds both the ReadinessResult and the dealEconomics object the SAME inputs used, since the page passes both to computeNextBestQuestion separately. */
function readinessAndEconomics(over) {
  const inputs = fullySupportedReadinessInputs(over);
  return { readiness: computeOfferReadiness(inputs), dealEconomics: inputs.dealEconomics };
}

// ============================================================
// Validation: stop asking underwriting questions at Offer Ready.
// ============================================================
{
  const { readiness, dealEconomics } = readinessAndEconomics();
  check('setup: fully supported -> OFFER_READY', readiness.status, 'OFFER_READY');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
  check('Offer Ready -> kind is offer_ready', nbq.kind, 'offer_ready');
  check('Offer Ready message names it explicitly', nbq.message.indexOf('Offer Ready') === 0, true);
}

// ============================================================
// Validation: OVERRIDDEN also stops asking, gated on effectiveStatus.
// ============================================================
{
  const { readiness, dealEconomics } = readinessAndEconomics({
    propertyIdentity: 'UNKNOWN',
    humanAction: { kind: 'overridden', at: '2026-09-05T12:00:00.000Z', operator: 'Brad Thompson', reason: 'Proceeding at investor discretion.' },
  });
  check('setup: raw status stays NOT_READY under override', readiness.status, 'NOT_READY');
  check('setup: effectiveStatus is OFFER_READY under override', readiness.effectiveStatus, 'OFFER_READY');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
  check('overridden -> no further question, gated on effectiveStatus not raw status', nbq.kind, 'offer_ready');
}

// ============================================================
// Validation: APPROVED on a non-ready deal does NOT stop questions
// (APPROVED never elevates effectiveStatus per B8-04's own corrected rule).
// ============================================================
{
  const { readiness, dealEconomics } = readinessAndEconomics({
    propertyIdentity: 'UNKNOWN',
    humanAction: { kind: 'approved', at: '2026-09-05T12:00:00.000Z', operator: 'Brad Thompson' },
  });
  check('setup: APPROVED does not elevate effectiveStatus', readiness.effectiveStatus, 'NOT_READY');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
  check('APPROVED on a non-ready deal still asks a question', nbq.kind, 'question');
}

// ============================================================
// Validation: correct single next knowledge objective, one UNKNOWN
// category, with a plain-English "why it matters."
// ============================================================
{
  const { readiness, dealEconomics } = readinessAndEconomics({ sellerPricePosition: 'UNKNOWN' });
  const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
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
  const { readiness: readinessA, dealEconomics: dealEconomicsA } = readinessAndEconomics({ propertyIdentity: 'UNKNOWN', sellerPricePosition: 'UNKNOWN' });
  const nbqA = computeNextBestQuestion(readinessA, NO_FACTS, dealEconomicsA);
  check('multiple UNKNOWN: property_identity (higher priority) wins over seller_price_position', nbqA.source.category, 'property_identity');

  // Same two categories UNKNOWN, readiness recomputed with the OTHER
  // fields changed first -- proves the result depends only on CURRENT
  // state, never on which fact was resolved/discovered in which order
  // (nonlinear conversation support).
  const { readiness: readinessB, dealEconomics: dealEconomicsB } = readinessAndEconomics({ sellerPricePosition: 'UNKNOWN', propertyIdentity: 'UNKNOWN', repairsCondition: 'SUPPORTED', arv: 'HIGH' });
  const nbqB = computeNextBestQuestion(readinessB, NO_FACTS, dealEconomicsB);
  check('order-of-construction independence: same result regardless of field order', nbqB.source.category, nbqA.source.category);
}

// ============================================================
// Validation: material unknown outranks every category, including
// UNKNOWN ones -- the strongest tier per the contract's own words.
// ============================================================
{
  const { readiness, dealEconomics } = readinessAndEconomics({
    propertyIdentity: 'UNKNOWN',
    materialUnknowns: [{ code: 'TITLE_CLOUD', description: 'Possible unreleased lien mentioned by the seller.' }],
  });
  const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
  check('material unknown outranks an UNKNOWN category', nbq.source, { kind: 'material_unknown', unknownCode: 'TITLE_CLOUD' });
  check('material unknown question surfaces the description, not the raw reason string', nbq.question, "What's the current status of this — Possible unreleased lien mentioned by the seller?");
}

// ============================================================
// Validation: PRELIMINARY tier only reached when no UNKNOWN/material
// unknown exists; same priority order applies within it.
// ============================================================
{
  const { readiness, dealEconomics } = readinessAndEconomics({ transactionAssumptions: 'PRELIMINARY', sellerPricePosition: 'PRELIMINARY' });
  check('setup: PRELIMINARY-only -> REVIEW_NEEDED', readiness.status, 'REVIEW_NEEDED');
  const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
  check('PRELIMINARY tier: earlier-priority category wins (transaction_assumptions over seller_price_position)', nbq.source, { kind: 'category', category: 'transaction_assumptions', level: 'PRELIMINARY' });
}

// ============================================================
// Validation: never re-asks a fact already known -- question text
// acknowledges the known raw ARV/repairs number instead of asking for
// it from scratch.
// ============================================================
{
  const { readiness: readinessArv, dealEconomics: dealEconomicsArv } = readinessAndEconomics({ arv: 'INSUFFICIENT' });
  const nbqNoFacts = computeNextBestQuestion(readinessArv, NO_FACTS, dealEconomicsArv);
  check('ARV UNKNOWN, no raw ARV on file -> asks whether a valuation has been run', nbqNoFacts.question, 'Has a valuation (ARV) been run for this property yet?');

  const nbqWithFact = computeNextBestQuestion(readinessArv, { arv: 250000, repairs: null, askingPrice: null }, dealEconomicsArv);
  check('ARV UNKNOWN, raw ARV already on file -> acknowledges it instead of re-asking from zero', nbqWithFact.question, 'Is the $250,000 ARV on file still current and comp-supported?');
  check('never re-asks: the two phrasings differ', nbqNoFacts.question !== nbqWithFact.question, true);

  const { readiness: readinessRepairs, dealEconomics: dealEconomicsRepairs } = readinessAndEconomics({ repairsCondition: 'UNKNOWN' });
  const nbqRepairsNoFact = computeNextBestQuestion(readinessRepairs, NO_FACTS, dealEconomicsRepairs);
  check('repairs UNKNOWN, no raw repairs on file -> generic condition question', nbqRepairsNoFact.question, "What is the property's condition — roof, HVAC, foundation, recent updates?");
  const nbqRepairsWithFact = computeNextBestQuestion(readinessRepairs, { arv: null, repairs: 41000, askingPrice: null }, dealEconomicsRepairs);
  check('repairs UNKNOWN, raw repairs already on file -> confirms the number instead of re-asking', nbqRepairsWithFact.question, "Is the $41,000 repair estimate already on file still accurate for this property's condition?");
}

// ============================================================
// Validation: responds correctly to a newly discovered material fact --
// a fully offer-ready deal becomes NOT_READY and re-asks the instant a
// material unknown appears, with no cache to invalidate.
// ============================================================
{
  const { readiness: readinessBefore, dealEconomics: dealEconomicsBefore } = readinessAndEconomics();
  const before = computeNextBestQuestion(readinessBefore, NO_FACTS, dealEconomicsBefore);
  check('before new fact: offer_ready', before.kind, 'offer_ready');

  const { readiness: readinessAfter, dealEconomics: dealEconomicsAfter } = readinessAndEconomics({
    materialUnknowns: [{ code: 'UNDISCLOSED_LIEN', description: 'Second lien surfaced mid-call.' }],
  });
  const after = computeNextBestQuestion(readinessAfter, NO_FACTS, dealEconomicsAfter);
  check('after new material fact: question kind, no longer offer_ready', after.kind, 'question');
  check('after new material fact: names the exact new fact', after.source, { kind: 'material_unknown', unknownCode: 'UNDISCLOSED_LIEN' });
}

// ============================================================
// Jess Gate correction 2: deal_economics UNKNOWN must use B8-03's own
// authoritative `missing` list, never assume ARV/repairs are the cause.
// ============================================================
{
  // (a) Pure Gate 1: both arv and repairs genuinely missing.
  const { readiness: rBoth, dealEconomics: eBoth } = readinessAndEconomics({ dealEconomics: UNAVAILABLE_ECONOMICS_BOTH });
  check('setup: both arv+repairs missing -> deal_economics UNKNOWN', rBoth.categories.deal_economics, 'UNKNOWN');
  check('setup: missing list is exactly arv+repairs', eBoth.missing.slice().sort(), ['arv', 'repairs']);
  const nbqBoth = computeNextBestQuestion(rBoth, NO_FACTS, eBoth);
  check('Gate 1, both missing -> names both, truthfully', nbqBoth.question, 'Has a current ARV and repair estimate been established for this property yet?');

  // (b) Pure Gate 1: only arv missing.
  const { readiness: rArv, dealEconomics: eArv } = readinessAndEconomics({ dealEconomics: UNAVAILABLE_ECONOMICS_ARV_ONLY });
  const nbqArvOnly = computeNextBestQuestion(rArv, NO_FACTS, eArv);
  check('Gate 1, arv only missing -> names only ARV', nbqArvOnly.question, 'Has a current ARV been established for this property yet?');

  // (c) Pure Gate 1: only repairs missing.
  const { readiness: rRepairs, dealEconomics: eRepairs } = readinessAndEconomics({ dealEconomics: UNAVAILABLE_ECONOMICS_REPAIRS_ONLY });
  const nbqRepairsOnly = computeNextBestQuestion(rRepairs, NO_FACTS, eRepairs);
  check('Gate 1, repairs only missing -> names only repairs', nbqRepairsOnly.question, 'Has a repair estimate been established for this property yet?');

  // (d) THE EXACT CASE JESS GATE NAMED: ARV and repairs are BOTH present
  // and supported; a different input (sellingCostPct) is what's actually
  // unresolved. The question must NOT claim ARV/repairs are missing.
  check('setup: non-Gate-1 case -- missing is sellingCostPct only, NOT arv/repairs', UNAVAILABLE_ECONOMICS_NON_GATE1.missing, ['sellingCostPct']);
  const { readiness: rNonGate1, dealEconomics: eNonGate1 } = readinessAndEconomics({ dealEconomics: UNAVAILABLE_ECONOMICS_NON_GATE1 });
  check('setup: non-Gate-1 case -> deal_economics category is still UNKNOWN', rNonGate1.categories.deal_economics, 'UNKNOWN');
  const nbqNonGate1 = computeNextBestQuestion(rNonGate1, NO_FACTS, eNonGate1);
  checkTrue('non-Gate-1 case: question does NOT falsely claim ARV is missing', nbqNonGate1.question.indexOf('ARV') === -1);
  checkTrue('non-Gate-1 case: question does NOT falsely claim repairs are missing', nbqNonGate1.question.toLowerCase().indexOf('repair') === -1);
  checkTrue('non-Gate-1 case: question does NOT use the old blanket Gate-1 phrasing', nbqNonGate1.question.indexOf('Get ARV and repairs on file') === -1);
  check('non-Gate-1 case: question truthfully names the actual missing input', nbqNonGate1.question, 'Underwriting is still missing the selling cost percentage — is that information available?');
  checkTrue('non-Gate-1 case: whyItMatters does not hardcode the Gate 1 diagnosis alone', nbqNonGate1.whyItMatters.indexOf('not only ARV and repairs') !== -1);
}

// ============================================================
// deal_economics PRELIMINARY -- quotes B8-03's own target.reason rather
// than hardcoding the one cause that happens to be the only one today.
// ============================================================
{
  const handBuiltPartialEconomics = {
    status: 'calculated', endBuyerMaxPrice: 181363, requiredBuyerProfit: 47250,
    maxSupportedOffer: 176363, standardMinimumAssignmentSpread: 5000, standardMinimumLevel: 'iaos_starter',
    target: { status: 'unavailable', reason: 'hand-built fixture, no share pct' },
  };
  const { readiness: readinessPartial, dealEconomics: dealEconomicsPartial } = readinessAndEconomics({ dealEconomics: handBuiltPartialEconomics });
  check('setup: partial economics -> deal_economics category PRELIMINARY', readinessPartial.categories.deal_economics, 'PRELIMINARY');
  const nbqPartial = computeNextBestQuestion(readinessPartial, NO_FACTS, dealEconomicsPartial);
  checkTrue('deal_economics PRELIMINARY -> question quotes B8-03s own target.reason verbatim', nbqPartial.question.indexOf('hand-built fixture, no share pct') !== -1);
  checkTrue('deal_economics PRELIMINARY -> whyItMatters quotes the same reason, not a hardcoded guess', nbqPartial.whyItMatters.indexOf('hand-built fixture, no share pct') !== -1);

  // A DIFFERENT reason string produces a DIFFERENT question -- proves this
  // is read from the object, not a hardcoded Buyer-Profit-Share guess.
  const differentReasonEconomics = Object.assign({}, handBuiltPartialEconomics, { target: { status: 'unavailable', reason: 'a completely different future cause' } });
  const { readiness: readinessDifferent, dealEconomics: dealEconomicsDifferent } = readinessAndEconomics({ dealEconomics: differentReasonEconomics });
  const nbqDifferent = computeNextBestQuestion(readinessDifferent, NO_FACTS, dealEconomicsDifferent);
  checkTrue('deal_economics PRELIMINARY -> a different B8-03 reason produces a different question', nbqDifferent.question !== nbqPartial.question);
  checkTrue('deal_economics PRELIMINARY -> the different reason is quoted verbatim, not the old Buyer Profit Share hardcode', nbqDifferent.question.indexOf('a completely different future cause') !== -1);
}

// ============================================================
// Determinism: identical inputs, called twice, produce byte-identical
// results.
// ============================================================
{
  const { readiness, dealEconomics } = readinessAndEconomics({ arv: 'LOW' });
  const facts = { arv: 250000, repairs: 41000, askingPrice: 260000 };
  const first = computeNextBestQuestion(readiness, facts, dealEconomics);
  const second = computeNextBestQuestion(JSON.parse(JSON.stringify(readiness)), facts, JSON.parse(JSON.stringify(dealEconomics)));
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
// that correctly explains the exclusion. Importing Board8Economics as a
// TYPE (for the diagnostic dealEconomicsDiagnosis, per this correction)
// is expected and fine; calling computeBoard8Economics would not be.
// ============================================================
{
  const src = fs.readFileSync(path.join(UW, 'next-best-question.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./compute"') === -1, true);
  check('source does not call computeUnderwriting', src.indexOf('computeUnderwriting') === -1, true);
  check('source does not declare its own computeOfferReadiness', /\b(function|const)\s+computeOfferReadiness\s*[=(]/.test(src.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);

  // Checked against COMPILED output (comments stripped), not source text:
  // the source's own documentation comment correctly explains that
  // Board8Economics is imported as a TYPE from B8-03 (for diagnosis),
  // which legitimately mentions "computeBoard8Economics" in prose. The
  // rule under test is that no CALL to it exists at runtime.
  const compiled = fs.readFileSync(nbqPath, 'utf8').toLowerCase();
  check('compiled output never calls computeBoard8Economics (type import only)', compiled.indexOf('computeboard8economics') === -1, true);
  check('compiled output contains no "motivation" runtime string', compiled.indexOf('motivation') === -1, true);
  check('compiled output contains no "timeline" runtime string', compiled.indexOf('timeline') === -1, true);
}

// ============================================================
// Jess Gate correction 1: EVERY emitted `question` string is a genuine
// interrogative sentence. Exhaustive matrix over every category/level
// combination this module can produce, plus material unknown and every
// deal_economics sub-case.
// ============================================================
{
  const cases = [];

  // Every non-deal_economics category, both levels, both with and
  // without a known raw fact where the phrasing can vary by it.
  const otherCategories = ['property_identity', 'repairs_condition', 'arv', 'transaction_assumptions', 'seller_price_position'];
  for (const category of otherCategories) {
    for (const level of ['UNKNOWN', 'PRELIMINARY']) {
      const over = {};
      // The `arv` readiness input is an ArvEvidenceState (mapped by
      // B8-04's own mapArvEvidenceToBoard8), not the literal level --
      // INSUFFICIENT maps to UNKNOWN, LOW maps to PRELIMINARY.
      over[toReadinessKey(category)] = category === 'arv'
        ? (level === 'UNKNOWN' ? 'INSUFFICIENT' : 'LOW')
        : level;
      const { readiness, dealEconomics } = readinessAndEconomics(over);
      const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
      cases.push({ label: category + ' ' + level + ' (no known facts)', question: nbq.question });

      const withFacts = computeNextBestQuestion(readiness, { arv: 250000, repairs: 41000, askingPrice: 260000 }, dealEconomics);
      cases.push({ label: category + ' ' + level + ' (with known facts)', question: withFacts.question });
    }
  }

  // Every deal_economics sub-case.
  const dealEconomicsCases = [
    ['deal_economics UNKNOWN, both missing', UNAVAILABLE_ECONOMICS_BOTH],
    ['deal_economics UNKNOWN, arv only', UNAVAILABLE_ECONOMICS_ARV_ONLY],
    ['deal_economics UNKNOWN, repairs only', UNAVAILABLE_ECONOMICS_REPAIRS_ONLY],
    ['deal_economics UNKNOWN, non-Gate-1', UNAVAILABLE_ECONOMICS_NON_GATE1],
  ];
  for (const [label, econ] of dealEconomicsCases) {
    const { readiness, dealEconomics } = readinessAndEconomics({ dealEconomics: econ });
    const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
    cases.push({ label, question: nbq.question });
  }
  const partialEconomics = {
    status: 'calculated', endBuyerMaxPrice: 181363, requiredBuyerProfit: 47250,
    maxSupportedOffer: 176363, standardMinimumAssignmentSpread: 5000, standardMinimumLevel: 'iaos_starter',
    target: { status: 'unavailable', reason: 'hand-built fixture, no share pct' },
  };
  {
    const { readiness, dealEconomics } = readinessAndEconomics({ dealEconomics: partialEconomics });
    const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
    cases.push({ label: 'deal_economics PRELIMINARY', question: nbq.question });
  }

  // Material unknown.
  {
    const { readiness, dealEconomics } = readinessAndEconomics({
      materialUnknowns: [{ code: 'X', description: 'Some caller-supplied fact.' }],
    });
    const nbq = computeNextBestQuestion(readiness, NO_FACTS, dealEconomics);
    cases.push({ label: 'material_unknown', question: nbq.question });
  }

  let allInterrogative = true;
  const offenders = [];
  for (const c of cases) {
    const trimmed = c.question.trim();
    const isInterrogative = trimmed.endsWith('?');
    if (!isInterrogative) { allInterrogative = false; offenders.push(c.label + ': "' + c.question + '"'); }
  }
  check('audited every emitted question string (case count)', cases.length, 26);
  check('every emitted question string ends in "?" (genuinely interrogative)', allInterrogative, true);
  check('no offending non-interrogative questions found', offenders, []);
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

/** Maps a MaterialCategory key to the fullySupportedReadinessInputs override field name. */
function toReadinessKey(category) {
  return {
    property_identity: 'propertyIdentity',
    repairs_condition: 'repairsCondition',
    arv: 'arv',
    transaction_assumptions: 'transactionAssumptions',
    seller_price_position: 'sellerPricePosition',
  }[category];
}
