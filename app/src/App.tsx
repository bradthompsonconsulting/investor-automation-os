import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard        from "./pages/Dashboard";
import Contacts         from "./pages/Contacts";
import ContactWorkspace from "./pages/ContactWorkspace";
import UnderwritingWorkspace from "./pages/UnderwritingWorkspace";
import SellerCallWorkspace from "./pages/SellerCallWorkspace";
import ContractWorkspace from "./pages/ContractWorkspace";
import DealCalculator from "./pages/DealCalculator";
import Conversations    from "./pages/Conversations";
import Calendars       from "./pages/Calendars";
import Pipeline      from "./pages/Pipeline";
import Mailers       from "./pages/Mailers";
import Segmentation  from "./pages/Segmentation";
import Import        from "./pages/Import";
import EvaluationClose from "./pages/EvaluationClose";

/* B15-03 slice C (Bones C2): a DATA router, so the Seller Call leave guard can use React Router's supported
   useBlocker for every in-app departure -- links, programmatic navigate(), and browser Back/Forward (POP) --
   not only link clicks. The route tree is unchanged; only the router that holds it changed. Created once at
   module scope (App is imported only after the runtime configuration is set, see main.tsx), so StrictMode's
   double render never creates a second router listening to history. */
const router = createBrowserRouter(createRoutesFromElements(
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"     element={<Dashboard />} />
          <Route path="contacts"      element={<Contacts />} />
          <Route path="contacts/:id"  element={<ContactWorkspace />} />
          <Route path="contacts/:id/underwriting" element={<UnderwritingWorkspace />} />
          <Route path="contacts/:id/seller-call" element={<SellerCallWorkspace />} />
          <Route path="contacts/:id/contract" element={<ContractWorkspace />} />
          <Route path="deal-calculator" element={<DealCalculator />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="calendars"     element={<Calendars />} />
          <Route path="pipeline"      element={<Pipeline />} />
          <Route path="mailers"       element={<Mailers />} />
          <Route path="segmentation"  element={<Segmentation />} />
          {/* B15-18 (F57/F58): Map and Settings are empty pages, hidden from the
              sidebar since PR #127; a direct visit goes to the Dashboard, inside
              the same Layout and read sign-in gate. replace: no history entry. */}
          <Route path="map"           element={<Navigate to="/dashboard" replace />} />
          <Route path="import"        element={<Import />} />
          <Route path="settings"      element={<Navigate to="/dashboard" replace />} />
          {/* B15-04 close (design r3): reached by URL only, no sidebar link. Test-only on the server. */}
          <Route path="evaluation-close" element={<EvaluationClose />} />
        </Route>
));

/** Exported ONLY so the offline app-routes harness can drive a programmatic navigate() in tests; nothing in the app imports it. */
export { router };

export default function App() {
  return <RouterProvider router={router} />;
}
