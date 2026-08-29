"use strict";
/**
 * EXIT CONTRACT — RUNTIME HALF.  Gate 4C C4a closure debt 3, Jess step 5.
 *
 * Executes a corpus and reads what the OPERATING SYSTEM reports, rather than
 * reading a declaration. The static half asserts what the source says; this
 * half asserts what actually happens — and what happens turns out to depend on
 * the observation channel, which is the finding this file exists to pin down.
 *
 * ── THE ASSERTION THAT JUSTIFIES THE FILE ───────────────────────────────────
 * 283 of 723 declared codes exceed 255, and what an operator OBSERVES at those
 * sites depends on HOW THEY INVOKED THE SCRIPT. Measured, same process:
 *
 *            declared 260        declared 30
 *   bash          4                  30
 *   spawnSync   260 (win) / 4 (posix) 30
 *   PowerShell  260                  30
 *
 * Windows carries a 32-bit exit status, so the raw value survives a direct
 * spawn and PowerShell. A POSIX shell reports 8 bits, so bash shows 4. On
 * Linux the OS itself is 8-bit and every channel truncates.
 *
 * So the defect is not a consistent truncation — it is an INCONSISTENT one.
 * The same refusal shows 360 in PowerShell and 104 in git-bash, and nothing
 * labels which channel the reader is on.
 *
 * That is also the strongest argument for the text fix: the code printed in
 * the message is the ONLY channel-independent value in the system. "[refusal
 * 360]" reads 360 in PowerShell, in bash, in a log file and in a screenshot.
 * The exit status does not.
 *
 * Both channels are asserted below, each EXACTLY. Neither check accepts two
 * answers — an assertion satisfied by either value cannot fail, and a check
 * that cannot fail is not a check.
 *
 * ── WHY TWO TRUNCATING MEMBERS AND NOT ONE ──────────────────────────────────
 * The obvious wrong implementation of `declared & 255` is `declared - 256`,
 * which is CORRECT for every value in 256-511 and wrong above it. A corpus
 * holding only mao-a0-step3 (260 -> 4) passes that bug silently. payload-b-
 * step3 (520 -> 8) is in the next range and catches it. The second member is
 * the control on this test's own arithmetic, not redundancy.
 *
 * ── WHAT THIS HALF CANNOT REACH, STATED SO NOBODY ASSUMES OTHERWISE ─────────
 * finish(): ZERO of its 27 sites are reachable here. Every finish() path
 * requires inert-proof-runner.cjs to execute past input validation, which no
 * non-mutating run does. The static half covers all 27 by composition. Do not
 * read runtime coverage of finish() into this file — there is none.
 *
 * Likewise the 231 direct process.exit(N) sites: one run observes exactly one
 * exit, so runtime can only ever sample them. The static half covers the
 * population; this half proves the mechanism behaves as declared.
 *
 * ── COST, AND WHY IT IS NOT TRIMMED ─────────────────────────────────────────
 * ghl-config-loader.cjs shells out to `npx tsc` into a PID-keyed temp dir, so
 * nothing is reused across processes: every getConfig-touching run costs ~14s,
 * while carrier-only runs cost ~0.2s — an 80x split. Both truncating members
 * are in getConfig families (no carrier-only file declares a code above 86),
 * so ~43s of the runtime is unavoidable if truncation is to be observed at
 * all. It is not trimmed to hit a time target; that case is why this exists.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * Every member refuses at a gate before any network call and writes no
 * artifact. Members 1, 2 and 4 stop at a step-1 artifact that is ABSENT by
 * design (the disarms). Member 3 stops at a carrier section guard. Member 5
 * stops at the same read-throw. Member 6 stops at assertEnvironment. None
 * reads a credential; none is affected by an ambient one.
 */

const { spawnSync } = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPTS = path.join(REPO_ROOT, "app", "scripts");

/**
 * declared is read from SOURCE at run time, never hardcoded here: hardcoding it
 * would make this a change-detector that fails when someone renumbers a refusal.
 * `anchor` locates the fail() call that fires; null means the site does not go
 * through fail() and carries no declared code to compare.
 */
const CORPUS = [
  {
    label: "fail-nontruncating-carrier-only",
    file: "inert-proof-opp-closing-costs-step2.cjs",
    args: ["--env=production"],
    anchor: "cannot read step 1 evidence",
  },
  {
    label: "fail-nontruncating-second-code",
    file: "inert-proof-opp-closing-costs-step3.cjs",
    args: ["--env=production"],
    anchor: "cannot read step 1 evidence",
  },
  {
    label: "direct-exit-no-wrapper",
    file: "inert-proof-opp-closing-costs-step2.cjs",
    args: ["--env="],
    anchor: null,
    expectExit: 4,
  },
  {
    label: "fail-TRUNCATING-260",
    file: "inert-proof-opp-mao-a0-step3.cjs",
    args: ["--env=production"],
    anchor: "cannot read step 1 evidence",
  },
  {
    label: "fail-TRUNCATING-520-next-range",
    file: "inert-proof-opp-payload-b-step3.cjs",
    args: ["--env=production"],
    anchor: "cannot read step 1 evidence",
  },
  {
    label: "assertEnvironment-provenance-refusal",
    file: "inert-proof-property-notes-step2.cjs",
    args: ["--env=production"],
    anchor: null,
    expectExit: 6,
    /* `anchor` cannot serve here: it resolves fail() call sites to derive a
       declared code, and assertEnvironment calls process.exit(PROVENANCE_REFUSAL)
       directly. So the INTENDED refusal is proven from the text
       assertEnvironment emits, which no other exit-6 path in this corpus
       produces. Without this, any unrelated exit 6 would satisfy the entry. */
    refusalText: ["step-1 evidence", "carries no environment stamp"],
    needsProvenanceFixture: true,
  },
];

/* 36 -> 37: the provenance entry gains its refusal-text assertion. The fixture
   construction and validation below are PRECONDITIONS with hard aborts, not
   check() sites, so they do not move the floor. */
const FLOOR = 37;

/* ── THE PROVENANCE PRECONDITION — THE TEST OWNS IT ───────────────────────────
   This corpus entry asserts that step2 refuses on provenance. Reaching that
   refusal requires a step-1 artifact that EXISTS, PARSES, and carries no
   usable environment stamp. Historically nothing created it: the Windows
   green was AMBIENT-STATE DEPENDENT, satisfied by a leftover developer
   artifact, and the Linux red was the same accident with the opposite sign.
   Neither was evidence. A test owns its preconditions.

   ⚠ THE FIXTURE IS INCAPABLE OF PASSING assertEnvironment, and that is the
   safety property as much as the test property. If it could pass, step2 would
   continue past the refusal toward a LIVE GHL READ and then a WRITE. An
   artifact with NO `environment` key cannot proceed: the refusal is
   unconditional on that branch. The property under test and the property that
   makes it safe are the same property.

   It is also non-destructive: a real developer artifact at this path is moved
   aside and restored, so running the gate never destroys real evidence. */
const PROV_ARTIFACT = path.join(os.tmpdir(), "inert-proof-property-notes-step1.json");
let provSaved = null;

function buildProvenanceFixture() {
  if (fs.existsSync(PROV_ARTIFACT)) provSaved = fs.readFileSync(PROV_ARTIFACT);
  fs.writeFileSync(PROV_ARTIFACT, JSON.stringify({
    _fixture: "test-exit-contract-runtime provenance precondition",
    _intent: "DELIBERATELY UNSTAMPED: no `environment` key, so assertEnvironment must refuse with PROVENANCE_REFUSAL (6)",
  }, null, 2), "utf8");

  /* VALIDATE BEFORE SPAWNING. We do not hope the setup produced the refusal
     condition; we establish it. A failure here fails the test WITHOUT ever
     spawning step2. */
  if (!fs.existsSync(PROV_ARTIFACT)) {
    console.error(`ABORT — provenance fixture was not created at ${PROV_ARTIFACT}`);
    teardownProvenanceFixture();
    process.exit(7);
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(PROV_ARTIFACT, "utf8")); }
  catch (e) {
    console.error(`ABORT — provenance fixture does not parse: ${e.message}`);
    teardownProvenanceFixture();
    process.exit(7);
  }
  const stampValue = parsed == null ? undefined : parsed.environment;
  if (stampValue !== undefined && stampValue !== null) {
    console.error(`ABORT — provenance fixture carries an environment stamp (${JSON.stringify(stampValue)}); it would NOT trigger the refusal and step2 could proceed toward a live read.`);
    teardownProvenanceFixture();
    process.exit(7);
  }
  console.log(`provenance-fixture OK  ${PROV_ARTIFACT}  parses, no environment stamp -> refusal is guaranteed`);
}

function teardownProvenanceFixture() {
  try { fs.rmSync(PROV_ARTIFACT, { force: true }); } catch (e) {}
  if (provSaved !== null) {
    try { fs.writeFileSync(PROV_ARTIFACT, provSaved); } catch (e) {}
    provSaved = null;
  }
}

if (CORPUS.some((c) => c.needsProvenanceFixture)) buildProvenanceFixture();

let checksRun = 0;
let failures = 0;
function check(name, ok, detail) {
  checksRun++;
  if (ok) console.log(`PASS  ${name}  ${detail}`);
  else { failures++; console.log(`FAIL  ${name}  ${detail}`); }
}

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** the code declared at the fail() call carrying `anchor` — from source, not stored */
function declaredCode(file, anchor) {
  const src = strip(fs.readFileSync(path.join(SCRIPTS, file), "utf8"));
  const re = /\bfail\(\s*(\d+)\s*,\s*`([^`]*)`/g;
  let m;
  while ((m = re.exec(src))) if (m[2].includes(anchor)) return Number(m[1]);
  return null;
}

let sawTruncating = false;
let sawNonTruncating = false;

for (const c of CORPUS) {
  const run = spawnSync(process.execPath, [c.file, ...c.args], {
    cwd: SCRIPTS,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env },
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  const observed = run.status;

  check(`${c.label} / exits non-zero`, observed !== 0 && observed !== null, `observed=${observed}`);
  check(`${c.label} / emits something`, output.trim().length > 0, `${output.trim().split(/\r?\n/)[0].slice(0, 60)}…`);

  if (c.anchor === null) {
    check(`${c.label} / observed matches expected`, observed === c.expectExit, `observed=${observed} expected=${c.expectExit}`);
    if (c.refusalText) {
      const missing = c.refusalText.filter((t) => !output.includes(t));
      check(`${c.label} / reached the INTENDED provenance refusal`, missing.length === 0,
        `missing=${JSON.stringify(missing)} first-line="${output.trim().split(/\r?\n/)[0].slice(0, 90)}"`);
    }
    continue;
  }

  const declared = declaredCode(c.file, c.anchor);
  check(`${c.label} / declared code resolvable from source`, declared !== null, `declared=${declared}`);
  if (declared === null) continue;

  const truncates = (declared & 255) !== declared;
  if (truncates) sawTruncating = true; else sawNonTruncating = true;

  /* CHANNEL 1 — direct spawn. Windows preserves 32 bits; POSIX is 8-bit at the
     OS level. Platform-selected and EXACT on each, not a disjunction. */
  const rawExpected = process.platform === "win32" ? declared : declared & 255;
  check(
    `${c.label} / direct-spawn status === ${process.platform === "win32" ? "declared" : "declared & 255"}`,
    observed === rawExpected,
    `declared=${declared} observed=${observed} expected=${rawExpected} platform=${process.platform}`,
  );

  /* CHANNEL 2 — through a POSIX shell, which reports 8 bits on every platform.
     This is the channel a CI `run:` step and a developer terminal both use. */
  const viaShell = spawnSync(
    "bash",
    ["-c", `"$0" "$1" ${c.args.map((a) => `'${a}'`).join(" ")} >/dev/null 2>&1; echo $?`, process.execPath, c.file],
    { cwd: SCRIPTS, encoding: "utf8", timeout: 120000 },
  );
  const shellObserved = Number((viaShell.stdout || "").trim());
  check(
    `${c.label} / posix-shell status === declared & 255`,
    shellObserved === (declared & 255),
    `declared=${declared} shell=${shellObserved} expected=${declared & 255}${truncates ? "  [TRUNCATES — the shell cannot show the declared value]" : ""}`,
  );

  /* The channel dependence itself, under test. The two channels diverge if and
     only if the value truncates AND the platform preserves 32 bits. */
  const shouldDiverge = truncates && process.platform === "win32";
  check(
    `${c.label} / channels ${shouldDiverge ? "DIVERGE" : "agree"} as the platform dictates`,
    (observed !== shellObserved) === shouldDiverge,
    `direct=${observed} shell=${shellObserved} — an operator sees a different number depending on how they ran it`,
  );

  // PROPERTY A observed at runtime: the printed line carries the DECLARED code.
  check(
    `${c.label} / emitted text carries the declared code`,
    new RegExp(`\\b${declared}\\b`).test(output),
    truncates ? `text says ${declared}, shell says ${observed}` : `text and status agree at ${declared}`,
  );
}

check(
  "corpus covers a TRUNCATING site",
  sawTruncating,
  sawTruncating ? "declared>255 observed — the & 255 assertion is not vacuous" : "no truncating member: the relationship assertion degenerates to equality",
);
check(
  "corpus covers a NON-TRUNCATING site",
  sawNonTruncating,
  sawNonTruncating ? "declared<=255 observed — both sides of the boundary exercised" : "no non-truncating member",
);

/* CLEAN UP ON EVERY EXIT PATH, not just the abort paths. Leaving the fixture
   behind would hand the next local run an ambient artifact -- the exact defect
   this repair exists to remove -- and would strand a real developer artifact
   that was moved aside. */
teardownProvenanceFixture();

console.log(`checksRun=${checksRun} failures=${failures} floor=${FLOOR}`);
if (checksRun < FLOOR) {
  console.log(`EXIT CONTRACT RUNTIME — FLOOR BREACHED: ran ${checksRun}, floor ${FLOOR}. A corpus member or assertion was removed.`);
  process.exit(1);
}
if (failures > 0) {
  console.log("EXIT CONTRACT RUNTIME RED");
  process.exit(1);
}
console.log("EXIT CONTRACT RUNTIME GREEN");
