import { useEffect, useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, AlertCircle, Flame, Sun, Snowflake, Scroll } from "lucide-react";
import { ghl, getBucketTag, isProbate, type ContactRow, type BucketTag } from "../lib/ghl";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "combinedScore" | "motivationScore" | "dealScore";
type SortDir = "asc" | "desc";

const SORT_LABEL: Record<SortKey, string> = {
  combinedScore:   "Combined",
  motivationScore: "Motivation",
  dealScore:       "Deal",
};

const TIER_META: Record<BucketTag, { label: string; color: string; icon: typeof Flame }> = {
  hot:  { label: "Hot",  color: "#EF4444", icon: Flame },
  warm: { label: "Warm", color: "#F59E0B", icon: Sun },
  low:  { label: "Low",  color: "#475569", icon: Snowflake },
};

// ── Score badge (mirrors Contacts.tsx) ────────────────────────────────────────

function ScoreBadge({ label, score }: { label: string; score: number | null }) {
  let color = "#475569";
  if (score !== null) {
    if (score > 0 && score < 25)   color = "#EF4444";
    if (score >= 25 && score < 50) color = "#F59E0B";
    if (score >= 50 && score < 75) color = "#22C55E";
    if (score >= 75)               color = "#1EC8FF";
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
      <span
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: "40px", height: "24px", borderRadius: "6px",
          background: !score ? "transparent" : `${color}1A`,
          border: `1px solid ${!score ? "#334155" : `${color}44`}`,
          color: !score ? "#475569" : color,
          fontSize: "12px", fontWeight: 600,
          fontFamily: "Space Grotesk, monospace", letterSpacing: "-0.02em",
        }}
      >
        {score ?? "—"}
      </span>
      <span style={{ fontSize: "9px", color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
    </div>
  );
}

// Data completeness is a confidence flag only — visually distinct (pill, not a score box)
// so it can never be mistaken for a bucket/score signal. Never affects tier placement.
function CompletenessBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  let color = "#EF4444";
  if (score >= 80)      color = "#22C55E";
  else if (score >= 50) color = "#F59E0B";
  return (
    <span
      title={`Data completeness: ${score}% of scoring fields present`}
      style={{
        fontSize: "10px", fontWeight: 500, padding: "2px 7px", borderRadius: "999px",
        background: "rgba(255,255,255,0.03)", border: `1px solid ${color}33`, color,
        whiteSpace: "nowrap",
      }}
    >
      {score}% data
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />;
  return dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

// ── Contact card ───────────────────────────────────────────────────────────────

function ContactCard({ contact }: { contact: ContactRow }) {
  const probate = isProbate(contact);
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown";

  return (
    <div
      style={{
        background: "#0D1B3E", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)",
        padding: "10px 12px", marginBottom: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
        <span style={{ fontSize: "13px", fontWeight: 500, color: "#F1F5F9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </span>
        {probate && (
          <span
            title="Probate tag present"
            style={{
              display: "inline-flex", alignItems: "center", gap: "3px",
              fontSize: "9px", fontWeight: 600, padding: "2px 6px", borderRadius: "999px",
              background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.35)", color: "#A78BFA",
              textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            <Scroll size={9} /> Probate
          </span>
        )}
      </div>

      <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {contact.phone || contact.email || "—"}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ display: "flex", gap: "6px" }}>
          <ScoreBadge label="Comb" score={contact.combinedScore} />
          <ScoreBadge label="Mot"  score={contact.motivationScore} />
          <ScoreBadge label="Deal" score={contact.dealScore} />
        </div>
        <CompletenessBadge score={contact.completenessScore} />
      </div>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div style={{ background: "#0D1B3E", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", padding: "10px 12px", marginBottom: "8px" }}>
      <div style={{ height: "13px", width: "110px", borderRadius: "4px", background: "#1B2433", animation: "pulse 1.5s ease-in-out infinite", marginBottom: "8px" }} />
      <div style={{ height: "11px", width: "80px", borderRadius: "4px", background: "#1B2433", animation: "pulse 1.5s ease-in-out infinite", marginBottom: "10px" }} />
      <div style={{ display: "flex", gap: "6px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: "24px", width: "40px", borderRadius: "6px", background: "#1B2433", animation: "pulse 1.5s ease-in-out infinite" }} />
        ))}
      </div>
    </div>
  );
}

// ── Tier column ────────────────────────────────────────────────────────────────

function TierColumn({
  tier, contacts, total, loading,
}: {
  tier: BucketTag;
  contacts: ContactRow[];
  total: number;
  loading: boolean;
}) {
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  const filtered = contacts.length !== total;

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px",
          background: "#07142E", border: `1px solid ${meta.color}33`, borderRadius: "8px 8px 0 0",
          borderBottom: "none",
        }}
      >
        <Icon size={15} style={{ color: meta.color }} />
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif" }}>
          {meta.label}
        </span>
        <span style={{
          marginLeft: "auto", fontSize: "12px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px",
          background: `${meta.color}1A`, color: meta.color,
        }}>
          {loading ? "…" : filtered ? `${contacts.length} of ${total}` : total}
        </span>
      </div>

      <div
        style={{
          flex: 1, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "0 0 8px 8px", padding: "10px", minHeight: "200px",
        }}
      >
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : contacts.length === 0 ? (
          <p style={{ color: "#334155", fontSize: "12px", textAlign: "center", padding: "24px 8px" }}>
            No contacts
          </p>
        ) : (
          contacts.map((c) => <ContactCard key={c.id} contact={c} />)
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Segmentation() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [sortKey,  setSortKey]  = useState<SortKey>("combinedScore");
  const [sortDir,  setSortDir]  = useState<SortDir>("desc");
  const [probateOnly, setProbateOnly] = useState(false);

  useEffect(() => {
    ghl.contacts.listAll()
      .then(setContacts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortContacts(rows: ContactRow[]): ContactRow[] {
    return [...rows].sort((a, b) => {
      const aVal = a[sortKey] ?? -1;
      const bVal = b[sortKey] ?? -1;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  // Bucket assignment is read directly from the GHL tag written by the scoring
  // function — this view never computes or reassigns tiers itself.
  const byTier = useMemo(() => {
    const groups: Record<BucketTag, ContactRow[]> = { hot: [], warm: [], low: [] };
    for (const c of contacts) groups[getBucketTag(c)].push(c);
    return groups;
  }, [contacts]);

  const probateCount = useMemo(() => contacts.filter(isProbate).length, [contacts]);

  const visibleByTier = useMemo(() => {
    const result: Record<BucketTag, ContactRow[]> = { hot: [], warm: [], low: [] };
    (Object.keys(byTier) as BucketTag[]).forEach((tier) => {
      const rows = probateOnly ? byTier[tier].filter(isProbate) : byTier[tier];
      result[tier] = sortContacts(rows);
    });
    return result;
  }, [byTier, probateOnly, sortKey, sortDir]);

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "12px" }}>
        <AlertCircle size={32} style={{ color: "#EF4444" }} />
        <p style={{ color: "#F87171", fontWeight: 500 }}>Failed to load segmentation data</p>
        <p style={{ color: "#64748B", fontSize: "13px", maxWidth: "400px", textAlign: "center" }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: 0 }}>
            Segmentation
          </h1>
          {!loading && (
            <span style={{
              fontSize: "12px", fontWeight: 500, padding: "2px 8px", borderRadius: "999px",
              background: "#1B2433", color: "#64748B",
            }}>
              {contacts.length.toLocaleString()} total
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Sort control */}
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => handleSort(key)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  fontSize: "11px", fontWeight: 600, letterSpacing: "0.03em",
                  padding: "5px 9px", borderRadius: "6px", border: "1px solid transparent",
                  background: sortKey === key ? "rgba(30,200,255,0.1)" : "transparent",
                  color: sortKey === key ? "#1EC8FF" : "#64748B",
                  cursor: "pointer",
                }}
              >
                {SORT_LABEL[key]}
                <SortIcon active={sortKey === key} dir={sortDir} />
              </button>
            ))}
          </div>

          {/* Probate toggle */}
          <label
            onClick={() => setProbateOnly((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: "7px", cursor: "pointer", userSelect: "none" }}
          >
            <span style={{ fontSize: "11px", fontWeight: 500, color: probateOnly ? "#A78BFA" : "#64748B" }}>
              Probate only {!loading && `(${probateCount})`}
            </span>
            <span
              style={{
                position: "relative", width: "34px", height: "18px", borderRadius: "999px",
                background: probateOnly ? "#8B5CF6" : "#1B2433",
                border: "1px solid rgba(255,255,255,0.1)", transition: "background 0.15s",
              }}
            >
              <span style={{
                position: "absolute", top: "1px", left: probateOnly ? "17px" : "1px",
                width: "14px", height: "14px", borderRadius: "50%", background: "#F1F5F9",
                transition: "left 0.15s",
              }} />
            </span>
          </label>
        </div>
      </div>

      <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 18px" }}>
        Read-only view of GHL bucket tags. Tiers are assigned by the scoring function; this page never sends, enrolls, or re-tags.
      </p>

      {/* Three-tier board */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }}>
        {(Object.keys(TIER_META) as BucketTag[]).map((tier) => (
          <TierColumn
            key={tier}
            tier={tier}
            contacts={visibleByTier[tier]}
            total={byTier[tier].length}
            loading={loading}
          />
        ))}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
