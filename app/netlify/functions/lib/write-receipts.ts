import { getStore } from "@netlify/blobs";
import { getConfig } from "../../../shared/ghl-config";
import { digest, WriteUncertain } from "./ghl-write-boundary";
/** Security request receipts only; GHL remains the business system of record. */
export async function claimWrite(scope: string, requestId: string, payload: unknown) {
  const store = getStore("iaos-write-receipts");
  const result = await store.setJSON(digest(`${process.env.IAOS_ENV}:${scope}:${requestId}`), { fingerprint: digest(JSON.stringify(payload)), claimedAt: new Date().toISOString() }, { onlyIfNew: true });
  if (!result.modified) throw new WriteUncertain("Duplicate or unresolved request; read back before retrying");
}
/** Atomic per-contact serialization. No expiry: an interrupted critical section fails closed. */
export async function lockContact(contactId: string) {
  const store=getStore("iaos-write-receipts");
  const key="lock/"+digest(getConfig(process.env.IAOS_ENV).locationId+contactId);
  const result=await store.setJSON(key,{claimedAt:new Date().toISOString()},{onlyIfNew:true});
  if(!result.modified)throw new WriteUncertain("Another write is in progress or unresolved; inspect before retrying");
  return async()=>{await store.delete(key);};
}

/**
 * INV-98 -- durable "Under Contract stage transition unresolved" marker.
 *
 * ONE per opportunity in this deployment's environment and location, keyed
 * independently of browser, operator, session and requestId -- so a reload,
 * another browser or another allowlisted operator all see the same marker.
 * Claimed atomically (onlyIfNew) immediately before the GHL stage PUT, and
 * deleted ONLY after that same attempt receives the server's exact confirmed
 * stage readback. An uncertain result, an exception or an interrupted function
 * leaves it in place. No expiry: while it exists, every later Under Contract
 * stage request is refused before any GHL call. A later read showing the old
 * stage never clears it; resolving a stuck marker is a separately reviewed
 * procedure.
 *
 * Stuck-marker identification: the key is `stage-unresolved/` + the digest
 * below, so it can be recomputed from the opportunity id, or found by listing
 * that prefix in this store. The value is digest-only apart from claimedAt.
 */
export const STAGE_UNRESOLVED_PREFIX = "stage-unresolved/";
export function stageTransitionMarkerKey(opportunityId: string, env = process.env): string {
  return STAGE_UNRESOLVED_PREFIX + digest(`${env.IAOS_ENV}:${getConfig(env.IAOS_ENV).locationId}:${opportunityId}`);
}
/** Thrown when another attempt already holds this opportunity's marker. */
export class StageTransitionUnresolved extends WriteUncertain {}
export async function stageTransitionUnresolved(opportunityId: string): Promise<boolean> {
  return (await getStore("iaos-write-receipts").get(stageTransitionMarkerKey(opportunityId), { type: "json", consistency: "strong" })) !== null;
}
export async function claimStageTransition(opportunityId: string, requestId: string, operator: string): Promise<void> {
  const result = await getStore("iaos-write-receipts").setJSON(stageTransitionMarkerKey(opportunityId), {
    kind: "under-contract-stage-transition",
    requestIdDigest: digest(requestId), operatorDigest: digest(operator), claimedAt: new Date().toISOString(),
  }, { onlyIfNew: true });
  if (!result.modified) throw new StageTransitionUnresolved("An earlier Under Contract stage transition for this opportunity is unresolved; inspect before retrying");
}
export async function clearStageTransition(opportunityId: string): Promise<void> {
  await getStore("iaos-write-receipts").delete(stageTransitionMarkerKey(opportunityId));
}

/** Digest-only receipt binds ledger claims to the actual server send attempt. */
export async function recordSendOutcome(attemptId:string, outcome:"refused"|"submitted"|"uncertain", documentId:string|null) {
  await getStore("iaos-write-receipts").setJSON("send/"+digest(getConfig(process.env.IAOS_ENV).locationId+attemptId),{outcome,documentDigest:documentId?digest(documentId):null});
}
export async function requireSendOutcome(attemptId:string,status:string,documentId:string|null) {
  const proof=await getStore("iaos-write-receipts").get("send/"+digest(getConfig(process.env.IAOS_ENV).locationId+attemptId),{type:"json",consistency:"strong"}) as {outcome:string;documentDigest:string|null}|null;
  if(status==="failed" && proof?.outcome!=="refused")throw new Error("A failed send cannot be claimed without a confirmed refusal");
  if(status==="provider_accepted_pending_readback" && (!proof || proof.outcome!=="submitted" || !documentId || proof.documentDigest!==digest(documentId)))throw new Error("No matching server send receipt");
  if(status==="accepted" && proof && proof.documentDigest!==digest(documentId??""))throw new Error("Readback document differs from server send receipt");
}
