/* PB-D58 section I, step 5 — CONFIRM. READ ONLY. NO WRITES.
 *
 * The observation the discovery cycle exists to produce: did
 * `field_value: ""` return an opportunity NUMERICAL field to ABSENT?
 *
 * Absent means the id does not appear in the customFields array at all.
 * Three outcomes are distinguished, and conflating them would be the whole
 * failure this step guards against:
 *
 *   CLEARED    the id is gone from customFields. Opportunity NUMERICAL
 *              clear semantics become OBSERVED. The proof cycle on
 *              endbuyer_maximum_purchase_price may proceed.
 *   EMPTIED    the id is still present carrying "" or 0 or null. That is
 *              NOT absent. PB-D24 distinguishes KEY_ABSENT from an empty
 *              value present, and only the former is a clear. Candidate 1
 *              has failed; candidate 2 runs steps 4 and 5 only.
 *   UNCHANGED  the id still carries 8271.31. The PUT was accepted and had
 *              no effect. Candidate 1 has failed.
 *
 * A poll that exhausts without reaching absence is an observation, not a
 * reason to poll harder or to re-issue step 4.
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
const STEP4    = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step4.json";
const EVIDENCE = "C:/Users/brad/AppData/Local/Temp/inert-proof-opp-closing-costs-step5.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, msg, extra) {
  console.error(`ABORT — ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(code);
}

function entryValue(entry) {
  if (entry === null || entry === undefined) return { value: undefined, key: null };
  for (const k of ["fieldValue", "fieldValueNumber", "field_value", "value"]) {
    if (entry[k] !== undefined) return { value: entry[k], key: k };
  }
  return { value: undefined, key: null };
}

(async () => {
  let cap, cleared;
  try { cap = JSON.parse(fs.readFileSync(STEP1, "utf8")); }
  catch (e) { fail(80, `cannot read step 1 evidence: ${e.message}`); }
  try { cleared = JSON.parse(fs.readFileSync(STEP4, "utf8")); }
  catch (e) { fail(81, `cannot read step 4 evidence: ${e.message}`); }

  if (cap.opportunityId !== OPPORTUNITY_ID) fail(82, `step 1 names a different opportunity`);
  if (cleared.putStatus === null) {
    fail(83, `step 4 recorded no PUT status; it threw. Read the evidence before proceeding.`);
  }
  console.log(`PRECHECK ok — step 4 candidate ${cleared.candidate} (${cleared.candidateLabel}), PUT ${cleared.putStatus}`);

  const oppUrl = `${PROXY}?path=${encodeURIComponent(`/opportunities/${OPPORTUNITY_ID}`)}`;

  let polls = 0;
  let opp = null;
  let present = true;
  let observed = undefined;
  let observedKey = null;
  let observedEntry = null;
  let absent = false;

  while (polls < MAX_POLLS) {
    polls++;
    const res = await fetch(oppUrl);
    const text = await res.text();
    if (!res.ok) fail(84, `poll ${polls} GET → ${res.status}`, text.slice(0, 400));
    let body;
    try { body = JSON.parse(text); }
    catch (e) { fail(85, `poll ${polls} response is not JSON: ${e.message}`, text.slice(0, 400)); }
    opp = body.opportunity ?? body;

    const entry = (opp.customFields ?? []).find((f) => f.id === TARGET_ID) ?? null;
    present = entry !== null;
    observedEntry = entry;
    const read = entryValue(entry);
    observed = read.value;
    observedKey = read.key;

    console.log(`  poll ${polls}/${MAX_POLLS}  present=${present}  entry=${JSON.stringify(entry)}`);

    if (!present) { absent = true; break; }
    if (polls < MAX_POLLS) await sleep(POLL_MS);
  }

  // ── Classification. Three outcomes, never collapsed. ──
  let outcome;
  if (absent) {
    outcome = "CLEARED";
  } else if (observed === TEST_VALUE) {
    outcome = "UNCHANGED";
  } else {
    outcome = "EMPTIED";
  }

  // ── Confirmation battery against the last polled state ──
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

  /* Restored to origin means the field is absent exactly as capture found
     it, AND the rest of the record is where capture left it. Absence alone
     is not restoration. */
  const restoredToOrigin = absent && cap.fieldPresent === false
    && othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged;

  const record = {
    timestamp: new Date().toISOString(),
    stage: "confirm",
    cycle: "discovery",
    candidate: cleared.candidate,
    candidateLabel: cleared.candidateLabel,
    originStateForThisAttempt: cleared.originStateForThisAttempt,
    note: "PB-D58 section I. NOT prerequisite 5. Establishes clear semantics only.",
    opportunityId: OPPORTUNITY_ID,
    fieldId: TARGET_ID,
    fieldKey: TARGET_KEY,
    dataType: cap.dataType,
    outcome,
    polls,
    keyAbsent: absent,
    observedValue: observed === undefined ? null : observed,
    observedKey,
    observedEntry,
    capturedFieldPresent: cap.fieldPresent,
    confirmations: { othersUnchanged, offersUnchanged, stageUnchanged, statusUnchanged },
    restoredToOrigin,
    drifted,
    offerNowPresent,
    liveStageId: opp.pipelineStageId ?? null,
    liveStatus: opp.status ?? null,
    liveCustomFields: liveFields,
  };

  try { fs.writeFileSync(EVIDENCE, JSON.stringify(record, null, 2), "utf8"); }
  catch (e) { fail(86, `evidence persistence failed: ${e.message}`); }

  console.log("");
  console.log(`CONFIRM  outcome=${outcome}  polls=${polls}`);
  console.log(`  keyAbsent       ${absent}`);
  console.log(`  entry           ${JSON.stringify(observedEntry)}`);
  console.log(`  othersUnchanged ${othersUnchanged}${othersUnchanged ? "" : "  drifted=" + JSON.stringify(drifted)}`);
  console.log(`  offersUnchanged ${offersUnchanged}${offersUnchanged ? " (all 7 still absent)" : "  present=" + JSON.stringify(offerNowPresent)}`);
  console.log(`  stageUnchanged  ${stageUnchanged}`);
  console.log(`  statusUnchanged ${statusUnchanged}`);
  console.log(`  restoredToOrigin ${restoredToOrigin}`);
  console.log(`  evidence        ${EVIDENCE}`);
  console.log("");

  if (outcome === "CLEARED" && restoredToOrigin) {
    console.log(`  OBSERVED: ${cleared.candidateLabel} clears an opportunity NUMERICAL field to KEY_ABSENT.`);
    console.log("  The record is back where capture found it. The proof cycle may proceed.");
    process.exit(0);
  }
  if (outcome === "CLEARED") {
    console.log("  The key is absent BUT a confirmation failed. The clear was not inert.");
    process.exit(87);
  }
  console.log(`  ${cleared.candidateLabel} did NOT clear the field. Outcome: ${outcome}.`);
  console.log(`  The field is left populated. Candidate 2 (field_value: null) runs steps 4 and 5 ONLY —`);
  console.log("  per PB-D58 section I that is a POPULATED-origin clear, a different experiment.");
  console.log("  Do NOT re-run steps 2 or 3.");
  process.exit(88);
})().catch((e) => {
  console.error("CONFIRM THREW:", (e && e.stack) || e);
  process.exit(89);
});
