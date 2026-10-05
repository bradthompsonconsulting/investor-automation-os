/**
 * Board 15 / PR #126 stacked server PR -- the DURABLE Current Offer barrier.
 *
 * Why: the browser-side save coordinator (src/lib/current-offer-save-
 * coordinator.ts) blocks an unresolved deal only while one tab stays loaded.
 * A reload, another browser or another operator could submit again while an
 * earlier request may still land. This module keeps that state in durable
 * server records, scoped to environment + location + opportunity, that every
 * session sees and respects.
 *
 * Bones / Jess, 2026-10-05 (second review): storage reads in Lambda-
 * compatibility functions may be STALE, and the Blobs API has no conditional
 * delete. So nothing here is ever deleted, and the one mutable record changes
 * only by compare-and-swap:
 *
 *   head/      ONE per opportunity: { current: barrierId | null }. Changed
 *              ONLY by a conditional write -- `onlyIfNew` when absent,
 *              `onlyIfMatch: <etag>` otherwise. A decision based on a stale
 *              read carries a stale etag, so its write fails and it re-reads:
 *              stale evidence can never clear or replace a newer barrier.
 *   barrier/   ONE per barrier id, write-once: purpose and the request digests
 *              of the steps it owns (blur -> [offer]; Confirm Accept ->
 *              [offer, note, touch]; the Accept timestamp recovery -> [touch]).
 *   request/   ONE per request id, write-once: its opportunity, contact, step
 *              and barrier.
 *   decision/  ONE per request, write-once ("send" | "withdrawn", onlyIfNew).
 *              `ghl-write` claims "send" INSIDE the write boundary immediately
 *              before the GHL call; reconcile claims "withdrawn". A withdrawn
 *              request can never be sent -- a late handler loses the claim.
 *   outcome/   ONE per request, write-once: confirmed | not_dispatched |
 *              uncertain, written only by the handler that owns "send".
 *
 * Every record is write-once except `head`, so a stale read of any of them can
 * only be MISSING data (never wrong data): a missing decision makes the
 * withdraw claim fail and re-read; a missing outcome reads as unresolved and
 * keeps the barrier. "Clear" is reported only after a conditional write
 * succeeded against the latest head -- never from a read alone.
 *
 * Clearing needs EVIDENCE for every step of the current barrier:
 *   withdrawn       never sent, and now never can be;
 *   confirmed       GHL answered and the server readback verified it;
 *   not_dispatched  the owning handler recorded that it never called GHL.
 * A step with "send" and an uncertain or missing outcome may still be applied
 * by GHL -- HighLevel documents no idempotency key, cancellation or request
 * status for these endpoints -- so it is NEVER cleared here: not by a fresh
 * read, not by elapsed time, not by an operator. Only the reviewed procedure
 * (docs/CURRENT_OFFER_RECOVERY_PROCEDURE.md) may resolve it.
 *
 * The existing contact lock still serializes begin / reconcile / owned writes
 * per contact, but safety does not depend on it: the conditional head write
 * does. Storage failures throw; callers treat any failure as "not cleared,
 * nothing sent".
 */
import { digest } from "./ghl-write-boundary";

export interface BarrierStore {
  get(key: string, options?: { type: "json"; consistency?: "strong" | "eventual" }): Promise<any>;
  getWithMetadata(key: string, options?: { type: "json"; consistency?: "strong" | "eventual" }): Promise<{ data: any; etag?: string } | null>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<{ modified: boolean; etag?: string }>;
}

export type BarrierPurpose = "blur" | "accept" | "touch";
export type BarrierStep = "offer" | "note" | "touch";
export const STEP_OPERATION: Record<BarrierStep, string> = {
  offer: "opportunity.currentOffer",
  note: "note.create",
  touch: "contact.lastCallAttempt",
};
export const PURPOSE_STEPS: Record<BarrierPurpose, BarrierStep[]> = {
  blur: ["offer"],
  accept: ["offer", "note", "touch"],
  /** Confirm Accept's "Check & retry call timestamp": a last-touch request only. */
  touch: ["touch"],
};
export const STEP_LABEL: Record<BarrierStep, string> = {
  offer: "Current Offer save",
  note: "acceptance note",
  touch: "last-touch time",
};

export type StepEvidence = "withdrawn" | "confirmed" | "not_dispatched" | "unresolved" | "pending";
export type BarrierState =
  | { state: "clear" }
  | { state: "blocked"; purpose: BarrierPurpose; createdAt: string; steps: { step: BarrierStep; evidence: StepEvidence }[] };

const PREFIX = "current-offer/";
/** Scope = deployment environment + GHL location. Every key includes it. */
export function barrierScope(env: string, locationId: string): string { return `${env}:${locationId}`; }
const headKey = (scope: string, opp: string) => `${PREFIX}head/${digest(`${scope}:${opp}`)}`;
const barrierKey = (scope: string, opp: string, barrierId: string) => `${PREFIX}barrier/${digest(`${scope}:${opp}:${barrierId}`)}`;
const requestKey = (scope: string, requestId: string) => `${PREFIX}request/${digest(`${scope}:${requestId}`)}`;
const decisionKey = (scope: string, opp: string, requestDigest: string) => `${PREFIX}decision/${digest(`${scope}:${opp}:${requestDigest}`)}`;
const outcomeKey = (scope: string, opp: string, requestDigest: string) => `${PREFIX}outcome/${digest(`${scope}:${opp}:${requestDigest}`)}`;

type HeadRecord = { v: 2; current: string | null; at: string };
type BarrierRecord = { v: 2; oppDigest: string; contactDigest: string; purpose: BarrierPurpose; barrierId: string; steps: { step: BarrierStep; requestDigest: string }[]; createdAt: string };
type RequestRecord = { v: 2; opp: string; contactId: string; step: BarrierStep; barrierId: string };

/** The owning handler never reached the GHL call (or lost the claim). Proof nothing was sent by this request. */
export class NotSent extends Error { constructor(message: string, readonly refusal?: unknown) { super(message); } }
/** The request id is not barrier-owned. */
export class NotOwned extends Error {}
/** `begin` refused: this deal already has a barrier. */
export class BarrierHeld extends Error { constructor(readonly status: BarrierState) { super("This Current Offer has an unresolved save."); } }
/** The latest head could not be confirmed after retries (persistently stale or contended). Nothing changed. */
export class BarrierContended extends Error {}

const CAS_ATTEMPTS = 4;

async function readJson(store: BarrierStore, key: string): Promise<any> {
  try { return await store.get(key, { type: "json", consistency: "strong" }); }
  catch (e: any) {
    // Lambda-compatibility functions cannot make strong reads (see write-receipts.ts).
    if (e?.name !== "BlobsConsistencyError") throw e;
    return store.get(key, { type: "json" });
  }
}
async function readHead(store: BarrierStore, scope: string, opp: string): Promise<{ head: HeadRecord | null; etag: string | null }> {
  let got: { data: any; etag?: string } | null;
  try { got = await store.getWithMetadata(headKey(scope, opp), { type: "json", consistency: "strong" }); }
  catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    got = await store.getWithMetadata(headKey(scope, opp), { type: "json" });
  }
  if (!got) return { head: null, etag: null };
  if (!got.etag) throw new Error("Head read without an etag; cannot change it safely");
  return { head: got.data as HeadRecord, etag: got.etag };
}
/** The ONLY way the head changes: a conditional write against the etag that was read. */
async function casHead(store: BarrierStore, scope: string, opp: string, etag: string | null, next: HeadRecord): Promise<boolean> {
  const r = await store.setJSON(headKey(scope, opp), next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
  return r.modified;
}

export function validateSteps(purpose: unknown, steps: unknown): { purpose: BarrierPurpose; steps: { step: BarrierStep; requestId: string }[] } {
  if (purpose !== "blur" && purpose !== "accept" && purpose !== "touch") throw new Error("Invalid purpose");
  const expected = PURPOSE_STEPS[purpose];
  if (!Array.isArray(steps) || steps.length !== expected.length) throw new Error("Invalid steps");
  const out = steps.map((s: any, i: number) => {
    if (!s || typeof s !== "object" || Object.keys(s).sort().join() !== "requestId,step") throw new Error("Invalid step");
    if (s.step !== expected[i]) throw new Error("Steps out of order");
    if (typeof s.requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(s.requestId)) throw new Error("Invalid request id");
    return { step: s.step as BarrierStep, requestId: s.requestId as string };
  });
  if (new Set(out.map((s) => s.requestId)).size !== out.length) throw new Error("Duplicate request id");
  return { purpose, steps: out };
}

async function stepEvidence(store: BarrierStore, scope: string, opp: string, requestDigest: string, withdrawPending: boolean): Promise<StepEvidence> {
  let decision = await readJson(store, decisionKey(scope, opp, requestDigest)) as { d: "send" | "withdrawn" } | null;
  if (!decision && withdrawPending) {
    const w = await store.setJSON(decisionKey(scope, opp, requestDigest), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
    decision = w.modified ? { d: "withdrawn" } : await readJson(store, decisionKey(scope, opp, requestDigest));
    // A lost claim proves a decision exists; a read that cannot see it yet is stale.
    if (!decision) throw new Error("Decision unreadable after a lost claim");
  }
  if (!decision) return "pending";
  if (decision.d === "withdrawn") return "withdrawn";
  const outcome = await readJson(store, outcomeKey(scope, opp, requestDigest)) as { kind: string } | null;
  if (outcome?.kind === "confirmed") return "confirmed";
  if (outcome?.kind === "not_dispatched") return "not_dispatched";
  return "unresolved";
}

const SETTLED: StepEvidence[] = ["withdrawn", "confirmed", "not_dispatched"];

async function evaluateBarrier(store: BarrierStore, scope: string, opp: string, barrierId: string, withdrawPending: boolean): Promise<BarrierState & { state: "blocked" }> {
  const barrier = await readJson(store, barrierKey(scope, opp, barrierId)) as BarrierRecord | null;
  // The head names it, and barrier records are written before the head: a
  // missing record is a stale read. Fail closed.
  if (!barrier) throw new Error("Barrier record unreadable");
  const steps: { step: BarrierStep; evidence: StepEvidence }[] = [];
  for (const s of barrier.steps) steps.push({ step: s.step, evidence: await stepEvidence(store, scope, opp, s.requestDigest, withdrawPending) });
  return { state: "blocked", purpose: barrier.purpose, createdAt: barrier.createdAt, steps };
}
const settled = (s: { steps: { evidence: StepEvidence }[] }) => s.steps.every((x) => SETTLED.includes(x.evidence));

/**
 * Claims the deal before anything is sent. The caller has verified (by a fresh
 * GHL read) that `contactId` owns `opp`. Idempotent for the SAME first request
 * id (a retried `begin` whose response was lost). Refuses with BarrierHeld when
 * another barrier is current.
 */
export async function beginBarrier(store: BarrierStore, scope: string, input: { opp: string; contactId: string; purpose: BarrierPurpose; steps: { step: BarrierStep; requestId: string }[] }, now: string): Promise<void> {
  const barrierId = digest(input.steps[0].requestId);
  const record: BarrierRecord = {
    v: 2, oppDigest: digest(input.opp), contactDigest: digest(input.contactId), purpose: input.purpose, barrierId,
    steps: input.steps.map((s) => ({ step: s.step, requestDigest: digest(s.requestId) })), createdAt: now,
  };
  // Write-once records first, so the head never names a missing barrier.
  const b = await store.setJSON(barrierKey(scope, input.opp, barrierId), record, { onlyIfNew: true });
  if (!b.modified) {
    const existing = await readJson(store, barrierKey(scope, input.opp, barrierId)) as BarrierRecord | null;
    if (existing && existing.barrierId !== barrierId) throw new Error("Barrier id collision");
  }
  for (const s of input.steps) {
    const reg: RequestRecord = { v: 2, opp: input.opp, contactId: input.contactId, step: s.step, barrierId };
    const r = await store.setJSON(requestKey(scope, s.requestId), reg, { onlyIfNew: true });
    if (!r.modified) {
      const existing = await readJson(store, requestKey(scope, s.requestId)) as RequestRecord | null;
      if (!existing || existing.barrierId !== barrierId || existing.opp !== input.opp || existing.step !== s.step) throw new Error("Request id already used");
    }
  }
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const { head, etag } = await readHead(store, scope, input.opp);
    if (head && head.current === barrierId) return;                       // a retried begin
    if (head && head.current !== null) throw new BarrierHeld(await evaluateBarrier(store, scope, input.opp, head.current, false));
    if (await casHead(store, scope, input.opp, etag, { v: 2, current: barrierId, at: now })) return;
    // Lost the swap: the head changed (or our read was stale). Re-read.
  }
  throw new BarrierContended("The Current Offer reservation could not be confirmed");
}

/** Read-only status for any session (never claims, never clears). May lag; it only ever adds a block. */
export async function statusOf(store: BarrierStore, scope: string, opp: string): Promise<BarrierState> {
  const { head } = await readHead(store, scope, opp);
  if (!head || head.current === null) return { state: "clear" };
  return evaluateBarrier(store, scope, opp, head.current, false);
}

/**
 * Called by the handler that just settled a step of `barrierId`: releases the
 * head only if it still names THAT barrier and every step has evidence -- by a
 * conditional write, so a stale view can never release a newer barrier.
 * Never withdraws.
 */
export async function releaseIfSettled(store: BarrierStore, scope: string, opp: string, barrierId: string): Promise<void> {
  const { head, etag } = await readHead(store, scope, opp);
  if (!head || head.current !== barrierId || etag === null) return;
  const s = await evaluateBarrier(store, scope, opp, barrierId, false);
  if (settled(s)) await casHead(store, scope, opp, etag, { v: 2, current: null, at: new Date().toISOString() });
  // A lost swap means the head moved; nothing else is touched. Reconcile reads it again.
}

/**
 * Evidence-based recovery ("Check again"). Withdraws every step of the CURRENT
 * barrier that has no decision yet (atomically -- such a request can then never
 * be sent), and releases the head only if every step is settled. "Clear" is
 * returned only after a conditional write succeeded against the latest head:
 * a stale read can never report clear, and can never release a newer barrier.
 * A step that was sent and is unresolved keeps the barrier -- nothing here (no
 * read of GHL, no elapsed time, no operator) can clear it.
 */
export async function reconcileBarrier(store: BarrierStore, scope: string, opp: string): Promise<BarrierState> {
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const { head, etag } = await readHead(store, scope, opp);
    const now = new Date().toISOString();
    if (!head || head.current === null) {
      // Confirm "no barrier" by writing the empty head against what we read.
      if (await casHead(store, scope, opp, etag, { v: 2, current: null, at: now })) return { state: "clear" };
      continue;
    }
    const s = await evaluateBarrier(store, scope, opp, head.current, true);
    if (!settled(s)) return s;
    if (await casHead(store, scope, opp, etag, { v: 2, current: null, at: now })) return { state: "clear" };
    // The head moved since we read it (or the read was stale): evaluate again.
  }
  throw new BarrierContended("The Current Offer barrier could not be confirmed");
}

/**
 * Wraps one barrier-owned write in `ghl-write` (caller holds the contact
 * lock). `body` performs the existing write; the write boundary must call
 * `hooks.beforeDispatch()` immediately before the GHL call and set
 * `hooks.state.dispatched = true` right after it returns, BEFORE the GHL call.
 *
 * Throws NotOwned when `requestId` is not barrier-owned (the caller proceeds
 * exactly as before). Throws NotSent when this request provably sent nothing
 * (the caller answers `outcome: "not_sent"`); re-throws the body's error
 * after recording `uncertain` when the GHL call may have been made.
 */
export async function runOwnedWrite<T extends { confirmed: boolean }>(
  store: BarrierStore, scope: string,
  request: { operation: string; targetId: string; requestId: string; contactId: string },
  body: (hooks: { beforeDispatch: () => Promise<void>; state: { dispatched: boolean } }) => Promise<T>,
): Promise<T> {
  const reg = await readJson(store, requestKey(scope, request.requestId)) as RequestRecord | null;
  if (!reg) throw new NotOwned();
  const requestDigest = digest(request.requestId);
  if (STEP_OPERATION[reg.step] !== request.operation) throw new NotSent("Request is reserved for a different step");
  const target = reg.step === "offer" ? reg.opp : reg.contactId;
  if (request.targetId !== target || request.contactId !== reg.contactId) throw new NotSent("Request is reserved for a different target");
  // Advisory only (the read may lag): the atomic send claim below is the guard.
  const { head } = await readHead(store, scope, reg.opp);
  if (!head || head.current !== reg.barrierId) throw new NotSent("The reservation for this save is not current");
  const state = { dispatched: false, claimed: false };
  const hooks = {
    state,
    beforeDispatch: async () => {
      const claim = await store.setJSON(decisionKey(scope, reg.opp, requestDigest), { d: "send", at: new Date().toISOString() }, { onlyIfNew: true });
      if (!claim.modified) throw new NotSent("This save was withdrawn or already sent");
      state.claimed = true;
    },
  };
  let result: T;
  try {
    result = await body(hooks);
  } catch (error) {
    if (!state.dispatched) {
      // Nothing was sent by this request. Make sure it never can be, then
      // release if everything is settled. Only the owner of "send" may record
      // not_dispatched; a non-owner only tries to withdraw.
      try {
        if (state.claimed) await store.setJSON(outcomeKey(scope, reg.opp, requestDigest), { kind: "not_dispatched", at: new Date().toISOString() }, { onlyIfNew: true });
        else await store.setJSON(decisionKey(scope, reg.opp, requestDigest), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
        await releaseIfSettled(store, scope, reg.opp, reg.barrierId);
      } catch { /* the barrier stays; still nothing was sent */ }
      throw new NotSent(error instanceof Error ? error.message : "Not sent", error instanceof NotSent && error.refusal !== undefined ? error.refusal : error);
    }
    try { await store.setJSON(outcomeKey(scope, reg.opp, requestDigest), { kind: "uncertain", at: new Date().toISOString() }, { onlyIfNew: true }); } catch { /* absent outcome = unresolved */ }
    throw error;
  }
  try {
    await store.setJSON(outcomeKey(scope, reg.opp, requestDigest), { kind: result.confirmed ? "confirmed" : "uncertain", at: new Date().toISOString() }, { onlyIfNew: true });
    if (result.confirmed) await releaseIfSettled(store, scope, reg.opp, reg.barrierId);
  } catch { /* the barrier stays: a later reconcile reads the evidence */ }
  return result;
}

/** Whether a request id is barrier-owned (no side effects). */
export async function isBarrierOwned(store: BarrierStore, scope: string, requestId: string): Promise<boolean> {
  return (await readJson(store, requestKey(scope, requestId))) !== null;
}

/** The operator-facing explanation of a blocked state. Never instructs a reload. */
export function describeBlocked(s: BarrierState): string {
  if (s.state === "clear") return "";
  const open = s.steps.filter((x) => !SETTLED.includes(x.evidence));
  const sent = open.filter((x) => x.evidence === "unresolved").map((x) => STEP_LABEL[x.step]);
  if (sent.length) {
    return `Unresolved — the ${sent.join(" and ")} may still reach GHL. Nothing more will be sent for this Current Offer. It stays blocked until the recovery procedure establishes what happened.`;
  }
  return "A Current Offer save for this deal is in progress or was interrupted. Nothing more will be sent until it is resolved — use Check again.";
}
