import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { READ_SESSION_ENDPOINT, READ_SESSION_LOST_EVENT } from "../lib/read-session";

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
 */
export default function ReadAccess({ children }: { children: ReactNode }) {
  const popup = useRef<Window | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [wasSignedIn, setWasSignedIn] = useState(false);
  useEffect(() => { if (status.kind === "signed_in") setWasSignedIn(true); }, [status.kind]);

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

  const bar = { padding: "8px 16px", color: "#fff", background: "#14213d" } as const;
  if (status.kind === "signed_in") {
    return <>
      <div role="status" data-testid="read-access-signed-in" style={bar}>
        Reading as Brad until {new Date(status.expiresAt).toLocaleTimeString()}. <button onClick={() => { void signOut(); }}>Sign out of reads</button>
      </div>
      {children}
    </>;
  }
  const prompt = <div role="status" data-testid={`read-access-${status.kind}`} style={{ ...bar, padding: wasSignedIn ? "8px 16px" : "24px 16px" }}>
    {status.kind === "checking" ? "Checking read sign-in…" :
     status.kind === "unconfigured" ? "Read sign-in is not configured for this site. No IAOS data can be shown." :
     <>{status.message} <button onClick={signIn}>Sign in to read</button></>}
  </div>;
  return wasSignedIn ? <>{prompt}{children}</> : prompt;
}
