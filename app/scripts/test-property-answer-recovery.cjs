/**
 * B15-04 C1–C4 r4 (Bones design clearance 2026-10-20) -- focused SERVER boundary checks for draft recovery,
 * stored operation authority, request-scoped wording and fresh-load non-bypass. The REAL property-answer
 * handler, offline: in-memory Netlify Blobs with fault injection, a synthetic GHL, the committed Test
 * evaluation config (40 / 1) plus this suite's synthetic fixtures. No credential, no network.
 *
 * Every recovery and read-only path asserts: zero GHL requests, no Set-Cookie, no new grant, a byte-identical
 * budget record and (for read-only Check) a byte-identical Blob store.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');

const receipts = new Map(); const etags = new Map(); let etagSeq = 0; let failNext = [];
const take = (list, ...args) => { const i = list.findIndex((f) => f(...args)); if (i < 0) return false; list.splice(i, 1); return true; };
const realBlobs = require('@netlify/blobs');
delete process.env.NETLIFY_BLOBS_CONTEXT;
const lambdaHeaders = { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' };
const lambdaBlobs = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const memStore = {
  async get(key) { if (take(failNext, 'get', key)) throw new Error('fixture: blob get failed'); return receipts.has(key) ? structuredClone(receipts.get(key)) : null; },
  async getWithMetadata(key) { if (take(failNext, 'getWithMetadata', key)) throw new Error('fixture: blob read failed'); return receipts.has(key) ? { data: structuredClone(receipts.get(key)), etag: etags.get(key) } : null; },
  async setJSON(key, value, options) {
    if (take(failNext, 'setJSON', key, value)) throw new Error('fixture: blob setJSON failed');
    if (options?.onlyIfNew && receipts.has(key)) return { modified: false };
    if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
    receipts.set(key, structuredClone(value)); const etag = 'etag-' + (++etagSeq); etags.set(key, etag);
    return { modified: true, etag };
  },
  async delete(key) { receipts.delete(key); etags.delete(key); },
};
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return { connectLambda: (event) => realBlobs.connectLambda(event), getStore: () => memStore };
  return originalLoad.call(this, name, ...rest);
};
const A = 'brad@example.invalid', B = 'second@example.invalid';
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = `${A},${B}`;
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';

const auth = require('../netlify/functions/lib/app-write-auth.ts');
const cfgMod = require('../shared/ghl-config.ts');
const model = require('../netlify/functions/lib/property-answer-model.ts');
const opLib = require('../netlify/functions/lib/property-answer-operation.ts');
const ledger = require('../netlify/functions/lib/known-deal-ledger.ts');
const budgetLib = require('../netlify/functions/lib/evaluation-budget.ts');
const handlerMod = require('../netlify/functions/property-answer.ts');
const handler = handlerMod.handler;
const config = cfgMod.getConfig('test');
const P = config.propertyAnswerFields;
assert.deepEqual({ ...config.propertyAnswerEvaluation.requestBudget }, { budgetId: 'b15-04-eval-1', ceiling: 40 });
const X1 = 'fxContactX1', X2 = 'fxContactX2', DA = 'fxDealA00001', DB = 'fxDealB00001';
config.propertyAnswerEvaluation.fixtureContactIds.push(X1, X2);
config.propertyAnswerEvaluation.fixtureOpportunityIds.push(DA, DB);
const SCOPE = `test:${config.locationId}`;
const dg = (s) => crypto.createHash('sha256').update(s).digest('hex');
const budgetKeys = () => [...receipts.keys()].filter((k) => k.startsWith('pa/eval-budget/'));
const budgetSnap = () => JSON.stringify(budgetKeys().sort().map((k) => [k, receipts.get(k), etags.get(k)]));
const storeSnap = () => JSON.stringify([...receipts.keys()].sort().map((k) => [k, receipts.get(k), etags.get(k)]));
const bind = (operator, contactId, opportunityId, field) => ({ operator, env: 'test', locationId: config.locationId, contactId, opportunityId, field });
const v1Key = (c, o, f) => opLib.draftKey(SCOPE, c, o, f);

// ── Synthetic GHL ─────────────────────────────────────────────────────────────
let ghl; let calls = [];
const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
const status = (code) => ({ ok: false, status: code, json: async () => ({}), text: async () => '{}' });
let putFails = 0; let loseNoteReply = 0;
global.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET';
  assert.equal(u.origin, 'https://services.leadconnectorhq.com', 'no external network');
  const req = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null };
  calls.push(req);
  let m;
  if (u.pathname === '/opportunities/search') {
    const list = Object.values(ghl.opps).filter((o) => o.contactId === req.query.contact_id && o.pipelineId === req.query.pipeline_id);
    return ok({ opportunities: structuredClone(list), meta: { total: list.length, nextPage: null, nextPageUrl: null } });
  }
  if ((m = u.pathname.match(/^\/opportunities\/([^/]+)$/))) {
    const o = ghl.opps[m[1]]; if (!o) return status(404);
    if (method === 'PUT') {
      if (putFails > 0) { putFails -= 1; return status(500); }
      for (const f of req.body.customFields) { o.customFields = o.customFields.filter((x) => x.id !== f.id); if (f.field_value !== '' && f.field_value !== null) o.customFields.push({ id: f.id, fieldValue: f.field_value }); }
      return ok({ succeded: true });
    }
    return ok({ opportunity: structuredClone(o) });
  }
  if ((m = u.pathname.match(/^\/contacts\/([^/]+)(\/notes)?$/))) {
    const c = ghl.contacts[m[1]]; if (!c) return status(404);
    if (m[2]) {
      if (method === 'POST') { c.notes.push({ id: `${c.id}-note-${c.notes.length}`, body: req.body.body }); if (loseNoteReply > 0) { loseNoteReply -= 1; throw new Error('fixture: response lost'); } return ok({ note: c.notes[c.notes.length - 1] }); }
      return ok({ notes: structuredClone(c.notes) });
    }
    return ok({ contact: { id: c.id, locationId: config.locationId, customFields: [] } });
  }
  throw new Error('fixture: unexpected GHL request ' + method + ' ' + u.pathname);
};
const ADDRESS_FIELDS = [[P.propertyStreet, '100 Probe Way'], [P.propertyCity, 'McKinney'], [P.propertyState, 'TX'], [P.propertyZip, '75069']];
const deal = (id, contactId) => ({ id, locationId: config.locationId, contactId, pipelineId: config.pipelines.sellerLeads, pipelineStageId: config.stages.newLeadSeller, status: 'open', name: 'IAOS PROBE ' + id, customFields: ADDRESS_FIELDS.map(([id2, fieldValue]) => ({ id: id2, fieldValue })), createdAt: '2026-10-17T12:00:00.000Z' });
function fresh() {
  receipts.clear(); etags.clear(); failNext = []; calls = []; putFails = 0; loseNoteReply = 0;
  ghl = { contacts: { [X1]: { id: X1, notes: [] }, [X2]: { id: X2, notes: [] } }, opps: { [DA]: deal(DA, X1), [DB]: deal(DB, X2) } };
}

// ── Browser-like sessions: one write session + its own continuation jar ──────
// Distinct sign-ins: each session gets its own issue second (tokens minted in the same second would be identical).
let lastIssue = Date.now();   // strictly earlier, distinct issue seconds
function session(writer = A, now = (lastIssue = Math.min(Date.now(), lastIssue - 1000))) { return { token: auth.issueAppSession(writer, process.env, now).token, jar: null, writer }; }
async function post(sess, body, extra = {}) {
  const headers = { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, ...(sess ? { authorization: `Bearer ${sess.token}` } : {}), ...(sess && sess.jar ? { cookie: sess.jar } : {}), ...extra };
  const r = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers, body: JSON.stringify(body) });
  const cookie = r.headers && r.headers['Set-Cookie'];
  if (cookie && sess) sess.jar = cookie.split(';')[0];
  return { status: r.statusCode, body: JSON.parse(r.body), cookie: cookie || null };
}
const context = (s, c = X1, o = DA) => post(s, { action: 'context', contactId: c, opportunityId: o });
const draft = (s, value, c = X1, o = DA, field = 'seller_reason') => post(s, { action: 'draft', contactId: c, opportunityId: o, field, value });
const drafts = (s, c = X1, o = DA) => post(s, { action: 'drafts', contactId: c, opportunityId: o });
const check = (s, c = X1, o = DA) => post(s, { action: 'check', contactId: c, opportunityId: o });
async function save(s, value, c = X1, o = DA) {
  const ctx = await context(s, c, o); assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
  return post(s, { action: 'save', contactId: c, opportunityId: o, field: 'seller_reason', operationId: crypto.randomUUID(), value, expectedAddressDigest: ctx.body.address.digest, expectedDealSetDigest: ctx.body.verdict.digest });
}
const puts = () => calls.filter((c) => c.method === 'PUT').length;
const posts = () => calls.filter((c) => c.method === 'POST').length;
const holderOf = (s) => new budgetLib.EvaluationBudget(memStore, SCOPE, 'b15-04-eval-1', 40).holderDigest(`${s.writer}\n${dg(s.token)}`);

let count = 0, failures = 0; let finished = false;
process.on('exit', (code) => { if (!finished && code === 0) { console.error('FAIL the suite ended before it finished'); process.exitCode = 1; } });
async function t(name, fn) {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e)); }
}
/** Every recovery / read-only call: zero GHL, no Set-Cookie, budget byte-identical. */
async function quiet(label, fn, { store = false } = {}) {
  const b0 = budgetSnap(), s0 = storeSnap(), c0 = calls.length;
  const r = await fn();
  assert.equal(calls.length, c0, label + ': zero GHL requests');
  assert.equal(r.cookie, null, label + ': no Set-Cookie');
  assert.equal(budgetSnap(), b0, label + ': budget record byte-identical (no grant, stop or reset)');
  if (store) assert.equal(storeSnap(), s0, label + ': Blob store byte-identical (read-only)');
  return r;
}

(async () => {
  // ── C3 recovery: same operator, exact binding ───────────────────────────────
  await t('R1 same-operator save and recovery: the v2 draft is recovered in the same session and in a NEW session of the same operator', async () => {
    fresh(); const s1 = session(); assert.equal((await context(s1)).status, 200);
    assert.equal((await draft(s1, 'R1 reason')).body.outcome, 'draft_saved');
    const rec = receipts.get(opLib.draftKeyV2(bind(A, X1, DA, 'seller_reason')));
    assert.deepEqual({ ...rec, savedAt: 'x' }, { v: 2, operator: A, env: 'test', locationId: config.locationId, contactId: X1, opportunityId: DA, field: 'seller_reason', value: 'R1 reason', savedAt: 'x' }, 'v2 record bound to operator and exact target');
    assert.equal(receipts.has(v1Key(X1, DA, 'seller_reason')), false, 'no legacy v1 record is written');
    const r1 = await quiet('R1 same session', () => drafts(s1), { store: true });
    assert.equal(r1.body.drafts.seller_reason.state, 'present'); assert.equal(r1.body.drafts.seller_reason.value, 'R1 reason');
    assert.match(r1.body.notice, /previously observed contact\/deal association.*Current ownership and eligibility have not been checked/);
    const s2 = session();
    const r2 = await quiet('R1 new session', () => drafts(s2), { store: true });
    assert.equal(r2.body.drafts.seller_reason.value, 'R1 reason');
    assert.equal(r2.body.drafts.property_address.state, 'absent');
  });
  await t('R2 recovery while the evaluation is STOPPED and bound to another session: drafts recovered; save/history still refused; nothing reset', async () => {
    fresh(); const s1 = session(); await context(s1); await draft(s1, 'R2 reason');
    putFails = 1; const sv = await save(s1, 'R2 reason'); assert.equal(sv.body.outcome, 'not_confirmed', JSON.stringify(sv.body));
    const budget = receipts.get(budgetKeys()[0]); assert.ok(budget.stopped, 'the evaluation stopped');
    const s2 = session();
    const r = await quiet('R2 new session, stopped', () => drafts(s2), { store: true });
    assert.equal(r.body.drafts.seller_reason.value, 'R2 reason');
    const p0 = puts(), n0 = posts(), b0 = budgetSnap();
    const ctx = await context(s2); assert.equal(ctx.status, 409); assert.equal(ctx.cookie, null);
    assert.match(ctx.body.error, /This request sent nothing to GHL/);
    const again = await post(s2, { action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'x', expectedAddressDigest: 'a'.repeat(64), expectedDealSetDigest: 'b'.repeat(64) });
    assert.equal(again.status, 409); assert.match(again.body.code, /^budget_(stopped|session_mismatch)$/);
    const h = await post(s2, { action: 'history', contactId: X1, opportunityId: DA, operationId: sv.body.view.op }); assert.equal(h.status, 409);
    assert.equal(puts(), p0); assert.equal(posts(), n0); assert.equal(budgetSnap(), b0, 'no grant, capacity, continuation or stop change');
  });
  await t('R3 another allowed operator gets nothing of A\'s; each operator\'s draft for the same pair is separate', async () => {
    fresh(); const a = session(A), b = session(B); await context(a); await draft(a, 'A text');
    const rb = await quiet('R3 B reads', () => drafts(b), { store: true });
    assert.equal(rb.body.drafts.seller_reason.state, 'absent', 'B sees no draft (A\'s lives under A\'s key)');
    assert.ok(!JSON.stringify(rb.body).includes('A text'));
    assert.equal((await draft(b, 'B text')).body.outcome, 'draft_saved');
    assert.equal((await drafts(a)).body.drafts.seller_reason.value, 'A text', 'B cannot substitute A\'s content');
    assert.equal((await drafts(b)).body.drafts.seller_reason.value, 'B text');
  });
  await t('R4 an operator supplied in the request is refused (400) for draft and drafts; identity only comes from the verified token', async () => {
    fresh(); const a = session(A); await context(a);
    assert.equal((await post(a, { action: 'drafts', contactId: X1, opportunityId: DA, operator: B })).status, 400);
    assert.equal((await post(a, { action: 'draft', contactId: X1, opportunityId: DA, field: 'seller_reason', value: 'x', operator: B })).status, 400);
    assert.equal(receipts.has(opLib.draftKeyV2(bind(B, X1, DA, 'seller_reason'))), false);
  });
  await t('R5 cross-paired fixtures: pinned contact X1 with X2\'s pinned deal DB is refused for draft SAVE and READ (no prior association)', async () => {
    fresh(); const a = session(A); await context(a); await context(session(A), X2, DB);   // X2's ledger now holds DB
    const s0 = storeSnap();
    const w = await draft(a, 'wrong pair', X1, DB); assert.equal(w.status, 403); assert.equal(w.body.code, 'association_absent'); assert.equal(w.body.outcome, 'not_saved');
    assert.equal(storeSnap(), s0, 'nothing written');
    const r = await quiet('R5 read', () => drafts(a, X1, DB), { store: true });
    assert.equal(r.body.drafts.seller_reason.state, 'association_absent'); assert.equal(r.body.drafts.property_address.state, 'association_absent');
  });
  await t('R6 an AMBIGUOUS association (the deal under two fixture contacts) refuses save and read', async () => {
    fresh(); const a = session(A); await context(a); await draft(a, 'before ambiguity');
    const lk = ledger.ledgerKey(SCOPE, X2); receipts.set(lk, { v: 1, gen: 1, ids: { [DA]: { firstSeen: '2026-10-17T12:00:00.000Z', source: 'search' } }, discoveries: {} }); etags.set(lk, 'e-x2');
    const w = await draft(a, 'x'); assert.equal(w.status, 409); assert.equal(w.body.code, 'association_ambiguous');
    const r = await quiet('R6 read', () => drafts(a), { store: true });
    assert.equal(r.body.drafts.seller_reason.state, 'association_ambiguous'); assert.ok(!JSON.stringify(r.body).includes('before ambiguity'));
  });
  await t('R7 ledger evidence: absent (no ledger), malformed entry and unreadable ledger (own or another fixture contact\'s) all fail closed', async () => {
    fresh(); const a = session(A);
    assert.equal((await quiet('R7 absent', () => drafts(a), { store: true })).body.drafts.seller_reason.state, 'association_absent');
    await context(a); await draft(a, 'kept');
    const lk = ledger.ledgerKey(SCOPE, X1); const good = structuredClone(receipts.get(lk));
    for (const bad of [{ firstSeen: 'not a date', source: 'search' }, { firstSeen: '2026-10-17T12:00:00.000Z', source: 'guess' }, null, 'x']) {
      receipts.set(lk, { ...good, ids: { ...good.ids, [DA]: bad } });
      const r = await quiet('R7 malformed', () => drafts(a), { store: true });
      assert.equal(r.body.drafts.seller_reason.state, bad === null ? 'association_unconfirmed' : 'association_unconfirmed', JSON.stringify(bad));
    }
    receipts.set(lk, good);
    failNext.push((op, k) => op === 'getWithMetadata' && k === lk);
    assert.equal((await quiet('R7 unreadable own', () => drafts(a))).body.drafts.seller_reason.state, 'association_unconfirmed');
    failNext.push((op, k) => op === 'getWithMetadata' && k === ledger.ledgerKey(SCOPE, X2));
    assert.equal((await quiet('R7 unreadable other', () => drafts(a))).body.drafts.seller_reason.state, 'association_unconfirmed');
    assert.equal((await drafts(a)).body.drafts.seller_reason.value, 'kept', 'control: valid evidence recovers');
  });
  await t('R8 draft record evidence: binding mismatch (contact, location, field, operator), malformed value, wrong version -> invalid; unreadable -> unavailable (never "no draft"); cleared after S1 -> cleared', async () => {
    fresh(); const a = session(A); await context(a); await draft(a, 'good');
    const key = opLib.draftKeyV2(bind(A, X1, DA, 'seller_reason')); const good = structuredClone(receipts.get(key));
    for (const [label, rec] of [['contact', { ...good, contactId: X2 }], ['location', { ...good, locationId: 'otherLocation' }], ['field', { ...good, field: 'property_address' }], ['operator', { ...good, operator: B }],
      ['env', { ...good, env: 'production' }], ['value', { ...good, value: 42 }], ['version', { ...good, v: 1 }], ['savedAt', { ...good, savedAt: 'never' }], ['null', null]]) {
      receipts.set(key, rec);
      const r = await quiet('R8 ' + label, () => drafts(a), { store: true });
      assert.equal(r.body.drafts.seller_reason.state, rec === null ? 'absent' : 'invalid', label);
    }
    receipts.set(key, good);
    failNext.push((op, k) => op === 'get' && k === key);
    assert.equal((await quiet('R8 unreadable', () => drafts(a))).body.drafts.seller_reason.state, 'unavailable');
    const ctx = await context(a);
    assert.equal(ctx.body.drafts.seller_reason, 'good', 'context returns the same bound value');
    const s = await post(a, { action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'good', expectedAddressDigest: ctx.body.address.digest, expectedDealSetDigest: ctx.body.verdict.digest });
    assert.equal(s.body.outcome, 'saved_history_pending');
    assert.equal((await drafts(a)).body.drafts.seller_reason.state, 'cleared');
  });
  await t('R9 legacy v1 draft (no operator provenance): reported legacy_unverified, never returned as text, not migrated or cleared, not returned by context', async () => {
    fresh(); const a = session(A); await context(a);
    receipts.set(v1Key(X1, DA, 'seller_reason'), { v: 1, value: 'LEGACY TEXT', savedAt: '2026-10-17T12:00:00.000Z' }); etags.set(v1Key(X1, DA, 'seller_reason'), 'e-v1');
    const r = await quiet('R9', () => drafts(a), { store: true });
    assert.equal(r.body.drafts.seller_reason.state, 'legacy_unverified'); assert.ok(!JSON.stringify(r.body).includes('LEGACY TEXT'));
    const ctx = await context(a); assert.equal(ctx.body.drafts.seller_reason, null); assert.equal(ctx.body.draftStates.seller_reason.state, 'legacy_unverified');
    assert.deepEqual(receipts.get(v1Key(X1, DA, 'seller_reason')), { v: 1, value: 'LEGACY TEXT', savedAt: '2026-10-17T12:00:00.000Z' }, 'legacy evidence untouched');
    assert.equal(receipts.has(opLib.draftKeyV2(bind(A, X1, DA, 'seller_reason'))), false, 'not migrated');
  });
  await t('R10 POISONED pre-association draft: a draft attempted before any association is refused and never becomes reachable after a later association', async () => {
    fresh(); const a = session(A);
    const w = await draft(a, 'POISON'); assert.equal(w.status, 403); assert.equal(w.body.code, 'association_absent');
    receipts.set(v1Key(X1, DA, 'seller_reason'), { v: 1, value: 'POISON v1', savedAt: '2026-10-17T12:00:00.000Z' }); etags.set(v1Key(X1, DA, 'seller_reason'), 'e');
    await context(a);   // the association now exists
    const r = await quiet('R10', () => drafts(a), { store: true });
    assert.equal(r.body.drafts.seller_reason.state, 'legacy_unverified'); assert.ok(!JSON.stringify(r.body).includes('POISON'));
  });
  await t('R11 gates before storage: no sign-in 401, expired token 401, bad origin 403, non-fixture 403, Production 403 -- each with zero Blob reads of drafts', async () => {
    fresh(); const a = session(A); await context(a); await draft(a, 'gated');
    const s0 = storeSnap();
    assert.equal((await post(null, { action: 'drafts', contactId: X1, opportunityId: DA })).status, 401);
    const expired = session(A, Date.now() - 16 * 60 * 1000);
    assert.equal((await drafts(expired)).status, 401, 'expired authentication refuses');
    assert.equal((await post(a, { action: 'drafts', contactId: X1, opportunityId: DA }, { origin: 'https://evil.example.invalid' })).status, 403);
    assert.equal((await post(a, { action: 'drafts', contactId: 'fxNotPinned', opportunityId: DA })).body.code, 'not_a_fixture');
    process.env.IAOS_ENV = 'production';
    try { assert.equal((await drafts(a)).body.code, 'evaluation_disabled'); } finally { process.env.IAOS_ENV = 'test'; }
    assert.equal(storeSnap(), s0);
  });

  // ── A1 stored operation authority ───────────────────────────────────────────
  async function appliedLostReply() {
    // An applied S1 whose reply never reached the browser: the session never sees its continuation.
    const s1 = session(); const ctx = await context(s1); const jarBefore = s1.jar;
    const sv = await post(s1, { action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'applied', expectedAddressDigest: ctx.body.address.digest, expectedDealSetDigest: ctx.body.verdict.digest });
    assert.equal(sv.body.outcome, 'saved_history_pending'); assert.equal(puts(), 1);
    s1.jar = jarBefore;   // the lost reply: its Set-Cookie never arrived
    return { s1, op: sv.body.view.op };
  }
  await t('A1a after an applied S1 with a lost reply: no auth 401; another operator / another target / an unattributed operation 403 status_unavailable; nothing written; the lost reply grants nothing', async () => {
    fresh(); const { s1, op } = await appliedLostReply();
    const opRec = receipts.get(`pa/op/${dg(`${SCOPE}:${op}`)}`); assert.deepEqual(opRec.access, { v: 1, writer: A, holder: holderOf(s1) }, 'access stamped on the operation');
    assert.equal((await post(null, { action: 'check', contactId: X1, opportunityId: DA })).status, 401);
    const other = await quiet('A1a other operator', () => check(session(B)), { store: true });
    assert.equal(other.status, 403); assert.equal(other.body.code, 'other_operator'); assert.equal(other.body.view, undefined);
    await context(session(A), X2, DB);
    const tgt = await quiet('A1a other target', () => check(s1, X1, DB), { store: true });
    assert.equal(tgt.status, 403); assert.equal(tgt.body.code, 'other_target');
    const key = `pa/op/${dg(`${SCOPE}:${op}`)}`; const { access, ...unattributed } = opRec; receipts.set(key, unattributed);
    const un = await quiet('A1a unattributed', () => check(s1), { store: true });
    assert.equal(un.status, 403); assert.equal(un.body.code, 'unattributed');
    assert.equal(puts(), 1); assert.equal(posts(), 0, 'no history written');
  });
  await t('A1b same operator, NEW session: drafts recovered; Check is READ-ONLY (view returned, zero GHL, no lock, Blob store byte-identical); it cannot settle the old attempt', async () => {
    fresh(); const { s1, op } = await appliedLostReply();
    const s2 = session(); assert.notEqual(s2.token, s1.token, 'a genuinely different session');
    const c = await quiet('A1b read-only check', () => check(s2), { store: true });
    assert.equal(c.status, 200); assert.equal(c.body.access, 'read'); assert.equal(c.body.readOnly, true); assert.equal(c.body.view.op, op);
    assert.equal(c.body.view.state, 'saved_history_pending', 'the stored state, not a GHL readback');
    assert.equal((await check(s2)).body.view.state, 'saved_history_pending', 'repeating changes nothing');
    assert.equal(posts(), 0);
  });
  await t('A1c STOPPED budget + DIFFERENT holder (grant-order trap): nothing settled, withdrawn, finalized or stopped; store byte-identical', async () => {
    fresh(); const s1 = session(); const ctx = await context(s1);
    putFails = 1;
    const sv = await post(s1, { action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'v', expectedAddressDigest: ctx.body.address.digest, expectedDealSetDigest: ctx.body.verdict.digest });
    assert.equal(sv.body.view.state, 'not_confirmed'); assert.ok(receipts.get(budgetKeys()[0]).stopped);
    const s2 = session(); assert.notEqual(s2.token, s1.token, 'a genuinely different session');
    const c = await quiet('A1c', () => check(s2), { store: true });
    assert.equal(c.body.access, 'read'); assert.equal(c.body.view.state, 'not_confirmed', 'stays uncertain/held');
    const ctx2 = await context(s2); assert.equal(ctx2.body.access, 'read', 'context refusal reports the same stored access');
  });
  await t('A1d the TRUE holder after a stop: Check settles local evidence only -- zero GHL, no Set-Cookie, no S1/history, no grant', async () => {
    fresh(); const s1 = session(); const ctx = await context(s1);
    putFails = 1;
    await post(s1, { action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'v', expectedAddressDigest: ctx.body.address.digest, expectedDealSetDigest: ctx.body.verdict.digest });
    const ctx2 = await context(s1); assert.equal(ctx2.body.access, 'settle', 'stored holder == this session == latest grant holder');
    const c = await quiet('A1d', () => check(s1));
    assert.equal(c.status, 200); assert.equal(c.body.view.state, 'not_confirmed'); assert.equal(puts(), 1); assert.equal(posts(), 0);
  });

  // ── A2 wording ──────────────────────────────────────────────────────────────
  await t('A2f a READS-ONLY draw refusal in context (after a completed GHL read): verification incomplete, earlier reads may have completed, no answer save; never "sent nothing" and never a write warning', async () => {
    fresh(); const s1 = session();
    failNext.push((op, k) => op === 'getWithMetadata' && k.startsWith('pa/eval-budget/') && calls.length >= 1);   // the first budget read AFTER a GHL read: a later draw is refused
    const r = await context(s1);
    assert.ok(calls.length >= 1, 'a GHL read completed first');
    // Observed path: discovery reports the incomplete deal list (200, not allowed, evaluation stopped).
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.verdict.allowed, false); assert.ok(['search_incomplete', 'list_updating'].includes(r.body.verdict.reason), r.body.verdict.reason);
    assert.match(r.body.verdict.message, /Verification is incomplete; earlier GHL reads in this request may have completed\. This request did not submit an answer save\./);
    assert.doesNotMatch(JSON.stringify(r.body), /sent nothing|Nothing was sent|may have reached GHL/);
    assert.equal(puts(), 0); assert.equal(posts(), 0);
  });
  await t('A2g a PROVED pre-dispatch refusal (stopped budget): "This request sent nothing to GHL", zero GHL; no blanket Check instruction', async () => {
    fresh(); const s1 = session(); await context(s1); putFails = 1; await save(s1, 'v');
    const c0 = calls.length; const r = await context(s1);
    assert.equal(r.status, 409); assert.equal(calls.length, c0); assert.match(r.body.error, /This request sent nothing to GHL\. Any earlier save keeps its own recorded outcome\./);
    assert.doesNotMatch(r.body.error, /Check again/);
  });
  await t('A2 a write that may have dispatched keeps uncertain wording (lost history note reply): history_unresolved, never "not sent"', async () => {
    fresh(); const s1 = session(); const sv = await save(s1, 'w'); loseNoteReply = 1;
    const h = await post(s1, { action: 'history', contactId: X1, opportunityId: DA, operationId: sv.body.view.op });
    assert.equal(h.body.outcome, 'history_unresolved'); assert.notEqual(h.body.outcome, 'not_sent'); assert.equal(posts(), 1);
  });

  // ── Fresh load ──────────────────────────────────────────────────────────────
  await t('F a FRESH load with an existing stopped budget, expired credentials or a superseded session never reopens authority: no 200, no grant/capacity/continuation change, no S1/history', async () => {
    fresh(); const s1 = session(); await context(s1); await draft(s1, 'fresh'); putFails = 1; await save(s1, 'fresh');
    const b0 = budgetSnap(); const p0 = puts(), n0 = posts();
    for (const s of [session(), s1]) {   // superseded/new session and the stopped holder itself, each "freshly loaded" (no jar)
      const fresh1 = { ...s, jar: null };
      const r = await context(fresh1); assert.equal(r.status, 409); assert.equal(r.cookie, null);
      const d = (await drafts(fresh1)).body.drafts.seller_reason; assert.equal(d.state, 'present', 'S1 did not land, so the draft stays recoverable'); assert.equal(d.value, 'fresh');
    }
    assert.equal((await context(session(A, Date.now() - 16 * 60 * 1000))).status, 401);
    assert.equal(budgetSnap(), b0); assert.equal(puts(), p0); assert.equal(posts(), n0);
  });

  finished = true;
  console.log(`property-answer recovery/authority: ${count} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
})();
