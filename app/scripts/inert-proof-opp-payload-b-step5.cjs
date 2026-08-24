/* PB-D59 Proof B, step 5 — CONFIRM. READ ONLY. NO WRITES.
 *
 * The last step of the last proof. If this passes and the closing gate
 * passes, PB-D59's three-proof requirement is satisfied and Approve may be
 * rendered.
 *
 * MIXED SUCCESS CONDITION, per carrier. Two must be ABSENT and one must
 * hold its original label. Absence is success for two of them and failure
 * for the third, in the same record. No single boolean expresses that, so
 * each carrier is classified on its own contract.
 *
 * WHOLE-RECORD RESTORATION. Beyond the three carriers, the comparison is
 * against step 1's captured customFields over the union of ids, plus stage,
 * status, the seven offer_ ids, the two deal facts, and the discovery
 * field. Restoration means the record is where capture found it, not
 * merely that three fields cooperated.
 *
 * THE CLOSING GATE IS NOT RUN HERE. PB-D59 section V requires
 * verify-underwriting.cjs to be rerun after restoration, returning the
 * probe to RESOLVED with the independent PB-D56 arithmetic check passing.
 * Running a Playwright harness from inside a proof script would conflate
 * two things. This step confirms the record and then names the gate.
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

/* ── Environment resolution (Gate 4C C4a, Stair 8) ─────────────────────────
   TIER 1 PREAMBLE, module scope. getConfig(ENV) runs BEFORE the carrier lookup
   so an unknown --env surfaces [ghl-config]'s OWN message unwrapped, and
   --env=test reaches a VALID Test config and then refuses at the carrier's
   absent Test section.

   LOADER *AND* CARRIER, following the identifier's owner rather than the
   file's role.

   ⚠ THREE CARRIERS, NO SINGLE TARGET. This family proves a three-field
   payload in one request. There is no "the target" here and no fieldId
   anywhere in the family. All THREE proof carriers are CONFIG-owned and are
   bound below as three separate consts:
       ENDBUYER_ID -> opportunityFields.endBuyerMaxPrice
       MAO_ID      -> opportunityFields.sellerMAO
       MODE_ID     -> opportunityFields.assignmentMode
   That is why this file needs the loader.

   ⚠ THIS FILE IS A TAIL, AND THE FAMILY IS NOT UNIFORM. The head resolves
   config.locationId for its schema GET; THIS FILE DOES NOT AND MUST NOT — it
   makes no schema request. It loads config for its own three config-owned
   carriers and nothing else. That is the tail's reason, and it is not the
   head's.

   NO CONTACTS GUARD HERE, deliberately. This file resolves no contact id, and
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

const ENDBUYER_ID = config.opportunityFields.endBuyerMaxPrice;
const MAO_ID      = config.opportunityFields.sellerMAO;
const MODE_ID     = config.opportunityFields.assignmentMode;

const ENDBUYER_VALUE = 571204.86;
const MAO_VALUE      = 398715.29;
const MODE_VALUE     = "25% of Buyer Profit";
const MODE_ORIGIN    = "Standard Minimum";

const DISCOVERY_ID = opportunityFields.closing_costs;

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step2.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step3.json";
const STEP4    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step4.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step5.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function shapeOf(entry) {
  if (entry === null || entry === undefined) return { present: false, keys: [], entry: null };
  return { present: true, keys: Object.keys(entry).sort(), entry };
}

function readValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValue", "fieldValueNumber", "fieldValueString", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  /* FOUR READ SITES, ONE LOOP — sites ⑧⑨⑩⑪. This file reads all four upstream
     artifacts, and the loop below is four distinct read sites, not one. Every
     one is a CHECK: the identity block beneath consumes opportunityId from
     EACH artifact, so an environment-owned value crosses at all four.

     ⚠ ONE VALUE COMPARED PER ARTIFACT, NOT TWO. Prior families compared
     opportunityId AND fieldId here. This family has no fieldId — three
     carriers, no single target — so opportunityId is the only comparison
     available. That is why the family-wide COMPARED column is 7 rather than
     the 12 the two preceding families reached.

     The assertion lives INSIDE the loop and fires once per artifact, labelled
     with that artifact, before any environment-owned value from it is trusted.
     Four separate calls outside the loop would say the same thing and drift
     apart the first time someone edited one of them.

     ⚠ Note step 2's and step 3's artifacts are read through a NOTE at step 3
     and step 4 respectively, and through a CHECK here. Same artifacts,
     different read sites, different class. A NOTE classifies the read site. */
  const EVIDENCE_LABEL = { s1: "step-1 evidence", s2: "step-2 evidence", s3: "step-3 evidence", s4: "step-4 evidence" };
  const ev = {};
  for (const [name, path] of [["s1", STEP1], ["s2", STEP2], ["s3", STEP3], ["s4", STEP4]]) {
    try { ev[name] = JSON.parse(fs.readFileSync(path, "utf8")); }
    catch (e) { fail(580, `cannot read ${name} evidence: ${e.message}`); }
    assertEnvironment(ev[name], ENV, EVIDENCE_LABEL[name]);
  }

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. The identity block below compares opportunityId on all
     four artifacts. Against step-1 (SITE ⑧) that is 1 COMPARED to 16 ADOPTED
     BY VALUE — the three carrier ids inside cap.carriers, the 3 inside
     customFields, the 7 inside offerIds, pipelineStageId, and the 2 inside
     fixtureState. BY FIELD that reads 1 to 5. Against s2, s3 and s4 it is
     1 to 0 each: this file consumes nothing environment-owned from them beyond
     the id it checks — notably NOT s3's perCarrier, wireShapeDuring or
     liveCustomFields, and NOT s2's sent.

     ⚠ THOSE FOUR ARE NOT OPAQUE FIELDS. sent and perCarrier are
     KEYED CARRIER MAPS — three members keyed by field name, each with an environment-owned
     id nested inside beside a human key. wireShapeDuring is ENTRY OBJECTS,
     three carrier ids one per member. liveCustomFields is a BULK WIRE CAPTURE
     with five distinct ids. Count the ids INSIDE each; never classify off the
     key name or the label. Reading any of them here adds 3, 3, 3 or 5 ADOPTED
     values to this site and does not change its CHECK class, but it does
     change the ratio — recompute it if you add one.

     ⚠ wireShapeAfter, written by THIS file, is also an ENTRY OBJECT carrying
     an environment-owned carrier id. It is produced here, not consumed, so it
     appears in no ratio — but it is environment-owned content this producer
     persists, and the stamp above is what makes its provenance checkable.
     Family-wide: 7 COMPARED to 41 ADOPTED by value, 7 to 15 by field.

     ⚠ COMPARED means compared against a LOCALLY RESOLVED CONSTANT. Every
     comparison against a LIVE WIRE value below — pipelineStageId at L304 among
     them — is ADOPTED, always. Drift consistency, never provenance.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and liveStageId are
     environment-owned by value with NO source literal in this family.
     Conversion does nothing for them; the in-loop assertion above is their
     only protection. Do not report them as converted.

     SIX VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in this
     family: carriers, customFields, offerIds, fixtureState, pipelineStageId,
     and the wireShape entry-object carriers. This file consumes the first five
     off the step-1 artifact and writes its own conclusions from them, so the
     ratio here is the provenance of the Proof B completion record.

     ⚠ TERMINAL FAMILY. Nothing reads this file's output — measured, zero
     forward consumers of payload-b-step5. No downstream bootstrap depends on
     whether this record is stamped. */
  for (const [name, rec] of Object.entries(ev)) {
    if (rec.cycle !== "proof-b") fail(581, `${name} evidence is from cycle ${JSON.stringify(rec.cycle)}`);
    if (rec.opportunityId !== OPPORTUNITY_ID) fail(582, `${name} names a different opportunity`);
  }
  if ((ev.s1.problems ?? []).length > 0) fail(583, `capture recorded problems`, JSON.stringify(ev.s1.problems));
  if (ev.s2.putStatus === null) fail(584, `the write threw; the chain is broken`);
  if (ev.s3.allLanded !== true) fail(585, `verify recorded allLanded=${ev.s3.allLanded}`);
  if (ev.s4.putStatus === null) fail(586, `the restore threw; step 5 still observes but the chain is not clean`);
  console.log("PRECHECK chain ok — capture clean, three landed, restore issued");

  const cap = ev.s1;
  const capByKey = new Map((cap.carriers ?? []).map((x) => [x.key, x]));
  const capMode = capByKey.get("assignment_mode");

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  /* Each carrier's success condition, on its own contract. */
  const TARGETS = [
    { key: "endbuyer_maximum_purchase_price", id: ENDBUYER_ID, contract: "clear-to-absent",
      wantAbsent: true, tempValue: ENDBUYER_VALUE },
    { key: "mao_max_allowable_offer", id: MAO_ID, contract: "clear-to-absent",
      wantAbsent: true, tempValue: MAO_VALUE },
    { key: "assignment_mode", id: MODE_ID, contract: "value-to-original-value",
      wantAbsent: false, wantValue: MODE_ORIGIN, tempValue: MODE_VALUE },
  ];

  let polls = 0;
  let opp = null;
  let states = [];
  let allRestored = false;

  while (polls < MAX_POLLS) {
    polls++;
    let res, text;
    try {
      res = await fetch(oppUrl);
      text = await res.text();
    } catch (e) {
      console.log(`  poll ${polls}/${MAX_POLLS}  transport error: ${(e && e.message) || e}`);
      if (polls < MAX_POLLS) { await sleep(POLL_MS); continue; }
      fail(587, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(588, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(589, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const byId = new Map((opp.customFields ?? []).map((f) => [f.id, f]));
    states = TARGETS.map((t) => {
      const entry = byId.get(t.id) ?? null;
      const read = readValue(entry);
      const present = entry !== null;
      let restored, outcome;
      if (t.wantAbsent) {
        restored = !present;
        outcome = !present ? "CLEARED" : (read.value === t.tempValue ? "STILL_TEMPORARY" : "OTHER");
      } else {
        restored = present && read.value === t.wantValue;
        outcome = !present ? "ABSENT_UNEXPECTED"
          : (read.value === t.wantValue ? "RESTORED"
            : (read.value === t.tempValue ? "STILL_TEMPORARY" : "OTHER"));
      }
      return {
        key: t.key, id: t.id, contract: t.contract,
        present, observed: read.value === undefined ? null : read.value,
        observedKey: read.key, entry, restored, outcome,
      };
    });
    const count = states.filter((s) => s.restored).length;
    console.log(`  poll ${polls}/${MAX_POLLS}  restored ${count} of 3  [${states.map((s) => (s.restored ? "ok" : "--")).join(" ")}]`);

    if (count === 3) { allRestored = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  if (opp === null) fail(590, `no successful read across ${MAX_POLLS} polls`);

  // ── Whole-record comparison against capture ──
  const liveFields = opp.customFields ?? [];
  const capById  = new Map((cap.customFields ?? []).map((f) => [f.id, f]));
  const liveById = new Map(liveFields.map((f) => [f.id, f]));
  const unionIds = [...new Set([...capById.keys(), ...liveById.keys()])];

  const drifted = [];
  for (const id of unionIds) {
    const a = JSON.stringify(capById.get(id) ?? null);
    const b = JSON.stringify(liveById.get(id) ?? null);
    if (a !== b) drifted.push({ id, captured: capById.get(id) ?? null, live: liveById.get(id) ?? null });
  }
  /* wholeRecordIdentical includes the carriers: after restoration the entire
     customFields array should equal capture's, carriers and all. That is a
     stronger statement than the per-carrier checks above. */
  const wholeRecordIdentical = drifted.length === 0;

  const nonCarrierDrift = drifted.filter((d) => ![ENDBUYER_ID, MAO_ID, MODE_ID].includes(d.id));
  const othersUnchanged = nonCarrierDrift.length === 0;
  const offerNowPresent = (cap.offerIds ?? []).filter((id) => liveById.has(id));
  const offersUnchanged = offerNowPresent.length === 0;
  const stageUnchanged  = opp.pipelineStageId === cap.pipelineStageId;
  const statusUnchanged = opp.status === cap.status;
  const batteryFour = othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;

  const fixtureDrift = (cap.fixtureState ?? []).filter((f) =>
    JSON.stringify(liveById.get(f.id) ?? null) !== JSON.stringify(f.entry ?? null));
  const fixtureUnchanged = fixtureDrift.length === 0;
  const discoveryAbsent = !liveById.has(DISCOVERY_ID);

  const modeEntryIdentical =
    JSON.stringify(liveById.get(MODE_ID) ?? null) === JSON.stringify(capMode ? (capMode.originEntry ?? null) : null);

  // ── Wire shape after ──
  let listById = new Map();
  try {
    const listRes = await fetch(LIST);
    if (listRes.ok) {
      const listBody = JSON.parse(await listRes.text());
      const listOpp = (listBody.opportunities ?? []).find((o) => o.id === OPPORTUNITY_ID) ?? null;
      if (listOpp) listById = new Map((listOpp.customFields ?? []).map((f) => [f.id, f]));
    }
  } catch (e) {
    console.log(`  list endpoint threw: ${(e && e.message) || e}; after-shape not recorded`);
  }
  const wireShapeAfter = states.map((s) => ({
    key: s.key, singular: shapeOf(s.entry), list: shapeOf(listById.get(s.id) ?? null),
  }));

  const restoredToOrigin = allRestored && wholeRecordIdentical && batteryFour
    && fixtureUnchanged && discoveryAbsent && modeEntryIdentical;

  const complete = {
    captureCleanMixedOrigin: (ev.s1.problems ?? []).length === 0
      && ev.s1.mixedOrigin && ev.s1.mixedOrigin.absentCount === 2 && ev.s1.mixedOrigin.populatedCount === 1,
    onePutCarriedThree:      ev.s2.putStatus >= 200 && ev.s2.putStatus < 300
      && Object.keys(ev.s2.sent || {}).length === 3,
    allThreeLandedTogether:  ev.s3.allLanded === true && ev.s3.landedCount === 3,
    verifyBatteryGreen:      !!(ev.s3.confirmations && ev.s3.confirmations.othersUnchanged
                               && ev.s3.confirmations.offersUnchanged && ev.s3.confirmations.stageUnchanged
                               && ev.s3.confirmations.statusUnchanged),
    onePutRestoredThree:     ev.s4.putStatus >= 200 && ev.s4.putStatus < 300,
    twoClearedToAbsent:      states.filter((s) => s.contract === "clear-to-absent" && s.outcome === "CLEARED").length === 2,
    oneRestoredToLabel:      states.filter((s) => s.contract === "value-to-original-value" && s.outcome === "RESTORED").length === 1,
    wholeRecordIdentical,
    restoreBatteryGreen:     batteryFour,
  };
  const proofBComplete = Object.values(complete).every(Boolean);

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "confirm",
    cycle: "proof-b",
    proof: "PB-D59 Proof B",
    note: "The last proof. Passing this plus the closing gate satisfies PB-D59's three-proof requirement and Approve may be rendered.",
    opportunityId: OPPORTUNITY_ID,
    polls,
    allRestored,
    perCarrier: states,
    wholeRecordIdentical,
    modeEntryIdentical,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    fixtureUnchanged,
    fixtureDrift,
    discoveryAbsent,
    drifted,
    nonCarrierDrift,
    offerNowPresent,
    wireShapeAfter,
    restoredToOrigin,
    complete,
    proofBComplete,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
    closingGate: "Rerun verify-underwriting.cjs. PB-D59 section V requires the probe RESOLVED with the independent PB-D56 arithmetic check passing.",
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(591, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`CONFIRM  allRestored=${allRestored}  polls=${polls}`);
  for (const s of states) {
    console.log(`  ${s.restored ? "OK    " : "FAILED"}  ${s.key}`);
    console.log(`            contract ${s.contract}`);
    console.log(`            outcome  ${s.outcome}`);
    console.log(`            present  ${s.present}   value ${JSON.stringify(s.observed)}`);
  }
  console.log("");
  console.log(`  wholeRecordIdentical ${wholeRecordIdentical}${wholeRecordIdentical ? " (customFields equals capture)" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  modeEntryIdentical   ${modeEntryIdentical}`);
  console.log(`  othersUnchanged      ${othersUnchanged}`);
  console.log(`  offersUnchanged      ${offersUnchanged}`);
  console.log(`  stageUnchanged       ${stageUnchanged}`);
  console.log(`  statusUnchanged      ${statusUnchanged}`);
  console.log(`  fixtureUnchanged     ${fixtureUnchanged}`);
  console.log(`  discoveryAbsent      ${discoveryAbsent}`);
  console.log(`  restoredToOrigin     ${restoredToOrigin}`);
  console.log(`  evidence             ${EVIDENCE}`);
  console.log("");
  console.log("Proof B completion conditions:");
  for (const [k, v] of Object.entries(complete)) {
    console.log(`  ${v ? "MET    " : "NOT MET"}  ${k}`);
  }
  console.log("");

  if (allRestored && restoredToOrigin && proofBComplete) {
    console.log("  All Proof B conditions MET. The composed Approve payload is proven.");
    console.log("  One PUT carried three carriers, all three landed, nothing else moved,");
    console.log("  and one PUT restored a mixed origin state exactly.");
    console.log("");
    console.log("  CLOSING GATE, not yet run: rerun verify-underwriting.cjs.");
    console.log("  PB-D59 section V requires the probe RESOLVED with the independent");
    console.log("  PB-D56 arithmetic check passing. The fixture is restored, so the");
    console.log("  harness is a valid gate again.");
    console.log("");
    console.log("  If that passes, PB-D59's three-proof requirement is satisfied.");
    process.exit(0);
  }
  if (!allRestored) {
    console.log(`  PARTIAL RESTORATION: ${states.filter((s) => s.restored).length} of 3.`);
    console.log("  The record is NOT where capture found it. Do NOT re-run step 4 blindly.");
    console.log("  Do NOT run verify-underwriting.cjs. Read the evidence and decide.");
    process.exit(592);
  }
  console.log("  All three carriers restored BUT the whole-record comparison failed.");
  console.log("  Something outside the carriers moved. Read the evidence.");
  process.exit(593);
})().catch((e) => {
  console.error("CONFIRM THREW:", (e && e.stack) || e);
  process.exit(594);
});
