/* PB-D59 Proof B, step 2 — WRITE. ONE PUT, THREE FIELDS. NO RE-READ.
 *
 * The write Approve performs. One custom-fields-only PUT carrying all three
 * carriers together -- not three PUTs. PB-D59 section II: three separate
 * PUTs would triple the window in which a partial state is visible and
 * would require compensating writes on failure at step two or three. One
 * request is the smaller surface.
 *
 * VALUES. Two designated NUMERICAL test values plus the one non-origin
 * picklist option:
 *
 *     endbuyer_maximum_purchase_price   571204.86    designated
 *     mao_max_allowable_offer           398715.29    designated
 *     assignment_mode                   "25% of Buyer Profit"
 *
 * The two numbers are deliberately distinct from each other so a swapped-id
 * defect is visible in the readback rather than passing as symmetric, and
 * distinct from every prior proof's value so evidence cannot be confused
 * across cycles.
 *
 * GHL DOCUMENTS NO TRANSACTION. PB-D59 section IV: one PUT is one request,
 * the closest thing to atomicity available, and it is not a database
 * transaction. If the readback comes back partial, that is an observation
 * this proof exists to make, and step 4's restoration handles whatever
 * actually landed rather than what was sent.
 *
 * EXPECTED CONSEQUENCE, not a defect. assignment_mode moves to
 * "25% of Buyer Profit" for the duration, so the workspace computes a
 * different Seller MAO. verify-underwriting.cjs is NOT a valid gate until
 * step 4 restores and step 5 confirms. DO NOT RUN IT until then.
 *
 * HTTP 200 IS TRANSPORT SUCCESS AND NOTHING MORE. Step 3 proves all three
 * landed.
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

const DISCOVERY_ID = opportunityFields.closing_costs;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step1.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step2.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
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
  let cap;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(480, `cannot read step 1 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     The assertEnvironment call above is the Stair P mechanism; the comparisons
     below are not a substitute for it.

     ⚠ RECORD THE RATIO. At this read site (SITE ③) 1 value is COMPARED —
     opportunityId, L173 below — and 6 are ADOPTED BY VALUE: the three carrier
     ids inside cap.carriers, pipelineStageId, and the two ids inside
     fixtureState. BY FIELD that reads 1 to 3. Family-wide: 7 COMPARED to 41
     ADOPTED by value, 7 to 15 by field.

     ⚠ THE COMPARED COLUMN IS SMALLER HERE THAN IN ANY PRIOR FAMILY, AND THE
     REASON IS STRUCTURAL. There is no fieldId in this family — three carriers,
     no single target — so there is nothing to compare a target id against.
     Prior families compared opportunityId AND fieldId; this one can only
     compare opportunityId. Do not read that as an omission to be fixed by
     adding a comparison; it is a consequence of the three-carrier shape.

     ⚠ COMPARED MEANS COMPARED AGAINST A LOCALLY RESOLVED CONSTANT. A
     comparison against a LIVE WIRE value is ADOPTED, always — it establishes
     drift consistency between capture and now, never environment provenance.
     pipelineStageId's only check, at L203 below, is against the live wire, so
     it is ADOPTED despite looking like a comparison.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId, and its persisted
     derivative capturedStageId, are ENVIRONMENT-OWNED BY VALUE while appearing
     as a source literal NOWHERE in this family. CONVERSION DOES NOTHING FOR
     THEM: there is no literal to convert, they arrive from the wire. The
     assertion above is their only protection. Do not report them as converted.

     ⚠ cap.carriers IS A KEYED CARRIER MAP, NOT AN OPAQUE FIELD. Three members,
     each with an id nested beside a human key and label. Count the ids inside
     it; a scan for named id fields does not see them and a scan for bulk id
     arrays does not either.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.cycle !== "proof-b") fail(481, `step 1 evidence is from cycle ${JSON.stringify(cap.cycle)}, not proof-b`);
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(482, `step 1 names a different opportunity`);
  if ((cap.problems ?? []).length > 0) {
    fail(483, `step 1 recorded precondition problems`, JSON.stringify(cap.problems, null, 1));
  }
  if ((cap.carriers ?? []).length !== 3) fail(484, `step 1 recorded ${(cap.carriers ?? []).length} carriers, expected 3`);

  const capByKey = new Map((cap.carriers ?? []).map((c) => [c.key, c]));
  const capEnd  = capByKey.get("endbuyer_maximum_purchase_price");
  const capMao  = capByKey.get("mao_max_allowable_offer");
  const capMode = capByKey.get("assignment_mode");
  if (!capEnd || !capMao || !capMode) fail(485, `step 1 is missing one of the three carriers`);
  if (capEnd.present !== false) fail(486, `capture recorded endbuyer present=${capEnd.present}, expected absent`);
  if (capMao.present !== false) fail(487, `capture recorded mao present=${capMao.present}, expected absent`);
  if (capMode.present !== true || capMode.originValue !== MODE_ORIGIN) {
    fail(488, `capture recorded assignment_mode present=${capMode.present} value=${JSON.stringify(capMode.originValue)}`);
  }
  console.log("PRECHECK step1 ok — 2 absent, 1 populated, no recorded problems");

  // ── Live precondition: the same mixed origin, right now ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const preRes = await fetch(oppUrl);
  const preText = await preRes.text();
  if (!preRes.ok) fail(489, `precheck GET → ${preRes.status}`, preText.slice(0, 400));
  let preBody;
  try { preBody = JSON.parse(preText); }
  catch (e) { fail(490, `precheck response is not JSON: ${e.message}`, preText.slice(0, 400)); }
  const pre = preBody.opportunity ?? preBody;

  if (pre.id !== OPPORTUNITY_ID) fail(491, `live identity mismatch`);
  if (pre.contactId !== CONTACT_ID) fail(492, `live contact mismatch`);
  if (pre.pipelineStageId !== cap.pipelineStageId) fail(493, `live stage moved since capture`);
  if (pre.status !== cap.status) fail(494, `live status moved since capture`);

  const liveById = new Map((pre.customFields ?? []).map((f) => [f.id, f]));

  if (liveById.has(ENDBUYER_ID)) fail(495, `endbuyer is populated live, absent at capture`, JSON.stringify(liveById.get(ENDBUYER_ID)));
  if (liveById.has(MAO_ID)) fail(496, `mao is populated live, absent at capture`, JSON.stringify(liveById.get(MAO_ID)));
  if (liveById.has(DISCOVERY_ID)) fail(497, `closing_costs carries a value again`, JSON.stringify(liveById.get(DISCOVERY_ID)));

  const liveMode = readValue(liveById.get(MODE_ID) ?? null);
  if (liveMode !== MODE_ORIGIN) {
    fail(498, `assignment_mode does not hold the captured origin`,
      `observed=${JSON.stringify(liveMode)} expected=${JSON.stringify(MODE_ORIGIN)}`);
  }
  for (const f of cap.fixtureState ?? []) {
    const live = JSON.stringify(liveById.get(f.id) ?? null);
    const captured = JSON.stringify(f.entry ?? null);
    if (live !== captured) fail(499, `deal fact ${f.key} drifted`, `captured=${captured} live=${live}`);
  }
  console.log(`PRECHECK live ok — both NUMERICAL carriers absent, mode holds ${JSON.stringify(MODE_ORIGIN)}, deal facts unchanged`);

  // ── The body. Three entries, one request. ──
  const body = {
    customFields: [
      { id: ENDBUYER_ID, field_value: ENDBUYER_VALUE },
      { id: MAO_ID,      field_value: MAO_VALUE },
      { id: MODE_ID,     field_value: MODE_VALUE },
    ],
  };

  const FORBIDDEN = new Set([
    "pipelineStageId", "status", "monetaryValue", "name",
    "pipelineId", "contactId", "assignedTo", "tags",
  ]);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 1 || topKeys[0] !== "customFields") {
    fail(500, `body must carry only customFields, got ${JSON.stringify(topKeys)}`);
  }
  if (body.customFields.length !== 3) fail(501, `body must carry exactly three fields, got ${body.customFields.length}`);

  const EXPECTED = new Map([
    [ENDBUYER_ID, ENDBUYER_VALUE],
    [MAO_ID, MAO_VALUE],
    [MODE_ID, MODE_VALUE],
  ]);
  const seen = new Set();
  for (const entry of body.customFields) {
    if (!EXPECTED.has(entry.id)) fail(502, `body carries an unexpected field id ${entry.id}`);
    if (seen.has(entry.id)) fail(503, `body carries duplicate entries for ${entry.id}`);
    seen.add(entry.id);
    if (entry.field_value !== EXPECTED.get(entry.id)) {
      fail(504, `body carries the wrong value for ${entry.id}`,
        `got=${JSON.stringify(entry.field_value)} expected=${JSON.stringify(EXPECTED.get(entry.id))}`);
    }
    if (entry.field_value === "") fail(505, `body carries an empty value for ${entry.id}; this step clears nothing`);
    for (const k of Object.keys(entry)) {
      if (FORBIDDEN.has(k)) fail(506, `entry carries forbidden key ${k}`);
      if (k !== "id" && k !== "field_value") fail(506, `entry carries unexpected key ${k}`);
    }
  }
  if (seen.size !== 3) fail(507, `body covers ${seen.size} distinct ids, expected 3`);
  for (const k of topKeys) if (FORBIDDEN.has(k)) fail(506, `forbidden top-level key ${k}`);

  const serialized = JSON.stringify(body);
  console.log(`BODY ok — three entries, three distinct ids`);
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
    stage: "write",
    cycle: "proof-b",
    proof: "PB-D59 Proof B",
    note: "The combined Approve payload. One PUT, three carriers. HTTP 200 is transport success; step 3 proves all three landed.",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    sent: {
      endbuyer_maximum_purchase_price: { id: ENDBUYER_ID, value: ENDBUYER_VALUE },
      mao_max_allowable_offer:         { id: MAO_ID,      value: MAO_VALUE },
      assignment_mode:                 { id: MODE_ID,     value: MODE_VALUE },
    },
    modeOrigin: MODE_ORIGIN,
    requestBody: body,
    putStatus,
    putResponseRaw: putText === null ? null : putText.slice(0, 4000),
    threw,
    capturedStageId: cap.pipelineStageId,
    capturedStatus: cap.status,
    harnessNote: "verify-underwriting.cjs is NOT a valid gate until step 4 restores and step 5 confirms. Its failure meanwhile is expected, not a regression.",
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) {
    console.error(`FATAL — evidence persistence failed after a mutating request: ${e.message}`);
    console.error(`  putStatus=${putStatus} threw=${threw}`);
    process.exit(508);
  }

  console.log("");
  if (threw !== null) {
    console.log(`WRITE THREW — ${threw}`);
    console.log(`  evidence  ${EVIDENCE}`);
    console.log("  How much of the payload landed is UNKNOWN. Step 3 observes; do not re-run step 2.");
    console.log("  Do NOT run verify-underwriting.cjs.");
    process.exit(509);
  }

  console.log(`WRITE issued — PUT status ${putStatus}`);
  console.log(`  endbuyer_maximum_purchase_price  <- ${ENDBUYER_VALUE}`);
  console.log(`  mao_max_allowable_offer          <- ${MAO_VALUE}`);
  console.log(`  assignment_mode                  <- ${JSON.stringify(MODE_VALUE)}  (was ${JSON.stringify(MODE_ORIGIN)})`);
  console.log(`  evidence  ${EVIDENCE}`);
  console.log("");
  console.log("  The fixture is now in the TEMPORARY proof state.");
  console.log("  Do NOT run verify-underwriting.cjs until step 4 restores and step 5 confirms.");
  console.log("  No re-read issued. Step 3 verifies all three landed.");
  process.exit(putStatus >= 200 && putStatus < 300 ? 0 : 510);
})().catch((e) => {
  console.error("WRITE THREW OUTSIDE THE REQUEST:", (e && e.stack) || e);
  process.exit(511);
});
