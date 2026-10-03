import { useRef, useState } from "react";
import { ghl, ghlContactDetailUrl, type ContactDetail } from "../lib/ghl";
import { openGhlContactWindow, type GhlHandoffResult } from "../lib/ghl-call-handoff";
import {
  DNC_CONSEQUENCE, DNC_DIALER_LINE, DNC_REASON_MAX, DNC_REASON_PLACEHOLDER,
  dncNote, isDncComplete, unsuppressedChannels,
} from "../lib/dnc";

/**
 * B14-12 / INV-94 — Do Not Call (Jess rulings 2026-10-03). IAOS NEVER WRITES
 * DND: GHL's API offers no write that is safe against an opt-out GHL records
 * at the same moment, so Brad sets Do Not Disturb with GHL's own control.
 *
 *   1. "Open this contact in GHL" — the isolated 14-11 handoff to THIS
 *      contact's GHL record. Navigation only; writes nothing.
 *   2. "I've set it — check now" — a fresh read of this contact: calls, SMS
 *      and email must all show suppressed. Otherwise: which are not, and
 *      nothing recorded.
 *   3. The note "Do Not Call (recorded by Brad in IAOS): {reason}" +
 *      "At verification, GHL showed calls, SMS and email suppressed." —
 *      what IAOS observed, not a guarantee. ghl-write re-reads the contact
 *      under its lock and refuses the note unless all three are still
 *      suppressed (first save and every retry).
 *
 * If the note's outcome is uncertain, Retry LOOKS FOR THAT NOTE FIRST and
 * treats it as recorded if found; only then re-checks suppression and saves.
 * It never claims the note was unsaved and never blindly writes a second one.
 */

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "not_suppressed"; message: string }
  | { kind: "read_failed"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "uncertain"; message: string; note: string }
  | { kind: "done"; found: boolean };

/** Refusals the write path reports before anything is saved. */
const DEFINITE_REFUSAL = /^(Production write refused|Application write sign-in required|Sign in for application writes)/;

const HANDOFF_TEXT: Record<GhlHandoffResult, string> = {
  opened: "GHL opened in a new window. Turn on Do Not Disturb for Calls, SMS and Email on this contact there, then come back and check.",
  blocked: "Your browser blocked the new window. Open this contact in GHL yourself, or allow pop-ups for IAOS.",
  "isolation-failed": "IAOS couldn't open GHL safely. Open this contact in GHL yourself.",
};

export function DncControl({ contactId, detail, onNoteWritten }: {
  contactId: string;
  /** This contact's detail, or null while it is not loaded (or belongs to another contact). */
  detail: ContactDetail | null;
  /** Fires after the note is saved (or found), so the page's notes list shows it. */
  onNoteWritten: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [handoff, setHandoff] = useState<GhlHandoffResult | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const inFlight = useRef(false);
  const busy = state.kind === "busy";
  const known = detail !== null;
  const ghlUrl = ghlContactDetailUrl(contactId);

  /** Fresh read of THIS contact. null = suppression holds on calls, SMS and email. */
  async function verify(retrying: boolean): Promise<State | null> {
    let fresh: ContactDetail;
    try { fresh = await ghl.contacts.getDetail(contactId); }
    catch (e) { return { kind: "read_failed", message: `Couldn't read this contact from GHL (${(e as Error).message}). Not recorded.` }; }
    if (fresh.id !== contactId) return { kind: "read_failed", message: "GHL returned a different contact. Not recorded." };
    const missing = unsuppressedChannels(fresh.dndSettings);
    if (missing.length === 0) return null;
    return { kind: "not_suppressed", message: retrying
      ? `GHL no longer shows Do Not Disturb on: ${missing.join(", ")}. Not recorded.`
      : `GHL doesn't show Do Not Disturb on: ${missing.join(", ")} yet. Nothing recorded. Set it in GHL, then check again.` };
  }

  async function save(note: string) {
    try {
      await ghl.notes.create(contactId, note);
      onNoteWritten();
      setState({ kind: "done", found: false });
      setOpen(false); setReason(""); setHandoff(null);
    } catch (e) {
      const message = (e as Error).message;
      // A definite refusal — ghl-write's own fresh DND check, the Production scope, or no
      // write sign-in — means the note was NOT saved. Anything else is uncertain.
      if (/^Do Not Call is not held in GHL for:/.test(message)) { setState({ kind: "refused", message }); return; }
      if (DEFINITE_REFUSAL.test(message)) { setState({ kind: "refused", message: `Not recorded: ${message}` }); return; }
      setState({ kind: "uncertain", note, message: `The note may or may not have been saved (${message}). Retry looks for it before saving anything again.` });
    }
  }

  async function check() {
    const why = reason.trim();
    if (!known || !why || inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "busy" });
    try {
      const problem = await verify(false);
      if (problem) { setState(problem); return; }
      await save(dncNote(why));
    } finally {
      inFlight.current = false;
    }
  }

  async function retry() {
    if (state.kind !== "uncertain" || inFlight.current) return;
    inFlight.current = true;
    const note = state.note;
    setState({ kind: "busy" });
    try {
      // 1. Did the earlier save go through? Look before writing anything.
      let existing: { body: string }[];
      try { existing = (await ghl.notes.list(contactId)).notes ?? []; }
      catch (e) {
        setState({ kind: "uncertain", note, message: `Couldn't check whether the earlier note was saved (${(e as Error).message}). Nothing saved again.` });
        return;
      }
      if (existing.some((n) => n.body === note)) { onNoteWritten(); setState({ kind: "done", found: true }); setOpen(false); setReason(""); setHandoff(null); return; }
      // 2. Not there: suppression must still hold right now.
      const problem = await verify(true);
      if (problem) { setState(problem); return; }
      // 3. Save (ghl-write re-checks suppression before accepting it).
      await save(note);
    } finally {
      inFlight.current = false;
    }
  }

  const red = { fontSize: "12px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.10)", color: "#F87171" } as const;
  const plain = { fontSize: "12px", padding: "8px 14px", borderRadius: "8px", border: "1px solid #334155", background: "transparent", color: "#94A3B8" } as const;
  const message = "message" in state ? state.message : null;

  return (
    <div data-testid="dnc" style={{ marginTop: "12px", padding: "12px 16px", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "10px", background: "#0D1B3E" }}>
      {known && isDncComplete(detail!.dndSettings) && state.kind !== "done" ? (
        <div data-testid="dnc-in-effect" style={{ fontSize: "12px", color: "#F87171", marginBottom: "8px" }}>
          GHL shows Do Not Disturb on calls, SMS and email for this contact. It is out of IAOS calling lists.
        </div>
      ) : null}
      {state.kind === "done" ? (
        <div data-testid="dnc-done" style={{ fontSize: "12px", color: "#22C55E" }}>
          {state.found ? "Do Not Call recorded (the earlier save had gone through). " : "Do Not Call recorded. "}
          At verification GHL showed calls, SMS and email suppressed ✓ · Out of IAOS calling lists ✓
        </div>
      ) : !open ? (
        <button data-testid="dnc-open" onClick={() => { setOpen(true); setState({ kind: "idle" }); }} disabled={!known || busy}
          style={{ ...red, opacity: known ? 1 : 0.45, cursor: known ? "pointer" : "not-allowed" }}>
          Do Not Call…
        </button>
      ) : (
        <div data-testid="dnc-panel" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div data-testid="dnc-consequence" style={{ fontSize: "12px", color: "#E2E8F0", lineHeight: 1.5 }}>{DNC_CONSEQUENCE}</div>
          <div style={{ fontSize: "11px", color: "#64748B" }}>{DNC_DIALER_LINE}</div>
          <textarea data-testid="dnc-reason" value={reason} maxLength={DNC_REASON_MAX} rows={2} disabled={busy}
            onChange={(e) => setReason(e.target.value.replace(/\n/g, " "))} placeholder={DNC_REASON_PLACEHOLDER}
            style={{ background: "#0B1220", color: "#E2E8F0", border: "1px solid #334155", borderRadius: "6px", padding: "8px 10px", fontSize: "12px", fontFamily: "inherit", resize: "vertical" }} />
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button data-testid="dnc-open-ghl" onClick={() => setHandoff(openGhlContactWindow(ghlUrl, (url, target) => window.open(url, target)))} disabled={busy} style={plain}>
              Open this contact in GHL
            </button>
            <button data-testid="dnc-check" onClick={() => void check()} disabled={busy || !known || reason.trim() === ""}
              style={{ ...red, opacity: reason.trim() === "" ? 0.45 : 1, cursor: busy || reason.trim() === "" ? "not-allowed" : "pointer" }}>
              {busy ? "Checking GHL…" : "I've set it — check now"}
            </button>
            <button data-testid="dnc-cancel" onClick={() => { setOpen(false); setReason(""); setHandoff(null); setState({ kind: "idle" }); }} disabled={busy} style={plain}>
              Cancel
            </button>
          </div>
          {handoff ? <div data-testid={`dnc-handoff-${handoff}`} style={{ fontSize: "12px", color: handoff === "opened" ? "#94A3B8" : "#F87171" }}>{HANDOFF_TEXT[handoff]}</div> : null}
        </div>
      )}
      {message ? (
        <div data-testid={`dnc-${state.kind.replace("_", "-")}`} style={{ marginTop: "8px", fontSize: "12px", color: state.kind === "uncertain" ? "#F59E0B" : "#F87171" }}>
          {message}
          {state.kind === "uncertain" ? <> <button data-testid="dnc-retry" onClick={() => void retry()} style={{ ...red, padding: "4px 10px" }}>Retry</button></> : null}
        </div>
      ) : null}
    </div>
  );
}
