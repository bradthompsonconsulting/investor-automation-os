/**
 * GHL Calendars — read-only appointment agenda (CALENDARS_SPEC §3). Holds the
 * GHL token. READ-ONLY: GET only, zero writes.
 *
 * GET /.netlify/functions/ghl-calendar-events?startTime={ms}&endTime={ms}
 * Default window: now → +30 days.
 *
 * Data path (spec §3): list the location's calendars (GET /calendars/), then FAN
 * OUT over each active calendarId (GET /calendars/events?calendarId=…) and merge.
 * GHL's /calendars/events 422s without a scope param, and calendarId / userId are
 * equivalent, so fan-over-calendarId is the OBSERVED-correct choice (spec §1 #2).
 * Returns APPOINTMENTS ONLY — the endpoint does NOT return the Google-sync "Busy"
 * block-slot mirrors, so no client-side mirror-filtering is needed (spec §1 #1).
 * Reads the correctly-spelled `appointmentStatus`, NEVER the misspelled
 * `appoinmentStatus` GHL also ships (spec §1 #3). No booking, no availability —
 * GHL owns those (GHL-FIRST, master ref §2a).
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // now → +30 days

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
};
function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CalendarEventRow {
  id:             string;
  calendarId:     string;
  calendarName:   string;
  title:          string;
  startTime:      string;   // ISO w/ tz, exactly as GHL returns
  endTime:        string;
  status:         string;   // correctly-spelled appointmentStatus only
  contactId:      string;
  assignedUserId: string;
  notes:          string;
}
export interface CalendarEventsResult {
  window:    { startTime: number; endTime: number };
  calendars: { id: string; name: string }[];
  events:    CalendarEventRow[];
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };

  const now = Date.now();
  const startTime = Number(event.queryStringParameters?.startTime) || now;
  const endTime   = Number(event.queryStringParameters?.endTime)   || now + DEFAULT_WINDOW_MS;

  try {
    // 1) The location's calendars = the fan-out targets. GHL-FIRST: use whatever
    //    GHL has, don't hardcode ids that can change.
    const cRes  = await fetch(`${GHL_BASE}/calendars/?locationId=${LOCATION_ID}`, { headers: headers(token) });
    const cBody = await cRes.json();
    if (!cRes.ok) throw new Error(`GET /calendars/ → ${cRes.status}: ${JSON.stringify(cBody)}`);
    const calendars: any[] = (cBody.calendars ?? []).filter((c: any) => c?.id && c.isActive !== false);

    // 2) Fan out over each calendarId (bounded — a handful of calendars), merge.
    const rows: CalendarEventRow[] = [];
    for (const cal of calendars) {
      const params = new URLSearchParams({
        locationId: LOCATION_ID, calendarId: cal.id,
        startTime: String(startTime), endTime: String(endTime),
      });
      const eRes  = await fetch(`${GHL_BASE}/calendars/events?${params}`, { headers: headers(token) });
      const eBody = await eRes.json();
      if (!eRes.ok) throw new Error(`GET /calendars/events?calendarId=${cal.id} → ${eRes.status}: ${JSON.stringify(eBody)}`);
      for (const e of (eBody.events ?? [])) {
        rows.push({
          id:             e.id ?? "",
          calendarId:     e.calendarId ?? cal.id,
          calendarName:   cal.name ?? "",
          title:          String(e.title ?? "").trim(),
          startTime:      e.startTime ?? "",
          endTime:        e.endTime ?? "",
          status:         String(e.appointmentStatus ?? ""), // correct spelling ONLY (spec §1 #3)
          contactId:      e.contactId ?? "",
          assignedUserId: e.assignedUserId ?? "",
          notes:          String(e.notes ?? e.description ?? "").trim(),
        });
      }
      await delay(110);
    }

    // Oldest → newest: an agenda reads forward in time.
    rows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const result: CalendarEventsResult = {
      window:    { startTime, endTime },
      calendars: calendars.map((c) => ({ id: c.id, name: c.name ?? "" })),
      events:    rows,
    };
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (err: any) {
    console.error("[ghl-calendar-events]", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message ?? "Internal error" }) };
  }
};
