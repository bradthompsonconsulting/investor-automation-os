'use strict';

// Narrow automated validation for the INV-67 IAOS-generated PDF population
// proof (app/scripts/inv67-pdf-population-proof.cjs). Regenerates the proof
// output fresh, then checks the 10 properties Jess/Brad's assignment asked
// for. Offline, deterministic, no network, no GHL, no Production data.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
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
} = require('./inv67-pdf-population-proof.cjs');
const { PDFDocument } = require('pdf-lib');

const GENERATOR_SCRIPT_PATH = path.join(__dirname, 'inv67-pdf-population-proof.cjs');

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
}

function pdftotextAllPages(pdfPath) {
  return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
}

async function main() {
  // 1. Source PDF hash remains unchanged.
  const sourceBytes = fs.readFileSync(SOURCE_PDF_PATH);
  const sourceHash = sha256Hex(sourceBytes);
  check('source PDF hash matches pinned manifest hash', sourceHash === PINNED_SOURCE_SHA256);

  // Regenerate fresh so this test never trusts a stale artifact on disk.
  execFileSync(process.execPath, [GENERATOR_SCRIPT_PATH], { stdio: 'inherit' });

  // Source must still be byte-identical after a generator run (no in-place mutation).
  const sourceBytesAfter = fs.readFileSync(SOURCE_PDF_PATH);
  check('source PDF unchanged after generation', sha256Hex(sourceBytesAfter) === PINNED_SOURCE_SHA256);

  check('generated output exists', fs.existsSync(OUTPUT_PDF_PATH));
  const outputBytes = fs.readFileSync(OUTPUT_PDF_PATH);
  check('generated output differs from source', sha256Hex(outputBytes) !== sha256Hex(sourceBytesAfter));

  // 3. Page count remains unchanged.
  const outputDoc = await PDFDocument.load(outputBytes);
  check(
    `generated output page count (${outputDoc.getPageCount()}) matches source (${EXPECTED_SOURCE_PAGE_COUNT})`,
    outputDoc.getPageCount() === EXPECTED_SOURCE_PAGE_COUNT
  );

  // 4. Expected synthetic values are embedded/extractable where technically possible.
  // The checkbox mark (ordinal 54) is a single "X" glyph inside a symbol-font
  // checkbox; pdftotext's reading order is not guaranteed to isolate it as a
  // standalone token, so it is checked separately and more loosely below.
  const extractedText = pdftotextAllPages(OUTPUT_PDF_PATH);
  for (const field of PROOF_FIELDS) {
    if (field.fieldKey === 'as_is_with_repairs_mark') continue;
    check(
      `extracted text contains synthetic value for ordinal ${field.manifestOrdinal} (${field.fieldKey})`,
      extractedText.includes(field.syntheticValue)
    );
  }
  check(
    'extracted text contains the As-Is checkbox "X" adjacent to its paragraph (technically extractable, exact token boundary not guaranteed by pdftotext reading order)',
    /q\s*X\s*\(2\)\s*Buyer accepts the Property As Is provided Seller/.test(extractedText)
  );

  // 5. Required coordinate metadata exists for every proof field.
  const placementsRecord = JSON.parse(fs.readFileSync(PLACEMENTS_JSON_PATH, 'utf8'));
  const requiredKeys = ['manifestOrdinal', 'fieldKey', 'page', 'x', 'y', 'width', 'height', 'font', 'fontSize', 'align', 'destination'];
  check(
    `placements.json records exactly ${PROOF_FIELDS.length} fields`,
    placementsRecord.fields.length === PROOF_FIELDS.length
  );
  check(
    'every recorded field carries all required coordinate metadata',
    placementsRecord.fields.every((f) => requiredKeys.every((k) => f[k] !== undefined && f[k] !== null))
  );

  // 6. Coordinates remain within page bounds.
  let boundsOk = true;
  try {
    validatePlacementGeometry(PROOF_FIELDS);
  } catch (e) {
    boundsOk = false;
    console.error('  ' + e.message);
  }
  check('all fields are within page bounds and mutually non-overlapping (geometry re-validated)', boundsOk);
  let pageSizeOk = true;
  for (const field of PROOF_FIELDS) {
    const page = outputDoc.getPage(field.page - 1);
    const { width, height } = page.getSize();
    if (Math.round(width) !== PAGE_WIDTH_PT || Math.round(height) !== PAGE_HEIGHT_PT) pageSizeOk = false;
  }
  check(`every field's page dimensions are the expected US Letter size (${PAGE_WIDTH_PT}x${PAGE_HEIGHT_PT}pt)`, pageSizeOk);

  // 7. Proof fields do not overlap each other -- already asserted inside
  // validatePlacementGeometry above (check 6); re-stated here as its own
  // named assertion per the assignment's explicit list.
  const byPage = new Map();
  for (const f of PROOF_FIELDS) {
    if (!byPage.has(f.page)) byPage.set(f.page, []);
    byPage.get(f.page).push(f);
  }
  let noOverlap = true;
  for (const fields of byPage.values()) {
    for (let i = 0; i < fields.length; i += 1) {
      for (let j = i + 1; j < fields.length; j += 1) {
        const a = fields[i];
        const b = fields[j];
        const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
        const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
        if (overlapsX && overlapsY) noOverlap = false;
      }
    }
  }
  check('no two proof fields share overlapping bounding boxes on the same page', noOverlap);

  // 8. Generation is deterministic: re-run and compare extracted text + placements metadata.
  execFileSync(process.execPath, [GENERATOR_SCRIPT_PATH], { stdio: 'inherit' });
  const secondRunBytes = fs.readFileSync(OUTPUT_PDF_PATH);
  const secondRunText = pdftotextAllPages(OUTPUT_PDF_PATH);
  const secondRunPlacements = JSON.parse(fs.readFileSync(PLACEMENTS_JSON_PATH, 'utf8'));
  check('re-running the generator yields byte-identical output', sha256Hex(secondRunBytes) === sha256Hex(outputBytes));
  check('re-running the generator yields identical extracted text', secondRunText === extractedText);
  check(
    're-running the generator yields identical placement metadata',
    JSON.stringify(secondRunPlacements.fields) === JSON.stringify(placementsRecord.fields)
  );

  // 9. No network or credential dependency exists (static source scan).
  const generatorSource = fs.readFileSync(GENERATOR_SCRIPT_PATH, 'utf8');
  const forbiddenPatterns = [/require\(['"]https?['"]\)/, /require\(['"]net['"]\)/, /\bfetch\(/, /\baxios\b/, /process\.env\./];
  const foundForbidden = forbiddenPatterns.filter((re) => re.test(generatorSource));
  check('generator script contains no network or credential-access calls', foundForbidden.length === 0);

  // 10. Existing Board 9 and core regression suites remain green.
  // Excludes "*-script.cjs" tests (test-inv67-*-script.cjs): those cover the
  // one-shot GHL field-provisioning batch scripts, which make live
  // leadconnectorhq HTTPS calls even in their "dry run" mode -- out of scope
  // for this proof's regression check and a real hang risk in a
  // network-restricted environment. This proof touches no GHL code path, so
  // regression coverage is scoped to the provider-neutral contract models,
  // carriers, and the manifest validator instead.
  const regressionScripts = fs
    .readdirSync(__dirname)
    .filter(
      (f) =>
        /^test-(contract-|board9-contract-model|inv67-template-placement-manifest)/.test(f) &&
        f.endsWith('.cjs') &&
        !f.includes('-script') &&
        f !== path.basename(__filename)
    );
  let regressionsOk = true;
  for (const script of regressionScripts) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'pipe' });
    } catch (e) {
      regressionsOk = false;
      console.error(`  regression FAILED: ${script}`);
      console.error('  ' + (e.stdout ? e.stdout.toString() : e.message));
    }
  }
  check(`existing Board 9 / INV-67 regression suite remains green (${regressionScripts.length} scripts run)`, regressionsOk);

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
