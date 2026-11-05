/**
 * B15-27b -- offline harness for the B15-27b suites (test-b15-27b-*.cjs).
 *
 * The B15-27 harness (scripts/harness/b15-27-cross-contact) plus the operator:
 * `?op=<name>` starts the write session as that operator, and
 * `window.__iaosSetOperator(name)` switches it in place (null signs out), so
 * the suites can prove that a draft kept for one operator is never shown to
 * another. Renders the REAL ContactWorkspace and SellerCallWorkspace with the
 * real GHL client; every /.netlify/functions request is answered (and can be
 * held) by the test. A full document load of this page is the suites'
 * "reload": the page's JS state is new, browser storage is kept. Never
 * deployed. With --before=<rev> the runner generates a sibling entry that
 * renders <rev>'s files (the negative control).
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";
import { setAppWriteSession } from "../../../src/lib/app-write-session";

setRuntimeConfig(projectRuntimeConfig(getConfig("test")));
/* A placeholder bearer token whose payload carries `sub`, the operator the page
   reads (app-write-session claimSub). The test answers ghl-write itself. */
const tokenFor = (op: string) => `h.${btoa(JSON.stringify({ sub: op })).replace(/=+$/, "")}.s`;
function setOperator(op: string | null) {
  setAppWriteSession(op === null ? null : { token: tokenFor(op), expiresAt: "2099-01-01T00:00:00.000Z" });
}
setOperator(new URLSearchParams(location.search).get("op") ?? "operator-one");

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: ContactWorkspace }, { default: SellerCallWorkspace }] =
  await Promise.all([
    import("react-router-dom"),
    import("../../../src/pages/ContactWorkspace"),
    import("../../../src/pages/SellerCallWorkspace"),
  ]);

declare global { interface Window { __iaosNavigate?: (to: string) => void; __iaosSetOperator?: (op: string | null) => void } }
window.__iaosSetOperator = setOperator;

function ExposeNavigate() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ExposeNavigate />
    <Routes>
      <Route path="/contacts/:id" element={<ContactWorkspace />} />
      <Route path="/contacts/:id/seller-call" element={<SellerCallWorkspace />} />
    </Routes>
  </BrowserRouter>,
);
