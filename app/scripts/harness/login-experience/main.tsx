/**
 * B15-29 (INV-137) -- offline harness for test-b15-29-login-experience-page.cjs.
 *
 * The REAL Layout (status line, Sign out) and, because this harness's runtime configuration carries
 * `oneLogin: { active: true }` (as the server sends ONLY while ONE_LOGIN_ENABLED), the REAL OneLoginAccess gate with
 * the REAL OneLoginScreen / reminder dialog, around a workspace page that stands in for the Seller Call: a draft held
 * ONLY in component memory, the routed URL shown, links between routes, and a save through the REAL saving module.
 * The test serves this page for any /ws/... deep link (the browser keeps the deep-link URL). Never deployed.
 */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig({ ...projectRuntimeConfig(getConfig("test"), "test"), oneLogin: { active: true } });

const [{ BrowserRouter, Routes, Route, Link, useLocation }, { default: Layout }, { appWriteFetch, AppWriteSignInRequired }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  import("../../../src/lib/app-write-session"),
]);

/** One click = one save request; the result is shown; nothing is ever re-sent. */
function Workspace() {
  const location = useLocation();
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  // Counts real mounts: an overlay that unmounted the page (and so lost the draft) would raise it.
  useEffect(() => { const w = window as unknown as { __workspaceMounts?: number }; w.__workspaceMounts = (w.__workspaceMounts ?? 0) + 1; }, []);
  async function save() {
    try {
      const r = await appWriteFetch("/.netlify/functions/ghl-write", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "note.create", targetId: "fixtureContact", requestId: crypto.randomUUID(), args: { body: text } }),
      });
      setOut(`Save answered ${r.status}`);
    } catch (e) {
      setOut(e instanceof AppWriteSignInRequired ? (e as Error).message : "Save not confirmed");
    }
  }
  return <div style={{ color: "#F5F7FA" }}>
    <p data-testid="route">{location.pathname}{location.search}</p>
    <label htmlFor="draft">Seller Call notes (unsaved draft)</label>
    <textarea id="draft" data-testid="draft" value={text} onChange={(e) => setText(e.target.value)} style={{ display: "block", width: "100%", color: "#000" }} />
    <button data-testid="save" onClick={() => { void save(); }}>Save</button>
    <p data-testid="save-result">{out}</p>
    <Link data-testid="nav-pipeline" to="/ws/pipeline">Pipeline</Link>{" "}
    <Link data-testid="nav-seller" to="/ws/seller-call/42?tab=notes">Seller call</Link>
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="*" element={<Workspace />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
