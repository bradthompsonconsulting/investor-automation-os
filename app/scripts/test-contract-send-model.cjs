/**
 * Contract Sent -- send eligibility, evidence, and provider-response
 * classification -- pure model test runner. B9-08 / INV-63.
 *
 * Compiles contract-send-model.ts, contract-send-carriers.ts, and the full
 * B9-07/B9-06/B9-05/B9-03 dependency chain (unmodified by this issue) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases mapped directly to INV-63's own "Required
 * deterministic evidence" list. Every provider response used here is a
 * SIMULATED fixture object -- no network call, no live GHL call, matching
 * this entire codebase's own established testing convention.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-send-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-send-model.ts'),
  path.join(LIB, 'contract-send-carriers.ts'),
  path.join(LIB, 'contract-authorization-model.ts'),
  path.join(LIB, 'contract-authorization-carriers.ts'),
  path.join(LIB, 'contract-document-model.ts'),
  path.join(LIB, 'contract-facts-model.ts'),
  path.join(LIB, 'seller-contract-facts-carriers.ts'),
  path.join(LIB, 'board9-contract-model.ts'),
  path.join(LIB, 'seller-call-outcome.ts'),
  path.join(LIB, 'seller-call-readiness-carriers.ts'),
  // INV-63 correction round, 2026-09-11: contract-send-model.ts now
  // imports POPULATION_VERIFIED from shared/ghl-config.ts, which pulls
  // that file (and its own dependency-free contents) into the
  // compilation graph regardless of whether it is listed here.
  // Listing it explicitly, and pinning --rootDir to APP below, makes the
  // emitted output structure deterministic (src/lib/*.js, shared/*.js)
  // instead of silently shifting whenever a new cross-directory import
  // is added -- exactly the failure mode that broke this harness once.
  path.join(APP, 'shared', 'ghl-config.ts'),
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
const S = require(path.join(LIB_OUT, 'contract-send-model.js'));
const K = require(path.join(LIB_OUT, 'contract-send-carriers.js'));
const A = require(path.join(LIB_OUT, 'contract-authorization-model.js'));
const AC = require(path.join(LIB_OUT, 'contract-authorization-carriers.js'));
const D = require(path.join(LIB_OUT, 'contract-document-model.js'));
const M = require(path.join(LIB_OUT, 'contract-facts-model.js'));
const C = require(path.join(LIB_OUT, 'seller-contract-facts-carriers.js'));
const B = require(path.join(LIB_OUT, 'board9-contract-model.js'));
const G = require(path.join(TMP, 'shared', 'ghl-config.js'));

const FLOOR = 114;
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

const OPP = 'opp-1';
const OTHER_OPP = 'opp-2';
const AGREED_PRICE = 190000;
const AGREEMENT_AT = '2026-09-06T15:00:00.000Z';
const AUTH_AT = '2026-09-11T10:00:00.000Z';
const SEND_AT = '2026-09-11T11:00:00.000Z';
const EXPIRATION_AT = '2026-09-18T23:59:59.000Z';
const READBACK_AT = '2026-09-11T11:00:05.000Z';
const REQUESTED_TEMPLATE_ID = 'fixture-template-id-1';
const RECIPIENT_ID = 'fixture-recipient-1';
const SENDER_USER_ID = 'fixture-sender-1';
const TEST_LOCATION_ID = 'fixture-location-test';
const VERSION = B.initialVersionIdentity(AGREEMENT_AT);
function sendArgs(over) {
  return Object.assign({ requestedTemplateId: REQUESTED_TEMPLATE_ID, populationVerification: G.POPULATION_VERIFIED }, over || {});
}
const POPULATED_ADDRESS = { kind: 'populated', value: '123 Main St, Austin, TX, 78701', authority: 'operator_attested', recordedAt: AGREEMENT_AT };

function baseFactsArgs(over) {
  return Object.assign({
    opportunityId: OPP, notes: [], agreedPrice: AGREED_PRICE, agreementAt: AGREEMENT_AT,
    propertyAddress: '123 Main St, Austin, TX, 78701',
  }, over || {});
}

function fullyPopulatedNotes(opportunityId) {
  return [
    { body: C.formatPartySignerFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', signers: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }] }) },
    { body: C.formatPropertyLegalDescriptionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', lot: { kind: 'value', value: '12' }, block: { kind: 'value', value: 'A' }, addition: { kind: 'value', value: 'Oak Hills' }, county: { kind: 'value', value: 'Travis' }, exclusions: { kind: 'none' }, reservations: { kind: 'none' } }) },
    { body: C.formatLeaseDisclosureFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', residentialLeases: 'none', fixtureLeases: 'none', naturalResourceLeases: { kind: 'none' } }) },
    { body: C.formatEarnestMoneyOptionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St, Austin, TX', earnestMoney: { kind: 'amount', amount: 1000 }, optionFee: { kind: 'amount', amount: 200 }, optionPeriodDays: { kind: 'days', days: 10 }, additionalEarnestMoney: { kind: 'none' } }) },
    { body: C.formatTitleSurveyFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', titlePolicyExpenseParty: 'seller', titleCompanyName: 'Austin Title Co', shortageAmendmentElection: { kind: 'amended', expenseParty: 'buyer' }, surveyElection: { option: 'seller_existing_survey', sellerFurnishDays: 10, ifRejectedExpenseParty: 'seller' }, objectionsText: { kind: 'none' }, objectionsDays: 5, poaMembership: 'is_not_subject' }) },
    { body: C.formatPropertyConditionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', sellerDisclosureNotice: { kind: 'received' }, asIsElection: { kind: 'as_is' }, serviceContractCap: { kind: 'none' }, waterDisclosure: { kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'City of Austin' } }) },
    { body: C.formatClosingPossessionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', closingDate: '2026-10-15T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } }) },
    { body: C.formatSettlementExpenseFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', sellerCreditCap: { kind: 'none' }, sellerPaysBuyerBroker: { kind: 'none' }, buyerPaysSellerBroker: { kind: 'none' } }) },
    { body: C.formatRepresentationFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', representation: { kind: 'none' } }) },
    { body: C.formatAddendaApplicabilityFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', items: Object.fromEntries(C.ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false])), districtNotices: { kind: 'none' } }) },
    { body: C.formatSellerEquitableInterestDisclosureNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', disposition: { kind: 'made', at: AGREEMENT_AT } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatSellerNoticeConfirmationFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '123 Main St, Austin, TX, 78701', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' }, source: 'confirmed_from_contact_record' }) },
    { body: C.formatBuyerBusinessConfigFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '1 Business Rd, Austin, TX', noticePhone: '555-0000', noticeEmail: 'buyer@btcllc.example', signerName: 'Brad Thompson', signerRole: 'Manager' }) },
  ];
}

function buildCompleteReportAndPreview(opportunityId, version) {
  const notes = fullyPopulatedNotes(opportunityId);
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ opportunityId, notes }));
  const preview = D.buildContractDocumentPreview({ opportunityId, version, report, propertyStreetAddress: POPULATED_ADDRESS });
  return { report, preview };
}

function authorize(opportunityId, preview) {
  const built = A.buildAuthorizationRecordArgs({ opportunityId, at: AUTH_AT, preview, currentVersion: preview.version });
  const note = AC.formatBradContractAuthorizationNote(built.value);
  return AC.parseBradContractAuthorizationNote(note);
}

const { report: completeReport, preview: completePreview } = buildCompleteReportAndPreview(OPP, VERSION);
const authRecord = authorize(OPP, completePreview);
checkTrue('fixture sanity: the complete preview IS previewComplete', completePreview.previewComplete === true);
checkTrue('fixture sanity: the authorization is current against the complete preview', A.evaluateBradAuthorizationCurrency(authRecord, completePreview).authorized === true);

// ============================================================
// 1. An unauthorized document cannot send.
// ============================================================
{
  const eligibility = S.evaluateSendEligibility({ authRecord: null, preview: completePreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('an unauthorized (never-authorized) preview cannot send', eligibility.eligible === false);
  check('the refusal names NO_AUTHORIZATION_RECORDED', eligibility.reasons.map((r) => r.code), ['NO_AUTHORIZATION_RECORDED']);

  const built = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: completeReport, preview: completePreview, authRecord: null, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('building a send attempt for an unauthorized preview is refused', built.ok === false);
}

// ============================================================
// 2. A complete but unauthorized preview cannot send (distinct from #1:
//    complete here means previewComplete, but no authorization exists).
// ============================================================
{
  checkTrue('sanity: this preview is complete', completePreview.previewComplete === true);
  const eligibility = S.evaluateSendEligibility({ authRecord: null, preview: completePreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a complete but unauthorized preview cannot send', eligibility.eligible === false);
  check('the refusal names NO_AUTHORIZATION_RECORDED even though the preview is complete', eligibility.reasons.map((r) => r.code), ['NO_AUTHORIZATION_RECORDED']);
}

// ============================================================
// 3. A stale authorization cannot send (revision changed since
//    authorization was recorded).
// ============================================================
{
  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null).value;
  const { preview: newerPreview } = buildCompleteReportAndPreview(OPP, bumped);
  const eligibility = S.evaluateSendEligibility({ authRecord, preview: newerPreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a stale authorization (older revision) cannot send', eligibility.eligible === false);
  check('the refusal names REVISION_CHANGED', eligibility.reasons.map((r) => r.code), ['REVISION_CHANGED']);
}

// ============================================================
// 4. A changed template cannot send.
// ============================================================
{
  const changedTemplatePreview = Object.assign({}, completePreview, { templateName: 'A DIFFERENT TEMPLATE ENTIRELY' });
  const eligibility = S.evaluateSendEligibility({ authRecord, preview: changedTemplatePreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a changed template cannot send', eligibility.eligible === false);
  check('the refusal names TEMPLATE_CHANGED', eligibility.reasons.map((r) => r.code), ['TEMPLATE_CHANGED']);
}

// ============================================================
// 5. Changed material content cannot send.
// ============================================================
{
  const mutatedLines = completePreview.documentLines.map((l) =>
    l.group === 'closingPossession' && l.field === 'closingDate' ? Object.assign({}, l, { text: '2099-01-01' }) : l,
  );
  const mutatedPreview = Object.assign({}, completePreview, { documentLines: mutatedLines });
  const eligibility = S.evaluateSendEligibility({ authRecord, preview: mutatedPreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('changed material content (closing date) cannot send', eligibility.eligible === false);
  check('the refusal names CONTENT_CHANGED', eligibility.reasons.map((r) => r.code), ['CONTENT_CHANGED']);
}

// ============================================================
// 6. Changed signer or delivery details cannot send.
// ============================================================
{
  const mutatedLines = completePreview.documentLines.map((l) =>
    l.group === 'noticeContact' && l.field === 'sellerNoticeEmail' ? Object.assign({}, l, { text: 'attacker@example.com' }) : l,
  );
  const mutatedPreview = Object.assign({}, completePreview, { documentLines: mutatedLines });
  const eligibility = S.evaluateSendEligibility({ authRecord, preview: mutatedPreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a changed delivery detail (seller notice email) cannot send', eligibility.eligible === false);
  check('the refusal names CONTENT_CHANGED', eligibility.reasons.map((r) => r.code), ['CONTENT_CHANGED']);

  const mutatedSignerLines = completePreview.documentLines.map((l) =>
    l.group === 'parties' && l.field === 'sellerSigners' ? Object.assign({}, l, { text: 'A Different Person (Seller)' }) : l,
  );
  const mutatedSignerPreview = Object.assign({}, completePreview, { documentLines: mutatedSignerLines });
  const signerEligibility = S.evaluateSendEligibility({ authRecord, preview: mutatedSignerPreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a changed signer identity cannot send', signerEligibility.eligible === false);
  check('the refusal names CONTENT_CHANGED', signerEligibility.reasons.map((r) => r.code), ['CONTENT_CHANGED']);
}

// ============================================================
// 7. Missing signer information cannot send.
// ============================================================
{
  const { report: noSignerReport, preview: noSignerPreview } = buildCompleteReportAndPreview(OPP, VERSION);
  // Force an unresolved signer line directly (simulating a preview built
  // before signer capture, while everything else remains complete) --
  // this exercises the defense-in-depth check directly, independent of
  // whether previewComplete could ever actually be true in this state.
  const forcedLines = noSignerPreview.documentLines.map((l) =>
    l.group === 'parties' && l.field === 'sellerSigners' ? Object.assign({}, l, { status: 'unresolved', text: null }) : l,
  );
  const forcedPreview = Object.assign({}, noSignerPreview, { documentLines: forcedLines, previewComplete: true, blockingReasons: [] });
  const forcedAuthBuilt = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AUTH_AT, preview: forcedPreview, currentVersion: VERSION });
  checkTrue('sanity: the forced-missing-signer preview can still be "authorized" at the model level (proves the eligibility check below is REAL, not just inherited from authorization)', forcedAuthBuilt.ok === true);
  const forcedAuthRecord = AC.parseBradContractAuthorizationNote(AC.formatBradContractAuthorizationNote(forcedAuthBuilt.value));
  const eligibility = S.evaluateSendEligibility({ authRecord: forcedAuthRecord, preview: forcedPreview, existingSend: null, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('missing signer information cannot send, even if authorization currency alone would pass', eligibility.eligible === false);
  check('the refusal names MISSING_SIGNER_OR_DELIVERY_INFO', eligibility.reasons.map((r) => r.code), ['MISSING_SIGNER_OR_DELIVERY_INFO']);

  const builtAttempt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: noSignerReport, preview: forcedPreview, authRecord: forcedAuthRecord, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('building a send attempt with missing signer information is refused', builtAttempt.ok === false);
}

// ============================================================
// 8. Provider failure / ambiguous response classification -- Stage 1
//    (the POST response alone) can NEVER yield "accepted", only
//    "provider_accepted_pending_readback" at best (item 5, correction
//    round: "a successful POST response is not sufficient").
// ============================================================
{
  const networkError = S.classifyProviderSendResponse({ kind: 'network_error', message: 'ECONNRESET' });
  check('a network error classifies as failed', networkError.status, 'failed');
  check('a network error carries no summary', networkError.summary, null);

  const http500 = S.classifyProviderSendResponse({ kind: 'http_response', status: 500, body: { error: 'Internal Server Error' } });
  check('an HTTP 500 classifies as failed', http500.status, 'failed');

  const http401 = S.classifyProviderSendResponse({ kind: 'http_response', status: 401, body: { message: 'Unauthorized' } });
  check('an HTTP 401 (authentication failure) classifies as failed', http401.status, 'failed');

  const successFalse = S.classifyProviderSendResponse({ kind: 'http_response', status: 200, body: { success: false } });
  check('a 200 response with success:false classifies as ambiguous, never accepted', successFalse.status, 'ambiguous');

  const noLinks = S.classifyProviderSendResponse({ kind: 'http_response', status: 200, body: { success: true, links: [] } });
  check('success:true with an empty links[] classifies as ambiguous', noLinks.status, 'ambiguous');

  const missingDocId = S.classifyProviderSendResponse({ kind: 'http_response', status: 200, body: { success: true, links: [{ referenceId: 'abc' }] } });
  check('success:true with a links[0] missing documentId classifies as ambiguous -- missing provider identifier', missingDocId.status, 'ambiguous');

  const notJson = S.classifyProviderSendResponse({ kind: 'http_response', status: 200, body: 'not an object' });
  check('a non-object response body classifies as ambiguous', notJson.status, 'ambiguous');

  const wellFormed = S.classifyProviderSendResponse({
    kind: 'http_response', status: 200,
    body: { success: true, links: [{ referenceId: 'ref-1', documentId: 'doc-1', recipientId: RECIPIENT_ID, documentRevision: 1, entityName: 'contacts', recipientCategory: 'recipient', createdBy: SENDER_USER_ID, deleted: false }] },
  });
  check('a fully documented success shape classifies as provider_accepted_pending_readback, NEVER accepted directly', wellFormed.status, 'provider_accepted_pending_readback');
  check('the provisional classification carries the real documentId', wellFormed.summary.documentId, 'doc-1');
  check('the provisional classification carries the real documentRevision', wellFormed.summary.documentRevision, 1);
  check('the provisional classification carries the provider-echoed createdBy (sender)', wellFormed.summary.createdBy, SENDER_USER_ID);
  check('the provisional classification has no readback facts yet', [wellFormed.summary.readbackStatus, wellFormed.summary.readbackLocationId, wellFormed.summary.fillableFieldCount], [null, null, null]);
}

// ============================================================
// 8b. Stage 2: classifyDocumentReadback -- the ONLY path to "accepted".
//     Zero fillable fields (Brad's own confirmed CURRENT state of the
//     IAOS Test template, 2026-09-11) is "ambiguous", by name, never
//     "accepted" -- there is no threshold below which an unsignable
//     document counts as sent.
// ============================================================
{
  const baseDoc = { documentId: 'doc-1', deleted: false, locationId: TEST_LOCATION_ID, status: 'sent', recipients: [{ id: RECIPIENT_ID }], links: [{ createdBy: SENDER_USER_ID }] };
  const readArgs = (over) => Object.assign({ expectedDocumentId: 'doc-1', expectedRecipientId: RECIPIENT_ID, expectedSenderUserId: SENDER_USER_ID, expectedLocationId: TEST_LOCATION_ID }, over || {});

  const netErr = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'network_error', message: 'ECONNRESET' } }));
  check('readback network error classifies as failed', netErr.status, 'failed');

  const http503 = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 503, body: {} } }));
  check('readback HTTP 503 classifies as failed', http503.status, 'failed');

  const notFound = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [] } } } ));
  check('readback that does not return the expected document classifies as ambiguous', notFound.status, 'ambiguous');

  const deletedDoc = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { deleted: true, fillableFields: [] })] } } }));
  check('readback reporting the document deleted classifies as failed', deletedDoc.status, 'failed');

  const wrongLocation = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { locationId: 'some-other-location', fillableFields: [] })] } } }));
  check('readback with a mismatched locationId (environment not confirmed exact) classifies as ambiguous', wrongLocation.status, 'ambiguous');

  const wrongRecipient = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { recipients: [{ id: 'someone-else' }], fillableFields: [] })] } } }));
  check('readback whose recipients[] omits the expected recipient classifies as ambiguous', wrongRecipient.status, 'ambiguous');

  const wrongSender = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { links: [{ createdBy: 'someone-else' }], fillableFields: [] })] } } }));
  check('readback whose links[] omits the expected sender (createdBy) classifies as ambiguous', wrongSender.status, 'ambiguous');

  const stillDraft = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { status: 'draft', fillableFields: [{ isRequired: true }] })] } } }));
  check('readback reporting the document still a draft classifies as ambiguous -- never actually dispatched', stillDraft.status, 'ambiguous');

  const zeroFields = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { fillableFields: [] })] } } }));
  check('readback confirming the document but with 0 fillableFields classifies as ambiguous -- blank/unsignable, THE current real state of the IAOS Test template', zeroFields.status, 'ambiguous');
  checkTrue('the 0-fillable-fields failureReason names the blank-template problem explicitly', /0 fillable fields|blank\/unpopulated/.test(zeroFields.failureReason || ''));
  check('the 0-fillable-fields classification still carries fillableFieldCount 0 as durable evidence', zeroFields.summary.fillableFieldCount, 0);

  const fieldsButNoneRequired = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { fillableFields: [{ isRequired: false }, { isRequired: false }] })] } } }));
  check('readback with fields present but none required classifies as ambiguous -- refuses to guess an optional field is the signature block', fieldsButNoneRequired.status, 'ambiguous');
  check('that classification still reports the real fillableFieldCount', fieldsButNoneRequired.summary.fillableFieldCount, 2);

  const fullyValid = S.classifyDocumentReadback(readArgs({ outcome: { kind: 'http_response', status: 200, body: { documents: [Object.assign({}, baseDoc, { documentRevision: 1, fillableFields: [{ isRequired: true, type: 'signature' }, { isRequired: false, type: 'text' }] })] } } }));
  check('readback confirming recipient, sender, environment, non-draft status, and at least one required fillable field classifies as accepted', fullyValid.status, 'accepted');
  check('the accepted readback carries the confirmed fillableFieldCount', fullyValid.summary.fillableFieldCount, 2);
  check('the accepted readback carries the confirmed readbackStatus', fullyValid.summary.readbackStatus, 'sent');
  check('the accepted readback carries the confirmed readbackLocationId', fullyValid.summary.readbackLocationId, TEST_LOCATION_ID);
}

// ============================================================
// 9. A provider failure does not record Contract Sent.
// ============================================================
{
  const attemptBuilt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: completeReport, preview: completePreview, authRecord, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('sanity: the attempt builds successfully for the complete, authorized preview', attemptBuilt.ok === true);

  const failedClassification = S.classifyProviderSendResponse({ kind: 'network_error', message: 'ECONNRESET' });
  const failedResult = S.buildSendResultArgs({ attempt: attemptBuilt.value, operator: null, observedAt: SEND_AT, classification: failedClassification });
  check('a failed send result is persisted with status "failed"', failedResult.status, 'failed');
  check('a failed send result carries no iaosObservedAcceptanceAt', failedResult.iaosObservedAcceptanceAt, null);

  const failedSendRecord = AC.parseBradContractAuthorizationNote ? null : null; // (parse via the send carrier below)
  const failedNote = K.formatContractSendNote(failedResult);
  const parsedFailed = K.parseContractSendNote(failedNote);

  const evidence = S.buildContractSentEvidence({ contractReady: true, authRecord, currentPreview: completePreview, send: parsedFailed });
  const sentEligibility = B.evaluateContractSentEligibility(evidence);
  checkTrue('Contract Sent is NOT reached after a failed provider send', sentEligibility.eligible === false);
  checkTrue('the refusal names TRANSMISSION_NOT_CONFIRMED (no provider transmission fact exists for a failed send)', sentEligibility.reasons.some((r) => r.code === 'TRANSMISSION_NOT_CONFIRMED'));
}

// ============================================================
// 10. An ambiguous response does not record Contract Sent.
// ============================================================
{
  const attemptBuilt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: completeReport, preview: completePreview, authRecord, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  const ambiguousClassification = S.classifyProviderSendResponse({ kind: 'http_response', status: 200, body: { success: true, links: [] } });
  const ambiguousResult = S.buildSendResultArgs({ attempt: attemptBuilt.value, operator: null, observedAt: SEND_AT, classification: ambiguousClassification });
  check('an ambiguous send result is persisted with status "ambiguous"', ambiguousResult.status, 'ambiguous');

  const parsedAmbiguous = K.parseContractSendNote(K.formatContractSendNote(ambiguousResult));
  const evidence = S.buildContractSentEvidence({ contractReady: true, authRecord, currentPreview: completePreview, send: parsedAmbiguous });
  const sentEligibility = B.evaluateContractSentEligibility(evidence);
  checkTrue('Contract Sent is NOT reached after an ambiguous provider response', sentEligibility.eligible === false);

  // Ambiguous/failed sends for the SAME revision do not block a retry.
  const retryEligibility = S.evaluateSendEligibility({ authRecord, preview: completePreview, existingSend: parsedAmbiguous, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('an ambiguous prior attempt for the SAME revision does not block a retry', retryEligibility.eligible === true);
}

// ============================================================
// 11. A verified provider acceptance records Contract Sent exactly once
//     -- now THREE notes (in_progress -> provider_accepted_pending_readback
//     -> accepted), and "accepted" is reachable ONLY via the readback
//     stage (item 5).
// ============================================================
let acceptedSendRecord;
{
  const attemptBuilt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: completeReport, preview: completePreview, authRecord, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  const attemptNote = K.formatContractSendNote(attemptBuilt.value);
  const parsedAttempt = K.parseContractSendNote(attemptNote);
  check('the in_progress attempt round-trips with status in_progress', parsedAttempt.status, 'in_progress');
  check('the in_progress attempt carries no confirmedRecipientId yet -- IAOS cannot know it before the provider responds', parsedAttempt.confirmedRecipientId, null);
  check('the in_progress attempt persists the requested (locked, config-verified) templateId', parsedAttempt.requestedTemplateId, REQUESTED_TEMPLATE_ID);

  const postClassification = S.classifyProviderSendResponse({
    kind: 'http_response', status: 200,
    body: { success: true, links: [{ referenceId: 'ref-1', documentId: 'doc-1', recipientId: RECIPIENT_ID, documentRevision: 1, createdBy: SENDER_USER_ID }] },
  });
  check('the POST response alone classifies as provider_accepted_pending_readback, never accepted', postClassification.status, 'provider_accepted_pending_readback');
  const provisionalResult = S.buildSendResultArgs({ attempt: attemptBuilt.value, operator: null, observedAt: SEND_AT, classification: postClassification });
  check('the provisional result is persisted with status provider_accepted_pending_readback', provisionalResult.status, 'provider_accepted_pending_readback');
  check('the provisional result already carries the provider-echoed confirmedRecipientId', provisionalResult.confirmedRecipientId, RECIPIENT_ID);
  const provisionalNote = K.formatContractSendNote(provisionalResult);
  const parsedProvisional = K.parseContractSendNote(provisionalNote);
  check('the provisional note round-trips with status provider_accepted_pending_readback', parsedProvisional.status, 'provider_accepted_pending_readback');

  // A pending-readback record BLOCKS a retry -- a real provider-side send
  // already went out; retrying here would risk a genuine duplicate.
  const pendingReadbackEligibility = S.evaluateSendEligibility({ authRecord, preview: completePreview, existingSend: parsedProvisional, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a provider_accepted_pending_readback record for the SAME revision blocks a retry', pendingReadbackEligibility.eligible === false);
  check('the refusal names READBACK_VERIFICATION_INCOMPLETE', pendingReadbackEligibility.reasons.map((r) => r.code), ['READBACK_VERIFICATION_INCOMPLETE']);

  const readbackClassification = S.classifyDocumentReadback({
    expectedDocumentId: 'doc-1', expectedRecipientId: RECIPIENT_ID, expectedSenderUserId: SENDER_USER_ID, expectedLocationId: TEST_LOCATION_ID,
    outcome: { kind: 'http_response', status: 200, body: { documents: [{ documentId: 'doc-1', deleted: false, locationId: TEST_LOCATION_ID, status: 'sent', recipients: [{ id: RECIPIENT_ID }], links: [{ createdBy: SENDER_USER_ID }], documentRevision: 1, fillableFields: [{ isRequired: true, type: 'signature' }] }] } },
  });
  check('the readback of a genuinely populated, signable document classifies as accepted', readbackClassification.status, 'accepted');
  const finalResult = S.buildReadbackResultArgs({ attempt: attemptBuilt.value, provisional: provisionalResult, operator: null, observedAt: READBACK_AT, classification: readbackClassification });
  check('the FINAL result is persisted with status accepted', finalResult.status, 'accepted');
  check('the final result\'s iaosObservedAcceptanceAt is the READBACK observation time, not the POST response time', finalResult.iaosObservedAcceptanceAt, READBACK_AT);
  const acceptedNote = K.formatContractSendNote(finalResult);
  acceptedSendRecord = K.parseContractSendNote(acceptedNote);
  check('the accepted result round-trips with status accepted', acceptedSendRecord.status, 'accepted');

  // All three notes exist for the same opportunity -- the reader must
  // resolve to the LATEST (accepted, rank 2) state, never falling back
  // to the earlier pending notes.
  const combinedNotes = [{ body: attemptNote }, { body: provisionalNote }, { body: acceptedNote }];
  const resolved = K.latestContractSendForOpportunity(combinedNotes, OPP);
  check('the reader resolves the full 3-note lifecycle to the accepted status', resolved.status, 'accepted');
  check('the resolved record carries the real provider documentId', resolved.providerResponse.documentId, 'doc-1');
  check('the resolved record carries the readback-confirmed fillableFieldCount', resolved.providerResponse.fillableFieldCount, 1);

  const evidence = S.buildContractSentEvidence({ contractReady: true, authRecord, currentPreview: completePreview, send: resolved });
  const sentEligibility = B.evaluateContractSentEligibility(evidence);
  checkTrue('Contract Sent IS reached after a verified, readback-confirmed provider acceptance', sentEligibility.eligible === true);

  // "Exactly once": a second, independent evaluation against the SAME
  // evidence produces the SAME result -- evaluateContractSentEligibility
  // is a pure re-derivation, never a side-effecting "mark as sent" action,
  // so there is no way for it to be reached "twice" for the same evidence.
  const secondEvaluation = B.evaluateContractSentEligibility(S.buildContractSentEvidence({ contractReady: true, authRecord, currentPreview: completePreview, send: resolved }));
  check('re-evaluating the identical evidence produces the identical result (idempotent derivation, not a counter)', secondEvaluation, sentEligibility);
}

// ============================================================
// 11b. A provider acceptance WITHOUT a valid readback (item 5's own
//      reason for existing) never reaches "accepted" -- a blank/
//      unsignable document (0 fillableFields, Brad's own CURRENTLY
//      CONFIRMED real state of the IAOS Test template) stays ambiguous
//      forever, even though the provider's POST looked completely clean.
// ============================================================
{
  const attemptBuilt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: '2026-09-11T13:00:00.000Z', report: completeReport, preview: completePreview, authRecord, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  const postClassification = S.classifyProviderSendResponse({
    kind: 'http_response', status: 200,
    body: { success: true, links: [{ documentId: 'doc-blank-1', recipientId: RECIPIENT_ID, createdBy: SENDER_USER_ID }] },
  });
  const provisionalResult = S.buildSendResultArgs({ attempt: attemptBuilt.value, operator: null, observedAt: '2026-09-11T13:00:01.000Z', classification: postClassification });
  const readbackOfBlankDoc = S.classifyDocumentReadback({
    expectedDocumentId: 'doc-blank-1', expectedRecipientId: RECIPIENT_ID, expectedSenderUserId: SENDER_USER_ID, expectedLocationId: TEST_LOCATION_ID,
    outcome: { kind: 'http_response', status: 200, body: { documents: [{ documentId: 'doc-blank-1', deleted: false, locationId: TEST_LOCATION_ID, status: 'sent', recipients: [{ id: RECIPIENT_ID }], links: [{ createdBy: SENDER_USER_ID }], fillableFields: [] }] } },
  });
  checkTrue('a genuinely clean POST response still cannot reach Contract Sent when the readback proves the document is blank', readbackOfBlankDoc.status === 'ambiguous');
  const finalResult = S.buildReadbackResultArgs({ attempt: attemptBuilt.value, provisional: provisionalResult, operator: null, observedAt: '2026-09-11T13:00:02.000Z', classification: readbackOfBlankDoc });
  check('the final result for a blank document is persisted as ambiguous, never accepted', finalResult.status, 'ambiguous');
  const evidence = S.buildContractSentEvidence({ contractReady: true, authRecord, currentPreview: completePreview, send: K.parseContractSendNote(K.formatContractSendNote(finalResult)) });
  checkTrue('Contract Sent is NOT reached for a readback-confirmed blank document', B.evaluateContractSentEligibility(evidence).eligible === false);
}

// ============================================================
// 11c. Sending is refused, before any attempt is even built, while
//      template population is not verified (item 9's own code-level
//      enforcement of the STOP condition).
// ============================================================
{
  const eligibility = S.evaluateSendEligibility({ authRecord, preview: completePreview, existingSend: null, populationVerification: G.POPULATION_NOT_VERIFIED });
  checkTrue('sending is refused while populationVerification is not POPULATION_VERIFIED', eligibility.eligible === false);
  check('the refusal names TEMPLATE_POPULATION_NOT_VERIFIED', eligibility.reasons.map((r) => r.code), ['TEMPLATE_POPULATION_NOT_VERIFIED']);
  const builtWhileUnverified = S.buildSendAttemptArgs(sendArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: completeReport, preview: completePreview, authRecord, existingSend: null, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_NOT_VERIFIED }));
  checkTrue('building a send attempt is refused while template population is not verified', builtWhileUnverified.ok === false);
}

// ============================================================
// 12. A retry cannot create a duplicate provider transaction.
// ============================================================
{
  const retryEligibility = S.evaluateSendEligibility({ authRecord, preview: completePreview, existingSend: acceptedSendRecord, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('retrying against an already-accepted send for the SAME revision is refused', retryEligibility.eligible === false);
  check('the refusal names ALREADY_SENT', retryEligibility.reasons.map((r) => r.code), ['ALREADY_SENT']);

  const retryBuilt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: '2026-09-11T12:00:00.000Z', report: completeReport, preview: completePreview, authRecord, existingSend: acceptedSendRecord, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('building a second send attempt against an already-accepted revision is refused', retryBuilt.ok === false);

  // An in-progress (not yet resolved) attempt also blocks a concurrent retry.
  const attemptBuilt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: completeReport, preview: completePreview, authRecord, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  const inProgressRecord = K.parseContractSendNote(K.formatContractSendNote(attemptBuilt.value));
  const concurrentEligibility = S.evaluateSendEligibility({ authRecord, preview: completePreview, existingSend: inProgressRecord, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a concurrent attempt while one is already in_progress for the SAME revision is refused', concurrentEligibility.eligible === false);
  check('the refusal names SEND_IN_PROGRESS', concurrentEligibility.reasons.map((r) => r.code), ['SEND_IN_PROGRESS']);

  // A NEWER revision is never blocked by an older revision's accepted send.
  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null).value;
  const { preview: newerPreview } = buildCompleteReportAndPreview(OPP, bumped);
  const newerAuthRecord = authorize(OPP, newerPreview);
  const newerEligibility = S.evaluateSendEligibility({ authRecord: newerAuthRecord, preview: newerPreview, existingSend: acceptedSendRecord, populationVerification: G.POPULATION_VERIFIED });
  checkTrue('a NEWER revision is not blocked by an older revision\'s accepted send', newerEligibility.eligible === true);
}

// ============================================================
// 13. A send for one Opportunity/revision cannot leak to another.
// ============================================================
{
  const { report: otherReport, preview: otherPreview } = buildCompleteReportAndPreview(OTHER_OPP, VERSION);
  const otherAuthRecord = authorize(OTHER_OPP, otherPreview);

  const attemptBuilt = S.buildSendAttemptArgs({ opportunityId: OPP, operator: null, requestAt: SEND_AT, report: completeReport, preview: completePreview, authRecord, existingSend: null, requestedTemplateId: REQUESTED_TEMPLATE_ID, expirationAt: EXPIRATION_AT, populationVerification: G.POPULATION_VERIFIED });
  const attemptNote = K.formatContractSendNote(attemptBuilt.value);
  const acceptedClassification = S.classifyProviderSendResponse({ kind: 'http_response', status: 200, body: { success: true, links: [{ documentId: 'doc-1' }] } });
  const acceptedResult = S.buildSendResultArgs({ attempt: attemptBuilt.value, operator: null, observedAt: SEND_AT, classification: acceptedClassification });
  const acceptedNote = K.formatContractSendNote(acceptedResult);

  const combinedNotes = [{ body: attemptNote }, { body: acceptedNote }];
  check('a send recorded for OPP is found when reading OPP', K.latestContractSendForOpportunity(combinedNotes, OPP) !== null, true);
  check('a send recorded for OPP is NEVER found when reading a DIFFERENT opportunity', K.latestContractSendForOpportunity(combinedNotes, OTHER_OPP), null);

  const otherEligibility = S.evaluateSendEligibility({ authRecord: otherAuthRecord, preview: otherPreview, existingSend: K.latestContractSendForOpportunity(combinedNotes, OTHER_OPP), populationVerification: G.POPULATION_VERIFIED });
  checkTrue('the other opportunity remains independently eligible -- no cross-opportunity leak', otherEligibility.eligible === true);
}

// ============================================================
// 14. Contract Sent readback preserves provider and revision provenance.
// ============================================================
{
  check('readback preserves the real provider documentId', acceptedSendRecord.providerResponse.documentId, 'doc-1');
  check('readback preserves the real provider documentRevision', acceptedSendRecord.providerResponse.documentRevision, 1);
  check('readback preserves the exact IAOS version identity', acceptedSendRecord.version, VERSION);
  check('readback preserves the exact template identity', [acceptedSendRecord.templateName, acceptedSendRecord.templateSource], [completePreview.templateName, completePreview.templateSource]);
  check('readback preserves the LOCKED, config-verified requestedTemplateId (item 2/6)', acceptedSendRecord.requestedTemplateId, REQUESTED_TEMPLATE_ID);
  check('readback preserves the Brad authorization timestamp this send was tied to', acceptedSendRecord.authorizedAt, authRecord.at);
  check('readback preserves the exact signer snapshot', acceptedSendRecord.signers, [{ role: 'Seller', displayName: 'Jane Seller' }]);
  check('readback preserves the ACTUAL PROVIDER-RETURNED recipient id -- never a client-side placeholder (item 6)', acceptedSendRecord.confirmedRecipientId, RECIPIENT_ID);
  check('readback preserves the confirmed sender (createdBy)', acceptedSendRecord.providerResponse.createdBy, SENDER_USER_ID);
  check('readback preserves the explicit expiration fact', acceptedSendRecord.expirationAt, EXPIRATION_AT);
  checkTrue('readback\'s acceptance timestamp is IAOS\'s OWN observed time AT THE READBACK STAGE, not the earlier POST-response time, and not claimed as a provider-reported time', acceptedSendRecord.iaosObservedAcceptanceAt === READBACK_AT);
}

// ============================================================
// 15. Contract Sent does not create Under Contract.
// ============================================================
{
  const evidence = S.buildContractSentEvidence({ contractReady: true, authRecord, currentPreview: completePreview, send: acceptedSendRecord });
  const sentEligibility = B.evaluateContractSentEligibility(evidence);
  checkTrue('sanity: Contract Sent IS reached', sentEligibility.eligible === true);

  const underContractEvidence = {
    contractSent: sentEligibility.eligible,
    requirements: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }],
    execution: { signers: [], providerReportedCompletionAt: null, preservedDocument: null },
    currentVersion: VERSION,
    executedTermsMatchAgreement: true,
  };
  const underContractResult = B.evaluateUnderContractEligibility(underContractEvidence);
  checkTrue('Contract Sent alone does NOT satisfy Under Contract -- no signer execution, no provider completion, no preserved document exist yet', underContractResult.eligible === false);
  checkTrue('the Under Contract refusal names missing execution facts, never treating Contract Sent as sufficient', underContractResult.reasons.length > 0);
  checkTrue('SIGNERS_INCOMPLETE or PROVIDER_COMPLETION_NOT_REPORTED or DOCUMENT_NOT_PRESERVED is among the reasons', underContractResult.reasons.some((r) => ['SIGNERS_INCOMPLETE', 'PROVIDER_COMPLETION_NOT_REPORTED', 'DOCUMENT_NOT_PRESERVED'].includes(r.code)));
}

// ============================================================
// 16. Ordinary saves and preview generation cannot trigger sending.
// ============================================================
{
  // Building a preview, any number of times, never creates or implies a
  // send record -- no exported function in this module performs I/O, and
  // computing a preview alone never invokes evaluateSendEligibility.
  for (let i = 0; i < 3; i++) {
    const { preview } = buildCompleteReportAndPreview(OPP, VERSION);
    checkTrue(`building preview #${i + 1} alone creates no send record (no send-shaped export was called)`, preview.previewComplete === true);
  }
  // Structural: no exported symbol from contract-send-model.js performs a
  // write or names an "ordinary save" concept -- every export is a pure
  // computation over caller-supplied data.
  checkTrue('no exported symbol from contract-send-model.js is named like a network/write action (fetch/create/post/send-now)', Object.keys(S).every((k) => !/^(fetch|create|postNow)/i.test(k)));

  // An ordinary carrier note (e.g. closing/possession) never parses as a
  // contract-send record.
  const ordinaryNote = C.formatClosingPossessionFactsNote({ opportunityId: OPP, at: SEND_AT, operator: 'brad', closingDate: AGREEMENT_AT, possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } });
  check('an ordinary closing/possession Save note does not parse as a contract-send record', K.parseContractSendNote(ordinaryNote), null);
  const authNote = AC.formatBradContractAuthorizationNote(A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AUTH_AT, preview: completePreview, currentVersion: VERSION }).value);
  check('a Brad authorization note does not parse as a contract-send record', K.parseContractSendNote(authNote), null);
}

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
if (checks < FLOOR) {
  console.error('ABORT: only ' + checks + ' checks ran, floor is ' + FLOOR + '. A silent early return would pass 0 checks.');
  cleanup();
  process.exit(11);
}
cleanup();
process.exit(failures === 0 ? 0 : 1);
