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

const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const PROXY       = "/.netlify/functions/ghl-proxy";

// Dashboard Phase 2 — confirmed live via /locations/.../customFields (both
// DATE type, contact model). last_call_attempt is the ONLY field this module
// writes outside the already-established offer_/stage/task write paths.
const LAST_CALL_ATTEMPT_ID = "lGoNXM9Wrte4m7ShwQPT";

// Companion TEXT field — same DATE-truncation bug as callback_datetime
// (confirmed live: a note saved ~15min prior displayed as "Attempted 16h
// ago" because the DATE field truncates to midnight UTC). last_call_attempt
// is still written for GHL's own UI; this field is our own read path's
// source of truth. Written in the SAME PUT as last_call_attempt — no new
// write action, still inside the three-write invariant.
const LAST_CALL_ATTEMPT_PRECISE_ID = "2vz1igGMxF3wv7HaWm97";

// Dashboard Phase 3 — the third and last scoped write (spec guardrails).
// DATE type, contact model, same ID already used for the read side (§14f note:
// this field predates Phase 3's write — Build 2A only read it).
const CALLBACK_DATETIME_ID = "JeQWtwpwUbvPA50UfuPU";

// Companion TEXT field — GHL's DATE type silently truncates time-of-day on
// write (confirmed live: a 2pm CT callback round-tripped as "Jul 14, 7pm").
// callback_datetime is still written for GHL's own UI, but this field is our
// own read path's source of truth so overdue/today bucketing survives a
// reload. Written in the SAME PUT as callback_datetime — no new write action.
const CALLBACK_DATETIME_PRECISE_ID = "7qRUkZQK8bi2HNo7zDHd";

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
    // Returns all contacts with scores, paged server-side
    listAll: async (): Promise<ContactRow[]> => {
      const res = await fetch("/.netlify/functions/ghl-contacts");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-contacts → ${res.status}: ${text}`);
      }
      return res.json() as Promise<ContactRow[]>;
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
    list: () => request<any>(`/locations/${LOCATION_ID}/customFields`),
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
};

