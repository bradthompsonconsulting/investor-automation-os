/**
 * SECURITY -- application read sign-in. See lib/app-read-auth.ts.
 *
 *   GET    -> { clientId, signedIn, expiresAt }   (never the token, never an email)
 *   POST   -> exact Origin + { googleIdToken } -> sets the __Host-iaos_read cookie
 *   DELETE -> exact Origin -> clears the cookie in this browser
 *
 * The token travels only in Set-Cookie; no response body ever carries it.
 * Clearing the cookie does not revoke a copied token server-side (see the
 * lib header). Missing read configuration answers 503 for every method.
 */
import {
  appReadConfig, clearedReadSessionCookie, issueReadSession, readSessionCookie, readSessionToken,
  READ_AUTH_UNCONFIGURED, requireReadOrigin, verifyReadSession,
} from "./lib/app-read-auth";
import { verifyGoogleIdToken } from "./lib/google-identity";
import { SESSION_UNAVAILABLE, checkRevocation, issueSignoutHandle } from "./lib/session-revocation";
import { oneLoginActiveFor } from "../../shared/ghl-config";
import { randomBytes } from "node:crypto";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (statusCode: number, body: unknown, extra: Record<string, string> = {}) =>
  ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

export const handler = async (event: any) => {
  let config;
  try { config = appReadConfig(); }
  catch { return json(503, { error: "Read sign-in is not configured for this site", by: READ_AUTH_UNCONFIGURED }); }

  if (oneLoginActiveFor(process.env.IAOS_ENV)) return oneLogin(event, config);

  if (event.httpMethod === "GET") {
    let expiresAt: string | null = null;
    try { expiresAt = verifyReadSession(readSessionToken(event), config).expiresAt; } catch { expiresAt = null; }
    return json(200, { clientId: config.clientId, signedIn: expiresAt !== null, expiresAt });
  }

  if (event.httpMethod === "POST") {
    try {
      requireReadOrigin(event, config);
      const body = JSON.parse(event.body ?? "null");
      if (!body || Array.isArray(body) || Object.keys(body).join() !== "googleIdToken" || typeof body.googleIdToken !== "string" ||
          !body.googleIdToken || body.googleIdToken.length > 16384) throw new Error("Invalid identity request");
      const email = await verifyGoogleIdToken(body.googleIdToken, config.clientId, config.emails);
      const session = issueReadSession(email, config);
      return json(200, { signedIn: true, expiresAt: session.expiresAt }, { "Set-Cookie": readSessionCookie(session.token) });
    } catch {
      return json(401, { error: "Read sign-in refused" });
    }
  }

  if (event.httpMethod === "DELETE") {
    try { requireReadOrigin(event, config); }
    catch { return json(403, { error: "Read origin refused" }); }
    return json(200, { signedIn: false }, { "Set-Cookie": clearedReadSessionCookie() });
  }

  return json(405, { error: "Method not allowed" });
};

/**
 * B15-29 (INV-137), ONLY while one IAOS sign-in is on (C1 status, design r4 §B-§D):
 *   GET    200 {clientId, signedIn:true, expiresAt, state:"signed_in", handle}   verified-absent revocation
 *          200 {clientId, signedIn:false, expiresAt:null, state:"signed_out"}   no/invalid/sid-less cookie
 *          200 {clientId, signedIn:false, expiresAt:null, state:"revoked"}      VERIFIED revocation (grants nothing)
 *          503 {clientId, state:"unavailable", by:"iaos-session-unavailable"}   anything uncertain -- never signedIn
 *   POST   sign-in exactly as before, plus a fresh random 128-bit session id (sid) in the session
 *   DELETE 410, no Set-Cookie: cookie clearing is retired (a delayed DELETE can no longer erase a newer sign-in);
 *          Sign out is app-signout's server revocation.
 * clientId stays in every GET answer so the sign-in landing page always works without granting data access.
 */
async function oneLogin(event: any, config: ReturnType<typeof appReadConfig>) {
  if (event.httpMethod === "GET") {
    let session: { email: string; expiresAt: string; sid?: string } | null = null;
    try { session = verifyReadSession(readSessionToken(event), config); } catch { session = null; }
    const out = { clientId: config.clientId, signedIn: false, expiresAt: null };
    if (!session || !session.sid) return json(200, { ...out, state: "signed_out" });
    const r = await checkRevocation(session.sid, config.deployment);
    if (r.kind === "revoked") return json(200, { ...out, state: "revoked" });
    if (r.kind !== "absent") return json(503, { clientId: config.clientId, state: "unavailable", by: SESSION_UNAVAILABLE });
    const handle = issueSignoutHandle({ sid: session.sid, expiresAt: session.expiresAt }, config);
    return json(200, { clientId: config.clientId, signedIn: true, expiresAt: session.expiresAt, state: "signed_in", handle });
  }
  if (event.httpMethod === "POST") {
    try {
      requireReadOrigin(event, config);
      const body = JSON.parse(event.body ?? "null");
      if (!body || Array.isArray(body) || Object.keys(body).join() !== "googleIdToken" || typeof body.googleIdToken !== "string" ||
          !body.googleIdToken || body.googleIdToken.length > 16384) throw new Error("Invalid identity request");
      const email = await verifyGoogleIdToken(body.googleIdToken, config.clientId, config.emails);
      const session = issueReadSession(email, config, Date.now(), randomBytes(16).toString("base64url"));
      return json(200, { signedIn: true, expiresAt: session.expiresAt }, { "Set-Cookie": readSessionCookie(session.token) });
    } catch {
      return json(401, { error: "Read sign-in refused" });
    }
  }
  if (event.httpMethod === "DELETE") return json(410, { error: "Sign out is handled by app-signout" });
  return json(405, { error: "Method not allowed" });
}
