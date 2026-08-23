/* PB-D58 section I, step 1 — CAPTURE. READ ONLY.
 *
 * Discovery cycle for opportunity NUMERICAL clear semantics. This step
 * performs exactly two GETs and NO writes. It records the opportunity's
 * full pre-write state so steps 2 through 5 have something to compare
 * against and something to restore toward.
 *
 * FIELD: opportunity.closing_costs, NUMERICAL.
 * Chosen because it has no live consumer — OBSERVED 2026-08-17, every code
 * reference is inside app/.netlify/functions-serve/, the Netlify CLI's
 * build cache for two functions deleted from source 2026-08-13.
 *
 * THIS IS NOT PREREQUISITE 5. Per PB-D58, the discovery cycle establishes
 * the clear representation so the real proof on
 * endbuyer_maximum_purchase_price has a validated restore mechanism rather
 * than an assumed one. Only that later proof discharges the prerequisite.
 *
 * IDENTIFIER RESOLUTION (Gate 4C C4a, Stair 2). Nothing is hardcoded here any
 * more: the locationId resolves from the canonical config through
 * getConfig(--env), and the opportunity fixture, the contact fixture and every
 * opportunity-side pin resolve from scripts/harness-fixtures.json. The former
 * "all identifiers are hardcoded here" note described the pre-conversion file
 * and would now be false.
 */

const fs = require("fs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

/* ── Environment resolution ────────────────────────────────────────────────
   getConfig(ENV) runs BEFORE the carrier lookup, deliberately. That ordering is
   what makes an unknown --env surface [ghl-config]'s OWN message unwrapped, and
   what makes --env=test reach a VALID Test config and then refuse at the
   carrier's absent Test section rather than short-circuiting earlier.

   THE LOADER RESOLVES EXACTLY ONE LEAF HERE — the locationId. This file has NO
   Class-1 field: its target and the seven offer_ ids are all carrier
   untouchedPins, not canonical-config members. That is why the loader appears
   to pull a single value out of a whole config. It is not over-engineering and
   must not be "simplified" away — the locationId is environment-bound and the
   canonical config is its only legitimate source. */
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

const envPins           = envFixtures.untouchedPins;
const opportunityFields = envPins && envPins.opportunityFields;
if (!opportunityFields || !opportunityFields.closing_costs) {
  console.error(`REFUSED: harness-fixtures.json carries no opportunityFields.closing_costs for "${ENV}" — expected ${ENV}.untouchedPins.opportunityFields.closing_costs. Refusing rather than inventing them.`);
  process.exit(4);
}

/* Named for its carrier GROUP, not collapsed into a generic offerIds: the
   carrier deliberately distinguishes opportunityOfferFields from
   contactOfferFields, and a local name must not erase that. Object.values
   preserves the carrier's key order, which matters — record.offerIds is
   compared for content AND order by the downstream provenance check. */
const opportunityOfferFields = envPins && envPins.opportunityOfferFields
  ? Object.values(envPins.opportunityOfferFields)
  : undefined;
if (!opportunityOfferFields || opportunityOfferFields.length !== 7) {
  console.error(`REFUSED: harness-fixtures.json carries no seven-member opportunityOfferFields for "${ENV}" — expected ${ENV}.untouchedPins.opportunityOfferFields. Refusing rather than inventing them.`);
  process.exit(4);
}

const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest; // IAOS Underwriting Test
const CONTACT_ID     = fixtureContacts.iaosTestProbe;             // IAOS Test Probe
// Historical local name, kept deliberately: it resolves the canonical
// closing_costs opportunity field, whose identity now lives in the carrier.
const TARGET_ID      = opportunityFields.closing_costs;
const TARGET_KEY     = "closing_costs";

/* The seven offer_ opportunity ids — the §4.1 HARD NO set. Captured so
   offersUnchanged can be asserted later. This proof writes to none of them. */
const OFFER_IDS = opportunityOfferFields;

const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step1.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

(async () => {
  // ── GET 1: the opportunity, through the proxy ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const oppRes = await fetch(oppUrl);
  const oppText = await oppRes.text();
  if (!oppRes.ok) fail(20, `GET /opportunities/${OPPORTUNITY_ID} → ${oppRes.status}`, oppText.slice(0, 400));

  let oppBody;
  try { oppBody = JSON.parse(oppText); }
  catch (e) { fail(21, `opportunity response is not JSON: ${e.message}`, oppText.slice(0, 400)); }

  const opp = oppBody.opportunity ?? oppBody;
  if (!opp || opp.id !== OPPORTUNITY_ID) {
    fail(22, `opportunity identity mismatch: got ${JSON.stringify(opp && opp.id)}`);
  }
  if (opp.contactId !== CONTACT_ID) {
    fail(23, `contact identity mismatch: got ${JSON.stringify(opp.contactId)} expected ${CONTACT_ID}`);
  }

  const customFields = opp.customFields ?? [];

  // ── The target's origin state. Absence is the precondition steps 2-5 need. ──
  const targetEntry = customFields.find((f) => f.id === TARGET_ID) ?? null;
  const fieldPresent = targetEntry !== null;

  // ── GET 2: the opportunity custom-field schema, to confirm dataType ──
  const schemaUrl = `${PROXY}?path=${encodeURIComponent(`/locations/${LOC}/customFields?model=opportunity`)}`;
  const schemaRes = await fetch(schemaUrl);
  const schemaText = await schemaRes.text();
  if (!schemaRes.ok) fail(24, `GET customFields?model=opportunity → ${schemaRes.status}`, schemaText.slice(0, 400));

  let schemaBody;
  try { schemaBody = JSON.parse(schemaText); }
  catch (e) { fail(25, `schema response is not JSON: ${e.message}`, schemaText.slice(0, 400)); }

  const def = (schemaBody.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
  if (!def) fail(26, `target field ${TARGET_ID} not found in the opportunity schema`);
  if (def.dataType !== "NUMERICAL") {
    fail(27, `target dataType is ${JSON.stringify(def.dataType)}, expected NUMERICAL`);
  }

  const record = {
    timestamp: new Date().toISOString(),
    stage: "capture",
    cycle: "discovery",
    note: "PB-D58 section I. NOT prerequisite 5. Establishes clear semantics only.",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: def.dataType,
    fieldName: def.name ?? null,
    fieldPresent,
    originValue: targetEntry === null ? null : targetEntry,
    pipelineId: opp.pipelineId ?? null,
    pipelineStageId: opp.pipelineStageId ?? null,
    status: opp.status ?? null,
    monetaryValue: opp.monetaryValue ?? null,
    opportunityName: opp.name ?? null,
    customFields,
    offerIds: OFFER_IDS,
    offerEntries: OFFER_IDS.map((id) => ({
      id, entry: customFields.find((f) => f.id === id) ?? null,
    })),
  };

  try {
    fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8");
  } catch (e) {
    fail(28, `evidence persistence failed: ${e.message}`);
  }

  console.log("CAPTURE ok — READ ONLY, no writes issued.");
  console.log(`  opportunity   ${OPPORTUNITY_ID}  ${JSON.stringify(record.opportunityName)}`);
  console.log(`  contact       ${CONTACT_ID}`);
  console.log(`  target        ${TARGET_KEY}  ${TARGET_ID}  ${def.dataType}  ${JSON.stringify(def.name)}`);
  console.log(`  fieldPresent  ${fieldPresent}`);
  console.log(`  originValue   ${JSON.stringify(record.originValue)}`);
  console.log(`  stage         ${record.pipelineStageId}`);
  console.log(`  status        ${JSON.stringify(record.status)}`);
  console.log(`  customFields  ${customFields.length} entr${customFields.length === 1 ? "y" : "ies"}`);
  console.log(`  offer_ present ${record.offerEntries.filter((o) => o.entry !== null).length} of 7`);
  console.log(`  evidence      ${EVIDENCE}`);
  if (fieldPresent) {
    console.log("");
    console.log("  NOTE: the target is POPULATED. PB-D58's discovery cycle assumes an");
    console.log("  absent origin. Do not proceed to step 2 without deciding what that means.");
  }
  process.exit(0);
})().catch((e) => {
  console.error("CAPTURE THREW:", (e && e.stack) || e);
  process.exit(29);
});
