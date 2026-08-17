/* PB-D59 Proof A, step 1 — CAPTURE. READ ONLY.
 *
 * The first SINGLE_OPTIONS write anywhere in IAOS begins after this step.
 * Nothing here mutates: two GETs, one evidence file, and a hard stop if any
 * precondition differs from what PB-D59 section V specifies.
 *
 * FIELD: opportunity.assignment_mode, TpLo0WRc303TXAaBUbBf, SINGLE_OPTIONS.
 * The third of PB-D59's three Approve carriers and the only one still
 * unproven.
 *
 * POPULATED ORIGIN, and that is the point. The fixture carries
 * "Standard Minimum". Restoration therefore means the ORIGINAL OPTION
 * STRING RETURNS EXACTLY -- not a clear to KEY_ABSENT. That is a different
 * restoration contract from PB-D58's and A0's, and PB-D59 section V states
 * it explicitly:
 *
 *     absent origin      restoration = clear to KEY_ABSENT
 *     populated origin   restoration = the original value returns exactly
 *
 * NO REHEARSAL FIELD EXISTS. assignment_mode is the only SINGLE_OPTIONS
 * field on the opportunity model and it is the field Approve writes, so
 * discovery and the field proof are the same cycle. Forced by the schema,
 * not chosen.
 *
 * SINGLE_OPTIONS CLEAR SEMANTICS ARE NOT BEING ESTABLISHED. Approve writes
 * a mode over whatever mode is there and never clears one. This cycle
 * never sends an empty value and nobody may read it as having established
 * how to clear a picklist.
 *
 * WIRE SHAPE IS OBSERVED DELIBERATELY, NOT INCIDENTALLY. The NUMERICAL
 * singular-GET/list divergence surfaced by accident on 2026-08-17 because
 * one script happened to record the whole entry. This capture records the
 * SINGLE_OPTIONS representation on both endpoints on purpose: the raw entry
 * from the singular GET, the raw entry from the list endpoint, and every
 * key each carries. Steps 3 and 5 record the same, so the before / during /
 * after shapes are comparable rather than assumed.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31"; // IAOS Underwriting Test
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb"; // IAOS Test Probe
const TARGET_ID      = "TpLo0WRc303TXAaBUbBf"; // assignment_mode
const TARGET_KEY     = "assignment_mode";

const ORIGIN_OPTION = "Standard Minimum";      // expected current value
const TEMP_OPTION   = "25% of Buyer Profit";   // what step 2 will write

/* PB-D56 section II's three modes, exactly and in order. The schema's
   picklistOptions are asserted against this list: if GHL's options have
   drifted from the decision, the proof does not proceed. */
const EXPECTED_OPTIONS = ["Standard Minimum", "25% of Buyer Profit", "Manual"];

/* The two proven carriers. Both must be absent -- they were restored to
   KEY_ABSENT by PB-D58 and A0, and a value on either means something wrote
   since. */
const PROVEN_CARRIERS = {
  endbuyer_maximum_purchase_price: "zOVIPwzLe41a0SQmwVAJ",
  mao_max_allowable_offer:         "Atu5XCjpFElY8H64VG4h",
};
const PBD58_DISCOVERY = { closing_costs: "N8Aa9t1SZhU7XnPPzxWk" };

/* The two deal facts the resolved-branch harness depends on. assignment_mode
   is the third but it is the target, so it is tracked separately. */
const FIXTURE_IDS = {
  arv_after_repair_value: "cBkygqcHRseZUGCYYeba",
  repair_estimate:        "hId4Yog6u5GP1Iwz1aNx",
};

const OFFER_IDS = [
  "4YiACDV4uB3zOlAdNIBb", "73oLHWnVjmOGSrBo5sC6", "9jm2SoN2aDtUtbesL0kG",
  "GxChepYArmgPllhKPq0R", "Nm1LZvQzaCGvXDq7TRCh", "XbW0B973nuaLtIjMkzO9",
  "eY5BOqE9juGpBfqwacWT",
];

const A0_CONFIRM = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step5.json";
const EVIDENCE   = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step1.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

/** Every key an entry carries, so the wire shape is recorded rather than probed. */
function shapeOf(entry) {
  if (entry === null || entry === undefined) return { present: false, keys: [], entry: null };
  return { present: true, keys: Object.keys(entry).sort(), entry };
}

(async () => {
  // ── Precondition: A0 completed and restored ──
  let a0;
  try { a0 = JSON.parse(fs.readFileSync(A0_CONFIRM, "utf8")); }
  catch (e) { fail(330, `cannot read A0 confirm evidence: ${e.message}`); }

  if (a0.outcome !== "CLEARED") fail(331, `A0 outcome was ${JSON.stringify(a0.outcome)}, not CLEARED`);
  if (a0.restoredToOrigin !== true) fail(332, `A0 did not restore to origin`, JSON.stringify(a0.confirmations));
  if (a0.a0Complete !== true) fail(333, `A0 was not complete`, JSON.stringify(a0.complete));
  console.log("PRECHECK A0 ok — mao_max_allowable_offer proven inert and restored");

  // ── GET 1: the singular opportunity ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const oppRes = await fetch(oppUrl);
  const oppText = await oppRes.text();
  if (!oppRes.ok) fail(334, `GET /opportunities/${OPPORTUNITY_ID} → ${oppRes.status}`, oppText.slice(0, 400));

  let oppBody;
  try { oppBody = JSON.parse(oppText); }
  catch (e) { fail(335, `opportunity response is not JSON: ${e.message}`, oppText.slice(0, 400)); }

  const opp = oppBody.opportunity ?? oppBody;
  if (opp.id !== OPPORTUNITY_ID) fail(336, `opportunity identity mismatch: ${JSON.stringify(opp.id)}`);
  if (opp.contactId !== CONTACT_ID) fail(337, `contact identity mismatch: ${JSON.stringify(opp.contactId)}`);

  const customFields = opp.customFields ?? [];
  const byId = new Map(customFields.map((f) => [f.id, f]));

  const targetEntry = byId.get(TARGET_ID) ?? null;
  const singularShape = shapeOf(targetEntry);

  // ── GET 2: the LIST endpoint, for the same field on the same record ──
  const listRes = await fetch(LIST);
  const listText = await listRes.text();
  if (!listRes.ok) fail(338, `GET ghl-opportunities → ${listRes.status}`, listText.slice(0, 400));

  let listBody;
  try { listBody = JSON.parse(listText); }
  catch (e) { fail(339, `list response is not JSON: ${e.message}`, listText.slice(0, 400)); }

  const listOpp = (listBody.opportunities ?? []).find((o) => o.id === OPPORTUNITY_ID) ?? null;
  if (listOpp === null) fail(340, `the fixture opportunity is absent from the list endpoint`);
  const listEntry = (listOpp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  const listShape = shapeOf(listEntry);

  // ── GET 3: the schema, for dataType and the picklist options ──
  const schemaUrl = `${PROXY}?path=${encodeURIComponent("/locations/jmHG4B8RdzwpfqruNf68/customFields?model=opportunity")}`;
  const schemaRes = await fetch(schemaUrl);
  const schemaText = await schemaRes.text();
  if (!schemaRes.ok) fail(341, `GET customFields?model=opportunity → ${schemaRes.status}`, schemaText.slice(0, 400));

  let schemaBody;
  try { schemaBody = JSON.parse(schemaText); }
  catch (e) { fail(342, `schema response is not JSON: ${e.message}`, schemaText.slice(0, 400)); }

  const def = (schemaBody.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  if (!def) fail(343, `target field ${TARGET_ID} not found in the opportunity schema`);
  if (def.dataType !== "SINGLE_OPTIONS") {
    fail(344, `target dataType is ${JSON.stringify(def.dataType)}, expected SINGLE_OPTIONS`);
  }
  if (def.fieldKey !== `opportunity.${TARGET_KEY}`) {
    fail(345, `target fieldKey is ${JSON.stringify(def.fieldKey)}, expected opportunity.${TARGET_KEY}`);
  }

  /* The picklist as the schema reports it. Recorded raw, because whether
     options are strings or objects carrying ids is itself unobserved. */
  const rawOptions = def.picklistOptions ?? def.options ?? null;
  const optionStrings = Array.isArray(rawOptions)
    ? rawOptions.map((o) => (typeof o === "string" ? o : (o && (o.value ?? o.name ?? o.label)) ?? null))
    : null;

  if (optionStrings === null) {
    fail(346, `the schema carries no recognizable option list for a SINGLE_OPTIONS field`,
      JSON.stringify(def, null, 1));
  }
  const optionsMatch = JSON.stringify(optionStrings) === JSON.stringify(EXPECTED_OPTIONS);
  if (!optionsMatch) {
    fail(347, `the picklist has drifted from PB-D56 section II`,
      `expected=${JSON.stringify(EXPECTED_OPTIONS)} live=${JSON.stringify(optionStrings)}`);
  }

  // ── The current value, and whether it is one of the options ──
  const currentValue = targetEntry === null ? undefined
    : (targetEntry.fieldValue ?? targetEntry.fieldValueString ?? targetEntry.value ?? undefined);

  const fieldPresent = targetEntry !== null;
  const currentIsAnOption = optionStrings.indexOf(currentValue) !== -1;
  const tempIsAnOption = optionStrings.indexOf(TEMP_OPTION) !== -1;

  // ── Residue checks on the three previously proven or discovered fields ──
  const residue = [];
  for (const [name, id] of [...Object.entries(PROVEN_CARRIERS), ...Object.entries(PBD58_DISCOVERY)]) {
    if (byId.has(id)) residue.push({ name, id, entry: byId.get(id) });
  }

  const fixtureState = Object.entries(FIXTURE_IDS).map(([key, id]) => ({
    key, id, entry: byId.get(id) ?? null,
  }));

  const record = {
    timestamp: new Date().toISOString(),
    stage: "capture",
    cycle: "proof-a",
    proof: "PB-D59 Proof A",
    note: "PB-D59 section V. Populated origin: restoration is the original option string, NOT a clear. Does NOT authorize Approve.",
    restorationContract: "value-to-original-value",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: def.dataType,
    fieldName: def.name ?? null,
    schemaFieldKey: def.fieldKey ?? null,
    fieldPresent,
    originValue: currentValue === undefined ? null : currentValue,
    originEntry: targetEntry,
    expectedOriginOption: ORIGIN_OPTION,
    tempOption: TEMP_OPTION,
    picklistRaw: rawOptions,
    picklistStrings: optionStrings,
    picklistMatchesPBD56: optionsMatch,
    currentIsAnOption,
    tempIsAnOption,
    wireShape: {
      singularGet: singularShape,
      listEndpoint: listShape,
      keysDiffer: JSON.stringify(singularShape.keys) !== JSON.stringify(listShape.keys),
    },
    pipelineId: opp.pipelineId ?? null,
    pipelineStageId: opp.pipelineStageId ?? null,
    status: opp.status ?? null,
    monetaryValue: opp.monetaryValue ?? null,
    opportunityName: opp.name ?? null,
    customFields,
    offerIds: OFFER_IDS,
    offerEntries: OFFER_IDS.map((id) => ({ id, entry: byId.get(id) ?? null })),
    fixtureState,
    residue,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(348, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log("CAPTURE ok — READ ONLY, no writes issued.");
  console.log(`  opportunity     ${OPPORTUNITY_ID}  ${JSON.stringify(record.opportunityName)}`);
  console.log(`  target          ${TARGET_KEY}`);
  console.log(`                  ${TARGET_ID}  ${def.dataType}  ${JSON.stringify(def.name)}`);
  console.log(`  fieldPresent    ${fieldPresent}`);
  console.log(`  originValue     ${JSON.stringify(currentValue)}`);
  console.log(`  picklist        ${JSON.stringify(optionStrings)}`);
  console.log(`  matches PB-D56  ${optionsMatch}`);
  console.log(`  currentIsOption ${currentIsAnOption}`);
  console.log(`  tempIsOption    ${tempIsAnOption}   (${JSON.stringify(TEMP_OPTION)})`);
  console.log("");
  console.log("  WIRE SHAPE, observed deliberately:");
  console.log(`    singular GET  ${JSON.stringify(singularShape.entry)}`);
  console.log(`      keys        ${JSON.stringify(singularShape.keys)}`);
  console.log(`    list endpoint ${JSON.stringify(listShape.entry)}`);
  console.log(`      keys        ${JSON.stringify(listShape.keys)}`);
  console.log(`    keysDiffer    ${record.wireShape.keysDiffer}`);
  console.log("");
  console.log(`  stage           ${record.pipelineStageId}`);
  console.log(`  status          ${JSON.stringify(record.status)}`);
  console.log(`  customFields    ${customFields.length} entries`);
  console.log(`  offer_ present  ${record.offerEntries.filter((o) => o.entry !== null).length} of 7`);
  for (const f of fixtureState) console.log(`  fixture         ${f.key} = ${JSON.stringify(f.entry)}`);
  console.log(`  residue         ${residue.length === 0 ? "none — all three prior targets absent" : JSON.stringify(residue)}`);
  console.log(`  evidence        ${EVIDENCE}`);

  // ── Hard stops. Each would make step 2 a different experiment. ──
  if (residue.length > 0) {
    console.log("");
    console.error("ABORT — a previously restored field carries a value again.");
    console.error("  Something wrote since A0. The state is not controlled. Evidence is written.");
    process.exit(349);
  }
  if (!fieldPresent) {
    console.log("");
    console.error("ABORT — the target is ABSENT. PB-D59 specifies Proof A as POPULATED origin.");
    console.error("  An absent origin is a different experiment with a different restoration");
    console.error("  contract. Evidence is written. Do not run step 2.");
    process.exit(350);
  }
  if (currentValue !== ORIGIN_OPTION) {
    console.log("");
    console.error(`ABORT — the target holds ${JSON.stringify(currentValue)}, expected ${JSON.stringify(ORIGIN_OPTION)}.`);
    console.error("  Restoration is to the ORIGINAL value; proceeding would restore to a value");
    console.error("  this proof did not observe. Evidence is written. Do not run step 2.");
    process.exit(351);
  }
  if (!currentIsAnOption) {
    console.log("");
    console.error("ABORT — the stored value is not one of the schema's options.");
    console.error("  GHL may store picklists by id rather than label. Step 2's payload shape");
    console.error("  would be wrong. Evidence is written. Do not run step 2.");
    process.exit(352);
  }
  if (!tempIsAnOption) {
    console.log("");
    console.error(`ABORT — ${JSON.stringify(TEMP_OPTION)} is not one of the schema's options.`);
    console.error("  Step 2 would write a value the field does not accept. Evidence is written.");
    process.exit(353);
  }
  process.exit(0);
})().catch((e) => {
  console.error("CAPTURE THREW:", (e && e.stack) || e);
  process.exit(354);
});
