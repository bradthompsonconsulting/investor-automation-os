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
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { buildProjectionEntries } = require('./lib/inv67-projection-fixture.cjs');
const { buildFieldPlan } = require('./lib/inv67-pdf-field-plan.cjs');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_PDF_PATH = path.join(REPO_ROOT, 'docs', 'TREC Resale Home Contract.pdf');
const PINNED_SOURCE_SHA256 = '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5';
const EXPECTED_SOURCE_PAGE_COUNT = 12;

const OUTPUT_DIR = path.join(__dirname, '..', 'proof-artifacts', 'inv67-pdf-population-proof');
const OUTPUT_PDF_PATH = path.join(OUTPUT_DIR, 'populated-proof.pdf');
const PLACEMENTS_JSON_PATH = path.join(OUTPUT_DIR, 'placements.json');

const PAGE_WIDTH_PT = 612; // US Letter, confirmed via pdfjs viewport on every inspected page
const PAGE_HEIGHT_PT = 792;

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function validatePlacementGeometry(fields) {
  for (const field of fields) {
    if (field.x < 0 || field.y < 0 || field.x + field.width > PAGE_WIDTH_PT || field.y + field.height > PAGE_HEIGHT_PT) {
      throw new Error(
        `Ordinal ${field.ordinal} (${field.fieldKey}) falls outside page bounds: ` +
          `x=${field.x} y=${field.y} width=${field.width} height=${field.height} against ${PAGE_WIDTH_PT}x${PAGE_HEIGHT_PT}`
      );
    }
  }
  const byPage = new Map();
  for (const field of fields) {
    if (!byPage.has(field.page)) byPage.set(field.page, []);
    byPage.get(field.page).push(field);
  }
  for (const [page, pageFields] of byPage) {
    for (let i = 0; i < pageFields.length; i += 1) {
      for (let j = i + 1; j < pageFields.length; j += 1) {
        const a = pageFields[i];
        const b = pageFields[j];
        const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
        const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
        if (overlapsX && overlapsY) {
          throw new Error(`Ordinals ${a.ordinal} and ${b.ordinal} overlap on page ${page}`);
        }
      }
    }
  }
}

/** Every duplicate-note-linked group (address x12 subset placed, sales-price x2) must carry byte-identical text at every physical placement. */
function validateDuplicateConsistency(fields) {
  const byKey = new Map();
  for (const f of fields) {
    if (!byKey.has(f.fieldKey)) byKey.set(f.fieldKey, []);
    byKey.get(f.fieldKey).push(f);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const first = group[0].value;
    for (const f of group.slice(1)) {
      if (f.value !== first) {
        throw new Error(`Duplicate-key group "${key}" disagrees: ordinal ${group[0].ordinal}="${first}" vs ordinal ${f.ordinal}="${f.value}"`);
      }
    }
  }
}

async function buildAllFields() {
  const { entriesByKey } = buildProjectionEntries();
  const { converted, deferred, manifestRows } = await buildFieldPlan(entriesByKey);
  return { converted, deferred, manifestRows, entriesByKey };
}

async function main() {
  const sourceBytes = fs.readFileSync(SOURCE_PDF_PATH);
  const actualSourceHash = sha256Hex(sourceBytes);
  if (actualSourceHash !== PINNED_SOURCE_SHA256) {
    console.error(
      `FAIL source PDF hash mismatch -- expected ${PINNED_SOURCE_SHA256}, got ${actualSourceHash}. Refusing to generate from an unverified source.`
    );
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

  const EXCLUDED_KEY_PATTERN = /signature|initial|signerDate|effectiveDate/i;
  const violating = converted.filter((f) => EXCLUDED_KEY_PATTERN.test(f.fieldKey));
  if (violating.length > 0) {
    throw new Error(`Signature/initial/signer-date/Effective-Date keys must never be converted: ${violating.map((f) => f.fieldKey).join(', ')}`);
  }
  console.log('PASS no converted field key references a signature, initial, signer-entered date, or Effective Date');

  const pdfDoc = await PDFDocument.load(sourceBytes);
  const sourcePageCount = pdfDoc.getPageCount();
  if (sourcePageCount !== EXPECTED_SOURCE_PAGE_COUNT) {
    console.error(`FAIL expected ${EXPECTED_SOURCE_PAGE_COUNT} source pages, found ${sourcePageCount}`);
    process.exitCode = 1;
    return;
  }

  // pdf-lib's save() unconditionally stamps ModificationDate to `new Date()`
  // via its internal updateInfoDict() (PDFDocument.js:1335-1345), which would
  // make byte-for-byte output non-deterministic across runs even though the
  // visible content is identical. Fix all info-dict metadata to constants and
  // no-op that hook so two runs against the same source produce identical
  // bytes.
  const FIXED_METADATA_DATE = new Date('2026-01-01T00:00:00.000Z');
  pdfDoc.setCreationDate(FIXED_METADATA_DATE);
  pdfDoc.setModificationDate(FIXED_METADATA_DATE);
  pdfDoc.setProducer('IAOS INV-67 PDF population proof (pdf-lib)');
  pdfDoc.setCreator('IAOS INV-67 PDF population proof (pdf-lib)');
  pdfDoc.updateInfoDict = function noOpUpdateInfoDict() {};

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const drawnFields = [];
  for (const field of converted) {
    const page = pdfDoc.getPage(field.page - 1);
    const useFont = field.font === 'Helvetica-Bold' ? helveticaBold : helvetica;
    const textWidth = useFont.widthOfTextAtSize(field.value, field.fontSize);
    if (textWidth > field.width) {
      throw new Error(
        `Ordinal ${field.ordinal} value "${field.value}" (width ${textWidth.toFixed(2)}pt) ` +
          `exceeds its assigned blank width (${field.width}pt) -- would risk drifting into printed contract language`
      );
    }
    const drawX = field.align === 'center' ? field.x + (field.width - textWidth) / 2 : field.x;
    if (field.value !== '') {
      // Strategy-F fields (`estimated: true`) overlay a printed underscore
      // run that pdf-lib cannot remove from the content stream -- drawing
      // text alone leaves the original underscores physically present
      // underneath, which pdftotext extraction proves via character-level
      // interleaving even when the render looks visually clean at normal
      // zoom (confirmed empirically this session: e.g. "Phone(s):_____"
      // extracts as "Phone(s):_(5_1_2_)..." without this mask). A white
      // background rectangle sized to the estimated blank, drawn first,
      // genuinely erases the underscores visually -- explicitly permitted
      // ("Any masking or background treatment must be limited to
      // replaceable blank/underscore space and proven visually safe").
      // This does not and cannot change what pdftotext extracts (it reads
      // the text-showing operators, not the rendered/masked appearance);
      // see the validation suite's own carve-out for why exact-substring
      // extraction is not the right proof for this field class.
      if (field.estimated) {
        page.drawRectangle({
          x: field.x - 0.5,
          y: field.y - 1.5,
          width: field.width + 1,
          height: field.height + 2,
          color: rgb(1, 1, 1),
        });
      }
      page.drawText(field.value, {
        x: drawX,
        y: field.y,
        size: field.fontSize,
        font: useFont,
        color: rgb(0, 0, 0),
      });
    }
    drawnFields.push({ ...field, resolvedDrawX: drawX, resolvedTextWidthPt: Math.round(textWidth * 100) / 100 });
  }
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
