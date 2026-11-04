/** INV-95: independent application-write authority. Never accepts voice sessions. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyGoogleIdToken } from "./google-identity";
import { oneLoginActiveFor } from "../../../shared/ghl-config";
const audience = "iaos-app-write";
/**
 * SECURITY -- B15-29 r4 (Bones R3-1, rollback boundary). A One-Login-bound saving token is a DIFFERENT shape from the
 * legacy INV-95 token and can never be read as one:
 *   legacy  aud "iaos-app-write"          claims exactly iss,aud,sub,iat,exp
 *   bound   aud "iaos-app-write-session"  claims exactly iss,aud,sub,iat,exp,env,sid,pexp,epoch,aetag,setag
 * The discriminator is "aud is the bound audience OR any binding claim (env/sid/pexp/epoch/aetag/setag) is present".
 * Both shapes are HMAC-signed, so a bound token cannot be stripped into a legacy one, and a build without this code
 * (an older deployment after a code rollback) refuses the bound audience outright. requireAppWriter -- the common
 * writer authentication boundary -- accepts a bound token ONLY while one IAOS sign-in is on for THIS IAOS_ENV: off
 * (a feature rollback), every bound token is refused whatever its expiry, parent expiry, revocation or environment,
 * and legacy tokens keep working exactly as before.
 */
export const BOUND_AUDIENCE = "iaos-app-write-session";
const BINDING_CLAIMS = ["env", "sid", "pexp", "epoch", "aetag", "setag"];
const LEGACY_CLAIM_SET = "aud,exp,iat,iss,sub";
const BOUND_CLAIM_SET = "aetag,aud,env,epoch,exp,iat,iss,pexp,setag,sid,sub";
/** True for the One-Login-bound shape (see above). Decides refusal only; never grants anything by itself. */
export function isOneLoginBoundClaims(claims: unknown): boolean {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return false;
  const c = claims as Record<string, unknown>;
  return c.aud === BOUND_AUDIENCE || BINDING_CLAIMS.some((k) => k in c);
}
/**
 * Decode-only view of the Authorization bearer (NO signature check): true when it has the bound shape. Used ONLY to
 * refuse (sessionWriteRefusal while one IAOS sign-in is off, zero I/O); an unsigned decode never authorizes.
 */
export function bearerHasOneLoginBinding(event: any): boolean {
  const auth = event?.headers?.authorization ?? event?.headers?.Authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return false;
  const parts = auth.slice(7).split(".");
  if (parts.length !== 3) return false;
  try { return isOneLoginBoundClaims(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))); } catch { return false; }
}
export function appAuthConfig(env = process.env) {
  const clientId = env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID?.trim();
  const secret = env.IAOS_APP_WRITE_SESSION_SECRET?.trim();
  const emails = (env.IAOS_APP_WRITE_BRAD_EMAILS ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!clientId || !secret || secret.length < 32 || !emails.length || emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) throw new Error("Application write authentication is not configured");
  return { clientId, secret, emails };
}
export function issueAppSession(email: string, env = process.env, now = Date.now()) {
  const config = appAuthConfig(env);
  if (!config.emails.includes(email)) throw new Error("Operator is not authorized");
  const claims = { iss: "iaos", aud: audience, sub: email, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 900 };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  return { token: `${input}.${createHmac("sha256", config.secret).update(input).digest("base64url")}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}
export function requireAppWriter(event: any, env = process.env, now = Date.now()): string {
  const config = appAuthConfig(env);
  const auth = event.headers?.authorization ?? event.headers?.Authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) throw new Error("Application write sign-in required");
  const parts = auth.slice(7).split(".");
  if (parts.length !== 3) throw new Error("Invalid application session");
  const expected = createHmac("sha256", config.secret).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid application session");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  const seconds = Math.floor(now / 1000);
  // B15-29 r4 (R3-1): the bound shape exists ONLY while one IAOS sign-in is on for this environment.
  const bound = isOneLoginBoundClaims(claims);
  if (bound && !oneLoginActiveFor(env.IAOS_ENV)) throw new Error("Expired or unauthorized application session");
  if (!claims || typeof claims !== "object" || Object.keys(claims).sort().join(",") !== (bound ? BOUND_CLAIM_SET : LEGACY_CLAIM_SET)) {
    throw new Error("Invalid application session");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT" || claims.iss !== "iaos" || claims.aud !== (bound ? BOUND_AUDIENCE : audience) ||
      !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || claims.exp <= seconds || claims.iat > seconds + 30 ||
      claims.exp - claims.iat !== 900 || !config.emails.includes(claims.sub)) throw new Error("Expired or unauthorized application session");
  return claims.sub;
}
/**
 * B15-29 (INV-137), one IAOS sign-in ONLY: a 900 s saving token in the BOUND
 * shape (audience BOUND_AUDIENCE, see the r4 note above) binding it to the
 * signed-in session -- `env` (this IAOS_ENV) and `sid` (the read session's id),
 * plus `pexp` and `epoch` (the parent session's expiry and revocation-authority
 * epoch) and the session's store ETags. requireAppWriter accepts it only while one
 * IAOS sign-in is on; lib/session-revocation.ts additionally requires every claim
 * and checks the sid's revocation on every write. Never issued while one IAOS
 * sign-in is off, and refused by every writer once it is turned off.
 */
export function issueBoundAppSession(email: string, binding: { env: "test" | "production"; sid: string; pexp: number; epoch: string; aetag: string; setag: string }, env = process.env, now = Date.now()) {
  const config = appAuthConfig(env);
  if (!config.emails.includes(email)) throw new Error("Operator is not authorized");
  if ((binding.env !== "test" && binding.env !== "production") || typeof binding.sid !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(binding.sid) ||
      !Number.isInteger(binding.pexp) || typeof binding.epoch !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(binding.epoch) ||
      [binding.aetag, binding.setag].some((e) => typeof e !== "string" || !/^[!-~]{1,200}$/.test(e))) throw new Error("Invalid session binding");
  const iat = Math.floor(now / 1000);
  // pexp: the parent read session's expiry. The token keeps its 900 s lifetime; writers ALSO refuse it once pexp passes.
  // epoch: the parent session's revocation-authority epoch (B15-29 H2); writers refuse it once the anchor's epoch changes.
  // aetag/setag (B15-29 r5): the parent session's store ETags; every write re-runs the conditional-write check with them.
  // The token can never authorize past the session: writers refuse it once pexp passes (r6), whatever its own exp says.
  const claims = { iss: "iaos", aud: BOUND_AUDIENCE, sub: email, iat, exp: iat + 900, env: binding.env, sid: binding.sid, pexp: binding.pexp, epoch: binding.epoch, aetag: binding.aetag, setag: binding.setag };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  return { token: `${input}.${createHmac("sha256", config.secret).update(input).digest("base64url")}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}
/**
 * B15-29: the session binding of a write token that requireAppWriter has
 * ALREADY accepted (this re-runs requireAppWriter, so it never trusts a
 * decode alone). `sid`/`env` are null when the token carries none (a token
 * from the old popup issuer).
 */
export function appWriteSessionBinding(event: any, env = process.env, now = Date.now()): { sub: string; sid: string | null; env: string | null; pexp: number | null; epoch: string | null; aetag: string | null; setag: string | null } {
  const sub = requireAppWriter(event, env, now);
  const auth = String(event.headers?.authorization ?? event.headers?.Authorization);
  const claims = JSON.parse(Buffer.from(auth.slice(7).split(".")[1], "base64url").toString("utf8"));
  return { sub, sid: typeof claims.sid === "string" ? claims.sid : null, env: typeof claims.env === "string" ? claims.env : null,
    pexp: Number.isInteger(claims.pexp) ? claims.pexp : null, epoch: typeof claims.epoch === "string" ? claims.epoch : null,
    aetag: typeof claims.aetag === "string" ? claims.aetag : null, setag: typeof claims.setag === "string" ? claims.setag : null };
}
export async function googleAppIdentity(idToken: string, fetcher: typeof fetch = fetch, env = process.env, now = Date.now()) {
  const config = appAuthConfig(env);
  return verifyGoogleIdToken(idToken, config.clientId, config.emails, fetcher, now);
}
