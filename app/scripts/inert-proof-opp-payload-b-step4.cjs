/* PB-D59 Proof B, step 4 — RESTORE. ONE PUT, THREE FIELDS, MIXED CONTRACTS.
 *
 * The first restoration in this project that runs two different contracts
 * in one request:
 *
 *     endbuyer_maximum_purchase_price   field_value: ""       -> KEY_ABSENT
 *     mao_max_allowable_offer           field_value: ""       -> KEY_ABSENT
 *     assignment_mode                   field_value: label    -> the label
 *
 * Both mechanisms are OBSERVED, neither assumed. Clear-to-absent for
 * opportunity NUMERICAL was established by PB-D58 and reproduced by A0.
 * Restore-to-original-value for SINGLE_OPTIONS was established by Proof A.
 * This step composes them; it does not discover anything.
 *
 * ONE PUT, MATCHING THE WRITE. Step 2 sent all three in one request, so the
 * restoration does too -- the same shape, so composition is tested in both
 * directions rather than only on the way in.
 *
 * THE EMPTY VALUE IS AUTHORIZED HERE, AND ONLY FOR THE TWO NUMERICAL
 * CARRIERS. A guard aborts if an empty value is ever paired with
 * assignment_mode: SINGLE_OPTIONS clear semantics remain UNKNOWN and this
 * cycle must not accidentally establish them.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 5 observes the mixed origin
 * returned, and only that classifies the cycle.
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

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
   head's. */
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

const ENDBUYER_ID = config.opportunityFields.endBuyerMaxPrice;
const MAO_ID      = config.opportunityFields.sellerMAO;
const MODE_ID     = config.opportunityFields.assignmentMode;

const ENDBUYER_VALUE = 571204.86;
const MAO_VALUE      = 398715.29;
const MODE_VALUE     = "25% of Buyer Profit";
const MODE_ORIGIN    = "Standard Minimum";

const CLEAR = "";
const DISCOVERY_ID = opportunityFields.closing_costs;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step4.json";

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function readValue(entry) {
  if (entry === null || entry === undefined) return undefined;
  for (const k of ["fieldValue", "fieldValueNumber", "fieldValueString", "value"]) {
    if (entry[k] !== undefined) return entry[k];
  }
  return undefined;
}

(async () => {
  let cap, ver;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(540, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(541, `cannot read step 3 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — SITE ⑦, step-3 read site: consumes NO environment-owned value.
     It consumes exactly six fields: ver.cycle, ver.allLanded, ver.landedCount,
     ver.confirmations, ver.fixtureUnchanged and ver.discoveryAbsent — a cycle
     marker, a boolean, an integer, four booleans inside confirmations, and two
     more booleans. None can hold an environment-owned value under any run.

     ⚠ SEVEN ENVIRONMENT-BEARING CARRIERS SIT IN THIS ARTIFACT, UNREAD. READING
     ANY ONE OF THEM FLIPS THIS SITE FROM NOTE TO CHECK. They are, by name:

         opportunityId      — named field
         perCarrier         — KEYED CARRIER MAP; three carrier ids inside
         wireShapeDuring    — ENTRY OBJECTS; three carrier ids, one per member
         liveStageId        — OWN=YES / LIT=NO, wire-sourced stage id
         liveCustomFields   — BULK WIRE CAPTURE; FIVE distinct ids inside

     That is the exact list you are about to break. It is written out rather
     than summarised on purpose: "additional wire captures" would not tell the
     next person which ones. This artifact carries 7 distinct environment-owned
     values across 19 occurrences, the widest unread set in the campaign.

     Adding any of them REQUIRES an assertEnvironment(...) call at this site
     first. The same artifact IS read through a CHECK at step 5 — a NOTE
     classifies the read site, not the artifact. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site (SITE ⑥) 1 value is COMPARED —
     opportunityId, L184 below — and 6 are ADOPTED BY VALUE: the three carrier
     ids inside cap.carriers, pipelineStageId, and the two inside fixtureState.
     BY FIELD that reads 1 to 3. Family-wide: 7 COMPARED to 41 ADOPTED by
     value, 7 to 15 by field. This guard sits in front of a PUT, which makes
     the temptation to read it as coverage stronger here than anywhere else.
     It is not coverage. 1-of-7 is the honest measure.

     ⚠ NO fieldId EXISTS IN THIS FAMILY, so opportunityId is the only
     comparison available. Structural, not an omission.

     ⚠ COMPARED means compared against a LOCALLY RESOLVED CONSTANT. A
     comparison against a LIVE WIRE value is ADOPTED, always. pipelineStageId's
     only check, at L230 below, is against the live wire: drift consistency,
     not provenance.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and capturedStageId are
     environment-owned by value with NO source literal here. Conversion does
     nothing for them; the assertion above is the only thing standing between
     them and a cross-environment consumption, and it is the only such thing
     above this file's PUT. Do not report them as converted.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.cycle !== "proof-b" || ver.cycle !== "proof-b") {
    fail(542, `evidence is not from cycle proof-b`, `step1=${cap.cycle} step3=${ver.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(543, `step 1 names a different opportunity`);
  if (ver.allLanded !== true) {
    fail(544, `step 3 recorded allLanded=${ver.allLanded} (${ver.landedCount} of 3)`,
      `A partial state needs a decision, not a scripted restore of what was sent.`);
  }
  const c = ver.confirmations || {};
  const gateGreen = c.othersUnchanged && c.offersUnchanged && c.stageUnchanged && c.statusUnchanged
    && ver.fixtureUnchanged === true && ver.discoveryAbsent === true;
  if (!gateGreen) {
    fail(545, `step 3's six-item gate was not fully green`,
      JSON.stringify({ confirmations: c, fixtureUnchanged: ver.fixtureUnchanged, discoveryAbsent: ver.discoveryAbsent }));
  }

  /* The captured origin, read from evidence rather than assumed. The two
     NUMERICAL carriers must have been absent; the picklist must have held
     the label this step restores. */
  const capByKey = new Map((cap.carriers ?? []).map((x) => [x.key, x]));
  const capEnd  = capByKey.get("endbuyer_maximum_purchase_price");
  const capMao  = capByKey.get("mao_max_allowable_offer");
  const capMode = capByKey.get("assignment_mode");
  if (!capEnd || !capMao || !capMode) fail(546, `step 1 is missing one of the three carriers`);
  if (capEnd.present !== false || capMao.present !== false) {
    fail(547, `a NUMERICAL carrier was populated at capture; clear-to-absent would not restore it`,
      `endbuyer=${capEnd.present} mao=${capMao.present}`);
  }
  if (capMode.present !== true || capMode.originValue !== MODE_ORIGIN) {
    fail(548, `assignment_mode's captured origin is not ${JSON.stringify(MODE_ORIGIN)}`,
      `present=${capMode.present} value=${JSON.stringify(capMode.originValue)}`);
  }
  console.log("PRECHECK evidence ok — all three landed, six-item gate green, mixed origin confirmed from capture");
  console.log(`  endbuyer -> KEY_ABSENT via field_value: ""      (PB-D58, reproduced A0)`);
  console.log(`  mao      -> KEY_ABSENT via field_value: ""      (PB-D59 A0)`);
  console.log(`  mode     -> ${JSON.stringify(MODE_ORIGIN)}   (PB-D59 Proof A)`);

  // ── Live precondition: the temporary state is still what step 3 saw ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(549, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(550, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(551, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(552, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(553, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(554, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));
  const liveEnd  = readValue(liveById.get(ENDBUYER_ID) ?? null);
  const liveMao  = readValue(liveById.get(MAO_ID) ?? null);
  const liveMode = readValue(liveById.get(MODE_ID) ?? null);

  if (liveEnd !== ENDBUYER_VALUE) fail(555, `endbuyer does not hold the temporary value`, `observed=${JSON.stringify(liveEnd)}`);
  if (liveMao !== MAO_VALUE) fail(556, `mao does not hold the temporary value`, `observed=${JSON.stringify(liveMao)}`);
  if (liveMode !== MODE_VALUE) fail(557, `mode does not hold the temporary value`, `observed=${JSON.stringify(liveMode)}`);
  if (liveById.has(DISCOVERY_ID)) fail(558, `closing_costs carries a value again`, JSON.stringify(liveById.get(DISCOVERY_ID)));
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(559, `deal fact ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log("PRECHECK live ok — all three hold their temporary values, nothing else moved");

  // ── The body. Two clears and one value, one request. ──
  const body = {
    customFields: [
      { id: ENDBUYER_ID, field_value: CLEAR },
      { id: MAO_ID,      field_value: CLEAR },
      { id: MODE_ID,     field_value: MODE_ORIGIN },
    ],
  };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(560, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 3) fail(561, `body must carry exactly three fields`);

  const EXPECTED = new Map([
    [ENDBUYER_ID, CLEAR],
    [MAO_ID, CLEAR],
    [MODE_ID, MODE_ORIGIN],
  ]);
  const seen = new Set();
  for (const entry of body.customFields) {
    if (!EXPECTED.has(entry.id)) fail(562, `body carries an unexpected field id ${entry.id}`);
    if (seen.has(entry.id)) fail(563, `body carries duplicate entries for ${entry.id}`);
    seen.add(entry.id);
    if (entry.field_value !== EXPECTED.get(entry.id)) {
      fail(564, `body carries the wrong value for ${entry.id}`,
        `got=${JSON.stringify(entry.field_value)} expected=${JSON.stringify(EXPECTED.get(entry.id))}`);
    }
    /* The guard that matters most in this step. An empty value paired with
       the picklist would be an unauthorized SINGLE_OPTIONS clear experiment,
       and PB-D59 requires those semantics to remain UNKNOWN. */
    if (entry.id === MODE_ID && entry.field_value === "") {
      fail(565, `the body would clear assignment_mode; SINGLE_OPTIONS clear semantics must remain UNKNOWN`);
    }
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(566, `entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") fail(566, `entry carries unexpected key ${k}`);
    }
  }
  if (seen.size !== 3) fail(567, `body covers ${seen.size} distinct ids, expected 3`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(566, `forbidden top-level key ${k}`);

  const serialized = JSON.stringify(body);
  console.log(`BODY ok — two clears and one value, three distinct ids`);
  console.log(`  ${serialized}`);

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
    cycle: "proof-b",
    proof: "PB-D59 Proof B",
    note: "Mixed restoration in one request. Two clear-to-absent, one restore-to-value. HTTP 200 is not success; step 5 classifies.",
    mixedContracts: {
      endbuyer_maximum_purchase_price: "clear-to-absent",
      mao_max_allowable_offer:         "clear-to-absent",
      assignment_mode:                 "value-to-original-value",
    },
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    valuesBeforeRestore: {
      endbuyer_maximum_purchase_price: ENDBUYER_VALUE,
      mao_max_allowable_offer:         MAO_VALUE,
      assignment_mode:                 MODE_VALUE,
    },
    restoreTargets: {
      endbuyer_maximum_purchase_price: "KEY_ABSENT",
      mao_max_allowable_offer:         "KEY_ABSENT",
      assignment_mode:                 MODE_ORIGIN,
    },
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
    process.exit(568);
  }

  console.log("");
  if (threw !== null) {
    console.log(`RESTORE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  How much of the restoration landed is UNKNOWN. Step 5 observes.");
    console.log("  Do NOT re-run step 4. Do NOT run verify-underwriting.cjs.");
    process.exit(569);
  }

  const putOk = putStatus >= 200 && putStatus < 300;
  const REFUSAL = 570;
  console.log(`${putOk ? "RESTORE issued" : "RESTORE FAILED"} — PUT status ${putStatus}`);
  console.log(`  endbuyer_maximum_purchase_price  -> KEY_ABSENT`);
  console.log(`  mao_max_allowable_offer          -> KEY_ABSENT`);
  console.log(`  assignment_mode                  -> ${JSON.stringify(MODE_ORIGIN)}`);
  console.log(`  evidence  ${EVIDENCE}`);
  if (putOk) {
    console.log("  No re-read issued. Step 5 confirms the mixed origin returned.");
    process.exit(0);
  }
  console.log(`  Whether the mixed origin returned is UNKNOWN. Step 5 observes; do not re-run step 4. Refusal ${REFUSAL}.`);
  process.exit(REFUSAL);
})().catch((e) => {
  console.error("RESTORE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(571);
});
