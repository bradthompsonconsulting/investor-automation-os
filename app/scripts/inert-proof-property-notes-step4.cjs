/* WRITE STEP. This script performs EXACTLY ONE PUT — a single clear of the target
   custom field on the bradt75 fixture. It does NOT poll, verify, or attempt a second
   clear syntax; observing the clear result is the next increment (docs/PHASE_B_SPEC.md
   §10.3 steps 5-6, the first-proof clear-semantics procedure). Per the write-separation
   invariant (§10.3), this one PUT is independently approved, executed, and verified. */
/* Inert-proof for Property Notes (contact.property_notes) — STEP 4 ONLY: one PUT that
   clears the field, guarded by a file precondition (step-2 + step-3 evidence) and a
   live precondition (field currently holds the step-2 tempValue). Reuses the step-2
   constants, PROXY builder, getJson helper, and deepEqual verbatim. Fixture bradt75. */
const fs = require("fs");

const ORIGIN     = "https://app.investorautomationos.com";
const CONTACT_ID = "9fbH2VCcZvzVNhsR9zjc"; // bradt75 — inert-proof write fixture
const FIELD_ID   = "k7O0TYVMpqCpnMHRLPol"; // Property Notes (contact.property_notes)

const CLEAR_VALUE     = "";
const STEP2_EVIDENCE  = "C:/Users/brad/AppData/Local/Temp/inert-proof-property-notes-step2.json";
const STEP3_EVIDENCE  = "C:/Users/brad/AppData/Local/Temp/inert-proof-property-notes-step3.json";
const STEP4_EVIDENCE  = "C:/Users/brad/AppData/Local/Temp/inert-proof-property-notes-step4.json";

// Literal /contacts path; encode only nested ? & = as %3F %26 %3D; NO --data-urlencode.
const PROXY = (p) => `${ORIGIN}/.netlify/functions/ghl-proxy?path=${p}`;

async function getJson(url, label) {
  let resp;
  try { resp = await fetch(url, { method: "GET", headers: { "Cache-Control": "no-cache" } }); }
  catch (e) { throw new Error(`${label}: fetch threw — ${e.message}`); }
  const status = resp.status;
  let body;
  try { body = await resp.json(); }
  catch (e) { throw new Error(`${label}: non-JSON body (HTTP ${status})`); }
  if (status !== 200) throw new Error(`${label}: HTTP ${status} — ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

// Structural deep-equal: order-sensitive for arrays, order-insensitive for object keys.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function readEvidence(pathStr, label) {
  if (!fs.existsSync(pathStr)) { console.log(`ABORT — ${label} not found: ${pathStr}`); process.exit(1); }
  try { return JSON.parse(fs.readFileSync(pathStr, "utf8")); }
  catch (e) { console.log(`ABORT — ${label} does not parse: ${e.message}`); process.exit(1); }
}

(async () => {
  // ── 1. PRECONDITION — file (step-2 + step-3 evidence) ──
  const step2 = readEvidence(STEP2_EVIDENCE, "step-2 evidence");
  const step3 = readEvidence(STEP3_EVIDENCE, "step-3 evidence");
  for (const [s, name] of [[step2, "step-2"], [step3, "step-3"]]) {
    if (s.contactId !== CONTACT_ID) { console.log(`ABORT — ${name} contactId ${s.contactId} !== ${CONTACT_ID}`); process.exit(1); }
    if (s.fieldId !== FIELD_ID)     { console.log(`ABORT — ${name} fieldId ${s.fieldId} !== ${FIELD_ID}`); process.exit(1); }
  }
  if (step2.responseStatus !== 200) { console.log(`ABORT — step-2 responseStatus ${step2.responseStatus} !== 200`); process.exit(1); }
  const confirmations = step3.confirmations || {};
  const notTrue = Object.entries(confirmations).filter(([, v]) => v !== true).map(([k]) => k);
  if (!Object.keys(confirmations).length || notTrue.length) {
    console.log(`ABORT — step-3 confirmations not all true: ${JSON.stringify(notTrue.length ? notTrue : "(empty)")}`);
    process.exit(1);
  }
  const tempValue = step2.tempValue;

  // ── 2. PRECONDITION — live (field currently holds the tempValue) ──
  const contactBody = await getJson(PROXY(`/contacts/${CONTACT_ID}`), "contact GET");
  const c = contactBody.contact || contactBody;
  if (c.id !== CONTACT_ID) { console.log(`ABORT — live contact id ${c.id} !== ${CONTACT_ID}`); process.exit(2); }
  const liveCustom = Array.isArray(c.customFields) ? c.customFields : [];
  const entry = liveCustom.find((f) => f.id === FIELD_ID);
  if (!entry) { console.log("ABORT — FIELD_ID absent live; the record moved, refusing to clear"); process.exit(2); }
  if (!deepEqual(entry.value, tempValue)) { console.log(`ABORT — live FIELD_ID value ${JSON.stringify(entry.value)} !== tempValue; refusing to clear`); process.exit(2); }

  // ── 3. Both preconditions passed — perform EXACTLY ONE PUT (the only non-GET here) ──
  console.log("PRECONDITIONS PASSED — file (step-2 + step-3) and live (holds tempValue); proceeding to one PUT (clear)");
  const requestBody = { customFields: [{ id: FIELD_ID, field_value: CLEAR_VALUE }] };
  let putResp;
  try { putResp = await fetch(PROXY(`/contacts/${CONTACT_ID}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }); }
  catch (e) { throw new Error(`PUT fetch threw — ${e.message}`); }

  // ── 4. Capture status + complete body. No re-read, no poll. ──
  const responseStatus = putResp.status;
  const rawText = await putResp.text();
  let responseBody;
  try { responseBody = JSON.parse(rawText); } catch { responseBody = rawText; }

  // ── 5. Non-2xx guard ──
  if (responseStatus < 200 || responseStatus >= 300) {
    console.log(`PUT FAILED — HTTP ${responseStatus}`);
    console.log(typeof responseBody === "string" ? responseBody.slice(0, 600) : JSON.stringify(responseBody).slice(0, 600));
    fs.writeFileSync(STEP4_EVIDENCE, JSON.stringify({ timestamp: new Date().toISOString(), contactId: CONTACT_ID, fieldId: FIELD_ID, clearValue: CLEAR_VALUE, priorValue: tempValue, requestBody, responseStatus, responseBody }, null, 2), "utf8");
    process.exit(5);
  }

  // ── 6. Persist step-4 evidence ──
  const evidence = {
    timestamp: new Date().toISOString(),
    contactId: CONTACT_ID,
    fieldId: FIELD_ID,
    clearValue: CLEAR_VALUE,
    priorValue: tempValue,
    requestBody,
    responseStatus,
    responseBody,
  };
  fs.writeFileSync(STEP4_EVIDENCE, JSON.stringify(evidence, null, 2), "utf8");

  // ── 7. Summary (no full body) ──
  console.log("STEP 4 — one PUT performed (clear; no poll, no verify)");
  console.log(`  preconditions   PASSED`);
  console.log(`  PUT status      ${responseStatus}`);
  console.log(`  evidence written ${STEP4_EVIDENCE}`);
})().catch((e) => { console.error("INERT-PROOF STEP 4 ERROR:", e.message); process.exit(4); });
