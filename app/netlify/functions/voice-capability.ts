import { requireOperator } from "./lib/operator-auth";
import { json } from "./lib/voice-http";
import { voiceCapability } from "./lib/voice-provider";

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: json(204, null).headers, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });
  try {
    requireOperator(event);
    const capability = voiceCapability();
    return json(200, capability);
  } catch (error: any) {
    return json(401, { error: error.message ?? "Unauthorized" });
  }
};
