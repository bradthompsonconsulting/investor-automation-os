/**
 * Adaptive Next Best Question / Minimum Sufficient Knowledge guidance --
 * B8-06 / INV-49.
 *
 * Pure. No I/O, no React, no GHL, no AI call, no persistence. CONSUMES
 * `ReadinessResult` (B8-04's `computeOfferReadiness`) and the
 * `Board8Economics` object (B8-03's `computeBoard8Economics`) the page
 * already computed; it never recomputes a category's evidence level,
 * never re-derives `status`/`effectiveStatus`, never recomputes
 * underwriting, and creates no second readiness or economics engine.
 * Its entire job is to pick ONE of B8-04's own reasons to surface next
 * and phrase it as a genuine question, not to decide what counts as
 * supported or why the math did or didn't resolve.
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
 *      `CATEGORY_PRIORITY` below, not re-derived or re-ordered.
 *
 * This is a V1 default order, not a claim that these six categories are
 * universally ranked this way for every deal -- if Brad wants a
 * different order, `CATEGORY_PRIORITY` is the one line that changes,
 * exactly the same calibratable-surface pattern PB-D61 already uses for
 * its own named V1 constants.
 *
 * EVERY `question` IS A QUESTION. Jess Gate on this issue's first PASS
 * caught two emitted `question` strings that were commands
 * ("Get ARV and repairs on file...", "Resolve before continuing: ...").
 * Every question this module can emit is audited below to end in "?" and
 * read as something an operator could actually ask -- see
 * test-next-best-question.cjs's exhaustive interrogative-form check.
 *
 * DEAL ECONOMICS NEVER GUESSES ITS OWN DIAGNOSIS. The same Jess Gate
 * caught this module ASSUMING deal-economics UNKNOWN always means ARV
 * and repairs are missing. `Board8Economics.status === "unavailable"`
 * can happen for ANY of compute.ts's required inputs -- selling cost
 * percentage, closing cost, financing terms, assignment mode, and more,
 * per PB-D56 section III -- not only Gate 1. `dealEconomicsDiagnosis`
 * below reads B8-03's own `missing` list (when UNKNOWN) or `target.reason`
 * (when PRELIMINARY) and phrases the question from what B8-03 actually
 * reports, naming ARV/repairs specifically ONLY when they are the true
 * cause, and falling back to neutral, still-truthful wording naming
 * whatever else is actually unresolved otherwise.
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
import type { Board8Economics } from "./board8-economics";
import { APPROVED_SCRIPT_FOR_COLD_CATEGORY } from "../seller-call-script";

/** Raw facts already on file, so a question can acknowledge them instead of re-asking from zero. */
export type KnownFactsSnapshot = {
  arv: number | null;
  repairs: number | null;
  askingPrice: number | null;
};

export type NextBestQuestion =
  | { kind: "offer_ready"; message: string }
  /** Board 15 / Pass 1 F34: nothing left to ask the SELLER, but underwriting
   *  items remain -- those are the operator's own checklist, not questions. */
  | { kind: "operator_only"; message: string }
  | {
      kind: "question";
      source:
        | { kind: "category"; category: MaterialCategory; level: "UNKNOWN" | "PRELIMINARY" }
        | { kind: "material_unknown"; unknownCode: string };
      /** Who the item is for. "seller": something to ask the seller on the
       *  call. "operator": an underwriting task for Brad (ARV, deal economics,
       *  assignment mode) that must never be read to the seller (F34). */
      audience: QuestionAudience;
      question: string;
      whyItMatters: string;
    };

export type QuestionAudience = "seller" | "operator";

/**
 * Board 15 / Pass 1 F34 (INV-103). Pass 1 found the call script asking the
 * seller internal questions ("Has a valuation (ARV) been run?", "Underwriting
 * is still missing ... the assignment mode -- is that information available?").
 * ARV and deal economics are underwriting work Brad does himself; the seller
 * cannot answer them. They stay visible -- as the operator's checklist --
 * but never as a Suggested Next Question or an Other Useful Question.
 *
 * Every other category (property identity, repairs/condition, transaction
 * assumptions, seller price position) is something the seller can speak to.
 * Material unknowns are caller-supplied facts a human marked material for
 * THIS deal; they keep their existing seller-facing treatment (unchanged).
 */
export const OPERATOR_CATEGORIES: readonly MaterialCategory[] = ["arv", "deal_economics"];

function audienceFor(source: { kind: "category"; category: MaterialCategory } | { kind: "material_unknown" }): QuestionAudience {
  return source.kind === "category" && OPERATOR_CATEGORIES.includes(source.category) ? "operator" : "seller";
}

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

/** Every category except deal_economics, whose whyItMatters depends on B8-03's own reported cause -- see dealEconomicsDiagnosis. */
const WHY_IT_MATTERS: Omit<Record<MaterialCategory, string>, "deal_economics"> = {
  property_identity: "Every other number on this deal is meaningless if it is attached to the wrong property.",
  repairs_condition: "Repairs subtract directly from the offer; an unsupported number is not a supported offer.",
  arv: "ARV sets the ceiling every dollar of this deal is measured against.",
  transaction_assumptions: "How the deal is structured can change what a supported offer actually requires.",
  seller_price_position: "There is nothing to compare the supported offer against without knowing where the seller stands.",
};

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

/**
 * Every question below is a genuine interrogative sentence -- see the
 * module header. `property_identity`/`repairs_condition`/`arv`/
 * `transaction_assumptions`/`seller_price_position` only; `deal_economics`
 * is handled separately by `dealEconomicsDiagnosis` because it needs
 * B8-03's own reported cause, not just the level.
 */
function categoryQuestionText(
  category: Exclude<MaterialCategory, "deal_economics">,
  level: "UNKNOWN" | "PRELIMINARY",
  known: KnownFactsSnapshot,
): string {
  switch (category) {
    case "property_identity":
      // UNKNOWN is always the truly-cold case for this category -- there is
      // no known-address branch to distinguish first-ask from recheck (see
      // KnownFactsSnapshot), so Brad's approved line is preferred outright.
      return level === "UNKNOWN"
        ? APPROVED_SCRIPT_FOR_COLD_CATEGORY.property_identity
        : "Has anything about the property's address or structure changed since it was recorded?";
    case "repairs_condition":
      if (level === "UNKNOWN") {
        return known.repairs !== null
          ? `Is the ${money(known.repairs)} repair estimate already on file still accurate for this property's condition?`
          : APPROVED_SCRIPT_FOR_COLD_CATEGORY.repairs_condition;
      }
      return "Is there anything about the property's condition still worth confirming?";
    case "arv":
      if (level === "UNKNOWN") {
        return known.arv !== null
          ? `Is the ${money(known.arv)} ARV on file still current and comp-supported?`
          : "Has a valuation (ARV) been run for this property yet?";
      }
      return "Are there stronger, more recent nearby sales that could better support the ARV?";
    case "transaction_assumptions":
      return level === "UNKNOWN"
        ? "What are the deal-structure basics — closing and possession expectations, any known title complications?"
        : "Is there anything about closing or possession still unclear?";
    case "seller_price_position":
      return level === "UNKNOWN"
        ? APPROVED_SCRIPT_FOR_COLD_CATEGORY.seller_price_position
        : "How firm is the seller's stated price position?";
  }
}

function stripTrailingPeriod(s: string): string {
  return s.endsWith(".") ? s.slice(0, -1) : s;
}

function materialUnknownQuestionText(r: MaterialUnknownReason): string {
  const match = /^Unresolved material unknown \([^)]*\):\s*(.*)$/.exec(r.message);
  const description = match ? match[1] : r.message;
  return `What's the current status of this — ${stripTrailingPeriod(description)}?`;
}

/**
 * Operator-facing labels for the raw keys `compute.ts` can push into
 * `UnderwritingResult.missing` (see compute.ts and view-model.ts's own
 * MISSING_LABELS, which this mirrors for the same reason: internal
 * identifiers must never reach the operator). Kept local rather than
 * importing view-model.ts's private constant, per this correction's
 * "no other scope changes" -- duplicating thirteen labels is a smaller,
 * more contained change than exporting a symbol from an unrelated,
 * already-proven file during a bounded gate-fix cycle.
 */
const MISSING_INPUT_LABEL: Record<string, string> = {
  arv: "ARV",
  repairs: "the repair estimate",
  sellingCostPct: "the selling cost percentage",
  closingCost: "the closing cost estimate",
  monthlyCarry: "the monthly holding cost",
  holdMonths: "the hold period",
  buyerProfitPct: "the buyer profit percentage",
  standardMinimum: "the standard minimum assignment spread",
  profitSharePct: "the buyer profit share percentage",
  financing: "the financing assumptions",
  "financing.ltv": "the financing LTV",
  "financing.rate": "the financing interest rate",
  "financing.points": "the financing points",
  assignmentMode: "the assignment mode",
};

const DEAL_ECONOMICS_NEUTRAL_FALLBACK = {
  question: "Is there anything still missing before underwriting can calculate this deal?",
  whyItMatters: "Underwriting cannot produce a supported offer until every required input resolves.",
};

/**
 * Diagnoses the deal_economics category from B8-03's OWN reported cause
 * -- never a guess. Three cases, in order of how much B8-03 lets us say
 * safely:
 *
 *   1. UNKNOWN, and `missing` is ONLY arv and/or repairs: Gate 1 really
 *      is the cause, so the question names them specifically.
 *   2. UNKNOWN, and `missing` names anything else (alone or mixed with
 *      arv/repairs): named precisely from `missing` via
 *      MISSING_INPUT_LABEL, and the question never claims ARV/repairs
 *      ARE on file -- a mixed case could still be missing one of them.
 *   3. PRELIMINARY (Max calculated, Target not): quotes B8-03's own
 *      `target.reason` string directly rather than hardcoding the one
 *      cause that happens to be the only one today.
 */
function dealEconomicsDiagnosis(dealEconomics: Board8Economics): { question: string; whyItMatters: string } {
  if (dealEconomics.status === "unavailable") {
    const missing = dealEconomics.missing;
    if (missing.length === 0) return DEAL_ECONOMICS_NEUTRAL_FALLBACK;

    const onlyGate1 = missing.every((m) => m === "arv" || m === "repairs");
    if (onlyGate1) {
      const hasArv = missing.includes("arv");
      const hasRepairs = missing.includes("repairs");
      return {
        question:
          hasArv && hasRepairs
            ? "Has a current ARV and repair estimate been established for this property yet?"
            : hasArv
              ? "Has a current ARV been established for this property yet?"
              : "Has a repair estimate been established for this property yet?",
        whyItMatters: "PB-D56 Gate 1: without ARV and repairs on file, no economics exist yet to negotiate from at all.",
      };
    }

    // At least one non-Gate-1 input is unresolved. Named truthfully from
    // `missing` itself; never asserts ARV/repairs status either way.
    const labels = missing.map((m) => MISSING_INPUT_LABEL[m] ?? m);
    return {
      question: `Underwriting is still missing ${labels.join(", ")} — is that information available?`,
      whyItMatters: "Underwriting cannot calculate Target Acquisition Price or Max Supported Offer until every required assumption resolves, not only ARV and repairs.",
    };
  }

  if (dealEconomics.status === "calculated" && dealEconomics.target.status === "unavailable") {
    const reason = dealEconomics.target.reason;
    return {
      question: `Max Supported Offer is calculated, but Target Acquisition Price is not (${reason}) — is that information available?`,
      whyItMatters: `Target Acquisition Price is not yet calculable: ${reason}.`,
    };
  }

  // Structurally unreachable when the deal_economics category itself is
  // UNKNOWN or PRELIMINARY (see dealEconomicsCategoryLevel in
  // offer-readiness.ts) -- kept explicit rather than assumed, so a
  // future change to that derivation fails loudly here instead of
  // silently returning a stale diagnosis.
  return DEAL_ECONOMICS_NEUTRAL_FALLBACK;
}

/** One resolved question, as `enumerateQuestions` produces it -- the "question" variant of `NextBestQuestion`, never "offer_ready". */
type QuestionEntry = Extract<NextBestQuestion, { kind: "question" }>;

/**
 * Enumerates EVERY still-open question, in the exact priority order the
 * module header describes -- material unknowns (caller-supplied order),
 * then UNKNOWN categories (`CATEGORY_PRIORITY` order), then PRELIMINARY
 * categories (same order). This is the ONE place that priority is decided;
 * `computeNextBestQuestion` (its first entry) and `computeQuestionQueue`
 * (B8-12 / INV-55 -- the full list, for "Other Useful Questions") both read
 * it rather than each re-deriving their own ordering, so the two can never
 * disagree about which question is "next."
 */
function enumerateQuestions(
  readiness: ReadinessResult,
  known: KnownFactsSnapshot,
  dealEconomics: Board8Economics,
): QuestionEntry[] {
  const out: QuestionEntry[] = [];

  // Tier 1a: material unknowns, in the order they were supplied.
  for (const r of readiness.reasons) {
    if (r.kind !== "material_unknown") continue;
    out.push({
      kind: "question",
      source: { kind: "material_unknown", unknownCode: r.unknownCode },
      audience: audienceFor({ kind: "material_unknown" }),
      question: materialUnknownQuestionText(r),
      whyItMatters:
        "This is exactly the kind of fact the Offer Ready contract names as able to significantly change the supported offer — it comes before any other underwriting question.",
    });
  }

  // Tier 1b: UNKNOWN categories, in CATEGORY_PRIORITY order.
  for (const category of CATEGORY_PRIORITY) {
    if (readiness.categories[category] !== "UNKNOWN") continue;
    if (category === "deal_economics") {
      out.push({ kind: "question", source: { kind: "category", category, level: "UNKNOWN" }, audience: audienceFor({ kind: "category", category }), ...dealEconomicsDiagnosis(dealEconomics) });
    } else {
      out.push({
        kind: "question",
        source: { kind: "category", category, level: "UNKNOWN" },
        audience: audienceFor({ kind: "category", category }),
        question: categoryQuestionText(category, "UNKNOWN", known),
        whyItMatters: WHY_IT_MATTERS[category],
      });
    }
  }

  // Tier 2: PRELIMINARY categories, same order.
  for (const category of CATEGORY_PRIORITY) {
    if (readiness.categories[category] !== "PRELIMINARY") continue;
    if (category === "deal_economics") {
      out.push({ kind: "question", source: { kind: "category", category, level: "PRELIMINARY" }, audience: audienceFor({ kind: "category", category }), ...dealEconomicsDiagnosis(dealEconomics) });
    } else {
      out.push({
        kind: "question",
        source: { kind: "category", category, level: "PRELIMINARY" },
        audience: audienceFor({ kind: "category", category }),
        question: categoryQuestionText(category, "PRELIMINARY", known),
        whyItMatters: WHY_IT_MATTERS[category],
      });
    }
  }

  return out;
}

const OFFER_READY: NextBestQuestion = {
  kind: "offer_ready",
  message: "Offer Ready — no further underwriting question. Move to presenting the offer.",
};

const OPERATOR_ONLY: NextBestQuestion = {
  kind: "operator_only",
  message: "No more questions for the seller right now. What's still open is underwriting work for you — see your checklist below.",
};

/**
 * Selects the single Next Best Question from a `ReadinessResult` B8-04
 * already computed and the `Board8Economics` B8-03 already computed,
 * plus the raw facts already on file so the question can acknowledge
 * them instead of re-asking from zero.
 */
export function computeNextBestQuestion(
  readiness: ReadinessResult,
  known: KnownFactsSnapshot,
  dealEconomics: Board8Economics,
): NextBestQuestion {
  if (readiness.effectiveStatus === "OFFER_READY") return OFFER_READY;

  const queue = enumerateQuestions(readiness, known, dealEconomics);
  // F34: the Suggested Next Question is the first SELLER item. When only
  // operator items remain, say so rather than reading one to the seller.
  const firstSeller = queue.find((q) => q.audience === "seller");
  if (firstSeller) return firstSeller;
  if (queue.length > 0) return OPERATOR_ONLY;
  // Structurally unreachable while effectiveStatus and status share
  // computeOfferReadiness's own aggregation rule: no material unknown, no
  // UNKNOWN category and no PRELIMINARY category means every category is
  // SUPPORTED, which is exactly OFFER_READY and already returned above.
  // Kept explicit rather than a non-null assertion, so a future change to
  // that aggregation rule fails loudly here instead of throwing.
  return OFFER_READY;
}

/**
 * B8-12 / INV-55 -- every OTHER open question beyond the Next Best
 * Question, in the same priority order, for the "Other Useful Questions"
 * list. Empty exactly when `computeNextBestQuestion` returns "offer_ready"
 * or there was only ever one open question; never recomputes readiness or
 * reorders anything `enumerateQuestions` did not already decide.
 */
export function computeQuestionQueue(
  readiness: ReadinessResult,
  known: KnownFactsSnapshot,
  dealEconomics: Board8Economics,
): QuestionEntry[] {
  if (readiness.effectiveStatus === "OFFER_READY") return [];
  // F34: seller items only; operator items are computeOperatorChecklist's.
  return enumerateQuestions(readiness, known, dealEconomics).filter((q) => q.audience === "seller");
}

/**
 * Board 15 / Pass 1 F34 -- the underwriting items that are Brad's own work
 * (ARV, deal economics incl. assignment mode), in the same priority order.
 * Shown as the operator's checklist, never as a question for the seller.
 */
export function computeOperatorChecklist(
  readiness: ReadinessResult,
  known: KnownFactsSnapshot,
  dealEconomics: Board8Economics,
): QuestionEntry[] {
  if (readiness.effectiveStatus === "OFFER_READY") return [];
  return enumerateQuestions(readiness, known, dealEconomics).filter((q) => q.audience === "operator");
}
