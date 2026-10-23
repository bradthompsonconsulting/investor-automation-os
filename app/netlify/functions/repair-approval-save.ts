/**
 * Repair-save completion integration -- the save (B15-26 B1; contracts
 * r1-r5.1, accepted; whole-save deadline per proposal r3 + r4 + erratum 1).
 * DEFAULT-DISABLED.
 *
 * POST { opportunityId, requestId, answers, misc }. Nothing else is accepted:
 * the total, completeness, line count and basis digest are recomputed here
 * from the answers; the contact is derived from the Opportunity read; the
 * operator is the authenticated application writer.
 *
 * Order (the first refusal ends the request; nothing after it runs):
 *   not active in this environment (switch off, or IAOS_ENV not Test) -> 404
 *     (before auth or I/O)
 *   method, write session, write origin
 *   configuration gate (test only, provisioned approval field, authority
 *     credentials) -> 503 not_sent; never a fallback write
 *   request shape, answers shape -> 400
 *   server recompute: incomplete -> 422 not_sent (never admitted)
 *   runtime budget missing or invalid -> 503 not_sent runtime_budget_unavailable;
 *     claim floor not met -> 503 not_sent deadline_before_start (both before
 *     any provider I/O)
 *   recorded claim (claimWriteRecorded): 412 -> 409 not_sent duplicate_request;
 *     anything but one real 2xx -> 503 not_sent claim_unavailable (the receipt
 *     may exist; never retried or deleted)
 *   Opportunity read (bounded: boundary.opportunity() makes the Opportunity GET
 *     and the derived-contact GET, each with its own capped timer covering its
 *     body, so the stage can take up to two caps) -> contact derived; prior
 *     binding values
 *   admission floor -> 503 not_sent deadline_before_admission; openAdmission
 *   dispatchNote -> dispatchFields -> verifyRepairTarget (<=3 passes, module
 *     budget, pass floor) -> CLOSE floor -> closeVerified
 *
 * Deadline: start + min(budget, remaining runtime - response reserve). It is
 * enforced by gates and per-request timers, never by racing a pending step:
 * every step is awaited until its own requests have settled. The authority
 * client and the target transport carry the deadline, so no request starts
 * after it, and no write starts unless its full cap fits (module M1-M3).
 * Running short after admission ends blocked, never released or verified.
 *
 * Outcomes use only accepted wording: READER_TEXT.checked / needsReview,
 * PROVISIONAL_HEADLINE, and ghl-write's "Nothing was sent; the save could not
 * start" (which refers to GHL and the repair authority; a claim_unavailable
 * claim may have written to the claim store). An uncertain or unbound write, a
 * HOLD, or an unresolved CLOSE is "Repair save needs review. Do not retry this
 * approval." and stays blocked: no retry, no release. The single exception is
 * the accepted zero-send abandonment (r2 §3 / r3 C2): a note dispatch the
 * module reports not_sent is followed by exactly one abandonUndispatched.
 */
import { connectLambda } from "@netlify/blobs";
import { getConfig } from "../../shared/ghl-config";
import { REPAIR_APPROVAL_CONFIG, REPAIR_APPROVAL_DISABLED, repairApprovalActiveFor } from "../../shared/repair-approval-config";
import { PROVISIONAL_HEADLINE } from "../../src/lib/provisional-repairs";
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import {
  READER_TEXT, abandonUndispatched, closeVerified, createAuthorityClient, createProductionTargetTransport,
  dispatchFields, dispatchNote, openAdmission, verifyRepairTarget,
} from "./lib/blob-authority";
import { configuredBoundary, fieldValue } from "./lib/ghl-write-boundary";
import {
  approvalScope, approvalSetup, boundedFetch, parseSubmittedAnswers, preconditionDigest, recomputeRepairs, remainingRuntimeMs, saveDeadline, sleep,
} from "./lib/repair-approval-integration";
import { payloadDigest, validatePayload } from "./lib/repair-evidence";
import { exact, identifier } from "./lib/write-contracts";
import { claimWriteRecorded } from "./lib/write-receipts";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });
const NOTHING_SENT = "Nothing was sent; the save could not start";
const notSent = (code: string) => json(503, { outcome: "not_sent", code, error: NOTHING_SENT });
const blocked = (code: string) => json(409, { outcome: "blocked", code, text: READER_TEXT.needsReview });

export const handler = async (event: any, context?: unknown) => {
  if (!repairApprovalActiveFor(process.env.IAOS_ENV)) return json(404, { error: "Not found", by: REPAIR_APPROVAL_DISABLED });
  // Read once, at entry: the deadline is measured from here.
  const start = Date.now();
  const remaining0 = remainingRuntimeMs(context);
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let operator: string;
  try { operator = requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }

  const setup = approvalSetup();
  if (setup.kind !== "ready") return json(503, { outcome: "not_sent", code: setup.code, error: NOTHING_SENT });

  let request: any; let submitted: ReturnType<typeof parseSubmittedAnswers>;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request encoding or query");
    request = JSON.parse(event.body ?? "null");
    exact(request, ["opportunityId", "requestId", "answers", "misc"]);
    identifier(request.opportunityId); identifier(request.requestId);
    submitted = parseSubmittedAnswers(request.answers, request.misc);
  } catch { return json(400, { outcome: "not_sent", error: "Invalid repair approval request" }); }

  // T0: server recompute. Incomplete or invalid estimates never reach admission.
  const recomputed = recomputeRepairs(submitted.answers, submitted.misc);
  if (recomputed.kind === "incomplete") return json(422, { outcome: "not_sent", code: "incomplete", text: PROVISIONAL_HEADLINE });
  if (recomputed.kind !== "complete") return json(400, { outcome: "not_sent", error: "Invalid repair approval request" });

  // Deadline (r3 §2): no runtime budget, no save -- refused before any provider I/O, with no fallback budget.
  const D = REPAIR_APPROVAL_CONFIG.saveDeadline;
  if (remaining0 === null) return notSent("runtime_budget_unavailable");
  const deadline = saveDeadline(start, remaining0, D);
  const left = () => deadline - Date.now();
  if (left() < D.floorsMs.claim) return notSent("deadline_before_start");

  const config = getConfig(process.env.IAOS_ENV);
  const opportunityId: string = request.opportunityId;
  let admitted = false;
  try {
    connectLambda(event);
    // A request id is used at most once, decided from the recorded real claim request only.
    const claim = await claimWriteRecorded(`${operator}:repair.approval:${opportunityId}`, request.requestId, { opportunityId, basisDigest: recomputed.basisDigest },
      { deadline, capMs: D.claimTimeoutMs, minStartMs: D.minStartMs });
    if (claim.kind === "duplicate") return json(409, { outcome: "not_sent", code: "duplicate_request", error: NOTHING_SENT });
    if (claim.kind !== "claimed") return notSent("claim_unavailable");

    // The contact is DERIVED from the Opportunity (never a client field); location and contact are checked by the boundary.
    if (left() < D.floorsMs.opportunityRead) return notSent("deadline_before_start");
    const read = boundedFetch(D.opportunityReadTimeoutMs, deadline, D.minStartMs);
    let opportunity: any;
    try { opportunity = await configuredBoundary(undefined, read.fetch).opportunity(opportunityId); } finally { read.settle(); }
    const contactId: string = opportunity.contactId;
    const prior = {
      estimate: fieldValue(opportunity.customFields, config.opportunityFacts.repairs, "opportunity").value,
      approval: fieldValue(opportunity.customFields, setup.approvalFieldId, "opportunity").value,
    };
    const payload = validatePayload({ opportunityId, contactId, operator, total: recomputed.total, complete: true, lineCount: recomputed.lineCount, basisDigest: recomputed.basisDigest });
    if (!payload) return json(400, { outcome: "not_sent", error: "Invalid repair approval request" });

    const client = createAuthorityClient({
      siteID: setup.siteID, token: setup.token, timeoutMs: D.authorityTimeoutMs, deadline, minStartMs: D.minStartMs,
      releaseReserveMs: D.releaseReserveMs, closeReserveMs: D.closeReserveMs, sendFloorsMs: { note: D.floorsMs.notePost, fields: D.floorsMs.fieldsPut },
    });
    const transport = createProductionTargetTransport({ fieldIds: { repairEstimate: config.opportunityFacts.repairs, repairApprovalId: setup.approvalFieldId }, timeoutMs: D.ghlWriteTimeoutMs, readTimeoutMs: D.ghlReadTimeoutMs });
    const scope = approvalScope(setup.env, config.locationId, opportunityId);

    // Admission only with the release reserve still available after open and the note's D1 read (r3 §3/§4).
    if (left() < D.floorsMs.admission) return notSent("deadline_before_admission");
    const open = await openAdmission(client, scope, { operator, opportunityId, contactId, preconditionDigest: preconditionDigest(contactId, prior.estimate, prior.approval), expectedResultHash: payloadDigest(payload) });
    if (open.kind === "refused" && open.reason === "scope_blocked") return blocked("scope_blocked");
    if (open.kind === "ambiguous") return blocked("admission_ambiguous");
    if (open.kind !== "committed") return json(503, { outcome: "not_sent", code: `admission_${open.kind}`, error: NOTHING_SENT });
    admitted = true;

    const note = await dispatchNote(open.admission, transport, payload);
    if (note.kind === "not_sent") {
      // Accepted zero-send abandonment (r2 §3, r3 C2): the module proves no TARGET request was sent. It runs within
      // the reserved time; its own requests obey the deadline, and if it cannot complete the admission stays blocking.
      const released = await abandonUndispatched(open.admission);
      if (released.kind === "released") return json(503, { outcome: "not_sent", code: "note_not_sent", error: NOTHING_SENT });
      return blocked(released.kind === "release_unknown" ? "release_unknown" : `release_${released.kind}`);
    }
    if (note.kind !== "definite") return blocked(`note_${note.kind}`);

    const fields = await dispatchFields(open.admission, payload);
    if (fields.kind !== "definite") return blocked(`fields_${fields.kind}`);

    let token = null;
    for (let pass = 1; pass <= 3 && token === null; pass++) {
      if (left() < D.floorsMs.verifyPass) return blocked("deadline_verify");
      const v = await verifyRepairTarget(open.admission, payload);
      if (v.kind === "verified") token = v.token;
      else if (v.kind === "pending") {
        if (left() < REPAIR_APPROVAL_CONFIG.verifyPassDelayMs + D.floorsMs.verifyPass) return blocked("deadline_verify");
        await sleep(REPAIR_APPROVAL_CONFIG.verifyPassDelayMs);
      } else return blocked(`verify_${v.kind}`);
    }
    if (token === null) return blocked("verify_no_token");

    if (left() < D.floorsMs.close) return blocked("deadline_before_close");
    const closed = await closeVerified(token);
    if (closed.kind !== "committed") return blocked(`close_${closed.kind}`);
    return json(200, { outcome: "verified", total: payload.total, text: READER_TEXT.checked(new Date().toISOString()) });
  } catch {
    // Before admission nothing was sent to GHL or the authority (the Opportunity read failed).
    if (!admitted) return json(503, { outcome: "not_sent", code: "could_not_start", error: NOTHING_SENT });
    // After admission the scope stays ADMITTED: it blocks (P-D); nothing here releases it.
    return blocked("exception");
  }
};
