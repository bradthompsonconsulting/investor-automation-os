import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#0A0E1A" }}>
      {/* Fixed-width sidebar */}
      <aside className="w-60 shrink-0 flex flex-col overflow-hidden">
        <Sidebar />
      </aside>

      {/* Right column: header + scrollable content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <header
          className="h-16 shrink-0 flex items-center px-6 border-b"
          style={{ background: "#0D1B3E", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <Header />
        </header>

        <main className="flex-1 overflow-auto p-6" style={{ background: "#0A0E1A" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
