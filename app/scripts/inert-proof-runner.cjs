/* Parameterized inert-proof runner per docs/PHASE_B_SPEC.md PB-D26 (stage ownership
   and boundaries), PB-D27 (one stage per process invocation), PB-D28 (field
   configuration is an in-file keyed registry), and PB-D29 (stage exit codes and
   evidence path derivation), and PB-D30 (write stage contract). Stages implemented:
   capture and write. The verify and restore bodies remain placeholders and perform no
   network calls. Capture is READ-ONLY against GHL — two GETs, no PUT, safe to re-run at
   any time. Write performs EXACTLY ONE PUT and only to a field observed absent both in
   capture evidence and live. */
const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const LOC    = "jmHG4B8RdzwpfqruNf68";

// PB-D28 — in-file keyed field registry. Only observed values live here. PB-D30 —
// tempValue is present where observed (arv), and null where no temporary value has
// been observed yet (property_notes, TEXT). clearValue, restore strategy, and
// comparison rules remain intentionally absent until observed.
const FIELDS = {
  arv: {
    fieldId: "wMBTGWMs97yysQFx7Vad", dataType: "MONETORY", contactId: "9fbH2VCcZvzVNhsR9zjc",
    // Observed from inert-proof-arv-step2.cjs. PB-D30 — observed temporary values only.
    tempValue: 187500.25,
  },
  property_notes: {
    fieldId: "k7O0TYVMpqCpnMHRLPol", dataType: "TEXT", contactId: "9fbH2VCcZvzVNhsR9zjc",
    // No observed TEXT temporary value yet; intentionally not write-enabled per PB-D30.
    tempValue: null,
  },
};

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

// PB-D29 — evidence path is derived, not stored: a directory constant plus a filename
// derived from stage and field. Registry-key underscores become hyphens to match the
// existing script-name convention (property_notes → property-notes). Existing
// -step<N>.json filenames are retained; stage maps to step number here, internally.
const EVIDENCE_DIR = "C:/Users/brad/AppData/Local/Temp";
const STEP_BY_STAGE = { capture: 1, write: 2 };
const evidencePathFor = (stage, fieldKey) =>
  `${EVIDENCE_DIR}/inert-proof-${fieldKey.replace(/_/g, "-")}-step${STEP_BY_STAGE[stage]}.json`;

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

// PB-D26 — four stages, exclusive responsibilities. Capture and write are implemented;
// the verify and restore bodies are placeholders only.
async function capture(config) {
  const { fieldKey, fieldId, contactId, LOC: locationId } = config;
  const outPath = evidencePathFor("capture", fieldKey);
  try {
    // ── (1) singular contact GET — the primary before-state instrument ──
    const contactBody = await getJson(PROXY(`/contacts/${contactId}`), "contact GET");
    const c = contactBody.contact || contactBody;
    if (c.id !== contactId) {
      console.log(`ABORT — contact id mismatch: response id=${c.id} expected=${contactId}`);
      process.exit(20);
    }
    const customFields = Array.isArray(c.customFields) ? c.customFields : [];
    const tags = Array.isArray(c.tags) ? c.tags : [];
    const fieldPresent = customFields.some((f) => f.id === fieldId);

    // ── (2) opportunity stage via /opportunities/search — snake_case location_id + contact_id
    //         (camelCase → 422; CONTACTS_OPPORTUNITIES_SPEC.md RECON FINDINGS 2026-07-21) ──
    const oppPath = `/opportunities/search%3Flocation_id%3D${locationId}%26contact_id%3D${contactId}`;
    const oppBody = await getJson(PROXY(oppPath), "opportunity search");
    const opp = Array.isArray(oppBody.opportunities) ? oppBody.opportunities[0] : null;
    const oppTotal = oppBody.meta ? oppBody.meta.total : null;
    if (oppTotal !== 1) {
      console.log(`ABORT — expected exactly 1 opportunity, got ${oppTotal}`);
      process.exit(21);
    }
    const opportunityId    = opp ? opp.id : null;
    const pipelineId       = opp ? opp.pipelineId : null;
    const pipelineStageId  = opp ? opp.pipelineStageId : null;
    const pipelineStageUId = opp ? opp.pipelineStageUId : null;

    // ── evidence record ──
    const evidence = {
      timestamp: new Date().toISOString(),
      fieldKey,
      contactId,
      fieldId,
      fieldPresent,
      customFields,          // complete array, exactly as returned
      tags,
      offerIds: OFFER_IDS,
      opportunityId,
      pipelineId,
      pipelineStageId,
      pipelineStageUId,
      oppMetaTotal: oppBody.meta ? oppBody.meta.total : null,
    };
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");

    // ── stdout summary ──
    console.log("CAPTURE — before-state captured (READ-ONLY, no PUT)");
    console.log(`  fieldKey           ${fieldKey}`);
    console.log(`  contactId          ${contactId}`);
    console.log(`  field              ${fieldPresent ? "PRESENT" : "ABSENT"} (id ${fieldId})`);
    console.log(`  custom-field count ${customFields.length}`);
    console.log(`  tag count          ${tags.length}`);
    console.log(`  pipelineStageId    ${pipelineStageId}`);
    console.log(`  evidence written   ${outPath}`);
  } catch (e) {
    console.error("CAPTURE ERROR:", e.message);
    process.exit(22);
  }
}

async function write(config) {
  const { fieldKey, fieldId, contactId, tempValue } = config;
  const capturePath = evidencePathFor("capture", fieldKey);
  const outPath = evidencePathFor("write", fieldKey);
  let responseStatus = null;
  let responseReceived = false;
  try {
    // ── 1. PRECONDITION — config (registry write-enablement, PB-D30) ──
    if (tempValue == null) {
      console.log(`write aborted: config.tempValue is not defined for fieldKey=${fieldKey}`);
      process.exit(30);
    }

    // ── 2. PRECONDITION — file (capture evidence) ──
    if (!fs.existsSync(capturePath)) { console.log(`ABORT — capture evidence not found: ${capturePath}`); process.exit(30); }
    let cap;
    try { cap = JSON.parse(fs.readFileSync(capturePath, "utf8")); }
    catch (e) { console.log(`ABORT — capture evidence does not parse: ${e.message}`); process.exit(30); }
    if (cap.contactId !== contactId) { console.log(`ABORT — capture contactId ${cap.contactId} !== ${contactId}`); process.exit(30); }
    if (cap.fieldId !== fieldId)     { console.log(`ABORT — capture fieldId ${cap.fieldId} !== ${fieldId}`); process.exit(30); }
    if (cap.fieldPresent !== false)  { console.log(`ABORT — capture fieldPresent is ${cap.fieldPresent}, expected false`); process.exit(30); }
    const capCustom = Array.isArray(cap.customFields) ? cap.customFields : null;
    const capTags   = Array.isArray(cap.tags) ? cap.tags : null;
    if (!capCustom || !capTags) { console.log("ABORT — capture customFields/tags not arrays"); process.exit(30); }

    // ── 3. PRECONDITION — live (contact unchanged since capture; contact-only per PB-D30) ──
    const contactBody = await getJson(PROXY(`/contacts/${contactId}`), "contact GET");
    const c = contactBody.contact || contactBody;
    if (c.id !== contactId) { console.log(`ABORT — live contact id ${c.id} !== ${contactId}`); process.exit(31); }
    const liveCustom = Array.isArray(c.customFields) ? c.customFields : [];
    const liveTags = Array.isArray(c.tags) ? c.tags : [];
    if (liveCustom.some((f) => f.id === fieldId)) { console.log(`ABORT — fieldId already present live; refusing to overwrite`); process.exit(31); }
    if (!deepEqual(liveCustom, capCustom)) { console.log("ABORT — live customFields no longer deep-equal the capture snapshot"); process.exit(31); }
    if (!deepEqual(liveTags, capTags))     { console.log("ABORT — live tags no longer deep-equal the capture snapshot"); process.exit(31); }

    // ── 4. All preconditions passed — perform EXACTLY ONE PUT ──
    console.log("PRECONDITIONS PASSED — config, capture evidence, and live state; proceeding to one PUT");
    const requestBody = { customFields: [{ id: fieldId, field_value: tempValue }] };
    let putResp;
    try { putResp = await fetch(PROXY(`/contacts/${contactId}`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }); }
    catch (e) { throw new Error(`PUT fetch threw — ${e.message}`); }
    responseStatus = putResp.status;
    responseReceived = true;
    const rawText = await putResp.text();
    let responseBody;
    try { responseBody = JSON.parse(rawText); }
    catch { responseBody = rawText; }

    // ── 5. Persist evidence BEFORE classifying the response (PB-D30: 33 takes precedence) ──
    const evidence = {
      timestamp: new Date().toISOString(),
      contactId,
      fieldId,
      tempValue,
      requestBody,
      responseStatus,
      responseBody,
    };
    try { fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8"); }
    catch (e) {
      console.error(`EVIDENCE PERSISTENCE FAILED — ${e.message}; PUT response was received, HTTP ${responseStatus}`);
      process.exit(33);
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      console.log(`PUT FAILED — HTTP ${responseStatus}`);
      console.log(`  evidence written   ${outPath}`);
      process.exit(32);
    }

    // ── 6. Summary (no full body) ──
    console.log("WRITE — one PUT performed (no poll, no verify, no restore)");
    console.log(`  fieldKey           ${fieldKey}`);
    console.log(`  contactId          ${contactId}`);
    console.log(`  fieldId            ${fieldId}`);
    console.log(`  tempValue          ${tempValue}`);
    console.log(`  PUT status         ${responseStatus}`);
    console.log(`  evidence written   ${outPath}`);
  } catch (e) {
    console.error(`WRITE ERROR: ${e.message}; PUT response ${responseReceived ? `was received, HTTP ${responseStatus}` : "was not received"}`);
    process.exit(34);
  }
}

async function verify(config) {
  console.log(`verify — fieldKey ${config.fieldKey}`);
  // TODO: implement verify stage (poll + comparison).
}

async function restore(config) {
  console.log(`restore — fieldKey ${config.fieldKey}`);
  // TODO: implement restore stage (per PB-D24 restoration semantics).
}

const STAGES = { capture, write, verify, restore };

// PB-D27 — dispatcher: exactly two positional args <stage> <fieldKey>. Validation runs
// before any stage function; exactly one stage is invoked per process.
(async () => {
  const args = process.argv.slice(2);
  const stage = args[0];
  const fieldKey = args[1];

  if (!stage) { console.log("ABORT — missing stage argument; usage: <stage> <fieldKey>"); process.exit(10); }
  if (!Object.prototype.hasOwnProperty.call(STAGES, stage)) {
    console.log(`ABORT — unrecognized stage '${stage}'; expected one of capture|write|verify|restore`);
    process.exit(11);
  }
  if (args.length > 2) { console.log(`ABORT — too many positional args (${args.length}); expected exactly <stage> <fieldKey>`); process.exit(12); }
  if (!fieldKey || !Object.prototype.hasOwnProperty.call(FIELDS, fieldKey)) {
    console.log(`ABORT — unrecognized fieldKey '${fieldKey}'; expected one of ${Object.keys(FIELDS).join("|")}`);
    process.exit(13);
  }

  const config = { fieldKey, ...FIELDS[fieldKey], ORIGIN, LOC };
  await STAGES[stage](config);
})();
