/* PB-D58 section I, step 4 — CLEAR ATTEMPT 1. ONE PUT. NO RE-READ.
 *
 * The unknown this whole cycle exists to resolve: does `field_value: ""`
 * clear an opportunity NUMERICAL field back to absent?
 *
 * `""` is candidate 1 per PB-D58 section I, chosen because it is the proven
 * contact TEXT and MONETORY mechanism under PB-D24 and the cheapest
 * hypothesis. It carries NO claim about the opportunity model — that is
 * what this step observes.
 *
 * WRITE KEY. Stays `field_value`, the key step 2 proved is accepted for an
 * opportunity NUMERICAL write. Changing it now would introduce a second
 * variable and muddy the result.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 2 already showed a 200 means the
 * server accepted a request. Whether the key is absent again is step 5's
 * observation, and only that classifies this cycle.
 *
 * If this attempt does not clear, the field is left populated at 8271.31 and
 * candidate 2 (`field_value: null`) runs steps 4 and 5 ONLY — per PB-D58
 * section I, the second attempt is a POPULATED-origin clear and a different
 * experiment. It does not repeat steps 2 and 3.
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

const fixtureContacts = fixtureRecords && fixtureRecords.contacts;
if (!fixtureContacts || !fixtureContacts.iaosTestProbe) {
  console.error(`ABORT — carrier has no fixtureRecords.contacts.iaosTestProbe for environment "${ENV}" (scripts/harness-fixtures.json)`);
  process.exit(4);
}

const envPins           = envFixtures && envFixtures.untouchedPins;
const opportunityFields = envPins && envPins.opportunityFields;
if (!opportunityFields || !opportunityFields.closing_costs) {
  console.error(`ABORT — carrier has no untouchedPins.opportunityFields.closing_costs for environment "${ENV}" (scripts/harness-fixtures.json)`);
  process.exit(4);
}
const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest;
const CONTACT_ID     = fixtureContacts.iaosTestProbe;
const TARGET_ID      = opportunityFields.closing_costs;
const TARGET_KEY     = "closing_costs";
const TEST_VALUE     = 8271.31;

const CANDIDATE       = "";           // candidate 1
const CANDIDATE_LABEL = 'field_value: ""';

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step4.json";

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
  let cap, ver;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(60, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(61, `cannot read step 3 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — site 5 read site (step-3 evidence): consumes NO environment-owned value.
     It consumes ver.matched, ver.confirmations and ver.observedValue/observedKey (log only) and nothing else. Booleans, an observed number and a wire key name.
     ⚠ THE ARTIFACT IS NOT CLEAN. step-3 evidence carries 6 environment-owned
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
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(62, `step 1 names a different opportunity`);
  if (ver.matched !== true) {
    fail(63, `step 3 recorded matched=${ver.matched}; there is nothing proven to clear`);
  }
  const allConfirmed = ver.confirmations
    && ver.confirmations.othersUnchanged && ver.confirmations.offersUnchanged
    && ver.confirmations.stageUnchanged && ver.confirmations.statusUnchanged;
  if (!allConfirmed) {
    fail(64, `step 3 confirmations were not all green`, JSON.stringify(ver.confirmations));
  }
  console.log(`PRECHECK step3 ok — value landed at ${ver.observedValue} under key ${JSON.stringify(ver.observedKey)}, battery green`);

  // ── Live precondition: the value is still there, nothing else moved ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(65, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(66, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(67, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(68, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(69, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(70, `live status moved since capture`);

  const liveEntry = (pre.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  const liveRead = entryValue(liveEntry);
  if (liveRead.value !== TEST_VALUE) {
    fail(71, `target does not currently hold the test value`,
      `observed=${JSON.stringify(liveRead.value)} key=${JSON.stringify(liveRead.key)} expected=${TEST_VALUE}`);
  }
  console.log(`PRECHECK live ok — target holds ${TEST_VALUE}, stage and status unmoved`);

  // ── The body. Key-based guard, same as step 2. ──
  const body = { customFields: [{ id: TARGET_ID, field_value: CANDIDATE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(72, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) {
    fail(73, `body must carry exactly one field, got ${body.customFields.length}`);
  }
  if (body.customFields[0].id !== TARGET_ID) {
    fail(74, `body targets the wrong field: ${body.customFields[0].id}`);
  }
  for (const k of topKeys) {
    if (FORBIDDEN.has(k)) fail(75, `body carries forbidden top-level key ${k}`);
  }
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(75, `customFields entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") {
        fail(75, `customFields entry carries unexpected key ${k}; only id and field_value are permitted`);
      }
    }
  }
  const serialized = JSON.stringify(body);
  console.log(`BODY ok — ${serialized}`);
  console.log(`CANDIDATE 1 — ${CANDIDATE_LABEL}`);

  // ── The one PUT. No re-read after it. ──
  let putStatus = null;
  let putText = null;
  let threw = null;
  try {
    const putRes = await fetch(oppUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    });
    putStatus = putRes.status;
    putText = await putRes.text();
  } catch (e) {
    threw = (e && e.message) || String(e);
  }

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "clear",
    cycle: "discovery",
    candidate: 1,
    candidateLabel: CANDIDATE_LABEL,
    candidateValue: CANDIDATE,
    originStateForThisAttempt: "populated-by-this-proof",
    note: "PB-D58 section I. NOT prerequisite 5. HTTP 200 is not success; step 5 classifies.",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    valueBeforeClear: TEST_VALUE,
    valueBeforeClearKey: liveRead.key,
    requestBody: body,
    putStatus,
    putResponseRaw: putText === null ? null : putText.slice(0, 4000),
    threw,
    capturedStageId: cap.pipelineStageId,
    capturedStatus: cap.status,
  };

  try {
    fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8");
  } catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(76);
  }

  console.log("");
  if (threw !== null) {
    console.log(`CLEAR THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 5 observes; do not re-run step 4.");
    process.exit(77);
  }

  console.log(`CLEAR issued — PUT status ${putStatus}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 5 observes whether the key is absent.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 78);
})().catch((e) => {
  console.error("CLEAR THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(79);
});
