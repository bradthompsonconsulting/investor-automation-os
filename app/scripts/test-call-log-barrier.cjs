/**
 * Board 15 / PR #131 -- durable call-log OPERATIONS (Bones-approved lifecycle
 * v3, #issuecomment-6023481488), driven through the REAL handlers:
 * netlify/functions/ghl-write.ts and netlify/functions/call-log-barrier.ts.
 *
 * Offline. @netlify/blobs is an in-memory store with the SDK's onlyIfNew /
 * onlyIfMatch semantics and injectable failures: a write that throws, a write
 * that APPLIES and then throws (an ambiguous acknowledgement), and a stale read.
 * Every GHL call goes to a fake (two contacts) that can be held, fail before
 * sending, or apply a write and lose the response. Each case checks GHL's own
 * state (result field, call notes, last touch) and the GHL write counts.
 *
 * Case ids are the approved acceptance matrix (section 12).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');

const receipts = new Map();
const etags = new Map();
let etagSeq = 0;
let failNext = [];       // (op, key) -> throw once, nothing written
let applyThenThrow = []; // (op, key) -> write applies, then the call throws (ambiguous acknowledgement)
let staleNext = [];      // (key) -> the next read of it returns null once
const realBlobs = require('@netlify/blobs');
delete process.env.NETLIFY_BLOBS_CONTEXT;
const lambdaHeaders = { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' };
const lambdaBlobs = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
const take = (list, ...args) => { const i = list.findIndex((f) => f(...args)); if (i < 0) return false; list.splice(i, 1); return true; };
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
const memStore = {
  async get(key) { if (take(failNext, 'get', key)) throw new Error('fixture: blob get failed'); if (take(staleNext, key)) return null; return receipts.has(key) ? structuredClone(receipts.get(key)) : null; },
  async getWithMetadata(key) { if (take(failNext, 'getWithMetadata', key)) throw new Error('fixture: blob read failed'); return receipts.has(key) ? { data: structuredClone(receipts.get(key)), etag: etags.get(key) } : null; },
  async setJSON(key, value, options) {
    if (take(failNext, 'setJSON', key)) throw new Error('fixture: blob setJSON failed');
    if (options?.onlyIfNew && receipts.has(key)) return { modified: false };
    if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
    receipts.set(key, structuredClone(value));
    const etag = 'etag-' + (++etagSeq); etags.set(key, etag);
    if (take(applyThenThrow, 'setJSON', key)) throw new Error('fixture: write applied, acknowledgement lost');
    return { modified: true, etag };
  },
  async delete(key) { receipts.delete(key); etags.delete(key); },
};
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return { connectLambda: (event) => realBlobs.connectLambda(event), getStore: () => memStore };
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
const { callLogNote } = require('../src/lib/call-outcome-copy.ts');
const lib = require('../netlify/functions/lib/call-log-barrier.ts');
const legacy = require('../netlify/functions/lib/call-log-legacy.ts');
const config = getConfig('test');
const F = config.fields;
const SCOPE = lib.callLogScope('test', config.locationId);
const dg = (s) => crypto.createHash('sha256').update(s).digest('hex');
const keyOf = { attempt: (op, slot, n) => `call-log/v3/attempt/${dg(`${SCOPE}:${op}:${slot}:${n}`)}`, binding: (rid) => `call-log/v3/binding/${dg(`${SCOPE}:${rid}`)}`,
  decision: (rid) => `call-log/v3/decision/${dg(`${SCOPE}:${rid}`)}`, outcome: (rid) => `call-log/v3/outcome/${dg(`${SCOPE}:${rid}`)}`, final: (op) => `call-log/v3/final/${dg(`${SCOPE}:${op}`)}`,
  head: (c) => `call-log/head/${dg(`${SCOPE}:${c}`)}` };

// ── Fake GHL: two contacts ───────────────────────────────────────────────────
const A = 'fixture-contact-a';
const B = 'fixture-contact-b';
let ghl; let ghlWrites = []; let holds = []; let loseNext = [];
const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
function hold(match, opts = {}) {
  let release; let hit;
  const h = { match, ...opts, released: new Promise((r) => { release = r; }), hitP: new Promise((r) => { hit = r; }) };
  h.release = release; h.hit = hit; holds.push(h); return h;
}
global.fetch = async (url, init = {}) => {
  const parsed = new URL(url); const pathname = parsed.pathname; const method = init.method || 'GET';
  assert.equal(parsed.origin, 'https://services.leadconnectorhq.com', 'no external network');
  const req = { method, pathname, body: init.body ? JSON.parse(init.body) : null };
  const h = holds.find((x) => !x.used && x.match(req));
  if (h) { h.used = true; h.hit(req); await h.released; }
  if (h && h.failBefore) throw new Error('fixture: GHL unreachable');
  const m = pathname.match(/^\/contacts\/([^/]+)(\/notes)?$/);
  if (!m || !ghl[m[1]]) throw new Error('Unexpected mocked request: ' + method + ' ' + pathname);
  const c = ghl[m[1]];
  const lose = loseNext.findIndex((f) => f(req));
  if (m[2]) {
    if (method === 'POST') {
      ghlWrites.push({ ...req, contact: c.id, kind: 'note' });
      const note = { id: `${c.id}-note-${c.notes.length}`, body: req.body.body }; c.notes.push(note);
      if (lose >= 0) { loseNext.splice(lose, 1); throw new Error('fixture: response lost'); }
      return reply({ note });
    }
    return reply({ notes: c.notes });
  }
  if (method === 'PUT') {
    ghlWrites.push({ ...req, contact: c.id, kind: 'fields' });
    for (const field of req.body.customFields) {
      c.customFields = c.customFields.filter((f) => f.id !== field.id);
      if (field.field_value !== '' && field.field_value !== null) c.customFields.push({ id: field.id, value: field.field_value });
    }
    if (lose >= 0) { loseNext.splice(lose, 1); throw new Error('fixture: response lost'); }
  }
  return reply({ contact: { id: c.id, locationId: config.locationId, customFields: c.customFields, tags: [], phone: '+15555550101' } });
};

const ghlWrite = require('../netlify/functions/ghl-write.ts').handler;
const callLogFn = require('../netlify/functions/call-log-barrier.ts').handler;
const writeHeaders = () => ({ ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` });
const write = (operation, targetId, args, requestId) => ghlWrite({ blobs: lambdaBlobs, httpMethod: 'POST', headers: writeHeaders(), body: JSON.stringify({ operation, targetId, requestId, args }) });
const post = async (b, headers = writeHeaders()) => { const r = await callLogFn({ blobs: lambdaBlobs, httpMethod: 'POST', headers, body: JSON.stringify(b) }); return { statusCode: r.statusCode, body: JSON.parse(r.body) }; };
const readCookie = () => `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;
const get = async (q, signedIn = true) => { const r = await callLogFn({ blobs: lambdaBlobs, httpMethod: 'GET', headers: { ...lambdaHeaders, ...(signedIn ? { cookie: readCookie() } : {}) }, queryStringParameters: q }); return { statusCode: r.statusCode, body: JSON.parse(r.body) }; };
const body = (res) => JSON.parse(res.body);
const rid = (op, slot, n) => `${op}-${slot}-${n}`;
const newOp = () => crypto.randomUUID();

/** One call: its operation id, result and exact note body, and every way to act on it. */
function call(contactId, result, notes = '') {
  const op = newOp();
  const noteBody = callLogNote(result, notes);
  return {
    op, contactId, result, noteBody,
    begin: (extra = {}) => post({ action: 'begin', contactId, operationId: op, result, body: noteBody, ...extra }),
    resume: () => post({ action: 'resume', contactId, operationId: op }),
    retry: (slot, after) => post({ action: 'retry', contactId, operationId: op, slot, after }),
    status: () => get({ contactId, operationId: op }),
    result: (n = 1) => write('contact.callLogResult', contactId, { value: result }, rid(op, 'result', n)),
    note: (n = 1, b = noteBody) => write('note.create', contactId, { body: b }, rid(op, 'note', n)),
    touch: (n = 1, at = '2026-10-06T15:00:00.000Z') => write('contact.lastCallAttempt', contactId, { value: at }, rid(op, 'touch', n)),
  };
}
const contactStatus = (c = A) => get({ contactId: c });
const stored = (c) => (ghl[c].customFields.find((f) => f.id === F.callDisposition) || {}).value ?? null;
const touchOf = (c) => (ghl[c].customFields.find((f) => f.id === F.lastCallAttemptPrecise) || {}).value ?? null;
const callNotes = (c) => ghl[c].notes.filter((n) => n.body.startsWith('Call (reported by Brad in IAOS):'));
const resultPuts = (c) => ghlWrites.filter((w) => w.contact === c && w.kind === 'fields' && w.body.customFields.some((f) => f.id === F.callDisposition));
const touchPuts = (c) => ghlWrites.filter((w) => w.contact === c && w.kind === 'fields' && w.body.customFields.some((f) => f.id === F.lastCallAttemptPrecise));
const counts = (c) => ({ results: resultPuts(c).length, notes: callNotes(c).length, touches: touchPuts(c).length });
const oneEach = (c) => JSON.stringify(counts(c)) === JSON.stringify({ results: 1, notes: 1, touches: 1 });
const keysNow = () => new Set(receipts.keys());
/** The note refused BEFORE sending, durably proved unsent: the write receipt claim fails inside the owned write. */
const refuseNextNote = () => failNext.push((op, key) => op === 'setJSON' && /^[0-9a-f]{64}$/.test(key));
/** Complete an open operation through its server-given next actions (as the page's Check again does). */
async function finish(t) {
  for (let i = 0; i < 6; i++) {
    const v = (await t.resume()).body;
    if (v.state !== 'open' || v.next.action !== 'send') return v;
    const n = Number(v.next.requestId.split('-').pop());
    const res = v.next.slot === 'note' ? await t.note(n, v.body) : await t.touch(n);
    assert.equal(res.statusCode, 200, res.body);
  }
  throw new Error('did not finish');
}

/* A wait that never resolves empties the event loop and Node exits 0 mid-suite: that must FAIL, never pass. */
let finished = false;
process.on('exit', (code) => { if (!finished && code === 0) { console.error('FAIL the suite ended before it finished (a wait never resolved)'); process.exitCode = 1; } });
let count = 0;
let failures = 0;
async function check(name, fn) {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e)); }
}
function fresh() {
  receipts.clear(); etags.clear(); failNext = []; applyThenThrow = []; staleNext = []; holds = []; loseNext = []; ghlWrites = [];
  ghl = { [A]: { id: A, customFields: [], notes: [] }, [B]: { id: B, customFields: [], notes: [] } };
}

(async () => {
  // ── Basics ──────────────────────────────────────────────────────────────────
  await check('L-1 / basics: an unbound call result or call-log note is refused before sending; a plain note and an unbound last touch are unchanged', async () => {
    fresh();
    assert.equal(body(await write('contact.callLogResult', A, { value: 'No Answer' }, 'unbound-result-0001')).outcome, 'not_sent');
    assert.equal(body(await write('note.create', A, { body: callLogNote('Voicemail', 'x') }, 'unbound-note-0001')).outcome, 'not_sent');
    assert.equal(ghlWrites.length, 0);
    assert.equal((await write('note.create', A, { body: 'Plain operator note' }, 'plain-note-0001')).statusCode, 200);
    assert.equal((await write('contact.lastCallAttempt', A, { value: '2026-10-06T14:00:00.000Z' }, 'plain-touch-0001')).statusCode, 200);
  });
  await check('happy path: begin publishes attempt 1 of each slot (attempt + binding); result -> note -> touch; final complete BEFORE the head is released; status clear', async () => {
    fresh();
    const t = call(A, 'Spoke with Seller', 'Wants 30 days.');
    assert.deepEqual((await t.begin()).body, { state: 'reserved', op: t.op });
    for (const slot of ['result', 'note', 'touch']) { assert.ok(receipts.has(keyOf.attempt(t.op, slot, 1))); assert.ok(receipts.has(keyOf.binding(rid(t.op, slot, 1)))); }
    assert.equal((await t.result()).statusCode, 200);
    assert.equal((await t.note()).statusCode, 200);
    assert.equal((await t.touch()).statusCode, 200);
    assert.ok(receipts.has(keyOf.final(t.op)));
    assert.equal((await contactStatus()).body.state, 'clear');
    const s = (await t.status()).body;
    assert.equal(s.state, 'finished'); assert.equal(s.outcome.kind, 'complete');
    assert.ok(oneEach(A)); assert.equal(stored(A), 'Spoke with Seller'); assert.equal(callNotes(A)[0].body, t.noteBody);
  });
  await check('ORDER and bindings: note or touch before its previous slot is confirmed sends nothing and writes no record; a mismatched value, body, contact or step is refused', async () => {
    fresh();
    const t = call(A, 'Voicemail');
    await t.begin();
    const before = keysNow();
    const early = body(await t.note());
    assert.equal(early.outcome, 'not_sent'); assert.equal(early.proves, 'nothing');
    assert.equal(body(await t.touch()).outcome, 'not_sent');
    assert.deepEqual([...keysNow()].filter((k) => !before.has(k) && !/^[0-9a-f]{64}$/.test(k)), [], 'no call-log record written');
    assert.equal(body(await write('contact.callLogResult', A, { value: 'No Answer' }, rid(t.op, 'result', 1))).outcome, 'not_sent');
    assert.equal(body(await write('contact.callLogResult', B, { value: 'Voicemail' }, rid(t.op, 'result', 1))).outcome, 'not_sent');
    assert.equal(body(await write('contact.lastCallAttempt', A, { value: '2026-10-06T15:00:00.000Z' }, rid(t.op, 'result', 1))).outcome, 'not_sent');
    assert.equal(ghlWrites.length, 0);
    await t.result();
    assert.equal(body(await t.note(1, callLogNote('Voicemail', 'other'))).outcome, 'not_sent');
    assert.equal((await t.note()).statusCode, 200, 'the same reserved note id still works in order');
  });

  // ── D1 / D2: Bones's exact order and Jeff's variant ────────────────────────
  for (const ordering of ['D1', 'D2']) {
    await check(`${ordering} ${ordering === 'D1' ? "Bones's exact order: both browsers see Retry notes; B2 retries and completes; B1's stale Retry creates nothing" : "Jeff's variant: B2's retry completes BEFORE B1's held refusal is seen; B1 sees the recorded outcome"} -- 1/1/1`, async () => {
      fresh();
      const t = call(A, 'Spoke with Seller', 'Roof is new.');
      await t.begin(); await t.result();
      refuseNextNote();
      const b1Refusal = body(await t.note());          // B1's note: refused before sending; its RESPONSE is held (not shown yet)
      assert.equal(b1Refusal.outcome, 'not_sent'); assert.equal(b1Refusal.proves, 'this_request');
      const b2Check = (await t.resume()).body;          // B2: Check again
      assert.deepEqual(b2Check.next, { action: 'retry', slot: 'note', after: 1 });
      if (ordering === 'D1') {
        const b1Sees = (await t.status()).body;         // B1's held response released: B1 reads ITS operation
        assert.deepEqual(b1Sees.next, { action: 'retry', slot: 'note', after: 1 }, 'both browsers show Retry notes');
      }
      const b2Retry = (await t.retry('note', 1)).body;  // B2: Retry notes
      assert.deepEqual(b2Retry.next, { action: 'send', slot: 'note', requestId: rid(t.op, 'note', 2) });
      assert.equal((await t.note(2, b2Retry.body)).statusCode, 200);
      const done = await finish(t);
      assert.equal(done.state, 'finished'); assert.equal(done.outcome.kind, 'complete');
      if (ordering === 'D2') {
        const b1Sees = (await t.status()).body;         // B1's held response seen only now
        assert.equal(b1Sees.state, 'finished'); assert.equal(b1Sees.outcome.kind, 'complete');
      }
      const before = keysNow();
      const stale = (await t.retry('note', 1)).body;    // B1: its stale Retry notes
      assert.equal(stale.state, 'finished'); assert.equal(stale.outcome.kind, 'complete');
      assert.deepEqual([...keysNow()].filter((k) => !before.has(k)), [], 'the stale retry created nothing');
      assert.ok(!receipts.has(keyOf.attempt(t.op, 'note', 3)));
      assert.ok(oneEach(A), JSON.stringify(counts(A)));
    });
  }
  await check('D3 a losing duplicate sender\'s not_sent proves nothing about the winner; no attempt is created from it; 1 note', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result();
    const h = hold((req) => req.method === 'POST' && req.pathname === `/contacts/${A}/notes`);
    const winner = t.note();
    await h.hitP;
    const loser = body(await t.note());                 // the same id, while the winner holds the lock
    assert.equal(loser.outcome, 'not_sent'); assert.equal(loser.proves, 'nothing');
    h.release(); assert.equal((await winner).statusCode, 200);
    const loser2 = body(await t.note());                // the same id after the winner confirmed
    assert.equal(loser2.proves, 'nothing');
    assert.equal((await t.retry('note', 1)).body.next.action, 'send', 'no retry was enabled by the losers; the touch is next');
    assert.ok(!receipts.has(keyOf.attempt(t.op, 'note', 2)));
    await finish(t); assert.ok(oneEach(A));
  });

  // ── Reuse, publication, permission ─────────────────────────────────────────
  await check('RA1 a pending attempt n+1 is REUSED: a retry naming after=n returns the same attempt; n+2 is never created', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result(); refuseNextNote(); await t.note();
    const first = (await t.retry('note', 1)).body;
    const again = (await t.retry('note', 1)).body;
    assert.deepEqual(again.next, first.next); assert.equal(again.next.requestId, rid(t.op, 'note', 2));
    assert.ok(!receipts.has(keyOf.attempt(t.op, 'note', 3)));
  });
  await check('RA2 concurrent retries and concurrent sends: one published attempt, one id, one claim -- 1 note, 1 touch', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result(); refuseNextNote(); await t.note();
    const [r1, r2] = await Promise.all([t.retry('note', 1), t.retry('note', 1)]);
    const ok = [r1, r2].filter((r) => r.statusCode === 200).map((r) => r.body.next.requestId);
    assert.ok(ok.every((x) => x === rid(t.op, 'note', 2)) && ok.length >= 1, JSON.stringify([r1, r2]));
    const [n1, n2] = await Promise.all([t.note(2), t.note(2)]);
    assert.deepEqual([n1.statusCode, n2.statusCode].sort(), [200, 409]);
    await finish(t);
    assert.ok(oneEach(A)); assert.ok(!receipts.has(keyOf.attempt(t.op, 'note', 3)));
  });
  await check('RA3 a retry of an attempt that is NOT proved unsent (undecided) creates nothing; Check again offers the same id', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result();
    const v = (await t.retry('note', 1)).body;
    assert.deepEqual(v.next, { action: 'send', slot: 'note', requestId: rid(t.op, 'note', 1) });
    assert.ok(!receipts.has(keyOf.attempt(t.op, 'note', 2)));
    assert.equal((await t.retry('note', 3)).statusCode, 400, 'a retry naming an attempt that does not exist is invalid');
  });
  await check('P-1 send permission needs BOTH the attempt record and the dispatch binding, verified', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result();
    const saved = receipts.get(keyOf.attempt(t.op, 'note', 1));
    receipts.delete(keyOf.attempt(t.op, 'note', 1));
    assert.equal(body(await t.note()).outcome, 'not_sent', 'attempt record missing');
    receipts.set(keyOf.attempt(t.op, 'note', 1), saved);
    const b = receipts.get(keyOf.binding(rid(t.op, 'note', 1)));
    receipts.delete(keyOf.binding(rid(t.op, 'note', 1)));
    assert.equal(body(await t.note()).outcome, 'not_sent', 'binding missing: an unbound call-log note');
    receipts.set(keyOf.binding(rid(t.op, 'note', 1)), { ...b, bodyDigest: 'tampered' });
    assert.equal(body(await t.note()).outcome, 'not_sent', 'binding mismatched');
    assert.equal(callNotes(A).length, 0);
  });

  // ── Result slot ─────────────────────────────────────────────────────────────
  await check('R-1 an undelivered result is withdrawn by Check again: final not_saved, released, NO result attempt 2; the late original sends nothing and gets the recorded outcome', async () => {
    fresh();
    const t = call(A, 'Spoke with Seller');
    await t.begin();
    const v = (await t.resume()).body;
    assert.equal(v.state, 'finished'); assert.equal(v.outcome.kind, 'not_saved');
    assert.ok(!receipts.has(keyOf.attempt(t.op, 'result', 2)));
    assert.equal((await contactStatus()).body.state, 'clear');
    const late = body(await t.result());
    assert.equal(late.outcome, 'not_sent'); assert.equal(late.code, 'operation_not_current'); assert.equal(late.recorded.kind, 'not_saved');
    assert.equal(resultPuts(A).length, 0);
  });
  await check('R-2 dispatch wins the race against the withdrawal: blocked until that attempt\'s outcome is known, then the call continues', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin();
    memStore.setJSON(keyOf.decision(rid(t.op, 'result', 1)), { d: 'send', at: 'now' }, { onlyIfNew: true });   // the dispatch claimed first
    const v = (await t.resume()).body;
    assert.equal(v.state, 'open'); assert.deepEqual(v.next, { action: 'blocked', slot: 'result', reason: 'in_flight' });
    memStore.setJSON(keyOf.outcome(rid(t.op, 'result', 1)), { kind: 'confirmed', at: 'now' }, { onlyIfNew: true });
    assert.equal((await t.resume()).body.next.slot, 'note');
  });
  await check('R-3 a result refused before sending (proved): Not saved; a NEW call (new operation id) may then begin', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin();
    failNext.push((op, key) => op === 'setJSON' && /^[0-9a-f]{64}$/.test(key));   // receipt claim fails inside the owned write
    const r = body(await t.result());
    assert.equal(r.proves, 'this_request');
    assert.equal((await t.resume()).body.outcome.kind, 'not_saved');
    assert.equal((await call(A, 'Voicemail').begin()).body.state, 'reserved');
  });

  // ── Note and touch slots ────────────────────────────────────────────────────
  await check('F-1 result uncertain (GHL\'s answer lost at the server): protected -- nothing further; repeated Check again blocked; a new begin refused', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin();
    loseNext.push((req) => req.method === 'PUT');
    assert.equal(body(await t.result()).outcome, 'indeterminate');
    for (let i = 0; i < 3; i++) assert.deepEqual((await t.resume()).body.next, { action: 'blocked', slot: 'result', reason: 'uncertain' });
    assert.equal(body(await t.note()).outcome, 'not_sent');
    assert.equal((await call(A, 'Voicemail').begin()).statusCode, 409);
    assert.equal(callNotes(A).length, 0);
  });
  await check('F-2 note refused (proved): visible retry; Retry notes publishes attempt 2 of the SAME operation; 1 note', async () => {
    fresh();
    const t = call(A, 'Spoke with Seller');
    await t.begin(); await t.result(); refuseNextNote(); await t.note();
    assert.deepEqual((await contactStatus()).body.next, { action: 'retry', slot: 'note', after: 1 });
    const r = (await t.retry('note', 1)).body;
    await t.note(2, r.body); await finish(t);
    assert.ok(oneEach(A));
  });
  await check('F-3 persistent note refusal: stays a visible partial save, ownership held, Retry available, no new call; never a duplicate; a later retry still completes once', async () => {
    fresh();
    const t = call(A, 'Spoke with Seller');
    await t.begin(); await t.result();
    for (let n = 1; n <= 3; n++) {
      if (n > 1) assert.equal((await t.retry('note', n - 1)).body.next.requestId, rid(t.op, 'note', n));
      refuseNextNote(); await t.note(n);
      const s = (await contactStatus()).body;
      assert.equal(s.state, 'open'); assert.deepEqual(s.next, { action: 'retry', slot: 'note', after: n });
      assert.equal((await call(A, 'Voicemail').begin()).statusCode, 409, 'no new call while it is open');
    }
    assert.equal(callNotes(A).length, 0);
    await t.retry('note', 3); await t.note(4); await finish(t);
    assert.ok(oneEach(A));
  });
  await check('F-4 note uncertain (sent, answer lost): protected -- no attempt 2 (a retry creates nothing); the touch is never sent', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result();
    loseNext.push((req) => req.method === 'POST');
    assert.equal(body(await t.note()).outcome, 'indeterminate');
    assert.deepEqual((await t.retry('note', 1)).body.next, { action: 'blocked', slot: 'note', reason: 'uncertain' });
    assert.ok(!receipts.has(keyOf.attempt(t.op, 'note', 2)));
    assert.equal(body(await t.touch()).outcome, 'not_sent');
    assert.equal(callNotes(A).length, 1); assert.equal(touchPuts(A).length, 0);
  });
  await check('F-5 note undecided (the request never arrived): Check again reuses the SAME id; 1 note', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result();
    assert.deepEqual((await t.resume()).body.next, { action: 'send', slot: 'note', requestId: rid(t.op, 'note', 1) });
    await finish(t); assert.ok(oneEach(A));
  });
  await check('F-6 note landed in GHL, its handler still running (no outcome yet): blocked in flight; the same id is refused; then only the touch, with its original id', async () => {
    fresh();
    const t = call(A, 'Voicemail', 'Left a message.');
    await t.begin(); await t.result();
    let reads = 0;
    const h = hold((req) => req.method === 'GET' && req.pathname === `/contacts/${A}/notes` && ++reads === 1);   // the note's readback, after the POST
    const pending = t.note();
    await h.hitP;
    assert.equal(callNotes(A).length, 1, 'GHL has the note');
    assert.deepEqual((await t.status()).body.next, { action: 'blocked', slot: 'note', reason: 'in_flight' });
    assert.equal(body(await t.note()).outcome, 'not_sent');
    h.release(); assert.equal((await pending).statusCode, 200);
    assert.deepEqual((await t.resume()).body.next, { action: 'send', slot: 'touch', requestId: rid(t.op, 'touch', 1) });
    await finish(t); assert.ok(oneEach(A));
  });
  await check('F-7 Retry last-touch time: only after the note is confirmed and only on a proved-unsent touch attempt; 1 touch', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result();
    assert.equal(body(await t.touch()).proves, 'nothing', 'a touch before the note is refused and proves nothing');
    assert.notEqual((await t.retry('touch', 1)).body.next.slot, 'touch', 'no touch retry while the note is not confirmed');
    assert.ok(!receipts.has(keyOf.attempt(t.op, 'touch', 2)));
    await t.note();
    assert.deepEqual((await t.retry('touch', 1)).body.next, { action: 'send', slot: 'touch', requestId: rid(t.op, 'touch', 1) }, 'an undecided touch is reused, not retried');
    failNext.push((op, key) => op === 'setJSON' && /^[0-9a-f]{64}$/.test(key));
    assert.equal(body(await t.touch()).proves, 'this_request');
    assert.deepEqual((await t.resume()).body.next, { action: 'retry', slot: 'touch', after: 1 });
    assert.equal((await t.retry('touch', 1)).body.next.requestId, rid(t.op, 'touch', 2));
    await t.touch(2); await finish(t);
    assert.ok(oneEach(A));
  });
  await check('F-8 touch uncertain: protected; blocked naming the touch; one touch PUT', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result(); await t.note();
    loseNext.push((req) => req.method === 'PUT');
    assert.equal(body(await t.touch()).outcome, 'indeterminate');
    assert.deepEqual((await t.resume()).body.next, { action: 'blocked', slot: 'touch', reason: 'uncertain' });
    assert.equal(touchPuts(A).length, 1);
  });

  // ── Call A, then Call B ─────────────────────────────────────────────────────
  async function aThenB() {
    const a = call(A, 'Spoke with Seller');
    await a.begin(); await a.result(); await a.note(); await a.touch();
    const b = call(A, 'No Answer', 'B');
    assert.equal((await b.begin()).body.state, 'reserved');
    return { a, b };
  }
  await check('AB-1 stale BEGIN for finished A while B is open: A\'s recorded outcome; A is not reopened; B unchanged', async () => {
    fresh();
    const { a, b } = await aThenB();
    const r = (await a.begin()).body;
    assert.equal(r.state, 'finished'); assert.equal(r.op, a.op); assert.equal(r.outcome.kind, 'complete');
    assert.equal(receipts.get(keyOf.head(A)).current, b.op);
  });
  await check('AB-2 stale RESUME and RETRY for A while B is open: A\'s recorded outcome; B unchanged', async () => {
    fresh();
    const { a, b } = await aThenB();
    const before = keysNow();
    assert.equal((await a.resume()).body.outcome.kind, 'complete');
    assert.equal((await a.retry('note', 1)).body.outcome.kind, 'complete');
    assert.deepEqual([...keysNow()].filter((k) => !before.has(k)), []);
    assert.equal(receipts.get(keyOf.head(A)).current, b.op);
  });
  await check('AB-3 stale STEP requests of A while B is open: operation_not_current with A\'s recorded outcome; NO record written; B completes 1/1/1 for itself', async () => {
    fresh();
    const { a, b } = await aThenB();
    const before = keysNow();
    for (const res of [await a.result(), await a.note(), await a.touch()]) {
      const x = body(res); assert.equal(x.outcome, 'not_sent'); assert.equal(x.code, 'operation_not_current'); assert.equal(x.recorded.kind, 'complete');
    }
    assert.deepEqual([...keysNow()].filter((k) => !before.has(k) && !/^[0-9a-f]{64}$/.test(k)), [], 'no call-log record written');
    assert.equal(receipts.get(keyOf.head(A)).current, b.op);
    await b.result(); await b.note(); await b.touch();
    assert.equal(stored(A), 'No Answer'); assert.equal(callNotes(A).length, 2); assert.equal(resultPuts(A).length, 2);
  });
  await check('AB-4 a finished not_saved operation reports not_saved to its stale readers', async () => {
    fresh();
    const a = call(A, 'Spoke with Seller');
    await a.begin(); await a.resume();
    await call(A, 'No Answer').begin();
    assert.equal((await a.status()).body.outcome.kind, 'not_saved');
  });

  // ── Finalization and release ────────────────────────────────────────────────
  await check('FN-1 / ST-5 the final write fails after every write landed: ownership retained; the next status writes final ONLY; GHL counts unchanged', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result(); await t.note();
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/v3/final/'));
    assert.equal((await t.touch()).statusCode, 200);
    assert.ok(!receipts.has(keyOf.final(t.op))); assert.equal(receipts.get(keyOf.head(A)).current, t.op);
    const c0 = counts(A);
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/v3/final/'));
    assert.equal((await contactStatus()).body.next.action, 'finishing', 'still recording: never shown as finished early');
    assert.equal((await contactStatus()).body.state, 'finished');
    assert.ok(receipts.has(keyOf.final(t.op))); assert.equal((await contactStatus()).body.state, 'clear');
    assert.deepEqual(counts(A), c0);
  });
  await check('FN-2 / ST-6 the head release fails after final: a later reconciliation releases it only while it still names this operation; a head naming another is untouched', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result(); await t.note();
    failNext.push((op, key) => op === 'setJSON' && key === keyOf.head(A));
    await t.touch();
    assert.ok(receipts.has(keyOf.final(t.op))); assert.equal(receipts.get(keyOf.head(A)).current, t.op);
    assert.equal((await call(A, 'Voicemail').begin()).body.state, 'reserved', 'a new call first completes the finished release, then begins');
    const other = receipts.get(keyOf.head(A)).current;
    assert.notEqual(other, t.op);
    assert.equal((await t.resume()).body.state, 'finished');
    assert.equal(receipts.get(keyOf.head(A)).current, other, 'the stale reconciliation did not touch the newer head');
  });

  // ── Storage failures ────────────────────────────────────────────────────────
  await check('ST-1 storage fails before dispatch: during begin (nothing reserved, head unset; the same begin then succeeds), and on the send claim (nothing sent)', async () => {
    fresh();
    const t = call(A, 'No Answer');
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/v3/binding/'));
    assert.equal((await t.begin()).statusCode, 503);
    assert.equal((await contactStatus()).body.state, 'clear');
    assert.equal((await t.begin()).body.state, 'reserved', 'the same operation id: idempotent');
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/v3/decision/'));
    assert.equal(body(await t.result()).outcome, 'not_sent'); assert.equal(resultPuts(A).length, 0);
    failNext.push((op, key) => op === 'get' && key.startsWith('call-log/v3/binding/'));
    assert.equal(body(await t.result()).outcome, 'not_sent'); assert.equal(resultPuts(A).length, 0);
  });
  await check('ST-2 storage fails AFTER GHL success, before the outcome is persisted: protected (in flight), never assumed confirmed, never resent', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin();
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/v3/outcome/'));
    assert.equal((await t.result()).statusCode, 200);
    assert.deepEqual((await t.resume()).body.next, { action: 'blocked', slot: 'result', reason: 'in_flight' });
    assert.equal(body(await t.result()).outcome, 'not_sent'); assert.equal(body(await t.note()).outcome, 'not_sent');
    assert.equal(resultPuts(A).length, 1);
  });
  await check('ST-3 publication ambiguous: the write APPLIED but its acknowledgement failed -> the same identity is read back and used; a write that did NOT apply -> 503, and a repeat publishes the SAME attempt (never n+2)', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result(); refuseNextNote(); await t.note();
    applyThenThrow.push((op, key) => key === keyOf.attempt(t.op, 'note', 2));
    assert.equal((await t.retry('note', 1)).body.next.requestId, rid(t.op, 'note', 2));
    fresh();
    const u = call(A, 'No Answer');
    await u.begin(); await u.result(); refuseNextNote(); await u.note();
    failNext.push((op, key) => op === 'setJSON' && key === keyOf.attempt(u.op, 'note', 2));
    assert.equal((await u.retry('note', 1)).statusCode, 503);
    assert.equal((await u.retry('note', 1)).body.next.requestId, rid(u.op, 'note', 2));
    assert.ok(!receipts.has(keyOf.attempt(u.op, 'note', 3)));
    await u.note(2); await finish(u); assert.ok(oneEach(A));
  });
  await check('ST-4 a stale read right after publication: no send permission until verified; the next call returns the same identity', async () => {
    fresh();
    const t = call(A, 'No Answer');
    await t.begin(); await t.result(); refuseNextNote(); await t.note();
    staleNext.push((key) => key === keyOf.binding(rid(t.op, 'note', 2)));
    const first = await t.retry('note', 1);
    assert.equal(first.statusCode, 503, 'the published binding did not read back yet: no permission');
    const again = (await t.retry('note', 1)).body;
    assert.equal(again.next.requestId, rid(t.op, 'note', 2));
    assert.ok(!receipts.has(keyOf.attempt(t.op, 'note', 3)));
  });
  await check('ST-7 storage fails reading status: 503 (the page treats it as blocked)', async () => {
    fresh();
    failNext.push((op, key) => key.startsWith('call-log/head/'));
    assert.equal((await contactStatus()).statusCode, 503);
  });

  // ── Older clients and legacy records ────────────────────────────────────────
  await check('L-2 a 558c666 client: begin with purpose/steps and the old reconcile action are refused (400); nothing sent', async () => {
    fresh();
    assert.equal((await post({ action: 'begin', contactId: A, purpose: 'call_log', result: 'No Answer', body: callLogNote('No Answer', ''), steps: [{ step: 'result', requestId: 'old-result-00001' }, { step: 'note', requestId: 'old-note-000001' }, { step: 'touch', requestId: 'old-touch-00001' }] })).statusCode, 400);
    assert.equal((await post({ action: 'reconcile', contactId: A })).statusCode, 400);
    assert.equal(body(await write('contact.callLogResult', A, { value: 'No Answer' }, 'old-result-00001')).outcome, 'not_sent');
    assert.equal(ghlWrites.length, 0);
  });
  await check('L-3 an existing 558c666-format unfinished head: blocked (legacy), begin refused, never resumed or resent; released only when its evidence settles', async () => {
    fresh();
    const lscope = legacy.callLogScope('test', config.locationId);
    const steps = [{ step: 'result', requestId: 'legacy-result-0001' }, { step: 'note', requestId: 'legacy-note-00001' }, { step: 'touch', requestId: 'legacy-touch-0001' }];
    await legacy.beginCallLog(memStore, lscope, { contactId: A, purpose: 'call_log', result: 'No Answer', body: callLogNote('No Answer', ''), steps }, 'now');
    // (a) its result landed, the note did not: legacy partial -- stays blocked; Check again does not release or resend.
    await legacy.runCallLogOwnedWrite(memStore, lscope, { operation: 'contact.callLogResult', targetId: A, requestId: 'legacy-result-0001', args: { value: 'No Answer' } }, async (hooks) => { await hooks.beforeDispatch(); hooks.state.dispatched = true; return { confirmed: true }; });
    assert.equal((await contactStatus()).body.state, 'legacy');
    assert.equal((await call(A, 'Voicemail').begin()).statusCode, 409);
    assert.equal((await post({ action: 'resume', contactId: A, legacy: true })).body.state, 'legacy');
    assert.equal(ghlWrites.length, 0);
    // (b) a legacy head whose first step never went out: Check again withdraws and releases; then a new call begins.
    fresh();
    await legacy.beginCallLog(memStore, lscope, { contactId: A, purpose: 'call_log', result: 'No Answer', body: callLogNote('No Answer', ''), steps }, 'now');
    assert.equal((await post({ action: 'resume', contactId: A, legacy: true })).body.state, 'clear');
    assert.equal((await call(A, 'Voicemail').begin()).body.state, 'reserved');
  });

  // ── Earlier reproductions (808e105 review) and preservation ─────────────────
  await check('E-1 saved but unverified -> reload -> replacement: the open operation is found; a replacement call is refused; finishing gives 1/1/1', async () => {
    fresh();
    const t = call(A, 'Spoke with Seller');
    await t.begin(); await t.result();
    const s = (await contactStatus()).body;
    assert.equal(s.op, t.op); assert.equal(s.next.slot, 'note');
    assert.equal((await call(A, 'No Answer').begin()).statusCode, 409);
    await finish(t); assert.ok(oneEach(A));
  });
  await check('E-2 pending -> away/back -> competing save -> older completion: competing begin refused; the older completes alone', async () => {
    fresh();
    const t = call(A, 'Spoke with Seller');
    await t.begin();
    assert.equal((await call(A, 'Not Interested').begin()).statusCode, 409);
    await t.result(); await finish(t);
    assert.ok(oneEach(A)); assert.equal(stored(A), 'Spoke with Seller');
  });
  await check('E-3 note landed, response lost -> reload: protected; no duplicate note is possible', async () => {
    fresh();
    const t = call(A, 'Voicemail');
    await t.begin(); await t.result();
    loseNext.push((req) => req.method === 'POST');
    await t.note();
    assert.equal(body(await t.note()).outcome, 'not_sent');
    assert.equal(body(await write('note.create', A, { body: t.noteBody }, 'fresh-note-0001')).outcome, 'not_sent');
    assert.equal(callNotes(A).length, 1);
  });
  await check('K contact isolation; the Current Offer barrier and plain writes are independent; auth: status needs a read session, actions need the write session and origin', async () => {
    fresh();
    const a = call(A, 'Spoke with Seller');
    await a.begin(); await a.result();
    const b = call(B, 'No Answer');
    assert.equal((await b.begin()).body.state, 'reserved');
    await b.result(); await b.note(); await b.touch();
    assert.equal((await contactStatus(B)).body.state, 'clear'); assert.equal((await contactStatus(A)).body.state, 'open');
    assert.equal(body(await write('note.create', B, { body: a.noteBody }, rid(a.op, 'note', 1))).outcome, 'not_sent');
    const offerLib = require('../netlify/functions/lib/current-offer-barrier.ts');
    await offerLib.beginBarrier(memStore, offerLib.barrierScope('test', config.locationId), { opp: 'fixture-opp-a', contactId: A, purpose: 'blur', steps: [{ step: 'offer', requestId: 'offer-request-0001' }] }, 'now');
    await finish(a); assert.ok(oneEach(A));
    assert.equal((await get({ contactId: A }, false)).statusCode, 401);
    assert.equal((await post({ action: 'resume', contactId: A, operationId: a.op }, { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN })).statusCode, 401);
    assert.equal((await post({ action: 'resume', contactId: A, operationId: a.op }, { ...writeHeaders(), origin: 'https://evil.example.invalid' })).statusCode, 403);
    assert.equal((await post({ action: 'retry', contactId: A, operationId: a.op, slot: 'result', after: 1 })).statusCode, 400, 'a result is never retried');
  });

  finished = true;
  console.log(`\nCall-log durable operations: ${count}/${count + failures} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
