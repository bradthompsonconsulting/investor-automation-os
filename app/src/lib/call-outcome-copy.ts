/**
 * B14-12 / INV-94 — what each call-outcome control records, and what it sets
 * off, in the words Brad sees BEFORE he commits it.
 *
 * Pure: no I/O, no React, no GHL identifiers. One home for the copy so the
 * contact-page dial-result control and Seller Call's conversation-outcome
 * panel can't drift, and so the offline suite can assert it directly.
 *
 * SOURCE OF THE CONSEQUENCES. Spock's read-only Production passes of
 * 2026-10-01 (recorded on Linear 14-12): the Board #4 cutover is live, the
 * seller workflows watch `iaos_disposition_at` / `iaos_call_routing`, and
 * nothing watches the callback, `last_call_attempt` or notes. An effect that
 * is observed is stated plainly; one that is not yet verified is stated as
 * "may", never as fact. Re-check this copy whenever that record changes.
 *
 * THE OPERATOR NOTE LABEL. IAOS-written dial-result notes say who reported
 * them, so they can't be mistaken for GHL's own call event. The label must
 * never begin `IAOS ` + a ledger word: `write-note-guard.ts` refuses an
 * unparseable note that does.
 */

export type DialResult =
  | "No Answer"
  | "Voicemail"
  | "Follow Up"
  | "Requested Appointment"
  | "Not Interested"
  | "Incorrect Number";

export const OPERATOR_CALL_NOTE_PREFIX = "Call (reported by Brad in IAOS):";

/** The dial-result note body. `callbackText` is the already-formatted callback time, Follow Up only. */
export function operatorCallNote(label: DialResult, callbackText: string | null): string {
  return callbackText
    ? `${OPERATOR_CALL_NOTE_PREFIX} ${label} — callback scheduled for ${callbackText}`
    : `${OPERATOR_CALL_NOTE_PREFIX} ${label}`;
}

export const GHL_CALL_LOGGING_LINE =
  "Calls placed with GHL Phone are logged by GHL. IAOS records only what you report here.";

export const DIAL_RESULT_HEADING = "Record dial result (cold outreach)";
export const DIAL_RESULT_SUBHEADING = "These can start or stop GHL seller workflows.";

/** `confirm: true` outcomes can lead to messages to the seller, so they take a second click. */
export const DIAL_RESULT_CONSEQUENCES: Readonly<Record<DialResult, { text: string; confirm: boolean }>> = {
  "No Answer": {
    text: "No seller messages. The lead returns to your call queue after 12 hours.",
    confirm: false,
  },
  "Voicemail": {
    text: "No seller messages. The lead returns to your call queue after 12 hours.",
    confirm: false,
  },
  "Follow Up": {
    text: "Sets your callback and moves the deal to Seller Follow-Up. If it is still there around day 37, GHL may move it to Long-Term Nurture, where the seller gets email and text messages.",
    confirm: true,
  },
  "Requested Appointment": {
    text: "GHL texts the seller a booking link about 15 minutes later (within its sending hours), even without a reply. Recording it again may text the seller again.",
    confirm: true,
  },
  "Not Interested": {
    text: "Stops the Seller 6 follow-up path for this deal. Messages already scheduled by another workflow, such as Seller 2's booking-link text, may still send.",
    confirm: false,
  },
  "Incorrect Number": {
    text: "Takes the lead out of your call queue until its phone number changes. No seller messages.",
    confirm: false,
  },
};

export const MOVE_TO_LTN_CONSEQUENCE =
  "Moves the deal to Long-Term Nurture. GHL may start email and text messages to the seller from there (not yet verified).";

export const CONVERSATION_OUTCOME_HEADING = "Record conversation outcome";
export const CONVERSATION_OUTCOME_SUBHEADING = "These do not start cold-outreach workflows.";
export const DIAL_RESULT_POINTER = "No conversation? Record the dial result on the contact page.";
export const SELLER_CALL_FOLLOW_UP_CONSEQUENCE =
  "Schedules your callback only. No stage change and no seller messages, unlike Follow Up on the contact page.";
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
