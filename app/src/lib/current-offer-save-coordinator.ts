/**
 * PR #126 fourth re-review (Bones, 2026-10-05) -- the ONE place Seller Call
 * saves the Opportunity Current Offer, for both the input's blur and Confirm
 * Accept.
 *
 * Why a coordinator: a save is a write followed by a readback. When two saves
 * of the same deal overlap, a readback can verify an amount that a later
 * write then replaces -- or a later readback can verify its amount before an
 * earlier write lands on top of it. No completion-order guard can tell those
 * apart. So per deal, saves are SERIALIZED: a write and its readback finish
 * before the next write for that deal is sent. A readback is then the last
 * word from this page on that deal, and "Recorded in GHL" means exactly what
 * the readback verified.
 *
 *   - Blur saves queue behind the save in flight. Later blurs REPLACE a
 *     queued blur (only the latest edit is worth sending); an amount already
 *     last in line is not queued twice.
 *   - Accept saves queue the same way but are never replaced or skipped, and
 *     resolve/reject with the write's own result, so the accept sequence
 *     (seller-call-accept-writes.ts) keeps its exact contract.
 *   - While anything for a deal is in flight or queued, nothing for that deal
 *     is "recorded": GHL is about to change.
 *   - A refusal (4xx) wrote nothing: the previously confirmed amount stands.
 *     An uncertain result (5xx, network, readback failed or mismatched)
 *     leaves GHL unknown: nothing is confirmed until a later save verifies.
 *   - Deals are independent: navigating away never cancels a deal's saves,
 *     and one deal's results never label another.
 *   - The page's input is never touched here: an edit made while saving is
 *     preserved and is a draft until its own save is verified.
 *
 * Residual limit (stated, not hidden): serialization orders this page's
 * requests. A request whose response never arrived (a network failure) is
 * reported uncertain; if it were still applied by GHL after a later save,
 * nothing here could observe it. That case is never labelled recorded --
 * only a later verified readback is.
 *
 * Pure apart from the injected `write`. No React, no GHL identifiers.
 */
import type { CurrentOfferStatus } from "./seller-call-deal-bar";

export type OfferWrite = (oppId: string, amount: number) => Promise<{ ok: boolean }>;
export type OfferFailure = { amount: number; kind: "refused" | "unconfirmed"; message: string };

type Entry =
  | { kind: "blur"; amount: number }
  | { kind: "accept"; amount: number; resolve: (r: { ok: boolean }) => void; reject: (e: unknown) => void };

type DealState = {
  confirmed: number | null;
  inFlight: Entry | null;
  queue: Entry[];
  failure: OfferFailure | null;
};

/** A definite refusal is an answered request that said no (4xx): nothing was
    written. Anything else leaves the outcome unknown. */
export function classifyOfferSaveError(e: unknown): Omit<OfferFailure, "amount"> {
  const m = /setCurrentOffer PUT → (\d{3})/.exec(String((e as Error)?.message ?? ""));
  if (m !== null && Number(m[1]) >= 400 && Number(m[1]) < 500) {
    return { kind: "refused", message: `Not saved — GHL refused the save (${m[1]}).` };
  }
  return { kind: "unconfirmed", message: "Save could not be confirmed." };
}

export function createOfferSaveCoordinator(write: OfferWrite, onChange: () => void) {
  const deals = new Map<string, DealState>();
  const deal = (oppId: string): DealState => {
    let d = deals.get(oppId);
    if (!d) { d = { confirmed: null, inFlight: null, queue: [], failure: null }; deals.set(oppId, d); }
    return d;
  };
  const lastPending = (d: DealState): Entry | null => (d.queue.length ? d.queue[d.queue.length - 1] : d.inFlight);

  async function pump(oppId: string): Promise<void> {
    const d = deal(oppId);
    if (d.inFlight) return;
    const next = d.queue.shift();
    if (!next) { onChange(); return; }
    // A blur whose amount is already verified, with nothing written since, is a no-op.
    if (next.kind === "blur" && d.confirmed === next.amount) { onChange(); return pump(oppId); }
    const before = d.confirmed;
    d.inFlight = next;
    d.confirmed = null;          // GHL is about to change: nothing is confirmed until this readback
    d.failure = null;
    onChange();
    let failure: OfferFailure | null = null;
    let ok = false;
    try {
      const r = await write(oppId, next.amount);
      ok = r.ok;
      if (!ok) failure = { amount: next.amount, kind: "unconfirmed", message: "Save could not be confirmed." };
      if (next.kind === "accept") next.resolve(r);
    } catch (e) {
      failure = { amount: next.amount, ...classifyOfferSaveError(e) };
      if (next.kind === "accept") next.reject(e);
    }
    d.inFlight = null;
    if (ok) d.confirmed = next.amount;
    else if (failure && failure.kind === "refused") d.confirmed = before;   // nothing was written
    else d.confirmed = null;                                                // GHL unknown
    d.failure = failure;
    return pump(oppId);
  }

  function statusFor(oppId: string | null, amount: number | null): CurrentOfferStatus {
    if (oppId === null || amount === null) return "draft";
    const d = deals.get(oppId);
    if (!d) return "draft";
    const last = lastPending(d);
    if (last) return last.amount === amount ? "saving" : "draft";
    if (d.failure && d.failure.amount === amount) return d.failure.kind === "refused" ? "failed" : "unconfirmed";
    if (d.confirmed === amount) return "recorded";
    return "draft";
  }

  return {
    /** The input's blur. Queues behind any save in flight for this deal. */
    requestSave(oppId: string, amount: number): void {
      const d = deal(oppId);
      const last = lastPending(d);
      if (last) {
        if (last.amount === amount) return;
        const tail = d.queue.length ? d.queue[d.queue.length - 1] : null;
        if (tail && tail.kind === "blur") tail.amount = amount;
        else d.queue.push({ kind: "blur", amount });
        d.failure = null;
        onChange();
        return;
      }
      if (d.confirmed === amount) return;
      d.queue.push({ kind: "blur", amount });
      void pump(oppId);
    },
    /** Confirm Accept's Current Offer write, through the same queue. */
    saveForAccept(oppId: string, amount: number): Promise<{ ok: boolean }> {
      return new Promise((resolve, reject) => {
        deal(oppId).queue.push({ kind: "accept", amount, resolve, reject });
        void pump(oppId);
      });
    },
    /** The carrier's own content, read on (re)load. Ignored while this deal
        has saves pending -- the read may predate them. */
    seed(oppId: string, amount: number | null): void {
      const d = deal(oppId);
      if (d.inFlight || d.queue.length) return;
      d.confirmed = amount;
      d.failure = null;
      onChange();
    },
    statusFor,
    /** The failure message for the amount on screen, when its status is failed/unconfirmed. */
    failureFor(oppId: string | null, amount: number | null): string | null {
      const st = statusFor(oppId, amount);
      return st === "failed" || st === "unconfirmed" ? deals.get(oppId as string)!.failure!.message : null;
    },
  };
}

export type OfferSaveCoordinator = ReturnType<typeof createOfferSaveCoordinator>;
