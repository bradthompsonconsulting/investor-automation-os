import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { READ_SESSION_ENDPOINT, READ_SESSION_LOST_EVENT } from "../lib/read-session";
import { ReadViewReport } from "./access-status";

type Status =
  | { kind: "checking" }
  | { kind: "unconfigured" }
  | { kind: "signed_out"; message: string }
  | { kind: "signed_in"; expiresAt: number };

/**
 * SECURITY -- read gate. No page (and so no GHL read) mounts until the server
 * confirms a read session. The session is an HttpOnly cookie this component
 * never sees; it only asks app-read-session whether one is present. A popup
 * message is a hint to re-check, never proof of sign-in.
 *
 * Once a session has existed on this page, losing it does NOT unmount the
 * page: a write's outcome message (e.g. "saved, cannot be verified") must
 * stay visible. The sign-in bar appears above it and further reads refuse.
 *
 * Board 15 B5 (presentation only): the status this component already has is
 * reported to Layout through ReadViewReport, so the sidebar can lock and the
 * signed-in line can sit in the header area. No extra request is made.
 */
export default function ReadAccess({ children }: { children: ReactNode }) {
  const popup = useRef<Window | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [wasSignedIn, setWasSignedIn] = useState(false);
  useEffect(() => { if (status.kind === "signed_in") setWasSignedIn(true); }, [status.kind]);
  /* Bumped when sign-in returns after a lapse: the page remounts and reloads. */
  const [epoch, setEpoch] = useState(0);
  const lapsed = useRef(false);
  useEffect(() => {
    if (status.kind === "signed_in") { if (lapsed.current) { lapsed.current = false; setEpoch((e) => e + 1); } }
    else if (wasSignedIn && status.kind !== "checking") lapsed.current = true;
  }, [status.kind, wasSignedIn]);
  const report = useContext(ReadViewReport);
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  useEffect(() => {
    report(status.kind === "signed_in"
      ? { kind: "signed_in", expiresAt: status.expiresAt, signOut: () => { void signOutRef.current(); } }
      : { kind: status.kind });
  }, [status, report]);

  const check = useCallback(async (signedOutMessage = "Sign in to read IAOS data.") => {
    try {
      const res = await fetch(READ_SESSION_ENDPOINT, { cache: "no-store", credentials: "same-origin" });
      if (res.status === 503) { setStatus({ kind: "unconfigured" }); return; }
      const body = res.ok ? await res.json() : null;
      const expiresAt = Date.parse(body?.expiresAt ?? "");
      if (body?.signedIn === true && Number.isFinite(expiresAt) && expiresAt > Date.now()) setStatus({ kind: "signed_in", expiresAt });
      else setStatus({ kind: "signed_out", message: signedOutMessage });
    } catch {
      setStatus({ kind: "signed_out", message: "Couldn't reach read sign-in. Try again." });
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "iaos-app-read-signed-in") return;
      popup.current.close(); popup.current = null;
      void check();
    };
    const lost = () => { void check("Read session ended. Sign in to continue."); };
    window.addEventListener("message", receive);
    window.addEventListener(READ_SESSION_LOST_EVENT, lost);
    return () => { window.removeEventListener("message", receive); window.removeEventListener(READ_SESSION_LOST_EVENT, lost); };
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
    // Clears the cookie in THIS browser only. A copied signed token is not
    // revoked server-side; it stays valid until its own 8-hour expiry.
    try { await fetch(READ_SESSION_ENDPOINT, { method: "DELETE", credentials: "same-origin" }); } catch { /* re-checked below */ }
    setWasSignedIn(false); // an explicit sign-out hides the page, unlike an expiry
    await check("Signed out of reads.");
  }

  // Signed in: the status line (with Sign out) is rendered by Layout. The page
  // lives in ONE keyed wrapper in every state, so hiding it behind the
  // recovery screen keeps it mounted; the key changes only when sign-in comes
  // back after a lapse, so every page then reloads its data fresh.
  const page = <div key={`page-${epoch}`} hidden={status.kind !== "signed_in"} aria-hidden={status.kind !== "signed_in"}>{children}</div>;
  // Same shape in every state (fragment: [recovery card or nothing, page]) so React never remounts the page on a lapse.
  if (status.kind === "signed_in") return <>{null}{page}</>;
  const text = status.kind === "checking" ? "Checking sign-in…" :
    status.kind === "unconfigured" ? "Read sign-in is not configured for this site. No IAOS data can be shown." :
    status.message;
  if (!wasSignedIn) {
    // No session yet: one sign-in landing, nothing else.
    return <div role="status" data-testid={`read-access-${status.kind}`} className="max-w-md mx-auto mt-16 p-6 rounded-lg text-white" style={{ background: "#14213d" }}>
      <h1 className="text-xl font-semibold mb-2">Sign in to IAOS</h1>
      <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.7)" }}>{text}</p>
      {status.kind === "signed_out" && <button onClick={signIn} className="px-4 py-2 rounded font-semibold" style={{ background: "#1EC8FF", color: "#07142E" }}>Sign in</button>}
    </div>;
  }
  // Board 15 cleanup (Brad's Test check, 2026-10-06): the session ended on a
  // page. Show a clear sign-in recovery screen instead of the page's own
  // failed reads (which surfaced as raw 401 JSON). The page stays mounted but
  // hidden -- work in progress and anything saved are kept -- and reloads with
  // current data once sign-in returns.
  return <>
    <div key="recovery" role="status" data-testid="read-access-recovery" className="max-w-md mx-auto mt-16 p-6 rounded-lg text-white" style={{ background: "#14213d" }}>
      <h1 className="text-xl font-semibold mb-2">Your sign-in has ended</h1>
      <p className="text-sm mb-2" style={{ color: "rgba(255,255,255,0.7)" }} data-testid={`read-access-${status.kind}`}>{text}</p>
      <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.7)" }}>Nothing you saved is lost. Sign in again to continue — this page reloads with current data.</p>
      {status.kind === "signed_out" && <button onClick={signIn} className="px-4 py-2 rounded font-semibold" style={{ background: "#1EC8FF", color: "#07142E" }}>Sign in again</button>}
    </div>
    {page}
  </>;
}
