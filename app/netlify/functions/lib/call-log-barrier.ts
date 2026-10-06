/**
 * Board 15 / PR #131 (Bones, re-review of 808e105) -- DURABLE call-log
 * ownership. Lifecycle and failure map: docs/CALL_LOG_SAVE_LIFECYCLE.md.
 *
 * A contact-page "Save call" is three GHL writes in order: the result
 * (`contact.callLogResult`), the call note (`note.create`) and the last touch
 * (`contact.lastCallAttempt`). The browser alone cannot own that sequence: a
 * reload, a navigation or another session forgets it, and could then submit a
 * competing result or a second copy of a note that may already have landed.
 * This module keeps the ownership in durable server records, scoped to
 * environment + location + CONTACT, separate from the deal-scoped Current
 * Offer barrier (current-offer-barrier.ts), whose record discipline it reuses:
 *
 *   head/      ONE per contact: { current: barrierId | null }, changed ONLY by
 *              compare-and-swap (`onlyIfNew` / `onlyIfMatch: <etag>`), so a
 *              decision made on a stale read can never clear or replace a
 *              newer barrier.
 *   barrier/   ONE per attempt, write-once: the result, the exact note body,
 *              and each step's ORIGINAL request id, in order. Kept so any
 *              session can finish the attempt with the same identities.
 *   request/   ONE per request id, write-once: its contact, step and barrier.
 *   decision/  ONE per request, write-once: "send" (claimed by ghl-write
 *              inside the write boundary, immediately before the GHL call) or
 *              "withdrawn" (claimed by reconcile). Whoever claims first wins;
 *              a request that lost can never be sent.
 *   outcome/   ONE per request, write-once: confirmed | not_dispatched |
 *              uncertain, written only by the handler that owns "send".
 *
 * Nothing is ever deleted (the Blobs API has no conditional delete).
 *
 * Two rules the Current Offer barrier does not need:
 *   ORDER    a step is sent only when the previous step's outcome is
 *            CONFIRMED (enforced here, server-side). A note can therefore never
 *            be sent unless its result landed, and never twice: its one request
 *            id can claim "send" once.
 *   RESUME   a step with no decision behind a confirmed step is NOT withdrawn
 *            by reconcile: the attempt is finished later with that step's
 *            ORIGINAL request id (never a fresh one), from any session.
 *
 * A step that was sent and whose outcome is uncertain or missing may still be
 * applied by GHL; nothing here clears it -- not a GHL read, not elapsed time,
 * not an operator. Only the reviewed procedure may
 * (docs/CALL_LOG_RECOVERY_PROCEDURE.md).
 */
import { digest } from "./ghl-write-boundary";
import { isCallLogNoteBody } from "./production-write-scope";
import { callLogResults } from "./write-contracts";
import type { BarrierStore } from "./current-offer-barrier";

export type CallLogPurpose = "call_log" | "call_log_note";
export type CallLogStep = "result" | "note" | "touch";
export const CALL_LOG_STEP_OPERATION: Record<CallLogStep, string> = {
  result: "contact.callLogResult",
  note: "note.create",
  touch: "contact.lastCallAttempt",
};
export const CALL_LOG_PURPOSE_STEPS: Record<CallLogPurpose, CallLogStep[]> = {
  /** Save call: the result, its call note, the last touch. */
  call_log: ["result", "note", "touch"],
  /** Retry notes: after a call's note was PROVABLY never sent (withdrawn or not dispatched). */
  call_log_note: ["note", "touch"],
};
export const CALL_LOG_OPERATIONS = new Set(Object.values(CALL_LOG_STEP_OPERATION));
/** Every note IAOS writes for the call log starts with this; such a note is only ever sent under a reservation. */
export const CALL_LOG_NOTE_MARK = "Call (reported by Brad in IAOS):";
export function isCallLogNoteText(body: unknown): boolean {
  return typeof body === "string" && body.startsWith(CALL_LOG_NOTE_MARK);
}

export type StepEvidence = "withdrawn" | "confirmed" | "not_dispatched" | "unresolved" | "pending";
export type CallLogView =
  | { state: "clear" }
  | { state: "blocked"; kind: "uncertain" | "pending" | "resumable"; purpose: CallLogPurpose; result: string; createdAt: string; steps: { step: CallLogStep; evidence: StepEvidence }[] };
/** What reconcile found and did. `remaining` (original request ids) only when the attempt can be finished. */
export type CallLogReconcile =
  | { state: "clear"; summary: null | { purpose: CallLogPurpose; result: string; body: string; steps: { step: CallLogStep; evidence: StepEvidence }[] } }
  | (CallLogView & { state: "blocked"; body?: string; attempt?: string; remaining?: { step: CallLogStep; requestId: string }[] });

const PREFIX = "call-log/";
export function callLogScope(env: string, locationId: string): string { return `${env}:${locationId}`; }
const headKey = (scope: string, contact: string) => `${PREFIX}head/${digest(`${scope}:${contact}`)}`;
const barrierKey = (scope: string, contact: string, barrierId: string) => `${PREFIX}barrier/${digest(`${scope}:${contact}:${barrierId}`)}`;
const requestKey = (scope: string, requestId: string) => `${PREFIX}request/${digest(`${scope}:${requestId}`)}`;
const decisionKey = (scope: string, contact: string, requestDigest: string) => `${PREFIX}decision/${digest(`${scope}:${contact}:${requestDigest}`)}`;
const outcomeKey = (scope: string, contact: string, requestDigest: string) => `${PREFIX}outcome/${digest(`${scope}:${contact}:${requestDigest}`)}`;

type HeadRecord = { v: 1; current: string | null; at: string };
type BarrierRecord = {
  v: 1; contactDigest: string; purpose: CallLogPurpose; barrierId: string; result: string; body: string; bodyDigest: string;
  steps: { step: CallLogStep; requestId: string; requestDigest: string }[]; createdAt: string;
};
type RequestRecord = { v: 1; contactId: string; step: CallLogStep; barrierId: string };

/** This request provably sent nothing. `withdraw: false` leaves its step undecided (resumable). */
export class NotSent extends Error { constructor(message: string, readonly refusal?: unknown) { super(message); } }
export class NotOwned extends Error {}
export class CallLogHeld extends Error { constructor(readonly status: CallLogView) { super("This contact has an unfinished call save."); } }
export class CallLogContended extends Error {}
export class ReservationMismatch extends Error {}

const CAS_ATTEMPTS = 4;
async function readJson(store: BarrierStore, key: string): Promise<any> {
  try { return await store.get(key, { type: "json", consistency: "strong" }); }
  catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    return store.get(key, { type: "json" });
  }
}
async function readHead(store: BarrierStore, scope: string, contact: string): Promise<{ head: HeadRecord | null; etag: string | null }> {
  let got: { data: any; etag?: string } | null;
  try { got = await store.getWithMetadata(headKey(scope, contact), { type: "json", consistency: "strong" }); }
  catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    got = await store.getWithMetadata(headKey(scope, contact), { type: "json" });
  }
  if (!got) return { head: null, etag: null };
  if (!got.etag) throw new Error("Head read without an etag; cannot change it safely");
  return { head: got.data as HeadRecord, etag: got.etag };
}
async function casHead(store: BarrierStore, scope: string, contact: string, etag: string | null, next: HeadRecord): Promise<boolean> {
  const r = await store.setJSON(headKey(scope, contact), next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
  return r.modified;
}

/** Validates a begin request. The note body must be an exact call-log note for this result. */
export function validateBegin(purpose: unknown, result: unknown, body: unknown, steps: unknown): { purpose: CallLogPurpose; result: string; body: string; steps: { step: CallLogStep; requestId: string }[] } {
  if (!Object.prototype.hasOwnProperty.call(CALL_LOG_PURPOSE_STEPS, purpose as string)) throw new Error("Invalid purpose");
  if (typeof result !== "string" || !callLogResults.includes(result)) throw new Error("Invalid result");
  if (typeof body !== "string" || !isCallLogNoteBody(body)) throw new Error("Invalid call note");
  const first = body.indexOf("\n") === -1 ? body : body.slice(0, body.indexOf("\n"));
  if (first !== `${CALL_LOG_NOTE_MARK} ${result}`) throw new Error("The note does not name this result");
  const expected = CALL_LOG_PURPOSE_STEPS[purpose as CallLogPurpose];
  if (!Array.isArray(steps) || steps.length !== expected.length) throw new Error("Invalid steps");
  const out = steps.map((s: any, i: number) => {
    if (!s || typeof s !== "object" || Object.keys(s).sort().join() !== "requestId,step") throw new Error("Invalid step");
    if (s.step !== expected[i]) throw new Error("Steps out of order");
    if (typeof s.requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(s.requestId)) throw new Error("Invalid request id");
    return { step: s.step as CallLogStep, requestId: s.requestId as string };
  });
  if (new Set(out.map((s) => s.requestId)).size !== out.length) throw new Error("Duplicate request id");
  return { purpose: purpose as CallLogPurpose, result, body, steps: out };
}

function sameReservation(a: BarrierRecord, b: BarrierRecord): boolean {
  return a.barrierId === b.barrierId && a.contactDigest === b.contactDigest && a.purpose === b.purpose && a.result === b.result && a.bodyDigest === b.bodyDigest
    && a.steps.length === b.steps.length && a.steps.every((s, i) => s.step === b.steps[i].step && s.requestId === b.steps[i].requestId);
}

async function stepEvidence(store: BarrierStore, scope: string, contact: string, requestDigest: string): Promise<StepEvidence> {
  const decision = await readJson(store, decisionKey(scope, contact, requestDigest)) as { d: "send" | "withdrawn" } | null;
  if (!decision) return "pending";
  if (decision.d === "withdrawn") return "withdrawn";
  const outcome = await readJson(store, outcomeKey(scope, contact, requestDigest)) as { kind: string } | null;
  if (outcome?.kind === "confirmed") return "confirmed";
  if (outcome?.kind === "not_dispatched") return "not_dispatched";
  return "unresolved";
}
/** Atomically withdraws an undecided request. Returns the decision that now exists. */
async function withdraw(store: BarrierStore, scope: string, contact: string, requestDigest: string): Promise<"withdrawn" | "send"> {
  const w = await store.setJSON(decisionKey(scope, contact, requestDigest), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
  if (w.modified) return "withdrawn";
  const now = await readJson(store, decisionKey(scope, contact, requestDigest)) as { d: "send" | "withdrawn" } | null;
  // A lost claim proves a decision exists; a read that cannot see it yet is stale.
  if (!now) throw new Error("Decision unreadable after a lost claim");
  return now.d;
}

async function readBarrier(store: BarrierStore, scope: string, contact: string, barrierId: string): Promise<BarrierRecord> {
  const b = await readJson(store, barrierKey(scope, contact, barrierId)) as BarrierRecord | null;
  // The head names it and barrier records are written before the head: a missing record is a stale read. Fail closed.
  if (!b) throw new Error("Call-log barrier record unreadable");
  return b;
}
async function evaluate(store: BarrierStore, scope: string, contact: string, b: BarrierRecord) {
  const steps: { step: CallLogStep; evidence: StepEvidence }[] = [];
  for (const s of b.steps) steps.push({ step: s.step, evidence: await stepEvidence(store, scope, contact, s.requestDigest) });
  return steps;
}

/**
 * Where the attempt stands, from its evidence, step by step in order:
 *   complete   every step confirmed;
 *   uncertain  a step was sent and its outcome is unknown -- it may still land;
 *   pending    the FIRST step has no decision -- it may still be on its way;
 *   resumable  a later step has no decision behind a confirmed step;
 *   stopped    a step was provably never sent (withdrawn / not dispatched) --
 *              by the ORDER rule nothing after it can ever be sent.
 */
type Standing = { kind: "complete" } | { kind: "uncertain"; at: number } | { kind: "pending" } | { kind: "resumable"; at: number } | { kind: "stopped"; at: number };
function standing(steps: { evidence: StepEvidence }[]): Standing {
  for (let i = 0; i < steps.length; i++) {
    const e = steps[i].evidence;
    if (e === "confirmed") continue;
    if (e === "unresolved") return { kind: "uncertain", at: i };
    // Defensive: by the ORDER rule nothing after an unconfirmed step can have
    // been sent -- but if any later step shows a send, the evidence wins.
    const later = steps.slice(i + 1).findIndex((x) => x.evidence === "unresolved");
    if (later >= 0) return { kind: "uncertain", at: i + 1 + later };
    if (e === "pending") return i === 0 ? { kind: "pending" } : { kind: "resumable", at: i };
    return { kind: "stopped", at: i };
  }
  return { kind: "complete" };
}
const view = (b: BarrierRecord, steps: { step: CallLogStep; evidence: StepEvidence }[], kind: "uncertain" | "pending" | "resumable"): CallLogView & { state: "blocked" } =>
  ({ state: "blocked", kind, purpose: b.purpose, result: b.result, createdAt: b.createdAt, steps });

/**
 * Claims the contact before anything is sent. The caller has verified the
 * contact (a fresh GHL read). Idempotent only for the exact original
 * reservation (a retried begin whose response was lost); refuses with
 * CallLogHeld while any other attempt is current, from any session.
 */
export async function beginCallLog(store: BarrierStore, scope: string, input: { contactId: string; purpose: CallLogPurpose; result: string; body: string; steps: { step: CallLogStep; requestId: string }[] }, now: string): Promise<void> {
  const barrierId = digest(input.steps[0].requestId);
  const record: BarrierRecord = {
    v: 1, contactDigest: digest(input.contactId), purpose: input.purpose, barrierId, result: input.result, body: input.body, bodyDigest: digest(input.body),
    steps: input.steps.map((s) => ({ step: s.step, requestId: s.requestId, requestDigest: digest(s.requestId) })), createdAt: now,
  };
  const existing = await readJson(store, barrierKey(scope, input.contactId, barrierId)) as BarrierRecord | null;
  if (existing && !sameReservation(existing, record)) throw new ReservationMismatch("This reservation does not match the original one; nothing was registered");
  for (const s of input.steps) {
    const reg = await readJson(store, requestKey(scope, s.requestId)) as RequestRecord | null;
    if (reg && (reg.barrierId !== barrierId || reg.contactId !== input.contactId || reg.step !== s.step)) throw new ReservationMismatch("A request id is already reserved elsewhere; nothing was registered");
  }
  const w = await store.setJSON(barrierKey(scope, input.contactId, barrierId), record, { onlyIfNew: true });
  if (!w.modified) {
    const again = await readJson(store, barrierKey(scope, input.contactId, barrierId)) as BarrierRecord | null;
    if (!again || !sameReservation(again, record)) throw new ReservationMismatch("This reservation does not match the original one; nothing was registered");
  }
  for (const s of input.steps) {
    const reg: RequestRecord = { v: 1, contactId: input.contactId, step: s.step, barrierId };
    const r = await store.setJSON(requestKey(scope, s.requestId), reg, { onlyIfNew: true });
    if (!r.modified) {
      const prior = await readJson(store, requestKey(scope, s.requestId)) as RequestRecord | null;
      if (!prior || prior.barrierId !== barrierId || prior.contactId !== input.contactId || prior.step !== s.step) throw new ReservationMismatch("A request id is already reserved elsewhere");
    }
  }
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const { head, etag } = await readHead(store, scope, input.contactId);
    if (head && head.current === barrierId) return;                 // a retried begin
    if (head && head.current !== null) {
      const b = await readBarrier(store, scope, input.contactId, head.current);
      const steps = await evaluate(store, scope, input.contactId, b);
      const s = standing(steps);
      throw new CallLogHeld(view(b, steps, s.kind === "uncertain" ? "uncertain" : s.kind === "resumable" ? "resumable" : "pending"));
    }
    if (await casHead(store, scope, input.contactId, etag, { v: 1, current: barrierId, at: now })) return;
  }
  throw new CallLogContended("The call-log reservation could not be confirmed");
}

/** Read-only status for any session (never claims, never clears). */
export async function callLogStatus(store: BarrierStore, scope: string, contact: string): Promise<CallLogView> {
  const { head } = await readHead(store, scope, contact);
  if (!head || head.current === null) return { state: "clear" };
  const b = await readBarrier(store, scope, contact, head.current);
  const steps = await evaluate(store, scope, contact, b);
  const s = standing(steps);
  // A complete or stopped attempt is still the head until reconcile releases it; nothing more may start meanwhile.
  return view(b, steps, s.kind === "uncertain" ? "uncertain" : s.kind === "resumable" ? "resumable" : "pending");
}

/**
 * "Check again". Evaluates the current attempt and changes only what evidence allows:
 *   complete            -> released (clear);
 *   pending (first step undecided) -> that request is WITHDRAWN atomically (a
 *                          delayed handler then loses its send claim), and so
 *                          are the rest; released only after the conditional
 *                          head write -- nothing of it was or can be sent;
 *   stopped             -> the undecided later steps are withdrawn; released;
 *   resumable           -> NOT released and NOT withdrawn: the original
 *                          request ids of the remaining steps are returned so
 *                          the caller finishes the attempt with them;
 *   uncertain           -> unchanged: it may still land. No read of GHL, no
 *                          elapsed time and no operator clears it.
 * "Clear" is returned only after a conditional write against the latest head.
 */
export async function reconcileCallLog(store: BarrierStore, scope: string, contact: string, attempt?: string): Promise<CallLogReconcile> {
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const { head, etag } = await readHead(store, scope, contact);
    const now = new Date().toISOString();
    /* Scoped reconcile (a page settling ITS OWN attempt after a refusal): when
       that attempt is no longer the current one, nothing is changed -- it can
       never withdraw a NEWER attempt's step -- and its own evidence is reported. */
    if (attempt !== undefined && (!head || head.current !== digest(attempt))) {
      const own = await readJson(store, barrierKey(scope, contact, digest(attempt))) as BarrierRecord | null;
      if (!own) return { state: "clear", summary: null };
      return { state: "clear", summary: { purpose: own.purpose, result: own.result, body: own.body, steps: await evaluate(store, scope, contact, own) } };
    }
    if (!head || head.current === null) {
      if (await casHead(store, scope, contact, etag, { v: 1, current: null, at: now })) return { state: "clear", summary: null };
      continue;
    }
    const b = await readBarrier(store, scope, contact, head.current);
    let steps = await evaluate(store, scope, contact, b);
    let s = standing(steps);
    if (s.kind === "uncertain") return view(b, steps, "uncertain");
    if (s.kind === "resumable") {
      const at = s.at;
      return { ...view(b, steps, "resumable"), body: b.body, attempt: b.steps[0].requestId, remaining: b.steps.slice(at).map((x) => ({ step: x.step, requestId: x.requestId })) };
    }
    if (s.kind === "pending" || s.kind === "stopped") {
      const from = s.kind === "pending" ? 0 : s.at + 1;
      let raced = false;
      for (let k = from; k < b.steps.length; k++) {
        if (steps[k].evidence !== "pending") continue;
        if ((await withdraw(store, scope, contact, b.steps[k].requestDigest)) === "send") raced = true;
      }
      if (raced) continue;                                         // a handler claimed first: evaluate again
      steps = await evaluate(store, scope, contact, b);
      s = standing(steps);
      if (s.kind !== "stopped" && s.kind !== "complete") continue; // evidence moved: evaluate again
    }
    if (await casHead(store, scope, contact, etag, { v: 1, current: null, at: now })) {
      return { state: "clear", summary: { purpose: b.purpose, result: b.result, body: b.body, steps } };
    }
    // The head moved since we read it (or the read was stale): evaluate again.
  }
  throw new CallLogContended("The call-log state could not be confirmed");
}

/** Releases the head after the attempt's LAST step is confirmed (conditional; never withdraws). */
async function releaseIfComplete(store: BarrierStore, scope: string, contact: string, barrierId: string): Promise<void> {
  const { head, etag } = await readHead(store, scope, contact);
  if (!head || head.current !== barrierId || etag === null) return;
  const b = await readBarrier(store, scope, contact, barrierId);
  const s = standing(await evaluate(store, scope, contact, b));
  if (s.kind === "complete") await casHead(store, scope, contact, etag, { v: 1, current: null, at: new Date().toISOString() });
}

export async function isCallLogOwned(store: BarrierStore, scope: string, requestId: string): Promise<boolean> {
  return (await readJson(store, requestKey(scope, requestId))) !== null;
}

/**
 * Wraps one owned call-log write in ghl-write (the caller holds the contact
 * lock). Verifies, BEFORE anything can be sent: the request is one of its
 * barrier's original steps, for this operation and contact; it carries the
 * reserved result / the exact reserved note body; its barrier is current; and
 * the previous step is CONFIRMED. A failure of any of these sends nothing and
 * leaves the step undecided (so the attempt can still be finished with this
 * same request id). Then, exactly like the Current Offer barrier: the send is
 * claimed at the write boundary, the outcome recorded, and an error after the
 * GHL call is recorded as uncertain.
 */
export async function runCallLogOwnedWrite<T extends { confirmed: boolean }>(
  store: BarrierStore, scope: string,
  request: { operation: string; targetId: string; requestId: string; args: any },
  body: (hooks: { beforeDispatch: () => Promise<void>; state: { dispatched: boolean } }) => Promise<T>,
): Promise<T> {
  const reg = await readJson(store, requestKey(scope, request.requestId)) as RequestRecord | null;
  if (!reg) throw new NotOwned();
  const b = await readJson(store, barrierKey(scope, reg.contactId, reg.barrierId)) as BarrierRecord | null;
  if (!b) throw new NotSent("The reservation for this request is unreadable");
  const requestDigest = digest(request.requestId);
  const index = b.steps.findIndex((s) => s.requestDigest === requestDigest && s.step === reg.step && s.requestId === request.requestId);
  if (index < 0 || b.barrierId !== reg.barrierId || b.contactDigest !== digest(reg.contactId)) throw new NotSent("This request is not part of its reservation's original steps");
  if (CALL_LOG_STEP_OPERATION[reg.step] !== request.operation) throw new NotSent("Request is reserved for a different step");
  if (request.targetId !== reg.contactId) throw new NotSent("Request is reserved for a different contact");
  if (reg.step === "result" && request.args?.value !== b.result) throw new NotSent("This is not the reserved result");
  if (reg.step === "note" && (typeof request.args?.body !== "string" || digest(request.args.body) !== b.bodyDigest)) throw new NotSent("This is not the reserved call note");
  const { head } = await readHead(store, scope, reg.contactId);
  if (!head || head.current !== reg.barrierId) throw new NotSent("The reservation for this call save is not current");
  if (index > 0) {
    const prior = await stepEvidence(store, scope, reg.contactId, b.steps[index - 1].requestDigest);
    if (prior !== "confirmed") throw new NotSent("The previous step of this call save is not confirmed");
  }
  const state = { dispatched: false, claimed: false };
  const hooks = {
    state,
    beforeDispatch: async () => {
      const claim = await store.setJSON(decisionKey(scope, reg.contactId, requestDigest), { d: "send", at: new Date().toISOString() }, { onlyIfNew: true });
      if (!claim.modified) throw new NotSent("This step was withdrawn or already sent");
      state.claimed = true;
    },
  };
  let result: T;
  try {
    result = await body(hooks);
  } catch (error) {
    if (!state.dispatched) {
      // Nothing was sent by this request. Only the owner of "send" records
      // not_dispatched; a request that never claimed is withdrawn, so it can
      // never be sent later (a retry needs a new reservation).
      try {
        if (state.claimed) await store.setJSON(outcomeKey(scope, reg.contactId, requestDigest), { kind: "not_dispatched", at: new Date().toISOString() }, { onlyIfNew: true });
        else await store.setJSON(decisionKey(scope, reg.contactId, requestDigest), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
      } catch { /* the attempt stays held; still nothing was sent */ }
      throw new NotSent(error instanceof Error ? error.message : "Not sent", error instanceof NotSent && error.refusal !== undefined ? error.refusal : error);
    }
    try { await store.setJSON(outcomeKey(scope, reg.contactId, requestDigest), { kind: "uncertain", at: new Date().toISOString() }, { onlyIfNew: true }); } catch { /* absent outcome = unresolved */ }
    throw error;
  }
  try {
    await store.setJSON(outcomeKey(scope, reg.contactId, requestDigest), { kind: result.confirmed ? "confirmed" : "uncertain", at: new Date().toISOString() }, { onlyIfNew: true });
    if (result.confirmed) await releaseIfComplete(store, scope, reg.contactId, reg.barrierId);
  } catch { /* the attempt stays held: a later reconcile reads the evidence */ }
  return result;
}

const LABEL: Record<CallLogStep, string> = { result: "call result", note: "call note", touch: "last-touch time" };

/** The operator-facing explanation. Never instructs a reload. */
export function describeCallLog(v: CallLogView): string {
  if (v.state === "clear") return "";
  if (v.kind === "uncertain") {
    const sent = v.steps.filter((s) => s.evidence === "unresolved").map((s) => LABEL[s.step]);
    return `Unresolved — the ${sent.join(" and ")} for "${v.result}" was sent and may still reach GHL. Nothing more will be saved in this contact's call log until it is resolved. Use Check again; if it stays unresolved, it needs the call-log recovery procedure.`;
  }
  if (v.kind === "resumable") {
    const open = v.steps.filter((s) => s.evidence === "pending").map((s) => LABEL[s.step]);
    return `The call "${v.result}" is partly saved: its ${open.join(" and ")} ${open.length > 1 ? "have" : "has"} not been sent yet. Use Check again to finish it. No other call can be saved for this contact until then.`;
  }
  return `A call save ("${v.result}") for this contact was started and is not confirmed — it may still be on its way to GHL. Nothing more will be saved until it is checked. Use Check again.`;
}
