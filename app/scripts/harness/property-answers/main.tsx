/**
 * B15-04 answer preservation -- offline harness for test-property-answers-preservation.cjs.
 *
 * Renders the REAL PropertyAnswersPanel with the REAL property-answer client and
 * the REAL in-memory write session. Every /.netlify/functions request is answered
 * by the Playwright test (which runs the real property-answer handler in Node);
 * nothing leaves the machine. Never deployed; Vite serves it only to the test.
 *
 * Test hooks: __setWriteSession sets the module write session exactly as
 * AppWriteAccess does after sign-in; __start mounts the panel; __remount
 * remounts it, as leaving the contact page and returning does.
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PropertyAnswersPanel } from "../../../src/components/PropertyAnswersPanel";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

const w = window as unknown as Record<string, unknown>;
function Host() {
  const [n, setN] = useState(-1);
  w.__start = () => setN(0);
  w.__remount = () => setN((x) => x + 1);
  if (n < 0) return null;
  return <div key={n}><PropertyAnswersPanel contactId="fxContactX1" deals={[{ id: "fxDealA00001", name: "IAOS PROBE A" }]} /></div>;
}
w.__setWriteSession = (value: { token: string; expiresAt: string } | null) => setAppWriteSession(value);
createRoot(document.getElementById("root")!).render(<Host />);
w.__harnessReady = true;
