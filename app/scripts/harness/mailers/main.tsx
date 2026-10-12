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
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob("./MailersBefore.tsx");
const loadMailers = before["./MailersBefore.tsx"] ?? (() => import("../../../src/pages/Mailers"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Mailers }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  loadMailers() as Promise<{ default: () => JSX.Element }>,
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosMailersSource?: string } }
window.__iaosMailersSource = before["./MailersBefore.tsx"] ? "before" : "current";

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
