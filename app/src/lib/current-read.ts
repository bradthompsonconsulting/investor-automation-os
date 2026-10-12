/**
 * Current-read ownership for a React effect -- B15-09 (INV-108), Bones: an
 * older Pipeline opportunities request finishing later restored stale rows
 * and contact links.
 *
 * The same `let cancelled` pattern the Deal Calculator, Contact, Seller Call,
 * Underwriting and Contract pages use inline, made a function so the
 * ownership rule can be tested on its own. The effect returns the cancel
 * function as its cleanup; React calls it before the effect re-runs (a read
 * recovery) and on unmount. From then on the read's success, failure and
 * completion are all ignored: only the current read changes the page.
 *
 * The handler order matches the `.then().catch().finally()` chain it
 * replaces, including a throwing `data` handler being reported to `error`.
 */
export interface CurrentReadHandlers<T> {
  data(value: T): void;
  error(e: Error): void;
  settled(): void;
}

export function startCurrentRead<T>(read: () => Promise<T>, on: CurrentReadHandlers<T>): () => void {
  let cancelled = false;
  read()
    .then((value) => { if (!cancelled) on.data(value); })
    .catch((e: unknown) => { if (!cancelled) on.error(e instanceof Error ? e : new Error(String(e))); })
    .finally(() => { if (!cancelled) on.settled(); });
  return () => { cancelled = true; };
}
