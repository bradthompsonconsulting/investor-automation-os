'use strict';

/**
 * Board #9 Phase B -- authorization schema v2 (artifact binding) -- pure
 * model/carrier test runner.
 *
 * Focused, dedicated to the v2-specific behavior added on top of the
 * already-comprehensive B9-07/INV-62 suite (test-contract-authorization-
 * model.cjs, unaffected in intent by this change -- its own call sites
 * were threaded with a well-formed artifact bundle, re-run green
 * separately): round-trip of the four new fields, legacy v1 recognition
 * without ever being treated as current, each of the four new currency
 * failure reasons (artifact/source/generator/manifest changed), the
 * unchanged-current case, build-time artifact validation, and the
 * FAIL-CLOSED CORRECTION -- currentArtifactFacts is REQUIRED for currency
 * evaluation; omitting it, passing null, or passing a malformed bundle
 * must never produce `authorized: true`, even against an otherwise fully
 * current v2 record.
 *
 * Same compile-to-temp-dir convention as every other pure-model test in
 * this repo -- no I/O beyond that one-time compile step, no GHL, no
 * network, no Production data.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-authorization-v2-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-authorization-model.ts'),
  path.join(LIB, 'contract-authorization-carriers.ts'),
  path.join(LIB, 'contract-document-model.ts'),
  path.join(LIB, 'contract-facts-model.ts'),
  path.join(LIB, 'seller-contract-facts-carriers.ts'),
  path.join(LIB, 'board9-contract-model.ts'),
  path.join(LIB, 'seller-call-outcome.ts'),
  path.join(LIB, 'seller-call-readiness-carriers.ts'),
];

try {
  execSync(
    'npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') +
    ' --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const A = require(path.join(TMP, 'contract-authorization-model.js'));
const K = require(path.join(TMP, 'contract-authorization-carriers.js'));
const D = require(path.join(TMP, 'contract-document-model.js'));
const M = require(path.join(TMP, 'contract-facts-model.js'));
const C = require(path.join(TMP, 'seller-contract-facts-carriers.js'));
const B = require(path.join(TMP, 'board9-contract-model.js'));

const FLOOR = 30;
let failures = 0;
let checks = 0;

function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log('PASS  ' + name);
  } else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }

const OPP = 'opp-v2-1';
const AGREEMENT_AT = '2026-09-06T15:00:00.000Z';
const AT = '2026-09-18T10:00:00.000Z';
const VERSION = B.initialVersionIdentity(AGREEMENT_AT);
const POPULATED_ADDRESS = { kind: 'populated', value: '918 Elm St, Cedar Park, TX, 78613', authority: 'operator_attested', recordedAt: AGREEMENT_AT };

function baseFactsArgs(over) {
  return Object.assign({
    opportunityId: OPP, notes: [], agreedPrice: 412750, agreementAt: AGREEMENT_AT,
    propertyAddress: '918 Elm St, Cedar Park, TX, 78613',
  }, over || {});
}

// Duplicated from test-contract-authorization-model.cjs, not imported --
// same "duplicate the pattern, not the code" precedent this codebase's own
// carrier files (and that test) already establish, so this file has no
// import-time coupling to the other test.
function fullyPopulatedNotes(opportunityId) {
  return [
    { body: C.formatPartySignerFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', signers: [{ role: 'Seller', displayName: 'Marcus Holloway', signingAuthorityNote: null }] }) },
    { body: C.formatPropertyLegalDescriptionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', lot: { kind: 'value', value: '22' }, block: { kind: 'value', value: 'B' }, addition: { kind: 'value', value: 'Willowbrook Heights' }, county: { kind: 'value', value: 'Williamson' }, exclusions: { kind: 'none' }, reservations: { kind: 'none' }, legalMunicipality: { kind: 'municipality', name: 'Cedar Park' } }) },
    { body: C.formatLeaseDisclosureFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', residentialLeases: 'none', fixtureLeases: 'none', naturalResourceLeases: { kind: 'none' } }) },
    { body: C.formatEarnestMoneyOptionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', escrowAgentName: 'Williamson Title Co', escrowAgentAddress: '1 Main St, Cedar Park, TX', earnestMoney: { kind: 'amount', amount: 1000 }, optionFee: { kind: 'amount', amount: 200 }, optionPeriodDays: { kind: 'days', days: 10 }, additionalEarnestMoney: { kind: 'none' } }) },
    { body: C.formatTitleSurveyFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', titlePolicyExpenseParty: 'seller', titleCompanyName: 'Williamson Title Co', shortageAmendmentElection: { kind: 'amended', expenseParty: 'buyer' }, surveyElection: { option: 'seller_existing_survey', sellerFurnishDays: 10, ifRejectedExpenseParty: 'seller' }, objectionsText: { kind: 'none' }, objectionsDays: 5, poaMembership: 'is_not_subject' }) },
    { body: C.formatPropertyConditionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', sellerDisclosureNotice: { kind: 'received' }, asIsElection: { kind: 'as_is' }, serviceContractCap: { kind: 'none' }, waterDisclosure: { kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'City of Cedar Park' } }) },
    { body: C.formatClosingPossessionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', closingDate: '2026-10-15T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } }) },
    { body: C.formatSettlementExpenseFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', sellerCreditCap: { kind: 'none' }, sellerPaysBuyerBroker: { kind: 'none' }, buyerPaysSellerBroker: { kind: 'none' } }) },
    { body: C.formatRepresentationFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', representation: { kind: 'none' } }) },
    { body: C.formatAddendaApplicabilityFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', items: Object.fromEntries(C.ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false])), districtNotices: { kind: 'none' } }) },
    { body: C.formatSellerEquitableInterestDisclosureNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', disposition: { kind: 'made', at: AGREEMENT_AT } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatSellerNoticeConfirmationFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '918 Elm St, Cedar Park, TX, 78613', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' }, source: 'confirmed_from_contact_record' }) },
    { body: C.formatBuyerBusinessConfigFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '1 Business Rd, Cedar Park, TX', noticePhone: '555-0000', noticeEmail: 'buyer@btcllc.example', signerName: 'Brad Thompson', signerRole: 'Manager' }) },
  ];
}

function buildCompletePreview(opportunityId, version) {
  const notes = fullyPopulatedNotes(opportunityId);
  const report = M.computeSellerContractFactsReport(baseFactsArgs({ opportunityId, notes }));
  return D.buildContractDocumentPreview({ opportunityId, version, report, propertyStreetAddress: POPULATED_ADDRESS });
}

const preview = buildCompletePreview(OPP, VERSION);
checkTrue('fixture sanity: the fixture preview IS previewComplete', preview.previewComplete === true);

const ARTIFACT = {
  artifactSha256: '2a9c99590a5c676cd9d9e84e200cb042c9f2a24287e858fc56f69b0ce9518c59',
  sourcePdfSha256: '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5',
  generatorVersion: 'inv67-pdf-generator-v1',
  manifestVersion: 'INV67_TEMPLATE_PLACEMENT_MANIFEST_V1',
};

// ============================================================
// 1. Schema version / header bump.
// ============================================================
{
  check('the current ledger version is v2', K.BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION, 'iaos-brad-contract-authorization-v2');
  check('the preserved legacy ledger version is still v1, unchanged', K.BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION_V1, 'iaos-brad-contract-authorization-v1');
}

// ============================================================
// 2. Round-trip: v2 note carries all four new fields exactly.
// ============================================================
let v2Record;
let v2NoteBody;
{
  const built = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, preview, currentVersion: VERSION, artifact: ARTIFACT });
  checkTrue('building a v2 authorization record succeeds with well-formed artifact evidence', built.ok === true);
  check('the built record carries the artifact SHA-256 verbatim', built.value.artifactSha256, ARTIFACT.artifactSha256);
  check('the built record carries the source-PDF SHA-256 verbatim', built.value.sourcePdfSha256, ARTIFACT.sourcePdfSha256);
  check('the built record carries the generator version verbatim', built.value.generatorVersion, ARTIFACT.generatorVersion);
  check('the built record carries the manifest version verbatim', built.value.manifestVersion, ARTIFACT.manifestVersion);

  v2NoteBody = K.formatBradContractAuthorizationNote(built.value);
  v2Record = K.parseBradContractAuthorizationNote(v2NoteBody);
  checkTrue('the v2 note parses back successfully', v2Record !== null);
  check('round-trip preserves artifactSha256 exactly', v2Record.artifactSha256, ARTIFACT.artifactSha256);
  check('round-trip preserves sourcePdfSha256 exactly', v2Record.sourcePdfSha256, ARTIFACT.sourcePdfSha256);
  check('round-trip preserves generatorVersion exactly', v2Record.generatorVersion, ARTIFACT.generatorVersion);
  check('round-trip preserves manifestVersion exactly', v2Record.manifestVersion, ARTIFACT.manifestVersion);
  check('round-trip preserves every pre-existing v1 field too (opportunityId)', v2Record.opportunityId, OPP);
}

// ============================================================
// 3. Legacy v1 records: parseable under the legacy name, invisible to the
//    current (v2) parser/latest lookup, never current.
// ============================================================
{
  const v1Body = K.formatBradContractAuthorizationNoteLegacyV1({
    opportunityId: OPP, at: '2026-09-10T09:00:00.000Z', operator: 'brad', authorizedBy: 'brad',
    version: VERSION, templateName: preview.templateName, templateSource: preview.templateSource,
    documentLines: A.buildAuthorizedContentSnapshot(preview).documentLines,
    additionalRequiredFacts: A.buildAuthorizedContentSnapshot(preview).additionalRequiredFacts,
  });

  checkTrue('a real v1-shaped note parses successfully via the LEGACY parser', K.parseBradContractAuthorizationNoteLegacyV1(v1Body) !== null);
  check('the CURRENT (v2) parser does NOT recognize a v1-shaped note', K.parseBradContractAuthorizationNote(v1Body), null);

  const notesWithOnlyV1 = [{ body: v1Body }];
  check('latestBradContractAuthorizationForOpportunity (v2-scoped) finds NOTHING when only a v1 note exists', K.latestBradContractAuthorizationForOpportunity(notesWithOnlyV1, OPP), null);
  checkTrue('latestLegacyBradContractAuthorizationV1ForOpportunity DOES find the v1 note (recognition preserved)', K.latestLegacyBradContractAuthorizationV1ForOpportunity(notesWithOnlyV1, OPP) !== null);

  const statusWithOnlyV1 = A.evaluateBradAuthorizationCurrency(K.latestBradContractAuthorizationForOpportunity(notesWithOnlyV1, OPP), preview, ARTIFACT);
  checkTrue('an opportunity with ONLY a v1 authorization is NOT authorized for a generated PDF', statusWithOnlyV1.authorized === false);
  check('the refusal names no recorded (v2) authorization -- the v1 record is structurally invisible, not a distinct rejection path', statusWithOnlyV1.reasons.map((r) => r.code), ['NO_AUTHORIZATION_RECORDED']);

  // Mixed history: a v1 note plus a real v2 note for the SAME opportunity --
  // the v2 note must still be the one found and used, the v1 note ignored.
  const mixedNotes = [{ body: v1Body }, { body: v2NoteBody }];
  const foundLatest = K.latestBradContractAuthorizationForOpportunity(mixedNotes, OPP);
  checkTrue('with a mixed v1+v2 history, the v2 note is found', foundLatest !== null);
  check('the found record is exactly the v2 one (by its artifact hash)', foundLatest.artifactSha256, ARTIFACT.artifactSha256);
}

// ============================================================
// 4. Malformed artifact hash in a note body fails to parse (shape guard).
// ============================================================
{
  const built = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, preview, currentVersion: VERSION, artifact: ARTIFACT });
  const tamperedBody = K.formatBradContractAuthorizationNote(Object.assign({}, built.value, { artifactSha256: 'not-a-real-hash' }));
  check('a note with a malformed (non-hex, wrong-length) artifact hash fails to parse', K.parseBradContractAuthorizationNote(tamperedBody), null);

  const shortHashBody = K.formatBradContractAuthorizationNote(Object.assign({}, built.value, { sourcePdfSha256: 'abc123' }));
  check('a note with a too-short source-PDF hash fails to parse', K.parseBradContractAuthorizationNote(shortHashBody), null);

  const emptyGeneratorBody = K.formatBradContractAuthorizationNote(Object.assign({}, built.value, { generatorVersion: '' }));
  check('a note with an empty generator version fails to parse', K.parseBradContractAuthorizationNote(emptyGeneratorBody), null);
}

// ============================================================
// 5. buildAuthorizationRecordArgs fails closed on missing/malformed
//    artifact evidence -- BEFORE any record is built.
// ============================================================
{
  const missingArtifact = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, preview, currentVersion: VERSION, artifact: undefined });
  checkTrue('omitting artifact evidence entirely is refused', missingArtifact.ok === false);
  check('the refusal names ARTIFACT_FACTS_INVALID', missingArtifact.reasons.map((r) => r.code), ['ARTIFACT_FACTS_INVALID']);

  const malformedArtifact = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, preview, currentVersion: VERSION, artifact: { artifactSha256: 'short', sourcePdfSha256: ARTIFACT.sourcePdfSha256, generatorVersion: '', manifestVersion: ARTIFACT.manifestVersion } });
  checkTrue('malformed artifact fields are refused', malformedArtifact.ok === false);
  checkTrue('the refusal names ARTIFACT_FACTS_INVALID at least once per malformed field (hash + empty version)', malformedArtifact.reasons.filter((r) => r.code === 'ARTIFACT_FACTS_INVALID').length >= 2);

  // Artifact validation and preview/version eligibility are independent --
  // both sets of reasons appear together when both are wrong.
  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null).value;
  const bothWrong = A.buildAuthorizationRecordArgs({ opportunityId: OPP, at: AT, preview, currentVersion: bumped, artifact: undefined });
  checkTrue('a stale revision AND missing artifact evidence together are refused', bothWrong.ok === false);
  checkTrue('the refusal includes PREVIEW_STALE', bothWrong.reasons.some((r) => r.code === 'PREVIEW_STALE'));
  checkTrue('the refusal ALSO includes ARTIFACT_FACTS_INVALID', bothWrong.reasons.some((r) => r.code === 'ARTIFACT_FACTS_INVALID'));
}

// ============================================================
// 6. FAIL-CLOSED CORRECTION: a caller can NEVER obtain authorized: true
//    by omitting currentArtifactFacts, or by supplying a malformed
//    bundle -- even against a real, fully current v2 record. This is the
//    specific gap this correction closes: the third argument is REQUIRED,
//    not an optional extra check a caller could skip.
// ============================================================
{
  const statusOmitted = A.evaluateBradAuthorizationCurrency(v2Record, preview, undefined);
  checkTrue('omitting currentArtifactFacts entirely fails closed (never authorized: true)', statusOmitted.authorized === false);
  check('the refusal names exactly ARTIFACT_FACTS_INVALID', statusOmitted.reasons.map((r) => r.code), ['ARTIFACT_FACTS_INVALID']);

  const statusNull = A.evaluateBradAuthorizationCurrency(v2Record, preview, null);
  checkTrue('a null currentArtifactFacts also fails closed', statusNull.authorized === false);
  check('the refusal names exactly ARTIFACT_FACTS_INVALID', statusNull.reasons.map((r) => r.code), ['ARTIFACT_FACTS_INVALID']);

  const statusMalformedHash = A.evaluateBradAuthorizationCurrency(v2Record, preview, { artifactSha256: 'short', sourcePdfSha256: ARTIFACT.sourcePdfSha256, generatorVersion: ARTIFACT.generatorVersion, manifestVersion: ARTIFACT.manifestVersion });
  checkTrue('a malformed (too-short) artifact hash in currentArtifactFacts fails closed', statusMalformedHash.authorized === false);
  check('the refusal names exactly ARTIFACT_FACTS_INVALID', statusMalformedHash.reasons.map((r) => r.code), ['ARTIFACT_FACTS_INVALID']);

  const statusEmptyGenerator = A.evaluateBradAuthorizationCurrency(v2Record, preview, { artifactSha256: ARTIFACT.artifactSha256, sourcePdfSha256: ARTIFACT.sourcePdfSha256, generatorVersion: '', manifestVersion: ARTIFACT.manifestVersion });
  checkTrue('an empty generator version in currentArtifactFacts fails closed', statusEmptyGenerator.authorized === false);
  check('the refusal names exactly ARTIFACT_FACTS_INVALID', statusEmptyGenerator.reasons.map((r) => r.code), ['ARTIFACT_FACTS_INVALID']);

  // A malformed/missing currentArtifactFacts does NOT get papered over by
  // also being wrong about content/version/template -- it fails closed
  // with ARTIFACT_FACTS_INVALID standing alone when everything else is
  // otherwise genuinely current, proving this is a REAL, independent gate,
  // not a check that only fires when something else already failed.
  checkTrue('sanity: the record and preview used above are otherwise genuinely current (isolates ARTIFACT_FACTS_INVALID as the ONLY reason)', A.evaluateBradAuthorizationCurrency(v2Record, preview, ARTIFACT).authorized === true);
}

// ============================================================
// 7. Currency: unchanged-current -- exact matching artifact facts.
// ============================================================
{
  const status = A.evaluateBradAuthorizationCurrency(v2Record, preview, ARTIFACT);
  checkTrue('with every artifact fact matching exactly, authorization remains current', status.authorized === true);
}

// ============================================================
// 8. Currency: changed-artifact.
// ============================================================
{
  const changed = Object.assign({}, ARTIFACT, { artifactSha256: 'b'.repeat(64) });
  const status = A.evaluateBradAuthorizationCurrency(v2Record, preview, changed);
  checkTrue('a changed artifact hash revokes currency', status.authorized === false);
  check('the revocation names exactly ARTIFACT_CHANGED', status.reasons.map((r) => r.code), ['ARTIFACT_CHANGED']);
}

// ============================================================
// 9. Currency: changed-source.
// ============================================================
{
  const changed = Object.assign({}, ARTIFACT, { sourcePdfSha256: 'c'.repeat(64) });
  const status = A.evaluateBradAuthorizationCurrency(v2Record, preview, changed);
  checkTrue('a changed canonical source-PDF hash revokes currency', status.authorized === false);
  check('the revocation names exactly SOURCE_PDF_CHANGED', status.reasons.map((r) => r.code), ['SOURCE_PDF_CHANGED']);
}

// ============================================================
// 10. Currency: changed-generator.
// ============================================================
{
  const changed = Object.assign({}, ARTIFACT, { generatorVersion: 'inv67-pdf-generator-v2' });
  const status = A.evaluateBradAuthorizationCurrency(v2Record, preview, changed);
  checkTrue('a changed generator version revokes currency', status.authorized === false);
  check('the revocation names exactly GENERATOR_CHANGED', status.reasons.map((r) => r.code), ['GENERATOR_CHANGED']);
}

// ============================================================
// 11. Currency: changed-manifest.
// ============================================================
{
  const changed = Object.assign({}, ARTIFACT, { manifestVersion: 'INV67_TEMPLATE_PLACEMENT_MANIFEST_V2' });
  const status = A.evaluateBradAuthorizationCurrency(v2Record, preview, changed);
  checkTrue('a changed manifest version revokes currency', status.authorized === false);
  check('the revocation names exactly MANIFEST_CHANGED', status.reasons.map((r) => r.code), ['MANIFEST_CHANGED']);
}

// ============================================================
// 12. All four artifact checks are independent and can co-occur.
// ============================================================
{
  const allChanged = { artifactSha256: 'd'.repeat(64), sourcePdfSha256: 'e'.repeat(64), generatorVersion: 'x', manifestVersion: 'y' };
  const status = A.evaluateBradAuthorizationCurrency(v2Record, preview, allChanged);
  checkTrue('all four facts changing at once revokes currency', status.authorized === false);
  check('all four reason codes are present together', status.reasons.map((r) => r.code).sort(), ['ARTIFACT_CHANGED', 'GENERATOR_CHANGED', 'MANIFEST_CHANGED', 'SOURCE_PDF_CHANGED'].sort());
}

// ============================================================
// 13. Artifact currency composes with the pre-existing content/version
//     checks rather than replacing them.
// ============================================================
{
  const bumped = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null).value;
  const newerPreview = buildCompletePreview(OPP, bumped);
  const status = A.evaluateBradAuthorizationCurrency(v2Record, newerPreview, ARTIFACT);
  checkTrue('a revision change still revokes currency even when supplying matching artifact facts', status.authorized === false);
  check('the revocation names REVISION_CHANGED (artifact facts alone cannot rescue a stale revision)', status.reasons.map((r) => r.code), ['REVISION_CHANGED']);
}

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
if (checks < FLOOR) {
  console.error('ABORT: only ' + checks + ' checks ran, floor is ' + FLOOR + '. A silent early return would pass 0 checks.');
  cleanup();
  process.exit(11);
}
cleanup();
process.exit(failures === 0 ? 0 : 1);
