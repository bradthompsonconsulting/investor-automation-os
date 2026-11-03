import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { READ_SESSION_ENDPOINT, READ_SESSION_LOST_EVENT } from "../lib/read-session";
import { SESSION_UNAVAILABLE_EVENT, SESSION_UNAVAILABLE_MARKER } from "../lib/one-login";
import { clearAppWriteToken, pauseAppWriteForSignOut, primeAppWriteSession, resumeAppWriteAccess } from "../lib/app-write-session";
import { ReadRecovered, ReadViewReport, type ReadView } from "./access-status";

/** The ONE status line while one IAOS sign-in is on (Layout renders this instead of AppWriteAccess): no saving control. */
export function OneLoginStatusLine({ read }: { read: ReadView }) {
  if (read.kind !== "signed_in") return null;
  return <div role="status" data-testid="session-status" className="text-sm" style={{ padding: "6px 16px", color: "#fff", background: "#14213d" }}>
    <span data-testid="read-access-signed-in">
      Signed in until {new Date(read.expiresAt).toLocaleTimeString()} · <button onClick={read.signOut}>Sign out</button></span>
  </div>;
}

export const SIGN_OUT_ENDPOINT = "/.netlify/functions/app-signout";
/** Client bound on one Sign out attempt (wall clock on this computer; not a server guarantee). */
export const SIGN_OUT_CLIENT_TIMEOUT_MS = 10_000;
export const SIGNED_OUT_TEXT = "Signed out of IAOS.";
export const SIGN_OUT_NOT_CONFIRMED_TEXT = "Sign-out not confirmed. IAOS could not verify this Sign out. Saving is paused on this page.";
export const UNAVAILABLE_TEXT = "IAOS can't confirm your sign-in right now. Your page and unsaved edits are kept.";

type Status =
  | { kind: "checking" }
  | { kind: "unconfigured" }
  | { kind: "signed_out"; message: string }
  | { kind: "signed_in"; expiresAt: number }
  | { kind: "unavailable"; message: string }
  | { kind: "signing_out" }
  | { kind: "signout_unconfirmed"; message: string };

/**
 * SECURITY -- B15-29 (INV-137) read gate while one IAOS sign-in is on
 * (Layout chooses it ONLY when oneLoginActive(); ReadAccess is unchanged and
 * used otherwise). Same page-preserving shape as ReadAccess: the page lives in
 * ONE wrapper in every state and is never remounted, so drafts, saves in flight
 * and their warnings survive every state below.
 *
 *   signed_in            the server confirmed the session AND a verified-absent revocation; holds this tab's
 *                        current revoke-only handle (memory only, never storage, never logged)
 *   signed_out           no session, an expired one, or a VERIFIED revocation ("Signed out of IAOS.")
 *   unavailable          IAOS could not confirm the session (C1). NOT signed out, NOT a sign-in prompt:
 *                        [Try again] re-checks deliberately; no automatic loop
 *   signout_unconfirmed  Sign out was not acknowledged; saving stays paused on this page; [Try Sign out again]
 *                        re-sends the SAME frozen handle (it can only ever revoke the old session)
 *
 * Every status request and Sign out attempt is tagged with this tab's session
 * generation (bumped when Sign out begins and when it is confirmed); a late
 * answer from an earlier generation or attempt is discarded. The status is
 * re-checked on load, focus and visibility, after any refused or unavailable
 * answer -- never while a Sign out is pending or unconfirmed. Other tabs are
 * stopped by the server, not by this component.
 */
export default function OneLoginAccess({ children }: { children: ReactNode }) {
  const popup = useRef<Window | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [wasSignedIn, setWasSignedIn] = useState(false);
  useEffect(() => { if (status.kind === "signed_in") setWasSignedIn(true); }, [status.kind]);
  const [epoch, setEpoch] = useState(0);
  const lapsed = useRef(false);
  const generation = useRef(0);
  const attempt = useRef(0);
  const handle = useRef<string | null>(null);
  const frozen = useRef<string | null>(null);
  const signOutBusy = useRef(false);
  useEffect(() => {
    if (status.kind === "signed_in") {
      if (lapsed.current) { lapsed.current = false; setEpoch((e) => e + 1); }
      primeAppWriteSession();
    } else if (wasSignedIn && status.kind !== "checking") lapsed.current = true;
    // Any state other than signed in: no saving token is kept (the next save asks again, and is refused if still not signed in).
    if (status.kind !== "signed_in" && status.kind !== "checking") clearAppWriteToken();
  }, [status.kind, wasSignedIn]);
  const report = useContext(ReadViewReport);
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  useEffect(() => {
    report(status.kind === "signed_in"
      ? { kind: "signed_in", expiresAt: status.expiresAt, signOut: () => { void signOutRef.current(); } }
      : { kind: status.kind === "signing_out" ? "signout_unconfirmed" : status.kind });
  }, [status, report]);

  const check = useCallback(async (signedOutMessage = "Sign in to read IAOS data.") => {
    if (signOutBusy.current || frozen.current) return;   // never while a Sign out is pending or unconfirmed
    const g = generation.current;
    let res: Response;
    try { res = await fetch(READ_SESSION_ENDPOINT, { cache: "no-store", credentials: "same-origin" }); }
    catch { if (g === generation.current && !frozen.current) setStatus({ kind: "unavailable", message: UNAVAILABLE_TEXT }); return; }
    const body = await res.json().catch(() => null);
    if (g !== generation.current || frozen.current) return;   // an answer from before a Sign out began: discarded
    if (res.status === 503 && body?.by === "iaos-app-read-unconfigured") { setStatus({ kind: "unconfigured" }); return; }
    if (res.status === 503 && body?.by === SESSION_UNAVAILABLE_MARKER) { setStatus({ kind: "unavailable", message: UNAVAILABLE_TEXT }); return; }
    if (!res.ok) { setStatus({ kind: "unavailable", message: UNAVAILABLE_TEXT }); return; }
    const expiresAt = Date.parse(body?.expiresAt ?? "");
    if (body?.state === "signed_in" && body?.signedIn === true && typeof body?.handle === "string" && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      handle.current = body.handle;
      setStatus({ kind: "signed_in", expiresAt });
    } else {
      handle.current = null;
      setStatus({ kind: "signed_out", message: body?.state === "revoked" ? "Signed out of IAOS. Sign in to continue." : signedOutMessage });
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "iaos-app-read-signed-in") return;
      popup.current.close(); popup.current = null;
      // A deliberate sign-in: a new session; any old frozen handle is dropped and saving may resume here.
      generation.current += 1; frozen.current = null; handle.current = null;
      resumeAppWriteAccess();
      void check();
    };
    const lost = () => { void check("Read session ended. Sign in to continue."); };
    const recheck = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("message", receive);
    window.addEventListener(READ_SESSION_LOST_EVENT, lost);
    window.addEventListener(SESSION_UNAVAILABLE_EVENT, lost);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener(READ_SESSION_LOST_EVENT, lost);
      window.removeEventListener(SESSION_UNAVAILABLE_EVENT, lost);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [check]);

  const expiresAt = status.kind === "signed_in" ? status.expiresAt : 0;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => { void check("Read session expired. Sign in to continue."); }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, check]);

  function signIn() {
    popup.current = window.open("/app-read-login.html", "iaos-app-read-signin", "popup,width=480,height=620");
    if (!popup.current) setStatus({ kind: "signed_out", message: "Allow the sign-in popup to read IAOS data." });
  }

  async function signOut() {
    if (signOutBusy.current) return;
    // At the click, before any request: saving on this page stops, and earlier status answers are void.
    pauseAppWriteForSignOut();
    generation.current += 1;
    const g = generation.current;
    const a = ++attempt.current;
    // Freeze the target once: a retry NEVER refetches or retargets (it can only revoke the old session).
    if (!frozen.current) frozen.current = handle.current;
    const target = frozen.current;
    if (!target) { setStatus({ kind: "signout_unconfirmed", message: SIGN_OUT_NOT_CONFIRMED_TEXT }); return; }
    signOutBusy.current = true;
    setStatus({ kind: "signing_out" });
    const deadline = Date.now() + SIGN_OUT_CLIENT_TIMEOUT_MS;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SIGN_OUT_CLIENT_TIMEOUT_MS);
    let confirmed = false;
    try {
      const res = await fetch(SIGN_OUT_ENDPOINT, {
        method: "POST", cache: "no-store", credentials: "same-origin", signal: ac.signal,
        headers: { "Content-Type": "application/json", "X-IAOS-Session": "sign-out" },
        body: JSON.stringify({ handle: target }),
      });
      const body = await res.json().catch(() => null);
      confirmed = res.status === 200 && body?.state === "revoked";
    } catch { confirmed = false; } finally { clearTimeout(timer); signOutBusy.current = false; }
    // Only the current attempt in the current generation, within its own deadline, may change what is shown.
    if (a !== attempt.current || g !== generation.current) return;
    if (confirmed && Date.now() <= deadline) {
      frozen.current = null; handle.current = null; generation.current += 1;
      setWasSignedIn(false); // an explicit, confirmed sign-out hides the page, unlike an expiry
      setStatus({ kind: "signed_out", message: SIGNED_OUT_TEXT });
    } else {
      setStatus({ kind: "signout_unconfirmed", message: SIGN_OUT_NOT_CONFIRMED_TEXT });
    }
  }

  const page = <div key="page" hidden={status.kind !== "signed_in"} aria-hidden={status.kind !== "signed_in"}>
    <ReadRecovered.Provider value={epoch}>{children}</ReadRecovered.Provider>
  </div>;
  if (status.kind === "signed_in") return <>{null}{page}</>;
  const text = status.kind === "checking" ? "Checking sign-in…" :
    status.kind === "signing_out" ? "Signing out…" :
    status.kind === "unconfigured" ? "Read sign-in is not configured for this site. No IAOS data can be shown." :
    status.message;
  const action = status.kind === "signed_out"
    ? <button onClick={signIn} className="px-4 py-2 rounded font-semibold" style={{ background: "#1EC8FF", color: "#07142E" }}>{wasSignedIn ? "Sign in again" : "Sign in"}</button>
    : status.kind === "unavailable"
      ? <button data-testid="one-login-try-again" onClick={() => { void check(); }} className="px-4 py-2 rounded font-semibold" style={{ background: "#1EC8FF", color: "#07142E" }}>Try again</button>
      : status.kind === "signout_unconfirmed"
        ? <button data-testid="one-login-retry-sign-out" onClick={() => { void signOut(); }} className="px-4 py-2 rounded font-semibold" style={{ background: "#1EC8FF", color: "#07142E" }}>Try Sign out again</button>
        : null;
  if (!wasSignedIn) {
    // No session yet: one sign-in landing, nothing else -- no page (and so no GHL read) mounts before the server confirms.
    return <div role="status" data-testid={`read-access-${status.kind}`} className="max-w-md mx-auto mt-16 p-6 rounded-lg text-white" style={{ background: "#14213d" }}>
      <h1 className="text-xl font-semibold mb-2">Sign in to IAOS</h1>
      <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.7)" }}>{text}</p>
      {action}
    </div>;
  }
  const title = status.kind === "unavailable" ? "IAOS can't confirm your sign-in right now"
    : status.kind === "signout_unconfirmed" || status.kind === "signing_out" ? "Sign-out not confirmed yet"
    : "Your sign-in has ended";
  const detail = status.kind === "unavailable"
    ? "Nothing you saved is lost. Anything you haven't saved stays on this page. A new sign-in would not fix this; try again in a moment."
    : status.kind === "signout_unconfirmed" || status.kind === "signing_out"
      ? "Nothing you saved is lost. Anything you haven't saved stays on this page. Nothing is saved from this page until you sign in again."
      : "Nothing you saved is lost. Anything you haven't saved stays on this page. Sign in again to continue — the page then refreshes its data.";
  return <>
    <div key="recovery" role="status" data-testid="read-access-recovery" className="max-w-md mx-auto mt-16 p-6 rounded-lg text-white" style={{ background: "#14213d" }}>
      <h1 className="text-xl font-semibold mb-2">{title}</h1>
      <p className="text-sm mb-2" style={{ color: "rgba(255,255,255,0.7)" }} data-testid={`read-access-${status.kind}`}>{text}</p>
      <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.7)" }}>{detail}</p>
      {action}
    </div>
    {page}
  </>;
}
