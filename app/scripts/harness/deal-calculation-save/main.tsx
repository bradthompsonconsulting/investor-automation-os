/**
 * B15-25 Phase 2 -- offline harness for test-deal-calculation-save.cjs.
 *
 * Renders the REAL DealCalculator page (and so the real DealCalculationSavePanel) on its real route with the
 * real GHL client. Every /.netlify/functions request is answered by the Playwright test; nothing leaves the
 * machine. Never deployed; Vite serves it only to the test.
 *
 * Test-only additions: a placeholder write session (the test answers ghl-write itself, as the contact-isolation
 * harness does), and the carrier's format/parse on `window` so the test can build and check note bodies.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";
import { formatDealCalculationNote, parseDealCalculationNote } from "../../../src/lib/deal-calculation-carrier";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });
(window as unknown as Record<string, unknown>).__dealCalc = { format: formatDealCalculationNote, parse: parseDealCalculationNote, arvField: getConfig("test").opportunityFacts.arv };

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
