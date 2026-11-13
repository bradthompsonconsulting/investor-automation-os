/**
 * SECURITY -- B15-29 (INV-137) one IAOS sign-in: server-side session authority and acknowledged Sign out
 * (design r5 "conditional-write authority", lifetime per r6 "fixed 30-day session"; Bones rulings: Variant S, C1,
 * revoke-only handle, acknowledged Sign out, H2 authority binding + restore epoch). INERT while one IAOS sign-in is
 * off (`oneLoginActiveFor(IAOS_ENV)` false in BOTH committed configs): every exported refusal helper then returns
 * null before any I/O, so callers behave exactly as before.
 *
 * TRANSPORT. The platform's own per-invocation Lambda context: `connectLambda(event)` then
 * `getStore({ name: <store>, fetch: <recorder> })` -- the same path as the claimWrite receipts, the call-log /
 * Current Offer barriers and the supplemental-read budget. No API token and no site-id / token environment variables
 * exist for this module (r5 removed IAOS_SESSION_REVOCATION_SITE_ID / _TOKEN).
 *
 * TWO STORES (r5 of this module, Bones HOLD on 3311102 -- restore containment by STRUCTURAL EXCLUSION):
 *   session records  REVOCATION_STORE        "iaos-write-receipts" (restorable, like every receipt in it)
 *   authority anchor SESSION_AUTHORITY_STORE, key `authority` (declared below). NEVER restored (runbook section 6):
 *                    a restore of the session store cannot write, revert or reopen the anchor. Anchor bytes left at
 *                    the r4 key in the session store are IGNORED -- no code path names that key any more. Loss or
 *                    suspected compromise of the authority store = provision a NEW anchor with a new never-reused
 *                    epoch; until then the anchor is absent -> every sign-in unavailable, every check refused.
 *   Every anchor request goes through `onceAuthority`; every session request through `once`. Neither can address the
 *   other's store.
 *
 * AUTHORITY COMES ONLY FROM CONDITIONAL WRITES EVALUATED AT THE STORE'S ORIGIN. A read is never used to authorize.
 * Records (canonical JSON, keys sorted, no timestamps, so identical content is byte-identical):
 *   session record   session/<sha256(env:sid)>
 *                    {"env","epoch","kind":"iaos-session","sidDigest","state":"active"|"revoked","v":1}
 *   authority anchor the one anchor key declared below, in the separate authority store (the only such literals in
 *                    the code base)
 *                    {"env","epoch","kind":"iaos-session-revocation-authority","siteID","state":"open"|"closed","v":1}
 *                    r4 (H2 restore containment): "state" is REQUIRED -- an anchor without it is invalid (sign-in
 *                    unavailable). "closed" refuses every sign-in (503) and, because its bytes differ from the open
 *                    bytes every session is bound to, every check (412 -> revoked). Only an operator closes or
 *                    reopens it (runbook section 6); reopening always installs a NEW epoch.
 *                    OPERATOR-PROVISIONED. No code path creates it, changes its content or deletes it: the only
 *                    requests that name it are one read (sign-in) and `If-Match` re-writes of the SAME canonical
 *                    bytes (they succeed only where those bytes are already current at origin, and then change
 *                    nothing). See docs/B15-29_SESSION_REVOCATION_RUNBOOK.md.
 * Operations (each one bounded by ONE deadline; each request is ONE recorded attempt):
 *   sign-in  pin check; read the anchor and validate it; re-write the identical anchor bytes onlyIfMatch <read
 *            etag> (200 only -> aetag); create the session record onlyIfNew (200 only -> setag). Anything else:
 *            unavailable, no session.
 *   check    IN PARALLEL: identical active session bytes onlyIfMatch setag, and identical anchor bytes onlyIfMatch
 *            aetag. Both 200 -> active. Either 412 -> revoked (signed out, epoch rotated, store changed or restored
 *            without the anchor; never "absent"). Anything else, or late -> unavailable.
 *   sign-out the revoked bytes UNCONDITIONALLY (status + response etag E_r), then a write-based readback: the same
 *            revoked bytes onlyIfMatch E_r. Acknowledged only if both answered 200.
 * Decisions come from this module's own record of the raw HTTP status and ETag of the single real attempt, never
 * from the SDK's `modified` (@netlify/blobs 11.1.0 reports any non-412 conditional result as modified). An SDK retry
 * is answered with a synthetic non-retryable 400 and never sent. A request is not started with less than
 * MIN_START_MS left; a started one is aborted at min(STAGE_CAP_MS, deadline); the operation returns at the deadline
 * even if a transport ignores abort, and an answer that arrives after the deadline grants nothing.
 *
 * Authority binding (Bones H2, kept from r2): IAOS_ENV must be exactly test|production; the request must carry
 * exactly one x-nf-site-id equal to that environment's PINNED site (shared/ghl-config.ts SESSION_REVOCATION_SITE_IDS)
 * -- it is also the site id connectLambda gives the SDK; the anchor must be valid for this env and pinned site. A
 * session is bound to the anchor's epoch (restore rotation: the operator writes a new epoch, so every older
 * session's anchor If-Match fails -> revoked).
 *
 * Lifetime (r6): 30 days fixed from sign-in, never extended (lib/app-read-auth.ts ONE_LOGIN_SESSION_SECONDS).
 * Authorization (r6) is a separate seam, lib/authorization.ts, evaluated on every protected request in addition.
 *
 * What the offline tests show is OUR behaviour against a fake Blob service. Provider behaviour (U1 content-addressed
 * ETags for identical bytes, U2 origin evaluation of If-Match / If-None-Match through the Lambda edge context, U3
 * latency / cost, U4 x-nf-site-id presence) is an open live gate, not proven here.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { connectLambda, getStore } from "@netlify/blobs";
import { oneLoginActiveFor, SESSION_REVOCATION_SITE_IDS } from "../../../shared/ghl-config";
import {
  ONE_LOGIN_SESSION_SECONDS, READ_AUTH_REFUSED, READ_AUTH_UNCONFIGURED, ReadAuthUnconfigured, appReadConfig, cookieHasOneLoginBinding, isCanonicalEpoch,
  isCanonicalEtag, isCanonicalSid, readSessionToken, verifyReadSession, type ReadAuthConfig,
} from "./app-read-auth";
import { appWriteSessionBinding, bearerHasOneLoginBinding } from "./app-write-auth";
import { authorize } from "./authorization";
import { RUNTIME_SITE_HEADER, headerValues, runtimeSiteIs } from "./runtime-site";

/**
 * The EXISTING receipts store -- the same name as blob-authority.ts's AUTHORITY_STORE (asserted equal by the server
 * suite). Not imported: blob-authority also carries the GHL transport, and this module must not join the GHL-caller
 * import graph (test-supplemental-read-budget's inventory).
 */
export const REVOCATION_STORE = "iaos-write-receipts";
/**
 * The DEDICATED authority store: holds ONLY the anchor, is never in any restore scope, and is never named by any other
 * module. Same Lambda platform context as REVOCATION_STORE (no new credential).
 */
export const SESSION_AUTHORITY_STORE = "iaos-session-authority";
/** Deterministic JSON, object keys sorted at every level (the same rule as blob-authority's canonicalJson). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export const SESSION_UNAVAILABLE = "iaos-session-unavailable";
export const SIGNOUT_AUDIENCE = "iaos-app-signout";
export const HANDLE_EXTRA_SECONDS = 24 * 60 * 60;
const SESSION_PREFIX = "session/";
const SESSION_KIND = "iaos-session";
/** Candidate budgets (r4 §E), untested against deployed latency (live gate U3). */
export const CHECK_BUDGET_MS = 3_000;
export const SIGNIN_BUDGET_MS = 5_000;
export const SIGNOUT_BUDGET_MS = 5_000;
const STAGE_CAP_MS = 2_000;
const MIN_START_MS = 250;

type Deployment = "test" | "production";
const NO_STORE = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const respond = (statusCode: number, body: unknown) => ({ statusCode, headers: { ...NO_STORE }, body: JSON.stringify(body) });

// ------------------------------------------------------------------ setup ---

/* The ids themselves live in shared/ghl-config.ts (identifier boundary); this is the frozen per-deployment view. */
export const PINNED_REVOCATION_SITES: Readonly<Record<Deployment, string>> = Object.freeze({
  test: SESSION_REVOCATION_SITE_IDS.test,
  production: SESSION_REVOCATION_SITE_IDS.production,
});
/** The platform's runtime site id header (the one @netlify/blobs connectLambda reads); defined once, in lib/runtime-site.ts. */
export { RUNTIME_SITE_HEADER };
/**
 * The operator-provisioned authority anchor's key in SESSION_AUTHORITY_STORE. Never created, changed or deleted by
 * code (see the header). Only ever addressed through `onceAuthority`.
 */
const AUTHORITY_KEY = "authority";
const AUTHORITY_KIND = "iaos-session-revocation-authority";

export type RevocationSetup = { kind: "ready"; deployment: Deployment; siteID: string } | { kind: "not_configured"; reason: string };
/** IAOS_ENV only (no credential, no site-id variable); no I/O. Anything but exactly test|production is unbound. */
export function revocationSetup(env: NodeJS.ProcessEnv = process.env): RevocationSetup {
  const deployment = env.IAOS_ENV;
  if (deployment !== "test" && deployment !== "production") return { kind: "not_configured", reason: "environment_unbound" };
  return { kind: "ready", deployment, siteID: PINNED_REVOCATION_SITES[deployment] };
}

export type AnchorState = "open" | "closed";
/**
 * Strict parse of the anchor: exact canonical JSON for THIS env and its pinned site, with the REQUIRED state
 * ("open" | "closed"; r4). Returns the epoch and state, or null for anything else (an anchor without state included).
 */
export function parseAuthority(text: unknown, deployment: string): { epoch: string; state: AnchorState } | null {
  if (typeof text !== "string" || text.length > 1024) return null;
  if (deployment !== "test" && deployment !== "production") return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== "env,epoch,kind,siteID,state,v") return null;
  if (r.v !== 1 || r.kind !== AUTHORITY_KIND || r.env !== deployment || r.siteID !== PINNED_REVOCATION_SITES[deployment]) return null;
  if (r.state !== "open" && r.state !== "closed") return null;
  if (!isCanonicalEpoch(r.epoch)) return null;
  return canonicalJson(r) === text ? { epoch: r.epoch, state: r.state } : null;
}
/** The epoch of a valid OPEN anchor, or null (closed, invalid, or without state). */
export function authorityEpoch(text: unknown, deployment: string): string | null {
  const a = parseAuthority(text, deployment);
  return a && a.state === "open" ? a.epoch : null;
}
/** The OPEN anchor's canonical bytes for this env + epoch (equal to a valid open anchor's stored bytes). */
function anchorBytes(deployment: Deployment, epoch: string): string {
  return canonicalJson({ env: deployment, epoch, kind: AUTHORITY_KIND, siteID: PINNED_REVOCATION_SITES[deployment], state: "open", v: 1 });
}

const sidDigest = (deployment: string, sid: string) => createHash("sha256").update(`${deployment}:${sid}`, "utf8").digest("hex");
export function sessionKey(deployment: string, sid: string): string { return SESSION_PREFIX + sidDigest(deployment, sid); }
/** The canonical session record bytes. Identical inputs give byte-identical content (no timestamps). */
export function sessionRecordText(deployment: string, epoch: string, sid: string, state: "active" | "revoked"): string {
  return canonicalJson({ env: deployment, epoch, kind: SESSION_KIND, sidDigest: sidDigest(deployment, sid), state, v: 1 });
}

// ------------------------------------------------- single-attempt transport ---

type Clock = () => number;
type Ctx = { deployment: Deployment; fetchImpl: typeof fetch; now: Clock; deadline: number };
/** One recorded request: its raw status and response ETag, or why there is none. */
type Recorded = { status: number | null; etag: string | null; data: unknown; why: string | null };
type Store = ReturnType<typeof getStore>;

/**
 * Runs ONE store operation with a recorder as its fetch: exactly one real request (a second is answered with a
 * synthetic 400 and never sent; so is a request that would start with less than MIN_START_MS left), aborted at
 * min(STAGE_CAP_MS, deadline), the whole operation cut off at the deadline even if the transport ignores abort.
 * 200 / 404 / 412 reach the SDK unchanged; any other status or a throw is answered with a synthetic 400 so the SDK
 * neither sleeps nor retries. The caller decides ONLY from the returned record.
 */
async function attempt(ctx: Ctx, storeName: typeof REVOCATION_STORE | typeof SESSION_AUTHORITY_STORE, op: (store: Store) => Promise<unknown>, diag?: DiagSink): Promise<Recorded> {
  const attempts: { status: number | null; etag: string | null; threw: boolean }[] = [];
  let extra = false;
  let notStarted = false;
  const ac = new AbortController();
  let stageTimer: ReturnType<typeof setTimeout> | undefined;
  const recorder = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (attempts.length > 0 || notStarted) { extra = true; return new Response(null, { status: 400 }); }
    const left = ctx.deadline - ctx.now();
    if (left < MIN_START_MS) { notStarted = true; return new Response(null, { status: 400 }); }
    const stageEnd = ctx.now() + Math.min(STAGE_CAP_MS, left);
    stageTimer = setTimeout(() => ac.abort(), Math.min(STAGE_CAP_MS, left));
    try {
      const res = await ctx.fetchImpl(input, { ...init, signal: ac.signal });
      attempts.push({ status: res.status, etag: res.headers.get("etag"), threw: false });
      if (res.status === 200 || res.status === 404 || res.status === 412) return res;
      // Test probe only (G1: r2 R1, r3 T2): the raw record above is already fixed; a supplied sink starts a DETACHED,
      // bounded diagnostic that can never change it. Product callers never pass a sink and take the line below.
      if (diag) { startProbeDiag(diag, res, ctx, stageEnd); return new Response(null, { status: 400 }); }
      await res.arrayBuffer().catch(() => undefined);
      return new Response(null, { status: 400 });
    } catch {
      attempts.push({ status: null, etag: null, threw: true });
      return new Response(null, { status: 400 });
    }
  };
  let data: unknown;
  let sdkThrew = false;
  const late = Symbol("late");
  let cutoffTimer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<typeof late>((resolve) => { cutoffTimer = setTimeout(() => { ac.abort(); resolve(late); }, Math.max(0, ctx.deadline - ctx.now())); });
  const work = (async () => {
    try { data = await op(getStore({ name: storeName, fetch: recorder as typeof fetch })); } catch { sdkThrew = true; }
    return null;
  })();
  let out: unknown;
  try { out = await Promise.race([work, cutoff]); } finally { clearTimeout(cutoffTimer); clearTimeout(stageTimer); }
  const none = (why: string): Recorded => ({ status: null, etag: null, data: undefined, why });
  if (out === late) return none("deadline");
  if (notStarted) return none("deadline");
  if (extra || attempts.length !== 1) return none("attempts");
  if (attempts[0].threw) return none("transport");
  // Final caller check: an answer that arrives after the deadline grants nothing.
  if (ctx.now() > ctx.deadline) return none("deadline");
  return { status: attempts[0].status, etag: attempts[0].etag, data: sdkThrew ? undefined : data, why: null };
}
/** ONE request to the (restorable) SESSION store. Never used for the anchor. */
function once(ctx: Ctx, op: (store: Store) => Promise<unknown>): Promise<Recorded> { return attempt(ctx, REVOCATION_STORE, op); }
/** ONE request to the dedicated, never-restored AUTHORITY store: the only path to the anchor. */
function onceAuthority(ctx: Ctx, op: (store: Store) => Promise<unknown>): Promise<Recorded> { return attempt(ctx, SESSION_AUTHORITY_STORE, op); }

// ------------------------------- Test-probe-only bounded diagnostics (G1) ---
/*
 * Gate A r3 A1b (2026-11-13): three race losers answered 409, the provider's lost-race status (netlify/primitives
 * #820). Accepted method r1 + r2 + r3 + r4 (Bones): for a probe request whose raw status is not 200 / 404 / 412, record a
 * bounded, allowlisted classification -- never body text, a header value other than the two below, a URL, a cookie,
 * a token or an ETag. ONLY onceProbe (inside runAuthorityProbe) supplies a sink; every product path is unchanged.
 *  - The raw transport record is fixed BEFORE any diagnostic work; the diagnostic is detached and never alters it.
 *  - ONE absolute end time, fixed at response-header arrival: min(headers + DIAG_MAX_MS, the stage end,
 *    deadline - DIAG_RESERVE_MS). Every wait uses only the time remaining to it; nothing is ever restarted.
 *  - At most DIAG_MAX_BYTES are hashed (each chunk is cut BEFORE hashing); cancel is fire-and-forget, never awaited.
 *  - The result is frozen. A throw anywhere inside becomes body "error".
 * Limit: a diagnostic classifies an answer; it is not evidence that a losing write left the record untouched.
 */
const DIAG_MAX_BYTES = 4096;
const DIAG_MAX_MS = 250;
const DIAG_RESERVE_MS = 50;
const DIAG_RID = /^[0-9A-Z]{26}$/;
const DIAG_MEDIA = ["application/json", "text/plain", "application/xml", "text/html"] as const;
export type ProbeDiag = {
  req: number; status: number; class: "conflict_409" | "unexpected"; rid: string | null; ct: (typeof DIAG_MEDIA)[number] | "other" | null;
  bytes: number; sha256: string | null; body: "none" | "empty" | "complete" | "prefix" | "timeout" | "error" | "skipped_deadline";
};
type DiagSink = { req: number; end: number; finish: ((state: ProbeDiag["body"]) => ProbeDiag) | null; settled: Promise<ProbeDiag> | null };

function startProbeDiag(sink: DiagSink, res: Response, ctx: Ctx, stageEnd: number): void {
  try {
    const headersAt = ctx.now();
    sink.end = Math.min(headersAt + DIAG_MAX_MS, stageEnd, ctx.deadline - DIAG_RESERVE_MS);
    const ridRaw = res.headers.get("x-nf-request-id");
    const media = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const base = {
      req: sink.req, status: res.status, class: res.status === 409 ? "conflict_409" as const : "unexpected" as const,
      rid: ridRaw === null ? null : DIAG_RID.test(ridRaw) ? ridRaw : "invalid",
      ct: media === "" ? null : (DIAG_MEDIA as readonly string[]).includes(media) ? (media as (typeof DIAG_MEDIA)[number]) : "other" as const,
    };
    let bytes = 0;
    const hash = createHash("sha256");
    let result: ProbeDiag | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const finish = (state: ProbeDiag["body"]): ProbeDiag => {
      if (result) return result;
      clearTimeout(timer);
      let sha: string | null = null;
      try { sha = bytes > 0 ? hash.copy().digest("hex") : null; } catch { state = "error"; }
      result = Object.freeze({ ...base, bytes, sha256: sha, body: state });
      if (reader) { try { reader.cancel().catch(() => undefined); } catch { /* bounded: never awaited */ } }
      else { try { res.body?.cancel().catch(() => undefined); } catch { /* bounded */ } }
      return result;
    };
    sink.finish = finish;
    if (!res.body) { finish("none"); sink.settled = Promise.resolve(result as unknown as ProbeDiag); return; }
    if (sink.end - headersAt <= 0) { finish("skipped_deadline"); sink.settled = Promise.resolve(result as unknown as ProbeDiag); return; }
    reader = res.body.getReader();
    timer = setTimeout(() => finish("timeout"), Math.max(0, sink.end - ctx.now()));
    const r = reader;
    sink.settled = (async (): Promise<ProbeDiag> => {
      try {
        for (;;) {
          if (result) return result;
          if (ctx.now() >= sink.end) return finish("timeout");
          const next = await r.read();
          if (result) return result;
          if (next.done) return finish(bytes === 0 ? "empty" : "complete");
          if (!(next.value instanceof Uint8Array)) return finish("error");
          const room = DIAG_MAX_BYTES - bytes;
          const chunk = next.value.subarray(0, room);
          hash.update(chunk);
          bytes += chunk.length;
          if (next.value.length > room) return finish("prefix");
        }
      } catch { return finish("error"); }
    })();
  } catch {
    sink.finish = null;
    sink.settled = Promise.resolve(Object.freeze({ req: sink.req, status: res.status, class: res.status === 409 ? "conflict_409" : "unexpected", rid: null, ct: null, bytes: 0, sha256: null, body: "error" }) as ProbeDiag);
  }
}

/** Joins a started diagnostic, waiting at most the time REMAINING to its absolute end; never throws. */
async function joinProbeDiag(sink: DiagSink, ctx: Ctx): Promise<ProbeDiag | null> {
  if (!sink.settled) return null;
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const wait = Math.max(0, sink.end - ctx.now());
    const timedOut = new Promise<null>((resolve) => { t = setTimeout(() => resolve(null), wait); });
    const d = await Promise.race([sink.settled, timedOut]);
    if (d) return d;
    return sink.finish ? sink.finish("timeout") : null;
  } catch { return sink.finish ? sink.finish("error") : null; }
  finally { clearTimeout(t); }
}

/** The run deadline has passed (exact boundary: at the deadline counts as passed). Probe only. */
class ProbeRunDeadline extends Error {}
/** ONE request to the session store with a Test-probe diagnostic sink: the only caller passing a sink to attempt().
 *  The returned Recorded is attempt()'s own; the diagnostic is separate and frozen. Throws ProbeRunDeadline when the
 *  run deadline has been reached, before sending or after the answer (r3 T2 item 4, r4 U2). */
async function onceProbe(ctx: Ctx, req: number, op: (store: Store) => Promise<unknown>): Promise<{ r: Recorded; d: ProbeDiag | null }> {
  if (ctx.now() >= ctx.deadline) throw new ProbeRunDeadline("before");
  const sink: DiagSink = { req, end: 0, finish: null, settled: null };
  const r = await attempt(ctx, REVOCATION_STORE, op, sink);
  const d = await joinProbeDiag(sink, ctx);
  if (ctx.now() >= ctx.deadline) throw Object.assign(new ProbeRunDeadline("after"), { diag: d });
  return { r, d };
}

/** An If-Match re-write of the IDENTICAL canonical anchor bytes: the only anchor write in this module. */
function confirmAnchor(ctx: Ctx, epoch: string, etag: string): Promise<Recorded> {
  if (!isCanonicalEtag(etag)) return Promise.resolve({ status: null, etag: null, data: undefined, why: "etag" });
  return onceAuthority(ctx, (s) => s.set(AUTHORITY_KEY, anchorBytes(ctx.deployment, epoch), { onlyIfMatch: etag }));
}

type OpOpts = { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: Clock; budgetMs?: number; event?: any };

/** Environment binding + the platform's runtime site id + the Lambda Blobs context. A refusal reason, or a context. */
function context(env: NodeJS.ProcessEnv, deployment: string, budgetMs: number, opts: OpOpts): Ctx | { refused: string } {
  const setup = revocationSetup(env);
  if (setup.kind !== "ready") return { refused: setup.reason };
  if (setup.deployment !== deployment) return { refused: "environment_unbound" };
  // connectLambda reads exactly event.headers["x-nf-site-id"]: it must be that one value, and equal to the pin
  // (lib/runtime-site.ts runtimeSiteIs, the same rule the Test-only probe gate uses).
  if (!runtimeSiteIs(opts.event, setup.siteID)) return { refused: "runtime_site_mismatch" };
  try { connectLambda(opts.event); } catch { return { refused: "blob_context" }; }
  const now = opts.now ?? Date.now;
  // The global fetch is read at call time (never captured at module load).
  return { deployment: setup.deployment, fetchImpl: opts.fetch ?? globalThis.fetch, now, deadline: now() + budgetMs };
}

// -------------------------------------------------------------- operations ---

export type SessionGrant = { kind: "issued"; epoch: string; aetag: string; setag: string } | { kind: "unavailable"; reason: string };

/**
 * Sign-in (after Google verification): binds a NEW random sid to the current anchor at origin. Bounded by
 * SIGNIN_BUDGET_MS. Never throws. The anchor is read, then confirmed by re-writing its identical bytes.
 */
export async function beginSession(sid: string, deployment: string, opts: OpOpts = {}): Promise<SessionGrant> {
  if (!isCanonicalSid(sid) || (deployment !== "test" && deployment !== "production")) return { kind: "unavailable", reason: "refused_input" };
  const ctx = context(opts.env ?? process.env, deployment, opts.budgetMs ?? SIGNIN_BUDGET_MS, opts);
  if ("refused" in ctx) return { kind: "unavailable", reason: ctx.refused };
  // 1. Read the anchor (any consistency) from the AUTHORITY store. The read only FINDS the candidate; it authorizes
  // nothing. An absent anchor (authority store lost / never provisioned) is fail closed: no session.
  const read = await onceAuthority(ctx, (s) => s.getWithMetadata(AUTHORITY_KEY, { type: "text" }));
  if (read.why) return { kind: "unavailable", reason: read.why };
  if (read.status === 404) return { kind: "unavailable", reason: "authority_absent" };
  const text = (read.data as { data?: unknown } | null)?.data;
  if (read.status !== 200 || typeof text !== "string" || !read.etag) return { kind: "unavailable", reason: "authority_unreadable" };
  const authority = parseAuthority(text, deployment);
  if (!authority) return { kind: "unavailable", reason: "authority_invalid" };
  // r4: a CLOSED anchor (restore containment, runbook section 6) refuses every sign-in.
  if (authority.state !== "open") return { kind: "unavailable", reason: "authority_closed" };
  const epoch = authority.epoch;
  // 2. Only a 200 to an If-Match re-write of the identical bytes shows this anchor is current AT ORIGIN.
  const anchor = await confirmAnchor(ctx, epoch, read.etag);
  if (anchor.why || anchor.status !== 200 || !isCanonicalEtag(anchor.etag)) return { kind: "unavailable", reason: anchor.why ?? "authority_unconfirmed" };
  // 3. The session record, created only if new (a fresh random sid; 200 only).
  const created = await once(ctx, (s) => s.set(sessionKey(deployment, sid), sessionRecordText(deployment, epoch, sid, "active"), { onlyIfNew: true }));
  if (created.why || created.status !== 200 || !isCanonicalEtag(created.etag)) return { kind: "unavailable", reason: created.why ?? "session_not_created" };
  if (ctx.now() > ctx.deadline) return { kind: "unavailable", reason: "deadline" };
  return { kind: "issued", epoch, aetag: anchor.etag, setag: created.etag };
}

export type SessionBinding = { sid?: unknown; epoch?: unknown; aetag?: unknown; setag?: unknown };
export type SessionStatus = { kind: "active" } | { kind: "revoked" } | { kind: "unavailable"; reason: string };

/**
 * THE check (token mint, every protected reader and writer, status): two identical-bytes If-Match writes IN
 * PARALLEL under one CHECK_BUDGET_MS deadline. Both 200 -> active; either 412 -> revoked; else unavailable. Never throws.
 */
export async function checkSession(binding: SessionBinding, deployment: string, opts: OpOpts = {}): Promise<SessionStatus> {
  const { sid, epoch, aetag, setag } = binding;
  if (!isCanonicalSid(sid) || (deployment !== "test" && deployment !== "production") || !isCanonicalEpoch(epoch) ||
      !isCanonicalEtag(aetag) || !isCanonicalEtag(setag)) return { kind: "unavailable", reason: "refused_input" };
  const ctx = context(opts.env ?? process.env, deployment, opts.budgetMs ?? CHECK_BUDGET_MS, opts);
  if ("refused" in ctx) return { kind: "unavailable", reason: ctx.refused };
  const [session, anchor] = await Promise.all([
    once(ctx, (s) => s.set(sessionKey(deployment, sid), sessionRecordText(deployment, epoch, sid, "active"), { onlyIfMatch: setag })),
    confirmAnchor(ctx, epoch, aetag),
  ]);
  if (ctx.now() > ctx.deadline) return { kind: "unavailable", reason: "deadline" };
  // A precondition failure at origin is definitive: the bytes this session was bound to are no longer current there
  // (signed out, anchor closed / rotated, or the authority store's anchor absent).
  if (session.status === 412 || anchor.status === 412) return { kind: "revoked" };
  if (session.status === 200 && anchor.status === 200) return { kind: "active" };
  return { kind: "unavailable", reason: session.why ?? anchor.why ?? `status_${session.status}_${anchor.status}` };
}

export type RevokeResult = { kind: "verified" } | { kind: "unconfirmed"; reason: string };

/**
 * Sign out: the revoked bytes unconditionally, then the same bytes onlyIfMatch the first answer's ETag (a
 * write-based readback). Verified ONLY if both answered 200. Bounded by SIGNOUT_BUDGET_MS. Idempotent.
 */
export async function revokeSession(sid: string, epoch: string, deployment: string, opts: OpOpts = {}): Promise<RevokeResult> {
  if (!isCanonicalSid(sid) || !isCanonicalEpoch(epoch) || (deployment !== "test" && deployment !== "production")) return { kind: "unconfirmed", reason: "refused_input" };
  const ctx = context(opts.env ?? process.env, deployment, opts.budgetMs ?? SIGNOUT_BUDGET_MS, opts);
  if ("refused" in ctx) return { kind: "unconfirmed", reason: ctx.refused };
  const key = sessionKey(deployment, sid);
  const text = sessionRecordText(deployment, epoch, sid, "revoked");
  const written = await once(ctx, (s) => s.set(key, text));
  if (written.why || written.status !== 200 || !isCanonicalEtag(written.etag)) return { kind: "unconfirmed", reason: written.why ?? "revoke_not_written" };
  const back = await once(ctx, (s) => s.set(key, text, { onlyIfMatch: written.etag as string }));
  if (back.why || back.status !== 200) return { kind: "unconfirmed", reason: back.why ?? "revoke_not_current" };
  if (ctx.now() > ctx.deadline) return { kind: "unconfirmed", reason: "deadline" };
  return { kind: "verified" };
}

// ------------------------------------------------------------------ handle ---

const handleKey = (config: ReadAuthConfig) => createHmac("sha256", config.secret).update("iaos-app-signout-handle-key-v1").digest();
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/**
 * Issued only by app-read-session GET for an ACTIVE session in this tab's view. Carries the sid (the only target
 * it can revoke) and the session's epoch (the revoked record's bytes contain it).
 */
export function issueSignoutHandle(session: { sid: string; epoch: string; expiresAt: string }, config: ReadAuthConfig, now = Date.now()): string {
  if (!isCanonicalSid(session.sid)) throw new Error("Invalid session id");
  if (!isCanonicalEpoch(session.epoch)) throw new Error("Invalid session epoch");
  const parentExp = Math.floor(Date.parse(session.expiresAt) / 1000);
  if (!Number.isInteger(parentExp)) throw new Error("Invalid session expiry");
  const claims = { iss: "iaos", aud: SIGNOUT_AUDIENCE, env: config.deployment, sid: session.sid, epoch: session.epoch, iat: Math.floor(now / 1000), exp: parentExp + HANDLE_EXTRA_SECONDS };
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}`;
  return `${input}.${createHmac("sha256", handleKey(config)).update(input).digest("base64url")}`;
}

export class HandleRefused extends Error {}
/** Strict: fixed HS256, exact header and claim sets, audience, env, canonical sid + epoch, integer iat/exp, not expired. */
export function verifySignoutHandle(handle: unknown, config: ReadAuthConfig, now = Date.now()): { sid: string; epoch: string } {
  if (typeof handle !== "string" || handle.length > 1024) throw new HandleRefused("handle");
  const parts = handle.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new HandleRefused("handle");
  const expected = createHmac("sha256", handleKey(config)).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new HandleRefused("handle");
  let header: any, claims: any;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { throw new HandleRefused("handle"); }
  const seconds = Math.floor(now / 1000);
  if (!header || typeof header !== "object" || Object.keys(header).sort().join(",") !== "alg,typ" || header.alg !== "HS256" || header.typ !== "JWT") throw new HandleRefused("handle");
  if (!claims || typeof claims !== "object" || Object.keys(claims).sort().join(",") !== "aud,env,epoch,exp,iat,iss,sid") throw new HandleRefused("handle");
  if (claims.iss !== "iaos" || claims.aud !== SIGNOUT_AUDIENCE || claims.env !== config.deployment || !isCanonicalSid(claims.sid) || !isCanonicalEpoch(claims.epoch) ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > seconds + 30 || claims.exp <= seconds ||
      claims.exp - claims.iat > ONE_LOGIN_SESSION_SECONDS + HANDLE_EXTRA_SECONDS + 30) throw new HandleRefused("handle");
  return { sid: claims.sid, epoch: claims.epoch };
}

// ------------------------------------------------------- status view tags ---

/**
 * B15-29 r4 (R3-2): NON-SECRET tags for the status answer, so the page can tell a session replacement and an operator
 * change apart. Keyed HMACs (the read secret) truncated to 128 bits: equal inputs give equal tags; a tag reveals neither
 * the email nor the sid and is no credential (nothing accepts it).
 */
export function sessionViewTags(email: string, deployment: string, sid: string, config: ReadAuthConfig): { operator: string; session: string } {
  const tag = (label: string, value: string) => createHmac("sha256", config.secret).update(`${label}\u0000${value}`, "utf8").digest().subarray(0, 16).toString("base64url");
  return { operator: tag("iaos-operator-tag-v1", email), session: tag("iaos-session-tag-v1", `${deployment}:${sid}`) };
}

// ------------------------------------------------- same-site request shape ---

export const SESSION_REQUEST_HEADER = "x-iaos-session";
/** Sec-Fetch-Site same-origin when sent, plus exactly one X-IAOS-Session header with the endpoint's own value. */
export function requireSameSiteRequest(event: any, marker: string): void {
  const site = headerValues(event, "sec-fetch-site");
  if (site.length > 1 || (site.length === 1 && site[0] !== "same-origin")) throw new Error("Cross-site request refused");
  const custom = headerValues(event, SESSION_REQUEST_HEADER);
  if (custom.length !== 1 || custom[0] !== marker) throw new Error("Session request header required");
}

// --------------------------------------------------- per-request refusals ---

export function sessionUnavailableResponse() {
  return respond(503, { error: "IAOS can't confirm your sign-in right now", by: SESSION_UNAVAILABLE });
}

/** True for a session that carries everything the r5 check needs (sid, epoch and both store ETags). */
export function sessionBound(s: { sid?: unknown; epoch?: unknown; aetag?: unknown; setag?: unknown }): boolean {
  return isCanonicalSid(s.sid) && isCanonicalEpoch(s.epoch) && isCanonicalEtag(s.aetag) && isCanonicalEtag(s.setag);
}

/**
 * C1, every protected reader, AFTER its unchanged readAuthRefusal and before any upstream request or protected
 * data: session shape, then AUTHORIZATION (lib/authorization.ts, read), then the store check. Off -> null, no I/O.
 */
export async function sessionReadRefusal(event: any, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  // r4 (R3-1): off, a One-Login session cookie is refused here too (decode only, zero I/O; readAuthRefusal before
  // this already refuses it); any other cookie -> null, unchanged.
  if (!oneLoginActiveFor(env.IAOS_ENV)) return cookieHasOneLoginBinding(event) ? respond(401, { error: "Sign in to read IAOS data", by: READ_AUTH_REFUSED }) : null;
  let config: ReadAuthConfig;
  let session: { email: string; sid?: string; epoch?: string; aetag?: string; setag?: string };
  try { config = appReadConfig(env); session = verifyReadSession(readSessionToken(event), config, now); }
  catch (error) {
    if (error instanceof ReadAuthUnconfigured) return respond(503, { error: "Read sign-in is not configured for this site", by: READ_AUTH_UNCONFIGURED });
    return respond(401, { error: "Sign in to read IAOS data", by: READ_AUTH_REFUSED });
  }
  // A session from before one IAOS sign-in (no sid), or one not bound to the store (no epoch / ETags), cannot be
  // checked or revoked, so it is not accepted: one fresh sign-in (D6).
  if (!sessionBound(session)) return respond(401, { error: "Sign in to read IAOS data", by: READ_AUTH_REFUSED, reason: "sign_in_again" });
  const allowed = authorize({ sub: session.email, email: session.email }, "read", env);
  if (!allowed.ok) return respond(403, { error: "This account may not read IAOS data", by: READ_AUTH_REFUSED, reason: "not_authorized" });
  const r = await checkSession(session, config.deployment, { env, event });
  if (r.kind === "active") return null;
  if (r.kind === "revoked") return respond(401, { error: "Signed out of IAOS", by: READ_AUTH_REFUSED, reason: "revoked" });
  return sessionUnavailableResponse();
}

/**
 * Variant S, every business writer, AFTER its unchanged requireAppWriter and Origin checks and before any effect.
 * Each request is its own authorization unit: no "active" result is cached. Off -> null with no I/O.
 */
export async function sessionWriteRefusal(event: any, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const refused = (reason?: string) => respond(401, { error: "Application write sign-in required", by: "iaos-app-write-auth", ...(reason ? { reason } : {}) });
  // r4 (R3-1): off (a rollback), a One-Login-bound saving token is refused here as well as by requireAppWriter --
  // decode only, zero I/O, whatever its expiry, parent expiry, revocation or environment. Legacy tokens -> null.
  if (!oneLoginActiveFor(env.IAOS_ENV)) return bearerHasOneLoginBinding(event) ? refused("one_login_off") : null;
  let binding: ReturnType<typeof appWriteSessionBinding>;
  try { binding = appWriteSessionBinding(event, env, now); } catch { return refused(); }
  // Sid-less saving tokens (the retired popup issuer), tokens bound to another environment, and tokens without the
  // session's epoch and store ETags are refused: sign in again.
  if (!binding.sid || !isCanonicalSid(binding.sid) || binding.env !== env.IAOS_ENV || binding.pexp === null) return refused("sign_in_again");
  if (!isCanonicalEpoch(binding.epoch) || !isCanonicalEtag(binding.aetag) || !isCanonicalEtag(binding.setag)) return refused("sign_in_again");
  // The parent IAOS session has expired: the token never outlives it, even if its own 900 s have not run out.
  if (binding.pexp <= Math.floor(now / 1000)) return refused("session_expired");
  const allowed = authorize({ sub: binding.sub, email: binding.sub }, "write", env);
  if (!allowed.ok) return respond(403, { error: "This account may not save in IAOS", by: "iaos-app-write-auth", reason: "not_authorized" });
  const r = await checkSession(binding, binding.env, { env, event });
  if (r.kind === "active") return null;
  if (r.kind === "revoked") return refused("revoked");
  return sessionUnavailableResponse();
}

// --------------------------------------------- Test-only authority probe ---

/**
 * B15-29 P-1 (activation plan section 1; Jeff work order T1): the U1 / U2 / U4 conditional-write probe, through the SAME
 * Lambda-context transport the session authority uses (`context` -- environment, pinned site, connectLambda -- and
 * `once` -- one recorded request to the SESSION store). Test only: any deployment but "test" is refused here, and the
 * caller (session-authority-probe.ts) also refuses it before calling.
 *
 * It addresses ONLY keys `probe/<runId>/...` in REVOCATION_STORE (iaos-write-receipts). It never calls `onceAuthority`
 * (so never opens the authority store) and never builds a `session-revocation/` key. It never deletes (retention is
 * runbook section 7). It stops at the first unexpected answer, so a store that ignores conditions is reported as a
 * U1/U2 FAILURE, never as a pass. The transcript carries no ETag value, cookie, token or platform context -- only
 * statuses, `modified`, ETag-equality booleans and (per step `detail`) the racers' statuses and the winner's index.
 *
 * VERIFICATION IS BY CONDITIONAL WRITE, NEVER BY READ (Gate A A1a, 2026-11-12; Bones 25). Under connectLambda the
 * SDK (11.1.0) has no uncachedEdgeURL, so every read is an eventual edge read that can be up to 60 s stale, and a
 * strong read throws. Each "bytes are X at ETag E" check (a CONFIRM, Bones 26) therefore re-writes the identical
 * canonical bytes text(X) onlyIfMatch E and passes only on a raw 200 that answers exactly E. The two real transitions
 * (A -> winner, winner -> REVOKED) must answer a canonical, CHANGED ETag and are confirmed at once; after the revoke,
 * BOTH pre-revocation ETags (e1 with the old bytes, eW with the winner's bytes) must be refused. Requests per run:
 * 12 + concurrency (17 at N = 5), all conditional writes, no read; the bytes change exactly 3 times (create, one
 * winner, revoke). Proof limit (Bones 26): a confirm is evidence of matching origin state under the tested If-Match /
 * ETag semantics, not an independent byte read; a service that lies consistently about status and ETag is not ruled out.
 * Second proof limit (Bones, G1 r3 T1): final-state confirmation cannot detect an EARLIER rejected-but-applied write (a
 * loser reported 409 / 412 whose bytes were stored) that the acknowledged winner subsequently overwrote.
 *
 * RACE LOSERS (G1, Gate A r3 A1b; Bones accepted r1-r4): in step 5 every racer other than the single raw-200 winner
 * must answer a raw 409 (the provider's lost-race answer, netlify/primitives #820) or 412. Steps 2, 4 and 7 stay
 * STRICT 412. Every request goes through onceProbe: a bounded, allowlisted diagnostic (`detail.diag`, present only when
 * some request of the step answered a status other than 200 / 404 / 412) and a run-deadline guard -- at or after the
 * deadline no further request is sent and the run is ok:false (`failed: "run_deadline"`, `uncertain: "deadline"`).
 *
 * U3 timing (Bones REVISE P2 on the activation plan, Jeff 2026-11-10): every step carries `duration_ms`, measured on the
 * server with the monotonic clock (performance.now) around that step's Blob operations, and the run carries `total_ms`.
 * `ok` is true ONLY when every step ran and passed; a stopped run answers 200 with ok:false (the caller reads `ok`).
 * The deadline logic is unchanged (it still uses `now`); the monotonic clock only measures.
 */
export const PROBE_KEY_PREFIX = "probe/";
export const PROBE_RUN_ID = /^[A-Za-z0-9_-]{16,32}$/;
export const PROBE_MAX_CONCURRENCY = 10;
/** Safe diagnostics only (Bones 26 item 7; never an ETag value, token, signed URL or platform context): each confirmation's
 *  status and ETag match, the racers' statuses, winner count and index, the replays' statuses, ETag validity and change
 *  booleans, why a request had no answer (uncertain -- never read as not-applied), and the first failed assertion. */
export type ProbeDetail = {
  confirm?: { status: number | null; etagMatches: boolean | null } | null;
  racers?: (number | null)[]; winners?: number; winner?: number | null; replays?: (number | null)[];
  etagValid?: boolean; transitionEtagChanged?: boolean | null; uncertain?: string | null; failed?: string | null;
  diag?: ProbeDiag[];
};
export type ProbeStep = { n: number; op: string; status: number | null; etagChanged: boolean | null; modified: boolean | null; ok: boolean; duration_ms: number; detail?: ProbeDetail };
export type ProbeU4 = { present: boolean; single: boolean; lowercase: boolean; equalsPinned: boolean };
export type ProbeResult = { mode: "conditional-write"; runId: string; ok: boolean; steps: ProbeStep[]; stoppedAt: number | null; total_ms: number; u4: ProbeU4 };
const AUTHORITY_PROBE_STEPS = 7;
/** Monotonic milliseconds since `t0`, to 0.01 ms. Measures only; never used for a deadline. */
const elapsed = (t0: number): number => Math.round((performance.now() - t0) * 100) / 100;
function probeU4(event: any): ProbeU4 {
  const site = headerValues(event, RUNTIME_SITE_HEADER);
  return {
    present: site.length > 0,
    single: site.length === 1,
    lowercase: site.length === 1 && typeof site[0] === "string" && site[0] === (site[0] as string).toLowerCase(),
    equalsPinned: site.length === 1 && site[0] === PINNED_REVOCATION_SITES.test,
  };
}
/** The ONLY way a probe builds a key: probe/<runId>/<leaf>, and only for a valid runId and a fixed leaf. */
function probeKey(runId: string, leaf: "record" | "check-session" | "check-anchor"): string {
  if (!PROBE_RUN_ID.test(runId)) throw new Error("probe key refused");
  const key = `${PROBE_KEY_PREFIX}${runId}/${leaf}`;
  if (!key.startsWith(`${PROBE_KEY_PREFIX}${runId}/`)) throw new Error("probe key refused");
  return key;
}
export async function runAuthorityProbe(runId: string, deployment: string, opts: OpOpts & { concurrency?: number } = {}): Promise<ProbeResult | { refused: string }> {
  if (deployment !== "test") return { refused: "not_test" };
  if (typeof runId !== "string" || !PROBE_RUN_ID.test(runId)) return { refused: "refused_input" };
  const n = Math.min(PROBE_MAX_CONCURRENCY, Math.max(2, Math.floor(opts.concurrency ?? 5)));
  const u4 = probeU4(opts.event);
  const ctx = context(opts.env ?? process.env, "test", opts.budgetMs ?? 20_000, opts);
  if ("refused" in ctx) return { refused: ctx.refused };
  const key = probeKey(runId, "record");
  const tRun = performance.now();
  let tStep = tRun;
  const text = (label: string) => canonicalJson({ kind: "iaos-conditional-write-probe", label, runId, v: 1 });
  const steps: ProbeStep[] = [];
  const modifiedOf = (r: Recorded) => (r.data && typeof r.data === "object" && typeof (r.data as any).modified === "boolean" ? (r.data as any).modified : null);
  /* CONFIRM (Bones 26): the record's bytes are exactly text(label) and its current ETag is exactly `etag` -- re-write
     the identical canonical bytes onlyIfMatch `etag`; it passes ONLY on a raw 200 whose answer carries exactly `etag`.
     A 412, any other status, a missing / invalid / different ETag, a timeout, a transport or SDK failure, or a late
     answer fails it (closed). It is never retried, and an unanswered request is reported as uncertain, not as
     not-applied. Passing changes no bytes. */
  // Every request goes through onceProbe (G1): its Recorded is attempt()'s own; its diagnostic (if any) is collected
  // for the current step and never read by a predicate; at or after the run deadline it throws ProbeRunDeadline.
  let stepDiag: ProbeDiag[] = [];
  let reqN = 0;
  let curOp = "create onlyIfNew";
  const P = async (op: (store: Store) => Promise<unknown>): Promise<Recorded> => {
    const { r, d } = await onceProbe(ctx, reqN++, op);
    if (d) stepDiag.push(d);
    return r;
  };
  const confirm = async (label: string, etag: string) => {
    const r = await P((s) => s.set(key, text(label), { onlyIfMatch: etag }));
    return { ok: r.status === 200 && r.etag === etag, status: r.status, etagMatches: r.status === 200 ? r.etag === etag : null, why: r.why };
  };
  // A step's duration runs from the end of the previous step to this call: its write(s) and confirmation write(s).
  const step = (op: string, r: Recorded, ok: boolean, before?: string | null, detail?: ProbeDetail): boolean => {
    const d = detail && stepDiag.length ? { ...detail, diag: stepDiag } : detail;
    steps.push({ n: steps.length + 1, op, status: r.status, etagChanged: before === undefined ? null : before === null || r.etag === null ? null : before !== r.etag, modified: modifiedOf(r), ok, duration_ms: elapsed(tStep), ...(d ? { detail: d } : {}) });
    tStep = performance.now();
    stepDiag = [];
    reqN = 0;
    return ok;
  };
  /* Run deadline (r3 T2 item 4, r4 U2; exact boundary: at the deadline counts as passed): the current step fails with
     failed "run_deadline" / uncertain "deadline", nothing further is sent, and the run is ok:false. */
  const deadlineStep = (e: unknown): ProbeResult => {
    const d = e && typeof e === "object" && (e as any).diag ? (e as any).diag as ProbeDiag : null;
    if (d) stepDiag.push(d);
    const detail: ProbeDetail = { uncertain: "deadline", failed: "run_deadline", ...(stepDiag.length ? { diag: stepDiag } : {}) };
    steps.push({ n: steps.length + 1, op: curOp, status: null, etagChanged: null, modified: null, ok: false, duration_ms: elapsed(tStep), detail });
    stepDiag = [];
    return done();
  };
  const done = (): ProbeResult => {
    // Completion at or after the run deadline can never PASS: the last step is failed as run_deadline.
    if (ctx.now() >= ctx.deadline && steps.length > 0 && steps.every((s) => s.ok)) {
      const last = steps[steps.length - 1];
      last.ok = false;
      last.detail = { ...(last.detail ?? {}), uncertain: "deadline", failed: "run_deadline" };
    }
    const stoppedAt = steps.some((s) => !s.ok) ? steps.find((s) => !s.ok)!.n : null;
    return { mode: "conditional-write", runId, ok: stoppedAt === null && steps.length === AUTHORITY_PROBE_STEPS && ctx.now() < ctx.deadline, steps, stoppedAt, total_ms: elapsed(tRun), u4 };
  };
  /* The first failed assertion of a step, in order, or null; and `uncertain` = why some request of the step got no
     answer (deadline / transport / attempts). Safe diagnostics only: statuses, booleans, indices, names. */
  const firstFailed = (checks: [string, boolean][]) => { const f = checks.find(([, ok]) => !ok); return f ? f[0] : null; };
  const uncertainOf = (...rs: ({ status: number | null; why: string | null } | null)[]) => { const u = rs.find((x) => x && x.status === null); return u ? u.why ?? "no_answer" : null; };
  const conf = (c: { status: number | null; etagMatches: boolean | null } | null) => (c ? { status: c.status, etagMatches: c.etagMatches } : null);

  try {
    // 1. conditional create
    curOp = "create onlyIfNew";
    const created = await P((s) => s.set(key, text("A"), { onlyIfNew: true }));
    const f1 = firstFailed([["create_status_200", created.status === 200], ["create_etag_canonical", isCanonicalEtag(created.etag)]]);
    if (!step("create onlyIfNew", created, f1 === null, undefined, { etagValid: isCanonicalEtag(created.etag), uncertain: uncertainOf(created), failed: f1 })) return done();
    const e1 = created.etag as string;
    // 2. duplicate create refused (STRICT 412); the record is still exactly text("A") at e1
    curOp = "duplicate create refused";
    const dup = await P((s) => s.set(key, text("B"), { onlyIfNew: true }));
    const c2 = dup.status === 412 ? await confirm("A", e1) : null;
    const f2 = firstFailed([["duplicate_status_412", dup.status === 412], ["confirm_A_e1", c2 !== null && c2.ok]]);
    if (!step("duplicate create refused", dup, f2 === null, undefined, { confirm: conf(c2), uncertain: uncertainOf(dup, c2), failed: f2 })) return done();
    // 3. U1: identical bytes onlyIfMatch -> 200, ETag unchanged
    curOp = "identical bytes onlyIfMatch (U1)";
    const same = await P((s) => s.set(key, text("A"), { onlyIfMatch: e1 }));
    const f3 = firstFailed([["identical_status_200", same.status === 200], ["identical_etag_unchanged", same.etag === e1]]);
    if (!step("identical bytes onlyIfMatch (U1)", same, f3 === null, e1, { uncertain: uncertainOf(same), failed: f3 })) return done();
    // 4. U2: a non-current ETag refused (STRICT 412); the record is still exactly text("A") at e1
    curOp = "stale onlyIfMatch refused (U2)";
    const stale = await P((s) => s.set(key, text("C"), { onlyIfMatch: "\"iaos-probe-not-current\"" }));
    const c4 = stale.status === 412 ? await confirm("A", e1) : null;
    const f4 = firstFailed([["stale_status_412", stale.status === 412], ["confirm_A_e1", c4 !== null && c4.ok]]);
    if (!step("stale onlyIfMatch refused (U2)", stale, f4 === null, undefined, { confirm: conf(c4), uncertain: uncertainOf(stale, c4), failed: f4 })) return done();
    // 5. U2: N concurrent conflicting writers on the same ETag -> exactly one raw 200; every OTHER racer a raw 409 (the
    //    provider's lost-race answer, netlify/primitives #820) or 412; the winner's ETag is canonical and CHANGED
    //    (A -> W<i>); the record is then exactly text(W<i>) at that ETag. Any other loser status, an unanswered (null)
    //    loser, or 0 / >1 winners fails closed.
    curOp = `concurrent onlyIfMatch x${n}: exactly one winner (U2)`;
    const racers = await Promise.all(Array.from({ length: n }, (_, i) => onceProbe(ctx, i, (s) => s.set(key, text(`W${i}`), { onlyIfMatch: e1 }))
      .then(({ r, d }) => { if (d) stepDiag.push(d); return r; })));
    stepDiag.sort((a, b) => a.req - b.req);
    reqN = n;
    const winners = racers.map((r, i) => ({ r, i })).filter((x) => x.r.status === 200);
    const w = winners.length === 1 ? winners[0] : null;
    const losersOk = w !== null && racers.every((r, i) => i === w.i || r.status === 409 || r.status === 412);
    const eWValid = w !== null && isCanonicalEtag(w.r.etag);
    const eWChanged = w !== null && w.r.etag !== null ? w.r.etag !== e1 : null;
    const c5 = w !== null && losersOk && eWValid && eWChanged === true ? await confirm(`W${w.i}`, w.r.etag as string) : null;
    const f5 = firstFailed([["exactly_one_winner", winners.length === 1], ["losers_409_or_412", losersOk], ["winner_etag_canonical", eWValid], ["winner_etag_changed", eWChanged === true], ["confirm_winner_eW", c5 !== null && c5.ok]]);
    const raceDetail: ProbeDetail = { racers: racers.map((r) => r.status), winners: winners.length, winner: w ? w.i : null, etagValid: eWValid, transitionEtagChanged: eWChanged, confirm: conf(c5), uncertain: uncertainOf(...racers, c5), failed: f5 };
    if (!step(curOp, { status: winners.length === 1 ? 200 : null, etag: null, data: { modified: winners.length === 1 }, why: null }, f5 === null, undefined, raceDetail)) return done();
    const eW = (w as { r: Recorded; i: number }).r.etag as string;
    const wLabel = `W${(w as { r: Recorded; i: number }).i}`;
    // 6. U2: revoke onlyIfMatch eW -> raw 200, canonical ETag CHANGED (W<i> -> REVOKED); the record is then exactly
    //    text("REVOKED") at that ETag
    curOp = "revoke onlyIfMatch";
    const revoked = await P((s) => s.set(key, text("REVOKED"), { onlyIfMatch: eW }));
    const eRValid = isCanonicalEtag(revoked.etag);
    const eRChanged = revoked.status === 200 && revoked.etag !== null ? revoked.etag !== eW : null;
    const c6 = revoked.status === 200 && eRValid && eRChanged === true ? await confirm("REVOKED", revoked.etag as string) : null;
    const f6 = firstFailed([["revoke_status_200", revoked.status === 200], ["revoke_etag_canonical", eRValid], ["revoke_etag_changed", eRChanged === true], ["confirm_REVOKED_eR", c6 !== null && c6.ok]]);
    if (!step("revoke onlyIfMatch", revoked, f6 === null, eW, { etagValid: eRValid, transitionEtagChanged: eRChanged, confirm: conf(c6), uncertain: uncertainOf(revoked, c6), failed: f6 })) return done();
    const eR = revoked.etag as string;
    // 7. U2: every pre-revocation ETag is refused (STRICT 412) -- the old bytes with e1 and the winner's bytes with
    //    eW -- and the record is still exactly text("REVOKED") at eR
    curOp = "replay of old bytes with old ETag refused (U2)";
    const replay = await P((s) => s.set(key, text("A"), { onlyIfMatch: e1 }));
    const replayW = replay.status === 412 ? await P((s) => s.set(key, text(wLabel), { onlyIfMatch: eW })) : null;
    const c7 = replayW !== null && replayW.status === 412 ? await confirm("REVOKED", eR) : null;
    const f7 = firstFailed([["replay_e1_412", replay.status === 412], ["replay_eW_412", replayW !== null && replayW.status === 412], ["confirm_REVOKED_eR", c7 !== null && c7.ok]]);
    step("replay of old bytes with old ETag refused (U2)", replay, f7 === null, undefined, { replays: [replay.status, replayW ? replayW.status : null], confirm: conf(c7), uncertain: uncertainOf(replay, replayW, c7), failed: f7 });
    return done();
  } catch (e) {
    if (e instanceof ProbeRunDeadline) return deadlineStep(e);
    throw e;
  }
}

/**
 * B15-29 P-1 "check" mode (U3: is the 3 s check path real?). Times EXACTLY the shape of checkSession -- a fresh
 * context per sample (environment, pinned site, connectLambda) and TWO identical-byte onlyIfMatch writes IN PARALLEL
 * under one CHECK_BUDGET_MS deadline -- but on two probe records: probe/<runId>/check-session (session-record shaped)
 * and probe/<runId>/check-anchor (anchor shaped), both in REVOCATION_STORE. It never opens the authority store, never
 * builds a session or anchor key, never deletes. Setup: 2 onlyIfNew creates; then CHECK_PROBE_SAMPLES samples of 2
 * writes each (at most 12 writes per run). It stops at the first failed sample. Per sample: each write's status, whether
 * its ETag stayed the bound one (a boolean; never the value), its own duration, and the sample's duration (context +
 * both writes), all on the monotonic clock, plus `withinBudget`. ok:false whenever anything failed or ran over budget.
 *
 * Limit (stated, not hidden): the real anchor write goes to the authority store; this measures the same request shape
 * against iaos-write-receipts, so it bounds the transport and the parallel pair, not the authority store's own latency.
 */
export const CHECK_PROBE_SAMPLES = 5;
export type CheckWrite = { status: number | null; etagUnchanged: boolean | null; why: string | null; duration_ms: number };
export type CheckSample = { n: number; ok: boolean; withinBudget: boolean; duration_ms: number; session: CheckWrite; anchor: CheckWrite };
export type CheckProbeResult = {
  mode: "check-shape"; runId: string; ok: boolean; budget_ms: number; setup: ProbeStep[]; samples: CheckSample[];
  stoppedAt: { phase: "setup" | "sample"; n: number } | null; max_sample_ms: number | null; total_ms: number; u4: ProbeU4;
};
export async function runCheckShapeProbe(runId: string, deployment: string, opts: OpOpts & { checkBudgetMs?: number } = {}): Promise<CheckProbeResult | { refused: string }> {
  if (deployment !== "test") return { refused: "not_test" };
  if (typeof runId !== "string" || !PROBE_RUN_ID.test(runId)) return { refused: "refused_input" };
  const env = opts.env ?? process.env;
  const budget = opts.checkBudgetMs ?? CHECK_BUDGET_MS;
  const u4 = probeU4(opts.event);
  const setupCtx = context(env, "test", opts.budgetMs ?? 20_000, opts);
  if ("refused" in setupCtx) return { refused: setupCtx.refused };
  const tRun = performance.now();
  const sKey = probeKey(runId, "check-session");
  const aKey = probeKey(runId, "check-anchor");
  const sText = canonicalJson({ kind: "iaos-check-shape-probe", role: "session", runId, v: 1 });
  const aText = canonicalJson({ kind: "iaos-check-shape-probe", role: "anchor", runId, v: 1 });
  const setup: ProbeStep[] = [];
  const samples: CheckSample[] = [];
  const done = (stoppedAt: CheckProbeResult["stoppedAt"]): CheckProbeResult => ({
    mode: "check-shape", runId, budget_ms: budget, setup, samples, stoppedAt, u4, total_ms: elapsed(tRun),
    ok: stoppedAt === null && setup.length === 2 && samples.length === CHECK_PROBE_SAMPLES && samples.every((x) => x.ok),
    max_sample_ms: samples.length ? Math.max(...samples.map((x) => x.duration_ms)) : null,
  });
  const etags: string[] = [];
  for (const [i, key, text, label] of [[1, sKey, sText, "create session-shaped record onlyIfNew"], [2, aKey, aText, "create anchor-shaped record onlyIfNew"]] as const) {
    const t0 = performance.now();
    const r = await once(setupCtx, (st) => st.set(key, text, { onlyIfNew: true }));
    const ok = r.status === 200 && isCanonicalEtag(r.etag);
    setup.push({ n: i, op: label, status: r.status, etagChanged: null, modified: null, ok, duration_ms: elapsed(t0) });
    if (!ok) return done({ phase: "setup", n: i });
    etags.push(r.etag as string);
  }
  const [sTag, aTag] = etags;
  for (let i = 1; i <= CHECK_PROBE_SAMPLES; i++) {
    const t0 = performance.now();
    const ctx = context(env, "test", budget, opts);
    if ("refused" in ctx) {
      const none: CheckWrite = { status: null, etagUnchanged: null, why: ctx.refused, duration_ms: 0 };
      samples.push({ n: i, ok: false, withinBudget: false, duration_ms: elapsed(t0), session: none, anchor: none });
      return done({ phase: "sample", n: i });
    }
    const timedWrite = async (key: string, text: string, tag: string): Promise<CheckWrite> => {
      const w0 = performance.now();
      const r = await once(ctx, (st) => st.set(key, text, { onlyIfMatch: tag }));
      return { status: r.status, etagUnchanged: r.etag === null ? null : r.etag === tag, why: r.why, duration_ms: elapsed(w0) };
    };
    const [session, anchor] = await Promise.all([timedWrite(sKey, sText, sTag), timedWrite(aKey, aText, aTag)]);
    const duration = elapsed(t0);
    const withinBudget = duration <= budget && ctx.now() <= ctx.deadline;
    const ok = withinBudget && session.status === 200 && anchor.status === 200 && session.etagUnchanged === true && anchor.etagUnchanged === true;
    samples.push({ n: i, ok, withinBudget, duration_ms: duration, session, anchor });
    if (!ok) return done({ phase: "sample", n: i });
  }
  return done(null);
}
