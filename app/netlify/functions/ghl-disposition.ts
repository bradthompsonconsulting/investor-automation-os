import { configuredBoundary, digest, semanticFields, type GhlBoundary } from "./lib/ghl-write-boundary";
import { identifier, dispositions } from "./lib/write-contracts";
import { ghlToken } from "./lib/ghl-token";
import { legacyEventFrom, toResponse, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { invocation, boundaryFor, logCatchAll, type Invocation } from "./lib/endpoint-kit";
import { WriteRefused } from "./lib/write-gate";
import { acquireLock, lockKey, type ContactLock } from "./lib/contact-lock-v2";
import { isCapabilityRequest, storageCapability } from "./lib/capability";
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { readAuthRefusal } from "./lib/app-read-auth";
import { fieldEffects } from "./lib/g5-gate";
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
 *
 * Storage correction (plan v6 §5): modern runtime with the SAME wire
 * behavior (OPTIONS 204 empty, 405 body, byte-identical 401, the same order:
 * OPTIONS -> method -> secret -> payload -> contact check -> lock). Every
 * write passes the write gate (published production deploy, activation, kill
 * switch, G5 for note + last touch on the contact, legacy block) and each GHL
 * mutation is admitted and sent once through the gated boundary. The contact
 * lock is lock v2 (owner-proven release, never deleted). The capability
 * branch is taken ONLY for the exact `storage_capability` shape with valid
 * app sessions and origin; anything else falls through to the webhook path,
 * and the webhook secret never authorizes capability.
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
async function markAttempt(boundary: GhlBoundary, contactId: string, iso: string, requestId: string): Promise<void> {
  const result = await boundary.fields("contact", contactId, [
    { id: LAST_CALL_ATTEMPT_ID, field_value: iso, date: true },
    { id: LAST_CALL_ATTEMPT_PRECISE_ID, field_value: iso },
  ], undefined, { requestId, opId: "-", attemptId: "-" });
  if (!result.confirmed) throw new Error("Attempt readback not confirmed");
}

async function createNote(boundary: GhlBoundary, contactId: string, body: string, requestId: string): Promise<void> {
  await boundary.note(contactId, body, undefined, { requestId, opId: "-", attemptId: "-" });
}

// True if an identical note already exists within the dedupe window (i.e. this
// is a retry). INV-95 requires failure closed when duplicate/readback evidence
// is unavailable. A retry can still complete the attempt after a confirmed note.
async function noteAlreadyWritten(token: string, contactId: string, body: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, { headers: authHeaders(token), signal });
    if (!res.ok) throw new Error("Dedupe read unavailable");
    const json = await res.json();
    if (!Array.isArray(json?.notes) || json.notes.some((n: any) => typeof n?.body !== "string" || !Number.isFinite(Date.parse(n.dateAdded)))) throw new Error("Ambiguous dedupe readback");
    const notes: any[] = json.notes;
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    return notes.some(
      (n) => n?.body === body && new Date(n?.dateAdded ?? 0).getTime() >= cutoff,
    );
  } catch {
    throw new Error("Dedupe read unavailable; refusing a blind duplicate");
  }
}

type WriteResult =
  | { ok: true;  noteWritten: boolean }
  | { ok: false; stage: "note" | "attempt"; error: string };

// The gated sequence. Dedupe → note → attempt, each gating the next. Returns
// which stage failed so the handler can pick the status code that drives GHL's
// retry (2xx only when BOTH landed; non-2xx otherwise).
async function writeDisposition(
  token: string, boundary: GhlBoundary, inv: Invocation, contactId: string, noteBody: string, requestBase: string,
): Promise<WriteResult> {
  // 1. Note (skipped iff a retry already wrote it) — the human record.
  let noteWritten = false;
  inv.scope.assertMayStart();
  const dedupeSignal = AbortSignal.any([inv.scope.signal, AbortSignal.timeout(Math.max(1, Math.min(10_000, inv.scope.remaining())))]);
  if (!(await noteAlreadyWritten(token, contactId, noteBody, dedupeSignal))) {
    try {
      await createNote(boundary, contactId, noteBody, `${requestBase}-note`);
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
    await markAttempt(boundary, contactId, new Date().toISOString(), `${requestBase}-touch`);
  } catch (e) {
    return { ok: false, stage: "attempt", error: (e as Error).message };
  }

  return { ok: true, noteWritten };
}

function json(statusCode: number, obj: unknown): LambdaResult {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: false });
  const inv = invocation("ghl-disposition", context);
  let header: Record<string, string> | undefined;
  try {
    const r = await handle(event, inv, (h) => { header = { "X-IAOS-Storage": h }; });
    return toResponse(r, header);
  } finally { inv.scope.close(); }
};

/** The capability branch: exact shape AND valid app read + write sessions AND origin. Otherwise null (fall through). */
async function capabilityBranch(event: LegacyEvent, inv: Invocation): Promise<{ result: LambdaResult; header: string } | null> {
  let body: unknown;
  try { body = event.isBase64Encoded ? null : JSON.parse(event.body ?? "null"); } catch { return null; }
  if (!isCapabilityRequest(body)) return null;
  try { requireAppWriter(event); requireAppWriteOrigin(event); } catch { return null; }
  if (readAuthRefusal(event)) return null;
  const r = await storageCapability(inv.fn, inv.deploy, (body as any).nonce);
  return { result: json(r.status, r.body), header: r.header };
}

async function handle(event: LegacyEvent, inv: Invocation, setStorageHeader: (h: string) => void): Promise<LambdaResult> {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method Not Allowed" });
  const cap = await capabilityBranch(event, inv);
  if (cap) { setStorageHeader(cap.header); return cap.result; }

  // ── Auth (server-side secret; see header doc) ──
  const expected = process.env.IAOS_WEBHOOK_SECRET;
  if (!expected) return json(500, { error: "IAOS_WEBHOOK_SECRET not configured" });
  const provided =
    event.headers?.["x-iaos-secret"] ?? event.headers?.["X-IAOS-Secret"] ?? "";
  if (!provided || !secretMatches(String(provided), expected)) {
    return json(401, { error: "unauthorized" });
  }

  const token = ghlToken();
  if (!token) return json(500, { error: "GHL token not configured" });

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

  try {
    identifier(contactId);
    if (!cd || typeof cd !== "object" || Array.isArray(cd) || Object.keys(cd).some(k => !["contact_id", "disposition", "duration"].includes(k))) throw new Error("Undeclared customData field");
    if (!dispositions.includes(disposition) || (duration && !/^\d+$/.test(duration))) throw new Error("Malformed disposition");
    const check = configuredBoundary(token, null, inv.scope);
    check.readTimeoutMs = 5_000;   // the contact check read: 5 s, inside T_work (plan v6 §7)
    await check.contact(contactId);
  } catch { return json(403, { error: "Disposition payload or target refused" }); }
  // Note copy (§6.1, locked). Keep the em-dash form when duration is present;
  // fall back to disposition-only if GHL ever omits it, still parseable.
  const noteBody = duration
    ? `Call: ${disposition} — ${duration}s`
    : `Call: ${disposition}`;

  let result: WriteResult;
  let lock: ContactLock | null = null;
  try {
    // The write gate (no page to echo an activation id: server-to-server).
    await inv.gate.enter(null);
    const s = semanticFields(inv.config);
    await inv.gate.checkSubject(`contact:${contactId}`, [...new Set(["note", ...fieldEffects([LAST_CALL_ATTEMPT_ID, LAST_CALL_ATTEMPT_PRECISE_ID], s)])].sort());
    lock = await acquireLock(inv.store, inv.scope, lockKey(inv.env, inv.config.locationId, contactId), { opId: null, deployId: inv.deploy.id! });
    const requestBase = `v2-disp-${digest(`${contactId}:${noteBody}:${inv.scope.startedAt}`).slice(0, 32)}`;
    result = await writeDisposition(token, boundaryFor(inv), inv, contactId, noteBody, requestBase);
  } catch (e) {
    if (lock) await lock.release();
    if (e instanceof WriteRefused) return json(e.refusal.status, e.refusal.body);
    logCatchAll(inv, "disposition");
    return json(409, { error: "Disposition deduplication unavailable; no blind retry write" });
  }
  const released = lock ? await lock.release() : null;

  if (!result.ok) {
    // Non-2xx → GHL retries with backoff; the dedupe guard keeps it idempotent.
    console.error(`[ghl-disposition] ${contactId} stage=${result.stage}: ${result.error}`);
    return json(502, { error: result.error, stage: result.stage, contactId });
  }
  // 2xx ONLY once both the note and the attempt have landed.
  return json(200, { ok: true, contactId, noteWritten: result.noteWritten, attemptMarked: true, ...(released === "release_unverified" ? { lock: "release_unverified" } : {}) });
}
