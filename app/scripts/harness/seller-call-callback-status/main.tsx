/**
 * B15-20b — offline harness for test-seller-call-callback-status-rendered.cjs
 * and the fictional-data walkthrough.
 *
 * Renders the REAL ContactWorkspace and SellerCallWorkspace on their real
 * routes, with the real GHL client and the app's real stylesheet. Every
 * /.netlify/functions request is answered by the Playwright script from an
 * in-memory fictional fixture. Never deployed; Vite serves it only to tests.
 *
 * Negative control: with --before=<rev> the test writes that revision's
 * Seller Call page next to this file as SellerCallBefore.tsx (imports
 * re-pointed at src/) and this harness renders it instead. The test removes
 * the file.
 */
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// A placeholder bearer token: the script answers ghl-write itself, in memory.
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });

const before = import.meta.glob("./SellerCallBefore.tsx");
const loadSellerCall = before["./SellerCallBefore.tsx"] ?? (() => import("../../../src/pages/SellerCallWorkspace"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: ContactWorkspace }, { default: SellerCallWorkspace }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/pages/ContactWorkspace"),
  loadSellerCall() as Promise<{ default: () => JSX.Element }>,
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosSellerCallSource?: string } }
window.__iaosSellerCallSource = before["./SellerCallBefore.tsx"] ? "before" : "current";

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
