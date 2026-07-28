/* READ-ONLY. This script performs NO writes — no PUT, POST, PATCH, or DELETE.
   GETs only: singular contact (polled), and one /opportunities/search. Safe to
   re-run. It observes the clear result of the step-4 clear PUT and records the
   clear-semantics finding (docs/PHASE_B_SPEC.md §10.3 steps 5-6, first-proof). */
/* Inert-proof for ARV (contact.arv) — STEP 5 ONLY: poll the
   singular GET after the step-4 clear, classify the observed FIELD_ID state (the
   clear-semantics finding), then re-run the no-side-effect confirmation against the
   step-1 before-state. Reuses the step-3 constants, PROXY builder, getJson helper,
   and deepEqual verbatim. Fixture bradt75. */
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
const STEP4_EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-arv-step4.json";
const STEP5_EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-arv-step5.json";

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

// Classify the FIELD_ID state on a live customFields array against step-2 tempValue.
function classify(entry, tempValue) {
  if (!entry) return "KEY_ABSENT";
  if (entry.value === "") return "KEY_PRESENT_EMPTY_STRING";
  if (deepEqual(entry.value, tempValue)) return "KEY_PRESENT_UNCHANGED";
  return "KEY_PRESENT_OTHER";
}

(async () => {
  // ── 1. PRECONDITION — step-1, step-2, step-4 evidence ──
  const step1 = readEvidence(STEP1_EVIDENCE, "step-1 evidence");
  const step2 = readEvidence(STEP2_EVIDENCE, "step-2 evidence");
  const step4 = readEvidence(STEP4_EVIDENCE, "step-4 evidence");
  if (step4.responseStatus !== 200) { console.log(`ABORT — step-4 responseStatus ${step4.responseStatus} !== 200`); process.exit(1); }
  const tempValue = step2.tempValue;
  const step1Custom = Array.isArray(step1.customFields) ? step1.customFields : [];
  const step1Tags   = Array.isArray(step1.tags) ? step1.tags : [];

  // ── 2. POLL — stop as soon as state is not KEY_PRESENT_UNCHANGED (2s × 15 max) ──
  let pollAttempts = 0, liveCustom = [], liveTags = [], fieldEntry = null, clearResultState = "KEY_PRESENT_UNCHANGED";
  for (let attempt = 1; attempt <= 15; attempt++) {
    pollAttempts = attempt;
    const body = await getJson(PROXY(`/contacts/${CONTACT_ID}`), `contact GET (poll ${attempt})`);
    const c = body.contact || body;
    liveCustom = Array.isArray(c.customFields) ? c.customFields : [];
    liveTags   = Array.isArray(c.tags) ? c.tags : [];
    fieldEntry = liveCustom.find((f) => f.id === FIELD_ID) || null;
    clearResultState = classify(fieldEntry, tempValue);
    const detail = clearResultState === "KEY_PRESENT_OTHER" ? ` (value ${JSON.stringify(fieldEntry.value)})` : "";
    console.log(`poll ${attempt}/15 — ${clearResultState}${detail}`);
    if (clearResultState !== "KEY_PRESENT_UNCHANGED") break;
    if (attempt < 15) await sleep(2000);
  }

  // ── 3. Final observed clear-semantics finding ──
  console.log(`OBSERVED CLEAR RESULT: ${clearResultState}`);

  // ── 4. No-side-effect confirmation against the step-1 snapshot (FOUR checks; no target assertion) ──
  const step1ById = new Map(step1Custom.map((f) => [f.id, f.value]));
  const liveById  = new Map(liveCustom.map((f) => [f.id, f.value]));

  // no custom field other than FIELD_ID changed, over the UNION of ids (presence + value)
  let othersUnchanged = true;
  for (const id of new Set([...step1ById.keys(), ...liveById.keys()])) {
    if (id === FIELD_ID) continue;
    const inS = step1ById.has(id), inL = liveById.has(id);
    if (inS !== inL || !deepEqual(step1ById.get(id), liveById.get(id))) { othersUnchanged = false; break; }
  }

  const tagsUnchanged = deepEqual(liveTags, step1Tags);
  const offersAbsent  = OFFER_IDS.every((id) => !liveById.has(id));

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

  const results = { othersUnchanged, tagsUnchanged, offersAbsent, stageUnchanged };
  Object.entries(results).forEach(([k, v]) => console.log(`${v ? "PASS" : "FAIL"}  ${k}`));

  // ── 5. Persist step-5 evidence ──
  const evidence = {
    timestamp: new Date().toISOString(),
    pollAttempts,
    clearResultState,
    fieldEntry,
    liveCustomFields: liveCustom,
    liveTags,
    opportunity: liveOpp,
    confirmations: results,
  };
  fs.writeFileSync(STEP5_EVIDENCE, JSON.stringify(evidence, null, 2), "utf8");

  // ── 6. Summary + exit (clear result does NOT affect exit code) ──
  console.log(`CLEAR RESULT STATE: ${clearResultState}`);
  const failures = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
  if (failures.length) {
    console.log(`CONFIRMATION FAILURES: ${JSON.stringify(failures)}`);
    process.exit(4);
  }
  console.log("ALL CONFIRMATIONS PASSED");
})().catch((e) => { console.error("INERT-PROOF STEP 5 ERROR:", e.message); process.exit(5); });
