/**
 * B15-25 (INV-133) Phase 1 -- Deal Calculator local autosave.
 *
 * Ported from the Bones-accepted offline prototype (487c35fa,
 * scripts/prototype/b15-25-drafts/draft-model.mjs on branch b15-25-draft-prototype-r3).
 * Jess GO 2026-10-30, Captain-approved direction.
 *
 * A draft is the operator's calculator figures and modes, kept in THIS BROWSER only. It is never sent to
 * GHL, never an approval and never a confirmed value. Two kinds, never mixed:
 *   scratch -- the unlinked calculator, isolated by environment (GHL location) and operator;
 *   deal    -- a calculator linked to a contact AND a chosen deal, isolated by environment, operator,
 *              contact, property and opportunity.
 *
 * Every draft field records its BASE: the GHL value shown when the field was first kept (a linked
 * contact's ARV / repairs seed, otherwise none). On restore, base vs GHL now decides the field's state:
 *   same -> "draft"; changed -> "conflict" (both shown, neither applied until Keep My Draft / Use GHL);
 *   unreadable now or then -> "unchecked" (the draft is shown, flagged; the choices stay disabled).
 *
 * Saves are confirmed by reading back, removals by checking nothing is left; a failure is reported,
 * never assumed away (Bones r2 finding 1). Unreadable evidence is unavailable, never "nothing recorded"
 * (Bones r2 finding 2, r3).
 */
import type { Answers, MiscAnswer, OperatorCondition } from "./repair-estimation/operator-model";

export const DRAFT_VERSION = 1;
export const KEY_PREFIX = "iaos-calculator-draft:v1:";

/** The calculator's figures and modes. repairItems is the itemized answers + Miscellaneous, as JSON text. */
export const FIELDS = ["arv", "repairsQuick", "testPrice", "assignmentMode", "manualAmount", "repairsMode", "repairItems"] as const;
export type DraftField = (typeof FIELDS)[number];

export type ScratchIdentity = { kind: "scratch"; env: string; operator: string };
export type DealIdentity = { kind: "deal"; env: string; operator: string; contactId: string; propertyId: string; opportunityId: string };
export type DraftIdentity = ScratchIdentity | DealIdentity;
const PARTS: Record<DraftIdentity["kind"], readonly string[]> = {
  scratch: ["env", "operator"],
  deal: ["env", "operator", "contactId", "propertyId", "opportunityId"],
};

/** GHL evidence for one field. */
export type GhlValue = { kind: "value"; value: string } | { kind: "none" } | { kind: "unavailable" };
export type GhlNow = { kind: "ok"; values: Partial<Record<DraftField, GhlValue>> } | { kind: "unavailable" };
export const NONE: GhlValue = Object.freeze({ kind: "none" }) as GhlValue;
export const UNAVAILABLE: GhlValue = Object.freeze({ kind: "unavailable" }) as GhlValue;
/** The unlinked calculator: no GHL value exists for any field. */
export const NO_GHL: GhlNow = { kind: "ok", values: {} };

export type DraftEntry = { value: string; base: GhlValue };
export type Draft = { version: number; identity: DraftIdentity; savedAt: string; fields: Partial<Record<DraftField, DraftEntry>> };
export type FieldState =
  | { state: "draft" | "conflict" | "unchecked"; draft: string; ghl: GhlValue; base: GhlValue }
  | { state: "ghl" | "empty" | "unavailable"; ghl: GhlValue };

export class DraftIdentityError extends Error {}

/** A draft needs its full identity for its kind; a missing part never falls back to a broader key. */
export function draftKey(id: DraftIdentity): string {
  const parts = id && PARTS[id.kind as DraftIdentity["kind"]];
  if (!parts) throw new DraftIdentityError("draft identity needs a kind");
  const values = parts.map((k) => {
    const v = (id as Record<string, unknown>)[k];
    if (typeof v !== "string" || v.trim() === "") throw new DraftIdentityError(`draft identity needs ${k}`);
    return encodeURIComponent(v);
  });
  return `${KEY_PREFIX}${id.kind}|${values.join("|")}`;
}

function sameIdentity(a: unknown, b: DraftIdentity): boolean {
  if (!a || typeof a !== "object" || (a as DraftIdentity).kind !== b.kind) return false;
  return ["kind", ...PARTS[b.kind]].every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

const validGhlValue = (g: unknown): g is GhlValue =>
  !!g && typeof g === "object" && ((g as GhlValue).kind === "none" || ((g as GhlValue).kind === "value" && typeof (g as { value: unknown }).value === "string"));

/** A stored base: a GHL value, or unavailable (the field was first kept while GHL could not be read). */
const validBase = (b: unknown): boolean => validGhlValue(b) || (!!b && typeof b === "object" && (b as { kind?: unknown }).kind === "unavailable");

/** One field's GHL value; anything unreadable is UNAVAILABLE, never "nothing recorded". */
function ghlOf(ghlNow: GhlNow | null | undefined, field: DraftField): GhlValue {
  if (!ghlNow || ghlNow.kind !== "ok" || !ghlNow.values || typeof ghlNow.values !== "object" || Array.isArray(ghlNow.values)) return UNAVAILABLE;
  if (!Object.prototype.hasOwnProperty.call(ghlNow.values, field)) return NONE;
  const g = ghlNow.values[field];
  return validGhlValue(g) ? g : UNAVAILABLE;
}

/**
 * GHL evidence for a contact seed field (ARV, estimated repairs). The parse rule is resolver.ts's
 * readContactNumber, but absent and unparsable are told apart: absent/empty -> none; a value that rule
 * accepts -> value (its raw text); present but not a finite number -> unavailable.
 */
export function seedEvidence(fields: { id: string; value?: unknown }[] | null | undefined, id: string): GhlValue {
  if (!Array.isArray(fields)) return UNAVAILABLE;
  const f = fields.find((x) => x && x.id === id);
  if (!f) return NONE;
  const raw = f.value;
  if (raw === null || raw === undefined || raw === "") return NONE;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? { kind: "value", value: String(n) } : UNAVAILABLE;
}

/** same / changed / unavailable, comparing a field's base with GHL now. */
export function compare(base: GhlValue | undefined, current: GhlValue | undefined): "same" | "changed" | "unavailable" {
  if (!base || !current || base.kind === "unavailable" || current.kind === "unavailable") return "unavailable";
  if (base.kind !== current.kind) return "changed";
  return base.kind === "none" || base.value === (current as { value: string }).value ? "same" : "changed";
}

/** Records an edit. The base is taken once, when the field is first kept, and kept on later edits. */
export function recordEdit(draft: Draft | null, id: DraftIdentity, field: DraftField, value: string, ghlNow: GhlNow, at: string): Draft {
  if (!(FIELDS as readonly string[]).includes(field)) throw new Error(`not a draft field: ${field}`);
  draftKey(id);
  if (draft && !sameIdentity(draft.identity, id)) throw new DraftIdentityError("draft belongs to another record");
  const prev = draft ? draft.fields[field] : undefined;
  return {
    version: DRAFT_VERSION, identity: { ...id }, savedAt: at,
    fields: { ...(draft ? draft.fields : {}), [field]: { value: String(value), base: prev ? prev.base : ghlOf(ghlNow, field) } },
  };
}

/** Per-field state for display. Drafts are never "confirmed" or "approved": no such state exists. */
export function assess(draft: Draft | null, ghlNow: GhlNow): Record<DraftField, FieldState> {
  const out = {} as Record<DraftField, FieldState>;
  for (const field of FIELDS) {
    const ghl = ghlOf(ghlNow, field);
    const d = draft ? draft.fields[field] : undefined;
    if (!d) { out[field] = { state: ghl.kind === "value" ? "ghl" : ghl.kind === "unavailable" ? "unavailable" : "empty", ghl }; continue; }
    const c = compare(d.base, ghl);
    out[field] = { state: c === "same" ? "draft" : c === "changed" ? "conflict" : "unchecked", draft: d.value, ghl, base: d.base };
  }
  return out;
}

/** Whether Keep My Draft / Use GHL may act: only while that field's GHL value can be read. */
export function canResolve(ghlNow: GhlNow, field: DraftField): boolean { return ghlOf(ghlNow, field).kind !== "unavailable"; }

/** Keep My Draft: the draft value stays, unsaved, re-based on the GHL value now shown. */
export function keepMine(draft: Draft | null, field: DraftField, ghlNow: GhlNow, at: string): Draft | null {
  const d = draft ? draft.fields[field] : undefined;
  if (!draft || !d || !canResolve(ghlNow, field)) return draft;
  return { ...draft, savedAt: at, fields: { ...draft.fields, [field]: { value: d.value, base: ghlOf(ghlNow, field) } } };
}

/** Use GHL: the field's draft is discarded; null when no field is left. Refused while GHL is unreadable. */
export function useGhl(draft: Draft | null, field: DraftField, ghlNow: GhlNow): Draft | null {
  if (!draft || !draft.fields[field] || !canResolve(ghlNow, field)) return draft;
  const fields = { ...draft.fields };
  delete fields[field];
  return Object.keys(fields).length ? { ...draft, fields } : null;
}

/**
 * A field's value is back to what the calculator shows when nothing is kept (the contact's seed or the
 * default), so it is no longer a draft: the field leaves the draft; null when no field is left. Not gated
 * on GHL -- nothing the operator typed is lost, the screen already shows that value.
 */
export function withoutField(draft: Draft | null, field: DraftField): Draft | null {
  if (!draft || !draft.fields[field]) return draft;
  const fields = { ...draft.fields };
  delete fields[field];
  return Object.keys(fields).length ? { ...draft, fields } : null;
}

/** Parses a stored record for `id`. Anything unexpected is refused, never partly applied. */
export function parseStored(raw: string | null, id: DraftIdentity): { ok: true; draft: Draft | null } | { ok: false; reason: string } {
  if (raw == null) return { ok: true, draft: null };
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return { ok: false, reason: "malformed" }; }
  if (!d || typeof d !== "object" || (d as Draft).version !== DRAFT_VERSION) return { ok: false, reason: "version" };
  if (!sameIdentity((d as Draft).identity, id)) return { ok: false, reason: "identity" };
  const fields = (d as Draft).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return { ok: false, reason: "malformed" };
  for (const [f, x] of Object.entries(fields)) {
    if (!(FIELDS as readonly string[]).includes(f) || !x || typeof x.value !== "string" || !validBase(x.base)) {
      return { ok: false, reason: "malformed" };
    }
  }
  if (fields.repairItems && parseRepairItems(fields.repairItems.value) === null) return { ok: false, reason: "malformed" };
  return { ok: true, draft: d as Draft };
}

const CONDITIONS: readonly OperatorCondition[] = ["not_asked", "good", "repair", "severe"];
/** The itemized repair answers + Miscellaneous as kept text; null unless every part has the exact shape. */
export function parseRepairItems(text: string): { answers: Answers; misc: MiscAnswer } | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { answers, misc } = v as { answers?: unknown; misc?: unknown };
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  if (!misc || typeof misc !== "object" || typeof (misc as MiscAnswer).description !== "string" || typeof (misc as MiscAnswer).amount !== "string") return null;
  for (const a of Object.values(answers as Record<string, unknown>)) {
    const r = a as Record<string, unknown>;
    if (!r || typeof r !== "object" || !CONDITIONS.includes(r.condition as OperatorCondition)
      || typeof r.amount !== "string" || typeof r.quantity !== "string" || typeof r.dirty !== "boolean") return null;
  }
  return { answers: answers as Answers, misc: { description: (misc as MiscAnswer).description, amount: (misc as MiscAnswer).amount } };
}
export function serializeRepairItems(answers: Answers, misc: MiscAnswer): string { return JSON.stringify({ answers, misc }); }

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DraftStore = {
  available: boolean;
  load(id: DraftIdentity): { ok: true; draft: Draft | null } | { ok: false; reason: string };
  /** True only when the record reads back exactly. */
  save(draft: Draft): boolean;
  /** True only when nothing is left under the key. */
  remove(id: DraftIdentity): boolean;
};

/** Browser-storage adapter. Storage that throws at start reports itself unavailable. */
export function openStore(getStorage: () => StorageLike): DraftStore {
  let storage: StorageLike | null = null;
  try { storage = getStorage(); const probe = `${KEY_PREFIX}probe`; storage.setItem(probe, "1"); storage.removeItem(probe); } catch { storage = null; }
  return {
    available: storage !== null,
    load(id) { if (!storage) return { ok: true, draft: null }; try { return parseStored(storage.getItem(draftKey(id)), id); } catch { return { ok: false, reason: "unreadable" }; } },
    save(draft) {
      if (!storage) return false;
      try { const k = draftKey(draft.identity); const text = JSON.stringify(draft); storage.setItem(k, text); return storage.getItem(k) === text; } catch { return false; }
    },
    remove(id) {
      if (!storage) return true;   // nothing was ever kept, so nothing can come back
      try { const k = draftKey(id); storage.removeItem(k); return storage.getItem(k) === null; } catch { return false; }
    },
  };
}
