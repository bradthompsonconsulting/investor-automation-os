/**
 * Storage correction (PR #131 plan v6 §10) -- the G5 GATE: server-side
 * default-deny for untracked legacy submissions.
 *
 * A pre-v2 submission whose outcome was uncertain may have left no durable
 * record (F10), so the import cannot block what it cannot see. Every GHL
 * mutation in the new build is refused unless `authz/g5/table` -- read strongly
 * on every write -- allows its subject and effect classes. Overlap is decided by
 * INTERSECTING effect classes, never by operation names. No table, an unreadable
 * table or an unknown entry = blocked. The table starts as {location: ALL}.
 *
 * Narrowing is only by an immutable `authz/g5/narrow/<id>` record created by
 * the separately authorized G5 tool under exactly one of N1–N4 (or the audit
 * record that replaces the default with per-path entries), each with its
 * evidence digest and approval reference. Missing logs, missing records,
 * elapsed time, revocation, session expiry or an empty search are never
 * clearance. Widening is always allowed. Any change alters the table digest, so
 * writes stay refused until a fresh activation records the new digest.
 */
import { canonical, digest } from "./hash";
import { VerifiedStore } from "./verified-store";

export const G5_TABLE_KEY = "authz/g5/table";
export const G5_NARROW_PREFIX = "authz/g5/narrow/";
export const EFFECT_VOCABULARY = ["note", "last_touch", "call_result", "stage", "opportunity_value", "contract_document", "executed_artifact", "task", "appointment", "message", "tag"] as const;
export const isEffect = (e: unknown): e is string => typeof e === "string" && ((EFFECT_VOCABULARY as readonly string[]).includes(e) || /^custom_field:[A-Za-z0-9_-]{1,64}$/.test(e));
export const isSubjectScope = (s: unknown): s is string => typeof s === "string" && (s === "location" || /^(contact|opportunity):[A-Za-z0-9_-]{1,64}$/.test(s));

export type G5Entry = { pathId: string; scope: string; effects: string[]; basis: "default" | "audit" | "narrowed" | "widened"; ref: string | null };
export type G5Table = { v: 1; entries: G5Entry[]; narrowings: string[]; updatedAt: string };
export const DEFAULT_TABLE = (): G5Table => ({ v: 1, entries: [{ pathId: "default", scope: "location", effects: ["*"], basis: "default", ref: null }], narrowings: [], updatedAt: new Date().toISOString() });

export function tableDigest(t: G5Table): string { return digest(canonical({ v: t.v, entries: t.entries, narrowings: t.narrowings })); }
export function validTable(t: any): t is G5Table {
  return !!t && t.v === 1 && Array.isArray(t.entries) && Array.isArray(t.narrowings) &&
    t.entries.every((e: any) => e && typeof e.pathId === "string" && isSubjectScope(e.scope) && Array.isArray(e.effects) && e.effects.length > 0 &&
      e.effects.every((x: any) => x === "*" || isEffect(x)) && ["default", "audit", "narrowed", "widened"].includes(e.basis));
}
const scopeCovers = (outer: string, inner: string) => outer === "location" || outer === inner;
const effectsCover = (outer: string[], inner: string[]) => outer.includes("*") || inner.every((e) => outer.includes(e));
const intersects = (a: string[], b: string[]) => a.includes("*") || b.includes("*") || a.some((e) => b.includes(e));

/** Synchronous decision on a table already read strongly. Unknown shape = blocked. */
export function allows(table: unknown, subject: string, effects: string[]): { ok: true } | { ok: false; pathId: string | null } {
  if (!validTable(table)) return { ok: false, pathId: null };
  if (!isSubjectScope(subject) || subject === "location" || effects.length === 0 || !effects.every(isEffect)) return { ok: false, pathId: null };
  for (const e of table.entries) {
    if (scopeCovers(e.scope, subject) && intersects(e.effects, effects)) return { ok: false, pathId: e.pathId };
  }
  return { ok: true };
}

/** Reads the table strongly. Absent or malformed -> null (callers refuse). */
export async function readG5Table(store: VerifiedStore): Promise<{ table: G5Table; etag: string } | null> {
  const r = await store.read<G5Table>(G5_TABLE_KEY, "g5_gate");
  if (!r || !validTable(r.data)) return null;
  return { table: r.data, etag: r.etag };
}

// ── Narrowing records (the separately authorized G5 tool) ───────────────────
export type NarrowingRule = "AUDIT" | "N1" | "N2" | "N3" | "N4";
export type NarrowingRecord = {
  v: 1; id: string; pathId: string; rule: NarrowingRule;
  /** The entries that REPLACE the path's current entries (all blocks). [] removes the path's block (N2 only). */
  scopes: { scope: string; effects: string[] }[];
  evidence: Record<string, unknown>; evidenceDigest: string; approvalRef: string; createdAt: string;
  /** AUDIT only: per-path entries replacing the default ALL entry. */
  auditEntries?: { pathId: string; scope: string; effects: string[] }[];
};
export class NarrowingRefused extends Error { constructor(m: string) { super(m); this.name = "NarrowingRefused"; } }

/** Evidence kinds that are NEVER clearance. */
const FORBIDDEN_BASES = ["absence_of_errors", "empty_search", "value_match", "effect_absent", "elapsed_time", "revocation", "session_expiry", "missing_logs", "missing_records"];

function req(cond: unknown, m: string): asserts cond { if (!cond) throw new NarrowingRefused(m); }
const nonEmptyStrings = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length > 0);

/** Validates a narrowing record against its rule. Throws NarrowingRefused. */
export function validateNarrowing(r: NarrowingRecord): void {
  req(r && r.v === 1 && /^[A-Za-z0-9_-]{4,64}$/.test(r.id) && typeof r.pathId === "string" && r.pathId.length > 0, "Malformed narrowing record");
  req(typeof r.approvalRef === "string" && r.approvalRef.length >= 8, "An approval reference is required");
  req(r.evidence && typeof r.evidence === "object" && digest(canonical(r.evidence)) === r.evidenceDigest, "Evidence digest mismatch");
  const basis = (r.evidence as any).basis;
  req(!FORBIDDEN_BASES.includes(basis), `"${basis}" is never clearance`);
  req(Array.isArray(r.scopes) && r.scopes.every((s) => isSubjectScope(s.scope) && Array.isArray(s.effects) && s.effects.length > 0 && s.effects.every((e) => e === "*" || isEffect(e))), "Malformed narrowed scopes");
  const ev: any = r.evidence;
  switch (r.rule) {
    case "AUDIT": {
      req(r.pathId === "default", "The audit replaces only the default entry");
      req(ev.complete === true && ev.unresolvedDeploys === 0 && ev.unauditedFunctions === 0 && typeof ev.documentDigest === "string" && Number.isInteger(ev.pathCount) && ev.pathCount > 0, "The audit must be complete: every deploy resolved and every function audited");
      req(Array.isArray(r.auditEntries) && r.auditEntries.length === ev.pathCount && r.auditEntries.every((e) => typeof e.pathId === "string" && e.pathId !== "default" && isSubjectScope(e.scope) && e.effects.length > 0 && e.effects.every((x) => x === "*" || isEffect(x))), "Every audited path needs a scope and effect classes (unknown subject = location, unknown effects = *)");
      req(r.scopes.length === 0, "The audit carries its entries in auditEntries");
      return;
    }
    case "N1": {
      req(nonEmptyStrings(ev.codePathCitations) && nonEmptyStrings(ev.tests), "N1 needs code-path citations and tests");
      req(ev.durableBeforeDispatchOnEveryBranch === true && ev.readbackBeforeDispatch === true && ev.trustsSdkModified === false && ev.failsClosedOnStorageError === true && ev.importClassified === true, "N1 requires: durable before dispatch on every branch, read-back (not SDK modified) before dispatch, fail-closed on any storage failure, and import classification");
      req(r.scopes.every((s) => s.scope !== "location"), "N1 narrows to the subjects the import blocks");
      return;
    }
    case "N2": {
      req(Array.isArray(ev.deploys) && ev.deploys.length > 0 && ev.unresolvedDeploys === 0, "N2 needs the full deploy inventory with every commit resolved");
      req(ev.deploys.every((d: any) => typeof d.deployId === "string" && typeof d.commit === "string" && /^[0-9a-f]{7,40}$/.test(d.commit) && d.pathPresent === false), "N2: the path must be absent from every retained deploy");
      req(r.scopes.length === 0, "N2 removes the path's block");
      return;
    }
    case "N3": {
      req(ev.retentionCoversWindow === true && typeof ev.windowStart === "string" && typeof ev.windowEnd === "string", "N3 needs log retention spanning the whole reachable window");
      req(Number.isInteger(ev.invocationCount) && ev.invocationCount === ev.independentCount, "N3: the invocation count must reconcile with an independent count");
      req(Array.isArray(ev.outcomes) && ev.outcomes.length === ev.invocationCount, "N3: every invocation must be listed");
      req(ev.outcomes.every((o: any) => ["confirmed", "refused", "uncertain"].includes(o.outcome) && isSubjectScope(o.subject)), "N3: malformed outcomes");
      const keep = new Set(ev.outcomes.filter((o: any) => o.outcome === "uncertain").map((o: any) => o.subject));
      req([...keep].every((s) => r.scopes.some((x) => x.scope === s || x.scope === "location")), "N3: subjects with uncertain invocations stay blocked");
      return;
    }
    case "N4": {
      const en = ev.enumeration;
      req(en && en.coverageComplete === true && Number.isInteger(en.count) && en.count === en.independentCount && typeof en.windowStart === "string" && typeof en.windowEnd === "string", "N4(a): every submission must be enumerated by coverage-complete evidence");
      req(Array.isArray(ev.submissions) && ev.submissions.length === en.count, "N4(a): the enumeration must list every submission");
      const definite = (s: any) => s.resolution === "refused" || (s.resolution === "correlated" && typeof s.correlationId === "string" && s.correlationId.length > 0 && typeof s.ghlRecordId === "string" && s.ghlRecordId.length > 0 && typeof s.at === "string");
      req(ev.submissions.every((s: any) => isSubjectScope(s.subject) && (s.resolution === "pending" || definite(s))), "N4(b): each submission must be refused or correlated by an identifier it wrote; a matching value alone is not correlation");
      const keep = new Set(ev.submissions.filter((s: any) => !definite(s)).map((s: any) => s.subject));
      req([...keep].every((s) => r.scopes.some((x) => x.scope === s || x.scope === "location")), "N4: a subject with any pending submission stays blocked");
      return;
    }
    default: throw new NarrowingRefused("Unknown narrowing rule");
  }
}

/** Pure: the table after a validated narrowing. Never widens; the result must be covered by what it replaces. */
export function applyNarrowing(t: G5Table, r: NarrowingRecord): G5Table {
  validateNarrowing(r);
  req(validTable(t), "The current table is malformed");
  req(!t.narrowings.includes(r.id), "This narrowing was already applied");
  const old = t.entries.filter((e) => e.pathId === r.pathId);
  req(old.length > 0, "No block exists for that path");
  let replacement: G5Entry[];
  if (r.rule === "AUDIT") {
    replacement = r.auditEntries!.map((e) => ({ pathId: e.pathId, scope: e.scope, effects: [...e.effects].sort(), basis: "audit" as const, ref: r.id }));
  } else {
    replacement = r.scopes.map((s) => ({ pathId: r.pathId, scope: s.scope, effects: [...s.effects].sort(), basis: "narrowed" as const, ref: r.id }));
    req(replacement.every((n) => old.some((o) => scopeCovers(o.scope, n.scope) && effectsCover(o.effects, n.effects))), "A narrowing may only reduce a block");
  }
  return { v: 1, entries: [...t.entries.filter((e) => e.pathId !== r.pathId), ...replacement], narrowings: [...t.narrowings, r.id], updatedAt: new Date().toISOString() };
}
/** Widening is always allowed. */
export function widen(t: G5Table, entry: { pathId: string; scope: string; effects: string[]; ref?: string }): G5Table {
  req(isSubjectScope(entry.scope) && entry.effects.length > 0 && entry.effects.every((e) => e === "*" || isEffect(e)), "Malformed block");
  return { ...t, entries: [...t.entries, { pathId: entry.pathId, scope: entry.scope, effects: [...entry.effects].sort(), basis: "widened", ref: entry.ref ?? null }], updatedAt: new Date().toISOString() };
}

// ── Effect classes of each v2 GHL mutation ───────────────────────────────────
export type Mutation = { subject: string; effects: string[] };
/** Field writes: every field is custom_field:<id>; the call-log and offer carriers add their semantic class. */
export function fieldEffects(fieldIds: string[], semantic: { lastTouch: string[]; callResult: string[]; offerValue: string[] }): string[] {
  const out = new Set<string>();
  for (const id of fieldIds) {
    out.add(`custom_field:${id}`);
    if (semantic.lastTouch.includes(id)) out.add("last_touch");
    if (semantic.callResult.includes(id)) out.add("call_result");
    if (semantic.offerValue.includes(id)) out.add("opportunity_value");
  }
  return [...out].sort();
}
