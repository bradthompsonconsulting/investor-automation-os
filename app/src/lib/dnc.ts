/**
 * B14-12 / INV-94 — Do Not Call (Brad's requirement; Jess rulings 2026-10-03).
 *
 * Pure: no I/O, no React. Shared by ghl-write's note check, the Contact page
 * and the Dashboard, so the suppression rule, the note and the calling-list
 * predicate cannot drift apart.
 *
 * IAOS NEVER WRITES DND. HighLevel's Update Contact API documents dndSettings
 * only as "per-channel DND settings": no merge-vs-replace rule, no handling of
 * `permanent` entries, no conditional (If-Match/ETag) write. No IAOS
 * read-then-write could guarantee that a STOP or other opt-out GHL records at
 * the same moment survives, so Do Not Call is set by Brad in GHL's own contact
 * control. IAOS hands him to that contact, then verifies and records.
 *
 * WHAT "SUPPRESSED" MEANS HERE. A channel entry whose status is `active` or
 * `permanent`, whatever its message (IAOS's, a seller's STOP_KEYWORD, an email
 * unsubscribe). Recorded GHL facts (PB-D50, CONTACTS_DETAIL_SPEC): dndSettings
 * is keyed by channel; the top-level `dnd` boolean is unreliable and is never
 * read here.
 */

export const DNC_CHANNELS = ["Call", "SMS", "Email"] as const;

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
export function unsuppressedChannels(dndSettings: unknown): string[] {
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

/* ── The record note ─────────────────────────────────────────────────── */

export const DNC_NOTE_PREFIX = "Do Not Call (recorded by Brad in IAOS): ";
/** What IAOS observed when it verified — not a guarantee that it stays so (Jess). */
export const DNC_NOTE_OBSERVED_LINE = "At verification, GHL showed calls, SMS and email suppressed.";
export const DNC_REASON_MAX = 500;

export function dncNote(reason: string): string {
  return `${DNC_NOTE_PREFIX}${reason.trim()}\n${DNC_NOTE_OBSERVED_LINE}`;
}

/** Exact Do Not Call note: one reason line (1–500 characters, trimmed) then the fixed observation line. */
export function isDncNoteBody(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const lines = body.split("\n");
  if (lines.length !== 2 || lines[1] !== DNC_NOTE_OBSERVED_LINE || !lines[0].startsWith(DNC_NOTE_PREFIX)) return false;
  const reason = lines[0].slice(DNC_NOTE_PREFIX.length);
  return reason.trim().length > 0 && reason === reason.trim() && reason.length <= DNC_REASON_MAX;
}

/* ── Copy ────────────────────────────────────────────────────────────── */

export const DNC_CONSEQUENCE =
  "Do Not Call is set in GHL itself: turn on Do Not Disturb for Calls, SMS and Email on this contact. IAOS then checks GHL and records it, and the contact leaves IAOS calling lists. Existing opt-outs such as STOP stay in place. Removing Do Not Call later is also done in GHL.";
export const DNC_DIALER_LINE = "Choosing Do Not Call in GHL's dialer doesn't suppress anything; use GHL's Do Not Disturb settings on the contact.";
export const DNC_REASON_PLACEHOLDER = "Why? (required) e.g. Seller asked us not to contact them again.";
