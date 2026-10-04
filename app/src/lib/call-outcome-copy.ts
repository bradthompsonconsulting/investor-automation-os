/**
 * B14-12 / INV-94 — call-outcome copy. One home for the contact-page call log
 * and Seller Call's conversation-outcome panel, so they can't drift and the
 * offline suite can assert it directly.
 *
 * Pure: no I/O, no React, no GHL identifiers.
 *
 * RECORDING-ONLY (Brad's design, ruled by Jess 2026-10-02). A call result is
 * a record, not an automation command: it writes the result, a call-log note
 * and the last-touch time, and nothing a GHL workflow watches
 * (`iaos_disposition_at`, `iaos_call_routing`). Callbacks are a separate,
 * explicit action. Do Not Call is a separate action (its own PR and gate).
 *
 * THE NOTE LABEL. Call-log notes say who reported them, so they can't be
 * mistaken for GHL's own call event (`ghl-disposition` writes "Call: X — Ns").
 * The label must never begin `IAOS ` + a ledger word: `write-note-guard.ts`
 * refuses an unparseable note that does.
 */

/** The six results the contact-page call log records, in display order. */
export const CALL_LOG_RESULTS = ["No Answer", "Voicemail", "Spoke with Seller", "Follow Up", "Not Interested", "Incorrect Number"] as const;
export type CallLogResult = typeof CALL_LOG_RESULTS[number];

export const OPERATOR_CALL_NOTE_PREFIX = "Call (reported by Brad in IAOS):";
export const CALL_NOTES_MAX = 4000;

/** The call-log note: the result on the first line, then Brad's notes, if any. */
export function callLogNote(result: CallLogResult, notes: string): string {
  const text = notes.trim();
  return text ? `${OPERATOR_CALL_NOTE_PREFIX} ${result}\n${text}` : `${OPERATOR_CALL_NOTE_PREFIX} ${result}`;
}

/**
 * Reads a call-log note back: the result label from the first line (anything
 * after " — ", e.g. an older "— callback scheduled for …", is dropped) and the
 * notes below it. Also reads notes written before the call log. `null` for any
 * other note.
 */
export function parseCallLogNote(body: string): { result: string; notes: string } | null {
  if (typeof body !== "string" || !body.startsWith(OPERATOR_CALL_NOTE_PREFIX + " ")) return null;
  const nl = body.indexOf("\n");
  const first = (nl === -1 ? body : body.slice(0, nl)).slice(OPERATOR_CALL_NOTE_PREFIX.length + 1).trim();
  const result = first.split(" — ")[0].trim();
  if (!result) return null;
  return { result, notes: nl === -1 ? "" : body.slice(nl + 1).trim() };
}

export const GHL_CALL_LOGGING_LINE =
  "Calls placed with GHL Phone are logged by GHL. IAOS records only what you report here.";

export const CALL_LOG_HEADING = "Log this call";
export const CALL_LOG_EFFECT =
  "Records this call: who, when, the result and your notes. It doesn't move the deal, start or stop workflows, or send messages.";
export const CALL_NOTES_PLACEHOLDER = "What did the seller say? What did you learn? What to cover next time?";
export const FOLLOW_UP_CALLBACK_HINT = "Follow Up doesn't set a callback. Use Set Callback to choose a date and time.";

export const CONVERSATION_OUTCOME_HEADING = "Record conversation outcome";
export const CONVERSATION_OUTCOME_SUBHEADING = "These do not start cold-outreach workflows.";
export const DIAL_RESULT_POINTER = "No conversation? Log the call on the contact page.";
// Pass 1 F30: the old trailing clause ("unlike Follow Up on the contact page")
// went stale when PR #117 made the contact-page call log recording-only.
export const SELLER_CALL_FOLLOW_UP_CONSEQUENCE =
  "Schedules your callback only. No stage change and no seller messages.";
export const SELLER_CALL_PASS_CONSEQUENCE = "Records the pass. No seller messages.";

/**
 * B14-12 / INV-94 (Jess ruling, 2026-10-02, option B). Pass does not clear a
 * scheduled callback: PB-D54 keeps clearing a manual act ("Clearing is Brad
 * deciding the promise no longer stands"). So before Brad confirms a Pass, he
 * is told that a callback on this contact stays scheduled, and where to clear
 * it. `null` = no callback; `{ text: null }` = a callback whose time could not
 * be read, still warned about rather than silently dropped; `"unknown"` = this
 * contact's record has not loaded yet, so no other contact's callback is shown.
 */
export type ScheduledCallback = { text: string | null } | null | "unknown";

export function sellerCallPassConsequence(callback: ScheduledCallback): string {
  if (callback === "unknown") return `${SELLER_CALL_PASS_CONSEQUENCE} Checking this contact for a scheduled callback…`;
  if (!callback) return SELLER_CALL_PASS_CONSEQUENCE;
  const which = callback.text ? `Your callback for ${callback.text}` : "Your scheduled callback";
  return `${SELLER_CALL_PASS_CONSEQUENCE} ${which} stays scheduled: Pass does not clear it. If you won't call back, clear it separately on the contact page.`;
}

/**
 * The callback a Pass would leave in place. A callback this page itself just
 * scheduled (`sessionIso`) wins over the contact detail loaded with the page.
 * Otherwise the precise TEXT companion, then the DATE field, the same
 * precedence the Contact page and Dashboard display. Returns the ISO instant,
 * or `{ iso: null }` for a value that is present but unreadable.
 *
 * CONTACT ISOLATION (Bones, PR #115). The caller passes `sessionIso` only when
 * it was scheduled for the contact now shown, and `fields` only when the
 * loaded record IS that contact (`null` otherwise, e.g. mid-navigation). A
 * `null` record with no session callback is `"unknown"`, never another
 * contact's answer.
 */
export function resolveScheduledCallback(
  sessionIso: string | null,
  fields: ReadonlyArray<{ id: string; value: unknown }> | null,
  ids: { precise: string; date: string },
): { iso: string | null } | null | "unknown" {
  if (sessionIso) return { iso: sessionIso };
  if (fields === null) return "unknown";
  const raw = (id: string) => fields.find((f) => f.id === id)?.value;
  for (const value of [raw(ids.precise), raw(ids.date)]) {
    if (value === undefined || value === null || value === "") continue;
    const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    const ms = Number.isFinite(n) ? n : typeof value === "string" ? Date.parse(value) : NaN;
    return { iso: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
  }
  return null;
}
