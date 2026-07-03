import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard     from "./pages/Dashboard";
import Contacts      from "./pages/Contacts";
import Pipeline      from "./pages/Pipeline";
import Segmentation  from "./pages/Segmentation";
import MaoCalculator from "./pages/MaoCalculator";
import MapPage       from "./pages/MapPage";
import Import        from "./pages/Import";
import Settings      from "./pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"     element={<Dashboard />} />
          <Route path="contacts"      element={<Contacts />} />
          <Route path="pipeline"      element={<Pipeline />} />
          <Route path="segmentation"  element={<Segmentation />} />
          <Route path="mao-calculator"element={<MaoCalculator />} />
          <Route path="map"           element={<MapPage />} />
          <Route path="import"        element={<Import />} />
          <Route path="settings"      element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
