/**
 * B15-29 (INV-137) one IAOS sign-in -- browser switch. ONLY the server's
 * runtime configuration turns it on (`oneLogin: { active: true }` from
 * iaos-runtime-config, present only while the server's own config carries
 * ONE_LOGIN_ENABLED). Absent, malformed, or no runtime configuration loaded
 * (offline module tests) -> false, and every caller keeps its previous
 * behaviour exactly. Presentation and request routing only: the server checks
 * everything itself.
 */
import { getRuntimeConfig } from "../../shared/ghl-config";

export function oneLoginActive(runtime?: unknown): boolean {
  let r = runtime;
  if (r === undefined) { try { r = getRuntimeConfig(); } catch { return false; } }
  const v = (r as { oneLogin?: unknown } | null)?.oneLogin;
  return typeof v === "object" && v !== null && (v as { active?: unknown }).active === true;
}

/** The server's C1 marker: IAOS could not confirm the session (storage uncertain). NOT a sign-out, NOT a sign-in request. */
export const SESSION_UNAVAILABLE_MARKER = "iaos-session-unavailable";
/** Fired on window when any request answered with that marker; ReadAccess re-checks and shows "unavailable". */
export const SESSION_UNAVAILABLE_EVENT = "iaos-session-unavailable";

export async function isSessionUnavailable(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try { return (await res.clone().json())?.by === SESSION_UNAVAILABLE_MARKER; } catch { return false; }
}
