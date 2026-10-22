/**
 * B15-26 B1 -- offline harness for test-repair-approval-browser.cjs.
 *
 * Renders the REAL UnderwritingWorkspace on its real route with the real GHL
 * and repair-approval clients, with the repair-approval switch ENABLED only
 * through this test's Vite alias (enabled-config.ts). Every
 * /.netlify/functions request is answered by the test, which runs the REAL
 * repair-approval-save / -status handlers against local fake GHL and Blob
 * services. Never deployed; Vite serves it only to the test.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
declare global { interface Window { __iaosWriteSession?: { token: string; expiresAt: string }; __iaosNavigate?: (to: string) => void } }
// A view-only viewer gets no write session at all (the test omits it).
if (window.__iaosWriteSession) setAppWriteSession(window.__iaosWriteSession);

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: UnderwritingWorkspace }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/pages/UnderwritingWorkspace"),
]);

function ExposeNavigate() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ExposeNavigate />
    <Routes>
      <Route path="/contacts/:id/underwriting" element={<UnderwritingWorkspace />} />
      <Route path="*" element={<div data-testid="elsewhere">Elsewhere</div>} />
    </Routes>
  </BrowserRouter>,
);
