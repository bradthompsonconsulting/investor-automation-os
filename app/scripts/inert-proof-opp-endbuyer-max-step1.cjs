/* PB-D58 section II, step 1 — CAPTURE. READ ONLY.
 *
 * THE PROOF CYCLE. Unlike section I's discovery cycle, this one discharges
 * PB-D56 prerequisite 5 when all five steps complete as specified.
 *
 * FIELD: opportunity.endbuyer_maximum_purchase_price,
 * zOVIPwzLe41a0SQmwVAJ, NUMERICAL. Absent on all 42 opportunities as
 * OBSERVED 2026-08-13.
 *
 * Not the three populated fixture fields: arv_after_repair_value,
 * repair_estimate and assignment_mode carry values the resolved-branch
 * production harness depends on, and proving against them would require the
 * unspecified populated-origin mechanism AND contaminate a working fixture.
 *
 * CLEAR MECHANISM, now OBSERVED rather than assumed. Section I's discovery
 * cycle established 2026-08-17 that `field_value: ""` clears an opportunity
 * NUMERICAL field to KEY_ABSENT, on this same opportunity, with all four
 * confirmations green and restoredToOrigin true. This cycle uses that
 * mechanism. It is the reason the cycle can run at all.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31"; // IAOS Underwriting Test
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb"; // IAOS Test Probe
const TARGET_ID      = "zOVIPwzLe41a0SQmwVAJ"; // endbuyer_maximum_purchase_price
const TARGET_KEY     = "endbuyer_maximum_purchase_price";

const OFFER_IDS = [
  "4YiACDV4uB3zOlAdNIBb", "73oLHWnVjmOGSrBo5sC6", "9jm2SoN2aDtUtbesL0kG",
  "GxChepYArmgPllhKPq0R", "Nm1LZvQzaCGvXDq7TRCh", "XbW0B973nuaLtIjMkzO9",
  "eY5BOqE9juGpBfqwacWT",
];

/* The three fixture fields the resolved-branch harness depends on. Captured
   explicitly so drift in any of them is visible by name rather than only as
   an othersUnchanged failure. */
const FIXTURE_IDS = {
  arv_after_repair_value: "cBkygqcHRseZUGCYYeba",
  repair_estimate:        "hId4Yog6u5GP1Iwz1aNx",
  assignment_mode:        "TpLo0WRc303TXAaBUbBf",
};

/* Section I's confirm evidence. Read as a precondition: this cycle depends
   on that cycle having established the clear mechanism AND restored. */
const DISCOVERY_CONFIRM = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step5.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step1.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  // ── Precondition: section I established the clear mechanism ──
  let disc;
  try { disc = JSON.parse(fs.readFileSync(DISCOVERY_CONFIRM, "utf8")); }
  catch (e) { fail(90, `cannot read the discovery cycle's confirm evidence: ${e.message}`); }

  if (disc.outcome !== "CLEARED") {
    fail(91, `discovery cycle outcome was ${JSON.stringify(disc.outcome)}, not CLEARED`,
      `Without an observed clear mechanism there is no absent-origin proof to run.`);
  }
  if (disc.restoredToOrigin !== true) {
    fail(92, `discovery cycle did not restore to origin`, JSON.stringify(disc.confirmations));
  }
  if (disc.dataType !== "NUMERICAL") {
    fail(93, `discovery cycle proved dataType ${JSON.stringify(disc.dataType)}, not NUMERICAL`);
  }
  console.log(`PRECHECK discovery ok — ${disc.candidateLabel} clears opportunity NUMERICAL to KEY_ABSENT`);

  // ── GET 1: the opportunity ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const oppRes = await fetch(oppUrl);
  const oppText = await oppRes.text();
  if (!oppRes.ok) fail(94, `GET /opportunities/${OPPORTUNITY_ID} → ${oppRes.status}`, oppText.slice(0, 400));

  let oppBody;
  try { oppBody = JSON.parse(oppText); }
  catch (e) { fail(95, `opportunity response is not JSON: ${e.message}`, oppText.slice(0, 400)); }

  const opp = oppBody.opportunity ?? oppBody;
  if (opp.id !== OPPORTUNITY_ID) fail(96, `opportunity identity mismatch: ${JSON.stringify(opp.id)}`);
  if (opp.contactId !== CONTACT_ID) fail(97, `contact identity mismatch: ${JSON.stringify(opp.contactId)}`);

  const customFields = opp.customFields ?? [];
  const targetEntry = customFields.find((f) => f.id === TARGET_ID) ?? null;
  const fieldPresent = targetEntry !== null;

  // ── The discovery target must be absent again. Section I said it restored;
  //    this verifies that live rather than trusting the evidence file. ──
  const DISCOVERY_TARGET = "N8Aa9t1SZhU7XnPPzxWk";
  const discoveryResidue = customFields.find((f) => f.id === DISCOVERY_TARGET) ?? null;
  if (discoveryResidue !== null) {
    fail(98, `the discovery cycle's field still carries a value`, JSON.stringify(discoveryResidue));
  }
  console.log("PRECHECK residue ok — the discovery field is absent live, not merely per its evidence");

  // ── GET 2: the schema, to confirm dataType from source ──
  const schemaUrl = `${PROXY}?path=${encodeURIComponent("/locations/jmHG4B8RdzwpfqruNf68/customFields?model=opportunity")}`;
  const schemaRes = await fetch(schemaUrl);
  const schemaText = await schemaRes.text();
  if (!schemaRes.ok) fail(99, `GET customFields?model=opportunity → ${schemaRes.status}`, schemaText.slice(0, 400));

  let schemaBody;
  try { schemaBody = JSON.parse(schemaText); }
  catch (e) { fail(100, `schema response is not JSON: ${e.message}`, schemaText.slice(0, 400)); }

  const def = (schemaBody.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  if (!def) fail(101, `target field ${TARGET_ID} not found in the opportunity schema`);
  if (def.dataType !== "NUMERICAL") fail(102, `target dataType is ${JSON.stringify(def.dataType)}, expected NUMERICAL`);
  if (def.fieldKey !== `opportunity.${TARGET_KEY}`) {
    fail(103, `target fieldKey is ${JSON.stringify(def.fieldKey)}, expected opportunity.${TARGET_KEY}`);
  }

  const fixtureState = Object.entries(FIXTURE_IDS).map(([key, id]) => ({
    key, id, entry: customFields.find((f) => f.id === id) ?? null,
  }));

  const record = {
    timestamp: new Date().toISOString(),
    stage: "capture",
    cycle: "proof",
    note: "PB-D58 section II. THIS CYCLE DISCHARGES PREREQUISITE 5 if all five steps complete.",
    clearMechanism: disc.candidateLabel,
    clearMechanismObservedAt: disc.timestamp,
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: def.dataType,
    fieldName: def.name ?? null,
    schemaFieldKey: def.fieldKey ?? null,
    fieldPresent,
    originValue: targetEntry,
    pipelineId: opp.pipelineId ?? null,
    pipelineStageId: opp.pipelineStageId ?? null,
    status: opp.status ?? null,
    monetaryValue: opp.monetaryValue ?? null,
    opportunityName: opp.name ?? null,
    customFields,
    offerIds: OFFER_IDS,
    offerEntries: OFFER_IDS.map((id) => ({ id, entry: customFields.find((f) => f.id === id) ?? null })),
    fixtureState,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(104, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log("CAPTURE ok — READ ONLY, no writes issued.");
  console.log(`  opportunity   ${OPPORTUNITY_ID}  ${JSON.stringify(record.opportunityName)}`);
  console.log(`  target        ${TARGET_KEY}`);
  console.log(`                ${TARGET_ID}  ${def.dataType}  ${JSON.stringify(def.name)}`);
  console.log(`  fieldPresent  ${fieldPresent}`);
  console.log(`  originValue   ${JSON.stringify(targetEntry)}`);
  console.log(`  stage         ${record.pipelineStageId}`);
  console.log(`  status        ${JSON.stringify(record.status)}`);
  console.log(`  customFields  ${customFields.length} entries`);
  console.log(`  offer_ present ${record.offerEntries.filter((o) => o.entry !== null).length} of 7`);
  for (const f of fixtureState) {
    console.log(`  fixture       ${f.key} = ${JSON.stringify(f.entry)}`);
  }
  console.log(`  evidence      ${EVIDENCE}`);

  /* Hard stop, not a warning — unlike the discovery cycle's capture. That
     field has no consumer, so seeing a populated state and deciding was
     acceptable there. This cycle discharges PB-D56 prerequisite 5, and
     PB-D58 section II asserts the target is absent on all 42 opportunities.
     A populated origin means the cycle's own contract does not hold, and
     exiting 0 would invite step 2 to run the wrong experiment. Evidence is
     written either way, so the state is recorded before the abort. */
  if (fieldPresent) {
    console.log("");
    console.error("ABORT — the target is POPULATED. PB-D58 section II requires an absent origin.");
    console.error("  Evidence is written. Do not run step 2. This is a different experiment");
    console.error("  than the one section II specifies, and PB-D30 holds the populated-origin");
    console.error("  mechanism behind a separate specification.");
    process.exit(106);
  }
  process.exit(0);
})().catch((e) => {
  console.error("CAPTURE THREW:", (e && e.stack) || e);
  process.exit(105);
});
