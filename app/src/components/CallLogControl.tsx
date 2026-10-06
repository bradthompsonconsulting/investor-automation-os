import { useEffect, useRef, useState } from "react";
import { ghl, CALL_DISPOSITION_ID } from "../lib/ghl";
import { recordOverride, type StorageLike } from "../lib/dispositionOverride";
import {
  CALL_LOG_RESULTS, CALL_LOG_HEADING, CALL_LOG_EFFECT, CALL_LOG_PURPOSE, CALL_NOTES_MAX, CALL_NOTES_PLACEHOLDER,
  FOLLOW_UP_CALLBACK_HINT, GHL_CALL_LOGGING_LINE, callLogNote, parseCallLogNote, type CallLogResult,
} from "../lib/call-outcome-copy";
import { ReadUnavailableError } from "../lib/read-session";
import {
  beginCallLog, reconcileCallLog, readCallLogStatus, sendCallLogStep, newCallLogRequestIds,
  RESERVATION_FAILED_MESSAGE, CHECK_FAILED_MESSAGE, type CallLogStep, type ReconcileView,
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
 * Board 15 / PR #131 (Bones) — DURABLE OWNERSHIP. The sequence is owned by a
 * server reservation for this contact (call-log-barrier), taken BEFORE the
 * first write and visible to every session: a reload, a navigation or another
 * browser sees an unfinished save and cannot start another. Each step carries
 * its reserved request id, the server sends it only after the previous step
 * is confirmed and at most once, and an unfinished save is finished with the
 * SAME ids (Check again) — never re-sent under new ones. The full map is
 * docs/CALL_LOG_SAVE_LIFECYCLE.md.
 *
 * Callbacks are a separate, explicit action: Follow Up only points to Set
 * Callback (`onOpenCallback`); it never schedules one.
 */

const VERIFY_UNAVAILABLE = "can't be verified because read sign-in is required. Sign in to reads, then use Check again to finish this call -- do not save it again.";

type Submit =
  | { status: "idle" }
  | { status: "in_flight" }
  | { status: "done"; result: CallLogResult }
  | { status: "partial"; result: CallLogResult; message: string; retryNote: string | null }
  | { status: "saved_unverified"; message: string }
  | { status: "not_saved"; message: string };

/** The contact's call-log ownership as the server reports it. Save is possible only when "clear". */
type Owner =
  | { kind: "checking" }
  | { kind: "clear" }
  | { kind: "busy" }                              // this page's own attempt is running
  | { kind: "blocked"; message: string };

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
     attempt for A keeps running to its end after the page moves to B, and
     neither blocks the other. */
  const inFlight = useRef<Set<string>>(new Set());
  /* An attempt always runs to its end for ITS contact; only the screen follows
     the contact shown -- a late answer for A never reaches B's screen. */
  const current = useRef(contactId);
  current.current = contactId;
  const forThis = (cid: string) => current.current === cid;
  const busy = submit.status === "in_flight";
  const locked = owner.kind !== "clear";

  /* Load / contact change: does any session hold an unfinished call save here? */
  useEffect(() => {
    const cid = contactId;
    setOwner({ kind: "checking" });
    setSubmit({ status: "idle" });
    void readCallLogStatus(cid).then((v) => {
      if (!forThis(cid)) return;
      setOwner(v.state === "clear" ? { kind: "clear" } : { kind: "blocked", message: v.message });
    });
  }, [contactId]);

  async function refreshOwner(cid: string) {
    const v = await readCallLogStatus(cid);
    if (!forThis(cid)) return;
    setOwner(v.state === "clear" ? { kind: "clear" } : { kind: "blocked", message: v.message });
  }

  const lastCall = (() => {
    const rows = (notes ?? [])
      .map((n) => ({ parsed: parseCallLogNote(n.body), at: n.dateAdded }))
      .filter((r): r is { parsed: { result: string; notes: string }; at: string } => r.parsed !== null)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return rows[0] ?? null;
  })();

  /**
   * Sends the remaining reserved steps of THIS contact's attempt, in order,
   * each with its reserved request id (note, then last touch). Shared by Save,
   * by Check again (finishing an attempt with its original ids) and by Retry
   * notes. Stops at the first step that is not confirmed.
   */
  async function finishSteps(cid: string, attempt: string, saved: CallLogResult, body: string, remaining: { step: CallLogStep; requestId: string }[]) {
    for (const { step, requestId } of remaining) {
      if (step === "result") continue;   // never re-sent here; Save sends it once
      const at = new Date().toISOString();
      const outcome = await sendCallLogStep(cid, step, requestId, step === "note" ? { body } : { value: at });
      if (outcome.kind === "confirmed") {
        // The attempt runs to its end for ITS contact; only the screen follows the contact shown.
        if (forThis(cid)) { if (step === "note") onNoteWritten(); else onAttempt(at); }
        continue;
      }
      if (outcome.kind === "uncertain") {
        if (!forThis(cid)) return;
        setSubmit({ status: "partial", result: saved, retryNote: null, message: step === "note"
          ? `Result saved; the call note may or may not have reached GHL (${outcome.message}). Nothing more will be saved for this contact until it is resolved — use Check again.`
          : `Saved; the last-touch time may or may not have been updated (${outcome.message}). Use Check again.` });
        await refreshOwner(cid);
        return;
      }
      // Provably not sent. Let the server settle it: a step that can never be
      // sent ends the attempt; one that is merely not ready yet stays resumable.
      await settleAfterRefusal(cid, attempt, saved, step, outcome.message);
      return;
    }
    if (!forThis(cid)) return;
    setSubmit({ status: "done", result: saved });
    setResult(null);
    setText("");
    setOwner({ kind: "clear" });
  }

  async function settleAfterRefusal(cid: string, attempt: string, saved: CallLogResult, step: CallLogStep, why: string) {
    let r: ReconcileView;
    // Scoped to THIS attempt: if a newer one is current, nothing is changed.
    try { r = await reconcileCallLog(cid, attempt); }
    catch { if (forThis(cid)) { setSubmit({ status: "partial", result: saved, retryNote: null, message: `Not finished (${why}).` }); setOwner({ kind: "blocked", message: CHECK_FAILED_MESSAGE }); } return; }
    if (!forThis(cid)) return;
    const refused = step === "note" ? `Result saved; notes not saved (${why}).` : `Saved; last-touch time not updated (${why}).`;
    // Not finished and not ended (e.g. the contact's write lock was busy): the step keeps its reserved id for Check again.
    if (r.state !== "clear") setSubmit({ status: "partial", result: saved, retryNote: null, message: `${refused} Use Check again to finish it.` });
    showReconciled(r, refused);
  }

  /** Applies what the server's reconcile found. Never sends anything by itself. */
  function showReconciled(r: ReconcileView, refusedMessage?: string) {
    if (r.state === "resumable") { setOwner({ kind: "blocked", message: r.message }); return; }
    if (r.state === "blocked") { setOwner({ kind: "blocked", message: r.message }); return; }
    setOwner({ kind: "clear" });
    const sum = r.summary;
    if (!sum) return;
    const ev = Object.fromEntries(sum.steps.map((s) => [s.step, s.evidence])) as Partial<Record<CallLogStep, string>>;
    const saved = sum.result as CallLogResult;
    if (ev.result !== undefined && ev.result !== "confirmed") {
      setSubmit({ status: "not_saved", message: `"${saved}" was not saved — nothing was sent to GHL.` });
    } else if (ev.note !== "confirmed") {
      setSubmit({ status: "partial", result: saved, retryNote: sum.body, message: refusedMessage ?? "Result saved; notes not saved." });
    } else if (ev.touch !== "confirmed") {
      setSubmit({ status: "partial", result: saved, retryNote: null, message: refusedMessage ?? "Saved; last-touch time not updated." });
    } else {
      setSubmit({ status: "done", result: saved });
    }
  }

  async function save() {
    const cid = contactId;
    if (!result || inFlight.current.has(cid)) return;   // synchronous double-submit guard
    if (owner.kind !== "clear") return;        // an unfinished call save (any session) owns this contact
    inFlight.current.add(cid);
    const chosen = result;
    const body = callLogNote(chosen, text.slice(0, CALL_NOTES_MAX));
    const ids = newCallLogRequestIds(["result", "note", "touch"] as const);
    setSubmit({ status: "in_flight" });
    setOwner({ kind: "busy" });
    try {
      // 0. Durable ownership first: nothing is sent unless this succeeds.
      let reserved: Awaited<ReturnType<typeof beginCallLog>>;
      try { reserved = await beginCallLog(cid, "call_log", chosen, body, [{ step: "result", requestId: ids.result }, { step: "note", requestId: ids.note }, { step: "touch", requestId: ids.touch }]); }
      catch {
        if (!forThis(cid)) return;
        setSubmit({ status: "not_saved", message: RESERVATION_FAILED_MESSAGE });
        setOwner({ kind: "blocked", message: RESERVATION_FAILED_MESSAGE });
        return;
      }
      if (reserved.state === "blocked") { if (forThis(cid)) { setSubmit({ status: "idle" }); setOwner({ kind: "blocked", message: reserved.message }); } return; }

      // 1. The result. From here the attempt runs to its end for ITS contact,
      // even if the page has moved on; only the screen follows the contact shown.
      const sent = await sendCallLogStep(cid, "result", ids.result, { value: chosen });
      if (sent.kind === "not_sent") {
        await settleAfterRefusal(cid, ids.result, chosen, "result", sent.message);
        if (forThis(cid)) setSubmit({ status: "not_saved", message: `Result not saved — nothing was sent (${sent.message}).` });
        return;
      }
      if (sent.kind === "uncertain") {
        // The result write itself did not confirm. It may or may not have
        // landed, so this never claims that nothing was written.
        if (!forThis(cid)) return;
        setSubmit({ status: "not_saved", message: `Result not confirmed (${sent.message}). Notes and last-touch time were not attempted. It may still reach GHL — use Check again; do not save it again.` });
        await refreshOwner(cid);
        return;
      }
      /* From here ghl-write has CONFIRMED the result write. A readback that
         fails for ANY reason (read sign-in, a 500, a network error) is
         "saved but unverified" — never "nothing was written" — and nothing
         further is attempted here: no note, no last touch, and no second result
         write (Bones, PR #117). The reservation keeps the note and last touch
         for Check again, which finishes them with their reserved ids. */
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
        await refreshOwner(cid);
        return;
      }
      if (!landed) {
        if (!forThis(cid)) return;
        setSubmit({ status: "not_saved", message: "GHL did not confirm the result on a fresh read. Notes and last-touch time were not attempted; use Check again." });
        await refreshOwner(cid);
        return;
      }
      // Session override: the Dashboard's queue placement sees the result at once.
      recordOverride(storage(), cid, chosen, new Date().toISOString(), Date.now());
      await finishSteps(cid, ids.result, chosen, body, [{ step: "note", requestId: ids.note }, { step: "touch", requestId: ids.touch }]);
    } finally {
      inFlight.current.delete(cid);
    }
  }

  /* Check again: the server reconciles from its own evidence. A resumable save
     is finished with its ORIGINAL request ids; nothing is ever re-sent under a
     new id, and nothing here reads GHL to decide. */
  async function checkAgain() {
    const cid = contactId;
    if (inFlight.current.has(cid)) return;
    inFlight.current.add(cid);
    setChecking(true);
    try {
      let r: ReconcileView;
      try { r = await reconcileCallLog(cid); }
      catch { if (forThis(cid)) setOwner({ kind: "blocked", message: CHECK_FAILED_MESSAGE }); return; }
      if (r.state !== "resumable") { if (forThis(cid)) showReconciled(r); return; }
      const saved = r.result as CallLogResult;
      if (forThis(cid)) { setOwner({ kind: "busy" }); setSubmit({ status: "in_flight" }); }
      recordOverride(storage(), cid, saved, new Date().toISOString(), Date.now());
      await finishSteps(cid, r.attempt, saved, r.body, r.remaining);
    } finally {
      inFlight.current.delete(cid);
      setChecking(false);
    }
  }

  /* Retry notes: only after the server PROVED the note was never sent (the
     attempt ended); a new reservation owns the note and last touch. */
  async function retryNote() {
    const cid = contactId;
    if (submit.status !== "partial" || !submit.retryNote || inFlight.current.has(cid) || owner.kind !== "clear") return;
    inFlight.current.add(cid);
    const { result: saved, retryNote: body } = submit;
    const ids = newCallLogRequestIds(["note", "touch"] as const);
    setSubmit({ status: "in_flight" });
    setOwner({ kind: "busy" });
    try {
      let reserved: Awaited<ReturnType<typeof beginCallLog>>;
      try { reserved = await beginCallLog(cid, "call_log_note", saved, body, [{ step: "note", requestId: ids.note }, { step: "touch", requestId: ids.touch }]); }
      catch { if (forThis(cid)) { setSubmit({ status: "partial", result: saved, retryNote: body, message: RESERVATION_FAILED_MESSAGE }); setOwner({ kind: "blocked", message: RESERVATION_FAILED_MESSAGE }); } return; }
      if (reserved.state === "blocked") { if (forThis(cid)) { setSubmit({ status: "partial", result: saved, retryNote: body, message: "Notes not saved." }); setOwner({ kind: "blocked", message: reserved.message }); } return; }
      await finishSteps(cid, ids.note, saved, body, [{ step: "note", requestId: ids.note }, { step: "touch", requestId: ids.touch }]);
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

      {owner.kind === "blocked" ? (
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
            onClick={() => { if (owner.kind === "blocked") return; setResult(r); if (submit.status !== "in_flight") setSubmit({ status: "idle" }); }}
            disabled={busy || owner.kind === "blocked"} style={btn(result === r)}>
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
              {submit.retryNote && owner.kind === "clear" ? <button data-testid="call-log-retry-note" onClick={() => void retryNote()} style={btn(false)}>Retry notes</button> : null}
            </span>
          ) : null}
          {submit.status === "saved_unverified" ? <span data-testid="call-log-saved-unverified" style={{ color: "#F59E0B" }}>{submit.message}</span> : null}
          {submit.status === "not_saved" ? <span data-testid="call-log-not-saved" style={{ color: "#F87171" }}>{submit.message}</span> : null}
        </span>
      </div>
    </div>
  );
}
