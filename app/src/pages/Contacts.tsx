import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Users, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
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

// ── Column definitions (§5.1 Grid V1 — five columns; Name + Date Added sortable) ─

// §5.1 Sort: only Name and Date Added carry a sortKey → only they are clickable.
type SortKey = "name" | "dateAdded";

interface ColumnDef {
  label: string;
  sortKey?: SortKey; // present ⇒ header is clickable-to-sort; absent ⇒ inert header
  render: (r: ContactGridRow) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
  {
    label: "Name",
    sortKey: "name",
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
    sortKey: "dateAdded",
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
  const [search,  setSearch]  = useState("");
  // §5.1 Sort: single active column + direction. Initial = Date Added, descending
  // (unchanged from 4c0db07). No persistence — resets to this on remount.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "dateAdded",
    dir: "desc",
  });

  useEffect(() => {
    ghl.contacts.gridRows()
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // §5.1 Sort: `ordered` is the sort-driven spine that `filtered` consumes below,
  // so search narrows without reordering. Name → localeCompare (accents fold to
  // base letter; names are OBSERVED lowercased so case is moot). Date Added →
  // lexicographic ISO compare = chronological; a null/absent dateAdded sorts LAST
  // in BOTH directions (never floats to the top of an ascending sort). Default
  // {dateAdded, desc} reproduces the prior newest-first order.
  const ordered = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const copy = [...rows];
    if (sort.key === "name") {
      copy.sort((a, b) => dir * a.name.localeCompare(b.name));
    } else {
      copy.sort((a, b) => {
        if (!a.dateAdded && !b.dateAdded) return 0;
        if (!a.dateAdded) return 1;
        if (!b.dateAdded) return -1;
        return dir * a.dateAdded.localeCompare(b.dateAdded);
      });
    }
    return copy;
  }, [rows, sort]);

  // §5.1 Sort toggle: clicking the active column flips its direction; clicking a
  // different sortable column makes it active at its initial direction (Name →
  // asc, Date Added → desc). Two-state only — no return-to-default third click.
  function onHeaderClick(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }

  // §5.1 Search (V1 — client-side, TWO-BRANCH). Filters over `ordered`, so the
  // active sort order is preserved — search narrows the list,
  // never reorders it. Branch 1: a digits-only query is matched as a SUBSTRING
  // against the row's phone with non-digits stripped (so 2149146151 matches the
  // stored E.164 +12149146151); Name and Email are excluded from this path.
  // Branch 2: any query containing a non-digit uses case-insensitive substring
  // matching across Name, Phone, Email. Property Address is excluded (mirrors
  // GHL's own query behavior). No fuzzy matching, no ranking.
  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return ordered;
    if (/^\d+$/.test(q)) {
      return ordered.filter((r) => r.phone.replace(/\D/g, "").includes(q));
    }
    const lc = q.toLowerCase();
    return ordered.filter(
      (r) =>
        r.name.toLowerCase().includes(lc) ||
        r.phone.toLowerCase().includes(lc) ||
        r.email.toLowerCase().includes(lc),
    );
  }, [ordered, search]);

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
              {(search.trim() ? filtered.length : rows.length).toLocaleString()}
            </span>
          )}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email…"
          style={{ width: "280px", padding: "8px 12px", fontSize: "13px",
                   color: "#F1F5F9", background: "#0D1B3E",
                   border: "1px solid rgba(255,255,255,0.10)",
                   borderRadius: "8px", outline: "none" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#1EC8FF")}
          onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)")}
        />
      </div>

      {/* Table card */}
      <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {COLUMNS.map((col) => {
                  const active = !!col.sortKey && sort.key === col.sortKey;
                  return (
                    <th
                      key={col.label}
                      onClick={col.sortKey ? () => onHeaderClick(col.sortKey!) : undefined}
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
                        cursor: col.sortKey ? "pointer" : "default",
                        userSelect: "none",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        {col.label}
                        {col.sortKey &&
                          (active ? (
                            sort.dir === "asc" ? (
                              <ChevronUp size={13} style={{ color: "#1EC8FF" }} />
                            ) : (
                              <ChevronDown size={13} style={{ color: "#1EC8FF" }} />
                            )
                          ) : (
                            <ChevronsUpDown size={13} style={{ color: "#334155" }} />
                          ))}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ padding: "60px 16px", textAlign: "center" }}>
                    <Users size={32} style={{ color: "#334155", margin: "0 auto 12px" }} />
                    <p style={{ color: "#475569", margin: 0 }}>
                      {search.trim()
                        ? `No contacts match "${search.trim()}"`
                        : "No contacts found"}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
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
