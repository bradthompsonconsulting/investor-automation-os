/**
 * GHL Mailers — server-side function. Holds GHL_PRIVATE_API_KEY.
 *
 * GET /.netlify/functions/ghl-mailers
 * Returns the shared mailer digest (this-week-ready / business-flagged /
 * overdue / no-address), built from live GHL contacts + tasks. Read-only.
 */

import { buildMailerDigest } from "./lib/mailer-shared";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };
  }

  try {
    const digest = await buildMailerDigest(token);
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(digest),
    };
  } catch (err: any) {
    console.error("[ghl-mailers]", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message ?? "Internal error" }),
    };
  }
};
