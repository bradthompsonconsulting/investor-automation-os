/* WRITE STEP. This script performs EXACTLY ONE PUT — a single write to the target
   custom field on the bradt75 fixture. It does NOT poll, verify, or restore; those
   are later increments (docs/PHASE_B_SPEC.md §10.3 steps 3-5). Per the write-separation
   invariant (§10.3), this one PUT is independently approved, executed, and verified. */
/* Inert-proof for Property Notes (contact.property_notes) — STEP 2 ONLY: one PUT of a
   temporary value, guarded by a file precondition (step-1 evidence) and a live
   precondition (contact unchanged since step 1). Reuses the step-1 constants, PROXY
   builder, and getJson helper verbatim. Fixture bradt75, per
   CONTACTS_OPPORTUNITIES_SPEC.md §4.2. */
const fs = require("fs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN     = "https://app.investorautomationos.com";

/* Environment resolution (Gate 4C C4a, Stair 3). getConfig(ENV) runs BEFORE the
   carrier lookup so an unknown --env surfaces [ghl-config]'s own message
   unwrapped, and --env=test reaches a valid Test config and then refuses at the
   carrier's absent Test section. EVERY environment-owned value below derives
   from this one parsed ENV — there is no second selector and no fallback. */
const envArg = process.argv.slice(2).find((a) => a.startsWith("--env="));
if (envArg === undefined) {
  console.error("REFUSED: --env=<environment> is required. Expected --env=production or --env=test. There is no default.");
  process.exit(4);
}
const ENV = envArg.slice("--env=".length);

let config;
try {
  config = ghlConfig.getConfig(ENV);
} catch (e) {
  console.error(e.message);
  process.exit(4);
}

const envFixtures     = fixtures[ENV];
const fixtureContacts = envFixtures && envFixtures.fixtureRecords && envFixtures.fixtureRecords.contacts;
if (!fixtureContacts || !fixtureContacts.bradt75) {
  console.error(`REFUSED: harness-fixtures.json carries no fixture records for "${ENV}" — expected ${ENV}.fixtureRecords.contacts.bradt75. Refusing rather than inventing them.`);
  process.exit(4);
}

const CONTACT_ID = fixtureContacts.bradt75;     // bradt75 — inert-proof write fixture
const FIELD_ID   = config.fields.propertyNotes; // Property Notes (contact.property_notes)

const TEMP_VALUE      = "IAOS INERT PROOF 2026-07-27 DO NOT USE";
const STEP1_EVIDENCE  = "C:/Users/brad/AppData/Local/Temp/inert-proof-property-notes-step1.json";
const STEP2_EVIDENCE  = "C:/Users/brad/AppData/Local/Temp/inert-proof-property-notes-step2.json";

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

(async () => {
  // ── 1. PRECONDITION — file (step-1 evidence) ──
  if (!fs.existsSync(STEP1_EVIDENCE)) { console.log(`ABORT — step-1 evidence not found: ${STEP1_EVIDENCE}`); process.exit(1); }
  let step1;
  try { step1 = JSON.parse(fs.readFileSync(STEP1_EVIDENCE, "utf8")); }
  catch (e) { console.log(`ABORT — step-1 evidence does not parse: ${e.message}`); process.exit(1); }
  if (step1.contactId !== CONTACT_ID) { console.log(`ABORT — step-1 contactId ${step1.contactId} !== ${CONTACT_ID}`); process.exit(1); }
  if (step1.fieldId !== FIELD_ID)     { console.log(`ABORT — step-1 fieldId ${step1.fieldId} !== ${FIELD_ID}`); process.exit(1); }
  if (step1.fieldPresent !== false)   { console.log(`ABORT — step-1 fieldPresent is ${step1.fieldPresent}, expected false`); process.exit(1); }
  const step1Custom = Array.isArray(step1.customFields) ? step1.customFields : null;
  const step1Tags   = Array.isArray(step1.tags) ? step1.tags : null;
  if (!step1Custom || !step1Tags) { console.log("ABORT — step-1 customFields/tags not arrays"); process.exit(1); }

  // ── 2. PRECONDITION — live (contact unchanged since step 1) ──
  const contactBody = await getJson(PROXY(`/contacts/${CONTACT_ID}`), "contact GET");
  const c = contactBody.contact || contactBody;
  if (c.id !== CONTACT_ID) { console.log(`ABORT — live contact id ${c.id} !== ${CONTACT_ID}`); process.exit(2); }
  const liveCustom = Array.isArray(c.customFields) ? c.customFields : [];
  const liveTags   = Array.isArray(c.tags) ? c.tags : [];
  if (liveCustom.some((f) => f.id === FIELD_ID)) { console.log(`ABORT — FIELD_ID already present live; refusing to overwrite`); process.exit(2); }
  if (!deepEqual(liveCustom, step1Custom)) { console.log("ABORT — live customFields differ from step-1 snapshot"); process.exit(2); }
  if (!deepEqual(liveTags, step1Tags))     { console.log("ABORT — live tags differ from step-1 snapshot"); process.exit(2); }

  // ── 3. Both preconditions passed — perform EXACTLY ONE PUT (the only non-GET here) ──
  console.log("PRECONDITIONS PASSED — file (step-1) and live (unchanged); proceeding to one PUT");
  const requestBody = { customFields: [{ id: FIELD_ID, field_value: TEMP_VALUE }] };
  let putResp;
  try { putResp = await fetch(PROXY(`/contacts/${CONTACT_ID}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }); }
  catch (e) { throw new Error(`PUT fetch threw — ${e.message}`); }

  // ── 4. Capture status + complete body. No re-read, no poll. ──
  const responseStatus = putResp.status;
  const rawText = await putResp.text();
  let responseBody;
  try { responseBody = JSON.parse(rawText); } catch { responseBody = rawText; }

  if (responseStatus < 200 || responseStatus >= 300) {
    console.log(`PUT FAILED — HTTP ${responseStatus}`);
    console.log(typeof responseBody === "string" ? responseBody.slice(0, 600) : JSON.stringify(responseBody).slice(0, 600));
    fs.writeFileSync(STEP2_EVIDENCE, JSON.stringify({ timestamp: new Date().toISOString(), contactId: CONTACT_ID, fieldId: FIELD_ID, tempValue: TEMP_VALUE, requestBody, responseStatus, responseBody }, null, 2), "utf8");
    process.exit(5);
  }

  // ── 5. Persist step-2 evidence ──
  const evidence = {
    timestamp: new Date().toISOString(),
    contactId: CONTACT_ID,
    fieldId: FIELD_ID,
    tempValue: TEMP_VALUE,
    requestBody,
    responseStatus,
    responseBody,
  };
  fs.writeFileSync(STEP2_EVIDENCE, JSON.stringify(evidence, null, 2), "utf8");

  // ── 6. Summary (no full body) ──
  console.log("STEP 2 — one PUT performed (no poll, no verify, no restore)");
  console.log(`  preconditions   PASSED`);
  console.log(`  PUT status      ${responseStatus}`);
  console.log(`  evidence written ${STEP2_EVIDENCE}`);
})().catch((e) => { console.error("INERT-PROOF STEP 2 ERROR:", e.message); process.exit(4); });
