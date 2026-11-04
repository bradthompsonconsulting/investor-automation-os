/**
 * B15-03 / INV-103 slice C -- the structured seller conversation note
 * (Captain 2026-11-03: one structured note per call, saved at Summary).
 *
 * Pure. No I/O, no React, no GHL identifiers. The same carrier pattern as
 * `seller-call-readiness-carriers.ts` and `seller-call-seller-position-note.ts`:
 * an exact versioned header, one fact per line, STRICT positional parsing, a
 * canonical ISO timestamp, opportunity-scoped, append-only.
 *
 * SUPERSEDE BY CALL ID. Each Save writes a NEW note. A corrected re-save of the
 * same call carries the same call id and a later embedded timestamp; readers
 * take the latest per call id (`latestSellerConversationsForOpportunity`).
 * Nothing is ever edited or deleted.
 *
 * WHAT IT CARRIES: exactly the `noteFor` projection (seller-conversation.ts) --
 * every question heading in order, then each answer under its control label,
 * then General notes. A blank answer is the empty string, never "Unanswered";
 * "Seller doesn't know" is its own literal line under the heading. Values are
 * written as JSON string literals so a multi-line answer, leading or trailing
 * spaces and an empty answer all survive a GHL round trip exactly and can never
 * be mistaken for the next line.
 *
 * FROZEN SCHEMA. The v1 headings and labels are fixed here, not read from
 * QUESTIONS, so a later wording change cannot silently change how an old note
 * parses. `test-seller-conversation-save.cjs` fails if QUESTIONS no longer
 * projects to this schema -- the signal that a v2 is needed.
 *
 * It never replaces a canonical value: readiness and underwriting do not read it.
 * The operator is never fabricated: null (written "UNAVAILABLE") when unknown,
 * like every sibling carrier on the Seller Call page.
 */

export const SELLER_CONVERSATION_LEDGER_VERSION = "iaos-seller-conversation-v1" as const;
export const SELLER_CONVERSATION_HEADER = `IAOS SELLER CONVERSATION — ${SELLER_CONVERSATION_LEDGER_VERSION}`;
/** Any body starting with this is claimed by this carrier family (the server refuses a malformed one). */
export const SELLER_CONVERSATION_PREFIX = "IAOS SELLER CONVERSATION";
/** Whole-note limit, characters. The server refuses longer bodies; the save plan says so before sending. */
export const SELLER_CONVERSATION_NOTE_MAX_LENGTH = 16000;

const META_LABELS = ["Recorded at", "Operator", "Opportunity", "Call", "Opening type"] as const;
const DONT_KNOW_LINE = "Seller doesn't know";
const HEADING_PREFIX = "## ";
const GENERAL_HEADING = "General notes";
const GENERAL_LABEL = "General notes";
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

export const SELLER_CONVERSATION_OPENING_LABELS = Object.freeze({ cold: "Cold Outreach", inbound: "Inbound Inquiry", follow_up: "Follow-up" } as const);
export type SellerConversationOpening = keyof typeof SELLER_CONVERSATION_OPENING_LABELS;

/** The v1 schema: question id, heading, and its answer controls (id, label), in order. */
export const SELLER_CONVERSATION_V1_SCHEMA: ReadonlyArray<{ id: string; heading: string; fields: ReadonlyArray<{ id: string; label: string }> }> = Object.freeze([
  { id: "opening", heading: "Opening", fields: [{ id: "response", label: "Response / context" }] },
  { id: "address", heading: "1. Property address", fields: [
    { id: "street", label: "Street" }, { id: "unit", label: "Unit" }, { id: "city", label: "City" }, { id: "state", label: "State" }, { id: "zip", label: "ZIP" },
  ] },
  { id: "ownership", heading: "2. Ownership & decision-makers", fields: [{ id: "owners", label: "Owner / decision-maker" }] },
  { id: "occupancy", heading: "3. Occupancy", fields: [{ id: "occupancy", label: "Occupancy" }, { id: "lease", label: "Occupancy notes" }] },
  { id: "reason", heading: "4. Reason for selling", fields: [{ id: "reason", label: "Reason for selling" }] },
  { id: "timing", heading: "5. Timing", fields: [{ id: "timing", label: "Timing" }] },
  { id: "price", heading: "6. Price expectations", fields: [{ id: "amount", label: "Seller's stated price ($)" }, { id: "basis", label: "Price notes" }] },
  { id: "asis", heading: "7. As-is sale fit", fields: [{ id: "priorities", label: "As-is answer" }] },
  { id: "condition", heading: "8. Condition & repairs", fields: [{ id: "overall", label: "Condition (seller's words)" }] },
  { id: "summary", heading: "9. Summary & next step", fields: [{ id: "next", label: "Summary & agreed next step" }, { id: "followup", label: "Follow-up date" }] },
]);

/** The rows `noteFor` produces (structurally; this module does not import it). */
export type SellerConversationRow =
  | { kind: "question"; id: string; heading: string; dontKnow: boolean; answers: { fieldId: string; label: string; value: string }[] }
  | { kind: "general"; id: "general"; heading: string; value: string };

export type SellerConversationNoteInput = {
  opportunityId: string;
  callId: string;
  at: string;
  operator: string | null;
  opening: SellerConversationOpening;
  rows: readonly SellerConversationRow[];
};

export type ParsedSellerConversation = {
  version: 1;
  opportunityId: string;
  callId: string;
  at: string;
  operator: string | null;
  opening: SellerConversationOpening;
  questions: { id: string; dontKnow: boolean; answers: Record<string, string> }[];
  general: string;
};

function isCanonicalIsoTimestamp(at: string): boolean {
  const ms = new Date(at).getTime();
  return Number.isFinite(ms) && new Date(ms).toISOString() === at;
}

/** A JSON string literal of exactly this value (one line: JSON escapes every line break). */
const encode = (value: string) => JSON.stringify(value);
/** The value of a canonical JSON string literal, or null when `raw` is anything else. */
function decode(raw: string): string | null {
  if (!raw.startsWith("\"")) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (typeof v !== "string" || JSON.stringify(v) !== raw) return null;
  return v;
}

/**
 * The note body. Throws unless `rows` is exactly the v1 schema in order (so a caller can never write a note
 * that its own parser would refuse), the ids are GHL-id shaped, `at` is canonical, or the result is too long.
 */
export function formatSellerConversationNote(args: SellerConversationNoteInput): string {
  if (!ID_SHAPE.test(args.opportunityId) || !ID_SHAPE.test(args.callId)) throw new Error("The opportunity and call ids must be identifiers.");
  if (!isCanonicalIsoTimestamp(args.at)) throw new Error("The recorded time must be a canonical ISO timestamp.");
  const opening = SELLER_CONVERSATION_OPENING_LABELS[args.opening];
  if (!opening) throw new Error("Unknown opening type.");
  if (args.operator !== null && (args.operator.trim() === "" || /[\r\n]/.test(args.operator) || args.operator === "UNAVAILABLE")) throw new Error("Invalid operator.");
  const schema = SELLER_CONVERSATION_V1_SCHEMA;
  if (args.rows.length !== schema.length + 1) throw new Error("The note must carry every question and General notes.");
  const lines: string[] = [
    SELLER_CONVERSATION_HEADER,
    `${META_LABELS[0]}: ${args.at}`,
    `${META_LABELS[1]}: ${args.operator ?? "UNAVAILABLE"}`,
    `${META_LABELS[2]}: ${args.opportunityId}`,
    `${META_LABELS[3]}: ${args.callId}`,
    `${META_LABELS[4]}: ${opening}`,
  ];
  schema.forEach((q, i) => {
    const row = args.rows[i];
    if (row.kind !== "question" || row.id !== q.id || row.heading !== q.heading || row.answers.length !== q.fields.length) throw new Error(`Row ${i} does not match the v1 schema.`);
    lines.push(HEADING_PREFIX + q.heading);
    if (row.dontKnow) lines.push(DONT_KNOW_LINE);
    q.fields.forEach((f, j) => {
      const a = row.answers[j];
      if (a.fieldId !== f.id || a.label !== f.label || typeof a.value !== "string") throw new Error(`Answer ${q.id}.${f.id} does not match the v1 schema.`);
      lines.push(`${f.label}: ${encode(a.value)}`);
    });
  });
  const general = args.rows[schema.length];
  if (general.kind !== "general" || typeof general.value !== "string") throw new Error("General notes must come last.");
  lines.push(HEADING_PREFIX + GENERAL_HEADING, `${GENERAL_LABEL}: ${encode(general.value)}`);
  const body = lines.join("\n");
  if (body.length > SELLER_CONVERSATION_NOTE_MAX_LENGTH) throw new SellerConversationNoteTooLong(body.length);
  return body;
}

export class SellerConversationNoteTooLong extends Error {
  constructor(readonly length: number) { super(`The conversation note is ${length} characters; the limit is ${SELLER_CONVERSATION_NOTE_MAX_LENGTH}.`); }
}

/** Strict: every line in its exact position, nothing extra, nothing missing. Anything else is null. */
export function parseSellerConversationNote(body: string): ParsedSellerConversation | null {
  if (typeof body !== "string" || body.length > SELLER_CONVERSATION_NOTE_MAX_LENGTH) return null;
  const lines = body.split("\n");
  let i = 0;
  const next = () => (i < lines.length ? lines[i++] : null);
  if (next() !== SELLER_CONVERSATION_HEADER) return null;
  const meta: string[] = [];
  for (const label of META_LABELS) {
    const line = next();
    if (line === null || !line.startsWith(`${label}: `)) return null;
    meta.push(line.slice(label.length + 2));
  }
  const [at, operatorRaw, opportunityId, callId, openingLabel] = meta;
  if (!isCanonicalIsoTimestamp(at) || !ID_SHAPE.test(opportunityId) || !ID_SHAPE.test(callId) || operatorRaw.trim() === "") return null;
  const opening = (Object.keys(SELLER_CONVERSATION_OPENING_LABELS) as SellerConversationOpening[]).find((k) => SELLER_CONVERSATION_OPENING_LABELS[k] === openingLabel);
  if (!opening) return null;
  const questions: ParsedSellerConversation["questions"] = [];
  for (const q of SELLER_CONVERSATION_V1_SCHEMA) {
    if (next() !== HEADING_PREFIX + q.heading) return null;
    let dontKnow = false;
    if (lines[i] === DONT_KNOW_LINE) { dontKnow = true; i++; }
    const answers: Record<string, string> = {};
    for (const f of q.fields) {
      const line = next();
      if (line === null || !line.startsWith(`${f.label}: `)) return null;
      const value = decode(line.slice(f.label.length + 2));
      if (value === null) return null;
      answers[f.id] = value;
    }
    questions.push({ id: q.id, dontKnow, answers });
  }
  if (next() !== HEADING_PREFIX + GENERAL_HEADING) return null;
  const gLine = next();
  if (gLine === null || !gLine.startsWith(`${GENERAL_LABEL}: `)) return null;
  const general = decode(gLine.slice(GENERAL_LABEL.length + 2));
  if (general === null || i !== lines.length) return null;
  return { version: 1, opportunityId, callId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, opening, questions, general };
}

/** True when the body claims this carrier family (well-formed or not). */
export function isSellerConversationNoteText(body: unknown): boolean {
  return typeof body === "string" && body.startsWith(SELLER_CONVERSATION_PREFIX);
}

/** Supersede by call id: the latest note (by embedded timestamp) for each call on this opportunity. */
export function latestSellerConversationsForOpportunity(notes: { body: string }[], opportunityId: string): Map<string, ParsedSellerConversation> {
  const out = new Map<string, ParsedSellerConversation>();
  for (const n of notes) {
    const p = parseSellerConversationNote(n.body);
    if (!p || p.opportunityId !== opportunityId) continue;
    const prev = out.get(p.callId);
    if (!prev || Date.parse(p.at) > Date.parse(prev.at)) out.set(p.callId, p);
  }
  return out;
}
