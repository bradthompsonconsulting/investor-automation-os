/* PB-D59 Proof A, step 2 — WRITE. ONE PUT. NO RE-READ, NO POLL.
 *
 * The first SINGLE_OPTIONS mutation anywhere in IAOS.
 *
 * VALUE: the literal label "25% of Buyer Profit". OBSERVED step 1: GHL
 * stores this picklist by LABEL, not by option id -- the current value
 * "Standard Minimum" appears verbatim in the schema's option list and in
 * the record. So the payload carries the string, and no id translation
 * layer exists to get wrong.
 *
 * NOT a designated test value in PB-D30's sense. It is one of the three
 * real options PB-D56 section II names, chosen because it keeps the fixture
 * fully RESOLVED while exercising a materially different spread branch.
 * "Manual" was rejected: with no manual-amount carrier it resolves to
 * unresolved, changing the fixture's state class rather than its values.
 *
 * EXPECTED CONSEQUENCE, not a defect. The workspace will compute a
 * different Seller MAO while this value is in place: the spread becomes
 * max(requiredProfit x 0.25, standardMinimum), which on this fixture is
 * 9375 rather than 5000. PB-D59 section V records that
 * verify-underwriting.cjs is NOT a valid gate mid-proof and its failure
 * then is not a regression. Step 4 issues the restoring PUT and step 5
 * confirms it landed; DO NOT RUN the harness until step 5 has confirmed.
 *
 * RESTORATION IS TO A VALUE, NOT TO ABSENCE. Step 4 writes
 * "Standard Minimum" back. This cycle never sends an empty value and
 * establishes nothing about how to clear a SINGLE_OPTIONS field.
 *
 * HTTP 200 IS TRANSPORT SUCCESS AND NOTHING MORE. Step 3 proves the exact
 * label landed.
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
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step2.json";

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
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(360, `cannot read step 1 evidence: ${e.message}`); }

  if (cap.cycle !== "proof-a") fail(361, `step 1 evidence is from cycle ${JSON.stringify(cap.cycle)}, not proof-a`);
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(362, `step 1 names a different opportunity`);
  if (cap.fieldId !== TARGET_ID) fail(363, `step 1 names a different field: ${cap.fieldId}`);
  if (cap.dataType !== "SINGLE_OPTIONS") fail(364, `step 1 recorded dataType ${JSON.stringify(cap.dataType)}`);
  if (cap.fieldPresent !== true) {
    fail(365, `step 1 recorded fieldPresent=${cap.fieldPresent}; PB-D59 specifies Proof A as POPULATED origin`);
  }
  if (cap.originValue !== ORIGIN_OPTION) {
    fail(366, `step 1 recorded origin ${JSON.stringify(cap.originValue)}, expected ${JSON.stringify(ORIGIN_OPTION)}`);
  }
  if (cap.picklistMatchesPBD56 !== true) fail(367, `step 1 found the picklist drifted from PB-D56`);
  if (cap.tempIsAnOption !== true) fail(368, `step 1 found ${JSON.stringify(TEMP_OPTION)} is not a valid option`);
  console.log(`PRECHECK step1 ok — populated origin ${JSON.stringify(cap.originValue)}, picklist matches PB-D56, target option valid`);

  // ── Live precondition ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(369, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(370, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(371, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(372, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(373, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(374, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  const liveOption = optionOf(liveById.get(TARGET_ID) ?? null);
  if (liveOption !== ORIGIN_OPTION) {
    fail(375, `target does not currently hold the captured origin option`,
      `observed=${JSON.stringify(liveOption)} expected=${JSON.stringify(ORIGIN_OPTION)}`);
  }
  for (const [name, id] of Object.entries(PRIOR_TARGETS)) {
    if (liveById.has(id)) fail(376, `previously restored field ${name} carries a value again`, JSON.stringify(liveById.get(id)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(377, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — target holds ${JSON.stringify(ORIGIN_OPTION)}, prior targets absent, deal facts unchanged`);

  // ── The body. Key-based guard, same as every prior proof. ──
  const body = { customFields: [{ id: TARGET_ID, field_value: TEMP_OPTION }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(378, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(379, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(380, `body targets the wrong field`);
  if (body.customFields[0].field_value !== TEMP_OPTION) {
    fail(381, `body carries ${JSON.stringify(body.customFields[0].field_value)}, expected ${JSON.stringify(TEMP_OPTION)}`);
  }
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(382, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(382, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(382, `unexpected entry key ${k}`);
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
    stage: "write",
    cycle: "proof-a",
    proof: "PB-D59 Proof A",
    note: "First SINGLE_OPTIONS mutation in IAOS. Populated origin; restoration is to the original label, not a clear. Does NOT authorize Approve.",
    restorationContract: "value-to-original-value",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    originOption: ORIGIN_OPTION,
    tempOption: TEMP_OPTION,
    valueKind: "real picklist option, not a designated test value",
    requestBody: body,
    putStatus,
    putResponseRaw: putText === null ? null : putText.slice(0, 4000),
    threw,
    capturedStageId: cap.pipelineStageId,
    capturedStatus: cap.status,
    harnessNote: "verify-underwriting.cjs is NOT a valid gate until step 4 restores and step 5 confirms. Its failure meanwhile is expected, not a regression.",
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(383);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    process.exit(384);
  }

  console.log(`WRITE issued — PUT status ${putStatus}`);
  console.log(`  from      ${JSON.stringify(ORIGIN_OPTION)}`);
  console.log(`  to        ${JSON.stringify(TEMP_OPTION)}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("");
  console.log("  The fixture is now in the TEMPORARY proof state.");
  console.log("  Do NOT run verify-underwriting.cjs until step 4 restores and step 5 confirms.");
  console.log("  No re-read issued. Step 3 verifies the exact label landed.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 385);
})().catch((e) => {
  console.error("WRITE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(386);
});
