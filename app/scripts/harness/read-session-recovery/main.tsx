/**
 * Board 15 cleanup — offline harness for test-read-session-recovery.cjs.
 *
 * Renders the REAL Layout (sidebar, status line, ReadAccess gate) with the
 * REAL Dashboard, on real routes, with the real GHL client. Nothing here is
 * mocked: every /.netlify/functions request (including app-read-session) is
 * answered by the Playwright test, which decides when the read session ends.
 * Never deployed; Vite serves it only to the test.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Dashboard }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  import("../../../src/pages/Dashboard"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void } }

function ExposeNavigate() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

const BASE = "/scripts/harness/read-session-recovery/index.html";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ExposeNavigate />
    <Routes>
      <Route path={BASE} element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="elsewhere" element={<p data-testid="elsewhere">Another page</p>} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
