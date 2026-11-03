/**
 * B15-03 / INV-103 -- Revision 6 guided seller conversation, slices 1-2
 * (Captain GO 2026-11-02; plan Boards\B15-03\REV6_FINAL_INTEGRATION_PLAN_JEFF_20261102).
 *
 * Pure: data and lookups only. No React, no I/O, no GHL identifiers, no writes.
 *
 * WORDING IS DATA. Every spoken line, transition and follow-up lives in
 * OPENINGS / QUESTIONS below and nowhere else. The navigator, the answer
 * controls, the drafts and the on-record projection read only the stable
 * ids, `fields` and `onRecord` keys -- never the wording -- so a copy change
 * is an edit to `say` / `then` / `followUps` alone.
 *
 * SOURCE IS SHOWN, NOT SILENTLY PROMOTED. Each line carries `source`:
 *   - "rev6-settled": Revision 6 wording W1-W6, settled 2026-10-15
 *     (IAOS_REV6_INTEGRATION_PLAN_AMENDMENT_2 section 0 / H.3);
 *   - "rev6-candidate": Revision 6 wording used as the initial hosted-Test
 *     candidate by Captain ruling 2026-11-02; not yet approved word-for-word.
 * The eight previously approved lines stay, unchanged, in
 * `seller-call-script.ts` (the Full Script reference). This module does not
 * import, edit or replace them.
 *
 * Text is copied verbatim from the Revision 6 prototype
 * (IAOS-Seller-Conversation-Revision-6.html, sha256 ae25ea02...), including
 * its final question order and its Price override (R6:87-88). Removed by the
 * 2026-10-15 ruling and therefore absent here: the permission and interest
 * controls and the "If interested:" cue.
 *
 * NEVER BLOCKING. Nothing here makes an answer a precondition for anything.
 * A question nobody answered is "unanswered": never zero, false, None or
 * an assumed value.
 */

export type ScriptSource = "rev6-settled" | "rev6-candidate";
export const SOURCE_LABEL: Record<ScriptSource, string> = {
  "rev6-settled": "Rev 6 wording (settled 2026-10-15)",
  "rev6-candidate": "Rev 6 Test candidate (Captain to review)",
};

export type OpeningId = "cold" | "inbound" | "follow_up";
export type Opening = { id: OpeningId; label: string; say: string; source: ScriptSource };

/** `{firstName}` and `{street}` are filled by `fillLine`; an unknown value stays a visible placeholder. */
export const OPENINGS: readonly Opening[] = [
  { id: "cold", label: "Cold Outreach", source: "rev6-candidate",
    say: "Hey {firstName}, this is Brad Thompson. I'm a real estate investor calling about your property on {street}. Have you ever considered selling it?" },
  { id: "inbound", label: "Inbound Inquiry", source: "rev6-candidate",
    say: "Hey {firstName}, this is Brad Thompson. I'm following up on your inquiry about selling your property on {street}. What are you hoping to accomplish with the sale?" },
  { id: "follow_up", label: "Follow-up", source: "rev6-candidate",
    say: "Hey {firstName}, this is Brad Thompson. We spoke about your property on {street}, and I'm following up on our conversation. What's changed since we last talked?" },
];
/** Shown after any opening (Rev 6 transition, without the removed "If interested:" condition). */
export const OPENING_THEN = { say: "If everything worked out exactly the way you’d want, what would that look like for you?", source: "rev6-candidate" as ScriptSource };

/** Stable answer-entry kinds. Changing wording never changes these. */
export type ControlKind = "text" | "textarea" | "date" | "money" | "choice";
export type AnswerField = { id: string; label: string; kind: ControlKind; options?: readonly string[]; hint?: string };

export type QuestionId =
  | "opening" | "address" | "ownership" | "occupancy" | "reason"
  | "timing" | "price" | "asis" | "condition" | "summary";

/** Keys of the existing read projections a question can show (see `onRecordFor`). */
export type OnRecordKey = "address" | "complications" | "occupancy" | "timing" | "price" | "condition" | "summary";

export type Question = {
  id: QuestionId;
  title: string;
  /** The spoken line; for "opening" the selected Opening is spoken instead. */
  say: string;
  /** "After listening" transition, when Rev 6 has one. */
  then: string | null;
  followUps: readonly string[];
  source: ScriptSource;
  fields: readonly AnswerField[];
  onRecord: OnRecordKey | null;
};

/** The exact three values `contact.occupancy` permits (INV95); Rev 6's "Other" is not one of them. */
export const OCCUPANCY_CHOICES = ["Owner Occupied", "Tenant Occupied", "Vacant"] as const;

/** Rev 6 final order (prototype re-sort): Opening, then nine questions. */
export const QUESTIONS: readonly Question[] = [
  { id: "opening", title: "Opening", say: "", then: null, source: "rev6-candidate", onRecord: null,
    followUps: ["Confirm you’re speaking with the right person. If they are not interested or request no further contact, end respectfully and follow the existing contact-preference workflow."],
    fields: [{ id: "response", label: "Response / context", kind: "textarea" }] },
  { id: "address", title: "Property address", source: "rev6-settled", onRecord: "address",
    say: "Just to make sure I’m looking at the right property, can I confirm the address?", then: null,
    followUps: ["Check a unit or apartment when relevant. Formatting alone does not prove property identity."],
    fields: [{ id: "note", label: "What the seller said about the address (unit, differences)", kind: "textarea" }] },
  { id: "ownership", title: "Ownership & decision-makers", source: "rev6-settled", onRecord: "complications",
    say: "Just so I understand the situation, is the property owned in your name, or is anyone else involved in making the decision to sell?",
    then: "Would it make sense to include them in the next conversation so everybody has the same information?",
    followUps: [
      "Individual, joint, entity-held, inherited or trust-held?",
      "Is probate or another legal process involved?",
      "Is there anything with the property or ownership that you think could complicate a sale?",
      "Verbal statements do not establish authority to sell.",
    ],
    fields: [
      { id: "owners", label: "Reported owners / decision-makers", kind: "textarea" },
      { id: "questions", label: "Representation / title questions", kind: "textarea" },
    ] },
  { id: "occupancy", title: "Occupancy", source: "rev6-settled", onRecord: "occupancy",
    say: "Is anyone living in the property right now, or is it vacant?",
    then: "Is there anything about the living situation or lease that we should take into account?",
    followUps: [
      "If occupied: Is that you living there, or do you have tenants?",
      "Ask about lease arrangements, move-out preferences, or utilities as relevant. Arrange access at the next-step discussion.",
    ],
    fields: [
      { id: "occupancy", label: "Occupancy", kind: "choice", options: OCCUPANCY_CHOICES },
      { id: "lease", label: "Occupancy / lease / move-out notes", kind: "textarea" },
    ] },
  { id: "reason", title: "Reason for selling", source: "rev6-candidate", onRecord: null,
    say: "Can you tell me the reason for wanting to move or sell?",
    then: "Got it. And ideally, what would you like to see happen with the property?",
    followUps: [
      "How long have you been considering selling?",
      "Have you looked at any other options?",
      "What’s most important to you — price, timing, convenience, or something else?",
      "What happens if you decide to keep it for now?",
    ],
    fields: [
      { id: "reason", label: "Reason for considering a sale", kind: "textarea" },
      { id: "outcome", label: "Desired outcome / priorities", kind: "textarea" },
    ] },
  { id: "timing", title: "Timing", source: "rev6-settled", onRecord: "timing",
    say: "If everything worked out the way you’d want, when would you like to have the property sold?",
    then: "Is there a particular reason for that timing, or do you have some flexibility?",
    followUps: ["Would you need time after closing to move?", "Is there anything that might delay a sale?"],
    fields: [
      { id: "date", label: "Specific date, if known", kind: "date" },
      { id: "flexibility", label: "Flexibility / dependencies", kind: "textarea" },
    ] },
  { id: "price", title: "Price expectations", source: "rev6-settled", onRecord: "price",
    say: "What price were you hoping to get for the property?",
    then: "And how did you arrive at that number?",
    followUps: [
      "Are you assuming you’d make repairs, or would you prefer to sell it in its current condition?",
      "Have you received other offers or spoken with an agent?",
      "Besides price, are there terms that would make a sale more workable?",
      "An asking price does not authorize an offer.",
    ],
    fields: [
      { id: "amount", label: "Seller's stated price ($)", kind: "money", hint: "What the seller said. Not an offer, and not saved over the asking price." },
      { id: "basis", label: "Basis / as-is expectations", kind: "textarea" },
    ] },
  { id: "asis", title: "As-is sale fit", source: "rev6-candidate", onRecord: null,
    say: "If you could sell without making repairs, leave behind what you don’t want, and work toward a closing date that fits your plans, is that something you’d consider?",
    then: null,
    followUps: [
      "Which part of that would matter most to you?",
      "What would you need to feel comfortable exploring that option?",
      "Continue into condition, clarify their priorities, or go directly to Summary & next step. Your choice; no automatic rejection.",
      "These are possibilities to explore, not approved offer or possession terms.",
    ],
    fields: [{ id: "priorities", label: "Terms / concerns to explore", kind: "textarea" }] },
  { id: "condition", title: "Condition & repairs", source: "rev6-settled", onRecord: "condition",
    say: "Tell me a little about the house. How would you describe its overall condition?",
    then: "Okay. And if somebody were going to buy it today, what do you think they’d need to fix or update?",
    followUps: [
      "Any plumbing, electrical, foundation, or water issues you’re aware of?",
      "Have you done any major updates recently?",
      "Is there anything else about its condition I should know?",
      "Seller estimates remain unverified for underwriting.",
    ],
    fields: [
      { id: "overall", label: "Overall condition (seller's words)", kind: "textarea" },
      { id: "repairs", label: "Repairs / updates the seller mentioned", kind: "textarea" },
    ] },
  { id: "summary", title: "Summary & next step", source: "rev6-candidate", onRecord: "summary",
    say: "Let me make sure I’ve got everything right. Did I understand your situation correctly?",
    then: "Thanks, that gives me a much better picture. I’d like to review the property information and see whether the numbers and terms could make sense. I don’t want to throw out a number without doing that homework.",
    followUps: [
      "If we decided to explore this further, what would be the best way to arrange a time to see the property?",
      "Would you be comfortable with me following up after I’ve had a chance to look everything over?",
      "Would a proposed day and time work for a quick follow-up?",
      "For an offer follow-up without approved terms: I haven’t settled on terms I’m ready to propose yet. Would it be alright if I followed up once I’ve completed my review?",
    ],
    fields: [
      { id: "next", label: "Agreed next step", kind: "textarea" },
      { id: "followup", label: "Proposed follow-up date", kind: "date" },
      { id: "objections", label: "Objections / concerns raised", kind: "textarea" },
    ] },
];

export const QUESTION_INDEX: Record<QuestionId, number> = Object.fromEntries(QUESTIONS.map((q, i) => [q.id, i])) as Record<QuestionId, number>;

/** Replaces {firstName}/{street}; a missing value stays visible as [first name] / [street] -- never guessed. */
export function fillLine(text: string, ctx: { firstName: string | null; street: string | null }): string {
  const first = ctx.firstName && ctx.firstName.trim() ? ctx.firstName.trim() : "[first name]";
  const street = ctx.street && ctx.street.trim() ? ctx.street.trim() : "[street]";
  return text.split("{firstName}").join(first).split("{street}").join(street);
}

/* ---------- drafts (in-session only; never sent anywhere) ---------- */

export type Mark = "skipped" | "seller_doesnt_know";
export type QuestionDraft = { fields: Readonly<Record<string, string>>; mark: Mark | null };
export type ConversationDraft = {
  opening: OpeningId;
  current: number;
  answers: Readonly<Partial<Record<QuestionId, QuestionDraft>>>;
  notes: string;
};
export const EMPTY_CONVERSATION: ConversationDraft = Object.freeze({ opening: "cold", current: 0, answers: Object.freeze({}), notes: "" }) as ConversationDraft;

/** Typing never clears a mark the operator set, and a mark never discards typed text. */
export function withField(d: ConversationDraft, q: QuestionId, field: string, value: string): ConversationDraft {
  const prev = d.answers[q] ?? { fields: {}, mark: null };
  return { ...d, answers: { ...d.answers, [q]: { fields: { ...prev.fields, [field]: value }, mark: prev.mark } } };
}
export function withMark(d: ConversationDraft, q: QuestionId, mark: Mark | null): ConversationDraft {
  const prev = d.answers[q] ?? { fields: {}, mark: null };
  return { ...d, answers: { ...d.answers, [q]: { fields: prev.fields, mark } } };
}
/** Moves are always allowed: any index in range, answered or not. */
export function moveTo(d: ConversationDraft, index: number): ConversationDraft {
  const i = Math.max(0, Math.min(QUESTIONS.length - 1, Math.trunc(index)));
  return i === d.current ? d : { ...d, current: i };
}

export function hasDraftText(a: QuestionDraft | undefined): boolean {
  return !!a && Object.values(a.fields).some((v) => v.trim() !== "");
}

/* ---------- status ---------- */

export type AnswerStatus = "draft" | "seller_doesnt_know" | "skipped" | "on_record" | "unanswered";
export const STATUS_LABEL: Record<AnswerStatus, string> = {
  draft: "Draft",
  seller_doesnt_know: "Seller doesn't know",
  skipped: "Skipped",
  on_record: "On Record",
  unanswered: "Unanswered",
};

/**
 * This call's state first (what Brad typed or marked), then what GHL holds.
 * The opening has no record of its own: it is answered only by this call's text.
 */
export function questionStatus(q: QuestionId, d: ConversationDraft, onRecord: OnRecord): AnswerStatus {
  const a = d.answers[q];
  if (hasDraftText(a)) return "draft";
  if (a?.mark === "seller_doesnt_know") return "seller_doesnt_know";
  if (a?.mark === "skipped") return "skipped";
  if ((onRecord[q] ?? []).length > 0) return "on_record";
  return "unanswered";
}

/** "Return to unanswered": the next Unanswered or Skipped question after `from`, wrapping; null when none is left. */
export function nextOpenQuestion(from: number, statuses: readonly AnswerStatus[]): number | null {
  const n = statuses.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (statuses[i] === "unanswered" || statuses[i] === "skipped") return i;
  }
  return null;
}

/* ---------- Summary recap (read-only; Bones P2-2) ---------- */

export type RecapRow = {
  id: QuestionId;
  title: string;
  status: AnswerStatus;
  /** What GHL holds for this deal (saved), each with its source. */
  saved: OnRecordItem[];
  /** What Brad typed on this page (NOT saved), by field label, verbatim. */
  draft: { label: string; value: string }[];
  mark: Mark | null;
};

/**
 * One row per question between the opening and the summary, in order. It only
 * re-presents what `onRecordFor` and the drafts already hold: saved items keep
 * their sources, draft text is shown verbatim and labelled unsaved, nothing is
 * inferred, formatted into a number, or merged across sources.
 */
export function recapFor(d: ConversationDraft, onRecord: OnRecord): RecapRow[] {
  return QUESTIONS.filter((q) => q.id !== "opening" && q.id !== "summary").map((q) => {
    const a = d.answers[q.id];
    return {
      id: q.id,
      title: q.title,
      status: questionStatus(q.id, d, onRecord),
      saved: [...(onRecord[q.id] ?? [])],
      draft: q.fields.flatMap((f) => {
        const v = a?.fields[f.id];
        return v !== undefined && v.trim() !== "" ? [{ label: f.label, value: v.trim() }] : [];
      }),
      mark: a?.mark ?? null,
    };
  });
}

/* ---------- guidance: the existing engine's pick, mapped (never re-derived) ---------- */

/** Engine category -> the seller question that gathers it. ARV and deal economics are Brad's research, not seller questions. */
export const QUESTION_FOR_CATEGORY: Readonly<Record<string, QuestionId | null>> = {
  property_identity: "address",
  repairs_condition: "condition",
  transaction_assumptions: "timing",
  seller_price_position: "price",
  arv: null,
  deal_economics: null,
};
export function recommendedQuestion(nbq: { kind: string; source?: { kind: string; category?: string } } | null): QuestionId | null {
  if (!nbq || nbq.kind !== "question" || !nbq.source || nbq.source.kind !== "category" || !nbq.source.category) return null;
  return QUESTION_FOR_CATEGORY[nbq.source.category] ?? null;
}

/* ---------- on-record projection (read-only; the existing parsers' results) ---------- */

export type OnRecordItem = { label: string; value: string; source: string };
export type OnRecord = Partial<Record<QuestionId, OnRecordItem[]>>;

type TaField = { kind: "value"; value: string } | { kind: "none" } | { kind: "unanswered" };
export type OnRecordInput = {
  /** The page's displayed address, or null when the contact has none. */
  address: string | null;
  /** The current property-identity confirmation for this deal (already stale-checked by the page). */
  identityConfirmedAt: string | null;
  /** contact.occupancy_status as read: a recognised value, empty, or an unrecognised raw value. */
  occupancy: { kind: "value"; value: string } | { kind: "empty" } | { kind: "unrecognised"; raw: string };
  /** Latest Transaction assumptions record for this deal (either version), or null. */
  transaction: { at: string; transactionStructure: TaField; closingPossession: TaField; titleComplications: TaField } | null;
  /** Latest Seller price position for this deal, or null. */
  sellerPrice: { at: string; kind: "price"; price: number } | { at: string; kind: "refused" } | null;
  /** Opportunity asking price (the resolved known fact), or null. */
  askingPrice: number | null;
  /** Resolved repairs figure and where it came from, or null. */
  repairs: { amount: number; provenance: string } | null;
  /** Latest bounded call outcome for this deal, or null. */
  outcome: { kind: "accept" | "follow_up" | "pass"; at: string; followUpAt: string | null } | null;
};

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const taText = (f: TaField): string | null => (f.kind === "value" ? f.value : f.kind === "none" ? "None (recorded)" : null);
const OUTCOME_TEXT = { accept: "Accept recorded", follow_up: "Follow-Up recorded", pass: "Pass recorded" } as const;

/** Every item names where it came from. Nothing is inferred, defaulted or merged across sources. */
export function onRecordFor(r: OnRecordInput): OnRecord {
  const out: OnRecord = {};
  const add = (q: QuestionId, item: OnRecordItem) => { (out[q] ??= []).push(item); };

  if (r.address) add("address", { label: "Address on the contact", value: r.address, source: "GHL contact address" });
  if (r.identityConfirmedAt) add("address", { label: "Property identity", value: "Confirmed for this deal", source: `Property identity note, ${day(r.identityConfirmedAt)}` });

  if (r.occupancy.kind === "value") add("occupancy", { label: "Occupancy", value: r.occupancy.value, source: "GHL contact Occupancy Status" });
  else if (r.occupancy.kind === "unrecognised") add("occupancy", { label: "Occupancy", value: `Unrecognised value "${r.occupancy.raw}"`, source: "GHL contact Occupancy Status" });

  if (r.transaction) {
    const src = `Transaction assumptions note, ${day(r.transaction.at)}`;
    const closing = taText(r.transaction.closingPossession);
    if (closing !== null) add("timing", { label: "Closing / possession", value: closing, source: src });
    const title = taText(r.transaction.titleComplications);
    if (title !== null) add("ownership", { label: "Title complications", value: title, source: src });
    const structure = taText(r.transaction.transactionStructure);
    if (structure !== null) add("summary", { label: "Transaction structure", value: structure, source: src });
  }

  if (r.sellerPrice) {
    add("price", r.sellerPrice.kind === "price"
      ? { label: "Seller price position", value: usd(r.sellerPrice.price), source: `Seller price position note, ${day(r.sellerPrice.at)}` }
      : { label: "Seller price position", value: "Seller declined to state a price", source: `Seller price position note, ${day(r.sellerPrice.at)}` });
  }
  if (r.askingPrice !== null) add("price", { label: "Asking price", value: usd(r.askingPrice), source: "Opportunity asking price" });

  if (r.repairs) add("condition", { label: "Repairs figure", value: usd(r.repairs.amount), source: r.repairs.provenance });

  if (r.outcome) {
    const when = r.outcome.kind === "follow_up" && r.outcome.followUpAt ? `; follow-up ${day(r.outcome.followUpAt)}` : "";
    add("summary", { label: "Last call outcome", value: `${OUTCOME_TEXT[r.outcome.kind]}${when}`, source: `Call outcome note, ${day(r.outcome.at)}` });
  }
  return out;
}
