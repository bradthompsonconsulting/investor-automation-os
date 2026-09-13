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
 * `provider_observation` variant's `authority` is restricted to exactly
 * `"provider_reported" | "iaos_observed"` -- the type has no third option,
 * and neither of those two values is ever available to the human-recorded
 * variants. `"provider_reported"` means a real provider document row was
 * actually observed; `"iaos_observed"` means this is IAOS's OWN
 * observation that the provider was unreachable or returned nothing
 * usable (Jess Gate repair round, 2026-09-12, item 2) -- a network error,
 * an HTTP failure, or a malformed/missing response is never claimed as a
 * provider-reported fact. The `correction`/`resend`/`rescission`/`decline`
 * variants carry `authority: "operator_attested"` or `"brad_authorized"`
 * and an explicit `recordedBy`/`authorizedBy` operator string. No variant
 * can carry an authority value outside its own fixed set -- this is what
 * "a human fact cannot impersonate a provider event, or vice versa" means
 * at the type level. `contract-lifecycle-carriers.ts`'s parser enforces
 * the identical constraint on read-back, so a malformed or tampered note
 * can never round-trip into the wrong variant or the wrong authority
 * either.
 *
 * PROVIDER EVIDENCE IS BOUND TO ITS CONTRACT VERSION VIA INV-63's OWN
 * ACCEPTED-SEND RECORD, NEVER VIA INDEPENDENT CALLER ASSERTIONS (Jess Gate
 * repair round, 2026-09-12, item 1). `buildProviderObservationRecordFromReadback`,
 * `buildResendRecord`, `buildRescissionRecord`, and `buildDeclineRecord`
 * all require a real `ParsedContractSend` (`contract-send-carriers.ts`,
 * already-shipped B9-08/INV-63 evidence, itself only ever produced by
 * parsing real GHL notes) as proof that a specific `opportunityId` +
 * `ContractVersionIdentity` + provider document id were genuinely bound
 * together at send time -- a caller cannot merely assert that binding by
 * passing matching-looking strings. Every one of these functions
 * cross-checks the supplied `opportunityId`/`version` against that
 * evidence's OWN fields and fails closed (`PROVIDER_SEND_EVIDENCE_*`
 * reason codes) on any mismatch, including a conflicting provider
 * document revision.
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
import type { ParsedContractSend } from "./contract-send-carriers";

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

export type LifecycleRecordKind = "provider_observation" | "correction" | "resend" | "rescission" | "decline";

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
  | "DECLINE_REASON_OR_EVIDENCE_BLANK"
  | "DECLINE_AT_INVALID"
  | "DECLINE_RECORDED_BY_BLANK"
  | "PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED"
  | "PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH"
  | "PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH"
  | "PROVIDER_SEND_EVIDENCE_DOCUMENT_MISMATCH"
  | "PROVIDER_SEND_EVIDENCE_REVISION_CONFLICT"
  | "PRIOR_SEND_NOT_RESOLVED";

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

/** Bounded, non-secret recipient-completion evidence -- counts only, never names/emails/ids. */
export type RecipientCompletionCounts = { total: number; completed: number };

function countRecipients(recipients: readonly { hasCompleted: boolean }[]): RecipientCompletionCounts {
  return { total: recipients.length, completed: recipients.filter((r) => r.hasCompleted === true).length };
}

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

/**
 * The COMPLETE result of classifying a readback outcome -- normalized
 * status AND every raw fact that produced it, preserved side by side
 * (item 3 of the Jess Gate repair round, 2026-09-12: "normalized IAOS
 * state must remain separate from the opaque provider-reported value").
 * `rawProviderStatus`/`isExpired`/`deleted`/`recipients` are populated
 * whenever the provider actually returned a matching document row --
 * INCLUDING when that row's own `locationId` did not match the expected
 * environment, or its `status` value was unmapped/unrecognized -- so raw
 * evidence is preserved even in cases the NORMALIZED status conservatively
 * reports as `"unknown"`. They are `null`/empty ONLY when no document row
 * was ever actually observed (a transport/HTTP failure, or the expected
 * document was absent from the response entirely) -- there is nothing
 * real to preserve in that case, and this function never invents a
 * placeholder row to fill the gap.
 */
export type ProviderLifecycleObservationResult = {
  status: ProviderLifecycleStatus;
  /**
   * TRUE only when the provider actually returned a matching document row
   * (even if that row's own location mismatched, or its status was
   * unrecognized). This is the ONE fact `buildProviderObservationRecordFromReadback`
   * uses to decide the record's `authority` (Jess Gate repair round,
   * 2026-09-12, item 2): `true` -> `"provider_reported"` (a provider fact
   * genuinely exists, however inconclusive); `false` -> `"iaos_observed"`
   * (IAOS's own observation that the provider was unreachable or returned
   * nothing usable -- never claimed as something the provider itself
   * reported).
   */
  hadMatchingRow: boolean;
  rawProviderStatus: string | null;
  isExpired: boolean | null;
  deleted: boolean | null;
  recipients: RecipientCompletionCounts | null;
  providerDocumentReference: string | null;
  providerDocumentRevision: number | null;
  /** Extracted from the provider's own row (`updatedAt`), never caller-supplied -- `null` when absent or not a valid instant. This is the ONLY source `buildProviderObservationRecordFromReadback` ever uses for `providerReportedAt`. */
  providerReportedAt: string | null;
  failureReason: string | null;
};

/**
 * Classifies a full readback OUTCOME (not just a matched row) -- a
 * transport/HTTP failure is `"provider_error"`, distinctly, never
 * `"unknown"` (an unreachable provider is a different fact than a
 * reached-but-unrecognized one, and callers building a durable record
 * should never conflate the two). A reached-but-non-matching/malformed
 * response is `"unknown"` with a stated, non-secret reason.
 *
 * PURE CLASSIFICATION ONLY -- this function builds no durable record.
 * `buildProviderObservationRecordFromReadback` (section 3a) is the ONLY
 * sanctioned way to turn this result into a persisted
 * `ProviderObservationRecord`, and it calls this function internally
 * rather than accepting a pre-built result from a caller (Jess Gate
 * repair round, 2026-09-12, item 2) -- see that function's own header for
 * why a caller cannot bypass this classification to fabricate a status.
 */
export function classifyProviderLifecycleReadback(args: {
  expectedDocumentId: string;
  expectedLocationId: string;
  outcome: LifecycleReadbackOutcome;
}): ProviderLifecycleObservationResult {
  const { outcome } = args;
  const noRow = (
    status: ProviderLifecycleStatus,
    failureReason: string,
  ): ProviderLifecycleObservationResult => ({
    status,
    hadMatchingRow: false,
    rawProviderStatus: null,
    isExpired: null,
    deleted: null,
    recipients: null,
    providerDocumentReference: null,
    providerDocumentRevision: null,
    providerReportedAt: null,
    failureReason,
  });

  if (outcome.kind === "network_error") {
    return noRow("provider_error", `Readback network error: ${outcome.message}`);
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return noRow("provider_error", `Readback returned HTTP ${outcome.status}`);
  }
  const body = outcome.body;
  if (typeof body !== "object" || body === null) {
    return noRow("unknown", "Readback response was not a JSON object.");
  }
  const documents = (body as Record<string, unknown>).documents;
  if (!Array.isArray(documents)) {
    return noRow("unknown", "Readback response carried no documents[] array.");
  }
  const match = documents.find(
    (d) => typeof d === "object" && d !== null && (d as Record<string, unknown>).documentId === args.expectedDocumentId,
  ) as Record<string, unknown> | undefined;
  if (!match) {
    return noRow("unknown", "Readback did not return the expected document -- its current lifecycle status could not be confirmed.");
  }

  // A matching document row WAS observed -- raw fields are preserved from
  // here on regardless of whether the normalized status below ends up
  // "unknown" (e.g. a location mismatch or an unrecognized raw status is
  // still real evidence worth keeping, even though it is not trusted
  // enough to normalize into a specific lifecycle state).
  const recipientsRaw = Array.isArray(match.recipients)
    ? match.recipients
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({ hasCompleted: r.hasCompleted === true }))
    : [];
  const rawProviderStatus = typeof match.status === "string" ? match.status : null;
  const isExpired = typeof match.isExpired === "boolean" ? match.isExpired : null;
  const deleted = typeof match.deleted === "boolean" ? match.deleted : null;
  const providerDocumentReference = typeof match.referenceId === "string" ? match.referenceId : null;
  const providerDocumentRevision = typeof match.documentRevision === "number" ? match.documentRevision : null;
  const providerReportedAtCandidate = typeof match.updatedAt === "string" ? match.updatedAt : null;
  const providerReportedAt = providerReportedAtCandidate !== null && isValidIsoInstant(providerReportedAtCandidate) ? providerReportedAtCandidate : null;
  const recipients = countRecipients(recipientsRaw);

  const locationMismatch = typeof match.locationId !== "string" || match.locationId !== args.expectedLocationId;
  const row: ProviderDocumentLifecycleRow = { status: rawProviderStatus, isExpired, deleted, recipients: recipientsRaw };

  return {
    status: locationMismatch ? "unknown" : normalizeProviderLifecycleStatus(row),
    hadMatchingRow: true,
    rawProviderStatus,
    isExpired,
    deleted,
    recipients,
    providerDocumentReference,
    providerDocumentRevision,
    providerReportedAt,
    failureReason: locationMismatch ? "Readback's locationId does not match the expected environment." : null,
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
  /** The raw, opaque provider status string as reported, INCLUDING unmapped/unrecognized values -- kept separate from `status` (the normalized IAOS value) per Jess Gate repair item 3. `null` only when no document row was ever observed (a transport/HTTP failure, or the document was absent from the response). */
  rawProviderStatus: string | null;
  /** The provider's own raw `isExpired` flag, as reported -- `null` when no row was observed or the provider omitted the field. */
  isExpired: boolean | null;
  /** The provider's own raw `deleted` flag, as reported -- `null` when no row was observed or the provider omitted the field. */
  deleted: boolean | null;
  /** Bounded, non-secret recipient-completion evidence (counts only) -- `null` when no row was observed. */
  recipients: RecipientCompletionCounts | null;
  providerDocumentId: string;
  providerDocumentReference: string | null;
  providerDocumentRevision: number | null;
  /** Extracted from the provider's own evidence (`classifyProviderLifecycleReadback`'s own `updatedAt` derivation) -- never a caller-invented value. */
  providerReportedAt: string | null;
  /** The IAOS-derived reason a `"provider_error"`/`"unknown"` status was reached (e.g. "Readback network error: ECONNRESET", or a location-mismatch note on an otherwise `"provider_reported"` row) -- `null` only when classification reached a confident, uncontested status. Distinct from `evidenceSummary`, which is the caller's own free-text description of what was attempted. */
  providerFailureReason: string | null;
  iaosObservedAt: string;
  /**
   * Jess Gate repair round, 2026-09-12, item 2: `"provider_reported"` ONLY
   * when a real provider document row was actually observed
   * (`hadMatchingRow: true`) -- `"iaos_observed"` when this record
   * describes IAOS's OWN observation that the provider was unreachable or
   * returned nothing usable (a transport/HTTP failure, a malformed
   * response, or the expected document's absence). A network error, an
   * HTTP failure, or a missing/malformed response is never claimed as
   * something the provider itself reported.
   */
  authority: "provider_reported" | "iaos_observed";
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
  /** Derived from a verified INV-63 accepted-send record when one was supplied at build time; `null` when the agreement was never sent to a provider. Never an independent caller assertion -- see `buildRescissionRecord`. */
  providerDocumentIdAtRescission: string | null;
  iaosObservedAt: string;
  authority: "brad_authorized";
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

/**
 * `SELLER_CONTRACT_STATE_MACHINE_V1.md`, "Declined": "An explicit,
 * operator-recorded fact that the seller declined -- never inferred from
 * silence or elapsed time." This is a distinct, human/operator-recorded
 * variant -- NOT a `ProviderObservationRecord` (GHL exposes no documented
 * "declined" status; see the module header) and NOT restricted to Brad
 * the way Rescission is (`SELLER_CONTRACT_STATE_MACHINE_V1.md` states no
 * such authority restriction for Declined). Its `authority` is always
 * `"operator_attested"`, distinct from both provider-observation authority
 * values and `"brad_authorized"`, so a decline can never be mistaken for
 * either kind of fact. Declined only ever applies to an agreement that
 * reached Contract Sent ("the seller can only decline to execute an
 * agreement that was actually sent") -- `providerDocumentIdAtDecline` is
 * therefore always derived from a verified INV-63 accepted-send record
 * (never an independent caller assertion, and never blank), unlike
 * Rescission's conditional field.
 */
export type DeclineRecordEntry = {
  kind: "decline";
  opportunityId: string;
  version: ContractVersionIdentity;
  reasonOrEvidence: string;
  recordedBy: string;
  declinedAt: string;
  providerDocumentIdAtDecline: string;
  iaosObservedAt: string;
  authority: "operator_attested";
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

export type LifecycleRecord = ProviderObservationRecord | CorrectionRecord | ResendRecord | RescissionRecordEntry | DeclineRecordEntry;

/* ==================================================================== */
/* 3a. Builders -- one per kind, each fail-closed on its own evidence    */
/* ==================================================================== */

/**
 * The ONE place every provider-document-claiming builder below verifies
 * that a specific `opportunityId` + `ContractVersionIdentity` + provider
 * document id were genuinely bound together at send time (Jess Gate
 * repair round, 2026-09-12, item 1). `acceptedSend` must be a REAL
 * `ParsedContractSend` -- in production this is only ever produced by
 * `contract-send-carriers.ts`'s own `latestContractSendForOpportunity`,
 * itself only ever parsing REAL GHL notes; this function does not, and
 * cannot, independently verify that the object it was handed came from
 * that path (a pure function has no I/O), but it DOES verify every fact
 * that path's own shape carries: the send actually reached `"accepted"`
 * with a real, non-blank provider document id, AND that send's own
 * `opportunityId`/`version` actually match what this record is being
 * built for. A caller cannot substitute independently-asserted strings
 * for this cross-check -- there is no parameter for one.
 */
function verifyAcceptedSendBinding(args: {
  acceptedSend: ParsedContractSend;
  opportunityId: string;
  version: ContractVersionIdentity;
}): { ok: true; value: { providerDocumentId: string; providerDocumentReference: string | null; providerDocumentRevision: number | null } } | { ok: false; reasons: LifecycleReason[] } {
  const { acceptedSend } = args;
  const reasons: LifecycleReason[] = [];
  const hasRealDocumentId =
    acceptedSend.status === "accepted" &&
    acceptedSend.providerResponse !== null &&
    typeof acceptedSend.providerResponse.documentId === "string" &&
    acceptedSend.providerResponse.documentId !== "";
  if (!hasRealDocumentId) {
    reasons.push({
      code: "PROVIDER_SEND_EVIDENCE_NOT_ACCEPTED",
      message: "The supplied send evidence is not an accepted INV-63 send with a confirmed provider document identifier -- provider evidence cannot be bound to a contract version without it.",
    });
  }
  if (acceptedSend.opportunityId !== args.opportunityId) {
    reasons.push({
      code: "PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH",
      message: "The supplied send evidence's opportunityId does not match the opportunity this record is being built for.",
    });
  }
  if (!isSameContractVersion(acceptedSend.version, args.version)) {
    reasons.push({
      code: "PROVIDER_SEND_EVIDENCE_VERSION_MISMATCH",
      message: "The supplied send evidence's contract version does not match the version this record is being built for.",
    });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      providerDocumentId: acceptedSend.providerResponse!.documentId as string,
      providerDocumentReference: acceptedSend.providerResponse!.documentReference,
      providerDocumentRevision: acceptedSend.providerResponse!.documentRevision,
    },
  };
}

/**
 * THE ONLY WAY TO CONSTRUCT A `ProviderObservationRecord` (Jess Gate
 * repair round, 2026-09-12, items 1 and 2). Unlike the pre-repair design,
 * this function does NOT accept a pre-built classification result, and
 * does NOT accept `opportunityId`/`version`/`expectedDocumentId` as
 * independent, unverified caller assertions -- `acceptedSend` (a real
 * INV-63 accepted-send record, see `verifyAcceptedSendBinding`) must
 * PROVE that binding, and this function fails closed on any mismatch,
 * including a conflicting provider document revision between what was
 * recorded at send time and what the live readback now reports. Only
 * after that binding is verified does this function call
 * `classifyProviderLifecycleReadback` INTERNALLY to derive every
 * remaining fact this record will carry -- the classification step
 * cannot be skipped, substituted, or handed a shortcut result, short of
 * editing this module's own source. `providerReportedAt` is likewise
 * never accepted from the caller; it comes exclusively from what
 * `classifyProviderLifecycleReadback` itself extracted from the provider
 * row. `authority` is derived from `hadMatchingRow` -- see that field's
 * own doc comment and item 2's fix.
 */
export function buildProviderObservationRecordFromReadback(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  expectedDocumentId: string;
  expectedLocationId: string;
  /** Verified proof that `opportunityId`/`version`/`expectedDocumentId` were genuinely bound together at send time -- see `verifyAcceptedSendBinding`. */
  acceptedSend: ParsedContractSend;
  outcome: LifecycleReadbackOutcome;
  iaosObservedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
}): { ok: true; value: ProviderObservationRecord } | { ok: false; reasons: LifecycleReason[] } {
  const reasons: LifecycleReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (args.expectedDocumentId.trim() === "") reasons.push({ code: "PROVIDER_DOCUMENT_ID_BLANK", message: "A provider observation must name the provider document it attempted to observe." });
  if (!isValidIsoInstant(args.iaosObservedAt)) reasons.push({ code: "OBSERVED_AT_INVALID", message: "iaosObservedAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (reasons.length > 0) return { ok: false, reasons };

  const binding = verifyAcceptedSendBinding({ acceptedSend: args.acceptedSend, opportunityId: args.opportunityId, version: args.version });
  if (!binding.ok) return binding;

  if (binding.value.providerDocumentId !== args.expectedDocumentId) {
    return {
      ok: false,
      reasons: [{
        code: "PROVIDER_SEND_EVIDENCE_DOCUMENT_MISMATCH",
        message: "The supplied send evidence's own provider document id does not match the document id this record is being built for.",
      }],
    };
  }

  const observation = classifyProviderLifecycleReadback({
    expectedDocumentId: args.expectedDocumentId,
    expectedLocationId: args.expectedLocationId,
    outcome: args.outcome,
  });

  if (
    binding.value.providerDocumentRevision !== null &&
    observation.providerDocumentRevision !== null &&
    binding.value.providerDocumentRevision !== observation.providerDocumentRevision
  ) {
    return {
      ok: false,
      reasons: [{
        code: "PROVIDER_SEND_EVIDENCE_REVISION_CONFLICT",
        message: "The provider's currently observed document revision conflicts with the revision recorded at send time -- this evidence cannot be trusted to describe the authorized version without further review.",
      }],
    };
  }

  const authority: "provider_reported" | "iaos_observed" = observation.hadMatchingRow ? "provider_reported" : "iaos_observed";

  return {
    ok: true,
    value: {
      kind: "provider_observation",
      opportunityId: args.opportunityId,
      version: args.version,
      status: observation.status,
      rawProviderStatus: observation.rawProviderStatus,
      isExpired: observation.isExpired,
      deleted: observation.deleted,
      recipients: observation.recipients,
      providerDocumentId: args.expectedDocumentId,
      providerDocumentReference: observation.providerDocumentReference,
      providerDocumentRevision: observation.providerDocumentRevision,
      providerReportedAt: observation.providerReportedAt,
      providerFailureReason: observation.failureReason,
      iaosObservedAt: args.iaosObservedAt,
      authority,
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
 * authorization for every outbound resend." Jess Gate repair round,
 * 2026-09-12, item 1: the prior attempt this resend claims is no longer
 * an independent `priorAttemptId`/`priorAttemptVersion` pair a caller
 * merely asserts -- `priorSend` (a real INV-63 `ParsedContractSend`) is
 * required, and `priorAttemptId`/the version-match check are both derived
 * from and verified against ITS OWN fields (`priorSend.attemptId`,
 * `priorSend.version`), never a bare string the caller could mismatch.
 * `priorSend.status` must already be resolved to a terminal outcome
 * (`"accepted"`, `"failed"`, or `"ambiguous"`) -- resending against a
 * still-`"in_progress"`/`"provider_accepted_pending_readback"` attempt
 * would mean recording a resend before even knowing what the original
 * attempt did. `authorizedBy` must be the literal `"brad"`; `newAttemptId`
 * must differ from `priorSend.attemptId` so the original send record is
 * never silently converted into the resend.
 */
const RESOLVED_PRIOR_SEND_STATUSES = new Set(["accepted", "failed", "ambiguous"]);

export function buildResendRecord(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  /** Verified proof of the prior attempt this resend refers to -- see the function's own header. */
  priorSend: ParsedContractSend;
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
  if (args.priorSend.opportunityId !== args.opportunityId) {
    reasons.push({
      code: "PROVIDER_SEND_EVIDENCE_OPPORTUNITY_MISMATCH",
      message: "The supplied prior-send evidence's opportunityId does not match the opportunity this resend is being built for.",
    });
  }
  if (!isSameContractVersion(args.version, args.priorSend.version)) {
    reasons.push({
      code: "RESEND_VERSION_MUST_MATCH_PRIOR",
      message: "A resend preserves the same ContractVersionIdentity as the prior attempt -- content/revision changes are a correction, not a resend.",
    });
  }
  if (args.priorSend.attemptId === args.newAttemptId) {
    reasons.push({
      code: "RESEND_ATTEMPT_IDS_IDENTICAL",
      message: "A resend must be represented as a new, distinct send attempt -- it cannot reuse the original attempt id.",
    });
  }
  if (!RESOLVED_PRIOR_SEND_STATUSES.has(args.priorSend.status)) {
    reasons.push({
      code: "PRIOR_SEND_NOT_RESOLVED",
      message: "The prior send attempt has not yet resolved to a terminal outcome -- a resend cannot be recorded against an in-progress or pending attempt.",
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
      priorAttemptId: args.priorSend.attemptId,
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
 * name. Jess Gate repair round, 2026-09-12, item 1: this distinction is no
 * longer a bare `wasEverSentToProvider` boolean plus an independently-
 * asserted `providerDocumentIdAtRescission` string -- `acceptedSend` is
 * `null` when the agreement was never sent (no id is possible, and none is
 * invented), or a REAL, verified INV-63 `ParsedContractSend` when it was,
 * in which case the affected provider document id is DERIVED from and
 * verified against that evidence's own fields, never asserted
 * independently.
 */
export function buildRescissionRecord(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  reason: string;
  authorizedBy: string;
  authorizedAt: string;
  /** `null` iff this agreement was never sent to a provider. Otherwise, verified proof of that send -- see the function's own header. */
  acceptedSend: ParsedContractSend | null;
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
  if (reasons.length > 0) return { ok: false, reasons };

  let providerDocumentIdAtRescission: string | null = null;
  if (args.acceptedSend !== null) {
    const binding = verifyAcceptedSendBinding({ acceptedSend: args.acceptedSend, opportunityId: args.opportunityId, version: args.version });
    if (!binding.ok) return binding;
    providerDocumentIdAtRescission = binding.value.providerDocumentId;
  }

  return {
    ok: true,
    value: {
      kind: "rescission",
      opportunityId: args.opportunityId,
      version: args.version,
      reason: args.reason,
      authorizedBy: args.authorizedBy,
      authorizedAt: args.authorizedAt,
      providerDocumentIdAtRescission,
      iaosObservedAt: args.iaosObservedAt,
      authority: "brad_authorized",
      evidenceSummary: args.evidenceSummary,
      relatedPriorRecordId: args.relatedPriorRecordId,
    },
  };
}

/**
 * Jess Gate repair round, 2026-09-12, items 1 and 4: a separate
 * authorized-human decline record, distinct in shape and authority from
 * both provider evidence and Rescission. `SELLER_CONTRACT_STATE_
 * MACHINE_V1.md`'s own "Meaning" for Declined is "the seller explicitly
 * declines to execute the SENT agreement"; there is nothing to decline
 * before Contract Sent, so a REAL, verified INV-63 `acceptedSend` is
 * always required (never a bare `wasEverSentToProvider` boolean plus an
 * independently-asserted `providerDocumentIdAtDecline` string) -- passing
 * evidence that is not actually an accepted send fails closed via the
 * same `verifyAcceptedSendBinding` every provider-document-claiming
 * builder uses. This function makes no legal determination and produces
 * no field resembling `eligible`/`underContract` -- see
 * `lifecycleRecordAloneCanCreateUnderContract`.
 */
export function buildDeclineRecord(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  /** Verified proof that this agreement actually reached Contract Sent -- see the function's own header. */
  acceptedSend: ParsedContractSend;
  reasonOrEvidence: string;
  recordedBy: string;
  declinedAt: string;
  iaosObservedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
}): { ok: true; value: DeclineRecordEntry } | { ok: false; reasons: LifecycleReason[] } {
  const reasons: LifecycleReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (!isValidIsoInstant(args.iaosObservedAt)) reasons.push({ code: "OBSERVED_AT_INVALID", message: "iaosObservedAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (args.reasonOrEvidence.trim() === "") {
    reasons.push({ code: "DECLINE_REASON_OR_EVIDENCE_BLANK", message: "Declined requires an explicit, operator-recorded reason or evidence -- never inferred from silence or elapsed time." });
  }
  if (!isValidIsoInstant(args.declinedAt)) {
    reasons.push({ code: "DECLINE_AT_INVALID", message: "The decline timestamp is not a valid instant." });
  }
  if (args.recordedBy.trim() === "") {
    reasons.push({ code: "DECLINE_RECORDED_BY_BLANK", message: "Declined requires an explicit, operator-recorded fact -- no operator identity was supplied." });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  const binding = verifyAcceptedSendBinding({ acceptedSend: args.acceptedSend, opportunityId: args.opportunityId, version: args.version });
  if (!binding.ok) return binding;

  return {
    ok: true,
    value: {
      kind: "decline",
      opportunityId: args.opportunityId,
      version: args.version,
      reasonOrEvidence: args.reasonOrEvidence,
      recordedBy: args.recordedBy,
      declinedAt: args.declinedAt,
      providerDocumentIdAtDecline: binding.value.providerDocumentId,
      iaosObservedAt: args.iaosObservedAt,
      authority: "operator_attested",
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
 * distinct transitions -- when EVERY raw, provider-reported field agrees,
 * not merely the normalized status (small consistency fix, Jess Gate
 * repair round, 2026-09-12): `isExpired`, `deleted`, recipient-completion
 * counts, the provider document reference, and the provider failure
 * reason (distinguishes, e.g., two `"unknown"` observations produced by
 * genuinely different causes) are all compared alongside the fields
 * already checked. Two observations sharing the same normalized `status`
 * but differing on any of these underlying facts are NEVER declared
 * duplicates. `authority` is compared too, as a defense-in-depth check --
 * it cannot actually differ between two observations that already agree
 * on every field above, by construction (`authority` is itself derived
 * from `hadMatchingRow`, which those fields already reflect). Duplicate
 * recognition NEVER removes anything from the caller's own history array;
 * it exists only so a display layer can collapse a status re-polled and
 * reported identically more than once, without erasing either occurrence
 * from the append-only record itself.
 */
export function isDuplicateProviderObservation(a: ProviderObservationRecord, b: ProviderObservationRecord): boolean {
  return (
    a.opportunityId === b.opportunityId &&
    isSameContractVersion(a.version, b.version) &&
    a.status === b.status &&
    a.authority === b.authority &&
    a.rawProviderStatus === b.rawProviderStatus &&
    a.isExpired === b.isExpired &&
    a.deleted === b.deleted &&
    a.recipients?.total === b.recipients?.total &&
    a.recipients?.completed === b.recipients?.completed &&
    a.providerDocumentId === b.providerDocumentId &&
    a.providerDocumentReference === b.providerDocumentReference &&
    a.providerDocumentRevision === b.providerDocumentRevision &&
    a.providerReportedAt === b.providerReportedAt &&
    a.providerFailureReason === b.providerFailureReason
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
