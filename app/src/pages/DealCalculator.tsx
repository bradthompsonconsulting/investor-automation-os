import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Calculator, ChevronDown, ChevronUp, ExternalLink, Link2, Unlink, Loader2, RotateCcw, Save,
} from "lucide-react";
import { ghl } from "../lib/ghl";
import { getRuntimeConfig } from "../../shared/ghl-config";
import { parseContactSeeds, parsePolicy } from "../lib/underwriting/resolver";
import { IAOS_STARTERS } from "../lib/underwriting/starters";
import { computeUnderwriting } from "../lib/underwriting/compute";
import {
  computeBoard8Economics, computeExpectedSpread,
  type Board8Economics, type ExpectedSpread,
} from "../lib/underwriting/board8-economics";
import {
  buildDealCalculatorInputs, parseNonNegativeAmountInput, DEFAULT_ASSIGNMENT_MODE,
  type DealCalculatorAssignment,
} from "../lib/deal-calculator-inputs";
import { buildDealCalculatorBarCells, type DealCalcBarCell } from "../lib/deal-calculator-bar";
import { parseAcquisitionPriceInput } from "../lib/seller-call-negotiation";
import {
  OPERATOR_ROWS, EMPTY_ANSWER, applyCondition, applyAmount, applyQuantity,
  quantitySpecFor, operatorEstimate, isUntouched,
  type Answers, type OperatorCondition,
} from "../lib/repair-estimation/operator-model";
import { computeRepairEstimate } from "../lib/repair-estimation/compute";
import { persistGate, persistApprovedRepairTotal, type RepairApproval } from "../lib/repair-estimation/persist";
import type { AssignmentModeName } from "../lib/underwriting/resolver-types";

/**
 * Standalone Deal Calculator -- B8-09 / INV-52.
 *
 * Route: /deal-calculator. A brand-new numbers-first face over the SAME
 * authoritative Board #8 engine Seller Call and Underwriting already
 * consume -- `resolveInputs`, `computeUnderwriting`, `computeBoard8Economics`,
 * and `computeExpectedSpread` (all imported, none reimplemented). This
 * page creates NO second economics engine: `deal-calculator-inputs.ts` is
 * the ONLY new logic, and its entire job is constructing the same
 * `UnderwritingInputs` shape from scratchpad state instead of a GHL
 * Opportunity, because a standalone calculator has neither by default.
 *
 * NO CONTACT/OPPORTUNITY REQUIRED. Opening this page cold performs no GHL
 * read that blocks rendering -- the only network call is a background,
 * non-blocking read of location-level Investor Policy (`ghl.underwriting
 * .policy()`, the SAME call Seller Call and Underwriting already make),
 * and even that read failing or being slow does not prevent the six
 * primary numbers from calculating: `buildDealCalculatorInputs` falls
 * through to IAOS Starter defaults exactly as `resolveInputs` already
 * does for any real deal with no configured Investor Policy.
 *
 * REFERENCE PRICE IS "test_price", NOT "current_offer". B8-01/B8-02
 * reserved this exact name for this exact surface -- see
 * `board8-economics.ts`'s own `ReferenceKind` and
 * `deal-calculator-bar.ts`'s header. This is a materially different
 * surface from Seller Call's live negotiation (B8-08 / INV-51): there is
 * no Max-crossing warning, no bounded-action flow, no override here --
 * INV-52 is explicit that downstream negotiation work is out of scope.
 *
 * ASSIGNMENT MODE, WHY IT EXISTS HERE AT ALL. See
 * `deal-calculator-inputs.ts`'s header for the full reasoning: Target and
 * Max do not mathematically depend on assignment mode, but
 * `computeUnderwriting`'s own gate will not resolve ANY figure without
 * one, and no Investor Policy or IAOS Starter level exists for it. Per
 * Brad's Jess Gate correction (2026-09-06), the selector defaults to
 * `profit_share` -- the existing 25% Buyer Profit Share target with the
 * existing $5,000 Standard Minimum as its floor, both EXISTING Investor
 * Policy values, no new dollar amount or formula -- and lives under More
 * Detail alongside the eleven read-only Investor Policy figures, with
 * Standard and Manual fully selectable there too.
 *
 * QUICK REPAIRS, OPTIONAL DEEPER ESTIMATOR -- NO SECOND REPAIR ENGINE.
 * "Quick" is a single operator-typed number. "Detailed" reuses Board 6's
 * OWN pure functions verbatim -- `OPERATOR_ROWS`, `applyCondition`,
 * `buildLines` (via `operatorEstimate`), `computeRepairEstimate` -- the
 * exact functions `UnderwritingWorkspace.tsx`'s real repair estimator
 * calls. The two modes are mutually exclusive by construction: exactly
 * one produces the `repairs` figure fed into economics, per the same
 * "no silent double-count" rule Board 6's own UI already enforces.
 *
 * OPTIONAL LINKING IS CONTACT-LEVEL, NOT OPPORTUNITY-LEVEL, AND FOR A
 * DELIBERATE REASON. Repairs save-back (`persist.ts`'s `persistGate` /
 * `persistApprovedRepairTotal`) writes to `contact.estimated_repairs` and
 * needs only a Contact ID -- no Opportunity resolution at all. Reading
 * `parseContactSeeds` off a linked Contact's own custom fields (the SAME
 * PB-D55 "seed" concept Seller Call/Underwriting already read) is enough
 * to prepopulate ARV/Repairs, ONLY into fields still empty -- linking
 * never overwrites a value already typed. `/contacts/:id/underwriting`
 * (linked to, never embedded) already handles multi-opportunity selection
 * internally, so this page does not need to resolve one itself.
 *
 * ARV IS NEVER SAVED BACK FROM HERE -- A DELIBERATE, DOCUMENTED SCOPE
 * BOUNDARY, NOT AN OVERSIGHT. Board 7's authoritative ARV write
 * (`arv-persist.ts`'s `persistApprovedArv`) requires real comp evidence --
 * evidence state, reconciliation outcome, accepted comp count, search
 * level -- none of which a bare typed ARV number on this scratchpad ever
 * has. Fabricating that evidence to unlock a write here would violate
 * PB-D61's evidence doctrine and this issue's own "no invented carriers
 * or policy" HARD NO. When linked, this page instead links to the real
 * ARV & Comps workspace, exactly as Seller Call (B8-07) already does.
 *
 * READ ONLY, EXCEPT THE ONE SANCTIONED REPAIRS WRITE. This page performs
 * no write of any kind except `ghl.contacts.setEstimatedRepairs`, gated
 * by the SAME `persistGate` Board 6's real UI uses, and only when a
 * Contact is linked and the operator explicitly clicks Save.
 */

const CONFIG = getRuntimeConfig();
const CV_IDS = CONFIG.customValues;
const CONTACT_IDS = {
  arv: CONFIG.fields.arv,
  repairs: CONFIG.fields.estimatedRepairs,
  askingPrice: CONFIG.fields.askingPrice,
};

const PANEL_STYLE: React.CSSProperties = {
  padding: "16px 18px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px",
};
const LABEL_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "#64748B" };
const INPUT_STYLE: React.CSSProperties = {
  background: "#0D1B3E", border: "1px solid #1E293B", borderRadius: "6px",
  padding: "8px 10px", color: "#E2E8F0", fontSize: "13px", width: "160px",
};
const COMPACT_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600,
  padding: "6px 10px", borderRadius: "7px", border: "1px solid rgba(30,200,255,0.35)",
  background: "rgba(30,200,255,0.08)", color: "#1EC8FF", textDecoration: "none", cursor: "pointer",
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(n: number): string {
  return `${(n * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** Renders one Investor Policy row: the resolved value (or IAOS Starter fallback) and which level supplied it. */
function policyRow(
  label: string,
  resolved: { kind: "value"; value: number; level: "investor_policy" } | { kind: "unresolved"; reason: string },
  fallback: number,
  format: (n: number) => string,
) {
  const value = resolved.kind === "value" ? resolved.value : fallback;
  const level = resolved.kind === "value" ? "Investor Policy" : "IAOS Starter";
  return (
    <div key={label}>
      {label}: {format(value)} <span style={{ color: "#475569" }}>({level})</span>
    </div>
  );
}

function BarCellView({ cell }: { cell: DealCalcBarCell }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "128px" }}>
      <span style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {cell.label}
      </span>
      {cell.value.kind === "value" ? (
        <span style={{ fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#E2E8F0" }}>
          {cell.value.text}
        </span>
      ) : (
        <span style={{ fontSize: "11px", color: "#F59E0B", fontWeight: 600, paddingTop: "4px", lineHeight: 1.4 }} title={cell.value.text}>
          {cell.value.text}
        </span>
      )}
    </div>
  );
}

const CONDITION_LABEL: Record<OperatorCondition, string> = {
  not_asked: "Not asked", good: "Good", repair: "Repair", severe: "",
};

export default function DealCalculator() {
  const [searchParams] = useSearchParams();
  const linkParam = searchParams.get("contactId");

  /* Primary What-If inputs. Raw strings so an in-progress keystroke is
     never lost to a parse; parseAcquisitionPriceInput (ARV, Test Price)
     and parseNonNegativeAmountInput (quick Repairs) are the ONE place
     either becomes a number. Neither ARV, Repairs, nor Test Price is ever
     assigned by anything except the operator's own typing -- IAOS invents
     none of the three, per this issue's own explicit requirement. */
  const [arvInput, setArvInput] = useState("");
  const [repairsQuickInput, setRepairsQuickInput] = useState("");
  const [testPriceInput, setTestPriceInput] = useState("");

  const arvParsed = useMemo(() => parseAcquisitionPriceInput(arvInput), [arvInput]);
  const repairsQuickParsed = useMemo(() => parseNonNegativeAmountInput(repairsQuickInput), [repairsQuickInput]);
  const testPriceParsed = useMemo(() => parseAcquisitionPriceInput(testPriceInput), [testPriceInput]);

  const arv = arvParsed.kind === "value" ? arvParsed.value : null;
  const testPrice = testPriceParsed.kind === "value" ? testPriceParsed.value : null;

  /* Repairs: quick (a single typed number) or detailed (Board 6's own
     operator model, reused verbatim) -- mutually exclusive by
     construction, exactly like Board 6's real UI. */
  const [repairsMode, setRepairsMode] = useState<"quick" | "detailed">("quick");
  const [repairAnswers, setRepairAnswers] = useState<Answers>({});
  const [repairRevision, setRepairRevision] = useState(0);

  const detailedEstimate = useMemo(
    () => operatorEstimate(repairAnswers, (lines) => computeRepairEstimate({ lines, property: { squareFeet: null, bathroomCount: null } })),
    [repairAnswers],
  );

  const repairs =
    repairsMode === "quick"
      ? (repairsQuickParsed.kind === "value" ? repairsQuickParsed.value : null)
      : (isUntouched(repairAnswers) ? null : detailedEstimate.total);

  function bumpRepairRevision() {
    setRepairRevision((r) => r + 1);
  }

  function handleRowCondition(system: string, condition: OperatorCondition) {
    const row = OPERATOR_ROWS.find((r) => r.system === system);
    if (!row) return;
    setRepairAnswers((prev) => ({ ...prev, [system]: applyCondition(row, condition, prev[system] ?? EMPTY_ANSWER) }));
    bumpRepairRevision();
  }
  function handleRowAmount(system: string, raw: string) {
    setRepairAnswers((prev) => ({ ...prev, [system]: applyAmount(prev[system] ?? EMPTY_ANSWER, raw) }));
    bumpRepairRevision();
  }
  function handleRowQuantity(system: string, raw: string) {
    const row = OPERATOR_ROWS.find((r) => r.system === system);
    if (!row) return;
    setRepairAnswers((prev) => ({ ...prev, [system]: applyQuantity(row, prev[system] ?? EMPTY_ANSWER, raw) }));
    bumpRepairRevision();
  }

  /* Assignment mode. Defaults to profit_share (25% Buyer Profit Share,
     floored at the existing $5,000 Standard Minimum) per Brad's Jess Gate
     correction -- see deal-calculator-inputs.ts's header for why this
     default is a UI convenience over an enum with no real-world value to
     preserve, not an invented policy figure. */
  const [assignmentMode, setAssignmentMode] = useState<AssignmentModeName>(DEFAULT_ASSIGNMENT_MODE);
  const [manualAmountInput, setManualAmountInput] = useState("");
  const manualAmountParsed = useMemo(() => parseNonNegativeAmountInput(manualAmountInput), [manualAmountInput]);
  const assignment: DealCalculatorAssignment = useMemo(() => {
    if (assignmentMode === "manual") {
      return { mode: "manual", amount: manualAmountParsed.kind === "value" ? manualAmountParsed.value : null };
    }
    return { mode: assignmentMode };
  }, [assignmentMode, manualAmountParsed]);

  const [moreDetailOpen, setMoreDetailOpen] = useState(false);

  /* Investor Policy -- background, non-blocking. `null` means "not yet
     read"; buildDealCalculatorInputs treats that the same as an empty
     read (IAOS Starter fallback), so the six numbers never wait on this
     network call. */
  const [policyValues, setPolicyValues] = useState<{ id: string; value: string }[] | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    ghl.underwriting.policy()
      .then((p) => { if (!cancelled) setPolicyValues(p.values); })
      .catch((e: Error) => { if (!cancelled) { setPolicyValues([]); setPolicyError(e.message); } });
    return () => { cancelled = true; };
  }, []);

  const underwritingResult = useMemo(
    () => computeUnderwriting(buildDealCalculatorInputs({
      arv, repairs, assignment, policyValues: policyValues ?? [], policyIds: CV_IDS,
    })),
    [arv, repairs, assignment, policyValues],
  );
  const board8: Board8Economics = useMemo(() => computeBoard8Economics(underwritingResult), [underwritingResult]);
  const expectedSpread: ExpectedSpread = useMemo(
    () => computeExpectedSpread({ endBuyerMaxPrice: board8.status === "calculated" ? board8.endBuyerMaxPrice : 0, referenceKind: "test_price", referencePrice: board8.status === "calculated" ? testPrice : null }),
    [board8, testPrice],
  );

  /* Investor Policy, read-only display under More Detail. Reuses
     parsePolicy verbatim -- this page never edits these values (no
     Deal Override carrier exists for them anywhere in IAOS, per B8-02,
     and inventing an edit surface here would let this calculator's
     economics diverge from Seller Call/Underwriting's, which is exactly
     what INV-52's "same economics ... for identical inputs" forbids). */
  const parsedPolicy = useMemo(() => parsePolicy(policyValues ?? [], CV_IDS).policy, [policyValues]);

  const barCells = useMemo(
    () => buildDealCalculatorBarCells({ arv, repairs, testPrice, board8, expectedSpread }),
    [arv, repairs, testPrice, board8, expectedSpread],
  );

  /* Optional linking. Contact-level only -- see module header for why no
     Opportunity resolution happens here at all. */
  const [linkedContactId, setLinkedContactId] = useState<string | null>(null);
  const [linkedContactName, setLinkedContactName] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState(linkParam ?? "");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function performLink(contactId: string) {
    if (contactId.trim() === "") return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const contact = await ghl.contacts.getDetail(contactId.trim());
      const seeds = parseContactSeeds(contact.customFields, CONTACT_IDS);
      // Prepopulate ONLY fields still empty -- linking is a one-time
      // convenience (PB-D55), never a silent overwrite of a typed value.
      if (arvInput.trim() === "" && seeds.arv !== null) setArvInput(String(seeds.arv));
      if (repairsQuickInput.trim() === "" && seeds.repairs !== null) setRepairsQuickInput(String(seeds.repairs));
      setLinkedContactId(contact.id);
      setLinkedContactName([contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.id);
    } catch (e: any) {
      setLinkError(e?.message ?? "Could not load that contact.");
    } finally {
      setLinkBusy(false);
    }
  }

  useEffect(() => {
    if (linkParam) void performLink(linkParam);
    // Intentionally runs once, off the URL param only -- re-linking after
    // that is an explicit operator action via the Link button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUnlink() {
    setLinkedContactId(null);
    setLinkedContactName(null);
    setLinkError(null);
  }

  /* Repairs save-back. The ONLY write this page performs, gated by the
     SAME persistGate Board 6's real UI uses. ARV is deliberately never
     saved back here -- see module header. */
  const [repairApproval, setRepairApproval] = useState<RepairApproval>({ kind: "none" });
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<
    { ok: true; confidence: "saved" | "unconfirmed" } | { ok: false; error: string } | null
  >(null);

  async function handleSaveRepairs() {
    if (!linkedContactId || repairs === null) return;
    setSaveBusy(true);
    setSaveResult(null);
    const approval: RepairApproval = { kind: "approved", total: repairs, revision: repairRevision };
    setRepairApproval(approval);
    const gate = persistGate(approval, repairRevision, repairs);
    const result = await persistApprovedRepairTotal(ghl as any, linkedContactId, CONTACT_IDS.repairs, gate);
    setSaveBusy(false);
    if (result.ok) {
      setSaveResult({ ok: true, confidence: result.confidence });
    } else {
      setSaveResult({ ok: false, error: result.error });
    }
  }

  function handleClear() {
    setArvInput("");
    setRepairsQuickInput("");
    setTestPriceInput("");
    setRepairsMode("quick");
    setRepairAnswers({});
    setRepairRevision(0);
    setAssignmentMode(DEFAULT_ASSIGNMENT_MODE);
    setManualAmountInput("");
    setRepairApproval({ kind: "none" });
    setSaveResult(null);
    // Clear does not unlink -- clearing the scratchpad and severing the
    // link are two different bounded actions, matching this issue's own
    // "Clear/Reset" bullet, distinct from "optional linking."
  }

  return (
    <div style={{ maxWidth: "1200px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#E2E8F0", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Calculator size={20} style={{ color: "#1EC8FF" }} /> Deal Calculator
          </h1>
          <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
            A scratchpad. No contact or opportunity required -- type what you know.
          </div>
        </div>
        <button data-testid="deal-calc-clear" onClick={handleClear} style={{ ...COMPACT_BUTTON_STYLE }}>
          <RotateCcw size={12} /> Clear
        </button>
      </div>

      {/* Primary bar -- ARV | Repairs | Test Price | Target | Max | Spread. */}
      <div
        data-testid="deal-calc-primary-bar"
        style={{
          display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start",
          padding: "16px 20px", background: "#0F172A", border: "1px solid #1E293B",
          borderRadius: "10px", margin: "14px 0",
        }}
      >
        {barCells.map((cell) => <BarCellView key={cell.key} cell={cell} />)}
      </div>

      {/* What-If editing. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
        <div style={PANEL_STYLE}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>ARV</div>
          <input
            data-testid="deal-calc-arv-input"
            value={arvInput}
            onChange={(e) => setArvInput(e.target.value)}
            placeholder="Not yet entered"
            style={{ ...INPUT_STYLE, width: "100%" }}
          />
          {arvParsed.kind === "invalid" ? (
            <div data-testid="deal-calc-arv-error" style={{ color: "#EF4444", fontSize: "10px", marginTop: "4px" }}>{arvParsed.reason}</div>
          ) : null}
        </div>

        <div style={PANEL_STYLE}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8" }}>Repairs</span>
            <button
              data-testid="deal-calc-repairs-mode-toggle"
              onClick={() => setRepairsMode((m) => (m === "quick" ? "detailed" : "quick"))}
              style={{ ...COMPACT_BUTTON_STYLE, fontSize: "10px", padding: "4px 8px" }}
            >
              {repairsMode === "quick" ? "Itemize repairs ▾" : "Quick number"}
            </button>
          </div>
          {repairsMode === "quick" ? (
            <>
              <input
                data-testid="deal-calc-repairs-quick-input"
                value={repairsQuickInput}
                onChange={(e) => { setRepairsQuickInput(e.target.value); bumpRepairRevision(); }}
                placeholder="Not yet entered"
                style={{ ...INPUT_STYLE, width: "100%" }}
              />
              {repairsQuickParsed.kind === "invalid" ? (
                <div data-testid="deal-calc-repairs-error" style={{ color: "#EF4444", fontSize: "10px", marginTop: "4px" }}>{repairsQuickParsed.reason}</div>
              ) : null}
            </>
          ) : (
            <div data-testid="deal-calc-repairs-detailed" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {OPERATOR_ROWS.map((row) => {
                const answer = repairAnswers[row.system] ?? EMPTY_ANSWER;
                const qSpec = quantitySpecFor(row);
                return (
                  <div key={row.system} style={{ display: "flex", flexDirection: "column", gap: "4px", paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ fontSize: "11px", color: "#94A3B8" }}>{row.label}</span>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {(["not_asked", "good", "repair", "severe"] as OperatorCondition[]).map((c) => (
                        <button
                          key={c}
                          data-testid={`deal-calc-repair-${row.system}-${c}`}
                          onClick={() => handleRowCondition(row.system, c)}
                          style={{
                            ...COMPACT_BUTTON_STYLE, fontSize: "10px", padding: "4px 7px",
                            background: answer.condition === c ? "rgba(30,200,255,0.25)" : COMPACT_BUTTON_STYLE.background,
                          }}
                        >
                          {c === "severe" ? row.severeLabel : CONDITION_LABEL[c]}
                        </button>
                      ))}
                      {qSpec ? (
                        <input
                          data-testid={`deal-calc-repair-${row.system}-quantity`}
                          value={answer.quantity}
                          onChange={(e) => handleRowQuantity(row.system, e.target.value)}
                          placeholder={qSpec.label}
                          style={{ ...INPUT_STYLE, width: "70px", fontSize: "11px" }}
                        />
                      ) : null}
                      <input
                        data-testid={`deal-calc-repair-${row.system}-amount`}
                        value={answer.amount}
                        onChange={(e) => handleRowAmount(row.system, e.target.value)}
                        placeholder="Known amount"
                        style={{ ...INPUT_STYLE, width: "100px", fontSize: "11px" }}
                      />
                    </div>
                  </div>
                );
              })}
              <div data-testid="deal-calc-repairs-detailed-total" style={{ fontSize: "12px", color: "#94A3B8", marginTop: "4px" }}>
                {detailedEstimate.mode === "fallback"
                  ? `${money(detailedEstimate.total)} (${detailedEstimate.label})`
                  : `${money(detailedEstimate.total)} total${detailedEstimate.estimate.isCompleteAllowance ? "" : " -- unpriced risks remain"}`}
              </div>
            </div>
          )}
        </div>

        <div style={PANEL_STYLE}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Test Price</div>
          <input
            data-testid="deal-calc-test-price-input"
            value={testPriceInput}
            onChange={(e) => setTestPriceInput(e.target.value)}
            placeholder="What if we offered..."
            style={{ ...INPUT_STYLE, width: "100%" }}
          />
          {testPriceParsed.kind === "invalid" ? (
            <div data-testid="deal-calc-test-price-error" style={{ color: "#EF4444", fontSize: "10px", marginTop: "4px" }}>{testPriceParsed.reason}</div>
          ) : null}
          <div style={{ fontSize: "10px", color: "#475569", marginTop: "6px" }}>
            Operator-entered only -- IAOS never sets or defaults this.
          </div>
        </div>
      </div>

      {/* Optional linking + save-back. */}
      <div style={{ ...PANEL_STYLE, marginTop: "16px" }} data-testid="deal-calc-link-panel">
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Link (optional)</div>
        {linkedContactId ? (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span data-testid="deal-calc-linked-badge" style={{ fontSize: "13px", color: "#E2E8F0" }}>
              Linked to: {linkedContactName}
            </span>
            <button data-testid="deal-calc-unlink" onClick={handleUnlink} style={COMPACT_BUTTON_STYLE}>
              <Unlink size={12} /> Unlink
            </button>
            <Link to={`/contacts/${linkedContactId}/underwriting`} data-testid="deal-calc-view-arv-workspace" style={COMPACT_BUTTON_STYLE}>
              <ExternalLink size={12} /> ARV &amp; Comps workspace
            </Link>
            <button
              data-testid="deal-calc-save-repairs"
              onClick={handleSaveRepairs}
              disabled={saveBusy || repairs === null}
              style={{ ...COMPACT_BUTTON_STYLE, opacity: repairs === null ? 0.45 : 1, cursor: saveBusy || repairs === null ? "not-allowed" : "pointer" }}
            >
              {saveBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Repairs to {linkedContactName}
            </button>
            <div style={{ fontSize: "10px", color: "#475569" }}>
              ARV is not saved from here -- approve it with real comp evidence in the ARV &amp; Comps workspace.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <input
              data-testid="deal-calc-link-input"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Contact ID"
              style={INPUT_STYLE}
            />
            <button
              data-testid="deal-calc-link-button"
              onClick={() => void performLink(linkInput)}
              disabled={linkBusy || linkInput.trim() === ""}
              style={{ ...COMPACT_BUTTON_STYLE, opacity: linkInput.trim() === "" ? 0.45 : 1, cursor: linkBusy || linkInput.trim() === "" ? "not-allowed" : "pointer" }}
            >
              {linkBusy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Link
            </button>
          </div>
        )}
        {linkError ? <div data-testid="deal-calc-link-error" style={{ color: "#EF4444", fontSize: "11px", marginTop: "8px" }}>{linkError}</div> : null}
        {saveResult ? (
          <div data-testid="deal-calc-save-result" style={{ fontSize: "11px", marginTop: "8px", color: saveResult.ok ? "#22C55E" : "#EF4444" }}>
            {saveResult.ok
              ? `Saved${saveResult.confidence === "unconfirmed" ? " (sent, not yet confirmed by readback)" : ""}.`
              : saveResult.error}
          </div>
        ) : null}
      </div>

      {/* More Detail -- Assignment Mode + the eleven Investor Policy assumptions. */}
      <div style={{ marginTop: "16px" }}>
        <button
          data-testid="deal-calc-more-detail-toggle"
          onClick={() => setMoreDetailOpen((o) => !o)}
          style={{ ...COMPACT_BUTTON_STYLE }}
        >
          {moreDetailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} More Detail
        </button>
        {moreDetailOpen ? (
          <div style={{ ...PANEL_STYLE, marginTop: "10px" }} data-testid="deal-calc-more-detail-panel">
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "10px" }}>Assignment Mode</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
              {(["standard", "profit_share", "manual"] as AssignmentModeName[]).map((m) => (
                <button
                  key={m}
                  data-testid={`deal-calc-assignment-${m}`}
                  onClick={() => setAssignmentMode(m)}
                  style={{ ...COMPACT_BUTTON_STYLE, background: assignmentMode === m ? "rgba(30,200,255,0.25)" : COMPACT_BUTTON_STYLE.background }}
                >
                  {m === "standard" ? "Standard Minimum" : m === "profit_share" ? "25% of Buyer Profit" : "Manual"}
                </button>
              ))}
            </div>
            {assignmentMode === "manual" ? (
              <input
                data-testid="deal-calc-manual-amount-input"
                value={manualAmountInput}
                onChange={(e) => setManualAmountInput(e.target.value)}
                placeholder="Manual assignment spread"
                style={{ ...INPUT_STYLE, marginBottom: "10px" }}
              />
            ) : null}

            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", margin: "14px 0 10px" }}>
              Investor Policy (read-only{policyError ? " -- could not load; using IAOS Starter defaults" : ""})
            </div>
            <div style={{ fontSize: "11px", color: "#475569", marginBottom: "8px" }}>
              {policyValues === null
                ? "Loading Investor Policy from GHL..."
                : policyError
                ? "Could not load Investor Policy -- every value below is an IAOS Starter default."
                : `${policyValues.length} Custom Value(s) read from GHL; any not configured resolve from IAOS Starter defaults.`}
            </div>
            <div style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.8 }} data-testid="deal-calc-investor-policy">
              {policyRow("Selling Cost %", parsedPolicy.sellingCostPct, IAOS_STARTERS.sellingCostPct, pct)}
              {policyRow("Closing Cost", parsedPolicy.closingCost, IAOS_STARTERS.closingCost, money)}
              {policyRow("Monthly Carry", parsedPolicy.monthlyCarry, IAOS_STARTERS.monthlyCarry, money)}
              {policyRow("Hold Months", parsedPolicy.holdMonths, IAOS_STARTERS.holdMonths, (n) => String(n))}
              {policyRow("Buyer Profit %", parsedPolicy.buyerProfitPct, IAOS_STARTERS.buyerProfitPct, pct)}
              <div>
                Purchase Financing:{" "}
                {parsedPolicy.financingEnabled.kind === "value"
                  ? (parsedPolicy.financingEnabled.value ? "On" : "Off")
                  : (IAOS_STARTERS.financingEnabled ? "On" : "Off")}{" "}
                <span style={{ color: "#475569" }}>
                  ({parsedPolicy.financingEnabled.kind === "value" ? "Investor Policy" : "IAOS Starter"})
                </span>
              </div>
              {policyRow("Financing LTV", parsedPolicy.financingLtv, IAOS_STARTERS.financingLtv, pct)}
              {policyRow("Financing Rate", parsedPolicy.financingRate, IAOS_STARTERS.financingRate, pct)}
              {policyRow("Financing Points", parsedPolicy.financingPoints, IAOS_STARTERS.financingPoints, pct)}
              {policyRow("Standard Minimum Assignment Spread", parsedPolicy.standardMinimum, IAOS_STARTERS.standardMinimum, money)}
              {policyRow("Buyer Profit Share %", parsedPolicy.profitSharePct, IAOS_STARTERS.profitSharePct, pct)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
