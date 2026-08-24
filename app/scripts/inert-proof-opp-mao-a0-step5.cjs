/* PB-D59 Proof A0, step 5 — CONFIRM. READ ONLY. NO WRITES.
 *
 * The step that completes A0, or does not. A0 is the first of the three
 * proofs PB-D59 section V requires before Approve may be rendered.
 *
 * Three outcomes, never collapsed. CLEARED means the id is gone from
 * customFields. EMPTIED means the id is present carrying "" or 0 or null,
 * which is NOT absence -- PB-D24 makes KEY_ABSENT and empty-value-present
 * different states. UNCHANGED means it still holds the test value.
 *
 * restoredToOrigin is stricter than CLEARED: the field must be absent AND
 * the rest of the record must be where capture left it. Absence alone is
 * not restoration.
 *
 * COMPLETING A0 DOES NOT AUTHORIZE APPROVE. PB-D59 section V requires
 * Proof A (assignment_mode, SINGLE_OPTIONS, populated origin) and Proof B
 * (the combined three-field payload) after this one, in that order.
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

/* ── Environment resolution (Gate 4C C4a, Stair 6) ─────────────────────────
   getConfig(ENV) runs BEFORE the carrier lookup so an unknown --env surfaces
   [ghl-config]'s OWN message unwrapped, and --env=test reaches a VALID Test
   config and then refuses at the carrier's absent Test section.

   LOADER *AND* CARRIER, like every member of this family. THE TAIL'S REASON IS
   NOT THE HEAD'S: no locationId is resolved here — only step 1 makes the schema
   request. The loader is required for the TARGET alone, mao_max_allowable_offer
   being a canonical-config member (opportunityFields.sellerMAO).

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
const TARGET_ID      = config.opportunityFields.sellerMAO;
const TARGET_KEY     = "mao_max_allowable_offer";
const TEST_VALUE     = 486210.73;

/* Mixed ownership in one binding: endBuyerMaxPrice is CONFIG-owned,
   closing_costs is CARRIER-owned. One resolution site, two owners. */
const PBD58_TARGETS = {
  endbuyer_maximum_purchase_price: config.opportunityFields.endBuyerMaxPrice,
  closing_costs:                   opportunityFields.closing_costs,
};

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step2.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step3.json";
const STEP4    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step4.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step5.json";

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
     CHECK: the identity block beneath consumes opportunityId and fieldId from
     EACH artifact, so an environment-owned value crosses at all four.

     The assertion therefore lives INSIDE the loop and fires once per artifact,
     labelled with that artifact, before any environment-owned value from it is
     trusted. Four separate calls outside the loop would say the same thing and
     drift apart the first time someone edits one of them.

     ⚠ Note step 2's and step 3's artifacts are read through a NOTE at step 3
     and step 4 respectively, and through a CHECK here. Same artifacts,
     different read sites, different class. A NOTE classifies the read site. */
  const EVIDENCE_LABEL = { s1: "step-1 evidence", s2: "step-2 evidence", s3: "step-3 evidence", s4: "step-4 evidence" };
  const ev = {};
  for (const [name, path] of [["s1", STEP1], ["s2", STEP2], ["s3", STEP3], ["s4", STEP4]]) {
    try { ev[name] = JSON.parse(fs.readFileSync(path, "utf8")); }
    catch (e) { fail(310, `cannot read ${name} evidence: ${e.message}`); }
    assertEnvironment(ev[name], ENV, EVIDENCE_LABEL[name]);
  }

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. The identity block below compares opportunityId and
     fieldId on all four artifacts. Against step-1 that is 2 COMPARED to 14
     ADOPTED BY VALUE — the 3 ids inside customFields, the 7 inside offerIds,
     pipelineStageId, and the 3 inside fixtureState, none compared against a
     locally resolved constant anywhere in this family. BY FIELD the same site
     reads 2 to 4. Against s2, s3 and s4 it is 2 compared to 0 adopted, because
     this file consumes nothing environment-owned from them beyond the two it
     checks — notably NOT s3's observedEntry or liveCustomFields.
     Family-wide: 12 COMPARED to 36 ADOPTED by value, 12 to 12 by field.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and its persisted
     derivative liveStageId are ENVIRONMENT-OWNED BY VALUE — matching canonical
     config stages.* — while appearing as a source literal NOWHERE in this
     family. Conversion does NOTHING for them; there is no literal to convert.
     The in-loop assertEnvironment above is the ONLY thing standing between them
     and a cross-environment consumption. Their sole comparison, at L232 below,
     is against the LIVE wire value: drift detection, never provenance.

     FOUR VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in
     this family: customFields, offerIds, fixtureState and pipelineStageId. This
     file consumes all four off the step-1 artifact and writes its own
     conclusions from them, so the ratio here is not an abstraction — it is the
     provenance of the A0 completion record.

     ⚠ ALSO UNMEASURED BY ANY RATIO: step 1 persists otherCarrierState, two
     environment-owned values (endBuyerMaxPrice, assignmentMode), which NO file
     in this family ever reads. Written, never consumed, in no ratio.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  for (const [name, rec] of Object.entries(ev)) {
    if (rec.cycle !== "a0") fail(311, `${name} evidence is from cycle ${JSON.stringify(rec.cycle)}`);
    if (rec.opportunityId !== OPPORTUNITY_ID) fail(312, `${name} names a different opportunity`);
    if (rec.fieldId !== TARGET_ID) fail(313, `${name} names a different field`);
  }
  if (ev.s1.fieldPresent !== false) fail(314, `capture recorded fieldPresent=${ev.s1.fieldPresent}`);
  if (ev.s2.putStatus === null) fail(315, `the write threw; the chain is broken`);
  if (ev.s3.matched !== true) fail(316, `verify recorded matched=${ev.s3.matched}`);
  if (ev.s4.putStatus === null) fail(317, `the restore threw; step 5 still observes but the chain is not clean`);
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
      fail(318, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(319, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(320, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
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

  if (opp === null) fail(321, `no successful read across ${MAX_POLLS} polls`);

  let outcome;
  if (absent) outcome = "CLEARED";
  else if (observed === TEST_VALUE) outcome = "UNCHANGED";
  else outcome = "EMPTIED";

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

  const pbd58Residue = Object.entries(PBD58_TARGETS)
    .filter(([, id]) => liveById.has(id))
    .map(([name, id]) => ({ name, id, entry: liveById.get(id) }));
  const pbd58TargetsAbsent = pbd58Residue.length === 0;

  const restoredToOrigin = absent && cap.fieldPresent === false && batteryFour
    && fixtureUnchanged && pbd58TargetsAbsent;

  /* A0's own completion conditions, each derived from evidence rather than
     assumed from having reached this point. Mirrors PB-D58 section IV's
     seven, adapted to this proof. */
  const complete = {
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
  const a0Complete = Object.values(complete).every(Boolean);

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "confirm",
    cycle: "a0",
    proof: "PB-D59 Proof A0",
    note: "PB-D59 section V. A0 complete does NOT authorize Approve. Proof A and Proof B remain.",
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
    pbd58TargetsAbsent,
    pbd58Residue,
    restoredToOrigin,
    complete,
    a0Complete,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(322, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`CONFIRM  outcome=${outcome}  polls=${polls}`);
  console.log(`  keyAbsent        ${absent}`);
  console.log(`  entry            ${JSON.stringify(observedEntry)}`);
  console.log(`  othersUnchanged  ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged  ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged   ${stageUnchanged}`);
  console.log(`  statusUnchanged  ${statusUnchanged}`);
  console.log(`  fixtureUnchanged ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs, mode)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  pbd58Absent      ${pbd58TargetsAbsent}${pbd58TargetsAbsent ? "" : "  residue=" + JSON.stringify(pbd58Residue)}`);
  console.log(`  restoredToOrigin ${restoredToOrigin}`);
  console.log(`  evidence         ${EVIDENCE}`);
  console.log("");
  console.log("A0 completion conditions:");
  for (const [k, v] of Object.entries(complete)) {
    console.log(`  ${v ? "MET    " : "NOT MET"}  ${k}`);
  }
  console.log("");

  if (outcome === "CLEARED" && restoredToOrigin && a0Complete) {
    console.log("  All A0 conditions MET. mao_max_allowable_offer is proven inert.");
    console.log("  Two of three PB-D59 carriers now have standalone proofs.");
    console.log("  A0 does NOT authorize Approve. Proof A (assignment_mode) is next, then Proof B.");
    process.exit(0);
  }
  if (outcome === "CLEARED" && !restoredToOrigin) {
    console.log("  The key is absent BUT the record is not where capture left it.");
    console.log("  The restore was not inert. A0 is NOT complete.");
    process.exit(323);
  }
  console.log(`  ${ev.s4.mechanism} did NOT return the field to absent. Outcome: ${outcome}.`);
  console.log("  The field is left populated and A0 is NOT complete.");
  console.log("  Do NOT re-run step 4. Read the evidence and decide.");
  process.exit(324);
})().catch((e) => {
  console.error("CONFIRM THREW:", (e && e.stack) || e);
  process.exit(325);
});
