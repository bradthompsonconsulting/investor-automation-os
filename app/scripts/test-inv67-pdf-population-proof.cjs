'use strict';

// Narrow automated validation for the INV-67 IAOS-generated PDF population
// proof (app/scripts/inv67-pdf-population-proof.cjs), PHASE A expansion.
// Regenerates the proof output fresh, then checks manifest coverage/
// accounting, geometry, duplicate-value consistency, the signer/date
// exclusion, determinism, no network dependency, and the existing Board 9
// regression suite. Offline, deterministic, no network, no GHL, no
// Production data.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
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

  // Build the field plan directly (in-process) for the accounting/geometry
  // checks below, THEN separately regenerate via a fresh child process so
  // this test never trusts a stale artifact on disk for the file-level
  // checks (hash, determinism, extracted text).
  const { converted, deferred, manifestRows } = await buildAllFields();

  // 2. Manifest coverage / exact row accounting.
  check('manifest has exactly 133 rows', manifestRows.length === 133);
  const readyRows = manifestRows.filter((r) => r.cls === 'Ready');
  const visualJudgmentRows = manifestRows.filter((r) => r.cls === 'Visual judgment');
  check('exactly 98 Ready + 35 Visual judgment rows (0 other)', readyRows.length === 98 && visualJudgmentRows.length === 35 && readyRows.length + visualJudgmentRows.length === 133);

  const convertedOrdinals = new Set(converted.map((f) => f.ordinal));
  const deferredOrdinals = new Set(deferred.map((f) => f.ordinal));
  check('no ordinal is both converted and deferred', [...convertedOrdinals].every((o) => !deferredOrdinals.has(o)));
  check('no ordinal appears twice among converted', convertedOrdinals.size === converted.length);
  check('no ordinal appears twice among deferred', deferredOrdinals.size === deferred.length);

  const visualJudgmentOrdinals = new Set(visualJudgmentRows.map((r) => r.ordinal));
  const convertedVisualJudgment = converted.filter((f) => visualJudgmentOrdinals.has(f.ordinal));
  const convertedReady = converted.filter((f) => !visualJudgmentOrdinals.has(f.ordinal));

  // Hardened exact-value accounting (Jess review correction, this session):
  // the previous "at least 85 of 98 Ready rows" threshold would let a future
  // regression that silently converts FEWER rows than today pass unnoticed.
  // Every number below is pinned to the exact, currently-proven result --
  // any deviation, in either direction, is a real accounting change that
  // must be explained, not just a quantity to exceed.
  check('converted total is exactly 91', converted.length === 91);
  check('converted Ready rows total exactly 89', convertedReady.length === 89);

  // Every converted Visual-judgment-class row must be one of PR #75's own
  // 2 already-proven, hand-verified rows (19, 63) -- this pass must never
  // newly convert a Visual-judgment row itself.
  check(
    'converted Visual-judgment rows are exactly the 2 already-proven ordinals from PR #75 (19, 63), never a newly converted one',
    convertedVisualJudgment.length === 2 && convertedVisualJudgment.every((f) => f.ordinal === 19 || f.ordinal === 63)
  );

  const EXPECTED_DEFERRED_ORDINALS = [18, 68, 72, 74, 77, 79, 83, 102, 108];
  check(
    `deferred Ready rows are exactly the expected 9 ordinals (${EXPECTED_DEFERRED_ORDINALS.join(', ')})`,
    deferred.length === EXPECTED_DEFERRED_ORDINALS.length
      && EXPECTED_DEFERRED_ORDINALS.every((o) => deferredOrdinals.has(o))
      && [...deferredOrdinals].every((o) => EXPECTED_DEFERRED_ORDINALS.includes(o))
  );
  check('every deferred row is a Ready-class row, never a Visual-judgment row', deferred.every((d) => !visualJudgmentOrdinals.has(d.ordinal)));
  check(
    'every deferred Ready row carries a nonempty structural reason',
    deferred.length > 0 && deferred.every((d) => typeof d.reason === 'string' && d.reason.trim().length > 0)
  );

  check(
    'converted Ready rows + deferred rows account for all 98 Ready rows exactly',
    convertedReady.length + deferred.length === 98
  );

  const untouchedVisualJudgmentCount = visualJudgmentRows.length - convertedVisualJudgment.length;
  check('untouched Visual-judgment rows total exactly 33', untouchedVisualJudgmentCount === 33);
  check('total accounting: converted + deferred + untouched-visual-judgment == 133', converted.length + deferred.length + untouchedVisualJudgmentCount === 133);

  // 3. Source PDF hash and page-count preservation (via a fresh child-process run).
  execFileSync(process.execPath, [GENERATOR_SCRIPT_PATH], { stdio: 'inherit' });
  const sourceBytesAfter = fs.readFileSync(SOURCE_PDF_PATH);
  check('source PDF unchanged after generation', sha256Hex(sourceBytesAfter) === PINNED_SOURCE_SHA256);

  check('generated output exists', fs.existsSync(OUTPUT_PDF_PATH));
  const outputBytes = fs.readFileSync(OUTPUT_PDF_PATH);
  check('generated output differs from source', sha256Hex(outputBytes) !== sha256Hex(sourceBytesAfter));

  const outputDoc = await PDFDocument.load(outputBytes);
  check(
    `generated output page count (${outputDoc.getPageCount()}) matches source (${EXPECTED_SOURCE_PAGE_COUNT})`,
    outputDoc.getPageCount() === EXPECTED_SOURCE_PAGE_COUNT
  );

  // 4. Every placement's rendered text fits its assigned region (re-checked
  // against the actually-embedded Helvetica/Helvetica-Bold metrics).
  const { StandardFonts } = require('pdf-lib');
  const metricsDoc = await PDFDocument.create();
  const helv = await metricsDoc.embedFont(StandardFonts.Helvetica);
  const helvB = await metricsDoc.embedFont(StandardFonts.HelveticaBold);
  let allFit = true;
  for (const f of converted) {
    const font = f.font === 'Helvetica-Bold' ? helvB : helv;
    const w = font.widthOfTextAtSize(f.value, f.fontSize);
    if (w > f.width) {
      allFit = false;
      console.error(`  ordinal ${f.ordinal} (${f.fieldKey}): text width ${w.toFixed(1)} exceeds box width ${f.width.toFixed(1)}`);
    }
  }
  check(`every converted field's value fits its assigned width (${converted.length} checked)`, allFit);

  // 5. Extracted text spot-check: a sample of non-empty text-field values
  // (not checkbox marks, whose "X" glyph is not reliably isolatable as a
  // standalone pdftotext token) are actually present in the output.
  const extractedText = pdftotextAllPages(OUTPUT_PDF_PATH);
  const textSample = converted.filter((f) => f.value !== '' && f.align !== 'center');
  const missing = textSample.filter((f) => !extractedText.includes(f.value));
  check(`extracted text contains the value for every sampled non-empty text field (${textSample.length} sampled, 0 missing)`, missing.length === 0);
  if (missing.length > 0) {
    for (const m of missing) console.error(`  MISSING ordinal ${m.ordinal} (${m.fieldKey}): "${m.value}"`);
  }
  check(
    'extracted text contains the As-Is checkbox "X" adjacent to its paragraph (technically extractable, exact token boundary not guaranteed by pdftotext reading order)',
    /q\s*X\s*\(2\)\s*Buyer accepts the Property As Is provided Seller/.test(extractedText)
  );

  // 6. Coordinate metadata completeness, bounds, and duplicate-value consistency.
  const placementsRecord = JSON.parse(fs.readFileSync(PLACEMENTS_JSON_PATH, 'utf8'));
  const requiredKeys = ['ordinal', 'fieldKey', 'page', 'x', 'y', 'width', 'height', 'font', 'fontSize', 'align', 'destination', 'value'];
  check(
    `placements.json records exactly ${converted.length} converted fields`,
    placementsRecord.fields.length === converted.length
  );
  check(
    'every recorded field carries all required coordinate metadata',
    placementsRecord.fields.every((f) => requiredKeys.every((k) => f[k] !== undefined))
  );
  check(`placements.json records exactly ${deferred.length} deferred rows, each with a reason`, placementsRecord.deferred.length === deferred.length && placementsRecord.deferred.every((d) => typeof d.reason === 'string' && d.reason.length > 0));

  let boundsOk = true;
  try {
    validatePlacementGeometry(converted);
  } catch (e) {
    boundsOk = false;
    console.error('  ' + e.message);
  }
  check('all converted fields are within page bounds and mutually non-overlapping on their page', boundsOk);

  let pageSizeOk = true;
  for (const field of converted) {
    const page = outputDoc.getPage(field.page - 1);
    const { width, height } = page.getSize();
    if (Math.round(width) !== PAGE_WIDTH_PT || Math.round(height) !== PAGE_HEIGHT_PT) pageSizeOk = false;
  }
  check(`every field's page dimensions are the expected US Letter size (${PAGE_WIDTH_PT}x${PAGE_HEIGHT_PT}pt)`, pageSizeOk);

  let duplicatesOk = true;
  try {
    validateDuplicateConsistency(converted);
  } catch (e) {
    duplicatesOk = false;
    console.error('  ' + e.message);
  }
  check('every duplicate-key group (address, sales-price, lease/leaseback markers) shares byte-identical text across all its placements', duplicatesOk);
  const addressGroup = converted.filter((f) => f.fieldKey === 'identity.propertyStreetAddress');
  check(`identity.propertyStreetAddress is converted at 2 physical placements (ordinals 8 and 19), sharing one value`, addressGroup.length === 2 && addressGroup.every((f) => f.value === addressGroup[0].value));
  const salesPriceGroup = converted.filter((f) => f.fieldKey === 'sales_price_amount_text');
  check(`sales_price_amount_text is converted at 2 physical placements (ordinals 10 and 12), sharing one value`, salesPriceGroup.length === 2 && salesPriceGroup.every((f) => f.value === salesPriceGroup[0].value));

  // 7. Static proof that signature, initials, signer-entered dates, and
  // Effective Date are excluded from IAOS population.
  const EXCLUDED_PATTERN = /signature|initial|signerDate|effectiveDate/i;
  const violatingKeys = converted.filter((f) => EXCLUDED_PATTERN.test(f.fieldKey));
  check('no converted field key references a signature, initial, signer-entered date, or Effective Date', violatingKeys.length === 0);
  const manifestSignerLikeRows = manifestRows.filter((r) => EXCLUDED_PATTERN.test(r.key));
  check('the authoritative manifest itself contains zero signature/initial/signer-date/Effective-Date projection keys (structurally excluded by contract-ghl-projection-model.ts)', manifestSignerLikeRows.length === 0);

  // 8. Deterministic generation: re-run and compare output bytes + extracted text + placements metadata.
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

  // 9. No network or credential dependency exists (static source scan across every new lib file too).
  const scannedFiles = [
    GENERATOR_SCRIPT_PATH,
    path.join(__dirname, 'lib', 'inv67-pdf-field-plan.cjs'),
    path.join(__dirname, 'lib', 'inv67-pdf-anchor-helper.cjs'),
    path.join(__dirname, 'lib', 'inv67-projection-fixture.cjs'),
    path.join(__dirname, 'lib', 'inv67-manifest-parser.cjs'),
  ];
  const forbiddenPatterns = [/require\(['"]https?['"]\)/, /require\(['"]net['"]\)/, /\bfetch\(/, /\baxios\b/, /process\.env\./];
  let noNetwork = true;
  for (const file of scannedFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of forbiddenPatterns) {
      if (re.test(src)) {
        noNetwork = false;
        console.error(`  forbidden pattern ${re} found in ${file}`);
      }
    }
  }
  check('no generator/helper file contains network or credential-access calls', noNetwork);

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
  console.log(`Manifest totals: ${manifestRows.length} rows, ${readyRows.length} Ready, ${visualJudgmentRows.length} Visual judgment.`);
  console.log(`Converted: ${converted.length} (${convertedReady.length} of 98 Ready rows + 2 already-proven Visual-judgment rows). Deferred: ${deferred.length}.`);
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
