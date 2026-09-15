/**
 * Contract -> GHL projection mapping -- INV-67 / B9-12 contract-population
 * repair, extended by the INV-67 checkbox-marker / broker-model repair,
 * further extended by the INV-67 compound text-destination repair (this
 * session).
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
 *      fields (`CONTRACT_PROJECTION_FIELD_KEYS` below -- 112 keys).
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
 * CHECKBOX-MARKER / BROKER-MODEL REPAIR supersedes item 8 of the original
 * header and RETIRES 19 of the original 48 keys -- GHL Checkbox elements
 * cannot bind to Opportunity custom values or conditional logic (Spock's
 * live GHL finding), so every checkbox-shaped TREC fact previously modeled
 * as one rendered-sentence key is retired and replaced by narrow `"X"`/`""`
 * marker keys (`contract-checkbox-marker-model.ts`), and
 * `representation.representation` (mis-cited to ¶8; the real destination is
 * TREC's page-11 broker blocks) is retired and replaced by the 22-key
 * broker text decomposition, gated by `classifyBrokerArrangement`
 * (`contract-broker-arrangement-model.ts`) -- intermediary arrangements
 * fail closed, never populated. See
 * `docs/INV67_CONTRACT_POPULATION_REPAIR_V1.md` for the full accounting.
 *
 * COMPOUND TEXT-DESTINATION REPAIR (this session, Jess Gate + Product Owner
 * rulings). Two of the original 29 retained document-line keys --
 * `earnestMoneyOption.additionalEarnestMoney` and
 * `closingPossession.closingDate` -- were found to project onto TREC
 * paragraphs (5(1) and 9A) that each print TWO physically separate blanks
 * with live printed language between them (`"...$ ___ to Escrow Agent
 * within ___ days"`, `"...on or before ___, 20 ___"`). No single merge-tag
 * overlay can populate either without omitting a sub-value or overlapping
 * printed language. A further, wider audit (per Jess's own instruction "do
 * not assume these two are the complete set") found two more deterministic
 * defect classes among the remaining retained keys: four keys whose
 * renderer unconditionally re-adds a `"$"` or `"day(s)"` the printed form
 * already supplies adjacent to the blank, and nine keys whose "none"
 * disposition rendered the invented sentence `"None (explicitly
 * confirmed)."` directly onto a printed blank. Product Owner ruling
 * (Option A): the two compound keys are RETIRED from template projection
 * (joining `CONTRACT_PROJECTION_RETIRED_KEYS`, 19 -> 21) and replaced by
 * four new, narrower, transport-only keys
 * (`CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS` below) that derive from the
 * SAME two canonical facts; the fourteen affected-but-not-compound keys
 * (thirteen format-only fixes plus `parties.sellerSigners`, narrowed to
 * names-only per Product Owner ruling 4) keep their existing dotted key and
 * GHL field but now project through `contract-ghl-transport-formatting.ts`
 * instead of the preview's verbatim prose. The human-facing Contract
 * Workspace preview (`contract-document-model.ts`) is UNCHANGED by any of
 * this -- see that module's own renderers, still in sole use there.
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
import type { SellerContractFactsReport, FieldDisposition } from "./contract-facts-model";
import {
  buildCheckboxMarkersAndText,
  CHECKBOX_MARKER_KEYS,
  CHECKBOX_TEXT_KEYS,
  BROKER_TEXT_KEYS,
} from "./contract-checkbox-marker-model";
import {
  valueOrNoneTransport,
  dollarValueOrNoneTransport,
  sellerSignersTransport,
  moneyTransport,
  daysTransport,
  additionalEarnestMoneyAmountTransport,
  additionalEarnestMoneyDaysTransport,
  closingDateMonthDayTransport,
  closingDateYearSuffixTransport,
  checkClosingDateCenturyBound,
} from "./contract-ghl-transport-formatting";

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
 * INV-67 checkbox-marker / broker-model repair, extended by the compound
 * text-destination repair. The 21 keys retired from the original 48 --
 * their dedicated GHL Test field stops receiving writes (kept, never
 * deleted, per the same INV-70 retirement precedent). Jess Gate correction
 * (repeated-destination re-gate, checkbox-marker repair) and Product Owner
 * ruling (compound text-destination repair): each of the 21 has a DISTINCT,
 * precise disposition -- six categories, not a loose split:
 *
 *   14 are checkbox-shaped and replaced by `CHECKBOX_MARKER_KEYS`/
 *      `CHECKBOX_TEXT_KEYS`: `leaseDisclosure.residentialLeases`,
 *      `leaseDisclosure.fixtureLeases`, `leaseDisclosure.
 *      naturalResourceLeases`, `titleSurvey.titlePolicyExpenseParty`,
 *      `titleSurvey.shortageAmendmentElection`, `titleSurvey.
 *      surveyElection`, `titleSurvey.poaMembership`, `propertyCondition.
 *      sellerDisclosureNotice`, `propertyCondition.asIsElection`,
 *      `propertyCondition.waterDisclosure`, `closingPossession.
 *      possessionElection`, `settlementExpense.sellerPaysBuyerBroker`,
 *      `settlementExpense.buyerPaysSellerBroker`, `addendaApplicability.
 *      items`.
 *    1 is checkbox-ADJACENT, not itself replaced by a new field:
 *      `propertyLegalDescription.reservations` FOLDS INTO / is reconciled
 *      against the existing `addenda_mineral_reservation_mark` (see
 *      `checkMineralReservationConsistency`) -- it shares that one
 *      checkbox rather than getting a dedicated field of its own, so this
 *      document's own former "Contract Legal Reservations" field is
 *      retired.
 *    1 is REPLACED by a differently-shaped projection, not dropped:
 *      `representation.representation` is superseded by the 22-key
 *      page-11 broker-text decomposition (`BROKER_TEXT_KEYS`), gated by
 *      `classifyBrokerArrangement`.
 *    1 is retained canonically but deliberately NOT projected into TREC
 *      20-19 in V1: `closingPossession.possessionDetails` stays a real,
 *      readable fact in `SellerContractFactsReport` -- it is scoped to a
 *      future addendum, per Brad's ruling, never given a GHL field here.
 *    2 are retained as internal/audit metadata, also not projected:
 *      `noticeContact.buyerSignerName`, `noticeContact.buyerSignerRole`
 *      are Board #10 scope, out of this repair.
 *    2 are RETIRED BY THE COMPOUND TEXT-DESTINATION REPAIR (this session,
 *      Product Owner ruling, Option A): `earnestMoneyOption.
 *      additionalEarnestMoney` and `closingPossession.closingDate` each
 *      project onto a TREC paragraph that prints two physically separate
 *      blanks divided by live printed language -- no single overlay can
 *      populate either truthfully. Replaced by four narrower transport-
 *      only keys (`CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS` below), each
 *      pair deriving from the SAME canonical fact the retired key used to
 *      project verbatim. Their existing GHL Test fields
 *      (`lx0NWWA8tgilbEY71n3b`, `s7jauYhoSPQd09GjoGOr`) remain physically
 *      present, unwritten and unplaced -- no audit-only writer was
 *      introduced (Option B was considered and explicitly declined).
 *
 *   14 + 1 + 1 + 1 + 2 + 2 = 21.
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
  "earnestMoneyOption.additionalEarnestMoney",
  "closingPossession.closingDate",
] as const;

/**
 * The 27 keys retained from the original 29 (2 retired by the compound
 * text-destination repair -- see `CONTRACT_PROJECTION_RETIRED_KEYS` above)
 * -- still sourced from `ContractDocumentPreview.documentLines` by default.
 * FOURTEEN of these 27 (`REFORMATTED_RETAINED_KEYS` below, in
 * `buildContractProjectionPlan`) no longer project the preview's verbatim
 * text -- they route through `contract-ghl-transport-formatting.ts`
 * instead, reading the same canonical `SellerContractFactsReport` fact the
 * preview line was built from. The remaining thirteen are genuinely
 * unaffected (no adjacent-printed-symbol risk, no "none" sentence
 * injection) and still project the preview's verbatim text exactly as
 * before.
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
  "titleSurvey.titleCompanyName",
  "titleSurvey.objectionsText",
  "titleSurvey.objectionsDays",
  "propertyCondition.serviceContractCap",
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
 * The four new keys introduced by the compound text-destination repair
 * (this session, Product Owner rulings 1-3), replacing the retired
 * `earnestMoneyOption.additionalEarnestMoney` / `closingPossession.
 * closingDate` template placements. TRANSPORT-ONLY NAMES, deliberately NOT
 * dotted like the retained document-line keys above (Product Owner ruling
 * 2) -- verified collision-free against every existing internal projection
 * key and every existing GHL field key in `shared/ghl-config.ts` before
 * approval. Each pair derives from exactly one canonical fact
 * (`AdditionalEarnestMoneyFact`, the `closingDate` ISO instant) so its two
 * sibling values can never disagree -- see `contract-ghl-transport-
 * formatting.ts`.
 */
export const CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS = [
  "additional_earnest_money_amount_text",
  "additional_earnest_money_days_text",
  "closing_date_month_day_text",
  "closing_date_year_suffix_text",
] as const;

/**
 * The complete, FINAL live projection-key set -- exactly 112: 27 retained
 * document-line keys + 4 new transport-only keys (above) + 48 checkbox
 * markers + 11 restructured contract-text keys + 22 page-11 broker-text
 * keys. This is the array `shared/ghl-config.ts` duplicates by hand (that
 * module cannot import from `src/lib`) and
 * `scripts/test-contract-ghl-projection.cjs`'s drift check compares
 * against.
 */
export const CONTRACT_PROJECTION_FIELD_KEYS = [
  ...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS,
  ...CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS,
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
 * Compound text-destination repair -- reads a `FieldDisposition<T>` DIRECTLY
 * (never via `preview.documentLines`) and applies a transport renderer.
 * `not_applicable` renders `""`, never invented prose -- the same doctrine
 * `contract-ghl-transport-formatting.ts`'s `valueOrNoneTransport` already
 * applies to an explicit "none" value, extended here to the coarser
 * `FieldDisposition` level so a field marked not-applicable never prints
 * onto the executed contract either. `unresolved` is an integrity
 * violation (this function is only ever called once `previewComplete` has
 * already gated every required field to `populated`/`not_applicable`) --
 * matches this module's own existing integrity-throw pattern below.
 */
function transportFieldText<T>(disposition: FieldDisposition<T>, key: string, render: (v: T) => string): string {
  if (disposition.kind === "populated") return render(disposition.value);
  if (disposition.kind === "not_applicable") return "";
  throw new Error(`buildContractProjectionPlan: "${key}" is unresolved despite previewComplete=true -- integrity violation.`);
}

/**
 * The fourteen retained keys (of 27) whose GHL transport value no longer
 * matches `contract-document-model.ts`'s preview-rendered text -- see
 * `contract-ghl-transport-formatting.ts`'s module header for why. The
 * remaining thirteen retained keys are unaffected and still project the
 * preview's verbatim text below.
 */
const REFORMATTED_RETAINED_KEYS = new Set<string>([
  "parties.sellerSigners",
  "propertyLegalDescription.lot",
  "propertyLegalDescription.block",
  "propertyLegalDescription.addition",
  "propertyLegalDescription.county",
  "propertyLegalDescription.exclusions",
  "earnestMoneyOption.earnestMoney",
  "earnestMoneyOption.optionFee",
  "earnestMoneyOption.optionPeriodDays",
  "titleSurvey.objectionsText",
  "titleSurvey.objectionsDays",
  "propertyCondition.serviceContractCap",
  "settlementExpense.sellerCreditCap",
  "addendaApplicability.districtNotices",
]);

/** Dispatches one of `REFORMATTED_RETAINED_KEYS` to its own transport renderer, reading the SAME canonical fact `contract-document-model.ts` built the preview line from -- never a second, independently-read carrier. */
function reformattedRetainedText(key: string, report: SellerContractFactsReport): string {
  switch (key) {
    case "parties.sellerSigners":
      return transportFieldText(report.parties.sellerSigners, key, sellerSignersTransport);
    case "propertyLegalDescription.lot":
      return transportFieldText(report.propertyLegalDescription.lot, key, valueOrNoneTransport);
    case "propertyLegalDescription.block":
      return transportFieldText(report.propertyLegalDescription.block, key, valueOrNoneTransport);
    case "propertyLegalDescription.addition":
      return transportFieldText(report.propertyLegalDescription.addition, key, valueOrNoneTransport);
    case "propertyLegalDescription.county":
      return transportFieldText(report.propertyLegalDescription.county, key, valueOrNoneTransport);
    case "propertyLegalDescription.exclusions":
      return transportFieldText(report.propertyLegalDescription.exclusions, key, valueOrNoneTransport);
    case "earnestMoneyOption.earnestMoney":
      return transportFieldText(report.earnestMoneyOption.earnestMoney, key, moneyTransport);
    case "earnestMoneyOption.optionFee":
      return transportFieldText(report.earnestMoneyOption.optionFee, key, moneyTransport);
    case "earnestMoneyOption.optionPeriodDays":
      return transportFieldText(report.earnestMoneyOption.optionPeriodDays, key, daysTransport);
    case "titleSurvey.objectionsText":
      return transportFieldText(report.titleSurvey.objectionsText, key, valueOrNoneTransport);
    case "titleSurvey.objectionsDays":
      return transportFieldText(report.titleSurvey.objectionsDays, key, daysTransport);
    case "propertyCondition.serviceContractCap":
      return transportFieldText(report.propertyCondition.serviceContractCap, key, dollarValueOrNoneTransport);
    case "settlementExpense.sellerCreditCap":
      return transportFieldText(report.settlementExpense.sellerCreditCap, key, dollarValueOrNoneTransport);
    case "addendaApplicability.districtNotices":
      return transportFieldText(report.addendaApplicability.districtNotices, key, valueOrNoneTransport);
    default:
      throw new Error(`buildContractProjectionPlan: reformattedRetainedText called with unrecognized key "${key}".`);
  }
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
    if (REFORMATTED_RETAINED_KEYS.has(key)) {
      return { key: key as ContractProjectionFieldKey, text: reformattedRetainedText(key, report) };
    }
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

  // Compound text-destination repair -- the closing-date century-bound gate
  // MUST run, and MUST block the whole plan on failure, BEFORE either
  // closing-date transport value below is derived. A malformed/unparseable
  // instant or a year outside 2000-2099 is a real data condition an
  // operator can produce (not a code-integrity violation), refused via
  // `blockingReasons` exactly like a mineral-reservation disagreement or a
  // blocking broker arrangement already is -- never a thrown exception.
  // This is the SAME gate `ContractWorkspace.tsx`'s sync handler checks
  // before it ever calls the GHL write or evaluates the Contract Draft
  // Request transition (`plan.ok === false` short-circuits both).
  const closingDateDisposition = report.closingPossession.closingDate;
  if (closingDateDisposition.kind === "populated") {
    const centuryCheck = checkClosingDateCenturyBound(closingDateDisposition.value);
    if (!centuryCheck.ok) {
      return { ok: false, blockingReasons: [centuryCheck.reason] };
    }
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

  // The four new transport-only entries -- each pair derived from ONE
  // canonical fact, never independently entered, so the two sibling values
  // can never disagree. Safe to compute here: the century-bound gate above
  // has already refused the whole plan if the closing-date instant were
  // malformed or out of range.
  const additionalEarnestMoneyDisposition = report.earnestMoneyOption.additionalEarnestMoney;
  const transportOnlyEntries: ContractProjectionEntry[] = [
    {
      key: "additional_earnest_money_amount_text" as ContractProjectionFieldKey,
      text: transportFieldText(
        additionalEarnestMoneyDisposition,
        "earnestMoneyOption.additionalEarnestMoney (amount)",
        additionalEarnestMoneyAmountTransport,
      ),
    },
    {
      key: "additional_earnest_money_days_text" as ContractProjectionFieldKey,
      text: transportFieldText(
        additionalEarnestMoneyDisposition,
        "earnestMoneyOption.additionalEarnestMoney (days)",
        additionalEarnestMoneyDaysTransport,
      ),
    },
    {
      key: "closing_date_month_day_text" as ContractProjectionFieldKey,
      text: transportFieldText(closingDateDisposition, "closingPossession.closingDate (month/day)", closingDateMonthDayTransport),
    },
    {
      key: "closing_date_year_suffix_text" as ContractProjectionFieldKey,
      text: transportFieldText(closingDateDisposition, "closingPossession.closingDate (year suffix)", closingDateYearSuffixTransport),
    },
  ];

  return {
    ok: true,
    opportunityId,
    agreementAt: preview.version.agreementAt,
    versionSeq: preview.version.versionSeq,
    entries: [...documentLineEntries, ...transportOnlyEntries, ...markerEntries, ...checkboxTextEntries, ...brokerTextEntries],
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
