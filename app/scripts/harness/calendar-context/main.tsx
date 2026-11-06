/**
 * B15-07 r2 (Bones P2) -- offline harness for test-b15-07-calendar-reliability.cjs, part C.
 *
 * Renders the REAL Calendars page (with the app's real stylesheet) under a READ CONTEXT the test controls: the
 * ReadRecovered epoch (what the read gate advances each time read sign-in comes back after a lapse) and whether the
 * page is hidden (as the gate hides it during a lapse). window.__setCalendarContext({ epoch, hidden }) changes them.
 * Every /.netlify/functions request is answered by the Playwright test. Never deployed.
 *
 * Negative control: with --before=<rev>, the test writes that revision's Calendars page next to this file as
 * CalendarsCtxBefore.tsx (imports re-pointed) and this harness renders it instead. The test removes the file.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { ReadRecovered } from "../../../src/components/access-status";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob("./CalendarsCtxBefore.tsx");
const loadPage = before["./CalendarsCtxBefore.tsx"] ?? (() => import("../../../src/pages/Calendars"));

declare global { interface Window { __calendarCtxSource?: string; __setCalendarContext?: (c: { epoch: number; hidden: boolean }) => void } }
window.__calendarCtxSource = before["./CalendarsCtxBefore.tsx"] ? "before" : "current";

const { default: Calendars } = (await loadPage()) as { default: () => JSX.Element };

function Harness() {
  const [ctx, setCtx] = useState({ epoch: 0, hidden: false });
  window.__setCalendarContext = setCtx;
  return (
    <MemoryRouter>
      <div data-testid="ctx-page" hidden={ctx.hidden}>
        <ReadRecovered.Provider value={ctx.epoch}><Calendars /></ReadRecovered.Provider>
      </div>
    </MemoryRouter>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
