import { useRef, useState } from "react";
import { ghl, CALL_DISPOSITION_ID } from "../lib/ghl";
import { recordOverride, type StorageLike } from "../lib/dispositionOverride";
import {
  CALL_LOG_RESULTS, CALL_LOG_HEADING, CALL_LOG_EFFECT, CALL_LOG_PURPOSE, CALL_NOTES_MAX, CALL_NOTES_PLACEHOLDER,
  FOLLOW_UP_CALLBACK_HINT, GHL_CALL_LOGGING_LINE, callLogNote, parseCallLogNote, type CallLogResult,
} from "../lib/call-outcome-copy";
import { ReadUnavailableError } from "../lib/read-session";

/**
 * B14-12 / INV-94 — the contact-page call log (recording-only; Brad's design,
 * ruled by Jess 2026-10-02). Replaces Board 4's dial-result control.
 *
 * A result is a RECORD, not an automation command. Choosing one writes
 * nothing; "Save call" writes, in order:
 *   1. the result      (`contact.callLogResult` — iaos_call_disposition ONLY)
 *   2. its readback    (nothing further unless GHL confirms it)
 *   3. the call note   ("Call (reported by Brad in IAOS): {result}" + notes)
 *   4. the last touch  (`contact.lastCallAttempt`)
 * It never writes `iaos_disposition_at` or `iaos_call_routing` — the fields
 * GHL seller workflows watch — and the server's `contact.callLogResult`
 * operation cannot. No stage, tag, enrollment or message.
 *
 * Callbacks are a separate, explicit action: Follow Up only points to Set
 * Callback (`onOpenCallback`); it never schedules one.
 */

const VERIFY_UNAVAILABLE = "can't be verified because read sign-in is required. Sign in to reads and reload the page -- do not retry.";

type Submit =
  | { status: "idle" }
  | { status: "in_flight" }
  | { status: "done"; result: CallLogResult }
  | { status: "partial"; result: CallLogResult; message: string; retryNote: string | null }
  | { status: "saved_unverified"; message: string }
  | { status: "not_saved"; message: string };

function storage(): StorageLike | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

const slug = (s: string) => s.replace(/\s+/g, "-").toLowerCase();

export function CallLogControl({ contactId, notes, onAttempt, onNoteWritten, onOpenCallback }: {
  contactId: string;
  /** This contact's notes as the page holds them; the newest call-log note is summarized. */
  notes: { body: string; dateAdded: string }[] | null;
  /** Fires only on a CONFIRMED last-touch write. */
  onAttempt: (iso: string) => void;
  /** Fires after the call note is saved, so the page's notes list shows it. */
  onNoteWritten: () => void;
  /** Opens the page's own Set Callback control. Writes nothing by itself. */
  onOpenCallback: () => void;
}) {
  const [result, setResult] = useState<CallLogResult | null>(null);
  const [text, setText] = useState("");
  const [submit, setSubmit] = useState<Submit>({ status: "idle" });
  const inFlight = useRef(false);
  /* Board 15 cleanup (Bones, PR #131 P1): a result write GHL CONFIRMED whose
     readback then failed is an UNRESOLVED attempt. It owns this control until
     a readback reconciles it: no second save (handler and button), and
     choosing another result does not clear it. Set the moment the result
     write is confirmed; cleared only by a readback that answers. */
  const unresolved = useRef<{ result: CallLogResult; body: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = submit.status === "in_flight";
  const owned = submit.status === "saved_unverified";

  const lastCall = (() => {
    const rows = (notes ?? [])
      .map((n) => ({ parsed: parseCallLogNote(n.body), at: n.dateAdded }))
      .filter((r): r is { parsed: { result: string; notes: string }; at: string } => r.parsed !== null)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return rows[0] ?? null;
  })();

  /* Note, then last touch — shared by Save and by the note Retry. */
  async function writeNoteAndTouch(saved: CallLogResult, body: string) {
    let noteError: string | null = null;
    try { await ghl.notes.create(contactId, body); onNoteWritten(); }
    catch (e) { noteError = (e as Error).message; }
    if (noteError) {
      setSubmit({ status: "partial", result: saved, message: `Result saved; notes not saved (${noteError}).`, retryNote: body });
      return;
    }
    const at = new Date().toISOString();
    try { await ghl.contacts.setLastCallAttempt(contactId, at); onAttempt(at); }
    catch (e) {
      setSubmit({ status: "partial", result: saved, message: `Saved; last-touch time not updated (${(e as Error).message}).`, retryNote: null });
      return;
    }
    setSubmit({ status: "done", result: saved });
    setResult(null);
    setText("");
  }

  async function save() {
    if (!result || inFlight.current) return;   // synchronous double-submit guard
    if (unresolved.current) return;            // an unresolved confirmed attempt owns the control
    inFlight.current = true;
    const chosen = result;
    const body = callLogNote(chosen, text.slice(0, CALL_NOTES_MAX));
    setSubmit({ status: "in_flight" });
    try {
      await ghl.contacts.setCallLogResult(contactId, chosen);
      unresolved.current = { result: chosen, body };
      /* From here ghl-write has CONFIRMED the result write. A readback that
         fails for ANY reason (read sign-in, a 500, a network error) is
         "saved but unverified" — never "nothing was written" — and nothing
         further is attempted: no note, no last touch, and no second result
         write (Bones, PR #117). */
      let landed: boolean;
      try {
        const detail = await ghl.contacts.getDetail(contactId);
        const got = detail.customFields.find((f) => f.id === CALL_DISPOSITION_ID)?.value;
        landed = (got == null ? "" : String(got).trim()) === chosen;
      } catch (e) {
        setSubmit({ status: "saved_unverified", message: e instanceof ReadUnavailableError
          ? `Result saved -- IAOS confirmed the write, but it ${VERIFY_UNAVAILABLE} Notes and last-touch time were not attempted.`
          : `Result saved -- IAOS confirmed the write, but couldn't read it back to verify it (${(e as Error).message}). Reload the contact to check it; do not save it again. Notes and last-touch time were not attempted.` });
        return;
      }
      unresolved.current = null;               // the readback answered: reconciled either way
      if (!landed) {
        setSubmit({ status: "not_saved", message: "GHL did not confirm the result. Nothing else was written." });
        return;
      }
      // Session override: the Dashboard's queue placement sees the result at once.
      recordOverride(storage(), contactId, chosen, new Date().toISOString(), Date.now());
      await writeNoteAndTouch(chosen, body);
    } catch (e) {
      // The result write itself did not confirm. It may or may not have
      // landed, so this never claims that nothing was written.
      setSubmit({ status: "not_saved", message: `Result not confirmed (${(e as Error).message}). Notes and last-touch time were not attempted. Reload the contact to check it before saving again.` });
    } finally {
      inFlight.current = false;
    }
  }

  /* Check again: the reconciliation an unresolved attempt waits for. Reads the
     saved result back. If GHL holds the confirmed result, the attempt
     finishes exactly as a verified save would have (note, then last touch,
     once). If GHL holds something else, the attempt ends and nothing further
     is sent. If the readback still fails, the attempt stays unresolved. */
  async function checkAgain() {
    const pending = unresolved.current;
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      let landed: boolean;
      try {
        const detail = await ghl.contacts.getDetail(contactId);
        const got = detail.customFields.find((f) => f.id === CALL_DISPOSITION_ID)?.value;
        landed = (got == null ? "" : String(got).trim()) === pending.result;
      } catch (e) {
        setSubmit({ status: "saved_unverified", message: `Still can't verify the saved result (${(e as Error).message}). Notes and last-touch time were not attempted. Check again once reads work; do not save it again.` });
        return;
      }
      unresolved.current = null;
      if (!landed) {
        setSubmit({ status: "not_saved", message: `GHL no longer shows "${pending.result}" as the saved result. Notes and last-touch time were not attempted. Reload the contact to check it before saving again.` });
        return;
      }
      recordOverride(storage(), contactId, pending.result, new Date().toISOString(), Date.now());
      setSubmit({ status: "in_flight" });
      await writeNoteAndTouch(pending.result, pending.body);
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  async function retryNote() {
    if (submit.status !== "partial" || !submit.retryNote || inFlight.current) return;
    inFlight.current = true;
    const { result: saved, retryNote: body } = submit;
    setSubmit({ status: "in_flight" });
    try { await writeNoteAndTouch(saved, body); } finally { inFlight.current = false; }
  }

  const btn = (active: boolean) => ({
    fontSize: "12px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px",
    border: `1px solid ${active ? "rgba(30,200,255,0.75)" : "rgba(30,200,255,0.35)"}`,
    background: active ? "rgba(30,200,255,0.22)" : "rgba(30,200,255,0.08)", color: "#1EC8FF",
    cursor: busy ? "not-allowed" : "pointer",
  });

  return (
    <div data-testid="call-log" style={{ marginTop: "14px", padding: "14px 16px", border: "1px solid #1E293B", borderRadius: "10px", background: "#0D1B3E" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#F1F5F9", marginBottom: "4px" }}>{CALL_LOG_HEADING}</div>
      <div data-testid="call-log-purpose" style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "6px" }}>{CALL_LOG_PURPOSE}</div>
      <div data-testid="call-log-effect" style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px", lineHeight: 1.5 }}>
        {CALL_LOG_EFFECT} {GHL_CALL_LOGGING_LINE}
      </div>

      {lastCall ? (
        <div data-testid="call-log-last" style={{ fontSize: "12px", color: "#CBD5E1", marginBottom: "10px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          <strong>Last call:</strong> {lastCall.parsed.result} · {new Date(lastCall.at).toLocaleString()}
          {lastCall.parsed.notes ? `\n${lastCall.parsed.notes}` : ""}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {CALL_LOG_RESULTS.map((r) => (
          <button key={r} data-testid={`call-log-result-${slug(r)}`} aria-pressed={result === r}
            onClick={() => { if (unresolved.current) return; setResult(r); if (submit.status !== "in_flight") setSubmit({ status: "idle" }); }}
            disabled={busy || owned} style={btn(result === r)}>
            {r}
          </button>
        ))}
      </div>

      {result === "Follow Up" ? (
        <div data-testid="call-log-follow-up-hint" style={{ marginTop: "8px", fontSize: "12px", color: "#FBBF24", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {FOLLOW_UP_CALLBACK_HINT}
          <button data-testid="call-log-set-callback" onClick={onOpenCallback} disabled={busy} style={btn(false)}>Set Callback</button>
        </div>
      ) : null}

      <textarea data-testid="call-log-notes" value={text} maxLength={CALL_NOTES_MAX}
        onChange={(e) => setText(e.target.value)} placeholder={CALL_NOTES_PLACEHOLDER} rows={3} disabled={busy || owned}
        style={{ marginTop: "10px", width: "100%", boxSizing: "border-box", background: "#0B1220", color: "#E2E8F0", border: "1px solid #334155", borderRadius: "6px", padding: "8px 10px", fontSize: "12px", fontFamily: "inherit", resize: "vertical" }} />

      <div style={{ marginTop: "8px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button data-testid="call-log-save" onClick={() => void save()} disabled={busy || owned || !result}
          style={{ ...btn(true), opacity: result && !owned ? 1 : 0.45, cursor: busy || owned || !result ? "not-allowed" : "pointer" }}>
          {busy ? "Saving…" : "Save call"}
        </button>
        <span style={{ fontSize: "12px", minHeight: "18px" }}>
          {submit.status === "done" ? <span data-testid="call-log-done" style={{ color: "#22C55E" }}>Saved: {submit.result}.</span> : null}
          {submit.status === "partial" ? (
            <span data-testid="call-log-partial" style={{ color: "#F87171" }}>
              {submit.result}: {submit.message}{" "}
              {submit.retryNote ? <button data-testid="call-log-retry-note" onClick={() => void retryNote()} style={btn(false)}>Retry notes</button> : null}
            </span>
          ) : null}
          {submit.status === "saved_unverified" ? <span data-testid="call-log-saved-unverified" style={{ color: "#F59E0B" }}>{submit.message}</span> : null}
          {owned ? (
            <button data-testid="call-log-check-again" onClick={() => void checkAgain()} disabled={checking} style={btn(false)}>
              {checking ? "Checking…" : "Check again"}
            </button>
          ) : null}
          {submit.status === "not_saved" ? <span data-testid="call-log-not-saved" style={{ color: "#F87171" }}>{submit.message}</span> : null}
        </span>
      </div>
    </div>
  );
}
