import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_ISSUER = "iaos";
const SESSION_AUDIENCE = "iaos-voice";
const SESSION_TTL_SECONDS = 15 * 60;

type SessionClaims = { iss: string; aud: string; sub: string; email: string; iat: number; exp: number };

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function configuredEmails(env = process.env): Set<string> {
  return new Set((env.IAOS_VOICE_BRAD_EMAILS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
}

function sessionSecret(env = process.env): string {
  const secret = env.IAOS_VOICE_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("IAOS_VOICE_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

export function issueOperatorSession(email: string, nowMs = Date.now(), env = process.env): { token: string; expiresAt: string } {
  const normalized = email.trim().toLowerCase();
  if (!configuredEmails(env).has(normalized)) throw new Error("Operator is not authorized for IAOS voice");
  const now = Math.floor(nowMs / 1000);
  const claims: SessionClaims = {
    iss: SESSION_ISSUER, aud: SESSION_AUDIENCE, sub: normalized, email: normalized,
    iat: now, exp: now + SESSION_TTL_SECONDS,
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const input = `${header}.${payload}`;
  const signature = createHmac("sha256", sessionSecret(env)).update(input).digest("base64url");
  return { token: `${input}.${signature}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

export function verifyOperatorSession(token: string, nowMs = Date.now(), env = process.env): SessionClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid operator session");
  const input = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", sessionSecret(env)).update(input).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid operator session");
  let claims: SessionClaims;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("Invalid header");
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  }
  catch { throw new Error("Invalid operator session"); }
  const now = Math.floor(nowMs / 1000);
  if (claims.iss !== SESSION_ISSUER || claims.aud !== SESSION_AUDIENCE || claims.exp <= now || claims.iat > now + 30) {
    throw new Error("Expired or invalid operator session");
  }
  if (claims.sub !== claims.email || !configuredEmails(env).has(claims.email)) throw new Error("Operator is not authorized for IAOS voice");
  return claims;
}

export async function verifyGoogleIdentity(
  idToken: string,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
  env = process.env,
): Promise<{ email: string }> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
  const response = await fetcher(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) throw new Error("Google identity verification failed");
  const claims = await response.json() as Record<string, unknown>;
  const email = String(claims.email ?? "").trim().toLowerCase();
  const issuer = String(claims.iss ?? "");
  const expires = Number(claims.exp ?? 0);
  if ((issuer !== "accounts.google.com" && issuer !== "https://accounts.google.com") || claims.aud !== clientId ||
      String(claims.email_verified).toLowerCase() !== "true" || expires <= Math.floor(nowMs / 1000) || !configuredEmails(env).has(email)) {
    throw new Error("Google identity is not authorized for IAOS voice");
  }
  return { email };
}

export function bearerToken(event: any): string {
  const header = String(event.headers?.authorization ?? event.headers?.Authorization ?? "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new Error("Missing operator session");
  return match[1];
}

export function requireOperator(event: any): SessionClaims {
  return verifyOperatorSession(bearerToken(event));
}
