import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { validateLedgerNote } from "./lib/write-note-guard";
import { verifyUnderContractStageTransitionReady } from "./lib/write-derived-note";
import { requireAppWriter } from "./lib/app-write-auth";
import { exact, identifier, planWrite, dispositions, routings } from "./lib/write-contracts";
import { fieldValue, WriteUncertain, type DispatchHooks, type WriteIdentity } from "./lib/ghl-write-boundary";
import { barrierScope, isBarrierOwned, runOwnedWrite, checkNoteReservation, NotSent, NotOwned, STEP_OPERATION, RESERVED_OPERATIONS } from "./lib/current-offer-barrier";
import { parseOutcomeNote } from "../../src/lib/seller-call-outcome";
import { callLogScope, isCallLogBound, isCallLogNoteText, isOperationRequestId, runCallLogOwnedWrite, CALL_LOG_OPERATIONS, NotSent as CallLogNotSent, NotOwned as CallLogNotOwned } from "./lib/call-log-barrier";
import { claimWrite } from "./lib/write-receipts";
import { latestOutcomeNoteForOpportunity } from "../../src/lib/seller-call-outcome";
import { currentOfferWriteGate } from "../../src/lib/current-offer-carrier";
import { evaluateProductionGhlWriteScope, evaluateProductionPairedOwnership, requiresProductionPairedOwnership, PRODUCTION_WRITE_SCOPE_REFUSAL } from "./lib/production-write-scope";
import { legacyEventFrom, toResponse, json, echoedActivation, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { invocation, boundaryFor, refusalResult, sessionCapabilityBranch, withLockWarning, LOCK_MESSAGES, type Invocation } from "./lib/endpoint-kit";
import { WriteRefused, requireWritableDeployment, requireNotKilled } from "./lib/write-gate";
import { acquireLock, lockKey, LockHeld, LockUnknown, type ContactLock, type LockRecord } from "./lib/contact-lock-v2";
import { claimStageMarker, stageMarkerKey, stageMarkerUnresolved, type StageMarkerClaim } from "./lib/stage-marker-v2";
import { isV2Id } from "./lib/cutover";
/** Board 15 / PR #126 stacked server PR: the operations a Current Offer barrier can own. */
const BARRIER_OPERATIONS = new Set(Object.values(STEP_OPERATION));

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

/**
 * Storage correction (plan v6 §5): modern runtime. Every write passes the
 * write gate (published production deploy, captured activation echoed by the
 * page, kill switch, G5, legacy block) before any ownership read; every GHL
 * mutation is admitted, claimed, marked dispatching and sent once through the
 * gated boundary; request ids are `v2-` only; the contact lock is lock v2.
 */
export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true });
  const inv = invocation("ghl-write", context);
  let header: Record<string, string> | undefined;
  try {
    const r = await handle(event, inv, (h) => { header = { "X-IAOS-Storage": h }; });
    return toResponse(r, header);
  } finally { inv.scope.close(); }
};

/** Refusal statuses carried through the barrier wrappers. */
function refusalOf(error: unknown): { statusCode: number; body: Record<string, unknown> } | null {
  if (error instanceof RefusedBeforeSend) return { statusCode: error.statusCode, body: error.body };
  if (error instanceof WriteRefused) return { statusCode: error.refusal.status, body: error.refusal.body };
  return null;
}

async function handle(event: LegacyEvent, inv: Invocation, setStorageHeader: (h: string) => void): Promise<LambdaResult> {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let operator: string;
  try { operator = requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch {
    return json(403, { error: "Application write origin refused" });
  }
  const cap = await sessionCapabilityBranch(event, inv);
  if (cap) { if (cap.header) setStorageHeader(cap.header); return cap.result; }
  let request: any; let plan: ReturnType<typeof planWrite>;
  const config = inv.config;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request encoding or query");
    request = JSON.parse(event.body ?? "null"); exact(request, ["operation", "targetId", "requestId", "args"]);
    identifier(request.targetId); identifier(request.requestId);
    plan = planWrite(request.operation, request.args, config);
  } catch { return json(400, { error: "Invalid named write request" }); }
  // Legacy (non-v2) request ids are refused permanently, before any I/O (plan v6 §9.3).
  if (!isV2Id(request.requestId)) return json(400, { error: "Invalid named write request", code: "legacy_id_refused" });
  // INV-98 Board #9 Production proof write scope -- before any Blob store, the
  // contact lock, the write claim, or any GHL call. Test deployments are
  // unaffected (always ok).
  const scope = evaluateProductionGhlWriteScope(config, { operation: request.operation, targetId: request.targetId, args: request.args });
  if (!scope.ok) return json(403, { error: "Production write refused by the proof write scope", by: PRODUCTION_WRITE_SCOPE_REFUSAL, code: scope.code });
  /* The write gate (plan v6 §8.1 M4). In the SAME round trip, the write-once
     ownership records this request needs (its call-log binding and Current
     Offer registration) and, for a contact target, the contact's lock record
     are read; nothing is decided from them until the gate has passed. */
  try { requireWritableDeployment(inv.deploy); requireNotKilled(); }
  catch (e) { if (e instanceof WriteRefused) return refusalResult(e); throw e; }
  const store = inv.store;
  const callLogScopeKey = callLogScope(inv.env, config.locationId);
  const contactTarget = plan.kind !== "opportunity" && plan.kind !== "opportunity_stage";
  const early = {
    callLogBound: CALL_LOG_OPERATIONS.has(request.operation) ? isCallLogBound(store, callLogScopeKey, request.requestId).then((v) => ({ v }), (e) => ({ e })) : Promise.resolve({ v: false }),
    barrierOwned: BARRIER_OPERATIONS.has(request.operation) ? isBarrierOwned(store, barrierScope(inv.env, config.locationId), request.requestId).then((v) => ({ v }), (e) => ({ e })) : Promise.resolve({ v: false }),
    noteReservation: request.operation === "note.create" ? checkNoteReservation(store, barrierScope(inv.env, config.locationId), request.requestId, parseOutcomeNote(String(request.args?.body ?? ""))).then((v) => ({ v }), (e) => ({ e })) : Promise.resolve({ v: null }),
    lock: contactTarget ? store.read<LockRecord>(lockKey(inv.env, config.locationId, request.targetId), "lock_acquire").then((v) => ({ v }), () => ({ v: undefined })) : Promise.resolve({ v: undefined }),
  };
  try { await inv.gate.enter(echoedActivation(event), [`${contactTarget ? "contact" : "opportunity"}:${request.targetId}`]); }
  catch (e) { if (e instanceof WriteRefused) { await Promise.allSettled(Object.values(early)); return refusalResult(e); } throw e; }
  let lock: ContactLock | null = null;
  /* Board 15 / PR #126 stacked server PR -- the durable Current Offer barrier
     (lib/current-offer-barrier.ts). A request id registered by `begin` is
     barrier-owned: its send is claimed atomically at the write boundary, its
     outcome is recorded, and any refusal before sending answers
     `outcome: "not_sent"`. A Current Offer write that is not barrier-owned is
     refused before anything is sent. Every other request is unchanged. */
  const barrierOperation = BARRIER_OPERATIONS.has(request.operation);
  const offerScope = barrierScope(inv.env, config.locationId);
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
  let result: LambdaResult;
  try {
    if (barrierOperation) {
      try { const r: any = await early.barrierOwned; if ("e" in r) throw r.e; owned = r.v; }
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
        try { const r: any = await early.noteReservation; if ("e" in r) throw r.e; refusal = r.v; }
        catch { refusal = "The reservation could not be read; nothing was sent"; }
        if (refusal) return json(409, { outcome: "not_sent", error: refusal });
      }
    }
    if (!owned && CALL_LOG_OPERATIONS.has(request.operation)) {
      try { const r: any = await early.callLogBound; if ("e" in r) throw r.e; callLogOwned = r.v; }
      catch (e) {
        if (callLogNeedsReservation) return json(409, { outcome: "not_sent", error: "The call-log reservation could not be read; nothing was sent" });
        throw e;
      }
    }
    if (callLogNeedsReservation && !callLogOwned) return json(409, { outcome: "not_sent", proves: "nothing", error: "No call-log reservation for this write; nothing was sent" });
    // INV-98: an unresolved earlier Under Contract attempt blocks every later
    // one -- any browser, operator or requestId -- before any GHL call. An
    // unreadable marker fails closed (strong read; plan v6 §4).
    const markerKey = stageMarkerKey(inv.env, config.locationId, request.targetId);
    if (plan.kind === "opportunity_stage" && await stageMarkerUnresolved(store, markerKey)) {
      return json(409, { outcome: "indeterminate", by: "iaos-stage-transition-unresolved", error: "An earlier Under Contract stage transition for this opportunity is unresolved. Do not retry; inspect GHL first." });
    }
    const boundary = boundaryFor(inv);
    const { targetId, operation, args, requestId } = request;
    const isOpportunityTargeted = plan.kind === "opportunity" || plan.kind === "opportunity_stage";
    let target = isOpportunityTargeted ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    const contactId = isOpportunityTargeted ? target.contactId : targetId;
    // INV-98 walkthrough (Bones): a paired Production opportunity write locks
    // the CONFIGURED pinned contact, never whichever owner the first,
    // unlocked read happened to report. The fresh ownership check below then
    // runs under that lock. Test and every other operation are unchanged.
    const pairedProduction = requiresProductionPairedOwnership(config, operation, targetId);
    const lockContactId = pairedProduction && isOpportunityTargeted ? config.productionProofScope.contactId : contactId;
    const opId = isOperationRequestId(requestId) ? String(requestId).replace(/-(result|note|touch)-[1-9][0-9]*$/, "") : null;
    const lockHint = lockContactId === request.targetId ? (await early.lock).v : undefined;
    try { lock = await acquireLock(store, inv.scope, lockKey(inv.env, config.locationId, lockContactId), { opId, deployId: inv.deploy.id! }, lockHint); }
    catch (e) {
      if (e instanceof LockHeld) throw new WriteUncertain(LOCK_MESSAGES[e.status] || LOCK_MESSAGES.held_in_progress);
      if (e instanceof LockUnknown) throw new WriteUncertain(LOCK_MESSAGES.unknown);
      throw e;
    }
    target = isOpportunityTargeted ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    const plainIdentity: WriteIdentity = { requestId, opId: "-", attemptId: "-" };
    const perform = async (hooks?: DispatchHooks, identity: WriteIdentity = plainIdentity): Promise<{ confirmed: boolean; statusCode: number; body: unknown }> => {
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
      if (plan.kind === "note") await validateLedgerNote(boundary, targetId, plan.body!, operator, store);
      await claimWrite(store, `${operator}:${operation}:${targetId}`, requestId, request);
      if (plan.kind === "note") return { confirmed: true, statusCode: 200, body: await boundary.note(targetId, plan.body!, hooks, identity) };
      if (plan.kind === "task") {
        await boundary.completeTask(targetId, plan.taskId!, identity);
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
        let marker: StageMarkerClaim | null = null;
        const r = await boundary.transitionOpportunityStage(targetId, config.pipelines.sellerLeads, targetStageId, forbiddenStageIds, {
          beforePut: async () => { marker = await claimStageMarker(store, inv.scope, markerKey, requestId); },
          // An unverified resolution is never reported as a clean success: the marker stays unresolved (later transitions refuse).
          afterConfirmed: async () => { if (marker && !(await marker.resolve())) throw new WriteUncertain("The stage transition was confirmed, but its unresolved marker could not be cleared; later transitions stay refused until it is inspected"); },
        }, identity);
        return { confirmed: true, statusCode: 200, body: { confirmed: true, alreadyInStage: r.alreadyInStage, readback: { id: r.readback.id, pipelineId: r.readback.pipelineId, pipelineStageId: r.readback.pipelineStageId } } };
      }
      const r = await boundary.fields(plan.kind as "contact" | "opportunity", targetId, plan.fields, hooks, identity);
      // A deterministic partial readback is not a successful write. Existing clients
      // receive per-field evidence and retain their partial-recovery path.
      return { confirmed: r.confirmed, statusCode: 200, body: { ...r.response, confirmed: r.confirmed, readback: r.readback, results: r.results } };
    };
    if (owned) {
      try {
        const done = await runOwnedWrite(store, offerScope, { operation, targetId, requestId, contactId }, (hooks, identity) => perform(hooks, identity));
        result = json(done.statusCode, done.body);
      } catch (error) {
        logWriteFailure(request, error);
        if (error instanceof NotSent || error instanceof NotOwned) {
          const refusal = error instanceof NotSent ? refusalOf(error.refusal) : null;
          result = json(refusal?.statusCode ?? 409, { ...(refusal?.body ?? {}), outcome: "not_sent", error: refusal ? String(refusal.body.error) : "Nothing was sent; the save was refused before reaching GHL" });
        }
        // The GHL call may have been made: recorded as uncertain by runOwnedWrite.
        else result = json(409, { outcome: "indeterminate", error: error instanceof WriteUncertain ? error.message : "The save may have reached GHL; it is unresolved" });
      }
    } else if (callLogOwned) {
      try {
        const done = await runCallLogOwnedWrite(store, callLogScope(inv.env, config.locationId), { operation, targetId, requestId, args }, (hooks, identity) => perform(hooks, identity));
        result = json(done.statusCode, done.body);
      } catch (error) {
        logWriteFailure(request, error);
        if (error instanceof CallLogNotSent || error instanceof CallLogNotOwned) {
          const refusal = error instanceof CallLogNotSent ? refusalOf(error.refusal) : null;
          /* `proves`: whether this refusal establishes that THIS request id can never be sent (a losing
             duplicate's refusal proves nothing about the winner). `code`/`recorded`: a stale request of a
             finished or non-current operation gets that operation's recorded outcome, and writes nothing. */
          const cl = error instanceof CallLogNotSent ? error : null;
          result = json(refusal?.statusCode ?? 409, { ...(refusal?.body ?? {}), outcome: "not_sent", proves: cl?.proves ?? "nothing", ...(cl?.code ? { code: cl.code } : {}), ...(cl?.outcome ? { recorded: cl.outcome } : {}), error: refusal ? String(refusal.body.error) : (cl ? `${cl.message}; nothing was sent` : "Nothing was sent") });
        }
        // The GHL call may have been made: recorded as uncertain by runCallLogOwnedWrite.
        else result = json(409, { outcome: "indeterminate", error: error instanceof WriteUncertain ? error.message : "The call save may have reached GHL; it is unresolved" });
      }
    } else {
      try {
        const done = await perform();
        result = json(done.statusCode, done.body);
      } catch (error) {
        const refusal = refusalOf(error);
        if (refusal) result = json(refusal.statusCode, refusal.body);
        else throw error;
      }
    }
  } catch (error) {
    logWriteFailure(request, error);
    // A barrier-owned request only reaches here BEFORE runOwnedWrite (the lock
    // is held elsewhere, a fresh read failed, ...): provably nothing was sent.
    if (owned || callLogOwned) result = json(409, { outcome: "not_sent", ...(callLogOwned ? { proves: "nothing" } : {}), error: "Nothing was sent; the save could not start" });
    else if (error instanceof WriteUncertain) result = json(409, { outcome: "indeterminate", error: error.message });
    else result = json(409, { error: "Write refused or unconfirmed; refresh and inspect before retrying" });
  }
  let released: "released" | "release_unverified" | null = null;
  if (lock) released = await lock.release();
  return withLockWarning(result, released);
}

/** A refusal decided before any GHL write; keeps its original status and body. */
class RefusedBeforeSend extends Error {
  constructor(readonly statusCode: number, readonly body: Record<string, unknown>) { super(String(body.error ?? "Refused")); }
}
