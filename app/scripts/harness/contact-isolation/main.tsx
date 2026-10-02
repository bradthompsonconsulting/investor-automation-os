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

const [{ BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams }, { default: ContactWorkspace }, { default: SellerCallWorkspace }, { DispositionControl }] =
  await Promise.all([
    import("react-router-dom"),
    import("../../../src/pages/ContactWorkspace"),
    import("../../../src/pages/SellerCallWorkspace"),
    import("../../../src/components/DispositionControl"),
  ]);

/* The real DispositionControl with an explicit callback status, so the
   Not Interested gate can be driven in the state ContactWorkspace hands it
   when the loaded record is not the contact on screen. */
function DispositionHarness() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const cb = params.get("callback");
  const status = cb === "unknown" ? "unknown" : cb ? { iso: cb } : null;
  return <DispositionControl contactId={id} contact={null} callbackStatus={status}
    onAttempt={() => {}} onNoteWritten={() => {}} onCallback={() => {}} />;
}

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
      <Route path="/harness/disposition/:id" element={<DispositionHarness />} />
    </Routes>
  </BrowserRouter>,
);
