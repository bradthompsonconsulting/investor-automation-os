/**
 * GHL Contacts — server-side function. Requires GHL_PRIVATE_API_KEY; no fallback.
 *
 * GET /.netlify/functions/ghl-contacts
 * Returns all contacts in the location with their three score fields,
 * paging through the GHL API server-side so the client gets one flat array.
 */

import { parseContact } from "./lib/contact-parse";
import { getConfig } from "../../shared/ghl-config";
import { readAuthRefusal } from "./lib/app-read-auth";

const GHL_BASE    = "https://services.leadconnectorhq.com";
// PB-D51 — location id resolved once at module scope from the shared config.
const { locationId: LOCATION_ID } = getConfig(process.env.IAOS_ENV);

// Same-origin only: no CORS grant. Reads are authorized by the SameSite=Strict
// read-session cookie, and personal data is never cached.
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchAllContacts(token: string): Promise<any[]> {
  const all: any[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  while (true) {
    const params = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);
    if (startAfter)   params.set("startAfter",   String(startAfter));

    const res  = await fetch(`${GHL_BASE}/contacts?${params}`, { headers: headers(token) });
    const body = await res.json();

    if (!res.ok) throw new Error(`GET /contacts → ${res.status}: ${JSON.stringify(body)}`);

    const batch: any[] = body.contacts ?? [];
    all.push(...batch);

    const meta = body.meta ?? {};
    if (!meta.startAfterId || batch.length < 100) break;
    startAfterId = meta.startAfterId;
    startAfter   = meta.startAfter;
    await delay(110); // stay under 10 req/sec
  }

  return all;
}

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
    const raw = await fetchAllContacts(token);

    const contacts = raw.map(parseContact);

    return {
      statusCode: 200,
      headers: { ...RESPONSE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(contacts),
    };
  } catch (err: any) {
    console.error("[ghl-contacts]", err);
    return {
      statusCode: 500,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: err.message ?? "Internal error" }),
    };
  }
};
