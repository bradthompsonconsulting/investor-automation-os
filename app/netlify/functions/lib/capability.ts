/**
 * Storage correction (plan v6 §6) -- capability states and the per-endpoint
 * `storage_capability` diagnostic.
 *
 *   unknown / unavailable  the default; also any thrown error (TypeError
 *                          included), missing context, zero fetches, or any
 *                          outcome other than a real 200/404 from the
 *                          uncachedEdgeURL origin
 *   configured             context present, https URLs, and the request reached
 *                          the hook on the uncached origin. NOT proof; relaxes nothing
 *   verified               in THIS invocation, a strong GET observed on the
 *                          uncached origin returned a real 200 with an etag and
 *                          the expected record shape (authz/cutover/v2)
 *
 * The action makes ONE strong GET: zero GHL calls, zero business writes, zero
 * storage writes. The response is signed (HMAC-SHA256 with the new-build-only
 * secret IAOS_ATTEST_SECRET_V2) only when `verified`. Nothing is stored.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { InvocationScope, type EndpointName } from "./invocation-scope";
import { StrongReadUnavailable, VerifiedStore } from "./verified-store";
import { CUTOVER_KEY, type CutoverRecord } from "./cutover";
import { diag } from "./diagnostics";
import type { DeployContext } from "./write-gate";

export type CapabilityState = "unknown" | "unavailable" | "configured" | "verified";
export const ATTEST_SECRET_ENV = "IAOS_ATTEST_SECRET_V2";
export const SDK_VERSION = "11.1.0";

/** Exact shape: {action:"storage_capability"} or {action:"storage_capability", nonce}. */
export { isCapabilityRequest } from "./capability-shape";

export type Attestation = { fn: string; deployId: string | null; deployContext: string | null; published: boolean | null; storage: CapabilityState; issuedAt: string; nonce: string };
export function signAttestation(a: Attestation, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify([a.fn, a.deployId, a.deployContext, a.published, a.storage, a.issuedAt, a.nonce])).digest("base64url");
}
export function verifyAttestation(a: Attestation, signature: string, secret: string): boolean {
  if (typeof signature !== "string" || !secret) return false;
  const expected = Buffer.from(signAttestation(a, secret));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function probeCapability(store: VerifiedStore): Promise<CapabilityState> {
  if (!store.ctx) return "unavailable";
  if (!store.configured) return "unknown";
  const before = store.fetches;
  try {
    const r = await store.read<CutoverRecord>(CUTOVER_KEY, "capability");
    if (store.fetches === before) return "unknown";
    if (r && r.etag && r.data && r.data.v === 1 && r.data.importComplete === true && typeof r.data.manifestDigest === "string") return "verified";
    return "configured";
  } catch (e) {
    return e instanceof StrongReadUnavailable ? "unavailable" : "unknown";
  }
}

/** The whole action. Reads only; signs only `verified`. */
export async function storageCapability(fn: EndpointName, deploy: DeployContext, nonce: string | undefined, env: Record<string, string | undefined> = process.env, ctxOverride?: any): Promise<{ status: number; body: Record<string, unknown>; header: CapabilityState }> {
  const scope = new InvocationScope(fn);
  let storage: CapabilityState = "unknown";
  try {
    const store = ctxOverride === undefined ? new VerifiedStore(scope, undefined, undefined, true) : new VerifiedStore(scope, undefined, ctxOverride, true);
    storage = await probeCapability(store);
  } catch { storage = "unknown"; }
  if (storage !== "verified") diag({ fn, action: "storage_capability", phase: "capability", class: "strong_unavailable", capability: storage });
  const issuedAt = new Date().toISOString();
  const att: Attestation = { fn, deployId: deploy.id, deployContext: deploy.context, published: deploy.published, storage, issuedAt, nonce: nonce ?? randomBytes(12).toString("hex") };
  const secret = (env[ATTEST_SECRET_ENV] ?? "").trim();
  const signature = storage === "verified" && secret.length >= 32 ? signAttestation(att, secret) : null;
  scope.close();
  return {
    status: 200,
    header: storage,
    body: { storage, deployId: deploy.id, deployContext: deploy.context, published: deploy.published, fn, sdk: SDK_VERSION, node: process.version, attestation: { ...att, signature } },
  };
}
