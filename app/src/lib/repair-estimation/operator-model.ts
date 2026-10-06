/**
 * Repair Estimation V1 — the operator model. INV-14 remediation.
 *
 * Brad completed the V1 operator review and approved the defaults and
 * behaviour below on 2026-09-04. This module holds ONLY that: the approved
 * DFW policy defaults, the unanswered-row allowance rule (2026-10-04; the
 * untouched-estimator fallback it replaced is retired), and the pure rules
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

import approvedTable from "../../data/approved_repair_table.json";
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

/**
 * BRAD-APPROVED IAOS DFW POLICY defaults. Not cost-book values.
 *
 * ⚠ THE VALUES ARE NOT AUTHORED HERE. They are read from the approved repair
 * table at `app/src/data/approved_repair_table.json`, which is the single
 * source of truth for what the calculator loads
 * (`docs/REPAIR_TABLE_MAINTENANCE_V1.md`). This module holds the behaviour and
 * none of the numbers, so changing an approved value is a one-line edit to a
 * data file rather than a code change in three places.
 *
 * The windows row's `note` carries its per-window unit: the approved value is
 * per window, and B6-F1 (INV-43) gives that row the quantity input the
 * 2026-09-04 amendment withheld. The RATE still comes from this table and
 * nowhere else -- see `QUANTITY_ROWS` below, which holds the fact that the row
 * is counted and no second copy of what a window costs.
 *
 * The cast is required because JSON import widens `system` and `severeLabel`
 * to `string`. It is not taken on trust: the harness asserts the file's seven
 * systems, their labels and all fourteen values against the canonical
 * amendment, so a typo here fails the build's tests rather than reaching an
 * operator.
 */
export const OPERATOR_ROWS: readonly OperatorRow[] =
  approvedTable.rows as readonly OperatorRow[];

/**
 * Rows whose approved amount is a rate per counted unit rather than a lump
 * sum, and the operator-facing name of the thing being counted.
 *
 * B6-F1 (INV-43), authorized by the `Windows quantity input` amendment dated
 * 2026-09-04 in `docs/ESTIMATED_REPAIRS_STANDARD.md`, which supersedes that
 * document's earlier "No quantity input is authorized" sentence.
 *
 * ⚠ THIS HOLDS NO RATE. The per-unit amount is whatever the approved table
 * already carries for the SELECTED condition -- `repairDefault` for Repair,
 * `severeDefault` for the severe state. There is deliberately no second copy
 * of $750 anywhere in this repository: the two happen to be equal in DFW V1,
 * and an implementation that assumed they always would be is exactly what the
 * B6-F1 contract forbids.
 *
 * Windows is the only counted row. Adding another is a Product Owner decision
 * about that row's approved value, not a code convenience.
 */
export interface QuantitySpec {
  /** The operator-facing field label, e.g. `# windows`. */
  readonly label: string;
  /** What one unit is, for the row's own explanatory note. */
  readonly unit: string;
}

export const QUANTITY_ROWS: Readonly<Record<string, QuantitySpec>> = {
  windows: { label: "# windows", unit: "window" },
};

/** The row's quantity capability, or `undefined` for an ordinary lump-sum row. */
export function quantitySpecFor(row: OperatorRow): QuantitySpec | undefined {
  return QUANTITY_ROWS[row.system];
}

/**
 * Itemized unanswered allowances — Brad, 2026-10-04
 * (`docs/ESTIMATED_REPAIRS_STANDARD.md`, "Itemized unanswered allowances
 * amendment"). It RETIRES the $20,000 untouched-estimator fallback that used to
 * live here: there is no blanket figure any more, so nothing can be added on
 * top of the rows.
 *
 * An unanswered row (`Not asked`, blank Known Amount) carries its OWN approved
 * severe-state amount — `severeDefault` from the approved table, no new
 * number — as a "condition not confirmed" allowance. It reaches the calculation
 * core as an `unknown_condition` reserve, which the core already totals apart
 * from indicated repairs: that is the Unanswered Allowances subtotal.
 *
 * A COUNTED row has no allowance while its count is unknown. Its approved
 * amount is per unit, and pricing an unanswered count would mean assuming one
 * (rule 6: no quantity assumptions; flag an unresolved unit basis). It stays
 * visibly unresolved and out of the total.
 */
export const UNANSWERED_ALLOWANCE_LABEL = "condition not confirmed";

/** The allowance an unanswered row carries, or null where its unit basis is unresolved. */
export function unansweredAllowanceFor(row: OperatorRow): number | null {
  return quantitySpecFor(row) === undefined ? row.severeDefault : null;
}

/**
 * "Miscellaneous / Other repairs" (rule 5): a description and a non-negative
 * amount Brad enters himself, blank by default, sitting below every table row.
 * It holds no default and loads nothing. An entered amount is MANUAL and is
 * counted once; a blank amount adds nothing.
 */
export const MISC_ROW_LABEL = "Miscellaneous / Other repairs";
export const MISC_LINE_ID = "misc";
export interface MiscAnswer {
  description: string;
  /** Raw field text. Blank adds nothing; it never becomes zero on its own. */
  amount: string;
}
export const EMPTY_MISC: MiscAnswer = { description: "", amount: "" };

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
  /**
   * Raw quantity text, on a counted row only. Blank on every other row and
   * never read there. Blank does NOT mean zero — see `amountForQuantity`.
   */
  quantity: string;
  dirty: boolean;
}

export type Answers = Record<string, RowAnswer>;

export const EMPTY_ANSWER: RowAnswer = {
  condition: "not_asked", amount: "", quantity: "", dirty: false,
};

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
 *
 * On a counted row this is the ONE-unit amount, and `amountForQuantity` is
 * what the surface actually loads. The two agree while no quantity is stated,
 * which is exactly the pre-B6-F1 behaviour of that row.
 */
export function defaultAmountFor(row: OperatorRow, condition: OperatorCondition): string {
  if (condition === "not_asked") return "";
  if (condition === "good") return "0";
  return String(condition === "repair" ? row.repairDefault : row.severeDefault);
}

export type ParsedQuantity =
  | { kind: "blank" }
  | { kind: "invalid" }
  | { kind: "value"; value: number };

/**
 * A stated count, or the reason it is not one. A count is a whole number of
 * things and cannot be negative or fractional; anything else is `invalid` and
 * is never rounded into a number nobody typed. Blank and invalid stay apart
 * for the same reason they do on the amount field.
 */
export function parseQuantity(raw: string): ParsedQuantity {
  const t = raw.trim();
  if (t === "") return { kind: "blank" };
  if (!/^[0-9]+$/.test(t)) return { kind: "invalid" };
  const n = Number(t);
  if (!Number.isFinite(n)) return { kind: "invalid" };
  return { kind: "value", value: n };
}

/**
 * The approved per-unit rate for a condition, or null where the condition
 * declares no repair amount at all.
 *
 * IT READS THE SELECTED CONDITION'S APPROVED VALUE, never a rate of its own.
 * Repair and the severe state are separately approved amounts that happen to
 * be equal for windows in DFW V1; nothing here assumes they stay equal, and
 * changing either one in the approved table changes what a quantity
 * multiplies.
 */
export function unitRateFor(row: OperatorRow, condition: OperatorCondition): number | null {
  if (condition === "not_asked") return null;
  if (condition === "good") return 0;
  return condition === "repair" ? row.repairDefault : row.severeDefault;
}

/**
 * What a counted row loads into Known Amount for a condition and a quantity.
 *
 *   not_asked  -> blank, and the quantity is not read. Neutral: the row
 *                 creates no repair charge (B6-F1 item 7).
 *   good       -> "0", and the quantity is not read (B6-F1 item 6).
 *   repair     -> quantity x the approved Repair rate.
 *   severe     -> quantity x the approved severe rate.
 *
 * A BLANK quantity on a priced condition loads ONE unit's approved amount —
 * exactly what the row loaded before B6-F1 existed. It is not read as zero:
 * "how many" being unanswered is not the claim that there are none.
 *
 * An INVALID quantity loads nothing, so the row is visibly unpriced rather
 * than quietly priced from a count that was not understood.
 */
export function amountForQuantity(
  row: OperatorRow, condition: OperatorCondition, quantity: string,
): string {
  const rate = unitRateFor(row, condition);
  if (rate === null) return "";
  if (condition === "good") return "0";
  const parsed = parseQuantity(quantity);
  if (parsed.kind === "invalid") return "";
  if (parsed.kind === "blank") return String(rate);
  return String(parsed.value * rate);
}

/**
 * Selecting or changing a condition. The Known Amount is RESET to the newly
 * selected condition's approved default and stops being an override — a
 * previous manual figure does not survive a condition change, and getting it
 * back is a deliberate re-entry.
 *
 * On a counted row the stated quantity SURVIVES a Repair/severe change and the
 * amount is recomputed at the newly selected condition's approved rate (B6-F1
 * item 5). `Good` and `Not asked` clear the quantity outright (items 6 and 7):
 * neither states a repair, so a count left standing beside one would be a
 * number with nothing to multiply.
 *
 * `previous` is optional so every existing lump-sum call site is unchanged; it
 * is only ever read on a counted row.
 */
export function applyCondition(
  row: OperatorRow, condition: OperatorCondition, previous: RowAnswer = EMPTY_ANSWER,
): RowAnswer {
  if (quantitySpecFor(row) === undefined) {
    return { condition, amount: defaultAmountFor(row, condition), quantity: "", dirty: false };
  }
  const priced = condition === "repair" || condition === "severe";
  const quantity = priced ? previous.quantity : "";
  return {
    condition, quantity, amount: amountForQuantity(row, condition, quantity), dirty: false,
  };
}

/**
 * Typing in the quantity field. The Known Amount is RECALCULATED from the
 * approved policy rate and stops being an override, so a quantity changed
 * after a manual figure replaces that figure (B6-F1 item 4). The recalculated
 * amount is policy, not the operator's own, and is provenanced accordingly.
 */
export function applyQuantity(row: OperatorRow, answer: RowAnswer, raw: string): RowAnswer {
  return {
    condition: answer.condition,
    quantity: raw,
    amount: amountForQuantity(row, answer.condition, raw),
    dirty: false,
  };
}

/**
 * Typing in the Known Amount field. Marks the amount as the operator's, and
 * leaves any stated quantity alone — the operator has overridden what the
 * count produced, not retracted the count.
 */
export function applyAmount(answer: RowAnswer, raw: string): RowAnswer {
  return { condition: answer.condition, amount: raw, quantity: answer.quantity, dirty: true };
}

/** True while the operator has not touched the estimator in any way. */
export function isUntouched(answers: Answers): boolean {
  for (const row of OPERATOR_ROWS) {
    const a = answers[row.system];
    if (a === undefined) continue;
    if (a.condition !== "not_asked" || a.amount !== "" || a.quantity !== "" || a.dirty) return false;
  }
  return true;
}

/**
 * The operator's answers as calculation-core input.
 *
 * The rule the review settled: THE DOLLAR AMOUNT IN THE FIELD IS THE AMOUNT
 * USED. A known amount is honoured whatever the condition says, including on
 * a row that was never asked.
 *
 * 2026-10-04 amendment: a row that is `Not asked` with nothing entered carries
 * its approved severe-state allowance as an `unknown_condition` reserve
 * ("condition not confirmed"), except a counted row, whose unit basis is
 * unresolved. A row is an unpriced risk only when it has no usable amount and
 * no allowance applies — nothing is ever invented to fill one in.
 *
 * `misc` is the Miscellaneous / Other repairs row; omitted, it is blank.
 */
export function buildLines(answers: Answers, misc: MiscAnswer = EMPTY_MISC): RepairLineInput[] {
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
      if (a.condition === "not_asked") {
        const allowance = unansweredAllowanceFor(row);
        if (allowance !== null) {
          /* Rule 1: the row's own approved severe-state amount, held as a
             reserve against a condition nobody has confirmed. Policy, never
             cost book; answering the row replaces it (rule 3). */
          lines.push({
            ...base, origin: "unknown_condition",
            pricing: { kind: "amount", amount: allowance, provenance: "IAOS_POLICY" },
          });
          continue;
        }
        const unit = quantitySpecFor(row)?.unit ?? "unit";
        lines.push({
          ...base,
          pricing: {
            kind: "unpriced_risk",
            reason: `${UNANSWERED_ALLOWANCE_LABEL}; its allowance is per ${unit}, so it needs a ${unit} count — not included in the total`,
          },
        });
        continue;
      }
      /* A condition that was answered and then had its amount cleared is not
         a case the approved rules name. It stays unresolved rather than
         quietly taking an allowance, because the alternative is inventing
         which number the operator meant. */
      lines.push({ ...base, pricing: { kind: "unpriced_risk", reason: "the known amount was cleared" } });
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

  /* Rule 5: Miscellaneous / Other repairs, below every table row. Blank adds
     nothing and is not a risk — it is the default. Entered, it is Brad's own
     figure (MANUAL), counted once. */
  const miscAmount = parseKnownAmount(misc.amount);
  const description = misc.description.trim();
  const miscBase = {
    id: MISC_LINE_ID,
    label: description ? `${MISC_ROW_LABEL} — ${description}` : MISC_ROW_LABEL,
    component: "major_system" as const,
  };
  if (miscAmount.kind === "invalid") {
    lines.push({ ...miscBase, pricing: { kind: "unpriced_risk", reason: "the amount entered is not a valid non-negative dollar figure" } });
  } else if (miscAmount.kind === "value") {
    lines.push(miscAmount.value === 0
      ? { ...miscBase, pricing: { kind: "no_repair" } }
      : { ...miscBase, pricing: { kind: "amount", amount: miscAmount.value, provenance: "MANUAL" } });
  }
  return lines;
}

/**
 * What the operator surface shows (2026-10-04 amendment, rule 2).
 *
 * There is no fallback mode any more: every estimate is the row calculation.
 *   knownSubtotal       — Known Repairs: answered rows, manual figures, misc.
 *   unansweredSubtotal  — Unanswered Allowances: "condition not confirmed".
 *   total               — Preliminary Total: both, plus the (BOOK-only, so
 *                         here $0) FMTM allowance. This is what approval
 *                         carries and what persists.
 */
export interface OperatorEstimate {
  mode: "rows";
  estimate: RepairEstimate;
  knownSubtotal: number;
  unansweredSubtotal: number;
  total: number;
}

/**
 * The conservative allowance for a row-mode estimate: the resolved
 * components plus the inherited FMTM allowance.
 */
export function rowsTotal(estimate: RepairEstimate): number {
  return estimate.resolvedSubtotal + estimate.components.fmtmAllowance.outcome.amount;
}

/**
 * Jess ruling on the PR #124 review, item 3 (2026-10-04). The whole-house
 * electrical and electrical panel rows are separately approved, so both carry
 * their amounts; whether they cover some of the same work is unconfirmed.
 * True when BOTH currently contribute a positive amount (an answer, a manual
 * figure or an unanswered allowance) -- the operator is then told the overlap
 * is possible. It decides nothing and deducts nothing.
 */
export function electricalOverlapPossible(result: OperatorEstimate): boolean {
  const amountOf = (id: string): number => {
    const line = result.estimate.lines.find((l) => l.id === id);
    return line && line.outcome.kind === "priced" ? line.outcome.amount : 0;
  };
  return amountOf("electrical_whole_house") > 0 && amountOf("electrical_panel") > 0;
}

/**
 * Resolve the operator's answers into Known Repairs, Unanswered Allowances and
 * the Preliminary Total. An untouched estimator is simply every row unanswered.
 *
 * `compute` is injected rather than imported so this stays testable without
 * the core, and so the core keeps exactly one caller shape.
 */
export function operatorEstimate(
  answers: Answers,
  compute: (lines: RepairLineInput[]) => RepairEstimate,
  misc: MiscAnswer = EMPTY_MISC,
): OperatorEstimate {
  const estimate = compute(buildLines(answers, misc));
  return {
    mode: "rows",
    estimate,
    knownSubtotal: estimate.indicatedSubtotal,
    unansweredSubtotal: estimate.components.unknownRiskReserves,
    total: rowsTotal(estimate),
  };
}
