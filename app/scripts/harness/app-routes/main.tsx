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
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));

const before = import.meta.glob("./AppBefore.tsx");
const loadApp = before["./AppBefore.tsx"] ?? (() => import("../../../src/App"));

declare global { interface Window { __iaosAppSource?: string; __iaosHistoryAtMount?: number } }
window.__iaosAppSource = before["./AppBefore.tsx"] ? "before" : "current";

const start = new URLSearchParams(window.location.search).get("start");
if (start) window.history.replaceState(null, "", start);
window.__iaosHistoryAtMount = window.history.length;

const { default: App } = (await loadApp()) as { default: () => JSX.Element };
createRoot(document.getElementById("root")!).render(<App />);
