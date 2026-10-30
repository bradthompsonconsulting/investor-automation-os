/**
 * B15-04 close (design r3; Jess D0–D4; Bones implementation clearance 2026-10-20) -- focused SERVER checks for
 * the property-answer `close` action, the exact recovery pairs and their runtime projection. The REAL handler,
 * offline: in-memory Netlify Blobs with fault injection, a synthetic GHL, the committed Test evaluation config
 * (b15-04-eval-1 / 40) plus synthetic fixtures. No credential, no network. Setup is shared with
 * test-property-answer-recovery.cjs.
 *
 * Close: Test only before any storage; exact pair; zero GHL, no grant, lock or cookie; closed only when the stop
 * is acknowledged or already stored; UNKNOWN otherwise; manual repeat; admission fencing, not cancellation;
 * drafts saving and recovery preserved.
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
const receiptShim = require('./lib/receipt-recorder-shim.cjs'); // main's recorded-receipt adapter (204a66f): fetch-bearing receipt stores go through the helpers' recorder (test-only; Bones step 070)
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
  if (name === '@netlify/blobs') return receiptShim.wrap({ connectLambda: (event) => realBlobs.connectLambda(event), getStore: () => memStore });
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
// Committed Test is DEACTIVATED; this offline suite enables ONLY its own in-memory copy (the handler's getConfig returns this object).
assert.equal(config.propertyAnswerEvaluation.enabled, cfgMod.PROPERTY_ANSWER_EVALUATION_DISABLED, 'committed Test evaluation is DISABLED');
assert.deepEqual(cfgMod.projectRuntimeConfig(config, 'test').propertyAnswerRecovery, { enabled: false, pairs: [] }, 'committed Test projects the close page disabled');
config.propertyAnswerEvaluation.enabled = cfgMod.PROPERTY_ANSWER_EVALUATION_ENABLED;
assert.equal(cfgMod.getConfig('test').propertyAnswerEvaluation.enabled, cfgMod.PROPERTY_ANSWER_EVALUATION_ENABLED, 'the handler sees the suite-enabled copy');
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
/** Bones F3: every OTHER pinned fixture contact needs clean ledger evidence (a valid, empty known-deal ledger) before a draft is trusted. */
function seedLedgers(own) {
  for (const c of config.propertyAnswerEvaluation.fixtureContactIds) {
    if (c === own) continue;
    const lk = ledger.ledgerKey(SCOPE, c);
    if (!receipts.has(lk)) { receipts.set(lk, { v: 1, gen: 1, ids: {}, discoveries: {} }); etags.set(lk, 'seed-' + c); }
  }
}
function fresh() {
  receipts.clear(); etags.clear(); failNext = []; calls = []; putFails = 0; loseNoteReply = 0;
  ghl = { contacts: { [X1]: { id: X1, notes: [] }, [X2]: { id: X2, notes: [] } }, opps: { [DA]: deal(DA, X1), [DB]: deal(DB, X2) } };
  seedLedgers(X1);
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
  const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'property-answer.ts'), 'utf8');
  const committed = cfgMod.getConfig('test').propertyAnswerEvaluation;
  const budgetKey = () => budgetKeys()[0];
  const budgetRec = () => receipts.get(budgetKey());
  const close = (s, c = X1, o = DA, extra = {}) => post(s, { action: 'close', contactId: c, opportunityId: o }, extra);
  /** close must be zero GHL, no cookie, and never grant/draw/settle. */
  async function closeQuiet(label, fn) {
    const c0 = calls.length; const g0 = budgetRec()?.grants.length ?? 0; const a0 = budgetRec()?.attempts.length ?? 0;
    const r = await fn();
    assert.equal(calls.length, c0, label + ': zero GHL requests');
    assert.equal(r.cookie, null, label + ': no Set-Cookie');
    assert.equal(budgetRec()?.grants.length ?? 0, g0, label + ': no grant'); assert.equal(budgetRec()?.attempts.length ?? 0, a0, label + ': no attempt receipt');
    return r;
  }

  // ── C3: the committed reviewed pairs, exact tuples ─────────────────────────────
  await t('K1 committed Test recoveryPairs are EXACTLY Y1/E and Y2/F (Bones clearance), every member pinned; Production carries none', async () => {
    assert.deepEqual(committed.recoveryPairs.map((p) => ({ ...p })), [
      { contactId: 'pYE98meKVyRrbzEt6MMR', opportunityId: 'a75hWpPILA7Y7Ginp4n8' },
      { contactId: 'LR98QNOE0oksHIPF4JIf', opportunityId: 'HCTa65siD41bA9XGpQWM' }]);
    for (const p of committed.recoveryPairs) { assert.ok(committed.fixtureContactIds.includes(p.contactId)); assert.ok(committed.fixtureOpportunityIds.includes(p.opportunityId)); }
    assert.deepEqual([...cfgMod.getConfig('production').propertyAnswerEvaluation.recoveryPairs], []);
  });
  await t('K2 runtime projection: Test projects enabled + exactly the two pairs and nothing else of propertyAnswerEvaluation; any other environment or a non-ENABLED sentinel projects false/[]', async () => {
    const t1 = cfgMod.projectRuntimeConfig(cfgMod.getConfig('test'), 'test');
    assert.deepEqual(t1.propertyAnswerRecovery, { enabled: true, pairs: committed.recoveryPairs.map((p) => ({ ...p })) });
    const json = JSON.stringify(t1); for (const secret of ['b15-04-eval-1', 'requestBudget', 'ceiling', 'maxCandidates', 'fixtureContactIds', 'PROPERTY_ANSWER_EVALUATION']) assert.ok(!json.includes(secret), 'projection omits ' + secret);
    assert.deepEqual(cfgMod.projectRuntimeConfig(cfgMod.getConfig('production'), 'production').propertyAnswerRecovery, { enabled: false, pairs: [] });
    assert.deepEqual(cfgMod.projectRuntimeConfig(cfgMod.getConfig('test')).propertyAnswerRecovery, { enabled: false, pairs: [] }, 'no environment -> disabled');
    assert.deepEqual(cfgMod.projectRuntimeConfig(cfgMod.getConfig('test'), 'production').propertyAnswerRecovery, { enabled: false, pairs: [] }, 'Test config served as production -> disabled');
    const c = cfgMod.getConfig('test'); const saved = c.propertyAnswerEvaluation.enabled; c.propertyAnswerEvaluation.enabled = 'TRUTHY-BUT-NOT-THE-SENTINEL';
    try { assert.deepEqual(cfgMod.projectRuntimeConfig(c, 'test').propertyAnswerRecovery, { enabled: false, pairs: [] }, 'a truthy non-sentinel never enables'); } finally { c.propertyAnswerEvaluation.enabled = saved; }
  });
  await t('K3 runtime validator (positive allowlist): accepts both projections; refuses absent, extra keys, non-boolean enabled, pairs when disabled, none when enabled, >2, malformed ids, extra pair keys, duplicate contact/deal', async () => {
    const good = cfgMod.projectRuntimeConfig(cfgMod.getConfig('test'), 'test');
    cfgMod.setRuntimeConfig(good); cfgMod.setRuntimeConfig(cfgMod.projectRuntimeConfig(cfgMod.getConfig('production'), 'production'));
    const P0 = good.propertyAnswerRecovery.pairs;
    const bad = [undefined, null, [], {}, { enabled: true }, { enabled: true, pairs: P0, extra: 1 }, { enabled: 'true', pairs: P0 }, { enabled: 1, pairs: P0 },
      { enabled: false, pairs: P0 }, { enabled: true, pairs: [] }, { enabled: true, pairs: [...P0, { contactId: 'c3', opportunityId: 'o3' }] },
      { enabled: true, pairs: [{ contactId: 'bad id!', opportunityId: 'o1' }] }, { enabled: true, pairs: [{ contactId: 'c1', opportunityId: 'o1', name: 'x' }] },
      { enabled: true, pairs: [{ contactId: 'c1' }] }, { enabled: true, pairs: [{ contactId: 'c1', opportunityId: 'o1' }, { contactId: 'c1', opportunityId: 'o2' }] },
      { enabled: true, pairs: [{ contactId: 'c1', opportunityId: 'o1' }, { contactId: 'c2', opportunityId: 'o1' }] }, { enabled: true, pairs: ['c1:o1'] }];
    for (const v of bad) assert.throws(() => cfgMod.setRuntimeConfig({ ...good, propertyAnswerRecovery: v }), /runtime configuration is incomplete: propertyAnswerRecovery/, JSON.stringify(v));
    cfgMod.setRuntimeConfig(good);
  });

  // This suite's synthetic pair (X1 + DA), added only after the committed-config checks above.
  config.propertyAnswerEvaluation.recoveryPairs.push({ contactId: X1, opportunityId: DA });

  // ── B1: the Test-only check, before any storage ───────────────────────────────
  await t('T3/T3b Production refuses close 403 close_test_only with ZERO Blob operations -- even when the Production evaluation config is (synthetically) ENABLED with the pair pinned', async () => {
    fresh(); const s = session(); process.env.IAOS_ENV = 'production';
    const prod = cfgMod.getConfig('production').propertyAnswerEvaluation; const saved = { ...prod, fixtureContactIds: [...prod.fixtureContactIds], fixtureOpportunityIds: [...prod.fixtureOpportunityIds], recoveryPairs: [...prod.recoveryPairs] };
    let ops = 0; const g = memStore.getWithMetadata, j = memStore.setJSON; memStore.getWithMetadata = async (...a) => { ops++; return g.apply(memStore, a); }; memStore.setJSON = async (...a) => { ops++; return j.apply(memStore, a); };
    try {
      for (const enabled of [false, true]) {
        if (enabled) { prod.enabled = cfgMod.PROPERTY_ANSWER_EVALUATION_ENABLED; prod.fixtureContactIds.push(X1); prod.fixtureOpportunityIds.push(DA); prod.recoveryPairs.push({ contactId: X1, opportunityId: DA }); prod.requestBudget = { budgetId: 'b15-04-eval-1', ceiling: 40 }; }
        const r = await close(s); assert.equal(r.status, 403); assert.equal(r.body.code, 'close_test_only'); assert.equal(r.body.outcome, 'not_closed');
      }
      assert.equal(ops, 0, 'no Blob read or write'); assert.equal(receipts.size, [...receipts.keys()].length); assert.equal(budgetKeys().length, 0); assert.equal(calls.length, 0);
    } finally { process.env.IAOS_ENV = 'test'; Object.assign(prod, saved); prod.fixtureContactIds.length = 0; prod.fixtureOpportunityIds.length = 0; prod.recoveryPairs.length = 0; memStore.getWithMetadata = g; memStore.setJSON = j; }
  });
  await t('T4 refusals before storage: no session 401, foreign origin 403, extra keys (budgetId, reason, g, ceiling) 400, non-fixture 403, a CROSS pair 403 not_a_recovery_pair; no budget record created', async () => {
    fresh(); const s = session();
    assert.equal((await close(null)).status, 401);
    assert.equal((await close(s, X1, DA, { origin: 'https://evil.example.invalid' })).status, 403);
    for (const extra of [{ budgetId: 'other' }, { reason: 'x' }, { g: 1 }, { ceiling: 1000 }, { scope: 'x' }]) assert.equal((await post(s, { action: 'close', contactId: X1, opportunityId: DA, ...extra })).status, 400, JSON.stringify(extra));
    assert.equal((await close(s, 'notPinned', DA)).body.code, 'not_a_fixture');
    const cross = await close(s, X1, DB); assert.equal(cross.status, 403); assert.equal(cross.body.code, 'not_a_recovery_pair');
    assert.equal(budgetKeys().length, 0, 'nothing stored'); assert.equal(calls.length, 0);
  });

  // ── D0/B2/B3: the durable stop on the fixed configured budget ─────────────────
  await t('T1 zero-grant close: 200 closed on the CONFIGURED b15-04-eval-1/40 record, stopped "operator_close", zero grants/calls; then context from ANY writer is refused budget_stopped with zero GHL', async () => {
    fresh(); const s = session();
    const r = await closeQuiet('close', () => close(s)); assert.equal(r.status, 200); assert.equal(r.body.outcome, 'closed'); assert.equal(r.body.message, handlerMod.CLOSED_TEXT);
    assert.equal(budgetKeys().length, 1); const rec = budgetRec();
    assert.equal(rec.budgetId, 'b15-04-eval-1'); assert.equal(rec.ceiling, 40); assert.equal(rec.stopped.reason, 'operator_close'); assert.equal(rec.grants.length, 0); assert.equal(rec.calls, 0); assert.equal(rec.reserved, 0);
    assert.equal(budgetKey(), new budgetLib.EvaluationBudget(memStore, SCOPE, 'b15-04-eval-1', 40).key, 'the configured record, no other key');
    for (const w of [session(A), session(B)]) { const c = await context(w); assert.equal(c.status, 409); assert.equal(c.body.code, 'budget_stopped'); }
    assert.equal(calls.length, 0, 'no GHL request after the close');
  });
  await t('T2/B3 idempotent: a second close is 200 closed, record byte-identical, first reason kept; another allowed writer may close too (D1)', async () => {
    fresh(); await close(session()); const b0 = budgetSnap();
    const r = await closeQuiet('second close (other writer)', () => close(session(B))); assert.equal(r.body.outcome, 'closed'); assert.equal(budgetSnap(), b0);
  });
  await t('T2b a budget already stopped for ANOTHER reason (endpoint failure) answers closed (verified already-stopped) and keeps the first reason and all counts', async () => {
    fresh(); const s1 = session(); await context(s1); await draft(s1, 'T2b');
    putFails = 1; const sv = await save(s1, 'T2b'); assert.equal(sv.body.outcome, 'not_confirmed');
    const before = budgetRec(); assert.ok(before.stopped); const b0 = budgetSnap();
    const r = await closeQuiet('close after failure', () => close(session(B))); assert.equal(r.body.outcome, 'closed'); assert.equal(budgetSnap(), b0, 'nothing rewritten');
    assert.notEqual(budgetRec().stopped.reason, 'operator_close');
  });
  await t('T5 unacknowledged: every CAS write unacknowledged -> 503 close_unknown; a store that throws on read -> 503 close_unknown; never "closed"', async () => {
    fresh(); const s = session();
    const j = memStore.setJSON; memStore.setJSON = async () => ({ modified: false });
    try { const r = await close(s); assert.equal(r.status, 503); assert.equal(r.body.outcome, 'close_unknown'); assert.equal(r.body.error, handlerMod.CLOSE_UNKNOWN_TEXT); } finally { memStore.setJSON = j; }
    failNext.push((op) => op === 'getWithMetadata');
    const r2 = await close(s); assert.equal(r2.status, 503); assert.equal(r2.body.outcome, 'close_unknown');
    assert.equal(budgetKeys().length, 0, 'no record was written'); assert.equal(calls.length, 0);
  });
  await t('T5b write APPLIED but its acknowledgement lost (throws) -> close_unknown; the stop IS stored; a deliberate manual repeat (D4) then answers closed without rewriting', async () => {
    fresh(); const s = session();
    const j = memStore.setJSON; let once = true;
    memStore.setJSON = async (...a) => { const r = await j.apply(memStore, a); if (once && a[0].startsWith('pa/eval-budget/')) { once = false; throw new Error('fixture: applied, acknowledgement lost'); } return r; };
    try { const r = await close(s); assert.equal(r.body.outcome, 'close_unknown'); } finally { memStore.setJSON = j; }
    assert.equal(budgetRec().stopped.reason, 'operator_close', 'stored despite the lost acknowledgement');
    const b0 = budgetSnap(); const r2 = await close(s); assert.equal(r2.body.outcome, 'closed'); assert.equal(budgetSnap(), b0);
  });
  await t('T5c a manual repeat after a close that NEVER applied WRITES the stop (it is not a confirmation read); both outcomes are separate replies', async () => {
    fresh(); const s = session();
    const j = memStore.setJSON; memStore.setJSON = async () => ({ modified: false });
    let first; try { first = await close(s); } finally { memStore.setJSON = j; }
    assert.equal(first.body.outcome, 'close_unknown'); assert.equal(budgetKeys().length, 0, 'the first attempt stored nothing');
    const second = await close(s); assert.equal(second.body.outcome, 'closed'); assert.equal(budgetRec().stopped.reason, 'operator_close', 'the repeat wrote the stop');
  });
  await t('T6 close takes no lock, sets no cookie, reads no continuation and builds no GHL boundary: source has no grant/lock/fetcher in the close branch; a presented cookie changes nothing', async () => {
    const branch = handlerSrc.slice(handlerSrc.indexOf('if (req.action === "close") {'), handlerSrc.indexOf('let grant: Grant | null = null;'));
    assert.ok(branch.length > 0 && branch.length < 1500, 'the close branch precedes the grant');
    for (const banned of ['grant(', 'lockContact', 'fetcher', 'configuredBoundary', 'presentedContinuation', 'Set-Cookie', 'settle(', 'draw(']) assert.ok(!branch.includes(banned), 'close branch must not use ' + banned);
    assert.match(branch, /budget\.stop\("operator_close", now\(\)\)/, 'stop without g');
    fresh(); const s = session(); s.jar = `${handlerMod.CONTINUATION_COOKIE}=1.${'A'.repeat(43)}`;
    const r = await closeQuiet('close with a cookie', () => close(s)); assert.equal(r.body.outcome, 'closed');
    assert.equal([...receipts.keys()].filter((k) => k.startsWith('pa/lock') || k.includes('lock')).length, 0, 'no lock record');
  });

  // ── B4: admission fencing, not cancellation ───────────────────────────────────
  await t('T8 close while a holder is admitted: the holder\'s NEXT action is refused budget_stopped unsent; earlier receipts are kept unchanged; nothing is rolled back', async () => {
    fresh(); const s1 = session(); assert.equal((await context(s1)).status, 200);
    const before = budgetRec(); const n = calls.length;
    assert.equal((await close(session(B))).body.outcome, 'closed');
    const after = budgetRec(); assert.deepEqual(after.attempts, before.attempts, 'receipts kept'); assert.equal(after.calls, before.calls); assert.equal(after.reserved, before.reserved); assert.deepEqual(after.grants, before.grants);
    const c = await context(s1); assert.equal(c.status, 409); assert.equal(c.body.code, 'budget_stopped'); assert.equal(calls.length, n, 'refused unsent, even with the valid continuation');
  });
  await t('T8b an action ADMITTED before the close still dispatches its already-receipted request (no cancellation); its later requests are refused unsent; no continuation; the budget stays closed', async () => {
    fresh(); const s1 = session(); assert.equal((await context(s1)).status, 200);
    let closedMidFlight = null;
    const realFetch = global.fetch;
    global.fetch = async (url, init) => { if (closedMidFlight === null) { closedMidFlight = (await close(session(B))).body.outcome; } return realFetch(url, init); };
    let mid; try { mid = await context(s1); } finally { global.fetch = realFetch; }
    assert.equal(closedMidFlight, 'closed');
    // Run 1 asserted a non-200 here and FAILED: the admitted context answers 200 with a NOT-allowed, verification-
    // incomplete verdict (its refused reads read as "list updating"). The assertions below state the actual contract.
    assert.equal(calls.length, 4, 'exactly ONE request of the admitted action (its receipt won before the close) was dispatched; the rest were refused unsent');
    assert.equal(mid.body.verdict.allowed, false, 'the admitted action did not complete as allowed'); assert.match(mid.body.verdict.message, /Verification is incomplete/);
    assert.equal(mid.cookie, null, 'no continuation was issued');
    const rec = budgetRec(); assert.equal(rec.stopped.reason, 'operator_close', 'the close is the first stop reason'); assert.equal(rec.attempts.filter((a) => a.g === 2).length, 1, 'one receipt for the admitted grant');
    const c = await context(session()); assert.equal(c.body.code, 'budget_stopped');
  });

  await t('T8c a grant settled clean AFTER the close (late original invocation) yields a valid-looking continuation that still cannot obtain a grant', async () => {
    fresh(); const s1 = session(); const now = new Date().toISOString(); const b = new budgetLib.EvaluationBudget(memStore, SCOPE, 'b15-04-eval-1', 40);
    const g = await b.grant('context', 3, now, null, `${s1.writer}
${dg(s1.token)}`);
    assert.equal((await close(session(B))).body.outcome, 'closed');
    const secret = crypto.randomBytes(32).toString('base64url'); assert.equal(await b.settle(g.g, secret, now), true, 'the late settle is acknowledged');
    s1.jar = `${handlerMod.CONTINUATION_COOKIE}=${g.g}.${secret}`; const n = calls.length;
    const c = await context(s1); assert.equal(c.status, 409); assert.equal(c.body.code, 'budget_stopped'); assert.equal(calls.length, n);
  });

  // ── D2: drafts saving and recovery stay available after the close ─────────────
  await t('T7/D2 after the close: the operator\'s bound draft SAVE still works and RECOVERY returns it (zero GHL, no grant, no cookie); check stays evidence-only (zero GHL)', async () => {
    fresh(); const s1 = session(); assert.equal((await context(s1)).status, 200); assert.equal((await draft(s1, 'before close')).body.outcome, 'draft_saved');
    assert.equal((await close(s1)).body.outcome, 'closed');
    const w = await quiet('draft after close', () => draft(s1, 'after close')); assert.equal(w.body.outcome, 'draft_saved');
    const r = await quiet('drafts after close', () => drafts(s1), { store: true }); assert.equal(r.body.drafts.seller_reason.state, 'present'); assert.equal(r.body.drafts.seller_reason.value, 'after close');
    const s2 = session(); const r2 = await quiet('drafts, new session', () => drafts(s2), { store: true }); assert.equal(r2.body.drafts.seller_reason.value, 'after close');
    const other = await quiet('drafts, other operator', () => drafts(session(B)), { store: true }); assert.notEqual(other.body.drafts.seller_reason.state, 'present', 'another operator gets no text');
    await quiet('check after close', () => check(s1));
  });
  await t('T9 recovery sequence on the close page after an acknowledged close: context (refused budget_stopped, zero GHL) then drafts -- no grant, no cookie, reserved/calls unchanged', async () => {
    fresh(); const s1 = session(); assert.equal((await context(s1)).status, 200); await draft(s1, 'T9 text');
    assert.equal((await close(s1)).body.outcome, 'closed'); const b0 = budgetSnap();
    const s2 = session(); const c = await quiet('panel context', () => context(s2)); assert.equal(c.status, 409); assert.equal(c.body.code, 'budget_stopped');
    const d = await quiet('panel drafts', () => drafts(s2)); assert.equal(d.body.drafts.seller_reason.value, 'T9 text');
    assert.equal(budgetSnap(), b0);
  });

  finished = true;
  const FLOOR = 17;   // cases, counted from the finished file
  console.log(`property-answer close: ${count} passed, ${failures} failed (expected exactly ${FLOOR})`);
  process.exitCode = failures ? 1 : count + failures !== FLOOR ? 2 : 0;
})();
