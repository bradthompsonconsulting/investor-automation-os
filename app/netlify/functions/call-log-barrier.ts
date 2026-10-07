/**
 * Board 15 / PR #131 -- the durable call-log OPERATION endpoint (approved
 * lifecycle v3, #issuecomment-6023481488; records and rules in
 * lib/call-log-barrier.ts; map in docs/CALL_LOG_SAVE_LIFECYCLE.md).
 *
 *   GET  ?contactId=…                 the contact's open operation, or clear
 *                                     (read session). Finalizes only what the
 *                                     evidence already settles.
 *   GET  ?contactId=…&operationId=…   ONE operation by its ORIGINAL id: how a
 *                                     delayed response, a stale page or another
 *                                     tab learns that operation's outcome.
 *   POST {action:"begin", contactId, operationId, result, body}
 *                                     a NEW call; refused while the contact has
 *                                     an open operation. A begin of a FINISHED
 *                                     operation returns its recorded outcome.
 *   POST {action:"resume", contactId, operationId}
 *                                     "Check again": never creates an attempt.
 *   POST {action:"resume", contactId, legacy:true}
 *                                     reports a legacy (pre-v2) block; never clears it.
 *   POST {action:"retry", contactId, operationId, slot, after}
 *                                     Retry notes / Retry last-touch time.
 *   POST {action:"storage_capability"[, nonce]}
 *                                     read-only storage diagnostic (plan v6 §6).
 *
 * Storage correction (plan v6 §5): modern runtime; every POST passes the write
 * gate (published production deploy, captured activation echoed by the page,
 * kill switch, G5, legacy block); the contact lock is lock v2 with a visible,
 * durable `release_unverified`; ids are `v2-` only. Status reads carry the
 * activation id the page echoes and the durable lock state. Nothing here writes
 * to GHL.
 */
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { requireAppWriter } from "./lib/app-write-auth";
import { readAuthRefusal } from "./lib/app-read-auth";
import { exact, identifier } from "./lib/write-contracts";
import { evaluateProductionGhlWriteScope, PRODUCTION_WRITE_SCOPE_REFUSAL } from "./lib/production-write-scope";
import {
  callLogScope, beginOperation, resumeOperation, retryAttempt, statusByContact, statusByOperation, confirmedRequestDigests, hasFinal,
  validateBegin, validateOperationId, CallLogHeld, ReservationMismatch, InvalidRequest, type Slot,
} from "./lib/call-log-barrier";
import { legacyEventFrom, toResponse, json, echoedActivation, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { invocation, readBoundaryFor, refusalResult, sessionCapabilityBranch, lockRefusal, withLockWarning, legacyBlocked, logCatchAll, LOCK_MESSAGES, type Invocation } from "./lib/endpoint-kit";
import { WriteRefused, currentActivationId, MESSAGES } from "./lib/write-gate";
import { acquireLock, lockKey, readLockStatus, recoverLockForOperation, LockHeld, type ContactLock } from "./lib/contact-lock-v2";
import { recoverTickets } from "./lib/admission";
import { fieldEffects } from "./lib/g5-gate";
import { semanticFields } from "./lib/ghl-write-boundary";
import { isV2Id } from "./lib/cutover";

const UNKNOWN = { state: "unknown", error: "No such call save for this contact" };

/** The effect classes of a call-log operation on its contact (G5 overlap). */
function callLogEffects(inv: Invocation): string[] {
  const s = semanticFields(inv.config);
  return [...new Set(["note", ...fieldEffects([...s.callResult, ...s.lastTouch], s)])].sort();
}

export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true });
  const inv = invocation("call-log-barrier", context);
  let header: Record<string, string> | undefined;
  try {
    const r = await handle(event, inv, (h) => { header = { "X-IAOS-Storage": h }; });
    return toResponse(r, header);
  } finally { inv.scope.close(); }
};

async function handle(event: LegacyEvent, inv: Invocation, setStorageHeader: (h: string) => void): Promise<LambdaResult> {
  const scope = callLogScope(inv.env, inv.config.locationId);

  if (event.httpMethod === "GET") {
    const refused = readAuthRefusal(event);
    if (refused) return refused as LambdaResult;
    const params = event.queryStringParameters ?? {};
    try {
      if (event.isBase64Encoded) throw new Error("Unexpected query");
      const keys = Object.keys(params).sort().join();
      if (keys !== "contactId" && keys !== "contactId,operationId") throw new Error("Unexpected query");
      identifier(params.contactId);
      if (params.operationId !== undefined) validateOperationId(params.operationId);
    } catch { return json(400, { error: "Invalid status request" }); }
    try {
      const subject = `contact:${params.contactId}`;
      const [activationId, blocked] = await Promise.all([currentActivationId(inv.store, inv.deploy.id), legacyBlocked(inv, subject)]);
      const lock = await readLockStatus(inv.store, lockKey(inv.env, inv.config.locationId, params.contactId), blocked);
      const extra = { activationId, lock: lock.status, ...(lock.status !== "free" ? { lockMessage: LOCK_MESSAGES[lock.status] } : {}), ...(blocked ? { legacyBlocked: true, legacyMessage: MESSAGES.legacy_blocked } : {}) };
      if (params.operationId === undefined) return json(200, { ...(await statusByContact(inv.store, scope, params.contactId)), ...extra });
      const v = await statusByOperation(inv.store, scope, params.contactId, params.operationId);
      return v ? json(200, { ...v, ...extra }) : json(404, UNKNOWN);
    } catch {
      logCatchAll(inv, "status");
      // Callers treat an unreadable status as blocked.
      return json(503, { error: "The call-log status could not be read" });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }

  const cap = await sessionCapabilityBranch(event, inv);
  if (cap) { if (cap.header) setStorageHeader(cap.header); return cap.result; }

  let request: any;
  let begin: ReturnType<typeof validateBegin> | null = null;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request encoding or query");
    request = JSON.parse(event.body ?? "null");
    if (request?.action === "begin") { exact(request, ["action", "contactId", "operationId", "result", "body"]); begin = validateBegin(request.operationId, request.result, request.body); }
    else if (request?.action === "resume" && request.legacy === true) exact(request, ["action", "contactId", "legacy"]);
    else if (request?.action === "resume") { exact(request, ["action", "contactId", "operationId"]); validateOperationId(request.operationId); }
    else if (request?.action === "retry") {
      exact(request, ["action", "contactId", "operationId", "slot", "after"]);
      validateOperationId(request.operationId);
      if (request.slot !== "note" && request.slot !== "touch") throw new Error("Only a note or the last touch is retried");
      if (!Number.isInteger(request.after) || request.after < 1) throw new Error("Invalid attempt");
    } else throw new Error("Unknown action");
    identifier(request.contactId);
  } catch { return json(400, { error: "Invalid call-log request" }); }
  // Legacy (non-v2) operation ids are refused permanently, before any I/O (plan v6 §9.3).
  if (request.operationId !== undefined && !isV2Id(request.operationId)) return json(400, { error: "Invalid call-log request", code: "legacy_id_refused" });

  // A reservation is only taken where the call-log writes themselves would be allowed.
  if (begin) {
    for (const probe of [
      { operation: "contact.callLogResult", targetId: request.contactId, args: { value: begin.result } },
      { operation: "note.create", targetId: request.contactId, args: { body: begin.body } },
    ]) {
      const scoped = evaluateProductionGhlWriteScope(inv.config, probe);
      if (!scoped.ok) return json(403, { error: "Production write refused by the proof write scope", by: PRODUCTION_WRITE_SCOPE_REFUSAL, code: scoped.code });
    }
  }
  // A legacy block is reported, never cleared (plan v6 §4.3, §9).
  if (request.action === "resume" && request.legacy === true) {
    try { return json(200, (await legacyBlocked(inv, `contact:${request.contactId}`)) ? { state: "legacy", message: MESSAGES.legacy_blocked } : { state: "clear" }); }
    catch { return json(503, { error: "The call-log request could not be completed; nothing was sent to GHL" }); }
  }

  let lock: ContactLock | null = null;
  let result: LambdaResult;
  try {
    // The write gate (plan v6 §8.1 M4): deploy, captured activation (echoed), kill switch, G5 and legacy block.
    await inv.gate.enter(echoedActivation(event));
    await inv.gate.checkSubject(`contact:${request.contactId}`, callLogEffects(inv));
    await readBoundaryFor(inv).contact(request.contactId);
    const key = lockKey(inv.env, inv.config.locationId, request.contactId);
    const take = () => acquireLock(inv.store, inv.scope, key, { opId: request.operationId ?? null, deployId: inv.deploy.id! });
    try { lock = await take(); }
    catch (e) {
      // Same-operation recovery ONLY: a lock left by THIS operation, whose final record is verified.
      if (e instanceof LockHeld && e.status === "held_release_unverified" && request.action === "resume" && typeof request.operationId === "string"
          && (await recoverCallLogLock(inv, request.contactId, request.operationId)) === "released") {
        try { lock = await take(); } catch (e2) { const r = lockRefusal(e2); if (r) return r; throw e2; }
      } else { const r = lockRefusal(e); if (r) return r; throw e; }
    }
    const now = new Date().toISOString();
    if (begin) {
      try { result = json(200, await beginOperation(inv.store, scope, { contactId: request.contactId, op: begin.op, result: begin.result, body: begin.body }, now)); }
      catch (e) {
        if (e instanceof CallLogHeld) result = json(409, { state: "held", current: e.status });
        else if (e instanceof ReservationMismatch) result = json(409, { state: "rejected", code: "reservation_mismatch", message: e.message });
        else throw e;
      }
    } else {
      let v;
      try {
        v = request.action === "resume"
          ? await resumeOperation(inv.store, scope, request.contactId, request.operationId)
          : await retryAttempt(inv.store, scope, request.contactId, request.operationId, request.slot as Slot, request.after);
      } catch (e) {
        if (e instanceof InvalidRequest) { result = json(400, { error: e.message }); v = undefined; }
        else throw e;
      }
      if (v !== undefined) result = v ? json(200, v) : json(404, UNKNOWN);
      // Same-operation recovery: tickets of THIS operation's CONFIRMED attempts only.
      if (request.action === "resume") {
        const confirmed = await confirmedRequestDigests(inv.store, scope, request.operationId).catch(() => new Set<string>());
        if (confirmed.size) await recoverTickets(inv.store, (t) => t.opId === request.operationId, async (t) => confirmed.has(t.requestDigest)).catch(() => 0);
      }
    }
  } catch (e) {
    if (e instanceof WriteRefused) return refusalResult(e);
    logCatchAll(inv, request.action);
    // Nothing is released and nothing is created on a failure; callers stay blocked and may repeat the same request.
    result = json(503, { error: "The call-log request could not be completed; nothing was sent to GHL" });
  }
  let released: "released" | "release_unverified" | null = null;
  if (lock) released = await lock.release();
  return withLockWarning(result!, released);
}

/** Same-operation lock recovery for a FINISHED operation: needs its verified final record. */
async function recoverCallLogLock(inv: Invocation, contactId: string, op: string) {
  const scope = callLogScope(inv.env, inv.config.locationId);
  const finalVerified = await hasFinal(inv.store, scope, op).catch(() => false);
  return recoverLockForOperation(inv.store, inv.scope, lockKey(inv.env, inv.config.locationId, contactId), op, finalVerified);
}
