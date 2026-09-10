/**
 * Contract Workspace -- page-state view model. B9-04 / INV-59.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes. Mirrors the
 * established pattern `underwriting/view-model.ts` and
 * `seller-call-deal-bar.ts` already set: the page owns fetching and
 * opportunity selection; this module owns interpreting what is already
 * fetched into one screen state, so the component does not decide for
 * itself what "Contract Ready" or "stale" means.
 *
 * CONSUMES B9-03 DIRECTLY, RECREATES NOTHING. Every readiness judgment
 * comes from `board9-contract-model.ts`'s own `deriveInheritedEconomics`
 * and `evaluateContractReady` -- this module supplies evidence, it never
 * computes a second opinion about what that evidence means. The one
 * genuinely new piece of logic here is SCREEN-STATE SELECTION (loading /
 * error / no-opportunity / awaiting-selection / no-agreement / conflicting
 * history / ready), which is UI orchestration, not a readiness rule, and
 * is exactly the same kind of state B9-03's own module explicitly declines
 * to own (it has no I/O and no notion of "which opportunity is on screen").
 *
 * NO INVENTED GHL-TO-DOMAIN MAPPING. The only GHL-derived data this module
 * touches is `notes` (bodies, read through already-exported, already-
 * tested parsers) and a plain `propertyAddress` string the caller supplies
 * -- the SAME `formatAddress(contact)` helper `SellerCallWorkspace.tsx`
 * already uses, not reimplemented here. No new custom field is read, no
 * new field id is introduced, no new write class is added.
 *
 * THE "LATEST CHECKLIST NOTE, ANY SCOPE" READ IS NOT A NEW CARRIER.
 * `seller-call-readiness-carriers.ts` exports `parseContractReadyChecklistNote`
 * (a single-note parser) and `currentContractReadyChecklistForOpportunity`
 * (latest note, but ONLY when it matches the current agreement's exact
 * scope -- returns `null` both when nothing was ever recorded AND when a
 * record exists for a DIFFERENT agreement, which are different facts this
 * screen must tell apart to render a truthful staleness warning).
 * `latestContractReadyChecklistAnyScope` below mirrors that carrier's own
 * "latest wins" loop verbatim, using the SAME already-exported parser,
 * with the scope filter removed -- a different read composed from an
 * existing, already-tested building block, not a new persistence
 * mechanism.
 *
 * FAIL CLOSED. Every branch below either reaches `state: "ready"` only
 * once the accepted economics have been verified derivable
 * (`deriveInheritedEconomics(...).ok`) and a real Current Offer exists, or
 * it returns one of the other named states with an operator-readable
 * reason. There is no branch that renders checklist/readiness UI from
 * unverified or partially-loaded data.
 */

import {
  latestOutcomeNoteForOpportunity,
  type CallOutcomeKind,
} from "./seller-call-outcome";
import {
  currentContractReadyChecklistForOpportunity,
  parseContractReadyChecklistNote,
  CONTRACT_READY_ITEM_KEYS,
  type ContractReadyItems,
  type ParsedContractReadyChecklist,
} from "./seller-call-readiness-carriers";
import {
  deriveInheritedEconomics,
  evaluateContractReady,
  type InheritedAgreementEconomics,
  type TransitionReason,
} from "./board9-contract-model";

export type ContractOpportunityRef = { id: string; name: string };

const EMPTY_CHECKLIST: ContractReadyItems = CONTRACT_READY_ITEM_KEYS.reduce(
  (acc, key) => ({ ...acc, [key]: false }),
  {} as ContractReadyItems,
);

/**
 * Mirrors `currentContractReadyChecklistForOpportunity`'s own "latest
 * wins, scoped to one Opportunity" loop exactly, using the same
 * already-exported, already-tested `parseContractReadyChecklistNote` --
 * with the final exact-scope match removed, so a record for a DIFFERENT
 * agreement is still found (never used as current progress, only to
 * distinguish "never started" from "started, now stale" below).
 */
function latestContractReadyChecklistAnyScope(
  notes: { body: string }[],
  opportunityId: string,
): ParsedContractReadyChecklist | null {
  let latest: ParsedContractReadyChecklist | null = null;
  for (const note of notes) {
    const parsed = parseContractReadyChecklistNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

export type ContractScreenState =
  | { state: "loading" }
  | { state: "fetch_error"; message: string }
  | { state: "no_opportunity" }
  | { state: "awaiting_selection"; candidates: ContractOpportunityRef[] }
  /** No accept-kind outcome stands for this opportunity, and no Contract Ready history exists either -- nothing to show yet, not an error. */
  | { state: "no_agreement"; opportunity: ContractOpportunityRef; latestOutcomeKind: CallOutcomeKind | null }
  /**
   * The current standing outcome is NOT an accept (or no outcome exists
   * at all), yet Contract Ready checklist history exists for this
   * opportunity -- a genuine conflict between what Board 8 currently
   * says (no active Agreement Reached) and what Board 9 artifacts imply
   * (contract prep was under way). Never silently resolved either
   * direction; surfaced explicitly.
   */
  | {
      state: "conflicting_history";
      opportunity: ContractOpportunityRef;
      latestOutcomeKind: CallOutcomeKind | null;
      priorChecklistAt: string;
    }
  /** An accept outcome exists but its own economics could not be treated as authoritative (no Current Offer recorded, or `deriveInheritedEconomics` itself refused it). Fail-closed, never a guess. */
  | { state: "economics_unavailable"; opportunity: ContractOpportunityRef; reason: string }
  | {
      state: "ready";
      opportunity: ContractOpportunityRef;
      economics: InheritedAgreementEconomics;
      /** `economics.economics.currentOffer`, narrowed to a real `number` -- already verified non-null to reach this state, so callers never need an `as number` cast to use it in a write (e.g. the checklist note's own `agreedPrice`). */
      agreedPrice: number;
      propertyAddress: string;
      readiness: { ready: boolean; reasons: TransitionReason[] };
      checklistItems: ContractReadyItems;
      /** True only when a Contract Ready record exists for THIS opportunity but scoped to a DIFFERENT agreement (price, address, or agreement timestamp changed since). */
      isStale: boolean;
      staleInfo: { priorAgreementAt: string; priorPrice: number; priorAddress: string } | null;
    };

export function computeContractScreenState(args: {
  loading: boolean;
  fetchError: string | null;
  candidates: ContractOpportunityRef[];
  selected: ContractOpportunityRef | null;
  notes: { body: string }[] | null;
  propertyAddress: string;
}): ContractScreenState {
  if (args.fetchError !== null) return { state: "fetch_error", message: args.fetchError };
  if (args.loading) return { state: "loading" };
  if (args.candidates.length === 0) return { state: "no_opportunity" };
  if (args.selected === null) return { state: "awaiting_selection", candidates: args.candidates };

  const notes = args.notes ?? [];
  const latestOutcome = latestOutcomeNoteForOpportunity(notes, args.selected.id);
  const priorChecklist = latestContractReadyChecklistAnyScope(notes, args.selected.id);

  if (latestOutcome === null || latestOutcome.kind !== "accept") {
    if (priorChecklist !== null) {
      return {
        state: "conflicting_history",
        opportunity: args.selected,
        latestOutcomeKind: latestOutcome?.kind ?? null,
        priorChecklistAt: priorChecklist.at,
      };
    }
    return { state: "no_agreement", opportunity: args.selected, latestOutcomeKind: latestOutcome?.kind ?? null };
  }

  if (latestOutcome.snapshot.currentOffer === null) {
    return {
      state: "economics_unavailable",
      opportunity: args.selected,
      reason: "The accepted outcome has no recorded Current Offer -- this record cannot be treated as authoritative.",
    };
  }

  const derived = deriveInheritedEconomics({
    opportunityId: args.selected.id,
    outcomeKind: latestOutcome.kind,
    agreementAt: latestOutcome.at,
    economics: latestOutcome.snapshot,
  });
  if (!derived.ok) {
    return { state: "economics_unavailable", opportunity: args.selected, reason: derived.error };
  }

  const currentChecklist = currentContractReadyChecklistForOpportunity(
    notes,
    args.selected.id,
    latestOutcome.at,
    latestOutcome.snapshot.currentOffer,
    args.propertyAddress,
  );
  const isStale = priorChecklist !== null && currentChecklist === null;
  const checklistItems: ContractReadyItems = currentChecklist?.items ?? EMPTY_CHECKLIST;
  const readiness = evaluateContractReady({
    agreementReached: true,
    checklist: checklistItems,
    checklistScopeMatches: currentChecklist !== null || priorChecklist === null,
  });

  return {
    state: "ready",
    opportunity: args.selected,
    economics: derived.value,
    agreedPrice: latestOutcome.snapshot.currentOffer,
    propertyAddress: args.propertyAddress,
    readiness,
    checklistItems,
    isStale,
    staleInfo:
      isStale && priorChecklist
        ? { priorAgreementAt: priorChecklist.agreementAt, priorPrice: priorChecklist.agreedPrice, priorAddress: priorChecklist.propertyAddress }
        : null,
  };
}
