/**
 * Storage correction (PR #131 plan v6 §4) -- LOCK v2. Never deleted.
 *
 *   lock2/<digest(env:location:contact)> =
 *     {v:2,state:"held",holderHash,fn,opId|null,acquiredAt,holderDeadline,prevReleasedByHash|null,deployId}
 *     {v:2,state:"free",releasedAt,releasedByHash,releasedForOp|null}
 *
 * Every mutation is a conditional write (onlyIfNew when absent, onlyIfMatch
 * otherwise), so every retry carries the condition. Entry is granted only by a
 * validated write, or by a strong read showing OUR holderHash. Release is a
 * compare-and-swap to free{releasedByHash: ours}; released is proven only by a
 * validated write, or by a read showing releasedByHash = ours, or a successor's
 * prevReleasedByHash = ours. Everything else is `release_unverified` -- the lock
 * stays held, visibly, and is never cleared by time.
 */
import { digest } from "./hash";
import { clock, InvocationScope } from "./invocation-scope";
import { StorageUncertain, VerifiedStore } from "./verified-store";
import { diag } from "./diagnostics";

export type HeldLock = { v: 2; state: "held"; holderHash: string; fn: string; opId: string | null; acquiredAt: string; holderDeadline: string; prevReleasedByHash: string | null; deployId: string };
export type FreeLock = { v: 2; state: "free"; releasedAt: string; releasedByHash: string; releasedForOp: string | null };
export type LockRecord = HeldLock | FreeLock;
export type LockStatus = "free" | "held_in_progress" | "held_release_unverified" | "held_legacy" | "unknown";
export type ReleaseResult = "released" | "release_unverified";

export const lockKey = (env: string, locationId: string, contactId: string) => `lock2/${digest(`${env}:${locationId}:${contactId}`)}`;

/** Another holder has the lock (409 with the matching visible message). */
export class LockHeld extends Error { constructor(readonly status: LockStatus) { super("This contact's save lock is held"); this.name = "LockHeld"; } }
/** The lock state could not be established (503). */
export class LockUnknown extends Error { constructor() { super("The save lock could not be confirmed"); this.name = "LockUnknown"; } }

export function statusOfRecord(r: LockRecord | null, now = clock.now()): LockStatus {
  if (!r || r.state === "free") return "free";
  if (r.state !== "held") return "unknown";
  return now <= Date.parse(r.holderDeadline) ? "held_in_progress" : "held_release_unverified";
}

export class ContactLock {
  private etag: string;
  released: ReleaseResult | null = null;
  constructor(private readonly store: VerifiedStore, private readonly scope: InvocationScope, readonly key: string, readonly holderHash: string, readonly opId: string | null, etag: string) { this.etag = etag; }

  /** Conditional, owner-proven release (cleanup phase). Never throws. */
  async release(): Promise<ReleaseResult> {
    if (this.released) return this.released;
    this.scope.enterCleanup();
    const free: FreeLock = { v: 2, state: "free", releasedAt: new Date().toISOString(), releasedByHash: this.holderHash, releasedForOp: this.opId };
    for (let i = 0; i < 3; i++) {
      try {
        const w = await this.store.cas(this.key, free, this.etag, "lock_release");
        if (w.result === "written") return (this.released = "released");
      } catch (e) { if (!(e instanceof StorageUncertain)) break; }
      // Conflict or uncertain: only our own evidence proves the release.
      let got: { data: LockRecord; etag: string } | null;
      try { got = await this.store.read<LockRecord>(this.key, "lock_release_verify"); } catch { break; }
      if (!got) break;                                                     // absence proves nothing
      const r = got.data;
      if (r.state === "free" && r.releasedByHash === this.holderHash) return (this.released = "released");
      if (r.state === "held" && r.prevReleasedByHash === this.holderHash && r.holderHash !== this.holderHash) return (this.released = "released");
      if (r.state === "held" && r.holderHash === this.holderHash) { this.etag = got.etag; continue; }   // our record: the release did not apply; retry
      break;                                                               // another holder without our hash, or an older record
    }
    diag({ fn: this.scope.fn, action: "lock", phase: "lock_release", class: "release_unverified" });
    return (this.released = "release_unverified");
  }
}

/**
 * Acquires the contact's lock. Throws LockHeld (409) when another holder has it,
 * LockUnknown (503) when the state cannot be established.
 */
export async function acquireLock(store: VerifiedStore, scope: InvocationScope, key: string, info: { opId: string | null; deployId: string }): Promise<ContactLock> {
  const holderHash = scope.mark("lock", key);
  const held = (prev: string | null): HeldLock => ({
    v: 2, state: "held", holderHash, fn: scope.fn, opId: info.opId, acquiredAt: new Date().toISOString(),
    holderDeadline: new Date(scope.deadlines.abs).toISOString(), prevReleasedByHash: prev, deployId: info.deployId,
  });
  for (let i = 0; i < 3; i++) {
    let cur: { data: LockRecord; etag: string } | null;
    try { cur = await store.read<LockRecord>(key, "lock_acquire"); } catch { throw new LockUnknown(); }
    if (cur && cur.data.state === "held") {
      if (cur.data.holderHash === holderHash) return new ContactLock(store, scope, key, holderHash, info.opId, cur.etag);
      throw new LockHeld(statusOfRecord(cur.data));
    }
    if (cur && cur.data.state !== "free") throw new LockUnknown();
    const next = held(cur ? (cur.data as FreeLock).releasedByHash : null);
    try {
      const w = await store.cas(key, next, cur ? cur.etag : null, "lock_acquire");
      if (w.result === "written") return new ContactLock(store, scope, key, holderHash, info.opId, w.etag);
      continue;                                        // conflict: re-read and re-decide
    } catch (e) {
      if (!(e instanceof StorageUncertain)) throw e;
    }
    // Ambiguous: only a read showing OUR holderHash grants entry.
    let got: { data: LockRecord; etag: string } | null;
    try { got = await store.read<LockRecord>(key, "lock_acquire"); } catch { throw new LockUnknown(); }
    if (got && got.data.state === "held" && got.data.holderHash === holderHash) return new ContactLock(store, scope, key, holderHash, info.opId, got.etag);
    throw new LockUnknown();
  }
  throw new LockUnknown();
}

/** The authenticated status read: durable across reloads and browsers. */
export async function readLockStatus(store: VerifiedStore, key: string, legacyBlocked: boolean): Promise<{ status: LockStatus; opId: string | null }> {
  if (legacyBlocked) return { status: "held_legacy", opId: null };
  try {
    const got = await store.read<LockRecord>(key, "status_read");
    const r = got ? got.data : null;
    return { status: statusOfRecord(r), opId: r && r.state === "held" ? r.opId : null };
  } catch { return { status: "unknown", opId: null }; }
}

/**
 * Same-operation recovery: releases a lock held by the operation `opId` ONLY when
 * the caller has that operation's VERIFIED final record, the held record names
 * that opId, and only by compare-and-swap on the etag from its strong read. It
 * never removes a different holder. Legacy locks and locks without an opId are
 * never released automatically.
 */
export async function recoverLockForOperation(store: VerifiedStore, scope: InvocationScope, key: string, opId: string, finalVerified: boolean): Promise<ReleaseResult | "not_applicable"> {
  if (!finalVerified) return "not_applicable";
  let got: { data: LockRecord; etag: string } | null;
  try { got = await store.read<LockRecord>(key, "lock_release_verify"); } catch { return "release_unverified"; }
  if (!got || got.data.state !== "held" || got.data.opId !== opId) return "not_applicable";
  if (clock.now() <= Date.parse(got.data.holderDeadline)) return "not_applicable";   // its holder may still be running
  const recoverer = scope.mark("lock-recovery", key, opId);
  try {
    const w = await store.cas(key, { v: 2, state: "free", releasedAt: new Date().toISOString(), releasedByHash: recoverer, releasedForOp: opId } satisfies FreeLock, got.etag, "lock_release");
    if (w.result === "written") return "released";
  } catch { /* fall through */ }
  try {
    const again = await store.read<LockRecord>(key, "lock_release_verify");
    if (again && again.data.state === "free" && again.data.releasedByHash === recoverer) return "released";
    if (again && again.data.state === "held" && again.data.prevReleasedByHash === recoverer) return "released";
  } catch { /* unverified */ }
  return "release_unverified";
}
