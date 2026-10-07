/**
 * Standalone Deal Calculator -- primary bar formatter. B8-09 / INV-52.
 *
 * Pure. No I/O, no React, no GHL, no fetch. CONSUMES an already-computed
 * `Board8Economics` and `ExpectedSpread` (both B8-03, imported and never
 * recomputed) and formats the six required primary-bar numbers, in the
 * exact required order:
 *
 *     ARV | Repairs | Test Price | Target | Max | Spread
 *
 * SPREAD IS Expected Spread @ Test Price, EXPLICITLY. `referenceKind:
 * "test_price"` is the exact name `DEAL_ECONOMICS_OFFER_READINESS_V1.md`
 * (B8-01) and its B8-02 reconciliation already reserved for this exact
 * surface -- "a candidate price the operator is trying out on the
 * standalone calculator." This module contains no arithmetic of its own:
 * every number is read off objects `board8-economics.ts` already produced.
 *
 * Mirrors `seller-call-deal-bar.ts`'s established shape and conventions
 * (the `{kind: "value" | "waiting", text}` cell value, the same waiting-
 * text-naming-the-reason pattern) without importing from it -- these are
 * two distinct surfaces (Seller Call has Seller Position/Current Offer
 * cells this calculator does not) and sharing a type across unrelated
 * pages would couple them for no reason.
 */

import type { Board8Economics, ExpectedSpread } from "./underwriting/board8-economics";

export type DealCalcBarCellValue =
  | { kind: "value"; text: string }
  | { kind: "waiting"; text: string };

export type DealCalcBarCell = {
  key: string;
  label: string;
  value: DealCalcBarCellValue;
};

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function factCell(key: string, label: string, value: number | null, waitingText: string): DealCalcBarCell {
  return {
    key,
    label,
    value: value === null ? { kind: "waiting", text: waitingText } : { kind: "value", text: money(value) },
  };
}

export type DealCalcBarInput = {
  arv: number | null;
  repairs: number | null;
  testPrice: number | null;
  /** B8-03's own output. Null before any economics have been computed. */
  board8: Board8Economics | null;
  /** B8-03's own output, computed with referenceKind "test_price". Null before any economics have been computed. */
  expectedSpread: ExpectedSpread | null;
};

/** The exact six labels, in order -- asserted by the deterministic harness. */
export const DEAL_CALC_BAR_LABELS: readonly string[] = [
  "ARV", "Repairs", "Test Price", "Target", "Max", "Spread",
];

/**
 * Builds the six primary-bar cells, in the exact required order. Every
 * value is read from an already-computed B8-03 result; nothing here
 * recomputes Target, Max, or Spread.
 */
export function buildDealCalculatorBarCells(input: DealCalcBarInput): DealCalcBarCell[] {
  const target =
    input.board8 && input.board8.status === "calculated" && input.board8.target.status === "calculated"
      ? { kind: "value" as const, text: money(input.board8.target.targetAcquisitionPrice) }
      : {
          kind: "waiting" as const,
          text:
            input.board8 && input.board8.status === "calculated"
              ? input.board8.target.status === "unavailable"
                ? input.board8.target.reason
                : "Not yet calculated"
              : "Not yet calculated",
        };

  const max =
    input.board8 && input.board8.status === "calculated"
      ? { kind: "value" as const, text: money(input.board8.maxSupportedOffer) }
      : { kind: "waiting" as const, text: "Not yet calculated" };

  const spread =
    input.expectedSpread && input.expectedSpread.status === "calculated"
      ? { kind: "value" as const, text: money(input.expectedSpread.expectedSpread) }
      : {
          kind: "waiting" as const,
          text: input.expectedSpread && input.expectedSpread.status === "unavailable"
            ? input.expectedSpread.reason
            : "Not yet calculated",
        };

  return [
    factCell("arv", "ARV", input.arv, "Not yet entered"),
    factCell("repairs", "Repairs", input.repairs, "Not yet entered"),
    factCell("test_price", "Test Price", input.testPrice, "Not yet entered"),
    { key: "target", label: "Target", value: target },
    { key: "max", label: "Max", value: max },
    { key: "spread", label: "Spread", value: spread },
  ];
}

/**
 * Spread status -- B15-26 (INV-134), warnings only.
 *
 * Compares the already-computed Expected Spread @ Test Price against the
 * Standard Minimum Assignment Spread B8-03 already resolved (the same
 * minimum Max Supported Offer is built from). It computes no spread,
 * minimum or offer of its own; its only arithmetic is the difference it
 * shows the operator (the shortfall, or the margin over the minimum).
 * Every status carries text, so the warning never relies on color alone
 * (Walkthrough 2: a below-minimum and a negative spread both rendered as
 * plain white numbers).
 *
 *   negative       spread < 0                  red, explanatory text
 *   below_minimum  0 <= spread < minimum       amber, exact shortfall
 *   meets_minimum  spread >= minimum           positive, margin over it
 *   neutral        either input not calculated no implied success
 */
export type SpreadStatus =
  | { kind: "neutral"; text: string }
  | { kind: "negative"; text: string }
  | { kind: "below_minimum"; text: string; shortfall: number }
  | { kind: "meets_minimum"; text: string };

export function buildSpreadStatus(
  board8: Board8Economics | null,
  expectedSpread: ExpectedSpread | null,
): SpreadStatus {
  if (!board8 || board8.status !== "calculated") {
    return { kind: "neutral", text: "No spread check yet: enter ARV and Repairs to calculate Max." };
  }
  if (!expectedSpread || expectedSpread.status !== "calculated") {
    return { kind: "neutral", text: "No spread check yet: enter a Test Price." };
  }
  // Compared in whole dollars, the precision every figure on this bar is
  // shown at: typing the displayed Max must read as meeting the minimum,
  // never as "$0 short" from a sub-dollar remainder the operator cannot see.
  const spread = Math.round(expectedSpread.expectedSpread);
  const minimum = Math.round(board8.standardMinimumAssignmentSpread);
  if (spread < 0) {
    return {
      kind: "negative",
      text: `Negative spread: this Test Price is ${money(-spread)} above the end buyer's maximum price, `
        + `so there is no assignment spread. The minimum spread is ${money(minimum)}.`,
    };
  }
  if (spread < minimum) {
    const shortfall = minimum - spread;
    return {
      kind: "below_minimum",
      shortfall,
      text: `Below minimum: ${money(shortfall)} short of the ${money(minimum)} minimum spread.`,
    };
  }
  return {
    kind: "meets_minimum",
    text: spread === minimum
      ? `Meets the ${money(minimum)} minimum spread.`
      : `Meets minimum: ${money(spread - minimum)} above the ${money(minimum)} minimum spread.`,
  };
}
