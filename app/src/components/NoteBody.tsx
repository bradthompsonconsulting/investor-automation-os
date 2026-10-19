import { summarizeSystemNote } from "../lib/system-note-summary";

/* B15-17 (INV-126), Walkthrough 2 -- one note body, as Contact Workspace and
   Conversations show it. A system record (see lib/system-note-summary.ts)
   reads as a one-line summary -- its title plus its own quoted status line,
   or an explicit "No status line" so nothing reads as a success -- with the
   complete original record behind a collapsed "Show full record" control;
   any other note renders exactly as
   written. Display only: no write, and the body is rendered as React text,
   never as markup. The caller's wrapper keeps its own whiteSpace/wordBreak. */
export function NoteBody({ body }: { body: string }) {
  const summary = summarizeSystemNote(body);
  if (!summary) return <>{body}</>;
  return (
    <div style={{ whiteSpace: "normal" }}>
      <div>
        {/* "IAOS record" names the note's format, not who saved it: a header
            alone does not prove authorship, so no authorship is claimed. */}
        {summary.version && (
          <span style={{ fontSize: "10px", fontWeight: 600, color: "#94A3B8", background: "rgba(148,163,184,0.12)", borderRadius: "4px", padding: "1px 6px", marginRight: "6px" }}>
            IAOS record
          </span>
        )}
        {summary.title}
        {summary.status ? (
          <span style={{ color: "#CBD5E1" }}> · {summary.status.label}: {summary.status.value}</span>
        ) : (
          <span style={{ color: "#64748B" }}> · No status line — see full record</span>
        )}
      </div>
      <details style={{ marginTop: "4px", fontSize: "11px", color: "#64748B" }}>
        <summary style={{ cursor: "pointer" }}>Show full record</summary>
        <div style={{ marginTop: "4px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#94A3B8" }}>{body}</div>
      </details>
    </div>
  );
}
