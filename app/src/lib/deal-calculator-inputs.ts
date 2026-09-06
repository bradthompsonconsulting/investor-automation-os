/**
 * Standalone Deal Calculator -- input assembly. B8-09 / INV-52.
 *
 * Pure. No I/O, no React, no GHL identifiers. This module creates NO
 * second economics engine: `resolveInputs`, `parseDealOverrides`, and
 * `parsePolicy` (all `resolver.ts`, imported here) and `computeUnderwriting`/
 * `computeBoard8Economics`/`computeExpectedSpread` (called by the page,
 * not here) are the exact same functions Seller Call and Underwriting
 * already call. This module's only job is constructing the `DealFacts`
 * half of their input from a scratchpad's own state, because a standalone
 * calculator has no Opportunity or Contact to read it from.
 *
 * WHY DealFacts IS CONSTRUCTED DIRECTLY, NOT VIA resolveDealFacts.
 * `resolveDealFacts` (resolver.ts) exists specifically to arbitrate
 * PB-D55's Opportunity-vs-Contact seed-then-supersede -- a question that
 * does not exist here, because by default there is neither. This module
 * is the `DealFacts`-construction analog for a surface with neither,
 * mirroring exactly what `resolveDealFacts` would produce if both sides
 * were absent except for the scratchpad's own operator-typed ARV/Repairs.
 *
 * ASSIGNMENT MODE HAS NO GHL-SOURCED VALUE HERE, AND NO INVESTOR-POLICY OR
 * IAOS-STARTER LEVEL EXISTS FOR IT AT ALL -- confirmed absent: `starters.ts`'s
 * `StarterPolicy` has no assignment-mode member, and B8-02's own inventory
 * found the ONLY carrier anywhere is the Opportunity's own picklist. Every
 * real caller (Seller Call, Underwriting) reads it off an Opportunity that
 * always exists there. Since `computeUnderwriting`'s own PB-D56 section III
 * gate returns "unresolved" for EVERY figure -- including Target and Max,
 * which mathematically do not depend on assignment mode at all, per
 * `board8-economics.ts`'s own header -- until assignment mode resolves, a
 * calculator with no Opportunity could never show a single number without
 * an explicit selection existing SOMEWHERE. `DEFAULT_ASSIGNMENT_MODE`
 * below defaults the SELECTOR -- never a dollar amount, never a policy
 * value, never a formula -- to `"standard"`, the one mode requiring no
 * further input, so a cold-opened calculator can satisfy INV-52's own
 * "immediately see the six decision numbers" acceptance bar without first
 * making the operator configure something nobody asked about. It remains
 * visible and changeable under More Detail at all times. This is a UI
 * default for a required enum choice with no real-world value to honestly
 * preserve (there is no "the operator's actual assignment mode" fact this
 * could get wrong, unlike Test Price) -- HARD NO's "no invented policy"
 * governs dollar figures and formulas, and this default supplies neither.
 *
 * MANUAL MODE'S AMOUNT is operator-typed scratchpad input, exactly like
 * ARV/Repairs/Test Price -- never defaulted, never invented. Selecting
 * Manual with no amount yields `resolveInputs`'s own existing "manual
 * assignment selected but no amount is set" unresolved state, reused
 * verbatim, not a new failure mode.
 */

import type { DealFacts, AssignmentModeName, CustomValueIds, PolicyValue } from "./underwriting/resolver-types";
import { parseDealOverrides, parsePolicy, resolveInputs } from "./underwriting/resolver";
import type { UnderwritingInputs, Resolved } from "./underwriting/types";

/** The one mode requiring no further operator input -- see the module header. */
export const DEFAULT_ASSIGNMENT_MODE: AssignmentModeName = "standard";

export type DealCalculatorAssignment =
  | { mode: "standard" }
  | { mode: "profit_share" }
  | { mode: "manual"; amount: number | null };

/**
 * Builds the exact `UnderwritingInputs` shape `resolveInputs` already
 * defines, from the calculator's own ARV/Repairs/assignment state and a
 * (possibly empty) Investor Policy read. An empty `policyValues` array is
 * legitimate and not an error case -- `parsePolicy` reads every one of the
 * eleven values as absent, and `resolveInputs`'s own Deal Override ->
 * Investor Policy -> IAOS Starter hierarchy falls through to the
 * always-resolving Starter level for all eleven, exactly as it would for
 * any real deal whose Investor Policy has not been configured. This is
 * what lets the calculator work the instant it opens, before any GHL
 * policy read completes or even if that read fails outright.
 */
export function buildDealCalculatorInputs(args: {
  arv: number | null;
  repairs: number | null;
  assignment: DealCalculatorAssignment;
  policyValues: PolicyValue[];
  policyIds: CustomValueIds;
}): UnderwritingInputs {
  const assignmentMode: Resolved<AssignmentModeName> = {
    kind: "value",
    value: args.assignment.mode,
    level: "deal_override",
  };

  const facts: DealFacts = {
    arv:
      args.arv === null
        ? { kind: "unresolved", reason: "ARV not entered" }
        : { kind: "value", value: args.arv },
    repairs:
      args.repairs === null
        ? { kind: "unresolved", reason: "Repairs not entered" }
        : { kind: "value", value: args.repairs },
    askingPrice: null,
    assignmentMode,
    manualSpread: args.assignment.mode === "manual" ? args.assignment.amount : null,
  };

  // No Opportunity exists to carry a deal override -- reused verbatim
  // rather than reimplemented; every member always resolves to
  // "no deal-override carrier exists" today, on this surface or any other.
  const overrides = parseDealOverrides([]);
  const { policy } = parsePolicy(args.policyValues, args.policyIds);
  return resolveInputs(facts, overrides, policy);
}

/* ------------------------------------------------------------------ */
/* Scratchpad input validation                                          */
/* ------------------------------------------------------------------ */

/**
 * `empty`: nothing typed. `invalid`: something was typed that is not a
 * usable non-negative dollar figure -- malformed, NaN, non-finite, or
 * negative. `value`: a finite number >= 0.
 *
 * DELIBERATELY ALLOWS ZERO, unlike ARV or Test Price (both acquisition
 * prices, where zero is nonsensical -- see `parseAcquisitionPriceInput`
 * in `seller-call-negotiation.ts`, reused for those two fields, never
 * duplicated here). Repairs and a Manual assignment spread are both
 * legitimately zero: Board 6's own operator model
 * (`repair-estimation/operator-model.ts`) treats an approved $0 repair
 * condition as "a real answer... kept distinct from an absent price," and
 * PB-D56 places no positivity requirement on a Manual assignment spread
 * (`compute.ts` only requires it be finite, flagging -- never blocking --
 * one that undercuts the Standard Minimum). Reusing the acquisition-price
 * parser for either would incorrectly reject a legitimate $0 answer.
 */
export type NonNegativeAmountInput =
  | { kind: "empty" }
  | { kind: "invalid"; raw: string; reason: string }
  | { kind: "value"; value: number };

export function parseNonNegativeAmountInput(raw: string): NonNegativeAmountInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };

  const cleaned = trimmed.replace(/[$,]/g, "");
  const n = Number(cleaned);

  if (Number.isNaN(n)) return { kind: "invalid", raw, reason: "That is not a number." };
  if (!Number.isFinite(n)) return { kind: "invalid", raw, reason: "That amount is not a finite number." };
  if (n < 0) return { kind: "invalid", raw, reason: "Enter a non-negative amount." };
  return { kind: "value", value: n };
}
