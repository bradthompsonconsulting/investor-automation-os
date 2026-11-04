/**
 * B15-29 (INV-137) professional login experience -- session expiry reminders (one IAOS sign-in only).
 *
 * The ONLY input is the server's absolute session expiry (`expiresAt` from the app-read-session status answer,
 * fixed 30 days after the Google sign-in, never extended). The browser never derives expiry from its own sign-in
 * clock. Checkpoints: T5 = expiresAt - 5 days, T1 = expiresAt - 1 day. Only the latest due checkpoint is shown.
 *
 * A dismissal ("Remind Me Later") is recorded for THIS session + checkpoint, keyed by the expiry instant (no secret),
 * in localStorage when it works and in memory always. Nothing here sends a request or touches the session.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Same one-day cap as the page's expiry timer: well under setTimeout's 2^31-1 ms limit. */
export const REMINDER_MAX_TIMER_MS = DAY_MS;
export type ReminderCheckpoint = 5 | 1;
export const REMINDER_KEY_PREFIX = "iaos.session-reminder.dismissed.";

/** The latest due checkpoint at `now`, or null (before T5, or at/after expiry). */
export function dueReminder(expiresAt: number, now: number): ReminderCheckpoint | null {
  if (!Number.isFinite(expiresAt) || !(now < expiresAt)) return null;
  if (now >= expiresAt - 1 * DAY_MS) return 1;
  if (now >= expiresAt - 5 * DAY_MS) return 5;
  return null;
}

/** Milliseconds until the next checkpoint (T5, T1 or the expiry itself) strictly after `now`, capped; null when none is left. */
export function nextReminderDelay(expiresAt: number, now: number): number | null {
  if (!Number.isFinite(expiresAt)) return null;
  const next = [expiresAt - 5 * DAY_MS, expiresAt - 1 * DAY_MS, expiresAt].find((t) => t > now);
  return next === undefined ? null : Math.min(REMINDER_MAX_TIMER_MS, next - now);
}

export function reminderMessage(days: ReminderCheckpoint): string {
  return `Your IAOS session expires in ${days === 1 ? "1 day" : "5 days"}. Log in again now to keep your workflow uninterrupted.`;
}

export function reminderKey(expiresAt: number, days: ReminderCheckpoint): string {
  return `${REMINDER_KEY_PREFIX}${new Date(expiresAt).toISOString()}.${days}d`;
}

const memory = new Set<string>();

export function reminderDismissed(expiresAt: number, days: ReminderCheckpoint): boolean {
  const key = reminderKey(expiresAt, days);
  if (memory.has(key)) return true;
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}

export function dismissReminder(expiresAt: number, days: ReminderCheckpoint): void {
  const key = reminderKey(expiresAt, days);
  memory.add(key);
  try {
    const store = window.localStorage;
    // Dismissals for other (older) sessions are dropped; only this session's checkpoints are kept.
    const own = REMINDER_KEY_PREFIX + new Date(expiresAt).toISOString() + ".";
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const k = store.key(i);
      if (k && k.startsWith(REMINDER_KEY_PREFIX) && !k.startsWith(own)) store.removeItem(k);
    }
    store.setItem(key, "1");
  } catch { /* storage unavailable: the in-memory record still holds for this page */ }
}
