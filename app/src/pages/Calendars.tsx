import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReadRecovered } from "../components/access-status";
import { Link } from "react-router-dom";
import { CalendarDays, Loader2, ExternalLink, Clock, RefreshCw } from "lucide-react";
import { ghl, ghlCalendarsUrl, type CalendarEventRow, type CalendarEventsResult } from "../lib/ghl";
import { READ_SESSION_LOST_EVENT } from "../lib/read-session";
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
/* R3 (Captain walkthrough, decision 2026-11-06): a failed read shows only "Open Calendars in GHL" (the card below).
   The failure is still classified (data-kind) and handled as before; only its presentation is reduced. */

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
  /* B15-07 r2 (Bones P2): every read and every failure is TAGGED with the read context it was made in -- the recovery
     epoch (useReadRecovered: it changes each time read sign-in comes back after a lapse, i.e. possibly another session
     or operator). A retained read is rendered only while its tag equals the CURRENT context, so a recovered session
     never sees the previous session's appointments: not while its own read is pending, not after it fails. The check
     runs during render (no effect delay), an old context's late answer can never match again, and the cache is also
     dropped the moment IAOS reports a lost read session. Within one context, a failed refresh still keeps the last
     good read, labelled. */
  const readRecovered = useReadRecovered();
  const ctxRef = useRef(readRecovered);
  ctxRef.current = readRecovered;
  const [cache, setCache] = useState<{ ctx: number; result: CalendarEventsResult; at: number } | null>(null);
  const [failure, setFailure] = useState<{ ctx: number; detail: string; accessDenied: boolean; kind: CalendarFailureKind } | null>(null);
  const [loading, setLoading]   = useState(true);
  const readSeq = useRef(0);   // only the newest read may set state (a superseded read that settles late is ignored)
  // `data` is the LAST SUCCESSFUL read IN THIS READ CONTEXT (never replaced by a failure); `error` is the latest failure in it.
  const data: CalendarEventsResult | null = cache !== null && cache.ctx === readRecovered ? cache.result : null;
  const loadedAt: number | null = cache !== null && cache.ctx === readRecovered ? cache.at : null;
  const error = failure !== null && failure.ctx === readRecovered ? failure : null;

  // Explicit window (client clock) so the read is deterministic: today → +30 days.
  const load = useCallback(() => {
    const mine = ++readSeq.current;
    const ctx = ctxRef.current;
    setLoading(true);
    const now = Date.now();
    ghl.calendars.events(now, now + WINDOW_DAYS * 86_400_000)
      .then((r) => { if (mine !== readSeq.current) return; setCache({ ctx, result: r, at: Date.now() }); setFailure(null); setLoading(false); })
      .catch((e: Error & { code?: string | null }) => {
        if (mine !== readSeq.current) return;
        setFailure({ ctx, detail: e.message, accessDenied: e.code === "ghl_calendar_access_denied", kind: calendarFailureKind(e.code) });
        setLoading(false);
      });
  }, []);
  /* Board 15 cleanup: re-read (never remount) when read sign-in returns after a lapse. B15-07 r2: a new read context
     voids every read still in flight and drops the previous context's read and failure before reading again. */
  useEffect(() => {
    readSeq.current += 1;
    setCache((c) => (c !== null && c.ctx !== readRecovered ? null : c));
    setFailure((f) => (f !== null && f.ctx !== readRecovered ? null : f));
    load();
  }, [readRecovered]);
  // B15-07 r2: IAOS reports a lost read session (any read refused for sign-in) -> retained appointments are dropped at once.
  useEffect(() => {
    const lost = () => setCache(null);
    window.addEventListener(READ_SESSION_LOST_EVENT, lost);
    return () => window.removeEventListener(READ_SESSION_LOST_EVENT, lost);
  }, []);

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
          {/* B15-07 (Captain GO 2026-11-04): a way to GHL's own Calendars -- the same verified destination (Jess
              2026-10-07) as the failure card; navigation only, new tab, no opener. R3 (decision 2026-11-06): hidden
              while the read has failed, where the card carries the one link. */}
          {!error ? (
            <a data-testid="calendars-header-ghl" href={ghlCalendarsUrl()} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 600, color: "#1EC8FF", textDecoration: "none" }}>
              <ExternalLink size={12} /> Open Calendars in GHL
            </a>
          ) : null}
        </span>
      </div>

      {error ? (
        /* R3: only "Open Calendars in GHL". data-kind keeps the classified failure for diagnosis and tests; no
           headline, no Try again (Refresh stays in the header), no technical detail, and no last-read list --
           nothing on a failed read can be taken for a current or an empty calendar. */
        <div data-testid="calendar-unavailable" data-kind={error.kind} role="status" style={{ background: "#0D1B3E", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "12px", padding: "16px 18px", maxWidth: "820px" }}>
          {/* B15-07: navigation only, to this location's GHL Calendars, in a new tab with no opener. */}
          <a
            data-testid="calendar-open-in-ghl"
            href={ghlCalendarsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "13px", fontWeight: 600, color: "#1EC8FF", textDecoration: "none" }}
          >
            <ExternalLink size={13} /> Open Calendars in GHL
          </a>
        </div>
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
