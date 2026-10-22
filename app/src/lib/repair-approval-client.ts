/**
 * Repair-save completion integration -- browser side (B15-26 B1). Used only
 * while REPAIR_APPROVAL_CONFIG.enabled is true; while it is false nothing in
 * the app imports a call path that reaches these functions' endpoints.
 *
 * The browser sends ONLY the operator's answers (plus the opportunity and a
 * fresh request id). It never sends a total, contact, operator or note: the
 * server recomputes and derives all of them. One click = one request id; the
 * browser never retries a save on its own.
 */
import { appWriteFetch } from "./app-write-session";
import { readFetch } from "./read-session";
import type { Answers, MiscAnswer } from "./repair-estimation/operator-model";

export const REPAIR_APPROVAL_SAVE_ENDPOINT = "/.netlify/functions/repair-approval-save";
export const REPAIR_APPROVAL_STATUS_ENDPOINT = "/.netlify/functions/repair-approval-status";
/** The enabled path's button label: the same words as the existing control (only one of the two ever renders). */
export const REPAIR_APPROVAL_APPROVE_LABEL = "Approve and save repair total";
/** Shown while the single save request is in flight (one request: write, then verify in GHL). */
export const REPAIR_APPROVAL_SAVING_TEXT = "Saving the repair approval to this deal, then verifying it in GHL…";

export type RepairApprovalSaveResult =
  | { outcome: "verified"; total: number; text: string }
  | { outcome: "blocked"; code: string; text: string }
  | { outcome: "not_sent"; code?: string; text?: string; error?: string }
  | { outcome: "unknown"; error: string };

/** One save request. The server decides everything; this only relays its answer. */
export async function saveRepairApproval(opportunityId: string, answers: Answers, misc: MiscAnswer, requestId: string = crypto.randomUUID()): Promise<RepairApprovalSaveResult> {
  let res: Response;
  try {
    res = await appWriteFetch(REPAIR_APPROVAL_SAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId, requestId, answers, misc }),
    });
  } catch (e) {
    // The request may or may not have reached the server: say so, never "nothing was sent".
    return { outcome: "unknown", error: "The save could not be confirmed. Do not retry; refresh to see the recorded approval status." };
  }
  const body = await res.json().catch(() => null);
  if (body && (body.outcome === "verified" || body.outcome === "blocked" || body.outcome === "not_sent")) return body as RepairApprovalSaveResult;
  return { outcome: "unknown", error: "The save could not be confirmed. Do not retry; refresh to see the recorded approval status." };
}

export type RepairApprovalStatus =
  | { kind: "checked"; text: string; checkedAt: string; total: number }
  | { kind: "needs_review"; text: string }
  | { kind: "not_verified"; reason: string; text: string; total: number | null }
  | { kind: "none" }
  | { kind: "unavailable" };

/** The approval display's reader. Any failure is "unavailable" -- never a checked or approved claim. */
export async function fetchRepairApprovalStatus(opportunityId: string): Promise<RepairApprovalStatus> {
  try {
    const res = await readFetch(`${REPAIR_APPROVAL_STATUS_ENDPOINT}?opportunityId=${encodeURIComponent(opportunityId)}`, { method: "GET" });
    if (!res.ok) return { kind: "unavailable" };
    const body = await res.json();
    if (body && ["checked", "needs_review", "not_verified", "none"].includes(body.kind)) return body as RepairApprovalStatus;
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
