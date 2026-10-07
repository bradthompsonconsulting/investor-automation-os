import { newV2Id } from "../lib/v2-ids";
import { useEffect, useRef, useState } from "react";
import { ghl, CALL_DISPOSITION_ID } from "../lib/ghl";
import { recordOverride, type StorageLike } from "../lib/dispositionOverride";
import {
  CALL_LOG_RESULTS, CALL_LOG_HEADING, CALL_LOG_EFFECT, CALL_LOG_PURPOSE, CALL_NOTES_MAX, CALL_NOTES_PLACEHOLDER,
  FOLLOW_UP_CALLBACK_HINT, GHL_CALL_LOGGING_LINE, callLogNote, parseCallLogNote, type CallLogResult,
} from "../lib/call-outcome-copy";
import { ReadUnavailableError } from "../lib/read-session";
import {
  beginOperation, resumeOperation, retryAttempt, settleLegacy, readCallLogStatus, readOperation, sendCallLogStep, describe, requestIdFor,
  RESERVATION_FAILED_MESSAGE, CHECK_FAILED_MESSAGE, type CallLogView,
} from "../lib/call-log-barrier-client";

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
 * Board 15 / PR #131 — DURABLE OPERATIONS (Bones-approved lifecycle v3,
 * docs/CALL_LOG_SAVE_LIFECYCLE.md). One Save is one server operation with a
 * permanent id, discoverable by every session. Steps carry derived request
 * ids; Check again (resume) and Retry notes / Retry last-touch time (retry)
 * only ever continue THAT operation; a new call is a new operation. After any
 * answer that is not a confirmation, the page reads the operation by its
 * ORIGINAL id and shows what the server recorded — never an inference. Only a
 * recorded, complete operation is shown as "Saved".
 *
 * Callbacks are a separate, explicit action: Follow Up only points to Set
 * Callback (`onOpenCallback`); it never schedules one.
 */

const VERIFY_UNAVAILABLE = "can't be verified because read sign-in is required. Sign in to reads, then use Check again to finish this call -- do not save it again.";

type Submit =
  | { status: "idle" }
  | { status: "in_flight" }
  | { status: "done"; result: CallLogResult }
  | { status: "partial"; result: CallLogResult; message: string; retry: { slot: "note" | "touch"; after: number } | null }
  | { status: "saved_unverified"; message: string }
  | { status: "not_saved"; message: string };

/** The contact's call-log ownership as the server reports it. Save is possible only when "clear". */
type Owner =
  | { kind: "checking" }
  | { kind: "clear" }
  | { kind: "busy" }                              // this page's own action is running
  | { kind: "held"; message: string; legacy: boolean };

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
  const [owner, setOwner] = useState<Owner>({ kind: "checking" });
  const [checking, setChecking] = useState(false);
  /* The contacts with a save or check running in THIS page. Per contact: an
     operation for A keeps running to its end after the page moves to B, and
     neither blocks the other. */
  const inFlight = useRef<Set<string>>(new Set());
  /* The operation this page knows for each contact (its own Save, or the one
     the server reported open). Delayed answers are read by this ORIGINAL id. */
  const operations = useRef<Map<string, string>>(new Map());
  /* An operation always runs to its end for ITS contact; only the screen
     follows the contact shown -- a late answer for A never reaches B's screen. */
  const current = useRef(contactId);
  current.current = contactId;
  const forThis = (cid: string) => current.current === cid;
  const busy = submit.status === "in_flight";
  const locked = owner.kind !== "clear";

  /** Shows what the server recorded for an operation (or the contact). Never sends anything. */
  function apply(cid: string, view: CallLogView, keepMessage = false) {
    if (!forThis(cid)) return;
    if (view.state === "open") operations.current.set(cid, view.op);
    const d = describe(view);
    if (d.tone === "clear") { setOwner({ kind: "clear" }); return; }
    if (d.tone === "done" && view.state === "finished") {
      setSubmit({ status: "done", result: view.outcome.result as CallLogResult });
      setResult(null); setText("");
      setOwner({ kind: "clear" });
      return;
    }
    if (d.tone === "not_saved") {
      if (!keepMessage) setSubmit({ status: "not_saved", message: d.message });
      setOwner({ kind: "clear" });
      return;
    }
    if (d.tone === "partial" && view.state === "open") {
      setSubmit({ status: "partial", result: view.result as CallLogResult, message: d.message, retry: d.retry ?? null });
      setOwner({ kind: "held", message: "", legacy: false });
      return;
    }
    if (!keepMessage) setSubmit((s: Submit) => (s.status === "in_flight" || s.status === "done" ? { status: "idle" } : s));
    setOwner({ kind: "held", message: d.message, legacy: view.state === "legacy" });
  }

  /* Load / contact change: does any session hold an unfinished call save here? */
  useEffect(() => {
    const cid = contactId;
    setOwner({ kind: "checking" });
    setSubmit({ status: "idle" });
    void readCallLogStatus(cid).then((v) => {
      if (!forThis(cid)) return;
      if (v.state === "finished") { setOwner({ kind: "clear" }); return; }   // a just-finished operation: nothing open
      apply(cid, v);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const lastCall = (() => {
    const rows = (notes ?? [])
      .map((n) => ({ parsed: parseCallLogNote(n.body), at: n.dateAdded }))
      .filter((r): r is { parsed: { result: string; notes: string }; at: string } => r.parsed !== null)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return rows[0] ?? null;
  })();

  /**
   * Continues ONE operation through the server's next actions: each "send" is
   * an existing, published attempt (same request id), sent once; anything that
   * is not a confirmation ends here and the operation is read by its original
   * id. Shared by Save, Check again and the retries.
   */
  async function runOperation(cid: string, op: string, first: CallLogView | null) {
    let view: CallLogView | null = first;
    for (let i = 0; i < 8; i++) {
      if (!view) {
        try { view = await resumeOperation(cid, op); }
        catch { view = await readOperation(cid, op); }
      }
      if (view.state !== "open" || view.next.action !== "send") { apply(cid, view); return; }
      const { slot, requestId } = view.next;
      if (slot === "result") { apply(cid, view); return; }   // a result is sent once, by Save; never re-sent here
      const at = new Date().toISOString();
      const outcome = await sendCallLogStep(cid, slot, requestId, slot === "note" ? { body: view.body ?? "" } : { value: at });
      if (outcome.kind === "confirmed") {
        // The operation runs to its end for ITS contact; only the screen follows the contact shown.
        if (forThis(cid)) { if (slot === "note") onNoteWritten(); else onAttempt(at); }
        view = null;
        continue;
      }
      // Not a confirmation: read THIS operation by its original id and show what was recorded.
      apply(cid, await readOperation(cid, op));
      return;
    }
    apply(cid, await readOperation(cid, op));
  }

  async function save() {
    const cid = contactId;
    if (!result || inFlight.current.has(cid)) return;   // synchronous double-submit guard
    if (owner.kind !== "clear") return;        // an unfinished call save (any session) owns this contact
    inFlight.current.add(cid);
    const chosen = result;
    const body = callLogNote(chosen, text.slice(0, CALL_NOTES_MAX));
    const op = newV2Id();
    operations.current.set(cid, op);
    setSubmit({ status: "in_flight" });
    setOwner({ kind: "busy" });
    try {
      // 0. Durable ownership first: a NEW operation; nothing is sent unless this succeeds.
      let reserved: Awaited<ReturnType<typeof beginOperation>>;
      try { reserved = await beginOperation(cid, op, chosen, body); }
      catch {
        if (!forThis(cid)) return;
        setSubmit({ status: "not_saved", message: RESERVATION_FAILED_MESSAGE });
        setOwner({ kind: "held", message: RESERVATION_FAILED_MESSAGE, legacy: false });
        return;
      }
      if (reserved.state === "held") { operations.current.delete(cid); if (forThis(cid)) { setSubmit({ status: "idle" }); apply(cid, reserved.current); } return; }
      if (reserved.state !== "reserved") { apply(cid, reserved); return; }

      // 1. The result, sent ONCE with its derived id. From here the operation runs
      // to its end for ITS contact, even if the page has moved on.
      const sent = await sendCallLogStep(cid, "result", requestIdFor(op, "result", 1), { value: chosen });
      if (sent.kind === "not_sent") { apply(cid, await readOperation(cid, op)); return; }
      if (sent.kind === "uncertain") {
        // The result write itself did not confirm. It may or may not have
        // landed, so this never claims that nothing was written.
        if (!forThis(cid)) return;
        setSubmit({ status: "not_saved", message: `Result not confirmed (${sent.message}). Notes and last-touch time were not attempted. It may still reach GHL — use Check again; do not save it again.` });
        apply(cid, await readOperation(cid, op), true);
        return;
      }
      /* From here ghl-write has CONFIRMED the result write. A readback that
         fails for ANY reason (read sign-in, a 500, a network error) is
         "saved but unverified" — never "nothing was written" — and nothing
         further is attempted here: no note, no last touch, and no second result
         write (Bones, PR #117). The operation keeps the note and last touch for
         Check again, which finishes them with their reserved ids. */
      let landed: boolean;
      try {
        const detail = await ghl.contacts.getDetail(cid);
        const got = detail.customFields.find((f) => f.id === CALL_DISPOSITION_ID)?.value;
        landed = (got == null ? "" : String(got).trim()) === chosen;
      } catch (e) {
        if (!forThis(cid)) return;
        setSubmit({ status: "saved_unverified", message: e instanceof ReadUnavailableError
          ? `Result saved -- IAOS confirmed the write, but it ${VERIFY_UNAVAILABLE} Notes and last-touch time were not attempted.`
          : `Result saved -- IAOS confirmed the write, but couldn't read it back to verify it (${(e as Error).message}). Use Check again to finish this call; do not save it again. Notes and last-touch time were not attempted.` });
        apply(cid, await readOperation(cid, op), true);
        return;
      }
      if (!landed) {
        if (!forThis(cid)) return;
        setSubmit({ status: "not_saved", message: "GHL did not confirm the result on a fresh read. Notes and last-touch time were not attempted; use Check again." });
        apply(cid, await readOperation(cid, op), true);
        return;
      }
      // Session override: the Dashboard's queue placement sees the result at once.
      recordOverride(storage(), cid, chosen, new Date().toISOString(), Date.now());
      await runOperation(cid, op, null);
    } finally {
      inFlight.current.delete(cid);
    }
  }

  /* Check again: the server settles THIS operation from its own records and
     names the next step of the existing attempts. Nothing here reads GHL to
     decide, and nothing is re-sent under a new id. */
  async function checkAgain() {
    const cid = contactId;
    if (inFlight.current.has(cid)) return;
    inFlight.current.add(cid);
    setChecking(true);
    try {
      if (owner.kind === "held" && owner.legacy) {
        try { apply(cid, await settleLegacy(cid)); } catch { if (forThis(cid)) setOwner({ kind: "held", message: CHECK_FAILED_MESSAGE, legacy: true }); }
        return;
      }
      let op = operations.current.get(cid);
      if (!op) { const v = await readCallLogStatus(cid); if (v.state !== "open") { apply(cid, v); return; } op = v.op; }
      const known = op;
      let first: CallLogView;
      try { first = await resumeOperation(cid, known); }
      catch { if (forThis(cid)) setOwner({ kind: "held", message: CHECK_FAILED_MESSAGE, legacy: false }); return; }
      if (first.state === "open" && first.next.action === "send") {
        if (forThis(cid)) { setOwner({ kind: "busy" }); setSubmit({ status: "in_flight" }); }
        recordOverride(storage(), cid, first.result as CallLogResult, new Date().toISOString(), Date.now());
      }
      await runOperation(cid, known, first);
    } finally {
      inFlight.current.delete(cid);
      setChecking(false);
    }
  }

  /* Retry notes / Retry last-touch time: an explicit retry of the attempt the
     server reported proved unsent. It names that attempt; the server publishes
     the next attempt of the SAME operation, or -- for a stale click -- returns
     the existing attempt or the recorded outcome and creates nothing. */
  async function retry() {
    const cid = contactId;
    const op = operations.current.get(cid);
    if (submit.status !== "partial" || !submit.retry || !op || inFlight.current.has(cid)) return;
    inFlight.current.add(cid);
    const { slot, after } = submit.retry;
    setSubmit({ status: "in_flight" });
    setOwner({ kind: "busy" });
    try {
      let view: CallLogView;
      try { view = await retryAttempt(cid, op, slot, after); }
      catch { apply(cid, await readOperation(cid, op)); return; }
      await runOperation(cid, op, view);
    } finally { inFlight.current.delete(cid); }
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

      {owner.kind === "held" && owner.message ? (
        <div data-testid="call-log-blocked" role="status" style={{ fontSize: "12px", color: "#F59E0B", marginBottom: "10px", lineHeight: 1.5 }}>
          {owner.message}{" "}
          <button data-testid="call-log-check-again" onClick={() => void checkAgain()} disabled={checking || busy} style={btn(false)}>
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      ) : null}
      {owner.kind === "checking" ? (
        <div data-testid="call-log-checking" style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px" }}>Checking for an unfinished call save…</div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {CALL_LOG_RESULTS.map((r) => (
          <button key={r} data-testid={`call-log-result-${slug(r)}`} aria-pressed={result === r}
            onClick={() => { if (owner.kind === "held") return; setResult(r); if (submit.status !== "in_flight") setSubmit({ status: "idle" }); }}
            disabled={busy || owner.kind === "held"} style={btn(result === r)}>
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
        <button data-testid="call-log-save" onClick={() => void save()} disabled={busy || locked || !result}
          style={{ ...btn(true), opacity: result && !locked ? 1 : 0.45, cursor: busy || locked || !result ? "not-allowed" : "pointer" }}>
          {busy ? "Saving…" : "Save call"}
        </button>
        <span style={{ fontSize: "12px", minHeight: "18px" }}>
          {submit.status === "done" ? <span data-testid="call-log-done" style={{ color: "#22C55E" }}>Saved: {submit.result}.</span> : null}
          {submit.status === "partial" ? (
            <span data-testid="call-log-partial" style={{ color: "#F87171" }}>
              {submit.result}: {submit.message}{" "}
              {submit.retry?.slot === "note" ? <button data-testid="call-log-retry-note" onClick={() => void retry()} style={btn(false)}>Retry notes</button> : null}
              {submit.retry?.slot === "touch" ? <button data-testid="call-log-retry-touch" onClick={() => void retry()} style={btn(false)}>Retry last-touch time</button> : null}
            </span>
          ) : null}
          {submit.status === "saved_unverified" ? <span data-testid="call-log-saved-unverified" style={{ color: "#F59E0B" }}>{submit.message}</span> : null}
          {submit.status === "not_saved" ? <span data-testid="call-log-not-saved" style={{ color: "#F87171" }}>{submit.message}</span> : null}
        </span>
      </div>
    </div>
  );
}
