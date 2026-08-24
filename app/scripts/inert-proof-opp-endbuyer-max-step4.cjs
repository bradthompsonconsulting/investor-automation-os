/* PB-D58 section II, step 4 — RESTORE. ONE PUT. NO RE-READ.
 *
 * Returns endbuyer_maximum_purchase_price to KEY_ABSENT using
 * `field_value: ""` — the mechanism section I's discovery cycle OBSERVED
 * 2026-08-17 on this same opportunity, on a NUMERICAL field, with all four
 * confirmations green and restoredToOrigin true.
 *
 * This is not a guess. It is the reason the discovery cycle existed: PB-D24
 * rejects value-only rollback, so an absent-origin proof needs a validated
 * path back to absence before it writes at all. Section I supplied it.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 5 observes whether the key is
 * absent, and only that classifies the cycle.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1 and step 3 evidence are both from the proof cycle
 *   step 3 recorded matched with its full gate green
 *   the live target still holds the test value
 *   stage, status, the fixture trio and the discovery field are unmoved
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

   LOADER *AND* CARRIER, like every member of this family. The idiom follows the
   identifier's owner, not the file's role. */
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
const TARGET_ID      = config.opportunityFields.endBuyerMaxPrice;
const TARGET_KEY     = "endbuyer_maximum_purchase_price";
const DISCOVERY_ID   = opportunityFields.closing_costs;
const TEST_VALUE     = 313370.42;

const CLEAR_VALUE = "";              // OBSERVED mechanism, section I
const CLEAR_LABEL = 'field_value: ""';

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step4.json";

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
  catch (e) { fail(160, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(161, `cannot read step 3 evidence: ${e.message}`); }
  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — step-3 read site: consumes NO environment-owned value.
     It consumes ver.cycle, ver.matched, ver.confirmations, ver.fixtureUnchanged,
     ver.discoveryStillAbsent, ver.observedValue and ver.observedKey and nothing
     else. A cycle marker, six booleans, the observed numeric value and the wire
     key name it was read under.
     STOP if you are adding a field here: this read site has no environment
     assertion because nothing environment-owned crosses it today. The artifact
     itself is NOT clean — it carries opportunityId, fieldId, observedEntry,
     liveCustomFields and liveStageId, five environment-owned fields, unread.
     Adding one to this destructure REQUIRES an assertEnvironment(...) call at
     this site first. The same artifact IS read through a CHECK at step 5 — a
     NOTE classifies this read site, not the artifact. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site 1 value is COMPARED (opportunityId,
     L62 below) and 4 are ADOPTED with no comparison (pipelineStageId and the
     three ids inside fixtureState). Family-wide: 12 COMPARED to 30 ADOPTED by
     value. This guard sits in front of a PUT, which makes the temptation to
     read it as coverage stronger here than anywhere else in the family. It is
     not coverage. 1-of-5 is the honest measure.

     FOUR VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in
     this family: customFields, offerIds, fixtureState and pipelineStageId.
     Not once, in any of the five files, is any of them checked against a
     locally resolved constant. Two of them — fixtureState and pipelineStageId
     — are consumed by this file directly, at L174 and L161, and neither is
     validated by anything above the PUT other than the assertEnvironment call.

     ⚠ pipelineStageId has NO source literal — it arrives from the wire and is
     persisted — so no identifier-based instrument sees it. Its only comparison,
     at L90 below, is against the LIVE wire value: that detects drift and
     establishes nothing about which environment produced it. The environment
     question is answered by assertEnvironment above and only there.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(162, `step 1 names a different opportunity`);
  if (cap.cycle !== "proof" || ver.cycle !== "proof") {
    fail(163, `evidence is not from the proof cycle`, `step1=${cap.cycle} step3=${ver.cycle}`);
  }
  if (ver.matched !== true) fail(164, `step 3 recorded matched=${ver.matched}; there is nothing proven to restore`);

  const c = ver.confirmations || {};
  const gateGreen = c.othersUnchanged && c.offersUnchanged && c.stageUnchanged && c.statusUnchanged
    && ver.fixtureUnchanged === true && ver.discoveryStillAbsent === true;
  if (!gateGreen) {
    fail(165, `step 3's gate was not fully green`,
      JSON.stringify({ confirmations: c, fixtureUnchanged: ver.fixtureUnchanged, discoveryStillAbsent: ver.discoveryStillAbsent }));
  }
  console.log(`PRECHECK step3 ok — ${ver.observedValue} landed under key ${JSON.stringify(ver.observedKey)}, six-item gate green`);
  console.log(`PRECHECK mechanism — ${CLEAR_LABEL}, OBSERVED section I on this opportunity, NUMERICAL`);

  // ── Live precondition ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(166, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(167, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(168, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(169, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(170, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(171, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  const liveRead = entryValue(liveById.get(TARGET_ID) ?? null);
  if (liveRead.value !== TEST_VALUE) {
    fail(172, `target does not currently hold the test value`,
      `observed=${JSON.stringify(liveRead.value)} key=${JSON.stringify(liveRead.key)} expected=${TEST_VALUE}`);
  }
  if (liveById.has(DISCOVERY_ID)) {
    fail(173, `the discovery field carries a value again`, JSON.stringify(liveById.get(DISCOVERY_ID)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(174, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — target holds ${TEST_VALUE}, everything else unmoved`);

  // ── The body ──
  const body = { customFields: [{ id: TARGET_ID, field_value: CLEAR_VALUE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(175, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(176, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(177, `body targets the wrong field`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(178, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(178, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(178, `unexpected entry key ${k}`);
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
    cycle: "proof",
    note: "PB-D58 section II. HTTP 200 is not success; step 5 classifies.",
    mechanism: CLEAR_LABEL,
    mechanismBasis: "OBSERVED section I discovery cycle, 2026-08-17, same opportunity, NUMERICAL",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    valueBeforeRestore: TEST_VALUE,
    valueBeforeRestoreKey: liveRead.key,
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
    process.exit(179);
  }

  console.log("");
  if (threw !== null) {
    console.log(`RESTORE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 5 observes; do not re-run step 4.");
    process.exit(180);
  }

  const putOk = putStatus >= 200 && putStatus < 300;
  const REFUSAL = 181;
  console.log(`${putOk ? "RESTORE issued" : "RESTORE FAILED"} — PUT status ${putStatus}`);
  console.log(`  mechanism ${CLEAR_LABEL}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  if (putOk) {
    console.log("  No re-read issued. Step 5 observes whether the key is absent.");
    process.exit(0);
  }
  console.log(`  Whether the restore landed is UNKNOWN. Step 5 observes; do not re-run step 4. Refusal ${REFUSAL}.`);
  process.exit(REFUSAL);
})().catch((e) => {
  console.error("RESTORE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(182);
});
