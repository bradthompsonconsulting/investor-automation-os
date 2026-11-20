/**
 * B15-04 (Captain GO 2026-11-19) -- the Seller Call conversation draft as ONE string for the per-deal draft store
 * (lib/contact-drafts, scope "conversation"), and the strict reader that turns a stored string back into a draft.
 *
 * Pure, no I/O. A stored value is only ever used whole: anything unexpected -- malformed JSON, an extra or missing key,
 * an unknown question, an unknown field of a known question, a non-string value, an unknown mark or opening, a
 * question index out of range -- refuses the whole record (null), never a partial apply. An untouched conversation
 * (the empty draft, also after text was typed and erased) serializes to "", which the store treats as "nothing kept".
 */
import { EMPTY_CONVERSATION, OPENINGS, QUESTIONS, type ConversationDraft, type Mark, type QuestionDraft, type QuestionId } from "./seller-conversation";

const MARKS: readonly Mark[] = ["skipped", "seller_doesnt_know"];
const FIELDS_BY_QUESTION: ReadonlyMap<string, ReadonlySet<string>> = new Map(QUESTIONS.map((q) => [q.id, new Set(q.fields.map((f) => f.id))]));
const OPENING_IDS: ReadonlySet<string> = new Set(OPENINGS.map((o) => o.id));

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** The draft without answers that hold nothing (every field "" and no mark), in question order. */
function compact(d: ConversationDraft): ConversationDraft {
  const answers: Partial<Record<QuestionId, QuestionDraft>> = {};
  for (const q of QUESTIONS) {
    const a = d.answers[q.id];
    if (!a) continue;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.fields)) if (v !== "") fields[k] = v;
    if (Object.keys(fields).length > 0 || a.mark !== null) answers[q.id] = { fields, mark: a.mark };
  }
  return { opening: d.opening, current: d.current, answers, notes: d.notes };
}

/** The stored form of a conversation draft; "" for an untouched one (nothing to keep). */
export function serializeConversationDraft(d: ConversationDraft): string {
  const c = compact(d);
  const untouched = c.opening === EMPTY_CONVERSATION.opening && c.current === EMPTY_CONVERSATION.current
    && Object.keys(c.answers).length === 0 && c.notes === EMPTY_CONVERSATION.notes;
  return untouched ? "" : JSON.stringify(c);
}

/** A stored value back as a draft, or null when it is not exactly a valid draft (refused whole). */
export function parseConversationDraft(raw: string): ConversationDraft | null {
  if (typeof raw !== "string" || raw === "") return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isPlainObject(v) || !sameKeys(v, ["opening", "current", "answers", "notes"])) return null;
  if (typeof v.opening !== "string" || !OPENING_IDS.has(v.opening)) return null;
  if (typeof v.current !== "number" || !Number.isInteger(v.current) || v.current < 0 || v.current >= QUESTIONS.length) return null;
  if (typeof v.notes !== "string" || !isPlainObject(v.answers)) return null;
  const answers: Partial<Record<QuestionId, QuestionDraft>> = {};
  for (const [qid, a] of Object.entries(v.answers)) {
    const allowed = FIELDS_BY_QUESTION.get(qid);
    if (!allowed || !isPlainObject(a) || !sameKeys(a, ["fields", "mark"]) || !isPlainObject(a.fields)) return null;
    if (a.mark !== null && !(typeof a.mark === "string" && (MARKS as readonly string[]).includes(a.mark))) return null;
    const fields: Record<string, string> = {};
    for (const [fid, fv] of Object.entries(a.fields)) {
      if (!allowed.has(fid) || typeof fv !== "string") return null;
      fields[fid] = fv;
    }
    answers[qid as QuestionId] = { fields, mark: a.mark as Mark | null };
  }
  return { opening: v.opening as ConversationDraft["opening"], current: v.current, answers, notes: v.notes };
}
