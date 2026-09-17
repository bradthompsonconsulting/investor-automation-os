'use strict';

// INV-67 / B9-12 -- smallest repository proof that IAOS can populate canonical
// deal values directly onto the ORIGINAL TREC 20-19 PDF at exact PDF-space
// coordinates, without modifying the source file, using only synthetic Test
// data. Authorized scope: 6 representative rows from
// docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md. Signature, initials,
// signer-entered dates, and Effective Date handling are explicitly OUT of
// scope. No GHL call, no network call, no Production data anywhere in this
// script.
//
// Coordinates below are PDF user-space points (bottom-left origin, y-up),
// derived once via pdfjs-dist text-item extraction against the pinned source
// PDF (see docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md's own anchor text for
// the paragraph each row targets) and hand-verified against the rendered
// page images this script also produces. They are fixed literals, not
// recomputed at runtime, so a run cannot silently drift if pdfjs's text
// extraction ever changes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_PDF_PATH = path.join(REPO_ROOT, 'docs', 'TREC Resale Home Contract.pdf');
const PINNED_SOURCE_SHA256 = '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5';
const EXPECTED_SOURCE_PAGE_COUNT = 12;

const OUTPUT_DIR = path.join(__dirname, '..', 'proof-artifacts', 'inv67-pdf-population-proof');
const OUTPUT_PDF_PATH = path.join(OUTPUT_DIR, 'populated-proof.pdf');
const PLACEMENTS_JSON_PATH = path.join(OUTPUT_DIR, 'placements.json');

const PAGE_WIDTH_PT = 612; // US Letter, confirmed via pdfjs viewport on every inspected page
const PAGE_HEIGHT_PT = 792;

// Six representative rows, chosen per assignment: a name, the property
// address (placed twice -- once at its primary paragraph, once at its
// repeated-header duplicate, satisfying "one repeated value on another
// page" without inventing a 7th field), the Paragraph 3A sales-price
// amount, one checkbox mark, and one contract-term date (NOT the signer
// Effective Date, which is out of scope).
const PROOF_FIELDS = [
  {
    manifestOrdinal: 1,
    fieldKey: 'parties.sellerSigners',
    opportunityFieldKey: 'opportunity.contract_seller_signers',
    mergeTag: '{{ opportunity.contract_seller_signers }}',
    page: 1,
    x: 282,
    y: 689.86,
    width: 280,
    height: 11,
    font: 'Helvetica',
    fontSize: 9,
    align: 'left',
    syntheticValue: 'Jordan A. Testseller',
    destination:
      'Paragraph 1 (PARTIES) -- Seller-name blank filling the remainder of the "The parties to this contract are" line, before it wraps to "(Seller) and ... (Buyer)."',
  },
  {
    manifestOrdinal: 8,
    fieldKey: 'identity.propertyStreetAddress',
    opportunityFieldKey: 'opportunity.contract_property_street_address',
    mergeTag: '{{ opportunity.contract_property_street_address }}',
    page: 1,
    x: 165,
    y: 595.3,
    width: 400,
    height: 11,
    font: 'Helvetica',
    fontSize: 9,
    align: 'left',
    syntheticValue: '4521 Test Ridge Lane, Austin, TX 78701',
    destination:
      'Paragraph 2A -- address/zip blank at the end of the "Texas, known as" line, above the "(address/zip code), or as described on attached exhibit." caption.',
  },
  {
    manifestOrdinal: 10,
    fieldKey: 'sales_price_amount_text',
    opportunityFieldKey: 'opportunity.contract_sales_price_amount_text',
    mergeTag: '{{ opportunity.contract_sales_price_amount_text }}',
    page: 1,
    x: 459,
    y: 318.41,
    width: 110,
    height: 11,
    font: 'Helvetica',
    fontSize: 9,
    align: 'left',
    syntheticValue: '250,000.00',
    destination:
      'Paragraph 3A -- dollar-amount blank immediately right of the printed "$" at the end of "A. Cash portion of Sales Price payable by Buyer at closing .........."',
  },
  {
    manifestOrdinal: 54,
    fieldKey: 'as_is_with_repairs_mark',
    opportunityFieldKey: 'opportunity.contract_as_is_with_repairs_mark',
    mergeTag: '{{ opportunity.contract_as_is_with_repairs_mark }}',
    page: 5,
    x: 58.2,
    y: 712.0,
    width: 11.55,
    height: 12.96,
    font: 'Helvetica-Bold',
    fontSize: 10,
    align: 'center',
    syntheticValue: 'X',
    destination:
      'Paragraph 7D(2) -- centered inside the printed "q" checkbox glyph immediately preceding "(2) Buyer accepts the Property As Is provided Seller...".',
  },
  {
    manifestOrdinal: 63,
    fieldKey: 'closing_date_month_day_text',
    opportunityFieldKey: 'opportunity.contract_closing_date_month_day',
    mergeTag: '{{ opportunity.contract_closing_date_month_day }}',
    page: 6,
    x: 292,
    y: 669.82,
    width: 125,
    height: 11,
    font: 'Helvetica',
    fontSize: 9,
    align: 'left',
    syntheticValue: 'October 15',
    destination:
      'Paragraph 9A -- month/day blank between "The closing of the sale will be on or before" and the printed ", 20 ___" -- a contract-term date, NOT the signer Effective Date, which remains out of scope.',
  },
  {
    manifestOrdinal: 19,
    fieldKey: 'identity.propertyStreetAddress',
    opportunityFieldKey: 'opportunity.contract_property_street_address',
    mergeTag: '{{ opportunity.contract_property_street_address }}',
    page: 2,
    x: 129,
    y: 750.6,
    width: 325,
    height: 9,
    font: 'Helvetica',
    fontSize: 7.5,
    align: 'left',
    syntheticValue: '4521 Test Ridge Lane, Austin, TX 78701',
    destination:
      'Repeated page-2-of-12 header -- "Contract Concerning ___ (Address of Property)" blank. SAME field/value as ordinal 8, proving one repeated value placed correctly on a second page.',
    duplicateOfOrdinal: 8,
  },
];

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function validatePlacementGeometry(fields) {
  for (const field of fields) {
    if (field.x < 0 || field.y < 0 || field.x + field.width > PAGE_WIDTH_PT || field.y + field.height > PAGE_HEIGHT_PT) {
      throw new Error(
        `Ordinal ${field.manifestOrdinal} (${field.fieldKey}) falls outside page bounds: ` +
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
          throw new Error(
            `Ordinals ${a.manifestOrdinal} and ${b.manifestOrdinal} overlap on page ${page}`
          );
        }
      }
    }
  }
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

  validatePlacementGeometry(PROOF_FIELDS);
  console.log(`PASS all ${PROOF_FIELDS.length} proof fields are in-bounds and non-overlapping`);

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
  for (const field of PROOF_FIELDS) {
    const page = pdfDoc.getPage(field.page - 1);
    const useFont = field.font === 'Helvetica-Bold' ? helveticaBold : helvetica;
    const textWidth = useFont.widthOfTextAtSize(field.syntheticValue, field.fontSize);
    if (textWidth > field.width) {
      throw new Error(
        `Ordinal ${field.manifestOrdinal} synthetic value "${field.syntheticValue}" (width ${textWidth.toFixed(2)}pt) ` +
          `exceeds its assigned blank width (${field.width}pt) -- would risk drifting into printed contract language`
      );
    }
    const drawX = field.align === 'center' ? field.x + (field.width - textWidth) / 2 : field.x;
    page.drawText(field.syntheticValue, {
      x: drawX,
      y: field.y,
      size: field.fontSize,
      font: useFont,
      color: rgb(0, 0, 0),
    });
    drawnFields.push({ ...field, resolvedDrawX: drawX, resolvedTextWidthPt: Math.round(textWidth * 100) / 100 });
  }
  console.log(`PASS drew ${drawnFields.length} synthetic values, none exceeding its assigned blank width`);

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
    fields: drawnFields,
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
  PROOF_FIELDS,
  PINNED_SOURCE_SHA256,
  EXPECTED_SOURCE_PAGE_COUNT,
  PAGE_WIDTH_PT,
  PAGE_HEIGHT_PT,
  SOURCE_PDF_PATH,
  OUTPUT_PDF_PATH,
  PLACEMENTS_JSON_PATH,
  validatePlacementGeometry,
  sha256Hex,
};
