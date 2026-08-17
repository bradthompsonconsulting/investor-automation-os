/* PB-D58 section II, step 2 — WRITE. ONE PUT. NO RE-READ, NO POLL.
 *
 * The proof cycle's mutation. One custom-fields-only PUT setting
 * endbuyer_maximum_purchase_price to a designated test value, evidence
 * persisted, stop. Step 3 verifies.
 *
 * TEST VALUE: 313370.42. Designated, not observed. Six digits plus cents so
 * the field's precision is exercised, and deliberately far from anything
 * this fixture computes — the workspace resolves End-Buyer Maximum Purchase
 * Price to $150,143 on these inputs, so a value near that would be
 * indistinguishable from a real approved figure in the evidence.
 *
 * THE PUT BODY CARRIES ONLY customFields, AND ONLY THE TARGET ID.
 * Key-based guard, not substring-based. The mechanism the whole proof rests
 * on is that a custom-fields-only PUT cannot fire stage triggers; a body
 * carrying anything else forfeits it.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1's evidence exists, names this opportunity and field, absent origin
 *   the live target is still absent
 *   the live stage and status still match capture
 *   the three fixture fields still carry exactly what capture recorded
 *   the discovery field is still absent
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb";
const TARGET_ID      = "zOVIPwzLe41a0SQmwVAJ";
const TARGET_KEY     = "endbuyer_maximum_purchase_price";
const DISCOVERY_ID   = "N8Aa9t1SZhU7XnPPzxWk";

const TEST_VALUE = 313370.42;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step1.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step2.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(110, `cannot read step 1 evidence: ${e.message}`); }

  if (cap.opportunityId !== OPPORTUNITY_ID) fail(111, `step 1 names a different opportunity: ${cap.opportunityId}`);
  if (cap.fieldId !== TARGET_ID) fail(112, `step 1 names a different field: ${cap.fieldId}`);
  if (cap.dataType !== "NUMERICAL") fail(113, `step 1 recorded dataType ${JSON.stringify(cap.dataType)}`);
  if (cap.fieldPresent !== false) {
    fail(114, `step 1 recorded fieldPresent=${cap.fieldPresent}; section II requires an absent origin`);
  }
  if (cap.cycle !== "proof") fail(115, `step 1 evidence is from cycle ${JSON.stringify(cap.cycle)}, not proof`);
  console.log(`PRECHECK step1 ok — absent origin, NUMERICAL, clear mechanism ${cap.clearMechanism}`);

  // ── Live precondition ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(116, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(117, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(118, `live identity mismatch: ${JSON.stringify(pre.id)}`);
  if (pre.contactId !== CONTACT_ID) fail(119, `live contact mismatch: ${JSON.stringify(pre.contactId)}`);
  if (pre.pipelineStageId !== cap.pipelineStageId) {
    fail(120, `live stage moved since capture`, `${JSON.stringify(pre.pipelineStageId)} vs ${JSON.stringify(cap.pipelineStageId)}`);
  }
  if (pre.status !== cap.status) {
    fail(121, `live status moved since capture`, `${JSON.stringify(pre.status)} vs ${JSON.stringify(cap.status)}`);
  }

  const liveFields = pre.customFields ?? [];
  const liveById = new Map(liveFields.map((f) => [f.id, f]));

  if (liveById.has(TARGET_ID)) {
    fail(122, `target is populated live, absent at capture`, JSON.stringify(liveById.get(TARGET_ID)));
  }
  if (liveById.has(DISCOVERY_ID)) {
    fail(123, `the discovery field carries a value again`, JSON.stringify(liveById.get(DISCOVERY_ID)));
  }

  /* The three fixture fields must be byte-identical to capture. They are the
     resolved-branch harness's inputs; drift in them would mean this proof is
     running against a different record than the one captured. */
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) {
      fail(124, `fixture field ${f.key} drifted since capture`, `captured=${captured} live=${live}`);
    }
  }
  console.log("PRECHECK live ok — target absent, discovery field absent, fixture trio unchanged, stage and status unmoved");

  // ── The body ──
  const body = { customFields: [{ id: TARGET_ID, field_value: TEST_VALUE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(125, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(126, `body must carry exactly one field, got ${body.customFields.length}`);
  if (body.customFields[0].id !== TARGET_ID) fail(127, `body targets the wrong field: ${body.customFields[0].id}`);
  for (const k of topKeys) {
    if (FORBIDDEN.has(k)) fail(128, `body carries forbidden top-level key ${k}`);
  }
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(128, `customFields entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") {
        fail(128, `customFields entry carries unexpected key ${k}; only id and field_value are permitted`);
      }
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
    cycle: "proof",
    note: "PB-D58 section II. This cycle discharges prerequisite 5 if all five steps complete.",
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
    process.exit(129);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    process.exit(130);
  }

  console.log(`WRITE issued — PUT status ${putStatus}`);
  console.log(`  value     ${TEST_VALUE}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 3 verifies.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 131);
})().catch((e) => {
  console.error("WRITE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(132);
});
