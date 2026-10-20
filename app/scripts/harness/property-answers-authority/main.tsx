/**
 * B15-04 C1–C4 r4 -- offline harness for test-property-answers-authority.cjs (authority, identity and late
 * replies). Renders the REAL PropertyAnswersPanel with the REAL client and in-memory write session; every
 * /.netlify/functions request is answered by the Playwright test (the real handler in Node). Never deployed.
 *
 * Hooks: __setWriteSession sets the session exactly as AppWriteAccess does; __start mounts the panel;
 * __setTarget switches contact/deal as navigating to another contact does.
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PropertyAnswersPanel } from "../../../src/components/PropertyAnswersPanel";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

const w = window as unknown as Record<string, unknown>;
function Host() {
  const [target, setTarget] = useState<{ contactId: string; dealId: string } | null>(null);
  w.__start = (contactId = "fxContactX1", dealId = "fxDealA00001") => setTarget({ contactId, dealId });
  w.__setTarget = (contactId: string, dealId: string) => setTarget({ contactId, dealId });
  if (!target) return null;
  return <PropertyAnswersPanel contactId={target.contactId} deals={[{ id: target.dealId, name: `IAOS PROBE ${target.dealId}` }]} />;
}
w.__setWriteSession = (value: { token: string; expiresAt: string } | null) => setAppWriteSession(value);
createRoot(document.getElementById("root")!).render(<Host />);
w.__harnessReady = true;
