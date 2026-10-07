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
 *   POST {action:"storage_capability"[, nonce]}
 *                           read-only storage diagnostic (plan v6 §6).
 *
 * Writes require Brad's application write session and origin, exactly as
 * ghl-write. The opportunity's contact is read fresh from GHL (identity and
 * location checked by the existing boundary), and begin/reconcile run under
 * that contact's lock. Nothing here writes to GHL.
 *
 * Storage correction (plan v6 §5): modern runtime; the write gate (published
 * production deploy, captured and echoed activation, kill switch, G5, legacy
 * block) runs before any ownership mutation; lock v2 with a visible
 * `release_unverified`; request ids are `v2-` only; status reads carry the
 * activation id and the durable lock state.
 */
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { requireAppWriter } from "./lib/app-write-auth";
import { readAuthRefusal } from "./lib/app-read-auth";
import { exact, identifier } from "./lib/write-contracts";
import {
  barrierScope, beginBarrier, reconcileBarrier, statusOf, validateSteps, describeBlocked, confirmedStepDigests, BarrierHeld, ReservationMismatch,
  PURPOSE_STEPS, type BarrierState, type BarrierPurpose,
} from "./lib/current-offer-barrier";
import { legacyEventFrom, toResponse, json, echoedActivation, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { invocation, readBoundaryFor, refusalResult, sessionCapabilityBranch, lockRefusal, withLockWarning, legacyBlocked, logCatchAll, type Invocation } from "./lib/endpoint-kit";
import { WriteRefused, currentActivationId, MESSAGES } from "./lib/write-gate";
import { acquireLock, lockKey, type ContactLock } from "./lib/contact-lock-v2";
import { recoverTickets } from "./lib/admission";
import { fieldEffects } from "./lib/g5-gate";
import { semanticFields } from "./lib/ghl-write-boundary";
import { isV2Id } from "./lib/cutover";

const withMessage = (s: BarrierState) => (s.state === "clear" ? s : { ...s, message: describeBlocked(s) });

/** The (subject, effects) a reservation of this purpose can touch (G5 overlap). */
function reservationSubjects(inv: Invocation, purpose: BarrierPurpose, opp: string, contactId: string): { subject: string; effects: string[] }[] {
  const s = semanticFields(inv.config);
  const steps = PURPOSE_STEPS[purpose];
  const out: { subject: string; effects: string[] }[] = [];
  if (steps.includes("offer")) out.push({ subject: `opportunity:${opp}`, effects: fieldEffects(s.offerValue, s) });
  const contactEffects = new Set<string>();
  if (steps.includes("note") || steps.includes("callback_note")) contactEffects.add("note");
  if (steps.includes("touch")) fieldEffects(s.lastTouch, s).forEach((e) => contactEffects.add(e));
  if (steps.includes("callback")) { const c: any = inv.config.fields; [c.callbackDatetime, c.callbackDatetimePrecise].filter(Boolean).forEach((id: string) => contactEffects.add(`custom_field:${id}`)); }
  if (contactEffects.size) out.push({ subject: `contact:${contactId}`, effects: [...contactEffects].sort() });
  return out;
}

export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true });
  const inv = invocation("current-offer-barrier", context);
  let header: Record<string, string> | undefined;
  try {
    const r = await handle(event, inv, (h) => { header = { "X-IAOS-Storage": h }; });
    return toResponse(r, header);
  } finally { inv.scope.close(); }
};

async function handle(event: LegacyEvent, inv: Invocation, setStorageHeader: (h: string) => void): Promise<LambdaResult> {
  const scope = barrierScope(inv.env, inv.config.locationId);

  if (event.httpMethod === "GET") {
    const refused = readAuthRefusal(event);
    if (refused) return refused as LambdaResult;
    const params = event.queryStringParameters ?? {};
    const opp = params.opportunityId;
    try {
      if (event.isBase64Encoded) throw new Error("Unexpected query");
      if (Object.keys(params).length !== 1) throw new Error("Unexpected query");
      identifier(opp);
    } catch { return json(400, { error: "Invalid status request" }); }
    try {
      const [state, activationId, blocked] = await Promise.all([statusOf(inv.store, scope, opp), currentActivationId(inv.store, inv.deploy.id), legacyBlocked(inv, `opportunity:${opp}`)]);
      return json(200, { ...withMessage(state), activationId, ...(blocked ? { legacyBlocked: true, legacyMessage: MESSAGES.legacy_blocked } : {}) });
    } catch {
      logCatchAll(inv, "status");
      // Callers treat an unreadable status as blocked.
      return json(503, { error: "The Current Offer status could not be read" });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }

  const cap = await sessionCapabilityBranch(event, inv);
  if (cap) { if (cap.header) setStorageHeader(cap.header); return cap.result; }

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
  // Legacy (non-v2) request ids are refused permanently, before any I/O (plan v6 §9.3).
  if (begin && begin.steps.some((s) => !isV2Id(s.requestId))) return json(400, { error: "Invalid Current Offer barrier request", code: "legacy_id_refused" });

  let lock: ContactLock | null = null;
  let result: LambdaResult;
  try {
    await inv.gate.enter(echoedActivation(event));
    const opportunity = await readBoundaryFor(inv).opportunity(request.opportunityId);
    const purpose: BarrierPurpose = begin ? begin.purpose : "accept";
    for (const s of reservationSubjects(inv, purpose, request.opportunityId, opportunity.contactId)) await inv.gate.checkSubject(s.subject, s.effects);
    try { lock = await acquireLock(inv.store, inv.scope, lockKey(inv.env, inv.config.locationId, opportunity.contactId), { opId: null, deployId: inv.deploy.id! }); }
    catch (e) { const r = lockRefusal(e); if (r) return r; throw e; }
    if (begin) {
      try {
        await beginBarrier(inv.store, scope, { opp: request.opportunityId, contactId: opportunity.contactId, purpose: begin.purpose, steps: begin.steps }, new Date().toISOString());
        result = json(200, { state: "reserved" });
      } catch (e) {
        if (e instanceof BarrierHeld) result = json(409, withMessage(e.status));
        // An altered repeat of a reservation, or a request id reserved elsewhere: nothing was registered.
        else if (e instanceof ReservationMismatch) result = json(409, { state: "rejected", code: "reservation_mismatch", message: e.message });
        else throw e;
      }
    } else {
      // Same-operation recovery first: tickets of the CURRENT barrier's CONFIRMED steps only.
      const { barrierId, digests } = await confirmedStepDigests(inv.store, scope, request.opportunityId).catch(() => ({ barrierId: null, digests: new Set<string>() }));
      if (barrierId && digests.size) await recoverTickets(inv.store, (t) => t.opId === barrierId, async (t) => digests.has(t.requestDigest)).catch(() => 0);
      result = json(200, withMessage(await reconcileBarrier(inv.store, scope, request.opportunityId)));
    }
  } catch (e) {
    if (e instanceof WriteRefused) return refusalResult(e);
    logCatchAll(inv, request.action);
    // Nothing is cleared and nothing is reserved on a failure; callers block.
    result = json(503, { error: "The Current Offer barrier request could not be completed; nothing was sent to GHL" });
  }
  let released: "released" | "release_unverified" | null = null;
  if (lock) released = await lock.release();
  return withLockWarning(result!, released);
}
