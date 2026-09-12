/**
 * Board #9 lifecycle -- deterministic model + carrier test runner.
 * B9-09 / INV-64.
 *
 * Compiles contract-lifecycle-model.ts, contract-lifecycle-carriers.ts, and
 * their board9-contract-model.ts dependency chain (unmodified by this
 * issue) to a temp directory, loads the emitted JavaScript, and runs
 * deterministic table-driven cases mapped directly to INV-64's own
 * "Proof required" list. Every provider response used here is a SIMULATED
 * fixture object -- no network call, no live GHL call, no
 * `ghl.notes.create()`, matching this entire codebase's own established
 * testing convention. No Production location, credential, or write path
 * is referenced anywhere in this file.
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
const V1 = B.initialVersionIdentity(AGREEMENT_AT);

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
check('normalize: verified-executed document (all complete) still reports expired if provider says so (provider fact, not IAOS derivation)', M.normalizeProviderLifecycleStatus({ status: 'completed', isExpired: true, deleted: null, recipients: [{ hasCompleted: true }] }), 'expired');
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

// classifyProviderLifecycleReadback -- outcome-level classification
check(
  'readback outcome: network error -> provider_error, distinct from unknown',
  M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: 'loc-1', outcome: { kind: 'network_error', message: 'ECONNRESET' } }).status,
  'provider_error',
);
check(
  'readback outcome: HTTP 500 -> provider_error',
  M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: 'loc-1', outcome: { kind: 'http_response', status: 500, body: {} } }).status,
  'provider_error',
);
check(
  'readback outcome: 200 but no documents[] -> unknown',
  M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: 'loc-1', outcome: { kind: 'http_response', status: 200, body: {} } }).status,
  'unknown',
);
check(
  'readback outcome: document not found in list -> unknown',
  M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: 'loc-1', outcome: { kind: 'http_response', status: 200, body: { documents: [{ documentId: 'other-doc' }] } } }).status,
  'unknown',
);
check(
  'readback outcome: locationId mismatch -> unknown',
  M.classifyProviderLifecycleReadback({ expectedDocumentId: DOC_ID, expectedLocationId: 'loc-1', outcome: { kind: 'http_response', status: 200, body: { documents: [{ documentId: DOC_ID, locationId: 'loc-WRONG', status: 'sent', recipients: [] }] } } }).status,
  'unknown',
);
{
  const r = M.classifyProviderLifecycleReadback({
    expectedDocumentId: DOC_ID,
    expectedLocationId: 'loc-1',
    outcome: { kind: 'http_response', status: 200, body: { documents: [{ documentId: DOC_ID, locationId: 'loc-1', status: 'viewed', referenceId: 'ref-1', documentRevision: 3, recipients: [{ hasCompleted: false }] }] } },
  });
  check('readback outcome: matched document classified via normalizeProviderLifecycleStatus', r.status, 'delivered_or_viewed');
  check('readback outcome: providerDocumentReference carried through', r.providerDocumentReference, 'ref-1');
  check('readback outcome: providerDocumentRevision carried through', r.providerDocumentRevision, 3);
}

/* ====================================================================== */
/* 2. Provider and authorized-human evidence cannot be confused           */
/* ====================================================================== */

function providerObservation(over) {
  const observation = { status: 'sent', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null };
  const built = M.buildProviderObservationRecord(Object.assign({
    opportunityId: OPP,
    version: V1,
    observation,
    providerDocumentId: DOC_ID,
    providerReportedAt: PROVIDER_REPORTED_AT,
    iaosObservedAt: OBSERVED_AT_1,
    evidenceSummary: 'Readback confirmed sent.',
    relatedPriorRecordId: null,
  }, over || {}));
  if (!built.ok) throw new Error('fixture buildProviderObservationRecord failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

checkTrue('provider_observation record carries authority provider_reported by construction', providerObservation().authority === 'provider_reported');

{
  const note = K.formatContractLifecycleNote(providerObservation());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('provider observation note round-trips', parsed !== null && parsed.kind === 'provider_observation');
  check('provider observation note preserves status', parsed.status, 'sent');
}

// Tamper: inject a human Operator field into a provider-kind note -- must be rejected.
{
  const goodNote = K.formatContractLifecycleNote(providerObservation());
  const lines = goodNote.split('\n');
  const operatorIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[operatorIdx] = 'Operator: brad';
  const tampered = lines.join('\n');
  checkNull('a provider-kind note with a forged human Operator is rejected outright', K.parseContractLifecycleNote(tampered));
}

// Tamper: forge Authority on a provider note to operator_attested.
{
  const goodNote = K.formatContractLifecycleNote(providerObservation());
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: operator_attested';
  checkNull('a provider-kind note with a forged Authority column is rejected', K.parseContractLifecycleNote(lines.join('\n')));
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

checkTrue('correction record carries authority operator_attested', correctionRecord().authority === 'operator_attested');
{
  const note = K.formatContractLifecycleNote(correctionRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('correction note round-trips', parsed !== null && parsed.kind === 'correction');
}
// Tamper: a correction note claiming brad_authorized authority is rejected (does not silently become a resend/rescission).
{
  const goodNote = K.formatContractLifecycleNote(correctionRecord());
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: brad_authorized';
  checkNull('a correction note with a forged brad_authorized Authority is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
// Tamper: a correction note carrying provider fields is rejected (human fact cannot carry provider evidence).
{
  const goodNote = K.formatContractLifecycleNote(correctionRecord());
  const lines = goodNote.split('\n');
  const pdIdx = lines.findIndex((l) => l.startsWith('Provider document id: '));
  lines[pdIdx] = 'Provider document id: ' + DOC_ID;
  checkNull('a correction note carrying a provider document id is rejected', K.parseContractLifecycleNote(lines.join('\n')));
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

checkTrue('resend record carries authority brad_authorized', resendRecord().authority === 'brad_authorized');
{
  const note = K.formatContractLifecycleNote(resendRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('resend note round-trips', parsed !== null && parsed.kind === 'resend');
}
// Tamper: a resend note whose Operator is not literally "brad" is rejected.
{
  const goodNote = K.formatContractLifecycleNote(resendRecord());
  const lines = goodNote.split('\n');
  const opIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[opIdx] = 'Operator: someone-else';
  checkNull('a resend note whose Operator is not the literal "brad" is rejected', K.parseContractLifecycleNote(lines.join('\n')));
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

checkTrue('rescission record carries authority brad_authorized', rescissionRecord().authority === 'brad_authorized');
{
  const note = K.formatContractLifecycleNote(rescissionRecord());
  const parsed = K.parseContractLifecycleNote(note);
  checkTrue('rescission note round-trips', parsed !== null && parsed.kind === 'rescission');
  check('rescission note preserves providerDocumentIdAtRescission', parsed.providerDocumentIdAtRescission, DOC_ID);
}
// Tamper: a rescission note whose Operator is not literally "brad" is rejected.
{
  const goodNote = K.formatContractLifecycleNote(rescissionRecord());
  const lines = goodNote.split('\n');
  const opIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[opIdx] = 'Operator: jess';
  checkNull('a rescission note whose Operator is not the literal "brad" is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

/* ====================================================================== */
/* 3. Chronology remains append-only; duplicates do not erase history     */
/* ====================================================================== */

{
  const n1 = K.formatContractLifecycleNote(providerObservation({ iaosObservedAt: OBSERVED_AT_1 }));
  const n2 = K.formatContractLifecycleNote(providerObservation({ status: undefined, observation: { status: 'delivered_or_viewed', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null }, iaosObservedAt: OBSERVED_AT_2 }));
  const n3ForOtherOpp = K.formatContractLifecycleNote(providerObservation({ opportunityId: OTHER_OPP, iaosObservedAt: OBSERVED_AT_3 }));
  const all = K.allContractLifecycleRecordsForOpportunity([{ body: n1 }, { body: n2 }, { body: n3ForOtherOpp }], OPP);
  check('allContractLifecycleRecordsForOpportunity returns exactly the records for this opportunity, all of them', all.length, 2);
  const ordered = M.orderRecordsChronologically(all);
  check('orderRecordsChronologically sorts append-only history oldest-first', ordered.map((r) => r.iaosObservedAt), [OBSERVED_AT_1, OBSERVED_AT_2]);
}

// Duplicate provider observations: same underlying fact reported twice must not erase either occurrence.
{
  const obsA = providerObservation({ iaosObservedAt: OBSERVED_AT_1 });
  const obsB = providerObservation({ iaosObservedAt: OBSERVED_AT_2 }); // identical fields except iaosObservedAt
  checkTrue('isDuplicateProviderObservation recognizes two identical provider facts reported at different times', M.isDuplicateProviderObservation(obsA, obsB));
  const nA = K.formatContractLifecycleNote(obsA);
  const nB = K.formatContractLifecycleNote(obsB);
  const all = K.allContractLifecycleRecordsForOpportunity([{ body: nA }, { body: nB }], OPP);
  check('duplicate provider observations both remain in the append-only history -- neither is erased', all.length, 2);
  check('deriveLatestProviderStatus still resolves correctly across duplicates', M.deriveLatestProviderStatus(all, V1), 'sent');
}

/* ====================================================================== */
/* 4. Correction creates a distinguishable revision                       */
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

// Material correction requires new Agreement Reached -- omitting newAgreementAt fails closed, never silently reusing the prior lineage.
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

// A metadata-only "correction" is refused outright -- it is not a correction and creates no lifecycle record.
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
/* 5. Resend creates a new attempt without overwriting the original       */
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

// Reusing the same attempt id for both prior and new is refused -- a resend must never silently convert the original.
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
/* 6. Changed content/revision invalidates prior authorization            */
/* ====================================================================== */

{
  const V2 = { agreementAt: V1.agreementAt, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };
  const changed = M.buildResendRecord({
    opportunityId: OPP, version: V2, priorAttemptVersion: V1, // declared version differs from the prior attempt's own version
    priorAttemptId: OBSERVED_AT_1, newAttemptId: OBSERVED_AT_2,
    authorizedBy: 'brad', authorizedAt: OBSERVED_AT_2, recordedBy: 'brad',
    iaosObservedAt: OBSERVED_AT_2, evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkFalse('a "resend" whose version differs from the prior attempt is refused -- that is a correction, not a resend', changed.ok);
  check('failure reason is RESEND_VERSION_MUST_MATCH_PRIOR', changed.reasons[0].code, 'RESEND_VERSION_MUST_MATCH_PRIOR');
}

// A resend not authorized by brad is refused -- "current exact-version Brad authorization for every outbound resend."
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
/* 7. Lifecycle evidence cannot cross contract versions                   */
/* ====================================================================== */

{
  const V2 = { agreementAt: V1.agreementAt, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };
  const obsForV1 = providerObservation({ version: V1, iaosObservedAt: OBSERVED_AT_1 });
  const obsForV2 = providerObservation({
    version: V2,
    observation: { status: 'completed', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null },
    iaosObservedAt: OBSERVED_AT_2,
    providerDocumentId: 'doc-fixture-2',
  });
  const all = [obsForV1, obsForV2];
  check('filterRecordsForVersion(V1) excludes a different version\'s evidence', M.filterRecordsForVersion(all, V1).length, 1);
  check('filterRecordsForVersion(V2) excludes V1\'s evidence', M.filterRecordsForVersion(all, V2).length, 1);
  check('deriveLatestProviderStatus(V1) is unaffected by V2\'s completed observation', M.deriveLatestProviderStatus(all, V1), 'sent');
  check('deriveLatestProviderStatus(V2) is unaffected by V1\'s sent observation', M.deriveLatestProviderStatus(all, V2), 'completed');
}

/* ====================================================================== */
/* 8. Rescission is Brad-only and preserves required provenance           */
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
/* 9. No non-completed state -- and completed alone -- can qualify for    */
/*    Under Contract                                                     */
/* ====================================================================== */

const ALL_KIND_FIXTURES = [
  providerObservation({ observation: { status: 'sent', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'delivered_or_viewed', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'partially_signed', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'declined', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'expired', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'voided_or_canceled', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'completed', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'provider_error', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  providerObservation({ observation: { status: 'unknown', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null } }),
  correctionRecord(),
  resendRecord(),
  rescissionRecord(),
];
checkTrue(
  'no LifecycleRecord of any kind -- including a completed provider observation -- can ever create Under Contract',
  ALL_KIND_FIXTURES.every((r) => M.lifecycleRecordAloneCanCreateUnderContract(r) === false),
);

// Integration proof: feeding a "completed" observation's own fields into
// board9-contract-model.ts's REAL evaluateUnderContractEligibility, alone
// (no matching signer completion, no preserved document), still fails
// closed -- INV-64's completed observation is evidence, never a shortcut.
{
  const completedObservation = providerObservation({
    observation: { status: 'completed', row: null, providerDocumentReference: null, providerDocumentRevision: null, failureReason: null },
    providerReportedAt: OBSERVED_AT_1,
  });
  const evidence = {
    contractSent: true,
    requirements: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }],
    execution: {
      signers: [], // no per-signer completion recorded anywhere -- the lifecycle observation alone supplies nothing here
      providerReportedCompletionAt: completedObservation.providerReportedAt,
      preservedDocument: null, // no preserved document -- the lifecycle observation alone supplies nothing here either
    },
    currentVersion: V1,
    executedTermsMatchAgreement: true,
  };
  const result = B.evaluateUnderContractEligibility(evidence);
  checkFalse('a completed INV-64 lifecycle observation, standing alone, does not make evaluateUnderContractEligibility eligible', result.eligible);
  checkTrue('the real gate still names SIGNERS_INCOMPLETE and DOCUMENT_NOT_PRESERVED', result.reasons.some((r) => r.code === 'SIGNERS_INCOMPLETE') && result.reasons.some((r) => r.code === 'DOCUMENT_NOT_PRESERVED'));
}

/* ====================================================================== */
/* 10. Malformed, ambiguous, unsupported, and missing evidence fails closed */
/* ====================================================================== */

checkNull('parse: completely unrelated text is rejected', K.parseContractLifecycleNote('not a lifecycle note at all'));
checkNull('parse: correct header but wrong line count is rejected', K.parseContractLifecycleNote('IAOS CONTRACT LIFECYCLE — iaos-contract-lifecycle-v1\nRecorded at: 2026-01-01T00:00:00.000Z'));
checkNull('parse: empty string is rejected', K.parseContractLifecycleNote(''));

{
  const note = K.formatContractLifecycleNote(providerObservation());
  const lines = note.split('\n');
  const kindIdx = lines.findIndex((l) => l.startsWith('Event kind: '));
  lines[kindIdx] = 'Event kind: totally_unsupported_value';
  checkNull('parse: unsupported/unmapped event kind is rejected, never guessed', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(providerObservation());
  const lines = note.split('\n');
  const evidenceIdx = lines.findIndex((l) => l.startsWith('Evidence summary: '));
  lines[evidenceIdx] = 'Evidence summary: ';
  checkNull('parse: blank evidence summary is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(providerObservation());
  const lines = note.split('\n');
  const revIdx = lines.findIndex((l) => l.startsWith('Provider document revision: '));
  lines[revIdx] = 'Provider document revision: not-a-number';
  checkNull('parse: non-numeric provider document revision is rejected', K.parseContractLifecycleNote(lines.join('\n')));
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
  lines[detailIdx] = 'Detail: {"priorAttemptId":"a","newAttemptId":"a"}'; // identical ids -- ambiguous, must fail
  checkNull('parse: resend Detail with identical prior/new attempt ids is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}
{
  const note = K.formatContractLifecycleNote(rescissionRecord());
  const lines = note.split('\n');
  const authorizedAtIdx = lines.findIndex((l) => l.startsWith('Authorized at: '));
  lines[authorizedAtIdx] = 'Authorized at: not-a-timestamp';
  checkNull('parse: rescission with an invalid Authorized-at timestamp is rejected', K.parseContractLifecycleNote(lines.join('\n')));
}

// Embedded-newline safety: a caller-supplied evidenceSummary/reason with a
// newline still round-trips (normalized to a single line), never breaking
// the schema.
{
  const withNewline = providerObservation({ evidenceSummary: 'Line one\nLine two' });
  const note = K.formatContractLifecycleNote(withNewline);
  check('formatted note has exactly HEADER + LABELS.length lines even with an embedded newline in evidenceSummary', note.split('\n').length, 15);
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
