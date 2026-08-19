#!/usr/bin/env node
"use strict";
/**
 * test-identifier-boundary.cjs — Gate 4B-4. Offline identifier assertion.
 *
 * Asserts that NO GoHighLevel-shaped identifier literal exists in deployed
 * application source outside app/shared/ghl-config.ts.
 *
 * "test-" not "verify-" ON PURPOSE. In this repo "verify-*" names a LIVE
 * harness that reaches production. This one is offline: node:fs and node:path,
 * no network, no secrets, no GHL, no install. It must never be mistaken for a
 * production harness.
 *
 * WHY IT EXISTS. Gates 4B-2 and 4B-3 centralized every environment-bound GHL
 * identifier into shared config. Without an assertion that is a convention, not
 * a boundary: the next feature pastes an id inline, nothing objects, and the
 * environment separation quietly reopens one literal at a time.
 *
 * SCOPE IS THE PRODUCTION RUNTIME BOUNDARY — the six directories below, which
 * are what the two netlify.toml files actually deploy.
 *
 * app/scripts/ AND scripts/ ARE DELIBERATELY NOT SCANNED, and that is not an
 * exemption. Those harnesses reach production and pin production identifiers,
 * so they are genuinely part of environment safety — but their binding is an
 * ORIGIN and a CREDENTIAL, not a literal compiled into deployed source. The
 * control that fits them is the staging origin and test location created at
 * Gate 4C. Two control planes; neither is exempt.
 *
 * There is also a concrete false positive. scripts/netlify-status.cjs holds two
 * 36-character UUIDs which are NETLIFY SITE IDS, with no GoHighLevel
 * relationship whatever. A UUID is a UUID whoever issued it, so scanning that
 * tree would flag the Gate 3 deployment observer. Excluding it BY NAME would
 * read as "this file may hold GHL ids", which is the opposite of true.
 *
 * THE MATCHER IS A SINGLE IMPLEMENTATION. Checks 1-6 and Check 9 both call
 * findIdentifiers(). They are not allowed to diverge: a duplicated regex lets
 * the self-test pass green while the production scanner's pattern is
 * independently broken — two sources of truth for the one thing this file
 * exists to get right, which is the same defect class Gate 4B spent its whole
 * length removing at the identifier level. If you can break the pattern and
 * only Check 9 fails, this file is wrong.
 *
 * FLOOR = 9 IS AUTHORED, not observed. It moves only by deliberate addition or
 * removal with a stated reason, never by back-filling from a run. It is
 * deliberately NOT one-check-per-file: that floor would drift every time anyone
 * added a file and would stop meaning anything.
 *
 * Run:  node scripts/test-identifier-boundary.cjs
 * Exit: 0 green · 1 failures · 2 floor mismatch
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

/** The production runtime boundary. All six must exist; a missing one FAILS. */
const SCAN_DIRS = [
  "app/src",
  "app/netlify",
  "app/shared",
  "netlify/functions",
  "client/src",
  "shared",
];

/** The one place a GHL identifier literal is allowed to live. */
const APPROVED_HOME = "app/shared/ghl-config.ts";

/**
 * Exactly one exclusion. app/src/pages/MaoCalculator.tsx is unrouted, imported
 * by nothing, omitted from the production bundle, and parked Phase 6/7 work.
 * Check 7 pins this list so adding to it is a two-place edit visible in a diff;
 * Check 8 enforces the expiry mechanically rather than by comment.
 */
const EXCLUSIONS = ["app/src/pages/MaoCalculator.tsx"];

const FLOOR = 9;

// ── The matcher. ONE implementation, used by Checks 1-6 AND Check 9. ────────
// Two shapes: a 20-character alphanumeric GHL id, and a canonical lowercase-hex
// UUID. Both must be quoted — an unquoted token is not a literal.
const IDENTIFIER_PATTERN =
  /"[A-Za-z0-9]{20}"|"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g;

/** @param {string} source @returns {string[]} every identifier literal found */
function findIdentifiers(source) {
  return source.match(IDENTIFIER_PATTERN) || [];
}

// ── Harness plumbing ────────────────────────────────────────────────────────

let checksRun = 0;
let failures = 0;

function check(name, ok, detail) {
  checksRun += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

/** Recursive *.ts / *.tsx walk. Returns repo-relative POSIX paths. */
function walk(absDir) {
  const out = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(abs));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Scan one directory; returns { missing, violations: [{file, ids}] }. */
function scanDir(dir) {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return { missing: true, violations: [] };

  const violations = [];
  for (const rel of walk(abs)) {
    if (rel === APPROVED_HOME) continue;
    if (EXCLUSIONS.includes(rel)) continue;
    const ids = findIdentifiers(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
    if (ids.length) violations.push({ file: rel, ids });
  }
  return { missing: false, violations };
}

// ── Checks 1-6: the six scanned directories ─────────────────────────────────

for (const dir of SCAN_DIRS) {
  const { missing, violations } = scanDir(dir);
  if (missing) {
    // A silently-skipped directory is a silently unguarded one.
    check(`no-identifiers-in-${dir}`, false,
      `directory ${dir} does not exist — scope is stale, this is a hard failure`);
    continue;
  }
  const detail = violations.length
    ? violations
        .map((v) => `${v.file} [${v.ids.join(", ")}]`)
        .join(" ; ") +
      ` — move these into ${APPROVED_HOME} rather than excluding the file`
    : `clean — no identifier literal outside ${APPROVED_HOME}`;
  check(`no-identifiers-in-${dir}`, violations.length === 0, detail);
}

// ── Check 7: the exclusion list is exactly what was authored ────────────────
// Not cryptographic. It forces adding an exclusion to be a deliberate
// two-place edit with a reason, because a list that grows silently keeps this
// suite green while its coverage shrinks.

const exclusionsExpected = ["app/src/pages/MaoCalculator.tsx"];
check(
  "exclusion-list-is-exactly-as-authored",
  EXCLUSIONS.length === exclusionsExpected.length &&
    EXCLUSIONS.every((e, i) => e === exclusionsExpected[i]),
  `got [${EXCLUSIONS.join(", ")}] want [${exclusionsExpected.join(", ")}]`,
);

// ── Check 8: the exclusion expires mechanically ─────────────────────────────
// MaoCalculator.tsx is excluded ONLY because it is unreachable. Route it and
// the exclusion is void. Keyed on App.tsx, which is where routing lives in this
// codebase today; a route declared elsewhere evades this, and that limitation
// is accepted deliberately rather than met with a static route analyser for an
// unrouted page. Moving routing elsewhere should trigger revisiting this.

const appTsxRel = "app/src/App.tsx";
const appTsxAbs = path.join(REPO_ROOT, appTsxRel);
const appTsxExists = fs.existsSync(appTsxAbs);
const appTsx = appTsxExists ? fs.readFileSync(appTsxAbs, "utf8") : "";
const maoRouted = !appTsxExists || appTsx.includes("MaoCalculator");
check(
  "mao-calculator-exclusion-not-yet-void",
  !maoRouted,
  maoRouted
    ? (appTsxExists
        ? `EXCLUSION VOID — ${appTsxRel} now references MaoCalculator, so the ` +
          `page is routed and reachable. Its 17 identifier literals must be ` +
          `converted to shared config, or this assertion consciously amended.`
        : `${appTsxRel} not found — the expiry heuristic cannot be evaluated`)
    : `${appTsxRel} does not reference MaoCalculator — page still unrouted`,
);

// ── Check 9: the matcher is proven to DETECT ────────────────────────────────
// A detector with a broken pattern matches nothing and passes every scan
// trivially: a permanently-green check that appears to guard something. These
// fixtures run through the SAME findIdentifiers used above.

const MUST_MATCH = [
  ['"jmHG4B8RdzwpfqruNf68"', "production locationId"],
  ['"0f0511af-2e59-49c9-a141-12a7f1c78914"', "a stage UUID"],
  ['"cfkm0kb9CLvjZgyrcIFz"', "a field id"],
];
const MUST_REJECT = [
  ['"jmHG4B8RdzwpfqruNf6"', "19 chars"],
  ['"jmHG4B8RdzwpfqruNf688"', "21 chars"],
  ['"jmHG4B8Rdz-pfqruNf68"', "20 chars with a hyphen"],
  ['"jmHG4B8Rdz_pfqruNf68"', "20 chars with an underscore"],
  ['"0f0511zz-2e59-49c9-a141-12a7f1c78914"', "UUID shape, non-hex"],
  ['"0f0511af-2e59-49c9-a141-12a7f1c7891"', "UUID shape, short final group"],
  ["jmHG4B8RdzwpfqruNf68", "unquoted"],
];

const missed = MUST_MATCH.filter(([s]) => findIdentifiers(s).length === 0);
const overreached = MUST_REJECT.filter(([s]) => findIdentifiers(s).length > 0);
check(
  "matcher-detects-and-does-not-overreach",
  missed.length === 0 && overreached.length === 0,
  missed.length || overreached.length
    ? `MISSED [${missed.map(([s, w]) => `${s} (${w})`).join(", ")}] ` +
      `OVERREACHED [${overreached.map(([s, w]) => `${s} (${w})`).join(", ")}]`
    : `${MUST_MATCH.length} positives detected, ${MUST_REJECT.length} near-misses rejected`,
);

// ── Floor ───────────────────────────────────────────────────────────────────

console.log(`checksRun=${checksRun} failures=${failures} floor=${FLOOR}`);
if (checksRun !== FLOOR) {
  console.log(`ABORT — expected exactly ${FLOOR} checks, ran ${checksRun}`);
  process.exit(2);
}
if (failures) process.exit(1);
console.log("IDENTIFIER BOUNDARY GREEN");
