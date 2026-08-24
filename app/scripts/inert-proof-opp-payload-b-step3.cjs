/* PB-D59 Proof B, step 3 — VERIFY. READ ONLY. NO WRITES.
 *
 * Whether the composed payload landed. A 200 says the server accepted one
 * request; this proves three carriers each hold what was sent for them.
 *
 * PARTIAL IS THE OUTCOME THIS PROOF EXISTS TO DETECT. Each carrier is
 * checked independently and the result is per-carrier, not a single
 * boolean. If two landed and one did not, the evidence names which -- and
 * PB-D59 section IV's honest position is that a partial state is real, has
 * no clean automatic remedy, and must be reported rather than silently
 * compensated.
 *
 * ONE PARSER, PB-D59 section III as amended. `fieldValue` serves all three
 * carriers on the singular GET regardless of dataType. The other keys are
 * probed only so a shape change is visible rather than silent.
 *
 * WRONG-ID DETECTION. The two NUMERICAL values are deliberately distinct,
 * so a payload that wrote the right values to the wrong ids fails here
 * rather than passing as symmetric.
 *
 * THE HARNESS STAYS PARKED. assignment_mode holds "25% of Buyer Profit"
 * and two carriers hold test values; verify-underwriting.cjs cannot pass.
 * Do not run it until step 5 confirms restoration.
 */

const fs = require("fs");
const { stamp, assertEnvironment } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

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
   head's.

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

const ENDBUYER_ID = config.opportunityFields.endBuyerMaxPrice;
const MAO_ID      = config.opportunityFields.sellerMAO;
const MODE_ID     = config.opportunityFields.assignmentMode;

const ENDBUYER_VALUE = 571204.86;
const MAO_VALUE      = 398715.29;
const MODE_VALUE     = "25% of Buyer Profit";

const DISCOVERY_ID = opportunityFields.closing_costs;

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step2.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function shapeOf(entry) {
  if (entry === null || entry === undefined) return { present: false, keys: [], entry: null };
  return { present: true, keys: Object.keys(entry).sort(), entry };
}

function readValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValue", "fieldValueNumber", "fieldValueString", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  let cap, wrote;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(520, `cannot read step 1 evidence: ${e.message}`); }
  try { wrote = JSON.parse(fs.readFileSync(STEP2, "utf8")); }
  catch (e) { fail(521, `cannot read step 2 evidence: ${e.message}`); }

  assertEnvironment(cap, ENV, "step-1 evidence");

  /* NOTE — SITE ⑤, step-2 read site: consumes NO environment-owned value.
     ⚠ THIS IS THE MOST FRAGILE NOTE IN THE CAMPAIGN. IT DISPLACES mode-a's
     SITE ⑥. READ THIS BEFORE TOUCHING THE `sent` DESTRUCTURE BELOW.

     It consumes exactly three things: wrote.cycle, wrote.putStatus, and
     wrote.sent.<key>.value for the three carrier keys — a cycle marker, an
     HTTP integer, and three VALUES compared against locally resolved
     constants. No id crosses this site.

     ⚠ BUT THE BOUND OBJECT CONTAINS THREE IDS, ONE PROPERTY AWAY.
     `const sent = wrote.sent || {}` binds a keyed carrier map whose three
     members each carry an environment-owned id beside the value:

         sent.endbuyer_maximum_purchase_price.id   opportunityFields.endBuyerMaxPrice
         sent.mao_max_allowable_offer.id           opportunityFields.sellerMAO
         sent.assignment_mode.id                   opportunityFields.assignmentMode

     Every other NOTE in this campaign hid its carriers in fields that were
     ENTIRELY UNREAD. Here the consumed field itself contains the ids, and only
     the choice of `.value` over `.id` keeps this site clean. Reading `.id`,
     or passing `sent` to anything that walks it, flips this site to CHECK and
     REQUIRES an assertEnvironment(...) call here first.

     The artifact carries 6 further distinct environment-owned values UNREAD:
     opportunityId, contactId, capturedStageId, and three inside requestBody.
     The same artifact IS read through a CHECK at step 5 — a NOTE classifies
     the read site, not the artifact. */

  /* INCIDENTAL PROTECTION — NOT the provenance mechanism, and NOT coverage.
     ⚠ RECORD THE RATIO. At this read site (SITE ④) 1 value is COMPARED —
     opportunityId, L191 below — and 13 are ADOPTED BY VALUE: the 3 ids inside
     customFields, the 7 inside offerIds, pipelineStageId, and the 2 inside
     fixtureState. BY FIELD that reads 1 to 4. Family-wide: 7 COMPARED to 41
     ADOPTED by value, 7 to 15 by field — the weakest ratio measured, because
     this family has no fieldId to compare.

     ⚠ COMPARED means compared against a LOCALLY RESOLVED CONSTANT. A
     comparison against a LIVE WIRE value is ADOPTED, always. pipelineStageId's
     only check, at L293 below, is against the live wire: drift consistency,
     not provenance.

     ⚠ THE OWN=YES / LIT=NO QUADRANT. pipelineStageId and its persisted
     derivative liveStageId are environment-owned by value with NO source
     literal in this family. Conversion does nothing for them; the assertion
     above is their only protection. Do not report them as converted.

     Retained deliberately as defense-in-depth; do not remove or weaken. */
  if (cap.cycle !== "proof-b" || wrote.cycle !== "proof-b") {
    fail(522, `evidence is not from cycle proof-b`, `step1=${cap.cycle} step2=${wrote.cycle}`);
  }
  if (cap.opportunityId !== OPPORTUNITY_ID) fail(523, `step 1 names a different opportunity`);
  if (wrote.putStatus === null) fail(524, `step 2 recorded no PUT status; it threw. Do not proceed blind.`);

  const sent = wrote.sent || {};
  if (!sent.endbuyer_maximum_purchase_price || sent.endbuyer_maximum_purchase_price.value !== ENDBUYER_VALUE) {
    fail(525, `step 2 sent a different endbuyer value`, JSON.stringify(sent.endbuyer_maximum_purchase_price));
  }
  if (!sent.mao_max_allowable_offer || sent.mao_max_allowable_offer.value !== MAO_VALUE) {
    fail(526, `step 2 sent a different mao value`, JSON.stringify(sent.mao_max_allowable_offer));
  }
  if (!sent.assignment_mode || sent.assignment_mode.value !== MODE_VALUE) {
    fail(527, `step 2 sent a different mode value`, JSON.stringify(sent.assignment_mode));
  }
  console.log(`PRECHECK ok — step 2 PUT ${wrote.putStatus}, three carriers sent in one request`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  const TARGETS = [
    { key: "endbuyer_maximum_purchase_price", id: ENDBUYER_ID, expected: ENDBUYER_VALUE },
    { key: "mao_max_allowable_offer",         id: MAO_ID,      expected: MAO_VALUE },
    { key: "assignment_mode",                 id: MODE_ID,     expected: MODE_VALUE },
  ];

  let polls = 0;
  let opp = null;
  let landed = [];
  let allLanded = false;

  while (polls < MAX_POLLS) {
    polls++;
    let res, text;
    try {
      res = await fetch(oppUrl);
      text = await res.text();
    } catch (e) {
      console.log(`  poll ${polls}/${MAX_POLLS}  transport error: ${(e && e.message) || e}`);
      if (polls < MAX_POLLS) { await sleep(POLL_MS); continue; }
      fail(528, `all ${MAX_POLLS} polls failed at the transport layer`);
    }
    if (!res.ok) fail(529, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(530, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const byId = new Map((opp.customFields ?? []).map((f) => [f.id, f]));
    landed = TARGETS.map((t) => {
      const entry = byId.get(t.id) ?? null;
      const read = readValue(entry);
      return {
        key: t.key, id: t.id, expected: t.expected,
        observed: read.value === undefined ? null : read.value,
        observedKey: read.key,
        observedType: typeof read.value,
        entry,
        matched: read.value === t.expected,
      };
    });
    const count = landed.filter((l) => l.matched).length;
    console.log(`  poll ${polls}/${MAX_POLLS}  landed ${count} of 3  [${landed.map((l) => (l.matched ? "ok" : "--")).join(" ")}]`);

    if (count === 3) { allLanded = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  if (opp === null) fail(531, `no successful read across ${MAX_POLLS} polls`);

  // ── Wire shape during, per carrier, both endpoints ──
  let listById = new Map();
  try {
    const listRes = await fetch(LIST);
    if (listRes.ok) {
      const listBody = JSON.parse(await listRes.text());
      const listOpp = (listBody.opportunities ?? []).find((o) => o.id === OPPORTUNITY_ID) ?? null;
      if (listOpp) listById = new Map((listOpp.customFields ?? []).map((f) => [f.id, f]));
    }
  } catch (e) {
    console.log(`  list endpoint threw: ${(e && e.message) || e}; list shapes not recorded`);
  }
  const wireShapeDuring = landed.map((l) => ({
    key: l.key,
    singular: shapeOf(l.entry),
    list: shapeOf(listById.get(l.id) ?? null),
    listValue: readValue(listById.get(l.id) ?? null).value ?? null,
  }));

  // ── Battery ──
  const liveFields = opp.customFields ?? [];
  const capById  = new Map((cap.customFields ?? []).map((f) => [f.id, f]));
  const liveById = new Map(liveFields.map((f) => [f.id, f]));
  const carrierIds = new Set([ENDBUYER_ID, MAO_ID, MODE_ID]);
  const unionIds = [...new Set([...capById.keys(), ...liveById.keys()])].filter((id) => !carrierIds.has(id));

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
  const discoveryAbsent = !liveById.has(DISCOVERY_ID);

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "verify",
    cycle: "proof-b",
    proof: "PB-D59 Proof B",
    note: "READ ONLY. Fixture is mid-proof; verify-underwriting.cjs is not a valid gate until step 5 confirms restoration.",
    opportunityId: OPPORTUNITY_ID,
    polls,
    allLanded,
    landedCount: landed.filter((l) => l.matched).length,
    perCarrier: landed,
    wireShapeDuring,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    fixtureUnchanged,
    fixtureDrift,
    discoveryAbsent,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(532, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`VERIFY  allLanded=${allLanded}  ${record.landedCount} of 3  polls=${polls}`);
  for (const l of landed) {
    console.log(`  ${l.matched ? "OK    " : "FAILED"}  ${l.key}`);
    console.log(`            expected ${JSON.stringify(l.expected)}`);
    console.log(`            observed ${JSON.stringify(l.observed)}  (${l.observedType})  key=${JSON.stringify(l.observedKey)}`);
  }
  console.log("");
  console.log("  WIRE SHAPE DURING, per carrier:");
  for (const w of wireShapeDuring) {
    console.log(`    ${w.key}`);
    console.log(`      singular ${JSON.stringify(w.singular.keys)}   list ${JSON.stringify(w.list.keys)}`);
  }
  console.log("");
  console.log(`  othersUnchanged   ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged   ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged    ${stageUnchanged}`);
  console.log(`  statusUnchanged   ${statusUnchanged}`);
  console.log(`  fixtureUnchanged  ${fixtureUnchanged}${fixtureUnchanged ? " (arv, repairs)" : "  drift=" + JSON.stringify(fixtureDrift)}`);
  console.log(`  discoveryAbsent   ${discoveryAbsent}`);
  console.log(`  evidence          ${EVIDENCE}`);

  const allConfirmed = batteryFour && fixtureUnchanged && discoveryAbsent;

  console.log("");
  if (!allLanded) {
    console.log(`  PARTIAL: ${record.landedCount} of 3 carriers hold what was sent.`);
    console.log("  This is the outcome Proof B exists to detect. PB-D59 section IV:");
    console.log("  a partial state is real, has no clean automatic remedy, and is reported");
    console.log("  rather than silently compensated.");
    console.log("  Step 4 restores whatever actually landed. Do NOT re-run step 2.");
    process.exit(533);
  }
  if (!allConfirmed) {
    console.log("  All three landed BUT a confirmation failed. The payload was not inert.");
    process.exit(534);
  }
  console.log(`  PB-D58 four-item battery: ${batteryFour}.  Plus fixtureUnchanged and discoveryAbsent.`);
  console.log("  All three carriers landed together and nothing else moved.");
  console.log("  Composition holds. Fixture remains TEMPORARY. Step 4 restores the mixed origin.");
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY THREW:", (e && e.stack) || e);
  process.exit(535);
});
