/**
 * B14-13 Production (2026-10-11) -- the Current Offer reserve-to-save handoff
 * under the read consistency the deployed functions actually get.
 *
 * Brad, Production, controlled test deal: after Check again and Enable saving,
 * Current Offer 400000 on Tab answered "Not saved -- No Current Offer
 * reservation for this save; nothing was sent". The reservation records
 * existed (read back); the save's ownership read did not see them.
 *
 * Cause: ghl-write and current-offer-barrier are Lambda-compatibility
 * functions (connectLambda). The SDK refuses a strong read there
 * (BlobsConsistencyError: no uncachedEdgeURL), so every read is eventual and
 * served by the edge cache with stale-while-revalidate. beginBarrier reads the
 * request key (missing) just before writing it, so the save's ownership read
 * that follows can be served the cached "missing".
 *
 * The existing offline suites never saw this: their fake store answers strong
 * reads. This suite's fake behaves like the deployed edge:
 *   - a strong read throws BlobsConsistencyError, as the SDK does;
 *   - an eventual read is cached per key; after the origin changes, the cached
 *     (stale) value -- including a cached "missing" -- is served for
 *     STALE_READS more reads before the edge revalidates;
 *   - writes go to the origin with the SDK's onlyIfNew / onlyIfMatch semantics.
 *
 * Drives the REAL ghl-write and current-offer-barrier handlers. Offline.
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
  const now = originSnap(key);
  const cached = edge.get(key);
  if (!cached) { edge.set(key, { snap: now, served: 0 }); return now; }
  if (cached.snap.etag === now.etag) return now;
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
        if (options?.onlyIfNew && origin.has(key)) return { modified: false };
        if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
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
let pauses = [];
barrierLib.setSettlePauseForTests(async (ms) => { pauses.push(ms); });

// ── Fake GHL: one contact, one opportunity ───────────────────────────────────
const contact = { id: 'fixture-contact', locationId: config.locationId, customFields: [], tags: [], phone: '+15555550101' };
const opportunity = { id: 'fixture-opportunity', contactId: contact.id, locationId: config.locationId, customFields: [] };
let notes = [];
let ghlWrites = [];
const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
global.fetch = async (url, init = {}) => {
  const parsed = new URL(url); const pathname = parsed.pathname; const method = init.method || 'GET';
  assert.equal(parsed.origin, 'https://services.leadconnectorhq.com', 'no external network');
  const req = { method, pathname, body: init.body ? JSON.parse(init.body) : null };
  if (pathname === `/contacts/${contact.id}/notes`) {
    if (method === 'POST') { ghlWrites.push(req); const note = { id: `note-${notes.length}`, body: req.body.body }; notes.push(note); return reply({ note }); }
    return reply({ notes });
  }
  const object = pathname === `/contacts/${contact.id}` ? contact : pathname === `/opportunities/${opportunity.id}` ? opportunity : null;
  if (!object) throw new Error('Unexpected mocked request: ' + pathname);
  if (method === 'PUT') {
    ghlWrites.push(req);
    for (const field of req.body.customFields) {
      object.customFields = object.customFields.filter((f) => f.id !== field.id);
      if (field.field_value !== '' && field.field_value !== null) object.customFields.push({ id: field.id, [object === contact ? 'value' : 'fieldValue']: field.field_value });
    }
  }
  return reply(object === contact ? { contact } : { opportunity });
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
const readCookie = () => `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;
const status = async () => JSON.parse((await barrierFn({ blobs: lambdaBlobs, httpMethod: 'GET', headers: { ...lambdaHeaders, cookie: readCookie() }, queryStringParameters: { opportunityId: opportunity.id } })).body);
const body = (res) => JSON.parse(res.body);
const offerPuts = () => ghlWrites.filter((w) => w.method === 'PUT' && w.pathname === `/opportunities/${opportunity.id}`);
const currentOfferInGhl = () => (opportunity.customFields.find((f) => f.id === OFFER_FIELD) || {}).fieldValue ?? null;
const receiptKeys = () => [...origin.keys()].filter((k) => /^[0-9a-f]{64}$/.test(k));
const outcomeNote = (kind) => require('../src/lib/seller-call-outcome.ts').formatOutcomeNote({ opportunityId: opportunity.id, kind, at: '2026-10-11T22:10:00.000Z', operator: null, reason: kind === 'pass' ? 'not selling' : null, followUpAt: null, snapshot: { sellerPosition: 500000, currentOffer: 400000, targetAcquisitionPrice: null, maxSupportedOffer: null, expectedSpread: null, arv: null, repairs: null, readinessStatus: 'OFFER_READY' } });

let count = 0;
let failures = 0;
async function check(name, fn) {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); }
}
function fresh() {
  origin.clear(); etags.clear(); edge.clear(); ghlWrites = []; notes = []; pauses = [];
  opportunity.customFields = []; contact.customFields = []; STALE_READS = 2; enableSaving();
}
// Status as the page polls it; an eventual read may lag, so poll a few times as the page does.
async function settledStatus() { let s; for (let i = 0; i < 4; i++) { s = await status(); if (s.state === 'clear') break; } return s; }

(async () => {
  await check('fixture models the deployed edge: a strong read throws BlobsConsistencyError; a key read as missing before its write is still served as missing', async () => {
    fresh();
    const store = require('@netlify/blobs').getStore();
    await assert.rejects(store.get('k', { type: 'json', consistency: 'strong' }), { name: 'BlobsConsistencyError' });
    assert.equal(await store.get('k', { type: 'json' }), null);
    await store.setJSON('k', { v: 1 }, { onlyIfNew: true });
    assert.equal(await store.get('k', { type: 'json' }), null, 'stale missing');
    assert.equal(await store.get('k', { type: 'json' }), null, 'stale missing');
    assert.deepEqual(await store.get('k', { type: 'json' }), { v: 1 }, 'revalidated');
  });

  // ── Brad's exact sequence ──────────────────────────────────────────────────
  await check("Brad's sequence: a never-sent reservation is held -> Check again clears it -> Enable saving -> Tab on 400000 saves (200, confirmed, one PUT, one receipt) and the barrier releases", async () => {
    fresh();
    const old = rid('old-blur');
    assert.equal((await beginBlur(old)).statusCode, 200);           // the 02:01 reservation, never sent
    // The page polls status (this warms the edge cache). Status is eventual too: it may lag before it shows the block.
    let held; for (let i = 0; i < 4 && held?.state !== 'blocked'; i++) held = await status();
    assert.equal(held.state, 'blocked');
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear', 'Check again clears the never-sent reservation');
    await status();                                                  // the page refreshes its status
    enableSaving();                                                  // a fresh write session
    const tab = rid('blur');
    const reserved = await beginBlur(tab);
    assert.equal(reserved.statusCode, 200, 'reserved: ' + reserved.body);
    const res = await offer(400000, tab);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(body(res).confirmed, true);
    assert.equal(offerPuts().length, 1); assert.equal(currentOfferInGhl(), 400000);
    assert.equal(receiptKeys().length, 1, 'exactly one write receipt');
    assert.equal((await settledStatus()).state, 'clear', 'the barrier released itself');
    assert.ok(strongAttempts > 0, 'strong reads were attempted and refused, as deployed');
  });
  await check('the same save straight after a page load (no Check again) also saves', async () => {
    fresh();
    await status();
    const tab = rid('blur');
    assert.equal((await beginBlur(tab)).statusCode, 200);
    const res = await offer(400000, tab);
    assert.equal(res.statusCode, 200, res.body); assert.equal(offerPuts().length, 1);
  });
  await check('a second Tab after a confirmed save reserves and saves again (the next value reaches GHL)', async () => {
    fresh();
    const a = rid('blur'); await beginBlur(a); assert.equal((await offer(400000, a)).statusCode, 200);
    await settledStatus();
    const b = rid('blur');
    let r; for (let i = 0; i < 3; i++) { r = await beginBlur(b); if (r.statusCode === 200) break; }
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await offer(410000, b)).statusCode, 200); assert.equal(currentOfferInGhl(), 410000); assert.equal(offerPuts().length, 2);
  });
  await check('a reserved Pass (outcome note + last-touch) records under eventual reads and releases', async () => {
    fresh();
    const ids = { note: rid('pass-note'), touch: rid('pass-touch') };
    assert.equal((await begin('pass', [{ step: 'note', requestId: ids.note }, { step: 'touch', requestId: ids.touch }])).statusCode, 200);
    const n = await write('note.create', contact.id, { body: outcomeNote('pass') }, ids.note);
    assert.equal(n.statusCode, 200, n.body);
    assert.equal((await write('contact.lastCallAttempt', contact.id, { value: '2026-10-11T22:10:00.000Z' }, ids.touch)).statusCode, 200);
    assert.equal(notes.filter((x) => /Outcome: pass/.test(x.body)).length, 1);
    assert.equal((await settledStatus()).state, 'clear');
  });
  await check('a reserved Follow-Up callback (reserved-only operation) is sent under eventual reads', async () => {
    fresh();
    const f = { callback: rid('fu-cb'), callback_note: rid('fu-cbnote'), touch: rid('fu-touch'), note: rid('fu-note') };
    assert.equal((await begin('follow_up', Object.entries(f).map(([step, requestId]) => ({ step, requestId })))).statusCode, 200);
    const res = await write('contact.callback', contact.id, { value: '2026-10-14T15:00:00.000Z' }, f.callback);
    assert.equal(res.statusCode, 200, res.body);
  });

  // ── Protections unchanged under eventual reads ─────────────────────────────
  await check('an UNRESERVED Current Offer is still refused (409 not_sent, zero GHL); the re-reads are bounded (150..1200 ms, 4.4 s in all)', async () => {
    fresh();
    const res = await offer(400000, rid('rogue'));
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent');
    assert.match(body(res).error, /No Current Offer reservation/);
    assert.equal(offerPuts().length, 0); assert.equal(receiptKeys().length, 0);
    assert.deepEqual(pauses, [150, 250, 400, 600, 800, 1000, 1200]);
  });
  await check('a WITHDRAWN reservation (Check again before the save) is refused not_sent; zero GHL', async () => {
    fresh();
    const r = rid('blur'); await beginBlur(r);
    let rec; for (let i = 0; i < 3 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear');
    const res = await offer(400000, r);
    assert.equal(body(res).outcome, 'not_sent', res.body); assert.equal(offerPuts().length, 0);
  });
  await check('a reservation that never became current (another barrier held the deal) is refused not_sent; zero GHL; the holder still saves', async () => {
    fresh();
    const holder = rid('holder'); assert.equal((await beginBlur(holder)).statusCode, 200);
    const loser = rid('loser');
    assert.equal((await beginBlur(loser)).statusCode, 409);
    const res = await offer(390000, loser);
    assert.equal(body(res).outcome, 'not_sent', res.body); assert.equal(offerPuts().length, 0);
    assert.equal((await offer(400000, holder)).statusCode, 200); assert.equal(currentOfferInGhl(), 400000);
  });
  await check('a GENUINELY held deal (a pending save) still refuses a new reservation: 409 held within the 5 s re-read budget, nothing registered as current', async () => {
    fresh();
    const holder = rid('holder'); await beginBlur(holder);
    await status(); await status();
    pauses = [];
    const res = await beginBlur(rid('second-tab'));
    assert.equal(res.statusCode, 409); assert.equal(body(res).state, 'blocked');
    assert.ok(pauses.reduce((a, b) => a + b, 0) <= 5000, JSON.stringify(pauses));
    assert.equal((await offer(400000, holder)).statusCode, 200, 'the holder is unaffected');
  });
  await check("Brad's sequence also saves when the edge serves stale values for longer (4 reads)", async () => {
    fresh(); STALE_READS = 4;
    const old = rid('old-blur'); await beginBlur(old);
    for (let i = 0; i < 3; i++) await status();
    let rec; for (let i = 0; i < 4 && rec?.state !== 'clear'; i++) rec = body(await checkAgain());
    assert.equal(rec.state, 'clear');
    enableSaving();
    const tab = rid('blur');
    const reserved = await beginBlur(tab);
    assert.equal(reserved.statusCode, 200, reserved.body);
    const res = await offer(400000, tab);
    assert.equal(res.statusCode, 200, res.body); assert.equal(offerPuts().length, 1); assert.equal(receiptKeys().length, 1);
  });
  await check('a DUPLICATE send of a confirmed save sends nothing more', async () => {
    fresh();
    const r = rid('blur'); await beginBlur(r);
    assert.equal((await offer(400000, r)).statusCode, 200);
    const again = await offer(400000, r);
    assert.notEqual(again.statusCode, 200); assert.equal(offerPuts().length, 1);
  });
  await check('an UNRESERVED outcome note is still refused (409 not_sent); no note reaches GHL', async () => {
    fresh();
    const res = await write('note.create', contact.id, { body: outcomeNote('pass') }, rid('rogue-pass'));
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(notes.length, 0);
  });
  await check('a save without a write session is refused before any store read', async () => {
    fresh();
    const r = rid('blur'); await beginBlur(r);
    session = 'not-a-session';
    const before = eventualReads;
    const res = await offer(400000, r);
    assert.equal(res.statusCode, 401); assert.equal(eventualReads, before); assert.equal(offerPuts().length, 0);
  });

  console.log(`\nCurrent Offer handoff under eventual reads: checks=${count + failures} failures=${failures}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
