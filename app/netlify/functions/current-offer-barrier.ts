/**
 * Board 15 / PR #126 stacked server PR -- the durable Current Offer barrier's
 * own endpoint (records and rules: lib/current-offer-barrier.ts).
 *
 *   GET  ?opportunityId=…   status, for any signed-in reader: "clear", or
 *                           "blocked" with each step's evidence. Read-only.
 *   POST {action:"begin", opportunityId, purpose, steps}
 *                           claims the deal's barrier BEFORE the browser sends
 *                           a Current Offer save (blur: one step; Confirm
 *                           Accept: offer, note, touch). Refused while any
 *                           barrier exists for the deal, from any session.
 *   POST {action:"reconcile", opportunityId}
 *                           evaluates the evidence: withdraws every step that
 *                           was never sent (it can then never be sent) and
 *                           clears only when every step is settled. A step
 *                           that may have reached GHL keeps the barrier --
 *                           this endpoint never clears on a GHL read, elapsed
 *                           time or anyone's say-so. There is no override.
 *
 * Writes require Brad's application write session and origin, exactly as
 * ghl-write. The opportunity's contact is read fresh from GHL (identity and
 * location checked by the existing boundary), and begin/reconcile run under
 * that contact's existing write lock. Nothing here writes to GHL.
 */
import { connectLambda, getStore } from "@netlify/blobs";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { requireAppWriter } from "./lib/app-write-auth";
import { readAuthRefusal } from "./lib/app-read-auth";
import { getConfig } from "../../shared/ghl-config";
import { configuredBoundary, WriteUncertain } from "./lib/ghl-write-boundary";
import { exact, identifier } from "./lib/write-contracts";
import { lockContact } from "./lib/write-receipts";
import {
  barrierScope, beginBarrier, reconcileBarrier, statusOf, validateSteps, describeBlocked, BarrierHeld,
  type BarrierState, type BarrierStore,
} from "./lib/current-offer-barrier";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });
const store = () => getStore("iaos-write-receipts") as unknown as BarrierStore;
const withMessage = (s: BarrierState) => (s.state === "clear" ? s : { ...s, message: describeBlocked(s) });

export const handler = async (event: any) => {
  const config = getConfig(process.env.IAOS_ENV);
  const scope = barrierScope(String(process.env.IAOS_ENV), config.locationId);

  if (event.httpMethod === "GET") {
    const refused = readAuthRefusal(event);
    if (refused) return refused;
    const params = event.queryStringParameters ?? {};
    const opp = params.opportunityId;
    try {
      if (Object.keys(params).length !== 1) throw new Error("Unexpected query");
      identifier(opp);
    } catch { return json(400, { error: "Invalid status request" }); }
    try {
      connectLambda(event);
      return json(200, withMessage(await statusOf(store(), scope, opp)));
    } catch {
      // Callers treat an unreadable status as blocked.
      return json(503, { error: "The Current Offer status could not be read" });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }

  let request: any;
  let begin: ReturnType<typeof validateSteps> | null = null;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request encoding or query");
    request = JSON.parse(event.body ?? "null");
    if (request?.action === "begin") { exact(request, ["action", "opportunityId", "purpose", "steps"]); begin = validateSteps(request.purpose, request.steps); }
    else if (request?.action === "reconcile") exact(request, ["action", "opportunityId"]);
    else throw new Error("Unknown action");
    identifier(request.opportunityId);
  } catch { return json(400, { error: "Invalid Current Offer barrier request" }); }

  let release: (() => Promise<void>) | undefined;
  try {
    connectLambda(event);
    const opportunity = await configuredBoundary().opportunity(request.opportunityId);
    try { release = await lockContact(opportunity.contactId); }
    catch (e) {
      if (e instanceof WriteUncertain) return json(409, { state: "in_progress", message: "Another write for this contact is in progress. Nothing was changed; use Check again in a moment." });
      throw e;
    }
    if (begin) {
      try {
        await beginBarrier(store(), scope, { opp: request.opportunityId, contactId: opportunity.contactId, purpose: begin.purpose, steps: begin.steps }, new Date().toISOString());
        return json(200, { state: "reserved" });
      } catch (e) {
        if (e instanceof BarrierHeld) return json(409, withMessage(e.status));
        throw e;
      }
    }
    return json(200, withMessage(await reconcileBarrier(store(), scope, request.opportunityId)));
  } catch {
    // Nothing is cleared and nothing is reserved on a failure; callers block.
    return json(503, { error: "The Current Offer barrier request could not be completed; nothing was sent to GHL" });
  } finally { if (release) await release(); }
};
