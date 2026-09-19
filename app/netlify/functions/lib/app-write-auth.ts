/** INV-95: independent application-write authority. Never accepts voice sessions. */
import { createHmac, timingSafeEqual } from "node:crypto";
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
export async function googleAppIdentity(idToken: string, fetcher: typeof fetch = fetch, env = process.env, now = Date.now()) {
  const config = appAuthConfig(env);
  const response = await fetcher(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) throw new Error("Google identity verification failed");
  const c = await response.json();
  const email = typeof c.email === "string" ? c.email.toLowerCase() : "";
  if (!["accounts.google.com", "https://accounts.google.com"].includes(c.iss) || c.aud !== config.clientId || String(c.email_verified) !== "true" ||
      !Number.isFinite(Number(c.exp)) || Number(c.exp) <= now / 1000 || !config.emails.includes(email)) throw new Error("Google identity is not authorized");
  return email;
}
