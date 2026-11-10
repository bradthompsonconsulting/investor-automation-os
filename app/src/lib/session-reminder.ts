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

/**
 * B15-29 (Jess 2026-11-10): `scale` (0 < scale <= 1, one-login.ts oneLoginSessionScale) places the checkpoints on a
 * Test-only shorter lifetime at the same proportions: T5 = 5/30 and T1 = 1/30 of the lifetime before expiry. scale 1
 * (the default, and the only value Production can see) is the 30-day behaviour exactly.
 */
const unit = (scale: number) => (Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 1) * DAY_MS;

/** The latest due checkpoint at `now`, or null (before T5, or at/after expiry). */
export function dueReminder(expiresAt: number, now: number, scale = 1): ReminderCheckpoint | null {
  if (!Number.isFinite(expiresAt) || !(now < expiresAt)) return null;
  const d = unit(scale);
  if (now >= expiresAt - 1 * d) return 1;
  if (now >= expiresAt - 5 * d) return 5;
  return null;
}

/** Milliseconds until the next checkpoint (T5, T1 or the expiry itself) strictly after `now`, capped; null when none is left. */
export function nextReminderDelay(expiresAt: number, now: number, scale = 1): number | null {
  if (!Number.isFinite(expiresAt)) return null;
  const d = unit(scale);
  const next = [expiresAt - 5 * d, expiresAt - 1 * d, expiresAt].find((t) => t > now);
  return next === undefined ? null : Math.min(REMINDER_MAX_TIMER_MS, next - now);
}

/**
 * r4 (Bones): the wording never overstates the time left on a late visit. T1 -> "within 24 hours". T5 -> "within N
 * days" with N = the whole days left, rounded UP (2..5): an upper bound that stays true while the dialog is open.
 * Without remainingMs the checkpoint's own bound is used ("within 5 days" / "within 24 hours").
 * On a Test-scaled lifetime (scale < 1) the same upper-bound rule is stated in whole minutes, rounded up, and the
 * text says it is a Test session -- never "days" or "24 hours" that are not true.
 */
export function reminderMessage(days: ReminderCheckpoint, remainingMs?: number, scale = 1): string {
  if (unit(scale) < DAY_MS) {
    const bound = days === 1 ? unit(scale) : 5 * unit(scale);
    const left = remainingMs === undefined || !Number.isFinite(remainingMs) ? bound : Math.min(bound, Math.max(60_000, remainingMs));
    const m = Math.ceil(left / 60_000);
    return `Your IAOS Test session expires within ${m} minute${m === 1 ? "" : "s"}. Log in again now to keep your workflow uninterrupted.`;
  }
  const n = remainingMs === undefined || !Number.isFinite(remainingMs) ? 5 : Math.min(5, Math.max(2, Math.ceil(remainingMs / DAY_MS)));
  return `Your IAOS session expires ${days === 1 ? "within 24 hours" : `within ${n} days`}. Log in again now to keep your workflow uninterrupted.`;
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
