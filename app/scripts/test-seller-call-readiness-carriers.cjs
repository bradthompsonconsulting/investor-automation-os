/**
 * Offer Readiness durable carriers -- test runner. B8-13 / INV-68.
 *
 * Compiles the pure carriers module (no dependencies beyond itself) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases against all four carriers: Property identity,
 * Transaction assumptions, Seller price position, and the Offer Ready
 * human approval/override action. No GHL, no network, no React, no
 * fixture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-readiness-carriers-test');
const LIB = path.join(APP, 'src', 'lib');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const SOURCE = path.join(LIB, 'seller-call-readiness-carriers.ts');

try {
  execSync(
    'npx tsc "' + SOURCE + '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict --removeComments',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const modulePath = path.join(TMP, 'seller-call-readiness-carriers.js');
if (!fs.existsSync(modulePath)) {
  console.error('ABORT: expected compiled output at ' + modulePath);
  cleanup();
  process.exit(11);
}

const {
  formatPropertyIdentityConfirmationNote, parsePropertyIdentityConfirmationNote, currentPropertyIdentityConfirmationForOpportunity,
  formatTransactionAssumptionsNote, parseTransactionAssumptionsNote, latestTransactionAssumptionsForOpportunity,
  formatSellerPricePositionNote, parseSellerPricePositionNote, latestSellerPricePositionForOpportunity,
  formatReadinessHumanActionNote, parseReadinessHumanActionNote, latestReadinessHumanActionForOpportunity,
} = require(modulePath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 51;
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

// ============================================================
// 1. Property identity confirmation
// ============================================================
{
  const args = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, confirmedAddress: '123 Main St, Austin, TX 78701' };
  const note = formatPropertyIdentityConfirmationNote(args);
  const parsed = parsePropertyIdentityConfirmationNote(note);
  check('property identity: round-trips exactly', parsed, args);

  check('property identity: wrong header refused', parsePropertyIdentityConfirmationNote('GARBAGE\n' + note.split('\n').slice(1).join('\n')), null);
  check('property identity: extra line refused (positional, not find())', parsePropertyIdentityConfirmationNote(note + '\nExtra: line'), null);
  check('property identity: missing opportunity refused', parsePropertyIdentityConfirmationNote(formatPropertyIdentityConfirmationNote(Object.assign({}, args, { opportunityId: '' }))), null);
  check('property identity: missing address refused', parsePropertyIdentityConfirmationNote(formatPropertyIdentityConfirmationNote(Object.assign({}, args, { confirmedAddress: '' }))), null);
  check('property identity: non-canonical timestamp refused', parsePropertyIdentityConfirmationNote(note.replace(args.at, '2026-09-08T00:00:00Z')), null);
  check('property identity: garbage body refused', parsePropertyIdentityConfirmationNote('not a note at all'), null);

  const operatorNamed = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { operator: 'Brad' }));
  check('property identity: named operator round-trips', parsePropertyIdentityConfirmationNote(operatorNamed).operator, 'Brad');
  check('property identity: null operator serializes as UNAVAILABLE, not the literal null', note.includes('Operator: UNAVAILABLE'), true);

  // currentPropertyIdentityConfirmationForOpportunity: latest wins, scoped
  // to opportunity, and REFUSED when the address has since changed.
  const older = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-01T00:00:00.000Z' }));
  const newer = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-08T00:00:00.000Z' }));
  const otherOpp = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { opportunityId: 'opp-2', at: '2026-09-09T00:00:00.000Z' }));
  const notes = [{ body: older }, { body: newer }, { body: otherOpp }];
  check('property identity: latest-by-embedded-timestamp wins, not list order', currentPropertyIdentityConfirmationForOpportunity(notes, 'opp-1', args.confirmedAddress).at, '2026-09-08T00:00:00.000Z');
  check('property identity: scoped to opportunity (opp-2 entry never returned for opp-1)', currentPropertyIdentityConfirmationForOpportunity([{ body: otherOpp }], 'opp-1', args.confirmedAddress), null);
  check('property identity: STALE when the current address no longer matches -- treated as absent', currentPropertyIdentityConfirmationForOpportunity(notes, 'opp-1', '456 Other Ave'), null);
  check('property identity: no notes at all -> null', currentPropertyIdentityConfirmationForOpportunity([], 'opp-1', args.confirmedAddress), null);
}

// ============================================================
// 2. Transaction / deal-structure assumptions
// ============================================================
{
  const none = { kind: 'none' };
  const value = (v) => ({ kind: 'value', value: v });

  const args = {
    opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null,
    transactionStructure: value('Standard assignment'), closingPossession: value('Close in 21 days, vacant at close'), titleComplications: none,
  };
  const note = formatTransactionAssumptionsNote(args);
  const parsed = parseTransactionAssumptionsNote(note);
  check('transaction assumptions: round-trips exactly (mixed value + explicit none)', parsed, args);

  const allNone = formatTransactionAssumptionsNote(Object.assign({}, args, { transactionStructure: none, closingPossession: none, titleComplications: none }));
  check('transaction assumptions: all three explicitly none is valid (recorded, not blank)', parseTransactionAssumptionsNote(allNone).titleComplications, none);

  // A field left genuinely blank (never visited) is NOT the same as
  // explicitly marked none, and must be refused -- the ruling's own
  // distinction.
  const blankStructure = note.replace('Transaction structure: Standard assignment', 'Transaction structure: ');
  check('transaction assumptions: a genuinely blank field (not the none marker) is refused', parseTransactionAssumptionsNote(blankStructure), null);

  check('transaction assumptions: extra line refused', parseTransactionAssumptionsNote(note + '\nExtra: line'), null);
  check('transaction assumptions: missing opportunity refused', parseTransactionAssumptionsNote(formatTransactionAssumptionsNote(Object.assign({}, args, { opportunityId: '' }))), null);
  check('transaction assumptions: non-canonical timestamp refused', parseTransactionAssumptionsNote(note.replace(args.at, '2026-09-08')), null);
  check('transaction assumptions: garbage body refused', parseTransactionAssumptionsNote('not a note'), null);

  const older = formatTransactionAssumptionsNote(Object.assign({}, args, { at: '2026-09-01T00:00:00.000Z' }));
  const newer = formatTransactionAssumptionsNote(Object.assign({}, args, { at: '2026-09-08T00:00:00.000Z', titleComplications: value('Lien pending payoff') }));
  const otherOpp = formatTransactionAssumptionsNote(Object.assign({}, args, { opportunityId: 'opp-2' }));
  const notesTA = [{ body: older }, { body: newer }, { body: otherOpp }];
  check('transaction assumptions: latest-by-embedded-timestamp wins', latestTransactionAssumptionsForOpportunity(notesTA, 'opp-1').titleComplications, value('Lien pending payoff'));
  check('transaction assumptions: scoped to opportunity', latestTransactionAssumptionsForOpportunity([{ body: otherOpp }], 'opp-1'), null);
  check('transaction assumptions: no notes at all -> null', latestTransactionAssumptionsForOpportunity([], 'opp-1'), null);
}

// ============================================================
// 3. Seller price position
// ============================================================
{
  const priceArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, kind: 'price', price: 275000 };
  const priceNote = formatSellerPricePositionNote(priceArgs);
  check('seller price position: price round-trips exactly', parseSellerPricePositionNote(priceNote), priceArgs);

  const refusedArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:05:00.000Z', operator: null, kind: 'refused' };
  const refusedNote = formatSellerPricePositionNote(refusedArgs);
  check('seller price position: a documented refusal round-trips exactly (valid evidence, not UNKNOWN)', parseSellerPricePositionNote(refusedNote), refusedArgs);
  check('seller price position: refusal serializes with no stray price value', refusedNote.includes('Price: UNAVAILABLE'), true);

  check('seller price position: a refusal note carrying a stray number is refused (tampered)', parseSellerPricePositionNote(refusedNote.replace('Price: UNAVAILABLE', 'Price: 999')), null);
  check('seller price position: a zero price is refused (not a real price)', parseSellerPricePositionNote(formatSellerPricePositionNote(Object.assign({}, priceArgs, { price: 0 }))), null);
  check('seller price position: a negative price is refused', parseSellerPricePositionNote(formatSellerPricePositionNote(Object.assign({}, priceArgs, { price: -5 }))), null);
  check('seller price position: an unrecognized Kind is refused', parseSellerPricePositionNote(priceNote.replace('Kind: price', 'Kind: maybe')), null);
  check('seller price position: extra line refused', parseSellerPricePositionNote(priceNote + '\nExtra: line'), null);
  check('seller price position: garbage body refused', parseSellerPricePositionNote('not a note'), null);

  const notesSP = [{ body: priceNote }, { body: refusedNote }];
  check('seller price position: latest-by-embedded-timestamp wins (refusal is newer here)', latestSellerPricePositionForOpportunity(notesSP, 'opp-1'), refusedArgs);
  check('seller price position: scoped to opportunity', latestSellerPricePositionForOpportunity([{ body: formatSellerPricePositionNote(Object.assign({}, priceArgs, { opportunityId: 'opp-2' })) }], 'opp-1'), null);
  check('seller price position: no notes at all -> null', latestSellerPricePositionForOpportunity([], 'opp-1'), null);
}

// ============================================================
// 4. Offer Ready human approval/override action
// ============================================================
{
  const approvedArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, kind: 'approved', reason: 'Evidence looks complete' };
  const approvedNote = formatReadinessHumanActionNote(approvedArgs);
  check('human action: approved (with reason) round-trips exactly', parseReadinessHumanActionNote(approvedNote), approvedArgs);

  const approvedNoReasonArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:01:00.000Z', operator: null, kind: 'approved', reason: null };
  const approvedNoReasonNote = formatReadinessHumanActionNote(approvedNoReasonArgs);
  check('human action: approved with NO reason round-trips as null (reason is optional for approved)', parseReadinessHumanActionNote(approvedNoReasonNote), approvedNoReasonArgs);

  const overriddenArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:02:00.000Z', operator: null, kind: 'overridden', reason: 'Proceeding above evidence gap per operator judgment' };
  const overriddenNote = formatReadinessHumanActionNote(overriddenArgs);
  check('human action: overridden (with required reason) round-trips exactly', parseReadinessHumanActionNote(overriddenNote), overriddenArgs);

  check('human action: overridden with NO reason is refused (HumanAction requires one)', parseReadinessHumanActionNote(overriddenNote.replace('Reason: ' + overriddenArgs.reason, 'Reason: UNAVAILABLE')), null);
  check('human action: overridden with a blank reason is refused', parseReadinessHumanActionNote(overriddenNote.replace('Reason: ' + overriddenArgs.reason, 'Reason:  ')), null);
  check('human action: an unrecognized Kind is refused', parseReadinessHumanActionNote(approvedNote.replace('Kind: approved', 'Kind: maybe')), null);
  check('human action: extra line refused', parseReadinessHumanActionNote(approvedNote + '\nExtra: line'), null);
  check('human action: missing opportunity refused', parseReadinessHumanActionNote(formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { opportunityId: '' }))), null);
  check('human action: non-canonical timestamp refused', parseReadinessHumanActionNote(approvedNote.replace(approvedArgs.at, '2026-09-08T00:00:00.000-05:00')), null);
  check('human action: garbage body refused', parseReadinessHumanActionNote('not a note'), null);

  const notesHA = [{ body: approvedNote }, { body: overriddenNote }];
  check('human action: latest-by-embedded-timestamp wins (overridden is newer here)', latestReadinessHumanActionForOpportunity(notesHA, 'opp-1'), overriddenArgs);
  check('human action: scoped to opportunity', latestReadinessHumanActionForOpportunity([{ body: formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { opportunityId: 'opp-2' })) }], 'opp-1'), null);
  check('human action: no notes at all -> null', latestReadinessHumanActionForOpportunity([], 'opp-1'), null);
}

// ============================================================
// Structural: no GHL/network surface, no dependency on any other engine.
// ============================================================
{
  const src = fs.readFileSync(SOURCE, 'utf8');
  check('source contains no network/GHL surface', /fetch\(|leadconnectorhq|XMLHttpRequest/.test(src), false);
  check('source imports nothing (fully self-contained, per its own header)', /^import /m.test(src), false);
  // Checked against COMPILED output (comments stripped), not source text: the
  // module header legitimately mentions `ghl.notes.create()` in prose
  // (explaining that the CALLER performs it), which would false-positive
  // against the raw source the way test-next-best-question.cjs's own header
  // already documents for an identical case.
  const compiled = fs.readFileSync(modulePath, 'utf8');
  check('compiled output performs no write of any kind (format/parse only)', /ghl\.notes\.create/.test(compiled), false);
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
