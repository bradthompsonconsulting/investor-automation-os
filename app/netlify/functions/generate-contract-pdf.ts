/**
 * Board #9 Phase B -- live contract-PDF generation endpoint.
 *
 * POST /.netlify/functions/generate-contract-pdf
 * body: { opportunityId }
 *
 * The smallest authenticated server surface needed for Brad to generate
 * the CURRENT populated TREC 20-19 PDF before authorizing it. Accepts
 * ONLY an opportunityId -- never facts, never a plan, never a claimed
 * hash -- fetches live canonical facts itself via `currentContractContext`
 * (PR #78) and generates via the merged Phase A/B runtime generator
 * (PR #81, `generateCurrentContractPdf`), both reused unmodified. Returns
 * the PDF bytes (base64) plus the generator's own evidence record --
 * the browser never computes or claims a hash; it only carries forward
 * exactly what this endpoint independently produced.
 *
 * NO PERSISTENCE. No server-side artifact custody, no Blob write --
 * matches the existing manual-executed-artifact bridge's own "no server
 * PDF custody" principle. The browser holds the returned bytes in memory
 * only, for exactly as long as ContractWorkspace.tsx's own component
 * state lives.
 *
 * Test-location gated, identically to every other Board #9 write/generate
 * surface -- no Production path exists here.
 */
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { configuredBoundary } from "./lib/ghl-write-boundary";
import { currentContractContext, generateCurrentContractPdf } from "./lib/write-contract-context";
import { getConfig } from "../../shared/ghl-config";

const LOCATION_ID = getConfig(process.env.IAOS_ENV).locationId;
const TEST_LOCATION_ID = getConfig("test").locationId;

// The exact, configured browser Origin -- never a wildcard. This endpoint
// returns a populated PDF (seller name/address/financials); a wildcard
// Access-Control-Allow-Origin would let any origin holding a valid bearer
// token read that response, undermining requireAppWriteOrigin's own exact-
// origin enforcement below. Falls back to a value that can never match a
// real browser Origin header if unconfigured, rather than a wildcard.
const ALLOWED_ORIGIN = typeof process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN === "string" && process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN
  ? process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN
  : "https://write-origin-not-configured.invalid";

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (statusCode: number, data: unknown) => ({
  statusCode,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(data),
});

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { ...CORS, "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    requireAppWriter(event);
  } catch {
    return json(401, { error: "Application write sign-in required" });
  }

  // Exact-Origin boundary -- the same PR #78 helper every other Board #9
  // write/generate surface uses. Checked BEFORE the Test-location gate,
  // body parsing, or any GHL access -- a wrong, missing, malformed, or
  // ambiguous Origin is refused before this endpoint does anything else.
  try {
    requireAppWriteOrigin(event);
  } catch {
    return json(403, { error: "Application write origin refused" });
  }

  if (LOCATION_ID !== TEST_LOCATION_ID) {
    return json(403, { error: "Forbidden", by: "iaos-generate-contract-pdf-test-only" });
  }

  let opportunityId: string;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request envelope");
    const payload = JSON.parse(event.body ?? "null");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Malformed body");
    if (Object.keys(payload).length !== 1 || typeof payload.opportunityId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.opportunityId)) {
      throw new Error("Expected exactly one field, opportunityId");
    }
    opportunityId = payload.opportunityId;
  } catch {
    return json(400, { error: "Malformed request" });
  }

  try {
    const context = await currentContractContext(configuredBoundary(), opportunityId);
    const { outputBytes, evidence } = await generateCurrentContractPdf(context);
    return json(200, {
      pdfBase64: Buffer.from(outputBytes).toString("base64"),
      evidence,
    });
  } catch (error: any) {
    // Fail closed -- never a partial or guessed result. The message is
    // operator-facing only (Test-location, single-operator V1); it never
    // carries a token, credential, or raw GHL response body.
    return json(409, { error: error?.message ?? "Could not generate the contract PDF." });
  }
};
