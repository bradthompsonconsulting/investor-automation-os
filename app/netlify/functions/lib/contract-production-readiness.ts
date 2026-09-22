/**
 * INV-98 Phase 1 -- ONE shared, reason-coded readiness policy for every
 * place that decides whether a contract-path action (PDF generation,
 * provider-document readback, Under Contract stage transition,
 * disposition-handoff acceptance) may proceed for the CURRENT deployment.
 * Replaces `generate-contract-pdf.ts`'s hardcoded `TEST_LOCATION_ID`
 * refusal and the two duplicated "Contract provider evidence is
 * Test-only" inline checks in `write-derived-note.ts` -- ONE
 * implementation, never edited in two places again.
 *
 * Test and Production are DELIBERATELY NOT symmetric:
 *
 *   TEST -- pinned to the ONE pre-approved Test contact
 *   (`documentsContracts.approvedTestContactId`), exactly as every call
 *   site already behaved before this phase. Unconditionally unaffected by
 *   `contractProductionEnabled`.
 *
 *   PRODUCTION -- gated on an explicit, non-sentinel
 *   `contractProductionEnabled` flag, PLUS the exact configured Production
 *   location, PLUS a currently-provisioned (non-sentinel, real-shaped)
 *   Under Contract stage, PLUS an authenticated, currently-allowed Brad
 *   operator, PLUS a verified contact/opportunity relationship.
 *   Deliberately carries NO permanent synthetic-contact allowlist -- per
 *   Brad's own ruling, Production must ultimately support any valid,
 *   Brad-authorized Production opportunity once enabled, never stay
 *   pinned to the one proof contact forever.
 *
 * PRODUCTION REMAINS DISABLED as of this module's introduction --
 * `PRODUCTION.contractProductionEnabled` is `CONTRACT_PRODUCTION_NOT_ENABLED`
 * in `shared/ghl-config.ts`, and `evaluateContractEnvironment` fails
 * closed on that flag before any other Production-specific check runs.
 * Flipping it is a separate, later, reviewed config-only commit -- never
 * performed by this module, never implied by any other field being
 * provisioned.
 *
 * Every reason a check fails is collected, never just the first -- the
 * same convention `evaluateDispositionHandoffEligibility` and every other
 * Board #9 evaluator already established.
 */
import { getConfig, CONTRACT_PRODUCTION_ENABLED, UNDER_CONTRACT_STAGE_NOT_PROVISIONED } from "../../../shared/ghl-config";
import type { GhlConfig } from "../../../shared/ghl-config";
import { appAuthConfig } from "./app-write-auth";

export type ContractEnvironmentReasonCode =
  | "UNKNOWN_LOCATION"
  | "PRODUCTION_CONTRACTS_DISABLED"
  | "UNDER_CONTRACT_STAGE_NOT_PROVISIONED";

export type ContractEnvironmentReason = { code: ContractEnvironmentReasonCode; message: string };

export type ContractEnvironmentResult =
  | { ok: true; environment: "test" | "production" }
  | { ok: false; reasons: ContractEnvironmentReason[] };

/** A GHL identifier shape, matching this codebase's own established pattern (ghl-proxy.ts's ID regex). Deliberately excludes "/" and ".", so no sentinel string containing spaces/underscores in a distinctive pattern can accidentally look real, and no path-shaped value can pass either. */
const GHL_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

function looksLikeRealGhlId(value: unknown, sentinel: string): boolean {
  return typeof value === "string" && value.trim() !== "" && value !== sentinel && GHL_ID_SHAPE.test(value);
}

/**
 * Cheap, context-free: is THIS deployment even allowed to attempt a
 * contract-path action at all, before any GHL call. `generate-contract-pdf.ts`
 * calls this FIRST, before body parsing or any network access, preserving
 * the existing "reject before any GHL call" property for the common
 * wrong-environment case.
 */
export function evaluateContractEnvironment(config: GhlConfig): ContractEnvironmentResult {
  const testLocationId = getConfig("test").locationId;
  const productionLocationId = getConfig("production").locationId;

  if (config.locationId === testLocationId) return { ok: true, environment: "test" };

  if (config.locationId !== productionLocationId) {
    return {
      ok: false,
      reasons: [{ code: "UNKNOWN_LOCATION", message: "This deployment's configured location matches neither the approved Test nor Production location." }],
    };
  }

  const reasons: ContractEnvironmentReason[] = [];
  if (config.contractProductionEnabled !== CONTRACT_PRODUCTION_ENABLED) {
    reasons.push({ code: "PRODUCTION_CONTRACTS_DISABLED", message: "Production contract paths are not enabled." });
  }
  if (!looksLikeRealGhlId(config.stages.underContract, UNDER_CONTRACT_STAGE_NOT_PROVISIONED)) {
    reasons.push({ code: "UNDER_CONTRACT_STAGE_NOT_PROVISIONED", message: "The Production Under Contract stage is not yet provisioned." });
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, environment: "production" };
}

export type ContractProviderEvidenceReasonCode =
  | ContractEnvironmentReasonCode
  | "TEST_CONTACT_MISMATCH"
  | "OPERATOR_NOT_AUTHORIZED"
  | "CONTACT_OPPORTUNITY_MISMATCH"
  | "MALFORMED_IDENTITY";

export type ContractProviderEvidenceReason = { code: ContractProviderEvidenceReasonCode; message: string };

export type ContractProviderEvidenceResult =
  | { ok: true }
  | { ok: false; reasons: ContractProviderEvidenceReason[] };

export type ContractProviderEvidenceArgs = {
  config: GhlConfig;
  contact: { id: string };
  opportunity: { id: string; contactId: string };
  /** The already-authenticated operator email (`requireAppWriter`'s own return value) -- never re-verified as a session/JWT here (this module never sees the raw request), but independently confirmed to still name a currently-configured allowed Brad email, never blindly accepted as a bare string. */
  operatorEmail: string;
};

/**
 * The FULL check -- requires live context (contact + opportunity), so it
 * runs only after `currentContractContext` has resolved. Used by both
 * `write-derived-note.ts` call sites (replacing "Contract provider
 * evidence is Test-only") and by `generate-contract-pdf.ts`, after its own
 * early `evaluateContractEnvironment` pre-check and after context fetch,
 * to confirm the request's location/contact/opportunity scope matches
 * current authoritative context immediately before returning a PDF
 * containing seller/deal facts.
 */
export function evaluateContractProviderEvidenceReadiness(args: ContractProviderEvidenceArgs): ContractProviderEvidenceResult {
  const env = evaluateContractEnvironment(args.config);
  if (!env.ok) return env;

  const reasons: ContractProviderEvidenceReason[] = [];

  if (!looksLikeRealGhlId(args.contact.id, "") || !looksLikeRealGhlId(args.opportunity.id, "")) {
    reasons.push({ code: "MALFORMED_IDENTITY", message: "Contact or opportunity identity is missing or malformed." });
  }
  if (args.opportunity.contactId !== args.contact.id) {
    reasons.push({ code: "CONTACT_OPPORTUNITY_MISMATCH", message: "The opportunity does not belong to the given contact." });
  }

  if (env.environment === "test") {
    if (args.contact.id !== args.config.documentsContracts.approvedTestContactId) {
      reasons.push({ code: "TEST_CONTACT_MISMATCH", message: "Contract provider evidence is Test-only." });
    }
  } else {
    // Deliberately NO permanent synthetic-contact allowlist check here --
    // any real, properly-authorized Production contact/opportunity is
    // eligible once contractProductionEnabled is true and every check
    // above and below passes. Production is reachable past this point
    // only via a currently-allowed, authenticated Brad operator.
    //
    // Gate-review closure -- exact-match only, deliberately NO .toLowerCase()
    // or other normalization applied here. `appAuthConfig().emails` is
    // already the lowercased, trimmed allowlist; `requireAppWriter`
    // (`app-write-auth.ts`) itself authenticates a session by comparing its
    // JWT `claims.sub` against that SAME list with NO case transformation
    // (`config.emails.includes(claims.sub)`) -- a session only exists at all
    // because that exact-match already succeeded once, upstream. Applying a
    // SECOND, independent normalization rule here (e.g. re-lowercasing)
    // would make this check strictly more lenient than the authentication
    // system that produced `operatorEmail` in the first place, accepting a
    // casing variant the real session system would have already refused.
    // This check is a re-confirmation that the SAME already-authenticated
    // identity is still currently allowed -- never a second, looser gate.
    const emails = appAuthConfig().emails;
    if (!args.operatorEmail || !emails.includes(args.operatorEmail)) {
      reasons.push({ code: "OPERATOR_NOT_AUTHORIZED", message: "Production contract provider evidence requires an authenticated, currently-allowed Brad operator." });
    }
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/**
 * Throwing wrapper. Preserves the EXACT original message,
 * "Contract provider evidence is Test-only", for any Test-environment
 * failure -- existing callers/messages depend on this literal text, and
 * in practice only TEST_CONTACT_MISMATCH can ever actually fire for a
 * legitimately-constructed Test context (MALFORMED_IDENTITY and
 * CONTACT_OPPORTUNITY_MISMATCH are structural invariants that already
 * hold by construction, since `context.contact` is always fetched FROM
 * `context.opportunity.contactId` -- see `currentContractContext`).
 * Production failures, being genuinely new, get their own distinct,
 * reason-coded message.
 */
export function requireContractProviderEvidenceReadiness(args: ContractProviderEvidenceArgs): void {
  const result = evaluateContractProviderEvidenceReadiness(args);
  if (result.ok) return;
  const env = evaluateContractEnvironment(args.config);
  if (env.ok === false || env.environment === "test") {
    throw new Error("Contract provider evidence is Test-only");
  }
  throw new Error("Production contract provider evidence is not currently authorized: " + result.reasons.map((r) => r.code).join(", "));
}
