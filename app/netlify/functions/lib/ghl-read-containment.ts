/**
 * SECURITY CONTAINMENT -- unauthenticated GHL read surface.
 *
 * The nine GHL read functions listed in GHL_READ_CONTAINED_FUNCTIONS accepted
 * requests from any caller, with `Access-Control-Allow-Origin: *`, and
 * answered them with the deployment's GHL credential: contact records, notes,
 * conversations, opportunities. Until read authentication ships, every one of
 * those handlers returns this response as its FIRST statement -- before any
 * method, path, or credential handling, and before any GHL request. No header,
 * method, path, or environment reaches GHL through these endpoints.
 *
 * Lifting containment is a separate, Gatekeeper-approved change that replaces
 * this guard with real caller authentication; it is not a flag to flip.
 */
export const GHL_READ_CONTAINMENT_MARKER = "iaos-ghl-read-containment";

export const GHL_READ_CONTAINED_FUNCTIONS = [
  "ghl-proxy",
  "ghl-contacts",
  "ghl-contact",
  "ghl-opportunities",
  "ghl-conversations",
  "ghl-contact-conversations",
  "ghl-calendar-events",
  "ghl-mailers",
  "ghl-underwriting-policy",
] as const;

/** Always a refusal. No CORS headers: nothing here is for a foreign origin. */
export function ghlReadContained() {
  return {
    statusCode: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      error: "GHL reads are temporarily unavailable pending read authentication",
      by: GHL_READ_CONTAINMENT_MARKER,
    }),
  };
}
