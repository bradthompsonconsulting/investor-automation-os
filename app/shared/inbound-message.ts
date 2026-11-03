/**
 * B15-08 (INV-107) -- the latest INBOUND message of a conversation, classified from the same per-conversation message
 * data the Conversations thread shows (`GET /conversations/{id}/messages`). Pure: no I/O. Shared by the
 * `ghl-conversations` function (the Dashboard's Unanswered Inbound rows) and the Conversations thread, so both screens
 * say the same thing about the same message.
 *
 * Why: the Dashboard preview was only the conversation search summary (`lastMessageBody`). That summary is empty for
 * calls and activities and is not the thread's source, so a row could read "No message text (call or activity)" while
 * the seller had written, or claim a message the thread did not show.
 *
 * Fields used are only the OBSERVED message fields (docs/CONTACT_WORKSPACE_SPEC_v2.md §12): `direction`,
 * `messageType` (STRING enum, e.g. TYPE_SMS / TYPE_EMAIL; never the numeric `type`), `body`, `dateAdded`,
 * `conversationId`, `contactId`. Nothing is guessed:
 *   - "text"        -- the newest inbound message is an SMS or email with text;
 *   - "no_text"     -- the newest inbound message is another kind (a call log, an activity, ...): no text exists;
 *   - "unavailable" -- the text could not be established (read failed, an SMS/email with no body, no inbound
 *                      message found, or not loaded for this row).
 * "Loading" is the screen's own state; it is never produced here.
 */

export const TEXT_MESSAGE_TYPES = ["TYPE_SMS", "TYPE_EMAIL"] as const;

export type InboundUnavailableReason = "read_failed" | "no_body" | "not_found" | "not_loaded";

export type LatestInbound =
  | { state: "text"; channel: string; text: string; at: string | null; source: "thread" | "summary" }
  | { state: "no_text"; channel: string; at: string | null }
  | { state: "unavailable"; reason: InboundUnavailableReason; channel: string | null; at: string | null };

export type InboundMessageInput = {
  direction?: unknown; messageType?: unknown; body?: unknown; dateAdded?: unknown;
  conversationId?: unknown; contactId?: unknown;
};

/** Friendly channel label from GHL's messageType enum (e.g. "TYPE_SMS" -> "SMS", "TYPE_CALL" -> "Call"); "" -> "Message". */
export function channelLabel(messageType: unknown): string {
  const s = String(messageType ?? "").replace(/^TYPE_/, "");
  if (!s) return "Message";
  if (s === "SMS") return "SMS";
  return s.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

/** Display text of a message body: HTML tags removed (email bodies), whitespace collapsed, trimmed. */
export function plainText(body: unknown): string {
  return String(body ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

const timeOf = (v: unknown): number => {
  const t = typeof v === "number" ? v : Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * The newest inbound message among `messages`, classified. Messages that name a different conversation or contact
 * than `scope` are ignored (contact isolation: a row never shows another contact's message).
 */
export function latestInboundFrom(messages: readonly InboundMessageInput[], scope: { conversationId?: string; contactId?: string }): LatestInbound {
  let newest: InboundMessageInput | null = null;
  for (const m of messages ?? []) {
    if (!m || m.direction !== "inbound") continue;
    if (scope.conversationId && m.conversationId !== undefined && m.conversationId !== scope.conversationId) continue;
    if (scope.contactId && m.contactId !== undefined && m.contactId !== scope.contactId) continue;
    if (!newest || timeOf(m.dateAdded) > timeOf(newest.dateAdded)) newest = m;
  }
  if (!newest) return { state: "unavailable", reason: "not_found", channel: null, at: null };
  const type = String(newest.messageType ?? "");
  const channel = channelLabel(type);
  const at = Number.isFinite(timeOf(newest.dateAdded)) ? new Date(timeOf(newest.dateAdded)).toISOString() : null;
  if (!(TEXT_MESSAGE_TYPES as readonly string[]).includes(type)) return { state: "no_text", channel, at };
  const text = plainText(newest.body);
  return text ? { state: "text", channel, text, at, source: "thread" } : { state: "unavailable", reason: "no_body", channel, at };
}

/** A row whose messages were not read: the search summary when it has text, otherwise honestly unavailable. */
export function latestInboundFromSummary(lastMessageBody: unknown, lastMessageDate: unknown, reason: "read_failed" | "not_loaded"): LatestInbound {
  const text = plainText(lastMessageBody);
  const t = timeOf(lastMessageDate);
  const at = Number.isFinite(t) ? new Date(t).toISOString() : null;
  return text ? { state: "text", channel: "", text, at, source: "summary" } : { state: "unavailable", reason, channel: null, at };
}
