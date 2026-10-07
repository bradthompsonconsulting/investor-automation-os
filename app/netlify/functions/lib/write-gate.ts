/**
 * Storage correction (plan v6 §5, §8.1 M4; amendments r1–r4) -- THE WRITE GATE.
 *
 * Every v2 GHL write and ownership mutation requires, in order:
 *   (i)   context.deploy.context === "production" AND context.deploy.published === true
 *         (deploy previews, unpublished permalinks and branch deploys are refused
 *         with 403 before any storage or GHL I/O, whatever the credentials);
 *   (ii)  admission OPEN for THIS exact deployment, captured once at handler
 *         entry (epoch + activationId), and the client's echoed activationId;
 *         a valid cutover record bound to the import owner;
 *   (iii) IAOS_V2_WRITES not "off" -- a kill switch only, it can never enable;
 *   (iv)  the G5 table (whose digest must equal the one recorded at activation)
 *         allows this subject and effect classes;
 *   (v)   no authz/legacy-block for the subject.
 * Any failure -> refusal with no further I/O. Then, per GHL mutation, the
 * admission ticket: Admit -> (claim) -> Dispatching -> one request -> settle.
 */
import { clock, InvocationScope } from "./invocation-scope";
import { VerifiedStore } from "./verified-store";
import { diag } from "./diagnostics";
import {
  admit, captureActivation, markDispatching, markUncertain, removeWithOutcome, withdrawAdmitted, readAdmission,
  AdmissionClosed, ActivationChanged, TicketOverlap, TransitionUnresolved, type Captured, type HeldTicket,
} from "./admission";
import { allows, readG5Table, tableDigest } from "./g5-gate";
import { cutoverValid, legacyBlockKey, type LegacyBlock } from "./cutover";
import { consumeForDispatch, type OwnedSend } from "./owned-send";

export type DeployContext = { id: string | null; context: string | null; published: boolean | null };
/** Reads the runtime deploy context from the modern-runtime `context` argument. Missing or mistyped -> nulls (fail closed). */
export function deployContextOf(context: any): DeployContext {
  const d = context?.deploy;
  return {
    id: typeof d?.id === "string" && d.id ? d.id : null,
    context: typeof d?.context === "string" ? d.context : null,
    published: typeof d?.published === "boolean" ? d.published : null,
  };
}

export type Refusal = { status: number; body: Record<string, unknown> };
export class WriteRefused extends Error {
  constructor(readonly refusal: Refusal, readonly cls: string) { super(String(refusal.body.error ?? "Write refused")); this.name = "WriteRefused"; }
}
export const PREVIEW_REFUSAL: Refusal = { status: 403, body: { error: "Writes are refused on this deployment" } };
export const ACTIVATION_CHANGED: Refusal = { status: 409, body: { code: "activation_changed", error: "This page is out of date — reload" } };
const paused = (code: string, message: string): Refusal => ({ status: 503, body: { code, error: message } });
export const MESSAGES = {
  g5_blocked: "Saving is held while earlier save records are reviewed",
  legacy_blocked: "Saving is held for this record: an earlier save (from a previous version of IAOS) is unresolved",
  publication_unresolved: "Saving is paused: a publication result is unknown",
  admission_closed: "Saving is paused while this deployment is being published",
  activation_missing: "Saving is not enabled on this deployment",
  cutover_pending: "Saving is not enabled yet: the storage cutover has not completed",
  kill_switch: "Saving is turned off",
  storage: "Saving is unavailable: the save records could not be read",
} as const;

/** (i) Synchronous, before any I/O. */
export function requireWritableDeployment(d: DeployContext): void {
  if (d.context !== "production" || d.published !== true || !d.id) throw new WriteRefused(PREVIEW_REFUSAL, "preview_refused");
}
/** (iii) The kill switch can only refuse. */
export function requireNotKilled(env: Record<string, string | undefined> = process.env): void {
  if ((env.IAOS_V2_WRITES ?? "").trim().toLowerCase() === "off") throw new WriteRefused(paused("kill_switch", MESSAGES.kill_switch), "cutover_pending");
}

export type MutationDescriptor = { subject: string; effects: string[]; requestId: string; opId: string; attemptId: string };
export type Permit = { held: HeldTicket; sent: boolean; settled: boolean };

/**
 * The per-invocation gate. `enter` runs (i)–(iii) once at handler entry;
 * `checkSubject` runs (iv)–(v); the MutationGate methods run the ticket protocol
 * around each GHL mutation.
 */
export class WriteGate {
  captured: Captured | null = null;
  constructor(readonly scope: InvocationScope, readonly store: VerifiedStore, readonly deploy: DeployContext, readonly env: string, readonly locationId: string) {}

  /**
   * (i)–(iii) plus the cutover. Captures the activation identity. Browser
   * callers must echo the page's activationId (`echo`); only the server-to-server
   * webhook passes `null` (it has no page).
   */
  async enter(echo: { activationId: string | null } | null): Promise<Captured> {
    requireWritableDeployment(this.deploy);
    requireNotKilled();
    if (echo && !echo.activationId) throw new WriteRefused(ACTIVATION_CHANGED, "activation_changed");
    const clientActivationId = echo ? echo.activationId! : undefined;
    let captured: Captured; let cutover;
    try {
      [captured, cutover] = await Promise.all([captureActivation(this.store, this.deploy.id!, clientActivationId), cutoverValid(this.store)]);
    } catch (e) {
      if (e instanceof ActivationChanged) { diag({ fn: this.scope.fn, action: "enter", phase: "activation", class: "activation_changed" }); throw new WriteRefused(ACTIVATION_CHANGED, "activation_changed"); }
      if (e instanceof AdmissionClosed) { diag({ fn: this.scope.fn, action: "enter", phase: "activation", class: e.code === "activation_missing" ? "activation_missing" : e.code === "publication_unresolved" ? "publication_unresolved" : "admission_closed" }); throw new WriteRefused(paused(e.code, MESSAGES[e.code]), e.code); }
      throw new WriteRefused(paused("storage", MESSAGES.storage), "unexpected");
    }
    if (!cutover) { diag({ fn: this.scope.fn, action: "enter", phase: "cutover_gate", class: "cutover_pending" }); throw new WriteRefused(paused("cutover_pending", MESSAGES.cutover_pending), "cutover_pending"); }
    this.captured = captured;
    return captured;
  }

  /** (iv)–(v) for one subject and its effect classes. */
  async checkSubject(subject: string, effects: string[]): Promise<void> {
    if (!this.captured) throw new WriteRefused(paused("activation_missing", MESSAGES.activation_missing), "activation_missing");
    let table, block: LegacyBlock | null;
    try { [table, block] = await Promise.all([readG5Table(this.store), this.store.readData<LegacyBlock>(legacyBlockKey(this.env, this.locationId, subject), "g5_gate")]); }
    catch { throw new WriteRefused(paused("storage", MESSAGES.storage), "unexpected"); }
    if (!table || this.captured.g5Digest === null || tableDigest(table.table) !== this.captured.g5Digest || !allows(table.table, subject, effects).ok) {
      diag({ fn: this.scope.fn, action: "check", phase: "g5_gate", class: "g5_blocked" });
      throw new WriteRefused(paused("g5_blocked", MESSAGES.g5_blocked), "g5_blocked");
    }
    if (block) { diag({ fn: this.scope.fn, action: "check", phase: "g5_gate", class: "legacy_blocked" }); throw new WriteRefused(paused("legacy_blocked", MESSAGES.legacy_blocked), "legacy_blocked"); }
  }

  // ── MutationGate (used by GhlBoundary for every non-GET request) ──
  async admit(m: MutationDescriptor): Promise<Permit> {
    await this.checkSubject(m.subject, m.effects);
    try {
      const held = await admit(this.store, this.scope, this.captured!, { opId: m.opId, attemptId: m.attemptId, requestId: m.requestId, subject: m.subject, effects: m.effects });
      return { held, sent: false, settled: false };
    } catch (e) {
      if (e instanceof ActivationChanged) throw new WriteRefused(ACTIVATION_CHANGED, "activation_changed");
      if (e instanceof AdmissionClosed) throw new WriteRefused(paused(e.code, MESSAGES[e.code]), e.code);
      if (e instanceof TicketOverlap) throw new WriteRefused({ status: 409, body: { code: "in_progress", error: "Another save for this record is in progress or unresolved. Nothing was sent." } }, "ticket_overlap");
      throw new WriteRefused(paused("storage", MESSAGES.storage), "unexpected");
    }
  }
  async dispatching(p: Permit): Promise<void> {
    try { await markDispatching(this.store, p.held); }
    catch (e) {
      if (e instanceof ActivationChanged) throw new WriteRefused(ACTIVATION_CHANGED, "activation_changed");
      if (e instanceof AdmissionClosed) throw new WriteRefused(paused("admission_closed", MESSAGES.admission_closed), "admission_closed");
      throw new WriteRefused(paused("storage", MESSAGES.storage), e instanceof TransitionUnresolved ? "ack_ambiguous" : "unexpected");
    }
  }
  /**
   * The synchronous checks immediately before the ONE request: scope open,
   * now <= T_dispatch, the OwnedSend (if any) consumed under the latch. Then
   * `onDispatch` (marks "possibly sent") and the request, with
   * AbortSignal.timeout(GHL_TIMEOUT).
   */
  async send<T>(p: Permit, owned: OwnedSend | null, onDispatch: () => void, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (p.held.ticket.state !== "dispatching") throw new WriteRefused(paused("admission_closed", MESSAGES.admission_closed), "admission_closed");
    this.scope.assertMayDispatch();
    if (owned) consumeForDispatch(owned);
    const timeout = this.scope.deadlines.ghlTimeout ?? 10_000;
    const signal = AbortSignal.any([this.scope.signal, AbortSignal.timeout(timeout)]);
    onDispatch();
    p.sent = true;
    return request(signal);
  }
  async settle(p: Permit, outcome: "confirmed" | "uncertain" | "not_sent"): Promise<void> {
    if (p.settled) return;
    p.settled = true;
    this.scope.enterCleanup();
    if (outcome === "uncertain" || (outcome === "not_sent" && p.sent)) { await markUncertain(this.store, p.held); return; }
    if (outcome === "confirmed") { await removeWithOutcome(this.store, p.held, "confirmed"); return; }
    // not sent: an admitted ticket is withdrawn; a dispatching one (the request never left) is recorded not_dispatched.
    if (p.held.ticket.state === "admitted") {
      if (await withdrawAdmitted(this.store, p.held)) return;
      if (p.held.pendingDispatch) { p.held.ticket = p.held.pendingDispatch; await removeWithOutcome(this.store, p.held, "not_dispatched"); }
      return;
    }
    await removeWithOutcome(this.store, p.held, "not_dispatched");
  }
}

/** For status reads: the current activation id the page echoes on writes (or null). */
export async function currentActivationId(store: VerifiedStore, deployId: string | null): Promise<string | null> {
  try {
    const r = await readAdmission(store);
    if (!r || r.data.state !== "open" || r.data.deployId !== deployId) return null;
    return r.data.activationId;
  } catch { return null; }
}
export const nowIso = () => new Date(clock.now()).toISOString();
