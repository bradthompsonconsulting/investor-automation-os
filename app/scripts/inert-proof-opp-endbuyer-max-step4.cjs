/* PB-D58 section II, step 4 — RESTORE. ONE PUT. NO RE-READ.
 *
 * Returns endbuyer_maximum_purchase_price to KEY_ABSENT using
 * `field_value: ""` — the mechanism section I's discovery cycle OBSERVED
 * 2026-08-17 on this same opportunity, on a NUMERICAL field, with all four
 * confirmations green and restoredToOrigin true.
 *
 * This is not a guess. It is the reason the discovery cycle existed: PB-D24
 * rejects value-only rollback, so an absent-origin proof needs a validated
 * path back to absence before it writes at all. Section I supplied it.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 5 observes whether the key is
 * absent, and only that classifies the cycle.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1 and step 3 evidence are both from the proof cycle
 *   step 3 recorded matched with its full gate green
 *   the live target still holds the test value
 *   stage, status, the fixture trio and the discovery field are unmoved
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb";
const TARGET_ID      = "zOVIPwzLe41a0SQmwVAJ";
const TARGET_KEY     = "endbuyer_maximum_purchase_price";
const DISCOVERY_ID   = "N8Aa9t1SZhU7XnPPzxWk";
const TEST_VALUE     = 313370.42;

const CLEAR_VALUE = "";              // OBSERVED mechanism, section I
const CLEAR_LABEL = 'field_value: ""';

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step4.json";

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
  catch (e) { fail(160, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(161, `cannot read step 3 evidence: ${e.message}`); }

  if (cap.opportunityId !== OPPORTUNITY_ID) fail(162, `step 1 names a different opportunity`);
  if (cap.cycle !== "proof" || ver.cycle !== "proof") {
    fail(163, `evidence is not from the proof cycle`, `step1=${cap.cycle} step3=${ver.cycle}`);
  }
  if (ver.matched !== true) fail(164, `step 3 recorded matched=${ver.matched}; there is nothing proven to restore`);

  const c = ver.confirmations || {};
  const gateGreen = c.othersUnchanged && c.offersUnchanged && c.stageUnchanged && c.statusUnchanged
    && ver.fixtureUnchanged === true && ver.discoveryStillAbsent === true;
  if (!gateGreen) {
    fail(165, `step 3's gate was not fully green`,
      JSON.stringify({ confirmations: c, fixtureUnchanged: ver.fixtureUnchanged, discoveryStillAbsent: ver.discoveryStillAbsent }));
  }
  console.log(`PRECHECK step3 ok — ${ver.observedValue} landed under key ${JSON.stringify(ver.observedKey)}, six-item gate green`);
  console.log(`PRECHECK mechanism — ${CLEAR_LABEL}, OBSERVED section I on this opportunity, NUMERICAL`);

  // ── Live precondition ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(166, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(167, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(168, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(169, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(170, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(171, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  const liveRead = entryValue(liveById.get(TARGET_ID) ?? null);
  if (liveRead.value !== TEST_VALUE) {
    fail(172, `target does not currently hold the test value`,
      `observed=${JSON.stringify(liveRead.value)} key=${JSON.stringify(liveRead.key)} expected=${TEST_VALUE}`);
  }
  if (liveById.has(DISCOVERY_ID)) {
    fail(173, `the discovery field carries a value again`, JSON.stringify(liveById.get(DISCOVERY_ID)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(174, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — target holds ${TEST_VALUE}, everything else unmoved`);

  // ── The body ──
  const body = { customFields: [{ id: TARGET_ID, field_value: CLEAR_VALUE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(175, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(176, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(177, `body targets the wrong field`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(178, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(178, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(178, `unexpected entry key ${k}`);
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
    cycle: "proof",
    note: "PB-D58 section II. HTTP 200 is not success; step 5 classifies.",
    mechanism: CLEAR_LABEL,
    mechanismBasis: "OBSERVED section I discovery cycle, 2026-08-17, same opportunity, NUMERICAL",
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
    process.exit(179);
  }

  console.log("");
  if (threw !== null) {
    console.log(`RESTORE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 5 observes; do not re-run step 4.");
    process.exit(180);
  }

  console.log(`RESTORE issued — PUT status ${putStatus}`);
  console.log(`  mechanism ${CLEAR_LABEL}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 5 observes whether the key is absent.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 181);
})().catch((e) => {
  console.error("RESTORE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(182);
});
