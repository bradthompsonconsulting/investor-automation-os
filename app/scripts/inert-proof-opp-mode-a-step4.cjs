/* PB-D59 Proof A, step 4 — RESTORE. ONE PUT. NO RE-READ.
 *
 * Writes "Standard Minimum" back over "25% of Buyer Profit".
 *
 * RESTORATION IS TO A VALUE, NOT TO ABSENCE, and that distinction is the
 * whole reason Proof A exists as its own cycle. PB-D58 and A0 restored
 * absent-origin NUMERICAL fields by clearing to KEY_ABSENT, which required
 * validated clear semantics. This origin is POPULATED, so restoration means
 * the original option string returns exactly. No empty value is ever sent.
 *
 * SINGLE_OPTIONS CLEAR SEMANTICS REMAIN UNKNOWN after this step and after
 * this proof. Approve writes a mode over whatever mode is there and never
 * clears one. Nobody may read this cycle as having established how to clear
 * a picklist.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 5 observes whether the original
 * label is back, and only that classifies the cycle.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1 and step 3 evidence are both from cycle proof-a
 *   step 3 recorded matched with its full six-item gate green
 *   the live target currently holds the TEMPORARY option
 *   the three prior proof targets are still absent
 *   the two deal facts, stage and status are unmoved
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb";
const TARGET_ID      = "TpLo0WRc303TXAaBUbBf";
const TARGET_KEY     = "assignment_mode";

const ORIGIN_OPTION = "Standard Minimum";
const TEMP_OPTION   = "25% of Buyer Profit";

const PRIOR_TARGETS = {
  endbuyer_maximum_purchase_price: "zOVIPwzLe41a0SQmwVAJ",
  mao_max_allowable_offer:         "Atu5XCjpFElY8H64VG4h",
  closing_costs:                   "N8Aa9t1SZhU7XnPPzxWk",
};

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step4.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function optionOf(entry) {
  if (entry === null || entry === undefined) return undefined;
  return entry.fieldValue ?? entry.fieldValueString ?? entry.value ?? undefined;
}

(async () => {
  let cap, ver;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(410, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(411, `cannot read step 3 evidence: ${e.message}`); }

  if (cap.cycle !== "proof-a" || ver.cycle !== "proof-a") {
    fail(412, `evidence is not from cycle proof-a`, `step1=${cap.cycle} step3=${ver.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(413, `step 1 names a different opportunity`);
  if (ver.matched !== true) fail(414, `step 3 recorded matched=${ver.matched}; the temporary state is unconfirmed`);
  if (cap.originValue !== ORIGIN_OPTION) {
    fail(415, `step 1 recorded origin ${JSON.stringify(cap.originValue)}, this step restores ${JSON.stringify(ORIGIN_OPTION)}`);
  }

  const c = ver.confirmations || {};
  const gateGreen = c.othersUnchanged && c.offersUnchanged && c.stageUnchanged && c.statusUnchanged
    && ver.fixtureUnchanged === true && ver.priorTargetsAbsent === true;
  if (!gateGreen) {
    fail(416, `step 3's six-item gate was not fully green`,
      JSON.stringify({ confirmations: c, fixtureUnchanged: ver.fixtureUnchanged, priorTargetsAbsent: ver.priorTargetsAbsent }));
  }
  console.log(`PRECHECK step3 ok — ${JSON.stringify(ver.observedValue)} landed, six-item gate green`);
  console.log(`PRECHECK contract — restoring to the ORIGINAL VALUE ${JSON.stringify(ORIGIN_OPTION)}, not clearing`);

  // ── Live precondition ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(417, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(418, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(419, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(420, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(421, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(422, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  const liveOption = optionOf(liveById.get(TARGET_ID) ?? null);
  if (liveOption !== TEMP_OPTION) {
    fail(423, `target does not currently hold the temporary option`,
      `observed=${JSON.stringify(liveOption)} expected=${JSON.stringify(TEMP_OPTION)}`);
  }
  for (const [name, id] of Object.entries(PRIOR_TARGETS)) {
    if (liveById.has(id)) fail(424, `previously restored field ${name} carries a value again`, JSON.stringify(liveById.get(id)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(425, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — target holds ${JSON.stringify(TEMP_OPTION)}, everything else unmoved`);

  // ── The body ──
  const body = { customFields: [{ id: TARGET_ID, field_value: ORIGIN_OPTION }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(426, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(427, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(428, `body targets the wrong field`);
  if (body.customFields[0].field_value !== ORIGIN_OPTION) {
    fail(429, `body carries ${JSON.stringify(body.customFields[0].field_value)}, expected ${JSON.stringify(ORIGIN_OPTION)}`);
  }
  if (body.customFields[0].field_value === "") {
    fail(430, `the body carries an empty value; this cycle never clears a SINGLE_OPTIONS field`);
  }
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(431, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(431, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(431, `unexpected entry key ${k}`);
    }
  }
  const serialized = JSON.stringify(body);
  console.log(`BODY ok — ${serialized}`);

  // ── The one PUT ──
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
    cycle: "proof-a",
    proof: "PB-D59 Proof A",
    note: "Restoration is value-to-original-value. No empty value sent. SINGLE_OPTIONS clear semantics remain UNKNOWN.",
    restorationContract: "value-to-original-value",
    mechanism: `field_value: ${JSON.stringify(ORIGIN_OPTION)}`,
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    valueBeforeRestore: TEMP_OPTION,
    valueRestoredTo: ORIGIN_OPTION,
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
    process.exit(432);
  }

  console.log("");
  if (threw !== null) {
    console.log(`RESTORE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 5 observes; do not re-run step 4.");
    console.log("  The fixture may still be in the temporary state. Do NOT run the harness.");
    process.exit(433);
  }

  console.log(`RESTORE issued — PUT status ${putStatus}`);
  console.log(`  from      ${JSON.stringify(TEMP_OPTION)}`);
  console.log(`  to        ${JSON.stringify(ORIGIN_OPTION)}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 5 confirms the original label is back.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 434);
})().catch((e) => {
  console.error("RESTORE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(435);
});
