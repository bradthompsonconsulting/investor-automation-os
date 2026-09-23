/**
 * SECURITY -- browser side of the application read session.
 *
 * The session itself is the HttpOnly `__Host-iaos_read` cookie set by
 * /.netlify/functions/app-read-session. This module never sees, stores or
 * forwards it: same-origin fetches carry it automatically, and nothing here
 * touches localStorage, sessionStorage or IndexedDB.
 */
export const READ_SESSION_ENDPOINT = "/.netlify/functions/app-read-session";
/** Fired on window whenever a GHL read is refused for sign-in (401) or configuration (503). */
export const READ_SESSION_LOST_EVENT = "iaos-read-session-lost";

/** A GHL read refused by the read-auth boundary itself -- not an upstream GHL failure. */
export class ReadUnavailableError extends Error {
  constructor(readonly status: number, label: string) {
    super(`${label}: ${status === 503
      ? "read sign-in is not configured for this site."
      : "read sign-in required. Sign in to read, then refresh."}`);
  }
}

const REFUSAL_MARKERS: Record<number, string> = { 401: "iaos-app-read-auth", 503: "iaos-app-read-unconfigured" };

/**
 * True only for a refusal from the read-auth boundary itself, identified by
 * its `by` marker. ghl-proxy passes GHL's own status through, so a bare 401
 * or 503 could be an upstream failure and is NOT treated as a sign-in problem.
 */
export async function isReadAuthRefusal(res: Response): Promise<boolean> {
  const marker = REFUSAL_MARKERS[res.status];
  if (!marker) return false;
  try { return (await res.clone().json())?.by === marker; } catch { return false; }
}

/** Fetch one of the nine GHL read functions. Signals the gate on a read-auth refusal. */
export async function readFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, credentials: "same-origin" });
  if (typeof window !== "undefined" && await isReadAuthRefusal(res)) {
    window.dispatchEvent(new Event(READ_SESSION_LOST_EVENT));
  }
  return res;
}
