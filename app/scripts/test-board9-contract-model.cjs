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
const FLOOR = 92;
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
//    failure-behavior distinction.
// ============================================================
{
  const fullSent = {
    contractReady: true,
    bradSendAuthorization: { authorizedBy: 'brad', at: '2026-09-09T10:00:00.000Z' },
    providerTransmission: { identifier: 'doc-123', at: '2026-09-09T10:05:00.000Z' },
    expiration: { at: '2026-09-11T10:00:00.000Z' },
  };
  check('Contract Sent is eligible with all three facts present plus Contract Ready', M.evaluateContractSentEligibility(fullSent), { eligible: true, reasons: [] });

  const authOnly = { ...fullSent, providerTransmission: null };
  const authOnlyResult = M.evaluateContractSentEligibility(authOnly);
  check('authorization alone (no confirmed transmission) is NOT Contract Sent -- fails closed', authOnlyResult.eligible, false);
  check('the authorized-not-sent case names TRANSMISSION_NOT_CONFIRMED specifically', authOnlyResult.reasons.some((r) => r.code === 'TRANSMISSION_NOT_CONFIRMED'), true);

  const notBrad = { ...fullSent, bradSendAuthorization: { authorizedBy: 'some-rep', at: '2026-09-09T10:00:00.000Z' } };
  check('send authorization from anyone other than Brad does not count', M.evaluateContractSentEligibility(notBrad).eligible, false);

  const noExpiration = { ...fullSent, expiration: null };
  check('no explicit expiration blocks Contract Sent even with authorization and transmission both present', M.evaluateContractSentEligibility(noExpiration).eligible, false);

  const notReady = { ...fullSent, contractReady: false };
  check('Contract Sent is never eligible without Contract Ready, even with all three send-specific facts present', M.evaluateContractSentEligibility(notReady).eligible, false);
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
//     none sufficient alone, PLUS the executed-terms safeguard.
// ============================================================
{
  const requirements = [
    { role: 'seller_1', displayName: 'Jane Seller', signingAuthorityNote: null },
    { role: 'buyer', displayName: 'IAOS Buyer', signingAuthorityNote: null },
  ];
  const fullExecution = {
    signers: [{ role: 'seller_1', hasCompleted: true }, { role: 'buyer', hasCompleted: true }],
    providerReportedCompletionAt: '2026-09-09T19:35:00.000Z',
    preservedDocument: { sha256: 'e3331f06', providerReference: '24015F7F-1E61-41A1-9BD3-3FC7D8BBEE10', completionTime: '2026-09-09T19:35:00.000Z', contractVersion: null },
  };
  const fullyEligible = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: fullExecution, executedTermsMatchAgreement: true });
  check('Under Contract is eligible when all three facts hold, terms match, and Contract Sent was reached', fullyEligible, { eligible: true, reasons: [] });

  // Only the seller signed -- "Waiting for others," per the live Test
  // transaction proof (BOARD9_CONTRACT_INVENTORY_V1.md item 8).
  const onlySellerSigned = {
    ...fullExecution,
    signers: [{ role: 'seller_1', hasCompleted: true }, { role: 'buyer', hasCompleted: false }],
  };
  const partialSignatures = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: onlySellerSigned, executedTermsMatchAgreement: true });
  check('a single missing signature alone blocks Under Contract -- fail closed, matches the live Test proof', partialSignatures.eligible, false);
  check('the partial-signature case names SIGNERS_INCOMPLETE', partialSignatures.reasons.some((r) => r.code === 'SIGNERS_INCOMPLETE'), true);

  const noProviderReport = { ...fullExecution, providerReportedCompletionAt: null };
  const noProviderResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: noProviderReport, executedTermsMatchAgreement: true });
  check('all signers complete but NO provider completion report is still NOT Under Contract (no human mark-as-complete substitute)', noProviderResult.eligible, false);
  check('the no-provider-report case names PROVIDER_COMPLETION_NOT_REPORTED', noProviderResult.reasons.some((r) => r.code === 'PROVIDER_COMPLETION_NOT_REPORTED'), true);

  const noPreservation = { ...fullExecution, preservedDocument: null };
  const noPreservationResult = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: noPreservation, executedTermsMatchAgreement: true });
  check('signers complete and provider reports completion, but NO preserved document, is still NOT Under Contract', noPreservationResult.eligible, false);
  check('the no-preservation case names DOCUMENT_NOT_PRESERVED', noPreservationResult.reasons.some((r) => r.code === 'DOCUMENT_NOT_PRESERVED'), true);

  const notSent = M.evaluateUnderContractEligibility({ contractSent: false, requirements, execution: fullExecution, executedTermsMatchAgreement: true });
  check('Under Contract is never eligible without Contract Sent, even with full execution evidence', notSent.eligible, false);

  const termsDiverged = M.evaluateUnderContractEligibility({ contractSent: true, requirements, execution: fullExecution, executedTermsMatchAgreement: false });
  check('fully executed evidence with a DIVERGED price/term from the agreement still does not reach Under Contract -- NO SILENT TERM CHANGE', termsDiverged.eligible, false);
  check('the diverged-terms case names EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT', termsDiverged.reasons.some((r) => r.code === 'EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT'), true);

  const zeroSigners = M.evaluateUnderContractEligibility({ contractSent: true, requirements: [], execution: fullExecution, executedTermsMatchAgreement: true });
  check('zero signer requirements can never vacuously satisfy Under Contract', zeroSigners.eligible, false);
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
    preservedDocument: { sha256: 'abc123', providerReference: 'ref-1', completionTime: '2026-09-09T19:35:00.000Z', contractVersion: null },
  };

  const ucPayload = M.buildDispositionHandoffPayload({
    terminalState: 'under_contract', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    underContractEvidence: { contractSent: true, requirements, execution: verifiedExecution, executedTermsMatchAgreement: true },
  });
  check('an actually-verified Under Contract handoff builds successfully', ucPayload.ok, true);
  check('the handoff payload always carries the literal noReentry: true', ucPayload.value.noReentry, true);
  check('the payload is frozen (stable, cannot be mutated after the fact)', Object.isFrozen(ucPayload.value), true);

  const ucNotYetVerified = M.buildDispositionHandoffPayload({
    terminalState: 'under_contract', opportunityId: 'opp-1', agreementAt: version.agreementAt, version,
    underContractEvidence: { contractSent: true, requirements, execution: { ...verifiedExecution, providerReportedCompletionAt: null }, executedTermsMatchAgreement: true },
  });
  check('an Under Contract handoff is REFUSED when the state was not actually verified -- never emits a payload for an unreached state', ucNotYetVerified.ok, false);

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

  const expiredPayload = M.buildDispositionHandoffPayload({
    terminalState: 'expired', opportunityId: 'opp-1', agreementAt: version.agreementAt, version, expirationAt: '2026-09-11T10:00:00.000Z',
  });
  check('an expired handoff builds successfully and carries its expiration timestamp', expiredPayload, { ok: true, value: { opportunityId: 'opp-1', agreementAt: version.agreementAt, version, noReentry: true, terminalState: 'expired', expirationAt: '2026-09-11T10:00:00.000Z' } });

  const declinedPayload = M.buildDispositionHandoffPayload({
    terminalState: 'declined', opportunityId: 'opp-1', agreementAt: version.agreementAt, version, declinedAt: '2026-09-11T10:00:00.000Z',
  });
  check('a declined handoff builds successfully and carries its declined timestamp', declinedPayload, { ok: true, value: { opportunityId: 'opp-1', agreementAt: version.agreementAt, version, noReentry: true, terminalState: 'declined', declinedAt: '2026-09-11T10:00:00.000Z' } });
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
