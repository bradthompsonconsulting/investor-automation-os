/**
 * B15-29 (Bones REVISE R2, 2026-11-10) -- offline harness for test-b15-29-one-login-drafts.cjs.
 *
 * The REAL Layout -- and therefore, because this harness's runtime configuration carries `oneLogin: { active: true }`
 * (what the server sends only while ONE_LOGIN_ENABLED), the REAL OneLoginAccess gate with its operator partition --
 * around the REAL Contact page, Seller Call and Deal Calculator, with the real GHL client and the real saving module.
 * There is no saving session set here: the page learns its operator only from the status answers the test gives
 * (synthetic operators), exactly as under one IAOS sign-in. Every /.netlify/functions request is answered by the test
 * (scripts/harness/b15-27b/runner.cjs). A full document load is the suites' "reload": JS state is new, browser storage
 * is kept. Never deployed.
 */
import { createRoot } from "react-dom/client";
import { getConfig, projectRuntimeConfig, setRuntimeConfig } from "../../../shared/ghl-config";

setRuntimeConfig({ ...projectRuntimeConfig(getConfig("test"), "test"), oneLogin: { active: true } });

const [{ BrowserRouter, Routes, Route, useNavigate }, { default: Layout }, { default: ContactWorkspace }, { default: SellerCallWorkspace }, { default: DealCalculator }] =
  await Promise.all([
    import("react-router-dom"),
    import("../../../src/components/Layout"),
    import("../../../src/pages/ContactWorkspace"),
    import("../../../src/pages/SellerCallWorkspace"),
    import("../../../src/pages/DealCalculator"),
  ]);

declare global { interface Window { __iaosNavigate?: (to: string) => void } }
function ExposeNavigate() {
  const navigate = useNavigate();
  window.__iaosNavigate = (to: string) => navigate(to);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ExposeNavigate />
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="contacts/:id" element={<ContactWorkspace />} />
        <Route path="contacts/:id/seller-call" element={<SellerCallWorkspace />} />
        <Route path="deal-calculator" element={<DealCalculator />} />
        <Route path="*" element={<div data-testid="harness-home">harness</div>} />
      </Route>
    </Routes>
  </BrowserRouter>,
);
