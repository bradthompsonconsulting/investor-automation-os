/**
 * B15-29 (INV-137) -- offline harness for test-b15-29-one-login-page.cjs.
 *
 * Renders the REAL Layout (status line, Sign out, and -- because this harness's runtime configuration carries
 * `oneLogin: { active: true }`, as the server sends ONLY while ONE_LOGIN_ENABLED -- the REAL OneLoginAccess gate)
 * around a minimal draft page that saves through the REAL saving module (appWriteFetch). No token is injected:
 * every save gets its token from app-write-token. Every /.netlify/functions request is answered by the Playwright
 * test with the REAL server handlers. Never deployed; Vite serves it only to the test.
 */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig({ ...projectRuntimeConfig(getConfig("test"), "test"), oneLogin: { active: true } });

const [{ BrowserRouter, Routes, Route }, { default: Layout }, { appWriteFetch, AppWriteSignInRequired }] = await Promise.all([
  import("react-router-dom"),
  import("../../../src/components/Layout"),
  import("../../../src/lib/app-write-session"),
]);

/** One click = one save request; the result is shown; nothing is ever re-sent. */
function DraftPage() {
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
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
  return <div>
    <textarea data-testid="draft" value={text} onChange={(e) => setText(e.target.value)} />
    <button data-testid="save" onClick={() => { void save(); }}>Save</button>
    <p data-testid="save-result">{out}</p>
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="*" element={<DraftPage />} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
