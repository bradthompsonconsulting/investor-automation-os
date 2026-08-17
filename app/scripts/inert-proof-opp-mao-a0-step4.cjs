/* PB-D59 Proof A0, step 4 — RESTORE. ONE PUT. NO RE-READ.
 *
 * Returns mao_max_allowable_offer to KEY_ABSENT using `field_value: ""` --
 * the mechanism PB-D58 OBSERVED on this same opportunity, on NUMERICAL
 * fields, reproduced twice with restoredToOrigin true.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 5 observes whether the key is
 * absent, and only that classifies the cycle.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1 and step 3 evidence are both from cycle a0
 *   step 3 recorded matched with its full six-item gate green
 *   the live target still holds the test value
 *   both PB-D58 targets are still absent
 *   the fixture trio, stage and status are unmoved
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb";
const TARGET_ID      = "Atu5XCjpFElY8H64VG4h";
const TARGET_KEY     = "mao_max_allowable_offer";
const TEST_VALUE     = 486210.73;

const PBD58_TARGETS = {
  endbuyer_maximum_purchase_price: "zOVIPwzLe41a0SQmwVAJ",
  closing_costs:                   "N8Aa9t1SZhU7XnPPzxWk",
};

const CLEAR_VALUE = "";
const CLEAR_LABEL = 'field_value: ""';

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step4.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function entryValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValue", "fieldValueNumber", "field_value", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  let cap, ver;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(280, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(281, `cannot read step 3 evidence: ${e.message}`); }

  if (cap.cycle !== "a0" || ver.cycle !== "a0") {
    fail(282, `evidence is not from cycle a0`, `step1=${cap.cycle} step3=${ver.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(283, `step 1 names a different opportunity`);
  if (ver.matched !== true) fail(284, `step 3 recorded matched=${ver.matched}; there is nothing proven to restore`);

  const c = ver.confirmations || {};
  const gateGreen = c.othersUnchanged && c.offersUnchanged && c.stageUnchanged && c.statusUnchanged
    && ver.fixtureUnchanged === true && ver.pbd58TargetsAbsent === true;
  if (!gateGreen) {
    fail(285, `step 3's six-item gate was not fully green`,
      JSON.stringify({ confirmations: c, fixtureUnchanged: ver.fixtureUnchanged, pbd58TargetsAbsent: ver.pbd58TargetsAbsent }));
  }
  console.log(`PRECHECK step3 ok — ${ver.observedValue} landed under key ${JSON.stringify(ver.observedKey)}, six-item gate green`);
  console.log(`PRECHECK mechanism — ${CLEAR_LABEL}, OBSERVED PB-D58 on two opportunity NUMERICAL fields`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(286, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(287, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(288, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(289, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(290, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(291, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  const liveRead = entryValue(liveById.get(TARGET_ID) ?? null);
  if (liveRead.value !== TEST_VALUE) {
    fail(292, `target does not currently hold the test value`,
      `observed=${JSON.stringify(liveRead.value)} key=${JSON.stringify(liveRead.key)} expected=${TEST_VALUE}`);
  }
  for (const [name, id] of Object.entries(PBD58_TARGETS)) {
    if (liveById.has(id)) fail(293, `PB-D58 target ${name} carries a value again`, JSON.stringify(liveById.get(id)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(294, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — target holds ${TEST_VALUE}, everything else unmoved`);

  const body = { customFields: [{ id: TARGET_ID, field_value: CLEAR_VALUE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(295, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(296, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(297, `body targets the wrong field`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(298, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(298, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(298, `unexpected entry key ${k}`);
    }
  }
  const serialized = JSON.stringify(body);
  console.log(`BODY ok — ${serialized}`);

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

  const record = {
    timestamp: new Date().toISOString(),
    stage: "restore",
    cycle: "a0",
    proof: "PB-D59 Proof A0",
    note: "PB-D59 section V. HTTP 200 is not success; step 5 classifies.",
    mechanism: CLEAR_LABEL,
    mechanismBasis: "OBSERVED PB-D58 2026-08-17, same opportunity, two NUMERICAL fields",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    valueBeforeRestore: TEST_VALUE,
    valueBeforeRestoreKey: liveRead.key,
    requestBody: body,
    putStatus,
    putResponseRaw: putText === null ? null : putText.slice(0, 4000),
    threw,
    capturedStageId: cap.pipelineStageId,
    capturedStatus: cap.status,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(299);
  }

  console.log("");
  if (threw !== null) {
    console.log(`RESTORE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 5 observes; do not re-run step 4.");
    process.exit(300);
  }

  console.log(`RESTORE issued — PUT status ${putStatus}`);
  console.log(`  mechanism ${CLEAR_LABEL}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 5 observes whether the key is absent.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 301);
})().catch((e) => {
  console.error("RESTORE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(302);
});
