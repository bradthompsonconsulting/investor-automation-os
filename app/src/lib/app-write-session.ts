/** Session stays in memory; it is neither business data nor a voice credential. */
import { READ_SESSION_LOST_EVENT } from "./read-session";
import { SESSION_UNAVAILABLE_EVENT, isSessionUnavailable, oneLoginActive } from "./one-login";
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
  if (oneLoginActive()) return oneLoginWriteFetch(url, init);
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

// =====================================================================================================
// B15-29 (INV-137) one IAOS sign-in -- ONLY while oneLoginActive() (the server's runtime configuration).
// Off, nothing below runs and appWriteFetch above is unchanged.
//
// The short-lived saving token is issued automatically by app-write-token from the signed-in IAOS
// session (the HttpOnly read cookie, which this module never sees). It stays in memory only.
//   - A token is requested only when a save is about to be sent and none is held with more than
//     RENEW_MARGIN_MS left (first save, after a reload, near expiry). Concurrent saves share one request.
//     Renewal under the same operator is silent (no session-change notification).
//   - If no token can be obtained, AppWriteSignInRequired is thrown BEFORE the save is sent: nothing
//     reaches the server and the page's edits stay where they are.
//   - A save is sent at most once. A refused or failed save is NEVER re-sent automatically.
//   - Sign out on this page pauses saving here at the click, before any request, until an explicit
//     sign-in. Every other tab is stopped by the SERVER (revocation checked at token issue and at every
//     write), not by any browser signal.
// =====================================================================================================
export const SAVING_TOKEN_ENDPOINT = "/.netlify/functions/app-write-token";
/** A token with less than this left is replaced before a save is sent. */
export const RENEW_MARGIN_MS = 60_000;
export const SAVE_SIGN_IN_ENDED_MESSAGE = "Saving paused: your IAOS sign-in has ended. Sign in again to save. Your edits have not been submitted.";
export const SAVE_SIGNED_OUT_MESSAGE = "Saving paused: you signed out of IAOS on this page. Sign in again to save. Your edits have not been submitted.";
export const SAVE_UNAVAILABLE_MESSAGE = "Saving paused: IAOS can't confirm your sign-in right now. Your edits have not been submitted. Try again.";

let pending: Promise<{ token: string; expiresAt: string }> | null = null;
/** Bumped whenever the token is discarded, so a token requested before that moment is never used. */
let tokenEpoch = 0;
let pausedBySignOut = false;

function signal(name: string) { if (typeof window !== "undefined") window.dispatchEvent(new Event(name)); }

function discardToken() {
  pending = null; tokenEpoch += 1;
  if (session) changed(null);
}

function adopt(value: { token: string; expiresAt: string }) {
  // Same operator: a silent renewal (generation unchanged). A different operator or no session: a session change.
  if (session && claimSub(session.token) === claimSub(value.token)) { session = value; return; }
  changed(value);
}

async function requestToken(): Promise<{ token: string; expiresAt: string }> {
  let res: Response;
  try {
    res = await fetch(SAVING_TOKEN_ENDPOINT, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "X-IAOS-Session": "saving-token" } });
  } catch { throw new AppWriteSignInRequired(SAVE_UNAVAILABLE_MESSAGE); }
  if (res.status === 401) {
    // The IAOS session itself is gone (expired, revoked, signed in before one sign-in): the read gate shows
    // its recovery screen; the page stays mounted with its edits.
    signal(READ_SESSION_LOST_EVENT);
    throw new AppWriteSignInRequired(SAVE_SIGN_IN_ENDED_MESSAGE);
  }
  if (await isSessionUnavailable(res)) { signal(SESSION_UNAVAILABLE_EVENT); throw new AppWriteSignInRequired(SAVE_UNAVAILABLE_MESSAGE); }
  if (!res.ok) throw new AppWriteSignInRequired(SAVE_UNAVAILABLE_MESSAGE);
  const body = await res.json().catch(() => null);
  // Timed from arrival with the server's stated lifetime, so a skewed computer clock cannot make a fresh token look expired.
  const lifetime = body?.expiresInSeconds;
  if (typeof body?.token !== "string" || !body.token || typeof lifetime !== "number" || !Number.isFinite(lifetime) ||
      lifetime * 1000 <= RENEW_MARGIN_MS || lifetime > 900) {
    throw new AppWriteSignInRequired(SAVE_UNAVAILABLE_MESSAGE);
  }
  return { token: body.token, expiresAt: new Date(Date.now() + lifetime * 1000).toISOString() };
}

async function savingToken(): Promise<string> {
  if (pausedBySignOut) throw new AppWriteSignInRequired(SAVE_SIGNED_OUT_MESSAGE);
  if (session && Date.parse(session.expiresAt) - Date.now() > RENEW_MARGIN_MS) return session.token;
  const asked = tokenEpoch;
  if (!pending) {
    const request = requestToken();
    pending = request;
    request.then(
      (value) => { if (pending === request) pending = null; if (tokenEpoch === asked && !pausedBySignOut) adopt(value); },
      () => { if (pending === request) pending = null; },
    );
  }
  const value = await pending;
  // Signed out, or the session ended, while the token was being issued: never use it.
  if (pausedBySignOut) throw new AppWriteSignInRequired(SAVE_SIGNED_OUT_MESSAGE);
  if (tokenEpoch !== asked) throw new AppWriteSignInRequired(SAVE_SIGN_IN_ENDED_MESSAGE);
  return value.token;
}

async function oneLoginWriteFetch(url: string, init: RequestInit): Promise<Response> {
  const token = await savingToken();   // throws before anything is sent
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  // Refused: drop this token so the NEXT save asks again, and let the read gate re-check. This save is NOT re-sent.
  if (response.status === 401) { if (session?.token === token) discardToken(); signal(READ_SESSION_LOST_EVENT); }
  else if (await isSessionUnavailable(response)) signal(SESSION_UNAVAILABLE_EVENT);
  return response;
}

/** One IAOS sign-in: the read session is not (or no longer) signed in -- drop the token; the next save asks again. */
export function clearAppWriteToken() { discardToken(); }
/** One IAOS sign-in: Sign out was clicked on this page -- refuse every later save here until an explicit sign-in. */
export function pauseAppWriteForSignOut() { pausedBySignOut = true; discardToken(); }
/** One IAOS sign-in: an explicit sign-in completed on this page. */
export function resumeAppWriteAccess() { pausedBySignOut = false; }
/** One IAOS sign-in: obtain a token now so the operator identity is known before the first save. Failures are silent. */
export function primeAppWriteSession(): void {
  if (!oneLoginActive() || pausedBySignOut) return;
  savingToken().catch(() => { /* the next save reports it */ });
}
