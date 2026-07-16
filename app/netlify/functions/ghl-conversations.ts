/**
 * GHL Conversations — server-side function. Holds GHL_PRIVATE_API_KEY.
 *
 * GET /.netlify/functions/ghl-conversations
 * Returns every conversation whose LAST message is inbound with no outbound
 * reply after it — the Dashboard's "Waiting on me §2.1 Unanswered Inbound"
 * signal (docs/DASHBOARD_SPEC_v1.txt). Read-only: GET /conversations/search only.
 *
 * Requires the Conversations (read) scope on the private integration token —
 * confirmed live this session (previously 401'd without it).
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchAllConversations(token: string): Promise<any[]> {
  const all: any[] = [];
  let startAfterDate: number | undefined;
  let startAfterId: string | undefined;

  while (true) {
    const params = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    if (startAfterDate) params.set("startAfterDate", String(startAfterDate));
    if (startAfterId)   params.set("startAfterId",   startAfterId);

    const res  = await fetch(`${GHL_BASE}/conversations/search?${params}`, { headers: headers(token) });
    const body = await res.json();
    if (!res.ok) throw new Error(`GET /conversations/search → ${res.status}: ${JSON.stringify(body)}`);

    const batch: any[] = body.conversations ?? [];
    all.push(...batch);

    if (batch.length < 100 || all.length >= (body.total ?? all.length)) break;
    const last = batch[batch.length - 1];
    startAfterDate = last.lastMessageDate;
    startAfterId   = last.id;
    await delay(110);
  }

  return all;
}

export interface UnansweredInboundRow {
  conversationId: string;
  contactId:      string;
  contactName:    string;
  phone:          string;
  email:          string;
  lastMessageDate: number;
  preview:        string;
  unreadCount:    number;
}

// Full thread-list row (?scope=all). Superset of the unanswered row + the last
// message's direction, so the inbox can show a sent/received hint. Read-only.
export interface ThreadRow {
  conversationId: string;
  contactId:      string;
  contactName:    string;
  phone:          string;
  email:          string;
  lastMessageDate: number;
  lastMessageDirection: string; // "inbound" | "outbound"
  preview:        string;
  unreadCount:    number;
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };
  }

  try {
    const all = await fetchAllConversations(token);

    // ?scope=all — full thread list (every conversation, newest first), the
    // Conversations inbox source. Opt-in only; the DEFAULT (no param) stays the
    // unanswered-inbound filter below so the Dashboard's consumer is unchanged.
    // Same GET path, no new endpoint. Read-only.
    if (event.queryStringParameters?.scope === "all") {
      const threads: ThreadRow[] = all
        .map((c) => ({
          conversationId:       c.id,
          contactId:            c.contactId ?? "",
          contactName:          c.contactName || c.fullName || "(no name)",
          phone:                c.phone ?? "",
          email:                c.email ?? "",
          lastMessageDate:      c.lastMessageDate ?? 0,
          lastMessageDirection: c.lastMessageDirection ?? "",
          preview:              String(c.lastMessageBody ?? "").trim(),
          unreadCount:          c.unreadCount ?? 0,
        }))
        .sort((a, b) => b.lastMessageDate - a.lastMessageDate); // newest first (inbox)
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify(threads),
      };
    }

    // Last message direction "inbound" = the contact spoke last with no
    // outbound reply since — exactly the spec's "unanswered inbound" definition.
    const rows: UnansweredInboundRow[] = all
      .filter((c) => c.lastMessageDirection === "inbound" && !c.isLastMessageInternalComment)
      .map((c) => ({
        conversationId:  c.id,
        contactId:       c.contactId ?? "",
        contactName:     c.contactName || c.fullName || "(no name)",
        phone:           c.phone ?? "",
        email:           c.email ?? "",
        lastMessageDate: c.lastMessageDate ?? 0,
        preview:         String(c.lastMessageBody ?? "").trim(),
        unreadCount:     c.unreadCount ?? 0,
      }))
      // Oldest unanswered first — the seller ignored longest is closest to
      // giving up, not the most recent (spec §2.1 rationale).
      .sort((a, b) => a.lastMessageDate - b.lastMessageDate);

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(rows),
    };
  } catch (err: any) {
    console.error("[ghl-conversations]", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message ?? "Internal error" }),
    };
  }
};
