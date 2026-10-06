// Board 15 B4 — operator-facing display helpers. PURE: no I/O, no GHL reads or
// writes, no state. Each one only decides how an already-read value is shown.

// ── Contact name (Pass 1 F9) ────────────────────────────────────────────────
// For a contact with no name, GHL's conversation search returns the phone
// number in the name field, and ghl-conversations falls back to "(no name)".
// Either way the operator would otherwise see the phone twice or a
// placeholder. Display only: the value read from GHL is never changed.
export const UNNAMED_CONTACT = "Unnamed contact";

/* Board 15 cleanup (Brad's Test check, 2026-10-06): the contract template is
   shown by its document name only -- never the repository path, commit or
   issue keys its stored source string carries. The stored value is unchanged
   (it is part of persisted authorization records). */
export function contractTemplateDisplayName(source: string): string {
  const file = source.replace(/\s*\(.*\)\s*$/, "").split("/").pop() ?? source;
  return file.replace(/\.pdf$/i, "").trim() || "Contract template";
}

/* The Agreement Reached meaning in operator words. The model's own constant
   restates the governing state-machine document verbatim (and is tested
   against it); only the on-screen wording drops the internal board name. */
export const AGREEMENT_REACHED_OPERATOR_MEANING =
  "The seller has accepted the negotiated price and terms. Negotiation is complete for this specific agreement.";

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

// ── Empty conversation preview (Pass 1 F51) ─────────────────────────────────
// The preview is GHL's lastMessageBody. A call log arrives with an empty body
// (docs/CONVERSATIONS_SPEC.md §8.6, OBSERVED 2026-07-20); other empty-body
// events are possible but unrecorded. The conversation search response's
// message-type field is not
// recorded anywhere in this repository, so no type is guessed: an empty
// preview gets one neutral label instead of "(no preview)".
export const NO_MESSAGE_TEXT = "No message text (call or activity)";

// ── Automated document emails (Pass 1 F52) ──────────────────────────────────
// GHL's document notification emails ("DOCUMENT SIGNED SUCCESSFULLY ...")
// bury the seller's real emails. Conservative match: the email body, with any
// HTML tags removed and whitespace collapsed and trimmed, STARTS WITH one of these
// exact phrases (case-insensitive). Nothing is hidden irretrievably: matching
// emails are grouped behind a collapsed row the operator can open. The phrase
// list is a Jess decision (Board 15 B4 report); widen it only by ruling.
export const AUTOMATED_DOCUMENT_EMAIL_PHRASES = ["DOCUMENT SIGNED SUCCESSFULLY"];

export function isAutomatedDocumentEmail(body: string | null | undefined): boolean {
  const text = (body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  return AUTOMATED_DOCUMENT_EMAIL_PHRASES.some((phrase) => text.startsWith(phrase));
}

// ── Phone-format search query (Pass 1 F15, Jess 2026-10-04) ─────────────────
// Returns the digits to match against a phone (with non-digits removed) when
// the query is a phone number, else null. A digits-only query is a phone query
// at any length (unchanged V1 behaviour). A query typed in a displayed phone
// format ("757-5598", "(817) 757-5598", "817.757.5598", "+1 817 757 5598") is a
// phone query when, after removing spaces, hyphens, dots, parentheses and a
// leading +, it is all digits and at least 3 of them.
export function phoneQueryDigits(query: string): string | null {
  const q = query.trim();
  if (/^\d+$/.test(q)) return q;
  const stripped = q.replace(/^\+/, "").replace(/[\s\-.()]/g, "");
  return /^\d{3,}$/.test(stripped) ? stripped : null;
}
