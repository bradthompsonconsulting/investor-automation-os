import { getStore } from "@netlify/blobs";
import { getConfig } from "../../../shared/ghl-config";
import { digest, WriteUncertain } from "./ghl-write-boundary";
/** One receipt key and record for both claim helpers, so their receipts are byte-identical. */
const claimKey = (scope: string, requestId: string) => digest(`${process.env.IAOS_ENV}:${scope}:${requestId}`);
const claimRecord = (payload: unknown) => ({ fingerprint: digest(JSON.stringify(payload)), claimedAt: new Date().toISOString() });

/** Security request receipts only; GHL remains the business system of record. */
export async function claimWrite(scope: string, requestId: string, payload: unknown) {
  const store = getStore("iaos-write-receipts");
  const result = await store.setJSON(claimKey(scope, requestId), claimRecord(payload), { onlyIfNew: true });
  if (!result.modified) throw new WriteUncertain("Duplicate or unresolved request; read back before retrying");
}

export type RecordedClaim = { kind: "claimed" } | { kind: "duplicate" } | { kind: "unavailable"; reason: string };
type ClaimAttempt = { sent: boolean; status: number | null; threw: boolean; aborted: boolean; suppressed: boolean; refused: boolean };

/**
 * B15-26 B1 save deadline (proposal r4 + erratum 1). The same receipt as
 * claimWrite, but decided ONLY from this call's own record of the real
 * request, after the SDK has settled -- never from the SDK's `modified`, which
 * @netlify/blobs 11.1.0 reports for any non-412 conditional result. One real
 * attempt: a retryable status or a throw is recorded and answered to the SDK
 * with a synthetic 400, so it neither sleeps nor retries; any further call is
 * suppressed. The request is not started unless its cap fits before the
 * deadline; its timer covers the body. `unavailable` may still have written the
 * receipt: it is never retried or deleted. claimWrite is unchanged.
 */
export async function claimWriteRecorded(scope: string, requestId: string, payload: unknown, options: { deadline: number; capMs: number; minStartMs: number; now?: () => number }): Promise<RecordedClaim> {
  const now = options.now ?? Date.now;
  const attempts: ClaimAttempt[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const none = { sent: false, status: null, threw: false, aborted: false, suppressed: false, refused: false };
  const recorded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (attempts.length > 0) { attempts.push({ ...none, suppressed: true }); return new Response(null, { status: 400 }); }
    const left = options.deadline - now();
    if (left < Math.max(options.capMs, options.minStartMs)) { attempts.push({ ...none, refused: true }); return new Response(null, { status: 400 }); }
    const ac = new AbortController();
    timers.push(setTimeout(() => ac.abort(), options.capMs));
    try {
      const res = await globalThis.fetch(input, { ...init, signal: ac.signal });
      attempts.push({ ...none, sent: true, status: res.status });
      if (res.status === 412 || (res.status >= 200 && res.status < 300)) return res;
      await res.arrayBuffer().catch(() => undefined);
      return new Response(null, { status: 400 });
    } catch {
      attempts.push({ ...none, sent: true, threw: true, aborted: ac.signal.aborted });
      return new Response(null, { status: 400 });
    }
  };
  try {
    await getStore({ name: "iaos-write-receipts", fetch: recorded }).setJSON(claimKey(scope, requestId), claimRecord(payload), { onlyIfNew: true });
  } catch { /* decided from the record below */ } finally {
    for (const t of timers) clearTimeout(t);
  }
  const real = attempts.filter((a) => a.sent);
  const a = attempts[0];
  if (!a) return { kind: "unavailable", reason: "no_attempt" };
  if (a.refused) return { kind: "unavailable", reason: "deadline" };
  if (attempts.some((x) => x.suppressed)) return { kind: "unavailable", reason: "suppressed_retry" };
  if (real.length !== 1) return { kind: "unavailable", reason: "attempts" };
  if (a.threw) return { kind: "unavailable", reason: a.aborted ? "aborted" : "threw" };
  if (a.status === 412) return { kind: "duplicate" };
  if (a.status !== null && a.status >= 200 && a.status < 300) return { kind: "claimed" };
  return { kind: "unavailable", reason: `status_${a.status}` };
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
