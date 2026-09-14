/**
 * INV-67 / B9-12 contract-population repair -- deterministic proof of
 * `contract-draft-request-model.ts`, the one-shot Contract Draft Request
 * control AND (Jess Gate audit-ordering correction, this session) its
 * two-phase attempt/resolution evidence builders. Pure functions plus
 * static source-order checks against `ContractWorkspace.tsx`; no GHL, no
 * network.
 *
 * Proves the corrected ruling exactly:
 *  1. Default/fail-safe normalization -- absent, malformed, or any value
 *     other than "Requested" reads as "Idle".
 *  2. Duplicate/stale-request protection -- a fresh currentRaw of
 *     "Requested" refuses EVERY transition, regardless of projection state.
 *  3. Fail-closed on incomplete or partially-landed projection writes.
 *  4. Fail-closed on a current-offer cross-check mismatch.
 *  5. The happy path is allowed only when ALL guards clear simultaneously.
 *  6. `buildContractDraftRequestAttemptRecord` / `...ResolutionRecord`
 *     share one attemptId, carry the attempt's own facts forward
 *     unchanged onto the resolution, and two separate attempts (two
 *     separate `attemptAt` values) never collide.
 *  7. STATIC: the handler in `ContractWorkspace.tsx` writes the attempt
 *     note BEFORE the "Requested" PUT, gates the PUT on the attempt note's
 *     own success, and writes the resolution note AFTER, for the SAME
 *     attemptId, with a fresh `attemptAt` generated INSIDE the handler on
 *     every invocation (never hoisted/memoized -- so a repeated UI action
 *     cannot reuse an earlier attempt id).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-draft-request-test');
const MODEL = path.join(APP, 'src', 'lib', 'contract-draft-request-model.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(`npx tsc "${MODEL}" --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const {
  CONTRACT_DRAFT_REQUEST_OPTIONS,
  normalizeContractDraftRequestState,
  isRecognizedContractDraftRequestState,
  evaluateContractDraftRequestTransition,
  buildContractDraftRequestAttemptRecord,
  buildContractDraftRequestResolutionRecord,
} = require(path.join(TMP, 'contract-draft-request-model.js'));

const FLOOR = 40;
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

const OK_PROJECTION = { entryCount: 48, allEntriesLanded: true };

check('CONTRACT_DRAFT_REQUEST_OPTIONS is exactly ["Idle","Requested"]', CONTRACT_DRAFT_REQUEST_OPTIONS, ['Idle', 'Requested']);

/* -------------------------------------------------- normalization ---- */
check('normalize: null reads as Idle', normalizeContractDraftRequestState(null), 'Idle');
check('normalize: "" reads as Idle', normalizeContractDraftRequestState(''), 'Idle');
check('normalize: "idle" (wrong case) reads as Idle', normalizeContractDraftRequestState('idle'), 'Idle');
check('normalize: garbage reads as Idle', normalizeContractDraftRequestState('garbage'), 'Idle');
check('normalize: "Idle" reads as Idle', normalizeContractDraftRequestState('Idle'), 'Idle');
check('normalize: "Requested" reads as Requested', normalizeContractDraftRequestState('Requested'), 'Requested');

checkTrue('isRecognized: "Idle" is recognized', isRecognizedContractDraftRequestState('Idle'));
checkTrue('isRecognized: "Requested" is recognized', isRecognizedContractDraftRequestState('Requested'));
check('isRecognized: null is not recognized', isRecognizedContractDraftRequestState(null), false);
check('isRecognized: garbage is not recognized', isRecognizedContractDraftRequestState('garbage'), false);

/* -------------------------------------------------- duplicate guard -- */
{
  const result = evaluateContractDraftRequestTransition({
    currentRaw: 'Requested',
    projection: OK_PROJECTION,
    currentOfferCrossCheckOk: true,
  });
  check('refused when currentRaw is already "Requested"', result.allowed, false);
  checkTrue('refusal reason names the duplicate-request rule', !result.allowed && /already "Requested"/.test(result.reason));
}
{
  const first = evaluateContractDraftRequestTransition({ currentRaw: 'Requested', projection: OK_PROJECTION, currentOfferCrossCheckOk: true });
  const second = evaluateContractDraftRequestTransition({ currentRaw: 'Requested', projection: OK_PROJECTION, currentOfferCrossCheckOk: true });
  check('repeated invocation while Requested refuses identically both times', [first.allowed, second.allowed], [false, false]);
}

/* -------------------------------------------------- projection guards */
{
  const result = evaluateContractDraftRequestTransition({
    currentRaw: 'Idle',
    projection: { entryCount: 0, allEntriesLanded: true },
    currentOfferCrossCheckOk: true,
  });
  check('refused when zero projection entries were supplied', result.allowed, false);
}
{
  const result = evaluateContractDraftRequestTransition({
    currentRaw: 'Idle',
    projection: { entryCount: 48, allEntriesLanded: false },
    currentOfferCrossCheckOk: true,
  });
  check('refused on a partial (not-all-landed) projection write', result.allowed, false);
  checkTrue('refusal reason names the partial-synchronization rule', !result.allowed && /partial synchronization/.test(result.reason));
}
{
  const result = evaluateContractDraftRequestTransition({
    currentRaw: null,
    projection: { entryCount: 48, allEntriesLanded: false },
    currentOfferCrossCheckOk: true,
  });
  check('a stale/never-set field (null) still enforces the partial-write guard, not fail-open', result.allowed, false);
}

/* -------------------------------------------------- price cross-check */
{
  const result = evaluateContractDraftRequestTransition({
    currentRaw: 'Idle',
    projection: OK_PROJECTION,
    currentOfferCrossCheckOk: false,
  });
  check('refused on a current-offer / sales-price mismatch', result.allowed, false);
  checkTrue('refusal reason names the price-mismatch rule', !result.allowed && /price mismatch/.test(result.reason));
}

/* -------------------------------------------------- happy path ------- */
{
  const result = evaluateContractDraftRequestTransition({
    currentRaw: 'Idle',
    projection: OK_PROJECTION,
    currentOfferCrossCheckOk: true,
  });
  check('allowed only when every guard clears -- Idle, full landing, price match', result, { allowed: true });
}
{
  const result = evaluateContractDraftRequestTransition({
    currentRaw: null,
    projection: OK_PROJECTION,
    currentOfferCrossCheckOk: true,
  });
  check('allowed from an absent (never-set) field, same as an explicit Idle', result, { allowed: true });
}

/* -------------------------------------------------- guard ordering does not matter for correctness */
{
  const combos = [
    { currentRaw: 'Requested', projection: { entryCount: 48, allEntriesLanded: false }, currentOfferCrossCheckOk: false },
    { currentRaw: 'Idle', projection: { entryCount: 0, allEntriesLanded: true }, currentOfferCrossCheckOk: false },
  ];
  checkTrue('every multi-failure combination still refuses', combos.every((c) => evaluateContractDraftRequestTransition(c).allowed === false));
}

/* ==================================================================== */
/* Two-phase attempt/resolution evidence builders                        */
/* ==================================================================== */

const VERSION = { agreementAt: '2026-09-01T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };

const ATTEMPT_ARGS = {
  opportunityId: 'OPP-1',
  operator: 'brad',
  attemptAt: '2026-09-14T12:00:00.000Z',
  version: VERSION,
  entriesAttempted: 48,
  entriesLanded: 48,
  failedKeys: [],
  currentOfferCrossCheckOk: true,
  observedStateBeforeWrite: 'Idle',
};

{
  const attempt = buildContractDraftRequestAttemptRecord(ATTEMPT_ARGS);
  check('attempt record status is "in_progress"', attempt.status, 'in_progress');
  check('attempt record attemptId equals attemptAt', attempt.attemptId, ATTEMPT_ARGS.attemptAt);
  check('attempt record "at" equals attemptAt (this note IS the attempt)', attempt.at, ATTEMPT_ARGS.attemptAt);
  check('attempt record intendedToState is always "Requested"', attempt.intendedToState, 'Requested');
  check('attempt record carries the freshly observed pre-write state', attempt.observedStateBeforeWrite, 'Idle');
  check('attempt record has no resolution-only facts yet', [attempt.sentValue, attempt.observedValue, attempt.providerStatus, attempt.failureReason], [null, null, null, null]);
  check('attempt record carries the projection counts verbatim', [attempt.entriesAttempted, attempt.entriesLanded], [48, 48]);
}

{
  const attempt = buildContractDraftRequestAttemptRecord(ATTEMPT_ARGS);
  const resolution = buildContractDraftRequestResolutionRecord({
    attempt, resolvedAt: '2026-09-14T12:00:05.000Z', status: 'accepted',
    sentValue: 'Requested', observedValue: 'Requested', providerStatus: 200, failureReason: null,
  });
  check('resolution shares the SAME attemptId as its attempt', resolution.attemptId, attempt.attemptId);
  check('resolution shares the exact same ContractVersionIdentity', resolution.version, VERSION);
  check('resolution "at" is the resolution timestamp, distinct from the attempt\'s', resolution.at, '2026-09-14T12:00:05.000Z');
  checkTrue('resolution "at" differs from attempt "at"', resolution.at !== attempt.at);
  check('resolution carries the attempt\'s projection counts forward unchanged', [resolution.entriesAttempted, resolution.entriesLanded], [48, 48]);
  check('resolution carries the attempt\'s observedStateBeforeWrite forward unchanged', resolution.observedStateBeforeWrite, 'Idle');
  check('resolution status "accepted" carries sent/observed/provider facts', [resolution.sentValue, resolution.observedValue, resolution.providerStatus], ['Requested', 'Requested', 200]);
}

{
  // Readback mismatch after a successful PUT -- "indeterminate", never "accepted" or "failed".
  const attempt = buildContractDraftRequestAttemptRecord(ATTEMPT_ARGS);
  const resolution = buildContractDraftRequestResolutionRecord({
    attempt, resolvedAt: '2026-09-14T12:00:05.000Z', status: 'indeterminate',
    sentValue: 'Requested', observedValue: 'Idle', providerStatus: 200,
    failureReason: 'PUT succeeded but readback did not confirm "Requested" (observed "Idle").',
  });
  check('indeterminate resolution status is exactly "indeterminate"', resolution.status, 'indeterminate');
  checkTrue('indeterminate resolution carries a non-null failureReason', typeof resolution.failureReason === 'string' && resolution.failureReason.length > 0);
}

{
  // The PUT itself never reached GHL -- "failed", no sent/observed/provider facts.
  const attempt = buildContractDraftRequestAttemptRecord(ATTEMPT_ARGS);
  const resolution = buildContractDraftRequestResolutionRecord({
    attempt, resolvedAt: '2026-09-14T12:00:05.000Z', status: 'failed',
    sentValue: null, observedValue: null, providerStatus: null, failureReason: 'network error',
  });
  check('a PUT that never reached GHL resolves "failed" with no provider facts', [resolution.status, resolution.sentValue, resolution.observedValue, resolution.providerStatus], ['failed', null, null, null]);
}

{
  // Two separate attempts (two separate attemptAt values) never collide.
  const attemptA = buildContractDraftRequestAttemptRecord({ ...ATTEMPT_ARGS, attemptAt: '2026-09-14T12:00:00.000Z' });
  const attemptB = buildContractDraftRequestAttemptRecord({ ...ATTEMPT_ARGS, attemptAt: '2026-09-14T12:05:00.000Z' });
  checkTrue('two distinct attemptAt values never produce the same attemptId', attemptA.attemptId !== attemptB.attemptId);
}

/* ==================================================================== */
/* STATIC -- ContractWorkspace.tsx source-order proofs                   */
/* ==================================================================== */

{
  const src = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = src.match(/async function handleSyncContractProjectionFields\(\)[\s\S]*?\r?\n  \}\r?\n/);
  checkTrue('handleSyncContractProjectionFields was located in the page source', !!m);
  const body = m ? m[0] : '';

  const attemptNoteIdx = body.indexOf('await ghl.notes.create(contactId, attemptNote)');
  const setDraftRequestIdx = body.indexOf('ghl.opportunities.setContractDraftRequest(');
  const resolutionNoteIdx = body.indexOf('await ghl.notes.create(contactId, resolutionNote)');

  checkTrue('the attempt note is written before the "Requested" PUT is ever attempted', attemptNoteIdx !== -1 && setDraftRequestIdx !== -1 && attemptNoteIdx < setDraftRequestIdx);
  checkTrue('the resolution note is written after the "Requested" PUT is attempted', resolutionNoteIdx !== -1 && setDraftRequestIdx < resolutionNoteIdx);
  checkTrue(
    'the "Requested" PUT is nested inside an "if (attemptNoteOk)" guard, not unconditional',
    /if \(attemptNoteOk\) \{[\s\S]*?setContractDraftRequest\(/.test(body),
  );
  checkTrue(
    'the attempt-note write is wrapped in its own try/catch that sets attemptNoteOk',
    /let attemptNoteOk = false;[\s\S]*?try \{[\s\S]*?attemptNoteOk = true;[\s\S]*?\} catch/.test(body),
  );
  checkTrue(
    'a failed attempt note refuses the transition WITHOUT ever calling setContractDraftRequest inside its own catch block',
    (() => {
      const catchMatch = body.match(/attemptNoteOk = true;[\s\S]*?\} catch \(e: any\) \{([\s\S]*?)\r?\n\s{12}\}/);
      return !!catchMatch && !catchMatch[1].includes('setContractDraftRequest(');
    })(),
  );
  checkTrue('attemptAt is generated fresh, inside the handler, via new Date().toISOString()', /const attemptAt = new Date\(\)\.toISOString\(\);/.test(body));
  checkTrue('attemptAt is declared with const (never reassigned / never hoisted to a ref)', !/let attemptAt/.test(body));
  checkTrue('the resolution note failure path never re-attempts the PUT (no second setContractDraftRequest call)', (body.match(/setContractDraftRequest\(/g) || []).length === 1);
  checkTrue('a successful PUT whose resolution note fails is escalated to "indeterminate" (never silently "accepted")', /reportedStatus[\s\S]*?rawStatus === "accepted" && !resolutionNoteOk \? "indeterminate" : rawStatus/.test(body));
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
