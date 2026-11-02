/**
 * Offline harness for test-dashboard-callback-popover.cjs.
 *
 * Renders the REAL Dashboard and ContactWorkspace on their real routes with the real GHL client. Every
 * /.netlify/functions request is answered by the Playwright test from fictional fixtures; nothing leaves the
 * machine. Never deployed; Vite serves it only to the test.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// A placeholder bearer token: the test answers (and refuses) every write itself.
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });

const [{ BrowserRouter, Routes, Route, Navigate, useNavigate }, { default: Dashboard }, { default: ContactWorkspace }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/pages/Dashboard"),
  import("../../../src/pages/ContactWorkspace"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void } }

function NavBridge() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename="/scripts/harness/dashboard-callback-popover/index.html">
    <NavBridge />
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/contacts/:id" element={<ContactWorkspace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </BrowserRouter>,
);
