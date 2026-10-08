/**
 * B15-11 (INV-111) — offline harness for test-contacts-address-search.cjs.
 *
 * Renders the REAL Layout (ReadAccess gate) around the REAL Contacts page with
 * the real GHL client and the app's real stylesheet (src/index.css, built by
 * the same Tailwind Vite plugin as the app). Every /.netlify/functions request is answered by the
 * Playwright test. Never deployed; Vite serves it only to the test.
 *
 * Negative control: run with --before=<rev>, the test writes that revision's
 * Contacts page next to this file as ContactsBefore.tsx (imports re-pointed at
 * src/) and this harness renders it instead. The test removes the file.
 *
 * Write coverage (the pattern Bones approved for the Mailers suite, e94889a):
 * the page starts with a valid offline write session, and the REAL Layout binds
 * it to the test's open activation, so any write the page made would reach the
 * network and be seen by the test. `__iaosWriteSession` records the session
 * installed here; `__iaosPageActivation` reports the real binding state;
 * `__iaosContactWrite` is a real contact write client call, used by the test's
 * canary and its --inject-write negative control.
 */
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { pageActivation, setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// Offline only: an in-memory session token the test's route answers; nothing is issued or sent anywhere else.
const writeSession = { token: "offline-fixture-write-session", expiresAt: new Date(Date.now() + 3600_000).toISOString() };
setAppWriteSession(writeSession);

const before = import.meta.glob("./ContactsBefore.tsx");
const loadContacts = before["./ContactsBefore.tsx"] ?? (() => import("../../../src/pages/Contacts"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Contacts }, { ghl }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  loadContacts() as Promise<{ default: () => JSX.Element }>,
  import("../../../src/lib/ghl"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosContactsSource?: string;
  __iaosWriteSession?: { expiresAt: string }; __iaosPageActivation?: () => string;
  __iaosContactWrite?: (contactId: string) => Promise<unknown> } }
window.__iaosContactsSource = before["./ContactsBefore.tsx"] ? "before" : "current";
window.__iaosWriteSession = { expiresAt: writeSession.expiresAt };
window.__iaosPageActivation = () => pageActivation();
window.__iaosContactWrite = (contactId) => ghl.contacts.setExplicitCallback(contactId, null);

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
        <Route path="contacts" element={<Contacts />} />
        <Route path="elsewhere" element={<p data-testid="elsewhere">Another page</p>} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
