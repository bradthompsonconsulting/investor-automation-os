/* PB-D60 -- opportunity.asking_price inert proof, step 1 CAPTURE. READ ONLY.
 *
 * Records the opportunity's full customFields array, the target's ABSENCE,
 * the pipeline stage and status, and the seven offer_ ids. No write.
 * PB-D60 designates the field and its test value; PB-D58 section I supplies
 * the five-step shape.
 *
 * ⚠ WIRE SHAPE CONSUMED: the SINGULAR GET /opportunities/{id}. PB-D58 section
 * VI OBSERVED that the singular GET returns a NUMERICAL value under
 * `fieldValue` with NO `type` key, while the list endpoint returns the same
 * field under `fieldValueNumber` WITH a `type`. Absence is decided
 * STRUCTURALLY -- whether the id appears in customFields -- never by whether a
 * parser returned undefined.
 *
 * ⚠ DERIVED FROM THE endbuyer-max SUITE BY SUBSTITUTION OF IDENTIFIERS ONLY.
 * The executable logic below is PB-D58's and is deliberately not reinvented.
 * The ORIGINAL HEADER PROSE WAS NOT INHERITED: substitution had silently
 * corrupted several of its claims -- it still said this suite discharges
 * PB-D56 prerequisite 5 (PB-D58 already did, on a different field), and it
 * carried the other field's test-value reasoning with this value swapped in.
 * Rather than patch prose that could not be fully audited, the header is
 * written for this field. This is the same defect class that cost three
 * tranches when inert-proof-runner.cjs's own header misdescribed its restore
 * stage.
 *
 * ⚠ THIS SUITE PROVES FIELD SAFETY FOR ONE FIELD AND NOTHING ELSE, and does
 * NOT discharge PB-D56 prerequisite 5 -- PB-D58 section VI already discharged
 * that on endbuyer_maximum_purchase_price. PB-D58 section IV: "two proven
 * opportunity fields would not prove a third... dataType proves
 * serialization, not field safety." Serialization is already OBSERVED
 * (PB-D58 section VI) and is NOT re-litigated; no third discovery cycle runs.
 *
 * ⚠ UNLIKE PB-D58's DISCOVERY FIELD, THIS ONE HAS LIVE CONSUMERS, recorded by
 * PB-D60 from current source: ContactWorkspace.tsx:71 (the call rail's Seller
 * Ask cell) and UnderwritingWorkspace.tsx:53. resolver.ts gives the
 * Opportunity value precedence over the Contact value, so during the proof
 * window the designated value is OPERATOR-VISIBLE and COMPUTATIONALLY ACTIVE.
 * PB-D60's containment conditions are part of the designation, not execution
 * detail: the fixture is not a real deal while the value is present;
 * write -> verify -> clear -> confirm is ONE bounded operation; restoration to
 * KEY_ABSENT is required before the proof is complete; no UI observation is
 * wanted; and an abort after the write and before confirmed restoration is an
 * immediate STOP and restoration-required condition, not an ordinary failure.
 */

const fs = require("fs");
const { stamp } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

/* ── Environment resolution (Gate 4C C4a, Stair 5) ─────────────────────────
   getConfig(ENV) runs BEFORE the carrier lookup, deliberately. That ordering is
   what makes an unknown --env surface [ghl-config]'s OWN message unwrapped, and
   what makes --env=test reach a VALID Test config and then refuse at the
   carrier's absent Test section rather than short-circuiting earlier.

   THIS FAMILY IS LOADER *AND* CARRIER IN ALL FIVE MEMBERS, and the reason is
   worth stating because the closing-costs family is not. The idiom follows the
   IDENTIFIER'S OWNER, not the file's role. asking_price is a
   canonical-config member (opportunityFields.askingPrice), so every file
   touching it needs the loader — heads and tails alike. closing_costs, by
   contrast, is a carrier untouchedPin, which is the only reason that family's
   tails could be carrier-only. "Tails are carrier-only" was never a rule; it
   was a fact about where one field happens to live. Do not generalise either
   shape to the remaining families. */
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

const envPins               = envFixtures.untouchedPins;
const opportunityFields     = envPins && envPins.opportunityFields;
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
const TARGET_ID      = config.opportunityFacts.askingPrice; // asking_price
const TARGET_KEY     = "asking_price";

/* Carrier key order IS the original literal order — offer_price, offer_date,
   offer_mao, offer_wholesale_fee, offer_arv, offer_repair_total, offer_margin.
   Object.values preserves it, so offerIds is written to evidence in the same
   order as before conversion. Verified at conversion; do not reorder the
   carrier group without re-checking this. */
const OFFER_IDS = Object.values(opportunityOfferFields);

/* The three fixture fields the resolved-branch harness depends on. Captured
   explicitly so drift in any of them is visible by name rather than only as
   an othersUnchanged failure. All three are canonical-config members, not
   carrier pins — hence config, per the owner rule above. */
const FIXTURE_IDS = {
  arv_after_repair_value: config.opportunityFacts.arv,
  repair_estimate:        config.opportunityFacts.repairs,
  assignment_mode:        config.opportunityFields.assignmentMode,
};

/* Section I's confirm evidence. Read as a precondition: this cycle depends
   on that cycle having established the clear mechanism AND restored. */
const DISCOVERY_CONFIRM = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step5.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-asking-price-step1.json";

function fail(code, msg, extra) {
  console.error(`ABORT [refusal ${code}] — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  // ── Precondition: section I established the clear mechanism ──
  let disc;
  try { disc = JSON.parse(fs.readFileSync(DISCOVERY_CONFIRM, "utf8")); }
  catch (e) { fail(90, `cannot read the discovery cycle's confirm evidence: ${e.message}`); }

  /* NOTE — cross-family read site (closing-costs step-5 confirm evidence):
     consumes NO environment-owned value.

     It consumes exactly six fields and nothing else: outcome, restoredToOrigin,
     confirmations, dataType, candidateLabel and timestamp. An outcome enum, two
     booleans and four more inside confirmations, a schema dataType string, a
     mechanism label and an ISO timestamp. None is derived from an identifier, so
     none can hold an environment-owned value for ANY artifact that producer
     could write — not merely for the one currently on disk.

     The artifact itself is NOT clean. It carries opportunityId, fieldId,
     liveStageId, liveCustomFields and observedEntry — five environment-owned
     fields, unread here.

     ⚠ THIS NOTE IS LOAD-BEARING. Under the CURRENT evidence topology, making
     this site a CHECK would break bootstrap, because the only available
     closing-costs step-5 artifact is intentionally unstamped. Any future
     environment-owned consumption at this site requires re-evaluating the
     bootstrap path before adding an assertion — the prohibition is conditional
     on that topology, not a standing law, and it should be re-tested rather
     than obeyed if the topology changes.

     This is the only read of an artifact produced by a different family, and
     that family's tails are disarmed by an absent canonical step-1 and cannot
     regenerate it. The artifact this site reads will therefore stay unstamped.
     Because this site is a NOTE, step 1 still runs and can produce a STAMPED
     output of its own. Add an environment-owned field to this destructure and
     this site must become a CHECK — which would refuse at 6 against the only
     artifact that exists, leaving no path to stamped evidence for this family
     at all. The same property holds one family later, at
     mao-a0-step1 <- asking-price-step5. Adding a field here does not merely
     require an assertEnvironment(...) call first; it requires re-deciding
     whether this family can bootstrap. */

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
  /* ⚠ THE ONE NON-R0 RESOLUTION SITE IN THIS FAMILY. Every other identifier in
     all five files resolves at module scope, above the async body, so it is
     reachable unconditionally. This one is not: it sits after the first GET, so
     it is reached only when the discovery-cycle file gates pass AND that GET
     returns 200 AND both identity checks pass. Left in place deliberately —
     hoisting it would move a lookup above the guards that currently precede it.
     Recorded because a refusal proof that never reaches this line proves nothing
     about it. */
  const DISCOVERY_TARGET = opportunityFields.closing_costs;
  const discoveryResidue = customFields.find((f) => f.id === DISCOVERY_TARGET) ?? null;
  if (discoveryResidue !== null) {
    fail(98, `the discovery cycle's field still carries a value`, JSON.stringify(discoveryResidue));
  }
  console.log("PRECHECK residue ok — the discovery field is absent live, not merely per its evidence");

  // ── GET 2: the schema, to confirm dataType from source ──
  const schemaUrl = `${PROXY}?path=${encodeURIComponent(`/locations/${LOC}/customFields?model=opportunity`)}`;
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
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "capture",
    cycle: "proof",
    note: "PB-D60 field-safety proof for opportunity.asking_price. This cycle does NOT discharge PB-D56 prerequisite 5 -- PB-D58 section VI already discharged that on endbuyer_maximum_purchase_price. It earns safety for this field alone.",
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
     acceptable there. This cycle earns FIELD SAFETY for
     opportunity.asking_price, and an absent origin is the only origin the
     contract covers -- PB-D30 holds populated-origin behind a separate
     specification. Measured 2026-08-29: the target is absent on all 43
     Production opportunities.
     A populated origin means the cycle's own contract does not hold, and
     exiting 0 would invite step 2 to run the wrong experiment. Evidence is
     written either way, so the state is recorded before the abort. */
  if (fieldPresent) {
    console.log("");
    console.error("ABORT — the target is POPULATED. The absent-origin contract requires an absent origin.");
    console.error("  Evidence is written. Do not run step 2. This is a different experiment");
    console.error("  than the absent-origin contract requires, and PB-D30 holds the populated-origin");
    console.error("  mechanism behind a separate specification.");
    process.exit(106);
  }
  process.exit(0);
})().catch((e) => {
  console.error("CAPTURE THREW:", (e && e.stack) || e);
  process.exit(105);
});
