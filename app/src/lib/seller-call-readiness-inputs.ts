/**
 * Seller Call Workspace -- Offer Readiness input assembly. B8-07 / INV-50.
 *
 * Pure. No I/O, no React, no GHL. Extracted from the page for the same
 * reason `seller-call-deal-bar.ts` and `next-best-question.ts` were: the
 * rule for turning what Seller Call already knows into B8-04's
 * `OfferReadinessInputs` belongs in one testable place, not inline in a
 * component.
 *
 * FEEDS EXISTING EVIDENCE; MANUFACTURES NONE. Per-category, stated
 * because the honest answer differs by category:
 *
 *   - repairsCondition: SUPPORTED when an approved repair total is on
 *     file (`known.repairs !== null`), UNKNOWN otherwise. This is a real
 *     signal, not a guess -- `docs/ESTIMATED_REPAIRS_STANDARD.md`'s own
 *     locked principle 9 says "Only operator approval makes the total
 *     authoritative," and the ONLY value that ever reaches
 *     `contact.estimated_repairs` is that approved total (row-level
 *     amounts are session-only and never leave the estimator). Presence
 *     on file therefore already means a human approved it -- this is not
 *     inferring quality from a number that could be a placeholder.
 *
 *   - arv: always null (never established), UNCHANGED from B8-05/B8-06.
 *     Unlike repairs, an approved ARV DOLLAR AMOUNT does not tell us the
 *     ArvEvidenceState (HIGH/MODERATE/LOW/INSUFFICIENT) that supported
 *     it -- that classification is B7-09's own ledger, and B7-09's own
 *     documentation states it is session-only within the ARV comps
 *     workspace and "not wired into the workspace" for persistence. No
 *     structured evidence-state signal exists anywhere this module could
 *     honestly read, on this route or any other -- B8-02 already found
 *     this gap, and this issue does not invent a carrier to close it
 *     (HARD NO: no new persistence architecture). Mapping "a dollar
 *     amount exists" to any specific evidence state would be exactly the
 *     fabrication `offer-readiness.ts`'s own header forbids.
 *
 *   - propertyIdentity, transactionAssumptions, sellerPricePosition:
 *     UNKNOWN, unchanged. No determination mechanism exists for these
 *     three either (B8-02 item 7), and INV-50 is scoped to repairs and
 *     ARV/PropStream only -- it does not extend to these.
 *
 * dealEconomics is consumed verbatim from the caller's own B8-03
 * computation; this module never recomputes it.
 */

import type { Board8Economics, Board8EvidenceLevel } from "./underwriting/board8-economics";
import type { OfferReadinessInputs } from "./underwriting/offer-readiness";

export type SellerCallKnownFacts = {
  arv: number | null;
  repairs: number | null;
  askingPrice: number | null;
};

export function buildOfferReadinessInputs(args: {
  known: SellerCallKnownFacts;
  dealEconomics: Board8Economics;
}): OfferReadinessInputs {
  const repairsCondition: Board8EvidenceLevel = args.known.repairs !== null ? "SUPPORTED" : "UNKNOWN";
  return {
    propertyIdentity: "UNKNOWN",
    repairsCondition,
    arv: null,
    transactionAssumptions: "UNKNOWN",
    sellerPricePosition: "UNKNOWN",
    dealEconomics: args.dealEconomics,
    materialUnknowns: [],
    humanAction: { kind: "none" },
  };
}
