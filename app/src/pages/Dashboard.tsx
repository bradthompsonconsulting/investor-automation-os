import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, Clock, FileCheck, Mail as MailIcon, ShieldAlert, CalendarClock,
  ChevronDown, Flame, Sun, Snowflake, PhoneCall, StickyNote, ExternalLink,
} from "lucide-react";
import {
  ghl, getBucketTag,
  type ContactRow, type MailerDigest, type PipelineData, type BucketTag,
} from "../lib/ghl";

/**
 * Dashboard — Phase 1 (read-only shell) per docs/DASHBOARD_SPEC_v1.txt.
 * Zero writes: this page only calls ghl.contacts.listAll(), ghl.mailers.list(),
 * and ghl.opportunities.listPipeline() — all existing GET-only reads. No MAO
 * calculator link or offer math is surfaced anywhere (spec guardrail).
 *
 * Notes/callback-scheduling/click-to-call are Phase 2-4 — every control for
 * them here is disabled/placeholder, wired for layout only.
 */

// ── Central-time "today", same convention as mailer-shared.ts ────────────────

const CT_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
});
function todayCT(): string {
  return CT_DATE_FMT.format(new Date());
}

// Browser-local only — never sent to GHL. Marks "since I was last on this
// page" for the New-since-login badge (§1). Phase A has no server-side auth
// session to read a real last-login from, so this is the honest proxy.
const LAST_VISIT_KEY = "iaos_dashboard_last_visit";

// ── Shared bits ────────────────────────────────────────────────────────────

const TIER_ORDER: BucketTag[] = ["hot", "warm", "low"];
const TIER_COLOR: Record<BucketTag, string> = { hot: "#EF4444", warm: "#F59E0B", low: "#64748B" };
const TIER_ICON: Record<BucketTag, typeof Flame> = { hot: Flame, warm: Sun, low: Snowflake };

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

function contactName(c: ContactRow): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

function formatAddress(c: ContactRow): string {
  const cityStateZip = [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  return [c.address1, cityStateZip].filter(Boolean).join(", ") || "—";
}

function TierBadge({ tier }: { tier: BucketTag }) {
  const color = TIER_COLOR[tier];
  const Icon = TIER_ICON[tier];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600,
      padding: "3px 8px", borderRadius: "999px", whiteSpace: "nowrap",
      background: `${color}1A`, border: `1px solid ${color}44`, color,
    }}>
      <Icon size={11} /> {tier[0].toUpperCase()}{tier.slice(1)}
    </span>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  let color = "#475569";
  if (score !== null) {
    if (score > 0 && score < 25)   color = "#EF4444";
    if (score >= 25 && score < 50) color = "#F59E0B";
    if (score >= 50 && score < 75) color = "#22C55E";
    if (score >= 75)               color = "#1EC8FF";
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: "32px", padding: "2px 6px", borderRadius: "6px",
      background: score === null ? "transparent" : `${color}1A`,
      border: `1px solid ${score === null ? "#334155" : `${color}44`}`,
      color: score === null ? "#475569" : color,
      fontSize: "12px", fontWeight: 600, fontFamily: "Space Grotesk, monospace",
    }}>
      {score ?? "—"}
    </span>
  );
}

function Card({ children, tone, style }: { children: React.ReactNode; tone?: "warn" | "muted"; style?: React.CSSProperties }) {
  const border = tone === "warn" ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)";
  return (
    <div style={{
      background: "#0D1B3E", borderRadius: "10px", border: `1px solid ${border}`,
      padding: "14px 16px", ...style,
    }}>
      {children}
    </div>
  );
}

function SectionHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>
        {children}
      </h2>
      {count !== undefined && (
        <span style={{ fontSize: "11px", fontWeight: 500, padding: "1px 7px", borderRadius: "999px", background: "#1B2433", color: "#64748B" }}>
          {count}
        </span>
      )}
    </div>
  );
}

// ── Action tiles ───────────────────────────────────────────────────────────

function Tile({
  icon: Icon, label, count, loading, expanded, onClick, href,
}: {
  icon: typeof Clock;
  label: string;
  count: number;
  loading: boolean;
  expanded?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Icon size={16} style={{ color: "#1EC8FF" }} />
        {href ? (
          <ExternalLink size={13} style={{ color: "#475569" }} />
        ) : onClick ? (
          <ChevronDown size={14} style={{ color: "#475569", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        ) : null}
      </div>
      <div style={{ fontSize: "26px", fontWeight: 700, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: "8px 0 2px" }}>
        {loading ? "…" : count}
      </div>
      <div style={{ fontSize: "12px", color: "#64748B" }}>{label}</div>
    </>
  );

  const style: React.CSSProperties = {
    background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)",
    padding: "14px 16px", textAlign: "left", cursor: onClick || href ? "pointer" : "default",
    display: "block", width: "100%",
  };

  if (href) return <Link to={href} style={style}>{body}</Link>;
  return <button onClick={onClick} style={style}>{body}</button>;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [contacts, setContacts]   = useState<ContactRow[] | null>(null);
  const [digest, setDigest]       = useState<MailerDigest | null>(null);
  const [pipeline, setPipeline]   = useState<PipelineData | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [newSince, setNewSince]   = useState<number | null>(null);
  const [expanded, setExpanded]   = useState<"tasks" | "offers" | null>(null);

  useEffect(() => {
    Promise.all([ghl.contacts.listAll(), ghl.mailers.list(), ghl.opportunities.listPipeline()])
      .then(([c, d, p]) => {
        setContacts(c);
        setDigest(d);
        setPipeline(p);

        const prevVisit = localStorage.getItem(LAST_VISIT_KEY);
        setNewSince(prevVisit ? c.filter((row) => row.dateAdded && row.dateAdded > prevVisit).length : 0);
        localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loading = !contacts || !digest || !pipeline;
  const today = useMemo(() => todayCT(), []);

  // Tile 1 — Tasks due today: every mailer-cadence task (the only task type
  // this system generates, §14b) due today, across all four digest buckets.
  const tasksDueToday = useMemo(() => {
    if (!digest) return [];
    const all = [
      ...digest.thisWeekReady.flatMap((g) => g.rows),
      ...digest.thisWeekBusiness.flatMap((g) => g.rows),
      ...digest.overdue.flatMap((g) => g.rows),
      ...digest.noAddress,
    ];
    return all.filter((r) => r.dueDateCT === today);
  }, [digest, today]);

  // Tile 2 — Offers to review: offer_ fields saved (contact-side offer_price
  // present) but the contact hasn't been moved to Seller Offer Sent yet
  // (no offer-made tag, §14d). Count + names only — no offer values, no calc link.
  const offersToReview = useMemo(
    () => (contacts ?? []).filter((c) => c.offerPrice != null && !c.tags.includes("offer-made")),
    [contacts],
  );

  // Waiting-on-me 2.3 — a clean read-only "sent, awaiting response" signal:
  // opportunity currently sitting in the Seller Offer Sent stage (the exact
  // stage Seller 7 fires from) AND the contact carries offer-made. Resolves
  // the spec's OPEN ITEM #2 without inferring anything not already in GHL.
  const sellerOfferSentStageId = useMemo(
    () => pipeline?.stages.find((s) => s.name === "Seller Offer Sent")?.id ?? null,
    [pipeline],
  );
  const offersAwaiting = useMemo(() => {
    if (!pipeline || !contacts || !sellerOfferSentStageId) return [];
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return pipeline.opportunities
      .filter((o) => o.stageId === sellerOfferSentStageId)
      .map((o) => ({ opportunity: o, contact: byId.get(o.contactId) }))
      .filter((row): row is { opportunity: typeof row.opportunity; contact: ContactRow } =>
        !!row.contact?.tags.includes("offer-made"));
  }, [pipeline, contacts, sellerOfferSentStageId]);

  // Call queue overdue-bubble: reuse the mailer digest's own "Overdue" bucket
  // as the only real "falling behind" signal available this phase (no
  // callback/attempt tracking exists yet — that's Phase 2/3).
  const overdueContactIds = useMemo(
    () => new Set((digest?.overdue ?? []).flatMap((g) => g.rows.map((r) => r.contactId))),
    [digest],
  );

  const callQueue = useMemo(() => {
    return (contacts ?? [])
      .filter((c) => c.phone?.trim())
      .map((c) => ({ contact: c, tier: getBucketTag(c), overdue: overdueContactIds.has(c.id) }))
      .sort((a, b) => {
        const tierDiff = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
        if (tierDiff !== 0) return tierDiff;
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        return (b.contact.combinedScore ?? -1) - (a.contact.combinedScore ?? -1);
      });
  }, [contacts, overdueContactIds]);

  const bucketCounts = useMemo(() => {
    const counts: Record<BucketTag, number> = { hot: 0, warm: 0, low: 0 };
    (contacts ?? []).forEach((c) => counts[getBucketTag(c)]++);
    return counts;
  }, [contacts]);

  const stageCounts = useMemo(() => {
    if (!pipeline) return [];
    return [...pipeline.stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ stage: s, count: pipeline.opportunities.filter((o) => o.stageId === s.id).length }));
  }, [pipeline]);

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "12px" }}>
        <AlertCircle size={32} style={{ color: "#EF4444" }} />
        <p style={{ color: "#F87171", fontWeight: 500 }}>Failed to load dashboard</p>
        <p style={{ color: "#64748B", fontSize: "13px", maxWidth: "400px", textAlign: "center" }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: 0 }}>
          Dashboard
        </h1>
        {newSince !== null && newSince > 0 && (
          <span style={{
            fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "999px",
            background: "rgba(30,200,255,0.12)", border: "1px solid rgba(30,200,255,0.35)", color: "#1EC8FF",
          }}>
            +{newSince} new since last visit
          </span>
        )}
      </div>
      <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 18px" }}>
        Read-only. What needs your attention today — nothing here sends, enrolls, re-tags, or moves a stage.
      </p>

      {/* 1. Action tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "28px" }}>
        <Tile
          icon={Clock} label="Tasks due today" count={tasksDueToday.length} loading={loading}
          expanded={expanded === "tasks"} onClick={() => setExpanded((v) => (v === "tasks" ? null : "tasks"))}
        />
        <Tile
          icon={FileCheck} label="Offers to review" count={offersToReview.length} loading={loading}
          expanded={expanded === "offers"} onClick={() => setExpanded((v) => (v === "offers" ? null : "offers"))}
        />
        <Tile icon={MailIcon} label="Mailers ready this week" count={digest?.totals.ready ?? 0} loading={loading} href="/mailers" />
      </div>

      {expanded === "tasks" && (
        <Card style={{ marginTop: "-16px", marginBottom: "24px" }}>
          {tasksDueToday.length === 0 ? (
            <p style={{ fontSize: "12px", color: "#334155", margin: 0 }}>Nothing due today.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {tasksDueToday.map((r) => (
                <div key={r.taskId} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}>
                  <span style={{ color: "#F1F5F9", fontWeight: 500, minWidth: "140px" }}>{r.contactName || "Unknown"}</span>
                  <span style={{ color: "#64748B" }}>{r.address || "—"}</span>
                  <span style={{ marginLeft: "auto", color: "#475569" }}>{r.tier[0].toUpperCase()}{r.tier.slice(1)} · {r.mailerType} · Touch {r.touchNumber}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {expanded === "offers" && (
        <Card style={{ marginTop: "-16px", marginBottom: "24px" }}>
          {offersToReview.length === 0 ? (
            <p style={{ fontSize: "12px", color: "#334155", margin: 0 }}>No saved offers awaiting send.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {offersToReview.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}>
                  <span style={{ color: "#F1F5F9", fontWeight: 500, minWidth: "140px" }}>{contactName(c)}</span>
                  <span style={{ color: "#64748B" }}>{formatAddress(c)}</span>
                  <TierBadge tier={getBucketTag(c)} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 2. Waiting on me */}
      <SectionHeading>Waiting on Me</SectionHeading>
      <div style={{ marginBottom: "28px" }}>
        {/* 2.1 Unanswered inbound — blocked, not built */}
        <Card tone="warn" style={{ marginBottom: "10px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <ShieldAlert size={16} style={{ color: "#F59E0B", marginTop: "1px", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9" }}>Unanswered inbound — blocked</div>
            <div style={{ fontSize: "12px", color: "#64748B", marginTop: "2px" }}>
              The GHL private-integration token isn't authorized for Conversations (confirmed live: GET /conversations/search
              returned 401 "not authorized for this scope" this session). Reading unanswered inbound replies needs that
              scope granted on GHL's side first — this sub-section can't populate without it, so it's left empty rather
              than guessed. Highest-priority item once the scope is added.
            </div>
          </div>
        </Card>

        {/* 2.2 Callbacks — field doesn't exist yet, wired for layout only */}
        <Card tone="muted" style={{ marginBottom: "10px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <CalendarClock size={16} style={{ color: "#475569", marginTop: "1px", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#F1F5F9" }}>Callbacks</div>
            <div style={{ fontSize: "12px", color: "#64748B", marginTop: "2px" }}>
              No callback_datetime field exists in GHL yet — this group is empty by construction, not a bug. Populates
              once that field and the Phase 3 scheduling control are built.
            </div>
          </div>
        </Card>

        {/* 2.3 Offers awaiting seller response — real read signal, implemented */}
        <SectionHeading count={offersAwaiting.length}>Offers Awaiting Response</SectionHeading>
        {offersAwaiting.length === 0 ? (
          <Card tone="muted">
            <p style={{ fontSize: "12px", color: "#334155", margin: 0 }}>No offers currently sitting in Seller Offer Sent.</p>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {offersAwaiting.map(({ opportunity, contact }) => (
              <Card key={opportunity.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px" }}>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "#F1F5F9", minWidth: "160px" }}>{contactName(contact)}</span>
                <span style={{ fontSize: "12px", color: "#64748B" }}>{formatAddress(contact)}</span>
                <span style={{
                  marginLeft: "auto", fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "999px",
                  background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.35)", color: "#A78BFA",
                }}>
                  Offer Sent — awaiting response
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 3. Call queue */}
      <SectionHeading count={callQueue.length}>Call Queue</SectionHeading>
      <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 12px" }}>
        Tier + score order (Hot → Warm → Low, score desc within tier); a mailer-cadence-overdue contact bubbles to the
        top of its tier. Bucket-agnostic — Low contacts with a phone are included. Calling and notes are Phase 4/2 — the
        controls below are placeholders only.
      </p>
      <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead>
              <tr style={{ background: "#07142E", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {["Name", "Phone", "Tier", "Score", "Address", "Last Contact", "", ""].map((h) => (
                  <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: "20px 16px", textAlign: "center", color: "#334155", fontSize: "13px" }}>Loading…</td></tr>
              ) : callQueue.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "20px 16px", textAlign: "center", color: "#334155", fontSize: "13px" }}>No contacts with a phone number.</td></tr>
              ) : (
                callQueue.map(({ contact: c, tier, overdue }) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "9px 16px", fontWeight: 500, color: "#F1F5F9", whiteSpace: "nowrap" }}>
                      {contactName(c)}
                      {overdue && (
                        <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 600, color: "#F87171" }} title="Overdue in the mailer cadence">
                          OVERDUE
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 16px", color: "#94A3B8", fontSize: "13px", whiteSpace: "nowrap" }}>{c.phone || "—"}</td>
                    <td style={{ padding: "9px 16px" }}><TierBadge tier={tier} /></td>
                    <td style={{ padding: "9px 16px" }}><ScoreChip score={c.combinedScore} /></td>
                    <td style={{ padding: "9px 16px", color: "#94A3B8", fontSize: "13px" }}>{formatAddress(c)}</td>
                    <td style={{ padding: "9px 16px", color: "#334155", fontSize: "12px", whiteSpace: "nowrap" }} title="No attempt-tracking yet — Phase 2">
                      Not yet contacted
                    </td>
                    <td style={{ padding: "9px 16px" }}>
                      <button disabled title="Click-to-call — Phase 4" style={{
                        display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600,
                        padding: "5px 9px", borderRadius: "7px", border: "1px solid rgba(255,255,255,0.08)",
                        background: "transparent", color: "#334155", cursor: "not-allowed",
                      }}>
                        <PhoneCall size={12} /> Call
                      </button>
                    </td>
                    <td style={{ padding: "9px 16px", minWidth: "160px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <StickyNote size={12} style={{ color: "#334155" }} />
                        <input disabled placeholder="Notes — Phase 2" style={{
                          width: "100%", fontSize: "11px", padding: "5px 8px", borderRadius: "6px",
                          border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)",
                          color: "#334155", cursor: "not-allowed",
                        }} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Pipeline health strip */}
      <div style={{ marginTop: "28px" }}>
        <SectionHeading>Pipeline Health</SectionHeading>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center",
          background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "10px 14px",
        }}>
          {(Object.keys(bucketCounts) as BucketTag[]).map((tier) => (
            <span key={tier} style={{
              display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600,
              padding: "4px 10px", borderRadius: "999px",
              background: `${TIER_COLOR[tier]}1A`, border: `1px solid ${TIER_COLOR[tier]}44`, color: TIER_COLOR[tier],
            }}>
              {tier[0].toUpperCase()}{tier.slice(1)} {loading ? "…" : bucketCounts[tier]}
            </span>
          ))}
          <span style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
          {stageCounts.map(({ stage, count }) => (
            <span key={stage.id} style={{
              display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 500,
              padding: "4px 10px", borderRadius: "999px",
              background: `${STAGE_COLOR[stage.name] ?? "#475569"}14`,
              border: `1px solid ${STAGE_COLOR[stage.name] ?? "#475569"}33`,
              color: STAGE_COLOR[stage.name] ?? "#94A3B8",
            }}>
              {stage.name} {count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
