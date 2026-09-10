/**
 * Seller contract facts -- pure model test runner. B9-05 / INV-60.
 *
 * Compiles contract-facts-model.ts and its dependency chain
 * (seller-contract-facts-carriers.ts, board9-contract-model.ts,
 * seller-call-outcome.ts, seller-call-readiness-carriers.ts -- all
 * already-shipped, unmodified by this issue) to a temp directory, loads
 * the emitted JavaScript, and runs deterministic table-driven cases.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-facts-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
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

const M = require(path.join(TMP, 'contract-facts-model.js'));
const C = require(path.join(TMP, 'seller-contract-facts-carriers.js'));

const FLOOR = 47;
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
const AGREED_PRICE = 190000;
const AGREEMENT_AT = '2026-09-06T15:00:00.000Z';

function baseArgs(over) {
  return Object.assign({
    opportunityId: OPP,
    notes: [],
    agreedPrice: AGREED_PRICE,
    agreementAt: AGREEMENT_AT,
    propertyAddress: '123 Main St, Austin, TX, 78701',
  }, over || {});
}

// ============================================================
// 1. Fixed constants -- exact values Brad supplied, never invented.
// ============================================================
{
  check('supported acquisition path is named exactly', M.SUPPORTED_ACQUISITION_PATH, 'Cash Acquisition / Assignment Exit');
  check('buyer entity default is the exact supplied name', M.BUYER_ENTITY_DEFAULT_NAME, 'Brad Thompson Consulting LLC');
  check('representation default is "none"', M.REPRESENTATION_DEFAULT, { kind: 'none' });
}

// ============================================================
// 2. Parties -- fixed defaults populate unconditionally; override flips
//    the source and is never silent about which applied.
// ============================================================
{
  const noOverride = M.computeSellerContractFactsReport(baseArgs());
  check('buyer entity resolves to the fixed default with no override present', noOverride.parties.buyerEntityName, { kind: 'populated', value: 'Brad Thompson Consulting LLC', authority: 'system_derived', recordedAt: null });
  check('buyer capacity is always populated (a fixed fact, not per-deal)', noOverride.parties.buyerCapacity.kind, 'populated');
  check('buyer Texas license status is always populated', noOverride.parties.buyerTexasLicenseStatus.value, 'None -- holds no Texas broker or sales-agent license, active or inactive');
  check('seller signers are unresolved with no carrier note recorded', noOverride.parties.sellerSigners, { kind: 'unresolved' });

  const overrideNote = C.formatBuyerEntityOverrideNote({ opportunityId: OPP, at: '2026-09-07T00:00:00.000Z', operator: 'brad', buyerName: 'Special Purpose LLC', reason: 'This one deal only' });
  const withOverride = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: overrideNote }] }));
  check('an explicit override REPLACES the default and names its own authority -- never silent', withOverride.parties.buyerEntityName, { kind: 'populated', value: 'Special Purpose LLC', authority: 'brad_authorized', recordedAt: '2026-09-07T00:00:00.000Z' });
}

// ============================================================
// 3. Sales price -- Cash Acquisition / Assignment Exit resolves ONLY
//    paragraph 3, and 3B is always $0.
// ============================================================
{
  const report = M.computeSellerContractFactsReport(baseArgs());
  check('3A cash portion equals the authoritative accepted price', report.salesPrice.cashPortion, { kind: 'populated', value: AGREED_PRICE, authority: 'system_derived', recordedAt: AGREEMENT_AT });
  check('3B financing sum is fixed at $0, unconditionally', report.salesPrice.financingSum, { kind: 'populated', value: 0, authority: 'system_derived', recordedAt: null });
  check('3C sales price equals the authoritative accepted price', report.salesPrice.salesPrice.value, AGREED_PRICE);
  check('the financing posture note cites the supported path by name', report.salesPrice.financingPostureNote.indexOf('Cash Acquisition / Assignment Exit') >= 0, true);

  const differentAgreedPrice = M.computeSellerContractFactsReport(baseArgs({ agreedPrice: 205000 }));
  check('a DIFFERENT accepted price changes 3A/3C together -- never independently', [differentAgreedPrice.salesPrice.cashPortion.value, differentAgreedPrice.salesPrice.salesPrice.value], [205000, 205000]);
  check('3B remains $0 regardless of the accepted price', differentAgreedPrice.salesPrice.financingSum.value, 0);
}

// ============================================================
// 4. Financing addenda -- always unsupported, never a per-deal choice,
//    regardless of any other input.
// ============================================================
{
  const report = M.computeSellerContractFactsReport(baseArgs());
  check('financing addenda are fixed not_applicable', report.addendaApplicability.financingAddenda.kind, 'not_applicable');
  check('financing addenda cite the exclusion by name (Third-Party/Seller/Loan Assumption)', /Third-Party Financing.*Seller Financing.*Loan Assumption/.test(report.addendaApplicability.financingAddenda.note), true);
  check('the addenda item-key schema itself contains no financing key at all', C.ADDENDA_APPLICABILITY_ITEM_KEYS.some((k) => /financ|assumption/i.test(k)), false);
}

// ============================================================
// 5. Every carrier-backed field is unresolved absent a note, populated
//    once one exists -- proven representatively across groups.
// ============================================================
{
  const empty = M.computeSellerContractFactsReport(baseArgs());
  check('property legal description is unresolved with no carrier note', empty.propertyLegalDescription.lot, { kind: 'unresolved' });
  check('earnest money is unresolved with no carrier note', empty.earnestMoneyOption.earnestMoney, { kind: 'unresolved' });
  check('title/survey is unresolved with no carrier note', empty.titleSurvey.titleCompanyName, { kind: 'unresolved' });
  check('closing date is unresolved with no carrier note', empty.closingPossession.closingDate, { kind: 'unresolved' });
  check('addenda applicability items are unresolved with no carrier note', empty.addendaApplicability.items, { kind: 'unresolved' });

  const closingNote = C.formatClosingPossessionFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: null, closingDate: '2026-10-01T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } });
  const withClosing = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: closingNote }] }));
  check('closing date becomes populated once its carrier note exists', withClosing.closingPossession.closingDate, { kind: 'populated', value: '2026-10-01T00:00:00.000Z', authority: 'operator_attested', recordedAt: AGREEMENT_AT });
}

// ============================================================
// 5b. Jess Gate correction: ¶5 never forces a positive amount. Each of
//     earnestMoney/optionFee/optionPeriodDays resolves independently to
//     populated / explicitly-not-applicable / unresolved, and additional
//     earnest money is never silently defaulted to "none."
// ============================================================
{
  const allNoneNote = C.formatEarnestMoneyOptionFactsNote({
    opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St',
    earnestMoney: { kind: 'none' }, optionFee: { kind: 'none' }, optionPeriodDays: { kind: 'none' }, additionalEarnestMoney: { kind: 'none' },
  });
  const allNone = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: allNoneNote }] }));
  check('earnest money explicitly none is not_applicable, never a blocking unresolved', allNone.earnestMoneyOption.earnestMoney.kind, 'not_applicable');
  check('option fee explicitly none is not_applicable', allNone.earnestMoneyOption.optionFee.kind, 'not_applicable');
  check('option period explicitly none is not_applicable', allNone.earnestMoneyOption.optionPeriodDays.kind, 'not_applicable');
  check('additional earnest money explicitly none is not_applicable (an explicit decision, not a silent default)', allNone.earnestMoneyOption.additionalEarnestMoney.kind, 'not_applicable');

  const amountsNote = C.formatEarnestMoneyOptionFactsNote({
    opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St',
    earnestMoney: { kind: 'amount', amount: 1000 }, optionFee: { kind: 'amount', amount: 200 }, optionPeriodDays: { kind: 'days', days: 10 },
    additionalEarnestMoney: { kind: 'value', amount: 5000, withinDays: 30 },
  });
  const withAmounts = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: amountsNote }] }));
  check('earnest money with an entered amount is populated with that exact amount', withAmounts.earnestMoneyOption.earnestMoney, { kind: 'populated', value: 1000, authority: 'operator_attested', recordedAt: AGREEMENT_AT });
  check('option period with entered days is populated with that exact day count', withAmounts.earnestMoneyOption.optionPeriodDays, { kind: 'populated', value: 10, authority: 'operator_attested', recordedAt: AGREEMENT_AT });
  check('additional earnest money with an explicit applicable value is populated with the full fact', withAmounts.earnestMoneyOption.additionalEarnestMoney, { kind: 'populated', value: { kind: 'value', amount: 5000, withinDays: 30 }, authority: 'operator_attested', recordedAt: AGREEMENT_AT });

  const noNote = M.computeSellerContractFactsReport(baseArgs());
  check('with no ¶5 carrier note at all, every one of its fields is unresolved -- not "none" by default', [noNote.earnestMoneyOption.earnestMoney.kind, noNote.earnestMoneyOption.optionFee.kind, noNote.earnestMoneyOption.optionPeriodDays.kind, noNote.earnestMoneyOption.additionalEarnestMoney.kind], ['unresolved', 'unresolved', 'unresolved', 'unresolved']);
}

// ============================================================
// 6. Notice contact info -- Jess Gate correction: BTC LLC's own info AND
//    the seller's ¶21 notice are BOTH sourced ONLY from their own
//    carriers -- never hardcoded, never the property address.
// ============================================================
{
  const empty = M.computeSellerContractFactsReport(baseArgs());
  check('buyer notice address is unresolved with no business config carrier note', empty.noticeContact.buyerNoticeAddress, { kind: 'unresolved' });
  check('buyer signer name is unresolved with no business config carrier note', empty.noticeContact.buyerSignerName, { kind: 'unresolved' });
  check('buyer signer role is unresolved with no business config carrier note', empty.noticeContact.buyerSignerRole, { kind: 'unresolved' });
  check('seller notice address is UNRESOLVED even though a property address is present -- it is never used as a fallback', empty.noticeContact.sellerNoticeAddress, { kind: 'unresolved' });

  const configNote = C.formatBuyerBusinessConfigFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '1 Business Rd', noticePhone: '555-0000', noticeEmail: 'buyer@btcllc.example', signerName: 'Brad Thompson', signerRole: 'Manager' });
  const withConfig = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: configNote }] }));
  check('buyer notice address becomes populated once its own business-config carrier note exists', withConfig.noticeContact.buyerNoticeAddress, { kind: 'populated', value: '1 Business Rd', authority: 'brad_authorized', recordedAt: AGREEMENT_AT });

  const sellerNoticeNote = C.formatSellerNoticeConfirmationFactsNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: null, noticeAddress: '456 Oak St, Dallas, TX 75201', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' }, source: 'operator_corrected' });
  const withSellerNotice = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: sellerNoticeNote }] }));
  check('seller notice address is populated ONLY from its own explicit confirmation carrier, and may legitimately differ from the property address', withSellerNotice.noticeContact.sellerNoticeAddress, { kind: 'populated', value: '456 Oak St, Dallas, TX 75201', authority: 'operator_attested', recordedAt: AGREEMENT_AT });
  check('seller notice phone is not_applicable when explicitly confirmed none', withSellerNotice.noticeContact.sellerNoticePhone.kind, 'not_applicable');
  check('seller notice email is populated when an explicit value is confirmed', withSellerNotice.noticeContact.sellerNoticeEmail, { kind: 'populated', value: 'seller@example.com', authority: 'operator_attested', recordedAt: AGREEMENT_AT });
}

// ============================================================
// 7. Attorney/manual fields -- disposition/provenance tracked, content
//    never interpreted; "will draft" still blocks Send until actually
//    provided.
// ============================================================
{
  const empty = M.computeSellerContractFactsReport(baseArgs());
  check('special provisions unresolved with nothing recorded', empty.attorneyManualFields.specialProvisions, { kind: 'unresolved' });

  const naNote = C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } });
  const withNa = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: naNote }] }));
  check('an explicit not_applicable disposition is respected, not treated as unresolved', withNa.attorneyManualFields.specialProvisions.kind, 'not_applicable');

  const willDraftNote = C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'attorney_will_draft' } });
  const withWillDraft = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: willDraftNote }] }));
  check('"attorney_will_draft" is STILL unresolved -- intent to draft is not drafted content', withWillDraft.attorneyManualFields.otherAddendaText, { kind: 'unresolved' });

  const verbatimNote = C.formatAttorneyManualFieldDispositionNote({ opportunityId: OPP, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'provided_verbatim', text: 'Attorney-drafted text.' } });
  const withVerbatim = M.computeSellerContractFactsReport(baseArgs({ notes: [{ body: verbatimNote }] }));
  check('"provided_verbatim" is populated once real text is supplied', withVerbatim.attorneyManualFields.specialProvisions.kind, 'populated');
}

// ============================================================
// 8. Readiness rollup -- ruling 6: unresolved blocks Send for Signature.
// ============================================================
{
  const allUnresolved = M.computeSellerContractFactsReadiness(M.computeSellerContractFactsReport(baseArgs()));
  check('an all-unresolved report blocks Send for Signature', allUnresolved.blocksSendForSignature, true);
  check('the unresolved list is non-empty when fields are unresolved', allUnresolved.unresolvedFields.length > 0, true);
  check('the fixed-default parties fields (never unresolved) do not appear in the unresolved list', allUnresolved.unresolvedFields.some((f) => f.field === 'buyerEntityName' || f.field === 'buyerCapacity'), false);

  // Same-address recorded price -- no conflict, still blocks purely on unresolved fields.
  const noConflict = M.computeSellerContractFactsReadiness(M.computeSellerContractFactsReport(baseArgs()));
  check('price conflict list is empty when nothing contradicts the accepted price', noConflict.blocksSendForSignature && M.computeSellerContractFactsReport(baseArgs()).priceConflicts.length === 0, true);
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
