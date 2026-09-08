/**
 * Conversation-first Seller Call hierarchy -- test runner. B8-12 / INV-55,
 * Brad-approved usability correction (locked 2026-09-07).
 *
 * Two halves, matching this repository's established split (see
 * test-next-best-question.cjs and test-seller-call-workspace-wiring.cjs,
 * whose header explains why: no browser-rendering harness exists here):
 *
 *   1. RUNTIME: real TypeScript compilation of seller-call-script.ts and
 *      next-best-question.ts, then table-driven checks against the
 *      compiled JavaScript -- proves computeQuestionQueue's ordering and
 *      the approved-script overlay actually behave as claimed.
 *
 *   2. STATIC: source-text checks over SellerCallWorkspace.tsx and
 *      FullScriptDrawer.tsx -- proves the required hierarchy is actually
 *      WIRED (one prominent Next Best Question, Other Useful Questions as
 *      a list, the compact Offer Readiness checklist, the Full Script
 *      drawer, and "Suggested — say it your way" labeling), the same
 *      honest limit test-seller-call-workspace-wiring.cjs already states:
 *      this proves wiring, not rendered pixels.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-conversation-first-test');
const UW = path.join(APP, 'src', 'lib', 'underwriting');
const LIB = path.join(APP, 'src', 'lib');
const readSrc = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

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

// ============================================================
// Half 1: RUNTIME -- compile and exercise the actual engine.
// ============================================================

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(UW, 'types.ts'),
  path.join(UW, 'compute.ts'),
  path.join(UW, 'board8-economics.ts'),
  path.join(UW, 'offer-readiness.ts'),
  path.join(UW, 'next-best-question.ts'),
  path.join(LIB, 'seller-call-script.ts'),
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

const readinessPath = path.join(TMP, 'underwriting', 'offer-readiness.js');
const nbqPath = path.join(TMP, 'underwriting', 'next-best-question.js');
const scriptPath = path.join(TMP, 'seller-call-script.js');
for (const p of [readinessPath, nbqPath, scriptPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeOfferReadiness, CATEGORY_LABEL } = require(readinessPath);
const { computeNextBestQuestion, computeQuestionQueue, CATEGORY_PRIORITY } = require(nbqPath);
const {
  APPROVED_SCRIPT_LINES, APPROVED_SCRIPT_FOR_COLD_CATEGORY,
  SCRIPT_STAGE_ORDER, scriptLinesByStage,
} = require(scriptPath);

const NO_FACTS = { arv: null, repairs: null, askingPrice: null };
const SUPPORTED_ECONOMICS = {
  status: 'calculated', endBuyerMaxPrice: 200000, requiredBuyerProfit: 20000,
  maxSupportedOffer: 180000, standardMinimumAssignmentSpread: 5000, standardMinimumLevel: 'iaos_starter',
  target: { status: 'calculated', value: 150000 },
};

function readiness(overrides) {
  const base = {
    propertyIdentity: 'SUPPORTED', repairsCondition: 'SUPPORTED', arv: 'HIGH',
    transactionAssumptions: 'SUPPORTED', sellerPricePosition: 'SUPPORTED',
    dealEconomics: SUPPORTED_ECONOMICS, materialUnknowns: [], humanAction: { kind: 'none' },
  };
  return computeOfferReadiness({ ...base, ...overrides });
}

// ------------------------------------------------------------
// Approved script content is exactly what the ticket specifies -- no
// invented wording, no drift from the eight verbatim lines.
// ------------------------------------------------------------
{
  const EXPECTED_LINES = [
    { stage: 'property', text: "Just so I'm looking at the right place, can I confirm the property address?" },
    { stage: 'situation', text: 'And are you the owner of the property?' },
    { stage: 'situation', text: 'Is anyone else involved in deciding whether to sell?' },
    { stage: 'property', text: 'Is anyone currently living in or renting the property?' },
    { stage: 'property', text: 'Is there anything with the property or ownership that you think could complicate a sale?' },
    { stage: 'condition', text: 'Can you walk me through what you think the property needs?' },
    { stage: 'price', text: 'What price were you hoping to receive?' },
    { stage: 'outcome', text: 'If we agree on price and terms, what timing would work best for you?' },
  ];
  check('exactly 8 approved script lines, verbatim from the ticket', APPROVED_SCRIPT_LINES, EXPECTED_LINES);

  check('SCRIPT_STAGE_ORDER covers the full Connect..Outcome model, in order',
    SCRIPT_STAGE_ORDER, ['connect', 'situation', 'property', 'condition', 'price', 'offer', 'outcome']);

  const grouped = scriptLinesByStage();
  check('scriptLinesByStage covers every stage, in SCRIPT_STAGE_ORDER', grouped.map((g) => g.stage), SCRIPT_STAGE_ORDER);
  check('scriptLinesByStage: connect has no approved line yet', grouped.find((g) => g.stage === 'connect').lines.length, 0);
  check('scriptLinesByStage: situation has 2 approved lines', grouped.find((g) => g.stage === 'situation').lines.length, 2);
  check('scriptLinesByStage: property has 3 approved lines', grouped.find((g) => g.stage === 'property').lines.length, 3);
  check('scriptLinesByStage: condition has 1 approved line', grouped.find((g) => g.stage === 'condition').lines.length, 1);
  check('scriptLinesByStage: price has 1 approved line', grouped.find((g) => g.stage === 'price').lines.length, 1);
  check('scriptLinesByStage: offer has no approved line yet', grouped.find((g) => g.stage === 'offer').lines.length, 0);
  check('scriptLinesByStage: outcome has 1 approved line', grouped.find((g) => g.stage === 'outcome').lines.length, 1);
  check('every grouped line is accounted for (sums to 8)', grouped.reduce((n, g) => n + g.lines.length, 0), 8);
}

// ------------------------------------------------------------
// The cold-category overlay never drifts from the approved lines it
// claims to be quoting.
// ------------------------------------------------------------
{
  const approvedTexts = APPROVED_SCRIPT_LINES.map((l) => l.text);
  for (const key of ['property_identity', 'repairs_condition', 'seller_price_position']) {
    check('APPROVED_SCRIPT_FOR_COLD_CATEGORY.' + key + ' is a verbatim member of APPROVED_SCRIPT_LINES',
      approvedTexts.includes(APPROVED_SCRIPT_FOR_COLD_CATEGORY[key]), true);
  }
  check('APPROVED_SCRIPT_FOR_COLD_CATEGORY has exactly these three keys and no more',
    Object.keys(APPROVED_SCRIPT_FOR_COLD_CATEGORY).sort(),
    ['property_identity', 'repairs_condition', 'seller_price_position']);
}

// ------------------------------------------------------------
// computeQuestionQueue: same priority order as computeNextBestQuestion,
// never a second, disagreeing engine.
// ------------------------------------------------------------
{
  const econ1 = { status: 'unavailable', missing: ['arv', 'repairs'] };
  const r1 = readiness({
    propertyIdentity: 'UNKNOWN', repairsCondition: 'UNKNOWN', arv: null,
    transactionAssumptions: 'UNKNOWN', sellerPricePosition: 'UNKNOWN',
    dealEconomics: econ1,
  });
  const nbq = computeNextBestQuestion(r1, NO_FACTS, econ1);
  const queue = computeQuestionQueue(r1, NO_FACTS, econ1);
  check('queue[0] is always identical to computeNextBestQuestion (same engine, never a second)', queue[0], nbq);
  check('all six categories UNKNOWN -> queue has all six entries', queue.length, 6);
  check('queue follows CATEGORY_PRIORITY order', queue.map((q) => q.source.category), CATEGORY_PRIORITY);
  check('every queue entry is labeled a "question" (never offer_ready mixed in)', queue.every((q) => q.kind === 'question'), true);
}

{
  const rReady = readiness({});
  check('OFFER_READY -> computeQuestionQueue returns empty (nothing to show as "Other Useful Questions")',
    computeQuestionQueue(rReady, NO_FACTS, SUPPORTED_ECONOMICS), []);
  check('OFFER_READY -> computeNextBestQuestion is still "offer_ready" (queue emptiness cannot change the gate)',
    computeNextBestQuestion(rReady, NO_FACTS, SUPPORTED_ECONOMICS).kind, 'offer_ready');
}

{
  // Exactly one open category -> Next Best Question exists but the queue
  // has nothing left over for "Other Useful Questions".
  const rOne = readiness({ sellerPricePosition: 'UNKNOWN' });
  const econOne = SUPPORTED_ECONOMICS;
  const queueOne = computeQuestionQueue(rOne, NO_FACTS, econOne);
  check('exactly one open category -> queue length 1', queueOne.length, 1);
  check('exactly one open category -> "Other Useful Questions" (queue.slice(1)) is empty', queueOne.slice(1), []);
  check('the one open question already prefers the approved script line',
    queueOne[0].question, APPROVED_SCRIPT_FOR_COLD_CATEGORY.seller_price_position);
}

// ------------------------------------------------------------
// CATEGORY_LABEL is exported (the checklist reads it, never invents its
// own labels) and covers all six categories.
// ------------------------------------------------------------
{
  check('CATEGORY_LABEL covers all six MaterialCategory keys', Object.keys(CATEGORY_LABEL).sort(), [...CATEGORY_PRIORITY].sort());
}

cleanup();

// ============================================================
// Half 2: STATIC -- the required hierarchy is actually wired on the page.
// ============================================================

const sellerCallTsx = readSrc('src/pages/SellerCallWorkspace.tsx');
const sellerCallTsxNoComments = sellerCallTsx.replace(/\/\*[\s\S]*?\*\//g, '');
const fullScriptTsx = readSrc('src/components/FullScriptDrawer.tsx');

{
  check('page still renders the dedicated Next Best Question panel (data-testid preserved)',
    /data-testid="next-best-question-panel"/.test(sellerCallTsx), true);

  check('Next Best Question question text renders at 19px (visually primary, not equal-weight with the rest)',
    /fontSize: "19px"[\s\S]{0,150}nextBestQuestion\.question/.test(sellerCallTsxNoComments), true);

  check('page renders "Other Useful Questions" as a real list (data-testid + <ul>)',
    /data-testid="other-useful-questions"/.test(sellerCallTsx), true);
  check('Other Useful Questions is populated from computeQuestionQueue, not re-derived',
    /computeQuestionQueue\(readiness, known, board8\)/.test(sellerCallTsxNoComments), true);
  check('Other Useful Questions renders every item as its own list entry (.map over otherUsefulQuestions)',
    /otherUsefulQuestions\.map/.test(sellerCallTsxNoComments), true);

  check('page renders the compact Offer Readiness checklist (data-testid)',
    /data-testid="offer-readiness-checklist"/.test(sellerCallTsx), true);
  check('the checklist component reads readiness.categories verbatim (no second computeOfferReadiness call inside it)',
    /function OfferReadinessChecklist[\s\S]{0,900}readiness\.categories\[category\]/.test(sellerCallTsxNoComments), true);
  check('OfferReadinessChecklist itself never calls computeOfferReadiness (consumes only, per module boundary)',
    (() => {
      const m = /function OfferReadinessChecklist[\s\S]*?\r?\n\}\r?\n/.exec(sellerCallTsxNoComments);
      return m ? /computeOfferReadiness/.test(m[0]) : 'FUNCTION_NOT_FOUND';
    })(), false);
  check('the checklist renders all six categories via CATEGORY_PRIORITY.map (never a hand-picked subset)',
    /CATEGORY_PRIORITY\.map/.test(sellerCallTsxNoComments), true);
  check('a satisfied category is checkmarked, never simply omitted',
    /satisfied \? "✓" : "○"/.test(sellerCallTsxNoComments), true);

  check('page renders a "View Full Script" trigger', /data-testid="view-full-script"/.test(sellerCallTsx), true);
  check('page renders <FullScriptDrawer', /<FullScriptDrawer/.test(sellerCallTsx), true);
  check('FullScriptDrawer is wired to page state (open/onClose), not always-open',
    /<FullScriptDrawer open=\{fullScriptOpen\} onClose=\{\(\) => setFullScriptOpen\(false\)\}/.test(sellerCallTsx), true);

  const suggestedCount = (sellerCallTsx.match(/Suggested — say it your way\./g) || []).length;
  check('page labels script-sourced content "Suggested — say it your way" at least twice (Next Best Question + Other Useful Questions)',
    suggestedCount >= 2, true);
}

{
  check('FullScriptDrawer is a real dialog (role="dialog", aria-modal)', /role="dialog"/.test(fullScriptTsx) && /aria-modal="true"/.test(fullScriptTsx), true);
  check('FullScriptDrawer has a stable data-testid', /data-testid="full-script-drawer"/.test(fullScriptTsx), true);
  check('FullScriptDrawer renders scriptLinesByStage() (pure data, never a second script list)', /scriptLinesByStage\(\)/.test(fullScriptTsx), true);
  check('FullScriptDrawer labels its content "Suggested — say it your way"', /Suggested — say it your way/.test(fullScriptTsx), true);
  check('FullScriptDrawer states MSK, not script completion, remains the Offer Ready authority', /MSK still decides Offer Ready/.test(fullScriptTsx), true);
  check('FullScriptDrawer closes on Escape (optional, never trapping the operator)', /"Escape"/.test(fullScriptTsx), true);
  check('FullScriptDrawer has an explicit close control', /data-testid="full-script-close"/.test(fullScriptTsx), true);
}

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures);
if (failures > 0) {
  console.error('FAILURES: ' + failures);
  process.exit(1);
}
console.log('ALL CHECKS PASSED (' + checks + ')');
