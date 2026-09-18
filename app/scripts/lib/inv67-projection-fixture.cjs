'use strict';

// Compiles contract-ghl-projection-model.ts and its full dependency chain to
// a temp directory and returns a valid, complete ContractProjectionPlan --
// the SAME reusable synthetic fixture test-contract-ghl-projection.cjs's own
// completeReport()/completePreview()/SELLER_READINESS_OK already use, copied
// here (not re-derived) so this generator wires through the real model
// instead of hand-typing synthetic strings per field.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..');
const TMP = path.join(APP, '.tmp-inv67-pdf-projection-fixture');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
}

function buildProjectionEntries() {
  cleanup();
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  const MODEL = path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts');
  const MARKER_MODEL = path.join(APP, 'src', 'lib', 'contract-checkbox-marker-model.ts');
  const BROKER_MODEL = path.join(APP, 'src', 'lib', 'contract-broker-arrangement-model.ts');
  const CARRIERS = path.join(APP, 'src', 'lib', 'seller-contract-facts-carriers.ts');
  const TRANSPORT = path.join(APP, 'src', 'lib', 'contract-ghl-transport-formatting.ts');
  const SIGNING_MODEL = path.join(APP, 'src', 'lib', 'contract-seller-signing-model.ts');

  try {
    execSync(
      `npx tsc "${MODEL}" "${MARKER_MODEL}" "${BROKER_MODEL}" "${CARRIERS}" "${TRANSPORT}" "${SIGNING_MODEL}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
      { cwd: APP, stdio: 'inherit' },
    );
  } catch (_) {
    cleanup();
    throw new Error('ABORT: TypeScript compilation of the projection model chain failed.');
  }

  const { buildContractProjectionPlan } = require(path.join(TMP, 'contract-ghl-projection-model.js'));
  const { ADDENDA_APPLICABILITY_ITEM_KEYS } = require(path.join(TMP, 'seller-contract-facts-carriers.js'));

  // ---- completePreview() -- verbatim from test-contract-ghl-projection.cjs ----
  const VERSION = { agreementAt: '2026-09-01T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };
  const SELLER_READINESS_OK = { ok: true };

  function line(group, field, status, text) {
    return { paragraph: 'X', group, field, label: `${group}.${field}`, status, text, authority: status === 'unresolved' ? null : 'system_derived', recordedAt: null };
  }

  const CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS = require(path.join(TMP, 'contract-ghl-projection-model.js')).CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS;

  // Preview-verbatim overrides for the 3 retained keys NOT in
  // REFORMATTED_RETAINED_KEYS (they project the preview's own text, not a
  // transport re-render of `report`) -- named Test values instead of the
  // generic "value for <key>" placeholder, since these render directly onto
  // the proof PDF.
  const PREVIEW_TEXT_OVERRIDES = {
    'earnestMoneyOption.escrowAgentName': 'Travis County Title Co.',
    'earnestMoneyOption.escrowAgentAddress': '4521 Test Ridge Lane, Austin, TX 78701',
    'titleSurvey.titleCompanyName': 'Travis County Title Co.',
    'attorneyManualFields.specialProvisions': 'None.',
    'noticeContact.buyerNoticeAddress': '4521 Test Ridge Lane, Austin, TX 78701',
    'noticeContact.buyerNoticePhone': '(512) 555-0101',
    'noticeContact.buyerNoticeEmail': 'buyer.test@example.com',
    'noticeContact.sellerNoticeAddress': '4521 Test Ridge Lane, Austin, TX 78701',
    'noticeContact.sellerNoticePhone': '(512) 555-0102',
    'noticeContact.sellerNoticeEmail': 'seller.test@example.com',
  };

  function completePreview(overrides) {
    const documentLines = [
      line('identity', 'propertyStreetAddress', 'populated', '4521 Test Ridge Lane, Austin, TX 78701'),
      line('parties', 'buyerEntityName', 'populated', 'Brad Thompson Consulting LLC'),
      line('parties', 'buyerCapacity', 'populated', 'Principal, purchasing for its own account'),
      line('parties', 'buyerTexasLicenseStatus', 'populated', 'None'),
      line('parties', 'sellerSigners', 'populated', 'Jane Seller (Owner)'),
      line('salesPrice', 'cashPortion', 'populated', '$275,000.00'),
      line('salesPrice', 'financingSum', 'populated', '$0.00'),
      line('salesPrice', 'salesPrice', 'populated', '$275,000.00'),
      ...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS
        .filter((k) => !['identity.propertyStreetAddress', 'parties.buyerEntityName', 'parties.sellerSigners'].includes(k))
        .map((k) => { const [g, f] = k.split('.'); return line(g, f, 'populated', PREVIEW_TEXT_OVERRIDES[k] || `value for ${k}`); }),
    ];
    const additionalRequiredFacts = [line('sellerEquitableInterest', 'disposition', 'populated', 'Made at 2026-09-01T00:00:00.000Z.')];
    return {
      templateName: 'x', templateSource: 'x', opportunityId: 'OPP-1', version: VERSION,
      documentLines, additionalRequiredFacts,
      unresolvedFieldCount: 0, priceConflictCount: 0, previewComplete: true, blockingReasons: [],
      ...overrides,
    };
  }

  function populated(value) { return { kind: 'populated', value, authority: 'operator_attested', recordedAt: null }; }

  // ---- completeReport() -- verbatim from test-contract-ghl-projection.cjs, ----
  // with synthetic Test values swapped in for the PDF proof's own narrative
  // (name/address/price/date match this generator's committed placements.json).
  function completeReport(overrides) {
    const base = {
      parties: {
        sellerSigners: populated([
          { displayName: 'Jordan A. Testseller', role: 'Owner', signingAuthorityNote: null },
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
      salesPrice: {
        salesPrice: populated(250000),
        cashPortion: populated(250000),
        financingSum: populated(0),
      },
      earnestMoneyOption: {
        escrowAgentName: populated('Travis County Title Co.'),
        escrowAgentAddress: populated('4521 Test Ridge Lane, Austin, TX 78701'),
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
        titleCompanyName: populated('Travis County Title Co.'),
        shortageAmendmentElection: populated({ kind: 'not_amended' }),
        surveyElection: populated({ option: 'buyer_new_survey', buyerObtainDays: 10 }),
        poaMembership: populated('is_not_subject'),
        objectionsText: populated({ kind: 'none' }),
        objectionsDays: populated(15),
      },
      propertyCondition: {
        sellerDisclosureNotice: populated({ kind: 'received' }),
        // as_is_with_repairs (not plain as_is) so `as_is_with_repairs_mark`
        // renders "X" -- matching PR #75's already-proven ordinal 54
        // placement exactly, and giving `as_is_repairs_text` (ordinal 55) a
        // real, non-empty value.
        asIsElection: populated({ kind: 'as_is_with_repairs', repairsText: 'Replace the water heater and repair the rear fence.' }),
        waterDisclosure: populated({ kind: 'received' }),
        serviceContractCap: populated({ kind: 'none' }),
      },
      closingPossession: {
        possessionElection: populated('upon_closing_and_funding'),
        closingDate: populated('2026-10-15T00:00:00.000Z'),
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
      attorneyManualFields: {
        otherAddendaText: { kind: 'not_applicable', confirmedBy: null, at: null, note: null },
      },
    };
    for (const [group, patch] of Object.entries(overrides || {})) {
      base[group] = { ...base[group], ...patch };
    }
    return base;
  }

  const preview = completePreview();
  const report = completeReport();
  const plan = buildContractProjectionPlan('OPP-1', preview, report, SELLER_READINESS_OK);
  cleanup();
  if (!plan.ok) {
    throw new Error('ABORT: synthetic fixture produced plan.ok=false: ' + JSON.stringify(plan.blockingReasons));
  }
  const entriesByKey = new Map(plan.entries.map((e) => [e.key, e.text]));
  return { plan, entriesByKey };
}

module.exports = { buildProjectionEntries };
