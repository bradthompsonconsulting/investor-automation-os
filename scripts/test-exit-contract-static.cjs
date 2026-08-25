"use strict";
/**
 * EXIT CONTRACT — STATIC HALF.  Gate 4C C4a closure debt 3, Jess step 5.
 *
 * Asserts two properties over EVERY exit site in the proof-harness corpus,
 * including the 231 direct process.exit(N) sites that no runtime corpus can
 * reach — a single run observes exactly one exit, so only static analysis
 * covers the population.
 *
 *   PROPERTY B  a refusal's emitted text uniquely identifies its cause
 *   PROPERTY A  where the wrapper already holds the code, the code is printed
 *
 * ── ASSERT THE PROPERTY, NOT THE PAYLOAD ────────────────────────────────────
 * This file must never store an expected message string. Rewording a cause is
 * a legitimate improvement and MUST pass; making two causes indistinguishable
 * is a regression and MUST fail. Every comparison below is therefore between
 * sites, never against a literal. A test that breaks whenever someone improves
 * wording gets deleted within a month, and then nothing guards this at all.
 *
 * ── COMPOSITION, AND WHY THERE IS NO EXEMPTION LIST ─────────────────────────
 * Uniqueness is judged on what the OPERATOR reads, which is the caller's line
 * composed with the emitter's line — not on either fragment alone. The runner
 * calls finish() with the same caller text in both of its phases; those pairs
 * are disambiguated at the emitter by outcome and code, which is where commit 1
 * deliberately fixed them. An instrument reading only the caller reports 12
 * false duplicates and is measuring the layer below the fix.
 *
 * Nothing is excluded by name. app/src/pages/MaoCalculator.tsx sits in another
 * test's exclusion list and is a standing exposure precisely because of it;
 * this file does not create a second instance of that pattern.
 *
 * Composition is resolvable without running anything: all 27 finish() call
 * sites pass a string literal and a number literal. If a call site ever passes
 * a computed argument, check 7 fails rather than silently skipping it.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

/** The proof-harness corpus. Every file that owns an exit site. */
const CORPUS = [
  ...["closing-costs", "endbuyer-max", "mao-a0", "mode-a", "payload-b"].flatMap((fam) =>
    [1, 2, 3, 4, 5].map((n) => `app/scripts/inert-proof-opp-${fam}-step${n}.cjs`),
  ),
  "app/scripts/inert-proof-runner.cjs",
  "app/scripts/evidence-provenance.cjs",
  "app/scripts/inert-proof-arv.cjs",
  "app/scripts/inert-proof-property-notes.cjs",
  "app/scripts/ghl-config-loader.cjs",
  "scripts/rescore-all.ts",
  "scripts/import-propstream-csv.ts",
];

const FLOOR = 9;

let checksRun = 0;
let failures = 0;
function check(name, ok, detail) {
  checksRun++;
  if (ok) {
    console.log(`PASS  ${name}  ${detail}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

/** Blank out comments so a commented-out exit is not counted as one. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Read a balanced (...) from `from`, across lines, quote- and nest-aware. */
function balanced(src, from) {
  let depth = 1, quote = null, esc = false, out = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (c === "(") depth++;
    if (c === ")") { depth--; if (depth === 0) break; }
    out += c;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Normalise a message for COMPARISON ONLY. Interpolations collapse to a
 * placeholder so that two sites differing only in runtime data are recognised
 * as the same cause, and one site is not seen as "changed" merely because its
 * data changed.
 */
function normalise(text) {
  return text
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/["'`+]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Gather every exit site, with the text an operator would actually read ────

/** @typedef {{file:string,line:number,mech:string,code:number,composed:string}} Site */

const sites = [];
const wrapperImpls = new Map();
const finishImpls = [];
const nonLiteralFinish = [];
const missingFiles = [];

for (const rel of CORPUS) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) { missingFiles.push(rel); continue; }
  const src = strip(fs.readFileSync(abs, "utf8"));
  const lineOf = (off) => src.slice(0, off).split(/\r?\n/).length;

  // fail() wrapper definition, if this file has one
  const wrapper = /function\s+fail\s*\(([^)]*)\)\s*\{([\s\S]{0,300}?)\n\}/.exec(src);
  if (wrapper) {
    const key = `fail(${wrapper[1].replace(/\s+/g, " ").trim()}) || ${wrapper[2].replace(/\s+/g, " ").trim()}`;
    if (!wrapperImpls.has(key)) wrapperImpls.set(key, []);
    wrapperImpls.get(key).push(rel);
  }

  // finish() emitter definitions, if any
  let fd;
  const reFinishDef = /const\s+finish\s*=\s*\(([^)]*)\)\s*=>\s*\{([\s\S]{0,300}?)\n\s*\};/g;
  while ((fd = reFinishDef.exec(src))) {
    finishImpls.push({ file: rel, line: lineOf(fd.index), params: fd[1], body: fd[2].replace(/\s+/g, " ").trim() });
  }

  // Every console.* call, with its full balanced argument
  const consoles = [];
  let cm;
  const reConsole = /console\.(?:error|log|warn)\(/g;
  while ((cm = reConsole.exec(src))) {
    consoles.push({ at: cm.index, line: lineOf(cm.index), text: balanced(src, cm.index + cm[0].length) });
  }
  /** the contiguous console block an operator sees before an exit at `at` */
  const blockBefore = (at, line) =>
    consoles.filter((c) => c.at < at && line - c.line <= 8).map((c) => c.text).join(" ");

  // fail(code, msg, ...) — composed as the wrapper renders it
  let m;
  const reFail = /\bfail\(\s*(\d+)\s*,/g;
  while ((m = reFail.exec(src))) {
    const code = Number(m[1]);
    const msg = balanced(src, m.index + m[0].length).split(/,(?![^{[(]*[)}\]])/)[0];
    sites.push({
      file: rel, line: lineOf(m.index), mech: "fail()", code,
      composed: `ABORT [refusal ${code}] — ${msg}`,
    });
  }

  // finish(outcome, code) — composed as CALLER text + EMITTER line
  const reFinish = /\bfinish\(\s*([^,]*),\s*([^)]*)\)/g;
  while ((m = reFinish.exec(src))) {
    const rawOutcome = m[1].trim();
    const rawCode = m[2].trim();
    const literal = /^"[a-z_]+"$/.test(rawOutcome) && /^\d+$/.test(rawCode);
    if (!literal) {
      nonLiteralFinish.push(`${rel}:${lineOf(m.index)} finish(${rawOutcome}, ${rawCode})`);
      continue;
    }
    const code = Number(rawCode);
    const outcome = rawOutcome.slice(1, -1);
    const line = lineOf(m.index);
    const emitter = `outcome ${outcome} — ${code === 0 ? "complete" : `refusal ${code}`}; evidence written \${outPath}`;
    sites.push({
      file: rel, line, mech: "finish()", code,
      composed: `${blockBefore(m.index, line)} ${emitter}`,
    });
  }

  /* Constants bound to a numeric literal, so process.exit(REFUSAL) and
     process.exit(PROVENANCE_REFUSAL) are resolved rather than skipped. A
     literal-only matcher is blind to exactly the ten refusal exits that the
     ternary rewrite introduced, which is the population this test exists to
     watch. Resolve the name or the site is invisible. */
  const constNums = new Map();
  let cn;
  const reConstNum = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*;/g;
  while ((cn = reConstNum.exec(src))) constNums.set(cn[1], Number(cn[2]));

  // direct process.exit(N) and ternary branches — composed from the console block
  const reExit = /process\.exit\(([^)]*)\)/g;
  while ((m = reExit.exec(src))) {
    const arg = m[1].trim();
    const line = lineOf(m.index);
    if (/^\d+$/.test(arg)) {
      sites.push({ file: rel, line, mech: "direct", code: Number(arg), composed: blockBefore(m.index, line) });
    } else if (constNums.has(arg)) {
      sites.push({ file: rel, line, mech: "direct-const", code: constNums.get(arg), composed: blockBefore(m.index, line) });
    } else if (arg.includes("?")) {
      const branch = arg.slice(arg.indexOf("?") + 1);
      let bm;
      const reNum = /\b(\d+)\b/g;
      while ((bm = reNum.exec(branch))) {
        sites.push({ file: rel, line, mech: "ternary", code: Number(bm[1]), composed: blockBefore(m.index, line) });
      }
    }
  }
}

// ── The checks ──────────────────────────────────────────────────────────────

check(
  "corpus-present",
  missingFiles.length === 0 && sites.length > 600,
  missingFiles.length ? `missing ${missingFiles.join(", ")}` : `${CORPUS.length} files, ${sites.length} exit sites`,
);

check(
  "one-fail-implementation",
  wrapperImpls.size === 1,
  `${wrapperImpls.size} distinct fail() body across ${[...wrapperImpls.values()].flat().length} files — a fork would split diagnostics`,
);

const failTemplateOk = [...wrapperImpls.keys()].every((k) => /console\.error\(`[^`]*\$\{code\}/.test(k));
check(
  "PROPERTY A — fail() prints its declared code",
  failTemplateOk,
  failTemplateOk ? "every fail() wrapper interpolates ${code}" : "a fail() wrapper does not print ${code}",
);

check(
  "two-finish-emitters",
  finishImpls.length === 2,
  `${finishImpls.length} finish() definitions in inert-proof-runner.cjs`,
);

const finishOk = finishImpls.every((f) => /\$\{outcome\}/.test(f.body) && /\$\{code\}/.test(f.body));
check(
  "PROPERTY A — finish() prints outcome and code",
  finishOk,
  finishOk ? "both emitters interpolate ${outcome} and ${code}" : "a finish() emitter omits ${outcome} or ${code}",
);

// finish() must not claim a refusal on the success path
const finishGuarded = finishImpls.every((f) => /code\s*===\s*0/.test(f.body));
check(
  "finish() does not claim a refusal at code 0",
  finishGuarded,
  finishGuarded
    ? "both emitters branch on code === 0 — finish() serves success paths too"
    : "an emitter would print a refusal on a passing run",
);

check(
  "finish-args-are-literal",
  nonLiteralFinish.length === 0,
  nonLiteralFinish.length
    ? `composition unresolvable at ${nonLiteralFinish.join("; ")}`
    : `all ${sites.filter((s) => s.mech === "finish()").length} finish() call sites pass literals`,
);

/*
 * PROPERTY B, IN TWO PARTS — because one check cannot carry both meanings and
 * a control proved it. Composition includes the refusal code, and commit 1 put
 * a DISTINCT code in every fail() line, so a composed-uniqueness check is
 * satisfied trivially at all 412 fail() sites and can never fail. A planted
 * duplicate cause passed it. That is a vacuous assertion, which is worse than
 * no assertion because it reads as coverage.
 *
 * The two meanings, separated:
 *
 *   B1  CAUSE distinguishability. The human-facing property. Judged on the
 *       fail() message ALONE, with the code excluded, so rewording still
 *       passes but two causes becoming identical fails. This is the check the
 *       control fires on.
 *
 *   B2  OPERATOR-LINE distinguishability. Judged on the full composed line,
 *       code included, over every mechanism. Catches direct and finish() sites
 *       that read the same even with their codes — the runner's two phases are
 *       disambiguated here by outcome and code, which is where commit 1 fixed
 *       them and is why composition is right for this half.
 *
 * Success exits (code 0) are out of scope for both: ruled 2026-08-24, a success
 * exit is not a refusal, and 723 counted exit sites rather than refusals.
 */
function collide(subset, keyOf) {
  const byFile = new Map();
  for (const s of subset) {
    if (s.code === 0) continue;
    const key = keyOf(s);
    if (key === "") continue; // silent sites are not this check's business
    if (!byFile.has(s.file)) byFile.set(s.file, new Map());
    const seen = byFile.get(s.file);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(s.line);
  }
  const out = [];
  for (const [file, seen] of byFile) {
    for (const [, lines] of seen) if (lines.length > 1) out.push(`${file} L${lines.join("/L")}`);
  }
  return out;
}

const failSites = sites.filter((s) => s.mech === "fail()");
const b1 = collide(failSites, (s) => normalise(s.composed.replace(/^ABORT \[refusal \d+\] — /, "")));
check(
  "PROPERTY B1 — every fail() CAUSE is distinguishable, code excluded",
  b1.length === 0,
  b1.length
    ? `same cause at: ${b1.slice(0, 6).join(", ")}${b1.length > 6 ? ` +${b1.length - 6}` : ""}`
    : `${failSites.filter((s) => s.code !== 0).length} fail() causes, 0 collisions`,
);

const b2 = collide(sites, (s) => normalise(s.composed));
const refusalCount = sites.filter((s) => s.code !== 0).length;
check(
  "PROPERTY B2 — every refusal's operator line is distinguishable",
  b2.length === 0,
  b2.length
    ? `identical lines at: ${b2.slice(0, 6).join(", ")}${b2.length > 6 ? ` +${b2.length - 6}` : ""}`
    : `${refusalCount} refusal sites, 0 collisions`,
);

console.log(`checksRun=${checksRun} failures=${failures} floor=${FLOOR}`);
if (checksRun < FLOOR) {
  console.log(`EXIT CONTRACT STATIC — FLOOR BREACHED: ran ${checksRun}, floor ${FLOOR}. An assertion was removed.`);
  process.exit(1);
}
if (failures > 0) {
  console.log("EXIT CONTRACT STATIC RED");
  process.exit(1);
}
console.log("EXIT CONTRACT STATIC GREEN");
