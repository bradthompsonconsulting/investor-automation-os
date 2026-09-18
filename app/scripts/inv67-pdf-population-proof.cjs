'use strict';

// INV-67 / B9-12 -- IAOS-generated TREC PDF population proof, PHASE A
// expansion. Populates every deterministic (Class: Ready, or already
// hand-verified in PR #75) manifest row it can derive and validate without
// subjective visual judgment, onto the ORIGINAL TREC 20-19 PDF at exact
// PDF-space coordinates, without modifying the source file, using only
// synthetic Test data wired through the real contract-projection model
// (contract-ghl-projection-model.ts's buildContractProjectionPlan, via
// scripts/lib/inv67-projection-fixture.cjs -- NOT hand-typed strings).
//
// Coordinates are derived at run time from pdfjs-dist text-item extraction
// against the pinned source PDF (scripts/lib/inv67-pdf-anchor-helper.cjs's
// named strategies) and cross-referenced against
// docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md's own row data
// (scripts/lib/inv67-manifest-parser.cjs), not hardcoded per row --
// EXCEPT the 6 ordinals PR #75 already proved and hand-verified (1, 8, 10,
// 19, 54, 63), which keep their exact proven literals as a sanity baseline
// (scripts/lib/inv67-pdf-field-plan.cjs's ROW_DERIVATIONS still documents
// them for traceability, but does not re-derive their geometry from
// scratch).
//
// Every "Visual judgment" manifest row, and every row whose printed blank
// turned out to be underscores embedded within a single merged text run
// (no clean duplicate caption to measure a sub-position from), is DEFERRED
// -- never guessed. See placements.json's own `deferred` array for the
// full accounting.
//
// Signature, initials, signer-entered dates, and Effective Date handling
// remain explicitly OUT of scope. No GHL call, no network call, no
// Production data anywhere in this script.

const fs = require('fs');
const path = require('path');
const { buildProjectionEntries } = require('./lib/inv67-projection-fixture.cjs');
const { buildFieldPlan } = require('./lib/inv67-pdf-field-plan.cjs');
const {
  SOURCE_PDF_PATH,
  PINNED_SOURCE_SHA256,
  EXPECTED_SOURCE_PAGE_COUNT,
  PAGE_WIDTH_PT,
  PAGE_HEIGHT_PT,
  sha256Hex,
  validatePlacementGeometry,
  validateDuplicateConsistency,
  validateNoSignerControlledFields,
  loadAndVerifySourcePdf,
  stampDeterministicMetadata,
  renderFieldsOntoPdf,
} = require('./lib/inv67-pdf-render-core.cjs');

const OUTPUT_DIR = path.join(__dirname, '..', 'proof-artifacts', 'inv67-pdf-population-proof');
const OUTPUT_PDF_PATH = path.join(OUTPUT_DIR, 'populated-proof.pdf');
const PLACEMENTS_JSON_PATH = path.join(OUTPUT_DIR, 'placements.json');

async function buildAllFields() {
  const { entriesByKey } = buildProjectionEntries();
  const { converted, deferred, manifestRows } = await buildFieldPlan(entriesByKey);
  return { converted, deferred, manifestRows, entriesByKey };
}

async function main() {
  let sourceBytes, actualSourceHash, pdfDoc, sourcePageCount;
  try {
    ({ sourceBytes, sourceSha256: actualSourceHash, pdfDoc, sourcePageCount } = await loadAndVerifySourcePdf());
  } catch (err) {
    console.error(`FAIL ${err.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS source PDF hash verified unchanged: ${actualSourceHash}`);

  console.log('Building projection plan and PDF-coordinate field plan...');
  const { converted, deferred, manifestRows } = await buildAllFields();

  const visualJudgmentCount = manifestRows.filter((r) => r.cls === 'Visual judgment').length;
  const readyCount = manifestRows.filter((r) => r.cls === 'Ready').length;
  console.log(`Manifest: ${manifestRows.length} total rows, ${readyCount} Ready, ${visualJudgmentCount} Visual judgment.`);
  console.log(`Converted: ${converted.length}. Deferred: ${deferred.length}.`);
  for (const d of deferred) console.log(`  DEFERRED ordinal ${d.ordinal} (${d.key}): ${d.reason}`);

  validatePlacementGeometry(converted);
  console.log(`PASS all ${converted.length} converted fields are in-bounds and non-overlapping`);

  validateDuplicateConsistency(converted);
  console.log('PASS every duplicate-key group shares identical text across all its placements');

  validateNoSignerControlledFields(converted);
  console.log('PASS no converted field key references a signature, initial, signer-entered date, Effective Date, or receipt field');

  stampDeterministicMetadata(pdfDoc, {
    producer: 'IAOS INV-67 PDF population proof (pdf-lib)',
    creator: 'IAOS INV-67 PDF population proof (pdf-lib)',
  });

  const drawnFields = await renderFieldsOntoPdf(pdfDoc, converted);
  console.log(`PASS drew ${drawnFields.filter((f) => f.value !== '').length} non-empty values, none exceeding its assigned blank width (${drawnFields.length} placements verified total, including legitimately-empty dispositions)`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(OUTPUT_PDF_PATH, outputBytes);

  const record = {
    generatedBy: 'app/scripts/inv67-pdf-population-proof.cjs',
    sourcePdfPath: 'docs/TREC Resale Home Contract.pdf',
    sourceSha256: actualSourceHash,
    sourcePageCount,
    outputPdfPath: 'app/proof-artifacts/inv67-pdf-population-proof/populated-proof.pdf',
    outputSha256: sha256Hex(outputBytes),
    manifestTotals: {
      totalRows: manifestRows.length,
      readyRows: readyCount,
      visualJudgmentRows: visualJudgmentCount,
      convertedCount: drawnFields.length,
      deferredCount: deferred.length,
    },
    fields: drawnFields,
    deferred,
  };
  fs.writeFileSync(PLACEMENTS_JSON_PATH, JSON.stringify(record, null, 2));

  console.log(`PASS wrote ${OUTPUT_PDF_PATH} (${outputBytes.length} bytes), output SHA-256 ${record.outputSha256}`);
  console.log(`PASS wrote ${PLACEMENTS_JSON_PATH}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FAIL', err.stack || err.message || err);
    process.exitCode = 1;
  });
}

module.exports = {
  PINNED_SOURCE_SHA256,
  EXPECTED_SOURCE_PAGE_COUNT,
  PAGE_WIDTH_PT,
  PAGE_HEIGHT_PT,
  SOURCE_PDF_PATH,
  OUTPUT_PDF_PATH,
  PLACEMENTS_JSON_PATH,
  buildAllFields,
  validatePlacementGeometry,
  validateDuplicateConsistency,
  sha256Hex,
};
