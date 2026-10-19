/**
 * B15-04 supplemental GHL read budget (netlify/functions/lib/supplemental-read-budget.ts) -- focused offline suite.
 * Brad 2026-10-19: reserve each background GHL request before dispatch (pagination, retries, navigation-triggered
 * reads), one shared ceiling across concurrent invocations, refuse when accounting is unavailable or ambiguous,
 * no automatic reset, property-answer's 40 untouched, Production unchanged.
 *
 * Offline. @netlify/blobs is an in-memory store with onlyIfNew / onlyIfMatch semantics, an await between read and
 * write (so concurrent invocations really interleave) and injectable faults. global.fetch is a recorder: GHL
 * requests get a fixture answer, anything else fails the run. No credential, no network.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

// ---- in-memory Blobs with interleaving and faults
const data = new Map(); const etags = new Map(); let seq = 0; let blobOps = 0;
let faults = { readThrow: 0, writeThrow: 0, applyThenThrow: 0, neverModified: false, consistencyError: 0, oddAck: [] };
const tick = () => new Promise((r) => setImmediate(r));
const memStore = {
  async getWithMetadata(key, opts) {
    blobOps++; await tick();
    if (faults.consistencyError && opts?.consistency === 'strong') { faults.consistencyError--; const e = new Error('strong not available'); e.name = 'BlobsConsistencyError'; throw e; }
    if (faults.readThrow) { faults.readThrow--; throw new Error('fixture: read failed'); }
    return data.has(key) ? { data: structuredClone(data.get(key)), etag: etags.get(key) } : null;
  },
  async setJSON(key, value, options) {
    blobOps++; await tick();
    if (faults.writeThrow) { faults.writeThrow--; throw new Error('fixture: write failed'); }
    if (faults.oddAck.length) return faults.oddAck.shift();
    if (faults.neverModified) return { modified: false };
    if (options?.onlyIfNew && data.has(key)) return { modified: false };
    if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
    data.set(key, structuredClone(value)); etags.set(key, 'e' + (++seq));
    if (faults.applyThenThrow) { faults.applyThenThrow--; throw new Error('fixture: applied, acknowledgement lost'); }
    return { modified: true };
  },
};
let blobContextRequired = true;
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return {
    connectLambda: (event) => { if (blobContextRequired && !(event && event.blobs)) throw new Error('fixture: no Blobs context in the event'); },
    getStore: () => memStore,
  };
  return originalLoad.call(this, name, ...rest);
};

// ---- environment (fixture-only secrets) and a GHL recorder
Object.assign(process.env, {
  IAOS_ENV: 'test', GHL_PRIVATE_API_KEY: 'offline-fixture', RESEND_API_KEY: 'offline-fixture',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client', IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid', IAOS_APP_READ_ALLOWED_ORIGIN: 'https://proof.example.invalid',
});
const GHL = 'https://services.leadconnectorhq.com';
let outbound = []; let onSend = null; let ghlAnswer = null; let nonGhl = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const GENERIC = { contacts: [], meta: {}, opportunities: [], conversations: [], calendars: [], customValues: [], tasks: [], documents: [], contact: { id: 'fxContact0001', customFields: [] }, messages: { messages: [] }, customFields: [], total: 0 };
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith(GHL + '/')) { nonGhl.push({ url: u, method: init.method || 'GET' }); throw new Error('fixture: non-GHL request refused offline: ' + u); }
  outbound.push({ url: u, method: init.method || 'GET' });
  if (onSend) onSend(u);
  return ghlAnswer ? ghlAnswer(u, init) : json(GENERIC);
};

const cfgMod = require(path.join(APP, 'shared', 'ghl-config.ts'));
const lib = require(path.join(FUNCTIONS, 'lib', 'supplemental-read-budget.ts'));
const readAuth = require(path.join(FUNCTIONS, 'lib', 'app-read-auth.ts'));
const testCfg = cfgMod.getConfig('test'); const prodCfg = cfgMod.getConfig('production');
const COMMITTED_TEST = { ...testCfg.supplementalReadBudget }; const COMMITTED_PROD = { ...prodCfg.supplementalReadBudget };
const token = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token;
const B64 = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
const ev = (q = {}, extra = {}) => ({ httpMethod: 'GET', headers: { cookie: `${readAuth.READ_COOKIE}=${token}`, 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' }, queryStringParameters: q, blobs: B64, ...extra });
const SCOPE = `test:${testCfg.locationId}`;
const enable = (ceiling, budgetId = 'offline-reads') => { testCfg.supplementalReadBudget = { enabled: cfgMod.SUPPLEMENTAL_READ_BUDGET_ENABLED, budgetId, ceiling }; };
const disable = () => { testCfg.supplementalReadBudget = { ...COMMITTED_TEST }; };
const record = (budgetId = 'offline-reads') => data.get(lib.readBudgetKey(SCOPE, budgetId)) ?? null;
const reset = () => { data.clear(); etags.clear(); outbound = []; nonGhl = []; onSend = null; ghlAnswer = null; blobOps = 0; blobContextRequired = true; faults = { readThrow: 0, writeThrow: 0, applyThenThrow: 0, neverModified: false, consistencyError: 0, oddAck: [] }; disable(); process.env.IAOS_ENV = 'test'; prodCfg.supplementalReadBudget = { ...COMMITTED_PROD }; };
const body = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

const HANDLERS = [
  ['ghl-contacts', {}], ['ghl-contact', { id: 'fxContact0001' }], ['ghl-proxy', { path: '/contacts/fxContact0001' }],
  ['ghl-contact-conversations', { id: 'fxContact0001' }], ['ghl-opportunities', {}], ['ghl-conversations', {}],
  ['ghl-calendar-events', {}], ['ghl-documents-capability', {}], ['ghl-underwriting-policy', {}],
  ['call-eligibility', { contactId: 'fxContact0001' }], ['ghl-mailers', {}], ['mailer-digest', null],
];
const H = Object.fromEntries(HANDLERS.map(([n]) => [n, require(path.join(FUNCTIONS, n + '.ts')).handler]));
const run = (n, q) => (q === null ? H[n]({ blobs: B64, headers: { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' } }) : H[n](ev(q)));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------- committed configuration
test('config: committed Production and Test both carry SUPPLEMENTAL_READ_BUDGET_DISABLED (this commit enables nothing)', () => {
  assert.deepEqual(COMMITTED_PROD, { enabled: cfgMod.SUPPLEMENTAL_READ_BUDGET_DISABLED, budgetId: 'not-applicable-in-production', ceiling: 0 });
  assert.equal(COMMITTED_TEST.enabled, cfgMod.SUPPLEMENTAL_READ_BUDGET_DISABLED);
  assert.notEqual(cfgMod.SUPPLEMENTAL_READ_BUDGET_ENABLED, cfgMod.SUPPLEMENTAL_READ_BUDGET_DISABLED);
});
test('config: property-answer\'s separate budget is unchanged (b15-04-eval-1 / 40)', () => {
  assert.deepEqual({ ...testCfg.propertyAnswerEvaluation.requestBudget }, { budgetId: 'b15-04-eval-1', ceiling: 40 });
  assert.notEqual(lib.readBudgetKey(SCOPE, 'b15-04-eval-1').split('/').slice(0, 2).join('/'), 'pa/eval-budget');
});

// ---------------- the shared record
test('budget: reserves 1..ceiling with a receipt each, then refuses unsent ("exhausted")', async () => {
  const b = new lib.SupplementalReadBudget(memStore, SCOPE, 'u1', 3);
  for (let i = 1; i <= 3; i++) assert.equal(await b.reserve('fn', '/p' + i, T0), i);
  await assert.rejects(b.reserve('fn', '/p4', T0), (e) => e instanceof lib.SupplementalReadRefused && e.code === 'exhausted');
  const r = await b.snapshot(); assert.equal(r.reserved, 3); assert.deepEqual(r.receipts.map((x) => [x.n, x.path]), [[1, '/p1'], [2, '/p2'], [3, '/p3']]);
});
test('budget: ONE shared ceiling across concurrent invocations -- 40 racing reservations on ceiling 25 give exactly 25', async () => {
  const mk = () => new lib.SupplementalReadBudget(memStore, SCOPE, 'u2', 25, () => new Promise((r) => setTimeout(r, Math.random() * 3)));
  const res = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => mk().reserve('fn', '/c' + i, T0)));
  const won = res.filter((x) => x.status === 'fulfilled').map((x) => x.value).sort((a, b) => a - b);
  assert.deepEqual(won, Array.from({ length: 25 }, (_, i) => i + 1), 'unique, gap-free numbers');
  assert.ok(res.filter((x) => x.status === 'rejected').every((x) => ['exhausted', 'unavailable'].includes(x.reason.code)));
  assert.equal(res.filter((x) => x.status === 'rejected' && x.reason.code === 'exhausted').length, 15);
  const r = record('u2') ?? data.get(lib.readBudgetKey(SCOPE, 'u2')); assert.equal(r.reserved, 25); assert.equal(r.receipts.length, 25);
});
test('budget: no automatic reset -- a fresh instance (a new invocation) of an exhausted budget still refuses', async () => {
  const b1 = new lib.SupplementalReadBudget(memStore, SCOPE, 'u3', 1); await b1.reserve('fn', '/a', T0);
  const b2 = new lib.SupplementalReadBudget(memStore, SCOPE, 'u3', 1);
  await assert.rejects(b2.reserve('fn', '/b', T0), (e) => e.code === 'exhausted');
});
test('budget: a different budget id is a different record (only a new reviewed id starts another)', async () => {
  await new lib.SupplementalReadBudget(memStore, SCOPE, 'u4a', 1).reserve('fn', '/a', T0);
  assert.equal(await new lib.SupplementalReadBudget(memStore, SCOPE, 'u4b', 1).reserve('fn', '/a', T0), 1);
  assert.notEqual(lib.readBudgetKey(SCOPE, 'u4a'), lib.readBudgetKey(SCOPE, 'u4b'));
});
test('budget: an unreadable record refuses ("unavailable") and writes nothing', async () => {
  faults.readThrow = 1; const before = data.size;
  await assert.rejects(new lib.SupplementalReadBudget(memStore, SCOPE, 'u5', 5).reserve('fn', '/a', T0), (e) => e.code === 'unavailable');
  assert.equal(data.size, before);
});
test('budget: an unconfirmed (thrown) reservation write refuses ("unavailable")', async () => {
  faults.writeThrow = 1;
  await assert.rejects(new lib.SupplementalReadBudget(memStore, SCOPE, 'u6', 5).reserve('fn', '/a', T0), (e) => e.code === 'unavailable');
});
test('budget: a write that APPLIED but was not acknowledged refuses, and the unit is never given back', async () => {
  const b = new lib.SupplementalReadBudget(memStore, SCOPE, 'u7', 3);
  assert.equal(await b.reserve('fn', '/open', T0), 1);   // opens the budget (genesis + record)
  faults.applyThenThrow = 1;   // the next RECORD write applies, then its acknowledgement is lost
  await assert.rejects(b.reserve('fn', '/a', T0), (e) => e.code === 'unavailable');
  assert.equal((await b.snapshot()).reserved, 2, 'counted although refused');
  assert.equal(await b.reserve('fn', '/b', T0), 3);
  await assert.rejects(b.reserve('fn', '/c', T0), (e) => e.code === 'exhausted');
});
test('budget: contention that never resolves refuses after bounded attempts ("unavailable")', async () => {
  faults.neverModified = true;
  await assert.rejects(new lib.SupplementalReadBudget(memStore, SCOPE, 'u8', 5, async () => {}).reserve('fn', '/a', T0), (e) => e.code === 'unavailable');
});
test('budget: malformed or mismatched records refuse ("unavailable") and are not overwritten', async () => {
  const key = lib.readBudgetKey(SCOPE, 'u9');
  for (const bad of [{ v: 2, budgetId: 'u9', ceiling: 5, reserved: 0, receipts: [] }, { v: 1, budgetId: 'u9', ceiling: 6, reserved: 0, receipts: [] },
                     { v: 1, budgetId: 'u9', ceiling: 5, reserved: 2, receipts: [] }, { v: 1, budgetId: 'u9', ceiling: 5, reserved: 9, receipts: Array(9).fill({}) }, null]) {
    data.set(key, bad); etags.set(key, 'x');
    await assert.rejects(new lib.SupplementalReadBudget(memStore, SCOPE, 'u9', 5).reserve('fn', '/a', T0), (e) => e.code === 'unavailable');
    assert.deepEqual(data.get(key), bad);
  }
});
test('budget: without strong consistency the read falls back and compare-and-swap still holds the ceiling', async () => {
  faults.consistencyError = 2; const b = new lib.SupplementalReadBudget(memStore, SCOPE, 'u10', 1);
  assert.equal(await b.reserve('fn', '/a', T0), 1);
  await assert.rejects(b.reserve('fn', '/b', T0), (e) => e.code === 'exhausted');
});
test('budget: an invalid id or ceiling is refused at construction', () => {
  for (const [id, c] of [['bad id', 1], ['ok', -1], ['ok', 1.5], ['x'.repeat(65), 1]]) assert.throws(() => new lib.SupplementalReadBudget(memStore, SCOPE, id, c), (e) => e.code === 'invalid');
});

// ---------------- ghlReadFetch
test('fetch: DISABLED (committed Test, committed Production) is the platform fetch -- zero Blob access', async () => {
  for (const env of ['test', 'production']) {
    reset(); process.env.IAOS_ENV = env;
    const r = await lib.ghlReadFetch({}, 'fn')(GHL + '/contacts/x', {});
    assert.equal(r.status, 200); assert.equal(outbound.length, 1); assert.equal(blobOps, 0);
  }
});
test('fetch: ENABLED reserves and stores the receipt BEFORE the request is sent', async () => {
  enable(5); let seen = -1; onSend = () => { seen = record()?.reserved ?? 0; };
  await lib.ghlReadFetch(ev(), 'fn-a')(GHL + '/contacts/abc?locationId=L&secret=1', {});
  assert.equal(seen, 1, 'the receipt existed when the request went out');
  assert.deepEqual(record().receipts.map((x) => [x.n, x.fn, x.path]), [[1, 'fn-a', '/contacts/abc']], 'path only: no query values');
});
test('fetch: ENABLED refuses unsent -- non-GHL origin, non-GET, no Blob context, and any deployment but Test', async () => {
  enable(5);
  await assert.rejects(lib.ghlReadFetch(ev(), 'fn')('https://example.invalid/x', {}), (e) => e.code === 'invalid');
  await assert.rejects(lib.ghlReadFetch(ev(), 'fn')(GHL + '/contacts/x', { method: 'PUT' }), (e) => e.code === 'invalid');
  await assert.rejects(lib.ghlReadFetch({ headers: {} }, 'fn')(GHL + '/contacts/x', {}), (e) => e.code === 'unavailable');
  process.env.IAOS_ENV = 'production'; prodCfg.supplementalReadBudget = { enabled: cfgMod.SUPPLEMENTAL_READ_BUDGET_ENABLED, budgetId: 'p', ceiling: 5 };
  await assert.rejects(lib.ghlReadFetch(ev(), 'fn')(GHL + '/contacts/x', {}), (e) => e.code === 'invalid');
  assert.equal(outbound.length, 0); assert.equal(record(), null);
});

// ---------------- every metered handler
test('handlers: DISABLED -- every metered function behaves as before with ZERO Blob access', async () => {
  for (const [n, q] of HANDLERS) { reset(); const r = await run(n, q); assert.notEqual(r.statusCode, 503, n); assert.ok(outbound.length >= 1, n + ' sent its read'); assert.equal(blobOps, 0, n); }
});
test('handlers: ENABLED at the ceiling -- every metered function answers 503 supplemental_read_exhausted with ZERO GHL requests', async () => {
  for (const [n, q] of HANDLERS) {
    reset(); enable(0); const r = await run(n, q);
    assert.equal(r.statusCode, 503, n); assert.equal(body(r).code, n === 'mailer-digest' ? 'supplemental_read_mailer_suspended' : 'supplemental_read_exhausted', n); assert.equal(body(r).outcome, 'not_sent', n);
    assert.equal(outbound.length, 0, n + ' sent nothing');
  }
});
test('handlers: ENABLED with room -- each function answers as when disabled, and EVERY GHL request it sent has exactly one receipt, taken first', async () => {
  for (const [n, q] of HANDLERS.filter(([n]) => n !== 'mailer-digest')) {   // the mailer is suspended when enabled (own test)
    reset(); const off = await run(n, q); const offSent = outbound.length;
    reset(); enable(1000); let ok = true; onSend = () => { if ((record()?.reserved ?? 0) < outbound.length) ok = false; };
    const on = await run(n, q);
    assert.equal(on.statusCode, off.statusCode, n); assert.equal(outbound.length, offSent, n);
    assert.equal(record().reserved, outbound.length, n + ': receipts = requests'); assert.ok(ok, n + ': every receipt preceded its request');
    assert.ok(record().receipts.every((x) => x.fn === n), n);
  }
});
test('pagination: every page reserves; the page past the ceiling is refused unsent (contacts and pipeline)', async () => {
  for (const [n, listKey] of [['ghl-contacts', 'contacts'], ['ghl-opportunities', 'opportunities']]) {
    reset(); enable(2); let page = 0;
    ghlAnswer = () => { page++; return json({ [listKey]: Array.from({ length: 100 }, (_, i) => ({ id: `p${page}x${i}` })), meta: { startAfterId: 'c' + page, startAfter: page } }); };
    const r = await run(n, {});
    assert.equal(r.statusCode, 503, n); assert.equal(body(r).code, 'supplemental_read_exhausted'); assert.equal(outbound.length, 2, n); assert.equal(record().reserved, 2);
  }
});
test('pagination: conversation message pages each reserve (search + pages), refused unsent at the ceiling', async () => {
  reset(); enable(3); let pages = 0;
  ghlAnswer = (u) => u.includes('/conversations/search') ? json({ conversations: [{ id: 'cv1' }] })
    : (pages++, json({ messages: { messages: [{ id: 'm' + pages }], nextPage: true, lastMessageId: 'm' + pages } }));
  const r = await run('ghl-contact-conversations', { id: 'fxContact0001' });
  assert.equal(r.statusCode, 503); assert.equal(outbound.length, 3, 'search + 2 message pages'); assert.equal(record().reserved, 3);
});
test('retries and remounts: repeated invocations (client retry, tab return, Back) draw on the SAME record', async () => {
  reset(); enable(3);
  for (const [n, q] of [['ghl-contacts', {}], ['ghl-contacts', {}], ['ghl-contact', { id: 'fxContact0001' }]]) assert.equal((await run(n, q)).statusCode, 200);
  const r = await run('ghl-contact', { id: 'fxContact0001' });
  assert.equal(r.statusCode, 503); assert.equal(record().reserved, 3); assert.equal(outbound.length, 3);
});
test('concurrency: 12 simultaneous workspace-style invocations on ceiling 7 send exactly 7 requests', async () => {
  reset(); enable(7);
  const calls = Array.from({ length: 12 }, (_, i) => run(['ghl-contact', 'ghl-proxy', 'ghl-contact-conversations', 'ghl-opportunities'][i % 4], i % 4 === 1 ? { path: '/contacts/fxContact0001' } : { id: 'fxContact0001' }));
  const res = await Promise.all(calls);
  assert.equal(outbound.length, 7); assert.equal(record().reserved, 7);
  assert.equal(res.filter((r) => r.statusCode === 503).length, 5);
  assert.ok(res.filter((r) => r.statusCode === 503).every((r) => ['supplemental_read_exhausted', 'supplemental_read_unavailable'].includes(body(r).code)));
});
test('ambiguity at the handler: an unconfirmed reservation answers 503 supplemental_read_unavailable and sends nothing', async () => {
  reset(); enable(5); faults.writeThrow = 1;
  const r = await run('ghl-contacts', {});
  assert.equal(r.statusCode, 503); assert.equal(body(r).code, 'supplemental_read_unavailable'); assert.equal(outbound.length, 0);
});
test('read auth still comes first: without a read session nothing is reserved or sent', async () => {
  reset(); enable(5);
  const r = await H['ghl-contacts']({ httpMethod: 'GET', headers: {}, blobs: B64 });
  assert.equal(r.statusCode, 401); assert.equal(outbound.length, 0); assert.equal(blobOps, 0);
});

test('mailer-digest: while ENABLED it is suspended -- zero GHL reads and ZERO email sends (scheduled or manual), even with a configured provider key', async () => {
  const answer = (u) => json(u.includes('/customValues/') ? { customValue: { value: 'digest@example.invalid' } } : GENERIC);
  reset(); ghlAnswer = answer; await run('mailer-digest', null);
  assert.equal(nonGhl.filter((x) => x.url.startsWith('https://api.resend.com/')).length, 1, 'disabled: the existing behaviour is unchanged (one send attempt)');
  assert.ok(process.env.RESEND_API_KEY, 'a synthetic provider key is configured');
  for (const ceiling of [0, 1000]) {
    for (const invoke of [() => run('mailer-digest', null), () => H['mailer-digest'](ev()), () => H['mailer-digest']()]) {   // scheduled, manual, bare
      reset(); ghlAnswer = answer; enable(ceiling); const r = await invoke();
      assert.equal(r.statusCode, 503); assert.equal(body(r).code, 'supplemental_read_mailer_suspended');
      assert.equal(nonGhl.length, 0, 'no email send'); assert.equal(outbound.length, 0, 'no GHL read'); assert.equal(record(), null, 'nothing reserved');
    }
  }
  const src = fs.readFileSync(path.join(FUNCTIONS, 'mailer-digest.ts'), 'utf8');
  assert.equal((src.match(/api\.resend\.com/g) || []).length, 1, 'one send site, unchanged');
  assert.ok(src.indexOf('supplementalReadBudgetActive()') < src.indexOf('api.resend.com'), 'the suspension precedes the send site');
});

// ---------------- Bones SEQ 17 probe matrix
const T0 = '2026-10-19T12:00:00.000Z'; const at = (ms) => new Date(Date.parse(T0) + ms).toISOString();
test('genesis: a record missing AFTER the budget was opened is refused for good -- never a fresh allowance', async () => {
  const b = new lib.SupplementalReadBudget(memStore, SCOPE, 'g1', 5);
  assert.equal(await b.reserve('fn', '/a', T0), 1); assert.equal(await b.reserve('fn', '/b', at(1000)), 2);
  data.delete(b.key); etags.delete(b.key);   // the record disappears (deleted / lost)
  await assert.rejects(b.reserve('fn', '/c', at(lib.INIT_WINDOW_MS + 1)), (e) => e.code === 'unavailable' && /missing after it was opened/.test(e.message));
  await assert.rejects(new lib.SupplementalReadBudget(memStore, SCOPE, 'g1', 5).reserve('fn', '/d', at(3_600_000)), (e) => e.code === 'unavailable');
  assert.equal(data.get(b.key), undefined, 'not recreated');
});
test('genesis: concurrent FIRST reservations on a new budget id (initialization race) give exactly the ceiling, no false refusal', async () => {
  const res = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => new lib.SupplementalReadBudget(memStore, SCOPE, 'g2', 10, () => new Promise((r) => setTimeout(r, Math.random() * 3))).reserve('fn', '/i' + i, T0)));
  const won = res.filter((x) => x.status === 'fulfilled').map((x) => x.value).sort((a, b) => a - b);
  assert.deepEqual(won, Array.from({ length: 10 }, (_, i) => i + 1));
  assert.ok(res.filter((x) => x.status === 'rejected').every((x) => x.reason.code === 'exhausted' || (x.reason.code === 'unavailable' && /contention/.test(x.reason.message))), 'no "missing after opened" refusal during initialization');
});
test('genesis: an unconfirmed genesis write leaves the budget unopened and refused; a malformed marker refuses', async () => {
  faults.writeThrow = 1;
  await assert.rejects(new lib.SupplementalReadBudget(memStore, SCOPE, 'g3', 5).reserve('fn', '/a', T0), (e) => e.code === 'unavailable');
  assert.equal(data.get(lib.readBudgetKey(SCOPE, 'g3')), undefined, 'no record, nothing dispatched');
  const k = lib.readBudgetKey(SCOPE, 'g4') + '/genesis'; data.set(k, { v: 1, budgetId: 'other', ceiling: 5, at: T0 }); etags.set(k, 'x');
  await assert.rejects(new lib.SupplementalReadBudget(memStore, SCOPE, 'g4', 5).reserve('fn', '/a', T0), (e) => e.code === 'unavailable');
});
test('ambiguity: only modified === true authorizes dispatch -- {}, {modified:"yes"}, null, undefined and {modified:1} all refuse', async () => {
  for (const odd of [{}, { modified: 'yes' }, null, undefined, { modified: 1 }]) {
    reset(); enable(5); faults.oddAck = [odd];
    const r = await run('ghl-contact', { id: 'fxContact0001' });
    assert.equal(r.statusCode, 503, JSON.stringify(odd)); assert.equal(body(r).code, 'supplemental_read_unavailable'); assert.equal(outbound.length, 0, 'nothing sent');
  }
});
test('spent stays spent: a unit is never refunded when the request rejects or answers 4xx/5xx', async () => {
  reset(); enable(4);
  ghlAnswer = () => { throw new Error('fixture: connection reset'); }; await run('ghl-contact', { id: 'fxContact0001' });
  ghlAnswer = () => json({ error: 'x' }, 500); await run('ghl-contact', { id: 'fxContact0001' });
  ghlAnswer = () => json({ error: 'x' }, 404); await run('ghl-contact', { id: 'fxContact0001' });
  assert.equal(record().reserved, 3); assert.equal(outbound.length, 3);
  ghlAnswer = null; assert.equal((await run('ghl-contact', { id: 'fxContact0001' })).statusCode, 200);
  const r = await run('ghl-contact', { id: 'fxContact0001' }); assert.equal(r.statusCode, 503); assert.equal(outbound.length, 4);
});
test('last slot: two DIFFERENT handlers racing for the final unit -- exactly one request reaches GHL', async () => {
  for (let k = 0; k < 5; k++) {
    reset(); enable(3); await run('ghl-contact', { id: 'fxContact0001' }); await run('ghl-contact', { id: 'fxContact0001' });
    const res = await Promise.all([run('ghl-proxy', { path: '/contacts/fxContact0001' }), run('ghl-opportunities', {})]);
    assert.equal(outbound.length, 3); assert.equal(record().reserved, 3); assert.equal(res.filter((r) => r.statusCode === 503).length, 1);
  }
});
test('paging edge cases: missing metadata, a short page and an empty page each stop after their own reserved page; a repeated cursor is bounded', async () => {
  for (const [label, pageBody] of [['missing meta', { contacts: Array.from({ length: 100 }, (_, i) => ({ id: 'a' + i })) }],
                                   ['short page', { contacts: [{ id: 'x' }], meta: { startAfterId: 'c', startAfter: 1 } }],
                                   ['empty page', { contacts: [], meta: { startAfterId: 'c', startAfter: 1 } }]]) {
    reset(); enable(10); ghlAnswer = () => json(pageBody);
    const r = await run('ghl-contacts', {}); assert.equal(r.statusCode, 200, label); assert.equal(outbound.length, 1, label); assert.equal(record().reserved, 1, label);
  }
  reset(); enable(4); ghlAnswer = () => json({ contacts: Array.from({ length: 100 }, (_, i) => ({ id: 'r' + i })), meta: { startAfterId: 'SAME', startAfter: 1 } });
  const r = await run('ghl-contacts', {}); assert.equal(r.statusCode, 503, 'a repeated cursor is bounded by the ceiling'); assert.equal(outbound.length, 4);
});
test('inventory: per metered function, GHL requests dispatched = reservations persisted (printed)', async () => {
  const rows = [];
  for (const [n, q] of HANDLERS.filter(([n]) => n !== 'mailer-digest')) { reset(); enable(1000); await run(n, q); rows.push([n, outbound.length, record()?.reserved ?? 0]); }
  for (const [n, d, rsv] of rows) console.log(`     ${n}: dispatched ${d}, reserved ${rsv}`);
  assert.ok(rows.every(([, d, rsv]) => d === rsv && d >= 1));
});

// ---------------- coverage (source): every GHL-using function is either metered or an excluded write endpoint
test('coverage: every netlify function that calls GHL is metered here or is a listed write endpoint', () => {
  const METERED = HANDLERS.map(([n]) => n + '.ts');
  const EXCLUDED = ['property-answer.ts', 'ghl-write.ts', 'ghl-disposition.ts', 'generate-contract-pdf.ts', 'ghl-contract-send-readback.ts',
    'ghl-executed-artifact-upload.ts', 'call-log-barrier.ts', 'current-offer-barrier.ts'];
  const uses = fs.readdirSync(FUNCTIONS).filter((f) => f.endsWith('.ts')).filter((f) => {
    const s = fs.readFileSync(path.join(FUNCTIONS, f), 'utf8');
    return /leadconnectorhq|GHL_BASE|configuredBoundary|mailer-shared/.test(s);
  });
  assert.deepEqual(uses.filter((f) => !METERED.includes(f) && !EXCLUDED.includes(f)), [], 'an unclassified GHL-using function');
  for (const f of METERED) {
    const s = fs.readFileSync(path.join(FUNCTIONS, f), 'utf8');
    assert.match(s, /from "\.\/lib\/supplemental-read-budget"/, f);
    const raw = s.split('\n').filter((l) => /\bfetch\(/.test(l) && !/api\.resend\.com/.test(l));
    assert.deepEqual(raw, [], f + ' still calls fetch directly');
  }
  const shared = fs.readFileSync(path.join(FUNCTIONS, 'lib', 'mailer-shared.ts'), 'utf8').split('\n').filter((l) => /\bfetch\(/.test(l));
  assert.ok(shared.every((l) => /=> fetch\(i, n\)/.test(l)), 'mailer-shared only falls back to the platform fetch when no meter is passed');
  for (const f of EXCLUDED) assert.doesNotMatch(fs.readFileSync(path.join(FUNCTIONS, f), 'utf8'), /supplemental-read-budget/, f + ' is not metered here');
});

// Each test runs in its OWN child process with a hard kill (Jess/Brad 2026-10-19): a defect such as an unmetered
// pagination loop on the endless-page fixtures is terminated, and cannot keep running into later tests.
const { spawnSync } = require('node:child_process');
if (process.argv[2] === '--one') {
  const [name, fn] = tests[Number(process.argv[3])];
  (async () => {
    reset();
    try { await fn(); console.log('PASS ' + name); process.exit(0); }
    catch (e) { console.log('FAIL ' + name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e)); process.exit(1); }
  })();
} else {
  let pass = 0, fail = 0;
  tests.forEach(([name], i) => {
    const r = spawnSync(process.execPath, [__filename, '--one', String(i)], { env: process.env, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    const out = (r.stdout || '').trim();
    if (r.status === 0 && /^PASS /.test(out.split('\n').pop())) { pass++; console.log(out); }   // the child's verdict is its LAST line
    else { fail++; console.log(out || ('FAIL ' + name)); if (r.error || r.signal) console.log(`     killed after 30 s (${r.signal || r.error.code}): the test did not terminate`); }
  });
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
}
