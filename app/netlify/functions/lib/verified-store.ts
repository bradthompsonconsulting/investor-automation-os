/**
 * Storage correction (PR #131 plan v6 §2) -- the VERIFIED STORAGE ADAPTER.
 *
 * Why: in @netlify/blobs 11.1.0 a conditional `setJSON` returns
 * `{modified: status !== 412}`, so a 401, a 403 or an exhausted 5xx reports
 * `modified: true`; `fetchAndRetry` repeats 429 / >=500 / thrown requests five
 * more times with 5 s sleeps and no AbortSignal. Nothing the SDK returns is
 * trusted here. The adapter is the SDK's `fetch` option:
 *
 *  - before every network fetch it checks, synchronously, that the invocation
 *    scope is open and the phase cutoff has not passed (no I/O otherwise);
 *  - every real fetch gets AbortSignal.any([scope, timeout(min(2 s, remaining))]);
 *  - the REAL outcome (status, etag, transport error, abort, deadline) is
 *    recorded in this operation's private log BEFORE anything is returned;
 *  - for 429, >=500, any throw and any abort the SDK receives a SYNTHETIC,
 *    non-retryable response (status 499), so the SDK makes exactly one fetch
 *    and never sleeps; requests that would not use the edge URL are refused
 *    without I/O (the signed-URL 403 retry branch is never used).
 *
 * Classification and diagnostics read ONLY the log. The synthetic status never
 * appears in a class or a log line. Retries are owned here: at most 2, backoff
 * 150 / 400 ms, only when they fit before the phase cutoff, only for reads,
 * conditional writes (same condition) and identical-content overwrites.
 *
 * There is NO delete of any ownership record. The one delete in this module,
 * `discardPendingChunk`, is refused unless the store is the executed-artifact
 * UPLOAD store and the key is a pending upload session chunk (housekeeping of
 * bytes that never authorize anything).
 */
import { getStore } from "@netlify/blobs";
import { clock, InvocationScope, ScopeClosed, STORAGE_REQUEST_TIMEOUT_MS, STORAGE_RETRY_DELAYS_MS } from "./invocation-scope";
import { diag, type DiagClass, type DiagPhase } from "./diagnostics";

/** The v2 ownership store (plan v6 §8.1 M1). v2 never writes `iaos-write-receipts`. */
export const OWNERSHIP_STORE = "iaos-ownership-v2";
/** The pre-v2 store, read ONLY by the legacy import (never written by v2). */
export const LEGACY_STORE = "iaos-write-receipts";
/** The executed-artifact stores (bytes only; never authorization). */
export const UPLOADS_STORE = "iaos-executed-artifact-uploads";
export const ARTIFACTS_STORE = "iaos-executed-artifacts";

/** The outcome of a storage step is not known: callers fail closed. */
export class StorageUncertain extends Error {
  constructor(readonly phase: DiagPhase, readonly cls: DiagClass, readonly status?: number) { super(`Storage outcome uncertain (${phase}: ${cls})`); this.name = "StorageUncertain"; }
}
/** A strong read was not observed on the uncached origin. */
export class StrongReadUnavailable extends StorageUncertain {
  constructor(phase: DiagPhase) { super(phase, "strong_unavailable"); this.name = "StrongReadUnavailable"; }
}

export type BlobsContext = { edgeURL?: string; uncachedEdgeURL?: string; siteID?: string; token?: string; deployID?: string; primaryRegion?: string };
export function blobsContext(env: Record<string, string | undefined> = process.env): BlobsContext | null {
  const raw = (globalThis as any).netlifyBlobsContext || env.NETLIFY_BLOBS_CONTEXT;
  if (typeof raw !== "string" || !raw) return null;
  try { const v = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); return v && typeof v === "object" ? v : null; } catch { return null; }
}
const httpsOrigin = (u: unknown): string | null => {
  if (typeof u !== "string" || !u) return null;
  try { const p = new URL(u); return p.protocol === "https:" ? p.origin : null; } catch { return null; }
};

type Failure = "transport" | "timeout" | "abort" | "deadline" | "closed" | "not_edge";
export type Observation = { origin: "uncached" | "edge" | "other"; method: string; status?: number; etag?: string | null; failure?: Failure };

const SYNTHETIC_STATUS = 499;
const synthetic = () => new Response(null, { status: SYNTHETIC_STATUS, statusText: "iaos-synthetic-terminal" });

/** Test hook: the transport the adapter wraps (the wire harness in tests; global fetch otherwise). */
export const transport: { fetch: typeof fetch | null } = { fetch: null };

function classOf(o: Observation): DiagClass {
  if (o.failure === "deadline" || o.failure === "closed" || o.failure === "timeout") return "deadline";
  if (o.failure === "abort") return "abandoned";
  if (o.failure === "transport") return "transport";
  if (o.failure === "not_edge") return "unexpected";
  if (o.status === 401 || o.status === 403) return "auth_refused";
  if (o.status === 429) return "rate_limited";
  if (o.status !== undefined && o.status >= 500) return "server_error";
  if (o.status === 412) return "conflict";
  return "unexpected";
}
const retryable = (o: Observation) => o.failure === "transport" || o.status === 429 || (o.status !== undefined && o.status >= 500);

export type WriteResult = { result: "written"; etag: string } | { result: "conflict" };
export type ReadResult<T = any> = { data: T; etag: string } | null;

export class VerifiedStore {
  readonly ctx: BlobsContext | null;
  private readonly uncachedOrigin: string | null;
  private readonly edgeOrigin: string | null;
  /** Total real fetches issued (for tests and capability evidence). */
  fetches = 0;
  constructor(readonly scope: InvocationScope, readonly name: string = OWNERSHIP_STORE, ctx: BlobsContext | null = blobsContext(), private readonly readOnly = false) {
    this.ctx = ctx;
    this.uncachedOrigin = httpsOrigin(ctx?.uncachedEdgeURL);
    this.edgeOrigin = httpsOrigin(ctx?.edgeURL);
  }
  /** The context is present, both URLs are https and the store can be built. Not proof of anything. */
  get configured(): boolean { return !!(this.ctx && this.uncachedOrigin && this.edgeOrigin && this.ctx.siteID && this.ctx.token); }

  private sdk(log: Observation[]) {
    const ctx = this.ctx ?? {};
    const scope = this.scope;
    const self = this;
    const wrapped = async (input: any, init?: any): Promise<Response> => {
      const url = typeof input === "string" ? input : String(input?.url ?? input);
      let origin: Observation["origin"] = "other";
      try { const o = new URL(url).origin; origin = o === self.uncachedOrigin ? "uncached" : o === self.edgeOrigin ? "edge" : "other"; } catch { origin = "other"; }
      const method = String(init?.method ?? "GET").toUpperCase();
      const ob: Observation = { origin, method };
      log.push(ob);
      if (origin === "other") { ob.failure = "not_edge"; return synthetic(); }
      try { scope.assertMayStart(); }
      catch (e) { ob.failure = e instanceof ScopeClosed && e.reason === "deadline" ? "deadline" : "closed"; return synthetic(); }
      const timeoutMs = Math.max(1, Math.min(STORAGE_REQUEST_TIMEOUT_MS, scope.remaining()));
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = AbortSignal.any([scope.signal, timeout]);
      const real = transport.fetch ?? globalThis.fetch;
      let res: Response;
      self.fetches++;
      try { res = await real(url, { ...init, signal }); }
      catch {
        ob.failure = scope.signal.aborted ? "abort" : timeout.aborted ? "timeout" : "transport";
        return synthetic();
      }
      ob.status = res.status;
      ob.etag = res.headers.get("etag");
      if (res.status === 429 || res.status >= 500) { try { await res.body?.cancel(); } catch { /* ignore */ } return synthetic(); }
      return res;
    };
    return getStore({ name: this.name, consistency: "strong", fetch: wrapped as any, siteID: ctx.siteID ?? "unconfigured", token: ctx.token ?? "unconfigured", edgeURL: ctx.edgeURL, uncachedEdgeURL: ctx.uncachedEdgeURL } as any);
  }

  private async attempt<T>(call: (store: ReturnType<typeof getStore>) => Promise<T>): Promise<{ log: Observation[]; value?: T; threw: boolean }> {
    const log: Observation[] = [];
    try {
      if (!this.ctx) return { log, threw: true };
      const value = await call(this.sdk(log));
      return { log, value, threw: false };
    } catch { return { log, threw: true }; }
  }
  /** Waits before an adapter retry only if the retry still fits before the cutoff. */
  private async mayRetry(i: number): Promise<boolean> {
    if (i >= STORAGE_RETRY_DELAYS_MS.length) return false;
    const wait = STORAGE_RETRY_DELAYS_MS[i];
    if (!this.scope.isOpen || clock.now() + wait + 50 > this.scope.cutoff()) return false;
    await new Promise((r) => setTimeout(r, wait));
    return this.scope.isOpen && clock.now() < this.scope.cutoff();
  }
  private fail(phase: DiagPhase, o: Observation | undefined, cls?: DiagClass): never {
    const c = cls ?? (o ? classOf(o) : "unexpected");
    diag({ fn: this.scope.fn, action: "storage", phase, class: c, ...(o?.status !== undefined ? { status: o.status } : {}) });
    throw new StorageUncertain(phase, c, o?.status);
  }

  /**
   * Strong read. Counts only a real 200 (with an etag) or 404 observed on the
   * uncachedEdgeURL origin; anything else is StorageUncertain / StrongReadUnavailable.
   */
  async read<T = any>(key: string, phase: DiagPhase = "storage_read"): Promise<ReadResult<T>> {
    for (let i = 0; ; i++) {
      const a = await this.attempt((s) => s.getWithMetadata(key, { type: "text", consistency: "strong" } as any) as Promise<any>);
      const o = a.log[a.log.length - 1];
      if (a.log.length === 0) { diag({ fn: this.scope.fn, action: "storage", phase, class: "strong_unavailable" }); throw new StrongReadUnavailable(phase); }
      if (a.log.length === 1 && o.origin === "uncached" && o.status === 404 && !a.threw) return null;
      if (a.log.length === 1 && o.origin === "uncached" && o.status === 200 && !a.threw && o.etag) {
        const got = a.value as { data: string; etag?: string } | null;
        if (!got || typeof got.data !== "string") this.fail(phase, o, "unexpected");
        let data: any;
        try { data = JSON.parse(got!.data); } catch { this.fail(phase, o, "unexpected"); }
        return { data, etag: o.etag };
      }
      if (a.log.length === 1 && o.origin !== "uncached" && !o.failure) { diag({ fn: this.scope.fn, action: "storage", phase, class: "strong_unavailable" }); throw new StrongReadUnavailable(phase); }
      if (a.log.length === 1 && retryable(o) && (await this.mayRetry(i))) continue;
      this.fail(phase, o);
    }
  }
  async readData<T = any>(key: string, phase?: DiagPhase): Promise<T | null> { const r = await this.read<T>(key, phase); return r ? r.data : null; }

  /**
   * Conditional write. `written` only for a single real 200 with an etag;
   * `conflict` only for 412s with no ambiguous attempt before them; anything else
   * throws StorageUncertain -- never a "modified" guess.
   */
  async conditionalWrite(key: string, value: unknown, cond: { onlyIfNew: true } | { onlyIfMatch: string }, phase: DiagPhase = "storage_write"): Promise<WriteResult> {
    if (this.readOnly) this.fail(phase, undefined, "unexpected");
    if ("onlyIfMatch" in cond && (typeof cond.onlyIfMatch !== "string" || !cond.onlyIfMatch)) this.fail(phase, undefined, "unexpected");
    let ambiguous = false;
    for (let i = 0; ; i++) {
      const a = await this.attempt((s) => s.setJSON(key, value, cond as any));
      const o = a.log[a.log.length - 1];
      if (a.log.length !== 1 || !o) this.fail(phase, o, a.log.length === 0 ? "unexpected" : undefined);
      if (o.origin !== "edge" && o.origin !== "uncached") this.fail(phase, o, "unexpected");
      if (o.status === 200 && o.etag && !o.failure) return { result: "written", etag: o.etag };
      if (o.status === 412 && !o.failure) {
        if (ambiguous) this.fail(phase, o, "ack_ambiguous");
        return { result: "conflict" };
      }
      if (retryable(o)) { ambiguous = true; if (await this.mayRetry(i)) continue; }
      this.fail(phase, o);
    }
  }
  async createOnce(key: string, value: unknown, phase?: DiagPhase): Promise<WriteResult> { return this.conditionalWrite(key, value, { onlyIfNew: true }, phase); }
  /** Compare-and-swap from the etag that was read (null = the key was absent). */
  async cas(key: string, value: unknown, etag: string | null, phase?: DiagPhase): Promise<WriteResult> {
    return this.conditionalWrite(key, value, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag }, phase);
  }

  /**
   * Publishes a write-once record and VERIFIES it: a conditional create, then a
   * strong read-back compared with `same`. An unclear write rereads the SAME key
   * and never allocates a new identity; a conflict verifies the existing record.
   */
  async writeOnceVerified<T>(key: string, value: T, same: (got: any) => boolean, phase: DiagPhase = "storage_write"): Promise<T> {
    let uncertain: StorageUncertain | null = null;
    try { await this.createOnce(key, value, phase); } catch (e) { if (e instanceof StorageUncertain) uncertain = e; else throw e; }
    const got = await this.read(key, phase);
    if (!got) { diag({ fn: this.scope.fn, action: "storage", phase, class: "readback_missing" }); throw uncertain ?? new StorageUncertain(phase, "readback_missing"); }
    if (!same(got.data)) { diag({ fn: this.scope.fn, action: "storage", phase, class: "readback_mismatch" }); throw new RecordMismatch("A record already exists with different content"); }
    return got.data as T;
  }

  /** Unconditional overwrite with IDENTICAL content only (evidence archives). Never used for authorization. */
  async putIdentical(key: string, value: unknown, phase: DiagPhase = "storage_write"): Promise<void> {
    if (this.readOnly) this.fail(phase, undefined, "unexpected");
    for (let i = 0; ; i++) {
      const a = await this.attempt((s) => s.setJSON(key, value));
      const o = a.log[a.log.length - 1];
      if (a.log.length === 1 && o && o.status === 200 && !o.failure && (o.origin === "edge" || o.origin === "uncached")) return;
      if (a.log.length === 1 && o && retryable(o) && (await this.mayRetry(i))) continue;
      this.fail(phase, o);
    }
  }

  /** Binary strong read (artifact chunks). */
  async readBinary(key: string, phase: DiagPhase = "storage_read"): Promise<{ data: ArrayBuffer; etag: string; metadata: Record<string, unknown> } | null> {
    for (let i = 0; ; i++) {
      const a = await this.attempt((s) => s.getWithMetadata(key, { type: "arrayBuffer", consistency: "strong" } as any) as Promise<any>);
      const o = a.log[a.log.length - 1];
      if (a.log.length === 0) throw new StrongReadUnavailable(phase);
      if (a.log.length === 1 && o.origin === "uncached" && o.status === 404 && !a.threw) return null;
      if (a.log.length === 1 && o.origin === "uncached" && o.status === 200 && !a.threw && o.etag && a.value) {
        const v = a.value as any;
        return { data: v.data as ArrayBuffer, etag: o.etag, metadata: (v.metadata ?? {}) as Record<string, unknown> };
      }
      if (a.log.length === 1 && o.origin !== "uncached" && !o.failure) throw new StrongReadUnavailable(phase);
      if (a.log.length === 1 && retryable(o) && (await this.mayRetry(i))) continue;
      this.fail(phase, o);
    }
  }
  /** Binary conditional create (artifact chunks / final artifact). */
  async createBinaryOnce(key: string, data: ArrayBuffer | Uint8Array, metadata: Record<string, unknown>, phase: DiagPhase = "storage_write"): Promise<WriteResult> {
    if (this.readOnly) this.fail(phase, undefined, "unexpected");
    let ambiguous = false;
    for (let i = 0; ; i++) {
      const a = await this.attempt((s) => s.set(key, data as any, { metadata, onlyIfNew: true } as any));
      const o = a.log[a.log.length - 1];
      if (a.log.length !== 1 || !o) this.fail(phase, o);
      if (o.status === 200 && o.etag && !o.failure && o.origin !== "other") return { result: "written", etag: o.etag };
      if (o.status === 412 && !o.failure) { if (ambiguous) this.fail(phase, o, "ack_ambiguous"); return { result: "conflict" }; }
      if (retryable(o)) { ambiguous = true; if (await this.mayRetry(i)) continue; }
      this.fail(phase, o);
    }
  }
  /** Strong metadata read (HEAD) on the uncached origin. */
  async readMeta(key: string, phase: DiagPhase = "storage_read"): Promise<{ etag: string; metadata: Record<string, unknown> } | null> {
    for (let i = 0; ; i++) {
      const a = await this.attempt((s) => s.getMetadata(key, { consistency: "strong" } as any) as Promise<any>);
      const o = a.log[a.log.length - 1];
      if (a.log.length === 0) throw new StrongReadUnavailable(phase);
      if (a.log.length === 1 && o.origin === "uncached" && o.status === 404 && !a.threw) return null;
      if (a.log.length === 1 && o.origin === "uncached" && o.status === 200 && !a.threw && o.etag && a.value) return { etag: o.etag, metadata: ((a.value as any).metadata ?? {}) as Record<string, unknown> };
      if (a.log.length === 1 && o.origin !== "uncached" && !o.failure) throw new StrongReadUnavailable(phase);
      if (a.log.length === 1 && retryable(o) && (await this.mayRetry(i))) continue;
      this.fail(phase, o);
    }
  }
  /** Housekeeping ONLY: discards a pending upload chunk. Refused for any other store or key. Never throws. */
  async discardPendingChunk(key: string): Promise<boolean> {
    if (this.readOnly || this.name !== UPLOADS_STORE || !/^sessions\/[^/]+\/[^/]+\/[^/]+\/chunk-\d+$/.test(key)) return false;
    const a = await this.attempt((s) => s.delete(key));
    const o = a.log[a.log.length - 1];
    return a.log.length === 1 && !a.threw && !!o && (o.status === 200 || o.status === 204 || o.status === 404);
  }
  /** Lists keys under a prefix. Every page must be a real 200 on the edge or uncached origin. */
  async list(prefix: string, phase: DiagPhase = "storage_read"): Promise<string[]> {
    for (let i = 0; ; i++) {
      const a = await this.attempt((s) => s.list({ prefix }) as Promise<any>);
      const bad = a.log.find((o) => o.failure || (o.status !== 200 && o.status !== 404) || o.origin === "other");
      if (!a.threw && a.log.length >= 1 && !bad) return ((a.value as any).blobs as { key: string }[]).map((b) => b.key).sort();
      if (a.log.length >= 1 && a.log.every((o) => o.status === 404 && !o.failure && o.origin !== "other")) return [];
      if (bad && retryable(bad) && (await this.mayRetry(i))) continue;
      this.fail(phase, bad ?? a.log[a.log.length - 1]);
    }
  }

  // ── BarrierStore compatibility (lib/current-offer-barrier.ts, lib/call-log-barrier.ts) ──
  /** Always strong. Never falls back to an eventual read. */
  async get(key: string, _options?: unknown): Promise<any> { return this.readData(key, phaseOfKey(key, "read")); }
  async getWithMetadata(key: string, _options?: unknown): Promise<{ data: any; etag?: string } | null> { return this.read(key, phaseOfKey(key, "read")); }
  /**
   * Conditional writes only. `modified: true` means a VALIDATED write (a real 200
   * with an etag); `modified: false` means a clean 412 conflict; anything else
   * throws StorageUncertain. An unconditional call is refused.
   */
  async setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<{ modified: boolean; etag?: string }> {
    const phase = phaseOfKey(key, "write");
    if (options?.onlyIfMatch) { const r = await this.conditionalWrite(key, value, { onlyIfMatch: options.onlyIfMatch }, phase); return r.result === "written" ? { modified: true, etag: r.etag } : { modified: false }; }
    if (options?.onlyIfNew) { const r = await this.conditionalWrite(key, value, { onlyIfNew: true }, phase); return r.result === "written" ? { modified: true, etag: r.etag } : { modified: false }; }
    this.fail(phase, undefined, "unexpected");
  }
}

/** A write-once record already exists with different content. */
export class RecordMismatch extends Error { constructor(m: string) { super(m); this.name = "RecordMismatch"; } }

/** Maps a key to its diagnostics phase (never logs the key itself). */
export function phaseOfKey(key: string, kind: "read" | "write"): DiagPhase {
  if (kind === "read") return "storage_read";
  if (/\/op\//.test(key)) return "op_publish";
  if (/\/attempt\//.test(key)) return "attempt_publish";
  if (/\/binding\//.test(key)) return "binding_publish";
  if (/\/head\//.test(key)) return "head_cas";
  if (/\/decision\//.test(key)) return "decision_claim";
  if (/\/outcome\//.test(key)) return "outcome_record";
  if (/\/final\//.test(key)) return "final_record";
  if (/^lock2\//.test(key)) return "lock_acquire";
  if (/^stage-unresolved\//.test(key)) return "stage_marker_claim";
  if (/^authz\/admission$/.test(key)) return "admission";
  if (/^authz\/receipt\//.test(key)) return "receipt";
  return "storage_write";
}
