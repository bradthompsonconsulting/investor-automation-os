const GHL_BASE = "https://services.leadconnectorhq.com";
const TWILIO_LOOKUP_BASE = "https://lookups.twilio.com/v2";

// Twilio returns: mobile, landline, voip, nonFixedVoip, tollFree, unknown
function mapLineType(twilioType: string): "Mobile" | "Landline" | "VoIP" | "Unknown" {
  switch ((twilioType ?? "").toLowerCase()) {
    case "mobile":
      return "Mobile";
    case "landline":
      return "Landline";
    case "voip":
    case "nonfixedvoip":
    case "tollfree":
      return "VoIP";
    default:
      return "Unknown";
  }
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

function twilioBasicAuth(): string {
  const creds = `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

async function lookupLineType(phone: string): Promise<string> {
  const url = `${TWILIO_LOOKUP_BASE}/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`;
  const res = await fetch(url, { headers: { Authorization: twilioBasicAuth() } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio Lookup ${res.status}: ${text}`);
  }
  const body = await res.json();
  return body.line_type_intelligence?.type ?? "unknown";
}

async function updateGhlContactPhoneType(contactId: string, phoneType: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify({
      customFields: [{ key: "phone_type", field_value: phoneType }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL PUT /contacts/${contactId} → ${res.status}: ${text}`);
  }
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let data: { contactId?: string; phone?: string } = {};
  try {
    data = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { contactId, phone } = data;
  if (!contactId || !phone) {
    return { statusCode: 400, body: "Missing contactId or phone" };
  }

  // Step 1 — Twilio Lookup (fail gracefully → Unknown)
  let phoneType: "Mobile" | "Landline" | "VoIP" | "Unknown" = "Unknown";
  try {
    const twilioType = await lookupLineType(phone);
    phoneType = mapLineType(twilioType);
    console.log(`[phone-lookup] ${phone} → Twilio="${twilioType}" mapped="${phoneType}"`);
  } catch (err) {
    console.error("[phone-lookup] Twilio error (writing Unknown):", err);
  }

  // Step 2 — GHL contact update
  try {
    await updateGhlContactPhoneType(contactId, phoneType);
    console.log(`[phone-lookup] contact ${contactId} phone_type = ${phoneType}`);
  } catch (err) {
    console.error("[phone-lookup] GHL update failed:", err);
    return { statusCode: 500, body: String(err) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ contactId, phone, phoneType }),
  };
};
