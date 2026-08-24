/* PB-D58 section I, step 5 — CONFIRM. READ ONLY. NO WRITES.
 *
 * The observation the discovery cycle exists to produce: did
 * `field_value: ""` return an opportunity NUMERICAL field to ABSENT?
 *
 * Absent means the id does not appear in the customFields array at all.
 * Three outcomes are distinguished, and conflating them would be the whole
 * failure this step guards against:
 *
 *   CLEARED    the id is gone from customFields. Opportunity NUMERICAL
 *              clear semantics become OBSERVED. The proof cycle on
 *              endbuyer_maximum_purchase_price may proceed.
 *   EMPTIED    the id is still present carrying "" or 0 or null. That is
 *              NOT absent. PB-D24 distinguishes KEY_ABSENT from an empty
 *              value present, and only the former is a clear. Candidate 1
 *              has failed; candidate 2 runs steps 4 and 5 only.
 *   UNCHANGED  the id still carries 8271.31. The PUT was accepted and had
 *              no effect. Candidate 1 has failed.
 *
 * A poll that exhausts without reaching absence is an observation, not a
 * reason to poll harder or to re-issue step 4.
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
const STEP4    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step4.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step5.json";

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
  let cap, cleared;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(80, `cannot read step 1 evidence: ${e.message}`); }
  try { cleared = JSON.parse(fs.readFileSync(STEP4, "utf8")); }
  catch (e) { fail(81, `cannot read step 4 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — site 7 read site (step-4 evidence): consumes NO environment-owned value.
     It consumes cleared.putStatus, cleared.candidate, cleared.candidateLabel and cleared.originStateForThisAttempt and nothing else. An HTTP integer, a candidate marker and two label strings.
     ⚠ THE ARTIFACT IS NOT CLEAN. step-4 evidence carries 9 environment-owned
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
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(82, `step 1 names a different opportunity`);
  if (cleared.putStatus === null) {
    fail(83, `step 4 recorded no PUT status; it threw. Read the evidence before proceeding.`);
  }
  console.log(`PRECHECK ok — step 4 candidate ${cleared.candidate} (${cleared.candidateLabel}), PUT ${cleared.putStatus}`);

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
    const res = await fetch(oppUrl);
    const text = await res.text();
    if (!res.ok) fail(84, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(85, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
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

  // ── Classification. Three outcomes, never collapsed. ──
  let outcome;
  if (absent) {
    outcome = "CLEARED";
  } else if (observed === TEST_VALUE) {
    outcome = "UNCHANGED";
  } else {
    outcome = "EMPTIED";
  }

  // ── Confirmation battery against the last polled state ──
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

  /* Restored to origin means the field is absent exactly as capture found
     it, AND the rest of the record is where capture left it. Absence alone
     is not restoration. */
  const restoredToOrigin = absent && cap.fieldPresent === false
    && othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "confirm",
    cycle: "discovery",
    candidate: cleared.candidate,
    candidateLabel: cleared.candidateLabel,
    originStateForThisAttempt: cleared.originStateForThisAttempt,
    note: "PB-D58 section I. NOT prerequisite 5. Establishes clear semantics only.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: cap.dataType,
    outcome,
    polls,
    keyAbsent: absent,
    observedValue: observed === undefined ? null : observed,
    observedKey,
    observedEntry,
    capturedFieldPresent: cap.fieldPresent,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    restoredToOrigin,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(86, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`CONFIRM  outcome=${outcome}  polls=${polls}`);
  console.log(`  keyAbsent       ${absent}`);
  console.log(`  entry           ${JSON.stringify(observedEntry)}`);
  console.log(`  othersUnchanged ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged  ${stageUnchanged}`);
  console.log(`  statusUnchanged ${statusUnchanged}`);
  console.log(`  restoredToOrigin ${restoredToOrigin}`);
  console.log(`  evidence        ${EVIDENCE}`);
  console.log("");

  if (outcome === "CLEARED" && restoredToOrigin) {
    console.log(`  OBSERVED: ${cleared.candidateLabel} clears an opportunity NUMERICAL field to KEY_ABSENT.`);
    console.log("  The record is back where capture found it. The proof cycle may proceed.");
    process.exit(0);
  }
  if (outcome === "CLEARED") {
    console.log("  The key is absent BUT a confirmation failed. The clear was not inert.");
    process.exit(87);
  }
  console.log(`  ${cleared.candidateLabel} did NOT clear the field. Outcome: ${outcome}.`);
  console.log(`  The field is left populated. Candidate 2 (field_value: null) runs steps 4 and 5 ONLY —`);
  console.log("  per PB-D58 section I that is a POPULATED-origin clear, a different experiment.");
  console.log("  Do NOT re-run steps 2 or 3.");
  process.exit(88);
})().catch((e) => {
  console.error("CONFIRM THREW:", (e && e.stack) || e);
  process.exit(89);
});
