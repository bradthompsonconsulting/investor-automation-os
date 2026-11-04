import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReadRecovered } from "../components/access-status";
import { Link } from "react-router-dom";
import { CalendarDays, Loader2, ExternalLink, Clock, RefreshCw } from "lucide-react";
import { ghl, ghlCalendarsUrl, type CalendarEventRow, type CalendarEventsResult } from "../lib/ghl";
import { calendarFailureKind, readTime, type CalendarFailureKind } from "../lib/calendar-read-state";

/**
 * Calendars — READ-ONLY agenda (CALENDARS_SPEC §3). Surfaces the appointments
 * GHL returns for the next N days across the location's calendars, grouped by day.
 * NO booking, NO availability logic, NO booker rebuild — GHL owns those (GHL-FIRST).
 * NO block-slot rendering: the API returns appointments only (spec §1 #1), so
 * there's nothing to mirror-filter. Zero writes — the page only reads.
 */

const WINDOW_DAYS = 30;

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit",
  });
}
/* B15-07 (INV-106) calendar reliability: the operator's next step for each failure. The access-denied headline is the
   accepted F47 wording (test-calendar-unavailable); the others are new and factual. */
const FAILURE_NEXT: Record<CalendarFailureKind, string> = {
  access_denied: "Your appointments are still in GHL — open Calendars in GHL to see them. Nothing was changed.",
  sign_in: "Your IAOS read sign-in ended. Sign in, and the calendar reloads. Your appointments are still in GHL. Nothing was changed.",
  unconfigured: "Your appointments are still in GHL — open Calendars in GHL to see them. Nothing was changed.",
  temporary: "Try again in a moment. Your appointments are still in GHL. Nothing was changed.",
};

/** The agenda, grouped by CT day: for a current read, and (labelled) for the last good read after a failed refresh. */
function AgendaList({ days }: { days: [string, CalendarEventRow[]][] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px", maxWidth: "820px" }}>
      {days.map(([day, evs]) => (
        <div key={day}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>{day}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {evs.map((ev) => (
              <div key={ev.id || `${ev.calendarId}-${ev.startTime}`}
                style={{ display: "flex", alignItems: "flex-start", gap: "14px", background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "11px 14px" }}>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "5px", fontSize: "13px", fontWeight: 600, color: "#1EC8FF", minWidth: "150px" }}>
                  <Clock size={13} /> {fmtTime(ev.startTime)} – {fmtTime(ev.endTime)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "#F1F5F9" }}>{ev.title || "Appointment"}</span>
                    {ev.status && (
                      <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", color: "#22C55E", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "999px", padding: "1px 7px" }}>{ev.status}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px", fontSize: "12px", color: "#64748B" }}>
                    <span>{ev.calendarName}</span>
                    {ev.contactId && (
                      <Link to={`/contacts/${ev.contactId}`} title="Open workspace" style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#1EC8FF", textDecoration: "none" }}>
                        <ExternalLink size={11} /> Workspace
                      </Link>
                    )}
                  </div>
                  {ev.notes && (
                    <div style={{ marginTop: "5px", fontSize: "12px", color: "#94A3B8", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{ev.notes}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Calendars() {
  // `data` is the LAST SUCCESSFUL read (never replaced by a failure); `error` is the latest read's failure, if any.
  const [data, setData]   = useState<CalendarEventsResult | null>(null);
  const [error, setError] = useState<{ detail: string; accessDenied: boolean; kind: CalendarFailureKind } | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loading, setLoading]   = useState(true);
  const readSeq = useRef(0);   // only the newest read may set state (a superseded read that settles late is ignored)

  // Explicit window (client clock) so the read is deterministic: today → +30 days.
  const load = useCallback(() => {
    const mine = ++readSeq.current;
    setLoading(true);
    const now = Date.now();
    ghl.calendars.events(now, now + WINDOW_DAYS * 86_400_000)
      .then((r) => { if (mine !== readSeq.current) return; setData(r); setLoadedAt(Date.now()); setError(null); setLoading(false); })
      .catch((e: Error & { code?: string | null }) => {
        if (mine !== readSeq.current) return;
        setError({ detail: e.message, accessDenied: e.code === "ghl_calendar_access_denied", kind: calendarFailureKind(e.code) });
        setLoading(false);
      });
  }, []);
  /* Board 15 cleanup: re-read (never remount) when read sign-in returns after a lapse. */
  const readRecovered = useReadRecovered();
  useEffect(() => {
    load();
  }, [readRecovered]);

  // Group by CT day, preserving the server's oldest→newest ordering.
  const days = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const ev of data?.events ?? []) {
      const k = fmtDay(ev.startTime);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(ev);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "16px", flexWrap: "wrap" }}>
        <CalendarDays size={20} style={{ color: "#1EC8FF" }} />
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Calendars</h1>
        <span style={{ fontSize: "11px", color: "#475569", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px", padding: "2px 8px" }}>Read-only · next {WINDOW_DAYS} days</span>
        {/* B15-07: freshness of what is on screen -- only for a current, successful read. */}
        {loadedAt !== null && !error && !loading ? (
          <span data-testid="calendar-updated" style={{ fontSize: "11px", color: "#475569" }}>Updated {readTime(loadedAt)}</span>
        ) : null}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "12px" }}>
          <button data-testid="calendar-refresh" type="button" onClick={load} disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 600, color: loading ? "#475569" : "#94A3B8", background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "4px 10px", cursor: loading ? "default" : "pointer" }}>
            <RefreshCw size={12} /> {loading ? "Loading…" : "Refresh"}
          </button>
          {/* B15-07 (Captain GO 2026-11-04): an always-visible way to GHL's own Calendars -- the same verified destination
              (Jess 2026-10-07) as the unavailable card; navigation only, new tab, no opener. */}
          <a data-testid="calendars-header-ghl" href={ghlCalendarsUrl()} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 600, color: "#1EC8FF", textDecoration: "none" }}>
            <ExternalLink size={12} /> Open Calendars in GHL
          </a>
        </span>
      </div>

      {error ? (
        <>
        {/* B15-07 / Pass 1 F47: an operator sentence first; GHL's raw text only
            as collapsed detail for whoever diagnoses it. */}
        <div data-testid="calendar-unavailable" data-kind={error.kind} style={{ background: "#0D1B3E", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "12px", padding: "16px 18px", maxWidth: "820px" }}>
          <div style={{ fontSize: "13px", color: "#F87171", fontWeight: 600 }}>
            {error.accessDenied
              ? "Appointments can't be shown here: GHL refused IAOS access to calendars for this account."
              : error.kind === "sign_in"
                ? "Appointments can't be shown until you sign in to IAOS again."
                : error.kind === "unconfigured"
                  ? "Appointments can't be shown here: IAOS read sign-in isn't set up on this site."
                  : "Appointments couldn't be loaded from GHL right now."}
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.5 }}>
            {FAILURE_NEXT[error.kind]}
          </div>
          {/* B15-07: navigation only, to this location's GHL Calendars, in a new tab with no opener. */}
          <a
            data-testid="calendar-open-in-ghl"
            href={ghlCalendarsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: "5px", marginTop: "10px", fontSize: "12px", fontWeight: 600, color: "#1EC8FF", textDecoration: "none" }}
          >
            <ExternalLink size={12} /> Open Calendars in GHL
          </a>
          {error.kind === "temporary" ? (
            <button data-testid="calendar-retry" type="button" onClick={load} disabled={loading}
              style={{ marginLeft: "14px", fontSize: "12px", fontWeight: 600, color: "#94A3B8", background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "3px 10px", cursor: loading ? "default" : "pointer" }}>
              {loading ? "Trying…" : "Try again"}
            </button>
          ) : null}
          <details style={{ marginTop: "8px" }}>
            <summary style={{ fontSize: "11px", color: "#475569", cursor: "pointer" }}>Technical detail</summary>
            <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px", wordBreak: "break-word" }}>{error.detail}</div>
          </details>
        </div>
        {/* B15-07: a failed REFRESH keeps the last successful read visible, labelled -- never presented as current. */}
        {data !== null && loadedAt !== null ? (
          <div data-testid="calendar-stale" style={{ marginTop: "16px", maxWidth: "820px", opacity: 0.75 }}>
            <div style={{ fontSize: "12px", color: "#F59E0B", marginBottom: "10px" }}>
              Showing the last successful read from {readTime(loadedAt)}. It may be out of date.
            </div>
            {data.events.length === 0
              ? <div style={{ fontSize: "12px", color: "#64748B" }}>That read had no upcoming appointments.</div>
              : <AgendaList days={days} />}
          </div>
        ) : null}
        </>
      ) : data === null ? (
        <div data-testid="calendar-loading" style={{ display: "flex", alignItems: "center", gap: "6px", color: "#334155", fontSize: "13px" }}>
          <Loader2 size={14} className="animate-spin" /> Loading appointments…
        </div>
      ) : data.calendars.length === 0 ? (
        // B15-07: GHL answered, but with no active calendar for this location. That is not "no appointments".
        <div data-testid="calendar-no-calendars" style={{ background: "#0D1B3E", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "12px", padding: "16px 18px", color: "#F59E0B", fontSize: "13px", maxWidth: "820px" }}>
          GHL returned no active calendars for this location, so IAOS has no appointments to show. Check Calendars in GHL.
        </div>
      ) : data.events.length === 0 ? (
        <div data-testid="calendar-empty" style={{ background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "24px", color: "#334155", fontSize: "13px", textAlign: "center" }}>
          No upcoming appointments in the next {WINDOW_DAYS} days.
        </div>
      ) : (
        <AgendaList days={days} />
      )}
    </div>
  );
}
