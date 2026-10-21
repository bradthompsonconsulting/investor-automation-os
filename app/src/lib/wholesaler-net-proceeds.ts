/**
 * Wholesaler net proceeds -- B15-26 (INV-134), first slice. Brad approved
 * 2026-10-19 (proposal: IAOS_B15-26_NET_PROCEEDS_PROPOSAL_2026-10-19.md).
 *
 * Pure. No I/O, no React, no GHL. Deal Calculator only; every input is
 * temporary scratchpad state.
 *
 * THREE QUANTITIES, KEPT APART.
 *   End-buyer costs      repairs, selling, purchase/closing, holding,
 *                        required buyer profit, financing -- used ONLY by
 *                        compute.ts to price End-Buyer Maximum Purchase
 *                        Price. Never read or deducted here.
 *   Gross spread         the existing Expected Spread @ Test Price
 *                        (board8-economics.ts), read as given.
 *   Wholesaler costs     the operator's own transaction costs, entered here.
 *
 *   Estimated net at modeled buyer price = gross spread - wholesaler costs
 *
 * NO SILENT ZERO. Every cost line shown for the chosen transaction type is
 * Unknown until the operator enters an amount (a typed 0 is an amount) or
 * marks it Not applicable. Any Unknown line, no chosen transaction type, or
 * no gross spread means no net estimate; the gross spread stays visible on
 * its own. There is no default reserve and no default transaction type.
 *
 * SWITCHING TYPES. Entries are kept per line, so switching back restores
 * them, but only the chosen type's lines count toward the net.
 *
 * EARNEST MONEY is not a cost line and never enters the net: it is normally
 * credited at closing, and it can be lost if the contract is not closed as
 * agreed. It is described, never deducted.
 *
 * Informational only: nothing here gates an offer, a status or a save, and
 * the underwriting formula, Target, Max and spread status are untouched.
 */

import type { ExpectedSpread } from "./underwriting/board8-economics";
import { PROVISIONAL_NET_LABEL, provisionalSupportText, type RepairCompleteness } from "./provisional-repairs";

export type TransactionType = "assignment" | "double_close";

export type WholesalerCostKey =
  | "purchase_closing"
  | "resale_closing"
  | "transactional_funding"
  | "assignment_title_fee"
  | "legal"
  | "jv_share"
  | "marketing";

export type CostEntry =
  | { kind: "unknown" }
  | { kind: "not_applicable" }
  | { kind: "amount"; amount: number };

export type CostLine = { key: WholesalerCostKey; label: string };

/** One cost line's raw panel input. */
export type CostLineInput = { notApplicable: boolean; raw: string };

type AmountParse = { kind: "empty" } | { kind: "invalid" } | { kind: "value"; value: number };

/**
 * B15-26 F1 (Bones, 2026-10-19): an entered amount must contain a digit.
 * The shared Deal Calculator parser strips "$" and "," before Number(), so
 * "$", "," or "$, " would read as $0 and quietly complete the net. Here they
 * stay Unknown. The shared parser itself is unchanged (it has other callers).
 */
export function hasAmountDigit(raw: string): boolean {
  return /\d/.test(raw);
}

/** The panel's conversion of a line's input into a cost entry; the parser is the page's own, passed in. */
export function costEntryFromInput(input: CostLineInput | undefined, parse: (raw: string) => AmountParse): CostEntry {
  if (!input) return { kind: "unknown" };
  if (input.notApplicable) return { kind: "not_applicable" };
  if (!hasAmountDigit(input.raw)) return { kind: "unknown" };
  const parsed = parse(input.raw);
  return parsed.kind === "value" ? { kind: "amount", amount: parsed.value } : { kind: "unknown" };
}

const LEGAL: CostLine = { key: "legal", label: "Legal / attorney review" };
const JV: CostLine = { key: "jv_share", label: "JV / partner share ($)" };
const MARKETING: CostLine = { key: "marketing", label: "Marketing allocation ($)" };

/** The wholesaler cost lines each transaction type shows, in display order. */
export const COST_LINES: Record<TransactionType, readonly CostLine[]> = {
  assignment: [
    { key: "assignment_title_fee", label: "Title / escrow assignment fee" },
    LEGAL, JV, MARKETING,
  ],
  double_close: [
    { key: "purchase_closing", label: "Your closing costs: buying from the seller" },
    { key: "resale_closing", label: "Your closing costs: selling to the end buyer" },
    { key: "transactional_funding", label: "Transactional funding fee" },
    LEGAL, JV, MARKETING,
  ],
};

export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  assignment: "Assignment",
  double_close: "Double close",
};

export const NET_RESULT_LABEL = "Estimated net at modeled buyer price";

export type NetProceeds =
  | { kind: "no_type" }
  | { kind: "no_gross" }
  | { kind: "unknown"; unknown: string[] }
  | { kind: "estimated"; grossSpread: number; totalCosts: number; net: number };

export function computeNetProceeds(args: {
  type: TransactionType | null;
  entries: Partial<Record<WholesalerCostKey, CostEntry>>;
  grossSpread: ExpectedSpread;
}): NetProceeds {
  if (args.type === null) return { kind: "no_type" };
  if (args.grossSpread.status !== "calculated") return { kind: "no_gross" };

  const unknown: string[] = [];
  let totalCosts = 0;
  for (const line of COST_LINES[args.type]) {
    const entry = args.entries[line.key] ?? { kind: "unknown" };
    if (entry.kind === "unknown") unknown.push(line.label);
    else if (entry.kind === "amount") {
      if (!Number.isFinite(entry.amount) || entry.amount < 0) throw new RangeError(`${line.key}: ${entry.amount} is not a non-negative finite amount`);
      totalCosts += entry.amount;
    }
  }
  if (unknown.length > 0) return { kind: "unknown", unknown };

  const grossSpread = args.grossSpread.expectedSpread;
  return { kind: "estimated", grossSpread, totalCosts, net: grossSpread - totalCosts };
}

/** The one-line status the panel shows. Text always, never color alone. */
/** The result's accessible name: provisional only when there is an estimated net resting on incomplete repairs. */
export function netResultLabel(result: NetProceeds, repairs: RepairCompleteness | null = null): string {
  return result.kind === "estimated" && repairs?.incomplete ? PROVISIONAL_NET_LABEL : NET_RESULT_LABEL;
}

/* Incomplete repairs (Jess ruling 2026-10-21, B15-26 with B15-01): an
   estimated net built on a known-repairs-only spread is labelled
   "Provisional estimated net" and says so; the amounts are unchanged. Every
   not-estimated result (no type, no gross, Unknown costs) reads exactly as
   before -- the provisional label never stands in for an Unknown. */
export function netProceedsText(result: NetProceeds, money: (n: number) => string, repairs: RepairCompleteness | null = null): string {
  if (result.kind === "estimated" && repairs?.incomplete) {
    return `${PROVISIONAL_NET_LABEL}: ${money(result.net)}${result.net < 0 ? " (below zero)" : ""} = provisional gross spread ${money(result.grossSpread)} - your costs ${money(result.totalCosts)}. `
      + provisionalSupportText(money(repairs.knownRepairs));
  }
  switch (result.kind) {
    case "no_type":
      return "Net not estimated: choose Assignment or Double close.";
    case "no_gross":
      return "Net not estimated: the gross spread is not available yet (see Spread above).";
    case "unknown":
      return `Net not estimated. Unknown: ${result.unknown.join(", ")}.`;
    case "estimated":
      return `${NET_RESULT_LABEL}: ${money(result.net)}${result.net < 0 ? " (below zero)" : ""} = gross spread ${money(result.grossSpread)} - your costs ${money(result.totalCosts)}.`;
  }
}

export const EARNEST_MONEY_NOTE =
  "Not counted as a cost: earnest money is normally credited at closing. It can be lost if the contract is not closed as agreed.";
