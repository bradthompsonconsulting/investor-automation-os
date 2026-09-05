/**
 * Adaptive Next Best Question / Minimum Sufficient Knowledge guidance --
 * B8-06 / INV-49.
 *
 * Pure. No I/O, no React, no GHL, no AI call, no persistence. CONSUMES
 * `ReadinessResult` (B8-04's `computeOfferReadiness`); it never
 * recomputes a category's evidence level, never re-derives `status` or
 * `effectiveStatus`, and creates no second readiness engine. Its entire
 * job is to pick ONE of B8-04's own reasons to surface next and phrase it
 * as a question, not to decide what counts as supported.
 *
 * STATELESS AND ORDER-INDEPENDENT, BY CONSTRUCTION. This function takes
 * no history, no "current step," and no memory of what was asked before.
 * It is called fresh on every render from whatever `ReadinessResult` the
 * CURRENT facts produce, so a nonlinear seller conversation -- the seller
 * volunteers their price before condition comes up, or answers three
 * things at once -- is handled for free: the next call simply reflects
 * whatever is left. There is no script pointer to get out of sync.
 *
 * PRIORITY IS NOT INVENTED. Two already-existing, already-authoritative
 * signals decide it, not a new ranking this module invents:
 *
 *   1. Severity, from B8-04's OWN aggregation rule (offer-readiness.ts):
 *      a material unknown or an UNKNOWN category forces NOT_READY: more
 *      severe than a PRELIMINARY category, which only forces
 *      REVIEW_NEEDED. Material unknowns rank above UNKNOWN categories
 *      within that top tier because the Offer Ready contract's own words
 *      single them out as facts that "could significantly change the
 *      supported offer" -- a stronger claim than a category simply not
 *      having been asked about yet.
 *
 *   2. Within a severity tier, the SIX CATEGORIES' OWN LISTED ORDER in
 *      `DEAL_ECONOMICS_OFFER_READINESS_V1.md` (property, repairs/
 *      condition, ARV, deal economics, transaction/deal-structure
 *      assumptions, seller price position) -- copied verbatim as
 *      `CATEGORY_PRIORITY` below, not re-derived or re-ordered. This
 *      also happens to match the underwriting waterfall's own
 *      dependency order: deal economics (Gate 1: ARV + Repairs as raw
 *      facts) cannot resolve before ARV and repairs condition are known,
 *      so asking about the earlier categories first naturally clears the
 *      later ones' blocking cause too.
 *
 * This is a V1 default order, not a claim that these six categories are
 * universally ranked this way for every deal -- if Brad wants a
 * different order, `CATEGORY_PRIORITY` is the one line that changes,
 * exactly the same calibratable-surface pattern PB-D61 already uses for
 * its own named V1 constants.
 *
 * MOTIVATION AND TIMELINE ARE NOT HERE. Neither appears as a category,
 * a question, or a priority signal -- INV-49 is explicit that they may
 * assist negotiation but are never universal Offer Ready blockers, and
 * this module has no mechanism that could make them one. A question
 * about either can only ever reach the operator via a caller-supplied
 * `materialUnknown`, exactly like any other fact a human decided was
 * material to THIS deal.
 *
 * NEVER RE-ASKS WHAT IS ALREADY KNOWN. A SUPPORTED category is never
 * selected at all (B8-04 excludes it from `reasons`). Within a selected
 * category, the question text itself acknowledges an already-known raw
 * fact rather than asking for it again from scratch -- e.g. ARV UNKNOWN
 * with a raw ARV number already on file asks whether that number is
 * still current and comp-supported, not "what is the ARV."
 *
 * STOPS AT OFFER READY. Gated on `effectiveStatus`, not the raw `status`
 * -- a human OVERRIDDEN decision means the operator has already chosen
 * to proceed despite a gap, and this module does not keep raising
 * underwriting questions against a decision the human already made. The
 * raw status and reasons remain visible elsewhere (ReadinessBadge); this
 * module only decides whether to still ask something.
 */

import type {
  MaterialCategory,
  MaterialUnknownReason,
  ReadinessResult,
} from "./offer-readiness";

/** Raw facts already on file, so a question can acknowledge them instead of re-asking from zero. */
export type KnownFactsSnapshot = {
  arv: number | null;
  repairs: number | null;
  askingPrice: number | null;
};

export type NextBestQuestion =
  | { kind: "offer_ready"; message: string }
  | {
      kind: "question";
      source:
        | { kind: "category"; category: MaterialCategory; level: "UNKNOWN" | "PRELIMINARY" }
        | { kind: "material_unknown"; unknownCode: string };
      question: string;
      whyItMatters: string;
    };

/**
 * `DEAL_ECONOMICS_OFFER_READINESS_V1.md` lines 200-207's own listed
 * order. Copied verbatim -- see the module header for why this is the
 * tie-break within a severity tier, not an invented ranking.
 */
export const CATEGORY_PRIORITY: readonly MaterialCategory[] = [
  "property_identity",
  "repairs_condition",
  "arv",
  "deal_economics",
  "transaction_assumptions",
  "seller_price_position",
];

const WHY_IT_MATTERS: Record<MaterialCategory, string> = {
  property_identity: "Every other number on this deal is meaningless if it is attached to the wrong property.",
  repairs_condition: "Repairs subtract directly from the offer; an unsupported number is not a supported offer.",
  arv: "ARV sets the ceiling every dollar of this deal is measured against.",
  deal_economics: "PB-D56 Gate 1: without ARV and repairs on file, no economics exist yet to negotiate from at all.",
  transaction_assumptions: "How the deal is structured can change what a supported offer actually requires.",
  seller_price_position: "There is nothing to compare the supported offer against without knowing where the seller stands.",
};

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function categoryQuestionText(category: MaterialCategory, level: "UNKNOWN" | "PRELIMINARY", known: KnownFactsSnapshot): string {
  switch (category) {
    case "property_identity":
      return level === "UNKNOWN"
        ? "Confirm exactly which property this is — full address, parcel, and structure type."
        : "Double-check the property identity already on file — has anything about the address or structure changed?";
    case "repairs_condition":
      if (level === "UNKNOWN") {
        return known.repairs !== null
          ? `Walk the property's condition to confirm the ${money(known.repairs)} repair estimate on file is defensible.`
          : "Walk through the property's condition — roof, HVAC, foundation, recent updates.";
      }
      return "The repair picture is preliminary — is there anything about the condition still worth confirming?";
    case "arv":
      if (level === "UNKNOWN") {
        return known.arv !== null
          ? `Confirm the ${money(known.arv)} ARV on file is still current and comp-supported.`
          : "Has a valuation (ARV) been run for this property yet?";
      }
      return "The ARV's comp support is thin — are there stronger, more recent nearby sales to check?";
    case "deal_economics":
      return level === "UNKNOWN"
        ? "Get ARV and repairs on file — underwriting cannot calculate anything until both are present."
        : "Max Supported Offer calculated, but Target Acquisition Price could not — check the Buyer Profit Share Percentage policy value.";
    case "transaction_assumptions":
      return level === "UNKNOWN"
        ? "Confirm the deal-structure basics — closing and possession expectations, any known title complications."
        : "The deal-structure assumptions are preliminary — anything about closing or possession still unclear?";
    case "seller_price_position":
      return level === "UNKNOWN"
        ? "Ask what the seller is hoping to get for the property."
        : "The seller's price position is only a preliminary read — worth confirming how firm it is?";
  }
}

function materialUnknownQuestionText(r: MaterialUnknownReason): string {
  const match = /^Unresolved material unknown \([^)]*\):\s*(.*)$/.exec(r.message);
  const description = match ? match[1] : r.message;
  return `Resolve before continuing: ${description}`;
}

/**
 * Selects the single Next Best Question from a `ReadinessResult` B8-04
 * already computed, plus the raw facts already on file so the question
 * can acknowledge them instead of re-asking from zero.
 */
export function computeNextBestQuestion(
  readiness: ReadinessResult,
  known: KnownFactsSnapshot,
): NextBestQuestion {
  if (readiness.effectiveStatus === "OFFER_READY") {
    return {
      kind: "offer_ready",
      message: "Offer Ready — no further underwriting question. Move to presenting the offer.",
    };
  }

  // Tier 1a: material unknowns, in the order they were supplied.
  const materialUnknown = readiness.reasons.find(
    (r): r is MaterialUnknownReason => r.kind === "material_unknown",
  );
  if (materialUnknown) {
    return {
      kind: "question",
      source: { kind: "material_unknown", unknownCode: materialUnknown.unknownCode },
      question: materialUnknownQuestionText(materialUnknown),
      whyItMatters:
        "This is exactly the kind of fact the Offer Ready contract names as able to significantly change the supported offer — it comes before any other underwriting question.",
    };
  }

  // Tier 1b: UNKNOWN categories, in CATEGORY_PRIORITY order.
  for (const category of CATEGORY_PRIORITY) {
    if (readiness.categories[category] === "UNKNOWN") {
      return {
        kind: "question",
        source: { kind: "category", category, level: "UNKNOWN" },
        question: categoryQuestionText(category, "UNKNOWN", known),
        whyItMatters: WHY_IT_MATTERS[category],
      };
    }
  }

  // Tier 2: PRELIMINARY categories, same order.
  for (const category of CATEGORY_PRIORITY) {
    if (readiness.categories[category] === "PRELIMINARY") {
      return {
        kind: "question",
        source: { kind: "category", category, level: "PRELIMINARY" },
        question: categoryQuestionText(category, "PRELIMINARY", known),
        whyItMatters: WHY_IT_MATTERS[category],
      };
    }
  }

  // Structurally unreachable while effectiveStatus and status share
  // computeOfferReadiness's own aggregation rule: no material unknown, no
  // UNKNOWN category and no PRELIMINARY category means every category is
  // SUPPORTED, which is exactly OFFER_READY and already returned above.
  // Kept explicit rather than a non-null assertion, so a future change to
  // that aggregation rule fails loudly here instead of throwing.
  return {
    kind: "offer_ready",
    message: "Offer Ready — no further underwriting question. Move to presenting the offer.",
  };
}
