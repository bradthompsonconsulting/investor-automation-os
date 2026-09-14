/**
 * Checkbox-marker derivation -- INV-67 checkbox-marker / broker-model
 * repair.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes. GHL Checkbox
 * elements cannot bind to Opportunity custom values or conditional logic
 * (Spock's live GHL finding, this session) -- the only mechanism GHL
 * offers for a checkbox-shaped TREC fact is a Text-block merge value
 * positioned over the printed box, whose entire legitimate content is
 * `"X"` or `""`. This module derives exactly that, for every checkbox-
 * shaped fact among the (former) 48 INV-67 projection keys, from the
 * SAME `SellerContractFactsReport` the human-facing preview
 * (`contract-document-model.ts`, UNCHANGED by this repair) already
 * consumes -- never re-derived from rendered prose, never a second
 * carrier read.
 *
 * MUTUAL EXCLUSIVITY is enforced twice, deliberately:
 *   1. BY CONSTRUCTION -- every derive function below is an exhaustive
 *      `switch`/chain of `===` comparisons over its canonical fact's own
 *      TS union, so it is not possible for the function itself to emit
 *      two `"X"` values in one exclusive group without a code defect.
 *   2. EXPLICITLY, by `validateMarkerExclusivity` -- a runtime check over
 *      the assembled marker set, required so the guarantee does not rest
 *      on construction alone (Jess Gate ruling, this session). Called
 *      from `buildCheckboxMarkersAndText` below, which is itself called
 *      from `contract-ghl-projection-model.ts`'s `buildContractProjectionPlan`
 *      -- the SAME gate that already blocks the whole sync on an
 *      unresolved fact, so a violation here blocks `Contract Draft
 *      Request` from ever reaching `Requested` exactly as strongly as
 *      every other blocking reason already does.
 *
 * INACTIVE CHILD MARKERS ALWAYS WRITE AN EXPLICIT `""`, never omitted --
 * every derive function below constructs every key in its group on every
 * call, so a re-sync after an election changes always clears the prior
 * mark rather than leaving it stale.
 */

import type { SellerContractFactsReport } from "./contract-facts-model";
import type {
  NaturalResourceLeaseFact,
  ShortageAmendmentElection,
  SurveyElection,
  ExpenseParty,
  SellerDisclosureNoticeFact,
  AsIsElectionFact,
  WaterDisclosureFact,
  BrokerageContribution,
  AddendaApplicabilityItems,
  RepresentationFact,
  BrokerInfo,
  ValueOrNone,
} from "./seller-contract-facts-carriers";
import { ADDENDA_APPLICABILITY_ITEM_KEYS } from "./seller-contract-facts-carriers";
import {
  classifyBrokerArrangement,
  isBrokerArrangementBlocking,
  brokerArrangementBlockingReason,
  type BrokerArrangementClassification,
} from "./contract-broker-arrangement-model";

export type MarkerValue = "X" | "";

/* ==================================================================== */
/* 1. The exact 48 marker keys and 11 contract-text keys                 */
/* ==================================================================== */

export const CHECKBOX_MARKER_KEYS = [
  "lease_residential_mark",
  "lease_fixture_mark",
  "lease_nrl_applies_mark",
  "lease_nrl_delivered_mark",
  "lease_nrl_not_delivered_mark",
  "title_expense_seller_mark",
  "title_expense_buyer_mark",
  "shortage_not_amended_mark",
  "shortage_amended_mark",
  "shortage_amended_buyer_mark",
  "shortage_amended_seller_mark",
  "survey_opt1_mark",
  "survey_opt2_mark",
  "survey_opt3_mark",
  "survey_opt1_expense_buyer_mark",
  "survey_opt1_expense_seller_mark",
  "poa_is_subject_mark",
  "poa_is_not_subject_mark",
  "sdn_received_mark",
  "sdn_not_received_mark",
  "sdn_not_required_mark",
  "as_is_plain_mark",
  "as_is_with_repairs_mark",
  "water_received_mark",
  "water_not_received_mark",
  "water_exempt_mark",
  "possession_upon_closing_mark",
  "possession_leaseback_mark",
  "spbb_applies_mark",
  "spbb_dollar_mark",
  "spbb_percent_mark",
  "bpsb_applies_mark",
  "bpsb_dollar_mark",
  "bpsb_percent_mark",
  "addenda_sale_of_other_property_mark",
  "addenda_lender_appraisal_termination_mark",
  "addenda_section_1031_exchange_mark",
  "addenda_short_sale_mark",
  "addenda_hydrostatic_testing_mark",
  "addenda_environmental_assessment_mark",
  "addenda_lead_based_paint_mark",
  "addenda_propane_gas_service_area_mark",
  "addenda_seaward_of_gulf_intracoastal_mark",
  "addenda_coastal_area_property_mark",
  "addenda_poa_membership_mark",
  "addenda_non_realty_items_mark",
  "addenda_back_up_contract_mark",
  "addenda_mineral_reservation_mark",
] as const;
export type CheckboxMarkerKey = (typeof CHECKBOX_MARKER_KEYS)[number];

export const CHECKBOX_TEXT_KEYS = [
  "lease_nrl_terminate_within_days_text",
  "survey_opt1_seller_furnish_days_text",
  "survey_opt2_buyer_obtain_days_text",
  "survey_opt3_seller_furnish_days_text",
  "sdn_deliver_within_days_text",
  "water_deliver_within_days_text",
  "water_source_text",
  "spbb_dollar_amount_text",
  "spbb_percent_amount_text",
  "bpsb_dollar_amount_text",
  "bpsb_percent_amount_text",
] as const;
export type CheckboxTextKey = (typeof CHECKBOX_TEXT_KEYS)[number];

/** Page-11 broker fields, per side -- exactly the 11 printed destinations, no invented city/state/zip. */
export const BROKER_FIELD_SUFFIXES = [
  "firm_name",
  "address",
  "firm_license_no",
  "associate_name",
  "team_name",
  "associate_email",
  "associate_phone",
  "associate_license_no",
  "supervisor_name",
  "supervisor_phone",
  "supervisor_license_no",
] as const;

export const BROKER_TEXT_KEYS = [
  ...BROKER_FIELD_SUFFIXES.map((s) => `seller_broker_${s}_text` as const),
  ...BROKER_FIELD_SUFFIXES.map((s) => `buyer_broker_${s}_text` as const),
] as const;
export type BrokerTextKey = (typeof BROKER_TEXT_KEYS)[number];

/* ==================================================================== */
/* 1b. Repeated printed destinations -- Jess Gate correction              */
/* ==================================================================== */

/**
 * TREC 20-19's own paragraph 22 "Addenda, Notices, and Other Provisions"
 * checklist DUPLICATES three elections already asked once elsewhere on the
 * form, rather than posing a new question:
 *
 *   - Paragraph 4A's residential-leases election is echoed by paragraph
 *     22's "Addendum Regarding Residential Leases" checkbox.
 *   - Paragraph 4B's fixture-leases election is echoed by paragraph 22's
 *     "Addendum Regarding Fixture Leases" checkbox.
 *   - Paragraph 10A's temporary-lease possession election (rendered
 *     "According to a temporary residential lease" -- `contract-document-
 *     model.ts`) is echoed by paragraph 22's "Seller's Temporary
 *     Residential Lease" checkbox. Confirmed non-ambiguous: TREC's own
 *     promulgated addendum set implements paragraph 10A's second option
 *     with exactly one form, the Seller's Temporary Residential Lease --
 *     under which Seller retains possession after closing under a
 *     temporary lease from Buyer. There is no second, differently-meaning
 *     "leaseback" scenario this carrier's `"leaseback"` kind could
 *     ambiguously refer to.
 *
 * GHL's Text-block merge mechanism supports positioning the SAME
 * Opportunity custom field at more than one location on one template --
 * this is a PLACEMENT manifest only. It changes nothing about which key is
 * written or what value it carries, and introduces NO new field: reusing
 * `lease_residential_mark`, `lease_fixture_mark`, and
 * `possession_leaseback_mark` at their second paragraph-22 destination
 * keeps `CHECKBOX_MARKER_KEYS` at exactly 48 unique keys. Every marker NOT
 * listed here is placed at exactly one printed destination -- absence from
 * this manifest means "single placement," never "unplaced."
 */
export type MarkerTemplateDestination = { paragraph: string; description: string };

export const CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS: Readonly<Partial<Record<CheckboxMarkerKey, readonly MarkerTemplateDestination[]>>> = {
  lease_residential_mark: [
    { paragraph: "4A", description: "Residential leases election" },
    { paragraph: "22", description: 'Addendum Regarding Residential Leases checkbox' },
  ],
  lease_fixture_mark: [
    { paragraph: "4B", description: "Fixture leases election" },
    { paragraph: "22", description: 'Addendum Regarding Fixture Leases checkbox' },
  ],
  possession_leaseback_mark: [
    { paragraph: "10A", description: "Temporary-lease possession election" },
    { paragraph: "22", description: "Seller's Temporary Residential Lease checkbox" },
  ],
};

/**
 * The number of PHYSICAL checkbox overlay placements the 48 unique markers
 * require across the whole template -- distinct from `CHECKBOX_MARKER_KEYS
 * .length` (48 unique fields). Each entry in `CHECKBOX_MARKER_REPEATED_
 * TEMPLATE_PLACEMENTS` adds `(destinations.length - 1)` EXTRA placements
 * beyond the one every marker already gets. Used by the future GHL
 * template-placement proof plan so the overlay-placement count is never
 * mistaken for the new-field count.
 */
export const CHECKBOX_MARKER_TOTAL_TEMPLATE_PLACEMENTS: number =
  CHECKBOX_MARKER_KEYS.length +
  Object.values(CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS).reduce(
    (sum, destinations) => sum + ((destinations as readonly MarkerTemplateDestination[]).length - 1),
    0,
  );

/* ==================================================================== */
/* 2. Per-group derive functions -- exhaustive over each fact's own union */
/* ==================================================================== */

export function deriveLeaseMarkers(
  residentialLeases: "none" | "applies",
  fixtureLeases: "none" | "applies",
  naturalResourceLeases: NaturalResourceLeaseFact,
): { markers: Record<string, MarkerValue>; text: Record<string, string> } {
  const markers: Record<string, MarkerValue> = {
    lease_residential_mark: residentialLeases === "applies" ? "X" : "",
    lease_fixture_mark: fixtureLeases === "applies" ? "X" : "",
    lease_nrl_applies_mark: naturalResourceLeases.kind !== "none" ? "X" : "",
    lease_nrl_delivered_mark: naturalResourceLeases.kind === "delivered" ? "X" : "",
    lease_nrl_not_delivered_mark: naturalResourceLeases.kind === "not_yet_delivered" ? "X" : "",
  };
  const text: Record<string, string> = {
    lease_nrl_terminate_within_days_text:
      naturalResourceLeases.kind === "not_yet_delivered" ? String(naturalResourceLeases.terminateWithinDays) : "",
  };
  return { markers, text };
}

export function deriveTitleExpenseMarkers(v: ExpenseParty): Record<string, MarkerValue> {
  return {
    title_expense_seller_mark: v === "seller" ? "X" : "",
    title_expense_buyer_mark: v === "buyer" ? "X" : "",
  };
}

export function deriveShortageMarkers(v: ShortageAmendmentElection): Record<string, MarkerValue> {
  return {
    shortage_not_amended_mark: v.kind === "not_amended" ? "X" : "",
    shortage_amended_mark: v.kind === "amended" ? "X" : "",
    shortage_amended_buyer_mark: v.kind === "amended" && v.expenseParty === "buyer" ? "X" : "",
    shortage_amended_seller_mark: v.kind === "amended" && v.expenseParty === "seller" ? "X" : "",
  };
}

export function deriveSurveyMarkers(v: SurveyElection): { markers: Record<string, MarkerValue>; text: Record<string, string> } {
  const markers: Record<string, MarkerValue> = {
    survey_opt1_mark: v.option === "seller_existing_survey" ? "X" : "",
    survey_opt2_mark: v.option === "buyer_new_survey" ? "X" : "",
    survey_opt3_mark: v.option === "seller_new_survey" ? "X" : "",
    survey_opt1_expense_buyer_mark: v.option === "seller_existing_survey" && v.ifRejectedExpenseParty === "buyer" ? "X" : "",
    survey_opt1_expense_seller_mark: v.option === "seller_existing_survey" && v.ifRejectedExpenseParty === "seller" ? "X" : "",
  };
  const text: Record<string, string> = {
    survey_opt1_seller_furnish_days_text: v.option === "seller_existing_survey" ? String(v.sellerFurnishDays) : "",
    survey_opt2_buyer_obtain_days_text: v.option === "buyer_new_survey" ? String(v.buyerObtainDays) : "",
    survey_opt3_seller_furnish_days_text: v.option === "seller_new_survey" ? String(v.sellerFurnishDays) : "",
  };
  return { markers, text };
}

export function derivePoaMarkers(v: "is_subject" | "is_not_subject"): Record<string, MarkerValue> {
  return {
    poa_is_subject_mark: v === "is_subject" ? "X" : "",
    poa_is_not_subject_mark: v === "is_not_subject" ? "X" : "",
  };
}

export function deriveSellerDisclosureNoticeMarkers(
  v: SellerDisclosureNoticeFact,
): { markers: Record<string, MarkerValue>; text: Record<string, string> } {
  const markers: Record<string, MarkerValue> = {
    sdn_received_mark: v.kind === "received" ? "X" : "",
    sdn_not_received_mark: v.kind === "not_yet_received" ? "X" : "",
    sdn_not_required_mark: v.kind === "not_required" ? "X" : "",
  };
  const text: Record<string, string> = {
    sdn_deliver_within_days_text: v.kind === "not_yet_received" ? String(v.deliverWithinDays) : "",
  };
  return { markers, text };
}

export function deriveAsIsMarkers(v: AsIsElectionFact): Record<string, MarkerValue> {
  return {
    as_is_plain_mark: v.kind === "as_is" ? "X" : "",
    as_is_with_repairs_mark: v.kind === "as_is_with_repairs" ? "X" : "",
  };
}

export function deriveWaterDisclosureMarkers(
  v: WaterDisclosureFact,
): { markers: Record<string, MarkerValue>; text: Record<string, string> } {
  const markers: Record<string, MarkerValue> = {
    water_received_mark: v.kind === "received" ? "X" : "",
    water_not_received_mark: v.kind === "not_yet_received" ? "X" : "",
    water_exempt_mark: v.kind === "exempt" ? "X" : "",
  };
  const text: Record<string, string> = {
    water_deliver_within_days_text: v.kind === "not_yet_received" ? String(v.deliverWithinDays) : "",
    water_source_text: v.kind === "exempt" ? v.waterSource : "",
  };
  return { markers, text };
}

export function derivePossessionMarkers(v: "upon_closing_and_funding" | "leaseback"): Record<string, MarkerValue> {
  return {
    possession_upon_closing_mark: v === "upon_closing_and_funding" ? "X" : "",
    possession_leaseback_mark: v === "leaseback" ? "X" : "",
  };
}

export function deriveBrokerageContributionMarkers(
  prefix: "spbb" | "bpsb",
  v: BrokerageContribution,
): { markers: Record<string, MarkerValue>; text: Record<string, string> } {
  const markers: Record<string, MarkerValue> = {
    [`${prefix}_applies_mark`]: v.kind !== "none" ? "X" : "",
    [`${prefix}_dollar_mark`]: v.kind === "dollar" ? "X" : "",
    [`${prefix}_percent_mark`]: v.kind === "percent" ? "X" : "",
  };
  const text: Record<string, string> = {
    [`${prefix}_dollar_amount_text`]: v.kind === "dollar" ? String(v.amount) : "",
    [`${prefix}_percent_amount_text`]: v.kind === "percent" ? String(v.percent) : "",
  };
  return { markers, text };
}

export function deriveAddendaMarkers(items: AddendaApplicabilityItems): Record<string, MarkerValue> {
  const markers: Record<string, MarkerValue> = {};
  for (const key of ADDENDA_APPLICABILITY_ITEM_KEYS) {
    markers[`addenda_${key}_mark`] = items[key] ? "X" : "";
  }
  return markers;
}

/* ==================================================================== */
/* 3. Mineral-reservation / POA-addenda consistency                      */
/* ==================================================================== */

/** ¶2E vs. ¶22's mineral-reservation addendum checkbox share ONE physical box -- fail closed with its own distinct message on disagreement (Product Owner ruling, this session). */
export function checkMineralReservationConsistency(
  reservationsApplies: boolean,
  mineralReservationAddendaChecked: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (reservationsApplies === mineralReservationAddendaChecked) return { ok: true };
  return {
    ok: false,
    reason:
      `Mineral-reservation disagreement: the ¶2E reservations disposition (${reservationsApplies ? "applies" : "none"}) ` +
      `does not match the ¶22 "Addendum for Reservation of Oil, Gas, and Other Minerals" checkbox ` +
      `(${mineralReservationAddendaChecked ? "checked" : "unchecked"}). Refusing to sync until these agree.`,
  };
}

/** ¶6E(2) POA membership vs. ¶22's POA addendum checkbox -- operator warning only, never a blocker (Product Owner ruling, this session). */
export function checkPoaAddendaConsistency(
  poaMembership: "is_subject" | "is_not_subject",
  poaAddendaChecked: boolean,
): string | null {
  const expectChecked = poaMembership === "is_subject";
  if (expectChecked === poaAddendaChecked) return null;
  return (
    `POA membership (¶6E(2): ${poaMembership}) and the ¶22 "Addendum for Property Subject to Mandatory Membership ` +
    `in a Property Owners Association" checkbox (${poaAddendaChecked ? "checked" : "unchecked"}) disagree -- ` +
    `operator review recommended; this does not block the sync.`
  );
}

/* ==================================================================== */
/* 4. Marker mutual-exclusivity -- explicit runtime check (Jess Gate)     */
/* ==================================================================== */

type MarkerExclusivityGroup = { name: string; keys: readonly string[] };

const EXCLUSIVITY_GROUPS: MarkerExclusivityGroup[] = [
  { name: "lease_nrl_delivery", keys: ["lease_nrl_delivered_mark", "lease_nrl_not_delivered_mark"] },
  { name: "title_expense_party", keys: ["title_expense_seller_mark", "title_expense_buyer_mark"] },
  { name: "shortage_election", keys: ["shortage_not_amended_mark", "shortage_amended_mark"] },
  { name: "shortage_amended_expense", keys: ["shortage_amended_buyer_mark", "shortage_amended_seller_mark"] },
  { name: "survey_option", keys: ["survey_opt1_mark", "survey_opt2_mark", "survey_opt3_mark"] },
  { name: "survey_opt1_expense", keys: ["survey_opt1_expense_buyer_mark", "survey_opt1_expense_seller_mark"] },
  { name: "poa_membership", keys: ["poa_is_subject_mark", "poa_is_not_subject_mark"] },
  { name: "seller_disclosure_notice", keys: ["sdn_received_mark", "sdn_not_received_mark", "sdn_not_required_mark"] },
  { name: "as_is_election", keys: ["as_is_plain_mark", "as_is_with_repairs_mark"] },
  { name: "water_disclosure", keys: ["water_received_mark", "water_not_received_mark", "water_exempt_mark"] },
  { name: "possession_election", keys: ["possession_upon_closing_mark", "possession_leaseback_mark"] },
  { name: "spbb_method", keys: ["spbb_dollar_mark", "spbb_percent_mark"] },
  { name: "bpsb_method", keys: ["bpsb_dollar_mark", "bpsb_percent_mark"] },
];

/**
 * Runtime, explicit, in addition to the by-construction guarantee every
 * derive function above already provides (Jess Gate ruling, this
 * session). Called from `buildCheckboxMarkersAndText`, which is called
 * from `buildContractProjectionPlan` -- the plan-level gate, so a
 * violation here blocks the WHOLE sync before any GHL call, exactly like
 * every other blocking reason.
 */
export function validateMarkerExclusivity(markers: Record<string, MarkerValue>): { ok: true } | { ok: false; violations: string[] } {
  const violations: string[] = [];
  for (const group of EXCLUSIVITY_GROUPS) {
    const xCount = group.keys.filter((k) => markers[k] === "X").length;
    if (xCount > 1) {
      violations.push(`Marker group "${group.name}" has ${xCount} values marked "X" -- at most one is allowed (${group.keys.join(", ")}).`);
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/* ==================================================================== */
/* 5. Page-11 broker text -- gated by arrangement classification         */
/* ==================================================================== */

function valueOrNoneToText(v: ValueOrNone): string {
  return v.kind === "value" ? v.value : "";
}

function brokerInfoToText(prefix: "seller_broker" | "buyer_broker", info: BrokerInfo): Record<string, string> {
  return {
    [`${prefix}_firm_name_text`]: info.firmName,
    [`${prefix}_address_text`]: valueOrNoneToText(info.address),
    [`${prefix}_firm_license_no_text`]: info.licenseNo,
    [`${prefix}_associate_name_text`]: info.associateName,
    [`${prefix}_team_name_text`]: valueOrNoneToText(info.teamName),
    [`${prefix}_associate_email_text`]: info.email,
    [`${prefix}_associate_phone_text`]: info.phone,
    [`${prefix}_associate_license_no_text`]: info.associateLicenseNo,
    [`${prefix}_supervisor_name_text`]: valueOrNoneToText(info.supervisorName),
    [`${prefix}_supervisor_phone_text`]: valueOrNoneToText(info.supervisorPhone),
    [`${prefix}_supervisor_license_no_text`]: valueOrNoneToText(info.supervisorLicenseNo),
  };
}

/**
 * Builds all 22 broker text values. Caller (`buildCheckboxMarkersAndText`)
 * guarantees this is never called for a blocking classification
 * (`intermediary` / `represented_but_empty`) -- those refuse the whole
 * sync before this function is ever reached. `no_broker`, and the absent
 * side of `seller_broker_only`/`buyer_broker_only`, resolve to all-blank
 * for that side via the same initial loop every call performs -- never
 * partially populated, never invented.
 */
export function deriveBrokerText(classification: BrokerArrangementClassification, fact: RepresentationFact): Record<string, string> {
  const text: Record<string, string> = {};
  for (const suffix of BROKER_FIELD_SUFFIXES) {
    text[`seller_broker_${suffix}_text`] = "";
    text[`buyer_broker_${suffix}_text`] = "";
  }
  if (fact.kind !== "represented") return text;
  if ((classification === "seller_broker_only" || classification === "separate_brokers_both_sides") && fact.sellerAgent) {
    Object.assign(text, brokerInfoToText("seller_broker", fact.sellerAgent));
  }
  if ((classification === "buyer_broker_only" || classification === "separate_brokers_both_sides") && fact.buyerAgent) {
    Object.assign(text, brokerInfoToText("buyer_broker", fact.buyerAgent));
  }
  return text;
}

/* ==================================================================== */
/* 6. The master build function                                          */
/* ==================================================================== */

export type CheckboxMarkerBuildResult =
  | { ok: true; markers: Record<CheckboxMarkerKey, MarkerValue>; text: Record<CheckboxTextKey, string>; brokerText: Record<BrokerTextKey, string>; warnings: string[] }
  | { ok: false; blockingReasons: string[] };

/**
 * The ONE entry point `contract-ghl-projection-model.ts`'s
 * `buildContractProjectionPlan` calls. Every input disposition is assumed
 * `populated` -- the caller's own `previewComplete` gate already refuses
 * the whole plan on any unresolved fact before this function is ever
 * reached; a `disposition.kind !== "populated"` here is an integrity
 * violation, not a normal refusal path, and throws rather than silently
 * treating it as absent (matching this codebase's established pattern in
 * `buildContractProjectionPlan` itself).
 */
export function buildCheckboxMarkersAndText(report: SellerContractFactsReport): CheckboxMarkerBuildResult {
  function populatedValue<T>(disposition: { kind: string; value?: T }, label: string): T {
    if (disposition.kind !== "populated") {
      throw new Error(`buildCheckboxMarkersAndText: "${label}" is not populated despite the caller's previewComplete gate -- integrity violation.`);
    }
    return disposition.value as T;
  }

  const residentialLeases = populatedValue(report.leaseDisclosure.residentialLeases, "leaseDisclosure.residentialLeases");
  const fixtureLeases = populatedValue(report.leaseDisclosure.fixtureLeases, "leaseDisclosure.fixtureLeases");
  const naturalResourceLeases = populatedValue(report.leaseDisclosure.naturalResourceLeases, "leaseDisclosure.naturalResourceLeases");
  const titleExpenseParty = populatedValue(report.titleSurvey.titlePolicyExpenseParty, "titleSurvey.titlePolicyExpenseParty");
  const shortageAmendmentElection = populatedValue(report.titleSurvey.shortageAmendmentElection, "titleSurvey.shortageAmendmentElection");
  const surveyElection = populatedValue(report.titleSurvey.surveyElection, "titleSurvey.surveyElection");
  const poaMembership = populatedValue(report.titleSurvey.poaMembership, "titleSurvey.poaMembership");
  const sellerDisclosureNotice = populatedValue(report.propertyCondition.sellerDisclosureNotice, "propertyCondition.sellerDisclosureNotice");
  const asIsElection = populatedValue(report.propertyCondition.asIsElection, "propertyCondition.asIsElection");
  const waterDisclosure = populatedValue(report.propertyCondition.waterDisclosure, "propertyCondition.waterDisclosure");
  const possessionElection = populatedValue(report.closingPossession.possessionElection, "closingPossession.possessionElection");
  const sellerPaysBuyerBroker = populatedValue(report.settlementExpense.sellerPaysBuyerBroker, "settlementExpense.sellerPaysBuyerBroker");
  const buyerPaysSellerBroker = populatedValue(report.settlementExpense.buyerPaysSellerBroker, "settlementExpense.buyerPaysSellerBroker");
  const addendaItems = populatedValue(report.addendaApplicability.items, "addendaApplicability.items");
  const representationFact = populatedValue(report.representation.representation, "representation.representation");
  const reservations = populatedValue(report.propertyLegalDescription.reservations, "propertyLegalDescription.reservations");

  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  // Broker arrangement -- checked BEFORE deriving any broker text.
  const classification = classifyBrokerArrangement(representationFact);
  if (isBrokerArrangementBlocking(classification)) {
    const reason = brokerArrangementBlockingReason(classification);
    if (reason) blockingReasons.push(reason);
  }

  const leaseResult = deriveLeaseMarkers(residentialLeases, fixtureLeases, naturalResourceLeases);
  const titleExpenseMarkers = deriveTitleExpenseMarkers(titleExpenseParty);
  const shortageMarkers = deriveShortageMarkers(shortageAmendmentElection);
  const surveyResult = deriveSurveyMarkers(surveyElection);
  const poaMarkers = derivePoaMarkers(poaMembership);
  const sdnResult = deriveSellerDisclosureNoticeMarkers(sellerDisclosureNotice);
  const asIsMarkers = deriveAsIsMarkers(asIsElection);
  const waterResult = deriveWaterDisclosureMarkers(waterDisclosure);
  const possessionMarkers = derivePossessionMarkers(possessionElection);
  const spbbResult = deriveBrokerageContributionMarkers("spbb", sellerPaysBuyerBroker);
  const bpsbResult = deriveBrokerageContributionMarkers("bpsb", buyerPaysSellerBroker);
  const addendaMarkers = deriveAddendaMarkers(addendaItems);

  const markers: Record<string, MarkerValue> = {
    ...leaseResult.markers,
    ...titleExpenseMarkers,
    ...shortageMarkers,
    ...surveyResult.markers,
    ...poaMarkers,
    ...sdnResult.markers,
    ...asIsMarkers,
    ...waterResult.markers,
    ...possessionMarkers,
    ...spbbResult.markers,
    ...bpsbResult.markers,
    ...addendaMarkers,
  };
  const text: Record<string, string> = {
    ...leaseResult.text,
    ...surveyResult.text,
    ...sdnResult.text,
    ...waterResult.text,
    ...spbbResult.text,
    ...bpsbResult.text,
  };

  // Mineral-reservation disagreement -- fail closed, distinct message.
  const mineralConsistency = checkMineralReservationConsistency(
    reservations.kind !== "none",
    addendaItems.mineral_reservation,
  );
  if (!mineralConsistency.ok) blockingReasons.push(mineralConsistency.reason);

  // POA membership vs. POA addendum -- warning only, never blocks.
  const poaWarning = checkPoaAddendaConsistency(poaMembership, addendaItems.poa_membership);
  if (poaWarning) warnings.push(poaWarning);

  // Marker mutual exclusivity -- explicit runtime check (Jess Gate ruling).
  const exclusivity = validateMarkerExclusivity(markers);
  if (!exclusivity.ok) blockingReasons.push(...exclusivity.violations);

  if (blockingReasons.length > 0) {
    return { ok: false, blockingReasons };
  }

  const brokerText = deriveBrokerText(classification, representationFact);

  return {
    ok: true,
    markers: markers as Record<CheckboxMarkerKey, MarkerValue>,
    text: text as Record<CheckboxTextKey, string>,
    brokerText: brokerText as Record<BrokerTextKey, string>,
    warnings,
  };
}
