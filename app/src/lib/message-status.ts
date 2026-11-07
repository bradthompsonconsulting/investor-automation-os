/**
 * F5 (Board #15 Captain walkthrough) -- what IAOS may truthfully say about a message's delivery.
 *
 * Source (HighLevel API, GET /conversations/{conversationId}/messages, message object): `direction` is
 * inbound | outbound; `status` is OPTIONAL, one of connected, delivered, failed, opened, pending, read,
 * scheduled, sent, undelivered, clicked, opt_out; `error` is a string, "Error message if message delivery
 * failed". There is no separate failure flag.
 *
 * Rules (the GO): a failed message is shown as failed; a missing status, or the outbound direction alone, is
 * never proof of success; "sent" is never shown as "delivered"; an unrecognised status is not guessed.
 * Pure: no I/O, no clock.
 */

export type MessageStatusKind =
  | "received"   // inbound: no delivery claim is made
  | "failed"     // GHL says it failed, was not delivered, the recipient opted out, or reports an error
  | "delivered"  // GHL says delivered, read, opened or clicked
  | "sent"       // GHL says sent: handed on, NOT confirmed delivered
  | "pending"    // GHL says pending or scheduled
  | "connected"  // GHL says connected (calls)
  | "unknown";   // outbound with no status, or one IAOS does not recognise

export type MessageStatus = {
  kind: MessageStatusKind;
  /** The words shown to the operator. */
  label: string;
  /** GHL's own error text for a failed message ("" when none). */
  detail: string;
  /** The raw GHL status, lower-cased ("" when absent), for the tooltip. */
  raw: string;
};

const LABELS: Record<string, { kind: MessageStatusKind; label: string }> = {
  failed: { kind: "failed", label: "Failed" },
  undelivered: { kind: "failed", label: "Not delivered" },
  opt_out: { kind: "failed", label: "Not delivered: opted out" },
  delivered: { kind: "delivered", label: "Delivered" },
  read: { kind: "delivered", label: "Read" },
  opened: { kind: "delivered", label: "Opened" },
  clicked: { kind: "delivered", label: "Clicked" },
  sent: { kind: "sent", label: "Sent" },
  pending: { kind: "pending", label: "Pending" },
  scheduled: { kind: "pending", label: "Scheduled" },
  connected: { kind: "connected", label: "Connected" },
};

const MAX_DETAIL = 300;

/* r2 (Bones REVISE on 6261dc4): a status is recognised only as an OWN key of LABELS. A plain-object index would also
   find inherited names ("constructor", "__proto__", "toString", ...), whose values are truthy but carry no kind or
   label, so the bubble showed no status at all. Anything not an own key is unknown. */
function knownStatus(raw: string): { kind: MessageStatusKind; label: string } | null {
  return Object.prototype.hasOwnProperty.call(LABELS, raw) ? LABELS[raw] : null;
}

/** The status IAOS shows for one message. Accepts any row; reads only direction, status and error. */
export function messageStatus(m: { direction?: unknown; status?: unknown; error?: unknown }): MessageStatus {
  const raw = typeof m.status === "string" ? m.status.trim().toLowerCase() : "";
  const detail = typeof m.error === "string" ? m.error.trim().slice(0, MAX_DETAIL) : "";
  if (m.direction === "inbound") return { kind: "received", label: "Received", detail: "", raw };
  const known = knownStatus(raw);
  // Any error text means delivery failed, whatever the status says.
  if (detail) return { kind: "failed", label: known?.kind === "failed" ? known.label : "Failed", detail, raw };
  if (known) return { kind: known.kind, label: known.label, detail: "", raw };
  return { kind: "unknown", label: "Status unknown", detail: "", raw };
}
