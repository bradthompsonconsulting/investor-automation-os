/**
 * B15-04 controlled Test evaluation -- the ENFORCED request budget and the
 * bounded GHL transport for netlify/functions/property-answer.ts (Bones's
 * review of 525d7c2, F4).
 *
 * ONE record per configured budget id, changed only by compare-and-swap:
 *   pa/eval-budget/<digest(scope:budgetId)> =
 *     { v, budgetId, ceiling, reserved, calls, stopped: null | { at, reason },
 *       grants:   [{ g, action, planned, at, holder, settled: null | { at, result, proof? } }],
 *       attempts: [{ n, g, method, path, at }] }
 *
 * - Every action first reserves its PLANNED request count (`grant`). The grant
 *   is refused, and nothing is sent, if the budget is stopped or the
 *   reservation would pass the ceiling. A save therefore never starts unless
 *   all of its requests are available: running out cannot strand a sent PUT.
 * - Every GHL request then draws one unit from its grant, and its attempt
 *   receipt is recorded durably BEFORE it is sent. Exceeding the grant, a
 *   stopped budget or an unconfirmed receipt refuses the request unsent.
 * - `stop` closes the budget for good: only a reviewed config commit with a
 *   new budget id opens another. Nothing here reopens or enlarges a budget.
 * - FAIL-CLOSED (Bones's b729e33 re-review): every grant is born UNSETTLED and
 *   a new grant is refused while any earlier grant is unsettled. An action
 *   ends by settling its own grant "clean" (only after an expected result) or
 *   by `stop`. A crash, an unconfirmed stop or an unconfirmed settle therefore
 *   leaves the budget closed for every later invocation; no in-memory flag is
 *   relied on across invocations.
 * - CONTINUATION (Bones's focused review of 3ad29ba, F4b). A PERSISTED clean
 *   settlement is not an ACKNOWLEDGED one: the store can apply a write and
 *   still fail to acknowledge it, and no further write can prove the
 *   acknowledgement, because that write can be lost the same way. So a clean
 *   record alone grants nothing. `settle` stores only a digest of a fresh
 *   random secret; the endpoint hands the secret to the client (an HttpOnly
 *   cookie) ONLY after `settle` returned acknowledged. A later grant must
 *   present the secret for the LATEST grant. An unacknowledged settlement
 *   issues no secret, so no invocation, warm or fresh, can continue it.
 * - HOLDER (Bones's review of 7369842). Every grant records a digest of the
 *   server-validated writer AND the exact write session that took it. A later
 *   grant must come from the same writer in the same session as the latest
 *   grant, as well as present its secret: another valid session -- including
 *   another allowed writer -- is refused before anything is sent.
 *
 * Transport (every evaluation GHL request): only https://services.leadconnectorhq.com,
 * redirect "error" plus a refusal of any 3xx or redirected response, one
 * 15-second deadline over headers AND body, and a 1 MiB body cap. A refused or
 * failed request is never retried here.
 */
import { digest } from "./ghl-write-boundary";
import type { BarrierStore } from "./current-offer-barrier";

export const GHL_ORIGIN = "https://services.leadconnectorhq.com";
export const REQUEST_DEADLINE_MS = 15_000;
export const BODY_LIMIT_BYTES = 1024 * 1024;
const CAS_ATTEMPTS = 4;

export type BudgetRecord = {
  v: 4; budgetId: string; ceiling: number; reserved: number; calls: number;
  stopped: null | { at: string; reason: string };
  grants: { g: number; action: string; planned: number; at: string; holder: string; settled: null | { at: string; result: "clean" | "stopped"; proof?: string } }[];
  attempts: { n: number; g: number; method: string; path: string; at: string }[];
};

/** The budget refused a reservation (grant: before the action dispatched anything) or one request (draw: earlier requests of the same action may have been sent). */
export class BudgetRefused extends Error { constructor(message: string, readonly code: "stopped" | "exhausted" | "grant_exceeded" | "unsettled" | "unacknowledged" | "session_mismatch") { super(message); } }
/** The transport refused a response (redirect, oversize, timeout) or the target origin. */
export class TransportRefused extends Error {}

export const budgetKey = (scope: string, budgetId: string) => `pa/eval-budget/${digest(`${scope}:${budgetId}`)}`;

async function read(store: BarrierStore, key: string): Promise<{ rec: BudgetRecord | null; etag: string | null }> {
  let got: { data: any; etag?: string } | null;
  try { got = await store.getWithMetadata(key, { type: "json", consistency: "strong" }); }
  catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw new BudgetRefused("The request budget could not be read", "unsettled");
    try { got = await store.getWithMetadata(key, { type: "json" }); } catch { throw new BudgetRefused("The request budget could not be read", "unsettled"); }
  }
  if (!got) return { rec: null, etag: null };
  if (!got.etag || !got.data || got.data.v !== 4) throw new BudgetRefused("The request budget record is unreadable", "unsettled");
  return { rec: got.data as BudgetRecord, etag: got.etag };
}
async function cas(store: BarrierStore, key: string, etag: string | null, next: BudgetRecord): Promise<boolean> {
  try { return (await store.setJSON(key, next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag })).modified; }
  catch { throw new BudgetRefused("A request-budget write could not be confirmed", "unsettled"); }
}

const fresh = (budgetId: string, ceiling: number): BudgetRecord => ({ v: 4, budgetId, ceiling, reserved: 0, calls: 0, stopped: null, grants: [], attempts: [] });

export class EvaluationBudget {
  readonly key: string;
  constructor(readonly store: BarrierStore, scope: string, readonly budgetId: string, readonly ceiling: number) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(budgetId) || !Number.isInteger(ceiling) || ceiling < 0) throw new Error("Invalid evaluation budget");
    this.key = budgetKey(scope, budgetId);
  }
  async snapshot(): Promise<BudgetRecord | null> { return (await read(this.store, this.key)).rec; }
  private proof(g: number, secret: string) { return digest(`${this.key}:continuation:${g}:${secret}`); }
  /** `identity` is server-validated (writer + write session); only its digest is stored. */
  /** C1–C4 r4: the holder digest this identity would carry, for stored-access comparison. Reads nothing. */
  holderDigest(identity: string) { return this.holder(identity); }
  /** C1–C4 r4: the latest grant's holder, read-only (null when there is no record or no grant). Throws when unreadable. */
  async latestHolder(): Promise<string | null> {
    const { rec } = await read(this.store, this.key);
    const last = rec?.grants[rec.grants.length - 1];
    return last ? last.holder : null;
  }
  private holder(identity: string) {
    if (typeof identity !== "string" || !identity) throw new BudgetRefused("No validated write session for the evaluation.", "session_mismatch");
    return digest(`${this.key}:holder:${identity}`);
  }

  /**
   * Reserves `planned` requests for one action. Refused (nothing sent) if
   * stopped, unsettled, over the ceiling, or -- once any grant exists -- if
   * `continuation` is not the acknowledged secret of the LATEST grant, or
   * `identity` (server-validated writer + write session) is not the one that
   * took the LATEST grant.
   */
  async grant(action: string, planned: number, now: string, continuation: string | null, identity: string): Promise<Grant> {
    const holder = this.holder(identity);
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const { rec, etag } = await read(this.store, this.key);
      const cur: BudgetRecord = rec ?? fresh(this.budgetId, this.ceiling);
      if (cur.ceiling !== this.ceiling || cur.budgetId !== this.budgetId) throw new BudgetRefused("The request budget record does not match the reviewed configuration", "unsettled");
      if (cur.stopped) throw new BudgetRefused(`The evaluation is stopped (${cur.stopped.reason}).`, "stopped");
      if (cur.grants.some((x) => x.settled === null)) throw new BudgetRefused("An earlier evaluation action did not settle; the evaluation stays closed.", "unsettled");
      const last = cur.grants[cur.grants.length - 1];
      if (last && last.holder !== holder) throw new BudgetRefused("This evaluation belongs to another write session.", "session_mismatch");
      if (last && !this.continues(last, continuation)) throw new BudgetRefused("The last evaluation action's settlement was not acknowledged to this browser; the evaluation stays closed.", "unacknowledged");
      if (cur.reserved + planned > cur.ceiling) throw new BudgetRefused("The evaluation request budget is used up.", "exhausted");
      const g = cur.grants.length + 1;
      const next: BudgetRecord = { ...cur, reserved: cur.reserved + planned, grants: [...cur.grants, { g, action, planned, at: now, holder, settled: null }] };
      if (await cas(this.store, this.key, etag, next)) return new Grant(this, g, planned);
    }
    throw new BudgetRefused("The request budget could not be reserved", "unsettled");
  }

  /**
   * Closes the budget (first reason wins) and marks grant g as stopped. If this
   * write fails or is ambiguous, grant g stays unsettled, which keeps the
   * budget closed anyway (fail-closed).
   */
  async stop(reason: string, now: string, g?: number): Promise<boolean> {
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const { rec, etag } = await read(this.store, this.key);
      const cur: BudgetRecord = rec ?? fresh(this.budgetId, this.ceiling);
      const grants = cur.grants.map((x) => (x.g === g && x.settled === null ? { ...x, settled: { at: now, result: "stopped" as const } } : x));
      if (cur.stopped && grants.every((x, k) => x === cur.grants[k])) return true;
      if (await cas(this.store, this.key, etag, { ...cur, stopped: cur.stopped ?? { at: now, reason }, grants })) return true;
    }
    return false;
  }

  private continues(last: BudgetRecord["grants"][number], continuation: string | null): boolean {
    const m = typeof continuation === "string" ? /^([1-9][0-9]{0,5})\.([A-Za-z0-9_-]{43})$/.exec(continuation) : null;
    return !!m && Number(m[1]) === last.g && last.settled?.result === "clean" && typeof last.settled.proof === "string" && last.settled.proof === this.proof(last.g, m[2]);
  }

  /**
   * Settles grant g as clean, storing only the digest of `secret`. Returns true
   * ONLY when this write was acknowledged; false or a throw means unacknowledged
   * (it may still have been applied), and the caller must not hand out `secret`.
   */
  async settle(g: number, secret: string, now: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Invalid continuation secret");
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const { rec, etag } = await read(this.store, this.key);
      const mine = rec?.grants.find((x) => x.g === g);
      if (!rec || !mine || mine.settled !== null) return false;
      const grants = rec.grants.map((x) => (x.g === g ? { ...x, settled: { at: now, result: "clean" as const, proof: this.proof(g, secret) } } : x));
      if (await cas(this.store, this.key, etag, { ...rec, grants })) return true;
    }
    return false;
  }

  /** Records one attempt receipt for grant g BEFORE its request is sent. */
  async draw(g: number, planned: number, method: string, path: string, now: string): Promise<number> {
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const { rec, etag } = await read(this.store, this.key);
      if (!rec) throw new BudgetRefused("The request budget is missing", "unsettled");
      if (rec.stopped) throw new BudgetRefused(`The evaluation is stopped (${rec.stopped.reason}). A GHL request was refused before sending.`, "stopped");
      const mine = rec.grants.find((x) => x.g === g);
      if (!mine || mine.settled !== null) throw new BudgetRefused("This action's grant is missing or already settled. A GHL request was refused before sending.", "stopped");
      const used = rec.attempts.filter((a) => a.g === g).length;
      if (used >= planned) throw new BudgetRefused("This action has used all of its planned requests. A GHL request was refused before sending.", "grant_exceeded");
      const n = rec.calls + 1;
      if (await cas(this.store, this.key, etag, { ...rec, calls: n, attempts: [...rec.attempts, { n, g, method, path, at: now }] })) return n;
    }
    throw new BudgetRefused("The request receipt could not be recorded. A GHL request was refused before sending.", "unsettled");
  }
}

export class Grant {
  /**
   * Set by the first refusal OR failure of any request (budget, transport, or a
   * generic network error): every later request of this action is refused unsent.
   */
  refused: Error | null = null;
  constructor(readonly budget: EvaluationBudget, readonly g: number, readonly planned: number) {}
  /** A fetch for GhlBoundary: receipt first, then one bounded request. */
  fetcher(now: () => string, baseFetch: typeof fetch = fetch): typeof fetch {
    return (async (input: any, init: any = {}) => {
      if (this.refused) throw new BudgetRefused("An earlier request of this action was refused; nothing more is sent.", "stopped");
      try {
        const url = new URL(String(input));
        if (url.origin !== GHL_ORIGIN) throw new TransportRefused("Only GHL may be called");
        await this.budget.draw(this.g, this.planned, String(init.method ?? "GET"), url.pathname, now());
        return await boundedRequest(baseFetch, url.toString(), init);
      } catch (e) {
        this.refused = e instanceof Error ? e : new TransportRefused("request failed");
        throw e;
      }
    }) as typeof fetch;
  }
}

/** One request: redirect refused, one deadline over headers and body, body capped. Returns a plain Response. */
export async function boundedRequest(baseFetch: typeof fetch, url: string, init: any, deadlineMs = REQUEST_DEADLINE_MS): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new TransportRefused("timeout")); controller.abort(); }, deadlineMs); });
  try {
    return await Promise.race([deadline, (async () => {
      const res: any = await baseFetch(url, { ...init, redirect: "error", signal: controller.signal });
      if ((res.status >= 300 && res.status < 400) || res.redirected) throw new TransportRefused("redirect refused");
      let text: string;
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > BODY_LIMIT_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } throw new TransportRefused("response too large"); }
          chunks.push(value);
        }
        text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
      } else {
        text = await res.text();
        if (Buffer.byteLength(text, "utf8") > BODY_LIMIT_BYTES) throw new TransportRefused("response too large");
      }
      return new Response([101, 204, 205, 304].includes(res.status) ? null : text, { status: res.status, headers: { "Content-Type": "application/json" } });
    })()]);
  } catch (e) {
    if (timedOut || e instanceof TransportRefused) throw e instanceof TransportRefused ? e : new TransportRefused("timeout");
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}
