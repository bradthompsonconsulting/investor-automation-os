/**
 * SECURITY -- B15-29 (INV-137) acknowledged Sign out (design r4 §B, §D).
 *
 * OFF (one IAOS sign-in disabled for this IAOS_ENV, the committed state of BOTH
 * environments): 404 before configuration, authentication or any I/O.
 *
 *   POST {"handle": "<revoke-only handle>"}
 *     200 {state:"revoked"}         ONLY after a verified revocation of the
 *                                   handle's sid (conditional create + strong
 *                                   readback of a valid record, or an existing
 *                                   valid record: idempotent)
 *     503 {state:"not_confirmed"}   storage unavailable / uncertain / deadline
 *     400 {state:"not_confirmed"}   missing, malformed, expired or foreign handle
 *     403 / 405                     cross-site request, wrong method
 *
 * Requirements: exact read Origin, Sec-Fetch-Site same-origin when sent,
 * X-IAOS-Session: sign-out, a JSON body of exactly {handle}. The target is the
 * sid signed into the handle -- NEVER the current cookie -- so a retry after a
 * fresh sign-in can only revoke the old session. No outcome sets or clears a
 * cookie (no Set-Cookie at all): the old HttpOnly cookie is left inert by the
 * revocation that every reader, token issue and writer checks. Nothing is
 * logged (no handle, cookie or reason).
 */
import { appReadConfig, requireReadOrigin } from "./lib/app-read-auth";
import { recordRevocation, requireSameSiteRequest, verifySignoutHandle } from "./lib/session-revocation";
import { oneLoginActiveFor } from "../../shared/ghl-config";

export const SIGN_OUT_HEADER_VALUE = "sign-out";
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { ...HEADERS }, body: JSON.stringify(body) });

export const handler = async (event: any) => {
  if (!oneLoginActiveFor(process.env.IAOS_ENV)) return json(404, { error: "Not found" });
  let config;
  try { config = appReadConfig(); }
  catch { return json(503, { state: "not_confirmed", error: "Sign-out is not configured for this site" }); }
  if (event?.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try {
    requireReadOrigin(event, config);
    requireSameSiteRequest(event, SIGN_OUT_HEADER_VALUE);
  } catch {
    return json(403, { state: "not_confirmed", error: "Sign-out request refused" });
  }
  let sid: string;
  try {
    if (event.isBase64Encoded || typeof event.body !== "string" || event.body.length > 2048) throw new Error("body");
    const body = JSON.parse(event.body);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "handle") throw new Error("body");
    ({ sid } = verifySignoutHandle(body.handle, config));
  } catch {
    return json(400, { state: "not_confirmed", error: "IAOS could not verify this Sign out" });
  }
  const result = await recordRevocation(sid, config.deployment);
  if (result.kind === "verified") return json(200, { state: "revoked" });
  return json(503, { state: "not_confirmed", error: "IAOS could not verify this Sign out", by: "iaos-session-unavailable" });
};
