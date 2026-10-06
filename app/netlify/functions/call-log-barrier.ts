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
 *                                     settles a 558c666-format unfinished head
 *                                     only when its evidence settles.
 *   POST {action:"retry", contactId, operationId, slot, after}
 *                                     Retry notes / Retry last-touch time.
 *
 * The 558c666 request shapes (begin with purpose/steps; reconcile) are refused
 * (400): an older client stays blocked and sends nothing. Writes need Brad's
 * application write session and origin, and begin needs the Production write
 * scope a call-log write needs. The contact is read fresh from GHL (identity and
 * location checked) and every POST runs under that contact's write lock.
 * Nothing here writes to GHL.
 */
import { connectLambda, getStore } from "@netlify/blobs";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { requireAppWriter } from "./lib/app-write-auth";
import { readAuthRefusal } from "./lib/app-read-auth";
import { getConfig } from "../../shared/ghl-config";
import { configuredBoundary, WriteUncertain } from "./lib/ghl-write-boundary";
import { exact, identifier } from "./lib/write-contracts";
import { lockContact } from "./lib/write-receipts";
import { evaluateProductionGhlWriteScope, PRODUCTION_WRITE_SCOPE_REFUSAL } from "./lib/production-write-scope";
import type { BarrierStore } from "./lib/current-offer-barrier";
import {
  callLogScope, beginOperation, resumeOperation, retryAttempt, settleLegacy, statusByContact, statusByOperation,
  validateBegin, validateOperationId, CallLogHeld, ReservationMismatch, InvalidRequest, type Slot,
} from "./lib/call-log-barrier";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });
const store = () => getStore("iaos-write-receipts") as unknown as BarrierStore;
const UNKNOWN = { state: "unknown", error: "No such call save for this contact" };

export const handler = async (event: any) => {
  const config = getConfig(process.env.IAOS_ENV);
  const scope = callLogScope(String(process.env.IAOS_ENV), config.locationId);

  if (event.httpMethod === "GET") {
    const refused = readAuthRefusal(event);
    if (refused) return refused;
    const params = event.queryStringParameters ?? {};
    try {
      const keys = Object.keys(params).sort().join();
      if (keys !== "contactId" && keys !== "contactId,operationId") throw new Error("Unexpected query");
      identifier(params.contactId);
      if (params.operationId !== undefined) validateOperationId(params.operationId);
    } catch { return json(400, { error: "Invalid status request" }); }
    try {
      connectLambda(event);
      if (params.operationId === undefined) return json(200, await statusByContact(store(), scope, params.contactId));
      const v = await statusByOperation(store(), scope, params.contactId, params.operationId);
      return v ? json(200, v) : json(404, UNKNOWN);
    } catch {
      // Callers treat an unreadable status as blocked.
      return json(503, { error: "The call-log status could not be read" });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }

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

  // A reservation is only taken where the call-log writes themselves would be allowed.
  if (begin) {
    for (const probe of [
      { operation: "contact.callLogResult", targetId: request.contactId, args: { value: begin.result } },
      { operation: "note.create", targetId: request.contactId, args: { body: begin.body } },
    ]) {
      const scoped = evaluateProductionGhlWriteScope(config, probe);
      if (!scoped.ok) return json(403, { error: "Production write refused by the proof write scope", by: PRODUCTION_WRITE_SCOPE_REFUSAL, code: scoped.code });
    }
  }

  let release: (() => Promise<void>) | undefined;
  try {
    connectLambda(event);
    await configuredBoundary().contact(request.contactId);
    try { release = await lockContact(request.contactId); }
    catch (e) {
      if (e instanceof WriteUncertain) return json(409, { state: "in_progress", message: "Another write for this contact is in progress. Nothing was changed; use Check again in a moment." });
      throw e;
    }
    const now = new Date().toISOString();
    if (begin) {
      try { return json(200, await beginOperation(store(), scope, { contactId: request.contactId, op: begin.op, result: begin.result, body: begin.body }, now)); }
      catch (e) {
        if (e instanceof CallLogHeld) return json(409, { state: "held", current: e.status });
        if (e instanceof ReservationMismatch) return json(409, { state: "rejected", code: "reservation_mismatch", message: e.message });
        throw e;
      }
    }
    if (request.action === "resume" && request.legacy === true) return json(200, await settleLegacy(store(), scope, request.contactId));
    let v;
    try {
      v = request.action === "resume"
        ? await resumeOperation(store(), scope, request.contactId, request.operationId)
        : await retryAttempt(store(), scope, request.contactId, request.operationId, request.slot as Slot, request.after);
    } catch (e) {
      if (e instanceof InvalidRequest) return json(400, { error: e.message });
      throw e;
    }
    return v ? json(200, v) : json(404, UNKNOWN);
  } catch {
    // Nothing is released and nothing is created on a failure; callers stay blocked and may repeat the same request.
    return json(503, { error: "The call-log request could not be completed; nothing was sent to GHL" });
  } finally { if (release) await release(); }
};
