import { appAuthConfig, googleAppIdentity, issueAppSession } from "./lib/app-write-auth";
import { oneLoginActiveFor } from "../../shared/ghl-config";
export const handler = async (event: any) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  // B15-29 (INV-137): while one IAOS sign-in is on, this popup issuer is retired server-side -- no token on ANY path
  // (its sid-less tokens could not be revoked; every writer refuses them anyway). Off: unchanged.
  if (oneLoginActiveFor(process.env.IAOS_ENV)) return { statusCode: 410, headers, body: JSON.stringify({ error: "Saving uses the IAOS sign-in" }) };
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
