/**
 * IAOS GHL Service Module — single entry point for all GHL data access.
 *
 * Phase A (current): every call proxies through a server-side Netlify function
 * that holds GHL_API_TOKEN. The browser never sees the key.
 *
 * Phase B (OAuth): replace the `request` function implementation only.
 * All callers stay the same — pages import from this module, never from GHL directly.
 *
 * Write methods are stubbed with comments so pages can call them
 * without refactoring once implemented.
 */

import { getRuntimeConfig } from "../../shared/ghl-config";
/* Board item #2C. The three option LABELS are declared once, in resolver-types,
   and this module reads them rather than retyping them. Retyping would create a
   second list that could drift from the one the resolver parses against, and a
   mode written under a label the resolver does not recognise reads back as an
   unresolved deal with no explanation. Import direction is one-way: nothing
   under lib/underwriting imports this module. */
import { ASSIGNMENT_MODE_OPTIONS } from "./underwriting/resolver-types";

// PB-D51 — location id and every field id below resolve from the shared config,
// once at module scope. Values are unchanged; only their source moved.
const CONFIG      = getRuntimeConfig();
const LOCATION_ID = CONFIG.locationId;
const PROXY       = "/.netlify/functions/ghl-proxy";

// Dashboard Phase 2 — confirmed live via /locations/.../customFields (both
// DATE type, contact model). last_call_attempt is the ONLY field this module
// writes outside the already-established offer_/stage/task write paths.
const LAST_CALL_ATTEMPT_ID = CONFIG.fields.lastCallAttempt;

// Companion TEXT field — same DATE-truncation bug as callback_datetime
// (confirmed live: a note saved ~15min prior displayed as "Attempted 16h
// ago" because the DATE field truncates to midnight UTC). last_call_attempt
// is still written for GHL's own UI; this field is our own read path's
// source of truth. Written in the SAME PUT as last_call_attempt — no new
// write action, still inside the three-write invariant.
const LAST_CALL_ATTEMPT_PRECISE_ID = CONFIG.fields.lastCallAttemptPrecise;

// Dashboard Phase 3 — the third and last scoped write (spec guardrails).
// DATE type, contact model, same ID already used for the read side (§14f note:
// this field predates Phase 3's write — Build 2A only read it).
const CALLBACK_DATETIME_ID = CONFIG.fields.callbackDatetime;

// Companion TEXT field — GHL's DATE type silently truncates time-of-day on
// write (confirmed live: a 2pm CT callback round-tripped as "Jul 14, 7pm").
// callback_datetime is still written for GHL's own UI, but this field is our
// own read path's source of truth so overdue/today bucketing survives a
// reload. Written in the SAME PUT as callback_datetime — no new write action.
const CALLBACK_DATETIME_PRECISE_ID = CONFIG.fields.callbackDatetimePrecise;

// Phase B PB-D1 — property_notes, the first Class 1 unlocked field.
// Additional Info > Investor subgroup, TEXT-typed.
export const PROPERTY_NOTES_ID = CONFIG.fields.propertyNotes;
export const ARV_ID = CONFIG.fields.arv; // MONETORY, PB-D16/PB-D17 — B2 unlock
// Board item #2B — the second unlocked MONETORY field and the other half of the
// Gate 1 underwriting pair. ARV was editable and repairs was not, so a deal
// could not be made underwritable from inside the product.
export const ESTIMATED_REPAIRS_ID = CONFIG.fields.estimatedRepairs;

// Board 4 carriers. Exported because the Dashboard and the Contact Workspace
// both read them; the WRITES go through the three named setters below.
export const CALL_DISPOSITION_ID = CONFIG.fields.callDisposition;
export const CALL_ROUTING_ID     = CONFIG.fields.callRouting;
export const DISPOSITION_AT_ID   = CONFIG.fields.dispositionAt;

/* Board #5 S3 — contact.occupancy_status. MULTIPLE_OPTIONS, three options,
   RULED SINGLE-SELECT. Ids read back live from both locations 2026-08-28. */
export const OCCUPANCY_STATUS_ID = CONFIG.fields.occupancyStatus;
/* Board #5 §4B — the CONTACT-side Asking Price. ⚠ READ-ONLY IN THIS TRANCHE.
   It is exported so the record row can LABEL its authority, never so it can be
   written: contact.asking_price is the FALLBACK carrier and §4B writes only the
   authoritative Opportunity value. No setter takes this id. */
export const CONTACT_ASKING_PRICE_ID = CONFIG.fields.askingPrice;

/**
 * The three options, as they exist on the field in BOTH locations (observed
 * 2026-08-28, identical in Production and Test). A union rather than `string`:
 * the setter below then cannot be handed a value the field does not offer.
 */
export type OccupancyStatus = "Owner Occupied" | "Tenant Occupied" | "Vacant";

/** Render order = the option order GHL returns. Not alphabetised. */
export const OCCUPANCY_OPTIONS: readonly OccupancyStatus[] = [
  "Owner Occupied",
  "Tenant Occupied",
  "Vacant",
] as const;

// Dashboard Phase 2B — GHL's public API cannot trigger an outbound call (it
// can only log one that already happened); the click-to-call button hands off
// to GHL's own contact page, where GHL's native dialer applies the Number's
// own softphone/forward config. Pure string builder, no network call.
export function ghlContactDetailUrl(contactId: string): string {
  return `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/contacts/detail/${contactId}`;
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ContactRow {
  id:                string;
  firstName:         string;
  lastName:          string;
  phone:             string;
  email:             string;
  address1:          string;
  city:              string;
  state:             string;
  postalCode:        string;
  dateAdded:         string | null;
  tags:              string[];
  // PB-D50 — GHL per-channel DND. Always an object; {} means no DND history.
  dndSettings:       Record<string, { status?: string; message?: string }>;
  motivationScore:   number | null;
  dealScore:         number | null;
  combinedScore:     number | null;
  completenessScore: number | null;
  // Contact-side offer_price (§14e) — non-null once a MAO offer has been saved
  // via the calculator. Read-only signal for the Dashboard's "Offers to review" tile.
  offerPrice:        number | null;
  // Dashboard Phase 2/3 fields (ISO strings). Both last_call_attempt and
  // callback_datetime are DATE-typed in GHL and truncate time-of-day on
  // write — each has a TEXT companion field carrying the exact value,
  // written in the same call; prefer the precise field, fall back to the
  // truncated DATE field only if it's ever missing.
  callbackDatetime:        string | null;
  callbackDatetimePrecise: string | null;
  lastCallAttempt:         string | null;
  lastCallAttemptPrecise:  string | null;
  // Contacts grid V1 (§5.1) — the deal's subject-property address, from the
  // contact.property_address custom field (tG4gGFI8JB2VjWeuqYMx). "" when the
  // field is absent. Surfaced by parseContact via the list read — no extra fetch.
  propertyAddress:         string;
  // PB-D53 — contact.phone_status, SINGLE_OPTIONS. Operational state of the
  // primary phone (NOT Phone Type's carrier line type). "" when unset, which
  // is the normal state; "Incorrect Number" excludes the contact from the Lead
  // Queue per PB-D54; "Callable" is set by the reset and does NOT exclude.
  phoneStatus:             string;
  /* Board 4 carriers. callDisposition/callRouting are SINGLE_OPTIONS and parse
     through cfString, so "" is the absent state, never null. dispositionAt is
     TEXT carrying an ISO instant and parses through cfText, so it is null when
     absent — the same shape as lastCallAttemptPrecise. */
  callDisposition:         string;
  callRouting:             string;
  dispositionAt:           string | null;
}

// ── Contacts surface (Phase A) types ──────────────────────────────────────────
// Read layer for the /contacts/:id detail view (CONTACTS_OPPORTUNITIES_SPEC.md
// §5.2 Phase A). Unlike ContactRow (a curated Dashboard subset), ContactDetail
// carries the native identity fields plus the SPARSE populated custom-field
// values from the wire — only the fields this contact has a value for (3 on
// bradt75), NOT all 96 — straight from GHL's single-record endpoint. Read-only.
// The all-96 SUPERSET (field definitions, order, folder headings, Additional
// Info subgroups) is the separate render-config layer from
// docs/CONTACT_FIELD_REFERENCE.md (a later step); the detail view joins the 96
// definitions against these sparse values to render all 96.

export interface ContactDetailField {
  id:    string;   // custom-field id — matches CONTACT_FIELD_REFERENCE.md Part 1
  value: unknown;  // GHL-typed value; the render layer formats per dataType
}

export interface ContactDetail {
  id:         string;
  firstName:  string;
  lastName:   string;
  email:      string;   // primary email — identity, read-only in edit (§4.3)
  phone:      string;   // primary phone — identity, read-only in edit (§4.3)
  address1:   string;   // address-identity block (§4.3) — country EXCLUDED
  city:       string;
  state:      string;
  postalCode: string;
  customFields: ContactDetailField[]; // sparse: only this contact's populated values (3 on bradt75), by id — NOT all 96
  dndSettings?: Record<string, { status?: string; message?: string }>;
}

// Render-config field definition (§5.4) — LIVE superset via GET /locations/{id}/customFields.
export interface CustomFieldDef {
  id: string;
  fieldKey: string;
  name: string;
  dataType: string;
  parentId: string;
  position: number;
}

// Folder record (§5.4) — resolved via GET /locations/{id}/customFields/{id}
// (documentType "folder"). The list endpoint carries only fields, not folders.
export interface CustomFieldFolder {
  id: string;
  name: string;
  documentType: string;
  position: number;
}

// Folder-record cache (§5.4) — module-scope, page-session lifetime. getFolder
// populates it; nothing clears or invalidates it.
const folderCache = new Map<string, CustomFieldFolder>();

// Contacts grid V1 row (§5.1 Grid layout) — the five displayed column fields
// (Name · Phone · Email · Property Address · Date Added) plus a NON-VISIBLE
// `id`. A read-only projection of ContactRow. `name` is firstName+lastName
// joined; listAll lowercases names (existing finding), so display-casing is the
// grid component's job, not this read.
export interface ContactGridRow {
  // NON-VISIBLE — carried only for the row → /contacts/:id link (§5.1 / §3 /
  // Workspace §8 step 2b) and React row keys. NOT a sixth column: do not render
  // it. The five displayed columns are unchanged, so the §5.3 grid assertions
  // and floor 122 are unaffected.
  id:              string;
  name:            string;      // firstName + lastName, joined; "" if both empty
  phone:           string;
  email:           string;
  propertyAddress: string;      // contact.property_address; "" when absent
  dateAdded:       string | null;
}

// ── Bucket tag helpers ────────────────────────────────────────────────────────
// Bucket tags (hot/warm/low) are written by the scoring function (motivation-score.ts)
// as the source of truth for tier assignment. This module only reads them.

export type BucketTag = "hot" | "warm" | "low";
const BUCKET_TAGS: BucketTag[] = ["hot", "warm", "low"];

export function getBucketTag(contact: ContactRow): BucketTag {
  return BUCKET_TAGS.find((t) => contact.tags.includes(t)) ?? "low";
}

export function isProbate(contact: ContactRow): boolean {
  return contact.tags.includes("probate");
}

// ── Mailer types ─────────────────────────────────────────────────────────────

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
  dueDate:         string;
  dueDateCT:       string;
  completed:       boolean;
  hasBusinessName: boolean;
  companyName:     string | null;
}

export interface MailerGroup {
  key:   string;
  label: string;
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
    byMailerType: Record<string, number>;
  };
}

// ── Conversations types ───────────────────────────────────────────────────────

export interface UnansweredInboundRow {
  conversationId:  string;
  contactId:       string;
  contactName:     string;
  phone:           string;
  email:           string;
  lastMessageDate: number;
  preview:         string;
  unreadCount:     number;
}

// Conversations phase — full thread-list row (read-only). Mirrors the
// ghl-conversations ?scope=all response. Superset of the unanswered row + the
// last message's direction so the inbox can show a sent/received hint.
export interface ThreadRow {
  conversationId:  string;
  contactId:       string;
  contactName:     string;
  phone:           string;
  email:           string;
  lastMessageDate: number;
  lastMessageDirection: string; // "inbound" | "outbound"
  preview:         string;
  unreadCount:     number;
}

// Contact Workspace §8 step 5 — per-contact message history (read-only). Mirrors
// the ghl-contact-conversations function's response shape. PENDING live shape
// confirmation (message field names) — see spec §8 step 5 open questions.
export interface ConvMessageRow {
  id:             string;
  conversationId: string;
  contactId:      string;
  direction:      string; // "inbound" | "outbound"
  channel:        string; // friendly label (SMS / Email / Call / …)
  messageType:    string; // raw GHL enum
  body:           string;
  dateAdded:      string; // ISO
}
export interface ContactConversations {
  contactId:         string;
  conversationCount: number;
  messages:          ConvMessageRow[];
}

// Calendars read view (CALENDARS_SPEC §3) — one appointment row. Mirrors the
// ghl-calendar-events response. `status` is the correctly-spelled
// appointmentStatus (never the misspelled appoinmentStatus GHL also ships).
export interface CalendarEventRow {
  id:             string;
  calendarId:     string;
  calendarName:   string;
  title:          string;
  startTime:      string; // ISO w/ tz, as GHL returns
  endTime:        string;
  status:         string;
  contactId:      string;
  assignedUserId: string;
  notes:          string;
}
export interface CalendarEventsResult {
  window:    { startTime: number; endTime: number };
  calendars: { id: string; name: string }[];
  events:    CalendarEventRow[];
}

// ── Pipeline types ────────────────────────────────────────────────────────────

export interface PipelineStage {
  id:       string;
  name:     string;
  position: number;
}

export interface OpportunityRow {
  id:              string;
  contactId:       string;
  contactName:     string;
  opportunityName: string;
  phone:           string;
  email:           string;
  stageId:         string;
  customFields:    { id: string; [key: string]: unknown }[];
}

export interface PipelineData {
  pipelineId:    string;
  stages:        PipelineStage[];
  opportunities: OpportunityRow[];
}

// ── Underwriting policy ───────────────────────────────────────────────────────

/**
 * One investor-policy Custom Value as the allowlisted endpoint returns it.
 * Structurally the resolver's PolicyValue: flat strings carrying no symbols
 * -- "10" not "10%", "5000" not "$5,000".
 */
export interface PolicyValueRow {
  id:    string;
  value: string;
}

export interface PolicyValuesResponse {
  values: PolicyValueRow[];
}

// ── Approve write, PB-D59 ─────────────────────────────────────────────────────

/**
 * Reads a custom-field value from a SINGULAR opportunity GET.
 *
 * ONE PARSER FOR EVERY dataType, and that is the finding it encodes.
 * OBSERVED 2026-08-17 across PB-D58 and PB-D59 Proofs A and B: the
 * singular `GET /opportunities/{id}` returns every custom-field value
 * under `fieldValue`, while the LIST endpoint varies by dataType --
 * `fieldValueNumber` for NUMERICAL, `fieldValueString` for
 * SINGLE_OPTIONS, each with a `type` key the singular shape omits.
 *
 *                    singular GET     list endpoint
 *   NUMERICAL        fieldValue       fieldValueNumber + type
 *   SINGLE_OPTIONS   fieldValue       fieldValueString + type
 *
 * DO NOT REUSE THE RESOLVER'S READERS HERE. `readNumberField` reads
 * `fieldValueNumber` only and `readStringField` reads
 * `fieldValueString ?? value`; against the singular shape both return
 * null, every carrier would report absent, and Approve would fail on a
 * write that actually succeeded -- silently, with a plausible message.
 * Both are correct for the list shape the Underwriting Workspace consumes
 * and must stay that way. Recorded in PB-D59 section III as amended.
 *
 * Strict about WHICH key, deliberately, following the resolver's
 * precedent: a value arriving under an unexpected key reads as absent
 * rather than being coalesced. That makes a wire-shape change visible as
 * a failed readback instead of silently working until it does not.
 */
function readSingularFieldValue(entry: any): number | string | null {
  if (entry === null || entry === undefined) return null;
  const raw = entry.fieldValue;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return raw;
  return null;
}

/**
 * Rounds a monetary output to cents before it is persisted.
 *
 * WHY THIS EXISTS, and it is a real gap rather than tidiness. Every
 * NUMERICAL value the PB-D58 and PB-D59 proofs put on the wire carried
 * exactly two decimal places -- 8271.31, 313370.42, 486210.73, 571204.86,
 * 398715.29 -- and each round-tripped byte-exact. What GHL does with a
 * full-precision float such as 145143.47283948 is NOT established by any
 * proof. `computeUnderwriting` produces exactly that: Seller MAO is a
 * division result, not a round number.
 *
 * Sending an unrounded float would step outside the proven serialization
 * envelope at the write boundary, and the readback comparison is strict
 * equality -- so a value GHL altered in the eighth decimal would report
 * as not landed, and Approve would fail on a write that succeeded.
 *
 * Cents are also the right persisted representation for currency. The
 * workspace already displays these to whole dollars, so no precision the
 * operator ever sees is lost.
 */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The three carriers Approve persists, PB-D59 section I. Exactly these,
 * never more: the opportunity name, stage, status, monetary value, tags,
 * the seven `offer_` fields and the deal-fact inputs are all excluded.
 *
 * `assignmentMode` carries one of PB-D56 section II's three option strings.
 * OBSERVED 2026-08-17 (PB-D59 Proof A): GHL stores this picklist by LABEL,
 * not by option id, so the literal string is what goes on the wire.
 */
export interface UnderwritingApproval {
  endBuyerMaxPrice: number;
  sellerMAO:        number;
  assignmentMode:   string;
}

/**
 * One carrier's readback outcome. Approve succeeds only when all three
 * report `landed: true` -- PB-D59 section III.
 */
export interface CarrierReadback {
  key:      keyof UnderwritingApproval;
  fieldId:  string;
  sent:     number | string;
  observed: number | string | null;
  landed:   boolean;
}

/**
 * What `saveUnderwritingFields` returns. `ok` is true only when every
 * carrier landed. A partial result is a FAILURE that names which carriers
 * did and did not land, per PB-D59 section IV -- it is reported, never
 * silently compensated.
 */
export interface UnderwritingWriteResult {
  ok:        boolean;
  putStatus: number;
  carriers:  CarrierReadback[];
  landed:    number;
}

// ── Transport (swap this block for OAuth in Phase B) ─────────────────────────

async function request<T = unknown>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${PROXY}?path=${encodeURIComponent(path)}`, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const ghl = {
  contacts: {
    // Returns all contacts with scores, paged server-side. Reads GHL's
    // eventually-consistent LIST endpoint — can lag/drop a record mid-reindex
    // (CONTACT_WORKSPACE_SPEC_v2.md §11). Prefer getOne() when you need one
    // contact fresh (e.g. right after a write).
    listAll: async (): Promise<ContactRow[]> => {
      const res = await fetch("/.netlify/functions/ghl-contacts");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-contacts → ${res.status}: ${text}`);
      }
      return res.json() as Promise<ContactRow[]>;
    },

    // Returns ONE parsed ContactRow from GHL's immediate single-record endpoint
    // (no list-index lag). Read-only. Same parser as listAll, so the shape is
    // identical. Used by the Contact Workspace so a reload right after a write
    // shows fresh data.
    getOne: async (id: string): Promise<ContactRow> => {
      const res = await fetch(`/.netlify/functions/ghl-contact?id=${encodeURIComponent(id)}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-contact → ${res.status}: ${text}`);
      }
      return res.json() as Promise<ContactRow>;
    },

    // Contacts surface Phase A (§5.2) — single-contact read for the /contacts/:id
    // detail view: native identity + the SPARSE populated custom-field values
    // from the wire (only the fields this contact has a value for — 3 on
    // bradt75; NOT the curated ContactRow, and NOT all 96). Read-only, via the
    // immediate single-record endpoint (GET /contacts/{id}). GHL omits unset
    // native keys (e.g. address on a contact with none — CONTACT_FIELD_REFERENCE
    // caveat 1), so each defaults to ""; customFields carries only populated
    // values. The all-96 SUPERSET (field definitions + render order) is the
    // separate render-config layer (CONTACT_FIELD_REFERENCE Part 1); the detail
    // view joins the 96 definitions against these sparse values to render all 96.
    getDetail: async (id: string): Promise<ContactDetail> => {
      const raw = await request<any>(`/contacts/${id}`);
      const c   = raw.contact ?? raw;
      return {
        id:         c.id,
        firstName:  c.firstName  ?? "",
        lastName:   c.lastName   ?? "",
        email:      c.email      ?? "",
        phone:      c.phone      ?? "",
        address1:   c.address1   ?? "",
        city:       c.city       ?? "",
        state:      c.state      ?? "",
        postalCode: c.postalCode ?? "",
        customFields: Array.isArray(c.customFields)
          ? c.customFields.map((f: any) => ({ id: f.id, value: f.value }))
          : [],
        dndSettings: c.dndSettings,
      };
    },

    // Contacts grid V1 (§5.1) — read-only projection of listAll() down to the
    // five displayed column fields (name / phone / email / propertyAddress /
    // dateAdded) plus a NON-VISIBLE id, carried only for the §5.1 line 166 row →
    // /contacts/:id link and the React row key (NOT a sixth column — do not
    // render it; the displayed columns and the §5.3 floor of 122 are unchanged).
    // Tolerates the carried transient — the list endpoint has
    // returned a blank/non-JSON body once this session, on which listAll()
    // throws (JSON.parse) — with ONE retry, then SURFACES the failure; never a
    // silent empty array.
    gridRows: async (): Promise<ContactGridRow[]> => {
      const toRow = (c: ContactRow): ContactGridRow => ({
        id:              c.id,
        name:            [c.firstName, c.lastName].filter(Boolean).join(" "),
        phone:           c.phone,
        email:           c.email,
        propertyAddress: c.propertyAddress,
        dateAdded:       c.dateAdded,
      });
      try {
        return (await ghl.contacts.listAll()).map(toRow);
      } catch (first) {
        try {
          return (await ghl.contacts.listAll()).map(toRow);
        } catch (second) {
          throw new Error(
            `contacts.gridRows: list read failed after one retry — ${second instanceof Error ? second.message : String(second)}`,
          );
        }
      }
    },
    list: (params?: Record<string, string>) => {
      const qs = new URLSearchParams({ locationId: LOCATION_ID, limit: "25", ...params }).toString();
      return request<any>(`/contacts?${qs}`);
    },
    get: (id: string) => request<any>(`/contacts/${id}`),

    // MAO Calculator Phase 6 "Save Offer to GHL" — writes ONLY the given custom
    // fields (the offer_ fields). Body carries nothing else: no tags key, so this
    // can never add/remove a tag (e.g. offer-made) as a side effect.
    saveOfferFields: (contactId: string, customFields: { id: string; field_value: unknown }[]) =>
      request<any>(`/contacts/${contactId}`, "PUT", { customFields }),

    // Dashboard Phase 2 — the note-is-the-attempt rule (spec §5). Still ONE
    // write action: a single PUT carrying exactly these two customFields
    // entries, nothing else (no tags/stage/offer_ keys). last_call_attempt is
    // DATE-typed in GHL and truncates time-of-day, so last_call_attempt_precise
    // (TEXT) rides along in the same call as the exact value our own read path
    // uses. Called exactly once, right after a note saves — never on its own,
    // never from a Call click.
    setLastCallAttempt: (contactId: string, iso: string) =>
      request<any>(`/contacts/${contactId}`, "PUT", {
        customFields: [
          { id: LAST_CALL_ATTEMPT_ID, field_value: iso },
          { id: LAST_CALL_ATTEMPT_PRECISE_ID, field_value: iso },
        ],
      }),

    // Dashboard Phase 3 — the schedule-callback control. Still ONE write
    // action: a single PUT carrying exactly these two customFields entries,
    // nothing else (no tags/stage/offer_ keys). callback_datetime is DATE-typed
    // in GHL and truncates time-of-day, so callback_datetime_precise (TEXT)
    // rides along in the same call as the exact value our own read path uses.
    // Pass null (not "") to clear both — GHL silently ignores an empty string.
    setCallbackDatetime: (contactId: string, iso: string | null) =>
      request<any>(`/contacts/${contactId}`, "PUT", {
        customFields: [
          { id: CALLBACK_DATETIME_ID, field_value: iso },
          { id: CALLBACK_DATETIME_PRECISE_ID, field_value: iso },
        ],
      }),

    // Phase B PB-D1 — the first authorized Class 1 app write and the fourth
    // named GHL write. ONE field per PUT: this body carries exactly one
    // customFields entry and nothing else (no tags/stage/offer_ keys).
    // property_notes is TEXT-typed. Unlike callback_datetime above, an empty
    // string is a REAL clear here: field_value "" removes the key from
    // customFields entirely (KEY_ABSENT, OBSERVED in the inert-proof). Do NOT
    // copy the null-to-clear pattern from setCallbackDatetime — that is
    // DATE-field behavior and does not apply to this field.
    setPropertyNotes: (contactId: string, value: string) =>
      request<any>(`/contacts/${contactId}`, "PUT", {
        customFields: [{ id: PROPERTY_NOTES_ID, field_value: value }],
      }),

    // PB-D16 — PRIVATE monetary transport BY CONVENTION, not by enforcement. It is
    // exported and reachable as ghl.contacts._putMonetaryField; the underscore is the
    // signal, not a barrier. The real guard is that no caller may use it except a
    // named per-field setter, admitted by its own decision.
    // §4.4 permits a private one-field PUT helper; a PUBLIC setter parameterized over
    // field ID is forbidden, because dataType proves serialization, not field safety
    // (§4.6: workflow triggers are per-field and not API-derivable). Each unlocked
    // MONETORY field earns its own named public method below by its own decision.
    // MONETORY write contract, OBSERVED 2026-07-28: an unquoted JS number is accepted
    // and round-trips exactly; "" clears to KEY_ABSENT.
    _putMonetaryField: (contactId: string, fieldId: string, value: number | "") =>
      request<any>(`/contacts/${contactId}`, "PUT", {
        customFields: [{ id: fieldId, field_value: value }],
      }),

    // PB-D16 — fifth named write. ARV only. Empty string is a real clear, not a skip.
    setARV: (contactId: string, value: number | "") =>
      ghl.contacts._putMonetaryField(contactId, ARV_ID, value),

    // Board item #2B — sixth named write. estimated_repairs only.
    //
    // A NAMED METHOD, NOT A PARAMETERIZED SETTER. PB-D16 §4.4 forbids a public
    // setter that takes a field id from the caller, because dataType proves
    // SERIALIZATION and not FIELD SAFETY (§4.6: workflow triggers are per-field
    // and are not API-derivable). So each unlocked MONETORY field earns its own
    // method by its own decision, and this is that decision for repairs. The UI
    // row component is shared with ARV — two consumers is the threshold — but
    // the setter is deliberately not.
    //
    // WRITE-SAFETY, PROVEN 2026-08-27 and narrow. GHL Advanced Filters with
    // Trigger Type = Contact Changed returned exactly one published workflow in
    // Production, `Seller - Reset Phone Status on Phone Change`, whose filter is
    // specifically "Phone has changed". No generic contact-field-change workflow
    // exists in the location, so writing this field enrols no contact in any
    // workflow by virtue of the field changing. THAT CLEARANCE COVERS THE
    // Contact Changed TRIGGER TYPE ONLY. It does not extend to DATE fields under
    // Custom Date Reminder. Irrelevant here — this field is MONETORY — but do
    // not generalise it to the next unlock.
    //
    // MONETORY contract is ARV's, unchanged: an unquoted JS number round-trips
    // exactly and "" clears to KEY_ABSENT. Do NOT copy setCallbackDatetime's
    // null-to-clear — that is DATE behavior and does not apply here.
    setEstimatedRepairs: (contactId: string, value: number | "") =>
      ghl.contacts._putMonetaryField(contactId, ESTIMATED_REPAIRS_ID, value),

    // Board 4 — PRIVATE string transport, the exact counterpart to
    // _putMonetaryField above and permitted by the same §4.4 sentence: "a
    // private one-field PUT helper" is allowed; a PUBLIC setter parameterized
    // over field ID is not. Three named setters below each spend their own
    // decision. setPropertyNotes predates this and is deliberately NOT
    // converted — that would be a refactor, not this commit's business.
    _putStringField: (contactId: string, fieldId: string, value: string) =>
      request<any>(`/contacts/${contactId}`, "PUT", {
        customFields: [{ id: fieldId, field_value: value }],
      }),

    // Board 4 — the three carrier writes. Each is a named public method by its
    // own decision; none takes a field id from the caller.
    //
    // ⚠ NOTHING CALLS THESE YET. S2 is inert plumbing: the carriers exist, the
    // setters exist, and no UI path reaches them until S3.
    //
    // ⚠ EMPTY IS NOT A CLEAR HERE, AND IT IS NOT MEASURED. GHL's ""-clears-to-
    // KEY_ABSENT behaviour is OBSERVED for TEXT and MONETORY only; SINGLE_OPTIONS
    // has never been measured. No caller writes "" to either select field —
    // "Stay in Cold Outreach" is an explicit value precisely so that clearing is
    // never required. Do not add a clear path on the assumption that it works.
    setCallDisposition: (contactId: string, value: string) =>
      ghl.contacts._putStringField(contactId, CALL_DISPOSITION_ID, value),

    setCallRouting: (contactId: string, value: string) =>
      ghl.contacts._putStringField(contactId, CALL_ROUTING_ID, value),

    // The bell. An ISO instant, written LAST in the disposition sequence, and
    // the trigger the four migrated workflows watch. TEXT, not DATE.
    setDispositionAt: (contactId: string, iso: string) =>
      ghl.contacts._putStringField(contactId, DISPOSITION_AT_ID, iso),

    /* Board #5 S3 — PRIVATE options transport, the counterpart to
       _putMonetaryField and _putStringField and permitted by the same PB-D16
       §4.4 sentence: a private one-field PUT helper is allowed, a PUBLIC setter
       parameterized over field ID is not.

       ⚠ THIS HELPER CARRIES NO CARDINALITY OPINION. It sends whatever array it
       is given. Deciding that occupancy is one element is the named setter's
       job below, because that is a ruling about ONE FIELD and not a property of
       MULTIPLE_OPTIONS. A future multi-valued field would pass a longer array
       through this same helper and would need its OWN named setter and its OWN
       ruling. Do not add a `single` flag here and do not branch on dataType. */
    _putOptionsField: (contactId: string, fieldId: string, value: string[] | "") =>
      request<any>(`/contacts/${contactId}`, "PUT", {
        customFields: [{ id: fieldId, field_value: value }],
      }),

    /* Board #5 S3 — occupancy_status. A named method by its own decision; it
       takes no field id from the caller.
       ⚠ NOTHING CALLS THIS YET. S3a is inert plumbing: the id exists, the
       setter exists, and no UI path reaches it until S3b.

       THE WIRE CONTRACT, and the only part of MULTIPLE_OPTIONS that is proven:
         selected -> a ONE-ELEMENT ARRAY   ["Vacant"]
         clear    -> ""                     (empty string, NOT an empty array)
       Both were exercised through the four-stage inert-proof runner on two
       contacts — PB-D37/D38 on probe HGZAby6snRZfpl0go2Yb and PB-D40/D41 on
       bradt75. FIELD_REGISTER records the asymmetry that makes the clear value
       matter: "empty string -> KEY_ABSENT; empty array leaves the key present".
       An empty array does NOT clear the field. Do not "simplify" "" to [].

       MULTI-ELEMENT SERIALIZATION IS NOT PROVEN AND IS NOT USED HERE. The
       single-option parameter is what keeps this setter inside what was
       measured. */
    setOccupancyStatus: (contactId: string, value: OccupancyStatus | "") =>
      ghl.contacts._putOptionsField(
        contactId,
        OCCUPANCY_STATUS_ID,
        value === "" ? "" : [value],
      ),
  },

  notes: {
    // Dashboard Phase 2 — the ONLY note-write path. Always a NEW note, never
    // an overwrite/edit of a prior one (GHL has no "edit" call site here).
    create: (contactId: string, body: string) =>
      request<any>(`/contacts/${contactId}/notes`, "POST", { body }),

    // Contact Workspace §8 step 2 — READ-ONLY note history. GET only; not a
    // write, does not touch the three-write invariant. Returns GHL's
    // { notes: [{ id, body, dateAdded, ... }] } shape verbatim (no shadow copy).
    list: (contactId: string) =>
      request<{ notes?: { id: string; body: string; dateAdded: string }[] }>(
        `/contacts/${contactId}/notes`,
      ),
  },

  customFields: {
    list: () => request<{ customFields: CustomFieldDef[] }>(`/locations/${LOCATION_ID}/customFields`),
    // Folder record (§5.4) — cache-first (module-scope folderCache, page-session
    // lifetime). Returns the cached record if present; otherwise fetches, caches,
    // and returns. Never clears/invalidates.
    getFolder: async (id: string): Promise<CustomFieldFolder> => {
      const cached = folderCache.get(id);
      if (cached) return cached;
      const body = await request<{ customField: CustomFieldFolder }>(`/locations/${LOCATION_ID}/customFields/${id}`);
      folderCache.set(id, body.customField);
      return body.customField;
    },
  },

  pipelines: {
    list: () => request<any>(`/opportunities/pipelines?locationId=${LOCATION_ID}`),
  },

  opportunities: {
    list: (params?: Record<string, string>) => {
      const qs = new URLSearchParams({ location_id: LOCATION_ID, ...params }).toString();
      return request<any>(`/opportunities/search?${qs}`);
    },
    get: (id: string) => request<any>(`/opportunities/${id}`),
    // create: (data: unknown) => request("/opportunities/", "POST", data),

    // Returns Seller Leads Pipeline opportunities + stage list, paged server-side
    listPipeline: async (): Promise<PipelineData> => {
      const res = await fetch("/.netlify/functions/ghl-opportunities");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-opportunities → ${res.status}: ${text}`);
      }
      return res.json() as Promise<PipelineData>;
    },

    // The ONLY write action in the Pipeline page. Goes through GHL's standard
    // opportunity-update API (PUT /opportunities/:id) so GHL's own stage-change
    // triggers fire exactly as they would from a manual move inside GHL — this
    // never bypasses those triggers.
    updateStage: (opportunityId: string, pipelineId: string, pipelineStageId: string) =>
      request<any>(`/opportunities/${opportunityId}`, "PUT", { pipelineId, pipelineStageId }),

    // MAO Calculator Phase 6 "Save Offer to GHL" — writes ONLY the given custom
    // fields (the offer_ fields). Body carries nothing else: no pipelineStageId
    // key, so this can never move the pipeline stage as a side effect — that
    // stays tied to the deliberate Pipeline-page "Move to" action (V7 §14d).
    saveOfferFields: (opportunityId: string, customFields: { id: string; field_value: unknown }[]) =>
      request<any>(`/opportunities/${opportunityId}`, "PUT", { customFields }),
    /**
     * Board #5 §4B — the Opportunity Asking Price setter. ONE FIELD, NAMED.
     *
     * ⚠ NOT A GENERALIZED OPPORTUNITY SETTER. PB-D16 §4.4 forbids a PUBLIC
     * setter parameterized over field id; this one names its field and cannot
     * be pointed at another. A second field owes a second named setter and its
     * own inert proof -- PB-D58 §IV, and PB-D60 restated it: three proven
     * opportunity fields do not prove a fourth.
     *
     * ⚠ CUSTOM-FIELDS-ONLY BODY. No pipelineStageId, no status, no name, no
     * monetaryValue, no tags. PB-D58 §II: "That is the mechanism the whole
     * proof rests on, and a PUT body carrying anything else forfeits it."
     *
     * ⚠ READBACK IS THE SINGULAR GET, PARSED BY readSingularFieldValue -- AND
     * THE RESOLVER'S READERS MAY NOT BE USED HERE. PB-D60 reproduced the
     * hazard against a live payload with a positive control: the singular GET
     * returned this very field under `fieldValue` with no `fieldValueNumber`,
     * and resolver.ts's readNumberField returned undefined against that same
     * PRESENT entry ("listShapedReaderWouldMisreadAsAbsent": true). A
     * list-shaped reader here would report a landed write as failed and -- the
     * sharper failure -- would report a failed restoration as cleared, because
     * a reader that calls everything absent cannot tell CLEARED from UNCHANGED.
     *
     * ⚠ NOTHING CONTACT-SCOPED APPEARS IN THIS PATH. The write and the readback
     * are both the opportunity object. Do NOT verify through
     * ghl.contacts.getDetail the way MonetaryRow does -- that is the right
     * parser on the wrong object, and it is a separate failure from the one
     * above. Neither guard catches the other.
     *
     * ⚠ THIS WRITES THE AUTHORITATIVE VALUE AND NOTHING ELSE. It must never be
     * paired with a write to contact.asking_price. The two carriers have
     * precedence (resolver.ts:329), deliberately; synchronizing them would
     * destroy the fallback's meaning and is forbidden in this tranche.
     *
     * `value === null` CLEARS, via `field_value: ""` -- the mechanism PB-D58
     * §VI OBSERVED and PB-D60 reproduced on this field, clearing to KEY_ABSENT.
     * Success is then the id being GONE from customFields, not an entry
     * carrying "" or 0: PB-D24 makes those different states.
     *
     * VALIDATION IS FINITENESS ONLY, matching the existing precedent for
     * monetary writes in this file. ⚠ No upper bound is imposed here. There is
     * none anywhere in this codebase today, and §4B is not authorized to
     * introduce one -- that is a product decision, and inventing a bound to
     * suit a proof would be a guard bent for the test.
     *
     * A 200 IS NOT SUCCESS. The caller must check `ok`.
     */
    setAskingPrice: async (
      opportunityId: string,
      value: number | null,
    ): Promise<{ ok: boolean; putStatus: number; sent: number | ""; observed: number | string | null }> => {
      const fieldId = CONFIG.opportunityFacts.askingPrice;
      if (!fieldId) throw new Error("setAskingPrice: no configured id for opportunityFacts.askingPrice");

      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error(
          `setAskingPrice: ${JSON.stringify(value)} is not a finite number. ` +
            "Refusing rather than writing a value the readback cannot compare.",
        );
      }

      /* Rounded BEFORE the request, so the strict-equality readback below
         compares the value that was actually sent. Comparing an unrounded
         input against a rounded stored value would fail a write that landed. */
      const sent: number | "" = value === null ? "" : roundCurrency(value);

      const body = { customFields: [{ id: fieldId, field_value: sent }] };

      const putRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const putStatus = putRes.status;
      if (!putRes.ok) {
        const text = await putRes.text();
        throw new Error(`setAskingPrice PUT → ${putStatus}: ${text}`);
      }

      const readRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`);
      if (!readRes.ok) {
        const text = await readRes.text();
        throw new Error(`setAskingPrice readback → ${readRes.status}: ${text}`);
      }
      const readBody = await readRes.json();
      const opp = readBody.opportunity ?? readBody;
      /* STRUCTURAL absence -- the id gone from the array -- never a parser
         returning undefined. A mis-shaped parser cannot manufacture absence
         out of a key that is present, which is the whole protection. */
      const entry = (opp.customFields ?? []).find((f: any) => f.id === fieldId) ?? null;
      const observed = entry === null ? null : readSingularFieldValue(entry);

      const ok = sent === "" ? entry === null : observed === sent;
      return { ok, putStatus, sent, observed };
    },

    /** PB-D62 / INV-25 — one named writer for the authoritative deal ARV. */
    setApprovedArv: async (
      opportunityId: string,
      value: number,
    ): Promise<{ ok: boolean; putStatus: number; sent: number; observed: number | string | null }> => {
      const fieldId = CONFIG.opportunityFacts.arv;
      if (!fieldId) throw new Error("setApprovedArv: no configured id for opportunityFacts.arv");
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error("setApprovedArv: value must be a positive finite number");
      }

      const sent = roundCurrency(value);
      const body = { customFields: [{ id: fieldId, field_value: sent }] };
      const putRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const putStatus = putRes.status;
      if (!putRes.ok) {
        const text = await putRes.text();
        throw new Error(`setApprovedArv PUT → ${putStatus}: ${text}`);
      }

      const readRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`);
      if (!readRes.ok) {
        const text = await readRes.text();
        throw new Error(`setApprovedArv readback → ${readRes.status}: ${text}`);
      }
      const readBody = await readRes.json();
      const opportunity = readBody.opportunity ?? readBody;
      const entry = (opportunity.customFields ?? [])
        .find((field: any) => field.id === fieldId) ?? null;
      const observed = entry === null ? null : readSingularFieldValue(entry);
      return { ok: entry !== null && observed === sent, putStatus, sent, observed };
    },
  },

  conversations: {
    // Dashboard §2.1 — conversations whose last message is inbound with no
    // outbound reply since, oldest first. Read-only: GET /conversations/search.
    unansweredInbound: async (): Promise<UnansweredInboundRow[]> => {
      const res = await fetch("/.netlify/functions/ghl-conversations");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-conversations → ${res.status}: ${text}`);
      }
      return res.json() as Promise<UnansweredInboundRow[]>;
    },

    // Conversations phase — full thread list (every conversation, newest first),
    // read-only. Opts into the unfiltered branch via ?scope=all on the SAME
    // function; no new endpoint (default stays unanswered-filtered above).
    threads: async (): Promise<ThreadRow[]> => {
      const res = await fetch("/.netlify/functions/ghl-conversations?scope=all");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-conversations?scope=all → ${res.status}: ${text}`);
      }
      return res.json() as Promise<ThreadRow[]>;
    },

    // Contact Workspace §8 step 5 — ONE contact's message history, oldest→newest,
    // read-only. Scoped by explicit contactId via the CONVERSATIONS API (search
    // by contactId → that conversation's messages); never the contacts list
    // endpoint, so it does not inherit §11's listAll lag/drop. No writes.
    forContact: async (contactId: string): Promise<ContactConversations> => {
      const res = await fetch(`/.netlify/functions/ghl-contact-conversations?id=${encodeURIComponent(contactId)}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-contact-conversations → ${res.status}: ${text}`);
      }
      return res.json() as Promise<ContactConversations>;
    },
  },

  calendars: {
    // Calendars read view (CALENDARS_SPEC §3) — appointments across the location's
    // calendars for a window, read-only. The server fans over each calendarId.
    // Pass an explicit window (ms epoch); the server defaults to now → +30 days.
    events: async (startTime?: number, endTime?: number): Promise<CalendarEventsResult> => {
      const qs = new URLSearchParams();
      if (startTime != null) qs.set("startTime", String(startTime));
      if (endTime   != null) qs.set("endTime",   String(endTime));
      const url = `/.netlify/functions/ghl-calendar-events${qs.toString() ? `?${qs}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-calendar-events → ${res.status}: ${text}`);
      }
      return res.json() as Promise<CalendarEventsResult>;
    },
  },

  mailers: {
    // Shared query — this-week-ready / business-flagged / overdue / no-address
    list: async (): Promise<MailerDigest> => {
      const res = await fetch("/.netlify/functions/ghl-mailers");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-mailers → ${res.status}: ${text}`);
      }
      return res.json() as Promise<MailerDigest>;
    },

    // The ONLY write action on the Mailers page. Body carries nothing but
    // { completed: true }, sent to GHL's dedicated task-completion sub-resource,
    // so it cannot touch the task's title/dueDate/assignedTo, or any
    // contact/tag/pipeline field.
    completeTask: (contactId: string, taskId: string) =>
      request<any>(`/contacts/${contactId}/tasks/${taskId}/completed`, "PUT", { completed: true }),
  },

  underwriting: {
    // PB-D57 -- the allowlisted investor-policy read. Returns ONLY the
    // eleven Custom Values named in shared config, never the collection.
    // The endpoint filters server-side by positive allowlist; this client
    // does no filtering of its own and must not start.
    //
    // Response shape is the resolver's PolicyValue[] contract, so the
    // result feeds parsePolicy directly. Parsing, unit conversion and
    // malformed-vs-absent handling stay in parsePolicy -- nothing here
    // interprets a value.
    //
    // `policy` is read-only and must never acquire a write path.
    // Underwriting mutations are exposed separately through explicitly
    // named methods in this namespace -- see saveUnderwritingFields below.
    policy: async (): Promise<PolicyValuesResponse> => {
      const res = await fetch("/.netlify/functions/ghl-underwriting-policy");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-underwriting-policy → ${res.status}: ${text}`);
      }
      return res.json() as Promise<PolicyValuesResponse>;
    },

    /**
     * PB-D59 -- the Approve write. THE ONLY PATH by which underwriting is
     * persisted. No component composes its own PUT and no generic write
     * helper is reused; this method exists so that every underwriting
     * write is one grep away from being found.
     *
     * ONE PUT CARRYING ALL THREE CARRIERS, custom-fields-only. Not three
     * PUTs: three requests would triple the window in which a partial
     * state is visible and would require compensating writes on failure
     * at the second or third. The body is built from the three ids below
     * and nothing else -- a body carrying pipelineStageId, status, name,
     * monetaryValue or tags forfeits the mechanism the whole write rests
     * on, which is that a custom-fields-only PUT cannot fire stage
     * triggers.
     *
     * READBACK PARSES `fieldValue`. OBSERVED 2026-08-17 across PB-D58 and
     * PB-D59 Proofs A and B: the singular GET returns every dataType under
     * `fieldValue`, while the LIST endpoint varies -- `fieldValueNumber`
     * for NUMERICAL, `fieldValueString` for SINGLE_OPTIONS. Neither
     * `readNumberField` nor `readStringField` in the resolver may be used
     * here: against the singular shape both return null, all three
     * carriers would report absent, and Approve would fail on a write that
     * actually succeeded.
     *
     * A 200 IS NOT SUCCESS. It means the server accepted a request.
     * Success is all three carriers confirmed on readback, and the caller
     * must check `ok` rather than assuming the absence of a throw means
     * the underwriting is durable.
     *
     * NO COMPENSATING WRITE ON PARTIAL. PB-D59 section IV: GHL documents
     * no transaction and this method does not pretend otherwise. A partial
     * result is returned with per-carrier detail so the caller can report
     * which fields landed. Reverting a partially applied field would
     * itself be a mutation and is not attempted here.
     *
     * Proven inert on a disposable fixture before this method existed:
     * PB-D58 section II, PB-D59 Proofs A0, A and B. Twenty proof steps,
     * ten mutations, every one restored.
     */
    saveUnderwritingFields: async (
      opportunityId: string,
      approval: UnderwritingApproval,
    ): Promise<UnderwritingWriteResult> => {
      const ids = CONFIG.opportunityFields;

      /* The two monetary carriers are rounded to cents BEFORE the plan is
         built, so `plan` holds what is actually persisted. Everything
         downstream reads from it -- the request body, the `sent` field of
         each readback, and the strict equality that sets `landed`. A
         partial report therefore names the figure Approve sent, never the
         higher-precision figure compute produced internally. Confusing
         those two would make a failure report unactionable. */
      const plan: { key: keyof UnderwritingApproval; fieldId: string; value: number | string }[] = [
        { key: "endBuyerMaxPrice", fieldId: ids.endBuyerMaxPrice, value: roundCurrency(approval.endBuyerMaxPrice) },
        { key: "sellerMAO",        fieldId: ids.sellerMAO,        value: roundCurrency(approval.sellerMAO) },
        { key: "assignmentMode",   fieldId: ids.assignmentMode,   value: approval.assignmentMode },
      ];

      /* The finiteness guards read the INPUT, not the plan. roundCurrency
         of NaN is NaN and of Infinity is Infinity, so guarding after the
         rounding would let either through as a plan value and onto the
         wire. */
      if (typeof approval.endBuyerMaxPrice !== "number" || !Number.isFinite(approval.endBuyerMaxPrice)) {
        throw new Error("saveUnderwritingFields: endBuyerMaxPrice must be a finite number");
      }
      if (typeof approval.sellerMAO !== "number" || !Number.isFinite(approval.sellerMAO)) {
        throw new Error("saveUnderwritingFields: sellerMAO must be a finite number");
      }

      // Guards on the payload itself, before it is sent. Each protects a
      // property PB-D59 requires and none is redundant with the others.
      for (const p of plan) {
        if (!p.fieldId) throw new Error(`saveUnderwritingFields: no configured id for ${p.key}`);
        if (p.value === "" || p.value === null || p.value === undefined) {
          throw new Error(`saveUnderwritingFields: ${p.key} is empty; this method clears nothing`);
        }
      }
      if (typeof approval.assignmentMode !== "string") {
        throw new Error("saveUnderwritingFields: assignmentMode must be a string");
      }
      if (new Set(plan.map((p) => p.fieldId)).size !== 3) {
        throw new Error("saveUnderwritingFields: the three carrier ids are not distinct");
      }

      const body = { customFields: plan.map((p) => ({ id: p.fieldId, field_value: p.value })) };

      const putRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const putStatus = putRes.status;
      if (!putRes.ok) {
        const text = await putRes.text();
        throw new Error(`saveUnderwritingFields PUT → ${putStatus}: ${text}`);
      }

      // Readback on the SINGULAR GET, parsing fieldValue. Not the list
      // endpoint, whose shape varies by dataType.
      const readRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`);
      if (!readRes.ok) {
        const text = await readRes.text();
        throw new Error(`saveUnderwritingFields readback → ${readRes.status}: ${text}`);
      }
      const readBody = await readRes.json();
      const opp = readBody.opportunity ?? readBody;
      const byId = new Map<string, any>((opp.customFields ?? []).map((f: any) => [f.id, f]));

      const carriers: CarrierReadback[] = plan.map((p) => {
        const entry = byId.get(p.fieldId) ?? null;
        const observed = entry === null ? null : readSingularFieldValue(entry);
        return {
          key: p.key,
          fieldId: p.fieldId,
          sent: p.value,
          observed,
          landed: observed === p.value,
        };
      });

      const landed = carriers.filter((c) => c.landed).length;
      return { ok: landed === 3, putStatus, carriers, landed };
    },

    /**
     * Board item #2C -- set Assignment Mode alone, BEFORE underwriting resolves.
     *
     * WHY THIS IS NOT saveUnderwritingFields. That method writes all three
     * carriers in one PUT and is only reachable on a RESOLVED deal, because two
     * of its three values are figures the calculation produced. Assignment Mode
     * is the opposite case: it is a deal FACT with no starter fallback and no
     * policy value that can supply it, so an unset mode is itself what leaves
     * underwriting unresolved. A method that can only run after resolution
     * cannot fix the thing that prevents resolution. Modelled on it; not reused.
     *
     * CUSTOM-FIELDS-ONLY, and this is the load-bearing property. The body
     * carries `customFields` and nothing else. A body carrying pipelineStageId,
     * status, name, monetaryValue or tags forfeits the mechanism the whole
     * write rests on -- that a custom-fields-only PUT cannot fire stage
     * triggers. Do not add a key here for convenience.
     *
     * ONE FIELD, and the value is checked against the declared option labels
     * BEFORE the request. GHL's field is a picker; a string it does not offer
     * is not a value it stores, and the resolver parses the label back through
     * MODE_BY_OPTION. Rejecting locally means a typo fails as a typo instead of
     * as an unexplained unresolved deal.
     *
     * A 200 IS NOT SUCCESS. It means the server accepted a request. Success is
     * the value confirmed on readback, and the caller must check `ok`.
     *
     * READBACK USES THE SINGULAR GET, parsing `fieldValue` via
     * readSingularFieldValue. The singular and list endpoints return different
     * wire shapes -- OBSERVED 2026-08-17, the list varies by dataType
     * (fieldValueString for SINGLE_OPTIONS) while the singular does not. The
     * three readers in this file are not interchangeable, and reading the wrong
     * one here would report a failure on a write that succeeded.
     *
     * The proxy already allowlists PUT /opportunities/{ID}. No proxy change.
     */
    setAssignmentMode: async (
      opportunityId: string,
      optionLabel: string,
    ): Promise<{ ok: boolean; putStatus: number; sent: string; observed: number | string | null }> => {
      const fieldId = CONFIG.opportunityFields.assignmentMode;
      if (!fieldId) throw new Error("setAssignmentMode: no configured id for assignmentMode");

      const allowed = ASSIGNMENT_MODE_OPTIONS.map(([label]) => label);
      if (typeof optionLabel !== "string" || !allowed.includes(optionLabel)) {
        throw new Error(
          `setAssignmentMode: ${JSON.stringify(optionLabel)} is not one of the declared ` +
            `Assignment Mode options (${allowed.map((l) => JSON.stringify(l)).join(", ")}). ` +
            "Refusing rather than writing a label the resolver cannot read back.",
        );
      }

      const body = { customFields: [{ id: fieldId, field_value: optionLabel }] };

      const putRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const putStatus = putRes.status;
      if (!putRes.ok) {
        const text = await putRes.text();
        throw new Error(`setAssignmentMode PUT → ${putStatus}: ${text}`);
      }

      const readRes = await fetch(`${PROXY}?path=${encodeURIComponent(`/opportunities/${opportunityId}`)}`);
      if (!readRes.ok) {
        const text = await readRes.text();
        throw new Error(`setAssignmentMode readback → ${readRes.status}: ${text}`);
      }
      const readBody = await readRes.json();
      const opp = readBody.opportunity ?? readBody;
      const entry = (opp.customFields ?? []).find((f: any) => f.id === fieldId) ?? null;
      const observed = entry === null ? null : readSingularFieldValue(entry);

      return { ok: observed === optionLabel, putStatus, sent: optionLabel, observed };
    },

  },
};

