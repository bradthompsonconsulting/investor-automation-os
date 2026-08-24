/* PB-D58 section II, step 3 — VERIFY. READ ONLY. NO WRITES.
 *
 * Observes whether step 2's PUT landed on the real target, unconverted, and
 * alone. A 200 is the server accepting a request; this is where it becomes
 * an observation.
 *
 * CONFIRMATION BATTERY. PB-D58 section II names four items. This step gates
 * on SIX — the four, plus fixtureUnchanged and discoveryStillAbsent. The
 * pass condition is therefore STRICTER than the decision specifies, and the
 * evidence keeps the four in `confirmations` with the extra two as siblings
 * so a later reader can tell which is which. Do not write this up as "the
 * four-item battery passed": four passed, and two more did.
 *
 * The four PB-D58 names:
 *   othersUnchanged   every non-target custom field, over the UNION of
 *                     captured and live ids, byte-identical to capture
 *   offersUnchanged   the seven offer_ ids still absent (0 of 7 at capture)
 *   stageUnchanged    pipelineStageId matches capture
 *   statusUnchanged   status matches capture
 *
 * tagsUnchanged is deliberately absent — opportunities carry no tags, so
 * asserting it would be a tautology. statusUnchanged replaces it.
 *
 * The three fixture fields are also checked BY NAME, so drift in the
 * harness's inputs is legible rather than appearing only as an anonymous id
 * inside an othersUnchanged failure.
 *
 * PRECISION. The test value carries cents: 313370.42. Read-back equality is
 * strict, so a stored value that rounded or stringified reports matched
 * false with the observed value and type printed. That is the observation,
 * not a reason to loosen the comparison.
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

   LOADER *AND* CARRIER, like every member of this family — the target field is
   a canonical-config member, so the idiom follows the identifier's owner rather
   than the file's role.

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
const TARGET_ID      = config.opportunityFields.endBuyerMaxPrice;
const TARGET_KEY     = "endbuyer_maximum_purchase_price";
const DISCOVERY_ID   = opportunityFields.closing_costs;
const TEST_VALUE     = 313370.42;

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step2.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

/* Probe order is fieldValue first: OBSERVED 2026-08-17 that the singular
   opportunity GET returns the value under fieldValue, while the list
   endpoint returns fieldValueNumber with a type. The others remain as
   fallbacks — the shape is observed, not proven invariant. */
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
  catch (e) { fail(140, `cannot read step 1 evidence: ${e.message}`); }
  try { wrote = JSON.parse(fs.readFileSync(STEP2, "utf8")); }
  catch (e) { fail(141, `cannot read step 2 evidence: ${e.message}`); }
  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — step-2 read site: consumes NO environment-owned value.
     It consumes wrote.cycle, wrote.putStatus and wrote.testValue and nothing
     else. A cycle marker, an HTTP integer and the designated numeric test
     value.
     STOP if you are adding a field here: this read site has no environment
     assertion because nothing environment-owned crosses it today. The artifact
     itself is NOT clean — it carries opportunityId, contactId, fieldId,
     requestBody and capturedStageId, five environment-owned fields, unread.
     Adding one to this destructure REQUIRES an assertEnvironment(...) call at
     this site first. Note the same artifact IS read through a CHECK at
     step 5 — a NOTE classifies this read site, not the artifact. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site 1 value is COMPARED (opportunityId,
     L79 below) and 11 are ADOPTED with no comparison — the 3 ids inside
     customFields, the 7 inside offerIds, and pipelineStageId. Family-wide:
     12 COMPARED to 30 ADOPTED by value. This is the weakest ratio in the
     family and a per-site verdict of "CHECK, protected" would be true and
     useless.

     FOUR VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in
     this family: customFields, offerIds, fixtureState and pipelineStageId.
     Not once, in any of the five files, is any of them checked against a
     locally resolved constant. They also carry most of the environment-owned
     content, which is why the ratio and not the classification is the honest
     summary.

     ⚠ pipelineStageId has NO source literal — it arrives from the wire and is
     persisted — so no identifier-based instrument sees it. Its only comparison,
     at L146 below, is against the LIVE wire value: that detects drift and
     establishes nothing about which environment produced it. The environment
     question is answered by assertEnvironment above and only there.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(142, `step 1 names a different opportunity`);
  if (cap.cycle !== "proof" || wrote.cycle !== "proof") {
    fail(143, `evidence is not from the proof cycle`, `step1=${cap.cycle} step2=${wrote.cycle}`);
  }
  if (wrote.putStatus === null) fail(144, `step 2 recorded no PUT status; it threw. Do not proceed blind.`);
  if (wrote.testValue !== TEST_VALUE) {
    fail(145, `step 2 wrote ${wrote.testValue}, this step expects ${TEST_VALUE}`);
  }
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
      // Transport failure on a read is not a proof outcome. Log and retry
      // within the same bounded poll rather than exiting the run.
      console.log(`  poll ${polls}/${MAX_POLLS}  transport error: ${(e && e.message) || e}`);
      if (polls < MAX_POLLS) { await sleep(POLL_MS); continue; }
      fail(146, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(147, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(148, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
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

  if (opp === null) fail(149, `no successful read across ${MAX_POLLS} polls`);

  // ── Battery ──
  const liveFields = opp.customFields ?? [];
  const capFields  = cap.customFields ?? [];
  const capById  = new Map(capFields.map((f) => [f.id, f]));
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

  const fixtureDrift = (cap.fixtureState ?? []).filter((f) =>
    JSON.stringify(liveById.get(f.id) ?? null) !== JSON.stringify(f.entry ?? null));
  const fixtureUnchanged = fixtureDrift.length === 0;

  const discoveryStillAbsent = !liveById.has(DISCOVERY_ID);

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "verify",
    cycle: "proof",
    note: "PB-D58 section II. READ ONLY.",
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
    discoveryStillAbsent,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(150, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`VERIFY  matched=${matched}  polls=${polls}`);
  console.log(`  observed        ${JSON.stringify(observed)}  (${typeof observed})  key=${JSON.stringify(observedKey)}`);
  console.log(`  entry           ${JSON.stringify(observedEntry)}`);
  console.log(`  expected        ${TEST_VALUE}  (number)`);
  console.log(`  othersUnchanged ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged  ${stageUnchanged}`);
  console.log(`  statusUnchanged ${statusUnchanged}`);
  console.log(`  fixtureUnchanged ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs, mode)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  discoveryAbsent ${discoveryStillAbsent}`);
  console.log(`  evidence        ${EVIDENCE}`);

  /* Six, not four. The two extras are this step's own additions, not
     PB-D58's — see the header. */
  const batteryFour = othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;
  const allConfirmed = batteryFour && fixtureUnchanged && discoveryStillAbsent;

  console.log("");
  if (!matched) {
    console.log("  Poll exhausted without read-back equality. That is an observation.");
    console.log("  Do NOT re-run step 2. Read the evidence and decide.");
    process.exit(151);
  }
  if (!allConfirmed) {
    console.log("  Read-back matched BUT a confirmation failed. The write was not inert.");
    process.exit(152);
  }
  console.log(`  PB-D58 four-item battery: ${batteryFour}.  Plus fixtureUnchanged and discoveryStillAbsent.`);
  console.log("  Write landed, unconverted, and nothing else moved. Step 4 restores.");
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY THREW:", (e && e.stack) || e);
  process.exit(153);
});
