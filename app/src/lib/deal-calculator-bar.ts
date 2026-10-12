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
import type { AssignmentModeName } from "./underwriting/resolver-types";

export type DealCalcBarCellValue =
  | { kind: "value"; text: string }
  | { kind: "waiting"; text: string };

export type DealCalcBarCell = {
  key: string;
  label: string;
  value: DealCalcBarCellValue;
};

/**
 * The one whole-dollar display rule for every amount this bar shows -- the
 * cells AND the spread status text -- so a cell and its explanation can
 * never disagree. Halves round away from zero; an amount that rounds to $0
 * shows "$0", never "-$0". Display only: statuses classify on exact values.
 */
export function formatWholeDollars(n: number): string {
  const whole = Math.round(Math.abs(n));
  return (n < 0 && whole > 0 ? "-$" : "$") + whole.toLocaleString("en-US");
}

const money = formatWholeDollars;

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
 * Checks the already-computed Expected Spread @ Test Price against two
 * requirements the shared engine already resolved, and computes neither:
 *
 *   standard minimum   B8-03's Standard Minimum Assignment Spread (the
 *                      value Max Supported Offer is built from)
 *   active mode spread the selected assignment mode's own required spread,
 *                      the engine's resolved `figures.assignmentSpread`
 *                      (Standard Minimum, 25% of Buyer Profit, or Manual)
 *
 * Jess ruling, 2026-10-07: green only when BOTH are met; otherwise name
 * each requirement missed and its shortfall. Classification uses exact,
 * unrounded values; only displayed amounts are rounded, all through
 * formatWholeDollars. A difference under $1 reads "less than $1" (Jess,
 * 2026-10-07), never "$0".
 * Every status carries text, so color is never the only signal.
 *
 *   negative  spread < 0                       red
 *   short     0 <= spread, a requirement missed amber, each shortfall named
 *   meets     both requirements met            green, says it is not a
 *                                               net-profit check
 *   neutral   any input not calculated         no implied success; names
 *                                               the input(s) actually missing
 */
export type SpreadRequirement = "standard_minimum" | "assignment_mode";

export type SpreadShortfall = {
  requirement: SpreadRequirement;
  required: number;
  /** Exact, unrounded. */
  shortfall: number;
};

export type SpreadStatus =
  | { kind: "neutral"; text: string }
  | { kind: "negative"; text: string }
  | { kind: "short"; text: string; shortfalls: SpreadShortfall[] }
  | { kind: "meets"; text: string };

/** The active assignment mode and its resolved required spread (`figures.assignmentSpread`). */
export type ActiveSpreadRequirement = { mode: AssignmentModeName; requiredSpread: number };

/** What a green status does not claim -- stated on every green status. */
export const MEETS_SCOPE_NOTE = "This is not a net-profit check.";

/** Mirrors the Deal Calculator's own Assignment Mode button labels. */
const MODE_SPREAD_LABEL: Record<AssignmentModeName, string> = {
  standard: "Standard Minimum",
  profit_share: "25% of Buyer Profit",
  manual: "Manual",
};

/**
 * Operator names for the inputs the shared engine reports missing
 * (`UnderwritingResult.missing`) that the operator types on this page.
 * "assignmentMode" is reported when the selected mode cannot resolve, which
 * on this page happens only for Manual with no usable amount -- so it is
 * named that way only when Manual is the selected mode. $0 is an amount
 * (the engine resolves it), so it is never reported here.
 */
function missingInputLabel(name: string, selectedMode: AssignmentModeName | null): string | null {
  if (name === "arv") return "ARV";
  if (name === "repairs") return "Repairs";
  if (name === "assignmentMode" && selectedMode === "manual") return "the Manual assignment amount";
  return null;
}

/** "A", "A and B", "A, B and C". */
function listText(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The neutral text when Max cannot be calculated: the missing inputs by
 * name, or -- if the engine reports anything this page cannot name -- a
 * statement that does not guess which.
 */
function missingInputsText(board8: Board8Economics | null, selectedMode: AssignmentModeName | null): string {
  const missing = board8 && board8.status === "unavailable" && "missing" in board8 ? board8.missing : [];
  const labels = missing.map((m) => missingInputLabel(m, selectedMode));
  if (labels.length === 0 || labels.some((l) => l === null)) {
    return "No spread check yet: Max can't be calculated from the current inputs.";
  }
  return `No spread check yet: enter ${listText(labels as string[])}.`;
}

/** A positive difference as displayed: whole dollars, or "less than $1" when it is under $1. */
function differenceText(n: number): string {
  return n < 1 ? "less than $1" : money(n);
}

export function buildSpreadStatus(
  board8: Board8Economics | null,
  expectedSpread: ExpectedSpread | null,
  active: ActiveSpreadRequirement | null,
  /** The page's selected assignment mode, known even when the engine has not resolved. */
  selectedMode: AssignmentModeName | null = null,
): SpreadStatus {
  if (!board8 || board8.status !== "calculated" || !active) {
    return { kind: "neutral", text: missingInputsText(board8, selectedMode) };
  }
  if (!expectedSpread || expectedSpread.status !== "calculated") {
    return { kind: "neutral", text: "No spread check yet: enter a Test Price." };
  }
  const spread = expectedSpread.expectedSpread;
  const minimum = board8.standardMinimumAssignmentSpread;
  const modeLabel = MODE_SPREAD_LABEL[active.mode];
  const standardText = `the ${money(minimum)} standard minimum`;
  // In Standard Minimum mode the two requirements are the same number; the
  // mode spread is then not stated or checked a second time.
  const sameRequirement = active.requiredSpread === minimum;
  const modeText = `the ${modeLabel} spread (${money(active.requiredSpread)})`;

  if (spread < 0) {
    return {
      kind: "negative",
      text: `Negative spread: this Test Price is ${differenceText(-spread)} above the end buyer's maximum price, `
        + `so there is no assignment spread. Required: ${standardText}`
        + (sameRequirement ? "." : ` and ${modeText}.`),
    };
  }

  const shortfalls: SpreadShortfall[] = [];
  if (spread < minimum) {
    shortfalls.push({ requirement: "standard_minimum", required: minimum, shortfall: minimum - spread });
  }
  if (!sameRequirement && spread < active.requiredSpread) {
    shortfalls.push({ requirement: "assignment_mode", required: active.requiredSpread, shortfall: active.requiredSpread - spread });
  }

  if (shortfalls.length > 0) {
    const missed = shortfalls.map((f) => {
      const requirement = f.requirement === "standard_minimum" ? standardText : modeText;
      return f.shortfall < 1 ? `less than $1 below ${requirement}` : `${money(f.shortfall)} short of ${requirement}`;
    });
    const met: string[] = [];
    if (spread >= minimum) met.push(`Meets ${standardText}`);
    if (!sameRequirement && spread >= active.requiredSpread) met.push(`Meets ${modeText}`);
    const sentence = missed.join("; ");
    return {
      kind: "short",
      shortfalls,
      text: met.length > 0
        ? `${met.join("; ")}, but ${sentence}.`
        : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`,
    };
  }

  const highest = active.requiredSpread > minimum ? active.requiredSpread : minimum;
  const margin = spread - highest;
  const metText = sameRequirement ? `Meets ${standardText}` : `Meets ${standardText} and ${modeText}`;
  return {
    kind: "meets",
    text: (margin < 1 ? `${metText}.` : `${metText}, ${money(margin)} above.`) + ` ${MEETS_SCOPE_NOTE}`,
  };
}
