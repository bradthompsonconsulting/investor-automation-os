/**
 * Seller contract facts -- pure validation/aggregation model. B9-05 / INV-60.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes. Consumes B9-03's
 * `board9-contract-model.ts` directly (`ContractFactAuthority`,
 * `evaluateContractFactState`, `SignerRequirement`, `detectMaterialConflicts`)
 * -- reused, never reimplemented -- and the thirteen carriers in
 * `seller-contract-facts-carriers.ts`. This module answers one question:
 * for every field TREC 20-19 requires, is it populated, intentionally
 * not-applicable, or unresolved -- per this session's locked ruling that
 * an unresolved execution-material field blocks Send for Signature
 * (`blocksSendForSignature` below; the Send action itself is not built by
 * this issue).
 *
 * FIXED CONSTANTS BELOW ARE EXACT VALUES BRAD SUPPLIED THIS SESSION, never
 * invented. Two are deliberately NOT constants -- BTC LLC's own notice
 * address/phone/email and who signs on its behalf were never given exact
 * values, so `BuyerBusinessConfig` is a required, nullable INPUT that
 * fails closed (`unresolved`) until a real, confirmed value is supplied.
 * This module does not decide, and does not guess at, where that value is
 * durably stored.
 *
 * SUPPORTED V1 PATH: **Cash Acquisition / Assignment Exit**. Paragraph 3
 * is fixed by this fact alone -- 3A = the authoritative accepted price,
 * 3B = $0, 3C = the same accepted price -- and resolves ONLY paragraph
 * 3's financing posture; it does not resolve, imply, or default any other
 * contract term (title expense, survey option, possession, or anything
 * else remains its own explicit per-deal entry, per this session's own
 * correction). Third-Party Financing, Seller Financing, Loan Assumption,
 * Subject-To, and other financed/creative structures are UNSUPPORTED in
 * Dollar #1 V1 -- not offered as a choice anywhere in this model.
 *
 * ATTORNEY/MANUAL FIELDS (¶11, ¶22 "Other:") carry disposition and
 * provenance ONLY. This module never reads, evaluates, or forms an
 * opinion about the correctness of any text a `provided_verbatim`
 * disposition carries -- it is opaque here, exactly as
 * `seller-contract-facts-carriers.ts`'s own header states.
 *
 * ASSIGNEE-SIDE equitable-interest disclosure and the Assignment
 * Agreement itself are Board #11 -- not modeled here. FIRPTA/foreign-
 * person status is removed from INV-60 per this session's ruling.
 *
 * JESS GATE CORRECTION ROUND (2026-09-10): (1) ¶5's earnest money, option
 * fee, and option-period-days each resolve independently to populated /
 * explicitly-not-applicable / unresolved via the carrier's own
 * `AmountOrNone`/`DaysOrNone` -- none of the three is forced positive, and
 * none defaults silently. (2) The seller's ¶21 notice address/phone/email
 * are now sourced ONLY from `SellerNoticeConfirmationFacts` -- the
 * property address is no longer read anywhere in this file as a notice
 * value (it is used, unchanged, only for the price/property conflict
 * check, under the renamed `propertyAddress` argument). (3) BTC LLC's own
 * notice/signer info is now sourced from `BuyerBusinessConfigFacts` the
 * same way every other carrier-backed fact here is -- never a `null`
 * threaded in from the caller.
 */

import {
  type ContractFactAuthority,
  type SignerRequirement,
  detectMaterialConflicts,
  type MaterialTermSnapshot,
} from "./board9-contract-model";
import {
  latestBuyerEntityOverrideForOpportunity,
  latestPartySignerFactsForOpportunity,
  latestPropertyLegalDescriptionFactsForOpportunity,
  latestLeaseDisclosureFactsForOpportunity,
  latestEarnestMoneyOptionFactsForOpportunity,
  latestTitleSurveyFactsForOpportunity,
  latestPropertyConditionFactsForOpportunity,
  latestClosingPossessionFactsForOpportunity,
  latestSettlementExpenseFactsForOpportunity,
  latestRepresentationFactsForOpportunity,
  latestAddendaApplicabilityFactsForOpportunity,
  latestSellerEquitableInterestDisclosureForOpportunity,
  latestAttorneyManualFieldDispositionForOpportunity,
  latestSellerNoticeConfirmationFactsForOpportunity,
  latestBuyerBusinessConfigFactsForOpportunity,
  ADDENDA_APPLICABILITY_ITEM_KEYS,
  type ValueOrNone,
  type ReservationsFact,
  type NaturalResourceLeaseFact,
  type AdditionalEarnestMoneyFact,
  type ExpenseParty,
  type ShortageAmendmentElection,
  type SurveyElection,
  type SellerDisclosureNoticeFact,
  type AsIsElectionFact,
  type WaterDisclosureFact,
  type BrokerageContribution,
  type RepresentationFact,
  type AddendaApplicabilityItems,
  type EquitableInterestDisposition,
} from "./seller-contract-facts-carriers";

/* ==================================================================== */
/* 0. Fixed constants -- exact values Brad supplied, never invented      */
/* ==================================================================== */

export const SUPPORTED_ACQUISITION_PATH = "Cash Acquisition / Assignment Exit" as const;

export const BUYER_ENTITY_DEFAULT_NAME = "Brad Thompson Consulting LLC" as const;
export const BUYER_CAPACITY = "Principal, purchasing for its own account" as const;
export const BUYER_TEXAS_LICENSE_STATUS = "None -- holds no Texas broker or sales-agent license, active or inactive" as const;
export const REPRESENTATION_DEFAULT: RepresentationFact = { kind: "none" };

/**
 * NOT hardcoded, and no longer a caller-supplied argument. Sourced ONLY
 * from `latestBuyerBusinessConfigFactsForOpportunity` inside
 * `computeSellerContractFactsReport` below -- the same "read the carrier,
 * fail closed if absent" pattern every other fact group in this file
 * uses. `null` here means the honest current state (no confirmed record
 * yet), never a placeholder a caller must remember to replace.
 */
export type BuyerBusinessConfig = {
  noticeAddress: string;
  noticePhone: string;
  noticeEmail: string;
  signerName: string;
  signerRole: string;
} | null;

/* ==================================================================== */
/* 1. The universal field-disposition primitive (ruling 6)               */
/* ==================================================================== */

export type FieldDisposition<T> =
  | { kind: "populated"; value: T; authority: ContractFactAuthority; recordedAt: string | null }
  | { kind: "not_applicable"; confirmedBy: string | null; at: string; note: string | null }
  | { kind: "unresolved" };

function populated<T>(value: T, authority: ContractFactAuthority, recordedAt: string | null): FieldDisposition<T> {
  return { kind: "populated", value, authority, recordedAt };
}
function unresolved<T>(): FieldDisposition<T> {
  return { kind: "unresolved" };
}

/* ==================================================================== */
/* 2. Sub-reports, one per carrier group / TREC paragraph cluster        */
/* ==================================================================== */

export type PartiesReport = {
  buyerEntityName: FieldDisposition<string>;
  buyerCapacity: FieldDisposition<string>;
  buyerTexasLicenseStatus: FieldDisposition<string>;
  sellerSigners: FieldDisposition<SignerRequirement[]>;
};

export type SalesPriceReport = {
  cashPortion: FieldDisposition<number>;
  financingSum: FieldDisposition<number>;
  salesPrice: FieldDisposition<number>;
  /** Not itself a disposition -- a citation of why 3B is fixed at $0, never a per-deal choice. */
  financingPostureNote: string;
};

export type PropertyLegalDescriptionReport = {
  lot: FieldDisposition<ValueOrNone>;
  block: FieldDisposition<ValueOrNone>;
  addition: FieldDisposition<ValueOrNone>;
  county: FieldDisposition<ValueOrNone>;
  exclusions: FieldDisposition<ValueOrNone>;
  reservations: FieldDisposition<ReservationsFact>;
};

export type LeaseDisclosureReport = {
  residentialLeases: FieldDisposition<"none" | "applies">;
  fixtureLeases: FieldDisposition<"none" | "applies">;
  naturalResourceLeases: FieldDisposition<NaturalResourceLeaseFact>;
};

export type EarnestMoneyOptionReport = {
  escrowAgentName: FieldDisposition<string>;
  escrowAgentAddress: FieldDisposition<string>;
  earnestMoney: FieldDisposition<number>;
  optionFee: FieldDisposition<number>;
  optionPeriodDays: FieldDisposition<number>;
  additionalEarnestMoney: FieldDisposition<AdditionalEarnestMoneyFact>;
};

export type TitleSurveyReport = {
  titlePolicyExpenseParty: FieldDisposition<ExpenseParty>;
  titleCompanyName: FieldDisposition<string>;
  shortageAmendmentElection: FieldDisposition<ShortageAmendmentElection>;
  surveyElection: FieldDisposition<SurveyElection>;
  objectionsText: FieldDisposition<ValueOrNone>;
  objectionsDays: FieldDisposition<number>;
  poaMembership: FieldDisposition<"is_subject" | "is_not_subject">;
};

export type PropertyConditionReport = {
  sellerDisclosureNotice: FieldDisposition<SellerDisclosureNoticeFact>;
  asIsElection: FieldDisposition<AsIsElectionFact>;
  serviceContractCap: FieldDisposition<ValueOrNone>;
  waterDisclosure: FieldDisposition<WaterDisclosureFact>;
};

export type ClosingPossessionReport = {
  closingDate: FieldDisposition<string>;
  possessionElection: FieldDisposition<"upon_closing_and_funding" | "leaseback">;
  possessionDetails: FieldDisposition<ValueOrNone>;
};

export type SettlementExpenseReport = {
  sellerCreditCap: FieldDisposition<ValueOrNone>;
  sellerPaysBuyerBroker: FieldDisposition<BrokerageContribution>;
  buyerPaysSellerBroker: FieldDisposition<BrokerageContribution>;
};

/** Feeds ¶8's disclosure, ¶12B's brokerage lines, ¶21's agent blocks, and page 11's broker contact info -- ONE fact, four render sites. */
export type RepresentationReport = {
  representation: FieldDisposition<RepresentationFact>;
};

export type AddendaApplicabilityReport = {
  items: FieldDisposition<AddendaApplicabilityItems>;
  districtNotices: FieldDisposition<ValueOrNone>;
  /** Always `not_applicable`, unconditionally -- Third-Party Financing, Seller Financing, Loan Assumption, and the VA-restoration-on-assumed-loan addendum are fixed UNSUPPORTED for V1, never a per-deal choice. */
  financingAddenda: FieldDisposition<"unsupported_in_v1">;
};

export type NoticeContactReport = {
  buyerNoticeAddress: FieldDisposition<string>;
  buyerNoticePhone: FieldDisposition<string>;
  buyerNoticeEmail: FieldDisposition<string>;
  buyerSignerName: FieldDisposition<string>;
  buyerSignerRole: FieldDisposition<string>;
  /** Sourced ONLY from `SellerNoticeConfirmationFacts` -- never the property address. */
  sellerNoticeAddress: FieldDisposition<string>;
  sellerNoticePhone: FieldDisposition<string>;
  sellerNoticeEmail: FieldDisposition<string>;
};

export type SellerEquitableInterestReport = {
  disposition: FieldDisposition<EquitableInterestDisposition>;
};

export type AttorneyManualFieldsReport = {
  specialProvisions: FieldDisposition<"not_applicable" | "attorney_will_draft" | "provided_verbatim">;
  otherAddendaText: FieldDisposition<"not_applicable" | "attorney_will_draft" | "provided_verbatim">;
};

export type SellerContractFactsReport = {
  parties: PartiesReport;
  salesPrice: SalesPriceReport;
  propertyLegalDescription: PropertyLegalDescriptionReport;
  leaseDisclosure: LeaseDisclosureReport;
  earnestMoneyOption: EarnestMoneyOptionReport;
  titleSurvey: TitleSurveyReport;
  propertyCondition: PropertyConditionReport;
  closingPossession: ClosingPossessionReport;
  settlementExpense: SettlementExpenseReport;
  representation: RepresentationReport;
  addendaApplicability: AddendaApplicabilityReport;
  noticeContact: NoticeContactReport;
  sellerEquitableInterest: SellerEquitableInterestReport;
  attorneyManualFields: AttorneyManualFieldsReport;
  /** Conflicts between the executed/recorded price and B9-03's own authoritative accepted price -- empty when consistent. */
  priceConflicts: ReturnType<typeof detectMaterialConflicts>;
};

/* ==================================================================== */
/* 3. Computation                                                        */
/* ==================================================================== */

export function computeSellerContractFactsReport(args: {
  opportunityId: string;
  notes: { body: string }[];
  agreedPrice: number;
  agreementAt: string;
  /** Used ONLY for the price/property conflict check below -- never as a notice value (Jess Gate correction). */
  propertyAddress: string | null;
}): SellerContractFactsReport {
  const { opportunityId, notes, agreedPrice, agreementAt, propertyAddress } = args;

  // ---- Parties (¶1) ----
  const buyerOverride = latestBuyerEntityOverrideForOpportunity(notes, opportunityId);
  const partySigners = latestPartySignerFactsForOpportunity(notes, opportunityId);
  const parties: PartiesReport = {
    buyerEntityName: buyerOverride
      ? populated(buyerOverride.buyerName, "brad_authorized", buyerOverride.at)
      : populated(BUYER_ENTITY_DEFAULT_NAME, "system_derived", null),
    buyerCapacity: populated(BUYER_CAPACITY, "system_derived", null),
    buyerTexasLicenseStatus: populated(BUYER_TEXAS_LICENSE_STATUS, "system_derived", null),
    sellerSigners: partySigners
      ? populated(partySigners.signers.map((s) => ({ role: s.role, displayName: s.displayName, signingAuthorityNote: s.signingAuthorityNote })), "operator_attested", partySigners.at)
      : unresolved(),
  };

  // ---- Sales price (¶3) -- Cash Acquisition / Assignment Exit resolves ONLY this paragraph ----
  const salesPrice: SalesPriceReport = {
    cashPortion: populated(agreedPrice, "system_derived", agreementAt),
    financingSum: populated(0, "system_derived", null),
    salesPrice: populated(agreedPrice, "system_derived", agreementAt),
    financingPostureNote:
      `${SUPPORTED_ACQUISITION_PATH}: 3A/3C = the authoritative accepted price ($${agreedPrice}), 3B = $0. ` +
      "Third-Party Financing, Seller Financing, Loan Assumption, Subject-To, and other financed/creative " +
      "structures are unsupported in Dollar #1 V1. This resolves paragraph 3 only -- no other contract term.",
  };

  // ---- Property legal description (¶2) ----
  const legalDesc = latestPropertyLegalDescriptionFactsForOpportunity(notes, opportunityId);
  const propertyLegalDescription: PropertyLegalDescriptionReport = legalDesc
    ? {
        lot: populated(legalDesc.lot, "operator_attested", legalDesc.at),
        block: populated(legalDesc.block, "operator_attested", legalDesc.at),
        addition: populated(legalDesc.addition, "operator_attested", legalDesc.at),
        county: populated(legalDesc.county, "operator_attested", legalDesc.at),
        exclusions: populated(legalDesc.exclusions, "operator_attested", legalDesc.at),
        reservations: populated(legalDesc.reservations, "operator_attested", legalDesc.at),
      }
    : { lot: unresolved(), block: unresolved(), addition: unresolved(), county: unresolved(), exclusions: unresolved(), reservations: unresolved() };

  // ---- Lease disclosure (¶4) ----
  const lease = latestLeaseDisclosureFactsForOpportunity(notes, opportunityId);
  const leaseDisclosure: LeaseDisclosureReport = lease
    ? {
        residentialLeases: populated(lease.residentialLeases, "operator_attested", lease.at),
        fixtureLeases: populated(lease.fixtureLeases, "operator_attested", lease.at),
        naturalResourceLeases: populated(lease.naturalResourceLeases, "operator_attested", lease.at),
      }
    : { residentialLeases: unresolved(), fixtureLeases: unresolved(), naturalResourceLeases: unresolved() };

  // ---- Earnest money and option (¶5) -- Jess Gate correction: each of
  // earnestMoney/optionFee/optionPeriodDays resolves independently to
  // populated / explicitly-not-applicable / unresolved. No field is
  // forced positive, and none defaults silently -- absence of a carrier
  // record is `unresolved`; an explicit `{kind:"none"}`/`{kind:"none"}`
  // is `not_applicable`, never conflated with "not yet decided."
  const earnest = latestEarnestMoneyOptionFactsForOpportunity(notes, opportunityId);
  const earnestMoneyOption: EarnestMoneyOptionReport = earnest
    ? {
        escrowAgentName: populated(earnest.escrowAgentName, "operator_attested", earnest.at),
        escrowAgentAddress: populated(earnest.escrowAgentAddress, "operator_attested", earnest.at),
        earnestMoney: earnest.earnestMoney.kind === "amount"
          ? populated(earnest.earnestMoney.amount, "operator_attested", earnest.at)
          : { kind: "not_applicable", confirmedBy: earnest.operator, at: earnest.at, note: "Explicitly recorded as $0 / waived." },
        optionFee: earnest.optionFee.kind === "amount"
          ? populated(earnest.optionFee.amount, "operator_attested", earnest.at)
          : { kind: "not_applicable", confirmedBy: earnest.operator, at: earnest.at, note: "Explicitly recorded as $0 / waived." },
        optionPeriodDays: earnest.optionPeriodDays.kind === "days"
          ? populated(earnest.optionPeriodDays.days, "operator_attested", earnest.at)
          : { kind: "not_applicable", confirmedBy: earnest.operator, at: earnest.at, note: "Explicitly recorded as no option period." },
        additionalEarnestMoney: earnest.additionalEarnestMoney.kind === "none"
          ? { kind: "not_applicable", confirmedBy: earnest.operator, at: earnest.at, note: "Explicitly confirmed no additional earnest money is due." }
          : populated(earnest.additionalEarnestMoney, "operator_attested", earnest.at),
      }
    : { escrowAgentName: unresolved(), escrowAgentAddress: unresolved(), earnestMoney: unresolved(), optionFee: unresolved(), optionPeriodDays: unresolved(), additionalEarnestMoney: unresolved() };

  // ---- Title and survey (¶6) ----
  const title = latestTitleSurveyFactsForOpportunity(notes, opportunityId);
  const titleSurvey: TitleSurveyReport = title
    ? {
        titlePolicyExpenseParty: populated(title.titlePolicyExpenseParty, "operator_attested", title.at),
        titleCompanyName: populated(title.titleCompanyName, "operator_attested", title.at),
        shortageAmendmentElection: populated(title.shortageAmendmentElection, "operator_attested", title.at),
        surveyElection: populated(title.surveyElection, "operator_attested", title.at),
        objectionsText: populated(title.objectionsText, "operator_attested", title.at),
        objectionsDays: populated(title.objectionsDays, "operator_attested", title.at),
        poaMembership: populated(title.poaMembership, "operator_attested", title.at),
      }
    : { titlePolicyExpenseParty: unresolved(), titleCompanyName: unresolved(), shortageAmendmentElection: unresolved(), surveyElection: unresolved(), objectionsText: unresolved(), objectionsDays: unresolved(), poaMembership: unresolved() };

  // ---- Property condition (¶7) ----
  const condition = latestPropertyConditionFactsForOpportunity(notes, opportunityId);
  const propertyCondition: PropertyConditionReport = condition
    ? {
        sellerDisclosureNotice: populated(condition.sellerDisclosureNotice, "operator_attested", condition.at),
        asIsElection: populated(condition.asIsElection, "operator_attested", condition.at),
        serviceContractCap: populated(condition.serviceContractCap, "operator_attested", condition.at),
        waterDisclosure: populated(condition.waterDisclosure, "operator_attested", condition.at),
      }
    : { sellerDisclosureNotice: unresolved(), asIsElection: unresolved(), serviceContractCap: unresolved(), waterDisclosure: unresolved() };

  // ---- Closing and possession (¶9, ¶10) ----
  const closing = latestClosingPossessionFactsForOpportunity(notes, opportunityId);
  const closingPossession: ClosingPossessionReport = closing
    ? {
        closingDate: populated(closing.closingDate, "operator_attested", closing.at),
        possessionElection: populated(closing.possessionElection, "operator_attested", closing.at),
        possessionDetails: populated(closing.possessionDetails, "operator_attested", closing.at),
      }
    : { closingDate: unresolved(), possessionElection: unresolved(), possessionDetails: unresolved() };

  // ---- Settlement expense (¶12) ----
  const settlement = latestSettlementExpenseFactsForOpportunity(notes, opportunityId);
  const settlementExpense: SettlementExpenseReport = settlement
    ? {
        sellerCreditCap: populated(settlement.sellerCreditCap, "operator_attested", settlement.at),
        sellerPaysBuyerBroker: populated(settlement.sellerPaysBuyerBroker, "operator_attested", settlement.at),
        buyerPaysSellerBroker: populated(settlement.buyerPaysSellerBroker, "operator_attested", settlement.at),
      }
    : { sellerCreditCap: unresolved(), sellerPaysBuyerBroker: unresolved(), buyerPaysSellerBroker: unresolved() };

  // ---- Representation (¶8, ¶12B, p.11, ¶21) -- one shared fact ----
  const rep = latestRepresentationFactsForOpportunity(notes, opportunityId);
  const representation: RepresentationReport = {
    representation: rep ? populated(rep.representation, "operator_attested", rep.at) : populated(REPRESENTATION_DEFAULT, "system_derived", null),
  };

  // ---- Addenda applicability (¶22, minus financing/lease/other) ----
  const addenda = latestAddendaApplicabilityFactsForOpportunity(notes, opportunityId);
  const addendaApplicability: AddendaApplicabilityReport = {
    items: addenda ? populated(addenda.items, "operator_attested", addenda.at) : unresolved(),
    districtNotices: addenda ? populated(addenda.districtNotices, "operator_attested", addenda.at) : unresolved(),
    financingAddenda: {
      kind: "not_applicable",
      confirmedBy: "brad",
      at: agreementAt,
      note: `Third-Party Financing, Seller Financing, Loan Assumption, and the VA-restoration-on-assumed-loan addendum are unsupported in V1 (${SUPPORTED_ACQUISITION_PATH}).`,
    },
  };

  // ---- Buyer business config (BTC LLC notice + signer) -- sourced ONLY
  // from its own carrier, exactly like every other fact group here. Never
  // hardcoded, never threaded in from the caller as a `null` placeholder.
  const buyerBusinessConfig = latestBuyerBusinessConfigFactsForOpportunity(notes, opportunityId);

  // ---- Seller notice confirmation (¶21) -- Jess Gate correction: sourced
  // ONLY from its own explicit-confirmation carrier. `propertyAddress` and
  // any GHL contact phone/email are NEVER read here -- they are candidate/
  // inherited data the UI may pre-fill from, never this fact's value.
  const sellerNotice = latestSellerNoticeConfirmationFactsForOpportunity(notes, opportunityId);

  const noticeContact: NoticeContactReport = {
    buyerNoticeAddress: buyerBusinessConfig ? populated(buyerBusinessConfig.noticeAddress, "brad_authorized", buyerBusinessConfig.at) : unresolved(),
    buyerNoticePhone: buyerBusinessConfig ? populated(buyerBusinessConfig.noticePhone, "brad_authorized", buyerBusinessConfig.at) : unresolved(),
    buyerNoticeEmail: buyerBusinessConfig ? populated(buyerBusinessConfig.noticeEmail, "brad_authorized", buyerBusinessConfig.at) : unresolved(),
    buyerSignerName: buyerBusinessConfig ? populated(buyerBusinessConfig.signerName, "brad_authorized", buyerBusinessConfig.at) : unresolved(),
    buyerSignerRole: buyerBusinessConfig ? populated(buyerBusinessConfig.signerRole, "brad_authorized", buyerBusinessConfig.at) : unresolved(),
    sellerNoticeAddress: sellerNotice ? populated(sellerNotice.noticeAddress, "operator_attested", sellerNotice.at) : unresolved(),
    sellerNoticePhone: !sellerNotice
      ? unresolved()
      : sellerNotice.noticePhone.kind === "value"
        ? populated(sellerNotice.noticePhone.value, "operator_attested", sellerNotice.at)
        : { kind: "not_applicable", confirmedBy: sellerNotice.operator, at: sellerNotice.at, note: "Explicitly confirmed no phone for notice." },
    sellerNoticeEmail: !sellerNotice
      ? unresolved()
      : sellerNotice.noticeEmail.kind === "value"
        ? populated(sellerNotice.noticeEmail.value, "operator_attested", sellerNotice.at)
        : { kind: "not_applicable", confirmedBy: sellerNotice.operator, at: sellerNotice.at, note: "Explicitly confirmed no email for notice." },
  };

  // ---- Seller-side equitable-interest disclosure (assignee-side is Board #11) ----
  const equitable = latestSellerEquitableInterestDisclosureForOpportunity(notes, opportunityId);
  const sellerEquitableInterest: SellerEquitableInterestReport = {
    disposition: equitable ? populated(equitable.disposition, "operator_attested", equitable.at) : unresolved(),
  };

  // ---- Attorney/manual fields (¶11, ¶22 "Other:") -- disposition/provenance only ----
  function attorneyFieldDisposition(slot: "special_provisions" | "other_addenda_text"): FieldDisposition<"not_applicable" | "attorney_will_draft" | "provided_verbatim"> {
    const rec = latestAttorneyManualFieldDispositionForOpportunity(notes, opportunityId, slot);
    if (!rec) return unresolved();
    if (rec.disposition.kind === "not_applicable") {
      return { kind: "not_applicable", confirmedBy: rec.operator, at: rec.at, note: null };
    }
    if (rec.disposition.kind === "attorney_will_draft") {
      // Explicitly still UNRESOLVED for Send-for-Signature purposes -- "will draft" is not "drafted."
      return unresolved();
    }
    return populated("provided_verbatim", "operator_attested", rec.at);
  }
  const attorneyManualFields: AttorneyManualFieldsReport = {
    specialProvisions: attorneyFieldDisposition("special_provisions"),
    otherAddendaText: attorneyFieldDisposition("other_addenda_text"),
  };

  // ---- Price/property conflict check against B9-03's own authoritative accepted price ----
  const authoritative: MaterialTermSnapshot = { price: agreedPrice, propertyAddress: propertyAddress ?? "", parties: [] };
  const recorded: MaterialTermSnapshot = { price: salesPrice.salesPrice.kind === "populated" ? salesPrice.salesPrice.value : agreedPrice, propertyAddress: propertyAddress ?? "", parties: [] };
  const priceConflicts = detectMaterialConflicts(authoritative, recorded);

  return {
    parties, salesPrice, propertyLegalDescription, leaseDisclosure, earnestMoneyOption, titleSurvey,
    propertyCondition, closingPossession, settlementExpense, representation, addendaApplicability,
    noticeContact, sellerEquitableInterest, attorneyManualFields, priceConflicts,
  };
}

/* ==================================================================== */
/* 4. Readiness rollup -- ruling 6, "unresolved blocks Send for Signature" */
/* ==================================================================== */

export type UnresolvedFieldRef = { group: string; field: string };

export type SellerContractFactsReadiness = {
  blocksSendForSignature: boolean;
  unresolvedFields: UnresolvedFieldRef[];
};

/** Explicit, exhaustive enumeration -- never a reflective/dynamic walk, so a field can never silently escape the rollup. */
export function computeSellerContractFactsReadiness(report: SellerContractFactsReport): SellerContractFactsReadiness {
  const entries: [string, string, FieldDisposition<unknown>][] = [
    ["parties", "buyerEntityName", report.parties.buyerEntityName],
    ["parties", "buyerCapacity", report.parties.buyerCapacity],
    ["parties", "buyerTexasLicenseStatus", report.parties.buyerTexasLicenseStatus],
    ["parties", "sellerSigners", report.parties.sellerSigners],
    ["salesPrice", "cashPortion", report.salesPrice.cashPortion],
    ["salesPrice", "financingSum", report.salesPrice.financingSum],
    ["salesPrice", "salesPrice", report.salesPrice.salesPrice],
    ["propertyLegalDescription", "lot", report.propertyLegalDescription.lot],
    ["propertyLegalDescription", "block", report.propertyLegalDescription.block],
    ["propertyLegalDescription", "addition", report.propertyLegalDescription.addition],
    ["propertyLegalDescription", "county", report.propertyLegalDescription.county],
    ["propertyLegalDescription", "exclusions", report.propertyLegalDescription.exclusions],
    ["propertyLegalDescription", "reservations", report.propertyLegalDescription.reservations],
    ["leaseDisclosure", "residentialLeases", report.leaseDisclosure.residentialLeases],
    ["leaseDisclosure", "fixtureLeases", report.leaseDisclosure.fixtureLeases],
    ["leaseDisclosure", "naturalResourceLeases", report.leaseDisclosure.naturalResourceLeases],
    ["earnestMoneyOption", "escrowAgentName", report.earnestMoneyOption.escrowAgentName],
    ["earnestMoneyOption", "escrowAgentAddress", report.earnestMoneyOption.escrowAgentAddress],
    ["earnestMoneyOption", "earnestMoney", report.earnestMoneyOption.earnestMoney],
    ["earnestMoneyOption", "optionFee", report.earnestMoneyOption.optionFee],
    ["earnestMoneyOption", "optionPeriodDays", report.earnestMoneyOption.optionPeriodDays],
    ["earnestMoneyOption", "additionalEarnestMoney", report.earnestMoneyOption.additionalEarnestMoney],
    ["titleSurvey", "titlePolicyExpenseParty", report.titleSurvey.titlePolicyExpenseParty],
    ["titleSurvey", "titleCompanyName", report.titleSurvey.titleCompanyName],
    ["titleSurvey", "shortageAmendmentElection", report.titleSurvey.shortageAmendmentElection],
    ["titleSurvey", "surveyElection", report.titleSurvey.surveyElection],
    ["titleSurvey", "objectionsText", report.titleSurvey.objectionsText],
    ["titleSurvey", "objectionsDays", report.titleSurvey.objectionsDays],
    ["titleSurvey", "poaMembership", report.titleSurvey.poaMembership],
    ["propertyCondition", "sellerDisclosureNotice", report.propertyCondition.sellerDisclosureNotice],
    ["propertyCondition", "asIsElection", report.propertyCondition.asIsElection],
    ["propertyCondition", "serviceContractCap", report.propertyCondition.serviceContractCap],
    ["propertyCondition", "waterDisclosure", report.propertyCondition.waterDisclosure],
    ["closingPossession", "closingDate", report.closingPossession.closingDate],
    ["closingPossession", "possessionElection", report.closingPossession.possessionElection],
    ["closingPossession", "possessionDetails", report.closingPossession.possessionDetails],
    ["settlementExpense", "sellerCreditCap", report.settlementExpense.sellerCreditCap],
    ["settlementExpense", "sellerPaysBuyerBroker", report.settlementExpense.sellerPaysBuyerBroker],
    ["settlementExpense", "buyerPaysSellerBroker", report.settlementExpense.buyerPaysSellerBroker],
    ["representation", "representation", report.representation.representation],
    ["addendaApplicability", "items", report.addendaApplicability.items],
    ["addendaApplicability", "districtNotices", report.addendaApplicability.districtNotices],
    ["addendaApplicability", "financingAddenda", report.addendaApplicability.financingAddenda],
    ["noticeContact", "buyerNoticeAddress", report.noticeContact.buyerNoticeAddress],
    ["noticeContact", "buyerNoticePhone", report.noticeContact.buyerNoticePhone],
    ["noticeContact", "buyerNoticeEmail", report.noticeContact.buyerNoticeEmail],
    ["noticeContact", "buyerSignerName", report.noticeContact.buyerSignerName],
    ["noticeContact", "buyerSignerRole", report.noticeContact.buyerSignerRole],
    ["noticeContact", "sellerNoticeAddress", report.noticeContact.sellerNoticeAddress],
    ["noticeContact", "sellerNoticePhone", report.noticeContact.sellerNoticePhone],
    ["noticeContact", "sellerNoticeEmail", report.noticeContact.sellerNoticeEmail],
    ["sellerEquitableInterest", "disposition", report.sellerEquitableInterest.disposition],
    ["attorneyManualFields", "specialProvisions", report.attorneyManualFields.specialProvisions],
    ["attorneyManualFields", "otherAddendaText", report.attorneyManualFields.otherAddendaText],
  ];

  const unresolvedFields: UnresolvedFieldRef[] = entries
    .filter(([, , d]) => d.kind === "unresolved")
    .map(([group, field]) => ({ group, field }));

  return { blocksSendForSignature: unresolvedFields.length > 0 || report.priceConflicts.length > 0, unresolvedFields };
}
