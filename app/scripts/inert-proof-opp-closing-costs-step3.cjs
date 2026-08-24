/* PB-D58 section I, step 3 — VERIFY. READ ONLY. NO WRITES.
 *
 * Observes whether step 2's PUT landed. Polls the singular opportunity GET
 * until the target reads back equal to the designated test value, then runs
 * the confirmation battery. Issues no writes of any kind.
 *
 * A 200 from step 2 is the server accepting a request. It is not evidence
 * the value landed, landed unconverted, or landed alone. This step is where
 * those become observations.
 *
 * CONFIRMATION BATTERY, PB-D58 section II adapted to the object:
 *   othersUnchanged   every non-target custom field, over the UNION of
 *                     captured and live ids, is byte-identical to capture
 *   offersUnchanged   the seven offer_ ids are still absent — they were
 *                     0 of 7 at capture, so this asserts they stayed absent
 *   stageUnchanged    pipelineStageId matches capture
 *   statusUnchanged   status matches capture
 *
 * tagsUnchanged is deliberately absent: opportunities carry no tags, so
 * asserting it would be a tautology. statusUnchanged replaces it as the
 * opportunity-side field a stray write could move.
 *
 * POLLING. Bounded at 15 attempts, 2s apart. The list/search endpoint is
 * eventually consistent and lags the singular GET, which is why this polls
 * the singular GET only. A poll that exhausts is an observation, not a
 * failure to retry harder.
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const fixtures = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;


/* ── Environment resolution (Gate 4C C4a, Stair 4 + P-2) ──────────────────
   CARRIER-ONLY, and the absence of the loader is DELIBERATE AND MEASURED.

   step1 carries ghl-config-loader.cjs because it needs config.locationId for
   its schema GET at /locations/${LOC}/customFields?model=opportunity. This
   file calls only /opportunities/${OPPORTUNITY_ID} and needs nothing from the
   canonical config: measured, zero of the 47 ghl-config Production values
   appear in this file, with a fired positive control. Adding getConfig here
   would resolve nothing and install dead infrastructure inside a gate
   instrument. Do not "standardize" the loader in to match step1.

   Every environment-owned value below derives from this ONE parsed ENV.
   There is no second selector, no fallback and no default. */
const envArg = process.argv.slice(2).find((a) => a.startsWith("--env="));
if (envArg === undefined) {
  console.error("ABORT — missing --env=<environment> (expected --env=production)");
  process.exit(4);
}
const ENV = envArg.slice("--env=".length);

/* Section guards. Each names the section that failed. This file is guarded for
   exactly the sections it resolves and no others — guarding a section this
   file never reads would refuse on something it does not trust. */
const envFixtures          = fixtures[ENV];
const fixtureRecords       = envFixtures && envFixtures.fixtureRecords;
const fixtureOpportunities = fixtureRecords && fixtureRecords.opportunities;
if (!fixtureOpportunities || !fixtureOpportunities.iaosUnderwritingTest) {
  console.error(`ABORT — carrier has no fixtureRecords.opportunities.iaosUnderwritingTest for environment "${ENV}" (scripts/harness-fixtures.json)`);
  process.exit(4);
}

const envPins           = envFixtures && envFixtures.untouchedPins;
const opportunityFields = envPins && envPins.opportunityFields;
if (!opportunityFields || !opportunityFields.closing_costs) {
  console.error(`ABORT — carrier has no untouchedPins.opportunityFields.closing_costs for environment "${ENV}" (scripts/harness-fixtures.json)`);
  process.exit(4);
}
const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest;
const TARGET_ID      = opportunityFields.closing_costs;
const TARGET_KEY     = "closing_costs";
const TEST_VALUE     = 8271.31;

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step2.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

/* Reads the target's value out of an entry, whichever key carries it, and
   REPORTS WHICH KEY DID. Coalescing is what resolver.ts deliberately
   refuses — correct there, correct to do here, because the read-back key
   for opportunity NUMERICAL is one of the unknowns this cycle exists to
   observe. Recording the value without recording its location would leave
   the primary question half-answered. */
function entryValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValueNumber", "field_value", "fieldValue", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  let cap, wrote;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(50, `cannot read step 1 evidence: ${e.message}`); }
  try { wrote = JSON.parse(fs.readFileSync(STEP2, "utf8")); }
  catch (e) { fail(51, `cannot read step 2 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — site 3 read site (step-2 evidence): consumes NO environment-owned value.
     It consumes wrote.putStatus and wrote.testValue and nothing else. An HTTP integer and a designated NUMERICAL test value.
     ⚠ THE ARTIFACT IS NOT CLEAN. step-2 evidence carries 9 environment-owned
     values, sitting there unread. This site is a NOTE because of what it
     CONSUMES, not because the file is safe.
     STOP if you are adding a field to this destructure: consuming an
     environment-owned value here REQUIRES an assertEnvironment(...) call at
     this site first. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism.
     These guards compare an artifact identifier against a locally resolved
     constant. They catch a stale or mismatched capture, and incidentally
     reject SOME environment crossings as a side effect. The assertEnvironment
     call above is the provenance check; this is not a substitute for it.

     Narrow: at this site opportunityId (and in step2, fieldId) are the ONLY
     environment-owned values compared. Everything else this site consumes —
     offerIds, customFields, pipelineStageId — is ADOPTED with no comparison.

     And misdirecting: when one DOES fire on a crossing it reports a record
     mismatch, sending the operator hunting for a stale capture while the real
     cause is an environment crossing. Retained as defense-in-depth; do not
     remove or weaken. */
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(52, `step 1 names a different opportunity`);
  if (wrote.putStatus === null) fail(53, `step 2 recorded no PUT status; it threw. Do not proceed blind.`);
  console.log(`PRECHECK ok — step 2 recorded PUT status ${wrote.putStatus}, test value ${wrote.testValue}`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let observed = undefined;
  let observedKey = null;
  let observedEntry = null;
  let matched = false;

  while (polls < MAX_POLLS) {
    polls++;
    const res = await fetch(oppUrl);
    const text = await res.text();
    if (!res.ok) fail(54, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(55, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    const read = entryValue(entry);
    observed = read.value;
    observedKey = read.key;
    observedEntry = entry;
    console.log(`  poll ${polls}/${MAX_POLLS}  observed=${JSON.stringify(observed)}  typeof=${typeof observed}  key=${JSON.stringify(observedKey)}`);

    if (observed === TEST_VALUE) { matched = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  // ── Confirmation battery, against the last polled state ──
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

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "verify",
    cycle: "discovery",
    note: "PB-D58 section I. NOT prerequisite 5. READ ONLY.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    testValue: TEST_VALUE,
    polls,
    matched,
    observedValue: observed === undefined ? null : observed,
    observedType: typeof observed,
    observedKey,
    observedEntry,
    confirmations: {
      othersUnchanged,
      offersUnchanged,
      stageUnchanged,
      statusUnchanged,
    },
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(56, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`VERIFY  matched=${matched}  polls=${polls}`);
  console.log(`  observed        ${JSON.stringify(observed)}  (${typeof observed})  key=${JSON.stringify(observedKey)}`);
  console.log(`  entry           ${JSON.stringify(observedEntry)}`);
  console.log(`  expected        ${TEST_VALUE}  (number)`);
  console.log(`  othersUnchanged ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged  ${stageUnchanged}  live=${opp.pipelineStageId}`);
  console.log(`  statusUnchanged ${statusUnchanged}  live=${JSON.stringify(opp.status)}`);
  console.log(`  evidence        ${EVIDENCE}`);

  const allConfirmed = othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;
  if (!matched) {
    console.log("");
    console.log("  Poll exhausted without read-back equality. That is an observation.");
    console.log("  Do NOT re-run step 2. Decide from the evidence what happened.");
    process.exit(57);
  }
  if (!allConfirmed) {
    console.log("");
    console.log("  Read-back matched BUT a confirmation failed. The write was not inert.");
    process.exit(58);
  }
  console.log("");
  console.log("  Write landed, unconverted, and nothing else moved.");
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY THREW:", (e && e.stack) || e);
  process.exit(59);
});
