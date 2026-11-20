/**
 * B15-30 R1 (Bones REVISE 2026-11-20) -- a deal NAMED by a link (`?deal=<opportunityId>`, from a guided Next action or
 * the guided return to Seller Call) is honoured exactly, never substituted.
 *
 * `selectOpportunity` auto-selects a contact's ONLY deal whatever id was asked for (PB-D55's single-deal rule). That is
 * right when nothing was named, but when a link names Deal A and A is no longer this contact's deal, it silently opened
 * the other deal -- the guided step, its editor and its return link then belonged to a deal the rep never chose.
 *
 *   - Nothing named, or the rep has since chosen a deal themselves: the existing rule, unchanged.
 *   - Named, and this contact's deals are not loaded yet: "pending" -- nothing is selected and no choice is offered from
 *     data that may still be another contact's.
 *   - Named and found: that deal.
 *   - Named and NOT among this contact's deals: "unavailable" -- nothing is selected; the page says so and offers every
 *     deal for a deliberate choice (even when there is only one).
 *
 * Pure: no I/O. Lives outside lib/underwriting so the protected selection engine is unchanged.
 */
import { selectOpportunity } from "./underwriting/selectOpportunity";
import type { SelectedOpportunity } from "./underwriting/view-model";

export type RequestedDeal = "none" | "pending" | "found" | "unavailable";

export function resolveRequestedDeal(
  candidates: SelectedOpportunity[],
  chosenId: string | null,
  requestedId: string | null,
  loadedForThisContact: boolean,
): { selected: SelectedOpportunity | null; requested: RequestedDeal } {
  if (requestedId === null || chosenId !== requestedId) return { selected: selectOpportunity(candidates, chosenId), requested: "none" };
  if (!loadedForThisContact) return { selected: null, requested: "pending" };
  const match = candidates.find((c) => c.id === requestedId) ?? null;
  return match ? { selected: match, requested: "found" } : { selected: null, requested: "unavailable" };
}

/** What the deal chooser says for a named deal that is pending or unavailable (null: the page's own wording). */
export function requestedDealNotice(requested: RequestedDeal): { title: string; body: string } | null {
  if (requested === "pending") return { title: "Opening the deal this link named…", body: "Reading this contact's deals." };
  if (requested === "unavailable") {
    return {
      title: "The deal this link named is not available",
      body: "It is not one of this contact's deals any more, so IAOS has not opened another one in its place. Choose the deal you mean.",
    };
  }
  return null;
}
