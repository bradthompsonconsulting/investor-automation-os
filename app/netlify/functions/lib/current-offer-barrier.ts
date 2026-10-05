/**
 * Board 15 / PR #126 stacked server PR (Jess architecture ruling, 2026-10-05)
 * -- the DURABLE Current Offer barrier.
 *
 * Why: the browser-side save coordinator (src/lib/current-offer-save-
 * coordinator.ts) blocks an unresolved deal only while one tab stays loaded.
 * A reload, another browser or another operator could submit again while an
 * earlier request may still land. This module keeps that state in durable
 * server records, scoped to environment + location + opportunity, and lets
 * every session see and respect it.
 *
 * Records (store "iaos-write-receipts", own prefix `current-offer/`, own
 * semantics -- shares nothing with the Under Contract stage marker beyond the
 * store, `digest` and the contact lock; digest-only apart from timestamps):
 *
 *   barrier/   ONE per opportunity, claimed atomically (onlyIfNew) by
 *              `begin` before the browser sends anything. Lists the request
 *              digests of the steps it owns: blur -> [offer]; Confirm Accept
 *              -> [offer, note, touch]. While it exists every other `begin`,
 *              from any browser, operator or reload, is refused.
 *   request/   one per request id: which opportunity, barrier and step it
 *              belongs to. Lets `ghl-write` recognise a barrier-owned request
 *              (the note and last-touch target the contact, not the deal).
 *   decision/  one per request: "send" or "withdrawn", claimed atomically
 *              (onlyIfNew) -- exactly one can ever exist. `ghl-write` claims
 *              "send" INSIDE the write boundary immediately before the GHL
 *              call (`claimDispatch`); `reconcile` claims "withdrawn". A
 *              request whose decision is "withdrawn" can never be sent: a late
 *              handler loses the claim and sends nothing.
 *   outcome/   one per request, written by the handler that owns "send":
 *              confirmed (GHL answered and the readback verified),
 *              not_dispatched (the owner never reached the GHL call), or
 *              uncertain. Absent if the function died.
 *
 * Clearing (`releaseIfSettled`, `reconcile`) needs EVIDENCE for every step:
 *   withdrawn       never sent, and now never can be;
 *   confirmed       GHL answered and the server readback verified it;
 *   not_dispatched  the owning handler recorded that it never called GHL.
 * A step with "send" and an uncertain or missing outcome may still be applied
 * by GHL -- HighLevel documents no idempotency key, cancellation or request
 * status for these endpoints -- so it is NEVER cleared here: not by a fresh
 * read, not by elapsed time, not by an operator. Only the reviewed procedure
 * (docs/CURRENT_OFFER_RECOVERY_PROCEDURE.md) may resolve it, and it may
 * conclude that it cannot yet be cleared.
 *
 * Every mutation that can DELETE a barrier runs under the existing contact
 * lock (callers hold it), and `begin` takes the same lock, so a delete can
 * never remove a newer barrier. Storage failures throw; callers treat any
 * failure as "not cleared, nothing sent".
 */
import { digest } from "./ghl-write-boundary";

export interface BarrierStore {
  get(key: string, options?: { type: "json"; consistency?: "strong" | "eventual" }): Promise<any>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
}

export type BarrierPurpose = "blur" | "accept";
export type BarrierStep = "offer" | "note" | "touch";
export const STEP_OPERATION: Record<BarrierStep, string> = {
  offer: "opportunity.currentOffer",
  note: "note.create",
  touch: "contact.lastCallAttempt",
};
export const PURPOSE_STEPS: Record<BarrierPurpose, BarrierStep[]> = {
  blur: ["offer"],
  accept: ["offer", "note", "touch"],
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
const barrierKey = (scope: string, opp: string) => `${PREFIX}barrier/${digest(`${scope}:${opp}`)}`;
const requestKey = (scope: string, requestId: string) => `${PREFIX}request/${digest(`${scope}:${requestId}`)}`;
const decisionKey = (scope: string, opp: string, requestDigest: string) => `${PREFIX}decision/${digest(`${scope}:${opp}:${requestDigest}`)}`;
const outcomeKey = (scope: string, opp: string, requestDigest: string) => `${PREFIX}outcome/${digest(`${scope}:${opp}:${requestDigest}`)}`;

type BarrierRecord = { v: 1; oppDigest: string; contactDigest: string; purpose: BarrierPurpose; barrierId: string; steps: { step: BarrierStep; requestDigest: string }[]; createdAt: string };
type RequestRecord = { v: 1; opp: string; contactId: string; step: BarrierStep; barrierId: string };

/** The owning handler never reached the GHL call (or lost the claim). Proof nothing was sent by this request. */
export class NotSent extends Error { constructor(message: string, readonly refusal?: unknown) { super(message); } }
/** `begin` refused: this deal already has a barrier. */
export class BarrierHeld extends Error { constructor(readonly status: BarrierState) { super("This Current Offer has an unresolved save."); } }

async function readJson(store: BarrierStore, key: string): Promise<any> {
  try { return await store.get(key, { type: "json", consistency: "strong" }); }
  catch (e: any) {
    // Lambda-compatibility functions cannot make strong reads (see write-receipts.ts).
    if (e?.name !== "BlobsConsistencyError") throw e;
    return store.get(key, { type: "json" });
  }
}

export function validateSteps(purpose: unknown, steps: unknown): { purpose: BarrierPurpose; steps: { step: BarrierStep; requestId: string }[] } {
  if (purpose !== "blur" && purpose !== "accept") throw new Error("Invalid purpose");
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

/**
 * Claims the deal's barrier before anything is sent. Caller holds the contact
 * lock and has verified (by a fresh GHL read) that `contactId` owns `opp`.
 * Idempotent for the SAME first request id (a retried `begin` whose response
 * was lost). Refuses with BarrierHeld when another barrier exists.
 */
export async function beginBarrier(store: BarrierStore, scope: string, input: { opp: string; contactId: string; purpose: BarrierPurpose; steps: { step: BarrierStep; requestId: string }[] }, now: string): Promise<void> {
  const barrierId = digest(input.steps[0].requestId);
  const record: BarrierRecord = {
    v: 1, oppDigest: digest(input.opp), contactDigest: digest(input.contactId), purpose: input.purpose, barrierId,
    steps: input.steps.map((s) => ({ step: s.step, requestDigest: digest(s.requestId) })), createdAt: now,
  };
  const claimed = await store.setJSON(barrierKey(scope, input.opp), record, { onlyIfNew: true });
  if (!claimed.modified) {
    const existing = await readJson(store, barrierKey(scope, input.opp)) as BarrierRecord | null;
    if (!existing || existing.barrierId !== barrierId) throw new BarrierHeld(await statusOf(store, scope, input.opp));
  }
  for (const s of input.steps) {
    const reg: RequestRecord = { v: 1, opp: input.opp, contactId: input.contactId, step: s.step, barrierId };
    const r = await store.setJSON(requestKey(scope, s.requestId), reg, { onlyIfNew: true });
    if (!r.modified) {
      const existing = await readJson(store, requestKey(scope, s.requestId)) as RequestRecord | null;
      if (!existing || existing.barrierId !== barrierId || existing.opp !== input.opp || existing.step !== s.step) throw new Error("Request id already used");
    }
  }
}

async function stepEvidence(store: BarrierStore, scope: string, opp: string, requestDigest: string, withdrawPending: boolean): Promise<StepEvidence> {
  let decision = await readJson(store, decisionKey(scope, opp, requestDigest)) as { d: "send" | "withdrawn" } | null;
  if (!decision && withdrawPending) {
    const w = await store.setJSON(decisionKey(scope, opp, requestDigest), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
    decision = w.modified ? { d: "withdrawn" } : await readJson(store, decisionKey(scope, opp, requestDigest));
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

async function evaluate(store: BarrierStore, scope: string, opp: string, withdrawPending: boolean): Promise<BarrierState> {
  const barrier = await readJson(store, barrierKey(scope, opp)) as BarrierRecord | null;
  if (!barrier) return { state: "clear" };
  const steps: { step: BarrierStep; evidence: StepEvidence }[] = [];
  for (const s of barrier.steps) steps.push({ step: s.step, evidence: await stepEvidence(store, scope, opp, s.requestDigest, withdrawPending) });
  return { state: "blocked", purpose: barrier.purpose, createdAt: barrier.createdAt, steps };
}

/** Read-only status for any session (never claims, never clears). */
export async function statusOf(store: BarrierStore, scope: string, opp: string): Promise<BarrierState> {
  return evaluate(store, scope, opp, false);
}

/**
 * Clears the barrier only when EVERY step has evidence (withdrawn, confirmed,
 * not_dispatched). Caller holds the contact lock. Never withdraws.
 */
export async function releaseIfSettled(store: BarrierStore, scope: string, opp: string): Promise<BarrierState> {
  const s = await evaluate(store, scope, opp, false);
  if (s.state === "blocked" && s.steps.every((x) => SETTLED.includes(x.evidence))) {
    await store.delete(barrierKey(scope, opp));
    return { state: "clear" };
  }
  return s;
}

/**
 * Evidence-based recovery. Caller holds the contact lock. Withdraws every step
 * that has no decision yet (atomically -- such a request can then never be
 * sent), then clears only if every step is settled. A step that was sent and
 * is unresolved keeps the barrier; nothing here (no read of GHL, no elapsed
 * time, no operator) can clear it.
 */
export async function reconcileBarrier(store: BarrierStore, scope: string, opp: string): Promise<BarrierState> {
  const s = await evaluate(store, scope, opp, true);
  if (s.state === "blocked" && s.steps.every((x) => SETTLED.includes(x.evidence))) {
    await store.delete(barrierKey(scope, opp));
    return { state: "clear" };
  }
  return s;
}

/**
 * Wraps one barrier-owned write in `ghl-write` (caller holds the contact
 * lock). `body` performs the existing write; the write boundary must call
 * `hooks.beforeDispatch()` immediately before the GHL call and set
 * `hooks.state.dispatched = true` right after it returns, BEFORE the GHL call.
 *
 * Returns `null` when `requestId` is not barrier-owned (the caller proceeds
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
  const barrier = await readJson(store, barrierKey(scope, reg.opp)) as BarrierRecord | null;
  if (!barrier || barrier.barrierId !== reg.barrierId || !barrier.steps.some((s) => s.requestDigest === requestDigest && s.step === reg.step)) {
    throw new NotSent("The reservation for this save is no longer current");
  }
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
        await releaseIfSettled(store, scope, reg.opp);
      } catch { /* the barrier stays; still nothing was sent */ }
      throw new NotSent(error instanceof Error ? error.message : "Not sent", error instanceof NotSent && error.refusal !== undefined ? error.refusal : error);
    }
    try { await store.setJSON(outcomeKey(scope, reg.opp, requestDigest), { kind: "uncertain", at: new Date().toISOString() }, { onlyIfNew: true }); } catch { /* absent outcome = unresolved */ }
    throw error;
  }
  try {
    await store.setJSON(outcomeKey(scope, reg.opp, requestDigest), { kind: result.confirmed ? "confirmed" : "uncertain", at: new Date().toISOString() }, { onlyIfNew: true });
    if (result.confirmed) await releaseIfSettled(store, scope, reg.opp);
  } catch { /* the barrier stays: a later reconcile reads the evidence */ }
  return result;
}
/** The request id is not barrier-owned. */
export class NotOwned extends Error {}

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
