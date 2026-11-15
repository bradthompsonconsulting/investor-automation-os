/**
 * B15-29 single-flight status (design r1–r6) -- offline harness for test-b15-29-status-single-flight.cjs.
 *
 * Renders the REAL Layout with ONE IAOS sign-in on (this harness's runtime configuration carries
 * `oneLogin: { active: true }`, as the server sends only while ONE_LOGIN_ENABLED) around the REAL Dashboard as the
 * index route, so the Dashboard's own readers run through the real read client. A route OUTSIDE Layout ("/away")
 * unmounts OneLoginAccess. Every /.netlify/functions request is answered by the Playwright test from fictional
 * fixtures; nothing leaves the machine. The test serves this page with VITE_IAOS_STATUS_PROBE=1, which enables the
 * harness-only trace and probe in OneLoginAccess; the application build never defines it. Never deployed.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig({ ...projectRuntimeConfig(getConfig("test"), "test"), oneLogin: { active: true } });

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Dashboard }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  import("../../../src/pages/Dashboard"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void } }

function NavBridge() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename="/scripts/harness/one-login-dashboard/index.html">
    <NavBridge />
    <Routes>
      <Route path="/away" element={<div data-testid="away">away</div>} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
