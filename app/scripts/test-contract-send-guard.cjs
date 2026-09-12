/**
 * Contract-send concurrency guard -- deterministic test. B9-08 / INV-63
 * correction round, 2026-09-11, item 7: "the server must own an
 * atomic/idempotent send boundary."
 *
 * Compiles netlify/functions/lib/contract-send-guard.ts alone (it is
 * self-contained -- no imports) and exercises `parseMinimalContractSend`
 * / `findConflictingContractSend` against note bodies built from the
 * SAME `formatContractSendNote` this module's own header says it
 * duplicates rather than imports -- proving the two stay in sync, not
 * merely asserting the guard's own internal logic in isolation.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-send-guard-test');
const GUARD_SRC = path.join(APP, 'netlify', 'functions', 'lib', 'contract-send-guard.ts');
const CARRIER_SRC = path.join(APP, 'src', 'lib', 'contract-send-carriers.ts');
const BOARD9_SRC = path.join(APP, 'src', 'lib', 'board9-contract-model.ts');
const AUTH_CARRIER_SRC = path.join(APP, 'src', 'lib', 'contract-authorization-carriers.ts');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + GUARD_SRC + '" "' + CARRIER_SRC + '" "' + BOARD9_SRC + '" "' + AUTH_CARRIER_SRC + '"' +
    ' --outDir "' + TMP + '" --rootDir "' + APP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const GUARD = require(path.join(TMP, 'netlify', 'functions', 'lib', 'contract-send-guard.js'));
const K = require(path.join(TMP, 'src', 'lib', 'contract-send-carriers.js'));
const B = require(path.join(TMP, 'src', 'lib', 'board9-contract-model.js'));

const FLOOR = 19;
let failures = 0;
let checks = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }

const OPP = 'opp-guard-1';
const VERSION = B.initialVersionIdentity('2026-09-06T15:00:00.000Z');
const VERSION_RAW = JSON.stringify(VERSION);
const OTHER_VERSION_RAW = JSON.stringify(B.initialVersionIdentity('2026-09-06T16:00:00.000Z'));

function note(status, at, attemptId) {
  return K.formatContractSendNote({
    opportunityId: OPP, at, operator: null, attemptId: attemptId || at, status, version: VERSION,
    templateName: 'x', templateSource: 'x', requestedTemplateId: 'fixture-template-1', authorizedAt: '2026-09-11T10:00:00.000Z',
    signers: [{ role: 'Seller', displayName: 'Jane Seller' }], confirmedRecipientId: null, expirationAt: '2026-09-18T23:59:59.000Z',
    requestAt: attemptId || at, iaosObservedAcceptanceAt: null, providerResponse: null, failureReason: null,
  });
}

// ============================================================
// 1. parseMinimalContractSend -- well-formed vs malformed.
// ============================================================
{
  const parsed = GUARD.parseMinimalContractSend(note('in_progress', '2026-09-11T11:00:00.000Z'));
  checkTrue('a well-formed contract-send note parses', parsed !== null);
  check('parsed opportunityId matches', parsed.opportunityId, OPP);
  check('parsed status matches', parsed.status, 'in_progress');
  check('parsed versionRaw matches the exact JSON the carrier wrote', parsed.versionRaw, VERSION_RAW);

  check('an ordinary, unrelated note body does not parse', GUARD.parseMinimalContractSend('Some other note\nLine 2'), null);
  check('an empty string does not parse', GUARD.parseMinimalContractSend(''), null);
  check('a non-string body does not parse', GUARD.parseMinimalContractSend(null), null);
}

// ============================================================
// 2. findConflictingContractSend -- no conflict on an empty/unrelated set.
// ============================================================
{
  check('no notes at all -- no conflict', GUARD.findConflictingContractSend([], OPP, VERSION_RAW), { conflict: false });
  const unrelated = [{ body: 'Some other note' }];
  check('only unrelated notes -- no conflict', GUARD.findConflictingContractSend(unrelated, OPP, VERSION_RAW), { conflict: false });
}

// ============================================================
// 3. An in_progress attempt for the SAME opportunity+version conflicts --
//    this is exactly the case that must block a concurrent second tab.
// ============================================================
{
  const notes = [{ body: note('in_progress', '2026-09-11T11:00:00.000Z') }];
  const result = GUARD.findConflictingContractSend(notes, OPP, VERSION_RAW);
  checkTrue('an in_progress attempt for the same opportunity+version conflicts', result.conflict === true);
  check('the conflict reports the in_progress status', result.status, 'in_progress');
}

// ============================================================
// 4. provider_accepted_pending_readback and accepted also conflict --
//    both represent a real provider-side send already in flight/done.
// ============================================================
{
  checkTrue('provider_accepted_pending_readback conflicts', GUARD.findConflictingContractSend([{ body: note('provider_accepted_pending_readback', '2026-09-11T11:00:01.000Z') }], OPP, VERSION_RAW).conflict === true);
  checkTrue('accepted conflicts', GUARD.findConflictingContractSend([{ body: note('accepted', '2026-09-11T11:00:02.000Z') }], OPP, VERSION_RAW).conflict === true);
}

// ============================================================
// 5. failed / ambiguous do NOT conflict -- retry is the intended
//    failure-recovery path (matches contract-send-model.ts's own rule).
// ============================================================
{
  checkTrue('failed does not conflict', GUARD.findConflictingContractSend([{ body: note('failed', '2026-09-11T11:00:03.000Z') }], OPP, VERSION_RAW).conflict === false);
  checkTrue('ambiguous does not conflict', GUARD.findConflictingContractSend([{ body: note('ambiguous', '2026-09-11T11:00:04.000Z') }], OPP, VERSION_RAW).conflict === false);
}

// ============================================================
// 6. A resolution note ALWAYS supersedes its own earlier in_progress
//    note for the SAME attemptId -- an attempt that failed and was
//    properly resolved does not falsely block a retry.
// ============================================================
{
  const attemptId = '2026-09-11T11:00:05.000Z';
  const notes = [
    { body: note('in_progress', attemptId, attemptId) },
    { body: note('failed', '2026-09-11T11:00:06.000Z', attemptId) },
  ];
  const result = GUARD.findConflictingContractSend(notes, OPP, VERSION_RAW);
  checkTrue('an in_progress note resolved to failed for the SAME attemptId does not conflict', result.conflict === false);
}

// ============================================================
// 7. A different opportunity, or a different version, never conflicts --
//    the guard is exact-scoped, matching contract-send-model.ts's own
//    version-scoped idempotency rule.
// ============================================================
{
  const notes = [{ body: note('in_progress', '2026-09-11T11:00:07.000Z') }];
  checkTrue('a different opportunity never conflicts', GUARD.findConflictingContractSend(notes, 'a-totally-different-opp', VERSION_RAW).conflict === false);
  checkTrue('a different version for the SAME opportunity never conflicts', GUARD.findConflictingContractSend(notes, OPP, OTHER_VERSION_RAW).conflict === false);
}

// ============================================================
// 8. THE race this correction round exists to close: two "tabs" each
//    build their own in_progress note for the SAME opportunity+version
//    at nearly the same instant -- the guard must catch the second one
//    once the first is already on record, regardless of which one it
//    is asked about.
// ============================================================
{
  const tabA = note('in_progress', '2026-09-11T11:00:08.000Z');
  const notesAfterTabAWrote = [{ body: tabA }];
  const tabBCheck = GUARD.findConflictingContractSend(notesAfterTabAWrote, OPP, VERSION_RAW);
  checkTrue('once tab A\'s in_progress note is on record, tab B\'s own reservation check reports a conflict', tabBCheck.conflict === true);
}

console.log('');
console.log(checks + ' checks, ' + failures + ' failures.');
if (checks < FLOOR) {
  console.error('ABORT: only ' + checks + ' checks ran, floor is ' + FLOOR + '.');
  cleanup();
  process.exit(11);
}
cleanup();
process.exit(failures === 0 ? 0 : 1);
