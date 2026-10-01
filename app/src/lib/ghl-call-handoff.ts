/**
 * B14-11 / INV-93 — Seller Call's GHL Phone handoff.
 *
 * GHL Phone is the calling and call-record system of record. GHL's public
 * API cannot place a call and exposes no dialer deep-link, so the handoff
 * opens the seller's GHL contact record in a new window, beside IAOS, and
 * the operator dials from GHL's own Web Dialer there.
 *
 * NAVIGATION ONLY. Opening the window writes nothing to GHL or IAOS and is
 * never evidence that a call was placed, connected or completed. The
 * operator confirms the GHL contact identity before dialing; the URL is the
 * page's own contact id, but that is not treated as proof of identity.
 *
 * Why not window.open(url, "_blank", "noopener"): with that feature the
 * browser always returns null, which would make a blocked popup
 * indistinguishable from a successful one. Opening without it and severing
 * `opener` afterwards keeps the same isolation and lets a blocked popup
 * report itself.
 */
export type GhlHandoffResult = "opened" | "blocked";

type WindowOpener = (url: string, target: string) => { opener: unknown } | null;

export function openGhlContactWindow(url: string, open: WindowOpener): GhlHandoffResult {
  const opened = open(url, "_blank");
  if (!opened) return "blocked";
  try {
    opened.opener = null;
  } catch {
    // Cross-origin assignment can throw in some browsers; the window is open either way.
  }
  return "opened";
}
