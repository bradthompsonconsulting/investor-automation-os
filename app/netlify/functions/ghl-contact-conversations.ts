/**
 * GHL per-contact conversation history — server-side function. Holds
 * GHL_PRIVATE_API_KEY (the ghl-proxy pit- token lacks the Conversations scope).
 *
 * GET /.netlify/functions/ghl-contact-conversations?id={contactId}
 * Returns ONE contact's messages (SMS/email/call log), oldest→newest, read-only.
 *
 * Scoping (CONTACT_WORKSPACE_SPEC_v2.md §11 / step 5): the read is keyed to the
 * explicit contactId via GHL's CONVERSATIONS API — search by contactId, then that
 * conversation's messages. It NEVER touches the contacts LIST/SEARCH endpoint
 * (GET /contacts?locationId=, i.e. listAll), so it does not inherit §11's list
 * eventual-consistency lag / transient record drop.
 *
 * Read-only: GET /conversations/search + GET /conversations/{id}/messages only.
 * No writes — the three-write invariant is untouched.
 *
 * NOTE: the message-field mapping below (direction / messageType / body /
 * dateAdded, nesting messages.messages, pagination nextPage/lastMessageId) is
 * PENDING live confirmation via the Brad-run probe — see the step-5 open
 * questions in CONTACT_WORKSPACE_SPEC_v2.md §8. Adjust to observed shapes before
 * shipping.
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const MESSAGE_CAP = 500; // bound the transcript; sellers won't exceed this in practice

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Friendly channel label from GHL's messageType enum (e.g. "TYPE_SMS" → "SMS").
function channelOf(messageType: unknown): string {
  const s = String(messageType ?? "").replace(/^TYPE_/, "");
  if (!s) return "Message";
  return s.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

export interface ConvMessageRow {
  id:             string;
  conversationId: string;
  contactId:      string;           // kept so callers can cross-check scoping
  direction:      string;           // "inbound" | "outbound"
  channel:        string;           // friendly label (SMS / Email / Call / …)
  messageType:    string;           // raw GHL enum, for reference
  body:           string;
  dateAdded:      string;           // ISO
}

export interface ContactConversationsResult {
  contactId:         string;
  conversationCount: number;
  messages:          ConvMessageRow[];
}

async function messagesFor(token: string, conversationId: string): Promise<any[]> {
  const out: any[] = [];
  let lastMessageId: string | undefined;
  while (out.length < MESSAGE_CAP) {
    const params = new URLSearchParams({ limit: "100" });
    if (lastMessageId) params.set("lastMessageId", lastMessageId);
    const res  = await fetch(`${GHL_BASE}/conversations/${conversationId}/messages?${params}`, { headers: headers(token) });
    const body = await res.json();
    if (!res.ok) throw new Error(`GET /conversations/${conversationId}/messages → ${res.status}: ${JSON.stringify(body)}`);
    // GHL nests as { messages: { messages: [...], nextPage, lastMessageId } };
    // tolerate a flat { messages: [...] } too.
    const page: any[] = body?.messages?.messages ?? (Array.isArray(body?.messages) ? body.messages : []);
    out.push(...page);
    const nextPage = body?.messages?.nextPage;
    lastMessageId  = body?.messages?.lastMessageId;
    if (!nextPage || !lastMessageId || page.length === 0) break;
    await delay(110);
  }
  return out;
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "missing ?id" }) };

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };

  try {
    // 1) Conversation(s) for THIS contact — scoped by explicit contactId.
    const sParams = new URLSearchParams({ locationId: LOCATION_ID, contactId: id });
    const sRes  = await fetch(`${GHL_BASE}/conversations/search?${sParams}`, { headers: headers(token) });
    const sBody = await sRes.json();
    if (!sRes.ok) throw new Error(`GET /conversations/search?contactId → ${sRes.status}: ${JSON.stringify(sBody)}`);

    const conversations: any[] = sBody.conversations ?? [];
    // The open question, surfaced not worked around: if search returns
    // conversations but any lacks an id, we CANNOT reliably fetch its messages.
    // Fail loud (502) rather than silently dropping — per Brad's instruction.
    const withoutId = conversations.filter((c) => !c?.id);
    if (conversations.length > 0 && withoutId.length > 0) {
      return {
        statusCode: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "conversation returned without an id — cannot scope messages reliably",
          conversationCount: conversations.length,
          withoutIdCount: withoutId.length,
        }),
      };
    }

    // 2) Messages per conversation, merged.
    const rows: ConvMessageRow[] = [];
    for (const c of conversations) {
      const msgs = await messagesFor(token, c.id);
      for (const m of msgs) {
        rows.push({
          id:             m.id ?? "",
          conversationId: m.conversationId ?? c.id,
          contactId:      m.contactId ?? id,
          direction:      m.direction ?? "",
          channel:        channelOf(m.messageType ?? m.type),
          messageType:    String(m.messageType ?? m.type ?? ""),
          body:           String(m.body ?? "").trim(),
          dateAdded:      m.dateAdded ?? "",
        });
      }
      await delay(110);
    }

    // Oldest → newest: a call-prep transcript reads the way the conversation happened (§7).
    rows.sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

    const result: ContactConversationsResult = {
      contactId:         id,
      conversationCount: conversations.length,
      messages:          rows,
    };
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (err: any) {
    console.error("[ghl-contact-conversations]", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message ?? "Internal error" }) };
  }
};
