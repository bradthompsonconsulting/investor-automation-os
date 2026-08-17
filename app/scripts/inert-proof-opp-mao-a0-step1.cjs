/* PB-D59 Proof A0, step 1 — CAPTURE. READ ONLY.
 *
 * PB-D59 section V requires three proofs before Approve may be rendered.
 * This is the first: a standalone absent-origin inert proof on
 * mao_max_allowable_offer, the second NUMERICAL carrier.
 *
 * WHY A0 EXISTS SEPARATELY. PB-D58 section IV: discharge does not
 * generalize -- dataType proves serialization, not field safety. Proving
 * this carrier only inside Proof B's three-field payload would conflate
 * composition failure with field failure. A0 removes the last per-field
 * unknown so a Proof B failure points at composition and nothing else.
 *
 * FIELD: opportunity.mao_max_allowable_offer, Atu5XCjpFElY8H64VG4h,
 * NUMERICAL. Seller MAO's carrier. Pre-existing and reused, not created
 * for underwriting.
 *
 * CONSUMER STATUS, OBSERVED 2026-08-17 and recorded in PB-D59 section V:
 * no live source reads or writes it; every code reference is under
 * app/.netlify/functions-serve/, the Netlify CLI build cache for two
 * functions deleted from source 2026-08-13. Its only historical writer was
 * mao-webhook.ts, retired that same day, whose retirement evidence found no
 * matching GHL webhook among the three configured. Absent on all 42
 * opportunities. The carrier is currently orphaned.
 *
 * CLEAR MECHANISM: `field_value: ""` clears an opportunity NUMERICAL field
 * to KEY_ABSENT -- OBSERVED PB-D58, reproduced on two fields. Not assumed.
 *
 * Evidence uses the A0 namespace and cannot collide with PB-D58's ten files.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31"; // IAOS Underwriting Test
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb"; // IAOS Test Probe
const TARGET_ID      = "Atu5XCjpFElY8H64VG4h"; // mao_max_allowable_offer
const TARGET_KEY     = "mao_max_allowable_offer";

/* The two carriers proven or pending elsewhere. Captured by name so drift in
   either is legible rather than anonymous inside othersUnchanged. */
const OTHER_CARRIERS = {
  endbuyer_maximum_purchase_price: "zOVIPwzLe41a0SQmwVAJ", // PB-D58 proven
  assignment_mode:                 "TpLo0WRc303TXAaBUbBf", // Proof A pending
};

/* The three deal-fact inputs the resolved-branch production harness depends
   on. assignment_mode is in both maps deliberately: it is a carrier AND a
   harness input. */
const FIXTURE_IDS = {
  arv_after_repair_value: "cBkygqcHRseZUGCYYeba",
  repair_estimate:        "hId4Yog6u5GP1Iwz1aNx",
  assignment_mode:        "TpLo0WRc303TXAaBUbBf",
};

const OFFER_IDS = [
  "4YiACDV4uB3zOlAdNIBb", "73oLHWnVjmOGSrBo5sC6", "9jm2SoN2aDtUtbesL0kG",
  "GxChepYArmgPllhKPq0R", "Nm1LZvQzaCGvXDq7TRCh", "XbW0B973nuaLtIjMkzO9",
  "eY5BOqE9juGpBfqwacWT",
];

/* PB-D58 section II's confirm evidence. Read as a precondition: A0 depends
   on that proof having established the clear mechanism AND restored. */
const PBD58_CONFIRM = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-endbuyer-max-step5.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step1.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  // ── Precondition: PB-D58 established the clear mechanism and discharged ──
  let prior;
  try { prior = JSON.parse(fs.readFileSync(PBD58_CONFIRM, "utf8")); }
  catch (e) { fail(210, `cannot read PB-D58 section II confirm evidence: ${e.message}`); }

  if (prior.outcome !== "CLEARED") {
    fail(211, `PB-D58 section II outcome was ${JSON.stringify(prior.outcome)}, not CLEARED`);
  }
  if (prior.restoredToOrigin !== true) {
    fail(212, `PB-D58 section II did not restore to origin`, JSON.stringify(prior.confirmations));
  }
  if (prior.dischargeable !== true) {
    fail(213, `PB-D58 section II was not dischargeable`, JSON.stringify(prior.discharge));
  }
  console.log(`PRECHECK PB-D58 ok — ${prior.mechanism} clears opportunity NUMERICAL, prerequisite 5 discharged`);

  // ── GET 1: the opportunity ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const oppRes = await fetch(oppUrl);
  const oppText = await oppRes.text();
  if (!oppRes.ok) fail(214, `GET /opportunities/${OPPORTUNITY_ID} → ${oppRes.status}`, oppText.slice(0, 400));

  let oppBody;
  try { oppBody = JSON.parse(oppText); }
  catch (e) { fail(215, `opportunity response is not JSON: ${e.message}`, oppText.slice(0, 400)); }

  const opp = oppBody.opportunity ?? oppBody;
  if (opp.id !== OPPORTUNITY_ID) fail(216, `opportunity identity mismatch: ${JSON.stringify(opp.id)}`);
  if (opp.contactId !== CONTACT_ID) fail(217, `contact identity mismatch: ${JSON.stringify(opp.contactId)}`);

  const customFields = opp.customFields ?? [];
  const byId = new Map(customFields.map((f) => [f.id, f]));

  const targetEntry = byId.get(TARGET_ID) ?? null;
  const fieldPresent = targetEntry !== null;

  // ── PB-D58's two proof targets must both be absent again ──
  const residue = [];
  for (const [name, id] of [
    ["endbuyer_maximum_purchase_price", "zOVIPwzLe41a0SQmwVAJ"],
    ["closing_costs", "N8Aa9t1SZhU7XnPPzxWk"],
  ]) {
    if (byId.has(id)) residue.push({ name, id, entry: byId.get(id) });
  }
  if (residue.length > 0) {
    fail(218, `a PB-D58 proof target carries a value again`, JSON.stringify(residue, null, 1));
  }
  console.log("PRECHECK residue ok — both PB-D58 targets absent live, not merely per their evidence");

  // ── GET 2: the schema, to confirm dataType and fieldKey from source ──
  const schemaUrl = `${PROXY}?path=${encodeURIComponent("/locations/jmHG4B8RdzwpfqruNf68/customFields?model=opportunity")}`;
  const schemaRes = await fetch(schemaUrl);
  const schemaText = await schemaRes.text();
  if (!schemaRes.ok) fail(219, `GET customFields?model=opportunity → ${schemaRes.status}`, schemaText.slice(0, 400));

  let schemaBody;
  try { schemaBody = JSON.parse(schemaText); }
  catch (e) { fail(220, `schema response is not JSON: ${e.message}`, schemaText.slice(0, 400)); }

  const def = (schemaBody.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  if (!def) fail(221, `target field ${TARGET_ID} not found in the opportunity schema`);
  if (def.dataType !== "NUMERICAL") fail(222, `target dataType is ${JSON.stringify(def.dataType)}, expected NUMERICAL`);
  if (def.fieldKey !== `opportunity.${TARGET_KEY}`) {
    fail(223, `target fieldKey is ${JSON.stringify(def.fieldKey)}, expected opportunity.${TARGET_KEY}`);
  }

  const fixtureState = Object.entries(FIXTURE_IDS).map(([key, id]) => ({
    key, id, entry: byId.get(id) ?? null,
  }));
  const otherCarrierState = Object.entries(OTHER_CARRIERS).map(([key, id]) => ({
    key, id, entry: byId.get(id) ?? null,
  }));

  const record = {
    timestamp: new Date().toISOString(),
    stage: "capture",
    cycle: "a0",
    proof: "PB-D59 Proof A0",
    note: "PB-D59 section V. A0 removes the last per-field unknown before Proof A and Proof B. Does NOT authorize Approve.",
    clearMechanism: prior.mechanism,
    clearMechanismBasis: "OBSERVED PB-D58, reproduced on two opportunity NUMERICAL fields",
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
    offerEntries: OFFER_IDS.map((id) => ({ id, entry: byId.get(id) ?? null })),
    fixtureState,
    otherCarrierState,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(224, `evidence persistence failed: ${e.message}`); }

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
  for (const f of fixtureState) console.log(`  fixture       ${f.key} = ${JSON.stringify(f.entry)}`);
  for (const c of otherCarrierState) console.log(`  carrier       ${c.key} = ${JSON.stringify(c.entry)}`);
  console.log(`  evidence      ${EVIDENCE}`);

  /* Hard stop on a populated origin, matching PB-D58 section II's capture.
     PB-D59 specifies A0 as absent-origin; a populated target means the
     proof's own contract does not hold, and PB-D30 holds the
     populated-origin mechanism behind a separate specification. Evidence
     is written before the abort. */
  if (fieldPresent) {
    console.log("");
    console.error("ABORT — the target is POPULATED. PB-D59 specifies A0 as absent-origin.");
    console.error("  Evidence is written. Do not run step 2.");
    process.exit(225);
  }
  process.exit(0);
})().catch((e) => {
  console.error("CAPTURE THREW:", (e && e.stack) || e);
  process.exit(226);
});
