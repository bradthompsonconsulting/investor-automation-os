/**
 * Board #8 shared deal/offer engine -- B8-03 / INV-46.
 *
 * Pure functions. No I/O, no GHL identifiers, no React, no writes, no
 * persistence. This module adds NO second math engine: every quantity here
 * is arithmetic over `UnderwritingResult.figures`, which `computeUnderwriting`
 * (compute.ts) already produces from PB-D55/PB-D56's engine, Board #6's
 * authoritative repairs, and Board #7's authoritative ARV. Seller Call, the
 * standalone Deal Calculator, and Underwriting all consume this one module
 * so that identical inputs and assumptions produce identical Target
 * Acquisition Price, Max Supported Offer, and Expected Spread regardless of
 * caller -- `docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`'s "one deal engine,
 * three faces" contract.
 *
 * GOVERNING FORMULAS -- Brad's 2026-09-05 post-B8-02 amendment (INV-45
 * comment, INV-46 RELEASE AMENDMENT), which supersedes B8-02's inventory
 * conclusion that Max Supported Offer is always a presentation-only rename
 * of Seller MAO:
 *
 *   Target Wholesale Profit  = max(25% of Required Buyer Profit, $5,000)
 *   Target Acquisition Price = End-Buyer Maximum Purchase Price
 *                                - Target Wholesale Profit
 *   Max Supported Offer      = End-Buyer Maximum Purchase Price - $5,000
 *
 * The "25%" and "$5,000" are the EXISTING Buyer Profit Share Percentage and
 * Standard Minimum Assignment Spread Investor Policy values (PB-D56 section
 * IV) -- reused verbatim through `figures.buyerProfitSharePct` and
 * `figures.standardMinimumAssignmentSpread`. No new Target policy value is
 * created here or anywhere in this module.
 *
 * Both Target and Max use the STANDARD MINIMUM specifically, never the
 * deal's currently active `figures.assignmentSpread` -- which may differ
 * under Manual or 25%-of-Buyer-Profit mode. This is why Max Supported Offer
 * is not always equal to Seller MAO: the two coincide only when the active
 * assignment mode happens to resolve to exactly the Standard Minimum.
 *
 * CALCULATED, NEVER ACTIONABLE. Every result this module returns is a
 * calculation, per `docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`'s "calculated
 * vs actionable" distinction. Nothing here evaluates Offer Ready, persists
 * an approval or override, or claims a result is safe to present to a
 * seller -- that evaluation is INV-47's (B8-04), explicitly out of this
 * module's scope. `status: "calculated"` is the only affirmative status
 * this module ever returns; there is no "actionable" or "approved" status
 * for a downstream caller to be tempted into treating as one.
 */

import type { Level, UnderwritingResult } from "./types";
import type { ArvEvidenceState } from "../arv-reconciliation";

/* ------------------------------------------------------------------ */
/* Target Acquisition Price / Max Supported Offer                      */
/* ------------------------------------------------------------------ */

/** Where Board 8's two reused Investor Policy values resolved from. */
export type Board8Assumptions = {
  standardMinimumAssignmentSpread: number;
  standardMinimumLevel: Level;
  buyerProfitSharePct: number;
  buyerProfitSharePctLevel: Level;
};

/**
 * Target Acquisition Price has its own availability, nested inside a
 * resolved Board8Economics. This mirrors `types.ts`'s own precedent for
 * End-Buyer Maximum Purchase Price surviving an unresolved Seller MAO
 * ("a deliberate result-model enhancement, not a fix to smuggle in
 * later"): Max Supported Offer needs only `endBuyerMaxPrice` and
 * `standardMinimumAssignmentSpread`, both guaranteed whenever the base
 * result is resolved, so it must not be withheld merely because Target's
 * one additional input (`buyerProfitSharePct`) failed to resolve in the
 * one synthetic case where that can happen (see `types.ts`'s Figures
 * comment on `buyerProfitSharePct`).
 */
export type TargetAcquisitionPrice =
  | { status: "unavailable"; reason: string }
  | {
      status: "calculated";
      targetWholesaleProfit: number;
      targetAcquisitionPrice: number;
      buyerProfitSharePct: number;
      buyerProfitSharePctLevel: Level;
    };

export type Board8Economics =
  | { status: "unavailable"; reason: string; missing: string[] }
  | {
      status: "calculated";
      endBuyerMaxPrice: number;
      requiredBuyerProfit: number;
      maxSupportedOffer: number;
      standardMinimumAssignmentSpread: number;
      standardMinimumLevel: Level;
      target: TargetAcquisitionPrice;
    };

/**
 * Derives Board 8's Target Acquisition Price and Max Supported Offer from
 * an already-computed `UnderwritingResult`. Recomputes nothing PB-D56's
 * engine already resolved; every number here is `figures` arithmetic.
 */
export function computeBoard8Economics(result: UnderwritingResult): Board8Economics {
  if (result.status === "unresolved") {
    return {
      status: "unavailable",
      reason: "underlying underwriting has not resolved",
      missing: result.missing,
    };
  }

  const f = result.figures;

  // Max Supported Offer needs only these two, both guaranteed present
  // whenever status is "resolved" (compute.ts's own gate on ARV, Repairs,
  // buyerProfitPct and standardMinimum already covers them).
  const maxSupportedOffer = f.endBuyerMaxPrice - f.standardMinimumAssignmentSpread;

  const target: TargetAcquisitionPrice =
    f.buyerProfitSharePct === null || f.buyerProfitSharePctLevel === null
      ? {
          status: "unavailable",
          reason:
            "Buyer Profit Share Percentage did not resolve; Target Acquisition Price cannot be computed",
        }
      : (() => {
          // Governing formula, verbatim: max(25% of Required Buyer
          // Profit, the existing $5,000 Standard Minimum). Both operands
          // are figures this engine already computed -- no new deduction.
          const targetWholesaleProfit = Math.max(
            f.requiredBuyerProfit * f.buyerProfitSharePct!,
            f.standardMinimumAssignmentSpread,
          );
          return {
            status: "calculated" as const,
            targetWholesaleProfit,
            // Structurally guaranteed, not merely tested: Math.max(...)
            // above can never return less than standardMinimumAssignmentSpread,
            // so targetAcquisitionPrice can never exceed maxSupportedOffer.
            targetAcquisitionPrice: f.endBuyerMaxPrice - targetWholesaleProfit,
            buyerProfitSharePct: f.buyerProfitSharePct!,
            buyerProfitSharePctLevel: f.buyerProfitSharePctLevel!,
          };
        })();

  return {
    status: "calculated",
    endBuyerMaxPrice: f.endBuyerMaxPrice,
    requiredBuyerProfit: f.requiredBuyerProfit,
    maxSupportedOffer,
    standardMinimumAssignmentSpread: f.standardMinimumAssignmentSpread,
    standardMinimumLevel: f.standardMinimumLevel,
    target,
  };
}

/* ------------------------------------------------------------------ */
/* Expected Spread -- always at an explicit, named reference price     */
/* ------------------------------------------------------------------ */

/**
 * The only two reference prices `docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`
 * names. Not a free string: a caller cannot compute Expected Spread
 * without identifying which of the two named surfaces it is on.
 */
export type ReferenceKind = "current_offer" | "test_price";

export type ExpectedSpread =
  | { status: "unavailable"; reason: string }
  | {
      status: "calculated";
      referenceKind: ReferenceKind;
      referencePrice: number;
      endBuyerMaxPrice: number;
      expectedSpread: number;
    };

/**
 * Expected Spread = End-Buyer Maximum Purchase Price - reference price.
 * This restates PB-D56 section I's own identity
 * (`Assignment Spread = End-Buyer Maximum Purchase Price - Seller MAO`),
 * generalized to any candidate acquisition price rather than to the
 * policy-resolved Seller MAO specifically -- exactly the identity
 * `DEAL_ECONOMICS_OFFER_READINESS_V1.md`'s "Expected Spread" section
 * locks. No new deduction, no policy value, no second formula.
 *
 * `referencePrice: null` (no Current Offer entered yet; no Test Price
 * typed yet) returns "unavailable" -- never a silent zero or a spread
 * computed against a stand-in value. A missing reference price is a
 * missing input, not a favorable one (the same rule PB-D56 section III
 * states for its own inputs: unknown is never zero).
 */
export function computeExpectedSpread(args: {
  endBuyerMaxPrice: number;
  referenceKind: ReferenceKind;
  referencePrice: number | null;
}): ExpectedSpread {
  if (args.referencePrice === null) {
    return {
      status: "unavailable",
      reason:
        args.referenceKind === "current_offer"
          ? "no Current Offer entered for this negotiation"
          : "no Test Price entered on the standalone calculator",
    };
  }
  if (!Number.isFinite(args.referencePrice)) {
    throw new RangeError(`referencePrice: ${args.referencePrice} is not a finite number`);
  }
  if (!Number.isFinite(args.endBuyerMaxPrice)) {
    throw new RangeError(`endBuyerMaxPrice: ${args.endBuyerMaxPrice} is not a finite number`);
  }
  return {
    status: "calculated",
    referenceKind: args.referenceKind,
    referencePrice: args.referencePrice,
    endBuyerMaxPrice: args.endBuyerMaxPrice,
    expectedSpread: args.endBuyerMaxPrice - args.referencePrice,
  };
}

/* ------------------------------------------------------------------ */
/* ARV evidence -> Board 8's UNKNOWN / PRELIMINARY / SUPPORTED ladder  */
/* ------------------------------------------------------------------ */

/**
 * `docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`'s per-category evidence
 * ladder. Distinct from `ArvEvidenceState` (PB-D61's HIGH/MODERATE/LOW/
 * INSUFFICIENT) -- the two answer different questions at different
 * granularities, and B8-01 deliberately created no mapping between them.
 * This is that mapping, now locked by Brad's 2026-09-05 amendment. It maps
 * ONLY the ARV category's evidence classification onto Board 8's ladder;
 * it does not evaluate Offer Ready, does not touch the other five Offer
 * Ready categories, and is not itself an Offer Ready determination -- that
 * remains INV-47's (B8-04).
 */
export type Board8EvidenceLevel = "UNKNOWN" | "PRELIMINARY" | "SUPPORTED";

const ARV_EVIDENCE_TO_BOARD8: Readonly<Record<ArvEvidenceState, Board8EvidenceLevel>> = {
  HIGH: "SUPPORTED",
  MODERATE: "SUPPORTED",
  LOW: "PRELIMINARY",
  INSUFFICIENT: "UNKNOWN",
};

export function mapArvEvidenceToBoard8(state: ArvEvidenceState): Board8EvidenceLevel {
  return ARV_EVIDENCE_TO_BOARD8[state];
}
