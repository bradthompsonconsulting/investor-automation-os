import { requireOperator } from "./lib/operator-auth";
import { attemptKey, netlifyAttemptStore, toAttemptView } from "./lib/voice-attempt-store";
import { json } from "./lib/voice-http";

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: json(204, null).headers, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });
  try {
    requireOperator(event);
    const contactId = String(event.queryStringParameters?.contactId ?? "");
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(contactId)) return json(400, { error: "Invalid contactId" });
    const current = await netlifyAttemptStore().read(attemptKey(contactId));
    if (!current || current.record.contactBinding !== contactId) return json(404, { error: "Voice attempt not found" });
    return json(200, toAttemptView(current.record));
  } catch (error: any) {
    return json(401, { error: error.message ?? "Unauthorized" });
  }
};
