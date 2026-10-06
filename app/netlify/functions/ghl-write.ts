import { connectLambda, getStore } from "@netlify/blobs";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { validateLedgerNote } from "./lib/write-note-guard";
import { verifyUnderContractStageTransitionReady } from "./lib/write-derived-note";
import { getConfig } from "../../shared/ghl-config";
import { requireAppWriter } from "./lib/app-write-auth";
import { exact, identifier, planWrite, dispositions, routings } from "./lib/write-contracts";
import { configuredBoundary, fieldValue, WriteUncertain, type DispatchHooks } from "./lib/ghl-write-boundary";
import { barrierScope, isBarrierOwned, runOwnedWrite, checkNoteReservation, NotSent, NotOwned, STEP_OPERATION, RESERVED_OPERATIONS, type BarrierStore } from "./lib/current-offer-barrier";
import { parseOutcomeNote } from "../../src/lib/seller-call-outcome";
import { callLogScope, isCallLogBound, isCallLogNoteText, isOperationRequestId, runCallLogOwnedWrite, CALL_LOG_OPERATIONS, NotSent as CallLogNotSent, NotOwned as CallLogNotOwned } from "./lib/call-log-barrier";
import { claimWrite, lockContact, stageTransitionUnresolved, claimStageTransition, clearStageTransition } from "./lib/write-receipts";
import { latestOutcomeNoteForOpportunity } from "../../src/lib/seller-call-outcome";
import { currentOfferWriteGate } from "../../src/lib/current-offer-carrier";
import { evaluateProductionGhlWriteScope, evaluateProductionPairedOwnership, requiresProductionPairedOwnership, PRODUCTION_WRITE_SCOPE_REFUSAL } from "./lib/production-write-scope";
/** Board 15 / PR #126 stacked server PR: the operations a Current Offer barrier can own. */
const BARRIER_OPERATIONS = new Set(Object.values(STEP_OPERATION));
const barrierStore = () => getStore("iaos-write-receipts") as unknown as BarrierStore;
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
  // INV-98 Board #9 Production proof write scope -- before connectLambda,
  // any Blob store, the contact lock, the write claim, or any GHL call.
  // Test deployments are unaffected (always ok).
  const scope = evaluateProductionGhlWriteScope(config, { operation: request.operation, targetId: request.targetId, args: request.args });
  if (!scope.ok) return json(403, { error: "Production write refused by the proof write scope", by: PRODUCTION_WRITE_SCOPE_REFUSAL, code: scope.code });
  let release: (() => Promise<void>) | undefined;
  /* Board 15 / PR #126 stacked server PR -- the durable Current Offer barrier
     (lib/current-offer-barrier.ts). A request id registered by `begin` is
     barrier-owned: its send is claimed atomically at the write boundary, its
     outcome is recorded, and any refusal before sending answers
     `outcome: "not_sent"`. A Current Offer write that is not barrier-owned is
     refused before anything is sent. Every other request is unchanged. */
  const barrierOperation = BARRIER_OPERATIONS.has(request.operation);
  const offerScope = barrierScope(String(process.env.IAOS_ENV), config.locationId);
  let owned = false;
  /* Board 15 / PR #131 -- durable call-log OPERATIONS (approved lifecycle v3,
     lib/call-log-barrier.ts). A call result, and any note in the call-log
     format, is only ever sent as a published, bound attempt of the contact's
     current operation: ordered (each slot only after the previous one is
     confirmed), claimed at the write boundary, its outcome recorded. Plain
     notes and last-touch writes that are not bound are unchanged. */
  const callLogNeedsReservation = request.operation === "contact.callLogResult" || (request.operation === "note.create" && isCallLogNoteText(request.args?.body))
    || (CALL_LOG_OPERATIONS.has(request.operation) && isOperationRequestId(request.requestId));
  let callLogOwned = false;
  try {
    connectLambda(event);
    if (barrierOperation) {
      try { owned = await isBarrierOwned(barrierStore(), offerScope, request.requestId); }
      catch (e) {
        // Ownership unknown: never proceed. A reserved-only operation answers
        // not_sent; any other operation fails exactly as before (generic
        // refusal, nothing sent).
        if (RESERVED_OPERATIONS.has(request.operation)) return json(409, { outcome: "not_sent", error: "The reservation could not be read; nothing was sent" });
        throw e;
      }
      if (RESERVED_OPERATIONS.has(request.operation) && !owned) {
        return json(409, { outcome: "not_sent", error: request.operation === "opportunity.currentOffer" ? "No Current Offer reservation for this save; nothing was sent" : "No reservation for this Follow-Up callback; nothing was sent" });
      }
      /* PR #126 stacked server PR (Bones, 2026-10-05): a negotiation outcome
         (Accept, Pass, Follow-Up) is only sent under a reservation of the same
         kind for the same deal -- so no outcome can be submitted while another
         is pending or unresolved, from any session. Plain notes are unchanged. */
      if (request.operation === "note.create") {
        let refusal: string | null;
        try { refusal = await checkNoteReservation(barrierStore(), offerScope, request.requestId, parseOutcomeNote(String(request.args?.body ?? ""))); }
        catch { refusal = "The reservation could not be read; nothing was sent"; }
        if (refusal) return json(409, { outcome: "not_sent", error: refusal });
      }
    }
    if (!owned && CALL_LOG_OPERATIONS.has(request.operation)) {
      try { callLogOwned = await isCallLogBound(barrierStore(), callLogScope(String(process.env.IAOS_ENV), config.locationId), request.requestId); }
      catch (e) {
        if (callLogNeedsReservation) return json(409, { outcome: "not_sent", error: "The call-log reservation could not be read; nothing was sent" });
        throw e;
      }
    }
    if (callLogNeedsReservation && !callLogOwned) return json(409, { outcome: "not_sent", proves: "nothing", error: "No call-log reservation for this write; nothing was sent" });
    // INV-98: an unresolved earlier Under Contract attempt blocks every later
    // one -- any browser, operator or requestId -- before any GHL call.
    if (plan.kind === "opportunity_stage" && await stageTransitionUnresolved(request.targetId)) {
      return json(409, { outcome: "indeterminate", by: "iaos-stage-transition-unresolved", error: "An earlier Under Contract stage transition for this opportunity is unresolved. Do not retry; inspect GHL first." });
    }
    const boundary = configuredBoundary();
    const { targetId, operation, args, requestId } = request;
    const isOpportunityTargeted = plan.kind === "opportunity" || plan.kind === "opportunity_stage";
    let target = isOpportunityTargeted ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    const contactId = isOpportunityTargeted ? target.contactId : targetId;
    // INV-98 walkthrough (Bones): a paired Production opportunity write locks
    // the CONFIGURED pinned contact, never whichever owner the first,
    // unlocked read happened to report. The fresh ownership check below then
    // runs under that lock. Test and every other operation are unchanged.
    const pairedProduction = requiresProductionPairedOwnership(config, operation, targetId);
    release = await lockContact(pairedProduction && isOpportunityTargeted ? config.productionProofScope.contactId : contactId);
    target = isOpportunityTargeted ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    const perform = async (hooks?: DispatchHooks): Promise<{ confirmed: boolean; statusCode: number; body: unknown }> => {
      // INV-98 walkthrough: under the contact lock, before the write claim or
      // any PUT, the pinned opportunity (read fresh) must still belong to the
      // pinned contact in Seller Leads. Production only; Test is unaffected.
      if (pairedProduction) {
        const pinnedOpportunity = isOpportunityTargeted ? target : await boundary.opportunity(config.productionProofScope.opportunityId);
        const ownership = evaluateProductionPairedOwnership(config, pinnedOpportunity);
        if (!ownership.ok) throw new RefusedBeforeSend(403, { error: "Production write refused by the proof write scope", by: PRODUCTION_WRITE_SCOPE_REFUSAL, code: ownership.code });
      }
      if (operation === "opportunity.currentOffer") {
        const outcome = latestOutcomeNoteForOpportunity(await boundary.notes(contactId), targetId);
        if (currentOfferWriteGate({ value: args.value, agreementAlreadyReached: outcome?.kind === "accept" }).kind !== "allowed") throw new RefusedBeforeSend(409, { error: "Current Offer is frozen or invalid" });
      }
      if (operation === "contact.routing" && args.value === routings[1]) {
        const d = fieldValue(target.customFields, config.fields.callDisposition, "contact").value;
        if (d !== "No Answer" && d !== "Voicemail") throw new RefusedBeforeSend(409, { error: "Routing transition is not permitted" });
      }
      if (operation === "contact.dispositionAt") {
        const d = fieldValue(target.customFields, config.fields.callDisposition, "contact").value;
        if (!dispositions.includes(d)) throw new RefusedBeforeSend(409, { error: "A valid disposition must be confirmed first" });
        if (d === "Follow Up" && !fieldValue(target.customFields, config.fields.callbackDatetimePrecise, "contact").value) throw new RefusedBeforeSend(409, { error: "Follow Up requires a confirmed callback" });
      }
      if (plan.kind === "note") await validateLedgerNote(boundary, targetId, plan.body!, operator);
      await claimWrite(`${operator}:${operation}:${targetId}`, requestId, request);
      if (plan.kind === "note") return { confirmed: true, statusCode: 200, body: await boundary.note(targetId, plan.body!, hooks) };
      if (plan.kind === "task") {
        const path = `/contacts/${targetId}/tasks/${plan.taskId}`;
        const before = await boundary.call(path); const task = before.task ?? before;
        if (task.id !== plan.taskId || (task.contactId && task.contactId !== targetId) || typeof task.completed !== "boolean") throw new Error("Task identity is ambiguous");
        if (!task.completed) await boundary.call(`${path}/completed`, "PUT", { completed: true });
        const after = await boundary.call(path); const readback = after.task ?? after;
        if (readback.id !== plan.taskId || readback.completed !== true) throw new WriteUncertain("Task completion readback is ambiguous");
        return { confirmed: true, statusCode: 200, body: { confirmed: true } };
      }
      if (plan.kind === "opportunity_stage") {
        // Board #9 Phase B (B9-13). Independent re-verification (both the
        // Under Contract execution AND the preserved executed artifact)
        // happens INSIDE this call -- never trusted from the caller's claim
        // that either was already confirmed elsewhere.
        await verifyUnderContractStageTransitionReady(boundary, targetId, plan.agreementAt!, plan.version!, operator);
        const targetStageId = config.stages.underContract;
        const forbiddenStageIds = [config.stages.sellerClosedWon];
        const result = await boundary.transitionOpportunityStage(targetId, config.pipelines.sellerLeads, targetStageId, forbiddenStageIds, {
          beforePut: () => claimStageTransition(targetId, requestId, operator),
          afterConfirmed: () => clearStageTransition(targetId),
        });
        return { confirmed: true, statusCode: 200, body: { confirmed: true, alreadyInStage: result.alreadyInStage, readback: { id: result.readback.id, pipelineId: result.readback.pipelineId, pipelineStageId: result.readback.pipelineStageId } } };
      }
      const result = await boundary.fields(plan.kind, targetId, plan.fields, hooks);
      // A deterministic partial readback is not a successful write. Existing clients
      // receive per-field evidence and retain their partial-recovery path.
      return { confirmed: result.confirmed, statusCode: 200, body: { ...result.response, confirmed: result.confirmed, readback: result.readback, results: result.results } };
    };
    if (owned) {
      try {
        const done = await runOwnedWrite(barrierStore(), offerScope, { operation, targetId, requestId, contactId }, perform);
        return json(done.statusCode, done.body);
      } catch (error) {
        logWriteFailure(request, error);
        if (error instanceof NotSent || error instanceof NotOwned) {
          const refusal = error instanceof NotSent && error.refusal instanceof RefusedBeforeSend ? error.refusal : null;
          return json(refusal?.statusCode ?? 409, { ...(refusal?.body ?? {}), outcome: "not_sent", error: refusal ? String(refusal.body.error) : "Nothing was sent; the save was refused before reaching GHL" });
        }
        // The GHL call may have been made: recorded as uncertain by runOwnedWrite.
        return json(409, { outcome: "indeterminate", error: error instanceof WriteUncertain ? error.message : "The save may have reached GHL; it is unresolved" });
      }
    }
    if (callLogOwned) {
      try {
        const done = await runCallLogOwnedWrite(barrierStore(), callLogScope(String(process.env.IAOS_ENV), config.locationId), { operation, targetId, requestId, args }, perform);
        return json(done.statusCode, done.body);
      } catch (error) {
        logWriteFailure(request, error);
        if (error instanceof CallLogNotSent || error instanceof CallLogNotOwned) {
          const refusal = error instanceof CallLogNotSent && error.refusal instanceof RefusedBeforeSend ? error.refusal : null;
          /* `proves`: whether this refusal establishes that THIS request id can never be sent (a losing
             duplicate's refusal proves nothing about the winner). `code`/`recorded`: a stale request of a
             finished or non-current operation gets that operation's recorded outcome, and writes nothing. */
          const cl = error instanceof CallLogNotSent ? error : null;
          return json(refusal?.statusCode ?? 409, { ...(refusal?.body ?? {}), outcome: "not_sent", proves: cl?.proves ?? "nothing", ...(cl?.code ? { code: cl.code } : {}), ...(cl?.outcome ? { recorded: cl.outcome } : {}), error: refusal ? String(refusal.body.error) : (cl ? `${cl.message}; nothing was sent` : "Nothing was sent") });
        }
        // The GHL call may have been made: recorded as uncertain by runCallLogOwnedWrite.
        return json(409, { outcome: "indeterminate", error: error instanceof WriteUncertain ? error.message : "The call save may have reached GHL; it is unresolved" });
      }
    }
    try {
      const done = await perform();
      return json(done.statusCode, done.body);
    } catch (error) {
      if (error instanceof RefusedBeforeSend) return json(error.statusCode, error.body);
      throw error;
    }
  } catch (error) {
    logWriteFailure(request, error);
    // A barrier-owned request only reaches here BEFORE runOwnedWrite (the lock
    // is held elsewhere, a fresh read failed, ...): provably nothing was sent.
    if (owned || callLogOwned) return json(409, { outcome: "not_sent", ...(callLogOwned ? { proves: "nothing" } : {}), error: "Nothing was sent; the save could not start" });
    if (error instanceof WriteUncertain) return json(409, { outcome: "indeterminate", error: error.message });
    return json(409, { error: "Write refused or unconfirmed; refresh and inspect before retrying" });
  } finally { if (release) await release(); }
};

/** A refusal decided before any GHL write; keeps its original status and body. */
class RefusedBeforeSend extends Error {
  constructor(readonly statusCode: number, readonly body: Record<string, unknown>) { super(String(body.error ?? "Refused")); }
}
