/**
 * Live offer/counter/negotiation experience -- B8-08 / INV-51.
 *
 * Pure. No I/O, no React, no GHL, no persistence. This module answers
 * exactly one question `board8-economics.ts` and `offer-readiness.ts` do
 * not: given an operator-entered Current Offer and the ALREADY-COMPUTED
 * Max Supported Offer (B8-03), is the current negotiating position within
 * or above Max, and by how much. It invents no formula: Max Supported
 * Offer is read verbatim from the `Board8Economics` the caller passes in
 * -- this module contains no `endBuyerMaxPrice - standardMinimum`
 * arithmetic, no `max(25%, $5,000)`, nothing PB-D56 already locks.
 *
 * IAOS DOES NOT CHOOSE THE NEGOTIATION STRATEGY. Current Offer and Seller
 * Position are OPERATOR-ENTERED values with no default and no derivation
 * -- `null` until a human types a number. This module never assigns
 * either a value; it only classifies whatever the caller already holds.
 * `DEAL_ECONOMICS_OFFER_READINESS_V1.md`'s own words for Opening/Current
 * Offer -- "a human decision, entered by the human... IAOS does not
 * calculate in V1" -- and `SELLER_ACQUISITION_WORKFLOW.md`'s "Opening
 * offer. The human's decision, entered by the human" are both restated
 * here, not re-decided.
 *
 * A DIFFERENT OVERRIDE THAN B8-04's. `offer-readiness.ts`'s `HumanAction`
 * answers "is the EVIDENCE good enough to negotiate from at all" -- a
 * question about knowledge. `NegotiationOverride` below answers "does the
 * operator want to continue negotiating at a PRICE above Max Supported
 * Offer" -- a question about an economics decision, made independently of
 * evidence quality. A deal can be Offer Ready (evidence sufficient) while
 * the operator is still negotiating a price above Max, and the reverse is
 * equally possible. The two are never merged into one flag: this module
 * does not read or write `ReadinessResult.humanAction`, and
 * `offer-readiness.ts` does not read anything from this module.
 *
 * NO HARD BLOCK, NO SILENT PROGRESSION. Per INV-51's HARD NO, nothing here
 * disables or rejects a Current Offer value above Max -- the operator can
 * always type any number. What this module gates is only whether that
 * above-Max position is ACKNOWLEDGED: `isOverrideCurrent` is false the
 * moment Current Offer or Max changes to a value the recorded override
 * did not cover, so the UI can always tell "proceeding above Max, visibly
 * acknowledged" apart from "proceeding above Max, not yet acknowledged" --
 * never collapsing the two, and never silently carrying an old
 * acknowledgement forward onto a new number or a new Max.
 *
 * NO REWRITING PREVIOUS POSITIONS. This module never mutates a
 * `NegotiationOverride` in place -- `attemptOverride` always returns a NEW
 * record from the CURRENT position, and a stale one is detected
 * (`isOverrideCurrent` returns false) rather than silently patched to
 * match new numbers. What happened at a given moment is not altered after
 * the fact; the caller decides how much history, if any, to keep in
 * session state, and this module makes no persistence decision at all --
 * that is explicitly B8-11's (INV-54).
 *
 * NO FABRICATED OPERATOR IDENTITY. Jess Gate, 2026-09-06: an earlier
 * version of the caller hardcoded `operator: "Brad Thompson"` on every
 * override -- a false identity, since no authenticated-operator concept
 * exists anywhere in this codebase (confirmed absent: no `currentUser`,
 * `useAuth`, or session-actor mechanism of any kind). `operator` is
 * therefore typed `string | null` and this module makes no attempt to
 * supply, default, or validate it beyond carrying whatever the caller
 * passes through verbatim -- `null` when no authenticated identity is
 * available, exactly as it is today. Building an authentication system
 * to fill this field is explicitly out of this issue's scope; the
 * honest, unresolved gap is preserved rather than papered over.
 *
 * ACQUISITION-PRICE INPUT VALIDATION. Jess Gate, 2026-09-06: Seller
 * Position and Current Offer are acquisition-price inputs, and a
 * negative, zero, malformed, NaN, or infinite value must never reach
 * `computeNegotiationPosition`, `computeExpectedSpread`, or any dependent
 * display. `parseAcquisitionPriceInput` below is the ONE place that
 * decision is made, returning a three-way result (`empty` / `invalid` /
 * `value`) so a caller can show truthful, DISTINCT feedback for "nothing
 * typed yet" versus "that is not a usable price" rather than collapsing
 * both into the same silent `null`. Only the `value` variant's payload is
 * ever a strictly positive, finite number -- fit to hand directly to
 * `computeNegotiationPosition`'s `currentOffer` or any other consumer
 * expecting an acquisition price.
 */

import type { Board8Economics } from "./underwriting/board8-economics";

/* ------------------------------------------------------------------ */
/* Negotiation position -- Current Offer vs. the EXISTING Max            */
/* ------------------------------------------------------------------ */

export type NegotiationPosition =
  | { status: "unavailable"; reason: string }
  | {
      status: "within_max";
      currentOffer: number;
      maxSupportedOffer: number;
      amountBelowMax: number;
    }
  | {
      status: "above_max";
      currentOffer: number;
      maxSupportedOffer: number;
      amountAboveMax: number;
    };

/**
 * Classifies the operator's Current Offer against B8-03's OWN
 * `maxSupportedOffer` -- never a second calculation of Max. `unavailable`
 * covers both "no Current Offer entered yet" and "Max has not been
 * calculated yet" as two DISTINCT, named reasons, mirroring
 * `computeExpectedSpread`'s own pattern of never returning a favorable
 * default for a missing input.
 */
export function computeNegotiationPosition(args: {
  currentOffer: number | null;
  board8: Board8Economics;
}): NegotiationPosition {
  if (args.currentOffer === null) {
    return { status: "unavailable", reason: "no Current Offer entered for this negotiation" };
  }
  if (!Number.isFinite(args.currentOffer)) {
    throw new RangeError(`currentOffer: ${args.currentOffer} is not a finite number`);
  }
  // Jess Gate, 2026-09-06: a non-positive Current Offer must never reach
  // classification either -- callers are expected to have already
  // filtered through `parseAcquisitionPriceInput`, so reaching here with
  // zero or a negative amount is a caller contract violation, not a
  // negotiation state this function can honestly classify as
  // "within_max" or "above_max."
  if (args.currentOffer <= 0) {
    throw new RangeError(`currentOffer: ${args.currentOffer} is not a positive amount`);
  }
  if (args.board8.status !== "calculated") {
    return { status: "unavailable", reason: "Max Supported Offer has not been calculated yet" };
  }

  const maxSupportedOffer = args.board8.maxSupportedOffer;
  if (args.currentOffer > maxSupportedOffer) {
    return {
      status: "above_max",
      currentOffer: args.currentOffer,
      maxSupportedOffer,
      amountAboveMax: args.currentOffer - maxSupportedOffer,
    };
  }
  return {
    status: "within_max",
    currentOffer: args.currentOffer,
    maxSupportedOffer,
    amountBelowMax: maxSupportedOffer - args.currentOffer,
  };
}

/* ------------------------------------------------------------------ */
/* Bounded actions                                                      */
/* ------------------------------------------------------------------ */

/**
 * The exact four actions INV-51 names, and no others. `keep_negotiating`,
 * `review_assumptions`, and `cancel` never change Current Offer, Seller
 * Position, or any economics figure -- they are dismissal/navigation
 * only. `override_continue` is the ONLY action that produces a
 * `NegotiationOverride`, and only via `attemptOverride` below, which
 * requires a non-empty reason and an above-Max position.
 */
export type NegotiationAction = "keep_negotiating" | "review_assumptions" | "cancel" | "override_continue";

export const NEGOTIATION_ACTIONS: readonly NegotiationAction[] = [
  "keep_negotiating",
  "review_assumptions",
  "cancel",
  "override_continue",
];

/* ------------------------------------------------------------------ */
/* Override -- explicit acknowledgement + reason, session-only            */
/* ------------------------------------------------------------------ */

/**
 * The explicit action/provenance record INV-51 requires this experience
 * preserve for B8-11 (INV-54) to persist later. Nothing here writes it
 * anywhere -- it is an in-memory value the page holds and, per INV-51's
 * own scope boundary, B8-11 is the issue authorized to give it a carrier.
 * Every field is EITHER a caller-supplied fact (reason, operator, at) OR
 * copied verbatim from the `NegotiationPosition` that justified it
 * (currentOfferAtOverride, maxSupportedOfferAtOverride,
 * amountAboveMaxAtOverride) -- never recomputed, never inferred.
 */
export type NegotiationOverride = {
  acknowledgedAboveMax: true;
  reason: string;
  /** `null` when no authenticated operator identity is available -- never a fabricated name. See the module header. */
  operator: string | null;
  at: string;
  currentOfferAtOverride: number;
  maxSupportedOfferAtOverride: number;
  amountAboveMaxAtOverride: number;
};

export type AttemptOverrideResult =
  | { ok: true; override: NegotiationOverride }
  | { ok: false; error: string };

/**
 * The ONLY way to produce a `NegotiationOverride`. Fails closed (`ok:
 * false`) when the position is not actually above Max (there is nothing
 * to override) or when `reason` is empty/whitespace-only -- INV-51 is
 * explicit that above-Max progression requires "explicit acknowledgement
 * and reason," not an acknowledgement alone. `acknowledged` must be
 * `true`: the caller's UI is expected to gate this on an explicit
 * checkbox/confirmation, not call this the moment a reason is typed.
 */
export function attemptOverride(args: {
  position: NegotiationPosition;
  acknowledged: boolean;
  reason: string;
  /** `null` when no authenticated operator identity is available. This function neither requires nor fabricates one -- see the module header. */
  operator: string | null;
  at: string;
}): AttemptOverrideResult {
  if (args.position.status !== "above_max") {
    return { ok: false, error: "Current Offer is not above Max Supported Offer -- there is nothing to override." };
  }
  if (!args.acknowledged) {
    return { ok: false, error: "Explicit acknowledgement is required before proceeding above Max." };
  }
  if (args.reason.trim() === "") {
    return { ok: false, error: "A reason is required before proceeding above Max." };
  }
  return {
    ok: true,
    override: {
      acknowledgedAboveMax: true,
      reason: args.reason,
      operator: args.operator,
      at: args.at,
      currentOfferAtOverride: args.position.currentOffer,
      maxSupportedOfferAtOverride: args.position.maxSupportedOffer,
      amountAboveMaxAtOverride: args.position.amountAboveMax,
    },
  };
}

/**
 * `true` only when `override` was granted for EXACTLY this position's
 * current numbers. The moment Current Offer moves (a new counter, a
 * correction) or Max itself changes (an assumption was revised), the
 * override no longer covers the new position and this returns `false` --
 * never silently carrying an old acknowledgement onto a new number. This
 * is what makes "no silent above-Max progression" hold for every value
 * the negotiation ever reaches, not only the first one.
 */
export function isOverrideCurrent(
  override: NegotiationOverride | null,
  position: NegotiationPosition,
): boolean {
  if (override === null) return false;
  if (position.status !== "above_max") return false;
  return (
    override.currentOfferAtOverride === position.currentOffer &&
    override.maxSupportedOfferAtOverride === position.maxSupportedOffer
  );
}

/**
 * `true` when the operator must be shown the bounded-action decision
 * (the warning + Keep Negotiating / Review Assumptions / Cancel /
 * Override & Continue) before this position can be treated as
 * acknowledged. `false` for `within_max` and `unavailable` -- ordinary,
 * in-range negotiation requires no override of any kind, per INV-51's own
 * validation criterion.
 */
export function requiresOverrideDecision(
  position: NegotiationPosition,
  override: NegotiationOverride | null,
): boolean {
  return position.status === "above_max" && !isOverrideCurrent(override, position);
}

/* ------------------------------------------------------------------ */
/* Acquisition-price input validation                                   */
/* ------------------------------------------------------------------ */

/**
 * `empty`: nothing typed (or whitespace only) -- not an error, just
 * absent, matching every other "not yet established" fact on this page.
 *
 * `invalid`: something was typed but it is not a usable acquisition
 * price -- malformed text, NaN, non-finite (`Infinity`/`-Infinity`), zero,
 * or negative. `reason` names which, so a caller can show truthful
 * feedback rather than a generic error. The raw text is preserved
 * unmodified (`raw`) so a caller can echo back exactly what was typed.
 *
 * `value`: a strictly positive, finite number, safe to hand directly to
 * `computeNegotiationPosition`, `computeExpectedSpread`, or any other
 * consumer expecting an acquisition price. This is the ONLY variant that
 * carries a number.
 */
export type AcquisitionPriceInput =
  | { kind: "empty" }
  | { kind: "invalid"; raw: string; reason: string }
  | { kind: "value"; value: number };

/**
 * Accepts plain digits and the same `$`/`,` formatting every other money
 * display on this page already produces (e.g. `$125,000`) -- stripping
 * those two characters before parsing is what "preserve normal formatted
 * positive entry" means; it is not a second money-formatting engine, it
 * is the minimum needed to accept what `money()` itself would have
 * printed back at the operator.
 */
export function parseAcquisitionPriceInput(raw: string): AcquisitionPriceInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };

  const cleaned = trimmed.replace(/[$,]/g, "");
  const n = Number(cleaned);

  if (Number.isNaN(n)) {
    return { kind: "invalid", raw, reason: "That is not a number." };
  }
  if (!Number.isFinite(n)) {
    return { kind: "invalid", raw, reason: "That amount is not a finite number." };
  }
  if (n <= 0) {
    return { kind: "invalid", raw, reason: "Enter a positive amount, for example $125,000." };
  }
  return { kind: "value", value: n };
}
