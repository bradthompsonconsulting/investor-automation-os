/**
 * Underwriting resolver -- implementation.
 *
 * Pure. No fetching, no I/O, no React, no writes. Data arrives already
 * fetched; this module parses wire representations and resolves PB-D56's
 * three-level hierarchy into the calculation core's UnderwritingInputs.
 *
 * Boundary: a parser parses ONE object's wire shape. Deciding which
 * object's value wins is a resolver's job.
 */

import type {
  AssignmentResolution,
  Financing,
  Level,
  Resolved,
  DealInput,
  UnderwritingInputs,
} from "./types";
import { MODE_BY_OPTION } from "./resolver-types";
import type {
  AssignmentModeName,
  ContactSeedFacts,
  ContactSeedIds,
  CustomValueIds,
  DealFacts,
  DealOverrides,
  OpportunityFactIds,
  OpportunityUnderwritingValues,
  ParsedPolicy,
  ParsePolicyResult,
  PolicyParseIssue,
  PolicyResolved,
  PolicyValue,
  RawField,
} from "./resolver-types";
import { IAOS_STARTERS } from "./starters";

/* ------------------------------------------------------------------ */
/* Wire-value readers -- strict by expected dataType                   */
/* ------------------------------------------------------------------ */

/**
 * Reads a NUMERICAL opportunity field at the key its dataType dictates.
 * MaoCalculator's cfRaw coalesces across every possible key; that
 * permissiveness is deliberately not inherited. A field arriving in an
 * unexpected representation is unresolved, not coerced.
 */
function readNumberField(fields: RawField[], id: string): number | null {
  const f = fields.find((x) => x.id === id);
  if (!f) return null;
  // Strict about WHICH key is read -- fieldValueNumber only, never
  // coalescing across representations the way MaoCalculator's cfRaw does.
  // Not strict about the JS type AT that key: a numeric string there is
  // the same value. Rejecting it would make the field read as absent, fire
  // the contact seed path, and compute the deal from seed data while the
  // Opportunity held a figure -- a wrong number with wrong provenance,
  // which is worse than a coercion.
  const raw = f.fieldValueNumber;
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const n = typeof raw === "number" ? raw : Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/* readNumberField ABOVE AND readStringField BELOW PARSE THE OPPORTUNITY
   LIST SHAPE, and only that. readContactNumber further below parses the
   contact model's {id, value} and is a separate concern.

   OBSERVED 2026-08-17 across PB-D58 and PB-D59 Proofs A and B: the
   `ghl-opportunities` list endpoint returns NUMERICAL under
   `fieldValueNumber` and SINGLE_OPTIONS under `fieldValueString`, each
   with a `type` key. The SINGULAR `GET /opportunities/{id}` returns every
   dataType under `fieldValue` with no `type`.

   These readers are correct for the list shape the Underwriting Workspace
   consumes through `listPipeline`, and must stay that way. Against the
   singular shape both return null -- which would read as every field
   absent rather than as an error. If you are parsing a singular GET, the
   parser you want is `readSingularFieldValue` in `app/src/lib/ghl.ts`,
   private to the Approve write path. PB-D59 section III. */

/** Reads a SINGLE_OPTIONS opportunity field at its expected key. */
function readStringField(fields: RawField[], id: string): string | null {
  const f = fields.find((x) => x.id === id);
  if (!f) return null;
  const raw = f.fieldValueString ?? f.value;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

/** Reads a contact custom field. The contact model uses {id, value}. */
function readContactNumber(fields: RawField[], id: string): number | null {
  const f = fields.find((x) => x.id === id);
  if (!f) return null;
  const raw = f.value;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* parsePolicy -- Custom Values in, core-native policy out             */
/* ------------------------------------------------------------------ */

/**
 * OBSERVED representation of Purchase Financing Enabled when on: "On".
 * OFF representation: UNKNOWN -- do not infer. An unrecognized value is
 * unresolved, never false. PB-D56 section III: a missing assumption never
 * becomes an assumption of no cost, and Off is the most dangerous default
 * in the model because it legitimately zeroes an entire deduction.
 */
const FINANCING_ON = "On";

const PCT_KEYS = new Set<keyof ParsedPolicy>([
  "sellingCostPct",
  "buyerProfitPct",
  "financingLtv",
  "financingRate",
  "financingPoints",
  "profitSharePct",
]);

function unresolved(reason: string): { kind: "unresolved"; reason: string } {
  return { kind: "unresolved", reason };
}

function policyValue<T>(value: T): PolicyResolved<T> {
  return { kind: "value", value, level: "investor_policy" };
}

/**
 * Parses the eleven investor-policy Custom Values.
 *
 * Owns unit conversion: GHL stores percentages in human units ("10" for
 * 10%) and this is the last place that representation exists. Everything
 * downstream sees decimal fractions only.
 *
 * Returns issues alongside the policy rather than throwing, because one
 * malformed value must not prevent the other ten from resolving. An absent
 * Custom Value is unresolved WITHOUT an issue -- absence means the level
 * below supplies it. A malformed one is unresolved WITH an issue, because
 * someone put something in GHL that cannot be read.
 */
export function parsePolicy(
  values: PolicyValue[],
  ids: CustomValueIds,
): ParsePolicyResult {
  const issues: PolicyParseIssue[] = [];
  const byId = new Map(values.map((v) => [v.id, v.value]));

  function num(key: keyof ParsedPolicy): PolicyResolved<number> {
    const id = ids[key];
    const raw = byId.get(id);
    if (raw === undefined) return unresolved("absent from investor policy");
    const trimmed = raw.trim();
    if (trimmed === "") return unresolved("absent from investor policy");
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      issues.push({ key, id, raw, reason: "not a finite number" });
      return unresolved("malformed investor policy value");
    }
    if (PCT_KEYS.has(key)) {
      const asFraction = parsed / 100;
      if (asFraction < 0 || asFraction > 1) {
        issues.push({ key, id, raw, reason: "percentage outside 0-100" });
        return unresolved("malformed investor policy value");
      }
      return policyValue(asFraction);
    }
    return policyValue(parsed);
  }

  function financing(): PolicyResolved<boolean> {
    const id = ids.financingEnabled;
    const raw = byId.get(id);
    if (raw === undefined || raw.trim() === "") {
      return unresolved("absent from investor policy");
    }
    if (raw.trim() === FINANCING_ON) return policyValue(true);
    issues.push({
      key: "financingEnabled",
      id,
      raw,
      reason: "unrecognized financing switch value; only On is observed",
    });
    return unresolved("unrecognized financing switch value");
  }

  const policy: ParsedPolicy = {
    sellingCostPct: num("sellingCostPct"),
    closingCost: num("closingCost"),
    monthlyCarry: num("monthlyCarry"),
    holdMonths: num("holdMonths"),
    buyerProfitPct: num("buyerProfitPct"),
    financingEnabled: financing(),
    financingLtv: num("financingLtv"),
    financingRate: num("financingRate"),
    financingPoints: num("financingPoints"),
    standardMinimum: num("standardMinimum"),
    profitSharePct: num("profitSharePct"),
  };

  return { policy, issues };
}

/* ------------------------------------------------------------------ */
/* Opportunity and contact parsers                                     */
/* ------------------------------------------------------------------ */

/* MODE_BY_OPTION moved to resolver-types.ts 2026-08-17 and is imported
   above. It was private here and correct while parsing was the only
   direction these labels travelled; PB-D59's Approve write needs the
   inverse, and two copies of the same three strings would be two sources
   of truth for a value crossing the wire both ways. Declared once there,
   derived both ways. */

/**
 * Parses underwriting values from the Opportunity. Authoritative under
 * PB-D55 when present. An unrecognized mode string is unresolved rather
 * than defaulted, because mode determines which calculation governs.
 */
export function parseOpportunityValues(
  fields: RawField[],
  ids: OpportunityFactIds,
): OpportunityUnderwritingValues {
  const arvRaw = readNumberField(fields, ids.arv);
  const repairsRaw = readNumberField(fields, ids.repairs);
  const modeRaw = readStringField(fields, ids.assignmentMode);

  let assignmentMode: Resolved<AssignmentModeName>;
  if (modeRaw === null) {
    assignmentMode = unresolved("assignment mode is not set on the opportunity");
  } else if (MODE_BY_OPTION[modeRaw] === undefined) {
    assignmentMode = unresolved(`unrecognized assignment mode: ${modeRaw}`);
  } else {
    assignmentMode = {
      kind: "value",
      value: MODE_BY_OPTION[modeRaw],
      level: "deal_override",
    };
  }

  return {
    arv:
      arvRaw === null
        ? unresolved("absent on the opportunity")
        : { kind: "value", value: arvRaw },
    repairs:
      repairsRaw === null
        ? unresolved("absent on the opportunity")
        : { kind: "value", value: repairsRaw },
    askingPrice: readNumberField(fields, ids.askingPrice),
    assignmentMode,
    // CARRIER GAP: no GHL field holds the manual spread amount. Always
    // null from the wire until a carrier is decided.
    manualSpread: null,
  };
}

/** Parses seed values from the Contact. Absence here is unremarkable. */
export function parseContactSeeds(
  fields: RawField[],
  ids: ContactSeedIds,
): ContactSeedFacts {
  return {
    arv: readContactNumber(fields, ids.arv),
    repairs: readContactNumber(fields, ids.repairs),
    askingPrice: readContactNumber(fields, ids.askingPrice),
  };
}

/**
 * Deal overrides of investor policy, sourced from the Opportunity.
 *
 * CURRENT PRODUCTION STATE: PB-D56 section VI creates override fields on
 * first real need and none exists, so every member is unresolved. The
 * function exists because the hierarchy is already decided; when the first
 * carrier appears it gains a body rather than a caller.
 */
export function parseDealOverrides(_fields: RawField[]): DealOverrides {
  const none = unresolved("no deal-override carrier exists");
  return {
    sellingCostPct: none,
    closingCost: none,
    monthlyCarry: none,
    holdMonths: none,
    buyerProfitPct: none,
    financingEnabled: none,
    financingLtv: none,
    financingRate: none,
    financingPoints: none,
    standardMinimum: none,
    profitSharePct: none,
  };
}

/* ------------------------------------------------------------------ */
/* resolveDealFacts -- PB-D55 seed-then-supersede                      */
/* ------------------------------------------------------------------ */

/**
 * The Opportunity value wins when present; the Contact seeds it when not.
 * PB-D55: seeding is a one-time convenience, not synchronization, and once
 * approved underwriting is written the Opportunity is authoritative
 * permanently.
 *
 * When both are absent the unresolved reason names both, so the operator
 * is not sent looking for a value that exists nowhere.
 */
export function resolveDealFacts(
  opportunity: OpportunityUnderwritingValues,
  contact: ContactSeedFacts,
): DealFacts {
  function seed(
    opp: DealInput<number>,
    seedValue: number | null,
    label: string,
  ): DealInput<number> {
    if (opp.kind === "value") return opp;
    if (seedValue !== null) return { kind: "value", value: seedValue };
    return unresolved(`${label} is not set on the opportunity or the contact`);
  }

  return {
    arv: seed(opportunity.arv, contact.arv, "ARV"),
    repairs: seed(opportunity.repairs, contact.repairs, "Repairs"),
    askingPrice: opportunity.askingPrice ?? contact.askingPrice,
    assignmentMode: opportunity.assignmentMode,
    manualSpread: opportunity.manualSpread,
  };
}

/* ------------------------------------------------------------------ */
/* resolveInputs -- the three-level hierarchy                          */
/* ------------------------------------------------------------------ */

type AnyResolved<T> =
  | { kind: "value"; value: T; level: Level }
  | { kind: "unresolved"; reason: string };

/**
 * Deal Override -> Investor Policy -> IAOS Starter. The starter level
 * always resolves, so an assumption reaches unresolved only where a
 * higher level failed in a way that must not fall through -- see the
 * financing switch below.
 */
function pick<T>(
  override: AnyResolved<T>,
  policy: AnyResolved<T>,
  starter: T,
): Resolved<T> {
  if (override.kind === "value") return override;
  if (policy.kind === "value") return policy;
  return { kind: "value", value: starter, level: "iaos_starter" };
}

/**
 * Assembles the core's UnderwritingInputs.
 *
 * Financing: the switch resolves on its own. Off stops there and the three
 * terms are not consumed, so their provenance stays null. On resolves LTV,
 * rate and points independently, each possibly from a different level. An
 * unresolved switch makes financing unresolved regardless of the terms.
 *
 * Assignment fails closed. An unresolved mode, or Manual with no amount,
 * yields an unresolved assignment rather than substituting Standard
 * Minimum. PB-D56 section II.6: a mode never silently substitutes for
 * another, and an operator who selected Manual must not receive Standard
 * economics without being told.
 */
export function resolveInputs(
  facts: DealFacts,
  overrides: DealOverrides,
  policy: ParsedPolicy,
): UnderwritingInputs {
  const switchResolved = pick(
    overrides.financingEnabled,
    policy.financingEnabled,
    IAOS_STARTERS.financingEnabled,
  );

  let financing: Financing;
  if (switchResolved.kind !== "value") {
    financing = unresolved("financing switch unresolved");
  } else if (switchResolved.value === false) {
    financing = { kind: "off", level: switchResolved.level };
  } else {
    financing = {
      kind: "on",
      level: switchResolved.level,
      ltv: pick(overrides.financingLtv, policy.financingLtv, IAOS_STARTERS.financingLtv),
      rate: pick(overrides.financingRate, policy.financingRate, IAOS_STARTERS.financingRate),
      points: pick(
        overrides.financingPoints,
        policy.financingPoints,
        IAOS_STARTERS.financingPoints,
      ),
    };
  }

  let assignment: AssignmentResolution;
  if (facts.assignmentMode.kind !== "value") {
    assignment = { kind: "unresolved", reason: facts.assignmentMode.reason };
  } else if (facts.assignmentMode.value === "manual") {
    assignment =
      facts.manualSpread === null
        ? {
            kind: "unresolved",
            reason: "manual assignment selected but no amount is set",
          }
        : { kind: "manual", amount: facts.manualSpread };
  } else if (facts.assignmentMode.value === "profit_share") {
    assignment = { kind: "profit_share" };
  } else {
    assignment = { kind: "standard" };
  }

  return {
    arv: facts.arv,
    repairs: facts.repairs,
    sellingCostPct: pick(
      overrides.sellingCostPct,
      policy.sellingCostPct,
      IAOS_STARTERS.sellingCostPct,
    ),
    closingCost: pick(overrides.closingCost, policy.closingCost, IAOS_STARTERS.closingCost),
    monthlyCarry: pick(
      overrides.monthlyCarry,
      policy.monthlyCarry,
      IAOS_STARTERS.monthlyCarry,
    ),
    holdMonths: pick(overrides.holdMonths, policy.holdMonths, IAOS_STARTERS.holdMonths),
    buyerProfitPct: pick(
      overrides.buyerProfitPct,
      policy.buyerProfitPct,
      IAOS_STARTERS.buyerProfitPct,
    ),
    financing,
    assignment,
    standardMinimum: pick(
      overrides.standardMinimum,
      policy.standardMinimum,
      IAOS_STARTERS.standardMinimum,
    ),
    profitSharePct: pick(
      overrides.profitSharePct,
      policy.profitSharePct,
      IAOS_STARTERS.profitSharePct,
    ),
  };
}
