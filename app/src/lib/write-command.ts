const pending = new Map<string, string>();
import { appWriteFetch } from "./app-write-session";
/** No method/path/body proxy: operation contracts own all outbound GHL fields. */
export async function writeCommand(operation: string, targetId: string, args: unknown): Promise<Response> {
  const key = JSON.stringify([operation,targetId,args]);
  const requestId = pending.get(key) ?? crypto.randomUUID();
  pending.set(key,requestId);
  const response = await appWriteFetch("/.netlify/functions/ghl-write", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, targetId, requestId, args }),
  });
  const outcome = await response.clone().json().catch(() => null);
  if (outcome?.outcome !== "indeterminate") pending.delete(key);
  // Existing Opportunity writers perform an independent readback and return
  // per-field results. An uncertain submission may enter that READ path, never
  // a second write. Draft-request has its own explicit indeterminate union.
  if (operation.startsWith("opportunity.") && outcome?.outcome === "indeterminate") return new Response(JSON.stringify(outcome), { status: 202, headers: { "Content-Type": "application/json" } });
  return response;
}
export async function confirmedCommand(operation: string, targetId: string, args: unknown): Promise<any> {
  const response = await writeCommand(operation, targetId, args);
  const result = await response.json();
  if (!response.ok || result.confirmed === false) throw new Error(result.error ?? "Write was not confirmed. Refresh to inspect the saved fields before retrying.");
  return result;
}
