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
  /** `note`: Board 15 / Pass 1 F31 — a short status line under a value (e.g.
   *  that a recorded Current Offer is not a supported offer). */
  | { kind: "value"; text: string; note?: string }
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
/* Board 15 / Pass 1 F36: operator wording, replacing "WAITING on negotiation
   carrier" / "WAITING on negotiation semantics / carrier contract". */
const SELLER_POSITION_WAITING = "Not entered yet";
const CURRENT_OFFER_WAITING = "None recorded";

/**
 * Board 15 / Pass 1 F31 (Jess, 2026-10-04). A Current Offer on file is a
 * RECORDED negotiation fact. It is shown, never erased, and never implied to
 * be supported: the note says whether current underwriting supports a
 * figure at all (Max Supported Offer) and, when it does, states that Max
 * beside it so the operator can compare. Display only.
 *
 * PR #126 re-review (Bones / Jess, 2026-10-05): "Recorded in GHL" applies
 * ONLY to the amount confirmed saved (restored from the GHL carrier, or a
 * save GHL read back). A typed amount not yet saved is a draft; a save in
 * flight says so; a refused or unconfirmed save says it was not saved.
 */
export type CurrentOfferStatus = "recorded" | "draft" | "saving" | "failed" | "unconfirmed" | "unresolved";

/* Second re-review (Bones / Jess, 2026-10-05): a definite refusal (GHL said
   no; nothing was written) is told apart from an uncertain result (the save
   may have landed but could not be read back). */
export const CURRENT_OFFER_STATUS_TEXT: Record<CurrentOfferStatus, string> = {
  recorded: "Recorded in GHL",
  draft: "Draft — not saved yet (saves when you leave the field)",
  saving: "Saving to GHL…",
  failed: "Not saved — nothing was sent to GHL",
  unconfirmed: "Save could not be confirmed — check the deal in GHL",
  /* Fifth re-review (Jess, 2026-10-05): an indeterminate submission -- the
     request may still land -- blocks the deal; nothing more is sent. */
  unresolved: "Unresolved — an earlier save may still reach GHL; check the deal in GHL",
};

export function currentOfferNote(board8: Board8Economics | null, status: CurrentOfferStatus): string {
  const support = board8 && board8.status === "calculated"
    ? `supported Max ${money(board8.maxSupportedOffer)}`
    : "not supported — ARV, repairs or deal economics not established";
  return `${CURRENT_OFFER_STATUS_TEXT[status]} · ${support}`;
}

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

/**
 * Board #15 B15-22 / INV-131 (F42, W2). The deal bar's ARV and Repairs are
 * the figures on file; whether each is APPROVED is already known on this page
 * (repairsSourceIsApprovalGated; the ARV ledger match), and the bar now says
 * so through the existing `note` line. Target and Max are B8-03's live output
 * from those inputs -- working figures, not a recorded offer. Labels
 * (DEAL_BAR_LABELS) and every number are unchanged.
 *
 * Wording reuses the Seller Call provenance cards' own strings.
 */
export type DealBarApprovalState = "approved" | "unverified" | "ledger_mismatch";

export const DEAL_BAR_APPROVAL_NOTE: Record<DealBarApprovalState, string> = {
  approved: "Approved",
  unverified: "On file, not verified as operator-approved",
  ledger_mismatch: "On file — approval ledger does not match this amount",
};
export const DEAL_BAR_ARV_NO_LEDGER_NOTE = "On file, no approval ledger entry found";
export const DEAL_BAR_CALCULATED_NOTE = "Calculated now from these inputs";

export type DealBarInput = {
  arv: number | null;
  repairs: number | null;
  /** B8-08 / INV-51: operator-entered session state, never a GHL carrier. `null` until a human types a value -- IAOS invents neither. */
  sellerPosition: number | null;
  /** The opportunity's Current Offer: restored from its GHL carrier on resume
   *  (current-offer-carrier.ts) or typed by the operator. `null` when none is
   *  recorded -- IAOS invents no opening offer. (Board 15: the old "never a GHL
   *  carrier" note predated the carrier.) */
  currentOffer: number | null;
  /** PR #126 re-review: whether `currentOffer` is the amount confirmed saved
   *  in GHL ("recorded"), an unsaved draft, a save in flight, or a failed
   *  save. Required, so no caller can fall back to "Recorded in GHL". */
  currentOfferStatus: CurrentOfferStatus;
  /** B8-03's own output. Null only before an opportunity is selected. */
  board8: Board8Economics | null;
  /** B8-03's own output, computed with referenceKind "current_offer". Null only before an opportunity is selected. */
  expectedSpread: ExpectedSpread | null;
  /** B15-22: the ARV's approval state ("unverified" = no ledger entry). Omitted: no note (prior behaviour). */
  arvApproval?: DealBarApprovalState;
  /** B15-22: the Repairs' approval state. Omitted: no note (prior behaviour). */
  repairsApproval?: Exclude<DealBarApprovalState, "ledger_mismatch">;
};

function withNote(cell: DealBarCell, note: string | null): DealBarCell {
  return cell.value.kind === "value" && note !== null ? { ...cell, value: { ...cell.value, note } } : cell;
}

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

  const arvNote = input.arvApproval === undefined ? null
    : input.arvApproval === "unverified" ? DEAL_BAR_ARV_NO_LEDGER_NOTE : DEAL_BAR_APPROVAL_NOTE[input.arvApproval];
  const repairsNote = input.repairsApproval === undefined ? null : DEAL_BAR_APPROVAL_NOTE[input.repairsApproval];

  return [
    withNote(factCell("arv", "ARV", input.arv, "Not yet established"), arvNote),
    withNote(factCell("repairs", "Repairs", input.repairs, "Not yet established"), repairsNote),
    factCell("seller_position", "Seller Position", input.sellerPosition, SELLER_POSITION_WAITING),
    (() => {
      const cell = factCell("current_offer", "Current Offer", input.currentOffer, CURRENT_OFFER_WAITING);
      return cell.value.kind === "value"
        ? { ...cell, value: { ...cell.value, note: currentOfferNote(input.board8, input.currentOfferStatus) } }
        : cell;
    })(),
    withNote({ key: "target", label: "Target", value: target }, DEAL_BAR_CALCULATED_NOTE),
    withNote({ key: "max", label: "Max", value: max }, DEAL_BAR_CALCULATED_NOTE),
    { key: "spread", label: "Spread", value: spread },
  ];
}

/** The exact seven labels, in order -- asserted by the deterministic harness. */
export const DEAL_BAR_LABELS: readonly string[] = [
  "ARV", "Repairs", "Seller Position", "Current Offer", "Target", "Max", "Spread",
];
