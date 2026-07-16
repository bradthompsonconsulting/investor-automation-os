/**
 * GHL call-disposition capture — server-side webhook receiver (§8 step 6,
 * CONTACT_WORKSPACE_SPEC_v2.md §5.4 Path A + §6).
 *
 * GHL Workflow (trigger: Call details / Custom disposition, all six values;
 * action: the FREE standard Webhook, not Custom Webhook) POSTs here with a
 * customData block and an X-IAOS-Secret header:
 *
 *   POST /.netlify/functions/ghl-disposition
 *   headers: { "X-IAOS-Secret": "<from a GHL Custom Value>" }
 *   body:    { "customData": { "disposition": "Voicemail",
 *                              "contact_id": "…", "duration": "28" }, … }
 *
 * On a valid, authenticated fire this performs EXACTLY TWO of the three
 * sanctioned writes (§4), scoped to customData.contact_id, in gated order:
 *   1. notes.create   POST /contacts/{id}/notes   "Call: {disposition} — {duration}s"
 *   2. setLastCallAttempt  PUT /contacts/{id}      last_call_attempt(+_precise), ONE call
 * The note is the human record; the FRESH last_call_attempt is what greys the
 * row (§6 MECHANISM — notes are NOT read by the grey computation). Order is
 * note→attempt so a failure can never grey a row with no record behind it.
 *
 * NO tags, pipeline stage, offer_ fields, or workflow triggers — hard No (§4).
 * IAOS only RECEIVES this webhook; it never triggers one (§5.5 invariant ruling).
 *
 * Auth: unlike the read-only, browser-facing functions (whose auth Brad deferred
 * while single-tenant — a bundled secret isn't a secret), this is a server-to-
 * server WRITE endpoint whose secret lives server-side. Without it, anyone who
 * knows the URL could forge notes + attempts onto real seller records. So it
 * verifies X-IAOS-Secret (constant-time) from day one; 401 otherwise.
 */

import { createHash, timingSafeEqual } from "crypto";
import { LAST_CALL_ATTEMPT_ID, LAST_CALL_ATTEMPT_PRECISE_ID } from "./lib/contact-parse";

const GHL_BASE = "https://services.leadconnectorhq.com";

// A retry (GHL backs off and re-fires on any non-2xx) must not double-write the
// note. We dedupe by reading the contact's recent notes for the exact body we're
// about to write, within this window — wide enough to cover GHL's backoff, at
// the accepted cost of collapsing two genuinely-identical dispositions to the
// same seller inside the window into one note (rare; the attempt still re-marks).
const DEDUPE_WINDOW_MS = 15 * 60 * 1000;

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Version: "2021-07-28" };
}
function writeHeaders(token: string) {
  return { ...authHeaders(token), "Content-Type": "application/json" };
}

// Constant-time secret compare. Hash both sides to a fixed 32 bytes so
// timingSafeEqual never throws on a length mismatch and no length is leaked.
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// GHL's DATE fields truncate time-of-day, so last_call_attempt_precise (TEXT)
// carries the exact ISO string in the SAME PUT. Both ride one call → one write.
async function markAttempt(token: string, contactId: string, iso: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: writeHeaders(token),
    body: JSON.stringify({
      customFields: [
        { id: LAST_CALL_ATTEMPT_ID,         field_value: iso },
        { id: LAST_CALL_ATTEMPT_PRECISE_ID, field_value: iso },
      ],
    }),
  });
  if (!res.ok) throw new Error(`PUT /contacts/${contactId} (attempt) → ${res.status}: ${await res.text()}`);
}

async function createNote(token: string, contactId: string, body: string): Promise<void> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: "POST",
    headers: writeHeaders(token),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`POST /contacts/${contactId}/notes → ${res.status}: ${await res.text()}`);
}

// True if an identical note already exists within the dedupe window (i.e. this
// is a retry). On a READ failure we deliberately return false — "favor greying"
// (Brad): a rare duplicate note is recoverable; a stranded un-greyed row is the
// catastrophic failure, so we proceed to write rather than bail.
async function noteAlreadyWritten(token: string, contactId: string, body: string): Promise<boolean> {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, { headers: authHeaders(token) });
    if (!res.ok) return false;
    const json = await res.json();
    const notes: any[] = json?.notes ?? [];
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    return notes.some(
      (n) => n?.body === body && new Date(n?.dateAdded ?? 0).getTime() >= cutoff,
    );
  } catch {
    return false; // favor greying — see above
  }
}

type WriteResult =
  | { ok: true;  noteWritten: boolean }
  | { ok: false; stage: "note" | "attempt"; error: string };

// The gated sequence. Dedupe → note → attempt, each gating the next. Returns
// which stage failed so the handler can pick the status code that drives GHL's
// retry (2xx only when BOTH landed; non-2xx otherwise).
async function writeDisposition(
  token: string, contactId: string, noteBody: string,
): Promise<WriteResult> {
  // 1. Note (skipped iff a retry already wrote it) — the human record.
  let noteWritten = false;
  if (!(await noteAlreadyWritten(token, contactId, noteBody))) {
    try {
      await createNote(token, contactId, noteBody);
      noteWritten = true;
    } catch (e) {
      // Nothing partial yet — no attempt written. Non-2xx → GHL retries cleanly.
      return { ok: false, stage: "note", error: (e as Error).message };
    }
  }

  // 2. Attempt — the ONLY thing that greys. Gated behind the note existing.
  //    If THIS fails, the note is on record but the row will NOT grey. We must
  //    NOT return 2xx here (that would strand the lead un-greyed forever, the
  //    single most losable bug, §6). Return non-2xx → GHL retries; next time the
  //    dedupe above finds the note, skips the create, and re-marks the attempt.
  try {
    await markAttempt(token, contactId, new Date().toISOString());
  } catch (e) {
    return { ok: false, stage: "attempt", error: (e as Error).message };
  }

  return { ok: true, noteWritten };
}

function json(statusCode: number, obj: unknown) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method Not Allowed" });

  // ── Auth (server-side secret; see header doc) ──
  const expected = process.env.IAOS_WEBHOOK_SECRET;
  if (!expected) return json(500, { error: "IAOS_WEBHOOK_SECRET not configured" });
  const provided =
    event.headers?.["x-iaos-secret"] ?? event.headers?.["X-IAOS-Secret"] ?? "";
  if (!provided || !secretMatches(String(provided), expected)) {
    return json(401, { error: "unauthorized" });
  }

  const token = process.env.GHL_PRIVATE_API_KEY ?? process.env.GHL_API_TOKEN;
  if (!token) return json(500, { error: "GHL_PRIVATE_API_KEY not configured" });

  // ── Payload — read customData only, ignore the ~2.8kB of empty fields (§5.1) ──
  let payload: any;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "invalid JSON body" });
  }
  const cd = payload?.customData ?? {};
  const contactId   = String(cd.contact_id ?? "").trim();
  const disposition = String(cd.disposition ?? "").trim();
  const duration    = String(cd.duration ?? "").trim();
  if (!contactId)   return json(400, { error: "missing customData.contact_id" });
  if (!disposition) return json(400, { error: "missing customData.disposition" });

  // Note copy (§6.1, locked). Keep the em-dash form when duration is present;
  // fall back to disposition-only if GHL ever omits it, still parseable.
  const noteBody = duration
    ? `Call: ${disposition} — ${duration}s`
    : `Call: ${disposition}`;

  const result = await writeDisposition(token, contactId, noteBody);

  if (!result.ok) {
    // Non-2xx → GHL retries with backoff; the dedupe guard keeps it idempotent.
    console.error(`[ghl-disposition] ${contactId} stage=${result.stage}: ${result.error}`);
    return json(502, { error: result.error, stage: result.stage, contactId });
  }
  // 2xx ONLY once both the note and the attempt have landed.
  return json(200, { ok: true, contactId, noteWritten: result.noteWritten, attemptMarked: true });
};
