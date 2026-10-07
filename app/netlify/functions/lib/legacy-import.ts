/**
 * Storage correction (PR #131 plan v6 §9) -- the CONSERVATIVE, RESUMABLE
 * LEGACY IMPORT, with ONE store-wide owner.
 *
 * The import never writes the old store, never calls GHL, never retries a
 * legacy operation and never releases anything. It reads `iaos-write-receipts`
 * strongly (read-only adapter), records every observation verbatim under
 * `evidence/<runId>/` (never read by any live path), and writes ONLY:
 *   authz/import/owner        (onlyIfNew once per store; no takeover, ever)
 *   authz/legacy-block/<s>    (conditional create; identical on resume, different -> halt)
 *   authz/send/<k>            (send receipts under the SAME key derivation)
 *   authz/cutover/v2          (only after the owner's verified completion)
 *
 * Phases: A capture (S1 before revocation, S2 >= 30 min after T_r, S3 at
 * import); B attribution (an unattributable subject-bearing record HALTS:
 * no completion, no cutover record); C classification, the most conservative
 * over every version (quarantined > blocked_unknown > resolved; resolved only
 * by R1 / R2); D output, strong read-back, manifest digest, then owner
 * completion, then the cutover record.
 *
 * Every legacy "never sent" proof is blocked_unknown: pre-v2 claims came from
 * the faulty SDK acknowledgement (F1), and a strong read proves a record exists,
 * not its provenance.
 */
import { canonical, digest } from "./hash";
import { InvocationScope } from "./invocation-scope";
import { LEGACY_STORE, RecordMismatch, StorageUncertain, VerifiedStore } from "./verified-store";
import { CUTOVER_KEY, IMPORT_OWNER_KEY, LEGACY_BLOCK_PREFIX, legacyBlockKey, type CutoverRecord, type ImportOwner, type LegacyBlock } from "./cutover";
import { SEND_RECEIPT_PREFIX } from "./write-receipts";
import { SLOTS, SLOT_OPERATION, requestIdFor } from "./call-log-barrier";

/** Every prefix of the legacy store (F3). Bare-digest receipts are listed with the empty prefix filter below. */
export const LEGACY_PREFIXES = [
  "call-log/v3/op/", "call-log/v3/attempt/", "call-log/v3/binding/", "call-log/v3/decision/", "call-log/v3/outcome/", "call-log/v3/final/",
  "call-log/head/", "call-log/barrier/", "call-log/request/", "call-log/decision/", "call-log/outcome/",
  "current-offer/head/", "current-offer/barrier/", "current-offer/request/", "current-offer/decision/", "current-offer/outcome/",
  "lock/", "stage-unresolved/", "send/",
] as const;
export const BARE_RECEIPT = /^[0-9a-f]{64}$/;
export type Snapshot = "S1" | "S2" | "S3";
export const SNAPSHOTS: Snapshot[] = ["S1", "S2", "S3"];

export type Obs = { key: string; snapshot: Snapshot; etag: string | null; absent: boolean; valueDigest: string | null; value: any };
/** World: snapshot -> key -> observation. */
export type World = Record<Snapshot, Map<string, Obs>>;
export type SubjectClass = "resolved" | "blocked_unknown" | "quarantined";
export type ImportInput = { env: string; locationId: string; knownSubjects: string[]; unstablePrefixes: string[] };
export type Classified = {
  subjects: Map<string, { class: SubjectClass; reasons: Set<string> }>;
  unattributed: { key: string; reason: string }[];
  sendReceipts: Map<string, any>;
  bareReceipts: number;
};

const RANK: Record<SubjectClass, number> = { resolved: 0, blocked_unknown: 1, quarantined: 2 };

/** Phase B + C: attribution and classification over every observed version. Pure. */
export function classifyWorld(world: World, input: ImportInput): Classified {
  const scope = `${input.env}:${input.locationId}`;
  const subjects = new Map<string, { class: SubjectClass; reasons: Set<string> }>();
  const mark = (subject: string, cls: SubjectClass, reason: string) => {
    const cur = subjects.get(subject) ?? { class: "resolved" as SubjectClass, reasons: new Set<string>() };
    if (RANK[cls] > RANK[cur.class]) cur.class = cls;
    if (cls !== "resolved") cur.reasons.add(reason);
    subjects.set(subject, cur);
  };
  const unattributed: { key: string; reason: string }[] = [];
  const sendReceipts = new Map<string, any>();
  let bareReceipts = 0;

  // Every distinct version of every key, across snapshots.
  const keys = new Set<string>();
  for (const s of SNAPSHOTS) for (const k of world[s].keys()) keys.add(k);
  const versions = (k: string) => SNAPSHOTS.map((s) => world[s].get(k)).filter((o): o is Obs => !!o);
  const present = (k: string) => versions(k).filter((o) => !o.absent);
  const latest = (k: string): any => { const p = present(k); return p.length ? p[p.length - 1].value : null; };

  // Known subjects: supplied, plus every subject named by a record.
  const contacts = new Set<string>(input.knownSubjects.filter((s) => s.startsWith("contact:")).map((s) => s.slice(8)));
  const opps = new Set<string>(input.knownSubjects.filter((s) => s.startsWith("opportunity:")).map((s) => s.slice(12)));
  for (const k of keys) for (const o of present(k)) {
    const v = o.value;
    if (v && typeof v === "object") {
      if (typeof v.contactId === "string") contacts.add(v.contactId);
      if (typeof v.opp === "string") opps.add(v.opp);
    }
  }
  const byDigest = new Map<string, string>();   // digest -> subject
  for (const c of contacts) { byDigest.set(digest(`${scope}:${c}`), `contact:${c}`); byDigest.set(digest(input.locationId + c), `contact:${c}`); byDigest.set(digest(c), `contact:${c}`); }
  for (const o of opps) { byDigest.set(digest(`${scope}:${o}`), `opportunity:${o}`); byDigest.set(digest(o), `opportunity:${o}`); }
  // Stage markers: digest(env:location:opp).
  for (const o of opps) byDigest.set(digest(`${input.env}:${input.locationId}:${o}`), `opportunity:${o}`);
  const tail = (k: string) => k.slice(k.lastIndexOf("/") + 1);

  // Contradictions first: a write-once key with two values, or a record that vanished.
  const mutable = (k: string) => k.startsWith("call-log/head/") || k.startsWith("current-offer/head/") || k.startsWith("lock/") || k.startsWith("stage-unresolved/");
  const contradictions = new Map<string, string>();
  for (const k of keys) {
    const vs = versions(k);
    const ds = new Set(vs.filter((o) => !o.absent).map((o) => o.valueDigest));
    if (!mutable(k) && ds.size > 1) contradictions.set(k, "write_once_changed");
    const firstPresent = vs.findIndex((o) => !o.absent);
    if (firstPresent >= 0 && vs.slice(firstPresent).some((o) => o.absent)) contradictions.set(k, "record_vanished");
  }

  // call-log v3: ops and their request ids.
  const v3ops = new Map<string, any>();              // op -> op record
  const v3requests = new Map<string, { op: string; contactId: string }>();   // requestId -> op
  for (const k of keys) if (k.startsWith("call-log/v3/op/")) { const v = latest(k); if (v?.op && v.contactId) v3ops.set(v.op, v); }
  for (const k of keys) {
    const v = latest(k);
    if (k.startsWith("call-log/v3/attempt/") && v?.op && v.requestId) { const o = v3ops.get(v.op); if (o) v3requests.set(v.requestId, { op: v.op, contactId: o.contactId }); }
    if (k.startsWith("call-log/v3/binding/") && v?.op && v.contactId) { /* bindings name their contact directly */ }
  }
  const v3key = (kind: string, id: string) => `call-log/v3/${kind}/${digest(`${scope}:${id}`)}`;
  const v3attemptKey = (op: string, slot: string, n: number) => `call-log/v3/attempt/${digest(`${scope}:${op}:${slot}:${n}`)}`;
  const requestOfDecision = new Map<string, string>();
  for (const rid of v3requests.keys()) { requestOfDecision.set(v3key("decision", rid), rid); requestOfDecision.set(v3key("outcome", rid), rid); requestOfDecision.set(v3key("binding", rid), rid); }

  // Pre-v3 call-log and Current Offer request records -> their decision/outcome keys.
  const legacyDecision = new Map<string, string>();   // decision/outcome key -> subject
  for (const k of keys) {
    const v = latest(k);
    if (k.startsWith("call-log/request/") && v?.contactId) {
      const reqDigests = new Set<string>();
      for (const kb of keys) if (kb.startsWith("call-log/barrier/")) { const b = latest(kb); if (b?.barrierId === v.barrierId) for (const s of b.steps ?? []) reqDigests.add(s.requestDigest); }
      for (const d of reqDigests) {
        legacyDecision.set(`call-log/decision/${digest(`${scope}:${v.contactId}:${d}`)}`, `contact:${v.contactId}`);
        legacyDecision.set(`call-log/outcome/${digest(`${scope}:${v.contactId}:${d}`)}`, `contact:${v.contactId}`);
      }
    }
    if (k.startsWith("current-offer/request/") && v?.opp) {
      for (const kb of keys) if (kb.startsWith("current-offer/barrier/")) {
        const b = latest(kb);
        if (b?.barrierId === v.barrierId) for (const s of b.steps ?? []) {
          legacyDecision.set(`current-offer/decision/${digest(`${scope}:${v.opp}:${s.requestDigest}`)}`, `opportunity:${v.opp}`);
          legacyDecision.set(`current-offer/outcome/${digest(`${scope}:${v.opp}:${s.requestDigest}`)}`, `opportunity:${v.opp}`);
        }
      }
    }
  }

  // R1 / R2 for call-log v3 operations (the v3 dispatch gate requires a published attempt + binding
  // BEFORE any send: lib/call-log-barrier.ts runCallLogOwnedWrite, attemptPublished check -- cited).
  const opResolved = new Map<string, boolean>();
  for (const op of v3ops.keys()) {
    const fin = latest(v3key("final", op));
    const anyAttempt = [...keys].some((k) => k.startsWith("call-log/v3/attempt/") && latest(k)?.op === op);
    if (!anyAttempt) { opResolved.set(op, true); continue; }   // R2
    let ok = !!fin && fin.kind === "complete" && fin.op === op && Array.isArray(fin.slots);
    /* Bones review finding 4: EVERY attempt of every slot -- superseded ones included -- must carry its
       own terminal evidence (a "send" decision and a persisted CONFIRMED outcome, in every observed
       version). A later success or a complete final never covers an earlier attempt: a legacy
       "never sent" proof (withdrawn / not_dispatched) or an uncertain/missing outcome on ANY attempt
       keeps the operation unresolved, and its subject blocked. */
    const allVersions = (k: string) => present(k).map((o) => o.value);
    /* Bones re-review of 20d7a62, item 1: the attempts are the UNION of every observed attempt record
       naming this operation, never a walk from 1 that stops at the first missing ordinal (a gap would
       hide every later attempt, uncertain ones included). Every version of every such record must be
       exactly bound: slot, ordinal >= 1, request id `<op>-<slot>-<n>`, and the key it is stored under.
       Each slot's ordinals must be exactly 1..max: a gap is inconsistent evidence, never proof that
       later attempts do not exist. Each attempt needs its exact dispatch binding and its own terminal
       evidence. Anything else leaves the operation unresolved: a complete final never covers it. */
    const opRec = latest(v3key("op", op));
    const ordinals = new Map<string, Set<number>>(SLOTS.map((s) => [s, new Set<number>()]));
    for (const k of keys) {
      if (!k.startsWith("call-log/v3/attempt/")) continue;
      const vs = allVersions(k);
      if (!vs.some((a) => a?.op === op)) continue;
      for (const a of vs) {
        const exact = !!a && a.v === 3 && a.op === op && (SLOTS as string[]).includes(a.slot) && Number.isInteger(a.n) && a.n >= 1
          && a.requestId === requestIdFor(op, a.slot, a.n) && k === v3attemptKey(op, a.slot, a.n);
        if (!exact) { ok = false; continue; }
        ordinals.get(a.slot)!.add(a.n);
      }
    }
    if (ok) {
      for (const slot of SLOTS) {
        const ns = [...ordinals.get(slot)!].sort((a, b) => a - b);
        if (!ns.length || ns.some((n, i) => n !== i + 1)) { ok = false; continue; }   // none, or a gap
        for (const n of ns) {
          const rid = requestIdFor(op, slot, n);
          const bindings = allVersions(v3key("binding", rid));
          const decisions = allVersions(v3key("decision", rid));
          const outcomes = allVersions(v3key("outcome", rid));
          const boundExactly = bindings.length > 0 && bindings.every((b) => b?.v === 3 && b.op === op && b.slot === slot && b.n === n
            && b.contactId === opRec?.contactId && b.operation === SLOT_OPERATION[slot]);
          const exactTerminal = decisions.length > 0 && decisions.every((d) => d?.d === "send") && outcomes.length > 0 && outcomes.every((o) => o?.kind === "confirmed");
          if (!boundExactly || !exactTerminal) ok = false;
        }
      }
    }
    opResolved.set(op, ok);   // R1
  }

  for (const k of keys) {
    if (!present(k).length && !contradictions.has(k)) continue;
    const v = latest(k);
    let subject: string | null = null;
    let cls: SubjectClass = "blocked_unknown";
    let reason = "legacy_record";
    if (BARE_RECEIPT.test(k)) { bareReceipts++; continue; }           // receipts: meaning kept by the v2- id format rule
    if (k.startsWith("send/")) { sendReceipts.set(SEND_RECEIPT_PREFIX + tail(k), v); continue; }
    if (k.startsWith("call-log/v3/op/")) { subject = v?.contactId ? `contact:${v.contactId}` : null; cls = v && opResolved.get(v.op) ? "resolved" : "blocked_unknown"; reason = "v3_operation_unresolved"; }
    else if (k.startsWith("call-log/v3/attempt/")) { const o = v && v3ops.get(v.op); subject = o ? `contact:${o.contactId}` : null; cls = o && opResolved.get(v.op) ? "resolved" : "blocked_unknown"; reason = o ? "v3_attempt" : "orphan_attempt"; }
    else if (k.startsWith("call-log/v3/binding/")) { subject = v?.contactId ? `contact:${v.contactId}` : null; cls = v && opResolved.get(v.op) ? "resolved" : "blocked_unknown"; reason = "v3_binding"; }
    else if (k.startsWith("call-log/v3/decision/") || k.startsWith("call-log/v3/outcome/")) {
      const rid = requestOfDecision.get(k); const r = rid ? v3requests.get(rid) : undefined;
      subject = r ? `contact:${r.contactId}` : null;
      cls = r && opResolved.get(r.op) ? "resolved" : "blocked_unknown";
      reason = v?.kind === "not_dispatched" || v?.d === "withdrawn" ? "legacy_never_sent_proof" : v?.kind === "uncertain" ? "uncertain_outcome" : "v3_decision_or_outcome";
    }
    else if (k.startsWith("call-log/v3/final/")) { const o = v && v3ops.get(v.op); subject = o ? `contact:${o.contactId}` : null; cls = o && opResolved.get(v.op) ? "resolved" : "blocked_unknown"; reason = v?.kind === "not_saved" ? "legacy_not_saved_final" : "v3_final"; }
    else if (k.startsWith("call-log/head/")) {
      subject = byDigest.get(tail(k)) ?? null;
      const cur = v?.current ?? null;
      if (cur === null) { cls = "resolved"; reason = "head_clear"; }
      else if (v?.v === 3 && v3ops.has(cur)) { cls = opResolved.get(cur) ? "resolved" : "blocked_unknown"; reason = "open_head"; }
      else if (v?.v === 3) { cls = "quarantined"; reason = "head_names_missing_op"; }
      else { cls = "blocked_unknown"; reason = "legacy_head"; }
    }
    else if (k.startsWith("call-log/barrier/") || k.startsWith("call-log/request/")) { subject = v?.contactId ? `contact:${v.contactId}` : (v?.contactDigest ? byDigest.get(v.contactDigest) ?? null : null); reason = "pre_v3_call_log"; }
    else if (k.startsWith("call-log/decision/") || k.startsWith("call-log/outcome/")) { subject = legacyDecision.get(k) ?? null; reason = "pre_v3_call_log_evidence"; }
    else if (k.startsWith("current-offer/head/")) { subject = byDigest.get(tail(k)) ?? null; cls = v?.current === null ? "resolved" : "blocked_unknown"; reason = v?.current === null ? "head_clear" : "offer_head"; }
    else if (k.startsWith("current-offer/barrier/")) { subject = v?.oppDigest ? byDigest.get(v.oppDigest) ?? null : null; reason = "offer_barrier"; }
    else if (k.startsWith("current-offer/request/")) { subject = v?.opp ? `opportunity:${v.opp}` : null; reason = "offer_request"; }
    else if (k.startsWith("current-offer/decision/") || k.startsWith("current-offer/outcome/")) { subject = legacyDecision.get(k) ?? null; reason = v?.kind === "not_dispatched" || v?.d === "withdrawn" ? "legacy_never_sent_proof" : "offer_evidence"; }
    else if (k.startsWith("lock/")) { subject = byDigest.get(tail(k)) ?? null; reason = "legacy_lock"; }
    else if (k.startsWith("stage-unresolved/")) { subject = byDigest.get(tail(k)) ?? null; reason = "legacy_stage_marker"; }
    else { unattributed.push({ key: k, reason: "unknown_prefix" }); continue; }
    if (!subject) { unattributed.push({ key: k, reason: "unattributable" }); continue; }
    const contradiction = contradictions.get(k);
    if (contradiction) mark(subject, "quarantined", contradiction);
    else if (input.unstablePrefixes.some((p) => k.startsWith(p))) mark(subject, "quarantined", "unstable_listing");
    else mark(subject, cls, reason);
  }
  return { subjects, unattributed, sendReceipts, bareReceipts };
}

export type Manifest = { runId: string; counts: Record<SubjectClass, number>; blocks: { subject: string; class: SubjectClass; reasons: string[] }[]; sendReceipts: number; bareReceipts: number; unattributed: 0; observationsDigest: string };
export function manifestOf(runId: string, c: Classified, observationsDigest: string): Manifest {
  const blocks = [...c.subjects.entries()].filter(([, v]) => v.class !== "resolved").map(([subject, v]) => ({ subject, class: v.class, reasons: [...v.reasons].sort() })).sort((a, b) => a.subject.localeCompare(b.subject));
  const counts = { resolved: 0, blocked_unknown: 0, quarantined: 0 } as Record<SubjectClass, number>;
  for (const v of c.subjects.values()) counts[v.class]++;
  return { runId, counts, blocks, sendReceipts: c.sendReceipts.size, bareReceipts: c.bareReceipts, unattributed: 0, observationsDigest };
}
export const manifestDigest = (m: Manifest) => digest(canonical(m));

// ── The run (the iaos-cutover function drives these in bounded batches) ──────
export class ImportHalted extends Error { constructor(m: string) { super(m); this.name = "ImportHalted"; } }
export const evidenceObsKey = (runId: string, s: Snapshot, key: string) => `evidence/${runId}/${s}/obs/${digest(key)}`;
export const evidenceProgressKey = (runId: string, s: Snapshot) => `evidence/${runId}/progress/${s}`;
const validRunId = (r: unknown): r is string => typeof r === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(r);
export const ownerHashOf = (runToken: string) => digest(`import-owner:${runToken}`);

/** Claims the one store-wide owner (onlyIfNew, forever). Any other runId is refused while it exists. */
export async function claimImportOwner(store: VerifiedStore, runId: string, runToken: string): Promise<ImportOwner> {
  if (!validRunId(runId) || !/^[0-9a-f]{64}$/.test(runToken)) throw new ImportHalted("invalid run identity");
  const rec: ImportOwner = { v: 1, runId, ownerHash: ownerHashOf(runToken), startedAt: new Date().toISOString(), state: "running" };
  try { await store.createOnce(IMPORT_OWNER_KEY, rec, "import_owner"); } catch (e) { if (!(e instanceof StorageUncertain)) throw e; }
  const got = await store.readData<ImportOwner>(IMPORT_OWNER_KEY, "import_owner");
  if (!got || got.runId !== runId || got.ownerHash !== rec.ownerHash) throw new ImportHalted("Another import run owns this store (no takeover)");
  return got;
}
export async function requireOwner(store: VerifiedStore, runId: string, runToken: string): Promise<{ owner: ImportOwner; etag: string }> {
  const r = await store.read<ImportOwner>(IMPORT_OWNER_KEY, "import_owner");
  if (!r || r.data.runId !== runId || r.data.ownerHash !== ownerHashOf(runToken)) throw new ImportHalted("Not the import owner");
  return { owner: r.data, etag: r.etag };
}

type Progress = { v: 1; snapshot: Snapshot; startedAt: string; listings: Record<string, string[][]>; stable: Record<string, boolean>; queue: string[]; next: number; done: boolean };

/**
 * Phase A, one bounded batch. Lists every prefix twice until two consecutive
 * listings agree (else unstable), then strong-GETs every listed key and every
 * key derivable from records already seen, recording each observation once.
 */
export async function captureBatch(store: VerifiedStore, legacy: VerifiedStore, scope: InvocationScope, input: { runId: string; snapshot: Snapshot; env: string; locationId: string }, dry = false): Promise<{ done: boolean; captured: number; unstable: string[] }> {
  const pk = evidenceProgressKey(input.runId, input.snapshot);
  const cur = await store.read<Progress>(pk, "import_capture");
  let p: Progress = cur?.data ?? { v: 1, snapshot: input.snapshot, startedAt: new Date().toISOString(), listings: {}, stable: {}, queue: [], next: 0, done: false };
  let etag = cur?.etag ?? null;
  if (p.done) return { done: true, captured: 0, unstable: Object.keys(p.stable).filter((k) => !p.stable[k]) };
  const enough = () => scope.remaining() > 3_000;
  let captured = 0;
  // Listings.
  for (const prefix of [...LEGACY_PREFIXES, ""]) {
    if (prefix in p.stable) continue;
    if (!enough()) break;
    const lists = p.listings[prefix] ?? [];
    while (lists.length < 4) {
      const keys = await legacy.list(prefix, "import_capture");
      lists.push(prefix === "" ? keys.filter((k) => BARE_RECEIPT.test(k)) : keys);
      const n = lists.length;
      if (n >= 2 && JSON.stringify(lists[n - 1]) === JSON.stringify(lists[n - 2])) break;
    }
    const n = lists.length;
    const stable = n >= 2 && JSON.stringify(lists[n - 1]) === JSON.stringify(lists[n - 2]);
    p.stable[prefix] = stable;
    p.listings[prefix] = lists;
    const union = new Set<string>(lists.flat());
    for (const k of union) if (!p.queue.includes(k)) p.queue.push(k);
  }
  // Observations.
  while (p.next < p.queue.length && enough()) {
    const key = p.queue[p.next];
    const got = await legacy.read(key, "import_capture");
    const obs: Obs = { key, snapshot: input.snapshot, etag: got?.etag ?? null, absent: !got, valueDigest: got ? digest(canonical(got.data)) : null, value: got ? got.data : null };
    if (!dry) {
      try { await store.writeOnceVerified(evidenceObsKey(input.runId, input.snapshot, key), obs, (g: Obs) => g.key === key && g.valueDigest === obs.valueDigest && g.absent === obs.absent, "import_capture"); }
      catch (e) { if (e instanceof RecordMismatch) throw new ImportHalted("A captured observation changed on resume"); throw e; }
    }
    // Derived keys from this record.
    for (const d of derivedKeys(obs, input.env, input.locationId)) if (!p.queue.includes(d)) p.queue.push(d);
    p.next++; captured++;
  }
  const allListed = [...LEGACY_PREFIXES, ""].every((x) => x in p.stable);
  p.done = allListed && p.next >= p.queue.length;
  if (!dry) {
    const w = await store.cas(pk, p, etag, "import_capture");
    if (w.result !== "written") throw new ImportHalted("Concurrent capture batch (serialize batches on the import lock)");
    etag = w.etag;
  }
  return { done: p.done, captured, unstable: Object.keys(p.stable).filter((k) => !p.stable[k]) };
}

/** Keys derivable from a record: op -> attempts n = 1..max+1 per slot, bindings, decisions, outcomes, head, final. */
export function derivedKeys(o: Obs, env: string, locationId: string): string[] {
  if (o.absent || !o.value || typeof o.value !== "object") return [];
  const scope = `${env}:${locationId}`;
  const v = o.value;
  const out: string[] = [];
  if (o.key.startsWith("call-log/v3/op/") && typeof v.op === "string") {
    for (const slot of ["result", "note", "touch"]) out.push(`call-log/v3/attempt/${digest(`${scope}:${v.op}:${slot}:1`)}`);
    out.push(`call-log/v3/final/${digest(`${scope}:${v.op}`)}`);
    if (typeof v.contactId === "string") { out.push(`call-log/head/${digest(`${scope}:${v.contactId}`)}`); out.push(`lock/${digest(locationId + v.contactId)}`); }
  }
  if (o.key.startsWith("call-log/v3/attempt/") && typeof v.op === "string" && typeof v.requestId === "string" && Number.isInteger(v.n)) {
    out.push(`call-log/v3/attempt/${digest(`${scope}:${v.op}:${v.slot}:${v.n + 1}`)}`);
    for (const kind of ["binding", "decision", "outcome"]) out.push(`call-log/v3/${kind}/${digest(`${scope}:${v.requestId}`)}`);
  }
  if (o.key.startsWith("current-offer/request/") && typeof v.opp === "string") {
    out.push(`current-offer/head/${digest(`${scope}:${v.opp}`)}`);
    out.push(`stage-unresolved/${digest(`${env}:${locationId}:${v.opp}`)}`);
    if (typeof v.contactId === "string") out.push(`lock/${digest(locationId + v.contactId)}`);
  }
  return out;
}

/** Reads every captured observation of a run (import tooling only; never a live path). */
export async function loadWorld(store: VerifiedStore, runId: string): Promise<World> {
  const world: World = { S1: new Map(), S2: new Map(), S3: new Map() };
  for (const s of SNAPSHOTS) {
    const keys = await store.list(`evidence/${runId}/${s}/obs/`, "import_classify");
    for (const k of keys) { const o = await store.readData<Obs>(k, "import_classify"); if (o) world[s].set(o.key, o); }
  }
  return world;
}

/**
 * Phase D: write every block (conditional create; identical on resume OK,
 * different -> halt) and send receipt, read every output back, then owner
 * completion, then the cutover record. Halts (no completion, no cutover) on
 * any unattributed record.
 */
export async function completeImport(store: VerifiedStore, input: ImportInput & { runId: string; runToken: string; T_r: string; drainMinutes: number }, world: World): Promise<{ manifest: Manifest; digest: string }> {
  /* Bones review finding 5: completion is an idempotent RESUME for the same owner. An owner already
     marked complete is never reset and never re-opened: the manifest is recomputed from the FROZEN
     captures and must equal the owner's recorded digest, every output is re-verified, and only then is a
     missing, matching cutover record created. There is no other route. */
  const { etag: ownerEtag, owner } = await requireOwner(store, input.runId, input.runToken);
  if (owner.state === "complete" && (!owner.manifestDigest || owner.T_r !== input.T_r)) throw new ImportHalted("The completed import's frozen T_r or manifest does not match this resume");
  if (!world.S1.size && !world.S2.size && !world.S3.size) throw new ImportHalted("No captures");
  if (!Number.isFinite(Date.parse(input.T_r))) throw new ImportHalted("T_r is required");
  // Every snapshot fully captured; S2 started at least `drainMinutes` after T_r (a precaution, never proof).
  const progress: Record<string, Progress | null> = {};
  for (const s of SNAPSHOTS) progress[s] = await store.readData<Progress>(evidenceProgressKey(input.runId, s), "import_classify");
  if (SNAPSHOTS.some((s) => !progress[s]?.done)) throw new ImportHalted("Every snapshot (S1, S2, S3) must be fully captured");
  if (Date.parse(progress.S2!.startedAt) < Date.parse(input.T_r) + input.drainMinutes * 60_000) throw new ImportHalted("S2 must start at least the drain interval after T_r");
  const unstable = SNAPSHOTS.flatMap((s) => Object.entries(progress[s]!.stable).filter(([, ok]) => !ok).map(([k]) => k));
  input = { ...input, unstablePrefixes: [...new Set([...input.unstablePrefixes, ...unstable])] };
  const c = classifyWorld(world, input);
  if (c.unattributed.length) throw new ImportHalted(`Unattributable subject-bearing records: ${c.unattributed.length}`);
  const obsDigest = digest(canonical(SNAPSHOTS.map((s) => [...world[s].values()].map((o) => [o.key, o.absent, o.valueDigest]).sort())));
  const manifest = manifestOf(input.runId, c, obsDigest);
  const mDigest = manifestDigest(manifest);
  const evidenceDigest = obsDigest;
  for (const b of manifest.blocks) {
    const rec: LegacyBlock = { v: 1, subject: b.subject, class: b.class as LegacyBlock["class"], reasons: b.reasons, evidenceDigest };
    try { await store.writeOnceVerified(legacyBlockKey(input.env, input.locationId, b.subject), rec, (g) => canonical(g) === canonical(rec), "import_output"); }
    catch (e) { if (e instanceof RecordMismatch) throw new ImportHalted("A different legacy block already exists"); throw e; }
  }
  for (const [k, v] of c.sendReceipts) {
    try { await store.writeOnceVerified(k, v, (g) => canonical(g) === canonical(v), "import_output"); }
    catch (e) { if (e instanceof RecordMismatch) throw new ImportHalted("A different send receipt already exists"); throw e; }
  }
  // Verification: every output strongly read back and counted.
  const blockKeys = await store.list(LEGACY_BLOCK_PREFIX, "import_output");
  const expected = new Set(manifest.blocks.map((b) => legacyBlockKey(input.env, input.locationId, b.subject)));
  if (blockKeys.length !== expected.size || blockKeys.some((k) => !expected.has(k))) throw new ImportHalted("Legacy-block outputs do not match the manifest");
  const sendKeys = await store.list(SEND_RECEIPT_PREFIX, "import_output");
  if (sendKeys.length !== c.sendReceipts.size) throw new ImportHalted("Send receipt outputs do not match the manifest");
  // Owner completion (unless this is a resume of a completed owner), THEN the cutover record.
  if (owner.state === "complete") {
    if (owner.manifestDigest !== mDigest) throw new ImportHalted("The frozen captures no longer reproduce the completed manifest");
  } else {
    const done: ImportOwner = { ...owner, state: "complete", manifestDigest: mDigest, T_r: input.T_r };
    let applied = false;
    try { applied = (await store.cas(IMPORT_OWNER_KEY, done, ownerEtag, "import_owner")).result === "written"; }
    catch (e) { if (!(e instanceof StorageUncertain)) throw e; }
    if (!applied) {
      // A conflict or an ambiguous acknowledgement: only an exact strong read of OUR completion proves it.
      const again = await store.readData<ImportOwner>(IMPORT_OWNER_KEY, "import_owner");
      if (!again || again.runId !== owner.runId || again.ownerHash !== owner.ownerHash || again.state !== "complete" || again.manifestDigest !== mDigest || again.T_r !== input.T_r) {
        throw new ImportHalted("Owner completion could not be confirmed; resume with the same run and token");
      }
    }
  }
  const cut: CutoverRecord = { v: 1, importComplete: true, ownerRunId: input.runId, manifestDigest: mDigest, T_r: input.T_r, drainUntil: new Date(Date.parse(input.T_r) + input.drainMinutes * 60_000).toISOString(), createdAt: new Date().toISOString() };
  await store.writeOnceVerified(CUTOVER_KEY, cut, (g: CutoverRecord) => g.ownerRunId === cut.ownerRunId && g.manifestDigest === mDigest && g.T_r === cut.T_r, "import_output");
  return { manifest, digest: mDigest };
}

/** The dry run: classification counts by class and reason (digest-keyed, no contact data). Writes nothing. */
export function dryRunReport(world: World, input: ImportInput) {
  const c = classifyWorld(world, input);
  const reasons: Record<string, number> = {};
  for (const v of c.subjects.values()) for (const r of v.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
  const counts = { resolved: 0, blocked_unknown: 0, quarantined: 0 } as Record<SubjectClass, number>;
  for (const v of c.subjects.values()) counts[v.class]++;
  return { counts, reasons, unattributed: c.unattributed.length, sendReceipts: c.sendReceipts.size, bareReceipts: c.bareReceipts };
}
export const LEGACY_STORE_NAME = LEGACY_STORE;
