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

const [{ BrowserRouter, Routes, Route, useNavigate, useParams }, { default: ContactWorkspace }, { default: SellerCallWorkspace }, { DncControl }, { useEffect }] =
  await Promise.all([
    import("react-router-dom"),
    import("../../../src/pages/ContactWorkspace"),
    import("../../../src/pages/SellerCallWorkspace"),
    import("../../../src/components/DncControl"),
    import("react"),
  ]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __dncMounts?: number } }

/* B14-12 #122: the REAL DncControl kept MOUNTED while its contactId changes A -> B (the Contact
   page unmounts it on navigation, so a retained instance is exercised here). Counts mounts so the
   test can prove the same instance was kept. */
function RetainedDnc() {
  const { id } = useParams();
  return <DncControl contactId={id!} detail={null} />;
}
function CountDncMounts() {
  useEffect(() => { window.__dncMounts = (window.__dncMounts ?? 0) + 1; }, []);
  return null;
}

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
      <Route path="/dnc-retained/:id" element={<><CountDncMounts /><RetainedDnc /></>} />
    </Routes>
  </BrowserRouter>,
);
