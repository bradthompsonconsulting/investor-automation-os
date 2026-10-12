/**
 * B15-17 (INV-126) — offline harness for test-b15-shell-labels.cjs.
 *
 * Renders the REAL Layout (sidebar, header, status line, ReadAccess gate)
 * around the REAL Conversations page and a plain second route, with the real
 * GHL client. Every /.netlify/functions request is answered by the Playwright
 * test. Never deployed; Vite serves it only to the test.
 *
 * Negative control: with --before=<rev> the test writes, next to this file,
 * that revision's Header (HeaderBefore.tsx), a copy of the Layout that uses
 * it (LayoutBefore.tsx) and that revision's Conversations page
 * (ConversationsBefore.tsx), imports re-pointed at src/. This harness then
 * renders those instead. The test removes all three files.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob(["./LayoutBefore.tsx", "./ConversationsBefore.tsx"]);
const loadLayout = before["./LayoutBefore.tsx"] ?? (() => import("../../../src/components/Layout"));
const loadConversations = before["./ConversationsBefore.tsx"] ?? (() => import("../../../src/pages/Conversations"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Conversations }] = await Promise.all([
  import("react-router-dom"),
  loadLayout() as Promise<{ default: () => JSX.Element }>,
  loadConversations() as Promise<{ default: () => JSX.Element }>,
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosShellSource?: string } }
window.__iaosShellSource = before["./LayoutBefore.tsx"] ? "before" : "current";

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
        <Route path="conversations" element={<Conversations />} />
        <Route path="elsewhere" element={<p data-testid="elsewhere">Another page</p>} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
