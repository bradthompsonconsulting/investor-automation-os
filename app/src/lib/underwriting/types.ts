/**
 * Underwriting calculation core -- type contract.
 *
 * Implements PB-D55 and PB-D56. Decides no economics of its own.
 *
 * UNITS INVARIANT:
 * All monetary inputs and outputs are represented in dollars as finite
 * JavaScript numbers; percentages enter the core as decimal fractions.
 * No intermediate monetary rounding occurs.
 *
 * GHL stores percentages in human units (10 for 10%). Converting to
 * decimal fractions is the adapter's responsibility, enforced by a
 * range guard in compute.ts.
 */

/** Which level of PB-D56 section V's hierarchy supplied a value. */
export type Level = "deal_override" | "investor_policy" | "iaos_starter";

/**
 * An investor-policy assumption, resolved through
 * Deal Override -> Investor Policy -> IAOS Starter -> Unresolved.
 * Resolution happens in the adapter; the core carries `level` through.
 */
export type Resolved<T> =
  | { kind: "value"; value: T; level: Level }
  | { kind: "unresolved"; reason: string };

/**
 * A deal fact. Not an override of any policy, so it carries no Level.
 * ARV and Repairs are Gate 1 (PB-D56 section III).
 */
export type DealInput<T> =
  | { kind: "value"; value: T }
  | { kind: "unresolved"; reason: string };

/**
 * Purchase Financing Enabled is a switch with three states, not two
 * (PB-D56 section II.4). Off is a legitimate zero because someone
 * decided it. Unresolved is not zero and never becomes zero.
 */
export type Financing =
  | { kind: "off"; level: Level }
  | {
      kind: "on";
      level: Level;
      ltv: Resolved<number>;
      rate: Resolved<number>;
      points: Resolved<number>;
    }
  | { kind: "unresolved"; reason: string };

/**
 * PB-D56 section II.6's three modes. Mode is durable state, not
 * provenance -- it determines the calculation and cannot be
 * reconstructed from the resulting number.
 *
 * This type represents a VALID assignment strategy. Failure to determine
 * one is AssignmentResolution below, deliberately not a fourth member
 * here: "unresolved" is not a way of assigning a deal.
 */
export type Assignment =
  | { kind: "standard" }
  | { kind: "profit_share" }
  | { kind: "manual"; amount: number };

/**
 * A determined assignment strategy, or a statement that one could not be
 * determined.
 *
 * Unresolved is reachable two ways: Assignment Mode is absent or holds an
 * unrecognized option string, or the mode is Manual and no amount exists.
 * Both fail closed. An operator who selected Manual and silently received
 * Standard Minimum economics would be the exact substitution PB-D56
 * section II.6 forbids between modes.
 *
 * Known V1 conservatism: End-Buyer Maximum Purchase Price does not depend
 * on assignment mode, so the buyer ceiling is arithmetically computable
 * even when assignment is unresolved. UnderwritingResult is all-or-nothing,
 * so it is not exposed. Surfacing a valid ceiling alongside an unresolved
 * Seller MAO is a deliberate result-model enhancement, not a fix to smuggle
 * in later.
 */
export type AssignmentResolution =
  | Assignment
  | { kind: "unresolved"; reason: string };

/** The eleven PB-D56 section IV assumptions, plus the two Gate 1 inputs. */
export type UnderwritingInputs = {
  arv: DealInput<number>;
  repairs: DealInput<number>;
  sellingCostPct: Resolved<number>;
  closingCost: Resolved<number>;
  monthlyCarry: Resolved<number>;
  holdMonths: Resolved<number>;
  buyerProfitPct: Resolved<number>;
  financing: Financing;
  assignment: AssignmentResolution;
  standardMinimum: Resolved<number>;
  profitSharePct: Resolved<number>;
};

/**
 * One row of the zone 4 waterfall. Rows carry no provenance: several are
 * computed, and composite deductions draw on assumptions that may resolve
 * from different levels. Provenance is reported per assumption instead.
 */
export type Line = {
  label: string;
  amount: number;
};

/**
 * Which level supplied each assumption (PB-D56 section V). Reported per
 * assumption because a single deduction may combine values from different
 * levels -- monthly carry from Investor Policy, hold period from a Deal
 * Override. Null where the assumption was not consumed in this calculation.
 */
export type Provenance = {
  sellingCostPct: Level;
  closingCost: Level;
  monthlyCarry: Level;
  holdMonths: Level;
  buyerProfitPct: Level;
  standardMinimum: Level;
  financingEnabled: Level;
  financingLtv: Level | null;
  financingRate: Level | null;
  financingPoints: Level | null;
  profitSharePct: Level | null;
};

/**
 * Out-of-parameters conditions. Never blocking, always visible
 * (PB-D56 section II.6, workspace spec zone 2).
 */
export type Warning = {
  code: "MANUAL_SPREAD_BELOW_STANDARD_MINIMUM";
  spread: number;
  minimum: number;
};

export type Figures = {
  baseBuyerCapacity: number;
  financingFactor: number;
  endBuyerMaxPrice: number;
  assignmentSpread: number;
  sellerMAO: number;
  /**
   * B8-03 / INV-46. PB-D56 section II.5's Required Buyer Profit, already
   * computed internally -- exposed rather than recomputed, so Board 8's
   * Target Wholesale Profit reuses this engine's own arithmetic instead of
   * duplicating it. Present whenever `status` is "resolved" -- it shares
   * ARV and buyerProfitPct's existing gate.
   */
  requiredBuyerProfit: number;
  /**
   * B8-03 / INV-46. PB-D56 section IV's Standard Minimum Assignment
   * Spread, resolved -- independent of which assignment mode governs this
   * deal's own `assignmentSpread` above. Board 8's Target and Max both
   * reuse this specific value, per Brad's 2026-09-05 governing amendment:
   * Max Supported Offer = End-Buyer Maximum Purchase Price minus THIS
   * value, never the deal's effective assignmentSpread, which differs
   * under Manual or 25%-of-Buyer-Profit mode. Present whenever `status`
   * is "resolved" -- it shares the existing standardMinimum gate.
   */
  standardMinimumAssignmentSpread: number;
  standardMinimumLevel: Level;
  /**
   * B8-03 / INV-46. PB-D56 section IV's Buyer Profit Share Percentage
   * (decimal fraction), resolved regardless of assignment mode. Target
   * Wholesale Profit needs it even when the active assignment mode is
   * Standard or Manual, where PB-D56 itself never required it to
   * resolve. Null only for a synthetic `UnderwritingInputs` constructed
   * directly with an unresolved profitSharePct outside profit_share mode
   * (see compute.ts) -- every real caller reaches this through
   * `resolveInputs`'s hierarchy, whose IAOS Starter level (0.25)
   * guarantees resolution. Deliberately independent of
   * `Provenance.profitSharePct` below, which reports whether the ACTIVE
   * assignment spread consumed it, not whether it resolved at all --
   * changing that field's existing null-outside-profit_share-mode
   * meaning would break `test-underwriting-core.cjs` case 12.
   */
  buyerProfitSharePct: number | null;
  buyerProfitSharePctLevel: Level | null;
};

/**
 * Unresolved propagates: a deduction that cannot resolve makes both
 * outputs unresolved, and the core reports what is missing rather than
 * producing a partial number (PB-D56 section III).
 */
export type UnderwritingResult =
  | {
      status: "resolved";
      figures: Figures;
      breakdown: Line[];
      provenance: Provenance;
      warnings: Warning[];
    }
  | { status: "unresolved"; missing: string[] };

/** Acquisition position. Separate from underwriting economics by design. */
export type AcquisitionPosition =
  | { position: "asking_unknown" }
  | { position: "within_range"; acquisitionCushion: number }
  | { position: "above_range"; gapToUnderwriting: number };
