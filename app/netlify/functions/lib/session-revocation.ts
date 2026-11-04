/**
 * SECURITY -- B15-29 (INV-137) one IAOS sign-in: server-side, per-session
 * Sign out revocation (design r4 / Bones rulings: Variant S, C1, revoke-only
 * handle, acknowledged Sign out). INERT while one IAOS sign-in is off
 * (`oneLoginActiveFor(IAOS_ENV)` false in BOTH committed configs): every
 * exported refusal helper then returns null before any I/O, so callers behave
 * exactly as before.
 *
 * The revocation record R(sid) is one Netlify Blob at
 * `session-revocation/<sha256(env:sid)>` in the EXISTING receipts store
 * (the same store as blob-authority's AUTHORITY_STORE; disjoint prefix, no new
 * store). It is
 * reached ONLY through an explicit API-mode client (siteID + token both
 * supplied, from IAOS_SESSION_REVOCATION_SITE_ID / _TOKEN), so @netlify/blobs
 * ignores any process-wide or Lambda edge context -- the same transport
 * discipline as blob-authority.ts, which is NOT modified (its record schema and
 * exported surface are closed). Records are never deleted (no TTL).
 *
 * Outcomes, never conflated (C1):
 *   absent       one strong read answered 404 in time      -> proceed
 *   revoked      one strong read returned a VALID record   -> 401 reason "revoked"
 *   unavailable  anything else: not configured, sign/blob error, 403/429/5xx,
 *                transport error, abort, malformed/foreign record, deadline,
 *                late answer                                -> 503 iaos-session-unavailable
 * "unavailable" is never reported as signed in, never as revoked.
 *
 * Transport rules (mirroring blob-authority's single-attempt recorder): at most
 * ONE sign request and ONE blob request per operation (an SDK retry is
 * answered with a synthetic non-retryable 400 and never sent); classification
 * comes from the recorded attempts, never from the SDK's `modified`. One
 * shared deadline per operation: a stage is not started with less than
 * MIN_START_MS left, a started stage is aborted at min(stage cap, deadline)
 * with its timer armed until the SDK has consumed the body, the operation
 * returns at the deadline even if a transport ignores abort (its late result
 * is discarded), and the caller's final clock check refuses a result that
 * arrives after the deadline. A late 404 never grants anything.
 *
 * Sign out is acknowledged ONLY after a verified revocation: a conditional
 * create (onlyIfNew) whose result is NOT trusted, followed by a strong
 * readback that must show a valid record for exactly this env + sid (an
 * existing valid record is idempotent success). Every other outcome is
 * "not confirmed". A revocation that commits after the client gave up is
 * conservative (it only ever revokes the same signed sid).
 *
 * The revoke-only handle: HS256 under a key DERIVED from the read secret for
 * this purpose only, aud "iaos-app-signout", exact claims {iss, aud, env, sid,
 * iat, exp}, exp = the parent session's exp + 24 h (a capability lifetime, not
 * evidence any credential is dead). It is accepted ONLY by app-signout; it is
 * never a read cookie, a saving bearer, a token-issue credential or a sign-in.
 *
 * Authority binding (Bones H2, binding/restore part): absence of R(sid) is
 * evidence of "not revoked" ONLY from the intended authority. So:
 *   1. the revocation site is PINNED per environment in this file
 *      (PINNED_REVOCATION_SITES); IAOS_ENV must be exactly test|production and
 *      IAOS_SESSION_REVOCATION_SITE_ID must equal that environment's pinned id;
 *   2. at request time the platform's own site id (request header
 *      x-nf-site-id) must be present exactly once and equal the pinned id, so a
 *      deploy of this code on another site cannot read "absence" from ours;
 *   3. every check and every Sign out strongly reads the operator-provisioned
 *      authority anchor (the one anchor key constant below; same budget, same
 *      single-attempt recorder, in parallel with the sid read). Absent,
 *      malformed, foreign env or foreign site -> unavailable, never absence.
 *      NO code path creates or modifies the anchor (operator-only, see
 *      docs/B15-29_SESSION_REVOCATION_RUNBOOK.md);
 *   4. RESTORE EPOCH: each session is bound at sign-in to the anchor's epoch
 *      (read cookie claim `epoch`, carried into the saving token). A check
 *      whose session epoch differs from the anchor's current epoch is
 *      REVOKED. After any store restore or suspected loss of revocation
 *      records the operator writes a new epoch, which signs out every older
 *      session at once -- so a revocation lost in the restore cannot revive a
 *      credential issued before it.
 * Any setup or binding failure is "unavailable" (503 / Sign out not confirmed).
 *
 * What the offline tests show is OUR behaviour against a fake Blob service.
 * Provider guarantees (API-mode read-after-write freshness, conditional-create
 * atomicity, status codes) are open assumptions, not proven here.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { oneLoginActiveFor } from "../../../shared/ghl-config";
import {
  READ_AUTH_REFUSED, READ_AUTH_UNCONFIGURED, ReadAuthUnconfigured, appReadConfig, isCanonicalEpoch, isCanonicalSid, readSessionToken,
  verifyReadSession, type ReadAuthConfig,
} from "./app-read-auth";
import { appWriteSessionBinding } from "./app-write-auth";

/**
 * The EXISTING receipts store -- the same name as blob-authority.ts's AUTHORITY_STORE (asserted equal by
 * test-b15-29-session-revocation). Not imported: blob-authority also carries the GHL transport, and this module
 * must not join the GHL-caller import graph (test-supplemental-read-budget's inventory).
 */
export const REVOCATION_STORE = "iaos-write-receipts";
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
const KEY_PREFIX = "session-revocation/";
const RECORD_KIND = "iaos-session-revocation";
const SIGNED_URL_ACCEPT = "application/json;type=signed-url";
/** Candidate budgets (r4 §E), untested against deployed latency. */
export const CHECK_BUDGET_MS = 3_000;
export const SIGNOUT_BUDGET_MS = 5_000;
const STAGE_CAP_MS = 2_000;
const MIN_START_MS = 250;

type Deployment = "test" | "production";
const NO_STORE = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const respond = (statusCode: number, body: unknown) => ({ statusCode, headers: { ...NO_STORE }, body: JSON.stringify(body) });

// ------------------------------------------------------------------ setup ---

/**
 * The intended revocation authority per environment: the Netlify site whose receipts store holds the records.
 * Public site ids (iaos-app-test / iaos-app). Changing one is a reviewed code change, never configuration.
 */
export const PINNED_REVOCATION_SITES: Readonly<Record<Deployment, string>> = Object.freeze({
  test: "07ca1f1a-60fd-4229-a076-528970957912",
  production: "19fcbf6a-7c3c-40e3-af20-bd077f0f8ec8",
});
/** The platform's runtime site id header (the one @netlify/blobs connectLambda reads). */
export const RUNTIME_SITE_HEADER = "x-nf-site-id";
/** The operator-provisioned authority anchor. READ ONLY here: no code path writes it. */
const AUTHORITY_KEY = "session-revocation/_authority";
const AUTHORITY_KIND = "iaos-session-revocation-authority";

export type RevocationSetup = { kind: "ready"; deployment: Deployment; siteID: string; token: string } | { kind: "not_configured"; reason: string };
/**
 * Environment variables only; no I/O. Missing, an IAOS_ENV other than exactly test|production, or a site id that is
 * not the pinned one -> every check is "unavailable" and every Sign out "not confirmed" (never absence).
 */
export function revocationSetup(env: NodeJS.ProcessEnv = process.env): RevocationSetup {
  const deployment = env.IAOS_ENV;
  const siteID = env.IAOS_SESSION_REVOCATION_SITE_ID?.trim();
  const token = env.IAOS_SESSION_REVOCATION_TOKEN?.trim();
  if (!siteID || !token) return { kind: "not_configured", reason: "not_configured" };
  if (deployment !== "test" && deployment !== "production") return { kind: "not_configured", reason: "environment_unbound" };
  if (siteID !== PINNED_REVOCATION_SITES[deployment]) return { kind: "not_configured", reason: "site_not_pinned" };
  return { kind: "ready", deployment, siteID, token };
}

/** Strict parse of the anchor: exact canonical JSON for THIS env and its pinned site; returns the epoch or null. */
export function authorityEpoch(text: unknown, deployment: string): string | null {
  if (typeof text !== "string" || text.length > 1024) return null;
  if (deployment !== "test" && deployment !== "production") return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== "env,epoch,kind,siteID,v") return null;
  if (r.v !== 1 || r.kind !== AUTHORITY_KIND || r.env !== deployment || r.siteID !== PINNED_REVOCATION_SITES[deployment]) return null;
  if (!isCanonicalEpoch(r.epoch)) return null;
  return canonicalJson(r) === text ? r.epoch : null;
}

export function revocationKey(deployment: string, sid: string): string {
  return KEY_PREFIX + createHash("sha256").update(`${RECORD_KIND}:${deployment}:${sid}`, "utf8").digest("hex");
}
const sidDigest = (deployment: string, sid: string) => revocationKey(deployment, sid).slice(KEY_PREFIX.length);

/** Strict parse: only the canonical record for exactly this env + sid. */
export function validRevocationText(text: unknown, deployment: string, sid: string): boolean {
  if (typeof text !== "string" || text.length > 1024) return false;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return false; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== "env,kind,revokedAt,schema,sidDigest") return false;
  if (r.schema !== 1 || r.kind !== RECORD_KIND || r.env !== deployment || r.sidDigest !== sidDigest(deployment, sid)) return false;
  if (typeof r.revokedAt !== "string" || !Number.isFinite(Date.parse(r.revokedAt))) return false;
  return canonicalJson(r) === text;
}

// ------------------------------------------------- single-attempt transport ---

type Attempt = { stage: "sign" | "blob"; status: number | null; threw: boolean; etag: string | null; suppressed: boolean };
const RETRYABLE = (status: number) => status === 429 || status >= 500 || status === 403;
type Clock = () => number;

function recorder(fetchImpl: typeof fetch, now: Clock, deadline: number) {
  const attempts: Attempt[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const controllers: AbortController[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const stage: Attempt["stage"] = new Headers(init?.headers).get("accept") === SIGNED_URL_ACCEPT ? "sign" : "blob";
    if (attempts.some((a) => a.stage === stage)) {
      attempts.push({ stage, status: null, threw: false, etag: null, suppressed: true }); // an SDK retry: never sent
      return new Response(null, { status: 400 });
    }
    const left = deadline - now();
    if (left < MIN_START_MS) {
      attempts.push({ stage, status: null, threw: false, etag: null, suppressed: true }); // not started (deadline)
      if (stage === "sign") throw new Error("revocation request not started (deadline)");
      return new Response(null, { status: 400 });
    }
    const ac = new AbortController();
    controllers.push(ac);
    timers.push(setTimeout(() => ac.abort(), Math.min(STAGE_CAP_MS, left)));
    try {
      const res = await fetchImpl(url, { ...init, signal: ac.signal });
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
  return {
    attempts,
    fetch: f as typeof fetch,
    settle: () => { for (const t of timers) clearTimeout(t); },
    abortAll: () => { for (const c of controllers) c.abort(); },
  };
}

type Ctx = { setup: Extract<RevocationSetup, { kind: "ready" }>; fetchImpl: typeof fetch; now: Clock; deadline: number };

/** Runs `op` bounded by the deadline even if the transport ignores abort; a late result is discarded. */
async function bounded<T>(ctx: Ctx, rec: ReturnType<typeof recorder>, op: () => Promise<T>, onLate: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<T>((resolve) => { timer = setTimeout(() => { rec.abortAll(); resolve(onLate); }, Math.max(0, ctx.deadline - ctx.now())); });
  const work = op().catch(() => onLate);
  try { return await Promise.race([work, cutoff]); } finally { clearTimeout(timer); rec.settle(); }
}

function storeFor(ctx: Ctx, fetchImpl: typeof fetch) {
  // siteID AND token supplied => the SDK ignores any environment/Lambda context; no edgeURL => API branch.
  return getStore({ name: REVOCATION_STORE, siteID: ctx.setup.siteID, token: ctx.setup.token, fetch: fetchImpl });
}

type Read = { kind: "absent" } | { kind: "present"; text: string } | { kind: "unavailable"; reason: string };

async function strongRead(ctx: Ctx, key: string): Promise<Read> {
  const rec = recorder(ctx.fetchImpl, ctx.now, ctx.deadline);
  let got: { data: string } | null = null;
  let threw = false;
  const late = Symbol("late");
  const out = await bounded<unknown>(ctx, rec, async () => {
    try { got = (await storeFor(ctx, rec.fetch).getWithMetadata(key, { type: "text" })) as { data: string } | null; }
    catch { threw = true; }
    return null;
  }, late);
  if (out === late) return { kind: "unavailable", reason: "deadline" };
  const sign = rec.attempts.find((a) => a.stage === "sign" && !a.suppressed);
  const blob = rec.attempts.find((a) => a.stage === "blob" && !a.suppressed);
  if (!sign || sign.status !== 200 || !blob) return { kind: "unavailable", reason: "sign_failed" };
  if (blob.status === 404 && !threw && got === null) return { kind: "absent" };
  const value = got as { data: string } | null;
  if (blob.status !== 200 || threw || !value || typeof value.data !== "string") return { kind: "unavailable", reason: "read_failed" };
  return { kind: "present", text: value.data };
}

async function createOnce(ctx: Ctx, key: string, text: string): Promise<void> {
  const rec = recorder(ctx.fetchImpl, ctx.now, ctx.deadline);
  // The result is deliberately NOT classified as success: only the readback that follows can confirm.
  await bounded<void>(ctx, rec, async () => { try { await storeFor(ctx, rec.fetch).set(key, text, { onlyIfNew: true }); } catch { /* readback decides */ } }, undefined);
}

type OpOpts = { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: Clock; budgetMs?: number; event?: any };

/** Setup + environment binding + the platform's runtime site id; no I/O. A refusal reason, or a context. */
function context(env: NodeJS.ProcessEnv, deployment: string, budgetMs: number, opts: OpOpts): Ctx | { refused: string } {
  const setup = revocationSetup(env);
  if (setup.kind !== "ready") return { refused: setup.reason };
  if (setup.deployment !== deployment) return { refused: "environment_unbound" };
  const runtime = headerValues(opts.event, RUNTIME_SITE_HEADER);
  if (runtime.length !== 1 || runtime[0] !== setup.siteID) return { refused: "runtime_site_mismatch" };
  const now = opts.now ?? Date.now;
  // The global fetch is read at call time (never captured at module load).
  return { setup, fetchImpl: opts.fetch ?? globalThis.fetch, now, deadline: now() + budgetMs };
}

type Authority = { kind: "valid"; epoch: string } | { kind: "unavailable"; reason: string };
/** One strong read of the anchor within the caller's context (its deadline and single-attempt rules). */
async function readAuthority(ctx: Ctx): Promise<Authority> {
  const r = await strongRead(ctx, AUTHORITY_KEY);
  if (r.kind === "absent") return { kind: "unavailable", reason: "authority_absent" };
  if (r.kind === "unavailable") return r;
  const epoch = authorityEpoch(r.text, ctx.setup.deployment);
  return epoch ? { kind: "valid", epoch } : { kind: "unavailable", reason: "authority_invalid" };
}

// -------------------------------------------------------------- operations ---

export type RevocationStatus = { kind: "absent" } | { kind: "revoked"; reason?: "epoch" } | { kind: "unavailable"; reason: string };

/** The anchor's current epoch (sign-in binds a new session to it), bounded by CHECK_BUDGET_MS. Never throws. */
export async function readRevocationAuthority(deployment: string, opts: OpOpts = {}): Promise<Authority> {
  const ctx = context(opts.env ?? process.env, deployment, opts.budgetMs ?? CHECK_BUDGET_MS, opts);
  if ("refused" in ctx) return { kind: "unavailable", reason: ctx.refused };
  const a = await readAuthority(ctx);
  if (ctx.now() > ctx.deadline) return { kind: "unavailable", reason: "deadline" };
  return a;
}

/**
 * The anchor and R(env, sid), each one strong single-attempt read, IN PARALLEL under one CHECK_BUDGET_MS deadline.
 * `epoch` is the session's (or token's) bound epoch. Never throws.
 */
export async function checkRevocation(sid: string, deployment: string, opts: OpOpts & { epoch?: unknown } = {}): Promise<RevocationStatus> {
  if (!isCanonicalSid(sid) || (deployment !== "test" && deployment !== "production") || !isCanonicalEpoch(opts.epoch)) return { kind: "unavailable", reason: "refused_input" };
  const ctx = context(opts.env ?? process.env, deployment, opts.budgetMs ?? CHECK_BUDGET_MS, opts);
  if ("refused" in ctx) return { kind: "unavailable", reason: ctx.refused };
  const [anchor, r] = await Promise.all([readAuthority(ctx), strongRead(ctx, revocationKey(deployment, sid))]);
  // Final caller check: an answer that arrives after the deadline grants nothing (a late 404 is not "absent").
  if (ctx.now() > ctx.deadline) return { kind: "unavailable", reason: "deadline" };
  // Without a valid anchor, absence proves nothing (empty / wrong / restored store): unavailable.
  if (anchor.kind !== "valid") return anchor;
  // A session issued under an older epoch is signed out by the operator's restore/loss rotation.
  if (anchor.epoch !== opts.epoch) return { kind: "revoked", reason: "epoch" };
  if (r.kind === "absent") return { kind: "absent" };
  if (r.kind === "unavailable") return r;
  return validRevocationText(r.text, deployment, sid) ? { kind: "revoked" } : { kind: "unavailable", reason: "invalid_record" };
}

export type RevokeResult = { kind: "verified" } | { kind: "unconfirmed"; reason: string };

/**
 * Conditional create of R(env, sid) -- in parallel with one strong read of the anchor -- then a strong readback.
 * Verified ONLY with a valid anchor AND a valid readback. Bounded by SIGNOUT_BUDGET_MS. Never writes the anchor.
 */
export async function recordRevocation(sid: string, deployment: string, opts: OpOpts = {}): Promise<RevokeResult> {
  if (!isCanonicalSid(sid) || (deployment !== "test" && deployment !== "production")) return { kind: "unconfirmed", reason: "refused_input" };
  const ctx = context(opts.env ?? process.env, deployment, opts.budgetMs ?? SIGNOUT_BUDGET_MS, opts);
  if ("refused" in ctx) return { kind: "unconfirmed", reason: ctx.refused };
  const key = revocationKey(deployment, sid);
  const text = canonicalJson({ schema: 1, kind: RECORD_KIND, env: deployment, sidDigest: sidDigest(deployment, sid), revokedAt: new Date(ctx.now()).toISOString() });
  // A record created while the anchor turns out invalid is conservative: it only ever revokes this signed sid.
  const [anchor] = await Promise.all([readAuthority(ctx), createOnce(ctx, key, text)]);
  if (anchor.kind !== "valid") return { kind: "unconfirmed", reason: anchor.reason };
  const back = await strongRead(ctx, key);
  if (ctx.now() > ctx.deadline) return { kind: "unconfirmed", reason: "deadline" };
  if (back.kind !== "present") return { kind: "unconfirmed", reason: back.kind === "absent" ? "not_found_after_write" : back.reason };
  return validRevocationText(back.text, deployment, sid) ? { kind: "verified" } : { kind: "unconfirmed", reason: "invalid_record" };
}

// ------------------------------------------------------------------ handle ---

const handleKey = (config: ReadAuthConfig) => createHmac("sha256", config.secret).update("iaos-app-signout-handle-key-v1").digest();
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** Issued only by app-read-session GET for a verified-absent session in this tab's view. */
export function issueSignoutHandle(session: { sid: string; expiresAt: string }, config: ReadAuthConfig, now = Date.now()): string {
  if (!isCanonicalSid(session.sid)) throw new Error("Invalid session id");
  const parentExp = Math.floor(Date.parse(session.expiresAt) / 1000);
  if (!Number.isInteger(parentExp)) throw new Error("Invalid session expiry");
  const claims = { iss: "iaos", aud: SIGNOUT_AUDIENCE, env: config.deployment, sid: session.sid, iat: Math.floor(now / 1000), exp: parentExp + HANDLE_EXTRA_SECONDS };
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}`;
  return `${input}.${createHmac("sha256", handleKey(config)).update(input).digest("base64url")}`;
}

export class HandleRefused extends Error {}
/** Strict: fixed HS256, exact header and claim sets, audience, env, canonical sid, integer iat/exp, not expired. */
export function verifySignoutHandle(handle: unknown, config: ReadAuthConfig, now = Date.now()): { sid: string } {
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
  if (!claims || typeof claims !== "object" || Object.keys(claims).sort().join(",") !== "aud,env,exp,iat,iss,sid") throw new HandleRefused("handle");
  if (claims.iss !== "iaos" || claims.aud !== SIGNOUT_AUDIENCE || claims.env !== config.deployment || !isCanonicalSid(claims.sid) ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > seconds + 30 || claims.exp <= seconds ||
      claims.exp - claims.iat > 8 * 60 * 60 + HANDLE_EXTRA_SECONDS + 30) throw new HandleRefused("handle");
  return { sid: claims.sid };
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

/**
 * C1, every protected reader, AFTER its unchanged readAuthRefusal and before
 * any upstream request or protected data. Off -> null with no I/O.
 */
export async function sessionReadRefusal(event: any, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!oneLoginActiveFor(env.IAOS_ENV)) return null;
  let config: ReadAuthConfig;
  let session: { sid?: string; epoch?: string };
  try { config = appReadConfig(env); session = verifyReadSession(readSessionToken(event), config, now); }
  catch (error) {
    if (error instanceof ReadAuthUnconfigured) return respond(503, { error: "Read sign-in is not configured for this site", by: READ_AUTH_UNCONFIGURED });
    return respond(401, { error: "Sign in to read IAOS data", by: READ_AUTH_REFUSED });
  }
  // A session from before one IAOS sign-in (no sid) cannot be revoked, so it is not accepted: one fresh sign-in (D6).
  // Likewise a session not bound to an authority epoch cannot be invalidated by a restore rotation.
  if (!session.sid || !session.epoch) return respond(401, { error: "Sign in to read IAOS data", by: READ_AUTH_REFUSED, reason: "sign_in_again" });
  const r = await checkRevocation(session.sid, config.deployment, { env, event, epoch: session.epoch });
  if (r.kind === "absent") return null;
  if (r.kind === "revoked") return respond(401, { error: "Signed out of IAOS", by: READ_AUTH_REFUSED, reason: "revoked" });
  return sessionUnavailableResponse();
}

/**
 * Variant S, every business writer, AFTER its unchanged requireAppWriter and
 * Origin checks and before any effect. Each request is its own authorization
 * unit: no "active" result is cached. Off -> null with no I/O.
 */
export async function sessionWriteRefusal(event: any, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  if (!oneLoginActiveFor(env.IAOS_ENV)) return null;
  const refused = (reason?: string) => respond(401, { error: "Application write sign-in required", by: "iaos-app-write-auth", ...(reason ? { reason } : {}) });
  let binding: { sid: string | null; env: string | null; pexp: number | null; epoch: string | null };
  try { binding = appWriteSessionBinding(event, env, now); } catch { return refused(); }
  // Sid-less saving tokens (the retired popup issuer) and tokens bound to another environment are refused.
  if (!binding.sid || !isCanonicalSid(binding.sid) || binding.env !== env.IAOS_ENV || binding.pexp === null) return refused("sign_in_again");
  // A token without the session's authority epoch is refused like a sid-less one.
  if (!isCanonicalEpoch(binding.epoch)) return refused("sign_in_again");
  // The parent IAOS session has expired: saving pauses with it, even though the token's own 900 s have not run out.
  if (binding.pexp <= Math.floor(now / 1000)) return refused("session_expired");
  const r = await checkRevocation(binding.sid, binding.env, { env, event, epoch: binding.epoch });
  if (r.kind === "absent") return null;
  if (r.kind === "revoked") return refused("revoked");
  return sessionUnavailableResponse();
}
