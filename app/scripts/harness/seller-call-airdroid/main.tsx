/**
 * B14-13 — offline harness for test-seller-call-airdroid.cjs: the component.
 *
 * Renders the REAL SellerCallVoiceControls (with its stylesheet and the app's
 * index.css). The test aliases the component's launch interface to
 * airdroid-launch-mock.ts, so every launch is mocked. The seller number can be
 * changed from the test, and so can the seller (contact id and name) alone.
 * Never deployed; Vite serves it only to the test.
 * workspace.html renders the full Seller Call page the same way.
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

declare global { interface Window { __iaosSource?: string; __iaosSetPhone?: (p: string) => void; __iaosSetSeller?: (id: string, name: string) => void } }
window.__iaosSource = before["./VoiceControlsBefore.tsx"] ? "before" : "current";

function Page() {
  const [phone, setPhone] = useState(new URLSearchParams(location.search).get("phone") ?? "");
  const [seller, setSeller] = useState({ id: "contact-fixture-1", name: "Kay Fixture" });
  window.__iaosSetPhone = setPhone;
  window.__iaosSetSeller = (id, name) => setSeller({ id, name });
  return (
    <div style={{ padding: 16 }}>
      <SellerCallVoiceControls contactId={seller.id} sellerName={seller.name} sellerPhone={phone} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Page />);
