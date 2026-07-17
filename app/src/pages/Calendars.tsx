import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Loader2, ExternalLink, Clock } from "lucide-react";
import { ghl, type CalendarEventRow, type CalendarEventsResult } from "../lib/ghl";

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
  const [error, setError] = useState<string | null>(null);

  // Explicit window (client clock) so the read is deterministic: today → +30 days.
  useEffect(() => {
    setError(null);
    const now = Date.now();
    ghl.calendars.events(now, now + WINDOW_DAYS * 86_400_000)
      .then(setData)
      .catch((e: Error) => setError(e.message));
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
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "16px" }}>
        <CalendarDays size={20} style={{ color: "#1EC8FF" }} />
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#F1F5F9", margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Calendars</h1>
        <span style={{ fontSize: "11px", color: "#475569", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "999px", padding: "2px 8px" }}>Read-only · next {WINDOW_DAYS} days</span>
      </div>

      {error ? (
        <div style={{ fontSize: "13px", color: "#F87171" }}>Failed to load appointments: {error}</div>
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
