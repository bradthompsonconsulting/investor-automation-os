/**
 * B14-12 / INV-94 (Jess ruling, 2026-10-02) — Seller Call outcome ledger
 * operator wording.
 *
 * Offline. Loads the real outcome module and the real server note guard
 * (write-note-guard.ts) through a TypeScript require hook, with a fake GHL
 * boundary; nothing leaves the process. Proves:
 *   - a note that names no operator says so in operator-neutral words,
 *   - those words and the legacy `UNAVAILABLE` both read back as `null`,
 *   - the unchanged server guard accepts both and still refuses a foreign
 *     operator,
 *   - Seller Call still passes no operator (nothing hard-coded).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

const outcome = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const { validateLedgerNote } = require(path.join(APP, 'netlify/functions/lib/write-note-guard.ts'));

let checks = 0;
let failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (e) { failures += 1; console.error(`FAIL  ${name}\n      ${e && e.message}`); }
}

const CONTACT = 'fixture-contact';
const OPP = 'fixture-opportunity';
const snapshot = {
  sellerPosition: 250000, currentOffer: 190000, targetAcquisitionPrice: 169551, maxSupportedOffer: 176363,
  expectedSpread: 5000, arv: 315000, repairs: 41000, readinessStatus: 'REVIEW_NEEDED',
};
const passNote = (operator) => outcome.formatOutcomeNote({
  opportunityId: OPP, kind: 'pass', at: '2026-10-02T15:00:00.000Z', operator, snapshot,
  reason: '14-12 offline fixture', followUpAt: null,
});
const followUpNote = (operator) => outcome.formatOutcomeNote({
  opportunityId: OPP, kind: 'follow_up', at: '2026-10-02T14:00:00.000Z', operator, snapshot,
  reason: null, followUpAt: '2026-10-06T15:00:00.000Z',
});
const operatorLine = (body) => body.split('\n').find((l) => l.startsWith('Operator: '));
const boundary = {
  opportunity: async (id) => ({ id, contactId: CONTACT, customFields: [] }),
  notes: async () => [],
};

(async () => {
  // ── The wording ─────────────────────────────────────────────────────────
  await check('exact operator-neutral wording', () =>
    assert.equal(outcome.OPERATOR_NOT_RECORDED, 'Not recorded (saved through IAOS write sign-in)'));
  await check('a Pass with no operator writes the neutral line, not UNAVAILABLE', () =>
    assert.equal(operatorLine(passNote(null)), 'Operator: Not recorded (saved through IAOS write sign-in)'));
  await check('a Follow-Up with no operator writes the neutral line', () =>
    assert.equal(operatorLine(followUpNote(null)), 'Operator: Not recorded (saved through IAOS write sign-in)'));
  await check('an empty operator is treated as none', () =>
    assert.equal(operatorLine(passNote('')), 'Operator: Not recorded (saved through IAOS write sign-in)'));
  await check('the neutral line names no person', () =>
    assert.equal(/brad/i.test(outcome.OPERATOR_NOT_RECORDED), false));
  await check('other UNAVAILABLE fields are unchanged (only the operator line moved)', () => {
    const body = outcome.formatOutcomeNote({
      opportunityId: OPP, kind: 'pass', at: '2026-10-02T15:00:00.000Z', operator: null,
      snapshot: { ...snapshot, targetAcquisitionPrice: null }, reason: 'x', followUpAt: null,
    });
    assert.ok(body.includes('\nTarget Acquisition Price: UNAVAILABLE\n'));
    assert.ok(body.includes('\nFollow-up at: UNAVAILABLE'));
  });

  // ── The parser ──────────────────────────────────────────────────────────
  await check('new Pass note parses; operator reads back null', () => {
    const p = outcome.parseOutcomeNote(passNote(null));
    assert.ok(p); assert.equal(p.kind, 'pass'); assert.equal(p.operator, null); assert.equal(p.reason, '14-12 offline fixture');
  });
  await check('new Follow-Up note parses; operator null, follow-up time kept', () => {
    const p = outcome.parseOutcomeNote(followUpNote(null));
    assert.ok(p); assert.equal(p.operator, null); assert.equal(p.followUpAt, '2026-10-06T15:00:00.000Z');
  });
  const legacyPass = passNote(null).replace(/^Operator: .*$/m, 'Operator: UNAVAILABLE');
  await check('legacy note (Operator: UNAVAILABLE, as in the P2/P3 Test notes) still parses; operator null', () => {
    assert.equal(operatorLine(legacyPass), 'Operator: UNAVAILABLE');
    const p = outcome.parseOutcomeNote(legacyPass);
    assert.ok(p); assert.equal(p.operator, null); assert.equal(p.kind, 'pass');
  });
  await check('latest-outcome selection treats old and new notes alike', () => {
    const latest = outcome.latestOutcomeNoteForOpportunity([{ body: legacyPass }, { body: followUpNote(null) }], OPP);
    assert.equal(latest.kind, 'pass');
  });
  await check('parser still fails closed on a malformed numeric field', () =>
    assert.equal(outcome.parseOutcomeNote(passNote(null).replace('ARV: 315000', 'ARV: lots')), null));

  // ── The unchanged server guard ──────────────────────────────────────────
  await check('guard accepts a new Pass note (no operator named)', () =>
    validateLedgerNote(boundary, CONTACT, passNote(null), 'brad@example.invalid'));
  await check('guard accepts a new Follow-Up note (no operator named)', () =>
    validateLedgerNote(boundary, CONTACT, followUpNote(null), 'brad@example.invalid'));
  await check('guard still accepts a legacy UNAVAILABLE note', () =>
    validateLedgerNote(boundary, CONTACT, legacyPass, 'brad@example.invalid'));
  await check('guard still refuses a note naming any other operator', () =>
    assert.rejects(validateLedgerNote(boundary, CONTACT, passNote('someone@example.invalid'), 'brad@example.invalid'),
      /Ledger operator does not match authenticated Brad/));
  await check('guard still refuses an outcome note for another contact\'s opportunity', () =>
    assert.rejects(validateLedgerNote({ ...boundary, opportunity: async (id) => ({ id, contactId: 'other', customFields: [] }) },
      CONTACT, passNote(null), 'brad@example.invalid'), /another contact/));

  // ── Seller Call wiring: still no operator claimed ───────────────────────
  const sellerCall = fs.readFileSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const record = (sellerCall.match(/async function handleRecordOutcome[\s\S]*?const attempt = attemptRecordOutcome\(\{([\s\S]*?)\}\);/) || [])[1] || '';
  await check('handleRecordOutcome located', () => assert.ok(record.length > 0));
  await check('Seller Call outcome passes operator: null (no hard-coded identity)', () => {
    assert.match(record, /\boperator: null,/);
    assert.doesNotMatch(record, /operator: "brad"|operator: 'brad'/);
  });

  console.log(`\nB14-12 call-outcome ledger: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
