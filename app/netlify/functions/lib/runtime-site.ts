/**
 * B15-29 -- the ONE reader of request headers by name, and of the platform's runtime site id (x-nf-site-id), shared by
 * the session authority (lib/session-revocation.ts) and the Test-only probe gate (lib/test-probe-gate.ts) so the two
 * can never diverge again.
 *
 * Release 15-F dark check (Jeff, 2026-11-10): on the real Test site every probe answered 404. A Lambda-compatible
 * platform event carries a header in BOTH `event.headers` and `event.multiValueHeaders`; the gate collected both maps
 * without de-duplicating, saw the one site id twice, and stayed closed. The session authority already de-duplicated.
 *
 * Rules (the session authority's, unchanged): values are collected from both maps under a case-insensitive name and
 * de-duplicated; two DIFFERENT values are ambiguous (refused); and the value must also sit under the exact lowercase
 * key in `event.headers`, which is the one @netlify/blobs connectLambda reads. No header value selects behaviour beyond
 * matching the pin. Never throws.
 */

/** The platform's runtime site id header (the one @netlify/blobs connectLambda reads). */
export const RUNTIME_SITE_HEADER = "x-nf-site-id";

/** Every distinct value of header `wanted` (lowercase) across `event.headers` and `event.multiValueHeaders`. */
export function headerValues(event: any, wanted: string): unknown[] {
  const found: unknown[] = [];
  try {
    for (const [name, value] of Object.entries(event?.headers ?? {})) if (name.toLowerCase() === wanted) found.push(value);
    for (const [name, values] of Object.entries(event?.multiValueHeaders ?? {})) {
      if (name.toLowerCase() === wanted) found.push(...(Array.isArray(values) ? values : [values]));
    }
  } catch { return [undefined, null]; }   // an unreadable event is ambiguous, never a match
  return [...new Set(found)];
}

/**
 * True only when the runtime site id is exactly `pin`: one distinct value across both header maps, equal to the pin,
 * AND present under the lowercase key of `event.headers` with that value.
 */
export function runtimeSiteIs(event: any, pin: unknown): boolean {
  if (typeof pin !== "string" || pin.length === 0) return false;
  const values = headerValues(event, RUNTIME_SITE_HEADER);
  return values.length === 1 && values[0] === pin && event?.headers?.[RUNTIME_SITE_HEADER] === pin;
}
