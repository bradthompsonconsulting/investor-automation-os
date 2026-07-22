/**
 * Contact parse — the single source of truth for "raw GHL contact -> our
 * ContactRow shape". Extracted verbatim from ghl-contacts.ts so the plural
 * (ghl-contacts, list) and singular (ghl-contact, single-record) functions
 * share ONE parser and cannot drift. Pure functions, no I/O.
 */

// Score field IDs — hardcoded (confirmed via /locations/.../customFields)
const SCORE_IDS = {
  motivation_score:        "8vH9yq10xeYVVMHXbS0C",
  deal_score:              "cfkm0kb9CLvjZgyrcIFz",
  combined_score:          "9SVnuzznYsZOQQazpxld",
  data_completeness_score: "r9sD1rlTIqhOx9Mhvftt",
};

// Contact-side offer_price (§14e OFFER_FIELD_IDS.contact.offer_price in
// MaoCalculator.tsx) — read-only here, used by the Dashboard's "Offers to
// review" tile to detect a saved-but-unsent offer. Never written by this function.
const OFFER_PRICE_ID = "v2VO2wUwTYRojmU7VXyZ";

// Property Address (contact.property_address) — the deal's subject-property
// address, a TEXT custom field. Confirmed live: tG4gGFI8JB2VjWeuqYMx =
// "2623 Greenway Dr" on bradt75, present BY VALUE in both the list and
// single-record reads (the list does not truncate custom fields). Read-only.
const PROPERTY_ADDRESS_ID = "tG4gGFI8JB2VjWeuqYMx";

// Dashboard Phase 2/3 fields (confirmed live via /locations/.../customFields).
// callback_datetime and last_call_attempt are DATE type on contact; parsing
// here only reads them, never writes.
const CALLBACK_DATETIME_ID = "JeQWtwpwUbvPA50UfuPU";
// Exported: the disposition-capture function (ghl-disposition.ts) writes these
// two, server-side, so it must share the SAME ids as the read parser — never a
// second copy that can drift.
export const LAST_CALL_ATTEMPT_ID = "lGoNXM9Wrte4m7ShwQPT";

// Companion TEXT field — GHL's DATE type truncates time-of-day on write, so
// this holds the exact ISO string written in the same PUT as
// callback_datetime. Read-only here; written by ghl.contacts.setCallbackDatetime.
const CALLBACK_DATETIME_PRECISE_ID = "7qRUkZQK8bi2HNo7zDHd";

// Companion TEXT field for last_call_attempt — same DATE-truncation bug
// (confirmed live: a ~15min-old note displayed as "Attempted 16h ago").
// Read-only here; written by ghl.contacts.setLastCallAttempt AND, server-side,
// by ghl-disposition.ts — so it is exported alongside LAST_CALL_ATTEMPT_ID.
export const LAST_CALL_ATTEMPT_PRECISE_ID = "2vz1igGMxF3wv7HaWm97";

function cfValue(customFields: any[], id: string): number | null {
  const f = customFields?.find((cf: any) => cf.id === id);
  const raw = f?.value ?? f?.fieldValue ?? null;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return isNaN(n) ? null : n;
}

// DATE fields (callback_datetime, last_call_attempt) come back as a unix-ms
// number under fieldValueDate — normalize to ISO so the client only ever
// deals in date strings.
function cfDate(customFields: any[], id: string): string | null {
  const f = customFields?.find((cf: any) => cf.id === id);
  const raw = f?.value ?? f?.fieldValue ?? f?.fieldValueDate ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return new Date(raw).toISOString();
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// TEXT fields — plain string passthrough. Validates the stored value actually
// parses as a date before trusting it (defensive against a stray manual edit
// in GHL's UI), returning null rather than a garbage timestamp otherwise.
function cfText(customFields: any[], id: string): string | null {
  const f = customFields?.find((cf: any) => cf.id === id);
  const raw = f?.value ?? f?.fieldValue ?? null;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return isNaN(new Date(s).getTime()) ? null : s;
}

// Plain TEXT passthrough — the field's raw string value, or "" if the field is
// absent/empty. Unlike cfText, does NOT date-validate (property_address is a
// street address, never a date) and defaults to "" to match the native address
// fields — never null, undefined, or a thrown error on an absent field.
function cfString(customFields: any[], id: string): string {
  const f = customFields?.find((cf: any) => cf.id === id);
  const raw = f?.value ?? f?.fieldValue ?? null;
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

// Raw GHL contact -> our ContactRow shape. Field order preserved exactly as it
// was inline in ghl-contacts.ts so the serialized output is byte-identical.
export function parseContact(c: any) {
  const cf: any[] = c.customFields ?? [];
  return {
    id:              c.id,
    firstName:       c.firstName ?? "",
    lastName:        c.lastName  ?? "",
    phone:           c.phone     ?? "",
    email:           c.email     ?? "",
    address1:        c.address1  ?? "",
    city:            c.city      ?? "",
    state:           c.state     ?? "",
    postalCode:      c.postalCode ?? "",
    dateAdded:       c.dateAdded ?? null,
    tags:            (c.tags ?? []).map((t: string) => String(t).toLowerCase()),
    motivationScore:    cfValue(cf, SCORE_IDS.motivation_score),
    dealScore:          cfValue(cf, SCORE_IDS.deal_score),
    combinedScore:      cfValue(cf, SCORE_IDS.combined_score),
    completenessScore:  cfValue(cf, SCORE_IDS.data_completeness_score),
    offerPrice:         cfValue(cf, OFFER_PRICE_ID),
    callbackDatetime:        cfDate(cf, CALLBACK_DATETIME_ID),
    callbackDatetimePrecise: cfText(cf, CALLBACK_DATETIME_PRECISE_ID),
    lastCallAttempt:         cfDate(cf, LAST_CALL_ATTEMPT_ID),
    lastCallAttemptPrecise:  cfText(cf, LAST_CALL_ATTEMPT_PRECISE_ID),
    propertyAddress:         cfString(cf, PROPERTY_ADDRESS_ID),
  };
}
