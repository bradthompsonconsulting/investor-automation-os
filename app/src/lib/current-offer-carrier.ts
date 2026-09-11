/**
 * Current Offer — the pure gate/freeze logic. INV-70 / B9-07A Phase 2.
 *
 * Pure. No I/O, no React, no GHL identifiers. Mirrors `repair-estimation/
 * persist.ts`'s `persistGate` shape exactly: one readable function decides
 * whether a write may proceed, so "frozen after Agreement Reached" is a
 * property of this function, not a claim about a component's control flow.
 *
 * WHAT THIS REPLACES. `docs/BOARD9_GHL_IAOS_FIELD_CANONICALIZATION_V1.md`
 * Family 5's approved ruling eliminates the fourteen-field mirrored
 * `contact.offer_*` / `opportunity.offer_*` architecture in favor of ONE
 * Opportunity-owned carrier (`opportunityFacts.currentOffer`,
 * `ghl.opportunities.setCurrentOffer`). Before Agreement Reached, that
 * carrier represents the latest negotiated offer; at Agreement Reached, it
 * freezes at the accepted purchase price Board #9 consumes. The GHL Note
 * ledger (`seller-call-outcome.ts`'s `formatOutcomeNote`/
 * `attemptRecordOutcome`) remains the immutable acceptance evidence,
 * UNCHANGED by this module — this carrier is a queryable, pipeline-
 * reportable MIRROR of the same accepted price, closing the gap
 * `seller-call-outcome.ts`'s own header names for INV-54 ("a GHL note is
 * NOT a queryable, pipeline-reportable field").
 *
 * NO SILENT OVERWRITE OF A FROZEN VALUE. Once an `accept` outcome exists
 * for an Opportunity, `currentOfferWriteGate` refuses every subsequent
 * write attempt, regardless of what new value the operator types — the
 * same "authoritative once written, never re-superseded" rule PB-D55
 * already applies to approved ARV.
 *
 * LEGACY `offer_*` FIELDS ARE OUT OF SCOPE HERE. This module knows
 * nothing about them and produces no value for them — `ghl.contacts.
 * saveOfferFields` / `ghl.opportunities.saveOfferFields` (the dual-write
 * MaoCalculator.tsx used) are removed entirely, not redirected here.
 */

export type CurrentOfferWriteDecision =
  | { kind: "blocked"; reason: string }
  | { kind: "allowed"; value: number };

/**
 * Whether a new Current Offer value may be written to the Opportunity
 * carrier during live negotiation, and exactly what.
 *
 * FROZEN THE MOMENT AN ACCEPT OUTCOME ALREADY EXISTS FOR THIS
 * OPPORTUNITY. `agreementAlreadyReached` is the caller's own
 * already-resolved fact — this function performs no note lookup and no
 * opportunity-id matching itself; it only classifies what it is told,
 * exactly as `computeNegotiationPosition` classifies `board8` without
 * recomputing it.
 */
export function currentOfferWriteGate(args: {
  value: number | null;
  agreementAlreadyReached: boolean;
}): CurrentOfferWriteDecision {
  if (args.agreementAlreadyReached) {
    return {
      kind: "blocked",
      reason: "Agreement Reached is already recorded for this opportunity — Current Offer is frozen at the accepted price.",
    };
  }
  if (args.value === null) {
    return { kind: "blocked", reason: "no Current Offer entered" };
  }
  if (!Number.isFinite(args.value) || args.value <= 0) {
    return { kind: "blocked", reason: "Current Offer must be a positive finite number" };
  }
  return { kind: "allowed", value: args.value };
}

/**
 * The value that must be written to freeze the carrier AT the moment
 * Agreement Reached is recorded — always the accepted price from the
 * outcome snapshot the caller already validated via `attemptRecordOutcome`,
 * never re-derived here.
 *
 * DELIBERATELY NOT GATED BY `agreementAlreadyReached`. This function
 * answers a different question than `currentOfferWriteGate`: it is called
 * exactly once, at the instant acceptance is being recorded — the freeze
 * write itself — not a later attempt to change an already-frozen value.
 * The caller is responsible for calling this only from the accept path,
 * exactly once per acceptance, mirroring `attemptRecordOutcome`'s own
 * "performs no write itself" contract.
 */
export function acceptedPriceFreezeValue(acceptedPrice: number | null): CurrentOfferWriteDecision {
  if (acceptedPrice === null) {
    return { kind: "blocked", reason: "no accepted price to freeze — Current Offer was never entered" };
  }
  if (!Number.isFinite(acceptedPrice) || acceptedPrice <= 0) {
    return { kind: "blocked", reason: "accepted price must be a positive finite number" };
  }
  return { kind: "allowed", value: acceptedPrice };
}
