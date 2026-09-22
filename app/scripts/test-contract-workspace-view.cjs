/**
 * Contract Workspace -- page-state view model, test runner. B9-04 / INV-59.
 *
 * Compiles contract-workspace-view.ts and its three dependencies
 * (seller-call-outcome.ts, seller-call-readiness-carriers.ts,
 * board9-contract-model.ts -- all already-shipped, unmodified by this
 * issue) to a temp directory, loads the emitted JavaScript, and runs
 * deterministic table-driven cases. No GHL, no network, no React.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-workspace-view-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-workspace-view.ts'),
  path.join(LIB, 'seller-call-outcome.ts'),
  path.join(LIB, 'seller-call-readiness-carriers.ts'),
  path.join(LIB, 'board9-contract-model.ts'),
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

const viewPath = path.join(TMP, 'contract-workspace-view.js');
if (!fs.existsSync(viewPath)) {
  console.error('ABORT: expected compiled output at ' + viewPath);
  cleanup();
  process.exit(11);
}

const {
  computeContractScreenState, showRecordGhlSendControl, showVerifyExecutionControl, showDispositionHandoffControl, showStartDispositionControl,
} = require(viewPath);
const { formatOutcomeNote } = require(path.join(TMP, 'seller-call-outcome.js'));
const { formatContractReadyChecklistNote } = require(path.join(TMP, 'seller-call-readiness-carriers.js'));

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

function fullSnapshot(over) {
  return Object.assign({
    sellerPosition: 250000, currentOffer: 190000, targetAcquisitionPrice: 169551,
    maxSupportedOffer: 176363, expectedSpread: 5000, arv: 315000, repairs: 41000,
    readinessStatus: 'OFFER_READY',
  }, over || {});
}

const OPP = { id: 'opp-1', name: 'Jane Seller' };
const ADDRESS = '123 Main St, Austin, TX 78701';

const fullChecklistItems = {
  legal_owners: true, closing_timeline: true, occupancy_possession: true,
  liens_title: true, delivery_signing: true,
};
const partialChecklistItems = { ...fullChecklistItems, liens_title: false };

// ============================================================
// Loading / error / selection states -- the page-orchestration states
// this module owns, exercised before any opportunity-specific data.
// ============================================================
{
  check('fetchError takes priority over everything else, including loading', computeContractScreenState({
    loading: true, fetchError: 'network down', candidates: [], selected: null, notes: null, propertyAddress: '',
  }), { state: 'fetch_error', message: 'network down' });

  check('loading, no error yet', computeContractScreenState({
    loading: true, fetchError: null, candidates: [], selected: null, notes: null, propertyAddress: '',
  }), { state: 'loading' });

  check('no candidates at all', computeContractScreenState({
    loading: false, fetchError: null, candidates: [], selected: null, notes: [], propertyAddress: ADDRESS,
  }), { state: 'no_opportunity' });

  const candidates = [OPP, { id: 'opp-2', name: 'Other Deal' }];
  check('multiple candidates, none chosen -- never assumes the first', computeContractScreenState({
    loading: false, fetchError: null, candidates, selected: null, notes: [], propertyAddress: ADDRESS,
  }), { state: 'awaiting_selection', candidates });
}

// ============================================================
// UNAVAILABLE-AUTHORITATIVE-DATA case, required: no accept outcome
// stands (none at all, or a non-accept outcome), and no Contract Ready
// history exists either -- nothing to show, fails closed, not an error.
// ============================================================
{
  check('no outcome note at all for this opportunity', computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP, notes: [], propertyAddress: ADDRESS,
  }), { state: 'no_agreement', opportunity: OPP, latestOutcomeKind: null });

  const followUpNote = formatOutcomeNote({
    opportunityId: OPP.id, kind: 'follow_up', at: '2026-09-01T10:00:00.000Z', operator: null,
    snapshot: fullSnapshot(), reason: null, followUpAt: '2026-09-08T10:00:00.000Z',
  });
  check('the current standing outcome is follow_up, no checklist history -- still no_agreement, not an error', computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP, notes: [{ body: followUpNote }], propertyAddress: ADDRESS,
  }), { state: 'no_agreement', opportunity: OPP, latestOutcomeKind: 'follow_up' });

  // Required: economics unavailable -- an accept exists but its own
  // Current Offer is missing (a corrupt/legacy record), so
  // deriveInheritedEconomics's own precondition (checked at the view
  // layer first) refuses to treat it as authoritative.
  const acceptNoOfferNote = formatOutcomeNote({
    opportunityId: OPP.id, kind: 'accept', at: '2026-09-06T15:00:00.000Z', operator: null,
    snapshot: fullSnapshot({ currentOffer: null }), reason: null, followUpAt: null,
  });
  const economicsUnavailable = computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP, notes: [{ body: acceptNoOfferNote }], propertyAddress: ADDRESS,
  });
  check('an accept outcome with no recorded Current Offer is economics_unavailable, never guessed', economicsUnavailable.state, 'economics_unavailable');
  check('the economics_unavailable reason names Current Offer specifically', economicsUnavailable.reason.toLowerCase().indexOf('current offer') >= 0, true);
}

// ============================================================
// CONFLICTING case, required: the current standing outcome is NOT an
// accept, yet Contract Ready checklist history exists for this
// opportunity -- a genuine conflict between Board 8's current state and
// Board 9 artifacts, surfaced explicitly rather than resolved silently.
// ============================================================
{
  const oldAcceptAt = '2026-08-01T10:00:00.000Z';
  const oldChecklistNote = formatContractReadyChecklistNote({
    opportunityId: OPP.id, at: '2026-08-02T09:00:00.000Z', operator: null,
    agreementAt: oldAcceptAt, agreedPrice: 200000, propertyAddress: ADDRESS, items: fullChecklistItems,
  });
  const passNote = formatOutcomeNote({
    opportunityId: OPP.id, kind: 'pass', at: '2026-09-01T00:00:00.000Z', operator: null,
    snapshot: fullSnapshot(), reason: 'Seller changed their mind after checklist work began.', followUpAt: null,
  });
  const conflicting = computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP,
    notes: [{ body: oldChecklistNote }, { body: passNote }], propertyAddress: ADDRESS,
  });
  check('a Pass outcome coexisting with prior Contract Ready history is conflicting_history, not silently resolved', conflicting.state, 'conflicting_history');
  check('conflicting_history names the actual current outcome kind (pass)', conflicting.latestOutcomeKind, 'pass');
  check('conflicting_history names when the conflicting checklist history was recorded', conflicting.priorChecklistAt, '2026-08-02T09:00:00.000Z');

  // Same conflict, but with NO outcome note at all (only orphaned
  // checklist history) -- still conflicting_history, latestOutcomeKind null.
  const conflictingNoOutcome = computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP,
    notes: [{ body: oldChecklistNote }], propertyAddress: ADDRESS,
  });
  check('orphaned checklist history with NO outcome note at all is also conflicting_history', conflictingNoOutcome.state, 'conflicting_history');
  check('the orphaned-history case has latestOutcomeKind null', conflictingNoOutcome.latestOutcomeKind, null);
}

// ============================================================
// COMPLETE case, required: Agreement Reached, checklist scoped correctly,
// all five items confirmed -- Contract Ready holds.
// ============================================================
{
  const acceptAt = '2026-09-06T15:00:00.000Z';
  const acceptNote = formatOutcomeNote({
    opportunityId: OPP.id, kind: 'accept', at: acceptAt, operator: null,
    snapshot: fullSnapshot(), reason: null, followUpAt: null,
  });
  const checklistNote = formatContractReadyChecklistNote({
    opportunityId: OPP.id, at: '2026-09-07T09:00:00.000Z', operator: null,
    agreementAt: acceptAt, agreedPrice: 190000, propertyAddress: ADDRESS, items: fullChecklistItems,
  });
  const complete = computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP,
    notes: [{ body: acceptNote }, { body: checklistNote }], propertyAddress: ADDRESS,
  });
  check('complete: state is ready', complete.state, 'ready');
  check('complete: readiness.ready is true', complete.readiness.ready, true);
  check('complete: no readiness reasons at all', complete.readiness.reasons, []);
  check('complete: economics are the verbatim accepted snapshot, never recomputed', complete.economics.economics, fullSnapshot());
  check('complete: agreementAt is the accept outcome\'s own durable timestamp', complete.economics.agreementAt, acceptAt);
  check('complete: agreedPrice is narrowed to the real number, no cast needed by the caller', complete.agreedPrice, 190000);
  check('complete: is NOT stale', complete.isStale, false);
  check('complete: staleInfo is null', complete.staleInfo, null);

  // ============================================================
  // INCOMPLETE case, required: Agreement Reached, checklist scoped
  // correctly, some items still unconfirmed -- Contract Ready does not
  // hold, and each missing item is named individually.
  // ============================================================
  const incompleteChecklistNote = formatContractReadyChecklistNote({
    opportunityId: OPP.id, at: '2026-09-07T09:00:00.000Z', operator: null,
    agreementAt: acceptAt, agreedPrice: 190000, propertyAddress: ADDRESS, items: partialChecklistItems,
  });
  const incomplete = computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP,
    notes: [{ body: acceptNote }, { body: incompleteChecklistNote }], propertyAddress: ADDRESS,
  });
  check('incomplete: state is ready (Agreement Reached exists) but readiness is not', incomplete.state, 'ready');
  check('incomplete: readiness.ready is false', incomplete.readiness.ready, false);
  check('incomplete: exactly one reason, naming the one unconfirmed item', incomplete.readiness.reasons.length, 1);
  check('incomplete: the reason names CHECKLIST_ITEM_INCOMPLETE, not a scope mismatch', incomplete.readiness.reasons[0].code, 'CHECKLIST_ITEM_INCOMPLETE');
  check('incomplete: is NOT stale (same agreement, just unfinished)', incomplete.isStale, false);

  // Never started at all (accept exists, zero checklist notes ever) --
  // still "incomplete" in spirit: five missing items, never a scope
  // mismatch, since nothing foreign was ever recorded.
  const neverStarted = computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP,
    notes: [{ body: acceptNote }], propertyAddress: ADDRESS,
  });
  check('never-started checklist reads as five incomplete items, not a scope mismatch', neverStarted.readiness.reasons.length, 5);
  check('never-started checklist is not stale', neverStarted.isStale, false);

  // ============================================================
  // REVISED/STALE case, required: the agreement itself changed (a new
  // accept, e.g. a renegotiated price) after Contract Ready checklist
  // work had already begun on the PRIOR agreement -- prior progress must
  // never silently carry over, and the page must be able to say so.
  // ============================================================
  const revisedAcceptAt = '2026-09-10T12:00:00.000Z';
  const revisedAcceptNote = formatOutcomeNote({
    opportunityId: OPP.id, kind: 'accept', at: revisedAcceptAt, operator: null,
    snapshot: fullSnapshot({ currentOffer: 205000 }), reason: null, followUpAt: null,
  });
  const revised = computeContractScreenState({
    loading: false, fetchError: null, candidates: [OPP], selected: OPP,
    notes: [{ body: acceptNote }, { body: checklistNote }, { body: revisedAcceptNote }], propertyAddress: ADDRESS,
  });
  check('revised: state is still ready (a new Agreement Reached exists)', revised.state, 'ready');
  check('revised: the NEW accepted price is what is shown, never the stale one', revised.economics.economics.currentOffer, 205000);
  check('revised: agreedPrice reflects the NEW agreement too', revised.agreedPrice, 205000);
  check('revised: readiness is not ready', revised.readiness.ready, false);
  check('revised: readiness reports exactly the scope-mismatch reason, not five fake per-item reasons', revised.readiness.reasons, [{ code: 'CHECKLIST_SCOPE_MISMATCH', message: 'The Contract Ready checklist on record does not match this agreement\'s own price, address, and agreement timestamp -- it cannot count as progress toward this agreement.' }]);
  check('revised: IS stale', revised.isStale, true);
  check('revised: staleInfo names the SUPERSEDED agreement\'s own price', revised.staleInfo.priorPrice, 190000);
  check('revised: staleInfo names the superseded agreementAt', revised.staleInfo.priorAgreementAt, acceptAt);
  check('revised: checklistItems reset to all-false for the new agreement (never inherits stale checkmarks)', revised.checklistItems, { legal_owners: false, closing_timeline: false, occupancy_possession: false, liens_title: false, delivery_signing: false });

  // ============================================================
  // Downstream post-send control visibility -- B9-13 authorization-
  // hydration repair, gate-review correction (2026-09-21). `complete`
  // above is a real, computed "ready" screen state (not a hand-typed
  // stand-in), reused here exactly as ContractWorkspace.tsx itself would
  // supply it to each predicate. Record/send/Under-Contract objects are
  // intentionally minimal, structural stand-ins -- these predicates read
  // only the fields named in their own signatures.
  // ============================================================
  const notReady = { state: 'loading' };
  const someRecord = { schema: 'iaos-brad-contract-authorization-v2' };
  const acceptedSend = { status: 'accepted' };
  const pendingSend = { status: 'pending' };
  const someUnderContractRecord = { opportunityId: OPP.id };

  // 1. Record GHL Send -- the FIRST post-send control. Visible once a
  // durable authorization exists and the agreement is ready, for as long
  // as no send has yet been recorded as accepted.
  check('Record GHL Send: ready + durable authorization + no send yet -> shown', showRecordGhlSendControl(complete, someRecord, null), true);
  check('Record GHL Send: ready + durable authorization + a PENDING (not accepted) send -> still shown', showRecordGhlSendControl(complete, someRecord, pendingSend), true);
  check('Record GHL Send: not ready -> never shown, regardless of authorization', showRecordGhlSendControl(notReady, someRecord, null), false);
  check('Record GHL Send: ready but no authorization record -> not shown', showRecordGhlSendControl(complete, null, null), false);
  check('Record GHL Send: once a send is ACCEPTED, this control steps aside for Verify Execution', showRecordGhlSendControl(complete, someRecord, acceptedSend), false);

  // 2. Verify Execution & Under Contract -- visible once, and only once,
  // a manually-recorded send is accepted.
  check('Verify Execution: an accepted send -> shown', showVerifyExecutionControl(acceptedSend), true);
  check('Verify Execution: no send recorded yet -> not shown', showVerifyExecutionControl(null), false);
  check('Verify Execution: a send recorded but not yet accepted -> not shown', showVerifyExecutionControl(pendingSend), false);

  // 3. Start Disposition -- visible only once a genuine, parsed Under
  // Contract record exists (independent of the two controls above, which
  // by design never themselves determine this one).
  check('Disposition Handoff: a parsed Under Contract record exists -> shown', showDispositionHandoffControl(someUnderContractRecord), true);
  check('Disposition Handoff: no Under Contract record -> not shown', showDispositionHandoffControl(null), false);

  // ============================================================
  // 4. Start Disposition -- gate-review §5 ruling. The REAL, durable
  // three-part gate: a genuine Under Contract record, a genuine preserved
  // executed-artifact record, AND a freshly-confirmed live GHL stage.
  // "Reload proof": every case below is expressed purely in terms of
  // what a completely FRESH page load would compute these three inputs
  // to be -- there is no session/transition state involved anywhere in
  // this function's signature, which is itself the proof that a reload
  // (browser-local `stageTransitionState` resetting to "idle") can never
  // hide a genuinely, durably complete Board #9.
  // ============================================================
  const somePreservedArtifactRecord = { opportunityId: OPP.id, sha256: 'a'.repeat(64) };

  check('Start Disposition: fresh load, ONLY the Under Contract record exists -> remains hidden', showStartDispositionControl(someUnderContractRecord, null, false), false);
  check('Start Disposition: fresh load, record + preserved PDF exist, but live stage not yet confirmed -> remains hidden', showStartDispositionControl(someUnderContractRecord, somePreservedArtifactRecord, false), false);
  check('Start Disposition: fresh load, record + live stage confirmed, but NO preserved PDF -> remains hidden', showStartDispositionControl(someUnderContractRecord, null, true), false);
  check('Start Disposition: fresh load, preserved PDF + live stage confirmed, but NO Under Contract record -> remains hidden', showStartDispositionControl(null, somePreservedArtifactRecord, true), false);
  check('Start Disposition: fresh load, opportunity confirmed in the WRONG pipeline or stage (underContractStageConfirmed computed false) -> remains hidden even with record + PDF both present', showStartDispositionControl(someUnderContractRecord, somePreservedArtifactRecord, false), false);
  check('Start Disposition: fresh load, ALL THREE durable facts hold (record + preserved PDF + exact live GHL stage) -> appears', showStartDispositionControl(someUnderContractRecord, somePreservedArtifactRecord, true), true);
  // The function takes no session/transition-state parameter at all --
  // calling it with the exact same three durable facts always yields the
  // exact same result, whether or not a stage transition was ever
  // attempted THIS session, and regardless of any browser-local state
  // having since reset. This is the "remains available after
  // stageTransitionState resets" proof: the gate was never reading it.
  check('Start Disposition: identical durable facts yield an identical result independent of any transition/session state (the function has no such parameter to reset)', showStartDispositionControl(someUnderContractRecord, somePreservedArtifactRecord, true), true);
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
