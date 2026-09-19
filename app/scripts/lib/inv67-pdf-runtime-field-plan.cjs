'use strict';

// INV-67 / B9-12 -- Board #9 Phase B runtime slice.
//
// buildFieldPlanFromCache(entriesByKey) is a DROP-IN alternative to
// inv67-pdf-field-plan.cjs's buildFieldPlan(entriesByKey) -- same input
// shape, same output shape ({converted, deferred, manifestRows}) -- that
// looks geometry up from the precomputed, committed
// inv67-pdf-geometry-cache.json instead of deriving it live via
// pdfjs-dist. See generate-inv67-pdf-geometry-cache.cjs's own header for
// why this is safe: geometry depends only on the pinned, immutable source
// PDF, never on entriesByKey's values.
//
// NOT A REIMPLEMENTATION of ROW_DERIVATIONS or any derivation strategy --
// this file contains no PDF-coordinate logic of its own at all. It is
// pure lookup/binding: for each cached row, resolve its value from
// entriesByKey (or defer, exactly like buildFieldPlan does), and produce
// the identical converted-entry shape. test-inv67-pdf-geometry-cache.cjs
// proves this produces byte-identical output to the live, pdfjs-derived
// buildFieldPlan for the same input -- this module is never the ONLY
// evidence of correctness, only a verified-equivalent runtime shortcut.
//
// No pdfjs-dist import anywhere in this file -- verified by
// test-inv67-pdf-geometry-cache.cjs's own static source scan. No GHL call,
// no network call, no Production data.
//
// LOADED VIA A LITERAL require('./inv67-pdf-geometry-cache.json'), NOT
// fs.readFileSync AND NOT a computed path passed to require() -- Board #9
// Phase B packaging finding: esbuild (and Netlify's own zip-it-and-ship-it,
// confirmed to use esbuild under the hood) only statically inlines a
// require() target it can analyze at BUILD time, which means the argument
// MUST be a literal string right at the call site -- require(CACHE_PATH)
// with CACHE_PATH as a computed variable is treated as a genuinely dynamic
// require and left as a RUNTIME file lookup instead (reproduced directly:
// an earlier pass of this file did exactly that and failed post-bundle
// with "Cannot find module ... inv67-pdf-geometry-cache.json", the same
// class of failure as the __dirname issue, just for require() instead of
// fs). With the literal, esbuild inlines the JSON directly into the
// bundle -- the geometry cache carries NO __dirname-relative runtime file
// read at all once bundled. `CACHE_PATH` (computed, absolute) is kept
// only so a caller/test can locate the real on-disk file for its own
// purposes (e.g. proving cache freshness) -- it is never itself passed to
// require().

const path = require('path');

const CACHE_PATH = path.join(__dirname, 'inv67-pdf-geometry-cache.json');
const EXPECTED_CACHE_VERSION = 'inv67-pdf-geometry-cache-v1';

let cachedGeometry = null;
function loadGeometryCache() {
  if (cachedGeometry) return cachedGeometry;
  // Absolute (CACHE_PATH) and the literal below resolve to the identical
  // require-cache key -- clearing via the absolute path (as a test that
  // overwrote the on-disk file between runs would) still busts the
  // literal require's cached result.
  delete require.cache[CACHE_PATH];
  const parsed = require('./inv67-pdf-geometry-cache.json');
  if (parsed.cacheVersion !== EXPECTED_CACHE_VERSION) {
    throw new Error(`Geometry cache version mismatch -- expected ${EXPECTED_CACHE_VERSION}, got ${parsed.cacheVersion}. Re-run generate-inv67-pdf-geometry-cache.cjs.`);
  }
  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0 || parsed.rows.length !== parsed.totalRows) {
    throw new Error('Geometry cache is malformed or empty -- refusing to use a partial/corrupt cache.');
  }
  cachedGeometry = parsed;
  return parsed;
}

/**
 * Same contract as inv67-pdf-field-plan.cjs's buildFieldPlan: given
 * entriesByKey (Map<string, string>), returns
 * { converted, deferred, manifestRows } -- `manifestRows` here is a
 * minimal stand-in carrying only `.length` (the one property every
 * caller of buildFieldPlan's result actually reads), since this module
 * never parses the manifest markdown doc at all.
 */
function buildFieldPlanFromCache(entriesByKey) {
  const cache = loadGeometryCache();
  const converted = [];
  const deferred = [];

  for (const row of cache.rows) {
    const text = entriesByKey.get(row.fieldKey);
    if (text === undefined) {
      deferred.push({ ordinal: row.ordinal, key: row.fieldKey, reason: `no projection-plan entry for key "${row.fieldKey}"` });
      continue;
    }
    converted.push({ ...row, value: text });
  }

  const manifestRows = { length: cache.totalRows };
  return { converted, deferred, manifestRows };
}

module.exports = { buildFieldPlanFromCache, EXPECTED_CACHE_VERSION, CACHE_PATH };
