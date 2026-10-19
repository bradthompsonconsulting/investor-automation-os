/**
 * B15-04 controlled Test evaluation -- the SUPPLEMENTAL GHL READ budget (Brad, 2026-10-19: "approve the narrow
 * Test-only server counter"). It caps the GHL reads that fall OUTSIDE property-answer's own 40-request budget:
 * the Contacts list, workspace mounts, pagination, client retries, tab-return refreshes, read recovery and any
 * other navigation-triggered read (Bones SEQ 14-15; evaluation traffic r3).
 *
 * Every GHL request made by a NON-WRITE function -- the read-session functions and the scheduled mailer digest --
 * goes through `ghlReadFetch`. When `supplementalReadBudget.enabled` is exactly SUPPLEMENTAL_READ_BUDGET_ENABLED
 * (Test only, by a reviewed config commit):
 *   - ONE record per configured budget id, shared by every invocation and changed only by compare-and-swap:
 *       pa/eval-reads/<sha256(scope:budgetId)> = { v, budgetId, ceiling, reserved, receipts: [{ n, fn, path, at }] }
 *   - each request RESERVES one unit, and its receipt is stored durably BEFORE the request is sent. Pagination
 *     pages, retries and remounts are separate requests, so each reserves its own unit;
 *   - at the ceiling every further request is refused UNSENT. Nothing here resets, reopens or enlarges a budget:
 *     only a reviewed config commit with a new budget id starts another;
 *   - FAIL-CLOSED: an unreadable, malformed or mismatched record, an unconfirmed (thrown) reservation write, an
 *     ambiguous acknowledgement (anything but modified === true / false), a contention run-out, a missing Blob
 *     context, a non-GHL origin or a non-GET method refuses the request unsent. An unconfirmed write may have
 *     counted a unit that was never used; it is never given back. A spent unit stays spent whatever the request's
 *     outcome (abort, timeout, rejection, 4xx/5xx, lost response);
 *   - a record missing AFTER the budget was opened refuses for good (the single-winner genesis claim, below);
 *   - the scheduled mailer digest SENDS EMAIL after its reads, so while the budget is enabled it does nothing at
 *     all: no read and no send (`supplementalReadBudgetActive`, Bones SEQ 17 condition 5).
 * Otherwise (Production always; Test unless enabled) `ghlReadFetch` is the platform fetch, unchanged: no Blob
 * access and no behaviour change. property-answer's separate budget (evaluation-budget.ts) is not touched, and
 * write endpoints keep their own governance; neither goes through this module.
 */
import { createHash } from "node:crypto";
import { connectLambda, getStore } from "@netlify/blobs";
import { getConfig, SUPPLEMENTAL_READ_BUDGET_ENABLED } from "../../../shared/ghl-config";
/** The two Blob operations used (the shape @netlify/blobs' store provides); local, so this module imports no write-path code. */
type ReadBudgetStore = {
  getWithMetadata(key: string, opts: { type: "json"; consistency?: "strong" }): Promise<{ data: any; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<{ modified: boolean }>;
};

export const GHL_ORIGIN = "https://services.leadconnectorhq.com";
const CAS_ATTEMPTS = 24;

export type ReadBudgetRecord = {
  v: 1; budgetId: string; ceiling: number; reserved: number;
  receipts: { n: number; fn: string; path: string; at: string }[];
};

/** Nothing was sent. `exhausted`: the ceiling is reached; `unavailable`: accounting could not be confirmed; `invalid`: not a meterable request. */
export class SupplementalReadRefused extends Error {
  constructor(message: string, readonly code: "exhausted" | "unavailable" | "invalid") { super(message); }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const readBudgetKey = (scope: string, budgetId: string) => `pa/eval-reads/${sha256(`${scope}:${budgetId}`)}`;
const jitter = () => new Promise<void>((r) => setTimeout(r, 15 + Math.floor(Math.random() * 60)));

function valid(rec: any, budgetId: string, ceiling: number): rec is ReadBudgetRecord {
  return !!rec && rec.v === 1 && rec.budgetId === budgetId && rec.ceiling === ceiling && Number.isInteger(rec.reserved) && rec.reserved >= 0
    && rec.reserved <= ceiling && Array.isArray(rec.receipts) && rec.receipts.length === rec.reserved;
}

/**
 * A missing record after use must never become a fresh allowance (Bones SEQ 17 condition 2; Brad/Jess 2026-10-19:
 * elapsed time does not prove a budget was never used). So the record is created EXACTLY ONCE per budget id, by the
 * single invocation that wins the GENESIS claim: `<key>/genesis` written with onlyIfNew and acknowledged
 * modified === true. Nothing else ever creates the record -- not a loser of the race, not a later invocation, and
 * not after a deletion -- so a missing record can only be waited for (bounded) and then refused. If the winner fails
 * after claiming, the budget simply stays closed; only a reviewed config commit with a new budget id opens another.
 * No clock or time window is involved.
 */
type Genesis = { v: 1; budgetId: string; ceiling: number; at: string };

export class SupplementalReadBudget {
  readonly key: string;
  readonly genesisKey: string;
  constructor(readonly store: ReadBudgetStore, scope: string, readonly budgetId: string, readonly ceiling: number, private readonly pause: () => Promise<void> = jitter) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(budgetId) || !Number.isInteger(ceiling) || ceiling < 0) throw new SupplementalReadRefused("Invalid supplemental read budget. Nothing was sent.", "invalid");
    this.key = readBudgetKey(scope, budgetId);
    this.genesisKey = `${this.key}/genesis`;
  }

  private async get(key: string): Promise<{ data: any; etag?: string } | null> {
    try { return await this.store.getWithMetadata(key, { type: "json", consistency: "strong" }); }
    catch (e: any) {
      if (e?.name !== "BlobsConsistencyError") throw new SupplementalReadRefused("The supplemental read budget could not be read. Nothing was sent.", "unavailable");
      // Without strong consistency the read may be stale; the compare-and-swap below then simply fails and retries.
      try { return await this.store.getWithMetadata(key, { type: "json" }); } catch { throw new SupplementalReadRefused("The supplemental read budget could not be read. Nothing was sent.", "unavailable"); }
    }
  }

  private async read(): Promise<{ rec: ReadBudgetRecord | null; etag: string | null }> {
    const got = await this.get(this.key);
    if (!got) return { rec: null, etag: null };
    if (!got.etag || !valid(got.data, this.budgetId, this.ceiling)) throw new SupplementalReadRefused("The supplemental read budget record is unreadable or does not match the reviewed configuration. Nothing was sent.", "unavailable");
    return { rec: got.data, etag: got.etag };
  }

  private async genesis(): Promise<Genesis | null> {
    const got = await this.get(this.genesisKey);
    if (!got) return null;
    const g = got.data;
    if (!g || g.v !== 1 || g.budgetId !== this.budgetId || g.ceiling !== this.ceiling || !Number.isFinite(Date.parse(g.at))) {
      throw new SupplementalReadRefused("The supplemental read budget marker is unreadable or does not match the reviewed configuration. Nothing was sent.", "unavailable");
    }
    return g as Genesis;
  }

  /** One conditional write. true: applied and acknowledged. false: not applied (retry). Anything else: ambiguous -> refuse. */
  private async write(key: string, value: unknown, opts: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<boolean> {
    let res: any;
    try { res = await this.store.setJSON(key, value, opts); }
    catch { throw new SupplementalReadRefused("A supplemental read reservation could not be confirmed. Nothing was sent.", "unavailable"); }
    if (res?.modified === true) return true;
    if (res?.modified === false) return false;
    throw new SupplementalReadRefused("A supplemental read reservation returned an ambiguous acknowledgement. Nothing was sent.", "unavailable");
  }

  async snapshot(): Promise<ReadBudgetRecord | null> { return (await this.read()).rec; }

  /** Reserves ONE request and records its receipt. Returns its number; throws (nothing to be sent) otherwise. */
  async reserve(fn: string, path: string, now: string): Promise<number> {
    let openedWithoutRecord = false;
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const { rec, etag } = await this.read();
      if (!rec) {
        if (await this.genesis()) { openedWithoutRecord = true; await this.pause(); continue; }   // never (re)create
        if (this.ceiling < 1) throw new SupplementalReadRefused("The evaluation's supplemental read budget is used up. Nothing was sent.", "exhausted");
        if (!(await this.write(this.genesisKey, { v: 1, budgetId: this.budgetId, ceiling: this.ceiling, at: now } satisfies Genesis, { onlyIfNew: true }))) continue;   // another invocation claimed it
        // This invocation alone won the claim: it creates the record once, holding the first unit.
        const first: ReadBudgetRecord = { v: 1, budgetId: this.budgetId, ceiling: this.ceiling, reserved: 1, receipts: [{ n: 1, fn, path, at: now }] };
        if (await this.write(this.key, first, { onlyIfNew: true })) return 1;
        throw new SupplementalReadRefused("The supplemental read budget could not be opened; it stays closed. Nothing was sent.", "unavailable");
      }
      openedWithoutRecord = false;
      if (rec.reserved >= rec.ceiling) throw new SupplementalReadRefused("The evaluation's supplemental read budget is used up. Nothing was sent.", "exhausted");
      const n = rec.reserved + 1;
      const next: ReadBudgetRecord = { ...rec, reserved: n, receipts: [...rec.receipts, { n, fn, path, at: now }] };
      if (await this.write(this.key, next, { onlyIfMatch: etag as string })) return n;
      await this.pause();
    }
    if (openedWithoutRecord) throw new SupplementalReadRefused("The supplemental read budget record is missing after it was opened; it is never reopened. Nothing was sent.", "unavailable");
    throw new SupplementalReadRefused("The supplemental read budget could not be reserved (contention). Nothing was sent.", "unavailable");
  }
}

const store = () => getStore("iaos-write-receipts") as unknown as ReadBudgetStore;

/** True when this deployment's committed config enables the supplemental read budget (decided per invocation). */
export function supplementalReadBudgetActive(): boolean {
  return getConfig(process.env.IAOS_ENV).supplementalReadBudget.enabled === SUPPLEMENTAL_READ_BUDGET_ENABLED;
}

/**
 * The fetch for every GHL request a non-write function makes. `fn` names the function in each receipt. Read
 * per invocation, so the deployment's committed config decides. Disabled: the platform fetch, unchanged.
 */
export function ghlReadFetch(event: any, fn: string): typeof fetch {
  const env = String(process.env.IAOS_ENV);
  const config = getConfig(process.env.IAOS_ENV);
  const b = config.supplementalReadBudget;
  if (b.enabled !== SUPPLEMENTAL_READ_BUDGET_ENABLED) return ((input: any, init?: any) => fetch(input, init)) as typeof fetch;
  let budget: SupplementalReadBudget | null = null;
  return (async (input: any, init: any = {}) => {
    if (env !== "test") throw new SupplementalReadRefused("The supplemental read budget applies only in Test. Nothing was sent.", "invalid");
    let url: URL;
    try { url = new URL(String(input)); } catch { throw new SupplementalReadRefused("Unparseable request target. Nothing was sent.", "invalid"); }
    if (url.origin !== GHL_ORIGIN) throw new SupplementalReadRefused("Only GHL reads are metered here. Nothing was sent.", "invalid");
    if (String(init?.method ?? "GET").toUpperCase() !== "GET") throw new SupplementalReadRefused("Only GET is a supplemental read. Nothing was sent.", "invalid");
    if (!budget) {
      try { connectLambda(event); budget = new SupplementalReadBudget(store(), `${env}:${config.locationId}`, b.budgetId, b.ceiling); }
      catch (e) { throw e instanceof SupplementalReadRefused ? e : new SupplementalReadRefused("The supplemental read budget is unavailable. Nothing was sent.", "unavailable"); }
    }
    await budget.reserve(fn, url.pathname, new Date().toISOString());
    return fetch(input, init);
  }) as typeof fetch;
}

/** A handler's answer for a refused supplemental read (anything else: null). */
export function supplementalReadRefusal(e: unknown, headers: Record<string, string> = { "Cache-Control": "no-store" }) {
  if (!(e instanceof SupplementalReadRefused)) return null;
  return { statusCode: 503, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "not_sent", code: `supplemental_read_${e.code}`, error: e.message }) };
}
