/**
 * B15-20b (provisional; the B15-20 / INV-129 callback family) -- the Seller
 * Call workspace's scheduled-callback status line.
 *
 * PURE: no I/O, no React, no GHL. It words the callback the page has ALREADY
 * resolved -- `resolveScheduledCallback` in lib/call-outcome-copy, the one
 * value the Pass consequence and Confirm Pass also read, with its B14-12
 * contact isolation -- against an injected clock. It reads nothing and writes
 * nothing.
 *
 * ZONE. The time and "Today / Tomorrow / Yesterday" are America/Chicago, the
 * zone formatCallbackTime (lib/callbackWrite) uses for the Pass consequence,
 * so the line and the Pass text always name the same day and time.
 *
 * NO INVENTED TIME. A callback that is set but unreadable says so; a record
 * not loaded yet says it is checking; a failed read says the status couldn't
 * be loaded. Only a readable instant produces a time.
 */

export const CALLBACK_STATUS_ZONE = "America/Chicago";
export const CALLBACK_STATUS_NONE = "No callback scheduled";
export const CALLBACK_STATUS_UNREADABLE = "Scheduled callback: set, time unreadable. Check the contact page.";
export const CALLBACK_STATUS_CHECKING = "Checking for a scheduled callback…";
export const CALLBACK_STATUS_UNAVAILABLE = "Callback status couldn't be loaded";

export type CallbackStatusKind = "today" | "tomorrow" | "later" | "overdue" | "unreadable" | "none" | "checking" | "unavailable";
export type CallbackStatus = { kind: CallbackStatusKind; tone: "info" | "warn" | "muted"; text: string };

/** The page's resolved callback: an instant, a set-but-unreadable value, none, or not yet known for this contact. */
export type ResolvedCallback = { iso: string | null } | null | "unknown";

// Some ICU builds put a narrow no-break space before AM/PM; one plain space keeps the line identical everywhere.
const plain = (s: string) => s.replace(/[  ]/g, " ");

/** The calendar day of an instant in the zone, as YYYY-MM-DD. */
function dayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CALLBACK_STATUS_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** A YYYY-MM-DD day moved by whole calendar days (UTC arithmetic on the date alone, so DST cannot shift it). */
function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const clock = (ms: number) => plain(new Date(ms).toLocaleTimeString("en-US", { timeZone: CALLBACK_STATUS_ZONE, hour: "numeric", minute: "2-digit" }));

/** "Today, 2:30 PM", "Tomorrow, 9:00 AM", "Yesterday, 9:00 AM", or "Tue, Nov 3, 9:00 AM" (with the year when it differs). */
function when(ms: number, nowMs: number): string {
  const day = dayKey(ms);
  const today = dayKey(nowMs);
  if (day === today) return `Today, ${clock(ms)}`;
  if (day === shiftDay(today, 1)) return `Tomorrow, ${clock(ms)}`;
  if (day === shiftDay(today, -1)) return `Yesterday, ${clock(ms)}`;
  const date = new Date(ms).toLocaleDateString("en-US", {
    timeZone: CALLBACK_STATUS_ZONE, weekday: "short", month: "short", day: "numeric",
    ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" as const } : {}),
  });
  return `${plain(date)}, ${clock(ms)}`;
}

/**
 * The status line for the resolved callback at `now`. `readFailed` is true
 * only when this contact's record could not be loaded at all; while it is
 * still loading (or the page is moving to another contact) the line is
 * "checking", never another contact's callback.
 */
export function callbackStatusLine(callback: ResolvedCallback, now: Date, readFailed: boolean): CallbackStatus {
  if (callback === "unknown") {
    return readFailed
      ? { kind: "unavailable", tone: "muted", text: CALLBACK_STATUS_UNAVAILABLE }
      : { kind: "checking", tone: "muted", text: CALLBACK_STATUS_CHECKING };
  }
  if (callback === null) return { kind: "none", tone: "muted", text: CALLBACK_STATUS_NONE };
  const ms = callback.iso ? Date.parse(callback.iso) : NaN;
  if (!Number.isFinite(ms)) return { kind: "unreadable", tone: "warn", text: CALLBACK_STATUS_UNREADABLE };
  const nowMs = now.getTime();
  if (ms < nowMs) return { kind: "overdue", tone: "warn", text: `Scheduled callback: Overdue, was ${when(ms, nowMs)}` };
  const day = dayKey(ms);
  const today = dayKey(nowMs);
  const kind: CallbackStatusKind = day === today ? "today" : day === shiftDay(today, 1) ? "tomorrow" : "later";
  return { kind, tone: "info", text: `Scheduled callback: ${when(ms, nowMs)}` };
}
