/**
 * Storage correction -- the per-invocation wiring the five migrated endpoints
 * share: the deadline scope, the verified ownership store, the deploy context,
 * the write gate, the capability branch and the lock-status messages.
 */
import { getConfig } from "../../../shared/ghl-config";
import { InvocationScope, type EndpointName } from "./invocation-scope";
import { VerifiedStore } from "./verified-store";
import { deployContextOf, WriteGate, WriteRefused, type DeployContext } from "./write-gate";
import { isCapabilityRequest, storageCapability } from "./capability";
import { configuredBoundary } from "./ghl-write-boundary";
import { json, type LambdaResult, type LegacyEvent } from "./modern-runtime";
import { readAuthRefusal } from "./app-read-auth";
import { LockHeld, LockUnknown, type LockStatus } from "./contact-lock-v2";
import { legacyBlockKey } from "./cutover";
import { diag } from "./diagnostics";

export type Invocation = {
  fn: EndpointName; scope: InvocationScope; store: VerifiedStore; deploy: DeployContext; gate: WriteGate;
  config: ReturnType<typeof getConfig>; env: string;
};
export function invocation(fn: EndpointName, context: any): Invocation {
  const scope = new InvocationScope(fn);
  const store = new VerifiedStore(scope);
  const deploy = deployContextOf(context);
  const config = getConfig(process.env.IAOS_ENV);
  const env = String(process.env.IAOS_ENV);
  return { fn, scope, store, deploy, gate: new WriteGate(scope, store, deploy, env, config.locationId), config, env };
}
/** A boundary that can read; mutations go through this invocation's gate. */
export const boundaryFor = (inv: Invocation) => configuredBoundary(undefined, inv.gate, inv.scope);
/** A read-only boundary (status reads, ownership checks before the gate). */
export const readBoundaryFor = (inv: Invocation) => configuredBoundary(undefined, null, inv.scope);

export const refusalResult = (e: WriteRefused): LambdaResult => json(e.refusal.status, e.refusal.body);

/**
 * The capability branch for the four SESSION endpoints, after write session
 * and origin: the exact shape plus a valid read session. Returns null when the
 * body is not a capability request.
 */
export async function sessionCapabilityBranch(event: LegacyEvent, inv: Invocation): Promise<{ result: LambdaResult; header: string } | null> {
  let body: unknown;
  try { body = event.isBase64Encoded ? null : JSON.parse(event.body ?? "null"); } catch { return null; }
  if (!body || typeof body !== "object" || (body as any).action !== "storage_capability") return null;
  if (!isCapabilityRequest(body)) return { result: json(400, { error: "Invalid storage capability request" }), header: "" };
  const refused = readAuthRefusal(event);
  if (refused) return { result: refused as LambdaResult, header: "" };
  const r = await storageCapability(inv.fn, inv.deploy, (body as any).nonce);
  return { result: json(r.status, r.body), header: r.header };
}

export const LOCK_MESSAGES: Record<LockStatus, string> = {
  free: "",
  held_in_progress: "Another write for this contact is in progress. Nothing was changed; use Check again in a moment.",
  held_release_unverified: "The save lock for this contact could not be confirmed released. Nothing was changed. Follow the stuck-lock steps.",
  held_legacy: "Saving is held for this contact: an earlier save (from a previous version of IAOS) is unresolved.",
  unknown: "The save lock for this contact could not be read. Nothing was changed.",
};
/** Saved, with a visible warning: the lock could not be confirmed released. */
export const RELEASE_UNVERIFIED_WARNING = "Saved. The save lock for this contact could not be confirmed released. If the next save is refused, follow the stuck-lock steps.";
export function lockRefusal(e: unknown): LambdaResult | null {
  if (e instanceof LockHeld) return json(409, { state: "in_progress", lock: e.status, message: LOCK_MESSAGES[e.status] || LOCK_MESSAGES.held_in_progress });
  if (e instanceof LockUnknown) return json(503, { state: "unknown", lock: "unknown", message: LOCK_MESSAGES.unknown });
  return null;
}
/** Adds `lock: "release_unverified"` and the visible warning to a response body that kept its business outcome. */
export function withLockWarning(r: LambdaResult, released: "released" | "release_unverified" | null): LambdaResult {
  if (released !== "release_unverified") return r;
  try {
    const b = JSON.parse(r.body);
    if (!b || typeof b !== "object" || Array.isArray(b)) return r;
    return { ...r, body: JSON.stringify({ ...b, lock: "release_unverified", lockWarning: RELEASE_UNVERIFIED_WARNING }) };
  } catch { return r; }
}
export async function legacyBlocked(inv: Invocation, subject: string): Promise<boolean> {
  return (await inv.store.readData(legacyBlockKey(inv.env, inv.config.locationId, subject), "status_read")) !== null;
}
/** Every catch-all logs before responding (class only; never the error text). */
export function logCatchAll(inv: Invocation, action: string): void {
  diag({ fn: inv.fn, action, phase: "request", class: "unexpected" });
}
