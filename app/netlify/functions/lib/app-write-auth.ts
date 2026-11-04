/** INV-95: independent application-write authority. Never accepts voice sessions. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyGoogleIdToken } from "./google-identity";
const audience = "iaos-app-write";
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
  if (header.alg !== "HS256" || header.typ !== "JWT" || claims.iss !== "iaos" || claims.aud !== audience ||
      !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || claims.exp <= seconds || claims.iat > seconds + 30 ||
      claims.exp - claims.iat !== 900 || !config.emails.includes(claims.sub)) throw new Error("Expired or unauthorized application session");
  return claims.sub;
}
/**
 * B15-29 (INV-137), one IAOS sign-in ONLY: the same 900 s iaos-app-write token
 * as issueAppSession, plus two claims binding it to the signed-in session --
 * `env` (this IAOS_ENV) and `sid` (the read session's id), plus `pexp` and
 * `epoch` (the parent session's expiry and revocation-authority epoch). requireAppWriter
 * accepts it unchanged; lib/session-revocation.ts additionally requires both
 * claims and checks the sid's revocation on every write. Never used while one
 * IAOS sign-in is off.
 */
export function issueBoundAppSession(email: string, binding: { env: "test" | "production"; sid: string; pexp: number; epoch: string }, env = process.env, now = Date.now()) {
  const config = appAuthConfig(env);
  if (!config.emails.includes(email)) throw new Error("Operator is not authorized");
  if ((binding.env !== "test" && binding.env !== "production") || typeof binding.sid !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(binding.sid) ||
      !Number.isInteger(binding.pexp) || typeof binding.epoch !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(binding.epoch)) throw new Error("Invalid session binding");
  const iat = Math.floor(now / 1000);
  // pexp: the parent read session's expiry. The token keeps its 900 s lifetime; writers ALSO refuse it once pexp passes.
  // epoch: the parent session's revocation-authority epoch (B15-29 H2); writers refuse it once the anchor's epoch changes.
  const claims = { iss: "iaos", aud: audience, sub: email, iat, exp: iat + 900, env: binding.env, sid: binding.sid, pexp: binding.pexp, epoch: binding.epoch };
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
export function appWriteSessionBinding(event: any, env = process.env, now = Date.now()): { sub: string; sid: string | null; env: string | null; pexp: number | null; epoch: string | null } {
  const sub = requireAppWriter(event, env, now);
  const auth = String(event.headers?.authorization ?? event.headers?.Authorization);
  const claims = JSON.parse(Buffer.from(auth.slice(7).split(".")[1], "base64url").toString("utf8"));
  return { sub, sid: typeof claims.sid === "string" ? claims.sid : null, env: typeof claims.env === "string" ? claims.env : null,
    pexp: Number.isInteger(claims.pexp) ? claims.pexp : null, epoch: typeof claims.epoch === "string" ? claims.epoch : null };
}
export async function googleAppIdentity(idToken: string, fetcher: typeof fetch = fetch, env = process.env, now = Date.now()) {
  const config = appAuthConfig(env);
  return verifyGoogleIdToken(idToken, config.clientId, config.emails, fetcher, now);
}
