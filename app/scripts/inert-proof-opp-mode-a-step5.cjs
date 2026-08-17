/* PB-D59 Proof A, step 5 — CONFIRM. READ ONLY. NO WRITES.
 *
 * The step that completes Proof A, or does not. Proof A is the second of
 * the three proofs PB-D59 section V requires before Approve may be
 * rendered.
 *
 * RESTORATION HERE MEANS THE ORIGINAL LABEL RETURNED, not that the key is
 * absent. Three outcomes, never collapsed:
 *
 *   RESTORED   the target holds "Standard Minimum" again, exactly.
 *   TEMPORARY  it still holds "25% of Buyer Profit". The restore did not
 *              land. The fixture is NOT back to origin.
 *   OTHER      it holds something else, or is absent. Either is worse than
 *              TEMPORARY: absent would mean an unauthorized clear occurred,
 *              which this cycle never attempted.
 *
 * ABSENCE IS A FAILURE HERE, and that inverts PB-D58 and A0 where absence
 * was success. Populated origin, populated restoration.
 *
 * THE HARNESS IS THE CLOSING GATE. PB-D59 section V: Proof A's final step
 * reruns verify-underwriting.cjs after restoration and requires the probe
 * to return to RESOLVED with the independent PB-D56 arithmetic check
 * passing. This step does NOT run it -- running a Playwright harness from
 * inside a proof script would conflate two things. It confirms the record
 * and then tells you to run it as the separate closing step.
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
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step3.json";
const STEP4    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step4.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step5.json";

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
  const ev = {};
  for (const [name, path] of [["s1", STEP1], ["s2", STEP2], ["s3", STEP3], ["s4", STEP4]]) {
    try { ev[name] = JSON.parse(fs.readFileSync(path, "utf8")); }
    catch (e) { fail(440, `cannot read ${name} evidence: ${e.message}`); }
  }
  for (const [name, rec] of Object.entries(ev)) {
    if (rec.cycle !== "proof-a") fail(441, `${name} evidence is from cycle ${JSON.stringify(rec.cycle)}`);
    if (rec.opportunityId !== OPPORTUNITY_ID) fail(442, `${name} names a different opportunity`);
    if (rec.fieldId !== TARGET_ID) fail(443, `${name} names a different field`);
  }
  if (ev.s1.fieldPresent !== true) fail(444, `capture recorded fieldPresent=${ev.s1.fieldPresent}; Proof A is populated origin`);
  if (ev.s1.originValue !== ORIGIN_OPTION) fail(445, `capture recorded origin ${JSON.stringify(ev.s1.originValue)}`);
  if (ev.s2.putStatus === null) fail(446, `the write threw; the chain is broken`);
  if (ev.s3.matched !== true) fail(447, `verify recorded matched=${ev.s3.matched}`);
  if (ev.s4.putStatus === null) fail(448, `the restore threw; step 5 still observes but the chain is not clean`);
  console.log("PRECHECK chain ok — populated origin, write ok, verify matched, restore issued");

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let observed = undefined;
  let observedEntry = null;
  let restored = false;

  while (polls < MAX_POLLS) {
    polls++;
    let res, text;
    try {
      res = await fetch(oppUrl);
      text = await res.text();
    } catch (e) {
      console.log(`  poll ${polls}/${MAX_POLLS}  transport error: ${(e && e.message) || e}`);
      if (polls < MAX_POLLS) { await sleep(POLL_MS); continue; }
      fail(449, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(450, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(451, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    observedEntry = entry;
    observed = optionOf(entry);
    console.log(`  poll ${polls}/${MAX_POLLS}  observed=${JSON.stringify(observed)}  entry=${JSON.stringify(entry)}`);

    if (observed === ORIGIN_OPTION) { restored = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  if (opp === null) fail(452, `no successful read across ${MAX_POLLS} polls`);

  let outcome;
  if (restored) outcome = "RESTORED";
  else if (observed === TEMP_OPTION) outcome = "TEMPORARY";
  else outcome = "OTHER";

  // ── Wire shape AFTER, both endpoints, for the before/during/after set ──
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
    }
  } catch (e) {
    console.log(`  list endpoint threw: ${(e && e.message) || e}; after-shape not recorded`);
  }

  // ── Battery ──
  const cap = ev.s1;
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

  /* The target entry must match capture's byte-for-byte, not merely carry
     the same label. That is the strongest available statement of
     restore-to-value. */
  const entryIdenticalToCapture =
    JSON.stringify(observedEntry) === JSON.stringify(cap.originEntry ?? null);

  const restoredToOrigin = restored && entryIdenticalToCapture && batteryFour
    && fixtureUnchanged && priorTargetsAbsent;

  const complete = {
    populatedAtCapture:      cap.fieldPresent === true && cap.originValue === ORIGIN_OPTION,
    onePutSetTempOption:     ev.s2.putStatus >= 200 && ev.s2.putStatus < 300 && ev.s2.tempOption === TEMP_OPTION,
    readBackExactLabel:      ev.s3.matched === true && ev.s3.observedValue === TEMP_OPTION,
    verifyBatteryGreen:      !!(ev.s3.confirmations && ev.s3.confirmations.othersUnchanged
                               && ev.s3.confirmations.offersUnchanged && ev.s3.confirmations.stageUnchanged
                               && ev.s3.confirmations.statusUnchanged),
    restorePutIssued:        ev.s4.putStatus >= 200 && ev.s4.putStatus < 300,
    originalLabelReturned:   restored,
    targetEntryIdentical:    entryIdenticalToCapture,
    restoreBatteryGreen:     batteryFour,
    noEmptyValueEverSent:    ev.s4.valueRestoredTo === ORIGIN_OPTION && ev.s2.tempOption === TEMP_OPTION,
  };
  const proofAComplete = Object.values(complete).every(Boolean);

  const record = {
    timestamp: new Date().toISOString(),
    stage: "confirm",
    cycle: "proof-a",
    proof: "PB-D59 Proof A",
    note: "Proof A complete does NOT authorize Approve. Proof B remains. SINGLE_OPTIONS clear semantics remain UNKNOWN.",
    restorationContract: "value-to-original-value",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: cap.dataType,
    originOption: ORIGIN_OPTION,
    tempOption: TEMP_OPTION,
    outcome,
    polls,
    observedValue: observed === undefined ? null : observed,
    observedEntry,
    capturedEntry: cap.originEntry ?? null,
    entryIdenticalToCapture,
    wireShape: {
      before: cap.wireShape ?? null,
      during: ev.s3.wireShapeDuring ?? null,
      after: {
        singularGet: singularShape,
        listEndpoint: listShape,
        listValue: listOption === undefined ? null : listOption,
        keysDiffer: JSON.stringify(singularShape.keys) !== JSON.stringify(listShape.keys),
      },
    },
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    fixtureUnchanged,
    fixtureDrift,
    priorTargetsAbsent,
    priorResidue,
    restoredToOrigin,
    complete,
    proofAComplete,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
    closingGate: "Rerun verify-underwriting.cjs. PB-D59 section V requires the probe to return to RESOLVED with the independent PB-D56 arithmetic check passing.",
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(453, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`CONFIRM  outcome=${outcome}  polls=${polls}`);
  console.log(`  observed           ${JSON.stringify(observed)}`);
  console.log(`  expected           ${JSON.stringify(ORIGIN_OPTION)}`);
  console.log(`  entry              ${JSON.stringify(observedEntry)}`);
  console.log(`  capturedEntry      ${JSON.stringify(cap.originEntry ?? null)}`);
  console.log(`  entryIdentical     ${entryIdenticalToCapture}`);
  console.log("");
  console.log("  WIRE SHAPE, before / during / after:");
  console.log(`    singular keys    ${JSON.stringify((cap.wireShape && cap.wireShape.singularGet && cap.wireShape.singularGet.keys) || null)}  ${JSON.stringify((ev.s3.wireShapeDuring && ev.s3.wireShapeDuring.singularGet && ev.s3.wireShapeDuring.singularGet.keys) || null)}  ${JSON.stringify(singularShape.keys)}`);
  console.log(`    list keys        ${JSON.stringify((cap.wireShape && cap.wireShape.listEndpoint && cap.wireShape.listEndpoint.keys) || null)}  ${JSON.stringify((ev.s3.wireShapeDuring && ev.s3.wireShapeDuring.listEndpoint && ev.s3.wireShapeDuring.listEndpoint.keys) || null)}  ${JSON.stringify(listShape.keys)}`);
  console.log("");
  console.log(`  othersUnchanged    ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged    ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged     ${stageUnchanged}`);
  console.log(`  statusUnchanged    ${statusUnchanged}`);
  console.log(`  fixtureUnchanged   ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  priorTargetsAbsent ${priorTargetsAbsent}${priorTargetsAbsent ? "" : "  residue=" + JSON.stringify(priorResidue)}`);
  console.log(`  restoredToOrigin   ${restoredToOrigin}`);
  console.log(`  evidence           ${EVIDENCE}`);
  console.log("");
  console.log("Proof A completion conditions:");
  for (const [k, v] of Object.entries(complete)) {
    console.log(`  ${v ? "MET    " : "NOT MET"}  ${k}`);
  }
  console.log("");

  if (outcome === "RESTORED" && restoredToOrigin && proofAComplete) {
    console.log("  All Proof A conditions MET. assignment_mode is proven inert.");
    console.log("  All three PB-D59 carriers now have standalone proofs.");
    console.log("");
    console.log("  CLOSING GATE, not yet run: rerun verify-underwriting.cjs.");
    console.log("  PB-D59 section V requires the probe to return to RESOLVED with the");
    console.log("  independent PB-D56 arithmetic check passing. The fixture is restored,");
    console.log("  so the harness is a valid gate again.");
    console.log("");
    console.log("  Proof A does NOT authorize Approve. Proof B is next.");
    process.exit(0);
  }
  if (outcome === "OTHER" && !singularShape.present) {
    console.log("  The target is ABSENT. This cycle never sent an empty value, so an");
    console.log("  unauthorized clear has occurred or something else wrote the record.");
    console.log("  Do NOT re-run step 4. Read the evidence and decide.");
    process.exit(454);
  }
  if (outcome === "TEMPORARY") {
    console.log(`  The target still holds ${JSON.stringify(TEMP_OPTION)}. The restore did not land.`);
    console.log("  The fixture is NOT back to origin and the harness will fail.");
    console.log("  Do NOT re-run step 4 blindly. Read the evidence and decide.");
    process.exit(455);
  }
  console.log(`  Outcome ${outcome}, restoredToOrigin=${restoredToOrigin}. Proof A is NOT complete.`);
  process.exit(456);
})().catch((e) => {
  console.error("CONFIRM THREW:", (e && e.stack) || e);
  process.exit(457);
});
