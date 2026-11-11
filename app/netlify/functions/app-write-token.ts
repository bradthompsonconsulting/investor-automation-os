/**
 * SECURITY -- B15-29 (INV-137) one IAOS sign-in. Issues the existing 900 s
 * application-write (saving) token from the signed-in IAOS session, so saving
 * needs no second Google sign-in and survives a page reload. Ported from the
 * Phase 1 candidate 7f7c7c9; the server-side revocation check is new.
 *
 * OFF (one IAOS sign-in disabled for this IAOS_ENV, the committed state of BOTH
 * environments): 404 before configuration, authentication or any I/O.
 *
 *   POST, empty body -> { token, expiresAt, expiresInSeconds }
 *
 * Every check is independent and each one alone refuses (no token is issued;
 * nothing is logged -- no cookie, token, email or reason):
 *   1. cross-site protection, all required: exactly one Origin equal to the
 *      read session's configured origin (requireReadOrigin) AND accepted by
 *      the write boundary (requireAppWriteOrigin); Sec-Fetch-Site, when sent,
 *      is "same-origin"; the custom header X-IAOS-Session: saving-token (a
 *      cross-site page cannot send it without a CORS preflight this function
 *      never grants); no request body;
 *   2. session validity: the one __Host-iaos_read cookie verifies (signature,
 *      audience, the fixed 30-day one-sign-in lifetime, expiry, read allowlist)
 *      AND carries a session id, epoch and both store ETags -- a session
 *      without them is refused (D6);
 *   3. environment separation: the session's env claim equals THIS IAOS_ENV;
 *      the token is signed with this deployment's IAOS_APP_WRITE_SESSION_SECRET
 *      and carries env + sid claims;
 *   4. saving authorization: the email is on IAOS_APP_WRITE_BRAD_EMAILS, AND
 *      the authorization seam (lib/authorization.ts, "write") allows it;
 *   5. the store check (C1, r5 conditional-write authority) answered ACTIVE
 *      within the deadline. Revoked (412) -> 401 reason "revoked"; anything
 *      else / late -> 503 iaos-session-unavailable. Never a token on
 *      uncertainty.
 * The token never outlives the session (r6): it carries pexp = the session's
 * fixed expiry, writers refuse it after pexp, and expiresAt / expiresInSeconds
 * report min(900 s, time left in the session). Minting never extends the
 * session (no Set-Cookie).
 * Exact Origin alone never authorizes anything.
 *
 * The token is only a prerequisite (Variant S): every write function still
 * runs its unchanged requireAppWriter, its Origin and per-save checks, AND its
 * own revocation check (sessionWriteRefusal), so a token issued before Sign out
 * is refused by any write checked after the revocation committed.
 */
import { appReadConfig, readSessionToken, requireReadOrigin, verifyReadSession } from "./lib/app-read-auth";
import { appAuthConfig, issueBoundAppSession } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { checkSession, requireSameSiteRequest, sessionBound, sessionUnavailableResponse } from "./lib/session-revocation";
import { authorize } from "./lib/authorization";
import { oneLoginActiveFor } from "../../shared/ghl-config";

export const SAVING_TOKEN_HEADER_VALUE = "saving-token";
export const SAVING_TOKEN_REFUSED = "iaos-app-saving-token";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { ...HEADERS }, body: JSON.stringify(body) });

export const handler = async (event: any) => {
  if (!oneLoginActiveFor(process.env.IAOS_ENV)) return json(404, { error: "Not found" });
  let readConfig;
  try { readConfig = appReadConfig(); appAuthConfig(); }
  catch { return json(503, { error: "Saving is not configured for this site", by: SAVING_TOKEN_REFUSED }); }

  if (event?.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    requireReadOrigin(event, readConfig);
    requireAppWriteOrigin(event);
    requireSameSiteRequest(event, SAVING_TOKEN_HEADER_VALUE);
    if (event.body !== undefined && event.body !== null && event.body !== "") throw new Error("No request body is accepted");
  } catch {
    return json(403, { error: "Saving-token request refused", by: SAVING_TOKEN_REFUSED });
  }

  let session: { email: string; expiresAt: string; sid?: string; epoch?: string; aetag?: string; setag?: string };
  try {
    session = verifyReadSession(readSessionToken(event), readConfig);
    if (!appAuthConfig().emails.includes(session.email)) throw new Error("Not a saving operator");
  } catch {
    return json(401, { error: "Sign in to IAOS to save", by: SAVING_TOKEN_REFUSED });
  }
  // No sid, epoch or store ETags: the session cannot be checked or revoked -- sign in again.
  if (!sessionBound(session)) return json(401, { error: "Sign in to IAOS to save", by: SAVING_TOKEN_REFUSED, reason: "sign_in_again" });
  // r6: authorization is its own layer, evaluated on every mint in addition to the session check.
  if (!authorize({ sub: session.email, email: session.email }, "write").ok) return json(403, { error: "This account may not save in IAOS", by: SAVING_TOKEN_REFUSED, reason: "not_authorized" });

  // Outside the credential catch: an unreadable store is never reported as a sign-in problem (C1).
  const status = await checkSession(session, readConfig.deployment, { event });
  if (status.kind === "revoked") return json(401, { error: "Signed out of IAOS", by: SAVING_TOKEN_REFUSED, reason: "revoked" });
  if (status.kind !== "active") return sessionUnavailableResponse();

  try {
    const now = Date.now();
    const pexp = Math.floor(Date.parse(session.expiresAt) / 1000);
    const issued = issueBoundAppSession(session.email, { env: readConfig.deployment, sid: session.sid as string, pexp, epoch: session.epoch as string,
      aetag: session.aetag as string, setag: session.setag as string }, process.env, now);
    // The token never outlives the session: its usable life is min(900 s, the session's time left).
    const usableUntil = Math.min(Date.parse(issued.expiresAt), pexp * 1000);
    // expiresInSeconds lets the browser time the token from when it arrived, so a
    // computer clock that is off by minutes never makes a fresh token look expired.
    return json(200, { token: issued.token, expiresAt: new Date(usableUntil).toISOString(), expiresInSeconds: Math.floor((usableUntil - now) / 1000) });
  } catch {
    return json(401, { error: "Sign in to IAOS to save", by: SAVING_TOKEN_REFUSED });
  }
};
