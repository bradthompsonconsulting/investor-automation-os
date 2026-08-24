/* PB-D59 Proof A, step 4 — RESTORE. ONE PUT. NO RE-READ.
 *
 * Writes "Standard Minimum" back over "25% of Buyer Profit".
 *
 * RESTORATION IS TO A VALUE, NOT TO ABSENCE, and that distinction is the
 * whole reason Proof A exists as its own cycle. PB-D58 and A0 restored
 * absent-origin NUMERICAL fields by clearing to KEY_ABSENT, which required
 * validated clear semantics. This origin is POPULATED, so restoration means
 * the original option string returns exactly. No empty value is ever sent.
 *
 * SINGLE_OPTIONS CLEAR SEMANTICS REMAIN UNKNOWN after this step and after
 * this proof. Approve writes a mode over whatever mode is there and never
 * clears one. Nobody may read this cycle as having established how to clear
 * a picklist.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 5 observes whether the original
 * label is back, and only that classifies the cycle.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1 and step 3 evidence are both from cycle proof-a
 *   step 3 recorded matched with its full six-item gate green
 *   the live target currently holds the TEMPORARY option
 *   the three prior proof targets are still absent
 *   the two deal facts, stage and status are unmoved
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

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
   PRIOR_TARGETS below. That is the tail's reason, and it is not the head's. */
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
const fixtureContacts      = fixtureRecords && fixtureRecords.contacts;
const fixtureOpportunities = fixtureRecords && fixtureRecords.opportunities;
if (!fixtureOpportunities || !fixtureOpportunities.iaosUnderwritingTest ||
    !fixtureContacts || !fixtureContacts.iaosTestProbe) {
  console.error(`REFUSED: harness-fixtures.json carries no fixture records for "${ENV}" — expected ${ENV}.fixtureRecords.opportunities.iaosUnderwritingTest and ${ENV}.fixtureRecords.contacts.iaosTestProbe. Refusing rather than inventing them.`);
  process.exit(4);
}

const envPins           = envFixtures.untouchedPins;
const opportunityFields = envPins && envPins.opportunityFields;
if (!opportunityFields || !opportunityFields.closing_costs) {
  console.error(`REFUSED: harness-fixtures.json carries no opportunityFields.closing_costs for "${ENV}" — expected ${ENV}.untouchedPins.opportunityFields.closing_costs. Refusing rather than inventing them.`);
  process.exit(4);
}

const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest;
const CONTACT_ID     = fixtureContacts.iaosTestProbe;
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

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step4.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function optionOf(entry) {
  if (entry === null || entry === undefined) return undefined;
  return entry.fieldValue ?? entry.fieldValueString ?? entry.value ?? undefined;
}

(async () => {
  let cap, ver;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(410, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(411, `cannot read step 3 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — SITE ⑥, step-3 read site: consumes NO environment-owned value.
     ⚠ THIS IS THE MOST FRAGILE NOTE IN THE CAMPAIGN. READ THE LIST BELOW
     BEFORE ADDING ANY FIELD TO THIS CONSUMPTION SET.

     It consumes exactly six fields: ver.cycle, ver.matched, ver.confirmations,
     ver.fixtureUnchanged, ver.priorTargetsAbsent and ver.observedValue. A
     cycle marker, five booleans, and a PICKLIST LABEL. None can hold an
     environment-owned value under any run.

     ⚠ FOUR ENVIRONMENT-BEARING CARRIERS SIT IN THIS ARTIFACT, UNREAD. READING
     ANY ONE OF THEM FLIPS THIS SITE FROM NOTE TO CHECK. They are, by name:

         observedEntry      — ENTRY OBJECT; the target id nested beside its label
         wireShapeDuring    — ENTRY OBJECTS; the target id in singularGet.entry
                              and listEndpoint.entry
         wireShapeBefore    — ENTRY OBJECTS; same shape, adopted from step 1
         liveCustomFields   — BULK WIRE CAPTURE; three distinct ids inside

     That is the exact list you are about to break. It is written out rather
     than summarised on purpose: "additional wire captures" would not tell the
     next person which four.

     Adding any of them REQUIRES an assertEnvironment(...) call at this site
     first. The same artifact IS read through a CHECK at step 5 — a NOTE
     classifies the read site, not the artifact. This artifact carries 5
     distinct environment-owned values across 11 occurrences, all unread here. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site (SITE ⑤) 1 value is COMPARED —
     opportunityId, L172 below — and 3 are ADOPTED: pipelineStageId and the two
     ids inside fixtureState. Family-wide: 12 COMPARED to 36 ADOPTED BY VALUE,
     12 to 16 BY FIELD. This guard sits in front of a PUT, which makes the
     temptation to read it as coverage stronger here than anywhere else. It is
     not coverage. 1-of-4 is the honest measure.

     ⚠ COMPARED means compared against a LOCALLY RESOLVED CONSTANT. A comparison
     against a LIVE WIRE value is ADOPTED, always. pipelineStageId's only check,
     at L200 below, is against the live wire: drift consistency, not provenance.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and its persisted
     derivative capturedStageId are environment-owned by value with NO source
     literal anywhere in this family. Conversion does nothing for them; the
     assertion above is the only thing standing between them and a
     cross-environment consumption, and it is the only such thing above this
     file's PUT. Do not record them as converted.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.cycle !== "proof-a" || ver.cycle !== "proof-a") {
    fail(412, `evidence is not from cycle proof-a`, `step1=${cap.cycle} step3=${ver.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(413, `step 1 names a different opportunity`);
  if (ver.matched !== true) fail(414, `step 3 recorded matched=${ver.matched}; the temporary state is unconfirmed`);
  if (cap.originValue !== ORIGIN_OPTION) {
    fail(415, `step 1 recorded origin ${JSON.stringify(cap.originValue)}, this step restores ${JSON.stringify(ORIGIN_OPTION)}`);
  }

  const c = ver.confirmations || {};
  const gateGreen = c.othersUnchanged && c.offersUnchanged && c.stageUnchanged && c.statusUnchanged
    && ver.fixtureUnchanged === true && ver.priorTargetsAbsent === true;
  if (!gateGreen) {
    fail(416, `step 3's six-item gate was not fully green`,
      JSON.stringify({ confirmations: c, fixtureUnchanged: ver.fixtureUnchanged, priorTargetsAbsent: ver.priorTargetsAbsent }));
  }
  console.log(`PRECHECK step3 ok — ${JSON.stringify(ver.observedValue)} landed, six-item gate green`);
  console.log(`PRECHECK contract — restoring to the ORIGINAL VALUE ${JSON.stringify(ORIGIN_OPTION)}, not clearing`);

  // ── Live precondition ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(417, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(418, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(419, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(420, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(421, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(422, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  const liveOption = optionOf(liveById.get(TARGET_ID) ?? null);
  if (liveOption !== TEMP_OPTION) {
    fail(423, `target does not currently hold the temporary option`,
      `observed=${JSON.stringify(liveOption)} expected=${JSON.stringify(TEMP_OPTION)}`);
  }
  for (const [name, id] of Object.entries(PRIOR_TARGETS)) {
    if (liveById.has(id)) fail(424, `previously restored field ${name} carries a value again`, JSON.stringify(liveById.get(id)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(425, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — target holds ${JSON.stringify(TEMP_OPTION)}, everything else unmoved`);

  // ── The body ──
  const body = { customFields: [{ id: TARGET_ID, field_value: ORIGIN_OPTION }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(426, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(427, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(428, `body targets the wrong field`);
  if (body.customFields[0].field_value !== ORIGIN_OPTION) {
    fail(429, `body carries ${JSON.stringify(body.customFields[0].field_value)}, expected ${JSON.stringify(ORIGIN_OPTION)}`);
  }
  if (body.customFields[0].field_value === "") {
    fail(430, `the body carries an empty value; this cycle never clears a SINGLE_OPTIONS field`);
  }
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(431, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(431, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(431, `unexpected entry key ${k}`);
    }
  }
  const serialized = JSON.stringify(body);
  console.log(`BODY ok — ${serialized}`);

  // ── The one PUT ──
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
    stage: "restore",
    cycle: "proof-a",
    proof: "PB-D59 Proof A",
    note: "Restoration is value-to-original-value. No empty value sent. SINGLE_OPTIONS clear semantics remain UNKNOWN.",
    restorationContract: "value-to-original-value",
    mechanism: `field_value: ${JSON.stringify(ORIGIN_OPTION)}`,
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    valueBeforeRestore: TEMP_OPTION,
    valueRestoredTo: ORIGIN_OPTION,
    requestBody: body,
    putStatus,
    putResponseRaw: putText === null ? null : putText.slice(0, 4000),
    threw,
    capturedStageId: cap.pipelineStageId,
    capturedStatus: cap.status,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(432);
  }

  console.log("");
  if (threw !== null) {
    console.log(`RESTORE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 5 observes; do not re-run step 4.");
    console.log("  The fixture may still be in the temporary state. Do NOT run the harness.");
    process.exit(433);
  }

  console.log(`RESTORE issued — PUT status ${putStatus}`);
  console.log(`  from      ${JSON.stringify(TEMP_OPTION)}`);
  console.log(`  to        ${JSON.stringify(ORIGIN_OPTION)}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 5 confirms the original label is back.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 434);
})().catch((e) => {
  console.error("RESTORE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(435);
});
