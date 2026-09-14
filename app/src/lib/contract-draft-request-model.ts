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
 */

export type ContractDraftRequestState = "Idle" | "Requested";

/** The exact two GHL option labels, in the order the field's picker offers them. */
export const CONTRACT_DRAFT_REQUEST_OPTIONS: readonly ContractDraftRequestState[] = ["Idle", "Requested"] as const;

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
