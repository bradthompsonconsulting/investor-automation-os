/**
 * Storage correction (PR #131 plan v6 §3) -- SEND OWNERSHIP and "never sent" proofs.
 *
 * The claim record `decision/<request>` = {d:"send", at, scopeKey, opId,
 * attemptId, requestDigest, claimantHash}. `claimantHash` is H(this invocation's
 * private 256-bit token) -- never stored in clear, logged or returned.
 *
 * `claimSend` returns an unforgeable OwnedSend ONLY when the write is a validated
 * create, or -- after StorageUncertain -- a strong read shows EVERY claim field
 * equal AND the claimant hash of this LIVE scope. A conflict, a foreign or
 * missing hash, any field mismatch, a closed scope or an uncertain read gives no
 * ownership and proves nothing. A reload, another browser or another invocation
 * can never adopt a claim.
 *
 * One owned dispatch per invocation. `dispatchOwned` checks synchronously,
 * immediately before the GHL request: scope open, now <= T_dispatch, the
 * OwnedSend live, unconsumed and unsurrendered, and the scope's latch unset. It
 * sets the latch and consumes the OwnedSend before the request is issued.
 *
 * Terminal surrender: `publishNotDispatched` FIRST surrenders the OwnedSend
 * (synchronously, before any I/O), then writes. Whatever happens next, a
 * surrendered OwnedSend can never be dispatched or published again.
 */
import { InvocationScope } from "./invocation-scope";
import { StorageUncertain, VerifiedStore } from "./verified-store";
import { diag } from "./diagnostics";

export type ClaimRecord = { d: "send"; at: string; scopeKey: string; opId: string; attemptId: string; requestDigest: string; claimantHash: string };

const LIVE = new WeakSet<object>();
const STATE = new WeakMap<object, { consumed: boolean; surrendered: boolean }>();

export class OwnedSend {
  private constructor(readonly scope: InvocationScope, readonly decisionKey: string, readonly outcomeKey: string, readonly record: ClaimRecord) {
    LIVE.add(this);
    STATE.set(this, { consumed: false, surrendered: false });
  }
  /** Module-private factory: no caller outside this module can mint one. */
  static _mint(scope: InvocationScope, decisionKey: string, outcomeKey: string, record: ClaimRecord): OwnedSend { return new OwnedSend(scope, decisionKey, outcomeKey, record); }
  get consumed() { return STATE.get(this)?.consumed ?? true; }
  get surrendered() { return STATE.get(this)?.surrendered ?? true; }
}
/** Refused before any I/O: the send may not be dispatched. */
export class NotDispatchable extends Error { constructor(readonly reason: "forged" | "consumed" | "surrendered" | "latched" | "scope") { super(`Send not dispatchable (${reason})`); this.name = "NotDispatchable"; } }

export type ClaimResult = { owned: OwnedSend } | { owned: null; reason: "conflict" | "uncertain" | "foreign" | "scope" };

const sameClaim = (a: any, b: ClaimRecord) => !!a && a.d === "send" && a.at === b.at && a.scopeKey === b.scopeKey && a.opId === b.opId && a.attemptId === b.attemptId && a.requestDigest === b.requestDigest && a.claimantHash === b.claimantHash;

export async function claimSend(store: VerifiedStore, scope: InvocationScope, keys: { decision: string; outcome: string }, fields: { scopeKey: string; opId: string; attemptId: string; requestDigest: string }): Promise<ClaimResult> {
  if (!scope.isOpen) return { owned: null, reason: "scope" };
  const record: ClaimRecord = { d: "send", at: new Date().toISOString(), ...fields, claimantHash: scope.claimantHash };
  try {
    const w = await store.createOnce(keys.decision, record, "decision_claim");
    if (w.result === "written") return { owned: OwnedSend._mint(scope, keys.decision, keys.outcome, record) };
    return { owned: null, reason: "conflict" };
  } catch (e) {
    if (!(e instanceof StorageUncertain)) throw e;
  }
  // Ambiguous: only an exact strong read of OUR claim, while this scope is live, recovers ownership.
  try {
    const got = await store.readData(keys.decision, "claim_verify");
    if (sameClaim(got, record) && scope.isOpen) return { owned: OwnedSend._mint(scope, keys.decision, keys.outcome, record) };
    diag({ fn: scope.fn, action: "claim", phase: "claim_verify", class: got ? "readback_mismatch" : "readback_missing" });
    return { owned: null, reason: got ? "foreign" : "uncertain" };
  } catch { return { owned: null, reason: "uncertain" }; }
}

/** Synchronous gate immediately before the one owned GHL request. Throws before any I/O. */
export function consumeForDispatch(owned: OwnedSend): void {
  if (!LIVE.has(owned)) throw new NotDispatchable("forged");
  const st = STATE.get(owned)!;
  if (st.surrendered) throw new NotDispatchable("surrendered");
  if (st.consumed) throw new NotDispatchable("consumed");
  try { owned.scope.assertMayDispatch(); } catch { throw new NotDispatchable("scope"); }
  if (owned.scope.dispatchLatch) throw new NotDispatchable("latched");
  owned.scope.dispatchLatch = true;
  st.consumed = true;
}

/** Permanently surrenders (synchronously). Idempotent. No API restores it. */
export function surrender(owned: OwnedSend): void {
  const st = STATE.get(owned);
  if (st) st.surrendered = true;
}

/**
 * The owner's "never sent" record. Surrender happens FIRST and holds whatever
 * the outcome. Proves this request only on a validated create.
 */
export async function publishNotDispatched(store: VerifiedStore, owned: OwnedSend): Promise<"this_request" | "nothing"> {
  if (!LIVE.has(owned)) return "nothing";
  const st = STATE.get(owned)!;
  const wasConsumed = st.consumed;
  const wasSurrendered = st.surrendered;
  surrender(owned);
  // A consumed send may have been issued: it can never be recorded as not dispatched.
  if (wasConsumed || wasSurrendered) return "nothing";
  owned.scope.enterCleanup();
  try {
    const w = await store.createOnce(owned.outcomeKey, { kind: "not_dispatched", at: new Date().toISOString(), claimantHash: owned.record.claimantHash }, "outcome_record");
    return w.result === "written" ? "this_request" : "nothing";
  } catch { return "nothing"; }
}

/** A withdrawal by a NON-owner (atomic). Proves this request only on a validated create. */
export async function withdraw(store: VerifiedStore, decisionKey: string): Promise<"this_request" | "nothing"> {
  try {
    const w = await store.createOnce(decisionKey, { d: "withdrawn", at: new Date().toISOString() }, "decision_withdraw");
    return w.result === "written" ? "this_request" : "nothing";
  } catch { return "nothing"; }
}
