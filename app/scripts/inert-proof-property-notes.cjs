/* READ-ONLY. This script performs NO writes — no PUT, POST, PATCH, or DELETE.
   Two GETs only: singular contact GET, and an /opportunities/search GET. Safe to
   re-run at any time. */
/* Inert-proof for Property Notes (contact.property_notes) — STEP 1 ONLY: capture
   before-state (docs/PHASE_B_SPEC.md §10.3 step 1, §10.6). Fixture bradt75, per
   CONTACTS_OPPORTUNITIES_SPEC.md §4.2. No later step (write / poll / restore) is in
   this file. Follows the B0 recon conventions: same PROXY builder + getJson helper,
   literal /contacts path, nested ?&= encoded as %3F %26 %3D, never --data-urlencode. */
const fs = require("fs");

const ORIGIN     = "https://app.investorautomationos.com";

// ── Identifier resolution (Gate 4C S2). No literal, no default, no fallback. ──
// LOC and the family Class-1 field resolve through canonical ghl-config via the
// CommonJS loader. The bradt75 fixture and the six contact offer_ pins resolve
// from the harness carrier, which needs no loader. --env is required; absent or
// unknown refuses, and a typo'd flag leaves it absent, so the refusal is
// fail-closed by construction.
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

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
const LOC      = config.locationId;
const FIELD_ID = config.fields.propertyNotes; // Property Notes (contact.property_notes)

const envFixtures     = fixtures[ENV];
const fixtureContacts = envFixtures && envFixtures.fixtureRecords && envFixtures.fixtureRecords.contacts;
if (!fixtureContacts || !fixtureContacts.bradt75) {
  console.error(`REFUSED: harness-fixtures.json carries no fixture records for "${ENV}" — expected ${ENV}.fixtureRecords.contacts.bradt75. Refusing rather than inventing them.`);
  process.exit(4);
}
const CONTACT_ID = fixtureContacts.bradt75; // bradt75 — inert-proof write fixture

const envPins = envFixtures.untouchedPins;
const contactOfferFields = envPins && envPins.contactOfferFields
  ? Object.values(envPins.contactOfferFields)
  : undefined;
if (!contactOfferFields || contactOfferFields.length !== 6) {
  console.error(`REFUSED: harness-fixtures.json carries no six-member contactOfferFields for "${ENV}" — expected ${ENV}.untouchedPins.contactOfferFields. Refusing rather than inventing them.`);
  process.exit(4);
}

// The seven offer_ fields (CONTACTS_OPPORTUNITIES_SPEC.md §4 HARD NO — must stay unchanged).
// offer_price is Class 1 and resolves through getConfig; the other six are carrier
// untouchedPins. The mixed source is intentional; the order is the original order.
const OFFER_IDS = [config.fields.offerPrice, ...contactOfferFields];

const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-property-notes-step1.json";

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

(async () => {
  // ── (1) singular contact GET — the primary before-state instrument ──
  const contactBody = await getJson(PROXY(`/contacts/${CONTACT_ID}`), "contact GET");
  const c = contactBody.contact || contactBody;
  if (c.id !== CONTACT_ID) {
    console.log(`ABORT — contact id mismatch: response id=${c.id} expected=${CONTACT_ID}`);
    process.exit(1);
  }
  const customFields = Array.isArray(c.customFields) ? c.customFields : [];
  const tags = Array.isArray(c.tags) ? c.tags : [];
  const fieldPresent = customFields.some((f) => f.id === FIELD_ID);

  // ── (2) opportunity stage via /opportunities/search — snake_case location_id + contact_id
  //         (camelCase → 422; CONTACTS_OPPORTUNITIES_SPEC.md RECON FINDINGS 2026-07-21) ──
  const oppPath = `/opportunities/search%3Flocation_id%3D${LOC}%26contact_id%3D${CONTACT_ID}`;
  const oppBody = await getJson(PROXY(oppPath), "opportunity search");
  const opp = Array.isArray(oppBody.opportunities) ? oppBody.opportunities[0] : null;
  const oppTotal = oppBody.meta ? oppBody.meta.total : null;
  if (oppTotal !== 1) {
    console.log(`ABORT — expected exactly 1 opportunity, got ${oppTotal}`);
    process.exit(2);
  }
  const opportunityId = opp ? opp.id : null;
  const pipelineId       = opp ? opp.pipelineId : null;
  const pipelineStageId  = opp ? opp.pipelineStageId : null;
  const pipelineStageUId = opp ? opp.pipelineStageUId : null;

  // ── evidence record ──
  const evidence = {
    timestamp: new Date().toISOString(),
    contactId: CONTACT_ID,
    fieldId: FIELD_ID,
    fieldPresent,
    customFields,        // complete array, exactly as returned
    tags,
    offerIds: OFFER_IDS,
    opportunityId,
    pipelineId,
    pipelineStageId,
    pipelineStageUId,
    oppMetaTotal: oppBody.meta ? oppBody.meta.total : null,
  };
  fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2), "utf8");

  // ── stdout summary ──
  console.log("STEP 1 — before-state captured (READ-ONLY, no PUT)");
  console.log(`  contactId          ${CONTACT_ID}`);
  console.log(`  Property Notes     ${fieldPresent ? "PRESENT" : "ABSENT"} (id ${FIELD_ID})`);
  console.log(`  custom-field count ${customFields.length}`);
  console.log(`  tag count          ${tags.length}`);
  console.log(`  pipelineStageId    ${pipelineStageId}`);
  console.log(`  evidence written   ${EVIDENCE}`);
})().catch((e) => { console.error("INERT-PROOF STEP 1 ERROR:", e.message); process.exit(3); });
