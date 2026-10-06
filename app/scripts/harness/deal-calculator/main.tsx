/**
 * Board 15 / PR #124 re-review — offline harness for test-deal-calculator-interaction.cjs.
 *
 * Renders the REAL DealCalculator page on its real route with the real GHL
 * client. Every /.netlify/functions request is answered by the Playwright
 * test; nothing leaves the machine. Never deployed; Vite serves it only to
 * the test.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const [{ BrowserRouter, Routes, Route }, { default: DealCalculator }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/pages/DealCalculator"),
]);

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="*" element={<DealCalculator />} />
    </Routes>
  </BrowserRouter>,
);
