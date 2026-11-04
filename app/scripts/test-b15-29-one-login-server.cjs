/**
 * B15-29 (INV-137) one IAOS sign-in -- SERVER side, offline.
 *
 * The REAL handlers (app-read-session, app-write-token, app-signout, app-write-session, every protected reader and
 * writer) and the REAL libraries run against fixture configuration. global.fetch is replaced for the whole run by
 * an in-memory fake of the Netlify Blobs API (scripts/lib/b15-29-fake-blobs.cjs); any other outbound request is
 * recorded and answered 599, and a refusal must make none. The one-IAOS-sign-in switch is turned ON only by
 * mutating the in-memory Test config object in THIS process (committed config stays ONE_LOGIN_DISABLED).
 *
 * Sections:
 *   F  flag-off equivalence (committed config): new endpoints 404, helpers null with zero I/O, status/sign-in/
 *      DELETE/popup unchanged, a revoked sid changes nothing, runtime payload unchanged
 *   M  revocation module: absent / revoked / unavailable never conflated; malformed or foreign records, every
 *      transport fault, deadline, stalled body, abort-ignoring transport, late 404; verified revoke only after
 *      readback; provider false success; applied-but-acknowledgement-lost; idempotent repeat; single attempt
 *   T  token mint: every refusal reason, cross-site/origin, environment, allowlist, sid-less session, revoked,
 *      store unreadable/unconfigured -> 503 not 401; success claims (900 s, env, sid)
 *   S  status + sign-in + sign-out: handle, acknowledged revoke, no Set-Cookie anywhere, DELETE retired, popup
 *      issuer retired, handle authority (negative tests at every credential entry point), fixed target
 *   X  multi-tab: tab B (same cookie) after tab A's Sign out -- token, writes with an EARLIER token (Variant S),
 *      reads and status all refuse; no browser channel exists in this process at all
 *   I  inventory: every reader / writer carries the check after its unchanged auth statements; behaviour of each
 *      under revoked / unavailable; retired send endpoints listed
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
// The PINNED Test revocation site (public Netlify site id of iaos-app-test); Production's pinned id for mismatch cases.
const SITE = '07ca1f1a-60fd-4229-a076-528970957912';
const PROD_SITE = '19fcbf6a-7c3c-40e3-af20-bd077f0f8ec8';
const BLOB_TOKEN = 'fixture-blob-token-not-real';
const BASE_ENV = {
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid,reader-only@example.invalid',
  IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
  IAOS_SESSION_REVOCATION_SITE_ID: SITE,
  IAOS_SESSION_REVOCATION_TOKEN: BLOB_TOKEN,
  GHL_PRIVATE_API_KEY: 'offline-fixture',
};
const MANAGED = [...Object.keys(BASE_ENV), 'IAOS_ENV', 'IAOS_VOICE_SESSION_SECRET'];
function setEnv(deployment, overrides = {}) {
  for (const k of MANAGED) delete process.env[k];
  Object.assign(process.env, BASE_ENV, { IAOS_ENV: deployment }, overrides);
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
}
setEnv('test');

// ---- outbound: the fake Blob API; everything else is recorded and refused ----
let now = null; // null = real clock
const clock = () => (now === null ? Date.now() : now);
const blobs = createFakeBlobs({ siteID: SITE, token: BLOB_TOKEN });
let other = [];
// Every request for the authority anchor key that is not a read, across the WHOLE run (no code path may write it).
const anchorWrites = [];
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.netlify.com/') && decodeURIComponent(u).includes('session-revocation/_authority') && String(init.method || 'GET').toUpperCase() !== 'GET') anchorWrites.push(String(init.method));
  if (u.startsWith('https://api.netlify.com/') || u.startsWith('https://signed.blobs.invalid/')) return blobs.fetch(url, init);
  other.push({ url: u, method: init.method || 'GET' });
  if (other.length > 400) throw new Error('runaway outbound');
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    return new Response(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'offline-read-client', email: 'brad@example.invalid', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) }), { status: 200 });
  }
  return new Response(JSON.stringify({ fixture: 'not modelled' }), { status: 599 });
};

const cfg = require(path.join(APP, 'shared/ghl-config.ts'));
const readAuth = require(path.join(FUNCTIONS, 'lib/app-read-auth.ts'));
const writeAuth = require(path.join(FUNCTIONS, 'lib/app-write-auth.ts'));
const rev = require(path.join(FUNCTIONS, 'lib/session-revocation.ts'));
const blobAuthority = require(path.join(FUNCTIONS, 'lib/blob-authority.ts'));
// This suite's subject is not the read budget; pin it OFF (as test-app-read-auth does).
cfg.getConfig('test').supplementalReadBudget = { enabled: cfg.SUPPLEMENTAL_READ_BUDGET_DISABLED, budgetId: 'offline-disabled', ceiling: 0 };
const flag = (on, env = 'test') => { cfg.getConfig(env).oneLogin = on ? cfg.ONE_LOGIN_ENABLED : cfg.ONE_LOGIN_DISABLED; };
function load(name) {
  for (const key of Object.keys(require.cache)) if (key.startsWith(FUNCTIONS + path.sep) && !key.includes(`${path.sep}lib${path.sep}`)) delete require.cache[key];
  return require(path.join(FUNCTIONS, name + '.ts')).handler;
}

let checks = 0, failures = 0;
const results = [];
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log('PASS  ' + name); results.push([name, true]); }
  catch (err) { failures += 1; console.log('FAIL  ' + name + ' -- ' + (err && err.message)); results.push([name, false]); }
}

// ---- fixtures -----------------------------------------------------------------
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const sid = (n) => Buffer.alloc(16, n).toString('base64url');
// The authority anchor's epoch (operator-provisioned; opaque 16-64 chars) and a rotated one (after a restore).
const EPOCH = 'fixture-epoch-0001';
const EPOCH2 = 'fixture-epoch-0002-rotated';
const ANCHOR_KEY = 'session-revocation/_authority';
const anchorText = ({ env = 'test', siteID = SITE, epoch = EPOCH, v = 1, kind = 'iaos-session-revocation-authority', extra = {} } = {}) =>
  JSON.stringify(Object.fromEntries(Object.entries({ env, epoch, kind, siteID, v, ...extra }).sort()));
const seedAnchor = (o) => blobs.put('iaos-write-receipts', ANCHOR_KEY, typeof o === 'string' ? o : anchorText(o));
const dropAnchor = () => blobs.remove('iaos-write-receipts', ANCHOR_KEY);
const readCookie = ({ email = 'brad@example.invalid', at = Date.now(), s = sid(1), deployment = 'test', withSid = true, epoch = EPOCH } = {}) => {
  const env = { ...process.env, IAOS_ENV: deployment };
  return readAuth.issueReadSession(email, readAuth.appReadConfig(env), at, withSid ? s : undefined, withSid && epoch ? epoch : undefined).token;
};
const bound = (s, { pexp = FUTURE, epoch = EPOCH, env = 'test' } = {}) => writeAuth.issueBoundAppSession('brad@example.invalid', { env, sid: s, pexp, epoch }).token;
const NF = { headers: { 'x-nf-site-id': SITE } };   // the platform's runtime site header, as a minimal event
const cookieHeader = (token) => `${readAuth.READ_COOKIE}=${token}`;
function ev({ method = 'POST', cookie = null, headers = {}, body = '', bearer = null, multi, query } = {}) {
  const h = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE, ...headers };
  if (cookie) h.cookie = cookieHeader(cookie);
  if (bearer) h.authorization = `Bearer ${bearer}`;
  for (const [k, v] of Object.entries(h)) if (v === undefined) delete h[k];
  return { httpMethod: method, headers: h, body, ...(multi ? { multiValueHeaders: multi } : {}), ...(query ? { queryStringParameters: query } : {}) };
}
const tokenEv = (cookie, extra = {}) => ev({ cookie, ...extra, headers: { 'x-iaos-session': 'saving-token', ...(extra.headers || {}) } });
const parse = (res) => { try { return JSON.parse(res.body); } catch { return null; } };
const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
function noCredentialLeak(res) {
  const b = parse(res) || {};
  assert.equal(b.token, undefined, 'no token in a refusal');
  assert.ok(!/eyJ/.test(res.body), 'no token-shaped value in the body');
  assert.equal((res.headers || {})['Set-Cookie'], undefined, 'no Set-Cookie');
  assert.equal((res.headers || {})['Cache-Control'], 'no-store');
}
const RECORD = (deployment, s) => {
  const key = rev.revocationKey(deployment, s);
  return { key, text: JSON.stringify(Object.fromEntries(Object.entries({ env: deployment, kind: 'iaos-session-revocation', revokedAt: '2026-11-03T00:00:00.000Z', schema: 1, sidDigest: key.slice('session-revocation/'.length) }).sort())) };
};
const seedRevoked = (deployment, s) => { const r = RECORD(deployment, s); blobs.put('iaos-write-receipts', r.key, r.text); };
const reset = () => { blobs.reset(); seedAnchor(); other = []; now = null; setEnv('test'); };
const keysOf = (kind) => blobs.log.filter((e) => (e.key === ANCHOR_KEY) === (kind === 'anchor')).map((e) => `${e.stage}:${e.method}`);
const blobCount = () => blobs.log.length;
const marker = (res) => (parse(res) || {}).by;

(async () => {
  // =========================================================================== F
  reset(); flag(false); flag(false, 'production');
  await check('F1 committed config: BOTH environments carry ONE_LOGIN_DISABLED; the predicate is false for test, production and anything else', async () => {
    assert.equal(cfg.getConfig('test').oneLogin, cfg.ONE_LOGIN_DISABLED);
    assert.equal(cfg.getConfig('production').oneLogin, cfg.ONE_LOGIN_DISABLED);
    for (const e of ['test', 'production', undefined, '', 'staging', 'TEST']) assert.equal(cfg.oneLoginActiveFor(e), false, String(e));
    const src = fs.readFileSync(path.join(APP, 'shared/ghl-config.ts'), 'utf8');
    assert.equal((src.match(/^\s*oneLogin: ONE_LOGIN_DISABLED,$/mg) || []).length, 2, 'exactly two committed values, both DISABLED');
    assert.ok(!/^\s*oneLogin: ONE_LOGIN_ENABLED/m.test(src), 'no committed ENABLED value');
  });
  await check('F2 off: app-write-token and app-signout answer 404 before anything, with zero outbound requests', async () => {
    const t = await load('app-write-token')(tokenEv(readCookie()));
    const s = await load('app-signout')(ev({ body: '{"handle":"x"}', headers: { 'x-iaos-session': 'sign-out' } }));
    assert.equal(t.statusCode, 404); assert.equal(s.statusCode, 404);
    assert.equal(blobCount() + other.length, 0);
  });
  await check('F3 off: the reader/writer helpers return null with ZERO I/O, even for a sid whose revocation record exists', async () => {
    seedRevoked('test', sid(1)); const before = blobCount();
    const tok = bound(sid(1));
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: readCookie() })), null);
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: tok })), null);
    assert.equal(blobCount() - before, 0); assert.equal(other.length, 0);
  });
  await check('F4 off: app-read-session GET/POST/DELETE answer exactly as before (no state/handle; sid-less cookie; DELETE clears the cookie)', async () => {
    const h = load('app-read-session');
    const g = await h(ev({ method: 'GET', cookie: readCookie({ withSid: false }) }));
    assert.equal(g.statusCode, 200); assert.deepEqual(Object.keys(parse(g)).sort(), ['clientId', 'expiresAt', 'signedIn']); assert.equal(parse(g).signedIn, true);
    const p = await h(ev({ body: JSON.stringify({ googleIdToken: 'fixture-google-token' }) }));
    assert.equal(p.statusCode, 200);
    const issued = /__Host-iaos_read=([^;]+)/.exec(p.headers['Set-Cookie'])[1];
    assert.equal(decode(issued).sid, undefined, 'off: no sid claim -- the token is the previous shape');
    assert.deepEqual(Object.keys(decode(issued)), ['iss', 'aud', 'env', 'sub', 'iat', 'exp']);
    const d = await h(ev({ method: 'DELETE' }));
    assert.equal(d.statusCode, 200); assert.equal(d.headers['Set-Cookie'], '__Host-iaos_read=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    assert.equal(blobCount(), 0, 'no Blob request at all while off');
  });
  await check('F5 off: the old Google popup issuer (app-write-session) still answers its GET', async () => {
    const r = await load('app-write-session')({ httpMethod: 'GET', headers: {} });
    assert.equal(r.statusCode, 200); assert.deepEqual(parse(r), { clientId: 'offline-write-client' });
  });
  await check('F6 off: the runtime payload is byte-for-byte the previous formula (no oneLogin key) for both environments', async () => {
    const rc = require(path.join(FUNCTIONS, 'iaos-runtime-config.ts'));
    const { repairApprovalActiveFor } = require(path.join(APP, 'shared/repair-approval-config.ts'));
    for (const e of ['test', 'production']) {
      const previous = { ...cfg.projectRuntimeConfig(cfg.getConfig(e), e), repairApproval: { active: repairApprovalActiveFor(e) } };
      assert.equal(JSON.stringify(rc.runtimePayload(e)), JSON.stringify(previous), e);
    }
  });
  await check('F7 off: a reader with a sid-less (pre-feature) cookie is not refused by the new check', async () => {
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: readCookie({ withSid: false }) })), null);
  });

  // =========================================================================== M
  reset(); flag(true);
  const ck = (s = sid(2), o = {}) => rev.checkRevocation(s, 'test', { event: NF, epoch: EPOCH, ...o });
  await check('M1 the store name equals blob-authority AUTHORITY_STORE (existing store; no new store)', async () => {
    assert.equal(rev.REVOCATION_STORE, blobAuthority.AUTHORITY_STORE);
  });
  await check('M2 absent: one sign + one GET for the sid record (and one each for the anchor), 404 -> absent; key under session-revocation/, env- and sid-bound', async () => {
    const r = await ck();
    assert.deepEqual(r, { kind: 'absent' });
    assert.deepEqual(keysOf('sid'), ['sign:GET', 'blob:GET']);
    assert.deepEqual(keysOf('anchor'), ['sign:GET', 'blob:GET']);
    assert.equal(blobs.log.filter((e) => e.key !== ANCHOR_KEY)[0].key, rev.revocationKey('test', sid(2)));
    assert.notEqual(rev.revocationKey('test', sid(2)), rev.revocationKey('production', sid(2)));
    assert.ok(blobs.log[0].auth && blobs.log[0].site === SITE && blobs.log[0].storeName === 'site:iaos-write-receipts');
  });
  await check('M3 revoked: a valid record -> revoked', async () => { reset(); seedRevoked('test', sid(2)); assert.deepEqual(await ck(), { kind: 'revoked' }); });
  for (const [label, text] of [
    ['malformed JSON', '{not json'],
    ['non-canonical key order', JSON.stringify({ schema: 1, kind: 'iaos-session-revocation', env: 'test', sidDigest: RECORD('test', sid(2)).key.slice(19), revokedAt: '2026-11-03T00:00:00.000Z' })],
    ['foreign env record at this key', RECORD('production', sid(2)).text],
    ['another sid record at this key', RECORD('test', sid(3)).text],
    ['extra field', RECORD('test', sid(2)).text.replace('{', '{"a":1,')],
    ['empty value', ''],
  ]) {
    await check(`M4 a ${label} -> unavailable (never revoked, never absent)`, async () => {
      reset(); blobs.put('iaos-write-receipts', rev.revocationKey('test', sid(2)), text);
      const r = await ck(); assert.equal(r.kind, 'unavailable', JSON.stringify(r));
    });
  }
  for (const [label, rule] of [
    ['sign 500', { stage: 'sign', status: 500 }], ['sign 401', { stage: 'sign', status: 401 }], ['sign transport error', { stage: 'sign', throw: true }],
    ['blob 500', { stage: 'blob', method: 'GET', status: 500 }], ['blob 503', { stage: 'blob', method: 'GET', status: 503 }],
    ['blob 429', { stage: 'blob', method: 'GET', status: 429 }], ['blob 403', { stage: 'blob', method: 'GET', status: 403 }],
    ['blob 401', { stage: 'blob', method: 'GET', status: 401 }], ['blob transport error', { stage: 'blob', method: 'GET', throw: true }],
  ]) {
    await check(`M5 ${label} -> unavailable, exactly one attempt per stage (no SDK retry sent)`, async () => {
      reset(); blobs.rule({ ...rule, key: rev.revocationKey('test', sid(2)) });
      const r = await ck(); assert.equal(r.kind, 'unavailable', JSON.stringify(r));
      for (const kind of ['sid', 'anchor']) {
        const l = blobs.log.filter((e) => (e.key === ANCHOR_KEY) === (kind === 'anchor'));
        assert.ok(l.filter((e) => e.stage === 'sign').length <= 1 && l.filter((e) => e.stage === 'blob').length <= 1, kind + ' ' + JSON.stringify(blobs.log));
      }
    });
  }
  await check('M6 not configured (no site id / token) -> unavailable with zero requests', async () => {
    reset(); setEnv('test', { IAOS_SESSION_REVOCATION_TOKEN: undefined });
    assert.deepEqual(await ck(), { kind: 'unavailable', reason: 'not_configured' }); assert.equal(blobCount(), 0);
    setEnv('test', { IAOS_SESSION_REVOCATION_SITE_ID: ' ' });
    assert.deepEqual(await ck(), { kind: 'unavailable', reason: 'not_configured' }); assert.equal(blobCount(), 0);
  });
  await check('M7 malformed sid or env -> unavailable with zero requests', async () => {
    reset();
    for (const [s, e] of [['short', 'test'], [sid(2) + 'A', 'test'], [sid(2), 'staging'], [sid(2).replace(/.$/, '='), 'test']]) {
      assert.equal((await rev.checkRevocation(s, e, { event: NF, epoch: EPOCH })).kind, 'unavailable');
    }
    assert.equal(blobCount(), 0);
  });
  await check('M8 a hung GET (abort honoured) -> unavailable at the deadline', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'GET', hang: true });
    const t0 = Date.now(); const r = await ck(sid(2), { budgetMs: 600 });
    assert.equal(r.kind, 'unavailable'); assert.ok(Date.now() - t0 < 1500, `bounded: ${Date.now() - t0} ms`);
  });
  await check('M9 an abort-IGNORING transport -> the caller still returns unavailable at the deadline (late result discarded)', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'GET', hang: true, ignoreAbort: true });
    const t0 = Date.now(); const r = await ck(sid(2), { budgetMs: 600 });
    assert.equal(r.kind, 'unavailable'); assert.ok(Date.now() - t0 < 1500, `bounded: ${Date.now() - t0} ms`);
  });
  await check('M10 a stalled body after 200 headers -> unavailable at the deadline', async () => {
    reset(); seedRevoked('test', sid(2)); blobs.rule({ stage: 'blob', method: 'GET', stallBody: true });
    const t0 = Date.now(); const r = await ck(sid(2), { budgetMs: 600 });
    assert.equal(r.kind, 'unavailable'); assert.ok(Date.now() - t0 < 1500);
  });
  await check('M11 a LATE 404 (answered after the deadline) is NOT absent -> unavailable', async () => {
    reset(); let t = 1_000_000;
    const lateFetch = async (u, i) => { const res = await blobs.fetch(u, i); if (String(u).startsWith('https://signed.')) t += 5_000; return res; };
    const r = await rev.checkRevocation(sid(2), 'test', { event: NF, epoch: EPOCH, fetch: lateFetch, now: () => t, budgetMs: 3000 });
    assert.equal(r.kind, 'unavailable', JSON.stringify(r));
  });
  await check('M12 no request is started with less than the minimum start time left (deadline already spent)', async () => {
    reset(); const r = await ck(sid(2), { budgetMs: 100 });
    assert.equal(r.kind, 'unavailable'); assert.equal(blobCount(), 0);
  });
  const rr = (s = sid(4), o = {}) => rev.recordRevocation(s, 'test', { event: NF, ...o });
  await check('M13 revoke: conditional create (If-None-Match: *) + strong readback -> verified; a canonical record is stored; the anchor is only READ', async () => {
    reset(); const r = await rr();
    assert.deepEqual(r, { kind: 'verified' });
    assert.deepEqual(keysOf('sid'), ['sign:PUT', 'blob:PUT', 'sign:GET', 'blob:GET']);
    assert.deepEqual(keysOf('anchor'), ['sign:GET', 'blob:GET']);
    assert.equal(blobs.log.find((e) => e.stage === 'blob' && e.method === 'PUT').ifNoneMatch, '*'); assert.deepEqual(blobs.violations, []);
    const stored = blobs.get('iaos-write-receipts', rev.revocationKey('test', sid(4)));
    assert.ok(rev.validRevocationText(stored.text, 'test', sid(4)));
    assert.deepEqual(await ck(sid(4)), { kind: 'revoked' });
  });
  await check('M14 repeat revoke of the same sid: 412 then a valid readback -> verified (idempotent), record unchanged', async () => {
    const before = blobs.get('iaos-write-receipts', rev.revocationKey('test', sid(4))).text;
    blobs.log.length = 0; const r = await rr();
    assert.deepEqual(r, { kind: 'verified' });
    assert.equal(blobs.get('iaos-write-receipts', rev.revocationKey('test', sid(4))).text, before);
  });
  await check('M15 provider FALSE SUCCESS (PUT 200, nothing stored) -> NOT confirmed (the readback decides, never the write)', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'PUT', lie: true });
    const r = await rr(); assert.equal(r.kind, 'unconfirmed', JSON.stringify(r));
    assert.deepEqual(await ck(sid(4)), { kind: 'absent' });
  });
  await check('M16 applied but acknowledgement lost (PUT applied, then transport error) -> verified by readback', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'PUT', throw: true, apply: true });
    assert.deepEqual(await rr(), { kind: 'verified' });
  });
  await check('M17 PUT 500 not applied -> not confirmed; PUT 500 applied -> verified', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'PUT', status: 500 });
    assert.equal((await rr()).kind, 'unconfirmed');
    reset(); blobs.rule({ stage: 'blob', method: 'PUT', status: 500, apply: true });
    assert.deepEqual(await rr(), { kind: 'verified' });
  });
  await check('M18 readback unreadable after a committed write -> not confirmed (never "signed out" without a verified read)', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'GET', status: 503, key: rev.revocationKey('test', sid(4)) });
    assert.equal((await rr()).kind, 'unconfirmed');
    assert.deepEqual(await ck(sid(4)), { kind: 'revoked' }, 'the revocation did commit: conservative for the SAME sid');
  });
  await check('M19 a hung PUT -> not confirmed, bounded', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'PUT', hang: true, ignoreAbort: true });
    const t0 = Date.now(); const r = await rr(sid(4), { budgetMs: 700 });
    assert.equal(r.kind, 'unconfirmed'); assert.ok(Date.now() - t0 < 1700);
  });
  await check('M20 revoke not configured -> not confirmed with zero requests', async () => {
    reset(); setEnv('test', { IAOS_SESSION_REVOCATION_SITE_ID: undefined });
    assert.deepEqual(await rr(), { kind: 'unconfirmed', reason: 'not_configured' }); assert.equal(blobCount(), 0);
  });
  await check('M21 a readback answered after the deadline -> not confirmed', async () => {
    reset(); let t = 2_000_000;
    const lateFetch = async (u, i) => { const res = await blobs.fetch(u, i); if (String(u).startsWith('https://signed.') && String(i.method || 'GET').toUpperCase() === 'GET') t += 9_000; return res; };
    assert.equal((await rev.recordRevocation(sid(4), 'test', { event: NF, fetch: lateFetch, now: () => t })).kind, 'unconfirmed');
  });

  // =========================================================================== T
  reset(); flag(true);
  const mint = (e) => load('app-write-token')(e);
  await check('T1 success: same-origin POST, valid session with sid -> the unchanged 900 s token plus env + sid claims; accepted by the unchanged requireAppWriter', async () => {
    const c = readCookie({ s: sid(5) });
    const res = await mint(tokenEv(c));
    assert.equal(res.statusCode, 200, res.body);
    const b = parse(res);
    assert.deepEqual(Object.keys(b).sort(), ['expiresAt', 'expiresInSeconds', 'token']);
    assert.ok(b.expiresInSeconds === 900 || b.expiresInSeconds === 899);
    const claims = decode(b.token);
    assert.equal(claims.aud, 'iaos-app-write'); assert.equal(claims.sub, 'brad@example.invalid');
    assert.equal(claims.exp - claims.iat, 900, 'lifetime unchanged'); assert.equal(claims.env, 'test'); assert.equal(claims.sid, sid(5));
    assert.equal(claims.pexp, decode(c).exp, 'bound to the parent session expiry');
    assert.equal(writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${b.token}` } }), 'brad@example.invalid');
    assert.equal(res.headers['Set-Cookie'], undefined); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(keysOf('sid'), ['sign:GET', 'blob:GET'], 'one strong read of the sid record per issue');
    assert.deepEqual(keysOf('anchor'), ['sign:GET', 'blob:GET'], 'one strong read of the anchor per issue');
    assert.equal(claims.epoch, EPOCH, 'the token carries the session epoch');
    assert.equal(other.length, 0);
  });
  const refusals = [
    ['T2 GET -> 405', () => tokenEv(readCookie(), { method: 'GET' }), 405],
    ['T3 no Origin -> 403', () => tokenEv(readCookie(), { headers: { origin: undefined } }), 403],
    ['T4 a foreign Origin -> 403 (cross-origin mint refused)', () => tokenEv(readCookie(), { headers: { origin: 'https://evil.example.invalid' } }), 403],
    ['T5 a lookalike Origin -> 403', () => tokenEv(readCookie(), { headers: { origin: ORIGIN + '.evil.invalid' } }), 403],
    ['T6 two Origins (multiValueHeaders) -> 403', () => tokenEv(readCookie(), { multi: { origin: [ORIGIN, 'https://evil.example.invalid'] } }), 403],
    ['T7 Sec-Fetch-Site cross-site -> 403', () => tokenEv(readCookie(), { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    ['T8 Sec-Fetch-Site same-site -> 403', () => tokenEv(readCookie(), { headers: { 'sec-fetch-site': 'same-site' } }), 403],
    ['T9 no X-IAOS-Session header -> 403', () => ev({ cookie: readCookie() }), 403],
    ['T10 X-IAOS-Session with the sign-out value -> 403', () => tokenEv(readCookie(), { headers: { 'x-iaos-session': 'sign-out' } }), 403],
    ['T11 a request body -> 403', () => tokenEv(readCookie(), { body: '{}' }), 403],
    ['T12 no session cookie -> 401 (Origin alone never authorizes)', () => tokenEv(null), 401],
    ['T13 an expired session -> 401', () => tokenEv(readCookie({ at: Date.now() - readAuth.READ_SESSION_SECONDS * 1000 - 1000 })), 401],
    ['T14 a tampered session -> 401', () => { const [h, p, s] = readCookie().split('.'); const c = JSON.parse(Buffer.from(p, 'base64url')); c.sid = sid(9); return tokenEv([h, Buffer.from(JSON.stringify(c)).toString('base64url'), s].join('.')); }, 401],
    ['T15 a Production session presented to Test -> 401 (environment separation)', () => tokenEv(readCookie({ deployment: 'production' })), 401],
    ['T16 a session WITHOUT sid (issued before one sign-in) -> 401 sign_in_again', () => tokenEv(readCookie({ withSid: false })), 401],
    ['T17 a reader NOT on the saving allowlist -> 401', () => tokenEv(readCookie({ email: 'reader-only@example.invalid' })), 401],
    ['T18 a saving token presented as the cookie -> 401', () => tokenEv(bound(sid(1))), 401],
    ['T16b a session with a sid but WITHOUT an authority epoch -> 401 sign_in_again', () => tokenEv(readCookie({ epoch: null })), 401],
  ];
  for (const [name, make, status] of refusals) {
    await check(name + '; no token, no cookie, no-store', async () => {
      reset(); const res = await mint(make());
      assert.equal(res.statusCode, status, res.body); noCredentialLeak(res);
      if (status !== 401 || /T1[2-8]/.test(name)) assert.equal(blobCount(), 0, 'refused before the revocation read');
      if (name.startsWith('T16')) assert.equal(parse(res).reason, 'sign_in_again', name);
    });
  }
  await check('T19 revoked sid -> 401 reason "revoked" (never a token)', async () => {
    reset(); seedRevoked('test', sid(5)); const res = await mint(tokenEv(readCookie({ s: sid(5) })));
    assert.equal(res.statusCode, 401); assert.equal(parse(res).reason, 'revoked'); noCredentialLeak(res);
  });
  for (const [label, setup] of [
    ['store unreadable (blob 500)', () => blobs.rule({ stage: 'blob', method: 'GET', status: 500 })],
    ['store sign refused (401)', () => blobs.rule({ stage: 'sign', status: 401 })],
    ['store not configured', () => setEnv('test', { IAOS_SESSION_REVOCATION_TOKEN: undefined })],
    ['malformed record', () => blobs.put('iaos-write-receipts', rev.revocationKey('test', sid(5)), 'garbage')],
    ['store hangs past the deadline', () => blobs.rule({ stage: 'blob', method: 'GET', hang: true, ignoreAbort: true })],
  ]) {
    await check(`T20 ${label} -> 503 iaos-session-unavailable (fail closed; NOT 401, NOT a token)`, async () => {
      reset(); setup(); const res = await mint(tokenEv(readCookie({ s: sid(5) })));
      assert.equal(res.statusCode, 503, res.body); assert.equal(marker(res), 'iaos-session-unavailable'); noCredentialLeak(res);
    });
  }
  await check('T21 write configuration missing -> 503 unconfigured, nothing read', async () => {
    reset(); setEnv('test', { IAOS_APP_WRITE_SESSION_SECRET: undefined });
    const res = await mint(tokenEv(readCookie())); assert.equal(res.statusCode, 503); assert.equal(blobCount(), 0); noCredentialLeak(res);
  });
  await check('T22 a Test-issued token is not accepted by Production writers (env claim + per-env secret)', async () => {
    reset(); flag(true, 'production');
    const t = parse(await mint(tokenEv(readCookie({ s: sid(6) })))).token;
    setEnv('production');
    const r = await rev.sessionWriteRefusal(ev({ bearer: t }));
    assert.equal(r.statusCode, 401);
    setEnv('production', { IAOS_APP_WRITE_SESSION_SECRET: BASE_ENV.IAOS_APP_WRITE_SESSION_SECRET });
    flag(false, 'production'); setEnv('test');
  });

  // =========================================================================== S
  reset(); flag(true);
  const status = (c) => load('app-read-session')(ev({ method: 'GET', cookie: c }));
  const signOutEv = (handle, extra = {}) => ev({ body: JSON.stringify({ handle }), ...extra, headers: { 'x-iaos-session': 'sign-out', ...(extra.headers || {}) } });
  const signOut = (e) => load('app-signout')(e);
  await check('S1 status: signed in -> 200 {clientId, signedIn, expiresAt, state:"signed_in", handle}; handle is revoke-only (aud iaos-app-signout, exact claims, exp = parent exp + 24 h)', async () => {
    const c = readCookie({ s: sid(7) }); const r = await status(c); const b = parse(r);
    assert.equal(r.statusCode, 200); assert.deepEqual(Object.keys(b).sort(), ['clientId', 'expiresAt', 'handle', 'signedIn', 'state']);
    assert.equal(b.state, 'signed_in'); assert.equal(b.signedIn, true);
    const h = decode(b.handle);
    assert.deepEqual(Object.keys(h).sort(), ['aud', 'env', 'exp', 'iat', 'iss', 'sid']);
    assert.equal(h.aud, 'iaos-app-signout'); assert.equal(h.sid, sid(7)); assert.equal(h.env, 'test');
    assert.equal(h.exp, decode(c).exp + 24 * 3600);
    assert.equal(r.headers['Set-Cookie'], undefined); assert.equal(r.headers['Cache-Control'], 'no-store');
  });
  await check('S2 status: no cookie / sid-less cookie -> 200 signed_out with clientId (sign-in landing still works)', async () => {
    for (const c of [null, readCookie({ withSid: false })]) {
      const b = parse(await status(c)); assert.equal(b.state, 'signed_out'); assert.equal(b.signedIn, false); assert.equal(b.clientId, 'offline-read-client');
    }
  });
  await check('S3 status: store unavailable -> 503 {state:"unavailable"} WITHOUT a signedIn field (C1: never signed in, never signed out)', async () => {
    reset(); blobs.rule({ stage: 'blob', method: 'GET', status: 500 });
    const r = await status(readCookie({ s: sid(7) })); const b = parse(r);
    assert.equal(r.statusCode, 503); assert.equal(b.state, 'unavailable'); assert.equal(b.by, 'iaos-session-unavailable');
    assert.ok(!('signedIn' in b) && !('handle' in b)); assert.equal(b.clientId, 'offline-read-client');
  });
  await check('S4 POST sign-in -> a cookie whose session carries a fresh canonical 128-bit sid; two sign-ins get different sids', async () => {
    reset(); const h = load('app-read-session');
    const a = await h(ev({ body: JSON.stringify({ googleIdToken: 'g1' }) }));
    const b = await h(ev({ body: JSON.stringify({ googleIdToken: 'g2' }) }));
    const sa = decode(/__Host-iaos_read=([^;]+)/.exec(a.headers['Set-Cookie'])[1]).sid;
    const sb = decode(/__Host-iaos_read=([^;]+)/.exec(b.headers['Set-Cookie'])[1]).sid;
    assert.ok(readAuth.isCanonicalSid(sa) && readAuth.isCanonicalSid(sb) && sa !== sb);
    assert.equal(decode(/__Host-iaos_read=([^;]+)/.exec(a.headers['Set-Cookie'])[1]).epoch, EPOCH, 'bound to the anchor epoch at sign-in');
    assert.match(a.headers['Set-Cookie'], /; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict$/);
  });
  await check('S5 DELETE is retired: 410, NO Set-Cookie (a delayed sign-out can never erase a newer sign-in)', async () => {
    const r = await load('app-read-session')(ev({ method: 'DELETE', cookie: readCookie() }));
    assert.equal(r.statusCode, 410); assert.equal(r.headers['Set-Cookie'], undefined);
  });
  await check('S6 the old popup issuer is retired server-side: 410 for GET and POST, no token', async () => {
    other = []; const h = load('app-write-session');
    for (const m of ['GET', 'POST']) { const r = await h({ httpMethod: m, headers: {}, body: JSON.stringify({ googleIdToken: 'g' }) }); assert.equal(r.statusCode, 410); noCredentialLeak(r); }
    assert.equal(other.filter((o) => o.url.includes('tokeninfo')).length, 0, 'no Google verification attempted');
  });
  await check('S7 Sign out: 200 {state:"revoked"} ONLY after a verified revocation; no Set-Cookie; then status says revoked and grants nothing', async () => {
    reset(); const c = readCookie({ s: sid(8) }); const handle = parse(await status(c)).handle;
    blobs.log.length = 0;
    const r = await signOut(signOutEv(handle));
    assert.equal(r.statusCode, 200, r.body); assert.deepEqual(parse(r), { state: 'revoked' }); assert.equal(r.headers['Set-Cookie'], undefined);
    assert.deepEqual(keysOf('sid'), ['sign:PUT', 'blob:PUT', 'sign:GET', 'blob:GET']);
    assert.deepEqual(keysOf('anchor'), ['sign:GET', 'blob:GET']);
    const s = parse(await status(c)); assert.equal(s.state, 'revoked'); assert.equal(s.signedIn, false); assert.equal(s.handle, undefined);
  });
  await check('S8 Sign out again with the same handle: idempotent 200', async () => {
    const c = readCookie({ s: sid(8) });
    const handle = rev.issueSignoutHandle({ sid: sid(8), expiresAt: new Date((decode(c).exp) * 1000).toISOString() }, readAuth.appReadConfig());
    assert.equal((await signOut(signOutEv(handle))).statusCode, 200);
  });
  for (const [label, setup] of [
    ['the store write is a provider false success', () => blobs.rule({ stage: 'blob', method: 'PUT', lie: true })],
    ['the store is unreadable for the readback', () => blobs.rule({ stage: 'blob', method: 'GET', status: 500 })],
    ['the store is not configured', () => setEnv('test', { IAOS_SESSION_REVOCATION_TOKEN: undefined })],
    ['the sign request fails', () => blobs.rule({ stage: 'sign', status: 500 })],
  ]) {
    await check(`S9 Sign out when ${label} -> 503 {state:"not_confirmed"}, never "revoked", no Set-Cookie`, async () => {
      reset(); const c = readCookie({ s: sid(10) }); const handle = parse(await status(c)).handle;
      setup(); const r = await signOut(signOutEv(handle));
      assert.equal(r.statusCode, 503, r.body); assert.equal(parse(r).state, 'not_confirmed'); assert.equal(r.headers['Set-Cookie'], undefined);
    });
  }
  const goodHandle = () => rev.issueSignoutHandle({ sid: sid(11), expiresAt: new Date(Date.now() + 3600_000).toISOString() }, readAuth.appReadConfig());
  const handleRefusals = [
    ['no body', () => ev({ headers: { 'x-iaos-session': 'sign-out' } }), 400],
    ['extra body key', () => ev({ body: JSON.stringify({ handle: goodHandle(), sid: sid(11) }), headers: { 'x-iaos-session': 'sign-out' } }), 400],
    ['a raw sid instead of a handle', () => signOutEv(sid(11)), 400],
    ['an expired handle (never confirmed, no current-cookie fallback)', () => signOutEv(rev.issueSignoutHandle({ sid: sid(11), expiresAt: new Date(Date.now() - 25 * 3600_000).toISOString() }, readAuth.appReadConfig()), { cookie: readCookie({ s: sid(11) }) }), 400],
    ['a Production handle in Test', () => signOutEv(rev.issueSignoutHandle({ sid: sid(11), expiresAt: new Date(Date.now() + 3600_000).toISOString() }, readAuth.appReadConfig({ ...process.env, IAOS_ENV: 'production' }))), 400],
    ['a tampered handle (sid swapped)', () => { const [h, p, s] = goodHandle().split('.'); const c = JSON.parse(Buffer.from(p, 'base64url')); c.sid = sid(12); return signOutEv([h, Buffer.from(JSON.stringify(c)).toString('base64url'), s].join('.')); }, 400],
    ['a handle with alg none', () => { const [, p] = goodHandle().split('.'); return signOutEv(`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`); }, 400],
    ['the READ session token as a handle', () => signOutEv(readCookie({ s: sid(11) })), 400],
    ['a SAVING token as a handle', () => signOutEv(bound(sid(11))), 400],
    ['a foreign Origin', () => signOutEv(goodHandle(), { headers: { origin: 'https://evil.example.invalid' } }), 403],
    ['Sec-Fetch-Site cross-site', () => signOutEv(goodHandle(), { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    ['no X-IAOS-Session header', () => ev({ body: JSON.stringify({ handle: goodHandle() }) }), 403],
    ['GET', () => signOutEv(goodHandle(), { method: 'GET' }), 405],
  ];
  for (const [label, make, code] of handleRefusals) {
    await check(`S10 Sign out refused: ${label} -> ${code}, nothing written, no Set-Cookie`, async () => {
      reset(); const r = await signOut(make());
      assert.equal(r.statusCode, code, r.body); assert.equal(r.headers['Set-Cookie'], undefined);
      assert.equal(blobs.log.filter((e) => e.method === 'PUT').length, 0);
    });
  }
  await check('S11 the handle is never a credential: as the read cookie (status signed_out; reader 401), as a saving bearer (writer 401), at token issue (401)', async () => {
    reset(); const h = goodHandle();
    assert.equal(parse(await status(h)).state, 'signed_out');
    assert.equal((await load('ghl-contact')(ev({ method: 'GET', cookie: h, query: { id: 'fixtureContact' } }))).statusCode, 401);
    assert.throws(() => writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${h}` } }));
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: h }))).statusCode, 401);
    assert.equal((await mint(tokenEv(h))).statusCode, 401);
    assert.throws(() => readAuth.verifyReadSession(h, readAuth.appReadConfig()));
  });
  await check('S12 fixed target: an OLD handle used after a fresh sign-in revokes ONLY the old sid; the new session still gets tokens', async () => {
    reset(); const oldC = readCookie({ s: sid(13) }); const oldHandle = parse(await status(oldC)).handle;
    const newC = readCookie({ s: sid(14) });
    assert.equal((await signOut(signOutEv(oldHandle, { cookie: newC }))).statusCode, 200, 'the request cookie (new session) is ignored');
    assert.equal((await mint(tokenEv(newC))).statusCode, 200, 'new session unaffected');
    assert.equal((await mint(tokenEv(oldC))).statusCode, 401, 'old session revoked');
  });

  // =========================================================================== X
  reset(); flag(true);
  await check('X0 this process has no BroadcastChannel/localStorage path in use: the server alone decides (no browser signal exists here)', async () => {
    const src = ['lib/session-revocation.ts', 'app-write-token.ts', 'app-signout.ts', 'app-read-session.ts'].map((f) => fs.readFileSync(path.join(FUNCTIONS, f), 'utf8')).join('\n');
    assert.ok(!/BroadcastChannel|localStorage|sessionStorage/.test(src));
  });
  await check('X1 two tabs share one cookie; tab B holds an EARLIER token T1; tab A signs out -> tab B: no new token (401 revoked), T1 refused on a write (Variant S), reads 401 revoked, status revoked', async () => {
    const c = readCookie({ s: sid(15) });
    const t1 = parse(await mint(tokenEv(c))).token;                         // tab B, before Sign out
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t1 })), null, 'before: T1 passes the write check');
    const handle = parse(await status(c)).handle;                          // tab A
    assert.equal((await signOut(signOutEv(handle))).statusCode, 200);       // tab A: confirmed
    const tb = await mint(tokenEv(c));                                       // tab B
    assert.equal(tb.statusCode, 401); assert.equal(parse(tb).reason, 'revoked');
    const w = await rev.sessionWriteRefusal(ev({ bearer: t1 }));
    assert.equal(w.statusCode, 401); assert.equal(parse(w).reason, 'revoked'); assert.equal(parse(w).error, 'Application write sign-in required');
    const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c }));
    assert.equal(rd.statusCode, 401); assert.equal(parse(rd).reason, 'revoked'); assert.equal(parse(rd).by, 'iaos-app-read-auth');
    assert.equal(parse(await status(c)).state, 'revoked');
  });
  await check('X2 the same T1 through a REAL writer (ghl-write): 401 revoked, zero GHL requests', async () => {
    const t1 = bound(sid(15));
    other = [];
    const r = await load('ghl-write')(ev({ bearer: t1, body: JSON.stringify({ operation: 'note.create', targetId: 'c1', requestId: 'r1', args: { body: 'x' } }) }));
    assert.equal(r.statusCode, 401); assert.equal(parse(r).reason, 'revoked'); assert.equal(other.length, 0);
  });
  await check('X3 a sid-less saving token (old popup issuer) is refused by writers while one sign-in is on', async () => {
    const legacy = writeAuth.issueAppSession('brad@example.invalid').token;
    const r = await rev.sessionWriteRefusal(ev({ bearer: legacy }));
    assert.equal(r.statusCode, 401); assert.equal(parse(r).reason, 'sign_in_again');
  });
  await check('X4 two DISTINCT requests with the same token separated by revocation: first passes, second refused', async () => {
    reset(); const c = readCookie({ s: sid(16) }); const t = parse(await mint(tokenEv(c))).token;
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t })), null);
    assert.equal((await rev.recordRevocation(sid(16), 'test', { event: NF })).kind, 'verified');
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401);
  });
  await check('X5 store unavailable for a writer -> 503 marker, not 401; for a reader -> 503 marker, not 401', async () => {
    reset(); const c = readCookie({ s: sid(17) }); const t = bound(sid(17));
    const k17 = rev.revocationKey('test', sid(17));
    blobs.rule({ stage: 'blob', method: 'GET', status: 500, key: k17 }, { stage: 'blob', method: 'GET', status: 500, key: k17 });
    const w = await rev.sessionWriteRefusal(ev({ bearer: t })); const r = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c }));
    for (const x of [w, r]) { assert.equal(x.statusCode, 503); assert.equal(marker(x), 'iaos-session-unavailable'); }
  });
  await check('X6 an earlier-authorized write (its own check passed BEFORE revocation) is not cancelled by a later revocation (accepted L2): the check result is per request, never re-evaluated', async () => {
    reset(); const t = bound(sid(18));
    const passed = await rev.sessionWriteRefusal(ev({ bearer: t }));
    await rev.recordRevocation(sid(18), 'test', { event: NF });
    assert.equal(passed, null, 'the admitted request keeps its admission'); assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401, 'any later request refuses');
  });

  await check('X7 the parent session has expired (pexp passed): a still-unexpired saving token is refused on writes, 401 session_expired; no pexp -> sign_in_again', async () => {
    reset(); const past = bound(sid(19), { pexp: Math.floor(Date.now() / 1000) - 1 });
    const r = await rev.sessionWriteRefusal(ev({ bearer: past }));
    assert.equal(r.statusCode, 401); assert.equal(parse(r).reason, 'session_expired'); assert.equal(blobCount(), 0);
    const claims = { iss: 'iaos', aud: 'iaos-app-write', sub: 'brad@example.invalid', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900, env: 'test', sid: sid(19) };
    const crypto = require('node:crypto'); const input = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
    const nopexp = input + '.' + crypto.createHmac('sha256', BASE_ENV.IAOS_APP_WRITE_SESSION_SECRET).update(input).digest('base64url');
    assert.equal(parse(await rev.sessionWriteRefusal(ev({ bearer: nopexp }))).reason, 'sign_in_again');
  });

  // =========================================================================== I
  const READERS = ['call-eligibility', 'call-log-barrier', 'current-offer-barrier', 'ghl-calendar-events', 'ghl-contact-conversations', 'ghl-contact', 'ghl-contacts',
    'ghl-conversations', 'ghl-documents-capability', 'ghl-mailers', 'ghl-opportunities', 'ghl-proxy', 'ghl-underwriting-policy', 'repair-approval-status'];
  const WRITERS = ['call-log-barrier', 'current-offer-barrier', 'generate-contract-pdf', 'ghl-contract-send-readback', 'ghl-executed-artifact-upload', 'ghl-write', 'property-answer', 'repair-approval-save'];
  const RETIRED = ['ghl-contract-send-execute', 'ghl-contract-send-reserve'];
  const all = fs.readdirSync(FUNCTIONS).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3));
  const src = (n) => fs.readFileSync(path.join(FUNCTIONS, n + '.ts'), 'utf8');
  await check('I1 inventory: the files calling readAuthRefusal are exactly the 14 readers; those calling requireAppWriter are exactly the 8 writers + 2 retired 410 endpoints', async () => {
    assert.deepEqual(all.filter((n) => /readAuthRefusal\(event\)/.test(src(n))).sort(), [...READERS].sort());
    assert.deepEqual(all.filter((n) => /requireAppWriter\(event\)/.test(src(n))).sort(), [...WRITERS, ...RETIRED].sort());
  });
  await check('I2 every reader: `await sessionReadRefusal(event)` immediately follows its unchanged two readAuthRefusal statements', async () => {
    for (const n of READERS) assert.match(src(n), /const (refused|refusal) = readAuthRefusal\(event\);\r?\n\s*if \(\1\) return \1;\r?\n\s*const revoked = await sessionReadRefusal\(event\);\r?\n\s*if \(revoked\) return revoked;/, n);
  });
  await check('I3 every writer: `await sessionWriteRefusal(event)` follows requireAppWriter and requireAppWriteOrigin, before anything else', async () => {
    for (const n of WRITERS) {
      const s = src(n);
      const a = s.indexOf('requireAppWriter(event)'), o = s.indexOf('requireAppWriteOrigin(event)'), w = s.indexOf('await sessionWriteRefusal(event)');
      assert.ok(a > 0 && o > a && w > o, n);
      assert.match(s.slice(o, w), /^requireAppWriteOrigin\(event\);\s*\}\s*catch\s*\{[^]*?\);\s*\}\r?\n\s*const writeRevoked = $/, n);
    }
  });
  await check('I4 retired send endpoints still return 410 after auth (no effect; not converted)', async () => {
    for (const n of RETIRED) assert.match(src(n), /statusCode: 410/);
  });
  // Behavioural sweep: every reader and writer refuses a revoked session (401 revoked) and an unreadable store (503) with
  // no GHL request. Handlers gated off before authentication in this config are reported as such (their own gate).
  reset(); flag(true);
  const revokedSid = sid(20), liveSid = sid(21);
  seedRevoked('test', revokedSid);
  const PRE_AUTH_GATES = {};
  for (const n of READERS) {
    for (const [label, s, prep, want] of [['revoked', revokedSid, () => {}, 401], ['store unavailable', liveSid, () => blobs.rule({ stage: 'blob', method: 'GET', status: 500 }), 503]]) {
      await check(`I5 reader ${n}: ${label} -> ${want}${want === 503 ? ' iaos-session-unavailable' : ' reason revoked'}, no GHL request`, async () => {
        other = []; blobs.clearRules(); prep();
        const r = await load(n)(ev({ method: 'GET', cookie: readCookie({ s }), query: { id: 'fixtureContact', contactId: 'fixtureContact', opportunityId: 'fixtureOpp', path: '/contacts/fixtureContact' } }));
        if (r.statusCode === 404 && /disabled|not found/i.test(r.body) && !PRE_AUTH_GATES[n]) { PRE_AUTH_GATES[n] = true; }
        if (PRE_AUTH_GATES[n]) { assert.equal(r.statusCode, 404); return; }
        assert.equal(r.statusCode, want, r.body);
        assert.equal(want === 503 ? marker(r) : parse(r).reason, want === 503 ? 'iaos-session-unavailable' : 'revoked');
        assert.equal(other.length, 0, JSON.stringify(other));
      });
    }
  }
  for (const n of WRITERS) {
    for (const [label, s, prep, want] of [['revoked', revokedSid, () => {}, 401], ['store unavailable', liveSid, () => blobs.rule({ stage: 'blob', method: 'GET', status: 500 }), 503]]) {
      await check(`I6 writer ${n}: ${label} -> ${want}, no GHL request`, async () => {
        other = []; blobs.clearRules(); prep();
        const t = bound(s);
        const r = await load(n)(ev({ bearer: t, body: '{}' }), { getRemainingTimeInMillis: () => 20_000 });
        if (r.statusCode === 404 && !PRE_AUTH_GATES[n]) PRE_AUTH_GATES[n] = true;
        if (PRE_AUTH_GATES[n]) { assert.equal(r.statusCode, 404); return; }
        assert.equal(r.statusCode, want, r.body);
        assert.equal(other.length, 0, JSON.stringify(other));
      });
    }
  }
  await check('I7 with a LIVE (verified-absent) session every writer passes the new check and reaches its own next refusal (malformed body), not a session refusal', async () => {
    const t = bound(liveSid);
    blobs.clearRules();
    for (const n of WRITERS) {
      if (PRE_AUTH_GATES[n]) continue;
      other = [];
      const r = await load(n)(ev({ bearer: t, body: '{}' }), { getRemainingTimeInMillis: () => 20_000 });
      assert.ok(r.statusCode !== 401 && !(r.statusCode === 503 && marker(r) === 'iaos-session-unavailable'), `${n}: ${r.statusCode} ${r.body}`);
    }
  });
  console.log('pre-authentication gates observed (not reached in this config): ' + JSON.stringify(Object.keys(PRE_AUTH_GATES)));

  // =========================================================================== H
  // Authority binding (Bones H2): pinned site, runtime site header, operator anchor, restore epoch.
  reset(); flag(true);
  const signIn = () => load('app-read-session')(ev({ body: JSON.stringify({ googleIdToken: 'fixture-google-token' }) }));
  const unavailableEverywhere = async (label) => {
    const c = readCookie({ s: sid(30) });
    const r = await ck(sid(30)); assert.equal(r.kind, 'unavailable', `${label} check ${JSON.stringify(r)}`);
    const so = await rr(sid(31)); assert.equal(so.kind, 'unconfirmed', `${label} sign-out ${JSON.stringify(so)}`);
    const st = await status(c); assert.equal(st.statusCode, 503, `${label} status`); assert.equal(parse(st).state, 'unavailable');
    const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c })); assert.equal(rd.statusCode, 503, `${label} reader`); assert.equal(marker(rd), 'iaos-session-unavailable');
    const wr = await rev.sessionWriteRefusal(ev({ bearer: bound(sid(30)) })); assert.equal(wr.statusCode, 503, `${label} writer`);
    const mt = await mint(tokenEv(c)); assert.equal(mt.statusCode, 503, `${label} mint`); noCredentialLeak(mt);
    const handle = rev.issueSignoutHandle({ sid: sid(32), expiresAt: new Date(Date.now() + 3600_000).toISOString() }, readAuth.appReadConfig());
    const sh = await signOut(signOutEv(handle)); assert.equal(sh.statusCode, 503, `${label} app-signout`); assert.equal(parse(sh).state, 'not_confirmed');
  };
  await check('H0 the pinned revocation sites are frozen repo constants: test 07ca1f1a-... (iaos-app-test), production 19fcbf6a-... (iaos-app)', async () => {
    assert.deepEqual({ ...rev.PINNED_REVOCATION_SITES }, { test: SITE, production: PROD_SITE });
    assert.ok(Object.isFrozen(rev.PINNED_REVOCATION_SITES));
    assert.equal(rev.RUNTIME_SITE_HEADER, 'x-nf-site-id');
  });
  await check('H1 anchor ABSENT -> check unavailable (authority_absent, never absent), Sign out not confirmed, status/reader/writer/mint/app-signout 503; nothing writes the anchor', async () => {
    reset(); dropAnchor();
    assert.deepEqual(await ck(sid(30)), { kind: 'unavailable', reason: 'authority_absent' });
    await unavailableEverywhere('absent');
    assert.equal(blobs.get('iaos-write-receipts', ANCHOR_KEY), null, 'the anchor is still absent: no code path created it');
  });
  for (const [label, text] of [
    ['malformed JSON', '{"v":1,'],
    ['empty value', ''],
    ['non-canonical key order', JSON.stringify({ v: 1, kind: 'iaos-session-revocation-authority', env: 'test', siteID: SITE, epoch: EPOCH })],
    ['extra field', anchorText({ extra: { note: 'x' } })],
    ['missing epoch', JSON.stringify(Object.fromEntries(Object.entries({ env: 'test', kind: 'iaos-session-revocation-authority', siteID: SITE, v: 1 }).sort()))],
    ['epoch too short', anchorText({ epoch: 'short-epoch' })],
    ['epoch with a forbidden character', anchorText({ epoch: 'fixture-epoch/0001' })],
    ['epoch too long', anchorText({ epoch: 'e'.repeat(65) })],
    ['wrong version', anchorText({ v: 2 })],
    ['wrong kind', anchorText({ kind: 'iaos-session-revocation' })],
    ['a revocation record at the anchor key', RECORD('test', sid(30)).text],
  ]) {
    await check(`H2 anchor MALFORMED (${label}) -> unavailable (authority_invalid), Sign out not confirmed`, async () => {
      reset(); seedAnchor(text);
      assert.deepEqual(await ck(sid(30)), { kind: 'unavailable', reason: 'authority_invalid' });
      assert.equal((await rr(sid(31))).kind, 'unconfirmed');
    });
  }
  await check('H3 anchor ENV MISMATCH (a production anchor in the Test store) -> unavailable everywhere', async () => {
    reset(); seedAnchor({ env: 'production', siteID: PROD_SITE });
    assert.deepEqual(await ck(sid(30)), { kind: 'unavailable', reason: 'authority_invalid' });
    reset(); seedAnchor({ env: 'production', siteID: SITE });
    await unavailableEverywhere('env mismatch');
  });
  await check('H4 anchor SITE MISMATCH (anchor names another site) -> unavailable everywhere', async () => {
    reset(); seedAnchor({ siteID: PROD_SITE });
    assert.deepEqual(await ck(sid(30)), { kind: 'unavailable', reason: 'authority_invalid' });
    reset(); seedAnchor({ siteID: 'aaaaaaaa-0000-0000-0000-000000000000' });
    await unavailableEverywhere('site mismatch');
  });
  await check('H5 configured site id != the pinned id (or IAOS_ENV unbound) -> unavailable with ZERO requests, Sign out not confirmed', async () => {
    for (const [label, over] of [['production site id in Test', { IAOS_SESSION_REVOCATION_SITE_ID: PROD_SITE }], ['arbitrary site id', { IAOS_SESSION_REVOCATION_SITE_ID: 'fixture-site-id' }]]) {
      reset(); setEnv('test', over);
      assert.deepEqual(rev.revocationSetup(process.env), { kind: 'not_configured', reason: 'site_not_pinned' }, label);
      assert.deepEqual(await ck(sid(30)), { kind: 'unavailable', reason: 'site_not_pinned' }, label);
      assert.deepEqual(await rr(sid(31)), { kind: 'unconfirmed', reason: 'site_not_pinned' }, label);
      assert.equal((await status(readCookie({ s: sid(30) }))).statusCode, 503, label);
      assert.equal(blobCount(), 0, label);
    }
    assert.deepEqual(rev.revocationSetup({ ...BASE_ENV, IAOS_ENV: 'staging' }), { kind: 'not_configured', reason: 'environment_unbound' });
    assert.deepEqual(rev.revocationSetup({ ...BASE_ENV, IAOS_ENV: 'production' }), { kind: 'not_configured', reason: 'site_not_pinned' }, 'the Test site id is not Production\'s authority');
    assert.equal(rev.revocationSetup({ ...BASE_ENV, IAOS_ENV: 'production', IAOS_SESSION_REVOCATION_SITE_ID: PROD_SITE }).kind, 'ready');
  });
  await check('H6 the runtime site header x-nf-site-id: missing, mismatched or ambiguous -> unavailable with ZERO requests (check, Sign out, reader, writer, mint, status, app-signout); any header-name case accepted', async () => {
    reset();
    for (const [label, ev2] of [['missing', { headers: {} }], ['production site', { headers: { 'x-nf-site-id': PROD_SITE } }], ['empty', { headers: { 'x-nf-site-id': '' } }],
      ['ambiguous', { headers: { 'x-nf-site-id': SITE }, multiValueHeaders: { 'X-Nf-Site-Id': [SITE, PROD_SITE] } }], [' padded', { headers: { 'x-nf-site-id': ` ${SITE}` } }]]) {
      blobs.log.length = 0;
      assert.deepEqual(await ck(sid(30), { event: ev2 }), { kind: 'unavailable', reason: 'runtime_site_mismatch' }, label);
      assert.deepEqual(await rr(sid(31), { event: ev2 }), { kind: 'unconfirmed', reason: 'runtime_site_mismatch' }, label);
      assert.equal(blobCount(), 0, label);
    }
    assert.deepEqual(await ck(sid(30), { event: { headers: { 'X-NF-Site-ID': SITE } } }), { kind: 'absent' }, 'case-insensitive header name');
    const noHdr = { 'x-nf-site-id': undefined };
    const c = readCookie({ s: sid(33) });
    blobs.log.length = 0;
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c, headers: noHdr }))).statusCode, 503);
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: bound(sid(33)), headers: noHdr }))).statusCode, 503);
    assert.equal((await mint(tokenEv(c, { headers: noHdr }))).statusCode, 503);
    assert.equal((await load('app-read-session')(ev({ method: 'GET', cookie: c, headers: noHdr }))).statusCode, 503);
    const handle = rev.issueSignoutHandle({ sid: sid(33), expiresAt: new Date(Date.now() + 3600_000).toISOString() }, readAuth.appReadConfig());
    const so = await signOut(signOutEv(handle, { headers: { 'x-nf-site-id': PROD_SITE } }));
    assert.equal(so.statusCode, 503); assert.equal(parse(so).state, 'not_confirmed');
    assert.equal(blobCount(), 0, 'no Blob request without the pinned runtime site');
  });
  await check('H7 epoch MISMATCH (operator rotated the anchor after a restore) -> REVOKED: check revoked/epoch, reader 401 revoked, writer 401 revoked, mint 401 revoked, status "revoked" -- never 503', async () => {
    reset(); const c = readCookie({ s: sid(34) }); const t = bound(sid(34));
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c })), null, 'before rotation: allowed');
    seedAnchor({ epoch: EPOCH2 });
    assert.deepEqual(await ck(sid(34)), { kind: 'revoked', reason: 'epoch' });
    const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c })); assert.equal(rd.statusCode, 401); assert.equal(parse(rd).reason, 'revoked');
    const wr = await rev.sessionWriteRefusal(ev({ bearer: t })); assert.equal(wr.statusCode, 401); assert.equal(parse(wr).reason, 'revoked');
    const mt = await mint(tokenEv(c)); assert.equal(mt.statusCode, 401); assert.equal(parse(mt).reason, 'revoked'); noCredentialLeak(mt);
    const st = parse(await status(c)); assert.equal(st.state, 'revoked'); assert.equal(st.signedIn, false); assert.equal(st.handle, undefined);
    assert.equal((await load('ghl-contact')(ev({ method: 'GET', cookie: c, query: { id: 'fixtureContact' } }))).statusCode, 401);
  });
  await check('H7b a lost revocation does NOT revive after a restore: the record is gone but the rotated epoch still refuses the old session', async () => {
    reset(); const c = readCookie({ s: sid(35) });
    assert.equal((await rr(sid(35))).kind, 'verified'); assert.deepEqual(await ck(sid(35)), { kind: 'revoked' });
    blobs.reset(); seedAnchor({ epoch: EPOCH2 });       // a restore lost the record; the operator rotated the epoch
    assert.deepEqual(await ck(sid(35)), { kind: 'revoked', reason: 'epoch' });
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c }))).statusCode, 401);
  });
  await check('H8 a session or token WITHOUT an epoch is refused like a sid-less one (reader 401 sign_in_again, status signed_out, writer sign_in_again) with zero Blob requests; epoch without sid / malformed epoch cannot be issued', async () => {
    reset(); blobs.log.length = 0;
    const c = readCookie({ s: sid(36), epoch: null });
    const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c })); assert.equal(rd.statusCode, 401); assert.equal(parse(rd).reason, 'sign_in_again');
    assert.equal(parse(await status(c)).state, 'signed_out');
    const claims = { iss: 'iaos', aud: 'iaos-app-write', sub: 'brad@example.invalid', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900, env: 'test', sid: sid(36), pexp: FUTURE };
    const crypto = require('node:crypto'); const input = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
    const noEpoch = input + '.' + crypto.createHmac('sha256', BASE_ENV.IAOS_APP_WRITE_SESSION_SECRET).update(input).digest('base64url');
    const wr = await rev.sessionWriteRefusal(ev({ bearer: noEpoch })); assert.equal(wr.statusCode, 401); assert.equal(parse(wr).reason, 'sign_in_again');
    assert.equal(blobCount(), 0);
    assert.throws(() => readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), undefined, EPOCH));
    assert.throws(() => readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), sid(36), 'bad'));
    assert.throws(() => writeAuth.issueBoundAppSession('brad@example.invalid', { env: 'test', sid: sid(36), pexp: FUTURE }));
    assert.equal((await rev.checkRevocation(sid(36), 'test', { event: NF })).kind, 'unavailable', 'the module refuses a check with no epoch');
  });
  await check('H9 the saving token carries the session epoch and is checked on every write: after rotation the EARLIER token is refused (401 revoked); a fresh sign-in under the new epoch mints and saves', async () => {
    reset(); const c = readCookie({ s: sid(37) });
    const t = parse(await mint(tokenEv(c))).token; assert.equal(decode(t).epoch, EPOCH);
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t })), null);
    seedAnchor({ epoch: EPOCH2 });
    const w = await rev.sessionWriteRefusal(ev({ bearer: t })); assert.equal(w.statusCode, 401); assert.equal(parse(w).reason, 'revoked');
    const tamper = (() => { const [h, p, s] = t.split('.'); const cl = JSON.parse(Buffer.from(p, 'base64url')); cl.epoch = EPOCH2; return [h, Buffer.from(JSON.stringify(cl)).toString('base64url'), s].join('.'); })();
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: tamper }))).statusCode, 401, 'a token whose epoch was edited is refused (signature)');
    const fresh = /__Host-iaos_read=([^;]+)/.exec((await signIn()).headers['Set-Cookie'])[1];
    assert.equal(decode(fresh).epoch, EPOCH2);
    const t2 = parse(await mint(tokenEv(fresh))).token; assert.equal(decode(t2).epoch, EPOCH2);
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t2 })), null);
  });
  for (const [label, prep] of [
    ['anchor absent', () => dropAnchor()],
    ['anchor malformed', () => seedAnchor('{"v":1}')],
    ['anchor env mismatch', () => seedAnchor({ env: 'production' })],
    ['anchor unreadable (blob 500)', () => blobs.rule({ stage: 'blob', method: 'GET', status: 500 })],
    ['runtime site header missing', () => 'no-header'],
    ['configured site not pinned', () => setEnv('test', { IAOS_SESSION_REVOCATION_SITE_ID: PROD_SITE })],
  ]) {
    await check(`H10 sign-in with ${label} -> 503 unavailable, NO session issued (no Set-Cookie), Google identity verified first`, async () => {
      reset(); const mode = prep();
      const r = await load('app-read-session')(ev({ body: JSON.stringify({ googleIdToken: 'fixture-google-token' }), ...(mode === 'no-header' ? { headers: { 'x-nf-site-id': undefined } } : {}) }));
      assert.equal(r.statusCode, 503, r.body); assert.equal(parse(r).state, 'unavailable'); assert.equal(parse(r).by, 'iaos-session-unavailable');
      assert.equal(r.headers['Set-Cookie'], undefined); assert.ok(!/eyJ/.test(r.body));
    });
  }
  await check('H10b a refused Google identity at sign-in reads nothing from the store (401, zero Blob requests)', async () => {
    reset(); const h = load('app-read-session');
    const r = await h(ev({ body: JSON.stringify({ googleIdToken: 'x' }), headers: { origin: 'https://evil.example.invalid' } }));
    assert.equal(r.statusCode, 401); assert.equal(blobCount(), 0);
  });
  await check('H11 the anchor and sid reads run IN PARALLEL within the ONE check budget (two 400 ms reads fit a 700 ms budget); single attempt each', async () => {
    reset();
    blobs.rule({ stage: 'blob', method: 'GET', delayMs: 400, key: ANCHOR_KEY }, { stage: 'blob', method: 'GET', delayMs: 400, key: rev.revocationKey('test', sid(38)) });
    const t0 = Date.now(); const r = await ck(sid(38), { budgetMs: 700 });
    assert.deepEqual(r, { kind: 'absent' }, `parallel within one budget (${Date.now() - t0} ms)`);
    assert.deepEqual(keysOf('anchor'), ['sign:GET', 'blob:GET']); assert.deepEqual(keysOf('sid'), ['sign:GET', 'blob:GET']);
    reset(); blobs.rule({ stage: 'blob', method: 'GET', status: 503, key: ANCHOR_KEY });
    assert.equal((await ck(sid(38))).kind, 'unavailable');
    assert.deepEqual(keysOf('anchor'), ['sign:GET', 'blob:GET'], 'no retry of the anchor read');
  });
  await check('H11b a LATE anchor never grants: anchor answered after the deadline -> unavailable (check) / not confirmed (Sign out); a hung anchor is bounded by the same deadline', async () => {
    reset(); let t = 3_000_000;
    const anchorUrls = new Set();
    const lateAnchor = async (u, i) => {
      const res = await blobs.fetch(u, i);
      if (String(u).startsWith('https://api.netlify.com/') && decodeURIComponent(String(u)).includes(ANCHOR_KEY) && res.status === 200) {
        anchorUrls.add((await res.clone().json()).url);
      } else if (anchorUrls.has(String(u))) t += 5_000;       // the anchor's answer arrives after the deadline
      return res;
    };
    assert.equal((await rev.checkRevocation(sid(39), 'test', { event: NF, epoch: EPOCH, fetch: lateAnchor, now: () => t })).kind, 'unavailable');
    assert.equal((await rev.recordRevocation(sid(39), 'test', { event: NF, fetch: lateAnchor, now: () => t })).kind, 'unconfirmed');
    reset(); blobs.rule({ stage: 'blob', method: 'GET', hang: true, ignoreAbort: true, key: ANCHOR_KEY });
    const t0 = Date.now(); const r = await ck(sid(39), { budgetMs: 600 });
    assert.equal(r.kind, 'unavailable'); assert.ok(Date.now() - t0 < 1500, `bounded: ${Date.now() - t0} ms`);
  });
  await check('H12 static scan: NO code path writes the anchor -- the key literal appears ONLY in session-revocation.ts (once); the anchor key is used only by strongRead; the module\'s only write is createOnce, called once with revocationKey(...)', async () => {
    const roots = ['netlify', 'src', 'shared'].map((d) => path.join(APP, d));
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|js|cjs|mjs)$/.test(e.name)) files.push(p); } };
    roots.forEach(walk);
    const ANCHOR_REF = /session-revocation\/_authority|[\/"'`]_authority\b/;
    const hits = files.filter((f) => ANCHOR_REF.test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(hits.map((f) => path.relative(APP, f).split(path.sep).join('/')), ['netlify/functions/lib/session-revocation.ts']);
    const src = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8');
    assert.equal((src.match(/_authority/g) || []).length, 1, 'the literal once');
    assert.match(src, /^const AUTHORITY_KEY = "session-revocation\/_authority";$/m);
    const uses = src.match(/AUTHORITY_KEY/g) || [];
    assert.equal(uses.length, 2, 'declaration + exactly one use');
    assert.match(src, /strongRead\(ctx, AUTHORITY_KEY\)/);
    assert.equal((src.match(/\.set\(/g) || []).length, 1, 'exactly one write call in the module');
    assert.match(src, /storeFor\(ctx, rec\.fetch\)\.set\(key, text, \{ onlyIfNew: true \}\)/);
    assert.equal((src.match(/createOnce\(/g) || []).length, 2, 'createOnce: definition + one call');
    assert.match(src, /const key = revocationKey\(deployment, sid\);[^]*createOnce\(ctx, key, text\)/);
    assert.ok(!/\.(setJSON|delete)\(/.test(src), 'no setJSON / delete');
    assert.equal(anchorWrites.length, 0, 'no anchor write observed so far in this run: ' + JSON.stringify(anchorWrites));
  });

  flag(false);
  await check('Z no request in the WHOLE run wrote or deleted the authority anchor', async () => {
    assert.deepEqual(anchorWrites, []);
  });
  const FLOOR = 184;
  if (checks < FLOOR) { failures += 1; console.log(`FAIL  check floor -- ${checks} checks ran, the floor is ${FLOOR}`); }
  console.log(`B15-29 one IAOS sign-in (server): ${checks - failures}/${checks} checks passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.log('FAIL  suite aborted -- ' + (e && e.stack)); process.exitCode = 1; });
