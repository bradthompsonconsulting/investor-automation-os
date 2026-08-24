/* PB-D59 Proof A0, step 3 — VERIFY. READ ONLY. NO WRITES.
 *
 * A 200 is the server accepting a request. This is where it becomes an
 * observation: the value landed, landed unconverted, and landed alone.
 *
 * BATTERY. PB-D58 section II names four items; this gates on six, the four
 * plus fixtureUnchanged and pbd58TargetsAbsent. The pass condition is
 * therefore STRICTER than the decision specifies, and the evidence keeps
 * the four in `confirmations` with the extras as siblings so a later reader
 * can tell which is which.
 *
 * The four PB-D58 names:
 *   othersUnchanged   every non-target custom field, over the UNION of
 *                     captured and live ids, byte-identical to capture
 *   offersUnchanged   the seven offer_ ids still absent (0 of 7 at capture)
 *   stageUnchanged    pipelineStageId matches capture
 *   statusUnchanged   status matches capture
 *
 * PRECISION. The test value carries cents. Read-back equality is strict; a
 * stored value that rounded or stringified reports matched false with the
 * observed value and type printed. That is the observation, not a reason to
 * loosen the comparison.
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

   NO CONTACTS GUARD HERE, deliberately. This file resolves no contact id, and a
   guard on a section it never reads would refuse on something it does not
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
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

/* fieldValue first: OBSERVED 2026-08-17 that the singular opportunity GET
   returns the value under fieldValue while the list endpoint returns
   fieldValueNumber with a type. The others remain as fallbacks -- the shape
   is observed, not proven invariant. */
function entryValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValue", "fieldValueNumber", "field_value", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  let cap, wrote;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(260, `cannot read step 1 evidence: ${e.message}`); }
  try { wrote = JSON.parse(fs.readFileSync(STEP2, "utf8")); }
  catch (e) { fail(261, `cannot read step 2 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — step-2 read site: consumes NO environment-owned value.
     It consumes wrote.cycle, wrote.putStatus and wrote.testValue and nothing
     else — a cycle marker, an HTTP integer off putRes.status, and the
     designated numeric constant. Producer-reachable classification: none of the
     three can hold an identifier under any run.
     STOP if you are adding a field here: this read site has no environment
     assertion because nothing environment-owned crosses it today. The artifact
     itself is NOT clean — it carries opportunityId, contactId, fieldId,
     requestBody and capturedStageId, four distinct environment-owned values,
     unread. Adding one to this consumption set REQUIRES an
     assertEnvironment(...) call at this site first. The same artifact IS read
     through a CHECK at step 5 — a NOTE classifies the read site, not the
     artifact. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site 1 value is COMPARED (opportunityId,
     L166 below) and 14 are ADOPTED BY VALUE with no comparison — the 3 ids
     inside customFields, the 7 inside offerIds, pipelineStageId, and the 3
     inside fixtureState. BY FIELD that same site reads 1 to 4, which is the
     misleading figure. Family-wide: 12 COMPARED to 36 ADOPTED by value,
     12 to 12 by field.

     ⚠ fieldId IS NOT COMPARED AT THIS SITE AT ALL. This file never reads
     cap.fieldId. It is the weakest read site in the family and a per-site
     verdict of "CHECK, protected" would be true and useless.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and its persisted
     derivative liveStageId are ENVIRONMENT-OWNED BY VALUE — they match
     canonical config stages.* — while appearing as a source literal NOWHERE in
     this family. Conversion does NOTHING for them; there is no literal to
     convert. The assertEnvironment call above is the ONLY thing standing
     between them and a cross-environment consumption. Their sole comparison, at
     L224 below, is against the LIVE wire value: drift detection, not
     provenance.

     FOUR VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in
     this family: customFields, offerIds, fixtureState and pipelineStageId.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.cycle !== "a0" || wrote.cycle !== "a0") {
    fail(262, `evidence is not from cycle a0`, `step1=${cap.cycle} step2=${wrote.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(263, `step 1 names a different opportunity`);
  if (wrote.putStatus === null) fail(264, `step 2 recorded no PUT status; it threw. Do not proceed blind.`);
  if (wrote.testValue !== TEST_VALUE) fail(265, `step 2 wrote ${wrote.testValue}, this step expects ${TEST_VALUE}`);
  console.log(`PRECHECK ok — step 2 PUT ${wrote.putStatus}, test value ${wrote.testValue}`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let observed = undefined;
  let observedKey = null;
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
      fail(266, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(267, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(268, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    observedEntry = entry;
    const read = entryValue(entry);
    observed = read.value;
    observedKey = read.key;
    console.log(`  poll ${polls}/${MAX_POLLS}  observed=${JSON.stringify(observed)}  typeof=${typeof observed}  key=${JSON.stringify(observedKey)}`);

    if (observed === TEST_VALUE) { matched = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  if (opp === null) fail(269, `no successful read across ${MAX_POLLS} polls`);

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

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "verify",
    cycle: "a0",
    proof: "PB-D59 Proof A0",
    note: "PB-D59 section V. READ ONLY.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: cap.dataType,
    testValue: TEST_VALUE,
    polls,
    matched,
    observedValue: observed === undefined ? null : observed,
    observedType: typeof observed,
    observedKey,
    observedEntry,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    fixtureUnchanged,
    fixtureDrift,
    pbd58TargetsAbsent,
    pbd58Residue,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(270, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`VERIFY  matched=${matched}  polls=${polls}`);
  console.log(`  observed         ${JSON.stringify(observed)}  (${typeof observed})  key=${JSON.stringify(observedKey)}`);
  console.log(`  entry            ${JSON.stringify(observedEntry)}`);
  console.log(`  expected         ${TEST_VALUE}  (number)`);
  console.log(`  othersUnchanged  ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged  ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged   ${stageUnchanged}`);
  console.log(`  statusUnchanged  ${statusUnchanged}`);
  console.log(`  fixtureUnchanged ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs, mode)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  pbd58Absent      ${pbd58TargetsAbsent}${pbd58TargetsAbsent ? "" : "  residue=" + JSON.stringify(pbd58Residue)}`);
  console.log(`  evidence         ${EVIDENCE}`);

  const allConfirmed = batteryFour && fixtureUnchanged && pbd58TargetsAbsent;

  console.log("");
  if (!matched) {
    console.log("  Poll exhausted without read-back equality. That is an observation.");
    console.log("  Do NOT re-run step 2. Read the evidence and decide.");
    process.exit(271);
  }
  if (!allConfirmed) {
    console.log("  Read-back matched BUT a confirmation failed. The write was not inert.");
    process.exit(272);
  }
  console.log(`  PB-D58 four-item battery: ${batteryFour}.  Plus fixtureUnchanged and pbd58TargetsAbsent.`);
  console.log("  Write landed, unconverted, and nothing else moved. Step 4 restores.");
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY THREW:", (e && e.stack) || e);
  process.exit(273);
});
