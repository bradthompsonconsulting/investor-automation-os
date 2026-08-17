/* PB-D59 Proof A, step 3 — VERIFY. READ ONLY. NO WRITES.
 *
 * A 200 is transport success. This is where it becomes an observation: the
 * exact label landed, nothing else moved, and the wire shape is recorded
 * DURING the mutation for comparison against step 1's before and step 5's
 * after.
 *
 * EXACT STRING EQUALITY. A picklist value can be subtly wrong in ways a
 * number cannot -- a trailing space, a different percent sign, a case
 * difference. The comparison is strict and the observed value is printed
 * with its JSON quoting so any such difference is visible rather than
 * inferred.
 *
 * BATTERY, six items. The four PB-D58 names plus fixtureUnchanged and
 * priorTargetsAbsent. The pass condition is stricter than PB-D58 specifies
 * and the evidence keeps the four in `confirmations` with the extras as
 * siblings.
 *
 * THE HARNESS STAYS PARKED. The fixture is mid-proof and
 * verify-underwriting.cjs cannot pass while assignment_mode holds
 * "25% of Buyer Profit". This step does not run it and neither should
 * anyone until step 5 confirms the restoration.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const TARGET_ID      = "TpLo0WRc303TXAaBUbBf";
const TARGET_KEY     = "assignment_mode";

const ORIGIN_OPTION = "Standard Minimum";
const TEMP_OPTION   = "25% of Buyer Profit";

const PRIOR_TARGETS = {
  endbuyer_maximum_purchase_price: "zOVIPwzLe41a0SQmwVAJ",
  mao_max_allowable_offer:         "Atu5XCjpFElY8H64VG4h",
  closing_costs:                   "N8Aa9t1SZhU7XnPPzxWk",
};

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step2.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function shapeOf(entry) {
  if (entry === null || entry === undefined) return { present: false, keys: [], entry: null };
  return { present: true, keys: Object.keys(entry).sort(), entry };
}

function optionOf(entry) {
  if (entry === null || entry === undefined) return undefined;
  return entry.fieldValue ?? entry.fieldValueString ?? entry.value ?? undefined;
}

(async () => {
  let cap, wrote;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(390, `cannot read step 1 evidence: ${e.message}`); }
  try { wrote = JSON.parse(fs.readFileSync(STEP2, "utf8")); }
  catch (e) { fail(391, `cannot read step 2 evidence: ${e.message}`); }

  if (cap.cycle !== "proof-a" || wrote.cycle !== "proof-a") {
    fail(392, `evidence is not from cycle proof-a`, `step1=${cap.cycle} step2=${wrote.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(393, `step 1 names a different opportunity`);
  if (wrote.putStatus === null) fail(394, `step 2 recorded no PUT status; it threw. Do not proceed blind.`);
  if (wrote.tempOption !== TEMP_OPTION) fail(395, `step 2 wrote ${JSON.stringify(wrote.tempOption)}, this step expects ${JSON.stringify(TEMP_OPTION)}`);
  console.log(`PRECHECK ok — step 2 PUT ${wrote.putStatus}, wrote ${JSON.stringify(wrote.tempOption)}`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let observed = undefined;
  let observedEntry = null;
  let matched = false;

  while (polls < MAX_POLLS) {
    polls++;
    let res, text;
    try {
      res = await fetch(oppUrl);
      text = await res.text();
    } catch (e) {
      console.log(`  poll ${polls}/${MAX_POLLS}  transport error: ${(e && e.message) || e}`);
      if (polls < MAX_POLLS) { await sleep(POLL_MS); continue; }
      fail(396, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(397, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(398, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    observedEntry = entry;
    observed = optionOf(entry);
    console.log(`  poll ${polls}/${MAX_POLLS}  observed=${JSON.stringify(observed)}  entry=${JSON.stringify(entry)}`);

    if (observed === TEMP_OPTION) { matched = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  if (opp === null) fail(399, `no successful read across ${MAX_POLLS} polls`);

  // ── Wire shape DURING the mutation, both endpoints ──
  const singularShape = shapeOf(observedEntry);
  let listShape = { present: false, keys: [], entry: null };
  let listOption = undefined;
  try {
    const listRes = await fetch(LIST);
    const listText = await listRes.text();
    if (listRes.ok) {
      const listBody = JSON.parse(listText);
      const listOpp = (listBody.opportunities ?? []).find((o) => o.id === OPPORTUNITY_ID) ?? null;
      const listEntry = listOpp ? ((listOpp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null) : null;
      listShape = shapeOf(listEntry);
      listOption = optionOf(listEntry);
    } else {
      console.log(`  list endpoint → ${listRes.status}; shape not recorded this step`);
    }
  } catch (e) {
    console.log(`  list endpoint threw: ${(e && e.message) || e}; shape not recorded this step`);
  }

  // ── Battery ──
  const liveFields = opp.customFields ?? [];
  const capById  = new Map((cap.customFields ?? []).map((f) => [f.id, f]));
  const liveById = new Map(liveFields.map((f) => [f.id, f]));
  const unionIds = [...new Set([...capById.keys(), ...liveById.keys()])].filter((id) => id !== TARGET_ID);

  const drifted = [];
  for (const id of unionIds) {
    const a = JSON.stringify(capById.get(id) ?? null);
    const b = JSON.stringify(liveById.get(id) ?? null);
    if (a !== b) drifted.push({ id, captured: capById.get(id) ?? null, live: liveById.get(id) ?? null });
  }
  const othersUnchanged = drifted.length === 0;
  const offerNowPresent = (cap.offerIds ?? []).filter((id) => liveById.has(id));
  const offersUnchanged = offerNowPresent.length === 0;
  const stageUnchanged  = opp.pipelineStageId === cap.pipelineStageId;
  const statusUnchanged = opp.status === cap.status;
  const batteryFour = othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;

  const fixtureDrift = (cap.fixtureState ?? []).filter((f) =>
    JSON.stringify(liveById.get(f.id) ?? null) !== JSON.stringify(f.entry ?? null));
  const fixtureUnchanged = fixtureDrift.length === 0;

  const priorResidue = Object.entries(PRIOR_TARGETS)
    .filter(([, id]) => liveById.has(id))
    .map(([name, id]) => ({ name, id, entry: liveById.get(id) }));
  const priorTargetsAbsent = priorResidue.length === 0;

  const record = {
    timestamp: new Date().toISOString(),
    stage: "verify",
    cycle: "proof-a",
    proof: "PB-D59 Proof A",
    note: "READ ONLY. Fixture is mid-proof; verify-underwriting.cjs is not a valid gate until step 5 confirms restoration.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: cap.dataType,
    originOption: ORIGIN_OPTION,
    tempOption: TEMP_OPTION,
    polls,
    matched,
    observedValue: observed === undefined ? null : observed,
    observedType: typeof observed,
    observedEntry,
    wireShapeDuring: {
      singularGet: singularShape,
      listEndpoint: listShape,
      listValue: listOption === undefined ? null : listOption,
      keysDiffer: JSON.stringify(singularShape.keys) !== JSON.stringify(listShape.keys),
    },
    wireShapeBefore: cap.wireShape ?? null,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    fixtureUnchanged,
    fixtureDrift,
    priorTargetsAbsent,
    priorResidue,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(400, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`VERIFY  matched=${matched}  polls=${polls}`);
  console.log(`  observed          ${JSON.stringify(observed)}  (${typeof observed})`);
  console.log(`  expected          ${JSON.stringify(TEMP_OPTION)}`);
  console.log(`  entry             ${JSON.stringify(observedEntry)}`);
  console.log("");
  console.log("  WIRE SHAPE DURING:");
  console.log(`    singular keys   ${JSON.stringify(singularShape.keys)}`);
  console.log(`    list keys       ${JSON.stringify(listShape.keys)}`);
  console.log(`    list value      ${JSON.stringify(listOption)}`);
  console.log(`    keysDiffer      ${record.wireShapeDuring.keysDiffer}`);
  console.log("");
  console.log(`  othersUnchanged   ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged   ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged    ${stageUnchanged}`);
  console.log(`  statusUnchanged   ${statusUnchanged}`);
  console.log(`  fixtureUnchanged  ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  priorTargetsAbsent ${priorTargetsAbsent}${priorTargetsAbsent ? "" : "  residue=" + JSON.stringify(priorResidue)}`);
  console.log(`  evidence          ${EVIDENCE}`);

  const allConfirmed = batteryFour && fixtureUnchanged && priorTargetsAbsent;

  console.log("");
  if (!matched) {
    console.log("  Poll exhausted without exact label equality. That is an observation.");
    console.log("  The fixture may be in an unknown state. Do NOT re-run step 2.");
    console.log("  Read the evidence and decide before step 4.");
    process.exit(401);
  }
  if (!allConfirmed) {
    console.log("  The label landed BUT a confirmation failed. The write was not inert.");
    process.exit(402);
  }
  console.log(`  PB-D58 four-item battery: ${batteryFour}.  Plus fixtureUnchanged and priorTargetsAbsent.`);
  console.log("  The exact label landed and nothing else moved.");
  console.log("  Fixture remains in the TEMPORARY state. Step 4 restores.");
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY THREW:", (e && e.stack) || e);
  process.exit(403);
});
