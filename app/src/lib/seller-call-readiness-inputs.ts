/**
 * Seller Call Workspace -- Offer Readiness input assembly. B8-07 / INV-50,
 * extended by B8-13 / INV-68.
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
 *     B8-13 / INV-68, per the locked addendum
 *     (`docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`, "Addendum -- B8-13 /
 *     INV-68"). Each is a plain boolean the caller has ALREADY derived
 *     from `seller-call-readiness-carriers.ts`'s durable, strict-parsed
 *     carriers (mirroring exactly how `repairsApprovalProven` above is a
 *     pre-derived boolean, never a raw note this module parses itself) --
 *     SUPPORTED once true, UNKNOWN otherwise. No PRELIMINARY tier for any
 *     of the three: the addendum states a single confirmed/not-confirmed
 *     threshold for each, the same binary shape `repairsCondition` above
 *     already uses.
 *
 *   - humanAction: passed through verbatim from the caller, who derives it
 *     from `seller-call-readiness-carriers.ts`'s
 *     `latestReadinessHumanActionForOpportunity` (B8-13 / INV-68's durable
 *     carrier) or supplies `{ kind: "none" }` when no action is on record.
 *     This module makes no approval/override decision of any kind.
 *
 * dealEconomics is consumed verbatim from the caller's own B8-03
 * computation; this module never recomputes it.
 */

import type { Board8Economics, Board8EvidenceLevel } from "./underwriting/board8-economics";
import type { HumanAction, OfferReadinessInputs } from "./underwriting/offer-readiness";
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
  propertyIdentityConfirmed: boolean;
  transactionAssumptionsRecorded: boolean;
  sellerPricePositionRecorded: boolean;
  humanAction: HumanAction;
}): OfferReadinessInputs {
  const repairsCondition: Board8EvidenceLevel =
    args.known.repairs !== null && args.repairsApprovalProven ? "SUPPORTED" : "UNKNOWN";
  const propertyIdentity: Board8EvidenceLevel = args.propertyIdentityConfirmed ? "SUPPORTED" : "UNKNOWN";
  const transactionAssumptions: Board8EvidenceLevel = args.transactionAssumptionsRecorded ? "SUPPORTED" : "UNKNOWN";
  const sellerPricePosition: Board8EvidenceLevel = args.sellerPricePositionRecorded ? "SUPPORTED" : "UNKNOWN";
  return {
    propertyIdentity,
    repairsCondition,
    arv: args.arvEvidenceState,
    transactionAssumptions,
    sellerPricePosition,
    dealEconomics: args.dealEconomics,
    materialUnknowns: [],
    humanAction: args.humanAction,
  };
}
