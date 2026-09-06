/**
 * Deal-scoped negotiation resume hydration -- test runner. Jess Re-Gate
 * correction, INV-53, 2026-09-06; extended for the above-Max override,
 * B8-11 / INV-54, 2026-09-07.
 *
 * Compiles the pure resume module (no dependencies beyond itself) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases proving the multi-render state machine
 * `resolveResumeHydration` implements -- delayed opportunity selection,
 * switching opportunities/contacts, rerender-safety, and null-stays-empty,
 * for Seller Position, Current Offer, AND (as of B8-11) the above-Max
 * override -- since none of that is provable by a source-text regex
 * against a single render's JSX (see test-seller-call-workspace-wiring.cjs's
 * own header on that harness's honest limit). No GHL, no network, no
 * React, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-resume-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [path.join(LIB, 'seller-call-resume.ts')];

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

const resumePath = path.join(TMP, 'seller-call-resume.js');
if (!fs.existsSync(resumePath)) {
  console.error('ABORT: expected compiled output at ' + resumePath);
  cleanup();
  process.exit(11);
}

const { resolveResumeHydration } = require(resumePath);

const compiledNoComments = execSync(
  'npx tsc "' + path.join(LIB, 'seller-call-resume.ts') + '" --outDir "' + TMP + '-nocomments" --module commonjs --target es2020 --removeComments',
  { cwd: APP }
) && fs.readFileSync(path.join(TMP + '-nocomments', 'seller-call-resume.js'), 'utf8');
fs.rmSync(TMP + '-nocomments', { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 45;
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

const NOT_SELECTED = { dealId: null, hydrated: false };

/** Base args every call supplies -- `latestOverrideNote: null, currentOverride: null` unless a case is specifically about the override. */
function args(over) {
  return Object.assign({
    latestOverrideNote: null,
    currentOverride: null,
  }, over);
}

function fullOverrideRecord(over) {
  return Object.assign({
    reason: 'Seller price position confirmed verbally; proceeding above Max.',
    operator: null, at: '2026-09-07T15:00:00.000Z',
    currentOfferAtOverride: 190000, maxSupportedOfferAtOverride: 176363, amountAboveMaxAtOverride: 13637,
  }, over || {});
}

// ============================================================
// Delayed opportunity selection on a multi-opportunity contact: the
// contact's data has loaded (loading: false) but no opportunity has been
// picked yet (currentDealId: null) -- this must stay pending (never
// marked hydrated), then hydrate correctly the moment an opportunity is
// actually selected.
// ============================================================
{
  const pending = resolveResumeHydration(args({
    prevRef: NOT_SELECTED, currentDealId: null, loading: false, latestOutcome: null,
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('awaiting_selection (loaded, no opportunity chosen) never clears', pending.clear, false);
  check('awaiting_selection never restores Seller Position', pending.restoreSellerPosition, null);
  check('awaiting_selection never restores Current Offer', pending.restoreCurrentOffer, null);
  check('awaiting_selection never restores an override', pending.restoreOverride, null);
  check('awaiting_selection is NEVER marked hydrated -- the exact defect Jess Re-Gate found (permanently skipping hydration once a deal was picked)', pending.nextRef.hydrated, false);

  // The operator now picks an opportunity -- `prevRef` carries forward
  // EXACTLY what the pending call above returned, proving the retry
  // actually works across renders rather than being asserted in isolation.
  // This deal ALSO has a durable override on record -- delayed selection
  // must restore it too, the same render Seller Position/Current Offer
  // restore.
  const selected = resolveResumeHydration(args({
    prevRef: pending.nextRef, currentDealId: 'opp-1', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: 190000 },
    latestOverrideNote: fullOverrideRecord(),
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('selecting an opportunity after a pending render is treated as an identity change (clears first)', selected.clear, true);
  check('delayed selection restores Seller Position once eligible', selected.restoreSellerPosition, '250000');
  check('delayed selection restores Current Offer once eligible', selected.restoreCurrentOffer, '190000');
  check('delayed selection restores a durable override once eligible, in the SAME pass as Seller Position/Current Offer', selected.restoreOverride, fullOverrideRecord());
  check('the newly selected opportunity is now marked hydrated', selected.nextRef, { dealId: 'opp-1', hydrated: true });

  // Still loading (data not yet fetched at all) must stay pending exactly
  // like awaiting_selection -- neither loading nor selection alone is
  // sufficient; both must clear before hydration is attempted.
  const stillLoading = resolveResumeHydration(args({
    prevRef: NOT_SELECTED, currentDealId: null, loading: true, latestOutcome: null,
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('still loading is never marked hydrated', stillLoading.nextRef.hydrated, false);
}

// ============================================================
// Switching Opportunity A -> Opportunity B (same contact, or a different
// contact's opportunity landing on the same page instance -- this module
// makes no distinction, which is exactly the point) must clear A's
// values before B's OWN snapshot is ever considered, and must never let
// A's values leak into B when B has no recorded outcome/override of its
// own.
// ============================================================
{
  const hydratedForA = { dealId: 'opp-A', hydrated: true };

  // B has no outcome or override of its own -- A's stale live inputs must
  // be cleared, and nothing invented in their place.
  const switchToEmptyB = resolveResumeHydration(args({
    prevRef: hydratedForA, currentDealId: 'opp-B', loading: false, latestOutcome: null,
    sellerPositionInput: '300000', currentOfferInput: '220000',
  }));
  check('switching to a different opportunity ALWAYS clears first, regardless of what the new deal has on record', switchToEmptyB.clear, true);
  check('Deal A\'s Seller Position is never carried onto Deal B (B has none of its own)', switchToEmptyB.restoreSellerPosition, null);
  check('Deal A\'s Current Offer is never carried onto Deal B (B has none of its own)', switchToEmptyB.restoreCurrentOffer, null);
  check('Deal B is marked hydrated on its own decision, not borrowed from A', switchToEmptyB.nextRef, { dealId: 'opp-B', hydrated: true });

  // B has its OWN different recorded outcome AND its OWN different
  // override -- B's records must be restored, never A's stale live
  // inputs or A's override object.
  const switchToOwnB = resolveResumeHydration(args({
    prevRef: hydratedForA, currentDealId: 'opp-B', loading: false,
    latestOutcome: { sellerPosition: 410000, currentOffer: 355000 },
    latestOverrideNote: fullOverrideRecord({ reason: 'Deal B\'s own override, distinct from Deal A\'s.', currentOfferAtOverride: 355000, amountAboveMaxAtOverride: 5000 }),
    currentOverride: { acknowledgedAboveMax: true, reason: 'Deal A\'s override, still live in state at click time', operator: null, at: '2026-09-01T00:00:00.000Z', currentOfferAtOverride: 220000, maxSupportedOfferAtOverride: 200000, amountAboveMaxAtOverride: 20000 },
    sellerPositionInput: '300000', currentOfferInput: '220000',
  }));
  check('switching opportunities clears before restoring', switchToOwnB.clear, true);
  check('Deal B\'s OWN Seller Position is restored, never Deal A\'s stale live value', switchToOwnB.restoreSellerPosition, '410000');
  check('Deal B\'s OWN Current Offer is restored, never Deal A\'s stale live value', switchToOwnB.restoreCurrentOffer, '355000');
  check('Deal B\'s OWN override is restored even though Deal A\'s override object was still non-null in live state (a genuine identity change always clears first)', switchToOwnB.restoreOverride.reason, 'Deal B\'s own override, distinct from Deal A\'s.');

  // Switching CONTACTS is not a distinct case to this module -- a
  // different contact's opportunity id is just another identity change.
  // Same proof, framed as the contact-switch scenario Jess Re-Gate named,
  // now including the override.
  const switchToOtherContactsDeal = resolveResumeHydration(args({
    prevRef: hydratedForA, currentDealId: 'opp-on-a-different-contact', loading: false,
    latestOutcome: null,
    currentOverride: { acknowledgedAboveMax: true, reason: 'stale', operator: null, at: '2026-09-01T00:00:00.000Z', currentOfferAtOverride: 1, maxSupportedOfferAtOverride: 1, amountAboveMaxAtOverride: 1 },
    sellerPositionInput: '300000', currentOfferInput: '220000',
  }));
  check('navigating to a DIFFERENT CONTACT\'S opportunity (no full remount) is an identity change like any other -- clears first', switchToOtherContactsDeal.clear, true);
  check('a different contact\'s deal never inherits the previous contact\'s Seller Position', switchToOtherContactsDeal.restoreSellerPosition, null);
  check('a different contact\'s deal never inherits the previous contact\'s Current Offer', switchToOtherContactsDeal.restoreCurrentOffer, null);
  check('a different contact\'s deal never inherits the previous contact\'s override', switchToOtherContactsDeal.restoreOverride, null);

  // Dropping back to no selection at all (e.g. an error state) is equally
  // an identity change, and must equally clear.
  const dropToNoSelection = resolveResumeHydration(args({
    prevRef: hydratedForA, currentDealId: null, loading: false, latestOutcome: null,
    sellerPositionInput: '300000', currentOfferInput: '220000',
  }));
  check('falling back to no selection at all still clears the previous deal\'s values', dropToNoSelection.clear, true);
  check('falling back to no selection is never marked hydrated (nothing is selected to hydrate)', dropToNoSelection.nextRef.hydrated, false);
}

// ============================================================
// Rerendering the SAME opportunity (already hydrated) must NEVER clear or
// restore anything, regardless of what the live inputs or the latest
// outcome/override look like -- this is what makes an operator's own
// edit safe across every ordinary rerender (a new note appended,
// readiness recomputed, an unrelated state change).
// ============================================================
{
  const alreadyHydrated = { dealId: 'opp-1', hydrated: true };
  const rerender = resolveResumeHydration(args({
    prevRef: alreadyHydrated, currentDealId: 'opp-1', loading: false,
    latestOutcome: { sellerPosition: 999999, currentOffer: 888888 },
    latestOverrideNote: fullOverrideRecord({ reason: 'a DIFFERENT override that appeared on record after this render already hydrated' }),
    currentOverride: { acknowledgedAboveMax: true, reason: 'the operator\'s own live override, granted this session', operator: null, at: '2026-09-07T16:00:00.000Z', currentOfferAtOverride: 190000, maxSupportedOfferAtOverride: 176363, amountAboveMaxAtOverride: 13637 },
    sellerPositionInput: '111', currentOfferInput: '222',
  }));
  check('rerendering the same opportunity never clears', rerender.clear, false);
  check('rerendering the same opportunity never touches Seller Position, even with a DIFFERENT snapshot value on record', rerender.restoreSellerPosition, null);
  check('rerendering the same opportunity never touches Current Offer, even with a DIFFERENT snapshot value on record', rerender.restoreCurrentOffer, null);
  check('rerendering the same opportunity never touches the override, even with a DIFFERENT override on record -- an operator\'s own live grant is never replaced', rerender.restoreOverride, null);
  check('the ref is carried forward unchanged on an ordinary rerender', rerender.nextRef, alreadyHydrated);
}

// ============================================================
// The rare pending-eligibility retry (identity unchanged, not yet
// hydrated -- e.g. a fetch still resolving) must protect a live edit PER
// FIELD, exactly like the ordinary "untouched" convention elsewhere on
// this page: a field the operator already typed into is left alone even
// while the other field still restores. The override follows the same
// rule as its own field.
// ============================================================
{
  const pendingForOpp1 = { dealId: 'opp-1', hydrated: false };
  const retryWithOneFieldEdited = resolveResumeHydration(args({
    prevRef: pendingForOpp1, currentDealId: 'opp-1', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: 190000 },
    latestOverrideNote: fullOverrideRecord(),
    sellerPositionInput: '777777', currentOfferInput: '',
    currentOverride: null,
  }));
  check('a pending-retry pass is NOT a clear (identity did not change)', retryWithOneFieldEdited.clear, false);
  check('an operator-typed Seller Position survives even a same-identity retry', retryWithOneFieldEdited.restoreSellerPosition, null);
  check('an untouched Current Offer still restores on the same retry', retryWithOneFieldEdited.restoreCurrentOffer, '190000');
  check('an untouched override still restores on the same retry, independently of the Seller Position field being protected', retryWithOneFieldEdited.restoreOverride, fullOverrideRecord());
  check('the retry still marks the opportunity hydrated (decided once, not retried forever)', retryWithOneFieldEdited.nextRef, { dealId: 'opp-1', hydrated: true });

  // The mirror case: the operator already granted an override THIS
  // session (currentOverride non-null) during the pending window -- that
  // must survive, even though the two string inputs are untouched and
  // still restore.
  const retryWithOverrideAlreadyGranted = resolveResumeHydration(args({
    prevRef: pendingForOpp1, currentDealId: 'opp-1', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: 190000 },
    latestOverrideNote: fullOverrideRecord({ reason: 'a DIFFERENT override on durable record' }),
    currentOverride: { acknowledgedAboveMax: true, reason: 'the operator\'s own live override, granted during the pending window', operator: null, at: '2026-09-07T16:05:00.000Z', currentOfferAtOverride: 190000, maxSupportedOfferAtOverride: 176363, amountAboveMaxAtOverride: 13637 },
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('an operator-granted override survives even a same-identity retry, while untouched string fields still restore', retryWithOverrideAlreadyGranted.restoreOverride, null);
  check('the string fields still restore on the same retry, independently of the override field being protected', {
    seller: retryWithOverrideAlreadyGranted.restoreSellerPosition, offer: retryWithOverrideAlreadyGranted.restoreCurrentOffer,
  }, { seller: '250000', offer: '190000' });
}

// ============================================================
// Absent/null snapshot values remain empty -- never a fabricated zero or
// default, whether there is no outcome/override at all or a partial one.
// ============================================================
{
  const noOutcomeAtAll = resolveResumeHydration(args({
    prevRef: NOT_SELECTED, currentDealId: 'opp-fresh', loading: false, latestOutcome: null,
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('a brand-new deal with no recorded outcome or override restores nothing (stays empty from the clear, never a fabricated zero)', {
    seller: noOutcomeAtAll.restoreSellerPosition, offer: noOutcomeAtAll.restoreCurrentOffer, override: noOutcomeAtAll.restoreOverride,
  }, { seller: null, offer: null, override: null });

  const partialOutcome = resolveResumeHydration(args({
    prevRef: NOT_SELECTED, currentDealId: 'opp-partial', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: null },
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('a partial snapshot (Current Offer unavailable at the moment of the outcome) restores ONLY the present field', {
    seller: partialOutcome.restoreSellerPosition, offer: partialOutcome.restoreCurrentOffer,
  }, { seller: '250000', offer: null });

  // An outcome can exist with NO override on record at all (the operator
  // never negotiated above Max) -- this must restore Seller
  // Position/Current Offer without inventing an override from nothing.
  const outcomeNoOverride = resolveResumeHydration(args({
    prevRef: NOT_SELECTED, currentDealId: 'opp-no-override', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: 190000 },
    latestOverrideNote: null,
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('an outcome with no override on record restores the outcome but never fabricates an override', {
    override: outcomeNoOverride.restoreOverride,
  }, { override: null });

  // The reverse: an override can exist with NO outcome ever recorded
  // (the operator overrode above Max but never hit Accept/Follow-Up/Pass)
  // -- this must restore the override without an outcome to key off of.
  const overrideNoOutcome = resolveResumeHydration(args({
    prevRef: NOT_SELECTED, currentDealId: 'opp-override-only', loading: false,
    latestOutcome: null,
    latestOverrideNote: fullOverrideRecord(),
    sellerPositionInput: '', currentOfferInput: '',
  }));
  check('an override with NO outcome ever recorded still restores on its own (the two carriers are independent)', overrideNoOutcome.restoreOverride, fullOverrideRecord());
}

// ============================================================
// Structural proof: no GHL/network/React reference of any kind, and no
// second economics engine -- this module only ever restores the fields
// it is handed, verbatim.
// ============================================================
{
  check('compiled output makes no GHL/network call of any kind', /fetch\(|ghl\.|PROXY|XMLHttpRequest/.test(compiledNoComments), false);
  check('compiled output has no React import (pure decision logic, applied by the page)', /require\("react"\)|from "react"/.test(compiledNoComments), false);
  check('compiled output never recomputes Target/Max/Spread (no 25%/$5,000 formula, no endBuyerMaxPrice arithmetic)', /0\.25|Math\.max|endBuyerMaxPrice/.test(compiledNoComments), false);
  check('compiled output never references Offer Readiness\'s DIFFERENT humanAction/effectiveStatus override concept', /humanAction|effectiveStatus/.test(compiledNoComments), false);
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
