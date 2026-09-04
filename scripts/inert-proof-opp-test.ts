/**
 * Opportunity-field inert proof, executed in the IAOS TEST location.
 * PB-D62 / INV-25 Tranche 1, Route A.
 *
 * FIVE STEPS, ONE DELIBERATE COMMAND EACH, per PB-D58 section I:
 *
 *   1 capture   GET only. Records the fixture at origin and REFUSES unless the
 *               target is ABSENT, because Route A's whole point is that a
 *               freshly bound Test fixture gives an ABSENT-ORIGIN proof and the
 *               populated-origin restore contract is not the execution path.
 *   2 write     ONE PUT. Custom-fields-only. NO re-read, NO poll.
 *   3 verify    GET + bounded poll. Strict equality on the readback, then
 *               PB-D58 section II's four-item confirmation battery.
 *   4 clear     ONE PUT, `field_value: ""`. NO re-read, NO poll.
 *   5 confirm   GET + bounded poll. STRUCTURAL absence of the id, the battery
 *               again, and a full comparison back to step 1's capture.
 *
 * ⚠ ONE PARAMETERIZED SCRIPT, NOT FIVE COPIES PER FIELD, AND THAT IS A
 * DELIBERATE DEPARTURE FROM THE EXISTING SUITES' FILE LAYOUT. Those suites were
 * produced by copying a prior field's five files and substituting identifiers,
 * and PB-D60 records what that cost: "substitution had silently corrupted
 * several of its claims -- it still said this suite discharges PB-D56
 * prerequisite 5 (PB-D58 already did, on a different field), and it carried the
 * other field's test-value reasoning with this value swapped in." The doctrine
 * PB-D58 section I actually states is FIVE DELIBERATE COMMANDS WITH EVIDENCE
 * BETWEEN THEM, which `--step` satisfies exactly: each invocation is its own
 * decision to proceed, and no step will run without the prior step's artifact.
 * What is NOT preserved is five copies of prose that drift. Adding the next
 * field is a FIELDS entry and its own designation decision — never a copy.
 *
 * ⚠ WHAT THIS PROVES, AND WHAT IT DOES NOT. It establishes, by observation on a
 * live GHL record, that a custom-fields-only PUT carrying ONLY this field moves
 * nothing else on the opportunity — not another custom field, not one of the
 * seven `offer_` fields, not the pipeline stage, not the status — and that the
 * value round-trips exactly and clears to KEY_ABSENT. That is the same
 * evidentiary class PB-D58, PB-D59 and PB-D60 produced.
 *
 * It does NOT establish Production-location workflow behaviour. Workflow
 * configuration is per-location and, per section 4.6, is not API-derivable at
 * all — the Test credential cannot even read the workflow inventory (401
 * OBSERVED 2026-09-04). No opportunity proof in this repository has ever
 * established that; PB-D58 section II says so in terms and proceeded on a
 * disposable fixture "for that reason, not despite it." The scope statement
 * belongs in the designation, not in a footnote discovered later.
 *
 * ⚠ IT CANNOT TOUCH PRODUCTION. See `scripts/lib/ghl-test-proof.ts`.
 *
 * Usage, from the repository root, one command per step:
 *   npx tsx scripts/inert-proof-opp-test.ts --field arv --step 1 \
 *     --env test --location <test location id> --credential-file .env.test
 */

import {
  capture,
  die,
  evidencePath,
  ghlPut,
  loadToken,
  parseCommonArgs,
  readEvidence,
  readOpportunity,
  readSingularFieldValue,
  runBattery,
  stamp,
  writeEvidence,
  type Capture,
} from "./lib/ghl-test-proof.ts";
import { getConfig } from "../app/shared/ghl-config.ts";
import fixtures from "./harness-fixtures.json" with { type: "json" };

/**
 * The proof registry. A field appears here ONLY once a designation decision
 * has approved it and its test value. Presence here is ELIGIBILITY, never
 * safety — safety is earned by all five steps completing.
 */
interface FieldSpec {
  /** Path into the Test config, for the record and for the reader. */
  readonly configPath: string;
  /** Resolves the carrier id from the environment config. */
  readonly resolve: (config: Record<string, any>) => string;
  readonly fieldKey: string;
  /** Designated test value, approved BEFORE the write. Never "observed". */
  readonly testValue: number;
  readonly designation: string;
}

const FIELDS: Record<string, FieldSpec> = {
  arv: {
    configPath: "opportunityFacts.arv",
    resolve: (c) => c.opportunityFacts.arv,
    fieldKey: "opportunity.arv_after_repair_value",
    testValue: 417529.63,
    designation: "PB-D62 (2026-09-04), INV-25 Tranche 1",
  },
};

const POLL_ATTEMPTS = 6;
const POLL_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function artifact(field: string, step: number): string {
  return `inert-proof-opp-${field}-test-step${step}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseCommonArgs(argv);

  const fieldName = (argv.indexOf("--field") >= 0 ? argv[argv.indexOf("--field") + 1] : null) ?? die(
    "--field is required. Known fields: " + Object.keys(FIELDS).join(", "),
  );
  const spec = FIELDS[fieldName];
  if (spec === undefined) {
    die(`--field ${JSON.stringify(fieldName)} has no designation. Known fields: ${Object.keys(FIELDS).join(", ")}. A field without an approved designation and test value cannot enter the cycle.`);
  }

  const stepRaw = argv.indexOf("--step") >= 0 ? argv[argv.indexOf("--step") + 1] : null;
  const step = Number(stepRaw);
  if (!Number.isInteger(step) || step < 1 || step > 5) die("--step must be 1, 2, 3, 4 or 5.");

  const config = getConfig(args.env) as Record<string, any>;
  const targetId = spec.resolve(config);
  if (!targetId) die(`the ${args.env} config carries no id at ${spec.configPath}.`);

  const env = (fixtures as Record<string, any>)[args.env];
  const opportunityId = env?.fixtureRecords?.opportunities?.iaosUnderwritingTest;
  const offerPins = env?.untouchedPins?.opportunityOfferFields;
  if (!opportunityId) {
    die(`harness-fixtures.json carries no ${args.env}.fixtureRecords.opportunities.iaosUnderwritingTest. Run scripts/create-test-fixture.ts and record the ids. Refusing rather than inventing one.`);
  }
  if (!offerPins || Object.keys(offerPins).length !== 7) {
    die(`harness-fixtures.json carries no seven-member ${args.env}.untouchedPins.opportunityOfferFields. Refusing rather than inventing them.`);
  }
  const offerIds: string[] = Object.values(offerPins);

  const token = loadToken(args.credentialFile);
  const header = {
    stampedAt: stamp(),
    environment: args.env,
    locationId: args.location,
    credentialFile: args.credentialFile,
    field: fieldName,
    fieldKey: spec.fieldKey,
    configPath: spec.configPath,
    targetId,
    opportunityId,
    designation: spec.designation,
  };

  const priorPath = (n: number) => evidencePath({ ...args, out: null }, artifact(fieldName, n));
  const myPath = args.out ?? priorPath(step);

  // ── STEP 1 — CAPTURE. Read only. ─────────────────────────────────────────
  if (step === 1) {
    const opportunity = await readOpportunity(token, opportunityId);
    const snapshot = capture(opportunity);
    const entry = snapshot.customFields.find((f) => f.id === targetId) ?? null;

    console.log(`origin: target ${targetId} is ${entry === null ? "ABSENT" : "PRESENT " + JSON.stringify(entry)}`);
    console.log(`stage=${snapshot.pipelineStageId} status=${snapshot.status} customFields=${snapshot.customFields.length}`);

    writeEvidence(myPath, { step: 1, ...header, origin: entry === null ? "absent" : "populated", capture: snapshot });

    if (entry !== null) {
      console.error(
        "ABORT: the target is POPULATED at origin. Route A executes the ABSENT-ORIGIN contract on a freshly " +
          "bound Test fixture; the populated-origin restore contract is explicitly not the execution path here.",
      );
      process.exit(5);
    }
    console.log("STEP 1 PASS — absent origin confirmed. Proceed to step 2 deliberately.");
    return;
  }

  const one = readEvidence(priorPath(1));
  if (one.step !== 1 || one.targetId !== targetId || one.opportunityId !== opportunityId) {
    die("step 1's evidence does not match this invocation's field/fixture. Steps run in order, on one target.");
  }
  const origin: Capture = one.capture;

  // ── STEP 2 — WRITE. ONE PUT. No re-read, no poll. ────────────────────────
  if (step === 2) {
    const body = { customFields: [{ id: targetId, field_value: spec.testValue }] };
    const res = await ghlPut(token, `/opportunities/${opportunityId}`, body);
    writeEvidence(myPath, { step: 2, ...header, testValue: spec.testValue, requestBody: body, responseStatus: res.status, responseBody: res.body });
    console.log(`PUT status=${res.status} sent=${spec.testValue}`);
    if (res.status !== 200 && res.status !== 201) {
      console.error("ABORT: the PUT did not succeed. Evidence recorded. The fixture may hold no value; run step 1 again to observe.");
      process.exit(5);
    }
    console.log("STEP 2 PASS — one PUT issued, nothing read back. A 200 is not success; step 3 decides.");
    return;
  }

  // ── STEP 3 — VERIFY. Bounded poll, strict equality, battery. ─────────────
  if (step === 3) {
    let observed: number | string | null = null;
    let attempts = 0;
    let live: Capture | null = null;
    for (let i = 1; i <= POLL_ATTEMPTS; i++) {
      attempts = i;
      if (i > 1) await sleep(POLL_DELAY_MS);
      const opportunity = await readOpportunity(token, opportunityId);
      live = capture(opportunity);
      const entry = (opportunity.customFields ?? []).find((f: any) => f.id === targetId) ?? null;
      observed = entry === null ? null : readSingularFieldValue(entry);
      if (observed === spec.testValue) break;
    }
    const battery = runBattery(origin, live!, targetId, offerIds);
    const landed = observed === spec.testValue;

    writeEvidence(myPath, { step: 3, ...header, sent: spec.testValue, observed, landed, attempts, battery, capture: live });
    console.log(`observed=${JSON.stringify(observed)} sent=${spec.testValue} landed=${landed} attempts=${attempts}`);
    console.log(`battery othersUnchanged=${battery.othersUnchanged} offersUnchanged=${battery.offersUnchanged} stageUnchanged=${battery.stageUnchanged} statusUnchanged=${battery.statusUnchanged}`);
    for (const d of battery.details) console.log(`  ! ${d}`);

    if (!landed || !battery.passed) {
      console.error("ABORT: verification failed. THE FIXTURE STILL HOLDS A NON-REAL VALUE — step 4 restoration is REQUIRED.");
      process.exit(5);
    }
    console.log("STEP 3 PASS — value landed exactly and nothing else moved. Restoration is required to complete the proof.");
    return;
  }

  // ── STEP 4 — CLEAR. ONE PUT. No re-read, no poll. ────────────────────────
  if (step === 4) {
    const body = { customFields: [{ id: targetId, field_value: "" }] };
    const res = await ghlPut(token, `/opportunities/${opportunityId}`, body);
    writeEvidence(myPath, { step: 4, ...header, clearMechanism: 'field_value: ""', requestBody: body, responseStatus: res.status, responseBody: res.body });
    console.log(`PUT status=${res.status} cleared with field_value: ""`);
    if (res.status !== 200 && res.status !== 201) {
      console.error("ABORT: the clearing PUT did not succeed. THE FIXTURE STILL HOLDS A NON-REAL VALUE.");
      process.exit(5);
    }
    console.log("STEP 4 PASS — one clearing PUT issued. Step 5 decides whether it landed.");
    return;
  }

  // ── STEP 5 — CONFIRM. Structural absence, battery, back to origin. ───────
  let entry: any = undefined;
  let attempts = 0;
  let live: Capture | null = null;
  for (let i = 1; i <= POLL_ATTEMPTS; i++) {
    attempts = i;
    if (i > 1) await sleep(POLL_DELAY_MS);
    const opportunity = await readOpportunity(token, opportunityId);
    live = capture(opportunity);
    /* STRUCTURAL absence — the id gone from the array — never a parser
       returning undefined. A mis-shaped parser cannot manufacture absence out
       of a key that is present, which is the whole protection. */
    entry = (opportunity.customFields ?? []).find((f: any) => f.id === targetId);
    if (entry === undefined) break;
  }
  const clearedToAbsent = entry === undefined;
  const battery = runBattery(origin, live!, targetId, offerIds);
  const restoredToOrigin =
    clearedToAbsent && JSON.stringify(origin) === JSON.stringify(live);

  writeEvidence(myPath, {
    step: 5, ...header, clearedToAbsent, restoredToOrigin, attempts, battery,
    residualEntry: entry ?? null, origin, capture: live,
  });
  console.log(`clearedToAbsent=${clearedToAbsent} restoredToOrigin=${restoredToOrigin} attempts=${attempts}`);
  console.log(`battery othersUnchanged=${battery.othersUnchanged} offersUnchanged=${battery.offersUnchanged} stageUnchanged=${battery.stageUnchanged} statusUnchanged=${battery.statusUnchanged}`);
  for (const d of battery.details) console.log(`  ! ${d}`);

  if (!clearedToAbsent || !battery.passed || !restoredToOrigin) {
    console.error("ABORT: restoration not confirmed. The proof is NOT complete and the fixture is NOT at origin.");
    process.exit(5);
  }
  console.log(`STEP 5 PASS — ${spec.fieldKey} proven inert in the Test location; fixture restored to origin.`);
}

main();
