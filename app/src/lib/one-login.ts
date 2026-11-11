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

/** The fixed one-sign-in lifetime (30 days), mirrored from shared/ghl-config.ts ONE_LOGIN_FULL_SESSION_SECONDS. */
export const FULL_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * B15-29 (Jess 2026-11-10): the Test-only session-lifetime scale, 0 < scale <= 1. The server projects
 * `oneLogin.sessionSeconds` only when IT issues a shorter Test lifetime; anything absent or malformed is 1 (the full
 * 30 days). Presentation only (where the reminder checkpoints fall, the wording): the server alone ends the session.
 */
export function oneLoginSessionScale(runtime?: unknown): number {
  let r = runtime;
  if (r === undefined) { try { r = getRuntimeConfig(); } catch { return 1; } }
  const v = (r as { oneLogin?: { active?: unknown; sessionSeconds?: unknown } } | null)?.oneLogin;
  const s = v && typeof v === "object" && v.active === true ? v.sessionSeconds : undefined;
  if (typeof s !== "number" || !Number.isInteger(s) || s < 600 || s * 1000 >= FULL_SESSION_MS) return 1;
  return (s * 1000) / FULL_SESSION_MS;
}

/** The server's C1 marker: IAOS could not confirm the session (storage uncertain). NOT a sign-out, NOT a sign-in request. */
export const SESSION_UNAVAILABLE_MARKER = "iaos-session-unavailable";
/** Fired on window when any request answered with that marker; ReadAccess re-checks and shows "unavailable". */
export const SESSION_UNAVAILABLE_EVENT = "iaos-session-unavailable";

export async function isSessionUnavailable(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try { return (await res.clone().json())?.by === SESSION_UNAVAILABLE_MARKER; } catch { return false; }
}
