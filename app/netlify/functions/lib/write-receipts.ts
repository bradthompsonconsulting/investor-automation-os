import { getStore } from "@netlify/blobs";
import { getConfig } from "../../../shared/ghl-config";
import { digest, WriteUncertain } from "./ghl-write-boundary";

const RECEIPTS = "iaos-write-receipts";

/*
 * Recorded receipt writes (shared-receipt repair; design accepted by Bones, 2026-10-23).
 * @netlify/blobs 11.1.0 reports ANY non-412 conditional result as `modified: true`, and retries 429/5xx and
 * thrown requests up to five times, deletes included. So the receipt helpers below never read the SDK's result:
 * each call passes its own recorder as `fetch`, which lets exactly ONE real request through (a retryable status
 * or a throw is recorded and answered with a synthetic 400, so the SDK neither sleeps nor retries; any further
 * request is not sent), and the outcome is decided from that record once the SDK has settled:
 *   create: one 2xx -> created; one 412 -> exists (contention or duplicate; nothing of ours stored);
 *           anything else -> uncertain (ours MAY be stored: it is refused, never retried, never deleted)
 *   delete: one 200/204/404 -> deleted; anything else -> uncertain (it MAY have landed: never retried)
 * No retry of a delete means a delete that landed with its response lost cannot, on a later attempt, remove a
 * record another caller has since created. Scope: the inspected callers of these helpers only; this is not a
 * general ownership guarantee against arbitrary repeated releases or external cleanup.
 */
type ReceiptAttempt = { sent: boolean; status: number | null; threw: boolean };
function receiptRecorder() {
  const attempts: ReceiptAttempt[] = [];
  const once = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (attempts.length > 0) { attempts.push({ sent: false, status: null, threw: false }); return new Response(null, { status: 400 }); }
    try {
      const res = await globalThis.fetch(input, init);
      attempts.push({ sent: true, status: res.status, threw: false });
      if (res.status === 429 || res.status >= 500) { await res.arrayBuffer().catch(() => undefined); return new Response(null, { status: 400 }); }
      return res;
    } catch {
      attempts.push({ sent: true, status: null, threw: true });
      return new Response(null, { status: 400 });
    }
  };
  /** The single real attempt, or null when there was none, or more than one call was made. */
  const only = () => (attempts.length === 1 && attempts[0].sent && !attempts[0].threw ? attempts[0].status : null);
  return { fetch: once as typeof fetch, only };
}
async function atomicCreate(key: string, value: unknown): Promise<"created" | "exists" | "uncertain"> {
  const rec = receiptRecorder();
  try { await getStore({ name: RECEIPTS, fetch: rec.fetch }).setJSON(key, value, { onlyIfNew: true }); } catch { /* decided from the record */ }
  const status = rec.only();
  if (status === 412) return "exists";
  return status !== null && status >= 200 && status < 300 ? "created" : "uncertain";
}
async function recordedDelete(key: string): Promise<"deleted" | "uncertain"> {
  const rec = receiptRecorder();
  try { await getStore({ name: RECEIPTS, fetch: rec.fetch }).delete(key); } catch { /* decided from the record */ }
  const status = rec.only();
  return status === 200 || status === 204 || status === 404 ? "deleted" : "uncertain";
}

/** Security request receipts only; GHL remains the business system of record. */
export async function claimWrite(scope: string, requestId: string, payload: unknown) {
  const claimed = await atomicCreate(digest(`${process.env.IAOS_ENV}:${scope}:${requestId}`), { fingerprint: digest(JSON.stringify(payload)), claimedAt: new Date().toISOString() });
  if (claimed !== "created") throw new WriteUncertain("Duplicate or unresolved request; read back before retrying");
}
/**
 * Atomic per-contact serialization. No expiry: an interrupted critical section fails closed. A release is
 * returned ONLY for a lock this call definitely created. The release is single-use and never throws: it runs in
 * callers' `finally` blocks, after the protected write's outcome is decided, and must not replace that outcome.
 * An unconfirmed release leaves the lock in place (writes to this contact stay refused until inspected).
 */
export async function lockContact(contactId: string) {
  const key="lock/"+digest(getConfig(process.env.IAOS_ENV).locationId+contactId);
  if (await atomicCreate(key, { claimedAt: new Date().toISOString() }) !== "created") throw new WriteUncertain("Another write is in progress or unresolved; inspect before retrying");
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (await recordedDelete(key) !== "deleted") console.warn("[write-receipts] contact lock release unconfirmed; the lock may remain and refuse this contact's writes until inspected");
  };
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
/**
 * INV-98 Board #9 Production: this is an early refusal only. Lambda-
 * compatibility functions (`connectLambda`) are never given an
 * `uncachedEdgeURL`, so the SDK refuses a strong read with
 * `BlobsConsistencyError` before any request -- the same limit
 * ghl-executed-artifact-upload.ts already handles. That error alone falls
 * back to a default-consistency read; any other error still throws. The
 * authoritative guard is `claimStageTransition`'s atomic `onlyIfNew` write,
 * which runs before the PUT and does not depend on read consistency.
 */
export async function stageTransitionUnresolved(opportunityId: string): Promise<boolean> {
  const store = getStore("iaos-write-receipts");
  const key = stageTransitionMarkerKey(opportunityId);
  let marker: unknown;
  try {
    marker = await store.get(key, { type: "json", consistency: "strong" });
  } catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    marker = await store.get(key, { type: "json" });
  }
  return marker !== null;
}
export async function claimStageTransition(opportunityId: string, requestId: string, operator: string): Promise<void> {
  const claimed = await atomicCreate(stageTransitionMarkerKey(opportunityId), {
    kind: "under-contract-stage-transition",
    requestIdDigest: digest(requestId), operatorDigest: digest(operator), claimedAt: new Date().toISOString(),
  });
  // exists: an earlier transition holds the marker; uncertain: OUR marker may now exist. Either way the PUT is not sent.
  if (claimed !== "created") throw new StageTransitionUnresolved("An earlier Under Contract stage transition for this opportunity is unresolved; inspect before retrying");
}
/**
 * Runs only after the exact confirmed stage readback (INV-98 afterConfirmed). One attempt, never retried. An
 * unconfirmed clear still throws, as before, so the request is never reported as success and the marker that may
 * remain keeps later Under Contract requests refused until it is inspected.
 */
export async function clearStageTransition(opportunityId: string): Promise<void> {
  if (await recordedDelete(stageTransitionMarkerKey(opportunityId)) !== "deleted") throw new Error("Under Contract marker clear unconfirmed; the marker may remain");
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
