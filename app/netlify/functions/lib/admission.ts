/**
 * Storage correction -- WRITE ADMISSION and PUBLICATION CONTROL (PR #131 focused
 * amendments r1–r4, approved by Bones at #issuecomment-6043033100).
 *
 * ONE authoritative key, `authz/admission`. Every fact that can authorize
 * admission, dispatch, a publication attempt, abandonment or activation lives in
 * it, and every transition is ONE conditional write (onlyIfMatch on the etag of
 * a strong read) through the verified adapter. No authorization decision reads
 * any other key. Ambiguous outcomes are resolved only by a strong read showing
 * that transition's own private mark; otherwise the transition did not happen.
 *
 * Invariants (each enforced by the single compare-and-swap):
 *  I1  `publication.outstanding` holds at most ONE non-terminal attempt for the
 *      environment; its presence blocks Claim, Close, Handover-with-dispatch and
 *      Activation.
 *  I2  An attempt leaves `outstanding` only in the same write that appends its
 *      terminal entry to `history`.
 *  I3  `state:"open"` is set only by Activation, which requires
 *      `outstanding === null` and `phase === "applied"`.
 *  I4  Historical copies (evidence/publication/...) are written AFTER the
 *      authoritative write and are never read for authorization. A missing or
 *      partial copy permits nothing.
 *
 * Sender tickets (r1/r2): a sender is ADMITTED, then marks itself DISPATCHING
 * immediately before the GHL request -- the dispatching write is the admission
 * point. Close revokes admitted tickets (they provably never send) and keeps
 * dispatching and uncertain tickets as durable barriers on their exact
 * (subject, effects). Activation never clears a ticket.
 *
 * Terminal classifier (r4 §C): DEFAULT DENY. Only ABANDONED is terminal without
 * provider semantics. APPLIED and REJECTED require an approved, immutable
 * `authz/provider-semantics/<n>` record whose exact predicate matches the
 * persisted evidence. Every 2xx (201 included) and every 4xx without one is
 * RESPONDED (non-terminal, blocking); no response, 429, 5xx, a malformed body or
 * a body naming another deploy is UNRESOLVED and can never become terminal.
 *
 * Accepted exception (Brad, #issuecomment-6042966089): only publications through
 * the controlled publisher (`iaos-publish`) reliably invalidate activation. A
 * Netlify Owner can publish outside it; after an out-of-tool A -> B -> A, A may
 * resume writes under its earlier activation without fresh verification. This is
 * recorded as an exception, NOT a protection (test OB-1). It does not cover
 * uncertain controlled publications, which stay governed by the classifier.
 */
import { createHash } from "node:crypto";
import { canonical, digest } from "./hash";
import { clock, InvocationScope } from "./invocation-scope";
import { StorageUncertain, VerifiedStore, type ReadResult } from "./verified-store";
import { diag } from "./diagnostics";
import { allows, tableDigest, validTable, widen as widenTable, type G5Table } from "./g5-gate";

export const ADMISSION_KEY = "authz/admission";
export const TICKET_OUTCOME_PREFIX = "authz/ticket-outcome/";
export const SEMANTICS_PREFIX = "authz/provider-semantics/";
export const PUBLICATION_ARCHIVE_PREFIX = "evidence/publication/";
export const ACTIVATION_ARCHIVE_PREFIX = "evidence/activation/";
const CAS_ATTEMPTS = 4;

// ── Records ──────────────────────────────────────────────────────────────────
export type TicketState = "admitted" | "dispatching" | "uncertain";
export type Ticket = {
  ticketId: string; state: TicketState; epoch: number; activationId: string; deployId: string;
  opId: string; attemptId: string; requestDigest: string; subject: string; effects: string[];
  ownerHash: string; admitMark: string; dispatchMark?: string; uncertainMark?: string;
  fn: string; deadline: string; at: string;
};
export type ResponseEvidence = {
  pubId: string; attemptId: string; requestFingerprint: string; transition: "T4";
  status: number; contentType: string | null; bodyDigest: string; bodyJson: boolean;
  fields: Record<string, string | null>; receivedAt: string; evidenceDigest: string;
};
export type OutstandingAttempt = {
  attemptId: string; claimantHash: string; claimMark: string;
  state: "claimed" | "dispatching" | "responded" | "unresolved";
  dispatchMark?: string; unresolvedMark?: string;
  request?: { method: string; path: string; targetDeployId: string; sentAt: string; fingerprint: string };
  evidence?: ResponseEvidence; reason?: string; at: string;
};
export type HistoryEntry = { attemptId: string; terminal: "APPLIED" | "REJECTED" | "ABANDONED"; evidenceDigest: string | null; semanticsRef: string | null; requestFingerprint: string | null; at: string; mark: string };
export type Publication = {
  pubId: string; targetDeployId: string; publisherHash: string; closeMark: string; closedAt: string;
  phase: "closed" | "applied"; outstanding: OutstandingAttempt | null; history: HistoryEntry[];
  attemptSetDigest: string; handoverMarks: string[];
};
export type Admission = {
  v: 3; epoch: number; activationId: string | null; deployId: string | null; state: "open" | "closed";
  g5Digest: string | null; activatedAt: string | null; activationMark: string | null; initMark?: string;
  /**
   * Bones review finding 1: the EFFECTIVE G5 table lives in this same record, so policy and admission
   * share one compare-and-swap. Admit and Dispatching check it inside their own write; a widening is a
   * write to this record that also revokes already-admitted overlapping tickets. Narrowing is staged in
   * `authz/g5/table` and becomes effective only through a fresh activation (T9 copies the approved table).
   */
  g5: G5Table | null;
  tickets: Record<string, Ticket>; publication: Publication | null;
};

export type Captured = { epoch: number; activationId: string; deployId: string; g5Digest: string | null };

// ── Errors (each maps to a fixed response) ──────────────────────────────────
/** No admission record, or admission closed: writes refused (503). */
export class AdmissionClosed extends Error { constructor(readonly code: "activation_missing" | "admission_closed" | "publication_unresolved") { super("Saving is paused: writes are not admitted on this deployment"); this.name = "AdmissionClosed"; } }
/** The invocation's captured activation no longer matches (409 activation_changed). */
export class ActivationChanged extends Error { constructor() { super("This page is out of date — reload"); this.name = "ActivationChanged"; } }
/** The effective G5 table (in this record) blocks the subject/effects: nothing may be admitted or dispatched. */
export class G5Blocked extends Error { constructor() { super("Saving is held while earlier save records are reviewed"); this.name = "G5Blocked"; } }
/** An overlapping live ticket exists (409). */
export class TicketOverlap extends Error { constructor(readonly state: TicketState) { super("Another save for this record is in progress or unresolved"); this.name = "TicketOverlap"; } }
/** The transition's outcome could not be established: it is treated as NOT done. */
export class TransitionUnresolved extends Error { constructor(readonly transition: string) { super(`Transition ${transition} could not be confirmed`); this.name = "TransitionUnresolved"; } }
/** A publication transition was refused by its precondition. */
export class PublicationRefused extends Error { constructor(readonly code: string, m?: string) { super(m ?? `Publication transition refused (${code})`); this.name = "PublicationRefused"; } }

// ── Reads ───────────────────────────────────────────────────────────────────
export async function readAdmission(store: VerifiedStore): Promise<ReadResult<Admission>> {
  const r = await store.read<Admission>(ADMISSION_KEY, "admission");
  if (r && (r.data?.v !== 3 || typeof r.data.tickets !== "object" || r.data.tickets === null)) throw new StorageUncertain("admission", "readback_mismatch");
  return r;
}

/**
 * Captured ONCE at handler entry, after auth and shape validation and before any
 * ownership I/O. Refuses unless admission is open for THIS deployment. An
 * invocation never adopts a newer activation afterwards.
 */
export async function captureActivation(store: VerifiedStore, deployId: string, clientActivationId: string | null | undefined, cache?: AdmissionCache): Promise<Captured> {
  const r = await readAdmission(store);
  if (cache) cache.last = r;
  if (!r) throw new AdmissionClosed("activation_missing");
  const a = r.data;
  if (a.state !== "open" || !a.activationId || a.deployId !== deployId) {
    throw new AdmissionClosed(a.publication?.outstanding ? "publication_unresolved" : a.state === "open" ? "activation_missing" : "admission_closed");
  }
  if (clientActivationId !== undefined && clientActivationId !== a.activationId) throw new ActivationChanged();
  return { epoch: a.epoch, activationId: a.activationId, deployId: a.deployId, g5Digest: a.g5Digest };
}

// ── Overlap ─────────────────────────────────────────────────────────────────
export function effectsOverlap(a: string[], b: string[]): boolean {
  if (a.includes("*") || b.includes("*")) return true;
  return a.some((e) => b.includes(e));
}
export function subjectsOverlap(a: string, b: string): boolean { return a === "location" || b === "location" || a === b; }

/** A live ticket blocks overlapping work. An `admitted` ticket past its holder deadline never dispatched and may be revoked. */
const blocks = (t: Ticket, now: number) => t.state !== "admitted" || now <= Date.parse(t.deadline);

// ── Generic single-key transition ───────────────────────────────────────────
/**
 * This invocation's last KNOWN admission record and etag (its own last read or
 * write). A transition may try its compare-and-swap from it instead of reading
 * first: an etag identifies exact content, so a stale entry can only conflict
 * (then a fresh read decides), and a refusal decided on cached data is always
 * re-confirmed by a fresh read. It saves round trips; it never authorizes.
 */
export type AdmissionCache = { last: ReadResult<Admission> | null };
type Decision<T> = { write: Admission; result: T } | { refuse: Error } | { done: T };
/**
 * Runs one transition: strong read -> decide -> ONE conditional write. A conflict
 * re-reads and re-decides. An ambiguous write is resolved ONLY by `applied(read)`
 * (the transition's exact mark); otherwise TransitionUnresolved (not done).
 */
async function transition<T>(store: VerifiedStore, name: string, decide: (cur: Admission | null) => Decision<T>, applied: (cur: Admission | null) => T | null, cache?: AdmissionCache): Promise<T> {
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const cached = i === 0 && cache?.last ? cache.last : null;
    const r = cached ?? await readAdmission(store);
    if (cache && !cached) cache.last = r;
    const d = decide(r ? r.data : null);
    if ("refuse" in d) { if (cached) { cache!.last = null; i--; continue; } throw d.refuse; }
    if ("done" in d) { if (cached) { cache!.last = null; i--; continue; } return d.done; }
    let w;
    try { w = await store.cas(ADMISSION_KEY, d.write, r ? r.etag : null, "admission"); }
    catch (e) {
      if (!(e instanceof StorageUncertain)) throw e;
      let again: ReadResult<Admission>;
      try { again = await readAdmission(store); } catch { throw new TransitionUnresolved(name); }
      if (cache) cache.last = again;
      const ok = applied(again ? again.data : null);
      if (ok !== null) return ok;
      diag({ fn: store.scope.fn, action: "admission", phase: "admission", class: "ack_ambiguous" });
      throw new TransitionUnresolved(name);
    }
    if (w.result === "written") { if (cache) cache.last = { data: d.write, etag: w.etag }; return d.result; }
    if (cache) cache.last = null;
  }
  throw new TransitionUnresolved(name);
}

// ── Sender tickets ──────────────────────────────────────────────────────────
export type TicketSpec = { opId: string; attemptId: string; requestId: string; subject: string; effects: string[] };
export type HeldTicket = { ticket: Ticket; scope: InvocationScope; captured: Captured; pendingDispatch?: Ticket; cache?: AdmissionCache };

const ticketMatches = (got: Ticket | undefined, want: Ticket, state: TicketState, markField?: "dispatchMark" | "uncertainMark") =>
  !!got && got.ticketId === want.ticketId && got.state === state && got.epoch === want.epoch && got.activationId === want.activationId &&
  got.deployId === want.deployId && got.opId === want.opId && got.attemptId === want.attemptId && got.requestDigest === want.requestDigest &&
  got.ownerHash === want.ownerHash && got.admitMark === want.admitMark && (!markField || got[markField] === want[markField]);

/** Admit (one CAS). Requires the captured activation, an open record and no overlapping live ticket of any epoch. */
export async function admit(store: VerifiedStore, scope: InvocationScope, captured: Captured, spec: TicketSpec, cache?: AdmissionCache): Promise<HeldTicket> {
  const ownerHash = scope.claimantHash;
  const ticketId = digest(scope.mark("ticket", spec.requestId)).slice(0, 32);
  const base: Ticket = {
    ticketId, state: "admitted", epoch: captured.epoch, activationId: captured.activationId, deployId: captured.deployId,
    opId: spec.opId, attemptId: spec.attemptId, requestDigest: digest(spec.requestId), subject: spec.subject, effects: [...spec.effects].sort(),
    ownerHash, admitMark: scope.mark("admit", ticketId, String(captured.epoch), captured.activationId, spec.opId, spec.attemptId),
    fn: scope.fn, deadline: new Date(scope.deadlines.abs).toISOString(), at: new Date().toISOString(),
  };
  const ticket = await transition<Ticket>(store, "admit", (cur) => {
    if (!cur) return { refuse: new AdmissionClosed("activation_missing") };
    if (cur.state !== "open") return { refuse: new AdmissionClosed(cur.publication?.outstanding ? "publication_unresolved" : "admission_closed") };
    if (cur.epoch !== captured.epoch || cur.activationId !== captured.activationId || cur.deployId !== captured.deployId) return { refuse: new ActivationChanged() };
    if (!allows(cur.g5, base.subject, base.effects).ok) { diag({ fn: scope.fn, action: "admit", phase: "g5_gate", class: "g5_blocked" }); return { refuse: new G5Blocked() }; }
    const now = clock.now();
    const tickets = { ...cur.tickets };
    for (const t of Object.values(cur.tickets)) {
      if (!subjectsOverlap(t.subject, base.subject) || !effectsOverlap(t.effects, base.effects)) continue;
      if (blocks(t, now)) { diag({ fn: scope.fn, action: "admit", phase: "ticket", class: "ticket_overlap" }); return { refuse: new TicketOverlap(t.state) }; }
      delete tickets[t.ticketId];   // an expired admitted ticket never dispatched: revoking it is what Close does
    }
    tickets[base.ticketId] = base;
    return { write: { ...cur, tickets }, result: base };
  }, (cur) => (cur && ticketMatches(cur.tickets[base.ticketId], base, "admitted") ? base : null), cache);
  return { ticket, scope, captured, cache };
}

/**
 * Dispatching (one CAS) -- the ADMISSION POINT. Nothing after it consults
 * publication state. An ambiguous result is resolved only by our exact
 * dispatchMark; a read showing `admitted` means it did not apply: send nothing.
 */
export async function markDispatching(store: VerifiedStore, held: HeldTicket): Promise<void> {
  const t = held.ticket;
  const next: Ticket = { ...t, state: "dispatching", dispatchMark: held.scope.mark("dispatch", t.ticketId, String(t.epoch), t.activationId, t.opId, t.attemptId) };
  held.pendingDispatch = next;
  await transition<true>(store, "dispatching", (cur) => {
    if (!cur) return { refuse: new AdmissionClosed("activation_missing") };
    const got = cur.tickets[t.ticketId];
    if (ticketMatches(got, next, "dispatching", "dispatchMark")) return { done: true };
    if (!ticketMatches(got, t, "admitted")) return { refuse: new AdmissionClosed("admission_closed") };   // revoked by Close
    if (cur.state !== "open" || cur.epoch !== held.captured.epoch || cur.activationId !== held.captured.activationId) return { refuse: new ActivationChanged() };
    // The admission point re-checks the effective table in the SAME write.
    if (!allows(cur.g5, t.subject, t.effects).ok) return { refuse: new G5Blocked() };
    return { write: { ...cur, tickets: { ...cur.tickets, [t.ticketId]: next } }, result: true };
  }, (cur) => (cur && ticketMatches(cur.tickets[t.ticketId], next, "dispatching", "dispatchMark") ? true : null), held.cache);
  held.ticket = next;
}

/** Dispatched, outcome not confirmed: dispatching -> uncertain. If unresolved, the ticket is still `dispatching`, which blocks the same. */
export async function markUncertain(store: VerifiedStore, held: HeldTicket): Promise<void> {
  const t = held.ticket;
  if (t.state !== "dispatching") return;
  const next: Ticket = { ...t, state: "uncertain", uncertainMark: held.scope.mark("uncertain", t.ticketId) };
  try {
    await transition<true>(store, "uncertain", (cur) => {
      const got = cur?.tickets[t.ticketId];
      if (got && got.state === "uncertain" && got.uncertainMark === next.uncertainMark) return { done: true };
      if (!cur || !ticketMatches(got, t, "dispatching", "dispatchMark")) return { refuse: new TransitionUnresolved("uncertain") };
      return { write: { ...cur, tickets: { ...cur.tickets, [t.ticketId]: next } }, result: true };
    }, (cur) => (cur?.tickets[t.ticketId]?.uncertainMark === next.uncertainMark ? true : null), held.cache);
    held.ticket = next;
  } catch { /* still `dispatching`: it blocks just the same */ }
}

/** The ticket's own persisted terminal outcome, keyed by ticket. */
export const ticketOutcomeKey = (ticketId: string) => TICKET_OUTCOME_PREFIX + ticketId;
export type TicketOutcome = { v: 1; ticketId: string; requestDigest: string; opId: string; attemptId: string; kind: "confirmed" | "not_dispatched"; ownerHash: string; at: string };

/**
 * Remove (terminal). Requires the persisted terminal outcome for EXACTLY this
 * ticket (confirmed, or not_dispatched by its owner), written and read back
 * BEFORE the compare-and-swap. An ambiguous removal is confirmed only by the
 * ticket's absence AND that outcome; otherwise the ticket stays and blocks.
 */
export async function removeWithOutcome(store: VerifiedStore, held: HeldTicket, kind: TicketOutcome["kind"]): Promise<boolean> {
  const t = held.ticket;
  held.scope.enterCleanup();
  if (kind === "not_dispatched" && t.state === "uncertain") return false;
  const outcome: TicketOutcome = { v: 1, ticketId: t.ticketId, requestDigest: t.requestDigest, opId: t.opId, attemptId: t.attemptId, kind, ownerHash: t.ownerHash, at: new Date().toISOString() };
  try {
    await store.writeOnceVerified(ticketOutcomeKey(t.ticketId), outcome, (g: TicketOutcome) => g.ticketId === t.ticketId && g.kind === kind && g.requestDigest === t.requestDigest && g.ownerHash === t.ownerHash, "outcome_record");
  } catch { return false; }
  try {
    await transition<true>(store, "remove", (cur) => {
      if (!cur) return { refuse: new TransitionUnresolved("remove") };
      const got = cur.tickets[t.ticketId];
      if (!got) return { done: true };
      if (got.ownerHash !== t.ownerHash || got.requestDigest !== t.requestDigest) return { refuse: new TransitionUnresolved("remove") };
      if (kind === "not_dispatched" && got.state === "uncertain") return { refuse: new TransitionUnresolved("remove") };
      const tickets = { ...cur.tickets }; delete tickets[t.ticketId];
      return { write: { ...cur, tickets }, result: true };
    }, (cur) => (cur && !cur.tickets[t.ticketId] ? true : null), held.cache);
    return true;
  } catch { return false; }
}

/** An admitted ticket that never reached dispatching: removed by its owner (it carries no send). */
export async function withdrawAdmitted(store: VerifiedStore, held: HeldTicket): Promise<boolean> {
  const t = held.ticket;
  if (t.state !== "admitted") return false;
  held.scope.enterCleanup();
  try {
    await transition<true>(store, "withdraw", (cur) => {
      const got = cur?.tickets[t.ticketId];
      if (!cur || !got) return { done: true };
      if (!ticketMatches(got, t, "admitted")) return { refuse: new TransitionUnresolved("withdraw") };
      const tickets = { ...cur.tickets }; delete tickets[t.ticketId];
      return { write: { ...cur, tickets }, result: true };
    }, (cur) => (cur && !cur.tickets[t.ticketId] ? true : null));
    return true;
  } catch { return false; }
}

/**
 * Same-operation recovery: removes a dispatching or uncertain ticket ONLY when
 * `verifiedConfirmed(ticket)` establishes, by a strong read, the persisted
 * CONFIRMED terminal outcome of that exact operation attempt (request). A
 * completed-operation record, another attempt's outcome or an uncertain outcome
 * never removes it. There is no other removal path.
 */
export async function recoverTickets(store: VerifiedStore, pick: (t: Ticket) => boolean, verifiedConfirmed: (t: Ticket) => Promise<boolean>): Promise<number> {
  const r = await readAdmission(store);
  if (!r) return 0;
  let removed = 0;
  for (const t of Object.values(r.data.tickets)) {
    if (t.state === "admitted" || !pick(t)) continue;
    let ok = false;
    try { ok = await verifiedConfirmed(t); } catch { ok = false; }
    if (!ok) continue;
    try {
      await transition<true>(store, "recover", (cur) => {
        const got = cur?.tickets[t.ticketId];
        if (!cur || !got) return { done: true };
        if (got.requestDigest !== t.requestDigest || got.opId !== t.opId || got.attemptId !== t.attemptId) return { refuse: new TransitionUnresolved("recover") };
        const tickets = { ...cur.tickets }; delete tickets[t.ticketId];
        return { write: { ...cur, tickets }, result: true };
      }, (cur) => (cur && !cur.tickets[t.ticketId] ? true : null));
      removed++;
    } catch { /* stays */ }
  }
  return removed;
}

/** Live tickets overlapping (subject, effects) -- for status reads. */
export function overlappingTickets(a: Admission, subject: string, effects: string[], now = clock.now()): Ticket[] {
  return Object.values(a.tickets).filter((t) => subjectsOverlap(t.subject, subject) && effectsOverlap(t.effects, effects) && blocks(t, now));
}

// ── Publication (operator side through iaos-activation) ─────────────────────
/** The publisher's private token p (hex, 32 bytes) -> its hash and per-transition marks. The function never stores p. */
export function publisherHashOf(p: string): string { return createHash("sha256").update(Buffer.from(p, "hex")).digest("hex"); }
export function publisherMark(p: string, transition: string, attemptId: string, pubId: string, target: string): string {
  return createHash("sha256").update(Buffer.from(p, "hex")).update("\u0000" + transition + "\u0000" + attemptId + "\u0000" + pubId + "\u0000" + target).digest("hex");
}
export const validToken = (p: unknown): p is string => typeof p === "string" && /^[0-9a-f]{64}$/.test(p);
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
const validDeployId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{24}$/.test(v);

export function attemptSetDigestOf(p: Pick<Publication, "pubId" | "targetDeployId" | "history" | "outstanding">): string {
  return digest(canonical({ pubId: p.pubId, target: p.targetDeployId, history: p.history, outstanding: p.outstanding }));
}
const withDigest = (p: Publication): Publication => ({ ...p, attemptSetDigest: attemptSetDigestOf(p) });

/** T0 Init: the record does not exist yet. Creates it CLOSED (nothing admits until an activation). */
export async function initAdmission(store: VerifiedStore, p: string): Promise<"created" | "exists"> {
  if (!validToken(p)) throw new PublicationRefused("invalid_token");
  const initMark = publisherMark(p, "T0", "-", "-", "-");
  return transition<"created" | "exists">(store, "T0", (cur) => {
    if (cur) return { done: "exists" };
    const rec: Admission = { v: 3, epoch: 0, activationId: null, deployId: null, state: "closed", g5Digest: null, g5: null, activatedAt: null, activationMark: null, initMark, tickets: {}, publication: null };
    return { write: rec, result: "created" };
  }, (cur) => (cur && cur.initMark === initMark ? "created" : null));
}

/** T1 Close: open (or never-activated closed) with no publication -> closed; admitted tickets revoked; dispatching and uncertain kept. */
export async function closeAdmission(store: VerifiedStore, p: string, pubId: string, targetDeployId: string): Promise<Publication> {
  if (!validToken(p) || !validId(pubId) || !validDeployId(targetDeployId)) throw new PublicationRefused("invalid_request");
  const closeMark = publisherMark(p, "T1", "-", pubId, targetDeployId);
  return transition<Publication>(store, "T1", (cur) => {
    if (!cur) return { refuse: new PublicationRefused("not_initialized") };
    if (cur.publication) {
      if (cur.publication.pubId === pubId && cur.publication.closeMark === closeMark) return { done: cur.publication };
      return { refuse: new PublicationRefused("publication_in_progress", "Another publication cycle holds admission; no takeover") };
    }
    const tickets: Record<string, Ticket> = {};
    for (const t of Object.values(cur.tickets)) if (t.state !== "admitted") tickets[t.ticketId] = t;
    const publication = withDigest({ pubId, targetDeployId, publisherHash: publisherHashOf(p), closeMark, closedAt: new Date().toISOString(), phase: "closed", outstanding: null, history: [], attemptSetDigest: "", handoverMarks: [] });
    return { write: { ...cur, state: "closed", tickets, publication }, result: publication };
  }, (cur) => (cur?.publication?.pubId === pubId && cur.publication.closeMark === closeMark ? cur.publication : null));
}

const requirePublisher = (cur: Admission | null, p: string): Publication | Error => {
  if (!cur || !cur.publication) return new PublicationRefused("no_publication");
  if (cur.state !== "closed") return new PublicationRefused("not_closed");
  if (cur.publication.publisherHash !== publisherHashOf(p)) return new PublicationRefused("not_publisher", "This process is not the cycle's publisher (handover required)");
  return cur.publication;
};

/** T2 Claim: closed, our publisher, NO outstanding attempt, phase "closed". */
export async function claimAttempt(store: VerifiedStore, p: string, attemptId: string): Promise<OutstandingAttempt> {
  if (!validToken(p) || !validId(attemptId)) throw new PublicationRefused("invalid_request");
  return transition<OutstandingAttempt>(store, "T2", (cur) => {
    const pub = requirePublisher(cur, p);
    if (pub instanceof Error) return { refuse: pub };
    const claimMark = publisherMark(p, "T2", attemptId, pub.pubId, pub.targetDeployId);
    if (pub.outstanding?.attemptId === attemptId && pub.outstanding.claimMark === claimMark) return { done: pub.outstanding };
    if (pub.outstanding) return { refuse: new PublicationRefused("attempt_outstanding", "An earlier publication attempt is not terminal") };
    if (pub.phase !== "closed") return { refuse: new PublicationRefused("already_applied") };
    if (pub.history.some((h) => h.attemptId === attemptId)) return { refuse: new PublicationRefused("attempt_id_reused") };
    const outstanding: OutstandingAttempt = { attemptId, claimantHash: publisherHashOf(p), claimMark, state: "claimed", at: new Date().toISOString() };
    return { write: { ...cur!, publication: withDigest({ ...pub, outstanding }) }, result: outstanding };
  }, (cur) => {
    const o = cur?.publication?.outstanding;
    return o && o.attemptId === attemptId && o.claimMark === publisherMark(p, "T2", attemptId, cur!.publication!.pubId, cur!.publication!.targetDeployId) ? o : null;
  });
}

export function requestFingerprint(pubId: string, attemptId: string, method: string, path: string): string { return digest(canonical({ pubId, attemptId, method, path })); }
/** The ONE request this attempt may send: restore of the cycle's target deploy. */
export const restorePath = (siteId: string, deployId: string) => `/api/v1/sites/${siteId}/deploys/${deployId}/restore`;

/** T3 Dispatching: our claimed attempt -> dispatching. A read showing `claimed` means nothing may be sent. */
export async function markAttemptDispatching(store: VerifiedStore, p: string, attemptId: string, siteId: string): Promise<OutstandingAttempt> {
  if (!validToken(p) || !validId(attemptId) || !/^[0-9a-f-]{36}$/.test(siteId)) throw new PublicationRefused("invalid_request");
  return transition<OutstandingAttempt>(store, "T3", (cur) => {
    const pub = requirePublisher(cur, p);
    if (pub instanceof Error) return { refuse: pub };
    const o = pub.outstanding;
    const dispatchMark = publisherMark(p, "T3", attemptId, pub.pubId, pub.targetDeployId);
    if (o && o.attemptId === attemptId && o.dispatchMark === dispatchMark) return { refuse: new PublicationRefused("already_dispatching", "This attempt was already marked dispatching; it is never sent twice") };
    if (!o || o.attemptId !== attemptId || o.state !== "claimed" || o.claimMark !== publisherMark(p, "T2", attemptId, pub.pubId, pub.targetDeployId)) return { refuse: new PublicationRefused("not_claimed") };
    const path = restorePath(siteId, pub.targetDeployId);
    const request = { method: "POST", path, targetDeployId: pub.targetDeployId, sentAt: new Date().toISOString(), fingerprint: requestFingerprint(pub.pubId, attemptId, "POST", path) };
    const next: OutstandingAttempt = { ...o, state: "dispatching", dispatchMark, request };
    return { write: { ...cur!, publication: withDigest({ ...pub, outstanding: next }) }, result: next };
  }, (cur) => {
    const o = cur?.publication?.outstanding;
    return o && o.attemptId === attemptId && o.state === "dispatching" && o.dispatchMark === publisherMark(p, "T3", attemptId, cur!.publication!.pubId, cur!.publication!.targetDeployId) ? o : null;
  });
}

// ── Classifier (r4 §C) ──────────────────────────────────────────────────────
export type BodyCondition = { field: string; op: "equals_target" | "equals" | "present" | "absent"; value?: string };
export type SemanticsPredicate = { id: string; classifies: "APPLIED" | "REJECTED"; status: number; contentType?: string; body: BodyCondition[]; citation: string };
export type SemanticsRecord = { v: 1; ref: string; endpoint: "restoreSiteDeploy"; predicates: SemanticsPredicate[]; approvals: { bones: string; jess: string }; createdAt: string };
/** Persisted response fields needed for later classification (Bones's final review). */
export const EVIDENCE_FIELDS = ["id", "site_id", "state", "published_at", "deploy_id", "code", "message", "error", "error_message", "context", "branch", "commit_ref", "locked"] as const;

export type Classification = { cls: "APPLIED" | "REJECTED"; predicateId: string } | { cls: "RESPONDED" } | { cls: "UNRESOLVED"; reason: string };

/** The raw response the operator tool received, reduced to persisted evidence bound to (publication, attempt, request, transition). */
export function buildEvidence(pub: Publication, o: OutstandingAttempt, response: { status: number; contentType: string | null; body: string }): ResponseEvidence {
  let parsed: any = null; let bodyJson = false;
  try { parsed = JSON.parse(response.body); bodyJson = !!parsed && typeof parsed === "object" && !Array.isArray(parsed); } catch { bodyJson = false; }
  const fields: Record<string, string | null> = {};
  for (const f of EVIDENCE_FIELDS) {
    const v = bodyJson ? parsed[f] : undefined;
    fields[f] = v === undefined || v === null ? null : typeof v === "string" ? v.slice(0, 200) : typeof v === "number" || typeof v === "boolean" ? String(v) : "[structured]";
  }
  const base = {
    pubId: pub.pubId, attemptId: o.attemptId, requestFingerprint: o.request!.fingerprint, transition: "T4" as const,
    status: Math.trunc(response.status), contentType: response.contentType ? response.contentType.slice(0, 100) : null,
    bodyDigest: digest(response.body), bodyJson, fields, receivedAt: new Date().toISOString(),
  };
  return { ...base, evidenceDigest: digest(canonical(base)) };
}
const evidenceIntact = (e: ResponseEvidence) => { const { evidenceDigest, ...base } = e; return digest(canonical(base)) === evidenceDigest; };

/**
 * The ONE classifier. Default deny: without an approved semantics record every
 * response is RESPONDED or UNRESOLVED. A predicate must match status, content
 * type and EVERY body condition of the exact persisted evidence.
 */
export function classify(e: ResponseEvidence | undefined, target: string, semantics: SemanticsRecord[]): Classification {
  if (!e || !evidenceIntact(e)) return { cls: "UNRESOLVED", reason: "no_persisted_evidence" };
  if (e.status === 429 || e.status >= 500 || e.status < 100) return { cls: "UNRESOLVED", reason: "status" };
  if (!e.bodyJson) return { cls: "UNRESOLVED", reason: "malformed_body" };
  if (e.fields.id !== null && e.fields.id !== target) return { cls: "UNRESOLVED", reason: "other_deploy" };
  for (const s of semantics) {
    if (!validSemantics(s)) continue;
    for (const p of s.predicates) {
      if (p.status !== e.status) continue;
      if (p.contentType !== undefined && (e.contentType ?? "").split(";")[0].trim() !== p.contentType) continue;
      const bodyOk = p.body.length > 0 && p.body.every((c) => {
        const v = e.fields[c.field];
        if (c.op === "equals_target") return v === target;
        if (c.op === "equals") return v === c.value;
        if (c.op === "present") return v !== null && v !== undefined;
        if (c.op === "absent") return v === null || v === undefined;
        return false;
      });
      if (bodyOk) return { cls: p.classifies, predicateId: `${s.ref}#${p.id}` };
    }
  }
  return { cls: "RESPONDED" };
}
export function validSemantics(s: any): s is SemanticsRecord {
  return !!s && s.v === 1 && typeof s.ref === "string" && s.endpoint === "restoreSiteDeploy" && Array.isArray(s.predicates) && s.predicates.length > 0 &&
    typeof s.approvals?.bones === "string" && s.approvals.bones.length >= 8 && typeof s.approvals?.jess === "string" && s.approvals.jess.length >= 8 &&
    s.predicates.every((p: any) => typeof p?.id === "string" && (p.classifies === "APPLIED" || p.classifies === "REJECTED") && Number.isInteger(p.status) &&
      typeof p.citation === "string" && p.citation.length >= 8 && Array.isArray(p.body) && p.body.length > 0 &&
      p.body.every((c: any) => (EVIDENCE_FIELDS as readonly string[]).includes(c?.field) && ["equals_target", "equals", "present", "absent"].includes(c?.op)) &&
      (p.classifies !== "APPLIED" || p.body.some((c: any) => c.field === "id" && c.op === "equals_target")));
}
/** Reads every approved semantics record (immutable; created only by the separately authorized step). */
export async function readSemantics(store: VerifiedStore): Promise<SemanticsRecord[]> {
  const out: SemanticsRecord[] = [];
  for (let n = 1; n <= 20; n++) {
    const s = await store.readData<SemanticsRecord>(SEMANTICS_PREFIX + n, "publication");
    if (!s) break;
    if (validSemantics(s)) out.push(s);
  }
  return out;
}
/** Registers an approved semantics record (separately authorized; immutable, onlyIfNew). */
export async function registerSemantics(store: VerifiedStore, n: number, record: SemanticsRecord): Promise<void> {
  if (!Number.isInteger(n) || n < 1 || n > 20 || !validSemantics(record)) throw new PublicationRefused("invalid_semantics");
  await store.writeOnceVerified(SEMANTICS_PREFIX + n, record, (g) => canonical(g) === canonical(record), "publication");
}

const terminalEntry = (p: string, pub: Publication, o: OutstandingAttempt, terminal: HistoryEntry["terminal"], semanticsRef: string | null): HistoryEntry => ({
  attemptId: o.attemptId, terminal, evidenceDigest: o.evidence?.evidenceDigest ?? null, semanticsRef, requestFingerprint: o.request?.fingerprint ?? null,
  at: new Date().toISOString(), mark: publisherMark(p, "terminal:" + terminal, o.attemptId, pub.pubId, pub.targetDeployId),
});
/** Applies a terminal classification: history entry + outstanding=null in the SAME write (I2). */
function settleTerminal(pub: Publication, entry: HistoryEntry): Publication {
  return withDigest({ ...pub, outstanding: null, history: [...pub.history, entry], phase: entry.terminal === "APPLIED" ? "applied" : pub.phase });
}

/**
 * T4 Record response. Precondition: our dispatching attempt with OUR dispatchMark
 * (the current publisherHash is NOT required, so the original sender can record
 * after a handover). Evidence is persisted and classified in the SAME write.
 */
export async function recordResponse(store: VerifiedStore, p: string, attemptId: string, response: { status: number; contentType: string | null; body: string }): Promise<Classification> {
  if (!validToken(p) || !validId(attemptId) || !Number.isInteger(response?.status) || typeof response.body !== "string" || response.body.length > 100_000) throw new PublicationRefused("invalid_request");
  const semantics = await readSemantics(store);
  let computed: { evidence: ResponseEvidence; c: Classification } | null = null;
  return transition<Classification>(store, "T4", (cur) => {
    const pub = cur?.publication;
    if (!cur || !pub) return { refuse: new PublicationRefused("no_publication") };
    const o = pub.outstanding;
    const dispatchMark = publisherMark(p, "T3", attemptId, pub.pubId, pub.targetDeployId);
    const done = pub.history.find((h) => h.attemptId === attemptId);
    if (done && computed && done.evidenceDigest === computed.evidence.evidenceDigest) return { done: computed.c };
    if (o && o.attemptId === attemptId && o.evidence && computed && o.evidence.evidenceDigest === computed.evidence.evidenceDigest) return { done: computed.c };
    if (!o || o.attemptId !== attemptId || o.state !== "dispatching" || o.dispatchMark !== dispatchMark) return { refuse: new PublicationRefused("not_dispatching") };
    if (!computed) { const evidence = buildEvidence(pub, o, response); computed = { evidence, c: classify(evidence, pub.targetDeployId, semantics) }; }
    const withEvidence: OutstandingAttempt = { ...o, evidence: computed.evidence };
    const c = computed.c;
    if (c.cls === "APPLIED" || c.cls === "REJECTED") {
      return { write: { ...cur, publication: settleTerminal(pub, terminalEntry(p, pub, withEvidence, c.cls, c.predicateId)) }, result: c };
    }
    const state = c.cls === "UNRESOLVED" ? "unresolved" : "responded";
    return { write: { ...cur, publication: withDigest({ ...pub, outstanding: { ...withEvidence, state, ...(c.cls === "UNRESOLVED" ? { reason: c.reason } : {}) } }) }, result: c };
  }, (cur) => {
    const pub = cur?.publication;
    if (!pub || !computed) return null;
    const d = computed.evidence.evidenceDigest;
    if (pub.outstanding?.attemptId === attemptId && pub.outstanding.evidence?.evidenceDigest === d) return computed.c;
    if (pub.history.some((h) => h.attemptId === attemptId && h.evidenceDigest === d)) return computed.c;
    return null;   // still `dispatching`: blocks
  });
}

/** T5 Mark unresolved: our dispatching attempt received no response (timeout, transport error, abort). Not applying it is equivalent. */
export async function markAttemptUnresolved(store: VerifiedStore, p: string, attemptId: string, reason: "timeout" | "transport" | "abort"): Promise<void> {
  if (!validToken(p) || !validId(attemptId)) throw new PublicationRefused("invalid_request");
  await transition<true>(store, "T5", (cur) => {
    const pub = cur?.publication;
    if (!cur || !pub) return { refuse: new PublicationRefused("no_publication") };
    const o = pub.outstanding;
    const unresolvedMark = publisherMark(p, "T5", attemptId, pub.pubId, pub.targetDeployId);
    if (o && o.attemptId === attemptId && o.unresolvedMark === unresolvedMark) return { done: true };
    if (!o || o.attemptId !== attemptId || o.state !== "dispatching" || o.dispatchMark !== publisherMark(p, "T3", attemptId, pub.pubId, pub.targetDeployId)) return { refuse: new PublicationRefused("not_dispatching") };
    return { write: { ...cur, publication: withDigest({ ...pub, outstanding: { ...o, state: "unresolved", unresolvedMark, reason } }) }, result: true };
  }, (cur) => (cur?.publication?.outstanding?.unresolvedMark === publisherMark(p, "T5", attemptId, cur!.publication!.pubId, cur!.publication!.targetDeployId) ? true : null));
}

/** T6 Abandon: outstanding `claimed` (provably never sent) -> ABANDONED, by the current publisher. */
export async function abandonAttempt(store: VerifiedStore, p: string, attemptId: string): Promise<void> {
  if (!validToken(p) || !validId(attemptId)) throw new PublicationRefused("invalid_request");
  await transition<true>(store, "T6", (cur) => {
    const pub = requirePublisher(cur, p);
    if (pub instanceof Error) return { refuse: pub };
    if (pub.history.some((h) => h.attemptId === attemptId && h.terminal === "ABANDONED")) return { done: true };
    const o = pub.outstanding;
    if (!o || o.attemptId !== attemptId || o.state !== "claimed") return { refuse: new PublicationRefused("not_claimed", "Only a claimed (never dispatched) attempt can be abandoned") };
    return { write: { ...cur!, publication: settleTerminal(pub, terminalEntry(p, pub, o, "ABANDONED", null)) }, result: true };
  }, (cur) => (cur?.publication?.history.some((h) => h.attemptId === attemptId && h.terminal === "ABANDONED") ? true : null));
}

/** T7 Handover (publisher restart): closed; outstanding null or `claimed` (abandoned in the same write). A dispatching attempt blocks handover. */
export async function handoverPublisher(store: VerifiedStore, newP: string): Promise<void> {
  if (!validToken(newP)) throw new PublicationRefused("invalid_request");
  const newHash = publisherHashOf(newP);
  await transition<true>(store, "T7", (cur) => {
    const pub = cur?.publication;
    if (!cur || !pub || cur.state !== "closed") return { refuse: new PublicationRefused("no_publication") };
    if (pub.publisherHash === newHash) return { done: true };
    const o = pub.outstanding;
    /* Bones review finding 3: a new process may take over a cycle whose attempt is `claimed` (abandoned
       in this same write: provably never sent) or `responded` (its response is ALREADY persisted; it can
       never be dispatched again, because T3 requires `claimed`). The responded attempt is kept exactly
       as it is, so the new publisher can reclassify that stored evidence (T8) once approved semantics
       exist. `dispatching` and `unresolved` stay non-transferable: the sender may still be live, or the
       outcome is unknown. */
    if (o && o.state !== "claimed" && !(o.state === "responded" && o.evidence)) return { refuse: new PublicationRefused("attempt_outstanding", "A dispatched publication attempt with no recorded response is not terminal; handover cannot take it over") };
    const handoverMark = publisherMark(newP, "T7", o?.attemptId ?? "-", pub.pubId, pub.targetDeployId);
    let next: Publication = { ...pub, publisherHash: newHash, handoverMarks: [...pub.handoverMarks, handoverMark] };
    if (o && o.state === "claimed") next = settleTerminal(next, terminalEntry(newP, next, o, "ABANDONED", null));
    return { write: { ...cur, publication: withDigest(next) }, result: true };
  }, (cur) => (cur?.publication?.publisherHash === newHash ? true : null));
}

/** T8 Reclassify: a RESPONDED attempt with persisted evidence, under an approved semantics record that classifies EXACTLY that evidence. */
export async function reclassifyAttempt(store: VerifiedStore, p: string, attemptId: string): Promise<Classification> {
  if (!validToken(p) || !validId(attemptId)) throw new PublicationRefused("invalid_request");
  const semantics = await readSemantics(store);
  return transition<Classification>(store, "T8", (cur) => {
    const pub = requirePublisher(cur, p);
    if (pub instanceof Error) return { refuse: pub };
    const o = pub.outstanding;
    if (!o || o.attemptId !== attemptId || o.state !== "responded" || !o.evidence) return { refuse: new PublicationRefused("not_responded", "Only a RESPONDED attempt with persisted evidence can be reclassified; UNRESOLVED never becomes terminal") };
    const c = classify(o.evidence, pub.targetDeployId, semantics);
    if (c.cls !== "APPLIED" && c.cls !== "REJECTED") return { refuse: new PublicationRefused("no_matching_semantics") };
    return { write: { ...cur!, publication: settleTerminal(pub, terminalEntry(p, pub, o, c.cls, c.predicateId)) }, result: c };
  }, (cur) => {
    const h = cur?.publication?.history.find((x) => x.attemptId === attemptId && (x.terminal === "APPLIED" || x.terminal === "REJECTED"));
    return h ? { cls: h.terminal as "APPLIED" | "REJECTED", predicateId: h.semanticsRef ?? "" } : null;
  });
}

/**
 * T9 Activate (on the TARGET deployment, through the site URL). Requires closed,
 * NO outstanding attempt, phase "applied", the last APPLIED entry naming the
 * target, a matching attemptSetDigest, runtime deploy id === target, and the
 * caller's verified prerequisites (attestations, import, G5, revocation). Opens a
 * new epoch with a new activationId. Tickets carry over untouched.
 */
export async function activate(store: VerifiedStore, scope: InvocationScope, input: { p: string; runtimeDeployId: string; attemptSetDigest: string; g5Table: G5Table; activationId: string }): Promise<Admission> {
  const { p, runtimeDeployId } = input;
  if (!validToken(p) || !validId(input.activationId) || !validTable(input.g5Table)) throw new PublicationRefused("invalid_request");
  const activationMark = publisherMark(p, "T9", input.activationId, "-", runtimeDeployId);
  return transition<Admission>(store, "T9", (cur) => {
    if (cur && cur.state === "open" && cur.activationId === input.activationId && cur.activationMark === activationMark) return { done: cur };
    const pub = requirePublisher(cur, p);
    if (pub instanceof Error) return { refuse: pub };
    if (pub.outstanding) return { refuse: new PublicationRefused("attempt_outstanding", "A publication attempt is not terminal") };
    if (pub.phase !== "applied") return { refuse: new PublicationRefused("not_applied", "No publication attempt is terminally APPLIED") };
    const lastApplied = [...pub.history].reverse().find((h) => h.terminal === "APPLIED");
    if (!lastApplied || pub.targetDeployId !== runtimeDeployId) return { refuse: new PublicationRefused("wrong_deploy", "This deployment is not the publication's target") };
    if (pub.attemptSetDigest !== input.attemptSetDigest || attemptSetDigestOf(pub) !== pub.attemptSetDigest) return { refuse: new PublicationRefused("attempt_set_changed") };
    /* Widenings applied to the effective table while this cycle was closed are carried forward: the new
       effective table is the approved staged table PLUS every widened entry already in force. */
    const carried = (cur!.g5?.entries ?? []).filter((e) => e.basis === "widened" && !input.g5Table.entries.some((x) => x.pathId === e.pathId && x.scope === e.scope && JSON.stringify(x.effects) === JSON.stringify(e.effects)));
    const g5: G5Table = carried.length ? { ...input.g5Table, entries: [...input.g5Table.entries, ...carried] } : input.g5Table;
    const next: Admission = { ...cur!, state: "open", epoch: cur!.epoch + 1, activationId: input.activationId, deployId: runtimeDeployId, g5Digest: tableDigest(g5), g5, activatedAt: new Date().toISOString(), activationMark, publication: null };
    return { write: next, result: next };
  }, (cur) => (cur && cur.state === "open" && cur.activationId === input.activationId && cur.activationMark === activationMark ? cur : null));
}

/**
 * Widening the EFFECTIVE G5 table (Bones review finding 1): ONE compare-and-swap on this record adds the
 * block and REVOKES every `admitted` ticket it now covers (as Close does: those senders' Dispatching
 * write then fails, so they provably never send). A `dispatching` or `uncertain` ticket already passed
 * the admission point: it is kept, and it keeps blocking overlapping work. Idempotent for an identical
 * entry. No admission record yet: nothing is in force to widen (the staged table carries it into the
 * first activation).
 */
export async function widenEffectiveG5(store: VerifiedStore, entry: { pathId: string; scope: string; effects: string[]; ref?: string }): Promise<{ widened: boolean; revoked: number }> {
  const same = (e: { pathId: string; scope: string; effects: string[] }) => e.pathId === entry.pathId && e.scope === entry.scope && JSON.stringify([...e.effects].sort()) === JSON.stringify([...entry.effects].sort());
  let revoked = 0;
  return transition<{ widened: boolean; revoked: number }>(store, "G5W", (cur) => {
    if (!cur) return { done: { widened: false, revoked: 0 } };
    const base = cur.g5 ?? { v: 1 as const, entries: [], narrowings: [], updatedAt: new Date().toISOString() };
    if (base.entries.some(same)) return { done: { widened: true, revoked: 0 } };
    const g5 = widenTable(base, entry);
    const tickets: Record<string, Ticket> = {};
    revoked = 0;
    for (const t of Object.values(cur.tickets)) {
      if (t.state === "admitted" && !allows({ ...g5, entries: [g5.entries[g5.entries.length - 1]] }, t.subject, t.effects).ok) { revoked++; continue; }
      tickets[t.ticketId] = t;
    }
    return { write: { ...cur, g5, tickets }, result: { widened: true, revoked } };
  }, (cur) => (cur?.g5?.entries.some(same) ? { widened: true, revoked } : null));
}

/** I4: archives are written AFTER the authoritative write and never read for authorization. Failure is harmless. */
export async function archive(store: VerifiedStore, key: string, value: unknown): Promise<boolean> {
  try { await store.createOnce(key, value, "publication"); return true; } catch { return false; }
}

/** The public status summary (no marks, no hashes). */
export function admissionSummary(a: Admission | null) {
  if (!a) return { initialized: false as const };
  const pub = a.publication;
  return {
    initialized: true as const, state: a.state, epoch: a.epoch, activationId: a.activationId, deployId: a.deployId,
    tickets: { admitted: Object.values(a.tickets).filter((t) => t.state === "admitted").length, dispatching: Object.values(a.tickets).filter((t) => t.state === "dispatching").length, uncertain: Object.values(a.tickets).filter((t) => t.state === "uncertain").length },
    publication: pub ? {
      pubId: pub.pubId, targetDeployId: pub.targetDeployId, phase: pub.phase, attemptSetDigest: pub.attemptSetDigest,
      outstanding: pub.outstanding ? { attemptId: pub.outstanding.attemptId, state: pub.outstanding.state, status: pub.outstanding.evidence?.status ?? null } : null,
      history: pub.history.map((h) => ({ attemptId: h.attemptId, terminal: h.terminal, semanticsRef: h.semanticsRef })),
    } : null,
  };
}
