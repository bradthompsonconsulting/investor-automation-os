import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertCircle, Check, Loader2 } from "lucide-react";
import { ghl, ESTIMATED_REPAIRS_ID, type ContactDetail, type OpportunityRow } from "../lib/ghl";
import { getRuntimeConfig } from "../../shared/ghl-config";
import {
  parsePolicy,
  parseOpportunityValues,
  parseContactSeeds,
  parseDealOverrides,
  resolveDealFacts,
  resolveInputs,
} from "../lib/underwriting/resolver";
import { computeUnderwriting } from "../lib/underwriting/compute";
import { toViewModel, type ApproveState, type ScreenState, type SelectedOpportunity } from "../lib/underwriting/view-model";
/* Board #5 S2 — the selection rule moved OUT of this file so the call rail can
   answer "which opportunity is this deal" with the same code, not a copy of it.
   Behaviour here is unchanged: these three call sites replace inline logic with
   calls to the identical logic. */
import { opportunitiesForContact, opportunityCandidates, selectOpportunity } from "../lib/underwriting/selectOpportunity";
import { OPTION_BY_MODE, ASSIGNMENT_MODE_OPTIONS } from "../lib/underwriting/resolver-types";
import type { DealFacts, PolicyParseIssue } from "../lib/underwriting/resolver-types";
import type { AssignmentResolution, UnderwritingResult } from "../lib/underwriting/types";
/* INV-12 — Repair Estimation V1 enters the seller call here. The calculation
   core is accepted and unchanged; this page asks the questions and renders
   what the core returns. It decides no pricing of its own. */
import { computeRepairEstimate, RepairInputError } from "../lib/repair-estimation/compute";
import { findReferenceRow } from "../lib/repair-estimation/reference";
import type { Condition, MajorSystem, RepairEstimate, RepairLineInput } from "../lib/repair-estimation/types";
/* INV-13 — the persistence boundary. The gate and the write/readback live in
   their own module so "unapproved cannot write" is a property of a pure
   function a harness can exhaust, not a claim about this component. */
import { persistApprovedRepairTotal, persistGate } from "../lib/repair-estimation/persist";
import type { PersistResult, RepairApproval } from "../lib/repair-estimation/persist";

/**
 * Underwriting Workspace — UNDERWRITING_WORKSPACE_SPEC.md.
 *
 * Route: /contacts/:id/underwriting. A Contact-context sub-route, decided
 * 2026-08-14: the persistent rail needs its own viewport, because Seller
 * MAO is a guardrail during live negotiation and a guardrail that scrolls
 * away is not one.
 *
 * READ ONLY. This page performs no writes of any kind. Approve is not
 * rendered — PB-D56 prerequisite 5, the opportunity-side inert proof, is
 * the gate and it is open. A disabled button would imply Approve is one
 * configuration away from working; it is not.
 *
 * Zones 1, 2 and 4 only. Zone 3 (Work the Deal) is editing, and every edit
 * is a write.
 *
 * All interpretation lives in view-model.ts. This component fetches,
 * selects an opportunity, runs the pipeline, and renders — it decides
 * nothing about what "unresolved" means.
 */

const CONTENT_MAX_WIDTH = "1600px";
const CONFIG = getRuntimeConfig();

const CV_IDS = CONFIG.customValues;
const OPP_IDS = {
  arv: CONFIG.opportunityFacts.arv,
  repairs: CONFIG.opportunityFacts.repairs,
  askingPrice: CONFIG.opportunityFacts.askingPrice,
  assignmentMode: CONFIG.opportunityFields.assignmentMode,
};
const CONTACT_IDS = {
  arv: CONFIG.fields.arv,
  repairs: CONFIG.fields.estimatedRepairs,
  askingPrice: CONFIG.fields.askingPrice,
};

/** Local, not in format.ts — one consumer, so no shared abstraction yet. */
function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function contactName(c: ContactDetail | null): string {
  if (!c) return "—";
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

const LEVEL_LABEL: Record<string, string> = {
  deal_override: "Deal Override",
  investor_policy: "Investor Policy",
  iaos_starter: "IAOS Starter",
};

/**
 * Operator-facing labels for the Provenance keys. Internal identifiers must
 * never reach the screen -- the same rule the missing-input labels follow in
 * view-model.ts. This section rendered `sellingCostPct` and six others
 * verbatim until 2026-08-16, and survived because it only appears in the
 * resolved state, which had no production fixture until that day.
 *
 * Unmapped keys fall back to the raw name rather than disappearing.
 */
const ASSUMPTION_LABEL: Record<string, string> = {
  sellingCostPct: "Selling Cost Percentage",
  closingCost: "Closing Cost Estimate",
  monthlyCarry: "Monthly Holding Cost",
  holdMonths: "Hold Period",
  buyerProfitPct: "Buyer Profit Percentage",
  standardMinimum: "Standard Minimum Assignment Spread",
  financingEnabled: "Purchase Financing",
  financingLtv: "Financing LTV",
  financingRate: "Interest Rate",
  financingPoints: "Financing Points",
  profitSharePct: "Buyer Profit Share Percentage",
};

// ── Presentational pieces ────────────────────────────────────────────────────

function Shell({ contactId, children }: { contactId: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH }}>
      <Link to={`/contacts/${contactId}`} style={{
        display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px",
        color: "#64748B", marginBottom: "14px", textDecoration: "none",
      }}>
        <ArrowLeft size={13} /> Contact
      </Link>
      {children}
    </div>
  );
}

function Notice({ tone, title, body }: { tone: "error" | "warn" | "info"; title: string; body?: string }) {
  const color = tone === "error" ? "#EF4444" : tone === "warn" ? "#F59E0B" : "#64748B";
  return (
    <div style={{
      display: "flex", gap: "12px", alignItems: "flex-start", padding: "18px 20px",
      background: `${color}0F`, border: `1px solid ${color}33`, borderRadius: "10px",
    }}>
      <AlertCircle size={20} style={{ color, flexShrink: 0, marginTop: "1px" }} />
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>{title}</div>
        {body ? <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.5 }}>{body}</div> : null}
      </div>
    </div>
  );
}

/** The persistent rail. Four numbers, per SELLER_ACQUISITION_WORKFLOW.md. */
function Rail({ ask, arv, repairs, mao, waiting }: {
  ask: number | null; arv: number | null; repairs: number | null;
  mao: number | null; waiting: string | null;
}) {
  const cell = (label: string, value: string, accent?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "128px" }}>
      <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{
        fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace",
        color: accent ?? "#E2E8F0",
      }}>{value}</span>
    </div>
  );
  return (
    <div style={{
      display: "flex", gap: "28px", flexWrap: "wrap", alignItems: "flex-start",
      padding: "16px 20px", background: "#0F172A", border: "1px solid #1E293B",
      borderRadius: "10px", marginBottom: "20px",
    }}>
      {cell("Seller Ask", money(ask))}
      {cell("ARV", money(arv))}
      {cell("Repairs", money(repairs))}
      {waiting
        ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Seller MAO</span>
            <span style={{ fontSize: "13px", color: "#F59E0B", fontWeight: 600, paddingTop: "3px" }}>{waiting}</span>
          </div>
        )
        : cell("Seller MAO", money(mao), "#1EC8FF")}
    </div>
  );
}

/**
 * PB-D59 -- the Approve control and its outcomes.
 *
 * WARNINGS DO NOT BLOCK. A resolved deal carrying an out-of-parameters
 * warning is still approvable: PB-D56 flags and never blocks, and the
 * investor remains the decision authority. The warning renders above this
 * control, where the operator sees it before deciding. Nobody may later
 * tighten `disabled` to include warnings -- that would make IAOS override
 * an operator judgment for the first time.
 *
 * The only condition that disables the button is a write already in
 * flight, which prevents a second PUT over an outstanding one.
 */
function ApproveControl({ state, onApprove, warningCount }: {
  state: ApproveState;
  onApprove: () => void;
  warningCount: number;
}) {
  if (state.status === "succeeded") {
    return (
      <div style={{
        display: "flex", gap: "10px", alignItems: "flex-start", padding: "14px 18px",
        background: "#22C55E0F", border: "1px solid #22C55E33", borderRadius: "10px", marginTop: "22px",
      }}>
        <Check size={16} style={{ color: "#22C55E", flexShrink: 0, marginTop: "1px" }} />
        <div style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.5 }}>
          <strong>Underwriting approved.</strong> End-Buyer Maximum Purchase Price,
          Seller MAO and Assignment Mode were saved to the opportunity and
          confirmed on read-back.
        </div>
      </div>
    );
  }

  if (state.status === "partial") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px",
        background: "#F59E0B0F", border: "1px solid #F59E0B44", borderRadius: "10px", marginTop: "22px",
      }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <AlertCircle size={18} style={{ color: "#F59E0B", flexShrink: 0, marginTop: "1px" }} />
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>
              Partially saved — NOT approved
            </div>
            <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.5 }}>
              {state.message} Review the opportunity in GHL before trying again.
            </div>
          </div>
        </div>
        <div style={{ fontFamily: "Space Grotesk, monospace", fontSize: "12px", paddingLeft: "28px" }}>
          {state.carriers.map((c) => (
            <div key={c.key} style={{ display: "flex", gap: "10px", padding: "2px 0" }}>
              <span style={{ color: c.landed ? "#22C55E" : "#EF4444", width: "62px" }}>
                {c.landed ? "saved" : "not saved"}
              </span>
              <span style={{ color: "#94A3B8" }}>{c.key}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const failed = state.status === "failed";
  const inFlight = state.status === "in_flight";

  return (
    <div style={{ marginTop: "22px" }}>
      {failed ? (
        <div style={{
          display: "flex", gap: "10px", alignItems: "flex-start", padding: "14px 18px",
          background: "#EF44440F", border: "1px solid #EF444433", borderRadius: "10px",
          marginBottom: "12px",
        }}>
          <AlertCircle size={16} style={{ color: "#EF4444", flexShrink: 0, marginTop: "1px" }} />
          <div style={{ fontSize: "13px", color: "#94A3B8", lineHeight: 1.5 }}>
            <span style={{ color: "#E2E8F0", fontWeight: 600 }}>Nothing was saved.</span>{" "}
            {state.message} The opportunity is unchanged, so trying again is safe.
          </div>
        </div>
      ) : null}

      <button
        onClick={onApprove}
        disabled={inFlight}
        style={{
          display: "inline-flex", alignItems: "center", gap: "8px",
          padding: "10px 18px", borderRadius: "8px", cursor: inFlight ? "default" : "pointer",
          background: inFlight ? "#1E293B" : "#1EC8FF",
          color: inFlight ? "#64748B" : "#0B1220",
          border: "none", fontSize: "13px", fontWeight: 700,
        }}
      >
        {inFlight ? "Saving…" : failed ? "Try again" : "Approve underwriting"}
      </button>

      <div style={{ fontSize: "11px", color: "#475569", marginTop: "8px", lineHeight: 1.5 }}>
        Writes End-Buyer Maximum Purchase Price, Seller MAO and Assignment Mode
        to the opportunity. Nothing else is written — not the stage, the status,
        or any offer field.
        {warningCount > 0
          ? " This deal carries a warning above; approving is permitted and the decision is yours."
          : ""}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** What a mode write is doing, for the operator. */
type ModeWriteState =
  | { status: "idle" }
  | { status: "in_flight"; label: string }
  | { status: "succeeded"; label: string }
  | { status: "failed"; label: string; message: string }
  | { status: "unconfirmed"; label: string; observed: string };

/**
 * Board item #2C -- the Assignment Mode selector.
 *
 * WHY IT LIVES IN THE UNRESOLVED STATE. Assignment Mode is a deal fact read
 * from the Opportunity. It has no starter fallback and no policy value can
 * supply it, so an UNSET mode is precisely what leaves underwriting unresolved
 * -- no Seller MAO, and no End-Buyer Maximum either, the latter withheld
 * deliberately rather than shown alone. A control placed only beside Approve
 * would be unreachable in the exact situation it exists to fix.
 *
 * It renders in the RESOLVED state as well, so a mode can be changed on a deal
 * that already resolves and the figures recomputed. That is additive; the
 * unresolved placement is the one that makes the feature work at all.
 *
 * MANUAL IS OFFERED AND EXPLAINED, NEVER HIDDEN AND NEVER SILENT. There is no
 * GHL field for the manual spread amount -- Assignment Mode records WHICH mode
 * governs and nothing records the dollar figure -- so selecting Manual writes a
 * true deal fact and underwriting still will not resolve. Out-of-parameters is
 * flagged, never blocked; a control that offers a choice which quietly yields
 * no result is worse than one that explains itself. So the option is present,
 * the consequence is stated before the click, and it is restated after.
 */
function AssignmentModeSelector({ currentLabel, absentReason, state, onSelect }: {
  currentLabel: string | null;
  /* Why there is no current label, in the resolver's own words. "Not set" and
     "set to something unrecognised" are different facts and the second one is
     not an absence — asserting a single cause here would be the same
     conflation that made Manual unreadable. */
  absentReason: string | null;
  state: ModeWriteState;
  onSelect: (label: string) => void;
}) {
  const busy = state.status === "in_flight";
  const pendingManual = state.status !== "idle" && state.label === "Manual";
  const manualIsCurrent = currentLabel === "Manual" || pendingManual;

  return (
    <div
      data-testid="assignment-mode-selector"
      style={{
        marginTop: "14px", padding: "16px 18px", background: "#0F172A",
        border: "1px solid #1E293B", borderRadius: "10px",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#E2E8F0", marginBottom: "4px" }}>
        Assignment Mode
      </div>
      <div style={{ fontSize: "12px", color: "#64748B", marginBottom: "12px" }}>
        {currentLabel
          ? <>Currently <span style={{ color: "#94A3B8" }}>{currentLabel}</span>. Choose a different mode to change it.</>
          : <>{absentReason
                ? absentReason.charAt(0).toUpperCase() + absentReason.slice(1)
                : "Not set on this opportunity"}. Underwriting cannot resolve until a mode is set.</>}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {ASSIGNMENT_MODE_OPTIONS.map(([label]) => {
          const isCurrent = label === currentLabel;
          return (
            <button
              key={label}
              data-testid={`assignment-mode-option-${label.replace(/\s+/g, "-").toLowerCase()}`}
              onClick={() => onSelect(label)}
              disabled={busy || isCurrent}
              title={isCurrent ? "Already the mode on this opportunity" : `Set Assignment Mode to ${label}`}
              style={{
                fontSize: "12px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px",
                border: `1px solid ${isCurrent ? "rgba(30,200,255,0.55)" : "rgba(30,200,255,0.35)"}`,
                background: isCurrent ? "rgba(30,200,255,0.18)" : "rgba(30,200,255,0.08)",
                color: "#1EC8FF",
                cursor: busy || isCurrent ? "default" : "pointer",
                opacity: busy && !isCurrent ? 0.6 : 1,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* The Manual carrier gap, stated wherever Manual is the mode in play --
          whether it is already set, or was just chosen. */}
      {manualIsCurrent ? (
        <div data-testid="assignment-mode-manual-note" style={{ marginTop: "12px", fontSize: "12px", color: "#FBBF24", lineHeight: 1.5 }}>
          Manual is a real mode and it has been recorded, but underwriting will still not
          resolve under it. GHL holds the mode and not the manual spread amount, so there is
          no figure to calculate from. Use Standard Minimum or 25% of Buyer Profit to
          underwrite this deal, or set the spread in GHL once a field exists for it.
        </div>
      ) : null}

      <div style={{ marginTop: "10px", fontSize: "12px", minHeight: "18px" }}>
        {state.status === "in_flight" ? (
          <span style={{ color: "#94A3B8" }}>Setting {state.label}…</span>
        ) : null}
        {state.status === "succeeded" ? (
          <span data-testid="assignment-mode-saved" style={{ color: "#94A3B8" }}>Saved — {state.label} confirmed on the opportunity.</span>
        ) : null}
        {state.status === "unconfirmed" ? (
          <span style={{ color: "#FBBF24" }}>
            Write accepted but not confirmed. GHL returned {JSON.stringify(state.observed)} where {JSON.stringify(state.label)} was sent.
          </span>
        ) : null}
        {state.status === "failed" ? (
          <span style={{ color: "#F87171" }}>Could not set {state.label}: {state.message}</span>
        ) : null}
      </div>
    </div>
  );
}

// ── INV-12 — Repair Estimation V1 in the seller call ─────────────────────────

/**
 * The systems the operator is asked about, and the answers each one accepts.
 *
 * Deliberately short. The acceptance criterion is a conservative transparent
 * allowance reached during ONE normal seller call without line-item
 * estimating, so the 122-item cost book stays behind this surface. Each row
 * offers only the conditions its authorized reference row actually names —
 * an option that cannot resolve to an authorized amount is not a question
 * worth asking a seller.
 *
 * Windows carries no authorized row on purpose. It appears because it is a
 * designated major system that must not be buried in an average, and it
 * prices only from an operator-entered amount or stays an unpriced risk.
 */
const REPAIR_SYSTEM_ROWS: { system: MajorSystem; label: string; conditions: Condition[] }[] = [
  { system: "roof", label: "Roof", conditions: ["good", "repair", "replace", "unknown"] },
  { system: "hvac", label: "HVAC", conditions: ["good", "repair", "replace", "unknown"] },
  { system: "electrical_whole_house", label: "Electrical — whole house", conditions: ["good", "repair", "replace", "unknown"] },
  { system: "electrical_panel", label: "Electrical panel", conditions: ["good", "replace", "unknown"] },
  { system: "plumbing_sewer", label: "Plumbing / sewer", conditions: ["good", "repair", "major", "unknown"] },
  { system: "foundation", label: "Foundation", conditions: ["good", "material_issue", "unknown"] },
  { system: "windows", label: "Windows", conditions: ["good", "repair", "replace", "unknown"] },
];

const CONDITION_LABEL: Record<Condition, string> = {
  good: "Good",
  repair: "Repair",
  replace: "Replace",
  major: "Major",
  material_issue: "Material issue",
  unknown: "Unknown",
};

/** Operator-facing provenance. The internal keys never reach the screen. */
const PROVENANCE_LABEL: Record<"BOOK" | "IAOS_POLICY" | "MANUAL", string> = {
  BOOK: "BOOK",
  IAOS_POLICY: "IAOS POLICY",
  MANUAL: "MANUAL",
};

const PROVENANCE_COLOR: Record<"BOOK" | "IAOS_POLICY" | "MANUAL", string> = {
  BOOK: "#38BDF8",
  IAOS_POLICY: "#A78BFA",
  MANUAL: "#94A3B8",
};

type RepairAnswer = { condition: Condition | "not_asked"; manual: string };
type ParsedAmount = { kind: "blank" } | { kind: "invalid" } | { kind: "value"; value: number };

/**
 * A typed known amount, or the reason it is not one. Blank and invalid are
 * kept apart: blank means the operator has not answered, invalid means they
 * answered with something that is not a dollar figure. Neither becomes zero.
 */
function parseKnownAmount(raw: string): ParsedAmount {
  const t = raw.trim();
  if (t === "") return { kind: "blank" };
  const n = Number(t.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return { kind: "invalid" };
  return { kind: "value", value: n };
}

/**
 * Whether a known amount may be typed for this answer.
 *
 * Enabled when the authorized table does not price the answer — the standard
 * says the line stays blank for operator entry — and for the one row that
 * permits an operator override. Disabled where an authorized reserve applies,
 * because the core rejects an override there and a control that produces an
 * error is worse than no control.
 */
function manualEntryAllowed(system: MajorSystem, condition: Condition | "not_asked"): boolean {
  if (condition === "not_asked" || condition === "good") return false;
  const row = findReferenceRow(system, condition);
  return row === null || row.overrideAllowed;
}

/** The operator's answers as calculation-core input. Prices nothing itself. */
function repairLines(answers: Record<string, RepairAnswer>): RepairLineInput[] {
  const lines: RepairLineInput[] = [];
  for (const row of REPAIR_SYSTEM_ROWS) {
    const answer = answers[row.system];
    if (answer === undefined || answer.condition === "not_asked") continue;
    const condition = answer.condition;
    const base = { id: row.system, label: row.label, component: "major_system" as const };

    if (condition === "good") {
      lines.push({ ...base, pricing: { kind: "no_repair" } });
      continue;
    }

    const origin = condition === "unknown" ? ("unknown_condition" as const) : ("indicated" as const);
    const parsed = parseKnownAmount(answer.manual);

    /* An unreadable amount stays visibly unpriced. It is not discarded back to
       the authorized reserve and it is not treated as zero. */
    if (parsed.kind === "invalid") {
      lines.push({
        ...base, origin,
        pricing: { kind: "unpriced_risk", reason: "the known amount entered is not a valid dollar figure" },
      });
      continue;
    }

    const referenceRow = findReferenceRow(row.system, condition);
    if (referenceRow !== null) {
      /* Origin is derived by the core from the condition, so it is not passed
         here — passing it would only create a way to contradict the core. */
      lines.push(referenceRow.overrideAllowed && parsed.kind === "value"
        ? { ...base, pricing: { kind: "reference", system: row.system, condition, override: { amount: parsed.value } } }
        : { ...base, pricing: { kind: "reference", system: row.system, condition } });
      continue;
    }

    if (parsed.kind === "value") {
      lines.push({ ...base, origin, pricing: { kind: "amount", amount: parsed.value, provenance: "MANUAL" } });
      continue;
    }

    /* No authorized row and no known amount: the core returns the unpriced
       risk with the reason, rather than this page inventing one. */
    lines.push({ ...base, pricing: { kind: "reference", system: row.system, condition } });
  }
  return lines;
}

/**
 * The conservative allowance = the four resolved components + the inherited
 * FMTM allowance. Kept here rather than in the core because the core reports
 * the decomposition and deliberately does not declare a headline number.
 */
function conservativeAllowance(estimate: RepairEstimate): number {
  return estimate.resolvedSubtotal + estimate.components.fmtmAllowance.outcome.amount;
}

function EstimatorRow({ row, answer, onChange }: {
  row: { system: MajorSystem; label: string; conditions: Condition[] };
  answer: RepairAnswer;
  onChange: (next: Partial<RepairAnswer>) => void;
}) {
  const manualOk = manualEntryAllowed(row.system, answer.condition);
  const parsed = parseKnownAmount(answer.manual);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
      padding: "8px 0", borderTop: "1px solid #16202F",
    }}>
      <div style={{ width: "180px", fontSize: "13px", color: "#94A3B8" }}>{row.label}</div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {(["not_asked", ...row.conditions] as (Condition | "not_asked")[]).map((c) => {
          const active = answer.condition === c;
          return (
            <button
              key={c}
              onClick={() => onChange({ condition: c })}
              style={{
                padding: "4px 10px", borderRadius: "6px", fontSize: "11px", cursor: "pointer",
                border: `1px solid ${active ? "rgba(30,200,255,0.45)" : "#1E293B"}`,
                background: active ? "rgba(30,200,255,0.12)" : "transparent",
                color: active ? "#1EC8FF" : "#64748B",
              }}
            >
              {c === "not_asked" ? "Not asked" : CONDITION_LABEL[c]}
            </button>
          );
        })}
      </div>
      <input
        value={answer.manual}
        disabled={!manualOk}
        onChange={(e) => onChange({ manual: e.target.value })}
        placeholder={manualOk ? "Known amount" : "—"}
        style={{
          width: "130px", padding: "5px 8px", fontSize: "12px", borderRadius: "6px",
          background: manualOk ? "#0A0E1A" : "transparent",
          border: `1px solid ${parsed.kind === "invalid" ? "rgba(239,68,68,0.5)" : "#1E293B"}`,
          color: manualOk ? "#E2E8F0" : "#334155",
        }}
      />
    </div>
  );
}

/**
 * Repair Estimation V1, in the underwriting workspace.
 *
 * Operator approval is the only authorization to persist, and INV-13 persists
 * the TOTAL ONLY, through the existing `estimated_repairs` carrier. No
 * itemization leaves the session and no new carrier exists.
 *
 * The approved total deliberately does NOT feed the underwriting figures above
 * from session state. GHL is the sole system of record, so after a confirmed
 * write the page RE-READS the contact rather than patching its own copy —
 * patching would make the screen a claim about what we sent instead of a claim
 * about what GHL holds, which is the shadow copy the constraints forbid.
 */
function RepairEstimator({ contactId, onPersisted }: {
  contactId: string;
  onPersisted: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, RepairAnswer>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  /* The estimator's edit counter. Approval carries the revision it was given
     for, which is what makes a stale approval detectable rather than merely
     unlikely — an approval authorizes one number the operator actually saw. */
  const [revision, setRevision] = useState(0);
  const [approval, setApproval] = useState<RepairApproval>({ kind: "none" });
  const [persistState, setPersistState] = useState<
    { status: "idle" } | { status: "saving" } | { status: "done"; result: PersistResult }
  >({ status: "idle" });

  /* Any edit invalidates the acknowledgement, the approval and any prior save
     outcome. An approval that survives a changed answer is a claim about a
     number the operator never saw, and a stale "Saved" is worse than none. */
  function edit(system: MajorSystem, next: Partial<RepairAnswer>) {
    setAnswers((prev) => {
      const current = prev[system] ?? { condition: "not_asked" as const, manual: "" };
      return { ...prev, [system]: { ...current, ...next } };
    });
    setAcknowledged(false);
    setRevision((r) => r + 1);
    setApproval({ kind: "none" });
    setPersistState({ status: "idle" });
  }

  /* The single path to the carrier. Every caller goes through persistGate, so
     there is no branch that reaches the setter without an approval decision.
     The PUT is issued at most once per attempt and is never repeated. */
  async function persistNow(current: RepairApproval, currentTotal: number) {
    setPersistState({ status: "saving" });
    const result = await persistApprovedRepairTotal(
      ghl, contactId, ESTIMATED_REPAIRS_ID,
      persistGate(current, revision, currentTotal),
    );
    setPersistState({ status: "done", result });
    /* Only a confirmed write justifies re-reading. An unconfirmed or failed
       attempt leaves the page showing what GHL last actually gave us. */
    if (result.ok && result.confidence === "saved") onPersisted();
  }

  const computed = useMemo(() => {
    try {
      return {
        ok: true as const,
        estimate: computeRepairEstimate({
          /* Property context is offered, never required. No dimension is
             imported here: nothing on this surface prices from square footage,
             so importing one would add a carrier for no calculation. */
          lines: repairLines(answers),
          property: { squareFeet: null, bathroomCount: null },
        }),
      };
    } catch (e) {
      return { ok: false as const, message: e instanceof RepairInputError ? e.message : String(e) };
    }
  }, [answers]);

  if (!computed.ok) {
    return (
      <div style={{ marginTop: "22px" }}>
        <Notice tone="error" title="Repair estimate could not be assembled" body={computed.message} />
      </div>
    );
  }

  const estimate = computed.estimate;
  const allowance = estimate.components.fmtmAllowance;
  const unanswered = REPAIR_SYSTEM_ROWS.filter(
    (r) => (answers[r.system]?.condition ?? "not_asked") === "not_asked",
  ).length;
  const answered = REPAIR_SYSTEM_ROWS.length - unanswered;
  const complete = estimate.isCompleteAllowance && unanswered === 0;
  const total = conservativeAllowance(estimate);
  const saving = persistState.status === "saving";
  const canApprove = answered > 0 && (complete || acknowledged) && !saving;
  /* Defence in depth: an edit already clears the approval, so this can only be
     current or absent. The gate checks it anyway, and the harness proves it. */
  const approvalCurrent =
    approval.kind === "approved" && approval.revision === revision && approval.total === total;

  return (
    <div style={{ marginTop: "22px" }}>
      <div style={{ fontSize: "11px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
        Repair estimate — seller call
      </div>

      <div style={{ padding: "18px 20px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px" }}>
        <div style={{ fontSize: "11px", color: "#475569", marginBottom: "6px" }}>
          Ask only what the call allows. An unanswered system is not zero, and Unknown reserves the
          authorized amount until a real answer reduces it.
        </div>

        {REPAIR_SYSTEM_ROWS.map((row) => (
          <EstimatorRow
            key={row.system}
            row={row}
            answer={answers[row.system] ?? { condition: "not_asked", manual: "" }}
            onChange={(next) => edit(row.system, next)}
          />
        ))}

        {/* Zone 4 discipline: indicated repairs and unknown-condition reserves
            are economically identical in the total and informationally
            completely different, so they never collapse into one figure. */}
        <div style={{
          marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #1E293B",
          fontFamily: "Space Grotesk, monospace", fontSize: "13px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#94A3B8" }}>
            <span>Known / indicated repairs</span><span>{money(estimate.indicatedSubtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#94A3B8" }}>
            <span>Unknown-condition reserves</span><span>{money(estimate.components.unknownRiskReserves)}</span>
          </div>
          {estimate.lines
            .filter((l) => l.origin === "unknown_condition" && l.outcome.kind === "priced")
            .map((l) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0 2px 18px", color: "#475569", fontSize: "12px" }}>
                <span>{l.label} — condition unknown</span>
                <span>{money(l.outcome.kind === "priced" ? l.outcome.amount : null)}</span>
              </div>
            ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#94A3B8" }}>
            <span>{allowance.label}</span><span>{money(allowance.outcome.amount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "0 0 6px 18px", color: "#475569", fontSize: "11px" }}>
            <span>10% of {money(allowance.outcome.basis)} in BOOK amounts</span><span />
          </div>
          <div style={{
            display: "flex", justifyContent: "space-between", padding: "10px 0 0",
            borderTop: "1px solid #1E293B", color: "#E2E8F0", fontWeight: 700,
          }}>
            <span>{complete ? "Conservative allowance" : "Incomplete subtotal"}</span>
            <span>{money(total)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: "12px", fontSize: "11px" }}>
          {(["BOOK", "IAOS_POLICY", "MANUAL"] as const).map((p) => (
            <span key={p} style={{ color: "#475569" }}>
              <span style={{ color: PROVENANCE_COLOR[p] }}>{PROVENANCE_LABEL[p]}</span>{" "}
              {money(estimate.byProvenance[p])}
            </span>
          ))}
        </div>

        {estimate.unpricedRisks.length > 0 ? (
          <div style={{
            marginTop: "14px", padding: "12px 14px", borderRadius: "8px",
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#F59E0B", fontSize: "12px", fontWeight: 700 }}>
              <AlertCircle size={13} /> UNPRICED RISK · {estimate.unpricedRisks.length}
            </div>
            {estimate.unpricedRisks.map((r) => (
              <div key={r.id} style={{ fontSize: "12px", color: "#94A3B8", marginTop: "6px" }}>
                <span style={{ color: "#E2E8F0" }}>{r.label}</span> — {r.reason}
              </div>
            ))}
          </div>
        ) : null}

        {unanswered > 0 ? (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#64748B" }}>
            {unanswered} system{unanswered === 1 ? "" : "s"} not yet asked. Not asked is not $0.
          </div>
        ) : null}

        {!complete && answered > 0 ? (
          <label style={{
            display: "flex", alignItems: "flex-start", gap: "8px", marginTop: "14px",
            fontSize: "12px", color: "#94A3B8", cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => {
                setAcknowledged(e.target.checked);
                setApproval({ kind: "none" });
                setPersistState({ status: "idle" });
              }}
              style={{ marginTop: "2px" }}
            />
            <span>
              I acknowledge this subtotal is not a complete repair allowance. It excludes{" "}
              {estimate.unpricedRisks.length} unpriced risk{estimate.unpricedRisks.length === 1 ? "" : "s"}
              {unanswered > 0 ? ` and ${unanswered} system${unanswered === 1 ? "" : "s"} not yet asked` : ""}.
            </span>
          </label>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "14px", flexWrap: "wrap" }}>
          <button
            onClick={() => {
              const next: RepairApproval = { kind: "approved", total, revision };
              setApproval(next);
              void persistNow(next, total);
            }}
            disabled={!canApprove}
            style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
              cursor: canApprove ? "pointer" : "not-allowed",
              border: `1px solid ${canApprove ? "rgba(34,197,94,0.45)" : "#1E293B"}`,
              background: canApprove ? "rgba(34,197,94,0.12)" : "transparent",
              color: canApprove ? "#22C55E" : "#334155",
            }}
          >
            {saving ? "Saving…" : "Approve and save repair total"}
          </button>

          {saving ? (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748B" }}>
              <Loader2 size={13} className="animate-spin" /> Writing to estimated_repairs, then reading GHL back…
            </span>
          ) : null}

          {/* PB-D21 vocabulary. "Saved" is a readback, never a 2xx. Each other
              terminal state says plainly whether a write left. */}
          {persistState.status === "done" && persistState.result.ok
            && persistState.result.confidence === "saved" ? (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#22C55E" }}>
              <Check size={13} /> Saved to estimated_repairs · {money(persistState.result.value)}
            </span>
          ) : null}

          {persistState.status === "done" && persistState.result.ok
            && persistState.result.confidence === "unconfirmed" ? (
            <span style={{ fontSize: "12px", color: "#F59E0B" }}>
              Sent {money(persistState.result.value)}, but GHL did not read back that value. Check the
              contact before relying on it. The write was not repeated.
            </span>
          ) : null}

          {persistState.status === "done" && !persistState.result.ok ? (
            <span style={{ fontSize: "12px", color: "#EF4444" }}>
              {persistState.result.error}
              {persistState.result.written
                ? " A write did leave; it was not repeated."
                : " Nothing was written."}
            </span>
          ) : null}

          {persistState.status === "done" && !persistState.result.ok
            && persistState.result.stage !== "blocked" && approvalCurrent ? (
            <button
              onClick={() => void persistNow(approval, total)}
              style={{
                padding: "6px 12px", borderRadius: "6px", fontSize: "11px", cursor: "pointer",
                border: "1px solid #1E293B", background: "transparent", color: "#94A3B8",
              }}
            >
              Try saving again
            </button>
          ) : null}

          {answered === 0 ? (
            <span style={{ fontSize: "11px", color: "#475569" }}>Answer at least one system to approve.</span>
          ) : null}
        </div>

        <div style={{ marginTop: "12px", fontSize: "11px", color: "#475569", lineHeight: 1.5 }}>
          {estimate.disclosure} Approving writes the TOTAL ONLY to the existing{" "}
          <span style={{ color: "#64748B" }}>estimated_repairs</span> field on this contact — no
          itemization is stored and no other field is touched. Nothing is written without approval,
          and the underwriting figures above update from GHL on the next read, not from this session.
        </div>
      </div>
    </div>
  );
}

export default function UnderwritingWorkspace() {
  const { id } = useParams<{ id: string }>();
  const contactId = id ?? "";

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [policyValues, setPolicyValues] = useState<{ id: string; value: string }[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);

  /* PB-D59. The Approve attempt's state, held here because the view model
     owns the RESULT and never the call -- the page performs the write and
     hands the outcome in.

     Nothing sets this yet and nothing renders it. PB-D59 section VI as
     amended permits Approve to be built; this slice deliberately stops
     before the control, so the write method, its readback parser and these
     states are all provable before anything is browser-reachable. The
     setter is unused until the control lands. */
  const [approve, setApprove] = useState<ApproveState>({ status: "idle" });

  /* Board item #2C. The mode write's state, and a reload counter.
     A successful mode write changes the input the whole page is derived from,
     so the page must re-read the opportunity rather than patch its own copy.
     Patching would make the screen a claim about what we sent; re-reading keeps
     it a claim about what GHL holds. */
  const [modeWrite, setModeWrite] = useState<ModeWriteState>({ status: "idle" });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    setFetchError(null);
    Promise.all([
      ghl.contacts.getDetail(contactId),
      ghl.opportunities.listPipeline(),
      ghl.underwriting.policy(),
    ])
      .then(([c, pipeline, policy]) => {
        if (cancelled) return;
        setContact(c);
        setOpps(opportunitiesForContact(pipeline.opportunities, contactId));
        setPolicyValues(policy.values);
      })
      .catch((e: Error) => { if (!cancelled) setFetchError(e.message); });
    return () => { cancelled = true; };
  }, [contactId, reloadTick]);

  const loading = fetchError === null && (contact === null || opps === null || policyValues === null);

  const candidates: SelectedOpportunity[] = useMemo(
    () => opportunityCandidates(opps),
    [opps],
  );

  /**
   * Exactly one candidate auto-selects, derived rather than set through an
   * effect so a one-item selector never flashes. More than one requires an
   * explicit choice — PB-D55 forbids assuming the first is the deal.
   */
  const selected: SelectedOpportunity | null = useMemo(
    () => selectOpportunity(candidates, chosenId),
    [candidates, chosenId],
  );

  const pipeline = useMemo(() => {
    if (!contact || !opps || !policyValues || !selected) {
      return { result: null as UnderwritingResult | null, facts: null as DealFacts | null,
               assignment: null as AssignmentResolution | null,
               issues: [] as PolicyParseIssue[], computeError: null as { field: string | null; message: string } | null };
    }
    const opp = opps.find((o) => o.id === selected.id);
    if (!opp) {
      return { result: null, facts: null as DealFacts | null,
               assignment: null as AssignmentResolution | null, issues: [],
               computeError: null as { field: string | null; message: string } | null };
    }
    try {
      const { policy, issues } = parsePolicy(policyValues, CV_IDS);
      const oppValues = parseOpportunityValues(opp.customFields, OPP_IDS);
      const seeds = parseContactSeeds(contact.customFields, CONTACT_IDS);
      const overrides = parseDealOverrides(opp.customFields);
      const facts = resolveDealFacts(oppValues, seeds);
      const inputs = resolveInputs(facts, overrides, policy);
      /* The assignment travels alongside the result from the SAME
         resolveInputs call. Re-deriving it separately would let the two
         disagree -- a resolved calculation paired with an assignment that
         did not produce it -- which the view model would then have to
         treat as an orchestration error it could not diagnose. */
      return { result: computeUnderwriting(inputs), facts, assignment: inputs.assignment, issues, computeError: null };
    } catch (e: any) {
      return {
        result: null, facts: null as DealFacts | null,
        assignment: null as AssignmentResolution | null, issues: [],
        computeError: { field: null, message: e?.message ?? "A configured value could not be interpreted." },
      };
    }
  }, [contact, opps, policyValues, selected]);

  const screen: ScreenState = toViewModel({
    loading,
    fetchError,
    computeError: pipeline.computeError,
    candidates,
    selected,
    result: pipeline.result,
    facts: pipeline.facts,
    assignment: pipeline.assignment,
    issues: pipeline.issues,
    approve,
  });

  /**
   * PB-D59 -- the Approve write. THE ONLY place in the UI that initiates
   * an underwriting mutation.
   *
   * The page owns the call; the view model owns only its result. That
   * boundary matters most here, because this is the first
   * browser-reachable write in this feature and a pure view model cannot
   * accidentally issue one.
   *
   * PROVEN INERT BEFORE IT WAS REACHABLE. PB-D58 section II and PB-D59
   * Proofs A0, A and B: twenty proof steps, ten production mutations,
   * every one restored, the exact three-field payload proven on a
   * disposable fixture before this handler existed.
   */
  /**
   * Board item #2C -- the Assignment Mode write. The page owns the call; the
   * component owns only the presentation of its outcome, mirroring how Approve
   * is arranged directly below.
   *
   * A 200 IS NOT SUCCESS and this handler does not treat it as one: the method
   * re-reads the singular opportunity and reports `ok` from the readback, and a
   * write that landed differently is shown as unconfirmed rather than saved.
   * Only a confirmed write triggers the reload.
   */
  async function onSelectMode(label: string) {
    if (screen.state !== "unresolved" && screen.state !== "resolved") return;
    const opportunityId = screen.opportunity.id;
    setModeWrite({ status: "in_flight", label });
    try {
      const result = await ghl.underwriting.setAssignmentMode(opportunityId, label);
      if (result.ok) {
        setModeWrite({ status: "succeeded", label });
        setReloadTick((n) => n + 1);
      } else {
        setModeWrite({
          status: "unconfirmed",
          label,
          observed: result.observed === null ? "nothing" : String(result.observed),
        });
      }
    } catch (e: any) {
      setModeWrite({ status: "failed", label, message: e?.message ?? "The write could not be completed." });
    }
  }

  /* The label GHL currently holds, for the selector's "Currently ..." line.
     Read from the RAW DEAL FACT, not from the resolution.

     ⚠ THE MODE THE OPERATOR SET AND THE RESOLUTION THE MATH REACHED ARE
     DIFFERENT FACTS, and this selector is the first surface where the gap is
     visible. resolver.ts sets facts.assignmentMode to {kind:"value",
     value:"manual"} whenever the picker says Manual, but manualSpread is
     hardcoded null (the carrier gap: GHL records WHICH mode governs and nothing
     records the dollar figure), so resolveInputs always returns an UNRESOLVED
     assignment for Manual. Reading the resolution therefore made
     currentModeLabel unreachable for "Manual" — an opportunity whose mode was
     genuinely set claimed "Not set on this opportunity", the carrier-gap note
     stopped rendering after reload, and the Manual button stayed enabled to
     write Manual over Manual.

     A set mode that cannot resolve is exactly what Manual IS. Offering it is
     only defensible while the surface stays honest about it, and honesty here
     means reporting what GHL holds rather than what the calculator could do
     with it. */
  const currentModeLabel: string | null =
    pipeline.facts !== null && pipeline.facts.assignmentMode.kind === "value"
      ? OPTION_BY_MODE[pipeline.facts.assignmentMode.value]
      : null;

  /* The resolver's own reason when there is no readable mode. Two distinct
     causes — absent, and present-but-unrecognised — and the page reports which
     rather than assuming the first. */
  const modeAbsentReason: string | null =
    pipeline.facts !== null && pipeline.facts.assignmentMode.kind === "unresolved"
      ? pipeline.facts.assignmentMode.reason
      : null;

  async function onApprove() {
    if (screen.state !== "resolved") return;
    if (screen.approve.status === "in_flight") return;

    setApprove({ status: "in_flight" });

    try {
      /* The domain discriminant maps to a GHL option label HERE, at the
         write boundary, through the single mapping in resolver-types.ts.
         The screen contract carries the discriminant and never the label. */
      const result = await ghl.underwriting.saveUnderwritingFields(screen.opportunity.id, {
        endBuyerMaxPrice: screen.figures.endBuyerMaxPrice,
        sellerMAO: screen.figures.sellerMAO,
        assignmentMode: OPTION_BY_MODE[screen.assignment.kind],
      });

      if (result.ok) {
        setApprove({ status: "succeeded" });
        return;
      }

      /* PARTIAL. Some carriers landed and some did not, so the record IS
         changed. PB-D59 section IV: reported, never silently compensated,
         and never represented to the operator as approved. No retry is
         offered -- a second write over a partially applied state needs a
         human deciding what the state should be. */
      setApprove({
        status: "partial",
        message: `${result.landed} of 3 fields were saved. The opportunity has changed and is not approved.`,
        landed: result.landed,
        carriers: result.carriers.map((c) => ({
          key: c.key,
          landed: c.landed,
          sent: c.sent,
          observed: c.observed,
        })),
      });
    } catch (e: any) {
      /* FAILED. The PUT threw or returned non-2xx, so nothing was written
         and the record is unchanged. A retry is meaningful and safe, which
         is exactly what distinguishes this from partial. */
      setApprove({
        status: "failed",
        message: e?.message ?? "The write could not be completed.",
      });
    }
  }

  return (
    <Shell contactId={contactId}>
      <div style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", margin: 0 }}>
          Underwriting
        </h1>
        <div style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
          {contactName(contact)}
          {/* The opportunity name falls back to the contact name when GHL
              carries none, so the two are frequently identical. Showing
              "Name · Name" is noise; show the deal only when it differs. */}
          {(screen.state === "resolved" || screen.state === "unresolved" || screen.state === "configuration_error")
            && screen.opportunity.name !== contactName(contact)
            ? <> · <span style={{ color: "#94A3B8" }}>{screen.opportunity.name}</span></>
            : null}
        </div>
      </div>

      {screen.state === "loading" ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#64748B", fontSize: "13px" }}>
          <Loader2 size={14} className="animate-spin" /> Loading underwriting…
        </div>
      ) : null}

      {screen.state === "fetch_error" ? (
        <Notice tone="error" title="Could not load underwriting" body={screen.message} />
      ) : null}

      {screen.state === "orchestration_error" ? (
        <Notice tone="error" title="Underwriting could not be assembled" body={screen.detail} />
      ) : null}

      {screen.state === "no_opportunity" ? (
        <Notice
          tone="info"
          title="No opportunity on this contact"
          body="Underwriting belongs to the deal, not the person (PB-D55). Nothing is written to the contact as a substitute. Create an opportunity in GHL to underwrite this property."
        />
      ) : null}

      {screen.state === "awaiting_selection" ? (
        <div>
          <Notice
            tone="info"
            title="Select the deal to underwrite"
            body="This contact holds more than one opportunity. IAOS does not assume the first one is the deal."
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px" }}>
            {screen.candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => setChosenId(c.id)}
                style={{
                  textAlign: "left", padding: "12px 16px", background: "#0F172A",
                  border: "1px solid #1E293B", borderRadius: "8px", color: "#E2E8F0",
                  fontSize: "13px", cursor: "pointer",
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {screen.state === "configuration_error" ? (
        <Notice
          tone="error"
          title="Underwriting configuration error"
          body={`A configured value could not be interpreted safely${screen.field ? ` (${screen.field})` : ""}. ${screen.message}`}
        />
      ) : null}

      {screen.state === "unresolved" || screen.state === "resolved" ? (
        <>
          {/* Known facts show whether or not underwriting resolved. Being
              told what is missing while what is known is blank is the
              opposite of useful during a call. */}
          <Rail
            ask={screen.known.askingPrice}
            arv={screen.known.arv}
            repairs={screen.known.repairs}
            mao={screen.state === "resolved" ? screen.figures.sellerMAO : null}
            waiting={screen.state === "unresolved" ? "Waiting for " + screen.missingLabels.join(", ") : null}
          />

          {screen.banner.issues.length > 0 ? (
            <div style={{ marginBottom: "18px" }}>
              <Notice
                tone="warn"
                title={`${screen.banner.issues.length} investor-policy value${screen.banner.issues.length === 1 ? "" : "s"} could not be read`}
                body={screen.banner.issues.map((i) => `${i.key}: "${i.raw}" — ${i.reason}`).join("; ") +
                      ". IAOS Starter policy was used for these."}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {/* Operator language only -- `missing` carries internal keys and is
          never rendered. The previous copy claimed every non-Gate-1 input
          resolves from policy, which is false for Assignment Mode: it is a
          deal fact read from the Opportunity, has no starter fallback, and
          no policy value can clear it. */}
      {screen.state === "unresolved" ? (
        <>
          <Notice
            tone="warn"
            title="Underwriting cannot begin"
            body={
              screen.missingLabels.length === 1
                ? `${screen.missingLabels[0]} is not set for this opportunity.`
                : `Not set for this opportunity: ${screen.missingLabels.join(", ")}.`
            }
          />
          {/* Board item #2C. Beside the notice that names the problem, because an
              unset Assignment Mode is one of the things that notice is naming and
              this is the only control that fixes it. */}
          <AssignmentModeSelector
            currentLabel={currentModeLabel}
            absentReason={modeAbsentReason}
            state={modeWrite}
            onSelect={onSelectMode}
          />
          {/* INV-12. Repairs is a Gate 1 input, so an unresolved deal is
              frequently unresolved BECAUSE the repair number does not exist
              yet. This is the surface that produces one during the call. */}
          <RepairEstimator
            contactId={contactId}
            onPersisted={() => setReloadTick((t) => t + 1)}
          />
        </>
      ) : null}

      {screen.state === "resolved" ? (
        <>
          {/* Zone 2 — Decision Panel */}
          <div style={{
            display: "flex", gap: "36px", flexWrap: "wrap", padding: "20px",
            background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px",
          }}>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>End-Buyer Maximum Purchase Price</div>
              <div style={{ fontSize: "24px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#E2E8F0" }}>
                {money(screen.figures.endBuyerMaxPrice)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Seller MAO</div>
              <div style={{ fontSize: "24px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#1EC8FF" }}>
                {money(screen.figures.sellerMAO)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Acquisition Position</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#94A3B8", paddingTop: "6px" }}>
                {screen.position.position === "asking_unknown" ? "Asking price unknown" : null}
                {screen.position.position === "within_range"
                  ? <span style={{ color: "#22C55E" }}>Within range · cushion {money(screen.position.acquisitionCushion)}</span> : null}
                {screen.position.position === "above_range"
                  ? <span style={{ color: "#F59E0B" }}>Above range · gap {money(screen.position.gapToUnderwriting)}</span> : null}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Assignment Spread</div>
              <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#E2E8F0", paddingTop: "3px" }}>
                {money(screen.figures.assignmentSpread)}
              </div>
            </div>
          </div>

          {screen.warnings.map((w) => (
            <div key={w.code} style={{ marginTop: "14px" }}>
              <Notice
                tone="warn"
                title="Outside standard parameters"
                body={`The manual assignment spread of ${money(w.spread)} is below the configured standard minimum of ${money(w.minimum)}. This is permitted and is not blocked.`}
              />
            </div>
          ))}

          {/* Zone 4 — Explain the Math */}
          <div style={{ marginTop: "22px" }}>
            <div style={{ fontSize: "11px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
              How this was calculated
            </div>
            <div style={{
              padding: "18px 20px", background: "#0F172A", border: "1px solid #1E293B",
              borderRadius: "10px", fontFamily: "Space Grotesk, monospace", fontSize: "13px",
            }}>
              {screen.breakdown.map((line) => (
                <div key={line.label} style={{
                  display: "flex", justifyContent: "space-between", gap: "24px", padding: "4px 0",
                  color: line.label === "Seller MAO" || line.label === "Base Buyer Capacity"
                    || line.label === "End-Buyer Maximum Purchase Price" ? "#E2E8F0" : "#94A3B8",
                  fontWeight: line.label === "Seller MAO" ? 700 : 400,
                  borderTop: line.label === "Base Buyer Capacity" || line.label === "Seller MAO"
                    ? "1px solid #1E293B" : "none",
                  marginTop: line.label === "Base Buyer Capacity" || line.label === "Seller MAO" ? "6px" : 0,
                  paddingTop: line.label === "Base Buyer Capacity" || line.label === "Seller MAO" ? "10px" : "4px",
                }}>
                  <span>{line.label}</span>
                  <span>{money(line.amount)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", gap: "24px", padding: "4px 0", color: "#475569", fontSize: "11px", marginTop: "8px" }}>
                <span>financing factor</span>
                <span>{screen.figures.financingFactor.toFixed(4)}</span>
              </div>
            </div>

            <div style={{ marginTop: "14px", fontSize: "11px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
              Where each assumption came from
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px", fontSize: "12px", color: "#64748B" }}>
              {Object.entries(screen.provenance).map(([key, level]) => (
                <span key={key}>
                  {ASSUMPTION_LABEL[key] ?? key}: <span style={{ color: "#94A3B8" }}>{level === null ? "not used" : LEVEL_LABEL[level] ?? level}</span>
                </span>
              ))}
            </div>
          </div>

          <ApproveControl
            state={screen.approve}
            onApprove={onApprove}
            warningCount={screen.warnings.length}
          />

          {/* Board item #2C, resolved-state placement. Additive: a resolved deal
              can have its mode changed and its figures recomputed without going
              through GHL. The unresolved placement above is the one that makes
              the feature reachable at all; this one makes it useful afterwards.
              Below Approve deliberately — changing the mode changes the figures
              Approve would write, so it reads as a revision of the inputs rather
              than an alternative to approving. */}
          <AssignmentModeSelector
            currentLabel={currentModeLabel}
            absentReason={modeAbsentReason}
            state={modeWrite}
            onSelect={onSelectMode}
          />
          {/* INV-12, resolved-state placement. Beside the mode selector, in
              the same revise-the-inputs zone: a resolved deal can still have
              its repair allowance worked during the call. */}
          <RepairEstimator
            contactId={contactId}
            onPersisted={() => setReloadTick((t) => t + 1)}
          />
        </>
      ) : null}
    </Shell>
  );
}
