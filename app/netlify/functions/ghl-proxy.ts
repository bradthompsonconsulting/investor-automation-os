/**
 * GHL API proxy — server-side function, holds the GHL token.
 *
 * The browser client calls /.netlify/functions/ghl-proxy?path=/contacts/...
 * This function forwards the request to GHL with the API key and returns
 * the response. The key is NEVER sent to the client.
 *
 * GATE 1 (2026-08-18) — positive (method, path) allowlist. A request that
 * does not match an allowlisted pair is refused 403 BEFORE any outbound
 * request and before the token is read.
 *
 * Why an allowlist and not a secret: this function is browser-facing, and a
 * shared secret shipped to the browser is not a secret. Constraining the
 * surface is the available control.
 *
 * The allowlist is derived from every call site as of f0afafc — the three
 * fetch sites in app/src/lib/ghl.ts and the GET/PUT traffic in
 * app/scripts/*.cjs. A new call site requires a matching entry here or it
 * fails 403. app/scripts/verify-proxy-boundary.cjs asserts the refusals.
 *
 * What this does NOT close: an anonymous caller may still issue the
 * allowlisted writes. That residual needs site-level access control or the
 * deferred multi-tenant OAuth work. Do NOT record this as authenticated.
 *
 * CORS is not the control — it is browser-enforced and a non-browser caller
 * ignores it. Retained unchanged so the app keeps working.
 *
 * getConfig is called at module scope deliberately. If the selector is
 * missing this function dies at load, which is unambiguous. A per-request
 * fallback would silently refuse everything, which looks identical to the
 * allowlist working correctly.
 *
 * Env vars required (set in Netlify site env):
 *   GHL_PRIVATE_API_KEY — the GHL private integration token. REQUIRED, with no
 *   fallback and no default, matching getConfig's "there is no default"
 *   doctrine. A missing value is REFUSED before any outbound request rather
 *   than substituted from a second variable.
 *   IAOS_ENV — PB-D51 selector; scopes which location's paths are permitted.
 */

import { getConfig } from "../../shared/ghl-config";

const GHL_BASE = "https://services.leadconnectorhq.com";
// PB-D51 — location id resolved once at module scope from the shared config.
const { locationId: LOCATION_ID } = getConfig(process.env.IAOS_ENV);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

// A GHL identifier: alphanumeric with - and _, bounded. Deliberately
// excludes "/" and "." so no entry can match extra path segments or
// traversal sequences.
const ID = "[A-Za-z0-9_-]{1,64}";

/** Allowlisted pathnames per method. Anchored, whole-string matches. */
const ALLOW: Record<string, RegExp[]> = {
  GET: [
    new RegExp(`^/contacts$`),
    new RegExp(`^/contacts/${ID}$`),
    new RegExp(`^/contacts/${ID}/notes$`),
    new RegExp(`^/locations/${ID}/customFields$`),
    new RegExp(`^/locations/${ID}/customFields/${ID}$`),
    new RegExp(`^/opportunities/pipelines$`),
    new RegExp(`^/opportunities/search$`),
    new RegExp(`^/opportunities/${ID}$`),
  ],
  PUT: [
    new RegExp(`^/contacts/${ID}$`),
    new RegExp(`^/opportunities/${ID}$`),
    new RegExp(`^/contacts/${ID}/tasks/${ID}/completed$`),
  ],
  POST: [
    new RegExp(`^/contacts/${ID}/notes$`),
  ],
};

/**
 * Every location id appearing in the path or the query must be the one this
 * deployment is configured for.
 */
function locationIsPermitted(
  pathname: string,
  query: URLSearchParams,
): boolean {
  const seg = pathname.match(new RegExp(`^/locations/(${ID})`));
  if (seg && seg[1] !== LOCATION_ID) return false;
  for (const key of ["locationId", "location_id", "locationid"]) {
    const v = query.get(key);
    if (v !== null && v !== LOCATION_ID) return false;
  }
  return true;
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const raw = event.queryStringParameters?.path ?? "";
  if (!raw) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Missing path param" }),
    };
  }

  // The path param arrives already URL-decoded, so its own query string is
  // present verbatim. Split it so the pathname can be matched exactly.
  const qIndex   = raw.indexOf("?");
  const pathname = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query    = new URLSearchParams(
    qIndex === -1 ? "" : raw.slice(qIndex + 1),
  );

  const method  = event.httpMethod;
  const rules   = ALLOW[method];
  const allowed =
    Array.isArray(rules) &&
    rules.some((re) => re.test(pathname)) &&
    locationIsPermitted(pathname, query);

  if (!allowed) {
    // Deliberately uniform: the caller learns "refused", not which rule it
    // failed. The `by` marker exists so a refusal from THIS allowlist is
    // distinguishable from a 403 originating upstream at GHL — OBSERVED
    // 2026-08-18, GHL answers 403 for a foreign location id, so status alone
    // cannot prove which layer refused. verify-proxy-boundary.cjs asserts it.
    return {
      statusCode: 403,
      headers: CORS,
      body: JSON.stringify({ error: "Forbidden", by: "iaos-proxy-allowlist" }),
    };
  }

  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) {
    // REQUIRED, no fallback. Before this guard existed the missing-credential
    // path built `Bearer undefined` and sent it upstream, so the failure
    // surfaced as a GHL 401 rather than as our own misconfiguration. Refuse
    // here, before the outbound request.
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }),
    };
  }

  const url   = `${GHL_BASE}${raw}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    },
    body: ["POST", "PUT"].includes(method) && event.body ? event.body : undefined,
  });

  const body = await res.text();
  return {
    statusCode: res.status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body,
  };
};
