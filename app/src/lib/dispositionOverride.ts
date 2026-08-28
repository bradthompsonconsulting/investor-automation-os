/**
 * O1 — the session-local disposition override. Board 4.
 *
 * WHAT IT IS FOR. `ghl-contacts` is fetched once, at Dashboard mount
 * (`Dashboard.tsx`, empty dependency array), and GHL's own list convergence has
 * been OBSERVED between ~11s and ~105s. So a disposition IAOS has just written
 * and confirmed is invisible to IAOS's own Lead Queue until both a refetch and
 * convergence have happened. Every predicate-based cold-outreach exclusion
 * inherits that latency. This bridges it.
 *
 * NOT A SECOND SOURCE OF TRUTH. GHL remains durable state. This holds one fact
 * per contact for a few minutes so the UI can tell the truth in the interval
 * where the fetch cannot. Once GHL catches up the caller prefers the fetched
 * value — see NEWER-OF below.
 *
 * WHY sessionStorage AND NOT COMPONENT STATE. The existing overrides —
 * `attemptOverride` and `callbackOverride` in Dashboard.tsx, and Contact
 * Workspace's own `attemptOverride` — are `useState` and die on unmount. They
 * only ever cover writes made from the component that owns them, which is why
 * exclusion #3 is session-current and the other five are not. The disposition
 * control lives in the Contact Workspace and the exclusion lives in the
 * Dashboard, so a component-local override could not bridge anything here.
 *
 * WHY NOT A MODULE STORE OR CONTEXT. Both are new cross-app architecture for a
 * small transient problem. sessionStorage already survives navigation, needs no
 * provider, and — because this module is pure over an injected Storage — is
 * testable offline, which no live harness can do for a session-local behaviour.
 *
 * TTL IS FIVE MINUTES, FIXED. The ~105s convergence figure is an OBSERVED
 * ceiling, not a contract from GHL, so the TTL is deliberately NOT derived from
 * it. Five minutes is unmistakably transient, comfortably clears the observed
 * window, and is short enough that this never accumulates into a record.
 */

export const DISPOSITION_OVERRIDE_TTL_MS = 5 * 60 * 1000;

const KEY = "iaos.dispositionOverride.v1";

export interface DispositionOverrideEntry {
  /** The option label written to iaos_call_disposition, verbatim. */
  disposition: string;
  /** ISO instant the write was CONFIRMED by readback — never when it was sent. */
  at: string;
}

type Store = Record<string, DispositionOverrideEntry>;

/**
 * Storage is a parameter, not an import.
 *
 * Two reasons, and the second is the one that matters. It makes this module
 * testable with a fake in a Node runner, where sessionStorage does not exist.
 * And it keeps the dependency VISIBLE to the caller: the Dashboard memo that
 * consumes this must list the store it reads, so react-hooks/exhaustive-deps
 * can see the real data flow rather than needing a suppression. Three such
 * suppressions already exist in Dashboard.tsx (L462, L526, L535) because
 * `callbackOverride` is reached through a closure the linter cannot follow, and
 * exclusion #3's session-currency silently depends on one of them. Do not add a
 * fourth.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Absent, unreadable or malformed storage yields an empty store, never a throw. */
function load(storage: StorageLike | null | undefined): Store {
  if (!storage) return {};
  let raw: string | null;
  try { raw = storage.getItem(KEY); } catch { return {}; }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function save(storage: StorageLike | null | undefined, store: Store): void {
  if (!storage) return;
  try { storage.setItem(KEY, JSON.stringify(store)); } catch { /* quota or private mode — degrade silently */ }
}

function isLive(entry: DispositionOverrideEntry | undefined, nowMs: number): boolean {
  if (!entry || typeof entry.at !== "string" || typeof entry.disposition !== "string") return false;
  const t = new Date(entry.at).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t < DISPOSITION_OVERRIDE_TTL_MS;
}

/**
 * PRUNE ON READ. Expired entries are dropped whenever the store is read, so a
 * long session cannot accumulate one entry per contact worked. Reading is the
 * only lifecycle hook available without a timer, and a timer here would be a
 * second thing to keep correct.
 */
export function readOverrides(storage: StorageLike | null | undefined, nowMs: number): Store {
  const store = load(storage);
  const live: Store = {};
  let dropped = false;
  for (const [id, entry] of Object.entries(store)) {
    if (isLive(entry, nowMs)) live[id] = entry;
    else dropped = true;
  }
  if (dropped) save(storage, live);
  return live;
}

/** Record a CONFIRMED write. Callers must not call this on an unconfirmed 200. */
export function recordOverride(
  storage: StorageLike | null | undefined,
  contactId: string,
  disposition: string,
  atIso: string,
  nowMs: number,
): void {
  if (!contactId || !disposition) return;
  const store = readOverrides(storage, nowMs);
  store[contactId] = { disposition, at: atIso };
  save(storage, store);
}

/**
 * NEWER-OF. The session entry wins only while it is newer than what GHL has
 * returned; once the durable value catches up it wins naturally and the bridge
 * stops mattering. `fetchedAt` is the contact's iaos_disposition_at, or null
 * when GHL carries none yet.
 *
 * Returns the disposition label to treat as current, or null when neither
 * source has one.
 */
export function effectiveDisposition(
  fetchedDisposition: string,
  fetchedAt: string | null,
  override: DispositionOverrideEntry | undefined,
  nowMs: number,
): string | null {
  const liveOverride = isLive(override, nowMs) ? override! : null;
  const fetched = fetchedDisposition && fetchedDisposition.trim() ? fetchedDisposition : null;

  if (!liveOverride) return fetched;
  if (!fetched) return liveOverride.disposition;

  const fetchedMs = fetchedAt ? new Date(fetchedAt).getTime() : NaN;
  if (Number.isNaN(fetchedMs)) return liveOverride.disposition;
  return fetchedMs >= new Date(liveOverride.at).getTime() ? fetched : liveOverride.disposition;
}
