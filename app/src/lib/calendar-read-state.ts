/**
 * B15-07 (INV-106) -- what a failed or empty calendar read means, for the Calendars page. Pure: no I/O.
 *
 * The page must never present "no appointments" when the read did not succeed, and must not blame GHL for an IAOS
 * sign-in lapse. Codes come from the existing server and read-auth boundary (nothing new is inferred):
 *   - "ghl_calendar_access_denied"  ghl-calendar-events: GHL answered 401/403 (e.g. "token is not authorized for this
 *                                    scope") -- a permission state on the GHL token;
 *   - "iaos_read_sign_in_required"  the IAOS read-auth boundary refused (401, marker "iaos-app-read-auth");
 *   - "iaos_read_unconfigured"      the read sign-in is not configured for this site (503, "iaos-app-read-unconfigured");
 *   - anything else                  a temporary or unknown failure (GHL 5xx/429, network, budget refusal, ...).
 */
export type CalendarFailureKind = "access_denied" | "sign_in" | "unconfigured" | "temporary";

export function calendarFailureKind(code: string | null | undefined): CalendarFailureKind {
  if (code === "ghl_calendar_access_denied") return "access_denied";
  if (code === "iaos_read_sign_in_required") return "sign_in";
  if (code === "iaos_read_unconfigured") return "unconfigured";
  return "temporary";
}

/** The read-auth boundary's own markers (src/lib/read-session.ts REFUSAL_MARKERS), mapped to a calendar code. */
export function readAuthCode(status: number, by: unknown): string | null {
  if (status === 401 && by === "iaos-app-read-auth") return "iaos_read_sign_in_required";
  if (status === 503 && by === "iaos-app-read-unconfigured") return "iaos_read_unconfigured";
  return null;
}

/** "h:mm AM/PM" in the operator's Central-time convention used across the Calendars page. */
export function readTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}
