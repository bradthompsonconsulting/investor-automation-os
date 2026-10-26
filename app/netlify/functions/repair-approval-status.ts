/**
 * Repair-save completion integration -- the approval display's reader (r2 §4,
 * r3 C1/C3, r4 D2, r5.1 by-id; module ea525f6 unchanged). DEFAULT-DISABLED.
 *
 * GET ?opportunityId=<id>, read session required. Read-only: the module's
 * readRepairApproval (strong read of A -> Opportunity read -> the note at
 * A.completion.noteId -> strong read of A), point-in-time, never computed
 * OFFER READY. Returns only the module's own result kinds and texts:
 *   checked       "Recorded repair approval — checked as of [time]"
 *   needs_review  "Repair save needs review. Do not retry this approval."
 *   not_verified  "Repair approval could not be verified" + reason (+ total)
 *   none          no recorded approval and no GHL total
 * Not active in this environment (switch off, or IAOS_ENV not Test) -> 404
 * before auth or I/O. Not configured -> 503; nothing read.
 */
import { getConfig } from "../../shared/ghl-config";
import { REPAIR_APPROVAL_DISABLED, repairApprovalActiveFor } from "../../shared/repair-approval-config";
import { readAuthRefusal } from "./lib/app-read-auth";
import { createAuthorityClient, createProductionTargetTransport, readRepairApproval } from "./lib/blob-authority";
import { approvalScope, approvalSetup } from "./lib/repair-approval-integration";
import { identifier } from "./lib/write-contracts";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });

export const handler = async (event: any) => {
  if (!repairApprovalActiveFor(process.env.IAOS_ENV)) return json(404, { error: "Not found", by: REPAIR_APPROVAL_DISABLED });
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  const refusal = readAuthRefusal(event);
  if (refusal) return refusal;
  const setup = approvalSetup();
  if (setup.kind !== "ready") return json(503, { error: "Repair approval is not configured", code: setup.code });
  const q = event.queryStringParameters ?? {};
  try { if (Object.keys(q).length !== 1) throw new Error("query"); identifier(q.opportunityId); }
  catch { return json(400, { error: "Invalid request" }); }
  const config = getConfig(process.env.IAOS_ENV);
  try {
    const client = createAuthorityClient({ siteID: setup.siteID, token: setup.token });
    const transport = createProductionTargetTransport({ fieldIds: { repairEstimate: config.opportunityFacts.repairs, repairApprovalId: setup.approvalFieldId } });
    const r = await readRepairApproval(client, transport, approvalScope(setup.env, config.locationId, q.opportunityId), q.opportunityId);
    if (r.kind === "refused") return json(503, { error: "Repair approval could not be read", code: r.reason });
    return json(200, r);
  } catch {
    return json(503, { error: "Repair approval could not be read" });
  }
};
