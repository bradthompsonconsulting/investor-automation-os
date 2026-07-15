import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, Clock, FileCheck, Mail as MailIcon, Inbox, CalendarClock,
  ChevronDown, Flame, Sun, Snowflake, PhoneCall, StickyNote, ExternalLink, PartyPopper,
} from "lucide-react";
import {
  ghl, getBucketTag, ghlContactDetailUrl,
  type ContactRow, type MailerDigest, type PipelineData, type BucketTag,
  type UnansweredInboundRow,
} from "../lib/ghl";
import { CallbackPopover } from "../components/CallbackPopover";
import { scheduleCallbackGated, formatCallbackTime } from "../lib/callbackWrite";

/**
 * Dashboard — Build 2A + 2B + Phase 3 per docs/DASHBOARD_SPEC_v2.txt.
 * Writes allowed, and ONLY these three:
 *   1. ghl.notes.create()               -> POST /contacts/{id}/notes
 *   2. ghl.contacts.setLastCallAttempt() -> PUT /contacts/{id} (last_call_attempt +
 *      last_call_attempt_precise, same single call — the latter is an exact-ISO TEXT
 *      companion field since GHL's DATE type truncates time-of-day; fires together
 *      with #1 the instant a note saves)
 *   3. ghl.contacts.setCallbackDatetime() -> PUT /contacts/{id} (callback_datetime +
 *      callback_datetime_precise, same single call — the latter is an exact-ISO TEXT
 *      companion field since GHL's DATE type truncates time-of-day; fires only from
 *      the schedule-callback popover — independent of #1/#2)
 * Everything else on this page is read-only. GHL's public API cannot trigger
 * an outbound call (only log one after the fact), so the Call button opens
 * the contact's GHL page in a new tab (window.open — no GHL API call at all)
 * where GHL's native dialer applies the Number's own softphone/forward
 * config. Opening that tab is independent of the attempt system: it never
 * sets last_call_attempt, so it never greys a row. (Grey keys off a fresh
 * last_call_attempt — written by the note→setLastCallAttempt pairing — not by
 * a note on its own; see DASHBOARD_SPEC_v2.txt §GREY-OUT MECHANISM.)
 * Scheduling a callback IS a disposition, so this handler runs the same gated
 * setCallbackDatetime → notes.create → setLastCallAttempt pairing the Workspace
 * uses (shared scheduleCallbackGated, ../lib/callbackWrite) — the fresh
 * last_call_attempt greys the row on BOTH surfaces (CONTACT_WORKSPACE_SPEC_v2.md
 * §6/§10). Clearing a callback is not a disposition: it writes only
 * setCallbackDatetime(null), no note, no attempt.
 * call_mode/call_forward_number custom values exist in GHL but are
 * intentionally unused here — GHL's own dialer reads its own Number config,
 * not our custom values, so there's nothing for this app to branch on.
 */

// ── Tunables (single source of truth, per spec) ───────────────────────────────

const RESURFACE_HOURS = 12;         // flat auto-reset window for a fresh attempt
const RESURFACE_VISIBLE_ROWS = 15;  // Lead Queue visible-row cap before scroll

// Presentation cap so Waiting on Me / Lead Queue stop short of the far edge
// of a wide monitor instead of stretching full-width. NOT applied to
// Pipeline Health, which needs more room to stay on one row (see below).
const CONTENT_MAX_WIDTH = "1600px";

// ── Central-time date helpers, same convention as mailer-shared.ts ───────────

const CT_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
});
function ctDateString(d: Date): string {
  return CT_DATE_FMT.format(d);
}
function todayCT(): string {
  return ctDateString(new Date());
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
  const cityStateZip = [c.city, [c.state, c.postalCode].filter(Boolean).join(", ")]
    .filter(Boolean).join(", ");
  return [c.address1, cityStateZip].filter(Boolean).join(", ") || "—";
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// formatCallbackTime is the shared formatter, imported from ../lib/callbackWrite.

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

function SectionHeading({
  children, count, href,
}: {
  children: React.ReactNode;
  count?: number;
  href?: string;
}) {
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
      {href && (
        <Link to={href} style={{ display: "inline-flex", alignItems: "center" }} title={`Open ${href}`}>
          <ExternalLink size={13} style={{ color: "#475569" }} />
        </Link>
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
        <Icon size={14} style={{ color: "#1EC8FF" }} />
        {href ? (
          <ExternalLink size={11} style={{ color: "#475569" }} />
        ) : onClick ? (
          <ChevronDown size={12} style={{ color: "#475569", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        ) : null}
      </div>
      <div style={{ fontSize: "19px", fontWeight: 700, color: "#F1F5F9", fontFamily: "Space Grotesk, sans-serif", margin: "5px 0 1px" }}>
        {loading ? "…" : count}
      </div>
      <div style={{ fontSize: "11px", color: "#64748B" }}>{label}</div>
    </>
  );

  // Compact card, not a full-width block — fixed intrinsic width so it sits
  // side-by-side with the others instead of stretching to fill the row.
  const style: React.CSSProperties = {
    background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)",
    padding: "9px 11px", textAlign: "left", cursor: onClick || href ? "pointer" : "default",
    display: "block", width: "140px", flex: "0 0 auto",
  };

  if (href) return <Link to={href} style={style}>{body}</Link>;
  return <button onClick={onClick} style={style}>{body}</button>;
}

// Closed-sellers celebration shell. Hardcoded 0/0 on purpose — no live
// Closed-Won-by-date read wired yet (the existing Pipeline Health stage
// count is an all-time total, not month/YTD-scoped, so it can't be reused
// here without misrepresenting the number).
// TODO: wire to a live Closed-Won-by-date read once that data source exists.
function CongratsStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(34,197,94,0.25)",
      padding: "9px 11px", width: "140px", flex: "0 0 auto",
    }}>
      <div style={{ fontSize: "19px", fontWeight: 700, color: "#22C55E", fontFamily: "Space Grotesk, sans-serif", margin: "0 0 1px" }}>
        {value}
      </div>
      <div style={{ fontSize: "11px", color: "#64748B" }}>{label}</div>
    </div>
  );
}

// ── Lead Queue row shape ─────────────────────────────────────────────────────

type Band = 1 | 2 | 3;

interface LeadRow {
  contact: ContactRow;
  tier: BucketTag;
  overdueMailer: boolean;
  attempt: string | null; // effective last_call_attempt (override-merged)
  band: Band;
}

function getBand(attempt: string | null): Band {
  if (!attempt) return 2;
  const ageMs = Date.now() - new Date(attempt).getTime();
  return ageMs >= RESURFACE_HOURS * 3_600_000 ? 1 : 3;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [contacts, setContacts]     = useState<ContactRow[] | null>(null);
  const [digest, setDigest]         = useState<MailerDigest | null>(null);
  const [pipeline, setPipeline]     = useState<PipelineData | null>(null);
  const [unanswered, setUnanswered] = useState<UnansweredInboundRow[] | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [newSince, setNewSince]     = useState<number | null>(null);
  const [expanded, setExpanded]     = useState<"tasks" | "offers" | null>(null);

  // Lead Queue attempt/note state — see spec §5 "notes = attempt-of-record".
  const [draftNotes, setDraftNotes]         = useState<Record<string, string>>({});
  const [attemptOverride, setAttemptOverride] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds]           = useState<Set<string>>(new Set());
  const [saveError, setSaveError]           = useState<Record<string, string>>({});
  const [openContactId, setOpenContactId]   = useState<string | null>(null);
  const noteInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Prefer the in-session override (always exact, set right after a save),
  // then the exact TEXT companion field, and only fall back to the DATE
  // field (which GHL truncates to date-only) if the precise field is ever
  // missing — e.g. an attempt set before this fix shipped.
  function effectiveLastAttempt(c: ContactRow): string | null {
    if (c.id in attemptOverride) return attemptOverride[c.id];
    return c.lastCallAttemptPrecise ?? c.lastCallAttempt;
  }

  // Phase 3 — schedule-callback popover state. Only one popover open at a
  // time, keyed by contactId regardless of which section (Lead Queue or
  // Waiting on Me) triggered it.
  const [callbackOverride, setCallbackOverride] = useState<Record<string, string | null>>({});
  const [callbackPopoverId, setCallbackPopoverId] = useState<string | null>(null);
  const [callbackSaving, setCallbackSaving]     = useState(false);
  const [callbackError, setCallbackError]       = useState<string | null>(null);

  // Prefer the in-session override (always exact), then the exact TEXT
  // companion field, and only fall back to the DATE field (which GHL
  // truncates to date-only) if the precise field is ever missing — e.g. a
  // callback set before this fix shipped, or a manual edit in GHL's own UI.
  function effectiveCallback(c: ContactRow): string | null {
    if (c.id in callbackOverride) return callbackOverride[c.id];
    return c.callbackDatetimePrecise ?? c.callbackDatetime;
  }

  async function handleSaveCallback(contactId: string, iso: string | null) {
    setCallbackSaving(true);
    setCallbackError(null);

    // Clearing is not a disposition — just clear the field, no note, no attempt.
    if (iso === null) {
      try {
        await ghl.contacts.setCallbackDatetime(contactId, null);
        setCallbackOverride((prev) => ({ ...prev, [contactId]: null }));
        setCallbackPopoverId(null);
      } catch (e) {
        setCallbackError((e as Error).message);
      } finally {
        setCallbackSaving(false);
      }
      return;
    }

    // Scheduling IS a disposition (§10): gated callback → note → attempt via the
    // shared helper, so the fresh last_call_attempt greys this row just like the
    // Workspace. Still exactly the three sanctioned writes.
    const result = await scheduleCallbackGated(ghl, contactId, iso);
    setCallbackSaving(false);

    if (result.ok) {
      setCallbackOverride((prev) => ({ ...prev, [contactId]: iso }));
      setAttemptOverride((prev) => ({ ...prev, [contactId]: result.attemptIso }));
      setCallbackPopoverId(null);
      return;
    }

    // Failure mapping mirrors the Workspace stage-for-stage (shared helper, one
    // behavior). A persisted callback (note/attempt stage) still shows as
    // scheduled; a callback-stage failure never wrote it. The popover stays open
    // only where a retry is clean (callback stage: nothing saved; note stage:
    // retry re-writes the same callback iso) and CLOSES on attempt-stage failure
    // — callback+note are already saved, so a retry would duplicate the note.
    if (result.callbackPersisted) {
      setCallbackOverride((prev) => ({ ...prev, [contactId]: iso }));
    }
    setCallbackError(result.error);
    if (result.stage === "attempt") setCallbackPopoverId(null);
  }

  // Periodic re-render only — lets the 12h auto-reset move a row out of BAND 3
  // without requiring a reload while the page is left open.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (openContactId) noteInputRefs.current[openContactId]?.focus();
  }, [openContactId]);

  useEffect(() => {
    Promise.all([
      ghl.contacts.listAll(),
      ghl.mailers.list(),
      ghl.opportunities.listPipeline(),
      ghl.conversations.unansweredInbound(),
    ])
      .then(([c, d, p, u]) => {
        setContacts(c);
        setDigest(d);
        setPipeline(p);
        setUnanswered(u);

        const prevVisit = localStorage.getItem(LAST_VISIT_KEY);
        setNewSince(prevVisit ? c.filter((row) => row.dateAdded && row.dateAdded > prevVisit).length : 0);
        localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loading = !contacts || !digest || !pipeline || !unanswered;
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

  // Waiting-on-me 3.3 — a clean read-only "sent, awaiting response" signal:
  // opportunity currently sitting in the Seller Offer Sent stage (the exact
  // stage Seller 7 fires from) AND the contact carries offer-made.
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

  // Waiting-on-me 3.2 — callbacks. Overdue = scheduled before today's CT
  // calendar date; Today = scheduled on today's CT date. Future-dated
  // callbacks aren't due yet, so they're excluded from both lists. Scheduling
  // (Phase 3) writes callback_datetime via the popover below.
  const callbacks = useMemo(() => {
    const withCb = (contacts ?? [])
      .map((c) => ({ contact: c, cb: effectiveCallback(c) }))
      .filter((x): x is { contact: ContactRow; cb: string } => !!x.cb);
    const byTime = (a: typeof withCb[number], b: typeof withCb[number]) =>
      new Date(a.cb).getTime() - new Date(b.cb).getTime();
    const overdue = withCb.filter((x) => ctDateString(new Date(x.cb)) < today).sort(byTime);
    const dueToday = withCb.filter((x) => ctDateString(new Date(x.cb)) === today).sort(byTime);
    return { overdue, dueToday };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, today, callbackOverride]);

  // Escalation out (§3 / §4 "Escalation out") — anyone with a live unanswered
  // inbound signal leaves the Lead Queue entirely; they already surface under
  // Waiting on Me §3.1. Seller-form/appointment signals join this set as those
  // reads come online.
  const escalatedContactIds = useMemo(
    () => new Set((unanswered ?? []).map((r) => r.contactId)),
    [unanswered],
  );

  // Lead Queue overdue-in-tier bubble: reuse the mailer digest's own "Overdue"
  // bucket as the "falling behind cadence" signal for BAND 2 ranking.
  const overdueContactIds = useMemo(
    () => new Set((digest?.overdue ?? []).flatMap((g) => g.rows.map((r) => r.contactId))),
    [digest],
  );

  const leadQueue = useMemo<LeadRow[]>(() => {
    void nowTick; // re-derive bands as clock advances past RESURFACE_HOURS
    const rows: LeadRow[] = (contacts ?? [])
      .filter((c) => c.phone?.trim() && !escalatedContactIds.has(c.id))
      .map((c) => {
        const attempt = effectiveLastAttempt(c);
        return {
          contact: c,
          tier: getBucketTag(c),
          overdueMailer: overdueContactIds.has(c.id),
          attempt,
          band: getBand(attempt),
        };
      });

    return rows.sort((a, b) => {
      if (a.band !== b.band) return a.band - b.band;
      if (a.band !== 2) {
        // BAND 1 (attempted, no response) and BAND 3 (freshly attempted):
        // oldest attempt first — in BAND 3 this also means "closest to un-greying" on top.
        return new Date(a.attempt!).getTime() - new Date(b.attempt!).getTime();
      }
      // BAND 2 — never-attempted: tier + score, mailer-cadence-overdue bubbles to tier top.
      const tierDiff = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
      if (tierDiff !== 0) return tierDiff;
      if (a.overdueMailer !== b.overdueMailer) return a.overdueMailer ? -1 : 1;
      return (b.contact.combinedScore ?? -1) - (a.contact.combinedScore ?? -1);
    });
  }, [contacts, escalatedContactIds, overdueContactIds, attemptOverride, nowTick]);

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

  // The note IS the attempt (spec §5). Empty/whitespace-only notes are not an
  // attempt and do nothing on blur. Note-save and attempt-marker are two
  // separate GHL calls — if the second fails, the note (already saved) is not
  // rolled back; the row just doesn't grey until the marker write succeeds.
  async function handleNoteBlur(contactId: string) {
    const text = (draftNotes[contactId] ?? "").trim();
    if (!text || savingIds.has(contactId)) return;

    setSavingIds((s) => new Set(s).add(contactId));
    setSaveError((prev) => { const next = { ...prev }; delete next[contactId]; return next; });

    try {
      await ghl.notes.create(contactId, text);
      setDraftNotes((prev) => ({ ...prev, [contactId]: "" }));

      const nowIso = new Date().toISOString();
      try {
        await ghl.contacts.setLastCallAttempt(contactId, nowIso);
        setAttemptOverride((prev) => ({ ...prev, [contactId]: nowIso }));
      } catch (e) {
        setSaveError((prev) => ({
          ...prev, [contactId]: `Note saved, but couldn't mark attempted: ${(e as Error).message}`,
        }));
      }
    } catch (e) {
      setSaveError((prev) => ({ ...prev, [contactId]: (e as Error).message }));
    } finally {
      setSavingIds((s) => { const next = new Set(s); next.delete(contactId); return next; });
    }
  }

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
        What needs your attention today. Only three writes happen anywhere on this page: saving a note, marking a
        call attempt the instant a note saves, and scheduling/clearing a callback. Nothing here sends, enrolls,
        re-tags, or moves a stage.
      </p>

      {/* Pipeline Health strip — moved to the very top: glanceable status nobody would scroll for.
          Deliberately NOT capped by CONTENT_MAX_WIDTH — needs more room than the other sections to
          stay on one row. At normal-or-wider windows the full pill set (~1800px) fits with room to
          spare; on a narrowed window it wraps to a second line (no horizontal scrollbar anywhere). */}
      <div style={{ marginBottom: "28px" }}>
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

      {/* 1. To Do Items (left) + Congrats (right) */}
      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "20px" }}>
        <div>
          <SectionHeading>To Do Items</SectionHeading>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
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
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
            <PartyPopper size={15} style={{ color: "#22C55E" }} />
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>
              Sales
            </h2>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <CongratsStat label="This Month" value={0} />
            <CongratsStat label="YTD" value={0} />
          </div>
        </div>
      </div>

      {expanded === "tasks" && (
        <Card style={{ marginBottom: "20px" }}>
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
        <Card style={{ marginBottom: "20px" }}>
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

      {/* 3. Waiting on Me — anyone who has engaged, above the Lead Queue */}
      <SectionHeading>Waiting on Me</SectionHeading>
      <div style={{ marginBottom: "28px", maxWidth: CONTENT_MAX_WIDTH }}>
        {/* 3.1 Unanswered inbound — HIGHEST priority, top of the entire queue */}
        <SectionHeading count={unanswered?.length ?? 0}>Unanswered Inbound</SectionHeading>
        <p style={{ fontSize: "11px", color: "#334155", margin: "-4px 0 10px" }}>
          Oldest unanswered reply first — the seller ignored longest is closest to giving up.
        </p>
        {loading ? (
          <Card tone="muted" style={{ marginBottom: "10px" }}>
            <p style={{ fontSize: "12px", color: "#334155", margin: 0 }}>Loading…</p>
          </Card>
        ) : (unanswered?.length ?? 0) === 0 ? (
          <Card tone="muted" style={{ marginBottom: "10px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <Inbox size={16} style={{ color: "#475569", marginTop: "1px", flexShrink: 0 }} />
            <p style={{ fontSize: "12px", color: "#64748B", margin: 0 }}>No unanswered inbound replies right now.</p>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
            {unanswered!.map((r) => {
              const days = Math.floor((Date.now() - r.lastMessageDate) / 86_400_000);
              return (
                <Card key={r.conversationId} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px" }}>
                  <Inbox size={15} style={{ color: "#F59E0B", flexShrink: 0 }} />
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "#F1F5F9", minWidth: "150px" }}>
                    {r.contactName}
                  </span>
                  <span style={{ fontSize: "12px", color: "#64748B", whiteSpace: "nowrap" }}>
                    {r.phone || r.email || "—"}
                  </span>
                  <span style={{ fontSize: "12px", color: "#94A3B8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {r.preview || <em style={{ color: "#334155" }}>(no preview)</em>}
                  </span>
                  <span style={{
                    marginLeft: "auto", fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "999px",
                    background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", color: "#F59E0B",
                    whiteSpace: "nowrap",
                  }}>
                    waiting {days}d
                  </span>
                </Card>
              );
            })}
          </div>
        )}

        {/* 3.2 Callbacks — scheduling (writing callback_datetime) is Phase 3 */}
        <SectionHeading count={callbacks.overdue.length + callbacks.dueToday.length}>Callbacks</SectionHeading>
        {callbacks.overdue.length === 0 && callbacks.dueToday.length === 0 ? (
          <Card tone="muted" style={{ marginBottom: "10px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <CalendarClock size={16} style={{ color: "#475569", marginTop: "1px", flexShrink: 0 }} />
            <p style={{ fontSize: "12px", color: "#64748B", margin: 0 }}>No callbacks scheduled.</p>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
            {callbacks.overdue.map(({ contact: c, cb }) => (
              <Card key={c.id} tone="warn" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px" }}>
                <CalendarClock size={15} style={{ color: "#F87171", flexShrink: 0 }} />
                <span style={{ fontSize: "13px", fontWeight: 500, color: "#F1F5F9", minWidth: "150px" }}>{contactName(c)}</span>
                <span style={{ fontSize: "12px", color: "#64748B" }}>{c.phone || "—"}</span>
                <span style={{
                  fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "999px",
                  background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", color: "#F87171",
                }}>
                  Overdue — {formatCallbackTime(cb)}
                </span>
                <div style={{ position: "relative", marginLeft: "auto" }}>
                  <button
                    onClick={() => { setCallbackPopoverId((v) => (v === c.id ? null : c.id)); setCallbackError(null); }}
                    style={{
                      fontSize: "12px", fontWeight: 700, padding: "7px 12px", borderRadius: "7px",
                      border: "1px solid rgba(30,200,255,0.35)", background: "rgba(30,200,255,0.12)", color: "#1EC8FF", cursor: "pointer",
                    }}
                  >
                    Reschedule
                  </button>
                  {callbackPopoverId === c.id && (
                    <CallbackPopover
                      current={cb} saving={callbackSaving} error={callbackError}
                      onSave={(iso) => handleSaveCallback(c.id, iso)}
                      onClear={() => handleSaveCallback(c.id, null)}
                      onClose={() => setCallbackPopoverId(null)}
                    />
                  )}
                </div>
              </Card>
            ))}
            {callbacks.dueToday.map(({ contact: c, cb }) => (
              <Card key={c.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px" }}>
                <CalendarClock size={15} style={{ color: "#1EC8FF", flexShrink: 0 }} />
                <span style={{ fontSize: "13px", fontWeight: 500, color: "#F1F5F9", minWidth: "150px" }}>{contactName(c)}</span>
                <span style={{ fontSize: "12px", color: "#64748B" }}>{c.phone || "—"}</span>
                <span style={{
                  fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "999px",
                  background: "rgba(30,200,255,0.12)", border: "1px solid rgba(30,200,255,0.35)", color: "#1EC8FF",
                }}>
                  Today — {formatCallbackTime(cb)}
                </span>
                <div style={{ position: "relative", marginLeft: "auto" }}>
                  <button
                    onClick={() => { setCallbackPopoverId((v) => (v === c.id ? null : c.id)); setCallbackError(null); }}
                    style={{
                      fontSize: "12px", fontWeight: 700, padding: "7px 12px", borderRadius: "7px",
                      border: "1px solid rgba(30,200,255,0.35)", background: "rgba(30,200,255,0.12)", color: "#1EC8FF", cursor: "pointer",
                    }}
                  >
                    Reschedule
                  </button>
                  {callbackPopoverId === c.id && (
                    <CallbackPopover
                      current={cb} saving={callbackSaving} error={callbackError}
                      onSave={(iso) => handleSaveCallback(c.id, iso)}
                      onClear={() => handleSaveCallback(c.id, null)}
                      onClose={() => setCallbackPopoverId(null)}
                    />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* 3.3 Offers awaiting seller response — read signal, implemented */}
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

      {/* 4. Lead Queue (renamed from Call Queue) — cold outreach, the long list at the bottom */}
      <SectionHeading count={leadQueue.length} href="/contacts">Lead Queue</SectionHeading>
      <p style={{ fontSize: "11px", color: "#334155", margin: "0 0 12px", maxWidth: CONTENT_MAX_WIDTH }}>
        Attempted-but-no-response (oldest attempt first) → never-attempted (tier + score, mailer-overdue bubbles to
        tier top) → freshly-attempted (greyed, bottom). A note is the only thing that marks an attempt — Call opens
        GHL to dial and the callback icon schedules a follow-up, but neither one greys a row on its own. Anyone who's
        engaged (e.g. an unanswered inbound reply) moves to Waiting on Me and drops out of this list. Showing{" "}
        {Math.min(RESURFACE_VISIBLE_ROWS, leadQueue.length)} of {leadQueue.length} — scroll for the rest.
      </p>
      <div style={{ background: "#0D1B3E", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", maxWidth: CONTENT_MAX_WIDTH }}>
        <div style={{ overflow: "auto", maxHeight: `${RESURFACE_VISIBLE_ROWS * 44}px` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "14%" }} /> {/* Name — full names */}
              <col style={{ width: "10%" }} /> {/* Phone — full "+1XXXXXXXXXX" */}
              <col style={{ width: "8%" }} />  {/* Tier — full badge text (e.g. "Warm") */}
              <col style={{ width: "5%" }} />  {/* Score */}
              <col style={{ width: "23%" }} /> {/* Address — full one-line street address */}
              <col style={{ width: "13%" }} /> {/* Last Contact — full "Attempted Xh ago" */}
              <col style={{ width: "10%" }} /> {/* Call/callback actions */}
              <col style={{ width: "17%" }} /> {/* Notes — comfortably typeable */}
            </colgroup>
            <thead>
              <tr style={{ background: "#07142E", position: "sticky", top: 0, zIndex: 1 }}>
                {["Name", "Phone", "Tier", "Score", "Address", "Last Contact", "", "Notes"].map((h) => (
                  <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: "20px 16px", textAlign: "center", color: "#334155", fontSize: "13px" }}>Loading…</td></tr>
              ) : leadQueue.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "20px 16px", textAlign: "center", color: "#334155", fontSize: "13px" }}>No contacts with a phone number.</td></tr>
              ) : (
                leadQueue.map(({ contact: c, tier, overdueMailer, attempt, band }) => {
                  const greyed = band === 3;
                  const isOpen = openContactId === c.id;
                  const err = saveError[c.id];
                  const cb = effectiveCallback(c);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setOpenContactId(c.id)}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer",
                        opacity: greyed ? 0.55 : 1,
                        background: isOpen ? "rgba(30,200,255,0.05)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "9px 10px", fontWeight: 500, color: "#F1F5F9", overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", overflow: "hidden" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {contactName(c)}
                          </span>
                          {overdueMailer && (
                            <span style={{ flexShrink: 0, fontSize: "10px", fontWeight: 600, color: "#F87171" }} title="Overdue in the mailer cadence">
                              OVERDUE
                            </span>
                          )}
                          {cb && (
                            <span style={{ flexShrink: 0, fontSize: "10px", fontWeight: 600, color: "#1EC8FF" }} title={`Callback scheduled: ${formatCallbackTime(cb)}`}>
                              CALLBACK
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "9px 10px", color: "#94A3B8", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.phone || "—"}</td>
                      <td style={{ padding: "9px 10px", overflow: "hidden" }}><TierBadge tier={tier} /></td>
                      <td style={{ padding: "9px 10px", overflow: "hidden" }}><ScoreChip score={c.combinedScore} /></td>
                      <td style={{ padding: "9px 10px", color: "#94A3B8", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatAddress(c)}</td>
                      <td style={{ padding: "9px 10px", color: attempt ? (greyed ? "#475569" : "#F59E0B") : "#334155", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {attempt ? `Attempted ${relativeTime(attempt)}` : "Not yet contacted"}
                      </td>
                      <td style={{ padding: "9px 8px", overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(ghlContactDetailUrl(c.id), "_blank", "noopener,noreferrer");
                            }}
                            title="Open in GHL to call — uses the verified 972-954-8586 number"
                            style={{
                              display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600,
                              padding: "5px 9px", borderRadius: "7px", border: "1px solid rgba(30,200,255,0.25)",
                              background: "rgba(30,200,255,0.06)", color: "#1EC8FF", cursor: "pointer",
                            }}
                          >
                            <PhoneCall size={12} /> Call
                          </button>
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setCallbackPopoverId((v) => (v === c.id ? null : c.id));
                                setCallbackError(null);
                              }}
                              title={cb ? `Callback scheduled: ${formatCallbackTime(cb)} — click to reschedule` : "Schedule a callback"}
                              style={{
                                display: "inline-flex", alignItems: "center", padding: "6px 9px", borderRadius: "7px",
                                border: "1px solid rgba(30,200,255,0.35)",
                                background: cb ? "rgba(30,200,255,0.18)" : "rgba(30,200,255,0.08)",
                                color: "#1EC8FF", cursor: "pointer",
                              }}
                            >
                              <CalendarClock size={15} />
                            </button>
                            {callbackPopoverId === c.id && (
                              <CallbackPopover
                                current={cb} saving={callbackSaving} error={callbackError}
                                onSave={(iso) => handleSaveCallback(c.id, iso)}
                                onClear={() => handleSaveCallback(c.id, null)}
                                onClose={() => setCallbackPopoverId(null)}
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "9px 8px", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                          <StickyNote size={12} style={{ color: "#475569", flexShrink: 0 }} />
                          <input
                            ref={(el) => { noteInputRefs.current[c.id] = el; }}
                            value={draftNotes[c.id] ?? ""}
                            disabled={savingIds.has(c.id)}
                            onChange={(e) => setDraftNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            onFocus={() => setOpenContactId(c.id)}
                            onBlur={() => handleNoteBlur(c.id)}
                            placeholder={savingIds.has(c.id) ? "Saving…" : "Note (any text = attempted)…"}
                            style={{
                              width: "100%", fontSize: "11px", padding: "5px 8px", borderRadius: "6px",
                              border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)",
                              color: "#F1F5F9",
                            }}
                          />
                        </div>
                        {err && <div style={{ fontSize: "10px", color: "#F87171", marginTop: "3px" }}>{err}</div>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
