/* PB-D58 section I, step 2 — WRITE. ONE PUT. NO RE-READ, NO POLL.
 *
 * The first mutating step of the opportunity-side arc. Issues exactly one
 * custom-fields-only PUT setting closing_costs to a designated test value,
 * persists the response as evidence, and stops. Verification is step 3's
 * job — PB-D26 requires each step to persist evidence before terminating,
 * and a step that writes and then reads back conflates two observations.
 *
 * TEST VALUE: 8271.31. Designated, not observed. Approved 2026-08-17 per
 * PB-D30's 2026-08-03 amendment: valid for a NUMERICAL closing-cost field,
 * recognizable during verification, and arbitrary enough that it cannot be
 * confused with production data.
 *
 * THE PUT BODY CARRIES ONLY customFields, AND ONLY THE TARGET ID.
 * No pipelineStageId, no status, no name, no monetaryValue. OBSERVED at
 * architecture reference line 118: a custom-fields-only PUT cannot fire
 * stage triggers. That is the mechanism this whole proof rests on, and a
 * body carrying anything else forfeits it. The body is built from literals
 * below and asserted before the request is issued.
 *
 * PRECONDITIONS, all read from step 1's evidence and re-verified live:
 *   the evidence file exists and names this opportunity and field
 *   fieldPresent === false — absent origin, per PB-D58 section I
 *   the live opportunity still shows the target absent
 *   the live stage and status still match what was captured
 * Any precondition failing aborts BEFORE the PUT.
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

const TEST_VALUE = 8271.31;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step1.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step2.json";

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  // ── Precondition: step 1's evidence ──
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(30, `cannot read step 1 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

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
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(31, `step 1 names a different opportunity: ${cap.opportunityId}`);
  if (cap.fieldId !== TARGET_ID) fail(32, `step 1 names a different field: ${cap.fieldId}`);
  if (cap.dataType !== "NUMERICAL") fail(33, `step 1 recorded dataType ${JSON.stringify(cap.dataType)}`);
  if (cap.fieldPresent !== false) {
    fail(34, `step 1 recorded fieldPresent=${cap.fieldPresent}; PB-D58 section I requires an absent origin`);
  }
  console.log("PRECHECK step1 ok — absent origin, NUMERICAL, identities match");

  // ── Precondition: the live record still matches what was captured ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(35, `precheck GET → ${preRes.status}`, preText.slice(0, 400));

  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(36, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(37, `live identity mismatch: ${JSON.stringify(pre.id)}`);
  if (pre.contactId !== CONTACT_ID) fail(38, `live contact mismatch: ${JSON.stringify(pre.contactId)}`);
  if (pre.pipelineStageId !== cap.pipelineStageId) {
    fail(39, `live stage moved since capture: ${JSON.stringify(pre.pipelineStageId)} vs ${JSON.stringify(cap.pipelineStageId)}`);
  }
  if (pre.status !== cap.status) {
    fail(40, `live status moved since capture: ${JSON.stringify(pre.status)} vs ${JSON.stringify(cap.status)}`);
  }
  const liveTarget = (pre.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  if (liveTarget !== null) {
    fail(41, `target is populated live, absent at capture`, JSON.stringify(liveTarget));
  }
  console.log("PRECHECK live ok — target still absent, stage and status unmoved");

  // ── The body. Built from literals, asserted before the request. ──
  const body = { customFields: [{ id: TARGET_ID, field_value: TEST_VALUE }] };

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "customFields") {
    fail(42, `body must carry only customFields, got ${JSON.stringify(keys)}`);
  }
  if (body.customFields.length !== 1) {
    fail(43, `body must carry exactly one field, got ${body.customFields.length}`);
  }
  if (body.customFields[0].id !== TARGET_ID) {
    fail(44, `body targets the wrong field: ${body.customFields[0].id}`);
  }
  /* Key-based, not substring-based. A serialized.includes("status") scan
     would abort on any field id or value containing that substring, and
     would also match inside pipelineStageId — simultaneously too broad and
     redundant. This walks actual keys at both levels instead. The pattern
     gets reused in step 4, so the trap is worth removing here. */
  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  for (const k of Object.keys(body)) {
    if (FORBIDDEN.has(k)) fail(45, `body carries forbidden top-level key ${k}`);
  }
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(45, `customFields entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") {
        fail(45, `customFields entry carries unexpected key ${k}; only id and field_value are permitted`);
      }
    }
  }
  const serialized = JSON.stringify(body);
  console.log(`BODY ok — ${serialized}`);

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

  // Evidence persists whatever happened. A failed PUT is an observation,
  // not an aborted run — PB-D26, and evidence-persistence failure outranks
  // response classification on any mutating step.
  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "write",
    cycle: "discovery",
    note: "PB-D58 section I. NOT prerequisite 5.",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    testValue: TEST_VALUE,
    testValueKind: "designated",
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
    process.exit(46);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    process.exit(47);
  }

  const putOk = putStatus >= 200 && putStatus < 300;
  const REFUSAL = 48;
  console.log(`${putOk ? "WRITE issued" : "WRITE FAILED"} — PUT status ${putStatus}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  if (putOk) {
    console.log("  No re-read issued. Step 3 verifies.");
    process.exit(0);
  }
  console.log(`  Whether the mutation landed is UNKNOWN. Step 3 observes; do not re-run step 2. Refusal ${REFUSAL}.`);
  process.exit(REFUSAL);
})().catch((e) => {
  console.error("WRITE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(49);
});
