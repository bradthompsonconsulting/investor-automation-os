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
 * FIELD: opportunity.mao_max_allowable_offer, NUMERICAL. Seller MAO's
 * carrier. Pre-existing and reused, not created for underwriting. The field
 * id is NOT written here any more: it resolves from canonical config at
 * opportunityFields.sellerMAO. The raw literal that stood in this sentence
 * was an unenforced duplicate of the binding below — every behavioural
 * instrument reported the file clean while it sat in prose (Gate 4C C4a,
 * Stair 6).
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
const { stamp } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

/* ── Environment resolution (Gate 4C C4a, Stair 6) ─────────────────────────
   getConfig(ENV) runs BEFORE any carrier lookup, deliberately. That ordering is
   what makes an unknown --env surface [ghl-config]'s OWN message unwrapped, and
   what makes --env=test reach a VALID Test config and then refuse at the
   carrier's absent Test section rather than short-circuiting earlier.

   LOADER *AND* CARRIER, in this file and in all four tails. The idiom follows
   the IDENTIFIER'S OWNER, not the file's role: mao_max_allowable_offer is a
   canonical-config member (opportunityFields.sellerMAO), so every file binding
   the target needs the loader — head and tails alike. Do not generalise this to
   the remaining families; closing-costs' tails are carrier-only because THAT
   family's target happens to be a carrier untouchedPin. Measured per family.

   WHY THE LOADER IS NEEDED *HERE* SPECIFICALLY: this file is the only member
   that resolves config.locationId, for the schema GET below. The tails need the
   loader for the target alone and their comments say so — do not copy this
   paragraph into them, it would be true of the file next door. */
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
const TARGET_ID      = config.opportunityFields.sellerMAO;        // mao_max_allowable_offer
const TARGET_KEY     = "mao_max_allowable_offer";

/* The two carriers proven or pending elsewhere. Captured by name so drift in
   either is legible rather than anonymous inside othersUnchanged. Both are
   canonical-config members, hence config per the owner rule above. */
const OTHER_CARRIERS = {
  endbuyer_maximum_purchase_price: config.opportunityFields.endBuyerMaxPrice, // PB-D58 proven
  assignment_mode:                 config.opportunityFields.assignmentMode,   // Proof A pending
};

/* The three deal-fact inputs the resolved-branch production harness depends
   on. assignment_mode is in both maps deliberately: it is a carrier AND a
   harness input. All three are canonical-config members, not carrier pins. */
const FIXTURE_IDS = {
  arv_after_repair_value: config.opportunityFacts.arv,
  repair_estimate:        config.opportunityFacts.repairs,
  assignment_mode:        config.opportunityFields.assignmentMode,
};

/* Carrier key order IS the original literal order — offer_price, offer_date,
   offer_mao, offer_wholesale_fee, offer_arv, offer_repair_total, offer_margin.
   Object.values preserves it, so offerIds is written to evidence in the same
   order as before conversion. Verified at conversion; do not reorder the
   carrier group without re-checking this. */
const OFFER_IDS = Object.values(opportunityOfferFields);

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

  /* NOTE — cross-family read site (endbuyer-max step-5 confirm evidence):
     consumes NO environment-owned value.

     It consumes exactly six fields and nothing else: outcome, restoredToOrigin,
     confirmations, dischargeable, discharge and mechanism. Classified from the
     PRODUCER'S REACHABLE CONSTRUCTION, not from the bytes currently on disk:
     outcome is a closed three-value enum (CLEARED / UNCHANGED / EMPTIED),
     restoredToOrigin is a boolean conjunction, confirmations is four booleans,
     discharge is seven booleans, dischargeable is every() over those, and
     mechanism is a static CLEAR_LABEL literal. None is derived from an
     identifier, so none can hold an environment-owned value for ANY artifact
     that producer could write — not merely for the one on disk today.

     The artifact itself is NOT clean. It carries opportunityId, fieldId,
     liveStageId and three ids inside liveCustomFields — six environment-owned
     values, all unread here. A NOTE classifies the READ SITE, not the artifact.

     ⚠ THIS NOTE IS LOAD-BEARING, AND CONDITIONALLY SO. It is what lets this
     family bootstrap. The only endbuyer-max-step5 artifact in existence is the
     unstamped Aug-17 one, and endbuyer-max's tails are disarmed by an absent
     canonical step-1 and cannot regenerate it. Were this site a CHECK,
     assertEnvironment would take the no-stamp branch and refuse at 6 against
     the only artifact there is, leaving no path to stamped evidence for A0 at
     all. Because it is a NOTE, step 1 still runs and produces a STAMPED output
     of its own.

     The prohibition is conditional on the CURRENT evidence topology, not a
     standing law. Adding an environment-owned field to this consumption set
     does not merely require an assertEnvironment(...) call first — it requires
     re-deciding whether this family can bootstrap at all. Re-test the topology
     rather than obeying this comment if the topology changes. The same property
     held one family earlier at endbuyer-max-step1 <- closing-costs-step5, and
     holds one family later at mode-a-step1 and payload-b-step1, both of which
     read THIS family's step-5 output through NOTEs for the same reason. */

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
  /* ⚠ R1 OCCURRENCES 1 AND 2 of 3 — ONE resolution site carrying TWO values.
     Occurrence and resolution-site are different denominators and this block is
     where they diverge; do not collapse them. Converted IN PLACE, not hoisted. Every binding in
     the four tails, and six of this file's eight, resolves at module scope and
     is therefore reachable unconditionally (R0). This one is not: it sits after
     the first GET, so it is reached only when the three PB-D58 gates pass AND
     that GET returns 200 AND both identity checks pass. Hoisting it would move
     a lookup above the guards that currently precede it, and the R0 property of
     the other bindings depends on them staying where they are. Recorded because
     a refusal proof that never reaches this line proves nothing about it.
     NOTE the mixed ownership: endBuyerMaxPrice is CONFIG-owned, closing_costs is
     CARRIER-owned. One site, two owners. */
  const residue = [];
  for (const [name, id] of [
    ["endbuyer_maximum_purchase_price", config.opportunityFields.endBuyerMaxPrice],
    ["closing_costs", opportunityFields.closing_costs],
  ]) {
    if (byId.has(id)) residue.push({ name, id, entry: byId.get(id) });
  }
  if (residue.length > 0) {
    fail(218, `a PB-D58 proof target carries a value again`, JSON.stringify(residue, null, 1));
  }
  console.log("PRECHECK residue ok — both PB-D58 targets absent live, not merely per their evidence");

  // ── GET 2: the schema, to confirm dataType and fieldKey from source ──
  /* ⚠ R1 OCCURRENCE 3 of 3 (resolution site 2 of 2) — the location, inlined in
     this template and converted IN PLACE. LOC is resolved at module scope, but the SITE that consumes it is
     here, below the async boundary and below the residue gate. Left in place:
     rewriting this as a module-scope const would relocate a line the residue
     check currently precedes, for cosmetic uniformity only. */
  const schemaUrl = `${PROXY}?path=${encodeURIComponent(`/locations/${LOC}/customFields?model=opportunity`)}`;
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
    ...stamp(ENV),
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
