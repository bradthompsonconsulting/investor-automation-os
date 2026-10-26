/**
 * B15-04 Rev 6 property answers -- focused offline suite for the property-answer
 * endpoint and its durable operation (design r3; proposal r4; Bones's r3 fencing
 * review race cases F1-F7 / G1-G5; r3 crash cases C1-C8 / D1-D8).
 *
 * Offline. @netlify/blobs is an in-memory store with onlyIfNew / onlyIfMatch
 * semantics and injectable faults (a write that throws, a write that APPLIES and
 * then throws, a stale read). Every GHL call goes to a fake that can change state
 * mid-flow. Global fetch rejects any other origin. No credential, no network.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');

const receipts = new Map(); const etags = new Map(); let etagSeq = 0;
let failNext = []; let applyThenThrow = []; let staleNext = []; let blobOps = 0;
const realBlobs = require('@netlify/blobs');
const receiptShim = require('./lib/receipt-recorder-shim.cjs'); // main's recorded-receipt adapter (204a66f): fetch-bearing receipt stores go through the helpers' recorder (test-only; Bones step 070)
delete process.env.NETLIFY_BLOBS_CONTEXT;
const lambdaHeaders = { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' };
const lambdaBlobs = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
const take = (list, ...args) => { const i = list.findIndex((f) => f(...args)); if (i < 0) return false; list.splice(i, 1); return true; };
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const memStore = {
  async get(key) { blobOps++; if (take(failNext, 'get', key)) throw new Error('fixture: blob get failed'); if (take(staleNext, key)) return null; return receipts.has(key) ? structuredClone(receipts.get(key)) : null; },
  async getWithMetadata(key) { blobOps++; if (take(failNext, 'getWithMetadata', key)) throw new Error('fixture: blob read failed'); return receipts.has(key) ? { data: structuredClone(receipts.get(key)), etag: etags.get(key) } : null; },
  async setJSON(key, value, options) {
    blobOps++;
    if (take(failNext, 'setJSON', key, value)) throw new Error('fixture: blob setJSON failed');
    if (options?.onlyIfNew && receipts.has(key)) return { modified: false };
    if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
    receipts.set(key, structuredClone(value)); const etag = 'etag-' + (++etagSeq); etags.set(key, etag);
    if (take(applyThenThrow, 'setJSON', key, value)) throw new Error('fixture: write applied, acknowledgement lost');
    return { modified: true, etag };
  },
  async delete(key) { blobOps++; if (take(failNext, 'delete', key)) throw new Error('fixture: blob delete failed'); receipts.delete(key); etags.delete(key); },
};
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return receiptShim.wrap({ connectLambda: (event) => realBlobs.connectLambda(event), getStore: () => memStore });
  return originalLoad.call(this, name, ...rest);
};
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid,second@example.invalid'; // a second ALLOWED writer (F4c)
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';

const auth = require('../netlify/functions/lib/app-write-auth.ts');
const cfgMod = require('../shared/ghl-config.ts');
const model = require('../netlify/functions/lib/property-answer-model.ts');
const ledger = require('../netlify/functions/lib/known-deal-ledger.ts');
const opLib = require('../netlify/functions/lib/property-answer-operation.ts');
const budgetLib = require('../netlify/functions/lib/evaluation-budget.ts');
const config = cfgMod.getConfig('test');
// The committed Test config carries the six real Test field ids; this suite only pins its own synthetic fixtures.
const P = config.propertyAnswerFields;
assert.deepEqual({ ...P }, { sellerReason: 'zqGxQc7nAspWmYglR2Qk', propertyStreet: 'vMejpjFmgI9ZWvfloaPW', propertyUnit: 'Ok4EFrJqtDqIn90FFiT9', propertyCity: 'lrHSGsOIBtH4f1s9YbVj', propertyState: 'WOaJHfbMz20YTPhD2lI5', propertyZip: 'qztxh0XDmiZrDBMauoJq' }, 'committed Test field ids');
const X1 = 'fxContactX1', X2 = 'fxContactX2', X3 = 'fxContactX3', OTHER = 'fxContactOther';
const DA = 'fxDealA00001', DB = 'fxDealB00001', DC = 'fxDealC00001', DD = 'fxDealD00001', DN = 'fxDealNew0001', NONFIX = 'fxDealNotPinned';
// The committed Test pins are exactly the two synthetic fixtures; this suite then pins its own offline fixtures.
assert.deepEqual([...config.propertyAnswerEvaluation.fixtureContactIds], ['pYE98meKVyRrbzEt6MMR', 'LR98QNOE0oksHIPF4JIf']);
assert.deepEqual([...config.propertyAnswerEvaluation.fixtureOpportunityIds], ['a75hWpPILA7Y7Ginp4n8', 'HCTa65siD41bA9XGpQWM']);
assert.equal(config.propertyAnswerEvaluation.enabled, cfgMod.PROPERTY_ANSWER_EVALUATION_ENABLED);
assert.deepEqual({ ...config.propertyAnswerEvaluation.requestBudget }, { budgetId: 'b15-04-eval-1', ceiling: 40 }, 'committed evaluation budget');
assert.equal(config.propertyAnswerEvaluation.maxCandidates, 1, 'committed candidate cap');
// General cases are not about the budget: a large budget, reset before every call (keepBudget=false).
// The F4 cases restore the committed 40 / 1 and keep the budget across calls.
const COMMITTED_BUDGET = { ...config.propertyAnswerEvaluation.requestBudget };
config.propertyAnswerEvaluation.requestBudget = { budgetId: 'offline-suite', ceiling: 1000000 };
config.propertyAnswerEvaluation.maxCandidates = 10;
let keepBudget = false;
const budgetKeys = () => [...receipts.keys()].filter((k) => k.startsWith('pa/eval-budget/'));
config.propertyAnswerEvaluation.fixtureContactIds.push(X1, X2, X3);
config.propertyAnswerEvaluation.fixtureOpportunityIds.push(DA, DB, DC, DD, DN);
const SCOPE = `test:${config.locationId}`;
const S = config.stages; const PIPE = config.pipelines.sellerLeads;
const dg = (s) => crypto.createHash('sha256').update(s).digest('hex');
const key = { head: (c) => `pa/head/${dg(`${SCOPE}:${c}`)}`, op: (op) => `pa/op/${dg(`${SCOPE}:${op}`)}`, attempt: (op, sl, n) => `pa/attempt/${dg(`${SCOPE}:${op}:${sl}:${n}`)}`,
  decision: (r) => `pa/decision/${dg(`${SCOPE}:${r}`)}`, outcome: (r) => `pa/outcome/${dg(`${SCOPE}:${r}`)}`, final: (op) => `pa/final/${dg(`${SCOPE}:${op}`)}`, permit: (op) => `pa/s2-permit/${dg(`${SCOPE}:${op}`)}`,
  ledger: (c) => ledger.ledgerKey(SCOPE, c), draft: (c, o, f) => `pa/draft/${dg(`${SCOPE}:${c}:${o}:${f}`)}` };
const rid = (op, sl, n) => `${op}-${sl}-${n}`;

// ── Fake GHL ────────────────────────────────────────────────────────────────
let ghl; let calls = []; let hooks = []; let searchHide = new Set(); let searchStale = new Map(); let searchMeta = null; let loseNext = [];
const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '{}' });
/** hooks: { when(req, n), fn(req) } runs fn once, before the request is answered, on the matching call. */
function onCall(when, fn) { hooks.push({ when, fn }); }
global.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET';
  assert.equal(u.origin, 'https://services.leadconnectorhq.com', 'no external network');
  const req = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null };
  calls.push(req);
  const hi = hooks.findIndex((h) => h.when(req, calls)); if (hi >= 0) { const [h] = hooks.splice(hi, 1); await h.fn(req); }
  let m;
  if (u.pathname === '/opportunities/search') {
    const list = Object.values(ghl.opps).filter((o) => o.contactId === req.query.contact_id && o.pipelineId === req.query.pipeline_id && !searchHide.has(o.id))
      .map((o) => ({ ...structuredClone(o), ...(searchStale.get(o.id) ?? {}) }));
    return ok({ opportunities: list, meta: searchMeta ? searchMeta(list) : { total: list.length, nextPage: null, nextPageUrl: null } });
  }
  if ((m = u.pathname.match(/^\/opportunities\/([^/]+)$/))) {
    const o = ghl.opps[m[1]]; if (!o) return notFound();
    if (method === 'PUT') {
      for (const f of req.body.customFields) { o.customFields = o.customFields.filter((x) => x.id !== f.id); if (f.field_value !== '' && f.field_value !== null) o.customFields.push({ id: f.id, fieldValue: f.field_value }); }
      const li = loseNext.findIndex((f) => f(req)); if (li >= 0) { loseNext.splice(li, 1); throw new Error('fixture: response lost'); }
      return ok({ succeded: true });
    }
    return ok({ opportunity: structuredClone(o) });
  }
  if ((m = u.pathname.match(/^\/contacts\/([^/]+)(\/notes)?$/))) {
    const c = ghl.contacts[m[1]]; if (!c) return notFound();
    if (m[2]) {
      if (method === 'POST') {
        const note = { id: `${c.id}-note-${c.notes.length}`, body: req.body.body }; c.notes.push(note);
        const li = loseNext.findIndex((f) => f(req)); if (li >= 0) { loseNext.splice(li, 1); throw new Error('fixture: response lost'); }
        return ok({ note });
      }
      return ok({ notes: structuredClone(c.notes) });
    }
    return ok({ contact: { id: c.id, locationId: config.locationId, customFields: [] } });
  }
  throw new Error('Unexpected mocked request: ' + method + ' ' + u.pathname);
};
const deal = (id, contactId, over = {}) => ({ id, locationId: config.locationId, contactId, pipelineId: PIPE, pipelineStageId: S.newLeadSeller, status: 'open', name: 'IAOS PROBE ' + id, customFields: [], createdAt: '2026-10-17T12:00:00.000Z', ...over });
function fresh() {
  receipts.clear(); etags.clear(); failNext = []; applyThenThrow = []; staleNext = []; calls = []; hooks = []; jar = null; sessionToken = null; loseNext = []; searchHide = new Set(); searchStale = new Map(); searchMeta = null; blobOps = 0;
  ghl = { contacts: { [X1]: { id: X1, notes: [] }, [X2]: { id: X2, notes: [] }, [X3]: { id: X3, notes: [] }, [OTHER]: { id: OTHER, notes: [] } }, opps: { [DA]: deal(DA, X1) } };
}
/** Bones F3: every OTHER pinned fixture contact needs clean ledger evidence (a valid, empty known-deal ledger) before a draft is trusted. */
function seedOtherLedgers(own) {
  for (const c of config.propertyAnswerEvaluation.fixtureContactIds) {
    if (c === own) continue;
    const lk = ledger.ledgerKey(SCOPE, c);
    if (!receipts.has(lk)) { receipts.set(lk, { v: 1, gen: 1, ids: {}, discoveries: {} }); etags.set(lk, 'seed-' + c); }
  }
}
const puts = () => calls.filter((c) => c.method === 'PUT').length;
const posts = () => calls.filter((c) => c.method === 'POST').length;
const ghlCount = () => calls.length;

const handler = require('../netlify/functions/property-answer.ts').handler;
const { CONTINUATION_COOKIE } = require('../netlify/functions/property-answer.ts');
const ghlWrite = require('../netlify/functions/ghl-write.ts').handler;
// One write session per scenario, like one signed-in page (continuation is bound to writer + session).
let sessionToken = null;
const session = () => (sessionToken ??= auth.issueAppSession('brad@example.invalid').token);
const identity = () => 'brad@example.invalid\n' + dg(session()); // what the endpoint derives from the validated session
const headers = () => ({ ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${session()}` });
let jar = null; // the browser's continuation cookie (name=value), as Set-Cookie left it
const withJar = (h) => (jar ? { ...h, cookie: jar } : h);
const keepCookie = (r) => { const c = r.headers && r.headers['Set-Cookie']; if (c) jar = c.split(';')[0]; return c || null; };
async function holdEvaluation() {
  // Setup only: skipped where the evaluation gate refuses anyway; its own Blob operations are not counted as the endpoint's.
  if (config.propertyAnswerEvaluation.enabled !== cfgMod.PROPERTY_ANSWER_EVALUATION_ENABLED || process.env.IAOS_ENV !== 'test') return;
  const ops = blobOps;
  const ev = config.propertyAnswerEvaluation; const now = new Date().toISOString();
  const b = new budgetLib.EvaluationBudget(memStore, SCOPE, ev.requestBudget.budgetId, ev.requestBudget.ceiling);
  const g = await b.grant('context', 0, now, null, identity()); const secret = crypto.randomBytes(32).toString('base64url');
  assert.equal(await b.settle(g.g, secret, now), true, 'setup: the checking session holds the evaluation');
  jar = `${CONTINUATION_COOKIE}=${g.g}.${secret}`;
  blobOps = ops;
}
async function post(b, h = headers()) { if (!keepBudget) { jar = null; for (const k of budgetKeys()) { receipts.delete(k); etags.delete(k); } if (b.action === 'check' && h.authorization === headers().authorization) await holdEvaluation(); } const r = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: withJar(h), body: JSON.stringify(b) }); const setCookie = keepCookie(r); return { status: r.statusCode, body: JSON.parse(r.body), setCookie }; }
const context = (c = X1, o = DA) => post({ action: 'context', contactId: c, opportunityId: o });
const ADDR = { street: '100 Probe Way', unit: '', city: 'McKinney', state: 'TX', zip: '75069' };
async function save(field, value, c = X1, o = DA, over = {}) {
  const ctx = (await context(c, o)).body;
  const addressDigest = field === 'property_address' ? model.EMPTY_ADDRESS_DIGEST : ctx.address?.digest;
  return post({ action: 'save', contactId: c, opportunityId: o, field, operationId: over.operationId ?? crypto.randomUUID(), value, expectedAddressDigest: over.expectedAddressDigest ?? addressDigest ?? model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: over.expectedDealSetDigest ?? ctx.verdict.digest });
}
const history = (op, c = X1, o = DA) => post({ action: 'history', contactId: c, opportunityId: o, operationId: op });
const check = (c = X1, o = DA) => post({ action: 'check', contactId: c, opportunityId: o });
async function commitAnswer(field, value, c = X1, o = DA) {
  const s = await save(field, value, c, o); assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.outcome, 'saved_history_pending', JSON.stringify(s.body));
  const h = await history(s.body.view.op, c, o); assert.equal(h.status, 200, JSON.stringify(h.body)); assert.equal(h.body.outcome, 'committed', JSON.stringify(h.body));
  return s.body.view.op;
}
const addrValue = (o = DA) => Object.fromEntries(['propertyStreet', 'propertyCity', 'propertyState', 'propertyZip'].map((k) => [k, (ghl.opps[o].customFields.find((f) => f.id === P[k]) || {}).fieldValue ?? null]));
const reasonOf = (o = DA) => (ghl.opps[o].customFields.find((f) => f.id === P.sellerReason) || {}).fieldValue ?? null;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

let finished = false;
process.on('exit', (code) => { if (!finished && code === 0) { console.error('FAIL the suite ended before it finished'); process.exitCode = 1; } });
let count = 0, failures = 0;
async function t(name, fn) {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n  ') : e)); }
}

(async () => {
  // ── Gates: nothing is read or written before them ─────────────────────────
  await t('gate: evaluation disabled (Production value) refuses every action with zero Blob and zero GHL', async () => {
    fresh(); const saved = config.propertyAnswerEvaluation.enabled; config.propertyAnswerEvaluation.enabled = cfgMod.PROPERTY_ANSWER_EVALUATION_DISABLED;
    try {
      for (const action of ['context', 'check']) { const r = await post({ action, contactId: X1, opportunityId: DA }); assert.equal(r.status, 403); assert.equal(r.body.code, 'evaluation_disabled'); }
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'x', expectedAddressDigest: 'a'.repeat(64), expectedDealSetDigest: 'b'.repeat(64) });
      assert.equal(r.body.code, 'evaluation_disabled');
      assert.equal(blobOps, 0); assert.equal(ghlCount(), 0);
    } finally { config.propertyAnswerEvaluation.enabled = saved; }
  });
  await t('gate: the committed Production config is disabled with no fixtures and no provisioned fields; a Production deployment refuses with zero Blob/GHL', async () => {
    fresh(); const prod = cfgMod.getConfig('production');
    assert.equal(prod.propertyAnswerEvaluation.enabled, cfgMod.PROPERTY_ANSWER_EVALUATION_DISABLED);
    assert.deepEqual([...prod.propertyAnswerEvaluation.fixtureContactIds, ...prod.propertyAnswerEvaluation.fixtureOpportunityIds], []);
    for (const v of Object.values(prod.propertyAnswerFields)) assert.equal(v, cfgMod.PROPERTY_ANSWER_FIELD_NOT_PROVISIONED);
    process.env.IAOS_ENV = 'production';
    try { const r = await context(); assert.equal(r.status, 403); assert.equal(r.body.code, 'evaluation_disabled'); }
    finally { process.env.IAOS_ENV = 'test'; }
    assert.equal(blobOps, 0); assert.equal(ghlCount(), 0);
  });
  await t('gate: a contact or deal that is not a pinned fixture is refused with zero Blob/GHL', async () => {
    fresh();
    assert.equal((await context(OTHER, DA)).body.code, 'not_a_fixture');
    assert.equal((await context(X1, NONFIX)).body.code, 'not_a_fixture');
    assert.equal(blobOps, 0); assert.equal(ghlCount(), 0);
  });
  await t('gate: sign-in and origin are required; undeclared keys, bad digests and invalid values are refused before Blob/GHL', async () => {
    fresh();
    assert.equal((await post({ action: 'context', contactId: X1, opportunityId: DA }, { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN })).status, 401);
    assert.equal((await post({ action: 'context', contactId: X1, opportunityId: DA }, { ...headers(), origin: 'https://evil.example.invalid' })).status, 403);
    assert.equal((await post({ action: 'context', contactId: X1, opportunityId: DA, extra: 1 })).status, 400);
    assert.equal((await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'x', expectedAddressDigest: 'nope', expectedDealSetDigest: 'b'.repeat(64) })).status, 400);
    for (const value of [{ ...ADDR, state: 'Texas' }, { ...ADDR, zip: '7506' }, { ...ADDR, street: ' ' }, { street: 'x' }]) {
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: 'b'.repeat(64) });
      assert.equal(r.status, 400, JSON.stringify(r.body));
    }
    assert.equal((await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'seller_reason', operationId: crypto.randomUUID(), value: '   ', expectedAddressDigest: 'a'.repeat(64), expectedDealSetDigest: 'b'.repeat(64) })).status, 400);
    assert.equal(blobOps, 0); assert.equal(ghlCount(), 0);
  });
  await t('gate: ghl-write refuses opportunity.sellerReason, opportunity.propertyAddress and a plain note carrying the history marker, with zero Blob/GHL (D8)', async () => {
    fresh();
    const w = (operation, targetId, args) => ghlWrite({ blobs: lambdaBlobs, httpMethod: 'POST', headers: headers(), body: JSON.stringify({ operation, targetId, requestId: crypto.randomUUID(), args }) });
    for (const [op, target, args] of [['opportunity.sellerReason', DA, { value: 'x' }], ['opportunity.propertyAddress', DA, ADDR], ['note.create', X1, { body: model.HISTORY_NOTE_MARK + '\noperation: x' }]]) {
      const r = await w(op, target, args); assert.equal(r.statusCode, 409, r.body); assert.equal(JSON.parse(r.body).outcome, 'not_sent');
    }
    assert.equal(blobOps, 0); assert.equal(ghlCount(), 0);
  });

  // ── Happy path and request budget ─────────────────────────────────────────
  await t('context: one eligible deal, address empty, digest returned; budget = 1 search + 1 deal GET + 1 contact GET', async () => {
    fresh();
    const r = await context(); assert.equal(r.status, 200);
    assert.equal(r.body.verdict.allowed, true); assert.equal(r.body.verdict.reason, 'allowed'); assert.match(r.body.verdict.digest, /^[0-9a-f]{64}$/);
    assert.equal(r.body.address.kind, 'empty'); assert.equal(r.body.values.seller_reason, null); assert.equal(r.body.operation, null);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /opportunities/search', `GET /opportunities/${DA}`, `GET /contacts/${X1}`]);
  });
  await t('address then Seller Reason: each S1 clean -> S2 history -> committed; exact history bodies; head released; draft cleared; previous-revision chains', async () => {
    fresh();
    await context();   // C1–C4 r4: a draft needs a prior observed contact/deal association
    seedOtherLedgers(X1);
    await post({ action: 'draft', contactId: X1, opportunityId: DA, field: 'seller_reason', value: 'draft text' });
    assert.equal((await context()).body.drafts.seller_reason, 'draft text');
    const before = ghlCount();
    const opA = await commitAnswer('property_address', { ...ADDR, street: '100   Probe Way', state: 'tx' });
    assert.deepEqual(addrValue(), { propertyStreet: '100 Probe Way', propertyCity: 'McKinney', propertyState: 'TX', propertyZip: '75069' });
    const ctx = (await context()).body; assert.equal(ctx.address.kind, 'confirmed');
    const opR = await commitAnswer('seller_reason', 'Line one\r\nLine two');
    assert.equal(reasonOf(), 'Line one\nLine two');
    const notes = ghl.contacts[X1].notes; assert.equal(notes.length, 2);
    const e1 = model.parseHistoryNote(notes[0].body), e2 = model.parseHistoryNote(notes[1].body);
    assert.equal(e1.operationId, opA); assert.equal(e1.field, 'property_address'); assert.equal(e1.previousDigest, 'none');
    assert.equal(e2.operationId, opR); assert.equal(e2.field, 'seller_reason'); assert.equal(e2.valueDigest, dg('Line one\nLine two')); assert.equal(e2.previousDigest, 'none');
    assert.deepEqual(e2.valueLines, ['Line one', 'Line two']); assert.equal(e2.environment, 'test'); assert.equal(e2.locationId, config.locationId);
    const opR2 = await commitAnswer('seller_reason', 'Changed reason');
    assert.equal(model.parseHistoryNote(ghl.contacts[X1].notes[2].body).previousDigest, dg('Line one\nLine two'), 'the chain link is the prior value digest');
    assert.equal(receipts.get(key.head(X1)).current, null);
    for (const op of [opA, opR, opR2]) assert.equal(receipts.get(key.final(op)).kind, 'committed');
    assert.equal((await context()).body.drafts.seller_reason, null, 'the draft is cleared once S1 lands');
    assert.equal(puts(), 3); assert.equal(posts(), 3); assert.ok(ghlCount() > before);
  });
  await t('request budget: a save is exactly 11 GHL requests (3 discovery + 2 pre-read + 1 PUT + 2 readback + 3 bracket) and history exactly 3 (contact, POST, notes); no retries', async () => {
    fresh();
    const ctx = (await context()).body; calls = [];
    const s = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(s.body.outcome, 'saved_history_pending');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /opportunities/search', `GET /opportunities/${DA}`, `GET /contacts/${X1}`, `GET /opportunities/${DA}`, `GET /contacts/${X1}`, `PUT /opportunities/${DA}`, `GET /opportunities/${DA}`, `GET /contacts/${X1}`, 'GET /opportunities/search', `GET /opportunities/${DA}`, `GET /contacts/${X1}`]);
    calls = []; const h = await history(s.body.view.op); assert.equal(h.body.outcome, 'committed');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [`GET /contacts/${X1}`, `POST /contacts/${X1}/notes`, `GET /contacts/${X1}/notes`]);
  });
  await t('a repeated save with the same operation id reports the recorded state and sends nothing again', async () => {
    fresh();
    const ctx = (await context()).body; const op = crypto.randomUUID();
    const body = { action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: op, value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest };
    assert.equal((await post(body)).body.outcome, 'saved_history_pending');
    const again = await post(body); assert.equal(again.body.outcome, 'saved_history_pending'); assert.equal(puts(), 1);
  });

  // ── Identity, address and deal-set refusals (0 PUT) ───────────────────────
  await t('r3 §4: Seller Reason without a confirmed address is refused (kept as a draft); an address initial set on a deal with an address is refused; a stale address digest is refused', async () => {
    fresh();
    assert.equal((await save('seller_reason', 'Why')).body.code, 'address_not_confirmed');
    seedOtherLedgers(X1);
    await post({ action: 'draft', contactId: X1, opportunityId: DA, field: 'seller_reason', value: 'Why' });
    await commitAnswer('property_address', ADDR);
    assert.equal((await save('property_address', { ...ADDR, street: '200 Other St' })).body.code, 'address_already_set');
    assert.equal((await save('seller_reason', 'Why', X1, DA, { expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST })).body.code, 'stale_address');
    ghl.opps[DA].customFields.find((f) => f.id === P.propertyZip).fieldValue = '7506'; // edited in GHL into an invalid address
    assert.equal((await save('seller_reason', 'Why')).body.code, 'address_not_confirmed');
    assert.equal((await context()).body.drafts.seller_reason, 'Why');
    assert.equal(puts(), 1, 'only the address initial set was ever sent');
  });
  await t('L3: a stale deal-set digest returns not_sent deal_set_changed, 0 PUT', async () => {
    fresh();
    const ctx = (await context()).body;
    ghl.opps[DB] = deal(DB, X1, { status: 'lost' }); // a settled deal appears: the digest changes, still allowed
    const r = await save('property_address', ADDR, X1, DA, { expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.code, 'deal_set_changed'); assert.equal(puts(), 0);
    assert.equal((await save('property_address', ADDR)).body.outcome, 'saved_history_pending', 'a fresh view with a won/lost deal set aside is allowed');
  });
  await t('r3 §2/§2A classification: two ELIGIBLE, ELIGIBLE + CONFLICT, ELIGIBLE + UNKNOWN status are blocked; LTN alone is eligible; won/lost/abandoned are set aside', async () => {
    fresh();
    ghl.opps[DB] = deal(DB, X2); ghl.opps[DC] = deal(DC, X2, { pipelineStageId: S.sellerFollowUp });
    assert.equal((await context(X2, DB)).body.verdict.reason, 'several_eligible');
    ghl.opps[DC].pipelineStageId = S.lostNotInterested; // open + Lost stage = CONFLICT
    assert.equal((await context(X2, DB)).body.verdict.reason, 'unresolved_deal');
    ghl.opps[DC].status = 'mystery';
    assert.equal((await context(X2, DB)).body.verdict.reason, 'unresolved_deal');
    for (const st of ['won', 'lost', 'abandoned']) { ghl.opps[DC].status = st; assert.equal((await context(X2, DB)).body.verdict.allowed, true, st); }
    ghl.opps[DB].pipelineStageId = S.longTermNurture; assert.equal((await context(X2, DB)).body.verdict.allowed, true, 'LTN is eligible');
    ghl.opps[DB].status = 'won'; assert.equal((await context(X2, DB)).body.verdict.reason, 'no_eligible');
    ghl.opps[DB].status = 'open'; ghl.opps[DB].pipelineStageId = S.sellerClosedWon; assert.equal((await context(X2, DB)).body.verdict.reason, 'unresolved_deal');
    assert.equal(puts(), 0);
  });
  await t('completeness rule: total != count, a next page, or the target missing from search -> search_incomplete, 0 PUT', async () => {
    fresh();
    searchMeta = (list) => ({ total: list.length + 1, nextPage: null }); assert.equal((await context()).body.verdict.reason, 'search_incomplete');
    searchMeta = (list) => ({ total: list.length, nextPage: 2 }); assert.equal((await context()).body.verdict.reason, 'search_incomplete');
    searchMeta = null; searchHide.add(DA); assert.equal((await context()).body.verdict.reason, 'search_incomplete');
    searchHide.clear(); const ctx = (await context()).body; searchHide.add(DA);
    assert.equal((await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest })).body.code, 'search_incomplete');
    assert.equal(puts(), 0);
  });
  await t('L2 coherence: a search stage or status that differs from the fresh read -> list_updating, 0 PUT', async () => {
    fresh();
    searchStale.set(DA, { pipelineStageId: S.contactInitiated }); assert.equal((await context()).body.verdict.reason, 'list_updating');
    searchStale.set(DA, { status: 'lost' }); assert.equal((await context()).body.verdict.reason, 'list_updating');
  });
  await t('L1 ledger: a known deal hidden from search is still read and counted (2 eligible -> blocked); a known deal that is deleted, reassigned or moved pipeline is UNKNOWN (blocked); entries remain', async () => {
    fresh();
    ghl.opps[DB] = deal(DB, X1, { status: 'lost' });
    await context(); // the ledger now knows DA and DB
    assert.deepEqual(Object.keys(receipts.get(key.ledger(X1)).ids).sort(), [DA, DB].sort());
    ghl.opps[DB].status = 'open'; searchHide.add(DB);
    assert.equal((await context()).body.verdict.reason, 'several_eligible', 'the hidden known deal is still evaluated');
    delete ghl.opps[DB]; assert.equal((await context()).body.verdict.reason, 'unresolved_deal', 'deleted');
    ghl.opps[DB] = deal(DB, OTHER); assert.equal((await context()).body.verdict.reason, 'unresolved_deal', 'reassigned');
    ghl.opps[DB] = deal(DB, X1, { pipelineId: 'otherPipeline00000001', status: 'lost' }); assert.equal((await context()).body.verdict.reason, 'unresolved_deal', 'moved pipeline');
    assert.ok(receipts.get(key.ledger(X1)).ids[DB], 'the entry remains (no silent removal)');
    assert.equal(puts(), 0);
  });
  await t('L4: the target moves to Lost between the evaluation and the boundary pre-read -> refused before the PUT; the attempt is proved unsent (Not saved); a new save is allowed after', async () => {
    fresh();
    const ctx = (await context()).body;
    onCall((req, all) => req.method === 'GET' && req.path === `/opportunities/${DA}` && all.filter((c) => c.path === `/opportunities/${DA}`).length === 3 /* context, discovery, boundary pre-read */, async () => { ghl.opps[DA].pipelineStageId = S.lostNotInterested; });
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: 'op-l4-000000001', value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.outcome, 'not_sent'); assert.equal(r.body.code, 'target_not_eligible'); assert.equal(puts(), 0);
    assert.equal(receipts.get(key.decision(rid('op-l4-000000001', 'S1', 1))).d, 'withdrawn');
    assert.equal(receipts.get(key.final('op-l4-000000001')).kind, 'not_saved'); assert.equal(receipts.get(key.head(X1)).current, null);
    ghl.opps[DA].pipelineStageId = S.newLeadSeller;
    assert.equal((await save('property_address', ADDR)).body.outcome, 'saved_history_pending');
  });
  await t('L5 / D7 / J3: a second eligible deal becomes visible right after the PUT -> confirmed_conditions_changed with discrepancy fields; S2 held; the head holds every new answer save', async () => {
    fresh();
    const ctx = (await context()).body;
    onCall((req) => req.method === 'PUT', async () => { ghl.opps[DN] = deal(DN, X1); });
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: 'op-l5-000000001', value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.outcome, 'saved_conditions_changed', JSON.stringify(r.body)); assert.equal(puts(), 1);
    const out = receipts.get(key.outcome(rid('op-l5-000000001', 'S1', 1)));
    assert.equal(out.kind, 'confirmed_conditions_changed'); assert.equal(out.discrepancy.deal_set_several_eligible, true); assert.equal(out.discrepancy.deal_set_changed, true);
    assert.ok(!receipts.has(key.permit('op-l5-000000001')));
    assert.equal((await history('op-l5-000000001')).body.code, 's1_not_clean'); assert.equal(posts(), 0);
    delete ghl.opps[DN];
    const held = await save('seller_reason', 'x'); assert.equal(held.body.outcome, 'held'); assert.equal(held.body.view.state, 'saved_conditions_changed');
    assert.equal(receipts.get(key.head(X1)).current, 'op-l5-000000001'); assert.equal(puts(), 1);
  });

  // ── Ledger fencing (proposal r4 §1; Bones F1-F7; r3 C1-C8) ────────────────
  await t('C1 a discovery that died after registering blocks every save (discovery_open) until the lease; then the next save recovers it: recovery record first, the token revoked, the save proceeds', async () => {
    fresh();
    const dead = new ledger.Discovery(memStore, SCOPE, X1); await dead.register(ago(10_000));
    assert.equal((await context()).body.verdict.reason, 'discovery_open');
    const ctx1 = (await context()).body; const r1 = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx1.verdict.digest });
    assert.equal(r1.body.code, 'discovery_open'); assert.equal(puts(), 0);
    const rec = receipts.get(key.ledger(X1)); rec.discoveries[dead.token].startedAt = ago(ledger.LEASE_MS + 5_000); receipts.set(key.ledger(X1), rec);
    const r2 = await save('property_address', ADDR); // context (no lock) cannot recover; save (lock) does
    assert.equal(r2.body.outcome, 'saved_history_pending', JSON.stringify(r2.body));
    const after = receipts.get(key.ledger(X1)).discoveries[dead.token];
    assert.equal(after.state, 'revoked'); assert.ok(after.revokedBy);
    assert.ok(receipts.has(ledger.recoveryKey(SCOPE, X1, dead.token)), 'recovery evidence recorded');
  });
  await t('C2 a deal seen only by a discovery that died before committing, and no longer visible at recovery, is NOT recovered (the disclosed residual) -- the recovery record shows the window', async () => {
    fresh();
    const dead = new ledger.Discovery(memStore, SCOPE, X1); await dead.register(ago(ledger.LEASE_MS + 5_000));
    // it "saw" DN, then died; DN is not visible to anyone afterwards
    await save('property_address', ADDR);
    const rec = receipts.get(key.ledger(X1));
    assert.equal(rec.ids[DN], undefined, 'not recovered: never committed and not visible at recovery');
    assert.equal(rec.discoveries[dead.token].state, 'revoked'); assert.ok(receipts.has(ledger.recoveryKey(SCOPE, X1, dead.token)));
  });
  await t('C3 the commit lands and then throws: the record is consistent (committed, ids present); that invocation treats the list as unconfirmed (0 PUT); the next save evaluates normally', async () => {
    fresh();
    await context();
    let n = 0; applyThenThrow.push((op, k) => op === 'setJSON' && k === key.ledger(X1) && ++n === 2); // register ok, commit applies then throws
    const ctx = { verdict: { digest: 'c'.repeat(64) } };
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.code, 'deal_set_unconfirmed'); assert.equal(puts(), 0);
    const rec = receipts.get(key.ledger(X1)); assert.equal(ledger.openTokens(rec).length, 0, 'no open intent left behind');
    assert.equal((await save('property_address', ADDR)).body.outcome, 'saved_history_pending');
  });
  await t('F1/F2/C4 a paused discovery revoked by recovery cannot commit -- not with its old etag, not after re-reading the post-recovery etag, not through its retry loop', async () => {
    fresh();
    const r = new ledger.Discovery(memStore, SCOPE, X1); await r.register(ago(ledger.LEASE_MS + 5_000));
    const rec = new ledger.Discovery(memStore, SCOPE, X1); await rec.register(new Date().toISOString());
    await rec.commit([{ id: DA, source: 'search' }], new Date().toISOString(), [r.token]);
    assert.equal(receipts.get(key.ledger(X1)).discoveries[r.token].state, 'revoked');
    await assert.rejects(r.commit([{ id: DN, source: 'search' }], new Date().toISOString()), ledger.Fenced);
    const { etag } = await ledger.readLedger(memStore, SCOPE, X1); assert.ok(etag); // R now holds the newest etag
    await assert.rejects(r.commit([{ id: DN, source: 'search' }], new Date().toISOString()), ledger.Fenced, 'etag freshness does not restore authority');
    assert.equal(receipts.get(key.ledger(X1)).ids[DN], undefined, 'its cached observation was never merged');
  });
  await t('F3 the stale invocation cannot re-register or mint a replacement token; a committed token cannot commit twice', async () => {
    fresh();
    const r = new ledger.Discovery(memStore, SCOPE, X1); await r.register(new Date().toISOString());
    await assert.rejects(r.register(new Date().toISOString()), ledger.Fenced);
    await r.commit([], new Date().toISOString());
    await assert.rejects(r.commit([], new Date().toISOString()), ledger.Fenced);
  });
  await t('F4 recovery naming a token that already completed normally cannot revoke it; recovery never revokes a token that is not older than the lease', async () => {
    fresh();
    const done = new ledger.Discovery(memStore, SCOPE, X1); await done.register(ago(ledger.LEASE_MS + 5_000)); await done.commit([], new Date().toISOString());
    const young = new ledger.Discovery(memStore, SCOPE, X1); await young.register(new Date().toISOString());
    const rec = new ledger.Discovery(memStore, SCOPE, X1); await rec.register(new Date().toISOString());
    await rec.commit([], new Date().toISOString(), [done.token, young.token]);
    const d = receipts.get(key.ledger(X1)).discoveries;
    assert.equal(d[done.token].state, 'committed'); assert.equal(d[young.token].state, 'open');
  });
  await t('F5 / C6 recovery or any new discovery racing the save gate: a discovery registered after the save\'s commit refuses the dispatch (0 PUT); a send already claimed stays possible S1 (withdrawal fails)', async () => {
    fresh();
    const ctx = (await context()).body;
    onCall((req, all) => req.method === 'GET' && req.path === `/opportunities/${DA}` && all.filter((c) => c.path === `/opportunities/${DA}`).length === 3 /* context, discovery, boundary pre-read */, async () => { await new ledger.Discovery(memStore, SCOPE, X1).register(new Date().toISOString()); });
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: 'op-f5-000000001', value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.outcome, 'not_sent'); assert.equal(r.body.code, 'fenced'); assert.equal(puts(), 0);
    assert.equal(receipts.get(key.final('op-f5-000000001')).kind, 'not_saved');
    // reverse order: the send is claimed first; a later withdrawal cannot turn it into "proved unsent"
    fresh(); const ctx2 = (await context()).body;
    onCall((req) => req.method === 'PUT', async () => { const w = await memStore.setJSON(key.decision(rid('op-f5-000000002', 'S1', 1)), { d: 'withdrawn' }, { onlyIfNew: true }); assert.equal(w.modified, false); });
    const r2 = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: 'op-f5-000000002', value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx2.verdict.digest });
    assert.equal(r2.body.outcome, 'saved_history_pending'); assert.equal(receipts.get(key.decision(rid('op-f5-000000002', 'S1', 1))).d, 'send');
  });
  await t('F6 / C7 the store is unavailable at register, commit or the gate: zero dispatch', async () => {
    for (const [label, nth] of [['register', 1], ['commit', 2], ['gate', 3]]) {
      fresh(); const ctx = (await context()).body;
      let n = 0; failNext.push((op, k) => op === 'setJSON' && k === key.ledger(X1) && ++n === nth);
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
      assert.equal(r.body.outcome, 'not_sent', label + ' ' + JSON.stringify(r.body)); assert.equal(puts(), 0, label);
    }
  });
  await t('F7 / C8 ids are add-only: no code path deletes from the ledger ids, and recovery keeps every prior id', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'known-deal-ledger.ts'), 'utf8');
    assert.ok(!/delete\s+[^;]*\.ids\b/.test(src) && !/\.ids\s*=\s*\{\s*\}/.test(src.replace('ids: {}', '')), 'no deletion from ids');
    fresh(); ghl.opps[DB] = deal(DB, X1, { status: 'lost' }); await context();
    const dead = new ledger.Discovery(memStore, SCOPE, X1); await dead.register(ago(ledger.LEASE_MS + 5_000));
    delete ghl.opps[DB]; await save('property_address', ADDR).catch(() => null);
    assert.ok(receipts.get(key.ledger(X1)).ids[DB], 'the prior id survives recovery');
  });

  // ── S1 crash and arbitration (r3 D1-D8; Bones G1-G5) ──────────────────────
  async function crashedS1(op, { decision = null, putApplied = false } = {}) {
    // The durable state a crashed save leaves behind: op, S1 attempt, head; optionally the send claim and GHL's applied PUT.
    const v = ADDR; const valueText = model.answerValueText('property_address', v);
    const holder = new budgetLib.EvaluationBudget(memStore, SCOPE, config.propertyAnswerEvaluation.requestBudget.budgetId, config.propertyAnswerEvaluation.requestBudget.ceiling).holderDigest(identity());
    receipts.set(key.op(op), { v: 1, access: { v: 1, writer: 'brad@example.invalid', holder }, op, contactId: X1, opportunityId: DA, field: 'property_address', valueText, valueDigest: dg(valueText), valueLines: model.historyValueLines('property_address', v), expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, dealSetDigest: 'd'.repeat(64), createdAt: new Date().toISOString() }); etags.set(key.op(op), 'e-op');
    receipts.set(key.attempt(op, 'S1', 1), { v: 1, op, slot: 'S1', n: 1, requestId: rid(op, 'S1', 1) }); etags.set(key.attempt(op, 'S1', 1), 'e-at');
    receipts.set(key.head(X1), { v: 1, current: op }); etags.set(key.head(X1), 'e-head');
    if (decision) { receipts.set(key.decision(rid(op, 'S1', 1)), { d: decision }); etags.set(key.decision(rid(op, 'S1', 1)), 'e-d'); }
    if (putApplied) ghl.opps[DA].customFields.push(...['street', 'unit', 'city', 'state', 'zip'].filter((k) => v[k]).map((k) => ({ id: P['property' + k[0].toUpperCase() + k.slice(1)], fieldValue: v[k] })));
  }
  await t('D1 a crash before the send claim: Check again withdraws it (proved unsent) -> Not saved, head released; a new save is allowed', async () => {
    fresh(); await crashedS1('op-d1-000000001');
    const c = await check(); assert.equal(c.body.outcome, 'not_saved');
    assert.equal(receipts.get(key.decision(rid('op-d1-000000001', 'S1', 1))).d, 'withdrawn'); assert.equal(receipts.get(key.head(X1)).current, null);
    assert.equal((await save('property_address', ADDR)).body.outcome, 'saved_history_pending'); assert.equal(puts(), 1);
  });
  await t('D2 a crash after the send claim, before the PUT: uncertain (never proved unsent); every new answer save and S2 are refused; 0 resends', async () => {
    fresh(); await crashedS1('op-d2-000000001', { decision: 'send' });
    assert.equal((await check()).body.outcome, 'not_confirmed');
    assert.equal(receipts.get(key.outcome(rid('op-d2-000000001', 'S1', 1))).kind, 'uncertain');
    assert.equal((await save('seller_reason', 'x')).body.outcome, 'held');
    assert.equal((await history('op-d2-000000001')).body.code, 's1_not_clean');
    assert.equal(puts(), 0); assert.equal(posts(), 0);
  });
  await t('D3 / D6 a crash after GHL applied the PUT, before the outcome: uncertain; a read-only check observes the value equal and records it, but the state stays uncertain -- no S2, no resend', async () => {
    fresh(); await crashedS1('op-d3-000000001', { decision: 'send', putApplied: true });
    assert.equal((await check()).body.outcome, 'not_confirmed');
    assert.equal((await check()).body.outcome, 'not_confirmed', 'checking again changes nothing');
    const obs = [...receipts.entries()].filter(([k]) => k.startsWith('pa/observation/')).map(([, v]) => v);
    assert.ok(obs.length >= 1 && obs.every((o) => o.equalsIntended === true), JSON.stringify(obs));
    assert.equal((await history('op-d3-000000001')).body.code, 's1_not_clean');
    assert.equal(puts(), 0); assert.equal(posts(), 0);
  });
  await t('D4 the send-claim write applies and then throws: the original does not dispatch; withdrawal fails; the attempt is uncertain after Check again (0 PUT)', async () => {
    fresh(); const ctx = (await context()).body;
    applyThenThrow.push((op, k) => op === 'setJSON' && k === key.decision(rid('op-d4-000000001', 'S1', 1)));
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: 'op-d4-000000001', value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.outcome, 'not_sent'); assert.equal(r.body.code, 'claim_ambiguous'); assert.equal(puts(), 0);
    assert.equal(receipts.get(key.decision(rid('op-d4-000000001', 'S1', 1))).d, 'send', 'the landed claim stands');
    assert.equal((await check()).body.outcome, 'not_confirmed'); assert.equal(puts(), 0);
  });
  await t('D5 recovery withdraws first (during the boundary pre-read): the original\'s send claim loses and nothing is dispatched; Not saved', async () => {
    fresh(); const ctx = (await context()).body;
    onCall((req, all) => req.method === 'GET' && req.path === `/opportunities/${DA}` && all.filter((c) => c.path === `/opportunities/${DA}`).length === 3 /* context, discovery, boundary pre-read */, async () => { await memStore.setJSON(key.decision(rid('op-d5-000000001', 'S1', 1)), { d: 'withdrawn' }, { onlyIfNew: true }); });
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: 'op-d5-000000001', value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.code, 'claim_lost'); assert.equal(puts(), 0); assert.equal(receipts.get(key.final('op-d5-000000001')).kind, 'not_saved');
  });
  await t('G1 recovery records uncertain while the original is paused after GHL success; the original\'s confirmed_clean create conflicts: zero S2, no resend, head held, the uncertain outcome unchanged', async () => {
    fresh(); const ctx = (await context()).body; const op = 'op-g1-000000001';
    onCall((req, all) => req.method === 'GET' && req.path === `/opportunities/${DA}` && all.filter((c) => c.path === `/opportunities/${DA}`).length === 5 /* context, discovery, pre-read, PUT, then the boundary readback */, async () => {
      await memStore.setJSON(key.outcome(rid(op, 'S1', 1)), { v: 1, op, slot: 'S1', n: 1, requestId: rid(op, 'S1', 1), kind: 'uncertain', valueDigest: 'x', readbackDigest: null, previousDigest: null, discrepancy: null, at: 'recovery' }, { onlyIfNew: true });
    });
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: op, value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.outcome, 'not_confirmed', JSON.stringify(r.body)); assert.equal(puts(), 1);
    assert.equal(receipts.get(key.outcome(rid(op, 'S1', 1))).at, 'recovery', 'unchanged');
    assert.ok(!receipts.has(key.permit(op)));
    assert.equal((await history(op)).body.code, 's1_not_clean'); assert.equal(posts(), 0);
    assert.equal((await save('seller_reason', 'x')).body.outcome, 'held'); assert.equal(puts(), 1);
  });
  await t('G2 the original\'s confirmed_clean is acknowledged first; a later uncertain create conflicts and cannot overwrite it; S2 still runs only through the current-attempt gate', async () => {
    fresh(); const s = await save('property_address', ADDR); const op = s.body.view.op;
    const w = await memStore.setJSON(key.outcome(rid(op, 'S1', 1)), { kind: 'uncertain' }, { onlyIfNew: true });
    assert.equal(w.modified, false); assert.equal(receipts.get(key.outcome(rid(op, 'S1', 1))).kind, 'confirmed_clean');
    const other = await save('seller_reason', 'x'); assert.equal(other.body.outcome, 'held', 'S2 pending still holds the contact');
    assert.equal((await history(op)).body.outcome, 'committed'); assert.equal(posts(), 1);
  });
  await t('G3 the confirmed_clean create lands and its acknowledgement is lost: no S2 permit, history refused (held for reconciliation), no S1 retry', async () => {
    fresh(); const ctx = (await context()).body; const op = 'op-g3-000000001';
    applyThenThrow.push((o, k) => o === 'setJSON' && k === key.outcome(rid(op, 'S1', 1)));
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: op, value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.match(r.body.message, /Held for reconciliation/); assert.equal(receipts.get(key.outcome(rid(op, 'S1', 1))).kind, 'confirmed_clean');
    assert.ok(!receipts.has(key.permit(op)));
    assert.equal((await history(op)).body.code, 's1_not_acknowledged'); assert.equal(posts(), 0); assert.equal(puts(), 1);
  });
  await t('G4 a stale (missing) outcome read, another operation\'s clean outcome, a changed head, or changed evidence digests: zero S2', async () => {
    fresh(); const s = await save('property_address', ADDR); const op = s.body.view.op;
    { const sk = key.outcome(rid(op, 'S1', 1)); staleNext.push((k) => k === sk); }
    assert.equal((await history(op)).body.code, 's1_not_clean', 'missing read = not established');
    const real = receipts.get(key.outcome(rid(op, 'S1', 1)));
    receipts.set(key.outcome(rid(op, 'S1', 1)), { ...real, valueDigest: 'f'.repeat(64) });
    assert.equal((await history(op)).body.code, 's1_not_clean', 'conflicting evidence digest');
    receipts.set(key.outcome(rid(op, 'S1', 1)), { ...real, op: 'another-op-0000001' });
    assert.equal((await history(op)).body.code, 's1_not_clean', "another operation's record");
    receipts.set(key.outcome(rid(op, 'S1', 1)), real);
    const head = receipts.get(key.head(X1)); receipts.set(key.head(X1), { ...head, current: 'someone-else-0001' });
    assert.equal((await history(op)).body.code, 'not_current');
    receipts.set(key.head(X1), head);
    // the S1 outcome changes between the S2 gate's first read and the dispatch claim
    onCall((req) => req.method === 'GET' && req.path === `/contacts/${X1}`, async () => { receipts.set(key.outcome(rid(op, 'S1', 1)), { ...real, readbackDigest: 'e'.repeat(64) }); });
    assert.equal((await history(op)).body.code, 's1_not_clean');
    assert.equal(posts(), 0);
  });
  await t('S2 states: refused before sending -> proved unsent -> the explicit retry uses attempt 2; a lost note response -> history unresolved; Check again commits only on the exact complete entry', async () => {
    fresh(); const s = await save('property_address', ADDR); const op = s.body.view.op;
    failNext.push((o, k) => o === 'setJSON' && k === key.decision(rid(op, 'S2', 1)));
    const r1 = await history(op); assert.equal(r1.body.outcome, 'not_sent'); assert.equal(posts(), 0);
    assert.equal(receipts.get(key.decision(rid(op, 'S2', 1))).d, 'withdrawn');
    loseNext.push((req) => req.method === 'POST');
    const r2 = await history(op); assert.equal(r2.body.outcome, 'history_unresolved'); assert.equal(posts(), 1);
    assert.ok(receipts.has(key.attempt(op, 'S2', 2)));
    assert.equal((await history(op)).body.code, 'history_unresolved', 'never resent');
    ghl.contacts[X1].notes.push({ id: 'dup', body: ghl.contacts[X1].notes[0].body.replace('call-segment: none', 'call-segment: other') });
    assert.equal((await check()).body.outcome, 'history_unresolved', 'a partial match is a discrepancy');
    ghl.contacts[X1].notes.pop();
    assert.equal((await check()).body.outcome, 'committed', 'exactly one complete entry and the current value matches');
    assert.equal(posts(), 1); assert.equal(receipts.get(key.head(X1)).current, null);
  });
  await t('S2 reconciliation: the field changed outside IAOS after the note -> stays unresolved', async () => {
    fresh(); const s = await save('property_address', ADDR); const op = s.body.view.op;
    loseNext.push((req) => req.method === 'POST'); await history(op);
    ghl.opps[DA].customFields.find((f) => f.id === P.propertyStreet).fieldValue = '999 Changed St';
    assert.equal((await check()).body.outcome, 'history_unresolved');
  });
  await t('drafts: server-side, keyed by contact/deal/field; an address draft may be partial; invalid shapes are refused; drafts survive a refused save', async () => {
    fresh();
    await context(); seedOtherLedgers(X1); const before = ghlCount();   // C1–C4 r4: a draft needs a prior observed contact/deal association
    assert.equal((await post({ action: 'draft', contactId: X1, opportunityId: DA, field: 'property_address', value: { street: '1 Partial', unit: '', city: '', state: '', zip: '' } })).body.outcome, 'draft_saved');
    assert.equal((await post({ action: 'draft', contactId: X1, opportunityId: DA, field: 'property_address', value: { street: 1 } })).status, 400);
    assert.equal((await post({ action: 'draft', contactId: X1, opportunityId: DA, field: 'seller_reason', value: 'x'.repeat(4001) })).status, 400);
    assert.equal((await context()).body.drafts.property_address.street, '1 Partial');
    assert.equal(ghlCount() - before - 3, 0, 'drafts never call GHL (the 3 calls are the context read)');
  });
  await t('lock: a save while another write holds the contact lock is refused before any GHL call', async () => {
    fresh(); const ctx = (await context()).body; calls = [];
    const lockKey = 'lock/' + dg(config.locationId + X1); receipts.set(lockKey, { claimedAt: 'x' }); etags.set(lockKey, 'e');
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.code, 'locked'); assert.equal(ghlCount(), 0);
  });

  // ── Bones's review of 525d7c2: F1-F4 regressions ──────────────────────────
  await t('F1 (Bones probe) missing, partial, malformed or contradictory pagination metadata never passes the page: context blocked search_incomplete, 0 PUT', async () => {
    const metas = [
      ['meta {total:1} only (Bones)', (l) => ({ total: l.length })],
      ['nextPage missing', (l) => ({ total: l.length, nextPageUrl: null })],
      ['nextPageUrl missing', (l) => ({ total: l.length, nextPage: null })],
      ['meta missing', null],
      ['nextPage 0', (l) => ({ total: l.length, nextPage: 0, nextPageUrl: null })],
      ['nextPage ""', (l) => ({ total: l.length, nextPage: '', nextPageUrl: null })],
      ['nextPage "null"', (l) => ({ total: l.length, nextPage: 'null', nextPageUrl: null })],
      ['contradictory', (l) => ({ total: l.length, nextPage: null, nextPageUrl: 'https://x.invalid/p2' })],
      ['total 1.5', (l) => ({ total: 1.5, nextPage: null, nextPageUrl: null })],
      ['total "1"', (l) => ({ total: String(l.length), nextPage: null, nextPageUrl: null })],
      ['meta array', () => []],
    ];
    for (const [label, meta] of metas) {
      fresh();
      searchMeta = meta === null ? () => undefined : meta;
      const r = await context();
      assert.equal(r.body.verdict?.allowed, false, label); assert.equal(r.body.verdict?.reason, 'search_incomplete', label);
    }
    fresh(); searchMeta = (l) => ({ total: l.length, nextPage: null, nextPageUrl: null });
    assert.equal((await context()).body.verdict.allowed, true, 'explicit terminal evidence passes the bounded page check');
    assert.equal(puts(), 0);
  });
  await t('F2 (Bones probe) a discovery opened during the post-write bracket: confirmed_conditions_changed (discovery_open), no S2 permit, history refused with 0 POST, head held', async () => {
    fresh(); const ctx = (await context()).body; const op = 'op-f2a-00000001';
    onCall((req, all) => req.path === '/opportunities/search' && all.filter((c) => c.path === '/opportunities/search').length === 3 /* context, evaluation, bracket */,
      async () => { await new ledger.Discovery(memStore, SCOPE, X1).register(new Date().toISOString()); });
    const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: op, value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
    assert.equal(r.body.outcome, 'saved_conditions_changed', JSON.stringify(r.body));
    const out = receipts.get(key.outcome(rid(op, 'S1', 1)));
    assert.equal(out.kind, 'confirmed_conditions_changed'); assert.equal(out.discrepancy.discovery_open, true); assert.equal(out.discrepancy.deal_set_unconfirmed, true);
    assert.ok(!receipts.has(key.permit(op)));
    assert.equal((await history(op)).body.code, 's1_not_clean'); assert.equal(posts(), 0);
    assert.equal(receipts.get(key.head(X1)).current, op);
  });
  await t('F2 the bracket\'s own confirmation or commit fails: deal_set_unconfirmed, no permit, 0 POST', async () => {
    for (const [label, nth] of [['bracket commit', 5], ['bracket confirmation', 6]]) {
      fresh(); const ctx = (await context()).body; const op = `op-f2b-${nth}-0000001`;
      let n = 0; failNext.push((o, k) => o === 'setJSON' && k === key.ledger(X1) && ++n === nth); // register, commit, gate, bracket register, bracket commit, bracket confirm
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: op, value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
      assert.equal(r.body.outcome, 'saved_conditions_changed', label + ' ' + JSON.stringify(r.body));
      assert.equal(receipts.get(key.outcome(rid(op, 'S1', 1))).discrepancy.deal_set_unconfirmed, true, label);
      assert.ok(!receipts.has(key.permit(op)), label); assert.equal(puts(), 1, label);
      assert.equal((await history(op)).body.code, 's1_not_clean', label); assert.equal(posts(), 0, label);
    }
  });
  await t('F2 a discovery opened after a clean save and before history: history refused (discovery_open), 0 POST; once that discovery commits, the explicit history call proceeds', async () => {
    fresh(); const s = await save('property_address', ADDR); assert.equal(s.body.outcome, 'saved_history_pending'); const op = s.body.view.op;
    const d = new ledger.Discovery(memStore, SCOPE, X1); await d.register(new Date().toISOString());
    assert.equal((await history(op)).body.code, 'discovery_open'); assert.equal(posts(), 0);
    await d.commit([], new Date().toISOString());
    assert.equal((await history(op)).body.outcome, 'committed'); assert.equal(posts(), 1);
  });
  await t('S2 gate: a malformed or mis-identified clean S1 record (slot, request id, digest schema, discrepancy) or a malformed permit refuses history with 0 POST', async () => {
    const tamper = [
      ['slot', (r) => ({ ...r, slot: 'S2' })], ['requestId', (r) => ({ ...r, requestId: 'other-S1-1' })], ['n', (r) => ({ ...r, n: 2 })],
      ['readbackDigest', (r) => ({ ...r, readbackDigest: 'not-a-digest' })], ['previousDigest', (r) => ({ ...r, previousDigest: 5 })],
      ['discrepancy', (r) => ({ ...r, discrepancy: {} })], ['v', (r) => ({ ...r, v: 2 })],
    ];
    for (const [label, fn] of tamper) {
      fresh(); const s = await save('property_address', ADDR); const op = s.body.view.op;
      receipts.set(key.outcome(rid(op, 'S1', 1)), fn(receipts.get(key.outcome(rid(op, 'S1', 1)))));
      assert.equal((await history(op)).body.code, 's1_not_clean', label); assert.equal(posts(), 0, label);
    }
    fresh(); const s = await save('property_address', ADDR); const op = s.body.view.op;
    receipts.set(key.permit(op), { ...receipts.get(key.permit(op)), requestId: 'x' });
    assert.equal((await history(op)).body.code, 's1_not_acknowledged'); assert.equal(posts(), 0);
  });
  const client = require('../src/lib/property-answer-client.ts');
  await t('F3 (Bones probe) the client sends history automatically ONLY after its own acknowledged save of the same operation -- never after Check again, a refresh or any other reply', async () => {
    const pending = (op, message = opLib.SAVED_RECORDING) => ({ status: 200, body: { outcome: 'saved_history_pending', view: { op, state: 'saved_history_pending' }, message } });
    assert.equal(client.SAVED_RECORDING, opLib.SAVED_RECORDING, 'client and server agree on the save message');
    assert.deepEqual(client.followUpAfter({ action: 'save', operationId: 'op-1' }, pending('op-1')), { action: 'history', operationId: 'op-1' });
    assert.equal(client.followUpAfter({ action: 'check', contactId: X1, opportunityId: DA }, pending('op-1')), null, 'Check again');
    assert.equal(client.followUpAfter({ action: 'context', contactId: X1, opportunityId: DA }, pending('op-1')), null, 'refresh');
    assert.equal(client.followUpAfter({ action: 'history', operationId: 'op-1' }, pending('op-1')), null, 'history itself');
    assert.equal(client.followUpAfter({ action: 'save', operationId: 'op-2' }, pending('op-1')), null, 'another operation');
    assert.equal(client.followUpAfter({ action: 'save', operationId: 'op-1' }, { ...pending('op-1'), status: 409 }), null, 'not 200');
    assert.equal(client.followUpAfter({ action: 'save', operationId: 'op-1' }, pending('op-1', 'Already recorded.')), null, 'a repeated save');
    assert.equal(client.followUpAfter({ action: 'save', operationId: 'op-1' }, pending('op-1', 'Saved in GHL; history permission could not be confirmed. Held for reconciliation.')), null, 'no permit');
    const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PropertyAnswersPanel.tsx'), 'utf8');
    assert.equal((panel.match(/action: "history"/g) || []).length, 1, 'the only literal history action is the explicit Record history button');
    assert.ok(panel.includes('followUpAfter(body, r)'), 'run() uses the pure rule');
  });
  await t('F3 a lost save response, then Check again: the server reports saved_history_pending and the client rule sends nothing -- 0 POST', async () => {
    fresh(); const s = await save('property_address', ADDR); assert.equal(s.body.outcome, 'saved_history_pending'); // the page never saw this reply
    const body = { action: 'check', contactId: X1, opportunityId: DA };
    const c = await post(body); assert.equal(c.body.outcome, 'saved_history_pending');
    assert.equal(client.followUpAfter(body, c), null); assert.equal(posts(), 0);
  });

  // F4: the enforced budget, run with the COMMITTED values (40, one candidate) and kept across calls.
  async function withCommittedBudget(fn) {
    const saved = { b: config.propertyAnswerEvaluation.requestBudget, m: config.propertyAnswerEvaluation.maxCandidates };
    config.propertyAnswerEvaluation.requestBudget = { ...COMMITTED_BUDGET }; config.propertyAnswerEvaluation.maxCandidates = 1; keepBudget = true;
    try { await fn(); } finally { config.propertyAnswerEvaluation.requestBudget = saved.b; config.propertyAnswerEvaluation.maxCandidates = saved.m; keepBudget = false; }
  }
  const budgetRec = () => receipts.get(budgetKeys()[0]);
  await t('F4 the planned sequence E1-E4 uses exactly the 40 committed requests; every request has a receipt recorded before it was sent, in order; the 41st is refused unsent and the budget stops', async () => {
    await withCommittedBudget(async () => {
      fresh();
      const sent = [];
      const e1 = await context(); assert.equal(e1.body.verdict.allowed, true);
      seedOtherLedgers(X1);   // Bones F3: drafts need clean ledger evidence for every other pinned contact (setup; zero GHL)
      await post({ action: 'draft', contactId: X1, opportunityId: DA, field: 'seller_reason', value: 'Draft reason' });
      const e2 = await context(); assert.equal(e2.body.drafts.seller_reason, 'Draft reason');
      let ctx = e2.body; // the panel saves with the view it holds, then refreshes once after each run
      for (const [field, value] of [['property_address', ADDR], ['seller_reason', 'Line 1\nLine 2\nLine 3']]) {
        const op = crypto.randomUUID();
        const sv = await post({ action: 'save', contactId: X1, opportunityId: DA, field, operationId: op, value, expectedAddressDigest: ctx.address.digest, expectedDealSetDigest: ctx.verdict.digest });
        assert.equal(sv.body.outcome, 'saved_history_pending', JSON.stringify(sv.body));
        assert.equal((await history(op)).body.outcome, 'committed');
        ctx = (await context()).body; // the panel's refresh after the run
        sent.push(op);
      }
      const rec = budgetRec();
      assert.equal(calls.length, 3 + 3 + (11 + 3 + 3) + (11 + 3 + 3), 'E1 open, E2 reload, E3 save+history+refresh, E4 save+history+refresh');
      assert.equal(rec.calls, calls.length); assert.equal(rec.reserved, calls.length);
      assert.deepEqual(rec.attempts.map((a) => `${a.method} ${a.path}`), calls.map((c) => `${c.method} ${c.path}`), 'one receipt per request, same order');
      assert.equal(rec.calls, 40); assert.equal(rec.stopped, null);
      assert.ok(rec.grants.length === 8 && rec.grants.every((g) => g.settled && g.settled.result === 'clean'), 'every granted action settled its grant clean');
      const before = calls.length;
      const extra = await context(); assert.equal(extra.status, 409); assert.equal(extra.body.code, 'budget_exhausted');
      assert.equal(calls.length, before, 'refused unsent'); assert.ok(budgetRec().stopped);
      assert.equal(reasonOf(), 'Line 1\nLine 2\nLine 3'); assert.equal(ghl.contacts[X1].notes.length, 2);
    });
  });
  await t('F4 a save never starts without all of its planned requests: refused unsent, the budget stops, and nothing after it sends', async () => {
    await withCommittedBudget(async () => {
      fresh(); config.propertyAnswerEvaluation.requestBudget = { budgetId: 'b15-04-eval-1', ceiling: 13 };
      const ctx = (await context()).body; const before = calls.length;
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
      assert.equal(r.body.code, 'budget_exhausted'); assert.equal(calls.length, before); assert.ok(budgetRec().stopped);
    });
  });
  await t('F4 an extra candidate deal is unexpected work: stop after the search, read no candidate, refuse everything after (budget_stopped, 0 GHL)', async () => {
    await withCommittedBudget(async () => {
      fresh(); ghl.opps[DB] = deal(DB, X1, { status: 'lost' }); // a second known deal
      const r = await context(); assert.equal(r.body.code, 'unexpected_candidates', JSON.stringify(r.body));
      assert.deepEqual(calls.map((c) => c.path), ['/opportunities/search'], 'no candidate was read'); assert.ok(budgetRec().stopped);
      const before = calls.length;
      const s = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: 'a'.repeat(64) });
      assert.equal(s.body.code, 'budget_stopped'); assert.equal(calls.length, before);
    });
  });
  await t('F4 any unexpected result stops the evaluation for good; Check again still settles stored evidence with 0 GHL requests', async () => {
    await withCommittedBudget(async () => {
      fresh(); ghl.opps[DA].status = 'lost';
      assert.equal((await context()).body.verdict.allowed, false); assert.ok(budgetRec().stopped);
      ghl.opps[DA].status = 'open'; const before = calls.length;
      assert.equal((await context()).body.code, 'budget_stopped'); assert.equal(calls.length, before);
      const c = await check(); assert.equal(c.status, 200); assert.equal(calls.length, before, 'check made no GHL request');
    });
  });
  await t('F4 a PUT whose response is lost stays uncertain: held, the budget stops, no resend; Check again sends nothing', async () => {
    await withCommittedBudget(async () => {
      fresh(); const ctx = (await context()).body;
      loseNext.push((req) => req.method === 'PUT');
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: 'op-f4-put-000001', value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
      assert.equal(r.body.outcome, 'not_confirmed'); assert.equal(puts(), 1); assert.ok(budgetRec().stopped);
      assert.equal((await check()).body.outcome, 'not_confirmed'); assert.equal(puts(), 1); assert.equal(posts(), 0);
    });
  });
  await t('F4 a receipt that cannot be recorded means the request is not sent', async () => {
    await withCommittedBudget(async () => {
      fresh(); let n = 0; failNext.push((o, k) => o === 'setJSON' && k.startsWith('pa/eval-budget/') && ++n === 2); // grant ok, first receipt fails
      const r = await context(); assert.equal(calls.length, 0, 'nothing sent'); assert.equal(r.body.verdict?.allowed ?? false, false); assert.ok(budgetRec().stopped);
    });
  });
  await t('F4 a grant cannot be overdrawn: the request past its planned count is refused unsent', async () => {
    fresh(); const b = new budgetLib.EvaluationBudget(memStore, SCOPE, 'direct-test', 10);
    const g = await b.grant('context', 1, new Date().toISOString(), null, 'unit\nsession-a'); const f = g.fetcher(() => new Date().toISOString());
    await f('https://services.leadconnectorhq.com/contacts/' + X1); const before = calls.length;
    await assert.rejects(f('https://services.leadconnectorhq.com/contacts/' + X1), (e) => e.code === 'grant_exceeded'); assert.equal(calls.length, before);
    await assert.rejects(f('https://services.leadconnectorhq.com/contacts/' + X1), (e) => e.code === 'stopped', 'a refused grant refuses everything after'); assert.equal(calls.length, before);
    await assert.rejects(b.grant('context', 1, new Date().toISOString(), null, 'unit\nsession-a'), (e) => e.code === 'unsettled', 'the unsettled grant keeps the budget closed');
    const g2 = await new budgetLib.EvaluationBudget(memStore, SCOPE, 'direct-test-2', 10).grant('context', 1, new Date().toISOString(), null, 'unit\nsession-a');
    await assert.rejects(g2.fetcher(() => new Date().toISOString())('https://example.invalid/x'), budgetLib.TransportRefused, 'only GHL');
  });

  // Bones's b729e33 re-review, F4 remaining blocker 1: a generic transport failure stops the action.
  const searchFails = (nth = 1) => { let n = 0; onCall((r) => r.path === '/opportunities/search' && ++n === nth, () => { throw new TypeError('fetch failed'); }); };
  await t('F4r1 a generic transport failure on the context search: zero further GHL requests in the action; search_incomplete; the budget stops; later actions send nothing', async () => {
    await withCommittedBudget(async () => {
      fresh(); searchFails();
      const r = await context(); assert.equal(r.body.verdict.allowed, false); assert.equal(r.body.verdict.reason, 'search_incomplete');
      assert.deepEqual(calls.map((c) => c.path), ['/opportunities/search'], 'no candidate was read after the failed search');
      assert.equal(budgetRec().attempts.length, 1); assert.ok(budgetRec().stopped);
      const s = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: r.body.verdict.digest });
      assert.equal(s.body.code, 'budget_stopped'); assert.equal(calls.length, 1);
    });
  });
  await t('F4r1 a generic transport failure on the save evaluation search: not sent, zero further GHL requests, 0 PUT, the budget stops', async () => {
    await withCommittedBudget(async () => {
      fresh(); const ctx = (await context()).body; const before = calls.length; searchFails();
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
      assert.equal(r.body.outcome, 'not_sent', JSON.stringify(r.body));
      assert.deepEqual(calls.slice(before).map((c) => c.path), ['/opportunities/search']); assert.equal(puts(), 0); assert.ok(budgetRec().stopped);
    });
  });
  await t('F4r1 a generic transport failure on the post-write bracket search: confirmed_conditions_changed, the search was the last request of the action, no permit, 0 POST, the budget stops', async () => {
    await withCommittedBudget(async () => {
      fresh(); const ctx = (await context()).body; const before = calls.length; searchFails(2); // the save's second (bracket) search
      const op = crypto.randomUUID();
      const r = await post({ action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: op, value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
      assert.equal(r.body.view.s1, 'confirmed_conditions_changed', JSON.stringify(r.body));
      const mine = calls.slice(before);
      assert.equal(mine.length, 9, 'evaluation 3 + pre-read 2 + PUT + readback 2 + the failed bracket search'); assert.equal(mine[8].path, '/opportunities/search');
      assert.ok(![...receipts.keys()].some((k) => k.startsWith('pa/s2-permit/'))); assert.ok(budgetRec().stopped);
      const h = await history(op); assert.equal(h.body.code, 'budget_stopped'); assert.equal(posts(), 0); assert.equal(calls.length, before + 9);
    });
  });
  await t('F4r1 Grant: a generic error from the network poisons the grant -- the next request is refused without reaching the network', async () => {
    fresh(); const b = new budgetLib.EvaluationBudget(memStore, SCOPE, 'direct-generic', 10);
    const g = await b.grant('context', 3, new Date().toISOString(), null, 'unit\nsession-a'); let sent = 0;
    const f = g.fetcher(() => new Date().toISOString(), async () => { sent++; throw new TypeError('fetch failed'); });
    await assert.rejects(f('https://services.leadconnectorhq.com/opportunities/search'), TypeError);
    await assert.rejects(f('https://services.leadconnectorhq.com/opportunities/' + DA), (e) => e.code === 'stopped');
    assert.equal(sent, 1); assert.equal((await b.snapshot()).attempts.length, 1, 'no receipt for the refused request');
  });

  // F4 remaining blocker 2: the stop is durable and fail-closed; nothing in memory is relied on across invocations.
  const isStop = (o, k, v) => o === 'setJSON' && k.startsWith('pa/eval-budget/') && v && v.stopped;
  const isClean = (o, k, v) => o === 'setJSON' && k.startsWith('pa/eval-budget/') && v && v.grants.length && (v.grants[v.grants.length - 1].settled || {}).result === 'clean'; // the latest grant's own settlement
  // A new invocation in a new module instance: the endpoint and budget modules are loaded again.
  const coldHandler = () => {
    for (const m of ['../netlify/functions/property-answer.ts', '../netlify/functions/lib/evaluation-budget.ts']) delete require.cache[require.resolve(m)];
    return require('../netlify/functions/property-answer.ts').handler;
  };
  async function coldPost(b) { const r = await coldHandler()({ blobs: lambdaBlobs, httpMethod: 'POST', headers: withJar(headers()), body: JSON.stringify(b) }); keepCookie(r); return { status: r.statusCode, body: JSON.parse(r.body) }; }
  async function assertClosed(code) {
    const before = calls.length;
    for (const b of [{ action: 'context', contactId: X1, opportunityId: DA },
      { action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: 'a'.repeat(64) },
      { action: 'history', contactId: X1, opportunityId: DA, operationId: crypto.randomUUID() }]) {
      const r = await post(b); assert.equal(r.status, 409); assert.equal(r.body.code, code, JSON.stringify(r.body));
      const c = await coldPost(b); assert.equal(c.status, 409); assert.equal(c.body.code, code, 'a cold invocation stays closed');
    }
    await assert.rejects(new budgetLib.EvaluationBudget(memStore, SCOPE, COMMITTED_BUDGET.budgetId, COMMITTED_BUDGET.ceiling).grant('context', 3, new Date().toISOString(), null, identity()), (e) => e.code === code.replace('budget_', ''));
    const k = await check(); assert.equal(k.status, 200, 'Check again still settles stored evidence');
    assert.equal(calls.length, before, 'zero GHL requests while closed');
  }
  await t('F4r2 the permanent-stop write FAILS: the grant stays unsettled, so every later invocation (warm or cold) is refused budget_unsettled with 0 GHL', async () => {
    await withCommittedBudget(async () => {
      fresh(); ghl.opps[DA].status = 'lost'; failNext.push(isStop);
      assert.equal((await context()).body.verdict.allowed, false);
      assert.equal(budgetRec().stopped, null, 'the stop was not recorded'); assert.equal(budgetRec().grants[0].settled, null, 'its grant is unsettled');
      ghl.opps[DA].status = 'open';
      await assertClosed('budget_unsettled');
    });
  });
  await t('F4r2 the permanent-stop write is AMBIGUOUS (applied, acknowledgement lost): later invocations are refused budget_stopped with 0 GHL', async () => {
    await withCommittedBudget(async () => {
      fresh(); ghl.opps[DA].status = 'lost'; applyThenThrow.push(isStop);
      assert.equal((await context()).body.verdict.allowed, false); assert.ok(budgetRec().stopped);
      ghl.opps[DA].status = 'open';
      await assertClosed('budget_stopped');
    });
  });
  await t('F4r2 the stop write fails after a generic search transport failure: closed for every later invocation, 0 GHL', async () => {
    await withCommittedBudget(async () => {
      fresh(); searchFails(); failNext.push(isStop);
      assert.equal((await context()).body.verdict.allowed, false); assert.equal(calls.length, 1); assert.equal(budgetRec().stopped, null);
      await assertClosed('budget_unsettled'); assert.equal(calls.length, 1);
    });
  });
  await t('F4r2/F4b a clean settlement refused BEFORE it applies: not ordinary success (409 budget_settlement_unacknowledged), no continuation, the stop is recorded; later invocations refused with 0 GHL', async () => {
    await withCommittedBudget(async () => {
      fresh(); failNext.push(isClean);
      const r = await context(); assert.equal(r.status, 409); assert.equal(r.body.code, 'budget_settlement_unacknowledged'); assert.equal(r.setCookie, null, 'no continuation');
      assert.equal(budgetRec().grants[0].settled.result, 'stopped'); assert.ok(budgetRec().stopped);
      await assertClosed('budget_stopped');
    });
  });

  // Bones's focused review of 3ad29ba, F4b: a PERSISTED clean settlement is not an ACKNOWLEDGED one.
  await t('F4b (Bones repro) the clean settlement APPLIES and its acknowledgement is lost: 409, no continuation, stopped; warm and cold invocations refused with 0 GHL', async () => {
    await withCommittedBudget(async () => {
      fresh(); applyThenThrow.push(isClean);
      const r = await context(); assert.equal(r.status, 409); assert.equal(r.body.code, 'budget_settlement_unacknowledged'); assert.equal(r.setCookie, null);
      assert.equal(calls.length, 3); assert.ok(budgetRec().stopped, 'the closing stop applied');
      await assertClosed('budget_stopped');
    });
  });
  await t('F4b the clean settlement APPLIES with its acknowledgement lost AND the closing stop fails: the persisted clean record alone grants nothing -- the earlier acknowledged continuation, no cookie, warm and cold are all refused budget_unacknowledged with 0 GHL', async () => {
    await withCommittedBudget(async () => {
      fresh();
      assert.equal((await context()).status, 200); const earlier = jar; assert.ok(earlier, 'g1 acknowledged: continuation issued');
      applyThenThrow.push(isClean); failNext.push(isStop);
      const r = await context(); assert.equal(r.status, 409); assert.equal(r.body.code, 'budget_settlement_unacknowledged'); assert.equal(r.setCookie, null);
      const rec = budgetRec(); assert.equal(rec.stopped, null, 'the stop did not apply'); assert.equal(rec.grants[1].settled.result, 'clean', 'clean IS persisted');
      assert.equal(jar, earlier, 'the browser still holds only the g1 continuation');
      await assertClosed('budget_unacknowledged');
      jar = null; await assertClosed('budget_unacknowledged');
    });
  });
  // Bones's review of 7369842 (F4c): continuation is bound to the validated writer AND write session,
  // and exactly one cookie occurrence is accepted.
  async function postAs(token, b, extraHeaders = {}, h = handler) {
    const r = await h({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${token}`, ...(jar ? { cookie: jar } : {}), ...extraHeaders }, body: JSON.stringify(b) });
    return { status: r.statusCode, body: JSON.parse(r.body), setCookie: (r.headers && r.headers['Set-Cookie']) || null };
  }
  const threeActions = () => [{ action: 'context', contactId: X1, opportunityId: DA },
    { action: 'save', contactId: X1, opportunityId: DA, field: 'property_address', operationId: crypto.randomUUID(), value: ADDR, expectedAddressDigest: model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: 'a'.repeat(64) },
    { action: 'history', contactId: X1, opportunityId: DA, operationId: crypto.randomUUID() }];
  await t('F4c another write session of the SAME writer, presenting the holder\'s valid continuation cookie, is refused budget_session_mismatch before any GHL request (warm and cold); the holder then continues', async () => {
    await withCommittedBudget(async () => {
      fresh(); assert.equal((await context()).status, 200); const before = calls.length;
      const other = auth.issueAppSession('brad@example.invalid', process.env, Date.now() + 2000).token; assert.notEqual(other, session());
      for (const b of threeActions()) {
        for (const h of [handler, coldHandler()]) {
          const r = await postAs(other, b, {}, h); assert.equal(r.status, 409); assert.equal(r.body.code, 'budget_session_mismatch', JSON.stringify(r.body)); assert.equal(r.setCookie, null);
        }
      }
      assert.equal(calls.length, before, 'nothing sent'); assert.equal(budgetRec().stopped, null, 'a refused session does not stop the holder');
      assert.equal((await context()).status, 200, 'the holder session continues'); assert.equal(calls.length, before + 3);
    });
  });
  await t('F4c another ALLOWED writer, presenting the holder\'s valid continuation cookie, is refused budget_session_mismatch before any GHL request; a forged or unsigned session is 401 before any Blob or GHL access', async () => {
    await withCommittedBudget(async () => {
      fresh(); assert.equal((await context()).status, 200); const before = calls.length;
      const second = auth.issueAppSession('second@example.invalid').token;
      for (const b of threeActions()) { const r = await postAs(second, b); assert.equal(r.status, 409); assert.equal(r.body.code, 'budget_session_mismatch'); }
      const parts = session().split('.'); const forged = [parts[0], Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url')), sub: 'second@example.invalid' })).toString('base64url'), parts[2]].join('.');
      const ops = blobOps; assert.equal((await postAs(forged, threeActions()[0])).status, 401); assert.equal(blobOps, ops, 'no Blob access');
      assert.equal(calls.length, before, 'nothing sent'); assert.equal(budgetRec().stopped, null);
    });
  });
  await t('F4c exactly ONE continuation-cookie occurrence: identical duplicates (one header or two) and conflicting duplicates are refused budget_unacknowledged with 0 GHL; one physical header mirrored in headers and multiValueHeaders counts once; the single cookie then continues', async () => {
    await withCommittedBudget(async () => {
      fresh(); assert.equal((await context()).status, 200); const one = jar; const g1 = one;
      assert.equal((await context()).status, 200); const g2 = jar; const before = calls.length;
      const cases = [{ cookie: `${g2}; ${g2}` }, { cookie: `${g2};${g2}` }, { cookie: `${g2}; ${g1}` }];
      jar = null;
      for (const extra of cases) { const r = await postAs(session(), threeActions()[0], extra); assert.equal(r.status, 409); assert.equal(r.body.code, 'budget_unacknowledged', JSON.stringify(extra)); }
      const two = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...headers() }, multiValueHeaders: { cookie: [g2, g2] }, body: JSON.stringify(threeActions()[0]) });
      assert.equal(two.statusCode, 409); assert.equal(JSON.parse(two.body).code, 'budget_unacknowledged', 'two identical Cookie headers');
      const twoInMulti = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...headers(), cookie: g2 }, multiValueHeaders: { cookie: [g2, g2] }, body: JSON.stringify(threeActions()[0]) });
      assert.equal(twoInMulti.statusCode, 409, 'two physical Cookie fields, also mirrored in headers'); assert.equal(JSON.parse(twoInMulti.body).code, 'budget_unacknowledged');
      const splitDup = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...headers() }, multiValueHeaders: { cookie: ['other=1; ' + g2, g2 + '; x=2'] }, body: JSON.stringify(threeActions()[0]) });
      assert.equal(splitDup.statusCode, 409, 'the same cookie in two split Cookie fields'); assert.equal(JSON.parse(splitDup.body).code, 'budget_unacknowledged');
      assert.equal(calls.length, before, 'nothing sent'); assert.equal(budgetRec().stopped, null);
      // ONE physical Cookie header represented in BOTH headers and multiValueHeaders counts once and continues.
      const mirrored = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...headers(), cookie: 'other=1; ' + g2 }, multiValueHeaders: { cookie: ['other=1; ' + g2] }, body: JSON.stringify(threeActions()[0]) });
      assert.equal(mirrored.statusCode, 200, 'one header mirrored in both representations is one occurrence'); assert.equal(calls.length, before + 3);
      keepCookie(mirrored); assert.notEqual(jar, g2, 'rotated');
      assert.equal((await context()).status, 200, 'exactly one occurrence continues'); assert.equal(calls.length, before + 6);
      void one;
    });
  });
  await t('F4b continuation: only the acknowledged secret of the LATEST grant continues; missing, stale, forged or duplicated cookies are refused unsent (and do not stop the holder); the holder then continues (positive control)', async () => {
    await withCommittedBudget(async () => {
      fresh();
      const a = await context(); assert.equal(a.status, 200); assert.match(a.setCookie, /^__Host-iaos_pa_continuation=1\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
      const g1 = jar; assert.equal((await context()).status, 200); const g2 = jar; assert.notEqual(g1, g2);
      assert.ok(!JSON.stringify(budgetRec()).includes(g2.split('.')[1]), 'the store holds only a digest of the secret');
      const before = calls.length;
      const tries = [null, g1, g2.slice(0, -1) + (g2.endsWith('A') ? 'B' : 'A'), g2.replace(/=2\./, '=3.'), `${g2}; ${g1}`];
      for (const c of tries) {
        jar = c; const r = await post({ action: 'context', contactId: X1, opportunityId: DA });
        assert.equal(r.status, 409); assert.equal(r.body.code, 'budget_unacknowledged', String(c));
      }
      assert.equal(calls.length, before, 'nothing sent'); assert.equal(budgetRec().stopped, null, 'a refused presenter does not stop the holder');
      jar = g2; assert.equal((await context()).status, 200); assert.equal(calls.length, before + 3, 'the holder continues');
    });
  });
  await t('F4r2 an invocation that dies after its grant (never settles, never stops): later invocations refused budget_unsettled with 0 GHL', async () => {
    await withCommittedBudget(async () => {
      fresh(); await new budgetLib.EvaluationBudget(memStore, SCOPE, COMMITTED_BUDGET.budgetId, COMMITTED_BUDGET.ceiling).grant('context', 3, new Date().toISOString(), null, identity());
      await assertClosed('budget_unsettled');
    });
  });
  await t('F4 transport bounds: redirect "error" and an abort signal on every request; a 3xx or redirected response is refused; a body over 1 MiB is refused; the deadline covers a stalled response', async () => {
    let seen = null; const base = async (url, init) => { seen = init; return { status: 200, redirected: false, text: async () => '{}' }; };
    await budgetLib.boundedRequest(base, 'https://services.leadconnectorhq.com/x', { method: 'GET' });
    assert.equal(seen.redirect, 'error'); assert.ok(seen.signal instanceof AbortSignal);
    await assert.rejects(budgetLib.boundedRequest(async () => ({ status: 302, text: async () => '' }), 'https://services.leadconnectorhq.com/x', {}), budgetLib.TransportRefused);
    await assert.rejects(budgetLib.boundedRequest(async () => ({ status: 200, redirected: true, text: async () => '{}' }), 'https://services.leadconnectorhq.com/x', {}), budgetLib.TransportRefused);
    await assert.rejects(budgetLib.boundedRequest(async () => ({ status: 200, text: async () => 'x'.repeat(budgetLib.BODY_LIMIT_BYTES + 1) }), 'https://services.leadconnectorhq.com/x', {}), /too large/);
    let aborted = false;
    await assert.rejects(budgetLib.boundedRequest(async (u, init) => { init.signal.addEventListener('abort', () => { aborted = true; }); return { status: 200, text: () => new Promise(() => {}) }; }, 'https://services.leadconnectorhq.com/x', {}, 50), /timeout/);
    assert.ok(aborted, 'the stalled request was aborted');
    await assert.rejects(budgetLib.boundedRequest(async () => new Promise(() => {}), 'https://services.leadconnectorhq.com/x', {}, 50), /timeout/);
  });
  await t('LEASE_MS prerequisite: app/netlify.toml sets no function timeout, so the platform\'s synchronous limit (well under 120 s) applies -- a timeout setting must re-open this review', async () => {
    const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
    assert.ok(!/^\s*timeout\s*=/m.test(toml), 'no timeout key'); assert.equal(ledger.LEASE_MS, 120000);
  });

  // ── Bones step 070: the contact lock through main's recorded receipts (receipt-recorder-shim) ─────────
  const wb = require('../netlify/functions/lib/ghl-write-boundary.ts');
  const lockKey = (c = X1) => 'lock/' + wb.digest(config.locationId + c);
  /** Spy on the lock key's backing-store writes/deletes and on every real (non-sentinel) network origin. */
  async function withLockSpy(fn) {
    const spy = { set: 0, del: 0, origins: [] }; const os = memStore.setJSON, od = memStore.delete, prev = global.fetch;
    memStore.setJSON = async function (k, ...a) { if (k === lockKey()) spy.set++; return os.call(this, k, ...a); };
    memStore.delete = async function (k, ...a) { if (k === lockKey()) spy.del++; return od.call(this, k, ...a); };
    global.fetch = async (url, init) => { spy.origins.push(new URL(String(url)).origin); return prev(url, init); };
    try { await fn(spy); } finally { memStore.setJSON = os; memStore.delete = od; global.fetch = prev; }
    return spy;
  }
  async function saveAfter(beforeSave, c = X1, o = DA) {
    const ctx = (await context(c, o)).body; await beforeSave();
    return post({ action: 'save', contactId: c, opportunityId: o, field: 'seller_reason', operationId: crypto.randomUUID(), value: 'Relocating for work', expectedAddressDigest: ctx.address?.digest ?? model.EMPTY_ADDRESS_DIGEST, expectedDealSetDigest: ctx.verdict.digest });
  }
  await t('LK1 (step 070) an EXISTING contact lock refuses the save BEFORE any GHL request (409 locked); the other holder\'s lock is untouched', async () => {
    fresh(); seedOtherLedgers(X1); let n = 0, r;
    const spy = await withLockSpy(async () => { r = await saveAfter(async () => { receipts.set(lockKey(), { claimedAt: 'held-elsewhere' }); etags.set(lockKey(), 'held-etag'); n = ghlCount(); }); });
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, 'locked'); assert.equal(ghlCount(), n, 'no GHL request after the refusal');
    assert.deepEqual(receipts.get(lockKey()), { claimedAt: 'held-elsewhere' }); assert.equal(etags.get(lockKey()), 'held-etag'); assert.equal(spy.del, 0, 'no DELETE of a lock this request never held');
  });
  await t('LK2 (step 070) an UNCONFIRMED lock creation (the recorded create fails) prevents every protected GHL dispatch (409 locked; zero PUT/POST)', async () => {
    fresh(); seedOtherLedgers(X1); let n = 0, r;
    const spy = await withLockSpy(async () => { r = await saveAfter(async () => { failNext.push((op, k) => op === 'setJSON' && k === lockKey()); n = ghlCount(); }); });
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, 'locked'); assert.equal(ghlCount(), n); assert.equal(puts(), 0); assert.equal(posts(), 0);
    assert.equal(spy.set, 1, 'one create attempt, never retried'); assert.equal(spy.del, 0, 'no DELETE of an unconfirmed lock'); assert.equal(receipts.has(lockKey()), false);
  });
  await t('LK4 (step 070, control) a normal save creates and releases the lock exactly once; result saved_history_pending', async () => {
    fresh(); seedOtherLedgers(X1); let r; await commitAnswer('property_address', ADDR);   // a seller-reason save needs a confirmed address (outside the spy)
    const spy = await withLockSpy(async () => { r = await saveAfter(async () => {}); });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.outcome, 'saved_history_pending'); assert.equal(spy.set, 1); assert.equal(spy.del, 1); assert.equal(receipts.has(lockKey()), false);
  });
  await t('LK3 (step 070) RELEASE uncertainty (the recorded DELETE fails) does not replace the protected result; exactly ONE DELETE; no reacquisition', async () => {
    fresh(); seedOtherLedgers(X1); let r; await commitAnswer('property_address', ADDR);
    const spy = await withLockSpy(async () => { r = await saveAfter(async () => { failNext.push((op, k) => op === 'delete' && k === lockKey()); }); });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.outcome, 'saved_history_pending', 'the save result stands');
    assert.equal(spy.del, 1, 'no second DELETE after uncertainty'); assert.equal(spy.set, 1, 'no reacquisition'); assert.equal(receipts.has(lockKey()), true, 'the lock is left in place (unconfirmed release), never guessed away');
    assert.equal(failNext.length, 0, 'the armed fault was consumed by that one DELETE');
  });
  await t('LK5 (step 070) no external network: every real request in an LK save flow goes to GHL only (receipt traffic stays on the in-process recorder)', async () => {
    fresh(); seedOtherLedgers(X1); await commitAnswer('property_address', ADDR);
    const spy = await withLockSpy(async () => { await saveAfter(async () => {}); });
    assert.ok(spy.origins.length > 0); assert.deepEqual([...new Set(spy.origins)], ['https://services.leadconnectorhq.com']);
  });

  finished = true;
  console.log(`property-answer: ${count} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
})();
