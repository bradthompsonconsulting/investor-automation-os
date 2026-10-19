import { useMemo, useState } from "react";
import type { ExpectedSpread } from "../lib/underwriting/board8-economics";
import { formatWholeDollars } from "../lib/deal-calculator-bar";
import { parseNonNegativeAmountInput } from "../lib/deal-calculator-inputs";
import {
  COST_LINES, EARNEST_MONEY_NOTE, NET_RESULT_LABEL, TRANSACTION_TYPE_LABEL,
  computeNetProceeds, costEntryFromInput, hasAmountDigit, netProceedsText,
  type CostEntry, type CostLineInput, type TransactionType, type WholesalerCostKey,
} from "../lib/wholesaler-net-proceeds";

/* B15-26 (INV-134) first slice -- the Deal Calculator's wholesaler net
   proceeds panel. Scratchpad only: every value here is local state, nothing
   is read from or written to GHL, and the result gates nothing. The gross
   spread is the page's existing Expected Spread, passed in unchanged; the
   end-buyer costs that priced it are never shown or deducted here. See
   lib/wholesaler-net-proceeds.ts. Clear remounts this panel (key), which
   resets it. */

type LineInput = CostLineInput;
const EMPTY_LINE: LineInput = { notApplicable: false, raw: "" };

/* B15-26 F1: the conversion lives in the pure module so it is tested as used. */
function toEntry(input: LineInput | undefined): CostEntry {
  return costEntryFromInput(input, parseNonNegativeAmountInput);
}

const PANEL: React.CSSProperties = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: "10px", padding: "14px 16px", marginTop: "16px" };
const INPUT: React.CSSProperties = { background: "#0A1633", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", color: "#E2E8F0", fontSize: "12px", padding: "6px 8px", width: "120px" };
const BUTTON: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", color: "#CBD5E1", fontSize: "11px", padding: "5px 10px", cursor: "pointer" };
const SELECTED = "rgba(30,200,255,0.25)";

export function NetProceedsPanel({ grossSpread }: { grossSpread: ExpectedSpread }) {
  const [type, setType] = useState<TransactionType | null>(null);
  const [lines, setLines] = useState<Partial<Record<WholesalerCostKey, LineInput>>>({});
  const [earnestRaw, setEarnestRaw] = useState("");

  const entries = useMemo(() => {
    const out: Partial<Record<WholesalerCostKey, CostEntry>> = {};
    for (const key of Object.keys(lines) as WholesalerCostKey[]) out[key] = toEntry(lines[key]);
    return out;
  }, [lines]);
  const result = useMemo(() => computeNetProceeds({ type, entries, grossSpread }), [type, entries, grossSpread]);
  /* F1: punctuation alone is not an earnest amount either. */
  const earnest = hasAmountDigit(earnestRaw) ? parseNonNegativeAmountInput(earnestRaw) : parseNonNegativeAmountInput("");

  function update(key: WholesalerCostKey, next: Partial<LineInput>) {
    setLines((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_LINE), ...next } }));
  }

  return (
    <div style={PANEL} data-testid="deal-calc-net-panel">
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", marginBottom: "4px" }}>Your costs and estimated net</div>
      <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px" }}>
        Separate from the buyer's costs used above. Practice figures only: nothing here is saved, and it does not change Target, Max or the spread status.
      </div>

      <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
        {(Object.keys(TRANSACTION_TYPE_LABEL) as TransactionType[]).map((t) => (
          <button
            key={t}
            data-testid={`deal-calc-net-type-${t}`}
            aria-pressed={type === t}
            onClick={() => setType(t)}
            style={{ ...BUTTON, background: type === t ? SELECTED : BUTTON.background }}
          >
            {TRANSACTION_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {type !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
          {COST_LINES[type].map((line) => {
            const input = lines[line.key] ?? EMPTY_LINE;
            const parsed = parseNonNegativeAmountInput(input.raw);
            const entry = toEntry(lines[line.key]);
            return (
              <div key={line.key} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "11px", color: "#94A3B8", minWidth: "260px" }}>{line.label}</span>
                <input
                  data-testid={`deal-calc-net-${line.key}-amount`}
                  value={input.raw}
                  disabled={input.notApplicable}
                  onChange={(e) => update(line.key, { raw: e.target.value })}
                  placeholder="Unknown"
                  style={{ ...INPUT, opacity: input.notApplicable ? 0.45 : 1 }}
                />
                <label style={{ fontSize: "11px", color: "#94A3B8", display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="checkbox"
                    data-testid={`deal-calc-net-${line.key}-na`}
                    checked={input.notApplicable}
                    onChange={(e) => update(line.key, { notApplicable: e.target.checked })}
                  />
                  Not applicable
                </label>
                <span data-testid={`deal-calc-net-${line.key}-state`} data-state={entry.kind} style={{ fontSize: "10px", color: entry.kind === "unknown" ? "#F59E0B" : "#64748B" }}>
                  {entry.kind === "unknown" ? "Unknown" : entry.kind === "not_applicable" ? "Not applicable" : formatWholeDollars(entry.amount)}
                </span>
                {parsed.kind === "invalid" && !input.notApplicable ? (
                  <span style={{ color: "#EF4444", fontSize: "10px" }}>{parsed.reason}</span>
                ) : input.raw.trim() && !hasAmountDigit(input.raw) && !input.notApplicable ? (
                  <span style={{ color: "#EF4444", fontSize: "10px" }}>Enter a dollar amount.</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div
        data-testid="deal-calc-net-result"
        data-net-status={result.kind}
        role="status"
        aria-label={NET_RESULT_LABEL}
        style={{ fontSize: "12px", fontWeight: 600, color: result.kind === "estimated" ? (result.net < 0 ? "#EF4444" : "#E2E8F0") : "#F59E0B" }}
      >
        {netProceedsText(result, formatWholeDollars)}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "12px" }} data-testid="deal-calc-net-earnest">
        <span style={{ fontSize: "11px", color: "#94A3B8", minWidth: "260px" }}>Earnest money deposit (optional)</span>
        <input data-testid="deal-calc-net-earnest-amount" value={earnestRaw} onChange={(e) => setEarnestRaw(e.target.value)} placeholder="Not entered" style={INPUT} />
        {earnest.kind === "invalid" ? <span style={{ color: "#EF4444", fontSize: "10px" }}>{earnest.reason}</span> : null}
      </div>
      <div data-testid="deal-calc-net-earnest-note" style={{ fontSize: "10px", color: "#64748B", marginTop: "4px" }}>
        {earnest.kind === "value" ? `${formatWholeDollars(earnest.value)} at risk. ` : ""}{EARNEST_MONEY_NOTE}
      </div>
    </div>
  );
}
