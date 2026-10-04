/**
 * B14-12 / INV-94 — Do Not Call (Brad's requirement; simplified 2026-10-04).
 *
 * Pure: no I/O, no React. Shared by the Contact page and the Dashboard, so the
 * suppression rule, the status wording and the calling-list predicate cannot
 * drift apart.
 *
 * IAOS NEVER WRITES DND AND WRITES NO DO NOT CALL RECORD. HighLevel's Update
 * Contact API documents dndSettings only as "per-channel DND settings": no
 * merge-vs-replace rule, no handling of `permanent` entries, no conditional
 * (If-Match/ETag) write. No IAOS read-then-write could guarantee that a STOP
 * or other opt-out GHL records at the same moment survives, so Brad sets Do
 * Not Disturb in GHL's own contact control. IAOS opens that contact in GHL,
 * then only READS and SHOWS what GHL holds. Brad asked for no reason and no
 * note (2026-10-04); none is written.
 *
 * WHAT "SUPPRESSED" MEANS HERE. A channel entry whose status is `active` or
 * `permanent`, whatever its message (a seller's STOP_KEYWORD, an email
 * unsubscribe). Recorded GHL facts (PB-D50, CONTACTS_DETAIL_SPEC): dndSettings
 * is keyed by channel; the top-level `dnd` boolean is unreliable and is never
 * read here.
 */

export const DNC_CHANNELS = ["Call", "SMS", "Email"] as const;
export type DncChannel = (typeof DNC_CHANNELS)[number];

export type DndEntry = { status?: unknown; message?: unknown; [key: string]: unknown };
export type DndSettings = Record<string, DndEntry>;

const SUPPRESSING = new Set(["active", "permanent"]);

function asSettings(value: unknown): DndSettings {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as DndSettings) : {};
}

export function isSuppressing(entry: DndEntry | null | undefined): boolean {
  return !!entry && typeof entry === "object" && SUPPRESSING.has(String(entry.status));
}

/** Which of calls, SMS and email GHL does NOT currently show suppressed (in that order). */
export function unsuppressedChannels(dndSettings: unknown): DncChannel[] {
  const d = asSettings(dndSettings);
  return DNC_CHANNELS.filter((ch) => !isSuppressing(d[ch]));
}

/** True when GHL shows calls, SMS and email all suppressed. */
export function isDncComplete(dndSettings: unknown): boolean {
  return unsuppressedChannels(dndSettings).length === 0;
}

/** IAOS calling lists exclude a contact whose GHL Call channel is suppressed (any cause). */
export function isCallSuppressed(dndSettings: unknown): boolean {
  return isSuppressing(asSettings(dndSettings).Call);
}

/* ── What IAOS shows (read-only) ─────────────────────────────────────── */

const LABEL: Record<DncChannel, string> = { Call: "calls", SMS: "SMS", Email: "email" };
const list = (chs: DncChannel[]) =>
  chs.length <= 1 ? chs.map((c) => LABEL[c]).join("") : `${chs.slice(0, -1).map((c) => LABEL[c]).join(", ")} or ${LABEL[chs[chs.length - 1]]}`;
const andList = (chs: DncChannel[]) =>
  chs.length <= 1 ? chs.map((c) => LABEL[c]).join("") : `${chs.slice(0, -1).map((c) => LABEL[c]).join(", ")} and ${LABEL[chs[chs.length - 1]]}`;

/** One sentence describing what GHL holds for calls, SMS and email, and what that means for IAOS's calling lists. */
export function dncStatusText(dndSettings: unknown): string {
  const missing = unsuppressedChannels(dndSettings);
  const on = DNC_CHANNELS.filter((c) => !missing.includes(c));
  const lists = isCallSuppressed(dndSettings)
    ? " This contact is out of IAOS calling lists."
    : " It stays on IAOS calling lists while calls are not suppressed.";
  if (missing.length === 0) return "GHL shows Do Not Disturb on calls, SMS and email." + lists;
  if (on.length === 0) return "GHL doesn't show Do Not Disturb on calls, SMS or email." + lists;
  return `GHL shows Do Not Disturb on ${andList(on)}, not on ${list(missing)}.` + lists;
}

/* ── Copy ────────────────────────────────────────────────────────────── */

/** The button: it opens GHL; it does not itself suppress anything. */
export const DNC_BUTTON = "Do Not Call (opens GHL)";
export const DNC_HANDOFF_OPENED =
  "GHL opened this contact in a new window. Turn on Do Not Disturb there for Calls & Voicemails, Text Messages and Emails, then check here. IAOS doesn't change Do Not Disturb itself.";
export const DNC_KEEPS_OPT_OUTS = "Existing opt-outs such as STOP stay in place. Turning Do Not Call off is also done in GHL.";
export const DNC_DIALER_LINE = "Choosing Do Not Call in GHL's dialer doesn't suppress anything; use GHL's Do Not Disturb settings on the contact.";
