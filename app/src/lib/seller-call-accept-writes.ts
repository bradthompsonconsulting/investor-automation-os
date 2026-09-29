/**
 * INV-98 Board #9 (Bones REVISE item 2) -- Seller Call's Confirm Accept
 * write sequence and its recovery, as one pure, directly testable module.
 * `SellerCallWorkspace.tsx` calls these functions; it holds no copy of the
 * sequence itself.
 *
 * Confirm Accept is three writes, in order, with no rollback:
 *   1. the accepted Current Offer (`opportunity.currentOffer`);
 *   2. the accept outcome note -- the durable Agreement Reached record;
 *   3. the call timestamp (`contact.lastCallAttempt`).
 *
 * Every failure is reported exactly as what it is. In particular, a failure
 * at step 3 happens AFTER the acceptance is recorded: the result says so,
 * carries the note so the page can show Agreement Reached immediately, and
 * never asks the operator to Confirm Accept again (the server refuses a
 * second accept regardless -- "Agreement is already recorded").
 *
 * Recovery of step 3 reads BOTH saved last-call fields back first and
 * validates them against the server's serialization rules. It clears only
 * when both confirm completion (of the pending write, or of later
 * activity). It writes only when neither holds anything newer, and then
 * with a fresh timestamp (not a replay of the indeterminate one, whose
 * request id the write client keeps pending). That fresh timestamp becomes
 * the pending one if its own write is unconfirmed. A failed, malformed,
 * duplicate or newer-but-incomplete readback writes nothing.
 */

export interface AcceptWritesClient {
  setCurrentOffer(opportunityId: string, value: number): Promise<{ ok: boolean }>;
  createNote(contactId: string, body: string): Promise<unknown>;
  setLastCallAttempt(contactId: string, iso: string): Promise<unknown>;
}

export type AcceptWritesResult =
  | { stage: "offer_failed"; acceptanceRecorded: false; message: string }
  | { stage: "offer_unconfirmed"; acceptanceRecorded: false; message: string }
  | { stage: "note_failed"; acceptanceRecorded: "unknown"; message: string }
  | { stage: "timestamp_failed"; acceptanceRecorded: true; note: string; pendingTimestamp: string; message: string }
  | { stage: "complete"; acceptanceRecorded: true; note: string };

const errorText = (e: unknown) => ((e as Error)?.message ?? "unknown error");

export async function runConfirmAcceptWrites(
  client: AcceptWritesClient,
  args: { contactId: string; opportunityId: string; offerValue: number; note: string; at: string },
): Promise<AcceptWritesResult> {
  let offer: { ok: boolean };
  try {
    offer = await client.setCurrentOffer(args.opportunityId, args.offerValue);
  } catch (e) {
    return { stage: "offer_failed", acceptanceRecorded: false, message: `Cannot record acceptance -- the accepted price could not be saved to the opportunity (${errorText(e)}). Nothing was recorded; you may retry.` };
  }
  if (!offer.ok) {
    return { stage: "offer_unconfirmed", acceptanceRecorded: false, message: "Cannot record acceptance -- the accepted price was sent but could not be confirmed on the opportunity. Nothing was recorded; you may retry." };
  }
  try {
    await client.createNote(args.contactId, args.note);
  } catch (e) {
    return { stage: "note_failed", acceptanceRecorded: "unknown", message: `The acceptance may or may not have been recorded (${errorText(e)}). Reload this page to check before recording it again.` };
  }
  try {
    await client.setLastCallAttempt(args.contactId, args.at);
  } catch (e) {
    return {
      stage: "timestamp_failed", acceptanceRecorded: true, note: args.note, pendingTimestamp: args.at,
      message: `Acceptance recorded. Only the call timestamp could not be confirmed (${errorText(e)}). Use "Check & retry call timestamp" -- it reads the saved value first and never records the acceptance again.`,
    };
  }
  return { stage: "complete", acceptanceRecorded: true, note: args.note };
}

/** Confirm Accept is offered only while no acceptance is recorded for this opportunity. */
export function confirmAcceptOffered(latestOutcomeKind: string | null | undefined): boolean {
  return latestOutcomeKind !== "accept";
}

/**
 * The saved state of the two fields one `contact.lastCallAttempt` write
 * sets, read against the server's OWN serialization rules
 * (`write-contracts.ts` + `ghl-write-boundary.ts` matchesField):
 *   - `last_call_attempt` is a DATE field: confirmed by the readback
 *     string's first 10 characters (YYYY-MM-DD) -- no time of day;
 *   - `last_call_attempt_precise` is TEXT: the exact ISO string written.
 */
export type LastCallFieldsEvidence =
  | { kind: "absent" }                                  // neither field present
  | { kind: "complete"; precise: string; date: string } // both present, valid, and consistent with each other
  | { kind: "partial"; detail: string }                 // one field present without the other, or the date disagrees with the precise time
  | { kind: "malformed"; detail: string };              // a duplicate entry, a non-string value, or an unparseable value

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}/;

export function readLastCallFields(
  customFields: ReadonlyArray<{ id: string; value?: unknown }>,
  fieldIds: { date: string; precise: string },
): LastCallFieldsEvidence {
  const dateEntries = customFields.filter((f) => f.id === fieldIds.date);
  const preciseEntries = customFields.filter((f) => f.id === fieldIds.precise);
  if (dateEntries.length > 1 || preciseEntries.length > 1) return { kind: "malformed", detail: "a last-call field appears more than once" };
  // Presence is the ENTRY, never its value: an entry whose value is missing,
  // null or empty is malformed evidence (the server's own fieldValue refuses
  // it), not an absent field that recovery may write over.
  const dateEntry = dateEntries[0];
  const preciseEntry = preciseEntries[0];
  if (!dateEntry && !preciseEntry) return { kind: "absent" };
  const date = dateEntry?.value;
  const precise = preciseEntry?.value;
  if (dateEntry && (typeof date !== "string" || !DAY.test(date) || !Number.isFinite(Date.parse(date.slice(0, 10))))) return { kind: "malformed", detail: "the last-call date entry has no valid YYYY-MM-DD value" };
  if (preciseEntry && (typeof precise !== "string" || !ISO_INSTANT.test(precise) || !Number.isFinite(Date.parse(precise)))) return { kind: "malformed", detail: "the precise last-call entry has no valid ISO instant value" };
  if (!dateEntry || !preciseEntry) return { kind: "partial", detail: !dateEntry ? "the precise time is saved but the date is not" : "the date is saved but the precise time is not" };
  if ((date as string).slice(0, 10) !== (precise as string).slice(0, 10)) return { kind: "partial", detail: "the saved date and precise time disagree" };
  return { kind: "complete", precise: precise as string, date: (date as string).slice(0, 10) };
}

/**
 * `pendingTimestamp` is ALWAYS the timestamp whose landing is still
 * unconfirmed: the caller keeps it as the recovery's pending value, so a
 * recovery write that fails or loses its response is itself recognised by
 * the next recovery's readback.
 */
export type TimestampRecoveryResult =
  | { kind: "confirmed"; at: string; reason: "pending_landed" | "later_activity" }
  | { kind: "written"; at: string }
  | { kind: "write_unconfirmed"; pendingTimestamp: string; message: string }
  | { kind: "blocked"; pendingTimestamp: string; message: string };

export async function recoverLastCallAttempt(
  client: {
    readLastCallFields(contactId: string): Promise<ReadonlyArray<{ id: string; value?: unknown }>>;
    setLastCallAttempt(contactId: string, iso: string): Promise<unknown>;
  },
  args: { contactId: string; pendingTimestamp: string; now: string; fieldIds: { date: string; precise: string } },
): Promise<TimestampRecoveryResult> {
  let fields: ReadonlyArray<{ id: string; value?: unknown }>;
  try {
    fields = await client.readLastCallFields(args.contactId);
  } catch (e) {
    return { kind: "blocked", pendingTimestamp: args.pendingTimestamp, message: `Could not read the saved call timestamp (${errorText(e)}). Nothing was written; try again.` };
  }
  const evidence = readLastCallFields(fields, args.fieldIds);
  if (evidence.kind === "malformed") {
    return { kind: "blocked", pendingTimestamp: args.pendingTimestamp, message: `The saved call timestamp is unreadable (${evidence.detail}). Nothing was written; inspect the contact in GHL.` };
  }
  if (evidence.kind === "complete") {
    // The pending write landed in full.
    if (evidence.precise === args.pendingTimestamp) return { kind: "confirmed", at: evidence.precise, reason: "pending_landed" };
    // A LATER call timestamp is already saved in full: never overwrite later activity.
    if (Date.parse(evidence.precise) > Date.parse(args.pendingTimestamp)) return { kind: "confirmed", at: evidence.precise, reason: "later_activity" };
    if (Date.parse(evidence.precise) === Date.parse(args.pendingTimestamp)) {
      return { kind: "blocked", pendingTimestamp: args.pendingTimestamp, message: "The saved call timestamp names the same moment in a different form. Nothing was written; inspect the contact in GHL." };
    }
    // An older, complete timestamp: the pending write did not land -- fall through to write.
  }
  if (evidence.kind === "partial") {
    // One field is missing, or both exist but disagree. Compare EACH saved
    // field against the pending timestamp: if either shows later activity,
    // never overwrite it. (Both values are already validated as well-formed.)
    const savedPrecise = fields.find((f) => f.id === args.fieldIds.precise)?.value;
    const savedDate = fields.find((f) => f.id === args.fieldIds.date)?.value;
    const preciseIsLater = typeof savedPrecise === "string" && Date.parse(savedPrecise) > Date.parse(args.pendingTimestamp);
    const dateIsLater = typeof savedDate === "string" && savedDate.slice(0, 10) > args.pendingTimestamp.slice(0, 10);
    if (preciseIsLater || dateIsLater) {
      return { kind: "blocked", pendingTimestamp: args.pendingTimestamp, message: `The saved call timestamp is incomplete and shows later activity (${evidence.detail}). Nothing was written; inspect the contact in GHL.` };
    }
  }
  try {
    await client.setLastCallAttempt(args.contactId, args.now);
  } catch (e) {
    // The attempted timestamp becomes the pending one: it may have landed.
    return { kind: "write_unconfirmed", pendingTimestamp: args.now, message: `The call timestamp could not be confirmed (${errorText(e)}). Use "Check & retry call timestamp" again; it reads first.` };
  }
  return { kind: "written", at: args.now };
}
