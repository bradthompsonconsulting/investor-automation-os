/**
 * Repair Estimation V1 -- calculation core.
 *
 * Pure functions. No I/O, no GHL identifier, no React, no persistence, no
 * write, no network. Implements the governing 2026-09-02 amendment's
 * model and decides no policy of its own.
 *
 *     Repair Allowance =  Scaling Repairs
 *                      +  Fixed Room / Package Repairs
 *                      +  Major-System Repairs
 *                      +  Unknown / Risk Reserves
 *                      +  Contingency (the inherited FMTM allowance)
 *
 * The five components are mutually exclusive here: a priced line whose
 * origin is an unestablished condition is a reserve, and every other
 * priced line falls to its own layer. That split is the LOCKED Disclosure
 * requirement, not a presentation choice.
 *
 * UNITS INVARIANT: dollars as finite numbers. No intermediate monetary
 * rounding.
 */

import { findReferenceRow } from "./reference";
import type {
  ComponentSubtotals,
  EvaluatedLine,
  FmtmAllowance,
  Origin,
  PricingOutcome,
  PropertyContext,
  Provenance,
  RepairEstimate,
  RepairEstimateInput,
  RepairLineInput,
  UnpricedRisk,
} from "./types";

/** Thrown when an input violates the contract. Never silently corrected. */
export class RepairInputError extends Error {
  constructor(field: string, detail: string) {
    super(`${field}: ${detail}`);
    this.name = "RepairInputError";
  }
}

/**
 * The inherited allowance's exact label. The amendment forbids renaming
 * it or using it as authority to imply a newly interpreted purpose.
 */
export const FMTM_ALLOWANCE_LABEL =
  "FMTM 10% allowance — historical purpose unverified" as const;

/**
 * Inspection disclosure. Explicit and always present. It does not
 * resolve, price or hide an unpriced risk.
 */
export const INSPECTION_DISCLOSURE =
  "Actual condition and repair scope are subject to inspection. " +
  "This is an underwriting estimate, not a contractor bid or a " +
  "guaranteed repair cost.";

function guardFiniteMoney(field: string, v: number): void {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new RepairInputError(field, `${String(v)} is not a finite number`);
  }
  if (v < 0) {
    throw new RepairInputError(field, `${v} is negative`);
  }
}

function guardNonBlank(field: string, v: string): void {
  if (typeof v !== "string" || v.trim() === "") {
    throw new RepairInputError(field, "must be a non-blank string");
  }
}

/**
 * Square footage available to prefill a scaling line. Absent stays absent:
 * it is never invented and no size band is silently selected.
 */
function availableSquareFeet(property: PropertyContext): number | null {
  const sf = property.squareFeet;
  if (sf === null) return null;
  guardFiniteMoney("property.squareFeet", sf);
  if (sf <= 0) {
    throw new RepairInputError("property.squareFeet", `${sf} is not positive`);
  }
  return sf;
}

/**
 * Evaluate one line to exactly one of the three visible outcomes.
 *
 * Each line is evaluated in isolation from every other line. That is what
 * makes kitchen and appliance selections independent: there is no pairing,
 * no tiering across lines and no hidden quality multiplier, because no
 * line is ever consulted while pricing another.
 */
export function evaluateLine(
  line: RepairLineInput,
  property: PropertyContext,
): EvaluatedLine {
  guardNonBlank(`line.id`, line.id);
  guardNonBlank(`line[${line.id}].label`, line.label);

  if (line.component === "fixed_package") {
    if (line.packageKey === undefined) {
      throw new RepairInputError(
        `line[${line.id}].packageKey`,
        "a fixed_package line must name its package",
      );
    }
  } else if (line.packageKey !== undefined) {
    throw new RepairInputError(
      `line[${line.id}].packageKey`,
      `only a fixed_package line carries a package, not ${line.component}`,
    );
  }

  const p = line.pricing;
  let outcome: PricingOutcome;
  let derivedOrigin: Origin | null = null;
  let referenceNote: string | undefined;

  switch (p.kind) {
    case "no_repair": {
      outcome = { kind: "no_repair" };
      break;
    }

    case "reference": {
      // An unestablished condition is a reserve, not an indicated repair.
      derivedOrigin = p.condition === "unknown" ? "unknown_condition" : "indicated";
      const row = findReferenceRow(p.system, p.condition);

      if (row === null) {
        if (p.override !== undefined) {
          throw new RepairInputError(
            `line[${line.id}].override`,
            `no authorized row for ${p.system}/${p.condition} to override`,
          );
        }
        if (p.condition === "good") {
          outcome = { kind: "no_repair" };
          break;
        }
        // Blank for operator entry. Never invented, never derived.
        outcome = {
          kind: "unpriced_risk",
          reason:
            `no authorized reference amount for ${p.system}/${p.condition}; ` +
            "enter the known amount manually",
        };
        break;
      }

      if (p.override !== undefined) {
        if (!row.overrideAllowed) {
          throw new RepairInputError(
            `line[${line.id}].override`,
            `${p.system} does not permit operator override`,
          );
        }
        guardFiniteMoney(`line[${line.id}].override.amount`, p.override.amount);
        // An overridden amount is the operator's, not IAOS policy's.
        outcome = {
          kind: "priced",
          amount: p.override.amount,
          provenance: "MANUAL",
        };
        referenceNote = `operator override of ${row.note}`;
        break;
      }

      outcome = {
        kind: "priced",
        amount: row.amount,
        provenance: row.provenance,
      };
      referenceNote = row.note;
      break;
    }

    case "amount": {
      guardFiniteMoney(`line[${line.id}].amount`, p.amount);
      outcome = { kind: "priced", amount: p.amount, provenance: p.provenance };
      break;
    }

    case "scaled": {
      guardFiniteMoney(`line[${line.id}].ratePerUnit`, p.ratePerUnit);
      let quantity = p.quantity;
      if (quantity === null && p.unit === "sf") {
        // Authoritative or imported square footage may prefill.
        quantity = availableSquareFeet(property);
      }
      if (quantity === null) {
        outcome = {
          kind: "unpriced_risk",
          reason: `${p.unit} quantity unavailable; not invented and no band selected`,
        };
        break;
      }
      guardFiniteMoney(`line[${line.id}].quantity`, quantity);
      outcome = {
        kind: "priced",
        amount: p.ratePerUnit * quantity,
        provenance: p.provenance,
      };
      break;
    }

    case "unpriced_risk": {
      guardNonBlank(`line[${line.id}].reason`, p.reason);
      outcome = { kind: "unpriced_risk", reason: p.reason };
      break;
    }
  }

  let origin: Origin;
  if (derivedOrigin !== null) {
    if (line.origin !== undefined && line.origin !== derivedOrigin) {
      throw new RepairInputError(
        `line[${line.id}].origin`,
        `${line.origin} contradicts the condition-derived ${derivedOrigin}`,
      );
    }
    origin = derivedOrigin;
  } else {
    origin = line.origin === undefined ? "indicated" : line.origin;
  }

  const evaluated: EvaluatedLine = {
    id: line.id,
    label: line.label,
    component: line.component,
    origin,
    outcome,
  };
  if (line.packageKey !== undefined) evaluated.packageKey = line.packageKey;
  if (referenceNote !== undefined) evaluated.referenceNote = referenceNote;
  return evaluated;
}

/**
 * Compute the decomposed repair estimate.
 *
 * `property.bathroomCount` is deliberately never read. Bathroom count is
 * property context, not a repair quantity; only bathrooms the operator
 * identified as needing work appear, as their own lines.
 */
export function computeRepairEstimate(
  input: RepairEstimateInput,
): RepairEstimate {
  const seen: Record<string, true> = Object.create(null) as Record<string, true>;
  const lines: EvaluatedLine[] = [];

  for (const raw of input.lines) {
    const line = evaluateLine(raw, input.property);
    if (seen[line.id] === true) {
      throw new RepairInputError(`line.id`, `duplicate identifier ${line.id}`);
    }
    seen[line.id] = true;
    lines.push(line);
  }

  let scalingRepairs = 0;
  let fixedPackageRepairs = 0;
  let majorSystemRepairs = 0;
  let unknownRiskReserves = 0;
  const byProvenance: Record<Provenance, number> = {
    BOOK: 0,
    IAOS_POLICY: 0,
    MANUAL: 0,
  };
  const unpricedRisks: UnpricedRisk[] = [];

  for (const line of lines) {
    if (line.outcome.kind === "unpriced_risk") {
      unpricedRisks.push({
        id: line.id,
        label: line.label,
        reason: line.outcome.reason,
      });
      continue;
    }
    if (line.outcome.kind === "no_repair") continue;

    const amount = line.outcome.amount;
    byProvenance[line.outcome.provenance] += amount;

    if (line.origin === "unknown_condition") {
      unknownRiskReserves += amount;
    } else if (line.component === "scaling") {
      scalingRepairs += amount;
    } else if (line.component === "fixed_package") {
      fixedPackageRepairs += amount;
    } else {
      majorSystemRepairs += amount;
    }
  }

  const fmtmAllowance: FmtmAllowance = {
    label: FMTM_ALLOWANCE_LABEL,
    ratePct: 10,
    outcome: {
      kind: "priced",
      basis: byProvenance.BOOK,
      amount: byProvenance.BOOK * 0.1,
    },
  };

  const components: ComponentSubtotals = {
    scalingRepairs,
    fixedPackageRepairs,
    majorSystemRepairs,
    unknownRiskReserves,
    fmtmAllowance,
  };

  const resolvedSubtotal =
    scalingRepairs + fixedPackageRepairs + majorSystemRepairs + unknownRiskReserves;

  return {
    lines,
    components,
    byProvenance,
    indicatedSubtotal: resolvedSubtotal - unknownRiskReserves,
    resolvedSubtotal,
    unpricedRisks,
    isCompleteAllowance: unpricedRisks.length === 0,
    disclosure: INSPECTION_DISCLOSURE,
  };
}
