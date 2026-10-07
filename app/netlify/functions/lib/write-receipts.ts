/**
 * Storage correction (plan v6 §9.3) -- security request receipts in the v2
 * ownership store. GHL remains the business system of record.
 *
 *   authz/receipt/<digest(IAOS_ENV:scope:requestId)>   v2 receipts: this request id may never execute again.
 *   authz/send/<digest(locationId+attemptId)>          send receipts, imported from the legacy store under the
 *                                                     SAME key derivation, so requireSendOutcome is unchanged.
 *
 * Legacy request ids are refused permanently by format (only `v2-` ids are
 * accepted), so every legacy receipt keeps its meaning whether or not its copy
 * was found. The pre-v2 lock, stage marker and their deletes are gone: see
 * contact-lock-v2.ts and stage-marker-v2.ts.
 */
import { getConfig } from "../../../shared/ghl-config";
import { digest } from "./hash";
import { WriteUncertain } from "./ghl-write-boundary";
import { StorageUncertain, VerifiedStore } from "./verified-store";

export const RECEIPT_PREFIX = "authz/receipt/";
export const SEND_RECEIPT_PREFIX = "authz/send/";
export const receiptKey = (env: string | undefined, scope: string, requestId: string) => RECEIPT_PREFIX + digest(`${env}:${scope}:${requestId}`);
export const sendReceiptKey = (locationId: string, attemptId: string) => SEND_RECEIPT_PREFIX + digest(locationId + attemptId);

/** Claims a request id once. A duplicate, or an unclear claim that is not provably ours, is refused. */
export async function claimWrite(store: VerifiedStore, scope: string, requestId: string, payload: unknown) {
  const key = receiptKey(process.env.IAOS_ENV, scope, requestId);
  const rec = { fingerprint: digest(JSON.stringify(payload)), claimedAt: new Date().toISOString(), claimant: store.scope.claimantHash };
  try {
    const w = await store.createOnce(key, rec, "receipt");
    if (w.result === "written") return;
  } catch (e) {
    if (!(e instanceof StorageUncertain)) throw e;
    const got = await store.readData(key, "receipt").catch(() => null);
    if (got && got.fingerprint === rec.fingerprint && got.claimedAt === rec.claimedAt && got.claimant === rec.claimant) return;
  }
  throw new WriteUncertain("Duplicate or unresolved request; read back before retrying");
}

/** Digest-only send receipt check, unchanged semantics, read strongly from authz/send/. */
export async function requireSendOutcome(store: VerifiedStore, attemptId: string, status: string, documentId: string | null) {
  const proof = await store.readData<{ outcome: string; documentDigest: string | null }>(sendReceiptKey(getConfig(process.env.IAOS_ENV).locationId, attemptId), "receipt");
  if (status === "failed" && proof?.outcome !== "refused") throw new Error("A failed send cannot be claimed without a confirmed refusal");
  if (status === "provider_accepted_pending_readback" && (!proof || proof.outcome !== "submitted" || !documentId || proof.documentDigest !== digest(documentId))) throw new Error("No matching server send receipt");
  if (status === "accepted" && proof && proof.documentDigest !== digest(documentId ?? "")) throw new Error("Readback document differs from server send receipt");
}
