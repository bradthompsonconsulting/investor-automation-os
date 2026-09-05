/**
 * Underwriting calculation core.
 *
 * Pure functions. No I/O, no GHL identifiers, no React, no writes.
 * Implements PB-D56's model; decides no economics of its own.
 *
 * UNITS INVARIANT: dollars as finite numbers; percentages as decimal
 * fractions. No intermediate monetary rounding.
 */

import type {
  AcquisitionPosition,
  DealInput,
  Figures,
  Level,
  Line,
  Provenance,
  Resolved,
  UnderwritingInputs,
  UnderwritingResult,
  Warning,
} from "./types";

/** Thrown when an input violates the units invariant. */
export class UnitsError extends Error {
  constructor(field: string, value: number, expected: string) {
    super(`${field}: ${value} violates units invariant (expected ${expected})`);
    this.name = "UnitsError";
  }
}

function guardFinite(field: string, v: number): void {
  if (!Number.isFinite(v)) {
    throw new UnitsError(field, v, "a finite number");
  }
}

function guardFraction(field: string, v: number): void {
  guardFinite(field, v);
  if (v < 0 || v > 1) {
    throw new UnitsError(field, v, "a decimal fraction in [0, 1]");
  }
}

type Acc = { missing: string[] };

/** Reads a policy assumption, recording its name when unresolved. */
function readResolved(
  acc: Acc,
  field: string,
  r: Resolved<number>,
  isFraction: boolean
): { value: number; level: Level } | null {
  if (r.kind === "unresolved") {
    acc.missing.push(field);
    return null;
  }
  if (isFraction) guardFraction(field, r.value);
  else guardFinite(field, r.value);
  return { value: r.value, level: r.level };
}

/**
 * Reads a resolved fraction WITHOUT recording it as missing.
 *
 * B8-03 / INV-46's own helper: Board 8 needs profitSharePct's resolution
 * independent of `readResolved`'s `acc.missing` side effect, so peeking at
 * it cannot alter which assignment modes PB-D56 section II.6 requires it
 * to resolve, and cannot double-report a field `readResolved` already
 * tracked at its one existing call site above.
 */
function peekResolvedFraction(r: Resolved<number>): { value: number; level: Level } | null {
  if (r.kind === "unresolved") return null;
  guardFraction("profitSharePct", r.value);
  return { value: r.value, level: r.level };
}

/** Reads a deal fact, recording its name when unresolved. */
function readDeal(
  acc: Acc,
  field: string,
  d: DealInput<number>
): number | null {
  if (d.kind === "unresolved") {
    acc.missing.push(field);
    return null;
  }
  guardFinite(field, d.value);
  return d.value;
}

export function computeUnderwriting(
  inputs: UnderwritingInputs
): UnderwritingResult {
  const acc: Acc = { missing: [] };

  // Gate 1 (PB-D56 section III).
  const arv = readDeal(acc, "arv", inputs.arv);
  const repairs = readDeal(acc, "repairs", inputs.repairs);

  const sellingPct = readResolved(acc, "sellingCostPct", inputs.sellingCostPct, true);
  const closing = readResolved(acc, "closingCost", inputs.closingCost, false);
  const carry = readResolved(acc, "monthlyCarry", inputs.monthlyCarry, false);
  const months = readResolved(acc, "holdMonths", inputs.holdMonths, false);
  const profitPct = readResolved(acc, "buyerProfitPct", inputs.buyerProfitPct, true);
  const stdMin = readResolved(acc, "standardMinimum", inputs.standardMinimum, false);

  // Financing: three states. Off is a legitimate zero; unresolved is not
  // zero and never becomes zero (PB-D56 section II.4).
  let k: number | null = null;
  let financingLevel: Level | null = null;
  let ltvLevel: Level | null = null;
  let rateLevel: Level | null = null;
  let pointsLevel: Level | null = null;

  if (inputs.financing.kind === "unresolved") {
    acc.missing.push("financing");
  } else if (inputs.financing.kind === "off") {
    k = 0;
    financingLevel = inputs.financing.level;
  } else {
    financingLevel = inputs.financing.level;
    const ltv = readResolved(acc, "financing.ltv", inputs.financing.ltv, true);
    const rate = readResolved(acc, "financing.rate", inputs.financing.rate, true);
    const points = readResolved(acc, "financing.points", inputs.financing.points, true);
    if (ltv) ltvLevel = ltv.level;
    if (rate) rateLevel = rate.level;
    if (points) pointsLevel = points.level;
    if (ltv && rate && points && months) {
      k = ltv.value * (points.value + (rate.value * months.value) / 12);
    }
  }

  // Profit share percentage is consumed only in profit_share mode.
  let sharePct: { value: number; level: Level } | null = null;
  if (inputs.assignment.kind === "profit_share") {
    sharePct = readResolved(acc, "profitSharePct", inputs.profitSharePct, true);
  }

  // B8-03 / INV-46: Board 8's Target Wholesale Profit needs
  // profitSharePct's resolution regardless of assignment mode. Read
  // independently of `sharePct` above, and WITHOUT touching `acc` -- this
  // must not add a new way for the deal to become "unresolved" outside
  // profit_share mode, and must not double-report a missing field `acc`
  // already tracked above. Reuses `sharePct` when profit_share mode
  // already resolved it, so the same field is never read twice.
  const board8SharePct: { value: number; level: Level } | null =
    sharePct ?? peekResolvedFraction(inputs.profitSharePct);

  if (inputs.assignment.kind === "unresolved") {
    acc.missing.push("assignmentMode");
  }

  if (inputs.assignment.kind === "manual") {
    guardFinite("assignment.amount", inputs.assignment.amount);
  }

  // Every required input resolves before any result is considered final.
  if (
    arv === null ||
    repairs === null ||
    !sellingPct ||
    !closing ||
    !carry ||
    !months ||
    !profitPct ||
    !stdMin ||
    k === null ||
    financingLevel === null ||
    inputs.assignment.kind === "unresolved" ||
    (inputs.assignment.kind === "profit_share" && !sharePct)
  ) {
    return { status: "unresolved", missing: acc.missing };
  }

  // The five subtractions (PB-D56 section II.1 through II.5).
  const sellingCosts = arv * sellingPct.value;
  const closingCosts = closing.value;
  const holdingCosts = carry.value * months.value;
  const requiredProfit = arv * profitPct.value;

  const baseBuyerCapacity =
    arv - repairs - sellingCosts - closingCosts - holdingCosts - requiredProfit;

  // Financing divides rather than subtracts (PB-D56 section I).
  const endBuyerMaxPrice = baseBuyerCapacity / (1 + k);

  // Assignment spread: three modes, one effective value.
  // The gate above returns unresolved when assignment is unresolved, so
  // TypeScript has already narrowed to the three valid strategies here.
  let assignmentSpread: number;
  if (inputs.assignment.kind === "standard") {
    assignmentSpread = stdMin.value;
  } else if (inputs.assignment.kind === "profit_share") {
    // The gate above guarantees sharePct is present in this branch.
    assignmentSpread = Math.max(requiredProfit * sharePct!.value, stdMin.value);
  } else {
    assignmentSpread = inputs.assignment.amount;
  }

  const sellerMAO = endBuyerMaxPrice - assignmentSpread;

  const warnings: Warning[] = [];
  if (inputs.assignment.kind === "manual" && assignmentSpread < stdMin.value) {
    warnings.push({
      code: "MANUAL_SPREAD_BELOW_STANDARD_MINIMUM",
      spread: assignmentSpread,
      minimum: stdMin.value,
    });
  }

  const breakdown: Line[] = [
    { label: "ARV", amount: arv },
    { label: "Repairs", amount: -repairs },
    { label: "End-Buyer Selling Costs", amount: -sellingCosts },
    { label: "End-Buyer Purchase/Closing Costs", amount: -closingCosts },
    { label: "End-Buyer Holding Costs", amount: -holdingCosts },
    { label: "Required Buyer Profit", amount: -requiredProfit },
    { label: "Base Buyer Capacity", amount: baseBuyerCapacity },
    { label: "End-Buyer Maximum Purchase Price", amount: endBuyerMaxPrice },
    { label: "Assignment Spread", amount: -assignmentSpread },
    { label: "Seller MAO", amount: sellerMAO },
  ];

  const provenance: Provenance = {
    sellingCostPct: sellingPct.level,
    closingCost: closing.level,
    monthlyCarry: carry.level,
    holdMonths: months.level,
    buyerProfitPct: profitPct.level,
    standardMinimum: stdMin.level,
    financingEnabled: financingLevel,
    financingLtv: ltvLevel,
    financingRate: rateLevel,
    financingPoints: pointsLevel,
    profitSharePct: sharePct ? sharePct.level : null,
  };

  const figures: Figures = {
    baseBuyerCapacity,
    financingFactor: k,
    endBuyerMaxPrice,
    assignmentSpread,
    sellerMAO,
    requiredBuyerProfit: requiredProfit,
    standardMinimumAssignmentSpread: stdMin.value,
    standardMinimumLevel: stdMin.level,
    buyerProfitSharePct: board8SharePct ? board8SharePct.value : null,
    buyerProfitSharePctLevel: board8SharePct ? board8SharePct.level : null,
  };

  return { status: "resolved", figures, breakdown, provenance, warnings };
}

/**
 * Acquisition position. Compares the seller's asking price to Seller MAO.
 * Deliberately separate from underwriting economics: asking price does
 * not participate in the waterfall and is not Gate 1.
 */
export function computeAcquisitionPosition(args: {
  sellerMAO: number;
  askingPrice: number | null;
}): AcquisitionPosition {
  if (args.askingPrice === null) {
    return { position: "asking_unknown" };
  }
  guardFinite("askingPrice", args.askingPrice);
  guardFinite("sellerMAO", args.sellerMAO);
  if (args.askingPrice <= args.sellerMAO) {
    return { position: "within_range", acquisitionCushion: args.sellerMAO - args.askingPrice };
  }
  return { position: "above_range", gapToUnderwriting: args.askingPrice - args.sellerMAO };
}
