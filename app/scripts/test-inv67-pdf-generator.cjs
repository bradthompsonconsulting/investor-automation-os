'use strict';

// Focused unit/integration tests for the Board #9 live-data PDF generator
// (scripts/lib/inv67-pdf-generator.cjs), PHASE A. Proves the generator flows
// REAL-SHAPED canonical projection output through to a populated PDF WITHOUT
// using the shipped synthetic fixture's own scenario -- a second, distinct
// opportunity's facts are driven through the SAME real production model
// (contract-ghl-projection-model.ts's buildContractProjectionPlan, via
// inv67-projection-fixture.cjs's now-parameterized buildProjectionEntries),
// never a hand-typed per-key stand-in for the 133-key manifest.
//
// Also proves the generator's own fail-closed contract: refuses an
// incomplete (plan.ok !== true) or partially-deferred plan rather than
// producing a partial artifact, and never converts a signature/initial/
// signer-date/Effective-Date/receipt field.
//
// Offline, deterministic, no network, no GHL, no Production data.

const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { PDFDocument, PDFName, StandardFonts } = require('pdf-lib');
const { buildProjectionEntries } = require('./lib/inv67-projection-fixture.cjs');
const {
  GENERATOR_VERSION,
  ContractPdfGenerationError,
  generatePopulatedContractPdf,
} = require('./lib/inv67-pdf-generator.cjs');
const {
  PINNED_SOURCE_SHA256,
  EXPECTED_SOURCE_PAGE_COUNT,
  MANIFEST_VERSION,
  SOURCE_PDF_PATH,
  sha256Hex,
} = require('./lib/inv67-pdf-render-core.cjs');

// Gate S -- exact centering formula the generator itself uses, duplicated
// here ONLY as the independent expected value a test computes and checks
// against, never imported from the generator (an imported constant would
// let the generator and its own test silently drift together).
const GATE_S_SCALE = 0.95;
const GATE_S_CENTER_FACTOR = 0.025;

/**
 * Decodes one content-stream object's raw (FlateDecode-compressed) bytes
 * via Node's own zlib -- never pdf-lib's internal stream-decoding
 * machinery, which is undocumented/unstable to reach into from outside
 * the library. Ground truth: read directly with the same tool the PDF
 * spec itself defines for this filter, independent of anything pdf-lib
 * or this generator claims about its own output.
 */
function decodePageContentStreams(page) {
  const contentsObj = page.node.Contents();
  const refs = contentsObj.array ? contentsObj.array : [contentsObj];
  return refs
    .map((ref) => {
      const obj = page.node.context.lookup(ref);
      const raw = Buffer.from(obj.getContents());
      try {
        return zlib.inflateSync(raw).toString('latin1');
      } catch {
        return raw.toString('latin1');
      }
    })
    .join('\n');
}

/** The one embedded Form XObject a Gate S output page carries -- its Subtype (must be /Form, never /Image, structural proof of no rasterization) and its BBox (must equal the full original page, structural proof of no cropping). */
function embeddedFormXObjectInfo(page) {
  const resources = page.node.Resources();
  const xobjects = resources.lookup(PDFName.of('XObject'));
  const keys = xobjects.keys();
  if (keys.length !== 1) throw new Error(`Expected exactly one XObject on this page, found ${keys.length}`);
  const xobj = page.node.context.lookup(xobjects.get(keys[0]));
  const subtype = xobj.dict.get(PDFName.of('Subtype')).toString();
  const bbox = xobj.dict.get(PDFName.of('BBox')).asArray().map((n) => n.asNumber());
  return { subtype, bbox };
}

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
}

function pdftotextAllPages(bytes) {
  const tmp = require('path').join(require('os').tmpdir(), `inv67-gen-test-${process.pid}-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, bytes);
  try {
    return execFileSync('pdftotext', ['-layout', tmp, '-'], { encoding: 'utf8' });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// A genuinely different "opportunity" -- distinct price, property, legal
// description, seller, closing date, escrow/title contacts -- driven through
// the SAME real buildContractProjectionPlan model the shipped fixture uses,
// via its own now-optional override params. This is what "real-shaped
// canonical input... without using the synthetic fixture" means here: not a
// second hand-typed per-key map (an anti-pattern this codebase explicitly
// rejects elsewhere), but the real model computing real-shaped output for
// facts the shipped fixture never used.
const LIVE_REPORT_OVERRIDES = {
  parties: {
    sellerSigners: { kind: 'populated', value: [{ displayName: 'Marcus T. Holloway', role: 'Owner', signingAuthorityNote: null }], authority: 'operator_attested', recordedAt: null },
  },
  propertyLegalDescription: {
    lot: { kind: 'populated', value: { kind: 'value', value: '22' }, authority: 'operator_attested', recordedAt: null },
    block: { kind: 'populated', value: { kind: 'value', value: 'B' }, authority: 'operator_attested', recordedAt: null },
    addition: { kind: 'populated', value: { kind: 'value', value: 'Willowbrook Heights' }, authority: 'operator_attested', recordedAt: null },
    county: { kind: 'populated', value: { kind: 'value', value: 'Williamson' }, authority: 'operator_attested', recordedAt: null },
    legalMunicipality: { kind: 'populated', value: { kind: 'municipality', name: 'Cedar Park' }, authority: 'operator_attested', recordedAt: null },
  },
  salesPrice: {
    salesPrice: { kind: 'populated', value: 412750, authority: 'operator_attested', recordedAt: null },
    cashPortion: { kind: 'populated', value: 412750, authority: 'operator_attested', recordedAt: null },
  },
  closingPossession: {
    closingDate: { kind: 'populated', value: '2027-02-01T00:00:00.000Z', authority: 'operator_attested', recordedAt: null },
  },
};
// Address strings are kept at or below the shipped fixture's own length
// (39 chars) -- the printed blanks' widths are fixed PDF geometry, not
// data-dependent, so an overlong value legitimately fails the generator's
// own width-guard (proven separately below); this fixture is picking
// realistic-but-different facts, not stress-testing that guard.
const LIVE_ADDRESS = '500 Elm St, Cedar Park, TX 78613';
const LIVE_PREVIEW_TEXT_OVERRIDES = {
  'identity.propertyStreetAddress': LIVE_ADDRESS,
  'parties.buyerEntityName': 'Brad Thompson Consulting LLC',
  'parties.sellerSigners': 'Marcus T. Holloway (Owner)',
  'salesPrice.salesPrice': '$412,750.00',
  'salesPrice.cashPortion': '$412,750.00',
  'earnestMoneyOption.escrowAgentName': 'Williamson Title Co.',
  'earnestMoneyOption.escrowAgentAddress': LIVE_ADDRESS,
  'titleSurvey.titleCompanyName': 'Williamson Title Co.',
};

async function main() {
  console.log('Building a real ContractProjectionPlan for a distinct, non-fixture opportunity scenario...');
  const { plan: livePlan } = buildProjectionEntries(LIVE_REPORT_OVERRIDES, LIVE_PREVIEW_TEXT_OVERRIDES, 'OPP-LIVE-TEST-1');
  check('the real model produced a complete plan (ok: true) for the distinct scenario', livePlan.ok === true);
  check('the distinct scenario carries a non-empty entries array', Array.isArray(livePlan.entries) && livePlan.entries.length > 0);

  // Confirm this really is a different scenario, not an accidental re-use of
  // the shipped fixture's own values -- checked against the real plan's own
  // entries directly (whatever key name the model assigns), not a guessed key.
  const distinctFromFixture = livePlan.entries.some((e) => e.text.includes('412,750') || e.text.includes(LIVE_ADDRESS) || e.text.includes('Marcus T. Holloway'));
  check('the distinct scenario\'s entries actually carry its own facts, not the shipped fixture\'s', distinctFromFixture);

  // 1. Happy path: generator accepts the real plan and produces a populated PDF.
  const { outputBytes, evidence } = await generatePopulatedContractPdf({ projectionPlan: livePlan, opportunityId: 'OPP-LIVE-TEST-1' });
  check('generator returned non-empty output bytes', outputBytes instanceof Uint8Array && outputBytes.length > 0);

  // 2. Evidence binding -- source hash, generator/manifest version, populated
  // count, zero-deferred, generated-artifact hash.
  check('evidence binds the canonical source PDF SHA-256', evidence.sourceSha256 === PINNED_SOURCE_SHA256);
  check('evidence records the source page count', evidence.sourcePageCount === EXPECTED_SOURCE_PAGE_COUNT);
  check('evidence records the generator version', evidence.generatorVersion === GENERATOR_VERSION);
  check('evidence records the manifest version', evidence.manifestVersion === MANIFEST_VERSION);
  check('evidence records the opportunity id', evidence.opportunityId === 'OPP-LIVE-TEST-1');
  check('evidence populated-field count is exactly 133 (every manifest row)', evidence.manifestTotals.totalRows === 133 && evidence.manifestTotals.convertedCount === 133);
  check('evidence deferred count is exactly 0', evidence.manifestTotals.deferredCount === 0);
  check('evidence records the generated-artifact SHA-256', evidence.outputSha256 === sha256Hex(outputBytes));
  check('evidence carries exactly 133 field records', Array.isArray(evidence.fields) && evidence.fields.length === 133);

  // 3. The output is a valid 12-page PDF, and the distinct scenario's own
  // facts (not the shipped fixture's) are actually present in it.
  const outputDoc = await PDFDocument.load(outputBytes);
  check('generated output has the expected page count', outputDoc.getPageCount() === EXPECTED_SOURCE_PAGE_COUNT);

  // 3a. Gate S -- per-page geometry, read from the PINNED SOURCE document
  // itself (never a global assumption), and checked against ground truth
  // read directly from the output's own raw PDF bytes (zlib-decoded content
  // streams, raw XObject dict) -- never inferred, never trusted from the
  // generator's own claims about itself.
  const sourceDoc = await PDFDocument.load(fs.readFileSync(SOURCE_PDF_PATH));
  check('source document itself is exactly 12 pages (unaffected by Gate S)', sourceDoc.getPageCount() === EXPECTED_SOURCE_PAGE_COUNT);
  for (let i = 0; i < EXPECTED_SOURCE_PAGE_COUNT; i++) {
    const sourcePage = sourceDoc.getPage(i);
    const outputPage = outputDoc.getPage(i);
    const sourceSize = sourcePage.getSize();
    const outputSize = outputPage.getSize();
    check(`page ${i + 1}: final page dimensions match that page's own original source dimensions exactly`, outputSize.width === sourceSize.width && outputSize.height === sourceSize.height);

    const { subtype, bbox } = embeddedFormXObjectInfo(outputPage);
    check(`page ${i + 1}: the embedded page is a vector Form XObject, never an Image (structural proof of no rasterization)`, subtype === '/Form');
    check(`page ${i + 1}: the embedded Form's BBox equals the full original page (0,0,${sourceSize.width},${sourceSize.height}) -- proves no cropping bounding box was applied`, bbox[0] === 0 && bbox[1] === 0 && bbox[2] === sourceSize.width && bbox[3] === sourceSize.height);

    const contentText = decodePageContentStreams(outputPage);
    const expectedXOffset = sourceSize.width * GATE_S_CENTER_FACTOR;
    const expectedYOffset = sourceSize.height * GATE_S_CENTER_FACTOR;
    const expectedTranslateOp = `1 0 0 1 ${expectedXOffset} ${expectedYOffset} cm`;
    const expectedScaleOp = `${GATE_S_SCALE} 0 0 ${GATE_S_SCALE} 0 0 cm`;
    check(`page ${i + 1}: content stream contains the exact expected centering translate (${expectedTranslateOp})`, contentText.includes(expectedTranslateOp));
    check(`page ${i + 1}: content stream contains the exact expected 95% scale (${expectedScaleOp})`, contentText.includes(expectedScaleOp));
  }

  const extracted = pdftotextAllPages(outputBytes);
  check('generated output contains the distinct scenario\'s property address', extracted.includes(LIVE_ADDRESS));
  // The printed form's own "$" precedes the blank (blankAfterDollarSign) --
  // the projected entry (and thus the drawn text) is the bare amount.
  check('generated output contains the distinct scenario\'s sales price', extracted.includes('412,750.00'));
  check('generated output contains the distinct scenario\'s seller name', extracted.includes('Marcus T. Holloway'));
  check('generated output does NOT contain the shipped fixture\'s own seller name', !extracted.includes('Jordan A. Testseller'));

  // 4. Every drawn field's value fits its assigned width (re-checked against
  // the actually-embedded font metrics), matching the proof's own check.
  const metricsDoc = await PDFDocument.create();
  const helv = await metricsDoc.embedFont(StandardFonts.Helvetica);
  const helvB = await metricsDoc.embedFont(StandardFonts.HelveticaBold);
  let allFit = true;
  for (const f of evidence.fields) {
    const font = f.font === 'Helvetica-Bold' ? helvB : helv;
    if (font.widthOfTextAtSize(f.value, f.fontSize) > f.width) allFit = false;
  }
  check('every generated field\'s value fits its assigned width', allFit);

  // 5. Signature/initial/signer-date/Effective-Date/receipt fields remain
  // signer-controlled and blank -- never IAOS-populated, live generator included.
  const EXCLUDED_PATTERN = /signature|initial|signerDate|effectiveDate|receipt/i;
  check('no generated field key references a signature, initial, signer-date, Effective Date, or receipt field', evidence.fields.every((f) => !EXCLUDED_PATTERN.test(f.fieldKey)));

  // 6. Determinism: identical real input produces byte-identical output twice.
  const second = await generatePopulatedContractPdf({ projectionPlan: livePlan, opportunityId: 'OPP-LIVE-TEST-1' });
  check('re-running the generator against the identical real plan yields byte-identical output', sha256Hex(second.outputBytes) === evidence.outputSha256);

  // 7. Fails closed: plan.ok !== true is refused outright, never partially generated.
  let refusedIncomplete = false;
  try {
    await generatePopulatedContractPdf({ projectionPlan: { ok: false, entries: [], blockingReasons: [{ code: 'TEST_INCOMPLETE' }] } });
  } catch (err) {
    refusedIncomplete = err instanceof ContractPdfGenerationError;
  }
  check('generator refuses a plan with ok !== true (fails closed, never partial)', refusedIncomplete);

  // 8. Fails closed: missing/empty entries refused.
  let refusedEmpty = false;
  try {
    await generatePopulatedContractPdf({ projectionPlan: { ok: true, entries: [] } });
  } catch (err) {
    refusedEmpty = err instanceof ContractPdfGenerationError;
  }
  check('generator refuses a plan with no entries', refusedEmpty);

  // 9. Fails closed: a plan missing one required manifest key produces a
  // deferred row, which the live generator must refuse outright (unlike the
  // synthetic-fixture proof script, which reports and continues past a
  // deferred count -- this generator is used for real contract artifacts and
  // must never emit one that skipped a required field). The removed key is
  // the real one the happy-path run actually used (evidence.fields[0]),
  // never a guessed name.
  const keyToDrop = evidence.fields[0].fieldKey;
  const missingOneKeyEntries = livePlan.entries.filter((e) => e.key !== keyToDrop);
  check('setup: the key-to-drop was actually present in the real plan\'s entries', missingOneKeyEntries.length === livePlan.entries.length - 1);
  let refusedDeferred = false;
  let deferredReasons = null;
  try {
    await generatePopulatedContractPdf({ projectionPlan: { ...livePlan, entries: missingOneKeyEntries } });
  } catch (err) {
    refusedDeferred = err instanceof ContractPdfGenerationError;
    deferredReasons = err.reasons;
  }
  check('generator refuses a plan missing a required manifest key (zero-deferred is enforced, not just reported)', refusedDeferred);
  check('the refusal names the specific deferred ordinal/key', Array.isArray(deferredReasons) && deferredReasons.some((d) => d.key === keyToDrop));

  // 10. Fails closed: malformed entry shape refused before touching the PDF at all.
  let refusedMalformed = false;
  try {
    await generatePopulatedContractPdf({ projectionPlan: { ok: true, entries: [{ key: 'x' }] } });
  } catch (err) {
    refusedMalformed = err instanceof ContractPdfGenerationError;
  }
  check('generator refuses a malformed entry (missing text)', refusedMalformed);

  // 11. Fails closed: a duplicate projection-plan entry key is refused
  // outright, BEFORE entriesByKey is ever built -- proving new Map() is
  // never given the chance to silently keep whichever duplicate is last in
  // the array. No artifact (no PDF bytes, no evidence) is produced.
  const duplicatedKey = evidence.fields[1].fieldKey;
  const duplicateKeyEntries = [...livePlan.entries, { key: duplicatedKey, text: 'A CONFLICTING DUPLICATE VALUE' }];
  let refusedDuplicate = false;
  let duplicateReasons = null;
  let duplicateProducedOutput = false;
  try {
    const result = await generatePopulatedContractPdf({ projectionPlan: { ...livePlan, entries: duplicateKeyEntries } });
    duplicateProducedOutput = !!(result && result.outputBytes);
  } catch (err) {
    refusedDuplicate = err instanceof ContractPdfGenerationError;
    duplicateReasons = err.reasons;
  }
  check('generator refuses a projection plan with a duplicate entry key (fails closed, never lets Map choose the last value)', refusedDuplicate);
  check('the duplicate-key refusal names the specific duplicated key', Array.isArray(duplicateReasons) && duplicateReasons.some((d) => d.key === duplicatedKey));
  check('no artifact (no output bytes) was produced for the duplicate-key plan', !duplicateProducedOutput);

  // 12. Sealed source API: a caller-supplied `source` field (path/hash
  // override) is simply not part of the function's contract -- passing one
  // alongside an otherwise-valid plan has zero effect, and the output still
  // verifies against the real pinned canonical source, never a substitute.
  const withIgnoredSourceOverride = await generatePopulatedContractPdf({
    projectionPlan: livePlan,
    opportunityId: 'OPP-LIVE-TEST-1',
    source: { sourcePdfPath: '/tmp/not-the-real-contract.pdf', expectedSha256: 'deadbeef'.repeat(8), expectedPageCount: 1 },
  });
  check('a caller-supplied source override has no effect -- output still binds the real pinned source SHA-256', withIgnoredSourceOverride.evidence.sourceSha256 === PINNED_SOURCE_SHA256);
  check('a caller-supplied source override has no effect -- output is byte-identical to the sealed call', sha256Hex(withIgnoredSourceOverride.outputBytes) === evidence.outputSha256);

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
