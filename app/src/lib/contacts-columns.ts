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

/* B15-20 F2 (Bones, 2026-10-19): a value only shows a time when it carries
   one. A plain date in the precise TEXT carrier would parse as midnight UTC
   and display the previous evening in US time, inventing a time. */
/* A clock time is HH:MM after a "T" or whitespace -- never the HH:MM of a
   timezone offset ("GMT+05:00", "-05:00"), which is not a supplied time
   (Bones F2 follow-up). */
const HAS_CLOCK = /(?:^|[T\s])\d{1,2}:\d{2}/;
const LEADING_DATE = /^\s*(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const utcDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function lastCallAttemptText(precise: string | null, dateOnly: string | null): string {
  const preciseDate = precise ? new Date(precise) : null;
  const preciseValid = !!preciseDate && !isNaN(preciseDate.getTime());
  if (preciseValid && HAS_CLOCK.test(precise!)) {
    return preciseDate!.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  if (dateOnly) {
    const d = new Date(dateOnly);
    if (!isNaN(d.getTime())) return utcDate(d);
  }
  /* A precise value with no clock and no valid DATE fallback: its own stated
     calendar date, read literally -- never via an offset-shifted instant. */
  const ymd = precise ? LEADING_DATE.exec(precise) : null;
  if (ymd) {
    const d = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    if (!isNaN(d.getTime()) && d.getUTCDate() === Number(ymd[3])) return utcDate(d);
  }
  return precise || dateOnly ? ATTEMPT_UNREADABLE : NO_ATTEMPT_RECORDED;
}
