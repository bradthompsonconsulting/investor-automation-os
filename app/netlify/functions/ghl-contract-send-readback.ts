/**
 * Contract-send READBACK — B9-08 / INV-63 correction round, 2026-09-11
 * (item 5: "a successful POST response is not sufficient... perform
 * authoritative provider readback").
 *
 * POST /.netlify/functions/ghl-contract-send-readback
 * body: { documentId }
 *
 * This is SERVER-SIDE, not client-side, because the cross-checks item
 * 4/5 ask for -- "sender, recipient... are exact" -- can only be
 * verified against the TRUE configured `approvedTestContactId` /
 * `senderUserId`, and those are deliberately never sent to the browser
 * (ghl-config.ts's own SERVER-SIDE ONLY doctrine, unchanged by this
 * correction round). A browser-side classification could only ever
 * compare the readback against what the POST response ITSELF already
 * claimed -- which verifies nothing new, since a wrong or spoofed POST
 * response would simply agree with itself. Only the server, which knows
 * the real expected values independently, can perform a genuine
 * cross-check.
 *
 * DELIBERATE EXCEPTION to this codebase's netlify/functions <-> src/lib
 * boundary (see `lib/contract-send-guard.ts`'s own header on why that
 * boundary is normally kept, by duplicating small stable carrier
 * helpers). `classifyDocumentReadback` is ~80 lines of branching,
 * evolving classification logic -- duplicating it here would risk two
 * copies silently diverging, which is a worse outcome than importing
 * the ONE pure, non-React, non-fetch function this file needs from
 * `src/lib/contract-send-model.ts`. This import is read-only logic, not
 * a second write path.
 */

import { getConfig } from "../../shared/ghl-config";
import { classifyDocumentReadback, type DocumentReadbackOutcome } from "../../src/lib/contract-send-model";

const GHL_BASE = "https://services.leadconnectorhq.com";
const { locationId: LOCATION_ID, documentsContracts: DOCUMENTS_CONTRACTS } = getConfig(process.env.IAOS_ENV);
const TEST_LOCATION_ID = getConfig("test").locationId;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  if (LOCATION_ID !== TEST_LOCATION_ID) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Forbidden", by: "iaos-contract-send-readback-test-only" }) };
  }

  let payload: Record<string, unknown>;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Malformed JSON body" }) };
  }
  const documentId = payload.documentId;
  if (typeof documentId !== "string" || documentId === "") {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing documentId" }) };
  }

  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };
  }

  let outcome: DocumentReadbackOutcome;
  try {
    // No documentId filter is documented on List Documents -- one page,
    // newest-first is assumed but not documented either; this is a
    // KNOWN, REPORTED limitation (see the INV-63 correction-round
    // report), not a silent gap: a Test location with more than `limit`
    // documents already in flight could miss the match. Acceptable for
    // V1's Test-only, low-volume scope; not proven safe at any volume.
    const qs = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    const res = await fetch(`${GHL_BASE}/proposals/document?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "v3" },
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    outcome = { kind: "http_response", status: res.status, body };
  } catch (e: any) {
    outcome = { kind: "network_error", message: e?.message ?? "Network error reading back the document" };
  }

  const classification = classifyDocumentReadback({
    expectedDocumentId: documentId,
    expectedRecipientId: DOCUMENTS_CONTRACTS.approvedTestContactId,
    expectedSenderUserId: DOCUMENTS_CONTRACTS.senderUserId,
    expectedLocationId: TEST_LOCATION_ID,
    outcome,
  });

  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(classification),
  };
};
