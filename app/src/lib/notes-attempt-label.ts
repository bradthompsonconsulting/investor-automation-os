/**
 * Contact Workspace Notes header -- the attempt label (B15 bundle follow-up,
 * Spock Addendum 2, 2026-10-21).
 *
 * Pure. Decides only the words beside the "Notes" title. "Not yet contacted"
 * is a statement of fact, so it is shown only once the contact record has
 * resolved without an attempt; before that the label is a neutral
 * "Loading…". A known attempt (the in-session override or the record's own
 * field) always shows as "Last attempted …", exactly as before.
 */
export type NotesAttemptLabel = { text: string; attempted: boolean };

export function notesAttemptLabel(
  lastAttempt: string | null,
  contactResolved: boolean,
  relativeTime: (iso: string) => string,
): NotesAttemptLabel {
  if (lastAttempt) return { text: `Last attempted ${relativeTime(lastAttempt)}`, attempted: true };
  return { text: contactResolved ? "Not yet contacted" : "Loading…", attempted: false };
}
