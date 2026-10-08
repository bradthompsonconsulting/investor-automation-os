import { useEffect, useMemo, useState } from "react";
import { useReadRecovered } from "../components/access-status";
import { Link } from "react-router-dom";
import { CalendarDays, Loader2, ExternalLink, Clock } from "lucide-react";
import { ghl, ghlCalendarsUrl, type CalendarEventRow, type CalendarEventsResult } from "../lib/ghl";

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

export default function Calendars() {
  const [data, setData]   = useState<CalendarEventsResult | null>(null);
  const [error, setError] = useState<{ detail: string; accessDenied: boolean } | null>(null);

  // Explicit window (client clock) so the read is deterministic: today → +30 days.
  /* Board 15 cleanup: re-read (never remount) when read sign-in returns after a lapse. */
  const readRecovered = useReadRecovered();
  useEffect(() => {
    setError(null);
    const now = Date.now();
    ghl.calendars.events(now, now + WINDOW_DAYS * 86_400_000)
      .then(setData)
      .catch((e: Error & { code?: string | null }) =>
        setError({ detail: e.message, accessDenied: e.code === "ghl_calendar_access_denied" }));
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
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "16px" }}>
        <CalendarDays size={20} style={{ color: "#1EC8FF" }} />
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Calendars</h1>
        <span style={{ fontSize: "11px", color: "#475569", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px", padding: "2px 8px" }}>Read-only · next {WINDOW_DAYS} days</span>
      </div>

      {error ? (
        // B15-07 / Pass 1 F47: an operator sentence first; GHL's raw text only
        // as collapsed detail for whoever diagnoses it.
        <div data-testid="calendar-unavailable" style={{ background: "#0D1B3E", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "12px", padding: "16px 18px", maxWidth: "820px" }}>
          <div style={{ fontSize: "13px", color: "#F87171", fontWeight: 600 }}>
            {error.accessDenied
              ? "Appointments can't be shown here: GHL refused IAOS access to calendars for this account."
              : "Appointments couldn't be loaded from GHL right now."}
          </div>
          <div style={{ fontSize: "12px", color: "#94A3B8", marginTop: "6px", lineHeight: 1.5 }}>
            {error.accessDenied
              ? "Your appointments are still in GHL — open Calendars in GHL to see them. Nothing was changed."
              : "Try again in a moment. Your appointments are still in GHL. Nothing was changed."}
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
          <details style={{ marginTop: "8px" }}>
            <summary style={{ fontSize: "11px", color: "#475569", cursor: "pointer" }}>Technical detail</summary>
            <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px", wordBreak: "break-word" }}>{error.detail}</div>
          </details>
        </div>
      ) : data === null ? (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#334155", fontSize: "13px" }}>
          <Loader2 size={14} className="animate-spin" /> Loading appointments…
        </div>
      ) : data.events.length === 0 ? (
        <div style={{ background: "#0D1B3E", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "24px", color: "#334155", fontSize: "13px", textAlign: "center" }}>
          No upcoming appointments in the next {WINDOW_DAYS} days.
        </div>
      ) : (
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
      )}
    </div>
  );
}
