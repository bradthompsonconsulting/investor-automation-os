// Board 15 B4 — operator-facing display helpers. PURE: no I/O, no GHL reads or
// writes, no state. Each one only decides how an already-read value is shown.

// ── Contact name (Pass 1 F9) ────────────────────────────────────────────────
// For a contact with no name, GHL's conversation search returns the phone
// number in the name field, and ghl-conversations falls back to "(no name)".
// Either way the operator would otherwise see the phone twice or a
// placeholder. Display only: the value read from GHL is never changed.
export const UNNAMED_CONTACT = "Unnamed contact";

// True when the text is only a phone number: digits once spaces, hyphens,
// dots, parentheses and a leading + are removed, and at least 7 of them.
export function looksLikePhone(text: string): boolean {
  const stripped = text.trim().replace(/^\+/, "").replace(/[\s\-.()]/g, "");
  return /^\d{7,}$/.test(stripped);
}

export function displayContactName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed === "(no name)" || looksLikePhone(trimmed)) return UNNAMED_CONTACT;
  return trimmed;
}
