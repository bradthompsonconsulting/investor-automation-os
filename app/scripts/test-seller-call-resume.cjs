/**
 * Deal-scoped negotiation resume hydration -- test runner. Jess Re-Gate
 * correction, INV-53, 2026-09-06.
 *
 * Compiles the pure resume module (no dependencies beyond itself) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases proving the multi-render state machine
 * `resolveResumeHydration` implements -- delayed opportunity selection,
 * switching opportunities/contacts, rerender-safety, and null-stays-empty
 * -- since none of that is provable by a source-text regex against a
 * single render's JSX (see test-seller-call-workspace-wiring.cjs's own
 * header on that harness's honest limit). No GHL, no network, no React,
 * no fixture.
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

const NOT_SELECTED = { dealId: null, hydrated: false };

// ============================================================
// Delayed opportunity selection on a multi-opportunity contact: the
// contact's data has loaded (loading: false) but no opportunity has been
// picked yet (currentDealId: null) -- this must stay pending (never
// marked hydrated), then hydrate correctly the moment an opportunity is
// actually selected.
// ============================================================
{
  const pending = resolveResumeHydration({
    prevRef: NOT_SELECTED, currentDealId: null, loading: false, latestOutcome: null,
    sellerPositionInput: '', currentOfferInput: '',
  });
  check('awaiting_selection (loaded, no opportunity chosen) never clears', pending.clear, false);
  check('awaiting_selection never restores Seller Position', pending.restoreSellerPosition, null);
  check('awaiting_selection never restores Current Offer', pending.restoreCurrentOffer, null);
  check('awaiting_selection is NEVER marked hydrated -- the exact defect Jess Re-Gate found (permanently skipping hydration once a deal was picked)', pending.nextRef.hydrated, false);

  // The operator now picks an opportunity -- `prevRef` carries forward
  // EXACTLY what the pending call above returned, proving the retry
  // actually works across renders rather than being asserted in isolation.
  const selected = resolveResumeHydration({
    prevRef: pending.nextRef, currentDealId: 'opp-1', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: 190000 },
    sellerPositionInput: '', currentOfferInput: '',
  });
  check('selecting an opportunity after a pending render is treated as an identity change (clears first)', selected.clear, true);
  check('delayed selection restores Seller Position once eligible', selected.restoreSellerPosition, '250000');
  check('delayed selection restores Current Offer once eligible', selected.restoreCurrentOffer, '190000');
  check('the newly selected opportunity is now marked hydrated', selected.nextRef, { dealId: 'opp-1', hydrated: true });

  // Still loading (data not yet fetched at all) must stay pending exactly
  // like awaiting_selection -- neither loading nor selection alone is
  // sufficient; both must clear before hydration is attempted.
  const stillLoading = resolveResumeHydration({
    prevRef: NOT_SELECTED, currentDealId: null, loading: true, latestOutcome: null,
    sellerPositionInput: '', currentOfferInput: '',
  });
  check('still loading is never marked hydrated', stillLoading.nextRef.hydrated, false);
}

// ============================================================
// Switching Opportunity A -> Opportunity B (same contact, or a different
// contact's opportunity landing on the same page instance -- this module
// makes no distinction, which is exactly the point) must clear A's
// values before B's OWN snapshot is ever considered, and must never let
// A's values leak into B when B has no recorded outcome of its own.
// ============================================================
{
  const hydratedForA = { dealId: 'opp-A', hydrated: true };

  // B has no outcome of its own -- A's stale live inputs must be cleared,
  // and nothing invented in their place.
  const switchToEmptyB = resolveResumeHydration({
    prevRef: hydratedForA, currentDealId: 'opp-B', loading: false, latestOutcome: null,
    sellerPositionInput: '300000', currentOfferInput: '220000',
  });
  check('switching to a different opportunity ALWAYS clears first, regardless of what the new deal has on record', switchToEmptyB.clear, true);
  check('Deal A\'s Seller Position is never carried onto Deal B (B has none of its own)', switchToEmptyB.restoreSellerPosition, null);
  check('Deal A\'s Current Offer is never carried onto Deal B (B has none of its own)', switchToEmptyB.restoreCurrentOffer, null);
  check('Deal B is marked hydrated on its own decision, not borrowed from A', switchToEmptyB.nextRef, { dealId: 'opp-B', hydrated: true });

  // B has its OWN different recorded outcome -- B's numbers must be
  // restored, never A's stale live inputs.
  const switchToOwnB = resolveResumeHydration({
    prevRef: hydratedForA, currentDealId: 'opp-B', loading: false,
    latestOutcome: { sellerPosition: 410000, currentOffer: 355000 },
    sellerPositionInput: '300000', currentOfferInput: '220000',
  });
  check('switching opportunities clears before restoring', switchToOwnB.clear, true);
  check('Deal B\'s OWN Seller Position is restored, never Deal A\'s stale live value', switchToOwnB.restoreSellerPosition, '410000');
  check('Deal B\'s OWN Current Offer is restored, never Deal A\'s stale live value', switchToOwnB.restoreCurrentOffer, '355000');

  // Switching CONTACTS is not a distinct case to this module -- a
  // different contact's opportunity id is just another identity change.
  // Same proof, framed as the contact-switch scenario Jess Re-Gate named.
  const switchToOtherContactsDeal = resolveResumeHydration({
    prevRef: hydratedForA, currentDealId: 'opp-on-a-different-contact', loading: false,
    latestOutcome: null,
    sellerPositionInput: '300000', currentOfferInput: '220000',
  });
  check('navigating to a DIFFERENT CONTACT\'S opportunity (no full remount) is an identity change like any other -- clears first', switchToOtherContactsDeal.clear, true);
  check('a different contact\'s deal never inherits the previous contact\'s Seller Position', switchToOtherContactsDeal.restoreSellerPosition, null);
  check('a different contact\'s deal never inherits the previous contact\'s Current Offer', switchToOtherContactsDeal.restoreCurrentOffer, null);

  // Dropping back to no selection at all (e.g. an error state) is equally
  // an identity change, and must equally clear.
  const dropToNoSelection = resolveResumeHydration({
    prevRef: hydratedForA, currentDealId: null, loading: false, latestOutcome: null,
    sellerPositionInput: '300000', currentOfferInput: '220000',
  });
  check('falling back to no selection at all still clears the previous deal\'s values', dropToNoSelection.clear, true);
  check('falling back to no selection is never marked hydrated (nothing is selected to hydrate)', dropToNoSelection.nextRef.hydrated, false);
}

// ============================================================
// Rerendering the SAME opportunity (already hydrated) must NEVER clear or
// restore anything, regardless of what the live inputs or the latest
// outcome look like -- this is what makes an operator's own edit safe
// across every ordinary rerender (a new note appended, readiness
// recomputed, an unrelated state change).
// ============================================================
{
  const alreadyHydrated = { dealId: 'opp-1', hydrated: true };
  const rerender = resolveResumeHydration({
    prevRef: alreadyHydrated, currentDealId: 'opp-1', loading: false,
    latestOutcome: { sellerPosition: 999999, currentOffer: 888888 },
    sellerPositionInput: '111', currentOfferInput: '222',
  });
  check('rerendering the same opportunity never clears', rerender.clear, false);
  check('rerendering the same opportunity never touches Seller Position, even with a DIFFERENT snapshot value on record', rerender.restoreSellerPosition, null);
  check('rerendering the same opportunity never touches Current Offer, even with a DIFFERENT snapshot value on record', rerender.restoreCurrentOffer, null);
  check('the ref is carried forward unchanged on an ordinary rerender', rerender.nextRef, alreadyHydrated);
}

// ============================================================
// The rare pending-eligibility retry (identity unchanged, not yet
// hydrated -- e.g. a fetch still resolving) must protect a live edit
// PER FIELD, exactly like the ordinary "untouched" convention elsewhere
// on this page: a field the operator already typed into is left alone
// even while the other field still restores.
// ============================================================
{
  const pendingForOpp1 = { dealId: 'opp-1', hydrated: false };
  const retryWithOneFieldEdited = resolveResumeHydration({
    prevRef: pendingForOpp1, currentDealId: 'opp-1', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: 190000 },
    sellerPositionInput: '777777', currentOfferInput: '',
  });
  check('a pending-retry pass is NOT a clear (identity did not change)', retryWithOneFieldEdited.clear, false);
  check('an operator-typed Seller Position survives even a same-identity retry', retryWithOneFieldEdited.restoreSellerPosition, null);
  check('an untouched Current Offer still restores on the same retry', retryWithOneFieldEdited.restoreCurrentOffer, '190000');
  check('the retry still marks the opportunity hydrated (decided once, not retried forever)', retryWithOneFieldEdited.nextRef, { dealId: 'opp-1', hydrated: true });
}

// ============================================================
// Absent/null snapshot values remain empty -- never a fabricated zero or
// default, whether there is no outcome at all or a partial one.
// ============================================================
{
  const noOutcomeAtAll = resolveResumeHydration({
    prevRef: NOT_SELECTED, currentDealId: 'opp-fresh', loading: false, latestOutcome: null,
    sellerPositionInput: '', currentOfferInput: '',
  });
  check('a brand-new deal with no recorded outcome restores nothing (stays empty from the clear, never a fabricated zero)', {
    seller: noOutcomeAtAll.restoreSellerPosition, offer: noOutcomeAtAll.restoreCurrentOffer,
  }, { seller: null, offer: null });

  const partialOutcome = resolveResumeHydration({
    prevRef: NOT_SELECTED, currentDealId: 'opp-partial', loading: false,
    latestOutcome: { sellerPosition: 250000, currentOffer: null },
    sellerPositionInput: '', currentOfferInput: '',
  });
  check('a partial snapshot (Current Offer unavailable at the moment of the outcome) restores ONLY the present field', {
    seller: partialOutcome.restoreSellerPosition, offer: partialOutcome.restoreCurrentOffer,
  }, { seller: '250000', offer: null });
}

// ============================================================
// Structural proof: no GHL/network/React reference of any kind, and no
// second economics engine -- this module only ever restores the two
// snapshot fields it is handed, verbatim.
// ============================================================
{
  check('compiled output makes no GHL/network call of any kind', /fetch\(|ghl\.|PROXY|XMLHttpRequest/.test(compiledNoComments), false);
  check('compiled output has no React import (pure decision logic, applied by the page)', /require\("react"\)|from "react"/.test(compiledNoComments), false);
  check('compiled output never recomputes Target/Max/Spread (no 25%/$5,000 formula, no endBuyerMaxPrice arithmetic)', /0\.25|Math\.max|endBuyerMaxPrice/.test(compiledNoComments), false);
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
