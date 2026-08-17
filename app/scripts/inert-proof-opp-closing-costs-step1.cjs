/* PB-D58 section I, step 1 — CAPTURE. READ ONLY.
 *
 * Discovery cycle for opportunity NUMERICAL clear semantics. This step
 * performs exactly two GETs and NO writes. It records the opportunity's
 * full pre-write state so steps 2 through 5 have something to compare
 * against and something to restore toward.
 *
 * FIELD: opportunity.closing_costs, N8Aa9t1SZhU7XnPPzxWk, NUMERICAL.
 * Chosen because it has no live consumer — OBSERVED 2026-08-17, every code
 * reference is inside app/.netlify/functions-serve/, the Netlify CLI's
 * build cache for two functions deleted from source 2026-08-13.
 *
 * THIS IS NOT PREREQUISITE 5. Per PB-D58, the discovery cycle establishes
 * the clear representation so the real proof on
 * endbuyer_maximum_purchase_price has a validated restore mechanism rather
 * than an assumed one. Only that later proof discharges the prerequisite.
 *
 * All identifiers are hardcoded here, never imported from app code — the
 * verification-only rule the contact proofs and harnesses follow.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31"; // IAOS Underwriting Test
const CONTACT_ID     = "HGZAby6snRZfpl0go2Yb"; // IAOS Test Probe
const TARGET_ID      = "N8Aa9t1SZhU7XnPPzxWk"; // opportunity.closing_costs
const TARGET_KEY     = "closing_costs";

/* The seven offer_ opportunity ids — the §4.1 HARD NO set. Captured so
   offersUnchanged can be asserted later. This proof writes to none of them. */
const OFFER_IDS = [
  "4YiACDV4uB3zOlAdNIBb", // offer_price
  "73oLHWnVjmOGSrBo5sC6", // offer_date
  "9jm2SoN2aDtUtbesL0kG", // offer_mao
  "GxChepYArmgPllhKPq0R", // offer_wholesale_fee
  "Nm1LZvQzaCGvXDq7TRCh", // offer_arv
  "XbW0B973nuaLtIjMkzO9", // offer_repair_total
  "eY5BOqE9juGpBfqwacWT", // offer_margin
];

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
  const schemaUrl = `${PROXY}?path=${encodeURIComponent("/locations/jmHG4B8RdzwpfqruNf68/customFields?model=opportunity")}`;
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
