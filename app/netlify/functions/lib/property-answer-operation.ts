/**
 * B15-04 Rev 6 property answers -- the durable two-slot operation (design r3
 * §4-§5; proposal r4 §1-§2; Bones's r3 fencing review). Test-only controlled
 * evaluation (Option B, proposal r2 §3): the endpoint pins every call to the
 * configured synthetic fixtures before anything here runs.
 *
 * One answer save = ONE operation with a permanent id and two ordered slots:
 *   S1  the field PUT (current value) through GhlBoundary.fields
 *   S2  the answer-history note through GhlBoundary.note
 *
 * Records (Netlify Blobs `iaos-write-receipts`, scope = environment:location;
 * write-once unless stated):
 *   pa/head/<contact>             ONE per contact {current: op|null}; compare-and-swap only;
 *                                 released only by the op it names, after its final record.
 *   pa/op/<op>                    contact, deal, field, value, digests bound at evaluation.
 *   pa/attempt/<op,slot,n>        the attempt's request id. S1 has exactly one attempt; S2 may
 *                                 get n+1 only after attempt n is PROVED unsent.
 *   pa/decision/<request>         "send" (claimed in beforeDispatch, immediately before the GHL
 *                                 call; the call is made only after it is acknowledged) or
 *                                 "withdrawn" (then it can never send).
 *   pa/outcome/<request>          the SOLE authoritative outcome of that exact attempt, created
 *                                 onlyIfNew by the original or by recovery, never overwritten.
 *                                 S1: confirmed_clean | confirmed_conditions_changed | uncertain |
 *                                 not_dispatched. S2: confirmed | uncertain | not_dispatched.
 *   pa/observation/<request>/<id> read-only GHL observations made after an uncertain outcome.
 *                                 They never change the state.
 *   pa/s2-permit/<op>             written by the original save ONLY after its confirmed_clean outcome
 *                                 create was acknowledged; S2 is never sent without it.
 *   pa/final/<op>                 committed | not_saved, written before the head is released.
 *   pa/draft/<contact,deal,field> the unsaved operator text (mutable; cleared once S1 lands).
 *
 * Rules (each one is a refusal, never a retry):
 *   - S2 is sent only after S1's confirmed_clean outcome for THIS attempt was created and
 *     acknowledged, and the S2 gate re-reads that same record. A GHL success alone never
 *     authorizes S2.
 *   - A "send" decision without an outcome is UNCERTAIN: it is never treated as unsent and is
 *     never resent. An uncertain or conditions-changed S1 holds the head (every answer save for
 *     the contact is refused) and S2.
 *   - Recovery runs only under the contact lock, so no live original can interleave (the
 *     original holds the lock until it returns). It only creates outcomes onlyIfNew.
 */
import { randomUUID } from "node:crypto";
import type { GhlConfig } from "../../../shared/ghl-config";
import { digest, fieldValue, GhlBoundary } from "./ghl-write-boundary";
import type { BarrierStore } from "./current-offer-barrier";
import type { FieldWrite } from "./write-contracts";
import { Discovery, Fenced, LedgerUnsettled, staleTokens, openTokens, recordRecovery, type Observation } from "./known-deal-ledger";
import { classifyDeal, evaluateDealSet, type DealSetVerdict } from "./seller-deal-set";
import {
  ADDRESS_KEYS, EMPTY_ADDRESS_DIGEST, readAddress, historyNoteBody, historyValueLines, reconcileHistory, sha256,
  type Address, type AddressFieldIds, type AddressState, type AnswerField, type HistoryEntry,
} from "./property-answer-model";

export type Slot = "S1" | "S2";
export type S1Kind = "confirmed_clean" | "confirmed_conditions_changed" | "uncertain" | "not_dispatched";
export type S2Kind = "confirmed" | "uncertain" | "not_dispatched";
export type Evidence = "pending" | "withdrawn" | "in_flight" | S1Kind | S2Kind;

export type OpRecord = {
  v: 1; op: string; contactId: string; opportunityId: string; field: AnswerField;
  valueText: string; valueDigest: string; valueLines: string[];
  expectedAddressDigest: string; dealSetDigest: string; createdAt: string;
};
type OutcomeRecord = {
  v: 1; op: string; slot: Slot; n: number; requestId: string; kind: S1Kind | S2Kind;
  valueDigest: string; readbackDigest: string | null; previousDigest: string | null;
  discrepancy: Record<string, boolean> | null; at: string;
};
type FinalRecord = { v: 1; op: string; kind: "committed" | "not_saved"; at: string };

export type OpState =
  | "committed" | "not_saved"
  | "saved_history_pending"      // S1 confirmed_clean; S2 not yet sent, or proved unsent
  | "history_unresolved"         // S2 sent but not confirmed
  | "saved_conditions_changed"   // S1 landed; the post-write bracket differed; S2 held (J3)
  | "not_confirmed"              // S1 sent but not confirmed (uncertain or in flight)
  | "pending";                   // S1 attempt published, nothing decided yet

export type OpView = { op: string; field: AnswerField; opportunityId: string; state: OpState; s1: Evidence; s2: Evidence; s2Attempt: number };

/** Nothing was sent to GHL. `proves`: whether THIS request is durably proved unsent. */
export class NotSent extends Error { constructor(message: string, readonly code: string, readonly view: unknown = null) { super(message); } }
/** The contact has an open answer operation that is not finished: no new save. */
export class AnswerHeld extends Error { constructor(readonly view: OpView) { super("This contact has an unfinished answer save."); } }
export class StorageUnsettled extends Error {}

const k = (scope: string, ...parts: (string | number)[]) => digest([scope, ...parts].join(":"));
const headKey = (scope: string, contact: string) => `pa/head/${k(scope, contact)}`;
const opKey = (scope: string, op: string) => `pa/op/${k(scope, op)}`;
const attemptKey = (scope: string, op: string, slot: Slot, n: number) => `pa/attempt/${k(scope, op, slot, n)}`;
const decisionKey = (scope: string, requestId: string) => `pa/decision/${k(scope, requestId)}`;
const outcomeKey = (scope: string, requestId: string) => `pa/outcome/${k(scope, requestId)}`;
const finalKey = (scope: string, op: string) => `pa/final/${k(scope, op)}`;
/** Written once by the ORIGINAL save, only after its confirmed_clean outcome create was acknowledged (Bones G3). S2 requires it. */
const permitKey = (scope: string, op: string) => `pa/s2-permit/${k(scope, op)}`;
const observationKey = (scope: string, requestId: string) => `pa/observation/${k(scope, requestId)}/${randomUUID()}`;
export const draftKey = (scope: string, contact: string, opp: string, field: AnswerField) => `pa/draft/${k(scope, contact, opp, field)}`;
export const requestIdFor = (op: string, slot: Slot, n: number) => `${op}-${slot}-${n}`;
export const OPERATION_ID = /^[A-Za-z0-9_-]{8,40}$/;
const CAS_ATTEMPTS = 4;

export async function readJson(store: BarrierStore, key: string): Promise<any> {
  try { return await store.get(key, { type: "json", consistency: "strong" }); }
  catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    return store.get(key, { type: "json" });
  }
}
async function readHead(store: BarrierStore, scope: string, contact: string): Promise<{ current: string | null; etag: string | null }> {
  let got: { data: any; etag?: string } | null;
  try { got = await store.getWithMetadata(headKey(scope, contact), { type: "json", consistency: "strong" }); }
  catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    got = await store.getWithMetadata(headKey(scope, contact), { type: "json" });
  }
  if (!got) return { current: null, etag: null };
  if (!got.etag) throw new StorageUnsettled("Head read without an etag");
  return { current: got.data?.current ?? null, etag: got.etag };
}
async function casHead(store: BarrierStore, scope: string, contact: string, etag: string | null, current: string | null, now: string): Promise<boolean> {
  const r = await store.setJSON(headKey(scope, contact), { v: 1, current, at: now }, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
  return r.modified;
}
/** Create once, then read back; only identical content is accepted. */
async function writeOnceVerified<T>(store: BarrierStore, key: string, value: T, same: (got: any) => boolean): Promise<T> {
  try { await store.setJSON(key, value, { onlyIfNew: true }); } catch { /* read back below */ }
  const got = await readJson(store, key);
  if (!got) throw new StorageUnsettled("A record could not be confirmed");
  if (!same(got)) throw new StorageUnsettled("A record already exists with different content");
  return got as T;
}
/** onlyIfNew create of an outcome: "created" only on an unambiguous acknowledgement. */
async function createOutcome(store: BarrierStore, scope: string, rec: OutcomeRecord): Promise<"created" | "exists" | "ambiguous"> {
  try { const r = await store.setJSON(outcomeKey(scope, rec.requestId), rec, { onlyIfNew: true }); return r.modified ? "created" : "exists"; }
  catch { return "ambiguous"; }
}

async function evidenceOf(store: BarrierStore, scope: string, requestId: string): Promise<Evidence> {
  const d = await readJson(store, decisionKey(scope, requestId));
  if (!d) return "pending";
  if (d.d === "withdrawn") return "withdrawn";
  const o = await readJson(store, outcomeKey(scope, requestId)) as OutcomeRecord | null;
  return o ? o.kind : "in_flight";
}
async function currentS2Attempt(store: BarrierStore, scope: string, op: string): Promise<number> {
  let n = 0;
  while (await readJson(store, attemptKey(scope, op, "S2", n + 1))) n++;
  return n;
}
const proved = (e: Evidence) => e === "withdrawn" || e === "not_dispatched";

export async function viewOf(store: BarrierStore, scope: string, o: OpRecord): Promise<OpView> {
  const f = await readJson(store, finalKey(scope, o.op)) as FinalRecord | null;
  const s1 = await evidenceOf(store, scope, requestIdFor(o.op, "S1", 1));
  const n = await currentS2Attempt(store, scope, o.op);
  const s2: Evidence = n ? await evidenceOf(store, scope, requestIdFor(o.op, "S2", n)) : "pending";
  const base = { op: o.op, field: o.field, opportunityId: o.opportunityId, s1, s2, s2Attempt: n };
  if (f) return { ...base, state: f.kind };
  if (s1 === "pending") return { ...base, state: "pending" };
  if (proved(s1)) return { ...base, state: "not_saved" };
  if (s1 === "in_flight" || s1 === "uncertain") return { ...base, state: "not_confirmed" };
  if (s1 === "confirmed_conditions_changed") return { ...base, state: "saved_conditions_changed" };
  if (s1 !== "confirmed_clean") return { ...base, state: "not_confirmed" };
  if (s2 === "confirmed") return { ...base, state: "committed" };
  if (s2 === "in_flight" || s2 === "uncertain") return { ...base, state: "history_unresolved" };
  return { ...base, state: "saved_history_pending" };
}

async function finalize(store: BarrierStore, scope: string, o: OpRecord, kind: FinalRecord["kind"], now: string): Promise<void> {
  await writeOnceVerified(store, finalKey(scope, o.op), { v: 1, op: o.op, kind, at: now }, (g) => g.op === o.op && g.kind === kind);
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const h = await readHead(store, scope, o.contactId);
    if (h.current !== o.op) return;
    if (await casHead(store, scope, o.contactId, h.etag, null, now)) return;
  }
}

export async function readOp(store: BarrierStore, scope: string, op: string): Promise<OpRecord | null> {
  return await readJson(store, opKey(scope, op)) as OpRecord | null;
}
/** The contact's current answer operation, if any (head names it and it is not finished). */
export async function currentOperation(store: BarrierStore, scope: string, contact: string): Promise<{ op: OpRecord; view: OpView } | null> {
  const h = await readHead(store, scope, contact);
  if (!h.current) return null;
  const o = await readOp(store, scope, h.current);
  if (!o) throw new StorageUnsettled("The open answer operation is not readable yet");
  return { op: o, view: await viewOf(store, scope, o) };
}

// ── Discovery: the deal-set evaluation behind every read and save ────────────

export type DiscoveryResult = {
  verdict: DealSetVerdict; discovery: Discovery; committedGen: number;
  target: any | null; otherOpen: boolean;
};

/**
 * register -> search + fresh single reads of every candidate -> commit (with
 * recovery of stale discoveries when the caller holds the contact lock) ->
 * evaluate. Fenced or unsettled anywhere: the caller treats the list as
 * INCOMPLETE and sends nothing. Never registers a replacement token.
 */
export async function discover(input: {
  boundary: GhlBoundary; store: BarrierStore; scope: string; config: GhlConfig;
  contactId: string; targetId: string; lockHeld: boolean; now: () => string;
}): Promise<DiscoveryResult> {
  const { boundary, store, scope, config, contactId, targetId } = input;
  const d = new Discovery(store, scope, contactId);
  const registered = await d.register(input.now());
  const search = await boundary.sellerDeals(contactId, config.pipelines.sellerLeads).catch(() => null);
  const searchIds: string[] = Array.isArray(search?.opportunities) ? search.opportunities.filter((x: any) => x && typeof x.id === "string").map((x: any) => x.id) : [];
  const candidates = [...new Set([...searchIds, ...Object.keys(registered.ids), targetId])];
  const fresh = new Map<string, any>();
  for (const id of candidates) {
    try { fresh.set(id, await boundary.opportunity(id)); } catch { fresh.set(id, "unreadable"); }
  }
  const observed: Observation[] = [];
  for (const id of searchIds) observed.push({ id, source: "search" });
  for (const [id, f] of fresh) if (f !== "unreadable" && f.contactId === contactId && f.pipelineId === config.pipelines.sellerLeads && !searchIds.includes(id)) observed.push({ id, source: "single_read" });
  const now = input.now();
  const stale = input.lockHeld ? staleTokens(registered, Date.parse(now), d.token) : [];
  if (stale.length) await recordRecovery(store, scope, contactId, d.token, stale, registered, now);
  const { rec, gen } = await d.commit(observed, now, stale);
  // An id committed by another discovery since registration has no fresh read here: UNKNOWN, so blocked.
  const verdict = evaluateDealSet({ search, fresh, ledgerIds: Object.keys(rec.ids), targetId, contactId, config });
  const otherOpen = openTokens(rec).length > 0;
  const target = fresh.get(targetId);
  return { verdict, discovery: d, committedGen: gen, target: target && target !== "unreadable" ? target : null, otherOpen };
}

// ── The target's own checks (r3 §4) ──────────────────────────────────────────

export function addressIds(config: GhlConfig): AddressFieldIds {
  const p = config.propertyAnswerFields;
  return { street: p.propertyStreet, unit: p.propertyUnit, city: p.propertyCity, state: p.propertyState, zip: p.propertyZip };
}
export function targetAddress(config: GhlConfig, opp: any): AddressState {
  return readAddress(opp.customFields ?? [], addressIds(config));
}
/** The field's current stored value as text (for the previous-revision link and reconciliation). */
export function currentValueText(config: GhlConfig, field: AnswerField, opp: any): string | null {
  if (field === "seller_reason") {
    const f = fieldValue(opp.customFields ?? [], config.propertyAnswerFields.sellerReason, "opportunity");
    if (f.present && typeof f.value !== "string") throw new Error("Seller Reason readback is ambiguous");
    return f.present ? f.value as string : null;
  }
  const a = targetAddress(config, opp);
  return a.kind === "empty" ? null : JSON.stringify(ADDRESS_KEYS.map((x) => a.address[x]));
}

/** r3 §4 checks 1, 2 and 4 on one fresh read of the target. Returns the failed check, or null. */
export function targetRefusal(config: GhlConfig, opp: any, contactId: string, field: AnswerField, expectedAddressDigest: string): string | null {
  if (!opp || opp.contactId !== contactId) return "target_contact";
  if (classifyDeal(opp, contactId, config) !== "ELIGIBLE") return "target_not_eligible";
  const a = targetAddress(config, opp);
  if (field === "property_address") {
    if (a.kind !== "empty") return "address_already_set";
    if (expectedAddressDigest !== EMPTY_ADDRESS_DIGEST) return "stale_address";
    return null;
  }
  if (a.kind !== "confirmed") return "address_not_confirmed";
  if (a.digest !== expectedAddressDigest) return "stale_address";
  return null;
}

// ── S1: the save ─────────────────────────────────────────────────────────────

export type SaveInput = {
  boundary: GhlBoundary; store: BarrierStore; scope: string; config: GhlConfig; environment: string;
  contactId: string; opportunityId: string; field: AnswerField; operationId: string;
  fields: FieldWrite[]; valueText: string; valueLines: string[];
  expectedAddressDigest: string; expectedDealSetDigest: string; now: () => string;
};
export type SaveResult = { view: OpView; message: string };

/** The caller holds lockContact(contactId) for the whole call. */
export async function saveAnswer(input: SaveInput): Promise<SaveResult> {
  const { boundary, store, scope, config, contactId, opportunityId, field, operationId: op } = input;
  if (!OPERATION_ID.test(op)) throw new NotSent("Invalid operation id", "invalid_operation");
  // A repeated save of the SAME operation (e.g. after a lost response) never acts again: it reports what was recorded.
  const existing = await readOp(store, scope, op);
  if (existing) {
    if (existing.contactId !== contactId || existing.opportunityId !== opportunityId || existing.field !== field) throw new NotSent("This operation id belongs to another save", "operation_mismatch");
    return { view: await viewOf(store, scope, existing), message: "Already recorded." };
  }
  // An unfinished operation holds the contact (settled first, so a finished-but-unreleased one does not).
  const cur = await currentOperation(store, scope, contactId);
  if (cur) {
    const v = await settleUnderLock(input, cur.op);
    if (!["committed", "not_saved"].includes(v.state)) throw new AnswerHeld(v);
  }
  // L1-L3: the deal set, evaluated under the lock.
  let ev: DiscoveryResult;
  try { ev = await discover({ boundary, store, scope, config, contactId, targetId: opportunityId, lockHeld: true, now: input.now }); }
  catch (e) { throw new NotSent(e instanceof Fenced ? "The deal check was superseded. Nothing was saved." : "The deal list could not be confirmed. Nothing was saved.", "deal_set_unconfirmed"); }
  if (!ev.verdict.allowed) throw new NotSent("Deal check refused", ev.verdict.reason, ev.verdict);
  if (ev.otherOpen) throw new NotSent("Another deal check is in progress", "discovery_open");
  if (ev.verdict.digest !== input.expectedDealSetDigest) throw new NotSent("The deal list changed since you looked", "deal_set_changed");
  const refusal = targetRefusal(config, ev.target, contactId, field, input.expectedAddressDigest);
  if (refusal) throw new NotSent("Deal or address check refused", refusal);

  // Publish the operation, its S1 attempt and the head (each verified).
  const now = input.now();
  const valueDigest = sha256(input.valueText);
  const o: OpRecord = { v: 1, op, contactId, opportunityId, field, valueText: input.valueText, valueDigest, valueLines: input.valueLines, expectedAddressDigest: input.expectedAddressDigest, dealSetDigest: ev.verdict.digest, createdAt: now };
  const same = (g: OpRecord) => g.op === o.op && g.contactId === o.contactId && g.opportunityId === o.opportunityId && g.field === o.field && g.valueDigest === o.valueDigest;
  try {
    await writeOnceVerified(store, opKey(scope, op), o, same);
    const requestId = requestIdFor(op, "S1", 1);
    await writeOnceVerified(store, attemptKey(scope, op, "S1", 1), { v: 1, op, slot: "S1", n: 1, requestId }, (g) => g.requestId === requestId);
    let headed = false;
    for (let i = 0; i < CAS_ATTEMPTS && !headed; i++) {
      const h = await readHead(store, scope, contactId);
      if (h.current === op) { headed = true; break; }
      if (h.current) { const other = await readOp(store, scope, h.current); const v = other ? await viewOf(store, scope, other) : null; if (!v || !["committed", "not_saved"].includes(v.state)) throw new NotSent("Another answer save holds this contact", "held"); }
      headed = await casHead(store, scope, contactId, h.etag, op, now);
    }
    if (!headed) throw new StorageUnsettled("The answer operation could not be registered");
  } catch (e) {
    await withdrawIfUndecided(store, scope, o);
    if (e instanceof NotSent) throw e;
    throw new NotSent("The save could not be registered. Nothing was sent.", "registration_failed");
  }

  const requestId = requestIdFor(op, "S1", 1);
  let previousDigest: string | null = null;
  const state = { dispatched: false, claimed: false };
  const hooks = {
    state,
    // L4: the boundary's own pre-read, the last read before the PUT.
    verify: (pre: any) => {
      const r = targetRefusal(config, pre, contactId, field, input.expectedAddressDigest);
      if (r) throw new NotSent("The deal changed before the save", r);
      const prev = currentValueText(config, field, pre);
      previousDigest = prev === null ? "none" : sha256(prev);
    },
    // The save gate: ledger authority, operation ownership, then the send claim.
    beforeDispatch: async () => {
      await ev.discovery.confirmUnchanged(ev.committedGen, input.now());
      const h = await readHead(store, scope, contactId);
      if (h.current !== op || !h.etag || !(await casHead(store, scope, contactId, h.etag, op, input.now()))) throw new NotSent("This save no longer owns the contact", "not_owner");
      let claim: { modified: boolean };
      try { claim = await store.setJSON(decisionKey(scope, requestId), { d: "send", at: input.now() }, { onlyIfNew: true }); }
      catch { throw new NotSent("The send claim could not be confirmed", "claim_ambiguous"); }
      if (!claim.modified) throw new NotSent("This attempt was withdrawn or already claimed", "claim_lost");
      state.claimed = true;
    },
  };
  let result: { confirmed: boolean; readback: any };
  try {
    result = await boundary.fields("opportunity", opportunityId, input.fields, hooks);
  } catch (error) {
    if (!state.dispatched) {
      // Nothing reached GHL from this invocation. Prove it durably where possible.
      if (state.claimed) await createOutcome(store, scope, outcome(o, "S1", 1, "not_dispatched", null, null, null, input.now()));
      else await store.setJSON(decisionKey(scope, requestId), { d: "withdrawn", at: input.now() }, { onlyIfNew: true }).catch(() => null);
      const v = await viewOf(store, scope, o).catch(() => null);
      if (v && v.state === "not_saved") await finalize(store, scope, o, "not_saved", input.now()).catch(() => null);
      const code = error instanceof NotSent ? error.code : error instanceof Fenced ? "fenced" : "not_dispatched";
      throw new NotSent(error instanceof Error ? error.message : "Not sent", code, v);
    }
    await createOutcome(store, scope, outcome(o, "S1", 1, "uncertain", null, previousDigest, null, input.now()));
    return { view: await viewOf(store, scope, o), message: "Not confirmed. Held for reconciliation." };
  }
  if (!result.confirmed) {
    await createOutcome(store, scope, outcome(o, "S1", 1, "uncertain", readbackDigest(input.fields, result.readback), previousDigest, null, input.now()));
    return { view: await viewOf(store, scope, o), message: "Not confirmed. Held for reconciliation." };
  }
  // L5: the post-write bracket -- the readback and a second, read-only-to-GHL deal evaluation.
  const discrepancy: Record<string, boolean> = {};
  const afterTarget = targetRefusalAfter(config, result.readback, contactId, field, input);
  if (afterTarget) discrepancy[afterTarget] = true;
  try {
    const again = await discover({ boundary, store, scope, config, contactId, targetId: opportunityId, lockHeld: true, now: input.now });
    if (!again.verdict.allowed) discrepancy["deal_set_" + again.verdict.reason] = true;
    if (again.verdict.digest !== ev.verdict.digest) discrepancy.deal_set_changed = true;
  } catch { discrepancy.deal_set_unconfirmed = true; }
  const kind: S1Kind = Object.keys(discrepancy).length ? "confirmed_conditions_changed" : "confirmed_clean";
  const created = await createOutcome(store, scope, outcome(o, "S1", 1, kind, readbackDigest(input.fields, result.readback), previousDigest, kind === "confirmed_clean" ? null : discrepancy, input.now()));
  await store.setJSON(draftKey(scope, contactId, opportunityId, field), { v: 1, cleared: true, at: input.now() }).catch(() => null);
  if (created !== "created") return { view: await viewOf(store, scope, o), message: "Saved in GHL, but the save record could not be confirmed. Held for reconciliation." };
  if (kind === "confirmed_clean") {
    try { await store.setJSON(permitKey(scope, op), { v: 1, op, requestId, at: input.now() }, { onlyIfNew: true }); }
    catch { return { view: await viewOf(store, scope, o), message: "Saved in GHL; history permission could not be confirmed. Held for reconciliation." }; }
  }
  return { view: await viewOf(store, scope, o), message: kind === "confirmed_clean" ? "Saved. Recording history." : "Saved; conditions changed during save; held for reconciliation." };
}

function outcome(o: OpRecord, slot: Slot, n: number, kind: S1Kind | S2Kind, readback: string | null, previousDigest: string | null, discrepancy: Record<string, boolean> | null, at: string): OutcomeRecord {
  return { v: 1, op: o.op, slot, n, requestId: requestIdFor(o.op, slot, n), kind, valueDigest: o.valueDigest, readbackDigest: readback, previousDigest, discrepancy, at };
}
function readbackDigest(fields: FieldWrite[], readback: any): string {
  return sha256(JSON.stringify(fields.map((f) => [f.id, fieldValue(readback.customFields ?? [], f.id, "opportunity").value ?? null])));
}
/** The post-write target check: same identity and eligibility; the address is the bound one (or, for an address save, the one written). */
function targetRefusalAfter(config: GhlConfig, opp: any, contactId: string, field: AnswerField, input: SaveInput): string | null {
  if (!opp || opp.contactId !== contactId) return "target_contact";
  if (classifyDeal(opp, contactId, config) !== "ELIGIBLE") return "target_not_eligible";
  const a = targetAddress(config, opp);
  if (field === "property_address") return a.kind === "confirmed" && sha256(JSON.stringify(ADDRESS_KEYS.map((x) => a.address[x]))) === sha256(input.valueText) ? null : "address_readback";
  return a.kind === "confirmed" && a.digest === input.expectedAddressDigest ? null : "address_changed";
}
async function withdrawIfUndecided(store: BarrierStore, scope: string, o: OpRecord): Promise<void> {
  try {
    if (!(await readJson(store, opKey(scope, o.op)))) return;
    await store.setJSON(decisionKey(scope, requestIdFor(o.op, "S1", 1)), { d: "withdrawn", at: new Date().toISOString() }, { onlyIfNew: true });
    if ((await viewOf(store, scope, o)).state === "not_saved") await finalize(store, scope, o, "not_saved", new Date().toISOString());
  } catch { /* the operation stays as recorded; Check again settles it */ }
}

// ── S2: the answer-history note ──────────────────────────────────────────────

export type HistoryInput = { boundary: GhlBoundary; store: BarrierStore; scope: string; config: GhlConfig; environment: string; contactId: string; operationId: string; now: () => string };

export function historyEntryFor(o: OpRecord, s1: OutcomeRecord, environment: string, locationId: string): HistoryEntry {
  return {
    operationId: o.op, opportunityId: o.opportunityId, contactId: o.contactId, field: o.field, valueDigest: o.valueDigest,
    previousDigest: s1.previousDigest ?? "none", callSegment: "none", environment, locationId, valueLines: o.valueLines,
  };
}

/**
 * Sends S2 for the contact's current operation, under the lock. Allowed only
 * when S1's authoritative outcome for attempt 1 is confirmed_clean and S2's
 * current attempt is unsent (pending), or proved unsent (then attempt n+1).
 */
export async function recordHistory(input: HistoryInput): Promise<SaveResult> {
  const { boundary, store, scope, config, contactId, operationId: op } = input;
  const o = await readOp(store, scope, op);
  if (!o || o.contactId !== contactId) throw new NotSent("Unknown operation", "unknown_operation");
  const h = await readHead(store, scope, contactId);
  if (h.current !== op) throw new NotSent("This save is not the contact's current one", "not_current");
  const s1 = await readJson(store, outcomeKey(scope, requestIdFor(op, "S1", 1))) as OutcomeRecord | null;
  if (!s1 || s1.kind !== "confirmed_clean" || s1.op !== op || s1.n !== 1 || s1.valueDigest !== o.valueDigest) throw new NotSent("The value save is not confirmed clean; history is held", "s1_not_clean");
  const permit = await readJson(store, permitKey(scope, op));
  if (!permit || permit.op !== op || permit.requestId !== requestIdFor(op, "S1", 1)) throw new NotSent("The value save was not acknowledged as clean; history is held for reconciliation", "s1_not_acknowledged");
  let n = await currentS2Attempt(store, scope, op);
  let ev: Evidence = n ? await evidenceOf(store, scope, requestIdFor(op, "S2", n)) : "pending";
  if (ev === "confirmed") { await finalize(store, scope, o, "committed", input.now()); return { view: await viewOf(store, scope, o), message: "Saved." }; }
  if (ev === "in_flight" || ev === "uncertain") throw new NotSent("History is unresolved; use Check again", "history_unresolved");
  if (n === 0 || proved(ev)) {
    n += 1;
    const rid = requestIdFor(op, "S2", n);
    await writeOnceVerified(store, attemptKey(scope, op, "S2", n), { v: 1, op, slot: "S2", n, requestId: rid }, (g) => g.requestId === rid);
  }
  const requestId = requestIdFor(op, "S2", n);
  const body = historyNoteBody(historyEntryFor(o, s1, input.environment, config.locationId));
  const state = { dispatched: false, claimed: false };
  const hooks = {
    state,
    beforeDispatch: async () => {
      const again = await readJson(store, outcomeKey(scope, requestIdFor(op, "S1", 1))) as OutcomeRecord | null;
      if (!again || again.kind !== "confirmed_clean" || again.op !== op || again.n !== 1 || again.valueDigest !== o.valueDigest || again.readbackDigest !== s1.readbackDigest) throw new NotSent("S1 outcome changed", "s1_not_clean");
      const hh = await readHead(store, scope, contactId);
      if (hh.current !== op || !hh.etag || !(await casHead(store, scope, contactId, hh.etag, op, input.now()))) throw new NotSent("This save no longer owns the contact", "not_owner");
      let claim: { modified: boolean };
      try { claim = await store.setJSON(decisionKey(scope, requestId), { d: "send", at: input.now() }, { onlyIfNew: true }); }
      catch { throw new NotSent("The send claim could not be confirmed", "claim_ambiguous"); }
      if (!claim.modified) throw new NotSent("This history attempt was withdrawn or already claimed", "claim_lost");
      state.claimed = true;
    },
  };
  try {
    await boundary.note(contactId, body, hooks);
  } catch (error) {
    if (!state.dispatched) {
      if (state.claimed) await createOutcome(store, scope, outcome(o, "S2", n, "not_dispatched", null, null, null, input.now()));
      else await store.setJSON(decisionKey(scope, requestId), { d: "withdrawn", at: input.now() }, { onlyIfNew: true }).catch(() => null);
      throw new NotSent(error instanceof Error ? error.message : "History not sent", error instanceof NotSent ? error.code : "not_dispatched", await viewOf(store, scope, o).catch(() => null));
    }
    await createOutcome(store, scope, outcome(o, "S2", n, "uncertain", null, null, null, input.now()));
    return { view: await viewOf(store, scope, o), message: "Saved; history unresolved." };
  }
  const created = await createOutcome(store, scope, outcome(o, "S2", n, "confirmed", null, null, null, input.now()));
  if (created === "created") await finalize(store, scope, o, "committed", input.now()).catch(() => null);
  return { view: await viewOf(store, scope, o), message: created === "created" ? "Saved." : "History sent, but its record could not be confirmed. Held for reconciliation." };
}

// ── Check again: settle what the evidence settles, under the lock ────────────

/**
 * Never sends and never resends. Under the contact lock no live original can
 * be mid-attempt, so: an undecided S1 is withdrawn (proved unsent -> Not
 * saved); a "send" without an outcome becomes uncertain (onlyIfNew; an
 * existing outcome wins and is left as is); an uncertain S1 gets a read-only
 * GHL observation that changes nothing; an uncertain S2 is committed only by
 * the r3 §5 complete-entry match.
 */
export async function settleUnderLock(input: { boundary: GhlBoundary; store: BarrierStore; scope: string; config: GhlConfig; environment: string; now: () => string }, o: OpRecord): Promise<OpView> {
  const { boundary, store, scope, config } = input;
  const s1Id = requestIdFor(o.op, "S1", 1);
  let s1 = await evidenceOf(store, scope, s1Id);
  if (s1 === "pending") {
    await store.setJSON(decisionKey(scope, s1Id), { d: "withdrawn", at: input.now() }, { onlyIfNew: true }).catch(() => null);
    s1 = await evidenceOf(store, scope, s1Id);
  }
  if (s1 === "in_flight") await createOutcome(store, scope, outcome(o, "S1", 1, "uncertain", null, null, null, input.now()));
  let v = await viewOf(store, scope, o);
  if (v.state === "not_saved") { await finalize(store, scope, o, "not_saved", input.now()).catch(() => null); return viewOf(store, scope, o); }
  if (v.s1 === "uncertain") {
    try {
      const opp = await boundary.opportunity(o.opportunityId);
      const cur = currentValueText(config, o.field, opp);
      await store.setJSON(observationKey(scope, s1Id), { v: 1, at: input.now(), valueDigest: cur === null ? null : sha256(cur), equalsIntended: cur !== null && sha256(cur) === o.valueDigest }, { onlyIfNew: true });
    } catch { /* an observation is optional evidence */ }
    return viewOf(store, scope, o);
  }
  if (v.s1 === "confirmed_clean" && v.s2Attempt > 0) {
    const s2Id = requestIdFor(o.op, "S2", v.s2Attempt);
    if (v.s2 === "pending") {
      await store.setJSON(decisionKey(scope, s2Id), { d: "withdrawn", at: input.now() }, { onlyIfNew: true }).catch(() => null);
    } else if (v.s2 === "in_flight") {
      await createOutcome(store, scope, outcome(o, "S2", v.s2Attempt, "uncertain", null, null, null, input.now()));
    }
    v = await viewOf(store, scope, o);
    if (v.state === "history_unresolved") {
      const s1rec = await readJson(store, outcomeKey(scope, s1Id)) as OutcomeRecord | null;
      if (s1rec) {
        try {
          const notes = await boundary.notes(o.contactId);
          const opp = await boundary.opportunity(o.opportunityId);
          const cur = currentValueText(config, o.field, opp);
          const r = reconcileHistory(notes, historyEntryFor(o, s1rec, input.environment, config.locationId), cur === null ? null : sha256(cur));
          await store.setJSON(observationKey(scope, s2Id), { v: 1, at: input.now(), reconcile: r }, { onlyIfNew: true }).catch(() => null);
          if (r.kind === "committed") await finalize(store, scope, o, "committed", input.now());
        } catch { /* stays unresolved */ }
      }
    }
  }
  return viewOf(store, scope, o);
}

// ── Drafts (server-side, Brad 2026-10-17) ────────────────────────────────────

export const DRAFT_MAX_CHARS = 4000;
export type Draft = { v: 1; value: string | Address; savedAt: string } | { v: 1; cleared: true; at: string };
export async function saveDraft(store: BarrierStore, scope: string, contact: string, opp: string, field: AnswerField, value: unknown, now: string): Promise<void> {
  let v: string | Address;
  if (field === "seller_reason") {
    if (typeof value !== "string" || value.length > DRAFT_MAX_CHARS) throw new Error("Invalid draft");
    v = value;
  } else {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid draft");
    const keys = Object.keys(value);
    if (keys.length !== ADDRESS_KEYS.length || ADDRESS_KEYS.some((x) => typeof (value as any)[x] !== "string" || (value as any)[x].length > 200)) throw new Error("Invalid draft");
    v = Object.fromEntries(ADDRESS_KEYS.map((x) => [x, (value as any)[x]])) as Address;
  }
  await store.setJSON(draftKey(scope, contact, opp, field), { v: 1, value: v, savedAt: now });
}
export async function readDraft(store: BarrierStore, scope: string, contact: string, opp: string, field: AnswerField): Promise<string | Address | null> {
  const d = await readJson(store, draftKey(scope, contact, opp, field)).catch(() => null) as Draft | null;
  return d && "value" in d ? d.value : null;
}

export { LedgerUnsettled, Fenced };
