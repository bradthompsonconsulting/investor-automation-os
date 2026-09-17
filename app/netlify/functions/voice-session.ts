import { issueOperatorSession, verifyGoogleIdentity } from "./lib/operator-auth";
import { json, safeJsonBody } from "./lib/voice-http";

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: json(204, null).headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  try {
    const body = safeJsonBody(event);
    if (Object.keys(body).sort().join(",") !== "googleIdToken" || typeof body.googleIdToken !== "string") return json(400, { error: "Expected googleIdToken only" });
    const identity = await verifyGoogleIdentity(body.googleIdToken);
    return json(200, issueOperatorSession(identity.email));
  } catch (error: any) {
    return json(401, { error: error.message ?? "Unauthorized" });
  }
};
