/**
 * INV-98 Board #9 -- the Production proof write scope.
 *
 * ONE pure, fail-closed decision for every `IAOS_APP_WRITE_*`-authenticated
 * write entry point (`ghl-write.ts`, `ghl-executed-artifact-upload.ts`).
 * Each caller evaluates it immediately after authentication, origin and
 * request-shape validation, and BEFORE `connectLambda`, any Blob store, the
 * contact lock, the write claim, or any GHL call. A refusal therefore has
 * no side effect of any kind.
 *
 * TEST IS UNCHANGED. For the Test location this returns `{ ok: true }`
 * unconditionally and reads nothing else -- every Test write keeps its
 * existing gates exactly as before.
 *
 * PRODUCTION permits a write ONLY when ALL of the following hold:
 *   1. `productionProofScope.enabled` is exactly `PRODUCTION_PROOF_SCOPE_ENABLED`;
 *   2. both pinned ids are real (non-placeholder, GHL-id-shaped);
 *   3. the existing contract environment gate passes
 *      (`contractProductionEnabled` + a provisioned Under Contract stage);
 *   4. the operation is one of the named synthetic-contract operations
 *      below, targeting exactly the pinned id.
 * Everything else -- every contact field, task, routing, disposition,
 * underwriting, other opportunity field, and every note that is not one
 * of the named contract-path notes -- is refused.
 *
 * The allowlist is the 24-operation synthetic-contract set (Jeff's
 * read-only derivation, 2026-09-24): the Current Offer field and the
 * accepted-agreement note that `currentContractContext` requires, the
 * fifteen contract-facts notes whose absence leaves a required fact
 * unresolved, and the contract-path notes, artifact upload and stage
 * transition. `test-production-write-scope.cjs` proves the facts subset is
 * both sufficient and minimal against the real `currentContractContext`.
 */
import { getConfig, PRODUCTION_PROOF_SCOPE_ENABLED, PRODUCTION_PROOF_CONTACT_NOT_PINNED, PRODUCTION_PROOF_OPPORTUNITY_NOT_PINNED } from "../../../shared/ghl-config";
import type { GhlConfig } from "../../../shared/ghl-config";
import { evaluateContractEnvironment } from "./contract-production-readiness";
import { parseArvApprovalNote } from "../../../src/lib/arv-approval-note";
import { parseOutcomeNote } from "../../../src/lib/seller-call-outcome";
import { parsePropertyIdentityConfirmationNote, parseTransactionAssumptionsNote, parseSellerPricePositionNote, parseReadinessHumanActionNote, parseReadinessDecisionInvalidationNote, parseContractReadyChecklistNote } from "../../../src/lib/seller-call-readiness-carriers";
import { parseNegotiationOverrideNote } from "../../../src/lib/seller-call-negotiation-override-note";
import { parseBuyerEntityOverrideNote, parsePartySignerFactsNote, parsePropertyLegalDescriptionFactsNote, parseLeaseDisclosureFactsNote, parseEarnestMoneyOptionFactsNote, parseTitleSurveyFactsNote, parsePropertyConditionFactsNote, parseClosingPossessionFactsNote, parseSettlementExpenseFactsNote, parseRepresentationFactsNote, parseAddendaApplicabilityFactsNote, parseSellerEquitableInterestDisclosureNote, parseAttorneyManualFieldDispositionNote, parseSellerNoticeConfirmationFactsNote, parseBuyerBusinessConfigFactsNote, parseSellerSigningModelNote } from "../../../src/lib/seller-contract-facts-carriers";
import { parseBradContractAuthorizationNote } from "../../../src/lib/contract-authorization-carriers";
import { parseDispositionHandoffNote } from "../../../src/lib/contract-disposition-handoff-carriers";
import { parseExecutedTermsAttestationNote } from "../../../src/lib/contract-executed-terms-attestation-carriers";
import { parseContractLifecycleNote } from "../../../src/lib/contract-lifecycle-carriers";
import { parseUnderContractNote } from "../../../src/lib/contract-execution-carriers";
import { parseContractProjectionSyncNote } from "../../../src/lib/contract-projection-sync-carriers";
import { parseContractSendNote } from "../../../src/lib/contract-send-carriers";
import { parseSignerMappingAttestationNote } from "../../../src/lib/contract-signer-mapping-carriers";
import { MANUAL_SEND_TEMPLATE_SOURCE } from "../../../src/lib/contract-manual-send-model";

/** The `by` marker every refusal carries, distinguishing this gate from every other 403. */
export const PRODUCTION_WRITE_SCOPE_REFUSAL = "iaos-production-write-scope" as const;

export type ProductionWriteScopeCode =
  | "PRODUCTION_WRITES_DISABLED"
  | "PRODUCTION_PROOF_NOT_PINNED"
  | "PRODUCTION_CONTRACTS_NOT_READY"
  | "OPERATION_NOT_PERMITTED"
  | "TARGET_NOT_PINNED"
  | "NOTE_NOT_PERMITTED";

export type ProductionWriteScopeResult = { ok: true } | { ok: false; code: ProductionWriteScopeCode };

/**
 * Every named `ghl-write` operation (`write-contracts.ts`'s `planWrite`),
 * classified. `test-production-write-scope.cjs` fails if any `planWrite`
 * case is missing from this table, so a new operation can never be
 * silently permitted or silently unclassified.
 */
export const PRODUCTION_OPERATION_SCOPE = {
  "contact.lastCallAttempt": "refused",
  "contact.callback": "refused",
  "contact.propertyNotes": "refused",
  "contact.arv": "refused",
  "contact.disposition": "refused",
  "contact.routing": "refused",
  "contact.dispositionAt": "refused",
  "contact.occupancy": "refused",
  "note.create": "pinned_contact_note",
  "task.complete": "refused",
  "opportunity.askingPrice": "refused",
  "opportunity.arv": "refused",
  "opportunity.repairs": "refused",
  "opportunity.currentOffer": "pinned_opportunity",
  "opportunity.assignmentMode": "refused",
  "opportunity.underContractStage": "pinned_opportunity",
  "opportunity.underwriting": "refused",
} as const satisfies Record<string, "refused" | "pinned_opportunity" | "pinned_contact_note">;

type ParsedRecord = { opportunityId?: unknown; [key: string]: unknown };

/**
 * Every ledger-note parser `write-note-guard.ts` recognizes, classified.
 * `allow` is `null` for a refused kind, or a predicate the parsed record
 * must also satisfy. `test-production-write-scope.cjs` fails if any
 * parser in `write-note-guard.ts` is missing here.
 */
export const PRODUCTION_NOTE_SCOPE: ReadonlyArray<{ parse: (body: string) => unknown; allow: ((record: ParsedRecord) => boolean) | null }> = [
  // Prerequisites -- the accepted agreement and the fifteen required facts.
  { parse: parseOutcomeNote, allow: (r) => r.kind === "accept" },
  { parse: parseSellerSigningModelNote, allow: () => true },
  { parse: parsePartySignerFactsNote, allow: () => true },
  { parse: parsePropertyLegalDescriptionFactsNote, allow: () => true },
  { parse: parseLeaseDisclosureFactsNote, allow: () => true },
  { parse: parseEarnestMoneyOptionFactsNote, allow: () => true },
  { parse: parseTitleSurveyFactsNote, allow: () => true },
  { parse: parsePropertyConditionFactsNote, allow: () => true },
  { parse: parseClosingPossessionFactsNote, allow: () => true },
  { parse: parseSettlementExpenseFactsNote, allow: () => true },
  { parse: parseAddendaApplicabilityFactsNote, allow: () => true },
  { parse: parseBuyerBusinessConfigFactsNote, allow: () => true },
  { parse: parseSellerNoticeConfirmationFactsNote, allow: () => true },
  { parse: parseSellerEquitableInterestDisclosureNote, allow: () => true },
  { parse: parseAttorneyManualFieldDispositionNote, allow: (r) => r.slot === "special_provisions" || r.slot === "other_addenda_text" },
  // Contract path.
  { parse: parseBradContractAuthorizationNote, allow: () => true },
  { parse: parseContractSendNote, allow: (r) => r.status === "accepted" && r.templateSource === MANUAL_SEND_TEMPLATE_SOURCE },
  { parse: parseSignerMappingAttestationNote, allow: () => true },
  { parse: parseExecutedTermsAttestationNote, allow: () => true },
  { parse: parseUnderContractNote, allow: () => true },
  // Refused in Production -- not needed for the synthetic contract.
  { parse: parseArvApprovalNote, allow: null },
  { parse: parsePropertyIdentityConfirmationNote, allow: null },
  { parse: parseTransactionAssumptionsNote, allow: null },
  { parse: parseSellerPricePositionNote, allow: null },
  { parse: parseReadinessHumanActionNote, allow: null },
  { parse: parseReadinessDecisionInvalidationNote, allow: null },
  { parse: parseContractReadyChecklistNote, allow: null },
  { parse: parseNegotiationOverrideNote, allow: null },
  { parse: parseBuyerEntityOverrideNote, allow: null },
  { parse: parseRepresentationFactsNote, allow: null },
  { parse: parseDispositionHandoffNote, allow: null },
  { parse: parseContractLifecycleNote, allow: null },
  { parse: parseContractProjectionSyncNote, allow: null },
];

/** Matches `contract-production-readiness.ts`'s own GHL identifier shape. */
const GHL_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
function isPinned(value: unknown, placeholder: string): value is string {
  return typeof value === "string" && value !== placeholder && GHL_ID_SHAPE.test(value);
}

function isTestDeployment(config: GhlConfig): boolean {
  return config.locationId === getConfig("test").locationId;
}

/** Steps 1-3 -- shared by every entry point. */
function productionPreconditions(config: GhlConfig): ProductionWriteScopeResult & { contactId?: string; opportunityId?: string } {
  const scope = config.productionProofScope;
  if (scope.enabled !== PRODUCTION_PROOF_SCOPE_ENABLED) return { ok: false, code: "PRODUCTION_WRITES_DISABLED" };
  if (!isPinned(scope.contactId, PRODUCTION_PROOF_CONTACT_NOT_PINNED) || !isPinned(scope.opportunityId, PRODUCTION_PROOF_OPPORTUNITY_NOT_PINNED)) {
    return { ok: false, code: "PRODUCTION_PROOF_NOT_PINNED" };
  }
  if (!evaluateContractEnvironment(config).ok) return { ok: false, code: "PRODUCTION_CONTRACTS_NOT_READY" };
  return { ok: true, contactId: scope.contactId, opportunityId: scope.opportunityId };
}

/**
 * Classifies a note body. Every parser is evaluated (never first-match),
 * so a body that any refused parser recognizes is refused even if an
 * allowed parser also recognizes it, and a body no parser recognizes --
 * a plain note -- is refused.
 */
function classifyNote(body: string, pinnedOpportunityId: string): ProductionWriteScopeResult {
  const matches: Array<{ allow: ((record: ParsedRecord) => boolean) | null; record: ParsedRecord }> = [];
  for (const entry of PRODUCTION_NOTE_SCOPE) {
    let record: unknown = null;
    try { record = entry.parse(body); } catch { record = null; }
    if (record && typeof record === "object") matches.push({ allow: entry.allow, record: record as ParsedRecord });
  }
  if (matches.length !== 1) return { ok: false, code: "NOTE_NOT_PERMITTED" };
  const [{ allow, record }] = matches;
  if (allow === null || !allow(record)) return { ok: false, code: "NOTE_NOT_PERMITTED" };
  if (record.opportunityId !== pinnedOpportunityId) return { ok: false, code: "TARGET_NOT_PINNED" };
  return { ok: true };
}

/** `ghl-write.ts` -- evaluated after `planWrite`, before `connectLambda`. */
export function evaluateProductionGhlWriteScope(config: GhlConfig, request: { operation: string; targetId: string; args: unknown }): ProductionWriteScopeResult {
  if (isTestDeployment(config)) return { ok: true };
  const pre = productionPreconditions(config);
  if (!pre.ok) return pre;
  const scope = (PRODUCTION_OPERATION_SCOPE as Record<string, string>)[request.operation];
  if (scope === "pinned_opportunity") {
    return request.targetId === pre.opportunityId ? { ok: true } : { ok: false, code: "TARGET_NOT_PINNED" };
  }
  if (scope === "pinned_contact_note") {
    if (request.targetId !== pre.contactId) return { ok: false, code: "TARGET_NOT_PINNED" };
    const body = (request.args as { body?: unknown } | null)?.body;
    if (typeof body !== "string") return { ok: false, code: "NOTE_NOT_PERMITTED" };
    return classifyNote(body, pre.opportunityId!);
  }
  return { ok: false, code: "OPERATION_NOT_PERMITTED" };
}

/** `ghl-executed-artifact-upload.ts` -- evaluated after request validation, before `connectLambda`. */
export function evaluateProductionArtifactUploadScope(config: GhlConfig, opportunityId: string): ProductionWriteScopeResult {
  if (isTestDeployment(config)) return { ok: true };
  const pre = productionPreconditions(config);
  if (!pre.ok) return pre;
  return opportunityId === pre.opportunityId ? { ok: true } : { ok: false, code: "TARGET_NOT_PINNED" };
}

/**
 * `ghl-executed-artifact-upload.ts` -- defense in depth after its
 * read-only opportunity GET and before any Blob write: the pinned
 * opportunity must still belong to the pinned contact.
 */
export function evaluateProductionArtifactContactScope(config: GhlConfig, contactId: unknown): ProductionWriteScopeResult {
  if (isTestDeployment(config)) return { ok: true };
  const pre = productionPreconditions(config);
  if (!pre.ok) return pre;
  return contactId === pre.contactId ? { ok: true } : { ok: false, code: "TARGET_NOT_PINNED" };
}
