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
 *
 * Jess Gate correction round (this issue): renamed `documentSendable` to
 * `previewComplete` throughout (population/preview completeness only,
 * never send authorization -- INV-62/B9-07's exclusive job), and corrected
 * attorney/manual-field handling to reproduce the exact supplied
 * `provided_verbatim` text with its provenance rather than a placeholder.
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

const FLOOR = 65;
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

function buildPreview(report, notes, propertyStreetAddress) {
  return D.buildContractDocumentPreview({ opportunityId: OPP, version: VERSION, report, propertyStreetAddress, notes });
}

// ============================================================
// 1. Template identity -- cited, never invented.
// ============================================================
{
  checkTrue('template name cites TREC NO. 20-19 exactly', D.CONTRACT_DOCUMENT_TEMPLATE_NAME.indexOf('TREC NO. 20-19') >= 0);
  checkTrue('template source cites the committed source PDF', D.CONTRACT_DOCUMENT_TEMPLATE_SOURCE.indexOf('TREC Resale Home Contract.pdf') >= 0);
}

// ============================================================
// 2. Empty report -- everything not carrier-backed is unresolved, the
//    preview is not complete, and every blocking condition is named.
// ============================================================
{
  const notes = [];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = buildPreview(report, notes, UNRESOLVED_ADDRESS);

  check('empty preview: property street address line is unresolved', lineFor(preview, 'identity', 'propertyStreetAddress').status, 'unresolved');
  check('empty preview: lot is unresolved', lineFor(preview, 'propertyLegalDescription', 'lot').status, 'unresolved');
  check('empty preview: escrow agent name is unresolved', lineFor(preview, 'earnestMoneyOption', 'escrowAgentName').status, 'unresolved');
  check('empty preview: closing date is unresolved', lineFor(preview, 'closingPossession', 'closingDate').status, 'unresolved');
  check('empty preview: attorney special provisions unresolved with no carrier record', lineFor(preview, 'attorneyManualFields', 'specialProvisions').status, 'unresolved');

  check('empty preview: buyer entity default still populates (a fixed fact)', lineFor(preview, 'parties', 'buyerEntityName').status, 'populated');
  check('empty preview: buyer entity default text is the exact supplied name', lineFor(preview, 'parties', 'buyerEntityName').text, 'Brad Thompson Consulting LLC');
  check('empty preview: financing addenda always not_applicable', lineFor(preview, 'addendaApplicability', 'financingAddenda').status, 'not_applicable');
  check('empty preview: sales price 3A/3C populate from the accepted price even with no other notes', [lineFor(preview, 'salesPrice', 'cashPortion').text, lineFor(preview, 'salesPrice', 'salesPrice').text], ['$190,000.00', '$190,000.00']);
  check('empty preview: 3B is fixed at $0.00', lineFor(preview, 'salesPrice', 'financingSum').text, '$0.00');

  checkTrue('empty preview is NOT complete', preview.previewComplete === false);
  checkTrue('empty preview names the property-address blocker', preview.blockingReasons.some((r) => r.indexOf('Property street address') >= 0));
  checkTrue('empty preview names an unresolved-field blocker', preview.blockingReasons.some((r) => r.indexOf('unresolved') >= 0));
  check('empty preview unresolvedFieldCount matches the readiness rollup', preview.unresolvedFieldCount, M.computeSellerContractFactsReadiness(report).unresolvedFields.length);
  check('empty preview priceConflictCount is 0 (property/price never actually diverge in this model)', preview.priceConflictCount, 0);
}

// ============================================================
// 3. Fully populated report -- every carrier note present, every line
//    populated or explicitly not_applicable, preview IS complete.
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

  const preview = buildPreview(report, notes, POPULATED_ADDRESS);

  checkTrue('fully populated preview IS complete', preview.previewComplete === true);
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

  const specialProvisionsLine = lineFor(preview, 'attorneyManualFields', 'specialProvisions');
  check('¶11 special provisions: approved not_applicable disposition resolves correctly', specialProvisionsLine.status, 'not_applicable');
  check('¶11 special provisions: not_applicable text names it as an approved disposition, invents no legal content', specialProvisionsLine.text, 'Not applicable (approved disposition for this field).');
  check('¶11 special provisions: not_applicable carries real provenance (operator/timestamp), not null', [specialProvisionsLine.authority, specialProvisionsLine.recordedAt], ['operator_attested', AGREEMENT_AT]);
  const otherAddendaLine = lineFor(preview, 'attorneyManualFields', 'otherAddendaText');
  check('¶22 "Other:" not_applicable disposition also resolves correctly', otherAddendaLine.status, 'not_applicable');

  check('¶21 seller notice email renders the confirmed value', lineFor(preview, 'noticeContact', 'sellerNoticeEmail').text, 'seller@example.com');
  check('¶21 seller notice phone renders its own already-approved B9-05 not_applicable note', lineFor(preview, 'noticeContact', 'sellerNoticePhone').text, 'Explicitly confirmed no phone for notice.');
  check('additionalRequiredFacts carries the seller equitable-interest disclosure, made', preview.additionalRequiredFacts[0].text, `Made at ${AGREEMENT_AT}.`);
  checkTrue('additionalRequiredFacts entries carry no paragraph citation (not a template blank)', preview.additionalRequiredFacts.every((l) => l.paragraph === ''));

  check('populated lines carry their disposition authority verbatim', lineFor(preview, 'earnestMoneyOption', 'earnestMoney').authority, 'operator_attested');
  check('populated lines carry their disposition recordedAt verbatim', lineFor(preview, 'earnestMoneyOption', 'earnestMoney').recordedAt, AGREEMENT_AT);
}

// ============================================================
// 4. Attorney/manual-field locked rules (Jess Gate correction, this issue).
// ============================================================

// 4a. provided_verbatim: the EXACT supplied text is reproduced opaquely,
//     with its own real provenance -- never a placeholder, never rewritten,
//     summarized, interpreted, approved, or judged.
{
  const VERBATIM_TEXT = 'Seller to leave the shed and remove the above-ground pool prior to closing.';
  const notes = [
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: VERBATIM_TEXT } }) },
  ];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = buildPreview(report, notes, POPULATED_ADDRESS);
  const line = lineFor(preview, 'attorneyManualFields', 'specialProvisions');

  check('¶11 provided-verbatim disposition resolves (populated)', line.status, 'populated');
  check('¶11 provided-verbatim text is reproduced EXACTLY, character for character -- never a placeholder', line.text, VERBATIM_TEXT);
  checkTrue('¶11 provided-verbatim text is NOT replaced by any explanatory/placeholder wording', line.text.indexOf('this module does not evaluate') === -1);
  check('¶11 provided-verbatim provenance (authority) is preserved', line.authority, 'operator_attested');
  check('¶11 provided-verbatim provenance (recordedAt) is preserved and matches the real recorded timestamp', line.recordedAt, AGREEMENT_AT);
}

// 4b. attorney_will_draft remains UNRESOLVED for preview completeness --
//     "will draft" is never treated as completed, regardless of every
//     other field being resolved.
{
  const notes = [
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'attorney_will_draft' } }) },
  ];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = buildPreview(report, notes, POPULATED_ADDRESS);
  const line = lineFor(preview, 'attorneyManualFields', 'specialProvisions');

  check('¶11 "attorney will draft" is UNRESOLVED, not populated -- "will draft" is not "drafted"', line.status, 'unresolved');
  check('¶11 "attorney will draft" carries no rendered text', line.text, null);
  checkTrue('a preview with an attorney-will-draft ¶11 is NOT complete', preview.previewComplete === false);
  checkTrue('the incomplete-attorney-field blocker is named in blockingReasons', preview.blockingReasons.some((r) => /attorney.*manual.*field/i.test(r) || /special provisions/i.test(r)));
}

// 4c. An empty/blank supplied provided_verbatim value fails closed -- it is
//     never silently treated as resolved. The carrier's own parser already
//     refuses to round-trip a blank text (proven directly below); this
//     module's consumption of that carrier therefore also resolves the
//     field as unresolved, end to end, through the real public API.
{
  checkTrue(
    'sanity: the shipped carrier itself refuses to parse an empty provided_verbatim text (bypassing its own type-safety at the JS layer, exactly as corrupted/malformed data would)',
    C.parseAttorneyManualFieldDispositionNote(
      C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: '' } }),
    ) === null,
  );
  checkTrue(
    'sanity: the shipped carrier also refuses a whitespace-only provided_verbatim text',
    C.parseAttorneyManualFieldDispositionNote(
      C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: '   ' } }),
    ) === null,
  );

  const notes = [
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: '' } }) },
  ];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = buildPreview(report, notes, POPULATED_ADDRESS);
  const line = lineFor(preview, 'attorneyManualFields', 'specialProvisions');

  check('an empty provided_verbatim value is UNRESOLVED end to end -- never silently treated as resolved', line.status, 'unresolved');
  check('an empty provided_verbatim value carries no rendered text', line.text, null);
  checkTrue('a preview built from an empty-text ¶11 note is NOT complete', preview.previewComplete === false);
}

// 4d. Approved not_applicable disposition resolves correctly (already
//     exercised for both slots in section 3's fully populated fixture;
//     spot-checked again here in isolation).
{
  const notes = [
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'not_applicable' } }) },
  ];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = buildPreview(report, notes, POPULATED_ADDRESS);
  const line = lineFor(preview, 'attorneyManualFields', 'otherAddendaText');
  check('¶22 "Other:" not_applicable is the approved disposition for this field and resolves', line.status, 'not_applicable');
  checkTrue('¶22 "Other:" not_applicable carries real provenance, not fabricated', line.recordedAt === AGREEMENT_AT && line.authority === 'operator_attested');
}

// 4e. NONE of the four attorney-field states (unresolved / attorney_will_draft
//     / provided_verbatim / not_applicable) creates, implies, or exposes any
//     send-authorization concept -- structural proof, not just behavioral.
{
  const ATTORNEY_LINE_KEYS = ['paragraph', 'group', 'field', 'label', 'status', 'text', 'authority', 'recordedAt'];
  const notesByCase = {
    no_record: [],
    attorney_will_draft: [{ body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'attorney_will_draft' } }) }],
    provided_verbatim: [{ body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: 'Real text.' } }) }],
    not_applicable: [{ body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } }) }],
  };
  for (const [caseName, notes] of Object.entries(notesByCase)) {
    const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
    const preview = buildPreview(report, notes, POPULATED_ADDRESS);
    const line = lineFor(preview, 'attorneyManualFields', 'specialProvisions');
    check(`attorney-field case "${caseName}": the rendered line has EXACTLY the documented keys, no send/authorization field smuggled in`, Object.keys(line).sort(), [...ATTORNEY_LINE_KEYS].sort());
  }
}

// ============================================================
// 5. previewComplete represents population/preview completeness ONLY and
//    is never, in any form, send authorization (Jess Gate correction,
//    this issue). Structural coverage, not just naming.
// ============================================================
{
  const notes = [];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const completePreview = buildPreview(report, notes, POPULATED_ADDRESS);

  checkTrue('ContractDocumentPreview has no field literally named "documentSendable" (the corrected name replaces it, not merely adds to it)', !('documentSendable' in completePreview));
  checkTrue('ContractDocumentPreview has no "sendAuthorized"/"authorized"/"sent" field of any kind', Object.keys(completePreview).every((k) => !/send|authoriz/i.test(k)));
  checkTrue('no exported symbol from contract-document-model.js names a send/authorization concept', Object.keys(D).every((k) => !/send|authoriz/i.test(k)));
  checkTrue('previewComplete is a plain boolean, not an object carrying authorization metadata', typeof completePreview.previewComplete === 'boolean');

  // Full completeness (previewComplete === true) still implies nothing about
  // authorization -- proven by building a genuinely complete preview (reusing
  // section 3's exact fixture) and confirming it still exposes no send state.
  const fullNotes = [
    { body: C.formatPartySignerFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', signers: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }] }) },
    { body: C.formatPropertyLegalDescriptionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', lot: { kind: 'value', value: '12' }, block: { kind: 'value', value: 'A' }, addition: { kind: 'value', value: 'Oak Hills' }, county: { kind: 'value', value: 'Travis' }, exclusions: { kind: 'none' }, reservations: { kind: 'none' } }) },
    { body: C.formatLeaseDisclosureFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', residentialLeases: 'none', fixtureLeases: 'none', naturalResourceLeases: { kind: 'none' } }) },
    { body: C.formatEarnestMoneyOptionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St, Austin, TX', earnestMoney: { kind: 'amount', amount: 1000 }, optionFee: { kind: 'amount', amount: 200 }, optionPeriodDays: { kind: 'days', days: 10 }, additionalEarnestMoney: { kind: 'none' } }) },
    { body: C.formatTitleSurveyFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', titlePolicyExpenseParty: 'seller', titleCompanyName: 'Austin Title Co', shortageAmendmentElection: { kind: 'amended', expenseParty: 'buyer' }, surveyElection: { option: 'seller_existing_survey', sellerFurnishDays: 10, ifRejectedExpenseParty: 'seller' }, objectionsText: { kind: 'none' }, objectionsDays: 5, poaMembership: 'is_not_subject' }) },
    { body: C.formatPropertyConditionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', sellerDisclosureNotice: { kind: 'received' }, asIsElection: { kind: 'as_is' }, serviceContractCap: { kind: 'none' }, waterDisclosure: { kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'City of Austin' } }) },
    { body: C.formatClosingPossessionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', closingDate: '2026-10-15T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } }) },
    { body: C.formatSettlementExpenseFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', sellerCreditCap: { kind: 'none' }, sellerPaysBuyerBroker: { kind: 'none' }, buyerPaysSellerBroker: { kind: 'none' } }) },
    { body: C.formatRepresentationFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', representation: { kind: 'none' } }) },
    { body: C.formatAddendaApplicabilityFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', items: Object.fromEntries(C.ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false])), districtNotices: { kind: 'none' } }) },
    { body: C.formatSellerEquitableInterestDisclosureNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', disposition: { kind: 'made', at: AGREEMENT_AT } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatSellerNoticeConfirmationFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '123 Main St, Austin, TX, 78701', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' }, source: 'confirmed_from_contact_record' }) },
    { body: C.formatBuyerBusinessConfigFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '1 Business Rd, Austin, TX', noticePhone: '555-0000', noticeEmail: 'buyer@btcllc.example', signerName: 'Brad Thompson', signerRole: 'Manager' }) },
  ];
  const fullReport = M.computeSellerContractFactsReport(baseFactsArgs({ notes: fullNotes }));
  const fullPreview = buildPreview(fullReport, fullNotes, POPULATED_ADDRESS);
  checkTrue('a genuinely complete preview (previewComplete === true) still exposes no send/authorization field anywhere on it', fullPreview.previewComplete === true && Object.keys(fullPreview).every((k) => !/send|authoriz/i.test(k)));
  checkTrue('a genuinely complete preview carries no field claiming Brad reviewed or authorized it', !('bradReviewed' in fullPreview) && !('reviewedBy' in fullPreview) && !('authorizedAt' in fullPreview));
}

// ============================================================
// 6. Price conflict -- synthetic report, since the real computation path
//    can never actually diverge (contract-facts-model.ts always mirrors
//    the accepted price into both sides of its own comparison). Proves
//    this module's OWN conflict handling is wired correctly regardless.
// ============================================================
{
  const notes = [];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const conflicted = Object.assign({}, report, {
    priceConflicts: [{ field: 'price', agreementValue: '190000', candidateValue: '199999' }],
  });
  const preview = buildPreview(conflicted, notes, POPULATED_ADDRESS);
  check('priceConflictCount reflects the synthetic conflict', preview.priceConflictCount, 1);
  checkTrue('a preview with a price conflict is NOT complete', preview.previewComplete === false);
  checkTrue('blockingReasons names the conflicting field and both values', preview.blockingReasons.some((r) => r.indexOf('price') >= 0 && r.indexOf('190000') >= 0 && r.indexOf('199999') >= 0));
}

// ============================================================
// 7. Document revision identity -- reuses board9-contract-model's own
//    isSameContractVersion verbatim, never a second implementation.
// ============================================================
{
  const notes = [];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = buildPreview(report, notes, POPULATED_ADDRESS);

  checkTrue('a preview is never stale against the exact version it was built from', D.isContractDocumentPreviewStale(preview, VERSION) === false);
  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null);
  checkTrue('bumping the version makes the same preview stale', D.isContractDocumentPreviewStale(preview, bumped.value) === true);
  checkTrue('isContractDocumentPreviewStale is exactly board9-contract-model\'s isSameContractVersion, negated', D.isContractDocumentPreviewStale(preview, VERSION) === !B.isSameContractVersion(preview.version, VERSION));
}

// ============================================================
// 8. Paragraph citations -- spot-checked against the real TREC 20-19
//    source PDF (docs/TREC Resale Home Contract.pdf), never invented.
// ============================================================
{
  const notes = [];
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ notes }));
  const preview = buildPreview(report, notes, POPULATED_ADDRESS);
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
// 9. Field/group labels mirror ContractWorkspace.tsx verbatim.
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
