/**
 * B15-29 (activation plan section 1; Jeff work order T1/T2) -- the gate every Test-only probe function passes FIRST,
 * before any authentication, body handling, Blob or network access.
 *
 * Open ONLY when: IAOS_ENV is exactly "test", AND the platform's runtime site id is the PINNED Test site
 * (shared/ghl-config.ts SESSION_REVOCATION_SITE_IDS.test) by lib/runtime-site.ts runtimeSiteIs -- the session
 * authority's own rule: one distinct value across headers and multiValueHeaders (a platform event carries it in both),
 * under the lowercase key connectLambda reads -- AND the request carries no
 * query string and no base64 body. Everything else -- Production, any other env, the wrong or a missing site, a
 * query selector -- gets a bare 404, so in Production these functions are indistinguishable from absent ones. No
 * header, query or body value selects behaviour.
 */
import { SESSION_REVOCATION_SITE_IDS } from "../../../shared/ghl-config";
import { runtimeSiteIs } from "./runtime-site";

export const PROBE_NOT_FOUND = { statusCode: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }, body: "Not Found" };

/** True only for the pinned Test deployment with a clean request shape. Never throws. */
export function testProbeGateOpen(event: any, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (env.IAOS_ENV !== "test") return false;
    if (!runtimeSiteIs(event, SESSION_REVOCATION_SITE_IDS.test)) return false;
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
