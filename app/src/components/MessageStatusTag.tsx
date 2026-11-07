/**
 * F5 -- the delivery line of a message bubble (Conversations and the Contact page history). Display only.
 * The words come from lib/message-status.ts; nothing here infers success from the direction.
 */
import { AlertCircle } from "lucide-react";
import { messageStatus } from "../lib/message-status";

const COLOR = {
  received: "#94A3B8", failed: "#F87171", delivered: "#1EC8FF", sent: "#1EC8FF",
  pending: "#94A3B8", connected: "#1EC8FF", unknown: "#94A3B8",
} as const;

export function MessageStatusTag({ m }: { m: { direction?: unknown; status?: unknown; error?: unknown } }) {
  const s = messageStatus(m);
  const title = s.detail ? `GHL: ${s.detail}` : s.raw ? `GHL status: ${s.raw}` : s.kind === "unknown" ? "GHL reported no delivery status for this message" : undefined;
  return (
    <span data-testid="message-status" data-status-kind={s.kind} title={title}
      style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontWeight: 600, color: COLOR[s.kind] }}>
      {s.kind === "failed" ? <AlertCircle size={11} /> : null}
      {s.label}
    </span>
  );
}

/** GHL's own failure text, shown under a failed message's body. */
export function MessageFailureDetail({ m }: { m: { direction?: unknown; status?: unknown; error?: unknown } }) {
  const s = messageStatus(m);
  if (s.kind !== "failed" || !s.detail) return null;
  return (
    <div data-testid="message-status-detail" style={{ marginTop: "4px", fontSize: "11px", color: "#F87171" }}>
      GHL: {s.detail}
    </div>
  );
}
