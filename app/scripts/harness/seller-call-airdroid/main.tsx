/**
 * B14-13 — offline harness for test-seller-call-airdroid.cjs.
 *
 * Renders the REAL SellerCallVoiceControls (with its stylesheet and the app's
 * index.css) above a stand-in script panel and notes box, the way Seller Call
 * places them. The seller number can be changed from the test. Never
 * deployed; Vite serves it only to the test.
 *
 * Every click is observed AFTER it bubbles through React (a window listener):
 * the link it would open and whether the page cancelled it are recorded, and
 * then the harness cancels it, so no external launch link ever reaches the
 * operating system and no helper or AirDroid is ever invoked.
 *
 * Negative control: with --before=<rev> the test writes that revision's
 * component next to this file as VoiceControlsBefore.tsx and this harness
 * renders it instead. The test removes the file.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob("./VoiceControlsBefore.tsx");
const load = before["./VoiceControlsBefore.tsx"] ?? (() => import("../../../src/components/SellerCallVoiceControls"));
const { SellerCallVoiceControls } = (await load()) as typeof import("../../../src/components/SellerCallVoiceControls");

type Launch = { href: string; defaultPrevented: boolean };
declare global { interface Window { __iaosSource?: string; __iaosLaunches: Launch[]; __iaosSetPhone?: (p: string) => void } }
window.__iaosSource = before["./VoiceControlsBefore.tsx"] ? "before" : "current";
window.__iaosLaunches = [];
window.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || !/^iaos-airdroid:/.test(a.getAttribute("href") ?? "")) return;
  window.__iaosLaunches.push({ href: a.getAttribute("href")!, defaultPrevented: e.defaultPrevented });
  e.preventDefault();
});

function Page() {
  const [phone, setPhone] = useState(new URLSearchParams(location.search).get("phone") ?? "");
  window.__iaosSetPhone = setPhone;
  return (
    <div style={{ padding: 16 }}>
      <SellerCallVoiceControls contactId="contact-fixture-1" sellerName="Kay Fixture" sellerPhone={phone} />
      <section data-testid="script-panel"><h2>Script</h2><p>Hi, this is Brad. Is now still a good time to talk about the house?</p></section>
      <label>Notes<textarea data-testid="notes" rows={4} /></label>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
