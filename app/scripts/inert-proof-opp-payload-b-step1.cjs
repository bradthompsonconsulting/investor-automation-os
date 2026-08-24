/* PB-D59 Proof B, step 1 — CAPTURE. READ ONLY.
 *
 * The last gate before Approve may be rendered. Proof B proves the write
 * Approve actually performs: one custom-fields-only PUT carrying all three
 * carriers together.
 *
 * WHY COMPOSITION NEEDS ITS OWN PROOF. Three fields that write correctly
 * one at a time do not prove a three-field payload behaves as Approve
 * needs. PB-D59 section V: Proof B proves the write Approve performs, not
 * three writes it never will. A0 and Proof A removed the per-field
 * unknowns so a Proof B failure points at composition and nothing else.
 *
 * MIXED ORIGIN, AND MIXED RESTORATION. This is the first cycle where the
 * carriers do not share an origin state:
 *
 *     endbuyer_maximum_purchase_price   ABSENT     -> restore to KEY_ABSENT
 *     mao_max_allowable_offer           ABSENT     -> restore to KEY_ABSENT
 *     assignment_mode                   POPULATED  -> restore to the label
 *
 * Both restoration contracts run in the same cycle. PB-D58's clear
 * mechanism handles the two NUMERICAL carriers; Proof A's restore-to-value
 * handles the picklist. Each is OBSERVED, neither is assumed.
 *
 * READBACK USES ONE PARSER. PB-D59 section III as amended 2026-08-17: the
 * singular GET carries every dataType under `fieldValue` while the list
 * endpoint varies by dataType. One parser reading `fieldValue` serves all
 * three carriers.
 *
 * This step mutates nothing. Three GETs, one evidence file, and a hard stop
 * if the origin state differs from what PB-D59 and the prior proofs
 * established.
 */

const fs = require("fs");
const { stamp } = require("./evidence-provenance.cjs");
const ghlConfig = require("./ghl-config-loader.cjs");
const fixtures  = require("../../scripts/harness-fixtures.json");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

/* ── Environment resolution (Gate 4C C4a, Stair 8) ─────────────────────────
   TIER 1 PREAMBLE, module scope. getConfig(ENV) runs BEFORE any carrier
   lookup, deliberately: that ordering is what makes an unknown --env surface
   [ghl-config]'s OWN message unwrapped, and what makes --env=test reach a
   VALID Test config and then refuse at the carrier's absent Test section.

   LOADER *AND* CARRIER. The idiom follows the IDENTIFIER'S OWNER, not the
   file's role.

   ⚠ THREE CARRIERS, NO SINGLE TARGET. This family proves a three-field
   payload in one request. There is no "the target" here and no fieldId
   anywhere in the family — do not write or read any comment in these five
   files as though there were one. All THREE proof carriers are CONFIG-owned:
       endbuyer_maximum_purchase_price -> opportunityFields.endBuyerMaxPrice
       mao_max_allowable_offer         -> opportunityFields.sellerMAO
       assignment_mode                 -> opportunityFields.assignmentMode
   Each is bound below in CARRIERS; the four tails bind the same three as
   separate consts. That is why every file needs the loader.

   ⚠ THIS FILE IS THE HEAD, AND THE FAMILY IS NOT UNIFORM. step1 is the ONLY
   member that resolves config.locationId — it needs it for the schema GET
   below, which no tail makes. The four tails load config for their own
   config-owned carriers and nothing else, and each says so in its own header.
   Do not copy this paragraph into a tail; it would be true of the file next
   door rather than of the file it sits in. */
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

const OPPORTUNITY_ID = fixtureOpportunities.iaosUnderwritingTest;
const CONTACT_ID     = fixtureContacts.iaosTestProbe;

/* The three Approve carriers, PB-D59 section I, with their expected origin
   state and restoration contract. */
const CARRIERS = [
  {
    key: "endbuyer_maximum_purchase_price",
    id: config.opportunityFields.endBuyerMaxPrice,
    dataType: "NUMERICAL",
    expectPresent: false,
    restore: "clear-to-absent",
    provenBy: "PB-D58 section II",
  },
  {
    key: "mao_max_allowable_offer",
    id: config.opportunityFields.sellerMAO,
    dataType: "NUMERICAL",
    expectPresent: false,
    restore: "clear-to-absent",
    provenBy: "PB-D59 Proof A0",
  },
  {
    key: "assignment_mode",
    id: config.opportunityFields.assignmentMode,
    dataType: "SINGLE_OPTIONS",
    expectPresent: true,
    expectValue: "Standard Minimum",
    restore: "value-to-original-value",
    provenBy: "PB-D59 Proof A",
  },
];

/* PB-D58's discovery field. Not a carrier; must still be absent.
   CARRIER-owned, unlike the three proof carriers above, which are all
   CONFIG-owned. Single-value binding: one resolution site, one occurrence. */
const DISCOVERY_ID = opportunityFields.closing_costs;

/* Deal facts the resolved-branch harness depends on. assignment_mode is the
   third but it is a carrier, tracked above. */
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

const PROOF_A_CONFIRM = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mode-a-step5.json";
const A0_CONFIRM      = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-mao-a0-step5.json";
const EVIDENCE        = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step1.json";

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function shapeOf(entry) {
  if (entry === null || entry === undefined) return { present: false, keys: [], entry: null };
  return { present: true, keys: Object.keys(entry).sort(), entry };
}

/* PB-D59 section III as amended: ONE parser, `fieldValue`, all dataTypes.
   The fallbacks exist only so a shape change is visible rather than silent;
   the singular GET has carried `fieldValue` on every observation. */
function readValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValue", "fieldValueNumber", "fieldValueString", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  // ── Preconditions: both prior proofs completed and restored ──
  let a0, pa;
  try { a0 = JSON.parse(fs.readFileSync(A0_CONFIRM, "utf8")); }
  catch (e) { fail(460, `cannot read A0 confirm evidence: ${e.message}`); }
  try { pa = JSON.parse(fs.readFileSync(PROOF_A_CONFIRM, "utf8")); }
  catch (e) { fail(461, `cannot read Proof A confirm evidence: ${e.message}`); }

  /* NOTE — SITES ① AND ②, the two cross-family read sites. Neither consumes
     an environment-owned value. This head is the only one in the campaign with
     TWO upstream dependencies, so there are two notes' worth of reasoning here
     and both must hold for the family to bootstrap.

     SITE ① — mao-a0 step-5 confirm evidence (read above, L187).
       Consumes exactly THREE fields: a0Complete, complete, restoredToOrigin.
       Producer-reachable (inert-proof-opp-mao-a0-step5.cjs): a0Complete is
       every() over complete (that file L262); complete is seven booleans
       (that file L251); restoredToOrigin is a boolean conjunction
       (that file L245). CROSS-FILE citations — they name lines in mao-a0-step5,
       NOT in this file.
       Artifact carries 6 distinct environment-owned values UNREAD —
       opportunityId, fieldId, liveStageId, and three inside liveCustomFields.

     SITE ② — mode-a step-5 confirm evidence (read here, L189).
       Consumes exactly THREE fields: proofAComplete, complete,
       restoredToOrigin. Producer-reachable
       (inert-proof-opp-mode-a-step5.cjs): proofAComplete is every() over
       complete (that file L306); complete is NINE booleans (that file L293);
       restoredToOrigin is a boolean conjunction (that file L290). CROSS-FILE
       citations — they name lines in mode-a-step5, NOT in this file.
       Artifact carries 5 distinct environment-owned values UNREAD across 14
       occurrences — opportunityId, fieldId, and the ENTRY-OBJECT carriers
       observedEntry, capturedEntry and wireShape, plus liveStageId and three
       inside liveCustomFields.

     ⚠ NOT THE SAME SET AS ANY NEIGHBOURING HEAD. Consumption sets narrow
     along the chain: endbuyer-max-s5 -> mao-a0-s1 took SIX fields;
     mao-a0-s5 -> mode-a-s1 took FIVE; both of this head's reads take THREE.
     Neither reads `outcome`, which mode-a's head did read. Do not
     pattern-match one head onto another.

     ⚠ BOTH NOTES ARE LOAD-BEARING, AND CONDITIONALLY SO. Each source artifact
     is the unstamped Aug-17 original, and BOTH producing families rest
     disarmed behind an absent canonical step-1 and cannot regenerate them.
     Were either site a CHECK, assertEnvironment would take the no-stamp branch
     and refuse against an artifact that no longer has a producer — so a single
     CHECK at either site ends this family's ability to bootstrap. Two
     dependencies means two ways to lose it.

     The prohibition is conditional on the CURRENT evidence topology, not a
     standing law. Adding an environment-owned field to either consumption set
     does not merely require an assertEnvironment(...) call first — it requires
     re-deciding whether this family can bootstrap at all.

     ⚠ THE FAMILY-WIDE PROTECTION RATIO IS 7 COMPARED : 41 ADOPTED BY VALUE,
     7 : 15 BY FIELD — the weakest in the campaign, and the reason is
     structural rather than an oversight. With no fieldId, each CHECK site can
     compare opportunityId and nothing else; the two preceding families
     compared two values per artifact and reached 12 COMPARED. Do not "fix"
     this by inventing a comparison. The per-site breakdown is recorded at the
     CHECK sites in steps 2, 3, 4 and 5.

     ⚠ NOTHING READS THIS FAMILY'S OUTPUT. payload-b is terminal: measured,
     zero forward consumers of payload-b-step5. So the bootstrap constraint
     runs inbound only, and no downstream family inherits it from here. */

  if (a0.a0Complete !== true) fail(462, `A0 was not complete`, JSON.stringify(a0.complete));
  if (a0.restoredToOrigin !== true) fail(463, `A0 did not restore to origin`);
  if (pa.proofAComplete !== true) fail(464, `Proof A was not complete`, JSON.stringify(pa.complete));
  if (pa.restoredToOrigin !== true) fail(465, `Proof A did not restore to origin`);
  console.log("PRECHECK priors ok — A0 and Proof A both complete and restored");
  console.log("  clear-to-absent      OBSERVED PB-D58, reproduced A0");
  console.log("  restore-to-value     OBSERVED Proof A");

  // ── GET 1: the singular opportunity ──
  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;
  const oppRes = await fetch(oppUrl);
  const oppText = await oppRes.text();
  if (!oppRes.ok) fail(466, `GET /opportunities/${OPPORTUNITY_ID} → ${oppRes.status}`, oppText.slice(0, 400));

  let oppBody;
  try { oppBody = JSON.parse(oppText); }
  catch (e) { fail(467, `opportunity response is not JSON: ${e.message}`, oppText.slice(0, 400)); }

  const opp = oppBody.opportunity ?? oppBody;
  if (opp.id !== OPPORTUNITY_ID) fail(468, `opportunity identity mismatch: ${JSON.stringify(opp.id)}`);
  if (opp.contactId !== CONTACT_ID) fail(469, `contact identity mismatch: ${JSON.stringify(opp.contactId)}`);

  const customFields = opp.customFields ?? [];
  const byId = new Map(customFields.map((f) => [f.id, f]));

  // ── GET 2: the schema, for dataType and picklist confirmation ──
  /* ⚠ THE ONE NON-MODULE-SCOPE SITE IN THIS FAMILY — TWO COLUMNS, NOT ONE.
     Before conversion the location literal was inlined here, so BOTH its
     resolution scope and its consumption scope were inside the async body.
     Installing the Tier-1 preamble moves the RESOLUTION to module scope
     (const LOC above); what remains here is the CONSUMPTION site.

     Resolution scope: MODULE.  Consumption scope: IIFE (opens L184).

     That split is the point. Every other site in all five files is
     module/module. This is the only module/IIFE pair, and it is reached only
     after the two cross-family gates, both GET-1 checks and both identity
     checks. The preamble is NOT hoisted into the async scope and must not be:
     doing so would put configuration resolution behind the guards it is meant
     to precede. */
  const schemaUrl = `${PROXY}?path=${encodeURIComponent(`/locations/${LOC}/customFields?model=opportunity`)}`;
  const schemaRes = await fetch(schemaUrl);
  const schemaText = await schemaRes.text();
  if (!schemaRes.ok) fail(470, `GET customFields?model=opportunity → ${schemaRes.status}`, schemaText.slice(0, 400));

  let schemaBody;
  try { schemaBody = JSON.parse(schemaText); }
  catch (e) { fail(471, `schema response is not JSON: ${e.message}`, schemaText.slice(0, 400)); }
  const schemaById = new Map((schemaBody.customFields ?? []).map((f) => [f.id, f]));

  // ── GET 3: the list endpoint, for the wire-shape record ──
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

  // ── Per-carrier origin state ──
  const carrierState = [];
  const problems = [];

  for (const c of CARRIERS) {
    const def = schemaById.get(c.id) ?? null;
    const entry = byId.get(c.id) ?? null;
    const read = readValue(entry);
    const present = entry !== null;

    if (!def) problems.push(`${c.key}: not present in the opportunity schema`);
    else if (def.dataType !== c.dataType) {
      problems.push(`${c.key}: schema dataType ${JSON.stringify(def.dataType)}, expected ${c.dataType}`);
    }
    if (present !== c.expectPresent) {
      problems.push(`${c.key}: present=${present}, expected ${c.expectPresent}`);
    }
    if (c.expectValue !== undefined && read.value !== c.expectValue) {
      problems.push(`${c.key}: value ${JSON.stringify(read.value)}, expected ${JSON.stringify(c.expectValue)}`);
    }

    carrierState.push({
      key: c.key,
      id: c.id,
      dataType: c.dataType,
      schemaDataType: def ? def.dataType : null,
      fieldName: def ? (def.name ?? null) : null,
      restoreContract: c.restore,
      provenBy: c.provenBy,
      present,
      originValue: read.value === undefined ? null : read.value,
      originValueKey: read.key,
      originEntry: entry,
      singularShape: shapeOf(entry),
      listShape: shapeOf(listById.get(c.id) ?? null),
    });
  }

  const discoveryPresent = byId.has(DISCOVERY_ID);
  if (discoveryPresent) problems.push(`closing_costs carries a value again: ${JSON.stringify(byId.get(DISCOVERY_ID))}`);

  const fixtureState = Object.entries(FIXTURE_IDS).map(([key, id]) => ({
    key, id, entry: byId.get(id) ?? null,
  }));
  for (const f of fixtureState) {
    if (f.entry === null) problems.push(`deal fact ${f.key} is absent; the harness fixture is incomplete`);
  }

  const offerPresent = OFFER_IDS.filter((id) => byId.has(id));
  if (offerPresent.length > 0) problems.push(`offer_ fields present: ${JSON.stringify(offerPresent)}`);

  const record = {
    ...stamp(ENV),
    timestamp: new Date().toISOString(),
    stage: "capture",
    cycle: "proof-b",
    proof: "PB-D59 Proof B",
    note: "The combined three-field Approve payload. Mixed origin, mixed restoration. This is the last gate before Approve may be rendered.",
    opportunityId: OPPORTUNITY_ID,
    contactId: CONTACT_ID,
    carriers: carrierState,
    mixedOrigin: {
      absentCount: carrierState.filter((c) => !c.present).length,
      populatedCount: carrierState.filter((c) => c.present).length,
    },
    discoveryFieldPresent: discoveryPresent,
    pipelineId: opp.pipelineId ?? null,
    pipelineStageId: opp.pipelineStageId ?? null,
    status: opp.status ?? null,
    monetaryValue: opp.monetaryValue ?? null,
    opportunityName: opp.name ?? null,
    customFields,
    offerIds: OFFER_IDS,
    offerEntries: OFFER_IDS.map((id) => ({ id, entry: byId.get(id) ?? null })),
    fixtureState,
    problems,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(472, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log("CAPTURE ok — READ ONLY, no writes issued.");
  console.log(`  opportunity     ${OPPORTUNITY_ID}  ${JSON.stringify(record.opportunityName)}`);
  console.log(`  stage           ${record.pipelineStageId}`);
  console.log(`  status          ${JSON.stringify(record.status)}`);
  console.log(`  customFields    ${customFields.length} entries`);
  console.log(`  offer_ present  ${offerPresent.length} of 7`);
  console.log(`  closing_costs   ${discoveryPresent ? "PRESENT — unexpected" : "absent"}`);
  console.log("");
  console.log("  CARRIER ORIGIN STATE:");
  for (const c of carrierState) {
    console.log(`    ${c.key}`);
    console.log(`      dataType    ${c.dataType}  (schema: ${c.schemaDataType})`);
    console.log(`      present     ${c.present}`);
    console.log(`      value       ${JSON.stringify(c.originValue)}${c.originValueKey ? `  key=${JSON.stringify(c.originValueKey)}` : ""}`);
    console.log(`      restore     ${c.restoreContract}   (proven by ${c.provenBy})`);
    console.log(`      singular    ${JSON.stringify(c.singularShape.keys)}`);
    console.log(`      list        ${JSON.stringify(c.listShape.keys)}`);
  }
  console.log("");
  console.log(`  mixed origin    ${record.mixedOrigin.absentCount} absent, ${record.mixedOrigin.populatedCount} populated`);
  for (const f of fixtureState) console.log(`  deal fact       ${f.key} = ${JSON.stringify(f.entry)}`);
  console.log(`  evidence        ${EVIDENCE}`);

  if (problems.length > 0) {
    console.log("");
    console.error(`ABORT — ${problems.length} precondition problem(s). Evidence is written.`);
    for (const p of problems) console.error(`  ${p}`);
    console.error("  Do not run step 2. The origin state is not what PB-D59 and the prior");
    console.error("  proofs established, so step 2 would be a different experiment.");
    process.exit(473);
  }
  process.exit(0);
})().catch((e) => {
  console.error("CAPTURE THREW:", (e && e.stack) || e);
  process.exit(474);
});
