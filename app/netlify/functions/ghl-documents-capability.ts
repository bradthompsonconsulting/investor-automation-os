/**
 * INV-98 Board #9 -- Documents & Contracts read-capability check.
 *
 * GET /.netlify/functions/ghl-documents-capability
 *
 * Answers ONE question before any synthetic Production document is sent:
 * can THIS deployment's own GHL credential read GHL Documents & Contracts?
 * It makes exactly one server-side request,
 * `GET /proposals/document?locationId=<configured>&limit=1`, and returns
 * only `{ httpStatus, documentsArrayPresent }`.
 *
 * NEVER returns the provider body, any document id, name, status,
 * recipient or link, the token, or any header. Nothing is cached, stored
 * or logged beyond the HTTP status. Read-only: GET is the only accepted
 * method and the only outbound method. Brad's application READ session is
 * required (`readAuthRefusal`, 503 unconfigured / 401 refused), so it
 * depends on no `IAOS_APP_WRITE_*` setting and no contract enablement.
 *
 * FAILS CLOSED. An absent or unknown `IAOS_ENV` throws at load (getConfig
 * at module scope, like every function here); a missing
 * `GHL_PRIVATE_API_KEY` answers 500 before any outbound request; a network
 * failure answers 502 with no detail.
 */
import { getConfig } from "../../shared/ghl-config";
import { readAuthRefusal } from "./lib/app-read-auth";

const GHL_BASE = "https://services.leadconnectorhq.com";
const CONFIG = getConfig(process.env.IAOS_ENV);
const RESPONSE_HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" };

export const handler = async (event: any) => {
  const refused = readAuthRefusal(event);
  if (refused) return refused;
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: RESPONSE_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };

  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) return { statusCode: 500, headers: RESPONSE_HEADERS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };

  let httpStatus: number;
  let documentsArrayPresent = false;
  try {
    const url = `${GHL_BASE}/proposals/document?` + new URLSearchParams({ locationId: CONFIG.locationId, limit: "1" });
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Version: "v3" } });
    httpStatus = response.status;
    if (response.ok) {
      try {
        const body = await response.json();
        documentsArrayPresent = Array.isArray(body?.documents);
      } catch {
        documentsArrayPresent = false;
      }
    }
  } catch {
    return { statusCode: 502, headers: RESPONSE_HEADERS, body: JSON.stringify({ error: "Documents & Contracts request failed" }) };
  }
  return { statusCode: 200, headers: RESPONSE_HEADERS, body: JSON.stringify({ httpStatus, documentsArrayPresent }) };
};
