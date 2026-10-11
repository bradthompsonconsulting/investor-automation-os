/**
 * Seller Call autosave coordinator -- Board 14-13 (Brad, 2026-10-10).
 *
 * Editable facts on Seller Call save when Brad leaves a changed field (Tab or
 * click away) or presses Enter in a single-line field, with one page-wide
 * "Save changes" fallback that also retries. This module decides only WHEN a
 * save runs and what status to show; the caller supplies the write (always
 * the existing sanctioned `ghl.notes.create`).
 *
 * Pure apart from the writes it is handed. No React, no GHL identifiers.
 *
 * - One entry per (contact, opportunity, section). The write closure is built
 *   by the caller at request time with that target already bound, so a save
 *   can only ever reach the record it was started for, even if Brad switches
 *   seller before it finishes.
 * - Saves for one entry run one at a time, in order. A request made while one
 *   is in flight replaces any earlier queued request (latest text wins) and
 *   runs after it. A response only updates its own entry, so a late answer for
 *   one seller never changes what another seller's page shows.
 * - `signature` is a string form of the value. A request whose signature
 *   already matches the last saved one does nothing (no duplicate notes).
 * - On failure the status is "error" with the message; the caller keeps the
 *   text, and the next request (blur, Enter or Save changes) retries.
 */

export type AutosaveTarget = { contactId: string; opportunityId: string; section: string };

export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type Entry = {
  status: AutosaveStatus;
  /** The signature of what is on record: seeded from readback, then set by each confirmed save. */
  saved: string | null;
  /** The signature currently being written, if any. */
  inflight: string | null;
  running: Promise<void> | null;
  queued: { signature: string; write: () => Promise<void> } | null;
};

export function autosaveKey(t: AutosaveTarget): string {
  return JSON.stringify([t.contactId, t.opportunityId, t.section]);
}

export class AutosaveCoordinator {
  private entries = new Map<string, Entry>();
  constructor(private readonly onChange: () => void = () => {}) {}

  private entry(t: AutosaveTarget): Entry {
    const key = autosaveKey(t);
    let e = this.entries.get(key);
    if (!e) {
      e = { status: { kind: "idle" }, saved: null, inflight: null, running: null, queued: null };
      this.entries.set(key, e);
    }
    return e;
  }

  /** Records what is already on record (from readback), so leaving an unchanged field writes nothing. Ignored while a save is running or after a failure. */
  seed(t: AutosaveTarget, signature: string): void {
    const e = this.entry(t);
    if (e.running || e.status.kind === "error") return;
    if (e.saved === null || e.status.kind === "idle") e.saved = signature;
  }

  status(t: AutosaveTarget): AutosaveStatus {
    return this.entry(t).status;
  }

  /** True when `signature` differs from what is on record, or the last attempt failed. */
  isDirty(t: AutosaveTarget, signature: string): boolean {
    const e = this.entry(t);
    if (e.status.kind === "error") return true;
    if (e.inflight !== null) return signature !== e.inflight;
    return signature !== e.saved;
  }

  isRunning(t: AutosaveTarget): boolean {
    return this.entry(t).running !== null;
  }

  /** Saves `signature` with `write` unless it is already on record. Resolves when this entry has nothing left to run. */
  request(t: AutosaveTarget, signature: string, write: () => Promise<void>): Promise<void> {
    const e = this.entry(t);
    if (e.running) {
      if (signature === e.inflight) { e.queued = null; return e.running; }
      e.queued = { signature, write };
      return e.running;
    }
    if (signature === e.saved && e.status.kind !== "error") return Promise.resolve();
    e.running = this.run(e, signature, write);
    return e.running;
  }

  private async run(e: Entry, signature: string, write: () => Promise<void>): Promise<void> {
    let next: { signature: string; write: () => Promise<void> } | null = { signature, write };
    while (next) {
      const current = next;
      next = null;
      e.inflight = current.signature;
      e.status = { kind: "saving" };
      this.onChange();
      try {
        await current.write();
        e.saved = current.signature;
        e.status = { kind: "saved" };
      } catch (err: any) {
        e.status = { kind: "error", message: err?.message ? String(err.message) : "The save did not complete." };
      }
      e.inflight = null;
      if (e.queued) {
        const q = e.queued;
        e.queued = null;
        // Run the newer text unless it is already on record (and the last attempt did not fail).
        if (!(q.signature === e.saved && e.status.kind !== "error")) next = q;
      }
    }
    e.running = null;
    this.onChange();
  }
}
