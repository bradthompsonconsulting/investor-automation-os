import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  MessageSquare, Mail, ArrowDownLeft, ArrowUpRight, Loader2, ExternalLink,
} from "lucide-react";
import { ghl, type ThreadRow, type ConvMessageRow } from "../lib/ghl";

/**
 * Conversations — READ-ONLY inbox (Coverage Roadmap surface #3). Two-pane:
 * left = full thread list (ghl.conversations.threads() → ghl-conversations
 * ?scope=all); right = the selected thread's message history (reuses the proven
 * ghl.conversations.forContact / ghl-contact-conversations read path from the
 * Contact Workspace step 5). NO send, NO compose, NO writes of any kind — send
 * is a separately-scoped later step. See docs/CONVERSATIONS_SPEC.md.
 *
 * Channel filter: TYPE_EMAIL + TYPE_SMS. GHL pipeline-activity (TYPE_ACTIVITY_*)
 * and call logs (TYPE_CALL) are not conversation messages and are filtered out —
 * same allowlist mechanism as the Workspace's TYPE_EMAIL-only filter, widened.
 */

const CONVERSATION_TYPES = ["TYPE_EMAIL", "TYPE_SMS"];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function formatEpoch(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

const CLAMP_LINES = 5;

// One message bubble. EMAIL bodies collapse to CLAMP_LINES via CSS line-clamp
// (line-based, not character count — width-independent, never breaks mid-word),
// with an Expand control shown ONLY when the body actually overflows. SMS bodies
// never collapse (short by nature). `expanded` is per-bubble local state that
// resets when the thread changes: bubbles are keyed by message id, so a new
// thread remounts them collapsed. No persistence, no storage.
//
// DELIBERATE divergence from ContactWorkspace's bubble render (which does NOT
// collapse) — Conversations-only, that surface stays verified/as-is. See
// docs/CONVERSATIONS_SPEC.md §7.
function MessageBubble({ m }: { m: ConvMessageRow }) {
  const outbound = m.direction === "outbound";
  const isSms = m.messageType === "TYPE_SMS";
  const collapsible = !isSms;

  const [expanded, setExpanded]     = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Measure overflow WHILE clamped (mount + body change; NOT on expand, so the
  // control stays visible after expanding). scrollHeight > clientHeight ⇒ the
  // line-clamp is truncating content → the Expand control is warranted.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!collapsible || !el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [m.body, collapsible]);

  const clamp = collapsible && !expanded;
  const bodyStyle: CSSProperties = {
    fontSize: "13px", color: "#E2E8F0", whiteSpace: "pre-wrap", wordBreak: "break-word",
    ...(clamp
      ? { display: "-webkit-box", WebkitLineClamp: CLAMP_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" }
      : {}),
  };

  return (
    <div style={{
      alignSelf: outbound ? "flex-end" : "flex-start", maxWidth: "80%",
      background: outbound ? "rgba(30,200,255,0.10)" : "#0A1633",
      border: `1px solid ${outbound ? "rgba(30,200,255,0.25)" : "rgba(255,255,255,0.08)"}`,
      borderRadius: "10px", padding: "8px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10px", color: "#475569", marginBottom: "4px" }}>
        {isSms ? <MessageSquare size={11} /> : <Mail size={11} />}
        <span style={{ fontWeight: 600, color: outbound ? "#1EC8FF" : "#94A3B8" }}>{outbound ? "Sent" : "Received"}</span>
        <span>· {m.channel}</span>
        <span>· {formatDate(m.dateAdded)}</span>
      </div>
      <div ref={bodyRef} style={bodyStyle}>
        {m.body || <span style={{ color: "#475569", fontStyle: "italic" }}>({m.channel.toLowerCase()}, no text)</span>}
      </div>
      {collapsible && overflowing && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: "6px", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "11px", fontWeight: 600, color: "#1EC8FF" }}
        >
          {expanded ? "Show less" : "Expand"}
        </button>
      )}
    </div>
  );
}

export default function Conversations() {
  const [threads, setThreads]           = useState<ThreadRow[] | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [selected, setSelected]         = useState<ThreadRow | null>(null);
  const [messages, setMessages]         = useState<ConvMessageRow[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  useEffect(() => {
    setThreadsError(null);
    ghl.conversations.threads()
      .then(setThreads)
      .catch((e: Error) => setThreadsError(e.message));
  }, []);

  // Load the selected thread's messages (scoped by explicit contactId; never
  // listAll, so §11 lag/drop doesn't apply). Read-only GET.
  useEffect(() => {
    if (!selected) return;
    setMessages(null);
    setMessagesError(null);
    ghl.conversations.forContact(selected.contactId)
      .then((res) => setMessages(res.messages))
      .catch((e: Error) => setMessagesError(e.message));
  }, [selected]);

  // Displayable messages: the endpoint returns the complete transcript incl.
  // activity/call noise — allowlist to real conversation channels. Already
  // oldest→newest from the function; do not re-sort.
  const displayMessages = useMemo(
    () => (messages ?? []).filter((m) => CONVERSATION_TYPES.includes(m.messageType)),
    [messages],
  );

  return (
    <div style={{ padding: "24px 28px", height: "calc(100vh - 0px)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "16px" }}>
        <MessageSquare size={20} style={{ color: "#1EC8FF" }} />
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Conversations</h1>
        <span style={{ fontSize: "11px", color: "#475569", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px", padding: "2px 8px" }}>Read-only</span>
      </div>

      <div style={{ display: "flex", gap: "16px", flex: 1, minHeight: 0 }}>
        {/* LEFT — thread list */}
        <div style={{ flex: "0 0 360px", display: "flex", flexDirection: "column", background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: "12px", fontWeight: 600, color: "#94A3B8" }}>
            {threads ? `${threads.length} thread${threads.length === 1 ? "" : "s"}` : "Threads"}
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {threadsError ? (
              <div style={{ padding: "16px", fontSize: "12px", color: "#F87171" }}>Failed to load threads: {threadsError}</div>
            ) : threads === null ? (
              <div style={{ padding: "16px", display: "flex", alignItems: "center", gap: "6px", color: "#334155", fontSize: "12px" }}>
                <Loader2 size={13} className="animate-spin" /> Loading threads…
              </div>
            ) : threads.length === 0 ? (
              <div style={{ padding: "16px", fontSize: "13px", color: "#334155", textAlign: "center" }}>No conversations.</div>
            ) : (
              threads.map((t) => {
                const active = selected?.conversationId === t.conversationId;
                const inbound = t.lastMessageDirection === "inbound";
                return (
                  <button
                    key={t.conversationId}
                    onClick={() => setSelected(t)}
                    style={{
                      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                      padding: "10px 14px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.04)",
                      background: active ? "rgba(30,200,255,0.10)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.contactName}</span>
                      <span style={{ flexShrink: 0, fontSize: "10px", color: "#475569" }}>{formatEpoch(t.lastMessageDate)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "3px" }}>
                      {inbound ? <ArrowDownLeft size={11} style={{ color: "#64748B", flexShrink: 0 }} /> : <ArrowUpRight size={11} style={{ color: "#1EC8FF", flexShrink: 0 }} />}
                      <span style={{ fontSize: "12px", color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.preview || "(no preview)"}</span>
                      {t.unreadCount > 0 && (
                        <span style={{ flexShrink: 0, marginLeft: "auto", fontSize: "10px", fontWeight: 700, color: "#07142E", background: "#1EC8FF", borderRadius: "999px", padding: "1px 6px" }}>{t.unreadCount}</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT — selected thread's messages */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", overflow: "hidden", minWidth: 0 }}>
          {!selected ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: "13px" }}>
              Select a thread to read its history.
            </div>
          ) : (
            <>
              <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif" }}>{selected.contactName}</span>
                <Link to={`/contacts/${selected.contactId}`} title="Open workspace" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#1EC8FF", textDecoration: "none" }}>
                  <ExternalLink size={12} /> Workspace
                </Link>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
                {messagesError ? (
                  <div style={{ fontSize: "12px", color: "#F87171" }}>Failed to load messages: {messagesError}</div>
                ) : messages === null ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#334155", fontSize: "12px" }}>
                    <Loader2 size={13} className="animate-spin" /> Loading messages…
                  </div>
                ) : displayMessages.length === 0 ? (
                  <div style={{ fontSize: "13px", color: "#334155", textAlign: "center", paddingTop: "20px" }}>No messages in this thread.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {displayMessages.map((m) => (
                      <MessageBubble key={m.id || `${m.conversationId}-${m.dateAdded}`} m={m} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
