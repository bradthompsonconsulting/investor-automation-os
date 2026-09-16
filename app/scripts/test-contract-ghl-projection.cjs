/**
 * INV-67 / B9-12 contract-population repair, extended by the INV-67
 * checkbox-marker / broker-model repair -- deterministic proof of
 * `contract-ghl-projection-model.ts`'s PLAN-LEVEL integration. Pure
 * functions and static drift checks only; no GHL, no network.
 *
 * Per-fact-group marker derivation, exclusivity, broker-text decomposition,
 * and consistency checks are exhaustively tested in their OWN dedicated
 * suites (`test-contract-checkbox-marker-model.cjs`,
 * `test-contract-broker-arrangement-model.cjs`) -- this file proves
 * `buildContractProjectionPlan` correctly WIRES all of it together:
 *
 *  1. Fails closed on an incomplete preview / unresolved equitable-interest
 *     gate (UNCHANGED from the original repair).
 *  2. The happy path produces exactly 110 entries -- 29 retained document-
 *     line entries + 48 markers + 11 restructured text + 22 broker text.
 *  3. A marker-exclusivity violation, a mineral-reservation disagreement,
 *     and a blocking broker arrangement (intermediary /
 *     represented-but-empty) each block the WHOLE plan, each with the
 *     expected message -- never a partial plan.
 *  4. A POA/addendum disagreement surfaces as a `warnings` entry and does
 *     NOT block.
 *  5. Invariant and reused-current-offer keys are excluded; the 19 retired
 *     keys are excluded too.
 *  6. `reusedCurrentOfferLines` is unaffected by this session's changes.
 *  7. Integrity guards (mapping drift / null text) still fire for the
 *     retained document-line keys.
 *  8. Drift guard: `shared/ghl-config.ts`'s 110-key list matches this
 *     module's exactly; the field-creation script's 48 already-provisioned
 *     keys remain EXACTLY the original 29 retained + 19 retired keys (that
 *     script provisions nothing new -- its key set is untouched even
 *     though 19 of those keys are no longer live). Batch 1 + Batch 2 +
 *     Batch 3 GHL Test provisioning (2026-09-14/15,
 *     `inv67-create-checkbox-marker-fields-batch1.cjs --apply`, then
 *     `inv67-create-checkbox-text-fields-batch2.cjs --apply`, then
 *     `inv67-create-broker-text-fields-batch3.cjs --apply`): `shared/
 *     ghl-config.ts`'s TEST config now carries a real id for EVERY ONE of
 *     the 110 live projection keys (29 retained + 48 Batch 1 markers + 11
 *     Batch 2 contract-text keys + 22 Batch 3 broker-text keys, all
 *     unique, none the sentinel -- ZERO sentinels remain in TEST), each
 *     batch's ids checked against a complete, known-good reference map
 *     (never a sample, never key-presence-only), no retired key re-enters
 *     the live map, earlier batches' ids are proven unchanged by each
 *     later wiring step, and PRODUCTION remains fully sentinel-filled for
 *     all 110 keys -- proven directly against the committed file, not
 *     merely asserted.
 *
 * INV-67 PHASE 2B (this session) expands the live inventory from 112 to
 * exactly 118 unique keys: `propertyLegalDescription.legalMunicipality`
 * (retained, +1 -> 28), `sales_price_amount_text` /
 * `financing_sum_amount_text` (transport-only, +2 -> 6),
 * `district_notices_mark` / `other_addenda_mark` (checkbox markers, +2 ->
 * 50), `as_is_repairs_text` (checkbox-adjacent text, +1 -> 12). Broker text
 * stays 22. All 112 previously-verified TEST ids remain byte-for-byte
 * unchanged; the 6 new keys are sentinel-filled in BOTH `TEST` and
 * `PRODUCTION` pending a separately authorized Batch 5 apply
 * (`scripts/inv67-create-batch5-fields.cjs`, dry-run only, not performed
 * this session). `salesPrice.financingSum` is REMOVED from
 * `CONTRACT_PROJECTION_INVARIANT_KEYS` (it now projects, defensively
 * re-verified at $0 every sync rather than merely asserted true by source).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-ghl-projection-test');
const MODEL = path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts');
const MARKER_MODEL = path.join(APP, 'src', 'lib', 'contract-checkbox-marker-model.ts');
const BROKER_MODEL = path.join(APP, 'src', 'lib', 'contract-broker-arrangement-model.ts');
const CARRIERS = path.join(APP, 'src', 'lib', 'seller-contract-facts-carriers.ts');
const TRANSPORT = path.join(APP, 'src', 'lib', 'contract-ghl-transport-formatting.ts');
const SIGNING_MODEL = path.join(APP, 'src', 'lib', 'contract-seller-signing-model.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(
    `npx tsc "${MODEL}" "${MARKER_MODEL}" "${BROKER_MODEL}" "${CARRIERS}" "${TRANSPORT}" "${SIGNING_MODEL}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const {
  CONTRACT_PROJECTION_FIELD_KEYS,
  CONTRACT_PROJECTION_INVARIANT_KEYS,
  CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS,
  CONTRACT_PROJECTION_RETIRED_KEYS,
  CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS,
  CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS,
  buildContractProjectionPlan,
  reusedCurrentOfferLines,
} = require(path.join(TMP, 'contract-ghl-projection-model.js'));
const {
  CHECKBOX_MARKER_KEYS, CHECKBOX_TEXT_KEYS, BROKER_TEXT_KEYS,
  CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS, CHECKBOX_MARKER_TOTAL_TEMPLATE_PLACEMENTS,
} = require(path.join(TMP, 'contract-checkbox-marker-model.js'));
const { ADDENDA_APPLICABILITY_ITEM_KEYS } = require(path.join(TMP, 'seller-contract-facts-carriers.js'));
const {
  checkClosingDateCenturyBound,
} = require(path.join(TMP, 'contract-ghl-transport-formatting.js'));
const {
  evaluateSellerSigningReadiness,
  evaluateSellerSigningPreWriteReadiness,
  sellerCountTransportValue,
} = require(path.join(TMP, 'contract-seller-signing-model.js'));

const FLOOR = 298;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name);
    console.log('      expected: ' + JSON.stringify(expected));
    console.log('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }

/* ==================================================================== */
/* Fixtures                                                              */
/* ==================================================================== */

const VERSION = { agreementAt: '2026-09-01T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };

/**
 * Jess re-gate correction (this session) -- `buildContractProjectionPlan`
 * now takes a fourth, REQUIRED `sellerReadiness` argument (see
 * `contract-seller-signing-model.ts`'s `SellerSigningReadinessResult`).
 * Every pre-existing TREC-fact-only test above this section is
 * deliberately UNCHANGED in intent -- it passes this fixed "ok" fixture so
 * it keeps testing ONLY what it always tested. The seller-readiness FOLD
 * itself is proven separately, in its own section below.
 */
const SELLER_READINESS_OK = { ok: true };

function line(group, field, status, text) {
  return { paragraph: 'X', group, field, label: `${group}.${field}`, status, text, authority: status === 'unresolved' ? null : 'system_derived', recordedAt: null };
}

/** A complete, resolvable preview covering ONLY the 29 retained document-line keys + the 4 invariant/2 reused keys the preview itself still carries as document lines. */
function completePreview(overrides) {
  const documentLines = [
    line('identity', 'propertyStreetAddress', 'populated', '123 Main St'),
    line('parties', 'buyerEntityName', 'populated', 'Brad Thompson Consulting LLC'),
    line('parties', 'buyerCapacity', 'populated', 'Principal, purchasing for its own account'),
    line('parties', 'buyerTexasLicenseStatus', 'populated', 'None'),
    line('parties', 'sellerSigners', 'populated', 'Jane Seller (Owner)'),
    line('salesPrice', 'cashPortion', 'populated', '$275,000.00'),
    line('salesPrice', 'financingSum', 'populated', '$0.00'),
    line('salesPrice', 'salesPrice', 'populated', '$275,000.00'),
    ...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS
      .filter((k) => !['identity.propertyStreetAddress', 'parties.buyerEntityName', 'parties.sellerSigners'].includes(k))
      .map((k) => { const [g, f] = k.split('.'); return line(g, f, 'populated', `value for ${k}`); }),
  ];
  const additionalRequiredFacts = [line('sellerEquitableInterest', 'disposition', 'populated', 'Made at 2026-09-01T00:00:00.000Z.')];
  return {
    templateName: 'x', templateSource: 'x', opportunityId: 'OPP-1', version: VERSION,
    documentLines, additionalRequiredFacts,
    unresolvedFieldCount: 0, priceConflictCount: 0, previewComplete: true, blockingReasons: [],
    ...overrides,
  };
}

/** Overrides specific `preview.documentLines` entries by group/field, leaving every other line from `completePreview()` untouched. */
function withLineOverrides(overrides) {
  const base = completePreview();
  const documentLines = base.documentLines.map((l) => {
    const o = overrides.find((x) => x.group === l.group && x.field === l.field);
    return o ? { ...l, status: o.status, text: o.text } : l;
  });
  return { ...base, documentLines };
}

function populated(value) { return { kind: 'populated', value, authority: 'operator_attested', recordedAt: null }; }

/**
 * A complete, resolvable SellerContractFactsReport -- every checkbox-shaped
 * fact `buildCheckboxMarkersAndText` reads, all clean/no-conflict by
 * default, PLUS (compound text-destination repair, this session) every
 * canonical fact the fourteen `REFORMATTED_RETAINED_KEYS` and the four new
 * `CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS` now read DIRECTLY from `report`
 * rather than from `preview.documentLines`.
 */
function completeReport(overrides) {
  const base = {
    parties: {
      sellerSigners: populated([
        { displayName: 'Jane Seller', role: 'Owner', signingAuthorityNote: 'as trustee' },
      ]),
    },
    propertyLegalDescription: {
      lot: populated({ kind: 'value', value: '7' }),
      block: populated({ kind: 'value', value: '3' }),
      addition: populated({ kind: 'value', value: 'Oak Ridge Estates' }),
      county: populated({ kind: 'value', value: 'Travis' }),
      exclusions: populated({ kind: 'none' }),
      reservations: populated({ kind: 'none' }),
      legalMunicipality: populated({ kind: 'municipality', name: 'Round Rock' }),
    },
    // INV-67 Phase 2B -- `salesPrice.salesPrice` must agree with `cashPortion`
    // (¶3A/¶3C) and `financingSum` must be exactly $0, matching the SAME
    // $275,000.00 the `completePreview()` fixture's own salesPrice document
    // lines already show.
    salesPrice: {
      salesPrice: populated(275000),
      cashPortion: populated(275000),
      financingSum: populated(0),
    },
    earnestMoneyOption: {
      earnestMoney: populated(1000),
      optionFee: populated(500),
      optionPeriodDays: populated(10),
      additionalEarnestMoney: populated({ kind: 'none' }),
    },
    leaseDisclosure: {
      residentialLeases: populated('none'),
      fixtureLeases: populated('none'),
      naturalResourceLeases: populated({ kind: 'none' }),
    },
    titleSurvey: {
      titlePolicyExpenseParty: populated('seller'),
      shortageAmendmentElection: populated({ kind: 'not_amended' }),
      surveyElection: populated({ option: 'buyer_new_survey', buyerObtainDays: 10 }),
      poaMembership: populated('is_not_subject'),
      objectionsText: populated({ kind: 'none' }),
      objectionsDays: populated(15),
    },
    propertyCondition: {
      sellerDisclosureNotice: populated({ kind: 'received' }),
      asIsElection: populated({ kind: 'as_is' }),
      waterDisclosure: populated({ kind: 'received' }),
      serviceContractCap: populated({ kind: 'none' }),
    },
    closingPossession: {
      possessionElection: populated('upon_closing_and_funding'),
      closingDate: populated('2026-12-15T00:00:00.000Z'),
    },
    settlementExpense: {
      sellerPaysBuyerBroker: populated({ kind: 'none' }),
      buyerPaysSellerBroker: populated({ kind: 'none' }),
      sellerCreditCap: populated({ kind: 'none' }),
    },
    addendaApplicability: {
      items: populated(Object.fromEntries(ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false]))),
      districtNotices: populated({ kind: 'none' }),
    },
    representation: {
      representation: populated({ kind: 'none' }),
    },
    // INV-67 Phase 2B -- `other_addenda_mark` reads this disposition directly
    // (never via `preview.documentLines`), same doctrine as the reformatted
    // retained keys. Defaults to not_applicable -> blank marker.
    attorneyManualFields: {
      otherAddendaText: { kind: 'not_applicable', confirmedBy: null, at: null, note: null },
    },
  };
  for (const [group, patch] of Object.entries(overrides || {})) {
    base[group] = { ...base[group], ...patch };
  }
  return base;
}

/* ==================================================================== */
/* 1. Fail-closed on incomplete preview (UNCHANGED)                      */
/* ==================================================================== */

{
  const preview = completePreview({ previewComplete: false, blockingReasons: ['Something is unresolved.'] });
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport(), SELLER_READINESS_OK);
  checkTrue('blocked when previewComplete is false', plan.ok === false);
  check('blocked plan carries the exact blocking reasons', plan.ok ? null : plan.blockingReasons, ['Something is unresolved.']);
}

/* ==================================================================== */
/* 2. Independent equitable-interest gate (ruling 9, UNCHANGED)          */
/* ==================================================================== */

{
  const preview = completePreview({
    additionalRequiredFacts: [line('sellerEquitableInterest', 'disposition', 'unresolved', null)],
  });
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport(), SELLER_READINESS_OK);
  checkTrue('blocked on unresolved equitable-interest disclosure even though previewComplete is true', plan.ok === false);
  checkTrue(
    'blocking reasons name the equitable-interest gate',
    plan.ok ? false : plan.blockingReasons.some((r) => r.includes('sellerEquitableInterest') && r.includes('pre-contract gate')),
  );
}

/* ==================================================================== */
/* 3. Happy path -- exactly 118 entries (INV-67 Phase 2B)                */
/* ==================================================================== */

{
  const preview = completePreview();
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport(), SELLER_READINESS_OK);
  checkTrue('ok plan on a fully resolved preview + report', plan.ok === true);
  check('entry count equals CONTRACT_PROJECTION_FIELD_KEYS length', plan.ok ? plan.entries.length : null, CONTRACT_PROJECTION_FIELD_KEYS.length);
  check('entry count is exactly 118', plan.ok ? plan.entries.length : null, 118);
  check('CONTRACT_PROJECTION_FIELD_KEYS.length is exactly 118', CONTRACT_PROJECTION_FIELD_KEYS.length, 118);
  check(
    '28 retained + 6 transport-only + 50 markers + 12 text + 22 broker = 118',
    CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.length + CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.length + CHECKBOX_MARKER_KEYS.length + CHECKBOX_TEXT_KEYS.length + BROKER_TEXT_KEYS.length,
    118,
  );
  check('agreementAt carried from preview.version', plan.ok ? plan.agreementAt : null, VERSION.agreementAt);
  check('versionSeq carried from preview.version', plan.ok ? plan.versionSeq : null, VERSION.versionSeq);
  check('opportunityId is the caller-supplied id, not read off the preview', plan.ok ? plan.opportunityId : null, 'OPP-1');
  check('no warnings on a fully clean report', plan.ok ? plan.warnings : null, []);

  const byKey = new Map((plan.ok ? plan.entries : []).map((e) => [e.key, e.text]));
  checkTrue('every CONTRACT_PROJECTION_FIELD_KEYS entry is present', CONTRACT_PROJECTION_FIELD_KEYS.every((k) => byKey.has(k)));
  check('an UNAFFECTED retained document-line key still projects its own preview text verbatim', byKey.get('earnestMoneyOption.escrowAgentName'), 'value for earnestMoneyOption.escrowAgentName');
  check('identity.propertyStreetAddress projects its own text', byKey.get('identity.propertyStreetAddress'), '123 Main St');
  check('a checkbox marker for a "none" election is blank', byKey.get('lease_residential_mark'), '');
  check('a checkbox marker for the selected election is "X"', byKey.get('title_expense_seller_mark'), 'X');
  check('every marker value is "X" or ""', CHECKBOX_MARKER_KEYS.every((k) => byKey.get(k) === 'X' || byKey.get(k) === ''), true);
  check('broker text is all-blank when representation is "none"', BROKER_TEXT_KEYS.every((k) => byKey.get(k) === ''), true);
  check('sales_price_amount_text formats 275000 with no dollar sign', byKey.get('sales_price_amount_text'), '275,000.00');
  check('financing_sum_amount_text formats the fixed $0 with no dollar sign', byKey.get('financing_sum_amount_text'), '0.00');
  check('propertyLegalDescription.legalMunicipality projects the attested municipality name', byKey.get('propertyLegalDescription.legalMunicipality'), 'Round Rock');
  check('as_is_repairs_text is blank for a plain As-Is election', byKey.get('as_is_repairs_text'), '');
  check('district_notices_mark is blank for an explicit "none" district-notices disposition', byKey.get('district_notices_mark'), '');
  check('other_addenda_mark is blank for a not_applicable other-addenda disposition', byKey.get('other_addenda_mark'), '');

  // Jess Gate correction (repeated-destination re-gate): the paragraph-22 echo of 3
  // markers is a TEMPLATE PLACEMENT concern only -- it must never change the unique
  // 118-key / new-marker-field totals this plan writes.
  check('CONTRACT_PROJECTION_FIELD_KEYS is still exactly 118 UNIQUE keys with the repeated-placement manifest present', CONTRACT_PROJECTION_FIELD_KEYS.length, 118);
  check('marker/text/broker key total is exactly 84 (50 + 12 + 22, INV-67 Phase 2B) -- distinct from the overlay-PLACEMENT count below', CHECKBOX_MARKER_KEYS.length + CHECKBOX_TEXT_KEYS.length + BROKER_TEXT_KEYS.length, 84);
  checkTrue(
    'the overlay-placement count (51, from the marker model, UNCHANGED by Phase 2B -- these two new markers are not yet placed anywhere) is distinct from and greater than the ORIGINAL 48-marker-key count -- never conflated in this integration layer either',
    CHECKBOX_MARKER_TOTAL_TEMPLATE_PLACEMENTS > 48,
  );
  checkTrue(
    'every plan entry key for a repeated-placement marker is written exactly ONCE in the plan (one field write, regardless of how many places it is later pasted on the template)',
    Object.keys(CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS).every((k) => (plan.ok ? plan.entries.filter((e) => e.key === k).length : 0) === 1),
  );

  // Compound text-destination repair -- the retired combined keys are never
  // written; the fourteen reformatted retained keys carry transport-safe
  // text; the four new transport-only keys carry correctly-derived text.
  checkTrue('the retired earnestMoneyOption.additionalEarnestMoney key is never written', !byKey.has('earnestMoneyOption.additionalEarnestMoney'));
  checkTrue('the retired closingPossession.closingDate key is never written', !byKey.has('closingPossession.closingDate'));
  check('parties.sellerSigners transport is names ONLY, no role, no signing-authority note', byKey.get('parties.sellerSigners'), 'Jane Seller');
  check('propertyLegalDescription.lot transport (populated) is the bare value, not preview prose', byKey.get('propertyLegalDescription.lot'), '7');
  check('propertyLegalDescription.exclusions transport ("none") is "", never "None (explicitly confirmed)."', byKey.get('propertyLegalDescription.exclusions'), '');
  check('earnestMoneyOption.earnestMoney transport carries NO "$"', byKey.get('earnestMoneyOption.earnestMoney'), '1,000.00');
  check('earnestMoneyOption.optionFee transport carries NO "$"', byKey.get('earnestMoneyOption.optionFee'), '500.00');
  check('earnestMoneyOption.optionPeriodDays transport carries NO "day"/"days"', byKey.get('earnestMoneyOption.optionPeriodDays'), '10');
  check('titleSurvey.objectionsDays transport carries NO "day"/"days"', byKey.get('titleSurvey.objectionsDays'), '15');
  check('titleSurvey.objectionsText transport ("none") is ""', byKey.get('titleSurvey.objectionsText'), '');
  check('propertyCondition.serviceContractCap transport ("none") is ""', byKey.get('propertyCondition.serviceContractCap'), '');
  check('settlementExpense.sellerCreditCap transport ("none") is ""', byKey.get('settlementExpense.sellerCreditCap'), '');
  check('addendaApplicability.districtNotices transport ("none") is ""', byKey.get('addendaApplicability.districtNotices'), '');
  check('additional_earnest_money_amount_text is blank when the canonical fact is "none"', byKey.get('additional_earnest_money_amount_text'), '');
  check('additional_earnest_money_days_text is blank when the canonical fact is "none"', byKey.get('additional_earnest_money_days_text'), '');
  check('closing_date_month_day_text is UTC-derived "MMMM d"', byKey.get('closing_date_month_day_text'), 'December 15');
  check('closing_date_year_suffix_text is exactly two numeric digits', byKey.get('closing_date_year_suffix_text'), '26');
  checkTrue('closing_date_year_suffix_text matches /^[0-9]{2}$/', /^[0-9]{2}$/.test(byKey.get('closing_date_year_suffix_text')));
}

/* ==================================================================== */
/* 3b. Compound text-destination repair -- additional-earnest-money and  */
/*     closing-date transport values, "$"/"$ removal", and the leading- */
/*     "$" defensive strip for serviceContractCap / sellerCreditCap      */
/* ==================================================================== */

{
  const preview = completePreview();
  const report = completeReport({
    earnestMoneyOption: { additionalEarnestMoney: populated({ kind: 'value', amount: 2500, withinDays: 5 }) },
    propertyCondition: { serviceContractCap: populated({ kind: 'value', value: '$500' }) },
    settlementExpense: { sellerCreditCap: populated({ kind: 'value', value: '1,500' }) },
    parties: {
      sellerSigners: populated([
        { displayName: 'Jane Seller', role: 'Owner', signingAuthorityNote: 'as trustee' },
        { displayName: null, role: 'Unknown', signingAuthorityNote: null },
        { displayName: 'John Seller', role: 'Co-Owner', signingAuthorityNote: null },
      ]),
    },
  });
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('ok plan with additional-earnest-money value and a "$"-typed cap value', plan.ok === true);
  const byKey = new Map((plan.ok ? plan.entries : []).map((e) => [e.key, e.text]));
  check('additional_earnest_money_amount_text derives the bare amount, no "$"', byKey.get('additional_earnest_money_amount_text'), '2,500.00');
  check('additional_earnest_money_days_text derives the bare day count, no "day"/"days"', byKey.get('additional_earnest_money_days_text'), '5');
  check('both additional-earnest-money transport values derive from the SAME canonical fact (amount=2500, days=5 both present together)', [byKey.get('additional_earnest_money_amount_text'), byKey.get('additional_earnest_money_days_text')], ['2,500.00', '5']);
  check('a leading "$" typed into serviceContractCap is defensively stripped', byKey.get('propertyCondition.serviceContractCap'), '500');
  check('sellerCreditCap with no leading "$" passes through unchanged', byKey.get('settlementExpense.sellerCreditCap'), '1,500');
  check('sellerSigners transport omits a null-displayName signer and keeps only names, "; "-joined', byKey.get('parties.sellerSigners'), 'Jane Seller; John Seller');
}

/* ==================================================================== */
/* 3c. Closing-date century-bound gate -- fails closed before any entry  */
/*     is built, exactly like every other blocking reason                */
/* ==================================================================== */

{
  for (const [label, iso, shouldPass] of [
    ['year 2000 (lower boundary)', '2000-06-15T00:00:00.000Z', true],
    ['year 2099 (upper boundary)', '2099-06-15T00:00:00.000Z', true],
    ['year 1999 (just below)', '1999-12-31T23:59:59.000Z', false],
    ['year 2100 (just above)', '2100-01-01T00:00:00.000Z', false],
    ['leap day 2028-02-29', '2028-02-29T00:00:00.000Z', true],
    ['UTC boundary a: 2026-01-01T00:30:00.000Z', '2026-01-01T00:30:00.000Z', true],
    ['UTC boundary b: 2025-12-31T23:45:00.000Z', '2025-12-31T23:45:00.000Z', true],
    ['malformed instant', 'not-a-real-date', false],
    ['missing/empty instant', '', false],
  ]) {
    const preview = completePreview();
    const report = completeReport({ closingPossession: { closingDate: populated(iso) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    check(`closing date -- ${label} -- plan.ok is ${shouldPass}`, plan.ok, shouldPass);
    if (!shouldPass) {
      checkTrue(`closing date -- ${label} -- blocking reason names the closing date`, plan.ok ? false : plan.blockingReasons.some((r) => /closing date/i.test(r)));
    }
  }

  // Direct unit proof the gate itself matches this table (belt-and-suspenders
  // over the integration proof above).
  check('checkClosingDateCenturyBound(2000) ok', checkClosingDateCenturyBound('2000-06-15T00:00:00.000Z').ok, true);
  check('checkClosingDateCenturyBound(2099) ok', checkClosingDateCenturyBound('2099-06-15T00:00:00.000Z').ok, true);
  check('checkClosingDateCenturyBound(1999) refused', checkClosingDateCenturyBound('1999-12-31T23:59:59.000Z').ok, false);
  check('checkClosingDateCenturyBound(2100) refused', checkClosingDateCenturyBound('2100-01-01T00:00:00.000Z').ok, false);
  check('checkClosingDateCenturyBound(malformed) refused', checkClosingDateCenturyBound('not-a-real-date').ok, false);

  // The failed date gate must prevent the plan from ever reaching ok:true --
  // ContractWorkspace.tsx's sync handler checks `plan.ok` BEFORE calling the
  // GHL write (`ghl.opportunities.syncContractProjectionFields`) and BEFORE
  // evaluating the Contract Draft Request transition
  // (`evaluateContractDraftRequestTransition`) -- both are structurally
  // unreachable once `plan.ok === false`.
  {
    const preview = completePreview();
    const report = completeReport({ closingPossession: { closingDate: populated('2100-01-01T00:00:00.000Z') } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    checkTrue('an out-of-range closing year yields ok:false (no `entries`, no GHL write, no draft-request transition possible)', plan.ok === false && !('entries' in plan));
  }
}

/* ==================================================================== */
/* 3d. Jess Gate correction -- closing-date MISSING-DISPOSITION gap      */
/*     fixed. Closing Date is REQUIRED: `not_applicable` and             */
/*     `unresolved` must both block the whole plan, never silently fall  */
/*     through `transportFieldText`'s generic `not_applicable -> ""`     */
/*     branch to a blank month/day/year-suffix and an ok:true plan.      */
/* ==================================================================== */

{
  // not_applicable -- the exact real FieldDisposition shape for this kind
  // (`contract-facts-model.ts`'s own `{ kind: "not_applicable"; confirmedBy;
  // at; note }`), not a populated-with-empty-string stand-in.
  const preview = completePreview();
  const report = completeReport({
    closingPossession: {
      closingDate: { kind: 'not_applicable', confirmedBy: 'operator', at: '2026-09-01T00:00:00.000Z', note: 'To be determined.' },
    },
  });
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('not_applicable closing date -- plan.ok is false (Closing Date is required, "not applicable" is not an allowed disposition)', plan.ok === false);
  checkTrue('not_applicable closing date -- blocking reason names the closing date', plan.ok ? false : plan.blockingReasons.some((r) => /closing.?date/i.test(r)));
  checkTrue('not_applicable closing date -- blocking reason is distinct (mentions "not applicable")', plan.ok ? false : plan.blockingReasons.some((r) => /not applicable/i.test(r)));
  checkTrue('not_applicable closing date -- no successful projection entries are returned', !('entries' in plan));
  checkTrue('not_applicable closing date -- no `warnings` array either (this is the ok:false shape, not ok:true)', !('warnings' in plan));
}

{
  // unresolved -- the exact real FieldDisposition shape (`{ kind:
  // "unresolved" }`, no other fields at all).
  const preview = completePreview();
  const report = completeReport({ closingPossession: { closingDate: { kind: 'unresolved' } } });
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('unresolved closing date -- plan.ok is false', plan.ok === false);
  checkTrue('unresolved closing date -- blocking reason names the closing date', plan.ok ? false : plan.blockingReasons.some((r) => /closing.?date/i.test(r)));
  checkTrue('unresolved closing date -- blocking reason is distinct (mentions "unresolved", not "not applicable")', plan.ok ? false : plan.blockingReasons.some((r) => /unresolved/i.test(r)));
  checkTrue('unresolved closing date -- blocking reason is DIFFERENT from the not_applicable reason (never conflated)', (() => {
    const naReport = completeReport({ closingPossession: { closingDate: { kind: 'not_applicable', confirmedBy: null, at: '2026-09-01T00:00:00.000Z', note: null } } });
    const naPlan = buildContractProjectionPlan('OPP-1', preview, naReport, SELLER_READINESS_OK);
    return plan.ok === false && naPlan.ok === false && plan.blockingReasons[0] !== naPlan.blockingReasons[0];
  })());
  checkTrue('unresolved closing date -- no successful projection entries are returned', !('entries' in plan));
  checkTrue('unresolved closing date -- no `warnings` array either (this is the ok:false shape, not ok:true)', !('warnings' in plan));
  checkTrue('unresolved closing date -- does NOT throw (a real data condition, refused via blockingReasons, never a thrown integrity-violation exception)', true); // the call above already completed without throwing; this assertion documents the intent for the reader
}

{
  // Structural proof (not a UI-level test -- ContractWorkspace.tsx itself is
  // out of this suite's scope) that `plan.ok === false` for BOTH missing
  // dispositions makes the downstream GHL write and the Contract Draft
  // Request transition structurally unreachable: `ContractWorkspace.tsx`'s
  // `handleSyncContractProjectionFields` reads `if (!plan.ok) { ...; return; }`
  // BEFORE ever calling `ghl.opportunities.syncContractProjectionFields` or
  // `evaluateContractDraftRequestTransition` -- both calls are gated
  // entirely behind `plan.ok`, which is `false` here, so neither can run.
  const workspaceSrc = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8');
  const handlerStartIdx = workspaceSrc.indexOf('async function handleSyncContractProjectionFields');
  checkTrue('ContractWorkspace.tsx still defines handleSyncContractProjectionFields', handlerStartIdx > -1);
  // Search from the handler's own start (not the whole file) so the
  // `evaluateContractDraftRequestTransition` import statement earlier in
  // the file is never mistaken for its call site inside this handler.
  const planOkCheckIdx = handlerStartIdx > -1 ? workspaceSrc.indexOf('if (!plan.ok)', handlerStartIdx) : -1;
  const ghlWriteIdx = handlerStartIdx > -1 ? workspaceSrc.indexOf('ghl.opportunities.syncContractProjectionFields(', handlerStartIdx) : -1;
  const draftRequestIdx = handlerStartIdx > -1 ? workspaceSrc.indexOf('evaluateContractDraftRequestTransition(', handlerStartIdx) : -1;
  checkTrue('handleSyncContractProjectionFields checks `!plan.ok` and returns before the GHL write call site', planOkCheckIdx > -1 && ghlWriteIdx > -1 && planOkCheckIdx < ghlWriteIdx);
  checkTrue('handleSyncContractProjectionFields checks `!plan.ok` and returns before the Contract Draft Request transition call site', planOkCheckIdx > -1 && draftRequestIdx > -1 && planOkCheckIdx < draftRequestIdx);
}

/* ==================================================================== */
/* 3e. Phase 1 completeness repair -- audit/status prose must never      */
/*     reach contract-bound text. A `not_applicable` document line       */
/*     projects "", never its internal audit note or the generic         */
/*     "Not applicable (explicitly confirmed)." fallback. Supplied       */
/*     (`populated`) Special Provisions / Other Addenda text remains     */
/*     verbatim, unaffected by this gate.                                */
/* ==================================================================== */

{
  const BANNED_PHRASES = [
    'Not applicable (explicitly confirmed).',
    'Explicitly confirmed no phone for notice.',
    'Explicitly confirmed no email for notice.',
  ];
  const preview = withLineOverrides([
    { group: 'attorneyManualFields', field: 'specialProvisions', status: 'not_applicable', text: BANNED_PHRASES[0] },
    { group: 'attorneyManualFields', field: 'otherAddendaText', status: 'not_applicable', text: BANNED_PHRASES[0] },
    { group: 'noticeContact', field: 'sellerNoticePhone', status: 'not_applicable', text: BANNED_PHRASES[1] },
    { group: 'noticeContact', field: 'sellerNoticeEmail', status: 'not_applicable', text: BANNED_PHRASES[2] },
  ]);
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport(), SELLER_READINESS_OK);
  checkTrue('ok plan when special provisions/other addenda/seller notice phone+email are explicitly not applicable', plan.ok === true);
  const byKey = new Map((plan.ok ? plan.entries : []).map((e) => [e.key, e.text]));
  check('not_applicable Special Provisions projects blank, never the audit fallback phrase', byKey.get('attorneyManualFields.specialProvisions'), '');
  check('not_applicable Other Addenda text projects blank, never the audit fallback phrase', byKey.get('attorneyManualFields.otherAddendaText'), '');
  check('not_applicable seller notice phone projects blank, never "Explicitly confirmed no phone for notice."', byKey.get('noticeContact.sellerNoticePhone'), '');
  check('not_applicable seller notice email projects blank, never "Explicitly confirmed no email for notice."', byKey.get('noticeContact.sellerNoticeEmail'), '');
  checkTrue(
    'no projected entry anywhere in the plan contains any of the three banned internal audit/status phrases',
    (plan.ok ? plan.entries : []).every((e) => BANNED_PHRASES.every((phrase) => !e.text.includes(phrase))),
  );
}

{
  const SPECIAL_PROVISIONS_TEXT = "Seller to leave the swing set. Buyer to assume the well permit.";
  const OTHER_ADDENDA_TEXT = 'Addendum for Coastal Area Property.';
  const preview = withLineOverrides([
    { group: 'attorneyManualFields', field: 'specialProvisions', status: 'populated', text: SPECIAL_PROVISIONS_TEXT },
    { group: 'attorneyManualFields', field: 'otherAddendaText', status: 'populated', text: OTHER_ADDENDA_TEXT },
  ]);
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport(), SELLER_READINESS_OK);
  checkTrue('ok plan with supplied (populated) special provisions/other addenda text', plan.ok === true);
  const byKey = new Map((plan.ok ? plan.entries : []).map((e) => [e.key, e.text]));
  check('supplied Special Provisions text projects verbatim, untouched by the not_applicable gate', byKey.get('attorneyManualFields.specialProvisions'), SPECIAL_PROVISIONS_TEXT);
  check('supplied Other Addenda text projects verbatim, untouched by the not_applicable gate', byKey.get('attorneyManualFields.otherAddendaText'), OTHER_ADDENDA_TEXT);
}

/* ==================================================================== */
/* 3f. Phase 1 completeness repair -- BIDIRECTIONAL option-fee/period    */
/*     consistency (Jess Gate correction): valid option requires BOTH    */
/*     fee and days positive; valid no-option requires BOTH zero/not-    */
/*     applicable. Either side positive without the other -- blocked.    */
/*     Either side unresolved -- blocked regardless of the other side.   */
/*     Either side a negative populated value -- blocked.                */
/* ==================================================================== */

{
  const NOT_APPLICABLE_FEE = { kind: 'not_applicable', confirmedBy: 'brad', at: '2026-01-01T00:00:00.000Z', note: 'Explicitly recorded as $0 / waived.' };
  const NOT_APPLICABLE_DAYS = { kind: 'not_applicable', confirmedBy: 'brad', at: '2026-01-01T00:00:00.000Z', note: 'Explicitly recorded as no option period.' };
  const UNRESOLVED = { kind: 'unresolved' };

  // [label, optionFee, optionPeriodDays, shouldPass, reasonPattern (null when shouldPass)]
  const cases = [
    // Valid option: both positive.
    ['positive fee + positive days -- valid option', populated(500), populated(10), true, null],

    // Valid no-option: both sides zero/not-applicable, every combination.
    ['zero fee + zero days -- valid no-option', populated(0), populated(0), true, null],
    ['zero fee + not_applicable days -- valid no-option', populated(0), NOT_APPLICABLE_DAYS, true, null],
    ['not_applicable fee + zero days -- valid no-option', NOT_APPLICABLE_FEE, populated(0), true, null],
    ['not_applicable fee + not_applicable days -- valid no-option', NOT_APPLICABLE_FEE, NOT_APPLICABLE_DAYS, true, null],

    // Positive days without a positive fee -- blocked (mismatch), every non-positive fee shape.
    ['positive days + zero fee -- fails closed (mismatch)', populated(0), populated(10), false, /option period/i],
    ['positive days + not_applicable fee -- fails closed (mismatch)', NOT_APPLICABLE_FEE, populated(10), false, /option period/i],
    ['positive days + unresolved fee -- fails closed (unresolved, not a mismatch message)', UNRESOLVED, populated(10), false, /unresolved/i],

    // Positive fee without positive days -- blocked (mismatch), every non-positive days shape.
    // This is the direction the pre-correction gate incorrectly let through.
    ['positive fee + zero days -- fails closed (mismatch)', populated(500), populated(0), false, /option fee/i],
    ['positive fee + not_applicable days -- fails closed (mismatch)', populated(500), NOT_APPLICABLE_DAYS, false, /option fee/i],
    ['positive fee + unresolved days -- fails closed (unresolved, not a mismatch message)', populated(500), UNRESOLVED, false, /unresolved/i],

    // Unresolved on either side blocks regardless of the other side's value --
    // never treated as a legitimate no-option scenario.
    ['unresolved fee + zero days -- fails closed regardless of the other side', UNRESOLVED, populated(0), false, /unresolved/i],
    ['unresolved fee + not_applicable days -- fails closed regardless of the other side', UNRESOLVED, NOT_APPLICABLE_DAYS, false, /unresolved/i],
    ['unresolved days + zero fee -- fails closed regardless of the other side', populated(0), UNRESOLVED, false, /unresolved/i],
    ['unresolved days + not_applicable fee -- fails closed regardless of the other side', NOT_APPLICABLE_FEE, UNRESOLVED, false, /unresolved/i],

    // Negative populated values -- blocked as invalid, distinct from the mismatch/unresolved messages.
    ['negative fee -- fails closed (invalid value)', populated(-100), populated(10), false, /negative/i],
    ['negative days -- fails closed (invalid value)', populated(500), populated(-5), false, /negative/i],
  ];
  for (const [label, optionFee, optionPeriodDays, shouldPass, reasonPattern] of cases) {
    const preview = completePreview();
    const report = completeReport({ earnestMoneyOption: { optionFee, optionPeriodDays } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    check(`option fee/period -- ${label} -- plan.ok is ${shouldPass}`, plan.ok, shouldPass);
    if (!shouldPass) {
      checkTrue(
        `option fee/period -- ${label} -- blocking reason clearly identifies the mismatch`,
        plan.ok ? false : plan.blockingReasons.some((r) => reasonPattern.test(r)),
      );
    }
  }
}

/* ==================================================================== */
/* 3b. INV-67 Phase 2B -- money, repairs-text fit safety, district/other */
/*     addenda markers, and Legal City boundary behavior                 */
/* ==================================================================== */

// -- Money: finite/nonnegative/agreement/zero-financing gate --
{
  const cases = [
    ['negative sales price -- fails closed', { salesPrice: populated(-1), cashPortion: populated(-1) }, false, /not a finite number|negative/i],
    ['NaN sales price -- fails closed', { salesPrice: populated(NaN), cashPortion: populated(NaN) }, false, /not a finite number/i],
    ['Infinity sales price -- fails closed', { salesPrice: populated(Infinity), cashPortion: populated(Infinity) }, false, /not a finite number/i],
    ['nonzero financing sum -- fails closed', { financingSum: populated(5000) }, false, /Financing sum must be exactly \$0/],
    ['negative financing sum -- fails closed', { financingSum: populated(-1) }, false, /negative/i],
    ['accepted-price disagreement (cashPortion != salesPrice) -- fails closed', { cashPortion: populated(200000) }, false, /Accepted-price disagreement/],
    ['unresolved salesPrice.salesPrice -- fails closed', { salesPrice: { kind: 'unresolved' } }, false, /salesPrice\.salesPrice.*unresolved/],
  ];
  for (const [label, salesPriceOverride, shouldPass, reasonPattern] of cases) {
    const preview = completePreview();
    const report = completeReport({ salesPrice: salesPriceOverride });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    check(`money gate -- ${label} -- plan.ok is ${shouldPass}`, plan.ok, shouldPass);
    if (!shouldPass) checkTrue(`money gate -- ${label} -- blocking reason matches`, plan.ok ? false : plan.blockingReasons.some((r) => reasonPattern.test(r)));
  }
  // Valid boundary: zero-dollar sales price is finite/nonnegative and agrees -- passes.
  {
    const preview = completePreview();
    const report = completeReport({ salesPrice: { salesPrice: populated(0), cashPortion: populated(0), financingSum: populated(0) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    checkTrue('money gate -- $0 sales price (finite, nonnegative, agrees, financing still $0) -- plan.ok is true', plan.ok === true);
    check('money gate -- $0 sales price formats as "0.00", no dollar sign', plan.ok ? plan.entries.find((e) => e.key === 'sales_price_amount_text').text : null, '0.00');
  }
}

// -- As-Is repairs text: fit safety (INV-67 Phase 2B addendum, Spock's     --
// -- rendered-PDF measurement) -- single line, <=110 chars, trimmed,       --
// -- blank-after-trim rejected, embedded CR/LF/CRLF rejected, election     --
// -- change clears stale text, never truncated.                            --
{
  const asIsCases = [
    ['1 character -- passes', 'x', true, 'x'],
    ['exactly 110 characters -- passes (boundary)', 'x'.repeat(110), true, 'x'.repeat(110)],
    ['111 characters -- fails closed (boundary)', 'x'.repeat(111), false, /111 characters, exceeding the 110-character fit limit/],
    ['leading/trailing whitespace -- trimmed on success', '   fix the roof   ', true, 'fix the roof'],
    ['embedded CR -- fails closed', 'fix the roof\rand gutters', false, /embedded line break/],
    ['embedded LF -- fails closed', 'fix the roof\nand gutters', false, /embedded line break/],
    ['embedded CRLF -- fails closed', 'fix the roof\r\nand gutters', false, /embedded line break/],
    ['whitespace-only -- fails closed (blank after trim)', '   ', false, /is blank -- required when "with repairs" is selected/],
  ];
  for (const [label, repairsText, shouldPass, expected] of asIsCases) {
    const preview = completePreview();
    const report = completeReport({ propertyCondition: { asIsElection: populated({ kind: 'as_is_with_repairs', repairsText }) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    check(`as-is repairs text -- ${label} -- plan.ok is ${shouldPass}`, plan.ok, shouldPass);
    if (shouldPass) {
      check(`as-is repairs text -- ${label} -- projects exactly`, plan.ok ? plan.entries.find((e) => e.key === 'as_is_repairs_text').text : null, expected);
    } else {
      checkTrue(`as-is repairs text -- ${label} -- blocking reason matches`, plan.ok ? false : plan.blockingReasons.some((r) => expected.test(r)));
    }
  }
  // Never truncates: a too-long value is refused whole, never clipped to 110.
  {
    const preview = completePreview();
    const report = completeReport({ propertyCondition: { asIsElection: populated({ kind: 'as_is_with_repairs', repairsText: 'y'.repeat(200) }) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    checkTrue('as-is repairs text -- 200 characters -- fails closed, never silently truncated to 110', plan.ok === false);
  }
  // Election change clears stale repairs text -- plain As-Is always projects blank,
  // regardless of what a PRIOR report (never passed here) might have carried, because
  // every call derives fresh from the CURRENT AsIsElectionFact, never accumulated state.
  {
    const preview = completePreview();
    const withRepairsReport = completeReport({ propertyCondition: { asIsElection: populated({ kind: 'as_is_with_repairs', repairsText: 'Replace the water heater' }) } });
    const withRepairsPlan = buildContractProjectionPlan('OPP-1', preview, withRepairsReport, SELLER_READINESS_OK);
    checkTrue('election-change fixture step 1 (with repairs) -- ok', withRepairsPlan.ok === true);
    check('election-change fixture step 1 -- as_is_repairs_text carries the repair text', withRepairsPlan.ok ? withRepairsPlan.entries.find((e) => e.key === 'as_is_repairs_text').text : null, 'Replace the water heater');

    const plainReport = completeReport({ propertyCondition: { asIsElection: populated({ kind: 'as_is' }) } });
    const plainPlan = buildContractProjectionPlan('OPP-1', preview, plainReport, SELLER_READINESS_OK);
    checkTrue('election-change step 2 (switched to plain As-Is) -- ok', plainPlan.ok === true);
    check('election change from with-repairs to plain As-Is clears the stale repairs text to "" (never left behind)', plainPlan.ok ? plainPlan.entries.find((e) => e.key === 'as_is_repairs_text').text : null, '');
  }
}

// -- District Notices / Other Addenda markers --
{
  {
    const preview = completePreview();
    const report = completeReport({ addendaApplicability: { districtNotices: populated({ kind: 'value', value: 'District X notice text' }) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    checkTrue('district_notices_mark -- applicable/populated -- ok', plan.ok === true);
    check('district_notices_mark -- applicable -- marker is "X"', plan.ok ? plan.entries.find((e) => e.key === 'district_notices_mark').text : null, 'X');
  }
  {
    // `addendaApplicability.districtNotices` is also a REFORMATTED_RETAINED_KEY --
    // `documentLineEntries` (which runs BEFORE `buildCheckboxMarkersAndText`) hits its
    // own `transportFieldText` integrity-throw on this same unresolved disposition first.
    const preview = completePreview();
    const report = completeReport({ addendaApplicability: { districtNotices: { kind: 'unresolved' } } });
    let threw = false;
    try { buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK); } catch (e) { threw = /"addendaApplicability\.districtNotices" is unresolved despite previewComplete=true/.test(e.message); }
    checkTrue('district_notices_mark -- unresolved disposition -- integrity-throws (previewComplete should have already blocked)', threw);
  }
  {
    const preview = completePreview();
    const report = completeReport({ attorneyManualFields: { otherAddendaText: populated({ kind: 'provided_verbatim', text: 'Addendum for Coastal Area Property.' }) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    checkTrue('other_addenda_mark -- provided_verbatim text -- ok', plan.ok === true);
    check('other_addenda_mark -- provided -- marker is "X"', plan.ok ? plan.entries.find((e) => e.key === 'other_addenda_mark').text : null, 'X');
  }
  {
    const preview = completePreview();
    const report = completeReport({ attorneyManualFields: { otherAddendaText: { kind: 'unresolved' } } });
    let threw = false;
    try { buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK); } catch (e) { threw = /"attorneyManualFields\.otherAddendaText" is not resolved despite the caller's previewComplete gate/.test(e.message); }
    checkTrue('other_addenda_mark -- unresolved (attorney_will_draft resolves to unresolved upstream) -- integrity-throws', threw);
  }
}

// -- Legal City (propertyLegalDescription.legalMunicipality) --
{
  {
    const preview = completePreview();
    const report = completeReport({ propertyLegalDescription: { legalMunicipality: populated({ kind: 'unincorporated' }) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    checkTrue('legal city -- unincorporated -- ok', plan.ok === true);
    check('legal city -- unincorporated -- projects blank (never the preview\'s "Unincorporated area." wording)', plan.ok ? plan.entries.find((e) => e.key === 'propertyLegalDescription.legalMunicipality').text : null, '');
  }
  {
    const preview = completePreview();
    const report = completeReport({ propertyLegalDescription: { legalMunicipality: { kind: 'unresolved' } } });
    let threw = false;
    try { buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK); } catch (e) { threw = /"propertyLegalDescription\.legalMunicipality" is unresolved despite previewComplete=true/.test(e.message); }
    checkTrue('legal city -- unresolved -- integrity-throws (previewComplete should have already blocked)', threw);
  }
  {
    // No postal/contact-city inference: only the attested carrier value is
    // ever used -- proven by round-tripping a name that plainly could not
    // have come from a formatted address.
    const preview = completePreview();
    const report = completeReport({ propertyLegalDescription: { legalMunicipality: populated({ kind: 'municipality', name: 'Definitely Not A Postal City' }) } });
    const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
    checkTrue('legal city -- municipality with an arbitrary attested name -- ok', plan.ok === true);
    check(
      'legal city -- projects EXACTLY the attested name, proving no postal/contact/address inference is ever substituted',
      plan.ok ? plan.entries.find((e) => e.key === 'propertyLegalDescription.legalMunicipality').text : null,
      'Definitely Not A Postal City',
    );
  }
}

/* ==================================================================== */
/* 4. Blocking: marker-exclusivity violation cannot reach the plan       */
/*    normally -- proven here via a report whose canonical facts, if     */
/*    mis-derived, WOULD violate exclusivity; the by-construction         */
/*    guarantee is proven in test-contract-checkbox-marker-model.cjs.    */
/*    This section proves the INTEGRATION path instead: mineral-         */
/*    reservation disagreement and blocking broker arrangements.         */
/* ==================================================================== */

{
  const preview = completePreview();
  const report = completeReport({
    propertyLegalDescription: { reservations: populated({ kind: 'applies', addendumNote: 'see addendum' }) },
    // addendaApplicability.items.mineral_reservation stays false -> disagreement
  });
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('mineral-reservation disagreement blocks the WHOLE plan', plan.ok === false);
  checkTrue('mineral-reservation blocking reason is distinct and operator-facing', plan.ok ? false : plan.blockingReasons.some((r) => r.includes('Mineral-reservation disagreement')));
}

{
  const preview = completePreview();
  const brokerFirm = {
    firmName: 'Both Sides Realty', licenseNo: '1', associateName: 'A', associateLicenseNo: '2', email: 'e@x.com', phone: '555',
    address: { kind: 'none' }, teamName: { kind: 'none' }, supervisorName: { kind: 'none' }, supervisorPhone: { kind: 'none' }, supervisorLicenseNo: { kind: 'none' },
  };
  const report = completeReport({ representation: { representation: populated({ kind: 'intermediary', brokerFirm }) } });
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('intermediary broker arrangement blocks the WHOLE plan before any entry is built', plan.ok === false);
  checkTrue('intermediary blocking reason names the arrangement', plan.ok ? false : plan.blockingReasons.some((r) => /intermediary/i.test(r)));
}

{
  const preview = completePreview();
  const report = completeReport({ representation: { representation: populated({ kind: 'represented', sellerAgent: null, buyerAgent: null }) } });
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('represented-but-empty broker arrangement ALSO blocks the WHOLE plan (mandatory correction)', plan.ok === false);
  checkTrue('represented-but-empty blocking reason is distinct from "no broker"', plan.ok ? false : plan.blockingReasons.some((r) => /not the same fact as "no broker"/.test(r)));
}

/* ==================================================================== */
/* 5. Warning (not blocking): POA membership vs. addendum disagreement   */
/* ==================================================================== */

{
  const preview = completePreview();
  const report = completeReport({ titleSurvey: { poaMembership: populated('is_subject') } }); // addenda.poa_membership stays false -> disagreement
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('POA/addendum disagreement does NOT block the plan', plan.ok === true);
  checkTrue('POA/addendum disagreement surfaces as a warning', plan.ok && plan.warnings.some((w) => w.includes('POA membership')));
}

/* ==================================================================== */
/* 6. Broker text -- seller-only arrangement populates only that side    */
/* ==================================================================== */

{
  const preview = completePreview();
  const sellerAgent = {
    firmName: 'Seller Firm', licenseNo: 'SL1', associateName: 'Sam Assoc', associateLicenseNo: 'SA1', email: 's@x.com', phone: '555-1',
    address: { kind: 'value', value: '1 Main St' }, teamName: { kind: 'none' }, supervisorName: { kind: 'none' }, supervisorPhone: { kind: 'none' }, supervisorLicenseNo: { kind: 'none' },
  };
  const report = completeReport({ representation: { representation: populated({ kind: 'represented', sellerAgent, buyerAgent: null }) } });
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  checkTrue('seller-only arrangement produces an ok plan', plan.ok === true);
  const byKey = new Map(plan.ok ? plan.entries.map((e) => [e.key, e.text]) : []);
  check('seller broker firm name is populated', byKey.get('seller_broker_firm_name_text'), 'Seller Firm');
  check('seller broker address (ValueOrNone "value") is populated', byKey.get('seller_broker_address_text'), '1 Main St');
  check('seller broker team name (ValueOrNone "none") is blank', byKey.get('seller_broker_team_name_text'), '');
  checkTrue('every buyer broker field is blank when only the seller has an agent', BROKER_TEXT_KEYS.filter((k) => k.startsWith('buyer_broker_')).every((k) => byKey.get(k) === ''));
}

/* ==================================================================== */
/* 7. Invariant, reused, and retired keys are excluded                   */
/* ==================================================================== */

checkTrue('no invariant key appears in CONTRACT_PROJECTION_FIELD_KEYS', CONTRACT_PROJECTION_INVARIANT_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)));
checkTrue('no reused-current-offer key appears in CONTRACT_PROJECTION_FIELD_KEYS', CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)));
checkTrue('none of the 21 retired keys appear in CONTRACT_PROJECTION_FIELD_KEYS', CONTRACT_PROJECTION_RETIRED_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)));
check('exactly 3 invariant keys (INV-67 Phase 2B removed salesPrice.financingSum -- it now projects)', CONTRACT_PROJECTION_INVARIANT_KEYS.length, 3);
checkTrue('salesPrice.financingSum is NOT an invariant key anymore (Phase 2B)', !CONTRACT_PROJECTION_INVARIANT_KEYS.includes('salesPrice.financingSum'));
check('exactly 2 reused-current-offer keys', CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.length, 2);
check('exactly 21 retired keys (compound text-destination repair: 19 + 2)', CONTRACT_PROJECTION_RETIRED_KEYS.length, 21);
check('exactly 28 retained document-line keys (compound text-destination repair: 29 - 2, + 1 Phase 2B legalMunicipality)', CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.length, 28);
check('exactly 6 transport-only keys (4 compound text-destination + 2 Phase 2B)', CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.length, 6);
check(
  '27 of the 28 retained keys (excluding Phase 2B\'s new legalMunicipality, which was never part of the original 48) + 21 retired = the original 48',
  CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.filter((k) => k !== 'propertyLegalDescription.legalMunicipality').length + CONTRACT_PROJECTION_RETIRED_KEYS.length,
  48,
);
checkTrue('earnestMoneyOption.additionalEarnestMoney is retired', CONTRACT_PROJECTION_RETIRED_KEYS.includes('earnestMoneyOption.additionalEarnestMoney'));
checkTrue('closingPossession.closingDate is retired', CONTRACT_PROJECTION_RETIRED_KEYS.includes('closingPossession.closingDate'));
checkTrue('earnestMoneyOption.additionalEarnestMoney is NOT in the retained set', !CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.includes('earnestMoneyOption.additionalEarnestMoney'));
checkTrue('closingPossession.closingDate is NOT in the retained set', !CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.includes('closingPossession.closingDate'));
checkTrue('propertyLegalDescription.legalMunicipality IS in the retained set (Phase 2B)', CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.includes('propertyLegalDescription.legalMunicipality'));
check(
  'CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS is exactly the six approved transport-only names',
  [...CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS].sort(),
  ['additional_earnest_money_amount_text', 'additional_earnest_money_days_text', 'closing_date_month_day_text', 'closing_date_year_suffix_text', 'sales_price_amount_text', 'financing_sum_amount_text'].sort(),
);
checkTrue(
  'none of the 6 transport-only keys collides with any retained, marker, text, or broker key',
  CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.every(
    (k) => !CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.includes(k) && !CHECKBOX_MARKER_KEYS.includes(k) && !CHECKBOX_TEXT_KEYS.includes(k) && !BROKER_TEXT_KEYS.includes(k),
  ),
);
check('exactly 50 checkbox marker keys (48 + district_notices_mark + other_addenda_mark, Phase 2B)', CHECKBOX_MARKER_KEYS.length, 50);
check('exactly 12 checkbox-adjacent text keys (11 + as_is_repairs_text, Phase 2B)', CHECKBOX_TEXT_KEYS.length, 12);
check('exactly 22 broker text keys (unchanged by Phase 2B)', BROKER_TEXT_KEYS.length, 22);
check(
  'INV-67 Phase 2B inventory equation: 28 + 6 + 50 + 12 + 22 = 118 unique projection keys',
  CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.length + CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.length + CHECKBOX_MARKER_KEYS.length + CHECKBOX_TEXT_KEYS.length + BROKER_TEXT_KEYS.length,
  118,
);
check('CONTRACT_PROJECTION_FIELD_KEYS.length is exactly 118', CONTRACT_PROJECTION_FIELD_KEYS.length, 118);
checkTrue('CONTRACT_PROJECTION_FIELD_KEYS has no duplicate key across all five categories', new Set(CONTRACT_PROJECTION_FIELD_KEYS).size === CONTRACT_PROJECTION_FIELD_KEYS.length);
{
  const PHASE_2B_NEW_KEYS = ['propertyLegalDescription.legalMunicipality', 'sales_price_amount_text', 'financing_sum_amount_text', 'as_is_repairs_text', 'district_notices_mark', 'other_addenda_mark'];
  checkTrue('none of the 6 new Phase 2B keys overlaps any retired key', PHASE_2B_NEW_KEYS.every((k) => !CONTRACT_PROJECTION_RETIRED_KEYS.includes(k)));
  checkTrue('none of the 6 new Phase 2B keys overlaps any invariant key', PHASE_2B_NEW_KEYS.every((k) => !CONTRACT_PROJECTION_INVARIANT_KEYS.includes(k)));
  checkTrue('none of the 6 new Phase 2B keys overlaps any reused-current-offer key', PHASE_2B_NEW_KEYS.every((k) => !CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.includes(k)));
  checkTrue('all 6 new Phase 2B keys ARE present in CONTRACT_PROJECTION_FIELD_KEYS', PHASE_2B_NEW_KEYS.every((k) => CONTRACT_PROJECTION_FIELD_KEYS.includes(k)));
}

/* ==================================================================== */
/* 8. reusedCurrentOfferLines (UNCHANGED by this session)                */
/* ==================================================================== */

{
  const preview = completePreview();
  const reused = reusedCurrentOfferLines(preview);
  check('reusedCurrentOfferLines returns exactly the 2 reused keys', reused.map((r) => r.key), [...CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS]);
  check('cashPortion text is carried verbatim', reused.find((r) => r.key === 'salesPrice.cashPortion').text, '$275,000.00');
}

/* ==================================================================== */
/* 9. Integrity guards -- mapping drift / null text (UNAFFECTED retained */
/*    keys only -- `propertyLegalDescription.lot` is now REFORMATTED and */
/*    no longer reads `preview.documentLines` at all, so these two       */
/*    guards must target a key still on the verbatim-preview path, e.g.  */
/*    `earnestMoneyOption.escrowAgentName`)                              */
/* ==================================================================== */

{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.filter((l) => !(l.group === 'earnestMoneyOption' && l.field === 'escrowAgentName'));
  let threw = false;
  try { buildContractProjectionPlan('OPP-1', preview, completeReport(), SELLER_READINESS_OK); } catch (e) { threw = /mapping drift/.test(e.message); }
  checkTrue('throws on mapping drift (an UNAFFECTED retained key with no document line)', threw);
}
{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.map((l) => (l.group === 'earnestMoneyOption' && l.field === 'escrowAgentName' ? { ...l, text: null } : l));
  let threw = false;
  try { buildContractProjectionPlan('OPP-1', preview, completeReport(), SELLER_READINESS_OK); } catch (e) { threw = /no text despite previewComplete/.test(e.message); }
  checkTrue('throws when an UNAFFECTED retained-key line has null text despite previewComplete=true', threw);
}
{
  // Reformatted keys have their OWN integrity guard, reading `report` directly --
  // proven here with `unresolved`, the one FieldDisposition.kind `transportFieldText`
  // treats as a code-integrity violation (never a normal refusal path).
  const preview = completePreview();
  const report = completeReport({ propertyLegalDescription: { lot: { kind: 'unresolved', value: undefined, authority: null, recordedAt: null } } });
  let threw = false;
  try { buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK); } catch (e) { threw = /is unresolved despite previewComplete=true/.test(e.message); }
  checkTrue('throws when a REFORMATTED retained key\'s report disposition is unresolved despite previewComplete=true', threw);
}

/* ==================================================================== */
/* 10. Drift guard -- shared/ghl-config.ts (112 keys) and the ALREADY-   */
/*     PROVISIONED field-creation script (48 keys = original             */
/*     29 retained + 19 retired -- STILL 48/29/19 even after the         */
/*     compound text-destination repair, since that repair only moves    */
/*     2 keys from the retained array to the retired array; their union  */
/*     is unchanged. No new GHL field was created this session for       */
/*     that ORIGINAL 48-key batch, so this script is deliberately        */
/*     untouched)                                                        */
/* ==================================================================== */

{
  const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
  const configListMatch = configSrc.match(/const CONTRACT_PROJECTION_FIELD_KEYS = \[([\s\S]*?)\] as const;/);
  checkTrue('shared/ghl-config.ts declares CONTRACT_PROJECTION_FIELD_KEYS', !!configListMatch);
  // Line-based extraction -- NOT a blanket `"([^"]+)"` scan, which desyncs against the
  // literal `"X"`/`""` example text inside this array's own section-header comments
  // (e.g. `// -- 48 checkbox markers ("X" | "") --`). Only lines that are themselves a
  // bare quoted array element (optionally comma-terminated) count as a key.
  const configKeys = configListMatch
    ? configListMatch[1]
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*"([^"]+)",?\s*$/))
        .filter(Boolean)
        .map((m) => m[1])
    : [];
  check('shared/ghl-config.ts key set matches contract-ghl-projection-model.ts exactly (118 keys, INV-67 Phase 2B)', [...configKeys].sort(), [...CONTRACT_PROJECTION_FIELD_KEYS].sort());

  // INV-67 Phase 2B's 6 new keys, named once here and reused by every
  // "exclude the new keys, compare against the historical/already-
  // provisioned reference" check below.
  const PHASE_2B_NEW_KEYS = ['propertyLegalDescription.legalMunicipality', 'sales_price_amount_text', 'financing_sum_amount_text', 'as_is_repairs_text', 'district_notices_mark', 'other_addenda_mark'];
  const PRE_PHASE_2B_RETAINED_KEYS = CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.filter((k) => !PHASE_2B_NEW_KEYS.includes(k));
  const PRE_PHASE_2B_TRANSPORT_ONLY_KEYS = CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.filter((k) => !PHASE_2B_NEW_KEYS.includes(k));
  const PRE_PHASE_2B_MARKER_KEYS = CHECKBOX_MARKER_KEYS.filter((k) => !PHASE_2B_NEW_KEYS.includes(k));
  const PRE_PHASE_2B_TEXT_KEYS = CHECKBOX_TEXT_KEYS.filter((k) => !PHASE_2B_NEW_KEYS.includes(k));
  check('PRE_PHASE_2B_RETAINED_KEYS has exactly 27 entries (28 - legalMunicipality)', PRE_PHASE_2B_RETAINED_KEYS.length, 27);
  check('PRE_PHASE_2B_TRANSPORT_ONLY_KEYS has exactly 4 entries (6 - 2 Phase 2B)', PRE_PHASE_2B_TRANSPORT_ONLY_KEYS.length, 4);
  check('PRE_PHASE_2B_MARKER_KEYS has exactly 48 entries (50 - 2 Phase 2B)', PRE_PHASE_2B_MARKER_KEYS.length, 48);
  check('PRE_PHASE_2B_TEXT_KEYS has exactly 11 entries (12 - as_is_repairs_text)', PRE_PHASE_2B_TEXT_KEYS.length, 11);

  const scriptSrc = fs.readFileSync(path.join(APP, 'scripts', 'inv67-create-contract-projection-fields.cjs'), 'utf8');
  const specKeys = Array.from(scriptSrc.matchAll(/\{ key: '([^']+)'/g)).map((m) => m[1]).filter((k) => k !== 'contractDraftRequest');
  check('the field-creation script still lists exactly 48 keys (retired, not deleted -- untouched by this repair)', specKeys.length, 48);
  check(
    'the field-creation script\'s 48 keys are EXACTLY the original 29 retained + 19 retired keys (excluding INV-67 Phase 2B\'s legalMunicipality, which post-dates and was never part of that original script)',
    [...specKeys].sort(),
    [...PRE_PHASE_2B_RETAINED_KEYS, ...CONTRACT_PROJECTION_RETIRED_KEYS].sort(),
  );

  const configFieldsBlockMatch = configSrc.match(/contractProjectionFields: \{([\s\S]*?)\r?\n  \},\r?\n  contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI"/);
  checkTrue('shared/ghl-config.ts TEST.contractProjectionFields block is present', !!configFieldsBlockMatch);
  const testRealIdEntries = configFieldsBlockMatch
    ? Array.from(configFieldsBlockMatch[1].matchAll(/"([^"]+)":\s*"(?!CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED)([^"]+)"/g)).map((m) => ({ key: m[1], id: m[2] }))
    : [];
  const testRealIdKeys = testRealIdEntries.map((e) => e.key);

  // Batch 1 (48 CHECKBOX_MARKER_KEYS), Batch 2 (11 CHECKBOX_TEXT_KEYS), and
  // Batch 3 (22 BROKER_TEXT_KEYS) -- INV-67 checkbox-marker / broker-model
  // repair, GHL Test provisioning, 2026-09-14/15 -- were all created live and
  // readback-verified, then wired in with their real ids.
  //
  // COMPOUND TEXT-DESTINATION REPAIR retired 2 of the original 29 retained
  // keys from template projection -- their real TEST ids are simply no
  // longer referenced by `contractProjectionFields` (Option A: no audit-
  // only writer). BATCH 4 provisioned and wired in the 4 (pre-Phase-2B)
  // transport-only keys' real TEST ids. Net: ALL 112 of the (pre-Phase-2B)
  // live projection keys carry a real TEST id -- INV-67 Phase 2B's 6 new
  // keys are deliberately excluded from this reference list; they remain
  // sentinel-filled below, pending a separately authorized Batch 5 apply.
  check(
    'TEST carries a REAL id for exactly 112 keys: the 27 retained + the 48 Batch 1 markers + the 11 Batch 2 contract-text keys + the 22 Batch 3 broker-text keys + the 4 Batch 4 transport-only keys (Phase 2B\'s 6 new keys excluded -- not yet provisioned)',
    [...testRealIdKeys].sort(),
    [...PRE_PHASE_2B_RETAINED_KEYS, ...PRE_PHASE_2B_MARKER_KEYS, ...PRE_PHASE_2B_TEXT_KEYS, ...BROKER_TEXT_KEYS, ...PRE_PHASE_2B_TRANSPORT_ONLY_KEYS].sort(),
  );
  check('exactly 48 of those real-id keys are CHECKBOX_MARKER_KEYS', testRealIdKeys.filter((k) => CHECKBOX_MARKER_KEYS.includes(k)).length, 48);
  check('exactly 11 of those real-id keys are CHECKBOX_TEXT_KEYS', testRealIdKeys.filter((k) => CHECKBOX_TEXT_KEYS.includes(k)).length, 11);
  check('exactly 22 of those real-id keys are BROKER_TEXT_KEYS', testRealIdKeys.filter((k) => BROKER_TEXT_KEYS.includes(k)).length, 22);
  check('exactly 27 of those real-id keys are the retained document-line keys', testRealIdKeys.filter((k) => CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.includes(k)).length, 27);
  check('exactly 4 of those real-id keys are CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS (Batch 4)', testRealIdKeys.filter((k) => CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.includes(k)).length, 4);
  checkTrue(
    'all 112 real-id entries are non-empty, non-whitespace, and never the sentinel string',
    testRealIdEntries.every((e) => e.id.trim().length > 0 && e.id !== 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED'),
  );
  check('all 112 real ids are themselves unique (no id reused across two keys, across all groups)', new Set(testRealIdEntries.map((e) => e.id)).size, 112);
  checkTrue(
    'none of the 3 repeated-destination markers (lease_residential_mark, lease_fixture_mark, possession_leaseback_mark) is missing its real id',
    Object.keys(CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS).every((k) => testRealIdKeys.includes(k)),
  );
  checkTrue('neither retired compound key (additionalEarnestMoney, closingDate) has a real id in TEST', !testRealIdKeys.includes('earnestMoneyOption.additionalEarnestMoney') && !testRealIdKeys.includes('closingPossession.closingDate'));
  checkTrue('neither retired compound key is even PRESENT as an object key in TEST.contractProjectionFields (not just non-real)', !configFieldsBlockMatch[1].includes('"earnestMoneyOption.additionalEarnestMoney"') && !configFieldsBlockMatch[1].includes('"closingPossession.closingDate"'));
  // Jess Gate correction: the prior version of this proof sampled only 2 of
  // the 48 Batch 1 keys, which cannot detect a silent id change on any of
  // the other 46. This is the COMPLETE, known-good reference -- the exact
  // 48 ids verified live and wired in by the Batch 1 apply (PR #54) --
  // checked key-by-key against every one of CHECKBOX_MARKER_KEYS, so a
  // single changed, missing, or extra id fails the check and (via `check`,
  // not `checkTrue`) prints exactly which key(s) differ.
  const BATCH1_APPROVED_MARKER_IDS = {
    lease_residential_mark: 'aScwbIAJRuV3cFiKS09E',
    lease_fixture_mark: 'h60tQTX5V339pL2Kkygs',
    lease_nrl_applies_mark: 'WMXYsnvXYQN9b3CmGXNT',
    lease_nrl_delivered_mark: 'vJz27kh08aSSvBqKaakT',
    lease_nrl_not_delivered_mark: 'LKli45H0Nr3nbZpYwjbp',
    title_expense_seller_mark: '2Su66drCeruZD3BPWLTE',
    title_expense_buyer_mark: 'ayCF12CoJpuDrp0o2D5T',
    shortage_not_amended_mark: '8pphVEZBaRLbjiwOSo91',
    shortage_amended_mark: 'OO8u48boOVwvUhTPlSNb',
    shortage_amended_buyer_mark: '04o5JNDHU8RT1FLBcO4w',
    shortage_amended_seller_mark: '23SCz6pfBxlzXRLBAe23',
    survey_opt1_mark: 'VF0IBL2Si2LaBFh2feaW',
    survey_opt2_mark: 'XZS6zPtncMRmOE7uC2Kx',
    survey_opt3_mark: 'ZoX7uWlw4D7sNnIHhSXb',
    survey_opt1_expense_buyer_mark: 'uCdzFP5SGvJ4gN7nlupp',
    survey_opt1_expense_seller_mark: 'MszEe7kMJBhsjtSqFciy',
    poa_is_subject_mark: 'Z0UnZIVEI1zGK61NpSKJ',
    poa_is_not_subject_mark: 'IcSITgJPOFRkrLMulqjg',
    sdn_received_mark: '8C5DbEYVF1YRuelPRZQV',
    sdn_not_received_mark: 'pvKObPCyffKDzx1hwoYt',
    sdn_not_required_mark: 'KgtPnweNDnOuz6BKjM6k',
    as_is_plain_mark: 'khQmW6JpU3kFzJBH7Nlm',
    as_is_with_repairs_mark: 'oIcJ9Xd21ktI7hOOlvCk',
    water_received_mark: 'MLxpIA58JR9Wqr2ltazg',
    water_not_received_mark: 'dJGi6Pq1bU2lK8NVK8AW',
    water_exempt_mark: 'TkG9weH8ruhKP2iLxmco',
    possession_upon_closing_mark: 'Ae1IFhDcZwJYONOgJXR5',
    possession_leaseback_mark: 'yV2k1PAdSpxCg2B9nBOd',
    spbb_applies_mark: 'O7CzOFOa0phJFy3PEExP',
    spbb_dollar_mark: '8fuIJmOMzmwBkIS7ymMn',
    spbb_percent_mark: '0mlDez8SVUYQDHXuCEsW',
    bpsb_applies_mark: 'ZQywx7qCjxuvds5iexzT',
    bpsb_dollar_mark: 'u3aE3seViwHuJNBfhOYv',
    bpsb_percent_mark: 'Ty3PKjwT1nwBQL2ZVHVy',
    addenda_sale_of_other_property_mark: 'YFgsEFYuzmEXHhkLef9E',
    addenda_lender_appraisal_termination_mark: 'gEfEATkLQv1yX21005c3',
    addenda_section_1031_exchange_mark: 'K9NWow38jwnjGBgHdq9x',
    addenda_short_sale_mark: 'GSbwMGY31JdPaMpiVUi6',
    addenda_hydrostatic_testing_mark: 'JlSUHhT1NFTa8kkXkqi5',
    addenda_environmental_assessment_mark: 'Btu5r6Iuv31PA8vrZoFv',
    addenda_lead_based_paint_mark: '0abvgNZlKfsfPzO1jn1x',
    addenda_propane_gas_service_area_mark: '7Sa2WVq1Y72awT34WVgL',
    addenda_seaward_of_gulf_intracoastal_mark: 'CoqFFXPbIN0QcHPGH75X',
    addenda_coastal_area_property_mark: 'NXTZ9IiHoqdJLIJdABeO',
    addenda_poa_membership_mark: '5ZU2f0XeMWHjQbwBEsD1',
    addenda_non_realty_items_mark: '3PU9i62PLkov9YV6q3Mc',
    addenda_back_up_contract_mark: 'CVKqL2Ir1VNglli2XO6f',
    addenda_mineral_reservation_mark: '1TpO61JNm595TSf7DxwT',
  };
  check('BATCH1_APPROVED_MARKER_IDS itself names exactly the ORIGINAL 48 CHECKBOX_MARKER_KEYS (excluding Phase 2B\'s 2 new markers) -- no missing or extra key in the reference set', [...Object.keys(BATCH1_APPROVED_MARKER_IDS)].sort(), [...PRE_PHASE_2B_MARKER_KEYS].sort());
  check('the 48 approved Batch 1 reference ids are themselves unique', new Set(Object.values(BATCH1_APPROVED_MARKER_IDS)).size, 48);
  {
    // Built by iterating ALL 48 CHECKBOX_MARKER_KEYS (never just the approved
    // reference's own keys), so a key present in TEST under a DIFFERENT id, or
    // absent from TEST entirely, both surface here -- `null` for "missing."
    const observedBatch1Ids = Object.fromEntries(PRE_PHASE_2B_MARKER_KEYS.map((k) => [k, (testRealIdEntries.find((e) => e.key === k) || {}).id ?? null]));
    check(
      'every one of the 48 CHECKBOX_MARKER_KEYS maps to its EXACT previously-approved Batch 1 id in TEST -- full 48-key mapping proof, not a sample',
      observedBatch1Ids,
      BATCH1_APPROVED_MARKER_IDS,
    );
  }
  // Same known-good-reference discipline as Batch 1's fix above, applied here
  // for consistency (this one already covered all 11 keys, not a sample, but
  // `check()` gives a precise per-key diff on failure instead of one boolean).
  const BATCH2_APPROVED_TEXT_IDS = {
    lease_nrl_terminate_within_days_text: 'eeamXWV5F7d8Q6ne9HJy',
    survey_opt1_seller_furnish_days_text: 'u59OMAoyjK9YuTwcqa0r',
    survey_opt2_buyer_obtain_days_text: '61wPlte1S9BkNZpfGLys',
    survey_opt3_seller_furnish_days_text: 'j05f5WAhuvVWbBEzaRP9',
    sdn_deliver_within_days_text: '9Ct8c2DpVFf5Gv0hMAMo',
    water_deliver_within_days_text: 'iyEFgnDlPSrUTnjWh6AL',
    water_source_text: 'mBCxlruQK1THlKzAlCND',
    spbb_dollar_amount_text: 'cLVDbtp1nlPKH9NGUCUz',
    spbb_percent_amount_text: 'mWYz5ZTIbMvSBTOVroCN',
    bpsb_dollar_amount_text: 'btZyfuT3OWUtno5lXBY0',
    bpsb_percent_amount_text: 'zF8SP63sgaDucKbSu9aM',
  };
  check('BATCH2_APPROVED_TEXT_IDS itself names exactly the ORIGINAL 11 CHECKBOX_TEXT_KEYS (excluding Phase 2B\'s as_is_repairs_text) -- no missing or extra key in the reference set', [...Object.keys(BATCH2_APPROVED_TEXT_IDS)].sort(), [...PRE_PHASE_2B_TEXT_KEYS].sort());
  check('the 11 approved Batch 2 reference ids are themselves unique', new Set(Object.values(BATCH2_APPROVED_TEXT_IDS)).size, 11);
  {
    const observedBatch2Ids = Object.fromEntries(PRE_PHASE_2B_TEXT_KEYS.map((k) => [k, (testRealIdEntries.find((e) => e.key === k) || {}).id ?? null]));
    check(
      'every one of the 11 CHECKBOX_TEXT_KEYS maps to its EXACT verified, Brad-authorized Batch 2 id in TEST -- full 11-key mapping proof',
      observedBatch2Ids,
      BATCH2_APPROVED_TEXT_IDS,
    );
  }

  // Same known-good-reference discipline as Batch 1/2's fixes above: the exact
  // 22 ids verified live and wired in by the Batch 3 apply, checked key-by-key
  // against every one of BROKER_TEXT_KEYS.
  const BATCH3_APPROVED_BROKER_TEXT_IDS = {
    seller_broker_firm_name_text: 'fQ5nJcC4J75talRkepts',
    seller_broker_address_text: 'G45ZH9axVugvfobPGvuS',
    seller_broker_firm_license_no_text: 'AoBHfaBz9pBJKikN1Eko',
    seller_broker_associate_name_text: 'Pdep7yJF2NSjUcjSth3k',
    seller_broker_team_name_text: 'sdI6iQaoNk59KbL21Lfl',
    seller_broker_associate_email_text: '8GvAYN43flkL9Ym8taP6',
    seller_broker_associate_phone_text: 'TnPsNqI99PneMzrGbPdD',
    seller_broker_associate_license_no_text: 'KAb0Le7PTH7nvCa8IUtB',
    seller_broker_supervisor_name_text: 'xWpS4xAMNhFRdl4pAOZU',
    seller_broker_supervisor_phone_text: 'kOMxDcTFZGrYjfEP8V6f',
    seller_broker_supervisor_license_no_text: 'QuDhSYEG7OPf6pQSYHqP',
    buyer_broker_firm_name_text: 'VwPs2a9SxVX0tCvh7Fdn',
    buyer_broker_address_text: 'rzGaryRSVJJ4kIf0x9SX',
    buyer_broker_firm_license_no_text: 'UvftPMxalVkg6W2kaFKR',
    buyer_broker_associate_name_text: '3u0i3DFGlwEndug8J1mb',
    buyer_broker_team_name_text: 'p2r4okZEpPOAVrb8jmWz',
    buyer_broker_associate_email_text: 'TGV1cchvAHsytzeG0F0k',
    buyer_broker_associate_phone_text: 'fx126eOS938C09GQx8LM',
    buyer_broker_associate_license_no_text: 'dI3u3ab6APNEI0kyDLlw',
    buyer_broker_supervisor_name_text: 'LQPRlxZ4muswJ74cwGBj',
    buyer_broker_supervisor_phone_text: 'mHsY9gaeivKRLZabmw25',
    buyer_broker_supervisor_license_no_text: 'usaUY2BYjLFXzTMklCU0',
  };
  check('BATCH3_APPROVED_BROKER_TEXT_IDS itself names exactly the 22 BROKER_TEXT_KEYS -- no missing or extra key in the reference set', [...Object.keys(BATCH3_APPROVED_BROKER_TEXT_IDS)].sort(), [...BROKER_TEXT_KEYS].sort());
  check('the 22 approved Batch 3 reference ids are themselves unique', new Set(Object.values(BATCH3_APPROVED_BROKER_TEXT_IDS)).size, 22);
  {
    const observedBatch3Ids = Object.fromEntries(BROKER_TEXT_KEYS.map((k) => [k, (testRealIdEntries.find((e) => e.key === k) || {}).id ?? null]));
    check(
      'every one of the 22 BROKER_TEXT_KEYS maps to its EXACT verified, Brad-authorized Batch 3 id in TEST -- full 22-key mapping proof',
      observedBatch3Ids,
      BATCH3_APPROVED_BROKER_TEXT_IDS,
    );
  }

  // Batch 4 provisioned the last of the ORIGINAL 4 sentinel-filled keys --
  // TEST had ZERO projection sentinels for those 112. INV-67 Phase 2B adds
  // 6 MORE keys to CONTRACT_PROJECTION_FIELD_KEYS (now 118 total); those 6
  // are deliberately sentinel-filled in TEST too, pending a separately
  // authorized Batch 5 apply -- so `sentinelKeys` now correctly names
  // exactly those 6, never zero. The two retired compound keys are
  // correctly ABSENT from CONTRACT_PROJECTION_FIELD_KEYS entirely (checked
  // earlier), so they never appear in `sentinelKeys` either.
  const sentinelKeys = CONTRACT_PROJECTION_FIELD_KEYS.filter((k) => !testRealIdKeys.includes(k));
  check('TEST has exactly 6 projection sentinels remaining -- the INV-67 Phase 2B keys, not yet provisioned (Batch 5)', [...sentinelKeys].sort(), [...PHASE_2B_NEW_KEYS].sort());
  checkTrue('none of the 21 retired keys re-enters the live TEST real-id map', CONTRACT_PROJECTION_RETIRED_KEYS.every((k) => !testRealIdKeys.includes(k)));
  checkTrue(
    'a complete projection plan (all 112 PRE-PHASE-2B keys) can still resolve a real, non-sentinel TEST id for every one of them -- Phase 2B never disturbed a previously-provisioned id',
    [...PRE_PHASE_2B_RETAINED_KEYS, ...PRE_PHASE_2B_TRANSPORT_ONLY_KEYS, ...PRE_PHASE_2B_MARKER_KEYS, ...PRE_PHASE_2B_TEXT_KEYS, ...BROKER_TEXT_KEYS].every((k) => testRealIdKeys.includes(k)),
  );
  checkTrue(
    'each of the 6 new Phase 2B keys resolves to the sentinel (not a real id) in TEST -- correctly blocks a live write until Batch 5 is applied',
    PHASE_2B_NEW_KEYS.every((k) => !testRealIdKeys.includes(k)),
  );
  check('shared/ghl-config.ts CONTRACT_PROJECTION_FIELD_KEYS total is exactly 118 (112 real-id + 6 sentinel)', configKeys.length, 118);

  // Batch 4 (4 CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS) was provisioned
  // live in GHL Test (`scripts/inv67-create-transport-only-fields-batch4.cjs
  // --apply`, 2026-09-16, same location and canonical parentId) -- 149 ->
  // 153 existing Opportunity fields, all 4 created and independently
  // readback-verified (a separate GET, not the provisioning script's own
  // internal confirmation), then a second dry run confirmed 0 create / 4
  // exact-existing-reuse / 0 conflict before these 4 real ids were wired
  // in. Full key-by-key mapping proof, not key presence alone.
  const BATCH4_APPROVED_TRANSPORT_ONLY_IDS = {
    additional_earnest_money_amount_text: 'y6dsY9ckRDEeVnF413FX',
    additional_earnest_money_days_text: 'b26q2D3hlm3Z1YUxerbX',
    closing_date_month_day_text: 'RAghy4JYlTPwXwnGEuN4',
    closing_date_year_suffix_text: 'y6TaYNpbz0xNbDVQMcwg',
  };
  check('BATCH4_APPROVED_TRANSPORT_ONLY_IDS itself names exactly the ORIGINAL 4 transport-only keys (excluding Phase 2B\'s 2 new ones) -- no missing or extra key in the reference set', [...Object.keys(BATCH4_APPROVED_TRANSPORT_ONLY_IDS)].sort(), [...PRE_PHASE_2B_TRANSPORT_ONLY_KEYS].sort());
  check('the 4 approved Batch 4 reference ids are themselves unique', new Set(Object.values(BATCH4_APPROVED_TRANSPORT_ONLY_IDS)).size, 4);
  {
    const observedBatch4Ids = Object.fromEntries(PRE_PHASE_2B_TRANSPORT_ONLY_KEYS.map((k) => [k, (testRealIdEntries.find((e) => e.key === k) || {}).id ?? null]));
    check(
      'every one of the 4 CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS maps to its EXACT verified, Brad-authorized Batch 4 id in TEST -- full 4-key mapping proof',
      observedBatch4Ids,
      BATCH4_APPROVED_TRANSPORT_ONLY_IDS,
    );
  }

  // Jess Gate correction: "the retained TEST ids are exactly unchanged" previously
  // checked only that each retained KEY is present with SOME id -- it could not have
  // caught one of those ids silently changing value. Same known-good-reference
  // discipline as the Batch 1 fix above: the exact 27 ids surviving the compound
  // text-destination repair (predating Batch 1/2, never touched by either), checked
  // key-by-key. The two retired ids (`earnestMoneyOption.additionalEarnestMoney` =
  // lx0NWWA8tgilbEY71n3b, `closingPossession.closingDate` = s7jauYhoSPQd09GjoGOr)
  // are deliberately NOT in this reference -- they must be absent from
  // CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS and from testRealIdKeys both,
  // proven separately above.
  const RETAINED_APPROVED_IDS = {
    'identity.propertyStreetAddress': 'UjJRDmdeuEpQKA9I2yFr',
    'parties.buyerEntityName': 'roFgPXN9bPMeLBxLPhpw',
    'parties.sellerSigners': 'ELLuYUYyPqhVMIKMjSAh',
    'propertyLegalDescription.lot': '0N1jKEJBP1LOsBO9WAfE',
    'propertyLegalDescription.block': 'v3PvqyE7KqNo9wHuF77k',
    'propertyLegalDescription.addition': '8P8xlcoQvJPiTCtEYmze',
    'propertyLegalDescription.county': 'VQdEFCszBn2I1R29v9Ku',
    'propertyLegalDescription.exclusions': '8BkJWlSfgp8WfqcdTE60',
    'earnestMoneyOption.escrowAgentName': 'bhxE1ZSOmyYWrOHqm6jf',
    'earnestMoneyOption.escrowAgentAddress': 'EvuENItvKDCw8WaCHMd3',
    'earnestMoneyOption.earnestMoney': 'HJpetNeLUCy6mIv4hOKO',
    'earnestMoneyOption.optionFee': 'Gygwe13y13CZJJvJFk3y',
    'earnestMoneyOption.optionPeriodDays': '02LqDO3fMiKBLBFzheJX',
    'titleSurvey.titleCompanyName': 'hqovBqMSkSzi7hgyyonq',
    'titleSurvey.objectionsText': 'cqOCAubHmuLFbCl9TczS',
    'titleSurvey.objectionsDays': 'vAInvdtJ0nYHINzAwGy3',
    'propertyCondition.serviceContractCap': 'UiWOxyGDrbWO9cTkJSx9',
    'settlementExpense.sellerCreditCap': 'fUWZ54vsfUyGBlxszHB0',
    'addendaApplicability.districtNotices': 'SpRUfNbdSL94QZz7vfrs',
    'noticeContact.buyerNoticeAddress': 'OWVLUUS4pyD0JA2bRqBy',
    'noticeContact.buyerNoticePhone': '4ehkRvZbgm4xTFqjugib',
    'noticeContact.buyerNoticeEmail': 'glYaD6otYjvlw5avJ5I0',
    'noticeContact.sellerNoticeAddress': '4ZSZTquyk1MTN7wBLqlO',
    'noticeContact.sellerNoticePhone': 'G7ovatOKYrMECUchooxr',
    'noticeContact.sellerNoticeEmail': 'T9TlfDicQnhiHInISE2N',
    'attorneyManualFields.specialProvisions': 'eZImM9FtKYff6CJzAafO',
    'attorneyManualFields.otherAddendaText': 'xQ1mLI1l8aHnhOLe07fy',
  };
  check('RETAINED_APPROVED_IDS itself names exactly the ORIGINAL 27 retained keys (excluding Phase 2B\'s legalMunicipality) -- no missing or extra key in the reference set', [...Object.keys(RETAINED_APPROVED_IDS)].sort(), [...PRE_PHASE_2B_RETAINED_KEYS].sort());
  check('the 27 approved retained reference ids are themselves unique', new Set(Object.values(RETAINED_APPROVED_IDS)).size, 27);
  {
    const observedRetainedIds = Object.fromEntries(PRE_PHASE_2B_RETAINED_KEYS.map((k) => [k, (testRealIdEntries.find((e) => e.key === k) || {}).id ?? null]));
    check(
      'every one of the 27 retained keys maps to its EXACT unchanged id in TEST -- full 27-key mapping proof, not key presence alone',
      observedRetainedIds,
      RETAINED_APPROVED_IDS,
    );
  }

  // The 4 new transport-only keys now carry a real id (Batch 4, this
  // session, proven key-by-key above) -- they DO appear as explicit
  // literal lines in `TEST.contractProjectionFields` now, unlike before
  // Batch 4 when they were sentinel-filled purely via the
  // `...sentinelContractProjectionFields()` spread.

  // Production must remain fully sentinel-filled for all 112 keys -- Batch 1/2/3/4's
  // live Test provisioning must never leak into the PRODUCTION config block.
  const prodSentinelMatch = configSrc.match(/const PRODUCTION: GhlConfig = \{[\s\S]*?contractProjectionFields: sentinelContractProjectionFields\(\),[\s\S]*?contractDraftRequest: CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,/);
  checkTrue('PRODUCTION.contractProjectionFields is still exactly `sentinelContractProjectionFields()` -- untouched by Batch 1/2/3 or this session\'s Test wiring', !!prodSentinelMatch);
  checkTrue('PRODUCTION.contractDraftRequest is still exactly the sentinel constant', !!prodSentinelMatch);

  checkTrue('TEST.contractDraftRequest is unchanged (still the pre-existing real dropdown id, untouched by this repair)', /contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI",/.test(configSrc));

  // INV-67 Seller Count Test-ID wiring (this session). TEST now carries the
  // real, readback-verified id (`scripts/inv67-create-seller-count-field.cjs
  // --apply`, live GHL Test, 2026-09-15); PRODUCTION remains unconditionally
  // sentinel-filled -- neither this session nor any prior one may fake or
  // bypass Production's own gate.
  const SELLER_COUNT_TEST_ID = 'gW6eD1ZgbS4UOhPWVyMm';
  checkTrue(
    'TEST.contractSellerCountField carries the exact verified id, not the sentinel',
    new RegExp(`const TEST: GhlConfig = \\{[\\s\\S]*?contractSellerCountField: "${SELLER_COUNT_TEST_ID}",`).test(configSrc),
  );
  checkTrue(
    'PRODUCTION.contractSellerCountField is still exactly the sentinel constant, unaffected by the Test wiring',
    /const PRODUCTION: GhlConfig = \{[\s\S]*?contractSellerCountField: CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,/.test(configSrc),
  );
  checkTrue(
    'the verified Test id appears in the config file EXACTLY ONCE -- never duplicated',
    (configSrc.match(new RegExp(SELLER_COUNT_TEST_ID, 'g')) || []).length === 1,
  );
  checkTrue(
    'the Test Seller Count id does not collide with TEST.contractDraftRequest',
    SELLER_COUNT_TEST_ID !== 'GlbJxxrxnvMkwJSRNUwI',
  );
  checkTrue(
    'the Test Seller Count id does not collide with any of the 112 real projection-field ids wired in TEST',
    !testRealIdEntries.some((e) => e.id === SELLER_COUNT_TEST_ID),
  );
  checkTrue(
    'Contract Seller Count remains OUTSIDE CONTRACT_PROJECTION_FIELD_KEYS -- still exactly 118 (INV-67 Phase 2B), unaffected by the Test wiring',
    !CONTRACT_PROJECTION_FIELD_KEYS.includes('contractSellerCount') && CONTRACT_PROJECTION_FIELD_KEYS.length === 118,
  );

  // Batch 4 Test-ID wiring (this session) -- no collision with Seller
  // Count, Contract Draft Request, or any of the other 108 projection ids.
  const BATCH4_IDS = ['y6dsY9ckRDEeVnF413FX', 'b26q2D3hlm3Z1YUxerbX', 'RAghy4JYlTPwXwnGEuN4', 'y6TaYNpbz0xNbDVQMcwg'];
  checkTrue('every Batch 4 id appears in the config file EXACTLY ONCE -- never duplicated', BATCH4_IDS.every((id) => (configSrc.match(new RegExp(id, 'g')) || []).length === 1));
  check('the 4 Batch 4 ids are mutually unique', new Set(BATCH4_IDS).size, 4);
  checkTrue('none of the 4 Batch 4 ids collides with TEST.contractSellerCountField', !BATCH4_IDS.includes(SELLER_COUNT_TEST_ID));
  checkTrue('none of the 4 Batch 4 ids collides with TEST.contractDraftRequest', !BATCH4_IDS.includes('GlbJxxrxnvMkwJSRNUwI'));
  checkTrue(
    'none of the 4 Batch 4 ids collides with any of the other 108 (non-Batch-4) real projection-field ids in TEST',
    testRealIdEntries.filter((e) => !CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.includes(e.key)).every((e) => !BATCH4_IDS.includes(e.id)),
  );
}

/* ==================================================================== */
/* 11b. Live pre-write gate now passes the provisioning check in Test,   */
/*      whenever the canonical seller-model gates also pass -- Production*/
/*      still fails closed at the SAME gate                              */
/* ==================================================================== */

{
  const SELLER_COUNT_TEST_ID = 'gW6eD1ZgbS4UOhPWVyMm';
  const SELLER_SENTINEL = 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED';
  const READY_SELLER1 = { ok: true, contactId: 'CONTACT-1', name: 'Jane Seller', email: 'jane@example.com' };
  const ONE_SELLER_READY = { kind: 'populated', value: { kind: 'one_seller', seller1Capacity: 'individual_own_capacity' } };
  const PRINTED_ONE_SELLER = [{ displayName: 'Jane Seller' }];
  const preview = completePreview();
  const report = completeReport();

  const testReadiness = evaluateSellerSigningPreWriteReadiness({
    disposition: ONE_SELLER_READY,
    seller1: READY_SELLER1,
    printedSellerSigners: PRINTED_ONE_SELLER,
    sellerCountFieldId: SELLER_COUNT_TEST_ID,
    sellerCountFieldSentinel: SELLER_SENTINEL,
    sellerCountWriteReadbackVerified: true,
  });
  checkTrue('using the REAL, verified Test id, the pre-write readiness gate is ok:true once every canonical seller gate also passes', testReadiness.ok === true);
  const testPlan = buildContractProjectionPlan('OPP-1', preview, report, testReadiness);
  checkTrue('with the real Test id and a clear canonical model, plan.ok is true -- the provisioning gate no longer blocks in Test', testPlan.ok === true);

  const productionReadiness = evaluateSellerSigningPreWriteReadiness({
    disposition: ONE_SELLER_READY,
    seller1: READY_SELLER1,
    printedSellerSigners: PRINTED_ONE_SELLER,
    sellerCountFieldId: SELLER_SENTINEL, // Production's own live config value, unchanged
    sellerCountFieldSentinel: SELLER_SENTINEL,
    sellerCountWriteReadbackVerified: true,
  });
  checkTrue('using Production\'s own (still-sentinel) field id, the SAME gate still refuses', productionReadiness.ok === false);
  const productionPlan = buildContractProjectionPlan('OPP-1', preview, report, productionReadiness);
  checkTrue('Production still fails closed at the provisioning gate -- plan.ok is false', productionPlan.ok === false);
  checkTrue(
    'Production\'s blocking reason names the Seller Count field provisioning gate',
    productionPlan.ok ? false : productionPlan.blockingReasons.some((r) => r.includes('Contract Seller Count') && r.includes('not yet provisioned')),
  );

  checkTrue('the expected transport value for one_seller remains exactly "One Seller"', sellerCountTransportValue(ONE_SELLER_READY.value) === 'One Seller');
  const twoSellersModel = { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: 'John Seller', email: 'john@example.com' }, seller2Capacity: 'individual_own_capacity' };
  checkTrue('the expected transport value for two_sellers remains exactly "Two Sellers"', sellerCountTransportValue(twoSellersModel) === 'Two Sellers');
}

/* ==================================================================== */
/* 11. Seller-readiness fold (Jess re-gate correction, this session) --   */
/*     buildContractProjectionPlan's REQUIRED fourth argument             */
/* ==================================================================== */

const SELLER_SENTINEL = 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED';
const READY_SELLER1 = { ok: true, contactId: 'CONTACT-1', name: 'Jane Seller', email: 'jane@example.com' };
const ONE_SELLER_READY = { kind: 'populated', value: { kind: 'one_seller', seller1Capacity: 'individual_own_capacity' } };
const PRINTED_ONE_SELLER = [{ displayName: 'Jane Seller' }];

function readySellerReadinessInput(overrides) {
  return {
    disposition: ONE_SELLER_READY,
    seller1: READY_SELLER1,
    printedSellerSigners: PRINTED_ONE_SELLER,
    sellerCountFieldId: 'REAL-FIELD-ID-123',
    sellerCountFieldSentinel: SELLER_SENTINEL,
    sellerCountWriteReadbackVerified: true,
    ...overrides,
  };
}

{
  // A fully-ready seller-readiness input, folded into an otherwise-perfect
  // plan, still produces plan.ok === true -- the fold never blocks a
  // legitimately clear case.
  const preview = completePreview();
  const report = completeReport();
  const readiness = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput());
  checkTrue('a fully-ready seller-readiness input itself evaluates ok:true', readiness.ok === true);
  const plan = buildContractProjectionPlan('OPP-1', preview, report, readiness);
  checkTrue('plan.ok is true when both the TREC facts AND seller readiness are clear', plan.ok === true);
}

{
  // The pre-write gate NEVER depends on sellerCountWriteReadbackVerified --
  // gate 15 is probed as satisfied here and enforced post-write instead
  // (see evaluateSellerSigningPreWriteReadiness's own doc comment).
  const readiness = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput({ sellerCountWriteReadbackVerified: false }));
  checkTrue('the pre-write gate ignores sellerCountWriteReadbackVerified -- still ok:true even when passed false', readiness.ok === true);
}

{
  // The Seller Count field remains the sentinel -- exactly this phase's
  // live reality in both Test and Production. The fold must block the
  // WHOLE plan, before any entries are built, before any GHL write.
  const preview = completePreview();
  const report = completeReport();
  const readiness = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput({ sellerCountFieldId: SELLER_SENTINEL }));
  checkTrue('a sentinel Seller Count field id blocks the pre-write readiness result', readiness.ok === false);
  const plan = buildContractProjectionPlan('OPP-1', preview, report, readiness);
  checkTrue('the sentinel blocks the WHOLE plan -- plan.ok is false', plan.ok === false);
  checkTrue('the plan carries no entries at all when the seller sentinel blocks it (no partial write is even representable)', plan.ok === false && !('entries' in plan));
  checkTrue(
    'the blocking reason names the Seller Count field provisioning gate',
    plan.ok ? false : plan.blockingReasons.some((r) => r.includes('Contract Seller Count') && r.includes('not yet provisioned')),
  );
}

{
  // No SellerSigningModel Note has ever been recorded for this Opportunity
  // -- disposition is "unresolved". Requested must be impossible.
  const preview = completePreview();
  const report = completeReport();
  const readiness = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput({ disposition: { kind: 'unresolved' } }));
  const plan = buildContractProjectionPlan('OPP-1', preview, report, readiness);
  checkTrue('no seller-count Note recorded -- plan.ok is false', plan.ok === false);
}

{
  // Seller 1 unresolved (no bound primary Contact) -- Requested must be impossible.
  const preview = completePreview();
  const report = completeReport();
  const readiness = evaluateSellerSigningPreWriteReadiness(
    readySellerReadinessInput({ seller1: { ok: false, reason: 'No primary Contact is bound to this Opportunity -- Seller 1 cannot be identified.' } }),
  );
  const plan = buildContractProjectionPlan('OPP-1', preview, report, readiness);
  checkTrue('Seller 1 unresolved -- plan.ok is false', plan.ok === false);
}

{
  // Seller 1 capacity unresolved / unsupported -- each independently blocks.
  const preview = completePreview();
  const report = completeReport();
  for (const capacity of ['unresolved', 'unsupported_capacity']) {
    const readiness = evaluateSellerSigningPreWriteReadiness(
      readySellerReadinessInput({ disposition: { kind: 'populated', value: { kind: 'one_seller', seller1Capacity: capacity } } }),
    );
    const plan = buildContractProjectionPlan('OPP-1', preview, report, readiness);
    check(`Seller 1 capacity "${capacity}" -- plan.ok is false`, plan.ok, false);
  }
}

{
  // Two Sellers with missing/invalid Seller 2 data, or duplicate emails --
  // each independently blocks.
  const preview = completePreview();
  const report = completeReport();
  const twoSellersMissingName = { kind: 'populated', value: { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: '', email: 'john@example.com' }, seller2Capacity: 'individual_own_capacity' } };
  const twoSellersDuplicateEmail = { kind: 'populated', value: { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: 'John Seller', email: 'JANE@EXAMPLE.COM' }, seller2Capacity: 'individual_own_capacity' } };
  for (const disposition of [twoSellersMissingName, twoSellersDuplicateEmail]) {
    const readiness = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput({ disposition, printedSellerSigners: [{ displayName: 'Jane Seller' }, { displayName: 'John Seller' }] }));
    const plan = buildContractProjectionPlan('OPP-1', preview, report, readiness);
    checkTrue('invalid Two-Seller data (missing name or duplicate email) -- plan.ok is false', plan.ok === false);
  }
}

{
  // Printed Seller count/name mismatch -- each independently blocks.
  const preview = completePreview();
  const report = completeReport();
  const countMismatch = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput({ printedSellerSigners: [] }));
  const nameMismatch = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput({ printedSellerSigners: [{ displayName: 'Someone Else' }] }));
  checkTrue('printed Seller count mismatch -- plan.ok is false', buildContractProjectionPlan('OPP-1', preview, report, countMismatch).ok === false);
  checkTrue('printed Seller name mismatch -- plan.ok is false', buildContractProjectionPlan('OPP-1', preview, report, nameMismatch).ok === false);
}

{
  // Both a TREC-fact blocking reason AND a seller-readiness blocking reason
  // are present simultaneously -- BOTH sets of reasons are reported, never
  // just one silently swallowing the other.
  const preview = completePreview({ previewComplete: false, blockingReasons: ['Something TREC-side is unresolved.'] });
  const report = completeReport();
  const readiness = evaluateSellerSigningPreWriteReadiness(readySellerReadinessInput({ sellerCountFieldId: SELLER_SENTINEL }));
  const plan = buildContractProjectionPlan('OPP-1', preview, report, readiness);
  checkTrue('plan.ok is false when BOTH a TREC-fact reason and a seller reason apply', plan.ok === false);
  checkTrue(
    'BOTH the TREC-fact reason and the seller reason are present together, neither swallowing the other',
    plan.ok
      ? false
      : plan.blockingReasons.includes('Something TREC-side is unresolved.') &&
          plan.blockingReasons.some((r) => r.includes('Contract Seller Count')),
  );
}

/* ==================================================================== */

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
