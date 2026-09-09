/**
 * Board #9 authoritative contract data/state/persistence/audit model --
 * test runner. B9-03 / INV-58.
 *
 * Compiles board9-contract-model.ts and its two dependencies
 * (seller-call-outcome.ts, seller-call-readiness-carriers.ts -- both
 * already-shipped, unmodified Board #8/#9 carriers this module consumes
 * types from) to a temp directory, loads the emitted JavaScript, and runs
 * deterministic table-driven cases. No GHL, no network, no fixture, no
 * React.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-board9-contract-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
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

const modelPath = path.join(TMP, 'board9-contract-model.js');
if (!fs.existsSync(modelPath)) {
  console.error('ABORT: expected compiled output at ' + modelPath);
  cleanup();
  process.exit(11);
}

const M = require(modelPath);

/**
 * Compiled output, comments stripped -- for structural checks that must
 * not false-positive on this module's own doc comments discussing GHL,
 * providers, or carriers to EXPLAIN why none is invented here.
 */
const compiledNoComments = execSync(
  'npx tsc "' + path.join(LIB, 'board9-contract-model.ts') + '" --outDir "' + TMP + '-nocomments" --module commonjs --target es2020 --strict --removeComments',
  { cwd: APP }
) && fs.readFileSync(path.join(TMP + '-nocomments', 'board9-contract-model.js'), 'utf8');
fs.rmSync(TMP + '-nocomments', { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 149;
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

function fullSnapshot(over) {
  return Object.assign({
    sellerPosition: 250000, currentOffer: 190000, targetAcquisitionPrice: 169551,
    maxSupportedOffer: 176363, expectedSpread: 5000, arv: 315000, repairs: 41000,
    readinessStatus: 'OFFER_READY',
  }, over || {});
}

const fullChecklist = {
  legal_owners: true, closing_timeline: true, occupancy_possession: true,
  liens_title: true, delivery_signing: true,
};

// ============================================================
// 1. State vocabulary: meanings are locked verbatim, order is frozen,
//    no-reentry and correction-eligibility hold for exactly the right
//    states.
// ============================================================
{
  check('primary state order is the frozen four-state sequence', M.PRIMARY_CONTRACT_STATE_ORDER, ['agreement_reached', 'contract_ready', 'contract_sent', 'under_contract']);

  const meaningKeys = Object.keys(M.CONTRACT_STATE_MEANING).sort();
  check('every state (primary + terminal) has exactly one locked meaning, no extra keys', meaningKeys, ['agreement_reached', 'contract_ready', 'contract_sent', 'declined', 'expired', 'rescinded', 'under_contract'].sort());
  check('agreement_reached meaning cites Board 8 negotiation completion', M.CONTRACT_STATE_MEANING.agreement_reached.indexOf('Board #8') >= 0, true);
  check('under_contract meaning states it is the ONLY binding-contract state', M.CONTRACT_STATE_MEANING.under_contract.indexOf('only state') >= 0, true);
  check('contract_sent meaning explicitly states NOT YET executed', M.CONTRACT_STATE_MEANING.contract_sent.indexOf('not yet executed') >= 0, true);

  check('agreement_reached is NOT terminal/no-reentry', M.isTerminalNoReentry('agreement_reached'), false);
  check('contract_ready is NOT terminal/no-reentry', M.isTerminalNoReentry('contract_ready'), false);
  check('contract_sent is NOT terminal/no-reentry', M.isTerminalNoReentry('contract_sent'), false);
  check('under_contract IS terminal/no-reentry (preserved exactly as reached, per its own Transition trigger OUT: None)', M.isTerminalNoReentry('under_contract'), true);
  check('rescinded IS terminal/no-reentry', M.isTerminalNoReentry('rescinded'), true);
  check('expired IS terminal/no-reentry', M.isTerminalNoReentry('expired'), true);
  check('declined IS terminal/no-reentry', M.isTerminalNoReentry('declined'), true);

  check('correction is NOT eligible before anything has been sent (agreement_reached)', M.isCorrectionEligible('agreement_reached'), false);
  check('correction is NOT eligible before anything has been sent (contract_ready)', M.isCorrectionEligible('contract_ready'), false);
  check('correction IS eligible once sent (contract_sent)', M.isCorrectionEligible('contract_sent'), true);
  check('correction IS eligible after full execution (under_contract, per "whether or not the prior version has already reached Under Contract")', M.isCorrectionEligible('under_contract'), true);
  check('correction is NOT eligible for an already-terminal non-execution outcome (rescinded)', M.isCorrectionEligible('rescinded'), false);
}

// ============================================================
// 2. Immutable inherited Board #8 economics: verbatim copy, frozen, and
//    fails closed for any non-accept outcome kind.
// ============================================================
{
  const snap = fullSnapshot();
  const okResult = M.deriveInheritedEconomics({
    opportunityId: 'opp-1', outcomeKind: 'accept', agreementAt: '2026-09-06T15:00:00.000Z', economics: snap,
  });
  check('deriveInheritedEconomics succeeds for an accept-kind outcome', okResult.ok, true);
  check('economics are copied VERBATIM, never recomputed', okResult.value.economics, snap);
  check('agreementAt is carried through as the durable identity', okResult.value.agreementAt, '2026-09-06T15:00:00.000Z');
  check('authority is the single named source, never a second competing one', okResult.value.authority, 'board8_agreement_reached_outcome');
  check('the returned value is frozen (immutable inherited economics)', Object.isFrozen(okResult.value), true);
  check('the nested economics snapshot is ALSO frozen', Object.isFrozen(okResult.value.economics), true);

  const followUpResult = M.deriveInheritedEconomics({
    opportunityId: 'opp-1', outcomeKind: 'follow_up', agreementAt: '2026-09-06T15:00:00.000Z', economics: snap,
  });
  check('deriveInheritedEconomics fails closed for a follow_up outcome (Agreement Reached requires accept)', followUpResult.ok, false);

  const passResult = M.deriveInheritedEconomics({
    opportunityId: 'opp-1', outcomeKind: 'pass', agreementAt: '2026-09-06T15:00:00.000Z', economics: snap,
  });
  check('deriveInheritedEconomics fails closed for a pass outcome', passResult.ok, false);
}

// ============================================================
// 3. Generic contract-fact state: missing / invalid / confirmed.
// ============================================================
{
  check('a null fact is missing', M.evaluateContractFactState(null, () => true), 'missing');
  check('an undefined fact is missing', M.evaluateContractFactState(undefined, () => true), 'missing');
  check('a present fact failing its own validity check is invalid', M.evaluateContractFactState(-5, (v) => v > 0), 'invalid');
  check('a present, valid fact is confirmed', M.evaluateContractFactState(5, (v) => v > 0), 'confirmed');
}

// ============================================================
// 4. Material conflict detection + Corrected classification -- the
//    bright-line case 1 / 2 / 3 test, and "no silent term change."
// ============================================================
{
  const agreement = { price: 200000, propertyAddress: '123 Main St', parties: ['Jane Seller', 'John Seller'] };
  const identical = { price: 200000, propertyAddress: '123 Main St', parties: ['John Seller', 'Jane Seller'] };
  const priceChanged = { price: 205000, propertyAddress: '123 Main St', parties: ['Jane Seller', 'John Seller'] };
  const addressChanged = { price: 200000, propertyAddress: '124 Main St', parties: ['Jane Seller', 'John Seller'] };
  const partyChanged = { price: 200000, propertyAddress: '123 Main St', parties: ['Jane Seller'] };

  check('identical terms (party order-independent) produce zero conflicts', M.detectMaterialConflicts(agreement, identical), []);
  check('a $1 price difference is a material conflict, never rounded away', M.detectMaterialConflicts(agreement, { ...agreement, price: agreement.price + 1 }).length, 1);
  check('a price conflict names the price field with both values', M.detectMaterialConflicts(agreement, priceChanged), [{ field: 'price', agreementValue: '200000', candidateValue: '205000' }]);
  check('an address conflict names the property_address field', M.detectMaterialConflicts(agreement, addressChanged)[0].field, 'property_address');
  check('a dropped party is a material conflict', M.detectMaterialConflicts(agreement, partyChanged)[0].field, 'parties');

  check('metadata-only changes are classified case 3 regardless of any term difference', M.classifyCorrection('internal_metadata', agreement, priceChanged), { kind: 'metadata_only' });
  check('a seller-facing change with NO material difference is case 2 (same-agreement reentry)', M.classifyCorrection('seller_facing_document', agreement, identical), { kind: 'same_agreement_reentry' });
  const case1 = M.classifyCorrection('seller_facing_document', agreement, priceChanged);
  check('a seller-facing PRICE change is case 1 (new agreement required), never absorbed silently', case1.kind, 'new_agreement_required');
  check('case 1 carries the specific conflicts that triggered it', case1.conflicts, [{ field: 'price', agreementValue: '200000', candidateValue: '205000' }]);
}

// ============================================================
// 5. Contract Ready -- derived, with operator-readable reasons for every
//    incomplete item and for a scope mismatch.
// ============================================================
{
  const ready = M.evaluateContractReady({ agreementReached: true, checklist: fullChecklist, checklistScopeMatches: true });
  check('Contract Ready holds when agreement reached and all five items confirmed, scoped correctly', ready, { ready: true, reasons: [] });

  const noAgreement = M.evaluateContractReady({ agreementReached: false, checklist: fullChecklist, checklistScopeMatches: true });
  check('Contract Ready fails closed with no Agreement Reached', noAgreement.ready, false);
  check('the no-agreement reason names AGREEMENT_NOT_REACHED', noAgreement.reasons.some((r) => r.code === 'AGREEMENT_NOT_REACHED'), true);

  const scopeMismatch = M.evaluateContractReady({ agreementReached: true, checklist: fullChecklist, checklistScopeMatches: false });
  check('a checklist scoped to a DIFFERENT agreement never counts as progress toward this one', scopeMismatch.ready, false);
  check('the scope-mismatch reason is distinct from a per-item incomplete reason', scopeMismatch.reasons, [{ code: 'CHECKLIST_SCOPE_MISMATCH', message: 'The Contract Ready checklist on record does not match this agreement\'s own price, address, and agreement timestamp -- it cannot count as progress toward this agreement.' }]);

  const oneMissing = M.evaluateContractReady({ agreementReached: true, checklist: { ...fullChecklist, liens_title: false }, checklistScopeMatches: true });
  check('exactly one unconfirmed item produces exactly one operator-readable reason', oneMissing.reasons.length, 1);
  check('the reason names the specific item, not a generic "incomplete"', oneMissing.reasons[0].message.indexOf('liens/title') >= 0, true);
}

// ============================================================
// 6. Contract Sent eligibility -- three jointly-required facts, each
//    independently reported, per the locked "authorized-not-yet-sent"
//    failure-behavior distinction, PLUS mandatory exact-IAOS-version
//    binding and well-formedness checks on every sub-fact (Jess Gate
//    corrections 1 and 3). Correction 3: the MANDATORY binding is to
//    IAOS's own ContractVersionIdentity (agreementAt/versionSeq), never
//    to a provider documentRevision -- BLOCKED per B9-02 item 9 and must
//    never gate V1's only verified path. documentRevision stays optional,
//    compared only when both sides are actually present.
// ============================================================
{
  const versionA = { agreementAt: '2026-09-06T15:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };
  const versionB_differentSeq = { ...versionA, versionSeq: 2, supersedesVersionSeq: 1 };
  const versionC_differentAgreement = { agreementAt: '2026-09-10T09:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: versionA.agreementAt };

  const fullSent = {
    contractReady: true,
    bradSendAuthorization: { authorizedBy: 'brad', at: '2026-09-09T10:00:00.000Z', authorizedVersion: versionA, authorizedDocumentRevision: 'rev-1' },
    currentVersion: versionA,
    currentDocumentRevision: 'rev-1',
    providerTransmission: { identifier: 'doc-123', at: '2026-09-09T10:05:00.000Z' },
    expiration: { at: '2026-09-11T10:00:00.000Z' },
  };
  // Required test 1: matching IAOS contract identity permits eligibility
  // when all other evidence is valid.
  check('Contract Sent is eligible when the authorized and current IAOS contract version match exactly, plus all other evidence is valid', M.evaluateContractSentEligibility(fullSent), { eligible: true, reasons: [] });

  const authOnly = { ...fullSent, providerTransmission: null };
  const authOnlyResult = M.evaluateContractSentEligibility(authOnly);
  check('authorization alone (no confirmed transmission) is NOT Contract Sent -- fails closed', authOnlyResult.eligible, false);
  check('the authorized-not-sent case names TRANSMISSION_NOT_CONFIRMED specifically', authOnlyResult.reasons.some((r) => r.code === 'TRANSMISSION_NOT_CONFIRMED'), true);

  const notBrad = { ...fullSent, bradSendAuthorization: { ...fullSent.bradSendAuthorization, authorizedBy: 'some-rep' } };
  check('send authorization from anyone other than Brad does not count', M.evaluateContractSentEligibility(notBrad).eligible, false);

  const noExpiration = { ...fullSent, expiration: null };
  check('no explicit expiration blocks Contract Sent even with authorization and transmission both present', M.evaluateContractSentEligibility(noExpiration).eligible, false);

  const notReady = { ...fullSent, contractReady: false };
  check('Contract Sent is never eligible without Contract Ready, even with all three send-specific facts present', M.evaluateContractSentEligibility(notReady).eligible, false);

  // Required test 2: a different agreementAt blocks eligibility.
  const differentAgreement = { ...fullSent, currentVersion: versionC_differentAgreement };
  const differentAgreementResult = M.evaluateContractSentEligibility(differentAgreement);
  check('a CURRENT version with a different agreementAt than what Brad authorized blocks Contract Sent', differentAgreementResult.eligible, false);
  check('the different-agreementAt case names AUTHORIZATION_NOT_BOUND_TO_EXACT_VERSION', differentAgreementResult.reasons.some((r) => r.code === 'AUTHORIZATION_NOT_BOUND_TO_EXACT_VERSION'), true);

  // Required test 3: a different versionSeq blocks eligibility.
  const differentSeq = { ...fullSent, currentVersion: versionB_differentSeq };
  const differentSeqResult = M.evaluateContractSentEligibility(differentSeq);
  check('a CURRENT version with a different versionSeq (same agreementAt) than what Brad authorized blocks Contract Sent', differentSeqResult.eligible, false);
  check('the different-versionSeq case names AUTHORIZATION_NOT_BOUND_TO_EXACT_VERSION', differentSeqResult.reasons.some((r) => r.code === 'AUTHORIZATION_NOT_BOUND_TO_EXACT_VERSION'), true);

  // Required test 4: missing authorization-bound IAOS identity blocks eligibility.
  const missingAuthorizedVersion = { ...fullSent, bradSendAuthorization: { ...fullSent.bradSendAuthorization, authorizedVersion: null } };
  const missingAuthorizedVersionResult = M.evaluateContractSentEligibility(missingAuthorizedVersion);
  check('an authorization that never recorded WHICH IAOS contract version it covers cannot bind to the current one -- fails closed', missingAuthorizedVersionResult.eligible, false);
  check('the missing-authorized-identity case names AUTHORIZATION_NOT_BOUND_TO_EXACT_VERSION', missingAuthorizedVersionResult.reasons.some((r) => r.code === 'AUTHORIZATION_NOT_BOUND_TO_EXACT_VERSION'), true);

  // Required test 5: absent provider documentRevision does NOT block when
  // the exact IAOS contract identity matches -- this is the correction's
  // whole point: GHL's BLOCKED documentRevision must never gate V1.
  const noProviderRevisionEitherSide = {
    ...fullSent,
    bradSendAuthorization: { ...fullSent.bradSendAuthorization, authorizedDocumentRevision: null },
    currentDocumentRevision: null,
  };
  check('Contract Sent is eligible with NO provider documentRevision on either side, as long as the exact IAOS version matches -- GHL BLOCKED fields never gate V1', M.evaluateContractSentEligibility(noProviderRevisionEitherSide), { eligible: true, reasons: [] });

  const onlyOneSideHasRevision = { ...fullSent, currentDocumentRevision: null };
  check('a provider revision present on only ONE side (the other absent) still does not block -- comparison requires BOTH sides present', M.evaluateContractSentEligibility(onlyOneSideHasRevision), { eligible: true, reasons: [] });

  // Required test 6: differing provider revisions block when BOTH are
  // present and comparable.
  const differingProviderRevisions = { ...fullSent, currentDocumentRevision: 'rev-2' };
  const differingProviderRevisionsResult = M.evaluateContractSentEligibility(differingProviderRevisions);
  check('differing provider documentRevisions block Contract Sent when both sides actually carry a value, even though the IAOS version itself still matches', differingProviderRevisionsResult.eligible, false);
  check('the differing-provider-revision case names PROVIDER_DOCUMENT_REVISION_MISMATCH, distinct from the IAOS-version code', differingProviderRevisionsResult.reasons.some((r) => r.code === 'PROVIDER_DOCUMENT_REVISION_MISMATCH'), true);
  check('the differing-provider-revision case does NOT also claim the IAOS version itself is unbound', differingProviderRevisionsResult.reasons.some((r) => r.code === 'AUTHORIZATION_NOT_BOUND_TO_EXACT_VERSION'), false);

  const authTimestampInvalid = { ...fullSent, bradSendAuthorization: { ...fullSent.bradSendAuthorization, at: 'not-a-real-date' } };
  const authTimestampInvalidResult = M.evaluateContractSentEligibility(authTimestampInvalid);
  check('an invalid authorization timestamp blocks Contract Sent -- fails closed', authTimestampInvalidResult.eligible, false);
  check('the invalid-authorization-timestamp case names AUTHORIZATION_TIMESTAMP_INVALID', authTimestampInvalidResult.reasons.some((r) => r.code === 'AUTHORIZATION_TIMESTAMP_INVALID'), true);

  const transmissionIdBlank = { ...fullSent, providerTransmission: { identifier: '   ', at: fullSent.providerTransmission.at } };
  const transmissionIdBlankResult = M.evaluateContractSentEligibility(transmissionIdBlank);
  check('a blank provider transmission identifier blocks Contract Sent -- present-but-blank is not present', transmissionIdBlankResult.eligible, false);
  check('the blank-transmission-identifier case names TRANSMISSION_IDENTIFIER_BLANK', transmissionIdBlankResult.reasons.some((r) => r.code === 'TRANSMISSION_IDENTIFIER_BLANK'), true);

  const transmissionTimestampInvalid = { ...fullSent, providerTransmission: { identifier: 'doc-123', at: 'not-a-real-date' } };
  const transmissionTimestampInvalidResult = M.evaluateContractSentEligibility(transmissionTimestampInvalid);
  check('an invalid provider transmission timestamp blocks Contract Sent -- fails closed', transmissionTimestampInvalidResult.eligible, false);
  check('the invalid-transmission-timestamp case names TRANSMISSION_TIMESTAMP_INVALID', transmissionTimestampInvalidResult.reasons.some((r) => r.code === 'TRANSMISSION_TIMESTAMP_INVALID'), true);

  const expirationTimestampInvalid = { ...fullSent, expiration: { at: 'not-a-real-date' } };
  const expirationTimestampInvalidResult = M.evaluateContractSentEligibility(expirationTimestampInvalid);
  check('an invalid expiration timestamp blocks Contract Sent -- fails closed', expirationTimestampInvalidResult.eligible, false);
  check('the invalid-expiration-timestamp case names EXPIRATION_TIMESTAMP_INVALID', expirationTimestampInvalidResult.reasons.some((r) => r.code === 'EXPIRATION_TIMESTAMP_INVALID'), true);
}

// ============================================================
// 7. Expiration -- derived automatically, never fires on a verified-
//    executed agreement regardless of the clock.
// ============================================================
{
  check('expiration fires once the established timestamp passes with no verified execution', M.isExpired({ expirationAt: '2026-09-11T10:00:00.000Z', now: '2026-09-12T00:00:00.000Z', verifiedExecuted: false }), true);
  check('no expiration before the established timestamp', M.isExpired({ expirationAt: '2026-09-11T10:00:00.000Z', now: '2026-09-10T00:00:00.000Z', verifiedExecuted: false }), false);
  check('a verified-executed agreement never expires, even long past the timestamp', M.isExpired({ expirationAt: '2026-09-11T10:00:00.000Z', now: '2026-09-30T00:00:00.000Z', verifiedExecuted: true }), false);
}

// ============================================================
// 8. Contract version/revision identity -- monotonic within a lineage,
//    a fresh lineage on case 1, no version from a metadata-only change,
//    and revision-bound authorization invalidation.
// ============================================================
{
  const v1 = M.initialVersionIdentity('2026-09-06T15:00:00.000Z');
  check('the initial version identity is version 1 of its own agreement, superseding nothing', v1, { agreementAt: '2026-09-06T15:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null });

  const reentry = M.nextVersionIdentity(v1, { kind: 'same_agreement_reentry' }, null);
  check('a same-agreement correction increments versionSeq within the SAME agreementAt lineage', reentry, { ok: true, value: { agreementAt: '2026-09-06T15:00:00.000Z', versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null } });

  const newLineage = M.nextVersionIdentity(v1, { kind: 'new_agreement_required', conflicts: [] }, '2026-09-10T09:00:00.000Z');
  check('a new-agreement correction starts version 1 of a genuinely NEW lineage', newLineage, { ok: true, value: { agreementAt: '2026-09-10T09:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: '2026-09-06T15:00:00.000Z' } });

  const missingNewAgreementAt = M.nextVersionIdentity(v1, { kind: 'new_agreement_required', conflicts: [] }, null);
  check('a new-agreement correction fails closed with no new agreementAt supplied', missingNewAgreementAt.ok, false);

  const metadataOnly = M.nextVersionIdentity(v1, { kind: 'metadata_only' }, null);
  check('a metadata-only change produces NO new version at all', metadataOnly.ok, false);

  check('no revision drift, no invalidation', M.isAuthorizationInvalidatedByRevision({ authorizedDocumentRevision: 'rev-1', currentDocumentRevision: 'rev-1' }), false);
  check('a document revision that drifted from what was authorized invalidates that authorization -- REVISION INVALIDATION', M.isAuthorizationInvalidatedByRevision({ authorizedDocumentRevision: 'rev-1', currentDocumentRevision: 'rev-2' }), true);
  check('no authorization yet recorded is not itself an invalidation (nothing to compare)', M.isAuthorizationInvalidatedByRevision({ authorizedDocumentRevision: null, currentDocumentRevision: 'rev-1' }), false);
}

// ============================================================
// 9. Signer/party requirements -- fails closed on zero signers and on a
//    duplicate role.
// ============================================================
{
  const oneSigner = [{ role: 'seller_1', displayName: 'Jane Seller', signingAuthorityNote: null }];
  check('one real signer requirement validates', M.validateSignerRequirements(oneSigner), { valid: true, reasons: [] });

  const none = M.validateSignerRequirements([]);
  check('zero signer requirements fails closed, never treated as vacuously satisfied', none.valid, false);
  check('the zero-signers reason names NO_SIGNER_REQUIREMENTS', none.reasons[0].code, 'NO_SIGNER_REQUIREMENTS');

  const dup = M.validateSignerRequirements([
    { role: 'seller_1', displayName: 'Jane', signingAuthorityNote: null },
    { role: 'seller_1', displayName: 'Also Jane?', signingAuthorityNote: null },
  ]);
  check('a duplicate signer role fails closed', dup.valid, false);
  check('the duplicate-role reason names the offending role', dup.reasons[0].message.indexOf('seller_1') >= 0, true);
}

// ============================================================
// 10. Under Contract eligibility -- the three jointly-required facts
//     (per-signer completion, provider completion, preserved document),
//     none sufficient alone, PLUS the executed-terms safeguard, PLUS
//     (Jess Gate correction, this issue) real CONTENT validation of every
//     fact -- not merely presence -- and mandatory binding of the
//     preserved document to the exact current IAOS ContractVersionIdentity
//     (never an unavailable provider documentRevision).
// ============================================================
{
  const requirements = [
    { role: 'seller_1', displayName: 'Jane Seller', signingAuthorityNote: null },
    { role: 'buyer', displayName: 'IAOS Buyer', signingAuthorityNote: null },
  ];
  const ucVersionA = { agreementAt: '2026-09-06T15:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };
  const ucVersionB_differentSeq = { ...ucVersionA, versionSeq: 2, supersedesVersionSeq: 1 };
  const ucVersionC_differentAgreement = { agreementAt: '2026-09-10T09:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: ucVersionA.agreementAt };
  const validSha256 = 'e3'.repeat(32); // 64 hex chars, a real well-formed digest shape

  const fullExecution = {
    signers: [{ role: 'seller_1', hasCompleted: true }, { role: 'buyer', hasCompleted: true }],
    providerReportedCompletionAt: '2026-09-09T19:35:00.000Z',
    preservedDocument: {
      sha256: validSha256,
      providerReference: '24015F7F-1E61-41A1-9BD3-3FC7D8BBEE10',
      completionTime: '2026-09-09T19:35:00.000Z',
      boundVersion: ucVersionA,
      providerDocumentRevision: null,
    },
  };
  const fullyEligible = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: fullExecution, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('Under Contract is eligible when all three facts hold with real content, the preserved document is bound to the exact current IAOS version, and terms match', fullyEligible, { eligible: true, reasons: [] });

  check('an absent provider documentRevision on the preserved document does NOT block Under Contract -- GHL BLOCKED fields never gate V1', M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: { ...fullExecution, preservedDocument: { ...fullExecution.preservedDocument, providerDocumentRevision: null } }, currentVersion: ucVersionA, executedTermsMatchAgreement: true }), { eligible: true, reasons: [] });

  // Only the seller signed -- "Waiting for others," per the live Test
  // transaction proof (BOARD9_CONTRACT_INVENTORY_V1.md item 8).
  const onlySellerSigned = {
    ...fullExecution,
    signers: [{ role: 'seller_1', hasCompleted: true }, { role: 'buyer', hasCompleted: false }],
  };
  const partialSignatures = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: onlySellerSigned, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('a single missing signature alone blocks Under Contract -- fail closed, matches the live Test proof', partialSignatures.eligible, false);
  check('the partial-signature case names SIGNERS_INCOMPLETE', partialSignatures.reasons.some((r) => r.code === 'SIGNERS_INCOMPLETE'), true);

  const noProviderReport = { ...fullExecution, providerReportedCompletionAt: null };
  const noProviderResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: noProviderReport, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('all signers complete but NO provider completion report is still NOT Under Contract (no human mark-as-complete substitute)', noProviderResult.eligible, false);
  check('the no-provider-report case names PROVIDER_COMPLETION_NOT_REPORTED', noProviderResult.reasons.some((r) => r.code === 'PROVIDER_COMPLETION_NOT_REPORTED'), true);

  // Required: invalid provider completion timestamp (present but malformed).
  const invalidProviderCompletionTimestamp = { ...fullExecution, providerReportedCompletionAt: 'not-a-real-date' };
  const invalidProviderCompletionResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: invalidProviderCompletionTimestamp, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('a present but invalid provider completion timestamp blocks Under Contract -- content is validated, not just presence', invalidProviderCompletionResult.eligible, false);
  check('the invalid-provider-completion-timestamp case names PROVIDER_COMPLETION_TIMESTAMP_INVALID', invalidProviderCompletionResult.reasons.some((r) => r.code === 'PROVIDER_COMPLETION_TIMESTAMP_INVALID'), true);

  const noPreservation = { ...fullExecution, preservedDocument: null };
  const noPreservationResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: noPreservation, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('signers complete and provider reports completion, but NO preserved document, is still NOT Under Contract', noPreservationResult.eligible, false);
  check('the no-preservation case names DOCUMENT_NOT_PRESERVED', noPreservationResult.reasons.some((r) => r.code === 'DOCUMENT_NOT_PRESERVED'), true);

  // Required: blank provider reference.
  const blankProviderReference = { ...fullExecution, preservedDocument: { ...fullExecution.preservedDocument, providerReference: '   ' } };
  const blankProviderReferenceResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: blankProviderReference, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('a blank preserved-document provider reference blocks Under Contract', blankProviderReferenceResult.eligible, false);
  check('the blank-provider-reference case names PRESERVED_DOCUMENT_REFERENCE_BLANK', blankProviderReferenceResult.reasons.some((r) => r.code === 'PRESERVED_DOCUMENT_REFERENCE_BLANK'), true);

  // Required: invalid preserved-document completion timestamp.
  const invalidDocCompletionTime = { ...fullExecution, preservedDocument: { ...fullExecution.preservedDocument, completionTime: 'not-a-real-date' } };
  const invalidDocCompletionTimeResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: invalidDocCompletionTime, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('an invalid preserved-document completion timestamp blocks Under Contract', invalidDocCompletionTimeResult.eligible, false);
  check('the invalid-doc-completion-time case names PRESERVED_DOCUMENT_COMPLETION_TIME_INVALID', invalidDocCompletionTimeResult.reasons.some((r) => r.code === 'PRESERVED_DOCUMENT_COMPLETION_TIME_INVALID'), true);

  // Required: blank OR malformed SHA-256, both cases.
  const blankSha256 = { ...fullExecution, preservedDocument: { ...fullExecution.preservedDocument, sha256: '   ' } };
  const blankSha256Result = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: blankSha256, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('a blank SHA-256 blocks Under Contract', blankSha256Result.eligible, false);
  check('the blank-SHA-256 case names PRESERVED_DOCUMENT_SHA256_INVALID', blankSha256Result.reasons.some((r) => r.code === 'PRESERVED_DOCUMENT_SHA256_INVALID'), true);

  const malformedSha256Result = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: { ...fullExecution, preservedDocument: { ...fullExecution.preservedDocument, sha256: 'not-a-real-hash-abc123' } }, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('a malformed (non-hex, wrong-length) SHA-256 blocks Under Contract -- present is not the same as well-formed', malformedSha256Result.eligible, false);
  check('the malformed-SHA-256 case also names PRESERVED_DOCUMENT_SHA256_INVALID', malformedSha256Result.reasons.some((r) => r.code === 'PRESERVED_DOCUMENT_SHA256_INVALID'), true);

  // Required: missing preserved-document IAOS version.
  const missingBoundVersion = { ...fullExecution, preservedDocument: { ...fullExecution.preservedDocument, boundVersion: null } };
  const missingBoundVersionResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: missingBoundVersion, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('a preserved document with NO recorded IAOS version binding blocks Under Contract', missingBoundVersionResult.eligible, false);
  check('the missing-bound-version case names PRESERVED_DOCUMENT_NOT_BOUND_TO_EXACT_VERSION', missingBoundVersionResult.reasons.some((r) => r.code === 'PRESERVED_DOCUMENT_NOT_BOUND_TO_EXACT_VERSION'), true);

  // Required: different agreementAt between the preserved document's bound version and the current version being evaluated.
  const differentAgreementBound = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: fullExecution, currentVersion: ucVersionC_differentAgreement, executedTermsMatchAgreement: true });
  check('a preserved document bound to a DIFFERENT agreementAt than the one being evaluated blocks Under Contract', differentAgreementBound.eligible, false);
  check('the different-agreementAt-binding case names PRESERVED_DOCUMENT_NOT_BOUND_TO_EXACT_VERSION', differentAgreementBound.reasons.some((r) => r.code === 'PRESERVED_DOCUMENT_NOT_BOUND_TO_EXACT_VERSION'), true);

  // Required: different versionSeq (same agreementAt).
  const differentSeqBound = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: fullExecution, currentVersion: ucVersionB_differentSeq, executedTermsMatchAgreement: true });
  check('a preserved document bound to a DIFFERENT versionSeq (same agreementAt) than the one being evaluated blocks Under Contract', differentSeqBound.eligible, false);
  check('the different-versionSeq-binding case also names PRESERVED_DOCUMENT_NOT_BOUND_TO_EXACT_VERSION', differentSeqBound.reasons.some((r) => r.code === 'PRESERVED_DOCUMENT_NOT_BOUND_TO_EXACT_VERSION'), true);

  const notSent = M.evaluateUnderContractEligibility({ contractSent: false, requirements, execution: fullExecution, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('Under Contract is never eligible without Contract Sent, even with full execution evidence', notSent.eligible, false);

  const termsDiverged = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: fullExecution, currentVersion: ucVersionA, executedTermsMatchAgreement: false });
  check('fully executed evidence with a DIVERGED price/term from the agreement still does not reach Under Contract -- NO SILENT TERM CHANGE', termsDiverged.eligible, false);
  check('the diverged-terms case names EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT', termsDiverged.reasons.some((r) => r.code === 'EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT'), true);

  const zeroSigners = M.evaluateUnderContractEligibility({ contractSent: true, requirements: [], execution: fullExecution, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('zero signer requirements can never vacuously satisfy Under Contract', zeroSigners.eligible, false);

  // Required: any ONE of the three jointly-required execution facts
  // missing still blocks, even when the other two are fully valid --
  // proven pairwise across all three (signers-only-missing already
  // proven above via partialSignatures; the remaining two pairs below).
  const onlyProviderAndDocMissingSigners = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: { ...fullExecution, signers: [] }, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('provider completion and preserved document both valid, but ZERO signers recorded, still blocks (paired with the zero-signer-requirements case above, this is zero signer COMPLETIONS)', onlyProviderAndDocMissingSigners.eligible, false);

  const onlySignersAndDocValid = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: { ...fullExecution, providerReportedCompletionAt: null }, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('signers and preserved document both valid, but provider completion missing, still blocks (re-confirms no two-of-three is sufficient)', onlySignersAndDocValid.eligible, false);

  const onlySignersAndProviderValid = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: { ...fullExecution, preservedDocument: null }, currentVersion: ucVersionA, executedTermsMatchAgreement: true });
  check('signers and provider completion both valid, but preserved document missing, still blocks (re-confirms no two-of-three is sufficient)', onlySignersAndProviderValid.eligible, false);
}

// ============================================================
// 11. Disposition handoff payload -- stable, fail-closed for a terminal
//     state not actually reached, and Brad-only for Rescinded.
// ============================================================
{
  const version = M.initialVersionIdentity('2026-09-06T15:00:00.000Z');
  const requirements = [{ role: 'seller_1', displayName: 'Jane Seller', signingAuthorityNote: null }];
  const verifiedExecution = {
    signers: [{ role: 'seller_1', hasCompleted: true }],
    providerReportedCompletionAt: '2026-09-09T19:35:00.000Z',
    preservedDocument: {
      sha256: 'ab'.repeat(32),
      providerReference: 'ref-1',
      completionTime: '2026-09-09T19:35:00.000Z',
      boundVersion: version,
      providerDocumentRevision: null,
    },
  };

  const ucPayload = M.buildDispositionHandoffPayload({
    terminalState: 'under_contract', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    underContractEvidence: { contractSent: true, requirements, execution: verifiedExecution, currentVersion: version, executedTermsMatchAgreement: true },
  });
  check('an actually-verified Under Contract handoff builds successfully', ucPayload.ok, true);
  check('the handoff payload always carries the literal noReentry: true', ucPayload.value.noReentry, true);
  check('the payload is frozen (stable, cannot be mutated after the fact)', Object.isFrozen(ucPayload.value), true);

  const ucNotYetVerified = M.buildDispositionHandoffPayload({
    terminalState: 'under_contract', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    underContractEvidence: { contractSent: true, requirements, execution: { ...verifiedExecution, providerReportedCompletionAt: null }, currentVersion: version, executedTermsMatchAgreement: true },
  });
  check('an Under Contract handoff is REFUSED when the state was not actually verified -- never emits a payload for an unreached state', ucNotYetVerified.ok, false);

  const ucBadSha256 = M.buildDispositionHandoffPayload({
    terminalState: 'under_contract', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    underContractEvidence: { contractSent: true, requirements, execution: { ...verifiedExecution, preservedDocument: { ...verifiedExecution.preservedDocument, sha256: 'bad' } }, currentVersion: version, executedTermsMatchAgreement: true },
  });
  check('an Under Contract handoff is REFUSED when the preserved document carries a malformed SHA-256 -- the new content validation blocks the handoff, not just the eligibility check', ucBadSha256.ok, false);

  const otherVersion = { agreementAt: '2026-09-10T09:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: version.agreementAt };
  const ucWrongBoundVersion = M.buildDispositionHandoffPayload({
    terminalState: 'under_contract', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    underContractEvidence: { contractSent: true, requirements, execution: verifiedExecution, currentVersion: otherVersion, executedTermsMatchAgreement: true },
  });
  check('an Under Contract handoff is REFUSED when the preserved document is bound to a DIFFERENT IAOS version than the one being evaluated', ucWrongBoundVersion.ok, false);

  const goodRescission = M.buildDispositionHandoffPayload({
    terminalState: 'rescinded', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    rescission: { authorizedBy: 'brad', at: '2026-09-10T00:00:00.000Z', reason: 'Seller withdrew.' },
  });
  check('a Brad-authorized rescission with a reason builds successfully', goodRescission.ok, true);

  const badRescission = M.buildDispositionHandoffPayload({
    terminalState: 'rescinded', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    rescission: { authorizedBy: 'some-rep', at: '2026-09-10T00:00:00.000Z', reason: 'Seller withdrew.' },
  });
  check('a rescission NOT authorized by Brad is refused -- Brad-only in V1', badRescission.ok, false);
  check('the refusal names RESCISSION_NOT_BRAD_AUTHORIZED', badRescission.reasons[0].code, 'RESCISSION_NOT_BRAD_AUTHORIZED');

  const noReasonRescission = M.buildDispositionHandoffPayload({
    terminalState: 'rescinded', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    rescission: { authorizedBy: 'brad', at: '2026-09-10T00:00:00.000Z', reason: '   ' },
  });
  check('a Brad-authorized rescission with a blank/whitespace-only reason is refused', noReasonRescission.ok, false);

  // -- Jess Gate correction 2: Expired must never emit merely because the
  // caller names that terminal state -- valid timestamps, Contract Sent,
  // expiration having actually occurred, and no verified execution are
  // all independently required.
  const expiredBase = {
    terminalState: 'expired', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    contractSent: true, expirationAt: '2026-09-11T10:00:00.000Z', now: '2026-09-12T00:00:00.000Z', verifiedExecuted: false,
  };
  const expiredPayload = M.buildDispositionHandoffPayload(expiredBase);
  check('an expired handoff builds successfully once expiration has actually occurred, Sent, and not verified-executed', expiredPayload, { ok: true, value: { opportunityId: 'opp-1', agreementAt: version.agreementAt, version, noReentry: true, terminalState: 'expired', expirationAt: '2026-09-11T10:00:00.000Z' } });

  const expiredNotYet = { ...expiredBase, now: '2026-09-10T00:00:00.000Z' };
  const expiredNotYetResult = M.buildDispositionHandoffPayload(expiredNotYet);
  check('naming "expired" BEFORE the expiration timestamp has passed is refused -- never emitted merely because the caller asked', expiredNotYetResult.ok, false);
  check('the not-yet-expired refusal names EXPIRATION_HAS_NOT_OCCURRED', expiredNotYetResult.reasons.some((r) => r.code === 'EXPIRATION_HAS_NOT_OCCURRED'), true);

  const expiredButVerified = { ...expiredBase, verifiedExecuted: true };
  const expiredButVerifiedResult = M.buildDispositionHandoffPayload(expiredButVerified);
  check('naming "expired" for an agreement that WAS verified-executed is refused', expiredButVerifiedResult.ok, false);
  check('the verified-execution refusal names EXPIRED_REQUIRES_NO_VERIFIED_EXECUTION', expiredButVerifiedResult.reasons.some((r) => r.code === 'EXPIRED_REQUIRES_NO_VERIFIED_EXECUTION'), true);

  const expiredNotSent = { ...expiredBase, contractSent: false };
  check('naming "expired" for an agreement never Contract Sent is refused', M.buildDispositionHandoffPayload(expiredNotSent).ok, false);

  const expiredBadExpirationTimestamp = { ...expiredBase, expirationAt: 'not-a-real-date' };
  const expiredBadExpirationResult = M.buildDispositionHandoffPayload(expiredBadExpirationTimestamp);
  check('an invalid expiration timestamp refuses the expired handoff -- unsupported terminal evidence, never guessed', expiredBadExpirationResult.ok, false);
  check('the invalid-expiration-timestamp refusal names EXPIRATION_TIMESTAMP_INVALID', expiredBadExpirationResult.reasons.some((r) => r.code === 'EXPIRATION_TIMESTAMP_INVALID'), true);

  const expiredBadNowTimestamp = { ...expiredBase, now: 'not-a-real-date' };
  const expiredBadNowResult = M.buildDispositionHandoffPayload(expiredBadNowTimestamp);
  check('an invalid reference "now" timestamp refuses the expired handoff', expiredBadNowResult.ok, false);
  check('the invalid-now-timestamp refusal names EXPIRED_NOW_TIMESTAMP_INVALID', expiredBadNowResult.reasons.some((r) => r.code === 'EXPIRED_NOW_TIMESTAMP_INVALID'), true);

  const expiredFutureNow = { ...expiredBase, expirationAt: '2099-01-01T00:00:00.000Z' };
  check('a far-future, unsupported expiration timestamp (has not occurred) is refused, not guessed as expired', M.buildDispositionHandoffPayload(expiredFutureNow).ok, false);

  // -- Jess Gate correction 2: Declined must never emit merely because the
  // caller names that terminal state -- Contract Sent, a valid timestamp,
  // and an explicit operator-recorded fact (B9-01's own words) are all
  // independently required.
  const declinedBase = {
    terminalState: 'declined', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    contractSent: true, declinedAt: '2026-09-11T10:00:00.000Z', recordedBy: 'brad',
  };
  const declinedPayload = M.buildDispositionHandoffPayload(declinedBase);
  check('a declined handoff builds successfully once Sent, timestamped, and operator-recorded', declinedPayload, { ok: true, value: { opportunityId: 'opp-1', agreementAt: version.agreementAt, version, noReentry: true, terminalState: 'declined', declinedAt: '2026-09-11T10:00:00.000Z', recordedBy: 'brad' } });

  const declinedNotSent = { ...declinedBase, contractSent: false };
  const declinedNotSentResult = M.buildDispositionHandoffPayload(declinedNotSent);
  check('naming "declined" for an agreement never Contract Sent is refused -- nothing was sent to decline', declinedNotSentResult.ok, false);
  check('the not-sent refusal names NOT_CONTRACT_SENT', declinedNotSentResult.reasons.some((r) => r.code === 'NOT_CONTRACT_SENT'), true);

  const declinedBadTimestamp = { ...declinedBase, declinedAt: 'not-a-real-date' };
  const declinedBadTimestampResult = M.buildDispositionHandoffPayload(declinedBadTimestamp);
  check('an invalid decline timestamp refuses the declined handoff -- unsupported terminal evidence, never guessed', declinedBadTimestampResult.ok, false);
  check('the invalid-timestamp refusal names DECLINED_TIMESTAMP_INVALID', declinedBadTimestampResult.reasons.some((r) => r.code === 'DECLINED_TIMESTAMP_INVALID'), true);

  const declinedNoOperator = { ...declinedBase, recordedBy: '   ' };
  const declinedNoOperatorResult = M.buildDispositionHandoffPayload(declinedNoOperator);
  check('a blank/whitespace-only recordedBy refuses the declined handoff -- "operator-recorded" per B9-01 requires a real operator identity', declinedNoOperatorResult.ok, false);
  check('the no-operator refusal names DECLINED_NOT_OPERATOR_RECORDED', declinedNoOperatorResult.reasons.some((r) => r.code === 'DECLINED_NOT_OPERATOR_RECORDED'), true);
}

// ============================================================
// 12. Structural proof: no GHL/network call, no invented note-carrier
//     write function, no provider hardcoded as a literal, no
//     recomputation of Board 8 economics anywhere in this module.
// ============================================================
{
  check('compiled output makes no GHL/network call of any kind', /fetch\(|ghl\.notes\.create|ghl\.contacts\.|XMLHttpRequest/.test(compiledNoComments), false);
  check('compiled output defines no formatXxxNote-shaped carrier-write function (no invented GHL carrier)', /function format[A-Za-z]*Note/.test(compiledNoComments), false);
  check('compiled output never hardcodes a specific e-sign provider name as a value', /"docusign"|"pandadoc"|"hellosign"|"dropbox_sign"|"adobe_sign"|"ghl_documents_contracts"/i.test(compiledNoComments), false);
  check('compiled output never recomputes Target/Max/Spread (no 25%/assignment arithmetic, no endBuyerMaxPrice)', /0\.25|endBuyerMaxPrice/.test(compiledNoComments), false);
}

cleanup();

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
