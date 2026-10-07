import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import AppWriteAccess from "./AppWriteAccess";
import ReadAccess from "./ReadAccess";
import { ReadViewReport, type ReadView } from "./access-status";
import { bindPageActivation } from "../lib/app-write-session";

export default function Layout() {
  // Mirrors what ReadAccess already knows (no request of its own).
  const [read, setRead] = useState<ReadView>({ kind: "checking" });
  const readSignedIn = read.kind === "signed_in";
  /* Storage correction (Bones finding 7): bind this page load to the deployment's activation the FIRST
     time read sign-in succeeds -- before any edit or save is possible. Idempotent: later sign-ins
     (session recovery) never rebind. */
  useEffect(() => { if (readSignedIn) void bindPageActivation(); }, [readSignedIn]);
  return (
    <ReadViewReport.Provider value={setRead}>
    <div className="flex h-screen overflow-hidden" style={{ background: "#0A0E1A" }}>
      {/* Fixed-width sidebar */}
      <aside className="w-60 shrink-0 flex flex-col overflow-hidden">
        <Sidebar navEnabled={readSignedIn} />
      </aside>

      {/* Right column: header + scrollable content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <header
          className="h-16 shrink-0 flex items-center px-6 border-b"
          style={{ background: "#0D1B3E", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <Header />
        </header>

        {/* ONE status line: read status + saving (write) status. Hidden until a read session exists. */}
        <AppWriteAccess readSignedIn={readSignedIn}>
          {read.kind === "signed_in" && <span data-testid="read-access-signed-in">
            Signed in until {new Date(read.expiresAt).toLocaleTimeString()} <button onClick={read.signOut}>Sign out</button> · </span>}
        </AppWriteAccess>
        <main className="flex-1 overflow-auto p-6" style={{ background: "#0A0E1A" }}>
          <ReadAccess>
            <Outlet />
          </ReadAccess>
        </main>
      </div>
    </div>
    </ReadViewReport.Provider>
  );
}
