/**
 * Storage correction (PR #131 plan v6 §7, amendments r1–r4) -- the per-invocation
 * scope: deadlines fixed at handler entry, a synchronous clock check before every
 * network request, and the private claim token of this invocation.
 *
 * Nothing here relies on timers or on `finally` running: every storage fetch,
 * every GHL request and every dispatch reads the clock and `closed` synchronously
 * immediately before it is issued. After `T_abs` nothing reaches the network.
 */
import { createHash, randomBytes } from "node:crypto";

export type EndpointName =
  | "call-log-barrier" | "current-offer-barrier" | "ghl-write" | "ghl-disposition"
  | "ghl-executed-artifact-upload" | "ghl-executed-artifact-upload:finalize"
  | "iaos-activation" | "iaos-cutover" | "storage-probe" | "probe-limit";

/** Pinned budget rows (plan v6 §7). Milliseconds from handler entry. They require an observed L_obs >= 30 s. */
export type Budget = { work: number; ghlTimeout: number | null; dispatch: number | null; clean: number; abs: number; contactCheck?: number };
export const BUDGETS: Record<EndpointName, Budget> = {
  "call-log-barrier": { work: 20_000, ghlTimeout: 10_000, dispatch: 10_000, clean: 25_000, abs: 26_000 },
  "current-offer-barrier": { work: 20_000, ghlTimeout: 10_000, dispatch: 10_000, clean: 25_000, abs: 26_000 },
  "ghl-write": { work: 20_000, ghlTimeout: 10_000, dispatch: 10_000, clean: 25_000, abs: 26_000 },
  "ghl-disposition": { work: 20_000, ghlTimeout: 10_000, dispatch: 10_000, clean: 25_000, abs: 26_000, contactCheck: 5_000 },
  "ghl-executed-artifact-upload": { work: 20_000, ghlTimeout: null, dispatch: null, clean: 25_000, abs: 26_000 },
  "ghl-executed-artifact-upload:finalize": { work: 20_000, ghlTimeout: 12_000, dispatch: 8_000, clean: 25_000, abs: 26_000 },
  "iaos-activation": { work: 20_000, ghlTimeout: null, dispatch: null, clean: 25_000, abs: 26_000 },
  "iaos-cutover": { work: 20_000, ghlTimeout: null, dispatch: null, clean: 25_000, abs: 26_000 },
  "storage-probe": { work: 20_000, ghlTimeout: null, dispatch: null, clean: 25_000, abs: 26_000 },
  "probe-limit": { work: 55_000, ghlTimeout: null, dispatch: null, clean: 58_000, abs: 59_000 },
};
/** Every storage request: min(2 s, remaining to the cutoff). At most 2 adapter retries. */
export const STORAGE_REQUEST_TIMEOUT_MS = 2_000;
export const STORAGE_RETRY_DELAYS_MS = [150, 400] as const;

export class ScopeClosed extends Error { constructor(readonly reason: "closed" | "deadline" | "cancelled") { super(`Invocation scope refused I/O (${reason})`); } }

export type Phase = "work" | "clean";

/** Injectable clock, for tests only. Production code always reads Date.now(). */
export const clock = { now: () => Date.now() };

export class InvocationScope {
  readonly startedAt: number;
  readonly deadlines: { work: number; dispatch: number | null; clean: number; abs: number; ghlTimeout: number | null; contactCheck: number | null };
  private closedReason: "closed" | "cancelled" | null = null;
  private readonly controller = new AbortController();
  /** Set once the invocation has dispatched (or is cleaning up): later storage work uses the cleanup cutoff. */
  private cleanup = false;
  /** Private 256-bit claim token. Never stored, logged or returned; only H(token‖…) leaves this object. */
  readonly #token: Buffer = randomBytes(32);
  /** One owned dispatch per invocation (plan v6 §3). */
  dispatchLatch = false;

  constructor(readonly fn: EndpointName, startedAt = clock.now()) {
    const b = BUDGETS[fn];
    this.startedAt = startedAt;
    this.deadlines = {
      work: startedAt + b.work,
      dispatch: b.dispatch === null ? null : startedAt + b.dispatch,
      clean: startedAt + b.clean,
      abs: startedAt + b.abs,
      ghlTimeout: b.ghlTimeout,
      contactCheck: b.contactCheck === undefined ? null : startedAt + b.contactCheck,
    };
  }
  get signal(): AbortSignal { return this.controller.signal; }
  get isOpen(): boolean { return this.closedReason === null && clock.now() <= this.deadlines.abs; }
  close(reason: "closed" | "cancelled" = "closed") { if (!this.closedReason) { this.closedReason = reason; this.controller.abort(); } }
  enterCleanup() { this.cleanup = true; }
  get inCleanup() { return this.cleanup; }
  /** The cutoff for ordinary storage work right now. */
  cutoff(phase: Phase = this.cleanup ? "clean" : "work"): number { return Math.min(phase === "clean" ? this.deadlines.clean : this.deadlines.work, this.deadlines.abs); }
  remaining(phase?: Phase): number { return this.cutoff(phase) - clock.now(); }
  /** Synchronous: throws unless network I/O may start now. */
  assertMayStart(phase?: Phase): void {
    if (this.closedReason) throw new ScopeClosed(this.closedReason === "cancelled" ? "cancelled" : "closed");
    const now = clock.now();
    if (now > this.deadlines.abs || now > this.cutoff(phase)) throw new ScopeClosed("deadline");
  }
  /** Synchronous: throws unless a GHL dispatch may start now (now <= T_dispatch). */
  assertMayDispatch(): void {
    this.assertMayStart("work");
    if (this.deadlines.dispatch === null || clock.now() > this.deadlines.dispatch) throw new ScopeClosed("deadline");
  }
  /** H(token ‖ parts…): the only form in which the private token ever leaves this scope. */
  mark(...parts: string[]): string {
    const h = createHash("sha256").update(this.#token);
    for (const p of parts) h.update("\u0000").update(p);
    return h.digest("hex");
  }
  /** The claimant hash: H(token). */
  get claimantHash(): string { return createHash("sha256").update(this.#token).digest("hex"); }
}
