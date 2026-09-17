import { consumeDial, netlifyAttemptStore, transitionAttempt } from "./lib/voice-attempt-store";
import { externalRequestUrl, formParams, twilioSignature, xmlEscape } from "./lib/voice-http";
import { normalizeUsPhone, readEligibleGhlContact, verifyTwilioSignature, voiceCapability } from "./lib/voice-provider";

const XML_HEADERS = { "Content-Type": "application/xml", "Cache-Control": "no-store" };
const hangup = (statusCode = 200) => ({ statusCode, headers: XML_HEADERS, body: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>" });

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") return hangup(405);
  const params = formParams(event);
  if (!verifyTwilioSignature(twilioSignature(event), externalRequestUrl(event), params)) return hangup(403);
  const contactId = String(params.contactId ?? "");
  const attemptId = String(params.attemptId ?? "");
  if (!contactId || !attemptId || params.action !== "authorize-outbound-call") return hangup(400);
  const capability = voiceCapability();
  if (!capability.enabled) return hangup(503);
  const store = netlifyAttemptStore();
  try {
    const eligibility = await readEligibleGhlContact(contactId);
    if (!eligibility.eligible) {
      await transitionAttempt(store, contactId, attemptId, "rejected", new Date().toISOString());
      return hangup();
    }
    const consumed = await consumeDial(store, contactId, attemptId, String(params.CallSid ?? ""), new Date().toISOString());
    if (!consumed) return hangup();
    const callerId = normalizeUsPhone(process.env.TWILIO_OUTBOUND_CALLER_ID)!;
    const base = process.env.IAOS_VOICE_PUBLIC_BASE_URL!.replace(/\/$/, "");
    const callback = `${base}/.netlify/functions/voice-status?contactId=${encodeURIComponent(contactId)}&attemptId=${encodeURIComponent(attemptId)}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${xmlEscape(callerId)}" answerOnBridge="true" record="do-not-record"><Number statusCallback="${xmlEscape(callback)}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${xmlEscape(eligibility.destination)}</Number></Dial></Response>`;
    return { statusCode: 200, headers: XML_HEADERS, body: xml };
  } catch {
    try { await transitionAttempt(store, contactId, attemptId, "failed", new Date().toISOString()); } catch { /* keep prior authoritative state */ }
    return hangup(500);
  }
};
