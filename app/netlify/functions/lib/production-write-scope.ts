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
 *
 * Walkthrough allowances (INV-98, Board #9, 2026-09-29). The derivation
 * above covered what the SERVER requires, not what the supported UI writers
 * require on the pinned walkthrough. Six more writes are permitted, each only
 * on the pinned pair and only while both Production flags are enabled:
 *   - `opportunity.arv`, value exactly 485000 (number, strict equality);
 *   - `opportunity.repairs`, value exactly 52000 (number, strict equality);
 *   - the ARV approval ledger note, decision OVERRIDE, approved ARV 485000;
 *   - `contact.lastCallAttempt` on the pinned contact (Confirm Accept's
 *     final write);
 *   - the OVERRIDDEN readiness decision note ("approved" stays refused);
 *   - the disposition handoff note, which must also name the pinned contact.
 * The three field writes are additionally gated in `ghl-write.ts`, under the
 * contact lock and before the write claim or any PUT, by
 * `evaluateProductionPairedOwnership`: the pinned opportunity, read fresh,
 * must still belong to the pinned contact and sit in Seller Leads.
 * The Contract Ready checklist stays refused: no walkthrough step gates on it.
 */
import { getConfig, PRODUCTION_PROOF_SCOPE_ENABLED, PRODUCTION_PROOF_CONTACT_NOT_PINNED, PRODUCTION_PROOF_OPPORTUNITY_NOT_PINNED, PRODUCTION_CALL_LOG_ENABLED } from "../../../shared/ghl-config";
import { callLogResults } from "./write-contracts";
import { isDncNoteBody } from "../../../src/lib/dnc";
import { PRODUCTION_DNC_ENABLED } from "../../../shared/ghl-config";
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
  "contact.lastCallAttempt": "pinned_contact",
  "contact.callback": "refused",
  "contact.explicitCallback": "refused",
  "contact.propertyNotes": "refused",
  "contact.arv": "refused",
  "contact.disposition": "refused",
  "contact.routing": "refused",
  "contact.dispositionAt": "refused",
  "contact.callLogResult": "refused",
  "contact.occupancy": "refused",
  "note.create": "pinned_contact_note",
  "task.complete": "refused",
  "opportunity.askingPrice": "refused",
  "opportunity.arv": "pinned_opportunity_value",
  "opportunity.repairs": "pinned_opportunity_value",
  "opportunity.currentOffer": "pinned_opportunity",
  "opportunity.assignmentMode": "refused",
  "opportunity.underContractStage": "pinned_opportunity",
  "opportunity.underwriting": "refused",
} as const satisfies Record<string, "refused" | "pinned_opportunity" | "pinned_opportunity_value" | "pinned_contact" | "pinned_contact_note">;

/**
 * The only values a `pinned_opportunity_value` write may carry: Brad's
 * approved synthetic economics for the pinned fixture. Compared with strict
 * `===` against a number -- a string, a near value or a coerced value is
 * refused.
 */
export const PRODUCTION_PINNED_VALUES: Readonly<Record<string, number>> = Object.freeze({
  "opportunity.arv": 485000,
  "opportunity.repairs": 52000,
});

/** Operations whose handler must prove, under the contact lock, that the pinned opportunity still belongs to the pinned contact in Seller Leads. */
export const PRODUCTION_PAIRED_OPERATIONS: ReadonlySet<string> = new Set(["opportunity.arv", "opportunity.repairs", "contact.lastCallAttempt"]);

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
  // Walkthrough: Seller Call's accept gate (OVERRIDDEN only) and the ARV
  // Override ledger entry for the pinned synthetic value only.
  { parse: parseReadinessHumanActionNote, allow: (r) => r.kind === "overridden" },
  { parse: parseArvApprovalNote, allow: (r) => r.decision === "OVERRIDE" && r.approvedArv === PRODUCTION_PINNED_VALUES["opportunity.arv"] },
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
  // Start Disposition. classifyNote also requires contactId === pinned contact.
  { parse: parseDispositionHandoffNote, allow: () => true },
  // Refused in Production -- not needed for the synthetic contract.
  { parse: parsePropertyIdentityConfirmationNote, allow: null },
  { parse: parseTransactionAssumptionsNote, allow: null },
  { parse: parseSellerPricePositionNote, allow: null },
  { parse: parseReadinessDecisionInvalidationNote, allow: null },
  { parse: parseContractReadyChecklistNote, allow: null },
  { parse: parseNegotiationOverrideNote, allow: null },
  { parse: parseBuyerEntityOverrideNote, allow: null },
  { parse: parseRepresentationFactsNote, allow: null },
  { parse: parseContractLifecycleNote, allow: null },
  { parse: parseContractProjectionSyncNote, allow: null },
];

/** Matches `contract-production-readiness.ts`'s own GHL identifier shape. */
const GHL_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
function isPinned(value: unknown, placeholder: string): value is string {
  return typeof value === "string" && value !== placeholder && GHL_ID_SHAPE.test(value);
}

export function isTestDeployment(config: GhlConfig): boolean {
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
function classifyNote(body: string, pinnedOpportunityId: string, pinnedContactId: string): ProductionWriteScopeResult {
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
  // Only the disposition handoff carrier names a contact today; any permitted
  // note that names one must name the pinned contact.
  if (Object.prototype.hasOwnProperty.call(record, "contactId") && record.contactId !== pinnedContactId) return { ok: false, code: "TARGET_NOT_PINNED" };
  return { ok: true };
}

/** `ghl-write.ts` -- evaluated after `planWrite`, before `connectLambda`. */
/* ------------------------------------------------------------------ */
/* B14-12 — Production call-log permission class (Brad, 2026-10-02)     */
/* ------------------------------------------------------------------ */

const CALL_LOG_NOTE_PREFIX = "Call (reported by Brad in IAOS): ";
const CALL_LOG_NOTES_MAX = 4000;
/* `formatCallbackTime`'s exact shape ("Oct 9, 2:30 PM"); newer ICU puts a
   narrow no-break space before AM/PM. */
const CALLBACK_NOTE = /^Callback scheduled for [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}[ \u202f](AM|PM)$/;

/** True only for an exact call-log note: one of the six results on the first line, then at most 4,000 characters of notes. */
export function isCallLogNoteBody(body: string): boolean {
  const nl = body.indexOf("\n");
  const first = nl === -1 ? body : body.slice(0, nl);
  const rest = nl === -1 ? "" : body.slice(nl + 1);
  if (!first.startsWith(CALL_LOG_NOTE_PREFIX)) return false;
  if (!callLogResults.includes(first.slice(CALL_LOG_NOTE_PREFIX.length))) return false;
  return nl === -1 || (rest.trim().length > 0 && rest.length <= CALL_LOG_NOTES_MAX);
}

/** True only for the exact note `scheduleCallbackGated` writes. */
export function isCallbackNoteBody(body: string): boolean {
  return CALLBACK_NOTE.test(body);
}

export function productionCallLogEnabled(config: GhlConfig): boolean {
  return !isTestDeployment(config) && config.productionCallLog === PRODUCTION_CALL_LOG_ENABLED;
}

/**
 * The call-log class. `null` = not covered (the Board #9 rules below decide,
 * exactly as before). Covered only while ENABLED, for any Production contact.
 */
function evaluateProductionCallLog(config: GhlConfig, request: { operation: string; targetId: string; args: unknown }): ProductionWriteScopeResult | null {
  if (!productionCallLogEnabled(config)) return null;
  switch (request.operation) {
    case "contact.callLogResult":
    case "contact.lastCallAttempt":
    // The explicit Set/Clear Callback action only. Generic contact.callback
    // (Seller Call Follow-Up's first write) stays refused, so Follow-Up fails
    // before it writes anything (Bones, PR #118).
    case "contact.explicitCallback":
      return { ok: true };
    case "note.create": {
      const body = (request.args as { body?: unknown } | null)?.body;
      return typeof body === "string" && (isCallLogNoteBody(body) || isCallbackNoteBody(body)) ? { ok: true } : null;
    }
    default:
      return null;
  }
}

/* B14-12 — Production Do Not Call class: its own flag, independent of the call-log class. */
export function productionDncEnabled(config: GhlConfig): boolean {
  return !isTestDeployment(config) && config.productionDnc === PRODUCTION_DNC_ENABLED;
}
function evaluateProductionDnc(config: GhlConfig, request: { operation: string; targetId: string; args: unknown }): ProductionWriteScopeResult | null {
  if (!productionDncEnabled(config)) return null;
  if (request.operation === "note.create" && isDncNoteBody((request.args as { body?: unknown } | null)?.body)) return { ok: true };
  return null;
}

export function evaluateProductionGhlWriteScope(config: GhlConfig, request: { operation: string; targetId: string; args: unknown }): ProductionWriteScopeResult {
  if (isTestDeployment(config)) return { ok: true };
  const dnc = evaluateProductionDnc(config, request);
  if (dnc) return dnc;
  const callLog = evaluateProductionCallLog(config, request);
  if (callLog) return callLog;
  const pre = productionPreconditions(config);
  if (!pre.ok) return pre;
  const scope = (PRODUCTION_OPERATION_SCOPE as Record<string, string>)[request.operation];
  if (scope === "pinned_opportunity") {
    return request.targetId === pre.opportunityId ? { ok: true } : { ok: false, code: "TARGET_NOT_PINNED" };
  }
  if (scope === "pinned_opportunity_value") {
    if (request.targetId !== pre.opportunityId) return { ok: false, code: "TARGET_NOT_PINNED" };
    const value = (request.args as { value?: unknown } | null)?.value;
    return typeof value === "number" && value === PRODUCTION_PINNED_VALUES[request.operation] ? { ok: true } : { ok: false, code: "OPERATION_NOT_PERMITTED" };
  }
  if (scope === "pinned_contact") {
    return request.targetId === pre.contactId ? { ok: true } : { ok: false, code: "TARGET_NOT_PINNED" };
  }
  if (scope === "pinned_contact_note") {
    if (request.targetId !== pre.contactId) return { ok: false, code: "TARGET_NOT_PINNED" };
    const body = (request.args as { body?: unknown } | null)?.body;
    if (typeof body !== "string") return { ok: false, code: "NOTE_NOT_PERMITTED" };
    return classifyNote(body, pre.opportunityId!, pre.contactId!);
  }
  return { ok: false, code: "OPERATION_NOT_PERMITTED" };
}

/** True when `ghl-write.ts` must run `evaluateProductionPairedOwnership` for this operation (never in Test). */
export function requiresProductionPairedOwnership(config: GhlConfig, operation: string, targetId?: string): boolean {
  if (isTestDeployment(config) || !PRODUCTION_PAIRED_OPERATIONS.has(operation)) return false;
  // B14-12: a call-log last touch on any contact other than the pinned one is
  // permitted by the call-log class, not by the Board #9 pairing.
  if (operation === "contact.lastCallAttempt" && productionCallLogEnabled(config) && targetId !== undefined && targetId !== config.productionProofScope.contactId) return false;
  return true;
}

/**
 * `ghl-write.ts` -- for `PRODUCTION_PAIRED_OPERATIONS` only, under the contact
 * lock and before the write claim or any PUT. The pinned opportunity, read
 * fresh, must be the pinned id, owned by the pinned contact, in the Seller
 * Leads pipeline.
 */
export function evaluateProductionPairedOwnership(config: GhlConfig, opportunity: { id?: unknown; contactId?: unknown; pipelineId?: unknown } | null | undefined): ProductionWriteScopeResult {
  if (isTestDeployment(config)) return { ok: true };
  const pre = productionPreconditions(config);
  if (!pre.ok) return pre;
  if (!opportunity || opportunity.id !== pre.opportunityId || opportunity.contactId !== pre.contactId || opportunity.pipelineId !== config.pipelines.sellerLeads) {
    return { ok: false, code: "TARGET_NOT_PINNED" };
  }
  return { ok: true };
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
