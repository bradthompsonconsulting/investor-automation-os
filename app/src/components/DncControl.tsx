import { useEffect, useRef, useState } from "react";
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
 * UNRESOLVED ATTEMPTS (Bones, #120 recovery fixes). WRITE-AHEAD: before any
 * note is sent, the attempt is stored for THAT contact in sessionStorage (keyed
 * by contact id) and read back; if that fails, nothing is sent and Brad is told
 * recording can't safely proceed in this browser session. There is no
 * in-memory fallback — it would not survive a reload. The record is kept until
 * the note is confirmed present (saved, or found by a lookup) or the write is
 * definitely refused — through Cancel, reopening, navigation and reloads.
 * EVERY note write, whichever button starts it, goes through commit(): if the
 * record can't be read it writes nothing; if there is one it looks for that
 * note first (found = done, no second write; lookup failed = no write); only
 * when the note is confirmed absent does it re-check suppression and make one
 * new attempt. It never claims a note was unsaved.
 */

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "not_suppressed"; message: string }
  | { kind: "read_failed"; message: string }
  | { kind: "storage_blocked"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "uncertain"; message: string }
  | { kind: "done"; found: boolean };

/** Refusals the write path reports before anything is saved. */
const DEFINITE_REFUSAL = /^(Production write refused|Application write sign-in required|Sign in for application writes)/;

const HANDOFF_TEXT: Record<GhlHandoffResult, string> = {
  opened: "GHL opened in a new window. Turn on Do Not Disturb for Calls, SMS and Email on this contact there, then come back and check.",
  blocked: "Your browser blocked the new window. Open this contact in GHL yourself, or allow pop-ups for IAOS.",
  "isolation-failed": "IAOS couldn't open GHL safely. Open this contact in GHL yourself.",
};

const PENDING_PREFIX = "iaos.dnc.pending.";
const PENDING_TEXT = "An earlier Do Not Call note for this contact may or may not have been saved. IAOS looks for it before saving anything again.";

const STORAGE_BLOCKED = "Do Not Call can't be recorded safely in this browser session: IAOS couldn't keep a recovery record of the save (browser storage unavailable or full). Nothing recorded. Use a normal browser window with site storage allowed, then check again.";

/**
 * This contact's unresolved note. ok:false = the record can't be read, so whether an
 * earlier attempt is outstanding is unknown and nothing may be written.
 */
function readPending(contactId: string): { ok: true; note: string | null } | { ok: false } {
  try { return { ok: true, note: sessionStorage.getItem(PENDING_PREFIX + contactId) }; }
  catch { return { ok: false }; }
}
/** Write-ahead record. true ONLY when it is stored and reads back exactly. */
function persistPending(contactId: string, note: string): boolean {
  try {
    sessionStorage.setItem(PENDING_PREFIX + contactId, note);
    return sessionStorage.getItem(PENDING_PREFIX + contactId) === note;
  } catch { return false; }
}
/** Resolved (confirmed present or definitely refused). A record left behind only costs a lookup. */
function clearPending(contactId: string) {
  try { sessionStorage.removeItem(PENDING_PREFIX + contactId); } catch { /* the next save looks first */ }
}
const pendingNote = (contactId: string) => { const p = readPending(contactId); return p.ok ? p.note : null; };

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
  const [pending, setPending] = useState<string | null>(() => pendingNote(contactId));
  const inFlight = useRef(false);
  const currentId = useRef(contactId);
  const busy = state.kind === "busy";
  const known = detail !== null;
  const ghlUrl = ghlContactDetailUrl(contactId);

  // Another contact: nothing from the previous one carries over, except each contact's own record.
  useEffect(() => {
    currentId.current = contactId;
    setOpen(false); setReason(""); setHandoff(null); setState({ kind: "idle" });
    setPending(pendingNote(contactId));
  }, [contactId]);

  /** Fresh read of contact `cid`. null = suppression holds on calls, SMS and email. */
  async function verify(cid: string, retrying: boolean): Promise<State | null> {
    let fresh: ContactDetail;
    try { fresh = await ghl.contacts.getDetail(cid); }
    catch (e) { return { kind: "read_failed", message: `Couldn't read this contact from GHL (${(e as Error).message}). Not recorded.` }; }
    if (fresh.id !== cid) return { kind: "read_failed", message: "GHL returned a different contact. Not recorded." };
    const missing = unsuppressedChannels(fresh.dndSettings);
    if (missing.length === 0) return null;
    return { kind: "not_suppressed", message: retrying
      ? `GHL no longer shows Do Not Disturb on: ${missing.join(", ")}. Not recorded.`
      : `GHL doesn't show Do Not Disturb on: ${missing.join(", ")} yet. Nothing recorded. Set it in GHL, then check again.` };
  }

  /**
   * THE ONLY NOTE-WRITE PATH (check now and Retry both come here). `note` is the note
   * to save if nothing is outstanding. Order: read this contact's record (unreadable =
   * stop) → reconcile any unresolved attempt → verify suppression → write-ahead record
   * (not stored = stop) → one save.
   */
  async function commit(cid: string, note: string) {
    const live = () => currentId.current === cid;
    const finish = (found: boolean) => {
      clearPending(cid);
      if (!live()) return;
      onNoteWritten(); setPending(null);
      setState({ kind: "done", found }); setOpen(false); setReason(""); setHandoff(null);
    };
    // 1. An earlier attempt for this contact may have saved. Look before writing anything.
    const record = readPending(cid);
    if (!record.ok) { if (live()) setState({ kind: "storage_blocked", message: STORAGE_BLOCKED }); return; }
    const earlier = record.note;
    if (earlier !== null) {
      let existing: { body: string }[];
      try { existing = (await ghl.notes.list(cid)).notes ?? []; }
      catch (e) {
        if (live()) setState({ kind: "uncertain", message: `Couldn't check whether the earlier note was saved (${(e as Error).message}). Nothing saved again.` });
        return;
      }
      if (existing.some((n) => n.body === earlier)) { finish(true); return; }
      // Confirmed absent. The record stays until this attempt resolves; step 3 replaces it.
    }
    // 2. Suppression must hold right now (re-checked after any unresolved attempt).
    const problem = await verify(cid, earlier !== null);
    if (problem) { if (live()) setState(problem); return; }
    // 3. Write-ahead: the attempt must be on record (surviving a reload) BEFORE it is sent.
    if (!persistPending(cid, note)) { if (live()) setState({ kind: "storage_blocked", message: STORAGE_BLOCKED }); return; }
    if (live()) setPending(note);
    // 4. One save; ghl-write re-checks suppression before accepting it.
    try {
      await ghl.notes.create(cid, note);
      finish(false);
    } catch (e) {
      const message = (e as Error).message;
      // A definite refusal — ghl-write's own fresh DND check, the Production scope, or no
      // write sign-in — means the note was NOT saved. Anything else is uncertain.
      const refused = /^Do Not Call is not held in GHL for:/.test(message) ? message
        : DEFINITE_REFUSAL.test(message) ? `Not recorded: ${message}` : null;
      if (refused !== null) { clearPending(cid); if (live()) { setPending(null); setState({ kind: "refused", message: refused }); } return; }
      // Uncertain: the write-ahead record stays, for THIS contact, even if Brad has moved on.
      if (!live()) return;
      setState({ kind: "uncertain", message: `The note may or may not have been saved (${message}). Retry looks for it before saving anything again.` });
    }
  }

  async function run(note: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: "busy" });
    try { await commit(contactId, note); }
    finally { inFlight.current = false; }
  }

  function check() {
    const why = reason.trim();
    if (!known || !why || inFlight.current) return;
    void run(dncNote(why));
  }

  function retry() {
    const earlier = pendingNote(contactId);
    if (earlier === null || inFlight.current) return;
    void run(earlier);
  }

  const red = { fontSize: "12px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.10)", color: "#F87171" } as const;
  const plain = { fontSize: "12px", padding: "8px 14px", borderRadius: "8px", border: "1px solid #334155", background: "transparent", color: "#94A3B8" } as const;
  const message = "message" in state ? state.message : null;
  const retryButton = <> <button data-testid="dnc-retry" onClick={retry} disabled={busy} style={{ ...red, padding: "4px 10px" }}>Retry</button></>;

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
            <button data-testid="dnc-check" onClick={check} disabled={busy || !known || reason.trim() === ""}
              style={{ ...red, opacity: reason.trim() === "" ? 0.45 : 1, cursor: busy || reason.trim() === "" ? "not-allowed" : "pointer" }}>
              {busy ? "Checking GHL…" : "I've set it — check now"}
            </button>
            {/* Cancel closes the form only; an unresolved attempt for this contact is kept. */}
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
          {state.kind === "uncertain" && pending !== null ? retryButton : null}
        </div>
      ) : pending !== null && state.kind !== "done" && state.kind !== "busy" ? (
        <div data-testid="dnc-pending" style={{ marginTop: "8px", fontSize: "12px", color: "#F59E0B" }}>
          {PENDING_TEXT}
          {retryButton}
        </div>
      ) : null}
    </div>
  );
}
