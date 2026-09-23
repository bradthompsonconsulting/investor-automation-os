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

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (statusCode: number, body: unknown, extra: Record<string, string> = {}) =>
  ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

export const handler = async (event: any) => {
  let config;
  try { config = appReadConfig(); }
  catch { return json(503, { error: "Read sign-in is not configured for this site", by: READ_AUTH_UNCONFIGURED }); }

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
