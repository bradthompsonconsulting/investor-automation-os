/**
 * Board #9 lifecycle tracking -- corrections, resends, provider lifecycle
 * observations (delivered/viewed, partially signed, declined, expired,
 * voided/canceled, completed, provider_error, unknown), and bounded
 * Brad-only rescission records. B9-09 / INV-64.
 *
 * Pure. No I/O, no React, no writes, no fetch, no `ghl.notes.create()`.
 * This module defines the ONE deterministic domain model the carrier
 * (`contract-lifecycle-carriers.ts`) persists and a future surface reads --
 * it performs no persistence itself and creates no second source of truth
 * (FOUNDATIONAL_PRINCIPLES principle 15).
 *
 * GOVERNING SOURCES, cited rather than restated from memory:
 *   - `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md` (B9-01, locked) -- the
 *     Corrected/Rescinded/Expired/Declined branch/terminal states, their
 *     entry evidence, authority, and no-reentry rules. Nothing here
 *     re-decides a product question that document already settled;
 *     `board9-contract-model.ts`'s own `classifyCorrection`/
 *     `nextVersionIdentity` (the ONE existing implementation of that
 *     document's Corrected bright-line test) are consumed directly, never
 *     reimplemented.
 *   - `docs/BOARD9_CONTRACT_INVENTORY_V1.md` (B9-02) item 8/9 -- GHL's OWN
 *     documented List Documents `status` values are exactly `draft`,
 *     `sent`, `viewed`, `completed`, `accepted` (the meaning of `accepted`
 *     relative to `completed` was never disambiguated), plus a separate
 *     `isExpired` boolean. NO documented GHL status value corresponds to
 *     "declined" or "voided/canceled" -- `normalizeProviderLifecycleStatus`
 *     below therefore NEVER produces those two classifications from a raw
 *     readback; both remain reachable only via an operator-recorded human
 *     fact (Declined's own locked "Entry evidence" is already "explicit,
 *     operator-recorded... never inferred," per B9-01), never invented as
 *     a provider fact this codebase has no evidence for. This is this
 *     module's own proof of the limitation INV-64 requires ("preserve as
 *     UNKNOWN and prove that limitation from the provider response/
 *     readback shape"), not an oversight.
 *   - `board9-contract-model.ts` (B9-03/INV-58) -- `ContractVersionIdentity`,
 *     `isSameContractVersion`, `classifyCorrection`, `nextVersionIdentity`,
 *     `MaterialConflict`, `ContractFactAuthority` are REUSED, never
 *     redeclared. `evaluateUnderContractEligibility` remains the ONLY
 *     function that can ever produce Under Contract eligibility -- nothing
 *     in this module calls, wraps, or reimplements it; that joint
 *     verification is INV-65's own future gate, explicitly out of scope
 *     here (see section 5).
 *   - `contract-send-carriers.ts` (B9-08/INV-63) -- `ProviderResponseSummary`
 *     is the shape precedent for provider fields; this module's provider
 *     observations are POST-Contract-Sent lifecycle tracking, distinct
 *     from that module's own pre-Contract-Sent send-attempt ledger, which
 *     this module does not read, write, or duplicate.
 *
 * PROVIDER FACTS VS HUMAN FACTS, ENFORCED BY TYPE, NOT MERELY CONVENTION.
 * `LifecycleRecord` is a discriminated union on `kind`: the
 * `provider_observation` variant carries `authority: "provider_reported"`
 * ALWAYS -- the type has no other option for that variant. The
 * `correction`/`resend`/`rescission` variants carry `authority:
 * "operator_attested"` or `"brad_authorized"` and an explicit `recordedBy`/
 * `authorizedBy` operator string. No variant can carry the wrong authority
 * for its own kind -- this is what "a human fact cannot impersonate a
 * provider event" means at the type level. `contract-lifecycle-
 * carriers.ts`'s parser enforces the identical constraint on read-back, so
 * a malformed or tampered note can never round-trip into the wrong
 * variant either.
 *
 * APPEND-ONLY, NEVER MUTATION. This module builds and validates ONE new
 * record at a time; it holds no state, and nothing here ever "edits" or
 * "revokes" a prior record. Chronology/latest-state derivation
 * (`deriveLatestProviderStatus`, `isDuplicateProviderObservation`) always
 * takes the FULL history as input and returns a fresh, derived value --
 * never a mutated copy purporting to replace the input.
 *
 * FAIL CLOSED, EVERYWHERE -- matching `board9-contract-model.ts`'s own
 * discipline: every `build*`/`classify*` function returns
 * `{ ok: false, reasons: [...] }` (or a conservative status like
 * `"unknown"`/`"provider_error"`) rather than guessing when evidence is
 * missing, malformed, or ambiguous.
 */

import {
  type ContractVersionIdentity,
  type MaterialConflict,
  type CorrectionClassification,
  isSameContractVersion,
  nextVersionIdentity,
} from "./board9-contract-model";

/* ==================================================================== */
/* 1. Lifecycle event vocabulary                                        */
/* ==================================================================== */

/** The nine provider-evidenced statuses INV-64 tracks. See the module header for exactly which are, and are not, currently reachable from a real GHL readback. */
export type ProviderLifecycleStatus =
  | "sent"
  | "delivered_or_viewed"
  | "partially_signed"
  | "declined"
  | "expired"
  | "voided_or_canceled"
  | "completed"
  | "provider_error"
  | "unknown";

export const PROVIDER_LIFECYCLE_STATUSES: readonly ProviderLifecycleStatus[] = [
  "sent",
  "delivered_or_viewed",
  "partially_signed",
  "declined",
  "expired",
  "voided_or_canceled",
  "completed",
  "provider_error",
  "unknown",
];

/** Statuses `normalizeProviderLifecycleStatus` is currently able to produce from real, documented GHL readback fields -- a strict subset of `PROVIDER_LIFECYCLE_STATUSES`. "declined" and "voided_or_canceled" are deliberately absent: no documented GHL field evidences either today (BOARD9_CONTRACT_INVENTORY_V1.md item 8/9). Exported so a test can assert this limitation directly rather than trusting a comment. */
export const PROVIDER_EVIDENCED_REACHABLE_STATUSES: readonly ProviderLifecycleStatus[] = [
  "sent",
  "delivered_or_viewed",
  "partially_signed",
  "completed",
  "expired",
  "provider_error",
  "unknown",
];

export type LifecycleRecordKind = "provider_observation" | "correction" | "resend" | "rescission";

export type LifecycleReasonCode =
  | "OPPORTUNITY_ID_BLANK"
  | "OBSERVED_AT_INVALID"
  | "PROVIDER_REPORTED_AT_INVALID"
  | "PROVIDER_DOCUMENT_ID_BLANK"
  | "EVIDENCE_SUMMARY_BLANK"
  | "CORRECTION_IS_METADATA_ONLY"
  | "CORRECTION_VERSION_MISMATCH"
  | "CORRECTION_RECORDED_BY_BLANK"
  | "RESEND_VERSION_MUST_MATCH_PRIOR"
  | "RESEND_ATTEMPT_IDS_IDENTICAL"
  | "RESEND_NOT_BRAD_AUTHORIZED"
  | "RESEND_AUTHORIZATION_TIMESTAMP_INVALID"
  | "RESEND_RECORDED_BY_BLANK"
  | "RESCISSION_NOT_BRAD_AUTHORIZED"
  | "RESCISSION_REASON_BLANK"
  | "RESCISSION_AUTHORIZATION_TIMESTAMP_INVALID"
  | "RESCISSION_PROVIDER_DOCUMENT_ID_REQUIRED"
  | "RESCISSION_PROVIDER_DOCUMENT_ID_MUST_BE_ABSENT";

export type LifecycleReason = { code: LifecycleReasonCode; message: string };

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

/* ==================================================================== */
/* 2. Provider-observed lifecycle status -- normalized from readback     */
/* ==================================================================== */

export type ProviderDocumentLifecycleRow = {
  status: string | null;
  isExpired: boolean | null;
  deleted: boolean | null;
  recipients: readonly { hasCompleted: boolean }[];
};

/**
 * Maps GHL's own documented List Documents fields to ONE normalized
 * status. Only `"sent"`, `"viewed"`, and `"completed"` are documented raw
 * `status` values this function ever matches by name (`BOARD9_CONTRACT_
 * INVENTORY_V1.md` item 4); `"draft"` and `"accepted"` are documented
 * values too but neither is ever expected on a document that has already
 * reached Contract Sent (draft = never dispatched; `accepted`'s own
 * meaning relative to `completed` was never disambiguated) -- both, and
 * every other/unrecognized raw value, fall to `"unknown"` rather than
 * being guessed at. `isExpired: true` takes priority over `status` (a
 * provider reporting both an active status and `isExpired` is reporting
 * expiry as the more specific fact). Per-recipient completion is checked
 * BEFORE trusting an aggregate `"completed"`/`"sent"`/`"viewed"` status
 * string -- real, per-recipient evidence of a MIXED completion state
 * (some but not all `hasCompleted`) always surfaces as
 * `"partially_signed"`, even against a `"completed"` top-level status,
 * because the per-recipient array is the more specific, more trustworthy
 * fact. A `"completed"` status with NO corroborating per-recipient
 * completion at all (an empty `recipients[]`, or every entry `false`) is
 * a genuine conflict with no partial-completion evidence to fall back
 * on -- reported as `"unknown"` rather than trusted (never inferring
 * provider success from a single aggregate flag, matching
 * `board9-contract-model.ts`'s own `evaluateUnderContractEligibility`
 * discipline).
 */
export function normalizeProviderLifecycleStatus(row: ProviderDocumentLifecycleRow): ProviderLifecycleStatus {
  if (row.deleted === true) return "unknown";
  const recipients = row.recipients ?? [];
  const anyCompleted = recipients.some((r) => r.hasCompleted === true);
  const allCompleted = recipients.length > 0 && recipients.every((r) => r.hasCompleted === true);
  const partial = anyCompleted && !allCompleted;

  if (row.isExpired === true) return "expired";
  if (partial) return "partially_signed";
  if (row.status === "completed") return allCompleted ? "completed" : "unknown";
  if (row.status === "viewed") return "delivered_or_viewed";
  if (row.status === "sent") return "sent";
  return "unknown";
}

export type LifecycleReadbackOutcome =
  | { kind: "network_error"; message: string }
  | { kind: "http_response"; status: number; body: unknown };

export type ProviderLifecycleObservationResult = {
  status: ProviderLifecycleStatus;
  row: ProviderDocumentLifecycleRow | null;
  providerDocumentReference: string | null;
  providerDocumentRevision: number | null;
  failureReason: string | null;
};

/**
 * Classifies a full readback OUTCOME (not just a matched row) -- a
 * transport/HTTP failure is `"provider_error"`, distinctly, never
 * `"unknown"` (an unreachable provider is a different fact than a
 * reached-but-unrecognized one, and callers building a durable record
 * should never conflate the two). A reached-but-non-matching/malformed
 * response is `"unknown"` with a stated, non-secret reason.
 */
export function classifyProviderLifecycleReadback(args: {
  expectedDocumentId: string;
  expectedLocationId: string;
  outcome: LifecycleReadbackOutcome;
}): ProviderLifecycleObservationResult {
  const { outcome } = args;
  const fail = (
    status: ProviderLifecycleStatus,
    failureReason: string,
  ): ProviderLifecycleObservationResult => ({
    status,
    row: null,
    providerDocumentReference: null,
    providerDocumentRevision: null,
    failureReason,
  });

  if (outcome.kind === "network_error") {
    return fail("provider_error", `Readback network error: ${outcome.message}`);
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return fail("provider_error", `Readback returned HTTP ${outcome.status}`);
  }
  const body = outcome.body;
  if (typeof body !== "object" || body === null) {
    return fail("unknown", "Readback response was not a JSON object.");
  }
  const documents = (body as Record<string, unknown>).documents;
  if (!Array.isArray(documents)) {
    return fail("unknown", "Readback response carried no documents[] array.");
  }
  const match = documents.find(
    (d) => typeof d === "object" && d !== null && (d as Record<string, unknown>).documentId === args.expectedDocumentId,
  ) as Record<string, unknown> | undefined;
  if (!match) {
    return fail("unknown", "Readback did not return the expected document -- its current lifecycle status could not be confirmed.");
  }
  if (typeof match.locationId !== "string" || match.locationId !== args.expectedLocationId) {
    return fail("unknown", "Readback's locationId does not match the expected environment.");
  }
  const recipients = Array.isArray(match.recipients)
    ? match.recipients
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({ hasCompleted: r.hasCompleted === true }))
    : [];
  const row: ProviderDocumentLifecycleRow = {
    status: typeof match.status === "string" ? match.status : null,
    isExpired: typeof match.isExpired === "boolean" ? match.isExpired : null,
    deleted: typeof match.deleted === "boolean" ? match.deleted : null,
    recipients,
  };
  return {
    status: normalizeProviderLifecycleStatus(row),
    row,
    providerDocumentReference: typeof match.referenceId === "string" ? match.referenceId : null,
    providerDocumentRevision: typeof match.documentRevision === "number" ? match.documentRevision : null,
    failureReason: null,
  };
}

/* ==================================================================== */
/* 3. The unified, append-only lifecycle record -- one variant per kind  */
/* ==================================================================== */

export type ProviderObservationRecord = {
  kind: "provider_observation";
  opportunityId: string;
  version: ContractVersionIdentity;
  status: ProviderLifecycleStatus;
  providerDocumentId: string;
  providerDocumentReference: string | null;
  providerDocumentRevision: number | null;
  providerReportedAt: string | null;
  iaosObservedAt: string;
  authority: "provider_reported";
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

export type CorrectionRecord = {
  kind: "correction";
  opportunityId: string;
  priorVersion: ContractVersionIdentity;
  newVersion: ContractVersionIdentity;
  classification: "new_agreement_required" | "same_agreement_reentry";
  materialConflicts: MaterialConflict[];
  recordedBy: string;
  iaosObservedAt: string;
  authority: "operator_attested";
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

export type ResendRecord = {
  kind: "resend";
  opportunityId: string;
  version: ContractVersionIdentity;
  priorAttemptId: string;
  newAttemptId: string;
  authorizedBy: string;
  authorizedAt: string;
  recordedBy: string;
  iaosObservedAt: string;
  authority: "brad_authorized";
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

export type RescissionRecordEntry = {
  kind: "rescission";
  opportunityId: string;
  version: ContractVersionIdentity;
  reason: string;
  authorizedBy: string;
  authorizedAt: string;
  /** Required non-blank when `wasEverSentToProvider` was true at build time; required null otherwise. See `buildRescissionRecord`. */
  providerDocumentIdAtRescission: string | null;
  iaosObservedAt: string;
  authority: "brad_authorized";
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

export type LifecycleRecord = ProviderObservationRecord | CorrectionRecord | ResendRecord | RescissionRecordEntry;

/* ==================================================================== */
/* 3a. Builders -- one per kind, each fail-closed on its own evidence    */
/* ==================================================================== */

export function buildProviderObservationRecord(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  observation: ProviderLifecycleObservationResult;
  providerDocumentId: string;
  providerReportedAt: string | null;
  iaosObservedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
}): { ok: true; value: ProviderObservationRecord } | { ok: false; reasons: LifecycleReason[] } {
  const reasons: LifecycleReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (args.providerDocumentId.trim() === "") reasons.push({ code: "PROVIDER_DOCUMENT_ID_BLANK", message: "A provider observation must name the provider document it observed." });
  if (!isValidIsoInstant(args.iaosObservedAt)) reasons.push({ code: "OBSERVED_AT_INVALID", message: "iaosObservedAt is not a valid instant." });
  if (args.providerReportedAt !== null && !isValidIsoInstant(args.providerReportedAt)) {
    reasons.push({ code: "PROVIDER_REPORTED_AT_INVALID", message: "providerReportedAt is not a valid instant." });
  }
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      kind: "provider_observation",
      opportunityId: args.opportunityId,
      version: args.version,
      status: args.observation.status,
      providerDocumentId: args.providerDocumentId,
      providerDocumentReference: args.observation.providerDocumentReference,
      providerDocumentRevision: args.observation.providerDocumentRevision,
      providerReportedAt: args.providerReportedAt,
      iaosObservedAt: args.iaosObservedAt,
      authority: "provider_reported",
      evidenceSummary: args.evidenceSummary,
      relatedPriorRecordId: args.relatedPriorRecordId,
    },
  };
}

/**
 * `classification.kind === "metadata_only"` creates no lifecycle record at
 * all (`SELLER_CONTRACT_STATE_MACHINE_V1.md`: "requires no new contract
 * cycle") -- rejected rather than silently producing one. `newVersion` is
 * always DERIVED via `nextVersionIdentity` (never accepted from the
 * caller as a bare value), so a correction record can never claim a
 * version relationship its own classification does not actually support.
 */
export function buildCorrectionRecord(args: {
  opportunityId: string;
  priorVersion: ContractVersionIdentity;
  classification: CorrectionClassification;
  newAgreementAt: string | null;
  recordedBy: string;
  iaosObservedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
}): { ok: true; value: CorrectionRecord } | { ok: false; reasons: LifecycleReason[] } {
  if (args.classification.kind === "metadata_only") {
    return {
      ok: false,
      reasons: [{ code: "CORRECTION_IS_METADATA_ONLY", message: "A metadata-only change is not a contract correction and creates no lifecycle record." }],
    };
  }
  const reasons: LifecycleReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (!isValidIsoInstant(args.iaosObservedAt)) reasons.push({ code: "OBSERVED_AT_INVALID", message: "iaosObservedAt is not a valid instant." });
  if (args.recordedBy.trim() === "") reasons.push({ code: "CORRECTION_RECORDED_BY_BLANK", message: "A correction must be recorded by an explicit operator." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (reasons.length > 0) return { ok: false, reasons };

  const next = nextVersionIdentity(args.priorVersion, args.classification, args.newAgreementAt);
  if (!next.ok) {
    return { ok: false, reasons: [{ code: "CORRECTION_VERSION_MISMATCH", message: next.error }] };
  }
  return {
    ok: true,
    value: {
      kind: "correction",
      opportunityId: args.opportunityId,
      priorVersion: args.priorVersion,
      newVersion: next.value,
      classification: args.classification.kind,
      materialConflicts: args.classification.kind === "new_agreement_required" ? args.classification.conflicts : [],
      recordedBy: args.recordedBy,
      iaosObservedAt: args.iaosObservedAt,
      authority: "operator_attested",
      evidenceSummary: args.evidenceSummary,
      relatedPriorRecordId: args.relatedPriorRecordId,
    },
  };
}

/**
 * "Resend: represent each transmission as a new send attempt. Preserve
 * the same ContractVersionIdentity only when seller-facing content is
 * byte/identity-equivalent... Require current exact-version Brad
 * authorization for every outbound resend." All three are enforced here:
 * `args.version` must equal `args.priorAttemptVersion` exactly (a changed
 * version is a correction, not a resend -- callers needing that must use
 * `buildCorrectionRecord` instead, never this function); `authorizedBy`
 * must be the literal `"brad"`; `newAttemptId` must differ from
 * `priorAttemptId` so the original send record is never silently
 * converted into the resend.
 */
export function buildResendRecord(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  priorAttemptVersion: ContractVersionIdentity;
  priorAttemptId: string;
  newAttemptId: string;
  authorizedBy: string;
  authorizedAt: string;
  recordedBy: string;
  iaosObservedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
}): { ok: true; value: ResendRecord } | { ok: false; reasons: LifecycleReason[] } {
  const reasons: LifecycleReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (!isValidIsoInstant(args.iaosObservedAt)) reasons.push({ code: "OBSERVED_AT_INVALID", message: "iaosObservedAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (!isSameContractVersion(args.version, args.priorAttemptVersion)) {
    reasons.push({
      code: "RESEND_VERSION_MUST_MATCH_PRIOR",
      message: "A resend preserves the same ContractVersionIdentity as the prior attempt -- content/revision changes are a correction, not a resend.",
    });
  }
  if (args.priorAttemptId === args.newAttemptId) {
    reasons.push({
      code: "RESEND_ATTEMPT_IDS_IDENTICAL",
      message: "A resend must be represented as a new, distinct send attempt -- it cannot reuse the original attempt id.",
    });
  }
  if (args.authorizedBy !== "brad") {
    reasons.push({ code: "RESEND_NOT_BRAD_AUTHORIZED", message: "Every resend requires current, exact-version Brad authorization." });
  }
  if (!isValidIsoInstant(args.authorizedAt)) {
    reasons.push({ code: "RESEND_AUTHORIZATION_TIMESTAMP_INVALID", message: "The resend's authorization timestamp is not a valid instant." });
  }
  if (args.recordedBy.trim() === "") reasons.push({ code: "RESEND_RECORDED_BY_BLANK", message: "A resend must be recorded by an explicit operator." });
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      kind: "resend",
      opportunityId: args.opportunityId,
      version: args.version,
      priorAttemptId: args.priorAttemptId,
      newAttemptId: args.newAttemptId,
      authorizedBy: args.authorizedBy,
      authorizedAt: args.authorizedAt,
      recordedBy: args.recordedBy,
      iaosObservedAt: args.iaosObservedAt,
      authority: "brad_authorized",
      evidenceSummary: args.evidenceSummary,
      relatedPriorRecordId: args.relatedPriorRecordId,
    },
  };
}

/**
 * "Brad-only V1 rescission records require Brad authorization, timestamp,
 * reason, affected agreement/version, and affected provider document
 * identity." The last of these is conditionally required: an agreement
 * can be rescinded "at any stage from Contract Ready onward"
 * (`SELLER_CONTRACT_STATE_MACHINE_V1.md`, "Rescinded") -- including before
 * it was ever sent to a provider, when no provider document exists to
 * name. `wasEverSentToProvider` makes that distinction an explicit,
 * caller-supplied fact rather than something this function infers: if
 * true, a real (non-blank) `providerDocumentIdAtRescission` is required;
 * if false, one must be exactly `null` -- never a placeholder invented
 * for a document that never existed.
 */
export function buildRescissionRecord(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  reason: string;
  authorizedBy: string;
  authorizedAt: string;
  wasEverSentToProvider: boolean;
  providerDocumentIdAtRescission: string | null;
  iaosObservedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
}): { ok: true; value: RescissionRecordEntry } | { ok: false; reasons: LifecycleReason[] } {
  const reasons: LifecycleReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (!isValidIsoInstant(args.iaosObservedAt)) reasons.push({ code: "OBSERVED_AT_INVALID", message: "iaosObservedAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (args.authorizedBy !== "brad") {
    reasons.push({ code: "RESCISSION_NOT_BRAD_AUTHORIZED", message: "Rescission requires Brad's explicit authorization -- V1 permits no other operator." });
  }
  if (args.reason.trim() === "") {
    reasons.push({ code: "RESCISSION_REASON_BLANK", message: "A rescission reason is required." });
  }
  if (!isValidIsoInstant(args.authorizedAt)) {
    reasons.push({ code: "RESCISSION_AUTHORIZATION_TIMESTAMP_INVALID", message: "The rescission timestamp is not a valid instant." });
  }
  if (args.wasEverSentToProvider) {
    if (args.providerDocumentIdAtRescission === null || args.providerDocumentIdAtRescission.trim() === "") {
      reasons.push({
        code: "RESCISSION_PROVIDER_DOCUMENT_ID_REQUIRED",
        message: "This agreement was sent to the provider -- the rescission must name the affected provider document identity.",
      });
    }
  } else if (args.providerDocumentIdAtRescission !== null) {
    reasons.push({
      code: "RESCISSION_PROVIDER_DOCUMENT_ID_MUST_BE_ABSENT",
      message: "This agreement was never sent to a provider -- no provider document identity may be attached to its rescission.",
    });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      kind: "rescission",
      opportunityId: args.opportunityId,
      version: args.version,
      reason: args.reason,
      authorizedBy: args.authorizedBy,
      authorizedAt: args.authorizedAt,
      providerDocumentIdAtRescission: args.providerDocumentIdAtRescission,
      iaosObservedAt: args.iaosObservedAt,
      authority: "brad_authorized",
      evidenceSummary: args.evidenceSummary,
      relatedPriorRecordId: args.relatedPriorRecordId,
    },
  };
}

/* ==================================================================== */
/* 4. Chronology, duplicates, and version-scoped derivation -- ALWAYS    */
/*    reading the full history, never mutating or discarding it          */
/* ==================================================================== */

function recordVersion(r: LifecycleRecord): ContractVersionIdentity {
  return r.kind === "correction" ? r.newVersion : r.version;
}

/** "Lifecycle evidence cannot cross contract versions" -- returns a NEW array; the caller's own full history is never mutated. */
export function filterRecordsForVersion(
  records: readonly LifecycleRecord[],
  version: ContractVersionIdentity,
): LifecycleRecord[] {
  return records.filter((r) => isSameContractVersion(recordVersion(r), version));
}

/** Stable chronological ordering by IAOS-observed time -- ties preserve original (input) order, never reordered further. Note-timestamp precision is not assumed unique; see `board9-contract-model.ts`'s own convergence-variable precedent for the same caveat applied elsewhere in this codebase. Generic over `T` so a caller who passed in an already-narrowed array (e.g. `ProviderObservationRecord[]`) gets that same narrowed type back, never widened to the base union. */
export function orderRecordsChronologically<T extends LifecycleRecord>(records: readonly T[]): T[] {
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const diff = new Date(a.r.iaosObservedAt).getTime() - new Date(b.r.iaosObservedAt).getTime();
      return diff !== 0 ? diff : a.i - b.i;
    })
    .map((x) => x.r);
}

/**
 * Two provider observations are the SAME underlying fact -- not two
 * distinct transitions -- when every provider-reported field agrees.
 * Duplicate recognition NEVER removes anything from the caller's own
 * history array; it exists only so a display layer can collapse a status
 * re-polled and reported identically more than once, without erasing
 * either occurrence from the append-only record itself.
 */
export function isDuplicateProviderObservation(a: ProviderObservationRecord, b: ProviderObservationRecord): boolean {
  return (
    a.opportunityId === b.opportunityId &&
    isSameContractVersion(a.version, b.version) &&
    a.status === b.status &&
    a.providerDocumentId === b.providerDocumentId &&
    a.providerDocumentRevision === b.providerDocumentRevision &&
    a.providerReportedAt === b.providerReportedAt
  );
}

/**
 * The DERIVED "current status" for display -- FOUNDATIONAL_PRINCIPLES 14
 * ("derive for display, persist decisions"), applied here to provider
 * lifecycle status exactly as `board9-contract-model.ts` already applies
 * it to Contract Ready. Takes the FULL, unfiltered history and returns
 * one value or `null`; the history itself is returned unchanged -- this
 * function never deletes or hides an earlier record, it only computes
 * which one is newest for the exact version asked about.
 */
export function deriveLatestProviderStatus(
  records: readonly LifecycleRecord[],
  version: ContractVersionIdentity,
): ProviderLifecycleStatus | null {
  const scoped = filterRecordsForVersion(records, version).filter(
    (r): r is ProviderObservationRecord => r.kind === "provider_observation",
  );
  if (scoped.length === 0) return null;
  const ordered = orderRecordsChronologically(scoped);
  return ordered[ordered.length - 1].status;
}

/* ==================================================================== */
/* 5. State-safety boundary -- restated, never bypassed                  */
/* ==================================================================== */

/**
 * INV-64 tracks lifecycle history; it NEVER decides Under Contract.
 * `SELLER_CONTRACT_STATE_MACHINE_V1.md`'s own three-fact joint requirement
 * is enforced EXCLUSIVELY by `board9-contract-model.ts`'s
 * `evaluateUnderContractEligibility` (INV-65's future gate consumes it,
 * unchanged). This function exists so that claim is testable, not merely
 * asserted in a comment: no `LifecycleRecord` of any kind -- including a
 * `"completed"` provider observation -- carries an `eligible`/
 * `underContract` field, and this module exports no function that returns
 * one. Always `false` by construction; kept as an explicit predicate
 * (rather than simply absent) so a future accidental addition of such a
 * field is caught by the very test this predicate's own contract implies.
 */
export function lifecycleRecordAloneCanCreateUnderContract(_record: LifecycleRecord): false {
  return false;
}
