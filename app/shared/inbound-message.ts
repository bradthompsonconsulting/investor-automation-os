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
 * `messageType` (STRING enum, e.g. TYPE_SMS / TYPE_EMAIL; never the numeric `type`), `body`, `contentType`,
 * `dateAdded`, `conversationId`, `contactId`. Nothing is guessed:
 *   - "text"        -- the newest inbound message is an SMS or email with text;
 *   - "no_text"     -- the newest inbound message is a KNOWN bodyless kind (a call log, an activity) with no body;
 *   - "unavailable" -- the text could not be established: read failed / timed out / rate-limited / not loaded, an
 *                      SMS or email with no body, no inbound message found, or an unknown or missing message type
 *                      (Bones P2-4: failing the SMS/email allowlist does not prove that no text exists).
 * "Loading" is the screen's own state; it is never produced here.
 *
 * Text (Bones P2-2): SMS and plain bodies are kept EXACTLY (only the ends trimmed): "<", ">", "&", amounts, line
 * breaks. Only an email whose own `contentType` says HTML is converted to text (tags dropped, entities decoded).
 * Everything stays React text on screen; nothing is ever rendered as HTML.
 */

export const TEXT_MESSAGE_TYPES = ["TYPE_SMS", "TYPE_EMAIL"] as const;

export type InboundUnavailableReason =
  | "read_failed" | "timed_out" | "rate_limited" | "not_loaded"   // the message read did not complete
  | "no_body" | "not_found" | "unsupported";                       // the read completed; text not established

export type LatestInbound =
  | { state: "text"; channel: string; text: string; at: string | null; source: "thread" | "summary" }
  | { state: "no_text"; channel: string; at: string | null }
  | { state: "unavailable"; reason: InboundUnavailableReason; channel: string | null; at: string | null };

export type InboundMessageInput = {
  direction?: unknown; messageType?: unknown; body?: unknown; contentType?: unknown; dateAdded?: unknown;
  conversationId?: unknown; contactId?: unknown;
};

/** Friendly channel label from GHL's messageType enum (e.g. "TYPE_SMS" -> "SMS", "TYPE_CALL" -> "Call"). */
export function channelLabel(messageType: unknown): string {
  const s = String(messageType ?? "").replace(/^TYPE_/, "");
  if (!s) return "Message";
  if (s === "SMS") return "SMS";
  return s.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

/** A known kind that carries no message text: a call log (docs/CONVERSATIONS_SPEC.md §8.6) or a GHL activity row (§12). */
export function isKnownBodylessType(messageType: string): boolean {
  return messageType === "TYPE_CALL" || messageType.startsWith("TYPE_ACTIVITY_");
}

/** A plain body as text: exactly as sent, ends trimmed. Never parsed as HTML. */
export function plainBody(body: unknown): string {
  return String(body ?? "").trim();
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** An HTML email body as text: script/style removed, breaks and blocks become spaces, tags dropped, entities decoded once. */
export function htmlEmailText(html: unknown): string {
  return String(html ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; }
      return NAMED_ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

const timeOf = (v: unknown): number => {
  const t = typeof v === "number" ? v : Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * The newest inbound message among `messages`, classified. Messages that name a different conversation or contact
 * than `scope` are ignored (isolation: a row or a selected thread never shows another conversation's message).
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
  const type = typeof newest.messageType === "string" ? newest.messageType : "";
  const at = Number.isFinite(timeOf(newest.dateAdded)) ? new Date(timeOf(newest.dateAdded)).toISOString() : null;
  if (type === "TYPE_SMS" || type === "TYPE_EMAIL") {
    const html = type === "TYPE_EMAIL" && /html/i.test(String(newest.contentType ?? ""));
    const text = html ? htmlEmailText(newest.body) : plainBody(newest.body);
    const channel = channelLabel(type);
    return text ? { state: "text", channel, text, at, source: "thread" } : { state: "unavailable", reason: "no_body", channel, at };
  }
  if (type && isKnownBodylessType(type) && !plainBody(newest.body)) return { state: "no_text", channel: channelLabel(type), at };
  // Unknown or missing type, or a known bodyless kind that carries a body: text is not established. A known type keeps
  // its own name; an unknown or missing one is never given a channel.
  return { state: "unavailable", reason: "unsupported", channel: type && isKnownBodylessType(type) ? channelLabel(type) : null, at };
}

/** A row whose messages were not (fully) read: the search summary as plain text when it has any, otherwise honestly unavailable. */
export function latestInboundFromSummary(lastMessageBody: unknown, lastMessageDate: unknown, reason: "read_failed" | "timed_out" | "rate_limited" | "not_loaded"): LatestInbound {
  const text = plainBody(lastMessageBody);
  const t = timeOf(lastMessageDate);
  const at = Number.isFinite(t) ? new Date(t).toISOString() : null;
  return text ? { state: "text", channel: "", text, at, source: "summary" } : { state: "unavailable", reason, channel: null, at };
}
