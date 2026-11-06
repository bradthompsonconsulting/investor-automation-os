/**
 * B15-25 r4 -- offline component harness for test-b15-25-r4.cjs (Bones P2-2, component level).
 *
 * Renders the REAL DealCalculationSavePanel (real GHL client, real carrier) MOUNTED with figures that are already on
 * screen when it mounts -- e.g. a draft restored from this browser -- exactly the case Bones's review probe used.
 * `?arv=<n>` sets those figures; `?unsaved=1` tells the panel they are unsaved work (what the page passes when Phase 1
 * holds a kept draft). Every /.netlify/functions request is answered by the test. Never deployed.
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";
import type { CalculatorFigures } from "../../../src/components/DealCalculationSavePanel";

setRuntimeConfig({ ...projectRuntimeConfig(getConfig("test")), dealCalculationSave: { enabled: true } });
setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });
/* The panel and carrier read the runtime config when they load: imported only after it is set (as the page harness does). */
const [{ formatDealCalculationNote }, { DealCalculationSavePanel }] = await Promise.all([
  import("../../../src/lib/deal-calculation-carrier"),
  import("../../../src/components/DealCalculationSavePanel"),
]);
(window as unknown as Record<string, unknown>).__dealCalc = { format: formatDealCalculationNote };

const q = new URLSearchParams(location.search);
const initial: CalculatorFigures = {
  arvInput: q.get("arv") ?? "", repairsQuickInput: "", testPriceInput: "", assignmentMode: "standard", manualAmountInput: "", repairsMode: "quick",
};
function Host() {
  const [figures, setFigures] = useState<CalculatorFigures>(initial);
  return (
    <>
      <output data-testid="panel-host-arv">{figures.arvInput}</output>
      <DealCalculationSavePanel contactId={q.get("contactId") ?? ""} opportunityId={q.get("deal")} dealName="Deal 1"
        figures={figures} hasUnsavedWork={q.get("unsaved") === "1"} onLoad={(next) => setFigures(next)} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Host />);
