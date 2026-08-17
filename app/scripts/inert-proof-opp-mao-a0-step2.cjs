/* PB-D59 Proof A0, step 2 — WRITE. ONE PUT. NO RE-READ, NO POLL.
 *
 * TEST VALUE: 486210.73. Designated, not observed. Six digits plus cents so
 * the field's precision is exercised, and far from anything this fixture
 * computes -- Seller MAO resolves to 145143 on these inputs, so a value
 * near that would be indistinguishable from a real approved figure in the
 * evidence.
 *
 * THE PUT BODY CARRIES ONLY customFields, AND ONLY THE TARGET ID.
 * Key-based guard, not substring-based. A custom-fields-only PUT cannot
 * fire stage triggers; a body carrying anything else forfeits that.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1's evidence exists, is from cycle a0, absent origin, NUMERICAL
 *   the live target is still absent
 *   both PB-D58 targets are still absent
 *   the fixture trio is byte-identical to capture
 *   stage and status match capture
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb";
const TARGET_ID      = "Atu5XCjpFElY8H64VG4h";
const TARGET_KEY     = "mao_max_allowable_offer";

const PBD58_TARGETS = {
  endbuyer_maximum_purchase_price: "zOVIPwzLe41a0SQmwVAJ",
  closing_costs:                   "N8Aa9t1SZhU7XnPPzxWk",
};

const TEST_VALUE = 486210.73;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step1.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step2.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(230, `cannot read step 1 evidence: ${e.message}`); }

  if (cap.cycle !== "a0") fail(231, `step 1 evidence is from cycle ${JSON.stringify(cap.cycle)}, not a0`);
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(232, `step 1 names a different opportunity`);
  if (cap.fieldId !== TARGET_ID) fail(233, `step 1 names a different field: ${cap.fieldId}`);
  if (cap.dataType !== "NUMERICAL") fail(234, `step 1 recorded dataType ${JSON.stringify(cap.dataType)}`);
  if (cap.fieldPresent !== false) {
    fail(235, `step 1 recorded fieldPresent=${cap.fieldPresent}; PB-D59 specifies A0 as absent-origin`);
  }
  console.log(`PRECHECK step1 ok — absent origin, NUMERICAL, clear mechanism ${cap.clearMechanism}`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(236, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(237, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(238, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(239, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(240, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(241, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  if (liveById.has(TARGET_ID)) {
    fail(242, `target is populated live, absent at capture`, JSON.stringify(liveById.get(TARGET_ID)));
  }
  for (const [name, id] of Object.entries(PBD58_TARGETS)) {
    if (liveById.has(id)) fail(243, `PB-D58 target ${name} carries a value again`, JSON.stringify(liveById.get(id)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(244, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log("PRECHECK live ok — target absent, PB-D58 targets absent, fixture trio unchanged, stage and status unmoved");

  const body = { customFields: [{ id: TARGET_ID, field_value: TEST_VALUE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(245, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(246, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(247, `body targets the wrong field`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(248, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(248, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(248, `unexpected entry key ${k}`);
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
    stage: "write",
    cycle: "a0",
    proof: "PB-D59 Proof A0",
    note: "PB-D59 section V. Does NOT authorize Approve.",
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
    clearMechanism: cap.clearMechanism,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(249);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    process.exit(250);
  }

  console.log(`WRITE issued — PUT status ${putStatus}`);
  console.log(`  value     ${TEST_VALUE}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 3 verifies.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 251);
})().catch((e) => {
  console.error("WRITE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(252);
});
