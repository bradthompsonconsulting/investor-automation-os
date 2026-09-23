/**
 * SECURITY -- application READ authority for the nine GHL read functions.
 *
 * Separate from INV-95's write authority (`app-write-auth.ts`) and from voice
 * (`operator-auth.ts`): its own audience, secret, allowlist and exact origin,
 * all from IAOS_APP_READ_* settings. It never reads an IAOS_APP_WRITE_*
 * setting, never accepts a write or voice session, and a read session never
 * authorizes a write (the write side only reads the Authorization header).
 *
 * The session is an 8-hour, fixed-lifetime signed token carried ONLY in the
 * `__Host-iaos_read` cookie (Secure, HttpOnly, SameSite=Strict, Path=/). It
 * binds the deployment's IAOS_ENV, so a Test session is refused by
 * Production and vice versa even if the two secrets were ever equal.
 *
 * ⚠ Signing out clears the cookie in that browser only. A signed token that
 * was copied elsewhere stays valid until its own expiry: there is no
 * server-side revocation list. Rotating IAOS_APP_READ_SESSION_SECRET (with a
 * redeploy) is the only way to invalidate every outstanding read session.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const READ_AUDIENCE = "iaos-app-read";
export const READ_SESSION_SECONDS = 8 * 60 * 60;
export const READ_COOKIE = "__Host-iaos_read";
export const READ_AUTH_REFUSED = "iaos-app-read-auth";
export const READ_AUTH_UNCONFIGURED = "iaos-app-read-unconfigured";

/** Missing or invalid read configuration: answer 503, never reach GHL. */
export class ReadAuthUnconfigured extends Error {}
/** Missing, invalid, expired or foreign session: answer 401, never reach GHL. */
export class ReadAuthRefused extends Error {}

export interface ReadAuthConfig { clientId: string; secret: string; emails: string[]; origin: string; deployment: "production" | "test" }

function exactOrigin(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password && !value.includes("*");
  } catch { return false; }
}

export function appReadConfig(env = process.env): ReadAuthConfig {
  const clientId = env.IAOS_APP_READ_GOOGLE_CLIENT_ID?.trim();
  const secret = env.IAOS_APP_READ_SESSION_SECRET?.trim();
  const emails = (env.IAOS_APP_READ_BRAD_EMAILS ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  const origin = env.IAOS_APP_READ_ALLOWED_ORIGIN;
  const deployment = env.IAOS_ENV;
  const reused = [env.IAOS_APP_WRITE_SESSION_SECRET?.trim(), env.IAOS_VOICE_SESSION_SECRET?.trim()].includes(secret);
  if (!clientId || !secret || secret.length < 32 || reused || !emails.length ||
      emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) || !exactOrigin(origin) ||
      (deployment !== "production" && deployment !== "test")) {
    throw new ReadAuthUnconfigured("Application read sign-in is not configured");
  }
  return { clientId, secret, emails, origin, deployment };
}

function sign(input: string, secret: string) { return createHmac("sha256", secret).update(input).digest(); }

export function issueReadSession(email: string, config: ReadAuthConfig, now = Date.now()) {
  const sub = email.trim().toLowerCase();
  if (!config.emails.includes(sub)) throw new ReadAuthRefused("Operator is not authorized to read");
  const iat = Math.floor(now / 1000);
  const claims = { iss: "iaos", aud: READ_AUDIENCE, env: config.deployment, sub, iat, exp: iat + READ_SESSION_SECONDS };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  return { token: `${input}.${sign(input, config.secret).toString("base64url")}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

export function verifyReadSession(token: string, config: ReadAuthConfig, now = Date.now()): { email: string; expiresAt: string } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ReadAuthRefused("Invalid read session");
  const expected = sign(`${parts[0]}.${parts[1]}`, config.secret);
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new ReadAuthRefused("Invalid read session");
  let header: any, claims: any;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { throw new ReadAuthRefused("Invalid read session"); }
  const seconds = Math.floor(now / 1000);
  if (header?.alg !== "HS256" || header?.typ !== "JWT" || claims?.iss !== "iaos" || claims.aud !== READ_AUDIENCE ||
      claims.env !== config.deployment || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      claims.exp - claims.iat !== READ_SESSION_SECONDS || claims.exp <= seconds || claims.iat > seconds + 30 ||
      typeof claims.sub !== "string" || !config.emails.includes(claims.sub)) {
    throw new ReadAuthRefused("Expired or unauthorized read session");
  }
  return { email: claims.sub, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

/** The one read-session cookie value. Two or more copies are ambiguous and refused. */
export function readSessionToken(event: any): string {
  const raw: string[] = [];
  for (const [name, value] of Object.entries(event?.headers ?? {})) {
    if (name.toLowerCase() === "cookie" && typeof value === "string") raw.push(value);
  }
  for (const [name, values] of Object.entries(event?.multiValueHeaders ?? {})) {
    if (name.toLowerCase() === "cookie" && Array.isArray(values)) raw.push(...values.filter((v): v is string => typeof v === "string"));
  }
  const found = new Set<string>();
  for (const header of raw) {
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(0, eq).trim() === READ_COOKIE) found.add(part.slice(eq + 1).trim());
    }
  }
  if (found.size !== 1) throw new ReadAuthRefused("Read sign-in required");
  const [token] = found;
  if (!token) throw new ReadAuthRefused("Read sign-in required");
  return token;
}

export function requireAppReader(event: any, env = process.env, now = Date.now()) {
  const config = appReadConfig(env);
  return verifyReadSession(readSessionToken(event), config, now);
}

/** Exact browser Origin for the session endpoint's POST/DELETE. No deploy-preview exception. */
export function requireReadOrigin(event: any, config: ReadAuthConfig): void {
  const entries = Object.entries(event?.headers ?? {}).filter(([name]) => name.toLowerCase() === "origin");
  if (entries.length !== 1 || entries[0][1] !== config.origin) throw new ReadAuthRefused("Read origin refused");
  const multi = Object.entries(event?.multiValueHeaders ?? {}).filter(([name]) => name.toLowerCase() === "origin");
  if (multi.length > 1 || (multi.length === 1 &&
      (!Array.isArray(multi[0][1]) || multi[0][1].length !== 1 || multi[0][1][0] !== config.origin))) {
    throw new ReadAuthRefused("Ambiguous Origin");
  }
}

export function readSessionCookie(token: string) {
  return `${READ_COOKIE}=${token}; Path=/; Max-Age=${READ_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}
export function clearedReadSessionCookie() {
  return `${READ_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

const REFUSAL_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/**
 * The first statement of every GHL read handler. Returns the refusal to send,
 * or null when a valid read session is present. Nothing is logged: no cookie,
 * token, email or reason.
 */
export function readAuthRefusal(event: any, env = process.env, now = Date.now()) {
  try {
    requireAppReader(event, env, now);
    return null;
  } catch (error) {
    if (error instanceof ReadAuthUnconfigured) {
      return { statusCode: 503, headers: REFUSAL_HEADERS, body: JSON.stringify({ error: "Read sign-in is not configured for this site", by: READ_AUTH_UNCONFIGURED }) };
    }
    return { statusCode: 401, headers: REFUSAL_HEADERS, body: JSON.stringify({ error: "Sign in to read IAOS data", by: READ_AUTH_REFUSED }) };
  }
}
