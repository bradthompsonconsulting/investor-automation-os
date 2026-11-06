/**
 * B15-23 — offline harness for test-conversation-property-styled.cjs.
 *
 * Renders the REAL Layout (sidebar, header, ReadAccess gate) around the REAL
 * Conversations page with the real GHL client AND the app's real stylesheet
 * (src/index.css, built by the same Tailwind Vite plugin as the app), so text
 * widths, wrapping and clipping are the application's. Every
 * /.netlify/functions request is answered by the Playwright test. Never
 * deployed; Vite serves it only to the test.
 *
 * Negative control: with --before=<rev> the test writes that revision's
 * Conversations page next to this file as ConversationsBefore.tsx (imports
 * re-pointed at src/) and this harness renders it instead. The test removes it.
 */
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob("./ConversationsBefore.tsx");
const loadConversations = before["./ConversationsBefore.tsx"] ?? (() => import("../../../src/pages/Conversations"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Conversations }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  loadConversations() as Promise<{ default: () => JSX.Element }>,
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosConversationsSource?: string } }
window.__iaosConversationsSource = before["./ConversationsBefore.tsx"] ? "before" : "current";

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
      </Route>
    </Routes>
  </BrowserRouter>,
);
