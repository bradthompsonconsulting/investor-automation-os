/**
 * B15-30 / INV-140 -- the Seller Call hub's one guided step panel: the selected deal's next unfinished step (derived by
 * lib/deal-next-step.ts from the records the page already read), why, ONE Next control that names its destination,
 * and how many steps are done. The control only moves focus (Seller Call) or opens a link (Underwriting, with the deal
 * and the exact field); it never writes, approves or records anything.
 */
import { Link } from "react-router-dom";
import { focusTestId } from "../lib/focus-target";
import type { NextDealStep } from "../lib/deal-next-step";

const BOX: React.CSSProperties = { marginBottom: "14px", padding: "12px 14px", background: "#0F172A", border: "1px solid rgba(30,200,255,0.25)", borderRadius: "10px" };
const NEXT: React.CSSProperties = { display: "inline-block", fontSize: "13px", fontWeight: 600, padding: "7px 12px", borderRadius: "8px", border: "1px solid rgba(30,200,255,0.45)", background: "rgba(30,200,255,0.10)", color: "#1EC8FF", cursor: "pointer", textDecoration: "none" };

export default function DealNextStepPanel({ next, contactId, dealId }: { next: NextDealStep; contactId: string; dealId: string }) {
  if (next.kind !== "step") {
    return (
      <section data-testid="deal-next-step" data-deal={dealId} data-step={next.kind} aria-label="Next step for this deal" style={BOX}>
        <div style={{ fontSize: "11px", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>Next step for this deal</div>
        <div data-testid="deal-next-step-reason" role={next.kind === "unreadable" ? "alert" : "status"} style={{ fontSize: "13px", color: next.kind === "unreadable" ? "#F87171" : "#94A3B8", marginTop: "4px" }}>{next.message}</div>
      </section>
    );
  }
  const { step, done, total } = next;
  const d = step.destination;
  return (
    <section data-testid="deal-next-step" data-deal={dealId} data-step={step.id} aria-label="Next step for this deal" style={BOX}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "11px", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>Next step for this deal</div>
        <div data-testid="deal-next-step-progress" style={{ fontSize: "11px", color: "#64748B" }}>{done} of {total} steps done</div>
      </div>
      <div style={{ marginTop: "8px" }}>
        {d.kind === "underwriting" ? (
          <Link data-testid="deal-next-step-go" style={NEXT}
            to={`/contacts/${encodeURIComponent(contactId)}/underwriting?deal=${encodeURIComponent(dealId)}&focus=${encodeURIComponent(step.id)}`}>
            {step.label}
          </Link>
        ) : d.kind === "seller_call" ? (
          <button type="button" data-testid="deal-next-step-go" style={NEXT} onClick={() => { focusTestId(d.target); }}>{step.label}</button>
        ) : (
          <span data-testid="deal-next-step-go" data-destination="ghl" style={{ ...NEXT, cursor: "default" }}>{step.label} — {d.what}</span>
        )}
      </div>
      <div data-testid="deal-next-step-reason" style={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px" }}>{step.reason}</div>
    </section>
  );
}
