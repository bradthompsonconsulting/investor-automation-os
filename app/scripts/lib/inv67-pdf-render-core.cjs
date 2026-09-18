'use strict';

// Shared PDF-rendering/validation core for INV-67 / B9-12 TREC 20-19
// population -- extracted from the original inv67-pdf-population-proof.cjs
// (PHASE A/B synthetic-fixture proof) so the same exact drawing, hashing,
// geometry, duplicate-consistency, and signer-exclusion logic is used by
// BOTH that proof script and the live-data production generator
// (inv67-pdf-generator.cjs), never reimplemented twice. Nothing here reads
// entriesByKey, the manifest, or ROW_DERIVATIONS -- it operates purely on an
// already-built `converted` field-plan array (whatever produced it), plus
// the source PDF bytes.
//
// No GHL call, no network call, no Production data anywhere in this file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CANONICAL_SOURCE_PDF_PATH = path.join(REPO_ROOT, 'docs', 'TREC Resale Home Contract.pdf');

const PINNED_SOURCE_SHA256 = '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5';
const EXPECTED_SOURCE_PAGE_COUNT = 12;

const PAGE_WIDTH_PT = 612; // US Letter, confirmed via pdfjs viewport on every inspected page
const PAGE_HEIGHT_PT = 792;

// Manifest/field-map version this core (and every generator built on it)
// currently targets -- the authoritative document is
// docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md, parsed unmodified by
// inv67-manifest-parser.cjs and never re-derived here.
const MANIFEST_VERSION = 'INV67_TEMPLATE_PLACEMENT_MANIFEST_V1';

// Excludes signature, initials, signer-entered dates, Effective Date, and
// receipt fields from ever being IAOS-populated -- these remain
// signer-controlled and blank in every generated artifact, proof or live.
const EXCLUDED_KEY_PATTERN = /signature|initial|signerDate|effectiveDate|receipt/i;

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

/** Fails closed if any converted field key references a signature, initial, signer-entered date, Effective Date, or receipt field -- these must never be IAOS-populated. */
function validateNoSignerControlledFields(fields) {
  const violating = fields.filter((f) => EXCLUDED_KEY_PATTERN.test(f.fieldKey));
  if (violating.length > 0) {
    throw new Error(`Signature/initial/signer-date/Effective-Date/receipt keys must never be converted: ${violating.map((f) => f.fieldKey).join(', ')}`);
  }
}

/** Reads, hashes, and validates the pinned canonical source PDF. Fails closed on any hash or page-count mismatch -- refuses to generate from an unverified source. */
async function loadAndVerifySourcePdf({ sourcePdfPath = CANONICAL_SOURCE_PDF_PATH, expectedSha256 = PINNED_SOURCE_SHA256, expectedPageCount = EXPECTED_SOURCE_PAGE_COUNT } = {}) {
  const sourceBytes = fs.readFileSync(sourcePdfPath);
  const sourceSha256 = sha256Hex(sourceBytes);
  if (sourceSha256 !== expectedSha256) {
    throw new Error(`Source PDF hash mismatch -- expected ${expectedSha256}, got ${sourceSha256}. Refusing to generate from an unverified source.`);
  }
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const sourcePageCount = pdfDoc.getPageCount();
  if (sourcePageCount !== expectedPageCount) {
    throw new Error(`Expected ${expectedPageCount} source pages, found ${sourcePageCount}.`);
  }
  return { sourceBytes, sourceSha256, pdfDoc, sourcePageCount };
}

/** pdf-lib's save() unconditionally stamps ModificationDate to `new Date()` via its internal updateInfoDict(), which would make byte-for-byte output non-deterministic across runs against identical input even though the visible content is identical. Fixes all info-dict metadata to constants and no-ops that hook. */
function stampDeterministicMetadata(pdfDoc, { producer, creator }) {
  const FIXED_METADATA_DATE = new Date('2026-01-01T00:00:00.000Z');
  pdfDoc.setCreationDate(FIXED_METADATA_DATE);
  pdfDoc.setModificationDate(FIXED_METADATA_DATE);
  pdfDoc.setProducer(producer);
  pdfDoc.setCreator(creator);
  pdfDoc.updateInfoDict = function noOpUpdateInfoDict() {};
}

/**
 * Draws every converted field onto its already-loaded pdfDoc. Identical
 * logic to the original proof script's inline draw loop, unchanged:
 * text-width-fits-blank enforcement, center alignment, and the Strategy-F
 * white-mask-then-draw treatment for `estimated: true` fields (masks a
 * printed underscore run pdf-lib cannot remove from the content stream --
 * see inv67-pdf-field-plan.cjs's own header for why this is required and
 * safe).
 */
async function renderFieldsOntoPdf(pdfDoc, converted) {
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
  return drawnFields;
}

module.exports = {
  SOURCE_PDF_PATH: CANONICAL_SOURCE_PDF_PATH,
  PINNED_SOURCE_SHA256,
  EXPECTED_SOURCE_PAGE_COUNT,
  PAGE_WIDTH_PT,
  PAGE_HEIGHT_PT,
  MANIFEST_VERSION,
  EXCLUDED_KEY_PATTERN,
  sha256Hex,
  validatePlacementGeometry,
  validateDuplicateConsistency,
  validateNoSignerControlledFields,
  loadAndVerifySourcePdf,
  stampDeterministicMetadata,
  renderFieldsOntoPdf,
};
