/* PB-D59 Proof A0, step 4 — RESTORE. ONE PUT. NO RE-READ.
 *
 * Returns mao_max_allowable_offer to KEY_ABSENT using `field_value: ""` --
 * the mechanism PB-D58 OBSERVED on this same opportunity, on NUMERICAL
 * fields, reproduced twice with restoredToOrigin true.
 *
 * NOT A SUCCESS CONDITION: HTTP 200. Step 5 observes whether the key is
 * absent, and only that classifies the cycle.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1 and step 3 evidence are both from cycle a0
 *   step 3 recorded matched with its full six-item gate green
 *   the live target still holds the test value
 *   both PB-D58 targets are still absent
 *   the fixture trio, stage and status are unmoved
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
   being a canonical-config member (opportunityFields.sellerMAO). The idiom
   follows the identifier's owner, not the file's role in the family. */
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
const TARGET_ID      = config.opportunityFields.sellerMAO;
const TARGET_KEY     = "mao_max_allowable_offer";
const TEST_VALUE     = 486210.73;

/* Mixed ownership in one binding: endBuyerMaxPrice is CONFIG-owned,
   closing_costs is CARRIER-owned. One resolution site, two owners. */
const PBD58_TARGETS = {
  endbuyer_maximum_purchase_price: config.opportunityFields.endBuyerMaxPrice,
  closing_costs:                   opportunityFields.closing_costs,
};

const CLEAR_VALUE = "";
const CLEAR_LABEL = 'field_value: ""';

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step1.json";
const STEP3    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step3.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step4.json";

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
  catch (e) { fail(280, `cannot read step 1 evidence: ${e.message}`); }
  try { ver = JSON.parse(fs.readFileSync(STEP3, "utf8")); }
  catch (e) { fail(281, `cannot read step 3 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — step-3 read site: consumes NO environment-owned value.
     It consumes ver.cycle, ver.matched, ver.confirmations, ver.fixtureUnchanged,
     ver.pbd58TargetsAbsent, ver.observedValue and ver.observedKey and nothing
     else. Producer-reachable: a cycle marker, six booleans (pbd58TargetsAbsent
     is pbd58Residue.length === 0, always boolean), the observed number, and a
     CLOSED FOUR-VALUE ENUM from entryValue() — fieldValue / fieldValueNumber /
     field_value / value. None can hold an identifier under any run.
     ⚠ ver.pbd58Residue IS NOT CONSUMED, and that is load-bearing: it is the one
     field of step-3's record that WOULD carry the two PB-D58 target ids. Adding
     it here flips this row to CHECK.
     STOP if you are adding a field here: this read site has no environment
     assertion because nothing environment-owned crosses it today. The artifact
     itself is NOT clean — it carries opportunityId, fieldId, observedEntry,
     liveStageId and four ids inside liveCustomFields, six distinct
     environment-owned values, unread. Adding one REQUIRES an
     assertEnvironment(...) call at this site first. The same artifact IS read
     through a CHECK at step 5 — a NOTE classifies the read site, not the
     artifact. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site 1 value is COMPARED (opportunityId,
     L160 below) and 4 are ADOPTED with no comparison (pipelineStageId and the
     three ids inside fixtureState). Family-wide: 12 COMPARED to 36 ADOPTED BY
     VALUE, 12 to 12 BY FIELD — the by-field figure reads as half-protected and
     is the misleading one. This guard sits in front of a PUT, which makes the
     temptation to read it as coverage stronger here than anywhere else in the
     family. It is not coverage. 1-of-5 is the honest measure.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and its persisted
     derivative capturedStageId are ENVIRONMENT-OWNED BY VALUE — matching
     canonical config stages.* — while appearing as a source literal NOWHERE in
     this family. Conversion does NOTHING for them; there is no literal to
     convert, they arrive through a wire capture. The assertEnvironment call
     above is the ONLY thing standing between them and a cross-environment
     consumption, and it is the only such thing above this file's PUT. Their
     sole comparison, at L184 below, is against the LIVE wire value: that
     detects drift between capture and now and establishes NOTHING about which
     environment produced them.

     FOUR VALUES ARE ADOPTED EVERYWHERE THEY APPEAR AND COMPARED NOWHERE in
     this family: customFields, offerIds, fixtureState and pipelineStageId. Two
     of them — fixtureState and pipelineStageId — are consumed by this file
     directly and neither is validated by anything above the PUT other than the
     assertEnvironment call.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.cycle !== "a0" || ver.cycle !== "a0") {
    fail(282, `evidence is not from cycle a0`, `step1=${cap.cycle} step3=${ver.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(283, `step 1 names a different opportunity`);
  if (ver.matched !== true) fail(284, `step 3 recorded matched=${ver.matched}; there is nothing proven to restore`);

  const c = ver.confirmations || {};
  const gateGreen = c.othersUnchanged && c.offersUnchanged && c.stageUnchanged && c.statusUnchanged
    && ver.fixtureUnchanged === true && ver.pbd58TargetsAbsent === true;
  if (!gateGreen) {
    fail(285, `step 3's six-item gate was not fully green`,
      JSON.stringify({ confirmations: c, fixtureUnchanged: ver.fixtureUnchanged, pbd58TargetsAbsent: ver.pbd58TargetsAbsent }));
  }
  console.log(`PRECHECK step3 ok — ${ver.observedValue} landed under key ${JSON.stringify(ver.observedKey)}, six-item gate green`);
  console.log(`PRECHECK mechanism — ${CLEAR_LABEL}, OBSERVED PB-D58 on two opportunity NUMERICAL fields`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(286, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(287, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(288, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(289, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(290, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(291, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  const liveRead = entryValue(liveById.get(TARGET_ID) ?? null);
  if (liveRead.value !== TEST_VALUE) {
    fail(292, `target does not currently hold the test value`,
      `observed=${JSON.stringify(liveRead.value)} key=${JSON.stringify(liveRead.key)} expected=${TEST_VALUE}`);
  }
  for (const [name, id] of Object.entries(PBD58_TARGETS)) {
    if (liveById.has(id)) fail(293, `PB-D58 target ${name} carries a value again`, JSON.stringify(liveById.get(id)));
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(294, `fixture field ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — target holds ${TEST_VALUE}, everything else unmoved`);

  const body = { customFields: [{ id: TARGET_ID, field_value: CLEAR_VALUE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(295, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(296, `body must carry exactly one field`);
  if (body.customFields[0].id !== TARGET_ID) fail(297, `body targets the wrong field`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(298, `forbidden top-level key ${k}`);
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(298, `forbidden entry key ${k}`);
      if (k !== "id" && k !== "field_value") fail(298, `unexpected entry key ${k}`);
    }
  }
  const serialized = JSON.stringify(body);
  console.log(`BODY ok — ${serialized}`);

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
    cycle: "a0",
    proof: "PB-D59 Proof A0",
    note: "PB-D59 section V. HTTP 200 is not success; step 5 classifies.",
    mechanism: CLEAR_LABEL,
    mechanismBasis: "OBSERVED PB-D58 2026-08-17, same opportunity, two NUMERICAL fields",
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
    process.exit(299);
  }

  console.log("");
  if (threw !== null) {
    console.log(`RESTORE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 5 observes; do not re-run step 4.");
    process.exit(300);
  }

  console.log(`RESTORE issued — PUT status ${putStatus}`);
  console.log(`  mechanism ${CLEAR_LABEL}`);
  console.log(`  body      ${serialized}`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("  No re-read issued. Step 5 observes whether the key is absent.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 301);
})().catch((e) => {
  console.error("RESTORE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(302);
});
