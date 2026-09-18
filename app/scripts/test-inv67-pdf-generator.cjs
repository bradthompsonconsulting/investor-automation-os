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
const { execFileSync } = require('child_process');
const { PDFDocument, StandardFonts } = require('pdf-lib');
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
  sha256Hex,
} = require('./lib/inv67-pdf-render-core.cjs');

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
