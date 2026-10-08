/**
 * B15-09 (INV-108) — offline harness for test-pipeline-requests.cjs.
 *
 * Renders the REAL Layout (ReadAccess gate and read-recovery signal) around
 * the REAL Pipeline page, with the real GHL client. Every /.netlify/functions
 * request, app-read-session included, is answered by the Playwright test,
 * which decides when each opportunities read completes. Never deployed; Vite
 * serves it only to the test.
 *
 * Negative control: when the test is run with --before=<rev> it writes that
 * revision's Pipeline page next to this file as PipelineBefore.tsx (imports
 * re-pointed at src/), and this harness renders it instead. The test removes
 * the file when it finishes.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob("./PipelineBefore.tsx");
const loadPipeline = before["./PipelineBefore.tsx"] ?? (() => import("../../../src/pages/Pipeline"));

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: Pipeline }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  loadPipeline() as Promise<{ default: () => JSX.Element }>,
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosPipelineSource?: string } }
window.__iaosPipelineSource = before["./PipelineBefore.tsx"] ? "before" : "current";

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
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="elsewhere" element={<p data-testid="elsewhere">Another page</p>} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
