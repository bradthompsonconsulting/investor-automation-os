/**
 * INV-67 / B9-12 contract-population repair -- deterministic proof of
 * `contract-projection-sync-carriers.ts`, the two-phase attempt/resolution
 * audit-evidence ledger for a Contract Draft Request sync attempt (Jess Gate
 * audit-ordering correction, this session). Pure functions only; no GHL, no
 * network.
 *
 * Proves:
 *  1. Format/parse round-trips exactly for all three terminal statuses
 *     ("accepted", "failed", "indeterminate") plus the "in_progress" note.
 *  2. Malformed/foreign note bodies parse as null, never a best-effort
 *     partial record.
 *  3. Rank-then-latest-attempt reading, mirroring `contract-send-
 *     carriers.ts`'s own `latestContractSendForOpportunity` exactly: a
 *     terminal note ALWAYS supersedes an in_progress note for the SAME
 *     attemptId regardless of exact timestamp ordering, and the most
 *     recent ATTEMPT overall (by attemptId) wins, scoped to one Opportunity.
 *  4. Staleness detection reuses `isSameContractVersion`.
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

const FLOOR = 23;
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

const ATTEMPT_ID = '2026-09-14T12:00:00.000Z';

const IN_PROGRESS_RECORD = {
  at: ATTEMPT_ID,
  operator: 'brad',
  opportunityId: 'OPP-1',
  attemptId: ATTEMPT_ID,
  status: 'in_progress',
  version: VERSION_1,
  entriesAttempted: 48,
  entriesLanded: 48,
  failedKeys: [],
  currentOfferCrossCheckOk: true,
  observedStateBeforeWrite: 'Idle',
  intendedToState: 'Requested',
  sentValue: null,
  observedValue: null,
  providerStatus: null,
  failureReason: null,
};

const ACCEPTED_RECORD = {
  ...IN_PROGRESS_RECORD,
  at: '2026-09-14T12:00:05.000Z',
  status: 'accepted',
  sentValue: 'Requested',
  observedValue: 'Requested',
  providerStatus: 200,
  failureReason: null,
};

const FAILED_RECORD = {
  ...IN_PROGRESS_RECORD,
  at: '2026-09-14T12:00:05.000Z',
  status: 'failed',
  sentValue: null,
  observedValue: null,
  providerStatus: null,
  failureReason: 'network error',
};

const INDETERMINATE_RECORD = {
  ...IN_PROGRESS_RECORD,
  at: '2026-09-14T12:00:05.000Z',
  status: 'indeterminate',
  sentValue: 'Requested',
  observedValue: 'Idle',
  providerStatus: 200,
  failureReason: 'PUT succeeded but readback did not confirm "Requested" (observed "Idle").',
};

/* -------------------------------------------------- round trip ------- */
check('round-trips the in_progress attempt record exactly', parseContractProjectionSyncNote(formatContractProjectionSyncNote(IN_PROGRESS_RECORD)), IN_PROGRESS_RECORD);
check('round-trips an accepted resolution record exactly', parseContractProjectionSyncNote(formatContractProjectionSyncNote(ACCEPTED_RECORD)), ACCEPTED_RECORD);
check('round-trips a failed resolution record exactly (no provider facts)', parseContractProjectionSyncNote(formatContractProjectionSyncNote(FAILED_RECORD)), FAILED_RECORD);
check('round-trips an indeterminate resolution record exactly', parseContractProjectionSyncNote(formatContractProjectionSyncNote(INDETERMINATE_RECORD)), INDETERMINATE_RECORD);
{
  const withFailures = { ...ACCEPTED_RECORD, status: 'failed', entriesLanded: 46, failedKeys: ['titleSurvey.objectionsDays', 'noticeContact.sellerNoticeEmail'], sentValue: null, observedValue: null, providerStatus: null, failureReason: 'partial' };
  check('round-trips a record with a non-empty failedKeys array', parseContractProjectionSyncNote(formatContractProjectionSyncNote(withFailures)), withFailures);
}

/* -------------------------------------------------- malformed --------- */
check('a foreign note body parses as null', parseContractProjectionSyncNote('some unrelated note body'), null);
check('an empty string parses as null', parseContractProjectionSyncNote(''), null);
check('a truncated note (missing lines) parses as null', parseContractProjectionSyncNote(formatContractProjectionSyncNote(ACCEPTED_RECORD).split('\n').slice(0, 5).join('\n')), null);
{
  const corrupted = formatContractProjectionSyncNote(ACCEPTED_RECORD).replace('Status: accepted', 'Status: maybe');
  check('an invalid Status value parses as null, not coerced', parseContractProjectionSyncNote(corrupted), null);
}
{
  const corrupted = formatContractProjectionSyncNote(ACCEPTED_RECORD).replace(/Failed keys: .*/, 'Failed keys: not-json');
  check('an unparseable Failed keys field parses as null', parseContractProjectionSyncNote(corrupted), null);
}
{
  const corrupted = formatContractProjectionSyncNote(ACCEPTED_RECORD).replace('Operator: brad', 'Operator: UNAVAILABLE');
  check('an UNAVAILABLE operator parses as null (operator is required)', parseContractProjectionSyncNote(corrupted), null);
}
{
  const corrupted = formatContractProjectionSyncNote(ACCEPTED_RECORD).replace('Observed state before write: Idle', 'Observed state before write: Sideways');
  check('an unrecognized "Observed state before write" value parses as null', parseContractProjectionSyncNote(corrupted), null);
}
{
  const corrupted = formatContractProjectionSyncNote(ACCEPTED_RECORD).replace(/Attempt id: .*/, 'Attempt id: not-a-timestamp');
  check('a non-ISO Attempt id parses as null', parseContractProjectionSyncNote(corrupted), null);
}

/* -------------------------------------------------- rank-then-latest -- */
{
  // A terminal note ALWAYS supersedes in_progress for the SAME attemptId,
  // regardless of which was written more recently in wall-clock terms
  // (the in_progress note's own "at" always precedes the resolution's, by
  // construction, but this proves the READER does not merely pick the
  // latest "at" -- it ranks first).
  const notes = [
    { body: formatContractProjectionSyncNote(IN_PROGRESS_RECORD) },
    { body: formatContractProjectionSyncNote(ACCEPTED_RECORD) },
  ];
  check('a terminal (accepted) note supersedes its own in_progress note', latestContractProjectionSyncForOpportunity(notes, 'OPP-1'), ACCEPTED_RECORD);
}
{
  // Order in the notes array must not matter.
  const notes = [
    { body: formatContractProjectionSyncNote(ACCEPTED_RECORD) },
    { body: formatContractProjectionSyncNote(IN_PROGRESS_RECORD) },
  ];
  check('rank resolution holds regardless of array order', latestContractProjectionSyncForOpportunity(notes, 'OPP-1'), ACCEPTED_RECORD);
}
{
  // Only an in_progress note exists (resolution note failed to write, or
  // hasn't happened yet) -- the reader reports the pending attempt itself,
  // never null and never a fabricated terminal state.
  const notes = [{ body: formatContractProjectionSyncNote(IN_PROGRESS_RECORD) }];
  check('an attempt with no resolution note yet reads as its own in_progress record', latestContractProjectionSyncForOpportunity(notes, 'OPP-1'), IN_PROGRESS_RECORD);
}
{
  // The most recent ATTEMPT overall wins -- an older attempt's terminal
  // note does not outrank a newer attempt's in_progress note.
  const olderAttempt = { ...ACCEPTED_RECORD, attemptId: '2026-09-14T10:00:00.000Z', at: '2026-09-14T10:00:05.000Z' };
  const newerAttemptInProgress = { ...IN_PROGRESS_RECORD, attemptId: '2026-09-14T12:00:00.000Z', at: '2026-09-14T12:00:00.000Z' };
  const notes = [{ body: formatContractProjectionSyncNote(olderAttempt) }, { body: formatContractProjectionSyncNote(newerAttemptInProgress) }];
  check('the most recent attempt (by attemptId) wins, even mid-flight, over an older completed one', latestContractProjectionSyncForOpportunity(notes, 'OPP-1'), newerAttemptInProgress);
}
{
  const notes = [
    { body: formatContractProjectionSyncNote(ACCEPTED_RECORD) },
    { body: formatContractProjectionSyncNote({ ...FAILED_RECORD, opportunityId: 'OPP-2', attemptId: '2026-09-14T14:00:00.000Z', at: '2026-09-14T14:00:00.000Z' }) },
    { body: 'unrelated note' },
  ];
  check('a different opportunity id never contaminates the result', latestContractProjectionSyncForOpportunity(notes, 'OPP-2').opportunityId, 'OPP-2');
  check('no matching notes for an opportunity reads as null', latestContractProjectionSyncForOpportunity(notes, 'OPP-3'), null);
  check('an empty notes array reads as null', latestContractProjectionSyncForOpportunity([], 'OPP-1'), null);
}

/* -------------------------------------------------- staleness ---------- */
check('a record bound to the current version is not stale', isContractProjectionSyncStale(ACCEPTED_RECORD, VERSION_1), false);
check('a record bound to an earlier version is stale against a newer one', isContractProjectionSyncStale(ACCEPTED_RECORD, VERSION_2), true);
check('no record at all is ALWAYS stale (fail-closed, never "still current")', isContractProjectionSyncStale(null, VERSION_1), true);

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
