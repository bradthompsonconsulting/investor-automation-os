/**
 * B15-12 (INV-110) -- has the Mailers digest's Saturday–Friday window ENDED, by the America/Chicago calendar date?
 * Pure: no I/O. The window itself is computed by the server (lib/mailer-shared.ts computeWeekWindow, Batch 5,
 * accepted); the page only needs to know when a window it is still SHOWING has become a previous week (a tab left
 * open past Friday 23:59 Central, or a computer waking up from sleep), so it never labels a previous week as current.
 *
 * Dates are compared as Central-time YYYY-MM-DD strings (the server's own convention), so month/year changes and
 * daylight-saving transitions need no arithmetic here.
 */
const centralDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD as seen in America/Chicago. */
export function centralDate(now: Date): string {
  return centralDateFmt.format(now);
}

/** True once the Central-time date is after the window's last day (Friday). A malformed date never counts as ended. */
export function weekEnded(weekEndCT: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEndCT)) return false;
  return centralDate(now) > weekEndCT;
}

/** How often an open Mailers page re-checks (pure computation, no request). */
export const WEEK_RECHECK_MS = 60_000;
