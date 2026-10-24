/**
 * Pass 1 F33 -- offline harness for test-b15-33-readiness-panel.cjs: the REAL
 * Seller Call workspace on its real route, with the real GHL client.
 *
 * Same set-up as seller-call-airdroid/workspace.tsx, plus the one thing that
 * harness cannot do: a re-read. The real app's ReadAccess bumps ReadRecovered
 * when the read session comes back, and each page re-runs its reads; here the
 * test bumps it with window.__iaosReread(). Every /.netlify/functions request
 * is answered by the Playwright test from an in-memory fixture. No real
 * request and no record write is possible. Never deployed.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";
import { ReadRecovered } from "../../../src/components/access-status";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// A placeholder bearer token: the test answers ghl-write itself (as contact-isolation's harness does).
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: SellerCallWorkspace }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/pages/SellerCallWorkspace"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosReread?: () => void } }

function ExposeNavigate() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

function App() {
  const [epoch, setEpoch] = useState(0);
  window.__iaosReread = () => setEpoch((n) => n + 1);
  return (
    <ReadRecovered.Provider value={epoch}>
      <BrowserRouter>
        <ExposeNavigate />
        <Routes>
          <Route path="/contacts/:id/seller-call" element={<SellerCallWorkspace />} />
          <Route path="*" element={<p data-testid="elsewhere">Elsewhere</p>} />
        </Routes>
      </BrowserRouter>
    </ReadRecovered.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
