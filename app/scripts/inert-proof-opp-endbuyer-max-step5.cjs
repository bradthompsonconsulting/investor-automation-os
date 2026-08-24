/* PB-D58 section II, step 5 — CONFIRM. READ ONLY. NO WRITES.
 *
 * The step that discharges PB-D56 prerequisite 5, or does not.
 *
 * PB-D58 section IV: the prerequisite is discharged when, and only when,
 * the field was observed absent at capture; one PUT set the designated test
 * value; read-back equality was observed; the clear PUT was issued; the key
 * is observed absent again on a bounded poll; and the confirmation battery
 * passes on both the verify and restore reads. This step is the last of
 * those and asserts the whole chain from evidence rather than from memory.
 *
 * Three outcomes, never collapsed. CLEARED means the id is gone from
 * customFields. EMPTIED means the id is present carrying "" or 0 or null,
 * which is NOT absence — PB-D24 makes KEY_ABSENT and empty-value-present
 * different states. UNCHANGED means it still holds the test value.
 *
 * restoredToOrigin is stricter than CLEARED: the field must be absent AND
 * the rest of the record must be where capture left it. Absence alone is
 * not restoration.
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

/* ── Environment resolution (Gate 4C C4a, Stair 5) ─────────────────────────
   getConfig(ENV) runs BEFORE the carrier lookup so an unknown --env surfaces
   [ghl-config]'s OWN message unwrapped, and --env=test reaches a VALID Test
   config and then refuses at the carrier's absent Test section.

   LOADER *AND* CARRIER, like every member of this family. The idiom follows the
   identifier's owner, not the file's role.

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
const TARGET_ID      = config.opportunityFields.endBuyerMaxPrice;
const TARGET_KEY     = "endbuyer_maximum_purchase_price";
const DISCOVERY_ID   = opportunityFields.closing_costs;
const TEST_VALUE     = 313370.42;

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step2.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step3.json";
const STEP4    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step4.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step5.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
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
  /* FOUR READ SITES, ONE LOOP. This file reads all four upstream artifacts, and
     the loop below is four distinct read sites, not one. Every one of them is a
     CHECK: the identity block at L67-L68 consumes opportunityId and fieldId from
     EACH artifact, so an environment-owned value crosses at all four.

     The assertion therefore lives INSIDE the loop and fires once per artifact,
     labelled with that artifact, before any environment-owned value from it is
     trusted. Four separate calls outside the loop would say the same thing and
     drift apart the first time someone edits one of them.

     ⚠ Note step 2's and step 3's artifacts are read through a NOTE at step 3 and
     step 4 respectively, and through a CHECK here. Same artifacts, different
     read sites, different class. A NOTE classifies the read site. */
  const ev = {};
  const EVIDENCE_LABEL = { s1: "step-1 evidence", s2: "step-2 evidence", s3: "step-3 evidence", s4: "step-4 evidence" };
  for (const [name, path] of [["s1", STEP1], ["s2", STEP2], ["s3", STEP3], ["s4", STEP4]]) {
    try { ev[name] = JSON.parse(fs.readFileSync(path, "utf8")); }
    catch (e) { fail(190, `cannot read ${name} evidence: ${e.message}`); }
    assertEnvironment(ev[name], ENV, EVIDENCE_LABEL[name]);
  }

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. This block compares opportunityId and fieldId on all
     four artifacts. Against step-1 that is 2 COMPARED to 11 ADOPTED — the 3 ids
     inside customFields, the 7 inside offerIds, and pipelineStageId, none of
     which is compared against a locally resolved constant anywhere in this
     family. Against s2, s3 and s4 it is 2 compared to 0 adopted, because this
     file consumes nothing environment-owned from them beyond the two it checks.
     Family-wide: 12 COMPARED to 30 ADOPTED by value.

     FOUR VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in
     this family: customFields, offerIds, fixtureState and pipelineStageId.
     Not once, in any of the five files, is any of them checked against a
     locally resolved constant. This file consumes all four off the step-1
     artifact and writes its own conclusions from them, so the ratio here is
     not an abstraction — it is the provenance of the discharge record.

     ⚠ pipelineStageId has NO source literal — it arrives from the wire and is
     persisted — so no identifier-based instrument sees it. Its only comparison,
     at L138 below, is against the LIVE wire value: that detects drift and
     establishes nothing about which environment produced it. The environment
     question is answered by the in-loop assertEnvironment above and only there.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  for (const [name, rec] of Object.entries(ev)) {
    if (rec.cycle !== "proof") fail(191, `${name} evidence is from cycle ${JSON.stringify(rec.cycle)}`);
    if (rec.opportunityId !== OPPORTUNITY_ID) fail(192, `${name} names a different opportunity`);
    if (rec.fieldId !== TARGET_ID) fail(193, `${name} names a different field`);
  }
  if (ev.s1.fieldPresent !== false) fail(194, `capture recorded fieldPresent=${ev.s1.fieldPresent}`);
  if (ev.s2.putStatus === null) fail(195, `the write threw; the chain is broken`);
  if (ev.s3.matched !== true) fail(196, `verify recorded matched=${ev.s3.matched}`);
  if (ev.s4.putStatus === null) fail(197, `the restore threw; step 5 still observes but the chain is not clean`);
  console.log("PRECHECK chain ok — capture absent, write ok, verify matched, restore issued");

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let present = true;
  let observed = undefined;
  let observedKey = null;
  let observedEntry = null;
  let absent = false;

  while (polls < MAX_POLLS) {
    polls++;
    let res, text;
    try {
      res = await fetch(oppUrl);
      text = await res.text();
    } catch (e) {
      console.log(`  poll ${polls}/${MAX_POLLS}  transport error: ${(e && e.message) || e}`);
      if (polls < MAX_POLLS) { await sleep(POLL_MS); continue; }
      fail(198, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(199, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(200, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    present = entry !== null;
    observedEntry = entry;
    const read = entryValue(entry);
    observed = read.value;
    observedKey = read.key;

    console.log(`  poll ${polls}/${MAX_POLLS}  present=${present}  entry=${JSON.stringify(entry)}`);
    if (!present) { absent = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  if (opp === null) fail(201, `no successful read across ${MAX_POLLS} polls`);

  let outcome;
  if (absent) outcome = "CLEARED";
  else if (observed === TEST_VALUE) outcome = "UNCHANGED";
  else outcome = "EMPTIED";

  // ── Battery against the last polled state ──
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
  const discoveryStillAbsent = !liveById.has(DISCOVERY_ID);

  const restoredToOrigin = absent && cap.fieldPresent === false && batteryFour
    && fixtureUnchanged && discoveryStillAbsent;

  /* PB-D58 section IV's discharge conditions, each asserted from evidence
     rather than assumed from the fact that we got this far. */
  const discharge = {
    absentAtCapture:        cap.fieldPresent === false,
    onePutSetTestValue:     ev.s2.putStatus >= 200 && ev.s2.putStatus < 300 && ev.s2.testValue === TEST_VALUE,
    readBackEquality:       ev.s3.matched === true && ev.s3.observedValue === TEST_VALUE,
    verifyBatteryGreen:     !!(ev.s3.confirmations && ev.s3.confirmations.othersUnchanged
                              && ev.s3.confirmations.offersUnchanged && ev.s3.confirmations.stageUnchanged
                              && ev.s3.confirmations.statusUnchanged),
    clearPutIssued:         ev.s4.putStatus >= 200 && ev.s4.putStatus < 300,
    keyAbsentOnBoundedPoll: absent,
    restoreBatteryGreen:    batteryFour,
  };
  const dischargeable = Object.values(discharge).every(Boolean);

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "confirm",
    cycle: "proof",
    note: "PB-D58 section II and IV. This record is the discharge evidence for PB-D56 prerequisite 5.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: cap.dataType,
    mechanism: ev.s4.mechanism,
    testValue: TEST_VALUE,
    outcome,
    polls,
    keyAbsent: absent,
    observedValue: observed === undefined ? null : observed,
    observedKey,
    observedEntry,
    capturedFieldPresent: cap.fieldPresent,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    fixtureUnchanged,
    fixtureDrift,
    discoveryStillAbsent,
    restoredToOrigin,
    discharge,
    dischargeable,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(202, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`CONFIRM  outcome=${outcome}  polls=${polls}`);
  console.log(`  keyAbsent        ${absent}`);
  console.log(`  entry            ${JSON.stringify(observedEntry)}`);
  console.log(`  othersUnchanged  ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged  ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged   ${stageUnchanged}`);
  console.log(`  statusUnchanged  ${statusUnchanged}`);
  console.log(`  fixtureUnchanged ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs, mode)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  discoveryAbsent  ${discoveryStillAbsent}`);
  console.log(`  restoredToOrigin ${restoredToOrigin}`);
  console.log(`  evidence         ${EVIDENCE}`);
  console.log("");
  console.log("PB-D58 section IV discharge conditions:");
  for (const [k, v] of Object.entries(discharge)) {
    console.log(`  ${v ? "MET    " : "NOT MET"}  ${k}`);
  }
  console.log("");

  if (outcome === "CLEARED" && restoredToOrigin && dischargeable) {
    console.log("  All discharge conditions MET.");
    console.log("  PB-D56 prerequisite 5 is discharged by this evidence.");
    console.log("  Discharge does not authorize Approve — PB-D58 section IV.");
    process.exit(0);
  }
  if (outcome === "CLEARED" && !restoredToOrigin) {
    console.log("  The key is absent BUT the record is not where capture left it.");
    console.log("  The restore was not inert. The prerequisite is NOT discharged.");
    process.exit(203);
  }
  console.log(`  ${ev.s4.mechanism} did NOT return the field to absent. Outcome: ${outcome}.`);
  console.log("  The field is left populated and the prerequisite is NOT discharged.");
  console.log("  Do NOT re-run step 4. Read the evidence and decide.");
  process.exit(204);
})().catch((e) => {
  console.error("CONFIRM THREW:", (e && e.stack) || e);
  process.exit(205);
});
