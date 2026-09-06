/**
 * Deal-scoped negotiation resume hydration -- Jess Re-Gate correction,
 * INV-53, 2026-09-06.
 *
 * Pure. No I/O, no React, no GHL identifiers. `SellerCallWorkspace.tsx`'s
 * first hydration attempt keyed its "have I already hydrated" guard to
 * `contactId` alone. Jess Re-Gate found two defects in that: (1) the guard
 * could be marked "done" while the contact's `screen.state` was still
 * `awaiting_selection` (no opportunity chosen yet on a multi-opportunity
 * contact) -- once marked, hydration was PERMANENTLY skipped for whatever
 * opportunity the operator picked afterward; (2) it never cleared Seller
 * Position/Current Offer on a genuine deal switch, so Deal A's negotiation
 * values could remain visible on Deal B. This module is the extracted,
 * independently testable decision logic that replaces that guard --
 * `SellerCallWorkspace.tsx`'s `useEffect` calls `resolveResumeHydration`
 * and applies exactly the `setState` calls its result names; it makes no
 * clearing/restoring decision of its own.
 *
 * THE DEAL IDENTITY IS THE OPPORTUNITY, NEVER THE CONTACT. `dealId` is
 * `screen.opportunity.id` when an opportunity is resolved, `null`
 * otherwise -- the EXACT SAME identity `seller-call-outcome.ts`'s
 * `latestOutcomeNoteForOpportunity` is already scoped to (PB-D55), so "the
 * deal on screen" and "the deal this hydration restores" can never drift
 * apart. A contact holding more than one opportunity, or the operator
 * navigating from one contact's deal to a different contact's deal without
 * a full remount, are both just "the identity changed" to this module --
 * one rule handles both.
 *
 * CLEAR BEFORE RESTORE, ONLY ON A REAL IDENTITY CHANGE. `justCleared` is
 * `true` exactly once per identity change -- the pass where `prevRef.dealId
 * !== currentDealId`. That pass ALWAYS clears every deal-specific
 * negotiation value the caller names (Seller Position, Current Offer, the
 * above-Max override and its draft/acknowledgement/warning state) before
 * this module allows anything to be restored for the new identity. An
 * ordinary rerender of the SAME opportunity (a new note appended, readiness
 * recomputed, a live edit) is never a `justCleared` pass, so it can never
 * clear or restore anything -- see `hydrated` below.
 *
 * "HYDRATED" IS PER-IDENTITY, NEVER PERMANENT. `nextRef.hydrated` starts
 * `false` the moment the identity changes and is set `true` only once this
 * module has actually decided whether to restore for that identity --
 * which requires BOTH `!loading` AND `currentDealId !== null` (a real
 * opportunity is selected). Until both hold, `hydrated` stays `false`, so a
 * contact stuck at `awaiting_selection` (or still fetching) is retried on
 * every subsequent render rather than being marked "done" prematurely --
 * the first defect above, fixed. Once `hydrated` is `true` for the current
 * identity, this module returns no restoration on every later call for
 * that SAME identity, which is what makes "never overwrite an operator's
 * edit on an ordinary rerender" hold: there is nothing left for it to do.
 *
 * NEVER A FABRICATED VALUE. `restoreSellerPosition`/`restoreCurrentOffer`
 * are non-null ONLY when the caller's own `latestOutcome` snapshot field is
 * non-null -- an absent figure at the moment of the outcome (or no outcome
 * at all) restores nothing, leaving the field however the clear step (or
 * the operator) left it. Never a zero, never a derived/computed economics
 * value -- this module reads the snapshot's own recorded number verbatim,
 * via `String()`, and nothing else.
 *
 * NEVER OVERWRITING A LIVE EDIT. Restoration additionally requires either
 * `justCleared` (the field is KNOWN empty -- this module told the caller
 * to clear it a few lines earlier in the very same decision) or the live
 * input already being `""` (the caller's own "untouched" convention,
 * identical to `sellerPositionParsed`/`currentOfferParsed` on the page). An
 * operator's own typed value in either field is therefore never replaced,
 * on any pass, for any reason.
 */

export type DealHydrationRef = {
  /** The last opportunity identity this module decided for, or `null` when none was selected yet. */
  dealId: string | null;
  /** `true` once this module has made its restore-or-not decision for `dealId` -- never retried again for that SAME identity. */
  hydrated: boolean;
};

/** Only the two fields this module ever restores -- copied verbatim from the caller's own outcome snapshot, never recomputed. */
export type ResumeSnapshot = { sellerPosition: number | null; currentOffer: number | null };

export type ResumeHydrationResult = {
  /** The caller must store this as the new ref value for the next render. */
  nextRef: DealHydrationRef;
  /** `true` exactly on the pass the identity changed -- the caller must clear every deal-specific negotiation value BEFORE applying either `restore*` field below. */
  clear: boolean;
  /** Non-null exactly when the caller must set Seller Position to this string this pass; `null` means "make no change to it." */
  restoreSellerPosition: string | null;
  /** Same convention as `restoreSellerPosition`, for Current Offer. */
  restoreCurrentOffer: string | null;
};

/**
 * The ONLY place this decision is made. Called once per render from
 * `SellerCallWorkspace.tsx`'s resume-hydration `useEffect`; performs no
 * `setState` itself -- the caller applies exactly what `clear` and the two
 * `restore*` fields name, in that order (clear, then restore).
 */
export function resolveResumeHydration(args: {
  prevRef: DealHydrationRef;
  /** `screen.opportunity.id` when an opportunity is resolved, `null` otherwise (loading, awaiting_selection, or any error/unresolved-config state). */
  currentDealId: string | null;
  loading: boolean;
  /** The current deal's latest recorded outcome snapshot, or `null` when none exists (or the deal isn't resolved yet). */
  latestOutcome: ResumeSnapshot | null;
  /** The LIVE input values, read this same render -- used only to detect "still untouched" on a non-`justCleared` pass. */
  sellerPositionInput: string;
  currentOfferInput: string;
}): ResumeHydrationResult {
  const justCleared = args.prevRef.dealId !== args.currentDealId;
  let nextRef: DealHydrationRef = justCleared
    ? { dealId: args.currentDealId, hydrated: false }
    : args.prevRef;

  const notEligibleYet = args.loading || args.currentDealId === null;

  if (nextRef.hydrated || notEligibleYet) {
    return { nextRef, clear: justCleared, restoreSellerPosition: null, restoreCurrentOffer: null };
  }

  nextRef = { dealId: nextRef.dealId, hydrated: true };

  if (!args.latestOutcome) {
    return { nextRef, clear: justCleared, restoreSellerPosition: null, restoreCurrentOffer: null };
  }

  const sellerPositionUntouched = justCleared || args.sellerPositionInput === "";
  const currentOfferUntouched = justCleared || args.currentOfferInput === "";

  return {
    nextRef,
    clear: justCleared,
    restoreSellerPosition:
      sellerPositionUntouched && args.latestOutcome.sellerPosition !== null
        ? String(args.latestOutcome.sellerPosition)
        : null,
    restoreCurrentOffer:
      currentOfferUntouched && args.latestOutcome.currentOffer !== null
        ? String(args.latestOutcome.currentOffer)
        : null,
  };
}
