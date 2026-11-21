/**
 * B15-30 / INV-140 -- the ONE next unfinished step for the selected deal, for the Seller Call hub's guided panel.
 *
 * Pure: no I/O, no React, no GHL, no persistence. It reads ONLY what the Seller Call page already computed from the
 * records it already loads -- the readiness result (`computeOfferReadiness`), the Board 8 economics (`missing` list),
 * and the selected deal's own Opportunity facts -- and returns the first step that is not done, in the existing
 * next-best-question category order (`CATEGORY_PRIORITY`). Nothing is written: resume is derived, never stored.
 *
 * Rules (Captain 2026-11-19, INV-140; Jeff brief):
 *   - One step at a time; completed steps are skipped; nothing already recorded is asked again.
 *   - A readiness OVERRIDE never completes an input step. It only means the offer review may follow once every input
 *     step is done (Board 15-14: an override alone used to say "Offer Ready -- move to presenting the offer" with no
 *     economics).
 *   - The offer review is Brad's decision. This model never approves, sends or records anything.
 *   - Records not yet read, or a failed read, never skip a step: the result says the records are loading / unreadable.
 *   - Repairs (Captain 2026-11-19): a repair total recorded on the deal's OWN Opportunity counts as done for that deal
 *     (Underwriting's approval path is its writer), as does a repairs category Seller Call readiness already supports.
 *     Readiness itself is unchanged by this rule.
 */
import type { MaterialCategory, ReadinessResult } from "./underwriting/offer-readiness";
import type { Board8Economics } from "./underwriting/board8-economics";

export type DealStepId =
  | "property" | "repairs" | "arv" | "assignment_mode" | "policy" | "transaction" | "seller_price" | "offer_review"
  | "contract_checklist" | "contract_ready";

/** Where the step is done: on Seller Call itself, by deep link into Underwriting, or (no IAOS editor) in GHL. */
export type StepDestination =
  | { kind: "seller_call"; target: string }
  | { kind: "underwriting"; target: string }
  | { kind: "ghl"; what: string }
  /** The Contract Workspace for this deal (`/contacts/:id/contract?deal=`). */
  | { kind: "contract" };

export type DealStep = { id: DealStepId; label: string; destination: StepDestination; reason: string };

export type DealStepState = {
  /** The selected deal's records as the page holds them; null fields mean "not read". */
  records: "loading" | "unreadable" | "ready";
  readiness: ReadinessResult | null;
  economics: Board8Economics | null;
  /** The deal's own Opportunity carries a repair total (null = not read). */
  dealRepairsRecorded: boolean | null;
  /** The deal's own Opportunity carries an Assignment Mode (null = not read). */
  dealAssignmentModeRecorded: boolean | null;
  /** B15-30 navigation (Captain 2026-11-20): the deal's recorded outcome. Once an agreement is reached the guided step
   *  is the contract work, never an earlier input. Omitted (older callers): no agreement is considered. */
  agreement?: { kind: "none" } | { kind: "accepted"; priceText: string; checklistDone: number; checklistTotal: number };
};

export type NextDealStep =
  | { kind: "step"; step: DealStep; done: number; total: number }
  | { kind: "checking"; message: string }
  | { kind: "unreadable"; message: string };

/** The steps in order: the six readiness categories (CATEGORY_PRIORITY), deal economics split into its two inputs. */
export const DEAL_STEP_ORDER: readonly DealStepId[] = [
  "property", "repairs", "arv", "assignment_mode", "policy", "transaction", "seller_price", "offer_review",
];

/** Focus targets (data-testid) each destination opens. */
export const STEP_TARGET: Readonly<Record<DealStepId, string>> = {
  property: "property-identity-panel",
  repairs: "underwriting-repair-estimator",
  arv: "arv-comps-workspace",
  assignment_mode: "assignment-mode-selector",
  policy: "",
  transaction: "transaction-assumptions-panel",
  seller_price: "seller-price-position-panel",
  offer_review: "negotiation-panel",
  contract_checklist: "contract-ready-checklist",
  contract_ready: "",
};

/** The exact control to open inside a target when its first focusable control is not the field. Repairs: the first
 *  row's Known amount (the first control there is the "Not asked" default answer). */
export const STEP_FOCUS_CONTROL: Readonly<Partial<Record<DealStepId, string>>> = {
  repairs: 'input[placeholder="Known amount"]',
};

const supported = (r: ReadinessResult, c: MaterialCategory) => r.categories[c] === "SUPPORTED";

/** Board 8 inputs beyond ARV, repairs and Assignment Mode that it reports missing (Investor Policy values), or the
 *  reason Target is not calculable. Empty when economics need nothing else. */
function policyGap(e: Board8Economics): string | null {
  if (e.status === "unavailable") {
    const rest = e.missing.filter((m) => m !== "arv" && m !== "repairs" && m !== "assignmentMode");
    return rest.length > 0 ? rest.join(", ") : null;
  }
  if (e.status === "calculated" && e.target.status === "unavailable") return e.target.reason;
  return null;
}

type Agreed = { priceText: string; checklistDone: number; checklistTotal: number };
function stepFor(id: DealStepId, state: { readiness: ReadinessResult; economics: Board8Economics; agreement?: Agreed | null }, policy: string | null): DealStep {
  const overridden = state.readiness.humanAction.kind === "overridden";
  switch (id) {
    case "property":
      return { id, label: "Next: confirm the property (Seller Call)", destination: { kind: "seller_call", target: STEP_TARGET.property },
        reason: "The property this deal is about is not confirmed yet." };
    case "repairs":
      return { id, label: "Next: enter Estimated Repairs (Underwriting)", destination: { kind: "underwriting", target: STEP_TARGET.repairs },
        reason: overridden ? "No repair total is recorded on this deal. Your readiness override does not replace it." : "No repair total is recorded on this deal yet." };
    case "arv":
      return { id, label: "Next: approve the ARV (Underwriting)", destination: { kind: "underwriting", target: STEP_TARGET.arv },
        reason: overridden ? "No approved ARV is on record for this deal. Your readiness override does not replace it." : "No approved ARV is on record for this deal yet." };
    case "assignment_mode":
      return { id, label: "Next: choose Assignment Mode (Underwriting)", destination: { kind: "underwriting", target: STEP_TARGET.assignment_mode },
        reason: overridden ? "This deal has no Assignment Mode. Your readiness override does not replace it." : "This deal has no Assignment Mode yet." };
    case "policy":
      return { id, label: "Next: set the missing Investor Policy values in GHL", destination: { kind: "ghl", what: "Investor Policy (Custom Values)" },
        reason: `Underwriting is still missing: ${policy ?? "an Investor Policy value"}. IAOS has no editor for these; they are set in GHL.` };
    case "transaction":
      return { id, label: "Next: record the transaction assumptions (Seller Call)", destination: { kind: "seller_call", target: STEP_TARGET.transaction },
        reason: "Closing, possession and title assumptions are not recorded for this deal yet." };
    case "seller_price":
      return { id, label: "Next: record the seller's price position (Seller Call)", destination: { kind: "seller_call", target: STEP_TARGET.seller_price },
        reason: "The seller's price position (or a refusal to give one) is not recorded for this deal yet." };
    case "contract_checklist":
      return { id, label: "Next: finish the contract checklist (Seller Call)", destination: { kind: "seller_call", target: STEP_TARGET.contract_checklist },
        reason: state.agreement ? `Agreement reached at ${state.agreement.priceText}. ${state.agreement.checklistDone} of ${state.agreement.checklistTotal} contract checklist items done.` : "The contract checklist is not complete yet." };
    case "contract_ready":
      return { id, label: "Next: open Contract Ready", destination: { kind: "contract" },
        reason: state.agreement ? `Agreement reached at ${state.agreement.priceText}. Your contract checklist is complete.` : "Your contract checklist is complete." };
    case "offer_review":
      return { id, label: "Next: review the offer — your decision (Seller Call)", destination: { kind: "seller_call", target: STEP_TARGET.offer_review },
        reason: overridden
          ? "Every input is recorded and your readiness override is on record. Reviewing and approving the offer is your decision."
          : state.readiness.effectiveStatus === "OFFER_READY"
            ? "Every input is recorded and the deal reads Offer Ready. Reviewing and approving the offer is your decision."
            : "Every input is recorded. Offer readiness is not complete yet; reviewing the offer is still your decision." };
  }
}

/** What the operator does at each Underwriting destination, for the guided bar there ("Guided from Seller Call"). */
export const UNDERWRITING_STEP_ACTION: Readonly<Partial<Record<DealStepId, string>>> = {
  repairs: "enter Estimated Repairs",
  arv: "approve the ARV",
  assignment_mode: "choose Assignment Mode",
};

/**
 * Captain REVISE 2026-11-19: one consistent instruction. Where another Seller Call surface would say "Offer Ready --
 * move to presenting the offer" (the Next Best Question engine stops at an effective OFFER_READY, which an override
 * produces), this returns what to show INSTEAD while an input step is still open -- the same reason and label as the
 * Next action -- or null when the offer review really is next. Display only: readiness, the override and every offer
 * approval rule are unchanged.
 */
export function openStepInstruction(next: NextDealStep): string | null {
  if (next.kind !== "step") return next.message;
  if (next.step.id === "offer_review") return null;
  return `${next.step.reason} ${next.step.label}.`;
}

/** The next unfinished step for the selected deal, derived fresh from its records. */
export function nextDealStep(s: DealStepState): NextDealStep {
  if (s.records === "unreadable") return { kind: "unreadable", message: "This deal's records could not be read, so the next step is not known. Reload to try again." };
  if (s.records === "loading" || !s.readiness || !s.economics || s.dealRepairsRecorded === null || s.dealAssignmentModeRecorded === null) {
    return { kind: "checking", message: "Reading this deal's records…" };
  }
  const r = s.readiness;
  const policy = policyGap(s.economics);
  /* Agreement reached (Captain 2026-11-20, IAOS Test Probe): the offer stage is over -- the next step is the contract
     work for THIS deal (finish its checklist in place, then open Contract Ready), never an earlier input such as the
     seller's price position. Every step before it counts as done. */
  if (s.agreement && s.agreement.kind === "accepted") {
    const a = s.agreement;
    const id: DealStepId = a.checklistDone >= a.checklistTotal ? "contract_ready" : "contract_checklist";
    const total = DEAL_STEP_ORDER.length;
    return { kind: "step", step: stepFor(id, { readiness: r, economics: s.economics, agreement: a }, policy), done: total, total };
  }
  const isDone: Record<DealStepId, boolean> = {
    property: supported(r, "property_identity"),
    repairs: s.dealRepairsRecorded || supported(r, "repairs_condition"),
    arv: supported(r, "arv"),
    assignment_mode: s.dealAssignmentModeRecorded,
    policy: policy === null,
    transaction: supported(r, "transaction_assumptions"),
    seller_price: supported(r, "seller_price_position"),
    offer_review: false,   // Brad's decision: never "done" by this model
    contract_checklist: false, contract_ready: false,   // reached only through an agreement (above)
  };
  const total = DEAL_STEP_ORDER.length;
  const done = DEAL_STEP_ORDER.filter((id) => isDone[id]).length;
  const next = DEAL_STEP_ORDER.find((id) => !isDone[id])!;   // offer_review is never done, so one always exists
  return { kind: "step", step: stepFor(next, { readiness: r, economics: s.economics }, policy), done, total };
}

/* ── Guided navigation: Previous / Next (Captain 2026-11-20, from Brad's Test walkthrough) ─────────────────────────
   Pure. Moving through the guided steps never writes: the position is a URL parameter (`?deal=&step=`) the page
   reads, and every step is still derived from the deal's records. */

/** The steps navigation can land on: every step with an IAOS field. The Investor Policy step is set in GHL (no field
 *  here), so Previous and Next skip it. */
export const NAV_ORDER: readonly DealStepId[] = [...DEAL_STEP_ORDER, "contract_checklist", "contract_ready"];
export const GUIDED_FIELD_STEPS: readonly DealStepId[] = NAV_ORDER.filter((id) => id !== "policy");

/** Short names for "Reviewing: …". */
export const STEP_TITLE: Readonly<Record<DealStepId, string>> = {
  property: "the property", repairs: "Estimated Repairs", arv: "the ARV", assignment_mode: "Assignment Mode",
  policy: "Investor Policy values", transaction: "the transaction assumptions", seller_price: "the seller's price position",
  offer_review: "the offer review", contract_checklist: "the contract checklist", contract_ready: "Contract Ready",
};

/** Previous: the nearest guided field step before `from`; null at the first one (Previous is then disabled). */
export function previousGuidedStep(from: DealStepId): DealStepId | null {
  const i = NAV_ORDER.indexOf(from);
  for (let j = i - 1; j >= 0; j--) if (GUIDED_FIELD_STEPS.includes(NAV_ORDER[j])) return NAV_ORDER[j];
  return null;
}

/** Next, from a review position: the nearest later guided field step; null once that reaches the live (next
 *  unfinished) step -- Next then returns to the live step. */
export function nextGuidedStep(from: DealStepId, live: DealStepId): DealStepId | null {
  const i = NAV_ORDER.indexOf(from), stop = NAV_ORDER.indexOf(live);
  for (let j = i + 1; j < stop; j++) if (GUIDED_FIELD_STEPS.includes(NAV_ORDER[j])) return NAV_ORDER[j];
  return null;
}

/** A requested review position is honoured only when it is a guided field step strictly BEFORE the live step (an
 *  unknown, later or current step means "no review": the live step). */
export function reviewCursor(next: NextDealStep, requested: string | null): DealStepId | null {
  if (next.kind !== "step" || requested === null) return null;
  const id = requested as DealStepId;
  if (!GUIDED_FIELD_STEPS.includes(id)) return null;
  return NAV_ORDER.indexOf(id) < NAV_ORDER.indexOf(next.step.id) ? id : null;
}

/** The step at any position, with the same wording and destination as the live step (null while records load). */
export function dealStepAt(s: DealStepState, id: DealStepId): DealStep | null {
  if (s.records !== "ready" || !s.readiness || !s.economics) return null;
  return stepFor(id, { readiness: s.readiness, economics: s.economics, agreement: s.agreement && s.agreement.kind === "accepted" ? s.agreement : null }, policyGap(s.economics));
}
