#!/usr/bin/env node
"use strict";
/**
 * netlify-status.test.cjs — offline proof for the Gate 3 observer.
 *
 * ENTIRELY OFFLINE. No network, no gh, no git, no Netlify. It exercises
 * classify() as a pure function against committed fixtures, and asserts the
 * read-only posture statically against netlify-status.cjs's own source.
 *
 * This is how the failure path gets proven WITHOUT ever breaking production.
 * No genuinely failed Netlify build has been observed on these sites, and one
 * must never be manufactured merely for proof — build-failure.json is a
 * synthesized record, and it exercises the same code path a real one would.
 *
 * FLOOR RULE. On FIRST authorship the floor may be set from the first complete
 * successful authored run — that is the baseline. After a baseline exists the
 * floor may NEVER be changed merely to make a changed run pass. It moves only
 * when checks are deliberately ADDED or REMOVED as an authored decision, and
 * the reason belongs in the commit. A floor edited to match a surprising run
 * is not a floor.
 *
 * Floor history:
 *   82  baseline, first successful authored run 2026-08-19
 *   86  +4, authored: pagination fix — NOT_SEEN_STALE was unreachable while a
 *       full deploy window alone forced cannot_observe, and both production
 *       sites sit at a full window permanently
 *
 * Run:  node scripts/netlify-status.test.cjs
 * Exit: 0 ok · 1 failures · 2 wrong check count · 3 threw · 4 name collision
 */

const fs = require("node:fs");
const path = require("node:path");

const SRC_PATH = path.join(__dirname, "netlify-status.cjs");
const SRC = fs.readFileSync(SRC_PATH, "utf8");
const mod = require("./netlify-status.cjs");
const { classify, buildResult, renderHuman, worstSeverity, SEVERITY_EXIT } = mod;

const FLOOR = 86;

let checksRun = 0;
let failures = 0;
const seen = new Set();

function check(name, ok, detail) {
  if (seen.has(name)) {
    console.log(`ABORT — duplicate check name ${name}`);
    process.exit(4);
  }
  seen.add(name);
  checksRun += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"),
  );
}

/** Assert a fixture's composite, severity, and retryable in one place. */
function expectCase(fixtureName, composite, severity, retryable) {
  const r = classify(loadFixture(fixtureName));
  check(`${fixtureName}-composite`, r.composite === composite,
    `got=${r.composite} want=${composite}`);
  check(`${fixtureName}-severity`, r.severity === severity,
    `got=${r.severity} want=${severity}`);
  check(`${fixtureName}-retryable`, r.retryable === retryable,
    `got=${r.retryable} want=${retryable}`);
  return r;
}

// ── Fixture branches ───────────────────────────────────────────────────────

const deployed = expectCase("deployed", "DEPLOYED", "healthy", false);
check("deployed-q1", deployed.q1 === "DEPLOYED", `got=${deployed.q1}`);
check("deployed-q2", deployed.q2 === "PUBLISH_CURRENT", `got=${deployed.q2}`);
check("deployed-ignores-preview-decoy",
  deployed.evidence.tipDeployId === "d-tip-ready",
  `got=${deployed.evidence.tipDeployId} — a deploy-preview carrying the same ` +
  `commit must never answer Q1`);

const skip = expectCase("intentional-skip", "EXPECTED_BEHIND", "healthy", false);
check("skip-q1", skip.q1 === "INTENTIONAL_SKIP", `got=${skip.q1}`);
check("skip-q2", skip.q2 === "PUBLISH_CURRENT", `got=${skip.q2}`);
check("skip-no-warning", skip.warnings.length === 0,
  `got=${skip.warnings.length} — a routine skip must be silent`);

const fail = expectCase("build-failure", "DEPLOY_FAILURE_CANDIDATE", "unhealthy", false);
check("build-failure-q1", fail.q1 === "DEPLOY_FAILURE_CANDIDATE", `got=${fail.q1}`);

const unknown = expectCase("unknown-state", "UNKNOWN_STATE", "cannot_observe", false);
check("unknown-state-q1", unknown.q1 === "UNKNOWN_STATE", `got=${unknown.q1}`);

const flight = expectCase("in-flight", "IN_FLIGHT", "indeterminate", true);
check("in-flight-q1", flight.q1 === "IN_FLIGHT", `got=${flight.q1}`);

const lagging = expectCase("publish-lagging", "PUBLISH_LAGGING", "unhealthy", false);
check("publish-lagging-q1", lagging.q1 === "DEPLOYED",
  `got=${lagging.q1} — Q1 alone reads healthy here, which is why Q2 is independent`);
check("publish-lagging-q2", lagging.q2 === "PUBLISH_LAGGING", `got=${lagging.q2}`);

const within = expectCase("no-record-within-grace", "NOT_YET_SEEN", "indeterminate", true);
check("within-grace-q1", within.q1 === "NOT_YET_SEEN", `got=${within.q1}`);

check("within-grace-window-not-full",
  within.evidence.deploysWindowFull === false,
  "a short window always reaches back");

const past = expectCase("no-record-past-grace", "NOT_SEEN_STALE", "unhealthy", false);
check("past-grace-q1", past.q1 === "NOT_SEEN_STALE", `got=${past.q1}`);
// REGRESSION PIN. Keying on window fullness alone made NOT_SEEN_STALE
// unreachable in production, where both sites sit at a full window always.
check("past-grace-window-is-full",
  past.evidence.deploysWindowFull === true,
  "the pin is worthless unless this fixture's window is actually full");
check("past-grace-full-window-still-reaches-back",
  past.evidence.windowReachesBackToTip === true,
  "oldest deploy predates the tip, so the absence of a record is a FACT");

const trunc = expectCase("pagination-truncated", "PAGINATION_TRUNCATED", "cannot_observe", false);
check("truncated-q1", trunc.q1 === "PAGINATION_TRUNCATED",
  `got=${trunc.q1} — a full page that does not reach back proves nothing`);
check("truncated-window-does-not-reach-back",
  trunc.evidence.windowReachesBackToTip === false,
  "oldest deploy is NEWER than the tip, so older deploys may exist unseen");

const timedSkip = expectCase("skip-with-deploy-time", "EXPECTED_BEHIND", "healthy", false);
check("timed-skip-q1", timedSkip.q1 === "INTENTIONAL_SKIP",
  `got=${timedSkip.q1} — the message is the sole V1 predicate`);
check("timed-skip-warns", timedSkip.warnings.length === 1,
  `got=${timedSkip.warnings.length} warnings`);
check("timed-skip-warning-text",
  timedSkip.warnings[0].includes("NEWLY OBSERVED"),
  "the never-before-seen case must reach a human, not be absorbed silently");

const pubUnknown = expectCase("publish-unknown", "PUBLISH_UNKNOWN", "cannot_observe", false);
check("publish-unknown-q2", pubUnknown.q2 === "PUBLISH_UNKNOWN", `got=${pubUnknown.q2}`);

const dup = expectCase("duplicate-tip-deploys", "DEPLOYED", "healthy", false);
check("duplicate-newest-wins",
  dup.evidence.tipDeployId === "d-tip-retry-ready",
  `got=${dup.evidence.tipDeployId}`);
check("duplicate-warns", dup.warnings.length === 1,
  `got=${dup.warnings.length} — contradictory records must be announced`);

// ── Purity and determinism ─────────────────────────────────────────────────

const pureInput = loadFixture("deployed");
const beforeJson = JSON.stringify(pureInput);
classify(pureInput);
check("classify-does-not-mutate-input",
  JSON.stringify(pureInput) === beforeJson,
  "classify must be pure — a mutating classifier cannot be replayed");

check("classify-is-deterministic",
  JSON.stringify(classify(loadFixture("deployed")))
    === JSON.stringify(classify(loadFixture("deployed"))),
  "same input must give the same verdict");

// ── Severity precedence ────────────────────────────────────────────────────

const sev = (severity) => ({ severity, retryable: false });
check("precedence-unhealthy-beats-cannot-observe",
  worstSeverity([sev("cannot_observe"), sev("unhealthy")]) === "unhealthy",
  "a real failure must ALERT rather than be masked by an unreadable site");
check("precedence-cannot-observe-beats-indeterminate",
  worstSeverity([sev("indeterminate"), sev("cannot_observe")]) === "cannot_observe",
  "");
check("precedence-indeterminate-beats-healthy",
  worstSeverity([sev("healthy"), sev("indeterminate")]) === "indeterminate", "");

check("exit-healthy-0", SEVERITY_EXIT.healthy === 0, `got=${SEVERITY_EXIT.healthy}`);
check("exit-unhealthy-1", SEVERITY_EXIT.unhealthy === 1, `got=${SEVERITY_EXIT.unhealthy}`);
check("exit-cannot-observe-2", SEVERITY_EXIT.cannot_observe === 2,
  `got=${SEVERITY_EXIT.cannot_observe}`);
check("exit-indeterminate-3", SEVERITY_EXIT.indeterminate === 3,
  `got=${SEVERITY_EXIT.indeterminate}`);

// ── The canonical object and the view rendered from it ─────────────────────

const greenWithWarning = buildResult({
  nowIso: "2026-08-19T12:00:00.000Z",
  graceSeconds: 300,
  tip: {
    sha: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    committedAtIso: "2026-08-19T11:50:00.000Z",
    source: "github-api",
    tipTimeSource: "github:commit.committer.date",
  },
  sites: [timedSkip],
  warnings: [],
});
const humanGreen = renderHuman(greenWithWarning);

check("green-run-exit-0", greenWithWarning.overall.exitCode === 0,
  `got=${greenWithWarning.overall.exitCode}`);
check("warnings-surface-on-a-green-run",
  humanGreen.includes("NEWLY OBSERVED"),
  "healthy-but-notable is invisible otherwise, which defeats distinguishing it");
check("human-agrees-with-json-exit",
  humanGreen.includes(`exit=${greenWithWarning.overall.exitCode}`),
  "human text is rendered FROM the canonical object, so it cannot disagree");
check("human-agrees-with-json-verdict",
  humanGreen.includes(greenWithWarning.sites[0].composite),
  "");

const mixed = buildResult({
  nowIso: "2026-08-19T12:00:00.000Z",
  graceSeconds: 300,
  tip: {
    sha: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    committedAtIso: "2026-08-19T11:50:00.000Z",
    source: "github-api",
    tipTimeSource: "github:commit.committer.date",
  },
  sites: [skip, fail],
  warnings: [],
});
check("mixed-run-takes-worst-site", mixed.overall.exitCode === 1,
  `got=${mixed.overall.exitCode} — one healthy site must not mask a failing one`);
check("schema-version-present", mixed.schemaVersion === 1,
  `got=${mixed.schemaVersion}`);
check("tip-time-source-recorded",
  mixed.tip.tipTimeSource === "github:commit.committer.date",
  "the grace clock's provenance must be in the record");
check("json-round-trips",
  JSON.stringify(JSON.parse(JSON.stringify(mixed))) === JSON.stringify(mixed),
  "the canonical object must be pure JSON");

// ── Static assertions on the observer's own source ─────────────────────────
// Read-only is a property of THIS CODE, not of the credential. The PAT carries
// write authority; these checks are what actually constrain it.

const fetchCalls = (SRC.match(/\bfetch\(/g) || []).length;
check("exactly-one-fetch-call-site", fetchCalls === 1,
  `got=${fetchCalls} — getJson() must be the only network call site`);

check("no-http-client-imports",
  !/require\(["']node:https?["']\)/.test(SRC)
  && !/require\(["'](axios|node-fetch|got|undici)["']\)/.test(SRC),
  "a second HTTP client would be a second, unaudited call site");

check("method-hardcoded-get",
  /method:\s*"GET"/.test(SRC) && !/method:\s*\w+(?![:"])/.test(SRC.replace(/method:\s*"GET"/g, "")),
  "the HTTP method must be a literal, never a variable");

check("no-write-verbs-anywhere",
  !/"(POST|PUT|PATCH|DELETE)"/.test(SRC),
  "no write verb may appear in this file at all");

check("never-calls-accounts-env",
  !/NETLIFY_API\}\/accounts/.test(SRC),
  "/accounts/{slug}/env returns secret VALUES and must never be requested");

check("gh-invoked-without-method-override",
  !/"-X"/.test(SRC) && !/"--method"/.test(SRC),
  "gh api with no -X and no --method is a GET");

check("token-read-from-env",
  /process\.env\.NETLIFY_AUTH_TOKEN/.test(SRC),
  "the token must come from the environment");

// Matches an ASSIGNMENT of a token from argv, not prose about argv. The
// earlier form tested for the two words on one line and flagged the very
// comment documenting the rule.
check("token-never-assigned-from-argv",
  !/token[^\n]*=\s*[^\n]*argv/i.test(SRC),
  "argv is world-readable in the process list");

const tokenInterpolations = (SRC.match(/\$\{token\}/g) || []).length;
check("token-interpolated-once-only", tokenInterpolations === 1,
  `got=${tokenInterpolations} — the Authorization header is the only place ` +
  `the token may appear`);

// ── Floor ──────────────────────────────────────────────────────────────────

console.log(`checksRun=${checksRun} failures=${failures} floor=${FLOOR}`);
if (checksRun !== FLOOR) {
  console.log(`ABORT — expected exactly ${FLOOR} checks, ran ${checksRun}`);
  process.exit(2);
}
if (failures) process.exit(1);
console.log("NETLIFY-STATUS OFFLINE GREEN");
