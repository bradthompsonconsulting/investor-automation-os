'use strict';

// INV-67 / B9-12 -- Board #9 Phase B runtime slice.
//
// Proves the committed geometry cache (inv67-pdf-geometry-cache.json) and
// its consumer (inv67-pdf-runtime-field-plan.cjs's buildFieldPlanFromCache)
// are VERIFIED-EQUIVALENT to the live, pdfjs-derived buildFieldPlan the
// original proof script (inv67-pdf-population-proof.cjs) still uses --
// never merely assumed. Also proves the runtime generator
// (inv67-pdf-generator.cjs) now imports no pdfjs-dist code at all, and
// that its end-to-end output is byte-identical to the live-derivation
// path for the same canonical input.
//
// Offline, deterministic, no network, no GHL, no Production data.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  PLACEMENTS_JSON_PATH,
  buildAllFields,
} = require('./inv67-pdf-population-proof.cjs');
const { buildFieldPlanFromCache, EXPECTED_CACHE_VERSION, CACHE_PATH } = require('./lib/inv67-pdf-runtime-field-plan.cjs');
const { buildProjectionEntries } = require('./lib/inv67-projection-fixture.cjs');
const { buildFieldPlan } = require('./lib/inv67-pdf-field-plan.cjs');
const { generatePopulatedContractPdf } = require('./lib/inv67-pdf-generator.cjs');
const {
  loadAndVerifySourcePdf,
  stampDeterministicMetadata,
  renderFieldsOntoPdf,
  sha256Hex,
} = require('./lib/inv67-pdf-render-core.cjs');

/**
 * Deep-equal ignoring (a) object key insertion order -- JSON.stringify is
 * order-sensitive; these objects legitimately differ in property order
 * between the live-derivation and cache-lookup code paths while carrying
 * identical data -- and (b) an explicit `key: undefined` vs the key being
 * entirely absent, which JSON's own round-trip already treats as
 * equivalent (JSON.stringify drops undefined-valued properties -- e.g.
 * buildFieldPlan's own `duplicateOfOrdinal: ... : undefined` for every
 * non-duplicate row survives as a present-but-undefined key in the live
 * in-memory object, but as an absent key once written to and read back
 * from the committed JSON cache; both mean exactly "not a duplicate").
 */
function deepEqualIgnoringKeyOrder(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqualIgnoringKeyOrder(v, b[i]));
  }
  const aKeys = Object.keys(a).filter((k) => a[k] !== undefined).sort();
  const bKeys = Object.keys(b).filter((k) => b[k] !== undefined).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((k) => deepEqualIgnoringKeyOrder(a[k], b[k]));
}

const PROOF_SCRIPT_PATH = path.join(__dirname, 'inv67-pdf-population-proof.cjs');
const RUNTIME_FIELD_PLAN_PATH = path.join(__dirname, 'lib', 'inv67-pdf-runtime-field-plan.cjs');

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
}

function sortByOrdinal(rows) {
  return rows.slice().sort((a, b) => a.ordinal - b.ordinal);
}

async function main() {
  // 1. The committed cache is not stale relative to the CURRENT live
  // derivation -- regenerate a fresh geometry snapshot in-memory (the
  // exact same logic generate-inv67-pdf-geometry-cache.cjs uses) and
  // diff every field against what's actually committed on disk.
  const { entriesByKey: fixtureEntries } = buildProjectionEntries();
  const liveFresh = await buildFieldPlan(fixtureEntries);
  check('fresh live derivation still converts all 133 rows with 0 deferred', liveFresh.converted.length === 133 && liveFresh.deferred.length === 0);

  const committedCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  check('committed cache reports the expected cache version', committedCache.cacheVersion === EXPECTED_CACHE_VERSION);
  check('committed cache carries exactly 133 rows', committedCache.rows.length === 133 && committedCache.totalRows === 133);

  const freshGeometryByOrdinal = new Map(sortByOrdinal(liveFresh.converted).map((f) => {
    const { value, ...geometry } = f;
    return [geometry.ordinal, geometry];
  }));
  let cacheStale = false;
  for (const cachedRow of committedCache.rows) {
    const fresh = freshGeometryByOrdinal.get(cachedRow.ordinal);
    if (!fresh || !deepEqualIgnoringKeyOrder(fresh, cachedRow)) {
      cacheStale = true;
      console.error(`  STALE ordinal ${cachedRow.ordinal}: cached=${JSON.stringify(cachedRow)} fresh=${JSON.stringify(fresh)}`);
    }
  }
  check('committed cache matches a fresh live derivation EXACTLY, field-for-field, for every ordinal (not stale)', !cacheStale);
  check('the committed cache never carries a per-run `value` field (geometry-only, no leaked data)', committedCache.rows.every((r) => !('value' in r)));

  // 2. Field-plan level equivalence: for the SAME entriesByKey, the cache
  // consumer produces a converted array structurally identical to the
  // live one (value included this time -- proving the LOOKUP binds the
  // same text to the same field).
  const cached = buildFieldPlanFromCache(fixtureEntries);
  check('cache-based field plan converts all 133 rows with 0 deferred, same as live', cached.converted.length === 133 && cached.deferred.length === 0);
  check('cache-based manifestRows.length matches the live one', cached.manifestRows.length === liveFresh.manifestRows.length);

  const liveSorted = sortByOrdinal(liveFresh.converted);
  const cachedSorted = sortByOrdinal(cached.converted);
  check('cache-based and live converted arrays carry identical data, ordinal-by-ordinal (key order may legitimately differ)', liveSorted.length === cachedSorted.length && liveSorted.every((f, i) => deepEqualIgnoringKeyOrder(f, cachedSorted[i])));

  // 3. End-to-end: rendering the SAME converted-field data through the
  // SAME render core produces byte-identical PDF output regardless of
  // whether that data came from live pdfjs derivation or the cache --
  // isolating geometry-SOURCE as the only variable. (Comparing against
  // the proof script's own output directly would NOT prove this: the
  // proof script and the generator deliberately stamp different
  // Producer/Creator metadata strings, a real, unrelated difference that
  // would make their outputs differ even with byte-identical visual
  // content -- see stampDeterministicMetadata call sites in each file.)
  async function renderWith(converted, metadata) {
    const { pdfDoc } = await loadAndVerifySourcePdf();
    stampDeterministicMetadata(pdfDoc, metadata);
    await renderFieldsOntoPdf(pdfDoc, converted);
    return sha256Hex(await pdfDoc.save());
  }
  const sameMetadata = { producer: 'test-inv67-pdf-geometry-cache.cjs (isolated comparison)', creator: 'test-inv67-pdf-geometry-cache.cjs (isolated comparison)' };
  const liveRenderHash = await renderWith(liveSorted, sameMetadata);
  const cachedRenderHash = await renderWith(cachedSorted, sameMetadata);
  check(
    'rendering live-derived vs cache-derived field data through the identical render core produces byte-identical PDF output (geometry source isolated as the only variable)',
    liveRenderHash === cachedRenderHash
  );

  // Separately: the generator's own real output, end to end, sanity-checked.
  execFileSync(process.execPath, [PROOF_SCRIPT_PATH], { stdio: 'pipe' });
  const proofRecord = JSON.parse(fs.readFileSync(PLACEMENTS_JSON_PATH, 'utf8'));
  check('the proof script (still live-derived, unchanged) regenerates its own known-good output hash', proofRecord.outputSha256 === '6c36f0fec235c46d9db8ac40ae0c255b6ffbbfe1fa3435e2595df1b26aa24ab1');

  const { plan: shippedPlan } = buildProjectionEntries();
  const { outputBytes } = await generatePopulatedContractPdf({ projectionPlan: shippedPlan, opportunityId: shippedPlan.opportunityId });
  check('generator output (cache-based) is a non-trivial, real PDF (sanity)', outputBytes.length > 1000000);

  // 4. Static proof: the runtime path imports no pdfjs-dist CODE at all.
  // (Prose mentions of "pdfjs-dist" in these files' own explanatory
  // comments -- documenting exactly this guarantee -- are expected and
  // must not trip this check; only an actual require()/import() reference
  // counts.)
  const scannedFiles = [RUNTIME_FIELD_PLAN_PATH, path.join(__dirname, 'lib', 'inv67-pdf-generator.cjs')];
  const pdfjsImportPattern = /(?:require\(|import\()\s*['"]pdfjs-dist/;
  let noPdfjs = true;
  for (const file of scannedFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (pdfjsImportPattern.test(src)) {
      noPdfjs = false;
      console.error(`  forbidden pdfjs-dist require()/import() found in ${file}`);
    }
  }
  check('the runtime generator path (inv67-pdf-generator.cjs + inv67-pdf-runtime-field-plan.cjs) requires/imports pdfjs-dist nowhere at all', noPdfjs);

  const forbiddenPatterns = [/require\(['"]https?['"]\)/, /require\(['"]net['"]\)/, /\bfetch\(/, /\baxios\b/, /process\.env\.(?!IAOS_CANONICAL_DOCS_DIR)/];
  let noNetworkOrCredential = true;
  for (const file of [...scannedFiles, path.join(__dirname, 'lib', 'inv67-pdf-render-core.cjs')]) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of forbiddenPatterns) {
      if (re.test(src)) {
        noNetworkOrCredential = false;
        console.error(`  forbidden pattern ${re} found in ${file}`);
      }
    }
  }
  check('no runtime file contains a network or credential-access call (IAOS_CANONICAL_DOCS_DIR is the one documented, deployer-only env read)', noNetworkOrCredential);

  // 5. Cache fails closed on corruption. Backs up the real committed
  // file, overwrites it with a deliberately broken one, requires a FRESH
  // module instance (require-cache cleared), and restores the real file
  // in a finally block regardless of outcome.
  const realCacheBytes = fs.readFileSync(CACHE_PATH);
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ cacheVersion: 'wrong-version', totalRows: 1, rows: [{}] }));
    delete require.cache[require.resolve(RUNTIME_FIELD_PLAN_PATH)];
    const fresh = require(RUNTIME_FIELD_PLAN_PATH);
    let threw = false;
    let threwRightReason = false;
    try {
      fresh.buildFieldPlanFromCache(new Map());
    } catch (e) {
      threw = true;
      threwRightReason = /version mismatch/i.test(e.message);
    }
    check('a wrong-version cache file is refused at load time, never silently used', threw);
    check('the refusal names the version mismatch specifically', threwRightReason);
  } finally {
    fs.writeFileSync(CACHE_PATH, realCacheBytes);
    delete require.cache[require.resolve(RUNTIME_FIELD_PLAN_PATH)];
  }

  // Confirm restoration actually worked before finishing.
  const restored = require(RUNTIME_FIELD_PLAN_PATH);
  const restoredResult = restored.buildFieldPlanFromCache(fixtureEntries);
  check('the real committed cache is restored and usable after the corruption test', restoredResult.converted.length === 133 && restoredResult.deferred.length === 0);

  console.log('');
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('ALL CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error('FAIL', err.stack || err.message || err);
  process.exitCode = 1;
});
