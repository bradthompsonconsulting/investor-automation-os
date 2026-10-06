/**
 * Board 15 / PR #131 -- the browser side of durable call-log ownership
 * (server: netlify/functions/call-log-barrier.ts; lifecycle:
 * docs/CALL_LOG_SAVE_LIFECYCLE.md).
 *
 *   begin      reserve the contact before the FIRST call-log write; the
 *              request ids sent with each step are the ones reserved here.
 *   status     read on load and contact change: is a call save for this
 *              contact unfinished, in any session? A failed read is blocked.
 *   reconcile  "Check again": the server evaluates its own records. A
 *              resumable attempt comes back with its ORIGINAL request ids.
 *   sendStep   one reserved write, classified as confirmed / not_sent /
 *              uncertain -- never retried here.
 */
import { appWriteFetch, AppWriteSignInRequired } from "./app-write-session";
import { readFetch } from "./read-session";
import { writeCommand } from "./write-command";

const ENDPOINT = "/.netlify/functions/call-log-barrier";

export type CallLogStep = "result" | "note" | "touch";
export type CallLogPurpose = "call_log" | "call_log_note";
export type StepEvidence = "withdrawn" | "confirmed" | "not_dispatched" | "unresolved" | "pending";
export type CallLogView =
  | { state: "clear" }
  | { state: "blocked"; kind: "uncertain" | "pending" | "resumable" | "in_progress" | "unreadable"; message: string };
export type ReconcileView =
  | { state: "clear"; summary: null | { purpose: CallLogPurpose; result: string; body: string; steps: { step: CallLogStep; evidence: StepEvidence }[] } }
  | { state: "blocked"; kind: "uncertain" | "pending" | "in_progress"; message: string }
  | { state: "resumable"; message: string; result: string; body: string; attempt: string; remaining: { step: CallLogStep; requestId: string }[] };

export const STATUS_UNREADABLE_MESSAGE =
  "IAOS could not check whether an earlier call save for this contact is unfinished. Nothing will be saved until it is checked — use Check again.";
export const RESERVATION_FAILED_MESSAGE =
  "The call could not be reserved, so nothing was sent. The reservation may still be held — use Check again before saving.";
export const CHECK_FAILED_MESSAGE = "The check could not be completed; nothing was changed. Use Check again.";

const OPERATION: Record<CallLogStep, string> = { result: "contact.callLogResult", note: "note.create", touch: "contact.lastCallAttempt" };

export function newCallLogRequestIds<S extends CallLogStep>(steps: readonly S[]): Record<S, string> {
  const out = {} as Record<S, string>;
  for (const s of steps) out[s] = crypto.randomUUID();
  return out;
}

/** Status for any session. A failed read is reported as blocked. */
export async function readCallLogStatus(contactId: string): Promise<CallLogView> {
  try {
    const res = await readFetch(`${ENDPOINT}?contactId=${encodeURIComponent(contactId)}`);
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body?.state === "clear") return { state: "clear" };
    if (res.status === 200 && body?.state === "blocked") return { state: "blocked", kind: body.kind, message: String(body.message) };
  } catch { /* fall through */ }
  return { state: "blocked", kind: "unreadable", message: STATUS_UNREADABLE_MESSAGE };
}

/** Reserves the contact. Resolves "reserved" or a blocked view; throws when the outcome is unknown. */
export async function beginCallLog(contactId: string, purpose: CallLogPurpose, result: string, body: string, steps: { step: CallLogStep; requestId: string }[]): Promise<{ state: "reserved" } | { state: "blocked"; message: string }> {
  const res = await appWriteFetch(ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "begin", contactId, purpose, result, body, steps }),
  });
  const out = await res.json().catch(() => null);
  if (res.status === 200 && out?.state === "reserved") return { state: "reserved" };
  if (res.status === 409 && (out?.state === "blocked" || out?.state === "in_progress")) return { state: "blocked", message: String(out.message ?? RESERVATION_FAILED_MESSAGE) };
  throw new Error(RESERVATION_FAILED_MESSAGE);
}

/**
 * "Check again" (no `attempt`): evaluates whatever attempt is current. With
 * `attempt` (its first request id): settles only THAT attempt -- if it is no
 * longer current, nothing changes and its own evidence is reported. Throws when
 * the server could not evaluate (the contact stays blocked).
 */
export async function reconcileCallLog(contactId: string, attempt?: string): Promise<ReconcileView> {
  const res = await appWriteFetch(ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attempt === undefined ? { action: "reconcile", contactId } : { action: "reconcile", contactId, attempt }),
  });
  const out = await res.json().catch(() => null);
  if (res.status === 200 && out?.state === "clear") return { state: "clear", summary: out.summary ?? null };
  if (res.status === 200 && out?.state === "blocked" && out.kind === "resumable" && Array.isArray(out.remaining) && typeof out.body === "string") {
    return { state: "resumable", message: String(out.message), result: String(out.result), body: out.body, attempt: String(out.attempt), remaining: out.remaining };
  }
  if (res.status === 200 && out?.state === "blocked") return { state: "blocked", kind: out.kind, message: String(out.message) };
  if (res.status === 409 && out?.state === "in_progress") return { state: "blocked", kind: "in_progress", message: String(out.message) };
  throw new Error(CHECK_FAILED_MESSAGE);
}

export type StepOutcome = { kind: "confirmed" } | { kind: "not_sent"; message: string } | { kind: "uncertain"; message: string };

/**
 * Sends ONE reserved step with its reserved request id. "not_sent" only when
 * the server (or the missing write session) proves nothing was sent; anything
 * else that is not a confirmation -- a network failure, an indeterminate
 * answer, an unreadable response -- is uncertain.
 */
export async function sendCallLogStep(contactId: string, step: CallLogStep, requestId: string, args: Record<string, unknown>): Promise<StepOutcome> {
  let res: Response;
  try { res = await writeCommand(OPERATION[step], contactId, args, requestId); }
  catch (e) {
    if (e instanceof AppWriteSignInRequired) return { kind: "not_sent", message: e.message };
    return { kind: "uncertain", message: (e as Error)?.message ?? "No response" };
  }
  const out = await res.json().catch(() => null);
  if (res.status === 200 && out && out.confirmed !== false) return { kind: "confirmed" };
  if (out?.outcome === "not_sent") return { kind: "not_sent", message: String(out.error ?? "Nothing was sent") };
  // ghl-write refuses these before any store, lock or GHL call: request shape, write sign-in, origin, Production scope.
  if (res.status === 400 || res.status === 401 || res.status === 403) return { kind: "not_sent", message: String(out?.error ?? `HTTP ${res.status}`) };
  return { kind: "uncertain", message: String(out?.error ?? `HTTP ${res.status}`) };
}
