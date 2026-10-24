/**
 * Contacts grid Stage and Last call attempt columns -- B15-20 (INV-129),
 * Pass 1 F17 (narrow slice: stage and last-contact).
 *
 * Pure. No I/O, no React, no GHL. Decides only how values the page already
 * read are shown, and keeps unknown values unknown.
 *
 * STAGE comes from the existing Seller Leads pipeline read (the one Pipeline
 * and the Dashboard use), joined by contact id. A contact can have no loaded
 * deal or several, so the cell never picks one: one deal shows its stage,
 * several list every stage, none says so -- "in the loaded results", since
 * that read reports no total (B15-19). A stage id outside the pipeline's
 * stage list reads "Stage not recognised", as on the contact page (F38). A
 * deal's GHL status (open / won / lost) is not part of this read and is not
 * implied.
 *
 * LAST CALL ATTEMPT is the contact's existing last_call_attempt carrier, the
 * value the Dashboard's "Last Contact" column already shows: the precise TEXT
 * companion with its time when it carries one (F2: a time is never invented),
 * otherwise the DATE field (date only,
 * read in UTC so it is not shifted a day). It records IAOS / Board 4 call
 * attempts only, so it is labelled as that and never as "last contact" of any
 * other kind; no value reads "No attempt recorded", never "not contacted".
 */

type Stage = { id: string; name: string };
type Deal = { contactId: string; stageId: string };

export const STAGE_LOADING = "Loading…";
export const STAGE_UNAVAILABLE = "Stage couldn't be loaded";
export const STAGE_NOT_RECOGNISED = "Stage not recognised";
export const NO_LOADED_DEAL = "No Seller Leads deal in the loaded results";
export const NO_ATTEMPT_RECORDED = "No attempt recorded";
export const ATTEMPT_UNREADABLE = "Unreadable date";

export type DealStageSource =
  | { kind: "loading" }
  | { kind: "failed"; detail: string }
  | { kind: "loaded"; stageNamesByContact: ReadonlyMap<string, readonly (string | null)[]> };

/** Each contact's loaded deals' stage names, in read order; null where the stage is not in the list. */
export function indexDealStages(stages: readonly Stage[], deals: readonly Deal[]): Map<string, (string | null)[]> {
  const names = new Map(stages.map((s) => [s.id, s.name]));
  const out = new Map<string, (string | null)[]>();
  for (const d of deals) {
    if (!d.contactId) continue;
    const list = out.get(d.contactId) ?? [];
    list.push(names.get(d.stageId) ?? null);
    out.set(d.contactId, list);
  }
  return out;
}

export type StageCell = {
  kind: "loading" | "unavailable" | "no_loaded_deal" | "single" | "multiple";
  text: string;
};

export function stageCell(contactId: string, source: DealStageSource): StageCell {
  if (source.kind === "loading") return { kind: "loading", text: STAGE_LOADING };
  if (source.kind === "failed") return { kind: "unavailable", text: STAGE_UNAVAILABLE };
  const list = source.stageNamesByContact.get(contactId) ?? [];
  if (list.length === 0) return { kind: "no_loaded_deal", text: NO_LOADED_DEAL };
  const label = (n: string | null) => n ?? STAGE_NOT_RECOGNISED;
  if (list.length === 1) return { kind: "single", text: label(list[0]) };
  const counts = new Map<string, number>();
  for (const n of list) counts.set(label(n), (counts.get(label(n)) ?? 0) + 1);
  const parts = [...counts].map(([n, k]) => (k > 1 ? `${n} (${k})` : n));
  return { kind: "multiple", text: `${list.length} deals: ${parts.join(", ")}` };
}

/* Contacts grid name casing (Spock, Test observation 2026-10-23). The contact
   list read returns first and last names lowercased
   (CONTACTS_OPPORTUNITIES_SPEC.md §5.1 and CONTACT_WORKSPACE_SPEC_v2.md §10,
   OBSERVED; cause unproven), while the Seller Leads pipeline read the Stage
   column already uses carries each deal's contact name as GHL shows it. The
   grid shows that name ONLY when it is the same name ignoring letter case and
   spacing, and only when every loaded deal for the contact agrees, so the
   letters never change -- only their case. Otherwise the list's own value
   stands: nothing is title-cased or guessed (McCormack, de la Cruz). Display
   only: sorting and search keep using the list value, and nothing is
   written. */
type NamedDeal = { contactId: string; contactName: string };

const sameName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Each contact's deal-side name, kept only when every loaded deal for that contact gives the same one. */
export function indexDealContactNames(deals: readonly NamedDeal[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const d of deals) {
    if (!d.contactId) continue;
    const name = (d.contactName ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const prior = seen.get(d.contactId);
    seen.set(d.contactId, prior === undefined || prior === name ? name : null);
  }
  const out = new Map<string, string>();
  for (const [id, name] of seen) if (name !== null) out.set(id, name);
  return out;
}

/** The list name, or the deal-side name when the two differ only in case and spacing. */
export function displayGridName(listName: string, dealName: string | undefined): string {
  if (!listName || !dealName) return listName;
  return sameName(dealName) === sameName(listName) ? dealName : listName;
}

/* B15-20 F2 (Bones, 2026-10-19): a value is shown only when the WHOLE value
   is one of the supported shapes below and is a real date (and time). Every
   other value -- a malformed clock or suffix ("2026-10-01Tbad",
   "2026-10-01T9:xx", "2026-10-01T10", "2026-10-01 nonsense"), an impossible
   date or time, or any other text -- is unreadable. The built-in Date
   parser is never trusted: it silently rolls impossible values into other
   dates. Each field (precise TEXT, DATE fallback) is checked on its own, so
   a malformed value never overrides a valid one.

   Supported shapes (whole value, surrounding whitespace ignored):
     YYYY-MM-DD                                  date only
     YYYY-MM-DD [GMT|UTC]±HH:MM                  date with a zone, no clock
     YYYY-MM-DD(T| )HH:MM[:SS[.fraction]][zone]  date and clock, where zone
       is Z, ±HH:MM, ±HHMM or " GMT±HH:MM"/" UTC±HH:MM" (offsets up to ±14:00)
   A clock with no zone is local time. These are the forms the current
   writers produce and the forms reviewed so far; other historical TEXT
   formats are not proven and read as unreadable. */
const SUPPORTED =
  /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|\s?(?:GMT|UTC)?\s?([+-])(\d{2}):?(\d{2}))?|\s(?:GMT|UTC)?([+-])(\d{2}):(\d{2}))?\s*$/;
// groups: 1-3 date; 4-7 clock h/m/s/fraction; 8 zone (9 sign, 10-11 offset); 12-14 date-only zone sign/offset
/* Display text is built from validated components, not Intl/Date
   formatting: years 0-99 stay exactly as supplied ("0099", never "99" or
   1999), and the output is deterministic ("Oct 1, 2026" /
   "Oct 1, 2026, 7:00 PM"). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatYmd = (y: number, m: number, d: number) => `${MONTHS[m - 1]} ${d}, ${String(y).padStart(4, "0")}`;
function formatLocalDateTime(t: Date): string {
  const h = t.getHours();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(t.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return `${formatYmd(t.getFullYear(), t.getMonth() + 1, t.getDate())}, ${clock}`;
}

function daysInMonth(year: number, month: number): number {
  return [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
const validOffset = (h: number, m: number) => m <= 59 && (h < 14 || (h === 14 && m === 0));

type Checked =
  | { kind: "invalid" }
  | { kind: "date"; y: number; m: number; d: number }
  | { kind: "instant"; y: number; m: number; d: number; instant: Date };

/** Checks one stored value against the supported shapes; builds the instant itself, never via the lenient parser. */
function checkValue(raw: string): Checked {
  const x = SUPPORTED.exec(raw);
  if (!x) return { kind: "invalid" };
  const y = Number(x[1]), m = Number(x[2]), d = Number(x[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return { kind: "invalid" };
  if (x[12] !== undefined) {
    /* Date with a zone and no clock: the zone is checked, the date is the stated date. */
    return validOffset(Number(x[13]), Number(x[14])) ? { kind: "date", y, m, d } : { kind: "invalid" };
  }
  if (x[4] === undefined) return { kind: "date", y, m, d };
  const h = Number(x[4]), min = Number(x[5]), sec = x[6] === undefined ? 0 : Number(x[6]);
  if (h > 23 || min > 59 || sec > 59) return { kind: "invalid" };
  const ms = x[7] === undefined ? 0 : Math.floor(Number(`0.${x[7]}`) * 1000);
  /* Built with set(UTC)FullYear, so years 0-99 are kept as supplied (the
     Date constructor and Date.UTC would read 99 as 1999), and round-tripped
     against the parsed components: a local wall time that does not exist
     (a spring-forward gap, e.g. 02:30 on 2026-03-08 in America/Chicago) is
     refused instead of being moved to 03:30. */
  let instant: Date;
  if (x[8] === undefined) {
    instant = new Date(0); // no zone: local time
    instant.setFullYear(y, m - 1, d);
    instant.setHours(h, min, sec, ms);
    if (instant.getFullYear() !== y || instant.getMonth() !== m - 1 || instant.getDate() !== d
      || instant.getHours() !== h || instant.getMinutes() !== min || instant.getSeconds() !== sec) return { kind: "invalid" };
  } else {
    const utc = new Date(0);
    utc.setUTCFullYear(y, m - 1, d);
    utc.setUTCHours(h, min, sec, ms);
    if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d
      || utc.getUTCHours() !== h || utc.getUTCMinutes() !== min || utc.getUTCSeconds() !== sec) return { kind: "invalid" };
    if (x[8] === "Z") {
      instant = utc;
    } else {
      const oh = Number(x[10]), om = Number(x[11]);
      if (!validOffset(oh, om)) return { kind: "invalid" };
      const sign = x[9] === "-" ? -1 : 1;
      instant = new Date(utc.getTime() - sign * (oh * 60 + om) * 60_000);
    }
  }
  return { kind: "instant", y, m, d, instant };
}

export function lastCallAttemptText(precise: string | null, dateOnly: string | null): string {
  const p = precise ? checkValue(precise) : null;
  if (p && p.kind === "instant") {
    return formatLocalDateTime(p.instant);
  }
  /* The DATE fallback, valid on its own: its stated calendar date. */
  const f = dateOnly ? checkValue(dateOnly) : null;
  if (f && f.kind !== "invalid") return formatYmd(f.y, f.m, f.d);
  /* A precise value with no clock and no valid fallback: its own stated date. */
  if (p && p.kind === "date") return formatYmd(p.y, p.m, p.d);
  return precise || dateOnly ? ATTEMPT_UNREADABLE : NO_ATTEMPT_RECORDED;
}
