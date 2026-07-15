import { useState } from "react";

/**
 * CallbackPopover — shared schedule-callback control. Extracted verbatim from
 * Dashboard.tsx so the Dashboard and the Contact Workspace use ONE popover and
 * cannot drift. Defaults to today at the next :00/:30, step={1800}, un-muted
 * Save/Clear/Cancel. Save/Clear semantics (which writes fire) are the caller's
 * concern via onSave/onClear — this component only collects a datetime.
 */

// <input type="datetime-local"> is inherently browser-local time — no explicit
// timezone conversion needed here (Brad's browser is already Central), just a
// straight local-time round-trip via the Date object's local getters/parsing.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Default value when the popover opens with no existing callback — today,
// rounded up to the next :00/:30 mark so it lines up with the input's
// step={1800} constraint and Save is immediately usable. UX default only;
// does not change what setCallbackDatetime writes (that's still whatever
// the field holds when Save is clicked).
function defaultCallbackLocalValue(): string {
  const d = new Date();
  if (d.getMinutes() < 30) d.setMinutes(30, 0, 0);
  else d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CallbackPopover({
  current, saving, error, onSave, onClear, onClose,
}: {
  current: string | null;
  saving: boolean;
  error: string | null;
  onSave: (iso: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  // Defaults to today (rounded to the next :00/:30) rather than blank, so
  // Save is usable immediately without requiring input first.
  const [value, setValue] = useState(current ? toDatetimeLocalValue(current) : defaultCallbackLocalValue());
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: "220px",
        background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px",
        padding: "10px", boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      }}
    >
      <input
        type="datetime-local"
        step={1800}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        style={{
          width: "100%", fontSize: "12px", padding: "5px 7px", borderRadius: "6px",
          border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)", color: "#F1F5F9",
        }}
      />
      <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
        <button
          disabled={!value || saving}
          onClick={() => onSave(new Date(value).toISOString())}
          style={{
            fontSize: "12px", fontWeight: 700, padding: "7px 14px", borderRadius: "6px", border: "none",
            background: !value || saving ? "rgba(30,200,255,0.15)" : "#1EC8FF",
            color: !value || saving ? "#64748B" : "#07142E", cursor: !value || saving ? "not-allowed" : "pointer",
          }}
        >
          Save
        </button>
        {current && (
          <button
            disabled={saving}
            onClick={onClear}
            style={{
              fontSize: "11px", fontWeight: 600, padding: "5px 10px", borderRadius: "6px",
              border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#F87171",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Clear
          </button>
        )}
        <button
          disabled={saving}
          onClick={onClose}
          style={{
            fontSize: "11px", fontWeight: 600, padding: "5px 10px", borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#64748B",
            cursor: saving ? "not-allowed" : "pointer", marginLeft: "auto",
          }}
        >
          Cancel
        </button>
      </div>
      {error && <div style={{ fontSize: "10px", color: "#F87171", marginTop: "6px" }}>{error}</div>}
    </div>
  );
}
