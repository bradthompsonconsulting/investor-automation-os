/**
 * B15-04 -- the known-deal ledger (proposal r4 §1; Bones's fencing review of r3).
 *
 * ONE record per contact, changed only by etag compare-and-swap:
 *   known-deal/<digest(scope:contact)> =
 *     { v, gen, ids: { <dealId>: { firstSeen, source } },
 *       discoveries: { <token>: { state: open|committed|revoked, startedAt, committedGen?, revokedAt?, revokedBy? } } }
 *
 * - `ids` is add-only: no code path here removes an id (J2).
 * - A token is minted ONCE per invocation (`register`) and never deleted;
 *   committed and revoked are its tombstones, so no read or retry revives it.
 * - Every commit attempt, including every conflict retry, re-reads the record
 *   and proceeds only while ITS token is still `open` in that version. An
 *   absent, committed-elsewhere, revoked or unreadable token ends the
 *   invocation (`Fenced`): its cached observations are never merged.
 * - Recovery revokes the EXACT stale tokens it read as open and older than
 *   LEASE_MS, in the same compare-and-swap that commits its own token.
 * - The save gate confirms, by a no-op compare-and-swap, that the record is
 *   unchanged since the save's own commit (same gen), its token is committed
 *   and no discovery is open.
 *
 * What it claims: it holds every id whose commit succeeded. What it does not
 * claim: an id seen only by an invocation that died before committing is not
 * recovered unless it is visible again at recovery (r3 proposal §1).
 */
import { randomUUID } from "node:crypto";
import { digest } from "./ghl-write-boundary";
import type { BarrierStore } from "./current-offer-barrier";

/** Longer than any function run (Netlify synchronous functions stop well before this; INFERRED from the platform limit). */
export const LEASE_MS = 120_000;
export const CAS_ATTEMPTS = 4;

export type TokenState = { state: "open" | "committed" | "revoked"; startedAt: string; committedGen?: number; revokedAt?: string; revokedBy?: string };
export type LedgerRecord = { v: 1; gen: number; ids: Record<string, { firstSeen: string; source: string }>; discoveries: Record<string, TokenState>; checkedAt?: string };
export type Observation = { id: string; source: "search" | "single_read" };

/** This invocation's token can no longer act: nothing it observed is merged, nothing is sent. */
export class Fenced extends Error {}
/** The store could not confirm a transition (ambiguous, failed or contended): treat the deal list as INCOMPLETE. */
export class LedgerUnsettled extends Error {}

export const ledgerKey = (scope: string, contact: string) => `known-deal/${digest(`${scope}:${contact}`)}`;
export const recoveryKey = (scope: string, contact: string, token: string) => `known-deal-recovery/${digest(`${scope}:${contact}:${token}`)}`;

export async function readLedger(store: BarrierStore, scope: string, contact: string): Promise<{ rec: LedgerRecord | null; etag: string | null }> {
  let got: { data: any; etag?: string } | null;
  try { got = await store.getWithMetadata(ledgerKey(scope, contact), { type: "json", consistency: "strong" }); }
  catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    got = await store.getWithMetadata(ledgerKey(scope, contact), { type: "json" });
  }
  if (!got) return { rec: null, etag: null };
  if (!got.etag) throw new LedgerUnsettled("Ledger read without an etag");
  const rec = got.data as LedgerRecord;
  if (!rec || rec.v !== 1 || typeof rec.gen !== "number" || typeof rec.ids !== "object" || typeof rec.discoveries !== "object") throw new LedgerUnsettled("Ledger record is malformed");
  return { rec, etag: got.etag };
}

async function cas(store: BarrierStore, scope: string, contact: string, etag: string | null, next: LedgerRecord): Promise<boolean> {
  let r: { modified: boolean };
  try { r = await store.setJSON(ledgerKey(scope, contact), next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag }); }
  catch { throw new LedgerUnsettled("A ledger write could not be confirmed"); }
  return r.modified;
}

const clone = (r: LedgerRecord): LedgerRecord => JSON.parse(JSON.stringify(r));
const empty = (): LedgerRecord => ({ v: 1, gen: 0, ids: {}, discoveries: {} });
const addIds = (r: LedgerRecord, observed: Observation[], now: string) => { for (const o of observed) if (!r.ids[o.id]) r.ids[o.id] = { firstSeen: now, source: o.source }; };
export const openTokens = (r: LedgerRecord | null) => (r ? Object.entries(r.discoveries).filter(([, d]) => d.state === "open").map(([t]) => t) : []);
export const staleTokens = (r: LedgerRecord | null, nowMs: number, except: string) =>
  (r ? Object.entries(r.discoveries).filter(([t, d]) => t !== except && d.state === "open" && nowMs - Date.parse(d.startedAt) > LEASE_MS).map(([t]) => t) : []);

/** A discovery's identity. Minted once; an invocation never holds two. */
export class Discovery {
  readonly token = randomUUID();
  registered = false;
  constructor(readonly store: BarrierStore, readonly scope: string, readonly contact: string) {}

  /** register(T): T absent -> open. Returns the record as of registration (its ids are candidates). */
  async register(now: string): Promise<LedgerRecord> {
    if (this.registered) throw new Fenced("This invocation already registered a discovery");
    this.registered = true;
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const { rec, etag } = await readLedger(this.store, this.scope, this.contact);
      if (rec?.discoveries[this.token]) throw new Fenced("Token already present");
      const next = rec ? clone(rec) : empty();
      next.gen += 1;
      next.discoveries[this.token] = { state: "open", startedAt: now };
      if (await cas(this.store, this.scope, this.contact, etag, next)) return next;
    }
    throw new LedgerUnsettled("Could not register the discovery");
  }

  /**
   * commit(T) -- or, with `revoke`, recover(R, stale...). Every attempt re-reads
   * and requires THIS token to be open in the version it writes against; each
   * revoked token must also still be open there and older than the lease.
   */
  async commit(observed: Observation[], now: string, revoke: string[] = []): Promise<{ rec: LedgerRecord; gen: number }> {
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const { rec, etag } = await readLedger(this.store, this.scope, this.contact);
      const mine = rec?.discoveries[this.token];
      if (!rec || !mine || mine.state !== "open") throw new Fenced("This discovery is no longer authorized");
      const nowMs = Date.parse(now);
      const revocable = revoke.filter((t) => { const d = rec.discoveries[t]; return d && d.state === "open" && nowMs - Date.parse(d.startedAt) > LEASE_MS; });
      const next = clone(rec);
      next.gen += 1;
      addIds(next, observed, now);
      next.discoveries[this.token] = { ...mine, state: "committed", committedGen: next.gen };
      for (const t of revocable) next.discoveries[t] = { ...next.discoveries[t], state: "revoked", revokedAt: now, revokedBy: this.token };
      if (await cas(this.store, this.scope, this.contact, etag, next)) return { rec: next, gen: next.gen };
    }
    throw new LedgerUnsettled("Could not commit the discovery");
  }

  /**
   * The save gate's ledger step: a no-op compare-and-swap (checkedAt only;
   * gen unchanged) against a version where this token is committed at
   * `committedGen`, gen still equals it, and no discovery is open.
   */
  async confirmUnchanged(committedGen: number, now: string): Promise<void> {
    const { rec, etag } = await readLedger(this.store, this.scope, this.contact);
    const mine = rec?.discoveries[this.token];
    if (!rec || !mine || mine.state !== "committed" || mine.committedGen !== committedGen) throw new Fenced("This save's deal evaluation is no longer authorized");
    if (rec.gen !== committedGen) throw new Fenced("The deal ledger changed after this save's evaluation");
    if (openTokens(rec).length) throw new Fenced("Another deal discovery is open");
    const next = clone(rec);
    next.checkedAt = now;
    if (!(await cas(this.store, this.scope, this.contact, etag, next))) throw new Fenced("The deal ledger changed during the save gate");
  }
}

/** Write-once evidence that recovery revoked these tokens (written BEFORE the revoking compare-and-swap). */
export async function recordRecovery(store: BarrierStore, scope: string, contact: string, recovering: string, stale: string[], rec: LedgerRecord, now: string): Promise<void> {
  for (const t of stale) {
    const d = rec.discoveries[t];
    let threw = false;
    try { await store.setJSON(recoveryKey(scope, contact, t), { v: 1, token: t, startedAt: d?.startedAt ?? null, recoveredAt: now, recoveredBy: recovering, gen: rec.gen, idsDigest: digest(JSON.stringify(Object.keys(rec.ids).sort())) }, { onlyIfNew: true }); }
    catch { threw = true; }
    if (threw) throw new LedgerUnsettled("Recovery evidence could not be recorded");
  }
}
