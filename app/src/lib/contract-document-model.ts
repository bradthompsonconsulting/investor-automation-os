/**
 * Populate the approved purchase agreement from existing deal data --
 * B9-06 / INV-61.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes, no fetch. Consumes
 * `contract-facts-model.ts`'s `SellerContractFactsReport` (B9-05/INV-60,
 * already shipped) and `board9-contract-model.ts`'s `ContractVersionIdentity`
 * (B9-03/INV-58, already shipped) directly -- REUSED, never reimplemented or
 * recomputed. This module answers one question: for the exact Brad-approved
 * V1 template, what does each blank read, is that reading traceable to an
 * authoritative fact, and is the document as a whole sendable.
 *
 * THE APPROVED V1 TEMPLATE. Per Brad's Product Owner ruling recorded on the
 * INV-57 Linear issue (2026-09-09) and `docs/BOARD9_CONTRACT_INVENTORY_V1.md`
 * Part A item 1, no attorney-approved Production purchase agreement exists;
 * TREC NO. 20-19, "ONE TO FOUR FAMILY RESIDENTIAL CONTRACT (RESALE)," was
 * named a *working V1 template candidate* "suitable for architecture, field
 * mapping, and e-sign evaluation" -- explicitly not yet the final
 * attorney-approved Production agreement. B9-05/INV-60 (merged, `docs/TREC
 * Resale Home Contract.pdf`, the exact source PDF committed to this repo)
 * went further and built its entire per-field capture model against this
 * same template's own paragraph numbers (¶1 through ¶23) -- this module
 * continues that same, single, already-adopted V1 template rather than
 * re-opening a question B9-05 already answered by its own committed work.
 * Every paragraph/field citation below (`paragraph`, `templateHeading`) is
 * read directly from that PDF (extracted this session) -- nothing is
 * invented, paraphrased as official, or presented as legally sufficient.
 * Attorney review and final Production template approval remain undecided
 * and unaffected by this module, per that same governing document's own
 * standing disclaimers (b) and (c): no agreement is approved for live use,
 * and IAOS cannot determine legal sufficiency of any agreement.
 *
 * FIELD LABELS mirror `ContractWorkspace.tsx`'s own `FIELD_LABELS` and
 * `SELLER_CONTRACT_FACT_GROUPS` (B9-05/INV-60, already shipped) verbatim,
 * reproduced here rather than imported so this module stays pure/React-free
 * -- the two must be kept in sync by a future editor of either file. This
 * module's own `paragraph` field is strictly finer-grained (e.g. "3A" vs
 * the UI's group-level "¶3") because a document preview must cite the exact
 * blank, not just the paragraph range a checklist item summarizes.
 *
 * NO ALTERNATE TEMPLATE ENGINE, NO INVENTED CONTRACT LANGUAGE. This module
 * never reproduces TREC's own boilerplate clause prose and never drafts a
 * fillable PDF or a new document format. It renders each blank's FILLED
 * VALUE ONLY -- a name, a dollar amount, a date, a day count, or which
 * checkbox option was elected (quoting that option's own short, real
 * addendum title where one exists, e.g. "Short Sale Addendum" from ¶22 --
 * never a paraphrase of legal effect). Per
 * `docs/BOARD9_CONTRACT_INVENTORY_V1.md`'s own recommended integration
 * split: IAOS handles readiness, mapping, and preview; rendering the actual
 * signable document remains GHL's (or whichever provider's) job, downstream
 * of this issue and explicitly out of scope here (HARD NO: no e-sign
 * sending, no send authorization, no Under Contract transition).
 *
 * DOCUMENT REVISION IDENTITY. Reuses `ContractVersionIdentity` and
 * `isSameContractVersion` from `board9-contract-model.ts` verbatim -- no
 * second, competing version scheme is introduced. A preview is tagged with
 * the exact version it was built from; `isContractDocumentPreviewStale`
 * lets a caller detect when the underlying facts have moved on without
 * silently treating an old preview as current.
 *
 * CONSUMES BOARD #8 ECONOMICS, NEVER RECOMPUTES THEM. The only Board #8
 * figure TREC 20-19 has a blank for is the accepted price itself
 * (Paragraph 3) -- already resolved, unchanged, by
 * `SellerContractFactsReport.salesPrice` (`contract-facts-model.ts`'s own
 * "Cash Acquisition / Assignment Exit resolves ONLY paragraph 3" rule).
 * ARV, repairs, and spread are IAOS's own underwriting analysis, not TREC
 * 20-19 contract terms, and are not read by this module.
 *
 * REQUIRED-FIELD VALIDATION reuses `computeSellerContractFactsReadiness`'s
 * `blocksSendForSignature`/`unresolvedFields` rollup verbatim (49 fields,
 * already exhaustively enumerated and tested by B9-05) rather than
 * re-declaring a second, potentially-drifting completeness rule. This
 * module adds exactly one more required fact `SellerContractFactsReport`
 * does not carry: the confirmed property street address (Paragraph 2A) --
 * sourced elsewhere (`PropertyIdentityConfirmation`,
 * `seller-call-readiness-carriers.ts`, already reused by every other B9
 * surface) and supplied here as an already-resolved `FieldDisposition<string>`
 * argument, exactly the same "pure function, caller does the carrier read"
 * convention `contract-facts-model.ts` itself uses for `propertyAddress`.
 *
 * `sellerEquitableInterest` and `attorneyManualFields` are NOT TREC 20-19
 * blanks (the former is a pre-contract compliance fact,
 * `seller-contract-facts-carriers.ts` Section 12; the latter is
 * attorney/manual-controlled free text this module never interprets) and so
 * are never given a `paragraph` citation in `CONTRACT_DOCUMENT_FIELD_MAP` --
 * `attorneyManualFields` fields ARE template blanks (¶11, ¶22 "Other:") and
 * so appear in the map for their disposition/provenance ONLY, exactly as
 * `contract-facts-model.ts` already treats them (opaque, never evaluated);
 * `sellerEquitableInterest` gates `documentSendable` from
 * `additionalRequiredFacts` instead, since it is not a document blank at
 * all.
 */

import {
  type ContractVersionIdentity,
  type SignerRequirement,
  type ContractFactAuthority,
  isSameContractVersion,
} from "./board9-contract-model";
import {
  type SellerContractFactsReport,
  type FieldDisposition,
  computeSellerContractFactsReadiness,
} from "./contract-facts-model";
import type {
  ValueOrNone,
  ReservationsFact,
  NaturalResourceLeaseFact,
  AdditionalEarnestMoneyFact,
  ExpenseParty,
  ShortageAmendmentElection,
  SurveyElection,
  SellerDisclosureNoticeFact,
  AsIsElectionFact,
  WaterDisclosureFact,
  BrokerageContribution,
  RepresentationFact,
  BrokerInfo,
  AddendaApplicabilityItems,
  EquitableInterestDisposition,
} from "./seller-contract-facts-carriers";

/* ==================================================================== */
/* 0. The approved V1 template identity -- cited, never invented         */
/* ==================================================================== */

export const CONTRACT_DOCUMENT_TEMPLATE_NAME =
  'TREC NO. 20-19, "ONE TO FOUR FAMILY RESIDENTIAL CONTRACT (RESALE)"' as const;

/**
 * The exact, committed source this module's `paragraph`/`templateHeading`
 * citations were read from -- OBSERVED this session by direct extraction,
 * not asserted from memory. Whether this specific printed revision is
 * TREC's currently-effective promulgated form or an interim redline remains
 * exactly as unresolved as `BOARD9_CONTRACT_INVENTORY_V1.md` Part A item 1
 * already states; this module does not adjudicate that and does not need
 * to for a reference/architecture mapping against B9-05's own already-built
 * per-paragraph fact model.
 */
export const CONTRACT_DOCUMENT_TEMPLATE_SOURCE =
  'docs/TREC Resale Home Contract.pdf (committed d7a2b18, INV-60/B9-05)' as const;

/* ==================================================================== */
/* 1. Field/group labels -- mirror ContractWorkspace.tsx verbatim         */
/* ==================================================================== */

/** Mirrors `ContractWorkspace.tsx`'s own `SELLER_CONTRACT_FACT_GROUPS` labels verbatim. Keep the two in sync by hand -- see module header. */
export const CONTRACT_DOCUMENT_GROUP_LABEL: Record<string, string> = {
  parties: "Parties (¶1)",
  salesPrice: "Sales Price (¶3)",
  propertyLegalDescription: "Property Legal Description (¶2)",
  leaseDisclosure: "Leases (¶4)",
  earnestMoneyOption: "Earnest Money and Option (¶5)",
  titleSurvey: "Title Policy and Survey (¶6)",
  propertyCondition: "Property Condition (¶7)",
  closingPossession: "Closing and Possession (¶9, ¶10)",
  settlementExpense: "Settlement and Other Expenses (¶12)",
  representation: 'Broker/Agent Representation (¶8, ¶12B, ¶21, p.11)',
  addendaApplicability: "Addenda Applicability (¶22)",
  noticeContact: "Notices (¶21)",
  attorneyManualFields: 'Attorney/Manual Fields (¶11, ¶22 "Other")',
  identity: "Property Identity (¶2A)",
};

/** Mirrors `ContractWorkspace.tsx`'s own `FIELD_LABELS` verbatim, for the fields this module maps to a template blank. Keep the two in sync by hand -- see module header. */
export const CONTRACT_DOCUMENT_FIELD_LABEL: Record<string, string> = {
  "identity.propertyStreetAddress": "Property street address",
  "parties.buyerEntityName": "Buyer entity",
  "parties.buyerCapacity": "Buyer capacity",
  "parties.buyerTexasLicenseStatus": "Buyer Texas real-estate license status",
  "parties.sellerSigners": "Seller signer(s)",
  "salesPrice.cashPortion": "Cash portion (¶3A)",
  "salesPrice.financingSum": "Financing sum (¶3B)",
  "salesPrice.salesPrice": "Sales price (¶3C)",
  "propertyLegalDescription.lot": "Lot",
  "propertyLegalDescription.block": "Block",
  "propertyLegalDescription.addition": "Addition",
  "propertyLegalDescription.county": "County",
  "propertyLegalDescription.exclusions": "Exclusions from conveyance",
  "propertyLegalDescription.reservations": "Reservations",
  "leaseDisclosure.residentialLeases": "Residential leases",
  "leaseDisclosure.fixtureLeases": "Fixture leases",
  "leaseDisclosure.naturalResourceLeases": "Natural resource leases",
  "earnestMoneyOption.escrowAgentName": "Escrow agent name",
  "earnestMoneyOption.escrowAgentAddress": "Escrow agent address",
  "earnestMoneyOption.earnestMoney": "Earnest money",
  "earnestMoneyOption.optionFee": "Option fee",
  "earnestMoneyOption.optionPeriodDays": "Option period (days)",
  "earnestMoneyOption.additionalEarnestMoney": "Additional earnest money",
  "titleSurvey.titlePolicyExpenseParty": "Title policy expense paid by",
  "titleSurvey.titleCompanyName": "Title company",
  "titleSurvey.shortageAmendmentElection": "Title policy shortage amendment",
  "titleSurvey.surveyElection": "Survey",
  "titleSurvey.objectionsText": "Title objections",
  "titleSurvey.objectionsDays": "Title objection days",
  "titleSurvey.poaMembership": "Property Owners Association membership",
  "propertyCondition.sellerDisclosureNotice": "Seller's disclosure notice",
  "propertyCondition.asIsElection": "As-is election",
  "propertyCondition.serviceContractCap": "Residential service contract cap",
  "propertyCondition.waterDisclosure": "Water/wastewater disclosure",
  "closingPossession.closingDate": "Closing date",
  "closingPossession.possessionElection": "Possession",
  "closingPossession.possessionDetails": "Possession details",
  "settlementExpense.sellerCreditCap": "Seller expense credit cap",
  "settlementExpense.sellerPaysBuyerBroker": "Seller pays buyer's broker",
  "settlementExpense.buyerPaysSellerBroker": "Buyer pays seller's broker",
  "representation.representation": "Broker/agent representation",
  "addendaApplicability.items": "Addenda selected",
  "addendaApplicability.districtNotices": "District notices",
  "addendaApplicability.financingAddenda": "Financing addenda",
  "noticeContact.buyerNoticeAddress": "Buyer notice address",
  "noticeContact.buyerNoticePhone": "Buyer notice phone",
  "noticeContact.buyerNoticeEmail": "Buyer notice email",
  "noticeContact.buyerSignerName": "Buyer authorized signer",
  "noticeContact.buyerSignerRole": "Buyer signer role",
  "noticeContact.sellerNoticeAddress": "Seller notice address",
  "noticeContact.sellerNoticePhone": "Seller notice phone",
  "noticeContact.sellerNoticeEmail": "Seller notice email",
  "attorneyManualFields.specialProvisions": "Special provisions (¶11)",
  "attorneyManualFields.otherAddendaText": 'Other addenda (¶22 "Other:")',
};

/** `sellerEquitableInterest` is NOT a template blank -- see module header. Labeled separately so `additionalRequiredFacts` never borrows a template-field label by mistake. */
export const CONTRACT_DOCUMENT_ADDITIONAL_FACT_LABEL: Record<string, string> = {
  "sellerEquitableInterest.disposition": "Seller equitable-interest disclosure",
};

/* ==================================================================== */
/* 2. Generic value renderers -- literal values only, nothing invented   */
/* ==================================================================== */

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysText(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** Calendar date only, UTC, from a canonical ISO instant -- never a locale-dependent rendering (this codebase's own ISO-everywhere discipline). */
function isoCalendarDate(at: string): string {
  return new Date(at).toISOString().slice(0, 10);
}

function renderValueOrNone(v: ValueOrNone): string {
  return v.kind === "none" ? "None (explicitly confirmed)." : v.value;
}

function renderSignerRequirements(signers: SignerRequirement[]): string {
  return signers
    .map((s) => `${s.displayName} (${s.role})${s.signingAuthorityNote ? ` -- ${s.signingAuthorityNote}` : ""}`)
    .join("; ");
}

function renderReservations(r: ReservationsFact): string {
  return r.kind === "none" ? "None." : `Reservation applies -- see attached addendum. ${r.addendumNote}`;
}

function renderNaturalResourceLease(v: NaturalResourceLeaseFact): string {
  if (v.kind === "none") return "None.";
  if (v.kind === "delivered") return "Delivered to Buyer.";
  return `Not yet delivered; Buyer's termination window: ${daysText(v.terminateWithinDays)} after receipt.`;
}

function renderAdditionalEarnestMoney(v: AdditionalEarnestMoneyFact): string {
  if (v.kind === "none") return "None.";
  return `${money(v.amount)} within ${daysText(v.withinDays)} after the Effective Date.`;
}

function renderExpenseParty(p: ExpenseParty): string {
  return p === "seller" ? "Seller's expense." : "Buyer's expense.";
}

function renderShortageAmendmentElection(v: ShortageAmendmentElection): string {
  if (v.kind === "not_amended") return "(i) Not amended -- standard printed exception applies.";
  return `(ii) Amended to read "shortages in area" at ${renderExpenseParty(v.expenseParty)}`;
}

function renderSurveyElection(v: SurveyElection): string {
  if (v.option === "seller_existing_survey") {
    return `(1) Seller furnishes existing survey within ${daysText(v.sellerFurnishDays)} after the Effective Date; if rejected, new survey at ${renderExpenseParty(v.ifRejectedExpenseParty)}`;
  }
  if (v.option === "buyer_new_survey") {
    return `(2) Buyer obtains a new survey within ${daysText(v.buyerObtainDays)} after the Effective Date, at Buyer's expense.`;
  }
  return `(3) Seller furnishes a new survey within ${daysText(v.sellerFurnishDays)} after the Effective Date, at Seller's expense.`;
}

function renderPoaMembership(v: "is_subject" | "is_not_subject"): string {
  return v === "is_subject"
    ? "Property IS subject to mandatory property owners association membership."
    : "Property is NOT subject to mandatory property owners association membership.";
}

function renderSellerDisclosureNotice(v: SellerDisclosureNoticeFact): string {
  if (v.kind === "received") return "(1) Buyer has received the Seller's Disclosure Notice.";
  if (v.kind === "not_yet_received") {
    return `(2) Not yet received; Seller to deliver within ${daysText(v.deliverWithinDays)} after the Effective Date.`;
  }
  return "(3) Not required under the Texas Property Code.";
}

function renderAsIsElection(v: AsIsElectionFact): string {
  return v.kind === "as_is"
    ? "(1) Buyer accepts the Property As Is."
    : `(2) Buyer accepts the Property As Is provided Seller completes: ${v.repairsText}`;
}

function renderWaterDisclosure(v: WaterDisclosureFact): string {
  if (v.kind === "received") return "(1) Buyer has received the Seller's Water Disclosure.";
  if (v.kind === "not_yet_received") {
    return `(2) Not yet received; Seller to deliver within ${daysText(v.deliverWithinDays)} after the Effective Date.`;
  }
  const criteria: string[] = [];
  if (v.noWell) criteria.push("no water well");
  if (v.noPondLakeTank) criteria.push("no pond/lake/tank");
  if (v.noSurfaceWaterCertificate) criteria.push("no surface-water certificate/filing/permit");
  if (v.noSeveredRights) criteria.push("no severed groundwater rights");
  return `(3) Exempt (${criteria.join("; ") || "no exemption criteria recorded"}); water source: ${v.waterSource}.`;
}

function renderBrokerageContribution(v: BrokerageContribution): string {
  if (v.kind === "none") return "None.";
  if (v.kind === "dollar") return money(v.amount);
  return `${v.percent}% of the Sales Price.`;
}

function renderBrokerInfo(b: BrokerInfo): string {
  return `${b.firmName} (Lic. ${b.licenseNo}) -- ${b.associateName} (Lic. ${b.associateLicenseNo}), ${b.phone}, ${b.email}`;
}

function renderRepresentation(v: RepresentationFact): string {
  if (v.kind === "none") return "No broker/agent representation.";
  const seller = v.sellerAgent ? `Seller's agent: ${renderBrokerInfo(v.sellerAgent)}` : "Seller's agent: none.";
  const buyer = v.buyerAgent ? `Buyer's agent: ${renderBrokerInfo(v.buyerAgent)}` : "Buyer's agent: none.";
  return `${seller} ${buyer}`;
}

/** The real, verbatim addendum titles printed on TREC 20-19 ¶22 -- quoted, never paraphrased. */
const ADDENDA_ITEM_TITLE: Record<string, string> = {
  sale_of_other_property: "Addendum for Sale of Other Property by Buyer",
  lender_appraisal_termination: "Addendum Concerning Right to Terminate Due to Lender's Appraisal",
  section_1031_exchange: "Addendum for Section 1031 Exchange",
  short_sale: "Short Sale Addendum",
  hydrostatic_testing: "Addendum for Authorizing Hydrostatic Testing",
  environmental_assessment: "Environmental Assessment, Threatened or Endangered Species, and Wetlands Addendum",
  lead_based_paint:
    "Addendum for Seller's Disclosure of Information on Lead-Based Paint and Lead-Based Paint Hazards as Required by Federal Law",
  propane_gas_service_area: "Addendum for Property in a Propane Gas System Service Area",
  seaward_of_gulf_intracoastal: "Addendum for Property Located Seaward of the Gulf Intracoastal Waterway",
  coastal_area_property: "Addendum for Coastal Area Property",
  poa_membership: "Addendum for Property Subject to Mandatory Membership in a Property Owners Association",
  non_realty_items: "Non-Realty Items Addendum",
  back_up_contract: 'Addendum for "Back-Up" Contract',
  mineral_reservation: "Addendum for Reservation of Oil, Gas, and Other Minerals",
};

function renderAddendaApplicabilityItems(items: AddendaApplicabilityItems): string {
  const selected = Object.entries(items)
    .filter(([, checked]) => checked === true)
    .map(([key]) => ADDENDA_ITEM_TITLE[key] ?? key);
  return selected.length > 0 ? selected.join("; ") : "None selected.";
}

function renderEquitableInterestDisposition(v: EquitableInterestDisposition): string {
  return v.kind === "not_yet_made" ? "Not yet made." : `Made at ${v.at}.`;
}

/* ==================================================================== */
/* 3. The document line -- one per template blank, or additional fact   */
/* ==================================================================== */

export type ContractDocumentLineStatus = "populated" | "not_applicable" | "unresolved";

export type ContractDocumentLine = {
  /** e.g. "3A", "6A(8)", "22" -- read directly from the source PDF, cited in the module header. Empty string for the two fixed-constant identity lines that carry no TREC blank of their own beyond ¶1's caption. */
  paragraph: string;
  group: string;
  field: string;
  label: string;
  status: ContractDocumentLineStatus;
  /** The literal filled value, or `null` when nothing can be rendered yet (`unresolved`). Never invented contract prose -- see module header. */
  text: string | null;
  authority: ContractFactAuthority | null;
  recordedAt: string | null;
};

function toLine<T>(
  paragraph: string,
  group: string,
  field: string,
  disposition: FieldDisposition<T>,
  renderValue: (v: T) => string,
): ContractDocumentLine {
  const key = `${group}.${field}`;
  const label = CONTRACT_DOCUMENT_FIELD_LABEL[key] ?? CONTRACT_DOCUMENT_ADDITIONAL_FACT_LABEL[key] ?? field;
  if (disposition.kind === "populated") {
    return {
      paragraph, group, field, label,
      status: "populated",
      text: renderValue(disposition.value),
      authority: disposition.authority,
      recordedAt: disposition.recordedAt,
    };
  }
  if (disposition.kind === "not_applicable") {
    return {
      paragraph, group, field, label,
      status: "not_applicable",
      text: disposition.note ?? "Not applicable (explicitly confirmed).",
      authority: null,
      recordedAt: disposition.at,
    };
  }
  return { paragraph, group, field, label, status: "unresolved", text: null, authority: null, recordedAt: null };
}

/* ==================================================================== */
/* 4. Per-group line builders -- one per TREC paragraph cluster          */
/* ==================================================================== */

export function buildIdentityLines(propertyStreetAddress: FieldDisposition<string>): ContractDocumentLine[] {
  return [toLine("2A", "identity", "propertyStreetAddress", propertyStreetAddress, (v) => v)];
}

export function buildPartiesLines(r: SellerContractFactsReport["parties"]): ContractDocumentLine[] {
  return [
    toLine("1", "parties", "buyerEntityName", r.buyerEntityName, (v) => v),
    toLine("1", "parties", "buyerCapacity", r.buyerCapacity, (v) => v),
    toLine("1", "parties", "buyerTexasLicenseStatus", r.buyerTexasLicenseStatus, (v) => v),
    toLine("1", "parties", "sellerSigners", r.sellerSigners, renderSignerRequirements),
  ];
}

export function buildSalesPriceLines(r: SellerContractFactsReport["salesPrice"]): ContractDocumentLine[] {
  return [
    toLine("3A", "salesPrice", "cashPortion", r.cashPortion, money),
    toLine("3B", "salesPrice", "financingSum", r.financingSum, money),
    toLine("3C", "salesPrice", "salesPrice", r.salesPrice, money),
  ];
}

export function buildPropertyLegalDescriptionLines(
  r: SellerContractFactsReport["propertyLegalDescription"],
): ContractDocumentLine[] {
  return [
    toLine("2A", "propertyLegalDescription", "lot", r.lot, renderValueOrNone),
    toLine("2A", "propertyLegalDescription", "block", r.block, renderValueOrNone),
    toLine("2A", "propertyLegalDescription", "addition", r.addition, renderValueOrNone),
    toLine("2A", "propertyLegalDescription", "county", r.county, renderValueOrNone),
    toLine("2D", "propertyLegalDescription", "exclusions", r.exclusions, renderValueOrNone),
    toLine("2E", "propertyLegalDescription", "reservations", r.reservations, renderReservations),
  ];
}

export function buildLeaseDisclosureLines(r: SellerContractFactsReport["leaseDisclosure"]): ContractDocumentLine[] {
  return [
    toLine("4A", "leaseDisclosure", "residentialLeases", r.residentialLeases, (v) => (v === "applies" ? "Applies -- Addendum Regarding Residential Leases attached." : "None.")),
    toLine("4B", "leaseDisclosure", "fixtureLeases", r.fixtureLeases, (v) => (v === "applies" ? "Applies -- Addendum Regarding Fixture Leases attached." : "None.")),
    toLine("4C", "leaseDisclosure", "naturalResourceLeases", r.naturalResourceLeases, renderNaturalResourceLease),
  ];
}

export function buildEarnestMoneyOptionLines(
  r: SellerContractFactsReport["earnestMoneyOption"],
): ContractDocumentLine[] {
  return [
    toLine("5A", "earnestMoneyOption", "escrowAgentName", r.escrowAgentName, (v) => v),
    toLine("5A", "earnestMoneyOption", "escrowAgentAddress", r.escrowAgentAddress, (v) => v),
    toLine("5A", "earnestMoneyOption", "earnestMoney", r.earnestMoney, money),
    toLine("5A", "earnestMoneyOption", "optionFee", r.optionFee, money),
    toLine("5B", "earnestMoneyOption", "optionPeriodDays", r.optionPeriodDays, daysText),
    toLine("5(1)", "earnestMoneyOption", "additionalEarnestMoney", r.additionalEarnestMoney, renderAdditionalEarnestMoney),
  ];
}

export function buildTitleSurveyLines(r: SellerContractFactsReport["titleSurvey"]): ContractDocumentLine[] {
  return [
    toLine("6A", "titleSurvey", "titlePolicyExpenseParty", r.titlePolicyExpenseParty, renderExpenseParty),
    toLine("6A", "titleSurvey", "titleCompanyName", r.titleCompanyName, (v) => v),
    toLine("6A(8)", "titleSurvey", "shortageAmendmentElection", r.shortageAmendmentElection, renderShortageAmendmentElection),
    toLine("6C", "titleSurvey", "surveyElection", r.surveyElection, renderSurveyElection),
    toLine("6D", "titleSurvey", "objectionsText", r.objectionsText, renderValueOrNone),
    toLine("6D", "titleSurvey", "objectionsDays", r.objectionsDays, daysText),
    toLine("6E(2)", "titleSurvey", "poaMembership", r.poaMembership, renderPoaMembership),
  ];
}

export function buildPropertyConditionLines(r: SellerContractFactsReport["propertyCondition"]): ContractDocumentLine[] {
  return [
    toLine("7B", "propertyCondition", "sellerDisclosureNotice", r.sellerDisclosureNotice, renderSellerDisclosureNotice),
    toLine("7D", "propertyCondition", "asIsElection", r.asIsElection, renderAsIsElection),
    toLine("7H", "propertyCondition", "serviceContractCap", r.serviceContractCap, renderValueOrNone),
    toLine("7I", "propertyCondition", "waterDisclosure", r.waterDisclosure, renderWaterDisclosure),
  ];
}

export function buildClosingPossessionLines(r: SellerContractFactsReport["closingPossession"]): ContractDocumentLine[] {
  return [
    toLine("9A", "closingPossession", "closingDate", r.closingDate, isoCalendarDate),
    toLine("10A", "closingPossession", "possessionElection", r.possessionElection, (v) => (v === "upon_closing_and_funding" ? "Upon closing and funding." : "According to a temporary residential lease.")),
    toLine("10A", "closingPossession", "possessionDetails", r.possessionDetails, renderValueOrNone),
  ];
}

export function buildSettlementExpenseLines(r: SellerContractFactsReport["settlementExpense"]): ContractDocumentLine[] {
  return [
    toLine("12A(1)(b)", "settlementExpense", "sellerCreditCap", r.sellerCreditCap, renderValueOrNone),
    toLine("12B(1)", "settlementExpense", "sellerPaysBuyerBroker", r.sellerPaysBuyerBroker, renderBrokerageContribution),
    toLine("12B(2)", "settlementExpense", "buyerPaysSellerBroker", r.buyerPaysSellerBroker, renderBrokerageContribution),
  ];
}

export function buildRepresentationLines(r: SellerContractFactsReport["representation"]): ContractDocumentLine[] {
  return [toLine("8", "representation", "representation", r.representation, renderRepresentation)];
}

export function buildAddendaApplicabilityLines(
  r: SellerContractFactsReport["addendaApplicability"],
): ContractDocumentLine[] {
  return [
    toLine("22", "addendaApplicability", "items", r.items, renderAddendaApplicabilityItems),
    toLine("22", "addendaApplicability", "districtNotices", r.districtNotices, renderValueOrNone),
    toLine("22", "addendaApplicability", "financingAddenda", r.financingAddenda, () => "None -- unsupported in V1 (Cash Acquisition / Assignment Exit)."),
  ];
}

export function buildNoticeContactLines(r: SellerContractFactsReport["noticeContact"]): ContractDocumentLine[] {
  return [
    toLine("21", "noticeContact", "buyerNoticeAddress", r.buyerNoticeAddress, (v) => v),
    toLine("21", "noticeContact", "buyerNoticePhone", r.buyerNoticePhone, (v) => v),
    toLine("21", "noticeContact", "buyerNoticeEmail", r.buyerNoticeEmail, (v) => v),
    toLine("21", "noticeContact", "buyerSignerName", r.buyerSignerName, (v) => v),
    toLine("21", "noticeContact", "buyerSignerRole", r.buyerSignerRole, (v) => v),
    toLine("21", "noticeContact", "sellerNoticeAddress", r.sellerNoticeAddress, (v) => v),
    toLine("21", "noticeContact", "sellerNoticePhone", r.sellerNoticePhone, (v) => v),
    toLine("21", "noticeContact", "sellerNoticeEmail", r.sellerNoticeEmail, (v) => v),
  ];
}

export function buildAttorneyManualFieldsLines(
  r: SellerContractFactsReport["attorneyManualFields"],
): ContractDocumentLine[] {
  const render = (v: "not_applicable" | "attorney_will_draft" | "provided_verbatim") =>
    v === "provided_verbatim"
      ? "Provided verbatim by attorney/operator -- this module does not evaluate its content."
      : "Not applicable.";
  return [
    toLine("11", "attorneyManualFields", "specialProvisions", r.specialProvisions, render),
    toLine('22 "Other:"', "attorneyManualFields", "otherAddendaText", r.otherAddendaText, render),
  ];
}

/** NOT a template blank -- see module header. No `paragraph` citation; gates `documentSendable` from its own `additionalRequiredFacts` list instead. */
export function buildAdditionalRequiredFacts(
  r: SellerContractFactsReport["sellerEquitableInterest"],
): ContractDocumentLine[] {
  return [toLine("", "sellerEquitableInterest", "disposition", r.disposition, renderEquitableInterestDisposition)];
}

/* ==================================================================== */
/* 5. The full preview -- deterministic mapping + readiness + revision  */
/* ==================================================================== */

export type ContractDocumentPreview = {
  templateName: typeof CONTRACT_DOCUMENT_TEMPLATE_NAME;
  templateSource: typeof CONTRACT_DOCUMENT_TEMPLATE_SOURCE;
  opportunityId: string;
  version: ContractVersionIdentity;
  /** Every TREC 20-19 blank this V1 path maps, in template paragraph order. */
  documentLines: ContractDocumentLine[];
  /** Facts required before Send but NOT a template blank (`sellerEquitableInterest`) -- see module header. */
  additionalRequiredFacts: ContractDocumentLine[];
  /** Verbatim from `contract-facts-model.ts` -- never re-derived. */
  unresolvedFieldCount: number;
  priceConflictCount: number;
  /** `false` when any template-blank field, any additional required fact, the property street address, or a price conflict is not resolved -- "missing or conflicting facts prevent a sendable document." */
  documentSendable: boolean;
  /** Operator-readable, one entry per blocking condition -- never a bare boolean. */
  blockingReasons: string[];
};

export type BuildContractDocumentPreviewArgs = {
  opportunityId: string;
  version: ContractVersionIdentity;
  report: SellerContractFactsReport;
  /** Sourced elsewhere (`PropertyIdentityConfirmation`) and supplied already-resolved -- this module performs no carrier read. See module header. */
  propertyStreetAddress: FieldDisposition<string>;
};

export function buildContractDocumentPreview(args: BuildContractDocumentPreviewArgs): ContractDocumentPreview {
  const { opportunityId, version, report, propertyStreetAddress } = args;

  const documentLines: ContractDocumentLine[] = [
    ...buildIdentityLines(propertyStreetAddress),
    ...buildPartiesLines(report.parties),
    ...buildSalesPriceLines(report.salesPrice),
    ...buildPropertyLegalDescriptionLines(report.propertyLegalDescription),
    ...buildLeaseDisclosureLines(report.leaseDisclosure),
    ...buildEarnestMoneyOptionLines(report.earnestMoneyOption),
    ...buildTitleSurveyLines(report.titleSurvey),
    ...buildPropertyConditionLines(report.propertyCondition),
    ...buildClosingPossessionLines(report.closingPossession),
    ...buildSettlementExpenseLines(report.settlementExpense),
    ...buildRepresentationLines(report.representation),
    ...buildAddendaApplicabilityLines(report.addendaApplicability),
    ...buildNoticeContactLines(report.noticeContact),
    ...buildAttorneyManualFieldsLines(report.attorneyManualFields),
  ];

  const additionalRequiredFacts = buildAdditionalRequiredFacts(report.sellerEquitableInterest);

  const readiness = computeSellerContractFactsReadiness(report);

  const blockingReasons: string[] = [];
  if (propertyStreetAddress.kind !== "populated" || propertyStreetAddress.value.trim() === "") {
    blockingReasons.push("Property street address (¶2A) is not yet confirmed.");
  }
  for (const ref of readiness.unresolvedFields) {
    const label = CONTRACT_DOCUMENT_FIELD_LABEL[`${ref.group}.${ref.field}`]
      ?? CONTRACT_DOCUMENT_ADDITIONAL_FACT_LABEL[`${ref.group}.${ref.field}`]
      ?? ref.field;
    const groupLabel = CONTRACT_DOCUMENT_GROUP_LABEL[ref.group] ?? ref.group;
    blockingReasons.push(`${groupLabel} -- ${label} is unresolved.`);
  }
  for (const conflict of report.priceConflicts) {
    blockingReasons.push(
      `Price conflict on ${conflict.field}: agreement value "${conflict.agreementValue}" vs. recorded value "${conflict.candidateValue}".`,
    );
  }

  return {
    templateName: CONTRACT_DOCUMENT_TEMPLATE_NAME,
    templateSource: CONTRACT_DOCUMENT_TEMPLATE_SOURCE,
    opportunityId,
    version,
    documentLines,
    additionalRequiredFacts,
    unresolvedFieldCount: readiness.unresolvedFields.length,
    priceConflictCount: report.priceConflicts.length,
    documentSendable: blockingReasons.length === 0,
    blockingReasons,
  };
}

/**
 * Document revision identity (locked requirement). Reuses
 * `isSameContractVersion` verbatim -- no second version-equality
 * implementation. A caller holding a previously built preview compares it
 * against the CURRENT `ContractVersionIdentity` (the same value Contract
 * Sent/Under Contract eligibility would be evaluated against) to detect
 * that the underlying facts have moved on since this preview was built.
 */
export function isContractDocumentPreviewStale(
  preview: ContractDocumentPreview,
  currentVersion: ContractVersionIdentity,
): boolean {
  return !isSameContractVersion(preview.version, currentVersion);
}
