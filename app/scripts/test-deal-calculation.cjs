/**
 * B15-25 Phase 2 (INV-133) -- "Save Calculation to Deal": the Deal Calculation ledger carrier and its server
 * guard, offline. Jess RULING 2026-10-30, Captain approved P2-1..P2-5.
 *
 *   node scripts/test-deal-calculation.cjs                    the suite (exact FLOOR)
 *   node scripts/test-deal-calculation.cjs --mutate=<name>    a negative control: one named source change,
 *                                                             applied in memory only; the run must FAIL
 *
 * Carrier: positional v1 schema, fixed Status, whole-dollar amounts, latest-by-embedded-Saved per deal, the
 * basis reader both sides share, and the save rules (no silent overwrite, fresh Saved, basis and property
 * identity equal to fresh GHL). Separation: every existing approval / offer reader ignores the note, and exactly
 * one registered parser (this one, refused in Production) recognizes it. Guard: `validateLedgerNote` with a
 * recording fake boundary -- committed DISABLED in both environments is asserted first; only an in-memory copy
 * of the Test config is enabled. No network, no GHL, no Blob access.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');

const MUTATIONS = {
  'guard-skips-supersedes': { file: 'src/lib/deal-calculation-carrier.ts', from: '  if (c.supersedes !== latestSaved) return "newer_calculation_exists";\n', to: '' },
  'parser-ignores-status': { file: 'src/lib/deal-calculation-carrier.ts', from: ' || status !== DEAL_CALCULATION_STATUS', to: '' },
  'regex-without-deal': { file: 'netlify/functions/lib/write-note-guard.ts', from: '|ATTORNEY|DEAL)/', to: '|ATTORNEY)/' },
  'guard-skips-switch': { file: 'netlify/functions/lib/write-note-guard.ts', from: 'if (config.dealCalculationSave.enabled !== DEAL_CALCULATION_SAVE_ENABLED) throw new Error("Deal calculation saving is disabled");', to: '' },
};
const mutateArg = process.argv.find((a) => a.startsWith('--mutate='));
const mutation = mutateArg ? MUTATIONS[mutateArg.slice('--mutate='.length)] : null;
if (mutateArg && !mutation) { console.error('ABORT: unknown mutation ' + mutateArg + '; known: ' + Object.keys(MUTATIONS).join(', ')); process.exit(2); }
let mutationApplied = 0;

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => {
  let src = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  if (mutation && path.resolve(APP, mutation.file) === filename) {
    const n = src.split(mutation.from).length - 1;
    if (n !== 1) { console.error('ABORT: mutation anchor occurs ' + n + ' times in ' + mutation.file); process.exit(2); }
    src = src.replace(mutation.from, () => mutation.to); mutationApplied++;
  }
  module._compile(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
};

process.env.IAOS_ENV = 'test';
const dc = require('../src/lib/deal-calculation-carrier.ts');
const cfgLib = require('../shared/ghl-config.ts');
const rc = require('../src/lib/seller-call-readiness-carriers.ts');
const arvNote = require('../src/lib/arv-approval-note.ts');
const outcome = require('../src/lib/seller-call-outcome.ts');
const override = require('../src/lib/seller-call-negotiation-override-note.ts');
const sellerPosition = require('../src/lib/seller-call-seller-position-note.ts');
const scope = require('../netlify/functions/lib/production-write-scope.ts');
const { validateLedgerNote } = require('../netlify/functions/lib/write-note-guard.ts');

const FLOOR = 35;
let checks = 0, failures = 0;
async function check(name, fn) {
  checks++;
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name); console.log('      ' + String(e && e.message || e).split('\n')[0]); }
}

const OPP = 'oppAAAA0001', OTHER_OPP = 'oppBBBB0002', CONTACT = 'conAAAA0001';
const test = cfgLib.getConfig('test');
const IDS = { arv: test.opportunityFacts.arv, repairs: test.opportunityFacts.repairs, currentOffer: test.opportunityFacts.currentOffer };
const iso = (ms) => new Date(ms).toISOString();
const base = (over = {}) => ({
  opportunityId: OPP, saved: iso(Date.now()), operator: 'brad', supersedes: null, propertyIdentity: null,
  arvInput: 250000, repairsQuick: 30000, testPrice: 150000, assignmentMode: 'profit_share', manualAmount: null,
  basis: { arv: null, repairs: null, currentOffer: null }, ...over,
});
const bodyOf = (over) => dc.formatDealCalculationNote(base(over));
const swapLine = (body, label, value) => body.split('\n').map((l) => (l.startsWith(label + ':') ? (value === null ? null : label + ': ' + value) : l)).filter((l) => l !== null).join('\n');

(async () => {
  // ---------------- carrier ----------------
  await check('round trip: parse(format(x)) returns x', () => { const x = base(); assert.deepEqual(dc.parseDealCalculationNote(dc.formatDealCalculationNote(x)), x); });
  await check('blank amounts round-trip as null (an empty value after the label)', () => {
    const x = base({ arvInput: null, repairsQuick: null, testPrice: null, assignmentMode: 'manual', manualAmount: 7500 });
    const body = dc.formatDealCalculationNote(x); assert.ok(body.includes('\nARV input:\n')); assert.deepEqual(dc.parseDealCalculationNote(body), x);
  });
  await check('the header and version are exact (v2, a different kind, or a missing header -> null)', () => {
    const b = bodyOf();
    assert.equal(dc.parseDealCalculationNote(b.replace('iaos-deal-calculation-v1', 'iaos-deal-calculation-v2')), null);
    assert.equal(dc.parseDealCalculationNote(b.replace('IAOS DEAL CALCULATION', 'IAOS DEAL ESTIMATE')), null);
    assert.equal(dc.parseDealCalculationNote(b.split('\n').slice(1).join('\n')), null);
  });
  await check('every label is required: removing any one line -> null', () => {
    const lines = bodyOf().split('\n');
    for (let i = 1; i < lines.length; i++) assert.equal(dc.parseDealCalculationNote(lines.filter((_, j) => j !== i).join('\n')), null, 'line ' + i);
  });
  await check('label order is positional: swapping two lines -> null', () => {
    const lines = bodyOf().split('\n'); [lines[6], lines[7]] = [lines[7], lines[6]];
    assert.equal(dc.parseDealCalculationNote(lines.join('\n')), null);
  });
  await check('an extra line, CRLF line endings or a trailing space -> null', () => {
    const b = bodyOf();
    assert.equal(dc.parseDealCalculationNote(b + '\nExtra: x'), null);
    assert.equal(dc.parseDealCalculationNote(b.replace(/\n/g, '\r\n')), null);
    assert.equal(dc.parseDealCalculationNote(b.replace('Operator: brad', 'Operator: brad ')), null);
  });
  await check('Status is fixed "working calculation (not approved)"; any other value -> null', () => {
    for (const s of ['approved', 'working calculation (approved)', 'Working calculation (not approved)']) assert.equal(dc.parseDealCalculationNote(swapLine(bodyOf(), 'Status', s)), null, s);
  });
  await check('operator must be brad; anything else -> null', () => { assert.equal(dc.parseDealCalculationNote(swapLine(bodyOf(), 'Operator', 'someone')), null); });
  await check('amounts are whole dollars: negative, decimal, separators or text -> null', () => {
    for (const v of ['-1', '1.5', '1,000', '$100', 'abc', '01']) assert.equal(dc.parseDealCalculationNote(swapLine(bodyOf(), 'ARV input', v)), null, v);
  });
  await check('Supersedes must be earlier than Saved, a canonical ISO, or none', () => {
    const saved = iso(Date.now());
    assert.equal(dc.parseDealCalculationNote(bodyOf({ saved, supersedes: saved })), null);
    assert.equal(dc.parseDealCalculationNote(swapLine(bodyOf(), 'Supersedes', '2026-10-30')), null);
  });
  await check('format refuses invalid input (never emits a partial note)', () => {
    for (const over of [{ opportunityId: '../x' }, { operator: 'x' }, { arvInput: 1.5 }, { manualAmount: -1 }, { assignmentMode: 'max' }, { saved: 'now' }, { basis: { arv: -5, repairs: null, currentOffer: null } }]) {
      assert.throws(() => dc.formatDealCalculationNote(base(over)), undefined, JSON.stringify(over));
    }
  });
  await check('latest is by embedded Saved, scoped to one deal; malformed and other-deal notes are ignored', () => {
    const t = Date.now();
    const a = bodyOf({ saved: iso(t - 3000) }), b = bodyOf({ saved: iso(t - 1000), supersedes: iso(t - 3000) }), other = bodyOf({ opportunityId: OTHER_OPP, saved: iso(t) });
    const notes = [{ body: b }, { body: 'IAOS DEAL CALCULATION — junk' }, { body: other }, { body: a }];
    assert.equal(dc.latestDealCalculationForOpportunity(notes, OPP).saved, iso(t - 1000));
    assert.deepEqual(dc.calculationsForOpportunity(notes, OPP).map((c) => c.saved), [iso(t - 1000), iso(t - 3000)]);
  });
  await check('basis reader: absent or empty -> null; numeric string -> number; non-numeric or duplicate -> throws', () => {
    assert.deepEqual(dc.basisFromOpportunityFields([], IDS), { arv: null, repairs: null, currentOffer: null });
    assert.deepEqual(dc.basisFromOpportunityFields([{ id: IDS.arv, fieldValue: '250000' }, { id: IDS.repairs, fieldValue: '' }, { id: IDS.currentOffer, fieldValue: 145000 }], IDS), { arv: 250000, repairs: null, currentOffer: 145000 });
    assert.throws(() => dc.basisFromOpportunityFields([{ id: IDS.arv, fieldValue: 'lots' }], IDS));
    assert.throws(() => dc.basisFromOpportunityFields([{ id: IDS.arv, fieldValue: 1 }, { id: IDS.arv, fieldValue: 2 }], IDS));
  });
  const fresh = (over = {}) => ({ latest: null, basis: { arv: null, repairs: null, currentOffer: null }, propertyIdentity: null, nowMs: Date.now(), ...over });
  await check('save rule: Supersedes must equal the latest saved calculation (else newer_calculation_exists)', () => {
    const t = Date.now(); const latest = dc.parseDealCalculationNote(bodyOf({ saved: iso(t - 60000) }));
    assert.equal(dc.validateDealCalculationAgainst(base({ supersedes: null }), fresh({ latest })), 'newer_calculation_exists');
    assert.equal(dc.validateDealCalculationAgainst(base({ supersedes: iso(t - 120000) }), fresh({ latest })), 'newer_calculation_exists');
    assert.equal(dc.validateDealCalculationAgainst(base({ supersedes: iso(t - 60000) }), fresh({ latest })), null);
  });
  await check('save rule: Saved within 10 minutes of the clock and later than the latest (else saved_not_fresh)', () => {
    const t = Date.now();
    assert.equal(dc.validateDealCalculationAgainst(base({ saved: iso(t - 11 * 60000) }), fresh({ nowMs: t })), 'saved_not_fresh');
    const latest = dc.parseDealCalculationNote(bodyOf({ saved: iso(t + 5000) }));
    assert.equal(dc.validateDealCalculationAgainst(base({ saved: iso(t), supersedes: iso(t + 5000) }), fresh({ latest, nowMs: t })), 'saved_not_fresh');
  });
  await check('save rule: basis must equal fresh approved facts (basis_mismatch) and property identity the latest (property_identity_mismatch)', () => {
    assert.equal(dc.validateDealCalculationAgainst(base({ basis: { arv: 1, repairs: null, currentOffer: null } }), fresh()), 'basis_mismatch');
    assert.equal(dc.validateDealCalculationAgainst(base({ propertyIdentity: iso(Date.now() - 1000) }), fresh()), 'property_identity_mismatch');
  });
  await check('staleness flags only what changed, and never alters either side', () => {
    const c = dc.parseDealCalculationNote(bodyOf({ basis: { arv: 250000, repairs: 30000, currentOffer: null } }));
    const before = JSON.stringify(c);
    assert.deepEqual(dc.calculationStaleness(c, { basis: { arv: 260000, repairs: 30000, currentOffer: 140000 }, propertyIdentity: iso(Date.now()) }), { arv: true, repairs: false, currentOffer: true, property: true });
    assert.equal(JSON.stringify(c), before);
  });

  // ---------------- separation from approvals and Current Offer ----------------
  const calcNotes = [{ id: 'n1', body: bodyOf({ basis: { arv: 250000, repairs: 30000, currentOffer: 145000 } }), dateAdded: iso(Date.now()) }];
  await check('ARV approval readers ignore a calculation note (parse and latest-for-deal)', () => {
    assert.equal(arvNote.parseArvApprovalNote(calcNotes[0].body), null);
    assert.equal(arvNote.latestArvApprovalForOpportunity(calcNotes, OPP), null);
  });
  await check('conversation-outcome readers (Accept / Current Offer path) ignore a calculation note', () => {
    assert.equal(outcome.parseOutcomeNote(calcNotes[0].body), null);
    assert.equal(outcome.latestOutcomeNoteForOpportunity(calcNotes, OPP), null);
  });
  await check('readiness readers ignore it (property identity, transaction assumptions, seller price position, human action)', () => {
    for (const p of [rc.parsePropertyIdentityConfirmationNote, rc.parseTransactionAssumptionsNote, rc.parseSellerPricePositionNote, rc.parseReadinessHumanActionNote, rc.parseReadinessDecisionInvalidationNote, rc.parseContractReadyChecklistNote]) assert.equal(p(calcNotes[0].body), null, p.name);
    assert.equal(rc.latestPropertyIdentityNoteForOpportunity(calcNotes, OPP), null);
  });
  await check('negotiation override and Seller Position readers ignore it', () => {
    assert.equal(override.parseNegotiationOverrideNote(calcNotes[0].body), null);
    assert.equal(sellerPosition.parseSellerPositionNote(calcNotes[0].body), null);
  });
  await check('exactly one registered ledger parser recognizes it: parseDealCalculationNote, classified refused in Production (allow: null)', () => {
    const matches = scope.PRODUCTION_NOTE_SCOPE.filter((e) => { try { return !!e.parse(calcNotes[0].body); } catch { return false; } });
    assert.deepEqual(matches.map((e) => e.parse.name), ['parseDealCalculationNote']);
    assert.equal(matches[0].allow, null);
  });
  await check('the guard registers the parser and reserves the DEAL prefix (source)', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify/functions/lib/write-note-guard.ts'), 'utf8');
    assert.match(src, /const parsers:[^\n]*parseDealCalculationNote\]/);
    assert.match(src, /\|ATTORNEY\|DEAL\)\//);
  });

  // ---------------- guard (validateLedgerNote), fake boundary ----------------
  await check('committed config: DEAL_CALCULATION_SAVE_DISABLED in BOTH Test and Production', () => {
    assert.equal(cfgLib.getConfig('test').dealCalculationSave.enabled, cfgLib.DEAL_CALCULATION_SAVE_DISABLED);
    assert.equal(cfgLib.getConfig('production').dealCalculationSave.enabled, cfgLib.DEAL_CALCULATION_SAVE_DISABLED);
  });
  const boundary = (state) => ({
    sent: 0,
    async opportunity(id) { return { id, contactId: state.ownerOf?.[id] ?? CONTACT, customFields: state.fields ?? [] }; },
    async notes() { return state.notes ?? []; },
    async note() { this.sent++; throw new Error('the guard must never send'); },
  });
  const rejects = async (p, re) => { await assert.rejects(p, (e) => { assert.match(String(e.message), re); return true; }); };
  await check('switch DISABLED (committed): a valid calculation note is refused', async () => {
    const b = boundary({}); await rejects(validateLedgerNote(b, CONTACT, bodyOf(), 'brad@example.invalid'), /Deal calculation saving is disabled/); assert.equal(b.sent, 0);
  });
  const enabled = async (fn) => { const saved = test.dealCalculationSave.enabled; test.dealCalculationSave.enabled = cfgLib.DEAL_CALCULATION_SAVE_ENABLED; try { await fn(); } finally { test.dealCalculationSave.enabled = saved; } };
  await check('in-memory ENABLED: a valid note on the contact\'s own deal is accepted (nothing sent by the guard)', () => enabled(async () => {
    const b = boundary({}); await validateLedgerNote(b, CONTACT, bodyOf(), 'brad@example.invalid'); assert.equal(b.sent, 0);
  }));
  await check('ENABLED: a deal owned by another contact is refused (existing ownership check)', () => enabled(async () => {
    await rejects(validateLedgerNote(boundary({ ownerOf: { [OPP]: 'conOTHER0009' } }), CONTACT, bodyOf(), 'b'), /belongs to another contact/);
  }));
  await check('ENABLED: a stale save (a newer calculation exists) is refused -- no silent overwrite', () => enabled(async () => {
    const t = Date.now(); const newer = bodyOf({ saved: iso(t - 30000) });
    await rejects(validateLedgerNote(boundary({ notes: [{ body: newer }] }), CONTACT, bodyOf({ supersedes: null }), 'b'), /newer_calculation_exists/);
  }));
  await check('ENABLED: Save as New (Supersedes = the latest) is accepted as a new note', () => enabled(async () => {
    const t = Date.now(); const latest = bodyOf({ saved: iso(t - 30000) });
    await validateLedgerNote(boundary({ notes: [{ body: latest }] }), CONTACT, bodyOf({ supersedes: iso(t - 30000) }), 'b');
  }));
  await check('ENABLED: a back-dated Saved (11 minutes old) is refused', () => enabled(async () => {
    await rejects(validateLedgerNote(boundary({}), CONTACT, bodyOf({ saved: iso(Date.now() - 11 * 60000) }), 'b'), /saved_not_fresh/);
  }));
  await check('ENABLED: a basis that differs from the deal\'s fresh approved ARV / Repairs / Current Offer is refused', () => enabled(async () => {
    const fields = [{ id: IDS.arv, fieldValue: 250000 }];
    await rejects(validateLedgerNote(boundary({ fields }), CONTACT, bodyOf(), 'b'), /basis_mismatch/);
    await validateLedgerNote(boundary({ fields }), CONTACT, bodyOf({ basis: { arv: 250000, repairs: null, currentOffer: null } }), 'b');
  }));
  await check('ENABLED: a property identity other than the latest confirmation is refused', () => enabled(async () => {
    const at = iso(Date.now() - 5000);
    const pid = rc.formatPropertyIdentityConfirmationNote({ opportunityId: OPP, at, operator: 'brad', status: 'confirmed', address: '1 Test St' });
    await rejects(validateLedgerNote(boundary({ notes: [{ body: pid }] }), CONTACT, bodyOf({ propertyIdentity: null }), 'b'), /property_identity_mismatch/);
    await validateLedgerNote(boundary({ notes: [{ body: pid }] }), CONTACT, bodyOf({ propertyIdentity: at }), 'b');
  }));
  await check('ENABLED: a tampered note (Status approved, other operator) is refused as malformed', () => enabled(async () => {
    await rejects(validateLedgerNote(boundary({}), CONTACT, swapLine(bodyOf(), 'Status', 'approved'), 'b'), /Malformed or undeclared ledger note/);
    await rejects(validateLedgerNote(boundary({}), CONTACT, swapLine(bodyOf(), 'Operator', 'mallory'), 'b'), /Malformed or undeclared ledger note/);
  }));
  await check('an undeclared "IAOS DEAL ..." note is refused by the reserved prefix (never stored as a plain note)', async () => {
    await rejects(validateLedgerNote(boundary({}), CONTACT, 'IAOS DEAL CALCULATION — forged\nOpportunity: x', 'b'), /Malformed or undeclared ledger note/);
  });
  await check('a plain note is unchanged (not a ledger note; the guard accepts it as before)', async () => {
    await validateLedgerNote(boundary({}), CONTACT, 'Called the seller; left a voicemail.', 'b');
  });

  console.log('');
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR + (mutation ? ' mutation=' + mutateArg.slice(9) + ' applied=' + mutationApplied : ''));
  if (mutation && mutationApplied !== 1) { console.error('ABORT: the mutation was not applied'); process.exit(2); }
  if (checks !== FLOOR) { console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks); process.exit(2); }
  if (failures > 0) { console.error('FAILED'); process.exit(1); }
  console.log('OK');
})().catch((e) => { console.error('ABORT: ' + (e && e.stack || e)); process.exit(2); });
