/**
 * Board 15 cleanup — offline harness for test-read-session-recovery.cjs.
 *
 * Renders the REAL Layout (sidebar, status line, ReadAccess gate) around the
 * REAL Dashboard, ContactWorkspace and SellerCallWorkspace on their real
 * routes, with the real GHL client. Nothing here is mocked: every
 * /.netlify/functions request (including app-read-session) is answered by the
 * Playwright test, which decides when the read session ends. Never deployed;
 * Vite serves it only to the test.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// A placeholder bearer token: the test answers ghl-write itself.
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Dashboard }, { default: ContactWorkspace }, { default: SellerCallWorkspace }] =
  await Promise.all([
    import("react-router-dom"),
    import("../../../src/components/Layout"),
    import("../../../src/pages/Dashboard"),
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
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="elsewhere" element={<p data-testid="elsewhere">Another page</p>} />
        <Route path="contacts/:id" element={<ContactWorkspace />} />
        <Route path="contacts/:id/seller-call" element={<SellerCallWorkspace />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
