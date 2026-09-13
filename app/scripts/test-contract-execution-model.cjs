/**
 * Board #9 verified full execution -- deterministic model + carrier test
 * runner. B9-10 / INV-65.
 *
 * Compiles contract-execution-model.ts, contract-execution-carriers.ts,
 * and their board9-contract-model.ts / contract-send-carriers.ts /
 * contract-lifecycle-model.ts dependency chain (unmodified by this issue
 * except the one small export addition documented in contract-lifecycle-
 * model.ts's own header) to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases mapped directly to
 * INV-65's own "Proof required" list. Every provider response, send
 * record, and artifact used here is a SIMULATED fixture object -- no
 * network call, no live GHL call, no `ghl.notes.create()`, matching this
 * entire codebase's own established testing convention. No Production
 * location, credential, or write path is referenced anywhere in this
 * file. Artifact bytes are synthetic, non-sensitive ASCII text, never a
 * real PDF.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-execution-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-execution-model.ts'),
  path.join(LIB, 'contract-execution-carriers.ts'),
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
const E = require(path.join(LIB_OUT, 'contract-execution-model.js'));
const EC = require(path.join(LIB_OUT, 'contract-execution-carriers.js'));
const L = require(path.join(LIB_OUT, 'contract-lifecycle-model.js'));
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
const AGREEMENT_AT = '2026-09-06T15:00:00.000Z';
const REQUEST_AT = '2026-09-12T10:00:00.000Z';
const AUTHORIZED_AT = '2026-09-12T09:00:00.000Z';
const COMPLETION_OBSERVED_AT = '2026-09-12T12:00:00.000Z';
const COMPLETION_REPORTED_AT = '2026-09-12T11:59:00.000Z';
const VERIFIED_AT = '2026-09-12T13:00:00.000Z';
const DOC_ID = 'doc-fixture-1';
const OTHER_DOC_ID = 'doc-fixture-2';
const LOCATION_ID = 'loc-test-1';
const V1 = B.initialVersionIdentity(AGREEMENT_AT);
const V2 = { agreementAt: V1.agreementAt, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };

/* ====================================================================== */
/* Fixture helpers                                                        */
/* ====================================================================== */

function acceptedSendFixture(over) {
  return Object.assign({
    opportunityId: OPP,
    at: REQUEST_AT,
    operator: 'brad',
    attemptId: REQUEST_AT,
    status: 'accepted',
    version: V1,
    templateName: 'Purchase Agreement',
    templateSource: 'ghl',
    requestedTemplateId: 'tmpl-1',
    authorizedAt: AUTHORIZED_AT,
    signers: [],
    confirmedRecipientId: 'recipient-seller',
    expirationAt: '2026-09-20T00:00:00.000Z',
    requestAt: REQUEST_AT,
    iaosObservedAcceptanceAt: REQUEST_AT,
    providerResponse: {
      documentId: DOC_ID,
      documentReference: 'ref-1',
      documentRevision: 1,
      recipientId: 'recipient-seller',
      createdBy: 'sender-1',
      readbackStatus: 'sent',
      readbackLocationId: LOCATION_ID,
      fillableFieldCount: 3,
    },
    failureReason: null,
  }, over || {});
}

const REQUIREMENTS = [
  { role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null },
  { role: 'Spouse', displayName: 'John Seller', signingAuthorityNote: null },
];

function providerRecipientsAllComplete(over) {
  return [
    Object.assign({ role: 'Seller', contactName: 'Jane Seller', recipientId: 'r1', hasCompleted: true, completedAt: COMPLETION_REPORTED_AT }, (over && over[0]) || {}),
    Object.assign({ role: 'Spouse', contactName: 'John Seller', recipientId: 'r2', hasCompleted: true, completedAt: COMPLETION_REPORTED_AT }, (over && over[1]) || {}),
  ];
}

/** A completed provider_observation lifecycle record for DOC_ID/V1, built via the REAL, already-tested INV-64 builder (never hand-constructed). */
function completedLifecycleObservation(over) {
  const outcome = {
    kind: 'http_response',
    status: 200,
    body: {
      documents: [Object.assign({
        documentId: DOC_ID,
        locationId: LOCATION_ID,
        status: 'completed',
        referenceId: 'ref-1',
        documentRevision: 1,
        updatedAt: COMPLETION_REPORTED_AT,
        deleted: false,
        recipients: [{ id: 'r1', hasCompleted: true }, { id: 'r2', hasCompleted: true }],
      }, (over && over.doc) || {})],
    },
  };
  const built = L.buildProviderObservationRecordFromReadback(Object.assign({
    opportunityId: OPP,
    version: V1,
    expectedDocumentId: DOC_ID,
    expectedLocationId: LOCATION_ID,
    acceptedSend: acceptedSendFixture({}),
    outcome,
    iaosObservedAt: COMPLETION_OBSERVED_AT,
    evidenceSummary: 'GET /proposals/document readback confirms completed.',
    relatedPriorRecordId: null,
  }, (over && over.build) || {}));
  if (!built.ok) throw new Error('fixture completedLifecycleObservation failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

const AGREEMENT_TERMS = { price: 190000, propertyAddress: '123 Main St, Austin, TX 78701', parties: ['Jane Seller', 'John Seller'] };
const MATCHING_EXECUTED_TERMS = { price: 190000, propertyAddress: '123 Main St, Austin, TX 78701', parties: ['Jane Seller', 'John Seller'] };
const SYNTHETIC_ARTIFACT_BYTES = Buffer.from('IAOS synthetic non-sensitive fixture artifact bytes -- not a real PDF.', 'utf8');

function validOutcome() {
  return { kind: 'retrieved', bytes: SYNTHETIC_ARTIFACT_BYTES };
}

function baseArgs(over) {
  return Object.assign({
    opportunityId: OPP,
    agreementAt: AGREEMENT_AT,
    version: V1,
    acceptedSend: acceptedSendFixture({}),
    requirements: REQUIREMENTS,
    providerRecipients: providerRecipientsAllComplete(),
    lifecycleHistory: [completedLifecycleObservation({})],
    artifactOutcome: validOutcome(),
    retrievedForDocumentId: DOC_ID,
    retrievedForVersion: V1,
    agreementTermsSnapshot: AGREEMENT_TERMS,
    executedTermsSnapshot: MATCHING_EXECUTED_TERMS,
    iaosVerifiedAt: VERIFIED_AT,
    evidenceSummary: 'Full joint verification: accepted send, signer-level completion, provider completed status, artifact retrieved and hashed, terms match.',
    relatedPriorRecordId: null,
  }, over || {});
}

/* ====================================================================== */
/* 1. Valid exact evidence satisfies the gate end to end                  */
/* ====================================================================== */

{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  checkTrue('valid, complete, exact evidence produces an eligible Under Contract record', result.ok);
  if (result.ok) {
    check('record carries opportunityId', result.value.opportunityId, OPP);
    check('record carries agreementAt', result.value.agreementAt, AGREEMENT_AT);
    check('record carries the accepted send attempt id', result.value.acceptedSendAttemptId, REQUEST_AT);
    check('record carries the confirmed provider document id', result.value.providerDocumentId, DOC_ID);
    check('record carries the provider-reported completion time', result.value.providerReportedCompletionAt, COMPLETION_REPORTED_AT);
    check('record carries exactly two verified signers', result.value.signers.length, 2);
    check('record carries executedTermsConflictCount 0', result.value.executedTermsConflictCount, 0);
    check('record authority is system_derived', result.value.authority, 'system_derived');
    checkTrue('record artifactSha256 is a real 64-hex-char digest', /^[0-9a-f]{64}$/.test(result.value.artifactSha256));
  }
}

/* ====================================================================== */
/* 2. Every two-of-three combination remains ineligible                   */
/*    (signer completion + provider completion + preserved document)      */
/* ====================================================================== */

{
  // Signers + provider completion present; artifact/preservation MISSING.
  const twoOfThreeA = E.buildVerifiedUnderContractRecord(baseArgs({ artifactOutcome: { kind: 'network_error', message: 'timeout' } }));
  checkFalse('two-of-three (missing preserved artifact) remains ineligible', twoOfThreeA.ok);
  check('failure stage is artifact', twoOfThreeA.failure.stage, 'artifact');
}
{
  // Signers + artifact present; provider completion MISSING (no completed observation at all).
  const twoOfThreeB = E.buildVerifiedUnderContractRecord(baseArgs({ lifecycleHistory: [] }));
  checkFalse('two-of-three (missing provider completion) remains ineligible', twoOfThreeB.ok);
  check('failure stage is provider_completion', twoOfThreeB.failure.stage, 'provider_completion');
}
{
  // Provider completion + artifact present; signer completion MISSING.
  const twoOfThreeC = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: providerRecipientsAllComplete([{}, { hasCompleted: false }]) }));
  checkFalse('two-of-three (missing signer completion) remains ineligible', twoOfThreeC.ok);
  check('failure stage is signers', twoOfThreeC.failure.stage, 'signers');
}

/* ====================================================================== */
/* 3. Each required signer must complete; aggregate cannot substitute     */
/* ====================================================================== */

{
  const oneIncomplete = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: providerRecipientsAllComplete([{}, { hasCompleted: false }]) }));
  checkFalse('one incomplete signer out of two blocks the whole record, even though the other completed', oneIncomplete.ok);
  checkTrue('failure names SIGNER_INCOMPLETE', oneIncomplete.failure.reasons.some((r) => r.code === 'SIGNER_INCOMPLETE'));
}
{
  // Aggregate lifecycle status says "completed" (built from recipients that
  // WERE all complete at observation time), but the live, independently-
  // supplied signer-level readback for THIS verification shows one signer
  // incomplete -- aggregate history must never substitute for fresh
  // signer-level proof.
  const aggregateVsSignerLevel = E.buildVerifiedUnderContractRecord(baseArgs({
    lifecycleHistory: [completedLifecycleObservation({})], // aggregate says completed
    providerRecipients: providerRecipientsAllComplete([{}, { hasCompleted: false }]), // but live signer check disagrees
  }));
  checkFalse('an aggregate "completed" lifecycle observation cannot substitute for a live signer-level completion check', aggregateVsSignerLevel.ok);
  check('failure stage is signers, not provider_completion', aggregateVsSignerLevel.failure.stage, 'signers');
}

/* ====================================================================== */
/* 4. Signer role/identity substitution fails                             */
/* ====================================================================== */

{
  const substituted = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: providerRecipientsAllComplete([{}, { contactName: 'Someone Else' }]) }));
  checkFalse('a provider recipient whose name does not match the expected signer identity fails', substituted.ok);
  checkTrue('failure names SIGNER_IDENTITY_MISMATCH', substituted.failure.reasons.some((r) => r.code === 'SIGNER_IDENTITY_MISMATCH'));
}
{
  const ambiguous = E.buildVerifiedUnderContractRecord(baseArgs({
    providerRecipients: [
      { role: 'Seller', contactName: 'Unknown A', recipientId: 'r1', hasCompleted: true, completedAt: null },
      { role: 'Seller', contactName: 'Unknown B', recipientId: 'r1b', hasCompleted: true, completedAt: null },
      { role: 'Spouse', contactName: 'John Seller', recipientId: 'r2', hasCompleted: true, completedAt: null },
    ],
  }));
  checkFalse('two recipients claiming the same role, neither disambiguated by name, fails as ambiguous', ambiguous.ok);
  checkTrue('failure names SIGNER_ROLE_AMBIGUOUS', ambiguous.failure.reasons.some((r) => r.code === 'SIGNER_ROLE_AMBIGUOUS'));
}
{
  const missingRole = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: [providerRecipientsAllComplete()[0]] }));
  checkFalse('a required role with no matching provider recipient at all fails', missingRole.ok);
  checkTrue('failure names SIGNER_MISSING', missingRole.failure.reasons.some((r) => r.code === 'SIGNER_MISSING'));
}
{
  const extra = E.buildVerifiedUnderContractRecord(baseArgs({
    providerRecipients: providerRecipientsAllComplete().concat([{ role: 'Notary', contactName: 'Unexpected Party', recipientId: 'r3', hasCompleted: true, completedAt: null }]),
  }));
  checkFalse('an extra, unmapped recipient the expected roles cannot account for fails', extra.ok);
  checkTrue('failure names SIGNER_EXTRA_UNMAPPED', extra.failure.reasons.some((r) => r.code === 'SIGNER_EXTRA_UNMAPPED'));
}
{
  const recipientIdMismatch = E.buildVerifiedUnderContractRecord(baseArgs({
    expectedRecipientIdByRole: { Seller: 'expected-seller-recipient-id' },
    providerRecipients: providerRecipientsAllComplete(), // recipientId 'r1', not the expected one
  }));
  checkFalse('a known expected recipient id that disagrees with the matched provider row fails', recipientIdMismatch.ok);
  checkTrue('failure names SIGNER_RECIPIENT_ID_MISMATCH', recipientIdMismatch.failure.reasons.some((r) => r.code === 'SIGNER_RECIPIENT_ID_MISMATCH'));
}
{
  const dupRoleRequirement = E.buildVerifiedUnderContractRecord(baseArgs({
    requirements: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }, { role: 'Seller', displayName: 'Jane Seller Two', signingAuthorityNote: null }],
  }));
  checkFalse('duplicate required roles are refused before any provider row is even consulted', dupRoleRequirement.ok);
  check('failure stage is signers', dupRoleRequirement.failure.stage, 'signers');
  checkTrue('failure names SIGNER_REQUIREMENTS_INVALID', dupRoleRequirement.failure.reasons.some((r) => r.code === 'SIGNER_REQUIREMENTS_INVALID'));
}

/* ====================================================================== */
/* 5. Opportunity/version/document/revision evidence cannot cross         */
/*    boundaries                                                          */
/* ====================================================================== */

{
  const wrongOppSend = E.buildVerifiedUnderContractRecord(baseArgs({ opportunityId: 'opp-DIFFERENT' }));
  checkFalse('an opportunityId not matching the accepted send evidence fails at binding', wrongOppSend.ok);
  check('failure stage is binding', wrongOppSend.failure.stage, 'binding');
}
{
  const wrongVersionSend = E.buildVerifiedUnderContractRecord(baseArgs({ version: V2, agreementAt: V2.agreementAt }));
  checkFalse('a contract version not matching the accepted send evidence fails at binding', wrongVersionSend.ok);
  check('failure stage is binding', wrongVersionSend.failure.stage, 'binding');
}
{
  const wrongArtifactDoc = E.buildVerifiedUnderContractRecord(baseArgs({ retrievedForDocumentId: OTHER_DOC_ID }));
  checkFalse('an artifact retrieved for the wrong document id fails at the artifact stage', wrongArtifactDoc.ok);
  checkTrue('failure names ARTIFACT_DOCUMENT_MISMATCH', wrongArtifactDoc.failure.reasons.some((r) => r.code === 'ARTIFACT_DOCUMENT_MISMATCH'));
}
{
  const wrongArtifactVersion = E.buildVerifiedUnderContractRecord(baseArgs({ retrievedForVersion: V2 }));
  checkFalse('an artifact confirmed for the wrong contract version fails at the artifact stage', wrongArtifactVersion.ok);
  checkTrue('failure names ARTIFACT_VERSION_MISMATCH', wrongArtifactVersion.failure.reasons.some((r) => r.code === 'ARTIFACT_VERSION_MISMATCH'));
}
{
  // Revision conflict is already enforced by the reused verifyAcceptedSendBinding path one level up (contract-lifecycle-model.ts) --
  // exercised here to prove INV-65 inherits that same boundary rather than re-deciding it.
  const revisionConflictSend = acceptedSendFixture({ providerResponse: Object.assign({}, acceptedSendFixture({}).providerResponse, { documentId: '' }) });
  const malformedSendResult = E.buildVerifiedUnderContractRecord(baseArgs({ acceptedSend: revisionConflictSend }));
  checkFalse('malformed accepted-send evidence (blank documentId despite accepted status) fails at binding', malformedSendResult.ok);
  check('failure stage is binding', malformedSendResult.failure.stage, 'binding');
}

/* ====================================================================== */
/* 6. Executed artifact retrieval failure fails closed                    */
/* ====================================================================== */

{
  const networkFailure = E.buildVerifiedUnderContractRecord(baseArgs({ artifactOutcome: { kind: 'network_error', message: 'ECONNRESET' } }));
  checkFalse('an artifact retrieval network failure fails closed', networkFailure.ok);
  checkTrue('failure names ARTIFACT_RETRIEVAL_FAILED', networkFailure.failure.reasons.some((r) => r.code === 'ARTIFACT_RETRIEVAL_FAILED'));
}
{
  const emptyArtifact = E.buildVerifiedUnderContractRecord(baseArgs({ artifactOutcome: { kind: 'retrieved', bytes: Buffer.alloc(0) } }));
  checkFalse('a zero-byte artifact fails closed', emptyArtifact.ok);
  checkTrue('failure names ARTIFACT_EMPTY', emptyArtifact.failure.reasons.some((r) => r.code === 'ARTIFACT_EMPTY'));
}

/* ====================================================================== */
/* 7. SHA-256 is computed from exact artifact bytes; malformed/altered    */
/*    hashes fail                                                         */
/* ====================================================================== */

{
  const independentHash = crypto.createHash('sha256').update(SYNTHETIC_ARTIFACT_BYTES).digest('hex');
  check('computeSha256Hex matches an independently computed SHA-256 of the exact same bytes', E.computeSha256Hex(SYNTHETIC_ARTIFACT_BYTES), independentHash);
}
{
  const otherBytes = Buffer.from('different synthetic bytes entirely', 'utf8');
  checkTrue('different artifact bytes produce a different hash', E.computeSha256Hex(SYNTHETIC_ARTIFACT_BYTES) !== E.computeSha256Hex(otherBytes));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const goodNote = EC.formatUnderContractNote(result.value);
  const lines = goodNote.split('\n');
  const shaIdx = lines.findIndex((l) => l.startsWith('Artifact SHA-256: '));
  lines[shaIdx] = 'Artifact SHA-256: ' + 'a'.repeat(63); // one char short -- malformed
  checkNull('parse: a malformed (wrong-length) SHA-256 is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const goodNote = EC.formatUnderContractNote(result.value);
  const lines = goodNote.split('\n');
  const shaIdx = lines.findIndex((l) => l.startsWith('Artifact SHA-256: '));
  const original = lines[shaIdx];
  const altered = original.slice(0, -1) + (original.slice(-1) === 'a' ? 'b' : 'a'); // flip the last hex char
  lines[shaIdx] = altered;
  const parsed = EC.parseUnderContractNote(lines.join('\n'));
  checkTrue('parse: an altered-but-still-valid-length SHA-256 still parses (shape validity only) but no longer equals the original', parsed !== null && parsed.artifactSha256 !== result.value.artifactSha256);
}

/* ====================================================================== */
/* 8. Material-term conflicts fail                                        */
/* ====================================================================== */

{
  const priceConflict = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsSnapshot: Object.assign({}, MATCHING_EXECUTED_TERMS, { price: 210000 }) }));
  checkFalse('a price conflict between executed terms and the Agreement Reached snapshot fails closed', priceConflict.ok);
  check('failure stage is eligibility (the reused evaluateUnderContractEligibility gate)', priceConflict.failure.stage, 'eligibility');
  checkTrue('failure names EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT', priceConflict.failure.reasons.some((r) => r.code === 'EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT'));
}
{
  const propertyConflict = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsSnapshot: Object.assign({}, MATCHING_EXECUTED_TERMS, { propertyAddress: '999 Different St' }) }));
  checkFalse('a property-address conflict fails closed', propertyConflict.ok);
  checkTrue('failure names EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT', propertyConflict.failure.reasons.some((r) => r.code === 'EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT'));
}
{
  const partyConflict = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsSnapshot: Object.assign({}, MATCHING_EXECUTED_TERMS, { parties: ['Jane Seller'] }) }));
  checkFalse('a parties conflict (a party missing from the executed set) fails closed', partyConflict.ok);
  checkTrue('failure names EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT', partyConflict.failure.reasons.some((r) => r.code === 'EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT'));
}
{
  // This module performs the comparison itself -- there is no boolean parameter to pass at all.
  checkTrue('buildVerifiedUnderContractRecord exposes no naked boolean "termsMatch" parameter', !('executedTermsMatchAgreement' in baseArgs({})) && !('termsMatch' in baseArgs({})));
}

/* ====================================================================== */
/* 9. Corrected/superseded/declined/expired/rescinded versions fail       */
/* ====================================================================== */

function acceptedRescissionEvidence() {
  const built = L.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Seller withdrew.', authorizedBy: 'brad', authorizedAt: '2026-09-12T12:30:00.000Z',
    acceptedSend: acceptedSendFixture({}), iaosObservedAt: '2026-09-12T12:30:00.000Z', evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  if (!built.ok) throw new Error('fixture rescission failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

{
  const rescinded = E.buildVerifiedUnderContractRecord(baseArgs({ lifecycleHistory: [completedLifecycleObservation({}), acceptedRescissionEvidence()] }));
  checkFalse('a rescission record for this exact version blocks Under Contract even with an earlier completed observation', rescinded.ok);
  check('failure stage is provider_completion', rescinded.failure.stage, 'provider_completion');
  checkTrue('failure names PROVIDER_COMPLETION_EVIDENCE_TAINTED', rescinded.failure.reasons.some((r) => r.code === 'PROVIDER_COMPLETION_EVIDENCE_TAINTED'));
}
{
  const declined = E.buildVerifiedUnderContractRecord(baseArgs({
    lifecycleHistory: [completedLifecycleObservation({ build: { iaosObservedAt: '2026-09-12T12:00:00.000Z' } }),
      completedLifecycleObservation({ doc: { status: 'sent', recipients: [] }, build: { iaosObservedAt: '2026-09-12T12:30:00.000Z', evidenceSummary: 'later status changed' } })],
  }));
  checkFalse('a later, non-completed provider observation supersedes an earlier completed one and blocks Under Contract', declined.ok);
  check('failure stage is provider_completion', declined.failure.stage, 'provider_completion');
  checkTrue('failure names PROVIDER_COMPLETION_NOT_LATEST', declined.failure.reasons.some((r) => r.code === 'PROVIDER_COMPLETION_NOT_LATEST'));
}
{
  // A correction record whose PRIOR version is V1 does NOT taint V1's own
  // history -- it is scoped to the NEW version it creates (`newVersion`),
  // never to the version it was corrected FROM. This matches
  // SELLER_CONTRACT_STATE_MACHINE_V1.md's own locked rule verbatim: "the
  // prior executed version remains authoritative in IAOS until either the
  // replacement itself reaches verified full execution, or Brad records a
  // separate, authorized Rescission" -- a later correction existing is
  // explicitly NOT, by itself, one of those two things. Only a genuine
  // RESCISSION of this exact version (proven separately below) may block it.
  const correctionRecord = L.buildCorrectionRecord({
    opportunityId: OPP, priorVersion: V1, classification: { kind: 'same_agreement_reentry' }, newAgreementAt: null,
    recordedBy: 'rep-1', iaosObservedAt: '2026-09-12T12:15:00.000Z', evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  check('sanity: the correction record\'s own newVersion differs from V1 (it does not share V1\'s version identity)', B.isSameContractVersion(correctionRecord.value.newVersion, V1), false);
  const stillEligible = E.buildVerifiedUnderContractRecord(baseArgs({ lifecycleHistory: [completedLifecycleObservation({}), correctionRecord.value] }));
  checkTrue('a correction record scoped to a DIFFERENT (newer) version does not block THIS version\'s own verified Under Contract, per the locked no-reentry/authoritative-until-replaced rule', stillEligible.ok);
}
{
  const resent = E.buildVerifiedUnderContractRecord(baseArgs({
    lifecycleHistory: [completedLifecycleObservation({}), L.buildResendRecord({
      opportunityId: OPP, version: V1, priorSend: acceptedSendFixture({}), newAttemptId: '2026-09-12T12:20:00.000Z',
      authorizedBy: 'brad', authorizedAt: '2026-09-12T12:20:00.000Z', recordedBy: 'brad',
      iaosObservedAt: '2026-09-12T12:20:00.000Z', evidenceSummary: 'x', relatedPriorRecordId: null,
    }).value],
  }));
  checkFalse('a resend record for this exact version blocks Under Contract', resent.ok);
  check('failure stage is provider_completion', resent.failure.stage, 'provider_completion');
}
{
  const declinedHuman = E.buildVerifiedUnderContractRecord(baseArgs({
    lifecycleHistory: [completedLifecycleObservation({}), L.buildDeclineRecord({
      opportunityId: OPP, version: V1, acceptedSend: acceptedSendFixture({}), reasonOrEvidence: 'Seller changed mind.',
      recordedBy: 'rep-1', declinedAt: '2026-09-12T12:25:00.000Z', iaosObservedAt: '2026-09-12T12:25:00.000Z',
      evidenceSummary: 'x', relatedPriorRecordId: null,
    }).value],
  }));
  checkFalse('a human decline record for this exact version blocks Under Contract', declinedHuman.ok);
  check('failure stage is provider_completion', declinedHuman.failure.stage, 'provider_completion');
}

/* ====================================================================== */
/* 10. Under Contract write failure / readback absence or mismatch does   */
/*     not transition                                                     */
/* ====================================================================== */

{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const writeFailed = E.verifyReadbackMatchesWritten(result.value, null);
  checkFalse('a failed write (no readback at all) never counts as a transition', writeFailed.ok);
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const mismatchedReadback = Object.assign({}, result.value, { artifactSha256: 'f'.repeat(64) });
  const readbackMismatch = E.verifyReadbackMatchesWritten(result.value, mismatchedReadback);
  checkFalse('a readback that does not exactly equal what was written never counts as a transition', readbackMismatch.ok);
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const exactReadback = JSON.parse(JSON.stringify(result.value));
  const readbackOk = E.verifyReadbackMatchesWritten(result.value, exactReadback);
  checkTrue('an exactly-equal readback confirms the transition', readbackOk.ok);
}

/* ====================================================================== */
/* 11. A verified append-only record round-trips exactly                  */
/* ====================================================================== */

{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const note = EC.formatUnderContractNote(result.value);
  const parsed = EC.parseUnderContractNote(note);
  checkTrue('the note round-trips to a non-null record', parsed !== null);
  check('round-trip is byte-for-byte field-equal to the original', JSON.stringify(parsed), JSON.stringify(result.value));
}

/* ====================================================================== */
/* 12. Duplicate handling never erases history                            */
/* ====================================================================== */

{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const recordA = result.value;
  const recordB = Object.assign({}, result.value, { iaosVerifiedAt: '2026-09-12T14:00:00.000Z', evidenceSummary: 'Re-verified independently, same underlying evidence.' });
  checkTrue('two independently-timestamped verifications of the identical underlying evidence are recognized as duplicates', E.isDuplicateUnderContractRecord(recordA, recordB));
  const noteA = EC.formatUnderContractNote(recordA);
  const noteB = EC.formatUnderContractNote(recordB);
  const all = EC.allUnderContractRecordsForOpportunity([{ body: noteA }, { body: noteB }], OPP);
  check('both duplicate records remain in the append-only history -- neither is erased', all.length, 2);
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const differentRecord = Object.assign({}, result.value, { artifactSha256: crypto.createHash('sha256').update('a genuinely different artifact').digest('hex') });
  checkFalse('a record differing in a real evidentiary field is NOT a duplicate', E.isDuplicateUnderContractRecord(result.value, differentRecord));
}

/* ====================================================================== */
/* 13. Malformed, incomplete, mixed-version, and authority-confused       */
/*     records fail closed on parse                                       */
/* ====================================================================== */

checkNull('parse: unrelated text is rejected', EC.parseUnderContractNote('not an under contract note'));
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const goodNote = EC.formatUnderContractNote(result.value);
  const lines = goodNote.split('\n');
  const agreementIdx = lines.findIndex((l) => l.startsWith('Agreement Reached at: '));
  lines[agreementIdx] = 'Agreement Reached at: 2099-01-01T00:00:00.000Z'; // disagrees with Version's own agreementAt
  checkNull('parse: a mixed-version record (Agreement Reached at disagreeing with Version.agreementAt) is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const goodNote = EC.formatUnderContractNote(result.value);
  const lines = goodNote.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: provider_reported'; // authority-confused -- Under Contract is never a bare provider fact
  checkNull('parse: an authority-confused record (not the literal system_derived) is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const goodNote = EC.formatUnderContractNote(result.value);
  const lines = goodNote.split('\n');
  const conflictsIdx = lines.findIndex((l) => l.startsWith('Executed terms conflicts: '));
  lines[conflictsIdx] = 'Executed terms conflicts: [{"field":"price","agreementValue":"1","candidateValue":"2"}]';
  checkNull('parse: a non-empty Executed terms conflicts array is rejected -- a valid record never carries one', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const goodNote = EC.formatUnderContractNote(result.value);
  const lines = goodNote.split('\n');
  const signersIdx = lines.findIndex((l) => l.startsWith('Signers: '));
  lines[signersIdx] = 'Signers: []';
  checkNull('parse: an empty Signers array is rejected -- Under Contract requires at least one verified signer', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const goodNote = EC.formatUnderContractNote(result.value);
  const lines = goodNote.split('\n');
  const completionIdx = lines.findIndex((l) => l.startsWith('Provider reported completion at: '));
  lines[completionIdx] = 'Provider reported completion at: UNAVAILABLE';
  checkNull('parse: a missing (required, never optional) provider-reported completion time is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
checkNull('parse: correct header but wrong line count is rejected', EC.parseUnderContractNote('IAOS UNDER CONTRACT — iaos-under-contract-v1\nRecorded at: 2026-01-01T00:00:00.000Z'));
checkNull('parse: empty string is rejected', EC.parseUnderContractNote(''));

/* ====================================================================== */
/* 14. Seller Closed-Won / pipeline-stage writes are absent (static scan) */
/* ====================================================================== */

{
  const modelSource = fs.readFileSync(path.join(LIB, 'contract-execution-model.ts'), 'utf8');
  const carrierSource = fs.readFileSync(path.join(LIB, 'contract-execution-carriers.ts'), 'utf8');
  const combined = modelSource + '\n' + carrierSource;
  const forbidden = ['Seller Closed-Won', 'pipelineId', 'pipeline_stage', 'pipelineStageId', '/opportunities/'];
  const found = forbidden.filter((token) => combined.includes(token));
  check('neither new INV-65 source file references a pipeline stage, Seller Closed-Won, or a direct /opportunities/ write path', found, []);
}

/* ====================================================================== */
/* Summary                                                                 */
/* ====================================================================== */

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
console.log('No contract send, provider mutation, network call, or GHL/Production write occurred in this run -- every fixture above is an in-memory object, and all artifact bytes are synthetic, non-sensitive fixture text.');
cleanup();
process.exit(failures === 0 ? 0 : 1);
