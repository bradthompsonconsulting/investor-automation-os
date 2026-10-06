/**
 * Board 15 / PR #131 -- the durable call-log ownership endpoint (records and
 * rules: lib/call-log-barrier.ts; lifecycle: docs/CALL_LOG_SAVE_LIFECYCLE.md).
 *
 *   GET  ?contactId=…       status, for any signed-in reader: "clear", or
 *                           "blocked" (pending | resumable | uncertain) with each
 *                           step's evidence. Read-only; no request ids.
 *   POST {action:"begin", contactId, purpose, result, body, steps}
 *                           claims the contact BEFORE the browser sends the
 *                           first call-log write. Refused while any attempt is
 *                           current for this contact, from any session.
 *   POST {action:"reconcile", contactId[, attempt]}
 *                           "Check again": releases a complete attempt;
 *                           withdraws never-sent steps and releases a pending or
 *                           stopped one; returns the ORIGINAL request ids of a
 *                           resumable one so it is finished with them; leaves an
 *                           uncertain one exactly as it is. No override.
 *
 * Writes require Brad's application write session and origin, exactly as
 * ghl-write, and the same Production write scope a call-log write needs. The
 * contact is read fresh from GHL (identity and location checked by the
 * existing boundary), and begin/reconcile run under that contact's existing
 * write lock. Nothing here writes to GHL.
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
  callLogScope, beginCallLog, reconcileCallLog, callLogStatus, validateBegin, describeCallLog, CallLogHeld, ReservationMismatch,
  type CallLogView,
} from "./lib/call-log-barrier";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });
const store = () => getStore("iaos-write-receipts") as unknown as BarrierStore;
const withMessage = <V extends CallLogView>(v: V) => (v.state === "clear" ? v : { ...v, message: describeCallLog(v) });

export const handler = async (event: any) => {
  const config = getConfig(process.env.IAOS_ENV);
  const scope = callLogScope(String(process.env.IAOS_ENV), config.locationId);

  if (event.httpMethod === "GET") {
    const refused = readAuthRefusal(event);
    if (refused) return refused;
    const params = event.queryStringParameters ?? {};
    try {
      if (Object.keys(params).length !== 1) throw new Error("Unexpected query");
      identifier(params.contactId);
    } catch { return json(400, { error: "Invalid status request" }); }
    try {
      connectLambda(event);
      return json(200, withMessage(await callLogStatus(store(), scope, params.contactId)));
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
    if (request?.action === "begin") { exact(request, ["action", "contactId", "purpose", "result", "body", "steps"]); begin = validateBegin(request.purpose, request.result, request.body, request.steps); }
    else if (request?.action === "reconcile") {
      // `attempt`: optional -- the first request id of the attempt a page is settling (scoped; never touches a newer one).
      if (Object.prototype.hasOwnProperty.call(request, "attempt")) { exact(request, ["action", "contactId", "attempt"]); identifier(request.attempt); }
      else exact(request, ["action", "contactId"]);
    }
    else throw new Error("Unknown action");
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
    if (begin) {
      try {
        await beginCallLog(store(), scope, { contactId: request.contactId, purpose: begin.purpose, result: begin.result, body: begin.body, steps: begin.steps }, new Date().toISOString());
        return json(200, { state: "reserved" });
      } catch (e) {
        if (e instanceof CallLogHeld) return json(409, withMessage(e.status));
        if (e instanceof ReservationMismatch) return json(409, { state: "rejected", code: "reservation_mismatch", message: e.message });
        throw e;
      }
    }
    const r = await reconcileCallLog(store(), scope, request.contactId, request.attempt);
    return json(200, r.state === "clear" ? r : withMessage(r));
  } catch {
    // Nothing is released and nothing is reserved on a failure; callers stay blocked.
    return json(503, { error: "The call-log request could not be completed; nothing was sent to GHL" });
  } finally { if (release) await release(); }
};
