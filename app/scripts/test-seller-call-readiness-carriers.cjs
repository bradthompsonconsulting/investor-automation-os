/**
 * Offer Readiness durable carriers -- test runner. B8-13 / INV-68,
 * extended by the Jess Gate correction, 2026-09-08.
 *
 * Compiles the pure carriers module (no dependencies beyond itself) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases against all five carriers: Property identity
 * (confirm/withdraw), Transaction assumptions, Seller price position, the
 * Offer Ready human approval/override decision (snapshot + durable
 * currency check), and the Contract Ready handoff checklist. No GHL, no
 * network, no React, no fixture.
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
  formatPropertyIdentityConfirmationNote, parsePropertyIdentityConfirmationNote,
  currentPropertyIdentityConfirmationForOpportunity, latestPropertyIdentityNoteForOpportunity,
  formatTransactionAssumptionsNote, parseTransactionAssumptionsNote, latestTransactionAssumptionsForOpportunity,
  formatSellerPricePositionNote, parseSellerPricePositionNote, latestSellerPricePositionForOpportunity,
  formatReadinessHumanActionNote, parseReadinessHumanActionNote, latestReadinessHumanActionForOpportunity,
  isReadinessDecisionCurrent,
  formatContractReadyChecklistNote, parseContractReadyChecklistNote, currentContractReadyChecklistForOpportunity,
  CONTRACT_READY_ITEM_KEYS,
} = require(modulePath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 87;
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
// 1. Property identity confirmation / withdrawal (v2)
// ============================================================
{
  const args = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, status: 'confirmed', address: '123 Main St, Austin, TX 78701' };
  const note = formatPropertyIdentityConfirmationNote(args);
  const parsed = parsePropertyIdentityConfirmationNote(note);
  check('property identity: round-trips exactly (v2, with Status)', parsed, args);

  check('property identity: wrong header refused (v1 notes no longer recognized)', parsePropertyIdentityConfirmationNote('IAOS PROPERTY IDENTITY CONFIRMATION — iaos-property-identity-confirmation-v1\nConfirmed at: 2026-09-08T00:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\nConfirmed address: 123 Main St'), null);
  check('property identity: extra line refused (positional, not find())', parsePropertyIdentityConfirmationNote(note + '\nExtra: line'), null);
  check('property identity: missing opportunity refused', parsePropertyIdentityConfirmationNote(formatPropertyIdentityConfirmationNote(Object.assign({}, args, { opportunityId: '' }))), null);
  check('property identity: missing address refused', parsePropertyIdentityConfirmationNote(formatPropertyIdentityConfirmationNote(Object.assign({}, args, { address: '' }))), null);
  check('property identity: non-canonical timestamp refused', parsePropertyIdentityConfirmationNote(note.replace(args.at, '2026-09-08T00:00:00Z')), null);
  check('property identity: garbage body refused', parsePropertyIdentityConfirmationNote('not a note at all'), null);
  check('property identity: an unrecognized Status is refused', parsePropertyIdentityConfirmationNote(note.replace('Status: confirmed', 'Status: maybe')), null);

  const operatorNamed = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { operator: 'Brad' }));
  check('property identity: named operator round-trips', parsePropertyIdentityConfirmationNote(operatorNamed).operator, 'Brad');
  check('property identity: null operator serializes as UNAVAILABLE, not the literal null', note.includes('Operator: UNAVAILABLE'), true);

  // currentPropertyIdentityConfirmationForOpportunity: latest wins, scoped
  // to opportunity, REFUSED when the address has since changed, AND
  // REFUSED when the latest entry is a withdrawal.
  const older = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-01T00:00:00.000Z' }));
  const newer = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-08T00:00:00.000Z' }));
  const otherOpp = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { opportunityId: 'opp-2', at: '2026-09-09T00:00:00.000Z' }));
  const notes = [{ body: older }, { body: newer }, { body: otherOpp }];
  check('property identity: latest-by-embedded-timestamp wins, not list order', currentPropertyIdentityConfirmationForOpportunity(notes, 'opp-1', args.address).at, '2026-09-08T00:00:00.000Z');
  check('property identity: scoped to opportunity (opp-2 entry never returned for opp-1)', currentPropertyIdentityConfirmationForOpportunity([{ body: otherOpp }], 'opp-1', args.address), null);
  check('property identity: STALE when the current address no longer matches -- treated as absent', currentPropertyIdentityConfirmationForOpportunity(notes, 'opp-1', '456 Other Ave'), null);
  check('property identity: no notes at all -> null', currentPropertyIdentityConfirmationForOpportunity([], 'opp-1', args.address), null);

  // Withdrawal: the LATEST withdrawal blocks every OLDER confirmation,
  // even at the SAME address -- withdrawing does not require the address
  // to change (Jess Gate, 2026-09-08).
  const withdrawn = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { status: 'withdrawn', at: '2026-09-08T01:00:00.000Z' }));
  const notesWithdrawn = [{ body: newer }, { body: withdrawn }];
  check('property identity: a withdrawal at the SAME address still blocks the confirmation (not merely an address mismatch)', currentPropertyIdentityConfirmationForOpportunity(notesWithdrawn, 'opp-1', args.address), null);
  check('property identity: a FRESH confirmation after a withdrawal is current again', currentPropertyIdentityConfirmationForOpportunity(
    [...notesWithdrawn, { body: formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-08T02:00:00.000Z' })) }],
    'opp-1', args.address,
  ).status, 'confirmed');
  check('latestPropertyIdentityNoteForOpportunity: returns the latest note of ANY status', latestPropertyIdentityNoteForOpportunity(notesWithdrawn, 'opp-1').status, 'withdrawn');
  check('latestPropertyIdentityNoteForOpportunity: scoped to opportunity', latestPropertyIdentityNoteForOpportunity([{ body: otherOpp }], 'opp-1'), null);
  check('latestPropertyIdentityNoteForOpportunity: no notes at all -> null', latestPropertyIdentityNoteForOpportunity([], 'opp-1'), null);
}

// ============================================================
// 2. Transaction / deal-structure assumptions (unchanged schema)
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
// 3. Seller price position (unchanged schema)
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
// 4. Offer Ready human approval/override decision (v2: evidence snapshot)
// ============================================================
{
  const CONFIRMED_SNAPSHOT = {
    propertyIdentity: { confirmed: true, address: '123 Main St' },
    repairsCondition: { amount: 41000, approved: true },
    arv: { amount: 639863, evidenceState: 'MODERATE' },
    dealEconomics: { status: 'calculated', maxSupportedOffer: 428648, targetStatus: 'calculated', targetValue: 409654 },
    transactionAssumptions: { structure: { kind: 'value', value: 'Standard' }, closing: { kind: 'none' }, title: { kind: 'none' } },
    sellerPricePosition: { kind: 'price', price: 575000 },
  };

  const approvedArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, kind: 'approved', reason: 'Evidence looks complete', snapshot: CONFIRMED_SNAPSHOT };
  const approvedNote = formatReadinessHumanActionNote(approvedArgs);
  check('human action: approved (with reason + full snapshot) round-trips exactly', parseReadinessHumanActionNote(approvedNote), approvedArgs);

  const approvedNoReasonArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:01:00.000Z', operator: null, kind: 'approved', reason: null, snapshot: CONFIRMED_SNAPSHOT };
  const approvedNoReasonNote = formatReadinessHumanActionNote(approvedNoReasonArgs);
  check('human action: approved with NO reason round-trips as null (reason is optional for approved)', parseReadinessHumanActionNote(approvedNoReasonNote), approvedNoReasonArgs);

  const NOT_READY_SNAPSHOT = Object.assign({}, CONFIRMED_SNAPSHOT, {
    propertyIdentity: { confirmed: false, address: null },
    transactionAssumptions: null,
    sellerPricePosition: null,
  });
  const overriddenArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:02:00.000Z', operator: null, kind: 'overridden', reason: 'Proceeding above evidence gap per operator judgment', snapshot: NOT_READY_SNAPSHOT };
  const overriddenNote = formatReadinessHumanActionNote(overriddenArgs);
  check('human action: overridden (required reason + snapshot with null sub-fields) round-trips exactly', parseReadinessHumanActionNote(overriddenNote), overriddenArgs);

  check('human action: wrong header refused (v1 notes no longer recognized)', parseReadinessHumanActionNote('IAOS OFFER READINESS HUMAN ACTION — iaos-offer-readiness-human-action-v1\nRecorded at: 2026-09-08T00:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\nKind: approved\nReason: ok'), null);
  check('human action: overridden with NO reason is refused (HumanAction requires one)', parseReadinessHumanActionNote(overriddenNote.replace('Reason: ' + overriddenArgs.reason, 'Reason: UNAVAILABLE')), null);
  check('human action: overridden with a blank reason is refused', parseReadinessHumanActionNote(overriddenNote.replace('Reason: ' + overriddenArgs.reason, 'Reason:  ')), null);
  check('human action: an unrecognized Kind is refused', parseReadinessHumanActionNote(approvedNote.replace('Kind: approved', 'Kind: maybe')), null);
  check('human action: extra line refused', parseReadinessHumanActionNote(approvedNote + '\nExtra: line'), null);
  check('human action: missing opportunity refused', parseReadinessHumanActionNote(formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { opportunityId: '' }))), null);
  check('human action: non-canonical timestamp refused', parseReadinessHumanActionNote(approvedNote.replace(approvedArgs.at, '2026-09-08T00:00:00.000-05:00')), null);
  check('human action: garbage body refused', parseReadinessHumanActionNote('not a note'), null);
  check('human action: malformed JSON in a snapshot field is refused', parseReadinessHumanActionNote(approvedNote.replace(JSON.stringify(CONFIRMED_SNAPSHOT.arv), '{not json')), null);

  const notesHA = [{ body: approvedNote }, { body: overriddenNote }];
  check('human action: latest-by-embedded-timestamp wins (overridden is newer here)', latestReadinessHumanActionForOpportunity(notesHA, 'opp-1'), overriddenArgs);
  check('human action: scoped to opportunity', latestReadinessHumanActionForOpportunity([{ body: formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { opportunityId: 'opp-2' })) }], 'opp-1'), null);
  check('human action: no notes at all -> null', latestReadinessHumanActionForOpportunity([], 'opp-1'), null);

  // ---- isReadinessDecisionCurrent: durable invalidation ----
  const record = parseReadinessHumanActionNote(overriddenNote);
  const liveMatchingSnapshot = {
    newestPropertyIdentityNoteAt: null, newestTransactionAssumptionsNoteAt: null,
    newestSellerPricePositionNoteAt: null, newestArvApprovalNoteAt: null,
    repairsCondition: NOT_READY_SNAPSHOT.repairsCondition, dealEconomics: NOT_READY_SNAPSHOT.dealEconomics,
  };
  check('currency: nothing changed since the decision -> current', isReadinessDecisionCurrent(record, liveMatchingSnapshot).current, true);

  const afterPropertyNote = Object.assign({}, liveMatchingSnapshot, { newestPropertyIdentityNoteAt: '2026-09-08T00:03:00.000Z' });
  const staleByProperty = isReadinessDecisionCurrent(record, afterPropertyNote);
  check('currency: a property-identity note AFTER the decision -> stale (durable, not value-based)', staleByProperty.current, false);
  check('currency: stale reason names property identity', staleByProperty.staleBecause.some((s) => s.includes('property identity')), true);

  const beforePropertyNote = Object.assign({}, liveMatchingSnapshot, { newestPropertyIdentityNoteAt: '2026-09-08T00:01:00.000Z' });
  check('currency: a property-identity note BEFORE the decision -> still current (only NEWER notes invalidate)', isReadinessDecisionCurrent(record, beforePropertyNote).current, true);

  const staleByTransaction = isReadinessDecisionCurrent(record, Object.assign({}, liveMatchingSnapshot, { newestTransactionAssumptionsNoteAt: '2026-09-08T00:03:00.000Z' }));
  check('currency: a transaction-assumptions note AFTER the decision -> stale', staleByTransaction.current, false);
  const staleBySellerPrice = isReadinessDecisionCurrent(record, Object.assign({}, liveMatchingSnapshot, { newestSellerPricePositionNoteAt: '2026-09-08T00:03:00.000Z' }));
  check('currency: a seller-price-position note AFTER the decision -> stale', staleBySellerPrice.current, false);
  const staleByArv = isReadinessDecisionCurrent(record, Object.assign({}, liveMatchingSnapshot, { newestArvApprovalNoteAt: '2026-09-08T00:03:00.000Z' }));
  check('currency: an ARV approval note AFTER the decision -> stale', staleByArv.current, false);

  // Repairs / deal economics: value-comparison only (documented limitation).
  const staleByRepairs = isReadinessDecisionCurrent(record, Object.assign({}, liveMatchingSnapshot, { repairsCondition: { amount: 55000, approved: true } }));
  check('currency: repairs figure differs from snapshot -> stale (value comparison)', staleByRepairs.current, false);
  const staleByDealEconomics = isReadinessDecisionCurrent(record, Object.assign({}, liveMatchingSnapshot, { dealEconomics: { status: 'unavailable', maxSupportedOffer: null, targetStatus: null, targetValue: null } }));
  check('currency: deal economics differs from snapshot -> stale (value comparison)', staleByDealEconomics.current, false);

  // "Stays stale even if previous values return": a NEWER note's mere
  // EXISTENCE invalidates permanently -- staleness here does not depend on
  // what that later note's own value says, so a value reverting to the
  // original snapshot cannot un-invalidate it. Simulated by re-checking
  // with the SAME later timestamp: still stale regardless.
  const stillStaleAfterRevert = isReadinessDecisionCurrent(record, Object.assign({}, liveMatchingSnapshot, { newestPropertyIdentityNoteAt: '2026-09-08T00:05:00.000Z' }));
  check('currency: stays stale even at a timestamp further past the decision (never "un-goes-stale")', stillStaleAfterRevert.current, false);

  const multipleStale = isReadinessDecisionCurrent(record, Object.assign({}, liveMatchingSnapshot, {
    newestPropertyIdentityNoteAt: '2026-09-08T00:03:00.000Z', newestArvApprovalNoteAt: '2026-09-08T00:04:00.000Z',
  }));
  check('currency: multiple independent reasons are all reported, not just the first', multipleStale.staleBecause.length, 2);
}

// ============================================================
// 5. Contract Ready handoff checklist -- durable, scoped
// ============================================================
{
  const allFalse = Object.fromEntries(CONTRACT_READY_ITEM_KEYS.map((k) => [k, false]));
  const someTrue = Object.assign({}, allFalse, { legal_owners: true, closing_timeline: true });

  const args = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, agreedPrice: 440000, propertyAddress: '742 Evergreen Terrace, Austin, TX, 78701', items: someTrue };
  const note = formatContractReadyChecklistNote(args);
  check('contract ready: round-trips exactly', parseContractReadyChecklistNote(note), args);

  check('contract ready: extra line refused', parseContractReadyChecklistNote(note + '\nExtra: line'), null);
  check('contract ready: missing opportunity refused', parseContractReadyChecklistNote(formatContractReadyChecklistNote(Object.assign({}, args, { opportunityId: '' }))), null);
  check('contract ready: missing address refused', parseContractReadyChecklistNote(formatContractReadyChecklistNote(Object.assign({}, args, { propertyAddress: '' }))), null);
  check('contract ready: zero agreed price refused', parseContractReadyChecklistNote(formatContractReadyChecklistNote(Object.assign({}, args, { agreedPrice: 0 }))), null);
  check('contract ready: non-canonical timestamp refused', parseContractReadyChecklistNote(note.replace(args.at, '2026-09-08')), null);
  check('contract ready: garbage body refused', parseContractReadyChecklistNote('not a note'), null);
  check('contract ready: malformed items JSON refused', parseContractReadyChecklistNote(note.replace(JSON.stringify(someTrue), '{not json')), null);
  check('contract ready: an item missing a key is refused', parseContractReadyChecklistNote(note.replace(JSON.stringify(someTrue), JSON.stringify({ legal_owners: true }))), null);
  check('contract ready: an unknown extra key is refused (no silent carry-through)', parseContractReadyChecklistNote(note.replace(JSON.stringify(someTrue), JSON.stringify(Object.assign({}, someTrue, { bogus: true })))), null);
  check('contract ready: a non-boolean item value is refused', parseContractReadyChecklistNote(note.replace('"legal_owners":true', '"legal_owners":"yes"')), null);

  const older = formatContractReadyChecklistNote(Object.assign({}, args, { at: '2026-09-01T00:00:00.000Z', items: allFalse }));
  const newer = formatContractReadyChecklistNote(Object.assign({}, args, { at: '2026-09-08T00:00:00.000Z' }));
  const otherOpp = formatContractReadyChecklistNote(Object.assign({}, args, { opportunityId: 'opp-2', at: '2026-09-09T00:00:00.000Z' }));
  const notesCR = [{ body: older }, { body: newer }, { body: otherOpp }];
  check('contract ready: latest-by-embedded-timestamp wins, not list order', currentContractReadyChecklistForOpportunity(notesCR, 'opp-1', args.agreedPrice, args.propertyAddress).items, someTrue);
  check('contract ready: scoped to opportunity', currentContractReadyChecklistForOpportunity([{ body: otherOpp }], 'opp-1', args.agreedPrice, args.propertyAddress), null);
  check('contract ready: a DIFFERENT agreed price reads back as no progress, never carried over', currentContractReadyChecklistForOpportunity(notesCR, 'opp-1', 999999, args.propertyAddress), null);
  check('contract ready: a DIFFERENT property address reads back as no progress, never carried over', currentContractReadyChecklistForOpportunity(notesCR, 'opp-1', args.agreedPrice, 'Some Other Address'), null);
  check('contract ready: no notes at all -> null', currentContractReadyChecklistForOpportunity([], 'opp-1', args.agreedPrice, args.propertyAddress), null);
  check('CONTRACT_READY_ITEM_KEYS has exactly five keys, matching the page\'s own CONTRACT_CHECKLIST_ITEMS', CONTRACT_READY_ITEM_KEYS.length, 5);
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
