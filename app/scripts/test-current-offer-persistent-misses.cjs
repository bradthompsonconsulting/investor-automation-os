/**
 * B14-13 Production (Brad / Bones, 2026-10-12) -- the Current Offer
 * reserve-to-save handoff when cached misses PERSIST.
 *
 * Production at 82c4c75 (2026-10-12 00:50Z): the reservation's request record
 * existed for the whole of the save's re-read window, yet the save's ownership
 * read was still served "missing" -- the edge did not converge after a few
 * reads, as test-current-offer-eventual-reads.cjs assumed. beginBarrier had
 * read that key (missing) just before writing it.
 *
 * This fake does NOT converge on a miss: once an eventual read of a key is
 * cached as missing, that key reads as missing for the rest of the test. A
 * changed existing value is stale for STALE_READS reads; a `frozen` key keeps
 * its cached value. Strong reads throw BlobsConsistencyError, as deployed.
 *
 * It checks that the save no longer depends on convergence (begin no longer
 * reads the new keys), that the remaining stale-read cases refuse without
 * sending and are logged (fingerprint, read mode, read count, elapsed time;
 * no secrets), and that every protection holds. Drives the REAL ghl-write and
 * current-offer-barrier handlers. Offline.
 *
 * Brad (2026-10-12), the two known stale-read failures, now FIXED and checked
 * here under misses that never converge: a brand-new deal's first reservation
 * (its head was read as missing on page load), and a status check during a
 * save (the step's decision was read as missing before the save claimed it).
 * A confirmed save whose release could not complete is reported as "saved,
 * release pending" -- never as "nothing sent".
 */
const receiptShim = require('./lib/receipt-recorder-shim.cjs'); // the repaired receipt helpers' recorded fetch (test-only)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const origin = new Map();
const etags = new Map();
let etagSeq = 0;
const edge = new Map();           // key -> { snap: { data, etag }, served }
let STALE_READS = 2;
let frozen = () => false;
let loseSwap = () => false;
let failWrite = () => false;
const readKeys = new Set();
const warnings = [];
const refusalLogsEver = [];
const realWarn = console.warn;
console.warn = (...a) => { const line = a.join(' '); warnings.push(line); if (/reservation refusal|begin refused|release pending/.test(line)) refusalLogsEver.push(line); realWarn(...a); };
let strongAttempts = 0;
let eventualReads = 0;
const clone = (v) => (v === null || v === undefined ? null : structuredClone(v));
const originSnap = (key) => ({ data: origin.has(key) ? clone(origin.get(key)) : null, etag: etags.get(key) ?? null });
function edgeRead(key, options) {
  if (options?.consistency === 'strong') {
    strongAttempts++;
    const e = new Error("Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property");
    e.name = 'BlobsConsistencyError';
    throw e;
  }
  eventualReads++;
  readKeys.add(key);
  const now = originSnap(key);
  const cached = edge.get(key);
  if (!cached) { edge.set(key, { snap: now, served: 0 }); return now; }
  if (cached.snap.etag === now.etag) return now;
  // A cached MISS is never revalidated, and a frozen key keeps whatever it cached.
  if (cached.snap.data === null || frozen(key)) return { data: null === cached.snap.data ? null : clone(cached.snap.data), etag: cached.snap.etag };
  if (cached.served < STALE_READS) { cached.served++; return { data: clone(cached.snap.data), etag: cached.snap.etag }; }
  edge.set(key, { snap: now, served: 0 });
  return now;
}
const realBlobs = require('@netlify/blobs');
delete process.env.NETLIFY_BLOBS_CONTEXT;
const lambdaHeaders = { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' };
const lambdaBlobs = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return receiptShim.wrap({
    connectLambda: (event) => realBlobs.connectLambda(event),
    getStore: () => ({
      async get(key, options) { const s = edgeRead(key, options); return s.data; },
      async getWithMetadata(key, options) { const s = edgeRead(key, options); return s.data === null ? null : { data: s.data, etag: s.etag }; },
      async setJSON(key, value, options) {
        if (failWrite(key, value)) throw new Error('injected storage failure');
        if (options?.onlyIfNew && origin.has(key)) return { modified: false };
        if (options?.onlyIfMatch !== undefined && (etags.get(key) !== options.onlyIfMatch || loseSwap(key, value))) return { modified: false };
        origin.set(key, clone(value));
        const etag = 'etag-' + (++etagSeq); etags.set(key, etag);
        return { modified: true, etag };
      },
      async delete(key) { origin.delete(key); etags.delete(key); },
    }),
  });
  return originalLoad.call(this, name, ...rest);
};
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';
process.env.IAOS_APP_READ_GOOGLE_CLIENT_ID = 'offline-read-client';
process.env.IAOS_APP_READ_SESSION_SECRET = 'offline-read-fixture-only-not-a-real-secret';
process.env.IAOS_APP_READ_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_READ_ALLOWED_ORIGIN = 'https://proof.example.invalid';

const auth = require('../netlify/functions/lib/app-write-auth.ts');
const readAuth = require('../netlify/functions/lib/app-read-auth.ts');
const { getConfig } = require('../shared/ghl-config.ts');
const config = getConfig('test');
const barrierLib = require('../netlify/functions/lib/current-offer-barrier.ts');
const OFFER_FIELD = config.opportunityFacts.currentOffer;
const HEAD_KEY = 'current-offer/head/' + require('node:crypto').createHash('sha256').update(`test:${config.locationId}:fixture-opportunity`).digest('hex');
let seedHead = true;
let pauses = [];
barrierLib.setSettlePauseForTests(async (ms) => { pauses.push(ms); });

// ── Fake GHL: deal A (the main fixture) and a distinct deal B ─────────────────
const contact = { id: 'fixture-contact', locationId: config.locationId, customFields: [], tags: [], phone: '+15555550101' };
const opportunity = { id: 'fixture-opportunity', contactId: contact.id, locationId: config.locationId, customFields: [] };
const contactB = { id: 'fixture-contact-b', locationId: config.locationId, customFields: [], tags: [], phone: '+15555550102' };
const opportunityB = { id: 'fixture-opportunity-b', contactId: contactB.id, locationId: config.locationId, customFields: [] };
let notes = [];
let ghlWrites = [];
const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
global.fetch = async (url, init = {}) => {
  const parsed = new URL(url); const pathname = parsed.pathname; const method = init.method || 'GET';
  assert.equal(parsed.origin, 'https://services.leadconnectorhq.com', 'no external network');
  const req = { method, pathname, body: init.body ? JSON.parse(init.body) : null };
  if (pathname === `/contacts/${contactB.id}/notes`) {
    if (method === 'POST') { ghlWrites.push(req); throw new Error('no note is ever sent to deal B in these checks'); }
    return reply({ notes: [] });
  }
  if (pathname === `/contacts/${contact.id}/notes`) {
    if (method === 'POST') { ghlWrites.push(req); const note = { id: `note-${notes.length}`, body: req.body.body }; notes.push(note); return reply({ note }); }
    return reply({ notes });
  }
  const object = { [`/contacts/${contact.id}`]: contact, [`/opportunities/${opportunity.id}`]: opportunity, [`/contacts/${contactB.id}`]: contactB, [`/opportunities/${opportunityB.id}`]: opportunityB }[pathname] ?? null;
  if (!object) throw new Error('Unexpected mocked request: ' + pathname);
  if (method === 'PUT') {
    ghlWrites.push(req);
    for (const field of req.body.customFields) {
      object.customFields = object.customFields.filter((f) => f.id !== field.id);
      if (field.field_value !== '' && field.field_value !== null) object.customFields.push({ id: field.id, [object.contactId ? 'fieldValue' : 'value']: field.field_value });
    }
  }
  return reply(object.contactId ? { opportunity: object } : { contact: object });
};

const ghlWrite = require('../netlify/functions/ghl-write.ts').handler;
const barrierFn = require('../netlify/functions/current-offer-barrier.ts').handler;
// "Enable saving" issues a fresh application write session; every request carries the current one.
let session = null;
const enableSaving = () => { session = auth.issueAppSession('brad@example.invalid').token; };
const writeHeaders = () => ({ ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${session}` });
let seq = 0;
const rid = (label) => `${label}-${String(++seq).padStart(4, '0')}-fixture`;
const write = (operation, targetId, args, requestId) => ghlWrite({ blobs: lambdaBlobs, httpMethod: 'POST', headers: writeHeaders(), body: JSON.stringify({ operation, targetId, requestId, args }) });
const offer = (value, requestId) => write('opportunity.currentOffer', opportunity.id, { value }, requestId);
const barrier = (b) => barrierFn({ blobs: lambdaBlobs, httpMethod: 'POST', headers: writeHeaders(), body: JSON.stringify(b) });
const begin = (purpose, steps) => barrier({ action: 'begin', opportunityId: opportunity.id, purpose, steps });
const beginBlur = (r) => begin('blur', [{ step: 'offer', requestId: r }]);
const checkAgain = () => barrier({ action: 'reconcile', opportunityId: opportunity.id });
const beginOn = (opportunityId, purpose, steps) => barrier({ action: 'begin', opportunityId, purpose, steps });
const statusOn = async (opportunityId) => JSON.parse((await barrierFn({ blobs: lambdaBlobs, httpMethod: 'GET', headers: { ...lambdaHeaders, cookie: readCookie() }, queryStringParameters: { opportunityId } })).body);
const readCookie = () => `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;
const status = async () => JSON.parse((await barrierFn({ blobs: lambdaBlobs, httpMethod: 'GET', headers: { ...lambdaHeaders, cookie: readCookie() }, queryStringParameters: { opportunityId: opportunity.id } })).body);
const body = (res) => JSON.parse(res.body);
const offerPuts = () => ghlWrites.filter((w) => w.method === 'PUT' && w.pathname === `/opportunities/${opportunity.id}`);
const currentOfferInGhl = () => (opportunity.customFields.find((f) => f.id === OFFER_FIELD) || {}).fieldValue ?? null;
const receiptKeys = () => [...origin.keys()].filter((k) => /^[0-9a-f]{64}$/.test(k));
const outcomeNote = (kind, opportunityId = opportunity.id) => require('../src/lib/seller-call-outcome.ts').formatOutcomeNote({ opportunityId, kind, at: '2026-10-11T22:10:00.000Z', operator: null, reason: kind === 'pass' ? 'not selling' : null, followUpAt: kind === 'follow_up' ? '2026-10-14T15:00:00.000Z' : null, snapshot: { sellerPosition: 500000, currentOffer: 400000, targetAcquisitionPrice: null, maxSupportedOffer: null, expectedSpread: null, arv: null, repairs: null, readinessStatus: 'OFFER_READY' } });

let count = 0;
let failures = 0;
async function check(name, fn) {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); }
}
function fresh() {
  origin.clear(); etags.clear(); edge.clear(); ghlWrites = []; notes = []; pauses = [];
  opportunity.customFields = []; contact.customFields = []; opportunityB.customFields = []; contactB.customFields = []; STALE_READS = 2; frozen = () => false; loseSwap = () => false; failWrite = () => false; readKeys.clear(); warnings.length = 0; enableSaving();
  // As in Production for this deal: its head record already exists (released, current null).
  if (seedHead) { origin.set(HEAD_KEY, { v: 2, current: null, at: '2026-10-11T00:00:00.000Z' }); etags.set(HEAD_KEY, 'etag-' + (++etagSeq)); }
}
// Status as the page polls it; an eventual read may lag, so poll a few times as the page does.
async function settledStatus() { let s; for (let i = 0; i < 4; i++) { s = await status(); if (s.state === 'clear') break; } return s; }
const sha = (x) => require('node:crypto').createHash('sha256').update(x).digest('hex');
const refusalLogs = () => warnings.filter((w) => /reservation refusal|begin refused/.test(w));
const headOf = (opportunityId) => origin.get('current-offer/head/' + sha(`test:${config.locationId}:${opportunityId}`)) ?? null;
const pendingLogs = () => warnings.filter((w) => /saved, release pending/.test(w));
const cachedMiss = (prefix) => [...edge.entries()].some(([k, v]) => k.startsWith(prefix) && v.snap.data === null);
const parseLog = (line) => JSON.parse(line.slice(line.indexOf('{')));

(async () => {
  await check('fixture: a key read as MISSING before its write is served as missing for good (no convergence); a changed value is stale for STALE_READS reads', async () => {
    fresh();
    const store = require('@netlify/blobs').getStore();
    await assert.rejects(store.get('k', { type: 'json', consistency: 'strong' }), { name: 'BlobsConsistencyError' });
    assert.equal(await store.get('k', { type: 'json' }), null);
    await store.setJSON('k', { v: 1 }, { onlyIfNew: true });
    for (let i = 0; i < 50; i++) assert.equal(await store.get('k', { type: 'json' }), null, 'the cached miss persists');
    await store.setJSON('h', { v: 1 });
    assert.deepEqual(await store.get('h', { type: 'json' }), { v: 1 }, 'never read before its write: served fresh');
    await store.setJSON('h', { v: 2 });
    assert.deepEqual(await store.get('h', { type: 'json' }), { v: 1 }, 'stale value');
    assert.deepEqual(await store.get('h', { type: 'json' }), { v: 1 }, 'stale value');
    assert.deepEqual(await store.get('h', { type: 'json' }), { v: 2 }, 'revalidated');
  });

  // ── Brad's sequence, with persistent cached misses ─────────────────────────
  await check("Brad's sequence with persistent misses: held never-sent save -> status polls -> Check again -> Enable saving -> Tab 400000 saves (200, one PUT, one receipt) and releases", async () => {
    fresh();
    const old = rid('old-blur');
    assert.equal((await beginBlur(old)).statusCode, 200);
    for (let i = 0; i < 3; i++) await status();                     // the page polls; the old step's decision is read as missing
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear', 'Check again clears the never-sent reservation');
    await status();
    enableSaving();
    const tab = rid('blur');
    const reserved = await beginBlur(tab);
    assert.equal(reserved.statusCode, 200, 'reserved: ' + reserved.body);
    const res = await offer(400000, tab);
    assert.equal(res.statusCode, 200, res.body); assert.equal(body(res).confirmed, true); assert.equal(body(res).reservation, 'released');
    assert.equal(offerPuts().length, 1); assert.equal(currentOfferInGhl(), 400000);
    assert.equal(receiptKeys().length, 1, 'exactly one write receipt');
    assert.equal((await settledStatus()).state, 'clear', 'the barrier released itself');
    assert.equal(refusalLogs().length, 0, 'no refusal');
  });
  await check('begin reads none of the new reservation keys before writing them', async () => {
    fresh();
    const tab = rid('blur');
    const before = new Set(readKeys);
    assert.equal((await beginBlur(tab)).statusCode, 200);
    const newlyRead = [...readKeys].filter((k) => !before.has(k));
    assert.ok(!newlyRead.some((k) => k.startsWith('current-offer/request/') || k.startsWith('current-offer/barrier/')), JSON.stringify(newlyRead));
  });
  await check('a save straight after a page load saves; a second Tab saves the next value', async () => {
    fresh();
    await status();
    const a = rid('blur'); assert.equal((await beginBlur(a)).statusCode, 200);
    assert.equal((await offer(400000, a)).statusCode, 200);
    await settledStatus();
    const b = rid('blur');
    let r; for (let i = 0; i < 3; i++) { r = await beginBlur(b); if (r.statusCode === 200) break; }
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await offer(410000, b)).statusCode, 200); assert.equal(currentOfferInGhl(), 410000); assert.equal(offerPuts().length, 2);
  });
  await check('a reserved Pass (note + last-touch) records and releases; a Follow-Up callback is sent', async () => {
    fresh();
    const ids = { note: rid('pass-note'), touch: rid('pass-touch') };
    assert.equal((await begin('pass', [{ step: 'note', requestId: ids.note }, { step: 'touch', requestId: ids.touch }])).statusCode, 200);
    assert.equal((await write('note.create', contact.id, { body: outcomeNote('pass') }, ids.note)).statusCode, 200);
    assert.equal((await write('contact.lastCallAttempt', contact.id, { value: '2026-10-12T01:10:00.000Z' }, ids.touch)).statusCode, 200);
    assert.equal((await settledStatus()).state, 'clear');
    const f = { callback: rid('fu-cb'), callback_note: rid('fu-cbnote'), touch: rid('fu-touch'), note: rid('fu-note') };
    assert.equal((await begin('follow_up', Object.entries(f).map(([step, requestId]) => ({ step, requestId })))).statusCode, 200);
    assert.equal((await write('contact.callback', contact.id, { value: '2026-10-14T15:00:00.000Z' }, f.callback)).statusCode, 200);
  });

  // ── Remaining stale-read cases: refused safely, diagnosed, not waited out ──
  await check('REMAINING: an ownership read that stays missing (the key was read before the reservation) is refused not_sent, zero GHL, within the unchanged re-read schedule, and logged', async () => {
    fresh();
    const id = rid('blur');
    await offer(400000, id);                                         // a read of the request key before it exists
    warnings.length = 0; pauses = [];
    assert.equal((await beginBlur(id)).statusCode, 200);
    const res = await offer(400000, id);
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent');
    assert.match(body(res).error, /No Current Offer reservation/);
    assert.equal(offerPuts().length, 0); assert.equal(receiptKeys().length, 0);
    assert.deepEqual(pauses, [150, 250, 400, 600, 800, 1000, 1200], 'the wait is not extended');
    const logs = refusalLogs(); assert.equal(logs.length, 1, JSON.stringify(warnings));
    const log = parseLog(logs[0]);
    assert.equal(log.path, 'ownership_missing'); assert.equal(log.operation, 'opportunity.currentOffer');
    assert.equal(log.reservation, sha(id)); assert.equal(log.readMode, 'eventual');
    assert.equal(log.reads, 8, 'one read plus seven re-reads'); assert.equal(typeof log.elapsedMs, 'number');
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear', 'the refused reservation is withdrawn and the deal released');
    const next = rid('blur'); assert.equal((await beginBlur(next)).statusCode, 200);
    assert.equal((await offer(400000, next)).statusCode, 200, 'a fresh Tab then saves');
  });
  await check('REMAINING: a head that stays stale after Check again refuses the new reservation as held within the 5 s budget, sends nothing, and logs it', async () => {
    fresh();
    const old = rid('old-blur'); await beginBlur(old);
    let seen; for (let i = 0; i < 4 && seen?.state !== 'blocked'; i++) seen = await status();
    assert.equal(seen.state, 'blocked', 'the edge now caches the head naming the old reservation');
    frozen = (k) => k.startsWith('current-offer/head/');            // ...and never revalidates it
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear', 'Check again releases the deal at the origin');
    warnings.length = 0; pauses = [];
    const id = rid('blur');
    const res = await beginBlur(id);
    assert.equal(res.statusCode, 409, res.body); assert.equal(body(res).state, 'blocked');
    assert.ok(pauses.reduce((a, b) => a + b, 0) <= 5000, JSON.stringify(pauses));
    const log = parseLog(refusalLogs()[0]);
    assert.equal(log.path, 'held'); assert.equal(log.reservation, sha(id)); assert.equal(log.readMode, 'eventual');
    const sent = await offer(400000, id);
    assert.equal(sent.statusCode, 409, sent.body); assert.equal(offerPuts().length, 0);
  });
  // ── The two known stale-read failures (Brad, 2026-10-12): fixed ─────────────
  await check('FIXED: status polled during a save (its decision read as missing, cached for good) -> the save confirms once and releases the deal itself; the next Tab saves', async () => {
    fresh();
    const tab = rid('blur'); assert.equal((await beginBlur(tab)).statusCode, 200);
    let polls = 0; for (let i = 0; i < 6 && polls < 3; i++) if ((await status()).state === 'blocked') polls++;   // the page polls while the save is reserved
    assert.equal(polls, 3, 'status shows the save as reserved');
    assert.ok(cachedMiss('current-offer/decision/'), 'the hostile case: the decision is cached as missing');
    // ...and a poll landing while GHL is being written would read the outcome before it exists:
    const outcomeKey = 'current-offer/outcome/' + sha(`test:${config.locationId}:${opportunity.id}:${sha(tab)}`);
    assert.equal(await require('@netlify/blobs').getStore().get(outcomeKey, { type: 'json' }), null);
    assert.ok(cachedMiss('current-offer/outcome/'), 'the outcome is cached as missing too');
    const res = await offer(400000, tab);
    assert.equal(res.statusCode, 200, res.body); assert.equal(body(res).confirmed, true);
    assert.equal(body(res).reservation, 'released', 'released with its own evidence, not a read-back');
    assert.equal(offerPuts().length, 1); assert.equal(receiptKeys().length, 1);
    assert.equal((await settledStatus()).state, 'clear');
    assert.equal(pendingLogs().length + refusalLogs().length, 0, JSON.stringify(warnings));
    const next = rid('blur'); assert.equal((await beginBlur(next)).statusCode, 200);
    assert.equal((await offer(410000, next)).statusCode, 200); assert.equal(currentOfferInGhl(), 410000);
    assert.equal((await offer(410000, tab)).statusCode !== 200, true, 'the first request is never sent again');
    assert.equal(offerPuts().length, 2);
  });
  await check('FIXED: status polled between the steps of a Pass (each step read as missing first) -> both steps record and the last step releases the deal', async () => {
    fresh();
    const ids = { note: rid('pass-note'), touch: rid('pass-touch') };
    assert.equal((await begin('pass', [{ step: 'note', requestId: ids.note }, { step: 'touch', requestId: ids.touch }])).statusCode, 200);
    await status(); await status();
    const n = await write('note.create', contact.id, { body: outcomeNote('pass') }, ids.note);
    assert.equal(n.statusCode, 200, n.body); assert.equal(body(n).reservation, 'next_step');
    assert.equal((await status()).state, 'blocked'); await status();
    const t = await write('contact.lastCallAttempt', contact.id, { value: '2026-10-12T01:10:00.000Z' }, ids.touch);
    assert.equal(t.statusCode, 200, t.body); assert.equal(body(t).reservation, 'released');
    assert.equal((await settledStatus()).state, 'clear'); assert.equal(notes.length, 1);
  });
  await check('FIXED: a brand-new deal (its head never existed): the page-load status creates the empty head instead of caching a miss; the first and second saves confirm and release', async () => {
    seedHead = false; fresh(); seedHead = true;
    assert.equal((await status()).state, 'clear', 'page load');
    assert.ok(!cachedMiss('current-offer/head/'), 'the head was never read while missing');
    assert.deepEqual(origin.get(HEAD_KEY)?.current, null, 'an empty head: nothing claimed');
    const id = rid('blur');
    assert.equal((await beginBlur(id)).statusCode, 200);
    const res = await offer(400000, id);
    assert.equal(res.statusCode, 200, res.body); assert.equal(body(res).reservation, 'released');
    assert.equal(offerPuts().length, 1); assert.equal(receiptKeys().length, 1);
    assert.equal((await settledStatus()).state, 'clear');
    const next = rid('blur');
    let r; for (let i = 0; i < 3; i++) { r = await beginBlur(next); if (r.statusCode === 200) break; }
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await offer(410000, next)).statusCode, 200); assert.equal(offerPuts().length, 2);
    assert.equal(refusalLogs().length, 0, JSON.stringify(warnings));
  });
  await check('FIXED: a brand-new deal reserved with no page-load status (Check again first, or begin straight away) saves and releases', async () => {
    seedHead = false; fresh(); seedHead = true;
    assert.equal(body(await checkAgain()).state, 'clear');
    const id = rid('blur'); assert.equal((await beginBlur(id)).statusCode, 200);
    assert.equal(body(await offer(400000, id)).reservation, 'released');
    seedHead = false; fresh(); seedHead = true;
    const id2 = rid('blur'); assert.equal((await beginBlur(id2)).statusCode, 200);
    for (let i = 0; i < 2; i++) await status();
    assert.equal(body(await offer(400000, id2)).reservation, 'released');
    assert.equal((await settledStatus()).state, 'clear');
  });
  await check('"SAVED, release pending" is distinct from "nothing sent": a confirmed save whose release lost the head swap answers 200 confirmed + release_pending, logs it, status says Saved, Check again releases, nothing is sent twice', async () => {
    fresh();
    const tab = rid('blur'); assert.equal((await beginBlur(tab)).statusCode, 200);
    await status();
    loseSwap = (key, value) => key === HEAD_KEY && value?.current === null;              // a concurrent head change during the release
    const res = await offer(400000, tab);
    loseSwap = () => false;
    assert.equal(res.statusCode, 200, res.body); assert.equal(body(res).confirmed, true);
    assert.equal(body(res).reservation, 'release_pending'); assert.equal(body(res).outcome, undefined, 'not a not_sent refusal');
    assert.equal(offerPuts().length, 1); assert.equal(currentOfferInGhl(), 400000);
    const logs = pendingLogs(); assert.equal(logs.length, 1, JSON.stringify(warnings));
    const log = parseLog(logs[0]); assert.equal(log.path, 'saved_release_pending'); assert.equal(log.reservation, sha(tab));
    assert.equal(refusalLogs().length, 0, 'not logged as a refusal');
    let st; for (let i = 0; i < 4; i++) { st = await status(); if (/^Saved/.test(st.message ?? '')) break; }
    assert.equal(st.state, 'blocked'); assert.match(st.message, /^Saved — the change reached GHL and was confirmed\. Releasing this deal is pending; use Check again\.$/);
    assert.doesNotMatch(st.message, /nothing was sent|may still reach GHL/i);
    const refused = await offer(410000, rid('rogue'));
    assert.match(body(refused).error, /nothing was sent/, 'a refusal still says nothing was sent');
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear', 'Check again reads the settled proof and releases');
    assert.equal((await offer(400000, tab)).statusCode !== 200, true); assert.equal(offerPuts().length, 1, 'never sent twice');
    const next = rid('blur'); assert.equal((await beginBlur(next)).statusCode, 200);
    assert.equal((await offer(410000, next)).statusCode, 200);
  });
  await check('Check again during a status-polled save that is then confirmed: the release still uses the save\'s own evidence; Check again afterwards clears via the settled proof, never by a read of the cached miss', async () => {
    fresh();
    const tab = rid('blur'); assert.equal((await beginBlur(tab)).statusCode, 200);
    for (let i = 0; i < 3; i++) await status();
    loseSwap = (key, value) => key === HEAD_KEY && value?.current === null;
    assert.equal(body(await offer(400000, tab)).reservation, 'release_pending');
    loseSwap = () => false;
    assert.ok(cachedMiss('current-offer/decision/'), 'the decision is still served as missing');
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear');
    assert.equal(offerPuts().length, 1);
  });
  await check('FIXED, complete multi-step release: Accept (offer, note, last-touch) and Follow-Up (callback, callback note, last-touch, note), with status polled before every step -- every earlier step answers next_step, the last answers released, the deal is clear and the next Tab saves', async () => {
    fresh();
    const a = { offer: rid('acc-offer'), note: rid('acc-note'), touch: rid('acc-touch') };
    assert.equal((await begin('accept', Object.entries(a).map(([step, requestId]) => ({ step, requestId })))).statusCode, 200);
    const seq = [
      [a.offer, () => offer(400000, a.offer), 'next_step'],
      [a.note, () => write('note.create', contact.id, { body: outcomeNote('accept') }, a.note), 'next_step'],
      [a.touch, () => write('contact.lastCallAttempt', contact.id, { value: '2026-10-12T01:20:00.000Z' }, a.touch), 'released'],
    ];
    for (const [, send, expected] of seq) {
      await status(); await status();
      const r = await send();
      assert.equal(r.statusCode, 200, r.body); assert.equal(body(r).reservation, expected, r.body);
    }
    assert.equal((await settledStatus()).state, 'clear', 'Accept released');
    fresh();                                                          // an accepted deal takes no Follow-Up: a fresh deal
    const f = { callback: rid('fu-cb'), callback_note: rid('fu-cbnote'), touch: rid('fu-touch'), note: rid('fu-note') };
    let r0; for (let i = 0; i < 3; i++) { r0 = await begin('follow_up', Object.entries(f).map(([step, requestId]) => ({ step, requestId }))); if (r0.statusCode === 200) break; }
    assert.equal(r0.statusCode, 200, r0.body);
    const fseq = [
      () => write('contact.callback', contact.id, { value: '2026-10-14T15:00:00.000Z' }, f.callback),
      () => write('note.create', contact.id, { body: 'Callback booked for Tuesday 10:00.' }, f.callback_note),
      () => write('contact.lastCallAttempt', contact.id, { value: '2026-10-12T01:30:00.000Z' }, f.touch),
      () => write('note.create', contact.id, { body: outcomeNote('follow_up') }, f.note),
    ];
    for (let i = 0; i < fseq.length; i++) {
      await status(); await status();
      const r = await fseq[i]();
      assert.equal(r.statusCode, 200, r.body); assert.equal(body(r).reservation, i === fseq.length - 1 ? 'released' : 'next_step', r.body);
    }
    assert.equal((await settledStatus()).state, 'clear', 'Follow-Up released');
    assert.equal(refusalLogs().length + pendingLogs().length, 0, JSON.stringify(warnings));
    const next = rid('blur'); let rb; for (let i = 0; i < 3; i++) { rb = await beginBlur(next); if (rb.statusCode === 200) break; }
    assert.equal(rb.statusCode, 200, rb.body); assert.equal(body(await offer(420000, next)).reservation, 'released');
  });
  await check('CONFLICT across two DISTINCT deals: a request id reserved on deal A, reused by a Pass on deal B, is rejected; deal B is never claimed and cannot send; deal A still saves; deal B then reserves and saves normally', async () => {
    fresh();
    const shared = rid('shared'); assert.equal((await beginBlur(shared)).statusCode, 200);
    const pNote = rid('b-note');
    const res = await beginOn(opportunityB.id, 'pass', [{ step: 'note', requestId: pNote }, { step: 'touch', requestId: shared }]);
    assert.equal(res.statusCode, 409, res.body); assert.equal(body(res).code, 'reservation_mismatch');
    assert.ok(headOf(opportunityB.id) === null || headOf(opportunityB.id).current === null, 'deal B never names the rejected reservation');
    assert.equal((await statusOn(opportunityB.id)).state, 'clear');
    assert.equal(body(await write('note.create', contactB.id, { body: outcomeNote('pass', opportunityB.id) }, pNote)).outcome, 'not_sent');
    assert.equal(body(await write('contact.lastCallAttempt', contactB.id, { value: '2026-10-12T01:40:00.000Z' }, shared)).outcome, 'not_sent', "deal A's id cannot write to deal B");
    assert.equal(ghlWrites.length, 0, 'nothing sent to either deal');
    assert.equal(body(await offer(400000, shared)).reservation, 'released', 'deal A still saves');
    const b = rid('b-blur'); assert.equal((await beginOn(opportunityB.id, 'blur', [{ step: 'offer', requestId: b }])).statusCode, 200);
    const sb = await write('opportunity.currentOffer', opportunityB.id, { value: 300000 }, b);
    assert.equal(sb.statusCode, 200, sb.body); assert.equal(body(sb).reservation, 'released');
    assert.equal(currentOfferInGhl(), 400000, 'deal A unchanged by deal B');
  });
  await check('CONFLICT cleanup can FAIL: when withdrawing the rejected reservation\'s own step fails, it is still rejected, never made current, and its step still cannot send', async () => {
    fresh();
    const shared = rid('shared'); assert.equal((await beginBlur(shared)).statusCode, 200);
    const pNote = rid('b-note');
    failWrite = (key) => key.startsWith('current-offer/decision/') || key.startsWith('current-offer/settled/');
    const res = await beginOn(opportunityB.id, 'pass', [{ step: 'note', requestId: pNote }, { step: 'touch', requestId: shared }]);
    failWrite = () => false;
    assert.equal(res.statusCode, 409, res.body); assert.equal(body(res).code, 'reservation_mismatch');
    const decisionB = 'current-offer/decision/' + sha(`test:${config.locationId}:${opportunityB.id}:${sha(pNote)}`);
    assert.equal(origin.has(decisionB), false, 'the cleanup did not happen');
    assert.ok(headOf(opportunityB.id) === null || headOf(opportunityB.id).current === null, 'never current');
    const sent = await write('note.create', contactB.id, { body: outcomeNote('pass', opportunityB.id) }, pNote);
    assert.equal(body(sent).outcome, 'not_sent', sent.body); assert.equal(notes.length, 0); assert.equal(ghlWrites.length, 0);
    assert.equal((await statusOn(opportunityB.id)).state, 'clear');
  });
  await check('TRANSITIONAL (not fixed): a head cached as MISSING before this change (a deal with no head, viewed under the old build) refuses the next reservation as contended -- 503, nothing reserved, nothing sent -- until the edge drops that miss', async () => {
    seedHead = false; fresh(); seedHead = true;
    const store = require('@netlify/blobs').getStore();
    assert.equal(await store.get(HEAD_KEY, { type: 'json' }), null);           // the old build's page-load read
    await store.setJSON(HEAD_KEY, { v: 2, current: null, at: '2026-10-12T00:00:00.000Z' }, { onlyIfNew: true });  // any later head write
    const id = rid('blur');
    const res = await beginBlur(id);
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(body(await offer(400000, id)).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
    assert.equal(parseLog(refusalLogs()[0]).path, 'contended');
  });

  // ── Protections unchanged ──────────────────────────────────────────────────
  await check('an UNRESERVED Current Offer is refused (409 not_sent, zero GHL) and logged', async () => {
    fresh();
    const id = rid('rogue');
    const res = await offer(400000, id);
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
    assert.equal(parseLog(refusalLogs()[0]).reservation, sha(id));
  });
  await check('a WITHDRAWN reservation is refused not_sent; zero GHL', async () => {
    fresh();
    const r = rid('blur'); await beginBlur(r);
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear');
    const res = await offer(400000, r);
    assert.equal(body(res).outcome, 'not_sent', res.body); assert.equal(offerPuts().length, 0);
  });
  await check('a COMPETING reservation (another session, while held) is refused as held; it never becomes current and cannot send; the holder still saves', async () => {
    fresh();
    const holder = rid('holder'); assert.equal((await beginBlur(holder)).statusCode, 200);
    const other = rid('other-session');
    assert.equal((await beginBlur(other)).statusCode, 409);
    assert.equal(body(await offer(390000, other)).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
    assert.equal((await offer(400000, holder)).statusCode, 200); assert.equal(currentOfferInGhl(), 400000);
  });
  await check('a DUPLICATE send of a confirmed save sends nothing more', async () => {
    fresh();
    const r = rid('blur'); await beginBlur(r);
    assert.equal((await offer(400000, r)).statusCode, 200);
    assert.notEqual((await offer(400000, r)).statusCode, 200); assert.equal(offerPuts().length, 1);
  });
  await check('a RETRIED begin (same reservation, response lost) is idempotent; an ALTERED repeat is rejected and registers nothing new', async () => {
    fresh();
    const r = rid('blur');
    assert.equal((await beginBlur(r)).statusCode, 200);
    assert.equal((await beginBlur(r)).statusCode, 200, 'the exact repeat');
    const before = [...origin.keys()].filter((k) => k.startsWith('current-offer/request/')).sort();
    const altered = await begin('accept', [{ step: 'offer', requestId: r }, { step: 'note', requestId: rid('a-note') }, { step: 'touch', requestId: rid('a-touch') }]);
    assert.equal(altered.statusCode, 409); assert.equal(body(altered).code, 'reservation_mismatch');
    assert.deepEqual([...origin.keys()].filter((k) => k.startsWith('current-offer/request/')).sort(), before);
    assert.equal((await offer(400000, r)).statusCode, 200);
  });
  await check("a request id already reserved elsewhere is rejected; the deal is not claimed; the conflicting reservation's own step is withdrawn and cannot send", async () => {
    fresh();
    const shared = rid('shared'); await beginBlur(shared);
    const pNote = rid('p-note');
    const res = await begin('pass', [{ step: 'note', requestId: pNote }, { step: 'touch', requestId: shared }]);
    assert.equal(res.statusCode, 409); assert.equal(body(res).code, 'reservation_mismatch');
    assert.equal(body(await write('note.create', contact.id, { body: outcomeNote('pass') }, pNote)).outcome, 'not_sent');
    assert.equal(notes.length, 0);
    assert.equal((await offer(400000, shared)).statusCode, 200, 'the original still saves');
  });
  await check('an UNRESERVED outcome note is refused; a save without a write session is refused before any store read', async () => {
    fresh();
    assert.equal(body(await write('note.create', contact.id, { body: outcomeNote('pass') }, rid('rogue-pass'))).outcome, 'not_sent');
    assert.equal(notes.length, 0);
    const r = rid('blur'); await beginBlur(r);
    session = 'not-a-session';
    const before = eventualReads;
    assert.equal((await offer(400000, r)).statusCode, 401); assert.equal(eventualReads, before);
  });
  await check('refusal and release-pending logs carry no request id, session token, contact id, deal id or value', async () => {
    const all = refusalLogsEver.join('\n');
    assert.ok(refusalLogsEver.length >= 4, String(refusalLogsEver.length));
    assert.ok(!/-fixture/.test(all), 'no raw request id');
    assert.ok(!all.includes(contact.id) && !all.includes(opportunity.id), 'no contact or deal id');
    assert.ok(!/Bearer|authorization|400000|390000/.test(all), 'no token or value');
    for (const line of refusalLogsEver) assert.deepEqual(Object.keys(parseLog(line)).sort(), line.includes('begin refused') ? ['elapsedMs', 'path', 'readMode', 'reads', 'reservation'] : ['elapsedMs', 'operation', 'path', 'readMode', 'reads', 'reservation']);
    assert.ok(refusalLogsEver.some((l) => l.includes('saved, release pending')), 'the release-pending line is covered');
  });

  console.log(`\nCurrent Offer handoff under persistent cached misses: checks=${count + failures} failures=${failures}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
