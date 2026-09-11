/**
 * Brad contract review and explicit send-authorization gate -- pure model
 * test runner. B9-07 / INV-62.
 *
 * Compiles contract-authorization-model.ts, contract-authorization-
 * carriers.ts, and the full B9-06/B9-05/B9-03 dependency chain
 * (unmodified by this issue) to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases mapped directly
 * to INV-62's own "Required deterministic evidence" list.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-authorization-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-authorization-model.ts'),
  path.join(LIB, 'contract-authorization-carriers.ts'),
  path.join(LIB, 'contract-document-model.ts'),
  path.join(LIB, 'contract-facts-model.ts'),
  path.join(LIB, 'seller-contract-facts-carriers.ts'),
  path.join(LIB, 'board9-contract-model.ts'),
  path.join(LIB, 'seller-call-outcome.ts'),
  path.join(LIB, 'seller-call-readiness-carriers.ts'),
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

const A = require(path.join(TMP, 'contract-authorization-model.js'));
const K = require(path.join(TMP, 'contract-authorization-carriers.js'));
const D = require(path.join(TMP, 'contract-document-model.js'));
const M = require(path.join(TMP, 'contract-facts-model.js'));
const C = require(path.join(TMP, 'seller-contract-facts-carriers.js'));
const B = require(path.join(TMP, 'board9-contract-model.js'));

const FLOOR = 50;
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
const AT = '2026-09-11T10:00:00.000Z';
const VERSION = B.initialVersionIdentity(AGREEMENT_AT);
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

function buildCompletePreview(opportunityId, version) {
  const notes = fullyPopulatedNotes(opportunityId);
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ opportunityId, notes }));
  return D.buildContractDocumentPreview({ opportunityId, version, report, propertyStreetAddress: POPULATED_ADDRESS });
}
function buildIncompletePreview(opportunityId, version) {
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ opportunityId, notes: [] }));
  return D.buildContractDocumentPreview({ opportunityId, version, report, propertyStreetAddress: { kind: 'unresolved' } });
}

const completePreview = buildCompletePreview(OPP, VERSION);
const incompletePreview = buildIncompletePreview(OPP, VERSION);
checkTrue('fixture sanity: the fully populated fixture IS previewComplete', completePreview.previewComplete === true);
checkTrue('fixture sanity: the empty fixture is NOT previewComplete', incompletePreview.previewComplete === false);

// ============================================================
// 1. A complete/current preview begins UNAUTHORIZED.
// ============================================================
{
  const status = A.evaluateBradAuthorizationCurrency(null, completePreview);
  checkTrue('a complete, never-authorized preview begins unauthorized', status.authorized === false);
  check('the reason names no recorded authorization', status.reasons.map((r) => r.code), ['NO_AUTHORIZATION_RECORDED']);
  check('no record is attached', status.record, null);

  const eligibility = A.evaluateAuthorizationEligibility(completePreview, VERSION);
  checkTrue('a complete, current preview IS eligible to be authorized (distinct from already being authorized)', eligibility.eligible === true);
}

// ============================================================
// 2. Explicit Brad authorization makes ONLY that exact revision eligible.
// ============================================================
let authorizedNoteBody;
let authorizedRecord;
{
  const built = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, operator: null, preview: completePreview, currentVersion: VERSION });
  checkTrue('building the authorization record args succeeds for a complete, current preview', built.ok === true);
  check('the built record asserts authorizedBy as the literal "brad", never caller-supplied', built.value.authorizedBy, 'brad');
  check('the built record carries the preview\'s own version verbatim', built.value.version, completePreview.version);

  authorizedNoteBody = K.formatBradContractAuthorizationNote(built.value);
  authorizedRecord = K.parseBradContractAuthorizationNote(authorizedNoteBody);
  checkTrue('the formatted note parses back successfully', authorizedRecord !== null);

  const status = A.evaluateBradAuthorizationCurrency(authorizedRecord, completePreview);
  checkTrue('after explicit authorization, the SAME exact revision IS authorized', status.authorized === true);

  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null).value;
  const differentRevisionPreview = buildCompletePreview(OPP, bumped);
  const statusDifferentRevision = A.evaluateBradAuthorizationCurrency(authorizedRecord, differentRevisionPreview);
  checkTrue('the SAME authorization does NOT cover a DIFFERENT revision', statusDifferentRevision.authorized === false);
  check('the different-revision refusal names REVISION_CHANGED', statusDifferentRevision.reasons.map((r) => r.code), ['REVISION_CHANGED']);
}

// ============================================================
// 3. Identical readback preserves authorization and provenance.
// ============================================================
{
  check('readback preserves authorizedBy exactly', authorizedRecord.authorizedBy, 'brad');
  check('readback preserves the authorization timestamp exactly', authorizedRecord.at, AT);
  check('readback preserves the version identity exactly', authorizedRecord.version, VERSION);
  check('readback preserves the template name exactly', authorizedRecord.templateName, D.CONTRACT_DOCUMENT_TEMPLATE_NAME);
  check('readback preserves the template source exactly', authorizedRecord.templateSource, D.CONTRACT_DOCUMENT_TEMPLATE_SOURCE);
  check('readback preserves every document-line snapshot exactly', authorizedRecord.documentLines, A.buildAuthorizedContentSnapshot(completePreview).documentLines);
  check('readback preserves every additional-required-fact snapshot exactly', authorizedRecord.additionalRequiredFacts, A.buildAuthorizedContentSnapshot(completePreview).additionalRequiredFacts);

  // A second, independent readback (simulating a fresh page load re-reading
  // the same GHL note) must reach the identical authorized conclusion.
  const secondReadback = K.parseBradContractAuthorizationNote(authorizedNoteBody);
  check('a second independent readback is byte-for-byte identical to the first', secondReadback, authorizedRecord);
  const secondStatus = A.evaluateBradAuthorizationCurrency(secondReadback, completePreview);
  checkTrue('the second readback still evaluates as authorized', secondStatus.authorized === true);
}

// ============================================================
// 4. A material change revokes authorization.
// ============================================================
{
  // Mutate ONE line's text -- a fact contract-facts-model.ts does not
  // treat as a "material term" for ContractVersionIdentity purposes
  // (only price/property/parties bump that), yet this issue's own locked
  // rule requires it to revoke authorization regardless.
  const mutatedLines = completePreview.documentLines.map((l) =>
    l.group === 'closingPossession' && l.field === 'closingDate' ? Object.assign({}, l, { text: '2099-01-01' }) : l,
  );
  const mutatedPreview = Object.assign({}, completePreview, { documentLines: mutatedLines });

  const status = A.evaluateBradAuthorizationCurrency(authorizedRecord, mutatedPreview);
  checkTrue('changing a single material fact (closing date) revokes authorization', status.authorized === false);
  check('the revocation names CONTENT_CHANGED', status.reasons.map((r) => r.code), ['CONTENT_CHANGED']);

  // The UNMUTATED preview is, of course, unaffected -- proving the
  // revocation is specific to the actual content change, not a blanket
  // invalidation.
  const unmutatedStatus = A.evaluateBradAuthorizationCurrency(authorizedRecord, completePreview);
  checkTrue('the original, unmutated preview remains authorized', unmutatedStatus.authorized === true);

  // A change to additionalRequiredFacts (sellerEquitableInterest, not a
  // template blank at all) also revokes -- content-level, not
  // paragraph-blank-level.
  const mutatedAdditional = completePreview.additionalRequiredFacts.map((l) => Object.assign({}, l, { text: 'Not yet made.', status: 'populated' }));
  const mutatedAdditionalPreview = Object.assign({}, completePreview, { additionalRequiredFacts: mutatedAdditional });
  const additionalStatus = A.evaluateBradAuthorizationCurrency(authorizedRecord, mutatedAdditionalPreview);
  checkTrue('changing an additional-required-fact (not a template blank) ALSO revokes authorization', additionalStatus.authorized === false);
}

// ============================================================
// 5. A stale revision cannot be authorized, and cannot remain eligible.
// ============================================================
{
  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null).value;

  // Cannot BE authorized: the preview itself is still built at VERSION,
  // but the caller's own freshest known revision is `bumped` -- the
  // preview is stale relative to it.
  const eligibility = A.evaluateAuthorizationEligibility(completePreview, bumped);
  checkTrue('a preview that is stale relative to the current revision is NOT eligible for authorization', eligibility.eligible === false);
  check('the ineligibility names PREVIEW_STALE', eligibility.reasons.map((r) => r.code), ['PREVIEW_STALE']);

  const attemptedBuild = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, operator: null, preview: completePreview, currentVersion: bumped });
  checkTrue('building an authorization record from a stale preview is refused', attemptedBuild.ok === false);

  // Cannot REMAIN eligible: an already-authorized revision, once a newer
  // revision exists, is no longer current (restated explicitly here from
  // section 2 for direct evidence-mapping to this requirement).
  const newerPreview = buildCompletePreview(OPP, bumped);
  const staleAuthorizationStatus = A.evaluateBradAuthorizationCurrency(authorizedRecord, newerPreview);
  checkTrue('an authorization for a now-superseded revision does not remain eligible', staleAuthorizationStatus.authorized === false);
}

// ============================================================
// 6. An incomplete preview cannot be authorized.
// ============================================================
{
  const eligibility = A.evaluateAuthorizationEligibility(incompletePreview, VERSION);
  checkTrue('an incomplete preview is NOT eligible for authorization', eligibility.eligible === false);
  check('the ineligibility names PREVIEW_NOT_COMPLETE', eligibility.reasons.map((r) => r.code), ['PREVIEW_NOT_COMPLETE']);

  const built = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, operator: null, preview: incompletePreview, currentVersion: VERSION });
  checkTrue('building an authorization record from an incomplete preview is refused', built.ok === false);

  // Even a HYPOTHETICAL hand-crafted authorization record against an
  // incomplete preview must never read as authorized/current.
  const hypotheticalStatus = A.evaluateBradAuthorizationCurrency(authorizedRecord, incompletePreview);
  checkTrue('an incomplete current preview can never remain authorized, even against a real prior authorization record', hypotheticalStatus.authorized === false);
  checkTrue('the incompleteness reason is present among the refusal reasons', hypotheticalStatus.reasons.some((r) => r.code === 'PREVIEW_NOT_COMPLETE'));
}

// ============================================================
// 7. Authorization for one opportunity/revision cannot leak to another.
// ============================================================
{
  const otherPreview = buildCompletePreview(OTHER_OPP, VERSION);
  const builtForOpp = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, operator: null, preview: completePreview, currentVersion: VERSION });
  const noteForOpp = K.formatBradContractAuthorizationNote(builtForOpp.value);

  const combinedNotes = [{ body: noteForOpp }];
  check('an authorization recorded for OPP is found when reading OPP', K.latestBradContractAuthorizationForOpportunity(combinedNotes, OPP) !== null, true);
  check('an authorization recorded for OPP is NEVER found when reading a DIFFERENT opportunity', K.latestBradContractAuthorizationForOpportunity(combinedNotes, OTHER_OPP), null);

  const otherStatus = A.evaluateBradAuthorizationCurrency(K.latestBradContractAuthorizationForOpportunity(combinedNotes, OTHER_OPP), otherPreview);
  checkTrue('the other opportunity\'s preview is correctly unauthorized -- no cross-opportunity leak', otherStatus.authorized === false);
}

// ============================================================
// 8. No generation, preview, or ordinary save action grants authorization.
// ============================================================
{
  // Merely building previews (any number of times, complete or not) never
  // produces or implies an authorization record.
  for (let i = 0; i < 3; i++) {
    const p = buildCompletePreview(OPP, VERSION);
    const status = A.evaluateBradAuthorizationCurrency(null, p);
    checkTrue(`building preview #${i + 1} alone still begins unauthorized`, status.authorized === false);
  }

  // An ordinary per-field "Save" note (e.g. closing/possession facts, or
  // the Contract Ready checklist) must never be mistaken for an
  // authorization record by the authorization parser.
  const ordinarySaveNote = C.formatClosingPossessionFactsNote({ opportunityId: OPP, at: AT, operator: 'brad', closingDate: AGREEMENT_AT, possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } });
  check('an ordinary closing/possession Save note does not parse as a Brad authorization', K.parseBradContractAuthorizationNote(ordinarySaveNote), null);

  const attorneySaveNote = C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } });
  check('an ordinary attorney-field Save note does not parse as a Brad authorization', K.parseBradContractAuthorizationNote(attorneySaveNote), null);

  // Symmetrically, a real authorization note must never be mistaken for
  // one of THOSE carriers' own note shapes.
  check('a real Brad authorization note does not parse as a closing/possession facts note', C.parseClosingPossessionFactsNote(authorizedNoteBody), null);
}

// ============================================================
// 9. Visible review accurately shows material terms and revision
//    differences -- computeDifferencesFromLastAuthorized.
// ============================================================
{
  check('with no authorization on record, differences are explicitly null (nothing to diff against), never an empty array pretending everything matches', A.computeDifferencesFromLastAuthorized(null, completePreview), null);
  check('against the exact preview just authorized, there are zero differences', A.computeDifferencesFromLastAuthorized(authorizedRecord, completePreview), []);

  const mutatedLines = completePreview.documentLines.map((l) =>
    l.group === 'earnestMoneyOption' && l.field === 'earnestMoney' ? Object.assign({}, l, { text: '$5,000.00' }) : l,
  );
  const mutatedPreview = Object.assign({}, completePreview, { documentLines: mutatedLines });
  const diffs = A.computeDifferencesFromLastAuthorized(authorizedRecord, mutatedPreview);
  check('exactly one field differs after a single targeted mutation', diffs.length, 1);
  check('the diff correctly names the changed group/field', [diffs[0].group, diffs[0].field], ['earnestMoneyOption', 'earnestMoney']);
  check('the diff shows the ORIGINAL authorized value as "previous"', diffs[0].previous.text, '$1,000.00');
  check('the diff shows the NEW value as "current"', diffs[0].current.text, '$5,000.00');
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
