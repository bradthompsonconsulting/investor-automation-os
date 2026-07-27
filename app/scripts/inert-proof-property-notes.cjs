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
const LOC        = "jmHG4B8RdzwpfqruNf68";
const CONTACT_ID = "9fbH2VCcZvzVNhsR9zjc"; // bradt75 — inert-proof write fixture
const FIELD_ID   = "k7O0TYVMpqCpnMHRLPol"; // Property Notes (contact.property_notes)

// The seven offer_ fields (CONTACTS_OPPORTUNITIES_SPEC.md §4 HARD NO — must stay unchanged).
const OFFER_IDS = [
  "v2VO2wUwTYRojmU7VXyZ", // offer_price
  "aAMFPmgxGZT422uGAQOx", // offer_mao
  "qYzkp66x87rG7Pbs36GP", // offer_wholesale_fee
  "2EpRGXb8rj4RtHfFhYbB", // offer_repair_total
  "ec06A3RId4Isorc97jeQ", // offer_margin
  "Z88Y6IqCK1i7hObZcrQM", // offer_arv
  "SJ6x7OqUxTKg1ri8ltb7", // offer_date
];

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
