/**
 * B14-12 / PR #115 — offline harness for test-contact-isolation.cjs.
 *
 * Renders the REAL ContactWorkspace and SellerCallWorkspace on their real
 * routes, with the real GHL client. Nothing here is mocked: every
 * /.netlify/functions request is answered by the Playwright test, which can
 * hold any one response to reproduce A -> B navigation while A's writes and
 * reads are still pending. Never deployed; Vite serves it only to the test.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// A placeholder bearer token: the test answers ghl-write itself.
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: ContactWorkspace }, { default: SellerCallWorkspace }] =
  await Promise.all([
    import("react-router-dom"),
    import("../../../src/pages/ContactWorkspace"),
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
      <Route path="/contacts/:id" element={<ContactWorkspace />} />
      <Route path="/contacts/:id/seller-call" element={<SellerCallWorkspace />} />
    </Routes>
  </BrowserRouter>,
);
