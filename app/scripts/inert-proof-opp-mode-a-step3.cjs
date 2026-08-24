/* PB-D59 Proof A, step 3 — VERIFY. READ ONLY. NO WRITES.
 *
 * A 200 is transport success. This is where it becomes an observation: the
 * exact label landed, nothing else moved, and the wire shape is recorded
 * DURING the mutation for comparison against step 1's before and step 5's
 * after.
 *
 * EXACT STRING EQUALITY. A picklist value can be subtly wrong in ways a
 * number cannot -- a trailing space, a different percent sign, a case
 * difference. The comparison is strict and the observed value is printed
 * with its JSON quoting so any such difference is visible rather than
 * inferred.
 *
 * BATTERY, six items. The four PB-D58 names plus fixtureUnchanged and
 * priorTargetsAbsent. The pass condition is stricter than PB-D58 specifies
 * and the evidence keeps the four in `confirmations` with the extras as
 * siblings.
 *
 * THE HARNESS STAYS PARKED. The fixture is mid-proof and
 * verify-underwriting.cjs cannot pass while assignment_mode holds
 * "25% of Buyer Profit". This step does not run it and neither should
 * anyone until step 5 confirms the restoration.
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

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
   PRIOR_TARGETS below.

   NO CONTACTS GUARD HERE, deliberately. This file resolves no contact id, and
   a guard on a section it never reads would refuse on something it does not
   trust. Section guards are per file, not per family. */
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
const fixtureOpportunities = fixtureRecords && fixtureRecords.opportunities;
if (!fixtureOpportunities || !fixtureOpportunities.iaosUnderwritingTest) {
  console.error(`REFUSED: harness-fixtures.json carries no fixtureRecords.opportunities.iaosUnderwritingTest for "${ENV}" (scripts/harness-fixtures.json). Refusing rather than inventing it.`);
  process.exit(4);
}

const envPins           = envFixtures.untouchedPins;
const opportunityFields = envPins && envPins.opportunityFields;
if (!opportunityFields || !opportunityFields.closing_costs) {
  console.error(`REFUSED: harness-fixtures.json carries no opportunityFields.closing_costs for "${ENV}" — expected ${ENV}.untouchedPins.opportunityFields.closing_costs. Refusing rather than inventing them.`);
  process.exit(4);
}

const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest;
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

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step2.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function shapeOf(entry) {
  if (entry === null || entry === undefined) return { present: false, keys: [], entry: null };
  return { present: true, keys: Object.keys(entry).sort(), entry };
}

function optionOf(entry) {
  if (entry === null || entry === undefined) return undefined;
  return entry.fieldValue ?? entry.fieldValueString ?? entry.value ?? undefined;
}

(async () => {
  let cap, wrote;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(390, `cannot read step 1 evidence: ${e.message}`); }
  try { wrote = JSON.parse(fs.readFileSync(STEP2, "utf8")); }
  catch (e) { fail(391, `cannot read step 2 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — SITE ④, step-2 read site: consumes NO environment-owned value.
     It consumes wrote.cycle, wrote.putStatus and wrote.tempOption and nothing
     else — a cycle marker, an HTTP integer off putRes.status, and a PICKLIST
     LABEL ("25% of Buyer Profit"). The label is not an identifier and is not in
     the 73-value predicate set; classify off ids, never off labels.
     STOP if you are adding a field here: this read site has no environment
     assertion because nothing environment-owned crosses it today. The artifact
     itself is NOT clean — it carries opportunityId, contactId, fieldId and
     capturedStageId, with requestBody re-carrying the field id: four distinct
     environment-owned values, unread. Adding one REQUIRES an
     assertEnvironment(...) call at this site first. The same artifact IS read
     through a CHECK at step 5 — a NOTE classifies the read site, not the
     artifact. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site (SITE ③) 1 value is COMPARED —
     opportunityId, L177 below — and 14 are ADOPTED BY VALUE: the 3 ids inside
     customFields, the 7 inside offerIds, pipelineStageId, the 2 inside
     fixtureState, and the id inside the wireShape ENTRY OBJECT adopted at L290.
     BY FIELD the same site reads 1 to 5. Family-wide: 12 COMPARED to 36
     ADOPTED by value, 12 to 16 by field.

     ⚠ fieldId IS NOT COMPARED AT THIS SITE AT ALL. This file never reads
     cap.fieldId. It is the weakest read site in the family and a per-site
     verdict of "CHECK, protected" would be true and useless.

     ⚠ ENTRY OBJECTS ARE NOT OPAQUE. wireShape is the {"id": …, "fieldValue": …}
     shape: the environment-owned id sits nested beside a human label. Count the
     id INSIDE it and classify off that id. A scan for named id fields does not
     see it, and a scan for bulk id arrays does not either.

     ⚠ COMPARED means compared against a LOCALLY RESOLVED CONSTANT. A comparison
     against a LIVE WIRE value is ADOPTED, always. pipelineStageId's only check,
     at L253 below, is against the live wire: drift consistency, not provenance.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and its persisted
     derivative liveStageId are environment-owned by value and appear as a
     source literal NOWHERE in this family. Conversion does nothing for them;
     the assertion above is their only protection. Do not record them as
     converted.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.cycle !== "proof-a" || wrote.cycle !== "proof-a") {
    fail(392, `evidence is not from cycle proof-a`, `step1=${cap.cycle} step2=${wrote.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(393, `step 1 names a different opportunity`);
  if (wrote.putStatus === null) fail(394, `step 2 recorded no PUT status; it threw. Do not proceed blind.`);
  if (wrote.tempOption !== TEMP_OPTION) fail(395, `step 2 wrote ${JSON.stringify(wrote.tempOption)}, this step expects ${JSON.stringify(TEMP_OPTION)}`);
  console.log(`PRECHECK ok — step 2 PUT ${wrote.putStatus}, wrote ${JSON.stringify(wrote.tempOption)}`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let observed = undefined;
  let observedEntry = null;
  let matched = false;

  while (polls < MAX_POLLS) {
    polls++;
    let res, text;
    try {
      res = await fetch(oppUrl);
      text = await res.text();
    } catch (e) {
      console.log(`  poll ${polls}/${MAX_POLLS}  transport error: ${(e && e.message) || e}`);
      if (polls < MAX_POLLS) { await sleep(POLL_MS); continue; }
      fail(396, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(397, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(398, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    observedEntry = entry;
    observed = optionOf(entry);
    console.log(`  poll ${polls}/${MAX_POLLS}  observed=${JSON.stringify(observed)}  entry=${JSON.stringify(entry)}`);

    if (observed === TEMP_OPTION) { matched = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  if (opp === null) fail(399, `no successful read across ${MAX_POLLS} polls`);

  // ── Wire shape DURING the mutation, both endpoints ──
  const singularShape = shapeOf(observedEntry);
  let listShape = { present: false, keys: [], entry: null };
  let listOption = undefined;
  try {
    const listRes = await fetch(LIST);
    const listText = await listRes.text();
    if (listRes.ok) {
      const listBody = JSON.parse(listText);
      const listOpp = (listBody.opportunities ?? []).find((o) => o.id === OPPORTUNITY_ID) ?? null;
      const listEntry = listOpp ? ((listOpp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null) : null;
      listShape = shapeOf(listEntry);
      listOption = optionOf(listEntry);
    } else {
      console.log(`  list endpoint → ${listRes.status}; shape not recorded this step`);
    }
  } catch (e) {
    console.log(`  list endpoint threw: ${(e && e.message) || e}; shape not recorded this step`);
  }

  // ── Battery ──
  const liveFields = opp.customFields ?? [];
  const capById  = new Map((cap.customFields ?? []).map((f) => [f.id, f]));
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
  const batteryFour = othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;

  const fixtureDrift = (cap.fixtureState ?? []).filter((f) =>
    JSON.stringify(liveById.get(f.id) ?? null) !== JSON.stringify(f.entry ?? null));
  const fixtureUnchanged = fixtureDrift.length === 0;

  const priorResidue = Object.entries(PRIOR_TARGETS)
    .filter(([, id]) => liveById.has(id))
    .map(([name, id]) => ({ name, id, entry: liveById.get(id) }));
  const priorTargetsAbsent = priorResidue.length === 0;

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "verify",
    cycle: "proof-a",
    proof: "PB-D59 Proof A",
    note: "READ ONLY. Fixture is mid-proof; verify-underwriting.cjs is not a valid gate until step 5 confirms restoration.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: cap.dataType,
    originOption: ORIGIN_OPTION,
    tempOption: TEMP_OPTION,
    polls,
    matched,
    observedValue: observed === undefined ? null : observed,
    observedType: typeof observed,
    observedEntry,
    wireShapeDuring: {
      singularGet: singularShape,
      listEndpoint: listShape,
      listValue: listOption === undefined ? null : listOption,
      keysDiffer: JSON.stringify(singularShape.keys) !== JSON.stringify(listShape.keys),
    },
    wireShapeBefore: cap.wireShape ?? null,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    fixtureUnchanged,
    fixtureDrift,
    priorTargetsAbsent,
    priorResidue,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(400, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`VERIFY  matched=${matched}  polls=${polls}`);
  console.log(`  observed          ${JSON.stringify(observed)}  (${typeof observed})`);
  console.log(`  expected          ${JSON.stringify(TEMP_OPTION)}`);
  console.log(`  entry             ${JSON.stringify(observedEntry)}`);
  console.log("");
  console.log("  WIRE SHAPE DURING:");
  console.log(`    singular keys   ${JSON.stringify(singularShape.keys)}`);
  console.log(`    list keys       ${JSON.stringify(listShape.keys)}`);
  console.log(`    list value      ${JSON.stringify(listOption)}`);
  console.log(`    keysDiffer      ${record.wireShapeDuring.keysDiffer}`);
  console.log("");
  console.log(`  othersUnchanged   ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged   ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged    ${stageUnchanged}`);
  console.log(`  statusUnchanged   ${statusUnchanged}`);
  console.log(`  fixtureUnchanged  ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  priorTargetsAbsent ${priorTargetsAbsent}${priorTargetsAbsent ? "" : "  residue=" + JSON.stringify(priorResidue)}`);
  console.log(`  evidence          ${EVIDENCE}`);

  const allConfirmed = batteryFour && fixtureUnchanged && priorTargetsAbsent;

  console.log("");
  if (!matched) {
    console.log("  Poll exhausted without exact label equality. That is an observation.");
    console.log("  The fixture may be in an unknown state. Do NOT re-run step 2.");
    console.log("  Read the evidence and decide before step 4.");
    process.exit(401);
  }
  if (!allConfirmed) {
    console.log("  The label landed BUT a confirmation failed. The write was not inert.");
    process.exit(402);
  }
  console.log(`  PB-D58 four-item battery: ${batteryFour}.  Plus fixtureUnchanged and priorTargetsAbsent.`);
  console.log("  The exact label landed and nothing else moved.");
  console.log("  Fixture remains in the TEMPORARY state. Step 4 restores.");
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY THREW:", (e && e.stack) || e);
  process.exit(403);
});
