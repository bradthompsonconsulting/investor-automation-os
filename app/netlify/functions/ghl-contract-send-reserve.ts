/**
 * Contract-send RESERVATION — B9-08 / INV-63 correction round,
 * 2026-09-11 (item 7: "the server must own an atomic/idempotent send
 * boundary").
 *
 * POST /.netlify/functions/ghl-contract-send-reserve
 * body: { contactId, opportunityId, versionRaw, noteBody }
 *
 * This is the ONLY write site for the "in_progress" attempt note.
 * `ContractWorkspace.tsx`'s `handleSend` used to write that note directly
 * via `ghl.notes.create()`, evaluating eligibility (including "does a
 * pending/accepted send already exist") entirely client-side -- a real
 * concurrency gap: two browser tabs (or a double-click) could both read
 * "no existing send" and both proceed. This function collapses that
 * check-then-write sequence into ONE server-side round trip: it reads
 * the contact's notes FRESH (never trusting anything the client claims
 * beyond the note body it wants written), re-derives whether a
 * conflicting pending/accepted send already exists
 * (`lib/contract-send-guard.ts`, the SAME resolution logic
 * `contract-send-model.ts`'s own idempotency guard uses, duplicated
 * server-side per that module's own convention), and ONLY THEN writes
 * the note -- narrowing the race window from "arbitrary browser think
 * time across tabs" down to this one function's own GET-then-POST
 * duration. OBSERVED: GHL's Notes API exposes no compare-and-swap or
 * unique-constraint primitive, so this narrows, but does not
 * mathematically eliminate, a genuinely simultaneous double-invocation
 * of this same function -- that residual is reported, not hidden.
 *
 * STILL EXACTLY THE SAME SANCTIONED WRITE. This function calls GHL's
 * `POST /contacts/{id}/notes` -- AGENTS.md's `ghl.notes.create()`
 * primitive -- from a dedicated server-side entry point instead of the
 * browser-facing `ghl-proxy.ts` passthrough. No fourth write class is
 * introduced; only WHERE the check-then-act sequence executes moved.
 *
 * The note body itself is opaque to this function beyond the four fields
 * `parseMinimalContractSend` extracts for the conflict check -- it does
 * not re-validate authorization, preview completeness, or eligibility;
 * that responsibility stays with `contract-send-model.ts`'s
 * `buildSendAttemptArgs`, already run client-side before this call. This
 * function's SOLE added value is the atomic conflict check + write.
 */

import { getConfig } from "../../shared/ghl-config";
import { findConflictingContractSend, parseMinimalContractSend } from "./lib/contract-send-guard";

const GHL_BASE = "https://services.leadconnectorhq.com";
const { locationId: LOCATION_ID } = getConfig(process.env.IAOS_ENV);
// This reservation function exists ONLY for the GHL Documents & Contracts
// send flow, which is Test-only for all of V1 -- asserted independently
// of IAOS_ENV, same rationale and same pattern as ghl-proxy.ts's GATE 2.
const TEST_LOCATION_ID = getConfig("test").locationId;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CONTACT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  if (LOCATION_ID !== TEST_LOCATION_ID) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Forbidden", by: "iaos-contract-send-reserve-test-only" }) };
  }

  let payload: Record<string, unknown>;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Malformed JSON body" }) };
  }

  const contactId = payload.contactId;
  const opportunityId = payload.opportunityId;
  const versionRaw = payload.versionRaw;
  const noteBody = payload.noteBody;
  if (
    typeof contactId !== "string" || !CONTACT_ID.test(contactId) ||
    typeof opportunityId !== "string" || opportunityId === "" ||
    typeof versionRaw !== "string" || versionRaw === "" ||
    typeof noteBody !== "string" || noteBody === ""
  ) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing or malformed contactId/opportunityId/versionRaw/noteBody" }) };
  }

  // The note IAOS is asking this function to write must itself be a
  // well-formed, in_progress contract-send note for the SAME
  // opportunityId/version the caller separately declared -- a mismatch
  // here means the caller's own claim disagrees with the note it wants
  // written, which is refused rather than trusted.
  const parsed = parseMinimalContractSend(noteBody);
  if (!parsed || parsed.status !== "in_progress" || parsed.opportunityId !== opportunityId || parsed.versionRaw !== versionRaw) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "noteBody is not a well-formed in_progress contract-send note matching the declared opportunityId/version" }) };
  }

  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "GHL_PRIVATE_API_KEY not configured" }) };
  }
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json" };

  const notesRes = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, { headers });
  if (!notesRes.ok) {
    const text = await notesRes.text();
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Could not read existing notes to check for a conflicting send", detail: text }) };
  }
  const notesBody = await notesRes.json();
  const notes: { body: string }[] = Array.isArray(notesBody?.notes) ? notesBody.notes : [];

  const conflict = findConflictingContractSend(notes, opportunityId, versionRaw);
  if (conflict.conflict) {
    return {
      statusCode: 409,
      headers: CORS,
      body: JSON.stringify({ error: "A pending or accepted send already exists for this exact revision", status: conflict.status, attemptId: conflict.attemptId }),
    };
  }

  const writeRes = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body: noteBody }),
  });
  const writeBody = await writeRes.text();
  return {
    statusCode: writeRes.status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: writeBody,
  };
};
