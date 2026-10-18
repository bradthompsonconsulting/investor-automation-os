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

export const EMPTY_ADDRESS: Address = { street: "", unit: "", city: "", state: "", zip: "" };

/** The server's gate refusals: this panel does not apply to this contact or deployment. */
export const GATE_CODES = new Set(["evaluation_disabled", "not_a_fixture"]);

export async function propertyAnswer(body: Record<string, unknown>): Promise<Reply> {
  const r = await appWriteFetch("/.netlify/functions/property-answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
export { AppWriteSignInRequired };

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
