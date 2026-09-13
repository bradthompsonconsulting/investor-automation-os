/**
 * Board #9 verified full execution -- deterministic model + carrier test
 * runner. B9-10 / INV-65. Jess Gate repair round, 2026-09-13 (approved V1
 * boundary: manual executed-artifact bridge, provider-recipient-id signer
 * binding, executed-term verification explicitly unavailable).
 *
 * Compiles contract-execution-model.ts, contract-execution-carriers.ts,
 * and their dependency chain to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases mapped directly to
 * this repair round's own "Proof required" list. Every provider response,
 * send record, and PDF selection used here is a SIMULATED fixture object
 * -- no network call, no live GHL call, no `ghl.notes.create()`. Artifact
 * bytes are synthetic, non-sensitive ASCII text prefixed with the real PDF
 * magic-byte signature, never a real PDF.
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
const SIGNED_DATE_SELLER = '2026-09-09T19:23:12.738Z';
const SIGNED_DATE_SPOUSE = '2026-09-09T19:35:04.286Z';

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

// GHL's own generic "signer" role -- EVERY recipient reports this SAME
// literal value, confirmed live 2026-09-13. The mapping's own role field
// ("Seller"/"Spouse") is IAOS's own expected label, never GHL's.
const EXPECTED_SIGNER_MAPPINGS = [
  { role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1' },
  { role: 'Spouse', displayName: 'John Seller', providerRecipientId: 'r2' },
];

function providerRecipientsAllComplete(over) {
  return [
    Object.assign({ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'Jane Seller' }, (over && over[0]) || {}),
    Object.assign({ providerRecipientId: 'r2', hasCompleted: true, signedDate: SIGNED_DATE_SPOUSE, reportedRole: 'signer', reportedContactName: 'John Seller' }, (over && over[1]) || {}),
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

// A REAL PDF file signature ("%PDF-") followed by non-sensitive synthetic
// text -- never a real PDF, never real content.
const SYNTHETIC_MARKER = 'IAOS-SYNTHETIC-FIXTURE-MARKER-7f3a9c';
const SYNTHETIC_PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.4\n', 'ascii'),
  Buffer.from(SYNTHETIC_MARKER + ' -- not a real PDF, not real content.', 'utf8'),
]);
const NON_PDF_BYTES = Buffer.from('this is plainly not a pdf file at all', 'utf8');

function validManualOutcome(over) {
  return Object.assign({ kind: 'selected', bytes: SYNTHETIC_PDF_BYTES, fileName: 'executed.pdf', mimeType: 'application/pdf' }, over || {});
}

function baseArgs(over) {
  return Object.assign({
    opportunityId: OPP,
    agreementAt: AGREEMENT_AT,
    version: V1,
    acceptedSend: acceptedSendFixture({}),
    expectedSignerMappings: EXPECTED_SIGNER_MAPPINGS,
    providerRecipients: providerRecipientsAllComplete(),
    lifecycleHistory: [completedLifecycleObservation({})],
    manualArtifactOutcome: validManualOutcome({}),
    selectedForDocumentId: DOC_ID,
    selectedForVersion: V1,
    iaosVerifiedAt: VERIFIED_AT,
    evidenceSummary: 'Full joint verification: accepted send, signer-level completion via provider recipient id, provider completed status, PDF manually selected and hashed.',
    relatedPriorRecordId: null,
  }, over || {});
}

/* ====================================================================== */
/* 1. Material-term V1 boundary -- Under Contract remains BLOCKED even    */
/*    with every other piece of evidence fully valid                     */
/* ====================================================================== */

{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  checkFalse('even with fully valid signer/completion/artifact evidence, Under Contract remains blocked in V1', result.ok);
  check('failure stage is executed_terms', result.failure.stage, 'executed_terms');
  checkTrue('failure names the explicit EXECUTED_TERMS_EVIDENCE_UNAVAILABLE reason', result.failure.reasons.some((r) => r.code === 'EXECUTED_TERMS_EVIDENCE_UNAVAILABLE'));
}
{
  checkFalse('BuildVerifiedExecutionArgs has no executedTermsSnapshot field at all', 'executedTermsSnapshot' in baseArgs({}));
  checkFalse('BuildVerifiedExecutionArgs has no agreementTermsSnapshot field at all', 'agreementTermsSnapshot' in baseArgs({}));
  checkFalse('BuildVerifiedExecutionArgs has no naked executedTermsMatchAgreement boolean field', 'executedTermsMatchAgreement' in baseArgs({}));
}
{
  // A caller attempting to smuggle in a claim that terms match has no effect -- the field is never read.
  const smuggled = E.buildVerifiedUnderContractRecord(Object.assign(baseArgs({}), { executedTermsMatchAgreement: true, executedTermsSnapshot: { price: 1, propertyAddress: 'x', parties: [] }, termsMatch: true }));
  checkFalse('smuggled/extra material-term-claiming fields cannot unlock eligibility -- still blocked', smuggled.ok);
  check('still fails at executed_terms regardless of smuggled fields', smuggled.failure.stage, 'executed_terms');
}
{
  // The deterministic conflict logic itself is preserved and correct, even though unwired.
  const agreement = { price: 190000, propertyAddress: '123 Main St', parties: ['Jane Seller'] };
  const matching = { price: 190000, propertyAddress: '123 Main St', parties: ['Jane Seller'] };
  const conflicting = { price: 210000, propertyAddress: '123 Main St', parties: ['Jane Seller'] };
  check('evaluateExecutedTermsConflicts finds zero conflicts for identical terms (preserved logic works correctly)', E.evaluateExecutedTermsConflicts(agreement, matching).length, 0);
  checkTrue('evaluateExecutedTermsConflicts finds a real conflict for a price mismatch (preserved logic works correctly)', E.evaluateExecutedTermsConflicts(agreement, conflicting).some((c) => c.field === 'price'));
}

/* ====================================================================== */
/* 2. Manual PDF selection hashes exact bytes                             */
/* ====================================================================== */

{
  const independentHash = crypto.createHash('sha256').update(SYNTHETIC_PDF_BYTES).digest('hex');
  check('computeSha256Hex matches an independently computed SHA-256 of the exact same bytes', E.computeSha256Hex(SYNTHETIC_PDF_BYTES), independentHash);
}
{
  const result = E.verifyManualArtifactSelection({
    outcome: validManualOutcome({}), confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1,
  });
  checkTrue('a valid manual selection produces a real 64-hex-char SHA-256', result.ok && /^[0-9a-f]{64}$/.test(result.sha256));
  check('the hash matches the independently computed hash of the exact selected bytes', result.sha256, crypto.createHash('sha256').update(SYNTHETIC_PDF_BYTES).digest('hex'));
}
{
  const otherBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('entirely different synthetic content')]);
  checkTrue('different selected bytes produce a different hash', E.computeSha256Hex(SYNTHETIC_PDF_BYTES) !== E.computeSha256Hex(otherBytes));
}

/* ====================================================================== */
/* 3. PDF bytes are never persisted or logged in this module's own output */
/* ====================================================================== */

{
  const result = E.verifyManualArtifactSelection({
    outcome: validManualOutcome({}), confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1,
  });
  const serialized = JSON.stringify(result);
  checkFalse('the synthetic marker embedded in the selected bytes never appears in verifyManualArtifactSelection\'s own return value', serialized.includes(SYNTHETIC_MARKER));
  checkFalse('verifyManualArtifactSelection\'s successful result carries no "bytes" field at all', result.ok && 'bytes' in result);
}
{
  const fullResultArgs = baseArgs({});
  // Temporarily force material-term evidence available is impossible from
  // here (the constant is not exported/overridable by design) -- prove
  // instead that even the FAILURE path (which IS reachable) never echoes bytes.
  const result = E.buildVerifiedUnderContractRecord(fullResultArgs);
  const serialized = JSON.stringify(result);
  checkFalse('buildVerifiedUnderContractRecord\'s own output never contains the synthetic marker embedded in the selected PDF bytes', serialized.includes(SYNTHETIC_MARKER));
}
{
  const source = fs.readFileSync(path.join(LIB, 'contract-execution-model.ts'), 'utf8');
  checkFalse('contract-execution-model.ts never calls fetch(...) anywhere -- no automated GHL download exists, by construction, not merely by policy', /\bfetch\s*\(/.test(source));
  checkFalse('contract-execution-model.ts never calls console.log/console.error on raw bytes (no logging of artifact content)', /console\.(log|error|warn|info)\(/.test(source));
}

/* ====================================================================== */
/* 4. Absent/invalid/unreadable files fail closed                        */
/* ====================================================================== */

{
  const r = E.verifyManualArtifactSelection({ outcome: { kind: 'no_file' }, confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1 });
  checkFalse('no file selected fails closed', r.ok);
  check('failure names NO_FILE_SELECTED', r.reasons[0].code, 'NO_FILE_SELECTED');
}
{
  const r = E.classifySelectedFile({ fileName: 'not-a-pdf.txt', mimeType: 'text/plain', bytes: NON_PDF_BYTES });
  check('a non-PDF file (wrong magic bytes) is classified as invalid_file_type from its REAL content, not a spoofable label', r.kind, 'invalid_file_type');
  const r2 = E.verifyManualArtifactSelection({ outcome: r, confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1 });
  checkFalse('a non-PDF file selection fails closed', r2.ok);
  check('failure names INVALID_FILE_TYPE', r2.reasons[0].code, 'INVALID_FILE_TYPE');
}
{
  // A file claiming to be a PDF by mime type/filename, but whose actual bytes do NOT start with the real PDF signature, is still rejected.
  const spoofed = E.classifySelectedFile({ fileName: 'executed.pdf', mimeType: 'application/pdf', bytes: NON_PDF_BYTES });
  check('a spoofed mime-type/filename cannot substitute for the real PDF content signature', spoofed.kind, 'invalid_file_type');
}
{
  const r = E.classifySelectedFile({ fileName: 'empty.pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(0) });
  check('a zero-byte file is classified as empty_file', r.kind, 'empty_file');
  const r2 = E.verifyManualArtifactSelection({ outcome: r, confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1 });
  checkFalse('an empty file selection fails closed', r2.ok);
  check('failure names FILE_EMPTY', r2.reasons[0].code, 'FILE_EMPTY');
}
{
  const r = E.verifyManualArtifactSelection({
    outcome: { kind: 'unreadable', message: 'FileReader error: NotReadableError' },
    confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1,
  });
  checkFalse('an unreadable file fails closed', r.ok);
  check('failure names FILE_UNREADABLE', r.reasons[0].code, 'FILE_UNREADABLE');
}
{
  const r = E.classifySelectedFile({ fileName: null, mimeType: null, bytes: null });
  check('classifySelectedFile with no bytes at all reports no_file', r.kind, 'no_file');
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ manualArtifactOutcome: { kind: 'no_file' } }));
  checkFalse('the full pipeline fails closed at the artifact stage when no file was selected', result.ok);
  check('failure stage is artifact', result.failure.stage, 'artifact');
}

/* ====================================================================== */
/* 5. GHL's generic "signer" role is never trusted as the contract-role   */
/*    authority -- provider recipient id is the primary join             */
/* ====================================================================== */

{
  // Every recipient reports the SAME generic role "signer" -- if role were
  // ever used for matching, this would be hopelessly ambiguous. It is not,
  // because matching happens by providerRecipientId instead.
  checkTrue('fixture: both provider recipients report the identical generic role "signer"', providerRecipientsAllComplete().every((r) => r.reportedRole === 'signer'));
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS, providerRecipients: providerRecipientsAllComplete() });
  checkTrue('signer verification succeeds correctly via recipient id despite both recipients sharing the identical generic GHL role', result.ok);
  if (result.ok) {
    check('the Seller mapping resolves to recipient r1, not confused with r2 despite identical reportedRole', result.matches.find((m) => m.role === 'Seller').providerRecipientId, 'r1');
    check('the Spouse mapping resolves to recipient r2, not confused with r1 despite identical reportedRole', result.matches.find((m) => m.role === 'Spouse').providerRecipientId, 'r2');
  }
}
{
  // Changing reportedRole to something else entirely has NO effect on matching -- proving role is genuinely never consulted.
  const withNonsenseRoles = providerRecipientsAllComplete([{ reportedRole: 'this-value-is-never-read' }, { reportedRole: null }]);
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS, providerRecipients: withNonsenseRoles });
  checkTrue('signer verification is completely unaffected by whatever GHL reports as role -- matching never reads that field', result.ok);
}

/* ====================================================================== */
/* 6. Provider recipient IDs bind expected signers; evidence cannot cross */
/*    documents/opportunities/versions                                    */
/* ====================================================================== */

{
  const missing = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS, providerRecipients: [providerRecipientsAllComplete()[0]] });
  checkFalse('a mapped recipient id with no matching evidence row fails closed', missing.ok);
  checkTrue('failure names SIGNER_RECIPIENT_NOT_FOUND', missing.reasons.some((r) => r.code === 'SIGNER_RECIPIENT_NOT_FOUND'));
}
{
  const extra = E.verifyRequiredSigners({
    mappings: EXPECTED_SIGNER_MAPPINGS,
    providerRecipients: providerRecipientsAllComplete().concat([{ providerRecipientId: 'r3-unexpected', hasCompleted: true, signedDate: null, reportedRole: 'signer', reportedContactName: 'Unexpected Party' }]),
  });
  checkFalse('an extra, unmapped recipient the expected mapping cannot account for fails closed', extra.ok);
  checkTrue('failure names SIGNER_EXTRA_UNMAPPED', extra.reasons.some((r) => r.code === 'SIGNER_EXTRA_UNMAPPED'));
}
{
  const dupMappingRole = E.verifyRequiredSigners({
    mappings: [{ role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1' }, { role: 'Seller', displayName: 'Jane Seller Two', providerRecipientId: 'r2' }],
    providerRecipients: providerRecipientsAllComplete(),
  });
  checkFalse('a duplicate role within the expected mapping is rejected before any evidence is consulted', dupMappingRole.ok);
  checkTrue('failure names SIGNER_MAPPING_INVALID', dupMappingRole.reasons.some((r) => r.code === 'SIGNER_MAPPING_INVALID'));
}
{
  const dupMappingId = E.verifyRequiredSigners({
    mappings: [{ role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1' }, { role: 'Spouse', displayName: 'John Seller', providerRecipientId: 'r1' }],
    providerRecipients: providerRecipientsAllComplete(),
  });
  checkFalse('a duplicate provider recipient id claimed by two different expected roles is rejected -- ambiguous identity', dupMappingId.ok);
  checkTrue('failure names SIGNER_MAPPING_INVALID', dupMappingId.reasons.some((r) => r.code === 'SIGNER_MAPPING_INVALID'));
}
{
  const dupEvidence = E.verifyRequiredSigners({
    mappings: EXPECTED_SIGNER_MAPPINGS,
    providerRecipients: [providerRecipientsAllComplete()[0], providerRecipientsAllComplete()[0]],
  });
  checkFalse('the raw provider evidence itself containing duplicate recipient ids is rejected outright, never trusted', dupEvidence.ok);
  checkTrue('failure names SIGNER_RECIPIENT_ID_DUPLICATED_IN_EVIDENCE', dupEvidence.reasons.some((r) => r.code === 'SIGNER_RECIPIENT_ID_DUPLICATED_IN_EVIDENCE'));
}
{
  const wrongOpp = E.buildVerifiedUnderContractRecord(baseArgs({ opportunityId: 'opp-DIFFERENT' }));
  checkFalse('signer/completion evidence cannot cross an OPPORTUNITY boundary', wrongOpp.ok);
  check('failure stage is binding', wrongOpp.failure.stage, 'binding');
}
{
  const wrongVersion = E.buildVerifiedUnderContractRecord(baseArgs({ version: V2, agreementAt: V2.agreementAt }));
  checkFalse('signer/completion evidence cannot cross a CONTRACT VERSION boundary', wrongVersion.ok);
  check('failure stage is binding', wrongVersion.failure.stage, 'binding');
}
{
  const wrongArtifactDoc = E.buildVerifiedUnderContractRecord(baseArgs({ selectedForDocumentId: OTHER_DOC_ID }));
  checkFalse('the selected artifact cannot cross a PROVIDER DOCUMENT boundary', wrongArtifactDoc.ok);
  checkTrue('failure names ARTIFACT_DOCUMENT_MISMATCH', wrongArtifactDoc.failure.reasons.some((r) => r.code === 'ARTIFACT_DOCUMENT_MISMATCH'));
}
{
  const wrongArtifactVersion = E.buildVerifiedUnderContractRecord(baseArgs({ selectedForVersion: V2 }));
  checkFalse('the selected artifact cannot cross a CONTRACT VERSION boundary', wrongArtifactVersion.ok);
  checkTrue('failure names ARTIFACT_VERSION_MISMATCH', wrongArtifactVersion.failure.reasons.some((r) => r.code === 'ARTIFACT_VERSION_MISMATCH'));
}

/* ====================================================================== */
/* 7. Every required signer must complete                                 */
/* ====================================================================== */

{
  const oneIncomplete = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS, providerRecipients: providerRecipientsAllComplete([{}, { hasCompleted: false }]) });
  checkFalse('one incomplete signer out of two blocks the whole result, even though the other completed', oneIncomplete.ok);
  checkTrue('failure names SIGNER_INCOMPLETE', oneIncomplete.reasons.some((r) => r.code === 'SIGNER_INCOMPLETE'));
}

/* ====================================================================== */
/* 8. signedDate is preserved when available                              */
/* ====================================================================== */

{
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS, providerRecipients: providerRecipientsAllComplete() });
  checkTrue('signedDate is preserved verbatim from the provider evidence', result.ok);
  if (result.ok) {
    check('Seller\'s providerCompletedAt equals the provider\'s own signedDate', result.matches.find((m) => m.role === 'Seller').providerCompletedAt, SIGNED_DATE_SELLER);
    check('Spouse\'s providerCompletedAt equals the provider\'s own signedDate', result.matches.find((m) => m.role === 'Spouse').providerCompletedAt, SIGNED_DATE_SPOUSE);
  }
}
{
  const withoutSignedDate = providerRecipientsAllComplete([{ signedDate: null }, {}]);
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS, providerRecipients: withoutSignedDate });
  checkTrue('a missing signedDate is preserved as null -- never fabricated', result.ok);
  if (result.ok) checkNull('Seller\'s providerCompletedAt is null when the provider never reported one', result.matches.find((m) => m.role === 'Seller').providerCompletedAt);
}

/* ====================================================================== */
/* 9. Every two-of-three execution combination remains blocked            */
/* ====================================================================== */

{
  const twoOfThreeA = E.buildVerifiedUnderContractRecord(baseArgs({ manualArtifactOutcome: { kind: 'no_file' } }));
  checkFalse('two-of-three (missing artifact) remains blocked', twoOfThreeA.ok);
  check('failure stage is artifact', twoOfThreeA.failure.stage, 'artifact');
}
{
  const twoOfThreeB = E.buildVerifiedUnderContractRecord(baseArgs({ lifecycleHistory: [] }));
  checkFalse('two-of-three (missing provider completion) remains blocked', twoOfThreeB.ok);
  check('failure stage is provider_completion', twoOfThreeB.failure.stage, 'provider_completion');
}
{
  const twoOfThreeC = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: providerRecipientsAllComplete([{}, { hasCompleted: false }]) }));
  checkFalse('two-of-three (missing signer completion) remains blocked', twoOfThreeC.ok);
  check('failure stage is signers', twoOfThreeC.failure.stage, 'signers');
}
{
  // Even all three present, the executed_terms boundary still blocks -- see section 1.
  const allThree = E.buildVerifiedUnderContractRecord(baseArgs({}));
  checkFalse('even all three primary facts present, the V1 executed-terms boundary still blocks Under Contract', allThree.ok);
}

/* ====================================================================== */
/* 10. Stale/corrected/superseded/declined/expired/rescinded versions fail */
/* ====================================================================== */

{
  const rescission = L.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Seller withdrew.', authorizedBy: 'brad', authorizedAt: '2026-09-12T12:30:00.000Z',
    acceptedSend: acceptedSendFixture({}), iaosObservedAt: '2026-09-12T12:30:00.000Z', evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ lifecycleHistory: [completedLifecycleObservation({}), rescission.value] }));
  checkFalse('a rescission record for this exact version blocks Under Contract even with an earlier completed observation', result.ok);
  check('failure stage is provider_completion', result.failure.stage, 'provider_completion');
}
{
  const laterNonCompleted = E.buildVerifiedUnderContractRecord(baseArgs({
    lifecycleHistory: [
      completedLifecycleObservation({ build: { iaosObservedAt: '2026-09-12T12:00:00.000Z' } }),
      completedLifecycleObservation({ doc: { status: 'sent', recipients: [] }, build: { iaosObservedAt: '2026-09-12T12:30:00.000Z', evidenceSummary: 'status changed later' } }),
    ],
  }));
  checkFalse('a later, non-completed provider observation supersedes an earlier completed one and blocks Under Contract', laterNonCompleted.ok);
  check('failure stage is provider_completion', laterNonCompleted.failure.stage, 'provider_completion');
}

/* ====================================================================== */
/* 11. Write/readback failure never transitions; a verified append-only   */
/*     record round-trips exactly; duplicates never erase history         */
/* ====================================================================== */

function fixtureEligibleRecord() {
  // buildVerifiedUnderContractRecord can never return ok:true in V1 --
  // exercised directly here to prove the carrier/readback machinery still
  // round-trips correctly, exactly as it would once the boundary lifts.
  const built = {
    kind: 'under_contract',
    opportunityId: OPP,
    agreementAt: AGREEMENT_AT,
    version: V1,
    acceptedSendAttemptId: REQUEST_AT,
    providerDocumentId: DOC_ID,
    providerDocumentReference: 'ref-1',
    providerDocumentRevision: 1,
    providerReportedCompletionAt: COMPLETION_REPORTED_AT,
    signers: [
      { role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1', providerCompletedAt: SIGNED_DATE_SELLER },
      { role: 'Spouse', displayName: 'John Seller', providerRecipientId: 'r2', providerCompletedAt: SIGNED_DATE_SPOUSE },
    ],
    artifactSha256: crypto.createHash('sha256').update(SYNTHETIC_PDF_BYTES).digest('hex'),
    executedTermsConflictCount: 0,
    iaosVerifiedAt: VERIFIED_AT,
    authority: 'system_derived',
    evidenceSummary: 'Fixture: exercises the carrier/readback machinery independent of the V1 executed-terms boundary.',
    relatedPriorRecordId: null,
  };
  return built;
}

{
  const record = fixtureEligibleRecord();
  const writeFailed = E.verifyReadbackMatchesWritten(record, null);
  checkFalse('a failed write (no readback at all) never counts as a transition', writeFailed.ok);
}
{
  const record = fixtureEligibleRecord();
  const mismatchedReadback = Object.assign({}, record, { artifactSha256: 'f'.repeat(64) });
  const readbackMismatch = E.verifyReadbackMatchesWritten(record, mismatchedReadback);
  checkFalse('a readback that does not exactly equal what was written never counts as a transition', readbackMismatch.ok);
}
{
  const record = fixtureEligibleRecord();
  const exactReadback = JSON.parse(JSON.stringify(record));
  const readbackOk = E.verifyReadbackMatchesWritten(record, exactReadback);
  checkTrue('an exactly-equal readback confirms the transition', readbackOk.ok);
}
{
  const record = fixtureEligibleRecord();
  const note = EC.formatUnderContractNote(record);
  const parsed = EC.parseUnderContractNote(note);
  checkTrue('the note round-trips to a non-null record', parsed !== null);
  check('round-trip is byte-for-byte field-equal to the original', JSON.stringify(parsed), JSON.stringify(record));
}
{
  const recordA = fixtureEligibleRecord();
  const recordB = Object.assign({}, recordA, { iaosVerifiedAt: '2026-09-12T14:00:00.000Z', evidenceSummary: 'Re-verified independently, same underlying evidence.' });
  checkTrue('two independently-timestamped verifications of the identical underlying evidence are recognized as duplicates', E.isDuplicateUnderContractRecord(recordA, recordB));
  const noteA = EC.formatUnderContractNote(recordA);
  const noteB = EC.formatUnderContractNote(recordB);
  const all = EC.allUnderContractRecordsForOpportunity([{ body: noteA }, { body: noteB }], OPP);
  check('both duplicate records remain in the append-only history -- neither is erased', all.length, 2);
}

/* ====================================================================== */
/* 12. Malformed carrier/readback fails closed                            */
/* ====================================================================== */

checkNull('parse: unrelated text is rejected', EC.parseUnderContractNote('not an under contract note'));
{
  const record = fixtureEligibleRecord();
  const note = EC.formatUnderContractNote(record);
  const lines = note.split('\n');
  const agreementIdx = lines.findIndex((l) => l.startsWith('Agreement Reached at: '));
  lines[agreementIdx] = 'Agreement Reached at: 2099-01-01T00:00:00.000Z';
  checkNull('parse: a mixed-version record is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const record = fixtureEligibleRecord();
  const note = EC.formatUnderContractNote(record);
  const lines = note.split('\n');
  const authorityIdx = lines.findIndex((l) => l.startsWith('Authority: '));
  lines[authorityIdx] = 'Authority: provider_reported';
  checkNull('parse: an authority-confused record is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const record = fixtureEligibleRecord();
  const note = EC.formatUnderContractNote(record);
  const lines = note.split('\n');
  const conflictsIdx = lines.findIndex((l) => l.startsWith('Executed terms conflicts: '));
  lines[conflictsIdx] = 'Executed terms conflicts: [{"field":"price","agreementValue":"1","candidateValue":"2"}]';
  checkNull('parse: a non-empty Executed terms conflicts array is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const record = fixtureEligibleRecord();
  const note = EC.formatUnderContractNote(record);
  const lines = note.split('\n');
  const signersIdx = lines.findIndex((l) => l.startsWith('Signers: '));
  lines[signersIdx] = 'Signers: []';
  checkNull('parse: an empty Signers array is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const record = fixtureEligibleRecord();
  const note = EC.formatUnderContractNote(record);
  const lines = note.split('\n');
  const signersIdx = lines.findIndex((l) => l.startsWith('Signers: '));
  const withoutRecipientId = JSON.stringify([{ role: 'Seller', displayName: 'Jane Seller', providerRecipientId: null, providerCompletedAt: null }]);
  lines[signersIdx] = 'Signers: ' + withoutRecipientId;
  checkNull('parse: a signer entry with a null/missing providerRecipientId is rejected -- it is now a required primary-join field', EC.parseUnderContractNote(lines.join('\n')));
}
{
  const record = fixtureEligibleRecord();
  const note = EC.formatUnderContractNote(record);
  const lines = note.split('\n');
  const completionIdx = lines.findIndex((l) => l.startsWith('Provider reported completion at: '));
  lines[completionIdx] = 'Provider reported completion at: UNAVAILABLE';
  checkNull('parse: a missing (required) provider-reported completion time is rejected', EC.parseUnderContractNote(lines.join('\n')));
}
checkNull('parse: correct header but wrong line count is rejected', EC.parseUnderContractNote('IAOS UNDER CONTRACT — iaos-under-contract-v1\nRecorded at: 2026-01-01T00:00:00.000Z'));
checkNull('parse: empty string is rejected', EC.parseUnderContractNote(''));

/* ====================================================================== */
/* 13. No stage/workflow/send/Production mutation exists anywhere in the  */
/*     new or modified source (static scan)                               */
/* ====================================================================== */

{
  const modelSource = fs.readFileSync(path.join(LIB, 'contract-execution-model.ts'), 'utf8');
  const carrierSource = fs.readFileSync(path.join(LIB, 'contract-execution-carriers.ts'), 'utf8');
  const combined = modelSource + '\n' + carrierSource;
  const forbidden = ['Seller Closed-Won', 'pipelineId', 'pipeline_stage', 'pipelineStageId', '/opportunities/', 'templates/send'];
  const found = forbidden.filter((token) => combined.includes(token));
  check('no pipeline stage, Seller Closed-Won, direct /opportunities/ write path, or send-capable endpoint reference exists in the new/modified INV-65 source', found, []);
}

/* ====================================================================== */
/* Summary                                                                 */
/* ====================================================================== */

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
console.log('No contract send, provider mutation, network call, or GHL/Production write occurred in this run -- every fixture above is an in-memory object, and all artifact bytes are synthetic, non-sensitive fixture text carrying only the real PDF magic-byte signature.');
cleanup();
process.exit(failures === 0 ? 0 : 1);
