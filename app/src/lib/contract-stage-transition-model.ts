/**
 * Board #9 Phase B (B9-13) -- the Under Contract GHL opportunity-stage
 * transition. Product Owner ruling, 2026-09-21: after IAOS independently
 * verifies execution (a genuine, server-re-derived `UnderContractRecordEntry`
 * already durably recorded) and preserves the executed PDF (a genuine,
 * server-re-verified preserved-artifact record), transition the correct
 * opportunity to the exact "Under Contract" stage -- never guessed, never
 * Seller Closed-Won, never any stage but the one explicitly created and
 * read back live: `b5d059c8-7b11-4885-b761-024d5c067cb6` in the Test
 * Seller Leads Pipeline (`wdvKMdPMxs38qoA6lkUa`).
 *
 * PURE. No I/O, no React, no fetch, no `ghl.*` calls. This module decides
 * ELIGIBILITY and IDEMPOTENCY from already-fetched facts; it never fetches
 * anything itself. The actual PUT + readback lives in
 * `netlify/functions/lib/ghl-write-boundary.ts`'s
 * `GhlBoundary.transitionOpportunityStage`, and the independent
 * server-side re-derivation of "has execution genuinely been verified" and
 * "has the artifact genuinely been preserved" lives in
 * `netlify/functions/lib/write-derived-note.ts`, exactly like every other
 * Board #9 derived-note guard -- never trusting a caller's claim that
 * either already happened.
 *
 * NEVER SELLER CLOSED-WON. `forbiddenStageIds` is not a convenience --
 * it is the one hard, non-bypassable invariant this ruling names by name.
 * Every call site (pure eligibility here, and the boundary's own write
 * method) checks it independently; neither trusts the other to have
 * already refused.
 */

export type StageTransitionReasonCode =
  | "UNDER_CONTRACT_RECORD_MISSING"
  | "UNDER_CONTRACT_OPPORTUNITY_MISMATCH"
  | "UNDER_CONTRACT_AGREEMENT_MISMATCH"
  | "UNDER_CONTRACT_VERSION_MISMATCH"
  | "PRESERVED_ARTIFACT_MISSING"
  | "PRESERVED_ARTIFACT_OPPORTUNITY_MISMATCH"
  | "PRESERVED_ARTIFACT_VERSION_MISMATCH"
  | "WRONG_PIPELINE"
  | "WRONG_LOCATION"
  | "TARGET_STAGE_FORBIDDEN"
  | "TARGET_STAGE_NOT_PROVISIONED";

export type StageTransitionReason = { code: StageTransitionReasonCode; message: string };

export type OpportunityStageSnapshot = {
  id: string;
  pipelineId: string;
  pipelineStageId: string;
  locationId: string;
};

/**
 * Refuses (fails closed) unless a genuinely matching Under Contract record
 * AND a genuinely matching preserved-artifact record both exist for this
 * exact opportunity/agreement/version, the opportunity is confirmed to be
 * in the expected pipeline and location, and the configured target stage
 * is neither unprovisioned (Production's sentinel) nor the forbidden
 * Seller Closed-Won id.
 */
export function evaluateUnderContractStageTransitionEligibility(args: {
  opportunity: OpportunityStageSnapshot;
  opportunityId: string;
  agreementAt: string;
  underContractRecord: { opportunityId: string; agreementAt: string; version: unknown } | null;
  preservedArtifactRecord: { opportunityId: string; agreementAt: string; version: unknown } | null;
  isSameVersion: (a: unknown, b: unknown) => boolean;
  version: unknown;
  expectedPipelineId: string;
  expectedLocationId: string;
  targetStageId: string;
  forbiddenStageIds: readonly string[];
}): { eligible: true } | { eligible: false; reasons: StageTransitionReason[] } {
  const reasons: StageTransitionReason[] = [];

  if (args.opportunity.pipelineId !== args.expectedPipelineId) {
    reasons.push({ code: "WRONG_PIPELINE", message: "The opportunity is not in the expected Seller Leads Pipeline -- refusing to transition a stage id that means something else in a different pipeline." });
  }
  if (args.opportunity.locationId !== args.expectedLocationId) {
    reasons.push({ code: "WRONG_LOCATION", message: "The opportunity does not belong to the expected (Test) location." });
  }
  if (args.forbiddenStageIds.includes(args.targetStageId)) {
    reasons.push({ code: "TARGET_STAGE_FORBIDDEN", message: "The configured target stage is a forbidden stage (Seller Closed-Won) -- refusing unconditionally." });
  }
  if (!/^[0-9a-fA-F-]{8,}$/.test(args.targetStageId) || args.targetStageId.startsWith("PRODUCTION_")) {
    reasons.push({ code: "TARGET_STAGE_NOT_PROVISIONED", message: "The target stage id is not a provisioned GHL stage id for this environment." });
  }

  if (args.underContractRecord === null) {
    reasons.push({ code: "UNDER_CONTRACT_RECORD_MISSING", message: "No independently-verified Under Contract record exists for this opportunity/version yet." });
  } else {
    if (args.underContractRecord.opportunityId !== args.opportunityId) {
      reasons.push({ code: "UNDER_CONTRACT_OPPORTUNITY_MISMATCH", message: "The Under Contract record belongs to a different opportunity." });
    }
    if (args.underContractRecord.agreementAt !== args.agreementAt) {
      reasons.push({ code: "UNDER_CONTRACT_AGREEMENT_MISMATCH", message: "The Under Contract record's agreement does not match the current agreement." });
    }
    if (!args.isSameVersion(args.underContractRecord.version, args.version)) {
      reasons.push({ code: "UNDER_CONTRACT_VERSION_MISMATCH", message: "The Under Contract record's contract version does not match the current version." });
    }
  }

  if (args.preservedArtifactRecord === null) {
    reasons.push({ code: "PRESERVED_ARTIFACT_MISSING", message: "No independently re-verified preserved executed-artifact record exists for this opportunity/version yet." });
  } else {
    if (args.preservedArtifactRecord.opportunityId !== args.opportunityId) {
      reasons.push({ code: "PRESERVED_ARTIFACT_OPPORTUNITY_MISMATCH", message: "The preserved artifact record belongs to a different opportunity." });
    }
    if (!args.isSameVersion(args.preservedArtifactRecord.version, args.version)) {
      reasons.push({ code: "PRESERVED_ARTIFACT_VERSION_MISMATCH", message: "The preserved artifact record's contract version does not match the current version." });
    }
  }

  if (reasons.length > 0) return { eligible: false, reasons };
  return { eligible: true };
}

/** True when the opportunity's live current stage is already the target -- the caller's idempotent no-op path, never a re-PUT. */
export function isAlreadyInTargetStage(opportunity: OpportunityStageSnapshot, targetStageId: string): boolean {
  return opportunity.pipelineStageId === targetStageId;
}

/**
 * SECURITY / INV-98 -- what the browser may SAY about one Under Contract
 * stage-transition request. The server owns the write, its exact
 * pipeline/stage readback and its already-in-stage idempotence; this only
 * classifies the response it got back.
 *
 *  - confirmed: HTTP 200, `confirmed === true`, AND the server's own readback
 *    shows THIS opportunity in the expected pipeline and target stage. All
 *    three, or it is not confirmed.
 *  - refused:   rejected before any GHL call (bad request, sign-in, origin,
 *    method) -- nothing was sent to GHL, so a retry is safe.
 *  - uncertain: everything else -- 202 indeterminate, a missing or false
 *    `confirmed`, a missing or mismatched readback, 409, 5xx, a network
 *    failure. The stage may or may not have changed. Never success, never
 *    a retry until a fresh, independent GHL read settles it.
 */
export type StageTransitionResult =
  | { kind: "confirmed"; alreadyInStage: boolean }
  | { kind: "refused"; message: string }
  | { kind: "uncertain"; message: string };

export const STAGE_TRANSITION_UNCERTAIN_MESSAGE =
  "The Under Contract stage change was NOT confirmed -- it may or may not have happened in GHL. Do not retry. Get a fresh, independent read of this opportunity from GHL before any further action.";

/** Statuses ghl-write returns before it dispatches anything to GHL. */
const REFUSED_BEFORE_DISPATCH = new Set([400, 401, 403, 405]);

export function classifyStageTransitionResponse(args: {
  status: number;
  body: unknown;
  opportunityId: string;
  expectedPipelineId: string;
  targetStageId: string;
}): StageTransitionResult {
  const body = (args.body ?? null) as { confirmed?: unknown; alreadyInStage?: unknown; error?: unknown; readback?: { id?: unknown; pipelineId?: unknown; pipelineStageId?: unknown } } | null;
  const readback = body?.readback;
  if (
    args.status === 200 && body?.confirmed === true && readback &&
    readback.id === args.opportunityId &&
    readback.pipelineId === args.expectedPipelineId &&
    readback.pipelineStageId === args.targetStageId
  ) {
    return { kind: "confirmed", alreadyInStage: body.alreadyInStage === true };
  }
  if (REFUSED_BEFORE_DISPATCH.has(args.status)) {
    return { kind: "refused", message: typeof body?.error === "string" ? body.error : `Stage transition refused before any GHL call (HTTP ${args.status}).` };
  }
  return { kind: "uncertain", message: STAGE_TRANSITION_UNCERTAIN_MESSAGE };
}

/**
 * What a FRESH, independent GHL read OBSERVES about an opportunity after an
 * uncertain transition. It is an observation of GHL's current state, never a
 * verdict on the original request:
 *  - observed_in_target_stage: the read shows the expected pipeline AND the
 *    Under Contract stage. It does not prove the original request succeeded.
 *  - observed_not_in_target:   the read shows it elsewhere. That does NOT prove
 *    the original request failed or has finished -- it may still be in
 *    flight -- so the result stays uncertain and no retry may be offered.
 *  - read_failed:              no usable read; nothing is known.
 */
export type FreshStageReadResolution = "observed_in_target_stage" | "observed_not_in_target" | "read_failed";

export const STAGE_OBSERVED_IN_TARGET_MESSAGE =
  "A fresh GHL read shows this opportunity is now in the Under Contract stage. That is what GHL shows now; it does not confirm the earlier request itself succeeded.";
export const STAGE_OBSERVED_NOT_IN_TARGET_MESSAGE =
  "A fresh GHL read shows this opportunity is still NOT in the Under Contract stage. That does not prove the earlier request failed or has finished -- it may still be in progress. Do not retry until the outcome is authoritatively resolved.";
export const STAGE_READ_FAILED_MESSAGE =
  "The fresh GHL read did not succeed, so the stage is still unknown. Do not retry until the outcome is authoritatively resolved.";

export function resolveUncertainStageTransition(args: {
  fresh: unknown;
  opportunityId: string;
  expectedPipelineId: string;
  targetStageId: string;
}): FreshStageReadResolution {
  const raw = args.fresh as { opportunity?: unknown } | null | undefined;
  const opp = (raw && typeof raw === "object" && "opportunity" in raw ? raw.opportunity : raw) as { id?: unknown; pipelineId?: unknown; pipelineStageId?: unknown } | null | undefined;
  if (!opp || typeof opp !== "object" || opp.id !== args.opportunityId ||
      typeof opp.pipelineId !== "string" || typeof opp.pipelineStageId !== "string") {
    return "read_failed";
  }
  return opp.pipelineId === args.expectedPipelineId && opp.pipelineStageId === args.targetStageId
    ? "observed_in_target_stage"
    : "observed_not_in_target";
}
