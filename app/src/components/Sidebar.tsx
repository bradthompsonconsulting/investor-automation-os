import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  GitBranch,
  Filter,
  Calculator,
  Map,
  Upload,
  Settings,
} from "lucide-react";

const NAV = [
  { label: "Dashboard",     to: "/dashboard",     icon: LayoutDashboard },
  { label: "Contacts",      to: "/contacts",       icon: Users           },
  { label: "Pipeline",      to: "/pipeline",       icon: GitBranch       },
  { label: "Segmentation",  to: "/segmentation",   icon: Filter          },
  { label: "MAO Calculator",to: "/mao-calculator", icon: Calculator      },
  { label: "Map",           to: "/map",            icon: Map             },
  { label: "Import",        to: "/import",         icon: Upload          },
  { label: "Settings",      to: "/settings",       icon: Settings        },
];

export default function Sidebar() {
  return (
    <div className="flex flex-col h-full" style={{ background: "#07142E" }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{ background: "#1EC8FF", color: "#07142E" }}
          >
            IA
          </div>
          <div>
            <div className="text-sm font-semibold text-white leading-tight" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
              IAOS
            </div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              Automation OS
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => [
              "flex items-center gap-3 mx-2 mb-0.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
              isActive
                ? "text-white"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
            ].join(" ")}
            style={({ isActive }) =>
              isActive
                ? { background: "#1B2433", color: "#1EC8FF", borderLeft: "2px solid #1EC8FF", paddingLeft: "10px" }
                : {}
            }
          >
            <Icon size={17} strokeWidth={1.75} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          Brad Thompson Consulting LLC
        </p>
      </div>
    </div>
  );
}
