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
 */
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob("./ContactsBefore.tsx");
const loadContacts = before["./ContactsBefore.tsx"] ?? (() => import("../../../src/pages/Contacts"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Contacts }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  loadContacts() as Promise<{ default: () => JSX.Element }>,
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosContactsSource?: string } }
window.__iaosContactsSource = before["./ContactsBefore.tsx"] ? "before" : "current";

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
