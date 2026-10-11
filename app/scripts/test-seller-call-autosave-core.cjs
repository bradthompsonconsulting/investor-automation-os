/**
 * Board 14-13 Seller Call autosave: the pure pieces, no browser.
 *
 *   1. Seller Position ledger (`seller-call-seller-position-note.ts`, Brad 2026-10-10): format/parse,
 *      cleared state, latest-wins per opportunity, and no cross-parsing with the other Seller Call ledgers.
 *   2. Transaction assumptions v2 (`seller-call-readiness-carriers.ts`, Jess 2026-10-10): explicit
 *      "not yet answered", blank never None, v1 still read, a newer partial never falls back to an older
 *      complete record, opportunity isolation.
 *   3. The autosave coordinator (`seller-call-autosave.ts`): no write for an unchanged value, saves in
 *      order per record with the latest text winning, failure keeps the status and retries, and one
 *      record's late answer never changes another record's status.
 *
 * Compiles the three modules (and the outcome module, for the cross-parse check) with tsc into a temp
 * folder, then runs plain checks. Exit 0 only when every check passes and the count equals FLOOR.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-seller-call-autosave-core-test');
const LIB = path.join(APP, 'src', 'lib');
/** Taken from the finished file, never back-filled from a passing run: one per check() call site. */
const FLOOR = 43;

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
const SOURCES = ['seller-call-seller-position-note.ts', 'seller-call-readiness-carriers.ts', 'seller-call-autosave.ts', 'seller-call-outcome.ts']
  .map((f) => '"' + path.join(LIB, f) + '"').join(' ');
try {
  execSync('npx tsc ' + SOURCES + ' --outDir "' + TMP + '" --module commonjs --target es2020 --strict --removeComments --skipLibCheck', { cwd: APP, stdio: 'inherit' });
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}
const load = (name) => {
  const direct = path.join(TMP, name);
  const nested = path.join(TMP, 'src', 'lib', name);
  return require(fs.existsSync(direct) ? direct : nested);
};
const sp = load('seller-call-seller-position-note.js');
const rc = load('seller-call-readiness-carriers.js');
const as = load('seller-call-autosave.js');
const oc = load('seller-call-outcome.js');

let checks = 0; let failures = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  checks += 1;
  if (same(actual, expected)) console.log('PASS  ' + name);
  else { failures += 1; console.log('FAIL  ' + name + '  expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual)); }
}
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

async function main() {
  // ═══ 1. Seller Position ledger ═════════════════════════════════════════════
  {
    const at = '2026-10-10T15:00:00.000Z';
    const v = sp.formatSellerPositionNote({ opportunityId: 'opp-1', at, operator: null, kind: 'value', value: 245000 });
    check('Seller Position: the exact note text', v,
      'IAOS SELLER POSITION — iaos-seller-position-v1\nRecorded at: 2026-10-10T15:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\nSeller Position: 245000');
    check('Seller Position: a value round-trips', sp.parseSellerPositionNote(v), { opportunityId: 'opp-1', at, operator: null, kind: 'value', value: 245000 });
    const cleared = sp.formatSellerPositionNote({ opportunityId: 'opp-1', at, operator: null, kind: 'cleared' });
    check('Seller Position: cleared round-trips', sp.parseSellerPositionNote(cleared), { opportunityId: 'opp-1', at, operator: null, kind: 'cleared' });
    check('Seller Position: a decimal amount round-trips (the page parser allows one)',
      sp.parseSellerPositionNote(sp.formatSellerPositionNote({ opportunityId: 'opp-1', at, operator: 'brad', kind: 'value', value: 245000.5 })),
      { opportunityId: 'opp-1', at, operator: 'brad', kind: 'value', value: 245000.5 });
    check('Seller Position: format refuses zero, negative, non-finite and exponent-form values',
      [0, -5, Infinity, NaN, 1e21].map((value) => throws(() => sp.formatSellerPositionNote({ opportunityId: 'opp-1', at, operator: null, kind: 'value', value }))),
      [true, true, true, true, true]);
    const bad = (line) => sp.parseSellerPositionNote(v.replace('Seller Position: 245000', line));
    check('Seller Position: blank, None, text, negative, zero, exponent and $ forms are refused',
      ['Seller Position: ', 'Seller Position: None', 'Seller Position: abc', 'Seller Position: -5', 'Seller Position: 0', 'Seller Position: 1e5', 'Seller Position: $245,000'].map(bad),
      [null, null, null, null, null, null, null]);
    check('Seller Position: extra line, missing opportunity, bad timestamp and wrong header are refused',
      [v + '\nExtra: line', v.replace('Opportunity: opp-1', 'Opportunity: '), v.replace(at, '2026-10-10'), v.replace('iaos-seller-position-v1', 'iaos-seller-position-v2')].map(sp.parseSellerPositionNote),
      [null, null, null, null]);
    const older = sp.formatSellerPositionNote({ opportunityId: 'opp-1', at: '2026-10-10T14:00:00.000Z', operator: null, kind: 'value', value: 200000 });
    const other = sp.formatSellerPositionNote({ opportunityId: 'opp-2', at: '2026-10-10T16:00:00.000Z', operator: null, kind: 'value', value: 999 });
    check('Seller Position: latest by embedded timestamp wins, whatever the list order', sp.latestSellerPositionForOpportunity([{ body: v }, { body: older }], 'opp-1').value, 245000);
    check('Seller Position: a later clear wins over an earlier value', sp.latestSellerPositionForOpportunity([{ body: older }, { body: cleared.replace(at, '2026-10-10T17:00:00.000Z') }], 'opp-1').kind, 'cleared');
    check('Seller Position: scoped to one opportunity', [sp.latestSellerPositionForOpportunity([{ body: other }], 'opp-1'), sp.latestSellerPositionForOpportunity([{ body: other }, { body: v }], 'opp-2').value], [null, 999]);
    // No cross-parsing with the other Seller Call ledgers.
    const price = rc.formatSellerPricePositionNote({ opportunityId: 'opp-1', at, operator: null, kind: 'price', price: 245000 });
    const taV2 = rc.formatTransactionAssumptionsNoteV2({ opportunityId: 'opp-1', at, operator: null, transactionStructure: { kind: 'unanswered' }, closingPossession: { kind: 'none' }, titleComplications: { kind: 'unanswered' } });
    check('Seller Position never parses as Seller price position, transaction assumptions or an outcome, and the reverse',
      [rc.parseSellerPricePositionNote(v), rc.parseTransactionAssumptionsNote(v), oc.parseOutcomeNote(v), sp.parseSellerPositionNote(price), sp.parseSellerPositionNote(taV2)],
      [null, null, null, null, null]);
    check('the Seller Position header does not start like the Seller price position header', /^IAOS SELLER PRICE/.test(v), false);
  }

  // ═══ 2. Transaction assumptions v2 ════════════════════════════════════════
  {
    const at = '2026-10-10T15:00:00.000Z';
    const U = { kind: 'unanswered' }; const N = { kind: 'none' }; const V = (value) => ({ kind: 'value', value });
    const partial = { opportunityId: 'opp-1', at, operator: null, transactionStructure: V('Standard assignment'), closingPossession: U, titleComplications: U };
    const note = rc.formatTransactionAssumptionsNoteV2(partial);
    check('TA v2: the exact partial note text', note,
      'IAOS TRANSACTION ASSUMPTIONS — iaos-transaction-assumptions-v2\nRecorded at: 2026-10-10T15:00:00.000Z\nOperator: UNAVAILABLE\nOpportunity: opp-1\n'
      + 'Transaction structure: Standard assignment\nClosing/possession expectations: (not yet answered)\nTitle complications: (not yet answered)');
    check('TA v2: a partial record round-trips, version 2, not complete', rc.parseTransactionAssumptionsNote(note), Object.assign({ version: 2 }, partial, { complete: false }));
    const full = Object.assign({}, partial, { closingPossession: V('Close in 21 days'), titleComplications: N });
    check('TA v2: a fully answered record (value or None for each) is complete', rc.parseTransactionAssumptionsNote(rc.formatTransactionAssumptionsNoteV2(full)).complete, true);
    check('TA v2: all three not yet answered is a valid (empty) record, not complete',
      rc.parseTransactionAssumptionsNote(rc.formatTransactionAssumptionsNoteV2(Object.assign({}, partial, { transactionStructure: U }))).complete, false);
    check('TA v2: a genuinely blank line is still refused (blank never becomes None or "not yet answered")',
      rc.parseTransactionAssumptionsNote(note.replace('Transaction structure: Standard assignment', 'Transaction structure: ')), null);
    check('TA v2: blank or reserved text cannot be formatted as a value',
      ['', '   ', '(none — explicitly marked)', '(not yet answered)', 'two\nlines'].map((t) => throws(() => rc.formatTransactionAssumptionsNoteV2(Object.assign({}, partial, { transactionStructure: V(t) })))),
      [true, true, true, true, true]);
    check('TA v2: the reserved-text test matches only the two markers', ['(none — explicitly marked)', ' (not yet answered) ', 'not yet answered', 'None'].map(rc.isReservedTransactionAssumptionText), [true, true, false, false]);
    const v1 = rc.formatTransactionAssumptionsNote({ opportunityId: 'opp-1', at: '2026-10-01T00:00:00.000Z', operator: null, transactionStructure: V('Old'), closingPossession: N, titleComplications: N });
    check('TA v1 is still read: version 1, complete', [rc.parseTransactionAssumptionsNote(v1).version, rc.parseTransactionAssumptionsNote(v1).complete], [1, true]);
    check('TA v1 never accepts the v2 "not yet answered" marker', rc.parseTransactionAssumptionsNote(v1.replace('Transaction structure: Old', 'Transaction structure: (not yet answered)')), null);
    check('TA v1 format still refuses "not yet answered" (v1 cannot carry it)',
      throws(() => rc.formatTransactionAssumptionsNote({ opportunityId: 'opp-1', at, operator: null, transactionStructure: U, closingPossession: N, titleComplications: N })), true);
    const latest = rc.latestTransactionAssumptionsForOpportunity([{ body: v1 }, { body: note }], 'opp-1');
    check('TA: a newer partial v2 record wins over an older complete v1 record', [latest.version, latest.complete], [2, false]);
    check('TA: readiness gets nothing from a newer partial record (no fall-back to the older complete one)', rc.completeTransactionAssumptions(latest), null);
    const completedLater = rc.formatTransactionAssumptionsNoteV2(Object.assign({}, full, { at: '2026-10-10T16:00:00.000Z' }));
    check('TA: once completed later, readiness gets that record\'s three items',
      rc.completeTransactionAssumptions(rc.latestTransactionAssumptionsForOpportunity([{ body: v1 }, { body: note }, { body: completedLater }], 'opp-1')),
      { structure: V('Standard assignment'), closing: V('Close in 21 days'), title: N });
    const clearedLater = rc.formatTransactionAssumptionsNoteV2(Object.assign({}, full, { at: '2026-10-10T17:00:00.000Z', closingPossession: U }));
    check('TA: clearing a value later makes the record incomplete again, and readiness gets nothing',
      [rc.latestTransactionAssumptionsForOpportunity([{ body: completedLater }, { body: clearedLater }], 'opp-1').closingPossession,
        rc.completeTransactionAssumptions(rc.latestTransactionAssumptionsForOpportunity([{ body: completedLater }, { body: clearedLater }], 'opp-1'))],
      [U, null]);
    const otherOpp = rc.formatTransactionAssumptionsNoteV2(Object.assign({}, full, { opportunityId: 'opp-2', at: '2026-10-10T18:00:00.000Z' }));
    check('TA: opportunity isolation (another opportunity\'s newer record is never read)',
      rc.latestTransactionAssumptionsForOpportunity([{ body: note }, { body: otherOpp }], 'opp-1').at, at);
    check('TA v2: wrong version token refused', rc.parseTransactionAssumptionsNote(note.replace('iaos-transaction-assumptions-v2', 'iaos-transaction-assumptions-v3')), null);
  }

  // ═══ 3. Autosave coordinator ══════════════════════════════════════════════
  {
    const A = { contactId: 'cA', opportunityId: 'oA', section: 'seller-position' };
    const B = { contactId: 'cB', opportunityId: 'oB', section: 'seller-position' };
    const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
    let changes = 0;
    const c = new as.AutosaveCoordinator(() => { changes += 1; });
    c.seed(A, '100');
    const writes = [];
    await c.request(A, '100', async () => { writes.push('100'); });
    check('coordinator: leaving an unchanged field writes nothing', [writes, c.status(A).kind, c.isDirty(A, '100')], [[], 'idle', false]);
    check('coordinator: a changed value is dirty before saving', c.isDirty(A, '150'), true);
    await c.request(A, '150', async () => { writes.push('150'); });
    check('coordinator: a changed value is written once and shows Saved', [writes, c.status(A).kind, c.isDirty(A, '150')], [['150'], 'saved', false]);
    await c.request(A, '150', async () => { writes.push('dup'); });
    check('coordinator: the same value again (blur then Enter) writes nothing more', writes, ['150']);

    // In order, latest text wins: three requests while the first is in flight -> first, then only the last.
    const d1 = deferred(); const order = [];
    const p1 = c.request(A, '200', async () => { order.push('200:start'); await d1.promise; order.push('200:end'); });
    check('coordinator: status is Saving while a write is in flight', c.status(A).kind, 'saving');
    c.request(A, '210', async () => { order.push('210'); });
    const p3 = c.request(A, '220', async () => { order.push('220'); });
    d1.resolve();
    await p1; await p3;
    check('coordinator: saves for one record run one at a time, and only the latest queued text follows', order, ['200:start', '200:end', '220']);
    check('coordinator: after the queue drains the latest text is on record', [c.status(A).kind, c.isDirty(A, '220')], ['saved', false]);

    // Failure keeps the error and is retried by the next request.
    await c.request(A, '300', async () => { throw new Error('Network down.'); });
    check('coordinator: a failed write shows the error and stays dirty (text kept by the page)', [c.status(A), c.isDirty(A, '300')], [{ kind: 'error', message: 'Network down.' }, true]);
    c.seed(A, '999');
    check('coordinator: readback does not overwrite the record of a failed save', c.isDirty(A, '300'), true);
    const retried = [];
    await c.request(A, '300', async () => { retried.push('300'); });
    check('coordinator: retrying the same text after a failure writes it (Save changes / blur / Enter)', [retried, c.status(A).kind], [['300'], 'saved']);

    // A late answer for one record never changes another record's status.
    const dA = deferred();
    const pA = c.request(A, '400', async () => { await dA.promise; });
    c.seed(B, '1');
    await c.request(B, '2', async () => {});
    check('coordinator: while A is still saving, B saved on its own', [c.status(A).kind, c.status(B).kind], ['saving', 'saved']);
    dA.reject(new Error('A failed late.'));
    await pA;
    check('coordinator: A\'s late failure is A\'s alone; B still shows Saved', [c.status(A).kind, c.status(B).kind], ['error', 'saved']);
    check('coordinator: keys never collide across contact, opportunity and section',
      new Set([as.autosaveKey(A), as.autosaveKey(B), as.autosaveKey(Object.assign({}, A, { section: 'transaction-assumptions' })), as.autosaveKey({ contactId: 'cA|oA', opportunityId: '', section: 'seller-position' })]).size, 4);
    check('coordinator: every status change was reported', changes > 0, true);
    // A queued request after a failure runs (newer text).
    const C = { contactId: 'cC', opportunityId: 'oC', section: 'x' };
    const dC = deferred(); const ran = [];
    const pC = c.request(C, 'a', async () => { await dC.promise; });
    c.request(C, 'b', async () => { ran.push('b'); });
    dC.reject(new Error('first failed'));
    await pC;
    check('coordinator: newer text queued behind a failed write is still written', [ran, c.status(C).kind], [['b'], 'saved']);
  }

  cleanup();
  console.log('');
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
  if (checks !== FLOOR) { console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '.'); process.exit(1); }
  if (failures) { console.log('FAILED'); process.exit(1); }
  console.log('OK');
}
main().catch((e) => { console.error(e); cleanup(); process.exit(1); });
