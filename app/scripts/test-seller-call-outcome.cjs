/**
 * Seller Call resume + bounded call outcomes -- test runner. B8-10 / INV-53.
 *
 * Compiles the pure outcome module (no dependencies beyond itself) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no React, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-outcome-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [path.join(LIB, 'seller-call-outcome.ts')];

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

const outcomePath = path.join(TMP, 'seller-call-outcome.js');
if (!fs.existsSync(outcomePath)) {
  console.error('ABORT: expected compiled output at ' + outcomePath);
  cleanup();
  process.exit(11);
}

const {
  formatOutcomeNote, parseOutcomeNote, latestOutcomeNoteForOpportunity, attemptRecordOutcome,
} = require(outcomePath);

/**
 * Compiled output, comments stripped -- for checks that must not
 * false-positive on this module's OWN doc comments discussing
 * DispositionControl/iaos_call_disposition/callbackWrite.ts by name to
 * EXPLAIN why they are not reused directly (same class of mistake as
 * arv-approval-note.ts's ghl.notes.list discussion earlier this board).
 */
const compiledNoComments = execSync(
  'npx tsc "' + path.join(LIB, 'seller-call-outcome.ts') + '" --outDir "' + TMP + '-nocomments" --module commonjs --target es2020 --removeComments',
  { cwd: APP }
) && fs.readFileSync(path.join(TMP + '-nocomments', 'seller-call-outcome.js'), 'utf8');
fs.rmSync(TMP + '-nocomments', { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 54;
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
    readinessStatus: 'REVIEW_NEEDED',
  }, over || {});
}

// ============================================================
// formatOutcomeNote / parseOutcomeNote round-trip -- every field survives
// exactly, for all three outcome kinds.
// ============================================================
{
  const acceptNote = formatOutcomeNote({
    opportunityId: 'opp-1', kind: 'accept', at: '2026-09-06T15:00:00.000Z',
    operator: null, snapshot: fullSnapshot(), reason: null, followUpAt: null,
  });
  const acceptParsed = parseOutcomeNote(acceptNote);
  check('accept note round-trips: parses', acceptParsed !== null, true);
  check('accept note round-trips: opportunityId', acceptParsed.opportunityId, 'opp-1');
  check('accept note round-trips: kind', acceptParsed.kind, 'accept');
  check('accept note round-trips: at', acceptParsed.at, '2026-09-06T15:00:00.000Z');
  check('accept note round-trips: operator null', acceptParsed.operator, null);
  check('accept note round-trips: full snapshot', acceptParsed.snapshot, fullSnapshot());
  check('accept note round-trips: reason null (not applicable to accept)', acceptParsed.reason, null);
  check('accept note round-trips: followUpAt null (not applicable to accept)', acceptParsed.followUpAt, null);

  const followUpNote = formatOutcomeNote({
    opportunityId: 'opp-1', kind: 'follow_up', at: '2026-09-06T15:05:00.000Z',
    operator: 'jess@example.com', snapshot: fullSnapshot({ currentOffer: 180000 }),
    reason: null, followUpAt: '2026-09-13T15:00:00.000Z',
  });
  const followUpParsed = parseOutcomeNote(followUpNote);
  check('follow_up note round-trips: parses', followUpParsed !== null, true);
  check('follow_up note round-trips: kind', followUpParsed.kind, 'follow_up');
  check('follow_up note round-trips: operator (real identity carried verbatim)', followUpParsed.operator, 'jess@example.com');
  check('follow_up note round-trips: followUpAt', followUpParsed.followUpAt, '2026-09-13T15:00:00.000Z');
  check('follow_up note round-trips: reason null', followUpParsed.reason, null);
  check('follow_up note round-trips: snapshot reflects the DIFFERENT current offer', followUpParsed.snapshot.currentOffer, 180000);

  const passNote = formatOutcomeNote({
    opportunityId: 'opp-1', kind: 'pass', at: '2026-09-06T15:10:00.000Z',
    operator: null, snapshot: fullSnapshot(), reason: 'Seller wants $40k more than Max supports; not moving.', followUpAt: null,
  });
  const passParsed = parseOutcomeNote(passNote);
  check('pass note round-trips: parses', passParsed !== null, true);
  check('pass note round-trips: kind', passParsed.kind, 'pass');
  check('pass note round-trips: reason', passParsed.reason, 'Seller wants $40k more than Max supports; not moving.');
  check('pass note round-trips: followUpAt null', passParsed.followUpAt, null);
}

// ============================================================
// Snapshot fields that were UNAVAILABLE at the moment of the outcome
// (e.g. Target uncalculated) round-trip as null, never as a fabricated
// zero or a parse failure.
// ============================================================
{
  const partialSnapshot = fullSnapshot({ targetAcquisitionPrice: null, maxSupportedOffer: null, expectedSpread: null, sellerPosition: null });
  const note = formatOutcomeNote({
    opportunityId: 'opp-1', kind: 'accept', at: '2026-09-06T15:00:00.000Z',
    operator: null, snapshot: partialSnapshot, reason: null, followUpAt: null,
  });
  const parsed = parseOutcomeNote(note);
  check('a null Target at the moment of the outcome round-trips as null, not zero', parsed.snapshot.targetAcquisitionPrice, null);
  check('a null Max at the moment of the outcome round-trips as null', parsed.snapshot.maxSupportedOffer, null);
  check('a null Expected Spread at the moment of the outcome round-trips as null', parsed.snapshot.expectedSpread, null);
  check('a null Seller Position at the moment of the outcome round-trips as null', parsed.snapshot.sellerPosition, null);
  check('the STILL-PRESENT fields in the same partial snapshot round-trip correctly', parsed.snapshot.currentOffer, 190000);
}

// ============================================================
// Fails closed: malformed / wrong-version / non-ledger / tampered notes
// never parse, mirroring arv-approval-note.ts's own discipline.
// ============================================================
{
  check('a plain call note is not mistaken for an outcome ledger note', parseOutcomeNote('Called seller, left voicemail.'), null);
  check('an empty body is not mistaken for an outcome ledger note', parseOutcomeNote(''), null);
  check('parseOutcomeNote never throws on a non-string body', (() => { try { parseOutcomeNote(null); return true; } catch { return false; } })(), true);

  const base = formatOutcomeNote({
    opportunityId: 'opp-1', kind: 'accept', at: '2026-09-06T15:00:00.000Z',
    operator: null, snapshot: fullSnapshot(), reason: null, followUpAt: null,
  });

  const wrongVersion = base.replace('iaos-seller-call-outcome-v1', 'iaos-seller-call-outcome-v2-future');
  check('a note claiming a DIFFERENT ledger version is refused, not guessed', parseOutcomeNote(wrongVersion), null);

  const truncated = base.split('\n').slice(0, 3).join('\n');
  check('a truncated note (missing required fields) is refused', parseOutcomeNote(truncated), null);

  const badKind = base.replace('Outcome: accept', 'Outcome: maybe');
  check('an Outcome value outside the three locked kinds is refused', parseOutcomeNote(badKind), null);

  const badReadiness = base.replace('Offer Readiness: REVIEW_NEEDED', 'Offer Readiness: PRETTY_GOOD');
  check('an Offer Readiness value outside the three locked statuses is refused', parseOutcomeNote(badReadiness), null);

  const badTimestamp = base.replace('Outcome timestamp: 2026-09-06T15:00:00.000Z', 'Outcome timestamp: not-a-real-date');
  check('a malformed Outcome timestamp fails the whole note closed', parseOutcomeNote(badTimestamp), null);

  const badNumber = base.replace('Current Offer: 190000', 'Current Offer: not-a-number');
  check('a malformed numeric snapshot field fails the whole note closed', parseOutcomeNote(badNumber), null);
}

// ============================================================
// latestOutcomeNoteForOpportunity: picks the CURRENT standing outcome by
// the note's OWN embedded timestamp, matches only the given opportunity,
// and silently skips unrelated/non-ledger notes.
// ============================================================
{
  const older = formatOutcomeNote({ opportunityId: 'opp-1', kind: 'follow_up', at: '2026-09-01T10:00:00.000Z', operator: null, snapshot: fullSnapshot(), reason: null, followUpAt: '2026-09-08T10:00:00.000Z' });
  const newer = formatOutcomeNote({ opportunityId: 'opp-1', kind: 'accept', at: '2026-09-06T15:00:00.000Z', operator: null, snapshot: fullSnapshot(), reason: null, followUpAt: null });
  const otherOpportunity = formatOutcomeNote({ opportunityId: 'a-different-opportunity', kind: 'pass', at: '2026-09-07T00:00:00.000Z', operator: null, snapshot: fullSnapshot(), reason: 'not a fit', followUpAt: null });
  const unrelatedCallNote = { body: 'Called seller, left voicemail.' };

  const notes = [{ body: newer }, unrelatedCallNote, { body: older }, { body: otherOpportunity }];
  const latest = latestOutcomeNoteForOpportunity(notes, 'opp-1');
  check('latest outcome picked is the CHRONOLOGICALLY latest, not the first in the list', latest.kind, 'accept');
  check('latest outcome ignores a different opportunity\'s ledger note', latest.opportunityId, 'opp-1');

  const noneForThisOpportunity = latestOutcomeNoteForOpportunity([{ body: otherOpportunity }, unrelatedCallNote], 'opp-1');
  check('no matching outcome note for this opportunity -> null, never a guess', noneForThisOpportunity, null);

  const emptyList = latestOutcomeNoteForOpportunity([], 'opp-1');
  check('empty note list -> null', emptyList, null);
}

// ============================================================
// attemptRecordOutcome: fails closed on every precondition per outcome
// kind -- accept needs a Current Offer AND Offer Readiness at
// OFFER_READY, follow_up needs a valid date/time, pass needs a
// non-empty reason.
// ============================================================
{
  const acceptNoOffer = attemptRecordOutcome({
    kind: 'accept', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot({ currentOffer: null, readinessStatus: 'OFFER_READY' }), reason: '', followUpAt: '',
  });
  check('accept fails closed with no Current Offer entered', acceptNoOffer.ok, false);
  check('the accept-no-offer rejection names Current Offer specifically', acceptNoOffer.error.toLowerCase().indexOf('current offer') >= 0, true);

  // Jess Gate correction, 2026-09-06: Accept must never let NOT_READY or
  // REVIEW_NEEDED economics become "Agreement Reached" on a Current Offer
  // alone -- `readinessStatus` here stands in for the caller's own
  // resolved `ReadinessResult.effectiveStatus` (see
  // SellerCallWorkspace.tsx's `buildOutcomeSnapshot`); this module trusts
  // it verbatim rather than recomputing readiness itself.
  const acceptNotReady = attemptRecordOutcome({
    kind: 'accept', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot({ readinessStatus: 'NOT_READY' }), reason: '', followUpAt: '',
  });
  check('accept fails closed when Offer Readiness is NOT_READY, even with a Current Offer entered', acceptNotReady.ok, false);
  check('the not-ready rejection names Offer Ready specifically', acceptNotReady.error.toLowerCase().indexOf('offer ready') >= 0, true);

  const acceptReviewNeeded = attemptRecordOutcome({
    kind: 'accept', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot({ readinessStatus: 'REVIEW_NEEDED' }), reason: '', followUpAt: '',
  });
  check('accept fails closed when Offer Readiness is REVIEW_NEEDED, even with a Current Offer entered', acceptReviewNeeded.ok, false);

  // OFFER_READY is what unlocks acceptance -- whether that status was
  // reached organically (evidence SUPPORTED) or via a legitimate human
  // OVERRIDDEN readiness result makes no difference here: both resolve to
  // the SAME `effectiveStatus` the caller passes in as `readinessStatus`,
  // and offer-readiness.ts's own suite (test-offer-readiness.cjs) is what
  // proves OVERRIDDEN legitimately reaches OFFER_READY in the first place.
  const acceptWithOffer = attemptRecordOutcome({
    kind: 'accept', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot({ readinessStatus: 'OFFER_READY' }), reason: '', followUpAt: '',
  });
  check('accept succeeds with a Current Offer entered and Offer Readiness at OFFER_READY (organic or override-derived)', acceptWithOffer.ok, true);

  const followUpNoDate = attemptRecordOutcome({
    kind: 'follow_up', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot(), reason: '', followUpAt: '',
  });
  check('follow_up fails closed with no date/time entered', followUpNoDate.ok, false);

  const followUpBadDate = attemptRecordOutcome({
    kind: 'follow_up', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot(), reason: '', followUpAt: 'not-a-real-date',
  });
  check('follow_up fails closed with an unparseable date/time', followUpBadDate.ok, false);

  const followUpValid = attemptRecordOutcome({
    kind: 'follow_up', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot(), reason: '', followUpAt: '2026-09-13T15:00:00.000Z',
  });
  check('follow_up succeeds with a valid date/time', followUpValid.ok, true);

  const passNoReason = attemptRecordOutcome({
    kind: 'pass', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot(), reason: '', followUpAt: '',
  });
  check('pass fails closed with no reason entered', passNoReason.ok, false);

  const passWhitespaceReason = attemptRecordOutcome({
    kind: 'pass', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot(), reason: '   ', followUpAt: '',
  });
  check('pass fails closed with a whitespace-only reason', passWhitespaceReason.ok, false);

  const passValid = attemptRecordOutcome({
    kind: 'pass', opportunityId: 'opp-1', operator: null, at: '2026-09-06T15:00:00.000Z',
    snapshot: fullSnapshot(), reason: 'Not moving off asking price.', followUpAt: '',
  });
  check('pass succeeds with a real reason', passValid.ok, true);

  // The successful note is immediately readable back through this
  // module's own parser -- proof attemptRecordOutcome and
  // parseOutcomeNote never drift apart.
  const reparsed = parseOutcomeNote(passValid.note);
  check('a successfully attempted outcome parses back through this module\'s own reader', reparsed !== null && reparsed.kind, 'pass');
  check('the reparsed reason matches what was attempted', reparsed.reason, 'Not moving off asking price.');
}

// ============================================================
// Structural proof: no Board 4 disposition field, no second economics/
// readiness engine, no direct GHL/network call anywhere in this module.
// ============================================================
{
  check('compiled output never references iaos_call_disposition, iaos_call_routing, or iaos_disposition_at (Board 4\'s cold-outreach fields)', /iaos_call_disposition|iaos_call_routing|iaos_disposition_at/.test(compiledNoComments), false);
  check('compiled output never calls setCallDisposition or setCallRouting', /setCallDisposition|setCallRouting/.test(compiledNoComments), false);
  check('compiled output makes no GHL/network call of any kind', /fetch\(|ghl\.|PROXY|XMLHttpRequest/.test(compiledNoComments), false);
  check('compiled output never recomputes Target/Max/Spread (no 25%/$5,000 formula, no endBuyerMaxPrice arithmetic)', /0\.25|Math\.max|endBuyerMaxPrice/.test(compiledNoComments), false);
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
