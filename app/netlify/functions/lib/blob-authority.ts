/**
 * B1 Blob authority -- bounded offline scope (B15-26 B1 design r7; acceptance
 * boundary addendum r2 + r3 corrections, Bones 2026-10-21). Isolated module:
 * NO caller in the application uses it yet.
 *
 * One per-scope authority record A(scope) in the existing receipts store,
 * reached ONLY through an explicit API-mode client (siteID + token both
 * supplied, so @netlify/blobs ignores the process-wide environment context;
 * no edgeURL). Every write is conditional (onlyIfNew / onlyIfMatch) and
 * takes its precondition from the operation's OWN strong read. Each
 * operation sends at most ONE real blob request: retryable results are
 * answered to the SDK with a non-retryable synthetic response, and the
 * outcome is classified from the recorded attempt -- never from the SDK's
 * `modified` (which reports any non-412 conditional result as success in
 * 11.1.0).
 *
 * Exported operations (complete list): readAuthority, openAdmission,
 * classifyUncertainOpen, fenceUncertainOpen, labelHeldRecovery; and, from the
 * repair-save completion contract (r1 + r2 + r3 + r4): dispatchNote,
 * dispatchFields, verifyRepairTarget, closeVerified, abandonUndispatched,
 * readRepairApproval, with the two transport factories. There is no
 * fence-anything or generic write. The ONLY path to COMPLETED from another
 * state is closeVerified(token), whose single-use token is minted only by
 * verifyRepairTarget for the same process's own admission after its own
 * definite dispatches and a VERIFIED readback. Nothing exits HELD_RECOVERY;
 * nothing moves ADMITTED to IDLE except abandonUndispatched for an admission
 * that provably never sent a TARGET request. An uncertain TARGET leaves the
 * scope blocking; no time-based, assertion-based or generic release exists.
 * A fake (loopback) transport never pairs with a real authority client, nor
 * the production transport with a loopback one: dispatch, verification and
 * the reader refuse a mismatch before any TARGET request, and CLOSE refuses
 * it again. A note POST whose response lacks a usable note id halts the
 * admission (blocking, never retried); verification binds to that exact id.
 * Repair evidence is read ONLY by that id (contract r5.1, N0): no notes list
 * is read and no note is found by its text, so a duplicate or conflicting
 * note elsewhere on the contact is never consulted (and never detected).
 *
 * Uncertain admissions return an opaque handle backed by a private,
 * process-local registry. Unknown, forged, copied, transferred or
 * post-restart handles are refused before any request; losing a handle never
 * clears the underlying uncertainty.
 *
 * Whole-save deadline (deadline proposal r3 + r4 + erratum 1; Bones's r3/r4
 * requirements). A client MAY carry an absolute `deadline` on its own clock;
 * without one every limit below is infinite and behaviour is as before. With
 * one: (G1) no request STARTS with less than `minStartMs` left before its
 * limit, and no WRITE (an authority CAS, the note POST, the fields PUT) starts
 * unless its full cap fits before the deadline -- a refused start is recorded
 * as not sent, never as uncertain; (G2) a started read is aborted at
 * min(start + cap, its clamp), so the clamped reads protect the release and
 * CLOSE reserves; every timer stays armed until the SDK call or body read has
 * returned (M2), so an abort also settles a hung body. A write aborted after
 * it was sent stays ambiguous / UNCERTAIN.
 *
 * What the offline tests of this module show is OUR behaviour against a fake
 * service. Provider guarantees (conditional-write atomicity, ETag
 * distinctness, status codes, strong-read freshness) are documented
 * capabilities or open assumptions, not proven here.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import {
  type RepairPayload, canonicalCurrency, parseEvidence, payloadDigest, readExactlyOneField, renderEvidence,
  usableNoteId, validatePayload, wellFormedId,
} from "./repair-evidence";

export const AUTHORITY_STORE = "iaos-write-receipts";
const KEY_PREFIX = "repair-authority/";
const SIGNED_URL_ACCEPT = "application/json;type=signed-url";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MIN_START_MS = 250;
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------- values ---

export type AuthorityOp = {
  opId: string;
  nonce: string;
  operator: string;
  target: { opportunityId: string; contactId: string };
  preconditionDigest: string;
  expectedResultHash: string;
  admittedAt: string;
};
type Base = { schema: 1; v: number; epoch: number };
export type IdleValue = Base & { state: "IDLE"; last: { opId: string; outcome: string } | null; fencedOp: string | null; fencedAt: string | null };
export type AdmittedValue = Base & { state: "ADMITTED"; op: AuthorityOp };
export type CompletedValue = Base & { state: "COMPLETED"; op: AuthorityOp; completion: Record<string, unknown>; fencedOp: string | null; fencedAt: string | null };
export type HeldValue = Base & { state: "HELD_RECOVERY"; op: AuthorityOp; reason: "target_uncertain"; heldAt: string };
export type AuthorityValue = IdleValue | AdmittedValue | CompletedValue | HeldValue;

/** Deterministic JSON: object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function exactKeys(v: Record<string, unknown>, keys: string[]): boolean {
  const have = Object.keys(v).sort();
  const want = [...keys].sort();
  return have.length === want.length && have.every((k, i) => k === want[i]);
}
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;
const counter = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const optString = (v: unknown) => v === null || nonEmpty(v);

function parseOp(v: unknown): AuthorityOp | null {
  if (!isPlainObject(v) || !exactKeys(v, ["opId", "nonce", "operator", "target", "preconditionDigest", "expectedResultHash", "admittedAt"])) return null;
  const t = v.target;
  if (!isPlainObject(t) || !exactKeys(t, ["opportunityId", "contactId"]) || !nonEmpty(t.opportunityId) || !nonEmpty(t.contactId)) return null;
  if (!nonEmpty(v.opId) || !nonEmpty(v.nonce) || !nonEmpty(v.operator) || !nonEmpty(v.admittedAt)) return null;
  if (typeof v.preconditionDigest !== "string" || !HEX64.test(v.preconditionDigest)) return null;
  if (typeof v.expectedResultHash !== "string" || !HEX64.test(v.expectedResultHash)) return null;
  return v as unknown as AuthorityOp;
}

/** Strict parse; only canonical text written by this module is accepted. */
export function parseAuthorityText(text: string): AuthorityValue | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!isPlainObject(v) || v.schema !== 1 || !counter(v.v) || !counter(v.epoch)) return null;
  if (canonicalJson(v) !== text) return null;
  switch (v.state) {
    case "IDLE": {
      if (!exactKeys(v, ["schema", "state", "v", "epoch", "last", "fencedOp", "fencedAt"])) return null;
      const last = v.last;
      if (last !== null && (!isPlainObject(last) || !exactKeys(last, ["opId", "outcome"]) || !nonEmpty(last.opId) || !nonEmpty(last.outcome))) return null;
      if (!optString(v.fencedOp) || !optString(v.fencedAt)) return null;
      return v as unknown as IdleValue;
    }
    case "ADMITTED":
      if (!exactKeys(v, ["schema", "state", "v", "epoch", "op"]) || !parseOp(v.op)) return null;
      return v as unknown as AdmittedValue;
    case "COMPLETED":
      if (!exactKeys(v, ["schema", "state", "v", "epoch", "op", "completion", "fencedOp", "fencedAt"]) || !parseOp(v.op) || !isPlainObject(v.completion)) return null;
      if (!optString(v.fencedOp) || !optString(v.fencedAt)) return null;
      return v as unknown as CompletedValue;
    case "HELD_RECOVERY":
      if (!exactKeys(v, ["schema", "state", "v", "epoch", "op", "reason", "heldAt"]) || !parseOp(v.op) || v.reason !== "target_uncertain" || !nonEmpty(v.heldAt)) return null;
      return v as unknown as HeldValue;
    default:
      return null;
  }
}

export function authorityKey(scope: string): string {
  return KEY_PREFIX + createHash("sha256").update(scope, "utf8").digest("hex");
}

// ---------------------------------------------------------------- client ---

type SendFloors = { note: number; fields: number };
type ClientConfig = {
  siteID: string; token: string; apiURL: string | undefined; fetchImpl: typeof fetch; timeoutMs: number; now: () => number;
  /** Absolute deadline on `now`'s clock, or null (no deadline: every limit is infinite). */
  deadline: number | null; minStartMs: number; releaseReserveMs: number; closeReserveMs: number; sendFloorsMs: SendFloors;
};
const clientConfigs = new WeakMap<object, ClientConfig>();

/** Opaque, frozen client. Config is held privately; nothing is readable from it. */
export type AuthorityClient = { readonly __authorityClient: true };

export type DeadlineOptions = { deadline?: number; minStartMs?: number; releaseReserveMs?: number; closeReserveMs?: number; sendFloorsMs?: SendFloors };
const nonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function createAuthorityClient(options: { siteID: string; token: string; apiURL?: string; fetch?: typeof fetch; timeoutMs?: number; now?: () => number } & DeadlineOptions): AuthorityClient {
  if (!isPlainObject(options)) throw new Error("authority client: options required");
  const allowed = ["siteID", "token", "apiURL", "fetch", "timeoutMs", "now", "deadline", "minStartMs", "releaseReserveMs", "closeReserveMs", "sendFloorsMs"];
  if (Object.keys(options).some((k) => !allowed.includes(k))) throw new Error("authority client: unsupported option (edge or environment context is never accepted)");
  if (!nonEmpty(options.siteID) || !nonEmpty(options.token)) throw new Error("authority client: siteID and token are both required");
  if (options.apiURL !== undefined && !/^https?:\/\/[^/]+$/.test(options.apiURL)) throw new Error("authority client: apiURL must be an origin");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("authority client: invalid timeout");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("authority client: fetch unavailable");
  const now = options.now ?? Date.now;
  if (typeof now !== "function") throw new Error("authority client: invalid clock");
  const deadline = options.deadline ?? null;
  if (deadline !== null && !(Number.isSafeInteger(deadline) && deadline > 0)) throw new Error("authority client: invalid deadline");
  const minStartMs = options.minStartMs ?? DEFAULT_MIN_START_MS;
  const releaseReserveMs = options.releaseReserveMs ?? 0;
  const closeReserveMs = options.closeReserveMs ?? 0;
  const sendFloorsMs = options.sendFloorsMs ?? { note: 0, fields: 0 };
  if (!nonNegInt(minStartMs) || minStartMs < 1 || !nonNegInt(releaseReserveMs) || !nonNegInt(closeReserveMs)) throw new Error("authority client: invalid deadline reserve");
  if (!isPlainObject(sendFloorsMs) || !exactKeys(sendFloorsMs, ["note", "fields"]) || !nonNegInt(sendFloorsMs.note) || !nonNegInt(sendFloorsMs.fields)) throw new Error("authority client: invalid send floors");
  const client = Object.freeze({ __authorityClient: true as const });
  clientConfigs.set(client, {
    siteID: options.siteID, token: options.token, apiURL: options.apiURL, fetchImpl, timeoutMs, now,
    deadline, minStartMs, releaseReserveMs, closeReserveMs, sendFloorsMs: Object.freeze({ note: sendFloorsMs.note, fields: sendFloorsMs.fields }),
  });
  return client;
}

// ------------------------------------------------------------- deadline ---

/** A read's limit: the deadline less a reserve kept for what must follow it (Infinity without a deadline). */
const readLimit = (cfg: ClientConfig, reserveMs: number) => (cfg.deadline === null ? Infinity : cfg.deadline - reserveMs);
/** Full cap of one authority write: its sign request plus its blob request. */
const writeCapMs = (cfg: ClientConfig) => 2 * cfg.timeoutMs;
/** G1 for a write: it starts only if its whole cap fits before the deadline. */
const writeFits = (cfg: ClientConfig) => cfg.deadline === null || cfg.deadline - cfg.now() >= Math.max(writeCapMs(cfg), cfg.minStartMs);

// ------------------------------------------------- single-attempt transport ---

type Attempt = { stage: "sign" | "blob"; status: number | null; threw: boolean; etag: string | null; suppressed: boolean };
const RETRYABLE = (status: number) => status === 429 || status >= 500 || status === 403;

/**
 * One real sign request and at most one real blob request per operation.
 * `limitAt` (G1/G2): a stage with less than minStartMs left before it is not
 * sent; a sent stage is aborted at min(cap, limitAt). Timers stay armed until
 * settle(), which the operation calls after the SDK returns (M2: the SDK's own
 * body reads are covered).
 */
function recorder(cfg: ClientConfig, limitAt: number, write = false) {
  const attempts: Attempt[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const accept = new Headers(init?.headers).get("accept");
    const stage: Attempt["stage"] = accept === SIGNED_URL_ACCEPT ? "sign" : "blob";
    if (attempts.some((a) => a.stage === stage)) {
      // A second request of the same stage would be an SDK retry: never sent.
      attempts.push({ stage, status: null, threw: false, etag: null, suppressed: true });
      return new Response(null, { status: 400 });
    }
    const left = limitAt - cfg.now();
    // G1, re-checked at EACH dispatch: a read needs minStartMs; a write's sign request needs the whole write cap, and
    // its signed-URL PUT its own full cap -- time spent signing is not assumed to have left room for the PUT.
    const need = !write ? cfg.minStartMs : stage === "sign" ? writeCapMs(cfg) : cfg.timeoutMs;
    if (left < Math.max(need, cfg.minStartMs)) {
      // Not sent. The first sign request is made by the SDK's getFinalRequest OUTSIDE its retry loop, so throwing
      // there ends the operation with no SDK retry; a refused blob request is answered with a synthetic 400.
      attempts.push({ stage, status: null, threw: false, etag: null, suppressed: true });
      if (stage === "sign") throw new Error("authority request not started (deadline)");
      return new Response(null, { status: 400 });
    }
    const ac = new AbortController();
    // A write keeps its full cap (it starts only if that fits); a read is aborted at min(cap, its limit).
    timers.push(setTimeout(() => ac.abort(), write ? cfg.timeoutMs : Math.min(cfg.timeoutMs, left)));
    try {
      const res = await cfg.fetchImpl(url, { ...init, signal: ac.signal });
      attempts.push({ stage, status: res.status, threw: false, etag: res.headers.get("etag"), suppressed: false });
      if (stage === "blob" && RETRYABLE(res.status)) {
        await res.arrayBuffer().catch(() => undefined);
        return new Response(null, { status: 400 });
      }
      return res;
    } catch (e) {
      attempts.push({ stage, status: null, threw: true, etag: null, suppressed: false });
      if (stage === "sign") throw e;
      return new Response(null, { status: 400 });
    }
  };
  return { attempts, fetch: f as typeof fetch, settle: () => { for (const t of timers) clearTimeout(t); } };
}

function storeFor(cfg: ClientConfig, fetchImpl: typeof fetch) {
  // siteID AND token supplied => the SDK uses them instead of the process
  // environment context (contextOverride); no edgeURL => API branch.
  return getStore({ name: AUTHORITY_STORE, siteID: cfg.siteID, token: cfg.token, apiURL: cfg.apiURL, fetch: fetchImpl });
}

type WriteResult = { kind: "committed"; etag: string } | { kind: "conflict" } | { kind: "ambiguous" } | { kind: "not_sent" };

function classifyWrite(attempts: Attempt[]): WriteResult {
  const sign = attempts.find((a) => a.stage === "sign" && !a.suppressed);
  if (!sign || sign.threw || sign.status !== 200) return { kind: "not_sent" };
  const blob = attempts.find((a) => a.stage === "blob" && !a.suppressed);
  if (!blob) return { kind: "not_sent" };
  if (blob.threw || blob.status === null) return { kind: "ambiguous" };
  if (blob.status >= 200 && blob.status < 300) return blob.etag ? { kind: "committed", etag: blob.etag } : { kind: "ambiguous" };
  if (blob.status === 412) return { kind: "conflict" };
  return { kind: "ambiguous" };
}

type ReadResult =
  | { kind: "absent" }
  | { kind: "present"; text: string; etag: string; value: AuthorityValue }
  | { kind: "unreadable"; reason: string };

async function strongRead(cfg: ClientConfig, key: string, limitAt: number = readLimit(cfg, 0)): Promise<ReadResult> {
  const rec = recorder(cfg, limitAt);
  let got: { data: string; etag?: string } | null = null;
  let threw = false;
  try {
    got = (await storeFor(cfg, rec.fetch).getWithMetadata(key, { type: "text" })) as { data: string; etag?: string } | null;
  } catch { threw = true; } finally { rec.settle(); }
  const sign = rec.attempts.find((a) => a.stage === "sign" && !a.suppressed);
  const blob = rec.attempts.find((a) => a.stage === "blob" && !a.suppressed);
  if (!sign || sign.status !== 200 || !blob) return { kind: "unreadable", reason: "sign_failed" };
  if (blob.status === 404 && !threw && got === null) return { kind: "absent" };
  if (blob.status !== 200 || threw || !got || typeof got.data !== "string" || !got.etag) return { kind: "unreadable", reason: "read_failed" };
  const value = parseAuthorityText(got.data);
  if (!value) return { kind: "unreadable", reason: "invalid_value" };
  return { kind: "present", text: got.data, etag: got.etag, value };
}

async function conditionalWrite(cfg: ClientConfig, key: string, text: string, condition: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<WriteResult> {
  if (!writeFits(cfg)) return { kind: "not_sent" }; // G1: its full cap does not fit, so no request at all
  const rec = recorder(cfg, cfg.deadline ?? Infinity, true);
  try { await storeFor(cfg, rec.fetch).set(key, text, condition); } catch { /* classified from the recorded attempts */ } finally { rec.settle(); }
  return classifyWrite(rec.attempts);
}

// ------------------------------------------------- process-local handles ---

type AttemptRecord = Readonly<{
  client: object;
  scope: string;
  key: string;
  opId: string;
  attemptedText: string;
  precondition: Readonly<{ kind: "absent" | "IDLE" | "COMPLETED"; etag: string | null }>;
}>;
const attemptRegistry = new WeakMap<object, AttemptRecord>();

/** Opaque handle for an uncertain admission. Valid only in this process. */
export type UncertainOpenHandle = { readonly __uncertainOpen: true };

function issueHandle(record: AttemptRecord): UncertainOpenHandle {
  const handle = Object.freeze(Object.create(null)) as UncertainOpenHandle;
  attemptRegistry.set(handle, Object.freeze({ ...record, precondition: Object.freeze({ ...record.precondition }) }));
  return handle;
}

function lookup(client: AuthorityClient, handle: unknown): { cfg: ClientConfig; rec: AttemptRecord } | null {
  const cfg = clientConfigs.get(client as object);
  if (!cfg || typeof handle !== "object" || handle === null) return null;
  const rec = attemptRegistry.get(handle);
  if (!rec || rec.client !== client) return null;
  return { cfg, rec };
}

// ----------------------------------------------------------- operations ---

export type ReadAuthorityResult =
  | { kind: "absent" }
  | { kind: "present"; state: AuthorityValue["state"]; v: number; epoch: number; etag: string; opId: string | null }
  | { kind: "unreadable"; reason: string };

/** Read-only strong read. */
export async function readAuthority(client: AuthorityClient, scope: string): Promise<ReadAuthorityResult> {
  const cfg = clientConfigs.get(client as object);
  if (!cfg || !nonEmpty(scope)) return { kind: "unreadable", reason: "refused_input" };
  const r = await strongRead(cfg, authorityKey(scope));
  if (r.kind !== "present") return r;
  const opId = r.value.state === "IDLE" ? null : r.value.op.opId;
  return { kind: "present", state: r.value.state, v: r.value.v, epoch: r.value.epoch, etag: r.etag, opId };
}

export type AdmissionIntent = { operator: string; opportunityId: string; contactId: string; preconditionDigest: string; expectedResultHash: string };
export type OpenResult =
  | { kind: "committed"; opId: string; etag: string; admission: AdmissionHandle }
  | { kind: "refused"; reason: string }
  | { kind: "not_sent" }
  | { kind: "unreadable" }
  | { kind: "ambiguous"; handle: UncertainOpenHandle };

/** absent | IDLE | COMPLETED -> ADMITTED(op). Never from ADMITTED or HELD_RECOVERY; never retried. */
export async function openAdmission(client: AuthorityClient, scope: string, intent: AdmissionIntent): Promise<OpenResult> {
  const cfg = clientConfigs.get(client as object);
  if (!cfg || !nonEmpty(scope)) return { kind: "refused", reason: "refused_input" };
  if (!isPlainObject(intent) || !exactKeys(intent, ["operator", "opportunityId", "contactId", "preconditionDigest", "expectedResultHash"])) return { kind: "refused", reason: "refused_input" };
  if (!nonEmpty(intent.operator) || !nonEmpty(intent.opportunityId) || !nonEmpty(intent.contactId)) return { kind: "refused", reason: "refused_input" };
  if (!HEX64.test(String(intent.preconditionDigest)) || !HEX64.test(String(intent.expectedResultHash))) return { kind: "refused", reason: "refused_input" };
  const key = authorityKey(scope);
  const r = await strongRead(cfg, key, readLimit(cfg, writeCapMs(cfg))); // its CAS keeps its full cap
  if (r.kind === "unreadable") return { kind: "unreadable" };
  if (r.kind === "present" && (r.value.state === "ADMITTED" || r.value.state === "HELD_RECOVERY")) return { kind: "refused", reason: "scope_blocked" };
  const prev = r.kind === "present" ? r.value : null;
  const op: AuthorityOp = {
    opId: randomUUID(),
    nonce: randomBytes(16).toString("hex"),
    operator: intent.operator,
    target: { opportunityId: intent.opportunityId, contactId: intent.contactId },
    preconditionDigest: intent.preconditionDigest,
    expectedResultHash: intent.expectedResultHash,
    admittedAt: new Date().toISOString(),
  };
  const next: AdmittedValue = { schema: 1, state: "ADMITTED", v: (prev?.v ?? 0) + 1, epoch: (prev?.epoch ?? 0) + 1, op };
  const text = canonicalJson(next);
  const precondition = r.kind === "present"
    ? { kind: r.value.state as "IDLE" | "COMPLETED", etag: r.etag }
    : { kind: "absent" as const, etag: null };
  const w = await conditionalWrite(cfg, key, text, r.kind === "present" ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
  switch (w.kind) {
    case "committed": return { kind: "committed", opId: op.opId, etag: w.etag, admission: issueAdmission(client as object, cfg, scope, key, op, w.etag) };
    case "conflict": return { kind: "refused", reason: "precondition_changed" };
    case "not_sent": return { kind: "not_sent" };
    case "ambiguous": return { kind: "ambiguous", handle: issueHandle({ client: client as object, scope, key, opId: op.opId, attemptedText: text, precondition }) };
  }
}

export type ClassifyResult =
  | { kind: "landed" }
  | { kind: "still_possible" }
  | { kind: "already_fenced" }
  | { kind: "unreadable" }
  | { kind: "refused"; reason: string };

/** Read-only. Never treats still_possible as cleared. */
export async function classifyUncertainOpen(client: AuthorityClient, handle: UncertainOpenHandle): Promise<ClassifyResult> {
  const found = lookup(client, handle);
  if (!found) return { kind: "refused", reason: "unknown_handle" };
  const { cfg, rec } = found;
  const r = await strongRead(cfg, rec.key);
  if (r.kind === "unreadable") return { kind: "unreadable" };
  if (r.kind === "present" && r.text === rec.attemptedText) return { kind: "landed" };
  if (rec.precondition.kind === "absent" ? r.kind === "absent"
    : r.kind === "present" && r.value.state === rec.precondition.kind && r.etag === rec.precondition.etag) return { kind: "still_possible" };
  return { kind: "already_fenced" };
}

export type FenceResult = { kind: "fenced"; etag: string } | { kind: "refused"; reason: string } | { kind: "not_sent" } | { kind: "unreadable" } | { kind: "ambiguous" };

/**
 * Fences an uncertain admission by rewriting the attempt's PRECONDITION
 * state as the same state kind (absent -> IDLE; IDLE -> IDLE; COMPLETED ->
 * COMPLETED with op and completion copied unchanged from this op's own
 * strong read). Never acts on ADMITTED or HELD_RECOVERY.
 */
export async function fenceUncertainOpen(client: AuthorityClient, handle: UncertainOpenHandle): Promise<FenceResult> {
  const found = lookup(client, handle);
  if (!found) return { kind: "refused", reason: "unknown_handle" };
  const { cfg, rec } = found;
  const r = await strongRead(cfg, rec.key, readLimit(cfg, writeCapMs(cfg)));
  if (r.kind === "unreadable") return { kind: "unreadable" };
  const now = new Date().toISOString();
  let next: IdleValue | CompletedValue;
  if (rec.precondition.kind === "absent") {
    if (r.kind !== "absent") return { kind: "refused", reason: "precondition_changed" };
    next = { schema: 1, state: "IDLE", v: 1, epoch: 1, last: null, fencedOp: rec.opId, fencedAt: now };
  } else {
    if (r.kind !== "present" || r.value.state !== rec.precondition.kind || r.etag !== rec.precondition.etag) return { kind: "refused", reason: "precondition_changed" };
    const cur = r.value;
    if (cur.state === "IDLE") {
      next = { schema: 1, state: "IDLE", v: cur.v + 1, epoch: cur.epoch + 1, last: cur.last, fencedOp: rec.opId, fencedAt: now };
    } else if (cur.state === "COMPLETED") {
      next = { schema: 1, state: "COMPLETED", v: cur.v + 1, epoch: cur.epoch + 1, op: cur.op, completion: cur.completion, fencedOp: rec.opId, fencedAt: now };
    } else {
      return { kind: "refused", reason: "precondition_changed" };
    }
  }
  const w = await conditionalWrite(cfg, rec.key, canonicalJson(next), r.kind === "present" ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
  switch (w.kind) {
    case "committed": return { kind: "fenced", etag: w.etag };
    case "conflict": return { kind: "refused", reason: "raced" };
    case "not_sent": return { kind: "not_sent" };
    case "ambiguous": return { kind: "ambiguous" };
  }
}

export type LabelResult = { kind: "labelled"; etag: string } | { kind: "refused"; reason: string } | { kind: "not_sent" } | { kind: "unreadable" } | { kind: "ambiguous" };

/** ADMITTED(opId) -> HELD_RECOVERY(opId). Blocking to blocking only. */
export async function labelHeldRecovery(client: AuthorityClient, scope: string, opId: string): Promise<LabelResult> {
  const cfg = clientConfigs.get(client as object);
  if (!cfg || !nonEmpty(scope) || !nonEmpty(opId)) return { kind: "refused", reason: "refused_input" };
  const key = authorityKey(scope);
  const r = await strongRead(cfg, key, readLimit(cfg, writeCapMs(cfg)));
  if (r.kind === "unreadable") return { kind: "unreadable" };
  if (r.kind !== "present" || r.value.state !== "ADMITTED" || r.value.op.opId !== opId) return { kind: "refused", reason: "not_admitted_for_op" };
  const cur = r.value;
  const next: HeldValue = { schema: 1, state: "HELD_RECOVERY", v: cur.v + 1, epoch: cur.epoch + 1, op: cur.op, reason: "target_uncertain", heldAt: new Date().toISOString() };
  const w = await conditionalWrite(cfg, key, canonicalJson(next), { onlyIfMatch: r.etag });
  switch (w.kind) {
    case "committed": return { kind: "labelled", etag: w.etag };
    case "conflict": return { kind: "refused", reason: "raced" };
    case "not_sent": return { kind: "not_sent" };
    case "ambiguous": return { kind: "ambiguous" };
  }
}

// =================================================================================
// Repair-save completion (contract r1 baseline, amended by r2, r3 and r4).
// Everything below is process-local state over the accepted A(scope) record.
// The caller supplies NO send or read callback: the module builds every GHL
// request from the admission record, through a transport object it created.
// =================================================================================

const GHL_ORIGIN = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const VERIFY_MAX_PASSES = 3;
const VERIFY_WINDOW_MS = 10_000;
export const READER_TEXT = Object.freeze({
  checked: (iso: string) => `Recorded repair approval — checked as of ${iso}`,
  needsReview: "Repair save needs review. Do not retry this approval.",
  notVerified: "Repair approval could not be verified",
});

// ------------------------------------------------------------- transports ---

type FieldIds = { repairEstimate: string; repairApprovalId: string };
/** timeoutMs caps a target WRITE (note POST, fields PUT); readTimeoutMs caps a target GET. */
type TransportConfig = { mode: "ghl" | "fake"; origin: string; token: string; fetchImpl: typeof fetch; fieldIds: FieldIds; timeoutMs: number; readTimeoutMs: number };
function transportTimeouts(options: { timeoutMs?: unknown; readTimeoutMs?: unknown }, label: string): { timeoutMs: number; readTimeoutMs: number } {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readTimeoutMs = options.readTimeoutMs ?? timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || !Number.isSafeInteger(readTimeoutMs) || (readTimeoutMs as number) < 1) throw new Error(`${label}: invalid timeout`);
  return { timeoutMs: timeoutMs as number, readTimeoutMs: readTimeoutMs as number };
}
const transports = new WeakMap<object, TransportConfig>();

/** Opaque transport. It exposes no request method; only this module's operations use it. */
export type TargetTransport = { readonly __targetTransport: true };

function validFieldIds(v: unknown): FieldIds | null {
  if (!isPlainObject(v) || !exactKeys(v, ["repairEstimate", "repairApprovalId"])) return null;
  const ok = (s: unknown) => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s);
  if (!ok(v.repairEstimate) || !ok(v.repairApprovalId) || v.repairEstimate === v.repairApprovalId) return null;
  return Object.freeze({ repairEstimate: v.repairEstimate as string, repairApprovalId: v.repairApprovalId as string });
}

/**
 * The trusted production transport: origin pinned to the GHL API (https), the
 * server's own GHL credential read HERE (never a caller value). The field ids
 * come from server configuration; repair_approval_id does not exist yet (P5,
 * Brad), so production use is impossible until it is configured.
 */
export function createProductionTargetTransport(options: { fieldIds: FieldIds; timeoutMs?: number; readTimeoutMs?: number }): TargetTransport {
  if (!isPlainObject(options) || !("fieldIds" in options) || Object.keys(options).some((k) => !["fieldIds", "timeoutMs", "readTimeoutMs"].includes(k))) throw new Error("target transport: options must be { fieldIds, timeoutMs?, readTimeoutMs? }");
  const fieldIds = validFieldIds(options.fieldIds);
  if (!fieldIds) throw new Error("target transport: both binding field ids are required (repair_approval_id is not configured)");
  const caps = transportTimeouts(options, "target transport");
  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!nonEmpty(token)) throw new Error("target transport: server GHL credential unavailable");
  const t = Object.freeze({ __targetTransport: true as const });
  transports.set(t, { mode: "ghl", origin: GHL_ORIGIN, token, fetchImpl: globalThis.fetch, fieldIds, ...caps });
  return t;
}

/** Offline tests only: loopback origin (http://127.0.0.1:port) and a synthetic token. */
export function createFakeTargetTransport(options: { fetch: typeof fetch; origin: string; fieldIds: FieldIds; timeoutMs?: number; readTimeoutMs?: number }): TargetTransport {
  if (!isPlainObject(options)) throw new Error("fake transport: options required");
  if (Object.keys(options).some((k) => !["fetch", "origin", "fieldIds", "timeoutMs", "readTimeoutMs"].includes(k))) throw new Error("fake transport: unsupported option");
  if (typeof options.origin !== "string" || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(options.origin)) throw new Error("fake transport: loopback origin only");
  if (typeof options.fetch !== "function") throw new Error("fake transport: fetch required");
  const fieldIds = validFieldIds(options.fieldIds);
  if (!fieldIds) throw new Error("fake transport: field ids invalid");
  const caps = transportTimeouts(options, "fake transport");
  const t = Object.freeze({ __targetTransport: true as const });
  transports.set(t, { mode: "fake", origin: options.origin, token: "synthetic-fake-transport", fetchImpl: options.fetch, fieldIds, ...caps });
  return t;
}

const clientIsLoopback = (cfg: ClientConfig) => typeof cfg.apiURL === "string" && /^http:\/\/127\.0\.0\.1(:\d{1,5})?$/.test(cfg.apiURL);
const modesMatch = (cfg: ClientConfig, t: TransportConfig) => (clientIsLoopback(cfg) ? t.mode === "fake" : t.mode === "ghl");

type GhlReply = { status: number | null; json: unknown };
/** A GET's G1/G2 limit, from the admission's client: not sent with less than minStartMs left; aborted at the limit. */
type ReadGate = { now: () => number; limitAt: number; minStartMs: number };
const gateFor = (cfg: ClientConfig, reserveMs: number): ReadGate => ({ now: cfg.now, limitAt: readLimit(cfg, reserveMs), minStartMs: cfg.minStartMs });
/**
 * One request, never retried, never redirected; status recorded before the body is read. The timer covers the
 * body. A write is capped by timeoutMs (its start is decided by the send gate); a GET by readTimeoutMs and its gate.
 */
async function ghlCall(t: TransportConfig, method: "GET" | "POST" | "PUT", path: string, body?: unknown, gate?: ReadGate): Promise<GhlReply> {
  let capMs = method === "GET" ? t.readTimeoutMs : t.timeoutMs;
  if (method === "GET" && gate) {
    const left = gate.limitAt - gate.now();
    if (left < gate.minStartMs) return { status: null, json: null }; // G1: not sent
    capMs = Math.min(capMs, left);
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), capMs);
  let status: number | null = null;
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${t.token}`, Version: GHL_VERSION, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await t.fetchImpl(t.origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: ac.signal });
    status = res.type === "opaqueredirect" ? 0 : res.status;
    let json: unknown = null;
    try { json = JSON.parse(await res.text()); } catch { json = null; }
    return { status, json };
  } catch {
    return { status, json: null };
  } finally {
    clearTimeout(timer);
  }
}
const isDefinite = (s: number | null) => s !== null && s >= 200 && s < 300;

// --------------------------------------------------------- admission records ---

/**
 * NOTE_UNBOUND: the note POST was 2xx but its response carried no usable note
 * id. The note may exist, so this is terminal and blocking exactly like
 * UNCERTAIN: no fields dispatch, no verification, no abandonment, no retry.
 */
type DispatchState = "NONE" | "NOTE_RESERVED" | "NOTE_SENDING" | "NOTE_DEFINITE" | "NOTE_UNBOUND" | "FIELDS_RESERVED" | "FIELDS_SENDING" | "FIELDS_DEFINITE" | "HALTED_NOT_SENT" | "UNCERTAIN" | "RETIRED";
type Binding = Readonly<{ client: object; cfg: ClientConfig; scope: string; key: string; opId: string; eAdm: string; P: string; op: AuthorityOp }>;
type AdmissionState = {
  dispatch: DispatchState;
  haltedAt: "note" | "fields" | null;
  transport: object | null;
  createdNoteId: string | null;
  verify: "IDLE" | "PENDING" | "VERIFIED" | "HOLD";
  passes: number;
  firstPassStart: number;
  inFlight: boolean;
  holdReason: string | null;
  closed: boolean;
};
type AdmissionRecord = { b: Binding; st: AdmissionState };
const admissions = new WeakMap<object, AdmissionRecord>();

/** Opaque handle for a COMMITTED admission. Process-local; unusable after a restart. */
export type AdmissionHandle = { readonly __admission: true };

function issueAdmission(client: object, cfg: ClientConfig, scope: string, key: string, op: AuthorityOp, eAdm: string): AdmissionHandle {
  const handle = Object.freeze(Object.create(null)) as AdmissionHandle;
  const b: Binding = Object.freeze({ client, cfg, scope, key, opId: op.opId, eAdm, P: op.expectedResultHash, op: Object.freeze({ ...op, target: Object.freeze({ ...op.target }) }) });
  admissions.set(handle, { b, st: { dispatch: "NONE", haltedAt: null, transport: null, createdNoteId: null, verify: "IDLE", passes: 0, firstPassStart: 0, inFlight: false, holdReason: null, closed: false } });
  return handle;
}

/** A strong read showing exactly this admission: ADMITTED(op) at ETag eAdm with expectedResultHash P. */
type AuthorityCheck = { kind: "ok"; value: AdmittedValue } | { kind: "changed" } | { kind: "unreadable" };
async function readOwnAdmission(b: Binding, limitAt: number): Promise<AuthorityCheck> {
  const r = await strongRead(b.cfg, b.key, limitAt);
  if (r.kind === "unreadable") return { kind: "unreadable" };
  if (r.kind !== "present" || r.value.state !== "ADMITTED" || r.etag !== b.eAdm || r.value.op.opId !== b.opId || r.value.op.expectedResultHash !== b.P) return { kind: "changed" };
  return { kind: "ok", value: r.value };
}

/** The payload must be exactly the one admitted: digest P and the admitted identity fields. */
function payloadForAdmission(b: Binding, payload: unknown): RepairPayload | null {
  const p = validatePayload(payload);
  if (!p || payloadDigest(p) !== b.P) return null;
  if (p.opportunityId !== b.op.target.opportunityId || p.contactId !== b.op.target.contactId || p.operator !== b.op.operator) return null;
  return p;
}

// --------------------------------------------------------------- dispatch ---

export type DispatchResult =
  | { kind: "definite"; status: number }
  | { kind: "not_sent"; reason: string }
  | { kind: "uncertain" }
  | { kind: "halted"; reason: "created_note_id_unusable" }
  | { kind: "refused"; reason: string };

/**
 * Shared dispatch. Everything before the first `await` runs synchronously in
 * the caller's turn: handle, transport, transport/authority MODE, payload and
 * state checks, then the RESERVATION. A mode mismatch (fake transport with a
 * real authority client, or the production transport with a loopback one) is
 * refused here, before any reservation or request.
 * After the D1 strong read, the send gate re-checks the reserved state and
 * moves to SENDING with no await in between, then calls the transport.
 */
function dispatchKind(admission: unknown, kind: "note" | "fields", transport: unknown, payload: unknown): Promise<DispatchResult> {
  const rec = typeof admission === "object" && admission !== null ? admissions.get(admission) : undefined;
  if (!rec) return Promise.resolve({ kind: "refused", reason: "unknown_admission" });
  const { b, st } = rec;
  const tObj = kind === "note" ? transport : st.transport;
  const t = typeof tObj === "object" && tObj !== null ? transports.get(tObj) : undefined;
  if (!t) return Promise.resolve({ kind: "refused", reason: "unknown_transport" });
  if (!modesMatch(b.cfg, t)) return Promise.resolve({ kind: "refused", reason: "transport_mode_mismatch" });
  const p = payloadForAdmission(b, payload);
  if (!p) return Promise.resolve({ kind: "refused", reason: "payload_mismatch" });
  const need: DispatchState = kind === "note" ? "NONE" : "NOTE_DEFINITE";
  if (st.dispatch !== need) return Promise.resolve({ kind: "refused", reason: `state_${st.dispatch.toLowerCase()}` });
  const reserved: DispatchState = kind === "note" ? "NOTE_RESERVED" : "FIELDS_RESERVED";
  st.dispatch = reserved; // reservation: synchronous, before any await
  if (kind === "note") st.transport = tObj as object;
  return (async (): Promise<DispatchResult> => {
    // The note's D1 read cannot use the release reserve; the fields' D1 read cannot use the CLOSE reserve.
    const d1 = await readOwnAdmission(b, readLimit(b.cfg, kind === "note" ? b.cfg.releaseReserveMs : b.cfg.closeReserveMs));
    if (d1.kind !== "ok") {
      if (st.dispatch === reserved) { st.dispatch = "HALTED_NOT_SENT"; st.haltedAt = kind; }
      return { kind: "not_sent", reason: d1.kind === "unreadable" ? "d1_unreadable" : "d1_authority_changed" };
    }
    // ---- send gate: no await between these checks and the transport call ----
    if (st.dispatch !== reserved) return { kind: "not_sent", reason: st.dispatch === "RETIRED" ? "retired" : "state_changed" };
    // M3: with a deadline, the write starts only if its floor (never less than its own full cap) is still left.
    if (b.cfg.deadline !== null && b.cfg.deadline - b.cfg.now() < Math.max(b.cfg.sendFloorsMs[kind], t.timeoutMs, b.cfg.minStartMs)) {
      st.dispatch = "HALTED_NOT_SENT"; st.haltedAt = kind;
      return { kind: "not_sent", reason: "deadline" };
    }
    st.dispatch = kind === "note" ? "NOTE_SENDING" : "FIELDS_SENDING";
    const reply = kind === "note"
      ? await ghlCall(t, "POST", `/contacts/${encodeURIComponent(b.op.target.contactId)}/notes`, { body: renderEvidence({ opId: b.opId, admittedAt: b.op.admittedAt }, p) })
      : await ghlCall(t, "PUT", `/opportunities/${encodeURIComponent(b.op.target.opportunityId)}`, { customFields: [
          { id: t.fieldIds.repairEstimate, field_value: p.total },
          { id: t.fieldIds.repairApprovalId, field_value: b.opId },
        ] });
    if (!isDefinite(reply.status)) { st.dispatch = "UNCERTAIN"; return { kind: "uncertain" }; }
    if (kind === "note") {
      const note = isPlainObject(reply.json) && isPlainObject(reply.json.note) ? reply.json.note : null;
      if (!note || !usableNoteId(note.id)) { st.dispatch = "NOTE_UNBOUND"; return { kind: "halted", reason: "created_note_id_unusable" }; }
      st.createdNoteId = note.id;
      st.dispatch = "NOTE_DEFINITE";
    } else {
      st.dispatch = "FIELDS_DEFINITE";
    }
    return { kind: "definite", status: reply.status as number };
  })();
}

/** Evidence note E(op, payload) to the admitted contact. Must come first; at most once. */
export function dispatchNote(admission: AdmissionHandle, transport: TargetTransport, payload: RepairPayload, ...extra: unknown[]): Promise<DispatchResult> {
  if (extra.length) return Promise.resolve({ kind: "refused", reason: "unexpected_argument" });
  return dispatchKind(admission, "note", transport, payload);
}
/** The two binding fields, one PUT, only after the note is DEFINITE; at most once; same transport. */
export function dispatchFields(admission: AdmissionHandle, payload: RepairPayload, ...extra: unknown[]): Promise<DispatchResult> {
  if (extra.length) return Promise.resolve({ kind: "refused", reason: "unexpected_argument" });
  return dispatchKind(admission, "fields", undefined, payload);
}

// --------------------------------------------------------------- verifier ---

type Observed = { observedId: string; observedTotal: number; noteId: string };

/**
 * r5.1 §2: one GET of the exact note, classified per K1. 404 is reported as
 * not_found (undocumented status; the caller decides: verifier = R1 retry
 * trigger, reader = evidence_unavailable). Any other non-200 / thrown /
 * timeout / 3xx, a non-object body, or a missing or malformed note, id,
 * contactId or body -> unreadable. A present, well-formed but unequal id or
 * contactId -> mismatch. The path is built only from module state.
 */
type NoteRead = { kind: "ok"; body: string } | { kind: "not_found" } | { kind: "unreadable" } | { kind: "mismatch" };
async function readNoteById(t: TransportConfig, contactId: string, noteId: string, gate: ReadGate): Promise<NoteRead> {
  const r = await ghlCall(t, "GET", `/contacts/${encodeURIComponent(contactId)}/notes/${encodeURIComponent(noteId)}`, undefined, gate);
  if (r.status === 404) return { kind: "not_found" };
  if (r.status !== 200) return { kind: "unreadable" };
  const n = isPlainObject(r.json) && isPlainObject(r.json.note) ? r.json.note : null;
  if (!n || !usableNoteId(n.id) || !wellFormedId(n.contactId) || typeof n.body !== "string") return { kind: "unreadable" };
  if (n.id !== noteId || n.contactId !== contactId) return { kind: "mismatch" };
  return { kind: "ok", body: n.body };
}
type PassOutcome = { kind: "match"; observed: Observed } | { kind: "missing"; reason: string } | { kind: "terminal"; reason: string };

/**
 * One complete pass: strong read A -> Opportunity read -> by-ID note read at
 * the created id -> strong read A. Pure-missing (r5.1 K2, one shared budget):
 * zero entries for a binding field (missing_field) and/or a 404 for the
 * created note (missing_evidence), with nothing else contradicting.
 */
async function verifyPass(b: Binding, t: TransportConfig, p: RepairPayload, createdNoteId: string | null): Promise<PassOutcome> {
  if (!usableNoteId(createdNoteId)) return { kind: "terminal", reason: "mismatch" }; // unreachable: FIELDS_DEFINITE implies a bound id
  // Every read in a pass is limited to the deadline less the CLOSE reserve.
  const limitAt = readLimit(b.cfg, b.cfg.closeReserveMs);
  const gate = gateFor(b.cfg, b.cfg.closeReserveMs);
  const a1 = await readOwnAdmission(b, limitAt);
  if (a1.kind !== "ok") return { kind: "terminal", reason: a1.kind === "unreadable" ? "unreadable" : "authority_changed" };
  let missing: string | null = null;

  const opp = await ghlCall(t, "GET", `/opportunities/${encodeURIComponent(b.op.target.opportunityId)}`, undefined, gate);
  const o = opp.status === 200 && isPlainObject(opp.json) && isPlainObject(opp.json.opportunity) ? opp.json.opportunity : null;
  if (!o) return { kind: "terminal", reason: "unreadable" };
  if (o.id !== b.op.target.opportunityId || o.contactId !== b.op.target.contactId) return { kind: "terminal", reason: "mismatch" };
  const est = readExactlyOneField(o.customFields, t.fieldIds.repairEstimate, "number");
  const appr = readExactlyOneField(o.customFields, t.fieldIds.repairApprovalId, "string");
  for (const f of [est, appr]) {
    if (f.kind === "duplicate") return { kind: "terminal", reason: "duplicate_evidence" };
    if (f.kind === "ambiguous") return { kind: "terminal", reason: "mismatch" };
  }
  if (est.kind === "one" && est.value !== p.total) return { kind: "terminal", reason: "mismatch" };
  if (appr.kind === "one" && appr.value !== b.opId) return { kind: "terminal", reason: "mismatch" };
  if (est.kind === "none" || appr.kind === "none") missing = "missing_field";

  // r5.1: the evidence is read ONLY at the exact id this process's own definite create returned (N0).
  const nt = await readNoteById(t, b.op.target.contactId, createdNoteId, gate);
  if (nt.kind === "unreadable" || nt.kind === "mismatch") return { kind: "terminal", reason: nt.kind };
  if (nt.kind === "not_found") missing = missing ?? "missing_evidence"; // R1: a retry trigger, not proof of absence
  else {
    const e = parseEvidence(nt.body);
    if (!e) return { kind: "terminal", reason: "mismatch" };
    const pe = payloadDigest(e.payload);
    if (e.opId !== b.opId || e.admittedAt !== b.op.admittedAt || pe !== b.P || e.digestLine !== pe || pe !== payloadDigest(p)) return { kind: "terminal", reason: "mismatch" };
  }

  const a2 = await readOwnAdmission(b, limitAt);
  if (a2.kind !== "ok") return { kind: "terminal", reason: a2.kind === "unreadable" ? "unreadable" : "authority_changed" };
  if (missing) return { kind: "missing", reason: missing };
  return { kind: "match", observed: { observedId: b.opId, observedTotal: p.total, noteId: createdNoteId } };
}

type TokenRecord = { rec: AdmissionRecord; observed: Observed; mode: "ghl" | "fake"; used: boolean };
const tokens = new WeakMap<object, TokenRecord>();
export type VerificationToken = { readonly __verification: true };

export type VerifyResult =
  | { kind: "verified"; token: VerificationToken }
  | { kind: "pending"; reason: string; passes: number }
  | { kind: "hold"; reason: string }
  | { kind: "refused"; reason: string };

/**
 * Single-flight verification. Pending only for pure "missing" evidence after
 * BOTH dispatches were definite: at most 3 complete passes, each starting
 * within 10 s of the first. Anything else is terminal HOLD; after HOLD no
 * pass can run or mint a token.
 */
export function verifyRepairTarget(admission: AdmissionHandle, payload: RepairPayload, ...extra: unknown[]): Promise<VerifyResult> {
  if (extra.length) return Promise.resolve({ kind: "refused", reason: "unexpected_argument" });
  const rec = typeof admission === "object" && admission !== null ? admissions.get(admission) : undefined;
  if (!rec) return Promise.resolve({ kind: "refused", reason: "unknown_admission" });
  const { b, st } = rec;
  if (st.dispatch !== "FIELDS_DEFINITE") return Promise.resolve({ kind: "refused", reason: st.dispatch === "UNCERTAIN" ? "target_uncertain" : `state_${st.dispatch.toLowerCase()}` });
  if (st.verify === "HOLD") return Promise.resolve({ kind: "refused", reason: "held" });
  if (st.verify === "VERIFIED") return Promise.resolve({ kind: "refused", reason: "already_verified" });
  if (st.inFlight) return Promise.resolve({ kind: "refused", reason: "pass_in_flight" });
  const p = payloadForAdmission(b, payload);
  if (!p) { st.verify = "HOLD"; st.holdReason = "mismatch"; return Promise.resolve({ kind: "hold", reason: "mismatch" }); } // r1 A21: a payload not matching A is terminal
  const t = st.transport ? transports.get(st.transport) : undefined;
  if (!t) return Promise.resolve({ kind: "refused", reason: "unknown_transport" });
  if (!modesMatch(b.cfg, t)) return Promise.resolve({ kind: "refused", reason: "transport_mode_mismatch" }); // before any read
  const start = b.cfg.now();
  if (st.passes >= VERIFY_MAX_PASSES || (st.passes > 0 && start >= st.firstPassStart + VERIFY_WINDOW_MS)) {
    st.verify = "HOLD"; st.holdReason = "missing_after_window";
    return Promise.resolve({ kind: "hold", reason: "missing_after_window" });
  }
  st.passes += 1;
  if (st.passes === 1) st.firstPassStart = start;
  st.inFlight = true;
  return (async (): Promise<VerifyResult> => {
    let out: PassOutcome;
    try { out = await verifyPass(b, t, p, st.createdNoteId); } finally { st.inFlight = false; }
    if (out.kind === "terminal") { st.verify = "HOLD"; st.holdReason = out.reason; return { kind: "hold", reason: out.reason }; }
    if (out.kind === "missing") {
      const nextStartWouldFit = st.passes < VERIFY_MAX_PASSES && b.cfg.now() < st.firstPassStart + VERIFY_WINDOW_MS;
      if (!nextStartWouldFit) { st.verify = "HOLD"; st.holdReason = "missing_after_window"; return { kind: "hold", reason: "missing_after_window" }; }
      st.verify = "PENDING";
      return { kind: "pending", reason: out.reason, passes: st.passes };
    }
    if (st.dispatch !== "FIELDS_DEFINITE" || st.closed) { st.verify = "HOLD"; st.holdReason = "state_changed"; return { kind: "hold", reason: "state_changed" }; }
    const token = Object.freeze(Object.create(null)) as VerificationToken;
    tokens.set(token, { rec, observed: Object.freeze(out.observed), mode: t.mode, used: false });
    st.verify = "VERIFIED";
    return { kind: "verified", token };
  })();
}

// ------------------------------------------------------------------ CLOSE ---

export type CloseResult = { kind: "committed"; etag: string } | { kind: "refused"; reason: string } | { kind: "not_sent" } | { kind: "unreadable" } | { kind: "ambiguous" };

/** ADMITTED(op, eAdm) -> COMPLETED(op), single-use token only; op copied from its own strong read. */
export function closeVerified(token: VerificationToken, ...extra: unknown[]): Promise<CloseResult> {
  if (extra.length) return Promise.resolve({ kind: "refused", reason: "unexpected_argument" });
  const tk = typeof token === "object" && token !== null ? tokens.get(token) : undefined;
  if (!tk) return Promise.resolve({ kind: "refused", reason: "unknown_token" });
  if (tk.used) return Promise.resolve({ kind: "refused", reason: "token_used" });
  tk.used = true; // single use: consumed synchronously
  const { b, st } = tk.rec;
  if (st.closed || st.dispatch !== "FIELDS_DEFINITE" || st.verify !== "VERIFIED") return Promise.resolve({ kind: "refused", reason: "state_changed" });
  const t = st.transport ? transports.get(st.transport) : undefined;
  if (!t || t.mode !== tk.mode || !modesMatch(b.cfg, t)) return Promise.resolve({ kind: "refused", reason: "transport_mode_mismatch" });
  return (async (): Promise<CloseResult> => {
    const r = await strongRead(b.cfg, b.key, readLimit(b.cfg, writeCapMs(b.cfg))); // its CAS keeps its full cap
    if (r.kind === "unreadable") return { kind: "unreadable" };
    if (r.kind !== "present" || r.value.state !== "ADMITTED" || r.etag !== b.eAdm || r.value.op.opId !== b.opId || r.value.op.expectedResultHash !== b.P) return { kind: "refused", reason: "authority_changed" };
    const cur = r.value;
    const next: CompletedValue = {
      schema: 1, state: "COMPLETED", v: cur.v + 1, epoch: cur.epoch + 1, op: cur.op,
      completion: { observedId: tk.observed.observedId, observedTotal: tk.observed.observedTotal, noteId: tk.observed.noteId, verifiedAt: new Date().toISOString() },
      fencedOp: null, fencedAt: null,
    };
    const w = await conditionalWrite(b.cfg, b.key, canonicalJson(next), { onlyIfMatch: r.etag });
    switch (w.kind) {
      case "committed": st.closed = true; return { kind: "committed", etag: w.etag };
      case "conflict": return { kind: "refused", reason: "raced" };
      case "not_sent": return { kind: "not_sent" };
      case "ambiguous": return { kind: "ambiguous" };
    }
  })();
}

// ------------------------------------------------------- P-C abandonment ---

export type AbandonResult = { kind: "released"; etag: string } | { kind: "release_unknown" } | { kind: "refused"; reason: string } | { kind: "not_sent" } | { kind: "unreadable" };

/**
 * ADMITTED(op) -> IDLE{abandoned_undispatched}, only for an admission that has
 * not reached SENDING. Retirement is synchronous, before the first await, so
 * every reserved dispatch still waiting on D1 finds RETIRED at its send gate
 * and never sends. An ambiguous CAS reports release_unknown (A may be either
 * ADMITTED or IDLE; both are safe because no TARGET was or can be sent); it
 * is never retried, and the handle stays retired.
 */
export function abandonUndispatched(admission: AdmissionHandle, ...extra: unknown[]): Promise<AbandonResult> {
  if (extra.length) return Promise.resolve({ kind: "refused", reason: "unexpected_argument" });
  const rec = typeof admission === "object" && admission !== null ? admissions.get(admission) : undefined;
  if (!rec) return Promise.resolve({ kind: "refused", reason: "unknown_admission" });
  const { b, st } = rec;
  const allowed = st.dispatch === "NONE" || st.dispatch === "NOTE_RESERVED" || (st.dispatch === "HALTED_NOT_SENT" && st.haltedAt === "note");
  if (!allowed) return Promise.resolve({ kind: "refused", reason: `state_${st.dispatch.toLowerCase()}` });
  st.dispatch = "RETIRED"; // synchronous retirement, before any await
  return (async (): Promise<AbandonResult> => {
    const r = await strongRead(b.cfg, b.key, readLimit(b.cfg, writeCapMs(b.cfg))); // its CAS keeps its full cap
    if (r.kind === "unreadable") return { kind: "unreadable" };
    if (r.kind !== "present" || r.value.state !== "ADMITTED" || r.etag !== b.eAdm || r.value.op.opId !== b.opId) return { kind: "refused", reason: "authority_changed" };
    const cur = r.value;
    const next: IdleValue = { schema: 1, state: "IDLE", v: cur.v + 1, epoch: cur.epoch + 1, last: { opId: b.opId, outcome: "abandoned_undispatched" }, fencedOp: null, fencedAt: null };
    const w = await conditionalWrite(b.cfg, b.key, canonicalJson(next), { onlyIfMatch: r.etag });
    switch (w.kind) {
      case "committed": return { kind: "released", etag: w.etag };
      case "conflict": return { kind: "refused", reason: "raced" };
      case "not_sent": return { kind: "not_sent" };
      case "ambiguous": return { kind: "release_unknown" };
    }
  })();
}

// ------------------------------------------------------ cross-session reader ---

export type ReaderResult =
  | { kind: "checked"; text: string; checkedAt: string; total: number }
  | { kind: "needs_review"; text: string }
  | { kind: "not_verified"; reason: "evidence_mismatch" | "evidence_ambiguous" | "evidence_unavailable" | "record_changed" | "no_recorded_approval"; text: string; total: number | null }
  | { kind: "none" }
  | { kind: "refused"; reason: string };

function parseCompletion(c: Record<string, unknown>): Observed | null {
  if (!exactKeys(c, ["observedId", "observedTotal", "noteId", "verifiedAt"])) return null;
  if (!nonEmpty(c.observedId) || !nonEmpty(c.noteId) || !nonEmpty(c.verifiedAt) || canonicalCurrency(c.observedTotal) === null) return null;
  return { observedId: c.observedId, observedTotal: c.observedTotal as number, noteId: c.noteId };
}

/**
 * Point-in-time check, not an atomic Netlify/GHL snapshot, and never computed
 * OFFER READY: strong read A -> GHL evidence checks against A's own content
 * (exactly one entry per binding field; the note at the id recorded in
 * A.completion.noteId, on the admitted contact, parsed strictly, whose payload
 * hashes to A.op.expectedResultHash) -> final strong read A unchanged.
 */
export async function readRepairApproval(client: AuthorityClient, transport: TargetTransport, scope: string, opportunityId: string, ...extra: unknown[]): Promise<ReaderResult> {
  if (extra.length) return { kind: "refused", reason: "unexpected_argument" };
  const cfg = clientConfigs.get(client as object);
  const t = typeof transport === "object" && transport !== null ? transports.get(transport) : undefined;
  if (!cfg || !t || !nonEmpty(scope) || !nonEmpty(opportunityId)) return { kind: "refused", reason: "refused_input" };
  if (!modesMatch(cfg, t)) return { kind: "refused", reason: "transport_mode_mismatch" };
  const nv = (reason: "evidence_mismatch" | "evidence_ambiguous" | "evidence_unavailable" | "record_changed" | "no_recorded_approval", total: number | null = null): ReaderResult =>
    ({ kind: "not_verified", reason, text: READER_TEXT.notVerified, total });
  const key = authorityKey(scope);
  const a1 = await strongRead(cfg, key);
  if (a1.kind === "unreadable") return nv("evidence_unavailable");
  const opp = await ghlCall(t, "GET", `/opportunities/${encodeURIComponent(opportunityId)}`, undefined, gateFor(cfg, 0));
  const o = opp.status === 200 && isPlainObject(opp.json) && isPlainObject(opp.json.opportunity) ? opp.json.opportunity : null;

  if (a1.kind === "absent" || a1.value.state === "IDLE") {
    if (!o) return nv("evidence_unavailable");
    const est = readExactlyOneField(o.customFields, t.fieldIds.repairEstimate, "number");
    if (est.kind === "none") return { kind: "none" };
    if (est.kind !== "one") return nv("evidence_ambiguous");
    return nv("no_recorded_approval", est.value as number);
  }
  if (a1.value.state === "ADMITTED" || a1.value.state === "HELD_RECOVERY") return { kind: "needs_review", text: READER_TEXT.needsReview };

  const done = a1.value; // COMPLETED
  const op = done.op;
  const c = parseCompletion(done.completion);
  if (!c || op.target.opportunityId !== opportunityId) return nv("evidence_mismatch");
  if (!o) return nv("evidence_unavailable", c.observedTotal);
  if (o.id !== op.target.opportunityId || o.contactId !== op.target.contactId) return nv("evidence_mismatch", c.observedTotal);
  const est = readExactlyOneField(o.customFields, t.fieldIds.repairEstimate, "number");
  const appr = readExactlyOneField(o.customFields, t.fieldIds.repairApprovalId, "string");
  if (est.kind === "duplicate" || appr.kind === "duplicate" || est.kind === "ambiguous" || appr.kind === "ambiguous") return nv("evidence_ambiguous", c.observedTotal);
  if (est.kind === "none" || appr.kind === "none") return nv("evidence_mismatch", c.observedTotal);
  if (appr.value !== op.opId || est.value !== c.observedTotal || c.observedId !== op.opId) return nv("evidence_mismatch", c.observedTotal);

  // r5.1: only the note id CLOSE recorded for this op (N0); a 404 here is evidence_unavailable (no retry budget).
  if (!usableNoteId(c.noteId)) return nv("evidence_mismatch", c.observedTotal);
  const nt = await readNoteById(t, op.target.contactId, c.noteId, gateFor(cfg, 0));
  if (nt.kind === "not_found" || nt.kind === "unreadable") return nv("evidence_unavailable", c.observedTotal);
  if (nt.kind === "mismatch") return nv("evidence_mismatch", c.observedTotal);
  const e = parseEvidence(nt.body);
  if (!e) return nv("evidence_mismatch", c.observedTotal);
  const pe = payloadDigest(e.payload);
  if (pe !== op.expectedResultHash || e.digestLine !== pe || e.opId !== op.opId || e.admittedAt !== op.admittedAt
    || e.payload.opportunityId !== op.target.opportunityId || e.payload.contactId !== op.target.contactId || e.payload.operator !== op.operator
    || e.payload.total !== c.observedTotal) return nv("evidence_mismatch", c.observedTotal);

  const a2 = await strongRead(cfg, key);
  if (a2.kind !== "present" || a2.etag !== a1.etag) return nv("record_changed", c.observedTotal);
  const checkedAt = new Date().toISOString();
  return { kind: "checked", text: READER_TEXT.checked(checkedAt), checkedAt, total: c.observedTotal };
}
