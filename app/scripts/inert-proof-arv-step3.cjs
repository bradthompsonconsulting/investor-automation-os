/* READ-ONLY. This script performs NO writes — no PUT, POST, PATCH, or DELETE.
   GETs only: singular contact (polled), and one /opportunities/search. Safe to
   re-run. It is the poll + step-4 confirmation for the step-2 write
   (docs/PHASE_B_SPEC.md §10.3 steps 3-4). */
/* Inert-proof for ARV (contact.arv) — STEP 3 ONLY: poll the singular GET until the
   target field is PRESENT, record its stored representation, then run the §10.3 step-4
   confirmation against the step-1 before-state snapshot. Reuses the step-2 constants,
   PROXY builder, getJson helper, and deepEqual verbatim. Fixture bradt75. */
const fs = require("fs");

const ORIGIN     = "https://app.investorautomationos.com";
const LOC        = "jmHG4B8RdzwpfqruNf68";
const CONTACT_ID = "9fbH2VCcZvzVNhsR9zjc"; // bradt75 — inert-proof write fixture
const FIELD_ID   = "wMBTGWMs97yysQFx7Vad"; // ARV (MONETORY) — B2 target

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

const STEP1_EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-arv-step1.json";
const STEP2_EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-arv-step2.json";
const STEP3_EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-arv-step3.json";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEvidence(pathStr, label) {
  if (!fs.existsSync(pathStr)) { console.log(`ABORT — ${label} not found: ${pathStr}`); process.exit(1); }
  try { return JSON.parse(fs.readFileSync(pathStr, "utf8")); }
  catch (e) { console.log(`ABORT — ${label} does not parse: ${e.message}`); process.exit(1); }
}

(async () => {
  // ── 1. PRECONDITION — step-1 and step-2 evidence ──
  const step1 = readEvidence(STEP1_EVIDENCE, "step-1 evidence");
  const step2 = readEvidence(STEP2_EVIDENCE, "step-2 evidence");
  for (const [s, name] of [[step1, "step-1"], [step2, "step-2"]]) {
    if (s.contactId !== CONTACT_ID) { console.log(`ABORT — ${name} contactId ${s.contactId} !== ${CONTACT_ID}`); process.exit(1); }
    if (s.fieldId !== FIELD_ID)     { console.log(`ABORT — ${name} fieldId ${s.fieldId} !== ${FIELD_ID}`); process.exit(1); }
  }
  if (step2.responseStatus !== 200) { console.log(`ABORT — step-2 responseStatus ${step2.responseStatus} !== 200`); process.exit(1); }
  const tempValue = step2.tempValue;
  const step1Custom = Array.isArray(step1.customFields) ? step1.customFields : [];
  const step1Tags   = Array.isArray(step1.tags) ? step1.tags : [];

  // ── 2. POLL the singular GET until FIELD_ID is PRESENT (2s × 15 max) ──
  let pollAttempts = 0, liveCustom = [], liveTags = [], found = false, lastObserved = "(none)";
  for (let attempt = 1; attempt <= 15; attempt++) {
    pollAttempts = attempt;
    const body = await getJson(PROXY(`/contacts/${CONTACT_ID}`), `contact GET (poll ${attempt})`);
    const c = body.contact || body;
    liveCustom = Array.isArray(c.customFields) ? c.customFields : [];
    liveTags   = Array.isArray(c.tags) ? c.tags : [];
    const entry = liveCustom.find((f) => f.id === FIELD_ID);
    lastObserved = entry ? JSON.stringify(entry.value) : "(field absent)";
    // MONETORY stored representation is UNKNOWN — poll on PRESENCE, not on value
    // equality. ARV was ABSENT in step 1, so presence alone proves the write landed.
    const hit = !!entry;
    console.log(`poll ${attempt}/15 — ${hit ? `FIELD PRESENT (observed ${lastObserved})` : "not yet (field absent)"}`);
    if (hit) { found = true; break; }
    if (attempt < 15) await sleep(2000);
  }
  if (!found) {
    console.log(`POLL EXHAUSTED — FIELD_ID never appeared. Last observed: ${lastObserved}`);
    process.exit(3);
  }

  // ── OBSERVED stored representation (recorded, NOT asserted) ──
  const targetEntry   = liveCustom.find((f) => f.id === FIELD_ID);
  const observedValue = targetEntry ? targetEntry.value : undefined;
  const observedType  = typeof observedValue;
  const strictEqualsTemp = deepEqual(observedValue, tempValue);
  console.log(`OBSERVED  raw value      ${JSON.stringify(observedValue)}`);
  console.log(`OBSERVED  typeof         ${observedType}`);
  console.log(`OBSERVED  equals sent    ${strictEqualsTemp}  (sent ${JSON.stringify(tempValue)}, typeof ${typeof tempValue})`);

  // ── 3. §10.3 step-4 confirmation against the step-1 snapshot ──
  const step1ById = new Map(step1Custom.map((f) => [f.id, f.value]));
  const liveById  = new Map(liveCustom.map((f) => [f.id, f.value]));

  const targetPresent = liveById.has(FIELD_ID);

  // no custom field other than FIELD_ID changed, over the UNION of ids (presence + value)
  let othersUnchanged = true;
  for (const id of new Set([...step1ById.keys(), ...liveById.keys()])) {
    if (id === FIELD_ID) continue;
    const inS = step1ById.has(id), inL = liveById.has(id);
    if (inS !== inL || !deepEqual(step1ById.get(id), liveById.get(id))) { othersUnchanged = false; break; }
  }

  const tagsUnchanged  = deepEqual(liveTags, step1Tags);
  const offersAbsent   = OFFER_IDS.every((id) => !liveById.has(id));

  // opportunity stage unchanged vs step-1
  const oppPath = `/opportunities/search%3Flocation_id%3D${LOC}%26contact_id%3D${CONTACT_ID}`;
  const oppBody = await getJson(PROXY(oppPath), "opportunity search");
  const opp = Array.isArray(oppBody.opportunities) ? oppBody.opportunities[0] : null;
  const liveOpp = {
    opportunityId: opp ? opp.id : null,
    pipelineId: opp ? opp.pipelineId : null,
    pipelineStageId: opp ? opp.pipelineStageId : null,
    pipelineStageUId: opp ? opp.pipelineStageUId : null,
  };
  const stageUnchanged =
    liveOpp.opportunityId === step1.opportunityId &&
    liveOpp.pipelineId === step1.pipelineId &&
    liveOpp.pipelineStageId === step1.pipelineStageId &&
    liveOpp.pipelineStageUId === step1.pipelineStageUId;

  const results = {
    targetPresent,
    othersUnchanged,
    tagsUnchanged,
    offersAbsent,
    stageUnchanged,
  };
  Object.entries(results).forEach(([k, v]) => console.log(`${v ? "PASS" : "FAIL"}  ${k}`));

  // ── 4. Persist step-3 evidence ──
  const evidence = {
    timestamp: new Date().toISOString(),
    pollAttempts,
    observedValue,
    observedType,
    strictEqualsTemp,
    liveCustomFields: liveCustom,
    liveTags,
    opportunity: liveOpp,
    confirmations: results,
  };
  fs.writeFileSync(STEP3_EVIDENCE, JSON.stringify(evidence, null, 2), "utf8");

  // ── 5. Summary + exit ──
  const failures = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
  if (failures.length) {
    console.log(`CONFIRMATION FAILURES: ${JSON.stringify(failures)}`);
    process.exit(4);
  }
  console.log("ALL CONFIRMATIONS PASSED");
})().catch((e) => { console.error("INERT-PROOF STEP 3 ERROR:", e.message); process.exit(5); });
