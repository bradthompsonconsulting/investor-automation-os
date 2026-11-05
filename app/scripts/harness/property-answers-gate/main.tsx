/**
 * Board 15 R0b P2 (Bones, 2026-11-05) — offline harness for test-property-answers-gate.cjs.
 *
 * Renders the REAL ContactWorkspace on its real route with the real GHL client, under the
 * runtime projection the server would serve for one deployment, chosen by `?env=`:
 *   production    -> projectRuntimeConfig(getConfig("production"), "production")  (Production as committed)
 *   test          -> projectRuntimeConfig(getConfig("test"), "test")              (Test as committed: evaluation DISABLED)
 *   test-enabled  -> the Test config with ONLY propertyAnswerEvaluation.enabled set to ENABLED, projected for "test"
 * The projection is set before ContactWorkspace is imported, exactly as main.tsx does in the app.
 * Every /.netlify/functions request is answered by the Playwright test. Never deployed.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig, PROPERTY_ANSWER_EVALUATION_ENABLED } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

const env = new URLSearchParams(location.search).get("env");
if (env === "production") setRuntimeConfig(projectRuntimeConfig(getConfig("production"), "production"));
else if (env === "test") setRuntimeConfig(projectRuntimeConfig(getConfig("test"), "test"));
else if (env === "test-enabled") {
  const cfg = JSON.parse(JSON.stringify(getConfig("test")));
  cfg.propertyAnswerEvaluation.enabled = PROPERTY_ANSWER_EVALUATION_ENABLED;
  setRuntimeConfig(projectRuntimeConfig(cfg, "test"));
} else throw new Error(`harness: unknown env ${env}`);
// A placeholder bearer token: the test answers every function itself.
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: ContactWorkspace }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/pages/ContactWorkspace"),
]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosEnv?: string; __iaosRecovery?: unknown } }
window.__iaosEnv = env;

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
    </Routes>
  </BrowserRouter>,
);
