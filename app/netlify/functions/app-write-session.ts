import { appAuthConfig, googleAppIdentity, issueAppSession } from "./lib/app-write-auth";
export const handler = async (event: any) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const config = appAuthConfig();
    if (event.httpMethod === "GET") return { statusCode: 200, headers, body: JSON.stringify({ clientId: config.clientId }) };
    if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "{}" };
    const body = JSON.parse(event.body ?? "null");
    if (!body || Array.isArray(body) || Object.keys(body).join() !== "googleIdToken" || typeof body.googleIdToken !== "string" || !body.googleIdToken || body.googleIdToken.length > 16384) throw new Error("Invalid identity request");
    const email = await googleAppIdentity(body.googleIdToken);
    return { statusCode: 200, headers, body: JSON.stringify(issueAppSession(email)) };
  } catch { return { statusCode: 401, headers, body: JSON.stringify({ error: "Application write sign-in unavailable or refused" }) }; }
};
