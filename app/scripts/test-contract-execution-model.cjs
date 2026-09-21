/**
 * Board #9 verified full execution -- deterministic model + carrier test
 * runner. B9-10 / INV-65. Product Owner ruling, 2026-09-13: Brad's own
 * factual recipient-mapping attestation (WHO must sign, assembled from
 * IAOS's own authoritative contract facts, never send evidence; Brad's
 * manual, one-to-one provider-recipient mapping, currency-verified);
 * signer completion now also requires a valid signed timestamp; Under
 * Contract persistence (write + fresh readback + exact equality +
 * duplicate refusal) is proven at the model layer via
 * `verifyReadbackMatchesWritten`/`isDuplicateUnderContractRecord`, with
 * the live write/readback orchestration itself covered by
 * `test-contract-workspace-wiring.cjs`.
 *
 * Compiles contract-execution-model.ts, contract-execution-carriers.ts,
 * contract-send-carriers.ts, contract-signer-mapping-model.ts,
 * contract-signer-mapping-carriers.ts, and their dependency chain to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases mapped directly to this round's own "Proof
 * required" list. Every provider response, send record, contract-facts
 * report, and PDF selection used here is a SIMULATED fixture object --
 * no network call, no live GHL call, no `ghl.notes.create()`. Artifact
 * bytes are synthetic, non-sensitive ASCII text prefixed with the real
 * PDF magic-byte signature, never a real PDF. Hashing uses Node's
 * `crypto` directly IN THIS TEST FILE ONLY, simulating what the
 * browser's Web Crypto call would produce -- never imported into
 * contract-execution-model.ts itself (see that module's own header and
 * `test-browser-artifact-hash.cjs`, which proves the real browser-path
 * hash function independently).
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
  path.join(LIB, 'contract-executed-terms-attestation-model.ts'),
  path.join(LIB, 'contract-executed-terms-attestation-carriers.ts'),
  path.join(LIB, 'contract-signer-mapping-model.ts'),
  path.join(LIB, 'contract-signer-mapping-carriers.ts'),
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
const SC = require(path.join(LIB_OUT, 'contract-send-carriers.js'));
const AT = require(path.join(LIB_OUT, 'contract-executed-terms-attestation-model.js'));
const ATC = require(path.join(LIB_OUT, 'contract-executed-terms-attestation-carriers.js'));
const SM = require(path.join(LIB_OUT, 'contract-signer-mapping-model.js'));
const SMC = require(path.join(LIB_OUT, 'contract-signer-mapping-carriers.js'));

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

// DEFAULT: exactly ONE recorded signer -- the only case
// deriveDeterministicSignerMappingsFromAcceptedSend can ever succeed for.
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
    signers: [{ role: 'Seller', displayName: 'Jane Seller' }],
    confirmedRecipientId: 'r1',
    expirationAt: '2026-09-20T00:00:00.000Z',
    requestAt: REQUEST_AT,
    iaosObservedAcceptanceAt: REQUEST_AT,
    providerResponse: {
      documentId: DOC_ID,
      documentReference: 'ref-1',
      documentRevision: 1,
      recipientId: 'r1',
      createdBy: 'sender-1',
      readbackStatus: 'sent',
      readbackLocationId: LOCATION_ID,
      fillableFieldCount: 3,
    },
    failureReason: null,
  }, over || {});
}

function providerRecipientSingleComplete(over) {
  return [Object.assign({ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'Jane Seller' }, over || {})];
}

// A standalone, two-recipient fixture used ONLY for direct
// verifyRequiredSigners tests (the matching logic itself is unaffected by
// where the mapping came from) -- NOT used with buildVerifiedUnderContractRecord,
// since the mapping-derivation stage refuses more than one recorded signer.
const EXPECTED_SIGNER_MAPPINGS_TWO = [
  { role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1' },
  { role: 'Spouse', displayName: 'John Seller', providerRecipientId: 'r2' },
];
function providerRecipientsTwoComplete(over) {
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
        recipients: [{ id: 'r1', hasCompleted: true }],
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

// A REAL, structurally valid, minimal one-page PDF (no xref table --
// pdf-lib's own repair scanner recovers it, verified directly against the
// real library before this fixture was written) carrying the synthetic
// marker as a PDF comment line -- a real PDF file signature AND a real,
// pdf-lib-parseable page, but never a real PDF's actual content.
const SYNTHETIC_MARKER = 'IAOS-SYNTHETIC-FIXTURE-MARKER-7f3a9c';
const SYNTHETIC_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n' +
  '% ' + SYNTHETIC_MARKER + ' -- not a real PDF, not real content.\n' +
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
  'trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF',
  'ascii',
);
// A second, TWO-page real PDF, same construction, for page-count-specific assertions.
const SYNTHETIC_TWO_PAGE_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n' +
  '% ' + SYNTHETIC_MARKER + ' (two-page fixture) -- not a real PDF, not real content.\n' +
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n' +
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
  '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
  'trailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF',
  'ascii',
);
const NON_PDF_BYTES = Buffer.from('this is plainly not a pdf file at all', 'utf8');

/** Simulates the exact two-step flow the browser will perform: classify bytes, then hash (here via Node crypto, standing in for Web Crypto -- see test-browser-artifact-hash.cjs for the real browser-path proof), then read the real page count via the SAME `countPdfPages` (pdf-lib) the browser path uses. Async -- `countPdfPages` genuinely parses the PDF. */
async function selectAndHash(bytes, fileName, mimeType) {
  const bytesOutcome = E.classifySelectedFileBytes({ fileName: fileName ?? 'executed.pdf', mimeType: mimeType ?? 'application/pdf', bytes });
  if (bytesOutcome.kind !== 'valid_bytes') return bytesOutcome;
  const sha256 = crypto.createHash('sha256').update(Buffer.from(bytesOutcome.bytes)).digest('hex');
  const pageCount = await E.countPdfPages(bytesOutcome.bytes);
  return { kind: 'selected', sha256, fileName: bytesOutcome.fileName, mimeType: bytesOutcome.mimeType, pageCount };
}

// Precomputed ONCE, asynchronously, at the top of the async main() below --
// `validManualOutcome()` itself stays a plain synchronous function (it is
// called from dozens of synchronous fixture-builder call sites throughout
// this file) and simply returns the cached result.
let CACHED_VALID_MANUAL_OUTCOME = null;
function validManualOutcome() {
  if (CACHED_VALID_MANUAL_OUTCOME === null) throw new Error('validManualOutcome() called before the async bootstrap populated its cache.');
  return CACHED_VALID_MANUAL_OUTCOME;
}

// WHO must sign -- ASSEMBLED, never derived from acceptedSend.signers.
// Single-signer by default, matching providerRecipientSingleComplete()'s
// one row `r1`.
function requiredSignerFixtureSingle() {
  return [{ role: 'Seller', displayName: 'Jane Seller' }];
}
function requiredSignerFixtureTwo() {
  return [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Spouse', displayName: 'John Seller' }];
}

// B9-13/INV-96 correction: `buyerSignerRole`/`authorizedBuyerName` are
// EXPLICIT fixture constants, named directly -- never read via array
// position (`requiredSignerFixtureSingle()[0]`) -- proving the pipeline
// itself takes these as independent caller-supplied facts, exactly as
// `buildRequiredSignerSet`'s own `buyerRole`/`buyerDisplayName` would
// supply them in production, regardless of where the buyer happens to
// fall in the `requiredSigners` array.
const BUYER_ROLE_FIXTURE = 'Seller';
const BUYER_NAME_FIXTURE = 'Jane Seller';

/** Brad's own manual, one-to-one recipient-mapping attestation -- built via the REAL builder, never hand-constructed. Defaults to the single-signer/single-recipient (r1) case. */
function signerMappingAttestationFixture(over) {
  const requiredSigners = (over && over.requiredSigners) || requiredSignerFixtureSingle();
  const availableProviderRecipientIds = (over && over.availableProviderRecipientIds) || requiredSigners.map((_, i) => (i === 0 ? 'r1' : 'r2'));
  const assignments = (over && over.assignments) || requiredSigners.map((s, i) => ({ role: s.role, providerRecipientId: availableProviderRecipientIds[i] }));
  const args = Object.assign({
    opportunityId: OPP,
    version: V1,
    agreementAt: AGREEMENT_AT,
    providerDocumentId: DOC_ID,
    providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT,
    attestedAt: VERIFIED_AT,
    requiredSigners,
    availableProviderRecipientIds,
    assignments,
    evidenceSummary: "Brad's own visually-verified mapping -- fixture.",
  }, (over && over.args) || {});
  const built = SM.buildSignerMappingAttestationRecordArgs(args);
  if (!built.ok) throw new Error('fixture signerMappingAttestationFixture failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

function baseArgs(over) {
  return Object.assign({
    opportunityId: OPP,
    agreementAt: AGREEMENT_AT,
    version: V1,
    acceptedSend: acceptedSendFixture({}),
    requiredSigners: requiredSignerFixtureSingle(),
    buyerSignerRole: BUYER_ROLE_FIXTURE,
    authorizedBuyerName: BUYER_NAME_FIXTURE,
    authorizedBuyerEmail: null,
    signerMappingAttestation: signerMappingAttestationFixture({}),
    providerRecipients: providerRecipientSingleComplete(),
    lifecycleHistory: [completedLifecycleObservation({})],
    manualArtifactOutcome: validManualOutcome(),
    selectedForDocumentId: DOC_ID,
    selectedForVersion: V1,
    // Fails closed by default -- no attestation has been recorded. See
    // section 16 below for the fixtures that build a real, valid,
    // unanimous attestation and prove the pipeline reaches ok:true.
    executedTermsAttestation: null,
    iaosVerifiedAt: VERIFIED_AT,
    evidenceSummary: 'Full joint verification: accepted send, signer-level completion via provider recipient id, provider completed status, PDF manually selected and hashed.',
    relatedPriorRecordId: null,
  }, over || {});
}

/** A REAL, valid, unanimous-MATCHES attestation for the fixture evidence above -- built via the actual builder, never hand-constructed. */
function validAttestationFixture(over) {
  const checklistItems = AT.buildExecutedTermsChecklist({
    agreement: { price: 190000, propertyAddress: '123 Main St', parties: [] },
    buyerIdentity: 'BTC LLC',
    expectedSigners: requiredSignerFixtureSingle(),
  });
  const responses = checklistItems.map((item) => ({ kind: item.kind, signerRole: item.signerRole, result: 'MATCHES' }));
  const built = AT.buildExecutedTermsAttestationRecordArgs(Object.assign({
    opportunityId: OPP,
    version: V1,
    agreementAt: AGREEMENT_AT,
    providerDocumentId: DOC_ID,
    providerDocumentRevision: 1,
    selectedArtifactSha256: crypto.createHash('sha256').update(SYNTHETIC_PDF_BYTES).digest('hex'),
    attestedAt: VERIFIED_AT,
    requiredItems: checklistItems,
    responses,
    evidenceSummary: "Brad's own factual visual comparison -- fixture.",
  }, over || {}));
  if (!built.ok) throw new Error('fixture validAttestationFixture failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

// B9-13/INV-96: countPdfPages is genuinely async (pdf-lib parses the real
// PDF bytes) -- the whole remainder of this file runs inside one async
// main(), starting with the one bootstrap await that populates
// CACHED_VALID_MANUAL_OUTCOME before any synchronous fixture builder
// (baseArgs, etc.) reads it.
(async () => {

CACHED_VALID_MANUAL_OUTCOME = await selectAndHash(SYNTHETIC_PDF_BYTES, 'executed.pdf', 'application/pdf');

/* ====================================================================== */
/* 1. Material-term boundary -- Under Contract remains BLOCKED without a  */
/*    current, unanimous Brad attestation, even with every other piece    */
/*    of evidence fully valid; a VALID attestation genuinely unlocks it   */
/*    (Product Owner ruling, 2026-09-13)                                  */
/* ====================================================================== */

{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  checkFalse('without any recorded attestation, Under Contract remains blocked even with fully valid signer/completion/artifact evidence', result.ok);
  check('failure stage is executed_terms', result.failure.stage, 'executed_terms');
  checkTrue('failure names ATTESTATION_MISSING', result.failure.reasons.some((r) => r.code === 'ATTESTATION_MISSING'));
}
{
  checkFalse('BuildVerifiedExecutionArgs has no executedTermsSnapshot field at all', 'executedTermsSnapshot' in baseArgs({}));
  checkFalse('BuildVerifiedExecutionArgs has no agreementTermsSnapshot field at all', 'agreementTermsSnapshot' in baseArgs({}));
  checkFalse('BuildVerifiedExecutionArgs has no naked executedTermsMatchAgreement boolean field', 'executedTermsMatchAgreement' in baseArgs({}));
}
{
  const smuggled = E.buildVerifiedUnderContractRecord(Object.assign(baseArgs({}), { executedTermsMatchAgreement: true, executedTermsSnapshot: { price: 1, propertyAddress: 'x', parties: [] }, termsMatch: true }));
  checkFalse('smuggled/extra material-term-claiming fields cannot unlock eligibility -- still blocked', smuggled.ok);
  check('still fails at executed_terms regardless of smuggled fields', smuggled.failure.stage, 'executed_terms');
}
{
  const agreement = { price: 190000, propertyAddress: '123 Main St', parties: ['Jane Seller'] };
  const matching = { price: 190000, propertyAddress: '123 Main St', parties: ['Jane Seller'] };
  const conflicting = { price: 210000, propertyAddress: '123 Main St', parties: ['Jane Seller'] };
  check('evaluateExecutedTermsConflicts finds zero conflicts for identical terms (preserved logic works correctly)', E.evaluateExecutedTermsConflicts(agreement, matching).length, 0);
  checkTrue('evaluateExecutedTermsConflicts finds a real conflict for a price mismatch (preserved logic works correctly)', E.evaluateExecutedTermsConflicts(agreement, conflicting).some((c) => c.field === 'price'));
}
{
  // THE REACHABILITY PROOF -- a real, valid, unanimous, currency-matching
  // attestation genuinely unlocks ok:true end to end. This is the one
  // fixture-only case where the full pipeline succeeds.
  const attestation = validAttestationFixture({});
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: attestation }));
  checkTrue('a valid, current, unanimous attestation genuinely unlocks Under Contract end to end', result.ok);
  if (result.ok) {
    check('the resulting record carries executedTermsConflictCount 0', result.value.executedTermsConflictCount, 0);
    check('the resulting record carries the real artifact sha256', result.value.artifactSha256, attestation.selectedArtifactSha256);
  }
}
{
  const staleDocId = validAttestationFixture({ providerDocumentId: 'doc-STALE-different' });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: staleDocId }));
  checkFalse('an attestation bound to a DIFFERENT provider document id fails closed', result.ok);
  check('failure stage is executed_terms', result.failure.stage, 'executed_terms');
  checkTrue('failure names ATTESTATION_DOCUMENT_MISMATCH', result.failure.reasons.some((r) => r.code === 'ATTESTATION_DOCUMENT_MISMATCH'));
}
{
  const staleRevision = validAttestationFixture({ providerDocumentRevision: 99 });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: staleRevision }));
  checkFalse('an attestation bound to a DIFFERENT provider document revision fails closed (the document changed since Brad attested)', result.ok);
  checkTrue('failure names ATTESTATION_REVISION_MISMATCH', result.failure.reasons.some((r) => r.code === 'ATTESTATION_REVISION_MISMATCH'));
}
{
  const staleHash = validAttestationFixture({ selectedArtifactSha256: 'f'.repeat(64) });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: staleHash }));
  checkFalse('an attestation bound to a DIFFERENT artifact hash fails closed (a different PDF was selected since Brad attested)', result.ok);
  checkTrue('failure names ATTESTATION_ARTIFACT_HASH_MISMATCH', result.failure.reasons.some((r) => r.code === 'ATTESTATION_ARTIFACT_HASH_MISMATCH'));
}
{
  const crossVersion = validAttestationFixture({ version: V2, agreementAt: V2.agreementAt });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: crossVersion }));
  checkFalse('an attestation bound to a DIFFERENT contract version fails closed -- never reused across a correction', result.ok);
  checkTrue('failure names ATTESTATION_VERSION_MISMATCH', result.failure.reasons.some((r) => r.code === 'ATTESTATION_VERSION_MISMATCH'));
}
{
  const wrongOpp = validAttestationFixture({ opportunityId: 'opp-DIFFERENT' });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: wrongOpp }));
  checkFalse('an attestation bound to a DIFFERENT opportunity fails closed', result.ok);
  checkTrue('failure names ATTESTATION_OPPORTUNITY_MISMATCH', result.failure.reasons.some((r) => r.code === 'ATTESTATION_OPPORTUNITY_MISMATCH'));
}
{
  const tamperedAuthority = Object.assign({}, validAttestationFixture({}), { operator: 'not-brad' });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: tamperedAuthority }));
  checkFalse('an attestation not attributed to Brad (tampered in memory, bypassing the builder) fails closed', result.ok);
  checkTrue('failure names ATTESTATION_NOT_BRAD', result.failure.reasons.some((r) => r.code === 'ATTESTATION_NOT_BRAD'));
}
{
  const tamperedUnanimous = Object.assign({}, validAttestationFixture({}), {
    items: validAttestationFixture({}).items.map((i, idx) => (idx === 0 ? Object.assign({}, i, { result: 'DOES_NOT_MATCH' }) : i)),
  });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ executedTermsAttestation: tamperedUnanimous }));
  checkFalse('an attestation tampered in memory to carry a non-MATCHES item (bypassing the builder) fails closed -- defense in depth', result.ok);
  checkTrue('failure names ATTESTATION_NOT_UNANIMOUS_MATCHES', result.failure.reasons.some((r) => r.code === 'ATTESTATION_NOT_UNANIMOUS_MATCHES'));
}

/* ====================================================================== */
/* 2. SHA-256 is computed via a browser-compatible path (simulated here   */
/*    via Node crypto; the real Web Crypto path is proven independently   */
/*    in test-browser-artifact-hash.cjs)                                  */
/* ====================================================================== */

{
  const independentHash = crypto.createHash('sha256').update(SYNTHETIC_PDF_BYTES).digest('hex');
  const outcome = validManualOutcome();
  check('the fixture selection outcome carries a hash matching an independently computed SHA-256 of the exact same bytes', outcome.sha256, independentHash);
}
{
  const result = E.verifyManualArtifactSelection({
    outcome: validManualOutcome(), confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1,
  });
  checkTrue('a valid manual selection produces a real 64-hex-char SHA-256, passed through unchanged', result.ok && /^[0-9a-f]{64}$/.test(result.sha256));
}
{
  const otherOutcome = await selectAndHash(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('entirely different synthetic content')]));
  checkTrue('different selected bytes produce a different hash', validManualOutcome().sha256 !== otherOutcome.sha256);
}
{
  checkFalse('contract-execution-model.ts exports no computeSha256Hex (hashing lives outside this module entirely)', typeof E.computeSha256Hex === 'function');
}

/* ====================================================================== */
/* 3. PDF bytes are never persisted or logged; this module never touches  */
/*    raw bytes at all past classification                                */
/* ====================================================================== */

{
  const result = E.verifyManualArtifactSelection({
    outcome: validManualOutcome(), confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1,
  });
  const serialized = JSON.stringify(result);
  checkFalse('the synthetic marker embedded in the original bytes never appears in verifyManualArtifactSelection\'s own return value (it was never given the bytes)', serialized.includes(SYNTHETIC_MARKER));
  checkFalse('verifyManualArtifactSelection\'s successful result carries no "bytes" field at all', result.ok && 'bytes' in result);
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  const serialized = JSON.stringify(result);
  checkFalse('buildVerifiedUnderContractRecord\'s own output never contains the synthetic marker embedded in the selected PDF bytes', serialized.includes(SYNTHETIC_MARKER));
}
{
  const bytesOutcome = E.classifySelectedFileBytes({ fileName: 'executed.pdf', mimeType: 'application/pdf', bytes: SYNTHETIC_PDF_BYTES });
  checkTrue('classifySelectedFileBytes DOES carry the validated bytes forward (this is the one, deliberate hand-off point before hashing)', bytesOutcome.kind === 'valid_bytes' && 'bytes' in bytesOutcome);
  checkTrue('classifySelectedFileBytes result compares equal, byte-for-byte, to the original input', Buffer.from(bytesOutcome.bytes).equals(SYNTHETIC_PDF_BYTES));
}
{
  const source = fs.readFileSync(path.join(LIB, 'contract-execution-model.ts'), 'utf8');
  checkFalse('contract-execution-model.ts never imports Node\'s crypto module', /from\s+["']crypto["']/.test(source) || /require\(\s*["']crypto["']\s*\)/.test(source));
  checkFalse('contract-execution-model.ts never calls fetch(...) anywhere -- no automated GHL download exists, by construction, not merely by policy', /\bfetch\s*\(/.test(source));
  checkFalse('contract-execution-model.ts never calls console.log/console.error on raw bytes (no logging of artifact content)', /console\.(log|error|warn|info)\(/.test(source));
}
{
  const source = fs.readFileSync(path.join(LIB, 'browser-artifact-hash.ts'), 'utf8');
  checkFalse('browser-artifact-hash.ts never imports Node\'s crypto module', /from\s+["']crypto["']/.test(source) || /require\(\s*["']crypto["']\s*\)/.test(source));
  checkTrue('browser-artifact-hash.ts uses globalThis.crypto.subtle.digest, the standard Web Crypto API', /globalThis\.crypto\.subtle\.digest/.test(source));
}

/* ====================================================================== */
/* 4. Absent/invalid/unreadable/empty/malformed input fails closed        */
/* ====================================================================== */

{
  const r = E.verifyManualArtifactSelection({ outcome: { kind: 'no_file' }, confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1 });
  checkFalse('no file selected fails closed', r.ok);
  check('failure names NO_FILE_SELECTED', r.reasons[0].code, 'NO_FILE_SELECTED');
}
{
  const r = E.classifySelectedFileBytes({ fileName: 'not-a-pdf.txt', mimeType: 'text/plain', bytes: NON_PDF_BYTES });
  check('a non-PDF file (wrong magic bytes) is classified as invalid_file_type from its REAL content, not a spoofable label', r.kind, 'invalid_file_type');
  const r2 = E.verifyManualArtifactSelection({ outcome: r, confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1 });
  checkFalse('a non-PDF file selection fails closed', r2.ok);
  check('failure names INVALID_FILE_TYPE', r2.reasons[0].code, 'INVALID_FILE_TYPE');
}
{
  const spoofed = E.classifySelectedFileBytes({ fileName: 'executed.pdf', mimeType: 'application/pdf', bytes: NON_PDF_BYTES });
  check('a spoofed mime-type/filename cannot substitute for the real PDF content signature', spoofed.kind, 'invalid_file_type');
}
{
  const r = E.classifySelectedFileBytes({ fileName: 'empty.pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(0) });
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
  const r = E.classifySelectedFileBytes({ fileName: null, mimeType: null, bytes: null });
  check('classifySelectedFileBytes with no bytes at all reports no_file', r.kind, 'no_file');
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ manualArtifactOutcome: { kind: 'no_file' } }));
  checkFalse('the full pipeline fails closed at the artifact stage when no file was selected', result.ok);
  check('failure stage is artifact', result.failure.stage, 'artifact');
}

/* ====================================================================== */
/* 5. Required signer set -- buyer + every seller signer, NEVER derived   */
/*    solely from acceptedSend.signers (Product Owner ruling, 2026-09-13) */
/* ====================================================================== */

{
  checkFalse('BuildVerifiedExecutionArgs has no expectedSignerMappings field at all', 'expectedSignerMappings' in baseArgs({}));
  checkTrue('BuildVerifiedExecutionArgs has its own requiredSigners field, independent of acceptedSend', 'requiredSigners' in baseArgs({}));
  checkTrue('BuildVerifiedExecutionArgs has its own signerMappingAttestation field, independent of acceptedSend', 'signerMappingAttestation' in baseArgs({}));
}
{
  // A send recording a DIFFERENT signer set than requiredSigners has ZERO effect on the required set -- proving it is never derived from send evidence.
  const sendWithDifferentSigners = acceptedSendFixture({ signers: [{ role: 'Totally Different Role', displayName: 'Nobody Real' }] });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ acceptedSend: sendWithDifferentSigners }));
  checkFalse('even with mismatched send-time signers[], the pipeline still reaches (and is blocked only by) executed_terms -- required_signers/signer_mapping/signers all passed using the ASSEMBLED set, never the send\'s own signers[]', result.ok);
  check('failure stage is executed_terms (proving required_signers and signer_mapping never consulted acceptedSend.signers at all)', result.failure.stage, 'executed_terms');
}
{
  checkFalse('zero required signers fails closed', E.buildVerifiedUnderContractRecord(baseArgs({ requiredSigners: [] })).ok);
  check('failure stage is required_signers for zero signers', E.buildVerifiedUnderContractRecord(baseArgs({ requiredSigners: [] })).failure.stage, 'required_signers');
}
{
  // ONE seller signer (plus the buyer signer implicit in every RequiredSigner[] this fixture set represents) succeeds through required_signers.
  const result = E.buildVerifiedUnderContractRecord(baseArgs({}));
  checkTrue('one seller signer required_signers/signer_mapping/signers stages all pass (blocked only by executed_terms)', !result.ok && result.failure.stage === 'executed_terms');
}
{
  // MULTIPLE seller signers -- a real, currently-supported case (unlike the prior round's single-signer-only limitation).
  const twoSigners = requiredSignerFixtureTwo();
  const twoMapping = signerMappingAttestationFixture({ requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'] });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({
    requiredSigners: twoSigners,
    signerMappingAttestation: twoMapping,
    providerRecipients: providerRecipientsTwoComplete(),
  }));
  checkFalse('multiple seller signers, fully mapped and completed, still reach (and are blocked only by) executed_terms -- multi-signer IS now supported end to end', result.ok);
  check('failure stage is executed_terms for the multi-signer case', result.failure.stage, 'executed_terms');
}

/* ====================================================================== */
/* 3b. Buyer signer identity -- BLOCKING, case-insensitive, NEVER by      */
/*     array position. B9-13 / INV-96 correction.                         */
/* ====================================================================== */
{
  // The buyer is the SECOND element of requiredSigners here (never first)
  // -- proves buildVerifiedUnderContractRecord resolves the buyer ONLY
  // from the explicit buyerSignerRole/authorizedBuyerName args, never
  // from requiredSigners[0].
  const twoSigners = [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Buyer Rep', displayName: 'Robert Thompson' }];
  const twoMapping = signerMappingAttestationFixture({ requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'] });
  const twoRecipients = providerRecipientsTwoComplete({ 1: { reportedContactName: 'Robert Thompson' } });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({
    requiredSigners: twoSigners,
    buyerSignerRole: 'Buyer Rep',
    authorizedBuyerName: 'Robert Thompson',
    signerMappingAttestation: twoMapping,
    providerRecipients: twoRecipients,
  }));
  checkFalse('buyer as the SECOND required signer still passes buyer_signer_identity (reaches, and is blocked only by, executed_terms)', result.ok);
  check('failure stage is executed_terms, never buyer_signer_identity, when the buyer is not first in requiredSigners', result.failure.stage, 'executed_terms');
}
{
  // Case-INSENSITIVE match: GHL-reported name differs only in case.
  const twoSigners = [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Buyer Rep', displayName: 'Robert Thompson' }];
  const twoMapping = signerMappingAttestationFixture({ requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'] });
  const twoRecipients = providerRecipientsTwoComplete({ 1: { reportedContactName: 'ROBERT thompson' } });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({
    requiredSigners: twoSigners,
    buyerSignerRole: 'Buyer Rep',
    authorizedBuyerName: 'Robert Thompson',
    signerMappingAttestation: twoMapping,
    providerRecipients: twoRecipients,
  }));
  checkFalse('a case-different but otherwise identical buyer name still passes (reaches executed_terms)', result.ok);
  check('failure stage is executed_terms, proving buyer_signer_identity passed case-insensitively', result.failure.stage, 'executed_terms');
}
{
  // A genuine mismatch BLOCKS at buyer_signer_identity, before signers/provider_completion/artifact/executed_terms are ever reached.
  const twoSigners = [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Buyer Rep', displayName: 'Robert Thompson' }];
  const twoMapping = signerMappingAttestationFixture({ requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'] });
  const twoRecipients = providerRecipientsTwoComplete({ 1: { reportedContactName: 'Someone Else Entirely' } });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({
    requiredSigners: twoSigners,
    buyerSignerRole: 'Buyer Rep',
    authorizedBuyerName: 'Robert Thompson',
    signerMappingAttestation: twoMapping,
    providerRecipients: twoRecipients,
  }));
  checkFalse('a genuine buyer name mismatch blocks Under Contract', result.ok);
  check('failure stage is buyer_signer_identity', result.failure.stage, 'buyer_signer_identity');
  check('failure names BUYER_IDENTITY_MISMATCH', result.failure.reasons[0].code, 'BUYER_IDENTITY_MISMATCH');
}
{
  // Direct unit tests of verifyBuyerSignerIdentity itself.
  const mappings = [{ role: 'Buyer Rep', displayName: 'Robert Thompson', providerRecipientId: 'r1' }];
  const recipients = [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'Robert Thompson', reportedEmail: 'robert@example.com' }];
  checkTrue('verifyBuyerSignerIdentity: exact name match passes', E.verifyBuyerSignerIdentity({ buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: 'robert@example.com', mappings, providerRecipients: recipients }).ok);
  checkTrue('verifyBuyerSignerIdentity: case-insensitive, whitespace-trimmed name match passes', E.verifyBuyerSignerIdentity({ buyerSignerRole: 'Buyer Rep', authorizedBuyerName: '  ROBERT THOMPSON  ', authorizedBuyerEmail: null, mappings, providerRecipients: recipients }).ok);
  // Gate-review closure -- Finding H, requirement 3: prove the exact case
  // GHL's own live readback returns (all-lowercase) matches the
  // configured capitalization, and that internal whitespace is collapsed
  // (not merely trimmed at the edges), while a genuinely different name
  // still refuses -- never fuzzy, substring, or reordered matching.
  checkTrue(
    'verifyBuyerSignerIdentity: GHL\'s lowercase "robert thompson" matches the configured "Robert Thompson"',
    E.verifyBuyerSignerIdentity({
      buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null,
      mappings, providerRecipients: [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'robert thompson', reportedEmail: null }],
    }).ok,
  );
  checkTrue(
    'verifyBuyerSignerIdentity: repeated internal whitespace is collapsed, not just trimmed at the edges',
    E.verifyBuyerSignerIdentity({
      buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert   Thompson', authorizedBuyerEmail: null,
      mappings, providerRecipients: [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'Robert Thompson', reportedEmail: null }],
    }).ok,
  );
  const genuinelyDifferentName = E.verifyBuyerSignerIdentity({
    buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null,
    mappings, providerRecipients: [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'Robert Thompsonx', reportedEmail: null }],
  });
  checkFalse('verifyBuyerSignerIdentity: a genuinely different name (not merely whitespace/case) still fails closed -- no fuzzy matching', genuinelyDifferentName.ok);
  check('failure names BUYER_IDENTITY_MISMATCH for the genuinely-different-name case', genuinelyDifferentName.reasons[0].code, 'BUYER_IDENTITY_MISMATCH');
  checkFalse(
    'verifyBuyerSignerIdentity: reordered names ("Thompson Robert") never match -- no token-reordering tolerance',
    E.verifyBuyerSignerIdentity({
      buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null,
      mappings, providerRecipients: [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'Thompson Robert', reportedEmail: null }],
    }).ok,
  );
  checkFalse(
    'verifyBuyerSignerIdentity: a substring of the authorized name never matches -- no substring tolerance',
    E.verifyBuyerSignerIdentity({
      buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null,
      mappings, providerRecipients: [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'Robert', reportedEmail: null }],
    }).ok,
  );
  const blankRole = E.verifyBuyerSignerIdentity({ buyerSignerRole: '', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null, mappings, providerRecipients: recipients });
  checkFalse('verifyBuyerSignerIdentity: blank buyerSignerRole fails closed', blankRole.ok);
  check('failure names BUYER_SIGNER_ROLE_BLANK', blankRole.reasons[0].code, 'BUYER_SIGNER_ROLE_BLANK');
  const blankIdentity = E.verifyBuyerSignerIdentity({ buyerSignerRole: 'Buyer Rep', authorizedBuyerName: '', authorizedBuyerEmail: null, mappings, providerRecipients: recipients });
  checkFalse('verifyBuyerSignerIdentity: blank authorizedBuyerName AND null authorizedBuyerEmail fails closed', blankIdentity.ok);
  check('failure names BUYER_AUTHORIZED_IDENTITY_MISSING', blankIdentity.reasons[0].code, 'BUYER_AUTHORIZED_IDENTITY_MISSING');
  const noMapping = E.verifyBuyerSignerIdentity({ buyerSignerRole: 'Nonexistent Role', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null, mappings, providerRecipients: recipients });
  checkFalse('verifyBuyerSignerIdentity: no mapping for the buyer role fails closed', noMapping.ok);
  check('failure names BUYER_MAPPING_NOT_FOUND', noMapping.reasons[0].code, 'BUYER_MAPPING_NOT_FOUND');
  const noRecipient = E.verifyBuyerSignerIdentity({ buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null, mappings, providerRecipients: [] });
  checkFalse('verifyBuyerSignerIdentity: mapped recipient absent from readback fails closed', noRecipient.ok);
  check('failure names BUYER_RECIPIENT_NOT_FOUND', noRecipient.reasons[0].code, 'BUYER_RECIPIENT_NOT_FOUND');
  checkTrue(
    'verifyBuyerSignerIdentity: the mapping record\'s own displayName is IGNORED -- only the explicit authorizedBuyerName/authorizedBuyerEmail arguments govern',
    E.verifyBuyerSignerIdentity({
      buyerSignerRole: 'Buyer Rep',
      authorizedBuyerName: 'Robert Thompson',
      authorizedBuyerEmail: null,
      mappings: [{ role: 'Buyer Rep', displayName: 'A Completely Different Stale Name', providerRecipientId: 'r1' }],
      providerRecipients: recipients,
    }).ok,
  );

  // ---- B9-13/INV-96 correction round 2: email-only GHL identity fallback ----
  // Live evidence shape: GHL reports the recipient with NO name at all
  // (blank firstName/lastName), contactName falling back to the bare
  // email -- proving a real completed document this pipeline must still
  // be able to verify.
  const emailOnlyRecipient = [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'brad@veteraninvestoros.com', reportedEmail: 'brad@veteraninvestoros.com' }];
  const emailOnlyPass = E.verifyBuyerSignerIdentity({
    buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: 'brad@veteraninvestoros.com',
    mappings, providerRecipients: emailOnlyRecipient,
  });
  checkTrue('email-only GHL identity: canonical email match passes even though the canonical NAME does not match the (email-fallback) reported name', emailOnlyPass.ok);
  checkTrue(
    'email-only GHL identity: case-insensitive, whitespace-trimmed email match passes',
    E.verifyBuyerSignerIdentity({
      buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: '  BRAD@VeteranInvestorOS.com  ',
      mappings, providerRecipients: emailOnlyRecipient,
    }).ok,
  );
  const differentEmail = E.verifyBuyerSignerIdentity({
    buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: 'someone-else@example.com',
    mappings, providerRecipients: emailOnlyRecipient,
  });
  checkFalse('a different canonical email (and non-matching name) fails closed', differentEmail.ok);
  check('failure names BUYER_IDENTITY_MISMATCH for the different-email case', differentEmail.reasons[0].code, 'BUYER_IDENTITY_MISMATCH');
  checkTrue(
    'name match still passes on its own when authorizedBuyerEmail is null -- existing name-match behavior preserved',
    E.verifyBuyerSignerIdentity({ buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: null, mappings, providerRecipients: recipients }).ok,
  );
  checkTrue(
    'a real NAME mismatch still passes when the EMAIL matches -- the OR, not requiring both',
    E.verifyBuyerSignerIdentity({
      buyerSignerRole: 'Buyer Rep', authorizedBuyerName: 'Robert Thompson', authorizedBuyerEmail: 'brad@veteraninvestoros.com',
      mappings, providerRecipients: [{ providerRecipientId: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, reportedRole: 'signer', reportedContactName: 'a totally different displayed name', reportedEmail: 'brad@veteraninvestoros.com' }],
    }).ok,
  );
  // Full end-to-end: the email-only live-evidence shape reaches (and is blocked only by) executed_terms, exactly like the name-match path.
  const emailFallbackMapping = signerMappingAttestationFixture({ requiredSigners: [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Buyer Rep', displayName: 'Robert Thompson' }], availableProviderRecipientIds: ['r1', 'r2'] });
  const emailFallbackRecipients = providerRecipientsTwoComplete({ 1: { reportedContactName: 'brad@veteraninvestoros.com', reportedEmail: 'brad@veteraninvestoros.com' } });
  const emailFallbackResult = E.buildVerifiedUnderContractRecord(baseArgs({
    requiredSigners: [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Buyer Rep', displayName: 'Robert Thompson' }],
    buyerSignerRole: 'Buyer Rep',
    authorizedBuyerName: 'Robert Thompson',
    authorizedBuyerEmail: 'brad@veteraninvestoros.com',
    signerMappingAttestation: emailFallbackMapping,
    providerRecipients: emailFallbackRecipients,
  }));
  checkFalse('end to end: an email-only GHL recipient (real live-evidence shape) reaches, and is blocked only by, executed_terms', emailFallbackResult.ok);
  check('failure stage is executed_terms, never buyer_signer_identity, for the email-fallback path', emailFallbackResult.failure.stage, 'executed_terms');
}
{
  const dupRole = [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Seller', displayName: 'Someone Else' }];
  const check1 = SM.validateRequiredSignerSet(dupRole);
  checkFalse('a duplicate role within the required signer set is rejected -- an ambiguous identity', check1.ok);
  check('failure names DUPLICATE_SIGNER_ROLE', check1.reasons[0].code, 'DUPLICATE_SIGNER_ROLE');
}
{
  const blankRole = [{ role: '', displayName: 'Jane Seller' }];
  const check1 = SM.validateRequiredSignerSet(blankRole);
  checkFalse('a blank role in the required signer set is rejected', check1.ok);
  check('failure names SIGNER_BLANK_ROLE', check1.reasons[0].code, 'SIGNER_BLANK_ROLE');
}
{
  const blankName = [{ role: 'Seller', displayName: '' }];
  const check1 = SM.validateRequiredSignerSet(blankName);
  checkFalse('a blank display name in the required signer set is rejected', check1.ok);
  check('failure names SIGNER_BLANK_NAME', check1.reasons[0].code, 'SIGNER_BLANK_NAME');
}
{
  const dupRoleSet = [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Seller', displayName: 'Duplicate Role' }];
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ requiredSigners: dupRoleSet }));
  checkFalse('the full pipeline fails closed at required_signers for a duplicate role, defense in depth even though the caller should have already validated it', result.ok);
  check('failure stage is required_signers', result.failure.stage, 'required_signers');
  checkTrue('failure names DUPLICATE_SIGNER_ROLE', result.failure.reasons.some((r) => r.code === 'DUPLICATE_SIGNER_ROLE'));
}

/* -- buildRequiredSignerSet itself, against SellerContractFactsReport-  */
/*    shaped fixtures (buyer signer + seller signers, never send evidence) */
function populatedDisposition(value) { return { kind: 'populated', value, authority: 'operator_attested', recordedAt: null }; }
function reportFixture(over) {
  return Object.assign({
    noticeContact: { buyerSignerName: populatedDisposition('Brad Thompson'), buyerSignerRole: populatedDisposition('Manager, BTC LLC'), buyerNoticeEmail: { kind: 'unresolved' } },
    parties: { sellerSigners: populatedDisposition([{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }]) },
  }, over || {});
}
{
  const result = SM.buildRequiredSignerSet(reportFixture({}));
  checkTrue('buyer signer PLUS one seller signer both required -- builds successfully', result.ok);
  if (result.ok) {
    check('exactly 2 required signers: the buyer signer + the one seller signer', result.signers.length, 2);
    checkTrue('the buyer signer is present', result.signers.some((s) => s.role === 'Manager, BTC LLC' && s.displayName === 'Brad Thompson'));
    checkTrue('the seller signer is present', result.signers.some((s) => s.role === 'Seller' && s.displayName === 'Jane Seller'));
    check('buyerRole is exposed explicitly', result.buyerRole, 'Manager, BTC LLC');
    check('buyerDisplayName is exposed explicitly', result.buyerDisplayName, 'Brad Thompson');
    check('buyerEmail is null when noticeContact.buyerNoticeEmail is unresolved -- never fails the build closed', result.buyerEmail, null);
  }
}
{
  // B9-13/INV-96 correction round 2 -- buyerEmail sourced from noticeContact.buyerNoticeEmail.
  const withEmail = SM.buildRequiredSignerSet(reportFixture({
    noticeContact: { buyerSignerName: populatedDisposition('Brad Thompson'), buyerSignerRole: populatedDisposition('Manager, BTC LLC'), buyerNoticeEmail: populatedDisposition('brad@veteraninvestoros.com') },
  }));
  checkTrue('buyer email present -- builds successfully', withEmail.ok);
  if (withEmail.ok) check('buyerEmail is sourced from noticeContact.buyerNoticeEmail', withEmail.buyerEmail, 'brad@veteraninvestoros.com');

  const blankEmail = SM.buildRequiredSignerSet(reportFixture({
    noticeContact: { buyerSignerName: populatedDisposition('Brad Thompson'), buyerSignerRole: populatedDisposition('Manager, BTC LLC'), buyerNoticeEmail: populatedDisposition('   ') },
  }));
  checkTrue('a blank (whitespace-only) buyer email still builds successfully', blankEmail.ok);
  if (blankEmail.ok) check('a blank buyer email normalizes to null, never an empty string', blankEmail.buyerEmail, null);
}
{
  // Multiple seller signers -- every one required, plus the buyer.
  const twoSellersReport = reportFixture({
    parties: { sellerSigners: populatedDisposition([
      { role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null },
      { role: 'Spouse', displayName: 'John Seller', signingAuthorityNote: null },
    ]) },
  });
  const result = SM.buildRequiredSignerSet(twoSellersReport);
  checkTrue('buyer signer plus TWO seller signers all required -- builds successfully', result.ok);
  if (result.ok) check('exactly 3 required signers: buyer + 2 sellers', result.signers.length, 3);
}
{
  // Zero seller signers -- fails closed.
  const zeroSellersReport = reportFixture({ parties: { sellerSigners: populatedDisposition([]) } });
  const result = SM.buildRequiredSignerSet(zeroSellersReport);
  checkFalse('zero seller signers fails closed -- at least one seller signer is required', result.ok);
  check('failure names NO_SELLER_SIGNERS', result.reasons[0].code, 'NO_SELLER_SIGNERS');
}
{
  const unresolvedSellersReport = reportFixture({ parties: { sellerSigners: { kind: 'unresolved' } } });
  const result = SM.buildRequiredSignerSet(unresolvedSellersReport);
  checkFalse('unresolved seller signers fails closed', result.ok);
  check('failure names SELLER_SIGNERS_UNRESOLVED', result.reasons[0].code, 'SELLER_SIGNERS_UNRESOLVED');
}
{
  const unresolvedBuyerReport = reportFixture({ noticeContact: { buyerSignerName: { kind: 'unresolved' }, buyerSignerRole: populatedDisposition('Manager') } });
  const result = SM.buildRequiredSignerSet(unresolvedBuyerReport);
  checkFalse('unresolved buyer signer name fails closed -- the buyer signer is required too, never optional', result.ok);
  check('failure names BUYER_SIGNER_UNRESOLVED', result.reasons[0].code, 'BUYER_SIGNER_UNRESOLVED');
}
{
  const blankBuyerReport = reportFixture({ noticeContact: { buyerSignerName: populatedDisposition('   '), buyerSignerRole: populatedDisposition('Manager') } });
  const result = SM.buildRequiredSignerSet(blankBuyerReport);
  checkFalse('a blank (whitespace-only) buyer signer name fails closed', result.ok);
  check('failure names BUYER_SIGNER_BLANK', result.reasons[0].code, 'BUYER_SIGNER_BLANK');
}
{
  // Ambiguous identity ACROSS buyer + seller -- a seller signer accidentally recorded under the same role as the buyer.
  const collidingReport = reportFixture({
    parties: { sellerSigners: populatedDisposition([{ role: 'Manager, BTC LLC', displayName: 'Someone Else', signingAuthorityNote: null }]) },
  });
  const result = SM.buildRequiredSignerSet(collidingReport);
  checkFalse('a seller signer role colliding with the buyer signer role fails closed -- an ambiguous identity across the combined set', result.ok);
  check('failure names DUPLICATE_SIGNER_ROLE', result.reasons[0].code, 'DUPLICATE_SIGNER_ROLE');
}
{
  // Confirms this module never imports contract-send-carriers.ts at all --
  // it cannot read acceptedSend.signers/providerResponse even by accident,
  // since it has no access to that type or module whatsoever. The plain
  // `acceptedSendAttemptId: string` binding field (ruling item 2: "Bind
  // the mapping record to ... accepted-send identity") is a bare string
  // identity, never a dependency on the send record's own signer data.
  const src = fs.readFileSync(path.join(LIB, 'contract-signer-mapping-model.ts'), 'utf8');
  checkFalse('contract-signer-mapping-model.ts never imports from contract-send-carriers.ts -- it cannot read acceptedSend.signers even by accident', /from ["']\.\/contract-send-carriers["']/.test(src));
  checkFalse('contract-signer-mapping-model.ts never imports the ParsedContractSend type', /ParsedContractSend/.test(src));
}

/* ====================================================================== */
/* 6. Brad's recipient-mapping attestation -- manual, one-to-one, never   */
/*    auto-paired by order/role/name; stale/cross-version/malformed/      */
/*    incomplete/conflicting mappings fail closed                        */
/* ====================================================================== */

{
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: requiredSignerFixtureSingle(), availableProviderRecipientIds: ['r1'],
    assignments: [{ role: 'Seller', providerRecipientId: 'r1' }],
    evidenceSummary: 'x',
  });
  checkTrue('a true one-to-one bijection (1 signer, 1 recipient, explicitly assigned) builds successfully', built.ok);
}
{
  const twoSigners = requiredSignerFixtureTwo();
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'],
    assignments: [{ role: 'Seller', providerRecipientId: 'r1' }, { role: 'Spouse', providerRecipientId: 'r2' }],
    evidenceSummary: 'x',
  });
  checkTrue('a true one-to-one bijection (2 signers, 2 recipients, both explicitly assigned) builds successfully', built.ok);
}
{
  // Missing signer -- one required signer never assigned.
  const twoSigners = requiredSignerFixtureTwo();
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'],
    assignments: [{ role: 'Seller', providerRecipientId: 'r1' }],
    evidenceSummary: 'x',
  });
  checkFalse('an assignment count that does not match the required signer count fails closed', built.ok);
  check('failure names MAPPING_COUNT_MISMATCH', built.reasons[0].code, 'MAPPING_COUNT_MISMATCH');
}
{
  // Duplicate signer -- the SAME role assigned twice, leaving another role unmapped and a recipient double-claimed.
  const twoSigners = requiredSignerFixtureTwo();
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'],
    assignments: [{ role: 'Seller', providerRecipientId: 'r1' }, { role: 'Seller', providerRecipientId: 'r2' }],
    evidenceSummary: 'x',
  });
  checkFalse('the same required signer role assigned more than once fails closed', built.ok);
  check('failure names SIGNER_DUPLICATE', built.reasons[0].code, 'SIGNER_DUPLICATE');
}
{
  // Duplicate recipient id -- the SAME recipient assigned to two different signers.
  const twoSigners = requiredSignerFixtureTwo();
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'],
    assignments: [{ role: 'Seller', providerRecipientId: 'r1' }, { role: 'Spouse', providerRecipientId: 'r1' }],
    evidenceSummary: 'x',
  });
  checkFalse('the same provider recipient id assigned to more than one required signer fails closed', built.ok);
  check('failure names RECIPIENT_DUPLICATE', built.reasons[0].code, 'RECIPIENT_DUPLICATE');
}
{
  // Ambiguous/ungrounded assignment -- names a role that is not a required signer.
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: requiredSignerFixtureSingle(), availableProviderRecipientIds: ['r1'],
    assignments: [{ role: 'Not A Real Required Signer', providerRecipientId: 'r1' }],
    evidenceSummary: 'x',
  });
  checkFalse('an assignment naming a role that is not a required signer fails closed', built.ok);
}
{
  // Ambiguous/ungrounded assignment -- names a recipient id that was never observed.
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: requiredSignerFixtureSingle(), availableProviderRecipientIds: ['r1'],
    assignments: [{ role: 'Seller', providerRecipientId: 'r-fabricated-not-observed' }],
    evidenceSummary: 'x',
  });
  checkFalse('an assignment naming a provider recipient id never observed in the readback fails closed', built.ok);
  check('failure names RECIPIENT_UNKNOWN', built.reasons[0].code, 'RECIPIENT_UNKNOWN');
}
{
  // Unmapped recipient -- the document has MORE recipients than required signers; every one must be mapped, none left over.
  const built = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: requiredSignerFixtureSingle(), availableProviderRecipientIds: ['r1', 'r2'],
    assignments: [{ role: 'Seller', providerRecipientId: 'r1' }],
    evidenceSummary: 'x',
  });
  checkFalse('the document reporting MORE recipients than required signers fails closed -- no valid bijection exists, never silently ignores the extra recipient', built.ok);
  check('failure names MAPPING_COUNT_MISMATCH', built.reasons[0].code, 'MAPPING_COUNT_MISMATCH');
}
{
  // Never auto-paired by array order: swapping the assignment order still requires EXPLICIT role/id pairs, and a genuinely wrong explicit pairing is accepted structurally (it's Brad's own factual claim) but caught downstream if it doesn't match live completion evidence -- the BUILDER itself never infers a pairing from position.
  const twoSigners = requiredSignerFixtureTwo();
  const explicitSwap = SM.buildSignerMappingAttestationRecordArgs({
    opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, attestedAt: VERIFIED_AT,
    requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'],
    assignments: [{ role: 'Spouse', providerRecipientId: 'r1' }, { role: 'Seller', providerRecipientId: 'r2' }],
    evidenceSummary: 'x',
  });
  checkTrue('an explicit, deliberately-swapped pairing still builds -- the builder takes Brad\'s own explicit role/id pairs exactly as given, never infers or corrects from array position', explicitSwap.ok);
  if (explicitSwap.ok) {
    check('the built mapping honors the EXPLICIT swap, not array order', explicitSwap.value.mappings.find((m) => m.role === 'Spouse').providerRecipientId, 'r1');
  }
}
{
  // Currency -- stale/cross-version/cross-document/missing/changed-required-signers all fail closed.
  const attestation = signerMappingAttestationFixture({});
  const currentOk = SM.verifySignerMappingAttestationCurrency({
    attestation, opportunityId: OPP, version: V1, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, requiredSigners: requiredSignerFixtureSingle(),
  });
  checkTrue('a mapping attestation matching every current fact is CURRENT', currentOk.ok);

  const missing = SM.verifySignerMappingAttestationCurrency({
    attestation: null, opportunityId: OPP, version: V1, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, requiredSigners: requiredSignerFixtureSingle(),
  });
  checkFalse('no recorded mapping fails closed', missing.ok);
  check('failure names MAPPING_ATTESTATION_MISSING', missing.reasons[0].code, 'MAPPING_ATTESTATION_MISSING');

  const wrongDoc = SM.verifySignerMappingAttestationCurrency({
    attestation, opportunityId: OPP, version: V1, providerDocumentId: 'doc-DIFFERENT', providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, requiredSigners: requiredSignerFixtureSingle(),
  });
  checkFalse('a cross-document mapping fails closed', wrongDoc.ok);
  checkTrue('failure names MAPPING_ATTESTATION_DOCUMENT_MISMATCH', wrongDoc.reasons.some((r) => r.code === 'MAPPING_ATTESTATION_DOCUMENT_MISMATCH'));

  const wrongRevision = SM.verifySignerMappingAttestationCurrency({
    attestation, opportunityId: OPP, version: V1, providerDocumentId: DOC_ID, providerDocumentRevision: 99,
    acceptedSendAttemptId: REQUEST_AT, requiredSigners: requiredSignerFixtureSingle(),
  });
  checkFalse('a stale (revision-changed) mapping fails closed', wrongRevision.ok);
  checkTrue('failure names MAPPING_ATTESTATION_REVISION_MISMATCH', wrongRevision.reasons.some((r) => r.code === 'MAPPING_ATTESTATION_REVISION_MISMATCH'));

  const wrongVersion = SM.verifySignerMappingAttestationCurrency({
    attestation, opportunityId: OPP, version: V2, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, requiredSigners: requiredSignerFixtureSingle(),
  });
  checkFalse('a cross-version mapping fails closed -- never reused across a correction', wrongVersion.ok);
  checkTrue('failure names MAPPING_ATTESTATION_VERSION_MISMATCH', wrongVersion.reasons.some((r) => r.code === 'MAPPING_ATTESTATION_VERSION_MISMATCH'));

  const wrongSend = SM.verifySignerMappingAttestationCurrency({
    attestation, opportunityId: OPP, version: V1, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: 'different-attempt-id', requiredSigners: requiredSignerFixtureSingle(),
  });
  checkFalse('a cross-accepted-send mapping fails closed', wrongSend.ok);
  checkTrue('failure names MAPPING_ATTESTATION_SEND_MISMATCH', wrongSend.reasons.some((r) => r.code === 'MAPPING_ATTESTATION_SEND_MISMATCH'));

  const changedSigners = SM.verifySignerMappingAttestationCurrency({
    attestation, opportunityId: OPP, version: V1, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, requiredSigners: requiredSignerFixtureTwo(),
  });
  checkFalse('a mapping attested against a DIFFERENT required signer set (e.g. a seller signer fact edited since) fails closed -- never silently reused', changedSigners.ok);
  checkTrue('failure names MAPPING_ATTESTATION_REQUIRED_SIGNERS_CHANGED', changedSigners.reasons.some((r) => r.code === 'MAPPING_ATTESTATION_REQUIRED_SIGNERS_CHANGED'));

  const tamperedAuthority = Object.assign({}, attestation, { operator: 'not-brad' });
  const notBrad = SM.verifySignerMappingAttestationCurrency({
    attestation: tamperedAuthority, opportunityId: OPP, version: V1, providerDocumentId: DOC_ID, providerDocumentRevision: 1,
    acceptedSendAttemptId: REQUEST_AT, requiredSigners: requiredSignerFixtureSingle(),
  });
  checkFalse('a mapping tampered in memory to a non-Brad operator (bypassing the builder) fails closed -- defense in depth', notBrad.ok);
  checkTrue('failure names MAPPING_ATTESTATION_NOT_BRAD', notBrad.reasons.some((r) => r.code === 'MAPPING_ATTESTATION_NOT_BRAD'));
}
{
  // The full pipeline fails closed at signer_mapping when no mapping has been recorded.
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ signerMappingAttestation: null }));
  checkFalse('the full pipeline fails closed at signer_mapping when no mapping has been recorded', result.ok);
  check('failure stage is signer_mapping', result.failure.stage, 'signer_mapping');
  checkTrue('failure names MAPPING_ATTESTATION_MISSING', result.failure.reasons.some((r) => r.code === 'MAPPING_ATTESTATION_MISSING'));
}
{
  // A mapping bound to a different document fails closed at signer_mapping in the full pipeline too.
  const staleMapping = signerMappingAttestationFixture({ args: { providerDocumentId: 'doc-STALE' } });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ signerMappingAttestation: staleMapping }));
  checkFalse('a stale (cross-document) mapping fails closed in the full pipeline', result.ok);
  check('failure stage is signer_mapping', result.failure.stage, 'signer_mapping');
}

/* ====================================================================== */
/* 7. GHL's generic "signer" role is never trusted as the contract-role   */
/*    authority -- provider recipient id is the primary join             */
/*    (verifyRequiredSigners tested directly with a 2-signer fixture --   */
/*    the matching logic itself is independent of Part 2's derivation)    */
/* ====================================================================== */

{
  checkTrue('fixture: both provider recipients report the identical generic role "signer"', providerRecipientsTwoComplete().every((r) => r.reportedRole === 'signer'));
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS_TWO, providerRecipients: providerRecipientsTwoComplete() });
  checkTrue('signer verification succeeds correctly via recipient id despite both recipients sharing the identical generic GHL role', result.ok);
  if (result.ok) {
    check('the Seller mapping resolves to recipient r1, not confused with r2 despite identical reportedRole', result.matches.find((m) => m.role === 'Seller').providerRecipientId, 'r1');
    check('the Spouse mapping resolves to recipient r2, not confused with r1 despite identical reportedRole', result.matches.find((m) => m.role === 'Spouse').providerRecipientId, 'r2');
  }
}
{
  const withNonsenseRoles = providerRecipientsTwoComplete([{ reportedRole: 'this-value-is-never-read' }, { reportedRole: null }]);
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS_TWO, providerRecipients: withNonsenseRoles });
  checkTrue('signer verification is completely unaffected by whatever GHL reports as role -- matching never reads that field', result.ok);
}

/* ====================================================================== */
/* 8. Provider recipient IDs bind expected signers; evidence cannot cross */
/*    documents/opportunities/versions                                    */
/* ====================================================================== */

{
  const missing = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS_TWO, providerRecipients: [providerRecipientsTwoComplete()[0]] });
  checkFalse('a mapped recipient id with no matching evidence row fails closed', missing.ok);
  checkTrue('failure names SIGNER_RECIPIENT_NOT_FOUND', missing.reasons.some((r) => r.code === 'SIGNER_RECIPIENT_NOT_FOUND'));
}
{
  const extra = E.verifyRequiredSigners({
    mappings: EXPECTED_SIGNER_MAPPINGS_TWO,
    providerRecipients: providerRecipientsTwoComplete().concat([{ providerRecipientId: 'r3-unexpected', hasCompleted: true, signedDate: null, reportedRole: 'signer', reportedContactName: 'Unexpected Party' }]),
  });
  checkFalse('an extra, unmapped recipient the expected mapping cannot account for fails closed', extra.ok);
  checkTrue('failure names SIGNER_EXTRA_UNMAPPED', extra.reasons.some((r) => r.code === 'SIGNER_EXTRA_UNMAPPED'));
}
{
  const dupMappingRole = E.verifyRequiredSigners({
    mappings: [{ role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1' }, { role: 'Seller', displayName: 'Jane Seller Two', providerRecipientId: 'r2' }],
    providerRecipients: providerRecipientsTwoComplete(),
  });
  checkFalse('a duplicate role within the expected mapping is rejected before any evidence is consulted', dupMappingRole.ok);
  checkTrue('failure names SIGNER_MAPPING_INVALID', dupMappingRole.reasons.some((r) => r.code === 'SIGNER_MAPPING_INVALID'));
}
{
  const dupMappingId = E.verifyRequiredSigners({
    mappings: [{ role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1' }, { role: 'Spouse', displayName: 'John Seller', providerRecipientId: 'r1' }],
    providerRecipients: providerRecipientsTwoComplete(),
  });
  checkFalse('a duplicate provider recipient id claimed by two different expected roles is rejected -- ambiguous identity', dupMappingId.ok);
  checkTrue('failure names SIGNER_MAPPING_INVALID', dupMappingId.reasons.some((r) => r.code === 'SIGNER_MAPPING_INVALID'));
}
{
  const dupEvidence = E.verifyRequiredSigners({
    mappings: EXPECTED_SIGNER_MAPPINGS_TWO,
    providerRecipients: [providerRecipientsTwoComplete()[0], providerRecipientsTwoComplete()[0]],
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
/* 8b. Page count is REQUIRED preserved evidence -- an undetermined count */
/*     BLOCKS Under Contract, never silently permitted through.           */
/*     B9-13 / INV-96 correction.                                         */
/* ====================================================================== */
{
  // A real PDF pdf-lib genuinely CANNOT parse (magic bytes only, no real
  // structure) -- countPdfPages honestly returns null, and the pipeline
  // fails closed rather than silently treating it as page-count-unknown-
  // but-fine.
  const unparseableBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('not a real pdf structure at all, just the magic bytes')]);
  const unparseableOutcome = await selectAndHash(unparseableBytes, 'executed.pdf', 'application/pdf');
  check('countPdfPages honestly returns null for bytes that carry the PDF signature but no real PDF structure', unparseableOutcome.pageCount, null);
  const verifyResult = E.verifyManualArtifactSelection({
    outcome: unparseableOutcome, confirmedProviderDocumentId: DOC_ID, selectedForDocumentId: DOC_ID, selectedForVersion: V1, expectedVersion: V1,
  });
  checkFalse('an undetermined page count fails verifyManualArtifactSelection closed', verifyResult.ok);
  checkTrue('failure names ARTIFACT_PAGE_COUNT_UNDETERMINED', verifyResult.reasons.some((r) => r.code === 'ARTIFACT_PAGE_COUNT_UNDETERMINED'));
  const fullResult = E.buildVerifiedUnderContractRecord(baseArgs({ manualArtifactOutcome: unparseableOutcome }));
  checkFalse('an undetermined page count blocks Under Contract end to end', fullResult.ok);
  check('failure stage is artifact', fullResult.failure.stage, 'artifact');
}
{
  // A REAL, pdf-lib-parseable two-page PDF produces a real pageCount: 2,
  // and it is NOT gated on (only its presence/validity is) -- the
  // pipeline still reaches (and is blocked only by) executed_terms.
  const twoPageOutcome = await selectAndHash(SYNTHETIC_TWO_PAGE_PDF_BYTES, 'executed.pdf', 'application/pdf');
  check('a real two-page PDF produces pageCount: 2', twoPageOutcome.pageCount, 2);
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ manualArtifactOutcome: twoPageOutcome }));
  checkFalse('a real, determined page count (2, not 1) still reaches (and is blocked only by) executed_terms', result.ok);
  check('failure stage is executed_terms, never artifact, for a genuinely determined page count', result.failure.stage, 'executed_terms');
}
{
  // A verified, unanimous attestation genuinely unlocks Under Contract end
  // to end WITH a real page count preserved on the final record.
  const twoPageOutcome = await selectAndHash(SYNTHETIC_TWO_PAGE_PDF_BYTES, 'executed.pdf', 'application/pdf');
  const attestation = validAttestationFixture({ selectedArtifactSha256: twoPageOutcome.sha256 });
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ manualArtifactOutcome: twoPageOutcome, executedTermsAttestation: attestation }));
  checkTrue('a real page count does not block genuine end-to-end success', result.ok);
  check('the final Under Contract record preserves the real, determined page count', result.ok && result.value.pageCount, 2);
}

/* ====================================================================== */
/* 9. Every required signer must complete                                 */
/* ====================================================================== */

{
  const oneIncomplete = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS_TWO, providerRecipients: providerRecipientsTwoComplete([{}, { hasCompleted: false }]) });
  checkFalse('one incomplete signer out of two blocks the whole result, even though the other completed', oneIncomplete.ok);
  checkTrue('failure names SIGNER_INCOMPLETE', oneIncomplete.reasons.some((r) => r.code === 'SIGNER_INCOMPLETE'));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: providerRecipientSingleComplete({ hasCompleted: false }) }));
  checkFalse('the single mapped signer failing to complete blocks the pipeline', result.ok);
  check('failure stage is signers', result.failure.stage, 'signers');
}

/* ====================================================================== */
/* 10. Every required signer must complete WITH a valid signed timestamp  */
/*     -- provider completion ALONE is no longer sufficient (ruling item  */
/*     3, 2026-09-13)                                                     */
/* ====================================================================== */

{
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS_TWO, providerRecipients: providerRecipientsTwoComplete() });
  checkTrue('signedDate is preserved verbatim from the provider evidence when a real one is present', result.ok);
  if (result.ok) {
    check('Seller\'s providerCompletedAt equals the provider\'s own signedDate', result.matches.find((m) => m.role === 'Seller').providerCompletedAt, SIGNED_DATE_SELLER);
    check('Spouse\'s providerCompletedAt equals the provider\'s own signedDate', result.matches.find((m) => m.role === 'Spouse').providerCompletedAt, SIGNED_DATE_SPOUSE);
  }
}
{
  // Ruling item 3: hasCompleted === true with NO signedDate is now treated the same as incomplete -- never silently accepted.
  const withoutSignedDate = providerRecipientsTwoComplete([{ signedDate: null }, {}]);
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS_TWO, providerRecipients: withoutSignedDate });
  checkFalse('a missing signedDate on an otherwise-completed signer now fails closed -- provider completion alone is no longer sufficient', result.ok);
  checkTrue('failure names SIGNER_SIGNED_TIMESTAMP_MISSING', result.reasons.some((r) => r.code === 'SIGNER_SIGNED_TIMESTAMP_MISSING'));
}
{
  const withMalformedSignedDate = providerRecipientsTwoComplete([{ signedDate: 'not-a-real-date' }, {}]);
  const result = E.verifyRequiredSigners({ mappings: EXPECTED_SIGNER_MAPPINGS_TWO, providerRecipients: withMalformedSignedDate });
  checkFalse('a malformed (non-parseable) signedDate on an otherwise-completed signer fails closed', result.ok);
  checkTrue('failure names SIGNER_SIGNED_TIMESTAMP_MISSING', result.reasons.some((r) => r.code === 'SIGNER_SIGNED_TIMESTAMP_MISSING'));
}
{
  const result = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: providerRecipientSingleComplete({ signedDate: null }) }));
  checkFalse('the full pipeline fails closed at signers when the mapped signer completed but carries no signed timestamp', result.ok);
  check('failure stage is signers', result.failure.stage, 'signers');
  checkTrue('failure names SIGNER_SIGNED_TIMESTAMP_MISSING', result.failure.reasons.some((r) => r.code === 'SIGNER_SIGNED_TIMESTAMP_MISSING'));
}

/* ====================================================================== */
/* 11. Every two-of-three execution combination remains blocked           */
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
  const twoOfThreeC = E.buildVerifiedUnderContractRecord(baseArgs({ providerRecipients: providerRecipientSingleComplete({ hasCompleted: false }) }));
  checkFalse('two-of-three (missing signer completion) remains blocked', twoOfThreeC.ok);
  check('failure stage is signers', twoOfThreeC.failure.stage, 'signers');
}
{
  const allThree = E.buildVerifiedUnderContractRecord(baseArgs({}));
  checkFalse('even all three primary facts present, the V1 executed-terms boundary still blocks Under Contract', allThree.ok);
}

/* ====================================================================== */
/* 12. Stale/corrected/superseded/declined/expired/rescinded versions fail */
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
/* 13. Write/readback failure never transitions; a verified append-only   */
/*     record round-trips exactly; duplicates never erase history         */
/* ====================================================================== */

function fixtureEligibleRecord() {
  return {
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
    pageCount: null,
    executedTermsConflictCount: 0,
    iaosVerifiedAt: VERIFIED_AT,
    authority: 'system_derived',
    evidenceSummary: 'Fixture: exercises the carrier/readback machinery independent of the V1 executed-terms boundary.',
    relatedPriorRecordId: null,
  };
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
/* ====================================================================== */
/* 13b. Backward compatibility -- a real, already-durable schema v1 note  */
/*      (no Page count field) must remain readable. B9-13/INV-96.         */
/* ====================================================================== */
{
  function legacyLedgerValue(v) { return (v === null || v === undefined || v === '') ? 'UNAVAILABLE' : String(v); }
  function formatLegacyUnderContractV1Note(record) {
    return [
      'IAOS UNDER CONTRACT — iaos-under-contract-v1',
      `Recorded at: ${record.iaosVerifiedAt}`,
      `Opportunity: ${record.opportunityId}`,
      `Agreement Reached at: ${record.agreementAt}`,
      `Version: ${JSON.stringify(record.version)}`,
      `Accepted send attempt id: ${record.acceptedSendAttemptId}`,
      `Provider document id: ${record.providerDocumentId}`,
      `Provider document reference: ${legacyLedgerValue(record.providerDocumentReference)}`,
      `Provider document revision: ${legacyLedgerValue(record.providerDocumentRevision)}`,
      `Provider reported completion at: ${record.providerReportedCompletionAt}`,
      `Signers: ${JSON.stringify(record.signers)}`,
      `Artifact SHA-256: ${record.artifactSha256}`,
      'Executed terms conflicts: []',
      `Authority: ${record.authority}`,
      `Evidence summary: ${record.evidenceSummary}`,
      `Related prior record id: ${legacyLedgerValue(record.relatedPriorRecordId)}`,
    ].join('\n');
  }
  const record = fixtureEligibleRecord();
  const legacyNote = formatLegacyUnderContractV1Note(record);
  const parsedLegacy = EC.parseUnderContractNote(legacyNote);
  checkTrue('a real, hand-built schema v1 note (no Page count field) still parses -- never stranded', parsedLegacy !== null);
  check('the legacy-parsed record carries pageCount: null (honestly, never fabricated)', parsedLegacy.pageCount, null);
  check(
    'every OTHER field of the legacy-parsed record matches the original exactly',
    JSON.stringify(Object.assign({}, parsedLegacy, { pageCount: undefined })),
    JSON.stringify(Object.assign({}, record, { pageCount: undefined })),
  );
  // A fresh v2 write (WITH a real, non-null page count) still round-trips exactly -- the dual-read never degrades the current schema's own fidelity.
  const v2Record = Object.assign({}, fixtureEligibleRecord(), { pageCount: 12 });
  const v2Note = EC.formatUnderContractNote(v2Record);
  checkTrue('a v2 note header names the CURRENT schema version', v2Note.startsWith('IAOS UNDER CONTRACT — iaos-under-contract-v2'));
  const parsedV2 = EC.parseUnderContractNote(v2Note);
  check('a freshly-written v2 note still round-trips byte-for-byte, page count included', JSON.stringify(parsedV2), JSON.stringify(v2Record));
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
/* 14. Malformed carrier/readback fails closed                            */
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
/* 15b. extractProviderSignerRowsFromListDocumentsBody -- the ONE mapping */
/*      from raw `GET /proposals/document` JSON to ProviderSignerRow[]    */
/* ====================================================================== */

function listDocumentsBodyFixture(over) {
  return {
    documents: [Object.assign({
      documentId: DOC_ID,
      locationId: LOCATION_ID,
      status: 'completed',
      recipients: [
        { id: 'r1', hasCompleted: true, signedDate: SIGNED_DATE_SELLER, role: 'signer', contactName: 'Jane Seller' },
      ],
    }, over || {})],
  };
}

{
  const r = E.extractProviderSignerRowsFromListDocumentsBody({ body: listDocumentsBodyFixture({}), expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID });
  checkTrue('extraction succeeds for a well-formed, matching List Documents body', r.ok);
  if (r.ok) {
    check('extracted row carries the real recipient id as providerRecipientId', r.rows[0].providerRecipientId, 'r1');
    check('extracted row preserves hasCompleted', r.rows[0].hasCompleted, true);
    check('extracted row preserves the real signedDate', r.rows[0].signedDate, SIGNED_DATE_SELLER);
    check('extracted row carries the generic role through as reportedRole, unread by matching logic', r.rows[0].reportedRole, 'signer');
    check('extracted row carries the reported contact name through for audit/display only', r.rows[0].reportedContactName, 'Jane Seller');
  }
}
{
  const r = E.extractProviderSignerRowsFromListDocumentsBody({ body: listDocumentsBodyFixture({}), expectedDocumentId: 'doc-not-present', expectedLocationId: LOCATION_ID });
  checkFalse('extraction fails closed when the expected document id is absent from the page', r.ok);
}
{
  const r = E.extractProviderSignerRowsFromListDocumentsBody({ body: listDocumentsBodyFixture({ locationId: 'loc-WRONG' }), expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID });
  checkFalse('extraction fails closed on a locationId mismatch -- never trusts recipients from an unexpected environment', r.ok);
}
{
  const r = E.extractProviderSignerRowsFromListDocumentsBody({ body: listDocumentsBodyFixture({ recipients: 'not-an-array' }), expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID });
  checkFalse('extraction fails closed when recipients is not an array', r.ok);
}
{
  const r = E.extractProviderSignerRowsFromListDocumentsBody({ body: listDocumentsBodyFixture({ recipients: [{ hasCompleted: true, signedDate: SIGNED_DATE_SELLER, role: 'signer' }] }), expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID });
  checkFalse('extraction fails closed when a recipient entry has no provider-assigned id -- the required join field', r.ok);
}
{
  const r = E.extractProviderSignerRowsFromListDocumentsBody({ body: { notDocuments: [] }, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID });
  checkFalse('extraction fails closed when the response has no documents[] array at all', r.ok);
}
{
  const r = E.extractProviderSignerRowsFromListDocumentsBody({ body: null, expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID });
  checkFalse('extraction fails closed when the response body is not a JSON object', r.ok);
}
{
  // The extracted rows feed DIRECTLY into the same verifyRequiredSigners used by the full pipeline -- proving the live-shaped extraction and Brad's own attested mapping compose correctly end to end.
  const extracted = E.extractProviderSignerRowsFromListDocumentsBody({ body: listDocumentsBodyFixture({}), expectedDocumentId: DOC_ID, expectedLocationId: LOCATION_ID });
  const attestation = signerMappingAttestationFixture({});
  if (extracted.ok) {
    const signerResult = E.verifyRequiredSigners({ mappings: attestation.mappings, providerRecipients: extracted.rows });
    checkTrue('end to end: a live-shaped List Documents body, extracted and matched against Brad\'s own attested mapping, correctly verifies the single mapped signer', signerResult.ok);
  }
}

/* ====================================================================== */
/* 16. Executed-terms attestation model -- checklist building, the        */
/*     unanimous-MATCHES gate, and carrier round-trip/rejection           */
/* ====================================================================== */

{
  const items = AT.buildExecutedTermsChecklist({
    agreement: { price: 190000, propertyAddress: '123 Main St', parties: [] },
    buyerIdentity: 'BTC LLC',
    expectedSigners: [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Spouse', displayName: 'John Seller' }],
  });
  check('checklist has exactly 3 fixed items + one per signer + one catch-all', items.length, 6);
  check('item order is fixed: property, price, buyer, then each signer, then catch-all', items.map((i) => i.kind), [
    'property_identity', 'purchase_price', 'buyer_identity', 'signing_party', 'signing_party', 'other_material_terms',
  ]);
  checkTrue('property_identity carries the real authoritative address', items[0].authoritativeLabel.includes('123 Main St'));
  checkTrue('purchase_price carries the real authoritative price', items[1].authoritativeLabel.includes('190,000') || items[1].authoritativeLabel.includes('190000'));
  check('buyer_identity carries the real authoritative buyer', items[2].authoritativeLabel, 'BTC LLC');
  check('one signing_party item exists per expected signer, each naming its own role', items.filter((i) => i.kind === 'signing_party').map((i) => i.signerRole), ['Seller', 'Spouse']);
  checkTrue('every non-signing_party item has a null signerRole', items.filter((i) => i.kind !== 'signing_party').every((i) => i.signerRole === null));
  // Gate-review closure -- Finding H, requirement 1: the operator-facing
  // authoritativeLabel is the printed PERSONAL name only, never the
  // internal capacity/role label -- role is preserved on `signerRole`
  // (internal metadata) but never concatenated into the displayed text.
  check('signing_party authoritativeLabel is the printed personal name only, never role-prefixed', items.filter((i) => i.kind === 'signing_party').map((i) => i.authoritativeLabel), ['Jane Seller', 'John Seller']);
}
{
  // Finding H exact scenario: buyer entity Brad Thompson Consulting LLC,
  // required signer role "Manager", printed personal identity "Robert
  // Thompson". The operator must be asked to verify "Robert Thompson",
  // never "Manager: Robert Thompson" or "Manager" alone -- while the
  // internal signerRole still carries "Manager" for the durable mapping.
  const items = AT.buildExecutedTermsChecklist({
    agreement: { price: 190000, propertyAddress: '123 Main St', parties: [] },
    buyerIdentity: 'Brad Thompson Consulting LLC',
    expectedSigners: [{ role: 'Manager', displayName: 'Robert Thompson' }],
  });
  const signingItem = items.find((i) => i.kind === 'signing_party');
  check('Finding H: signing_party authoritativeLabel names Robert Thompson exactly', signingItem.authoritativeLabel, 'Robert Thompson');
  check('Finding H: internal signerRole still preserves "Manager" (never displayed)', signingItem.signerRole, 'Manager');
  checkFalse('Finding H: authoritativeLabel never contains the internal role word "Manager"', signingItem.authoritativeLabel.includes('Manager'));
  const buyerItem = items.find((i) => i.kind === 'buyer_identity');
  check('Finding H: buyer entity remains its own separate, distinct item', buyerItem.authoritativeLabel, 'Brad Thompson Consulting LLC');
  checkTrue('Finding H: buyer_identity and signing_party are two distinct checklist items', buyerItem !== signingItem);
}
{
  // ruling item 3: ONLY unanimous MATCHES may satisfy verification.
  const items = AT.buildExecutedTermsChecklist({ agreement: { price: 1, propertyAddress: 'x', parties: [] }, buyerIdentity: 'BTC LLC', expectedSigners: [{ role: 'Seller', displayName: 'Jane Seller' }] });
  const allMatches = items.map((i) => ({ kind: i.kind, signerRole: i.signerRole, result: 'MATCHES' }));
  const oneDoesNotMatch = items.map((i, idx) => ({ kind: i.kind, signerRole: i.signerRole, result: idx === 0 ? 'DOES_NOT_MATCH' : 'MATCHES' }));
  const oneCannotVerify = items.map((i, idx) => ({ kind: i.kind, signerRole: i.signerRole, result: idx === 0 ? 'CANNOT_VERIFY' : 'MATCHES' }));
  const baseAttestationArgs = { opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1, selectedArtifactSha256: 'a'.repeat(64), attestedAt: VERIFIED_AT, requiredItems: items, evidenceSummary: 'x' };

  const okResult = AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, baseAttestationArgs, { responses: allMatches }));
  checkTrue('unanimous MATCHES builds successfully', okResult.ok);

  const notMatchResult = AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, baseAttestationArgs, { responses: oneDoesNotMatch }));
  checkFalse('a single DOES_NOT_MATCH blocks the whole attestation from being built', notMatchResult.ok);
  check('failure names NOT_UNANIMOUS_MATCHES', notMatchResult.reasons[0].code, 'NOT_UNANIMOUS_MATCHES');

  const cannotVerifyResult = AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, baseAttestationArgs, { responses: oneCannotVerify }));
  checkFalse('a single CANNOT_VERIFY blocks the whole attestation from being built -- treated the same as a mismatch, never a silent pass', cannotVerifyResult.ok);
  check('failure names NOT_UNANIMOUS_MATCHES', cannotVerifyResult.reasons[0].code, 'NOT_UNANIMOUS_MATCHES');
}
{
  const items = AT.buildExecutedTermsChecklist({ agreement: { price: 1, propertyAddress: 'x', parties: [] }, buyerIdentity: 'BTC LLC', expectedSigners: [{ role: 'Seller', displayName: 'Jane Seller' }] });
  const base = { opportunityId: OPP, version: V1, agreementAt: AGREEMENT_AT, providerDocumentId: DOC_ID, providerDocumentRevision: 1, selectedArtifactSha256: 'a'.repeat(64), attestedAt: VERIFIED_AT, requiredItems: items, evidenceSummary: 'x' };
  const allMatches = items.map((i) => ({ kind: i.kind, signerRole: i.signerRole, result: 'MATCHES' }));

  checkFalse('a response count that does not match the required item count fails closed', AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, base, { responses: allMatches.slice(0, -1) })).ok);
  const dup = allMatches.slice(0, -1).concat([allMatches[0]]);
  checkFalse('a duplicate response for the same item fails closed', AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, base, { responses: dup })).ok);
  const substituted = allMatches.slice(0, -1).concat([{ kind: 'purchase_price', signerRole: null, result: 'MATCHES' }]);
  checkFalse('a response set that does not correspond one-to-one to the required items fails closed', AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, base, { responses: substituted })).ok);
  checkFalse('zero required items fails closed', AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, base, { requiredItems: [], responses: [] })).ok);
  checkFalse('a malformed (non-64-hex) sha256 fails closed', AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, base, { responses: allMatches, selectedArtifactSha256: 'not-a-hash' })).ok);
  checkFalse('a mismatched Agreement Reached identity vs version.agreementAt fails closed', AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, base, { responses: allMatches, agreementAt: '2099-01-01T00:00:00.000Z' })).ok);
  const built = AT.buildExecutedTermsAttestationRecordArgs(Object.assign({}, base, { responses: allMatches }));
  checkTrue('operator/authorizedBy are hardcoded "brad" literals, never caller-supplied', built.ok && built.value.operator === 'brad' && built.value.authorizedBy === 'brad');
}
{
  // Carrier round-trip -- exact field equality.
  const attestation = validAttestationFixture({});
  const note = ATC.formatExecutedTermsAttestationNote(attestation);
  const parsed = ATC.parseExecutedTermsAttestationNote(note);
  checkTrue('the attestation note round-trips to a non-null record', parsed !== null);
  check('round-trip is byte-for-byte field-equal to the original', JSON.stringify(parsed), JSON.stringify(attestation));
}
{
  checkNull('parse: unrelated text is rejected', ATC.parseExecutedTermsAttestationNote('not an attestation note'));
  checkNull('parse: empty string is rejected', ATC.parseExecutedTermsAttestationNote(''));
}
{
  const attestation = validAttestationFixture({});
  const note = ATC.formatExecutedTermsAttestationNote(attestation);
  const lines = note.split('\n');
  const opIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[opIdx] = 'Operator: not-brad';
  checkNull('parse: a non-Brad Operator is rejected', ATC.parseExecutedTermsAttestationNote(lines.join('\n')));
}
{
  const attestation = validAttestationFixture({});
  const note = ATC.formatExecutedTermsAttestationNote(attestation);
  const lines = note.split('\n');
  const authIdx = lines.findIndex((l) => l.startsWith('Authorized by: '));
  lines[authIdx] = 'Authorized by: not-brad';
  checkNull('parse: a non-Brad Authorized by is rejected', ATC.parseExecutedTermsAttestationNote(lines.join('\n')));
}
{
  const attestation = validAttestationFixture({});
  const note = ATC.formatExecutedTermsAttestationNote(attestation);
  const lines = note.split('\n');
  const agreementIdx = lines.findIndex((l) => l.startsWith('Agreement Reached at: '));
  lines[agreementIdx] = 'Agreement Reached at: 2099-01-01T00:00:00.000Z';
  checkNull('parse: a mixed-version record is rejected', ATC.parseExecutedTermsAttestationNote(lines.join('\n')));
}
{
  const attestation = validAttestationFixture({});
  const note = ATC.formatExecutedTermsAttestationNote(attestation);
  const lines = note.split('\n');
  const itemsIdx = lines.findIndex((l) => l.startsWith('Items: '));
  lines[itemsIdx] = 'Items: []';
  checkNull('parse: an empty Items array is rejected', ATC.parseExecutedTermsAttestationNote(lines.join('\n')));
}
{
  const attestation = validAttestationFixture({});
  const note = ATC.formatExecutedTermsAttestationNote(attestation);
  const lines = note.split('\n');
  const itemsIdx = lines.findIndex((l) => l.startsWith('Items: '));
  const items = JSON.parse(lines[itemsIdx].slice('Items: '.length));
  items[0].result = 'DOES_NOT_MATCH';
  lines[itemsIdx] = 'Items: ' + JSON.stringify(items);
  checkNull('parse: an Items array containing ANY non-MATCHES result is rejected -- the carrier\'s own central gate, defense in depth against a hand-edited note', ATC.parseExecutedTermsAttestationNote(lines.join('\n')));
}
{
  const attestation = validAttestationFixture({});
  const note = ATC.formatExecutedTermsAttestationNote(attestation);
  const lines = note.split('\n');
  const shaIdx = lines.findIndex((l) => l.startsWith('Artifact SHA-256: '));
  lines[shaIdx] = 'Artifact SHA-256: not-a-real-hash';
  checkNull('parse: a malformed SHA-256 is rejected', ATC.parseExecutedTermsAttestationNote(lines.join('\n')));
}
{
  checkNull('parse: correct header but wrong line count is rejected', ATC.parseExecutedTermsAttestationNote('IAOS EXECUTED TERMS ATTESTATION — iaos-executed-terms-attestation-v1\nAttested at: 2026-01-01T00:00:00.000Z'));
}
{
  // Append-only, latest-wins convenience.
  const a1 = validAttestationFixture({ attestedAt: '2026-09-12T10:00:00.000Z' });
  const a2 = validAttestationFixture({ attestedAt: '2026-09-12T11:00:00.000Z' });
  const notes = [{ body: ATC.formatExecutedTermsAttestationNote(a1) }, { body: ATC.formatExecutedTermsAttestationNote(a2) }];
  const all = ATC.allExecutedTermsAttestationRecordsForOpportunity(notes, OPP);
  check('append-only reader returns BOTH records, unfiltered', all.length, 2);
  const latest = ATC.latestExecutedTermsAttestationForOpportunity(notes, OPP);
  check('latest-wins convenience picks the later attestedAt', latest.attestedAt, a2.attestedAt);
}
{
  const different = validAttestationFixture({ opportunityId: 'opp-OTHER' });
  const notes = [{ body: ATC.formatExecutedTermsAttestationNote(different) }];
  check('append-only reader scopes strictly to the requested opportunityId', ATC.allExecutedTermsAttestationRecordsForOpportunity(notes, OPP).length, 0);
}

/* ====================================================================== */
/* 17. Signer-mapping attestation carrier -- round-trip and every          */
/*     rejection case                                                     */
/* ====================================================================== */

{
  const mapping = signerMappingAttestationFixture({});
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const parsed = SMC.parseSignerMappingAttestationNote(note);
  checkTrue('the signer-mapping note round-trips to a non-null record', parsed !== null);
  check('round-trip is byte-for-byte field-equal to the original', JSON.stringify(parsed), JSON.stringify(mapping));
}
{
  checkNull('parse: unrelated text is rejected', SMC.parseSignerMappingAttestationNote('not a mapping note'));
  checkNull('parse: empty string is rejected', SMC.parseSignerMappingAttestationNote(''));
}
{
  const mapping = signerMappingAttestationFixture({});
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const lines = note.split('\n');
  const opIdx = lines.findIndex((l) => l.startsWith('Operator: '));
  lines[opIdx] = 'Operator: not-brad';
  checkNull('parse: a non-Brad Operator is rejected', SMC.parseSignerMappingAttestationNote(lines.join('\n')));
}
{
  const mapping = signerMappingAttestationFixture({});
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const lines = note.split('\n');
  const authIdx = lines.findIndex((l) => l.startsWith('Authorized by: '));
  lines[authIdx] = 'Authorized by: not-brad';
  checkNull('parse: a non-Brad Authorized by is rejected', SMC.parseSignerMappingAttestationNote(lines.join('\n')));
}
{
  const mapping = signerMappingAttestationFixture({});
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const lines = note.split('\n');
  const agreementIdx = lines.findIndex((l) => l.startsWith('Agreement Reached at: '));
  lines[agreementIdx] = 'Agreement Reached at: 2099-01-01T00:00:00.000Z';
  checkNull('parse: a mixed-version record is rejected', SMC.parseSignerMappingAttestationNote(lines.join('\n')));
}
{
  const mapping = signerMappingAttestationFixture({});
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const lines = note.split('\n');
  const mappingsIdx = lines.findIndex((l) => l.startsWith('Mappings: '));
  lines[mappingsIdx] = 'Mappings: []';
  checkNull('parse: an empty Mappings array is rejected', SMC.parseSignerMappingAttestationNote(lines.join('\n')));
}
{
  const twoSigners = requiredSignerFixtureTwo();
  const mapping = signerMappingAttestationFixture({ requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'] });
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const lines = note.split('\n');
  const mappingsIdx = lines.findIndex((l) => l.startsWith('Mappings: '));
  const parsedMappings = JSON.parse(lines[mappingsIdx].slice('Mappings: '.length));
  parsedMappings[1].role = parsedMappings[0].role; // duplicate role
  lines[mappingsIdx] = 'Mappings: ' + JSON.stringify(parsedMappings);
  checkNull('parse: a duplicate role within the parsed Mappings array is rejected -- defense in depth against a hand-edited note', SMC.parseSignerMappingAttestationNote(lines.join('\n')));
}
{
  const twoSigners = requiredSignerFixtureTwo();
  const mapping = signerMappingAttestationFixture({ requiredSigners: twoSigners, availableProviderRecipientIds: ['r1', 'r2'] });
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const lines = note.split('\n');
  const mappingsIdx = lines.findIndex((l) => l.startsWith('Mappings: '));
  const parsedMappings = JSON.parse(lines[mappingsIdx].slice('Mappings: '.length));
  parsedMappings[1].providerRecipientId = parsedMappings[0].providerRecipientId; // duplicate recipient id
  lines[mappingsIdx] = 'Mappings: ' + JSON.stringify(parsedMappings);
  checkNull('parse: a duplicate provider recipient id within the parsed Mappings array is rejected', SMC.parseSignerMappingAttestationNote(lines.join('\n')));
}
{
  const mapping = signerMappingAttestationFixture({});
  const note = SMC.formatSignerMappingAttestationNote(mapping);
  const lines = note.split('\n');
  const docIdx = lines.findIndex((l) => l.startsWith('Provider document id: '));
  lines[docIdx] = 'Provider document id: ';
  checkNull('parse: a blank provider document id is rejected', SMC.parseSignerMappingAttestationNote(lines.join('\n')));
}
checkNull('parse: correct header but wrong line count is rejected', SMC.parseSignerMappingAttestationNote('IAOS SIGNER MAPPING ATTESTATION — iaos-signer-mapping-attestation-v1\nAttested at: 2026-01-01T00:00:00.000Z'));
{
  // Append-only, latest-wins convenience.
  const m1 = signerMappingAttestationFixture({ args: { attestedAt: '2026-09-12T10:00:00.000Z' } });
  const m2 = signerMappingAttestationFixture({ args: { attestedAt: '2026-09-12T11:00:00.000Z' } });
  const notes = [{ body: SMC.formatSignerMappingAttestationNote(m1) }, { body: SMC.formatSignerMappingAttestationNote(m2) }];
  const all = SMC.allSignerMappingAttestationRecordsForOpportunity(notes, OPP);
  check('append-only reader returns BOTH records, unfiltered', all.length, 2);
  const latest = SMC.latestSignerMappingAttestationForOpportunity(notes, OPP);
  check('latest-wins convenience picks the later attestedAt', latest.attestedAt, m2.attestedAt);
}
{
  const different = signerMappingAttestationFixture({ args: { opportunityId: 'opp-OTHER' } });
  const notes = [{ body: SMC.formatSignerMappingAttestationNote(different) }];
  check('append-only reader scopes strictly to the requested opportunityId', SMC.allSignerMappingAttestationRecordsForOpportunity(notes, OPP).length, 0);
}

/* ====================================================================== */
/* 15. No stage/workflow/send/Production mutation exists anywhere in the  */
/*     new or modified source (static scan)                               */
/* ====================================================================== */

{
  const modelSource = fs.readFileSync(path.join(LIB, 'contract-execution-model.ts'), 'utf8');
  const carrierSource = fs.readFileSync(path.join(LIB, 'contract-execution-carriers.ts'), 'utf8');
  const sendCarrierSource = fs.readFileSync(path.join(LIB, 'contract-send-carriers.ts'), 'utf8');
  const browserHashSource = fs.readFileSync(path.join(LIB, 'browser-artifact-hash.ts'), 'utf8');
  const attestationModelSource = fs.readFileSync(path.join(LIB, 'contract-executed-terms-attestation-model.ts'), 'utf8');
  const attestationCarrierSource = fs.readFileSync(path.join(LIB, 'contract-executed-terms-attestation-carriers.ts'), 'utf8');
  const signerMappingModelSource = fs.readFileSync(path.join(LIB, 'contract-signer-mapping-model.ts'), 'utf8');
  const signerMappingCarrierSource = fs.readFileSync(path.join(LIB, 'contract-signer-mapping-carriers.ts'), 'utf8');
  const combined = modelSource + '\n' + carrierSource + '\n' + sendCarrierSource + '\n' + browserHashSource + '\n' + attestationModelSource + '\n' + attestationCarrierSource + '\n' + signerMappingModelSource + '\n' + signerMappingCarrierSource;
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

})().catch((e) => {
  console.error('ABORT (uncaught error in async test body):', e && e.stack || e);
  cleanup();
  process.exit(10);
});
