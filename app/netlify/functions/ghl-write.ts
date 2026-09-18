import { currentContractContext } from "./lib/write-contract-context";
import { recordProjectionProof, requireProjectionProof } from "./lib/write-receipts";
import { validateLedgerNote } from "./lib/write-note-guard";
import { getConfig } from "../../shared/ghl-config";
import { requireAppWriter } from "./lib/app-write-auth";
import { exact, identifier, planWrite, dispositions, routings } from "./lib/write-contracts";
import { configuredBoundary, fieldValue, matchesField, WriteUncertain } from "./lib/ghl-write-boundary";
import { claimWrite, lockContact } from "./lib/write-receipts";
import { latestOutcomeNoteForOpportunity } from "../../src/lib/seller-call-outcome";
import { currentOfferWriteGate } from "../../src/lib/current-offer-carrier";
import { latestContractProjectionSyncForOpportunity } from "../../src/lib/contract-projection-sync-carriers";
const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let operator: string;
  try { operator = requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  let request: any; let plan: ReturnType<typeof planWrite>;
  const config = getConfig(process.env.IAOS_ENV);
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request encoding or query");
    request = JSON.parse(event.body ?? "null"); exact(request, ["operation", "targetId", "requestId", "args"]);
    identifier(request.targetId); identifier(request.requestId);
    plan = planWrite(request.operation, request.args, config);
  } catch { return json(400, { error: "Invalid named write request" }); }
  let release: (() => Promise<void>) | undefined;
  try {
    const boundary = configuredBoundary();
    const { targetId, operation, args, requestId } = request;
    let target = plan.kind === "opportunity" ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    const contactId = plan.kind === "opportunity" ? target.contactId : targetId;
    release = await lockContact(contactId);
    target = plan.kind === "opportunity" ? await boundary.opportunity(targetId) : await boundary.contact(targetId);
    if (operation === "opportunity.currentOffer") {
      const outcome = latestOutcomeNoteForOpportunity(await boundary.notes(contactId), targetId);
      if (currentOfferWriteGate({ value: args.value, agreementAlreadyReached: outcome?.kind === "accept" }).kind !== "allowed") return json(409, { error: "Current Offer is frozen or invalid" });
    }
    if (operation === "contact.routing" && args.value === routings[1]) {
      const d = fieldValue(target.customFields, config.fields.callDisposition, "contact").value;
      if (d !== "No Answer" && d !== "Voicemail") return json(409, { error: "Routing transition is not permitted" });
    }
    if (operation === "contact.dispositionAt") {
      const d = fieldValue(target.customFields, config.fields.callDisposition, "contact").value;
      if (!dispositions.includes(d)) return json(409, { error: "A valid disposition must be confirmed first" });
      if (d === "Follow Up" && !fieldValue(target.customFields, config.fields.callbackDatetimePrecise, "contact").value) return json(409, { error: "Follow Up requires a confirmed callback" });
    }
    if (operation === "contract.projection" || operation === "contract.draftRequest") {
      const context = await currentContractContext(boundary, targetId);
      if (!context.projection.ok) return json(409, { error: "Canonical contract facts are not ready" });
      if (operation === "contract.draftRequest") {
        const expected = planWrite("contract.projection", { entries: context.projection.entries, sellerCount: context.sellerCount }, config);
        if (!expected.fields.every(f=>matchesField(target.customFields,f,"opportunity")) || fieldValue(target.customFields,config.opportunityFacts.currentOffer,"opportunity").value !== context.agreement.snapshot.currentOffer) throw new Error("Projection no longer matches canonical contract");
      }
      if (operation === "contract.projection" && (JSON.stringify(args.entries) !== JSON.stringify(context.projection.entries) || args.sellerCount !== context.sellerCount)) return json(409, { error: "Projection does not match current canonical facts" });
    }
    if (operation === "contract.draftRequest") {
      const state = fieldValue(target.customFields, config.contractDraftRequest, "opportunity").value;
      if (state !== null && state !== "" && state !== "Idle") return json(409, { error: "Draft already requested" });
      await requireProjectionProof(targetId, target);
      const sync = latestContractProjectionSyncForOpportunity(await boundary.notes(contactId), targetId);
      if (!sync || sync.status !== "in_progress" || !sync.entriesAttempted || sync.entriesLanded !== sync.entriesAttempted || !sync.currentOfferCrossCheckOk) return json(409, { error: "Confirmed contract projection is required" });
    }
    if (plan.kind === "note") await validateLedgerNote(boundary, targetId, plan.body!);
    await claimWrite(`${operator}:${operation}:${targetId}`, requestId, request);
    if (plan.kind === "note") return json(200, await boundary.note(targetId, plan.body!));
    if (plan.kind === "task") {
      const path = `/contacts/${targetId}/tasks/${plan.taskId}`;
      const before = await boundary.call(path); const task = before.task ?? before;
      if (task.id !== plan.taskId || (task.contactId && task.contactId !== targetId) || typeof task.completed !== "boolean") throw new Error("Task identity is ambiguous");
      if (!task.completed) await boundary.call(`${path}/completed`, "PUT", { completed: true });
      const after = await boundary.call(path); const readback = after.task ?? after;
      if (readback.id !== plan.taskId || readback.completed !== true) throw new WriteUncertain("Task completion readback is ambiguous");
      return json(200, { confirmed: true });
    }
    const result = await boundary.fields(plan.kind, targetId, plan.fields);
    if (operation === "contract.projection" && result.confirmed) await recordProjectionProof(targetId, plan.fields, result.readback);
    // A deterministic partial readback is not a successful write. Existing clients
    // receive per-field evidence and retain their partial-recovery path.
    return json(200, { ...result.response, confirmed: result.confirmed, readback: result.readback, results: result.results });
  } catch (error) {
    if (error instanceof WriteUncertain) return json(409, { outcome: "indeterminate", error: error.message });
    return json(409, { error: "Write refused or unconfirmed; refresh and inspect before retrying" });
  } finally { if (release) await release(); }
};
