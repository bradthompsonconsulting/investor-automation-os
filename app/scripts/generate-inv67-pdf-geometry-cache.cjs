'use strict';

// INV-67 / B9-12 -- Board #9 Phase B runtime slice. DEV-TIME ONLY generator
// for scripts/lib/inv67-pdf-geometry-cache.json.
//
// WHY THIS EXISTS: inv67-pdf-field-plan.cjs's buildFieldPlan(entriesByKey)
// derives each field's PDF-space geometry (x/y/width/height/font/...) via
// pdfjs-dist text-item extraction against the pinned source PDF -- but that
// geometry depends ONLY on the pinned, hash-verified, immutable source PDF
// (docs/TREC Resale Home Contract.pdf), never on the entriesByKey VALUES
// being placed. Since the source is pinned, the geometry is the SAME every
// single run -- deriving it live via pdfjs on every server-runtime
// generation call is unnecessary work, and (per the Phase B packaging
// proof) pdfjs-dist's own worker file is a real, fragile runtime-bundling
// dependency. Precomputing it ONCE, here, at dev time, and shipping the
// result as a committed data file, lets the runtime generator
// (inv67-pdf-runtime-field-plan.cjs) look geometry up instead of
// re-deriving it -- eliminating pdfjs-dist/pdf.worker.mjs from the runtime
// dependency graph entirely, "only where actually required" (dev-time
// cache generation), never at request time.
//
// REUSE, NEVER REIMPLEMENTATION: calls the SAME buildFieldPlan
// (inv67-pdf-field-plan.cjs, unmodified) the original proof script and
// live generator already use, fed by the SAME real projection model via
// the SAME synthetic-fixture technique inv67-pdf-population-proof.cjs
// already established (buildProjectionEntries(), zero-arg, unmodified) --
// this script asserts nothing new about HOW geometry is derived, it only
// snapshots buildFieldPlan's own already-proven output (133/133,
// 0 deferred) once, stripping out the per-run VALUE (which differs by
// opportunity) and keeping everything else (which never does).
//
// CACHE INVALIDATION IS MANUAL AND DELIBERATE: if ROW_DERIVATIONS
// (inv67-pdf-field-plan.cjs), the manifest doc, or the pinned source PDF
// ever change, this script must be re-run and its output re-committed.
// inv67-pdf-generator.cjs's own tests independently prove the cache still
// matches a fresh LIVE derivation (test-inv67-pdf-geometry-cache.cjs) --
// a silently stale cache is a test failure, never a silent drift.
//
// No GHL call, no network call, no Production data.

const fs = require('fs');
const path = require('path');
const { buildProjectionEntries } = require('./lib/inv67-projection-fixture.cjs');
const { buildFieldPlan } = require('./lib/inv67-pdf-field-plan.cjs');

const OUTPUT_PATH = path.join(__dirname, 'lib', 'inv67-pdf-geometry-cache.json');

async function main() {
  const { entriesByKey } = buildProjectionEntries();
  const { converted, deferred, manifestRows } = await buildFieldPlan(entriesByKey);

  if (deferred.length > 0) {
    throw new Error(`ABORT: ${deferred.length} row(s) deferred against the current live derivation -- cannot cache an incomplete geometry plan. ${JSON.stringify(deferred)}`);
  }
  if (converted.length !== manifestRows.length) {
    throw new Error(`ABORT: expected all ${manifestRows.length} manifest rows converted, got ${converted.length}.`);
  }

  // Strip `value` (per-run data, never cached) and `resolvedDrawX`/
  // `resolvedTextWidthPt` (not present here -- those are added later, by
  // renderFieldsOntoPdf, never by buildFieldPlan itself) -- keep every
  // other field verbatim, in ordinal order.
  const rows = converted
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(({ value, ...geometry }) => geometry);

  const cache = {
    cacheVersion: 'inv67-pdf-geometry-cache-v1',
    generatedBy: 'app/scripts/generate-inv67-pdf-geometry-cache.cjs',
    totalRows: manifestRows.length,
    rows,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cache, null, 2) + '\n');
  console.log(`PASS wrote ${OUTPUT_PATH} (${rows.length} rows, 0 deferred)`);
}

main().catch((err) => {
  console.error('FAIL', err.stack || err.message || err);
  process.exitCode = 1;
});
