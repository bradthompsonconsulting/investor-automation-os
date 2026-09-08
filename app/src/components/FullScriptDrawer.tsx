import { useEffect } from "react";
import { X } from "lucide-react";
import {
  scriptLinesByStage, NEGOTIATION_LINES, GLOBAL_CONVERSATION_TOOLS, FINAL_PRINCIPLES,
} from "../lib/seller-call-script";

/**
 * Full Script drawer — B8-12 / INV-55, extended by INV-69.
 *
 * "an optional drawer within the Seller Call workspace, not a separate
 * page" (INV-55, required information hierarchy, item 4). Opens over the
 * Seller Call Workspace on demand; never blocks or gates any workspace
 * action, and nothing here writes anything or reads GHL — it renders
 * `scriptLinesByStage()` (pure data from `seller-call-script.ts`)
 * verbatim, stage by stage, so it may "expose all stages for training or
 * reference" exactly as the ticket allows. Every line is labeled
 * "Suggested — say it your way" (item 5): this is Brad's approved
 * language as a starting point, never mandatory wording.
 *
 * INV-69 addition, same invariants (pure render, no I/O, no GHL, no
 * write): within the Offer stage, `NEGOTIATION_LINES` renders as
 * "If Seller Says..." content, distinct from Suggested Questions per
 * INV-69's own structural requirement; `GLOBAL_CONVERSATION_TOOLS` renders
 * once, not scoped to any stage ("available globally in the reference
 * library"); `FINAL_PRINCIPLES` renders as reference text. No other stage
 * has "If Seller Says..." content approved, so none is invented or shown.
 */
export function FullScriptDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full Script"
      data-testid="full-script-drawer"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(2,6,23,0.65)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)", height: "100%", overflowY: "auto",
          background: "#0B1220", borderLeft: "1px solid #1E293B",
          padding: "20px 22px", boxShadow: "-12px 0 32px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#F1F5F9" }}>Full Script</div>
          <button
            onClick={onClose}
            data-testid="full-script-close"
            aria-label="Close Full Script"
            style={{
              background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer",
              padding: "4px", borderRadius: "6px", display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "18px" }}>
          Suggested — say it your way. Brad's approved script, for reference. MSK still decides Offer Ready, not script completion.
        </div>

        {scriptLinesByStage().map(({ stage, label, lines }) => (
          <div key={stage} style={{ marginBottom: "18px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#1EC8FF", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "8px" }}>
              {label}
            </div>
            {lines.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#475569", fontStyle: "italic" }}>No approved script line for this stage yet.</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {lines.map((line, i) => (
                  <li key={i} style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.5, padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                    {line.text}
                  </li>
                ))}
              </ul>
            )}

            {/* INV-69 -- "If Seller Says..." content, distinct from Suggested
                Questions above, per stage. Only Offer has approved content;
                no other stage's negotiation wording is invented. */}
            {stage === "offer" && NEGOTIATION_LINES.length > 0 ? (
              <div data-testid="if-seller-says" style={{ marginTop: "10px" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#94A3B8", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "6px" }}>
                  If Seller Says…
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {NEGOTIATION_LINES.map((n, i) => (
                    <li key={i} style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.5, padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                      <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "2px" }}>{n.sellerSays}:</div>
                      {n.say}
                    </li>
                  ))}
                </ul>
                <div style={{ fontSize: "11px", color: "#64748B", marginTop: "6px" }}>
                  Brad checks IAOS before responding to a counter. No acceptance, implied acceptance, or movement occurs simply because the seller named a price.
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {/* INV-69 -- Global Conversation Tools, not scoped to any stage. */}
        <div data-testid="conversation-tools" style={{ marginBottom: "18px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#1EC8FF", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "8px" }}>
            Conversation Tools
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {GLOBAL_CONVERSATION_TOOLS.map((line, i) => (
              <li key={i} style={{ fontSize: "13px", color: "#E2E8F0", lineHeight: 1.5, padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* INV-69 -- Final principles, reference only. */}
        <div data-testid="script-final-principles" style={{ marginBottom: "4px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#1EC8FF", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "8px" }}>
            Principles
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {FINAL_PRINCIPLES.map((line, i) => (
              <li key={i} style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
