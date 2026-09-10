/**
 * Populate the approved purchase agreement -- pure model test runner.
 * B9-06 / INV-61.
 *
 * Compiles contract-document-model.ts and its full dependency chain
 * (contract-facts-model.ts, seller-contract-facts-carriers.ts,
 * board9-contract-model.ts, seller-call-outcome.ts,
 * seller-call-readiness-carriers.ts -- all already-shipped, unmodified by
 * this issue except the single `export` added to
 * `isSameContractVersion`) to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-document-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
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

const D = require(path.join(TMP, 'contract-document-model.js'));
const M = require(path.join(TMP, 'contract-facts-model.js'));
const C = require(path.join(TMP, 'seller-contract-facts-carriers.js'));
const B = require(path.join(TMP, 'board9-contract-model.js'));

const FLOOR = 55;
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

function lineFor(preview, group, field) {
  return preview.documentLines.find((l) => l.group === group && l.field === field);
}

const OPP = 'opp-1';
const AGREED_PRICE = 190000;
const AGREEMENT_AT = '2026-09-06T15:00:00.000Z';
const VERSION = B.initialVersionIdentity(AGREEMENT_AT);

function baseFactsArgs(over) {
  return Object.assign({
    opportunityId: OPP,
    notes: [],
    agreedPrice: AGREED_PRICE,
    agreementAt: AGREEMENT_AT,
    propertyAddress: '123 Main St, Austin, TX, 78701',
  }, over || {});
}

const POPULATED_ADDRESS = { kind: 'populated', value: '123 Main St, Austin, TX, 78701', authority: 'operator_attested', recordedAt: AGREEMENT_AT };
const UNRESOLVED_ADDRESS = { kind: 'unresolved' };

// ============================================================
// 1. Template identity -- cited, never invented.
// ============================================================
{
  checkTrue('template name cites TREC NO. 20-19 exactly', D.CONTRACT_DOCUMENT_TEMPLATE_NAME.indexOf('TREC NO. 20-19') >= 0);
  checkTrue('template source cites the committed source PDF', D.CONTRACT_DOCUMENT_TEMPLATE_SOURCE.indexOf('TREC Resale Home Contract.pdf') >= 0);
}

// ============================================================
// 2. Empty report -- everything not carrier-backed is unresolved, the
//    document is not sendable, and every blocking condition is named.
// ============================================================
{
  const report = M.computeSellerContractFactsReport(baseFactsArgs());
  const preview = D.buildContractDocumentPreview({
    opportunityId: OPP, version: VERSION, report, propertyStreetAddress: UNRESOLVED_ADDRESS,
  });

  check('empty preview: property street address line is unresolved', lineFor(preview, 'identity', 'propertyStreetAddress').status, 'unresolved');
  check('empty preview: lot is unresolved', lineFor(preview, 'propertyLegalDescription', 'lot').status, 'unresolved');
  check('empty preview: escrow agent name is unresolved', lineFor(preview, 'earnestMoneyOption', 'escrowAgentName').status, 'unresolved');
  check('empty preview: closing date is unresolved', lineFor(preview, 'closingPossession', 'closingDate').status, 'unresolved');

  check('empty preview: buyer entity default still populates (a fixed fact)', lineFor(preview, 'parties', 'buyerEntityName').status, 'populated');
  check('empty preview: buyer entity default text is the exact supplied name', lineFor(preview, 'parties', 'buyerEntityName').text, 'Brad Thompson Consulting LLC');
  check('empty preview: financing addenda always not_applicable', lineFor(preview, 'addendaApplicability', 'financingAddenda').status, 'not_applicable');
  check('empty preview: sales price 3A/3C populate from the accepted price even with no other notes', [lineFor(preview, 'salesPrice', 'cashPortion').text, lineFor(preview, 'salesPrice', 'salesPrice').text], ['$190,000.00', '$190,000.00']);
  check('empty preview: 3B is fixed at $0.00', lineFor(preview, 'salesPrice', 'financingSum').text, '$0.00');

  checkTrue('empty preview is not sendable', preview.documentSendable === false);
  checkTrue('empty preview names the property-address blocker', preview.blockingReasons.some((r) => r.indexOf('Property street address') >= 0));
  checkTrue('empty preview names an unresolved-field blocker', preview.blockingReasons.some((r) => r.indexOf('unresolved') >= 0));
  check('empty preview unresolvedFieldCount matches the readiness rollup', preview.unresolvedFieldCount, M.computeSellerContractFactsReadiness(report).unresolvedFields.length);
  check('empty preview priceConflictCount is 0 (property/price never actually diverge in this model)', preview.priceConflictCount, 0);
}

// ============================================================
// 3. Fully populated report -- every carrier note present, every line
//    populated or explicitly not_applicable, document IS sendable.
// ============================================================
{
  const notes = [
    { body: C.formatPartySignerFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', signers: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }] }) },
    { body: C.formatPropertyLegalDescriptionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', lot: { kind: 'value', value: '12' }, block: { kind: 'value', value: 'A' }, addition: { kind: 'value', value: 'Oak Hills' }, county: { kind: 'value', value: 'Travis' }, exclusions: { kind: 'none' }, reservations: { kind: 'none' } }) },
    { body: C.formatLeaseDisclosureFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', residentialLeases: 'none', fixtureLeases: 'none', naturalResourceLeases: { kind: 'none' } }) },
    { body: C.formatEarnestMoneyOptionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St, Austin, TX', earnestMoney: { kind: 'amount', amount: 1000 }, optionFee: { kind: 'amount', amount: 200 }, optionPeriodDays: { kind: 'days', days: 10 }, additionalEarnestMoney: { kind: 'none' } }) },
    { body: C.formatTitleSurveyFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', titlePolicyExpenseParty: 'seller', titleCompanyName: 'Austin Title Co', shortageAmendmentElection: { kind: 'amended', expenseParty: 'buyer' }, surveyElection: { option: 'seller_existing_survey', sellerFurnishDays: 10, ifRejectedExpenseParty: 'seller' }, objectionsText: { kind: 'none' }, objectionsDays: 5, poaMembership: 'is_not_subject' }) },
    { body: C.formatPropertyConditionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', sellerDisclosureNotice: { kind: 'received' }, asIsElection: { kind: 'as_is' }, serviceContractCap: { kind: 'none' }, waterDisclosure: { kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'City of Austin' } }) },
    { body: C.formatClosingPossessionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', closingDate: '2026-10-15T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } }) },
    { body: C.formatSettlementExpenseFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', sellerCreditCap: { kind: 'none' }, sellerPaysBuyerBroker: { kind: 'none' }, buyerPaysSellerBroker: { kind: 'none' } }) },
    { body: C.formatRepresentationFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', representation: { kind: 'none' } }) },
    { body: C.formatAddendaApplicabilityFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', items: Object.fromEntries(C.ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, k === 'back_up_contract'])), districtNotices: { kind: 'none' } }) },
    { body: C.formatSellerEquitableInterestDisclosureNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', disposition: { kind: 'made', at: AGREEMENT_AT } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatSellerNoticeConfirmationFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '123 Main St, Austin, TX, 78701', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' }, source: 'confirmed_from_contact_record' }) },
    { body: C.formatBuyerBusinessConfigFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '1 Business Rd, Austin, TX', noticePhone: '555-0000', noticeEmail: 'buyer@btcllc.example', signerName: 'Brad Thompson', signerRole: 'Manager' }) },
  ];

  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const readiness = M.computeSellerContractFactsReadiness(report);
  check('fixture sanity: readiness rollup shows zero unresolved fields', readiness.unresolvedFields, []);

  const preview = D.buildContractDocumentPreview({
    opportunityId: OPP, version: VERSION, report, propertyStreetAddress: POPULATED_ADDRESS,
  });

  checkTrue('fully populated preview IS sendable', preview.documentSendable === true);
  check('fully populated preview has no blocking reasons', preview.blockingReasons, []);
  check('fully populated preview unresolvedFieldCount is 0', preview.unresolvedFieldCount, 0);

  check('¶2A lot renders the entered value', lineFor(preview, 'propertyLegalDescription', 'lot').text, '12');
  check('¶2D exclusions renders the explicit none marker', lineFor(preview, 'propertyLegalDescription', 'exclusions').text, 'None (explicitly confirmed).');
  check('¶5A earnest money renders as currency', lineFor(preview, 'earnestMoneyOption', 'earnestMoney').text, '$1,000.00');
  check('¶5B option period renders with day pluralization', lineFor(preview, 'earnestMoneyOption', 'optionPeriodDays').text, '10 days');
  check('¶6A title expense party renders the real form phrase', lineFor(preview, 'titleSurvey', 'titlePolicyExpenseParty').text, "Seller's expense.");
  check('¶6A(8) shortage amendment renders option (ii) with the real quoted phrase', lineFor(preview, 'titleSurvey', 'shortageAmendmentElection').text, '(ii) Amended to read "shortages in area" at Buyer\'s expense.');
  check('¶6C survey election renders option (1) with both day counts and expense party', lineFor(preview, 'titleSurvey', 'surveyElection').text, "(1) Seller furnishes existing survey within 10 days after the Effective Date; if rejected, new survey at Seller's expense.");
  check('¶6E(2) POA membership renders the real form phrase, negative case', lineFor(preview, 'titleSurvey', 'poaMembership').text, 'Property is NOT subject to mandatory property owners association membership.');
  check('¶7B seller disclosure notice renders option (1)', lineFor(preview, 'propertyCondition', 'sellerDisclosureNotice').text, "(1) Buyer has received the Seller's Disclosure Notice.");
  check('¶7D as-is election renders option (1)', lineFor(preview, 'propertyCondition', 'asIsElection').text, '(1) Buyer accepts the Property As Is.');
  check('¶7I water disclosure renders the exempt criteria and water source', lineFor(preview, 'propertyCondition', 'waterDisclosure').text, '(3) Exempt (no water well; no pond/lake/tank; no surface-water certificate/filing/permit; no severed groundwater rights); water source: City of Austin.');
  check('¶9A closing date renders as a plain calendar date, not a locale string', lineFor(preview, 'closingPossession', 'closingDate').text, '2026-10-15');
  check('¶10A possession renders the real form phrase', lineFor(preview, 'closingPossession', 'possessionElection').text, 'Upon closing and funding.');
  check('¶22 addenda items render ONLY the selected item, using its real printed title', lineFor(preview, 'addendaApplicability', 'items').text, 'Addendum for "Back-Up" Contract');
  checkTrue('¶22 financing addenda always renders its own already-approved B9-05 not_applicable note, unsupported in V1', lineFor(preview, 'addendaApplicability', 'financingAddenda').text.indexOf('unsupported in V1 (Cash Acquisition / Assignment Exit)') >= 0);
  check('¶8 representation renders the "no representation" case', lineFor(preview, 'representation', 'representation').text, 'No broker/agent representation.');
  check('¶11 special provisions renders the not_applicable fallback text (the carrier itself stores no note for this disposition)', lineFor(preview, 'attorneyManualFields', 'specialProvisions').text, 'Not applicable (explicitly confirmed).');
  check('¶21 seller notice email renders the confirmed value', lineFor(preview, 'noticeContact', 'sellerNoticeEmail').text, 'seller@example.com');
  check('¶21 seller notice phone renders its own already-approved B9-05 not_applicable note', lineFor(preview, 'noticeContact', 'sellerNoticePhone').text, 'Explicitly confirmed no phone for notice.');
  check('additionalRequiredFacts carries the seller equitable-interest disclosure, made', preview.additionalRequiredFacts[0].text, `Made at ${AGREEMENT_AT}.`);
  checkTrue('additionalRequiredFacts entries carry no paragraph citation (not a template blank)', preview.additionalRequiredFacts.every((l) => l.paragraph === ''));

  check('populated lines carry their disposition authority verbatim', lineFor(preview, 'earnestMoneyOption', 'earnestMoney').authority, 'operator_attested');
  check('populated lines carry their disposition recordedAt verbatim', lineFor(preview, 'earnestMoneyOption', 'earnestMoney').recordedAt, AGREEMENT_AT);
}

// ============================================================
// 4. Provided-verbatim attorney field -- populated, opaque, never
//    evaluated by this module.
// ============================================================
{
  const notes = [
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: 'Seller to leave the shed.' } }) },
  ];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = D.buildContractDocumentPreview({ opportunityId: OPP, version: VERSION, report, propertyStreetAddress: POPULATED_ADDRESS });
  const line = lineFor(preview, 'attorneyManualFields', 'specialProvisions');
  check('¶11 provided-verbatim disposition is populated', line.status, 'populated');
  check('¶11 provided-verbatim text is the fixed opaque notice, not the attorney text itself', line.text, 'Provided verbatim by attorney/operator -- this module does not evaluate its content.');

  const willDraftNotes = [
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'attorney_will_draft' } }) },
  ];
  const willDraftReport = M.computeSellerContractFactsReport(baseFactsArgs({ notes: willDraftNotes }));
  const willDraftPreview = D.buildContractDocumentPreview({ opportunityId: OPP, version: VERSION, report: willDraftReport, propertyStreetAddress: POPULATED_ADDRESS });
  check('¶11 "attorney will draft" is UNRESOLVED, not populated -- "will draft" is not "drafted"', lineFor(willDraftPreview, 'attorneyManualFields', 'specialProvisions').status, 'unresolved');
  checkTrue('a preview with an attorney-will-draft ¶11 is not sendable', willDraftPreview.documentSendable === false);
}

// ============================================================
// 5. Price conflict -- synthetic report, since the real computation path
//    can never actually diverge (contract-facts-model.ts always mirrors
//    the accepted price into both sides of its own comparison). Proves
//    this module's OWN conflict handling is wired correctly regardless.
// ============================================================
{
  const report = M.computeSellerContractFactsReport(baseFactsArgs());
  const conflicted = Object.assign({}, report, {
    priceConflicts: [{ field: 'price', agreementValue: '190000', candidateValue: '199999' }],
  });
  const preview = D.buildContractDocumentPreview({ opportunityId: OPP, version: VERSION, report: conflicted, propertyStreetAddress: POPULATED_ADDRESS });
  check('priceConflictCount reflects the synthetic conflict', preview.priceConflictCount, 1);
  checkTrue('a preview with a price conflict is not sendable', preview.documentSendable === false);
  checkTrue('blockingReasons names the conflicting field and both values', preview.blockingReasons.some((r) => r.indexOf('price') >= 0 && r.indexOf('190000') >= 0 && r.indexOf('199999') >= 0));
}

// ============================================================
// 6. Document revision identity -- reuses board9-contract-model's own
//    isSameContractVersion verbatim, never a second implementation.
// ============================================================
{
  const report = M.computeSellerContractFactsReport(baseFactsArgs());
  const preview = D.buildContractDocumentPreview({ opportunityId: OPP, version: VERSION, report, propertyStreetAddress: POPULATED_ADDRESS });

  checkTrue('a preview is never stale against the exact version it was built from', D.isContractDocumentPreviewStale(preview, VERSION) === false);
  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null);
  checkTrue('bumping the version makes the same preview stale', D.isContractDocumentPreviewStale(preview, bumped.value) === true);
  checkTrue('isContractDocumentPreviewStale is exactly board9-contract-model\'s isSameContractVersion, negated', D.isContractDocumentPreviewStale(preview, VERSION) === !B.isSameContractVersion(preview.version, VERSION));
}

// ============================================================
// 7. Paragraph citations -- spot-checked against the real TREC 20-19
//    source PDF (docs/TREC Resale Home Contract.pdf), never invented.
// ============================================================
{
  const report = M.computeSellerContractFactsReport(baseFactsArgs());
  const preview = D.buildContractDocumentPreview({ opportunityId: OPP, version: VERSION, report, propertyStreetAddress: POPULATED_ADDRESS });
  const cite = (group, field) => lineFor(preview, group, field).paragraph;

  check('¶3A/3B/3C citations', [cite('salesPrice', 'cashPortion'), cite('salesPrice', 'financingSum'), cite('salesPrice', 'salesPrice')], ['3A', '3B', '3C']);
  check('¶2A/2D/2E citations', [cite('propertyLegalDescription', 'lot'), cite('propertyLegalDescription', 'exclusions'), cite('propertyLegalDescription', 'reservations')], ['2A', '2D', '2E']);
  check('¶4A/4B/4C citations', [cite('leaseDisclosure', 'residentialLeases'), cite('leaseDisclosure', 'fixtureLeases'), cite('leaseDisclosure', 'naturalResourceLeases')], ['4A', '4B', '4C']);
  check('¶5A/5B/5(1) citations', [cite('earnestMoneyOption', 'earnestMoney'), cite('earnestMoneyOption', 'optionPeriodDays'), cite('earnestMoneyOption', 'additionalEarnestMoney')], ['5A', '5B', '5(1)']);
  check('¶6A/6A(8)/6C/6D/6E(2) citations', [cite('titleSurvey', 'titleCompanyName'), cite('titleSurvey', 'shortageAmendmentElection'), cite('titleSurvey', 'surveyElection'), cite('titleSurvey', 'objectionsText'), cite('titleSurvey', 'poaMembership')], ['6A', '6A(8)', '6C', '6D', '6E(2)']);
  check('¶7B/7D/7H/7I citations', [cite('propertyCondition', 'sellerDisclosureNotice'), cite('propertyCondition', 'asIsElection'), cite('propertyCondition', 'serviceContractCap'), cite('propertyCondition', 'waterDisclosure')], ['7B', '7D', '7H', '7I']);
  check('¶9A/10A citations', [cite('closingPossession', 'closingDate'), cite('closingPossession', 'possessionElection')], ['9A', '10A']);
  check('¶12A(1)(b)/12B(1)/12B(2) citations', [cite('settlementExpense', 'sellerCreditCap'), cite('settlementExpense', 'sellerPaysBuyerBroker'), cite('settlementExpense', 'buyerPaysSellerBroker')], ['12A(1)(b)', '12B(1)', '12B(2)']);
  check('¶8 citation', cite('representation', 'representation'), '8');
  check('¶22 citation', cite('addendaApplicability', 'items'), '22');
  check('¶21 citation', cite('noticeContact', 'buyerNoticeAddress'), '21');
  check('¶11 / ¶22 "Other:" citations', [cite('attorneyManualFields', 'specialProvisions'), cite('attorneyManualFields', 'otherAddendaText')], ['11', '22 "Other:"']);
  check('identity ¶2A citation', cite('identity', 'propertyStreetAddress'), '2A');
  checkTrue('sellerEquitableInterest is NOT in documentLines at all (not a template blank)', preview.documentLines.every((l) => l.group !== 'sellerEquitableInterest'));
}

// ============================================================
// 8. Field/group labels mirror ContractWorkspace.tsx verbatim.
// ============================================================
{
  check('group label for salesPrice matches the UI checklist label', D.CONTRACT_DOCUMENT_GROUP_LABEL.salesPrice, 'Sales Price (¶3)');
  check('field label for salesPrice.cashPortion matches the UI checklist label', D.CONTRACT_DOCUMENT_FIELD_LABEL['salesPrice.cashPortion'], 'Cash portion (¶3A)');
  check('field label for sellerEquitableInterest lives in its own additional-fact map, not the template-field map', D.CONTRACT_DOCUMENT_FIELD_LABEL['sellerEquitableInterest.disposition'], undefined);
  check('additional-fact label for sellerEquitableInterest matches the UI checklist label', D.CONTRACT_DOCUMENT_ADDITIONAL_FACT_LABEL['sellerEquitableInterest.disposition'], 'Seller equitable-interest disclosure');
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
