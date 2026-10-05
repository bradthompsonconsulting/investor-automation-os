/**
 * Board 15 / PR #126 stacked server PR -- the durable Current Offer barrier,
 * driven through the REAL handlers: netlify/functions/ghl-write.ts and
 * netlify/functions/current-offer-barrier.ts.
 *
 * Offline. @netlify/blobs is replaced by an in-memory store with the SDK's
 * onlyIfNew semantics and injectable failures; every GHL call goes to a fake
 * that can be held or made to fail AFTER applying the write (a lost response).
 * Covered (Jess ruling 2026-10-05, items 1-6):
 *   - begin before any send; a Current Offer write without a reservation is
 *     refused before sending; a second session's begin is refused; a retried
 *     begin with the same request id is idempotent;
 *   - the send is claimed atomically at the write boundary: a withdrawn
 *     request -- a late/delayed handler -- sends nothing; a duplicate request
 *     sends nothing; pre-send failures (GHL read, frozen gate, lock held)
 *     answer outcome "not_sent" and release the barrier only with evidence;
 *   - a lost response after the GHL call stays blocked: reconcile, a later
 *     begin and a fresh GHL read showing the amount never clear it;
 *   - Confirm Accept owns the barrier through offer, note and last-touch;
 *     uncertain steps are tracked; a stopped sequence clears only by
 *     withdrawing never-sent steps;
 *   - storage failures (claim, outcome, begin, status) never send and never
 *     clear;
 *   - lock contention: reconcile changes nothing while a write holds the lock;
 *   - records are scoped to environment + location + opportunity and use
 *     their own prefix (never the Under Contract marker);
 *   - status needs a read session; begin/reconcile need the write session;
 *   - every other ghl-write operation is unchanged.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const receipts = new Map();
const etags = new Map();
let etagSeq = 0;
let failNext = [];            // predicates over { op, key } -> throw once
/* Stale-read injection: the next read of a matching key returns an OLD
   snapshot (value + etag), as an eventually consistent read can. */
let staleNext = [];           // { match(key), snapshot: { data, etag } }
const snapshotOf = (key) => ({ data: receipts.has(key) ? structuredClone(receipts.get(key)) : null, etag: etags.get(key) ?? null });
const realBlobs = require('@netlify/blobs');
delete process.env.NETLIFY_BLOBS_CONTEXT;
const lambdaHeaders = { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' };
const lambdaBlobs = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
const maybeFail = (op, key) => {
  const i = failNext.findIndex((f) => f(op, key));
  if (i >= 0) { failNext.splice(i, 1); throw new Error(`fixture: blob ${op} failed`); }
};
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
  if (name === '@netlify/blobs') return {
    connectLambda: (event) => realBlobs.connectLambda(event),
    getStore: () => ({
      async get(key) {
        maybeFail('get', key);
        const i = staleNext.findIndex((x) => x.match(key));
        if (i >= 0) { const [st] = staleNext.splice(i, 1); return st.snapshot.data === null ? null : structuredClone(st.snapshot.data); }
        return receipts.has(key) ? structuredClone(receipts.get(key)) : null;
      },
      async getWithMetadata(key) {
        maybeFail('getWithMetadata', key);
        const i = staleNext.findIndex((x) => x.match(key));
        if (i >= 0) { const [st] = staleNext.splice(i, 1); return st.snapshot.data === null ? null : { data: structuredClone(st.snapshot.data), etag: st.snapshot.etag }; }
        return receipts.has(key) ? { data: structuredClone(receipts.get(key)), etag: etags.get(key) } : null;
      },
      async setJSON(key, value, options) {
        maybeFail('setJSON', key);
        if (options?.onlyIfNew && receipts.has(key)) return { modified: false };
        if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
        receipts.set(key, structuredClone(value));
        const etag = 'etag-' + (++etagSeq); etags.set(key, etag);
        return { modified: true, etag };
      },
      async delete(key) { maybeFail('delete', key); receipts.delete(key); etags.delete(key); },
    }),
  };
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

// ── Fake GHL: one contact, one opportunity ───────────────────────────────────
const contact = { id: 'fixture-contact', locationId: config.locationId, customFields: [], tags: [], phone: '+15555550101' };
const opportunity = { id: 'fixture-opportunity', contactId: contact.id, locationId: config.locationId, customFields: [] };
let notes = [];
let ghlWrites = [];                 // { method, pathname, body }
let holds = [];                     // { match, release, hit }
let loseNext = [];                  // predicates: apply the write, then throw (lost response)
const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
function hold(match) {
  let release; let hit;
  const h = { match, released: new Promise((r) => { release = r; }), hitP: new Promise((r) => { hit = r; }) };
  h.release = release; h.hit = hit; holds.push(h); return h;
}
global.fetch = async (url, init = {}) => {
  const parsed = new URL(url); const pathname = parsed.pathname; const method = init.method || 'GET';
  assert.equal(parsed.origin, 'https://services.leadconnectorhq.com', 'no external network');
  const req = { method, pathname, body: init.body ? JSON.parse(init.body) : null };
  const h = holds.find((x) => !x.used && x.match(req));
  if (h) { h.used = true; h.hit(req); await h.released; }
  if (h && h.failBefore) throw new Error('fixture: GHL unreachable');
  const lose = loseNext.findIndex((f) => f(req));
  if (pathname === `/contacts/${contact.id}/notes`) {
    if (method === 'POST') {
      ghlWrites.push(req);
      const note = { id: `note-${notes.length}`, body: req.body.body }; notes.push(note);
      if (lose >= 0) { loseNext.splice(lose, 1); throw new Error('fixture: response lost'); }
      return reply({ note });
    }
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
    if (lose >= 0) { loseNext.splice(lose, 1); throw new Error('fixture: response lost'); }
  }
  return reply(object === contact ? { contact } : { opportunity });
};

const ghlWrite = require('../netlify/functions/ghl-write.ts').handler;
const barrierFn = require('../netlify/functions/current-offer-barrier.ts').handler;
const writeHeaders = () => ({ ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` });
let seq = 0;
const rid = (label) => `${label}-${String(++seq).padStart(4, '0')}-fixture`;
const write = (operation, targetId, args, requestId) => ghlWrite({ blobs: lambdaBlobs, httpMethod: 'POST', headers: writeHeaders(), body: JSON.stringify({ operation, targetId, requestId, args }) });
const offer = (value, requestId) => write('opportunity.currentOffer', opportunity.id, { value }, requestId);
const barrier = (body) => barrierFn({ blobs: lambdaBlobs, httpMethod: 'POST', headers: writeHeaders(), body: JSON.stringify(body) });
const begin = (purpose, steps) => barrier({ action: 'begin', opportunityId: opportunity.id, purpose, steps });
const beginBlur = (r) => begin('blur', [{ step: 'offer', requestId: r }]);
const reconcile = () => barrier({ action: 'reconcile', opportunityId: opportunity.id });
const readCookie = () => `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;
const status = async (signedIn = true) => {
  const res = await barrierFn({ blobs: lambdaBlobs, httpMethod: 'GET', headers: { ...lambdaHeaders, ...(signedIn ? { cookie: readCookie() } : {}) }, queryStringParameters: { opportunityId: opportunity.id } });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};
const body = (res) => JSON.parse(res.body);
const offerPuts = () => ghlWrites.filter((w) => w.method === 'PUT' && w.pathname === `/opportunities/${opportunity.id}`);
const currentOfferInGhl = () => (opportunity.customFields.find((f) => f.id === OFFER_FIELD) || {}).fieldValue ?? null;

let count = 0;
let failures = 0;
async function check(name, fn) {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); }
}
function fresh() {
  receipts.clear(); etags.clear(); failNext = []; staleNext = []; holds = []; loseNext = []; ghlWrites = []; notes = [];
  opportunity.customFields = []; contact.customFields = [];
}

(async () => {
  // ── 1. begin before any send; no reservation, no send ──────────────────────
  await check('a Current Offer write with no reservation is refused before sending (outcome not_sent, zero GHL writes)', async () => {
    fresh();
    const res = await offer(250000, rid('noreserve'));
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
  });
  await check('begin -> owned write -> GHL confirmed -> the barrier clears itself (status clear, next begin allowed)', async () => {
    fresh();
    const r = rid('blur');
    assert.equal((await beginBlur(r)).statusCode, 200);
    assert.equal((await status()).body.state, 'blocked');
    const res = await offer(250000, r);
    assert.equal(res.statusCode, 200); assert.equal(body(res).confirmed, true); assert.equal(currentOfferInGhl(), 250000);
    assert.equal((await status()).body.state, 'clear');
    assert.equal((await beginBlur(rid('next'))).statusCode, 200);
  });
  await check('a second session cannot begin while the deal has a barrier; a retried begin with the same request id is idempotent', async () => {
    fresh();
    const r = rid('first');
    assert.equal((await beginBlur(r)).statusCode, 200);
    assert.equal((await beginBlur(r)).statusCode, 200, 'same request id: idempotent');
    const other = await beginBlur(rid('other-browser'));
    assert.equal(other.statusCode, 409); assert.equal(body(other).state, 'blocked');
  });
  await check('a request id reserved for one step cannot be used for another operation or target (not_sent)', async () => {
    fresh();
    const r = rid('blur');
    await beginBlur(r);
    const res = await write('note.create', contact.id, { body: 'not the offer' }, r);
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(ghlWrites.length, 0);
  });

  // ── 4. withdrawal is atomic with dispatch ownership ────────────────────────
  await check('a delayed handler that arrives after reconcile withdrew it sends NOTHING', async () => {
    fresh();
    const r = rid('late');
    await beginBlur(r);
    const rec = await reconcile();                       // the request never arrived: withdrawn
    assert.equal(body(rec).state, 'clear');
    const late = await offer(410000, r);                 // now it arrives
    assert.equal(late.statusCode, 409); assert.equal(body(late).outcome, 'not_sent');
    assert.equal(offerPuts().length, 0); assert.equal(currentOfferInGhl(), null);
  });
  await check('a late handler for a withdrawn request cannot send even after a NEW barrier exists for the deal', async () => {
    fresh();
    const r1 = rid('old'); const r2 = rid('new');
    await beginBlur(r1); await reconcile();
    assert.equal((await beginBlur(r2)).statusCode, 200);
    const late = await offer(410000, r1);
    assert.equal(body(late).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
    const ok = await offer(420000, r2);
    assert.equal(ok.statusCode, 200); assert.equal(currentOfferInGhl(), 420000); assert.equal(offerPuts().length, 1);
  });
  await check('the send is claimed AT the write boundary: a withdrawal landing between the reservation check and the GHL call wins, and nothing is sent', async () => {
    fresh();
    const r = rid('race');
    await beginBlur(r);
    // Hold the boundary's pre-dispatch GHL read (the read just before the claim and the PUT).
    let reads = 0;
    const h = hold((req) => req.method === 'GET' && req.pathname === `/opportunities/${opportunity.id}` && ++reads === 3);
    const pending = offer(410000, r);
    await h.hitP;
    // Withdraw directly through the module while the handler waits (the handler holds the
    // contact lock, so reconcile itself would answer in_progress -- the claim is what matters).
    const store = { get: async (k) => receipts.get(k) ?? null, setJSON: async (k, v, o) => { if (o?.onlyIfNew && receipts.has(k)) return { modified: false }; receipts.set(k, v); return { modified: true }; }, delete: async (k) => { receipts.delete(k); } };
    const scope = barrierLib.barrierScope('test', config.locationId);
    const decisionKeys = () => [...receipts.keys()].filter((k) => k.startsWith('current-offer/decision/'));
    assert.equal(decisionKeys().length, 0, 'no decision before the boundary');
    // Simulate reconcile's withdrawal of exactly this request:
    const crypto = require('node:crypto');
    const dg = (s) => crypto.createHash('sha256').update(s).digest('hex');
    const key = 'current-offer/decision/' + dg(`${scope}:${opportunity.id}:${dg(r)}`);
    assert.equal((await store.setJSON(key, { d: 'withdrawn' }, { onlyIfNew: true })).modified, true);
    h.release();
    const res = await pending;
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
  });
  await check('reconcile while a write holds the contact lock changes nothing (in_progress)', async () => {
    fresh();
    const r = rid('locked');
    await beginBlur(r);
    const h = hold((req) => req.method === 'PUT');
    const pending = offer(410000, r);
    await h.hitP;
    const rec = await reconcile();
    assert.equal(rec.statusCode, 409); assert.equal(body(rec).state, 'in_progress');
    h.release();
    assert.equal((await pending).statusCode, 200);
    assert.equal((await status()).body.state, 'clear');
  });
  await check('a duplicate of a confirmed request sends nothing', async () => {
    fresh();
    const r = rid('dup');
    await beginBlur(r); await offer(250000, r);
    const again = await offer(250000, r);
    assert.equal(again.statusCode, 409); assert.equal(body(again).outcome, 'not_sent'); assert.equal(offerPuts().length, 1);
  });

  // ── pre-send refusals: not_sent, and the barrier clears only with evidence ─
  await check('a GHL read failure before the call is not_sent and the request is withdrawn; reconcile then clears', async () => {
    fresh();
    const r = rid('preread');
    await beginBlur(r);
    let reads = 0;
    const h = hold((req) => req.method === 'GET' && req.pathname === `/opportunities/${opportunity.id}` && ++reads === 3); h.failBefore = true;
    h.release();
    const res = await offer(410000, r);
    assert.equal(body(res).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
    assert.equal((await status()).body.state, 'clear', 'withdrawn by its own handler and released under the lock');
  });
  await check('the frozen-offer gate refuses an owned request with not_sent (keeps its message) and releases the barrier', async () => {
    fresh();
    const { formatOutcomeNote } = require('../src/lib/seller-call-outcome.ts');
    const snapshot = { sellerPosition: 210000, currentOffer: 200000, targetAcquisitionPrice: 195000, maxSupportedOffer: 205000, expectedSpread: 10000, arv: 300000, repairs: 20000, readinessStatus: 'OFFER_READY' };
    notes = [{ id: 'accepted', body: formatOutcomeNote({ opportunityId: opportunity.id, kind: 'accept', at: '2026-10-05T12:00:00.000Z', operator: null, snapshot, reason: null, followUpAt: null }) }];
    const r = rid('frozen');
    await beginBlur(r);
    const res = await offer(250000, r);
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(body(res).error, 'Current Offer is frozen or invalid');
    assert.equal(offerPuts().length, 0);
    assert.equal((await status()).body.state, 'clear', 'its own handler withdrew it and released the barrier');
  });
  await check('another write holding the lock: the owned request is not_sent and the barrier stays for reconcile', async () => {
    fresh();
    const r1 = rid('holder'); const r2 = rid('blocked');
    await beginBlur(r1);
    const h = hold((req) => req.method === 'PUT');
    const pending = offer(410000, r1);
    await h.hitP;
    // r2 has no reservation: it is refused before the lock regardless.
    const res = await offer(420000, r2);
    assert.equal(body(res).outcome, 'not_sent');
    h.release(); await pending;
    assert.equal(offerPuts().length, 1);
  });

  // ── 3. a lost response stays blocked; nothing clears it ────────────────────
  await check('a lost response after the GHL call: indeterminate; reconcile, a new begin and a GHL read showing the amount do NOT clear it', async () => {
    fresh();
    const r = rid('lost');
    await beginBlur(r);
    loseNext.push((req) => req.method === 'PUT');
    const res = await offer(410000, r);
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'indeterminate');
    assert.equal(currentOfferInGhl(), 410000, 'GHL applied it');
    const rec = await reconcile();
    assert.equal(body(rec).state, 'blocked');
    assert.deepEqual(body(rec).steps.map((s) => s.evidence), ['unresolved']);
    assert.match(body(rec).message, /may still reach GHL/);
    assert.doesNotMatch(body(rec).message, /[Rr]eload/);
    assert.equal((await beginBlur(rid('after'))).statusCode, 409);
    assert.equal((await status()).body.state, 'blocked');
  });
  await check('a GHL call that fails part-way (dispatched) is never treated as not sent', async () => {
    fresh();
    const r = rid('partway');
    await beginBlur(r);
    const h = hold((req) => req.method === 'PUT'); h.failBefore = true; h.release();
    const res = await offer(410000, r);
    assert.equal(body(res).outcome, 'indeterminate');
    assert.equal(body(await reconcile()).state, 'blocked');
  });
  await check('a 2xx with a readback that does not verify is uncertain and stays blocked', async () => {
    fresh();
    const r = rid('mismatch');
    await beginBlur(r);
    const h = hold((req) => req.method === 'PUT'); h.release();
    const original = global.fetch;
    global.fetch = async (url, init = {}) => {
      const out = await original(url, init);
      if ((init.method || 'GET') === 'PUT') opportunity.customFields = [{ id: OFFER_FIELD, fieldValue: 999 }];
      return out;
    };
    try {
      const res = await offer(410000, r);
      assert.equal(body(res).confirmed, false);
    } finally { global.fetch = original; }
    assert.equal(body(await reconcile()).state, 'blocked');
  });

  // ── 5. Confirm Accept owns the barrier through offer, note and last-touch ──
  const acceptSteps = () => { const ids = { offer: rid('acc-offer'), note: rid('acc-note'), touch: rid('acc-touch') }; return { ids, steps: [{ step: 'offer', requestId: ids.offer }, { step: 'note', requestId: ids.note }, { step: 'touch', requestId: ids.touch }] }; };
  await check('Accept: the barrier holds after the offer and the note, and clears only after last-touch is confirmed', async () => {
    fresh();
    const { ids, steps } = acceptSteps();
    assert.equal((await begin('accept', steps)).statusCode, 200);
    assert.equal((await offer(400000, ids.offer)).statusCode, 200);
    assert.equal((await status()).body.state, 'blocked');
    assert.equal((await beginBlur(rid('blur-during-accept'))).statusCode, 409, 'no blur save during Accept, from any session');
    assert.equal((await write('note.create', contact.id, { body: 'Seller accepted (fixture note)' }, ids.note)).statusCode, 200);
    assert.equal((await status()).body.state, 'blocked');
    assert.equal((await write('contact.lastCallAttempt', contact.id, { value: '2026-10-05T12:00:00.000Z' }, ids.touch)).statusCode, 200);
    assert.equal((await status()).body.state, 'clear');
  });
  await check('Accept: an uncertain acceptance note is tracked; reconcile withdraws the never-sent last-touch and stays blocked naming the note', async () => {
    fresh();
    const { ids, steps } = acceptSteps();
    await begin('accept', steps);
    await offer(400000, ids.offer);
    loseNext.push((req) => req.method === 'POST' && req.pathname.endsWith('/notes'));
    const n = await write('note.create', contact.id, { body: 'Seller accepted (fixture note)' }, ids.note);
    assert.equal(body(n).outcome, 'indeterminate');
    const rec = body(await reconcile());
    assert.equal(rec.state, 'blocked');
    assert.deepEqual(rec.steps.map((s) => `${s.step}:${s.evidence}`), ['offer:confirmed', 'note:unresolved', 'touch:withdrawn']);
    assert.match(rec.message, /acceptance note/);
    const touch = await write('contact.lastCallAttempt', contact.id, { value: '2026-10-05T12:00:00.000Z' }, ids.touch);
    assert.equal(body(touch).outcome, 'not_sent', 'the withdrawn last-touch can never be sent');
  });
  await check('Accept stopped after a refused offer: reconcile withdraws the note and last-touch and clears', async () => {
    fresh();
    const { ids, steps } = acceptSteps();
    await begin('accept', steps);
    const h = hold((req) => req.method === 'GET' && req.pathname === `/opportunities/${opportunity.id}`); h.failBefore = true; h.release();
    assert.equal(body(await offer(400000, ids.offer)).outcome, 'not_sent');
    const rec = body(await reconcile());
    assert.equal(rec.state, 'clear');
    assert.equal(ghlWrites.length, 0);
  });
  await check('Accept: an uncertain last-touch after the acceptance is recorded keeps the barrier and says which step', async () => {
    fresh();
    const { ids, steps } = acceptSteps();
    await begin('accept', steps);
    await offer(400000, ids.offer);
    await write('note.create', contact.id, { body: 'Seller accepted (fixture note)' }, ids.note);
    loseNext.push((req) => req.method === 'PUT' && req.pathname === `/contacts/${contact.id}`);
    assert.equal(body(await write('contact.lastCallAttempt', contact.id, { value: '2026-10-05T12:00:00.000Z' }, ids.touch)).outcome, 'indeterminate');
    const rec = body(await reconcile());
    assert.equal(rec.state, 'blocked'); assert.match(rec.message, /last-touch time/);
  });

  // ── 6. storage failures never send and never clear ─────────────────────────
  await check('storage failure while claiming the send: nothing is sent; the barrier stays until reconcile proves it', async () => {
    fresh();
    const r = rid('claimfail');
    await beginBlur(r);
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('current-offer/decision/'));
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('current-offer/decision/'));   // the handler's own withdraw also fails
    const res = await offer(410000, r);
    assert.equal(body(res).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
    assert.equal((await status()).body.state, 'blocked');
    assert.equal(body(await reconcile()).state, 'clear', 'no decision was stored: reconcile withdraws it');
    assert.equal(body(await offer(410000, r)).outcome, 'not_sent', 'and it can never be sent afterwards');
  });
  await check('storage failure recording a confirmed outcome: the barrier stays (no evidence), never assumed clear', async () => {
    fresh();
    const r = rid('outcomefail');
    await beginBlur(r);
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('current-offer/outcome/'));
    const res = await offer(410000, r);
    assert.equal(res.statusCode, 200);
    assert.equal(body(await reconcile()).state, 'blocked');
  });
  await check('storage failure during begin: 503, nothing sent; the head is written last, so no partial reservation becomes current', async () => {
    fresh();
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('current-offer/request/'));
    const r = rid('beginfail');
    const res = await beginBlur(r);
    assert.equal(res.statusCode, 503); assert.equal(ghlWrites.length, 0);
    assert.equal((await status()).body.state, 'clear');
    assert.equal(body(await offer(410000, r)).outcome, 'not_sent', 'a write naming the failed reservation is refused');
    assert.equal(offerPuts().length, 0);
  });
  await check('storage failure writing the head during begin: 503, nothing sent, nothing current', async () => {
    fresh();
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('current-offer/head/'));
    const r = rid('headfail');
    assert.equal((await beginBlur(r)).statusCode, 503);
    assert.equal(body(await offer(410000, r)).outcome, 'not_sent');
    assert.equal(offerPuts().length, 0);
  });
  await check('storage failure reading status: 503 (the browser treats it as blocked)', async () => {
    fresh();
    failNext.push((op, key) => op === 'getWithMetadata' && key.startsWith('current-offer/head/'));
    assert.equal((await status()).statusCode, 503);
  });
  await check('storage failure reading the reservation in ghl-write: not_sent, nothing sent', async () => {
    fresh();
    const r = rid('readfail');
    await beginBlur(r);
    failNext.push((op, key) => op === 'get' && key.startsWith('current-offer/request/'));
    assert.equal(body(await offer(410000, r)).outcome, 'not_sent'); assert.equal(offerPuts().length, 0);
  });

  // ── Bones / Jess second review: stale evidence must never clear a newer barrier ──
  const headKeys = () => [...receipts.keys()].filter((k) => k.startsWith('current-offer/head/'));
  const headSnapshot = () => snapshotOf(headKeys()[0]);
  const storeApi = require('@netlify/blobs').getStore();
  const scopeT = barrierLib.barrierScope('test', config.locationId);
  await check('STALE FIRST BARRIER / NEWER UNRESOLVED BARRIER (reconcile): a stale head naming the settled first barrier cannot clear the newer unresolved one', async () => {
    fresh();
    const r1 = rid('first'); const r2 = rid('second');
    await beginBlur(r1);
    const staleHead = headSnapshot();                       // head names barrier 1, with its etag
    assert.equal((await offer(410000, r1)).statusCode, 200); // barrier 1 settles and releases
    assert.equal((await beginBlur(r2)).statusCode, 200);     // barrier 2 becomes current
    loseNext.push((req) => req.method === 'PUT');
    assert.equal(body(await offer(420000, r2)).outcome, 'indeterminate');   // barrier 2: sent, unresolved
    staleNext.push({ match: (k) => k.startsWith('current-offer/head/'), snapshot: staleHead });
    const rec = body(await reconcile());
    assert.equal(rec.state, 'blocked', 'the stale view of barrier 1 is settled, but its swap fails and the latest head is re-read');
    assert.deepEqual(rec.steps.map((x) => x.evidence), ['unresolved']);
    assert.equal((await status()).body.state, 'blocked');
    assert.equal((await beginBlur(rid('third'))).statusCode, 409, 'a new begin is still refused');
  });
  await check('STALE FIRST BARRIER / NEWER UNRESOLVED BARRIER (release): a late release for the first barrier, reading a stale head, cannot release the second', async () => {
    fresh();
    const r1 = rid('first'); const r2 = rid('second');
    await beginBlur(r1);
    const staleHead = headSnapshot();
    await offer(410000, r1);
    await beginBlur(r2);
    loseNext.push((req) => req.method === 'PUT');
    await offer(420000, r2);
    staleNext.push({ match: (k) => k.startsWith('current-offer/head/'), snapshot: staleHead });
    const crypto = require('node:crypto');
    const firstId = crypto.createHash('sha256').update(r1).digest('hex');
    await barrierLib.releaseIfSettled(storeApi, scopeT, opportunity.id, firstId);
    assert.equal((await status()).body.state, 'blocked', 'barrier 2 is still current');
  });
  await check('a stale head that reads as EMPTY cannot let a second barrier in, or report clear', async () => {
    fresh();
    const emptySnapshot = { data: null, etag: null };
    loseNext.push((req) => req.method === 'PUT');
    const r1 = rid('held');
    await beginBlur(r1); await offer(410000, r1);           // unresolved
    staleNext.push({ match: (k) => k.startsWith('current-offer/head/'), snapshot: emptySnapshot });
    assert.equal((await beginBlur(rid('intruder'))).statusCode, 409, 'begin: the conditional create fails, the re-read finds the held barrier');
    staleNext.push({ match: (k) => k.startsWith('current-offer/head/'), snapshot: emptySnapshot });
    assert.equal(body(await reconcile()).state, 'blocked', 'reconcile: "clear" needs a successful conditional write; it fails and re-reads');
  });
  await check('a persistently stale head is never reported clear: reconcile gives up with 503 and nothing changes', async () => {
    fresh();
    const r1 = rid('first'); const r2 = rid('second');
    await beginBlur(r1);
    const staleHead = headSnapshot();
    await offer(410000, r1);
    await beginBlur(r2);
    loseNext.push((req) => req.method === 'PUT');
    await offer(420000, r2);
    for (let i = 0; i < 8; i++) staleNext.push({ match: (k) => k.startsWith('current-offer/head/'), snapshot: staleHead });
    const res = await reconcile();
    assert.equal(res.statusCode, 503);
    staleNext = [];
    assert.equal((await status()).body.state, 'blocked');
  });
  await check('nothing in current-offer/ is ever deleted; only the head is rewritten, and only conditionally', async () => {
    fresh();
    const r1 = rid('nodelete');
    await beginBlur(r1); await offer(410000, r1);
    const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../netlify/functions/lib/current-offer-barrier.ts'), 'utf8');
    assert.ok(!/\.delete\(/.test(src), 'no delete call in the barrier module');
    assert.equal((src.match(/headKey\(scope, opp\), next/g) || []).length, 1, 'one head writer');
    assert.ok(/onlyIfMatch: etag/.test(src) && /onlyIfNew: true \} : \{ onlyIfMatch: etag \}/.test(src));
    assert.equal([...receipts.keys()].filter((k) => k.startsWith('current-offer/barrier/')).length, 1, 'the settled barrier record is kept');
  });

  // ── scope, separation, auth, unchanged operations ──────────────────────────
  await check('records are scoped to environment + location + opportunity, under their own prefix (never the Under Contract marker)', async () => {
    fresh();
    await beginBlur(rid('scope'));
    const keys = [...receipts.keys()];
    assert.ok(keys.length > 0 && keys.every((k) => k.startsWith('current-offer/') || k.startsWith('lock/')), keys.join());
    assert.ok(!keys.some((k) => k.startsWith('stage-unresolved/')));
    assert.notEqual(barrierLib.barrierScope('test', config.locationId), barrierLib.barrierScope('production', config.locationId));
    assert.notEqual(barrierLib.barrierScope('test', 'loc-a'), barrierLib.barrierScope('test', 'loc-b'));
  });
  await check('status needs a read session; begin and reconcile need the write session and origin', async () => {
    fresh();
    assert.equal((await status(false)).statusCode, 401);
    const noAuth = await barrierFn({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ action: 'reconcile', opportunityId: opportunity.id }) });
    assert.equal(noAuth.statusCode, 401);
    const badOrigin = await barrierFn({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...writeHeaders(), origin: 'https://evil.example.invalid' }, body: JSON.stringify({ action: 'reconcile', opportunityId: opportunity.id }) });
    assert.equal(badOrigin.statusCode, 403);
    assert.equal((await barrier({ action: 'clear', opportunityId: opportunity.id })).statusCode, 400, 'no other action -- no override');
    assert.equal((await begin('blur', [{ step: 'note', requestId: rid('wrongstep') }])).statusCode, 400);
  });
  await check('unchanged: a note and a last-touch with no reservation write exactly as before', async () => {
    fresh();
    assert.equal((await write('note.create', contact.id, { body: 'plain note' }, rid('plain-note'))).statusCode, 200);
    assert.equal((await write('contact.lastCallAttempt', contact.id, { value: '2026-10-05T12:00:00.000Z' }, rid('plain-touch'))).statusCode, 200);
    assert.equal([...receipts.keys()].filter((k) => k.startsWith('current-offer/')).length, 0);
  });
  await check('the module never clears a sent-and-unresolved step, whatever GHL shows', async () => {
    fresh();
    const r = rid('module');
    await beginBlur(r);
    loseNext.push((req) => req.method === 'PUT');
    await offer(410000, r);
    for (let i = 0; i < 3; i++) assert.equal(body(await reconcile()).state, 'blocked');
  });

  console.log(`\nCurrent Offer durable barrier: ${count}/${count + failures} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
