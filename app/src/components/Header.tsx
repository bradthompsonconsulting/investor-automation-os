import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/dashboard":     "Dashboard",
  "/contacts":      "Contacts",
  "/conversations": "Conversations",
  "/calendars":     "Calendars",
  "/pipeline":      "Pipeline",
  "/mailers":       "Mailers",
  "/segmentation":  "Segmentation",
  "/map":           "Map",
  "/import":        "Add Leads",
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
    </div>
  );
}
