/**
 * B15-04 -- the pure property-answer model and the deal-set evaluation
 * (lib/property-answer-model.ts, lib/seller-deal-set.ts). Offline; no I/O.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
global.fetch = async () => { throw new Error('NETWORK FORBIDDEN'); };
const m = require('../netlify/functions/lib/property-answer-model.ts');
const ds = require('../netlify/functions/lib/seller-deal-set.ts');
const { getConfig } = require('../shared/ghl-config.ts');
const config = getConfig('test');
const dg = (s) => crypto.createHash('sha256').update(s).digest('hex');
let n = 0, f = 0;
const t = (name, fn) => { try { fn(); n++; console.log('PASS ' + name); } catch (e) { f++; console.error('FAIL ' + name + '\n  ' + e.message); } };
const IDS = { street: 'iS', unit: 'iU', city: 'iC', state: 'iT', zip: 'iZ' };
const cf = (a) => Object.entries(a).filter(([, v]) => v !== '').map(([k, v]) => ({ id: IDS[k], fieldValue: v }));

t('normalizeAddress: trims and collapses whitespace, upper-cases the state, keeps an empty unit', () => {
  assert.deepEqual(m.normalizeAddress({ street: '  12   Elm  St ', unit: ' ', city: 'Plano ', state: 'tx', zip: '75024' }), { street: '12 Elm St', unit: '', city: 'Plano', state: 'TX', zip: '75024' });
});
t('normalizeAddress refuses: missing or extra parts, non-text, empty street/city, bad state or ZIP, over-long parts', () => {
  const ok = { street: '1 A', unit: '', city: 'B', state: 'TX', zip: '75000' };
  for (const bad of [{ ...ok, extra: '' }, (() => { const x = { ...ok }; delete x.unit; return x; })(), { ...ok, zip: 75000 }, { ...ok, street: '' }, { ...ok, city: ' ' }, { ...ok, state: 'T' }, { ...ok, state: 'T1' }, { ...ok, zip: '7500' }, { ...ok, zip: '75000-1234' }, { ...ok, street: 'x'.repeat(201) }, null, [], 'x'])
    assert.throws(() => m.normalizeAddress(bad), undefined, JSON.stringify(bad));
});
t('addressDigest is over the five stored parts in order; the empty digest is fixed', () => {
  const a = { street: '1 A', unit: '', city: 'B', state: 'TX', zip: '75000' };
  assert.equal(m.addressDigest(a), dg(JSON.stringify(['1 A', '', 'B', 'TX', '75000'])));
  assert.equal(m.EMPTY_ADDRESS_DIGEST, dg(JSON.stringify(['', '', '', '', ''])));
  assert.notEqual(m.addressDigest({ ...a, unit: '2' }), m.addressDigest(a));
});
t('readAddress: empty / confirmed / incomplete; an un-normalized stored value is incomplete; a non-text value is ambiguous', () => {
  assert.equal(m.readAddress([], IDS).kind, 'empty');
  assert.equal(m.readAddress(cf({ street: '1 A', city: 'B', state: 'TX', zip: '75000' }), IDS).kind, 'confirmed');
  assert.equal(m.readAddress(cf({ street: '1 A' }), IDS).kind, 'incomplete');
  assert.equal(m.readAddress(cf({ street: '1 A', city: 'B', state: 'tx', zip: '75000' }), IDS).kind, 'incomplete');
  assert.equal(m.readAddress(cf({ street: '1  A', city: 'B', state: 'TX', zip: '75000' }), IDS).kind, 'incomplete');
  assert.throws(() => m.readAddress([{ id: 'iS', fieldValue: 5 }], IDS));
  assert.throws(() => m.readAddress([{ id: 'iS', fieldValue: 'a' }, { id: 'iS', fieldValue: 'b' }], IDS), /Duplicate/);
});
t('normalizeSellerReason: CRLF/CR -> LF; empty or whitespace refused; 2000-character cap', () => {
  assert.equal(m.normalizeSellerReason('a\r\nb\rc'), 'a\nb\nc');
  for (const bad of ['', '  \n ', 5, 'x'.repeat(2001)]) assert.throws(() => m.normalizeSellerReason(bad));
  assert.equal(m.normalizeSellerReason('x'.repeat(2000)).length, 2000);
});
const entry = { operationId: 'op-1', opportunityId: 'opp-1', contactId: 'c-1', field: 'seller_reason', valueDigest: dg('Why'), previousDigest: 'none', callSegment: 'none', environment: 'test', locationId: 'loc', valueLines: ['Why'] };
t('history note: deterministic body with the version marker; parse round-trips; a value line may contain any text', () => {
  const body = m.historyNoteBody(entry);
  assert.ok(body.startsWith(m.HISTORY_NOTE_MARK + '\n')); assert.ok(m.isHistoryNoteText(body));
  assert.deepEqual(m.parseHistoryNote(body), entry);
  const multi = { ...entry, valueLines: ['field: x', 'value:', 'operation: fake'] };
  assert.deepEqual(m.parseHistoryNote(m.historyNoteBody(multi)), multi);
  assert.equal(m.parseHistoryNote('IAOS property answer v1\noperation: x'), null);
  assert.equal(m.parseHistoryNote(body.replace('field: seller_reason', 'field: other')), null);
});
t('r3 §5 complete-entry match: exactly one exact note and an equal current value -> committed; none, several, a partial (same op, any differing element) or a changed value -> unresolved', () => {
  const body = m.historyNoteBody(entry);
  assert.deepEqual(m.reconcileHistory([{ body }], entry, dg('Why')), { kind: 'committed' });
  assert.equal(m.reconcileHistory([], entry, dg('Why')).reason, 'no_match');
  assert.equal(m.reconcileHistory([{ body }, { body }], entry, dg('Why')).reason, 'several_matches');
  for (const k of ['opportunityId', 'contactId', 'valueDigest', 'previousDigest', 'callSegment', 'environment', 'locationId']) {
    const partial = m.historyNoteBody({ ...entry, [k]: 'different' });
    assert.equal(m.reconcileHistory([{ body: partial }], entry, dg('Why')).reason, 'partial_match', k);
    assert.equal(m.reconcileHistory([{ body }, { body: partial }], entry, dg('Why')).reason, 'partial_match', k + ' alongside');
  }
  assert.equal(m.reconcileHistory([{ body }], entry, dg('Other')).reason, 'value_changed');
  assert.equal(m.reconcileHistory([{ body }], entry, null).reason, 'value_changed');
});
const S = config.stages, PIPE = config.pipelines.sellerLeads;
const opp = (id, over = {}) => ({ id, contactId: 'c', pipelineId: PIPE, pipelineStageId: S.newLeadSeller, status: 'open', ...over });
t('classifyDeal: every configured non-terminal stage and LTN are ELIGIBLE; won/lost/abandoned NOT_ELIGIBLE; open + Closed-Won/Lost CONFLICT; anything else UNKNOWN', () => {
  for (const st of ds.eligibleStageIds(config)) assert.equal(ds.classifyDeal(opp('a', { pipelineStageId: st }), 'c', config), 'ELIGIBLE');
  assert.equal(ds.eligibleStageIds(config).length, 9); assert.ok(ds.eligibleStageIds(config).includes(S.longTermNurture));
  for (const st of ['won', 'lost', 'abandoned']) assert.equal(ds.classifyDeal(opp('a', { status: st, pipelineStageId: S.sellerFollowUp }), 'c', config), 'NOT_ELIGIBLE');
  assert.equal(ds.classifyDeal(opp('a', { pipelineStageId: S.sellerClosedWon }), 'c', config), 'CONFLICT');
  assert.equal(ds.classifyDeal(opp('a', { pipelineStageId: S.lostNotInterested }), 'c', config), 'CONFLICT');
  for (const over of [{ status: undefined }, { status: 'all' }, { pipelineStageId: 'unknown-stage' }, { pipelineId: 'other' }, { contactId: 'other' }]) assert.equal(ds.classifyDeal(opp('a', over), 'c', config), 'UNKNOWN', JSON.stringify(over));
  assert.equal(ds.classifyDeal(null, 'c', config), 'UNKNOWN');
});
const page = (list, meta) => ({ opportunities: list, meta: meta ?? { total: list.length, nextPage: null } });
t('checkSearchPage: duplicate ids, a foreign contact or pipeline, a missing target, total != count, >= 100 items or a next page all fail', () => {
  const a = opp('a');
  assert.equal(ds.checkSearchPage(page([a]), 'c', PIPE, 'a').complete, true);
  assert.equal(ds.checkSearchPage(page([a, a]), 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage(page([a, opp('b', { contactId: 'x' })]), 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage(page([a, opp('b', { pipelineId: 'x' })]), 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage(page([opp('b')]), 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage(page([a], { total: 2 }), 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage(page([a], { total: 1, nextPage: 2 }), 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage(page([a], { total: 1, nextPageUrl: 'x' }), 'c', PIPE, 'a').complete, false);
  const hundred = Array.from({ length: 100 }, (_, i) => opp(i === 0 ? 'a' : 'x' + i, { status: 'lost' }));
  assert.equal(ds.checkSearchPage(page(hundred), 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage({ opportunities: 'x' }, 'c', PIPE, 'a').complete, false);
  assert.equal(ds.checkSearchPage(null, 'c', PIPE, 'a').complete, false);
});
t('evaluateDealSet: ledger ids are candidates; a candidate without a fresh read is UNKNOWN; the digest changes with any class, stage or status', () => {
  const a = opp('a'), b = opp('b', { status: 'lost' });
  const fresh = new Map([['a', a], ['b', b]]);
  const v = ds.evaluateDealSet({ search: page([a, b]), fresh, ledgerIds: [], targetId: 'a', contactId: 'c', config });
  assert.equal(v.allowed, true);
  assert.equal(ds.evaluateDealSet({ search: page([a]), fresh: new Map([['a', a]]), ledgerIds: ['z'], targetId: 'a', contactId: 'c', config }).reason, 'unresolved_deal');
  assert.equal(ds.evaluateDealSet({ search: page([a]), fresh: new Map([['a', a], ['z', 'unreadable']]), ledgerIds: ['z'], targetId: 'a', contactId: 'c', config }).reason, 'unresolved_deal');
  const v2 = ds.evaluateDealSet({ search: page([a, b]), fresh: new Map([['a', a], ['b', { ...b, status: 'won' }]]), ledgerIds: [], targetId: 'a', contactId: 'c', config });
  assert.equal(v2.reason, 'list_updating'); assert.notEqual(v2.digest, v.digest);
  assert.equal(ds.dealSetDigest([...v.deals].reverse()), v.digest, 'order-independent');
  assert.equal(ds.evaluateDealSet({ search: page([a, opp('b2', { pipelineStageId: S.sellerOfferSent })]), fresh: new Map([['a', a], ['b2', opp('b2', { pipelineStageId: S.sellerOfferSent })]]), ledgerIds: [], targetId: 'a', contactId: 'c', config }).reason, 'several_eligible');
  assert.equal(ds.evaluateDealSet({ search: page([a, opp('b3')]), fresh: new Map([['a', { ...a, status: 'lost' }], ['b3', opp('b3')]]), ledgerIds: [], targetId: 'a', contactId: 'c', config }).reason, 'list_updating');
  assert.equal(ds.evaluateDealSet({ search: page([{ ...a, status: 'lost' }, opp('b3')]), fresh: new Map([['a', { ...a, status: 'lost' }], ['b3', opp('b3')]]), ledgerIds: [], targetId: 'a', contactId: 'c', config }).reason, 'target_not_eligible');
});
console.log(`property-answer-model: ${n} passed, ${f} failed`);
process.exitCode = f ? 1 : 0;
