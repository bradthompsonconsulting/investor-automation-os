/* PB-D58 section I, step 3 — VERIFY. READ ONLY. NO WRITES.
 *
 * Observes whether step 2's PUT landed. Polls the singular opportunity GET
 * until the target reads back equal to the designated test value, then runs
 * the confirmation battery. Issues no writes of any kind.
 *
 * A 200 from step 2 is the server accepting a request. It is not evidence
 * the value landed, landed unconverted, or landed alone. This step is where
 * those become observations.
 *
 * CONFIRMATION BATTERY, PB-D58 section II adapted to the object:
 *   othersUnchanged   every non-target custom field, over the UNION of
 *                     captured and live ids, is byte-identical to capture
 *   offersUnchanged   the seven offer_ ids are still absent — they were
 *                     0 of 7 at capture, so this asserts they stayed absent
 *   stageUnchanged    pipelineStageId matches capture
 *   statusUnchanged   status matches capture
 *
 * tagsUnchanged is deliberately absent: opportunities carry no tags, so
 * asserting it would be a tautology. statusUnchanged replaces it as the
 * opportunity-side field a stray write could move.
 *
 * POLLING. Bounded at 15 attempts, 2s apart. The list/search endpoint is
 * eventually consistent and lags the singular GET, which is why this polls
 * the singular GET only. A poll that exhausts is an observation, not a
 * failure to retry harder.
 */

const fs = require("fs");

const ORIGIN = "https://app.investorautomationos.com";
const PROXY  = `${ORIGIN}/.netlify/functions/ghl-proxy`;

const OPPORTUNITY_ID = "OcGWOP9n666i4Q1MLd31";
const TARGET_ID      = "N8Aa9t1SZhU7XnPPzxWk";
const TARGET_KEY     = "closing_costs";
const TEST_VALUE     = 8271.31;

const MAX_POLLS = 15;
const POLL_MS   = 2000;

const STEP1    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step1.json";
const STEP2    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step2.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step3.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

/* Reads the target's value out of an entry, whichever key carries it, and
   REPORTS WHICH KEY DID. Coalescing is what resolver.ts deliberately
   refuses — correct there, correct to do here, because the read-back key
   for opportunity NUMERICAL is one of the unknowns this cycle exists to
   observe. Recording the value without recording its location would leave
   the primary question half-answered. */
function entryValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValueNumber", "field_value", "fieldValue", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  let cap, wrote;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(50, `cannot read step 1 evidence: ${e.message}`); }
  try { wrote = JSON.parse(fs.readFileSync(STEP2, "utf8")); }
  catch (e) { fail(51, `cannot read step 2 evidence: ${e.message}`); }

  if (cap.opportunityId !== OPPORTUNITY_ID) fail(52, `step 1 names a different opportunity`);
  if (wrote.putStatus === null) fail(53, `step 2 recorded no PUT status; it threw. Do not proceed blind.`);
  console.log(`PRECHECK ok — step 2 recorded PUT status ${wrote.putStatus}, test value ${wrote.testValue}`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let observed = undefined;
  let observedKey = null;
  let observedEntry = null;
  let matched = false;

  while (polls < MAX_POLLS) {
    polls++;
    const res = await fetch(oppUrl);
    const text = await res.text();
    if (!res.ok) fail(54, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(55, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    const read = entryValue(entry);
    observed = read.value;
    observedKey = read.key;
    observedEntry = entry;
    console.log(`  poll ${polls}/${MAX_POLLS}  observed=${JSON.stringify(observed)}  typeof=${typeof observed}  key=${JSON.stringify(observedKey)}`);

    if (observed === TEST_VALUE) { matched = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  // ── Confirmation battery, against the last polled state ──
  const liveFields = opp.customFields ?? [];
  const capFields  = cap.customFields ?? [];

  const capById  = new Map(capFields.map((f) => [f.id, f]));
  const liveById = new Map(liveFields.map((f) => [f.id, f]));
  const unionIds = [...new Set([...capById.keys(), ...liveById.keys()])].filter((id) => id !== TARGET_ID);

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

  const record = {
    timestamp: new Date().toISOString(),
    stage: "verify",
    cycle: "discovery",
    note: "PB-D58 section I. NOT prerequisite 5. READ ONLY.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    testValue: TEST_VALUE,
    polls,
    matched,
    observedValue: observed === undefined ? null : observed,
    observedType: typeof observed,
    observedKey,
    observedEntry,
    confirmations: {
      othersUnchanged,
      offersUnchanged,
      stageUnchanged,
      statusUnchanged,
    },
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(56, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`VERIFY  matched=${matched}  polls=${polls}`);
  console.log(`  observed        ${JSON.stringify(observed)}  (${typeof observed})  key=${JSON.stringify(observedKey)}`);
  console.log(`  entry           ${JSON.stringify(observedEntry)}`);
  console.log(`  expected        ${TEST_VALUE}  (number)`);
  console.log(`  othersUnchanged ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged  ${stageUnchanged}  live=${opp.pipelineStageId}`);
  console.log(`  statusUnchanged ${statusUnchanged}  live=${JSON.stringify(opp.status)}`);
  console.log(`  evidence        ${EVIDENCE}`);

  const allConfirmed = othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;
  if (!matched) {
    console.log("");
    console.log("  Poll exhausted without read-back equality. That is an observation.");
    console.log("  Do NOT re-run step 2. Decide from the evidence what happened.");
    process.exit(57);
  }
  if (!allConfirmed) {
    console.log("");
    console.log("  Read-back matched BUT a confirmation failed. The write was not inert.");
    process.exit(58);
  }
  console.log("");
  console.log("  Write landed, unconverted, and nothing else moved.");
  process.exit(0);
})().catch((e) => {
  console.error("VERIFY THREW:", (e && e.stack) || e);
  process.exit(59);
});
