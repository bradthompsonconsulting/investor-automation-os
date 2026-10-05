import { AlertCircle } from "lucide-react";
import {
  electricalOverlapPossible, MISC_ROW_LABEL, parseKnownAmount, UNANSWERED_ALLOWANCE_LABEL,
  type MiscAnswer, type OperatorEstimate,
} from "../lib/repair-estimation/operator-model";

/**
 * Board 15 / Pass 1 F39-F40 — the itemized repair estimate's shared display,
 * used by BOTH the Underwriting repair estimator and the Deal Calculator's
 * itemized mode, so the two can never show different figures or labels
 * (Bones review of PR #124; Jess ruling 2026-10-04).
 *
 * Presentational only: it renders an OperatorEstimate the caller already
 * computed with operatorEstimate(); it computes nothing and writes nothing.
 */

/** Rule 7 of Brad's 2026-10-04 amendment, in his wording. */
export const PRELIMINARY_ALLOWANCE_NOTICE =
  "Preliminary policy allowances — not verified market averages and not confirmed repair needs.";

/** Jess ruling on PR #124 review, item 3: shown, unconfirmed, nothing deducted. */
export const ELECTRICAL_OVERLAP_NOTE =
  "Possible overlap: the whole-house electrical and electrical panel amounts may cover some of the same work. Unconfirmed — nothing has been deducted.";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function RepairEstimateSummary({ result }: { result: OperatorEstimate }) {
  const fmtm = result.estimate.components.fmtmAllowance;
  const unresolved = result.estimate.unpricedRisks;
  return (
    <div data-testid="repair-estimate-summary">
      {/* Rule 2: Known Repairs, Unanswered Allowances, Preliminary Total.
          Indicated repairs and unconfirmed-condition allowances are
          economically identical in the total and informationally different,
          so they never collapse (Zone 4 discipline). */}
      <div data-testid="repair-summary" style={{
        marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #1E293B",
        fontFamily: "Space Grotesk, monospace", fontSize: "13px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#94A3B8" }}>
          <span>Known repairs</span><span data-testid="repair-known-subtotal">{money(result.knownSubtotal)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#94A3B8" }}>
          <span>Unanswered allowances ({UNANSWERED_ALLOWANCE_LABEL})</span>
          <span data-testid="repair-unanswered-subtotal">{money(result.unansweredSubtotal)}</span>
        </div>
        {fmtm.outcome.amount > 0 ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#94A3B8" }}>
              <span>{fmtm.label}</span><span>{money(fmtm.outcome.amount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0 0 6px 18px", color: "#475569", fontSize: "11px" }}>
              <span>10% of {money(fmtm.outcome.basis)} in BOOK amounts</span><span />
            </div>
          </>
        ) : null}
        <div style={{
          display: "flex", justifyContent: "space-between", padding: "10px 0 0",
          borderTop: "1px solid #1E293B", color: "#E2E8F0", fontWeight: 700,
        }}>
          <span>
            Preliminary total
            {unresolved.length > 0 ? ` (excludes ${unresolved.length} unresolved)` : ""}
          </span>
          <span data-testid="repair-preliminary-total">{money(result.total)}</span>
        </div>
        {/* Jess ruling on PR #124, item 3: beside the preliminary total, before approval. */}
        {electricalOverlapPossible(result) ? (
          <div data-testid="repair-electrical-overlap" style={{ fontSize: "11px", color: "#F59E0B", marginTop: "6px", fontFamily: "Inter, sans-serif" }}>
            {ELECTRICAL_OVERLAP_NOTE}
          </div>
        ) : null}
        <div data-testid="repair-preliminary-notice" style={{ fontSize: "11px", color: "#475569", marginTop: "6px", fontFamily: "Inter, sans-serif" }}>
          {PRELIMINARY_ALLOWANCE_NOTICE} An unanswered row carries its approved replacement amount until
          you answer it; answering replaces only that row's allowance.
        </div>
      </div>

      {/* Visible, and informational. It does not gate approval. */}
      {unresolved.length > 0 ? (
        <div data-testid="repair-unresolved" style={{
          marginTop: "14px", padding: "12px 14px", borderRadius: "8px",
          background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#F59E0B", fontSize: "12px", fontWeight: 700 }}>
            <AlertCircle size={13} /> UNRESOLVED · NOT IN THE TOTAL · {unresolved.length}
          </div>
          <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "4px" }}>
            No approved amount applies to these yet. Answer the row or enter a known amount.
          </div>
          {unresolved.map((r) => (
            <div key={r.id} data-testid={`repair-unresolved-${r.id}`} style={{ fontSize: "12px", color: "#94A3B8", marginTop: "6px" }}>
              <span style={{ color: "#E2E8F0" }}>{r.label}</span> — {r.reason}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Rule 5: Miscellaneous / Other repairs — below every table row, blank by default. */
export function MiscRepairRow({ misc, onChange, testIdPrefix = "repair-misc" }: {
  misc: MiscAnswer;
  onChange: (next: MiscAnswer) => void;
  testIdPrefix?: string;
}) {
  const invalid = parseKnownAmount(misc.amount).kind === "invalid";
  return (
    <div data-testid={`${testIdPrefix}-row`} style={{
      display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
      padding: "8px 0", borderTop: "1px solid #16202F",
    }}>
      <div style={{ width: "180px", fontSize: "13px", color: "#94A3B8" }}>{MISC_ROW_LABEL}</div>
      <input
        data-testid={`${testIdPrefix}-description`}
        value={misc.description}
        onChange={(e) => onChange({ ...misc, description: e.target.value })}
        placeholder="What it is"
        style={{
          flex: "1 1 200px", minWidth: "160px", padding: "5px 8px", fontSize: "12px", borderRadius: "6px",
          background: "#0A0E1A", border: "1px solid #1E293B", color: "#E2E8F0",
        }}
      />
      <input
        data-testid={`${testIdPrefix}-amount`}
        value={misc.amount}
        onChange={(e) => onChange({ ...misc, amount: e.target.value })}
        placeholder="Amount"
        style={{
          width: "130px", padding: "5px 8px", fontSize: "12px", borderRadius: "6px",
          background: "#0A0E1A", border: `1px solid ${invalid ? "rgba(239,68,68,0.5)" : "#1E293B"}`, color: "#E2E8F0",
        }}
      />
      <span style={{ fontSize: "10px", color: "#475569" }}>your figure · blank adds nothing</span>
    </div>
  );
}
