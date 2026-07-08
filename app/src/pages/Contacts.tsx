import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ChevronUp, ChevronDown, ChevronsUpDown, AlertCircle, Users, Calculator } from "lucide-react";
import { ghl, type ContactRow } from "../lib/ghl";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "name" | "phone" | "email" | "combinedScore" | "motivationScore" | "dealScore";
type SortDir = "asc" | "desc";

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span style={{ color: "#475569", fontFamily: "monospace" }}>—</span>;
  }
  let color = "#475569"; // 0 or null
  if (score > 0 && score < 25)  color = "#EF4444";
  if (score >= 25 && score < 50) color = "#F59E0B";
  if (score >= 50 && score < 75) color = "#22C55E";
  if (score >= 75)               color = "#1EC8FF";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "44px",
        height: "28px",
        borderRadius: "6px",
        background: score === 0 ? "transparent" : `${color}1A`,
        border: `1px solid ${score === 0 ? "#334155" : `${color}44`}`,
        color: score === 0 ? "#475569" : color,
        fontSize: "13px",
        fontWeight: 600,
        fontFamily: "Space Grotesk, monospace",
        letterSpacing: "-0.02em",
      }}
    >
      {score}
    </span>
  );
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />;
  return dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

// ── Column definitions ────────────────────────────────────────────────────────

interface ColumnDef {
  key: SortKey;
  label: string;
  sortable: boolean;
  align?: "left" | "center";
  render: (c: ContactRow) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
  {
    key: "name",
    label: "Name",
    sortable: true,
    render: (c) => (
      <span style={{ fontWeight: 500, color: "#F1F5F9" }}>
        {[c.firstName, c.lastName].filter(Boolean).join(" ") || <em style={{ color: "#475569" }}>Unknown</em>}
      </span>
    ),
  },
  {
    key: "phone",
    label: "Phone",
    sortable: false,
    render: (c) => (
      <span style={{ color: "#94A3B8", fontFamily: "monospace", fontSize: "13px" }}>
        {c.phone || <span style={{ color: "#334155" }}>—</span>}
      </span>
    ),
  },
  {
    key: "email",
    label: "Email",
    sortable: false,
    render: (c) => (
      <span style={{ color: "#94A3B8", fontSize: "13px" }}>
        {c.email || <span style={{ color: "#334155" }}>—</span>}
      </span>
    ),
  },
  {
    key: "combinedScore",
    label: "Combined",
    sortable: true,
    align: "center",
    render: (c) => <ScoreBadge score={c.combinedScore} />,
  },
  {
    key: "motivationScore",
    label: "Motivation",
    sortable: true,
    align: "center",
    render: (c) => <ScoreBadge score={c.motivationScore} />,
  },
  {
    key: "dealScore",
    label: "Deal",
    sortable: true,
    align: "center",
    render: (c) => <ScoreBadge score={c.dealScore} />,
  },
];

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      {[160, 120, 180, 44, 44, 44, 70].map((w, i) => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <div
            style={{
              height: "14px",
              width: `${w}px`,
              borderRadius: "4px",
              background: "#1B2433",
              animation: "pulse 1.5s ease-in-out infinite",
              margin: i >= 3 ? "0 auto" : undefined,
            }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Contacts() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [sortKey,  setSortKey]  = useState<SortKey>("combinedScore");
  const [sortDir,  setSortDir]  = useState<SortDir>("desc");

  useEffect(() => {
    ghl.contacts.listAll()
      .then(setContacts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    return [...contacts].sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortKey === "name") {
        aVal = `${a.lastName}${a.firstName}`.toLowerCase();
        bVal = `${b.lastName}${b.firstName}`.toLowerCase();
      } else {
        aVal = a[sortKey] ?? -1;
        bVal = b[sortKey] ?? -1;
      }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [contacts, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key.includes("Score") ? "desc" : "asc");
    }
  }

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
              {contacts.length.toLocaleString()}
            </span>
          )}
        </div>
        <span style={{ fontSize: "12px", color: "#334155" }}>
          Sorted by {sortKey === "combinedScore" ? "Combined" : sortKey === "motivationScore" ? "Motivation" : sortKey === "dealScore" ? "Deal" : sortKey} {sortDir.toUpperCase()}
        </span>
      </div>

      {/* Table card */}
      <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    style={{
                      padding: "10px 16px",
                      textAlign: col.align ?? "left",
                      fontSize: "11px",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: sortKey === col.key ? "#1EC8FF" : "#475569",
                      cursor: col.sortable ? "pointer" : "default",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                      background: "#07142E",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      {col.label}
                      {col.sortable && <SortIcon active={sortKey === col.key} dir={sortDir} />}
                    </span>
                  </th>
                ))}
                <th style={{
                  padding: "10px 16px", textAlign: "center", fontSize: "11px", fontWeight: 600,
                  letterSpacing: "0.06em", textTransform: "uppercase", color: "#475569",
                  whiteSpace: "nowrap", background: "#07142E",
                }}>
                  Analyze
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} style={{ padding: "60px 16px", textAlign: "center" }}>
                    <Users size={32} style={{ color: "#334155", margin: "0 auto 12px" }} />
                    <p style={{ color: "#475569", margin: 0 }}>No contacts found</p>
                  </td>
                </tr>
              ) : (
                sorted.map((contact) => (
                  <tr
                    key={contact.id}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        style={{ padding: "11px 16px", textAlign: col.align ?? "left" }}
                      >
                        {col.render(contact)}
                      </td>
                    ))}
                    <td style={{ padding: "11px 16px", textAlign: "center" }}>
                      <Link
                        to={`/mao-calculator?contactId=${encodeURIComponent(contact.id)}`}
                        title="Analyze in Deal Calculator"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600,
                          padding: "5px 10px", borderRadius: "6px", border: "1px solid rgba(30,200,255,0.3)",
                          background: "rgba(30,200,255,0.08)", color: "#1EC8FF", textDecoration: "none",
                        }}
                      >
                        <Calculator size={12} /> Analyze
                      </Link>
                    </td>
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
