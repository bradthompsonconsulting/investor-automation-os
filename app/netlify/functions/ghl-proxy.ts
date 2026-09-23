/** INV-95 read-only GHL proxy. All writes require authenticated named operations.
 * Documents reads remain Test-only. IAOS_ENV and GHL_PRIVATE_API_KEY are required. */
import { getConfig } from "../../shared/ghl-config";
import { readAuthRefusal } from "./lib/app-read-auth";

const GHL_BASE = "https://services.leadconnectorhq.com";
// PB-D51 — location id resolved once at module scope from the shared config.
const { locationId: LOCATION_ID } = getConfig(process.env.IAOS_ENV);
// GATE 2 — the TEST location's own id, resolved independently of the
// CURRENT IAOS_ENV, so the /proposals/... location assertion below can
// compare "is this deployment actually Test" without ever hardcoding a
// GHL identifier literal in this file.
const TEST_LOCATION_ID = getConfig("test").locationId;

// Same-origin only: no CORS grant. Reads are authorized by the SameSite=Strict
// read-session cookie, and personal data is never cached.
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

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

};

/** The two remaining GATE 2 paths (read-only discovery/readback) -- each requires the location assertion below. V1 has no automated template-send path; reserve/execute are refusal-only endpoints. */
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
    const values = query.getAll(key);
    if (values.length > 1 || values.some(v => v !== LOCATION_ID)) return false;
  }
  return true;
}

export const handler = async (event: any) => {
  // SECURITY: Brad's application read session is required before any GHL
  // request. Missing read configuration answers 503; a missing or invalid
  // session answers 401. See lib/app-read-auth.ts.
  const refused = readAuthRefusal(event);
  if (refused) return refused;
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET" || (event.body !== undefined && event.body !== null && event.body !== "") || Object.keys(event.queryStringParameters ?? {}).some(k=>k!=="path")) return { statusCode: 403, headers: RESPONSE_HEADERS, body: JSON.stringify({ error: "Writes require named operations", by: "iaos-proxy-allowlist" }) };
  const raw = event.queryStringParameters?.path ?? "";
  if (!raw) {
    return {
      statusCode: 400,
      headers: RESPONSE_HEADERS,
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
      headers: RESPONSE_HEADERS,
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
      headers: RESPONSE_HEADERS,
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
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }),
    };
  }

  const url   = `${GHL_BASE}${raw}`;



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

  });

  const body = await res.text();
  return {
    statusCode: res.status,
    headers: { ...RESPONSE_HEADERS, "Content-Type": "application/json" },
    body,
  };
};
