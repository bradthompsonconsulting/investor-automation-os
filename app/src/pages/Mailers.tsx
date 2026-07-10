import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Mail, CheckSquare, Square, MapPinOff, Loader2 } from "lucide-react";
import { ghl, type MailerDigest, type MailerGroup, type MailerTaskRow } from "../lib/ghl";

// ── Small pieces ─────────────────────────────────────────────────────────────

const TIER_COLOR: Record<string, string> = {
  hot:  "#EF4444",
  warm: "#F59E0B",
  low:  "#64748B",
};

function TierBadge({ tier, mailerType }: { tier: string; mailerType: string }) {
  const color = TIER_COLOR[tier] ?? "#475569";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", fontSize: "12px", fontWeight: 600,
        padding: "3px 10px", borderRadius: "999px", whiteSpace: "nowrap",
        background: `${color}1A`, border: `1px solid ${color}44`, color,
      }}
    >
      {tier[0].toUpperCase()}{tier.slice(1)} · {mailerType}
    </span>
  );
}

function SkeletonBlock() {
  return (
    <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", padding: "16px", marginBottom: "16px" }}>
      {[220, 260, 200].map((w, i) => (
        <div key={i} style={{
          height: "14px", width: `${w}px`, borderRadius: "4px", marginBottom: "10px",
          background: "#1B2433", animation: "pulse 1.5s ease-in-out infinite",
        }} />
      ))}
    </div>
  );
}

// ── Group table ──────────────────────────────────────────────────────────────

function GroupTable({
  group, checked, onToggleRow, onToggleGroup, tone,
}: {
  group: MailerGroup;
  checked: Set<string>;
  onToggleRow: (taskId: string) => void;
  onToggleGroup: (taskIds: string[], allChecked: boolean) => void;
  tone?: "overdue";
}) {
  const taskIds = group.rows.map((r) => r.taskId);
  const allChecked = taskIds.length > 0 && taskIds.every((id) => checked.has(id));

  return (
    <div style={{
      background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)",
      overflow: "hidden", marginBottom: "14px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px",
        background: "#07142E", borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <button
          onClick={() => onToggleGroup(taskIds, allChecked)}
          style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#1EC8FF" }}
          title={allChecked ? "Uncheck all in group" : "Check all in group"}
        >
          {allChecked ? <CheckSquare size={15} /> : <Square size={15} />}
        </button>
        <span style={{ fontSize: "13px", fontWeight: 600, color: tone === "overdue" ? "#F87171" : "#F1F5F9" }}>
          {group.label}
        </span>
        <span style={{ fontSize: "11px", fontWeight: 500, padding: "1px 7px", borderRadius: "999px", background: "#1B2433", color: "#64748B" }}>
          {group.rows.length}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.taskId} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "9px 16px", width: "28px" }}>
                  <button
                    onClick={() => onToggleRow(r.taskId)}
                    style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, color: checked.has(r.taskId) ? "#1EC8FF" : "#334155" }}
                  >
                    {checked.has(r.taskId) ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                </td>
                <td style={{ padding: "9px 16px", fontWeight: 500, color: "#F1F5F9", whiteSpace: "nowrap" }}>
                  {r.contactName || <em style={{ color: "#475569" }}>Unknown</em>}
                </td>
                <td style={{ padding: "9px 16px", color: "#94A3B8", fontSize: "13px" }}>
                  {r.address}
                </td>
                <td style={{ padding: "9px 16px" }}>
                  <TierBadge tier={r.tier} mailerType={r.mailerType} />
                </td>
                <td style={{ padding: "9px 16px", color: "#64748B", fontSize: "12px", whiteSpace: "nowrap" }}>
                  Touch {r.touchNumber}
                </td>
                <td style={{ padding: "9px 16px", color: tone === "overdue" ? "#F87171" : "#64748B", fontSize: "12px", whiteSpace: "nowrap" }}>
                  {r.dueDateCT}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({
  title, subtitle, groups, checked, onToggleRow, onToggleGroup, tone, emptyLabel,
}: {
  title: string;
  subtitle?: string;
  groups: MailerGroup[];
  checked: Set<string>;
  onToggleRow: (taskId: string) => void;
  onToggleGroup: (taskIds: string[], allChecked: boolean) => void;
  tone?: "overdue";
  emptyLabel: string;
}) {
  return (
    <div style={{ marginBottom: "28px" }}>
      <div style={{ marginBottom: "10px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: tone === "overdue" ? "#F87171" : "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>
          {title}
        </h2>
        {subtitle && <p style={{ fontSize: "11px", color: "#334155", margin: "2px 0 0" }}>{subtitle}</p>}
      </div>
      {groups.length === 0 ? (
        <div style={{
          background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)",
          padding: "20px 16px", color: "#334155", fontSize: "13px", textAlign: "center",
        }}>
          {emptyLabel}
        </div>
      ) : (
        groups.map((g) => (
          <GroupTable key={g.key} group={g} checked={checked} onToggleRow={onToggleRow} onToggleGroup={onToggleGroup} tone={tone} />
        ))
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Mailers() {
  const [digest, setDigest]   = useState<MailerDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    ghl.mailers.list()
      .then((d) => { setDigest(d); setChecked(new Set()); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // Flat lookup of every actionable row (ready + business + overdue) by taskId,
  // so completing a checked task can find its contactId.
  const rowByTaskId = useMemo(() => {
    const map = new Map<string, MailerTaskRow>();
    if (!digest) return map;
    for (const groups of [digest.thisWeekReady, digest.thisWeekBusiness, digest.overdue]) {
      for (const g of groups) for (const r of g.rows) map.set(r.taskId, r);
    }
    return map;
  }, [digest]);

  function toggleRow(taskId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  }

  function toggleGroup(taskIds: string[], allChecked: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of taskIds) (allChecked ? next.delete(id) : next.add(id));
      return next;
    });
  }

  async function handleMarkCompleted() {
    if (checked.size === 0) return;
    setCompleting(true);
    setCompleteError(null);
    const ids = [...checked];
    setProgress({ done: 0, total: ids.length });

    // Small concurrency cap — same rate-limit courtesy as the read side, not
    // one big Promise.all against GHL.
    const CONCURRENCY = 3;
    let next = 0;
    let done = 0;
    let firstError: string | null = null;

    async function worker() {
      while (next < ids.length) {
        const taskId = ids[next++];
        const row = rowByTaskId.get(taskId);
        if (!row) continue;
        try {
          await ghl.mailers.completeTask(row.contactId, row.taskId);
        } catch (e) {
          firstError = firstError ?? (e as Error).message;
        }
        done++;
        setProgress({ done, total: ids.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

    setCompleting(false);
    setProgress(null);
    if (firstError) setCompleteError(firstError);
    load(); // refetch so completed rows drop off
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "12px" }}>
        <AlertCircle size={32} style={{ color: "#EF4444" }} />
        <p style={{ color: "#F87171", fontWeight: 500 }}>Failed to load mailers</p>
        <p style={{ color: "#64748B", fontSize: "13px", maxWidth: "400px", textAlign: "center" }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: 0 }}>
            Mailers
          </h1>
          {digest && (
            <span style={{ fontSize: "12px", fontWeight: 500, padding: "2px 8px", borderRadius: "999px", background: "#1B2433", color: "#64748B" }}>
              week of {digest.weekStartCT} – {digest.weekEndCT}
            </span>
          )}
        </div>

        <button
          onClick={handleMarkCompleted}
          disabled={checked.size === 0 || completing}
          style={{
            display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600,
            padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(34,197,94,0.4)",
            background: checked.size > 0 && !completing ? "rgba(34,197,94,0.12)" : "transparent",
            color: checked.size > 0 && !completing ? "#22C55E" : "#334155",
            cursor: checked.size > 0 && !completing ? "pointer" : "not-allowed",
          }}
        >
          {completing ? <Loader2 size={13} className="animate-spin" /> : <CheckSquare size={13} />}
          {completing && progress ? `Completing… ${progress.done}/${progress.total}` : `Mark as Completed (${checked.size})`}
        </button>
      </div>

      <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 18px", maxWidth: "760px" }}>
        This is manual — checking a box here does not mean it's been mailed. Physically mail the pieces first,
        then check them off. "Mark as Completed" completes the underlying GHL task, keeping IAOS and GHL in sync.
      </p>

      {completeError && (
        <div style={{ marginBottom: "16px", padding: "10px 14px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#F87171", fontSize: "12px" }}>
          Some tasks failed to complete: {completeError}
        </div>
      )}

      {loading ? (
        <>
          <SkeletonBlock />
          <SkeletonBlock />
        </>
      ) : digest ? (
        <>
          <Section
            title="This Week — Ready to Mail"
            subtitle="Due this week, has an address, no business name."
            groups={digest.thisWeekReady}
            checked={checked}
            onToggleRow={toggleRow}
            onToggleGroup={toggleGroup}
            emptyLabel="Nothing due this week."
          />
          <Section
            title="This Week — Business-Flagged"
            subtitle="Same week, but the contact has a business name on file — send/skip is a judgment call."
            groups={digest.thisWeekBusiness}
            checked={checked}
            onToggleRow={toggleRow}
            onToggleGroup={toggleGroup}
            emptyLabel="No business-flagged contacts due this week."
          />
          <Section
            title="Overdue"
            subtitle="Due before this week's window and still incomplete in GHL."
            groups={digest.overdue}
            checked={checked}
            onToggleRow={toggleRow}
            onToggleGroup={toggleGroup}
            tone="overdue"
            emptyLabel="Nothing overdue."
          />

          {/* No-address — informational only, no checkboxes */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <MapPinOff size={15} style={{ color: "#475569" }} />
              <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>
                No Address
              </h2>
              <span style={{ fontSize: "11px", fontWeight: 500, padding: "1px 7px", borderRadius: "999px", background: "#1B2433", color: "#64748B" }}>
                {digest.noAddress.length}
              </span>
            </div>
            <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 10px" }}>
              Excluded from every list above — can't be mailed without an address. Needs skip-tracing.
            </p>
            {digest.noAddress.length === 0 ? (
              <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", padding: "20px 16px", color: "#334155", fontSize: "13px", textAlign: "center" }}>
                Everyone in a mail cadence has an address on file.
              </div>
            ) : (
              <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {digest.noAddress.map((r) => (
                      <tr key={r.taskId} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "9px 16px", fontWeight: 500, color: "#F1F5F9" }}>{r.contactName}</td>
                        <td style={{ padding: "9px 16px" }}><TierBadge tier={r.tier} mailerType={r.mailerType} /></td>
                        <td style={{ padding: "9px 16px", color: "#64748B", fontSize: "12px" }}>Touch {r.touchNumber}</td>
                        <td style={{ padding: "9px 16px", color: "#64748B", fontSize: "12px" }}>{r.dueDateCT}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "60px 16px", color: "#475569" }}>
          <Mail size={32} style={{ margin: "0 auto 12px" }} />
          <p>No mailer data</p>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
