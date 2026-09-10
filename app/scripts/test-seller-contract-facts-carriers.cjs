/**
 * Seller contract facts carriers -- test runner. B9-05 / INV-60.
 *
 * Compiles seller-contract-facts-carriers.ts standalone, loads the
 * emitted JavaScript, and runs deterministic table-driven cases: a
 * round-trip per carrier, fail-closed malformed-input cases, and
 * latest-wins/opportunity-scoping proof. No GHL, no network, no React.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-contract-facts-carriers-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [path.join(LIB, 'seller-contract-facts-carriers.ts')];

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

const M = require(path.join(TMP, 'seller-contract-facts-carriers.js'));

const FLOOR = 51;
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

const OPP = 'opp-1';
const AT = '2026-09-10T12:00:00.000Z';

// ============================================================
// 1. Buyer entity override
// ============================================================
{
  const note = M.formatBuyerEntityOverrideNote({ opportunityId: OPP, at: AT, operator: 'brad', buyerName: 'Some Other LLC', reason: 'One-off deal-specific reason' });
  const parsed = M.parseBuyerEntityOverrideNote(note);
  check('buyer entity override round-trips', parsed, { opportunityId: OPP, at: AT, operator: 'brad', buyerName: 'Some Other LLC', reason: 'One-off deal-specific reason' });
  check('buyer entity override fails closed on empty reason', M.parseBuyerEntityOverrideNote(note.replace('One-off deal-specific reason', '')), null);
  const older = M.formatBuyerEntityOverrideNote({ opportunityId: OPP, at: '2026-09-01T00:00:00.000Z', operator: null, buyerName: 'Old LLC', reason: 'old' });
  check('buyer entity override latest-wins scoped to opportunity', M.latestBuyerEntityOverrideForOpportunity([{ body: older }, { body: note }], OPP).buyerName, 'Some Other LLC');
  check('buyer entity override ignores a different opportunity', M.latestBuyerEntityOverrideForOpportunity([{ body: note }], 'opp-other'), null);
}

// ============================================================
// 2. Party/signer facts
// ============================================================
{
  const signers = [{ role: 'seller_1', displayName: 'Jane Seller', signingAuthorityNote: null }, { role: 'seller_2', displayName: 'John Seller', signingAuthorityNote: 'POA' }];
  const note = M.formatPartySignerFactsNote({ opportunityId: OPP, at: AT, operator: null, signers });
  check('party/signer facts round-trip', M.parsePartySignerFactsNote(note).signers, signers);
  check('party/signer facts fail closed on empty array', M.parsePartySignerFactsNote(M.formatPartySignerFactsNote({ opportunityId: OPP, at: AT, operator: null, signers: [] })), null);
  check('party/signer facts fail closed on malformed entry', M.parsePartySignerFactsNote(note.replace('"seller_1"', '""')), null);
}

// ============================================================
// 3. Property legal description facts
// ============================================================
{
  const args = { opportunityId: OPP, at: AT, operator: null, lot: { kind: 'value', value: '7' }, block: { kind: 'none' }, addition: { kind: 'value', value: 'Sunset Ridge' }, county: { kind: 'value', value: 'Travis' }, exclusions: { kind: 'none' }, reservations: { kind: 'none' } };
  const note = M.formatPropertyLegalDescriptionFactsNote(args);
  const parsed = M.parsePropertyLegalDescriptionFactsNote(note);
  check('property legal description round-trips (value/none mix)', { lot: parsed.lot, block: parsed.block }, { lot: args.lot, block: args.block });
  check('property legal description: reservations "applies" requires an addendum note', M.parsePropertyLegalDescriptionFactsNote(note.replace('{"kind":"none"}', '{"kind":"applies"}')), null);
}

// ============================================================
// 4. Lease disclosure facts
// ============================================================
{
  const note = M.formatLeaseDisclosureFactsNote({ opportunityId: OPP, at: AT, operator: null, residentialLeases: 'none', fixtureLeases: 'applies', naturalResourceLeases: { kind: 'not_yet_delivered', terminateWithinDays: 3 } });
  const parsed = M.parseLeaseDisclosureFactsNote(note);
  check('lease disclosure round-trips', parsed.naturalResourceLeases, { kind: 'not_yet_delivered', terminateWithinDays: 3 });
  check('lease disclosure fails closed on a fifth checkbox state', M.parseLeaseDisclosureFactsNote(note.replace('none', 'maybe')), null);
}

// ============================================================
// 5. Earnest money and option facts -- Jess Gate correction: each of
//    earnestMoney/optionFee/optionPeriodDays is AmountOrNone/DaysOrNone,
//    never forced positive.
// ============================================================
{
  const note = M.formatEarnestMoneyOptionFactsNote({
    opportunityId: OPP, at: AT, operator: null, escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St',
    earnestMoney: { kind: 'amount', amount: 1000 }, optionFee: { kind: 'amount', amount: 200 }, optionPeriodDays: { kind: 'days', days: 10 },
    additionalEarnestMoney: { kind: 'none' },
  });
  const parsed = M.parseEarnestMoneyOptionFactsNote(note);
  check('earnest money/option round-trips with entered amounts', [parsed.earnestMoney, parsed.optionFee, parsed.optionPeriodDays], [{ kind: 'amount', amount: 1000 }, { kind: 'amount', amount: 200 }, { kind: 'days', days: 10 }]);
  const noneNote = M.formatEarnestMoneyOptionFactsNote({
    opportunityId: OPP, at: AT, operator: null, escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St',
    earnestMoney: { kind: 'none' }, optionFee: { kind: 'none' }, optionPeriodDays: { kind: 'none' },
    additionalEarnestMoney: { kind: 'none' },
  });
  const noneParsed = M.parseEarnestMoneyOptionFactsNote(noneNote);
  check('earnest money/option round-trips with explicit none -- never forced positive', [noneParsed.earnestMoney, noneParsed.optionFee, noneParsed.optionPeriodDays], [{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }]);
  check('earnest money fails closed on zero/negative amount', M.parseEarnestMoneyOptionFactsNote(note.replace('"amount":1000', '"amount":0')), null);
  check('option period fails closed on a non-integer', M.parseEarnestMoneyOptionFactsNote(note.replace('"days":10', '"days":10.5')), null);
  check('option period fails closed on an unrecognized kind', M.parseEarnestMoneyOptionFactsNote(note.replace('{"kind":"days","days":10}', '{"kind":"weeks","days":10}')), null);
}

// ============================================================
// 6. Title and survey facts
// ============================================================
{
  const args = {
    opportunityId: OPP, at: AT, operator: null,
    titlePolicyExpenseParty: 'seller', titleCompanyName: 'ABC Title',
    shortageAmendmentElection: { kind: 'not_amended' },
    surveyElection: { option: 'buyer_new_survey', buyerObtainDays: 15 },
    objectionsText: { kind: 'none' }, objectionsDays: 5, poaMembership: 'is_not_subject',
  };
  const note = M.formatTitleSurveyFactsNote(args);
  const parsed = M.parseTitleSurveyFactsNote(note);
  check('title/survey round-trips', [parsed.titlePolicyExpenseParty, parsed.surveyElection, parsed.poaMembership], ['seller', args.surveyElection, 'is_not_subject']);
  check('title/survey fails closed on an unknown expense party', M.parseTitleSurveyFactsNote(note.replace('Title policy expense party: seller', 'Title policy expense party: escrow')), null);
  check('title/survey fails closed on an unknown survey option', M.parseTitleSurveyFactsNote(note.replace('"buyer_new_survey"', '"tenant_survey"')), null);
}

// ============================================================
// 7. Property condition facts
// ============================================================
{
  const args = {
    opportunityId: OPP, at: AT, operator: null,
    sellerDisclosureNotice: { kind: 'received' },
    asIsElection: { kind: 'as_is' },
    serviceContractCap: { kind: 'none' },
    waterDisclosure: { kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'City of Austin' },
  };
  const note = M.formatPropertyConditionFactsNote(args);
  const parsed = M.parsePropertyConditionFactsNote(note);
  check('property condition round-trips', parsed.asIsElection, { kind: 'as_is' });
  check('property condition: as-is-with-repairs requires non-empty repairsText', M.parsePropertyConditionFactsNote(note.replace('{"kind":"as_is"}', '{"kind":"as_is_with_repairs","repairsText":""}')), null);
  check('property condition: water-disclosure exemption requires ALL sub-facts true', M.parsePropertyConditionFactsNote(note.replace('"noWell":true', '"noWell":false')), null);
}

// ============================================================
// 8. Closing and possession facts
// ============================================================
{
  const note = M.formatClosingPossessionFactsNote({ opportunityId: OPP, at: AT, operator: null, closingDate: '2026-10-01T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } });
  const parsed = M.parseClosingPossessionFactsNote(note);
  check('closing/possession round-trips', [parsed.closingDate, parsed.possessionElection], ['2026-10-01T00:00:00.000Z', 'upon_closing_and_funding']);
  check('closing/possession fails closed on a non-canonical closing date', M.parseClosingPossessionFactsNote(note.replace('2026-10-01T00:00:00.000Z\nRecorded'.split('\n')[0], '2026-10-01')), null);
}

// ============================================================
// 9. Settlement expense facts
// ============================================================
{
  const note = M.formatSettlementExpenseFactsNote({ opportunityId: OPP, at: AT, operator: null, sellerCreditCap: { kind: 'none' }, sellerPaysBuyerBroker: { kind: 'dollar', amount: 500 }, buyerPaysSellerBroker: { kind: 'none' } });
  const parsed = M.parseSettlementExpenseFactsNote(note);
  check('settlement expense round-trips', parsed.sellerPaysBuyerBroker, { kind: 'dollar', amount: 500 });
  check('settlement expense fails closed on percent > 100', M.parseSettlementExpenseFactsNote(note.replace('{"kind":"dollar","amount":500}', '{"kind":"percent","percent":150}')), null);
}

// ============================================================
// 10. Representation facts
// ============================================================
{
  const noneNote = M.formatRepresentationFactsNote({ opportunityId: OPP, at: AT, operator: null, representation: { kind: 'none' } });
  check('representation "none" round-trips', M.parseRepresentationFactsNote(noneNote).representation, { kind: 'none' });
  const broker = { firmName: 'ABC Realty', licenseNo: '123', associateName: 'Jane Agent', associateLicenseNo: '456', email: 'a@b.com', phone: '555-0100' };
  const repNote = M.formatRepresentationFactsNote({ opportunityId: OPP, at: AT, operator: null, representation: { kind: 'represented', sellerAgent: broker, buyerAgent: null } });
  check('representation "represented" round-trips with a null buyerAgent', M.parseRepresentationFactsNote(repNote).representation, { kind: 'represented', sellerAgent: broker, buyerAgent: null });
  check('representation fails closed on an incomplete broker record', M.parseRepresentationFactsNote(repNote.replace('"licenseNo":"123"', '"licenseNo":""')), null);
}

// ============================================================
// 11. Addenda applicability facts
// ============================================================
{
  const items = {};
  for (const k of M.ADDENDA_APPLICABILITY_ITEM_KEYS) items[k] = false;
  items.mineral_reservation = true;
  const note = M.formatAddendaApplicabilityFactsNote({ opportunityId: OPP, at: AT, operator: null, items, districtNotices: { kind: 'none' } });
  const parsed = M.parseAddendaApplicabilityFactsNote(note);
  check('addenda applicability round-trips', parsed.items, items);
  check('addenda applicability fails closed on a missing key', M.parseAddendaApplicabilityFactsNote(note.replace('"mineral_reservation":true', '')), null);
  check('addenda applicability item-key list has no financing addenda in it (unsupported in V1)', M.ADDENDA_APPLICABILITY_ITEM_KEYS.some((k) => /financ|loan_assumption|seller_financing|third_party/i.test(k)), false);
}

// ============================================================
// 12. Seller-side equitable-interest disclosure
// ============================================================
{
  const notYet = M.formatSellerEquitableInterestDisclosureNote({ opportunityId: OPP, at: AT, operator: null, disposition: { kind: 'not_yet_made' } });
  check('equitable-interest "not_yet_made" round-trips', M.parseSellerEquitableInterestDisclosureNote(notYet).disposition, { kind: 'not_yet_made' });
  const made = M.formatSellerEquitableInterestDisclosureNote({ opportunityId: OPP, at: AT, operator: 'brad', disposition: { kind: 'made', at: '2026-09-05T00:00:00.000Z' } });
  check('equitable-interest "made" round-trips with its own timestamp', M.parseSellerEquitableInterestDisclosureNote(made).disposition, { kind: 'made', at: '2026-09-05T00:00:00.000Z' });
  check('equitable-interest fails closed on a malformed "made" timestamp', M.parseSellerEquitableInterestDisclosureNote(made.replace('2026-09-05T00:00:00.000Z"', 'not-a-date"')), null);
}

// ============================================================
// 13. Attorney/manual field disposition -- opaque text, never interpreted
// ============================================================
{
  const na = M.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AT, operator: null, slot: 'special_provisions', disposition: { kind: 'not_applicable' } });
  check('attorney field "not_applicable" round-trips', M.parseAttorneyManualFieldDispositionNote(na).disposition, { kind: 'not_applicable' });
  const willDraft = M.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AT, operator: null, slot: 'other_addenda_text', disposition: { kind: 'attorney_will_draft' } });
  check('attorney field "attorney_will_draft" round-trips, scoped to its own slot', M.latestAttorneyManualFieldDispositionForOpportunity([{ body: na }, { body: willDraft }], OPP, 'other_addenda_text').disposition, { kind: 'attorney_will_draft' });
  const verbatim = M.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: 'Exact attorney-drafted text, stored opaquely.' } });
  check('attorney field "provided_verbatim" preserves the text exactly, byte for byte', M.parseAttorneyManualFieldDispositionNote(verbatim).disposition.text, 'Exact attorney-drafted text, stored opaquely.');
  check('attorney field fails closed on blank verbatim text', M.parseAttorneyManualFieldDispositionNote(verbatim.replace('Exact attorney-drafted text, stored opaquely.', '')), null);
  check('the two slots are independently scoped -- special_provisions unaffected by other_addenda_text', M.latestAttorneyManualFieldDispositionForOpportunity([{ body: verbatim }, { body: willDraft }], OPP, 'special_provisions').disposition.kind, 'provided_verbatim');
}

// ============================================================
// 14. Seller notice confirmation facts -- Jess Gate correction: an
//     EXPLICIT confirmation, never the property address.
// ============================================================
{
  const confirmed = M.formatSellerNoticeConfirmationFactsNote({
    opportunityId: OPP, at: AT, operator: null,
    noticeAddress: '123 Main St, Austin, TX 78701',
    noticePhone: { kind: 'value', value: '512-555-0100' },
    noticeEmail: { kind: 'none' },
    source: 'confirmed_from_contact_record',
  });
  const parsedConfirmed = M.parseSellerNoticeConfirmationFactsNote(confirmed);
  check('seller notice confirmation round-trips with a confirmed-from-contact source', { noticeAddress: parsedConfirmed.noticeAddress, noticePhone: parsedConfirmed.noticePhone, noticeEmail: parsedConfirmed.noticeEmail, source: parsedConfirmed.source }, { noticeAddress: '123 Main St, Austin, TX 78701', noticePhone: { kind: 'value', value: '512-555-0100' }, noticeEmail: { kind: 'none' }, source: 'confirmed_from_contact_record' });
  const corrected = M.formatSellerNoticeConfirmationFactsNote({
    opportunityId: OPP, at: AT, operator: 'brad',
    noticeAddress: 'PO Box 99, Dallas, TX 75201',
    noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' },
    source: 'operator_corrected',
  });
  check('seller notice confirmation round-trips with an operator-corrected address', M.parseSellerNoticeConfirmationFactsNote(corrected).source, 'operator_corrected');
  check('seller notice confirmation fails closed on an empty notice address', M.parseSellerNoticeConfirmationFactsNote(confirmed.replace('123 Main St, Austin, TX 78701', '')), null);
  check('seller notice confirmation fails closed on an unrecognized source', M.parseSellerNoticeConfirmationFactsNote(confirmed.replace('confirmed_from_contact_record', 'assumed')), null);
  const older = M.formatSellerNoticeConfirmationFactsNote({ opportunityId: OPP, at: '2026-09-01T00:00:00.000Z', operator: null, noticeAddress: 'Old address', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'none' }, source: 'confirmed_from_contact_record' });
  check('seller notice confirmation latest-wins scoped to opportunity', M.latestSellerNoticeConfirmationFactsForOpportunity([{ body: older }, { body: confirmed }], OPP).noticeAddress, '123 Main St, Austin, TX 78701');
  check('seller notice confirmation ignores a different opportunity', M.latestSellerNoticeConfirmationFactsForOpportunity([{ body: confirmed }], 'opp-other'), null);
}

// ============================================================
// 15. Buyer business config facts -- a real capture path, not a `null`
// ============================================================
{
  const args = { opportunityId: OPP, at: AT, operator: 'brad', noticeAddress: '1 Buyer Way, Austin, TX 78701', noticePhone: '512-555-0199', noticeEmail: 'buyer@btcllc.com', signerName: 'Brad Thompson', signerRole: 'Manager' };
  const note = M.formatBuyerBusinessConfigFactsNote(args);
  const parsed = M.parseBuyerBusinessConfigFactsNote(note);
  check('buyer business config round-trips', { noticeAddress: parsed.noticeAddress, noticePhone: parsed.noticePhone, noticeEmail: parsed.noticeEmail, signerName: parsed.signerName, signerRole: parsed.signerRole }, { noticeAddress: args.noticeAddress, noticePhone: args.noticePhone, noticeEmail: args.noticeEmail, signerName: args.signerName, signerRole: args.signerRole });
  check('buyer business config fails closed on an empty signer role', M.parseBuyerBusinessConfigFactsNote(note.replace('Manager', '')), null);
  check('buyer business config fails closed on an empty notice email', M.parseBuyerBusinessConfigFactsNote(note.replace('buyer@btcllc.com', '')), null);
  const older = M.formatBuyerBusinessConfigFactsNote({ ...args, at: '2026-09-01T00:00:00.000Z', noticeAddress: 'Old address' });
  check('buyer business config latest-wins scoped to opportunity', M.latestBuyerBusinessConfigFactsForOpportunity([{ body: older }, { body: note }], OPP).noticeAddress, args.noticeAddress);
  check('buyer business config ignores a different opportunity', M.latestBuyerBusinessConfigFactsForOpportunity([{ body: note }], 'opp-other'), null);
}

cleanup();

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
