/**
 * Underwriting policy — server-side function. Holds GHL_API_TOKEN.
 *
 * GET /.netlify/functions/ghl-underwriting-policy
 * Returns ONLY the eleven investor-policy Custom Values named in shared
 * config, as { values: [{ id, value }] }.
 *
 * PB-D57 authorizes this endpoint to ship without inbound authentication
 * during the single-tenant phase, on three conditions it must keep meeting:
 * read-only, no write capability, and a response restricted by POSITIVE
 * allowlist to non-secret, non-personal data.
 *
 * The positive allowlist is a construction rule, not a preference. PB-D56
 * section VIII records `iaos_webhook_secret` as living in this same Custom
 * Values store in plaintext. Filtering by exclusion -- returning everything
 * except a known-sensitive value -- is NOT permitted here: under a positive
 * allowlist, a newly created sensitive value is harmlessly omitted, while
 * under a negative filter the same oversight is browser exposure.
 *
 * The allowlist is derived from getConfig().customValues rather than
 * hardcoded, so no identifier can be served that is not already in shared
 * configuration, and PB-D51 remains the single source of identifiers.
 *
 * Response shape matches the resolver's PolicyValue[] contract. Parsing,
 * unit conversion, malformed-vs-absent handling and the still-UNKNOWN
 * financing-Off representation all remain parsePolicy's responsibility.
 * This function does not interpret values; it selects and returns them.
 */

import { getConfig } from "../../shared/ghl-config";

const GHL_BASE = "https://services.leadconnectorhq.com";
// PB-D51 — resolved once at module scope from the shared config.
const CONFIG = getConfig(process.env.IAOS_ENV);
const LOCATION_ID = CONFIG.locationId;

/**
 * The positive allowlist: exactly the eleven ids in customValues. Anything
 * the location holds that is not in this set is excluded by default.
 */
const ALLOWED_IDS = new Set<string>(Object.values(CONFIG.customValues));

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  // GET only. This endpoint has no write path and must never acquire one.
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_API_TOKEN not configured" }) };
  }

  try {
    const res = await fetch(
      `${GHL_BASE}/locations/${LOCATION_ID}/customValues`,
      { headers: headers(token) },
    );
    const body = await res.json();

    if (!res.ok) {
      throw new Error(`GET /customValues → ${res.status}`);
    }

    const all: any[] = body.customValues ?? [];

    // Select by positive allowlist. Nothing else is read from each record --
    // name, fieldKey and locationId are deliberately not forwarded.
    const values = all
      .filter((v: any) => typeof v?.id === "string" && ALLOWED_IDS.has(v.id))
      .map((v: any) => ({ id: v.id as string, value: String(v.value ?? "") }));

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    };
  } catch (err: any) {
    console.error("[ghl-underwriting-policy]", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Internal error" }),
    };
  }
};
