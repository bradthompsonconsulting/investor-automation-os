/**
 * B14-13 Seller Call autosave (Brad + Jess, 2026-10-10) -- server-side ledger checks.
 *
 * Offline. Loads the REAL server note guard (netlify/functions/lib/write-note-guard.ts) and the REAL Production
 * note scope through the TypeScript loader, with a fake GHL boundary; nothing leaves the process. The local fixture
 * server used for live Seller Call tests does not run this guard, so fixture success alone proves nothing here.
 *
 * Proves, for the two autosave carriers (both written with the existing note.create):
 *   - Seller Position (its own opportunity-scoped note, value or cleared): accepted for an opportunity this contact
 *     owns; refused for another contact's opportunity, a foreign operator, a malformed identifier and every
 *     malformed body (the guard refuses any unparsed "IAOS SELLER ..." note); never confused with the Seller price
 *     position readiness note or a conversation outcome.
 *   - Transaction assumptions v2: a partial record ("not yet answered") is accepted and stays incomplete for
 *     readiness; a blank item is refused, never read as None; v1 is still read and accepted; the same opportunity
 *     isolation applies.
 *   - Each body is recognized by exactly one registered parser, the expected one.
 *   - Production refuses both carriers (the handler-level refusal is in test-production-write-scope.cjs).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.IAOS_ENV = 'test';
require('./harness/ts-loader.cjs');

const APP = path.resolve(__dirname, '..');
const load = (n) => require(path.join(APP, 'src', 'lib', n + '.ts'));
const SP = load('seller-call-seller-position-note');
const TA = load('seller-call-readiness-carriers');
const outcome = load('seller-call-outcome');
const { validateLedgerNote } = require(path.join(APP, 'netlify/functions/lib/write-note-guard.ts'));
const scopeLib = require(path.join(APP, 'netlify/functions/lib/production-write-scope.ts'));

let checks = 0;
let failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (e) { failures += 1; console.error(`FAIL  ${name}\n      ${e && e.message}`); }
}

const CONTACT = 'fixture-contact';
const OTHER_CONTACT = 'fixture-other-contact';
const OPP = 'fixture-opportunity';
const OTHER_OPP = 'fixture-opportunity-of-another-contact';
const AT = '2026-10-10T15:00:00.000Z';
/** Fake boundary: OPP belongs to CONTACT, OTHER_OPP to OTHER_CONTACT; anything else does not exist. */
const opportunityReads = [];
const boundary = {
  opportunity: async (id) => {
    opportunityReads.push(id);
    if (id === OPP) return { id, contactId: CONTACT, customFields: [] };
    if (id === OTHER_OPP) return { id, contactId: OTHER_CONTACT, customFields: [] };
    throw new Error('Opportunity not found');
  },
  notes: async () => [],
};
const guard = (body, contact = CONTACT) => validateLedgerNote(boundary, contact, body, 'brad@example.invalid');
const accepted = async (body, contact) => { await guard(body, contact); };
const refused = async (body, pattern, contact) => { await assert.rejects(guard(body, contact), pattern); };

const sp = (over = {}) => SP.formatSellerPositionNote({ opportunityId: OPP, at: AT, operator: null, kind: 'value', value: 245000, ...over });
const spCleared = (over = {}) => SP.formatSellerPositionNote({ opportunityId: OPP, at: AT, operator: null, kind: 'cleared', ...over });
const ta2 = (over = {}) => TA.formatTransactionAssumptionsNoteV2({ opportunityId: OPP, at: AT, operator: null,
  transactionStructure: { kind: 'value', value: 'Cash' }, closingPossession: { kind: 'unanswered' }, titleComplications: { kind: 'unanswered' }, ...over });
const ta2Complete = (over = {}) => ta2({ closingPossession: { kind: 'none' }, titleComplications: { kind: 'value', value: 'Lien to clear at closing' }, ...over });
const ta1 = (over = {}) => TA.formatTransactionAssumptionsNote({ opportunityId: OPP, at: AT, operator: null,
  transactionStructure: { kind: 'value', value: 'Cash' }, closingPossession: { kind: 'none' }, titleComplications: { kind: 'none' }, ...over });
/** Replace one line of a well-formed body (index 0 is the header). */
const withLine = (body, index, line) => body.split('\n').map((l, i) => (i === index ? line : l)).join('\n');

(async () => {
  // ── Seller Position: accepted only for the owner's opportunity ─────────────────────────────────────────
  await check('Seller Position value: accepted for an opportunity this contact owns (opportunity looked up)', async () => {
    opportunityReads.length = 0;
    await accepted(sp());
    assert.deepEqual(opportunityReads, [OPP]);
  });
  await check('Seller Position cleared: accepted for an opportunity this contact owns', () => accepted(spCleared()));
  await check('Seller Position decimal value (as the page accepts) and the "brad" operator: accepted', async () => {
    await accepted(sp({ value: 245000.5 }));
    await accepted(sp({ operator: 'brad' }));
  });
  await check('Seller Position for ANOTHER contact\'s opportunity: refused (wrong-seller write)', () =>
    refused(sp({ opportunityId: OTHER_OPP }), /belongs to another contact/));
  await check('Seller Position cleared for another contact\'s opportunity: refused', () =>
    refused(spCleared({ opportunityId: OTHER_OPP }), /belongs to another contact/));
  await check('Seller Position for an opportunity that does not exist: refused', () =>
    refused(sp({ opportunityId: 'no-such-opportunity' }), /not found/));
  await check('Seller Position with a malformed opportunity identifier: refused before any lookup', async () => {
    opportunityReads.length = 0;
    await assert.rejects(guard(withLine(sp(), 3, 'Opportunity: has/slash')));
    assert.deepEqual(opportunityReads, []);
  });
  await check('Seller Position naming a foreign operator: refused', () =>
    refused(withLine(sp(), 2, 'Operator: someone-else'), /Malformed or undeclared ledger note|operator/));

  // ── Seller Position: every malformed body is refused, never stored as a plain note ─────────────────────
  const malformedSp = {
    'blank value': withLine(sp(), 4, 'Seller Position: '),
    '"None"': withLine(sp(), 4, 'Seller Position: None'),
    'zero': withLine(sp(), 4, 'Seller Position: 0'),
    'negative': withLine(sp(), 4, 'Seller Position: -245000'),
    'exponent form': withLine(sp(), 4, 'Seller Position: 2.45e5'),
    'dollar sign and comma': withLine(sp(), 4, 'Seller Position: $245,000'),
    'text': withLine(sp(), 4, 'Seller Position: about two fifty'),
    'non-canonical timestamp': withLine(sp(), 1, 'Recorded at: 2026-10-10 15:00'),
    'empty opportunity': withLine(sp(), 3, 'Opportunity: '),
    'extra line': sp() + '\nNote: extra',
    'missing line': sp().split('\n').slice(0, 4).join('\n'),
    'duplicated value line': sp() + '\nSeller Position: 250000',
    'wrong version token': sp().replace('iaos-seller-position-v1', 'iaos-seller-position-v2'),
  };
  for (const [label, body] of Object.entries(malformedSp)) {
    await check(`Seller Position malformed (${label}): refused as a malformed ledger note`, async () => {
      assert.equal(SP.parseSellerPositionNote(body), null, 'the parser refuses it');
      await refused(body, /Malformed or undeclared ledger note/);
    });
  }

  // ── Transaction assumptions v2: partial accepted, still incomplete; blank never becomes None ───────────
  await check('Transaction assumptions v2 partial: accepted for the owner\'s opportunity', () => accepted(ta2()));
  await check('Transaction assumptions v2 partial: parsed as unanswered (not None) and incomplete for readiness', () => {
    const r = TA.parseTransactionAssumptionsNote(ta2());
    assert.equal(r.version, 2); assert.equal(r.complete, false);
    assert.deepEqual([r.closingPossession, r.titleComplications], [{ kind: 'unanswered' }, { kind: 'unanswered' }]);
    assert.equal(TA.completeTransactionAssumptions(r), null);
  });
  await check('Transaction assumptions v2 all unanswered: accepted and incomplete', async () => {
    const body = ta2({ transactionStructure: { kind: 'unanswered' } });
    await accepted(body);
    assert.equal(TA.parseTransactionAssumptionsNote(body).complete, false);
  });
  await check('Transaction assumptions v2 complete: accepted and complete', async () => {
    await accepted(ta2Complete());
    assert.equal(TA.parseTransactionAssumptionsNote(ta2Complete()).complete, true);
  });
  await check('Transaction assumptions v2 for ANOTHER contact\'s opportunity: refused', () =>
    refused(ta2({ opportunityId: OTHER_OPP }), /belongs to another contact/));
  await check('Transaction assumptions v2 with a BLANK item: refused (blank is never read as None)', async () => {
    const body = withLine(ta2(), 5, 'Closing/possession expectations: ');
    assert.equal(TA.parseTransactionAssumptionsNote(body), null);
    await refused(body, /Malformed or undeclared ledger note/);
  });
  await check('Transaction assumptions v1 carrying "(not yet answered)": refused', async () => {
    const body = withLine(ta1(), 5, 'Closing/possession expectations: (not yet answered)');
    assert.equal(TA.parseTransactionAssumptionsNote(body), null);
    await refused(body, /Malformed or undeclared ledger note/);
  });
  await check('Transaction assumptions v1 (existing records): still read, complete, and accepted', async () => {
    const r = TA.parseTransactionAssumptionsNote(ta1());
    assert.equal(r.version, 1); assert.equal(r.complete, true);
    await accepted(ta1());
  });
  await check('Transaction assumptions v1 for another contact\'s opportunity: still refused', () =>
    refused(ta1({ opportunityId: OTHER_OPP }), /belongs to another contact/));

  // ── Exactly one registered parser recognizes each body (no cross-reading between ledgers) ──────────────
  const snapshot = { sellerPosition: 250000, currentOffer: 190000, targetAcquisitionPrice: 169551, maxSupportedOffer: 176363,
    expectedSpread: 5000, arv: 315000, repairs: 41000, readinessStatus: 'REVIEW_NEEDED' };
  const outcomeBody = outcome.formatOutcomeNote({ opportunityId: OPP, kind: 'pass', at: AT, operator: null, snapshot, reason: 'fixture', followUpAt: null });
  const pricePositionBody = TA.formatSellerPricePositionNote({ opportunityId: OPP, at: AT, operator: null, kind: 'price', price: 245000 });
  const expected = [
    ['Seller Position value', sp(), 'parseSellerPositionNote'],
    ['Seller Position cleared', spCleared(), 'parseSellerPositionNote'],
    ['Transaction assumptions v2 partial', ta2(), 'parseTransactionAssumptionsNote'],
    ['Transaction assumptions v2 complete', ta2Complete(), 'parseTransactionAssumptionsNote'],
    ['Transaction assumptions v1', ta1(), 'parseTransactionAssumptionsNote'],
    ['conversation outcome (Pass)', outcomeBody, 'parseOutcomeNote'],
    ['Seller price position (readiness), same price', pricePositionBody, 'parseSellerPricePositionNote'],
  ];
  for (const [label, body, parserName] of expected) {
    await check(`${label}: recognized by exactly one registered parser, ${parserName}`, () => {
      const hits = scopeLib.PRODUCTION_NOTE_SCOPE.filter((e) => { try { return Boolean(e.parse(body)); } catch { return false; } }).map((e) => e.parse.name);
      assert.deepEqual(hits, [parserName]);
    });
  }

  // ── Production refuses both carriers (pure classifier; handler-level in test-production-write-scope.cjs) ─
  await check('Production scope: Seller Position and Transaction assumptions are refused kinds (allow: null)', () => {
    for (const name of ['parseSellerPositionNote', 'parseTransactionAssumptionsNote']) {
      const entry = scopeLib.PRODUCTION_NOTE_SCOPE.find((e) => e.parse.name === name);
      assert.ok(entry, name); assert.equal(entry.allow, null, name);
    }
  });

  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
