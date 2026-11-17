/**
 * B15-29 D2 (design r1–r6, Bones ACCEPT 2026-11-17; Captain GO local implementation) -- ONE protected-request lane
 * per tab, active exactly when one IAOS sign-in is on (where every protected request runs the server session check:
 * an If-Match write to the session record and the shared anchor). With one sign-in off every call is a plain fetch.
 *
 *  - ONE request in flight: the session status, every GHL reader (readFetch), the saving-token mint and every
 *    One-Login write. Writes are taken before queued non-writes; FIFO within a class; never pre-empted.
 *  - Bounds: at most LANE_MAX_QUEUED queued; an entry is dispatched only while now < enqueuedAt + LANE_MAX_WAIT_MS
 *    (strict: at exactly 10 000 ms it is rejected, the tie goes to rejection). After dispatch, headers AND the body
 *    must complete within 12 000 ms (status / read / mint) or 20 000 ms (write); the caller settles at the deadline
 *    even when fetch or the body ignores abort (every stage races a lane timer; the body is read chunk by chunk).
 *  - LaneNotSent (an AppWriteSignInRequired): never dispatched -- definitive. LaneUncertain: dispatched, outcome
 *    unknown. No retries anywhere.
 *  - Writes: an unresolved record is persisted in sessionStorage (key UNRESOLVED_KEY, deliberately NOT under the
 *    operator-scoped "iaos." prefix) BEFORE fetch and read back; if that fails the write is not sent. The record is
 *    removed only by a definitive in-deadline response (classifyRelease, endpoint/action specific); otherwise it
 *    stays (Option C) and blocks every conflicting write: keys "contact:<id>" or "*", conflicts(a,b) = a==="*" ||
 *    b==="*" || a===b, checked at enqueue and again at dispatch. Survives reload, sign-out and sign-in.
 *  - laneReset(signed_out | replaced | unmounted) rejects every queued entry (never the in-flight one).
 * Every request keeps its own credentials and is authorized by the server independently; nothing is cached.
 * A2 (request-id resolution) is deliberately NOT exported or wired in this slice.
 */
import { AppWriteSignInRequired } from "./write-errors";
import { oneLoginActive } from "./one-login";
import { getRuntimeConfig } from "../../shared/ghl-config";

export type LaneKind = "status" | "read" | "mint" | "write";
export const LANE_MAX_QUEUED = 12;
export const LANE_MAX_WAIT_MS = 10_000;
export const LANE_READ_RESPONSE_MS = 12_000;
export const LANE_WRITE_RESPONSE_MS = 20_000;
export const UNRESOLVED_KEY = "iaosLane.unresolved.v1";

export type NotSentReason = "full" | "waited" | "signed_out" | "replaced" | "aborted" | "unmounted" | "uncertain_pending" | "persist_failed";
const NOT_SENT_TEXT: Record<NotSentReason, string> = {
  full: "Too many requests are waiting; nothing was sent. Try again.",
  waited: "This request waited too long and was not sent. Try again.",
  signed_out: "You signed out of IAOS on this page; nothing was sent.",
  replaced: "Your IAOS sign-in changed on this page; nothing was sent.",
  aborted: "This request was cancelled before it was sent.",
  unmounted: "This page closed before the request was sent.",
  uncertain_pending: "An earlier save for this record is unresolved. Check the record before saving again; nothing was sent.",
  persist_failed: "IAOS could not safely record this save before sending it; nothing was sent.",
};
/** Never dispatched: nothing reached the server. Every save coordinator already reads this type as "not sent". */
export class LaneNotSent extends AppWriteSignInRequired {
  readonly dispatched = false as const;
  constructor(readonly reason: NotSentReason) { super(`${NOT_SENT_TEXT[reason]} [${reason}]`); this.name = "LaneNotSent"; }
}
/** Dispatched; the outcome is unknown (the server may still be executing). Never retried. */
export class LaneUncertain extends Error {
  readonly dispatched = true as const;
  constructor(readonly reason: "timeout" | "network", readonly kind: LaneKind, readonly holdId: string | null) {
    super(kind === "write" ? "The save may or may not have reached IAOS; it is unresolved. Do not retry; check the record." : "The request did not complete in time.");
    this.name = "LaneUncertain";
  }
}

// ── unresolved-write records (sessionStorage) ──────────────────────────────────────────────────────────────────
export type UnresolvedRecord = { holdId: string; key: string; requestId: string | null; operation: string; createdAt: number; state: "dispatching" | "uncertain" };
type Stored = { v: 1; env: string; records: UnresolvedRecord[] };
const envId = (): string => { try { return String((getRuntimeConfig() as { locationId?: unknown }).locationId ?? ""); } catch { return ""; } };
const store = (): Storage | null => { try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; } };
/** The records, "unreadable" (the storage itself refused the read: earlier holds cannot be known), or "corrupt" (an
 *  unparseable stored value). Both fail closed as a wildcard hold; unreadable storage reports persist_failed. */
function readRecords(): UnresolvedRecord[] | "corrupt" | "unreadable" {
  const s = store(); if (!s) return [];
  let raw: string | null;
  try { raw = s.getItem(UNRESOLVED_KEY); } catch { return "unreadable"; }
  if (raw === null) return [];
  try {
    const v = JSON.parse(raw) as Stored;
    if (!v || v.v !== 1 || !Array.isArray(v.records)) return "corrupt";
    return v.env === envId() ? v.records : [];
  } catch { return "corrupt"; }
}
function writeRecords(records: UnresolvedRecord[]): boolean {
  const s = store(); if (!s) return false;
  const text = JSON.stringify({ v: 1, env: envId(), records } satisfies Stored);
  try { s.setItem(UNRESOLVED_KEY, text); return s.getItem(UNRESOLVED_KEY) === text; } catch { return false; }
}
const conflicts = (a: string, b: string) => a === "*" || b === "*" || a === b;
/** Why a write with this key may not be sent now, or null. */
function blocked(key: string): "uncertain_pending" | "persist_failed" | null {
  const r = readRecords();
  if (r === "unreadable") return "persist_failed";
  return r === "corrupt" || r.some((x) => conflicts(x.key, key)) ? "uncertain_pending" : null;
}
function setRecordState(holdId: string, state: "uncertain" | "remove"): void {
  const r = readRecords(); if (r === "corrupt" || r === "unreadable") return;
  writeRecords(state === "remove" ? r.filter((x) => x.holdId !== holdId) : r.map((x) => (x.holdId === holdId ? { ...x, state } : x)));
}

// ── write identity (r4 note 05) ────────────────────────────────────────────────────────────────────────────────
type WriteMeta = { key: string; requestId: string | null; operation: string; path: string; body: Record<string, unknown> | null };
const pathOf = (url: string) => url.replace(/^.*\/\.netlify\/functions\//, "").replace(/\?.*$/, "");
function parseBody(init: RequestInit): Record<string, unknown> | null {
  if (typeof init.body !== "string") return null;
  try { const v = JSON.parse(init.body); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
}
export function writeMeta(url: string, init: RequestInit): WriteMeta {
  const path = pathOf(url); const body = parseBody(init);
  const op = typeof body?.operation === "string" ? body.operation : typeof body?.action === "string" ? `${path}:${body.action}` : path;
  const requestId = typeof body?.requestId === "string" ? body.requestId : null;
  let key = "*";
  if (path === "ghl-write" && body && typeof body.operation === "string" && typeof body.targetId === "string" && body.targetId &&
      (body.operation.startsWith("contact.") || body.operation === "note.create")) key = `contact:${body.targetId}`;
  return { key, requestId, operation: op, path, body };
}

// ── r5/r6 release classifier: a definitive in-deadline response releases the lane hold ─────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exactlyError = (b: Record<string, unknown>, text: string) => Object.keys(b).length === 1 && b.error === text;
/** "release" only for a definitive answer to THIS request; everything else "retain". */
export function classifyRelease(path: string, req: Record<string, unknown> | null, status: number, text: string): "release" | "retain" {
  let b: unknown;
  try { b = JSON.parse(text); } catch { return "retain"; }
  if (!isObj(b)) return "retain";
  // Common pre-write refusals (each handler checks auth, origin and session before any action).
  if (status === 401 && exactlyError(b, "Application write sign-in required")) return "release";
  if (status === 403 && exactlyError(b, "Application write origin refused")) return "release";
  if (status === 401 && b.by === "iaos-app-write-auth") return "release";
  if (status === 503 && b.by === "iaos-session-unavailable") return "release";
  const action = typeof req?.action === "string" ? req.action : null;
  switch (path) {
    case "ghl-write": {
      if (b.outcome === "not_sent") return "release";
      if (status !== 200 || b.confirmed === false) return "retain";
      if (req?.operation === "note.create") {
        const nested = isObj(b.note) ? b.note.id : undefined; const top = b.id;
        const ok = (x: unknown) => typeof x === "string" && x.length > 0;
        if (nested !== undefined && top !== undefined) return ok(nested) && nested === top ? "release" : "retain";
        return ok(nested) || ok(top) ? "release" : "retain";
      }
      return b.confirmed === true ? "release" : "retain";
    }
    case "call-log-barrier":
      if (action === "begin") return (status === 200 && (b.state === "reserved" || b.state === "finished")) || (status === 409 && (b.state === "held" || b.state === "in_progress")) ? "release" : "retain";
      if (action === "resume" || action === "retry") return (status === 200 && typeof b.state === "string") || (status === 409 && b.state === "in_progress") ? "release" : "retain";
      return "retain";
    case "current-offer-barrier":
      if (action === "begin") return (status === 200 && b.state === "reserved") || (status === 409 && (b.state === "blocked" || b.state === "in_progress")) ? "release" : "retain";
      if (action === "reconcile") return (status === 200 && (b.state === "clear" || b.state === "blocked")) || (status === 409 && b.state === "in_progress") ? "release" : "retain";
      return "retain";
    case "repair-approval-save":
      return b.outcome === "verified" || b.outcome === "blocked" || b.outcome === "not_sent" ? "release" : "retain";
    case "property-answer":
      if (action === "close") return (status === 200 && b.outcome === "closed" && typeof b.message === "string") || (status === 403 && typeof b.code === "string") ? "release" : "retain";
      return "retain";
    case "ghl-contract-send-readback":
      return status === 200 && "signerCompletion" in b && "buyerIdentity" in b ? "release" : "retain";
    case "generate-contract-pdf":
      return status === 200 && typeof b.pdfBase64 === "string" && isObj(b.evidence) ? "release" : "retain";
    case "ghl-executed-artifact-upload":
      return status >= 200 && status < 300 ? "release" : "retain";
    default:
      return "retain";
  }
}

// ── the lane ──────────────────────────────────────────────────────────────────────────────────────────────────────
type Entry = {
  kind: LaneKind; url: string; init: RequestInit; enqueuedAt: number; epoch: number;
  meta: WriteMeta | null; beforeDispatch?: () => void;
  resolve: (r: Response) => void; reject: (e: unknown) => void; done: boolean; waitTimer: ReturnType<typeof setTimeout> | null;
};
const queue: Entry[] = [];
let live: Entry | null = null;
let epoch = 0;
let paused = false;
let abandoned = 0;

function settle(e: Entry, ok: Response | null, err?: unknown) {
  if (e.done) return;
  e.done = true;
  if (e.waitTimer) clearTimeout(e.waitTimer);
  if (ok) e.resolve(ok); else e.reject(err);
}
function dropQueued(e: Entry, reason: NotSentReason) {
  const i = queue.indexOf(e); if (i >= 0) queue.splice(i, 1);
  settle(e, null, new LaneNotSent(reason));
}
function takeNext(): Entry | undefined {
  const w = queue.findIndex((x) => x.kind === "write");
  const i = w >= 0 ? w : 0;
  return queue.splice(i, 1)[0];
}

function pump(): void {
  while (!live && queue.length) {
    const e = takeNext()!;
    // Dispatch checks, in order; any failure: not sent, take the next entry.
    if (e.epoch !== epoch) { settle(e, null, new LaneNotSent("replaced")); continue; }
    if (paused && e.kind !== "status") { settle(e, null, new LaneNotSent("signed_out")); continue; }
    if (e.init.signal?.aborted) { settle(e, null, new LaneNotSent("aborted")); continue; }
    if (Date.now() - e.enqueuedAt >= LANE_MAX_WAIT_MS) { settle(e, null, new LaneNotSent("waited")); continue; }
    let holdId: string | null = null;
    if (e.kind === "write" && e.meta) {
      { const why = blocked(e.meta.key); if (why) { settle(e, null, new LaneNotSent(why)); continue; } }
      try { e.beforeDispatch?.(); } catch (err) { settle(e, null, err instanceof AppWriteSignInRequired ? err : new LaneNotSent("aborted")); continue; }
      const r = readRecords();
      holdId = crypto.randomUUID();
      const rec: UnresolvedRecord = { holdId, key: e.meta.key, requestId: e.meta.requestId, operation: e.meta.operation, createdAt: Date.now(), state: "dispatching" };
      if (r === "corrupt" || r === "unreadable" || !writeRecords([...r, rec])) { settle(e, null, new LaneNotSent("persist_failed")); continue; }
    }
    if (e.waitTimer) { clearTimeout(e.waitTimer); e.waitTimer = null; }
    live = e;
    void dispatch(e, holdId);
  }
}

const TIMEOUT = Symbol("timeout");
const NULL_BODY = new Set([101, 204, 205, 304]);
async function dispatch(e: Entry, holdId: string | null): Promise<void> {
  const ms = e.kind === "write" ? LANE_WRITE_RESPONSE_MS : LANE_READ_RESPONSE_MS;
  const ctl = new AbortController();
  const outer = e.init.signal;
  const onOuterAbort = () => ctl.abort();
  outer?.addEventListener("abort", onOuterAbort);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<typeof TIMEOUT>((r) => { timer = setTimeout(() => r(TIMEOUT), ms); });
  let failure: "timeout" | "network" | null = null;
  let out: Response | null = null;
  try {
    const sent = fetch(e.url, { ...e.init, signal: ctl.signal });
    sent.catch(() => { /* a late rejection after the deadline is ignored */ });
    const res = await Promise.race([sent, deadline]);
    if (res === TIMEOUT) failure = "timeout";
    else {
      const body = await readBounded(res, deadline);
      if (body === TIMEOUT) failure = "timeout";
      else out = new Response(NULL_BODY.has(res.status) ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
  } catch { failure = "network"; }
  finally { if (timer) clearTimeout(timer); outer?.removeEventListener("abort", onOuterAbort); }
  if (failure) { try { ctl.abort(); } catch { /* courtesy only */ } }
  if (e.kind === "write" && holdId) {
    if (out) {
      const text = await out.clone().text();
      setRecordState(holdId, classifyRelease(e.meta!.path, e.meta!.body, out.status, text) === "release" ? "remove" : "uncertain");
    } else setRecordState(holdId, "uncertain");
  }
  if (!out && e.kind !== "write") abandoned += 1;
  live = null;
  if (out) settle(e, out); else settle(e, null, new LaneUncertain(failure ?? "network", e.kind, holdId));
  pump();
}

/** The whole body, read chunk by chunk under the same deadline (a body that never ends, or ignores cancel, cannot hold the caller). */
async function readBounded(res: Response, deadline: Promise<typeof TIMEOUT>): Promise<ArrayBuffer | typeof TIMEOUT> {
  if (!res.body) {
    const b = await Promise.race([res.arrayBuffer(), deadline]);
    return b;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = []; let n = 0;
  for (;;) {
    const step = await Promise.race([reader.read(), deadline]);
    if (step === TIMEOUT) { reader.cancel().catch(() => { /* courtesy only */ }); return TIMEOUT; }
    if (step.done) break;
    parts.push(step.value); n += step.value.byteLength;
  }
  const all = new Uint8Array(n); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return all.buffer;
}

/** fetch(), through the lane when one IAOS sign-in is on; a plain fetch otherwise. */
export function laneFetch(url: string, init: RequestInit, opts: { kind: LaneKind; beforeDispatch?: () => void }): Promise<Response> {
  if (!oneLoginActive()) return fetch(url, init);
  return new Promise<Response>((resolve, reject) => {
    const meta = opts.kind === "write" ? writeMeta(url, init) : null;
    const e: Entry = { kind: opts.kind, url, init, enqueuedAt: Date.now(), epoch, meta, beforeDispatch: opts.beforeDispatch, resolve, reject, done: false, waitTimer: null };
    if (init.signal?.aborted) { settle(e, null, new LaneNotSent("aborted")); return; }
    { const why = meta && blocked(meta.key); if (why) { settle(e, null, new LaneNotSent(why)); return; } }
    if (queue.length >= LANE_MAX_QUEUED) { settle(e, null, new LaneNotSent("full")); return; }
    queue.push(e);
    e.waitTimer = setTimeout(() => { if (!e.done && queue.includes(e)) dropQueued(e, "waited"); }, LANE_MAX_WAIT_MS);
    init.signal?.addEventListener("abort", () => { if (!e.done && queue.includes(e)) dropQueued(e, "aborted"); }, { once: true });
    pump();
  });
}

/** Sign-out start, a deliberate sign-in (generation replacement) or unmount: every queued entry is not sent. Never the in-flight one; records stay. */
export function laneReset(reason: "signed_out" | "replaced" | "unmounted"): void {
  epoch += 1;
  if (reason === "signed_out") paused = true;
  if (reason === "replaced") paused = false;
  for (const e of queue.splice(0)) settle(e, null, new LaneNotSent(reason));
}

/** Test-only view (no behaviour): queued kinds, the in-flight kind, epoch, paused, abandoned reads and the stored records. */
export function laneSnapshot() {
  return { queued: queue.map((e) => e.kind), live: live?.kind ?? null, epoch, paused, abandoned, records: readRecords() };
}
