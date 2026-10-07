const pending = new Map<string, string>();
import { appWriteFetch } from "./app-write-session";
import { newV2Id } from "./v2-ids";
/** No method/path/body proxy: operation contracts own all outbound GHL fields. */
/* Board 15 / PR #126 stacked server PR: a caller may pass the request id it
   reserved with the durable Current Offer barrier (current-offer-barrier-
   client.ts). An explicit id is sent as-is and never enters the pending map. */
export async function writeCommand(operation: string, targetId: string, args: unknown, explicitRequestId?: string): Promise<Response> {
  const key = JSON.stringify([operation,targetId,args]);
  const requestId = explicitRequestId ?? pending.get(key) ?? newV2Id();
  if (!explicitRequestId) pending.set(key,requestId);
  const response = await appWriteFetch("/.netlify/functions/ghl-write", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, targetId, requestId, args }),
  });
  const outcome = await response.clone().json().catch(() => null);
  if (!explicitRequestId && outcome?.outcome !== "indeterminate") pending.delete(key);
  // Existing Opportunity writers perform an independent readback and return
  // per-field results. An uncertain submission may enter that READ path, never
  // a second write. Draft-request has its own explicit indeterminate union.
  if (operation.startsWith("opportunity.") && outcome?.outcome === "indeterminate") return new Response(JSON.stringify(outcome), { status: 202, headers: { "Content-Type": "application/json" } });
  return response;
}
export async function confirmedCommand(operation: string, targetId: string, args: unknown, explicitRequestId?: string): Promise<any> {
  const response = await writeCommand(operation, targetId, args, explicitRequestId);
  const result = await response.json();
  if (!response.ok || result.confirmed === false) throw new Error(result.error ?? "Write was not confirmed. Refresh to inspect the saved fields before retrying.");
  return result;
}
