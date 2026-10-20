/** Session stays in memory; it is neither business data nor a voice credential. */
let session: { token: string; expiresAt: string } | null = null;
/**
 * B15-04 C1–C4 r4 A3 -- UI partitioning only, never authority (the server verifies every request itself).
 * `generation` changes on every session change: set, clear, expiry and 401. `lastOperator` is the decoded
 * `sub` of the most recent non-null session and survives expiry, so A -> expired -> A keeps A's form
 * while A -> expired -> B does not.
 */
let generation = 0;
let lastOperator: string | null = null;
const listeners = new Set<() => void>();
function claimSub(token: string): string | null {
  try {
    const p = token.split(".")[1];
    const sub = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(p.length / 4) * 4, "="))).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch { return null; }
}
function changed(next: typeof session) {
  session = next; generation += 1;
  const op = next ? claimSub(next.token) : null;
  if (op) lastOperator = op;
  for (const f of [...listeners]) { try { f(); } catch { /* a listener never blocks a session change */ } }
}
export type AppWriteIdentity = { generation: number; operator: string | null; lastOperator: string | null; active: boolean };
export function appWriteIdentity(): AppWriteIdentity {
  return { generation, operator: session ? claimSub(session.token) : null, lastOperator, active: !!session && Date.parse(session.expiresAt) > Date.now() };
}
/** Called after every session change (sign-in, sign-out, expiry detected, 401). Returns the unsubscribe function. */
export function subscribeAppWriteSession(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Thrown before any request is sent: there is no current write session. */
export class AppWriteSignInRequired extends Error {}
export function setAppWriteSession(value: typeof session) { changed(value); }
export async function appWriteFetch(url: string, init: RequestInit): Promise<Response> {
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    if (session) changed(null);
    throw new AppWriteSignInRequired("Sign in for application writes before saving. Your edits have not been submitted.");
  }
  const sent = session;
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${sent.token}` } });
  // Only a 401 for the CURRENT session ends it; a late 401 for a replaced session changes nothing.
  if (response.status === 401 && session === sent) changed(null);
  return response;
}
