/**
 * B15-29 (activation plan section 1; Jeff work order T1/T2) -- the gate every Test-only probe function passes FIRST,
 * before any authentication, body handling, Blob or network access.
 *
 * Open ONLY when: IAOS_ENV is exactly "test", AND the platform's runtime site id header is present exactly once and
 * equals the PINNED Test site (shared/ghl-config.ts SESSION_REVOCATION_SITE_IDS.test), AND the request carries no
 * query string and no base64 body. Everything else -- Production, any other env, the wrong or a missing site, a
 * query selector -- gets a bare 404, so in Production these functions are indistinguishable from absent ones. No
 * header, query or body value selects behaviour.
 */
import { SESSION_REVOCATION_SITE_IDS } from "../../../shared/ghl-config";

export const PROBE_NOT_FOUND = { statusCode: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }, body: "Not Found" };

function siteHeaderValues(event: any): unknown[] {
  const found: unknown[] = [];
  for (const [name, value] of Object.entries(event?.headers ?? {})) if (name.toLowerCase() === "x-nf-site-id") found.push(value);
  for (const [name, values] of Object.entries(event?.multiValueHeaders ?? {})) {
    if (name.toLowerCase() === "x-nf-site-id") found.push(...(Array.isArray(values) ? values : [values]));
  }
  return found;
}

/** True only for the pinned Test deployment with a clean request shape. Never throws. */
export function testProbeGateOpen(event: any, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (env.IAOS_ENV !== "test") return false;
    const site = siteHeaderValues(event);
    if (site.length !== 1 || site[0] !== SESSION_REVOCATION_SITE_IDS.test) return false;
    if (Object.keys(event?.queryStringParameters ?? {}).length || Object.keys(event?.multiValueQueryStringParameters ?? {}).length) return false;
    if (event?.isBase64Encoded) return false;
    return true;
  } catch { return false; }
}

/** The request body as a plain object whose keys are EXACTLY `keys`, or null. */
export function exactJsonBody(event: any, keys: string[]): Record<string, unknown> | null {
  if (typeof event?.body !== "string" || event.body.length > 512) return null;
  let v: unknown;
  try { v = JSON.parse(event.body); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const got = Object.keys(v as object).sort();
  const want = [...keys].sort();
  return got.length === want.length && got.every((k, i) => k === want[i]) ? (v as Record<string, unknown>) : null;
}
