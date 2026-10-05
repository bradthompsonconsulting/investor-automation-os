import { AlertCircle, ExternalLink } from "lucide-react";
import { ghlContactDetailUrl } from "../lib/ghl";

/**
 * Board 15 / Pass 1 F19 (INV-109) — a contact with no opportunity.
 *
 * The pages already said "Create an opportunity in GHL" but gave no way to get
 * there. This adds the way: one button that opens THIS contact in GHL, where
 * the deal is created. NAVIGATION ONLY. IAOS creates no opportunity (no such
 * named write exists in docs/INV95_WRITE_BOUNDARIES.md) and writes nothing
 * here; window.open sends nothing to GHL, exactly like the rail's
 * contact-record hop, which uses the same ghlContactDetailUrl.
 *
 * `reason` keeps each page's own explanation of why a deal is needed.
 */
export const NO_DEAL_TITLE = "No deal yet";
export const NO_DEAL_STEP =
  "Create the opportunity for this contact in GHL, then reload this page. IAOS doesn't create deals.";
export const NO_DEAL_BUTTON = "Open this contact in GHL";

export default function NoDealYet({ contactId, reason }: { contactId: string; reason?: string }) {
  return (
    <div data-testid="no-deal-yet" style={{
      display: "flex", gap: "12px", alignItems: "flex-start", padding: "18px 20px",
      background: "#64748B0F", border: "1px solid #64748B33", borderRadius: "10px",
    }}>
      <AlertCircle size={20} style={{ color: "#64748B", flexShrink: 0, marginTop: "1px" }} />
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#E2E8F0" }}>{NO_DEAL_TITLE}</div>
        {reason ? <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.5 }}>{reason}</div> : null}
        <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "5px", lineHeight: 1.5 }}>{NO_DEAL_STEP}</div>
        <button
          data-testid="no-deal-open-ghl"
          onClick={() => window.open(ghlContactDetailUrl(contactId), "_blank", "noopener,noreferrer")}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "10px",
            padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
            border: "1px solid rgba(30,200,255,0.3)", background: "rgba(30,200,255,0.07)", color: "#1EC8FF",
          }}
        >
          <ExternalLink size={12} /> {NO_DEAL_BUTTON}
        </button>
      </div>
    </div>
  );
}
