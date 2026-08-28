/* Board #5 S2 — WHICH OPPORTUNITY IS THIS DEAL.
   ONE implementation, TWO callers: UnderwritingWorkspace and the
   ContactWorkspace call rail.

   THIS FILE EXISTS BECAUSE OF THE TWO-TRUTHS DEFECT. Before S2 the selection
   rule lived only as two inline useMemos inside UnderwritingWorkspace. A rail
   that re-derived "which opportunity is the deal" beside it could answer
   differently — and a rail disagreeing with the underwriting screen about
   WHICH DEAL it is showing is worse than a rail showing nothing. Extracted
   verbatim; the memos in UnderwritingWorkspace now call these and hold no
   logic of their own.

   PB-D55 IS THE RULE AND IT IS NOT NEGOTIABLE: more than one candidate
   requires an EXPLICIT choice. Never take the first. A wrong opportunity
   silently chosen produces a confident number about the wrong property, which
   is the failure mode this whole layer exists to prevent. */

import type { OpportunityRow } from "../ghl";
import type { RawField } from "./resolver-types";
import type { SelectedOpportunity } from "./view-model";

/**
 * The contact's opportunities, out of a whole-pipeline read.
 *
 * Separate from candidates() below because UnderwritingWorkspace holds the
 * FILTERED rows in state and later re-finds the selected row in them; folding
 * the filter into the mapping would change that page's data shape, and S2's
 * extraction is behaviour-preserving by construction.
 */
export function opportunitiesForContact(
  all: OpportunityRow[],
  contactId: string,
): OpportunityRow[] {
  return all.filter((o) => o.contactId === contactId);
}

/** Display candidates. Name falls back exactly as it always has. */
export function opportunityCandidates(
  opps: OpportunityRow[] | null,
): SelectedOpportunity[] {
  return (opps ?? []).map((o) => ({
    id: o.id,
    name: o.opportunityName || o.contactName || o.id,
  }));
}

/**
 * THE SELECTION RULE. Exactly one candidate auto-selects. More than one
 * requires an explicit choice — PB-D55 forbids assuming the first is the deal.
 *
 * `chosenId` is the caller's explicit selection. The rail passes null always:
 * it is a read-only surface and choosing between deals is the underwriting
 * screen's job, so with two candidates the rail resolves to null and says so
 * rather than picking.
 */
export function selectOpportunity(
  candidates: SelectedOpportunity[],
  chosenId: string | null,
): SelectedOpportunity | null {
  if (candidates.length === 1) return candidates[0];
  if (chosenId === null) return null;
  return candidates.find((c) => c.id === chosenId) ?? null;
}

/**
 * Seller MAO off the Opportunity.
 *
 * ⚠ THIS DUPLICATES THE CONTRACT OF resolver.ts's PRIVATE readNumberField,
 * DELIBERATELY AND UNDER PROTEST. resolver.ts is READ-ONLY under the S2
 * authorization and does not export its readers, so the alternative was to
 * read the field with different semantics — which is a worse duplication than
 * this one. Same contract, verbatim: fieldValueNumber ONLY, never coalescing
 * across representations; a numeric STRING at that key is the same value and
 * is accepted, because rejecting it would read the field as absent and report
 * "not yet approved" while the Opportunity held a figure.
 *
 * The one-line fix is exporting readNumberField from resolver.ts. Not
 * authorized in S2; recorded in the S2 report.
 */
export function readOpportunityNumber(
  fields: RawField[],
  id: string,
): number | null {
  const f = fields.find((x) => x.id === id);
  if (!f) return null;
  const raw = f.fieldValueNumber;
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const n = typeof raw === "number" ? raw : Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}
