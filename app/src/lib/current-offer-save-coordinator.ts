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
 * 2. Every result is classified by what is known about the REQUEST:
 *      confirmed      GHL answered 200 and the readback shows the amount.
 *      refused        nothing was sent, or the server refused before any
 *                     write (400/401/403, the pre-write "frozen" 409, sign-in
 *                     required, a local validation error). The previously
 *                     verified amount stands.
 *      unverified     GHL answered 200 -- the request finished -- but the
 *                     readback failed or disagreed. Nothing is confirmed;
 *                     later saves may proceed (each verifies itself).
 *      indeterminate  no response, a 5xx, the server's generic 409, or its
 *                     "indeterminate" 202: the request may still land.
 *
 * 3. An INDETERMINATE result makes the deal UNRESOLVED for as long as this
 *    app stays loaded (the coordinator is shared, so leaving the page or
 *    switching deals does not clear it):
 *      - no further submission for that deal is sent -- blur or Accept;
 *      - queued saves are dropped, never released or retried;
 *      - nothing for that deal is labelled "Recorded in GHL";
 *      - a carrier read (snapshot) never clears it.
 *    A full page reload starts a new coordinator. Making the block durable
 *    across reloads, browsers and operators, and resolving it safely, needs a
 *    server-side marker -- proposed separately on PR 126, not built here.
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

export type OfferWrite = (oppId: string, amount: number) => Promise<{ ok: boolean; putStatus?: number }>;
export type OfferOutcomeKind = "confirmed" | "refused" | "unverified" | "indeterminate";
export type OfferFailure = { amount: number; kind: "refused" | "unverified"; message: string };

export const UNRESOLVED_SAVE_MESSAGE =
  "Unresolved — an earlier save of this Current Offer may still reach GHL. Nothing more will be sent for this deal. Check the deal in GHL before changing it.";
export const UNRESOLVED_ACCEPT_MESSAGE =
  "Unresolved — the acceptance may or may not have been recorded. Nothing more will be sent for this deal. Reload and check the deal in GHL before changing the Current Offer.";

type Entry =
  | { kind: "blur"; amount: number }
  | { kind: "accept"; amount: number; resolve: (r: { ok: boolean }) => void; reject: (e: unknown) => void };

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
  if (r.putStatus === 202) return "indeterminate";
  return r.ok ? "confirmed" : "unverified";
}
export function classifyOfferWriteError(e: unknown): OfferOutcomeKind {
  const message = String((e as Error)?.message ?? "");
  if (e instanceof AppWriteSignInRequired) return "refused";            // thrown before any request is sent
  if (/^Sign in for application writes/.test(message)) return "refused";  // same, across module copies
  if (/^setCurrentOffer: /.test(message)) return "refused";          // local validation; nothing sent
  const put = /setCurrentOffer PUT → (\d{3}):?\s*([\s\S]*)$/.exec(message);
  if (put) {
    const status = Number(put[1]);
    if (status === 400 || status === 401 || status === 403) return "refused";
    if (status === 409 && /Current Offer is frozen or invalid/.test(put[2])) return "refused";
    return "indeterminate";
  }
  const putStatus = (e as { putStatus?: number })?.putStatus;
  if (putStatus === 200) return "unverified";                         // the write finished; only the readback failed
  return "indeterminate";                                             // network failure, 202 + failed readback, anything unknown
}
const REFUSED_MESSAGE = (e: unknown) => {
  const m = /PUT → (\d{3})/.exec(String((e as Error)?.message ?? ""));
  return m ? `Not saved — GHL refused the save (${m[1]}).` : "Not saved — the save was not sent.";
};

export function createOfferSaveCoordinator(write: OfferWrite) {
  const deals = new Map<string, DealState>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const l of listeners) l(); };
  const deal = (oppId: string): DealState => {
    let d = deals.get(oppId);
    if (!d) { d = { confirmed: null, inFlight: null, queue: [], failure: null, unresolved: null, accepting: false }; deals.set(oppId, d); }
    return d;
  };
  const lastPending = (d: DealState): Entry | null => (d.queue.length ? d.queue[d.queue.length - 1] : d.inFlight);
  const unresolvedError = (d: DealState) => new Error(d.unresolved!.message);

  function makeUnresolved(d: DealState, message: string) {
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
      const r = await write(oppId, next.amount);
      kind = classifyOfferWriteResult(r);
      if (next.kind === "accept") {
        if (kind === "indeterminate") next.reject(new Error(UNRESOLVED_SAVE_MESSAGE));
        else next.resolve(r);
      }
    } catch (e) {
      kind = classifyOfferWriteError(e);
      refusal = e;
      if (next.kind === "accept") next.reject(kind === "indeterminate" ? new Error(UNRESOLVED_SAVE_MESSAGE) : e);
    }
    d.inFlight = null;
    if (kind === "confirmed") { d.confirmed = next.amount; }
    else if (kind === "refused") { d.confirmed = before; d.failure = { amount: next.amount, kind: "refused", message: REFUSED_MESSAGE(refusal) }; }
    else if (kind === "unverified") { d.confirmed = null; d.failure = { amount: next.amount, kind: "unverified", message: "Save could not be confirmed." }; }
    else makeUnresolved(d, UNRESOLVED_SAVE_MESSAGE);
    return pump(oppId);
  }

  function statusFor(oppId: string | null, amount: number | null): CurrentOfferStatus {
    if (oppId === null) return "draft";
    const d = deals.get(oppId);
    if (d?.unresolved) return "unresolved";
    if (amount === null || !d) return "draft";
    const last = lastPending(d);
    if (last) return last.amount === amount ? "saving" : "draft";
    if (d.failure && d.failure.amount === amount) return d.failure.kind === "refused" ? "failed" : "unconfirmed";
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
    /** Confirm Accept's Current Offer write, through the same per-deal queue. */
    saveForAccept(oppId: string, amount: number): Promise<{ ok: boolean }> {
      const d = deal(oppId);
      if (d.unresolved) return Promise.reject(unresolvedError(d));
      return new Promise((resolve, reject) => {
        d.queue.push({ kind: "accept", amount, resolve, reject });
        void pump(oppId);
      });
    },
    /** Ends the protected sequence. `acceptanceUnknown` (the note's outcome is
        unknown) leaves the deal unresolved. */
    endAccept(oppId: string, acceptanceUnknown: boolean): void {
      const d = deal(oppId);
      d.accepting = false;
      if (acceptanceUnknown && !d.unresolved) makeUnresolved(d, UNRESOLVED_ACCEPT_MESSAGE);
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
    /** The failure message for the amount on screen, when its status is failed/unconfirmed. */
    failureFor(oppId: string | null, amount: number | null): string | null {
      const st = statusFor(oppId, amount);
      return st === "failed" || st === "unconfirmed" ? deals.get(oppId as string)!.failure!.message : null;
    },
  };
}

export type OfferSaveCoordinator = ReturnType<typeof createOfferSaveCoordinator>;
