/* PB-D58 section II, step 2 — WRITE. ONE PUT. NO RE-READ, NO POLL.
 *
 * The proof cycle's mutation. One custom-fields-only PUT setting
 * endbuyer_maximum_purchase_price to a designated test value, evidence
 * persisted, stop. Step 3 verifies.
 *
 * TEST VALUE: 313370.42. Designated, not observed. Six digits plus cents so
 * the field's precision is exercised, and deliberately far from anything
 * this fixture computes — the workspace resolves End-Buyer Maximum Purchase
 * Price to $150,143 on these inputs, so a value near that would be
 * indistinguishable from a real approved figure in the evidence.
 *
 * THE PUT BODY CARRIES ONLY customFields, AND ONLY THE TARGET ID.
 * Key-based guard, not substring-based. The mechanism the whole proof rests
 * on is that a custom-fields-only PUT cannot fire stage triggers; a body
 * carrying anything else forfeits it.
 *
 * PRECONDITIONS, all aborting before the PUT:
 *   step 1's evidence exists, names this opportunity and field, absent origin
 *   the live target is still absent
 *   the live stage and status still match capture
 *   the three fixture fields still carry exactly what capture recorded
 *   the discovery field is still absent
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

   LOADER *AND* CARRIER, like every member of this family. The target field is a
   canonical-config member, so a tail needs the loader exactly as the head does.
   The idiom follows the identifier's owner, not the file's role in the family.
   No locationId is resolved here — only step 1 makes the schema request. */
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

const TEST_VALUE = 313370.42;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step1.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step2.json";

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(110, `cannot read step 1 evidence: ${e.message}`); }
  assertEnvironment(cap, ENV, "step-1 evidence");

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     The two comparisons below check an artifact identifier against a locally
     resolved constant. They catch a stale or mismatched capture and do
     incidentally reject SOME environment crossings. The assertEnvironment call
     above is the Stair P mechanism; these are not a substitute for it.

     ⚠ RECORD THE RATIO, NOT THE CLASSIFICATION. At this read site 2 values are
     COMPARED (opportunityId, fieldId) and 4 are ADOPTED with no comparison
     (pipelineStageId, and the three ids inside fixtureState). Family-wide the
     split is 12 COMPARED to 30 ADOPTED by value. customFields, offerIds,
     fixtureState and pipelineStageId are ADOPTED at every site they appear and
     are compared against a locally resolved constant NOWHERE in this family.
     "An identity guard is present" is true here and invites exactly the wrong
     conclusion; 2-of-6 is the honest measure.

     ⚠ pipelineStageId IS A CLASS OF ITS OWN. It has NO source literal anywhere
     in this family — it arrives from the wire and is persisted — so no
     identifier-based instrument can see it, and no conversion scan will ever
     report it. Its only comparison, at L74 below, is against the LIVE wire
     value. That detects drift between capture and now. It establishes nothing
     about which environment produced it. Different job, different claim; the
     environment question is answered by assertEnvironment above and only there.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(111, `step 1 names a different opportunity: ${cap.opportunityId}`);
  if (cap.fieldId !== TARGET_ID) fail(112, `step 1 names a different field: ${cap.fieldId}`);
  if (cap.dataType !== "NUMERICAL") fail(113, `step 1 recorded dataType ${JSON.stringify(cap.dataType)}`);
  if (cap.fieldPresent !== false) {
    fail(114, `step 1 recorded fieldPresent=${cap.fieldPresent}; section II requires an absent origin`);
  }
  if (cap.cycle !== "proof") fail(115, `step 1 evidence is from cycle ${JSON.stringify(cap.cycle)}, not proof`);
  console.log(`PRECHECK step1 ok — absent origin, NUMERICAL, clear mechanism ${cap.clearMechanism}`);

  // ── Live precondition ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(116, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(117, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(118, `live identity mismatch: ${JSON.stringify(pre.id)}`);
  if (pre.contactId !== CONTACT_ID) fail(119, `live contact mismatch: ${JSON.stringify(pre.contactId)}`);
  if (pre.pipelineStageId !== cap.pipelineStageId) {
    fail(120, `live stage moved since capture`, `${JSON.stringify(pre.pipelineStageId)} vs ${JSON.stringify(cap.pipelineStageId)}`);
  }
  if (pre.status !== cap.status) {
    fail(121, `live status moved since capture`, `${JSON.stringify(pre.status)} vs ${JSON.stringify(cap.status)}`);
  }

  const liveFields = pre.customFields ?? [];
  const liveById = new Map(liveFields.map((f) => [f.id, f]));

  if (liveById.has(TARGET_ID)) {
    fail(122, `target is populated live, absent at capture`, JSON.stringify(liveById.get(TARGET_ID)));
  }
  if (liveById.has(DISCOVERY_ID)) {
    fail(123, `the discovery field carries a value again`, JSON.stringify(liveById.get(DISCOVERY_ID)));
  }

  /* The three fixture fields must be byte-identical to capture. They are the
     resolved-branch harness's inputs; drift in them would mean this proof is
     running against a different record than the one captured. */
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) {
      fail(124, `fixture field ${f.key} drifted since capture`, `captured=${captured} live=${live}`);
    }
  }
  console.log("PRECHECK live ok — target absent, discovery field absent, fixture trio unchanged, stage and status unmoved");

  // ── The body ──
  const body = { customFields: [{ id: TARGET_ID, field_value: TEST_VALUE }] };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(125, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 1) fail(126, `body must carry exactly one field, got ${body.customFields.length}`);
  if (body.customFields[0].id !== TARGET_ID) fail(127, `body targets the wrong field: ${body.customFields[0].id}`);
  for (const k of topKeys) {
    if (FORBIDDEN.has(k)) fail(128, `body carries forbidden top-level key ${k}`);
  }
  for (const entry of body.customFields) {
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(128, `customFields entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") {
        fail(128, `customFields entry carries unexpected key ${k}; only id and field_value are permitted`);
      }
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
    stage: "write",
    cycle: "proof",
    note: "PB-D58 section II. This cycle discharges prerequisite 5 if all five steps complete.",
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
    clearMechanism: cap.clearMechanism,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(129);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  Whether the mutation landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    process.exit(130);
  }

  const putOk = putStatus >= 200 && putStatus < 300;
  const REFUSAL = 131;
  console.log(`${putOk ? "WRITE issued" : "WRITE FAILED"} — PUT status ${putStatus}`);
  console.log(`  value     ${TEST_VALUE}`);
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
  process.exit(132);
});
