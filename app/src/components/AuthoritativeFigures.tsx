/**
 * Board #15 B15-22 / INV-131 -- the small presentational pieces that say
 * which figure counts. Props in, markup out: no fetch, no state, no effect,
 * no write. The wording lives in lib/authoritative-figures.ts.
 */
import {
  LIVE_SELLER_MAO_LABEL, RECORDED_SELLER_MAO_LABEL, arvOnRecordText,
  type ArvOnRecord, type SellerMaoComparison,
} from "../lib/authoritative-figures";

/** Underwriting rail: the RECORDED approved Seller MAO (and, while underwriting cannot run, what the calculation waits for). */
export function RecordedSellerMaoCell({ comparison, waiting }: { comparison: SellerMaoComparison; waiting: string | null }) {
  return (
    <div data-testid="underwriting-rail-recorded-mao" style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: "128px" }}>
      <span data-testid="underwriting-rail-recorded-mao-label" style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>Seller MAO · {RECORDED_SELLER_MAO_LABEL}</span>
      <span data-testid="underwriting-rail-recorded-mao-value" style={{ fontSize: "18px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#1EC8FF" }}>{comparison.recordedText}</span>
      {waiting ? (
        <span data-testid="underwriting-rail-calculated-waiting" style={{ fontSize: "12px", color: "#F59E0B", fontWeight: 600 }}>Calculated now: {waiting}</span>
      ) : null}
    </div>
  );
}

/** Underwriting decision panel: the Seller MAO calculated now, and how it stands against the record. */
export function LiveSellerMaoFigure({ text, comparison }: { text: string; comparison: SellerMaoComparison }) {
  return (
    <div>
      <div data-testid="underwriting-live-mao-label" style={{ fontSize: "9px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>{LIVE_SELLER_MAO_LABEL}</div>
      <div data-testid="underwriting-live-mao-value" style={{ fontSize: "24px", fontWeight: 700, fontFamily: "Space Grotesk, monospace", color: "#1EC8FF" }}>
        {text}
      </div>
      {comparison.liveNote ? (
        <div data-testid="underwriting-live-mao-note" data-mao-comparison={comparison.token} style={{ fontSize: "11px", color: comparison.token === "matches" ? "#22C55E" : "#F59E0B", marginTop: "2px", maxWidth: "220px" }}>
          {comparison.liveNote}
        </div>
      ) : null}
    </div>
  );
}

/** ARV workspace: the approved ARV on record, above this session's comps. */
export function ArvOnRecordLine({ state }: { state: ArvOnRecord }) {
  return (
    <div data-testid="arv-on-record" data-arv-on-record={state.kind} style={{ marginTop: "12px", padding: "9px 12px", borderRadius: "8px", background: "#0A0E1A", color: state.kind === "approved" ? "#E2E8F0" : "#94A3B8", fontSize: "12px" }}>
      {arvOnRecordText(state)}
    </div>
  );
}
