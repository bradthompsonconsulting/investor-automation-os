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
