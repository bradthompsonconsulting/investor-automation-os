/**
 * Board #9 lifecycle -- deterministic model + carrier test runner.
 * B9-09 / INV-64. Jess Gate repair round, 2026-09-12.
 *
 * Compiles contract-lifecycle-model.ts, contract-lifecycle-carriers.ts, and
 * their board9-contract-model.ts dependency chain (unmodified by this
 * issue) to a temp directory, loads the emitted JavaScript, and runs
 * deterministic table-driven cases mapped directly to INV-64's own
 * "Proof required" list PLUS the four Jess Gate repair items (fabrication
 * boundary, raw-evidence preservation, human-decline record, base
 * ancestry -- the last verified by git, not this file). Every provider
 * response used here is a SIMULATED fixture object -- no network call, no
 * live GHL call, no `ghl.notes.create()`, matching this entire codebase's
 * own established testing convention. No Production location, credential,
 * or write path is referenced anywhere in this file.
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

/* ====================================================================== */
/* Fixture helpers                                                        */
/* ====================================================================== */

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
    priorAttemptVersion: V1,
    priorAttemptId: OBSERVED_AT_1,
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
    wasEverSentToProvider: true,
    providerDocumentIdAtRescission: DOC_ID,
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
    wasEverSentToProvider: true,
    providerDocumentIdAtDecline: DOC_ID,
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
/* 2. Prevent fabricated provider observations (Jess Gate repair item 2)  */
/* ====================================================================== */

checkTrue('the old fabrication entry point (accepting a pre-built observation) no longer exists', typeof M.buildProviderObservationRecord === 'undefined');

// Arbitrary caller-created "completed" evidence, injected as extra/smuggled
// fields the real function signature does not define, must be ignored --
// only the raw outcome is ever consulted.
{
  const attempted = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: outcomeWithDocument({ status: 'sent', recipients: [{ id: 'r1', hasCompleted: false }] }),
    // Smuggled fields mimicking the old, repaired API -- must have zero effect.
    observation: { status: 'completed', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null },
    status: 'completed',
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('smuggled extra fields cannot fabricate a completed status -- only the real outcome is consulted', attempted.ok && attempted.value.status === 'sent');
}

// Arbitrary declined/voided provider evidence is rejected -- GHL exposes
// no documented status value for either, so even a raw document row
// literally claiming one normalizes to "unknown", never trusted verbatim.
{
  const declined = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: outcomeWithDocument({ status: 'declined' }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('a raw document row literally reporting status "declined" is NOT trusted as the declined lifecycle state', declined.ok && declined.value.status === 'unknown');
  check('the raw, unmapped status is still preserved for audit', declined.value.rawProviderStatus, 'declined');
}
{
  const voided = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: outcomeWithDocument({ status: 'voided' }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('a raw document row literally reporting status "voided" is NOT trusted as the voided_or_canceled lifecycle state', voided.ok && voided.value.status === 'unknown');
  check('the raw, unmapped status is still preserved for audit', voided.value.rawProviderStatus, 'voided');
}

// Malformed/mismatched location evidence cannot become a confident,
// trusted provider_reported STATUS -- even if the mismatched row itself
// claims "completed" with every recipient complete.
{
  const wrongLocation = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: outcomeWithDocument({ locationId: 'loc-WRONG', status: 'completed', recipients: [{ id: 'r1', hasCompleted: true }] }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('a document row from the wrong environment is never trusted as completed, regardless of its own claimed status', wrongLocation.ok && wrongLocation.value.status === 'unknown');
  check('the raw status is still preserved separately from the normalized (unknown) state', wrongLocation.value.rawProviderStatus, 'completed');
}
// Mismatched document (readback did not return the expected document at all).
{
  const wrongDoc = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: { kind: 'http_response', status: 200, body: { documents: [{ documentId: OTHER_DOC_ID, locationId: LOCATION_ID, status: 'completed', recipients: [{ hasCompleted: true }] }] } },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('a readback that never returned the expected document cannot become completed', wrongDoc.ok && wrongDoc.value.status === 'unknown');
  checkNull('no raw evidence is fabricated when the expected document was never actually observed', wrongDoc.value.rawProviderStatus);
}

// Valid simulated provider readback CAN create the appropriate observation.
{
  const completed = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: outcomeWithDocument({ status: 'completed', recipients: [{ id: 'r1', hasCompleted: true }, { id: 'r2', hasCompleted: true }] }),
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('a genuinely matching, fully-completed readback DOES create a completed observation', completed.ok && completed.value.status === 'completed');
}

// provider_error and unknown remain recordable with truthful evidence.
{
  const networkFailure = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: { kind: 'network_error', message: 'ECONNRESET' },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback network error: ECONNRESET', relatedPriorRecordId: null,
  });
  checkTrue('a real network failure truthfully records provider_error', networkFailure.ok && networkFailure.value.status === 'provider_error');
}
{
  const notFound = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: { kind: 'http_response', status: 200, body: { documents: [] } },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback returned no documents.', relatedPriorRecordId: null,
  });
  checkTrue('a genuinely inconclusive readback truthfully records unknown', notFound.ok && notFound.value.status === 'unknown');
}

/* ====================================================================== */
/* 3. Preserve raw provider evidence, separate from normalized state      */
/*    (Jess Gate repair item 3)                                          */
/* ====================================================================== */

{
  const obs = providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'viewed', recipients: [{ id: 'r1', hasCompleted: false }, { id: 'r2', hasCompleted: false }] }) });
  check('rawProviderStatus preserved', obs.rawProviderStatus, 'viewed');
  check('normalized status computed separately', obs.status, 'delivered_or_viewed');
  check('isExpired preserved (raw)', obs.isExpired, null); // outcomeWithDocument's default doc has no isExpired field
  check('deleted preserved (raw)', obs.deleted, false);
  check('recipient-completion evidence preserved as bounded counts', obs.recipients, { total: 2, completed: 0 });
  check('providerDocumentReference preserved', obs.providerDocumentReference, 'ref-1');
  check('providerDocumentRevision preserved', obs.providerDocumentRevision, 1);
  check('providerReportedAt extracted from provider evidence (updatedAt), never caller-invented', obs.providerReportedAt, PROVIDER_REPORTED_AT);
}
{
  // An unmapped raw status is preserved even though the normalized value is "unknown".
  const obs = providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'some-future-value', recipients: [] }) });
  check('unmapped raw provider status is preserved verbatim', obs.rawProviderStatus, 'some-future-value');
  check('normalized status still falls closed to unknown', obs.status, 'unknown');
}
{
  // Round-trip through the carrier preserves every raw field exactly.
  const obs = providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'completed', isExpired: true, deleted: false, recipients: [{ hasCompleted: true }, { hasCompleted: true }, { hasCompleted: true }] }) });
  const note = K.formatContractLifecycleNote(obs);
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('provider observation round-trips through the carrier', parsed !== null && parsed.kind === 'provider_observation');
  check('round-trip preserves rawProviderStatus', parsed.rawProviderStatus, obs.rawProviderStatus);
  check('round-trip preserves isExpired', parsed.isExpired, obs.isExpired);
  check('round-trip preserves deleted', parsed.deleted, obs.deleted);
  check('round-trip preserves recipients counts', [parsed.recipients.total, parsed.recipients.completed], [obs.recipients.total, obs.recipients.completed]);
  check('round-trip preserves providerReportedAt', parsed.providerReportedAt, obs.providerReportedAt);
}
{
  // A provider_error/no-row observation round-trips with all raw fields null, truthfully (nothing fabricated).
  const noRow = M.buildProviderObservationRecordFromReadback({
    opportunityId: OPP, version: V1, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID,
    outcome: { kind: 'network_error', message: 'timeout' },
    iaosObservedAt: OBSERVED_AT_1, evidenceSummary: 'Readback network error: timeout', relatedPriorRecordId: null,
  }).value;
  const parsed = K.parseContractLifecycleNote(K.formatContractLifecycleNote(noRow));
  checkTrue('a no-row (provider_error) observation round-trips', parsed !== null);
  checkNull('no fabricated rawProviderStatus for a no-row observation', parsed.rawProviderStatus);
  checkNull('no fabricated isExpired for a no-row observation', parsed.isExpired);
  checkNull('no fabricated deleted for a no-row observation', parsed.deleted);
  checkNull('no fabricated recipients for a no-row observation', parsed.recipients);
}
// Malformed recipients columns fail closed: completed present without total, or completed > total.
{
  const note = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = note.split('\n');
  const totalIdx = lines.findIndex((l) => l.startsWith('Recipients total: '));
  lines[totalIdx] = 'Recipients total: UNAVAILABLE'; // completed remains a real number -- mismatch
  checkNull('parse: recipients completed present but total UNAVAILABLE is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(providerObservationFromOutcome({ outcome: outcomeWithDocument({ recipients: [{ hasCompleted: true }, { hasCompleted: true }] }) }));
  const lines = note.split('\n');
  const completedIdx = lines.findIndex((l) => l.startsWith('Recipients completed: '));
  lines[completedIdx] = 'Recipients completed: 99'; // exceeds total -- impossible, must be rejected
  checkNull('parse: recipients completed exceeding total is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

/* ====================================================================== */
/* 4. Provider and authorized-human evidence cannot be confused           */
/* ====================================================================== */

checkTrue('provider_observation record carries authority provider_reported by construction', providerObservationFromOutcome({}).authority === 'provider_reported');

// Tamper: inject a human Operator field into a provider-kind note -- must be rejected.
{
  const goodNote = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = goodNote.split('\n');
  const operatorIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[operatorIdx] = 'Operator: brad';
  checkNull('a provider-kind note with a forged human Operator is rejected outright', K.parseContractLifecycleNote(lines.join('\n')));
}
// Tamper: forge Authority on a provider note to operator_attested.
{
  const goodNote = K.formatContractLifecycleNote(providerObservationFromOutcome({}));
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: operator_attested';
  checkNull('a provider-kind note with a forged Authority column is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

checkTrue('correction record carries authority operator_attested', correctionRecord().authority === 'operator_attested');
{
  const note = K.formatContractLifecycleNote(correctionRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('correction note round-trips', parsed !== null && parsed.kind === 'correction');
}
// Tamper: a correction note claiming brad_authorized authority is rejected.
{
  const goodNote = K.formatContractLifecycleNote(correctionRecord());
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: brad_authorized';
  checkNull('a correction note with a forged brad_authorized Authority is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
// Tamper: a correction note carrying ANY raw provider evidence field is rejected (human fact cannot carry provider evidence).
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
/* 5. Human decline record (Jess Gate repair item 4)                      */
/* ====================================================================== */

checkTrue('decline record carries authority operator_attested -- never provider_reported, never brad_authorized', declineRecord().authority === 'operator_attested');
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
// A decline is never restricted to Brad the way Rescission is -- any named operator may record it.
{
  const byRep = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, wasEverSentToProvider: true, providerDocumentIdAtDecline: DOC_ID,
    reasonOrEvidence: 'Text message: "not signing".', recordedBy: 'rep-2', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('a decline recorded by an operator other than brad succeeds -- no Brad-only restriction applies to Declined', byRep.ok);
}
// A decline never impersonates provider evidence.
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
// A decline's own event kind ("operator_declined") never collides with the provider status "declined".
{
  const declineNote = K.formatContractLifecycleNote(declineRecord());
  const declineLines = declineNote.split('\n');
  const declineKindLine = declineLines.find((l) => l.startsWith('Event kind: '));
  check('decline note uses the distinct "operator_declined" event kind, never colliding with the provider "declined" status', declineKindLine, 'Event kind: operator_declined');
}
// Declined requires Contract Sent -- refused outright otherwise, and never fabricates a provider document id.
{
  const notSent = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, wasEverSentToProvider: false, providerDocumentIdAtDecline: DOC_ID,
    reasonOrEvidence: 'x', recordedBy: 'rep-1', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a decline before Contract Sent is refused -- there is nothing to decline before the agreement was sent', notSent.ok);
  check('failure reason is DECLINE_REQUIRES_CONTRACT_SENT', notSent.reasons[0].code, 'DECLINE_REQUIRES_CONTRACT_SENT');
}
{
  const blankReason = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, wasEverSentToProvider: true, providerDocumentIdAtDecline: DOC_ID,
    reasonOrEvidence: '   ', recordedBy: 'rep-1', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a decline with no reason/evidence is refused -- never inferred from silence', blankReason.ok);
  check('failure reason is DECLINE_REASON_OR_EVIDENCE_BLANK', blankReason.reasons[0].code, 'DECLINE_REASON_OR_EVIDENCE_BLANK');
}
{
  const noOperator = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, wasEverSentToProvider: true, providerDocumentIdAtDecline: DOC_ID,
    reasonOrEvidence: 'x', recordedBy: '', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a decline with no recording operator is refused', noOperator.ok);
  check('failure reason is DECLINE_RECORDED_BY_BLANK', noOperator.reasons[0].code, 'DECLINE_RECORDED_BY_BLANK');
}
{
  const noDoc = M.buildDeclineRecord({
    opportunityId: OPP, version: V1, wasEverSentToProvider: true, providerDocumentIdAtDecline: '',
    reasonOrEvidence: 'x', recordedBy: 'rep-1', declinedAt: OBSERVED_AT_3,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a decline with no provider document identity is refused (always required once Contract Sent has occurred)', noDoc.ok);
  check('failure reason is DECLINE_PROVIDER_DOCUMENT_ID_BLANK', noDoc.reasons[0].code, 'DECLINE_PROVIDER_DOCUMENT_ID_BLANK');
}
// A decline makes no legal determination and cannot create Under Contract -- see section 9 below, which includes this fixture.

/* ====================================================================== */
/* 6. Chronology remains append-only; duplicates do not erase history     */
/* ====================================================================== */

{
  const n1 = K.formatContractLifecycleNote(providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_1 }));
  const n2 = K.formatContractLifecycleNote(providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'viewed' }), iaosObservedAt: OBSERVED_AT_2 }));
  const n3ForOtherOpp = K.formatContractLifecycleNote(providerObservationFromOutcome({ opportunityId: OTHER_OPP, iaosObservedAt: OBSERVED_AT_3 }));
  const all = K.allContractLifecycleRecordsForOpportunity([{ body: n1 }, { body: n2 }, { body: n3ForOtherOpp }], OPP);
  check('allContractLifecycleRecordsForOpportunity returns exactly the records for this opportunity, all of them', all.length, 2);
  const ordered = M.orderRecordsChronologically(all);
  check('orderRecordsChronologically sorts append-only history oldest-first', ordered.map((r) => r.iaosObservedAt), [OBSERVED_AT_1, OBSERVED_AT_2]);
}

{
  const obsA = providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_1 });
  const obsB = providerObservationFromOutcome({ iaosObservedAt: OBSERVED_AT_2 }); // identical underlying fact, reported at a different time
  checkTrue('isDuplicateProviderObservation recognizes two identical provider facts reported at different times', M.isDuplicateProviderObservation(obsA, obsB));
  const nA = K.formatContractLifecycleNote(obsA);
  const nB = K.formatContractLifecycleNote(obsB);
  const all = K.allContractLifecycleRecordsForOpportunity([{ body: nA }, { body: nB }], OPP);
  check('duplicate provider observations both remain in the append-only history -- neither is erased', all.length, 2);
  check('deriveLatestProviderStatus still resolves correctly across duplicates', M.deriveLatestProviderStatus(all, V1), 'sent');
}

/* ====================================================================== */
/* 7. Correction creates a distinguishable revision                       */
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
/* 8. Resend creates a new attempt without overwriting the original       */
/* ====================================================================== */

{
  const resend = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorAttemptVersion: V1,
    priorAttemptId: OBSERVED_AT_1, newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'Seller lost the original link.', relatedPriorRecordId: OBSERVED_AT_1,
  });
  checkTrue('resend of an identity-equivalent document succeeds', resend.ok);
  checkTrue('resend carries a NEW attempt id, distinct from the prior attempt', resend.value.newAttemptId !== resend.value.priorAttemptId);
  check('resend preserves the prior attempt id as evidence -- it never overwrites it', resend.value.priorAttemptId, OBSERVED_AT_1);
}
{
  const sameId = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorAttemptVersion: V1,
    priorAttemptId: OBSERVED_AT_1, newAttemptId: OBSERVED_AT_1,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a resend reusing the original attempt id is refused', sameId.ok);
  check('failure reason is RESEND_ATTEMPT_IDS_IDENTICAL', sameId.reasons[0].code, 'RESEND_ATTEMPT_IDS_IDENTICAL');
}

/* ====================================================================== */
/* 9. Changed content/revision invalidates prior authorization            */
/* ====================================================================== */

{
  const V2 = { agreementAt: V1.agreementAt, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };
  const changed = M.buildResendRecord({
    opportunityId: OPP, version: V2, priorAttemptVersion: V1,
    priorAttemptId: OBSERVED_AT_1, newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a "resend" whose version differs from the prior attempt is refused -- that is a correction, not a resend', changed.ok);
  check('failure reason is RESEND_VERSION_MUST_MATCH_PRIOR', changed.reasons[0].code, 'RESEND_VERSION_MUST_MATCH_PRIOR');
}
{
  const notBrad = M.buildResendRecord({
    opportunityId: OPP, version: V1, priorAttemptVersion: V1,
    priorAttemptId: OBSERVED_AT_1, newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'rep-1', authorizedAt: OBSERVED_AT_2, recordedBy: 'rep-1',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a resend not authorized by brad is refused', notBrad.ok);
  check('failure reason is RESEND_NOT_BRAD_AUTHORIZED', notBrad.reasons[0].code, 'RESEND_NOT_BRAD_AUTHORIZED');
}

/* ====================================================================== */
/* 10. Lifecycle evidence cannot cross contract versions                  */
/* ====================================================================== */

{
  const V2 = { agreementAt: V1.agreementAt, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };
  const obsForV1 = providerObservationFromOutcome({ version: V1, iaosObservedAt: OBSERVED_AT_1 });
  const obsForV2 = providerObservationFromOutcome({
    version: V2,
    outcome: outcomeWithDocument({ documentId: OTHER_DOC_ID, status: 'completed', recipients: [{ hasCompleted: true }] }),
    expectedDocumentId: OTHER_DOC_ID,
    iaosObservedAt: OBSERVED_AT_2,
  });
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
    authorizedAt: OBSERVED_AT_3, wasEverSentToProvider: true, providerDocumentIdAtRescission: DOC_ID,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission authorized by anyone other than brad is refused', notBrad.ok);
  check('failure reason is RESCISSION_NOT_BRAD_AUTHORIZED', notBrad.reasons[0].code, 'RESCISSION_NOT_BRAD_AUTHORIZED');
}
{
  const blankReason = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: '   ', authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_3, wasEverSentToProvider: true, providerDocumentIdAtRescission: DOC_ID,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission with a blank reason is refused', blankReason.ok);
}
{
  const missingDoc = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Withdrawn.', authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_3, wasEverSentToProvider: true, providerDocumentIdAtRescission: null,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission of an agreement that was sent to a provider requires naming the affected provider document', missingDoc.ok);
  check('failure reason is RESCISSION_PROVIDER_DOCUMENT_ID_REQUIRED', missingDoc.reasons[0].code, 'RESCISSION_PROVIDER_DOCUMENT_ID_REQUIRED');
}
{
  const fabricatedDoc = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Withdrawn before send.', authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_3, wasEverSentToProvider: false, providerDocumentIdAtRescission: DOC_ID,
    iaosObservedAt: OBSERVED_AT_3, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('rescission of an agreement never sent to a provider must not carry a fabricated provider document id', fabricatedDoc.ok);
  check('failure reason is RESCISSION_PROVIDER_DOCUMENT_ID_MUST_BE_ABSENT', fabricatedDoc.reasons[0].code, 'RESCISSION_PROVIDER_DOCUMENT_ID_MUST_BE_ABSENT');
}
{
  const preSend = M.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Withdrawn before send.', authorizedBy: 'brad',
    authorizedAt: OBSERVED_AT_3, wasEverSentToProvider: false, providerDocumentIdAtRescission: null,
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
  providerObservationFromOutcome({ outcome: outcomeWithDocument({ status: 'declined' }) }), // normalizes to unknown, but include the raw attempt too
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
  check('formatted note has exactly HEADER + LABELS.length lines even with an embedded newline in evidenceSummary', note.split('\n').length, 20);
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
