/**
 * B15-29 r4 (INV-137, Bones R3-2) -- operator partition of page data while one IAOS sign-in is on.
 *
 * UI partitioning only, never authority: the server checks every read and write itself. The ONLY input is the
 * status answer's NON-SECRET operator tag (a keyed hash of the email; no email, sid or token is ever stored here).
 *
 * When the read gate (OneLoginAccess) sees a DIFFERENT operator than the one this page (or this tab, across a reload)
 * last showed, it remounts the routed app and calls clearOperatorScopedData(), so the previous operator's account
 * data and drafts are not shown or usable under the new operator. The same operator keeps everything.
 *
 * Operator-scoped browser records cleared here:
 *   - every sessionStorage key IAOS writes under the "iaos." prefix (today: iaos.dispositionOverride.v1, the
 *     Board 4 session-local disposition overrides), except this module's own tag record;
 *   - the localStorage record iaos_dashboard_last_visit (the previous operator's "new since last visit" marker);
 *   - any in-memory draft store registered with registerOperatorScopedStore().
 * Session-expiry reminder dismissals are keyed by the session's own expiry and are left alone.
 * Every storage access is guarded: unavailable or throwing storage never blocks the partition.
 */
export const OPERATOR_TAG_KEY = "iaos.one-login.operator";
const SESSION_PREFIX = "iaos.";
const LOCAL_KEYS = ["iaos_dashboard_last_visit"];

const clearers = new Set<() => void>();
/** A draft / data store that must be emptied when the operator changes. Returns the unregister function. */
export function registerOperatorScopedStore(clear: () => void): () => void { clearers.add(clear); return () => { clearers.delete(clear); }; }

function sessionStore(): Storage | null { try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; } }
function localStore(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }

/** Empties every operator-scoped record listed above. Never throws. */
export function clearOperatorScopedData(): void {
  for (const clear of [...clearers]) { try { clear(); } catch { /* one store never blocks the others */ } }
  const s = sessionStore();
  if (s) {
    try {
      for (let i = s.length - 1; i >= 0; i -= 1) { const k = s.key(i); if (k && k.startsWith(SESSION_PREFIX) && k !== OPERATOR_TAG_KEY) s.removeItem(k); }
    } catch { /* storage unavailable */ }
  }
  const l = localStore();
  if (l) { for (const k of LOCAL_KEYS) { try { l.removeItem(k); } catch { /* storage unavailable */ } } }
}

/** True when this tab last showed a DIFFERENT operator (e.g. before a reload). Unknown -> false. */
export function operatorChangedSinceLastPage(operatorTag: string): boolean {
  const s = sessionStore();
  if (!s) return false;
  try { const prev = s.getItem(OPERATOR_TAG_KEY); return prev !== null && prev !== operatorTag; } catch { return false; }
}

/** Records the operator tag this tab now shows. */
export function rememberOperator(operatorTag: string): void {
  const s = sessionStore();
  if (!s) return;
  try { s.setItem(OPERATOR_TAG_KEY, operatorTag); } catch { /* storage unavailable: the in-page partition still holds */ }
}
