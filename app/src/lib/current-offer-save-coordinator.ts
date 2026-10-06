/**
 * PR #126 (Bones / Jess, 2026-10-05) -- the ONE place Seller Call saves the
 * Opportunity Current Offer, for both the input's blur and Confirm Accept.
 *
 * 1. Serialized per deal. A save is a write followed by a readback. Per deal,
 *    one write and its readback finish before the next write for that deal is
 *    sent, so a readback is never overtaken by another write from this page,
 *    and "Recorded in GHL" means exactly what that readback verified.
 *      - Blur saves queue behind the save in flight; a later blur replaces a
 *        queued blur (edits made while saving are never lost; only the latest
 *        is sent); an amount already last in line, or already verified with
 *        nothing written since, is not sent again.
 *      - Nothing for a deal is "recorded" while anything for it is in flight
 *        or queued.
 *
 * 2. Every result is classified by what is PROVEN about the request (Jess,
 *    2026-10-05: an HTTP error alone is not proof that nothing was written):
 *      confirmed      the write was verified by its readback.
 *      refused        provably nothing was sent: the server answered
 *                     outcome "not_sent" (it refused before the GHL call),
 *                     sign-in was required before sending, or a local
 *                     validation error. The previously verified amount
 *                     stands.
 *      indeterminate  anything else -- no response, any other HTTP error,
 *                     "indeterminate", or a readback that failed or did not
 *                     verify. The server keeps its durable barrier for it.
 *
 * 3. An INDETERMINATE result makes the deal UNRESOLVED (the coordinator is
 *    shared, so leaving the page or switching deals does not clear it, and
 *    the server's durable barrier -- lib/current-offer-barrier-client.ts --
 *    blocks reloads and other browsers):
 *      - no further submission for that deal is sent -- blur or Accept;
 *      - queued saves are dropped, never released or retried;
 *      - nothing for that deal is labelled "Recorded in GHL";
 *      - a carrier read (snapshot) never clears it;
 *      - only the server's evidence-based "Check again" clears it
 *        (`clearUnresolved`), never a reload or a look at GHL.
 *
 * 4. Confirm Accept protects the frozen accepted price for the WHOLE existing
 *    sequence (offer write + readback, acceptance note, last-touch):
 *    `beginAccept` drops any queued (never-sent) blur saves and locks the
 *    deal -- blur saves are ignored, not queued for later -- until
 *    `endAccept`. The offer write itself goes through the same queue, behind
 *    any save already in flight. If the acceptance note's outcome is unknown
 *    the deal stays UNRESOLVED. Partial-failure handling is the accept
 *    module's, unchanged; nothing here claims the sequence is atomic.
 *
 * Pure apart from the injected `write`. No React, no GHL identifiers.
 */
import type { CurrentOfferStatus } from "./seller-call-deal-bar";
import { AppWriteSignInRequired } from "./app-write-session";

export type OfferWrite = (oppId: string, amount: number, requestId?: string) => Promise<{ ok: boolean; putStatus?: number }>;
export type OfferOutcomeKind = "confirmed" | "refused" | "indeterminate";
export type OfferFailure = { amount: number; kind: "refused"; message: string };
/** Thrown by a write when the durable barrier is held: blocks with the server's own message. */
export class OfferSaveBlocked extends Error {}

export const UNRESOLVED_SAVE_MESSAGE =
  "Unresolved — an earlier save of this Current Offer may still reach GHL. Nothing more will be sent for this deal until IAOS can prove what happened — use Check again.";
export const UNRESOLVED_ACCEPT_MESSAGE =
  "Unresolved — part of the acceptance may still reach GHL. Nothing more will be sent for this deal until IAOS can prove what happened — use Check again.";

type Entry =
  | { kind: "blur"; amount: number }
  | { kind: "accept"; amount: number; requestId: string; resolve: (r: { ok: boolean }) => void; reject: (e: unknown) => void };

type DealState = {
  confirmed: number | null;
  inFlight: Entry | null;
  queue: Entry[];
  failure: OfferFailure | null;
  unresolved: { message: string } | null;
  accepting: boolean;
};

/** What a write's result says about the REQUEST (see header, point 2). */
export function classifyOfferWriteResult(r: { ok: boolean; putStatus?: number }): OfferOutcomeKind {
  return r.ok && r.putStatus !== 202 ? "confirmed" : "indeterminate";
}
export function classifyOfferWriteError(e: unknown): OfferOutcomeKind {
  const message = String((e as Error)?.message ?? "");
  if (e instanceof AppWriteSignInRequired) return "refused";            // thrown before any request is sent
  if (/^Sign in for application writes/.test(message)) return "refused";  // same, across module copies
  if (/^setCurrentOffer: /.test(message)) return "refused";          // local validation; nothing sent
  if (/setCurrentOffer PUT → \d{3}:[\s\S]*"outcome":"not_sent"/.test(message)) return "refused"; // the server refused before the GHL call
  return "indeterminate";
}
const REFUSED_MESSAGE = (e: unknown) => {
  const text = String((e as Error)?.message ?? "");
  const server = /"error":"([^"]*)"/.exec(text);
  if (server && /PUT → \d{3}/.test(text)) return `Not saved — ${server[1]}`;
  return "Not saved — the save was not sent.";
};

export function createOfferSaveCoordinator(write: OfferWrite) {
  const deals = new Map<string, DealState>();
  const listeners = new Set<() => void>();
  const idleWaiters = new Map<string, (() => void)[]>();
  const settleIdle = (oppId: string) => {
    const d = deals.get(oppId);
    if (d && (d.inFlight || d.queue.length) && !d.unresolved) return;
    for (const w of idleWaiters.get(oppId) ?? []) w();
    idleWaiters.delete(oppId);
  };
  const changed = () => { for (const l of listeners) l(); for (const opp of [...idleWaiters.keys()]) settleIdle(opp); };
  const deal = (oppId: string): DealState => {
    let d = deals.get(oppId);
    if (!d) { d = { confirmed: null, inFlight: null, queue: [], failure: null, unresolved: null, accepting: false }; deals.set(oppId, d); }
    return d;
  };
  const lastPending = (d: DealState): Entry | null => (d.queue.length ? d.queue[d.queue.length - 1] : d.inFlight);
  const unresolvedError = (d: DealState) => new Error(d.unresolved!.message);

  function makeUnresolved(d: DealState, message: string) {
    if (d.unresolved) { d.unresolved = { message }; return; }
    d.unresolved = { message };
    d.confirmed = null;
    d.failure = null;
    for (const e of d.queue.splice(0)) if (e.kind === "accept") e.reject(unresolvedError(d));
  }

  async function pump(oppId: string): Promise<void> {
    const d = deal(oppId);
    if (d.inFlight || d.unresolved) { changed(); return; }
    const next = d.queue.shift();
    if (!next) { changed(); return; }
    if (next.kind === "blur" && d.confirmed === next.amount) { changed(); return pump(oppId); }
    const before = d.confirmed;
    d.inFlight = next;
    d.confirmed = null;          // GHL is about to change: nothing is confirmed until this readback
    d.failure = null;
    changed();
    let kind: OfferOutcomeKind;
    let refusal: unknown = null;
    try {
      const r = await write(oppId, next.amount, next.kind === "accept" ? next.requestId : undefined);
      kind = classifyOfferWriteResult(r);
      if (next.kind === "accept") {
        if (kind === "indeterminate") next.reject(new Error(UNRESOLVED_SAVE_MESSAGE));
        else next.resolve(r);
      }
    } catch (e) {
      kind = e instanceof OfferSaveBlocked ? "indeterminate" : classifyOfferWriteError(e);
      refusal = e;
      if (next.kind === "accept") next.reject(kind === "indeterminate" ? new Error(e instanceof OfferSaveBlocked ? e.message : UNRESOLVED_SAVE_MESSAGE) : e);
    }
    d.inFlight = null;
    if (kind === "confirmed") { d.confirmed = next.amount; }
    else if (kind === "refused") { d.confirmed = before; d.failure = { amount: next.amount, kind: "refused", message: REFUSED_MESSAGE(refusal) }; }
    else makeUnresolved(d, refusal instanceof OfferSaveBlocked ? refusal.message : UNRESOLVED_SAVE_MESSAGE);
    return pump(oppId);
  }

  function statusFor(oppId: string | null, amount: number | null): CurrentOfferStatus {
    if (oppId === null) return "draft";
    const d = deals.get(oppId);
    if (d?.unresolved) return "unresolved";
    if (amount === null || !d) return "draft";
    const last = lastPending(d);
    if (last) return last.amount === amount ? "saving" : "draft";
    if (d.failure && d.failure.amount === amount) return "failed";
    if (d.confirmed === amount) return "recorded";
    return "draft";
  }

  return {
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The input's blur. Ignored while the deal is accepting or unresolved. */
    requestSave(oppId: string, amount: number): void {
      const d = deal(oppId);
      if (d.unresolved || d.accepting) return;
      const last = lastPending(d);
      if (last) {
        if (last.amount === amount) return;
        const tail = d.queue.length ? d.queue[d.queue.length - 1] : null;
        if (tail && tail.kind === "blur") tail.amount = amount;
        else d.queue.push({ kind: "blur", amount });
        d.failure = null;
        changed();
        return;
      }
      if (d.confirmed === amount) return;
      d.queue.push({ kind: "blur", amount });
      void pump(oppId);
    },
    /** Starts Confirm Accept's protected sequence for this deal: drops queued,
        never-sent blur saves and ignores new ones until `endAccept`. Returns
        false (and sends nothing) when the deal is unresolved or already
        accepting. */
    beginAccept(oppId: string): boolean {
      const d = deal(oppId);
      if (d.unresolved || d.accepting) return false;
      d.queue = d.queue.filter((e) => e.kind !== "blur");
      d.accepting = true;
      changed();
      return true;
    },
    /** Resolves once nothing for this deal is in flight or queued (or it became
        unresolved). Confirm Accept waits on it before reserving on the server,
        so it never races a blur save that already holds the deal's barrier. */
    whenIdle(oppId: string): Promise<void> {
      return new Promise((resolve) => {
        const list = idleWaiters.get(oppId) ?? [];
        list.push(resolve);
        idleWaiters.set(oppId, list);
        settleIdle(oppId);
      });
    },
    /** Confirm Accept's Current Offer write, through the same per-deal queue. */
    saveForAccept(oppId: string, amount: number, requestId: string): Promise<{ ok: boolean }> {
      const d = deal(oppId);
      if (d.unresolved) return Promise.reject(unresolvedError(d));
      return new Promise((resolve, reject) => {
        d.queue.push({ kind: "accept", amount, requestId, resolve, reject });
        void pump(oppId);
      });
    },
    /** Ends the protected sequence. A non-null `unresolvedMessage` (the
        server's reconcile could not prove every step) leaves the deal
        unresolved with that message. */
    endAccept(oppId: string, unresolvedMessage: string | null): void {
      const d = deal(oppId);
      d.accepting = false;
      if (unresolvedMessage !== null) makeUnresolved(d, unresolvedMessage);
      changed();
    },
    /** The server's durable barrier blocks this deal (status read, or a
        refused reservation). Ignored while this tab's own save or Accept for
        the deal is running -- that barrier is its own. */
    markUnresolved(oppId: string, message: string): void {
      const d = deal(oppId);
      if (d.inFlight || d.accepting) return;
      makeUnresolved(d, message);
      changed();
    },
    /** Only after the server's evidence-based "Check again" answered clear.
        Nothing is assumed recorded afterwards: the amount on screen is a
        draft until its own save is verified. */
    clearUnresolved(oppId: string): void {
      const d = deal(oppId);
      if (d.inFlight || d.queue.length || d.accepting) return;
      d.unresolved = null;
      d.confirmed = null;
      d.failure = null;
      changed();
    },
    /** The carrier's own content, read on (re)load. Ignored while this deal has
        saves pending, is accepting, or is unresolved -- the read may predate a
        request that is still on its way. */
    seed(oppId: string, amount: number | null): void {
      const d = deal(oppId);
      if (d.inFlight || d.queue.length || d.accepting || d.unresolved) return;
      d.confirmed = amount;
      d.failure = null;
      changed();
    },
    statusFor,
    /** True while the Current Offer input must not be edited for this deal. */
    isLocked(oppId: string | null): boolean {
      const d = oppId === null ? undefined : deals.get(oppId);
      return !!d && (d.accepting || d.unresolved !== null);
    },
    unresolvedMessage(oppId: string | null): string | null {
      return (oppId === null ? undefined : deals.get(oppId))?.unresolved?.message ?? null;
    },
    /** The failure message for the amount on screen, when its save was refused. */
    failureFor(oppId: string | null, amount: number | null): string | null {
      return statusFor(oppId, amount) === "failed" ? deals.get(oppId as string)!.failure!.message : null;
    },
  };
}

export type OfferSaveCoordinator = ReturnType<typeof createOfferSaveCoordinator>;
