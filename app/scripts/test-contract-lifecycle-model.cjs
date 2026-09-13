/**
 * Board #9 lifecycle -- deterministic model + carrier test runner.
 * B9-09 / INV-64. Jess Gate final repair round, 2026-09-12.
 *
 * Compiles contract-lifecycle-model.ts, contract-lifecycle-carriers.ts, and
 * their board9-contract-model.ts / contract-send-carriers.ts dependency
 * chain (unmodified by this issue) to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases mapped directly to
 * INV-64's own "Proof required" list PLUS the two final Jess Gate repair
 * blockers (provider-evidence version binding, truthful iaos_observed vs
 * provider_reported authority) and the small duplicate-detection
 * consistency fix. Every provider response and every INV-63 send record
 * used here is a SIMULATED fixture object -- no network call, no live GHL
 * call, no `ghl.notes.create()`, matching this entire codebase's own
 * established testing convention. No Production location, credential, or
 * write path is referenced anywhere in this file.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-lifecycle-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-lifecycle-model.ts'),
  path.join(LIB, 'contract-lifecycle-carriers.ts'),
  path.join(LIB, 'board9-contract-model.ts'),
  path.join(LIB, 'seller-call-outcome.ts'),
  path.join(LIB, 'seller-call-readiness-carriers.ts'),
  path.join(LIB, 'contract-send-carriers.ts'),
  path.join(LIB, 'contract-authorization-carriers.ts'),
];

try {
  execSync(
    'npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') +
    ' --outDir "' + TMP + '" --rootDir "' + APP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const LIB_OUT = path.join(TMP, 'src', 'lib');
const M = require(path.join(LIB_OUT, 'contract-lifecycle-model.js'));
const K = require(path.join(LIB_OUT, 'contract-lifecycle-carriers.js'));
const B = require(path.join(LIB_OUT, 'board9-contract-model.js'));

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
function checkTrue(name, actual) { check(name, actual, true); }
function checkFalse(name, actual) { check(name, actual, false); }
function checkNull(name, actual) { check(name, actual, null); }

const OPP = 'opp-1';
const OTHER_OPP = 'opp-2';
const AGREEMENT_AT = '2026-09-06T15:00:00.000Z';
const NEW_AGREEMENT_AT = '2026-09-15T10:00:00.000Z';
const OBSERVED_AT_1 = '2026-09-12T10:00:00.000Z';
const OBSERVED_AT_2 = '2026-09-12T11:00:00.000Z';
const OBSERVED_AT_3 = '2026-09-13T09:00:00.000Z';
const PROVIDER_REPORTED_AT = '2026-09-12T09:59:00.000Z';
const DOC_ID = 'doc-fixture-1';
const OTHER_DOC_ID = 'doc-fixture-2';
const LOCATION_ID = 'loc-test-1';
const V1 = B.initialVersionIdentity(AGREEMENT_AT);
const V2 = { agreementAt: V1.agreementAt, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };

/* ====================================================================== */
/* Fixture helpers                                                        */
/* ====================================================================== */

/** A real-shaped INV-63 `ParsedContractSend` -- the ONLY authoritative binding evidence the repaired builders accept. */
function acceptedSendFixture(over) {
  return Object.assign({
    opportunityId: OPP,
    at: OBSERVED_AT_1,
    operator: 'brad',
    attemptId: OBSERVED_AT_1,
    status: 'accepted',
    version: V1,
    templateName: 'Purchase Agreement',
    templateSource: 'ghl',
    requestedTemplateId: 'tmpl-1',
    authorizedAt: OBSERVED_AT_1,
    signers: [],
    confirmedRecipientId: 'recipient-1',
    expirationAt: '2026-09-20T00:00:00.000Z',
    requestAt: OBSERVED_AT_1,
    iaosObservedAcceptanceAt: OBSERVED_AT_1,
    providerResponse: {
      documentId: DOC_ID,
      documentReference: 'ref-1',
      documentRevision: 1,
      recipientId: 'recipient-1',
      createdBy: 'sender-1',
      readbackStatus: 'sent',
      readbackLocationId: LOCATION_ID,
      fillableFieldCount: 3,
    },
    failureReason: null,
  }, over || {});
}

function outcomeWithDocument(docOverrides) {
  return {
    kind: 'http_response',
    status: 200,
    body: {
      documents: [Object.assign({
        documentId: DOC_ID,
        locationId: LOCATION_ID,
        status: 'sent',
        referenceId: 'ref-1',
        documentRevision: 1,
        updatedAt: PROVIDER_REPORTED_AT,
        deleted: false,
        recipients: [{ id: 'r1', hasCompleted: false }],
      }, docOverrides || {})],
    },
  };
}

function providerObservationFromOutcome(over) {
  const built = M.buildProviderObservationRecordFromReadback(Object.assign({
    opportunityId: OPP,
    version: V1,
    expectedDocumentId: DOC_ID,
    expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}),
    outcome: outcomeWithDocument({}),
    iaosObservedAt: OBSERVED_AT_1,
    evidenceSummary: 'GET /proposals/document readback, documentId=' + DOC_ID + '.',
    relatedPriorRecordId: null,
  }, over || {}));
  if (!built.ok) throw new Error('fixture buildProviderObservationRecordFromReadback failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

function correctionRecord(over) {
  const classification = { kind: 'same_agreement_reentry' };
  const built = M.buildCorrectionRecord(Object.assign({
    opportunityId: OPP,
    priorVersion: V1,
    classification,
    newAgreementAt: null,
    recordedBy: 'rep-1',
    iaosObservedAt: OBSERVED_AT_1,
    evidenceSummary: 'Wording-only correction, no accepted term changed.',
    relatedPriorRecordId: null,
  }, over || {}));
  if (!built.ok) throw new Error('fixture buildCorrectionRecord failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

function resendRecord(over) {
  const built = M.buildResendRecord(Object.assign({
    opportunityId: OPP,
    version: V1,
    priorSend: acceptedSendFixture({ attemptId: OBSERVED_AT_1, status: 'accepted' }),
    newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_2,
    recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2,
    evidenceSummary: 'Resend of identical document after seller requested a fresh link.',
    relatedPriorRecordId: null,
  }, over || {}));
  if (!built.ok) throw new Error('fixture buildResendRecord failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

function rescissionRecord(over) {
  const built = M.buildRescissionRecord(Object.assign({
    opportunityId: OPP,
    version: V1,
    reason: 'Seller withdrew verbally; confirmed in writing.',
    authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_3,
    acceptedSend: acceptedSendFixture({}),
    iaosObservedAt: OBSERVED_AT_3,
    evidenceSummary: 'Brad-recorded rescission.',
    relatedPriorRecordId: null,
  }, over || {}));
  if (!built.ok) throw new Error('fixture buildRescissionRecord failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

function declineRecord(over) {
  const built = M.buildDeclineRecord(Object.assign({
    opportunityId: OPP,
    version: V1,
    acceptedSend: acceptedSendFixture({}),
    reasonOrEvidence: 'Seller called and said they will not sign.',
    recordedBy: 'rep-1',
    declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3,
    evidenceSummary: 'Operator-recorded decline call.',
    relatedPriorRecordId: null,
  }, over || {}));
  if (!built.ok) throw new Error('fixture buildDeclineRecord failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

/* ====================================================================== */
/* 1. Every normalized lifecycle state, and the unknown fallback          */
/* ====================================================================== */

check('normalize: sent', M.normalizeProviderLifecycleStatus({ status: 'sent', isExpired: null, deleted: null, recipients: [] }), 'sent');
check('normalize: viewed -> delivered_or_viewed', M.normalizeProviderLifecycleStatus({ status: 'viewed', isExpired: null, deleted: null, recipients: [] }), 'delivered_or_viewed');
check('normalize: completed, all recipients complete', M.normalizeProviderLifecycleStatus({ status: 'completed', isExpired: null, deleted: null, recipients: [{ hasCompleted: true }, { hasCompleted: true }] }), 'completed');
check('normalize: completed status but recipients show real mixed completion -> partially_signed (per-recipient evidence wins over the aggregate label)', M.normalizeProviderLifecycleStatus({ status: 'completed', isExpired: null, deleted: null, recipients: [{ hasCompleted: true }, { hasCompleted: false }] }), 'partially_signed');
check('normalize: completed status with NO corroborating per-recipient completion at all -> unknown (genuine conflict, never trusted)', M.normalizeProviderLifecycleStatus({ status: 'completed', isExpired: null, deleted: null, recipients: [] }), 'unknown');
check('normalize: completed status but every recipient reports false -> unknown (genuine conflict, never trusted)', M.normalizeProviderLifecycleStatus({ status: 'completed', isExpired: null, deleted: null, recipients: [{ hasCompleted: false }, { hasCompleted: false }] }), 'unknown');
check('normalize: some but not all recipients complete -> partially_signed, regardless of status', M.normalizeProviderLifecycleStatus({ status: 'sent', isExpired: null, deleted: null, recipients: [{ hasCompleted: true }, { hasCompleted: false }] }), 'partially_signed');
check('normalize: isExpired true takes priority over status', M.normalizeProviderLifecycleStatus({ status: 'sent', isExpired: true, deleted: null, recipients: [] }), 'expired');
check('normalize: deleted -> unknown', M.normalizeProviderLifecycleStatus({ status: 'sent', isExpired: null, deleted: true, recipients: [] }), 'unknown');
check('normalize: draft (documented GHL value, never expected post-send) -> unknown', M.normalizeProviderLifecycleStatus({ status: 'draft', isExpired: null, deleted: null, recipients: [] }), 'unknown');
check('normalize: accepted (documented, ambiguous vs completed) -> unknown, never guessed', M.normalizeProviderLifecycleStatus({ status: 'accepted', isExpired: null, deleted: null, recipients: [] }), 'unknown');
check('normalize: declined (UNDOCUMENTED by GHL) -> unknown, proves the limitation', M.normalizeProviderLifecycleStatus({ status: 'declined', isExpired: null, deleted: null, recipients: [] }), 'unknown');
check('normalize: voided (UNDOCUMENTED by GHL) -> unknown, proves the limitation', M.normalizeProviderLifecycleStatus({ status: 'voided', isExpired: null, deleted: null, recipients: [] }), 'unknown');
check('normalize: canceled (UNDOCUMENTED by GHL) -> unknown, proves the limitation', M.normalizeProviderLifecycleStatus({ status: 'canceled', isExpired: null, deleted: null, recipients: [] }), 'unknown');
check('normalize: null status -> unknown', M.normalizeProviderLifecycleStatus({ status: null, isExpired: null, deleted: null, recipients: [] }), 'unknown');
check('normalize: entirely unrecognized raw string -> unknown', M.normalizeProviderLifecycleStatus({ status: 'some-future-provider-value', isExpired: null, deleted: null, recipients: [] }), 'unknown');

checkTrue(
  'declined and voided_or_canceled are declared reachable statuses but NOT currently producible from real readback (documented limitation)',
  M.PROVIDER_LIFECYCLE_STATUSES.includes('declined') &&
  M.PROVIDER_LIFECYCLE_STATUSES.includes('voided_or_canceled') &&
  !M.PROVIDER_EVIDENCED_REACHABLE_STATUSES.includes('declined') &&
  !M.PROVIDER_EVIDENCED_REACHABLE_STATUSES.includes('voided_or_canceled'),
);

check('readback outcome: network error -> provider_error, distinct from unknown', M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID, outcome: { kind: 'network_error', message: 'ECONNRESET' } }).status, 'provider_error');
check('readback outcome: HTTP 500 -> provider_error', M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID, outcome: { kind: 'http_response', status: 500, body: {} } }).status, 'provider_error');
check('readback outcome: 200 but no documents[] -> unknown', M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID, outcome: { kind: 'http_response', status: 200, body: {} } }).status, 'unknown');
check('readback outcome: document not found in list -> unknown', M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID, outcome: { kind: 'http_response', status: 200, body: { documents: [{ documentId: OTHER_DOC_ID }] } } }).status, 'unknown');

/* ====================================================================== */
/* 2. BLOCKER 1: provider evidence is bound to its contract version via   */
/*    a real INV-63 accepted-send record, never independent assertions   */
/* ====================================================================== */

{
  const good = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: outcomeWithDocument({}),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('valid, matching send evidence allows the observation to be built', good.ok);
}
{
  // A completed readback for document A cannot be labeled as evidence for
  // a DIFFERENT opportunity merely by passing a different opportunityId --
  // the accepted-send evidence's OWN opportunityId must match.
  const wrongOpp = M.buildProviderObservationRecordFromReadback({
    opportunityId: OTHER_OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), // still says opportunityId: OPP
    outcome: outcomeWithDocument({ status: 'completed', recipients: [{ hasCompleted: true }] }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('provider evidence cannot cross an OPPORTUNITY boundary via mismatched send evidence', wrongOpp.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH', wrongOpp.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH');
}
{
  // A valid completed readback for document A cannot be labeled as
  // lifecycle evidence for contract VERSION B simply by passing version B
  // -- the exact scenario the repair item names.
  const wrongVersion = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V2, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), // still says version: V1
    outcome: outcomeWithDocument({ status: 'completed', recipients: [{ hasCompleted: true }] }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a completed readback for one contract version cannot be labeled as evidence for a DIFFERENT version', wrongVersion.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH', wrongVersion.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH');
}
{
  // The declared expectedDocumentId must match the send evidence's own document id.
  const wrongDoc = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: OTHER_DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), // says providerResponse.documentId: DOC_ID
    outcome: outcomeWithDocument({ documentId: OTHER_DOC_ID, status: 'completed', recipients: [{ hasCompleted: true }] }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('provider evidence cannot cross a PROVIDER DOCUMENT boundary', wrongDoc.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_DOCUMENT_MISMATCH', wrongDoc.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_DOCUMENT_MISMATCH');
}
{
  // The provider's currently-observed revision conflicting with the
  // revision recorded at send time is refused, not silently trusted.
  const revisionConflict = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({ providerResponse: Object.assign({}, acceptedSendFixture({}).providerResponse, { documentRevision: 1 }) }),
    outcome: outcomeWithDocument({ documentRevision: 2 }), // live readback reports a DIFFERENT revision
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('provider evidence cannot cross a conflicting PROVIDER REVISION boundary', revisionConflict.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_REVISION_CONFLICT', revisionConflict.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_REVISION_CONFLICT');
}
{
  // Absent send evidence -- required successful INV-63 send/readback
  // evidence is absent -- fails closed.
  const noSend = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({ status: 'failed', providerResponse: null }),
    outcome: outcomeWithDocument({}),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('provider evidence cannot be built without a real accepted INV-63 send record', noSend.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED', noSend.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED');
}
{
  // Malformed send evidence (accepted status but no real documentId) also fails closed.
  const malformedSend = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({ providerResponse: Object.assign({}, acceptedSendFixture({}).providerResponse, { documentId: '' }) }),
    outcome: outcomeWithDocument({}),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('malformed send evidence (blank documentId despite accepted status) fails closed', malformedSend.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED', malformedSend.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED');
}

// Same binding principle applied to resend.
{
  const good = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorSend: acceptedSendFixture({}), newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('resend succeeds when priorSend evidence genuinely matches', good.ok);
  check('resend derives priorAttemptId from the verified send evidence, never a bare caller string', good.value.priorAttemptId, acceptedSendFixture({}).attemptId);
}
{
  const wrongOpp = M.buildResendRecord({
    opportunityId: OTHER_OPP, version: V1, priorSend: acceptedSendFixture({}), newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('resend cannot cross an OPPORTUNITY boundary via mismatched priorSend', wrongOpp.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH', wrongOpp.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH');
}
{
  const wrongVersion = M.buildResendRecord({
    opportunityId: OPP, version: V2, priorSend: acceptedSendFixture({}), newAttemptId: OBSERVED_AT_2, // priorSend still V1
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('resend cannot cross a CONTRACT VERSION boundary via mismatched priorSend', wrongVersion.ok);
  check('failure reason is RESEND_VERSION_MUST_MATCH_PRIOR', wrongVersion.reasons[0].code, 'RESEND_VERSION_MUST_MATCH_PRIOR');
}
{
  const unresolved = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorSend: acceptedSendFixture({ status: 'in_progress', providerResponse: null }), newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a resend cannot be recorded against a still-unresolved prior attempt', unresolved.ok);
  check('failure reason is PRIOR_SEND_NOT_RESOLVED', unresolved.reasons[0].code, 'PRIOR_SEND_NOT_RESOLVED');
}

// Same binding principle applied to rescission (when a send occurred).
{
  const good = rescissionRecord();
  check('rescission derives providerDocumentIdAtRescission from verified send evidence', good.providerDocumentIdAtRescission, DOC_ID);
}
{
  const wrongOpp = M.buildRescissionRecord({
    opportunityId: OTHER_OPP, version: V1, reason: 'x', authorizedBy: 'brad', authorizedAt: OBSERVED_AT_3,
    acceptedSend: acceptedSendFixture({}), iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission cannot cross an OPPORTUNITY boundary via mismatched send evidence', wrongOpp.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH', wrongOpp.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH');
}
{
  const wrongVersion = M.buildRescissionRecord({
    opportunityId: OPP, version: V2, reason: 'x', authorizedBy: 'brad', authorizedAt: OBSERVED_AT_3,
    acceptedSend: acceptedSendFixture({}), iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission cannot cross a CONTRACT VERSION boundary via mismatched send evidence', wrongVersion.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH', wrongVersion.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH');
}
{
  const preSend = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Withdrawn before send.', authorizedBy: 'brad', authorizedAt: OBSERVED_AT_3,
    acceptedSend: null, iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('rescission before any send still succeeds with acceptedSend: null', preSend.ok);
  checkNull('no provider document identity is fabricated when the agreement was never sent', preSend.value.providerDocumentIdAtRescission);
}

// Same binding principle applied to decline.
{
  const good = declineRecord();
  check('decline derives providerDocumentIdAtDecline from verified send evidence', good.providerDocumentIdAtDecline, DOC_ID);
}
{
  const wrongOpp = M.buildDeclineRecord({
    opportunityId: OTHER_OPP, version: V1, acceptedSend: acceptedSendFixture({}),
    reasonOrEvidence: 'x', recordedBy: 'rep-1', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('decline cannot cross an OPPORTUNITY boundary via mismatched send evidence', wrongOpp.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH', wrongOpp.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH');
}
{
  const wrongVersion = M.buildDeclineRecord({
    opportunityId: OPP, version: V2, acceptedSend: acceptedSendFixture({}),
    reasonOrEvidence: 'x', recordedBy: 'rep-1', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('decline cannot cross a CONTRACT VERSION boundary via mismatched send evidence', wrongVersion.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH', wrongVersion.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH');
}
{
  const notSent = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, acceptedSend: acceptedSendFixture({ status: 'failed', providerResponse: null }),
    reasonOrEvidence: 'x', recordedBy: 'rep-1', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('decline requires a REAL accepted send -- refused otherwise', notSent.ok);
  check('failure reason is PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED', notSent.reasons[0].code, 'PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED');
}

/* ====================================================================== */
/* 3. BLOCKER 2: truthful evidence authority -- iaos_observed vs          */
/*    provider_reported, never impersonating each other                  */
/* ====================================================================== */

{
  const networkFailure = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'network_error', message: 'ECONNRESET' },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback network error: ECONNRESET', relatedPriorRecordId: null,
  }).value;
  check('a network error is truthfully recorded as iaos_observed, never provider_reported', networkFailure.authority, 'iaos_observed');
  check('a network error normalizes to provider_error', networkFailure.status, 'provider_error');
}
{
  const httpFailure = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'http_response', status: 500, body: {} },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback returned HTTP 500', relatedPriorRecordId: null,
  }).value;
  check('an HTTP failure is truthfully recorded as iaos_observed, never provider_reported', httpFailure.authority, 'iaos_observed');
}
{
  const malformed = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'http_response', status: 200, body: {} },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback response was not a JSON object.', relatedPriorRecordId: null,
  }).value;
  check('a malformed response (no documents[]) is truthfully recorded as iaos_observed', malformed.authority, 'iaos_observed');
  check('a malformed response normalizes to unknown', malformed.status, 'unknown');
}
{
  const missing = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'http_response', status: 200, body: { documents: [] } },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback returned no documents.', relatedPriorRecordId: null,
  }).value;
  check('a missing document is truthfully recorded as iaos_observed unknown', missing.authority, 'iaos_observed');
  check('a missing document normalizes to unknown', missing.status, 'unknown');
}
{
  const realRow = providerObservationFromOutcome({});
  check('a genuinely matching provider row is recorded as provider_reported', realRow.authority, 'provider_reported');
}
{
  // A location mismatch (a row WAS observed, just for the wrong environment) is still provider_reported.
  const wrongLocationRow = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: outcomeWithDocument({ locationId: 'loc-WRONG' }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  }).value;
  check('a location-mismatched but genuinely-observed row is STILL provider_reported (a row was really seen)', wrongLocationRow.authority, 'provider_reported');
  check('a location mismatch still normalizes to unknown', wrongLocationRow.status, 'unknown');
}

// Round-trip: authority is preserved exactly, per-scenario.
{
  const networkFailure = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'network_error', message: 'timeout' },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback network error: timeout', relatedPriorRecordId: null,
  }).value;
  const parsed = K.parseContractLifecycleNote(K.formatContractLifecycleNote(networkFailure));
  checkTrue('a network/HTTP-error observation round-trips', parsed !== null);
  check('round-trip preserves iaos_observed authority', parsed.authority, 'iaos_observed');
  check('round-trip preserves provider_error status', parsed.status, 'provider_error');
}
{
  const missing = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'http_response', status: 200, body: { documents: [] } },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback returned no documents.', relatedPriorRecordId: null,
  }).value;
  const parsed = K.parseContractLifecycleNote(K.formatContractLifecycleNote(missing));
  checkTrue('a missing/malformed-response observation round-trips', parsed !== null);
  check('round-trip preserves iaos_observed authority for a missing-document unknown', parsed.authority, 'iaos_observed');
  check('round-trip preserves unknown status', parsed.status, 'unknown');
}
{
  const realRow = providerObservationFromOutcome({});
  const parsed = K.parseContractLifecycleNote(K.formatContractLifecycleNote(realRow));
  checkTrue('a matching-row observation round-trips', parsed !== null);
  check('round-trip preserves provider_reported authority', parsed.authority, 'provider_reported');
}

// Tampering cannot move a note from one authority to the other.
{
  const networkFailureNote = K.formatContractLifecycleNote(M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'network_error', message: 'x' },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  }).value);
  const lines = networkFailureNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: provider_reported'; // tamper: claim the provider reported this failure
  checkNull('a provider_error note cannot be tampered into claiming provider_reported authority', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const realRowNote = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = realRowNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: iaos_observed'; // tamper: hide a real observed "sent" status behind iaos_observed
  checkNull('a genuinely observed "sent" note cannot be tampered into claiming iaos_observed authority', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  // iaos_observed can never carry raw provider fields -- tampering one in is rejected.
  const missingNote = K.formatContractLifecycleNote(M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'http_response', status: 200, body: { documents: [] } },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  }).value);
  const lines = missingNote.split('\n');
  const rawIdx = lines.findIndex((l) => l.startsWith('Raw provider status: '));
  lines[rawIdx] = 'Raw provider status: sent'; // tamper: fabricate raw evidence that was never observed
  checkNull('an iaos_observed note cannot be tampered into carrying fabricated raw provider evidence', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  // A malformed authority/status combination (iaos_observed + a row-derived status) is rejected outright, even freshly hand-built.
  const goodNote = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  const kindIdx = lines.findIndex((l) => l.startsWith('Event kind: '));
  lines[authorityIdx] = 'Authority: iaos_observed';
  // Event kind is still "sent" here (from the real row fixture) -- this combination is never valid.
  checkNull('iaos_observed authority combined with a row-derived status ("sent") is rejected', K.parseContractLifecycleNote(lines.join('\n')));
  check('(sanity) the event kind line really is "sent" in this fixture', lines[kindIdx], 'Event kind: sent');
}

/* ====================================================================== */
/* 4. Small consistency fix: duplicate detection compares every raw fact  */
/* ====================================================================== */

{
  const base = providerObservationFromOutcome({});
  const differentIsExpired = providerObservationFromOutcome({ outcome: outcomeWithDocument({ isExpired: true }) });
  checkFalse('observations with the same status but different isExpired are NOT duplicates', M.isDuplicateProviderObservation(base, differentIsExpired));
}
{
  const base = providerObservationFromOutcome({});
  const differentDeleted = providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'sent', deleted: undefined }) });
  // base has deleted:false (explicit), differentDeleted has deleted omitted -> null
  checkFalse('observations with the same status but different deleted are NOT duplicates', M.isDuplicateProviderObservation(base, differentDeleted));
}
{
  const base = providerObservationFromOutcome({});
  const differentRecipients = providerObservationFromOutcome({ outcome: outcomeWithDocument({ recipients: [{ hasCompleted: false }, { hasCompleted: false }] }) });
  checkFalse('observations with the same status but different recipient-completion counts are NOT duplicates', M.isDuplicateProviderObservation(base, differentRecipients));
}
{
  const base = providerObservationFromOutcome({});
  const differentReference = providerObservationFromOutcome({ outcome: outcomeWithDocument({ referenceId: 'ref-DIFFERENT' }) });
  checkFalse('observations with the same status but different providerDocumentReference are NOT duplicates', M.isDuplicateProviderObservation(base, differentReference));
}
{
  // Two genuinely different unknown observations (different underlying cause) must not be conflated as duplicates.
  const unknownA = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'http_response', status: 200, body: { documents: [] } },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  }).value;
  const unknownB = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}), outcome: { kind: 'http_response', status: 200, body: {} },
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  }).value;
  checkFalse('two "unknown" observations with different providerFailureReason are NOT duplicates', M.isDuplicateProviderObservation(unknownA, unknownB));
}
{
  const a = providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_1 });
  const b = providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_2 });
  checkTrue('two observations identical on every raw fact ARE duplicates, regardless of when each was recorded', M.isDuplicateProviderObservation(a, b));
}

/* ====================================================================== */
/* 5. Provider and authorized-human evidence cannot be confused           */
/* ====================================================================== */

checkTrue('provider_observation record carries a provider-only authority by construction', providerObservationFromOutcome({}).authority === 'provider_reported');

{
  const goodNote = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = goodNote.split('\n');
  const operatorIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[operatorIdx] = 'Operator: brad';
  checkNull('a provider-kind note with a forged human Operator is rejected outright', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const goodNote = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: operator_attested';
  checkNull('a provider-kind note with a forged human Authority column is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

checkTrue('correction record carries authority operator_attested', correctionRecord().authority === 'operator_attested');
{
  const note = K.formatContractLifecycleNote(correctionRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('correction note round-trips', parsed !== null && parsed.kind === 'correction');
}
{
  const goodNote = K.formatContractLifecycleNote(correctionRecord());
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: brad_authorized';
  checkNull('a correction note with a forged brad_authorized Authority is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const goodNote = K.formatContractLifecycleNote(correctionRecord());
  const lines = goodNote.split('\n');
  const rawStatusIdx = lines.findIndex((l) => l.startsWith('Raw provider status: '));
  lines[rawStatusIdx] = 'Raw provider status: sent';
  checkNull('a correction note carrying a raw provider status is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const goodNote = K.formatContractLifecycleNote(correctionRecord());
  const lines = goodNote.split('\n');
  const pdIdx = lines.findIndex((l) => l.startsWith('Provider document id: '));
  lines[pdIdx] = 'Provider document id: ' + DOC_ID;
  checkNull('a correction note carrying a provider document id is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

checkTrue('resend record carries authority brad_authorized', resendRecord().authority === 'brad_authorized');
{
  const note = K.formatContractLifecycleNote(resendRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('resend note round-trips', parsed !== null && parsed.kind === 'resend');
}
{
  const goodNote = K.formatContractLifecycleNote(resendRecord());
  const lines = goodNote.split('\n');
  const opIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[opIdx] = 'Operator: someone-else';
  checkNull('a resend note whose Operator is not the literal "brad" is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

checkTrue('rescission record carries authority brad_authorized', rescissionRecord().authority === 'brad_authorized');
{
  const note = K.formatContractLifecycleNote(rescissionRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('rescission note round-trips', parsed !== null && parsed.kind === 'rescission');
  check('rescission note preserves providerDocumentIdAtRescission', parsed.providerDocumentIdAtRescission, DOC_ID);
}
{
  const goodNote = K.formatContractLifecycleNote(rescissionRecord());
  const lines = goodNote.split('\n');
  const opIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[opIdx] = 'Operator: jess';
  checkNull('a rescission note whose Operator is not the literal "brad" is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

/* ====================================================================== */
/* 6. Human decline record                                                */
/* ====================================================================== */

checkTrue('decline record carries authority operator_attested -- never provider_reported/iaos_observed, never brad_authorized', declineRecord().authority === 'operator_attested');
{
  const note = K.formatContractLifecycleNote(declineRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('decline note round-trips', parsed !== null && parsed.kind === 'decline');
  check('decline note preserves opportunityId', parsed.opportunityId, OPP);
  check('decline note preserves contract version', JSON.stringify(parsed.version), JSON.stringify(V1));
  check('decline note preserves the affected provider document identity', parsed.providerDocumentIdAtDecline, DOC_ID);
  check('decline note preserves the recording operator', parsed.recordedBy, 'rep-1');
  check('decline note preserves declinedAt', parsed.declinedAt, OBSERVED_AT_3);
  check('decline note preserves reasonOrEvidence', parsed.reasonOrEvidence, 'Seller called and said they will not sign.');
}
{
  const byRep = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, acceptedSend: acceptedSendFixture({}),
    reasonOrEvidence: 'Text message: "not signing".', recordedBy: 'rep-2', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('a decline recorded by an operator other than brad succeeds -- no Brad-only restriction applies to Declined', byRep.ok);
}
{
  const goodNote = K.formatContractLifecycleNote(declineRecord());
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: provider_reported';
  checkNull('a decline note claiming provider_reported authority is rejected -- it can never impersonate provider evidence', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const goodNote = K.formatContractLifecycleNote(declineRecord());
  const lines = goodNote.split('\n');
  const rawStatusIdx = lines.findIndex((l) => l.startsWith('Raw provider status: '));
  lines[rawStatusIdx] = 'Raw provider status: declined';
  checkNull('a decline note carrying a raw provider status is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const declineNote = K.formatContractLifecycleNote(declineRecord());
  const declineLines = declineNote.split('\n');
  const declineKindLine = declineLines.find((l) => l.startsWith('Event kind: '));
  check('decline note uses the distinct "operator_declined" event kind, never colliding with the provider "declined" status', declineKindLine, 'Event kind: operator_declined');
}
{
  const blankReason = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, acceptedSend: acceptedSendFixture({}),
    reasonOrEvidence: '   ', recordedBy: 'rep-1', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a decline with no reason/evidence is refused -- never inferred from silence', blankReason.ok);
  check('failure reason is DECLINE_REASON_OR_EVIDENCE_BLANK', blankReason.reasons[0].code, 'DECLINE_REASON_OR_EVIDENCE_BLANK');
}
{
  const noOperator = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, acceptedSend: acceptedSendFixture({}),
    reasonOrEvidence: 'x', recordedBy: '', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a decline with no recording operator is refused', noOperator.ok);
  check('failure reason is DECLINE_RECORDED_BY_BLANK', noOperator.reasons[0].code, 'DECLINE_RECORDED_BY_BLANK');
}

/* ====================================================================== */
/* 7. Chronology remains append-only; duplicates do not erase history     */
/* ====================================================================== */

{
  const n1 = K.formatContractLifecycleNote(providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_1 }));
  const n2 = K.formatContractLifecycleNote(providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'viewed' }), iaosObservedAt: OBSERVED_AT_2 }));
  const n3ForOtherOpp = K.formatContractLifecycleNote(providerObservationFromOutcome({ opportunityId: OTHER_OPP, acceptedSend: acceptedSendFixture({ opportunityId: OTHER_OPP }), iaosObservedAt: OBSERVED_AT_3 }));
  const all = K.allContractLifecycleRecordsForOpportunity([{ body: n1 }, { body: n2 }, { body: n3ForOtherOpp }], OPP);
  check('allContractLifecycleRecordsForOpportunity returns exactly the records for this opportunity, all of them', all.length, 2);
  const ordered = M.orderRecordsChronologically(all);
  check('orderRecordsChronologically sorts append-only history oldest-first', ordered.map((r) => r.iaosObservedAt), [OBSERVED_AT_1, OBSERVED_AT_2]);
}

{
  const obsA = providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_1 });
  const obsB = providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_2 });
  checkTrue('isDuplicateProviderObservation recognizes two identical provider facts reported at different times', M.isDuplicateProviderObservation(obsA, obsB));
  const nA = K.formatContractLifecycleNote(obsA);
  const nB = K.formatContractLifecycleNote(obsB);
  const all = K.allContractLifecycleRecordsForOpportunity([{ body: nA }, { body: nB }], OPP);
  check('duplicate provider observations both remain in the append-only history -- neither is erased', all.length, 2);
  check('deriveLatestProviderStatus still resolves correctly across duplicates', M.deriveLatestProviderStatus(all, V1), 'sent');
}

/* ====================================================================== */
/* 8. Correction creates a distinguishable revision                       */
/* ====================================================================== */

{
  const reentry = M.buildCorrectionRecord({
    opportunityId: OPP, priorVersion: V1, classification: { kind: 'same_agreement_reentry' },
    newAgreementAt: null, recordedBy: 'rep-1', iaosObservedAt: OBSERVED_AT_1,
    evidenceSummary: 'Formatting fix only.', relatedPriorRecordId: null,
  });
  checkTrue('document-only correction succeeds', reentry.ok);
  check('document-only correction re-enters at Contract Ready on the SAME agreementAt (INV-68 rule)', reentry.value.newVersion.agreementAt, V1.agreementAt);
  check('document-only correction increments versionSeq -- a distinguishable revision', reentry.value.newVersion.versionSeq, V1.versionSeq + 1);
  check('document-only correction records supersedesVersionSeq', reentry.value.newVersion.supersedesVersionSeq, V1.versionSeq);
  checkTrue('the prior version is preserved verbatim inside the correction record, never erased', JSON.stringify(reentry.value.priorVersion) === JSON.stringify(V1));
}

{
  const material = M.buildCorrectionRecord({
    opportunityId: OPP, priorVersion: V1,
    classification: { kind: 'new_agreement_required', conflicts: [{ field: 'price', agreementValue: '190000', candidateValue: '210000' }] },
    newAgreementAt: NEW_AGREEMENT_AT, recordedBy: 'brad', iaosObservedAt: OBSERVED_AT_1,
    evidenceSummary: 'Price changed -- new Agreement Reached required.', relatedPriorRecordId: null,
  });
  checkTrue('material correction (price differs from snapshot) succeeds when a new agreementAt is supplied', material.ok);
  check('material correction starts a NEW lineage (new agreementAt), never reusing the prior one', material.value.newVersion.agreementAt, NEW_AGREEMENT_AT);
  check('material correction resets versionSeq to 1 for the new lineage', material.value.newVersion.versionSeq, 1);
  check('material correction records replacesAgreementAt, preserving the relationship without erasing the prior lineage', material.value.newVersion.replacesAgreementAt, V1.agreementAt);
  checkTrue('material correction preserves the material conflicts as evidence', material.value.materialConflicts.length === 1 && material.value.materialConflicts[0].field === 'price');
}

{
  const missing = M.buildCorrectionRecord({
    opportunityId: OPP, priorVersion: V1,
    classification: { kind: 'new_agreement_required', conflicts: [{ field: 'price', agreementValue: '190000', candidateValue: '210000' }] },
    newAgreementAt: null, recordedBy: 'brad', iaosObservedAt: OBSERVED_AT_1,
    evidenceSummary: 'Price changed.', relatedPriorRecordId: null,
  });
  checkFalse('a material correction with no new agreementAt fails closed rather than silently reusing the prior lineage', missing.ok);
  check('failure reason is CORRECTION_VERSION_MISMATCH', missing.reasons[0].code, 'CORRECTION_VERSION_MISMATCH');
}

{
  const metadataOnly = M.buildCorrectionRecord({
    opportunityId: OPP, priorVersion: V1, classification: { kind: 'metadata_only' },
    newAgreementAt: null, recordedBy: 'rep-1', iaosObservedAt: OBSERVED_AT_1,
    evidenceSummary: 'Internal tag change.', relatedPriorRecordId: null,
  });
  checkFalse('metadata-only change produces no correction record', metadataOnly.ok);
  check('failure reason is CORRECTION_IS_METADATA_ONLY', metadataOnly.reasons[0].code, 'CORRECTION_IS_METADATA_ONLY');
}

/* ====================================================================== */
/* 9. Resend creates a new attempt without overwriting the original       */
/* ====================================================================== */

{
  const resend = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorSend: acceptedSendFixture({ attemptId: OBSERVED_AT_1 }), newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'Seller lost the original link.', relatedPriorRecordId: OBSERVED_AT_1,
  });
  checkTrue('resend of an identity-equivalent document succeeds', resend.ok);
  checkTrue('resend carries a NEW attempt id, distinct from the prior attempt', resend.value.newAttemptId !== resend.value.priorAttemptId);
  check('resend preserves the prior attempt id as evidence -- it never overwrites it', resend.value.priorAttemptId, OBSERVED_AT_1);
}
{
  const sameId = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorSend: acceptedSendFixture({ attemptId: OBSERVED_AT_1 }), newAttemptId: OBSERVED_AT_1,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a resend reusing the original attempt id is refused', sameId.ok);
  check('failure reason is RESEND_ATTEMPT_IDS_IDENTICAL', sameId.reasons[0].code, 'RESEND_ATTEMPT_IDS_IDENTICAL');
}
{
  const notBrad = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorSend: acceptedSendFixture({}), newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'rep-1', authorizedAt: OBSERVED_AT_2, recordedBy: 'rep-1',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a resend not authorized by brad is refused', notBrad.ok);
  check('failure reason is RESEND_NOT_BRAD_AUTHORIZED', notBrad.reasons[0].code, 'RESEND_NOT_BRAD_AUTHORIZED');
}

/* ====================================================================== */
/* 10. Lifecycle evidence cannot cross contract versions (display layer)  */
/* ====================================================================== */

{
  const obsForV1 = providerObservationFromOutcome({ version: V1, iaosObservedAt: OBSERVED_AT_1 });
  const obsForV2 = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V2, expectedDocumentId: OTHER_DOC_ID, expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({ version: V2, providerResponse: Object.assign({}, acceptedSendFixture({}).providerResponse, { documentId: OTHER_DOC_ID }) }),
    outcome: outcomeWithDocument({ documentId: OTHER_DOC_ID, status: 'completed', recipients: [{ hasCompleted: true }] }),
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  }).value;
  const all = [obsForV1, obsForV2];
  check('filterRecordsForVersion(V1) excludes a different version\'s evidence', M.filterRecordsForVersion(all, V1).length, 1);
  check('filterRecordsForVersion(V2) excludes V1\'s evidence', M.filterRecordsForVersion(all, V2).length, 1);
  check('deriveLatestProviderStatus(V1) is unaffected by V2\'s completed observation', M.deriveLatestProviderStatus(all, V1), 'sent');
  check('deriveLatestProviderStatus(V2) is unaffected by V1\'s sent observation', M.deriveLatestProviderStatus(all, V2), 'completed');
}

/* ====================================================================== */
/* 11. Rescission is Brad-only and preserves required provenance          */
/* ====================================================================== */

{
  const notBrad = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Seller changed their mind.', authorizedBy: 'jess',
    authorizedAt: OBSERVED_AT_3, acceptedSend: acceptedSendFixture({}),
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission authorized by anyone other than brad is refused', notBrad.ok);
  check('failure reason is RESCISSION_NOT_BRAD_AUTHORIZED', notBrad.reasons[0].code, 'RESCISSION_NOT_BRAD_AUTHORIZED');
}
{
  const blankReason = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: '   ', authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_3, acceptedSend: acceptedSendFixture({}),
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission with a blank reason is refused', blankReason.ok);
}
{
  const preSend = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Withdrawn before send.', authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_3, acceptedSend: null,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'Rescinded at Contract Ready, never sent.', relatedPriorRecordId: null,
  });
  checkTrue('rescission before any provider send succeeds with no provider document identity attached', preSend.ok);
  check('provenance preserved: authorizedBy', preSend.value.authorizedBy, 'brad');
  check('provenance preserved: reason', preSend.value.reason, 'Withdrawn before send.');
  check('provenance preserved: affected version', JSON.stringify(preSend.value.version), JSON.stringify(V1));
}

/* ====================================================================== */
/* 12. No non-completed state -- and completed alone -- can qualify for   */
/*     Under Contract                                                     */
/* ====================================================================== */

const ALL_KIND_FIXTURES = [
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'sent' }) }),
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'viewed' }) }),
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'sent', recipients: [{ hasCompleted: true }, { hasCompleted: false }] }) }),
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'declined' }) }),
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'sent', isExpired: true }) }),
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'voided' }) }),
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'completed', recipients: [{ hasCompleted: true }] }) }),
  providerObservationFromOutcome({ outcome: { kind: 'network_error', message: 'x' } }),
  providerObservationFromOutcome({ outcome: { kind: 'http_response', status: 200, body: {} } }),
  correctionRecord(),
  resendRecord(),
  rescissionRecord(),
  declineRecord(),
];
checkTrue(
  'no LifecycleRecord of any kind -- including a completed provider observation and a human decline -- can ever create Under Contract',
  ALL_KIND_FIXTURES.every((r) => M.lifecycleRecordAloneCanCreateUnderContract(r) === false),
);

{
  const completedObservation = providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'completed', recipients: [{ hasCompleted: true }] }) });
  const evidence = {
    contractSent: true,
    requirements: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }],
    execution: {
      signers: [],
      providerReportedCompletionAt: completedObservation.providerReportedAt,
      preservedDocument: null,
    },
    currentVersion: V1,
    executedTermsMatchAgreement: true,
  };
  const result = B.evaluateUnderContractEligibility(evidence);
  checkFalse('a completed INV-64 lifecycle observation, standing alone, does not make evaluateUnderContractEligibility eligible', result.eligible);
  checkTrue('the real gate still names SIGNERS_INCOMPLETE and DOCUMENT_NOT_PRESERVED', result.reasons.some((r) => r.code === 'SIGNERS_INCOMPLETE') && result.reasons.some((r) => r.code === 'DOCUMENT_NOT_PRESERVED'));
}

/* ====================================================================== */
/* 13. Malformed, ambiguous, unsupported, and missing evidence fails      */
/*     closed                                                             */
/* ====================================================================== */

checkNull('parse: completely unrelated text is rejected', K.parseContractLifecycleNote('not a lifecycle note at all'));
checkNull('parse: correct header but wrong line count is rejected', K.parseContractLifecycleNote('IAOS CONTRACT LIFECYCLE — iaos-contract-lifecycle-v1\nRecorded at: 2026-01-01T00:00:00.000Z'));
checkNull('parse: empty string is rejected', K.parseContractLifecycleNote(''));

{
  const note = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = note.split('\n');
  const kindIdx = lines.findIndex((l) => l.startsWith('Event kind: '));
  lines[kindIdx] = 'Event kind: totally_unsupported_value';
  checkNull('parse: unsupported/unmapped event kind is rejected, never guessed', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = note.split('\n');
  const evidenceIdx = lines.findIndex((l) => l.startsWith('Evidence summary: '));
  lines[evidenceIdx] = 'Evidence summary: ';
  checkNull('parse: blank evidence summary is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = note.split('\n');
  const revIdx = lines.findIndex((l) => l.startsWith('Provider document revision: '));
  lines[revIdx] = 'Provider document revision: not-a-number';
  checkNull('parse: non-numeric provider document revision is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = note.split('\n');
  const boolIdx = lines.findIndex((l) => l.startsWith('Raw is expired: '));
  lines[boolIdx] = 'Raw is expired: maybe';
  checkNull('parse: a malformed raw-boolean value (not true/false/UNAVAILABLE) is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(correctionRecord());
  const lines = note.split('\n');
  const detailIdx = lines.findIndex((l) => l.startsWith('Detail: '));
  lines[detailIdx] = 'Detail: {not valid json';
  checkNull('parse: malformed JSON Detail on a correction is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(resendRecord());
  const lines = note.split('\n');
  const detailIdx = lines.findIndex((l) => l.startsWith('Detail: '));
  lines[detailIdx] = 'Detail: {"priorAttemptId":"a","newAttemptId":"a"}';
  checkNull('parse: resend Detail with identical prior/new attempt ids is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(rescissionRecord());
  const lines = note.split('\n');
  const authorizedAtIdx = lines.findIndex((l) => l.startsWith('Authorized at: '));
  lines[authorizedAtIdx] = 'Authorized at: not-a-timestamp';
  checkNull('parse: rescission with an invalid Authorized-at timestamp is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(declineRecord());
  const lines = note.split('\n');
  const detailIdx = lines.findIndex((l) => l.startsWith('Detail: '));
  lines[detailIdx] = 'Detail: {"reasonOrEvidence":""}';
  checkNull('parse: decline Detail with a blank reasonOrEvidence is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

{
  const withNewline = providerObservationFromOutcome({ evidenceSummary: 'Line one\nLine two' });
  const note = K.formatContractLifecycleNote(withNewline);
  check('formatted note has exactly HEADER + LABELS.length lines even with an embedded newline in evidenceSummary', note.split('\n').length, 21);
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('note with a sanitized embedded newline still round-trips', parsed !== null);
}

/* ====================================================================== */
/* Summary                                                                 */
/* ====================================================================== */

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
console.log('No provider call, network request, or GHL write occurred in this run -- every fixture above is an in-memory object.');
cleanup();
process.exit(failures === 0 ? 0 : 1);
