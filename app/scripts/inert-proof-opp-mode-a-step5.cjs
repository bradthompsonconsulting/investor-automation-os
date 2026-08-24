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
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

/* ── Environment resolution (Gate 4C C4a, Stair 7) ─────────────────────────
   TIER 1 PREAMBLE, module scope. getConfig(ENV) runs BEFORE the carrier lookup
   so an unknown --env surfaces [ghl-config]'s OWN message unwrapped, and
   --env=test reaches a VALID Test config and then refuses at the carrier's
   absent Test section.

   LOADER *AND* CARRIER, following the identifier's owner rather than the
   file's role.

   ⚠ THIS FILE IS A TAIL, AND THE FAMILY IS NOT UNIFORM. The head resolves
   config.locationId for its schema GET; THIS FILE DOES NOT AND MUST NOT — it
   makes no schema request. It loads config for its own config-owned values
   only: the target assignment_mode, and the two prior proof carriers in
   PRIOR_TARGETS below.

   NO CONTACTS GUARD HERE, deliberately — this file resolves no contact id, and
   a guard on a section it never reads would refuse on something it does not
   trust. Section guards are per file, not per family. */
const envArg = process.argv.slice(2).find((a) => a.startsWith("--env="));
if (envArg === undefined) {
  console.error("REFUSED: --env=<environment> is required. Expected --env=production or --env=test. There is no default.");
  process.exit(4);
}
const ENV = envArg.slice("--env=".length);

let config;
try {
  config = ghlConfig.getConfig(ENV);
} catch (e) {
  console.error(e.message);
  process.exit(4);
}

const envFixtures          = fixtures[ENV];
const fixtureRecords       = envFixtures && envFixtures.fixtureRecords;
const fixtureOpportunities = fixtureRecords && fixtureRecords.opportunities;
if (!fixtureOpportunities || !fixtureOpportunities.iaosUnderwritingTest) {
  console.error(`REFUSED: harness-fixtures.json carries no fixtureRecords.opportunities.iaosUnderwritingTest for "${ENV}" (scripts/harness-fixtures.json). Refusing rather than inventing it.`);
  process.exit(4);
}

const envPins           = envFixtures.untouchedPins;
const opportunityFields = envPins && envPins.opportunityFields;
if (!opportunityFields || !opportunityFields.closing_costs) {
  console.error(`REFUSED: harness-fixtures.json carries no opportunityFields.closing_costs for "${ENV}" — expected ${ENV}.untouchedPins.opportunityFields.closing_costs. Refusing rather than inventing them.`);
  process.exit(4);
}

const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest;
const TARGET_ID      = config.opportunityFields.assignmentMode;
const TARGET_KEY     = "assignment_mode";

const ORIGIN_OPTION = "Standard Minimum";
const TEMP_OPTION   = "25% of Buyer Profit";

/* ONE resolution site, THREE values — MIXED OWNERSHIP. endBuyerMaxPrice and
   sellerMAO are CONFIG-owned; closing_costs is CARRIER-owned. Contributes
   (3 - 1) = 2 to the occurrence-vs-resolution-site gap. */
const PRIOR_TARGETS = {
  endbuyer_maximum_purchase_price: config.opportunityFields.endBuyerMaxPrice,
  mao_max_allowable_offer:         config.opportunityFields.sellerMAO,
  closing_costs:                   opportunityFields.closing_costs,
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
  /* FOUR READ SITES, ONE LOOP — sites ⑦⑧⑨⑩. This file reads all four upstream
     artifacts, and the loop below is four distinct read sites, not one. Every
     one is a CHECK: the identity block beneath consumes opportunityId and
     fieldId from EACH artifact, so an environment-owned value crosses at all
     four.

     The assertion therefore lives INSIDE the loop and fires once per artifact,
     labelled with that artifact, before any environment-owned value from it is
     trusted. Four separate calls outside the loop would say the same thing and
     drift apart the first time someone edited one of them.

     ⚠ Note step 2's and step 3's artifacts are read through a NOTE at step 3
     and step 4 respectively, and through a CHECK here. Same artifacts,
     different read sites, different class. A NOTE classifies the read site. */
  const EVIDENCE_LABEL = { s1: "step-1 evidence", s2: "step-2 evidence", s3: "step-3 evidence", s4: "step-4 evidence" };
  const ev = {};
  for (const [name, path] of [["s1", STEP1], ["s2", STEP2], ["s3", STEP3], ["s4", STEP4]]) {
    try { ev[name] = JSON.parse(fs.readFileSync(path, "utf8")); }
    catch (e) { fail(440, `cannot read ${name} evidence: ${e.message}`); }
    assertEnvironment(ev[name], ENV, EVIDENCE_LABEL[name]);
  }

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. The identity block below compares opportunityId and
     fieldId on all four artifacts. Against step-1 (SITE ⑦) that is 2 COMPARED
     to 15 ADOPTED BY VALUE — the 3 ids inside customFields, the 7 inside
     offerIds, pipelineStageId, the 2 inside fixtureState, and the ids inside
     TWO ENTRY-OBJECT CARRIERS: originEntry (adopted at the shape comparison and
     re-persisted as capturedEntry) and wireShape (adopted into wireShape.before).
     BY FIELD that same site reads 2 to 6. Against s2 and s4 it is 2 to 0.
     Against s3 (SITE ⑨) it is 2 to 1 — wireShapeDuring, a third entry-object
     carrier, is adopted into wireShape.during.
     Family-wide: 12 COMPARED to 36 ADOPTED by value, 12 to 16 by field.

     ⚠ capturedEntry IS NOT A SECOND ADOPTION. It is cap.originEntry read once
     and persisted under a new name. Counting it separately would double-count
     the same id.

     ⚠ COMPARED means compared against a LOCALLY RESOLVED CONSTANT. The
     originEntry shape check below compares against the LIVE WIRE entry, so it
     is ADOPTED, not COMPARED — as is pipelineStageId's live check. Both
     establish drift consistency between capture and now and nothing about
     which environment produced the value.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and liveStageId are
     environment-owned by value with NO source literal in this family.
     Conversion does nothing for them; the in-loop assertion above is their only
     protection. Do not record them as converted.

     SIX VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in this
     family: customFields, offerIds, fixtureState, pipelineStageId, originEntry
     and the wireShape carriers. This file consumes all six off the step-1 and
     step-3 artifacts and writes its own conclusions from them, so the ratio
     here is not an abstraction — it is the provenance of the Proof A
     completion record. */
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
    ...stamp(ENV),
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
