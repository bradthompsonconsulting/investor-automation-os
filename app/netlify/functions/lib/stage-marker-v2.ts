/**
 * Storage correction (PR #131 plan v6 §4) -- the Under Contract STAGE MARKER v2.
 *
 *   stage-unresolved/<digest(env:location:opportunity)> =
 *     {v:2,state:"unresolved",attemptHash,claimedAt} | {v:2,state:"resolved",resolvedAt,attemptHash}
 *
 * Claim: absent -> onlyIfNew; resolved -> onlyIfMatch; unresolved -> refuse.
 * Cleared only after that same attempt's exact confirmed readback, by
 * onlyIfMatch -> resolved, under the lock release-evidence rules. Never deleted.
 */
import { digest } from "./hash";
import { InvocationScope } from "./invocation-scope";
import { StorageUncertain, VerifiedStore } from "./verified-store";
import { diag } from "./diagnostics";

export type MarkerRecord = { v: 2; state: "unresolved"; attemptHash: string; claimedAt: string } | { v: 2; state: "resolved"; resolvedAt: string; attemptHash: string };
export const STAGE_MARKER_PREFIX = "stage-unresolved/";
export const stageMarkerKey = (env: string, locationId: string, opportunityId: string) => STAGE_MARKER_PREFIX + digest(`${env}:${locationId}:${opportunityId}`);

/** An earlier Under Contract transition for this opportunity is unresolved (or unreadable). */
export class StageMarkerHeld extends Error { constructor(m = "An earlier Under Contract stage transition for this opportunity is unresolved; inspect before retrying") { super(m); this.name = "StageMarkerHeld"; } }

/** True when unresolved; throws (fail closed) when the state cannot be read. */
export async function stageMarkerUnresolved(store: VerifiedStore, key: string): Promise<boolean> {
  const got = await store.read<MarkerRecord>(key, "stage_marker_claim");
  if (!got) return false;
  if (got.data.state === "resolved") return false;
  return true;   // "unresolved" or any unknown shape
}

export class StageMarkerClaim {
  constructor(private readonly store: VerifiedStore, private readonly scope: InvocationScope, readonly key: string, readonly attemptHash: string, private etag: string) {}
  /** After the exact confirmed readback only. Returns whether resolution is proven. */
  async resolve(): Promise<boolean> {
    const next: MarkerRecord = { v: 2, state: "resolved", resolvedAt: new Date().toISOString(), attemptHash: this.attemptHash };
    for (let i = 0; i < 3; i++) {
      try { const w = await this.store.cas(this.key, next, this.etag, "stage_marker_clear"); if (w.result === "written") return true; }
      catch (e) { if (!(e instanceof StorageUncertain)) break; }
      let got: { data: MarkerRecord; etag: string } | null;
      try { got = await this.store.read<MarkerRecord>(this.key, "stage_marker_clear"); } catch { break; }
      if (!got) break;
      if (got.data.state === "resolved" && got.data.attemptHash === this.attemptHash) return true;
      if (got.data.state === "unresolved" && got.data.attemptHash === this.attemptHash) { this.etag = got.etag; continue; }
      break;
    }
    diag({ fn: this.scope.fn, action: "stage", phase: "stage_marker_clear", class: "release_unverified" });
    return false;
  }
}

export async function claimStageMarker(store: VerifiedStore, scope: InvocationScope, key: string, requestId: string): Promise<StageMarkerClaim> {
  const attemptHash = scope.mark("stage", key, requestId);
  const rec: MarkerRecord = { v: 2, state: "unresolved", attemptHash, claimedAt: new Date().toISOString() };
  const cur = await store.read<MarkerRecord>(key, "stage_marker_claim");
  if (cur && cur.data.state !== "resolved") throw new StageMarkerHeld();
  try {
    const w = await store.cas(key, rec, cur ? cur.etag : null, "stage_marker_claim");
    if (w.result === "written") return new StageMarkerClaim(store, scope, key, attemptHash, w.etag);
    throw new StageMarkerHeld();
  } catch (e) {
    if (!(e instanceof StorageUncertain)) throw e;
  }
  const got = await store.read<MarkerRecord>(key, "stage_marker_claim");
  if (got && got.data.state === "unresolved" && got.data.attemptHash === attemptHash) return new StageMarkerClaim(store, scope, key, attemptHash, got.etag);
  throw new StageMarkerHeld("The stage transition marker could not be confirmed; nothing was sent");
}
