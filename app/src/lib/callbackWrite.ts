/**
 * Shared callback-schedule write logic — ONE gated sequence for both the
 * Dashboard and the Contact Workspace, so the write-ordering can't rot in two
 * copies (CONTACT_WORKSPACE_SPEC_v2.md §6 CONVENTION + §10 decided fix).
 *
 * Scheduling a callback pairs three writes, each GATING the next:
 *   setCallbackDatetime -> notes.create -> setLastCallAttempt
 * The callback must persist before the note asserts it; the note must persist
 * before the attempt is marked (a fresh last_call_attempt is what greys, §6
 * MECHANISM). Returns which stage failed, if any — the caller maps that to its
 * own UI state (error text, overrides). No new write action; still exactly the
 * three sanctioned writes.
 *
 * `ghl` is injected (not imported) so this stays trivially testable with a mock.
 */

export function formatCallbackTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Structural subset of the ghl client this helper needs — the real `ghl`
// satisfies it, and a mock can too.
export interface CallbackGhl {
  contacts: {
    setCallbackDatetime: (id: string, iso: string | null) => Promise<unknown>;
    setLastCallAttempt: (id: string, iso: string) => Promise<unknown>;
  };
  notes: {
    create: (id: string, body: string) => Promise<unknown>;
  };
}

export type ScheduleResult =
  | { ok: true;  attemptIso: string }
  | { ok: false; stage: "callback"; error: string; callbackPersisted: false }
  | { ok: false; stage: "note";     error: string; callbackPersisted: true }
  | { ok: false; stage: "attempt";  error: string; callbackPersisted: true };

export async function scheduleCallbackGated(
  ghl: CallbackGhl, id: string, iso: string,
): Promise<ScheduleResult> {
  try {
    await ghl.contacts.setCallbackDatetime(id, iso); // callback (both fields, one call)
  } catch (e) {
    return { ok: false, stage: "callback", error: `Couldn't schedule callback: ${(e as Error).message}`, callbackPersisted: false };
  }
  try {
    await ghl.notes.create(id, `Callback scheduled for ${formatCallbackTime(iso)}`); // the note asserts the callback
  } catch (e) {
    return { ok: false, stage: "note", error: `Callback scheduled, but couldn't write the note: ${(e as Error).message}`, callbackPersisted: true };
  }
  const attemptIso = new Date().toISOString();
  try {
    await ghl.contacts.setLastCallAttempt(id, attemptIso); // the fresh last_call_attempt greys
  } catch (e) {
    return { ok: false, stage: "attempt", error: `Callback + note saved, but couldn't mark attempted: ${(e as Error).message}`, callbackPersisted: true };
  }
  return { ok: true, attemptIso };
}
