/**
 * B15-12 (INV-110) — offline harness for test-mailers-empty-state.cjs.
 *
 * Renders the REAL Layout (ReadAccess gate) around the REAL Mailers page with
 * the real GHL client. Every /.netlify/functions request is answered by the
 * Playwright test. Never deployed; Vite serves it only to the test.
 *
 * Negative control: run with --before=<rev>, the test writes that revision's
 * Mailers page next to this file as MailersBefore.tsx (imports re-pointed at
 * src/) and this harness renders it instead. The test removes the file.
 *
 * Write coverage (Bones, review of 8ac1cad): the page starts with a valid
 * offline write session, and the REAL Layout binds it to the test's open
 * activation, so any write the page made would reach the network and be seen
 * by the test. `__iaosWriteSession` records the session installed here;
 * `__iaosPageActivation` reports the real binding state; `__iaosCompleteTask`
 * is the real completion client call, used only by the test's --inject-write
 * negative control.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { pageActivation, setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
// Offline only: an in-memory session token the test's route answers; nothing is issued or sent anywhere else.
const writeSession = { token: "offline-fixture-write-session", expiresAt: new Date(Date.now() + 3600_000).toISOString() };
setAppWriteSession(writeSession);

const before = import.meta.glob("./MailersBefore.tsx");
const loadMailers = before["./MailersBefore.tsx"] ?? (() => import("../../../src/pages/Mailers"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Mailers }, { ghl }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  loadMailers() as Promise<{ default: () => JSX.Element }>,
  import("../../../src/lib/ghl"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosMailersSource?: string;
  __iaosWriteSession?: { expiresAt: string }; __iaosPageActivation?: () => string;
  __iaosCompleteTask?: (contactId: string, taskId: string) => Promise<unknown> } }
window.__iaosMailersSource = before["./MailersBefore.tsx"] ? "before" : "current";
window.__iaosWriteSession = { expiresAt: writeSession.expiresAt };
window.__iaosPageActivation = () => pageActivation();
window.__iaosCompleteTask = (contactId, taskId) => ghl.mailers.completeTask(contactId, taskId);

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
        <Route path="mailers" element={<Mailers />} />
        <Route path="elsewhere" element={<p data-testid="elsewhere">Another page</p>} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
