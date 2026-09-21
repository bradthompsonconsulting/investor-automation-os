/**
 * Board #9 Phase B (B9-13) -- pure-model offline tests for the Under
 * Contract stage transition (`contract-stage-transition-model.ts`) and
 * the executed-artifact chunked-upload/preservation model + carrier
 * (`contract-executed-artifact-storage-model.ts`,
 * `contract-executed-artifact-carriers.ts`). No GHL, no network, no
 * React, no Blobs SDK -- every function under test is pure.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-stage-and-artifact-model-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [
  path.join(LIB, 'contract-stage-transition-model.ts'),
  path.join(LIB, 'contract-executed-artifact-storage-model.ts'),
  path.join(LIB, 'contract-executed-artifact-carriers.ts'),
  path.join(LIB, 'board9-contract-model.ts'),
];
try {
  execSync('npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') + ' --outDir "' + TMP + '" --module commonjs --target es2020 --strict', { cwd: APP, stdio: 'inherit' });
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const T = require(path.join(TMP, 'contract-stage-transition-model.js'));
const A = require(path.join(TMP, 'contract-executed-artifact-storage-model.js'));
const C = require(path.join(TMP, 'contract-executed-artifact-carriers.js'));
const B = require(path.join(TMP, 'board9-contract-model.js'));

const FLOOR = 60;
let failures = 0;
let checks = 0;
function check(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log('FAIL ' + name); console.log('  actual:   ' + a); console.log('  expected: ' + e); }
  else console.log('PASS ' + name);
}
function checkTrue(name, cond) { check(name, !!cond, true); }

const VERSION = B.initialVersionIdentity('2026-09-12T00:00:00.000Z');
const OTHER_VERSION = B.nextVersionIdentity(VERSION, { kind: 'same_agreement_reentry' }, null).value;
const OPP = { id: 'opp-1', pipelineId: 'pipe-1', pipelineStageId: 'stage-new-lead', locationId: 'loc-1' };

// ============================================================
// 1. contractVersionStorageKey -- deterministic, distinguishes versions
// ============================================================
{
  check('storage key is deterministic for the same version', A.contractVersionStorageKey(VERSION), A.contractVersionStorageKey(VERSION));
  checkTrue('storage key differs across different versions', A.contractVersionStorageKey(VERSION) !== A.contractVersionStorageKey(OTHER_VERSION));
}

// ============================================================
// 2. evaluateChunkAcceptance
// ============================================================
{
  const HASH_0 = 'a'.repeat(64), HASH_1 = 'b'.repeat(64), HASH_1_DIFFERENT = 'c'.repeat(64);
  const base = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, uploadId: 'up-1', chunkIndex: 0, chunkCount: 3, totalByteCount: 300, originalFileName: 'a.pdf', chunkByteLength: 100, chunkSha256: HASH_0 };
  const isSame = B.isSameContractVersion;
  const okKind = (r) => r.ok ? r.kind : false;

  check('first chunk of a new session (index 0, no existing session) is accepted as new', okKind(A.evaluateChunkAcceptance({ incoming: base, isSameVersion: isSame, existingSession: null })), 'new');
  checkTrue('first chunk with a non-zero index is refused (must start at 0)', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1 }, isSameVersion: isSame, existingSession: null }).ok);
  check('the out-of-order-first-chunk refusal names OUT_OF_ORDER_CHUNK', A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1 }, isSameVersion: isSame, existingSession: null }).reasons.map(r=>r.code), ['OUT_OF_ORDER_CHUNK']);

  checkTrue('blank opportunityId refused', !A.evaluateChunkAcceptance({ incoming: { ...base, opportunityId: '' }, isSameVersion: isSame, existingSession: null }).ok);
  checkTrue('blank uploadId refused', !A.evaluateChunkAcceptance({ incoming: { ...base, uploadId: '' }, isSameVersion: isSame, existingSession: null }).ok);
  checkTrue('negative chunkIndex refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: -1 }, isSameVersion: isSame, existingSession: null }).ok);
  checkTrue('zero chunkCount refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkCount: 0 }, isSameVersion: isSame, existingSession: null }).ok);
  checkTrue('zero totalByteCount refused', !A.evaluateChunkAcceptance({ incoming: { ...base, totalByteCount: 0 }, isSameVersion: isSame, existingSession: null }).ok);
  checkTrue('oversized totalByteCount refused', !A.evaluateChunkAcceptance({ incoming: { ...base, totalByteCount: A.MAX_TOTAL_BYTES + 1 }, isSameVersion: isSame, existingSession: null }).ok);
  check('the oversized refusal names TOTAL_BYTE_COUNT_OVERSIZED', A.evaluateChunkAcceptance({ incoming: { ...base, totalByteCount: A.MAX_TOTAL_BYTES + 1 }, isSameVersion: isSame, existingSession: null }).reasons.map(r=>r.code), ['TOTAL_BYTE_COUNT_OVERSIZED']);
  checkTrue('a chunk exceeding CHUNK_SIZE_BYTES is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkByteLength: A.CHUNK_SIZE_BYTES + 1 }, isSameVersion: isSame, existingSession: null }).ok);
  checkTrue('chunkIndex >= chunkCount is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 3, chunkCount: 3 }, isSameVersion: isSame, existingSession: null }).ok);

  const session = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, uploadId: 'up-1', chunkCount: 3, totalByteCount: 300, originalFileName: 'a.pdf', receivedChunkIndexes: [0], receivedChunkHashes: { 0: HASH_0 } };
  check('the next in-order chunk (index 1) is accepted as new against an existing session', okKind(A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, chunkSha256: HASH_1 }, isSameVersion: isSame, existingSession: session })), 'new');

  // Gate-review closure, requirement 3 -- content-aware chunk retry.
  check('an IDENTICAL retry of an already-received chunk index (same content hash) is idempotent, never re-stored, never an error', okKind(A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 0, chunkSha256: HASH_0 }, isSameVersion: isSame, existingSession: session })), 'duplicate_identical');
  checkTrue('a DIFFERENT-content retry at an already-received chunk index is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 0, chunkSha256: HASH_1_DIFFERENT }, isSameVersion: isSame, existingSession: session }).ok);
  check('the different-content-at-same-index refusal names DUPLICATE_CHUNK', A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 0, chunkSha256: HASH_1_DIFFERENT }, isSameVersion: isSame, existingSession: session }).reasons.map(r=>r.code), ['DUPLICATE_CHUNK']);

  checkTrue('a reordered chunk (skipping ahead to index 2) is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 2, chunkSha256: HASH_1 }, isSameVersion: isSame, existingSession: session }).ok);
  check('the reordered-chunk refusal names OUT_OF_ORDER_CHUNK', A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 2, chunkSha256: HASH_1 }, isSameVersion: isSame, existingSession: session }).reasons.map(r=>r.code), ['OUT_OF_ORDER_CHUNK']);

  checkTrue('a chunk claiming a DIFFERENT version than the session is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, version: OTHER_VERSION }, isSameVersion: isSame, existingSession: session }).ok);
  check('the cross-version refusal names CROSS_OPPORTUNITY_OR_VERSION', A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, version: OTHER_VERSION }, isSameVersion: isSame, existingSession: session }).reasons.map(r=>r.code), ['CROSS_OPPORTUNITY_OR_VERSION']);
  checkTrue('a chunk claiming a DIFFERENT opportunityId than the session is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, opportunityId: 'opp-2' }, isSameVersion: isSame, existingSession: session }).ok);
  check('the cross-opportunity refusal also names CROSS_OPPORTUNITY_OR_VERSION', A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, opportunityId: 'opp-2' }, isSameVersion: isSame, existingSession: session }).reasons.map(r=>r.code), ['CROSS_OPPORTUNITY_OR_VERSION']);
  checkTrue('a chunk claiming a DIFFERENT chunkCount than the session is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, chunkCount: 9 }, isSameVersion: isSame, existingSession: session }).ok);
  check('the chunk-count-mismatch refusal names CHUNK_COUNT_MISMATCH', A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, chunkCount: 9 }, isSameVersion: isSame, existingSession: session }).reasons.map(r=>r.code), ['CHUNK_COUNT_MISMATCH']);
  checkTrue('a chunk claiming a DIFFERENT totalByteCount than the session is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, totalByteCount: 999 }, isSameVersion: isSame, existingSession: session }).ok);
  checkTrue('a chunk claiming a DIFFERENT originalFileName than the session is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 1, originalFileName: 'other.pdf' }, isSameVersion: isSame, existingSession: session }).ok);
}

// ============================================================
// 3. evaluateFinalizeReadiness
// ============================================================
{
  const complete = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, uploadId: 'up-1', chunkCount: 3, totalByteCount: 300, originalFileName: 'a.pdf', receivedChunkIndexes: [0, 1, 2] };
  checkTrue('finalize is ready once every chunk index is present', A.evaluateFinalizeReadiness(complete).ok);
  const partial = { ...complete, receivedChunkIndexes: [0, 1] };
  checkTrue('finalize is NOT ready with a missing chunk', !A.evaluateFinalizeReadiness(partial).ok);
  check('the missing-chunks refusal names MISSING_CHUNKS', A.evaluateFinalizeReadiness(partial).reasons.map(r=>r.code), ['MISSING_CHUNKS']);
}

// ============================================================
// 4. evaluatePreservationIdempotency
// ============================================================
{
  const existing = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, sha256: 'a'.repeat(64), byteCount: 1000 };
  check('no prior artifact -> fresh', A.evaluatePreservationIdempotency({ existing: null, newSha256: 'a'.repeat(64), newByteCount: 1000 }).kind, 'fresh');
  check('same hash AND same byte count -> no-op already-preserved', A.evaluatePreservationIdempotency({ existing, newSha256: 'a'.repeat(64), newByteCount: 1000 }).kind, 'no_op_already_preserved');
  check('different hash -> conflict', A.evaluatePreservationIdempotency({ existing, newSha256: 'b'.repeat(64), newByteCount: 1000 }).kind, 'conflict');
  check('same hash but different byte count -> conflict (never trusted on hash alone)', A.evaluatePreservationIdempotency({ existing, newSha256: 'a'.repeat(64), newByteCount: 999 }).kind, 'conflict');
}

// ============================================================
// 5. Executed-artifact carrier round-trip
// ============================================================
{
  const record = {
    opportunityId: 'opp-1', at: '2026-09-21T10:00:00.000Z', operator: 'brad', agreementAt: VERSION.agreementAt, version: VERSION,
    originalFileName: 'TEST_-_742_Evergreen_Terrace.pdf', byteCount: 10102475, sha256: 'b7e70722b26823f1d11eed33d03ba961bcee3d1d3679ef787dc9c7b912421001'.slice(0,64).padEnd(64,'0'),
    pageCount: 13, providerDocumentId: '6aaffa4a0f9b5add21ee171f', uploadedAt: '2026-09-21T10:00:01.000Z', blobKey: 'opp-1/2026-09-12T00:00:00.000Z__1__none.pdf',
  };
  const note = C.formatPreservedExecutedArtifactNote(record);
  checkTrue('the note carries the exact schema header', note.startsWith('IAOS EXECUTED ARTIFACT — iaos-executed-artifact-v1'));
  check('a freshly-formatted note round-trips byte-for-byte', C.parsePreservedExecutedArtifactNote(note), record);
  check('a null pageCount round-trips as null, never fabricated', C.parsePreservedExecutedArtifactNote(C.formatPreservedExecutedArtifactNote({ ...record, pageCount: null })).pageCount, null);
  check('a null operator round-trips as null, never fabricated', C.parsePreservedExecutedArtifactNote(C.formatPreservedExecutedArtifactNote({ ...record, operator: null })).operator, null);

  check('an unrelated note body does not parse as an executed-artifact record', C.parsePreservedExecutedArtifactNote('IAOS SOMETHING ELSE — v1\nfoo: bar'), null);
  check('a note with the wrong number of lines does not parse', C.parsePreservedExecutedArtifactNote(note + '\nExtra: line'), null);
  check('a note with an invalid (non-64-hex) sha256 does not parse', C.parsePreservedExecutedArtifactNote(note.replace(record.sha256, 'not-a-hash')), null);
  check('a note with a non-integer byte count does not parse', C.parsePreservedExecutedArtifactNote(note.replace(String(record.byteCount), '12.5')), null);
  check('a note with an unparseable version does not parse', C.parsePreservedExecutedArtifactNote(note.replace(JSON.stringify(record.version), '{not json')), null);
  check('a note with a blank opportunityId does not parse', C.parsePreservedExecutedArtifactNote(note.replace('Opportunity: opp-1', 'Opportunity: ')), null);

  const notes = [
    { body: 'unrelated note' },
    { body: C.formatPreservedExecutedArtifactNote({ ...record, at: '2026-09-21T09:00:00.000Z', sha256: 'c'.repeat(64) }) },
    { body: note },
  ];
  check('latestPreservedExecutedArtifactForOpportunity resolves the most recent by `at`, not by note order', C.latestPreservedExecutedArtifactForOpportunity(notes, 'opp-1').sha256, record.sha256);
  check('latestPreservedExecutedArtifactForOpportunity returns null for an opportunity with no matching notes', C.latestPreservedExecutedArtifactForOpportunity(notes, 'some-other-opp'), null);
}

// ============================================================
// 6. evaluateUnderContractStageTransitionEligibility
// ============================================================
{
  const isSame = B.isSameContractVersion;
  const ucRecord = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION };
  const artifactRecord = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION };
  const baseArgs = {
    opportunity: OPP, opportunityId: 'opp-1', agreementAt: VERSION.agreementAt,
    underContractRecord: ucRecord, preservedArtifactRecord: artifactRecord, isSameVersion: isSame, version: VERSION,
    expectedPipelineId: 'pipe-1', expectedLocationId: 'loc-1', targetStageId: 'b5d059c8-7b11-4885-b761-024d5c067cb6', forbiddenStageIds: ['bfca8a93-5f24-4064-9317-bc6ba1cca3af'],
  };

  checkTrue('eligible once a matching Under Contract record and a matching preserved artifact both exist, correct pipeline/location, valid target stage', T.evaluateUnderContractStageTransitionEligibility(baseArgs).eligible);

  checkTrue('missing Under Contract record refuses', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, underContractRecord: null }).eligible);
  check('the missing-UC refusal names UNDER_CONTRACT_RECORD_MISSING', T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, underContractRecord: null }).reasons.map(r=>r.code), ['UNDER_CONTRACT_RECORD_MISSING']);
  checkTrue('a UC record for a different opportunity refuses', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, underContractRecord: { ...ucRecord, opportunityId: 'opp-2' } }).eligible);
  checkTrue('a UC record for a different version refuses', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, underContractRecord: { ...ucRecord, version: OTHER_VERSION } }).eligible);
  checkTrue('a UC record for a different agreementAt refuses', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, underContractRecord: { ...ucRecord, agreementAt: '2020-01-01T00:00:00.000Z' } }).eligible);

  checkTrue('missing preserved artifact record refuses', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, preservedArtifactRecord: null }).eligible);
  check('the missing-artifact refusal names PRESERVED_ARTIFACT_MISSING', T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, preservedArtifactRecord: null }).reasons.map(r=>r.code), ['PRESERVED_ARTIFACT_MISSING']);
  checkTrue('a preserved artifact for a different version refuses', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, preservedArtifactRecord: { ...artifactRecord, version: OTHER_VERSION } }).eligible);

  checkTrue('wrong pipeline refuses (wrong-environment case)', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, opportunity: { ...OPP, pipelineId: 'some-other-pipeline' } }).eligible);
  check('the wrong-pipeline refusal names WRONG_PIPELINE', T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, opportunity: { ...OPP, pipelineId: 'some-other-pipeline' } }).reasons.map(r=>r.code).includes('WRONG_PIPELINE'), true);
  checkTrue('wrong location refuses (wrong-environment case)', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, opportunity: { ...OPP, locationId: 'some-other-location' } }).eligible);

  checkTrue('a forbidden target stage (Seller Closed-Won) refuses unconditionally', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, targetStageId: 'bfca8a93-5f24-4064-9317-bc6ba1cca3af' }).eligible);
  check('the forbidden-stage refusal names TARGET_STAGE_FORBIDDEN', T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, targetStageId: 'bfca8a93-5f24-4064-9317-bc6ba1cca3af' }).reasons.map(r=>r.code).includes('TARGET_STAGE_FORBIDDEN'), true);

  checkTrue('an unprovisioned (Production sentinel) target stage refuses', !T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, targetStageId: 'PRODUCTION_UNDER_CONTRACT_NOT_PROVISIONED' }).eligible);
  check('the unprovisioned-stage refusal names TARGET_STAGE_NOT_PROVISIONED', T.evaluateUnderContractStageTransitionEligibility({ ...baseArgs, targetStageId: 'PRODUCTION_UNDER_CONTRACT_NOT_PROVISIONED' }).reasons.map(r=>r.code).includes('TARGET_STAGE_NOT_PROVISIONED'), true);
}

// ============================================================
// 7. isAlreadyInTargetStage
// ============================================================
{
  checkTrue('true when the opportunity is already at the target stage', T.isAlreadyInTargetStage({ ...OPP, pipelineStageId: 'stage-under-contract' }, 'stage-under-contract'));
  checkTrue('false when the opportunity is at a different stage', !T.isAlreadyInTargetStage({ ...OPP, pipelineStageId: 'stage-new-lead' }, 'stage-under-contract'));
}

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
if (checks < FLOOR) { console.error('ABORT: only ' + checks + ' checks ran; floor is ' + FLOOR + '. A refactor silently dropped coverage.'); failures++; }
cleanup();
if (failures > 0) process.exit(1);
