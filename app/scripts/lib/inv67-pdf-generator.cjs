'use strict';

// INV-67 / B9-12 -- Board #9 live-data PDF generation, PHASE A.
//
// Production-capable generator: given a REAL `ContractProjectionPlan` (the
// exact object `buildContractProjectionPlan(opportunityId, preview, report,
// sellerReadiness)` -- contract-ghl-projection-model.ts -- returns for an
// actual opportunity's canonical contract facts), produces the populated
// TREC 20-19 PDF at the same proven PDF-space coordinates the INV-67
// PDF-placement proof (inv67-pdf-population-proof.cjs, 133/133, 0 deferred)
// already established, and binds the output to fail-closed evidence.
//
// REUSE, NEVER REIMPLEMENTATION:
//   - buildFieldPlan / ROW_DERIVATIONS (inv67-pdf-field-plan.cjs) -- the ONE
//     133-key manifest-row -> PDF-coordinate map. Not duplicated here; this
//     file only supplies that function's one input (entriesByKey) from a
//     real plan instead of the synthetic fixture.
//   - loadAndVerifySourcePdf / stampDeterministicMetadata /
//     renderFieldsOntoPdf / validatePlacementGeometry /
//     validateDuplicateConsistency / validateNoSignerControlledFields
//     (inv67-pdf-render-core.cjs) -- extracted from the original proof
//     script so both it and this generator draw/validate identically.
//
// WHAT'S DIFFERENT FROM THE PROOF SCRIPT, DELIBERATELY:
//   - Input is a caller-supplied real ContractProjectionPlan, never the
//     synthetic fixture (inv67-projection-fixture.cjs is not imported here
//     at all).
//   - FAILS CLOSED on ANY deferred row, and on plan.ok !== true. The proof
//     script's job was to report accounting including any deferred rows;
//     THIS generator's job is to produce an actual contract artifact for
//     real use, so an incomplete population is refused outright rather than
//     silently reported and continued past -- "zero-deferred" is an
//     enforced precondition here, not just an observed count.
//   - Returns bytes + an evidence record to the caller; performs no file
//     I/O itself (no OUTPUT_DIR, no fixed output path) -- a future caller
//     (server function, CLI, test) decides where/whether to persist.
//
// OUT OF SCOPE (Phase A, per Board #9 architecture ruling, 2026-09-18):
// no UI wiring, no ContractWorkspace edits, no GHL calls, no Netlify
// deployment, no Production data, no GHL mutation, no contract send, no
// authorization-state mutation. This module is pure: it takes an
// already-computed projection plan in memory and returns PDF bytes + an
// evidence record. It does not fetch, authorize, send, or persist anything.

const { buildFieldPlan } = require('./inv67-pdf-field-plan.cjs');
const {
  PINNED_SOURCE_SHA256,
  EXPECTED_SOURCE_PAGE_COUNT,
  MANIFEST_VERSION,
  sha256Hex,
  validatePlacementGeometry,
  validateDuplicateConsistency,
  validateNoSignerControlledFields,
  loadAndVerifySourcePdf,
  stampDeterministicMetadata,
  renderFieldsOntoPdf,
} = require('./inv67-pdf-render-core.cjs');

// Bump when ROW_DERIVATIONS, the render core, or this module's own contract
// changes in a way that could change generated output for the same input.
const GENERATOR_VERSION = 'inv67-pdf-generator-v1';

class ContractPdfGenerationError extends Error {
  constructor(message, reasons) {
    super(message);
    this.name = 'ContractPdfGenerationError';
    this.reasons = reasons || [];
  }
}

/**
 * Fails closed unless `projectionPlan` is a real, complete
 * ContractProjectionPlan: `ok: true` and a non-empty `entries` array of
 * `{key, text}` pairs. Never accepts a caller-supplied entriesByKey Map
 * directly -- the plan's own `ok`/`blockingReasons` are the ONLY accepted
 * evidence that the canonical facts behind it are actually complete
 * (contract-ghl-projection-model.ts's own "builds no partial plan" rule).
 */
function requireCompleteProjectionPlan(projectionPlan) {
  if (!projectionPlan || typeof projectionPlan !== 'object') {
    throw new ContractPdfGenerationError('projectionPlan is required.');
  }
  if (projectionPlan.ok !== true) {
    throw new ContractPdfGenerationError(
      'Cannot generate: projection plan is not complete.',
      Array.isArray(projectionPlan.blockingReasons) ? projectionPlan.blockingReasons : []
    );
  }
  if (!Array.isArray(projectionPlan.entries) || projectionPlan.entries.length === 0) {
    throw new ContractPdfGenerationError('Cannot generate: projection plan carries no entries.');
  }
  for (const entry of projectionPlan.entries) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.text !== 'string') {
      throw new ContractPdfGenerationError('Cannot generate: a projection plan entry is malformed (expected {key, text}).');
    }
  }
}

/**
 * Given a real ContractProjectionPlan, produces the populated TREC 20-19
 * PDF and its evidence record. Fails closed (throws ContractPdfGenerationError
 * or the underlying validation error) rather than returning a partial or
 * unverified artifact -- never guesses, never substitutes, never continues
 * past an incomplete population.
 *
 * @param {object} args
 * @param {{ok: boolean, entries: {key: string, text: string}[], opportunityId?: string, version?: unknown, blockingReasons?: unknown[]}} args.projectionPlan
 *   The real output of contract-ghl-projection-model.ts's buildContractProjectionPlan
 *   for an actual opportunity's canonical contract facts. NEVER the synthetic
 *   fixture -- this module never imports inv67-projection-fixture.cjs.
 * @param {string} [args.opportunityId] Overrides projectionPlan.opportunityId
 *   in the returned evidence record, if the caller tracks it separately.
 * @param {{sourcePdfPath?: string, expectedSha256?: string, expectedPageCount?: number}} [args.source]
 *   Overrides for the canonical source PDF location/hash/page-count --
 *   defaults to the same pinned TREC 20-19 constants the proof uses.
 * @returns {Promise<{outputBytes: Uint8Array, evidence: object}>}
 */
async function generatePopulatedContractPdf(args) {
  const { projectionPlan, opportunityId, source } = args || {};

  requireCompleteProjectionPlan(projectionPlan);
  const entriesByKey = new Map(projectionPlan.entries.map((e) => [e.key, e.text]));

  // REUSED, unmodified -- the one 133-key manifest-row -> PDF-coordinate map.
  const { converted, deferred, manifestRows } = await buildFieldPlan(entriesByKey);

  if (deferred.length > 0) {
    throw new ContractPdfGenerationError(
      `Cannot generate: ${deferred.length} of ${manifestRows.length} manifest row(s) deferred -- zero-deferred is required for a live contract artifact.`,
      deferred
    );
  }
  if (converted.length !== manifestRows.length) {
    throw new ContractPdfGenerationError(
      `Cannot generate: expected all ${manifestRows.length} manifest rows converted, got ${converted.length}.`
    );
  }

  validatePlacementGeometry(converted);
  validateDuplicateConsistency(converted);
  validateNoSignerControlledFields(converted);

  const { sourceBytes, sourceSha256, pdfDoc, sourcePageCount } = await loadAndVerifySourcePdf({
    sourcePdfPath: source && source.sourcePdfPath,
    expectedSha256: (source && source.expectedSha256) || PINNED_SOURCE_SHA256,
    expectedPageCount: (source && source.expectedPageCount) || EXPECTED_SOURCE_PAGE_COUNT,
  });
  void sourceBytes; // read only to hash/verify; the loaded pdfDoc is what gets populated

  stampDeterministicMetadata(pdfDoc, {
    producer: 'IAOS Board #9 live contract generator (pdf-lib)',
    creator: 'IAOS Board #9 live contract generator (pdf-lib)',
  });

  const drawnFields = await renderFieldsOntoPdf(pdfDoc, converted);

  const outputBytes = await pdfDoc.save();
  const outputSha256 = sha256Hex(outputBytes);

  const evidence = {
    generatedBy: 'app/scripts/lib/inv67-pdf-generator.cjs',
    generatorVersion: GENERATOR_VERSION,
    manifestVersion: MANIFEST_VERSION,
    opportunityId: opportunityId || projectionPlan.opportunityId || null,
    projectionVersion: projectionPlan.version !== undefined ? projectionPlan.version : null,
    generatedAt: new Date().toISOString(),
    sourcePdfPath: (source && source.sourcePdfPath) || 'docs/TREC Resale Home Contract.pdf',
    sourceSha256,
    sourcePageCount,
    outputSha256,
    outputByteLength: outputBytes.length,
    manifestTotals: {
      totalRows: manifestRows.length,
      convertedCount: drawnFields.length,
      deferredCount: deferred.length,
    },
    fields: drawnFields,
  };

  return { outputBytes, evidence };
}

module.exports = {
  GENERATOR_VERSION,
  ContractPdfGenerationError,
  requireCompleteProjectionPlan,
  generatePopulatedContractPdf,
};
