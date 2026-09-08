import { useEffect } from "react";
import { X } from "lucide-react";
import { scriptLinesByStage } from "../lib/seller-call-script";

/**
 * Full Script drawer — B8-12 / INV-55.
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
          </div>
        ))}
      </div>
    </div>
  );
}
