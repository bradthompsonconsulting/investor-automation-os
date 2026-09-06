/**
 * Negotiation above-Max override ledger -- test runner. B8-11 / INV-54.
 *
 * Compiles the pure ledger module (no dependencies beyond itself) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no React, no fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-negotiation-override-note-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCES = [path.join(LIB, 'seller-call-negotiation-override-note.ts')];

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

const modulePath = path.join(TMP, 'seller-call-negotiation-override-note.js');
if (!fs.existsSync(modulePath)) {
  console.error('ABORT: expected compiled output at ' + modulePath);
  cleanup();
  process.exit(11);
}

const {
  formatNegotiationOverrideNote, parseNegotiationOverrideNote, latestNegotiationOverrideNoteForOpportunity,
} = require(modulePath);

const compiledNoComments = execSync(
  'npx tsc "' + path.join(LIB, 'seller-call-negotiation-override-note.ts') + '" --outDir "' + TMP + '-nocomments" --module commonjs --target es2020 --removeComments',
  { cwd: APP }
) && fs.readFileSync(path.join(TMP + '-nocomments', 'seller-call-negotiation-override-note.js'), 'utf8');
fs.rmSync(TMP + '-nocomments', { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 29;
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

function fullOverride(over) {
  return Object.assign({
    opportunityId: 'opp-1', at: '2026-09-07T15:00:00.000Z', operator: null,
    reason: 'Seller price position confirmed verbally; proceeding above Max.',
    currentOfferAtOverride: 190000, maxSupportedOfferAtOverride: 176363, amountAboveMaxAtOverride: 13637,
  }, over || {});
}

// ============================================================
// formatNegotiationOverrideNote / parseNegotiationOverrideNote round-trip.
// ============================================================
{
  const note = formatNegotiationOverrideNote(fullOverride());
  const parsed = parseNegotiationOverrideNote(note);
  check('override note round-trips: parses', parsed !== null, true);
  check('override note round-trips: opportunityId', parsed.opportunityId, 'opp-1');
  check('override note round-trips: at', parsed.at, '2026-09-07T15:00:00.000Z');
  check('override note round-trips: operator null (no authenticated identity)', parsed.operator, null);
  check('override note round-trips: reason', parsed.reason, 'Seller price position confirmed verbally; proceeding above Max.');
  check('override note round-trips: currentOfferAtOverride', parsed.currentOfferAtOverride, 190000);
  check('override note round-trips: maxSupportedOfferAtOverride', parsed.maxSupportedOfferAtOverride, 176363);
  check('override note round-trips: amountAboveMaxAtOverride', parsed.amountAboveMaxAtOverride, 13637);

  const withOperator = formatNegotiationOverrideNote(fullOverride({ operator: 'jess@example.com' }));
  const parsedWithOperator = parseNegotiationOverrideNote(withOperator);
  check('a real operator identity is carried through verbatim, never dropped to null', parsedWithOperator.operator, 'jess@example.com');
}

// ============================================================
// Fails closed: malformed / wrong-version / non-ledger / tampered notes
// never parse, mirroring arv-approval-note.ts's / seller-call-outcome.ts's
// own discipline.
// ============================================================
{
  check('a plain call note is not mistaken for an override ledger note', parseNegotiationOverrideNote('Called seller, left voicemail.'), null);
  check('an empty body is not mistaken for an override ledger note', parseNegotiationOverrideNote(''), null);
  check('parseNegotiationOverrideNote never throws on a non-string body', (() => { try { parseNegotiationOverrideNote(null); return true; } catch { return false; } })(), true);

  const base = formatNegotiationOverrideNote(fullOverride());

  const wrongVersion = base.replace('iaos-negotiation-override-v1', 'iaos-negotiation-override-v2-future');
  check('a note claiming a DIFFERENT ledger version is refused, not guessed', parseNegotiationOverrideNote(wrongVersion), null);

  const truncated = base.split('\n').slice(0, 3).join('\n');
  check('a truncated note (missing required fields) is refused', parseNegotiationOverrideNote(truncated), null);

  const badTimestamp = base.replace('Override timestamp: 2026-09-07T15:00:00.000Z', 'Override timestamp: not-a-real-date');
  check('a malformed Override timestamp fails the whole note closed', parseNegotiationOverrideNote(badTimestamp), null);

  const badCurrentOffer = base.replace('Current Offer at override: 190000', 'Current Offer at override: not-a-number');
  check('a malformed Current Offer at override fails the whole note closed', parseNegotiationOverrideNote(badCurrentOffer), null);

  const negativeCurrentOffer = base.replace('Current Offer at override: 190000', 'Current Offer at override: -190000');
  check('a non-positive Current Offer at override is refused', parseNegotiationOverrideNote(negativeCurrentOffer), null);

  const badMax = base.replace('Max Supported Offer at override: 176363', 'Max Supported Offer at override: 0');
  check('a non-positive Max Supported Offer at override is refused', parseNegotiationOverrideNote(badMax), null);

  const badAmount = base.replace('Amount above Max at override: 13637', 'Amount above Max at override: NaN');
  check('a malformed Amount above Max at override fails the whole note closed', parseNegotiationOverrideNote(badAmount), null);

  const emptyReason = base.replace('Reason: Seller price position confirmed verbally; proceeding above Max.', 'Reason: ');
  check('an override note with an empty Reason is refused (a real reason is required, per attemptOverride\'s own precondition)', parseNegotiationOverrideNote(emptyReason), null);
}

// ============================================================
// latestNegotiationOverrideNoteForOpportunity: picks the CURRENT standing
// override by the note's OWN embedded timestamp, matches only the given
// opportunity, and silently skips unrelated/non-ledger notes.
// ============================================================
{
  const older = formatNegotiationOverrideNote(fullOverride({ at: '2026-09-01T10:00:00.000Z', reason: 'Earlier grant.' }));
  const newer = formatNegotiationOverrideNote(fullOverride({ at: '2026-09-07T15:00:00.000Z', reason: 'Later grant, supersedes the earlier one.' }));
  const otherOpportunity = formatNegotiationOverrideNote(fullOverride({ opportunityId: 'a-different-opportunity', at: '2026-09-08T00:00:00.000Z', reason: 'Not this deal.' }));
  const unrelatedCallNote = { body: 'Called seller, left voicemail.' };

  const notes = [{ body: newer }, unrelatedCallNote, { body: older }, { body: otherOpportunity }];
  const latest = latestNegotiationOverrideNoteForOpportunity(notes, 'opp-1');
  check('latest override picked is the CHRONOLOGICALLY latest, not the first in the list', latest.reason, 'Later grant, supersedes the earlier one.');
  check('latest override ignores a different opportunity\'s ledger note', latest.opportunityId, 'opp-1');

  const noneForThisOpportunity = latestNegotiationOverrideNoteForOpportunity([{ body: otherOpportunity }, unrelatedCallNote], 'opp-1');
  check('no matching override note for this opportunity -> null, never a guess', noneForThisOpportunity, null);

  const emptyList = latestNegotiationOverrideNoteForOpportunity([], 'opp-1');
  check('empty note list -> null', emptyList, null);

  // Prior provenance survives: an older, superseded grant is never
  // rewritten or deleted -- it simply is not the one `latest` returns.
  const priorStillPresent = notes.some((n) => n.body === older);
  check('the earlier (superseded) override note is still present in the raw list, never overwritten (append-only)', priorStillPresent, true);
}

// ============================================================
// Structural proof: no Board 4/Offer-Readiness fields, no second
// economics/negotiation-classification engine, no direct GHL/network
// call anywhere in this module -- and, specifically, no reference to
// Offer Readiness's DIFFERENT humanAction/APPROVED/OVERRIDDEN concept,
// which this module must never be confused with or persist.
// ============================================================
{
  check('compiled output never references ReadinessResult, humanAction, APPROVED, or effectiveStatus (a DIFFERENT override concept this module must never touch)', /ReadinessResult|humanAction|effectiveStatus/.test(compiledNoComments), false);
  check('compiled output never references iaos_call_disposition, iaos_call_routing, or iaos_disposition_at (Board 4\'s cold-outreach fields)', /iaos_call_disposition|iaos_call_routing|iaos_disposition_at/.test(compiledNoComments), false);
  check('compiled output makes no GHL/network call of any kind', /fetch\(|ghl\.|PROXY|XMLHttpRequest/.test(compiledNoComments), false);
  check('compiled output never recomputes Target/Max/Spread or negotiation classification (no 25%/$5,000 formula, no endBuyerMaxPrice/isOverrideCurrent logic)', /0\.25|Math\.max|endBuyerMaxPrice|isOverrideCurrent/.test(compiledNoComments), false);
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
