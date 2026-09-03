/**
 * Repair Estimation V1 -- type contract.
 *
 * Implements the governing V1 policy amendment dated 2026-09-02 in
 * docs/ESTIMATED_REPAIRS_STANDARD.md, identified there as
 * "IAOS Repair Policy -- 2026 v1". This module decides no policy of its
 * own and derives no amount that policy has not authorized.
 *
 * UNITS INVARIANT:
 * All monetary amounts are dollars as finite JavaScript numbers. No
 * intermediate monetary rounding occurs.
 *
 * SUPERSESSION:
 * The amendment removes geography, ZIP, city and market as repair-pricing
 * inputs, and supersedes the earlier geographic-factor language and the
 * DFW-selected semantics. No type here carries such an input and none may
 * be added under V1.
 *
 * BOUNDARY:
 * No persistence, no GHL identifier, no write, no React, no network, and
 * no offer or MAO economics. This layer produces an estimate; it does not
 * approve one and does not carry it anywhere.
 */

/**
 * Where an authorized amount came from. The amendment requires the three
 * to stay visibly distinguishable wherever amounts are shown: an amount
 * declared by IAOS policy must not be presented as a cost-book fact, and
 * a manual amount must not be presented as either one.
 */
export type Provenance = "BOOK" | "IAOS_POLICY" | "MANUAL";

/**
 * The three -- and only three -- visible pricing outcomes required by the
 * amendment. These must not collapse into one another. A blank or missing
 * price never silently becomes `no_repair`, and an `unpriced_risk` never
 * silently acquires an invented amount.
 */
export type PricingOutcome =
  | { kind: "no_repair" }
  | { kind: "priced"; amount: number; provenance: Provenance }
  | { kind: "unpriced_risk"; reason: string };

/**
 * Whether an amount is an indicated repair or a reserve held against a
 * condition nobody has established. The Disclosure requirement is LOCKED:
 * the two are economically identical in the conservative total and
 * informationally completely different, so they never collapse.
 */
export type Origin = "indicated" | "unknown_condition";

/** The layer of the five-component model a line belongs to. */
export type Component = "scaling" | "fixed_package" | "major_system";

/** Units where cost genuinely scales. The whole rehab does not scale. */
export type ScalingUnit = "sf" | "lf";

/**
 * Designated major systems. Windows appear in the LOCKED principle list
 * but carry no authorized reference row, so a window line prices only
 * from an operator-entered amount or remains an unpriced risk.
 */
export type MajorSystem =
  | "roof"
  | "electrical_whole_house"
  | "electrical_panel"
  | "plumbing_sewer"
  | "foundation"
  | "hvac"
  | "windows";

/**
 * Condition vocabulary. `good | repair | replace | unknown` is the base
 * vocabulary; `major` and `material_issue` exist because the authorized
 * reference table names them for plumbing/sewer and foundation.
 *
 * There is deliberately no age band. Any fraction of replacement cost is
 * a probability in disguise, and the cost book supplies no frequencies.
 */
export type Condition =
  | "good"
  | "repair"
  | "replace"
  | "major"
  | "material_issue"
  | "unknown";

/**
 * Fixed room / package selections. Kitchen and appliances are independent
 * selections: choosing one must not select, pair, tier, multiply or
 * otherwise alter the other. Each bathroom identified as needing work is
 * its own line; bathroom count is property context, never a quantity.
 */
export type PackageKey = "kitchen" | "appliances" | "bathroom";

/**
 * A row of the small common-repair reference table. The table is the only
 * authorized value set in V1 and grows only when a recurring real-world
 * need is observed and a normal value approved.
 */
export interface ReferenceRow {
  readonly system: MajorSystem;
  readonly conditions: readonly Condition[];
  readonly amount: number;
  readonly provenance: Provenance;
  readonly overrideAllowed: boolean;
  readonly note: string;
}

/**
 * How a line arrives at an outcome.
 *
 * `reference` consults the authorized table. `amount` is a known amount
 * supplied with its own provenance -- this is how a cost-book package
 * tier or an operator-entered figure enters, because the amendment
 * authorizes the package structure while the band-package compositions
 * remain unauthored product decisions. `scaled` multiplies an authorized
 * rate by a quantity. `unpriced_risk` is stated outright.
 */
export type PricingInput =
  | { kind: "no_repair" }
  | {
      kind: "reference";
      system: MajorSystem;
      condition: Condition;
      /** Permitted only where the matched row allows operator override. */
      override?: { amount: number };
    }
  | { kind: "amount"; amount: number; provenance: Provenance }
  | {
      kind: "scaled";
      ratePerUnit: number;
      unit: ScalingUnit;
      provenance: Provenance;
      /**
       * Null means the quantity is unavailable. It is never invented and
       * no size band is silently selected; for `sf` the engine may prefill
       * from authoritative property context, and otherwise the line stays
       * visibly unpriced.
       */
      quantity: number | null;
    }
  | { kind: "unpriced_risk"; reason: string };

/** One repair question or risk as the operator states it. */
export interface RepairLineInput {
  id: string;
  label: string;
  component: Component;
  pricing: PricingInput;
  /**
   * Optional for non-reference lines, defaulting to `indicated`. For a
   * reference line the engine derives it from the condition and rejects a
   * caller value that contradicts the derivation.
   */
  origin?: Origin;
  /** Required on `fixed_package` lines so package independence is visible. */
  packageKey?: PackageKey;
}

/**
 * Imported or operator-corrected property facts. Prefill is convenience,
 * not architecture: the estimator remains fully operable with every
 * dimension absent.
 *
 * `bathroomCount` is context only. It is never read to price anything and
 * never becomes a repair quantity.
 */
export interface PropertyContext {
  squareFeet: number | null;
  bathroomCount: number | null;
}

export interface RepairEstimateInput {
  lines: readonly RepairLineInput[];
  property: PropertyContext;
}

/** A line after evaluation, carrying its outcome and its bucket. */
export interface EvaluatedLine {
  id: string;
  label: string;
  component: Component;
  origin: Origin;
  packageKey?: PackageKey;
  outcome: PricingOutcome;
  /** Present only when the outcome is priced from the reference table. */
  referenceNote?: string;
}

export interface UnpricedRisk {
  id: string;
  label: string;
  reason: string;
}

/**
 * The inherited FMTM allowance.
 *
 * The amendment requires the exact label to be preserved and forbids
 * renaming it or using it as authority to imply a newly interpreted
 * purpose. Its historical purpose remains unverified.
 *
 * The allowance is 10% of resolved BOOK-derived priced amounts only.
 * IAOS POLICY reserves and MANUAL operator-entered amounts are excluded
 * from its basis.
 */
export interface FmtmAllowance {
  label: "FMTM 10% allowance — historical purpose unverified";
  ratePct: 10;
  outcome: { kind: "priced"; amount: number; basis: number };
}

/** The five transparent calculation components, mutually exclusive. */
export interface ComponentSubtotals {
  scalingRepairs: number;
  fixedPackageRepairs: number;
  majorSystemRepairs: number;
  unknownRiskReserves: number;
  fmtmAllowance: FmtmAllowance;
}

export interface RepairEstimate {
  lines: EvaluatedLine[];
  components: ComponentSubtotals;
  /** Resolved amounts split by provenance. Sums to `resolvedSubtotal`. */
  byProvenance: { BOOK: number; IAOS_POLICY: number; MANUAL: number };
  /** Indicated repairs only, excluding unknown-condition reserves. */
  indicatedSubtotal: number;
  /** Every priced amount. Not a complete allowance while risks remain. */
  resolvedSubtotal: number;
  unpricedRisks: UnpricedRisk[];
  /**
   * True only when no unpriced risk remains. While false the subtotal must
   * not be presented as a complete repair allowance.
   */
  isCompleteAllowance: boolean;
  /** Explicit and always present. Resolves, prices and hides nothing. */
  disclosure: string;
}
