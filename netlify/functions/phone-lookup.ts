import { requireWebhook } from "../../app/netlify/functions/lib/write-webhook-auth";
import { configuredBoundary } from "../../app/netlify/functions/lib/ghl-write-boundary";
import { exact, identifier } from "../../app/netlify/functions/lib/write-contracts";
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
  const boundary = configuredBoundary(process.env.GHL_API_TOKEN);
  const defs = await boundary.call(`/locations/${boundary.locationId}/customFields`);
  if (!Array.isArray(defs.customFields)) throw new Error("Phone Type field definition unavailable");
  const fields = defs.customFields.filter((f: any) => f.fieldKey === "contact.phone_type" || f.fieldKey === "phone_type");
  if (fields.length !== 1 || !["Mobile", "Landline", "VoIP", "Unknown"].includes(phoneType)) throw new Error("Invalid Phone Type field or result");
  identifier(fields[0].id);
  const result = await boundary.fields("contact", contactId, [{ id: fields[0].id, field_value: phoneType }]);
  if (!result.confirmed) throw new Error("Phone Type readback mismatch");
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try { requireWebhook(event, "IAOS_PHONE_LOOKUP_WEBHOOK_SECRET"); } catch { return { statusCode: 401, body: "Webhook authorization refused" }; }
  let data: { contactId?: string; phone?: string } = {};
  try {
    data = JSON.parse(event.body ?? "{}");
    exact(data, ["contactId", "phone"]);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { contactId, phone } = data;
  if (!contactId || !phone) {
    return { statusCode: 400, body: "Missing contactId or phone" };
  }

  try {
    exact(data, ["contactId", "phone"]); identifier(contactId);
    if (typeof phone !== "string" || !phone.trim()) throw new Error("Invalid phone");
    const contact = await configuredBoundary(process.env.GHL_API_TOKEN).contact(contactId);
    if (contact.phone !== phone) throw new Error("Phone does not match the contact");
  } catch { return { statusCode: 403, body: "Target identity refused" }; }
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
