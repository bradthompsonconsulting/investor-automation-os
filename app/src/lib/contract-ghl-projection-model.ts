/**
 * Contract -> GHL projection mapping -- INV-67 / B9-12 contract-population repair.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes. Consumes
 * `contract-document-model.ts`'s already-shipped `ContractDocumentPreview`
 * directly -- REUSED, never reimplemented or re-rendered. This module answers
 * one question: which of that preview's already-rendered lines get their own
 * narrowly-scoped GHL Opportunity custom field, which reuse an existing
 * canonical carrier, and which stay invariant (no field at all) -- per the
 * locked repair architecture (Brad/Jess ruling, this session):
 *
 *   1. IAOS canonical carriers and Notes remain authoritative -- this module
 *      never reads a Note directly; it consumes the already-computed
 *      `ContractDocumentPreview`/`SellerContractFactsReport` only.
 *   2. Required TREC facts project into narrowly scoped Opportunity custom
 *      fields (`CONTRACT_PROJECTION_FIELD_KEYS` below).
 *   3. Required unresolved facts block synchronization -- `buildContractProjectionPlan`
 *      returns `ok: false` with the exact blocking reasons; it builds no
 *      partial plan.
 *   4. Resolved conditional facts project their canonical result, including
 *      "None" when that is the resolved value -- entries are built from
 *      `ContractDocumentLine.text`, which already renders a resolved
 *      `not_applicable` disposition as its own literal "None." style text
 *      (`contract-document-model.ts`'s `toLine`). No re-derivation here.
 *   5. Property address uses a NEW Opportunity-scoped field
 *      (`identity.propertyStreetAddress`) -- never the contact-scoped
 *      `contact.property_address`.
 *   6. Buyer entity uses a NEW Opportunity-scoped field
 *      (`parties.buyerEntityName`) so a per-deal override
 *      (`latestBuyerEntityOverrideForOpportunity`) reaches the contract.
 *   7. Buyer capacity and Texas-license status stay INVARIANT -- proven, not
 *      inferred: `contract-facts-model.ts` sources both from fixed exported
 *      constants (`BUYER_CAPACITY`, `BUYER_TEXAS_LICENSE_STATUS`), always
 *      `system_derived`, with no carrier and no override path anywhere in
 *      that module. No GHL field is created for either
 *      (`CONTRACT_PROJECTION_INVARIANT_KEYS`). The same proof applies to
 *      `salesPrice.financingSum` (always `$0`, fixed by the Cash
 *      Acquisition / Assignment Exit path, never a per-deal choice --
 *      `contract-facts-model.ts`'s own `financingPostureNote`) and
 *      `addendaApplicability.financingAddenda` (always the same fixed
 *      `not_applicable` disposition, unconditionally, per that module's own
 *      `computeSellerContractFactsReport`).
 *   8. Broker representation stays deal-specific -- `representation.representation`
 *      is a projected field, sourced from its own carrier
 *      (`latestRepresentationFactsForOpportunity`), not treated as invariant.
 *   9. Equitable-interest disclosure remains a required PRE-CONTRACT GATE,
 *      never invented as TREC body text. It carries no TREC paragraph
 *      citation and is not a `documentLines` entry at all
 *      (`contract-document-model.ts`'s own module header: "NOT a template
 *      blank"), so it is never projected into a GHL body-merge field here.
 *      IMPORTANT, and a deliberate addition this module makes on top of
 *      `contract-document-model.ts`'s shipped code: that module computes
 *      `additionalRequiredFacts` (which carries this fact) but its own
 *      `previewComplete`/`blockingReasons` do NOT loop over it -- OBSERVED
 *      by direct read of `buildContractDocumentPreview`, which builds
 *      `blockingReasons` from `propertyStreetAddress` +
 *      `readiness.unresolvedFields` + `priceConflicts` only.
 *      `computeSellerContractFactsReadiness`'s own exhaustive `entries` list
 *      (`contract-facts-model.ts`) also never names `sellerEquitableInterest`.
 *      A preview can therefore report `previewComplete: true` while the
 *      equitable-interest disclosure is still unresolved. Rather than edit
 *      `contract-document-model.ts` (out of this repair's authorized scope --
 *      "one conceptual change is one revert boundary"), this module adds its
 *      OWN independent gate over `preview.additionalRequiredFacts`, so the
 *      one-shot draft request can never fire while this pre-contract gate is
 *      open, regardless of whether the upstream flag says complete. Flagged
 *      here explicitly for Jess Gate review, not silently patched over.
 *  10. Every projection field is written first and read back before the
 *      one-shot control fires -- this module builds the plan only; the write
 *      and readback are `ghl.ts`'s `syncContractProjectionFields`
 *      (server/network boundary, deliberately kept out of this pure module).
 *  11. The one-shot `Contract Draft Request` transition is a SEPARATE module
 *      (`contract-draft-request-model.ts`) and is never decided here.
 *
 * `CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS`
 * (`salesPrice.cashPortion`, `salesPrice.salesPrice`) are DELIBERATELY
 * EXCLUDED from `CONTRACT_PROJECTION_FIELD_KEYS`: both resolve to the exact
 * accepted price already carried by the existing, approved
 * `opportunityFacts.currentOffer` carrier (INV-70 / B9-07A Family 5) once
 * frozen at Agreement Reached. Creating a second field for either would
 * violate this repair's own "create no duplicate current-offer field"
 * constraint. `ghl.ts`'s sync writer cross-checks `current_offer` against
 * these two document lines instead of writing a new field for them --
 * REUSE, not duplication.
 */

import type { ContractDocumentPreview } from "./contract-document-model";

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
 * The complete set of NEW, narrowly-scoped Opportunity custom fields this
 * repair creates -- one per remaining TREC 20-19 body-merge fact
 * (`documentLines` minus the invariant and reused-current-offer keys above).
 * Order is documentation order, not significant to any consumer.
 */
export const CONTRACT_PROJECTION_FIELD_KEYS = [
  "identity.propertyStreetAddress",
  "parties.buyerEntityName",
  "parties.sellerSigners",
  "propertyLegalDescription.lot",
  "propertyLegalDescription.block",
  "propertyLegalDescription.addition",
  "propertyLegalDescription.county",
  "propertyLegalDescription.exclusions",
  "propertyLegalDescription.reservations",
  "leaseDisclosure.residentialLeases",
  "leaseDisclosure.fixtureLeases",
  "leaseDisclosure.naturalResourceLeases",
  "earnestMoneyOption.escrowAgentName",
  "earnestMoneyOption.escrowAgentAddress",
  "earnestMoneyOption.earnestMoney",
  "earnestMoneyOption.optionFee",
  "earnestMoneyOption.optionPeriodDays",
  "earnestMoneyOption.additionalEarnestMoney",
  "titleSurvey.titlePolicyExpenseParty",
  "titleSurvey.titleCompanyName",
  "titleSurvey.shortageAmendmentElection",
  "titleSurvey.surveyElection",
  "titleSurvey.objectionsText",
  "titleSurvey.objectionsDays",
  "titleSurvey.poaMembership",
  "propertyCondition.sellerDisclosureNotice",
  "propertyCondition.asIsElection",
  "propertyCondition.serviceContractCap",
  "propertyCondition.waterDisclosure",
  "closingPossession.closingDate",
  "closingPossession.possessionElection",
  "closingPossession.possessionDetails",
  "settlementExpense.sellerCreditCap",
  "settlementExpense.sellerPaysBuyerBroker",
  "settlementExpense.buyerPaysSellerBroker",
  "representation.representation",
  "addendaApplicability.items",
  "addendaApplicability.districtNotices",
  "noticeContact.buyerNoticeAddress",
  "noticeContact.buyerNoticePhone",
  "noticeContact.buyerNoticeEmail",
  "noticeContact.buyerSignerName",
  "noticeContact.buyerSignerRole",
  "noticeContact.sellerNoticeAddress",
  "noticeContact.sellerNoticePhone",
  "noticeContact.sellerNoticeEmail",
  "attorneyManualFields.specialProvisions",
  "attorneyManualFields.otherAddendaText",
] as const;

export type ContractProjectionFieldKey = (typeof CONTRACT_PROJECTION_FIELD_KEYS)[number];

/* ==================================================================== */
/* 2. The plan -- what gets written, or why nothing does                 */
/* ==================================================================== */

export type ContractProjectionEntry = {
  key: ContractProjectionFieldKey;
  /** The exact literal text to write -- `ContractDocumentLine.text`, never re-rendered here. */
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
    };

/** Ruling 9 (see header) -- an independent gate this module adds over `additionalRequiredFacts`, since the upstream preview's own completeness flag does not cover it. */
function equitableInterestBlockingReasons(preview: ContractDocumentPreview): string[] {
  return preview.additionalRequiredFacts
    .filter((line) => line.status === "unresolved")
    .map((line) => `${line.label} is unresolved -- required pre-contract gate, not projected as TREC body text.`);
}

/**
 * Builds the write plan from an already-computed preview. FAILS CLOSED: any
 * unresolved template-blank field, any unresolved additional required fact
 * (ruling 9), or a price conflict blocks the ENTIRE sync -- there is no
 * partial plan and no partial write. The caller passes the exact
 * `opportunityId` this plan is scoped to; it is never read off the preview
 * implicitly.
 */
export function buildContractProjectionPlan(
  opportunityId: string,
  preview: ContractDocumentPreview,
): ContractProjectionPlan {
  const equitableInterestBlocking = equitableInterestBlockingReasons(preview);
  if (!preview.previewComplete || equitableInterestBlocking.length > 0) {
    return { ok: false, blockingReasons: [...preview.blockingReasons, ...equitableInterestBlocking] };
  }

  const byKey = new Map(preview.documentLines.map((line) => [`${line.group}.${line.field}`, line]));

  const entries: ContractProjectionEntry[] = CONTRACT_PROJECTION_FIELD_KEYS.map((key) => {
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
    return { key, text: line.text };
  });

  return {
    ok: true,
    opportunityId,
    agreementAt: preview.version.agreementAt,
    versionSeq: preview.version.versionSeq,
    entries,
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
