/**
 * Contract-send RESERVATION — B9-08 / INV-63.
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
 * JESS GATE CORRECTION, 2026-09-12: this function used to state it
 * "does not re-validate authorization, preview completeness, or
 * eligibility" and trusted the browser-supplied `contactId` outright.
 * That is no longer true for the checks that matter at THIS boundary --
 * fixed below, mirroring `ghl-proxy.ts`'s GATE 2 exactly rather than
 * inventing a second policy:
 *   1. FAIL CLOSED, before any GHL call, unless: the deployment is Test
 *      (already true); `senderUserId` is configured (not the
 *      `SENDER_USER_ID_NOT_CONFIGURED` sentinel); AND
 *      `populationVerification === POPULATION_VERIFIED`. A caller cannot
 *      reserve a slot for a send that GATE 2 will refuse anyway --
 *      refusing here too means no misleading "in_progress" note is ever
 *      left behind for a send that was never going to be allowed to
 *      complete.
 *   2. THE REQUESTED CONTACT MUST BE THE CONFIGURED
 *      `approvedTestContactId`, server-side-enforced, not merely
 *      client-declared -- an arbitrary browser-supplied contact is
 *      refused before any GHL call, consistent with GATE 2's own
 *      recipient override for the actual send.
 *   3. THE NOTE BODY'S OWN `requestedTemplateId` MUST MATCH THE
 *      CONFIGURED `templateId`, and its `confirmedRecipientId` MUST be
 *      the ledger's own "not yet known" sentinel (`UNAVAILABLE`) -- a
 *      caller cannot pre-write a DIFFERENT template id or a fabricated
 *      "confirmed" recipient into the durable, append-only ledger before
 *      any provider response exists. `lib/contract-send-guard.ts`'s
 *      `parseMinimalContractSend` was extended (narrowly -- two new
 *      fields, no shape change to the four already checked) to make
 *      this checkable without importing the full carrier module across
 *      the netlify/functions <-> src/lib boundary this codebase
 *      otherwise keeps separate.
 *
 * What is still NOT re-validated here, deliberately: Brad's authorization
 * currency, preview completeness, and full send eligibility remain
 * `contract-send-model.ts`'s `buildSendAttemptArgs`, already run
 * client-side before this call -- this endpoint's job is narrowly "is
 * the SERVER-KNOWN configuration satisfied, and does the note this
 * caller wants written honestly reflect the server's own values,"
 * not a second, competing implementation of authorization/eligibility
 * logic that could itself drift from the client's.
 */

import {
  getConfig, SENDER_USER_ID_NOT_CONFIGURED, POPULATION_VERIFIED,
} from "../../shared/ghl-config";
import { findConflictingContractSend, parseMinimalContractSend } from "./lib/contract-send-guard";

const GHL_BASE = "https://services.leadconnectorhq.com";
const { locationId: LOCATION_ID, documentsContracts: DOCUMENTS_CONTRACTS } = getConfig(process.env.IAOS_ENV);
// This reservation function exists ONLY for the GHL Documents & Contracts
// send flow, which is Test-only for all of V1 -- asserted independently
// of IAOS_ENV, same rationale and same pattern as ghl-proxy.ts's GATE 2.
const TEST_LOCATION_ID = getConfig("test").locationId;
/** The ledger's own "not yet known" sentinel -- contract-send-carriers.ts's `ledgerValue()`, duplicated as a literal here per this file's own established "no cross-boundary import" convention (see the module header and lib/contract-send-guard.ts's). */
const RECIPIENT_NOT_YET_KNOWN = "UNAVAILABLE";

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

  // Jess Gate correction, 2026-09-12 -- items 1a/1b. Mirrors ghl-proxy.ts's
  // GATE 2 exactly: no reservation may be created for a send that the
  // ACTUAL send endpoint will refuse anyway. Checked before any GHL call
  // and before even parsing the request body, since neither depends on
  // anything the caller supplied.
  if (DOCUMENTS_CONTRACTS.senderUserId === SENDER_USER_ID_NOT_CONFIGURED) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "senderUserId not configured", by: "iaos-contract-send-reserve-test-only" }) };
  }
  if (DOCUMENTS_CONTRACTS.populationVerification !== POPULATION_VERIFIED) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "template population not verified", by: "iaos-contract-send-reserve-test-only" }) };
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

  // Jess Gate correction, 2026-09-12, item 2. An arbitrary browser-
  // supplied contact is never trusted for a reservation, exactly as
  // GATE 2 never trusts one for the actual send -- the ONE configured,
  // pre-approved Test contact is the only contact this endpoint will
  // ever write a note to. Checked before any GHL call.
  if (contactId !== DOCUMENTS_CONTRACTS.approvedTestContactId) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Forbidden -- contactId is not the configured approved Test contact", by: "iaos-contract-send-reserve-test-only" }) };
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

  // Jess Gate correction, 2026-09-12, item 3. The note's OWN embedded
  // requestedTemplateId and confirmedRecipientId must honestly reflect
  // what the server actually knows/will enforce -- a caller cannot
  // pre-write a different template id, or a fabricated "confirmed"
  // recipient, into the durable ledger before any provider response
  // exists. Refused before any GHL call.
  if (parsed.requestedTemplateId !== DOCUMENTS_CONTRACTS.templateId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "noteBody's requestedTemplateId does not match the configured templateId", by: "iaos-contract-send-reserve-test-only" }) };
  }
  if (parsed.confirmedRecipientIdRaw !== RECIPIENT_NOT_YET_KNOWN) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "noteBody's confirmedRecipientId must be unset on an in_progress reservation -- no provider response exists yet", by: "iaos-contract-send-reserve-test-only" }) };
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
