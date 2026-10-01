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
 * ISOLATE BEFORE NAVIGATING. The window is opened blank (same-origin), its
 * `opener` is cleared and then VERIFIED null, and only then is it sent to
 * GHL. If isolation cannot be verified the blank window is closed and the
 * handoff fails closed, so GHL never loads with a live reference back to
 * IAOS. Passing "noopener" to window.open is not used because the browser
 * then always returns null, which would hide a blocked popup.
 */
export type GhlHandoffResult = "opened" | "blocked" | "isolation-failed";

export interface HandoffWindow {
  opener: unknown;
  location: { replace(url: string): void };
  close(): void;
}

type WindowOpener = (url: string, target: string) => HandoffWindow | null;

function closeQuietly(win: HandoffWindow): void {
  try {
    win.close();
  } catch {
    // Nothing further can be done; the caller still reports failure.
  }
}

export function openGhlContactWindow(url: string, open: WindowOpener): GhlHandoffResult {
  const win = open("about:blank", "_blank");
  if (!win) return "blocked";

  try {
    win.opener = null;
  } catch {
    // Verified below; an assignment that throws must not count as isolation.
  }
  let isolated = false;
  try {
    isolated = win.opener === null;
  } catch {
    isolated = false;
  }
  if (!isolated) {
    closeQuietly(win);
    return "isolation-failed";
  }

  try {
    win.location.replace(url);
  } catch {
    closeQuietly(win);
    return "isolation-failed";
  }
  return "opened";
}
