/* PB-D59 Proof A, step 1 — CAPTURE. READ ONLY.
 *
 * The first SINGLE_OPTIONS write anywhere in IAOS begins after this step.
 * Nothing here mutates: two GETs, one evidence file, and a hard stop if any
 * precondition differs from what PB-D59 section V specifies.
 *
 * FIELD: opportunity.assignment_mode, SINGLE_OPTIONS. The third of PB-D59's
 * three Approve carriers and the only one still unproven. The field id is NOT
 * written here any more: it resolves from canonical config at
 * opportunityFields.assignmentMode. The raw literal that stood in this
 * sentence was an unenforced duplicate of the binding below — every
 * behavioural instrument reported the file clean while it sat in prose
 * (Gate 4C C4a, Stair 7).
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
const { stamp } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

/* ── Environment resolution (Gate 4C C4a, Stair 7) ─────────────────────────
   TIER 1 PREAMBLE, module scope. getConfig(ENV) runs BEFORE any carrier lookup,
   deliberately: that ordering is what makes an unknown --env surface
   [ghl-config]'s OWN message unwrapped, and what makes --env=test reach a VALID
   Test config and then refuse at the carrier's absent Test section.

   LOADER *AND* CARRIER. The idiom follows the IDENTIFIER'S OWNER, not the
   file's role: assignment_mode is a canonical-config member
   (opportunityFields.assignmentMode), so every file binding the target needs
   the loader. Do not generalise to other families — closing-costs' tails are
   carrier-only because THAT family's target is a carrier untouchedPin.

   ⚠ THIS FILE IS THE HEAD, AND THE FAMILY IS NOT UNIFORM. step1 is the ONLY
   member that resolves config.locationId — it needs it for the schema GET
   below, which no tail makes. The four tails load config for their own
   config-owned target and prior carriers and nothing else, and each says so in
   its own header. Do not copy this paragraph into a tail; it would be true of
   the file next door rather than of the file it sits in. */
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
const LOC = config.locationId;

const envFixtures          = fixtures[ENV];
const fixtureRecords       = envFixtures && envFixtures.fixtureRecords;
const fixtureContacts      = fixtureRecords && fixtureRecords.contacts;
const fixtureOpportunities = fixtureRecords && fixtureRecords.opportunities;
if (!fixtureOpportunities || !fixtureOpportunities.iaosUnderwritingTest ||
    !fixtureContacts || !fixtureContacts.iaosTestProbe) {
  console.error(`REFUSED: harness-fixtures.json carries no fixture records for "${ENV}" — expected ${ENV}.fixtureRecords.opportunities.iaosUnderwritingTest and ${ENV}.fixtureRecords.contacts.iaosTestProbe. Refusing rather than inventing them.`);
  process.exit(4);
}

const envPins                = envFixtures.untouchedPins;
const opportunityFields      = envPins && envPins.opportunityFields;
const opportunityOfferFields = envPins && envPins.opportunityOfferFields;
if (!opportunityFields || !opportunityFields.closing_costs) {
  console.error(`REFUSED: harness-fixtures.json carries no opportunityFields.closing_costs for "${ENV}" — expected ${ENV}.untouchedPins.opportunityFields.closing_costs. Refusing rather than inventing them.`);
  process.exit(4);
}
if (!opportunityOfferFields || Object.keys(opportunityOfferFields).length !== 7) {
  console.error(`REFUSED: harness-fixtures.json carries no seven-member opportunityOfferFields for "${ENV}" — expected ${ENV}.untouchedPins.opportunityOfferFields. Refusing rather than inventing them.`);
  process.exit(4);
}

const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest; // IAOS Underwriting Test
const CONTACT_ID     = fixtureContacts.iaosTestProbe;             // IAOS Test Probe
const TARGET_ID      = config.opportunityFields.assignmentMode;   // assignment_mode
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
  endbuyer_maximum_purchase_price: config.opportunityFields.endBuyerMaxPrice,
  mao_max_allowable_offer:         config.opportunityFields.sellerMAO,
};
/* ONE resolution site, ONE value — a single-value object literal. It is a
   resolution site and it contributes NOTHING to the occurrence-vs-site gap.
   CARRIER-owned, unlike PROVEN_CARRIERS above, which is CONFIG-owned. */
const PBD58_DISCOVERY = { closing_costs: opportunityFields.closing_costs };

/* The two deal facts the resolved-branch harness depends on. assignment_mode
   is the third but it is the target, so it is tracked separately. */
const FIXTURE_IDS = {
  arv_after_repair_value: config.opportunityFacts.arv,
  repair_estimate:        config.opportunityFacts.repairs,
};

/* Carrier key order IS the original literal order — offer_price, offer_date,
   offer_mao, offer_wholesale_fee, offer_arv, offer_repair_total, offer_margin.
   Object.values preserves it, so offerIds is written to evidence in the same
   order as before conversion. Verified at conversion; do not reorder the
   carrier group without re-checking this. */
const OFFER_IDS = Object.values(opportunityOfferFields);

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

  /* NOTE — SITE ①, cross-family read site (mao-a0 step-5 confirm evidence):
     consumes NO environment-owned value.

     It consumes exactly FIVE fields and nothing else: outcome,
     restoredToOrigin, confirmations, a0Complete and complete. Classified from
     the PRODUCER'S REACHABLE CONSTRUCTION, not from bytes on disk — in
     inert-proof-opp-mao-a0-step5.cjs, outcome is a closed three-value enum
     (CLEARED / UNCHANGED / EMPTIED), restoredToOrigin is a boolean
     conjunction, confirmations is four booleans, complete is seven booleans,
     and a0Complete is every() over those. None is derived from an identifier,
     so none can hold an environment-owned value for ANY artifact that producer
     could write.

     ⚠ NOT THE SAME SET AS THE NEIGHBOURING HEAD. mao-a0-step1's own
     cross-family read consumes SIX fields — the five above plus `mechanism`.
     Adjacent families, different consumption sets. Do not pattern-match one
     onto the other.

     The artifact itself is NOT clean. It carries opportunityId, fieldId,
     liveStageId and three ids inside liveCustomFields — six environment-owned
     values, all unread here. A NOTE classifies the READ SITE, not the artifact.

     ⚠ LOAD-BEARING, AND CONDITIONALLY SO. This is what lets Proof A bootstrap.
     The only mao-a0-step5 artifact in existence is the unstamped Aug-17 one,
     and mao-a0's tails are disarmed by an absent canonical step-1 and cannot
     regenerate it. Were this site a CHECK, assertEnvironment would take the
     no-stamp branch and refuse at 6 against the only artifact there is,
     leaving no path to stamped evidence for this family at all.

     The prohibition is conditional on the CURRENT evidence topology, not a
     standing law. Adding an environment-owned field to this consumption set
     does not merely require an assertEnvironment(...) call first — it requires
     re-deciding whether this family can bootstrap. Re-test the topology rather
     than obeying this comment if the topology changes. The same property holds
     upstream at mao-a0-step1 <- endbuyer-max-step5, and downstream at
     payload-b-step1, which reads BOTH this family's step-5 output and
     mao-a0's — two dependencies, both NOTEs, both for this reason. */

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
  /* ⚠ THE ONE R1 SITE IN THIS FAMILY — 1 occurrence at 1 resolution site.
     TIER 2 per-site lookup. Every other binding in all five files resolves at
     module scope above the async body and is therefore reachable
     unconditionally (R0 ×37). This one is not: it sits below the async
     boundary, so it is reached only after the three A0 gates, GET-1's status
     and JSON checks, both identity checks, and the list-endpoint status, JSON
     and presence checks — eleven aborts upstream of it.

     LOC is resolved in the Tier 1 preamble at module scope; only the SITE that
     consumes it lives here. The preamble is NOT hoisted into the async scope
     and must not be: doing so would put configuration resolution behind the
     guards it is meant to precede. Converted in place.

     Contrast mao-a0, whose equivalent site its run never reached because a
     live residue check aborted first. This one IS reachable on a normal run,
     so a refusal proof that stops earlier proves nothing about it either way —
     record which it is rather than inferring from exit status. */
  const schemaUrl = `${PROXY}?path=${encodeURIComponent(`/locations/${LOC}/customFields?model=opportunity`)}`;
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
    ...stamp(ENV),
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
