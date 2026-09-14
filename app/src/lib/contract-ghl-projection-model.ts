/**
 * Contract -> GHL projection mapping -- INV-67 / B9-12 contract-population
 * repair, extended by the INV-67 checkbox-marker / broker-model repair
 * (this session).
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes. Consumes
 * `contract-document-model.ts`'s already-shipped `ContractDocumentPreview`
 * AND `contract-facts-model.ts`'s `SellerContractFactsReport` directly --
 * REUSED, never reimplemented or re-rendered. This module answers one
 * question: which live GHL Opportunity key does each canonical fact
 * project into, per the locked repair architecture (Brad/Jess ruling,
 * this session, as corrected):
 *
 *   1. IAOS canonical carriers and Notes remain authoritative -- this module
 *      never reads a Note directly; it consumes the already-computed
 *      preview/report only.
 *   2. Required TREC facts project into narrowly scoped Opportunity custom
 *      fields (`CONTRACT_PROJECTION_FIELD_KEYS` below -- 110 keys).
 *   3. Required unresolved facts block synchronization -- `buildContractProjectionPlan`
 *      returns `ok: false` with the exact blocking reasons; it builds no
 *      partial plan.
 *   4. Resolved conditional facts project their canonical result, including
 *      "None" when that is the resolved value.
 *   5. Property address / 6. Buyer entity use NEW Opportunity-scoped fields.
 *   7. Buyer capacity, Texas-license status, the fixed $0 financing sum, and
 *      the fixed not-applicable financing addenda stay INVARIANT -- no field.
 *   9. Equitable-interest disclosure is a pre-contract gate, never body text.
 *  10. Every projection field is written first and read back before the
 *      one-shot control fires.
 *  11. The one-shot `Contract Draft Request` transition is decided elsewhere.
 *
 * CHECKBOX-MARKER / BROKER-MODEL REPAIR (this session) supersedes item 8 of
 * the original header and RETIRES 19 of the original 48 keys -- GHL
 * Checkbox elements cannot bind to Opportunity custom values or
 * conditional logic (Spock's live GHL finding), so every checkbox-shaped
 * TREC fact previously modeled as one rendered-sentence key is retired and
 * replaced by narrow `"X"`/`""` marker keys (`contract-checkbox-marker-
 * model.ts`), and `representation.representation` (mis-cited to ¶8; the
 * real destination is TREC's page-11 broker blocks) is retired and
 * replaced by the 22-key broker text decomposition, gated by
 * `classifyBrokerArrangement` (`contract-broker-arrangement-model.ts`) --
 * intermediary arrangements fail closed, never populated. See
 * `docs/INV67_CONTRACT_POPULATION_REPAIR_V1.md` for the full accounting.
 *
 * `CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS`
 * (`salesPrice.cashPortion`, `salesPrice.salesPrice`) remain DELIBERATELY
 * EXCLUDED from `CONTRACT_PROJECTION_FIELD_KEYS`: both resolve to the exact
 * accepted price already carried by the existing, approved
 * `opportunityFacts.currentOffer` carrier. `ghl.ts`'s sync writer
 * cross-checks `current_offer` against these two document lines instead of
 * writing a new field for them -- REUSE, not duplication.
 */

import type { ContractDocumentPreview } from "./contract-document-model";
import type { SellerContractFactsReport } from "./contract-facts-model";
import {
  buildCheckboxMarkersAndText,
  CHECKBOX_MARKER_KEYS,
  CHECKBOX_TEXT_KEYS,
  BROKER_TEXT_KEYS,
} from "./contract-checkbox-marker-model";

/* ==================================================================== */
/* 1. Field classification -- proven, not inferred (see header)          */
/* ==================================================================== */

/** No GHL field exists for these -- proven invariant by the cited source module, never a per-deal choice. */
export const CONTRACT_PROJECTION_INVARIANT_KEYS = [
  "parties.buyerCapacity",
  "parties.buyerTexasLicenseStatus",
  "salesPrice.financingSum",
  "addendaApplicability.financingAddenda",
] as const;

/** No NEW GHL field for these -- both reuse the existing, approved `opportunityFacts.currentOffer` carrier. */
export const CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS = [
  "salesPrice.cashPortion",
  "salesPrice.salesPrice",
] as const;

/**
 * INV-67 checkbox-marker / broker-model repair. The 19 keys retired from
 * the original 48 -- their dedicated GHL Test field stops receiving
 * writes (kept, never deleted, per the same INV-70 retirement precedent);
 * 15 are checkbox-shaped and replaced by `CHECKBOX_MARKER_KEYS`/
 * `CHECKBOX_TEXT_KEYS`, 4 are fully dropped (no truthful destination
 * exists -- `possessionDetails`, `representation.representation`,
 * `noticeContact.buyerSignerName`, `noticeContact.buyerSignerRole`).
 * `propertyLegalDescription.reservations` is among the 15: it receives NO
 * new field of its own -- it shares `addenda_mineral_reservation_mark`
 * (see `checkMineralReservationConsistency`), so this document's own
 * dedicated "Contract Legal Reservations" field is retired too.
 */
export const CONTRACT_PROJECTION_RETIRED_KEYS = [
  "leaseDisclosure.residentialLeases",
  "leaseDisclosure.fixtureLeases",
  "leaseDisclosure.naturalResourceLeases",
  "titleSurvey.titlePolicyExpenseParty",
  "titleSurvey.shortageAmendmentElection",
  "titleSurvey.surveyElection",
  "titleSurvey.poaMembership",
  "propertyCondition.sellerDisclosureNotice",
  "propertyCondition.asIsElection",
  "propertyCondition.waterDisclosure",
  "closingPossession.possessionElection",
  "settlementExpense.sellerPaysBuyerBroker",
  "settlementExpense.buyerPaysSellerBroker",
  "addendaApplicability.items",
  "propertyLegalDescription.reservations",
  "closingPossession.possessionDetails",
  "representation.representation",
  "noticeContact.buyerSignerName",
  "noticeContact.buyerSignerRole",
] as const;

/**
 * The 29 keys UNCHANGED from the original repair -- still sourced from
 * `ContractDocumentPreview.documentLines` exactly as before, still one
 * rendered-text field each. `additionalEarnestMoney` bundles an amount and
 * a day count on one line but carries no checkbox, so it is out of this
 * repair's authorized scope and stays as-is.
 */
export const CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS = [
  "identity.propertyStreetAddress",
  "parties.buyerEntityName",
  "parties.sellerSigners",
  "propertyLegalDescription.lot",
  "propertyLegalDescription.block",
  "propertyLegalDescription.addition",
  "propertyLegalDescription.county",
  "propertyLegalDescription.exclusions",
  "earnestMoneyOption.escrowAgentName",
  "earnestMoneyOption.escrowAgentAddress",
  "earnestMoneyOption.earnestMoney",
  "earnestMoneyOption.optionFee",
  "earnestMoneyOption.optionPeriodDays",
  "earnestMoneyOption.additionalEarnestMoney",
  "titleSurvey.titleCompanyName",
  "titleSurvey.objectionsText",
  "titleSurvey.objectionsDays",
  "propertyCondition.serviceContractCap",
  "closingPossession.closingDate",
  "settlementExpense.sellerCreditCap",
  "addendaApplicability.districtNotices",
  "noticeContact.buyerNoticeAddress",
  "noticeContact.buyerNoticePhone",
  "noticeContact.buyerNoticeEmail",
  "noticeContact.sellerNoticeAddress",
  "noticeContact.sellerNoticePhone",
  "noticeContact.sellerNoticeEmail",
  "attorneyManualFields.specialProvisions",
  "attorneyManualFields.otherAddendaText",
] as const;

/**
 * The complete, FINAL live projection-key set -- exactly 110: 29 retained
 * (above) + 48 checkbox markers + 11 restructured contract-text keys +
 * 22 page-11 broker-text keys. This is the array `shared/ghl-config.ts`
 * duplicates by hand (that module cannot import from `src/lib`) and
 * `scripts/test-contract-ghl-projection.cjs`'s drift check compares
 * against.
 */
export const CONTRACT_PROJECTION_FIELD_KEYS = [
  ...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS,
  ...CHECKBOX_MARKER_KEYS,
  ...CHECKBOX_TEXT_KEYS,
  ...BROKER_TEXT_KEYS,
] as const;

export type ContractProjectionFieldKey = (typeof CONTRACT_PROJECTION_FIELD_KEYS)[number];

/* ==================================================================== */
/* 2. The plan -- what gets written, or why nothing does                 */
/* ==================================================================== */

export type ContractProjectionEntry = {
  key: ContractProjectionFieldKey;
  /** The exact literal text to write -- `"X"`/`""` for markers, rendered text for document-line keys, never re-rendered here. */
  text: string;
};

export type ContractProjectionPlan =
  | { ok: false; blockingReasons: string[] }
  | {
      ok: true;
      opportunityId: string;
      agreementAt: string;
      versionSeq: number;
      entries: ContractProjectionEntry[];
      /** Non-blocking issues surfaced to the operator -- e.g. the POA-membership/addendum consistency warning. Never causes `ok:false`. */
      warnings: string[];
    };

/** Ruling 9 (see header) -- an independent gate this module adds over `additionalRequiredFacts`, since the upstream preview's own completeness flag does not cover it. */
function equitableInterestBlockingReasons(preview: ContractDocumentPreview): string[] {
  return preview.additionalRequiredFacts
    .filter((line) => line.status === "unresolved")
    .map((line) => `${line.label} is unresolved -- required pre-contract gate, not projected as TREC body text.`);
}

/**
 * Builds the write plan from an already-computed preview AND report. FAILS
 * CLOSED: any unresolved template-blank field, any unresolved additional
 * required fact (ruling 9), a price conflict, a mineral-reservation
 * disagreement, a marker-exclusivity violation, or a blocking broker
 * arrangement (intermediary / represented-but-empty) blocks the ENTIRE
 * sync -- there is no partial plan and no partial write. The caller passes
 * the exact `opportunityId` this plan is scoped to; it is never read off
 * the preview implicitly.
 */
export function buildContractProjectionPlan(
  opportunityId: string,
  preview: ContractDocumentPreview,
  report: SellerContractFactsReport,
): ContractProjectionPlan {
  const equitableInterestBlocking = equitableInterestBlockingReasons(preview);
  if (!preview.previewComplete || equitableInterestBlocking.length > 0) {
    return { ok: false, blockingReasons: [...preview.blockingReasons, ...equitableInterestBlocking] };
  }

  const byKey = new Map(preview.documentLines.map((line) => [`${line.group}.${line.field}`, line]));

  const documentLineEntries: ContractProjectionEntry[] = CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.map((key) => {
    const line = byKey.get(key);
    if (!line) {
      throw new Error(
        `buildContractProjectionPlan: no document line found for projected key "${key}" -- mapping drift between this module and contract-document-model.ts.`,
      );
    }
    if (line.text === null) {
      throw new Error(
        `buildContractProjectionPlan: "${key}" carries no text despite previewComplete=true -- integrity violation, refusing to project a null value.`,
      );
    }
    return { key: key as ContractProjectionFieldKey, text: line.text };
  });

  // Checkbox markers, restructured contract-text, and page-11 broker text --
  // all derived from the SAME report, never re-derived from rendered prose.
  const checkboxResult = buildCheckboxMarkersAndText(report);
  if (!checkboxResult.ok) {
    return { ok: false, blockingReasons: checkboxResult.blockingReasons };
  }

  const markerEntries: ContractProjectionEntry[] = CHECKBOX_MARKER_KEYS.map((key) => ({
    key: key as ContractProjectionFieldKey,
    text: checkboxResult.markers[key],
  }));
  const checkboxTextEntries: ContractProjectionEntry[] = CHECKBOX_TEXT_KEYS.map((key) => ({
    key: key as ContractProjectionFieldKey,
    text: checkboxResult.text[key],
  }));
  const brokerTextEntries: ContractProjectionEntry[] = BROKER_TEXT_KEYS.map((key) => ({
    key: key as ContractProjectionFieldKey,
    text: checkboxResult.brokerText[key],
  }));

  return {
    ok: true,
    opportunityId,
    agreementAt: preview.version.agreementAt,
    versionSeq: preview.version.versionSeq,
    entries: [...documentLineEntries, ...markerEntries, ...checkboxTextEntries, ...brokerTextEntries],
    warnings: checkboxResult.warnings,
  };
}

/**
 * The two document lines that must match the existing, already-written
 * `opportunityFacts.currentOffer` value rather than receive a new field --
 * exposed so `ghl.ts`'s sync writer can cross-check without re-deriving
 * which keys those are.
 */
export function reusedCurrentOfferLines(
  preview: ContractDocumentPreview,
): { key: (typeof CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS)[number]; text: string | null }[] {
  const byKey = new Map(preview.documentLines.map((line) => [`${line.group}.${line.field}`, line]));
  return CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.map((key) => ({ key, text: byKey.get(key)?.text ?? null }));
}
