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

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;
const LIST   = `${ORIGIN}/.netlify/functions/ghl-opportunities`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";

const ENDBUYER_ID = "zOVIPwzLe41a0SQmwVAJ";
const MAO_ID      = "Atu5XCjpFElY8H64VG4h";
const MODE_ID     = "TpLo0WRc303TXAaBUbBf";

const ENDBUYER_VALUE = 571204.86;
const MAO_VALUE      = 398715.29;
const MODE_VALUE     = "25% of Buyer Profit";

const DISCOVERY_ID = "N8Aa9t1SZhU7XnPPzxWk";

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step2.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-payload-b-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
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
