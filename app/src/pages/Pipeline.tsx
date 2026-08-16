import { useEffect, useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, AlertCircle, GitBranch, Check, X } from "lucide-react";
import { ghl, type OpportunityRow, type PipelineStage } from "../lib/ghl";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "contactName" | "stage";
type SortDir = "asc" | "desc";

// Cosmetic only — has no bearing on how a stage move is written.
const STAGE_COLOR: Record<string, string> = {
  "New Lead - Seller":     "#475569",
  "Contact Initiated":     "#475569",
  "Seller Call Booked":    "#1EC8FF",
  "No Show":               "#F59E0B",
  "Seller Call Completed": "#1EC8FF",
  "Seller Follow-Up":      "#1EC8FF",
  "Seller Offer Sent":     "#8B5CF6",
  "Seller Closed-Won":     "#22C55E",
  "Long-Term Nurture":     "#A78BFA",
  "Lost / Not Interested": "#EF4444",
};

function StageBadge({ name }: { name: string }) {
  const color = STAGE_COLOR[name] ?? "#475569";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", fontSize: "12px", fontWeight: 600,
        padding: "3px 10px", borderRadius: "999px", whiteSpace: "nowrap",
        background: `${color}1A`, border: `1px solid ${color}44`, color,
      }}
    >
      {name}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />;
  return dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

// ── Move-to control (the one write action in the app) ─────────────────────────

function MoveToControl({
  opportunity, stages, pipelineId, onMoved,
}: {
  opportunity: OpportunityRow;
  stages: PipelineStage[];
  pipelineId: string;
  onMoved: (opportunityId: string, newStageId: string) => void;
}) {
  const [selected, setSelected]   = useState(opportunity.stageId);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const currentStageName  = stages.find((s) => s.id === opportunity.stageId)?.name ?? "Unknown";
  const selectedStageName = stages.find((s) => s.id === selected)?.name ?? "Unknown";
  const isChanged = selected !== opportunity.stageId;

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      await ghl.opportunities.updateStage(opportunity.id, pipelineId, selected);
      onMoved(opportunity.id, selected);
      setConfirming(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", color: "#F1F5F9" }}>
          Move <strong>{opportunity.contactName}</strong> to <strong>{selectedStageName}</strong>?
        </span>
        <button
          onClick={handleConfirm}
          disabled={saving}
          style={{
            display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600,
            padding: "4px 9px", borderRadius: "6px", border: "1px solid rgba(34,197,94,0.4)",
            background: "rgba(34,197,94,0.12)", color: "#22C55E", cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <Check size={12} /> {saving ? "Moving…" : "Confirm"}
        </button>
        <button
          onClick={() => { setConfirming(false); setSelected(opportunity.stageId); }}
          disabled={saving}
          style={{
            display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600,
            padding: "4px 9px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent", color: "#64748B", cursor: saving ? "default" : "pointer",
          }}
        >
          <X size={12} /> Cancel
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{
          fontSize: "12px", padding: "5px 8px", borderRadius: "6px",
          background: "#0A0E1A", color: "#F1F5F9", border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <button
        onClick={() => setConfirming(true)}
        disabled={!isChanged}
        style={{
          fontSize: "11px", fontWeight: 600, padding: "5px 10px", borderRadius: "6px",
          border: "1px solid rgba(30,200,255,0.35)",
          background: isChanged ? "rgba(30,200,255,0.12)" : "transparent",
          color: isChanged ? "#1EC8FF" : "#334155",
          cursor: isChanged ? "pointer" : "not-allowed",
        }}
      >
        Execute
      </button>
      {error && <span style={{ fontSize: "11px", color: "#F87171" }}>{error}</span>}
      {!error && !isChanged && (
        <span style={{ fontSize: "11px", color: "#334155" }}>currently {currentStageName}</span>
      )}
    </div>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      {[160, 160, 120, 220].map((w, i) => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <div style={{
            height: "14px", width: `${w}px`, borderRadius: "4px",
            background: "#1B2433", animation: "pulse 1.5s ease-in-out infinite",
          }} />
        </td>
      ))}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Pipeline() {
  const [pipelineId, setPipelineId]     = useState<string>("");
  const [stages, setStages]             = useState<PipelineStage[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [sortKey, setSortKey]           = useState<SortKey>("stage");
  const [sortDir, setSortDir]           = useState<SortDir>("asc");

  useEffect(() => {
    ghl.opportunities.listPipeline()
      .then((data) => {
        setPipelineId(data.pipelineId);
        setStages(data.stages);
        setOpportunities(data.opportunities);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stagePosition = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stages) map.set(s.id, s.position);
    return map;
  }, [stages]);

  const stageName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stages) map.set(s.id, s.name);
    return map;
  }, [stages]);

  const sorted = useMemo(() => {
    return [...opportunities].sort((a, b) => {
      let cmp: number;
      if (sortKey === "contactName") {
        cmp = a.contactName.toLowerCase().localeCompare(b.contactName.toLowerCase());
      } else {
        cmp = (stagePosition.get(a.stageId) ?? 0) - (stagePosition.get(b.stageId) ?? 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [opportunities, sortKey, sortDir, stagePosition]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function handleMoved(opportunityId: string, newStageId: string) {
    setOpportunities((rows) =>
      rows.map((r) => (r.id === opportunityId ? { ...r, stageId: newStageId } : r))
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "12px" }}>
        <AlertCircle size={32} style={{ color: "#EF4444" }} />
        <p style={{ color: "#F87171", fontWeight: 500 }}>Failed to load pipeline</p>
        <p style={{ color: "#64748B", fontSize: "13px", maxWidth: "400px", textAlign: "center" }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: 0 }}>
            Pipeline
          </h1>
          {!loading && (
            <span style={{
              fontSize: "12px", fontWeight: 500, padding: "2px 8px", borderRadius: "999px",
              background: "#1B2433", color: "#64748B",
            }}>
              {opportunities.length.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 18px" }}>
        Seller Leads Pipeline. "Move to" is the only write action in IAOS — it goes through GHL's
        standard opportunity-update API, so GHL's own stage triggers (e.g. Seller 7 on Offer Sent) fire normally.
      </p>

      {/* Table card */}
      <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th
                  onClick={() => handleSort("contactName")}
                  style={{
                    padding: "10px 16px", textAlign: "left", fontSize: "11px", fontWeight: 600,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    color: sortKey === "contactName" ? "#1EC8FF" : "#475569",
                    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", background: "#07142E",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    Contact <SortIcon active={sortKey === "contactName"} dir={sortDir} />
                  </span>
                </th>
                <th style={{
                  padding: "10px 16px", textAlign: "left", fontSize: "11px", fontWeight: 600,
                  letterSpacing: "0.06em", textTransform: "uppercase", color: "#475569",
                  whiteSpace: "nowrap", background: "#07142E",
                }}>
                  Property / Opportunity
                </th>
                <th
                  onClick={() => handleSort("stage")}
                  style={{
                    padding: "10px 16px", textAlign: "left", fontSize: "11px", fontWeight: 600,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    color: sortKey === "stage" ? "#1EC8FF" : "#475569",
                    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", background: "#07142E",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    Stage <SortIcon active={sortKey === "stage"} dir={sortDir} />
                  </span>
                </th>
                <th style={{
                  padding: "10px 16px", textAlign: "left", fontSize: "11px", fontWeight: 600,
                  letterSpacing: "0.06em", textTransform: "uppercase", color: "#475569",
                  whiteSpace: "nowrap", background: "#07142E",
                }}>
                  Move To
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "60px 16px", textAlign: "center" }}>
                    <GitBranch size={32} style={{ color: "#334155", margin: "0 auto 12px" }} />
                    <p style={{ color: "#475569", margin: 0 }}>No opportunities found</p>
                  </td>
                </tr>
              ) : (
                sorted.map((o) => (
                  <tr key={o.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "11px 16px", fontWeight: 500, color: "#F1F5F9" }}>
                      {o.contactName || <em style={{ color: "#475569" }}>Unknown</em>}
                    </td>
                    <td style={{ padding: "11px 16px", color: "#94A3B8", fontSize: "13px" }}>
                      {o.opportunityName || <span style={{ color: "#334155" }}>—</span>}
                    </td>
                    <td style={{ padding: "11px 16px" }}>
                      <StageBadge name={stageName.get(o.stageId) ?? "Unknown"} />
                    </td>
                    <td style={{ padding: "11px 16px" }}>
                      <MoveToControl
                        opportunity={o}
                        stages={stages}
                        pipelineId={pipelineId}
                        onMoved={handleMoved}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
