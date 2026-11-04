/**
 * B15-29 (INV-137) one IAOS sign-in -- BROWSER saving module (src/lib/app-write-session.ts), offline, in Node.
 *
 * The module's own fetch calls are answered by the REAL server code in this process: app-write-token (the REAL
 * handler, with a cookie jar standing in for the HttpOnly cookie) and, for every save, the REAL per-save checks a
 * writer runs first -- requireAppWriter and sessionWriteRefusal (Variant S). The revocation store is the in-memory
 * fake Blob API. Time is a simulated clock (Date.now) shared by browser and server code, so a 45-minute seller call
 * runs in milliseconds. There is no BroadcastChannel, localStorage or sessionStorage in this process at all.
 *
 *   C1  flag off: exactly the previous behaviour (no token endpoint; "Sign in for application writes" refusal)
 *   C2  first save gets its token automatically; concurrent saves share one token request
 *   C3  45-minute call: every save sent exactly once with a live token; renewals silent and bounded
 *   C4  the read session expires mid-call: saving pauses (server pexp + token 401), the save is never re-sent,
 *       the refusal says the edits were not submitted; after a fresh sign-in the next save is sent once
 *   C5  Sign out in ANOTHER tab mid-call (server revocation only): the earlier token is refused (Variant S), the
 *       next save is refused before sending, nothing re-sent
 *   C6  store unavailable: token 503 -> paused before send; a write 503 -> returned once, never re-sent
 *   C7  Sign out on THIS page pauses at the click, discards an in-flight token, resumes only on sign-in
 *   C8  malformed token answers / network failure: refused before send, one token request per attempt
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { createFakeBlobs } = require('./lib/b15-29-fake-blobs.cjs');

const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
Module._resolveFilename = ((original) => function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    for (const ext of ['.ts', '.tsx']) {
      const candidate = path.resolve(path.dirname(parent.filename), name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return original.call(this, name, parent, ...rest);
})(Module._resolveFilename);
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

const ORIGIN = 'https://proof.example.invalid';
const SITE = '07ca1f1a-60fd-4229-a076-528970957912';   // the PINNED Test revocation site (B15-29 H2)
const EPOCH = 'fixture-epoch-0001';
const NF = { 'x-nf-site-id': SITE };                   // the platform's runtime site header
const BLOB_TOKEN = 'fixture-blob-token-not-real';
Object.assign(process.env, {
  IAOS_ENV: 'test',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
  IAOS_SESSION_REVOCATION_SITE_ID: SITE,
  IAOS_SESSION_REVOCATION_TOKEN: BLOB_TOKEN,
});
delete process.env.IAOS_VOICE_SESSION_SECRET;

// ---- simulated clock shared by browser and server code ----
const realNow = Date.now;
let T = realNow.call(Date);
Date.now = () => T;
const advance = (ms) => { T += ms; };

// ---- no browser storage or channel exists here ----
assert.equal(typeof globalThis.BroadcastChannel === 'undefined' || (delete globalThis.BroadcastChannel, true), true);
const window = new EventTarget();
global.window = window;
const events = [];
for (const name of ['iaos-read-session-lost', 'iaos-session-unavailable']) window.addEventListener(name, () => events.push(name));

const cfg = require(path.join(APP, 'shared/ghl-config.ts'));
const readAuth = require(path.join(FUNCTIONS, 'lib/app-read-auth.ts'));
const writeAuth = require(path.join(FUNCTIONS, 'lib/app-write-auth.ts'));
const rev = require(path.join(FUNCTIONS, 'lib/session-revocation.ts'));
const blobs = createFakeBlobs({ siteID: SITE, token: BLOB_TOKEN, clock: () => T });
// The operator-provisioned authority anchor (fixture only; no code path writes it).
const seedAnchor = () => blobs.put('iaos-write-receipts', 'session-revocation/_authority', JSON.stringify({ env: 'test', epoch: EPOCH, kind: 'iaos-session-revocation-authority', siteID: SITE, v: 1 }));
seedAnchor();
const basePayload = () => ({ ...cfg.projectRuntimeConfig(cfg.getConfig('test'), 'test'), repairApproval: { active: false } });
const setFlag = (on) => {
  cfg.getConfig('test').oneLogin = on ? cfg.ONE_LOGIN_ENABLED : cfg.ONE_LOGIN_DISABLED;
  cfg.setRuntimeConfig(on ? { ...basePayload(), oneLogin: { active: true } } : basePayload());
};
const tokenHandler = require(path.join(FUNCTIONS, 'app-write-token.ts')).handler;

// ---- the browser's one IAOS session (cookie jar) ----
let jar = null;
const sid = (n) => Buffer.alloc(16, n).toString('base64url');
const signIn = (n, at = T) => { jar = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), at, sid(n), EPOCH).token; };

// ---- request log + routing ----
let log = [];
let tokenMode = 'real';      // 'real' | 'network' | 'bad-lifetime' | 'no-token' | 'hold'
let held = null;
let writeStore = [];
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.netlify.com/') || u.startsWith('https://signed.blobs.invalid/')) return blobs.fetch(url, init);
  const headers = {};
  new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
  if (u === '/.netlify/functions/app-write-token') {
    const entry = { kind: 'token', at: T }; log.push(entry);
    if (tokenMode === 'network') throw new TypeError('Failed to fetch');
    if (tokenMode === 'bad-lifetime') return new Response(JSON.stringify({ token: 'x.y.z', expiresAt: 'x', expiresInSeconds: 3600 }), { status: 200 });
    if (tokenMode === 'no-token') return new Response(JSON.stringify({ expiresInSeconds: 900 }), { status: 200 });
    if (tokenMode === 'hold') await new Promise((r) => { held = r; });
    const event = { httpMethod: init.method, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...NF, ...headers }, body: init.body || '' };
    if (jar) event.headers.cookie = `${readAuth.READ_COOKIE}=${jar}`;
    const res = await tokenHandler(event);
    entry.status = res.statusCode;
    return new Response(res.body, { status: res.statusCode, headers: res.headers });
  }
  if (u === '/.netlify/functions/ghl-write') {
    const body = JSON.parse(init.body);
    const entry = { kind: 'write', id: body.id, at: T, auth: headers.authorization }; log.push(entry);
    const event = { httpMethod: 'POST', headers: { authorization: headers.authorization, origin: ORIGIN, ...NF } };
    try { writeAuth.requireAppWriter(event); } catch { entry.status = 401; return new Response(JSON.stringify({ error: 'Application write sign-in required' }), { status: 401 }); }
    const refusal = await rev.sessionWriteRefusal(event);
    if (refusal) { entry.status = refusal.statusCode; entry.reason = JSON.parse(refusal.body).reason; return new Response(refusal.body, { status: refusal.statusCode }); }
    entry.status = 200; writeStore.push(body.id);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  throw new Error('unexpected request ' + u);
};

const S = require(path.join(APP, 'src/lib/app-write-session.ts'));
let saveN = 0;
/** One operator save: one click = one call. Returns 'sent:<status>' or 'refused:<message>'. Never retries. */
async function save() {
  const id = `save-${++saveN}`;
  try { const r = await S.appWriteFetch('/.netlify/functions/ghl-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { id, out: `sent:${r.status}` }; }
  catch (e) { return { id, out: e instanceof S.AppWriteSignInRequired ? `refused:${e.message}` : `error:${e.message}` }; }
}
const writes = () => log.filter((e) => e.kind === 'write');
const tokens = () => log.filter((e) => e.kind === 'token');
const noDuplicateWrites = () => { const ids = writes().map((w) => w.id); assert.equal(new Set(ids).size, ids.length, 'a save was sent twice: ' + ids.join(',')); };

let checks = 0, failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log('PASS  ' + name); }
  catch (err) { failures += 1; console.log('FAIL  ' + name + ' -- ' + (err && err.message)); }
}
const resetAll = () => { log = []; events.length = 0; blobs.reset(); seedAnchor(); tokenMode = 'real'; writeStore = []; S.clearAppWriteToken(); S.resumeAppWriteAccess(); };

(async () => {
  await check('C0 no BroadcastChannel, localStorage or sessionStorage exists in this process, and the saving module uses none', async () => {
    for (const g of ['BroadcastChannel', 'localStorage', 'sessionStorage', 'indexedDB']) assert.equal(typeof globalThis[g], 'undefined', g);
    const src = fs.readFileSync(path.join(APP, 'src/lib/app-write-session.ts'), 'utf8') + fs.readFileSync(path.join(APP, 'src/components/OneLoginAccess.tsx'), 'utf8');
    assert.ok(!/BroadcastChannel|localStorage|sessionStorage|indexedDB/.test(src));
  });

  // ---------------------------------------------------------------- C1 off
  setFlag(false); resetAll(); signIn(1);
  await check('C1 flag OFF: no write session -> the previous refusal, ZERO requests (no token endpoint is ever called)', async () => {
    const r = await save();
    assert.equal(r.out, 'refused:Sign in for application writes before saving. Your edits have not been submitted.');
    assert.equal(log.length, 0);
  });
  await check('C1b flag OFF: an injected session (the old popup path) is used exactly as before -- Bearer sent, no token request', async () => {
    const legacy = writeAuth.issueAppSession('brad@example.invalid');
    S.setAppWriteSession(legacy);
    await S.appWriteFetch('/.netlify/functions/ghl-write', { method: 'POST', body: JSON.stringify({ id: 'legacy' }) });
    assert.equal(tokens().length, 0); assert.equal(writes()[0].auth, `Bearer ${legacy.token}`);
    S.setAppWriteSession(null);
  });

  // ---------------------------------------------------------------- C2
  setFlag(true); resetAll(); signIn(2);
  await check('C2 flag ON: the first save gets its token automatically from the session and is sent once', async () => {
    const r = await save();
    assert.equal(r.out, 'sent:200'); assert.equal(tokens().length, 1); assert.equal(writes().length, 1);
    assert.equal(S.appWriteIdentity().operator, 'brad@example.invalid');
  });
  await check('C2b three concurrent saves with no usable token share ONE token request; each is sent once', async () => {
    S.clearAppWriteToken(); log = [];
    const rs = await Promise.all([save(), save(), save()]);
    assert.deepEqual(rs.map((r) => r.out), ['sent:200', 'sent:200', 'sent:200']);
    assert.equal(tokens().length, 1); assert.equal(writes().length, 3); noDuplicateWrites();
  });

  // ---------------------------------------------------------------- C3 long call
  resetAll(); signIn(3);
  await check('C3 a 45-minute seller call, a save every 30 s: all 90 sent exactly once with a live token; 4 silent renewals (t=0, 14, 28, 42 min); one identity notification', async () => {
    let notifications = 0; const off = S.subscribeAppWriteSession(() => { notifications += 1; });
    const start = T; const outs = [];
    for (let i = 0; i < 90; i += 1) { outs.push((await save()).out); advance(30_000); }
    off();
    assert.ok(outs.every((o) => o === 'sent:200'), JSON.stringify(outs.filter((o) => o !== 'sent:200')));
    assert.equal(writes().length, 90); noDuplicateWrites();
    assert.deepEqual(tokens().map((t) => (t.at - start) / 60_000), [0, 14, 28, 42]);
    assert.equal(notifications, 1, 'renewal under the same operator is silent');
    assert.ok(writes().every((w) => w.status === 200));
  });

  // ---------------------------------------------------------------- C4 read session expires mid-call
  resetAll();
  await check('C4 the read session expires mid-call: the next save asks for a token, is refused (401) and is NOT sent; the read gate is signalled', async () => {
    signIn(4, T - (8 * 3600_000 - 20 * 60_000));      // 20 minutes of session left
    assert.equal((await save()).out, 'sent:200');       // token minted now; 15 minutes of token life
    advance(12 * 60_000); assert.equal((await save()).out, 'sent:200');
    advance(9 * 60_000);                                // read session ended 1 minute ago; the cached token is past its own life -> renewal is asked
    const before = writes().length;
    const r = await save();
    assert.equal(r.out, `refused:${S.SAVE_SIGN_IN_ENDED_MESSAGE}`);
    assert.equal(writes().length, before, 'nothing sent'); noDuplicateWrites();
    assert.equal(tokens()[tokens().length - 1].status, 401);
    assert.ok(events.includes('iaos-read-session-lost'));
  });
  await check('C4b a cached token minted 2 minutes before the read session ends is refused at the writer after the end (401 session_expired), returned once, not re-sent', async () => {
    resetAll(); signIn(5, T - (8 * 3600_000 - 2 * 60_000));
    assert.equal((await save()).out, 'sent:200');
    advance(3 * 60_000);
    const r = await save();
    assert.equal(r.out, 'sent:401'); const last = writes()[writes().length - 1];
    assert.equal(last.reason, 'session_expired'); noDuplicateWrites();
    assert.ok(events.includes('iaos-read-session-lost'));
    const n = writes().length;
    const again = await save();
    assert.ok(again.out.startsWith('refused:Saving paused: your IAOS sign-in has ended.') && again.out.endsWith('Your edits have not been submitted.'), again.out);
    assert.equal(writes().length, n, 'nothing sent');
  });
  await check('C4c after the read gate clears the token (as OneLoginAccess does at expiry) the next save is refused BEFORE sending', async () => {
    S.clearAppWriteToken(); const n = writes().length;
    const r = await save(); assert.ok(r.out.startsWith('refused:Saving paused:'), r.out); assert.equal(writes().length, n);
  });
  await check('C4d after a fresh sign-in the operator\'s NEXT save is sent once; the earlier refused saves are never sent', async () => {
    signIn(6); const r = await save();
    assert.equal(r.out, 'sent:200'); noDuplicateWrites();
    const refusedIds = writes().filter((w) => w.status !== 200).map((w) => w.id);
    assert.ok(refusedIds.every((id) => !writeStore.includes(id)));
  });

  // ---------------------------------------------------------------- C5 Sign out in another tab
  resetAll(); signIn(7);
  await check('C5 Sign out in ANOTHER tab mid-call (server revocation; no channel exists): the earlier token is refused at the writer (401 revoked), not re-sent; the next save is refused before sending', async () => {
    assert.equal((await save()).out, 'sent:200');
    advance(60_000);
    assert.equal((await rev.recordRevocation(sid(7), 'test', { event: { headers: NF } })).kind, 'verified');   // the other tab's confirmed Sign out
    const r = await save();
    assert.equal(r.out, 'sent:401'); assert.equal(writes()[writes().length - 1].reason, 'revoked');
    const n = writes().length;
    const r2 = await save();
    assert.ok(r2.out.startsWith('refused:Saving paused: your IAOS sign-in has ended.'), r2.out);
    assert.equal(writes().length, n); noDuplicateWrites();
    assert.equal(tokens()[tokens().length - 1].status, 401);
  });

  // ---------------------------------------------------------------- C6 unavailable
  resetAll(); signIn(8);
  await check('C6 store unavailable at token issue -> 503 -> "Saving paused: IAOS can\'t confirm..." before sending; the unavailable event fires; NOT the sign-in event', async () => {
    blobs.rule({ stage: 'blob', method: 'GET', status: 500 });
    const r = await save();
    assert.equal(r.out, `refused:${S.SAVE_UNAVAILABLE_MESSAGE}`); assert.equal(writes().length, 0);
    assert.deepEqual(events, ['iaos-session-unavailable']);
  });
  await check('C6b store unavailable at the WRITE check -> the 503 is returned once and never re-sent; the store recovers -> the next save is sent', async () => {
    events.length = 0; assert.equal((await save()).out, 'sent:200');
    blobs.rule({ stage: 'blob', method: 'GET', status: 503 });
    const r = await save(); assert.equal(r.out, 'sent:503');
    assert.ok(events.includes('iaos-session-unavailable') && !events.includes('iaos-read-session-lost'));
    const r2 = await save(); assert.equal(r2.out, 'sent:200'); noDuplicateWrites();
    assert.equal(writeStore.length, 2);
  });

  // ---------------------------------------------------------------- C7 Sign out on this page
  resetAll(); signIn(9);
  await check('C7 Sign out on THIS page pauses saving at the click with ZERO requests', async () => {
    assert.equal((await save()).out, 'sent:200');
    S.pauseAppWriteForSignOut(); log = [];
    const r = await save();
    assert.equal(r.out, `refused:${S.SAVE_SIGNED_OUT_MESSAGE}`); assert.equal(log.length, 0);
  });
  await check('C7b a token request IN FLIGHT when Sign out is clicked: its token is never used and the save is never sent', async () => {
    S.resumeAppWriteAccess(); S.clearAppWriteToken(); log = []; tokenMode = 'hold';
    const p = save();
    await new Promise((r) => setImmediate(r));
    S.pauseAppWriteForSignOut(); tokenMode = 'real'; held();
    const r = await p;
    assert.ok(r.out.startsWith('refused:Saving paused:'), r.out); assert.equal(writes().length, 0);
  });
  await check('C7c only an explicit sign-in resumes; the next save is sent once', async () => {
    S.resumeAppWriteAccess(); const r = await save(); assert.equal(r.out, 'sent:200'); noDuplicateWrites();
  });

  // ---------------------------------------------------------------- C8 malformed / network
  for (const [label, mode] of [['a network failure', 'network'], ['a lifetime above 900 s', 'bad-lifetime'], ['no token in the answer', 'no-token']]) {
    await check(`C8 ${label} at token issue -> refused before sending, exactly one token request for this save, no retry`, async () => {
      resetAll(); signIn(10); tokenMode = mode;
      const r = await save();
      assert.equal(r.out, `refused:${S.SAVE_UNAVAILABLE_MESSAGE}`); assert.equal(tokens().length, 1); assert.equal(writes().length, 0);
    });
  }

  Date.now = realNow; setFlag(false);
  console.log(`B15-29 one IAOS sign-in (client): ${checks - failures}/${checks} checks passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.log('FAIL  suite aborted -- ' + (e && e.stack)); process.exitCode = 1; });
