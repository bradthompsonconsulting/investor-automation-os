/**
 * INV-67 / B9-12 contract-population repair -- deterministic proof of
 * `contract-draft-request-model.ts`, the one-shot Contract Draft Request
 * control. Pure functions only; no GHL, no network.
 *
 * Proves the corrected ruling exactly:
 *  1. Default/fail-safe normalization -- absent, malformed, or any value
 *     other than "Requested" reads as "Idle".
 *  2. Duplicate/stale-request protection -- a fresh currentRaw of
 *     "Requested" refuses EVERY transition, regardless of projection state.
 *  3. Fail-closed on incomplete or partially-landed projection writes.
 *  4. Fail-closed on a current-offer cross-check mismatch.
 *  5. The happy path is allowed only when ALL guards clear simultaneously.
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
} = require(path.join(TMP, 'contract-draft-request-model.js'));

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
  // Repeated clicks: two consecutive fresh reads both report Requested -- both refuse identically.
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
  // Absent field (never set) behaves exactly like an explicit "Idle" read for gating purposes.
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
  // Every combination of two simultaneous failures still refuses -- no guard silently overrides another.
  const combos = [
    { currentRaw: 'Requested', projection: { entryCount: 48, allEntriesLanded: false }, currentOfferCrossCheckOk: false },
    { currentRaw: 'Idle', projection: { entryCount: 0, allEntriesLanded: true }, currentOfferCrossCheckOk: false },
  ];
  checkTrue('every multi-failure combination still refuses', combos.every((c) => evaluateContractDraftRequestTransition(c).allowed === false));
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
