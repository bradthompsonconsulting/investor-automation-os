/* PB-D59 Proof B, step 2 — WRITE. ONE PUT, THREE FIELDS. NO RE-READ.
 *
 * The write Approve performs. One custom-fields-only PUT carrying all three
 * carriers together -- not three PUTs. PB-D59 section II: three separate
 * PUTs would triple the window in which a partial state is visible and
 * would require compensating writes on failure at step two or three. One
 * request is the smaller surface.
 *
 * VALUES. Two designated NUMERICAL test values plus the one non-origin
 * picklist option:
 *
 *     endbuyer_maximum_purchase_price   571204.86    designated
 *     mao_max_allowable_offer           398715.29    designated
 *     assignment_mode                   "25% of Buyer Profit"
 *
 * The two numbers are deliberately distinct from each other so a swapped-id
 * defect is visible in the readback rather than passing as symmetric, and
 * distinct from every prior proof's value so evidence cannot be confused
 * across cycles.
 *
 * GHL DOCUMENTS NO TRANSACTION. PB-D59 section IV: one PUT is one request,
 * the closest thing to atomicity available, and it is not a database
 * transaction. If the readback comes back partial, that is an observation
 * this proof exists to make, and step 4's restoration handles whatever
 * actually landed rather than what was sent.
 *
 * EXPECTED CONSEQUENCE, not a defect. assignment_mode moves to
 * "25% of Buyer Profit" for the duration, so the workspace computes a
 * different Seller MAO. verify-underwriting.cjs is NOT a valid gate until
 * step 4 restores and step 5 confirms. DO NOT RUN IT until then.
 *
 * HTTP 200 IS TRANSPORT SUCCESS AND NOTHING MORE. Step 3 proves all three
 * landed.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb";

const ENDBUYER_ID = "zOVIPwzLe41a0SQmwVAJ";
const MAO_ID      = "Atu5XCjpFElY8H64VG4h";
const MODE_ID     = "TpLo0WRc303TXAaBUbBf";

const ENDBUYER_VALUE = 571204.86;
const MAO_VALUE      = 398715.29;
const MODE_VALUE     = "25% of Buyer Profit";
const MODE_ORIGIN    = "Standard Minimum";

const DISCOVERY_ID = "N8Aa9t1SZhU7XnPPzxWk";

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step1.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step2.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function readValue(entry) {
  if (entry === null || entry === undefined) return undefined;
  for (const k of ["fieldValue", "fieldValueNumber", "fieldValueString", "value"]) {
    if (entry[k] !== undefined) return entry[k];
  }
  return undefined;
}

(async () => {
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(480, `cannot read step 1 evidence: ${e.message}`); }

  if (cap.cycle !== "proof-b") fail(481, `step 1 evidence is from cycle ${JSON.stringify(cap.cycle)}, not proof-b`);
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(482, `step 1 names a different opportunity`);
  if ((cap.problems ?? []).length > 0) {
    fail(483, `step 1 recorded precondition problems`, JSON.stringify(cap.problems, null, 1));
  }
  if ((cap.carriers ?? []).length !== 3) fail(484, `step 1 recorded ${(cap.carriers ?? []).length} carriers, expected 3`);

  const capByKey = new Map((cap.carriers ?? []).map((c) => [c.key, c]));
  const capEnd  = capByKey.get("endbuyer_maximum_purchase_price");
  const capMao  = capByKey.get("mao_max_allowable_offer");
  const capMode = capByKey.get("assignment_mode");
  if (!capEnd || !capMao || !capMode) fail(485, `step 1 is missing one of the three carriers`);
  if (capEnd.present !== false) fail(486, `capture recorded endbuyer present=${capEnd.present}, expected absent`);
  if (capMao.present !== false) fail(487, `capture recorded mao present=${capMao.present}, expected absent`);
  if (capMode.present !== true || capMode.originValue !== MODE_ORIGIN) {
    fail(488, `capture recorded assignment_mode present=${capMode.present} value=${JSON.stringify(capMode.originValue)}`);
  }
  console.log("PRECHECK step1 ok — 2 absent, 1 populated, no recorded problems");

  // ── Live precondition: the same mixed origin, right now ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(489, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(490, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(491, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(492, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(493, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(494, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  if (liveById.has(ENDBUYER_ID)) fail(495, `endbuyer is populated live, absent at capture`, JSON.stringify(liveById.get(ENDBUYER_ID)));
  if (liveById.has(MAO_ID)) fail(496, `mao is populated live, absent at capture`, JSON.stringify(liveById.get(MAO_ID)));
  if (liveById.has(DISCOVERY_ID)) fail(497, `closing_costs carries a value again`, JSON.stringify(liveById.get(DISCOVERY_ID)));

  const liveMode = readValue(liveById.get(MODE_ID) ?? null);
  if (liveMode !== MODE_ORIGIN) {
    fail(498, `assignment_mode does not hold the captured origin`,
      `observed=${JSON.stringify(liveMode)} expected=${JSON.stringify(MODE_ORIGIN)}`);
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(499, `deal fact ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — both NUMERICAL carriers absent, mode holds ${JSON.stringify(MODE_ORIGIN)}, deal facts unchanged`);

  // ── The body. Three entries, one request. ──
  const body = {
    customFields: [
      { id: ENDBUYER_ID, field_value: ENDBUYER_VALUE },
      { id: MAO_ID,      field_value: MAO_VALUE },
      { id: MODE_ID,     field_value: MODE_VALUE },
    ],
  };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(500, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 3) fail(501, `body must carry exactly three fields, got ${body.customFields.length}`);

  const EXPECTED = new Map([
    [ENDBUYER_ID, ENDBUYER_VALUE],
    [MAO_ID, MAO_VALUE],
    [MODE_ID, MODE_VALUE],
  ]);
  const seen = new Set();
  for (const entry of body.customFields) {
    if (!EXPECTED.has(entry.id)) fail(502, `body carries an unexpected field id ${entry.id}`);
    if (seen.has(entry.id)) fail(503, `body carries duplicate entries for ${entry.id}`);
    seen.add(entry.id);
    if (entry.field_value !== EXPECTED.get(entry.id)) {
      fail(504, `body carries the wrong value for ${entry.id}`,
        `got=${JSON.stringify(entry.field_value)} expected=${JSON.stringify(EXPECTED.get(entry.id))}`);
    }
    if (entry.field_value === "") fail(505, `body carries an empty value for ${entry.id}; this step clears nothing`);
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(506, `entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") fail(506, `entry carries unexpected key ${k}`);
    }
  }
  if (seen.size !== 3) fail(507, `body covers ${seen.size} distinct ids, expected 3`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(506, `forbidden top-level key ${k}`);

  const serialized = JSON.stringify(body);
  console.log(`BODY ok — three entries, three distinct ids`);
  console.log(`  ${serialized}`);

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
    cycle: "proof-b",
    proof: "PB-D59 Proof B",
    note: "The combined Approve payload. One PUT, three carriers. HTTP 200 is transport success; step 3 proves all three landed.",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    sent: {
      endbuyer_maximum_purchase_price: { id: ENDBUYER_ID, value: ENDBUYER_VALUE },
      mao_max_allowable_offer:         { id: MAO_ID,      value: MAO_VALUE },
      assignment_mode:                 { id: MODE_ID,     value: MODE_VALUE },
    },
    modeOrigin: MODE_ORIGIN,
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
    process.exit(508);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  How much of the payload landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    console.log("  Do NOT run verify-underwriting.cjs.");
    process.exit(509);
  }

  console.log(`WRITE issued — PUT status ${putStatus}`);
  console.log(`  endbuyer_maximum_purchase_price  <- ${ENDBUYER_VALUE}`);
  console.log(`  mao_max_allowable_offer          <- ${MAO_VALUE}`);
  console.log(`  assignment_mode                  <- ${JSON.stringify(MODE_VALUE)}  (was ${JSON.stringify(MODE_ORIGIN)})`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("");
  console.log("  The fixture is now in the TEMPORARY proof state.");
  console.log("  Do NOT run verify-underwriting.cjs until step 4 restores and step 5 confirms.");
  console.log("  No re-read issued. Step 3 verifies all three landed.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 510);
})().catch((e) => {
  console.error("WRITE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(511);
});
