/**
 * Live offer/counter/negotiation experience -- test runner. B8-08 / INV-51.
 *
 * Compiles the pure negotiation module and its B8-03 dependency to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no React, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-negotiation-test');
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
  path.join(LIB, 'arv-reconciliation.ts'),
  path.join(LIB, 'comp-classification.ts'),
  path.join(LIB, 'propstream-comp-csv.ts'),
  path.join(LIB, 'seller-call-negotiation.ts'),
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
const negotiationPath = path.join(TMP, 'seller-call-negotiation.js');
for (const p of [computePath, board8Path, negotiationPath]) {
  if (!fs.existsSync(p)) {
    console.error('ABORT: expected compiled output at ' + p);
    cleanup();
    process.exit(11);
  }
}

const { computeUnderwriting } = require(computePath);
const { computeBoard8Economics } = require(board8Path);
const {
  computeNegotiationPosition,
  attemptOverride,
  isOverrideCurrent,
  requiresOverrideDecision,
  NEGOTIATION_ACTIONS,
} = require(negotiationPath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 49;
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

// Golden fixture, cross-checked against test-board8-economics.cjs and
// test-seller-call-deal-bar.cjs's own golden path: endBuyerMaxPrice
// ~181363, maxSupportedOffer ~176363.
const GOLDEN_ECONOMICS = computeBoard8Economics(computeUnderwriting(underwritingInputs()));
const UNAVAILABLE_ECONOMICS = computeBoard8Economics(computeUnderwriting(underwritingInputs({ arv: { kind: 'unresolved', reason: 'absent' } })));

// ============================================================
// computeNegotiationPosition: no Current Offer, no Max -> unavailable,
// with a NAMED, distinct reason for each case.
// ============================================================
const GOLDEN_MAX = GOLDEN_ECONOMICS.status === 'calculated' ? GOLDEN_ECONOMICS.maxSupportedOffer : NaN;

{
  check('setup: golden economics is calculated', GOLDEN_ECONOMICS.status, 'calculated');
  // Cross-checked against test-seller-call-deal-bar.cjs's own golden path
  // (~$176,363 displayed); the exact, unrounded value is read from
  // board8-economics.ts's own output rather than re-typed as a rounded
  // literal, since Target Wholesale Profit's 25%-of-profit branch does
  // not resolve to a round number for this fixture.
  check('setup: golden Max Supported Offer rounds to the expected fixture display value', Math.round(GOLDEN_MAX), 176363);

  const noOffer = computeNegotiationPosition({ currentOffer: null, board8: GOLDEN_ECONOMICS });
  check('no Current Offer -> unavailable', noOffer.status, 'unavailable');
  check('no Current Offer reason names Current Offer specifically', noOffer.reason.toLowerCase().indexOf('current offer') >= 0, true);

  const noMax = computeNegotiationPosition({ currentOffer: 150000, board8: UNAVAILABLE_ECONOMICS });
  check('Max not calculated -> unavailable, even with a Current Offer entered', noMax.status, 'unavailable');
  check('no-Max reason names Max specifically, distinct from the no-offer reason', noMax.reason.toLowerCase().indexOf('max') >= 0, true);
  check('the two unavailable reasons are distinct strings, never collapsed into one', noOffer.reason === noMax.reason, false);
}

// ============================================================
// computeNegotiationPosition: within Max vs. above Max, using B8-03's OWN
// maxSupportedOffer -- never a second calculation.
// ============================================================
{
  const within = computeNegotiationPosition({ currentOffer: 150000, board8: GOLDEN_ECONOMICS });
  check('Current Offer below Max -> within_max', within.status, 'within_max');
  check('within_max amountBelowMax is exact', within.amountBelowMax, GOLDEN_MAX - 150000);
  check('within_max echoes the exact maxSupportedOffer read from board8, never recomputed', within.maxSupportedOffer, GOLDEN_ECONOMICS.maxSupportedOffer);

  const exactlyAtMax = computeNegotiationPosition({ currentOffer: GOLDEN_MAX, board8: GOLDEN_ECONOMICS });
  check('Current Offer EXACTLY AT Max -> within_max, not above (Max itself is still supported)', exactlyAtMax.status, 'within_max');
  check('exactly-at-Max amountBelowMax is zero', exactlyAtMax.amountBelowMax, 0);

  const above = computeNegotiationPosition({ currentOffer: 190000, board8: GOLDEN_ECONOMICS });
  check('Current Offer above Max -> above_max', above.status, 'above_max');
  check('above_max amountAboveMax is exact', above.amountAboveMax, 190000 - GOLDEN_MAX);
  check('above_max echoes the exact maxSupportedOffer read from board8, never recomputed', above.maxSupportedOffer, GOLDEN_ECONOMICS.maxSupportedOffer);

  check('computeNegotiationPosition throws on a non-finite currentOffer rather than silently coercing', (() => {
    try { computeNegotiationPosition({ currentOffer: NaN, board8: GOLDEN_ECONOMICS }); return 'no-throw'; }
    catch (e) { return e instanceof RangeError; }
  })(), true);
}

// ============================================================
// NEGOTIATION_ACTIONS: the exact four INV-51 names, and no others.
// ============================================================
{
  check('exactly the four bounded actions INV-51 names, in a stable order', NEGOTIATION_ACTIONS.slice(), ['keep_negotiating', 'review_assumptions', 'cancel', 'override_continue']);
}

// ============================================================
// attemptOverride: fails closed on every precondition INV-51 requires --
// not above Max, not acknowledged, empty reason.
// ============================================================
{
  const within = computeNegotiationPosition({ currentOffer: 150000, board8: GOLDEN_ECONOMICS });
  const notAboveMax = attemptOverride({ position: within, acknowledged: true, reason: 'seller is motivated', operator: 'Brad Thompson', at: '2026-09-06T12:00:00.000Z' });
  check('cannot override a within_max position -- nothing to override', notAboveMax.ok, false);
  check('the not-above-Max rejection names the actual reason', notAboveMax.error.toLowerCase().indexOf('not above max') >= 0, true);

  const unavailablePos = computeNegotiationPosition({ currentOffer: null, board8: GOLDEN_ECONOMICS });
  const notAvailable = attemptOverride({ position: unavailablePos, acknowledged: true, reason: 'x', operator: 'Brad Thompson', at: '2026-09-06T12:00:00.000Z' });
  check('cannot override an unavailable position', notAvailable.ok, false);

  const above = computeNegotiationPosition({ currentOffer: 190000, board8: GOLDEN_ECONOMICS });

  const notAcknowledged = attemptOverride({ position: above, acknowledged: false, reason: 'seller is motivated, needs to close in 10 days', operator: 'Brad Thompson', at: '2026-09-06T12:00:00.000Z' });
  check('cannot override above Max without explicit acknowledgement, even with a reason typed', notAcknowledged.ok, false);
  check('the not-acknowledged rejection names acknowledgement specifically', notAcknowledged.error.toLowerCase().indexOf('acknowledg') >= 0, true);

  const emptyReason = attemptOverride({ position: above, acknowledged: true, reason: '', operator: 'Brad Thompson', at: '2026-09-06T12:00:00.000Z' });
  check('cannot override above Max with an empty reason, even when acknowledged', emptyReason.ok, false);

  const whitespaceReason = attemptOverride({ position: above, acknowledged: true, reason: '   ', operator: 'Brad Thompson', at: '2026-09-06T12:00:00.000Z' });
  check('a whitespace-only reason is treated the same as empty -- rejected', whitespaceReason.ok, false);
}

// ============================================================
// attemptOverride: the ONLY successful path, and its record's provenance
// is copied verbatim from the position, never recomputed or guessed.
// ============================================================
{
  const above = computeNegotiationPosition({ currentOffer: 190000, board8: GOLDEN_ECONOMICS });
  const result = attemptOverride({
    position: above, acknowledged: true,
    reason: 'Seller needs to close within 10 days; carrying costs justify the premium.',
    operator: 'Brad Thompson', at: '2026-09-06T12:00:00.000Z',
  });
  check('override succeeds when above Max, acknowledged, and reasoned', result.ok, true);
  check('override.acknowledgedAboveMax is true', result.override.acknowledgedAboveMax, true);
  check('override.reason is carried through verbatim', result.override.reason, 'Seller needs to close within 10 days; carrying costs justify the premium.');
  check('override.operator is carried through verbatim', result.override.operator, 'Brad Thompson');
  check('override.at is carried through verbatim', result.override.at, '2026-09-06T12:00:00.000Z');
  check('override.currentOfferAtOverride matches the position exactly', result.override.currentOfferAtOverride, 190000);
  check('override.maxSupportedOfferAtOverride matches board8 exactly, never recomputed', result.override.maxSupportedOfferAtOverride, GOLDEN_ECONOMICS.maxSupportedOffer);
  check('override.amountAboveMaxAtOverride matches the position exactly', result.override.amountAboveMaxAtOverride, 190000 - GOLDEN_MAX);
}

// ============================================================
// isOverrideCurrent / requiresOverrideDecision: the core "no silent
// above-Max progression" proof -- an override covers ONLY the exact
// position it was granted for.
// ============================================================
{
  const above190 = computeNegotiationPosition({ currentOffer: 190000, board8: GOLDEN_ECONOMICS });
  const grant190 = attemptOverride({ position: above190, acknowledged: true, reason: 'agreed premium', operator: 'Brad Thompson', at: '2026-09-06T12:00:00.000Z' });

  check('a fresh override IS current for the exact position it was granted for', isOverrideCurrent(grant190.override, above190), true);
  check('with a current override, no further decision is required', requiresOverrideDecision(above190, grant190.override), false);

  const above200 = computeNegotiationPosition({ currentOffer: 200000, board8: GOLDEN_ECONOMICS });
  check('the SAME override does NOT cover a NEW, different Current Offer (a new counter)', isOverrideCurrent(grant190.override, above200), false);
  check('a new above-Max counter with a stale override still requires a fresh decision', requiresOverrideDecision(above200, grant190.override), true);

  const within = computeNegotiationPosition({ currentOffer: 150000, board8: GOLDEN_ECONOMICS });
  check('an override never applies once the position drops back within Max', isOverrideCurrent(grant190.override, within), false);
  check('within Max never requires an override decision, override or not', requiresOverrideDecision(within, grant190.override), false);
  check('within Max never requires an override decision when none exists either', requiresOverrideDecision(within, null), false);

  check('no override at all + above Max -> a decision is required', requiresOverrideDecision(above190, null), true);
  check('no override at all + above Max -> not current', isOverrideCurrent(null, above190), false);

  // Max itself changing (e.g. an assumption revised) invalidates a prior
  // override even when Current Offer did not move -- the acknowledgement
  // was for a specific gap, not blanket permission.
  const revisedEconomics = computeBoard8Economics(computeUnderwriting(underwritingInputs({ standardMinimum: V(10000) })));
  const aboveRevised = computeNegotiationPosition({ currentOffer: 190000, board8: revisedEconomics });
  check('setup: revising an assumption actually changed Max', revisedEconomics.maxSupportedOffer !== GOLDEN_ECONOMICS.maxSupportedOffer, true);
  check('an override granted against the OLD Max does not cover the SAME Current Offer under a REVISED Max', isOverrideCurrent(grant190.override, aboveRevised), false);
  check('a revised Max with a stale override still requires a fresh decision', requiresOverrideDecision(aboveRevised, grant190.override), true);
}

// ============================================================
// Structural proof: this module consumes B8-03 (Max Supported Offer),
// never recomputes it, and touches nothing of offer-readiness.ts's
// evidence-based HumanAction.
// ============================================================
{
  const src = fs.readFileSync(path.join(LIB, 'seller-call-negotiation.ts'), 'utf8');
  check('source does not import compute.ts', src.indexOf('"./underwriting/compute"') === -1, true);
  check('source does not call computeUnderwriting', src.indexOf('computeUnderwriting') === -1, true);
  check('source does not reimplement the 25%/$5,000 Target/Max formula', src.indexOf('0.25') === -1 && src.indexOf('Math.max') === -1, true);
  check('source contains no network/GHL surface', ['fetch(', 'ghl.', 'PROXY', 'customFields', '.notes.'].every((t) => src.indexOf(t) === -1), true);

  // Checked against compiled output (comments stripped), not source text:
  // the module's OWN header comment discusses offer-readiness.ts's
  // HumanAction at length to EXPLAIN why this is a different concept,
  // which would false-positive a plain source-text substring check (same
  // class of mistake as arv-approval-note.ts's ghl.notes.list discussion
  // earlier this board).
  const compiledNoComments = execSync(
    'npx tsc "' + path.join(LIB, 'seller-call-negotiation.ts') + '" --outDir "' + TMP + '-nocomments" --module commonjs --target es2020 --removeComments',
    { cwd: APP }
  ) && fs.readFileSync(path.join(TMP + '-nocomments', 'seller-call-negotiation.js'), 'utf8');
  fs.rmSync(TMP + '-nocomments', { recursive: true, force: true });
  check('compiled output never imports offer-readiness.ts or uses its HumanAction type (a distinct override concept)', /offer-readiness|HumanAction/.test(compiledNoComments), false);
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
