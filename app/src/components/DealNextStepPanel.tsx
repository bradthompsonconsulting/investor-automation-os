/**
 * B15-30 / INV-140 -- the Seller Call hub's ONE Next action for the selected deal (derived by lib/deal-next-step.ts
 * from the records the page already read). Captain REVISE 2026-11-19: it lives in the sticky deal bar, on ONE row
 * (label, the Next control, progress, reason -- the reason truncates with its full text in `title`), so at 1440x900 it
 * is visible without scrolling and the conversation still starts right under the bar.
 *
 * The control only moves focus (Seller Call) or opens a link (Underwriting, with the deal and the exact field); it
 * never writes, approves or records anything.
 */
import { Link } from "react-router-dom";
import { focusTestId } from "../lib/focus-target";
import type { NextDealStep } from "../lib/deal-next-step";

const ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: "10px", minWidth: 0, margin: "2px 0 4px" };
const TAG: React.CSSProperties = { flex: "0 0 auto", fontSize: "10px", fontWeight: 700, color: "#1EC8FF", textTransform: "uppercase", letterSpacing: "0.06em" };
const NEXT: React.CSSProperties = { flex: "0 0 auto", display: "inline-block", fontSize: "12px", fontWeight: 700, padding: "3px 10px", borderRadius: "6px", border: "1px solid rgba(30,200,255,0.55)", background: "rgba(30,200,255,0.14)", color: "#1EC8FF", cursor: "pointer", textDecoration: "none", lineHeight: 1.5, whiteSpace: "nowrap" };
const SMALL: React.CSSProperties = { fontSize: "11px", color: "#94A3B8", whiteSpace: "nowrap" };
const REASON: React.CSSProperties = { ...SMALL, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" };

export default function DealNextStepPanel({ next, contactId, dealId }: { next: NextDealStep; contactId: string; dealId: string | null }) {
  if (next.kind !== "step") {
    return (
      <div data-testid="deal-next-step" data-deal={dealId ?? ""} data-step={next.kind} aria-label="Next step for this deal" style={ROW}>
        <span style={TAG}>Next step</span>
        <span data-testid="deal-next-step-reason" role={next.kind === "unreadable" ? "alert" : "status"} title={next.message}
          style={{ ...REASON, color: next.kind === "unreadable" ? "#F87171" : "#94A3B8" }}>{next.message}</span>
      </div>
    );
  }
  const { step, done, total } = next;
  const d = step.destination;
  return (
    <div data-testid="deal-next-step" data-deal={dealId ?? ""} data-step={step.id} aria-label="Next step for this deal" style={ROW}>
      <span style={TAG}>Next step</span>
      {d.kind === "underwriting" ? (
        <Link data-testid="deal-next-step-go" style={NEXT} aria-describedby="deal-next-step-reason"
          to={`/contacts/${encodeURIComponent(contactId)}/underwriting?${dealId ? `deal=${encodeURIComponent(dealId)}&` : ""}focus=${encodeURIComponent(step.id)}`}>
          {step.label}
        </Link>
      ) : d.kind === "seller_call" ? (
        <button type="button" data-testid="deal-next-step-go" style={NEXT} aria-describedby="deal-next-step-reason" onClick={() => { focusTestId(d.target); }}>{step.label}</button>
      ) : (
        <span data-testid="deal-next-step-go" data-destination="ghl" style={{ ...NEXT, cursor: "default" }} aria-describedby="deal-next-step-reason">{step.label} — {d.what}</span>
      )}
      <span data-testid="deal-next-step-progress" style={SMALL}>{done} of {total} steps done</span>
      <span id="deal-next-step-reason" data-testid="deal-next-step-reason" title={step.reason} style={REASON}>{step.reason}</span>
    </div>
  );
}

/**
 * B15-30 (Captain REVISE 2026-11-19): on Underwriting, opened by a Seller Call Next action (`?focus=<step>`). Names the
 * deal and the step, and returns to Seller Call on the SAME deal (`?deal=`), where the next step is derived again from
 * the records -- so the operator continues without hunting. A link only: nothing is written or recorded.
 */
export function GuidedReturnBar({ contactId, dealId, dealName, action }: { contactId: string; dealId: string; dealName: string; action: string }) {
  return (
    <div data-testid="guided-return" data-deal={dealId} role="note" style={{
      position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
      marginBottom: "14px", padding: "8px 12px", background: "#0F172A", border: "1px solid rgba(30,200,255,0.35)", borderRadius: "8px",
    }}>
      <span style={TAG}>Guided from Seller Call</span>
      <span style={{ fontSize: "12px", color: "#E2E8F0" }}>{dealName}: {action}.</span>
      <span style={SMALL}>When it is saved:</span>
      <Link data-testid="guided-return-back" style={NEXT} to={`/contacts/${encodeURIComponent(contactId)}/seller-call?deal=${encodeURIComponent(dealId)}`}>
        Back to Seller Call — next step
      </Link>
    </div>
  );
}
