/**
 * Brad-approved seller call script content -- B8-12 / INV-55, extended by
 * INV-69 (Seller Call Script V1, content approved 2026-09-08).
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
 *
 * INV-69 addition (bounded consolidation, this file remains the ONE content
 * source): `NEGOTIATION_LINES`, `GLOBAL_CONVERSATION_TOOLS`, and
 * `FINAL_PRINCIPLES` below are copied VERBATIM from INV-69's locked content
 * framework. INV-69's own acceptance text is explicit -- "Do not invent
 * approval for any missing spoken wording" -- so `NEGOTIATION_LINES` is the
 * ONLY "If Seller Says..." content in this file: INV-69 names exactly two
 * such lines, both scoped to the Offer stage (a seller asking Brad to come
 * up, and a seller naming a counter), and no other stage has approved
 * "If Seller Says..." wording to add. This module does not decide when a
 * negotiation line should surface as a live suggestion -- that trigger
 * condition is not specified by INV-69 and is not invented here; these
 * lines are reference content for the Full Script drawer only, exactly as
 * `NEGOTIATION_LINES`'s own siblings above already are.
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

/**
 * INV-69, "Exact negotiation wording" -- copied verbatim, scoped to the
 * Offer stage ("Negotiation belongs inside Offer"). Each entry names the
 * seller's side of the exchange and Brad's exact approved response; neither
 * side is generated or paraphrased. `sellerSays` is a description of the
 * triggering moment (not a script line Brad speaks), matching INV-69's own
 * "Seller asks us to come up:" / "Seller gives a counter:" framing.
 */
export type NegotiationLine = { stage: "offer"; sellerSays: string; say: string };

export const NEGOTIATION_LINES: readonly NegotiationLine[] = [
  {
    stage: "offer",
    sellerSays: "Seller asks us to come up",
    say: "Before I revisit the numbers, where would we need to land for you to feel comfortable moving forward?",
  },
  {
    stage: "offer",
    sellerSays: "Seller gives a counter",
    say: "So [counteroffer] is the price you’d feel comfortable moving forward at, assuming we agree on the other terms?",
  },
];

/**
 * INV-69, "Global Conversation Tools" -- copied verbatim. Not scoped to any
 * single stage; INV-69's own framing is "available globally in the
 * reference library".
 */
export const GLOBAL_CONVERSATION_TOOLS: readonly string[] = [
  "Tell me a little more about that.",
  "What do you mean by that?",
  "How long has that been going on?",
  "What would that look like for you?",
  "What makes that important?",
  "Help me understand that.",
  "What else should I know?",
  "Okay, that makes sense.",
];

/**
 * INV-69, "Final principles -- preserve verbatim". Operator-facing
 * reminders, not spoken lines; preserved here as the one content source
 * INV-69 requires, and offered in the Full Script drawer as reference
 * alongside the script content they govern.
 */
export const FINAL_PRINCIPLES: readonly string[] = [
  "Never ask a question just because it’s next in the script. Listen first. If the seller already answered it, move on.",
  "The script guides the conversation. MSK determines what information matters.",
  "Suggested does not mean required. Brad controls what he actually says.",
  "Answered / Captured / Supported describe different concepts and do not create new readiness states.",
  "Only actual proposed offers and confirmed terms may appear in seller-facing language. Target and Max are internal numbers.",
  "Within Max does not mean we should pay Max.",
  "IAOS never implies an offer increase, acceptance, or commitment until Brad explicitly makes it.",
  "Every call should end with a clear operator-recorded outcome or next action.",
];
