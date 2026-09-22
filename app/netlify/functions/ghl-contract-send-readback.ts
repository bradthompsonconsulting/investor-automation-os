/**
 * Contract-send READBACK — B9-08 / INV-63 correction round, 2026-09-11
 * (item 5: "a successful POST response is not sufficient... perform
 * authoritative provider readback").
 *
 * INV-98 gate-review closure (post-PR#87 hardening round). Rewritten from
 * an unscoped, Test-only, browser-`documentId`-trusting endpoint into the
 * one authenticated, scoped, data-minimized browser surface for the
 * Contract Workspace's "Fetch live provider readback" control.
 *
 * POST /.netlify/functions/ghl-contract-send-readback
 * body: { opportunityId }  -- the ONLY accepted field. A `documentId` is
 * NEVER accepted from the browser -- it is always independently derived
 * server-side from the durable, accepted contract-send record for this
 * exact opportunity (`latestContractSendForOpportunity`), never trusted
 * from a caller claim. This closes the prior version's scoping gap (any
 * authenticated caller could request classification for an arbitrary
 * documentId unrelated to any opportunity they were actually working).
 *
 * Gated by the SAME shared `contract-production-readiness.ts` policy
 * every other contract path uses (`evaluateContractEnvironment` before
 * any GHL call, `requireContractProviderEvidenceReadiness` after context
 * resolution) -- replaces the old hardcoded `LOCATION_ID !== TEST_LOCATION_ID`
 * check. Production remains disabled this phase exactly as everywhere
 * else; Test remains pinned to its approved contact via the same policy.
 *
 * DATA MINIMIZATION (Gatekeeper ruling, binding). This endpoint fetches
 * GHL's own `GET /proposals/document` ("List Documents"), which returns
 * up to 21 of the location's most recent documents with no documentId
 * filter available -- but the browser NEVER sees that raw list, any raw
 * document row, any raw recipient object, sender/createdBy metadata, or
 * raw fillable-field data. Every one of those up-to-21 rows is consumed
 * ENTIRELY server-side; the response returned to the browser is composed
 * exclusively of: an overall classification status/failureReason; the
 * one matched document's id/status/revision; a provider-completion
 * verdict/timestamp; a DEDUPLICATED list of bare, opaque provider
 * recipient ids (sourced only from the one matched document) so the
 * already-shipped signer-recipient mapping dropdown keeps working; a
 * per-required-signer completion verdict (IAOS's OWN role/displayName
 * labels, never GHL's reported name); and a buyer-identity verdict
 * (ok/reasons only -- the underlying provider-reported buyer name/email
 * this check compares against is verified server-side and NEVER
 * serialized into the response, including inside any reason message).
 *
 * DELIBERATE EXCEPTION to this codebase's netlify/functions <-> src/lib
 * boundary (see `lib/contract-send-guard.ts`'s own header on why that
 * boundary is normally kept, by duplicating small stable carrier
 * helpers). The provider-document fetch+match logic below duplicates
 * (never imports from) `write-derived-note.ts`'s own inline
 * `providerOutcome`/`verifyUnderContractStageTransitionReady` readback
 * logic -- small and stable, matching this file's own established
 * convention -- so this repair never touches that load-bearing write-
 * gating file at all. Every OTHER function used below
 * (`classifyDocumentReadback`, `classifyManualSendReadback`,
 * `extractProviderSignerRowsFromListDocumentsBody`, `verifyRequiredSigners`,
 * `verifyBuyerSignerIdentity`, `buildRequiredSignerSet`,
 * `verifySignerMappingAttestationCurrency`, `verifyProviderCompletion`,
 * `buildProviderObservationRecordFromReadback`) is large, evolving, pure
 * `src/lib` logic already shared by the real write-gating path -- these
 * ARE imported, never duplicated, per that same established convention.
 */

import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { getConfig } from "../../shared/ghl-config";
import { evaluateContractEnvironment, requireContractProviderEvidenceReadiness } from "./lib/contract-production-readiness";
import { configuredBoundary } from "./lib/ghl-write-boundary";
import { currentContractContext } from "./lib/write-contract-context";
import { latestContractSendForOpportunity } from "../../src/lib/contract-send-carriers";
import { classifyDocumentReadback, classifyManualSendReadback, type DocumentReadbackOutcome } from "../../src/lib/contract-send-model";
import { MANUAL_SEND_TEMPLATE_SOURCE } from "../../src/lib/contract-manual-send-model";
import { allContractLifecycleRecordsForOpportunity } from "../../src/lib/contract-lifecycle-carriers";
import { buildProviderObservationRecordFromReadback } from "../../src/lib/contract-lifecycle-model";
import { extractProviderSignerRowsFromListDocumentsBody, verifyRequiredSigners, verifyBuyerSignerIdentity, verifyProviderCompletion } from "../../src/lib/contract-execution-model";
import { buildRequiredSignerSet, verifySignerMappingAttestationCurrency } from "../../src/lib/contract-signer-mapping-model";
import { latestSignerMappingAttestationForOpportunity } from "../../src/lib/contract-signer-mapping-carriers";

const GHL_BASE = "https://services.leadconnectorhq.com";
const CONFIG = getConfig(process.env.IAOS_ENV);

/**
 * Gate-review closure, 2026-09-13, unchanged by this rewrite: `GET
 * /proposals/document` rejects any `limit` above 21 with `422 "limit
 * must not be greater than 21"` -- OBSERVED directly against the live
 * Test location. 21 is the verified supported maximum, not a guess.
 */
const MAX_LIST_DOCUMENTS_LIMIT = 21;

// The exact, configured browser Origin -- never a wildcard. This endpoint
// ultimately returns signer-completion/buyer-identity verdicts derived
// from a real seller's contract evidence; a wildcard
// Access-Control-Allow-Origin would let any origin holding a valid bearer
// token read that response. Matches generate-contract-pdf.ts's own
// convention exactly.
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

type ReasonPair = { code: string; message: string };

/**
 * Gate-review closure, binding ruling: `verifyBuyerSignerIdentity`'s own
 * `BUYER_IDENTITY_MISMATCH` message interpolates the live GHL-reported
 * buyer name/email directly into its text -- correct and necessary for
 * the fully-authenticated in-browser display this function was ORIGINALLY
 * written for, but exactly the field this endpoint's response must never
 * carry. Every other buyer-identity reason code's message is already
 * static/structural (verified by direct reading of
 * `contract-execution-model.ts::verifyBuyerSignerIdentity`) and passes
 * through unchanged; only `BUYER_IDENTITY_MISMATCH` is replaced with a
 * fixed, PII-free message here -- deliberately NOT a generic passthrough
 * of `reason.message`, so a future edit to that function's wording can
 * never silently reopen this leak.
 */
function redactBuyerReasons(reasons: readonly { code: string; message: string }[]): ReasonPair[] {
  return reasons.map((r) =>
    r.code === "BUYER_IDENTITY_MISMATCH"
      ? { code: r.code, message: "The buyer's mapped provider recipient's reported identity does not match the authorized legal buyer." }
      : { code: r.code, message: r.message },
  );
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { ...CORS, "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let operator: string;
  try {
    operator = requireAppWriter(event);
  } catch {
    return json(401, { error: "Application write sign-in required" });
  }

  try {
    requireAppWriteOrigin(event);
  } catch {
    return json(403, { error: "Application write origin refused" });
  }

  // Cheap, context-free: is this deployment even allowed to attempt a
  // contract-path read at all, before any body parsing or GHL access.
  if (!evaluateContractEnvironment(CONFIG).ok) {
    return json(403, { error: "Forbidden", by: "iaos-contract-send-readback-environment-not-ready" });
  }

  let opportunityId: string;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("Unexpected request envelope");
    const payload = JSON.parse(event.body ?? "null");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Malformed body");
    if (Object.keys(payload).length !== 1 || typeof payload.opportunityId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.opportunityId)) {
      // Deliberately rejects a body carrying a `documentId` field (or any
      // other field) alongside/instead of `opportunityId` -- the browser
      // is never permitted to supply a document identity, only an
      // opportunity. See this file's own header.
      throw new Error("Expected exactly one field, opportunityId");
    }
    opportunityId = payload.opportunityId;
  } catch {
    return json(400, { error: "Malformed request" });
  }

  try {
    const boundary = configuredBoundary();
    const context = await currentContractContext(boundary, opportunityId);

    // The full, context-aware check -- confirms the request's actual
    // location/contact/opportunity scope matches current authoritative
    // context, and that the authenticated operator is currently allowed,
    // before any provider document data is fetched.
    requireContractProviderEvidenceReadiness({
      config: CONFIG,
      contact: context.contact,
      opportunity: context.opportunity,
      operatorEmail: operator,
    });

    // The accepted send is independently re-derived from fresh notes --
    // never accepted as a caller claim. This is the SAME resolution
    // ContractWorkspace.tsx's own `existingSend` already performs for
    // display, now re-derived server-side from a fresh read.
    const acceptedSend = latestContractSendForOpportunity(context.notes, opportunityId);
    if (!acceptedSend || acceptedSend.status !== "accepted" || !acceptedSend.providerResponse?.documentId) {
      return json(409, { error: "No accepted send evidence exists for this opportunity" });
    }
    const documentId = acceptedSend.providerResponse.documentId;

    // Provider-document fetch+match -- small, stable logic duplicated
    // (never imported) from write-derived-note.ts's own inline
    // providerOutcome/verifyUnderContractStageTransitionReady, per this
    // file's own header rationale.
    const qs = new URLSearchParams({ locationId: CONFIG.locationId, limit: String(MAX_LIST_DOCUMENTS_LIMIT) });
    const res = await boundary.fetcher(`${GHL_BASE}/proposals/document?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${boundary.token}`, Version: "v3" },
    });
    if (!res.ok) throw new Error(`Provider document readback failed (HTTP ${res.status})`);
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as any).documents)) throw new Error("Ambiguous document readback");
    if ((body as any).documents.filter((d: any) => d?.documentId === documentId).length > 1) throw new Error("Ambiguous document readback");
    const outcome: DocumentReadbackOutcome = { kind: "http_response", status: res.status, body };

    const isManual = acceptedSend.templateSource === MANUAL_SEND_TEMPLATE_SOURCE;
    const classified = isManual
      ? classifyManualSendReadback({
          expectedDocumentId: documentId,
          expectedLocationId: CONFIG.locationId,
          expectedDocumentRevision: acceptedSend.providerResponse?.documentRevision ?? null,
          outcome,
        })
      : classifyDocumentReadback({
          expectedDocumentId: documentId,
          expectedRecipientId: context.contact.id,
          expectedSenderUserId: CONFIG.documentsContracts.senderUserId,
          expectedLocationId: CONFIG.locationId,
          outcome,
        });

    // Provider-completion verdict -- reuses the SAME lifecycle-evidence
    // logic the real Under Contract gate is built on (write-derived-note.ts
    // imports the same two functions), never a separate, second
    // implementation of "is this document reported complete."
    const history = allContractLifecycleRecordsForOpportunity(context.notes, opportunityId);
    const observed = buildProviderObservationRecordFromReadback({
      opportunityId,
      version: acceptedSend.version,
      expectedDocumentId: documentId,
      expectedLocationId: CONFIG.locationId,
      acceptedSend,
      outcome,
      iaosObservedAt: new Date().toISOString(),
      evidenceSummary: "Live in-browser readback via the authenticated contract-readback endpoint.",
      relatedPriorRecordId: null,
    });
    const providerCompletion = !observed.ok
      ? { ok: false as const, reasons: [{ code: "PROVIDER_OBSERVATION_REFUSED", message: "The live provider observation could not be built from this readback." }] }
      : verifyProviderCompletion({ opportunityId, version: context.version, lifecycleHistory: [...history, observed.value] });

    // Signer completion + buyer identity + the deduplicated, matched-
    // document-only recipient id list -- all derived from the SAME one
    // matched document; the underlying rows never leave this function.
    const requiredSignerSetResult = buildRequiredSignerSet(context.report);
    const rowsResult = extractProviderSignerRowsFromListDocumentsBody({ body, expectedDocumentId: documentId, expectedLocationId: CONFIG.locationId });
    const availableProviderRecipientIds = rowsResult.ok ? Array.from(new Set(rowsResult.rows.map((r) => r.providerRecipientId))) : [];

    let signerCompletion: { ok: true; matches: { role: string; displayName: string; providerRecipientId: string; providerCompletedAt: string | null }[] } | { ok: false; reasons: ReasonPair[] };
    let buyerIdentity: { ok: boolean; reasons: ReasonPair[] };

    if (!requiredSignerSetResult.ok) {
      signerCompletion = { ok: false, reasons: requiredSignerSetResult.reasons };
      buyerIdentity = { ok: false, reasons: requiredSignerSetResult.reasons };
    } else if (!rowsResult.ok) {
      const reasons: ReasonPair[] = [{ code: "SIGNER_ROWS_UNAVAILABLE", message: rowsResult.reason }];
      signerCompletion = { ok: false, reasons };
      buyerIdentity = { ok: false, reasons };
    } else {
      const attestation = latestSignerMappingAttestationForOpportunity(context.notes, opportunityId);
      const mappingCurrency = verifySignerMappingAttestationCurrency({
        attestation,
        opportunityId,
        version: context.version,
        providerDocumentId: documentId,
        providerDocumentRevision: classified.summary?.documentRevision ?? null,
        acceptedSendAttemptId: acceptedSend.attemptId,
        requiredSigners: requiredSignerSetResult.signers,
      });
      if (!mappingCurrency.ok) {
        signerCompletion = { ok: false, reasons: mappingCurrency.reasons };
        buyerIdentity = { ok: false, reasons: mappingCurrency.reasons };
      } else {
        const verification = verifyRequiredSigners({ mappings: mappingCurrency.mappings, providerRecipients: rowsResult.rows });
        signerCompletion = verification;
        const buyerResult = verifyBuyerSignerIdentity({
          buyerSignerRole: requiredSignerSetResult.buyerRole,
          authorizedBuyerName: requiredSignerSetResult.buyerDisplayName,
          authorizedBuyerEmail: requiredSignerSetResult.buyerEmail,
          mappings: mappingCurrency.mappings,
          providerRecipients: rowsResult.rows,
        });
        buyerIdentity = buyerResult.ok ? { ok: true, reasons: [] } : { ok: false, reasons: redactBuyerReasons(buyerResult.reasons) };
      }
    }

    return json(200, {
      status: classified.status,
      failureReason: classified.failureReason,
      providerDocumentId: classified.summary?.documentId ?? null,
      documentStatus: classified.summary?.readbackStatus ?? null,
      documentRevision: classified.summary?.documentRevision ?? null,
      providerCompletion,
      availableProviderRecipientIds,
      signerCompletion,
      buyerIdentity,
    });
  } catch (error: any) {
    // Fail closed -- the message is operator-facing only; it never
    // carries a token, credential, raw GHL response body, or PII.
    return json(409, { error: error?.message ?? "Could not read back the provider document." });
  }
};
