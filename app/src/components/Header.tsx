import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/dashboard":     "Dashboard",
  "/contacts":      "Contacts",
  "/conversations": "Conversations",
  "/calendars":     "Calendars",
  "/pipeline":      "Pipeline",
  "/mailers":       "Mailers",
  "/segmentation":  "Segmentation",
  "/mao-calculator":"MAO Calculator",
  "/map":           "Map",
  "/import":        "Import",
  "/settings":      "Settings",
};

export default function Header() {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? "IAOS";

  return (
    <div className="flex items-center justify-between w-full">
      <h2
        className="text-base font-semibold text-white"
        style={{ fontFamily: "Space Grotesk, sans-serif" }}
      >
        {title}
      </h2>
      <div className="flex items-center gap-3">
        <span className="text-xs px-2 py-1 rounded" style={{ background: "#1B2433", color: "#1EC8FF" }}>
          Phase A
        </span>
      </div>
    </div>
  );
}
