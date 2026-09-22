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
 * INV-98 Phase 1 -- gated by the shared `contract-production-readiness.ts`
 * policy instead of a hardcoded Test-only refusal. Production remains
 * disabled throughout this phase (`contractProductionEnabled` is
 * `PRODUCTION_CONTRACTS_NOT_ENABLED`); the early, context-free
 * `evaluateContractEnvironment` check below preserves this endpoint's
 * existing "reject before any body parsing or GHL access" property for
 * the common wrong-environment case, and the full
 * `requireContractProviderEvidenceReadiness` check (after context fetch)
 * confirms the request's location/contact/opportunity scope matches
 * current authoritative context before any PDF bytes are ever returned.
 */
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { configuredBoundary } from "./lib/ghl-write-boundary";
import { currentContractContext, generateCurrentContractPdf } from "./lib/write-contract-context";
import { getConfig } from "../../shared/ghl-config";
import { evaluateContractEnvironment, requireContractProviderEvidenceReadiness } from "./lib/contract-production-readiness";

const CONFIG = getConfig(process.env.IAOS_ENV);

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

  let operator: string;
  try {
    operator = requireAppWriter(event);
  } catch {
    return json(401, { error: "Application write sign-in required" });
  }

  // Exact-Origin boundary -- the same PR #78 helper every other Board #9
  // write/generate surface uses. Checked BEFORE the environment gate,
  // body parsing, or any GHL access -- a wrong, missing, malformed, or
  // ambiguous Origin is refused before this endpoint does anything else.
  try {
    requireAppWriteOrigin(event);
  } catch {
    return json(403, { error: "Application write origin refused" });
  }

  // Cheap, context-free: is this deployment even allowed to attempt PDF
  // generation at all, before any body parsing or GHL access. Production
  // remains disabled this phase, so this always refuses for a Production
  // deployment -- exactly as the prior hardcoded Test-only check did,
  // reason-coded now instead of a single flat boolean.
  if (!evaluateContractEnvironment(CONFIG).ok) {
    return json(403, { error: "Forbidden", by: "iaos-generate-contract-pdf-environment-not-ready" });
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
    // The full, context-aware check -- confirms the request's actual
    // location/contact/opportunity scope matches current authoritative
    // context immediately before any PDF bytes (seller/deal facts) are
    // ever returned. Never skipped even though the early environment
    // check above already ran -- that check cannot see the contact/
    // opportunity relationship, only this one can.
    requireContractProviderEvidenceReadiness({
      config: CONFIG,
      contact: context.contact,
      opportunity: context.opportunity,
      operatorEmail: operator,
    });
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
