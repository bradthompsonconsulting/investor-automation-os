import { useRef, useState } from "react";
import { ghl, CALL_DISPOSITION_ID } from "../lib/ghl";
import { recordOverride, type StorageLike } from "../lib/dispositionOverride";
import {
  CALL_LOG_RESULTS, CALL_LOG_HEADING, CALL_LOG_EFFECT, CALL_NOTES_MAX, CALL_NOTES_PLACEHOLDER,
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
  const busy = submit.status === "in_flight";

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
    inFlight.current = true;
    const chosen = result;
    const body = callLogNote(chosen, text.slice(0, CALL_NOTES_MAX));
    setSubmit({ status: "in_flight" });
    try {
      await ghl.contacts.setCallLogResult(contactId, chosen);
      let landed: boolean;
      try {
        const detail = await ghl.contacts.getDetail(contactId);
        const got = detail.customFields.find((f) => f.id === CALL_DISPOSITION_ID)?.value;
        landed = (got == null ? "" : String(got).trim()) === chosen;
      } catch (e) {
        if (!(e instanceof ReadUnavailableError)) throw e;
        setSubmit({ status: "saved_unverified", message: `Result saved -- IAOS confirmed the write, but it ${VERIFY_UNAVAILABLE} Notes and last-touch time were not written.` });
        return;
      }
      if (!landed) {
        setSubmit({ status: "not_saved", message: "GHL did not confirm the result. Nothing else was written." });
        return;
      }
      // Session override: the Dashboard's queue placement sees the result at once.
      recordOverride(storage(), contactId, chosen, new Date().toISOString(), Date.now());
      await writeNoteAndTouch(chosen, body);
    } catch (e) {
      setSubmit({ status: "not_saved", message: `${(e as Error).message}. Nothing was written.` });
    } finally {
      inFlight.current = false;
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
            onClick={() => { setResult(r); if (submit.status !== "in_flight") setSubmit({ status: "idle" }); }}
            disabled={busy} style={btn(result === r)}>
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
        onChange={(e) => setText(e.target.value)} placeholder={CALL_NOTES_PLACEHOLDER} rows={3} disabled={busy}
        style={{ marginTop: "10px", width: "100%", boxSizing: "border-box", background: "#0B1220", color: "#E2E8F0", border: "1px solid #334155", borderRadius: "6px", padding: "8px 10px", fontSize: "12px", fontFamily: "inherit", resize: "vertical" }} />

      <div style={{ marginTop: "8px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button data-testid="call-log-save" onClick={() => void save()} disabled={busy || !result}
          style={{ ...btn(true), opacity: result ? 1 : 0.45, cursor: busy || !result ? "not-allowed" : "pointer" }}>
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
          {submit.status === "not_saved" ? <span data-testid="call-log-not-saved" style={{ color: "#F87171" }}>{submit.message}</span> : null}
        </span>
      </div>
    </div>
  );
}
