/**
 * Offer Readiness + evidence/trust state engine -- B8-04 / INV-47.
 *
 * Pure. No I/O, no GHL identifiers, no React, no writes, no persistence.
 * This module answers a different question than `board8-economics.ts`:
 * that module asks "what does the math say," this one asks "do we know
 * enough to responsibly negotiate from what the math says" --
 * `docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`'s "calculated vs actionable"
 * distinction, made concrete. It CONSUMES `Board8Economics`; it never
 * recomputes Target Acquisition Price, Max Supported Offer, or Expected
 * Spread, and it invents no second economics engine.
 *
 * THE SIX MATERIAL CATEGORIES, per INV-44's Offer Ready minimum contract
 * (`DEAL_ECONOMICS_OFFER_READINESS_V1.md` lines 198-227) and restated in
 * INV-47's own scope: property identity/core facts, repairs/condition,
 * ARV, deal economics, transaction/deal-structure assumptions, and seller
 * price position. Every category resolves to exactly one evidence level:
 *
 *     UNKNOWN -> PRELIMINARY -> SUPPORTED
 *
 * WHERE EACH CATEGORY'S LEVEL COMES FROM -- stated per category because
 * the determination mechanism is NOT uniformly decided (B8-02 item 7
 * remains an open product decision for five of the six):
 *
 *   - ARV: derived automatically via `mapArvEvidenceToBoard8`, because
 *     Brad's 2026-09-05 amendment locks that specific mapping
 *     (HIGH/MODERATE -> SUPPORTED, LOW -> PRELIMINARY,
 *     INSUFFICIENT -> UNKNOWN). This is the one category with an
 *     authoritative determination mechanism today.
 *
 *   - Deal economics: derived automatically from the `Board8Economics`
 *     the caller passes in, per this module's own reading of its status
 *     (below) -- not a judgment about deal quality, only about whether
 *     B8-03's engine could resolve the math at all. This requires no new
 *     policy: it restates a fact `board8-economics.ts` already computed.
 *
 *   - Property identity, repairs/condition, transaction assumptions, and
 *     seller price position: supplied directly by the caller as a
 *     `Board8EvidenceLevel`. B8-02 item 7 leaves the determination
 *     mechanism for these four -- rep judgment, a derived completeness
 *     check, or a hybrid -- as an UNRESOLVED PRODUCT DECISION, and per
 *     FOUNDATIONAL_PRINCIPLES principle 19 this module does not
 *     manufacture one. It aggregates whatever it is given; it does not
 *     decide how that evidence level was established.
 *
 * MATERIAL UNKNOWNS are a caller-supplied list, never a fixed checklist
 * this engine invents. `motivation`, `timeline`, `mortgage balance`,
 * `title status`, and every other seller-discovery fact are NOT hardcoded
 * blockers here -- the INV-47 HARD NO forbids exactly that. A fact only
 * blocks Offer Ready when a caller explicitly names it as material.
 *
 * APPROVED and OVERRIDDEN are human actions, not evidence levels
 * (`DEAL_ECONOMICS_OFFER_READINESS_V1.md` lines 266-285). `HumanAction`
 * is a separate field on the result, never folded into `status` or the
 * category evidence levels -- `effectiveStatus` is the one place the two
 * axes combine, and `status`/`reasons` remain visible and unchanged
 * alongside it so a human override is always shown next to what it
 * overrode, never in place of it. THIS MODULE PERSISTS NOTHING: no
 * Offer Ready carrier is authorized (B8-02's finding on Part A/B
 * "Approval/override provenance" leaves this an unresolved product
 * decision), so `HumanAction` is an in-memory input this module reads,
 * never a write this module performs.
 */

import type { Board8Economics, Board8EvidenceLevel } from "./board8-economics";
import { mapArvEvidenceToBoard8 } from "./board8-economics";
import type { ArvEvidenceState } from "../arv-reconciliation";

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export type MaterialCategory =
  | "property_identity"
  | "repairs_condition"
  | "arv"
  | "deal_economics"
  | "transaction_assumptions"
  | "seller_price_position";

/** Every reason names which category it is and what level blocked it. */
export type CategoryReason = {
  kind: "category";
  category: MaterialCategory;
  level: "UNKNOWN" | "PRELIMINARY";
  code: string;
  message: string;
};

/**
 * A caller-flagged material unknown -- never invented by this engine.
 * `code` is the caller's own short identifier (e.g. "TITLE_DISPUTE");
 * this module assigns no meaning to its value beyond carrying it through
 * to the reason it produces.
 */
export type MaterialUnknown = {
  code: string;
  description: string;
};

export type MaterialUnknownReason = {
  kind: "material_unknown";
  unknownCode: string;
  code: "MATERIAL_UNKNOWN";
  message: string;
};

export type ReadinessReason = CategoryReason | MaterialUnknownReason;

/* ------------------------------------------------------------------ */
/* Human actions -- a separate axis from evidence quality               */
/* ------------------------------------------------------------------ */

/**
 * APPROVED: a human accepts the evidence, as it stands, is sufficient to
 * act on. OVERRIDDEN: a human proceeds despite the evidence not reaching
 * SUPPORTED. Both are permitted from any computed `status` -- consistent
 * with PB-D56's established "flagged, never blocked" pattern for
 * out-of-parameters decisions. Neither is persisted by this module.
 */
export type HumanAction =
  | { kind: "none" }
  | { kind: "approved"; at: string; operator: string; reason?: string }
  | { kind: "overridden"; at: string; operator: string; reason: string };

/* ------------------------------------------------------------------ */
/* Inputs                                                               */
/* ------------------------------------------------------------------ */

export type OfferReadinessInputs = {
  propertyIdentity: Board8EvidenceLevel;
  repairsCondition: Board8EvidenceLevel;
  /** null = ARV has not been run/established at all. */
  arv: ArvEvidenceState | null;
  transactionAssumptions: Board8EvidenceLevel;
  sellerPricePosition: Board8EvidenceLevel;
  /** Consumed, never recomputed -- B8-03's own output. */
  dealEconomics: Board8Economics;
  materialUnknowns: MaterialUnknown[];
  humanAction: HumanAction;
};

/* ------------------------------------------------------------------ */
/* Result                                                               */
/* ------------------------------------------------------------------ */

export type ReadinessStatus = "NOT_READY" | "REVIEW_NEEDED" | "OFFER_READY";

export type ReadinessResult = {
  /**
   * The OBJECTIVE, computed status from evidence alone. Never altered by
   * `humanAction` -- see `effectiveStatus` for the combined view.
   */
  status: ReadinessStatus;
  /** Every category not at SUPPORTED, plus every material unknown. Empty exactly when status is OFFER_READY and no material unknown was supplied. */
  reasons: ReadinessReason[];
  /** Full per-category evidence snapshot, for audit/display. */
  categories: Record<MaterialCategory, Board8EvidenceLevel>;
  /** The human action supplied, carried through unchanged. */
  humanAction: HumanAction;
  /**
   * `status`, unless a human APPROVED or OVERRIDDEN action is present, in
   * which case OFFER_READY. This is the ONLY field a downstream "can I
   * negotiate now" check should read; `status` and `reasons` stay visible
   * beside it so an override is always shown next to what it overrode.
   */
  effectiveStatus: ReadinessStatus;
};

/* ------------------------------------------------------------------ */
/* Category evidence derivation                                        */
/* ------------------------------------------------------------------ */

function arvCategoryLevel(arv: ArvEvidenceState | null): Board8EvidenceLevel {
  return arv === null ? "UNKNOWN" : mapArvEvidenceToBoard8(arv);
}

/**
 * Deal economics category level, derived from B8-03's own status --
 * never a recomputation. UNKNOWN when the underlying underwriting has
 * not resolved (Gate 1 or an assumption is missing); PRELIMINARY when it
 * resolved but Target Acquisition Price could not (the one synthetic
 * case documented in `board8-economics.ts`); SUPPORTED when both Max
 * Supported Offer and Target Acquisition Price are calculated.
 */
function dealEconomicsCategoryLevel(econ: Board8Economics): Board8EvidenceLevel {
  if (econ.status === "unavailable") return "UNKNOWN";
  if (econ.target.status === "unavailable") return "PRELIMINARY";
  return "SUPPORTED";
}

const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  property_identity: "Property identity",
  repairs_condition: "Repairs/condition",
  arv: "ARV",
  deal_economics: "Deal economics",
  transaction_assumptions: "Transaction/deal-structure assumptions",
  seller_price_position: "Seller price position",
};

function categoryReason(category: MaterialCategory, level: Board8EvidenceLevel): CategoryReason | null {
  if (level === "SUPPORTED") return null;
  const label = CATEGORY_LABEL[category];
  return {
    kind: "category",
    category,
    level,
    code: `${category.toUpperCase()}_${level}`,
    message:
      level === "UNKNOWN"
        ? `${label} is UNKNOWN -- nothing has been established yet.`
        : `${label} is PRELIMINARY -- a working answer exists but is not yet defensible.`,
  };
}

function materialUnknownReason(u: MaterialUnknown): MaterialUnknownReason {
  return {
    kind: "material_unknown",
    unknownCode: u.code,
    code: "MATERIAL_UNKNOWN",
    message: `Unresolved material unknown (${u.code}): ${u.description}`,
  };
}

/* ------------------------------------------------------------------ */
/* The engine                                                           */
/* ------------------------------------------------------------------ */

/**
 * Computes Offer Readiness live from current, deterministic evidence.
 * Called fresh whenever an input changes -- there is no persisted
 * readiness snapshot for this function to go stale against, so a new
 * material fact revokes a prior OFFER_READY simply by producing a
 * different result on the next call. Nothing here is cached or mutated.
 */
export function computeOfferReadiness(inputs: OfferReadinessInputs): ReadinessResult {
  const categories: Record<MaterialCategory, Board8EvidenceLevel> = {
    property_identity: inputs.propertyIdentity,
    repairs_condition: inputs.repairsCondition,
    arv: arvCategoryLevel(inputs.arv),
    deal_economics: dealEconomicsCategoryLevel(inputs.dealEconomics),
    transaction_assumptions: inputs.transactionAssumptions,
    seller_price_position: inputs.sellerPricePosition,
  };

  const reasons: ReadinessReason[] = [];
  let anyUnknown = false;
  let anyPreliminary = false;

  (Object.keys(categories) as MaterialCategory[]).forEach((category) => {
    const level = categories[category];
    if (level === "UNKNOWN") anyUnknown = true;
    else if (level === "PRELIMINARY") anyPreliminary = true;
    const reason = categoryReason(category, level);
    if (reason) reasons.push(reason);
  });

  // Material unknowns are never invented -- only what the caller flagged.
  // Any one of them blocks Offer Ready outright: by definition ("could
  // significantly change the supported offer") this is a stronger
  // condition than a category merely being PRELIMINARY.
  for (const u of inputs.materialUnknowns) {
    reasons.push(materialUnknownReason(u));
  }
  const hasMaterialUnknown = inputs.materialUnknowns.length > 0;

  let status: ReadinessStatus;
  if (hasMaterialUnknown || anyUnknown) {
    status = "NOT_READY";
  } else if (anyPreliminary) {
    status = "REVIEW_NEEDED";
  } else {
    status = "OFFER_READY";
  }

  const effectiveStatus: ReadinessStatus =
    inputs.humanAction.kind === "approved" || inputs.humanAction.kind === "overridden"
      ? "OFFER_READY"
      : status;

  return {
    status,
    reasons,
    categories,
    humanAction: inputs.humanAction,
    effectiveStatus,
  };
}
