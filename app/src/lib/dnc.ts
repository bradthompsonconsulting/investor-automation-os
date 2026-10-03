/**
 * B14-12 / INV-94 — Do Not Call (Brad's requirement; Jess ruling 2026-10-03).
 *
 * Pure: no I/O, no React. Shared by the server operation (`contact.dnc` in
 * ghl-write) and the Contact page / Dashboard, so the plan, the readback
 * check, the note and the calling-list predicate cannot drift apart.
 *
 * WHAT DNC DOES. Sets GHL Do Not Disturb for the Call, SMS and Email channels
 * (`dndSettings.{Call,SMS,Email}.status = "active"`), records why in a note,
 * and takes the contact out of IAOS calling lists. It is a separate, explicit,
 * confirmed action — not a call result.
 *
 * NEVER WEAKENS AN EXISTING RESTRICTION. Recorded GHL facts (PHASE_B_SPEC
 * PB-D50, CONTACTS_DETAIL_SPEC): dndSettings is keyed by channel; entries seen
 * are `permanent`/STOP_KEYWORD (SMS, RCS), `active`/TWILIO_ERROR_CODE (SMS) and
 * `active`/"User clicked on the unsubscribe link" (Email); the top-level `dnd`
 * boolean is unreliable and is never read or written here. A channel that is
 * already `active` or `permanent` is left exactly as it is (status AND
 * message); every other channel (e.g. RCS, WhatsApp) is carried through
 * unchanged. Only a target channel that is absent or not suppressing becomes
 * `active` with the message below.
 *
 * GHL's PUT semantics for dndSettings (merge vs replace) have never been
 * observed from IAOS. The plan therefore sends the WHOLE object — preserving
 * every existing entry under either semantics — and the readback check fails
 * closed if any target channel is not suppressing or any other entry changed.
 */

export const DNC_CHANNELS = ["Call", "SMS", "Email"] as const;
export const DNC_MESSAGE = "IAOS Do Not Call";

export type DndEntry = { status?: unknown; message?: unknown; [key: string]: unknown };
export type DndSettings = Record<string, DndEntry>;

const SUPPRESSING = new Set(["active", "permanent"]);

function asSettings(value: unknown): DndSettings {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as DndSettings) : {};
}

export function isSuppressing(entry: DndEntry | null | undefined): boolean {
  return !!entry && typeof entry === "object" && SUPPRESSING.has(String(entry.status));
}

/** IAOS calling lists exclude a contact whose GHL Call channel is suppressed (any cause). */
export function isCallSuppressed(dndSettings: unknown): boolean {
  return isSuppressing(asSettings(dndSettings).Call);
}

/** True when Call, SMS and Email are all suppressed — Do Not Call is fully in effect. */
export function isDncComplete(dndSettings: unknown): boolean {
  const d = asSettings(dndSettings);
  return DNC_CHANNELS.every((ch) => isSuppressing(d[ch]));
}

/** The whole dndSettings object to send, and which target channels it changes. */
export function planDnc(current: unknown): { next: DndSettings; changed: string[] } {
  const before = asSettings(current);
  const next: DndSettings = {};
  for (const [ch, entry] of Object.entries(before)) next[ch] = { ...entry };
  const changed: string[] = [];
  for (const ch of DNC_CHANNELS) {
    if (isSuppressing(before[ch])) continue;           // already restricted: untouched
    next[ch] = { status: "active", message: DNC_MESSAGE };
    changed.push(ch);
  }
  return { next, changed };
}

const same = (a: DndEntry | undefined, b: DndEntry | undefined) =>
  !!a && !!b && String(a.status) === String(b.status) && String(a.message ?? "") === String(b.message ?? "");

/**
 * Readback check. Every target channel must be suppressing; every channel the
 * plan did not change must read back exactly as before (status and message);
 * a changed channel must read back `active`.
 */
export function verifyDnc(current: unknown, changed: string[], readback: unknown): { ok: true } | { ok: false; problems: string[] } {
  const before = asSettings(current);
  const after = asSettings(readback);
  const problems: string[] = [];
  for (const ch of DNC_CHANNELS) if (!isSuppressing(after[ch])) problems.push(`${ch} is not suppressed`);
  for (const [ch, entry] of Object.entries(before)) {
    if (changed.includes(ch)) continue;
    if (!same(entry, after[ch])) problems.push(`${ch} changed (was ${String(entry.status)}/${String(entry.message ?? "")})`);
  }
  for (const ch of changed) if (String(after[ch]?.status) !== "active") problems.push(`${ch} did not read back active`);
  return problems.length ? { ok: false, problems } : { ok: true };
}

/* ── The record note ─────────────────────────────────────────────────── */

export const DNC_NOTE_PREFIX = "Do Not Call (recorded by Brad in IAOS): ";
export const DNC_NOTE_SUPPRESSED_LINE = "Suppressed in GHL: calls, SMS and email.";
export const DNC_REASON_MAX = 500;

/** Written only AFTER suppression is read back, so its second line is a fact. */
export function dncNote(reason: string): string {
  return `${DNC_NOTE_PREFIX}${reason.trim()}\n${DNC_NOTE_SUPPRESSED_LINE}`;
}

/** Exact DNC note: one reason line (1–500 characters) then the fixed suppression line. */
export function isDncNoteBody(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const lines = body.split("\n");
  if (lines.length !== 2 || lines[1] !== DNC_NOTE_SUPPRESSED_LINE || !lines[0].startsWith(DNC_NOTE_PREFIX)) return false;
  const reason = lines[0].slice(DNC_NOTE_PREFIX.length);
  return reason.trim().length > 0 && reason === reason.trim() && reason.length <= DNC_REASON_MAX;
}

/* ── Copy ────────────────────────────────────────────────────────────── */

export const DNC_CONSEQUENCE =
  "Sets Do Not Disturb in GHL for calls, text messages and email, so GHL won't call, text or email this seller, and takes them out of IAOS calling lists. Existing opt-outs such as STOP stay in place. Removing Do Not Call later is done in GHL.";
export const DNC_DIALER_LINE = "Choosing Do Not Call in GHL's dialer doesn't suppress anything; use this button.";
export const DNC_REASON_PLACEHOLDER = "Why? (required) e.g. Seller asked us not to contact them again.";
