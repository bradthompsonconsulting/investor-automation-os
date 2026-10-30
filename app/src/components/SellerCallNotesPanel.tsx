import { useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { NoteBody } from "./NoteBody";
import "./FullScriptDrawer.css";

/**
 * B15-06 (Jess, 2026-10-26) -- the contact's notes, readable during a Seller
 * Call without leaving the page. READ-ONLY in this slice: it renders the notes
 * the page already holds (the same `ghl.notes.list` read the ledgers parse,
 * plus the page's own confirmed writes) and nothing else. No fetch, no write,
 * no call logging; a new note is added on the Contact page as before.
 *
 * A side panel like the Full Script, never a modal: no backdrop, no focus
 * trap, no click-away close. It takes focus when it opens (it sits after the
 * whole workspace in tab order); Escape inside it, or the close button,
 * closes it and the caller returns focus to the Notes button. `notes` is
 * null until THIS contact's load has completed, so another contact's notes
 * are never shown. System records read as their B15-17 summary (NoteBody).
 */
export function SellerCallNotesPanel({ notes, onClose }: {
  notes: { id: string; body: string; dateAdded: string }[] | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  const newestFirst = notes ? [...notes].sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded)) : null;

  return (
    <aside
      ref={panelRef}
      id="seller-call-notes-panel"
      role="complementary"
      aria-label="Notes"
      tabIndex={-1}
      data-testid="seller-call-notes-panel"
      className="seller-call-notes-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "#F1F5F9" }}>
          Notes{newestFirst ? <span style={{ fontSize: "12px", fontWeight: 500, color: "#64748B" }}> · {newestFirst.length}</span> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="seller-call-notes-close"
          aria-label="Close Notes"
          style={{
            background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer",
            padding: "4px", borderRadius: "6px", display: "flex",
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "12px" }}>
        Newest first. Read-only here — add a note on the Contact page.
      </div>
      {newestFirst === null ? (
        <div role="status" data-testid="seller-call-notes-loading" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#94A3B8" }}>
          <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Loading this contact's notes…
        </div>
      ) : newestFirst.length === 0 ? (
        <div data-testid="seller-call-notes-empty" style={{ fontSize: "13px", color: "#64748B" }}>No notes yet.</div>
      ) : (
        <ol data-testid="seller-call-notes-list" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
          {newestFirst.map((n) => (
            <li key={n.id} data-testid="seller-call-note" style={{ background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "10px 14px" }}>
              <div style={{ fontSize: "10px", color: "#475569", marginBottom: "4px" }}>{new Date(n.dateAdded).toLocaleString()}</div>
              <div style={{ fontSize: "13px", color: "#E2E8F0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><NoteBody body={n.body} /></div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
