/**
 * Board 15 / PR #131 (Bones, re-review of 808e105) -- durable call-log
 * ownership, driven through the REAL handlers: netlify/functions/ghl-write.ts
 * and netlify/functions/call-log-barrier.ts. Lifecycle:
 * docs/CALL_LOG_SAVE_LIFECYCLE.md.
 *
 * Offline. @netlify/blobs is replaced by an in-memory store with the SDK's
 * onlyIfNew / onlyIfMatch semantics and injectable failures; every GHL call
 * goes to a fake (two contacts) that can be held, fail before sending, or
 * apply a write and then lose the response. Every check verifies GHL's own
 * state (result field, notes, last touch) and the count of GHL writes.
 *
 * Covered: ownership before the first write and enforced server-side; the
 * ORDER rule; original request identities on resume; Bones's three
 * reproductions; two sessions; uncertainty at every step; definite refusals;
 * repeated reconciliation; contact isolation; storage failures; auth; the
 * Current Offer barrier and unrelated writes unchanged.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const receipts = new Map();
const etags = new Map();
let etagSeq = 0;
let failNext = [];
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
      async get(key) { maybeFail('get', key); return receipts.has(key) ? structuredClone(receipts.get(key)) : null; },
      async getWithMetadata(key) { maybeFail('getWithMetadata', key); return receipts.has(key) ? { data: structuredClone(receipts.get(key)), etag: etags.get(key) } : null; },
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
const { callLogNote } = require('../src/lib/call-outcome-copy.ts');
const config = getConfig('test');
const F = config.fields;

// ── Fake GHL: two contacts ───────────────────────────────────────────────────
const A = 'fixture-contact-a';
const B = 'fixture-contact-b';
let ghl;
let ghlWrites = [];
let holds = [];
let loseNext = [];
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
  const lose = loseNext.findIndex((f) => f(req));
  const m = pathname.match(/^\/contacts\/([^/]+)(\/notes)?$/);
  if (!m || !ghl[m[1]]) throw new Error('Unexpected mocked request: ' + method + ' ' + pathname);
  const c = ghl[m[1]];
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
const offerBarrierFn = require('../netlify/functions/current-offer-barrier.ts').handler;
const writeHeaders = () => ({ ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` });
let seq = 0;
const rid = (label) => `${label}-${String(++seq).padStart(4, '0')}-fixture`;
const write = (operation, targetId, args, requestId) => ghlWrite({ blobs: lambdaBlobs, httpMethod: 'POST', headers: writeHeaders(), body: JSON.stringify({ operation, targetId, requestId, args }) });
const post = (b, headers = writeHeaders()) => callLogFn({ blobs: lambdaBlobs, httpMethod: 'POST', headers, body: JSON.stringify(b) });
const readCookie = () => `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;
const status = async (contactId = A, signedIn = true) => {
  const res = await callLogFn({ blobs: lambdaBlobs, httpMethod: 'GET', headers: { ...lambdaHeaders, ...(signedIn ? { cookie: readCookie() } : {}) }, queryStringParameters: { contactId } });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};
const body = (res) => JSON.parse(res.body);

/** One Save call attempt: its ids, result and exact note body. */
function attempt(contactId, result, notes = '') {
  const ids = { result: rid('result'), note: rid('note'), touch: rid('touch') };
  const noteBody = callLogNote(result, notes);
  return {
    contactId, result, noteBody, ids,
    begin: (overrides = {}) => post({ action: 'begin', contactId, purpose: 'call_log', result, body: noteBody, steps: [{ step: 'result', requestId: ids.result }, { step: 'note', requestId: ids.note }, { step: 'touch', requestId: ids.touch }], ...overrides }),
    sendResult: () => write('contact.callLogResult', contactId, { value: result }, ids.result),
    sendNote: (id = ids.note, b = noteBody) => write('note.create', contactId, { body: b }, id),
    sendTouch: (id = ids.touch, at = '2026-10-06T15:00:00.000Z') => write('contact.lastCallAttempt', contactId, { value: at }, id),
  };
}
const reconcile = (contactId = A) => post({ action: 'reconcile', contactId });
const stored = (c) => (ghl[c].customFields.find((f) => f.id === F.callDisposition) || {}).value ?? null;
const touchOf = (c) => (ghl[c].customFields.find((f) => f.id === F.lastCallAttemptPrecise) || {}).value ?? null;
const callNotes = (c) => ghl[c].notes.filter((n) => n.body.startsWith('Call (reported by Brad in IAOS):'));
const writesOf = (c, kind) => ghlWrites.filter((w) => w.contact === c && (!kind || w.kind === kind));
const resultPuts = (c) => ghlWrites.filter((w) => w.contact === c && w.kind === 'fields' && w.body.customFields.some((f) => f.id === F.callDisposition));
const touchPuts = (c) => ghlWrites.filter((w) => w.contact === c && w.kind === 'fields' && w.body.customFields.some((f) => f.id === F.lastCallAttemptPrecise));

let count = 0;
let failures = 0;
async function check(name, fn) {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e)); }
}
function fresh() {
  receipts.clear(); etags.clear(); failNext = []; holds = []; loseNext = []; ghlWrites = [];
  ghl = { [A]: { id: A, customFields: [], notes: [] }, [B]: { id: B, customFields: [], notes: [] } };
}

(async () => {
  // ── Ownership before the first write, enforced server-side ─────────────────
  await check('a call result with no reservation is refused before sending (not_sent; zero GHL writes)', async () => {
    fresh();
    const res = await write('contact.callLogResult', A, { value: 'No Answer' }, rid('unreserved'));
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(ghlWrites.length, 0); assert.equal(stored(A), null);
  });
  await check('a note in the call-log format with no reservation is refused before sending; a plain note and an unreserved last touch are unchanged', async () => {
    fresh();
    const res = await write('note.create', A, { body: callLogNote('Voicemail', 'left a message') }, rid('unreserved-note'));
    assert.equal(res.statusCode, 409); assert.equal(body(res).outcome, 'not_sent'); assert.equal(writesOf(A).length, 0);
    assert.equal((await write('note.create', A, { body: 'Plain operator note' }, rid('plain'))).statusCode, 200);
    assert.equal((await write('contact.lastCallAttempt', A, { value: '2026-10-06T14:00:00.000Z' }, rid('plain-touch'))).statusCode, 200);
    assert.equal(writesOf(A).length, 2);
  });
  await check('Save call: begin -> result -> note -> touch, each confirmed; the reservation releases itself after the last step', async () => {
    fresh();
    const t = attempt(A, 'Spoke with Seller', 'Wants 30 days.');
    assert.equal((await t.begin()).statusCode, 200);
    assert.equal((await status()).body.state, 'blocked');
    assert.equal((await t.sendResult()).statusCode, 200);
    assert.equal((await status()).body.kind, 'resumable', 'between steps: not finished');
    assert.equal((await t.sendNote()).statusCode, 200);
    assert.equal((await t.sendTouch()).statusCode, 200);
    assert.equal((await status()).body.state, 'clear');
    assert.equal(stored(A), 'Spoke with Seller'); assert.equal(callNotes(A).length, 1); assert.equal(callNotes(A)[0].body, t.noteBody); assert.equal(touchOf(A), '2026-10-06T15:00:00.000Z');
  });

  // ── ORDER and identity rules ───────────────────────────────────────────────
  await check('ORDER: the note is refused while its result is not confirmed (not_sent, no GHL write) and stays resumable with its own id', async () => {
    fresh();
    const t = attempt(A, 'Voicemail');
    await t.begin();
    const early = await t.sendNote();
    assert.equal(body(early).outcome, 'not_sent'); assert.equal(writesOf(A).length, 0);
    const early2 = await t.sendTouch();
    assert.equal(body(early2).outcome, 'not_sent'); assert.equal(writesOf(A).length, 0);
    await t.sendResult();
    assert.equal((await t.sendNote()).statusCode, 200, 'the same note request id still works in order');
    assert.equal(callNotes(A).length, 1);
  });
  await check('a step must carry exactly what was reserved: another result value or another note body is refused (not_sent)', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin();
    assert.equal(body(await write('contact.callLogResult', A, { value: 'Voicemail' }, t.ids.result)).outcome, 'not_sent');
    await t.sendResult();
    assert.equal(body(await t.sendNote(t.ids.note, callLogNote('No Answer', 'something else'))).outcome, 'not_sent');
    assert.equal(stored(A), 'No Answer'); assert.equal(callNotes(A).length, 0);
  });
  await check('a reserved request id cannot be used on another contact or for another step', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin();
    assert.equal(body(await write('contact.callLogResult', B, { value: 'No Answer' }, t.ids.result)).outcome, 'not_sent');
    assert.equal(body(await write('contact.lastCallAttempt', A, { value: '2026-10-06T15:00:00.000Z' }, t.ids.result)).outcome, 'not_sent');
    assert.equal(ghlWrites.length, 0);
  });

  // ── Bones reproduction 1: saved-but-unverified -> reload -> replacement result ─
  await check('REPRO 1: result confirmed, then the page is reloaded: every session sees it unfinished; a replacement result cannot be reserved or sent', async () => {
    fresh();
    const t = attempt(A, 'Spoke with Seller');
    await t.begin(); await t.sendResult();          // confirmed; the browser's readback then failed -- nothing else sent
    const s = await status();
    assert.equal(s.body.state, 'blocked'); assert.equal(s.body.kind, 'resumable'); assert.match(s.body.message, /partly saved/);
    assert.doesNotMatch(s.body.message, /reload/i, 'never recommends a reload');
    const replacement = attempt(A, 'No Answer');
    const b = await replacement.begin();
    assert.equal(b.statusCode, 409); assert.equal(body(b).state, 'blocked');
    assert.equal(body(await replacement.sendResult()).outcome, 'not_sent');
    assert.equal(stored(A), 'Spoke with Seller'); assert.equal(resultPuts(A).length, 1);
  });
  await check('REPRO 1 (resolution): reconcile returns the ORIGINAL note and touch ids; finishing with them writes exactly one note; then a new call can be saved', async () => {
    fresh();
    const t = attempt(A, 'Spoke with Seller', 'Roof is new.');
    await t.begin(); await t.sendResult();
    const r = body(await reconcile());
    assert.equal(r.kind, 'resumable');
    assert.deepEqual(r.remaining, [{ step: 'note', requestId: t.ids.note }, { step: 'touch', requestId: t.ids.touch }]);
    assert.equal(r.body, t.noteBody);
    assert.equal((await t.sendNote(r.remaining[0].requestId, r.body)).statusCode, 200);
    assert.equal((await t.sendTouch(r.remaining[1].requestId)).statusCode, 200);
    assert.equal((await status()).body.state, 'clear');
    assert.equal(callNotes(A).length, 1);
    const next = attempt(A, 'No Answer');
    assert.equal((await next.begin()).statusCode, 200);
  });

  // ── Bones reproduction 2: pending -> away/back -> competing save -> older completion ─
  await check('REPRO 2: a result request still on its way: a competing save is refused while it is pending', async () => {
    fresh();
    const older = attempt(A, 'Spoke with Seller');
    await older.begin();                             // the result request has not reached the server
    assert.equal((await status()).body.kind, 'pending');
    const competing = attempt(A, 'Not Interested');
    assert.equal((await competing.begin()).statusCode, 409);
    assert.equal(body(await competing.sendResult()).outcome, 'not_sent');
    assert.equal(ghlWrites.length, 0);
  });
  await check('REPRO 2: Check again withdraws the undelivered older request; the older request arriving LATER sends nothing; the newer save is the only result in GHL', async () => {
    fresh();
    const older = attempt(A, 'Spoke with Seller');
    await older.begin();
    const rec = body(await reconcile());
    assert.equal(rec.state, 'clear'); assert.equal(rec.summary.steps[0].evidence, 'withdrawn');
    const newer = attempt(A, 'Not Interested');
    await newer.begin(); await newer.sendResult(); await newer.sendNote(); await newer.sendTouch();
    const late = await older.sendResult();           // the delayed handler finally runs
    assert.equal(late.statusCode, 409); assert.equal(body(late).outcome, 'not_sent');
    assert.equal(body(await older.sendNote()).outcome, 'not_sent');
    assert.equal(stored(A), 'Not Interested'); assert.equal(resultPuts(A).length, 1); assert.equal(callNotes(A).length, 1);
  });
  await check('REPRO 2: if nobody withdrew it, the older request completes normally when it arrives (it still owns the contact)', async () => {
    fresh();
    const older = attempt(A, 'Spoke with Seller');
    await older.begin();
    assert.equal((await attempt(A, 'Not Interested').begin()).statusCode, 409);
    assert.equal((await older.sendResult()).statusCode, 200);
    assert.equal(stored(A), 'Spoke with Seller'); assert.equal(resultPuts(A).length, 1);
  });
  await check('REPRO 2: an older request held INSIDE the server (lock held) cannot be withdrawn out from under it: reconcile answers in_progress', async () => {
    fresh();
    const older = attempt(A, 'Spoke with Seller');
    await older.begin();
    const h = hold((req) => req.method === 'PUT');
    const pending = older.sendResult();
    await h.hitP;
    const rec = await reconcile();
    assert.equal(rec.statusCode, 409); assert.equal(body(rec).state, 'in_progress');
    h.release();
    assert.equal((await pending).statusCode, 200);
    assert.equal(stored(A), 'Spoke with Seller');
  });

  // ── Bones reproduction 3: note landed, response pending -> reload -> duplicate note ─
  await check('REPRO 3: the note has landed and its response is still pending: after a reload the note is NEVER re-sent (same id refused; a new id is not reserved)', async () => {
    fresh();
    const t = attempt(A, 'Voicemail', 'Left a message.');
    await t.begin(); await t.sendResult();
    const h = hold((req) => req.method === 'POST' && req.pathname === `/contacts/${A}/notes`);
    const pending = t.sendNote();                     // GHL receives the note; the answer is held
    await h.hitP;
    const s = await status();
    assert.equal(s.body.kind, 'uncertain'); assert.match(s.body.message, /may still reach GHL/);
    assert.equal(body(await t.sendNote()).outcome, 'not_sent', 'the same id: refused while the first is in flight');
    assert.equal(body(await write('note.create', A, { body: t.noteBody }, rid('fresh-note'))).outcome, 'not_sent', 'a fresh id: not reserved');
    assert.equal((await attempt(A, 'Voicemail', 'Left a message.').begin()).statusCode, 409, 'a new attempt: refused');
    h.release();
    assert.equal((await pending).statusCode, 200);
    assert.equal(callNotes(A).length, 1);
  });
  await check('REPRO 3 (resolution): once the held note confirms, Check again resumes ONLY the last touch with its original id; one note in GHL', async () => {
    fresh();
    const t = attempt(A, 'Voicemail', 'Left a message.');
    await t.begin(); await t.sendResult(); await t.sendNote();
    const r = body(await reconcile());
    assert.equal(r.kind, 'resumable'); assert.deepEqual(r.remaining, [{ step: 'touch', requestId: t.ids.touch }]);
    assert.equal(body(await t.sendNote()).outcome, 'not_sent', 'a duplicate of the confirmed note sends nothing');
    assert.equal((await t.sendTouch(r.remaining[0].requestId)).statusCode, 200);
    assert.equal((await status()).body.state, 'clear'); assert.equal(callNotes(A).length, 1); assert.equal(touchPuts(A).length, 1);
  });
  await check('REPRO 3 (lost response): the note reached GHL and its response was lost: uncertain forever -- repeated reconcile, a new begin and the note visible in GHL do not clear it; no second note', async () => {
    fresh();
    const t = attempt(A, 'Voicemail');
    await t.begin(); await t.sendResult();
    loseNext.push((req) => req.method === 'POST');
    const res = await t.sendNote();
    assert.equal(body(res).outcome, 'indeterminate');
    assert.equal(callNotes(A).length, 1, 'GHL has the note');
    for (let i = 0; i < 3; i++) { const r = body(await reconcile()); assert.equal(r.state, 'blocked'); assert.equal(r.kind, 'uncertain'); assert.equal(r.remaining, undefined); }
    assert.equal((await attempt(A, 'Voicemail').begin()).statusCode, 409);
    assert.equal(body(await t.sendNote()).outcome, 'not_sent');
    assert.equal(body(await t.sendTouch()).outcome, 'not_sent', 'the touch waits for a confirmed note');
    assert.equal(callNotes(A).length, 1); assert.equal(touchPuts(A).length, 0);
  });

  // ── Uncertainty at every step ──────────────────────────────────────────────
  await check('uncertain RESULT (lost response): blocked as uncertain; nothing after it can be sent; reconcile never clears it', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin();
    loseNext.push((req) => req.method === 'PUT');
    assert.equal(body(await t.sendResult()).outcome, 'indeterminate');
    for (let i = 0; i < 3; i++) assert.equal(body(await reconcile()).kind, 'uncertain');
    assert.equal(body(await t.sendNote()).outcome, 'not_sent');
    assert.equal(callNotes(A).length, 0); assert.equal(resultPuts(A).length, 1);
  });
  await check('uncertain LAST TOUCH (lost response): blocked as uncertain naming the last-touch time; one touch PUT', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin(); await t.sendResult(); await t.sendNote();
    loseNext.push((req) => req.method === 'PUT');
    assert.equal(body(await t.sendTouch()).outcome, 'indeterminate');
    const r = body(await reconcile());
    assert.equal(r.kind, 'uncertain'); assert.match(r.message, /last-touch time/);
    assert.equal(body(await t.sendTouch()).outcome, 'not_sent'); assert.equal(touchPuts(A).length, 1);
  });

  // ── Definite refusals ──────────────────────────────────────────────────────
  await check('a RESULT refused before sending (GHL unreachable before the call): not_sent; Check again proves nothing was saved and releases', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin();
    const h = hold((req) => req.method === 'GET' && req.pathname === `/contacts/${A}`, { failBefore: true }); h.release();
    assert.equal(body(await t.sendResult()).outcome, 'not_sent');
    const r = body(await reconcile());
    assert.equal(r.state, 'clear'); assert.notEqual(r.summary.steps[0].evidence, 'confirmed');
    assert.equal(stored(A), null); assert.equal(writesOf(A).length, 0);
  });
  await check('a NOTE refused before sending: the attempt ends (result saved, note withdrawn); a Retry-notes reservation writes exactly one note', async () => {
    fresh();
    const t = attempt(A, 'Spoke with Seller', 'Call back Friday.');
    await t.begin(); await t.sendResult();
    // The write-receipt claim fails inside the owned write, before the send is claimed: provably nothing sent.
    failNext.push((op, key) => op === 'setJSON' && /^[0-9a-f]{64}$/.test(key));
    assert.equal(body(await t.sendNote()).outcome, 'not_sent');
    assert.equal(writesOf(A, 'note').length, 0);
    const r = body(await reconcile());
    assert.equal(r.state, 'clear');
    assert.deepEqual(r.summary.steps.map((s) => s.evidence), ['confirmed', 'withdrawn', 'withdrawn']);
    assert.equal(r.summary.body, t.noteBody);
    assert.equal(body(await t.sendNote()).outcome, 'not_sent', 'the withdrawn id can never be sent');
    const ids = { note: rid('retry-note'), touch: rid('retry-touch') };
    assert.equal((await post({ action: 'begin', contactId: A, purpose: 'call_log_note', result: t.result, body: t.noteBody, steps: [{ step: 'note', requestId: ids.note }, { step: 'touch', requestId: ids.touch }] })).statusCode, 200);
    assert.equal((await t.sendNote(ids.note)).statusCode, 200);
    assert.equal((await t.sendTouch(ids.touch)).statusCode, 200);
    assert.equal(callNotes(A).length, 1); assert.equal((await status()).body.state, 'clear');
  });
  await check('another write holding the contact lock: the step is not_sent with NO decision, so it stays resumable with its own id', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin(); await t.sendResult();
    const h = hold((req) => req.method === 'POST' && req.pathname === `/contacts/${A}/notes`);
    const plain = write('note.create', A, { body: 'Plain operator note' }, rid('plain'));
    await h.hitP;
    assert.equal(body(await t.sendNote()).outcome, 'not_sent');
    h.release(); await plain;
    assert.equal(body(await reconcile()).kind, 'resumable');
    assert.equal((await t.sendNote()).statusCode, 200);
    assert.equal(callNotes(A).length, 1);
  });

  // ── Scoped reconcile (a page settling ITS OWN attempt) ─────────────────────
  await check('a stale page settling its OLD attempt can never withdraw a NEWER attempt\'s undelivered step: nothing changes, the old attempt\'s own evidence is reported', async () => {
    fresh();
    const older = attempt(A, 'Spoke with Seller');
    await older.begin(); await older.sendResult(); await older.sendNote(); await older.sendTouch();   // finished and released
    const newer = attempt(A, 'No Answer');
    await newer.begin();                              // its result request is still on its way
    const scoped = body(await post({ action: 'reconcile', contactId: A, attempt: older.ids.result }));
    assert.equal(scoped.state, 'clear'); assert.deepEqual(scoped.summary.steps.map((s) => s.evidence), ['confirmed', 'confirmed', 'confirmed']);
    assert.equal((await status()).body.kind, 'pending', 'the newer attempt is untouched');
    assert.equal((await newer.sendResult()).statusCode, 200, 'and its delayed result still sends');
    assert.equal(stored(A), 'No Answer');
  });
  await check('a scoped reconcile of the CURRENT attempt behaves exactly like Check again; an invalid attempt id is refused (400)', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin(); await t.sendResult();
    const scoped = body(await post({ action: 'reconcile', contactId: A, attempt: t.ids.result }));
    assert.equal(scoped.kind, 'resumable'); assert.equal(scoped.attempt, t.ids.result);
    assert.equal((await post({ action: 'reconcile', contactId: A, attempt: 'bad id!' })).statusCode, 400);
  });

  // ── Two sessions and repeated reconciliation ───────────────────────────────
  await check('two sessions finishing the SAME attempt: both get the same original ids; one note and one touch reach GHL', async () => {
    fresh();
    const t = attempt(A, 'Spoke with Seller');
    await t.begin(); await t.sendResult();
    const s1 = body(await reconcile()); const s2 = body(await reconcile());
    assert.deepEqual(s1.remaining, s2.remaining, 'repeated reconciliation is stable');
    const [n1, n2] = await Promise.all([t.sendNote(s1.remaining[0].requestId, s1.body), t.sendNote(s2.remaining[0].requestId, s2.body)]);
    assert.deepEqual([n1.statusCode, n2.statusCode].sort(), [200, 409]);
    const [t1, t2] = await Promise.all([t.sendTouch(s1.remaining[1].requestId), t.sendTouch(s2.remaining[1].requestId)]);
    assert.deepEqual([t1.statusCode, t2.statusCode].sort(), [200, 409]);
    assert.equal(callNotes(A).length, 1); assert.equal(touchPuts(A).length, 1);
    assert.equal(body(await reconcile()).state, 'clear'); assert.equal(body(await reconcile()).state, 'clear');
  });
  await check('a second session cannot begin while the first holds the contact; a retried begin of the exact original is idempotent; an altered repeat is rejected', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    assert.equal((await t.begin()).statusCode, 200);
    assert.equal((await t.begin()).statusCode, 200);
    const altered = await t.begin({ body: callLogNote('No Answer', 'changed') });
    assert.equal(altered.statusCode, 409); assert.equal(body(altered).code, 'reservation_mismatch');
    assert.equal((await attempt(A, 'Voicemail').begin()).statusCode, 409);
  });

  // ── Contact isolation ──────────────────────────────────────────────────────
  await check('contact isolation: an unfinished save on A never blocks B; each contact\'s records and GHL writes stay its own', async () => {
    fresh();
    const a = attempt(A, 'Spoke with Seller');
    await a.begin(); await a.sendResult();
    const b = attempt(B, 'No Answer');
    assert.equal((await b.begin()).statusCode, 200);
    await b.sendResult(); await b.sendNote(); await b.sendTouch();
    assert.equal((await status(B)).body.state, 'clear'); assert.equal((await status(A)).body.kind, 'resumable');
    assert.equal(stored(A), 'Spoke with Seller'); assert.equal(stored(B), 'No Answer');
    assert.equal(callNotes(A).length, 0); assert.equal(callNotes(B).length, 1);
    assert.equal(body(await write('note.create', B, { body: a.noteBody }, a.ids.note)).outcome, 'not_sent', "A's id cannot write to B");
  });

  // ── Storage failures, auth, scope, unchanged writes ────────────────────────
  await check('storage failure while claiming the send: nothing is sent; the attempt stays held', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin();
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/decision/'));
    assert.equal(body(await t.sendResult()).outcome, 'not_sent'); assert.equal(writesOf(A).length, 0);
    assert.equal((await status()).body.state, 'blocked');
  });
  await check('storage failure recording the confirmed outcome: the attempt is never assumed finished (uncertain, blocked)', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin();
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/outcome/'));
    assert.equal((await t.sendResult()).statusCode, 200);
    assert.equal((await status()).body.kind, 'uncertain');
    assert.equal(body(await t.sendNote()).outcome, 'not_sent');
  });
  await check('storage failure during begin or reading status: 503, nothing reserved; ghl-write refuses a call result whose reservation cannot be read', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    failNext.push((op, key) => op === 'setJSON' && key.startsWith('call-log/head/'));
    assert.equal((await t.begin()).statusCode, 503);
    assert.equal((await status()).body.state, 'clear');
    failNext.push((op, key) => key.startsWith('call-log/head/'));
    assert.equal((await status()).statusCode, 503);
    await t.begin();
    failNext.push((op, key) => op === 'get' && key.startsWith('call-log/request/'));
    assert.equal(body(await t.sendResult()).outcome, 'not_sent'); assert.equal(writesOf(A).length, 0);
  });
  await check('status needs a read session; begin and reconcile need the write session and origin; a begin must carry an exact call-log note for its result', async () => {
    fresh();
    assert.equal((await status(A, false)).statusCode, 401);
    const t = attempt(A, 'No Answer');
    assert.equal((await t.begin()).statusCode, 200);
    fresh();
    assert.equal((await post({ action: 'reconcile', contactId: A }, { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN })).statusCode, 401);
    assert.equal((await post({ action: 'reconcile', contactId: A }, { ...writeHeaders(), origin: 'https://evil.example.invalid' })).statusCode, 403);
    assert.equal((await t.begin({ body: 'Call (reported by Brad in IAOS): Voicemail' })).statusCode, 400, 'note names another result');
    assert.equal((await t.begin({ body: 'Plain note' })).statusCode, 400);
  });
  await check('records live under call-log/ only (never current-offer/ or the stage marker); nothing is deleted; the head changes only conditionally', async () => {
    fresh();
    const t = attempt(A, 'No Answer');
    await t.begin(); await t.sendResult(); await t.sendNote(); await t.sendTouch();
    const keys = [...receipts.keys()];
    assert.ok(keys.some((k) => k.startsWith('call-log/head/')));
    assert.ok(!keys.some((k) => k.startsWith('current-offer/')));
    assert.ok(!keys.some((k) => k.startsWith('stage-unresolved/')));
    for (const prefix of ['barrier/', 'request/', 'decision/', 'outcome/']) assert.ok(keys.some((k) => k.startsWith('call-log/' + prefix)), prefix);
  });
  await check('the deal\'s Current Offer barrier and the contact\'s call log are independent: a pending Current Offer save does not block a call save', async () => {
    fresh();
    // A Current Offer reservation for an opportunity of A (the opportunity read is not needed for begin in this fake: use the module directly).
    const offerLib = require('../netlify/functions/lib/current-offer-barrier.ts');
    const store = { get: async (k) => receipts.get(k) ?? null, getWithMetadata: async (k) => (receipts.has(k) ? { data: receipts.get(k), etag: etags.get(k) } : null),
      setJSON: async (k, v, o) => { if (o?.onlyIfNew && receipts.has(k)) return { modified: false }; if (o?.onlyIfMatch !== undefined && etags.get(k) !== o.onlyIfMatch) return { modified: false }; receipts.set(k, v); const e = 'etag-' + (++etagSeq); etags.set(k, e); return { modified: true, etag: e }; } };
    await offerLib.beginBarrier(store, offerLib.barrierScope('test', config.locationId), { opp: 'fixture-opp-a', contactId: A, purpose: 'blur', steps: [{ step: 'offer', requestId: rid('offer') }] }, new Date().toISOString());
    const t = attempt(A, 'No Answer');
    assert.equal((await t.begin()).statusCode, 200);
    assert.equal((await t.sendResult()).statusCode, 200); assert.equal((await t.sendNote()).statusCode, 200); assert.equal((await t.sendTouch()).statusCode, 200);
    assert.equal(callNotes(A).length, 1);
    void offerBarrierFn;
  });

  console.log(`\nCall-log durable ownership: ${count}/${count + failures} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
