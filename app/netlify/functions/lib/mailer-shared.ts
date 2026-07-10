/**
 * Mailers — shared query. Imported by ghl-mailers.ts (app page API) and
 * mailer-digest.ts (Friday email) so both read off exactly one code path.
 *
 * GHL's Tasks API is contact-scoped only (GET /contacts/{id}/tasks) — there is
 * no location-wide "list all tasks" endpoint — so gathering mailer tasks means
 * fetching all contacts, then fanning out one tasks-fetch per contact.
 */

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Matches "Hot mail — Touch 1 (PRIMARY)" / "Warm mail — Touch 3 (POSTCARD)" /
// "Low mail — Touch 2 (POSTCARD)" — confirmed live against real GHL tasks.
// Tier and mailer type are read from the title, not the contact's current tag,
// since a contact's tag can move on (demotion) after the task was created.
const TASK_TITLE_RE = /^(hot|warm|low)\s+mail\s*—\s*touch\s*(\d+)\s*\((primary|postcard)\)/i;

// Business-flag detection, part 2: native companyName is the primary signal,
// but plenty of business-owned contacts only show it in the contact's display
// name (e.g. "Woodleigh Holdings LLC"). Word-boundary, case-insensitive match
// against this list — tunable in one place.
const BUSINESS_ENTITY_TOKENS = [
  "LLC", "L.L.C.", "INC", "CORP", "CORPORATION", "COMPANY",
  "CUSTODIAN", "LP", "LLP", "LTD", "LIMITED", "PARTNERS", "PROPERTIES",
  "HOLDINGS", "ENTERPRISES", "REALTY", "REAL ESTATE", "ASSOCIATION", "FUND",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BUSINESS_ENTITY_RE = new RegExp(
  `\\b(?:${BUSINESS_ENTITY_TOKENS.map(escapeRegExp).join("|")})\\b`,
  "i",
);

function looksLikeBusinessName(name: string): boolean {
  return BUSINESS_ENTITY_RE.test(name);
}

export type Tier = "hot" | "warm" | "low";
export type MailerType = "Primary" | "Postcard";

export interface MailerTaskRow {
  taskId:          string;
  contactId:       string;
  contactName:     string;
  address:         string;
  hasAddress:      boolean;
  tier:            Tier;
  mailerType:      MailerType;
  touchNumber:     number;
  dueDate:         string; // raw ISO from GHL
  dueDateCT:       string; // YYYY-MM-DD in America/Chicago
  completed:       boolean;
  hasBusinessName: boolean;
  companyName:     string | null;
}

export interface MailerGroup {
  key:   string; // e.g. "hot-primary"
  label: string; // e.g. "Hot Primary"
  rows:  MailerTaskRow[];
}

export interface MailerDigest {
  weekStartCT: string;
  weekEndCT:   string;
  thisWeekReady:    MailerGroup[];
  thisWeekBusiness: MailerGroup[];
  overdue:          MailerGroup[];
  noAddress:        MailerTaskRow[];
  totals: {
    ready:     number;
    business:  number;
    overdue:   number;
    noAddress: number;
    byMailerType: Record<string, number>; // across ready+business+overdue
  };
}

// ── Central-time date helpers ───────────────────────────────────────────────

const ctDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// YYYY-MM-DD for a Date, as seen in America/Chicago.
function toCentralDateString(d: Date): string {
  return ctDateFmt.format(d); // en-CA formats as YYYY-MM-DD
}

// Add/subtract whole days to a YYYY-MM-DD string, staying in date-only math
// (constructed at UTC noon to dodge any DST-edge rollover from date math).
function shiftDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun..6=Sat
}

// Most recent Friday on/before `now` (Central calendar date), and the
// Saturday six days before it — the "week ending Friday" window used by
// both the app page and the digest.
function computeWeekWindow(now: Date): { weekStartCT: string; weekEndCT: string } {
  const today = toCentralDateString(now);
  const diffToFriday = (dayOfWeek(today) - 5 + 7) % 7; // Friday = 5
  const weekEndCT = shiftDateString(today, -diffToFriday);
  const weekStartCT = shiftDateString(weekEndCT, -6);
  return { weekStartCT, weekEndCT };
}

// ── Concurrency-limited fan-out ─────────────────────────────────────────────
// A fully serial per-contact fan-out (contacts × one request each) risks
// Netlify's ~10s function timeout as contact count grows. 5-way concurrency
// keeps wall-clock down while staying comfortably under GHL's rate limit.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Contacts (minimal fields needed for mailer rows) ────────────────────────

interface MinimalContact {
  id: string;
  contactName: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  companyName: string | null;
}

async function fetchAllContactsMinimal(token: string): Promise<MinimalContact[]> {
  const all: any[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  while (true) {
    const params = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);
    if (startAfter)   params.set("startAfter",   String(startAfter));

    const res  = await fetch(`${GHL_BASE}/contacts?${params}`, { headers: headers(token) });
    const body = await res.json();
    if (!res.ok) throw new Error(`GET /contacts → ${res.status}: ${JSON.stringify(body)}`);

    const batch: any[] = body.contacts ?? [];
    all.push(...batch);

    const meta = body.meta ?? {};
    if (!meta.startAfterId || batch.length < 100) break;
    startAfterId = meta.startAfterId;
    startAfter   = meta.startAfter;
    await delay(110);
  }

  return all.map((c: any) => ({
    id:          c.id,
    contactName: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "(no name)",
    address1:    c.address1 ?? "",
    city:        c.city ?? "",
    state:       c.state ?? "",
    postalCode:  c.postalCode ?? "",
    companyName: c.companyName ?? null,
  }));
}

function formatAddress(c: MinimalContact): string {
  const cityStateZip = [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [c.address1, cityStateZip].filter(Boolean).join(", ");
}

// ── Tasks ────────────────────────────────────────────────────────────────────

async function fetchContactTasks(token: string, contactId: string): Promise<any[]> {
  const res  = await fetch(`${GHL_BASE}/contacts/${contactId}/tasks`, { headers: headers(token) });
  const body = await res.json();
  if (!res.ok) throw new Error(`GET /contacts/${contactId}/tasks → ${res.status}: ${JSON.stringify(body)}`);
  return body.tasks ?? [];
}

export async function fetchAllMailerTaskRows(token: string): Promise<MailerTaskRow[]> {
  const contacts = await fetchAllContactsMinimal(token);

  const perContact = await mapLimit(contacts, 5, async (c) => {
    const tasks = await fetchContactTasks(token, c.id);
    const rows: MailerTaskRow[] = [];

    for (const t of tasks) {
      const m = TASK_TITLE_RE.exec(String(t.title ?? "").trim());
      if (!m) continue;

      const tier = m[1].toLowerCase() as Tier;
      const touchNumber = parseInt(m[2], 10);
      const mailerType = (m[3][0].toUpperCase() + m[3].slice(1).toLowerCase()) as MailerType;
      const dueDate = t.dueDate ?? "";
      const companyName = c.companyName?.trim() || null;
      const address = formatAddress(c);

      rows.push({
        taskId:          t.id,
        contactId:       c.id,
        contactName:     c.contactName,
        address,
        hasAddress:      !!c.address1?.trim(),
        tier,
        mailerType,
        touchNumber,
        dueDate,
        dueDateCT:       dueDate ? toCentralDateString(new Date(dueDate)) : "",
        completed:       !!t.completed,
        hasBusinessName: !!companyName || looksLikeBusinessName(c.contactName),
        companyName,
      });
    }

    return rows;
  });

  return perContact.flat();
}

// ── Bucketing ────────────────────────────────────────────────────────────────

function groupBy(rows: MailerTaskRow[]): MailerGroup[] {
  const map = new Map<string, MailerGroup>();
  for (const row of rows) {
    const key = `${row.tier}-${row.mailerType.toLowerCase()}`;
    if (!map.has(key)) {
      const label = `${row.tier[0].toUpperCase()}${row.tier.slice(1)} ${row.mailerType}`;
      map.set(key, { key, label, rows: [] });
    }
    map.get(key)!.rows.push(row);
  }
  // Stable, sensible order: Hot, Warm, Low; Primary before Postcard.
  const tierOrder: Tier[] = ["hot", "warm", "low"];
  return [...map.values()].sort((a, b) => {
    const [ta, ma] = a.key.split("-");
    const [tb, mb] = b.key.split("-");
    const tDiff = tierOrder.indexOf(ta as Tier) - tierOrder.indexOf(tb as Tier);
    if (tDiff !== 0) return tDiff;
    return ma === mb ? 0 : ma === "primary" ? -1 : 1;
  });
}

export async function buildMailerDigest(token: string, now: Date = new Date()): Promise<MailerDigest> {
  const allRows = await fetchAllMailerTaskRows(token);
  const { weekStartCT, weekEndCT } = computeWeekWindow(now);

  const incomplete = allRows.filter((r) => !r.completed);

  const noAddress = incomplete.filter((r) => !r.hasAddress);
  const addressed = incomplete.filter((r) => r.hasAddress);

  const inWeek = (r: MailerTaskRow) => r.dueDateCT >= weekStartCT && r.dueDateCT <= weekEndCT;

  const readyRows    = addressed.filter((r) => inWeek(r) && !r.hasBusinessName);
  const businessRows = addressed.filter((r) => inWeek(r) && r.hasBusinessName);
  const overdueRows  = addressed.filter((r) => r.dueDateCT < weekStartCT);

  const byMailerType: Record<string, number> = {};
  for (const r of [...readyRows, ...businessRows, ...overdueRows]) {
    const k = `${r.tier[0].toUpperCase()}${r.tier.slice(1)} ${r.mailerType}`;
    byMailerType[k] = (byMailerType[k] ?? 0) + 1;
  }

  return {
    weekStartCT,
    weekEndCT,
    thisWeekReady:    groupBy(readyRows),
    thisWeekBusiness: groupBy(businessRows),
    overdue:          groupBy(overdueRows),
    noAddress,
    totals: {
      ready:     readyRows.length,
      business:  businessRows.length,
      overdue:   overdueRows.length,
      noAddress: noAddress.length,
      byMailerType,
    },
  };
}
