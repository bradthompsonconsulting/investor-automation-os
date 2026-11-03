/**
 * B15-18 (INV-127) — offline harness for test-b15-18-map-settings-redirect.cjs.
 *
 * Renders the REAL App (its own BrowserRouter, Layout, ReadAccess gate and
 * every route) with the app's real stylesheet. `?start=/map` replaces the
 * URL before App mounts, so the router's FIRST render is that path: a true
 * direct visit. Every /.netlify/functions request is answered by the
 * Playwright test. Never deployed; Vite serves it only to the test.
 *
 * Negative control: with --before=<rev>, the test writes that revision's App
 * next to this file as AppBefore.tsx (imports re-pointed at src/) and this
 * harness renders it instead. The test removes the file.
 */
import { createRoot } from "react-dom/client";
import "../../../src/index.css";
import { getConfig, projectRuntimeConfig, setRuntimeConfig, SELLER_CONVERSATION_SAVE_ENABLED } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

/* B15-03 slice C: a test may ask (via an init script, before this module runs) for the Save-enabled projection --
   computed by the REAL projectRuntimeConfig from the Test config with only the sentinel switched -- and for a
   placeholder write session (the test answers ghl-write itself). Without it, nothing here changes. */
declare global { interface Window { __iaosHarnessOverride?: { sellerConversationSave?: boolean; writeSession?: boolean } } }
const override = window.__iaosHarnessOverride ?? {};
setRuntimeConfig(override.sellerConversationSave
  ? projectRuntimeConfig({ ...getConfig("test"), sellerConversationSave: SELLER_CONVERSATION_SAVE_ENABLED }, "test")
  : projectRuntimeConfig(getConfig("test")));
if (override.writeSession) setAppWriteSession({ token: "offline-harness", expiresAt: "2099-01-01T00:00:00.000Z" });

const before = import.meta.glob("./AppBefore.tsx");
const loadApp = before["./AppBefore.tsx"] ?? (() => import("../../../src/App"));

declare global { interface Window { __iaosAppSource?: string; __iaosHistoryAtMount?: number } }
window.__iaosAppSource = before["./AppBefore.tsx"] ? "before" : "current";

const start = new URLSearchParams(window.location.search).get("start");
if (start) window.history.replaceState(null, "", start);
window.__iaosHistoryAtMount = window.history.length;

const { default: App } = (await loadApp()) as { default: () => JSX.Element };
createRoot(document.getElementById("root")!).render(<App />);
