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
import { AppWriteSignInRequired, appWriteFetch } from "./app-write-session";
import { readFetch } from "./read-session";
import { OPERATOR_ROWS, type Answers, type MiscAnswer } from "./repair-estimation/operator-model";

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
    // Thrown before any request is sent (no write session): nothing was submitted.
    if (e instanceof AppWriteSignInRequired) return { outcome: "not_sent", code: "sign_in_required", error: e.message };
    // Otherwise the request may or may not have reached the server: say so, never "nothing was sent".
    return { outcome: "unknown", error: "The save could not be confirmed. Do not retry; refresh to see the recorded approval status." };
  }
  const body = await res.json().catch(() => null);
  // repair-approval-save refuses these two before any I/O; only its exact refusals are read as "nothing sent".
  if (res.status === 401 && body?.error === "Application write sign-in required") return { outcome: "not_sent", code: "sign_in_required", error: "Sign in for application writes before saving. Your edits have not been submitted." };
  if (res.status === 403 && body?.error === "Application write origin refused") return { outcome: "not_sent", code: "origin_refused", error: "Nothing was sent; the save could not start" };
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

/** Plain-language explanations of the reader's not_verified reasons (Jess, 2026-10-22). A raw reason code is never shown. */
const REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  no_recorded_approval: "No recorded approval is available for this total.",
  evidence_unavailable: "The approval evidence could not be read.",
  evidence_mismatch: "The saved details do not match the recorded approval.",
  evidence_ambiguous: "The saved approval details are ambiguous.",
  record_changed: "The approval record changed during the check.",
});
/** The explanation for a reason, or null for one this page does not know (then only the lead sentence is shown). */
export function repairApprovalReasonText(reason: string): string | null {
  return Object.prototype.hasOwnProperty.call(REASON_TEXT, reason) ? REASON_TEXT[reason] : null;
}

/** The reader's recorded total, labelled as such: never the on-screen draft total. */
export function recordedRepairTotalText(total: number): string {
  return `Recorded repair total: ${total.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 })}.`;
}

export const REPAIR_APPROVAL_EDITS_NOT_APPROVED = "Current edits have not been approved.";
/** Used when the draft cannot be compared with the recorded basis: claims neither a match nor a difference. */
export const REPAIR_APPROVAL_EDITS_NOT_CHECKED = "Current edits have not been checked against the recorded approval.";

/** Every answer, in OPERATOR_ROWS order, plus Miscellaneous: equal keys = the same submitted answers. */
export function draftBasisKey(answers: Answers, misc: MiscAnswer): string {
  return JSON.stringify([
    OPERATOR_ROWS.map((r) => { const a = answers[r.system]; return a ? [r.system, a.condition, a.amount, a.quantity, a.dirty] : [r.system, "not_asked", "", "", false]; }),
    [misc.description, misc.amount],
  ]);
}

/**
 * The line comparing the operator's current edits with a CHECKED recorded
 * approval. The reader returns the recorded total but not the answers behind
 * it, so a difference in answers is known only against the answers this page
 * visit itself saved and saw verified; otherwise an equal total says nothing
 * about the answers and the wording claims no match.
 */
export function repairApprovalDraftNotice(
  status: RepairApprovalStatus | null,
  draft: { key: string; total: number; incomplete: boolean; edited: boolean },
  verifiedThisVisit: { key: string; total: number } | null,
): string | null {
  if (status?.kind !== "checked" || !draft.edited) return null;
  const draftTotal = Math.round(draft.total * 100) / 100; // as the server rounds the total it records
  if (verifiedThisVisit && verifiedThisVisit.total === status.total && verifiedThisVisit.key === draft.key && draftTotal === status.total) return null;
  if (draft.incomplete || draftTotal !== status.total) return REPAIR_APPROVAL_EDITS_NOT_APPROVED;
  if (verifiedThisVisit && verifiedThisVisit.total === status.total) return REPAIR_APPROVAL_EDITS_NOT_APPROVED; // same total, different answers from those verified here
  return REPAIR_APPROVAL_EDITS_NOT_CHECKED;
}
