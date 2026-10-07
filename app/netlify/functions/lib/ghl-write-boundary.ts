import { getConfig, UNDER_CONTRACT_STAGE_NOT_PROVISIONED } from "../../../shared/ghl-config";
import type { FieldWrite } from "./write-contracts";
import { digest } from "./hash";
import { ghlToken } from "./ghl-token";
import { fieldEffects } from "./g5-gate";
import type { MutationDescriptor, Permit } from "./write-gate";
import type { OwnedSend } from "./owned-send";
import type { InvocationScope } from "./invocation-scope";
export { digest };
export class WriteUncertain extends Error {}
/**
 * Storage correction (plan v6 §3, §10.1; amendments r1–r4) -- EVERY GHL mutation
 * passes through a MutationGate: G5 + legacy-block check and Admit (ticket),
 * then the barrier's send claim (an OwnedSend, if the request is
 * barrier-owned), then Dispatching (the admission point), then ONE request with
 * the synchronous scope / T_dispatch / latch checks, then settle. A boundary
 * built without a gate refuses every non-GET request before any I/O.
 *
 * `beforeDispatch` claims ownership of the send and may return the OwnedSend;
 * `state.dispatched` is set synchronously right before the request is issued,
 * so a call that throws part-way is always treated as possibly sent.
 */
export type DispatchHooks = { beforeDispatch: () => Promise<OwnedSend | null | void>; state: { dispatched: boolean; owned?: OwnedSend | null } };
export interface MutationGate {
  admit(m: MutationDescriptor): Promise<Permit>;
  dispatching(p: Permit): Promise<void>;
  send<T>(p: Permit, owned: OwnedSend | null, onDispatch: () => void, request: (signal: AbortSignal) => Promise<T>): Promise<T>;
  settle(p: Permit, outcome: "confirmed" | "uncertain" | "not_sent"): Promise<void>;
}
/** Identity of the write being gated (request id, and for operation attempts, op and attempt). */
export type WriteIdentity = { requestId: string; opId: string; attemptId: string };
/** Refused before anything was sent (no gate, or the gate refused). */
export class MutationRefused extends Error {}
const GHL_BASE = "https://services.leadconnectorhq.com";
const READ_TIMEOUT_MS = 10_000;

export class GhlBoundary {
  /** Per-read timeout (inside the invocation's work cutoff). ghl-disposition's contact check uses 5 s. */
  readTimeoutMs = READ_TIMEOUT_MS;
  /**
   * When set, a mutation's post-readback settle (ticket outcome + removal, or
   * uncertain) is queued and run by `flush()` -- used where one invocation sends
   * two NON-overlapping mutations (ghl-disposition), so the second dispatch is
   * not delayed by the first one's bookkeeping. The ticket meanwhile stays
   * `dispatching`, which blocks just the same. The caller always flushes.
   */
  deferSettles = false;
  private queued: (() => Promise<void>)[] = [];
  async flush(): Promise<void> { const q = this.queued; this.queued = []; for (const f of q) await f(); }
  constructor(readonly token: string, readonly locationId: string, readonly fetcher: typeof fetch = fetch, readonly gate: MutationGate | null = null, readonly scope: InvocationScope | null = null, readonly semantic: { lastTouch: string[]; callResult: string[]; offerValue: string[] } = { lastTouch: [], callResult: [], offerValue: [] }) { if (!token) throw new Error("GHL authentication not configured"); }
  private readSignal(): AbortSignal | undefined {
    if (!this.scope) return undefined;
    this.scope.assertMayStart();
    return AbortSignal.any([this.scope.signal, AbortSignal.timeout(Math.max(1, Math.min(this.readTimeoutMs, this.scope.remaining())))]);
  }
  private async request(path: string, method: string, body: unknown, signal?: AbortSignal) {
    const response = await this.fetcher(`${GHL_BASE}${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, Version: "2021-07-28", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error(`GHL request refused (${response.status})`);
    return response.json();
  }
  /** Reads only. A mutation through `call` is refused: every write is a gated, named mutation. */
  async call(path: string, method = "GET", body?: unknown) {
    if (method !== "GET") throw new MutationRefused("GHL mutation refused: writes go through the gated boundary");
    return this.request(path, "GET", body, this.readSignal());
  }
  /**
   * The gated mutation. Throws MutationRefused / the gate's refusal when nothing
   * was sent; WriteUncertain when the request may have been sent and its result
   * is unknown. Returns the permit so the caller settles it after its readback.
   */
  private async mutate(path: string, method: string, body: unknown, m: { subject: string; effects: string[] }, id: WriteIdentity | undefined, hooks?: DispatchHooks): Promise<{ permit: Permit; response: any }> {
    if (!this.gate) throw new MutationRefused("GHL mutation refused: no write gate");
    const identity = id ?? { requestId: `v2-anon-${digest(path + method + JSON.stringify(body ?? null)).slice(0, 24)}`, opId: "-", attemptId: "-" };
    const permit = await this.gate.admit({ ...m, ...identity });
    let owned: OwnedSend | null = null;
    try {
      if (hooks) { owned = (await hooks.beforeDispatch()) ?? null; hooks.state.owned = owned; }
      await this.gate.dispatching(permit);
    } catch (e) { await this.gate.settle(permit, "not_sent").catch(() => {}); throw e; }
    let response: any;
    try {
      response = await this.gate.send(permit, owned, () => { if (hooks) hooks.state.dispatched = true; }, (signal) => this.request(path, method, body, signal));
    } catch (e) {
      if (!permit.sent) { await this.gate.settle(permit, "not_sent").catch(() => {}); throw e; }
      await this.gate.settle(permit, "uncertain").catch(() => {});
      throw new WriteUncertain("Write was not confirmed; independently read back before retrying");
    }
    return { permit, response };
  }
  private async settle(p: Permit, outcome: "confirmed" | "uncertain") {
    if (!this.gate) return;
    const gate = this.gate;
    const run = () => gate.settle(p, outcome).catch(() => {});
    if (this.deferSettles) this.queued.push(run); else await run();
  }

  async contact(id: string) {
    const data = await this.call(`/contacts/${id}`); const contact = data.contact;
    if (!contact || contact.id !== id || contact.locationId !== this.locationId || !Array.isArray(contact.customFields)) throw new Error("Contact identity or field readback is ambiguous");
    return contact;
  }
  async opportunity(id: string) {
    const data = await this.call(`/opportunities/${id}`); const opportunity = data.opportunity ?? data;
    // INV-98 Board #9: GHL omits `customFields` entirely on an opportunity with
    // no custom values set yet (observed live on the pinned Production fixture,
    // 2026-09-29). Omission alone is an empty field list. A present value that
    // is not an array (null, object, string) is still malformed and refused.
    if (opportunity && typeof opportunity === "object" && !Object.prototype.hasOwnProperty.call(opportunity, "customFields")) opportunity.customFields = [];
    if (opportunity.id !== id || opportunity.locationId !== this.locationId || typeof opportunity.contactId !== "string" || !Array.isArray(opportunity.customFields)) throw new Error("Opportunity identity or field readback is ambiguous");
    await this.contact(opportunity.contactId);
    return opportunity;
  }
  async notes(id: string) {
    const data = await this.call(`/contacts/${id}/notes`);
    if (!Array.isArray(data.notes) || data.notes.some((n: any) => typeof n.body !== "string")) throw new Error("Notes readback is ambiguous");
    return data.notes as { id: string; body: string; dateAdded?: string }[];
  }
  async fields(kind: "contact" | "opportunity", id: string, fields: FieldWrite[], hooks?: DispatchHooks, identity?: WriteIdentity) {
    await (kind === "contact" ? this.contact(id) : this.opportunity(id));
    const m = { subject: `${kind}:${id}`, effects: fieldEffects(fields.map((f) => f.id), this.semantic) };
    const { permit, response } = await this.mutate(`/${kind === "contact" ? "contacts" : "opportunities"}/${id}`, "PUT", { customFields: fields.map(({ id, field_value }) => ({ id, field_value })) }, m, identity, hooks);
    let readback: any;
    try { readback = await (kind === "contact" ? this.contact(id) : this.opportunity(id)); }
    catch { await this.settle(permit, "uncertain"); throw new WriteUncertain("Write submitted; readback unavailable. Do not retry blindly"); }
    let results: { id: string; landed: boolean }[];
    try { results = fields.map(field => ({ id: field.id, landed: matchesField(readback.customFields, field, kind) })); }
    catch { await this.settle(permit, "uncertain"); throw new WriteUncertain("Write submitted; field readback is ambiguous"); }
    const confirmed = results.every(r => r.landed);
    await this.settle(permit, confirmed ? "confirmed" : "uncertain");
    return { response, readback, confirmed, results };
  }
  /**
   * Board #9 Phase B (B9-13) -- the Under Contract stage transition.
   * Never called except from the dedicated, independently-re-verified
   * "opportunity.underContractStage" write operation (`ghl-write.ts` ->
   * `write-derived-note.ts`), which itself refuses unless a genuine
   * Under Contract record and a genuine preserved-artifact record both
   * re-derive from fresh evidence. This method adds its own,
   * non-bypassable checks on top -- it never trusts a caller to have
   * already refused the forbidden stage or the wrong pipeline/location.
   *
   * Idempotent: if the opportunity's live current stage already matches
   * `targetStageId`, this returns success with `alreadyInStage: true` and
   * performs NO write -- never a redundant PUT.
   */
  async transitionOpportunityStage(
    opportunityId: string, expectedPipelineId: string, targetStageId: string, forbiddenStageIds: readonly string[],
    // INV-98: beforePut runs after every pre-write refusal and the
    // already-in-stage check, immediately before the PUT; afterConfirmed runs
    // only after the exact pipeline/stage readback. Anything thrown in between
    // (or an interrupted function) skips afterConfirmed.
    hooks: { beforePut?: () => Promise<void>; afterConfirmed?: () => Promise<void> } = {},
    identity?: WriteIdentity,
  ) {
    if (forbiddenStageIds.includes(targetStageId)) throw new Error("Refusing to transition to a forbidden stage");
    if (!targetStageId || targetStageId === UNDER_CONTRACT_STAGE_NOT_PROVISIONED) throw new Error("Target stage is not provisioned for this environment");
    const before = await this.opportunity(opportunityId);
    if (before.pipelineId !== expectedPipelineId) throw new Error("Opportunity is not in the expected pipeline");
    if (before.pipelineStageId === targetStageId) {
      return { response: null as unknown, readback: before, alreadyInStage: true as const };
    }
    await hooks.beforePut?.();
    const { permit, response } = await this.mutate(`/opportunities/${opportunityId}`, "PUT", { pipelineStageId: targetStageId }, { subject: `opportunity:${opportunityId}`, effects: ["stage"] }, identity);
    let readback: any;
    try { readback = await this.opportunity(opportunityId); }
    catch { await this.settle(permit, "uncertain"); throw new WriteUncertain("Stage transition submitted; readback unavailable. Do not retry blindly"); }
    if (readback.pipelineId !== expectedPipelineId || readback.pipelineStageId !== targetStageId) {
      await this.settle(permit, "uncertain");
      throw new WriteUncertain("Stage transition readback does not confirm the exact expected pipeline/stage");
    }
    await this.settle(permit, "confirmed");
    await hooks.afterConfirmed?.();
    return { response, readback, alreadyInStage: false as const };
  }
  async note(id: string, body: string, hooks?: DispatchHooks, identity?: WriteIdentity, extraEffects: string[] = []) {
    await this.contact(id);
    const { permit, response } = await this.mutate(`/contacts/${id}/notes`, "POST", { body }, { subject: `contact:${id}`, effects: ["note", ...extraEffects].sort() }, identity, hooks);
    const noteId = response.note?.id ?? response.id;
    try {
      const matches = (await this.notes(id)).filter(n => n.id === noteId && n.body === body);
      if (!noteId || matches.length !== 1) throw new Error("Note readback mismatch");
    } catch { await this.settle(permit, "uncertain"); throw new WriteUncertain("Note submitted; exact readback unavailable"); }
    await this.settle(permit, "confirmed");
    return response;
  }
  /** Task completion (ghl-write `task` plans). Already-completed tasks perform no write. */
  async completeTask(contactId: string, taskId: string, identity?: WriteIdentity) {
    const path = `/contacts/${contactId}/tasks/${taskId}`;
    const before = await this.call(path); const task = before.task ?? before;
    if (task.id !== taskId || (task.contactId && task.contactId !== contactId) || typeof task.completed !== "boolean") throw new Error("Task identity is ambiguous");
    if (task.completed) return { confirmed: true };
    const { permit } = await this.mutate(`${path}/completed`, "PUT", { completed: true }, { subject: `contact:${contactId}`, effects: ["task"] }, identity);
    let readback: any;
    try { const after = await this.call(path); readback = after.task ?? after; }
    catch { await this.settle(permit, "uncertain"); throw new WriteUncertain("Task completion readback is unavailable"); }
    if (readback.id !== taskId || readback.completed !== true) { await this.settle(permit, "uncertain"); throw new WriteUncertain("Task completion readback is ambiguous"); }
    await this.settle(permit, "confirmed");
    return { confirmed: true };
  }
}
export function fieldValue(fields: any[], id: string, kind: "contact" | "opportunity") {
  const entries = fields.filter(f => f.id === id);
  if (entries.length > 1) throw new Error("Duplicate field readback");
  if (!entries.length) return { present: false, value: null };
  const key = kind === "contact" ? "value" : "fieldValue";
  if (!Object.prototype.hasOwnProperty.call(entries[0], key)) throw new Error("Malformed field readback");
  return { present: true, value: entries[0][key] };
}
export function matchesField(fields: any[], expected: FieldWrite, kind: "contact" | "opportunity") {
  const actual = fieldValue(fields, expected.id, kind);
  if (expected.field_value === "" || expected.field_value === null) return !actual.present;
  if (!actual.present) return false;
  if (expected.date) return typeof actual.value === "string" && actual.value.slice(0, 10) === String(expected.field_value).slice(0, 10);
  return JSON.stringify(actual.value) === JSON.stringify(expected.field_value);
}
/** Semantic effect classes of the configured carrier fields (G5 overlap). */
export function semanticFields(config: ReturnType<typeof getConfig>) {
  const f: any = config.fields ?? {};
  const u: any = (config as any).opportunityFacts ?? {};
  const pick = (...vals: unknown[]) => vals.filter((v): v is string => typeof v === "string" && v.length > 0);
  return {
    lastTouch: pick(f.lastCallAttempt, f.lastCallAttemptPrecise),
    callResult: pick(f.callDisposition),
    offerValue: pick(u.currentOffer),
  };
}
/**
 * The boundary for this invocation. Reads always work (with the new-build
 * credential); mutations need the invocation's WriteGate.
 */
export function configuredBoundary(token = ghlToken(), gate: MutationGate | null = null, scope: InvocationScope | null = null, fetcher: typeof fetch = fetch) {
  const config = getConfig(process.env.IAOS_ENV);
  return new GhlBoundary(token ?? "", config.locationId, fetcher, gate, scope, semanticFields(config));
}
