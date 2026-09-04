/**
 * Repair Estimation V1 — the operator model. INV-14 remediation.
 *
 * Brad completed the V1 operator review and approved the defaults and
 * behaviour below on 2026-09-04. This module holds ONLY that: the approved
 * DFW policy defaults, the untouched-estimator fallback, and the pure rules
 * that turn an operator's answers into calculation-core input.
 *
 * ⚠ THIS IS NOT THE CANONICAL REFERENCE TABLE, AND IT DELIBERATELY DOES NOT
 * EDIT IT. `reference.ts` still carries the table transcribed from the
 * governing 2026-09-02 amendment, and the calculation core is untouched. The
 * approved operator defaults DIVERGE from that table in four places — HVAC
 * severe ($6,500 BOOK -> $8,000 policy), the electrical panel ($2,500 BOOK ->
 * $1,500 / $3,000), an entirely new Repair tier, and a Windows row the table
 * does not carry. Reconciling the canonical document with these approved
 * values is a Product Owner amendment, reported rather than performed here.
 *
 * ⚠ PROVENANCE. These are BRAD-APPROVED POLICY defaults, NOT cost-book
 * prices, and they are carried as `IAOS_POLICY` so no policy amount is ever
 * presented as a cost-book fact. They are applied unconditionally to every
 * estimate — no geography, ZIP, city or market is read to select them, which
 * the amendment's "geography is not a V1 pricing input" rule forbids.
 *
 * No persistence, no GHL identifier, no write, no React, no network, and no
 * offer or MAO economics.
 */

import type {
  MajorSystem,
  Provenance,
  RepairEstimate,
  RepairLineInput,
} from "./types";

/**
 * The operator's answer vocabulary.
 *
 * `Unknown` was REMOVED at the 2026-09-04 review. `not_asked` is the neutral
 * unanswered state and is not an alarm by itself. `severe` is the
 * higher-severity state, whose operator-facing label differs per system —
 * Replace, Major or Material issue — without inventing extra states.
 */
export type OperatorCondition = "not_asked" | "good" | "repair" | "severe";

export interface OperatorRow {
  readonly system: MajorSystem;
  readonly label: string;
  /** Approved default loaded when the operator selects Repair. */
  readonly repairDefault: number;
  /** Approved default loaded when the operator selects the severe state. */
  readonly severeDefault: number;
  readonly severeLabel: string;
  /** Shown beside the row when the approved default needs a unit stated. */
  readonly note?: string;
}

/** BRAD-APPROVED IAOS POLICY defaults, 2026-09-04. Not cost-book values. */
export const OPERATOR_ROWS: readonly OperatorRow[] = [
  { system: "roof", label: "Roof", repairDefault: 2500, severeDefault: 15000, severeLabel: "Replace" },
  { system: "hvac", label: "HVAC", repairDefault: 2500, severeDefault: 8000, severeLabel: "Replace" },
  { system: "electrical_whole_house", label: "Electrical — whole house", repairDefault: 3500, severeDefault: 12500, severeLabel: "Replace" },
  { system: "electrical_panel", label: "Electrical panel", repairDefault: 1500, severeDefault: 3000, severeLabel: "Replace" },
  { system: "plumbing_sewer", label: "Plumbing / sewer", repairDefault: 3500, severeDefault: 12500, severeLabel: "Major" },
  { system: "foundation", label: "Foundation", repairDefault: 5000, severeDefault: 15000, severeLabel: "Material issue" },
  {
    system: "windows", label: "Windows", repairDefault: 750, severeDefault: 750,
    severeLabel: "Replace",
    /* The approved value is per window, and V1 has no window-count input. The
       field loads one window's cost and the operator enters the real total —
       the same manual-override path every other row uses. No quantity field
       is invented to carry it. */
    note: "$750 per window — enter the total",
  },
];

/**
 * The untouched-estimator fallback.
 *
 * Applies ONLY when the operator has not interacted with the estimator at
 * all. The moment anything is answered or typed it is removed completely: it
 * is never added to row amounts, because a fallback that survives alongside
 * real answers double-counts the same repairs.
 */
export const UNTOUCHED_FALLBACK_AMOUNT = 20000;
export const UNTOUCHED_FALLBACK_LABEL =
  "IAOS DFW policy fallback — estimator not used";

/**
 * Operator-facing provenance names, per the 2026-09-04 amendment.
 *
 * `IAOS DFW POLICY` is the operator-facing NAME of the approved policy class,
 * carried internally as the existing `IAOS_POLICY` provenance so the type
 * contract and the calculation core are unchanged. It is a name, not a pricing
 * input: no location is read to select these amounts and none may be added.
 *
 * BOOK keeps its own name. A policy amount must never read as a cost-book
 * fact, and a manual amount must never read as either.
 */
export const OPERATOR_PROVENANCE_LABEL: Record<Provenance, string> = {
  BOOK: "BOOK",
  IAOS_POLICY: "IAOS DFW POLICY",
  MANUAL: "MANUAL",
};

/** One row's operator state. `dirty` means the amount was typed, not loaded. */
export interface RowAnswer {
  condition: OperatorCondition;
  /** Raw field text. Blank is blank; it never becomes zero on its own. */
  amount: string;
  dirty: boolean;
}

export type Answers = Record<string, RowAnswer>;

export const EMPTY_ANSWER: RowAnswer = { condition: "not_asked", amount: "", dirty: false };

export type ParsedAmount =
  | { kind: "blank" }
  | { kind: "invalid" }
  | { kind: "value"; value: number };

/**
 * A typed known amount, or the reason it is not one. Blank and invalid stay
 * apart: blank means nothing was entered, invalid means something was entered
 * that is not a dollar figure. Neither silently becomes zero.
 */
export function parseKnownAmount(raw: string): ParsedAmount {
  const t = raw.trim();
  if (t === "") return { kind: "blank" };
  const n = Number(t.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return { kind: "invalid" };
  return { kind: "value", value: n };
}

/**
 * The amount a condition loads into the Known Amount field.
 *
 * Selecting or changing a condition RESETS the field to this value, including
 * over a manual override — re-entering the override afterwards is deliberate
 * and is the operator's to redo. `not_asked` loads nothing at all.
 */
export function defaultAmountFor(row: OperatorRow, condition: OperatorCondition): string {
  if (condition === "not_asked") return "";
  if (condition === "good") return "0";
  return String(condition === "repair" ? row.repairDefault : row.severeDefault);
}

/**
 * Selecting or changing a condition. The Known Amount is RESET to the newly
 * selected condition's approved default and stops being an override — a
 * previous manual figure does not survive a condition change, and getting it
 * back is a deliberate re-entry.
 */
export function applyCondition(row: OperatorRow, condition: OperatorCondition): RowAnswer {
  return { condition, amount: defaultAmountFor(row, condition), dirty: false };
}

/** Typing in the Known Amount field. Marks the amount as the operator's. */
export function applyAmount(answer: RowAnswer, raw: string): RowAnswer {
  return { condition: answer.condition, amount: raw, dirty: true };
}

/** True while the operator has not touched the estimator in any way. */
export function isUntouched(answers: Answers): boolean {
  for (const row of OPERATOR_ROWS) {
    const a = answers[row.system];
    if (a === undefined) continue;
    if (a.condition !== "not_asked" || a.amount !== "" || a.dirty) return false;
  }
  return true;
}

/**
 * The operator's answers as calculation-core input.
 *
 * The rule the review settled: THE DOLLAR AMOUNT IN THE FIELD IS THE AMOUNT
 * USED. A known amount is honoured whatever the condition says, including on
 * a row that was never asked. A row is an unpriced risk only when it has no
 * usable amount — nothing is ever invented to fill one in.
 */
export function buildLines(answers: Answers): RepairLineInput[] {
  const lines: RepairLineInput[] = [];
  for (const row of OPERATOR_ROWS) {
    const a = answers[row.system] ?? EMPTY_ANSWER;
    const parsed = parseKnownAmount(a.amount);
    const base = { id: row.system, label: row.label, component: "major_system" as const };

    if (parsed.kind === "invalid") {
      lines.push({ ...base, pricing: { kind: "unpriced_risk", reason: "the known amount entered is not a valid dollar figure" } });
      continue;
    }

    if (parsed.kind === "blank") {
      /* Not asked and nothing entered is the review's definition of an
         unpriced risk. A condition that was answered and then had its amount
         cleared is not a case the approved rules name; it is treated the same
         way, because the alternative is inventing a number for it. */
      lines.push({
        ...base,
        pricing: {
          kind: "unpriced_risk",
          reason: a.condition === "not_asked"
            ? "not asked, and no known amount entered"
            : "the known amount was cleared",
        },
      });
      continue;
    }

    /* $0 is a real answer -- the condition requires no repair allowance --
       and is kept distinct from an absent price. */
    if (parsed.value === 0) {
      lines.push({ ...base, pricing: { kind: "no_repair" } });
      continue;
    }

    /* A loaded approved default is IAOS policy. A typed amount is the
       operator's, and must never be presented as policy or as cost book. */
    const provenance: Provenance = a.dirty ? "MANUAL" : "IAOS_POLICY";
    lines.push({ ...base, pricing: { kind: "amount", amount: parsed.value, provenance } });
  }
  return lines;
}

/**
 * What the operator surface should show.
 *
 * `fallback` and `rows` are mutually exclusive by construction — there is no
 * expression anywhere in this module that adds the fallback to a row amount.
 */
export type OperatorEstimate =
  | { mode: "fallback"; total: number; label: string; provenance: Provenance }
  | { mode: "rows"; estimate: RepairEstimate; total: number };

/**
 * The conservative allowance for a row-mode estimate: the resolved
 * components plus the inherited FMTM allowance.
 */
export function rowsTotal(estimate: RepairEstimate): number {
  return estimate.resolvedSubtotal + estimate.components.fmtmAllowance.outcome.amount;
}

/**
 * Resolve the operator's answers, applying the untouched fallback only when
 * the estimator has not been used at all.
 *
 * `compute` is injected rather than imported so this stays a pure decision
 * about WHICH result applies, testable without the core, and so the core
 * keeps exactly one caller shape.
 */
export function operatorEstimate(
  answers: Answers,
  compute: (lines: RepairLineInput[]) => RepairEstimate,
): OperatorEstimate {
  if (isUntouched(answers)) {
    return {
      mode: "fallback",
      total: UNTOUCHED_FALLBACK_AMOUNT,
      label: UNTOUCHED_FALLBACK_LABEL,
      provenance: "IAOS_POLICY",
    };
  }
  const estimate = compute(buildLines(answers));
  return { mode: "rows", estimate, total: rowsTotal(estimate) };
}
