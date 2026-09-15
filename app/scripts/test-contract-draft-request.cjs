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
  classifyContractDraftRequestOutcome,
} = require(path.join(TMP, 'contract-draft-request-model.js'));

const FLOOR = 104;
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

/** INV-67 Phase 1 Jess re-gate correction -- a representative, fully-ok evidence snapshot. Its own shape/derivation is proven directly in `test-contract-seller-signing-model.cjs`; here it is only carried through. */
const SELLER_SIGNING_EVIDENCE = {
  sellerCountDiscriminator: 'one_seller',
  seller1Ok: true,
  seller1ContactId: 'CONTACT-1',
  seller1Capacity: 'individual_own_capacity',
  seller2LegalName: null,
  seller2NormalizedEmail: null,
  seller2Capacity: null,
  printedPartyConsistencyOk: true,
  expectedSellerCountTransportValue: 'One Seller',
  canonicalReadinessOk: true,
  sellerCountFieldProvisioned: true,
  sellerCountWriteReadbackOk: true,
  effectiveDateStatus: 'pending_final_acceptance',
  recipientAssignmentStatus: 'pending_manual_review',
  blockingReasons: [],
  sendOccurred: false,
};

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
  sellerSigningEvidence: SELLER_SIGNING_EVIDENCE,
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

/* ==================================================================== */
/* INV-67 Phase 1 Jess re-gate correction -- sellerSigningEvidence        */
/* ==================================================================== */

{
  const attempt = buildContractDraftRequestAttemptRecord(ATTEMPT_ARGS);
  check('attempt record carries the exact seller signing evidence supplied', attempt.sellerSigningEvidence, SELLER_SIGNING_EVIDENCE);
  const resolution = buildContractDraftRequestResolutionRecord({
    attempt, resolvedAt: '2026-09-14T12:00:05.000Z', status: 'accepted',
    sentValue: 'Requested', observedValue: 'Requested', providerStatus: 200, failureReason: null,
  });
  check('resolution carries the attempt\'s seller signing evidence forward UNCHANGED', resolution.sellerSigningEvidence, SELLER_SIGNING_EVIDENCE);
}

{
  // A blocked attempt -- canonicalReadinessOk false, sentinel still applies -- is
  // recorded truthfully, never silently upgraded to a passing snapshot.
  const blockedEvidence = {
    ...SELLER_SIGNING_EVIDENCE,
    canonicalReadinessOk: false,
    sellerCountFieldProvisioned: false,
    sellerCountWriteReadbackOk: null,
    blockingReasons: ['The Contract Seller Count GHL field is not yet provisioned -- refusing to sync until it is created and wired.'],
  };
  const attempt = buildContractDraftRequestAttemptRecord({ ...ATTEMPT_ARGS, sellerSigningEvidence: blockedEvidence });
  check('a blocked seller-readiness snapshot is recorded exactly as supplied, never upgraded', attempt.sellerSigningEvidence, blockedEvidence);
  checkTrue('the blocked snapshot never silently claims canonicalReadinessOk:true when it is false', attempt.sellerSigningEvidence.canonicalReadinessOk === false);
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
/* Transport-outcome classification -- Jess Gate correction (this session) */
/* ==================================================================== */
/* Proves all six paths the corrected ruling enumerates, each in isolation,
   plus that PUT and readback evidence are preserved SEPARATELY rather than
   collapsed into one opaque message. */

{
  // 1. Refused before any network call -- "failed", no draft could have been triggered.
  const c = classifyContractDraftRequestOutcome({ kind: 'refused', reason: 'not yet provisioned' });
  check('refused classifies "failed"', c.status, 'failed');
  check('refused carries no PUT/readback facts', [c.sentValue, c.observedValue, c.providerStatus], [null, null, null]);
  checkTrue('refused failureReason names the refusal, not a network claim', /not yet provisioned/.test(c.failureReason) && !/GHL/.test(c.failureReason));
}

{
  // 2. A CONFIRMED non-success HTTP response -- "failed", HTTP status + response body preserved.
  const c = classifyContractDraftRequestOutcome({ kind: 'put_failed', putStatus: 422, responseBody: 'Unprocessable' });
  check('a confirmed non-success PUT response classifies "failed"', c.status, 'failed');
  check('put_failed preserves the exact HTTP status', c.providerStatus, 422);
  checkTrue('put_failed failureReason quotes the HTTP status and response body', /422/.test(c.failureReason) && /Unprocessable/.test(c.failureReason));
  check('put_failed carries no sent/observed value (the write did not land)', [c.sentValue, c.observedValue], [null, null]);
}

{
  // 3. PUT transport exception, no conclusive response -- "indeterminate", never "failed".
  const c = classifyContractDraftRequestOutcome({ kind: 'put_transport_error', message: 'ECONNRESET' });
  check('a PUT transport exception classifies "indeterminate", never "failed"', c.status, 'indeterminate');
  check('put_transport_error has no providerStatus (no response ever arrived)', c.providerStatus, null);
  check('put_transport_error still records the INTENDED sent value', c.sentValue, 'Requested');
  checkTrue('put_transport_error failureReason states GHL may have received it', /may have received/.test(c.failureReason));
}

{
  // 4. PUT succeeds, but readback transport/HTTP fails -- "indeterminate"; PUT and readback evidence preserved separately.
  const c = classifyContractDraftRequestOutcome({ kind: 'readback_failed', putStatus: 200, readbackFailureReason: 'readback HTTP 503: Service Unavailable' });
  check('a PUT success + readback failure classifies "indeterminate"', c.status, 'indeterminate');
  check('readback_failed preserves the SUCCESSFUL put status', c.providerStatus, 200);
  checkTrue('readback_failed failureReason cites the successful PUT status AND the readback failure separately', /HTTP 200/.test(c.failureReason) && /503/.test(c.failureReason));
  check('readback_failed still records the intended sent value (the PUT itself succeeded)', c.sentValue, 'Requested');
  check('readback_failed has no observedValue (no readback was ever confirmed)', c.observedValue, null);
}

{
  // 5. PUT succeeds, readback succeeds, but observed !== sent -- "indeterminate".
  const c = classifyContractDraftRequestOutcome({ kind: 'readback_mismatch', putStatus: 200, sent: 'Requested', observed: 'Idle' });
  check('a readback mismatch classifies "indeterminate", never "accepted"', c.status, 'indeterminate');
  check('readback_mismatch preserves both sent and observed values', [c.sentValue, c.observedValue], ['Requested', 'Idle']);
  check('readback_mismatch preserves the PUT status', c.providerStatus, 200);
  checkTrue('readback_mismatch failureReason quotes the sent value and the observed value', /Requested/.test(c.failureReason) && /Idle/.test(c.failureReason));
}
{
  // Observed null (field structurally absent on readback) is still a mismatch, never coerced to a value.
  const c = classifyContractDraftRequestOutcome({ kind: 'readback_mismatch', putStatus: 200, sent: 'Requested', observed: null });
  check('a null observed value on mismatch is preserved as null, not coerced', c.observedValue, null);
}

{
  // 6. PUT succeeds, exact readback confirms -- "accepted".
  const c = classifyContractDraftRequestOutcome({ kind: 'confirmed', putStatus: 200, sent: 'Requested', observed: 'Requested' });
  check('an exact confirmed readback classifies "accepted"', c.status, 'accepted');
  check('confirmed preserves sent, observed, and putStatus', [c.sentValue, c.observedValue, c.providerStatus], ['Requested', 'Requested', 200]);
  check('confirmed carries no failureReason', c.failureReason, null);
}

{
  // Only refused/put_failed are ever "failed" -- every other failure-shaped variant is "indeterminate".
  const indeterminateKinds = [
    { kind: 'put_transport_error', message: 'x' },
    { kind: 'readback_failed', putStatus: 200, readbackFailureReason: 'x' },
    { kind: 'readback_mismatch', putStatus: 200, sent: 'Requested', observed: 'Idle' },
  ];
  checkTrue(
    'put_transport_error, readback_failed, and readback_mismatch are ALL "indeterminate", never "failed"',
    indeterminateKinds.every((o) => classifyContractDraftRequestOutcome(o).status === 'indeterminate'),
  );
  const failedKinds = [{ kind: 'refused', reason: 'x' }, { kind: 'put_failed', putStatus: 500, responseBody: 'x' }];
  checkTrue(
    'refused and put_failed are the ONLY two variants classified "failed"',
    failedKinds.every((o) => classifyContractDraftRequestOutcome(o).status === 'failed'),
  );
}

/* ==================================================================== */
/* STATIC -- ghl.ts's setContractDraftRequest never throws               */
/* ==================================================================== */

{
  const ghlSrc = fs.readFileSync(path.join(APP, 'src', 'lib', 'ghl.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = ghlSrc.match(/setContractDraftRequest: async \([\s\S]*?\n    \},\r?\n  \},/);
  checkTrue('setContractDraftRequest was located in ghl.ts', !!m);
  const body = m ? m[0] : '';

  checkTrue('setContractDraftRequest contains no throw statement -- every failure mode returns a discriminated outcome', !/throw /.test(body));
  checkTrue('the PUT fetch is wrapped in its own try/catch (put_transport_error)', /try \{[\s\S]*?putRes = await fetch\([\s\S]*?\} catch \(e: any\) \{[\s\S]*?put_transport_error/.test(body));
  checkTrue('a non-ok PUT response returns put_failed (a CONFIRMED rejection), distinct from the transport-exception path', /if \(!putRes\.ok\)[\s\S]*?put_failed/.test(body));
  checkTrue('the readback fetch is wrapped in its own try/catch (readback_failed)', /try \{[\s\S]*?readRes = await fetch\([\s\S]*?\} catch \(e: any\) \{[\s\S]*?readback_failed/.test(body));
  checkTrue('a non-ok readback response also returns readback_failed', /if \(!readRes\.ok\)[\s\S]*?readback_failed/.test(body));
  checkTrue('a malformed readback JSON body also returns readback_failed', /readBody = await readRes\.json\(\)[\s\S]*?\} catch \(e: any\) \{[\s\S]*?readback_failed/.test(body));
  checkTrue('an exact-match readback returns confirmed; anything else returns readback_mismatch', /if \(observed !== value\)[\s\S]*?readback_mismatch[\s\S]*?return \{ kind: "confirmed"/.test(body));
  check('setContractDraftRequest is declared exactly once in ghl.ts', (ghlSrc.match(/setContractDraftRequest: async \(/g) || []).length, 1);
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

  /* -------------------------------------------------------------------- */
  /* INV-67 Phase 1 Jess re-gate correction -- the seller-readiness gate   */
  /* must short-circuit BEFORE the Opportunity-field write AND before      */
  /* setContractDraftRequest, with zero separate control flow of its own   */
  /* -------------------------------------------------------------------- */

  const preWriteIdx = body.indexOf('evaluateSellerSigningPreWriteReadiness(');
  const buildPlanIdx = body.indexOf('buildContractProjectionPlan(');
  const planNotOkIdx = body.indexOf('if (!plan.ok) {');
  const syncWriteIdx = body.indexOf('ghl.opportunities.syncContractProjectionFields(');
  const evidenceIdx = body.indexOf('buildSellerSigningAuditEvidence(');
  const attemptRecordIdx = body.indexOf('buildContractDraftRequestAttemptRecord(');

  checkTrue('evaluateSellerSigningPreWriteReadiness is called in the handler', preWriteIdx !== -1);
  checkTrue('evaluateSellerSigningPreWriteReadiness is called BEFORE buildContractProjectionPlan', preWriteIdx !== -1 && buildPlanIdx !== -1 && preWriteIdx < buildPlanIdx);
  checkTrue(
    'buildContractProjectionPlan is called with the seller readiness result as its fourth argument',
    /buildContractProjectionPlan\(opportunityId, contractDocumentPreview, sellerContractFactsReport, sellerReadiness\)/.test(body),
  );
  checkTrue('the "if (!plan.ok)" short-circuit appears BEFORE the Opportunity-field write (syncContractProjectionFields)', planNotOkIdx !== -1 && syncWriteIdx !== -1 && planNotOkIdx < syncWriteIdx);
  checkTrue(
    'the "if (!plan.ok)" block itself contains a "return;" -- an actual short-circuit, not merely a state update',
    /if \(!plan\.ok\) \{\s*\n\s*setSyncResult\(\{ kind: "blocked", blockingReasons: plan\.blockingReasons \}\);\s*\n\s*return;\s*\n\s*\}/.test(body),
  );
  checkTrue('the Opportunity-field write happens BEFORE setContractDraftRequest is ever attempted', syncWriteIdx !== -1 && setDraftRequestIdx !== -1 && syncWriteIdx < setDraftRequestIdx);
  checkTrue(
    'a sentinel/unresolved seller readiness therefore short-circuits BEFORE BOTH the Opportunity-field write and setContractDraftRequest -- the SAME single "if (!plan.ok) return" already proven above covers both, structurally, with no second gate to drift out of sync',
    planNotOkIdx !== -1 && planNotOkIdx < syncWriteIdx && syncWriteIdx < setDraftRequestIdx,
  );
  checkTrue('the Seller Count write is folded into the SAME syncContractProjectionFields call, never a second write call', (body.match(/ghl\.opportunities\.syncContractProjectionFields\(/g) || []).length === 1);
  checkTrue('buildSellerSigningAuditEvidence is computed AFTER the write (it needs the write result) and BEFORE the attempt record is built', evidenceIdx !== -1 && syncWriteIdx < evidenceIdx && evidenceIdx < attemptRecordIdx);
  checkTrue('the attempt record is built WITH the seller signing evidence', /buildContractDraftRequestAttemptRecord\(\{[\s\S]*?sellerSigningEvidence,/.test(body));
  checkTrue('the Seller Count field id and sentinel are read from the SAME shared config every other sentinel check in this codebase uses, never a hardcoded/faked id', /getRuntimeConfig\(\)\.contractSellerCountField/.test(body) && /CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED/.test(body));
  checkTrue('the pre-write gate never fakes/bypasses the field-provisioned check with a hardcoded non-sentinel id', !/sellerCountFieldId:\s*["'](?!getRuntimeConfig)/.test(body));

  // Canonical Note remains authoritative -- the Seller Count TRANSPORT
  // write's own observed value is never read back into the canonical
  // SellerSigningModel carrier anywhere in this handler.
  checkTrue(
    'writeResult.sellerCount (the transport write/readback outcome) is never assigned into sellerSigningDisposition or fed into formatSellerSigningModelNote',
    !/writeResult\.sellerCount[\s\S]{0,80}(sellerSigningDisposition|formatSellerSigningModelNote)/.test(body) &&
      !/(sellerSigningDisposition|formatSellerSigningModelNote)[\s\S]{0,80}writeResult\.sellerCount/.test(body),
  );
  checkTrue('formatSellerSigningModelNote is never called from handleSyncContractProjectionFields (only handleSaveSellerSigning writes the canonical Note)', !/formatSellerSigningModelNote\(/.test(body));
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
