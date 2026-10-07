/**
 * Board 15 / PR #126 stacked server PR -- the browser side of the durable
 * Current Offer barrier (server: netlify/functions/current-offer-barrier.ts).
 *
 *   begin      reserve the deal before ANY Current Offer save is sent (blur:
 *              one step; Confirm Accept: offer, note, touch). The returned
 *              request ids are the ones the writes must carry.
 *   status     read on load / deal change: is this deal blocked for every
 *              session? A failed read counts as blocked.
 *   reconcile  "Check again": the server evaluates its own records and
 *              clears only with evidence. It never reads GHL to clear, and
 *              there is no override.
 *
 * No function here retries. Any failure leaves the deal blocked.
 */
import { appWriteFetch } from "./app-write-session";
import { readFetch } from "./read-session";
import { newV2Id, pausedMessage } from "./v2-ids";

const ENDPOINT = "/.netlify/functions/current-offer-barrier";

export type BarrierPurpose = "blur" | "accept" | "touch" | "pass" | "follow_up";
export type BarrierStep = "offer" | "note" | "touch" | "callback" | "callback_note";
export type BarrierView =
  | { state: "clear" }
  | { state: "blocked"; message: string }
  | { state: "in_progress"; message: string };

export const STATUS_UNREADABLE_MESSAGE =
  "IAOS could not check whether an earlier Current Offer save for this deal is unresolved. Nothing will be sent until it is checked — use Check again.";
export const RESERVATION_FAILED_MESSAGE =
  "The Current Offer save could not be reserved, so nothing was sent. The reservation may still be held — use Check again before saving.";

/** The request ids for one reservation. */
export function newRequestIds<S extends BarrierStep>(steps: readonly S[]): Record<S, string> {
  const out = {} as Record<S, string>;
  for (const s of steps) out[s] = newV2Id();
  return out;
}

/** Reserves the deal. Resolves "reserved" or a blocked view; throws when the outcome is unknown. */
export async function beginReservation(opportunityId: string, purpose: BarrierPurpose, steps: { step: BarrierStep; requestId: string }[]): Promise<{ state: "reserved" } | { state: "blocked" | "in_progress"; message: string }> {
  const res = await appWriteFetch(ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "begin", opportunityId, purpose, steps }),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 200 && body?.state === "reserved") return { state: "reserved" };
  if (res.status === 409 && (body?.state === "blocked" || body?.state === "in_progress")) return { state: body.state, message: String(body.message ?? RESERVATION_FAILED_MESSAGE) };
  const paused = pausedMessage(body);
  if (paused) return { state: "blocked", message: paused };
  throw new Error(RESERVATION_FAILED_MESSAGE);
}

/** "Check again". Throws when the server could not evaluate (the deal stays blocked). */
export async function reconcileReservation(opportunityId: string): Promise<BarrierView> {
  const res = await appWriteFetch(ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reconcile", opportunityId }),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 200 && body?.state === "clear") return { state: "clear" };
  if ((res.status === 200 && body?.state === "blocked") || (res.status === 409 && body?.state === "in_progress")) return { state: body.state, message: String(body.message) };
  throw new Error("The check could not be completed; nothing was changed.");
}

/** Status for any session. A failed read is reported as blocked. */
export async function readReservationStatus(opportunityId: string): Promise<BarrierView> {
  try {
    const res = await readFetch(`${ENDPOINT}?opportunityId=${encodeURIComponent(opportunityId)}`);
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body?.state === "clear") return { state: "clear" };
    if (res.status === 200 && body?.state === "blocked") return { state: "blocked", message: String(body.message) };
  } catch { /* fall through */ }
  return { state: "blocked", message: STATUS_UNREADABLE_MESSAGE };
}
