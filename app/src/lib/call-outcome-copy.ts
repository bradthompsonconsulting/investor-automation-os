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
    text: "Stops GHL follow-up for this deal. No seller messages.",
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
