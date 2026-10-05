import { useEffect, useRef, useState, type ReactNode } from "react";
import { setAppWriteSession } from "../lib/app-write-session";
/**
 * Separate popup keeps Google's global callback independent of voice sign-in.
 *
 * Board 15 B5 (presentation only): stays mounted at all times so its popup
 * listener and expiry timer behave exactly as before, but renders nothing
 * until a read session exists (or while a write session is still active, so
 * saving can always be switched off). When shown, it renders the ONE status
 * line, with the read status passed in as children.
 */
export default function AppWriteAccess({ readSignedIn, children }: { readSignedIn: boolean; children?: ReactNode }) {
  const popup = useRef<Window | null>(null);
  const [expires, setExpires] = useState(0);
  const [message, setMessage] = useState("View only.");
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "iaos-app-write-session") return;
      const value = event.data.session;
      if (typeof value?.token !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return;
      setAppWriteSession(value); setExpires(Date.parse(value.expiresAt)); setMessage("Saving enabled."); popup.current?.close(); popup.current = null;
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (!expires) return;
    const timer = setTimeout(() => { setAppWriteSession(null); setExpires(0); setMessage("Saving session expired. View only."); }, Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [expires]);
  if (!readSignedIn && !expires) return null;
  return <div role="status" data-testid="session-status" className="text-sm" style={{ padding: "6px 16px", color: "#fff", background: "#14213d" }}>
    {children}
    <span data-testid="write-access-status">
      {expires ? <>Saving enabled until {new Date(expires).toLocaleTimeString()}. </> : <>{message} </>}
      {expires ? <button onClick={() => { setAppWriteSession(null); setExpires(0); setMessage("Saving turned off. View only."); }}>Turn off saving</button> :
        <button title="Sign in for application writes" onClick={() => { popup.current = window.open("/app-write-login.html", "iaos-app-write-signin", "popup,width=480,height=620"); if (!popup.current) setMessage("Allow the sign-in popup to enable saving."); }}>Enable saving</button>}
    </span>
  </div>;
}
