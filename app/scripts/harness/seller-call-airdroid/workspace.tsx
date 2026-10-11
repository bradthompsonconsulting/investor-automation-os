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

/**
 * The real app's frame, copied from src/components/Layout.tsx without its sign-in and status pieces: a 240px
 * sidebar, a 64px header, and the content in <main> (overflow auto, 24px padding), which is the element that
 * scrolls in the app. The layout checks render Seller Call inside it at /framed/contacts/:id/seller-call.
 */
function AppFrame() {
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#0A0E1A" }}>
      <aside style={{ width: "240px", flexShrink: 0, overflow: "hidden" }} />
      <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0%", overflow: "hidden" }}>
        <header style={{ height: "64px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.08)" }} />
        <main data-testid="harness-main" style={{ flex: "1 1 0%", overflow: "auto", padding: "24px", background: "#0A0E1A" }}>
          <SellerCallWorkspace />
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ExposeNavigate />
    <Routes>
      <Route path="/contacts/:id/seller-call" element={<SellerCallWorkspace />} />
      <Route path="/framed/contacts/:id/seller-call" element={<AppFrame />} />
      <Route path="*" element={<p data-testid="elsewhere">Elsewhere</p>} />
    </Routes>
  </BrowserRouter>,
);
