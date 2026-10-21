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
 * classifyUncertainOpen, fenceUncertainOpen, labelHeldRecovery. There is
 * NO close, fence-anything or generic write: nothing here can turn ADMITTED,
 * IDLE, HELD_RECOVERY or an absent record into COMPLETED, nor move ADMITTED
 * or HELD_RECOVERY to an admissible state. TARGET (GHL) recovery is outside
 * this module's authority.
 *
 * Uncertain admissions return an opaque handle backed by a private,
 * process-local registry. Unknown, forged, copied, transferred or
 * post-restart handles are refused before any request; losing a handle never
 * clears the underlying uncertainty.
 *
 * What the offline tests of this module show is OUR behaviour against a fake
 * service. Provider guarantees (conditional-write atomicity, ETag
 * distinctness, status codes, strong-read freshness) are documented
 * capabilities or open assumptions, not proven here.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const AUTHORITY_STORE = "iaos-write-receipts";
const KEY_PREFIX = "repair-authority/";
const SIGNED_URL_ACCEPT = "application/json;type=signed-url";
const DEFAULT_TIMEOUT_MS = 10_000;
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------- values ---

export type AuthorityOp = {
  opId: string;
  nonce: string;
  operator: string;
  target: { opportunityId: string; contactId: string };
  preconditionDigest: string;
  expectedResultDigest: string;
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
  if (!isPlainObject(v) || !exactKeys(v, ["opId", "nonce", "operator", "target", "preconditionDigest", "expectedResultDigest", "admittedAt"])) return null;
  const t = v.target;
  if (!isPlainObject(t) || !exactKeys(t, ["opportunityId", "contactId"]) || !nonEmpty(t.opportunityId) || !nonEmpty(t.contactId)) return null;
  if (!nonEmpty(v.opId) || !nonEmpty(v.nonce) || !nonEmpty(v.operator) || !nonEmpty(v.admittedAt)) return null;
  if (typeof v.preconditionDigest !== "string" || !HEX64.test(v.preconditionDigest)) return null;
  if (typeof v.expectedResultDigest !== "string" || !HEX64.test(v.expectedResultDigest)) return null;
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

type ClientConfig = { siteID: string; token: string; apiURL: string | undefined; fetchImpl: typeof fetch; timeoutMs: number };
const clientConfigs = new WeakMap<object, ClientConfig>();

/** Opaque, frozen client. Config is held privately; nothing is readable from it. */
export type AuthorityClient = { readonly __authorityClient: true };

export function createAuthorityClient(options: { siteID: string; token: string; apiURL?: string; fetch?: typeof fetch; timeoutMs?: number }): AuthorityClient {
  if (!isPlainObject(options)) throw new Error("authority client: options required");
  const allowed = ["siteID", "token", "apiURL", "fetch", "timeoutMs"];
  if (Object.keys(options).some((k) => !allowed.includes(k))) throw new Error("authority client: unsupported option (edge or environment context is never accepted)");
  if (!nonEmpty(options.siteID) || !nonEmpty(options.token)) throw new Error("authority client: siteID and token are both required");
  if (options.apiURL !== undefined && !/^https?:\/\/[^/]+$/.test(options.apiURL)) throw new Error("authority client: apiURL must be an origin");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("authority client: invalid timeout");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("authority client: fetch unavailable");
  const client = Object.freeze({ __authorityClient: true as const });
  clientConfigs.set(client, { siteID: options.siteID, token: options.token, apiURL: options.apiURL, fetchImpl, timeoutMs });
  return client;
}

// ------------------------------------------------- single-attempt transport ---

type Attempt = { stage: "sign" | "blob"; status: number | null; threw: boolean; etag: string | null; suppressed: boolean };
const RETRYABLE = (status: number) => status === 429 || status >= 500 || status === 403;

/** One real sign request and at most one real blob request per operation. */
function recorder(cfg: ClientConfig) {
  const attempts: Attempt[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const accept = new Headers(init?.headers).get("accept");
    const stage: Attempt["stage"] = accept === SIGNED_URL_ACCEPT ? "sign" : "blob";
    if (attempts.some((a) => a.stage === stage)) {
      // A second request of the same stage would be an SDK retry: never sent.
      attempts.push({ stage, status: null, threw: false, etag: null, suppressed: true });
      return new Response(null, { status: 400 });
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
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
    } finally {
      clearTimeout(timer);
    }
  };
  return { attempts, fetch: f as typeof fetch };
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

async function strongRead(cfg: ClientConfig, key: string): Promise<ReadResult> {
  const rec = recorder(cfg);
  let got: { data: string; etag?: string } | null = null;
  let threw = false;
  try {
    got = (await storeFor(cfg, rec.fetch).getWithMetadata(key, { type: "text" })) as { data: string; etag?: string } | null;
  } catch { threw = true; }
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
  const rec = recorder(cfg);
  try { await storeFor(cfg, rec.fetch).set(key, text, condition); } catch { /* classified from the recorded attempts */ }
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

export type AdmissionIntent = { operator: string; opportunityId: string; contactId: string; preconditionDigest: string; expectedResultDigest: string };
export type OpenResult =
  | { kind: "committed"; opId: string; etag: string }
  | { kind: "refused"; reason: string }
  | { kind: "not_sent" }
  | { kind: "unreadable" }
  | { kind: "ambiguous"; handle: UncertainOpenHandle };

/** absent | IDLE | COMPLETED -> ADMITTED(op). Never from ADMITTED or HELD_RECOVERY; never retried. */
export async function openAdmission(client: AuthorityClient, scope: string, intent: AdmissionIntent): Promise<OpenResult> {
  const cfg = clientConfigs.get(client as object);
  if (!cfg || !nonEmpty(scope)) return { kind: "refused", reason: "refused_input" };
  if (!isPlainObject(intent) || !exactKeys(intent, ["operator", "opportunityId", "contactId", "preconditionDigest", "expectedResultDigest"])) return { kind: "refused", reason: "refused_input" };
  if (!nonEmpty(intent.operator) || !nonEmpty(intent.opportunityId) || !nonEmpty(intent.contactId)) return { kind: "refused", reason: "refused_input" };
  if (!HEX64.test(String(intent.preconditionDigest)) || !HEX64.test(String(intent.expectedResultDigest))) return { kind: "refused", reason: "refused_input" };
  const key = authorityKey(scope);
  const r = await strongRead(cfg, key);
  if (r.kind === "unreadable") return { kind: "unreadable" };
  if (r.kind === "present" && (r.value.state === "ADMITTED" || r.value.state === "HELD_RECOVERY")) return { kind: "refused", reason: "scope_blocked" };
  const prev = r.kind === "present" ? r.value : null;
  const op: AuthorityOp = {
    opId: randomUUID(),
    nonce: randomBytes(16).toString("hex"),
    operator: intent.operator,
    target: { opportunityId: intent.opportunityId, contactId: intent.contactId },
    preconditionDigest: intent.preconditionDigest,
    expectedResultDigest: intent.expectedResultDigest,
    admittedAt: new Date().toISOString(),
  };
  const next: AdmittedValue = { schema: 1, state: "ADMITTED", v: (prev?.v ?? 0) + 1, epoch: (prev?.epoch ?? 0) + 1, op };
  const text = canonicalJson(next);
  const precondition = r.kind === "present"
    ? { kind: r.value.state as "IDLE" | "COMPLETED", etag: r.etag }
    : { kind: "absent" as const, etag: null };
  const w = await conditionalWrite(cfg, key, text, r.kind === "present" ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
  switch (w.kind) {
    case "committed": return { kind: "committed", opId: op.opId, etag: w.etag };
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
  const r = await strongRead(cfg, rec.key);
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
  const r = await strongRead(cfg, key);
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
