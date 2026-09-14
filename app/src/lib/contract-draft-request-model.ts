/**
 * Contract Draft Request -- the one-shot draft-trigger control, INV-67 /
 * B9-12 contract-population repair, corrected ruling (this session).
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes. This module decides
 * ONLY whether a transition to "Requested" is allowed; it never performs the
 * write or the readback (`ghl.ts`'s `setContractDraftRequest` does that) and
 * it never resets the field back to "Idle" -- per the corrected ruling, that
 * reset is the FUTURE GHL workflow's job, after it creates the draft, and is
 * explicitly out of this repair's scope (no workflow is built here).
 *
 * THE CORRECTED RULING, restated exactly (Brad, this session): do not use a
 * persistent timestamp as the workflow trigger. Use an Opportunity dropdown
 * field, `Contract Draft Request`, with exactly two allowed values, "Idle"
 * and "Requested". Default/fail-safe state is "Idle". IAOS sets "Requested"
 * ONLY after all contract-field writes and exact readbacks succeed. The
 * future workflow triggers on "Opportunity Changed -> Contract Draft Request
 * Has Changed To Requested" and resets the field to "Idle" after creating the
 * draft. IAOS must not write pipeline stage or Opportunity status to trigger
 * drafting -- structurally true here: this module and its caller touch only
 * this one customField. Repeated clicks, partial failures, later Opportunity
 * edits, or stale values must not create duplicate drafts. IAOS must never
 * set or imply a send-directly instruction -- this module has no concept of
 * "send" at all; its only two states are Idle and Requested, and Requested
 * means "a draft is wanted," never "send this."
 *
 * DUPLICATE/STALE-REQUEST PROTECTION. GHL has no compare-and-swap primitive
 * (the same limitation this codebase's other single-writer races document,
 * e.g. `ghl.proposals.reserveSend`'s own header). The mitigation here is the
 * same shape: `evaluateContractDraftRequestTransition` takes `currentRaw` as
 * a FRESH read the caller performed immediately before deciding -- never a
 * cached or previously-fetched value -- and refuses outright whenever that
 * fresh read is already "Requested." A caller that reads stale, decides, and
 * then writes has reintroduced the race this function exists to close;
 * `ghl.ts`'s writer is the one place that must honor "fresh read right
 * before the decision."
 *
 * JESS GATE CORRECTION (this session) -- AUDIT ORDERING. The original
 * shipped flow wrote "Requested" and only afterward attempted one audit
 * note, best-effort. Because GHL may create the draft the instant
 * "Requested" lands, a failed post-write note could leave a live draft with
 * no durable evidence of who authorized it or which
 * `ContractVersionIdentity` initiated it. Corrected to the SAME two-phase
 * attempt/resolution evidence pattern `contract-send-model.ts` already
 * established for Contract Sent (`buildSendAttemptArgs` /
 * `buildSendResultArgs`, `contract-send-carriers.ts`'s one-shape-two-notes
 * ledger): `buildContractDraftRequestAttemptRecord` below builds the FIRST
 * ("in_progress") note's data -- written and confirmed durable BEFORE the
 * "Requested" PUT is ever attempted; `buildContractDraftRequestResolutionRecord`
 * builds the SECOND note, for the SAME `attemptId`, recording the actual
 * outcome. Both are pure builders -- writing either note, and deciding
 * whether the PUT is attempted at all, are the caller's (`ghl.ts`
 * consumer's) job, exactly mirroring the send flow's own model/carrier
 * split. `attemptId` is the attempt's own `at` timestamp, generated fresh by
 * the caller on every invocation (never a closure-captured or module-level
 * value), so a repeated UI action can never reuse an earlier attempt's id --
 * the same convention `contract-send-model.ts`'s own `BuildSendAttemptArgs`
 * doc comment states verbatim ("Also serves as the attempt's own
 * correlation id").
 */

import type { ContractVersionIdentity } from "./board9-contract-model";
import type { ContractProjectionFieldKey } from "./contract-ghl-projection-model";

export type ContractDraftRequestState = "Idle" | "Requested";

/** The exact two GHL option labels, in the order the field's picker offers them. */
export const CONTRACT_DRAFT_REQUEST_OPTIONS: readonly ContractDraftRequestState[] = ["Idle", "Requested"] as const;

/**
 * INV-67 / B9-12, Jess Gate TRANSPORT-OUTCOME correction. The discriminated
 * outcome `ghl.ts`'s `setContractDraftRequest` returns -- NEVER a thrown
 * error, for any failure mode. Declared here (the pure model layer) rather
 * than in `ghl.ts` itself so the caller's classification logic
 * (`ContractWorkspace.tsx`) and this module's own tests share ONE type,
 * never a second, independently-typed shape that could drift.
 *
 * Preserves the exact transport boundary the corrected ruling requires:
 *   `refused`             -- never reached the network. No draft could have been triggered.
 *   `put_failed`          -- a CONFIRMED non-success HTTP response. GHL was reached and rejected the request.
 *   `put_transport_error` -- the PUT's own transport failed before any response arrived. GHL may have received it.
 *   `readback_failed`     -- the PUT succeeded, but the readback's own transport or HTTP response failed.
 *   `readback_mismatch`   -- the PUT succeeded, the readback succeeded, but the observed value is not the one sent.
 *   `confirmed`           -- the PUT succeeded and the readback exactly confirms the sent value.
 * Only `refused` and `put_failed` are ever CONFIRMED non-events; the other
 * three failure-shaped variants (`put_transport_error`, `readback_failed`,
 * `readback_mismatch`) must always classify as "indeterminate," never
 * "failed" -- see `classifyContractDraftRequestOutcome` below.
 */
export type ContractDraftRequestWriteOutcome =
  | { kind: "refused"; reason: string }
  | { kind: "put_failed"; putStatus: number; responseBody: string }
  | { kind: "put_transport_error"; message: string }
  | { kind: "readback_failed"; putStatus: number; readbackFailureReason: string }
  | { kind: "readback_mismatch"; putStatus: number; sent: string; observed: number | string | null }
  | { kind: "confirmed"; putStatus: number; sent: string; observed: string };

/**
 * Fail-safe normalization: an absent field, or any value other than the
 * literal "Requested," reads as "Idle" -- the corrected ruling's own stated
 * default. `isRecognizedContractDraftRequestState` below is the separate,
 * non-gating diagnostic for "was this actually one of the two declared
 * options" -- callers that want to surface an unexpected-value warning use
 * that, without changing this function's fail-safe behavior.
 */
export function normalizeContractDraftRequestState(raw: string | null): ContractDraftRequestState {
  return raw === "Requested" ? "Requested" : "Idle";
}

export function isRecognizedContractDraftRequestState(raw: string | null): boolean {
  return raw === "Idle" || raw === "Requested";
}

export type ContractDraftRequestProjectionSummary = {
  /** How many projection fields the plan carried -- zero is refused, never treated as "nothing to check." */
  entryCount: number;
  /** True only when every carried entry's readback matched exactly what was sent. */
  allEntriesLanded: boolean;
};

export type ContractDraftRequestTransitionInput = {
  /** The Contract Draft Request field's CURRENT value, read fresh (never cached) immediately before this decision. */
  currentRaw: string | null;
  projection: ContractDraftRequestProjectionSummary;
  /** Whether the two current-offer-reused document lines (¶3A/¶3C) match the live `opportunity.current_offer` field -- see `contract-ghl-projection-model.ts`'s `reusedCurrentOfferLines`. */
  currentOfferCrossCheckOk: boolean;
};

export type ContractDraftRequestTransitionResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Decides whether setting "Requested" is permitted right now. Refuses,
 * rather than queues or overwrites, on every failure mode -- there is no
 * retry-with-different-semantics path; the caller re-invokes this same
 * function after fixing whatever it named.
 */
export function evaluateContractDraftRequestTransition(
  input: ContractDraftRequestTransitionInput,
): ContractDraftRequestTransitionResult {
  const current = normalizeContractDraftRequestState(input.currentRaw);

  if (current === "Requested") {
    return {
      allowed: false,
      reason:
        'Contract Draft Request is already "Requested" -- a draft is pending. Refusing to avoid a duplicate. ' +
        'The field resets to "Idle" only when the future GHL workflow finishes creating the draft.',
    };
  }

  if (input.projection.entryCount === 0) {
    return {
      allowed: false,
      reason: "No contract projection fields were supplied -- refusing to request a draft with nothing populated.",
    };
  }

  if (!input.projection.allEntriesLanded) {
    return {
      allowed: false,
      reason:
        "Not every contract projection field was confirmed on readback -- refusing to set Requested on a partial synchronization.",
    };
  }

  if (!input.currentOfferCrossCheckOk) {
    return {
      allowed: false,
      reason:
        "The accepted price (opportunity.current_offer) does not match the contract's own sales-price lines -- refusing to request a draft on a price mismatch.",
    };
  }

  return { allowed: true };
}

/* ==================================================================== */
/* Two-phase attempt/resolution evidence -- pure record builders          */
/* ==================================================================== */

export type ContractDraftRequestSyncStatus = "in_progress" | "accepted" | "failed" | "indeterminate";

/**
 * ONE shape, reused across both notes for the same `attemptId` -- exactly
 * `contract-send-carriers.ts`'s own `ParsedContractSend` convention. Fields
 * that only make sense once the write has actually been attempted
 * (`sentValue`, `observedValue`, `providerStatus`) are `null` on the
 * `in_progress` record and populated only by
 * `buildContractDraftRequestResolutionRecord`.
 */
export type ContractDraftRequestSyncRecord = {
  /** This note's own "Recorded at". Equals `attemptId` for the in_progress record; later for the resolution record. */
  at: string;
  operator: string;
  opportunityId: string;
  /** The attempt's own correlation id -- the in_progress record's own `at`. Fresh per invocation; never reused across separate UI actions. */
  attemptId: string;
  status: ContractDraftRequestSyncStatus;
  version: ContractVersionIdentity;
  entriesAttempted: number;
  entriesLanded: number;
  failedKeys: ContractProjectionFieldKey[];
  currentOfferCrossCheckOk: boolean;
  /** The freshly-read Contract Draft Request value immediately BEFORE this attempt's intended write -- captured once, on the attempt record, and carried forward unchanged onto the resolution record. */
  observedStateBeforeWrite: ContractDraftRequestState;
  /** Always "Requested" -- the only transition this control ever attempts. Named explicitly per the corrected ruling's own evidence requirement, not inferred from `status`. */
  intendedToState: "Requested";
  /** Resolution-only: what was actually sent to GHL. `null` on the in_progress record. */
  sentValue: string | null;
  /** Resolution-only: what the readback actually observed. `null` on the in_progress record, and also `null` on a "failed" resolution where the PUT itself never succeeded (no readback was possible). */
  observedValue: string | null;
  /** Resolution-only: the PUT's own HTTP status, when the PUT was actually issued. `null` on the in_progress record and on a resolution where the request never reached GHL. */
  providerStatus: number | null;
  failureReason: string | null;
};

export type BuildContractDraftRequestAttemptArgs = {
  opportunityId: string;
  operator: string;
  /** Also serves as the attempt's own `attemptId` and this note's own "Recorded at" -- generate fresh (`new Date().toISOString()`) on every invocation. */
  attemptAt: string;
  version: ContractVersionIdentity;
  entriesAttempted: number;
  entriesLanded: number;
  failedKeys: ContractProjectionFieldKey[];
  currentOfferCrossCheckOk: boolean;
  observedStateBeforeWrite: ContractDraftRequestState;
};

/** Builds the FIRST note's data -- "in_progress" -- durable evidence of intent, written and confirmed BEFORE the "Requested" PUT is ever attempted. */
export function buildContractDraftRequestAttemptRecord(
  args: BuildContractDraftRequestAttemptArgs,
): ContractDraftRequestSyncRecord {
  return {
    at: args.attemptAt,
    operator: args.operator,
    opportunityId: args.opportunityId,
    attemptId: args.attemptAt,
    status: "in_progress",
    version: args.version,
    entriesAttempted: args.entriesAttempted,
    entriesLanded: args.entriesLanded,
    failedKeys: args.failedKeys,
    currentOfferCrossCheckOk: args.currentOfferCrossCheckOk,
    observedStateBeforeWrite: args.observedStateBeforeWrite,
    intendedToState: "Requested",
    sentValue: null,
    observedValue: null,
    providerStatus: null,
    failureReason: null,
  };
}

export type BuildContractDraftRequestResolutionArgs = {
  attempt: ContractDraftRequestSyncRecord;
  resolvedAt: string;
  status: "accepted" | "failed" | "indeterminate";
  sentValue: string | null;
  observedValue: string | null;
  providerStatus: number | null;
  failureReason: string | null;
};

/**
 * Builds the SECOND note's data, for the SAME `attemptId` as the attempt
 * record -- never re-decides eligibility, never re-derives the projection
 * counts or cross-check result; those are carried forward from the attempt
 * verbatim, exactly like `contract-send-model.ts`'s `buildSendResultArgs`
 * carries `attempt.templateName`/`attempt.signers` forward unchanged.
 */
export function buildContractDraftRequestResolutionRecord(
  args: BuildContractDraftRequestResolutionArgs,
): ContractDraftRequestSyncRecord {
  return {
    at: args.resolvedAt,
    operator: args.attempt.operator,
    opportunityId: args.attempt.opportunityId,
    attemptId: args.attempt.attemptId,
    status: args.status,
    version: args.attempt.version,
    entriesAttempted: args.attempt.entriesAttempted,
    entriesLanded: args.attempt.entriesLanded,
    failedKeys: args.attempt.failedKeys,
    currentOfferCrossCheckOk: args.attempt.currentOfferCrossCheckOk,
    observedStateBeforeWrite: args.attempt.observedStateBeforeWrite,
    intendedToState: "Requested",
    sentValue: args.sentValue,
    observedValue: args.observedValue,
    providerStatus: args.providerStatus,
    failureReason: args.failureReason,
  };
}

/* ==================================================================== */
/* Transport-outcome classification -- Jess Gate correction (this session) */
/* ==================================================================== */

export type ContractDraftRequestOutcomeClassification = {
  status: "accepted" | "failed" | "indeterminate";
  sentValue: string | null;
  observedValue: string | null;
  providerStatus: number | null;
  failureReason: string | null;
};

/**
 * The ONE place `ContractDraftRequestWriteOutcome` is turned into a
 * resolution-note status. Pure, exhaustive over all six variants (a TS
 * `never` check below fails to compile if a seventh is ever added without
 * updating this function). Only `refused` and `put_failed` -- CONFIRMED
 * non-events -- ever classify `"failed"`. `put_transport_error`,
 * `readback_failed`, and `readback_mismatch` ALWAYS classify
 * `"indeterminate"`, never `"failed"` -- collapsing them into `"failed"`
 * would wrongly assert the write is confirmed NOT to have happened, when a
 * draft may in fact have been triggered.
 */
export function classifyContractDraftRequestOutcome(
  outcome: ContractDraftRequestWriteOutcome,
): ContractDraftRequestOutcomeClassification {
  switch (outcome.kind) {
    case "refused":
      return {
        status: "failed",
        sentValue: null,
        observedValue: null,
        providerStatus: null,
        failureReason: `Refused before any network call -- ${outcome.reason}`,
      };
    case "put_failed":
      return {
        status: "failed",
        sentValue: null,
        observedValue: null,
        providerStatus: outcome.putStatus,
        failureReason: `GHL rejected the request (HTTP ${outcome.putStatus}): ${outcome.responseBody}`,
      };
    case "put_transport_error":
      return {
        status: "indeterminate",
        sentValue: "Requested",
        observedValue: null,
        providerStatus: null,
        failureReason: `The write's own transport failed before a conclusive response arrived (${outcome.message}) -- GHL may have received it.`,
      };
    case "readback_failed":
      return {
        status: "indeterminate",
        sentValue: "Requested",
        observedValue: null,
        providerStatus: outcome.putStatus,
        failureReason: `PUT succeeded (HTTP ${outcome.putStatus}) but the readback could not confirm the result (${outcome.readbackFailureReason}).`,
      };
    case "readback_mismatch":
      return {
        status: "indeterminate",
        sentValue: outcome.sent,
        observedValue: outcome.observed === null ? null : String(outcome.observed),
        providerStatus: outcome.putStatus,
        failureReason: `PUT succeeded but readback did not confirm "${outcome.sent}" (observed ${JSON.stringify(outcome.observed)}).`,
      };
    case "confirmed":
      return {
        status: "accepted",
        sentValue: outcome.sent,
        observedValue: outcome.observed,
        providerStatus: outcome.putStatus,
        failureReason: null,
      };
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`classifyContractDraftRequestOutcome: unhandled outcome kind ${JSON.stringify(_exhaustive)}`);
    }
  }
}
