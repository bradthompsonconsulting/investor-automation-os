import { randomUUID } from "node:crypto";
import { VOICE_ACTION } from "../../shared/voice-call-contract";
import { requireOperator } from "./lib/operator-auth";
import { acquireAttempt, netlifyAttemptStore, transitionAttempt, toAttemptView } from "./lib/voice-attempt-store";
import { json, safeJsonBody } from "./lib/voice-http";
import { issueTwilioVoiceToken, readEligibleGhlContact, voiceCapability } from "./lib/voice-provider";

const ID = /^[A-Za-z0-9_-]{6,128}$/;

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: json(204, null).headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  try {
    const operator = requireOperator(event);
    const capability = voiceCapability();
    if (!capability.enabled) return json(503, { error: "IAOS voice is unavailable", reasons: capability.reasons });
    const body = safeJsonBody(event);
    if (Object.keys(body).sort().join(",") !== "action,attemptId,contactId" || body.action !== VOICE_ACTION ||
        typeof body.contactId !== "string" || typeof body.attemptId !== "string" || !ID.test(body.contactId) || !ID.test(body.attemptId)) {
      return json(400, { error: "Expected only a valid action, contactId, and attemptId" });
    }
    const eligibility = await readEligibleGhlContact(body.contactId);
    if (!eligibility.eligible) return json(409, { error: eligibility.reason, code: eligibility.code });
    const store = netlifyAttemptStore();
    const now = new Date().toISOString();
    const acquired = await acquireAttempt(store, body.contactId, body.attemptId, now);
    if (acquired.record.timestamps.dialConsumedAt) return json(409, { error: "Voice attempt was already consumed" });
    const ready = acquired.record.providerState.state === "ready"
      ? acquired.record
      : await transitionAttempt(store, body.contactId, body.attemptId, "ready", now);
    const voice = issueTwilioVoiceToken(`brad-${randomUUID()}`);
    return json(200, { ...toAttemptView(ready), voiceToken: voice.token, voiceTokenExpiresAt: voice.expiresAt });
  } catch (error: any) {
    const status = /session|authorized/i.test(error.message ?? "") ? 401 : /unresolved voice attempt|contention/i.test(error.message ?? "") ? 409 : 500;
    return json(status, { error: error.message ?? "Voice authorization failed" });
  }
};
