/* PB-D58 section I, step 2 — WRITE. ONE PUT. NO RE-READ, NO POLL.
 *
 * The first mutating step of the opportunity-side arc. Issues exactly one
 * custom-fields-only PUT setting closing_costs to a designated test value,
 * persists the response as evidence, and stops. Verification is step 3's
 * job — PB-D26 requires each step to persist evidence before terminating,
 * and a step that writes and then reads back conflates two observations.
 *
 * TEST VALUE: 8271.31. Designated, not observed. Approved 2026-08-17 per
 * PB-D30's 2026-08-03 amendment: valid for a NUMERICAL closing-cost field,
 * recognizable during verification, and arbitrary enough that it cannot be
 * confused with production data.
 *
 * THE PUT BODY CARRIES ONLY customFields, AND ONLY THE TARGET ID.
 * No pipelineStageId, no status, no name, no monetaryValue. OBSERVED at
 * architecture reference line 118: a custom-fields-only PUT cannot fire
 * stage triggers. That is the mechanism this whole proof rests on, and a
 * body carrying anything else forfeits it. The body is built from literals
 * below and asserted before the request is issued.
 *
 * PRECONDITIONS, all read from step 1's evidence and re-verified live:
 *   the evidence file exists and names this opportunity and field
 *   fieldPresent === false — absent origin, per PB-D58 section I
 *   the live opportunity still shows the target absent
 *   the live stage and status still match what was captured
 * Any precondition failing aborts BEFORE the PUT.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb";
const TARGET_ID      = "N8Aa9t1SZhU7XnPPzxWk";
const TARGET_KEY     = "closing_costs";

const TEST_VALUE = 8271.31;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step1.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step2.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  // ── Precondition: step 1's evidence ──
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(30, `cannot read step 1 evidence: ${e.message}`); }

  if (cap.opportunityId !== OPPORTUNITY_ID) fail(31, `step 1 names a different opportunity: ${cap.opportunityId}`);
  if (cap.fieldId !== TARGET_ID) fail(32, `step 1 names a different field: ${cap.fieldId}`);
  if (cap.dataType !== "NUMERICAL") fail(33, `step 1 recorded dataType ${JSON.stringify(cap.dataType)}`);
  if (cap.fieldPresent !== false) {
    fail(34, `step 1 recorded fieldPresent=${cap.fieldPresent}; PB-D58 section I requires an absent origin`);
  }
  console.log("PRECHECK step1 ok — absent origin, NUMERICAL, identities match");

  // ── Precondition: the live record still matches what was captured ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(35, `precheck GET → ${preRes.status}`, preText.slice(0, 400));

  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(36, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(37, `live identity mismatch: ${JSON.stringify(pre.id)}`);
  if (pre.contactId !== CONTACT_ID) fail(38, `live contact mismatch: ${JSON.stringify(pre.contactId)}`);
  if (pre.pipelineStageId !== cap.pipelineStageId) {
    fail(39, `live stage moved since capture: ${JSON.stringify(pre.pipelineStageId)} vs ${JSON.stringify(cap.pipelineStageId)}`);
  }
  if (pre.status !== cap.status) {
    fail(40, `live status moved since capture: ${JSON.stringify(pre.status)} vs ${JSON.stringify(cap.status)}`);
  }
  const liveTarget = (pre.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  if (liveTarget !== null) {
    fail(41, `target is populated live, absent at capture`, JSON.stringify(liveTarget));
  }
  console.log("PRECHECK live ok — target still absent, stage and status unmoved");

  // ── The body. Built from literals, asserted before the request. ──
  const body = { customFields: [{ id: TARGET_ID, field_value: TEST_VALUE }] };

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "customFields") {
    fail(42, `body must carry only customFields, got ${JSON.stringify(keys)}`);
  }
  if (body.customFields.length !== 1) {
    fail(43, `body must carry exactly one field, got ${body.customFields.length}`);
  }
  if (body.customFields[0].id !== TARGET_ID) {
    fail(44, `body targets the wrong field: ${body.customFields[0].id}`);
  }
  /* Key-based, not substring-based. A serialized.includes("status") scan
     would abort on any field id or value containing that substring, and
     would also match inside pipelineStageId — simultaneously too broad and
     redundant. This walks actual keys at both levels instead. The pattern
     gets reused in step 4, so the trap is worth removing here. */
  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  for (const k of Object.keys(body)) {
    if (FORBIDDEN.has(k)) fail(45, `body carries forbidden top-level key ${k}`);
  }
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(45, `customFields entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") {
        fail(45, `customFields entry carries unexpected key ${k}; only id and field_value are permitted`);
      }
    }
  }
  const serialized = JSON.stringify(body);
  console.log(`BODY ok — ${serialized}`);

  // ── The one PUT. No re-read after it. ──
  let putStatus = null;
  let putText = null;
  let threw = null;
  try {
    const putRes = await fetch(oppUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    });
    putStatus = putRes.status;
    putText = await putRes.text();
  } catch (e) {
    threw = (e && e.message) || String(e);
  }

  // Evidence persists whatever happened. A failed PUT is an observation,
  // not an aborted run — PB-D26, and evidence-persistence failure outranks
  // response classification on any mutating step.
  const record = {
    timestamp: new Date().toISOString(),
    stage: "write",
    cycle: "discovery",
    note: "PB-D58 section I. NOT prerequisite 5.",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    testValue: TEST_VALUE,
    testValueKind: "designated",
    requestBody: body,
    putStatus,
    putResponseRaw: putText === null ? null : putText.slice(0, 4000),
    threw,
    capturedStageId: cap.pipelineStageId,
    capturedStatus: cap.status,
  };

  try {
    fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8");
  } catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(46);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    process.exit(47);
  }

  console.log(`WRITE issued — PUT status ${putStatus}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 3 verifies.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 48);
})().catch((e) => {
  console.error("WRITE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(49);
});
