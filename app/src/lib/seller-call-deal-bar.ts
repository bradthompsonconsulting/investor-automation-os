/**
 * Seller Call Workspace -- persistent deal bar. B8-05 / INV-48.
 *
 * Pure. No I/O, no React, no GHL, no fetch. Extracted from the page
 * component for the same reason `rail.ts` and `view-model.ts` were: a
 * page cannot be exhausted by an offline test, but a pure function can.
 *
 * CONSUMES, NEVER RECOMPUTES. This module takes an already-computed
 * `Board8Economics` (B8-03) and `ExpectedSpread` (B8-03) and formats them
 * for display. It contains no waterfall arithmetic, no
 * `max(25% of profit, $5,000)`, no `endBuyerMaxPrice - referencePrice` --
 * every number on the bar is read off an object `board8-economics.ts`
 * already produced.
 *
 * EXACT ORDER AND LABELS, per INV-44/INV-48:
 *
 *     ARV | Repairs | Seller Position | Current Offer | Target | Max | Spread
 *
 * SELLER POSITION AND CURRENT OFFER ALWAYS WAIT. Per B8-02's inventory,
 * neither has an authoritative carrier, and INV-48 is explicit: do not
 * invent one, and do not invent a fake or ephemeral stand-in value either
 * -- "preserve honest waiting/unknown behavior until their later
 * authorized implementation." These two cells are therefore hardcoded to
 * a waiting state regardless of any other input. When a future issue
 * authorizes a carrier for either, this is the one place that changes.
 *
 * The waiting text for both is copied VERBATIM from `rail.ts`'s own
 * waiting-state strings for the same two negotiation-state concepts
 * (`Current Seller Position` and `Current Investor Offer`), so an
 * operator who has seen the Contact Workspace rail recognizes the same
 * words here rather than a paraphrase that might imply a different cause.
 *
 * SPREAD IS Expected Spread @ Current Offer, EXPLICITLY. Because Current
 * Offer always waits in this build, Spread always waits too -- but the
 * label always names its reference price by name, so the moment Current
 * Offer resolves, Spread resolves with it without this module changing.
 */

import type { Board8Economics, ExpectedSpread } from "./underwriting/board8-economics";

export type DealBarCellValue =
  | { kind: "value"; text: string }
  | { kind: "waiting"; text: string };

export type DealBarCell = {
  key: string;
  label: string;
  value: DealBarCellValue;
};

/** Verbatim from `rail.ts`'s existing waiting strings for the same concepts. */
const SELLER_POSITION_WAITING = "WAITING on negotiation carrier";
const CURRENT_OFFER_WAITING = "WAITING on negotiation semantics / carrier contract";

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function factCell(key: string, label: string, value: number | null, waitingText: string): DealBarCell {
  return {
    key,
    label,
    value: value === null ? { kind: "waiting", text: waitingText } : { kind: "value", text: money(value) },
  };
}

export type DealBarInput = {
  arv: number | null;
  repairs: number | null;
  /** B8-03's own output. Null only before an opportunity is selected. */
  board8: Board8Economics | null;
  /** B8-03's own output, computed with referenceKind "current_offer". Null only before an opportunity is selected. */
  expectedSpread: ExpectedSpread | null;
};

/**
 * Builds the seven deal-bar cells, in the exact required order. Every
 * value is read from an already-computed B8-03 result; nothing here
 * recomputes Target, Max, or Spread.
 */
export function buildDealBarCells(input: DealBarInput): DealBarCell[] {
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
    factCell("arv", "ARV", input.arv, "Not yet established"),
    factCell("repairs", "Repairs", input.repairs, "Not yet established"),
    { key: "seller_position", label: "Seller Position", value: { kind: "waiting", text: SELLER_POSITION_WAITING } },
    { key: "current_offer", label: "Current Offer", value: { kind: "waiting", text: CURRENT_OFFER_WAITING } },
    { key: "target", label: "Target", value: target },
    { key: "max", label: "Max", value: max },
    { key: "spread", label: "Spread", value: spread },
  ];
}

/** The exact seven labels, in order -- asserted by the deterministic harness. */
export const DEAL_BAR_LABELS: readonly string[] = [
  "ARV", "Repairs", "Seller Position", "Current Offer", "Target", "Max", "Spread",
];
