/**
 * B15-04 -- the browser side of netlify/functions/property-answer.ts. No GHL
 * identifiers and no decisions: the server evaluates the deal set, the address
 * and every save; this module only sends the named actions and maps the
 * server's recorded state to the operator's words.
 */
import { appWriteFetch, AppWriteSignInRequired } from "./app-write-session";

export type AnswerField = "seller_reason" | "property_address";
export type Address = { street: string; unit: string; city: string; state: string; zip: string };
export type OpState = "committed" | "not_saved" | "saved_history_pending" | "history_unresolved" | "saved_conditions_changed" | "not_confirmed" | "pending";
export type OpView = { op: string; field: AnswerField; opportunityId: string; state: OpState; s1: string; s2: string; s2Attempt: number };
export type AnswerContext = {
  verdict: { allowed: boolean; reason: string; message: string; digest: string; deals: { id: string; cls: string; stageId: string | null; status: string | null }[] };
  address: { kind: "empty" | "confirmed" | "incomplete"; address: Address; digest: string } | null;
  values: { seller_reason: string | null };
  operation: OpView | null;
  drafts: { seller_reason: string | null; property_address: Address | null };
};
export type Reply = { status: number; body: any };

/** Must equal property-answer-operation.ts SAVED_RECORDING (asserted by test-property-answer). */
export const SAVED_RECORDING = "Saved. Recording history.";
export const EMPTY_ADDRESS: Address = { street: "", unit: "", city: "", state: "", zip: "" };

/** The server's gate refusals: this panel does not apply to this contact or deployment. */
export const GATE_CODES = new Set(["evaluation_disabled", "not_a_fixture"]);

export async function propertyAnswer(body: Record<string, unknown>): Promise<Reply> {
  const r = await appWriteFetch("/.netlify/functions/property-answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
export { AppWriteSignInRequired };
/**
 * B15-04 close (design r3 B3): ONE deliberate close attempt for the fixed evaluation. `closed` only for the
 * server's 200 `closed`; a 401 or a 403 is a refusal that wrote nothing; everything else -- a 503, a lost or
 * malformed reply, any other status -- is UNKNOWN (the stop may or may not be stored). Never retried here.
 */
export type CloseOutcome = { kind: "closed"; message: string } | { kind: "unknown"; message: string } | { kind: "refused"; code: string; message: string } | { kind: "sign_in"; message: string };
export async function closeEvaluation(pair: { contactId: string; opportunityId: string }): Promise<CloseOutcome> {
  let r: Response;
  try {
    r = await appWriteFetch("/.netlify/functions/property-answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "close", contactId: pair.contactId, opportunityId: pair.opportunityId }) });
  } catch (e) {
    if (e instanceof AppWriteSignInRequired) return { kind: "sign_in", message: "Sign in for saving (application writes) first. Nothing was sent." };
    return { kind: "unknown", message: "No reply was received. The close may or may not be stored; the evaluation stays on hold." };
  }
  const body = await r.json().catch(() => null);
  if (r.status === 200 && body?.outcome === "closed" && typeof body.message === "string") return { kind: "closed", message: body.message };
  if (r.status === 401) return { kind: "sign_in", message: "Your saving sign-in was not accepted. Nothing was closed." };
  if (r.status === 403 && typeof body?.code === "string") return { kind: "refused", code: body.code, message: typeof body.error === "string" ? body.error : "Refused." };
  return { kind: "unknown", message: typeof body?.error === "string" && r.status === 503 ? body.error : "The reply could not be confirmed. The close may or may not be stored; the evaluation stays on hold." };
}
/** C1–C4 r4 A3: the server echoes sha256(writer) as `operatorDigest` on authenticated replies. UI filtering only, never authority. */
export async function operatorDigestOf(operator: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operator));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** C1–C4 r4 A2: the status action the server says THIS session may take for the stored operation. */
export type StatusAccess = "settle" | "read" | "none" | "no_operation";
export const isStatusAccess = (x: unknown): x is StatusAccess => x === "settle" || x === "read" || x === "none" || x === "no_operation";
/** C1–C4 r4 C3: one field of a drafts recovery; only `present` carries text. */
export type DraftState = { state: "present"; value: string | Address; savedAt: string } | { state: Exclude<string, "present"> };

export const STATE_TEXT: Record<OpState, string> = {
  committed: "Saved.",
  not_saved: "Not saved. Nothing was sent to GHL.",
  saved_history_pending: "Saved. Recording history…",
  history_unresolved: "Saved; history unresolved. Use Check again. Do not save again.",
  saved_conditions_changed: "Saved; conditions changed during save. Held for reconciliation.",
  not_confirmed: "Not confirmed. Held for reconciliation. Do not save again.",
  pending: "Save in progress. Use Check again.",
};
/** States in which this contact accepts no new answer save until resolved. */
export const HOLDING = new Set<OpState>(["saved_history_pending", "history_unresolved", "saved_conditions_changed", "not_confirmed", "pending"]);

/**
 * Bones F3 (review of 525d7c2): the ONLY automatic follow-up. History is sent
 * automatically only right after THIS page's own save of operation `sent.operationId`
 * was answered 200 with saved_history_pending for that same operation. Check again,
 * a refresh, a recovery or any other reply never sends history; a later history
 * continuation is a separate, explicit operator action ("Record history").
 */
export function followUpAfter(sent: Record<string, unknown>, reply: Reply): { action: "history"; operationId: string } | null {
  if (sent.action !== "save" || typeof sent.operationId !== "string") return null;
  if (reply.status !== 200 || reply.body?.outcome !== "saved_history_pending") return null;
  if (reply.body?.view?.op !== sent.operationId || reply.body?.view?.state !== "saved_history_pending") return null;
  if (reply.body?.message !== SAVED_RECORDING) return null;   // the server wrote this save's S2 permit
  return { action: "history", operationId: sent.operationId };
}
