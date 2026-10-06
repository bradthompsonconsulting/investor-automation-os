/**
 * Board 15 / PR #131 -- DURABLE CALL-LOG OPERATIONS, implementing the
 * Bones-approved lifecycle v3 (PR #131 #issuecomment-6023481488; full map in
 * docs/CALL_LOG_SAVE_LIFECYCLE.md).
 *
 * One "Save call" is ONE operation with a permanent `operationId`. It has three
 * slots in order -- result (`contact.callLogResult`), note (`note.create`), last
 * touch (`contact.lastCallAttempt`) -- and each slot is satisfied at most once.
 * A slot has numbered attempts whose request ids are DERIVED
 * (`<op>-<slot>-<n>`); attempt n+1 exists only after attempt n is durably
 * PROVED unsent. Recovery (Check again, Retry notes, Retry last-touch time) only
 * ever continues the same operation; a new call is a new operation, allowed only
 * when the contact has no open operation.
 *
 * Records (Netlify Blobs, never deleted; scope = environment + location):
 *   call-log/head/<contact>         ONE per contact {v:3, current: op | null}.
 *                                   Changed only by compare-and-swap, and
 *                                   released only FROM the operation it names.
 *                                   (Same key as the 558c666 head, so a legacy
 *                                   unfinished head is seen -- see section 10.)
 *   call-log/v3/op/<op>             write-once: contact, result, exact note body.
 *   call-log/v3/attempt/<op,slot,n> write-once: the attempt's request id.
 *   call-log/v3/binding/<request>   write-once DISPATCH BINDING: op, slot, n,
 *                                   contact, operation, result value / body
 *                                   digest. ghl-write sends only a request whose
 *                                   attempt AND binding both exist and verify.
 *   call-log/v3/decision/<request>  write-once "send" (claimed inside the write
 *                                   boundary just before the GHL call) or
 *                                   "withdrawn" (atomic; then it can never send).
 *   call-log/v3/outcome/<request>   write-once confirmed | not_dispatched |
 *                                   uncertain (written by the "send" owner).
 *   call-log/v3/final/<op>          write-once {complete | not_saved}, written
 *                                   and read back BEFORE the head is released.
 *
 * PROOF that a request was never sent is ONLY its durable `withdrawn` or
 * `not_dispatched` record. A refusal a client receives proves nothing about any
 * other request (a losing duplicate is refused because the winner claimed
 * "send"). A sent step whose outcome is uncertain or missing is protected:
 * nothing here clears it -- not a GHL read, not time, not an operator
 * (docs/CALL_LOG_RECOVERY_PROCEDURE.md).
 */
import { digest } from "./ghl-write-boundary";
import { isCallLogNoteBody } from "./production-write-scope";
import { callLogResults } from "./write-contracts";
import type { BarrierStore } from "./current-offer-barrier";
import * as legacy from "./call-log-legacy";

export type Slot = "result" | "note" | "touch";
export const SLOTS: Slot[] = ["result", "note", "touch"];
export const SLOT_OPERATION: Record<Slot, string> = {
  result: "contact.callLogResult",
  note: "note.create",
  touch: "contact.lastCallAttempt",
};
export const CALL_LOG_OPERATIONS = new Set(Object.values(SLOT_OPERATION));
/** Every note IAOS writes for the call log starts with this; such a note is only ever sent as a reserved step. */
export const CALL_LOG_NOTE_MARK = "Call (reported by Brad in IAOS):";
export function isCallLogNoteText(body: unknown): boolean {
  return typeof body === "string" && body.startsWith(CALL_LOG_NOTE_MARK);
}
export const requestIdFor = (op: string, slot: Slot, n: number) => `${op}-${slot}-${n}`;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,40}$/;

export function callLogScope(env: string, locationId: string): string { return `${env}:${locationId}`; }
const headKey = (scope: string, contact: string) => `call-log/head/${digest(`${scope}:${contact}`)}`;
const P = "call-log/v3/";
const opKey = (scope: string, op: string) => `${P}op/${digest(`${scope}:${op}`)}`;
const attemptKey = (scope: string, op: string, slot: Slot, n: number) => `${P}attempt/${digest(`${scope}:${op}:${slot}:${n}`)}`;
const bindingKey = (scope: string, requestId: string) => `${P}binding/${digest(`${scope}:${requestId}`)}`;
const decisionKey = (scope: string, requestId: string) => `${P}decision/${digest(`${scope}:${requestId}`)}`;
const outcomeKey = (scope: string, requestId: string) => `${P}outcome/${digest(`${scope}:${requestId}`)}`;
const finalKey = (scope: string, op: string) => `${P}final/${digest(`${scope}:${op}`)}`;

type HeadRecord = { v: number; current: string | null; at: string };
type OpRecord = { v: 3; op: string; contactId: string; result: string; body: string; bodyDigest: string; createdAt: string };
type AttemptRecord = { v: 3; op: string; slot: Slot; n: number; requestId: string };
type Binding = { v: 3; op: string; slot: Slot; n: number; contactId: string; operation: string; value: string | null; bodyDigest: string | null };
export type Evidence = "pending" | "in_flight" | "confirmed" | "withdrawn" | "not_dispatched" | "uncertain";
export type SlotView = { slot: Slot; attempt: number; requestId: string; evidence: Evidence };
export type FinalKind = "complete" | "not_saved";
type FinalRecord = { v: 3; op: string; kind: FinalKind; result: string; slots: SlotView[]; at: string };
export type Outcome = { kind: FinalKind; result: string; slots: SlotView[] };
export type Next =
  | { action: "withdraw_result" }                              // the result may still be on its way
  | { action: "send"; slot: Slot; requestId: string }          // an undecided note/touch attempt: same id
  | { action: "retry"; slot: Slot; after: number }             // proved unsent: an explicit retry may publish n+1
  | { action: "blocked"; slot: Slot; reason: "in_flight" | "uncertain" }
  | { action: "finishing" };                                   // every slot settled; final not yet recorded
export type CallLogView =
  | { state: "clear" }
  | { state: "legacy"; message: string }
  | { state: "finished"; op: string; outcome: Outcome }
  | { state: "not_current"; op: string }                       // begun but never current: nothing of it was sent
  | { state: "open"; op: string; result: string; slots: SlotView[]; next: Next; body?: string };

export const proved = (e: Evidence) => e === "withdrawn" || e === "not_dispatched";

/** Provably sent nothing. `proves`: what the refusal establishes about THIS request id. `outcome`: a finished operation's record. */
export class NotSent extends Error {
  constructor(message: string, readonly proves: "this_request" | "nothing" = "nothing", readonly code?: string, readonly outcome?: Outcome | null, readonly refusal?: unknown) { super(message); }
}
export class NotOwned extends Error {}
export class CallLogHeld extends Error { constructor(readonly status: CallLogView) { super("This contact has an unfinished call save."); } }
export class ReservationMismatch extends Error {}
export class StorageUnsettled extends Error {}
/** A malformed request (e.g. a retry naming an attempt that does not exist): nothing changed. */
export class InvalidRequest extends Error {}

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
const isLegacyHead = (h: HeadRecord | null) => !!h && h.current !== null && h.v !== 3;

/**
 * Publishes a write-once record and VERIFIES it. A failed or ambiguous write
 * acknowledgement never leads to a different identity: the same key is read
 * back, and only the same deterministic content is accepted.
 */
async function writeOnceVerified<T>(store: BarrierStore, key: string, value: T, same: (got: any) => boolean): Promise<T> {
  let threw = false;
  try { await store.setJSON(key, value, { onlyIfNew: true }); } catch { threw = true; }
  const got = await readJson(store, key);
  if (!got) throw new StorageUnsettled(threw ? "A record write could not be confirmed; the same record will be read again" : "A written record is not readable yet");
  if (!same(got)) throw new ReservationMismatch("A record already exists with different content; nothing was registered");
  return got as T;
}

/** Validates a begin. The note body must be an exact call-log note for this result. */
export function validateBegin(op: unknown, result: unknown, body: unknown): { op: string; result: string; body: string } {
  if (typeof op !== "string" || !OPERATION_ID.test(op)) throw new Error("Invalid operation id");
  if (typeof result !== "string" || !callLogResults.includes(result)) throw new Error("Invalid result");
  if (typeof body !== "string" || !isCallLogNoteBody(body)) throw new Error("Invalid call note");
  const first = body.indexOf("\n") === -1 ? body : body.slice(0, body.indexOf("\n"));
  if (first !== `${CALL_LOG_NOTE_MARK} ${result}`) throw new Error("The note does not name this result");
  return { op, result, body };
}
export function validateOperationId(op: unknown): asserts op is string {
  if (typeof op !== "string" || !OPERATION_ID.test(op)) throw new Error("Invalid operation id");
}

const sameOp = (a: OpRecord, b: OpRecord) => a.op === b.op && a.contactId === b.contactId && a.result === b.result && a.bodyDigest === b.bodyDigest;
const attemptRecord = (op: string, slot: Slot, n: number): AttemptRecord => ({ v: 3, op, slot, n, requestId: requestIdFor(op, slot, n) });
const sameAttempt = (a: AttemptRecord, b: AttemptRecord) => a.op === b.op && a.slot === b.slot && a.n === b.n && a.requestId === b.requestId;
function bindingFor(o: OpRecord, slot: Slot, n: number): Binding {
  return { v: 3, op: o.op, slot, n, contactId: o.contactId, operation: SLOT_OPERATION[slot], value: slot === "result" ? o.result : null, bodyDigest: slot === "note" ? o.bodyDigest : null };
}
const sameBinding = (a: Binding, b: Binding) => a.op === b.op && a.slot === b.slot && a.n === b.n && a.contactId === b.contactId && a.operation === b.operation && a.value === b.value && a.bodyDigest === b.bodyDigest;

/** Publishes attempt n of a slot: the attempt record and its dispatch binding, both written once and verified. */
async function publishAttempt(store: BarrierStore, scope: string, o: OpRecord, slot: Slot, n: number): Promise<string> {
  const a = attemptRecord(o.op, slot, n);
  await writeOnceVerified(store, attemptKey(scope, o.op, slot, n), a, (got) => sameAttempt(got, a));
  const b = bindingFor(o, slot, n);
  await writeOnceVerified(store, bindingKey(scope, a.requestId), b, (got) => sameBinding(got, b));
  return a.requestId;
}
/** Send permission requires BOTH the attempt record and its binding to exist and match. */
async function attemptPublished(store: BarrierStore, scope: string, o: OpRecord, slot: Slot, n: number): Promise<boolean> {
  const a = await readJson(store, attemptKey(scope, o.op, slot, n)) as AttemptRecord | null;
  const b = await readJson(store, bindingKey(scope, requestIdFor(o.op, slot, n))) as Binding | null;
  return !!a && !!b && sameAttempt(a, attemptRecord(o.op, slot, n)) && sameBinding(b, bindingFor(o, slot, n));
}

async function evidenceOf(store: BarrierStore, scope: string, requestId: string): Promise<Evidence> {
  const d = await readJson(store, decisionKey(scope, requestId)) as { d: "send" | "withdrawn" } | null;
  if (!d) return "pending";
  if (d.d === "withdrawn") return "withdrawn";
  const out = await readJson(store, outcomeKey(scope, requestId)) as { kind: string } | null;
  if (!out) return "in_flight";
  if (out.kind === "confirmed") return "confirmed";
  if (out.kind === "not_dispatched") return "not_dispatched";
  return "uncertain";
}
/** The slot's CURRENT attempt: the highest-numbered attempt that exists. */
async function currentAttempt(store: BarrierStore, scope: string, op: string, slot: Slot): Promise<number> {
  if (!(await readJson(store, attemptKey(scope, op, slot, 1)))) throw new StorageUnsettled("An operation's first attempt is not readable yet");
  let n = 1;
  while (await readJson(store, attemptKey(scope, op, slot, n + 1))) n++;
  return n;
}
async function evaluate(store: BarrierStore, scope: string, o: OpRecord): Promise<SlotView[]> {
  const out: SlotView[] = [];
  for (const slot of SLOTS) {
    const n = await currentAttempt(store, scope, o.op, slot);
    const requestId = requestIdFor(o.op, slot, n);
    out.push({ slot, attempt: n, requestId, evidence: await evidenceOf(store, scope, requestId) });
  }
  return out;
}

/**
 * The single rule for what comes next, from the evidence in slot order
 * (approved v3 sections 5-6). By the ORDER rule nothing after an unconfirmed slot
 * can have been sent; if any later slot nevertheless shows a send, it is
 * treated as unresolved (the evidence wins).
 */
export function nextOf(slots: SlotView[]): Next | { action: "complete" } | { action: "not_saved" } {
  const [r] = slots;
  const laterSent = (from: number) => slots.slice(from).find((s) => s.evidence === "in_flight" || s.evidence === "uncertain" || s.evidence === "confirmed");
  if (r.evidence !== "confirmed") {
    const odd = laterSent(1);
    if (odd) return { action: "blocked", slot: odd.slot, reason: odd.evidence === "in_flight" ? "in_flight" : "uncertain" };
    if (r.evidence === "pending") return { action: "withdraw_result" };
    if (proved(r.evidence)) return { action: "not_saved" };
    return { action: "blocked", slot: "result", reason: r.evidence === "in_flight" ? "in_flight" : "uncertain" };
  }
  for (let i = 1; i < slots.length; i++) {
    const s = slots[i];
    if (s.evidence === "confirmed") continue;
    const odd = laterSent(i + 1);
    if (odd) return { action: "blocked", slot: odd.slot, reason: odd.evidence === "in_flight" ? "in_flight" : "uncertain" };
    if (s.evidence === "pending") return { action: "send", slot: s.slot, requestId: s.requestId };
    if (proved(s.evidence)) return { action: "retry", slot: s.slot, after: s.attempt };
    return { action: "blocked", slot: s.slot, reason: s.evidence === "in_flight" ? "in_flight" : "uncertain" };
  }
  return { action: "complete" };
}

async function readOp(store: BarrierStore, scope: string, op: string): Promise<OpRecord | null> {
  return await readJson(store, opKey(scope, op)) as OpRecord | null;
}
async function readFinal(store: BarrierStore, scope: string, op: string): Promise<FinalRecord | null> {
  return await readJson(store, finalKey(scope, op)) as FinalRecord | null;
}
const outcomeOf = (f: FinalRecord): Outcome => ({ kind: f.kind, result: f.result, slots: f.slots });

/** Releases the head ONLY from the operation it names (compare-and-swap). Returns whether the head no longer names `op`. */
async function releaseIfOwned(store: BarrierStore, scope: string, contact: string, op: string): Promise<boolean> {
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const { head, etag } = await readHead(store, scope, contact);
    if (!head || head.current !== op) return true;
    if (await casHead(store, scope, contact, etag, { v: 3, current: null, at: new Date().toISOString() })) return true;
  }
  return false;   // a later status / resume / retry reconciles the release (final already recorded)
}

/** Final evidence FIRST (written once, read back), THEN the conditional release. Never resends anything. */
async function finalize(store: BarrierStore, scope: string, o: OpRecord, kind: FinalKind, slots: SlotView[]): Promise<FinalRecord> {
  const rec: FinalRecord = { v: 3, op: o.op, kind, result: o.result, slots, at: new Date().toISOString() };
  const got = await writeOnceVerified(store, finalKey(scope, o.op), rec, (g) => g.op === o.op && g.kind === kind);
  await releaseIfOwned(store, scope, o.contactId, o.op);
  return got;
}

/** If the final record exists and the head still names this operation, finish the release (reconciliation after a failed release). */
async function finishedView(store: BarrierStore, scope: string, contact: string, f: FinalRecord): Promise<CallLogView> {
  await releaseIfOwned(store, scope, contact, f.op).catch(() => false);
  return { state: "finished", op: f.op, outcome: outcomeOf(f) };
}

function openView(o: OpRecord, slots: SlotView[], next: Next, withBody: boolean): CallLogView {
  const v: CallLogView = { state: "open", op: o.op, result: o.result, slots, next };
  if (withBody && next.action === "send" && next.slot === "note") (v as any).body = o.body;
  return v;
}

/**
 * Evaluates an operation and settles only what its evidence already settles:
 * a complete or not_saved operation is finalized (final first, then release).
 * Never withdraws, never creates an attempt, never sends.
 */
async function settleView(store: BarrierStore, scope: string, o: OpRecord, withBody: boolean): Promise<CallLogView> {
  const f = await readFinal(store, scope, o.op);
  if (f) return finishedView(store, scope, o.contactId, f);
  const slots = await evaluate(store, scope, o);
  const next = nextOf(slots);
  if (next.action === "complete" || next.action === "not_saved") {
    try { return { state: "finished", op: o.op, outcome: outcomeOf(await finalize(store, scope, o, next.action, slots)) }; }
    catch { return openView(o, slots, { action: "finishing" }, withBody); }
  }
  if (next.action === "send" && !(await attemptPublished(store, scope, o, next.slot, slots[SLOTS.indexOf(next.slot)].attempt))) {
    // Not yet verifiably published: no send permission (a retried call reads the same identity).
    return openView(o, slots, { action: "blocked", slot: next.slot, reason: "in_flight" }, withBody);
  }
  return openView(o, slots, next, withBody);
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Contact status, for any session (read session). */
export async function statusByContact(store: BarrierStore, scope: string, contact: string): Promise<CallLogView> {
  const { head } = await readHead(store, scope, contact);
  if (!head || head.current === null) return { state: "clear" };
  if (isLegacyHead(head)) return { state: "legacy", message: LEGACY_MESSAGE };
  const o = await readOp(store, scope, head.current);
  if (!o) throw new StorageUnsettled("The open operation is not readable yet");
  return settleView(store, scope, o, false);
}

/** An operation's own state, by its ORIGINAL id -- for a delayed response, a stale page or a stale tab. */
export async function statusByOperation(store: BarrierStore, scope: string, contact: string, op: string): Promise<CallLogView | null> {
  const o = await readOp(store, scope, op);
  if (!o || o.contactId !== contact) return null;
  const f = await readFinal(store, scope, op);
  if (f) return finishedView(store, scope, contact, f);
  const { head } = await readHead(store, scope, contact);
  if (!head || head.current !== op) return { state: "not_current", op };
  return settleView(store, scope, o, false);
}

/**
 * A NEW call. Only when the contact has no open operation. A repeated begin of
 * a FINISHED operation returns its recorded outcome and never reopens it; a
 * retried begin of the same open operation is idempotent; anything else that
 * reuses the operation id with different content is rejected.
 */
export async function beginOperation(store: BarrierStore, scope: string, input: { contactId: string; op: string; result: string; body: string }, now: string): Promise<CallLogView | { state: "reserved"; op: string }> {
  const f = await readFinal(store, scope, input.op);
  if (f) {
    if (f.op !== input.op) throw new ReservationMismatch("Operation identity mismatch");
    return { state: "finished", op: f.op, outcome: outcomeOf(f) };
  }
  const o: OpRecord = { v: 3, op: input.op, contactId: input.contactId, result: input.result, body: input.body, bodyDigest: digest(input.body), createdAt: now };
  const existing = await readOp(store, scope, input.op);
  if (existing && !sameOp(existing, o)) throw new ReservationMismatch("This operation id already exists with different content; nothing was registered");
  /* The head may still name another operation: open (held), or FINISHED with a
     release that failed earlier -- settling that view completes the release
     (only from that operation), and then this begin proceeds. */
  const heldBy = async (current: string): Promise<CallLogView | null> => {
    const v = await viewOfCurrent(store, scope, input.contactId, current);
    return v.state === "finished" ? null : v;
  };
  {
    const { head } = await readHead(store, scope, input.contactId);
    if (isLegacyHead(head)) throw new CallLogHeld({ state: "legacy", message: LEGACY_MESSAGE });
    if (head && head.current !== null && head.current !== input.op) { const v = await heldBy(head.current); if (v) throw new CallLogHeld(v); }
  }
  const rec = await writeOnceVerified(store, opKey(scope, input.op), o, (got) => sameOp(got, o));
  for (const slot of SLOTS) await publishAttempt(store, scope, rec, slot, 1);
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const { head, etag } = await readHead(store, scope, input.contactId);
    if (head && head.current === input.op) return { state: "reserved", op: input.op };
    if (isLegacyHead(head)) throw new CallLogHeld({ state: "legacy", message: LEGACY_MESSAGE });
    if (head && head.current !== null) { const v = await heldBy(head.current); if (v) throw new CallLogHeld(v); continue; }
    if (await readFinal(store, scope, input.op)) throw new ReservationMismatch("This operation has already finished");
    if (await casHead(store, scope, input.contactId, etag, { v: 3, current: input.op, at: now })) return { state: "reserved", op: input.op };
  }
  throw new StorageUnsettled("The call-log reservation could not be confirmed");
}
async function viewOfCurrent(store: BarrierStore, scope: string, contact: string, op: string): Promise<CallLogView> {
  const o = await readOp(store, scope, op);
  if (!o) throw new StorageUnsettled("The open operation is not readable yet");
  return settleView(store, scope, o, false);
}

/**
 * "Check again" for THIS operation. Settles what evidence settles; for an
 * undecided result it tries the atomic withdrawal (success: Not saved; a lost
 * race: blocked until the dispatched attempt's outcome is known). Returns the
 * next action for the EXISTING attempts. Never creates an attempt.
 */
export async function resumeOperation(store: BarrierStore, scope: string, contact: string, op: string): Promise<CallLogView | null> {
  const o = await readOp(store, scope, op);
  if (!o || o.contactId !== contact) return null;
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const f = await readFinal(store, scope, op);
    if (f) return finishedView(store, scope, contact, f);
    const { head } = await readHead(store, scope, contact);
    if (!head || head.current !== op) return { state: "not_current", op };
    const slots = await evaluate(store, scope, o);
    const next = nextOf(slots);
    if (next.action === "withdraw_result") {
      const w = await store.setJSON(decisionKey(scope, slots[0].requestId), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
      if (!w.modified && !(await readJson(store, decisionKey(scope, slots[0].requestId)))) throw new StorageUnsettled("Decision unreadable after a lost claim");
      continue;   // evaluate again: withdrawn -> not_saved; dispatch won -> blocked until its outcome
    }
    return settleView(store, scope, o, true);
  }
  throw new StorageUnsettled("The call-log state could not be confirmed");
}

/**
 * An explicit retry (Retry notes / Retry last-touch time) naming the attempt it
 * retries (`after`). Creates attempt after+1 ONLY when: the operation is open and
 * current, every earlier slot is confirmed, the slot's current attempt IS
 * `after`, and that attempt is durably PROVED unsent. Otherwise it creates
 * nothing and returns the current state (an existing later attempt is reused).
 */
export async function retryAttempt(store: BarrierStore, scope: string, contact: string, op: string, slot: Slot, after: number): Promise<CallLogView | null> {
  if (slot === "result") throw new InvalidRequest("A result is never retried; a new call is a new operation");
  const o = await readOp(store, scope, op);
  if (!o || o.contactId !== contact) return null;
  const f = await readFinal(store, scope, op);
  if (f) return finishedView(store, scope, contact, f);
  const { head } = await readHead(store, scope, contact);
  if (!head || head.current !== op) return { state: "not_current", op };
  const slots = await evaluate(store, scope, o);
  const index = SLOTS.indexOf(slot);
  const cur = slots[index];
  if (cur.attempt < after) throw new InvalidRequest("Retry names an attempt that does not exist");
  const earlierConfirmed = slots.slice(0, index).every((s) => s.evidence === "confirmed");
  if (cur.attempt === after && earlierConfirmed && proved(cur.evidence)) await publishAttempt(store, scope, o, slot, after + 1);
  return settleView(store, scope, o, true);
}

/** A legacy (558c666-format) unfinished head: released only when its evidence settles; never resumed. */
export async function settleLegacy(store: BarrierStore, scope: string, contact: string): Promise<CallLogView> {
  const { head } = await readHead(store, scope, contact);
  if (!head || head.current === null) return { state: "clear" };
  if (!isLegacyHead(head)) return statusByContact(store, scope, contact);
  const st = await legacy.callLogStatus(store, scope, contact);
  if (st.state === "clear") return { state: "clear" };
  const first = st.steps[0]?.evidence;
  const all = st.steps.every((s) => s.evidence === "confirmed");
  if (all || first === "pending" || first === "withdrawn" || first === "not_dispatched") {
    const r = await legacy.reconcileCallLog(store, scope, contact);
    if (r.state === "clear") return { state: "clear" };
  }
  return { state: "legacy", message: LEGACY_MESSAGE };
}
export const LEGACY_MESSAGE = "An earlier call save for this contact (from a previous version of IAOS) is unfinished. Nothing more will be saved in this contact's call log until it is resolved. Use Check again; if it stays, it needs the call-log recovery procedure.";

export async function isCallLogBound(store: BarrierStore, scope: string, requestId: string): Promise<boolean> {
  return (await readJson(store, bindingKey(scope, requestId))) !== null;
}

/**
 * Wraps one call-log write in ghl-write (the caller holds the contact lock).
 * Before anything can be sent it verifies the dispatch binding and the attempt
 * record (both published), that this is the slot's CURRENT attempt, the
 * operation is open, unfinished and current, the request carries the bound
 * contact / operation / result / body, and the previous slot is CONFIRMED. A
 * failure there writes no record (a stale Call A request never touches Call
 * B). Then: the send claim at the write boundary, the outcome record, and on
 * a confirmed last slot, finalization (final, then the conditional release).
 */
export async function runCallLogOwnedWrite<T extends { confirmed: boolean }>(
  store: BarrierStore, scope: string,
  request: { operation: string; targetId: string; requestId: string; args: any },
  body: (hooks: { beforeDispatch: () => Promise<void>; state: { dispatched: boolean } }) => Promise<T>,
): Promise<T> {
  const b = await readJson(store, bindingKey(scope, request.requestId)) as Binding | null;
  if (!b) throw new NotOwned();
  if (b.operation !== request.operation) throw new NotSent("Request is bound to a different step");
  if (b.contactId !== request.targetId) throw new NotSent("Request is bound to a different contact");
  if (b.slot === "result" && request.args?.value !== b.value) throw new NotSent("This is not the reserved result");
  if (b.slot === "note" && (typeof request.args?.body !== "string" || digest(request.args.body) !== b.bodyDigest)) throw new NotSent("This is not the reserved call note");
  const o = await readOp(store, scope, b.op);
  if (!o || o.contactId !== b.contactId) throw new NotSent("The operation for this request is unreadable");
  if (!(await attemptPublished(store, scope, o, b.slot, b.n))) throw new NotSent("This attempt is not verifiably published");
  if (await readJson(store, attemptKey(scope, o.op, b.slot, b.n + 1))) throw new NotSent("This attempt has been superseded", "nothing", "attempt_superseded");
  const f = await readFinal(store, scope, o.op);
  if (f) throw new NotSent("This call save has already finished", "nothing", "operation_not_current", outcomeOf(f));
  const { head } = await readHead(store, scope, o.contactId);
  if (!head || head.current !== o.op) throw new NotSent("This call save is not the contact's current one", "nothing", "operation_not_current", null);
  const index = SLOTS.indexOf(b.slot);
  if (index > 0) {
    const prevN = await currentAttempt(store, scope, o.op, SLOTS[index - 1]);
    if ((await evidenceOf(store, scope, requestIdFor(o.op, SLOTS[index - 1], prevN))) !== "confirmed") throw new NotSent("The previous step of this call save is not confirmed");
  }
  const state = { dispatched: false, claimed: false };
  const hooks = {
    state,
    beforeDispatch: async () => {
      const claim = await store.setJSON(decisionKey(scope, request.requestId), { d: "send", at: new Date().toISOString() }, { onlyIfNew: true });
      if (!claim.modified) throw new NotSent("This step was withdrawn or already sent");
      state.claimed = true;
    },
  };
  let result: T;
  try {
    result = await body(hooks);
  } catch (error) {
    if (!state.dispatched) {
      let proves: "this_request" | "nothing" = "nothing";
      try {
        if (state.claimed) {
          const w = await store.setJSON(outcomeKey(scope, request.requestId), { kind: "not_dispatched", at: new Date().toISOString() }, { onlyIfNew: true });
          if (w.modified) proves = "this_request";
        } else {
          // Atomic: fails if another sender already claimed "send" -- then this refusal proves nothing.
          const w = await store.setJSON(decisionKey(scope, request.requestId), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
          if (w.modified) proves = "this_request";
        }
      } catch { /* proves nothing */ }
      throw new NotSent(error instanceof Error ? error.message : "Not sent", proves, undefined, null, error instanceof NotSent && error.refusal !== undefined ? error.refusal : error);
    }
    try { await store.setJSON(outcomeKey(scope, request.requestId), { kind: "uncertain", at: new Date().toISOString() }, { onlyIfNew: true }); } catch { /* absent outcome = in flight: protected */ }
    throw error;
  }
  try {
    await store.setJSON(outcomeKey(scope, request.requestId), { kind: result.confirmed ? "confirmed" : "uncertain", at: new Date().toISOString() }, { onlyIfNew: true });
    if (result.confirmed) {
      const slots = await evaluate(store, scope, o);
      const n = nextOf(slots);
      if (n.action === "complete") await finalize(store, scope, o, "complete", slots);
    }
  } catch { /* the operation stays open: a later status / resume finalizes from the evidence */ }
  return result;
}
