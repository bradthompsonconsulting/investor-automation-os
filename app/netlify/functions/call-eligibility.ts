/**
 * AirDroid call eligibility — server-side, READ-ONLY.
 *
 * GET /.netlify/functions/call-eligibility?contactId={contactId}
 *
 * Seller Call's two AirDroid buttons ask this, at click time, whether the
 * handoff may proceed. It makes exactly ONE fresh GHL request,
 * `GET /contacts/{id}` (the immediate single-record endpoint, as ghl-contact
 * uses), bounded by a provider timeout, and evaluates it with the one rule in
 * lib/call-eligibility-rule.ts. No writes, no Blob, no other provider.
 *
 * Response (200): { decision, contactId, phoneDigits, readAt }. A GHL error,
 * timeout or unreadable body answers decision "unknown", which blocks the
 * handoff. Read authority is Brad's application read session, as for the
 * other read functions (lib/app-read-auth.ts). Personal data is never cached.
 */
import { readAuthRefusal } from "./lib/app-read-auth";
import { getConfig } from "../../shared/ghl-config";
import { evaluateCallEligibility } from "./lib/call-eligibility-rule";

const GHL_BASE = "https://services.leadconnectorhq.com";
export const PROVIDER_TIMEOUT_MS = 5000;

// Same-origin only: no CORS grant.
const RESPONSE_HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const CONTACT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: RESPONSE_HEADERS, body: JSON.stringify(body) };
}

export const handler = async (event: any) => {
  const refused = readAuthRefusal(event);
  if (refused) return refused;
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });

  const contactId = event.queryStringParameters?.contactId;
  if (typeof contactId !== "string" || !CONTACT_ID.test(contactId)) return json(400, { error: "Missing or invalid contactId" });

  const unknown = () => json(200, { decision: "unknown", contactId, phoneDigits: null, readAt: new Date().toISOString() });

  let expected: { locationId: string; phoneStatusFieldId: string };
  try {
    const config = getConfig(process.env.IAOS_ENV);
    expected = { locationId: config.locationId, phoneStatusFieldId: config.fields.phoneStatus };
  } catch {
    return json(503, { decision: "unknown", contactId, phoneDigits: null, readAt: new Date().toISOString() });
  }
  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) return json(503, { decision: "unknown", contactId, phoneDigits: null, readAt: new Date().toISOString() });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROVIDER_TIMEOUT_MS);
  let body: unknown;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
      signal: abort.signal,
    });
    // Exactly 200 (Bones F1): another success status (201, 202, 204, ...) is not the documented read and is unknown.
    if (res.status !== 200) return unknown();
    body = await res.json();
  } catch {
    return unknown();
  } finally {
    clearTimeout(timer);
  }

  const readAt = new Date().toISOString();
  return json(200, { ...evaluateCallEligibility(body, contactId, expected), readAt });
};
