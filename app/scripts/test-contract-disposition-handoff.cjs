/**
 * Board #9 -> Board #10 disposition-handoff -- deterministic model +
 * carrier test runner. B9-11 / INV-66.
 *
 * Compiles contract-disposition-handoff-model.ts, contract-disposition-
 * handoff-carriers.ts, and their full dependency chain to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases mapped directly to this issue's own "Proof
 * required" list. Every record is a SIMULATED fixture object -- no
 * network call, no live GHL call, no `ghl.notes.create()`.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-disposition-handoff-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-disposition-handoff-model.ts'),
  path.join(LIB, 'contract-disposition-handoff-carriers.ts'),
  path.join(LIB, 'contract-execution-model.ts'),
  path.join(LIB, 'contract-execution-carriers.ts'),
  path.join(LIB, 'contract-lifecycle-model.ts'),
  path.join(LIB, 'contract-lifecycle-carriers.ts'),
  path.join(LIB, 'contract-send-carriers.ts'),
  path.join(LIB, 'contract-executed-terms-attestation-model.ts'),
  path.join(LIB, 'contract-executed-terms-attestation-carriers.ts'),
  path.join(LIB, 'contract-signer-mapping-model.ts'),
  path.join(LIB, 'contract-signer-mapping-carriers.ts'),
  path.join(LIB, 'board9-contract-model.ts'),
  path.join(LIB, 'contract-facts-model.ts'),
  path.join(LIB, 'seller-contract-facts-carriers.ts'),
  path.join(LIB, 'arv-approval-note.ts'),
  path.join(LIB, 'arv-persist.ts'),
  path.join(LIB, 'arv-reconciliation.ts'),
  path.join(LIB, 'seller-call-outcome.ts'),
  path.join(LIB, 'seller-call-readiness-carriers.ts'),
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
const H = require(path.join(LIB_OUT, 'contract-disposition-handoff-model.js'));
const HC = require(path.join(LIB_OUT, 'contract-disposition-handoff-carriers.js'));
const B = require(path.join(LIB_OUT, 'board9-contract-model.js'));
const L = require(path.join(LIB_OUT, 'contract-lifecycle-model.js'));

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
const CONTACT = 'contact-1';
const AGREEMENT_AT = '2026-09-06T15:00:00.000Z';
const REQUEST_AT = '2026-09-12T10:00:00.000Z';
const VERIFIED_AT = '2026-09-12T13:00:00.000Z';
const CREATED_AT = '2026-09-13T09:00:00.000Z';
const DOC_ID = 'doc-fixture-1';
const LOCATION_ID = 'loc-test-1';
const V1 = B.initialVersionIdentity(AGREEMENT_AT);
const V2 = { agreementAt: V1.agreementAt, versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };

/* ====================================================================== */
/* Fixtures                                                                */
/* ====================================================================== */

function underContractFixture(over) {
  return Object.assign({
    kind: 'under_contract',
    opportunityId: OPP,
    agreementAt: AGREEMENT_AT,
    version: V1,
    acceptedSendAttemptId: REQUEST_AT,
    providerDocumentId: DOC_ID,
    providerDocumentReference: 'ref-1',
    providerDocumentRevision: 1,
    providerReportedCompletionAt: '2026-09-12T11:59:00.000Z',
    signers: [{ role: 'Seller', displayName: 'Jane Seller', providerRecipientId: 'r1', providerCompletedAt: '2026-09-09T19:23:12.738Z' }],
    artifactSha256: 'a'.repeat(64),
    executedTermsConflictCount: 0,
    iaosVerifiedAt: VERIFIED_AT,
    authority: 'system_derived',
    evidenceSummary: 'fixture under contract record',
    relatedPriorRecordId: null,
  }, over || {});
}

function populated(value, authority, recordedAt) {
  return { kind: 'populated', value, authority: authority || 'operator_attested', recordedAt: recordedAt === undefined ? null : recordedAt };
}
function unresolved() {
  return { kind: 'unresolved' };
}
function notApplicable(confirmedBy, at, note) {
  return { kind: 'not_applicable', confirmedBy: confirmedBy || 'brad', at: at || AGREEMENT_AT, note: note === undefined ? null : note };
}

function propertyLegalDescriptionFixture() {
  return {
    lot: populated({ kind: 'value', value: '12' }),
    block: populated({ kind: 'value', value: 'A' }),
    addition: populated({ kind: 'value', value: 'Fixture Addition' }),
    county: populated({ kind: 'value', value: 'Dallas' }),
    exclusions: notApplicable(),
    reservations: notApplicable(),
  };
}

function sellerContactFixture() {
  return {
    noticeAddress: populated('123 Main St, Dallas, TX'),
    noticePhone: populated('555-555-1234'),
    noticeEmail: populated('seller@example.com'),
  };
}

function approvedArvFixture(over) {
  return Object.assign({ amount: 250000, approvalEvidenceState: 'HIGH', approvalDecision: 'APPROVED', approvedAt: '2026-09-05T12:00:00.000Z' }, over || {});
}

function requiredSignersFixture() {
  return [{ role: 'Seller', displayName: 'Jane Seller' }];
}

function baseEligibilityArgs(over) {
  return Object.assign({
    opportunityId: OPP,
    agreementAt: AGREEMENT_AT,
    version: V1,
    underContract: underContractFixture({}),
    lifecycleHistory: [],
    existingHandoffsForOpportunity: [],
  }, over || {});
}

function baseBuildArgs(over) {
  const underContract = (over && over.underContract) || underContractFixture({});
  return Object.assign({
    handoffId: 'handoff-fixture-1',
    createdAt: CREATED_AT,
    opportunityId: OPP,
    contactId: CONTACT,
    agreementAt: AGREEMENT_AT,
    version: V1,
    eligibility: { eligible: true },
    underContract,
    propertyAddress: populated('123 Main St, Dallas, TX 75201'),
    propertyLegalDescription: propertyLegalDescriptionFixture(),
    sellerContractPrice: 190000,
    approvedArv: approvedArvFixture({}),
    approvedRepairs: 25000,
    closingDate: populated('2026-10-15T00:00:00.000Z'),
    possessionDetails: populated({ kind: 'value', value: 'Upon closing and funding' }),
    accessShowingInformation: unresolved(),
    sellerContact: sellerContactFixture(),
    requiredSigners: requiredSignersFixture(),
    documentReferences: [],
    documentReferencesNote: 'No photo/document carrier exists in IAOS today.',
    evidenceSummary: 'fixture disposition handoff',
  }, over || {});
}

function validHandoffFixture(over) {
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs(over || {}));
  if (!built.ok) throw new Error('fixture validHandoffFixture failed: ' + JSON.stringify(built.reasons));
  return built.value;
}

/* ====================================================================== */
/* 1. No handoff before canonical verified Under Contract                 */
/* ====================================================================== */

{
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({ underContract: null }));
  checkFalse('no Under Contract record at all fails closed', result.eligible);
  check('failure names UNDER_CONTRACT_MISSING', result.reasons[0].code, 'UNDER_CONTRACT_MISSING');
}
{
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({}));
  checkTrue('a genuine, matching, unrescinded Under Contract record is eligible', result.eligible);
}
{
  const built = H.buildDispositionHandoffRecordArgs(Object.assign({}, baseBuildArgs({}), { eligibility: { eligible: false, reasons: [{ code: 'UNDER_CONTRACT_MISSING', message: 'x' }] } }));
  checkFalse('the builder itself refuses to build when eligibility was not confirmed -- defense in depth', built.ok);
  checkTrue('failure names NOT_ELIGIBLE', built.reasons.some((r) => r.code === 'NOT_ELIGIBLE'));
}

/* ====================================================================== */
/* 2. Exact opportunity/version/document/artifact binding                 */
/* ====================================================================== */

{
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({ opportunityId: 'opp-DIFFERENT' }));
  checkFalse('a mismatched opportunityId fails closed', result.eligible);
  check('failure names UNDER_CONTRACT_OPPORTUNITY_MISMATCH', result.reasons[0].code, 'UNDER_CONTRACT_OPPORTUNITY_MISMATCH');
}
{
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({ agreementAt: '2099-01-01T00:00:00.000Z' }));
  checkFalse('a mismatched Agreement Reached identity fails closed', result.eligible);
  check('failure names UNDER_CONTRACT_AGREEMENT_MISMATCH', result.reasons[0].code, 'UNDER_CONTRACT_AGREEMENT_MISMATCH');
}
{
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({ version: V2 }));
  checkFalse('a mismatched contract version fails closed -- never crosses a correction boundary', result.eligible);
  check('failure names UNDER_CONTRACT_VERSION_MISMATCH', result.reasons[0].code, 'UNDER_CONTRACT_VERSION_MISMATCH');
}
{
  const handoff = validHandoffFixture({});
  const currencyOk = H.verifyHandoffMatchesUnderContract({ handoff, opportunityId: OPP, agreementAt: AGREEMENT_AT, version: V1, underContract: underContractFixture({}) });
  checkTrue('a genuinely matching handoff/Under Contract pair verifies current', currencyOk.ok);
  const wrongDoc = H.verifyHandoffMatchesUnderContract({ handoff, opportunityId: OPP, agreementAt: AGREEMENT_AT, version: V1, underContract: underContractFixture({ iaosVerifiedAt: '2099-01-01T00:00:00.000Z' }) });
  checkFalse('a handoff bound to a DIFFERENT Under Contract verification identity fails currency', wrongDoc.ok);
  checkTrue('failure names HANDOFF_UNDER_CONTRACT_MISMATCH', wrongDoc.reasons.some((r) => r.code === 'HANDOFF_UNDER_CONTRACT_MISMATCH'));
}

/* ====================================================================== */
/* 3. Stale, corrected, rescinded, malformed, or conflicting evidence      */
/*    blocks                                                              */
/* ====================================================================== */

{
  const rescission = L.buildRescissionRecord({
    opportunityId: OPP, version: V1, reason: 'Seller withdrew.', authorizedBy: 'brad', authorizedAt: '2026-09-13T08:00:00.000Z',
    acceptedSend: { opportunityId: OPP, status: 'accepted', version: V1, providerResponse: { documentId: DOC_ID, documentReference: 'ref-1', documentRevision: 1, recipientId: 'r1', createdBy: 's', readbackStatus: 'sent', readbackLocationId: LOCATION_ID, fillableFieldCount: 1 }, at: REQUEST_AT, operator: 'brad', attemptId: REQUEST_AT, templateName: 't', templateSource: 'ghl', requestedTemplateId: 'tmpl-1', authorizedAt: REQUEST_AT, signers: [{ role: 'Seller', displayName: 'Jane Seller' }], confirmedRecipientId: 'r1', expirationAt: '2026-09-20T00:00:00.000Z', requestAt: REQUEST_AT, iaosObservedAcceptanceAt: REQUEST_AT, failureReason: null },
    iaosObservedAt: '2026-09-13T08:00:00.000Z', evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  checkTrue('setup: rescission record fixture builds', rescission.ok);
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({ lifecycleHistory: [rescission.value] }));
  checkFalse('a rescission record for this exact version blocks the handoff -- fails closed', result.eligible);
  checkTrue('failure names UNDER_CONTRACT_INVALIDATED_BY_LIFECYCLE_EVIDENCE', result.reasons.some((r) => r.code === 'UNDER_CONTRACT_INVALIDATED_BY_LIFECYCLE_EVIDENCE'));
}
{
  // A rescission for a DIFFERENT version does not block this one.
  const rescission = L.buildRescissionRecord({
    opportunityId: OPP, version: V2, reason: 'x', authorizedBy: 'brad', authorizedAt: '2026-09-13T08:00:00.000Z',
    acceptedSend: { opportunityId: OPP, status: 'accepted', version: V2, providerResponse: { documentId: DOC_ID, documentReference: 'ref-1', documentRevision: 1, recipientId: 'r1', createdBy: 's', readbackStatus: 'sent', readbackLocationId: LOCATION_ID, fillableFieldCount: 1 }, at: REQUEST_AT, operator: 'brad', attemptId: REQUEST_AT, templateName: 't', templateSource: 'ghl', requestedTemplateId: 'tmpl-1', authorizedAt: REQUEST_AT, signers: [{ role: 'Seller', displayName: 'Jane Seller' }], confirmedRecipientId: 'r1', expirationAt: '2026-09-20T00:00:00.000Z', requestAt: REQUEST_AT, iaosObservedAcceptanceAt: REQUEST_AT, failureReason: null },
    iaosObservedAt: '2026-09-13T08:00:00.000Z', evidenceSummary: 'x', relatedPriorRecordId: null,
  });
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({ lifecycleHistory: [rescission.value] }));
  checkTrue('a rescission for a DIFFERENT contract version does not block this one', result.eligible);
}
{
  const handoff = validHandoffFixture({});
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({
    existingHandoffsForOpportunity: [{ agreementAt: handoff.agreementAt, version: handoff.version, underContractVerifiedAt: handoff.underContract.verifiedAt }],
  }));
  checkFalse('an equivalent handoff that already exists for this exact verified execution fails closed', result.eligible);
  check('failure names HANDOFF_ALREADY_EXISTS', result.reasons[0].code, 'HANDOFF_ALREADY_EXISTS');
}
{
  // A prior handoff for a DIFFERENT verified execution (different iaosVerifiedAt) does not block a new one.
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({
    existingHandoffsForOpportunity: [{ agreementAt: AGREEMENT_AT, version: V1, underContractVerifiedAt: '2099-01-01T00:00:00.000Z' }],
  }));
  checkTrue('a prior handoff for a DIFFERENT verified execution does not block a new one', result.eligible);
}
checkNull('parse: unrelated text is rejected (malformed evidence fails closed)', HC.parseDispositionHandoffNote('not a handoff note'));
checkNull('parse: empty string is rejected', HC.parseDispositionHandoffNote(''));

/* ====================================================================== */
/* 4. Property/economics/ARV/repairs/contract terms reuse authoritative   */
/*    sources; provenance is retained                                    */
/* ====================================================================== */

{
  const handoff = validHandoffFixture({});
  check('sellerContractPrice is copied verbatim from the supplied authoritative value', handoff.sellerContractPrice, 190000);
  check('approvedArv is copied verbatim, including its evidence-state provenance', handoff.approvedArv, approvedArvFixture({}));
  check('approvedRepairs is copied verbatim', handoff.approvedRepairs, 25000);
  check('propertyAddress carries the authoritative FieldDisposition envelope, including authority', handoff.propertyAddress.kind, 'populated');
  check('propertyLegalDescription is copied verbatim, field for field', handoff.propertyLegalDescription, propertyLegalDescriptionFixture());
  check('requiredSigners is copied verbatim from the already-assembled required signer set', handoff.requiredSigners, requiredSignersFixture());
  check('verifiedSigners is copied verbatim from the Under Contract record itself, never recomputed', handoff.verifiedSigners, underContractFixture({}).signers);
  check('the underContract section is copied verbatim from the Under Contract record\'s own fields', handoff.underContract.artifactSha256, underContractFixture({}).artifactSha256);
}

/* ====================================================================== */
/* 5. Missing optional data is disclosed, never fabricated                */
/* ====================================================================== */

{
  const handoff = validHandoffFixture({ closingDate: unresolved(), possessionDetails: unresolved(), sellerContact: { noticeAddress: unresolved(), noticePhone: unresolved(), noticeEmail: unresolved() } });
  check('a missing closing date is honestly disclosed as unresolved, never fabricated', handoff.closingDate, unresolved());
  check('missing possession details are honestly disclosed as unresolved', handoff.possessionDetails, unresolved());
  check('missing seller contact info is honestly disclosed as unresolved', handoff.sellerContact.noticeAddress, unresolved());
}
{
  const handoff = validHandoffFixture({});
  check('access/showing information, for which no upstream carrier exists, is honestly disclosed as unresolved -- never a fabricated instruction', handoff.accessShowingInformation, unresolved());
}
{
  checkFalse('the essential-fields build does not require closingDate to be populated -- it is optional', H.buildDispositionHandoffRecordArgs(baseBuildArgs({ closingDate: unresolved() })).ok === false);
}

/* ====================================================================== */
/* 6. Missing essential data blocks                                       */
/* ====================================================================== */

{
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs({ propertyAddress: unresolved() }));
  checkFalse('a missing property address (essential to identify the deal) blocks handoff creation', built.ok);
  check('failure names PROPERTY_ADDRESS_MISSING', built.reasons[0].code, 'PROPERTY_ADDRESS_MISSING');
}
{
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs({ sellerContractPrice: null }));
  checkFalse('a missing seller contract price blocks handoff creation', built.ok);
  check('failure names SELLER_CONTRACT_PRICE_MISSING', built.reasons[0].code, 'SELLER_CONTRACT_PRICE_MISSING');
}
{
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs({ approvedArv: null }));
  checkFalse('missing approved ARV blocks handoff creation', built.ok);
  check('failure names APPROVED_ARV_MISSING', built.reasons[0].code, 'APPROVED_ARV_MISSING');
}
{
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs({ approvedRepairs: null }));
  checkFalse('missing approved repairs blocks handoff creation', built.ok);
  check('failure names APPROVED_REPAIRS_MISSING', built.reasons[0].code, 'APPROVED_REPAIRS_MISSING');
}
{
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs({ requiredSigners: [] }));
  checkFalse('zero required signers blocks handoff creation -- essential to identify the executed contract', built.ok);
  check('failure names REQUIRED_SIGNERS_EMPTY', built.reasons[0].code, 'REQUIRED_SIGNERS_EMPTY');
}
{
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs({ handoffId: '' }));
  checkFalse('a blank handoffId fails closed', built.ok);
}
{
  const built = H.buildDispositionHandoffRecordArgs(baseBuildArgs({ agreementAt: '2099-01-01T00:00:00.000Z' }));
  checkFalse('a mismatched Agreement Reached identity vs version.agreementAt fails closed', built.ok);
  checkTrue('failure names AGREEMENT_VERSION_MISMATCH', built.reasons.some((r) => r.code === 'AGREEMENT_VERSION_MISMATCH'));
}

/* ====================================================================== */
/* 7. Zero, one, and multiple available photo/document references         */
/* ====================================================================== */

{
  const handoff = validHandoffFixture({ documentReferences: [] });
  check('zero document references round-trips correctly', handoff.documentReferences, []);
}
{
  const one = [{ label: 'Front exterior photo', kind: 'photo', reference: 'https://example.invalid/photo1.jpg', note: null }];
  const handoff = validHandoffFixture({ documentReferences: one });
  check('one document reference round-trips correctly', handoff.documentReferences, one);
}
{
  const many = [
    { label: 'Front exterior photo', kind: 'photo', reference: 'ref-1', note: null },
    { label: 'Kitchen photo', kind: 'photo', reference: 'ref-2', note: 'taken at listing' },
    { label: 'Inspection report', kind: 'document', reference: 'ref-3', note: null },
  ];
  const handoff = validHandoffFixture({ documentReferences: many });
  check('multiple document references round-trip correctly, in order', handoff.documentReferences, many);
}
{
  const note = HC.formatDispositionHandoffNote(validHandoffFixture({ documentReferences: [] }));
  const parsed = HC.parseDispositionHandoffNote(note);
  check('an empty document reference list survives the carrier round-trip', parsed.documentReferences, []);
}

/* ====================================================================== */
/* 8. Duplicate handoff refusal (already covered above, restated for the  */
/*    proof list's own wording)                                          */
/* ====================================================================== */

{
  const handoff = validHandoffFixture({});
  const result = H.evaluateDispositionHandoffEligibility(baseEligibilityArgs({
    existingHandoffsForOpportunity: [{ agreementAt: handoff.agreementAt, version: handoff.version, underContractVerifiedAt: handoff.underContract.verifiedAt }],
  }));
  checkFalse('duplicate execution cannot produce a second eligible handoff', result.eligible);
}

/* ====================================================================== */
/* 9. Carrier round-trip and every rejection case                         */
/* ====================================================================== */

{
  const handoff = validHandoffFixture({});
  const note = HC.formatDispositionHandoffNote(handoff);
  const parsed = HC.parseDispositionHandoffNote(note);
  checkTrue('the handoff note round-trips to a non-null record', parsed !== null);
  check('round-trip is byte-for-byte field-equal to the original', JSON.stringify(parsed), JSON.stringify(handoff));
}
{
  const note = HC.formatDispositionHandoffNote(validHandoffFixture({}));
  const lines = note.split('\n');
  const agreementIdx = lines.findIndex((l) => l.startsWith('Agreement Reached at: '));
  lines[agreementIdx] = 'Agreement Reached at: 2099-01-01T00:00:00.000Z';
  checkNull('parse: a mixed-version record is rejected', HC.parseDispositionHandoffNote(lines.join('\n')));
}
{
  const note = HC.formatDispositionHandoffNote(validHandoffFixture({}));
  const lines = note.split('\n');
  const shaIdx = lines.findIndex((l) => l.startsWith('Artifact SHA-256: '));
  lines[shaIdx] = 'Artifact SHA-256: not-a-real-hash';
  checkNull('parse: a malformed artifact SHA-256 is rejected', HC.parseDispositionHandoffNote(lines.join('\n')));
}
{
  const note = HC.formatDispositionHandoffNote(validHandoffFixture({}));
  const lines = note.split('\n');
  const signersIdx = lines.findIndex((l) => l.startsWith('Required signers: '));
  lines[signersIdx] = 'Required signers: []';
  checkNull('parse: an empty Required signers array is rejected', HC.parseDispositionHandoffNote(lines.join('\n')));
}
{
  const note = HC.formatDispositionHandoffNote(validHandoffFixture({}));
  const lines = note.split('\n');
  const priceIdx = lines.findIndex((l) => l.startsWith('Seller contract price: '));
  lines[priceIdx] = 'Seller contract price: not-a-number';
  checkNull('parse: a non-numeric seller contract price is rejected', HC.parseDispositionHandoffNote(lines.join('\n')));
}
{
  const note = HC.formatDispositionHandoffNote(validHandoffFixture({}));
  const lines = note.split('\n');
  const arvIdx = lines.findIndex((l) => l.startsWith('Approved ARV: '));
  lines[arvIdx] = 'Approved ARV: {"amount":250000,"approvalEvidenceState":"NOT_A_REAL_STATE","approvalDecision":"APPROVED","approvedAt":null}';
  checkNull('parse: an invalid ARV evidence state is rejected', HC.parseDispositionHandoffNote(lines.join('\n')));
}
{
  const note = HC.formatDispositionHandoffNote(validHandoffFixture({}));
  const lines = note.split('\n');
  const propIdx = lines.findIndex((l) => l.startsWith('Property address: '));
  lines[propIdx] = 'Property address: {"kind":"not-a-real-kind"}';
  checkNull('parse: a malformed FieldDisposition envelope (bad kind) is rejected', HC.parseDispositionHandoffNote(lines.join('\n')));
}
checkNull('parse: correct header but wrong line count is rejected', HC.parseDispositionHandoffNote('IAOS DISPOSITION HANDOFF — iaos-disposition-handoff-v1\nHandoff id: x'));
{
  const handoffA = validHandoffFixture({ handoffId: 'handoff-a' });
  const handoffB = validHandoffFixture({ handoffId: 'handoff-b', createdAt: '2026-09-13T10:00:00.000Z' });
  const notes = [{ body: HC.formatDispositionHandoffNote(handoffA) }, { body: HC.formatDispositionHandoffNote(handoffB) }];
  const all = HC.allDispositionHandoffsForOpportunity(notes, OPP);
  check('append-only reader returns BOTH handoffs, unfiltered -- neither is ever overwritten', all.length, 2);
}
{
  const different = validHandoffFixture({ opportunityId: 'opp-OTHER' });
  const notes = [{ body: HC.formatDispositionHandoffNote(different) }];
  check('append-only reader scopes strictly to the requested opportunityId', HC.allDispositionHandoffsForOpportunity(notes, OPP).length, 0);
}

/* ====================================================================== */
/* 10. No buyer outreach, ranking, assignment agreement, stage/tag/       */
/*     workflow, title/closing, or Production mutation exists (static     */
/*     scan)                                                              */
/* ====================================================================== */

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

{
  const modelSource = stripComments(fs.readFileSync(path.join(LIB, 'contract-disposition-handoff-model.ts'), 'utf8'));
  const carrierSource = stripComments(fs.readFileSync(path.join(LIB, 'contract-disposition-handoff-carriers.ts'), 'utf8'));
  const combined = modelSource + '\n' + carrierSource;
  checkFalse('no ghl.notes.create call anywhere in the new INV-66 source (comments stripped)', /ghl\.notes\.create/.test(combined));
  checkFalse('no import of the ghl client module at all -- this module cannot reach GHL even indirectly', /from ["']\.\/ghl["']/.test(combined));
  checkFalse('no fetch(...) call anywhere in the new INV-66 source', /\bfetch\s*\(/.test(combined));
  checkFalse('no reference to buyer outreach/ranking/assignment concepts (comments stripped)', /buyer.{0,20}(rank|select|outreach|contact)/i.test(combined));
  checkFalse('no reference to assignment agreement drafting (comments stripped)', /assignment agreement/i.test(combined));
  checkFalse('no reference to a GHL pipeline stage move', /pipelineStageId|pipeline_stage|Seller Closed-Won/.test(combined));
  checkFalse('no reference to firing a workflow (comments stripped)', /fireWorkflow|workflow.{0,10}trigger/i.test(combined));
  checkFalse('no reference to adding a tag', /addTag|\.tags\.(add|create)/i.test(combined));
  checkFalse('no reference to title or closing coordination (comments stripped)', /title company|closing agent|escrow/i.test(combined));
  checkFalse('no Production location id literal', /jmHG4B8RdzwpfqruNf68/.test(combined));
}

/* ====================================================================== */
/* 11. Jess Gate correction, 2026-09-13 -- exactly ONE canonical          */
/*     "Disposition Handoff" / "Start Disposition" authority exists.      */
/*     board9-contract-model.ts's older, broader four-terminal-state      */
/*     payload was renamed to TerminalOutcomePayload/                     */
/*     buildTerminalOutcomePayload -- no competing DispositionHandoff-    */
/*     named authority remains anywhere, and the Board #10 handoff        */
/*     structurally cannot be produced from a rescinded/expired/declined  */
/*     outcome.                                                           */
/* ====================================================================== */

{
  checkFalse('board9-contract-model.ts no longer exports a function named buildDispositionHandoffPayload', typeof B.buildDispositionHandoffPayload === 'function');
  checkTrue('board9-contract-model.ts exports the RENAMED buildTerminalOutcomePayload instead', typeof B.buildTerminalOutcomePayload === 'function');
}
{
  // A full source-tree search (not just this module's own two files) for
  // the old, now-ambiguous names -- a pure-Node recursive walk (never
  // shells out to `grep`, which is not portable to this script's own
  // Windows execSync default shell) so this proof is self-contained.
  const OLD_NAMES_PATTERN = /DispositionHandoffPayload|buildDispositionHandoffPayload|BuildHandoffArgs\b|isHandoffAgreementConsistent|HANDOFF_AGREEMENT_VERSION_MISMATCH|HANDOFF_VERSION_DOES_NOT_MATCH_VALIDATED_EXECUTION/;
  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.tmp')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|cjs|js)$/.test(entry.name)) out.push(full);
    }
  }
  const allFiles = [];
  walk(path.join(APP, 'src'), allFiles);
  walk(path.join(APP, 'scripts'), allFiles);
  const remainingFiles = allFiles
    .filter((f) => OLD_NAMES_PATTERN.test(fs.readFileSync(f, 'utf8')))
    // The one file allowed to still mention the OLD names is board9-contract-model.ts itself, and ONLY inside its own historical-naming explanation comment -- checked precisely below, not exempted wholesale here.
    // board9-contract-model.ts: exempted, checked precisely below instead.
    // This test file itself: exempted -- it necessarily names the old
    // tokens in its own search pattern/prose, never as a real reference.
    .filter((f) => path.basename(f) !== 'board9-contract-model.ts' && path.basename(f) !== 'test-contract-disposition-handoff.cjs')
    .map((f) => path.relative(APP, f));
  check('a full app/src + app/scripts search finds the old DispositionHandoffPayload/buildDispositionHandoffPayload/BuildHandoffArgs/isHandoffAgreementConsistent/HANDOFF_* names in NO file except board9-contract-model.ts itself', remainingFiles, []);
}
{
  const modelSource = fs.readFileSync(path.join(LIB, 'board9-contract-model.ts'), 'utf8');
  const liveCodeOccurrences = (stripComments(modelSource).match(/DispositionHandoffPayload|buildDispositionHandoffPayload|BuildHandoffArgs\b|isHandoffAgreementConsistent|HANDOFF_AGREEMENT_VERSION_MISMATCH|HANDOFF_VERSION_DOES_NOT_MATCH_VALIDATED_EXECUTION/g) || []).length;
  check('board9-contract-model.ts\'s own LIVE CODE (comments stripped) contains zero occurrences of the old names -- only its own historical-naming prose comment may still mention them', liveCodeOccurrences, 0);
}
{
  checkTrue('evaluateDispositionHandoffEligibility requires a genuinely-typed UnderContractRecordEntry -- its own source never references the literal terminal-state strings "rescinded"/"expired"/"declined" at all, so it structurally cannot special-case or accept one', (() => {
    const src = stripComments(fs.readFileSync(path.join(LIB, 'contract-disposition-handoff-model.ts'), 'utf8'));
    return !/["']rescinded["']|["']expired["']|["']declined["']/.test(src);
  })());
}
{
  // Direct proof: eligibility is false for EVERY possible non-null, non-UnderContractRecordEntry input this function's own type signature could ever be handed by a caller that (incorrectly) tried to pass a terminal-outcome-shaped value instead -- since the type system itself refuses anything but a real UnderContractRecordEntry, the only runtime-observable case is `null`, already proven UNDER_CONTRACT_MISSING above. This check confirms the FUNCTION SIGNATURE'S OWN PARAMETER NAME says `underContract`, never `terminalOutcome`/`payload`, so no caller could pass a TerminalOutcomePayload under a plausible-looking key name either.
  const src = fs.readFileSync(path.join(LIB, 'contract-disposition-handoff-model.ts'), 'utf8');
  checkTrue('evaluateDispositionHandoffEligibility\'s own parameter is explicitly typed UnderContractRecordEntry | null, never a broader terminal-outcome union', /underContract: UnderContractRecordEntry \| null/.test(src));
}

/* ====================================================================== */
/* Summary                                                                 */
/* ====================================================================== */

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
console.log('No contract send, provider mutation, network call, or GHL/Production write occurred in this run -- every fixture above is an in-memory object.');
cleanup();
process.exit(failures === 0 ? 0 : 1);
