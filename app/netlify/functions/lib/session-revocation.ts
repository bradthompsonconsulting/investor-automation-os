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
/** The platform's runtime site id header (the one @netlify/blobs connectLambda reads). */
export const RUNTIME_SITE_HEADER = "x-nf-site-id";
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
async function attempt(ctx: Ctx, storeName: typeof REVOCATION_STORE | typeof SESSION_AUTHORITY_STORE, op: (store: Store) => Promise<unknown>): Promise<Recorded> {
  const attempts: { status: number | null; etag: string | null; threw: boolean }[] = [];
  let extra = false;
  let notStarted = false;
  const ac = new AbortController();
  let stageTimer: ReturnType<typeof setTimeout> | undefined;
  const recorder = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (attempts.length > 0 || notStarted) { extra = true; return new Response(null, { status: 400 }); }
    const left = ctx.deadline - ctx.now();
    if (left < MIN_START_MS) { notStarted = true; return new Response(null, { status: 400 }); }
    stageTimer = setTimeout(() => ac.abort(), Math.min(STAGE_CAP_MS, left));
    try {
      const res = await ctx.fetchImpl(input, { ...init, signal: ac.signal });
      attempts.push({ status: res.status, etag: res.headers.get("etag"), threw: false });
      if (res.status === 200 || res.status === 404 || res.status === 412) return res;
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
  const runtime = headerValues(opts.event, RUNTIME_SITE_HEADER);
  // connectLambda reads exactly event.headers["x-nf-site-id"]: it must be that one value, and equal to the pin.
  if (runtime.length !== 1 || runtime[0] !== setup.siteID || opts.event?.headers?.[RUNTIME_SITE_HEADER] !== setup.siteID) return { refused: "runtime_site_mismatch" };
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
function headerValues(event: any, wanted: string): unknown[] {
  const found: unknown[] = [];
  for (const [name, value] of Object.entries(event?.headers ?? {})) if (name.toLowerCase() === wanted) found.push(value);
  for (const [name, values] of Object.entries(event?.multiValueHeaders ?? {})) {
    if (name.toLowerCase() === wanted) found.push(...(Array.isArray(values) ? values : [values]));
  }
  return [...new Set(found)];
}
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
 * runbook section 7). Writes per run: at most 4 + concurrency. It stops at the first unexpected answer, so a store that
 * ignores conditions is reported as a U1/U2 FAILURE, never as a pass. The transcript carries no ETag value, cookie,
 * token or platform context -- only statuses, `modified` and ETag-equality booleans.
 */
export const PROBE_KEY_PREFIX = "probe/";
export const PROBE_RUN_ID = /^[A-Za-z0-9_-]{16,32}$/;
export const PROBE_MAX_CONCURRENCY = 10;
export type ProbeStep = { n: number; op: string; status: number | null; etagChanged: boolean | null; modified: boolean | null; ok: boolean };
export type ProbeResult = {
  runId: string; steps: ProbeStep[]; stoppedAt: number | null;
  u4: { present: boolean; single: boolean; lowercase: boolean; equalsPinned: boolean };
};
export async function runAuthorityProbe(runId: string, deployment: string, opts: OpOpts & { concurrency?: number } = {}): Promise<ProbeResult | { refused: string }> {
  if (deployment !== "test") return { refused: "not_test" };
  if (typeof runId !== "string" || !PROBE_RUN_ID.test(runId)) return { refused: "refused_input" };
  const n = Math.min(PROBE_MAX_CONCURRENCY, Math.max(2, Math.floor(opts.concurrency ?? 5)));
  const site = headerValues(opts.event, RUNTIME_SITE_HEADER);
  const u4 = {
    present: site.length > 0,
    single: site.length === 1,
    lowercase: site.length === 1 && typeof site[0] === "string" && site[0] === (site[0] as string).toLowerCase(),
    equalsPinned: site.length === 1 && site[0] === PINNED_REVOCATION_SITES.test,
  };
  const ctx = context(opts.env ?? process.env, "test", opts.budgetMs ?? 20_000, opts);
  if ("refused" in ctx) return { refused: ctx.refused };
  const key = `${PROBE_KEY_PREFIX}${runId}/record`;
  const text = (label: string) => canonicalJson({ kind: "iaos-conditional-write-probe", label, runId, v: 1 });
  const steps: ProbeStep[] = [];
  const modifiedOf = (r: Recorded) => (r.data && typeof r.data === "object" && typeof (r.data as any).modified === "boolean" ? (r.data as any).modified : null);
  const read = async () => {
    const r = await once(ctx, (s) => s.getWithMetadata(key, { type: "text" }));
    return r.status === 200 && r.data && typeof r.data === "object" ? String((r.data as any).data) : null;
  };
  const step = (op: string, r: Recorded, ok: boolean, before?: string | null): boolean => {
    steps.push({ n: steps.length + 1, op, status: r.status, etagChanged: before === undefined ? null : before === null || r.etag === null ? null : before !== r.etag, modified: modifiedOf(r), ok });
    return ok;
  };
  const done = (): ProbeResult => ({ runId, steps, stoppedAt: steps.some((s) => !s.ok) ? steps.find((s) => !s.ok)!.n : null, u4 });
  // 1. conditional create
  const created = await once(ctx, (s) => s.set(key, text("A"), { onlyIfNew: true }));
  if (!step("create onlyIfNew", created, created.status === 200 && isCanonicalEtag(created.etag)) ) return done();
  const e1 = created.etag as string;
  // 2. duplicate create refused, bytes unchanged
  const dup = await once(ctx, (s) => s.set(key, text("B"), { onlyIfNew: true }));
  if (!step("duplicate create refused", dup, dup.status === 412 && (await read()) === text("A"))) return done();
  // 3. U1: identical bytes onlyIfMatch -> 200, ETag unchanged
  const same = await once(ctx, (s) => s.set(key, text("A"), { onlyIfMatch: e1 }));
  if (!step("identical bytes onlyIfMatch (U1)", same, same.status === 200 && same.etag === e1, e1)) return done();
  // 4. U2: a non-current ETag refused, bytes unchanged
  const stale = await once(ctx, (s) => s.set(key, text("C"), { onlyIfMatch: "\"iaos-probe-not-current\"" }));
  if (!step("stale onlyIfMatch refused (U2)", stale, stale.status === 412 && (await read()) === text("A"))) return done();
  // 5. U2: N concurrent conflicting writers on the same ETag -> exactly one winner, whose bytes are stored
  const racers = await Promise.all(Array.from({ length: n }, (_, i) => once(ctx, (s) => s.set(key, text(`W${i}`), { onlyIfMatch: e1 }))));
  const winners = racers.map((r, i) => ({ r, i })).filter((x) => x.r.status === 200);
  const losersOk = racers.every((r) => r.status === 200 || r.status === 412);
  const stored = await read();
  const raceOk = winners.length === 1 && losersOk && stored === text(`W${winners[0].i}`) && isCanonicalEtag(winners[0].r.etag);
  if (!step(`concurrent onlyIfMatch x${n}: exactly one winner (U2)`, { status: winners.length === 1 ? 200 : null, etag: null, data: { modified: winners.length === 1 }, why: null }, raceOk)) return done();
  const eW = winners[0].r.etag as string;
  // 6. U2: revoke, then replaying the old bytes with the old ETag is refused and the record stays revoked
  const revoked = await once(ctx, (s) => s.set(key, text("REVOKED"), { onlyIfMatch: eW }));
  if (!step("revoke onlyIfMatch", revoked, revoked.status === 200, eW)) return done();
  const replay = await once(ctx, (s) => s.set(key, text("A"), { onlyIfMatch: e1 }));
  step("replay of old bytes with old ETag refused (U2)", replay, replay.status === 412 && (await read()) === text("REVOKED"));
  return done();
}
