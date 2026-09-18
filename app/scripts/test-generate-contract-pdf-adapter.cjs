'use strict';

/**
 * Board #9 Phase B -- runtime callable adapter test.
 * netlify/functions/lib/generate-contract-pdf-adapter.ts.
 *
 * BUNDLED WITH esbuild, NOT the tsc-to-tempdir pattern every other pure
 * model test in this repo uses. That pattern only works for files with NO
 * runtime require() dependency outside the compiled set; this adapter
 * deliberately requires the real inv67-pdf-generator.cjs by its real
 * relative path (../../../scripts/lib/...), which only resolves correctly
 * from the adapter's OWN real on-disk location -- compiling it alone into
 * an arbitrary temp directory would break that require at runtime. esbuild
 * --bundle resolves and inlines it at build time instead, exactly
 * mirroring how Netlify's own esbuild-based function bundler would package
 * this same file for real deployment (see the Board #9 Phase B packaging
 * proof) -- so this test doubles as a second, focused packaging check
 * specific to the adapter itself.
 *
 * FIXTURES ONLY -- no GHL call, no network call, no Production data. The
 * canonical preview/report fixture below reuses the SAME
 * fullyPopulatedNotes() pattern test-contract-authorization-model.cjs and
 * test-contract-send-model.cjs already establish (duplicated, not
 * imported, per this codebase's own "duplicate the pattern, not the code"
 * carrier-file precedent) -- not a new, divergent fixture technique.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const ESBUILD_BIN = path.join(APP, 'node_modules', '.pnpm', 'esbuild@0.25.12', 'node_modules', 'esbuild', 'bin', 'esbuild');
const ADAPTER_SOURCE = path.join(APP, 'netlify', 'functions', 'lib', 'generate-contract-pdf-adapter.ts');
const BUNDLE_DIR = path.join(APP, '.tmp-generate-contract-pdf-adapter-test');
const BUNDLE_PATH = path.join(BUNDLE_DIR, 'adapter-bundle.cjs');

function cleanup() {
  try { fs.rmSync(BUNDLE_DIR, { recursive: true, force: true }); } catch (_) {}
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

// ---- fixture: canonical preview/report, same technique as the existing
// authorization/send-model test suites (see those files for the pattern's
// own provenance) ----

function fullyPopulatedNotes(C, opportunityId, agreementAt) {
  return [
    { body: C.formatPartySignerFactsNote({ opportunityId, at: agreementAt, operator: 'brad', signers: [{ role: 'Seller', displayName: 'Priya Nair', signingAuthorityNote: null }] }) },
    { body: C.formatPropertyLegalDescriptionFactsNote({ opportunityId, at: agreementAt, operator: 'brad', lot: { kind: 'value', value: '9' }, block: { kind: 'value', value: 'C' }, addition: { kind: 'value', value: 'Sunset Ridge' }, county: { kind: 'value', value: 'Hays' }, exclusions: { kind: 'none' }, reservations: { kind: 'none' }, legalMunicipality: { kind: 'municipality', name: 'Kyle' } }) },
    { body: C.formatLeaseDisclosureFactsNote({ opportunityId, at: agreementAt, operator: 'brad', residentialLeases: 'none', fixtureLeases: 'none', naturalResourceLeases: { kind: 'none' } }) },
    { body: C.formatEarnestMoneyOptionFactsNote({ opportunityId, at: agreementAt, operator: 'brad', escrowAgentName: 'Hays County Title', escrowAgentAddress: '1 Center St, Kyle, TX', earnestMoney: { kind: 'amount', amount: 1500 }, optionFee: { kind: 'amount', amount: 250 }, optionPeriodDays: { kind: 'days', days: 10 }, additionalEarnestMoney: { kind: 'none' } }) },
    { body: C.formatTitleSurveyFactsNote({ opportunityId, at: agreementAt, operator: 'brad', titlePolicyExpenseParty: 'seller', titleCompanyName: 'Hays County Title', shortageAmendmentElection: { kind: 'amended', expenseParty: 'buyer' }, surveyElection: { option: 'seller_existing_survey', sellerFurnishDays: 10, ifRejectedExpenseParty: 'seller' }, objectionsText: { kind: 'none' }, objectionsDays: 5, poaMembership: 'is_not_subject' }) },
    { body: C.formatPropertyConditionFactsNote({ opportunityId, at: agreementAt, operator: 'brad', sellerDisclosureNotice: { kind: 'received' }, asIsElection: { kind: 'as_is' }, serviceContractCap: { kind: 'none' }, waterDisclosure: { kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'City of Kyle' } }) },
    { body: C.formatClosingPossessionFactsNote({ opportunityId, at: agreementAt, operator: 'brad', closingDate: '2026-11-01T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } }) },
    { body: C.formatSettlementExpenseFactsNote({ opportunityId, at: agreementAt, operator: 'brad', sellerCreditCap: { kind: 'none' }, sellerPaysBuyerBroker: { kind: 'none' }, buyerPaysSellerBroker: { kind: 'none' } }) },
    { body: C.formatRepresentationFactsNote({ opportunityId, at: agreementAt, operator: 'brad', representation: { kind: 'none' } }) },
    { body: C.formatAddendaApplicabilityFactsNote({ opportunityId, at: agreementAt, operator: 'brad', items: Object.fromEntries(C.ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false])), districtNotices: { kind: 'none' } }) },
    { body: C.formatSellerEquitableInterestDisclosureNote({ opportunityId, at: agreementAt, operator: 'brad', disposition: { kind: 'made', at: agreementAt } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: agreementAt, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: agreementAt, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatSellerNoticeConfirmationFactsNote({ opportunityId, at: agreementAt, operator: 'brad', noticeAddress: '55 Sunset Ridge, Kyle, TX, 78640', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' }, source: 'confirmed_from_contact_record' }) },
    { body: C.formatBuyerBusinessConfigFactsNote({ opportunityId, at: agreementAt, operator: 'brad', noticeAddress: '1 Business Rd, Kyle, TX', noticePhone: '555-0000', noticeEmail: 'buyer@btcllc.example', signerName: 'Brad Thompson', signerRole: 'Manager' }) },
  ];
}

async function main() {
  cleanup();
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  console.log('Bundling the adapter with esbuild (mirrors Netlify\'s own bundler)...');
  execFileSync(process.execPath, [
    ESBUILD_BIN,
    ADAPTER_SOURCE,
    '--bundle', '--platform=node', '--format=cjs', '--target=node18',
    `--outfile=${BUNDLE_PATH}`,
  ], { cwd: APP, stdio: 'inherit' });
  check('esbuild bundled the adapter with zero errors', fs.existsSync(BUNDLE_PATH));

  // Simulates the REAL deployment asset layout `netlify.toml`'s
  // `included_files` declares (docs/ as a sibling of the bundled
  // function) -- this is candidate #2 of inv67-pdf-render-core.cjs's own
  // resolveCanonicalSourcePdfPath() search. Proves the Phase B packaging
  // fix empirically, not just by inspection: WITHOUT this simulated
  // layout, the bundle's baked-in __dirname (confirmed by the earlier
  // packaging proof to reflect the bundle's own output location, not the
  // original source location) makes candidate #1 miss entirely, and this
  // is the fallback that must succeed instead.
  const simulatedDocsDir = path.join(BUNDLE_DIR, 'docs');
  fs.mkdirSync(simulatedDocsDir, { recursive: true });
  fs.copyFileSync(path.join(APP, '..', 'docs', 'TREC Resale Home Contract.pdf'), path.join(simulatedDocsDir, 'TREC Resale Home Contract.pdf'));

  const adapter = require(BUNDLE_PATH);
  check('the bundle exports generateContractPdfFromCanonicalFacts', typeof adapter.generateContractPdfFromCanonicalFacts === 'function');
  check('the bundle exports ContractPdfAdapterError', typeof adapter.ContractPdfAdapterError === 'function');

  // ---- Load the pure model chain needed to build fixtures (tsc-to-tempdir,
  // the standard pattern -- these files have no runtime require() of their
  // own outside the compiled set, unlike the adapter itself). ----
  const MODEL_TMP = path.join(os.tmpdir(), 'inv67-adapter-test-models-' + process.pid);
  fs.rmSync(MODEL_TMP, { recursive: true, force: true });
  fs.mkdirSync(MODEL_TMP, { recursive: true });
  fs.writeFileSync(path.join(MODEL_TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const LIB = path.join(APP, 'src', 'lib');
  const MODEL_SOURCES = [
    path.join(LIB, 'contract-document-model.ts'),
    path.join(LIB, 'contract-facts-model.ts'),
    path.join(LIB, 'seller-contract-facts-carriers.ts'),
    path.join(LIB, 'board9-contract-model.ts'),
    path.join(LIB, 'seller-call-outcome.ts'),
    path.join(LIB, 'seller-call-readiness-carriers.ts'),
  ];
  execSync(
    'npx tsc ' + MODEL_SOURCES.map((s) => '"' + s + '"').join(' ') +
    ' --outDir "' + MODEL_TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
  const D = require(path.join(MODEL_TMP, 'contract-document-model.js'));
  const M = require(path.join(MODEL_TMP, 'contract-facts-model.js'));
  const C = require(path.join(MODEL_TMP, 'seller-contract-facts-carriers.js'));
  const B = require(path.join(MODEL_TMP, 'board9-contract-model.js'));

  const OPP = 'opp-adapter-test-1';
  const AGREEMENT_AT = '2026-09-20T15:00:00.000Z';
  const VERSION = B.initialVersionIdentity(AGREEMENT_AT);
  const notes = fullyPopulatedNotes(C, OPP, AGREEMENT_AT);
  const report = M.computeSellerContractFactsReport({ opportunityId: OPP, notes, agreedPrice: 349000, agreementAt: AGREEMENT_AT, propertyAddress: '55 Sunset Ridge, Kyle, TX, 78640' });
  const preview = D.buildContractDocumentPreview({
    opportunityId: OPP, version: VERSION, report,
    propertyStreetAddress: { kind: 'populated', value: '55 Sunset Ridge, Kyle, TX, 78640', authority: 'operator_attested', recordedAt: AGREEMENT_AT },
  });
  check('fixture sanity: the built preview IS previewComplete', preview.previewComplete === true);

  // ---- 1. Happy path: canonical facts in, PDF bytes + evidence out. ----
  const result = await adapter.generateContractPdfFromCanonicalFacts({
    opportunityId: OPP, preview, report, sellerReadiness: { ok: true },
  });
  check('adapter returned non-empty output bytes', result.outputBytes instanceof Uint8Array && result.outputBytes.length > 1000000);
  check('adapter returned a complete projection plan (ok: true)', result.projectionPlan.ok === true);
  check('evidence carries the generator version', typeof result.evidence.generatorVersion === 'string' && result.evidence.generatorVersion.length > 0);
  check('evidence carries the manifest version', typeof result.evidence.manifestVersion === 'string' && result.evidence.manifestVersion.length > 0);
  check('evidence carries the source PDF SHA-256', /^[0-9a-f]{64}$/.test(result.evidence.sourceSha256));
  check('evidence carries the generated-artifact SHA-256', /^[0-9a-f]{64}$/.test(result.evidence.outputSha256));
  check('evidence reports 133/133 populated, 0 deferred', result.evidence.manifestTotals.totalRows === 133 && result.evidence.manifestTotals.convertedCount === 133 && result.evidence.manifestTotals.deferredCount === 0);
  check('evidence carries the opportunity id', result.evidence.opportunityId === OPP);

  // Text content sanity, via pdftotext, matching this fixture's own facts.
  const tmpPdf = path.join(BUNDLE_DIR, 'adapter-output.pdf');
  fs.writeFileSync(tmpPdf, result.outputBytes);
  const extracted = execFileSync('pdftotext', ['-layout', tmpPdf, '-'], { encoding: 'utf8' });
  check('generated output contains this fixture\'s own seller name', extracted.includes('Priya Nair'));
  check('generated output contains this fixture\'s own property address', extracted.includes('Sunset Ridge'));

  // ---- 2. Determinism: identical input twice yields byte-identical output. ----
  const second = await adapter.generateContractPdfFromCanonicalFacts({ opportunityId: OPP, preview, report, sellerReadiness: { ok: true } });
  check('re-running the adapter against identical canonical facts yields a byte-identical artifact hash', second.evidence.outputSha256 === result.evidence.outputSha256);

  // ---- 3. Fail closed: an incomplete preview never reaches the generator. ----
  const incompleteReport = M.computeSellerContractFactsReport({ opportunityId: OPP, notes: [], agreedPrice: 349000, agreementAt: AGREEMENT_AT, propertyAddress: null });
  const incompletePreview = D.buildContractDocumentPreview({ opportunityId: OPP, version: VERSION, report: incompleteReport, propertyStreetAddress: { kind: 'unresolved' } });
  check('fixture sanity: the incomplete preview is genuinely NOT previewComplete', incompletePreview.previewComplete === false);
  let refused = false;
  let refusalReasons = null;
  try {
    await adapter.generateContractPdfFromCanonicalFacts({ opportunityId: OPP, preview: incompletePreview, report: incompleteReport, sellerReadiness: { ok: true } });
  } catch (e) {
    refused = e instanceof adapter.ContractPdfAdapterError;
    refusalReasons = e.reasons;
  }
  check('the adapter refuses an incomplete canonical-facts bundle (fails closed before ever reaching the generator)', refused);
  check('the refusal carries the projection plan\'s own blocking reasons', Array.isArray(refusalReasons) && refusalReasons.length > 0);

  // ---- 4. Fail closed: a non-ok sellerReadiness also blocks generation. ----
  let refusedReadiness = false;
  try {
    await adapter.generateContractPdfFromCanonicalFacts({ opportunityId: OPP, preview, report, sellerReadiness: { ok: false, reasons: [{ code: 'TEST_NOT_READY', message: 'test' }] } });
  } catch (e) {
    refusedReadiness = e instanceof adapter.ContractPdfAdapterError;
  }
  check('the adapter refuses when sellerReadiness itself is not ok', refusedReadiness);

  fs.rmSync(MODEL_TMP, { recursive: true, force: true });
  cleanup();

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
  cleanup();
  process.exitCode = 1;
});
