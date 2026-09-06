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
 *   - repairsCondition: SUPPORTED only when BOTH an approved-looking
 *     total is on file (`known.repairs !== null`) AND the caller proves
 *     that total actually passed IAOS's approval gate
 *     (`repairsApprovalProven`). This split exists because of a Jess Gate
 *     finding on this issue's first PASS: `known.repairs` is resolved by
 *     `resolveDealFacts`'s seed-then-supersede across BOTH
 *     `contact.estimated_repairs` (the ONLY value Board 6's
 *     `persistGate` ever writes -- provably operator-approved, per
 *     `docs/ESTIMATED_REPAIRS_STANDARD.md` principle 9) AND
 *     `opportunity.repair_estimate` (which B8-02's own inventory already
 *     found has NO WRITER anywhere in `ghl.ts` -- meaning any value
 *     sitting there did not pass through the approval gate and could be
 *     stale, manual, or entered outside IAOS entirely). A non-null
 *     `known.repairs` therefore does NOT by itself prove approval; the
 *     caller must additionally prove which side of seed-then-supersede
 *     actually won. See `SellerCallWorkspace.tsx`'s `pipeline` useMemo,
 *     which derives this from `oppValues.repairs.kind` (computed before
 *     seed-then-supersede resolves) and passes it through as
 *     `repairsApprovalProven`.
 *
 *   - arv: passed through directly from `arvEvidenceState`. This is
 *     Board #7's OWN evidence-state classification (HIGH/MODERATE/LOW/
 *     INSUFFICIENT from `arv-reconciliation.ts`), read back from the
 *     EXISTING append-only ARV approval ledger note that
 *     `arv-persist.ts`'s `formatArvApprovalNote` already writes on every
 *     approval/override -- parsed by the new, strict, fail-closed
 *     `arv-approval-note.ts` (see that module's header for why this is
 *     not a new carrier). This module never inspects the ARV dollar
 *     amount and never invents an evidence state: `null` in means `null`
 *     out, mapped to UNKNOWN by `offer-readiness.ts`'s own
 *     `arvCategoryLevel`.
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
import type { ArvEvidenceState } from "./arv-reconciliation";

export type SellerCallKnownFacts = {
  arv: number | null;
  repairs: number | null;
  askingPrice: number | null;
};

export function buildOfferReadinessInputs(args: {
  known: SellerCallKnownFacts;
  dealEconomics: Board8Economics;
  repairsApprovalProven: boolean;
  arvEvidenceState: ArvEvidenceState | null;
}): OfferReadinessInputs {
  const repairsCondition: Board8EvidenceLevel =
    args.known.repairs !== null && args.repairsApprovalProven ? "SUPPORTED" : "UNKNOWN";
  return {
    propertyIdentity: "UNKNOWN",
    repairsCondition,
    arv: args.arvEvidenceState,
    transactionAssumptions: "UNKNOWN",
    sellerPricePosition: "UNKNOWN",
    dealEconomics: args.dealEconomics,
    materialUnknowns: [],
    humanAction: { kind: "none" },
  };
}
