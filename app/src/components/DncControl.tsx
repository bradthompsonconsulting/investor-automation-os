import { useRef, useState } from "react";
import { ghl, type ContactDetail } from "../lib/ghl";
import {
  DNC_CONSEQUENCE, DNC_DIALER_LINE, DNC_REASON_MAX, DNC_REASON_PLACEHOLDER,
  dncNote, isCallSuppressed, isDncComplete,
} from "../lib/dnc";

/**
 * B14-12 / INV-94 — Do Not Call (separate from the call log; Jess ruling
 * 2026-10-03). An explicit, confirmed action with a required reason.
 *
 * Order, each step gating the next — nothing is claimed before it is read back:
 *   1. contact.dnc     the server sets Do Not Disturb for Call, SMS and Email
 *                      (never weakening an existing entry such as STOP), reads
 *                      it back, and refuses to confirm otherwise
 *   2. a fresh read    IAOS re-reads the contact and checks Call/SMS/Email are
 *                      suppressed — the same predicate the Dashboard uses to
 *                      keep the contact out of every calling list
 *   3. the note        "Do Not Call (recorded by Brad in IAOS): {reason}" +
 *                      "Suppressed in GHL: calls, SMS and email." — written
 *                      only after 1 and 2, so its second line is a fact
 * A failure at any step says exactly what did and did not happen. No retry of
 * the suppression is automatic. No workflow, stage, call result or webhook is
 * touched.
 */

type State =
  | { kind: "idle" }
  | { kind: "in_flight" }
  | { kind: "done" }
  | { kind: "not_confirmed"; message: string }
  | { kind: "unverified"; message: string }
  | { kind: "note_failed"; message: string; note: string };

export function DncControl({ contactId, detail, onNoteWritten }: {
  contactId: string;
  /** This contact's detail, or null while it is not loaded (or belongs to another contact). */
  detail: ContactDetail | null;
  /** Fires after the record note is saved, so the page's notes list shows it. */
  onNoteWritten: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const inFlight = useRef(false);
  const busy = state.kind === "in_flight";
  const known = detail !== null;
  const alreadyComplete = known && isDncComplete(detail!.dndSettings);
  const callSuppressed = known && isCallSuppressed(detail!.dndSettings);

  async function writeNote(note: string) {
    try { await ghl.notes.create(contactId, note); onNoteWritten(); setState({ kind: "done" }); setOpen(false); setReason(""); }
    catch (e) {
      setState({ kind: "note_failed", note, message: `Suppressed in GHL for calls, SMS and email ✓ · Out of IAOS calling lists ✓ — but the record note wasn't saved (${(e as Error).message}).` });
    }
  }

  async function confirm() {
    const why = reason.trim();
    if (!known || !why || inFlight.current) return;   // gated: this contact's record loaded, reason given
    inFlight.current = true;
    setState({ kind: "in_flight" });
    try {
      try { await ghl.contacts.setDnc(contactId); }
      catch (e) {
        setState({ kind: "not_confirmed", message: `Do Not Call was not confirmed (${(e as Error).message}). Nothing was recorded in IAOS. Check the contact's Do Not Disturb in GHL before trying again.` });
        return;
      }
      let verified = false;
      let why2 = "";
      try {
        const fresh = await ghl.contacts.getDetail(contactId);
        verified = fresh.id === contactId && isDncComplete(fresh.dndSettings);
        if (!verified) why2 = "calls, SMS or email do not read back as suppressed";
      } catch (e) { why2 = (e as Error).message; }
      if (!verified) {
        setState({ kind: "unverified", message: `GHL accepted Do Not Disturb, but IAOS couldn't confirm it on a fresh read (${why2}). Nothing was recorded yet. Reload the contact to check it before trying again.` });
        return;
      }
      await writeNote(dncNote(why));
    } finally {
      inFlight.current = false;
    }
  }

  async function retryNote() {
    if (state.kind !== "note_failed" || inFlight.current) return;
    inFlight.current = true;
    const note = state.note;
    setState({ kind: "in_flight" });
    try { await writeNote(note); } finally { inFlight.current = false; }
  }

  const red = { fontSize: "12px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.10)", color: "#F87171" } as const;

  return (
    <div data-testid="dnc" style={{ marginTop: "12px", padding: "12px 16px", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "10px", background: "#0D1B3E" }}>
      {alreadyComplete && state.kind !== "done" ? (
        <div data-testid="dnc-in-effect" style={{ fontSize: "12px", color: "#F87171" }}>
          Do Not Call is in effect: GHL Do Not Disturb is set for calls, SMS and email. This contact is out of IAOS calling lists.
        </div>
      ) : (
        <>
          {callSuppressed && state.kind !== "done" ? (
            <div data-testid="dnc-call-suppressed" style={{ fontSize: "12px", color: "#F87171", marginBottom: "8px" }}>
              Calls are already suppressed in GHL. Do Not Call would also suppress SMS and email.
            </div>
          ) : null}
          {state.kind === "done" ? (
            <div data-testid="dnc-done" style={{ fontSize: "12px", color: "#22C55E" }}>
              Do Not Call is set. Suppressed in GHL for calls, SMS and email ✓ · Out of IAOS calling lists ✓ · Recorded ✓
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
              <div style={{ display: "flex", gap: "8px" }}>
                <button data-testid="dnc-confirm" onClick={() => void confirm()} disabled={busy || !known || reason.trim() === ""}
                  style={{ ...red, opacity: reason.trim() === "" ? 0.45 : 1, cursor: busy || reason.trim() === "" ? "not-allowed" : "pointer" }}>
                  {busy ? "Setting Do Not Call…" : "Confirm Do Not Call"}
                </button>
                <button data-testid="dnc-cancel" onClick={() => { setOpen(false); setReason(""); }} disabled={busy}
                  style={{ fontSize: "12px", padding: "8px 14px", borderRadius: "8px", border: "1px solid #334155", background: "transparent", color: "#94A3B8" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {state.kind === "not_confirmed" ? <div data-testid="dnc-not-confirmed" style={{ marginTop: "8px", fontSize: "12px", color: "#F87171" }}>{state.message}</div> : null}
      {state.kind === "unverified" ? <div data-testid="dnc-unverified" style={{ marginTop: "8px", fontSize: "12px", color: "#F59E0B" }}>{state.message}</div> : null}
      {state.kind === "note_failed" ? (
        <div data-testid="dnc-note-failed" style={{ marginTop: "8px", fontSize: "12px", color: "#F59E0B" }}>
          {state.message}{" "}
          <button data-testid="dnc-retry-note" onClick={() => void retryNote()} style={{ ...red, padding: "4px 10px" }}>Retry note</button>
        </div>
      ) : null}
    </div>
  );
}
