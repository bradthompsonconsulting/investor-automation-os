/**
 * Offer Readiness durable carriers -- test runner. B8-13 / INV-68,
 * extended by two rounds of Jess Gate correction, 2026-09-08.
 *
 * Compiles the pure carriers module (no dependencies beyond itself) to a
 * temp directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases against all seven carriers: Property identity
 * (confirm/withdraw), Transaction assumptions, Seller price position, the
 * Offer Ready human approval/override decision (full six-category
 * snapshot with runtime shape validation, direct comparison, durable
 * permanent invalidation), the invalidation record itself, the
 * display-only legacy v1 reader, and the Contract Ready handoff checklist
 * (scoped by the accepted outcome's own durable identity). No GHL, no
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
  formatReadinessDecisionInvalidationNote, parseReadinessDecisionInvalidationNote, isReadinessDecisionInvalidated,
  parseLegacyReadinessHumanActionV1Note, latestLegacyReadinessHumanActionV1ForOpportunity,
  formatContractReadyChecklistNote, parseContractReadyChecklistNote, currentContractReadyChecklistForOpportunity,
  CONTRACT_READY_ITEM_KEYS,
} = require(modulePath);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 128;
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
// 1. Property identity confirmation / withdrawal (v2, unchanged by this round)
// ============================================================
{
  const args = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, status: 'confirmed', address: '123 Main St, Austin, TX 78701' };
  const note = formatPropertyIdentityConfirmationNote(args);
  check('property identity: round-trips exactly (v2, with Status)', parsePropertyIdentityConfirmationNote(note), args);
  check('property identity: extra line refused (positional, not find())', parsePropertyIdentityConfirmationNote(note + '\nExtra: line'), null);
  check('property identity: an unrecognized Status is refused', parsePropertyIdentityConfirmationNote(note.replace('Status: confirmed', 'Status: maybe')), null);

  const older = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-01T00:00:00.000Z' }));
  const newer = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-08T00:00:00.000Z' }));
  const withdrawn = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { status: 'withdrawn', at: '2026-09-08T01:00:00.000Z' }));
  const notesWithdrawn = [{ body: newer }, { body: withdrawn }];
  check('property identity: latest wins, scoped, address-matched', currentPropertyIdentityConfirmationForOpportunity([{ body: older }, { body: newer }], 'opp-1', args.address).at, '2026-09-08T00:00:00.000Z');
  check('property identity: a withdrawal at the SAME address still blocks the confirmation', currentPropertyIdentityConfirmationForOpportunity(notesWithdrawn, 'opp-1', args.address), null);
  check('latestPropertyIdentityNoteForOpportunity: returns the latest note of ANY status', latestPropertyIdentityNoteForOpportunity(notesWithdrawn, 'opp-1').status, 'withdrawn');

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round): each of
  // these was verbatim-present against the v2 schema before this round's
  // rewrite and was dropped when the section was rewritten around the
  // (unrelated) v3 human-action changes. Same assertions, current API.
  check('property identity: wrong header refused (v1 notes no longer recognized)', parsePropertyIdentityConfirmationNote(
    'IAOS PROPERTY IDENTITY CONFIRMATION — iaos-property-identity-confirmation-v1\nConfirmed at: 2026-09-08T00:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\nConfirmed address: 123 Main St'
  ), null);
  check('property identity: missing opportunity refused', parsePropertyIdentityConfirmationNote(formatPropertyIdentityConfirmationNote(Object.assign({}, args, { opportunityId: '' }))), null);
  check('property identity: missing address refused', parsePropertyIdentityConfirmationNote(formatPropertyIdentityConfirmationNote(Object.assign({}, args, { address: '' }))), null);
  check('property identity: non-canonical timestamp refused', parsePropertyIdentityConfirmationNote(note.replace(args.at, '2026-09-08T00:00:00Z')), null);
  check('property identity: garbage body refused', parsePropertyIdentityConfirmationNote('not a note at all'), null);
  const operatorNamed = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { operator: 'Brad' }));
  check('property identity: named operator round-trips', parsePropertyIdentityConfirmationNote(operatorNamed).operator, 'Brad');
  check('property identity: null operator serializes as UNAVAILABLE, not the literal null', note.includes('Operator: UNAVAILABLE'), true);

  const otherOppPI = formatPropertyIdentityConfirmationNote(Object.assign({}, args, { opportunityId: 'opp-2', at: '2026-09-09T00:00:00.000Z' }));
  // List deliberately OUT of timestamp order -- proves the reader sorts by
  // the note's OWN embedded `at`, never by array/list position.
  const outOfOrderNotes = [{ body: newer }, { body: older }, { body: otherOppPI }];
  check('property identity: latest-by-embedded-timestamp wins, not list order', currentPropertyIdentityConfirmationForOpportunity(outOfOrderNotes, 'opp-1', args.address).at, '2026-09-08T00:00:00.000Z');
  check('property identity: scoped to opportunity (opp-2 entry never returned for opp-1)', currentPropertyIdentityConfirmationForOpportunity([{ body: otherOppPI }], 'opp-1', args.address), null);
  check('property identity: STALE when the current address no longer matches -- treated as absent', currentPropertyIdentityConfirmationForOpportunity([{ body: newer }], 'opp-1', '456 Other Ave'), null);
  check('property identity: no notes at all -> null', currentPropertyIdentityConfirmationForOpportunity([], 'opp-1', args.address), null);
  check('property identity: a FRESH confirmation after a withdrawal is current again', currentPropertyIdentityConfirmationForOpportunity(
    [...notesWithdrawn, { body: formatPropertyIdentityConfirmationNote(Object.assign({}, args, { at: '2026-09-08T02:00:00.000Z' })) }],
    'opp-1', args.address,
  ).status, 'confirmed');
  check('latestPropertyIdentityNoteForOpportunity: scoped to opportunity', latestPropertyIdentityNoteForOpportunity([{ body: otherOppPI }], 'opp-1'), null);
  check('latestPropertyIdentityNoteForOpportunity: no notes at all -> null', latestPropertyIdentityNoteForOpportunity([], 'opp-1'), null);
}

// ============================================================
// 2. Transaction / deal-structure assumptions (unchanged)
// ============================================================
{
  const none = { kind: 'none' };
  const value = (v) => ({ kind: 'value', value: v });
  const args = {
    opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null,
    transactionStructure: value('Standard assignment'), closingPossession: value('Close in 21 days, vacant at close'), titleComplications: none,
  };
  const note = formatTransactionAssumptionsNote(args);
  check('transaction assumptions: round-trips exactly', parseTransactionAssumptionsNote(note), args);
  check('transaction assumptions: a genuinely blank field is refused', parseTransactionAssumptionsNote(note.replace('Transaction structure: Standard assignment', 'Transaction structure: ')), null);
  const otherOpp = formatTransactionAssumptionsNote(Object.assign({}, args, { opportunityId: 'opp-2' }));
  check('transaction assumptions: scoped to opportunity', latestTransactionAssumptionsForOpportunity([{ body: otherOpp }], 'opp-1'), null);

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round).
  const allNone = formatTransactionAssumptionsNote(Object.assign({}, args, { transactionStructure: none, closingPossession: none, titleComplications: none }));
  check('transaction assumptions: all three explicitly none is valid (recorded, not blank)', parseTransactionAssumptionsNote(allNone).titleComplications, none);
  check('transaction assumptions: extra line refused', parseTransactionAssumptionsNote(note + '\nExtra: line'), null);
  check('transaction assumptions: missing opportunity refused', parseTransactionAssumptionsNote(formatTransactionAssumptionsNote(Object.assign({}, args, { opportunityId: '' }))), null);
  check('transaction assumptions: non-canonical timestamp refused', parseTransactionAssumptionsNote(note.replace(args.at, '2026-09-08')), null);
  check('transaction assumptions: garbage body refused', parseTransactionAssumptionsNote('not a note'), null);
  const olderTA = formatTransactionAssumptionsNote(Object.assign({}, args, { at: '2026-09-01T00:00:00.000Z' }));
  const newerTA = formatTransactionAssumptionsNote(Object.assign({}, args, { at: '2026-09-08T00:00:00.000Z', titleComplications: value('Lien pending payoff') }));
  check('transaction assumptions: latest-by-embedded-timestamp wins', latestTransactionAssumptionsForOpportunity([{ body: newerTA }, { body: olderTA }], 'opp-1').titleComplications, value('Lien pending payoff'));
  check('transaction assumptions: no notes at all -> null', latestTransactionAssumptionsForOpportunity([], 'opp-1'), null);
}

// ============================================================
// 3. Seller price position (unchanged)
// ============================================================
{
  const priceArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, kind: 'price', price: 275000 };
  const priceNote = formatSellerPricePositionNote(priceArgs);
  check('seller price position: price round-trips exactly', parseSellerPricePositionNote(priceNote), priceArgs);
  const refusedArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:05:00.000Z', operator: null, kind: 'refused' };
  const refusedNote = formatSellerPricePositionNote(refusedArgs);
  check('seller price position: a documented refusal round-trips exactly', parseSellerPricePositionNote(refusedNote), refusedArgs);
  check('seller price position: a refusal note carrying a stray number is refused', parseSellerPricePositionNote(refusedNote.replace('Price: UNAVAILABLE', 'Price: 999')), null);
  // Restored per Jess Gate accounting correction, 2026-09-08 (round 3,
  // pass 2) -- dropped during the round's mid-flight rewrite with no
  // replacement. Asserts the WRITE side: the formatter itself never
  // serializes a numeric price for a refusal, distinct from the read-side
  // "tampered" check above, which only proves parsing REJECTS a stray
  // number if one is somehow present.
  check('seller price position: refusal serializes with no stray price value', refusedNote.includes('Price: UNAVAILABLE') && !/Price: \d/.test(refusedNote), true);

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round).
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
// 4. Offer Ready human approval/override decision (v3: inputs + outputs,
//    runtime shape validation, direct comparison, durable invalidation)
// ============================================================

// Key order matches EXACTLY what validateDealEconomicsInputsSnapshot emits,
// which (per the key-order regression fix, third Jess Gate correction round)
// now matches BOTH DealEconomicsInputsSnapshot's own declared field order
// AND the page's write-side object literal: the seven resolved fields, then
// assignmentMode/assignmentAmount/financingKind, then the three financing-
// resolved fields last -- this test's own check() uses JSON.stringify
// equality, which is key-order-sensitive, so round-trip fixtures must match
// the parser's own emission order, not just have the same key/value pairs.
const VALID_INPUTS = {
  sellingCostPct: { value: 0.10, level: 'iaos_starter' },
  closingCost: { value: 2500, level: 'iaos_starter' },
  monthlyCarry: { value: 500, level: 'iaos_starter' },
  holdMonths: { value: 5, level: 'iaos_starter' },
  buyerProfitPct: { value: 0.15, level: 'iaos_starter' },
  standardMinimum: { value: 5000, level: 'iaos_starter' },
  profitSharePct: { value: 0.25, level: 'iaos_starter' },
  assignmentMode: 'standard',
  assignmentAmount: null,
  financingKind: 'on',
  financingLtv: { value: 0.70, level: 'iaos_starter' },
  financingRate: { value: 0.12, level: 'iaos_starter' },
  financingPoints: { value: 0.02, level: 'iaos_starter' },
};

const CONFIRMED_SNAPSHOT = {
  propertyIdentity: { confirmed: true, address: '123 Main St' },
  repairsCondition: { amount: 41000, approved: true },
  arv: { amount: 639863, evidenceState: 'MODERATE' },
  dealEconomics: { status: 'calculated', maxSupportedOffer: 428648, targetStatus: 'calculated', targetValue: 409654, inputs: VALID_INPUTS },
  transactionAssumptions: { structure: { kind: 'value', value: 'Standard' }, closing: { kind: 'none' }, title: { kind: 'none' } },
  sellerPricePosition: { kind: 'price', price: 575000 },
};

{
  const approvedArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, kind: 'approved', reason: 'Evidence looks complete', snapshot: CONFIRMED_SNAPSHOT };
  const approvedNote = formatReadinessHumanActionNote(approvedArgs);
  check('human action: approved (full snapshot incl. deal-economics inputs) round-trips exactly', parseReadinessHumanActionNote(approvedNote), approvedArgs);

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round): reason
  // is OPTIONAL for `approved` (unlike `overridden`, which requires one).
  const approvedNoReasonArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:01:00.000Z', operator: null, kind: 'approved', reason: null, snapshot: CONFIRMED_SNAPSHOT };
  const approvedNoReasonNote = formatReadinessHumanActionNote(approvedNoReasonArgs);
  check('human action: approved with NO reason round-trips as null (reason is optional for approved)', parseReadinessHumanActionNote(approvedNoReasonNote), approvedNoReasonArgs);

  const NOT_READY_SNAPSHOT = Object.assign({}, CONFIRMED_SNAPSHOT, {
    propertyIdentity: { confirmed: false, address: null },
    transactionAssumptions: null,
    sellerPricePosition: null,
  });
  const overriddenArgs = { opportunityId: 'opp-1', at: '2026-09-08T00:02:00.000Z', operator: null, kind: 'overridden', reason: 'Proceeding above evidence gap', snapshot: NOT_READY_SNAPSHOT };
  const overriddenNote = formatReadinessHumanActionNote(overriddenArgs);
  check('human action: overridden (nullable sub-fields) round-trips exactly', parseReadinessHumanActionNote(overriddenNote), overriddenArgs);

  check('human action: v1 header (5 fields, no snapshot) refused by the v3 parser', parseReadinessHumanActionNote(
    'IAOS OFFER READINESS HUMAN ACTION — iaos-offer-readiness-human-action-v1\nRecorded at: 2026-09-08T00:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\nKind: approved\nReason: ok'
  ), null);
  check('human action: v2 header (11 fields, no dealEconomics.inputs) refused by the v3 shape validator', parseReadinessHumanActionNote(
    approvedNote.replace('iaos-offer-readiness-human-action-v3', 'iaos-offer-readiness-human-action-v2')
  ), null);
  check('human action: overridden with NO reason refused', parseReadinessHumanActionNote(overriddenNote.replace('Reason: ' + overriddenArgs.reason, 'Reason: UNAVAILABLE')), null);
  check('human action: extra line refused', parseReadinessHumanActionNote(approvedNote + '\nExtra: line'), null);
  check('human action: garbage body refused', parseReadinessHumanActionNote('not a note'), null);

  // --- Runtime shape validation: valid JSON, WRONG SHAPE, must still be refused ---
  check('human action: property snapshot as valid JSON but wrong shape (extra key) refused',
    parseReadinessHumanActionNote(approvedNote.replace(JSON.stringify(CONFIRMED_SNAPSHOT.propertyIdentity), JSON.stringify(Object.assign({}, CONFIRMED_SNAPSHOT.propertyIdentity, { bogus: 1 })))), null);
  check('human action: property snapshot with confirmed as a string (not boolean) refused',
    parseReadinessHumanActionNote(approvedNote.replace('"confirmed":true', '"confirmed":"true"')), null);
  check('human action: repairs snapshot with a non-numeric amount refused',
    parseReadinessHumanActionNote(approvedNote.replace('"amount":41000,"approved":true', '"amount":"41000","approved":true')), null);
  check('human action: ARV snapshot with an invalid evidenceState enum value refused',
    parseReadinessHumanActionNote(approvedNote.replace('"evidenceState":"MODERATE"', '"evidenceState":"SUPER_HIGH"')), null);
  check('human action: deal economics snapshot missing the inputs key entirely refused', (() => {
    const badSnapshot = Object.assign({}, CONFIRMED_SNAPSHOT, {
      dealEconomics: { status: 'calculated', maxSupportedOffer: 428648, targetStatus: 'calculated', targetValue: 409654 },
    });
    return parseReadinessHumanActionNote(formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { snapshot: badSnapshot })));
  })(), null);
  check('human action: deal economics inputs with a malformed resolved field (missing level) refused',
    parseReadinessHumanActionNote(approvedNote.replace('"sellingCostPct":{"value":0.1,"level":"iaos_starter"}', '"sellingCostPct":{"value":0.1}')), null);
  check('human action: transaction assumptions with an unrecognized field kind refused',
    parseReadinessHumanActionNote(approvedNote.replace('"structure":{"kind":"value","value":"Standard"}', '"structure":{"kind":"unknown"}')), null);
  check('human action: seller price position with a negative price refused',
    parseReadinessHumanActionNote(formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { snapshot: Object.assign({}, CONFIRMED_SNAPSHOT, { sellerPricePosition: { kind: 'price', price: -5 } }) })))
  , null);
  check('human action: malformed JSON syntax in a snapshot field still refused (baseline)',
    parseReadinessHumanActionNote(approvedNote.replace(JSON.stringify(CONFIRMED_SNAPSHOT.arv), '{not json')), null);

  const notesHA = [{ body: approvedNote }, { body: overriddenNote }];
  check('human action: latest-by-embedded-timestamp wins', latestReadinessHumanActionForOpportunity(notesHA, 'opp-1'), overriddenArgs);

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round).
  check('human action: an unrecognized Kind is refused', parseReadinessHumanActionNote(approvedNote.replace('Kind: approved', 'Kind: maybe')), null);
  check('human action: missing opportunity refused', parseReadinessHumanActionNote(formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { opportunityId: '' }))), null);
  check('human action: non-canonical timestamp refused', parseReadinessHumanActionNote(approvedNote.replace(approvedArgs.at, '2026-09-08T00:00:00.000-05:00')), null);
  // Distinct from "overridden with NO reason" (line above, literal
  // UNAVAILABLE) -- this is a genuinely BLANK (whitespace-only) reason,
  // the other branch of the SAME `reasonRaw.trim() === ""` refusal.
  check('human action: overridden with a blank (whitespace) reason is refused', parseReadinessHumanActionNote(overriddenNote.replace('Reason: ' + overriddenArgs.reason, 'Reason:  ')), null);
  check('human action: scoped to opportunity', latestReadinessHumanActionForOpportunity([{ body: formatReadinessHumanActionNote(Object.assign({}, approvedArgs, { opportunityId: 'opp-2' })) }], 'opp-1'), null);
  check('human action: no notes at all -> null', latestReadinessHumanActionForOpportunity([], 'opp-1'), null);
}

// ---- isReadinessDecisionCurrent: DIRECT comparison + durable permanence ----
{
  const record = parseReadinessHumanActionNote(formatReadinessHumanActionNote({
    opportunityId: 'opp-1', at: '2026-09-08T00:02:00.000Z', operator: null, kind: 'overridden', reason: 'x',
    snapshot: Object.assign({}, CONFIRMED_SNAPSHOT, { propertyIdentity: { confirmed: false, address: null }, transactionAssumptions: null, sellerPricePosition: null }),
  }));
  const liveMatching = {
    snapshot: record.snapshot,
    newestPropertyIdentityNoteAt: null, newestTransactionAssumptionsNoteAt: null,
    newestSellerPricePositionNoteAt: null, newestArvApprovalNoteAt: null,
    durablyInvalidated: false,
  };
  check('currency: nothing changed -> current', isReadinessDecisionCurrent(record, liveMatching).current, true);

  // REGRESSION, third Jess Gate correction round (2026-09-08): caught LIVE
  // in Test -- `validateDealEconomicsInputsSnapshot` used to rebuild its
  // output object with a DIFFERENT key insertion order than the page's own
  // `buildDealEconomicsInputsSnapshot` object literal. Both emitted
  // identical values, but `JSON.stringify` is insertion-order-sensitive, so
  // EVERY decision compared unequal to itself on the very next read, even
  // with nothing changed -- decisions never stayed current. This
  // reproduces the exact shape that exposed it: a FRESH object literal
  // (mirroring the page's write-side construction order) as `live`,
  // compared against the SAME values recovered by ROUND-TRIPPING through
  // format -> parse (the read-side reconstruction), for a decision whose
  // `snapshot.dealEconomics.inputs` came from that same round trip.
  const freshLiteralInputs = {
    sellingCostPct: { value: 0.10, level: 'iaos_starter' },
    closingCost: { value: 2500, level: 'iaos_starter' },
    monthlyCarry: { value: 500, level: 'iaos_starter' },
    holdMonths: { value: 5, level: 'iaos_starter' },
    buyerProfitPct: { value: 0.15, level: 'iaos_starter' },
    standardMinimum: { value: 5000, level: 'iaos_starter' },
    profitSharePct: { value: 0.25, level: 'iaos_starter' },
    assignmentMode: 'standard',
    assignmentAmount: null,
    financingKind: 'on',
    financingLtv: { value: 0.70, level: 'iaos_starter' },
    financingRate: { value: 0.12, level: 'iaos_starter' },
    financingPoints: { value: 0.02, level: 'iaos_starter' },
  };
  const liveFreshLiteral = {
    snapshot: Object.assign({}, record.snapshot, {
      dealEconomics: Object.assign({}, record.snapshot.dealEconomics, { inputs: freshLiteralInputs }),
    }),
    newestPropertyIdentityNoteAt: null, newestTransactionAssumptionsNoteAt: null,
    newestSellerPricePositionNoteAt: null, newestArvApprovalNoteAt: null,
    durablyInvalidated: false,
  };
  check('currency: a FRESH write-shaped object literal with IDENTICAL values to the round-tripped record stays current (key-order regression)', isReadinessDecisionCurrent(record, liveFreshLiteral).current, true);

  // DIRECT comparison catches a change with NO new note at all -- e.g. the
  // property address changed externally in GHL, no confirmation note written.
  const liveAddressChanged = Object.assign({}, liveMatching, {
    snapshot: Object.assign({}, record.snapshot, { propertyIdentity: { confirmed: false, address: '999 New Address' } }),
  });
  const staleByDirectAddress = isReadinessDecisionCurrent(record, liveAddressChanged);
  check('currency: DIRECT property address mismatch invalidates with NO new note (Jess Gate requirement)', staleByDirectAddress.current, false);
  check('currency: stale reason names property identity directly', staleByDirectAddress.staleBecause.some((s) => s.startsWith('property identity')), true);

  // DIRECT comparison catches an INPUT-only change even when OUTPUTS are identical.
  const liveInputChangedOutputSame = Object.assign({}, liveMatching, {
    snapshot: Object.assign({}, record.snapshot, {
      dealEconomics: Object.assign({}, record.snapshot.dealEconomics, {
        inputs: Object.assign({}, VALID_INPUTS, { profitSharePct: { value: 0.40, level: 'investor_policy' } }),
      }),
    }),
  });
  const staleByInputOnly = isReadinessDecisionCurrent(record, liveInputChangedOutputSame);
  check('currency: an INPUT-only change (profitSharePct) invalidates even with maxSupportedOffer/targetValue UNCHANGED', staleByInputOnly.current, false);
  check('currency: stale reason names deal economics', staleByInputOnly.staleBecause.some((s) => s.startsWith('deal economics')), true);

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round): the
  // OUTPUT half of the same dealEconomics comparison, inputs held fixed --
  // the pre-v3 file's original "deal economics differs" case, re-targeted
  // at the current inputs+outputs snapshot shape.
  const liveOutputChangedInputSame = Object.assign({}, liveMatching, {
    snapshot: Object.assign({}, record.snapshot, {
      dealEconomics: { status: 'unavailable', maxSupportedOffer: null, targetStatus: null, targetValue: null, inputs: VALID_INPUTS },
    }),
  });
  check('currency: deal economics OUTPUT differs from snapshot -> stale (inputs unchanged)', isReadinessDecisionCurrent(record, liveOutputChangedInputSame).current, false);

  // Existence-based supplement: a later note with an IDENTICAL value still invalidates.
  const liveUnchangedButNewerNote = Object.assign({}, liveMatching, { newestTransactionAssumptionsNoteAt: '2026-09-08T00:03:00.000Z' });
  check('currency: a later note with an unchanged value still invalidates (existence supplement)', isReadinessDecisionCurrent(record, liveUnchangedButNewerNote).current, false);

  // Durable permanence: once `durablyInvalidated` is true, current is
  // false UNCONDITIONALLY, even if snapshot/live are byte-identical.
  const liveMatchingButInvalidated = Object.assign({}, liveMatching, { durablyInvalidated: true });
  const permanentlyStale = isReadinessDecisionCurrent(record, liveMatchingButInvalidated);
  check('currency: durablyInvalidated=true forces stale even when live snapshot matches exactly (permanence)', permanentlyStale.current, false);
  check('currency: permanence reason is distinct and explicit', permanentlyStale.staleBecause[0].includes('durably invalidated'), true);

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round): the
  // EXISTENCE-based supplement checks (a later note whose OWN value is
  // unchanged still invalidates) exercised per-category, not only for
  // transaction assumptions as the earlier consolidation left it.
  const afterPropertyNote = Object.assign({}, liveMatching, { newestPropertyIdentityNoteAt: '2026-09-08T00:03:00.000Z' });
  const staleByPropertyExistence = isReadinessDecisionCurrent(record, afterPropertyNote);
  check('currency: a property-identity note AFTER the decision -> stale (existence, value unchanged)', staleByPropertyExistence.current, false);
  const beforePropertyNote = Object.assign({}, liveMatching, { newestPropertyIdentityNoteAt: '2026-09-08T00:01:00.000Z' });
  check('currency: a property-identity note BEFORE the decision -> still current (only NEWER notes invalidate)', isReadinessDecisionCurrent(record, beforePropertyNote).current, true);
  const staleBySellerPriceExistence = isReadinessDecisionCurrent(record, Object.assign({}, liveMatching, { newestSellerPricePositionNoteAt: '2026-09-08T00:03:00.000Z' }));
  check('currency: a seller-price-position note AFTER the decision -> stale (existence, value unchanged)', staleBySellerPriceExistence.current, false);
  const staleByArvExistence = isReadinessDecisionCurrent(record, Object.assign({}, liveMatching, { newestArvApprovalNoteAt: '2026-09-08T00:03:00.000Z' }));
  check('currency: an ARV approval note AFTER the decision -> stale (existence, value unchanged)', staleByArvExistence.current, false);
  // Restored per Jess Gate accounting correction, 2026-09-08 (round 3, pass
  // 2) -- dropped during the round's mid-flight rewrite with no
  // replacement. The generic `liveUnchangedButNewerNote` case above (line
  // ~385) already exercises this mechanically via transaction assumptions,
  // but named no category-specific check for it, leaving transaction
  // assumptions the only one of the four note-backed categories without
  // its own explicit AFTER-the-decision existence check alongside property
  // identity, seller price position, and ARV directly above.
  const staleByTransactionAssumptionsExistence = isReadinessDecisionCurrent(record, Object.assign({}, liveMatching, { newestTransactionAssumptionsNoteAt: '2026-09-08T00:03:00.000Z' }));
  check('currency: a transaction-assumptions note AFTER the decision -> stale (existence, value unchanged)', staleByTransactionAssumptionsExistence.current, false);

  // Direct value-comparison for repairsCondition specifically (property
  // identity and deal economics already exercise this above; repairs is
  // the other of the two categories the FIRST Jess Gate correction added).
  const staleByRepairsDirect = isReadinessDecisionCurrent(record, Object.assign({}, liveMatching, {
    snapshot: Object.assign({}, record.snapshot, { repairsCondition: { amount: 55000, approved: true } }),
  }));
  check('currency: repairs figure differs from snapshot -> stale (direct value comparison)', staleByRepairsDirect.current, false);

  const stillStaleFurtherPast = isReadinessDecisionCurrent(record, Object.assign({}, liveMatching, { newestPropertyIdentityNoteAt: '2026-09-08T00:05:00.000Z' }));
  check('currency: stays stale even at a timestamp further past the decision (never "un-goes-stale")', stillStaleFurtherPast.current, false);

  const multipleStale = isReadinessDecisionCurrent(record, Object.assign({}, liveMatching, {
    newestPropertyIdentityNoteAt: '2026-09-08T00:03:00.000Z', newestArvApprovalNoteAt: '2026-09-08T00:04:00.000Z',
  }));
  check('currency: multiple independent reasons are all reported, not just the first', multipleStale.staleBecause.length, 2);
}

// ============================================================
// 5. Offer Ready decision -- durable invalidation record
// ============================================================
{
  const args = { opportunityId: 'opp-1', at: '2026-09-08T00:05:00.000Z', operator: null, decisionAt: '2026-09-08T00:02:00.000Z', reasons: ['property identity changed'] };
  const note = formatReadinessDecisionInvalidationNote(args);
  check('invalidation: round-trips exactly', parseReadinessDecisionInvalidationNote(note), args);
  check('invalidation: extra line refused', parseReadinessDecisionInvalidationNote(note + '\nExtra: line'), null);
  check('invalidation: missing decisionAt refused', parseReadinessDecisionInvalidationNote(formatReadinessDecisionInvalidationNote(Object.assign({}, args, { decisionAt: '' }))), null);
  check('invalidation: non-canonical decisionAt timestamp refused', parseReadinessDecisionInvalidationNote(note.replace(args.decisionAt, '2026-09-08T00:02:00Z')), null);
  check('invalidation: empty reasons array refused', parseReadinessDecisionInvalidationNote(formatReadinessDecisionInvalidationNote(Object.assign({}, args, { reasons: [] }))), null);
  check('invalidation: a blank-string reason refused', parseReadinessDecisionInvalidationNote(formatReadinessDecisionInvalidationNote(Object.assign({}, args, { reasons: ['   '] }))), null);
  check('invalidation: garbage body refused', parseReadinessDecisionInvalidationNote('not a note'), null);

  check('isReadinessDecisionInvalidated: true when a matching invalidation note exists', isReadinessDecisionInvalidated([{ body: note }], 'opp-1', args.decisionAt), true);
  check('isReadinessDecisionInvalidated: false for a DIFFERENT decisionAt', isReadinessDecisionInvalidated([{ body: note }], 'opp-1', '2026-09-08T09:00:00.000Z'), false);
  check('isReadinessDecisionInvalidated: false when scoped to a different opportunity', isReadinessDecisionInvalidated([{ body: note }], 'opp-2', args.decisionAt), false);
  check('isReadinessDecisionInvalidated: false with no notes at all', isReadinessDecisionInvalidated([], 'opp-1', args.decisionAt), false);

  // Permanence: once written, ANY reasons or later addition never removes it.
  const secondInvalidation = formatReadinessDecisionInvalidationNote(Object.assign({}, args, { at: '2026-09-08T00:10:00.000Z', reasons: ['a second, unrelated reason'] }));
  check('isReadinessDecisionInvalidated: still true with multiple invalidation notes for the same decision', isReadinessDecisionInvalidated([{ body: note }, { body: secondInvalidation }], 'opp-1', args.decisionAt), true);
}

// ============================================================
// 6. Legacy v1 Offer Ready decision -- DISPLAY ONLY
// ============================================================
{
  const v1Note = 'IAOS OFFER READINESS HUMAN ACTION — iaos-offer-readiness-human-action-v1\nRecorded at: 2026-09-07T15:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\nKind: overridden\nReason: legacy override reason';
  const parsed = parseLegacyReadinessHumanActionV1Note(v1Note);
  check('legacy v1: a genuine v1 record parses under the LEGACY reader', parsed, {
    opportunityId: 'opp-1', at: '2026-09-07T15:00:00.000Z', operator: null, kind: 'overridden', reason: 'legacy override reason',
  });
  check('legacy v1: the SAME record is refused by the v3 (current) reader -- proves it cannot authorize readiness', parseReadinessHumanActionNote(v1Note), null);
  check('legacy v1: overridden with no reason refused even under the legacy reader', parseLegacyReadinessHumanActionV1Note(v1Note.replace('Reason: legacy override reason', 'Reason: UNAVAILABLE')), null);
  check('legacy v1: a v3 note (11 extra snapshot lines) is NOT mistaken for a v1 record', parseLegacyReadinessHumanActionV1Note(formatReadinessHumanActionNote({
    opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null, kind: 'approved', reason: null, snapshot: CONFIRMED_SNAPSHOT,
  })), null);
  check('legacy v1: garbage body refused', parseLegacyReadinessHumanActionV1Note('not a note'), null);

  const otherOppV1 = v1Note.replace('Opportunity: opp-1', 'Opportunity: opp-2');
  check('latestLegacyReadinessHumanActionV1ForOpportunity: scoped to opportunity', latestLegacyReadinessHumanActionV1ForOpportunity([{ body: otherOppV1 }], 'opp-1'), null);
  check('latestLegacyReadinessHumanActionV1ForOpportunity: finds the real v1 record', latestLegacyReadinessHumanActionV1ForOpportunity([{ body: v1Note }], 'opp-1'), parsed);
}

// ============================================================
// 7. Contract Ready handoff checklist -- scoped by agreement identity
// ============================================================
{
  const allFalse = Object.fromEntries(CONTRACT_READY_ITEM_KEYS.map((k) => [k, false]));
  const someTrue = Object.assign({}, allFalse, { legal_owners: true, closing_timeline: true });

  const args = {
    opportunityId: 'opp-1', at: '2026-09-08T00:00:00.000Z', operator: null,
    agreementAt: '2026-09-07T21:39:22.000Z', agreedPrice: 440000, propertyAddress: '742 Evergreen Terrace, Austin, TX, 78701', items: someTrue,
  };
  const note = formatContractReadyChecklistNote(args);
  check('contract ready: round-trips exactly (v2, with Agreement at)', parseContractReadyChecklistNote(note), args);
  check('contract ready: v1 header (no Agreement at) refused', parseContractReadyChecklistNote(
    'IAOS CONTRACT READY CHECKLIST — iaos-contract-ready-checklist-v1\nRecorded at: 2026-09-08T00:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\nAgreed price: 440000\nProperty address: 742 Evergreen Terrace\nItems: ' + JSON.stringify(allFalse)
  ), null);
  check('contract ready: non-canonical Agreement at timestamp refused', parseContractReadyChecklistNote(note.replace(args.agreementAt, '2026-09-07T21:39:22Z')), null);
  check('contract ready: an unknown extra item key refused', parseContractReadyChecklistNote(note.replace(JSON.stringify(someTrue), JSON.stringify(Object.assign({}, someTrue, { bogus: true })))), null);

  const sameAgreementOlder = formatContractReadyChecklistNote(Object.assign({}, args, { at: '2026-09-08T00:00:00.000Z', items: allFalse }));
  const sameAgreementNewer = formatContractReadyChecklistNote(Object.assign({}, args, { at: '2026-09-08T00:05:00.000Z' }));
  const differentAgreementSamePriceAddress = formatContractReadyChecklistNote(Object.assign({}, args, {
    agreementAt: '2026-09-08T10:32:04.000Z', at: '2026-09-08T10:33:00.000Z', items: someTrue,
  }));
  const notesCR = [{ body: sameAgreementOlder }, { body: sameAgreementNewer }, { body: differentAgreementSamePriceAddress }];

  check('contract ready: reopening the SAME agreement (same Agreement at) preserves progress', currentContractReadyChecklistForOpportunity(
    [{ body: sameAgreementOlder }, { body: sameAgreementNewer }], 'opp-1', args.agreementAt, args.agreedPrice, args.propertyAddress,
  ).items, someTrue);
  check('contract ready: a NEW agreement at the SAME price and address does NOT inherit progress (different Agreement at)', currentContractReadyChecklistForOpportunity(
    notesCR, 'opp-1', '2026-09-08T10:32:04.000Z', args.agreedPrice, args.propertyAddress,
  ).items, someTrue); // this new agreement has its OWN progress (someTrue, written fresh) -- not inherited from the old one
  // Note: currentContractReadyChecklistForOpportunity, like every other
  // "current" reader in this file, resolves the GLOBALLY latest note for
  // the opportunity first and only then checks scope match -- it does not
  // search backward for a historical match once a newer entry (for a
  // DIFFERENT agreement) exists. This mirrors `currentPropertyIdentityConfirmationForOpportunity`'s
  // identical design and is never reached in real usage: the page always
  // queries with `latestOutcome.at`, which BY DEFINITION is the latest
  // agreement -- there is no code path that queries a stale agreementAt
  // while a newer one exists.
  check('contract ready: once a newer agreement exists, the checklist correctly reports no progress for a query naming an OLDER agreement (never reached in real usage; consistent with this file\'s latest-first design)', currentContractReadyChecklistForOpportunity(
    notesCR, 'opp-1', args.agreementAt, args.agreedPrice, args.propertyAddress,
  ), null);
  check('contract ready: a DIFFERENT agreed price (even same Agreement at) reads back as no progress', currentContractReadyChecklistForOpportunity(
    [{ body: sameAgreementNewer }], 'opp-1', args.agreementAt, 999999, args.propertyAddress,
  ), null);
  check('contract ready: no notes at all -> null', currentContractReadyChecklistForOpportunity([], 'opp-1', args.agreementAt, args.agreedPrice, args.propertyAddress), null);

  // Restored per Jess Gate coverage audit, 2026-09-08 (third round): same
  // assertions the v1-schema (pre-agreementAt) file made, re-targeted at
  // the current v2 (agreementAt-scoped) API.
  check('CONTRACT_READY_ITEM_KEYS has exactly five keys, matching the page\'s own CONTRACT_CHECKLIST_ITEMS', CONTRACT_READY_ITEM_KEYS.length, 5);
  check('contract ready: a DIFFERENT property address (even same Agreement at) reads back as no progress', currentContractReadyChecklistForOpportunity(
    [{ body: sameAgreementNewer }], 'opp-1', args.agreementAt, args.agreedPrice, 'Some Other Address',
  ), null);
  check('contract ready: a non-boolean item value is refused', parseContractReadyChecklistNote(note.replace('"legal_owners":true', '"legal_owners":"yes"')), null);
  check('contract ready: an item missing a key is refused', parseContractReadyChecklistNote(note.replace(JSON.stringify(someTrue), JSON.stringify({ legal_owners: true }))), null);
  check('contract ready: extra line refused', parseContractReadyChecklistNote(note + '\nExtra: line'), null);
  check('contract ready: garbage body refused', parseContractReadyChecklistNote('not a note'), null);
  check('contract ready: malformed items JSON refused', parseContractReadyChecklistNote(note.replace(JSON.stringify(someTrue), '{not json')), null);
  check('contract ready: missing address refused', parseContractReadyChecklistNote(formatContractReadyChecklistNote(Object.assign({}, args, { propertyAddress: '' }))), null);
  check('contract ready: missing opportunity refused', parseContractReadyChecklistNote(formatContractReadyChecklistNote(Object.assign({}, args, { opportunityId: '' }))), null);
  check('contract ready: non-canonical Recorded-at timestamp refused (distinct from Agreement at)', parseContractReadyChecklistNote(note.replace(args.at, '2026-09-08')), null);
  check('contract ready: scoped to opportunity', currentContractReadyChecklistForOpportunity(
    [{ body: formatContractReadyChecklistNote(Object.assign({}, args, { opportunityId: 'opp-2' })) }], 'opp-1', args.agreementAt, args.agreedPrice, args.propertyAddress,
  ), null);
  check('contract ready: zero agreed price refused', parseContractReadyChecklistNote(formatContractReadyChecklistNote(Object.assign({}, args, { agreedPrice: 0 }))), null);

  // Latest-by-embedded-timestamp wins, NOT list order -- list deliberately
  // out of timestamp order, all three notes sharing the SAME agreementAt.
  const outOfOrderCR = [{ body: sameAgreementNewer }, { body: sameAgreementOlder }];
  check('contract ready: latest-by-embedded-timestamp wins, not list order', currentContractReadyChecklistForOpportunity(
    outOfOrderCR, 'opp-1', args.agreementAt, args.agreedPrice, args.propertyAddress,
  ).items, someTrue);
}

// ============================================================
// Structural: no GHL/network surface, no dependency on any other engine.
// ============================================================
{
  const src = fs.readFileSync(SOURCE, 'utf8');
  check('source contains no network/GHL surface', /fetch\(|leadconnectorhq|XMLHttpRequest/.test(src), false);
  check('source imports nothing (fully self-contained)', /^import /m.test(src), false);
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
