/**
 * GHL Contact (singular) — server-side function. Holds the GHL token.
 *
 * GET /.netlify/functions/ghl-contact?id={contactId}
 * Returns ONE parsed ContactRow, read from GHL's single-record endpoint
 * (GET /contacts/{id}) — which is immediate, unlike the eventually-consistent
 * list endpoint the plural ghl-contacts function uses (see CONTACT_WORKSPACE_
 * SPEC_v2.md §11). Same parser (parseContact) as the plural function, so the
 * two cannot drift. Read-only — no writes.
 */

import { parseContact } from "./lib/contact-parse";

const GHL_BASE = "https://services.leadconnectorhq.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing id param" }) };
  }

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_API_TOKEN not configured" }) };
  }

  try {
    const res  = await fetch(`${GHL_BASE}/contacts/${id}`, { headers: headers(token) });
    const body = await res.json();

    if (res.status === 404) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Contact not found" }) };
    }
    if (!res.ok) throw new Error(`GET /contacts/${id} → ${res.status}: ${JSON.stringify(body)}`);

    const raw = body.contact ?? body;
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(parseContact(raw)),
    };
  } catch (err: any) {
    console.error("[ghl-contact]", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message ?? "Internal error" }),
    };
  }
};
