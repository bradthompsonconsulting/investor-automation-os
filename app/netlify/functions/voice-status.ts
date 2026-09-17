import { applyProviderCallback, netlifyAttemptStore } from "./lib/voice-attempt-store";
import { externalRequestUrl, formParams, json, twilioSignature } from "./lib/voice-http";
import { verifyTwilioSignature, voiceCapability } from "./lib/voice-provider";

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const params = formParams(event);
  if (!verifyTwilioSignature(twilioSignature(event), externalRequestUrl(event), params)) return json(403, { error: "Invalid provider signature" });
  if (!voiceCapability().enabled) return json(503, { error: "IAOS voice is unavailable" });
  const contactId = String(event.queryStringParameters?.contactId ?? "");
  const attemptId = String(event.queryStringParameters?.attemptId ?? "");
  const status = String(params.CallStatus ?? params.DialCallStatus ?? "");
  const rawSequence = params.SequenceNumber;
  const sequence = rawSequence !== undefined && /^\d+$/.test(rawSequence) ? Number(rawSequence) : null;
  if (!contactId || !attemptId || !status) return json(400, { error: "Missing callback binding or status" });
  try {
    await applyProviderCallback(netlifyAttemptStore(), contactId, attemptId, {
      status,
      providerCallId: String(params.ParentCallSid ?? ""),
      providerChildCallId: String(params.CallSid ?? params.DialCallSid ?? ""),
      sequence,
      observedAt: new Date().toISOString(),
    });
    return { statusCode: 204, headers: json(204, null).headers, body: "" };
  } catch (error: any) {
    return json(409, { error: error.message ?? "Provider status rejected" });
  }
};
