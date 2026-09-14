/**
 * INV-67 / B9-12 contract-population repair -- deterministic proof of
 * `contract-projection-sync-carriers.ts`, the append-only audit-evidence
 * ledger for a contract-projection sync attempt. Pure functions only; no
 * GHL, no network.
 *
 * Proves:
 *  1. Format/parse round-trips exactly, including a failure case (partial
 *     landing, refused draft request).
 *  2. Malformed/foreign note bodies parse as null, never a best-effort
 *     partial record.
 *  3. "Latest wins, scoped to ONE Opportunity" -- the same reader shape
 *     every existing B9 carrier uses.
 *  4. Append-only: parsing never mutates, and multiple records for
 *     different opportunities never cross-contaminate.
 *  5. Staleness detection reuses `isSameContractVersion` -- a record bound
 *     to an earlier version reads as stale against a newer one, and no
 *     record at all is ALWAYS stale (fail-closed).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-projection-sync-carriers-test');
const CARRIERS = path.join(APP, 'src', 'lib', 'contract-projection-sync-carriers.ts');
const BOARD9 = path.join(APP, 'src', 'lib', 'board9-contract-model.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(`npx tsc "${CARRIERS}" "${BOARD9}" --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const {
  formatContractProjectionSyncNote,
  parseContractProjectionSyncNote,
  latestContractProjectionSyncForOpportunity,
  isContractProjectionSyncStale,
} = require(path.join(TMP, 'contract-projection-sync-carriers.js'));

const FLOOR = 17;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name);
    console.log('      expected: ' + JSON.stringify(expected));
    console.log('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }

const VERSION_1 = { agreementAt: '2026-09-01T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };
const VERSION_2 = { agreementAt: '2026-09-01T00:00:00.000Z', versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null };

const OK_RECORD = {
  at: '2026-09-14T12:00:00.000Z',
  opportunityId: 'OPP-1',
  version: VERSION_1,
  ok: true,
  entriesAttempted: 48,
  entriesLanded: 48,
  failedKeys: [],
  currentOfferCrossCheckOk: true,
  draftRequest: { attempted: true, allowed: true, reason: null, fromState: 'Idle', toState: 'Requested' },
  operator: 'brad',
};

const PARTIAL_RECORD = {
  at: '2026-09-14T13:00:00.000Z',
  opportunityId: 'OPP-1',
  version: VERSION_1,
  ok: false,
  entriesAttempted: 48,
  entriesLanded: 46,
  failedKeys: ['titleSurvey.objectionsDays', 'noticeContact.sellerNoticeEmail'],
  currentOfferCrossCheckOk: true,
  draftRequest: { attempted: false, allowed: false, reason: null, fromState: null, toState: null },
  operator: 'brad',
};

/* -------------------------------------------------- round trip ------- */
check('round-trips the ok/happy-path record exactly', parseContractProjectionSyncNote(formatContractProjectionSyncNote(OK_RECORD)), OK_RECORD);
check('round-trips a partial/failed record exactly, failedKeys included', parseContractProjectionSyncNote(formatContractProjectionSyncNote(PARTIAL_RECORD)), PARTIAL_RECORD);

{
  const declined = { ...OK_RECORD, draftRequest: { attempted: true, allowed: false, reason: 'a price mismatch existed', fromState: 'Idle', toState: 'Idle' } };
  check('round-trips a refused-draft-request record, reason text preserved', parseContractProjectionSyncNote(formatContractProjectionSyncNote(declined)), declined);
}

/* -------------------------------------------------- malformed --------- */
check('a foreign note body parses as null', parseContractProjectionSyncNote('some unrelated note body'), null);
check('an empty string parses as null', parseContractProjectionSyncNote(''), null);
check('a truncated note (missing lines) parses as null', parseContractProjectionSyncNote(formatContractProjectionSyncNote(OK_RECORD).split('\n').slice(0, 5).join('\n')), null);
{
  const corrupted = formatContractProjectionSyncNote(OK_RECORD).replace('Overall ok: true', 'Overall ok: maybe');
  check('an invalid "Overall ok" value parses as null, not coerced', parseContractProjectionSyncNote(corrupted), null);
}
{
  const corrupted = formatContractProjectionSyncNote(OK_RECORD).replace(/Failed keys: .*/, 'Failed keys: not-json');
  check('an unparseable Failed keys field parses as null', parseContractProjectionSyncNote(corrupted), null);
}
{
  const corrupted = formatContractProjectionSyncNote(OK_RECORD).replace('Operator: brad', 'Operator: UNAVAILABLE');
  check('an UNAVAILABLE operator parses as null (operator is required)', parseContractProjectionSyncNote(corrupted), null);
}

/* -------------------------------------------------- latest-wins, scoped */
{
  const notes = [
    { body: formatContractProjectionSyncNote(OK_RECORD) },
    { body: formatContractProjectionSyncNote(PARTIAL_RECORD) },
    { body: formatContractProjectionSyncNote({ ...OK_RECORD, opportunityId: 'OPP-2', at: '2026-09-14T14:00:00.000Z' }) },
    { body: 'unrelated note' },
  ];
  check('latest entry wins, scoped to the given opportunity', latestContractProjectionSyncForOpportunity(notes, 'OPP-1'), PARTIAL_RECORD);
  check('a different opportunity id never contaminates the result', latestContractProjectionSyncForOpportunity(notes, 'OPP-2').opportunityId, 'OPP-2');
  check('no matching notes for an opportunity reads as null', latestContractProjectionSyncForOpportunity(notes, 'OPP-3'), null);
  check('an empty notes array reads as null', latestContractProjectionSyncForOpportunity([], 'OPP-1'), null);
}
{
  // Order in the array must not matter -- "latest" is by timestamp, not array position.
  const notes = [
    { body: formatContractProjectionSyncNote(PARTIAL_RECORD) },
    { body: formatContractProjectionSyncNote(OK_RECORD) },
  ];
  check('latest-by-timestamp holds regardless of array order', latestContractProjectionSyncForOpportunity(notes, 'OPP-1').at, PARTIAL_RECORD.at);
}

/* -------------------------------------------------- staleness ---------- */
check('a record bound to the current version is not stale', isContractProjectionSyncStale(OK_RECORD, VERSION_1), false);
check('a record bound to an earlier version is stale against a newer one', isContractProjectionSyncStale(OK_RECORD, VERSION_2), true);
check('no record at all is ALWAYS stale (fail-closed, never "still current")', isContractProjectionSyncStale(null, VERSION_1), true);

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
