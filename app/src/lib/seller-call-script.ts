/**
 * Brad-approved seller call script content -- B8-12 / INV-55.
 *
 * Pure data + pure lookup. No I/O, no React, no persistence. Every question
 * string here is copied VERBATIM from Brad's approved script as recorded in
 * INV-55's locked usability correction (2026-09-07) -- this module invents
 * no new sales methodology and no new wording of its own. It organizes
 * those exact lines by conversation stage (the ticket's own
 * Connect -> Situation -> Property -> Condition -> Price -> Offer -> Outcome
 * model) for the Full Script drawer.
 *
 * NOT EVERY APPROVED LINE MAPS TO A B8-04 MaterialCategory. Ownership,
 * decision-makers, occupancy, complications, and closing timing are real,
 * valuable conversation content, but none of them corresponds to one of
 * B8-04's six material categories or to any fact IAOS currently tracks as
 * structured evidence. Wiring them into MSK-driven Next Best Question
 * selection would invent new tracked facts this ticket does not authorize
 * (INV-55's B8 boundary: "Question changes are driven by facts recorded
 * through the existing structured Seller Call/MSK workflow"). Those lines
 * live ONLY in the Full Script drawer, exactly as the ticket allows
 * ("the Full Script drawer may expose all stages for training or
 * reference"). `APPROVED_SCRIPT_FOR_COLD_CATEGORY` below is the one place
 * a subset of these lines feeds the LIVE Next Best Question / Other Useful
 * Questions surfacing, and only for the three categories where the mapping
 * is unambiguous.
 */

export type ScriptStage =
  | "connect"
  | "situation"
  | "property"
  | "condition"
  | "price"
  | "offer"
  | "outcome";

export const SCRIPT_STAGE_ORDER: readonly ScriptStage[] = [
  "connect",
  "situation",
  "property",
  "condition",
  "price",
  "offer",
  "outcome",
];

export const SCRIPT_STAGE_LABEL: Record<ScriptStage, string> = {
  connect: "Connect",
  situation: "Situation",
  property: "Property",
  condition: "Condition",
  price: "Price",
  offer: "Offer",
  outcome: "Outcome",
};

export type ScriptLine = { stage: ScriptStage; text: string };

/**
 * Brad's approved script questions, copied verbatim from INV-55's locked
 * usability correction, "Example question decomposition". Order within a
 * stage is the order the ticket lists them in; it carries no additional
 * meaning.
 */
export const APPROVED_SCRIPT_LINES: readonly ScriptLine[] = [
  { stage: "property", text: "Just so I'm looking at the right place, can I confirm the property address?" },
  { stage: "situation", text: "And are you the owner of the property?" },
  { stage: "situation", text: "Is anyone else involved in deciding whether to sell?" },
  { stage: "property", text: "Is anyone currently living in or renting the property?" },
  { stage: "property", text: "Is there anything with the property or ownership that you think could complicate a sale?" },
  { stage: "condition", text: "Can you walk me through what you think the property needs?" },
  { stage: "price", text: "What price were you hoping to receive?" },
  { stage: "outcome", text: "If we agree on price and terms, what timing would work best for you?" },
];

/** Every approved line, grouped by stage, in `SCRIPT_STAGE_ORDER`. For the Full Script drawer. */
export function scriptLinesByStage(): { stage: ScriptStage; label: string; lines: readonly ScriptLine[] }[] {
  return SCRIPT_STAGE_ORDER.map((stage) => ({
    stage,
    label: SCRIPT_STAGE_LABEL[stage],
    lines: APPROVED_SCRIPT_LINES.filter((l) => l.stage === stage),
  }));
}

/**
 * Bounded overlay onto B8-04's `MaterialCategory`: the ONE approved line to
 * prefer when that category is truly cold (UNKNOWN, no raw value on file
 * yet -- see `next-best-question.ts`'s own use of this for exactly which
 * branch). Deliberately partial: `arv`, `deal_economics`, and
 * `transaction_assumptions` have no approved-script equivalent (they are
 * underwriting/back-office questions, not seller-facing script lines), and
 * are left to the engine's own derived phrasing -- deliberately absent as
 * keys here, not merely `undefined`, so a caller cannot look one up by
 * accident. Every value here is asserted (in `test-next-best-question.cjs`)
 * to be a verbatim member of `APPROVED_SCRIPT_LINES`, so the two can never
 * silently drift apart.
 */
export const APPROVED_SCRIPT_FOR_COLD_CATEGORY: Readonly<
  Record<"property_identity" | "repairs_condition" | "seller_price_position", string>
> = {
  property_identity: "Just so I'm looking at the right place, can I confirm the property address?",
  repairs_condition: "Can you walk me through what you think the property needs?",
  seller_price_position: "What price were you hoping to receive?",
};
