import twilio from "twilio";
import { getConfig } from "../../../shared/ghl-config";

const GHL_BASE = "https://services.leadconnectorhq.com";

export type VoiceEligibility =
  | { eligible: true; contactId: string; destination: string }
  | { eligible: false; code: "invalid-phone" | "suppressed" | "suppression-unknown" | "incorrect-number" | "contact-mismatch"; reason: string };

export function normalizeUsPhone(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (/^\+1\d{10}$/.test(value)) return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function customFieldValue(fields: any[], id: string): string {
  const field = fields.find((candidate) => candidate?.id === id);
  return String(field?.value ?? field?.fieldValue ?? "").trim();
}

export function evaluateVoiceEligibility(raw: any, expectedContactId: string, env = process.env): VoiceEligibility {
  if (!raw || String(raw.id ?? "") !== expectedContactId) return { eligible: false, code: "contact-mismatch", reason: "GHL contact identity did not match" };
  const config = getConfig(env.IAOS_ENV);
  if (String(raw.locationId ?? "") !== config.locationId) return { eligible: false, code: "contact-mismatch", reason: "GHL contact location did not match the selected IAOS environment" };
  const destination = normalizeUsPhone(raw.phone);
  if (!destination) return { eligible: false, code: "invalid-phone", reason: "Seller phone is missing or invalid" };
  if (customFieldValue(raw.customFields ?? [], config.fields.phoneStatus).toLowerCase() === "incorrect number") {
    return { eligible: false, code: "incorrect-number", reason: "GHL marks the primary phone as Incorrect Number" };
  }
  if (raw.dnd === true) return { eligible: false, code: "suppressed", reason: "GHL contact-wide DND is active" };
  const settings = raw.dndSettings;
  if (!settings || typeof settings !== "object") return { eligible: false, code: "suppression-unknown", reason: "Voice suppression authority is missing" };
  const entry = Object.entries(settings).find(([key]) => /^(call|voice)$/i.test(key))?.[1] as any;
  const status = String(entry?.status ?? "").trim().toLowerCase();
  if (status === "active") return { eligible: false, code: "suppressed", reason: "GHL voice DND is active" };
  if (status !== "inactive") return { eligible: false, code: "suppression-unknown", reason: "GHL voice suppression authority is unresolved" };
  return { eligible: true, contactId: expectedContactId, destination };
}

export async function readEligibleGhlContact(contactId: string, fetcher: typeof fetch = fetch, env = process.env): Promise<VoiceEligibility> {
  const token = env.GHL_PRIVATE_API_KEY?.trim();
  if (!token) throw new Error("GHL_PRIVATE_API_KEY is not configured");
  const response = await fetcher(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (!response.ok) throw new Error(`GHL contact read failed (${response.status})`);
  const body = await response.json() as any;
  return evaluateVoiceEligibility(body.contact ?? body, contactId, env);
}

export function issueTwilioVoiceToken(identity: string, ttlSeconds = 300, env = process.env): { token: string; expiresAt: string } {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const apiKey = env.TWILIO_API_KEY_SID?.trim();
  const apiSecret = env.TWILIO_API_KEY_SECRET?.trim();
  const appSid = env.TWILIO_TWIML_APP_SID?.trim();
  if (!accountSid || !apiKey || !apiSecret || !appSid) throw new Error("Twilio voice token configuration is incomplete");
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKey, apiSecret, { identity, ttl: ttlSeconds });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: appSid, incomingAllow: false }));
  return { token: token.toJwt(), expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}

export function verifyTwilioSignature(signature: string, url: string, params: Record<string, string>, env = process.env): boolean {
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken || !signature || !url) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

export function voiceCapability(env = process.env): { enabled: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (env.IAOS_ENV !== "test") reasons.push("IAOS voice is restricted to TEST");
  if (env.IAOS_VOICE_ENABLED !== "true") reasons.push("IAOS_VOICE_ENABLED is not true");
  for (const key of ["GOOGLE_OAUTH_CLIENT_ID", "IAOS_VOICE_BRAD_EMAILS", "IAOS_VOICE_SESSION_SECRET", "GHL_PRIVATE_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_AUTH_TOKEN", "TWILIO_TWIML_APP_SID", "TWILIO_OUTBOUND_CALLER_ID", "IAOS_VOICE_PUBLIC_BASE_URL"]) {
    if (!env[key]?.trim()) reasons.push(`${key} is not configured`);
  }
  if (!normalizeUsPhone(env.TWILIO_OUTBOUND_CALLER_ID)) reasons.push("TWILIO_OUTBOUND_CALLER_ID is invalid");
  return { enabled: reasons.length === 0, reasons };
}
