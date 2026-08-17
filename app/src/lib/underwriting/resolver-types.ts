/**
 * Underwriting resolver -- type contract.
 *
 * The layer between GHL's wire shapes and the calculation core's
 * UnderwritingInputs. Pure: no fetching, no I/O, no React, no writes.
 * Data arrives already fetched; this module transforms and resolves it.
 *
 * Boundary rule: nothing here may perform a network call. The input types
 * below are wire shapes, which makes fetching unrepresentable inside this
 * module rather than merely discouraged.
 *
 * Second boundary rule: a parser parses ONE object's wire representation.
 * Deciding which object's value wins is a resolver's job, never a parser's.
 * This is why there is no parseOpportunity() returning deal facts -- under
 * PB-D55 those facts may come from the Opportunity or, when absent there,
 * be seeded from the Contact, and burying that choice inside something
 * named "parse" would hide the authority rule.
 *
 * PB-D56 section V: Deal Override -> Investor Policy -> IAOS Starter ->
 * unresolved. This module owns that resolution and assigns the Level the
 * core carries through to provenance.
 */

import type { Resolved, DealInput } from "./types";

/* ------------------------------------------------------------------ */
/* Wire shapes -- what GHL returns                                     */
/* ------------------------------------------------------------------ */

/**
 * One GHL Custom Value. Location-scoped investor policy.
 * OBSERVED (UNDERWRITING_FIELD_REFERENCE.md): flat strings carrying no
 * symbols -- "10" not "10%", "5000" not "$5,000".
 */
export type PolicyValue = {
  id: string;
  value: string;
};

/**
 * One entry from an opportunity's or contact's customFields array.
 * OBSERVED: the opportunity projection is sparse -- only populated fields
 * appear -- and the value key varies by dataType. NUMERICAL arrives as
 * fieldValueNumber, DATE as fieldValueDate in unix milliseconds. The
 * contact model uses {id, value} instead.
 *
 * Every value key is optional because any given entry carries exactly one.
 * A parser reads the key the field's known dataType dictates and treats a
 * surprise as unresolved rather than coercing whatever happens to be
 * present. MaoCalculator's cfRaw coalesces across all of them; that
 * permissiveness is deliberately NOT inherited here.
 */
export type RawField = {
  id: string;
  type?: string;
  value?: unknown;
  fieldValue?: unknown;
  fieldValueNumber?: unknown;
  fieldValueString?: unknown;
  fieldValueDate?: unknown;
};

/* ------------------------------------------------------------------ */
/* Provenance-constrained resolution                                   */
/* ------------------------------------------------------------------ */

/**
 * A value resolved from investor policy. The Level is pinned to the
 * literal rather than the general Level union so the type system enforces
 * the provenance rule instead of trusting the parser to behave. Without
 * this, a ParsedPolicy would be assignable to DealOverrides and vice
 * versa, which is false about the domain.
 */
export type PolicyResolved<T> =
  | { kind: "value"; value: T; level: "investor_policy" }
  | { kind: "unresolved"; reason: string };

/** A value resolved from a deal-level override. Same reasoning. */
export type OverrideResolved<T> =
  | { kind: "value"; value: T; level: "deal_override" }
  | { kind: "unresolved"; reason: string };

/* ------------------------------------------------------------------ */
/* Parsed intermediates                                                */
/* ------------------------------------------------------------------ */

/**
 * Investor policy after parsing, before resolution. Each assumption is
 * resolved or not on its own -- one malformed value does not invalidate
 * the rest, and an absent Custom Value is simply unresolved at this level
 * so the level below can supply it.
 */
export type ParsedPolicy = {
  sellingCostPct: PolicyResolved<number>;
  closingCost: PolicyResolved<number>;
  monthlyCarry: PolicyResolved<number>;
  holdMonths: PolicyResolved<number>;
  buyerProfitPct: PolicyResolved<number>;
  financingEnabled: PolicyResolved<boolean>;
  financingLtv: PolicyResolved<number>;
  financingRate: PolicyResolved<number>;
  financingPoints: PolicyResolved<number>;
  standardMinimum: PolicyResolved<number>;
  profitSharePct: PolicyResolved<number>;
};

/**
 * Deal-level overrides of investor policy, sourced from the Opportunity.
 *
 * CURRENT PRODUCTION STATE: PB-D56 section VI creates override fields on
 * first real need, and none exists. Every member is therefore unresolved
 * in production today. The level is supported now because PB-D56 already
 * defines the hierarchy; a resolver that knew only two levels would need
 * redesigning the moment the first carrier appears. Tests exercise this
 * level with fixtures.
 */
export type DealOverrides = {
  sellingCostPct: OverrideResolved<number>;
  closingCost: OverrideResolved<number>;
  monthlyCarry: OverrideResolved<number>;
  holdMonths: OverrideResolved<number>;
  buyerProfitPct: OverrideResolved<number>;
  financingEnabled: OverrideResolved<boolean>;
  financingLtv: OverrideResolved<number>;
  financingRate: OverrideResolved<number>;
  financingPoints: OverrideResolved<number>;
  standardMinimum: OverrideResolved<number>;
  profitSharePct: OverrideResolved<number>;
};

/**
 * Underwriting values read from the Opportunity. Authoritative under
 * PB-D55 when present.
 *
 * OBSERVED 2026-08-12 (PB-D55): no opportunity in the location carries any
 * underwriting input value -- all seven unpopulated across all 42. Contact
 * seeding is therefore the normal path today, not an edge case.
 */
export type OpportunityUnderwritingValues = {
  arv: DealInput<number>;
  repairs: DealInput<number>;
  askingPrice: number | null;
  assignmentMode: Resolved<AssignmentModeName>;
  manualSpread: number | null;
};

/**
 * Seed values read from the Contact. Bare nullables rather than
 * DealInput: absence here is unremarkable and never needs to report
 * itself as a missing input, because the Opportunity side already does.
 * PB-D55: seeding is a one-time convenience, not synchronization.
 */
export type ContactSeedFacts = {
  arv: number | null;
  repairs: number | null;
  askingPrice: number | null;
};

/** PB-D56 section II.6's three modes, as stored in Assignment Mode. */
export type AssignmentModeName = "standard" | "profit_share" | "manual";

/**
 * PB-D56 section II's three option strings, and the ONLY place in this
 * repository that knows them.
 *
 * OBSERVED from the wire, in this order, and confirmed again by PB-D59
 * Proof A: GHL stores this picklist by LABEL rather than by option id, so
 * these literals are what travels in both directions -- the resolver reads
 * them off an Opportunity, and Approve writes one back.
 *
 * DECLARED ONCE, DERIVED BOTH WAYS. A second copy of these three strings
 * anywhere would be a second source of truth for a value that crosses the
 * wire in both directions. If GHL's labels ever change, one copy gets
 * updated and the other does not -- and the failure is quiet: Approve
 * writes an option the picklist does not carry, or the resolver reads a
 * mode it does not recognize and reports the deal unresolved. Neither
 * announces itself.
 *
 * The domain discriminant is what travels through the calculation core and
 * the view model. These labels are wire format and stay at the edges.
 */
export const ASSIGNMENT_MODE_OPTIONS: ReadonlyArray<readonly [string, AssignmentModeName]> = [
  ["Standard Minimum", "standard"],
  ["25% of Buyer Profit", "profit_share"],
  ["Manual", "manual"],
] as const;

/** GHL option label -> domain discriminant. Used when parsing an Opportunity. */
export const MODE_BY_OPTION: Record<string, AssignmentModeName> =
  Object.fromEntries(ASSIGNMENT_MODE_OPTIONS) as Record<string, AssignmentModeName>;

/**
 * Domain discriminant -> GHL option label. Used when Approve writes.
 *
 * `manual` maps to "Manual" regardless of its amount: the amount is a
 * separate domain concern with no carrier of its own, and the mode field
 * records only which calculation governs.
 */
export const OPTION_BY_MODE: Record<AssignmentModeName, string> =
  Object.fromEntries(ASSIGNMENT_MODE_OPTIONS.map(([label, mode]) => [mode, label])) as
    Record<AssignmentModeName, string>;

/**
 * Deal facts after seed-then-supersede resolution.
 *
 * manualSpread is a bare nullable, not a DealInput: it is required only
 * when assignmentMode is "manual", and under the other two modes an absent
 * amount is entirely correct rather than a missing input. resolveInputs
 * owns that conditional rule.
 *
 * CARRIER GAP: no GHL field holds the manual spread amount. Assignment
 * Mode records which mode governs; nothing records the manual dollar
 * figure. Manual mode is therefore computable and testable here but cannot
 * become durable approved state until a carrier is decided. That is a
 * PB-D56 gap, not a lookup.
 */
export type DealFacts = {
  arv: DealInput<number>;
  repairs: DealInput<number>;
  askingPrice: number | null;
  assignmentMode: Resolved<AssignmentModeName>;
  manualSpread: number | null;
};

/** parseOpportunityOverrides and the facts path stay separate throughout. */
export type ParsedDeal = {
  facts: DealFacts;
  overrides: DealOverrides;
};

/* ------------------------------------------------------------------ */
/* Identifier maps -- supplied by the caller from ghl-config           */
/* ------------------------------------------------------------------ */

/**
 * The caller passes identifier maps in rather than this module importing
 * ghl-config directly. That keeps the resolver pure and testable with
 * fixture ids, and keeps environment selection at the call site where
 * PB-D51 put it.
 *
 * Record<keyof ParsedPolicy, string> forces exactly the eleven policy
 * keys -- no more, no fewer -- so drift against ghl-config's customValues
 * block surfaces at compile time rather than as a lookup returning
 * undefined.
 */
export type CustomValueIds = Record<keyof ParsedPolicy, string>;

/**
 * Opportunity-side deal-fact identifiers.
 *
 * NONE OF THESE THREE IDS IS KNOWN. PB-D55 line 1743 names the fields on
 * the Opportunity schema -- arv_after_repair_value, repair_estimate,
 * asking_price -- but their ids have never been read. This type records
 * what the resolver needs; grounding the values is a separate GHL read.
 */
export type OpportunityFactIds = {
  arv: string;
  repairs: string;
  askingPrice: string;
  assignmentMode: string;
};

/**
 * Contact-side seed identifiers. Contact ARV is already in ghl-config as
 * wMBTGWMs97yysQFx7Vad; the other two ids have not been read.
 */
export type ContactSeedIds = {
  arv: string;
  repairs: string;
  askingPrice: string;
};

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * A malformed policy value is distinct from an absent one. Absent means
 * "the level below supplies it"; malformed means someone put something in
 * GHL that this code cannot read, and the operator needs to know which
 * value and what was found. Carried alongside the parse result rather than
 * thrown, because one bad Custom Value must not prevent the other ten from
 * resolving.
 */
export type PolicyParseIssue = {
  key: keyof ParsedPolicy;
  id: string;
  raw: string;
  reason: string;
};

export type ParsePolicyResult = {
  policy: ParsedPolicy;
  issues: PolicyParseIssue[];
};
