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

const FLOOR = 71;
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
// 2. evaluateChunkAcceptance -- gate-review closure, PR #85 chunk-
//    ingestion redesign. Each chunk is evaluated ENTIRELY independently
//    against only a record ALREADY stored at its OWN deterministic key
//    (never a shared "session"/manifest another chunk wrote) -- so there
//    is no more ordering requirement of any kind.
// ============================================================
{
  const HASH_0 = 'a'.repeat(64), HASH_1 = 'b'.repeat(64), HASH_1_DIFFERENT = 'c'.repeat(64);
  const FULL_SHA = 'd'.repeat(64), OTHER_FULL_SHA = 'e'.repeat(64);
  const base = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, uploadId: 'up-1', chunkIndex: 0, chunkCount: 3, totalByteCount: 300, originalFileName: 'a.pdf', expectedFullSha256: FULL_SHA, chunkByteLength: 100, chunkSha256: HASH_0 };
  const isSame = B.isSameContractVersion;
  const okKind = (r) => r.ok ? r.kind : false;

  check('chunk 0 with no existing record at its own key is accepted as new', okKind(A.evaluateChunkAcceptance({ incoming: base, isSameVersion: isSame, existingChunk: null })), 'new');
  // Gate-review closure -- the actual proof requirement 13 asks for:
  // chunks 1, 2, and 3 (any non-zero index) succeed with NO existing
  // record at their own key -- no manifest, no chunk 0 required first.
  for (const idx of [1, 2, 3]) {
    check(`chunk ${idx} with no existing record at its own key is accepted as new -- no prior chunk required, no ordering enforced`, okKind(A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: idx, chunkCount: 4 }, isSameVersion: isSame, existingChunk: null })), 'new');
  }

  checkTrue('blank opportunityId refused', !A.evaluateChunkAcceptance({ incoming: { ...base, opportunityId: '' }, isSameVersion: isSame, existingChunk: null }).ok);
  checkTrue('blank uploadId refused', !A.evaluateChunkAcceptance({ incoming: { ...base, uploadId: '' }, isSameVersion: isSame, existingChunk: null }).ok);
  checkTrue('negative chunkIndex refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: -1 }, isSameVersion: isSame, existingChunk: null }).ok);
  checkTrue('zero chunkCount refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkCount: 0 }, isSameVersion: isSame, existingChunk: null }).ok);
  checkTrue('zero totalByteCount refused', !A.evaluateChunkAcceptance({ incoming: { ...base, totalByteCount: 0 }, isSameVersion: isSame, existingChunk: null }).ok);
  checkTrue('oversized totalByteCount refused', !A.evaluateChunkAcceptance({ incoming: { ...base, totalByteCount: A.MAX_TOTAL_BYTES + 1 }, isSameVersion: isSame, existingChunk: null }).ok);
  check('the oversized refusal names TOTAL_BYTE_COUNT_OVERSIZED', A.evaluateChunkAcceptance({ incoming: { ...base, totalByteCount: A.MAX_TOTAL_BYTES + 1 }, isSameVersion: isSame, existingChunk: null }).reasons.map(r=>r.code), ['TOTAL_BYTE_COUNT_OVERSIZED']);
  checkTrue('a chunk exceeding CHUNK_SIZE_BYTES is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkByteLength: A.CHUNK_SIZE_BYTES + 1 }, isSameVersion: isSame, existingChunk: null }).ok);
  checkTrue('chunkIndex >= chunkCount is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkIndex: 3, chunkCount: 3 }, isSameVersion: isSame, existingChunk: null }).ok);
  checkTrue('a malformed (non-64-hex) expectedFullSha256 is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, expectedFullSha256: 'not-a-hash' }, isSameVersion: isSame, existingChunk: null }).ok);
  check('the malformed-expected-hash refusal names INVALID_EXPECTED_FULL_SHA256', A.evaluateChunkAcceptance({ incoming: { ...base, expectedFullSha256: 'not-a-hash' }, isSameVersion: isSame, existingChunk: null }).reasons.map(r=>r.code), ['INVALID_EXPECTED_FULL_SHA256']);

  const existingChunk = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, uploadId: 'up-1', chunkCount: 3, totalByteCount: 300, originalFileName: 'a.pdf', expectedFullSha256: FULL_SHA, chunkSha256: HASH_0 };

  // Gate-review closure, requirement 4 -- content-aware idempotency.
  check('an IDENTICAL retry (same content hash AND same declared metadata) of an already-stored chunk index is idempotent, never re-stored, never an error', okKind(A.evaluateChunkAcceptance({ incoming: { ...base, chunkSha256: HASH_0 }, isSameVersion: isSame, existingChunk })), 'duplicate_identical');
  checkTrue('a DIFFERENT-content retry at an already-stored chunk index is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkSha256: HASH_1_DIFFERENT }, isSameVersion: isSame, existingChunk }).ok);
  check('the different-content-at-same-index refusal names DUPLICATE_CHUNK', A.evaluateChunkAcceptance({ incoming: { ...base, chunkSha256: HASH_1_DIFFERENT }, isSameVersion: isSame, existingChunk }).reasons.map(r=>r.code), ['DUPLICATE_CHUNK']);

  checkTrue('a chunk claiming a DIFFERENT version than the record already stored at this key is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, version: OTHER_VERSION }, isSameVersion: isSame, existingChunk }).ok);
  check('the cross-version refusal names CROSS_OPPORTUNITY_OR_VERSION', A.evaluateChunkAcceptance({ incoming: { ...base, version: OTHER_VERSION }, isSameVersion: isSame, existingChunk }).reasons.map(r=>r.code), ['CROSS_OPPORTUNITY_OR_VERSION']);
  checkTrue('a chunk claiming a DIFFERENT opportunityId than the record already stored at this key is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, opportunityId: 'opp-2' }, isSameVersion: isSame, existingChunk }).ok);
  check('the cross-opportunity refusal also names CROSS_OPPORTUNITY_OR_VERSION', A.evaluateChunkAcceptance({ incoming: { ...base, opportunityId: 'opp-2' }, isSameVersion: isSame, existingChunk }).reasons.map(r=>r.code), ['CROSS_OPPORTUNITY_OR_VERSION']);
  checkTrue('a chunk claiming a DIFFERENT chunkCount than the record already stored at this key is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, chunkCount: 9 }, isSameVersion: isSame, existingChunk }).ok);
  check('the chunk-count-mismatch refusal names CHUNK_COUNT_MISMATCH', A.evaluateChunkAcceptance({ incoming: { ...base, chunkCount: 9 }, isSameVersion: isSame, existingChunk }).reasons.map(r=>r.code), ['CHUNK_COUNT_MISMATCH']);
  checkTrue('a chunk claiming a DIFFERENT totalByteCount than the record already stored at this key is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, totalByteCount: 999 }, isSameVersion: isSame, existingChunk }).ok);
  checkTrue('a chunk claiming a DIFFERENT originalFileName than the record already stored at this key is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, originalFileName: 'other.pdf' }, isSameVersion: isSame, existingChunk }).ok);
  checkTrue('a chunk claiming a DIFFERENT expectedFullSha256 than the record already stored at this key is refused', !A.evaluateChunkAcceptance({ incoming: { ...base, expectedFullSha256: OTHER_FULL_SHA }, isSameVersion: isSame, existingChunk }).ok);
  check('the expected-hash mismatch refusal names EXPECTED_HASH_MISMATCH', A.evaluateChunkAcceptance({ incoming: { ...base, expectedFullSha256: OTHER_FULL_SHA }, isSameVersion: isSame, existingChunk }).reasons.map(r=>r.code), ['EXPECTED_HASH_MISMATCH']);
}

// ============================================================
// 3. evaluateFinalizeReadiness -- gate-review closure, PR #85: finalize,
//    and ONLY finalize, ever judges completeness/consistency, from
//    whatever chunks were actually found (never a manifest's own claim).
// ============================================================
{
  const isSame = B.isSameContractVersion;
  const FULL_SHA = 'd'.repeat(64);
  const expected = { opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, chunkCount: 3, totalByteCount: 300, originalFileName: 'a.pdf', expectedFullSha256: FULL_SHA };
  const chunkRecord = (chunkIndex, over) => Object.assign({ chunkIndex, opportunityId: 'opp-1', agreementAt: VERSION.agreementAt, version: VERSION, uploadId: 'up-1', chunkCount: 3, totalByteCount: 300, originalFileName: 'a.pdf', expectedFullSha256: FULL_SHA, chunkSha256: 'a'.repeat(64) }, over || {});
  const complete = [chunkRecord(0), chunkRecord(1), chunkRecord(2)];

  checkTrue('finalize is ready once every chunk index is found', A.evaluateFinalizeReadiness({ expected, isSameVersion: isSame, foundChunks: complete }).ok);
  // Gate-review closure, requirement -- found chunks arriving in ANY
  // order (reflecting genuinely out-of-order arrival) are still ready.
  checkTrue('finalize is ready regardless of the ORDER chunks were found in', A.evaluateFinalizeReadiness({ expected, isSameVersion: isSame, foundChunks: [chunkRecord(2), chunkRecord(0), chunkRecord(1)] }).ok);

  const partial = [chunkRecord(0), chunkRecord(1)];
  checkTrue('finalize is NOT ready with a missing chunk', !A.evaluateFinalizeReadiness({ expected, isSameVersion: isSame, foundChunks: partial }).ok);
  check('the missing-chunks refusal names MISSING_CHUNKS', A.evaluateFinalizeReadiness({ expected, isSameVersion: isSame, foundChunks: partial }).reasons.map(r=>r.code), ['MISSING_CHUNKS']);
  check('the missing-chunks message names the exact missing index', A.evaluateFinalizeReadiness({ expected, isSameVersion: isSame, foundChunks: partial }).reasons[0].message.includes('missing: 2'), true);

  const inconsistent = [chunkRecord(0), chunkRecord(1), chunkRecord(2, { totalByteCount: 999 })];
  checkTrue('finalize refuses when a found chunk\'s own declared metadata disagrees with this finalize request', !A.evaluateFinalizeReadiness({ expected, isSameVersion: isSame, foundChunks: inconsistent }).ok);
  check('the metadata-inconsistency refusal names INCONSISTENT_CHUNK_METADATA', A.evaluateFinalizeReadiness({ expected, isSameVersion: isSame, foundChunks: inconsistent }).reasons.map(r=>r.code), ['INCONSISTENT_CHUNK_METADATA']);
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
