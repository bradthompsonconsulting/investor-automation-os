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
 * GATE 2 (2026-09-11, B9-08 / INV-63; NARROWED 2026-09-12, Jess Gate
 * correction round 2) — the two `/proposals/...` paths still reachable
 * here (GHL Documents & Contracts, the selected V1 e-sign provider) are
 * READ-ONLY discovery/readback and get one additive restriction beyond
 * the plain path allowlist above:
 *   LOCATION ASSERTION. `LOCATION_ID` (resolved from `IAOS_ENV`, same as
 *   every other path) must equal the TEST location's own id — resolved
 *   via `getConfig("test")`, never hardcoded here, so no GHL identifier
 *   literal exists in this file (`scripts/test-identifier-boundary.cjs`
 *   enforces that same-file boundary independently).
 *
 * `POST /proposals/templates/send` — the ONE send-capable path — IS NO
 * LONGER REACHABLE THROUGH THIS PROXY AT ALL, by design (Jess Gate
 * correction round 2). It moved entirely to its own dedicated function,
 * `ghl-contract-send-execute.ts`, which requires a valid, unconsumed,
 * exact-revision reservation ticket (`ghl-contract-send-reserve.ts`,
 * itself gated on a check that a matching Brad-authorization note
 * currently exists -- BEST-EFFORT, single-user V1 protection only, per
 * Product Owner ruling 2026-09-12; NOT atomic, NOT authenticated
 * identity, NOT a guarantee of single-use or at-most-once sending — see
 * that file's own header) before it will forward anything to GHL. A
 * direct call to THIS proxy
 * with `?path=/proposals/templates/send` now simply falls through to
 * "not allowlisted" (403) — there is no override/recipient/sender/
 * population logic left in this file to bypass, because there is no
 * longer a send-capable code path here for any of that logic to gate.
 * `Version: v3` (not this proxy's usual `2021-07-28`) is required by
 * both remaining `/proposals/...` endpoints, confirmed directly from
 * their own reference pages.
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
// GATE 2 — the TEST location's own id, resolved independently of the
// CURRENT IAOS_ENV, so the /proposals/... location assertion below can
// compare "is this deployment actually Test" without ever hardcoding a
// GHL identifier literal in this file.
const TEST_LOCATION_ID = getConfig("test").locationId;

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
    // GATE 2 / B9-08 — GHL Documents & Contracts, read-only template
    // discovery and document readback. Both still gated by the location
    // assertion below; discovery carries no recipient to override.
    new RegExp(`^/proposals/templates$`),
    new RegExp(`^/proposals/document$`),
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

/** The two remaining GATE 2 paths (read-only discovery/readback) -- each requires the location assertion below. The one send-capable path is no longer reachable through this proxy at all -- see `ghl-contract-send-execute.ts`. */
const PROPOSALS_PATH = new RegExp(`^/proposals/`);

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

  // GATE 2 / B9-08 — location assertion. `locationIsPermitted` above only
  // inspects the query string; `/proposals/templates/send`'s own
  // documented request body carries `locationId` as a BODY field, which
  // that check never sees. This is a direct, path-specific,
  // env-independent-of-request-content check instead: this deployment
  // must actually BE Test, full stop, for any /proposals/... path.
  if (PROPOSALS_PATH.test(pathname) && LOCATION_ID !== TEST_LOCATION_ID) {
    return {
      statusCode: 403,
      headers: CORS,
      body: JSON.stringify({ error: "Forbidden", by: "iaos-proxy-documents-contracts-test-only" }),
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

  const outboundBody: string | undefined =
    ["POST", "PUT"].includes(method) && event.body ? event.body : undefined;

  // GATE 2 / B9-08 — /proposals/... requires Version: v3, confirmed
  // directly from each endpoint's own reference page; every other
  // allowlisted path keeps the existing 2021-07-28 contract unchanged.
  const versionHeader = PROPOSALS_PATH.test(pathname) ? "v3" : "2021-07-28";

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: versionHeader,
      "Content-Type": "application/json",
    },
    body: outboundBody,
  });

  const body = await res.text();
  return {
    statusCode: res.status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body,
  };
};
