/**
 * B14-13 — offline harness for test-seller-call-airdroid.cjs: the REAL Seller
 * Call workspace.
 *
 * Renders SellerCallWorkspace on its real route with the real GHL client and
 * the app's stylesheet. Every /.netlify/functions request (reads and saves) is
 * answered by the Playwright test from an in-memory fixture; the AirDroid
 * launch interface is aliased to airdroid-launch-mock.ts. No real call and no
 * record write is possible. Never deployed; Vite serves it only to the test.
 */
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession, bindPageActivation } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// A placeholder bearer token: the test answers ghl-write itself (as contact-isolation's harness does).
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });
void bindPageActivation();

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: SellerCallWorkspace }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/pages/SellerCallWorkspace"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void } }

function ExposeNavigate() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ExposeNavigate />
    <Routes>
      <Route path="/contacts/:id/seller-call" element={<SellerCallWorkspace />} />
      <Route path="*" element={<p data-testid="elsewhere">Elsewhere</p>} />
    </Routes>
  </BrowserRouter>,
);
