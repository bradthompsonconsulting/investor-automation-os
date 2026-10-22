/**
 * Repair-save completion integration -- the save (B15-26 B1; contracts
 * r1-r5.1, accepted; module ea525f6 unchanged). DEFAULT-DISABLED.
 *
 * POST { opportunityId, requestId, answers, misc }. Nothing else is accepted:
 * the total, completeness, line count and basis digest are recomputed here
 * from the answers; the contact is derived from the Opportunity read; the
 * operator is the authenticated application writer.
 *
 * Order (the first refusal ends the request; nothing after it runs):
 *   disabled -> 404 (before auth or I/O)
 *   method, write session, write origin
 *   configuration gate (test only, provisioned approval field, authority
 *     credentials) -> 503 not_sent; never a fallback write
 *   request shape, answers shape -> 400
 *   server recompute: incomplete -> 422 not_sent (never admitted)
 *   duplicate request id (claimWrite) -> 409 not_sent
 *   Opportunity read -> contact derived; prior binding values (precondition)
 *   openAdmission (one operation per opportunity)
 *   dispatchNote -> dispatchFields -> verifyRepairTarget (<=3 passes, module
 *     budget) -> closeVerified
 * Outcomes use only accepted wording: READER_TEXT.checked / needsReview,
 * PROVISIONAL_HEADLINE, and ghl-write's "Nothing was sent; the save could not
 * start". An uncertain or unbound write, a HOLD, or an unresolved CLOSE is
 * "Repair save needs review. Do not retry this approval." and stays blocked:
 * no retry, no release, no timeout. The single exception is the accepted
 * zero-send abandonment (r2 §3 / r3 C2): a note dispatch the module reports
 * not_sent is followed by exactly one abandonUndispatched.
 */
import { connectLambda } from "@netlify/blobs";
import { getConfig } from "../../shared/ghl-config";
import { REPAIR_APPROVAL_CONFIG, REPAIR_APPROVAL_DISABLED } from "../../shared/repair-approval-config";
import { PROVISIONAL_HEADLINE } from "../../src/lib/provisional-repairs";
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import {
  READER_TEXT, abandonUndispatched, closeVerified, createAuthorityClient, createProductionTargetTransport,
  dispatchFields, dispatchNote, openAdmission, verifyRepairTarget,
} from "./lib/blob-authority";
import { configuredBoundary, fieldValue } from "./lib/ghl-write-boundary";
import { approvalScope, approvalSetup, parseSubmittedAnswers, preconditionDigest, recomputeRepairs, sleep } from "./lib/repair-approval-integration";
import { payloadDigest, validatePayload } from "./lib/repair-evidence";
import { exact, identifier } from "./lib/write-contracts";
import { claimWrite } from "./lib/write-receipts";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });
const NOTHING_SENT = "Nothing was sent; the save could not start";
const blocked = (code: string) => json(409, { outcome: "blocked", code, text: READER_TEXT.needsReview });

export const handler = async (event: any) => {
  if (!REPAIR_APPROVAL_CONFIG.enabled) return json(404, { error: "Not found", by: REPAIR_APPROVAL_DISABLED });
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

  const config = getConfig(process.env.IAOS_ENV);
  const opportunityId: string = request.opportunityId;
  let admitted = false;
  try {
    connectLambda(event);
    // A request id is used at most once: a resubmitted request never reaches GHL again.
    try { await claimWrite(`${operator}:repair.approval:${opportunityId}`, request.requestId, { opportunityId, basisDigest: recomputed.basisDigest }); }
    catch { return json(409, { outcome: "not_sent", code: "duplicate_request", error: NOTHING_SENT }); }

    // The contact is DERIVED from the Opportunity (never a client field); location and contact are checked by the boundary.
    const boundary = configuredBoundary();
    const opportunity = await boundary.opportunity(opportunityId);
    const contactId: string = opportunity.contactId;
    const prior = {
      estimate: fieldValue(opportunity.customFields, config.opportunityFacts.repairs, "opportunity").value,
      approval: fieldValue(opportunity.customFields, setup.approvalFieldId, "opportunity").value,
    };
    const payload = validatePayload({ opportunityId, contactId, operator, total: recomputed.total, complete: true, lineCount: recomputed.lineCount, basisDigest: recomputed.basisDigest });
    if (!payload) return json(400, { outcome: "not_sent", error: "Invalid repair approval request" });

    const client = createAuthorityClient({ siteID: setup.siteID, token: setup.token });
    const transport = createProductionTargetTransport({ fieldIds: { repairEstimate: config.opportunityFacts.repairs, repairApprovalId: setup.approvalFieldId } });
    const scope = approvalScope(setup.env, config.locationId, opportunityId);

    const open = await openAdmission(client, scope, { operator, opportunityId, contactId, preconditionDigest: preconditionDigest(contactId, prior.estimate, prior.approval), expectedResultHash: payloadDigest(payload) });
    if (open.kind === "refused" && open.reason === "scope_blocked") return blocked("scope_blocked");
    if (open.kind === "ambiguous") return blocked("admission_ambiguous");
    if (open.kind !== "committed") return json(503, { outcome: "not_sent", code: `admission_${open.kind}`, error: NOTHING_SENT });
    admitted = true;

    const note = await dispatchNote(open.admission, transport, payload);
    if (note.kind === "not_sent") {
      // Accepted zero-send abandonment (r2 §3, r3 C2): the module proves no TARGET request was sent.
      const released = await abandonUndispatched(open.admission);
      if (released.kind === "released") return json(503, { outcome: "not_sent", code: "note_not_sent", error: NOTHING_SENT });
      return blocked(released.kind === "release_unknown" ? "release_unknown" : `release_${released.kind}`);
    }
    if (note.kind !== "definite") return blocked(`note_${note.kind}`);

    const fields = await dispatchFields(open.admission, payload);
    if (fields.kind !== "definite") return blocked(`fields_${fields.kind}`);

    let token = null;
    for (let pass = 1; pass <= 3 && token === null; pass++) {
      const v = await verifyRepairTarget(open.admission, payload);
      if (v.kind === "verified") token = v.token;
      else if (v.kind === "pending") await sleep(REPAIR_APPROVAL_CONFIG.verifyPassDelayMs);
      else return blocked(`verify_${v.kind}`);
    }
    if (token === null) return blocked("verify_no_token");

    const closed = await closeVerified(token);
    if (closed.kind !== "committed") return blocked(`close_${closed.kind}`);
    return json(200, { outcome: "verified", total: payload.total, text: READER_TEXT.checked(new Date().toISOString()) });
  } catch {
    // Before admission nothing was sent (the Opportunity read or the claim failed).
    if (!admitted) return json(503, { outcome: "not_sent", code: "could_not_start", error: NOTHING_SENT });
    // After admission the scope stays ADMITTED: it blocks (P-D); nothing here releases it.
    return blocked("exception");
  }
};
