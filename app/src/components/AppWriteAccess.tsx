import { useEffect, useRef, useState } from "react";
import { setAppWriteSession } from "../lib/app-write-session";
/** Separate popup keeps Google's global callback independent of voice sign-in. */
export default function AppWriteAccess() {
  const popup = useRef<Window | null>(null);
  const [expires, setExpires] = useState(0);
  const [message, setMessage] = useState("Read access. Sign in to save changes.");
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "iaos-app-write-session") return;
      const value = event.data.session;
      if (typeof value?.token !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return;
      setAppWriteSession(value); setExpires(Date.parse(value.expiresAt)); setMessage("Application writes authorized."); popup.current?.close(); popup.current = null;
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (!expires) return;
    const timer = setTimeout(() => { setAppWriteSession(null); setExpires(0); setMessage("Write session expired. Sign in before saving."); }, Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [expires]);
  return <div role="status" style={{ padding: "8px 16px", color: "#fff", background: "#14213d" }}>
    {message} {expires ? <button onClick={() => { setAppWriteSession(null); setExpires(0); setMessage("Signed out of application writes."); }}>Sign out</button> :
      <button onClick={() => { popup.current = window.open("/app-write-login.html", "iaos-app-write-signin", "popup,width=480,height=620"); if (!popup.current) setMessage("Allow the sign-in popup to authorize application writes."); }}>Sign in for writes</button>}
  </div>;
}
