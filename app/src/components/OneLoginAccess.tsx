import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import OneLoginScreen, { ReminderDialog, type ScreenAction, type ScreenMessage } from "./OneLoginScreen";
import { dismissReminder, dueReminder, nextReminderDelay, reminderDismissed, reminderMessage } from "../lib/session-reminder";
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
export const SIGNED_OUT_TEXT = "You've signed out of IAOS.";
export const SIGN_OUT_NOT_CONFIRMED_TEXT = "Sign-out not confirmed. IAOS could not verify this Sign out. Saving is paused on this page.";
/** Longest single expiry wait (one day): well under setTimeout's 2^31-1 ms limit. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
export const UNAVAILABLE_TEXT = "IAOS sign-in is temporarily unavailable. Try again.";
/** B15-29 login experience copy (spec §1). */
export const SIGN_IN_LABEL = "Sign In to IAOS";
export const WORKING_TEXT = "Opening secure sign-in…";
export const POPUP_BLOCKED_TEXT = "Allow pop-ups for IAOS to sign in.";
export const EXPIRED_TEXT = "Your 30-day session has ended. Sign in to continue — your unsaved work is still here.";

/** Why there is no session: none known (first visit / expired cookie), ended while open, revoked by a Sign out elsewhere, or Sign out here. */
type SignedOutReason = "none" | "ended" | "revoked" | "signed_out_here";
type Status =
  | { kind: "checking" }
  | { kind: "unconfigured" }
  | { kind: "signed_out"; reason: SignedOutReason }
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
 *
 * B15-29 login experience (spec SPEC_LOGIN_EXPERIENCE): with no session yet the full-page entrance screen is shown
 * and the routed app is not rendered (the URL is never touched, so the deep link is where the app opens). Once the
 * page has been signed in, every later state is an opaque full-viewport OVERLAY above the still-mounted, inert page
 * (never unmounted, so drafts survive; focus returns after). The 5-day / 1-day reminder is computed only from the
 * server's absolute `expiresAt`; Remind Me Later records a dismissal and sends nothing; Log In Again opens the
 * overlay, and its sign-in is a NEW 30-day session (the old one is left to expire).
 */
export default function OneLoginAccess({ children }: { children: ReactNode }) {
  const popup = useRef<Window | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [wasSignedIn, setWasSignedIn] = useState(false);
  useEffect(() => { if (status.kind === "signed_in") setWasSignedIn(true); }, [status.kind]);
  const [epoch, setEpoch] = useState(0);
  const lapsed = useRef(false);
  const [popupState, setPopupState] = useState<"idle" | "working" | "blocked">("idle");
  const [relogin, setRelogin] = useState(false);
  const [tick, setTick] = useState(0);
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

  const check = useCallback(async (signedOutReason: SignedOutReason = "none") => {
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
      setStatus({ kind: "signed_out", reason: body?.state === "revoked" ? "revoked" : signedOutReason });
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
      setPopupState("idle");
      void check().then(() => setRelogin(false));
    };
    const lost = () => { void check("ended"); };
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
  const [rearm, setRearm] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    // B15-29 r6: a 30-day expiry is beyond setTimeout's 2^31-1 ms limit (an overflow would fire at once and loop), so the
    // wait is capped at one day; at that point the status is simply re-checked and the timer re-armed.
    const timer = setTimeout(() => { setRearm((n) => n + 1); void check("ended"); }, Math.min(MAX_TIMER_MS, Math.max(0, expiresAt - Date.now())));
    return () => clearTimeout(timer);
  }, [expiresAt, check, rearm]);

  // Reminder checkpoints (T5, T1) from the server's absolute expiry: re-evaluated at each status answer and by a
  // local timer at the next checkpoint (capped at one day). No request is made here.
  useEffect(() => {
    if (!expiresAt) return;
    const delay = nextReminderDelay(expiresAt, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [expiresAt, tick]);

  // While the sign-in popup is open: "working"; closed without signing in -> back to idle (no request).
  useEffect(() => {
    if (popupState !== "working") return;
    const timer = setInterval(() => { if (!popup.current || popup.current.closed) { popup.current = null; setPopupState("idle"); } }, 500);
    return () => clearInterval(timer);
  }, [popupState]);

  function signIn() {
    popup.current = window.open("/app-read-login.html", "iaos-app-read-signin", "popup,width=480,height=620");
    setPopupState(popup.current ? "working" : "blocked");
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
      setStatus({ kind: "signed_out", reason: "signed_out_here" });
    } else {
      setStatus({ kind: "signout_unconfirmed", message: SIGN_OUT_NOT_CONFIRMED_TEXT });
    }
  }

  const signedIn = status.kind === "signed_in";
  // Not signed in: the page stays MOUNTED (drafts, saves in flight) but is not painted (visibility keeps its layout and
  // scroll position) under the opaque overlay, and the overlay layer makes it inert.
  const page = <div key="page" data-testid="one-login-app" style={signedIn ? undefined : { visibility: "hidden" }} aria-hidden={!signedIn || undefined}>
    <ReadRecovered.Provider value={epoch}>{children}</ReadRecovered.Provider>
  </div>;

  const signInAction: ScreenAction = { label: SIGN_IN_LABEL, onClick: signIn, testId: "one-login-sign-in", busy: popupState === "working" };
  const popupMessage: ScreenMessage | null = popupState === "working" ? { text: WORKING_TEXT, tone: "status" }
    : popupState === "blocked" ? { text: POPUP_BLOCKED_TEXT, tone: "alert" } : null;
  const msg = (text: string, tone: "status" | "alert" = "status"): ScreenMessage => ({ text, tone, testId: `read-access-${status.kind}` });
  const tryAgain: ScreenAction = { label: "Try again", onClick: () => { void check(); }, testId: "one-login-try-again" };

  let layer: ReactNode = null;
  if (signedIn) {
    if (relogin) {
      layer = <OneLoginScreen key="overlay" mode="overlay" testId="one-login-relogin" heading="Log in again"
        line="Start a new 30-day session. Your work on this page stays where it is."
        primary={signInAction} message={popupMessage}
        secondary={{ label: "Cancel", onClick: () => { setRelogin(false); setPopupState("idle"); }, testId: "one-login-cancel" }} />;
    } else {
      const due = dueReminder(status.expiresAt, Date.now());
      if (due !== null && !reminderDismissed(status.expiresAt, due)) {
        const at = status.expiresAt;
        layer = <ReminderDialog key={`reminder-${due}`} text={reminderMessage(due)}
          onLater={() => { dismissReminder(at, due); setTick((n) => n + 1); }}
          onLogIn={() => { dismissReminder(at, due); setRelogin(true); }} />;
      }
    }
  } else if (!wasSignedIn) {
    // No session yet: the full-page entrance, nothing else -- no page (and so no GHL read) mounts before the server confirms.
    const heading = "Welcome to IAOS";
    const line = "Sign in to open your investor workspace.";
    layer = status.kind === "checking"
      ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" message={msg("Checking your session…")} footer={false} />
      : status.kind === "unconfigured"
        ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line}
            message={msg("Read sign-in is not configured for this site. No IAOS data can be shown.", "alert")} />
        : status.kind === "unavailable"
          // An outage is never a sign-in prompt: Try again re-checks; there is no sign-in button.
          ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line} primary={tryAgain} message={msg(status.message, "alert")} />
          : status.kind === "signed_out"
            ? <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line} primary={signInAction}
                message={popupMessage ?? (status.reason === "revoked" || status.reason === "signed_out_here" ? msg(SIGNED_OUT_TEXT) : null)} />
            : <OneLoginScreen key="entrance" mode="entrance" testId="one-login-entrance" heading={heading} line={line}
                message={msg(status.kind === "signing_out" ? "Signing out…" : status.message, status.kind === "signing_out" ? "status" : "alert")} />;
  } else {
    // The page was signed in: every state is the overlay above the mounted, inert page.
    const keep = "Nothing you saved is lost. Anything you haven't saved stays on this page.";
    layer = status.kind === "signed_out"
      ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery"
          heading={status.reason === "revoked" ? "You've signed out" : "Your session has ended"}
          line="Sign in again to continue where you left off." primary={signInAction}
          message={popupMessage ?? msg(status.reason === "revoked" ? SIGNED_OUT_TEXT : EXPIRED_TEXT)} />
      : status.kind === "unavailable"
        ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="IAOS can't confirm your sign-in right now"
            line={`${keep} A new sign-in would not fix this; try again in a moment.`} primary={tryAgain} message={msg(status.message, "alert")} />
        : status.kind === "signout_unconfirmed"
          ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="Sign-out not confirmed yet"
              line={`${keep} Nothing is saved from this page until you sign in again.`}
              primary={{ label: "Try Sign out again", onClick: () => { void signOut(); }, testId: "one-login-retry-sign-out" }} message={msg(status.message, "alert")} />
          : status.kind === "signing_out"
            ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="Signing out" line={keep} message={msg("Signing out…")} />
            : status.kind === "unconfigured"
              ? <OneLoginScreen key="overlay" mode="overlay" testId="read-access-recovery" heading="Sign-in is not configured" line={keep}
                  message={msg("Read sign-in is not configured for this site. No IAOS data can be shown.", "alert")} />
              : null;
  }
  return <>{layer}{signedIn || wasSignedIn ? page : null}</>;
}
