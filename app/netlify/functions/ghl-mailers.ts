/**
 * GHL Mailers — server-side function. Holds GHL_PRIVATE_API_KEY.
 *
 * GET /.netlify/functions/ghl-mailers
 * Returns the shared mailer digest (this-week-ready / business-flagged /
 * overdue / no-address), built from live GHL contacts + tasks. Read-only.
 */

import { buildMailerDigest } from "./lib/mailer-shared";
import { readAuthRefusal } from "./lib/app-read-auth";

// Same-origin only: no CORS grant. Reads are authorized by the SameSite=Strict
// read-session cookie, and personal data is never cached.
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

export const handler = async (event: any) => {
  // SECURITY: Brad's application read session is required before any GHL
  // request. Missing read configuration answers 503; a missing or invalid
  // session answers 401. See lib/app-read-auth.ts.
  const refused = readAuthRefusal(event);
  if (refused) return refused;
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: RESPONSE_HEADERS, body: "Method Not Allowed" };

  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) {
    return { statusCode: 500, headers: RESPONSE_HEADERS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };
  }

  try {
    const digest = await buildMailerDigest(token);
    return {
      statusCode: 200,
      headers: { ...RESPONSE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(digest),
    };
  } catch (err: any) {
    console.error("[ghl-mailers]", err);
    return {
      statusCode: 500,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: err.message ?? "Internal error" }),
    };
  }
};
