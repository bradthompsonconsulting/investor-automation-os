import { connectLambda } from "@netlify/blobs";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { validateLedgerNote } from "./lib/write-note-guard";
import { verifyUnderContractStageTransitionReady } from "./lib/write-derived-note";
import { getConfig } from "../../shared/ghl-config";
import { requireAppWriter } from "./lib/app-write-auth";
import { exact, identifier, planWrite, dispositions, routings } from "./lib/write-contracts";
import { configuredBoundary, fieldValue, WriteUncertain } from "./lib/ghl-write-boundary";
import { claimWrite, lockContact } from "./lib/write-receipts";
import { latestOutcomeNoteForOpportunity } from "../../src/lib/seller-call-outcome";
import { currentOfferWriteGate } from "../../src/lib/current-offer-carrier";
const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });

/**
 * Gate-review closure -- PR #85 live-Test proof found a manual-send 409
 * that was unattributable after the fact: this file threw generic 409s
 * without ever logging the original caught error. Diagnostics only --
 * the client-facing response shape and status codes below are UNCHANGED;
 * this only makes the NEXT such failure attributable from Netlify's own
 * function logs.
 *
 * Never throws on its own, regardless of what was actually thrown --
 * `error` is `unknown` here, and this codebase's own convention is to
 * throw only `Error`/`WriteUncertain` instances with hand-written literal
 * messages (never one built from a request body, a header, or a
 * credential), but a non-Error thrown value must still be describable
 * safely, without risking a second exception inside a catch block.
 */
function describeCaughtError(error: unknown): { name: string; message: string; stack: string | null; isWriteUncertain: boolean } {
  const isWriteUncertain = error instanceof WriteUncertain;
  if (error instanceof Error) {
    return {
      name: typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : "",
      stack: typeof error.stack === "string" ? error.stack : null,
      isWriteUncertain,
    };
  }
  let message: string;
  try { message = String(error); } catch { message = "[unloggable thrown value]"; }
  return { name: "NonErrorThrow", message, stack: null, isWriteUncertain };
}

/**
 * Logs ONLY correlation and error metadata -- requestId, operation
 * (both plain strings already validated by `identifier()`/`exact()`
 * upstream, never free text), and the description above. NEVER the
 * request body/args, note contents, `event.headers` (which carries the
 * bearer token), any GHL contact/document data, cookies, or environment
 * values -- none of those are referenced here at all, structurally, not
 * merely filtered out.
 */
function logWriteFailure(request: any, error: unknown): void {
  const described = describeCaughtError(error);
  console.error("[ghl-write]", JSON.stringify({
    requestId: typeof request?.requestId === "string" ? request.requestId : null,
    operation: typeof request?.operation === "string" ? request.operation : null,
    errorName: described.name,
    errorMessage: described.message,
    stack: described.stack,
    isWriteUncertain: described.isWriteUncertain,
  }));
}
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let operator: string;
  try { operator = requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch {
    return json(403, { error: "Application write origin refused" });
  }
  let request: any; let plan: ReturnType<typeof planWrite>;
  const config = getConfig(process.env.IAOS_ENV);
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request encoding or query");
    request = JSON.parse(event.body ?? "null"); exact(request, ["operation", "targetId", "requestId", "args"]);
    identifier(request.targetId); identifier(request.requestId);
    plan = planWrite(request.operation, request.args, config);
  } catch { return json(400, { error: "Invalid named write request" }); }
  let release: (() => Promise<void>) | undefined;
  try {
    connectLambda(event);
    const boundary = configuredBoundary();
    const { targetId, operation, args, requestId } = request;
    const isOpportunityTargeted = plan.kind === "opportunity" || plan.kind === "opportunity_stage";
    let target = isOpportunityTargeted ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    const contactId = isOpportunityTargeted ? target.contactId : targetId;
    release = await lockContact(contactId);
    target = isOpportunityTargeted ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    if (operation === "opportunity.currentOffer") {
      const outcome = latestOutcomeNoteForOpportunity(await boundary.notes(contactId), targetId);
      if (currentOfferWriteGate({ value: args.value, agreementAlreadyReached: outcome?.kind === "accept" }).kind !== "allowed") return json(409, { error: "Current Offer is frozen or invalid" });
    }
    if (operation === "contact.routing" && args.value === routings[1]) {
      const d = fieldValue(target.customFields, config.fields.callDisposition, "contact").value;
      if (d !== "No Answer" && d !== "Voicemail") return json(409, { error: "Routing transition is not permitted" });
    }
    if (operation === "contact.dispositionAt") {
      const d = fieldValue(target.customFields, config.fields.callDisposition, "contact").value;
      if (!dispositions.includes(d)) return json(409, { error: "A valid disposition must be confirmed first" });
      if (d === "Follow Up" && !fieldValue(target.customFields, config.fields.callbackDatetimePrecise, "contact").value) return json(409, { error: "Follow Up requires a confirmed callback" });
    }
    if (plan.kind === "note") await validateLedgerNote(boundary, targetId, plan.body!);
    await claimWrite(`${operator}:${operation}:${targetId}`, requestId, request);
    if (plan.kind === "note") return json(200, await boundary.note(targetId, plan.body!));
    if (plan.kind === "task") {
      const path = `/contacts/${targetId}/tasks/${plan.taskId}`;
      const before = await boundary.call(path); const task = before.task ?? before;
      if (task.id !== plan.taskId || (task.contactId && task.contactId !== targetId) || typeof task.completed !== "boolean") throw new Error("Task identity is ambiguous");
      if (!task.completed) await boundary.call(`${path}/completed`, "PUT", { completed: true });
      const after = await boundary.call(path); const readback = after.task ?? after;
      if (readback.id !== plan.taskId || readback.completed !== true) throw new WriteUncertain("Task completion readback is ambiguous");
      return json(200, { confirmed: true });
    }
    if (plan.kind === "opportunity_stage") {
      // Board #9 Phase B (B9-13). Independent re-verification (both the
      // Under Contract execution AND the preserved executed artifact)
      // happens INSIDE this call -- never trusted from the caller's claim
      // that either was already confirmed elsewhere.
      await verifyUnderContractStageTransitionReady(boundary, targetId, plan.agreementAt!, plan.version!);
      const targetStageId = config.stages.underContract;
      const forbiddenStageIds = [config.stages.sellerClosedWon];
      const result = await boundary.transitionOpportunityStage(targetId, config.pipelines.sellerLeads, targetStageId, forbiddenStageIds);
      return json(200, { confirmed: true, alreadyInStage: result.alreadyInStage, readback: { id: result.readback.id, pipelineId: result.readback.pipelineId, pipelineStageId: result.readback.pipelineStageId } });
    }
    const result = await boundary.fields(plan.kind, targetId, plan.fields);
    // A deterministic partial readback is not a successful write. Existing clients
    // receive per-field evidence and retain their partial-recovery path.
    return json(200, { ...result.response, confirmed: result.confirmed, readback: result.readback, results: result.results });
  } catch (error) {
    logWriteFailure(request, error);
    if (error instanceof WriteUncertain) return json(409, { outcome: "indeterminate", error: error.message });
    return json(409, { error: "Write refused or unconfirmed; refresh and inspect before retrying" });
  } finally { if (release) await release(); }
};
