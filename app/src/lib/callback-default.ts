/**
 * B15-20 (INV-129, Pass 1 F20-note) -- the time the schedule-callback popover proposes when a contact has no
 * callback yet. UX default only: Save still writes exactly what the field holds (setCallbackDatetime, unchanged).
 *
 * Before: "now, rounded up to the next :00/:30" with no calling-hours awareness, so an evening open proposed
 * 9:00 PM or later and a late-night open proposed a time past midnight.
 *
 * Now (Jess GO 2026-10-31; window is a best-judgment default inside the 8 AM - 9 PM legal calling range):
 *   - the next :00/:30 strictly after now (unchanged rounding), if it falls inside 9:00 AM - 7:00 PM;
 *   - before 9:00 AM -> 9:00 AM the same day;
 *   - after 7:00 PM  -> 9:00 AM the next day.
 * All in the operator's local time -- the same browser-local clock <input type="datetime-local"> uses. Local
 * setters (setHours/setDate) keep it right across month/year ends and DST changes.
 */

/** Calling-hours window for the proposed callback, operator local time. End is inclusive (7:00 PM itself is fine). */
export const CALLBACK_WINDOW = { startHour: 9, endHour: 19 } as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as the `YYYY-MM-DDTHH:MM` value an <input type="datetime-local"> holds (browser-local fields). */
export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The proposed callback time for `now` (injectable clock; defaults to the real one). */
export function defaultCallbackLocalValue(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  // the next :00/:30 strictly after now -- the same rounding the popover always used
  if (d.getMinutes() < 30) d.setMinutes(30, 0, 0);
  else d.setHours(d.getHours() + 1, 0, 0, 0);
  const { startHour, endHour } = CALLBACK_WINDOW;
  if (d.getHours() < startHour) {
    d.setHours(startHour, 0, 0, 0);
  } else if (d.getHours() > endHour || (d.getHours() === endHour && d.getMinutes() > 0)) {
    d.setDate(d.getDate() + 1);
    d.setHours(startHour, 0, 0, 0);
  }
  return toLocalInputValue(d);
}
