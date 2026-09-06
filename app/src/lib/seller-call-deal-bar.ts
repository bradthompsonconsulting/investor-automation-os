/**
 * Seller Call Workspace -- persistent deal bar. B8-05 / INV-48, extended
 * by B8-08 / INV-51.
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
 * SELLER POSITION AND CURRENT OFFER, B8-08 / INV-51. B8-02's inventory
 * found neither had an authoritative GHL carrier, and INV-48 built this
 * bar before either was authorized -- both cells were hardcoded to a
 * waiting state regardless of input, per that issue's own explicit
 * "preserve honest waiting/unknown behavior until their later authorized
 * implementation." INV-51 is that later authorization: it names
 * operator-controlled Current Offer and Seller Position as required
 * experience, as OPERATOR-ENTERED SESSION STATE, never a GHL carrier
 * (B8-11/INV-54 owns durable persistence; this module still creates
 * none). `input.sellerPosition` and `input.currentOffer` are therefore
 * `number | null` exactly like `input.arv`/`input.repairs` above --
 * `null` renders the SAME waiting text as before (still copied VERBATIM
 * from `rail.ts`'s own waiting-state strings, so an operator who has seen
 * the Contact Workspace rail before either was wired recognizes it was
 * the same wait, not a paraphrase), and a non-null value renders exactly
 * like any other known fact cell -- no new formatting rule, reusing
 * `factCell` verbatim.
 *
 * SPREAD IS Expected Spread @ Current Offer, EXPLICITLY. This module
 * still performs no spread arithmetic of its own -- it renders whatever
 * `ExpectedSpread` the caller computed via `computeExpectedSpread`. Before
 * INV-51, the caller always passed `referencePrice: null` (Current Offer
 * had no carrier), so Spread always waited; now that Current Offer is
 * real operator input, the caller passes it through and Spread resolves
 * automatically, exactly as this module's prior header predicted: "the
 * label always names its reference price by name, so the moment Current
 * Offer resolves, Spread resolves with it without this module changing."
 * Confirmed true -- this module's Spread-rendering code is unchanged.
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

/**
 * Verbatim from `rail.ts`'s existing waiting strings for the same
 * concepts. Still used, now conditionally: only when the caller has not
 * yet entered a value (see the module header's B8-08/INV-51 note).
 */
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
  /** B8-08 / INV-51: operator-entered session state, never a GHL carrier. `null` until a human types a value -- IAOS invents neither. */
  sellerPosition: number | null;
  /** B8-08 / INV-51: operator-entered session state, never a GHL carrier. `null` until a human types a value -- IAOS invents no opening offer. */
  currentOffer: number | null;
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
    factCell("seller_position", "Seller Position", input.sellerPosition, SELLER_POSITION_WAITING),
    factCell("current_offer", "Current Offer", input.currentOffer, CURRENT_OFFER_WAITING),
    { key: "target", label: "Target", value: target },
    { key: "max", label: "Max", value: max },
    { key: "spread", label: "Spread", value: spread },
  ];
}

/** The exact seven labels, in order -- asserted by the deterministic harness. */
export const DEAL_BAR_LABELS: readonly string[] = [
  "ARV", "Repairs", "Seller Position", "Current Offer", "Target", "Max", "Spread",
];
