import type { InboundUnavailableReason, LatestInbound } from "../../shared/inbound-message";

/**
 * B15-08 (INV-107) -- one display for the latest inbound message, used by the Dashboard's Unanswered Inbound rows and
 * the Conversations thread, so both screens say the same thing about the same message.
 *   text        -> the channel and the seller's words;
 *   no_text     -> what arrived (e.g. a call) and that it has no text;
 *   unavailable -> that the text could not be shown here, and where to look.
 * "Loading" and "nothing unanswered" stay the screens' own states.
 */
export const INBOUND_UNAVAILABLE_TEXT: Record<InboundUnavailableReason, string> = {
  read_failed: "Message text couldn't be read — open the conversation",
  timed_out: "Message text didn't load in time — open the conversation",
  rate_limited: "Message text not loaded (GHL is busy) — open the conversation",
  not_loaded: "Message text not loaded here — open the conversation",
  no_body: "Message text isn't available here — open the conversation",
  not_found: "Latest inbound message not found — open the conversation",
  unsupported: "This message type isn't shown here — open the conversation",
};

export function inboundNoTextLabel(channel: string): string {
  return `Inbound ${channel.toLowerCase()} — no message text`;
}

export function receivedAt(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `Received ${d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

export function InboundPreview({ li, testId = "inbound-preview" }: { li: LatestInbound; testId?: string }) {
  const when = receivedAt(li.at);
  const chip = (label: string) => (
    <span data-testid={`${testId}-channel`} style={{
      fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "999px", marginRight: "6px",
      border: "1px solid #334155", color: "#94A3B8", whiteSpace: "nowrap",
    }}>{label}</span>
  );
  return (
    <span data-testid={testId} data-state={li.state} title={when ?? undefined}
      style={{ display: "inline-flex", alignItems: "center", minWidth: 0, maxWidth: "100%" }}>
      {li.state === "text" ? (
        <>
          {li.channel ? chip(li.channel) : null}
          <span data-testid={`${testId}-text`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{li.text}</span>
        </>
      ) : li.state === "no_text" ? (
        <em data-testid={`${testId}-text`} style={{ color: "#64748B" }}>{inboundNoTextLabel(li.channel)}</em>
      ) : (
        <em data-testid={`${testId}-text`} style={{ color: "#F59E0B" }}>{INBOUND_UNAVAILABLE_TEXT[li.reason]}</em>
      )}
      {when ? <span data-testid={`${testId}-time`} style={{ marginLeft: "8px", fontSize: "11px", color: "#475569", whiteSpace: "nowrap" }}>{when}</span> : null}
    </span>
  );
}
