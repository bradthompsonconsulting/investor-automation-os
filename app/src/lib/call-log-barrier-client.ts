/**
 * Board 15 / PR #131 -- the browser side of durable call-log OPERATIONS
 * (approved lifecycle v3, #issuecomment-6023481488; server:
 * netlify/functions/call-log-barrier.ts; map: docs/CALL_LOG_SAVE_LIFECYCLE.md).
 *
 *   status        the contact's open operation (on load / contact change)
 *   operation     ONE operation by its ORIGINAL id -- how a delayed response
 *                 learns that operation's outcome (never contact-level guessing)
 *   begin         a NEW call (new operation id)
 *   resume        "Check again" for an existing operation (creates nothing)
 *   retry         Retry notes / Retry last-touch time, naming the attempt retried
 *   sendStep      one bound attempt: confirmed / not_sent / uncertain
 *
 * Nothing here retries, and nothing here infers: a refusal is reported with what
 * the server says it proves; the page then reads the operation.
 */
import { appWriteFetch, AppWriteSignInRequired } from "./app-write-session";
import { readFetch } from "./read-session";
import { writeCommand } from "./write-command";
import { pausedMessage } from "./v2-ids";

const ENDPOINT = "/.netlify/functions/call-log-barrier";

export type Slot = "result" | "note" | "touch";
export type Evidence = "pending" | "in_flight" | "confirmed" | "withdrawn" | "not_dispatched" | "uncertain";
export type SlotView = { slot: Slot; attempt: number; requestId: string; evidence: Evidence };
export type Outcome = { kind: "complete" | "not_saved"; result: string; slots: SlotView[] };
export type Next =
  | { action: "withdraw_result" }
  | { action: "send"; slot: Slot; requestId: string }
  | { action: "retry"; slot: Slot; after: number }
  | { action: "blocked"; slot: Slot; reason: "in_flight" | "uncertain" }
  | { action: "unpublished"; slot: Slot; attempt: number }
  | { action: "finishing"; kind: "complete" | "not_saved" };
export type CallLogView =
  | { state: "clear" }
  | { state: "legacy"; message: string }
  | { state: "finished"; op: string; outcome: Outcome }
  | { state: "unrecorded"; op: string; result: string; slots: SlotView[] }
  | { state: "open"; op: string; result: string; slots: SlotView[]; next: Next; body?: string }
  | { state: "in_progress"; message: string }
  | { state: "paused"; message: string }
  | { state: "unreadable"; message: string };
/** Storage correction: status reads carry the durable lock state (plan v6 §4.3). */
export type LockState = { lock?: "free" | "held_in_progress" | "held_release_unverified" | "held_legacy" | "unknown"; lockMessage?: string };

export const STATUS_UNREADABLE_MESSAGE =
  "IAOS could not check whether an earlier call save for this contact is unfinished. Nothing will be saved until it is checked — use Check again.";
export const RESERVATION_FAILED_MESSAGE =
  "The call could not be reserved, so nothing was sent. The reservation may still be held — use Check again before saving.";
export const CHECK_FAILED_MESSAGE = "The check could not be completed; nothing was changed. Use Check again.";

const OPERATION: Record<Slot, string> = { result: "contact.callLogResult", note: "note.create", touch: "contact.lastCallAttempt" };
export const requestIdFor = (op: string, slot: Slot, n: number) => `${op}-${slot}-${n}`;

async function readView(url: string): Promise<CallLogView> {
  try {
    const res = await readFetch(url);
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body && typeof body.state === "string") return body as CallLogView;
  } catch { /* fall through */ }
  return { state: "unreadable", message: STATUS_UNREADABLE_MESSAGE };
}
/** The contact's open operation, for any session. A failed read is "unreadable" (blocked). */
export const readCallLogStatus = (contactId: string) => readView(`${ENDPOINT}?contactId=${encodeURIComponent(contactId)}`);
/** One operation by its ORIGINAL id. */
export const readOperation = (contactId: string, op: string) => readView(`${ENDPOINT}?contactId=${encodeURIComponent(contactId)}&operationId=${encodeURIComponent(op)}`);

async function postAction(payload: Record<string, unknown>): Promise<CallLogView> {
  const res = await appWriteFetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => null);
  if (res.status === 200 && body && typeof body.state === "string") return body as CallLogView;
  if (res.status === 409 && body?.state === "in_progress") return { state: "in_progress", message: String(body.message) };
  const paused = pausedMessage(body);
  if (paused) return { state: "paused", message: paused };
  throw new Error(CHECK_FAILED_MESSAGE);
}

/** A NEW call. "reserved", "held" (another operation is open: its view), or a finished view; throws when unknown. */
export async function beginOperation(contactId: string, op: string, result: string, body: string): Promise<{ state: "reserved" } | { state: "held"; current: CallLogView } | CallLogView> {
  const res = await appWriteFetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "begin", contactId, operationId: op, result, body }) });
  const out = await res.json().catch(() => null);
  if (res.status === 200 && out?.state === "reserved") return { state: "reserved" };
  if (res.status === 200 && out?.state === "finished") return out as CallLogView;
  if (res.status === 409 && out?.state === "held") return { state: "held", current: out.current as CallLogView };
  if (res.status === 409 && out?.state === "in_progress") return { state: "in_progress", message: String(out.message) };
  const paused = pausedMessage(out);
  if (paused) return { state: "paused", message: paused };
  throw new Error(RESERVATION_FAILED_MESSAGE);
}
/** "Check again" for THIS operation. Never creates an attempt. */
export const resumeOperation = (contactId: string, op: string) => postAction({ action: "resume", contactId, operationId: op });
/** Retry notes / Retry last-touch time: names the attempt it retries. */
export const retryAttempt = (contactId: string, op: string, slot: "note" | "touch", after: number) => postAction({ action: "retry", contactId, operationId: op, slot, after });
/** Check again for an unfinished save from a previous IAOS version. */
export const settleLegacy = (contactId: string) => postAction({ action: "resume", contactId, legacy: true });

export type StepOutcome =
  | { kind: "confirmed" }
  | { kind: "not_sent"; message: string; proves: "this_request" | "nothing" }
  | { kind: "uncertain"; message: string };

/**
 * Sends ONE bound attempt with its derived request id. "not_sent" carries what
 * the server says it proves; anything that is neither a confirmation nor a
 * refusal before sending -- a network failure, an indeterminate answer, an
 * unreadable response -- is uncertain.
 */
export async function sendCallLogStep(contactId: string, slot: Slot, requestId: string, args: Record<string, unknown>): Promise<StepOutcome> {
  let res: Response;
  try { res = await writeCommand(OPERATION[slot], contactId, args, requestId); }
  catch (e) {
    if (e instanceof AppWriteSignInRequired) return { kind: "not_sent", message: e.message, proves: "nothing" };
    return { kind: "uncertain", message: (e as Error)?.message ?? "No response" };
  }
  const out = await res.json().catch(() => null);
  if (res.status === 200 && out && out.confirmed !== false) return { kind: "confirmed" };
  if (out?.outcome === "not_sent") return { kind: "not_sent", message: String(out.error ?? "Nothing was sent"), proves: out.proves === "this_request" ? "this_request" : "nothing" };
  // Saving paused or held by the write gate: refused before any GHL call.
  const paused = pausedMessage(out);
  if (paused) return { kind: "not_sent", message: paused, proves: "nothing" };
  // ghl-write refuses these before any store, lock or GHL call: request shape, write sign-in, origin, Production scope.
  if (res.status === 400 || res.status === 401 || res.status === 403) return { kind: "not_sent", message: String(out?.error ?? `HTTP ${res.status}`), proves: "nothing" };
  return { kind: "uncertain", message: String(out?.error ?? `HTTP ${res.status}`) };
}

const LABEL: Record<Slot, string> = { result: "call result", note: "call note", touch: "last-touch time" };
/**
 * What the page says about an operation. Only a recorded `complete` is "Saved";
 * a refused or uncertain operation stays visibly incomplete. Never recommends a reload.
 */
export function describe(view: CallLogView & LockState): { tone: "done" | "not_saved" | "partial" | "blocked" | "clear"; message: string; retry?: { slot: "note" | "touch"; after: number } } {
  // A lock that could not be confirmed released is shown, durably, from the server's status (never from memory).
  const lockNote = view.lock && view.lock !== "free" ? (view.lockMessage ?? null) : null;
  switch (view.state) {
    case "clear": return lockNote ? { tone: "blocked", message: lockNote } : { tone: "clear", message: "" };
    case "finished": return view.outcome.kind === "complete"
      ? { tone: "done", message: `Saved: ${view.outcome.result}.${lockNote ? " " + lockNote : ""}` }
      : { tone: "not_saved", message: `"${view.outcome.result}" was not saved — nothing was sent to GHL.` };
    // Not the current operation and no final record: its outcome is NOT recorded -- never claimed either way.
    case "unrecorded": return { tone: "blocked", message: `The outcome of the call "${view.result}" is not recorded yet; IAOS will not guess it. Nothing more will be sent for it. Use Check again.` };
    case "legacy": case "in_progress": case "paused": case "unreadable": return { tone: "blocked", message: view.message };
    case "open": {
      const n = view.next;
      const r = view.result;
      switch (n.action) {
        case "retry": return n.slot === "note"
          ? { tone: "partial", message: "Result saved; notes not saved. No other call can be saved for this contact until they are.", retry: { slot: "note", after: n.after } }
          : { tone: "partial", message: "Saved; last-touch time not updated. No other call can be saved for this contact until it is.", retry: { slot: "touch", after: n.after } };
        case "send": return { tone: "blocked", message: `The call "${r}" is partly saved: its ${LABEL[n.slot]} has not been sent yet. Use Check again to finish it. No other call can be saved for this contact until then.` };
        case "blocked": return n.reason === "uncertain"
          ? { tone: "blocked", message: `Unresolved — the ${LABEL[n.slot]} for "${r}" was sent and may still reach GHL. Nothing more will be saved in this contact's call log until it is resolved. Use Check again; if it stays unresolved, it needs the call-log recovery procedure.` }
          : { tone: "blocked", message: `The ${LABEL[n.slot]} for "${r}" was sent and is not confirmed yet — it may still reach GHL. Use Check again in a moment.` };
        case "withdraw_result": return { tone: "blocked", message: `A call save ("${r}") for this contact was started and is not confirmed — it may still be on its way to GHL. Nothing more will be saved until it is checked. Use Check again.` };
        // Prepared but not published: NOTHING was sent -- never shown as dispatched.
        case "unpublished": return { tone: "blocked", message: `The ${LABEL[n.slot]} for "${r}" is not ready to send yet — nothing has been sent. Use Check again to finish preparing it.` };
        // The intended outcome is kept: a pending not_saved is never worded as reaching GHL, and neither is shown as Saved.
        case "finishing": return n.kind === "complete"
          ? { tone: "blocked", message: `The call "${r}" reached GHL; IAOS is still recording that it finished. Use Check again.` }
          : { tone: "blocked", message: `"${r}" was not saved — nothing was sent to GHL. IAOS is still recording that. Use Check again.` };
      }
    }
  }
  return { tone: "blocked", message: STATUS_UNREADABLE_MESSAGE };
}
