/**
 * GHL API proxy — server-side function, holds GHL_API_TOKEN.
 *
 * The browser client calls /.netlify/functions/ghl-proxy?path=/contacts/...
 * This function forwards the request to GHL with the API key and returns
 * the response. The key is NEVER sent to the client.
 *
 * Phase A: passes through any GHL path. Single-user, wide open.
 * Phase B: validate OAuth token here before forwarding; key auth stays here.
 *
 * Env vars required (set in Netlify site env):
 *   GHL_API_TOKEN — GHL private integration token
 */

const GHL_BASE = "https://services.leadconnectorhq.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const path = event.queryStringParameters?.path ?? "";
  if (!path) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing path param" }) };
  }

  const url = `${GHL_BASE}${path}`;

  const res = await fetch(url, {
    method: event.httpMethod,
    headers: {
      Authorization: `Bearer ${process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    },
    body: ["POST", "PUT"].includes(event.httpMethod) && event.body ? event.body : undefined,
  });

  const body = await res.text();
  return {
    statusCode: res.status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body,
  };
};
