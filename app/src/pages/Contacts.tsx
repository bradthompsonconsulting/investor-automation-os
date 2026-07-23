import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Users } from "lucide-react";
import { ghl, type ContactGridRow } from "../lib/ghl";

// ── Date formatting ────────────────────────────────────────────────────────────
// Date Added column: gridRows() passes the ISO string (or null); render a short
// human date, "—" when absent or unparseable.
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ── Column definitions (§5.1 Grid V1 — five columns; no clickable sorting) ─────

interface ColumnDef {
  label: string;
  render: (r: ContactGridRow) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
  {
    label: "Name",
    // Name links to the Contact Workspace (§5.1 / §3 / §8 step 2b) via the row's
    // NON-VISIBLE id. Read-only navigation — no GHL call, no write. Casing is
    // PRESERVED as returned (§5.1 casing decision) — never title-cased.
    render: (r) => (
      <Link
        to={`/contacts/${r.id}`}
        style={{ fontWeight: 500, color: "#F1F5F9", textDecoration: "none", cursor: "pointer" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#1EC8FF")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#F1F5F9")}
      >
        {r.name || <em style={{ color: "#475569" }}>Unknown</em>}
      </Link>
    ),
  },
  {
    label: "Phone",
    render: (r) => (
      <span style={{ color: "#94A3B8", fontFamily: "monospace", fontSize: "13px" }}>
        {r.phone || <span style={{ color: "#334155" }}>—</span>}
      </span>
    ),
  },
  {
    label: "Email",
    render: (r) => (
      <span style={{ color: "#94A3B8", fontSize: "13px" }}>
        {r.email || <span style={{ color: "#334155" }}>—</span>}
      </span>
    ),
  },
  {
    label: "Property Address",
    render: (r) => (
      <span style={{ color: "#94A3B8", fontSize: "13px" }}>
        {r.propertyAddress || <span style={{ color: "#334155" }}>—</span>}
      </span>
    ),
  },
  {
    label: "Date Added",
    render: (r) => (
      <span style={{ color: "#94A3B8", fontSize: "13px", whiteSpace: "nowrap" }}>
        {fmtDate(r.dateAdded)}
      </span>
    ),
  },
];

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      {[160, 120, 180, 200, 90].map((w, i) => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <div
            style={{
              height: "14px",
              width: `${w}px`,
              borderRadius: "4px",
              background: "#1B2433",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Contacts() {
  const [rows,    setRows]    = useState<ContactGridRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    ghl.contacts.gridRows()
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // §5.1 default order: Date Added, newest first. This is the fixed presentation
  // order, NOT clickable column sorting (that interactive feature is a later
  // slice). ISO date strings compare lexicographically = chronologically; a null
  // dateAdded ("") sorts last.
  const ordered = useMemo(
    () => [...rows].sort((a, b) => (b.dateAdded ?? "").localeCompare(a.dateAdded ?? "")),
    [rows],
  );

  // ── Error state ─────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "12px" }}>
        <AlertCircle size={32} style={{ color: "#EF4444" }} />
        <p style={{ color: "#F87171", fontWeight: 500 }}>Failed to load contacts</p>
        <p style={{ color: "#64748B", fontSize: "13px", maxWidth: "400px", textAlign: "center" }}>{error}</p>
      </div>
    );
  }

  // ── Table (loading skeleton or data) ────────────────────────────────────────
  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: 0 }}>
            Contacts
          </h1>
          {!loading && (
            <span style={{
              fontSize: "12px", fontWeight: 500, padding: "2px 8px", borderRadius: "999px",
              background: "#1B2433", color: "#64748B",
            }}>
              {rows.length.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Table card */}
      <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    style={{
                      padding: "10px 16px",
                      textAlign: "left",
                      fontSize: "11px",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "#475569",
                      whiteSpace: "nowrap",
                      background: "#07142E",
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : ordered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ padding: "60px 16px", textAlign: "center" }}>
                    <Users size={32} style={{ color: "#334155", margin: "0 auto 12px" }} />
                    <p style={{ color: "#475569", margin: 0 }}>No contacts found</p>
                  </td>
                </tr>
              ) : (
                ordered.map((row) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {COLUMNS.map((col) => (
                      <td
                        key={col.label}
                        style={{ padding: "11px 16px", textAlign: "left" }}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
