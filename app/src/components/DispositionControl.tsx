import { useEffect, useRef, useState } from "react";
import { ghl, CALL_DISPOSITION_ID, CALL_ROUTING_ID, DISPOSITION_AT_ID, type ContactDetail } from "../lib/ghl";
import {
  readOverrides, recordOverride, effectiveDisposition,
  type StorageLike,
} from "../lib/dispositionOverride";
import { formatCallbackTime } from "../lib/callbackWrite";

/**
 * Board 4 Tranche A — the native disposition control.
 *
 * WHY IT EXISTS. GHL's softphone Call Summary picker is transient (~1-2 min,
 * unrecoverable) and Brad calls from his cell, so the disposition-triggered
 * pipeline almost never fires. This captures the outcome in IAOS instead.
 *
 * ── THE EVENT CONTRACT, which everything below serves ──────────────────────
 * `iaos_disposition_at` means A GENUINE RECORDED CALL OUTCOME HAPPENED.
 *   same disposition yesterday and today          -> two events, two bells
 *   same disposition, different routing           -> still ONE call outcome
 *   accidental duplicate while a submit is in
 *   flight                                        -> one event; prevented by A
 * A routing change is a DIFFERENT FACT from a call outcome, so it does not ring
 * the bell. S7 watches `iaos_call_routing` changing instead.
 *
 * ── THE SEQUENCE. STATE FIRST, BELL LAST. ─────────────────────────────────
 *   1  write iaos_call_disposition
 *   2  write iaos_call_routing = "Stay in Cold Outreach"   (unanswered paths)
 *   3  READ BACK and confirm every carrier this path requires
 *   4  note, then last_call_attempt
 *   5  ring ONE fresh iaos_disposition_at            <-- THE BELL, ALWAYS LAST
 *   6  offer the 60-second non-blocking routing choice
 *   7  nothing selected -> nothing further; durable state already says Stay
 *   8  Move to LTN -> write routing = "Long-Term Nurture", read back
 *
 * Step 2 is what kills the stale-routing path structurally: every eligible call
 * RESETS routing to Stay before offering the choice, so a previous call's LTN
 * cannot leak into this one, and an LTN choice necessarily creates a real
 * Stay -> LTN transition for S7 to see.
 *
 * A 200 IS NOT SUCCESS anywhere in here. `ok` comes from a readback, following
 * saveUnderwritingFields. A browser control has no retry engine, so a partial is
 * NAMED rather than thrown away.
 */

/** The six offered in Tranche A. The GHL field carries seven; Do Not Call is
 *  created but NOT exposed here — it ships in Tranche B with its own suppression
 *  predicate and DND ruling. A human setting it by hand in GHL gets silence, and
 *  that is recorded, not accidental. */
export const TRANCHE_A_DISPOSITIONS = [
  "No Answer",
  "Voicemail",
  "Follow Up",
  "Requested Appointment",
  "Not Interested",
  "Incorrect Number",
] as const;

/** Verbatim option labels. S7's condition binds to ROUTING_LTN exactly. */
export const ROUTING_STAY = "Stay in Cold Outreach";
export const ROUTING_LTN = "Long-Term Nurture";

/** The two paths that end without a conversation, and so offer R5's choice. */
const UNANSWERED = new Set<string>(["No Answer", "Voicemail"]);

/** The one disposition with a confirmed NON-idempotent downstream effect:
 *  Seller 2.5 adds the contact to `Seller 2 - Engagement Detected`, and nothing
 *  un-adds them. B discloses that; it does not block. */
const DISCLOSES_ON = "Requested Appointment";

const ROUTING_WINDOW_MS = 60_000;
const FOLLOW_UP_DEFAULT_DAYS = 3;

type Submit =
  | { status: "idle" }
  | { status: "in_flight"; label: string }
  | { status: "done"; label: string }
  | { status: "partial"; label: string; message: string };

type Routing =
  | { status: "idle" }
  | { status: "in_flight" }
  | { status: "done" }
  /** Persistent, NOT a dismissible toast — it is the only notice that will
   *  ever exist for this failure. See LIMIT 1 below. */
  | { status: "failed"; stage: "write" | "readback" | "bell"; message: string };

function storage(): StorageLike | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

/** Local ISO for a datetime-local input, N days out, rounded to the hour. */
function defaultFollowUp(): string {
  const d = new Date();
  d.setDate(d.getDate() + FOLLOW_UP_DEFAULT_DAYS);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * ONE readback for every carrier a path requires. A single GET confirms all of
 * them, and `ok` is false unless every one matches what was sent.
 */
async function confirmCarriers(
  contactId: string,
  expected: { id: string; value: string; key: string }[],
): Promise<{ ok: boolean; missing: string[] }> {
  const detail: ContactDetail = await ghl.contacts.getDetail(contactId);
  const byId = new Map((detail.customFields ?? []).map((f) => [f.id, f]));
  const missing: string[] = [];
  for (const e of expected) {
    const got = byId.get(e.id);
    const observed = got == null || got.value == null ? "" : String(got.value).trim();
    if (observed !== e.value) missing.push(e.key);
  }
  return { ok: missing.length === 0, missing };
}

export function DispositionControl({ contactId, contact, onAttempt }: {
  contactId: string;
  contact: ContactDetail | null;
  /** Fires only on a CONFIRMED attempt write, so the parent's in-session
   *  override never claims a write that did not land. */
  onAttempt: (iso: string) => void;
}) {
  const [submit, setSubmit] = useState<Submit>({ status: "idle" });
  const [routing, setRouting] = useState<Routing>({ status: "idle" });
  const [promptOpen, setPromptOpen] = useState(false);
  const [followUpAt, setFollowUpAt] = useState(defaultFollowUp);
  const [pending, setPending] = useState<string | null>(null);

  /* A — THE SYNCHRONOUS GUARD.
     React state updates are asynchronous, so two dispatches inside one frame
     both read the pre-update status and both pass; `disabled` only applies on
     the next render. A human double-click at 100-300ms is caught by the state
     flag; a programmatic or trackpad double-fire inside a single frame is not.
     The ref is checked and set SYNCHRONOUSLY at handler entry, which closes it.
     ⚠ Not absolute in general — ApproveControl and AssignmentModeSelector share
     the state-only shape and are NOT changed here; that is recorded, not fixed. */
  const inFlight = useRef(false);

  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (promptTimer.current) clearTimeout(promptTimer.current); }, []);

  /* B — DISCLOSURE SOURCE. Newer-of the session override and what GHL returned.
     Without the override this is silent in exactly the case it exists for: the
     immediate correction, inside the ~11-105s listAll convergence window, where
     the fetch still carries no disposition. */
  const priorDisposition = effectiveDisposition(
    contact?.customFields?.find((f) => f.id === CALL_DISPOSITION_ID)?.value as string ?? "",
    (contact?.customFields?.find((f) => f.id === DISPOSITION_AT_ID)?.value as string) ?? null,
    readOverrides(storage(), Date.now())[contactId],
    Date.now(),
  );

  async function run(label: string) {
    if (inFlight.current) return;          // A — synchronous, before any await
    inFlight.current = true;
    setSubmit({ status: "in_flight", label });
    setRouting({ status: "idle" });
    setPromptOpen(false);

    const unanswered = UNANSWERED.has(label);
    const followUp = label === "Follow Up";

    try {
      // ── 1 · disposition ────────────────────────────────────────────────
      await ghl.contacts.setCallDisposition(contactId, label);

      // ── 2 · routing reset, unanswered paths only ──────────────────────
      if (unanswered) await ghl.contacts.setCallRouting(contactId, ROUTING_STAY);

      // ── 3 · read back every carrier THIS PATH requires ────────────────
      const required = [{ id: CALL_DISPOSITION_ID, value: label, key: "disposition" }];
      if (unanswered) required.push({ id: CALL_ROUTING_ID, value: ROUTING_STAY, key: "routing" });
      const confirmed = await confirmCarriers(contactId, required);
      if (!confirmed.ok) {
        setSubmit({
          status: "partial", label,
          message: `Did not land: ${confirmed.missing.join(", ")}. Nothing was signalled to GHL.`,
        });
        return;                            // BELL WITHHELD — required state is incomplete
      }

      // Follow Up's callback is part of its intended result, so it is required
      // too. setCallbackDatetime writes both the DATE and the TEXT companion in
      // one call (R6 — no new date carrier). NOT scheduleCallbackGated: that
      // wrapper owns its own note and attempt, which this sequence owns.
      let callbackIso: string | null = null;
      if (followUp) {
        callbackIso = new Date(followUpAt).toISOString();
        try {
          await ghl.contacts.setCallbackDatetime(contactId, callbackIso);
        } catch (e) {
          setSubmit({
            status: "partial", label,
            message: `Disposition saved, but the callback did not: ${(e as Error).message}. Nothing was signalled to GHL.`,
          });
          return;                          // BELL WITHHELD
        }
      }

      // ── 4 · human record, then the grey ───────────────────────────────
      // Note first so an attempt can never grey a row with no record behind it
      // — the ordering ghl-disposition.ts uses for the same reason.
      // THE NOTE ASSERTS THE CALLBACK, the property scheduleCallbackGated
      // encodes at callbackWrite.ts:50 and states in its header. This path owns
      // its own note rather than reusing that wrapper — the wrapper also owns an
      // attempt, which this sequence writes itself — so the assertion has to be
      // carried here or the human record silently stops naming the callback
      // time. Reuses the exported formatter; no second note, no second attempt.
      let noteError: string | null = null;
      const noteBody = callbackIso
        ? `Call: ${label} — callback scheduled for ${formatCallbackTime(callbackIso)}`
        : `Call: ${label}`;
      try { await ghl.notes.create(contactId, noteBody); }
      catch (e) { noteError = (e as Error).message; }

      let attemptError: string | null = null;
      const attemptIso = new Date().toISOString();
      try { await ghl.contacts.setLastCallAttempt(contactId, attemptIso); onAttempt(attemptIso); }
      catch (e) { attemptError = (e as Error).message; }

      // ── 5 · THE BELL, LAST ────────────────────────────────────────────
      // Not gated on the note or the attempt, deliberately (OQ-6(a)): the note
      // is human history and the attempt is IAOS queue state, and withholding
      // the bell for either turns one failure into two — a lost grey AND an
      // unhandled disposition. A failed attempt is caught durably by S4's flag.
      await ghl.contacts.setDispositionAt(contactId, new Date().toISOString());

      // O1 — record only a CONFIRMED write, so the queue never suppresses a row
      // on the strength of a write that did not land.
      recordOverride(storage(), contactId, label, new Date().toISOString(), Date.now());

      const trailing = [noteError && `note: ${noteError}`, attemptError && `attempt: ${attemptError}`]
        .filter(Boolean).join("; ");
      setSubmit(trailing
        ? { status: "partial", label, message: `Recorded and signalled to GHL, but ${trailing}` }
        : { status: "done", label });

      // ── 6 · the 60-second, non-blocking routing choice ────────────────
      if (unanswered) {
        setPromptOpen(true);
        if (promptTimer.current) clearTimeout(promptTimer.current);
        // 7 · nothing selected -> nothing further. Durable state already says
        // Stay, so a timeout, a navigation or a crash all land on the correct
        // default. There is no timer here that has to be reliable.
        promptTimer.current = setTimeout(() => setPromptOpen(false), ROUTING_WINDOW_MS);
      }
    } catch (e) {
      setSubmit({ status: "partial", label, message: `${(e as Error).message}. Nothing was signalled to GHL.` });
    } finally {
      inFlight.current = false;
    }
  }

  /** 8 · Move to Long-Term Nurture. A routing transition, not a call outcome —
   *  so it does NOT ring the bell. S7 fires on Stay -> LTN. */
  async function moveToLtn() {
    if (inFlight.current) return;          // A applies to Retry too
    inFlight.current = true;
    setRouting({ status: "in_flight" });
    try {
      await ghl.contacts.setCallRouting(contactId, ROUTING_LTN);
      const confirmed = await confirmCarriers(contactId, [
        { id: CALL_ROUTING_ID, value: ROUTING_LTN, key: "routing" },
      ]);
      if (!confirmed.ok) {
        setRouting({ status: "failed", stage: "readback", message: "GHL did not confirm the new routing." });
        return;
      }
      setRouting({ status: "done" });
      setPromptOpen(false);
    } catch (e) {
      setRouting({ status: "failed", stage: "write", message: (e as Error).message });
    } finally {
      inFlight.current = false;
    }
  }

  const busy = submit.status === "in_flight" || routing.status === "in_flight";
  const btn = (bg: string, border: string, color: string) => ({
    fontSize: "12px", fontWeight: 600, padding: "8px 14px", borderRadius: "8px",
    border: `1px solid ${border}`, background: bg, color,
    cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  });

  return (
    <div data-testid="disposition-control" style={{
      marginTop: "14px", padding: "16px 18px", background: "#0F172A",
      border: "1px solid #1E293B", borderRadius: "10px",
    }}>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#E2E8F0", marginBottom: "10px" }}>
        Record call outcome
      </div>

      {/* B — DISCLOSURE. Requested Appointment only: the single confirmed
          non-idempotent downstream effect. States the disposition's EFFECT, not
          a past occurrence — if the bell had failed, no enrolment happened, and
          a feature whose purpose is honesty must not assert what it cannot
          verify. Discloses; never blocks. */}
      {priorDisposition ? (
        <div data-testid="disposition-prior" style={{ fontSize: "12px", color: "#64748B", marginBottom: "10px" }}>
          Last recorded: <span style={{ color: "#94A3B8" }}>{priorDisposition}</span>
          {priorDisposition === DISCLOSES_ON ? (
            <div data-testid="disposition-disclosure" style={{ color: "#FBBF24", marginTop: "6px", lineHeight: 1.5 }}>
              This disposition starts an outbound sequence, and changing it here does not remove them from it.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {TRANCHE_A_DISPOSITIONS.map((label) => (
          <button
            key={label}
            data-testid={`disposition-option-${label.replace(/\s+/g, "-").toLowerCase()}`}
            onClick={() => void run(label)}
            disabled={busy}
            style={btn("rgba(30,200,255,0.08)", "rgba(30,200,255,0.35)", "#1EC8FF")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Follow Up's callback. R6 — reuses setCallbackDatetime, no new carrier.
          Default +3 days; an explicit date/time is allowed, same-day included. */}
      <div style={{ marginTop: "10px", fontSize: "12px", color: "#64748B" }}>
        Follow Up callback:{" "}
        <input
          data-testid="disposition-followup-at"
          type="datetime-local"
          value={followUpAt}
          onChange={(e) => setFollowUpAt(e.target.value)}
          disabled={busy}
          style={{ background: "#0B1220", color: "#E2E8F0", border: "1px solid #334155", borderRadius: "4px", padding: "3px 6px", fontSize: "12px", fontFamily: "inherit" }}
        />
      </div>

      <div style={{ marginTop: "10px", fontSize: "12px", minHeight: "18px" }}>
        {submit.status === "in_flight" ? <span style={{ color: "#94A3B8" }}>Recording {submit.label}…</span> : null}
        {submit.status === "done" ? (
          <span data-testid="disposition-saved" style={{ color: "#94A3B8" }}>Recorded — {submit.label}.</span>
        ) : null}
        {submit.status === "partial" ? (
          <span data-testid="disposition-partial" style={{ color: "#F87171" }}>{submit.label}: {submit.message}</span>
        ) : null}
      </div>

      {/* 6-7 · R5's non-blocking choice. Stay is ALREADY WRITTEN, so this offers
          one real action. Letting it lapse is a valid outcome and writes nothing
          further. */}
      {promptOpen ? (
        <div data-testid="routing-prompt" style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid #1E293B" }}>
          <div style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "8px" }}>
            Staying in Cold Outreach. Move to Long-Term Nurture instead?
          </div>
          <button
            data-testid="routing-move-ltn"
            onClick={() => void moveToLtn()}
            disabled={busy}
            style={btn("rgba(251,191,36,0.10)", "rgba(251,191,36,0.40)", "#FBBF24")}
          >
            Move to Long-Term Nurture
          </button>
        </div>
      ) : null}

      {routing.status === "done" ? (
        <div data-testid="routing-saved" style={{ marginTop: "8px", fontSize: "12px", color: "#94A3B8" }}>
          Routing set to Long-Term Nurture.
        </div>
      ) : null}

      {/* LIMIT 1 + LIMIT 2 — PERSISTENT, NOT A TOAST, AND IT CARRIES RECOURSE.
          A failed routing write leaves durable state byte-identical to a
          legitimate Stay, and S4's flag cannot see it because the attempt and
          the bell are aligned. Making it durable would need a carrier whose only
          reason to exist is recording an intent that FAILED, which fails R3
          outright — so this is structural, and the notice must survive until the
          operator acts. The perishability line is what makes the other two
          actionable. */}
      {routing.status === "failed" ? (
        <div data-testid="routing-failed" style={{ marginTop: "10px", fontSize: "12px", color: "#F87171", lineHeight: 1.5 }}>
          <div><strong>Routing didn’t save.</strong> This contact is still marked {ROUTING_STAY} and has <strong>not</strong> been moved to Long-Term Nurture. ({routing.stage}: {routing.message})</div>
          <div style={{ marginTop: "8px" }}>
            <button data-testid="routing-retry" onClick={() => void moveToLtn()} disabled={busy}
              style={btn("rgba(248,113,113,0.10)", "rgba(248,113,113,0.40)", "#F87171")}>
              Retry
            </button>
            <span style={{ marginLeft: "10px", color: "#94A3B8" }}>or move the stage by hand in GHL.</span>
          </div>
          <div style={{ marginTop: "6px", color: "#94A3B8" }}>
            If you leave this page this notice is gone, and the only record will be {ROUTING_STAY}.
          </div>
        </div>
      ) : null}
    </div>
  );
}
