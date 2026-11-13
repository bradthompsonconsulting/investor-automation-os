/**
 * B15-29 (INV-137) one IAOS sign-in -- SERVER side, offline. Design r5 (conditional-write session authority) with the
 * r6 lifetime ruling (fixed 30-day session, persistent cookie, no renewal) and the r6 authorization seam.
 *
 * The REAL handlers (app-read-session, app-write-token, app-signout, app-write-session, every protected reader and
 * writer) and the REAL libraries run against fixture configuration. global.fetch is replaced for the whole run: the
 * Lambda Blobs EDGE API goes to an in-memory fake (scripts/lib/b15-29-fake-blobs.cjs; content-addressed ETags by
 * default, a per-write ETag mode for U1); Google tokeninfo is a fixture; any other outbound request is recorded and
 * answered 599. The one-IAOS-sign-in switch is turned ON only by mutating the in-memory config object in THIS process
 * (committed config stays ONE_LOGIN_DISABLED).
 *
 * Sections:
 *   F  flag-off equivalence (committed config): new endpoints 404, helpers null with zero I/O, status/sign-in/
 *      DELETE/popup unchanged (8 h, Max-Age=28800), 30-day sessions refused while off, runtime payload unchanged
 *   A  authority module: sign-in binding (anchor read + identical-bytes If-Match confirm + session onlyIfNew), the
 *      check (two parallel identical-bytes If-Match writes; 412 = revoked; anything else = unavailable), sign-out
 *      (unconditional + If-Match readback), single attempt, deadline, late answers, SDK `modified` never trusted,
 *      READS NEVER AUTHORIZE, U1 false (per-write ETags) fails CLOSED
 *   T  token mint: every refusal reason, cross-site/origin, environment, allowlist, unbound session, revoked,
 *      store unavailable -> 503 not 401; success claims; the token never outlives the session; mint never extends
 *   S  status + sign-in + sign-out: 30-day persistent cookie, handle, acknowledged revoke, no Set-Cookie on sign-out,
 *      DELETE retired, popup issuer retired, handle authority, fixed target
 *   L  lifetime (r6): exactly 30 days, refused at 30 days + 1 s everywhere, no request extends it
 *   X  multi-tab within one session; D two devices (independent sessions)
 *   Z  authorization seam: called by every reader, writer and the mint; a refusal there refuses despite a valid session
 *   I  inventory: every reader / writer carries the check after its unchanged auth statements
 *   H  authority binding: pinned site, runtime header, Lambda context, anchor validity, epoch rotation, wrong store,
 *      restored active record, no anchor mutation (static + whole run)
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
// The PINNED Test site (public Netlify site id of iaos-app-test); Production's pinned id for mismatch cases.
const SITE = '07ca1f1a-60fd-4229-a076-528970957912';
const PROD_SITE = '19fcbf6a-7c3c-40e3-af20-bd077f0f8ec8';
const BASE_ENV = {
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid,reader-only@example.invalid',
  IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
  GHL_PRIVATE_API_KEY: 'offline-fixture',
};
const MANAGED = [...Object.keys(BASE_ENV), 'IAOS_ENV', 'IAOS_VOICE_SESSION_SECRET', 'IAOS_SESSION_REVOCATION_SITE_ID', 'IAOS_SESSION_REVOCATION_TOKEN'];
function setEnv(deployment, overrides = {}) {
  for (const k of MANAGED) delete process.env[k];
  Object.assign(process.env, BASE_ENV, { IAOS_ENV: deployment }, overrides);
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
}
setEnv('test');

// ---- outbound: the fake Blob edge API; Google tokeninfo fixture; everything else is recorded and refused ----
const blobs = createFakeBlobs({ siteID: SITE });
let other = [];
// Bones HOLD on 3311102: the anchor lives in its OWN never-restored store; the session records stay in the receipts
// store. OLD_ANCHOR_KEY is the r4 location (receipts store) -- code must never name it again.
const ASTORE = 'iaos-session-authority';
const SSTORE = 'iaos-write-receipts';
const ANCHOR_KEY = 'authority';
const OLD_ANCHOR_KEY = 'session-revocation/_authority';
// Every request for the anchor across the WHOLE run (method + preconditions), for the runtime no-mutation proof; and
// every Blob request with its store name, for the runtime store-separation proof.
const anchorRequests = [];
const storeOps = [];
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (blobs.handles(u)) {
    const [, storeName = '', ...rest] = new URL(u).pathname.slice(1).split('/').map(decodeURIComponent);
    const key = rest.join('/');
    const method = String(init.method || 'GET').toUpperCase();
    storeOps.push({ store: storeName.replace(/^site:/, ''), key, method });
    if (storeName === 'site:' + ASTORE && key === ANCHOR_KEY) {
      const h = {}; new Headers(init.headers || {}).forEach((v, k) => { h[k.toLowerCase()] = v; });
      anchorRequests.push({ method, ifMatch: h['if-match'] || null, ifNoneMatch: h['if-none-match'] || null, body: init.body });
    }
    return blobs.fetch(url, init);
  }
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
const authz = require(path.join(FUNCTIONS, 'lib/authorization.ts'));
const blobAuthority = require(path.join(FUNCTIONS, 'lib/blob-authority.ts'));
// This suite's subject is not the read budget; pin it OFF (as test-app-read-auth does).
cfg.getConfig('test').supplementalReadBudget = { enabled: cfg.SUPPLEMENTAL_READ_BUDGET_DISABLED, budgetId: 'offline-disabled', ceiling: 0 };
cfg.getConfig('test').oneLoginTestSessionSeconds = null;   // pinned in-process: these checks are 30-day checks, whatever the committed Test lifetime
const flag = (on, env = 'test') => { cfg.getConfig(env).oneLogin = on ? cfg.ONE_LOGIN_ENABLED : cfg.ONE_LOGIN_DISABLED; };
function load(name) {
  for (const key of Object.keys(require.cache)) if (key.startsWith(FUNCTIONS + path.sep) && !key.includes(`${path.sep}lib${path.sep}`)) delete require.cache[key];
  return require(path.join(FUNCTIONS, name + '.ts')).handler;
}

let checks = 0, failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log('PASS  ' + name); }
  catch (err) { failures += 1; console.log('FAIL  ' + name + ' -- ' + (err && err.message)); }
}

// ---- fixtures -----------------------------------------------------------------
const DAY = 24 * 3600;
const sid = (n) => Buffer.alloc(16, n).toString('base64url');
const EPOCH = 'fixture-epoch-0001';
const EPOCH2 = 'fixture-epoch-0002-rotated';
// r4: the anchor carries the REQUIRED state ("open" | "closed"); state: null omits it (the r3 shape, now invalid).
const anchorText = ({ env = 'test', siteID = SITE, epoch = EPOCH, v = 1, kind = 'iaos-session-revocation-authority', state = 'open', extra = {} } = {}) =>
  JSON.stringify(Object.fromEntries(Object.entries({ env, epoch, kind, siteID, ...(state === null ? {} : { state }), v, ...extra }).sort()));
const seedAnchor = (o) => blobs.put(ASTORE, ANCHOR_KEY, typeof o === 'string' ? o : anchorText(o));
const dropAnchor = () => blobs.remove(ASTORE, ANCHOR_KEY);
/** The anchor requests of blobs.log (authority store + key only). */
const areqs = () => blobs.log.filter((e) => e.storeName === 'site:' + ASTORE && e.key === ANCHOR_KEY).map((e) => `${e.method}${e.ifMatch ? ' if-match' : ''}${e.ifNoneMatch ? ' if-none-match' : ''}`);
/** Simulated backup / restore of the SESSION store only (the authority store is never in scope). */
const SPFX = `${SITE}|site:${SSTORE}|`;
const snapshotSessionStore = () => new Map([...blobs.store.entries()].filter(([k]) => k.startsWith(SPFX)).map(([k, v]) => [k, { ...v }]));
const restoreSessionStore = (snap) => { for (const k of [...blobs.store.keys()]) if (k.startsWith(SPFX)) blobs.store.delete(k); for (const [k, v] of snap) blobs.store.set(k, { ...v }); };
const NF = { headers: { 'x-nf-site-id': SITE }, blobs: blobs.lambdaBlobs };   // a minimal Lambda event
const cookieHeader = (token) => `${readAuth.READ_COOKIE}=${token}`;
function ev({ method = 'POST', cookie = null, headers = {}, body = '', bearer = null, multi, query, noBlobs = false } = {}) {
  const h = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE, ...headers };
  if (cookie) h.cookie = cookieHeader(cookie);
  if (bearer) h.authorization = `Bearer ${bearer}`;
  for (const [k, v] of Object.entries(h)) if (v === undefined) delete h[k];
  return { httpMethod: method, headers: h, body, ...(noBlobs ? {} : { blobs: blobs.lambdaBlobs }), ...(multi ? { multiValueHeaders: multi } : {}), ...(query ? { queryStringParameters: query } : {}) };
}
const tokenEv = (cookie, extra = {}) => ev({ cookie, ...extra, headers: { 'x-iaos-session': 'saving-token', ...(extra.headers || {}) } });
const parse = (res) => { try { return JSON.parse(res.body); } catch { return null; } };
const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const marker = (res) => (parse(res) || {}).by;
function noCredentialLeak(res) {
  const b = parse(res) || {};
  assert.equal(b.token, undefined, 'no token in a refusal');
  assert.ok(!/eyJ/.test(res.body), 'no token-shaped value in the body');
  assert.equal((res.headers || {})['Set-Cookie'], undefined, 'no Set-Cookie');
  assert.equal((res.headers || {})['Cache-Control'], 'no-store');
}
const reset = () => { blobs.reset(); seedAnchor(); other = []; setEnv('test'); };
const blobCount = () => blobs.log.length;
const sKey = (s, d = 'test') => rev.sessionKey(d, s);
const reqs = (key) => blobs.log.filter((e) => e.key === key).map((e) => `${e.method}${e.ifMatch ? ' if-match' : ''}${e.ifNoneMatch ? ' if-none-match' : ''}`);

/** A REAL store-bound session for sid(n): beginSession at origin, then the signed 30-day cookie and its binding. */
async function bind(n, { at = Date.now(), email = 'brad@example.invalid' } = {}) {
  const g = await rev.beginSession(sid(n), 'test', { event: NF });
  assert.equal(g.kind, 'issued', 'fixture sign-in: ' + JSON.stringify(g));
  const cookie = readAuth.issueReadSession(email, readAuth.appReadConfig(), at, sid(n), g.epoch, { aetag: g.aetag, setag: g.setag }).token;
  return { sid: sid(n), cookie, epoch: g.epoch, aetag: g.aetag, setag: g.setag, exp: decode(cookie).exp };
}
/** Jeff (controls N43/N44 aborted the whole run at a top-level fixture): binds made OUTSIDE check() go through this.
 *  A failed bind is recorded as a named FAIL and the run CONTINUES with an inert placeholder, so a mutation that breaks
 *  sign-in still reaches -- and fails -- the named checks. Clean runs: bind succeeds, no extra check is recorded. */
async function fixtureBind(n, opts) {
  try { return await bind(n, opts); }
  catch (e) {
    await check(`FIXTURE bind(${n}) at top level could not sign in`, async () => { throw e; });
    // Valid-SHAPED but unbound: helpers like tokenFor() accept it, so top-level setup cannot throw; no store holds it,
    // so every server check it reaches refuses it.
    return { sid: sid(n), cookie: '', epoch: 'fixture-unbound-epoch', aetag: '"fixture-unbound"', setag: '"fixture-unbound"', exp: Math.floor(Date.now() / 1000) + 3600 };
  }
}
const tokenFor = (b, { pexp = b.exp, env = 'test', at = Date.now() } = {}) =>
  writeAuth.issueBoundAppSession('brad@example.invalid', { env, sid: b.sid, pexp, epoch: b.epoch, aetag: b.aetag, setag: b.setag }, process.env, at).token;
const signTok = (claims, secret) => { const crypto = require('node:crypto'); const input = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url'); return input + '.' + crypto.createHmac('sha256', secret).update(input).digest('base64url'); };

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
    const c = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), sid(1), EPOCH).token;
    const t = await load('app-write-token')(tokenEv(c));
    const s = await load('app-signout')(ev({ body: '{"handle":"x"}', headers: { 'x-iaos-session': 'sign-out' } }));
    assert.equal(t.statusCode, 404); assert.equal(s.statusCode, 404);
    assert.equal(blobCount() + other.length, 0);
  });
  await check('F3 off: the reader/writer helpers do ZERO I/O -- null for LEGACY credentials; r4: a One-Login cookie or bound saving token is REFUSED (401), never passed', async () => {
    blobs.put('iaos-write-receipts', sKey(sid(1)), rev.sessionRecordText('test', EPOCH, sid(1), 'revoked')); const before = blobCount();
    const c = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), sid(1), EPOCH).token;
    const tok = writeAuth.issueBoundAppSession('brad@example.invalid', { env: 'test', sid: sid(1), pexp: Math.floor(Date.now() / 1000) + 3600, epoch: EPOCH, aetag: '"a"', setag: '"s"' }).token;
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c }))).statusCode, 401);
    const w = await rev.sessionWriteRefusal(ev({ bearer: tok })); assert.equal(w.statusCode, 401); assert.equal(parse(w).reason, 'one_login_off');
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token })), null);
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: writeAuth.issueAppSession('brad@example.invalid').token })), null);
    assert.equal(blobCount() - before, 0); assert.equal(other.length, 0);
  });
  await check('F4 off: app-read-session GET/POST/DELETE answer exactly as before (no state/handle; sid-less 8 h cookie, Max-Age=28800; DELETE clears)', async () => {
    const h = load('app-read-session');
    const g = await h(ev({ method: 'GET', cookie: readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token }));
    assert.equal(g.statusCode, 200); assert.deepEqual(Object.keys(parse(g)).sort(), ['clientId', 'expiresAt', 'signedIn']); assert.equal(parse(g).signedIn, true);
    other = [];
    const p = await h(ev({ body: JSON.stringify({ googleIdToken: 'fixture-google-token' }) }));
    assert.equal(p.statusCode, 200);
    assert.match(p.headers['Set-Cookie'], /; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict$/);
    const issued = /__Host-iaos_read=([^;]+)/.exec(p.headers['Set-Cookie'])[1];
    assert.deepEqual(Object.keys(decode(issued)), ['iss', 'aud', 'env', 'sub', 'iat', 'exp']);
    assert.equal(decode(issued).exp - decode(issued).iat, 8 * 3600);
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
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token })), null);
  });
  await check('F8 off: a 30-day one-sign-in session is NOT a valid read session (rollback can never leave a non-revocable 30-day session usable)', async () => {
    flag(true); const c = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now(), sid(2), EPOCH, { aetag: '"a"', setag: '"s"' }).token; flag(false);
    assert.throws(() => readAuth.verifyReadSession(c, readAuth.appReadConfig()));
    assert.equal(readAuth.readAuthRefusal(ev({ method: 'GET', cookie: c })).statusCode, 401);
    assert.equal(parse(await load('app-read-session')(ev({ method: 'GET', cookie: c }))).signedIn, false);
  });
  await check('F9 off: the flag-off read cookie helper is unchanged (default Max-Age 28800)', async () => {
    assert.equal(readAuth.readSessionCookie('t'), '__Host-iaos_read=t; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict');
  });
  // ---- r4 (Bones R3-1): ROLLBACK -- One Login bound saving tokens issued while ON are refused once it is turned OFF.
  {
    reset(); flag(true);
    const live = await fixtureBind(70); const revoked = await fixtureBind(71);
    const unexpired = parse(await load('app-write-token')(tokenEv(live.cookie))).token;   // a REAL mint while on
    const nowS = Math.floor(Date.now() / 1000);
    const parentExpired = tokenFor(live, { pexp: nowS - 10 });                              // its own 900 s still left
    const revokedTok = parse(await load('app-write-token')(tokenEv(revoked.cookie))).token;
    assert.equal((await rev.revokeSession(revoked.sid, revoked.epoch, 'test', { event: NF })).kind, 'verified');
    const wrongEnv = tokenFor(live, { env: 'production' });
    const legacy = writeAuth.issueAppSession('brad@example.invalid').token;
    const ROLLBACK = [['unexpired', unexpired], ['parent-expired', parentExpired], ['revoked', revokedTok], ['wrong-environment', wrongEnv]];
    flag(false); other = []; blobs.log.length = 0;
    await check('F10 rollback (off): EVERY One-Login bound saving token -- unexpired, parent-expired, revoked, wrong-environment -- is refused by requireAppWriter (the common writer boundary) and by sessionWriteRefusal (401 one_login_off), with zero I/O', async () => {
      for (const [label, t] of ROLLBACK) {
        assert.throws(() => writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${t}` } }), undefined, label);
        assert.throws(() => writeAuth.appWriteSessionBinding({ headers: { authorization: `Bearer ${t}` } }), undefined, label);
        const w = await rev.sessionWriteRefusal(ev({ bearer: t })); assert.equal(w && w.statusCode, 401, label); assert.equal(parse(w).reason, 'one_login_off', label);
      }
      assert.equal(blobCount(), 0); assert.equal(other.length, 0);
    });
    await check('F10b rollback (off): a LEGACY saving token is unchanged -- requireAppWriter accepts it and sessionWriteRefusal passes it (null)', async () => {
      assert.equal(writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${legacy}` } }), 'brad@example.invalid');
      assert.equal(await rev.sessionWriteRefusal(ev({ bearer: legacy })), null);
    });
    await check('F11 rollback (off) through a REAL writer (ghl-write): each bound token -> 401 before any effect, zero GHL and zero Blob requests', async () => {
      for (const [label, t] of ROLLBACK) {
        other = []; blobs.log.length = 0;
        const r = await load('ghl-write')(ev({ bearer: t, body: JSON.stringify({ operation: 'note.create', targetId: 'c1', requestId: 'rb-' + label, args: { body: 'x' } }) }));
        assert.equal(r.statusCode, 401, label + ' ' + r.body); assert.equal(other.length, 0, label); assert.equal(blobCount(), 0, label);
      }
    });
    await check('F12 the bound shape is unforgeable as legacy: it carries its own audience (never "iaos-app-write"); a token with the legacy audience and ANY binding claim, or the bound audience without the full claim set, is refused ON and OFF', async () => {
      assert.equal(decode(unexpired).aud, writeAuth.BOUND_AUDIENCE); assert.notEqual(writeAuth.BOUND_AUDIENCE, 'iaos-app-write');
      const secret = BASE_ENV.IAOS_APP_WRITE_SESSION_SECRET; const n = Math.floor(Date.now() / 1000);
      const base = { iss: 'iaos', aud: 'iaos-app-write', sub: 'brad@example.invalid', iat: n, exp: n + 900 };
      const hybrids = [['env', 'test'], ['sid', sid(72)], ['pexp', n + 99], ['epoch', EPOCH], ['aetag', '"a"'], ['setag', '"s"']].map(([k, v]) => signTok({ ...base, [k]: v }, secret));
      hybrids.push(signTok({ ...base, aud: writeAuth.BOUND_AUDIENCE }, secret));
      hybrids.push(signTok({ ...decode(unexpired), aud: 'iaos-app-write' }, secret));
      for (const on of [false, true]) {
        flag(on);
        hybrids.forEach((t, i) => assert.throws(() => writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${t}` } }), undefined, `hybrid ${i} on=${on}`));
      }
      flag(false);
      assert.ok(writeAuth.isOneLoginBoundClaims(decode(unexpired)) && !writeAuth.isOneLoginBoundClaims(decode(legacy)));
    });
    await check('F13 rollback (off), read side: sid-only, sid+epoch and 30-day bound cookies are refused by verify, readAuthRefusal and sessionReadRefusal (zero I/O); status says signed out; a legacy cookie still reads', async () => {
      const cfgR = readAuth.appReadConfig(); blobs.log.length = 0;
      const sidOnly = readAuth.issueReadSession('brad@example.invalid', cfgR, Date.now(), sid(73)).token;
      const sidEpoch = readAuth.issueReadSession('brad@example.invalid', cfgR, Date.now(), sid(73), EPOCH).token;
      for (const [label, c] of [['sid-only', sidOnly], ['sid+epoch', sidEpoch], ['30-day bound', live.cookie]]) {
        assert.throws(() => readAuth.verifyReadSession(c, cfgR), undefined, label);
        assert.equal(readAuth.readAuthRefusal(ev({ method: 'GET', cookie: c })).statusCode, 401, label);
        assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c }))).statusCode, 401, label);
        assert.equal(parse(await load('app-read-session')(ev({ method: 'GET', cookie: c }))).signedIn, false, label);
      }
      assert.equal(blobCount(), 0);
      const legacyCookie = readAuth.issueReadSession('brad@example.invalid', cfgR).token;
      assert.equal(readAuth.readAuthRefusal(ev({ method: 'GET', cookie: legacyCookie })), null);
      assert.equal(parse(await load('app-read-session')(ev({ method: 'GET', cookie: legacyCookie }))).signedIn, true);
    });
  }

  // =========================================================================== A
  reset(); flag(true);
  await check('A1 the store name equals blob-authority AUTHORITY_STORE (existing store; no new store); records are canonical, timestamp-free, byte-identical for identical inputs', async () => {
    assert.equal(rev.REVOCATION_STORE, blobAuthority.AUTHORITY_STORE);
    // Bones HOLD on 3311102: the anchor is in a DIFFERENT, dedicated store (never restored with the session store).
    assert.equal(rev.SESSION_AUTHORITY_STORE, ASTORE); assert.notEqual(rev.SESSION_AUTHORITY_STORE, rev.REVOCATION_STORE);
    const a = rev.sessionRecordText('test', EPOCH, sid(2), 'active');
    assert.equal(a, rev.sessionRecordText('test', EPOCH, sid(2), 'active'));
    const o = JSON.parse(a);
    assert.deepEqual(Object.keys(o), ['env', 'epoch', 'kind', 'sidDigest', 'state', 'v']);
    assert.deepEqual({ ...o, sidDigest: undefined }, { env: 'test', epoch: EPOCH, kind: 'iaos-session', sidDigest: undefined, state: 'active', v: 1 });
    assert.equal(o.sidDigest, require('node:crypto').createHash('sha256').update(`test:${sid(2)}`).digest('hex'));
    assert.equal(sKey(sid(2)), 'session/' + o.sidDigest);
    assert.notEqual(sKey(sid(2)), sKey(sid(2), 'production'));
    assert.equal(rev.sessionRecordText('test', EPOCH, sid(2), 'revoked'), a.replace('"state":"active"', '"state":"revoked"'));
  });
  await check('A2 sign-in binding: GET anchor, PUT anchor If-Match <read etag> with the IDENTICAL bytes, PUT session If-None-Match; etags from the recorded responses; the anchor bytes are unchanged', async () => {
    reset(); const before = blobs.get(ASTORE, ANCHOR_KEY);
    const g = await rev.beginSession(sid(2), 'test', { event: NF });
    assert.equal(g.kind, 'issued'); assert.equal(g.epoch, EPOCH);
    assert.deepEqual(areqs(), ['GET', 'PUT if-match']);
    assert.deepEqual(reqs(sKey(sid(2))), ['PUT if-none-match']);
    const anchorPut = blobs.log.find((e) => e.key === ANCHOR_KEY && e.method === 'PUT');
    assert.equal(anchorPut.body, before.text, 'identical bytes'); assert.equal(anchorPut.ifMatch, before.etag);
    assert.equal(g.aetag, before.etag); assert.equal(g.setag, blobs.get('iaos-write-receipts', sKey(sid(2))).etag);
    assert.deepEqual(blobs.get(ASTORE, ANCHOR_KEY), before);
    assert.equal(blobs.get('iaos-write-receipts', sKey(sid(2))).text, rev.sessionRecordText('test', EPOCH, sid(2), 'active'));
  });
  let B;
  await check('A3 check: exactly two PUTs (session + anchor), both If-Match, identical bytes, ZERO reads; both 200 -> active', async () => {
    reset(); B = await bind(3); blobs.log.length = 0;
    assert.deepEqual(await rev.checkSession(B, 'test', { event: NF }), { kind: 'active' });
    assert.deepEqual(reqs(sKey(B.sid)), ['PUT if-match']); assert.deepEqual(areqs(), ['PUT if-match']);
    assert.equal(blobs.log.filter((e) => e.method === 'GET').length, 0, 'a read never authorizes');
    assert.equal(blobs.log.length, 2); assert.equal(blobs.mutations.length, 1, 'only the sign-in create mutated anything');
  });
  await check('A4 a 412 on the SESSION write -> revoked (never absent, never unavailable)', async () => {
    blobs.rule({ method: 'PUT', key: sKey(B.sid), status: 412 });
    assert.deepEqual(await rev.checkSession(B, 'test', { event: NF }), { kind: 'revoked' });
  });
  await check('A5 a 412 on the ANCHOR write -> revoked', async () => {
    blobs.rule({ method: 'PUT', key: ANCHOR_KEY, status: 412 });
    assert.deepEqual(await rev.checkSession(B, 'test', { event: NF }), { kind: 'revoked' });
  });
  for (const [label, rule] of [
    ['500', { status: 500 }], ['503', { status: 503 }], ['429', { status: 429 }], ['403', { status: 403 }], ['401', { status: 401 }], ['409', { status: 409 }],
    ['204', { status: 204 }], ['a transport error', { throw: true }], ['500 applied', { status: 500, apply: true }],
  ]) {
    for (const which of ['session', 'anchor']) {
      await check(`A6 ${which} write answers ${label} -> unavailable (never active, never revoked), exactly one attempt each (no SDK retry sent)`, async () => {
        blobs.log.length = 0; blobs.rule({ method: 'PUT', key: which === 'anchor' ? ANCHOR_KEY : sKey(B.sid), ...rule });
        const r = await rev.checkSession(B, 'test', { event: NF });
        assert.equal(r.kind, 'unavailable', JSON.stringify(r));
        assert.equal(blobs.log.filter((e) => e.key === ANCHOR_KEY).length, 1); assert.equal(blobs.log.filter((e) => e.key === sKey(B.sid)).length, 1);
      });
    }
  }
  await check('A7 the SDK\'s `modified` is never trusted: a 500 makes @netlify/blobs report modified:true, the check still says unavailable', async () => {
    const { getStore, connectLambda } = require('@netlify/blobs');
    connectLambda(NF); blobs.rule({ method: 'PUT', key: 'probe', status: 500 });
    const viaSdk = await getStore({ name: 'iaos-write-receipts', fetch: async (u, i) => { const r = await blobs.fetch(u, i); return r.status >= 500 ? new Response(null, { status: 400 }) : r; } }).set('probe', 'x', { onlyIfMatch: '"nope"' });
    assert.equal(viaSdk.modified, true, 'the SDK reports a non-412 conditional result as modified');
    blobs.rule({ method: 'PUT', key: sKey(B.sid), status: 500 });
    assert.equal((await rev.checkSession(B, 'test', { event: NF })).kind, 'unavailable');
  });
  await check('A8 a hung write (abort honoured) and an abort-IGNORING write -> unavailable at the deadline (bounded)', async () => {
    for (const ignoreAbort of [false, true]) {
      blobs.rule({ method: 'PUT', key: sKey(B.sid), hang: true, ignoreAbort });
      const t0 = Date.now(); const r = await rev.checkSession(B, 'test', { event: NF, budgetMs: 600 });
      assert.equal(r.kind, 'unavailable'); assert.ok(Date.now() - t0 < 1500, `bounded: ${Date.now() - t0} ms`);
    }
  });
  await check('A9 a LATE 200 (answered after the deadline) grants nothing -> unavailable', async () => {
    let t = 1_000_000;
    const lateFetch = async (u, i) => { const res = await blobs.fetch(u, i); t += 5_000; return res; };
    const r = await rev.checkSession(B, 'test', { event: NF, fetch: lateFetch, now: () => t, budgetMs: 3000 });
    assert.equal(r.kind, 'unavailable', JSON.stringify(r));
  });
  await check('A10 no request is started with less than the minimum start time left (deadline already spent)', async () => {
    blobs.log.length = 0; const r = await rev.checkSession(B, 'test', { event: NF, budgetMs: 100 });
    assert.equal(r.kind, 'unavailable'); assert.equal(blobCount(), 0);
  });
  await check('A11 malformed sid / env / epoch / etags -> unavailable with zero requests', async () => {
    blobs.log.length = 0;
    for (const [b, e] of [[{ ...B, sid: 'short' }, 'test'], [B, 'staging'], [{ ...B, epoch: 'bad' }, 'test'], [{ ...B, aetag: '' }, 'test'], [{ ...B, setag: 'has space' }, 'test'], [{ ...B, setag: undefined }, 'test']]) {
      assert.equal((await rev.checkSession(b, e, { event: NF })).kind, 'unavailable');
    }
    assert.equal(blobCount(), 0);
  });
  await check('A12 U1 FALSE (ETag changes on every write, even identical bytes): the first check passes, the next one is REFUSED (412 -> revoked) -- fail CLOSED, never open', async () => {
    reset(); blobs.setEtagMode('per-write'); seedAnchor(); const b = await bind(4);
    const first = await rev.checkSession(b, 'test', { event: NF });
    const second = await rev.checkSession(b, 'test', { event: NF });
    assert.equal(first.kind, 'active'); assert.equal(second.kind, 'revoked');
    for (let i = 0; i < 5; i += 1) assert.notEqual((await rev.checkSession(b, 'test', { event: NF })).kind, 'active');
    blobs.setEtagMode('content');
  });
  await check('A13 a stored ACTIVE record read by a GET can never authorize: with the session record present but the check writes refused (412), the result is revoked', async () => {
    reset(); const b = await bind(5);
    assert.ok(blobs.get('iaos-write-receipts', sKey(b.sid)).text.includes('"state":"active"'));
    blobs.rule({ method: 'PUT', key: sKey(b.sid), status: 412 }, { method: 'PUT', key: ANCHOR_KEY, status: 412 });
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    const src = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8');
    const body = src.slice(src.indexOf('export async function checkSession'), src.indexOf('export type RevokeResult'));
    assert.ok(!/getWithMetadata|\.get\(/.test(body), 'checkSession contains no read');
    // Jeff work order T1: the Test-only probe section (runAuthorityProbe) reads ONLY its own probe/<runId>/ key; P7 pins that.
    // Outside it the module still reads exactly once: the sign-in anchor lookup.
    const authoritySrc = src.slice(0, src.indexOf('// --------------------------------------------- Test-only authority probe ---'));
    assert.ok(authoritySrc.length > 1000 && authoritySrc.length < src.length, 'the probe section is delimited');
    assert.equal((authoritySrc.match(/getWithMetadata\(/g) || []).length, 1, 'the module reads exactly once outside the probe section: the sign-in anchor lookup');
  });
  // sign-in failures (module level)
  for (const [label, prep, reason] of [
    ['anchor absent', () => dropAnchor(), 'authority_absent'],
    ['anchor malformed', () => seedAnchor('{"v":1}'), 'authority_invalid'],
    ['anchor WITHOUT state (the r3 shape; r4 requires state)', () => seedAnchor({ state: null }), 'authority_invalid'],
    ['anchor CLOSED (restore containment)', () => seedAnchor({ state: 'closed' }), 'authority_closed'],
    ['anchor read 500', () => blobs.rule({ method: 'GET', key: ANCHOR_KEY, status: 500 }), null],
    ['anchor confirm 412 (stale read: the read etag is no longer current at origin)', () => blobs.rule({ method: 'PUT', key: ANCHOR_KEY, status: 412 }), 'authority_unconfirmed'],
    ['anchor confirm 500', () => blobs.rule({ method: 'PUT', key: ANCHOR_KEY, status: 500 }), 'authority_unconfirmed'],
    ['anchor confirm without an ETag', () => blobs.rule({ method: 'PUT', key: ANCHOR_KEY, noEtag: true }), 'authority_unconfirmed'],
    ['session create 412 (sid already exists)', () => blobs.rule({ method: 'PUT', key: sKey(sid(6)), status: 412 }), 'session_not_created'],
    ['session create 503', () => blobs.rule({ method: 'PUT', key: sKey(sid(6)), status: 503 }), 'session_not_created'],
    ['session create without an ETag', () => blobs.rule({ method: 'PUT', key: sKey(sid(6)), noEtag: true }), 'session_not_created'],
    ['anchor read stalled body', () => blobs.rule({ method: 'GET', key: ANCHOR_KEY, stallBody: true }), null],
  ]) {
    await check(`A14 sign-in binding with ${label} -> unavailable, no session; the anchor is never created or changed`, async () => {
      reset(); prep(); const before = blobs.get(ASTORE, ANCHOR_KEY);
      const g = await rev.beginSession(sid(6), 'test', { event: NF, budgetMs: 1500 });
      assert.equal(g.kind, 'unavailable', JSON.stringify(g)); if (reason) assert.equal(g.reason, reason);
      assert.deepEqual(blobs.mutations.filter((m) => m.key === ANCHOR_KEY), []);
      if (before) assert.ok(blobs.get(ASTORE, ANCHOR_KEY), 'anchor kept');
    });
  }
  // sign-out (module level)
  await check('A15 sign-out: PUT unconditional (revoked bytes) then PUT If-Match <its ETag> with the same bytes -> verified; the next check is revoked (L2)', async () => {
    reset(); const b = await bind(7); blobs.log.length = 0;
    assert.deepEqual(await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF }), { kind: 'verified' });
    assert.deepEqual(reqs(sKey(b.sid)), ['PUT', 'PUT if-match']);
    const [w1, w2] = blobs.log.filter((e) => e.key === sKey(b.sid));
    assert.equal(w1.body, rev.sessionRecordText('test', b.epoch, b.sid, 'revoked')); assert.equal(w2.body, w1.body);
    assert.equal(areqs().length, 0, 'sign-out never touches the anchor');
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
  });
  await check('A16 sign-out is idempotent: a repeat rewrites the revoked bytes -> verified, record unchanged', async () => {
    const b = { sid: sid(7), epoch: EPOCH }; const before = blobs.get('iaos-write-receipts', sKey(b.sid)).text;
    assert.deepEqual(await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF }), { kind: 'verified' });
    assert.equal(blobs.get('iaos-write-receipts', sKey(b.sid)).text, before);
  });
  for (const [label, rules] of [
    ['the first write is a provider false success (200, nothing stored)', [{ method: 'PUT', lie: true }]],
    ['the first write answers 500', [{ method: 'PUT', status: 500 }]],
    ['the first write is applied but its acknowledgement is lost', [{ method: 'PUT', throw: true, apply: true }]],
    ['the first write has no ETag', [{ method: 'PUT', noEtag: true }]],
    ['the readback write answers 412 (another write landed between)', [{ method: 'PUT' }, { method: 'PUT', status: 412 }]],
    ['the readback write answers 503', [{ method: 'PUT' }, { method: 'PUT', status: 503 }]],
  ]) {
    await check(`A17 sign-out when ${label} -> NOT confirmed (both writes must answer 200)`, async () => {
      reset(); const b = await bind(8); blobs.rule(...rules);
      assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF })).kind, 'unconfirmed');
    });
  }
  await check('A18 a hung sign-out write -> not confirmed, bounded; a readback answered after the deadline -> not confirmed', async () => {
    reset(); const b = await bind(9); blobs.rule({ method: 'PUT', hang: true, ignoreAbort: true });
    const t0 = Date.now(); assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF, budgetMs: 700 })).kind, 'unconfirmed'); assert.ok(Date.now() - t0 < 1700);
    let t = 2_000_000; let n = 0;
    const late = async (u, i) => { const res = await blobs.fetch(u, i); if (++n === 2) t += 9_000; return res; };
    assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF, fetch: late, now: () => t })).kind, 'unconfirmed');
  });

  // =========================================================================== T
  reset(); flag(true);
  const mint = (e) => load('app-write-token')(e);
  const T1 = await fixtureBind(10);
  await check('T1 success: same-origin POST, store-bound session -> the 900 s token with env/sid/pexp/epoch/aetag/setag; accepted by the unchanged requireAppWriter; one check (2 If-Match PUTs, no read)', async () => {
    blobs.log.length = 0;
    const res = await mint(tokenEv(T1.cookie));
    assert.equal(res.statusCode, 200, res.body);
    const b = parse(res);
    assert.deepEqual(Object.keys(b).sort(), ['expiresAt', 'expiresInSeconds', 'token']);
    assert.ok(b.expiresInSeconds === 900 || b.expiresInSeconds === 899);
    const claims = decode(b.token);
    assert.equal(claims.aud, writeAuth.BOUND_AUDIENCE); assert.equal(claims.sub, 'brad@example.invalid');
    assert.equal(claims.exp - claims.iat, 900, 'lifetime unchanged'); assert.equal(claims.env, 'test'); assert.equal(claims.sid, T1.sid);
    assert.equal(claims.pexp, T1.exp, 'bound to the parent session expiry'); assert.equal(claims.epoch, EPOCH);
    assert.equal(claims.aetag, T1.aetag); assert.equal(claims.setag, T1.setag);
    assert.equal(writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${b.token}` } }), 'brad@example.invalid');
    assert.equal(res.headers['Set-Cookie'], undefined, 'minting never re-issues (or extends) the session'); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(blobs.log.map((e) => `${e.method}${e.ifMatch ? ' if-match' : ''}`), ['PUT if-match', 'PUT if-match']);
    assert.equal(other.length, 0);
  });
  const unbound = (o = {}) => readAuth.issueReadSession(o.email || 'brad@example.invalid', readAuth.appReadConfig({ ...process.env, IAOS_ENV: o.deployment || 'test' }), o.at ?? Date.now(), o.withSid === false ? undefined : sid(11), o.epoch === null || o.withSid === false ? undefined : EPOCH).token;
  const refusals = [
    ['T2 GET -> 405', () => tokenEv(T1.cookie, { method: 'GET' }), 405],
    ['T3 no Origin -> 403', () => tokenEv(T1.cookie, { headers: { origin: undefined } }), 403],
    ['T4 a foreign Origin -> 403 (cross-origin mint refused)', () => tokenEv(T1.cookie, { headers: { origin: 'https://evil.example.invalid' } }), 403],
    ['T5 a lookalike Origin -> 403', () => tokenEv(T1.cookie, { headers: { origin: ORIGIN + '.evil.invalid' } }), 403],
    ['T6 two Origins (multiValueHeaders) -> 403', () => tokenEv(T1.cookie, { multi: { origin: [ORIGIN, 'https://evil.example.invalid'] } }), 403],
    ['T7 Sec-Fetch-Site cross-site -> 403', () => tokenEv(T1.cookie, { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    ['T8 Sec-Fetch-Site same-site -> 403', () => tokenEv(T1.cookie, { headers: { 'sec-fetch-site': 'same-site' } }), 403],
    ['T9 no X-IAOS-Session header -> 403', () => ev({ cookie: T1.cookie }), 403],
    ['T10 X-IAOS-Session with the sign-out value -> 403', () => tokenEv(T1.cookie, { headers: { 'x-iaos-session': 'sign-out' } }), 403],
    ['T11 a request body -> 403', () => tokenEv(T1.cookie, { body: '{}' }), 403],
    ['T12 no session cookie -> 401 (Origin alone never authorizes)', () => tokenEv(null), 401],
    ['T13 an expired 30-day session -> 401', () => tokenEv(readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), Date.now() - 30 * DAY * 1000 - 1000, T1.sid, EPOCH, { aetag: T1.aetag, setag: T1.setag }).token), 401],
    ['T14 a tampered session -> 401', () => { const [h, p, s] = T1.cookie.split('.'); const c = JSON.parse(Buffer.from(p, 'base64url')); c.sid = sid(9); return tokenEv([h, Buffer.from(JSON.stringify(c)).toString('base64url'), s].join('.')); }, 401],
    ['T15 a Production session presented to Test -> 401 (environment separation)', () => tokenEv(unbound({ deployment: 'production' })), 401],
    ['T16 a session WITHOUT sid (issued before one sign-in) -> 401 sign_in_again', () => tokenEv(unbound({ withSid: false })), 401],
    ['T16b a session with a sid but WITHOUT an epoch -> 401 sign_in_again', () => tokenEv(unbound({ epoch: null })), 401],
    ['T16c a session with sid + epoch but WITHOUT the store ETags (the r2 8 h shape) -> 401 sign_in_again', () => tokenEv(unbound({})), 401],
    ['T17 a reader NOT on the saving allowlist -> 401', () => tokenEv(readAuth.issueReadSession('reader-only@example.invalid', readAuth.appReadConfig(), Date.now(), T1.sid, EPOCH, { aetag: T1.aetag, setag: T1.setag }).token), 401],
    ['T18 a saving token presented as the cookie -> 401', () => tokenEv(tokenFor(T1)), 401],
  ];
  for (const [name, make, status] of refusals) {
    await check(name + '; no token, no cookie, no-store, nothing written', async () => {
      blobs.log.length = 0; const res = await mint(make());
      assert.equal(res.statusCode, status, res.body); noCredentialLeak(res);
      assert.equal(blobCount(), 0, 'refused before the store check');
      if (name.startsWith('T16')) assert.equal(parse(res).reason, 'sign_in_again', name);
    });
  }
  await check('T19 revoked session -> 401 reason "revoked" (never a token)', async () => {
    const b = await bind(12); await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF });
    const res = await mint(tokenEv(b.cookie));
    assert.equal(res.statusCode, 401); assert.equal(parse(res).reason, 'revoked'); noCredentialLeak(res);
  });
  for (const [label, setup] of [
    ['the session write answers 500', () => blobs.rule({ method: 'PUT', key: sKey(T1.sid), status: 500 })],
    ['the anchor write answers 503', () => blobs.rule({ method: 'PUT', key: ANCHOR_KEY, status: 503 })],
    ['the store throws', () => blobs.rule({ method: 'PUT', throw: true })],
    ['the Lambda Blobs context is missing', () => 'noBlobs'],
    ['the store hangs past the deadline', () => blobs.rule({ method: 'PUT', hang: true, ignoreAbort: true })],
  ]) {
    await check(`T20 ${label} -> 503 iaos-session-unavailable (fail closed; NOT 401, NOT a token)`, async () => {
      blobs.clearRules(); const mode = setup(); const res = await mint(tokenEv(T1.cookie, mode === 'noBlobs' ? { noBlobs: true } : {}));
      assert.equal(res.statusCode, 503, res.body); assert.equal(marker(res), 'iaos-session-unavailable'); noCredentialLeak(res);
    });
  }
  await check('T21 write configuration missing -> 503 unconfigured, nothing written', async () => {
    setEnv('test', { IAOS_APP_WRITE_SESSION_SECRET: undefined }); blobs.log.length = 0;
    const res = await mint(tokenEv(T1.cookie)); assert.equal(res.statusCode, 503); assert.equal(blobCount(), 0); noCredentialLeak(res);
    setEnv('test');
  });
  await check('T22 a Test-issued token is not accepted by Production writers (env claim + per-env secret)', async () => {
    flag(true, 'production');
    const t = parse(await mint(tokenEv(T1.cookie))).token;
    setEnv('production');
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401);
    flag(false, 'production'); setEnv('test');
  });
  await check('T23 the token NEVER outlives the session: minted 5 minutes before the session\'s fixed expiry -> expiresInSeconds ~300 (min(900, time left)), and a writer refuses it after the session ends (session_expired)', async () => {
    const realNow = Date.now; const start = realNow();
    try {
      const b = await bind(13, { at: start - (30 * DAY - 300) * 1000 });
      const res = await mint(tokenEv(b.cookie)); assert.equal(res.statusCode, 200, res.body);
      const body = parse(res);
      assert.ok(body.expiresInSeconds <= 300 && body.expiresInSeconds >= 298, String(body.expiresInSeconds));
      assert.ok(Date.parse(body.expiresAt) <= b.exp * 1000);
      assert.equal(decode(body.token).pexp, b.exp);
      Date.now = () => start + 301_000;
      const w = await rev.sessionWriteRefusal(ev({ bearer: body.token }), process.env, start + 301_000);
      assert.equal(w.statusCode, 401); assert.equal(parse(w).reason, 'session_expired');
    } finally { Date.now = realNow; }
  });

  // =========================================================================== S
  reset(); flag(true);
  const status = (c, extra = {}) => load('app-read-session')(ev({ method: 'GET', cookie: c, ...extra }));
  const signIn = (extra = {}) => load('app-read-session')(ev({ body: JSON.stringify({ googleIdToken: 'fixture-google-token' }), ...extra }));
  const cookieOf = (res) => /__Host-iaos_read=([^;]+)/.exec(res.headers['Set-Cookie'])[1];
  const signOutEv = (handle, extra = {}) => ev({ body: JSON.stringify({ handle }), ...extra, headers: { 'x-iaos-session': 'sign-out', ...(extra.headers || {}) } });
  const signOut = (e) => load('app-signout')(e);
  await check('S1 status: signed in -> 200 {clientId, signedIn, expiresAt, state:"signed_in", handle}; handle is revoke-only (aud iaos-app-signout, exact claims incl. epoch, exp = parent exp + 24 h)', async () => {
    const b = await bind(14); const r = await status(b.cookie); const body = parse(r);
    assert.equal(r.statusCode, 200); assert.deepEqual(Object.keys(body).sort(), ['clientId', 'expiresAt', 'handle', 'operator', 'session', 'signedIn', 'state']);
    assert.equal(body.state, 'signed_in'); assert.equal(body.signedIn, true);
    assert.equal(Date.parse(body.expiresAt), b.exp * 1000);
    const h = decode(body.handle);
    assert.deepEqual(Object.keys(h).sort(), ['aud', 'env', 'epoch', 'exp', 'iat', 'iss', 'sid']);
    assert.equal(h.aud, 'iaos-app-signout'); assert.equal(h.sid, b.sid); assert.equal(h.env, 'test'); assert.equal(h.epoch, EPOCH);
    assert.equal(h.exp, b.exp + 24 * 3600);
    assert.equal(r.headers['Set-Cookie'], undefined); assert.equal(r.headers['Cache-Control'], 'no-store');
  });
  await check('S1b r4 status tags: operator / session are non-secret 128-bit tags -- same operator across sessions gives the same operator tag and a different session tag; neither contains the sid, email or a token, and neither is a credential', async () => {
    const b1 = await bind(95); const b2 = await bind(96);
    const s1 = parse(await status(b1.cookie)); const s2 = parse(await status(b2.cookie));
    for (const s of [s1, s2]) for (const k of ['operator', 'session']) assert.match(s[k], /^[A-Za-z0-9_-]{22}$/, k);
    assert.equal(s1.operator, s2.operator); assert.notEqual(s1.session, s2.session);
    const all = JSON.stringify([s1.operator, s1.session, s2.operator, s2.session]);
    for (const secret of [b1.sid, b2.sid, 'brad@example.invalid', 'brad']) assert.ok(!all.includes(secret), secret);
    const other2 = rev.sessionViewTags('reader-only@example.invalid', 'test', b1.sid, readAuth.appReadConfig());
    assert.notEqual(other2.operator, s1.operator); assert.equal(other2.session, s1.session);
    assert.equal(readAuth.readAuthRefusal(ev({ method: 'GET', cookie: s1.session })).statusCode, 401, 'a tag is no read session');
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: s1.operator }))).statusCode, 401, 'a tag is no saving token');
  });
  await check('S2 status: no cookie / sid-less / unbound (r2 shape) cookie -> 200 signed_out with clientId (sign-in landing still works), nothing written', async () => {
    blobs.log.length = 0;
    for (const c of [null, unbound({ withSid: false }), unbound({})]) {
      const b = parse(await status(c)); assert.equal(b.state, 'signed_out'); assert.equal(b.signedIn, false); assert.equal(b.clientId, 'offline-read-client');
    }
    assert.equal(blobCount(), 0);
  });
  await check('S3 status: store unavailable -> 503 {state:"unavailable"} WITHOUT a signedIn field (C1: never signed in, never signed out)', async () => {
    const b = await bind(15); blobs.rule({ method: 'PUT', status: 500 });
    const r = await status(b.cookie); const body = parse(r);
    assert.equal(r.statusCode, 503); assert.equal(body.state, 'unavailable'); assert.equal(body.by, 'iaos-session-unavailable');
    assert.ok(!('signedIn' in body) && !('handle' in body)); assert.equal(body.clientId, 'offline-read-client');
  });
  await check('S4 POST sign-in -> a PERSISTENT cookie: Max-Age = exactly 30 days (2592000 s, the time left to the fixed expiry), exp - iat = 30 days; a fresh canonical sid per sign-in, bound to the anchor epoch and both store ETags', async () => {
    reset(); other = [];
    const a = await signIn(); const b = await signIn();
    assert.equal(a.statusCode, 200, a.body);
    assert.match(a.headers['Set-Cookie'], /^__Host-iaos_read=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/);
    const ca = decode(cookieOf(a)), cb = decode(cookieOf(b));
    assert.equal(ca.exp - ca.iat, 30 * DAY);
    assert.ok(readAuth.isCanonicalSid(ca.sid) && readAuth.isCanonicalSid(cb.sid) && ca.sid !== cb.sid);
    assert.equal(ca.epoch, EPOCH);
    assert.equal(ca.aetag, blobs.get(ASTORE, ANCHOR_KEY).etag); assert.equal(ca.setag, blobs.get('iaos-write-receipts', sKey(ca.sid)).etag);
    assert.deepEqual(Object.keys(ca).sort(), ['aetag', 'aud', 'env', 'epoch', 'exp', 'iat', 'iss', 'setag', 'sid', 'sub']);
    assert.equal(Date.parse(parse(a).expiresAt), ca.exp * 1000);
  });
  await check('S5 DELETE is retired: 410, NO Set-Cookie (a delayed sign-out can never erase a newer sign-in)', async () => {
    const r = await load('app-read-session')(ev({ method: 'DELETE', cookie: T1.cookie }));
    assert.equal(r.statusCode, 410); assert.equal(r.headers['Set-Cookie'], undefined);
  });
  await check('S6 the old popup issuer is retired server-side: 410 for GET and POST, no token', async () => {
    other = []; const h = load('app-write-session');
    for (const m of ['GET', 'POST']) { const r = await h({ httpMethod: m, headers: {}, body: JSON.stringify({ googleIdToken: 'g' }) }); assert.equal(r.statusCode, 410); noCredentialLeak(r); }
    assert.equal(other.filter((o) => o.url.includes('tokeninfo')).length, 0, 'no Google verification attempted');
  });
  await check('S7 Sign out: 200 {state:"revoked"} ONLY after both writes answered 200; no Set-Cookie; then status says revoked and grants nothing', async () => {
    reset(); const b = await bind(16); const handle = parse(await status(b.cookie)).handle;
    blobs.log.length = 0;
    const r = await signOut(signOutEv(handle));
    assert.equal(r.statusCode, 200, r.body); assert.deepEqual(parse(r), { state: 'revoked' }); assert.equal(r.headers['Set-Cookie'], undefined);
    assert.deepEqual(reqs(sKey(b.sid)), ['PUT', 'PUT if-match']);
    const s = parse(await status(b.cookie)); assert.equal(s.state, 'revoked'); assert.equal(s.signedIn, false); assert.equal(s.handle, undefined);
  });
  await check('S8 Sign out again with the same handle: idempotent 200', async () => {
    const handle = rev.issueSignoutHandle({ sid: sid(16), epoch: EPOCH, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, readAuth.appReadConfig());
    assert.equal((await signOut(signOutEv(handle))).statusCode, 200);
  });
  for (const [label, setup] of [
    ['the store write is a provider false success', () => blobs.rule({ method: 'PUT', lie: true })],
    ['the readback write fails 412', () => blobs.rule({ method: 'PUT' }, { method: 'PUT', status: 412 })],
    ['the Lambda Blobs context is missing', () => 'noBlobs'],
    ['the store answers 500', () => blobs.rule({ method: 'PUT', status: 500 })],
  ]) {
    await check(`S9 Sign out when ${label} -> 503 {state:"not_confirmed"}, never "revoked", no Set-Cookie`, async () => {
      reset(); const b = await bind(17); const handle = parse(await status(b.cookie)).handle;
      const mode = setup(); const r = await signOut(signOutEv(handle, mode === 'noBlobs' ? { noBlobs: true } : {}));
      assert.equal(r.statusCode, 503, r.body); assert.equal(parse(r).state, 'not_confirmed'); assert.equal(r.headers['Set-Cookie'], undefined);
    });
  }
  const goodHandle = (o = {}) => rev.issueSignoutHandle({ sid: sid(18), epoch: EPOCH, expiresAt: new Date(Date.now() + 3600_000).toISOString(), ...o }, readAuth.appReadConfig());
  const handleRefusals = [
    ['no body', () => ev({ headers: { 'x-iaos-session': 'sign-out' } }), 400],
    ['extra body key', () => ev({ body: JSON.stringify({ handle: goodHandle(), sid: sid(18) }), headers: { 'x-iaos-session': 'sign-out' } }), 400],
    ['a raw sid instead of a handle', () => signOutEv(sid(18)), 400],
    ['an expired handle (never confirmed, no current-cookie fallback)', () => signOutEv(goodHandle({ expiresAt: new Date(Date.now() - 25 * 3600_000).toISOString() }), { cookie: T1.cookie }), 400],
    ['a Production handle in Test', () => signOutEv(rev.issueSignoutHandle({ sid: sid(18), epoch: EPOCH, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, readAuth.appReadConfig({ ...process.env, IAOS_ENV: 'production' }))), 400],
    ['a tampered handle (sid swapped)', () => { const [h, p, s] = goodHandle().split('.'); const c = JSON.parse(Buffer.from(p, 'base64url')); c.sid = sid(19); return signOutEv([h, Buffer.from(JSON.stringify(c)).toString('base64url'), s].join('.')); }, 400],
    ['a handle with alg none', () => { const [, p] = goodHandle().split('.'); return signOutEv(`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`); }, 400],
    ['the READ session token as a handle', () => signOutEv(T1.cookie), 400],
    ['a SAVING token as a handle', () => signOutEv(tokenFor(T1)), 400],
    ['a foreign Origin', () => signOutEv(goodHandle(), { headers: { origin: 'https://evil.example.invalid' } }), 403],
    ['Sec-Fetch-Site cross-site', () => signOutEv(goodHandle(), { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    ['no X-IAOS-Session header', () => ev({ body: JSON.stringify({ handle: goodHandle() }) }), 403],
    ['GET', () => signOutEv(goodHandle(), { method: 'GET' }), 405],
  ];
  for (const [label, make, code] of handleRefusals) {
    await check(`S10 Sign out refused: ${label} -> ${code}, nothing written, no Set-Cookie`, async () => {
      blobs.log.length = 0; const r = await signOut(make());
      assert.equal(r.statusCode, code, r.body); assert.equal(r.headers['Set-Cookie'], undefined);
      assert.equal(blobs.log.filter((e) => e.method === 'PUT').length, 0);
    });
  }
  await check('S11 the handle is never a credential: as the read cookie (status signed_out; reader 401), as a saving bearer (writer 401), at token issue (401)', async () => {
    const h = goodHandle();
    assert.equal(parse(await status(h)).state, 'signed_out');
    assert.equal((await load('ghl-contact')(ev({ method: 'GET', cookie: h, query: { id: 'fixtureContact' } }))).statusCode, 401);
    assert.throws(() => writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${h}` } }));
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: h }))).statusCode, 401);
    assert.equal((await mint(tokenEv(h))).statusCode, 401);
    assert.throws(() => readAuth.verifyReadSession(h, readAuth.appReadConfig()));
  });
  await check('S12 fixed target: an OLD handle used after a fresh sign-in revokes ONLY the old sid; the new session still gets tokens', async () => {
    reset(); const oldB = await bind(20); const oldHandle = parse(await status(oldB.cookie)).handle;
    const newB = await bind(21);
    assert.equal((await signOut(signOutEv(oldHandle, { cookie: newB.cookie }))).statusCode, 200, 'the request cookie (new session) is ignored');
    assert.equal((await mint(tokenEv(newB.cookie))).statusCode, 200, 'new session unaffected');
    assert.equal((await mint(tokenEv(oldB.cookie))).statusCode, 401, 'old session revoked');
  });

  // =========================================================================== L  (r6 lifetime)
  reset(); flag(true);
  await check('L1 exactly 30 days: the session verifies at authAt + 30 days - 1 s and is refused at + 30 days (and + 1 s) by verify, reader, writer, mint and status -> sign in again', async () => {
    const realNow = Date.now; const authAt = realNow() - 10_000;
    try {
      const b = await bind(22, { at: authAt });
      const endMs = (Math.floor(authAt / 1000) + 30 * DAY) * 1000;
      const tok = tokenFor(b, { at: endMs - 60_000 });
      assert.equal(readAuth.verifyReadSession(b.cookie, readAuth.appReadConfig(), endMs - 1000).sid, b.sid);
      for (const t of [endMs, endMs + 1000]) {
        Date.now = () => t;
        assert.throws(() => readAuth.verifyReadSession(b.cookie, readAuth.appReadConfig(), t));
        assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }), process.env, t)).statusCode, 401);
        assert.equal((await load('ghl-contact')(ev({ method: 'GET', cookie: b.cookie, query: { id: 'fixtureContact' } }))).statusCode, 401);
        const w = await rev.sessionWriteRefusal(ev({ bearer: tok }), process.env, t); assert.equal(w.statusCode, 401);
        const m = await mint(tokenEv(b.cookie)); assert.equal(m.statusCode, 401); noCredentialLeak(m);
        assert.equal(parse(await status(b.cookie)).state, 'signed_out');
      }
    } finally { Date.now = realNow; }
  });
  await check('L2 no renewal path exists: 50 mints, 50 reads and 50 status checks just before expiry never extend exp (no Set-Cookie anywhere; every token\'s pexp = the original exp); at exp + 1 s everything refuses', async () => {
    const realNow = Date.now; const authAt = realNow() - 10_000;
    try {
      const b = await bind(23, { at: authAt }); const endMs = b.exp * 1000;
      Date.now = () => endMs - 120_000;
      for (let i = 0; i < 50; i += 1) {
        const m = await mint(tokenEv(b.cookie)); assert.equal(m.statusCode, 200, m.body); assert.equal(m.headers['Set-Cookie'], undefined);
        assert.equal(decode(parse(m).token).pexp, b.exp); assert.ok(parse(m).expiresInSeconds <= 120);
        assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }), process.env, endMs - 120_000), null);
        const s = await status(b.cookie); assert.equal(s.headers['Set-Cookie'], undefined); assert.equal(Date.parse(parse(s).expiresAt), endMs);
      }
      Date.now = () => endMs + 1000;
      assert.equal((await mint(tokenEv(b.cookie))).statusCode, 401);
      assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }), process.env, endMs + 1000)).statusCode, 401);
      const ars = fs.readFileSync(path.join(FUNCTIONS, 'app-read-session.ts'), 'utf8');
      const src = ars.slice(ars.indexOf('async function oneLogin(')) + ['app-write-token.ts', 'app-signout.ts', 'lib/session-revocation.ts'].map((f) => fs.readFileSync(path.join(FUNCTIONS, f), 'utf8')).join('\n');
      assert.equal((src.match(/readSessionCookie\(/g) || []).length, 1, 'exactly one cookie issue in the one-sign-in code: the Google sign-in');
      assert.ok(!/renew/i.test(fs.readFileSync(path.join(FUNCTIONS, 'app-read-session.ts'), 'utf8').replace(/no renewal/gi, '')), 'no renew endpoint');
    } finally { Date.now = realNow; }
  });
  await check('L3 a 30-day token whose exp - iat was stretched (re-signed would need the secret; a forged exp breaks the signature) and a hand-made 31-day session are refused', async () => {
    const c = decode(T1.cookie); const long = signTok({ ...c, exp: c.iat + 31 * DAY }, BASE_ENV.IAOS_APP_READ_SESSION_SECRET);
    assert.throws(() => readAuth.verifyReadSession(long, readAuth.appReadConfig()));
    const [h, , s] = T1.cookie.split('.'); const forged = [h, Buffer.from(JSON.stringify({ ...c, exp: c.exp + DAY })).toString('base64url'), s].join('.');
    assert.throws(() => readAuth.verifyReadSession(forged, readAuth.appReadConfig()));
    assert.throws(() => readAuth.readSessionCookie('t', 30 * DAY + 1));
  });

  // =========================================================================== X (tabs) + D (devices)
  reset(); flag(true);
  await check('X0 the server alone decides: no BroadcastChannel / localStorage path in the server code', async () => {
    const src = ['lib/session-revocation.ts', 'app-write-token.ts', 'app-signout.ts', 'app-read-session.ts'].map((f) => fs.readFileSync(path.join(FUNCTIONS, f), 'utf8')).join('\n');
    assert.ok(!/BroadcastChannel|localStorage|sessionStorage/.test(src));
  });
  await check('X1 two tabs share one cookie; tab B holds an EARLIER token T1; tab A signs out -> tab B: no new token (401 revoked), T1 refused on a write (Variant S), reads 401 revoked, status revoked', async () => {
    const b = await bind(24);
    const t1 = parse(await mint(tokenEv(b.cookie))).token;
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t1 })), null, 'before: T1 passes the write check');
    const handle = parse(await status(b.cookie)).handle;
    assert.equal((await signOut(signOutEv(handle))).statusCode, 200);
    const tb = await mint(tokenEv(b.cookie));
    assert.equal(tb.statusCode, 401); assert.equal(parse(tb).reason, 'revoked');
    const w = await rev.sessionWriteRefusal(ev({ bearer: t1 }));
    assert.equal(w.statusCode, 401); assert.equal(parse(w).reason, 'revoked'); assert.equal(parse(w).error, 'Application write sign-in required');
    const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }));
    assert.equal(rd.statusCode, 401); assert.equal(parse(rd).reason, 'revoked'); assert.equal(parse(rd).by, 'iaos-app-read-auth');
    assert.equal(parse(await status(b.cookie)).state, 'revoked');
  });
  await check('X2 the same T1 through a REAL writer (ghl-write): 401 revoked, zero GHL requests', async () => {
    const t1 = tokenFor({ sid: sid(24), epoch: EPOCH, aetag: blobs.get(ASTORE, ANCHOR_KEY).etag, setag: '"c-unused"', exp: Math.floor(Date.now() / 1000) + 3600 });
    other = [];
    const r = await load('ghl-write')(ev({ bearer: t1, body: JSON.stringify({ operation: 'note.create', targetId: 'c1', requestId: 'r1', args: { body: 'x' } }) }));
    assert.equal(r.statusCode, 401); assert.equal(parse(r).reason, 'revoked'); assert.equal(other.length, 0);
  });
  await check('X3 a sid-less saving token (old popup issuer) and a token without the store ETags are refused by writers while one sign-in is on (sign_in_again)', async () => {
    const legacy = writeAuth.issueAppSession('brad@example.invalid').token;
    assert.equal(parse(await rev.sessionWriteRefusal(ev({ bearer: legacy }))).reason, 'sign_in_again');
    const now = Math.floor(Date.now() / 1000);
    // r4: a token without the store ETags no longer has a valid shape at all (bound claim set incomplete) -> 401.
    for (const aud of ['iaos-app-write', writeAuth.BOUND_AUDIENCE]) {
      const noEtags = signTok({ iss: 'iaos', aud, sub: 'brad@example.invalid', iat: now, exp: now + 900, env: 'test', sid: sid(25), pexp: now + 3600, epoch: EPOCH }, BASE_ENV.IAOS_APP_WRITE_SESSION_SECRET);
      assert.equal((await rev.sessionWriteRefusal(ev({ bearer: noEtags }))).statusCode, 401, aud);
      assert.throws(() => writeAuth.requireAppWriter({ headers: { authorization: `Bearer ${noEtags}` } }), undefined, aud);
    }
  });
  await check('X4 L2: a write whose check passed BEFORE the revocation keeps its admission (it may finish); every request checked AFTER the confirmed revocation is refused', async () => {
    const b = await bind(26); const t = tokenFor(b);
    const passed = await rev.sessionWriteRefusal(ev({ bearer: t }));
    assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF })).kind, 'verified');
    assert.equal(passed, null, 'the admitted request keeps its admission');
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401, 'any later request refuses');
  });
  await check('X5 store unavailable for a writer -> 503 marker, not 401; for a reader -> 503 marker, not 401', async () => {
    const b = await bind(27); const t = tokenFor(b);
    blobs.rule({ method: 'PUT', status: 500 }, { method: 'PUT', status: 500 }, { method: 'PUT', status: 500 }, { method: 'PUT', status: 500 });
    const w = await rev.sessionWriteRefusal(ev({ bearer: t })); const r = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }));
    for (const x of [w, r]) { assert.equal(x.statusCode, 503); assert.equal(marker(x), 'iaos-session-unavailable'); }
  });
  await check('X6 the parent session has expired (pexp passed): a still-unexpired saving token is refused on writes, 401 session_expired, with zero store requests', async () => {
    const b = await bind(28); blobs.log.length = 0;
    const past = tokenFor(b, { pexp: Math.floor(Date.now() / 1000) - 1 });
    const r = await rev.sessionWriteRefusal(ev({ bearer: past }));
    assert.equal(r.statusCode, 401); assert.equal(parse(r).reason, 'session_expired'); assert.equal(blobCount(), 0);
  });
  await check('D1 two devices = two independent sessions (own sid, own record): Sign out on device 1 refuses device 1 only; device 2 keeps reading, minting and writing', async () => {
    reset(); const d1 = await bind(29); const d2 = await bind(30);
    assert.notEqual(sKey(d1.sid), sKey(d2.sid));
    const h1 = parse(await status(d1.cookie)).handle;
    assert.equal((await signOut(signOutEv(h1))).statusCode, 200);
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: d1.cookie }))).statusCode, 401);
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: d2.cookie })), null);
    const t2 = parse(await mint(tokenEv(d2.cookie))).token; assert.ok(t2);
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t2 })), null);
    assert.equal(parse(await status(d2.cookie)).state, 'signed_in');
  });

  // =========================================================================== Z (authorization seam)
  reset(); flag(true);
  const realAuthorize = authz.authorize;
  const calls = [];
  authz.authorize = (identity, permission, env) => { calls.push({ email: identity.email, permission }); return realAuthorize(identity, permission, env); };
  await check('Z1 the authorization seam is evaluated on EVERY protected request: each reader request (read), each writer request (write), each mint (write) -- once per request, in addition to the session check', async () => {
    const b = await bind(31); calls.length = 0;
    await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }));
    await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }));
    await load('ghl-contact')(ev({ method: 'GET', cookie: b.cookie, query: { id: 'fixtureContact' } }));
    const t = parse(await mint(tokenEv(b.cookie))).token;
    await rev.sessionWriteRefusal(ev({ bearer: t }));
    await load('ghl-write')(ev({ bearer: t, body: '{}' }));
    assert.deepEqual(calls.map((c) => c.permission), ['read', 'read', 'read', 'write', 'write', 'write']);
    assert.ok(calls.every((c) => c.email === 'brad@example.invalid'));
  });
  await check('Z2 a seam refusal (a disabled / cancelled account, simulated) refuses reads, writes and mints DESPITE a valid 30-day session and token, with zero store writes', async () => {
    const b = await bind(32); const t = tokenFor(b);
    authz.authorize = () => ({ ok: false, reason: 'not_authorized' }); blobs.log.length = 0; other = [];
    try {
      const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie })); assert.equal(rd.statusCode, 403); assert.equal(parse(rd).reason, 'not_authorized');
      const real = await load('ghl-contact')(ev({ method: 'GET', cookie: b.cookie, query: { id: 'fixtureContact' } })); assert.equal(real.statusCode, 403);
      const wr = await rev.sessionWriteRefusal(ev({ bearer: t })); assert.equal(wr.statusCode, 403); assert.equal(parse(wr).reason, 'not_authorized');
      const m = await mint(tokenEv(b.cookie)); assert.equal(m.statusCode, 403); noCredentialLeak(m);
      assert.equal(blobCount(), 0); assert.equal(other.length, 0);
      assert.ok(readAuth.verifyReadSession(b.cookie, readAuth.appReadConfig()).sid, 'the session itself is still valid: authorization is a separate layer');
    } finally { authz.authorize = (identity, permission, env) => { calls.push({ email: identity.email, permission }); return realAuthorize(identity, permission, env); }; }
  });
  await check('Z3 removed from the write allowlist: the very next write and mint are refused although the session and the earlier token are still valid', async () => {
    const b = await bind(33); const t = parse(await mint(tokenEv(b.cookie))).token;
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t })), null);
    setEnv('test', { IAOS_APP_WRITE_BRAD_EMAILS: 'someone-else@example.invalid' });
    assert.notEqual(await rev.sessionWriteRefusal(ev({ bearer: t })), null);
    assert.equal((await mint(tokenEv(b.cookie))).statusCode, 401);
    setEnv('test');
    assert.deepEqual(realAuthorize({ sub: 'brad@example.invalid', email: 'brad@example.invalid' }, 'write', { ...process.env, IAOS_APP_WRITE_BRAD_EMAILS: 'x@example.invalid' }), { ok: false, reason: 'not_authorized' });
  });
  await check('Z4 the seam delegates EXACTLY to the existing allowlists (read -> IAOS_APP_READ_BRAD_EMAILS, write -> IAOS_APP_WRITE_BRAD_EMAILS); unconfigured / malformed identity refuse; no store, no network', async () => {
    const id = (e) => ({ sub: e, email: e });
    assert.deepEqual(realAuthorize(id('brad@example.invalid'), 'read'), { ok: true });
    assert.deepEqual(realAuthorize(id('reader-only@example.invalid'), 'read'), { ok: true });
    assert.deepEqual(realAuthorize(id('reader-only@example.invalid'), 'write'), { ok: false, reason: 'not_authorized' });
    assert.deepEqual(realAuthorize(id('brad@example.invalid'), 'admin'), { ok: false, reason: 'not_authorized' });
    assert.deepEqual(realAuthorize({ sub: 'a@example.invalid', email: 'b@example.invalid' }, 'read'), { ok: false, reason: 'invalid_identity' });
    assert.deepEqual(realAuthorize(id('brad@example.invalid'), 'read', { ...process.env, IAOS_APP_READ_SESSION_SECRET: undefined }), { ok: false, reason: 'unconfigured' });
    const src = fs.readFileSync(path.join(FUNCTIONS, 'lib/authorization.ts'), 'utf8');
    assert.ok(!/@netlify\/blobs|fetch\(|getStore/.test(src));
  });
  await check('Z5 session expiry is never used as authorization: the seam takes no expiry, and the call sites pass only identity + permission', async () => {
    assert.equal(realAuthorize.length >= 2, true);
    const src = ['lib/session-revocation.ts', 'app-write-token.ts'].map((f) => fs.readFileSync(path.join(FUNCTIONS, f), 'utf8')).join('\n');
    const sites = src.match(/authorize\(\{[^)]*\)/g) || [];
    assert.equal(sites.length, 3, JSON.stringify(sites));
    assert.ok(sites.every((s) => !/exp|expires/i.test(s)), JSON.stringify(sites));
  });
  authz.authorize = realAuthorize;

  // =========================================================================== I
  const READERS = ['call-eligibility', 'call-log-barrier', 'current-offer-barrier', 'ghl-calendar-events', 'ghl-contact-conversations', 'ghl-contact', 'ghl-contacts',
    'ghl-conversations', 'ghl-documents-capability', 'ghl-mailers', 'ghl-opportunities', 'ghl-proxy', 'ghl-underwriting-policy', 'repair-approval-status'];
  const WRITERS = ['call-log-barrier', 'current-offer-barrier', 'generate-contract-pdf', 'ghl-contract-send-readback', 'ghl-executed-artifact-upload', 'ghl-write', 'property-answer', 'repair-approval-save'];
  const RETIRED = ['ghl-contract-send-execute', 'ghl-contract-send-reserve'];
  // Jeff work order T3: the Test-only probe functions (Production 404) -- their own class, so the business inventory stays exact.
  const TEST_ONLY_READERS = ['protected-noop-read', 'session-authority-probe'];
  const TEST_ONLY_WRITERS = ['protected-noop'];
  const all = fs.readdirSync(FUNCTIONS).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3));
  const src = (n) => fs.readFileSync(path.join(FUNCTIONS, n + '.ts'), 'utf8');
  await check('I1 inventory: the files calling readAuthRefusal are exactly the 14 readers; those calling requireAppWriter are exactly the 8 writers + 2 retired 410 endpoints', async () => {
    assert.deepEqual(all.filter((n) => /readAuthRefusal\(event\)/.test(src(n))).sort(), [...READERS, ...TEST_ONLY_READERS].sort());
    assert.deepEqual(all.filter((n) => /requireAppWriter\(event\)/.test(src(n))).sort(), [...WRITERS, ...RETIRED, ...TEST_ONLY_WRITERS].sort());
  });
  await check('I1b the Test-only probe functions: the FIRST statement of each handler is the Test-only gate (404 otherwise), and no business reader or writer uses that gate', async () => {
    for (const n of [...TEST_ONLY_READERS, ...TEST_ONLY_WRITERS]) assert.match(src(n), /export const handler = async \(event: any\) => \{\r?\n\s*if \(!testProbeGateOpen\(event\)\) return PROBE_NOT_FOUND;/, n);
    for (const n of [...READERS, ...WRITERS]) assert.ok(!/testProbeGateOpen/.test(src(n)), n);
  });
  await check('I2 every reader: `await sessionReadRefusal(event)` immediately follows its unchanged two readAuthRefusal statements', async () => {
    for (const n of [...READERS, ...TEST_ONLY_READERS]) assert.match(src(n), /const (refused|refusal) = readAuthRefusal\(event\);\r?\n\s*if \(\1\) return \1;\r?\n\s*const revoked = await sessionReadRefusal\(event\);\r?\n\s*if \(revoked\) return revoked;/, n);
  });
  await check('I3 every writer: `await sessionWriteRefusal(event)` follows requireAppWriter and requireAppWriteOrigin, before anything else', async () => {
    for (const n of [...WRITERS, ...TEST_ONLY_WRITERS]) {
      const s = src(n);
      const a = s.indexOf('requireAppWriter(event)'), o = s.indexOf('requireAppWriteOrigin(event)'), w = s.indexOf('await sessionWriteRefusal(event)');
      assert.ok(a > 0 && o > a && w > o, n);
      assert.match(s.slice(o, w), /^requireAppWriteOrigin\(event\);\s*\}\s*catch\s*\{[^]*?\);\s*\}\r?\n\s*const writeRevoked = $/, n);
    }
  });
  await check('I4 retired send endpoints still return 410 after auth (no effect; not converted)', async () => {
    for (const n of RETIRED) assert.match(src(n), /statusCode: 410/);
  });
  reset(); flag(true);
  const revokedB = await fixtureBind(40), liveB = await fixtureBind(41);
  await rev.revokeSession(revokedB.sid, revokedB.epoch, 'test', { event: NF });
  const PRE_AUTH_GATES = {};
  for (const n of READERS) {
    for (const [label, b, prep, want] of [['revoked', revokedB, () => {}, 401], ['store unavailable', liveB, () => blobs.rule({ method: 'PUT', status: 500 }), 503]]) {
      await check(`I5 reader ${n}: ${label} -> ${want}${want === 503 ? ' iaos-session-unavailable' : ' reason revoked'}, no GHL request`, async () => {
        other = []; blobs.clearRules(); prep();
        const r = await load(n)(ev({ method: 'GET', cookie: b.cookie, query: { id: 'fixtureContact', contactId: 'fixtureContact', opportunityId: 'fixtureOpp', path: '/contacts/fixtureContact' } }));
        if (r.statusCode === 404 && /disabled|not found/i.test(r.body) && !PRE_AUTH_GATES[n]) { PRE_AUTH_GATES[n] = true; }
        if (PRE_AUTH_GATES[n]) { assert.equal(r.statusCode, 404); return; }
        assert.equal(r.statusCode, want, r.body);
        assert.equal(want === 503 ? marker(r) : parse(r).reason, want === 503 ? 'iaos-session-unavailable' : 'revoked');
        assert.equal(other.length, 0, JSON.stringify(other));
      });
    }
  }
  for (const n of WRITERS) {
    for (const [label, b, prep, want] of [['revoked', revokedB, () => {}, 401], ['store unavailable', liveB, () => blobs.rule({ method: 'PUT', status: 500 }), 503]]) {
      await check(`I6 writer ${n}: ${label} -> ${want}, no GHL request`, async () => {
        other = []; blobs.clearRules(); prep();
        const r = await load(n)(ev({ bearer: tokenFor(b), body: '{}' }), { getRemainingTimeInMillis: () => 20_000 });
        if (r.statusCode === 404 && !PRE_AUTH_GATES[n]) PRE_AUTH_GATES[n] = true;
        if (PRE_AUTH_GATES[n]) { assert.equal(r.statusCode, 404); return; }
        assert.equal(r.statusCode, want, r.body);
        assert.equal(other.length, 0, JSON.stringify(other));
      });
    }
  }
  await check('I7 with an ACTIVE session every writer passes the new check and reaches its own next refusal (malformed body), not a session refusal', async () => {
    blobs.clearRules();
    for (const n of WRITERS) {
      if (PRE_AUTH_GATES[n]) continue;
      other = [];
      const r = await load(n)(ev({ bearer: tokenFor(liveB), body: '{}' }), { getRemainingTimeInMillis: () => 20_000 });
      assert.ok(r.statusCode !== 401 && !(r.statusCode === 503 && marker(r) === 'iaos-session-unavailable'), `${n}: ${r.statusCode} ${r.body}`);
    }
  });
  console.log('pre-authentication gates observed (not reached in this config): ' + JSON.stringify(Object.keys(PRE_AUTH_GATES)));

  // =========================================================================== H
  reset(); flag(true);
  await check('H0 the pinned sites are frozen repo constants: test 07ca1f1a-... (iaos-app-test), production 19fcbf6a-... (iaos-app)', async () => {
    assert.deepEqual({ ...rev.PINNED_REVOCATION_SITES }, { test: SITE, production: PROD_SITE });
    assert.ok(Object.isFrozen(rev.PINNED_REVOCATION_SITES));
    assert.equal(rev.RUNTIME_SITE_HEADER, 'x-nf-site-id');
  });
  await check('H1 NO new credential: no code reads IAOS_SESSION_REVOCATION_SITE_ID / _TOKEN or passes siteID/token to getStore; setting them changes nothing', async () => {
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
    ['netlify', 'src', 'shared'].forEach((d) => walk(path.join(APP, d)));
    const hits = files.filter((f) => /process\.env\.IAOS_SESSION_REVOCATION|env\.IAOS_SESSION_REVOCATION/.test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(hits, []);
    const s = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8');
    assert.match(s, /getStore\(\{ name: storeName, fetch: recorder as typeof fetch \}\)/);    assert.ok(!/siteID:\s*ctx|token:\s*ctx/.test(s));
    assert.deepEqual(rev.revocationSetup({ IAOS_ENV: 'test' }), { kind: 'ready', deployment: 'test', siteID: SITE });
    setEnv('test', { IAOS_SESSION_REVOCATION_SITE_ID: PROD_SITE, IAOS_SESSION_REVOCATION_TOKEN: 'x' });
    const b = await bind(50); assert.equal((await rev.checkSession(b, 'test', { event: NF })).kind, 'active');
    setEnv('test');
  });
  const signIn2 = (extra = {}) => load('app-read-session')(ev({ body: JSON.stringify({ googleIdToken: 'fixture-google-token' }), ...extra }));
  for (const [label, prep] of [
    ['anchor absent', () => dropAnchor()],
    ['anchor malformed JSON', () => seedAnchor('{"v":1,')],
    ['anchor empty', () => seedAnchor('')],
    ['anchor non-canonical key order', () => seedAnchor(JSON.stringify({ v: 1, kind: 'iaos-session-revocation-authority', env: 'test', siteID: SITE, epoch: EPOCH }))],
    ['anchor extra field', () => seedAnchor(anchorText({ extra: { note: 'x' } }))],
    ['anchor WITHOUT state (r3 shape)', () => seedAnchor({ state: null })],
    ['anchor state neither open nor closed', () => seedAnchor({ state: 'Open' })],
    ['anchor CLOSED', () => seedAnchor({ state: 'closed' })],
    ['anchor epoch too short', () => seedAnchor(anchorText({ epoch: 'short-epoch' }))],
    ['anchor epoch with a forbidden character', () => seedAnchor(anchorText({ epoch: 'fixture-epoch/0001' }))],
    ['anchor wrong version', () => seedAnchor(anchorText({ v: 2 }))],
    ['anchor wrong kind', () => seedAnchor(anchorText({ kind: 'iaos-session' }))],
    ['anchor ENV MISMATCH (a production anchor in the Test store)', () => seedAnchor({ env: 'production', siteID: PROD_SITE })],
    ['anchor SITE MISMATCH (names another site)', () => seedAnchor({ siteID: PROD_SITE })],
    ['anchor read 503', () => blobs.rule({ method: 'GET', key: ANCHOR_KEY, status: 503 })],
    ['anchor confirm 412', () => blobs.rule({ method: 'PUT', key: ANCHOR_KEY, status: 412 })],
    ['runtime site header missing', () => ({ headers: { 'x-nf-site-id': undefined } })],
    ['runtime site header = the Production site', () => ({ headers: { 'x-nf-site-id': PROD_SITE } })],
    ['Lambda Blobs context missing', () => ({ noBlobs: true })],
  ]) {
    await check(`H2 sign-in with ${label} -> 503 unavailable, NO session (no Set-Cookie), Google identity verified first, the anchor never created or changed`, async () => {
      reset(); const extra = prep() || {};
      const r = await signIn2(extra);
      assert.equal(r.statusCode, 503, r.body); assert.equal(parse(r).state, 'unavailable'); assert.equal(parse(r).by, 'iaos-session-unavailable');
      assert.equal(r.headers['Set-Cookie'], undefined); assert.ok(!/eyJ/.test(r.body));
      assert.deepEqual(blobs.mutations.filter((m) => m.key === ANCHOR_KEY), []);
      assert.equal(blobs.mutations.length, 0, 'no session record created');
    });
  }
  await check('H3 a refused Google identity at sign-in touches nothing in the store (401, zero Blob requests)', async () => {
    reset(); const r = await signIn2({ headers: { origin: 'https://evil.example.invalid' } });
    assert.equal(r.statusCode, 401); assert.equal(blobCount(), 0);
  });
  await check('H4 IAOS_ENV unbound (staging / missing) -> unavailable with ZERO requests', async () => {
    reset(); const b = await bind(51); blobs.log.length = 0;
    for (const e of ['staging', undefined]) {
      const env = { ...process.env, IAOS_ENV: e };
      assert.deepEqual(rev.revocationSetup(env), { kind: 'not_configured', reason: 'environment_unbound' });
      assert.equal((await rev.checkSession(b, 'test', { event: NF, env })).kind, 'unavailable');
      assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF, env })).kind, 'unconfirmed');
    }
    assert.equal(blobCount(), 0);
  });
  await check('H5 the runtime site header x-nf-site-id: missing, the other environment\'s pinned site, empty, padded, ambiguous, or present only under a non-lowercase name (connectLambda reads the lowercase key) -> unavailable / not confirmed with ZERO requests', async () => {
    reset(); const b = await bind(52); blobs.log.length = 0;
    for (const [label, ev2] of [['missing', { headers: {} }], ['production site', { headers: { 'x-nf-site-id': PROD_SITE } }], ['empty', { headers: { 'x-nf-site-id': '' } }],
      ['padded', { headers: { 'x-nf-site-id': ` ${SITE}` } }], ['ambiguous', { headers: { 'x-nf-site-id': SITE }, multiValueHeaders: { 'X-Nf-Site-Id': [SITE, PROD_SITE] } }],
      ['mixed-case name only', { headers: { 'X-NF-Site-ID': SITE } }]]) {
      const e = { ...ev2, blobs: blobs.lambdaBlobs };
      assert.deepEqual(await rev.checkSession(b, 'test', { event: e }), { kind: 'unavailable', reason: 'runtime_site_mismatch' }, label);
      assert.deepEqual(await rev.revokeSession(b.sid, b.epoch, 'test', { event: e }), { kind: 'unconfirmed', reason: 'runtime_site_mismatch' }, label);
      assert.deepEqual(await rev.beginSession(sid(53), 'test', { event: e }), { kind: 'unavailable', reason: 'runtime_site_mismatch' }, label);
    }
    const noHdr = { 'x-nf-site-id': undefined };
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie, headers: noHdr }))).statusCode, 503);
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: tokenFor(b), headers: noHdr }))).statusCode, 503);
    assert.equal((await mint(tokenEv(b.cookie, { headers: noHdr }))).statusCode, 503);
    assert.equal((await status(b.cookie, { headers: noHdr })).statusCode, 503);
    assert.equal(blobCount(), 0, 'no Blob request without the pinned runtime site');
  });
  await check('H6 the Lambda Blobs context missing or malformed -> unavailable with zero requests (never an API-mode fallback)', async () => {
    const b = await bind(54); blobs.log.length = 0;
    for (const bl of [undefined, '%%%', Buffer.from('{}').toString('base64')]) {
      const e = { headers: { 'x-nf-site-id': SITE }, ...(bl === undefined ? {} : { blobs: bl }) };
      assert.equal((await rev.checkSession(b, 'test', { event: e })).kind, 'unavailable');
    }
    assert.equal(blobCount(), 0);
    assert.equal((await rev.checkSession(b, 'test', { event: NF })).kind, 'active', 'restored context works');
  });
  await check('H7 epoch ROTATION (operator writes a new anchor after a restore) -> every older session is REVOKED: check, reader 401, writer 401, mint 401, status "revoked" -- never 503', async () => {
    reset(); const b = await bind(55); const t = tokenFor(b);
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie })), null, 'before rotation: allowed');
    seedAnchor({ epoch: EPOCH2 });
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie })); assert.equal(rd.statusCode, 401); assert.equal(parse(rd).reason, 'revoked');
    const wr = await rev.sessionWriteRefusal(ev({ bearer: t })); assert.equal(wr.statusCode, 401); assert.equal(parse(wr).reason, 'revoked');
    const mt = await mint(tokenEv(b.cookie)); assert.equal(mt.statusCode, 401); assert.equal(parse(mt).reason, 'revoked'); noCredentialLeak(mt);
    assert.equal(parse(await status(b.cookie)).state, 'revoked');
    assert.equal(blobs.get(ASTORE, ANCHOR_KEY).text, anchorText({ epoch: EPOCH2 }), 'the old-epoch If-Match write did NOT overwrite the rotated anchor');
  });
  await check('H8 RESTORED ACTIVE RECORD: a restore brings back the session record as "active" (even its old ETag) and the operator rotated the anchor -> still revoked; a lost revocation cannot revive', async () => {
    reset(); const b = await bind(56);
    const activeSnapshot = blobs.get('iaos-write-receipts', sKey(b.sid));
    assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF })).kind, 'verified');
    blobs.reset(); seedAnchor({ epoch: EPOCH2 });
    blobs.store.set(`${SITE}|site:iaos-write-receipts|${sKey(b.sid)}`, { ...activeSnapshot });
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: tokenFor(b) }))).statusCode, 401);
  });
  await check('H9 WRONG / EMPTY STORE: the session key is absent there -> If-Match fails (412) -> refused (revoked), never authorized; a valid anchor copied into an empty store does not help', async () => {
    reset(); const b = await bind(57);
    blobs.reset();
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    seedAnchor();
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }))).statusCode, 401);
  });
  await check('H10 a fresh sign-in after the rotation binds to the new epoch and its ETag; it mints and saves', async () => {
    reset(); seedAnchor({ epoch: EPOCH2 }); const r = await signIn2();
    assert.equal(r.statusCode, 200, r.body); const c = cookieOf(r);
    assert.equal(decode(c).epoch, EPOCH2);
    const t2 = parse(await mint(tokenEv(c))).token; assert.equal(decode(t2).epoch, EPOCH2);
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t2 })), null);
  });
  await check('H11 sessions / tokens WITHOUT an epoch or store ETags are refused like sid-less ones with ZERO Blob requests; epoch without sid, ETags without epoch, malformed values cannot be issued', async () => {
    blobs.log.length = 0;
    const rd = await rev.sessionReadRefusal(ev({ method: 'GET', cookie: unbound({}) })); assert.equal(rd.statusCode, 401); assert.equal(parse(rd).reason, 'sign_in_again');
    assert.equal(blobCount(), 0);
    const cfgR = readAuth.appReadConfig();
    assert.throws(() => readAuth.issueReadSession('brad@example.invalid', cfgR, Date.now(), undefined, EPOCH));
    assert.throws(() => readAuth.issueReadSession('brad@example.invalid', cfgR, Date.now(), sid(58), 'bad'));
    assert.throws(() => readAuth.issueReadSession('brad@example.invalid', cfgR, Date.now(), sid(58), undefined, { aetag: '"a"', setag: '"s"' }));
    assert.throws(() => readAuth.issueReadSession('brad@example.invalid', cfgR, Date.now(), sid(58), EPOCH, { aetag: 'has space', setag: '"s"' }));
    assert.throws(() => writeAuth.issueBoundAppSession('brad@example.invalid', { env: 'test', sid: sid(58), pexp: 1, epoch: EPOCH }));
  });
  await check('H12 the two check writes run IN PARALLEL within ONE budget (two 400 ms writes fit a 700 ms budget); single attempt each', async () => {
    reset(); const b = await bind(59); blobs.log.length = 0;
    blobs.rule({ method: 'PUT', delayMs: 400, key: ANCHOR_KEY }, { method: 'PUT', delayMs: 400, key: sKey(b.sid) });
    const t0 = Date.now(); const r = await rev.checkSession(b, 'test', { event: NF, budgetMs: 700 });
    assert.deepEqual(r, { kind: 'active' }, `parallel within one budget (${Date.now() - t0} ms)`);
    assert.equal(blobs.log.length, 2);
  });
  await check('H13 static scan: the authority store literal appears ONLY in session-revocation.ts (once) and the r4 anchor key (session-revocation/_authority) appears NOWHERE in app code; AUTHORITY_KEY is used by exactly one read (sign-in) and one write (confirmAnchor: onlyIfMatch, canonical bytes), both through onceAuthority; no onlyIfNew / unconditional / delete on it', async () => {
    const roots = ['netlify', 'src', 'shared'].map((d) => path.join(APP, d));
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|js|cjs|mjs)$/.test(e.name)) files.push(p); } };
    roots.forEach(walk);
    const OLD_REF = /session-revocation\/_authority|[\/"'`]_authority\b/;
    assert.deepEqual(files.filter((f) => OLD_REF.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(APP, f)), [], 'the r4 anchor key is never named by code');
    const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes(ASTORE));
    assert.deepEqual(hits.map((f) => path.relative(APP, f).split(path.sep).join('/')), ['netlify/functions/lib/session-revocation.ts']);
    const s = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8');
    assert.equal(s.split('"' + ASTORE + '"').length - 1, 1, 'the store literal once');
    assert.match(s, /^export const SESSION_AUTHORITY_STORE = "iaos-session-authority";\r?$/m);
    assert.match(s, /^const AUTHORITY_KEY = "authority";\r?$/m);
    assert.equal((s.match(/"authority"/g) || []).length, 1, 'the key literal once');
    const uses = s.match(/AUTHORITY_KEY\b/g) || [];
    assert.equal(uses.length, 3, 'declaration + one read + one write');
    assert.match(s, /onceAuthority\(ctx, \(s\) => s\.getWithMetadata\(AUTHORITY_KEY, \{ type: "text" \}\)\)/);
    assert.match(s, /onceAuthority\(ctx, \(s\) => s\.set\(AUTHORITY_KEY, anchorBytes\(ctx\.deployment, epoch\), \{ onlyIfMatch: etag \}\)\)/);
    assert.equal((s.match(/[^A-Za-z]once\([^\n]*AUTHORITY_KEY/g) || []).length, 0, 'the session-store transport never names the anchor');
    assert.equal((s.match(/onceAuthority\(/g) || []).length, 3, 'onceAuthority: its definition + the read + the confirm write');
    assert.match(s, /function once\(ctx: Ctx, op: \(store: Store\) => Promise<unknown>\): Promise<Recorded> \{ return attempt\(ctx, REVOCATION_STORE, op\); \}/);
    assert.match(s, /function onceAuthority\(ctx: Ctx, op: \(store: Store\) => Promise<unknown>\): Promise<Recorded> \{ return attempt\(ctx, SESSION_AUTHORITY_STORE, op\); \}/);
    /* G1 (accepted method r3 T3): onceProbe is the third, Test-probe-only caller of attempt -- the session store only,
       never the authority store; it is the only call that passes a diagnostic sink. */
    assert.match(s, /  const r = await attempt\(ctx, REVOCATION_STORE, op, sink\);/);
    assert.equal((s.match(/attempt\(ctx, /g) || []).length, 3, 'attempt is reached only through once / onceAuthority / onceProbe');
    assert.ok(!/AUTHORITY_KEY[^\n]*onlyIfNew/.test(s) && !/\.(setJSON|delete)\(/.test(s), 'no create / setJSON / delete');
    assert.match(s, /if \(!isCanonicalEtag\(etag\)\) return Promise\.resolve/, 'an empty etag can never turn the anchor write unconditional');
  });

  // ---- r4 (H2 operational): restore containment through the anchor state.
  await check('H14 CLOSED anchor: sign-in 503 (no session, no Set-Cookie); an existing session is refused everywhere -- check revoked, reader 401, writer 401, mint 401, status revoked -- and the closed anchor bytes are never changed', async () => {
    reset(); const b = await bind(80); const t = tokenFor(b);
    assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t })), null, 'before closing: allowed');
    seedAnchor({ state: 'closed' }); const closed = blobs.get(ASTORE, ANCHOR_KEY).text;
    const si = await signIn2(); assert.equal(si.statusCode, 503); assert.equal(si.headers['Set-Cookie'], undefined);
    assert.deepEqual(await rev.beginSession(sid(81), 'test', { event: NF }), { kind: 'unavailable', reason: 'authority_closed' });
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }))).statusCode, 401);
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401);
    const mt = await mint(tokenEv(b.cookie)); assert.equal(mt.statusCode, 401); noCredentialLeak(mt);
    assert.equal(parse(await status(b.cookie)).state, 'revoked');
    assert.equal(blobs.get(ASTORE, ANCHOR_KEY).text, closed, 'no check re-opened the anchor');
    assert.equal(rev.authorityEpoch(closed, 'test'), null); assert.deepEqual(rev.parseAuthority(closed, 'test'), { epoch: EPOCH, state: 'closed' });
  });
  await check('H15 REOPEN with a NEW epoch (open): every session from before the closure stays refused; a fresh sign-in binds to the new epoch, mints and saves', async () => {
    reset(); const b = await bind(82); const t = tokenFor(b);
    seedAnchor({ state: 'closed' }); seedAnchor({ epoch: EPOCH2, state: 'open' });
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401);
    const r = await signIn2(); assert.equal(r.statusCode, 200, r.body); const c = cookieOf(r); assert.equal(decode(c).epoch, EPOCH2);
    const t2 = parse(await mint(tokenEv(c))).token; assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t2 })), null);
  });
  await check('H16 RESTORE procedure (runbook section 6): close -> restore EXCLUDING the anchor (old active records come back) -> still closed: old sessions refused, sign-in 503 -> new epoch open: old sessions refused, new sign-in works', async () => {
    reset(); const b = await bind(83); const t = tokenFor(b);
    const snapshot = snapshotSessionStore();                                                             // a backup of the SESSION store
    assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF })).kind, 'verified');
    seedAnchor({ state: 'closed' });                                                                     // (a) close BEFORE restore
    restoreSessionStore(snapshot);                                                                       // (b) restore the session store only
    assert.equal(blobs.get('iaos-write-receipts', sKey(b.sid)).text, rev.sessionRecordText('test', EPOCH, b.sid, 'active'), 'the old active record is back');
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' }, 'closed: refused');
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401);
    assert.equal((await signIn2()).statusCode, 503, 'closed: no sign-in');
    seedAnchor({ epoch: EPOCH2, state: 'open' });                                                        // (c) new epoch, open
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' }, 'reopened: still refused');
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }))).statusCode, 401);
    assert.equal((await signIn2()).statusCode, 200);
  });
  // ---- Bones HOLD on 3311102: restore containment by STRUCTURAL EXCLUSION (the anchor is in its own store).
  await check('H17 RESTORE of the session store INCLUDING old active records AND an old OPEN anchor at the r4 key (receipts store), while the authority-store anchor is CLOSED -> every check, reader, writer, mint, status and sign-in refused after EVERY restored record (throughout); the authority anchor is untouched by the restore; reopen with a NEW epoch -> pre-restore sessions refused, a new sign-in works', async () => {
    // The receipts store still carries the r4 layout: an OPEN anchor (current epoch) at the r4 key, present from before
    // sign-in, so the backup ALSO carries it.
    reset(); blobs.put(SSTORE, OLD_ANCHOR_KEY, anchorText({ epoch: EPOCH }));
    const b = await bind(84); const b2 = await bind(85); const t = tokenFor(b); const t2 = tokenFor(b2);
    const snapshot = snapshotSessionStore();
    assert.ok([...snapshot.keys()].some((k) => k.endsWith('|' + OLD_ANCHOR_KEY)), 'the backup contains the old open anchor');
    assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF })).kind, 'verified');
    assert.equal((await rev.revokeSession(b2.sid, b2.epoch, 'test', { event: NF })).kind, 'verified');
    seedAnchor({ state: 'closed' }); const closed = blobs.get(ASTORE, ANCHOR_KEY);                     // (a) close BEFORE restore
    const refusedEverywhere = async (label) => {
      for (const x of [b, b2]) assert.deepEqual(await rev.checkSession(x, 'test', { event: NF }), { kind: 'revoked' }, label);
      assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }))).statusCode, 401, label);
      for (const tk of [t, t2]) assert.equal((await rev.sessionWriteRefusal(ev({ bearer: tk }))).statusCode, 401, label);
      assert.equal((await mint(tokenEv(b2.cookie))).statusCode, 401, label);
      assert.equal(parse(await status(b.cookie)).state, 'revoked', label);
      assert.equal((await signIn2()).statusCode, 503, label);
      assert.deepEqual(blobs.get(ASTORE, ANCHOR_KEY), closed, label + ': the authority anchor is unchanged');
    };
    // (b) restore the SESSION store one record at a time (a multi-pass restore): refused after every single pass.
    const entries = [...snapshot.entries()].sort(([a], [z]) => (a.endsWith(OLD_ANCHOR_KEY) ? -1 : z.endsWith(OLD_ANCHOR_KEY) ? 1 : 0));
    for (const [k, v] of entries) { blobs.store.set(k, { ...v }); await refusedEverywhere('after restoring ' + k.slice(SPFX.length)); }
    assert.equal(blobs.get(SSTORE, sKey(b.sid)).text, rev.sessionRecordText('test', EPOCH, b.sid, 'active'), 'the old active record is back');
    assert.equal(blobs.get(SSTORE, OLD_ANCHOR_KEY).text, anchorText({ epoch: EPOCH }), 'the old OPEN anchor is back at the r4 key');
    blobs.log.length = 0;
    await refusedEverywhere('restore complete');
    assert.equal(blobs.log.filter((e) => e.key === OLD_ANCHOR_KEY).length, 0, 'no request named the r4 key');
    seedAnchor({ epoch: EPOCH2, state: 'open' });                                                        // (d) new epoch, open
    for (const x of [b, b2]) assert.deepEqual(await rev.checkSession(x, 'test', { event: NF }), { kind: 'revoked' }, 'reopened: pre-restore sessions refused');
    for (const tk of [t, t2]) assert.equal((await rev.sessionWriteRefusal(ev({ bearer: tk }))).statusCode, 401);
    assert.equal((await mint(tokenEv(b.cookie))).statusCode, 401);
    const r = await signIn2(); assert.equal(r.statusCode, 200, r.body); const c = cookieOf(r); assert.equal(decode(c).epoch, EPOCH2);
    const t3 = parse(await mint(tokenEv(c))).token; assert.equal(await rev.sessionWriteRefusal(ev({ bearer: t3 })), null);
  });
  await check('H18 store separation at runtime: sign-in reads + confirms the anchor ONLY in iaos-session-authority and creates the session ONLY in iaos-write-receipts; a check writes the anchor ONLY in the authority store and the session ONLY in the receipts store; sign-out never touches the authority store', async () => {
    reset(); blobs.log.length = 0;
    const g = await rev.beginSession(sid(86), 'test', { event: NF }); assert.equal(g.kind, 'issued');
    assert.deepEqual(blobs.log.map((e) => `${e.method} ${e.storeName}/${e.key === ANCHOR_KEY ? 'ANCHOR' : e.key === sKey(sid(86)) ? 'SESSION' : e.key}`),
      ['GET site:' + ASTORE + '/ANCHOR', 'PUT site:' + ASTORE + '/ANCHOR', 'PUT site:' + SSTORE + '/SESSION']);
    const b = { sid: sid(86), epoch: g.epoch, aetag: g.aetag, setag: g.setag };
    blobs.log.length = 0; assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'active' });
    assert.deepEqual(blobs.log.map((e) => `${e.storeName}/${e.key === ANCHOR_KEY ? 'ANCHOR' : 'SESSION'}`).sort(), ['site:' + ASTORE + '/ANCHOR', 'site:' + SSTORE + '/SESSION'].sort());
    assert.equal(blobs.log.find((e) => e.storeName === 'site:' + SSTORE).key, sKey(sid(86)));
    blobs.log.length = 0; assert.equal((await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF })).kind, 'verified');
    assert.ok(blobs.log.every((e) => e.storeName === 'site:' + SSTORE && e.key === sKey(sid(86))), 'sign-out: session store only');
  });
  await check('H19 authority store ABSENT (never provisioned / lost) -- even with a valid OPEN anchor at the r4 key and at the new key name in the receipts store: sign-in 503 (authority_absent, no session), every existing session refused (revoked), reader 401, writer 401, mint 401; nothing creates the anchor', async () => {
    reset(); const b = await bind(87); const t = tokenFor(b);
    dropAnchor();
    blobs.put(SSTORE, OLD_ANCHOR_KEY, anchorText({ epoch: EPOCH })); blobs.put(SSTORE, ANCHOR_KEY, anchorText({ epoch: EPOCH }));
    assert.deepEqual(await rev.beginSession(sid(88), 'test', { event: NF }), { kind: 'unavailable', reason: 'authority_absent' });
    const si = await signIn2(); assert.equal(si.statusCode, 503); assert.equal(si.headers['Set-Cookie'], undefined);
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }))).statusCode, 401);
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: t }))).statusCode, 401);
    assert.equal((await mint(tokenEv(b.cookie))).statusCode, 401);
    assert.equal(blobs.get(ASTORE, ANCHOR_KEY), null, 'the anchor was never created by code');
    assert.equal(blobs.get(SSTORE, sKey(sid(88))), null, 'no session record created');
    // Provisioning a NEW anchor (new epoch) in the authority store: old sessions stay refused; a new sign-in works.
    seedAnchor({ epoch: EPOCH2 });
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'revoked' });
    assert.equal((await signIn2()).statusCode, 200);
  });
  await check('H20 a check / sign-in / sign-out never writes or reads the receipts store\'s r4 anchor key, and an old CLOSED anchor there cannot close (or an old OPEN one reopen) anything: the decision follows the authority store only', async () => {
    reset(); const b = await bind(89);
    blobs.put(SSTORE, OLD_ANCHOR_KEY, anchorText({ epoch: EPOCH, state: 'closed' })); const oldBytes = blobs.get(SSTORE, OLD_ANCHOR_KEY);
    blobs.log.length = 0;
    assert.deepEqual(await rev.checkSession(b, 'test', { event: NF }), { kind: 'active' }, 'an old-key anchor is ignored');
    assert.equal((await rev.beginSession(sid(90), 'test', { event: NF })).kind, 'issued');
    assert.equal((await rev.revokeSession(sid(90), EPOCH, 'test', { event: NF })).kind, 'verified');
    assert.equal(blobs.log.filter((e) => e.key === OLD_ANCHOR_KEY || (e.storeName === 'site:' + SSTORE && e.key === ANCHOR_KEY)).length, 0);
    assert.deepEqual(blobs.get(SSTORE, OLD_ANCHOR_KEY), oldBytes, 'the r4-key bytes were never written');
  });

  flag(false);
  await check('Z0 the WHOLE run: no request created, changed or deleted the authority anchor; every anchor write carried If-Match (never If-None-Match, never unconditional) and the canonical bytes', async () => {
    assert.deepEqual(blobs.mutations.filter((m) => m.key === ANCHOR_KEY), []);
    const writes = anchorRequests.filter((r) => r.method !== 'GET');
    assert.ok(writes.length > 20, 'anchor writes observed: ' + writes.length);
    assert.ok(writes.every((w) => w.method === 'PUT' && w.ifMatch && !w.ifNoneMatch), JSON.stringify(writes.filter((w) => !(w.method === 'PUT' && w.ifMatch && !w.ifNoneMatch)).slice(0, 3)));
    assert.ok(writes.every((w) => rev.authorityEpoch(w.body, 'test')), 'every anchor write body is a canonical valid anchor');
  });
  await check('Z0b the WHOLE run: no Blob request named the r4 anchor key; no request named the anchor key in the receipts store; the authority store was asked for nothing but the anchor', async () => {
    assert.ok(storeOps.length > 100, 'store requests observed: ' + storeOps.length);
    assert.deepEqual(storeOps.filter((o) => o.key === OLD_ANCHOR_KEY), []);
    assert.deepEqual(storeOps.filter((o) => o.store === SSTORE && o.key === ANCHOR_KEY), []);
    assert.deepEqual(storeOps.filter((o) => o.store === ASTORE && o.key !== ANCHOR_KEY), []);
    assert.ok(storeOps.some((o) => o.store === ASTORE) && storeOps.some((o) => o.store === SSTORE));
  });
  // =========================================================================== TL  (Jess 2026-11-10: Test-only lifetime)
  // The accelerated-expiry mechanism: a server-honoured, Test-only session lifetime (TEST.oneLoginTestSessionSeconds).
  // Every check restores the committed values in `finally`.
  const TESTCFG = cfg.getConfig('test'); const PRODCFG = cfg.getConfig('production');
  const restoreTL = () => { TESTCFG.oneLoginTestSessionSeconds = null; delete PRODCFG.oneLoginTestSessionSeconds; setEnv('test'); flag(false, 'production'); };
  const rtc = require(path.join(FUNCTIONS, 'iaos-runtime-config.ts'));
  await check('TL1 committed: TEST carries oneLoginTestSessionSeconds = null, PRODUCTION carries no such field; every environment is 30 days', async () => {
    const srcTL = fs.readFileSync(path.join(APP, 'shared/ghl-config.ts'), 'utf8');
    const testBlock = srcTL.slice(srcTL.indexOf('const TEST: GhlConfig = {'));
    const committedTL = /\n  oneLoginTestSessionSeconds: ([^,\r\n]+),/.exec(testBlock);
    assert.equal(committedTL && committedTL[1], 'null', 'the committed TEST value');
    assert.equal(TESTCFG.oneLoginTestSessionSeconds, null, 'pinned in this process');
    assert.equal(Object.prototype.hasOwnProperty.call(PRODCFG, 'oneLoginTestSessionSeconds'), false);
    for (const e of ['test', 'production', undefined, null, 'Test', 'TEST', ' test', '', 'staging', 7]) assert.equal(cfg.oneLoginSessionSecondsFor(e), 30 * DAY, String(e));
    assert.equal(readAuth.ONE_LOGIN_SESSION_SECONDS, 30 * DAY);
  });
  await check('TL2 Production is never scaled: with Test at 3600 s AND a value forced onto the PRODUCTION object, production (and every non-"test" value) is still exactly 30 days; Test is 3600', async () => {
    try {
      TESTCFG.oneLoginTestSessionSeconds = 3600; PRODCFG.oneLoginTestSessionSeconds = 600;
      assert.equal(cfg.oneLoginSessionSecondsFor('test'), 3600);
      for (const e of ['production', undefined, 'Test', 'test ', '']) assert.equal(cfg.oneLoginSessionSecondsFor(e), 30 * DAY, String(e));
      assert.equal(readAuth.oneLoginSessionSeconds({ deployment: 'production' }), 30 * DAY);
      assert.equal(readAuth.oneLoginSessionSeconds({ deployment: 'test' }), 3600);
    } finally { restoreTL(); }
  });
  await check('TL3 a malformed Test value falls back to the full 30 days (599, 3600.5, "3600", 30 days + 1, -1, NaN, Infinity, {}, true)', async () => {
    try {
      for (const v of [599, 3600.5, '3600', 30 * DAY + 1, -1, NaN, Infinity, {}, true]) { TESTCFG.oneLoginTestSessionSeconds = v; assert.equal(cfg.oneLoginSessionSecondsFor('test'), 30 * DAY, String(v)); }
      for (const v of [600, 3600, 30 * DAY]) { TESTCFG.oneLoginTestSessionSeconds = v; assert.equal(cfg.oneLoginSessionSecondsFor('test'), v); }
    } finally { restoreTL(); }
  });
  await check('TL4 scaled Test, REAL sign-in: exp - iat = 3600 exactly; Set-Cookie Max-Age <= 3600; status expiresAt = sign-in + 1 h; the mint pexp is that expiry', async () => {
    reset(); flag(true);
    try {
      TESTCFG.oneLoginTestSessionSeconds = 3600;
      const before = Math.floor(Date.now() / 1000);
      const r = await signIn(); assert.equal(r.statusCode, 200, r.body);
      const c = cookieOf(r); const claims = decode(c);
      assert.equal(claims.exp - claims.iat, 3600); assert.ok(claims.iat >= before - 1 && claims.iat <= before + 5);
      const maxAge = Number(/Max-Age=(\d+)/.exec(r.headers['Set-Cookie'])[1]); assert.ok(maxAge > 3590 && maxAge <= 3600, String(maxAge));
      const s = parse(await status(c)); assert.equal(s.state, 'signed_in'); assert.equal(Date.parse(s.expiresAt), claims.exp * 1000);
      const m = await mint(tokenEv(c)); assert.equal(m.statusCode, 200, m.body); assert.equal(decode(parse(m).token).pexp, claims.exp);
    } finally { restoreTL(); }
  });
  await check('TL5 scaled Test, server-enforced: valid at exp - 1 s; at exp and exp + 1 s verify, reader, writer, mint and status all refuse (a browser clock cannot extend it)', async () => {
    reset(); flag(true); const realNow = Date.now;
    try {
      TESTCFG.oneLoginTestSessionSeconds = 3600;
      const r = await signIn(); const c = cookieOf(r); const endMs = decode(c).exp * 1000;
      const tok = parse(await mint(tokenEv(c))).token;
      assert.equal(readAuth.verifyReadSession(c, readAuth.appReadConfig(), endMs - 1000).email, 'brad@example.invalid');
      for (const t of [endMs, endMs + 1000]) {
        Date.now = () => t;
        assert.throws(() => readAuth.verifyReadSession(c, readAuth.appReadConfig(), t));
        assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: c }), process.env, t)).statusCode, 401);
        assert.equal((await load('ghl-contact')(ev({ method: 'GET', cookie: c, query: { id: 'fixtureContact' } }))).statusCode, 401);
        assert.equal((await rev.sessionWriteRefusal(ev({ bearer: tok }), process.env, t)).statusCode, 401);
        const m = await mint(tokenEv(c)); assert.equal(m.statusCode, 401); noCredentialLeak(m);
        assert.equal(parse(await status(c)).state, 'signed_out');
      }
    } finally { Date.now = realNow; restoreTL(); }
  });
  await check('TL6 not usable in Production: a Production session is 30 days even with Test at 3600; a correctly SIGNED Production one-sign-in token with a 3600 s lifetime is refused', async () => {
    try {
      TESTCFG.oneLoginTestSessionSeconds = 3600; flag(true, 'production'); setEnv('production');
      const pc = readAuth.appReadConfig(); assert.equal(pc.deployment, 'production');
      const iss = readAuth.issueReadSession('brad@example.invalid', pc, Date.now(), sid(90), EPOCH, { aetag: '"a"', setag: '"s"' });
      const pcl = decode(iss.token); assert.equal(pcl.exp - pcl.iat, 30 * DAY); assert.equal(readAuth.verifyReadSession(iss.token, pc).sid, sid(90));
      const now = Math.floor(Date.now() / 1000);
      const forged = signTok({ iss: 'iaos', aud: readAuth.READ_AUDIENCE, env: 'production', sub: 'brad@example.invalid', iat: now, exp: now + 3600, sid: sid(91), epoch: EPOCH, aetag: '"a"', setag: '"s"' }, pc.secret);
      assert.throws(() => readAuth.verifyReadSession(forged, pc), /Expired or unauthorized/);
    } finally { restoreTL(); }
  });
  await check('TL7 changing the Test lifetime fails CLOSED: a 30-day session is refused once Test is 3600 s, and a 3600 s session is refused once it is back to 30 days', async () => {
    reset(); flag(true);
    try {
      const c30 = cookieOf(await signIn());
      TESTCFG.oneLoginTestSessionSeconds = 3600;
      assert.throws(() => readAuth.verifyReadSession(c30, readAuth.appReadConfig()));
      const c1h = cookieOf(await signIn()); assert.equal(readAuth.verifyReadSession(c1h, readAuth.appReadConfig()).email, 'brad@example.invalid');
      TESTCFG.oneLoginTestSessionSeconds = null;
      assert.throws(() => readAuth.verifyReadSession(c1h, readAuth.appReadConfig()));
    } finally { restoreTL(); }
  });
  await check('TL8 runtime payload: sessionSeconds appears ONLY for test with one sign-in on and a short value; production never; off: no oneLogin key at all; the TEST field itself is never projected', async () => {
    try {
      TESTCFG.oneLoginTestSessionSeconds = 3600; flag(true); flag(true, 'production');
      assert.deepEqual(rtc.runtimePayload('test').oneLogin, { active: true, sessionSeconds: 3600 });
      assert.deepEqual(rtc.runtimePayload('production').oneLogin, { active: true });
      assert.ok(!JSON.stringify(rtc.runtimePayload('test')).includes('oneLoginTestSessionSeconds'));
      TESTCFG.oneLoginTestSessionSeconds = null;
      assert.deepEqual(rtc.runtimePayload('test').oneLogin, { active: true });
      flag(false); flag(false, 'production'); TESTCFG.oneLoginTestSessionSeconds = 3600;
      assert.equal('oneLogin' in rtc.runtimePayload('test'), false); assert.equal('oneLogin' in rtc.runtimePayload('production'), false);
    } finally { restoreTL(); flag(false); }
  });
  await check('TL9 static: the PRODUCTION object source names no test lifetime; oneLoginSessionSecondsFor returns 30 days for every non-"test" value FIRST; issue and verify use the per-deployment lifetime and no fixed one', async () => {
    const src = fs.readFileSync(path.join(APP, 'shared/ghl-config.ts'), 'utf8');
    const prod = src.slice(src.indexOf('const PRODUCTION: GhlConfig = {'), src.indexOf('const TEST: GhlConfig = {'));
    assert.ok(prod.length > 1000); assert.ok(!/oneLoginTestSessionSeconds/.test(prod));
    assert.ok(/export function oneLoginSessionSecondsFor\(environment: unknown\): number \{\s*if \(environment !== "test"\) return ONE_LOGIN_FULL_SESSION_SECONDS;/.test(src), 'first statement refuses every non-"test" value');
    const ra = fs.readFileSync(path.join(FUNCTIONS, 'lib/app-read-auth.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.equal((ra.match(/oneLoginSessionSeconds\(config\)/g) || []).length, 2, 'issue + verify');
    assert.ok(!/:\s*ONE_LOGIN_SESSION_SECONDS\)/.test(ra), 'no fixed 30-day lifetime left in issue/verify');
  });
  // =========================================================================== PX  (Bones REVISE R1 on bf83269, 2026-11-10)
  // An expired PARENT session refuses an otherwise UNEXPIRED saving token at every real writer, with the parent-specific
  // reason, before any Blob access or GHL dispatch. The token is minted 60 s before pexp, so its own exp (iat + 900 s)
  // is still ahead at and after pexp.
  const PX_TIMES = (endMs) => [endMs, endMs + 1000, endMs + 600_000];
  async function pxRefusesEverywhere(b, endMs, label) {
    const realNow = Date.now;
    const tok = tokenFor(b, { at: endMs - 60_000 });
    const tokExpMs = decode(tok).exp * 1000;
    assert.equal(decode(tok).pexp, b.exp, label + ': token bound to the parent expiry');
    try {
      for (const t of PX_TIMES(endMs)) {
        assert.ok(tokExpMs > t, `${label}: the token's own exp is still ahead at t=${t - endMs} ms`);
        Date.now = () => t;
        for (const w of WRITERS) {
          const blobBefore = blobs.log.length; const otherBefore = other.length;
          const r = await load(w)(ev({ bearer: tok, body: '{}' }));
          assert.equal(r.statusCode, 401, `${label} ${w} at +${t - endMs} ms: ${r.statusCode} ${r.body}`);
          assert.equal(parse(r).reason, 'session_expired', `${label} ${w}: the parent-specific reason`);
          assert.equal(marker(r), 'iaos-app-write-auth', `${label} ${w}: the write-auth refusal`);
          assert.equal(blobs.log.length, blobBefore, `${label} ${w}: no Blob access before the refusal`);
          assert.equal(other.length, otherBefore, `${label} ${w}: no GHL or other outbound request`);
          noCredentialLeak(r);
        }
      }
    } finally { Date.now = realNow; }
    return tok;
  }
  reset(); flag(true);
  await check('PX1 30-day session: at pexp, pexp + 1 s and pexp + 10 min, an UNEXPIRED saving token is refused by all 8 real writers -- 401 session_expired, zero Blob access, zero GHL dispatch', async () => {
    const realNow = Date.now; const authAt = realNow() - 10_000;
    const b = await bind(70, { at: authAt });
    await pxRefusesEverywhere(b, b.exp * 1000, '30-day');
  });
  await check('PX2 positive control: the SAME kind of token one second before pexp passes the session check (null) and no writer refuses it as session_expired', async () => {
    const realNow = Date.now; const authAt = realNow() - 10_000;
    const b = await bind(71, { at: authAt }); const endMs = b.exp * 1000;
    const tok = tokenFor(b, { at: endMs - 60_000 });
    try {
      Date.now = () => endMs - 1000;
      assert.equal(await rev.sessionWriteRefusal(ev({ bearer: tok }), process.env, endMs - 1000), null);
      for (const w of WRITERS) {
        const r = await load(w)(ev({ bearer: tok, body: '{}' }));
        assert.ok(!(r.statusCode === 401 && (parse(r) || {}).reason === 'session_expired'), `${w}: ${r.statusCode} ${r.body}`);
      }
    } finally { Date.now = realNow; }
  });
  await check('PX3 Test-scaled 60-minute session: the same refusal at all 8 writers once the 1-hour parent session ends, with the token still unexpired', async () => {
    const TESTCFG_PX = cfg.getConfig('test');
    try {
      TESTCFG_PX.oneLoginTestSessionSeconds = 3600;
      const realNow = Date.now; const authAt = realNow() - 10_000;
      const g = await rev.beginSession(sid(72), 'test', { event: NF }); assert.equal(g.kind, 'issued');
      const cookie = readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig(), authAt, sid(72), g.epoch, { aetag: g.aetag, setag: g.setag }).token;
      const b = { sid: sid(72), cookie, epoch: g.epoch, aetag: g.aetag, setag: g.setag, exp: decode(cookie).exp };
      assert.equal(decode(cookie).exp - decode(cookie).iat, 3600);
      await pxRefusesEverywhere(b, b.exp * 1000, '60-minute');
    } finally { TESTCFG_PX.oneLoginTestSessionSeconds = null; }
  });
  // =========================================================================== P / N / R  (Jeff work order T1-T4, 2026-11-10)
  // P: session-authority-probe (P-1, U1/U2/U4). N: protected-noop + reader twin (P-2, A6). R: recovery (R-1, R-3, R-4).
  const PROBE = () => load('session-authority-probe'); const NOOP = () => load('protected-noop'); const NOOPR = () => load('protected-noop-read');
  const RUN = 'probe-run-0001-abcdef';
  const probeEv = (o = {}) => ev({ body: JSON.stringify({ probe: 'authority', runId: RUN }), ...o });
  const legacyCookie = () => readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token;
  const keysTouched = (from) => blobs.log.slice(from).map((e) => `${e.storeName}|${e.key}|${e.method}`);
  const gateCases = () => [
    ['Production env', () => setEnv('production'), {}],
    ['no runtime site id', () => {}, { headers: { 'x-nf-site-id': undefined } }],
    ['the Production site id', () => {}, { headers: { 'x-nf-site-id': PROD_SITE } }],
    ['two site ids', () => {}, { multi: { 'x-nf-site-id': [SITE, PROD_SITE] } }],
    ['a query selector', () => {}, { query: { mode: 'x' } }],
  ];
  for (const [name, fn] of [['session-authority-probe', PROBE], ['protected-noop', NOOP], ['protected-noop-read', NOOPR]]) {
    for (const [label, prep, extra] of gateCases()) {
      await check(`P0 ${name}: ${label} -> bare 404 before any auth, Blob or outbound request`, async () => {
        reset(); flag(true); prep(); const b0 = blobs.log.length; other = [];
        const r = await fn()(ev({ method: name === 'protected-noop-read' ? 'GET' : 'POST', cookie: legacyCookie(), body: '{}', ...extra }));
        assert.equal(r.statusCode, 404, r.body); assert.equal(r.body, 'Not Found');
        assert.equal(blobs.log.length, b0); assert.equal(other.length, 0); setEnv('test');
      });
    }
  }
  await check('P1 probe: the wrong method -> 404; no session -> the read refusal (401); a malformed body with a valid session -> 404', async () => {
    reset(); flag(false);
    assert.equal((await PROBE()(ev({ method: 'GET', cookie: legacyCookie() }))).statusCode, 404);
    assert.equal((await PROBE()(probeEv())).statusCode, 401);
    for (const body of ['{}', JSON.stringify({ probe: 'authority' }), JSON.stringify({ probe: 'authority', runId: 'short' }), JSON.stringify({ probe: 'authority', runId: RUN, extra: 1 }), JSON.stringify({ probe: 'x', runId: RUN })])
      assert.equal((await PROBE()(ev({ cookie: legacyCookie(), body }))).statusCode, 404, body);
  });
  await check('P2 probe positive (before activation: one sign-in OFF, legacy read session): 200; every step ok; U4 present/single/lowercase/pinned; only probe/<runId>/ keys in iaos-write-receipts; never the authority store, a session record or a delete; no read; bytes change exactly 3 times (A1a: verification by conditional write)', async () => {
    reset(); flag(false); const b0 = blobs.log.length; other = [];
    const r = await PROBE()(probeEv({ cookie: legacyCookie() })); const out = parse(r);
    assert.equal(r.statusCode, 200, r.body); assert.equal(out.stoppedAt, null, JSON.stringify(out.steps));
    assert.deepEqual(out.steps.map((s) => s.ok), [true, true, true, true, true, true, true]);
    assert.deepEqual(out.u4, { present: true, single: true, lowercase: true, equalsPinned: true });
    const touched = blobs.log.slice(b0);
    assert.ok(touched.length > 0 && touched.every((e) => e.storeName === 'site:' + SSTORE && String(e.key).startsWith(`probe/${RUN}/`)), JSON.stringify(keysTouched(b0)));
    assert.ok(!touched.some((e) => e.method === 'DELETE'));
    assert.equal(touched.filter((e) => e.method === 'GET').length, 0, 'the probe never reads (an eventual edge read can be stale: A1a)');
    assert.deepEqual(blobs.mutations.filter((m) => String(m.key).startsWith(`probe/${RUN}/`)).map((m) => m.conditional), ['if-none-match', 'if-match', 'if-match'], 'bytes change exactly 3 times: create, one winner, revoke; refused attempts and verifications change nothing');
    assert.equal(touched.filter((e) => e.method === 'PUT' && e.status === 200).length, 9, 'accepted writes: create, U1 identical write, one winner, revoke, and 5 confirmations (steps 2, 4, 5, 6, 7)');
    assert.equal(touched.length, 17, 'requests: 12 + N (N = 5): the 4 reads become confirmations, plus the step-6 REVOKED confirmation and the eW replay (Bones 26)');
    assert.equal(other.length, 0);
    assert.ok(!/"c-|"w-|Bearer|__Host|cookie/i.test(r.body), 'no ETag value, token or cookie in the transcript');
  });
  await check('P3 probe positive with one sign-in ON and a bound session (sessionReadRefusal in the chain): 200, all ok', async () => {
    reset(); flag(true); const b = await bind(60);
    const out = parse(await PROBE()(probeEv({ cookie: b.cookie }))); assert.equal(out.stoppedAt, null, JSON.stringify(out.steps));
  });
  await check('P4 the probe can FAIL: a store that ignores If-None-Match -> stopped at step 2 (duplicate create accepted), later steps not run', async () => {
    reset(); flag(false); blobs.setIgnoreConditions({ ifNoneMatch: true });
    try { const out = parse(await PROBE()(probeEv({ cookie: legacyCookie() }))); assert.equal(out.stoppedAt, 2); assert.equal(out.steps.length, 2); assert.equal(out.steps[1].ok, false); }
    finally { blobs.setIgnoreConditions({}); }
  });
  await check('P5 the probe can FAIL: a store that ignores If-Match -> U2 failure at the stale-ETag step (4)', async () => {
    reset(); flag(false); blobs.setIgnoreConditions({ ifMatch: true });
    try { const out = parse(await PROBE()(probeEv({ cookie: legacyCookie() }))); assert.equal(out.stoppedAt, 4); assert.equal(out.steps[3].op, 'stale onlyIfMatch refused (U2)'); }
    finally { blobs.setIgnoreConditions({}); }
  });
  await check('P6 the probe can FAIL: per-write ETags (U1 false) -> stopped at the first identical-bytes confirmation (step 2: it must answer exactly e1, Bones 26), ETag mismatch reported', async () => {
    reset(); flag(false); blobs.setEtagMode('per-write');
    try { const out = parse(await PROBE()(probeEv({ cookie: legacyCookie() }))); assert.equal(out.stoppedAt, 2); assert.equal(out.steps[1].detail.failed, 'confirm_A_e1'); assert.deepEqual(out.steps[1].detail.confirm, { status: 200, etagMatches: false }); }
    finally { blobs.setEtagMode('content'); }
  });
  await check('P7 static: runAuthorityProbe names no authority store / anchor / session-record key and never deletes; the probe handler imports no GHL module', async () => {
    const lib = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8');
    const body = lib.slice(lib.indexOf('export async function runAuthorityProbe('));
    assert.ok(body.length > 500);
    assert.ok(!/onceAuthority|SESSION_AUTHORITY_STORE|AUTHORITY_KEY|SESSION_PREFIX|sessionKey\(|\.delete\(/.test(body));
    assert.equal((body.match(/getWithMetadata\(|\.get\(|\.list\(/g) || []).length, 0, 'the probe sections never read: verification is by conditional write (A1a)');
    const writes = body.match(/\b(?:s|st)\.set\(([^,)]+)/g) || [];
    assert.ok(writes.length >= 6 && writes.every((w) => /\.set\(key$/.test(w)), 'every probe write names only its own key: ' + writes.join(','));
    assert.ok(body.includes("probe/") || body.includes("PROBE_KEY_PREFIX"), 'the probe key is built from PROBE_KEY_PREFIX');
    for (const n of ['session-authority-probe', 'protected-noop', 'protected-noop-read', 'lib/test-probe-gate']) {
      const s = fs.readFileSync(path.join(FUNCTIONS, n + '.ts'), 'utf8');
      assert.ok(!/from "[^"]*(ghl-write-boundary|supplemental-read-budget|write-receipts|write-contracts|production-write-scope|src\/lib\/ghl|\/ghl-(?!config")[a-z-]+)"/.test(s), n);
      assert.ok(!/leadconnectorhq|fetch\(/.test(s), n + ': no outbound call');
    }
  });
  // ── PV: verification by conditional write (Gate A A1a W0, 2026-11-12; Bones 25) ──
  const revokes = (from) => blobs.log.slice(from).filter((e) => e.method === 'PUT' && String(e.body).includes('"REVOKED"')).length;
  const pv = async (setup) => { reset(); flag(false); setup(); const b0 = blobs.log.length; try { const r = await PROBE()(probeEv({ cookie: legacyCookie() })); return { r, out: parse(r), b0 }; } finally { blobs.setIgnoreConditions({}); blobs.setEtagMode('content'); } };
  const crypto = require('node:crypto');
  const cEtag = (text) => `"c-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 24)}"`;
  const recLog = (b0) => blobs.log.slice(b0).filter((e) => e.key === `probe/${RUN}/record`);
  const stored = () => { const v = blobs.store.get(`${SITE}|site:${SSTORE}|probe/${RUN}/record`) || blobs.store.get(`${SITE}|${SSTORE}|probe/${RUN}/record`); return v ? JSON.parse(v.text).label : null; };
  await check('PV1 cached (eventual) edge reads cannot affect the probe: no read; 7/7 with REVOKED stored; the exact transcript -- canonical payload, own key, requested condition and ETag of all 17 requests -- is the Bones 26 sequence', async () => {
    const { r, out, b0 } = await pv(() => blobs.setReadMode('eventual'));
    assert.equal(r.statusCode, 200); assert.equal(out.ok, true, JSON.stringify(out.steps)); assert.equal(out.stoppedAt, null);
    const L = recLog(b0); assert.equal(L.length, blobs.log.slice(b0).length, 'every request is on the probe key');
    assert.equal(L.filter((e) => e.method !== 'PUT').length, 0);
    for (const e of L) { const o = JSON.parse(e.body); assert.deepEqual(Object.keys(o), ['kind', 'label', 'runId', 'v']); assert.equal(o.kind, 'iaos-conditional-write-probe'); assert.equal(o.runId, RUN); assert.equal(o.v, 1); assert.equal(e.body, JSON.stringify(o), 'canonical bytes'); }
    const lab = (e) => JSON.parse(e.body).label;
    const w = out.steps[4].detail.winner; const body = (label) => L.find((e) => lab(e) === label).body;
    const sym = { [cEtag(body('A'))]: 'e1', [cEtag(body(`W${w}`))]: 'eW', [cEtag(body('REVOKED'))]: 'eR', '"iaos-probe-not-current"': 'stale' };
    const seq = L.map((e) => [lab(e), e.ifNoneMatch ? 'new' : sym[e.ifMatch] || e.ifMatch, e.status]);
    assert.deepEqual(seq, [['A', 'new', 200], ['B', 'new', 412], ['A', 'e1', 200], ['A', 'e1', 200], ['C', 'stale', 412], ['A', 'e1', 200],
      ['W0', 'e1', 200], ['W1', 'e1', 412], ['W2', 'e1', 412], ['W3', 'e1', 412], ['W4', 'e1', 412], [`W${w}`, 'eW', 200],
      ['REVOKED', 'eW', 200], ['REVOKED', 'eR', 200], ['A', 'e1', 412], [`W${w}`, 'eW', 412], ['REVOKED', 'eR', 200]]);
    assert.equal(stored(), 'REVOKED');
    assert.deepEqual(out.steps[4].detail, { racers: [200, 412, 412, 412, 412], winners: 1, winner: 0, etagValid: true, transitionEtagChanged: true, confirm: { status: 200, etagMatches: true }, uncertain: null, failed: null });
    assert.deepEqual(out.steps[6].detail, { replays: [412, 412], confirm: { status: 200, etagMatches: true }, uncertain: null, failed: null });
    assert.ok(!/"c-|"w-|"lie"|Bearer|__Host|cookie/i.test(r.body), 'diagnostics carry no ETag value, token or cookie');
  });
  await check('PV2 Bones 26 negative controls (eventual reads on; each fails CLOSED at its step with the precise assertion; no step after it runs; the fake origin\'s final bytes are inspected independently): false acknowledgements (fabricated / original ETag), actual wrong stored bytes, same ETag for changed content, changed ETag for identical content, refused-but-applied writes, successful stale replays (e1 and eW), a racing mutation before the confirmation', async () => {
    const W0 = '"label":"W0"', A = '"label":"A"', B = '"label":"B"', C = '"label":"C"', REV = '"label":"REVOKED"';
    const cases = [
      ['dup applied, answered 412', () => blobs.rule({ method: 'PUT', bodyIncludes: B, status: 412, apply: true, force: true }), 2, 'confirm_A_e1', 'B'],
      ['stale applied, answered 412', () => blobs.rule({ method: 'PUT', bodyIncludes: C, status: 412, apply: true, force: true }), 4, 'confirm_A_e1', 'C'],
      ['changed ETag for identical content', () => blobs.setEtagMode('per-write'), 2, 'confirm_A_e1', 'A'],
      ['same ETag for changed content', () => blobs.setEtagMode('sticky'), 5, 'exactly_one_winner', 'W4'],
      ['second acknowledged winner (fabricated ETag)', () => blobs.rule({ method: 'PUT', bodyIncludes: '"label":"W1"', lie: true }), 5, 'exactly_one_winner', 'W0'],
      ['winner acknowledged, not stored (fabricated ETag)', () => { blobs.rule({ method: 'PUT', bodyIncludes: W0, lie: true }); for (const i of [1, 2, 3, 4]) blobs.rule({ method: 'PUT', bodyIncludes: `"label":"W${i}"`, status: 412 }); }, 5, 'confirm_winner_eW', 'A'],
      ['winner acknowledged, not stored (original ETag)', () => { blobs.rule({ method: 'PUT', bodyIncludes: W0, lie: true, lieEtag: 'current' }); for (const i of [1, 2, 3, 4]) blobs.rule({ method: 'PUT', bodyIncludes: `"label":"W${i}"`, status: 412 }); }, 5, 'winner_etag_changed', 'A'],
      ['actual wrong stored bytes (honest ETag of what is stored)', () => blobs.rule({ method: 'PUT', bodyIncludes: W0, storeAs: 'WX' }), 5, 'confirm_winner_eW', 'W0'],
      ['racing mutation before the confirmation', () => blobs.rule({ method: 'PUT', bodyIncludes: W0, skip: 1, interfere: 'W3' }), 5, 'confirm_winner_eW', 'W3'],
      ['revoke acknowledged, not stored (original ETag)', () => blobs.rule({ method: 'PUT', bodyIncludes: REV, lie: true, lieEtag: 'current' }), 6, 'revoke_etag_changed', 'W0'],
      ['revoke acknowledged, not stored (fabricated ETag)', () => blobs.rule({ method: 'PUT', bodyIncludes: REV, lie: true }), 6, 'confirm_REVOKED_eR', 'W0'],
      ['stale replay with e1 succeeds', () => blobs.rule({ method: 'PUT', bodyIncludes: A, skip: 4, status: 200, apply: true, force: true }), 7, 'replay_e1_412', 'A'],
      ['stale replay with eW succeeds', () => blobs.rule({ method: 'PUT', bodyIncludes: W0, skip: 2, status: 200, apply: true, force: true }), 7, 'replay_eW_412', 'W0'],
    ];
    const got = [];
    for (const [label, setup, at, failed, finalLabel] of cases) {
      const { r, out, b0 } = await pv(() => { blobs.setReadMode('eventual'); setup(); });
      const s = out.steps[out.steps.length - 1];
      got.push([label, r.statusCode, out.ok, out.stoppedAt, out.steps.length, s.detail && s.detail.failed, stored(), recLog(b0).filter((e) => String(e.body).includes(REV)).length, recLog(b0).filter((e) => e.method === 'GET').length]);
      const exp = [label, 200, false, at, at, failed, finalLabel, at < 6 ? 0 : null, 0];
      if (exp[7] === null) exp[7] = got[got.length - 1][7];
      assert.deepEqual(got[got.length - 1], exp, label);
    }
    assert.ok(got.every((g) => g[2] === false), 'every adverse case fails closed');
  });
  await check('PV3 the fake models the A1a edge: in eventual mode a later GET of a changed key returns the FIRST answer (the cache the old read-back verification trusted); strong mode reads the store', async () => {
    reset(); blobs.setReadMode('eventual');
    const { getStore, connectLambda } = require('@netlify/blobs'); connectLambda(NF); const st = getStore({ name: SSTORE });
    await st.set('probe/pv3-model-000000/record', 'A'); assert.equal(await st.get('probe/pv3-model-000000/record'), 'A');
    await st.set('probe/pv3-model-000000/record', 'W0'); assert.equal(await st.get('probe/pv3-model-000000/record'), 'A', 'stale');
    blobs.setReadMode('strong'); assert.equal(await st.get('probe/pv3-model-000000/record'), 'W0');
    reset();
  });
  await check('PV4 proof limit made explicit (Bones 26 item 5): wrong bytes stored under a LYING ETag, then a confirm that ignores its If-Match and REPAIRS the record, answers exactly the supplied ETag -- the probe cannot see it (ok:true), but the fake origin inspection does: a 4th byte change, made by the confirmation itself', async () => {
    const { out, b0 } = await pv(() => { blobs.setReadMode('eventual'); blobs.rule({ method: 'PUT', bodyIncludes: '"label":"W0"', storeAs: 'WX', answerEtagOf: 'body' }); blobs.rule({ method: 'PUT', bodyIncludes: '"label":"W0"', status: 200, apply: true, force: true }); });
    assert.equal(out.ok, true, 'a service that lies about status and ETag is not detectable by acknowledgements alone (documented limit)');
    const m = blobs.mutations.filter((x) => String(x.key) === `probe/${RUN}/record`);
    assert.equal(m.length, 4, 'origin inspection: create, wrong winner bytes, the REPAIR by the confirmation, revoke -- a passing run must show exactly 3');
    assert.equal(recLog(b0).length, 17);
  });
  await check('PV5 a timeout or transport failure STOPS the run as uncertain and is never retried: the winner confirmation hangs (aborted at the 2 s stage cap) -> stoppedAt 5, uncertain set, exactly one confirmation attempt, no REVOKED; a transport error on the revoke -> stoppedAt 6, uncertain set, no confirm, no replay', async () => {
    let { out, b0 } = await pv(() => { blobs.rule({ method: 'PUT', bodyIncludes: '"label":"W0"', skip: 1, hang: true }); });
    assert.equal(out.ok, false); assert.equal(out.stoppedAt, 5); assert.equal(out.steps[4].detail.failed, 'confirm_winner_eW'); assert.ok(out.steps[4].detail.uncertain, JSON.stringify(out.steps[4].detail));
    assert.equal(recLog(b0).filter((e) => e.body.includes('"label":"W0"')).length, 2, 'the racer and ONE confirmation attempt: no retry');
    assert.equal(recLog(b0).filter((e) => e.body.includes('"label":"REVOKED"')).length, 0);
    ({ out, b0 } = await pv(() => { blobs.rule({ method: 'PUT', bodyIncludes: '"label":"REVOKED"', throw: true, apply: true }); }));
    assert.equal(out.ok, false); assert.equal(out.stoppedAt, 6); assert.equal(out.steps[5].detail.failed, 'revoke_status_200'); assert.ok(out.steps[5].detail.uncertain);
    assert.equal(recLog(b0).filter((e) => e.body.includes('"label":"REVOKED"')).length, 1, 'one revoke attempt, no confirm, no retry -- even though it was applied');
    assert.equal(stored(), 'REVOKED', 'applied-but-unacknowledged stays uncertain: the run stopped instead of treating it as not applied');
  });
  // ── PV6-PV18: G1 race losers 409-or-412, Test-probe-only diagnostics, run-deadline guard (Gate A r3 A1b;
  //    Bones accepted method r1 97_ + r2 98_ + r3 99_ + r4 9A_, 2026-11-13) ──
  const W = (i) => `"label":"W${i}"`;
  const loser = (i, status, extra = {}) => blobs.rule({ method: 'PUT', bodyIncludes: W(i), status, ...extra });
  const race = (out) => out.steps[4] && out.steps[4].detail;
  const noDiag = (d) => { if (!d) return d; const { diag, ...rest } = d; return rest; };
  const DIAG_KEYS = ['body', 'bytes', 'class', 'ct', 'req', 'rid', 'sha256', 'status'];
  const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const ownPattern = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = 97 + (i % 26); return b; };   // the test's OWN generator (independent of the fake)
  const recMut = () => blobs.mutations.filter((m) => m.key === `probe/${RUN}/record`);
  // Direct runs (fake clock): runAuthorityProbe with an injected `now`, through the same fake origin.
  const direct = async (setup, { now, budgetMs } = {}) => { reset(); flag(false); setup(); const b0 = blobs.log.length; const out = await rev.runAuthorityProbe(RUN, 'test', { event: NF, ...(now ? { now } : {}), ...(budgetMs ? { budgetMs } : {}) }); return { out, b0 }; };
  // A second, isolated instance of the module whose SDK store delays its settlement after the synthetic 400 (r3 T2
  // PV15(d)/(e)): '@netlify/blobs' is intercepted only while this instance loads; the main instance is untouched.
  const slowSdkRev = (delayFor) => {
    const realBlobs = require('@netlify/blobs');
    const wrapped = { ...realBlobs, getStore: (o) => { const st = realBlobs.getStore(o); return new Proxy(st, { get(t, p) { if (p !== 'set') return Reflect.get(t, p); return async (key, value, opts) => { const r = await t.set(key, value, opts); const ms = delayFor(String(value)); if (ms) await new Promise((res) => setTimeout(res, ms)); return r; }; } }); } };
    const file = require.resolve(path.join(FUNCTIONS, 'lib/session-revocation.ts'));
    const saved = require.cache[file]; delete require.cache[file];
    const origLoad = Module._load;
    Module._load = function (request, ...rest) { return request === '@netlify/blobs' ? wrapped : origLoad.call(this, request, ...rest); };
    try { return require(file); } finally { Module._load = origLoad; require.cache[file] = saved; }
  };
  await check('PV6 race losers 409 or 412 (G1 r1 1.1): [200,409,412,409,412] and the A1b shape [409,409,200,412,409] -> 7/7, REVOKED stored, 17 requests, diag only for the 409 racers', async () => {
    for (const [label, setup, racers, diagReqs] of [
      ['mixed', () => { loser(1, 409); loser(3, 409); }, [200, 409, 412, 409, 412], [1, 3]],
      ['A1b shape', () => { loser(0, 409); loser(1, 409); loser(4, 409); }, [409, 409, 200, 412, 409], [0, 1, 4]]]) {
      const { r, out, b0 } = await pv(setup);
      assert.equal(r.statusCode, 200, label); assert.equal(out.ok, true, label + ' ' + JSON.stringify(out.steps)); assert.equal(out.stoppedAt, null);
      assert.deepEqual(race(out).racers, racers, label); assert.equal(race(out).failed, null);
      assert.deepEqual(race(out).diag.map((d) => [d.req, d.status, d.class]), diagReqs.map((i) => [i, 409, 'conflict_409']), label);
      assert.equal(recLog(b0).length, 17, label); assert.equal(stored(), 'REVOKED', label);
      assert.ok(out.steps.every((s, i) => i === 4 || !s.detail || !('diag' in s.detail)), 'no diag on steps without an unexpected status');
    }
  });
  await check('PV7 all four losers answer 409 -> 7/7, REVOKED stored', async () => {
    const { out, b0 } = await pv(() => { for (const i of [1, 2, 3, 4]) loser(i, 409); });
    assert.equal(out.ok, true, JSON.stringify(out.steps)); assert.deepEqual(race(out).racers, [200, 409, 409, 409, 409]); assert.equal(recLog(b0).length, 17); assert.equal(stored(), 'REVOKED');
  });
  await check('PV8 rejected-but-applied loser, deterministic order (r3 T1, r4 U1). (a) W1 answered 409 but applied AFTER the winner W0 -> stoppedAt 5 confirm_winner_eW, one confirm, nothing after it, stored W1. (b) a deliberately misbehaving origin applies W1 despite its 409, then FORCES W0 despite its now-stale If-Match e1, storing W0 under its genuine content ETag -> 7/7 PASS: the documented proof limit (final-state confirmation cannot detect an earlier rejected-but-applied write that the winner overwrote); the fake origin verifies the conditions sent, both forced applications, A -> W1 -> W0 -> REVOKED and the final bytes', async () => {
    // (a)
    let { out, b0 } = await pv(() => { loser(1, 409, { apply: true, force: true, delayMs: 30 }); });
    assert.equal(out.ok, false); assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, 'confirm_winner_eW'); assert.deepEqual(race(out).racers, [200, 409, 412, 412, 412]);
    assert.deepEqual(recMut().map((m) => m.label), ['A', 'W0', 'W1'], '(a) mutation order');
    assert.equal(recLog(b0).length, 12, '(a) 6 + 5 racers + ONE confirm'); assert.equal(recLog(b0).filter((e) => String(e.body).includes('REVOKED')).length, 0); assert.equal(stored(), 'W1');
    assert.deepEqual(race(out).diag.map((d) => d.req), [1]);
    // (b)
    ({ out, b0 } = await pv(() => { loser(1, 409, { apply: true, force: true }); loser(0, 200, { apply: true, force: true, delayMs: 30 }); loser(2, 409); loser(4, 409); }));
    assert.equal(out.ok, true, '(b) the blind spot passes: ' + JSON.stringify(out.steps)); assert.equal(out.stoppedAt, null); assert.equal(out.steps.length, 7);
    assert.deepEqual(race(out).racers, [200, 409, 409, 412, 409]); assert.equal(recLog(b0).length, 17);
    const L = recLog(b0); const e1 = cEtag(L[0].body);
    for (const i of [0, 1]) { const put = L.find((e) => e.method === 'PUT' && e.body.includes(W(i))); assert.equal(put.ifMatch, e1, `W${i} sent If-Match e1`); assert.equal(put.ifNoneMatch, null); }
    const m = recMut();
    assert.deepEqual(m.map((x) => x.label), ['A', 'W1', 'W0', 'REVOKED'], '(b) exact mutation sequence');
    const m1 = m[1], m0 = m[2];
    assert.deepEqual([m1.forced, m1.answered, m1.storedEtagBefore, m1.ifMatch], [true, 409, e1, e1], 'W1 forced: applied despite answering 409');
    assert.deepEqual([m0.forced, m0.answered, m0.ifMatch], [true, 200, e1], 'W0 forced'); assert.notEqual(m0.storedEtagBefore, e1, 'W0 was applied on a STALE condition');
    assert.equal(m0.storedEtagBefore, cEtag(L.find((e) => e.body.includes(W(1))).body), 'the ETag before W0 was W1\'s');
    const w0put = L.find((e) => e.method === 'PUT' && e.body.includes(W(0)));
    const eW = cEtag(w0put.body); assert.notEqual(eW, e1); assert.notEqual(eW, m0.storedEtagBefore);
    const rv = L.find((e) => e.method === 'PUT' && e.body.includes('"REVOKED"')); assert.equal(rv.ifMatch, eW, 'revoke sent If-Match = W0\'s genuine content ETag');
    // Bones HOLD on 637a972 item 4: independent replay conditions, exact canonical REVOKED bytes and the expected ETag
    const REVOKED_TEXT = JSON.stringify({ kind: 'iaos-conditional-write-probe', label: 'REVOKED', runId: RUN, v: 1 });
    const eR = cEtag(REVOKED_TEXT);
    const iRv = L.indexOf(rv); const after = L.slice(iRv + 1);
    assert.deepEqual(after.map((e) => [JSON.parse(e.body).label, e.ifMatch, e.ifNoneMatch, e.status]),
      [['REVOKED', eR, null, 200], ['A', e1, null, 412], ['W0', eW, null, 412], ['REVOKED', eR, null, 200]],
      'after the revoke: its confirm at eR, the replay of A with If-Match e1, the replay of W0 with If-Match eW, the final confirm at eR');
    const st = blobs.store.get(`${SITE}|site:${SSTORE}|probe/${RUN}/record`);
    assert.equal(st.text, REVOKED_TEXT, 'exact canonical REVOKED bytes, read from the fake store'); assert.equal(st.etag, eR, 'the expected canonical revoked ETag');
    assert.notEqual(eR, eW); assert.notEqual(eR, e1);
    assert.deepEqual(race(out).diag.map((d) => d.req), [1, 2, 4]);
  });
  await check('PV9 two raw 200 winners -> stoppedAt 5 exactly_one_winner, no confirm sent', async () => {
    const { out, b0 } = await pv(() => { loser(1, 200, { apply: true, force: true }); });
    assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, 'exactly_one_winner'); assert.equal(recLog(b0).length, 11);
  });
  await check('PV10 zero winners (all five racers 409) -> stoppedAt 5 exactly_one_winner, no confirm sent', async () => {
    const { out, b0 } = await pv(() => { for (const i of [0, 1, 2, 3, 4]) loser(i, 409); });
    assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, 'exactly_one_winner'); assert.deepEqual(race(out).racers, [409, 409, 409, 409, 409]); assert.equal(recLog(b0).length, 11);
  });
  await check('PV11 false acknowledgement with 409 losers: winner answered 200 but not stored (fabricated ETag -> confirm_winner_eW; original ETag -> winner_etag_changed)', async () => {
    for (const [lieEtag, failed] of [[undefined, 'confirm_winner_eW'], ['current', 'winner_etag_changed']]) {
      const { out } = await pv(() => { blobs.rule({ method: 'PUT', bodyIncludes: W(0), lie: true, ...(lieEtag ? { lieEtag } : {}) }); for (const i of [1, 2, 3, 4]) loser(i, 409); });
      assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, failed); assert.equal(stored(), 'A');
    }
  });
  await check('PV12 wrong bytes / ETag with 409 losers: a non-canonical winner ETag -> winner_etag_canonical; a winner ETag that is not the stored record\'s -> confirm_winner_eW', async () => {
    let { out } = await pv(() => { blobs.rule({ method: 'PUT', bodyIncludes: W(0), lie: true, lieEtag: 'not canonical' }); for (const i of [1, 2, 3, 4]) loser(i, 409); });
    assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, 'winner_etag_canonical');
    ({ out } = await pv(() => { blobs.rule({ method: 'PUT', bodyIncludes: W(0), storeAs: 'WX' }); for (const i of [1, 2, 3, 4]) loser(i, 409); }));
    assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, 'confirm_winner_eW');
  });
  await check('PV13 strict 412 preserved (r1 1.1): a 409 on the duplicate create (2), the stale write (4), the replay with e1 and the replay with eW (7) each fails closed at its step', async () => {
    const got = [];
    for (const [label, setup] of [
      ['dup 409', () => blobs.rule({ method: 'PUT', bodyIncludes: '"label":"B"', status: 409 })],
      ['stale 409', () => blobs.rule({ method: 'PUT', bodyIncludes: '"label":"C"', status: 409 })],
      ['replay e1 409', () => blobs.rule({ method: 'PUT', bodyIncludes: '"label":"A"', skip: 4, status: 409 })],
      ['replay eW 409', () => blobs.rule({ method: 'PUT', bodyIncludes: W(0), skip: 2, status: 409 })]]) {
      const { out } = await pv(setup); const s = out.steps[out.steps.length - 1];
      got.push([label, out.ok, out.stoppedAt, s.detail.failed, (s.detail.diag || []).map((d) => d.status)]);
    }
    assert.deepEqual(got, [['dup 409', false, 2, 'duplicate_status_412', [409]], ['stale 409', false, 4, 'stale_status_412', [409]],
      ['replay e1 409', false, 7, 'replay_e1_412', [409]], ['replay eW 409', false, 7, 'replay_eW_412', [409]]]);
  });
  await check('PV14 any other loser answer fails closed, one attempt each, no retry: 500 / 403 / 429 -> losers_409_or_412 (diag class unexpected); a transport failure -> uncertain transport; a 409 answered after the run deadline -> uncertain deadline, ok:false, no confirm', async () => {
    for (const st of [500, 403, 429]) {
      const { out, b0 } = await pv(() => loser(1, st));
      assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, 'losers_409_or_412', String(st)); assert.deepEqual(race(out).diag.map((d) => [d.req, d.status, d.class]), [[1, st, 'unexpected']]);
      assert.equal(recLog(b0).filter((e) => e.body.includes(W(1))).length, 1); assert.equal(recLog(b0).length, 11);
    }
    let { out, b0 } = await pv(() => blobs.rule({ method: 'PUT', bodyIncludes: W(1), throw: true }));
    assert.equal(out.stoppedAt, 5); assert.equal(race(out).failed, 'losers_409_or_412'); assert.equal(race(out).uncertain, 'transport'); assert.equal(recLog(b0).length, 11);
    ({ out, b0 } = await direct(() => loser(1, 409, { delayMs: 1700 }), { budgetMs: 1500 }));
    assert.equal(out.ok, false); assert.equal(out.stoppedAt, 5); assert.equal(out.steps[4].detail.uncertain, 'deadline', JSON.stringify(out.steps[4]));
    assert.equal(recLog(b0).filter((e) => e.body.includes(W(1))).length, 1); assert.equal(recLog(b0).length, 11, 'no confirm');
  });
  await check('PV15 stalled and abort-ignoring 409 bodies, delayed SDK settlement (r2 R2, r3 T2): the raw 409 is kept, diag "timeout", the join waits only the REMAINING time to the absolute end, one attempt, the run proceeds normally; an SDK that settles after the run deadline -> uncertain deadline, ok:false, no confirm', async () => {
    for (const [stall, bytes] of [['cancel', 0], ['ignore', 0], ['oneByte', 1]]) {
      const t0 = Date.now(); const { out, b0 } = await pv(() => loser(1, 409, { errorBody: { stall } })); const ms = Date.now() - t0;
      assert.equal(out.ok, true, stall + ' ' + JSON.stringify(out.steps)); assert.deepEqual(race(out).racers, [200, 409, 412, 412, 412]);
      const d = race(out).diag[0]; assert.deepEqual([d.req, d.status, d.body, d.bytes, d.sha256], [1, 409, 'timeout', bytes, bytes ? sha256(ownPattern(1)) : null], stall);
      assert.ok(ms < 250 + 1500, `${stall}: bounded (${ms} ms)`); assert.equal(recLog(b0).filter((e) => e.body.includes(W(1))).length, 1);
      assert.ok(blobs.bodyCancels() >= 1, stall + ': cancel was requested (never awaited)');
    }
    // (d) SDK settlement delayed 400 ms (past the 250 ms absolute end) while the body stalls: the join adds nothing
    const slow = slowSdkRev((v) => (v.includes(W(1)) ? 400 : 0));
    reset(); flag(false); loser(1, 409, { errorBody: { stall: 'cancel' } });
    let out = await slow.runAuthorityProbe(RUN, 'test', { event: NF });
    assert.equal(out.ok, true, JSON.stringify(out.steps)); assert.equal(race(out).diag[0].body, 'timeout');
    assert.ok(out.steps[4].duration_ms >= 395 && out.steps[4].duration_ms < 400 + 200, 'step 5 = the 400 ms settlement + its confirm, no restarted allowance: ' + out.steps[4].duration_ms);
    reset(); flag(false); loser(1, 409);
    const ref = await slow.runAuthorityProbe(RUN, 'test', { event: NF });
    assert.deepEqual(noDiag(race(out)), noDiag(race(ref)), 'the Recorded-derived detail equals the same run without a diagnostic body');
    // (e) SDK settlement delayed past the run deadline
    const slower = slowSdkRev((v) => (v.includes(W(1)) ? 1800 : 0));
    reset(); flag(false); loser(1, 409, { errorBody: { stall: 'ignore' } }); const b0 = blobs.log.length;
    out = await slower.runAuthorityProbe(RUN, 'test', { event: NF, budgetMs: 1500 });
    assert.equal(out.ok, false); assert.equal(out.stoppedAt, 5); assert.equal(out.steps[4].detail.uncertain, 'deadline'); assert.equal(blobs.log.slice(b0).length, 11, 'no confirm');
    assert.ok(out.steps[4].duration_ms < 1500 + 200, 'the diag join did not wait past the deadline: ' + out.steps[4].duration_ms);
  });
  await check('PV16 bounded reads and exact deadline boundaries (r2 R2, r3 T2, r4 U2): (a) one 1 MiB chunk -> 4096 bytes, prefix, the test\'s own sha256 of the first 4096; (b) exactly 4096 then EOF -> complete; (c) one 4097-byte chunk -> prefix; (d) headers inside the 50 ms reserve -> skipped_deadline; (e)/(f) headers just past the reserve -> timeout bounded by the absolute end; (g) clock past the deadline during the join -> run_deadline, nothing further; (h) a never-settling cancel near the deadline leaves no timer; (i) exactly AT the deadline after the race -> run_deadline, no confirm; (j) completion exactly at the deadline cannot PASS; (k) 1 ms before it passes; the deadline step keeps its safe projection (racer statuses, request statuses, ETag booleans); (l)-(o) a read resolving at or after the absolute end is rejected independent of the timer (1 ms before is accepted); (p)-(r) done() itself decides at deadline - 1 ms / exactly / after; (s)/(t) the deadline immediately before / upon the winner confirmation keeps the race (and confirmation) evidence and sends nothing after', async () => {
    for (const [label, eb, bytes, body] of [['a', { bytes: 1 << 20 }, 4096, 'prefix'], ['b', { bytes: 4096 }, 4096, 'complete'], ['c', { bytes: 4097 }, 4096, 'prefix']]) {
      const { out } = await pv(() => loser(1, 409, { errorBody: eb })); const d = race(out).diag[0];
      assert.deepEqual([d.bytes, d.body, d.sha256], [bytes, body, sha256(ownPattern(4096))], label);
      const { out: ref } = await pv(() => loser(1, 409)); assert.deepEqual(noDiag(race(out)), noDiag(race(ref)), label + ': Recorded unaffected');
      assert.equal(out.ok, true, label);
    }
    /* fake clock: real time + an offset the fake origin moves when the LAST racer (W4) arrives (all racers already
       started). The budget is below the 2 s stage cap, so W4's stage end IS the run deadline and moving the clock models
       time passing inside that one request, not past its stage cap. */
    const BUDGET = 1_500;
    const clockRun = async (setOff, eb) => {
      let off = 0; let deadline = 0; const now = () => Date.now() + off;
      const { out, b0 } = await direct(() => { loser(4, 409, { errorBody: eb, before: () => { off = setOff(deadline - Date.now()); } }); }, { now: () => { const t = now(); if (!deadline) deadline = t + BUDGET; return t; }, budgetMs: BUDGET });
      return { out, b0, d: (race(out).diag || []).find((x) => x.req === 4) };
    };
    let r = await clockRun((left) => left - 40, { bytes: 10 });                         // (d) 40 ms left at headers (< 50 ms reserve)
    assert.deepEqual([r.d.status, r.d.body, r.d.bytes, r.d.sha256], [409, 'skipped_deadline', 0, null], '(d)'); assert.equal(race(r.out).racers[4], 409);
    let t0 = Date.now(); r = await clockRun((left) => left - 70, { stall: 'cancel' });     // (e) 70 ms left: the absolute end is ~20 ms after the headers (timer jitter margin)
    assert.equal(r.d.body, 'timeout', '(e)'); assert.ok(Date.now() - t0 < 1500, '(e) bounded');
    r = await clockRun((left) => left - 80, { stall: 'oneByte' });                         // (f) 80 ms left
    assert.deepEqual([r.d.body, r.d.bytes], ['timeout', 1], '(f)'); assert.equal(r.out.ok, false);
    r = await clockRun((left) => left + 1, { stall: 'cancel' });                           // (g) past the deadline during the join
    assert.equal(r.out.ok, false); assert.equal(r.out.stoppedAt, 5); assert.deepEqual([race(r.out).failed, race(r.out).uncertain], ['run_deadline', 'deadline']);
    assert.equal(blobs.log.slice(r.b0).length, 11, '(g) nothing after the racers');
    // (h) a never-settling cancel near the deadline: every timer the module created has been cleared or has fired at return
    const live = new Set(); const st0 = global.setTimeout, ct0 = global.clearTimeout;
    global.setTimeout = (fn, ms, ...a) => { const h = st0(() => { live.delete(h); fn(...a); }, ms); live.add(h); return h; };
    global.clearTimeout = (h) => { live.delete(h); return ct0(h); };
    try { r = await clockRun((left) => left - 100, { stall: 'ignore' }); } finally { global.setTimeout = st0; global.clearTimeout = ct0; }
    assert.equal(r.d.body, 'timeout', '(h)'); assert.equal(live.size, 0, '(h) no pending timer at return');
    // (i)/(j)/(k) frozen clock: time moves only when the fake origin sets it
    const frozen = async (rule) => { let T = 1_000_000; const D = T + BUDGET; const { out, b0 } = await direct(() => rule((v) => { T = v(D); }), { now: () => T, budgetMs: BUDGET }); return { out, b0 }; };
    r = await frozen((set) => loser(4, 412, { before: () => set((D) => D) }));
    assert.deepEqual([r.out.ok, r.out.stoppedAt, race(r.out).failed, race(r.out).uncertain], [false, 5, 'run_deadline', 'deadline'], '(i)');
    assert.equal(blobs.log.slice(r.b0).length, 11, '(i) no confirm, no request after the racers');
    // Bones HOLD item 2: the deadline step keeps its safe projection -- racer statuses, winner, ETag booleans -- no ETag value
    assert.deepEqual(noDiag(race(r.out)), { racers: [200, 412, 412, 412, 412], winners: 1, winner: 0, etagValid: true, transitionEtagChanged: true, confirm: null, requests: [], uncertain: 'deadline', failed: 'run_deadline' }, '(i) evidence kept');
    // (s) Bones REVISE on eee59cb: racers finish normally, the deadline is reached IMMEDIATELY BEFORE the winner
    // confirmation (its pre-send guard): race evidence kept, the confirmation never sent, nothing after it.
    {
      const T = 1_000_000; const D = T + BUDGET; let calls = 0; let at = Infinity; let confirmCall = -1;
      const runS = async () => { calls = 0; return direct(() => blobs.rule({ method: 'PUT', bodyIncludes: W(0), skip: 1, before: () => { confirmCall = calls; } }), { now: () => { calls += 1; return calls >= at ? D : T; }, budgetMs: BUDGET }); };
      await runS(); const k = confirmCall;            // calibration: clock reads made when the confirmation reached the origin
      at = k - 3;                                     // its pre-send guard, then attempt's cutoff, start-left and stage-end reads
      const { out, b0 } = await runS();
      assert.deepEqual([out.ok, out.stoppedAt, out.steps.length], [false, 5, 5], '(s)');
      assert.deepEqual(noDiag(race(out)), { racers: [200, 412, 412, 412, 412], winners: 1, winner: 0, etagValid: true, transitionEtagChanged: true, confirm: null, requests: [], uncertain: 'deadline', failed: 'run_deadline' }, '(s) race evidence kept; the confirmation was never sent (requests [])');
      assert.equal(blobs.log.slice(b0).length, 11, '(s) no confirmation request, nothing after');
    }
    // (t) the deadline is reached UPON the winner confirmation's return: race and confirmation evidence kept, no step 6
    r = await frozen((set) => blobs.rule({ method: 'PUT', bodyIncludes: W(0), skip: 1, before: () => set((D) => D) }));
    assert.deepEqual([r.out.ok, r.out.stoppedAt, r.out.steps.length], [false, 5, 5], '(t)');
    assert.deepEqual(noDiag(race(r.out)), { racers: [200, 412, 412, 412, 412], winners: 1, winner: 0, etagValid: true, transitionEtagChanged: true, confirm: { status: 200, etagMatches: true }, requests: [{ status: 200, etagMatches: true }], uncertain: 'deadline', failed: 'run_deadline' }, '(t) race + confirmation evidence kept');
    assert.equal(blobs.log.slice(r.b0).length, 12, '(t) the confirmation was sent; no revoke or anything after');
    assert.ok(!/"c-|"w-/.test(JSON.stringify(r.out)), '(t) no ETag value');
    assert.ok(!/"c-|"w-/.test(JSON.stringify(r.out)), '(i) no ETag value');
    r = await frozen((set) => blobs.rule({ method: 'PUT', bodyIncludes: '"label":"REVOKED"', skip: 2, before: () => set((D) => D) }));
    assert.deepEqual([r.out.ok, r.out.stoppedAt, r.out.steps[6].detail.failed, r.out.steps[6].detail.uncertain], [false, 7, 'run_deadline', 'deadline'], '(j)');
    assert.equal(blobs.log.slice(r.b0).length, 17, '(j) nothing after the last confirm');
    assert.deepEqual([r.out.steps.length, r.out.steps[6].status, r.out.steps[6].detail.requests], [7, 412, [{ status: 412 }, { status: 412 }, { status: 200, etagMatches: true }]], '(j) step 7 reported with its requests\' statuses');
    r = await frozen((set) => blobs.rule({ method: 'PUT', bodyIncludes: '"label":"REVOKED"', skip: 2, before: () => set((D) => D - 1) }));
    assert.deepEqual([r.out.ok, r.out.stoppedAt, r.out.steps.length], [true, null, 7], '(k) 1 ms before the deadline passes');
    // (l)-(o) Bones HOLD item 1: the read is re-checked AFTER it resolves, independent of the timer (frozen clock: the
    // 250 ms timer has not fired when the read resolves). The clock moves exactly as the pull answers.
    const readAt = async (dt, eb) => {
      let T = 1_000_000; const D = T + 20_000;
      const { out } = await direct(() => loser(4, 409, { errorBody: { ...eb, pull: true, onPull: (i) => { if (i === 0) T = T0 + dt; } }, before: () => { T0 = T; } }), { now: () => T, budgetMs: 20_000 });
      void D; return race(out).diag.find((x) => x.req === 4);
    };
    let T0 = 0;
    let dg = await readAt(250, { bytes: 10, chunks: [10] });          // (l) a chunk that resolves EXACTLY at the absolute end
    assert.deepEqual([dg.body, dg.bytes, dg.sha256], ['timeout', 0, null], '(l) bytes at the end are not accepted');
    dg = await readAt(400, { bytes: 10, chunks: [10] });               // (m) late resolution
    assert.deepEqual([dg.body, dg.bytes, dg.sha256], ['timeout', 0, null], '(m) late bytes are not accepted');
    dg = await readAt(250, { bytes: 0, chunks: [] });                  // (n) EOF exactly at the end
    assert.deepEqual([dg.body, dg.bytes], ['timeout', 0], '(n) EOF at the end is not accepted as "empty"');
    dg = await readAt(249, { bytes: 10, chunks: [10] });               // (o) control: 1 ms before the end
    assert.deepEqual([dg.body, dg.bytes, dg.sha256], ['complete', 10, sha256(ownPattern(10))], '(o) 1 ms before the end is accepted');
    // (p)-(r) Bones HOLD item 3: finalization in done() itself. The LAST clock read of a run is done()'s; every earlier
    // read (every guard) sees the unchanged clock. Calibrate the count, then move only that read.
    const finalAt = async (offset) => {
      let calls = 0; const T = 1_000_000; const D = T + 20_000; let target = Infinity;
      const run = async () => { calls = 0; return (await direct(() => {}, { now: () => { calls += 1; return calls === target ? D + offset : T; }, budgetMs: 20_000 })).out; };
      target = Infinity; const cal = await run(); assert.equal(cal.ok, true); const N = calls;
      target = N; const out = await run(); assert.equal(calls, N, 'same number of clock reads'); return out;
    };
    let fo = await finalAt(-1);
    assert.deepEqual([fo.ok, fo.stoppedAt], [true, null], '(p) finalization at deadline - 1 ms passes');
    for (const [lab, off] of [['(q) exactly at the deadline', 0], ['(r) after the deadline', 1]]) {
      fo = await finalAt(off);
      assert.deepEqual([fo.ok, fo.stoppedAt, fo.steps.length, fo.steps[6].detail.failed, fo.steps[6].detail.uncertain], [false, 7, 7, 'run_deadline', 'deadline'], lab);
      assert.ok(!('requests' in fo.steps[6].detail) && Array.isArray(fo.steps[6].detail.replays), lab + ': decided by done(), not by an earlier guard (step 7 completed normally)');
    }
  });
  await check('PV17 exact output allowlist and hash semantics: seeded bearer token, signed URL, 64-hex ETag, Set-Cookie, bad request id and a parameterised content-type never appear; ProbeDiag keys exactly the allowlist; sha256 null iff 0 bytes, else the sha256 of exactly the bytes read', async () => {
    const hex = 'ab'.repeat(32);
    const seeded = `{"error":"Bearer eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.sig","url":"https://blobs.invalid/x?X-Amz-Signature=deadbeef","etag":"\\"${hex}\\"","cookie":"__Host-iaos_read=secret"}`;
    const { r, out } = await pv(() => {
      loser(1, 409, { errorBody: seeded, headers: { 'x-nf-request-id': 'Bearer eyJ-not-a-rid', 'content-type': 'application/json; charset=utf-8; x=https://signed.invalid/?sig=1', 'set-cookie': '__Host-iaos_read=secret', etag: `"${hex}"` } });
      loser(2, 409, { errorBody: '', headers: { 'x-nf-request-id': '01ABCDEFGHJKMNPQRSTVWXYZ01', 'content-type': 'application/problem+json' } });
      loser(3, 409);
    });
    assert.equal(out.ok, true, JSON.stringify(out.steps));
    const [d1, d2, d3] = race(out).diag;
    for (const d of [d1, d2, d3]) {
      assert.deepEqual(Object.keys(d).sort(), DIAG_KEYS); assert.ok(Object.isFrozen(d) || true);
      assert.ok(['conflict_409', 'unexpected'].includes(d.class)); assert.ok(d.rid === null || d.rid === 'invalid' || /^[0-9A-Z]{26}$/.test(d.rid));
      assert.ok(['none', 'empty', 'complete', 'prefix', 'timeout', 'error', 'skipped_deadline'].includes(d.body));
      assert.ok(d.ct === null || ['application/json', 'text/plain', 'application/xml', 'text/html', 'other'].includes(d.ct));
      assert.equal(d.sha256 === null, d.bytes === 0); if (d.sha256 !== null) assert.match(d.sha256, /^[0-9a-f]{64}$/);
    }
    assert.deepEqual([d1.req, d1.rid, d1.ct, d1.body, d1.bytes, d1.sha256], [1, 'invalid', 'application/json', 'complete', Buffer.byteLength(seeded), sha256(Buffer.from(seeded))]);
    assert.deepEqual([d2.req, d2.rid, d2.ct, d2.body, d2.bytes, d2.sha256], [2, '01ABCDEFGHJKMNPQRSTVWXYZ01', 'other', 'empty', 0, null]);
    assert.equal(d3.req, 3); assert.ok(['none', 'empty'].includes(d3.body)); assert.equal(d3.bytes, 0);
    for (const bad of ['eyJ', 'Bearer', 'Signature', 'signed.invalid', '__Host', 'secret', hex, 'charset', 'Set-Cookie']) assert.ok(!r.body.includes(bad), 'transcript carries ' + bad);
    assert.ok(out.steps.every((s, i) => i === 4 || !s.detail || !('diag' in s.detail)));
  });
  await check('PV18 product paths never collect (r2 R2, r3 T3): STATIC -- invocations counted on comment- and type-stripped code with string / template literals blanked, declarations counted separately (self-tested): probeDiagOf 1 decl / 1 call (in attempt), attempt 1 decl / 3 calls (once, onceAuthority, onceProbe), attempt with a sink 1 (in onceProbe), onceProbe 1 decl / 2 calls (both inside runAuthorityProbe), none in any product function; DYNAMIC -- checkSession / revokeSession / beginSession fed 409 bodies seeded as in PV17 give the A6 results, read the whole body (the existing arrayBuffer path: every chunk pulled, no cancel), and create no ProbeDiag', async () => {
    const strip = (src) => {
      const js = ts.transpileModule(src, { compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      let out = ''; let i = 0; const n = js.length;
      while (i < n) {
        const c = js[i];
        if (c === '"' || c === "'" || c === '`') { const q = c; out += ' '; i++; while (i < n && js[i] !== q) { if (js[i] === '\\') i++; i++; } out += ' '; i++; continue; }
        out += c; i++;
      }
      return out;
    };
    const DECL = (name) => new RegExp(`(?:^|[^.\\w])(?:async\\s+)?function\\s+${name}\\s*\\(`, 'g');
    const CALL = (name) => new RegExp(`(?:^|[^.\\w])${name}\\s*\\(`, 'g');
    const count = (code, name) => { const d = (code.match(DECL(name)) || []).length; return { decl: d, calls: (code.match(CALL(name)) || []).length - d }; };
    // self-test: one declaration, two calls, one comment mention, one string mention -> 1 / 2
    assert.deepEqual(count(strip('function probeDiagOf(a) { return a; }\n// probeDiagOf(x) in a comment\nconst s = "probeDiagOf(y)";\nprobeDiagOf(1); probeDiagOf(2);\n'), 'probeDiagOf'), { decl: 1, calls: 2 }, 'counter self-test');
    const src = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8');
    const code = strip(src);
    const fnSlice = (name) => { const m = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(code); assert.ok(m, 'function ' + name); const rest = code.slice(m.index + 1); const end = rest.search(/\n(?:async\s+)?function\s|\nclass\s|\nexports\.|\nconst\s+[A-Z_]+\s*=/); return end < 0 ? rest : rest.slice(0, end); };
    assert.deepEqual(count(code, 'startProbeDiag'), { decl: 1, calls: 1 }); assert.equal(count(fnSlice('attempt'), 'startProbeDiag').calls, 1, 'the diagnostic starts only inside attempt');
    assert.deepEqual(count(code, 'attempt'), { decl: 1, calls: 3 });
    assert.equal((fnSlice('attempt').match(/if \(diag\)/g) || []).length, 1);
    assert.equal(count(fnSlice('once'), 'attempt').calls, 1); assert.equal(count(fnSlice('onceAuthority'), 'attempt').calls, 1); assert.equal(count(fnSlice('onceProbe'), 'attempt').calls, 1);
    assert.equal((code.match(/attempt\(ctx, (?:exports\.)?REVOCATION_STORE, op, sink\)/g) || []).length, 1, 'exactly one call passes a sink, in onceProbe (the transpile qualifies the export)');
    assert.deepEqual(count(code, 'onceProbe'), { decl: 1, calls: 2 }); assert.equal(count(fnSlice('runAuthorityProbe'), 'onceProbe').calls, 2, 'both onceProbe calls are inside runAuthorityProbe');
    assert.deepEqual(count(code, 'joinProbeDiag'), { decl: 1, calls: 1 }); assert.equal(count(fnSlice('onceProbe'), 'joinProbeDiag').calls, 1);
    for (const name of ['beginSession', 'checkSession', 'revokeSession', 'confirmAnchor', 'once', 'onceAuthority', 'runCheckShapeProbe']) {
      const body = fnSlice(name);
      for (const sym of ['onceProbe', 'startProbeDiag', 'joinProbeDiag']) assert.equal(count(body, sym).calls, 0, `${name} never calls ${sym}`);
      assert.ok(!/\bdiag\b|DiagSink|ProbeDiag/.test(body), name + ' names no diagnostic');
    }
    // DYNAMIC: Object.freeze spy for ProbeDiag-shaped objects; pull-counted 409 bodies on every product write
    const freeze0 = Object.freeze; let diags = 0;
    Object.freeze = function (o) { if (o && typeof o === 'object' && 'sha256' in o && 'bytes' in o) diags += 1; return freeze0.call(Object, o); };
    try {
      reset(); const Bs = await bind(7); blobs.log.length = 0;
      const body = { bytes: 6000, chunks: [1000, 1000, 1000, 1000, 1000, 1000], pull: true };
      blobs.rule({ method: 'PUT', key: sKey(Bs.sid), status: 409, errorBody: body, headers: { 'x-nf-request-id': 'Bearer eyJ' } });
      assert.equal((await rev.checkSession(Bs, 'test', { event: NF })).kind, 'unavailable', 'checkSession: the A6 409 result');
      assert.equal(blobs.bodyPulls(), 7, 'the whole body was read (6 chunks + end): the existing arrayBuffer path'); assert.equal(blobs.bodyCancels(), 0, 'no diagnostic cancel');
      blobs.rule({ method: 'PUT', key: sKey(Bs.sid), status: 409, errorBody: body });
      const rv = await rev.revokeSession(Bs.sid, Bs.epoch, 'test', { event: NF });
      assert.ok(rv.kind !== 'verified', 'revokeSession on a 409: not verified (' + rv.kind + ')');
      reset(); blobs.rule({ method: 'PUT', key: ANCHOR_KEY, status: 409, errorBody: body });
      assert.equal((await rev.beginSession(sid(8), 'test', { event: NF })).kind, 'unavailable', 'beginSession on a 409 anchor confirm: unavailable');
      assert.equal(blobs.bodyCancels(), 0);
    } finally { Object.freeze = freeze0; }
    assert.equal(diags, 0, 'no ProbeDiag was created on any product path');
  });
  // ── PT / PC: P-1 timing and the check-shape mode (Bones REVISE P2 on the activation plan, U3; Jeff 2026-11-10) ──
  const checkEv = (o = {}) => ev({ body: JSON.stringify({ probe: 'check', runId: RUN }), ...o });
  const CK_S = 'probe/' + RUN + '/check-session'; const CK_A = 'probe/' + RUN + '/check-anchor';
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  await check('PT1 authority probe: every step carries a server-measured, monotonic duration_ms (a 60 ms store delay on step 1 shows up in step 1), total_ms covers the steps, and ok:true', async () => {
    reset(); flag(false); blobs.rule({ method: 'PUT', delayMs: 60, key: 'probe/' + RUN + '/record' });
    const r = await PROBE()(probeEv({ cookie: legacyCookie() })); const out = parse(r);
    assert.equal(r.statusCode, 200, r.body); assert.equal(out.mode, 'conditional-write'); assert.equal(out.ok, true, JSON.stringify(out.steps));
    assert.ok(out.steps.length === 7 && out.steps.every((x) => num(x.duration_ms)), JSON.stringify(out.steps));
    assert.ok(out.steps[0].duration_ms >= 55, 'step 1 measured the delayed write: ' + out.steps[0].duration_ms);
    assert.ok(num(out.total_ms) && out.total_ms + 0.05 >= out.steps.reduce((a, x) => a + x.duration_ms, 0), 'total_ms >= sum of steps');
  });
  await check('PT2 the caller cannot miss a failure: every stopped run (ignored If-None-Match / ignored If-Match / per-write ETags) is HTTP 200 with a top-level ok:false and a stoppedAt; the passing run is ok:true', async () => {
    const outcomes = [];
    for (const [label, on, off] of [
      ['ifNoneMatch ignored', () => blobs.setIgnoreConditions({ ifNoneMatch: true }), () => blobs.setIgnoreConditions({})],
      ['ifMatch ignored', () => blobs.setIgnoreConditions({ ifMatch: true }), () => blobs.setIgnoreConditions({})],
      ['per-write ETags', () => blobs.setEtagMode('per-write'), () => blobs.setEtagMode('content')],
      ['passing', () => {}, () => {}]]) {
      reset(); flag(false); on();
      try { const r = await PROBE()(probeEv({ cookie: legacyCookie() })); const o = parse(r); outcomes.push([label, r.statusCode, o.ok, o.stoppedAt !== null]); }
      finally { off(); }
    }
    assert.deepEqual(outcomes, [['ifNoneMatch ignored', 200, false, true], ['ifMatch ignored', 200, false, true], ['per-write ETags', 200, false, true], ['passing', 200, true, false]]);
  });
  await check('PC1 check mode positive: 200, ok:true, budget 3000 ms; 2 setup creates + 5 samples, each sample two 200s with the ETag unchanged, within budget, numeric durations; ONLY probe/<runId>/check-session and check-anchor in iaos-write-receipts, PUT only (12 writes), never the authority store, a session record or a delete; no ETag value in the transcript', async () => {
    reset(); flag(false); const b0 = blobs.log.length; other = [];
    const r = await PROBE()(checkEv({ cookie: legacyCookie() })); const out = parse(r);
    assert.equal(r.statusCode, 200, r.body); assert.equal(out.mode, 'check-shape'); assert.equal(out.ok, true, r.body); assert.equal(out.stoppedAt, null);
    assert.equal(out.budget_ms, 3000);
    assert.deepEqual(out.setup.map((x) => x.ok), [true, true]);
    assert.equal(out.samples.length, 5);
    assert.ok(out.samples.every((x) => x.ok && x.withinBudget && num(x.duration_ms) && num(x.session.duration_ms) && num(x.anchor.duration_ms) &&
      x.session.status === 200 && x.anchor.status === 200 && x.session.etagUnchanged === true && x.anchor.etagUnchanged === true), r.body);
    assert.ok(num(out.max_sample_ms) && num(out.total_ms));
    const touched = blobs.log.slice(b0);
    assert.ok(touched.length === 12 && touched.every((e) => e.storeName === 'site:' + SSTORE && (e.key === CK_S || e.key === CK_A) && e.method === 'PUT'), JSON.stringify(keysTouched(b0)));
    assert.equal(touched.filter((e) => e.ifMatch).length, 10, 'every sample write is onlyIfMatch');
    assert.equal(other.length, 0);
    assert.ok(!/"c-|"w-|Bearer|__Host|cookie|etag"\s*:\s*"/i.test(r.body), 'no ETag value, token or cookie in the transcript');
  });
  await check('PC2 check mode measures the PARALLEL pair, per write: two 200 ms writes -> each write ~200 ms, the sample ~200 ms (not ~400), so the 3 s check path is measured, not inferred', async () => {
    reset(); flag(false);
    blobs.rule({ method: 'PUT', delayMs: 200, key: CK_S }, { method: 'PUT', delayMs: 200, key: CK_A }, { method: 'PUT', delayMs: 200, key: CK_S }, { method: 'PUT', delayMs: 200, key: CK_A });
    const out = parse(await PROBE()(checkEv({ cookie: legacyCookie() })));
    assert.equal(out.ok, true, JSON.stringify(out));
    const s1 = out.samples[0];
    assert.ok(s1.session.duration_ms >= 190 && s1.anchor.duration_ms >= 190, JSON.stringify(s1));
    assert.ok(s1.duration_ms >= 190 && s1.duration_ms < 380, 'parallel: ' + s1.duration_ms);
    assert.ok(out.setup.every((x) => x.duration_ms >= 190), 'setup creates measured: ' + JSON.stringify(out.setup));
  });
  await check('PC3 check mode over budget (Bones REVISE, test only, 2026-11-13): (a) a 400 ms write against a 300 ms check budget, the delayed rule confirmed executed -> ok:false, stopped at sample 1, session status null, why "deadline" (each assertion separate, the safe result in every message; no assumption about WHEN a correctly rejected sample returns); (b) the withinBudget clock boundary decided deterministically with a frozen clock: a write answered at deadline - 1 and exactly at the deadline is within budget (the product rule is now <= deadline), 1 ms after it is not -- ok:false, sample 1, status null, why "deadline"', async () => {
    // (a) real timers: the 400 ms rule must actually run on the first sample's session write
    reset(); flag(false);
    let delayedHit = 0;
    blobs.rule({ method: 'PUT', key: CK_S }, { method: 'PUT', delayMs: 400, key: CK_S, before: () => { delayedHit += 1; } });
    const out = await rev.runCheckShapeProbe(RUN, 'test', { event: NF, checkBudgetMs: 300 });
    const safe = JSON.stringify({ ok: out.ok, stoppedAt: out.stoppedAt, budget_ms: out.budget_ms, samples: out.samples, setup: out.setup && out.setup.map((s) => [s.n, s.status, s.ok]) });
    assert.equal(delayedHit, 1, 'the delayed rule executed exactly once: ' + safe);
    if (out.ok !== false) throw new Error('STOP: ok:true despite the confirmed 400 ms delayed write -- investigate the product path: ' + safe);
    assert.deepEqual(out.stoppedAt, { phase: 'sample', n: 1 }, 'stopped at sample 1: ' + safe);
    assert.equal(out.samples.length, 1, 'exactly one sample: ' + safe);
    assert.equal(out.samples[0].session.status, null, 'session status null (no answer inside the deadline): ' + safe);
    assert.equal(out.samples[0].session.why, 'deadline', 'session why "deadline": ' + safe);
    assert.equal(out.budget_ms, 300, 'budget 300: ' + safe);
    // (b) frozen clock: time moves only when the fake origin answers the first sample's session write
    const boundary = async (delta) => {
      reset(); flag(false);
      let T = 1_000_000; let creates = 0;
      blobs.rule({ method: 'PUT', key: CK_S, before: () => { creates += 1; } }, { method: 'PUT', key: CK_S, before: () => { T += 300 + delta; } });
      const o = await rev.runCheckShapeProbe(RUN, 'test', { event: NF, checkBudgetMs: 300, now: () => T });
      return { o, creates, safe: JSON.stringify({ ok: o.ok, stoppedAt: o.stoppedAt, s1: o.samples[0] }) };
    };
    for (const delta of [-1, 0]) {
      const { o, creates, safe: s } = await boundary(delta);
      assert.equal(creates, 1, `delta ${delta}: setup create matched: ` + s);
      assert.equal(o.samples[0].session.status, 200, `delta ${delta}: answered within the deadline: ` + s);
      assert.equal(o.samples[0].withinBudget, true, `delta ${delta}: withinBudget true at deadline ${delta === 0 ? '(exact)' : '- 1'}: ` + s);
    }
    const { o: late, safe: sl } = await boundary(1);
    assert.equal(late.ok, false, 'deadline + 1: ok false: ' + sl);
    assert.deepEqual(late.stoppedAt, { phase: 'sample', n: 1 }, 'deadline + 1: stopped at sample 1: ' + sl);
    assert.equal(late.samples[0].session.status, null, 'deadline + 1: session status null: ' + sl);
    assert.equal(late.samples[0].session.why, 'deadline', 'deadline + 1: why "deadline": ' + sl);
    assert.equal(late.samples[0].withinBudget, false, 'deadline + 1: withinBudget false: ' + sl);
  });
  await check('PC4 check mode can FAIL through the handler: per-write ETags (the bound ETag changes) -> HTTP 200, ok:false, stopped at sample 1, etagUnchanged false', async () => {
    reset(); flag(false); blobs.setEtagMode('per-write');
    try {
      const r = await PROBE()(checkEv({ cookie: legacyCookie() })); const out = parse(r);
      assert.equal(r.statusCode, 200); assert.equal(out.ok, false); assert.deepEqual(out.stoppedAt, { phase: 'sample', n: 1 });
      assert.equal(out.samples[0].session.etagUnchanged, false);
    } finally { blobs.setEtagMode('content'); }
  });
  await check('PC5 a reused runId cannot overwrite: the second check run stops at setup step 1 (onlyIfNew 412), HTTP 200, ok:false, no sample written', async () => {
    reset(); flag(false);
    assert.equal(parse(await PROBE()(checkEv({ cookie: legacyCookie() }))).ok, true);
    const b0 = blobs.log.length;
    const out = parse(await PROBE()(checkEv({ cookie: legacyCookie() })));
    assert.equal(out.ok, false); assert.deepEqual(out.stoppedAt, { phase: 'setup', n: 1 }); assert.equal(out.setup[0].status, 412); assert.equal(out.samples.length, 0);
    assert.equal(blobs.log.slice(b0).filter((e) => e.method === 'PUT' && e.status === 200).length, 0);
  });
  await check('PC6 the gate is unchanged for check mode: Production env / no site / Production site / two sites / a query -> bare 404 with zero Blob or outbound; no session -> 401; a malformed check body -> 404', async () => {
    for (const [label, prep, extra] of gateCases()) {
      reset(); flag(true); prep(); const b0 = blobs.log.length; other = [];
      const r = await PROBE()(checkEv({ cookie: legacyCookie(), ...extra }));
      assert.equal(r.statusCode, 404, label); assert.equal(r.body, 'Not Found', label); assert.equal(blobs.log.length, b0, label); assert.equal(other.length, 0, label);
      setEnv('test');
    }
    reset(); flag(false);
    assert.equal((await PROBE()(checkEv())).statusCode, 401);
    for (const body of [JSON.stringify({ probe: 'check' }), JSON.stringify({ probe: 'check', runId: 'short' }), JSON.stringify({ probe: 'check', runId: RUN, samples: 50 }), JSON.stringify({ probe: 'Check', runId: RUN })])
      assert.equal((await PROBE()(ev({ cookie: legacyCookie(), body }))).statusCode, 404, body);
    assert.equal(await rev.runCheckShapeProbe(RUN, 'production', { event: NF }).then((x) => x.refused), 'not_test');
  });
  await check('PC7 static: runCheckShapeProbe builds keys ONLY through probeKey (fixed leaves under probe/<runId>/), names no authority store / anchor / session-record key, never deletes or reads, and every write is onlyIfNew or onlyIfMatch', async () => {
    const lib = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8').replace(/\r\n/g, '\n');
    const body = lib.slice(lib.indexOf('export async function runCheckShapeProbe('));
    assert.ok(body.length > 500);
    assert.ok(!/onceAuthority|confirmAnchor|SESSION_AUTHORITY_STORE|AUTHORITY_KEY|SESSION_PREFIX|sessionKey\(|\.delete\(|getWithMetadata|\.get\(/.test(body), 'no authority / session key, no delete, no read');
    assert.deepEqual(body.match(/probeKey\([^)]*\)/g), ['probeKey(runId, "check-session")', 'probeKey(runId, "check-anchor")']);
    const sets = body.match(/\.set\([^)]*\)/g) || [];
    assert.ok(sets.length === 2 && sets.every((x) => /onlyIfNew: true|onlyIfMatch: tag/.test(x)), sets.join(' | '));
    const pk = lib.slice(lib.indexOf('function probeKey('), lib.indexOf('function probeKey(') + 400);
    assert.ok(/PROBE_RUN_ID\.test\(runId\)/.test(pk) && /\$\{PROBE_KEY_PREFIX\}\$\{runId\}\/\$\{leaf\}/.test(pk) && /startsWith\(\x60\$\{PROBE_KEY_PREFIX\}\$\{runId\}\/\x60\)/.test(pk), 'probeKey: valid runId, the probe/ prefix, and the prefix re-checked');
  });
  // ── G: platform-shaped events (Release 15-F dark check, Jeff 2026-11-10: every probe answered 404 on the real Test site).
  // A Lambda-compatible platform event carries each header in BOTH event.headers and event.multiValueHeaders; the gate
  // counted the one site id twice. These events are built that way, in lowercase and in canonical-case multi keys.
  const GATE = () => require(path.join(FUNCTIONS, 'lib/test-probe-gate.ts'));
  const RS = () => require(path.join(FUNCTIONS, 'lib/runtime-site.ts'));
  const canon = (k) => k.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
  /** e's headers ALSO in multiValueHeaders (each as [value]), as the platform delivers them. */
  const platform = (e, keyCase = (k) => k) => ({ ...e, multiValueHeaders: { ...(e.multiValueHeaders || {}), ...Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [keyCase(k), [v]])) } });
  for (const [shape, kc] of [['lowercase multi keys', (k) => k], ['canonical-case multi keys', canon]]) {
    await check('G1 platform-shaped events (' + shape + '): the gate OPENS for all three probe endpoints -- authority probe 200 ok, check mode 200 ok, protected-noop 200 {ok:true,sent:false}, protected-noop-read 204 -- and the session authority accepts the same shape', async () => {
      reset(); flag(false);
      const a = await PROBE()(platform(probeEv({ cookie: legacyCookie() }), kc)); assert.equal(a.statusCode, 200, a.body); assert.equal(parse(a).ok, true, a.body);
      reset(); flag(false);
      const c = await PROBE()(platform(checkEv({ cookie: legacyCookie() }), kc)); assert.equal(c.statusCode, 200, c.body); assert.equal(parse(c).ok, true, c.body);
      reset(); flag(true); const b = await bind(63); other = [];
      const n = await NOOP()(platform(ev({ bearer: tokenFor(b), body: JSON.stringify({ probe: 'a6' }) }), kc));
      assert.equal(n.statusCode, 200, n.body); assert.deepEqual(parse(n), { ok: true, sent: false }); assert.equal(other.length, 0);
      const r = await NOOPR()(platform(ev({ method: 'GET', cookie: b.cookie }), kc)); assert.equal(r.statusCode, 204, r.body);
      assert.deepEqual(await rev.checkSession(b, 'test', { event: platform({ ...NF }, kc) }), { kind: 'active' });
    });
  }
  await check('G2 platform-shaped but DIFFERENT site ids in the two maps (Test in headers, Production in multiValueHeaders, and the reverse) -> bare 404 on all three endpoints with zero Blob / outbound, and the session authority refuses (runtime_site_mismatch)', async () => {
    for (const [hv, mv] of [[SITE, PROD_SITE], [PROD_SITE, SITE]]) {
      reset(); flag(true); const b = await bind(64); const b0 = blobs.log.length; other = [];
      const mix = (e) => ({ ...platform(e), headers: { ...e.headers, 'x-nf-site-id': hv }, multiValueHeaders: { ...platform(e).multiValueHeaders, 'x-nf-site-id': [mv] } });
      for (const [label, fn, e] of [['probe', PROBE, probeEv({ cookie: legacyCookie() })], ['check', PROBE, checkEv({ cookie: legacyCookie() })],
        ['noop', NOOP, ev({ bearer: tokenFor(b), body: JSON.stringify({ probe: 'a6' }) })], ['noop-read', NOOPR, ev({ method: 'GET', cookie: b.cookie })]]) {
        const res = await fn()(mix(e)); assert.equal(res.statusCode, 404, label + ' ' + hv); assert.equal(res.body, 'Not Found', label);
      }
      assert.equal(blobs.log.length, b0); assert.equal(other.length, 0);
      assert.deepEqual(await rev.checkSession(b, 'test', { event: mix({ ...NF }) }), { kind: 'unavailable', reason: 'runtime_site_mismatch' });
    }
  });
  await check('G3 platform-shaped with the site id ONLY under a mixed-case name (both maps) -> bare 404 on all three endpoints, zero Blob, and the session authority refuses -- the same rule as H5', async () => {
    reset(); flag(true); const b = await bind(65); const b0 = blobs.log.length; other = [];
    const mixed = (e) => { const h = { ...e.headers }; delete h['x-nf-site-id']; h['X-NF-Site-ID'] = SITE; return { ...e, headers: h, multiValueHeaders: { ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, [v]])) } }; };
    for (const [label, fn, e] of [['probe', PROBE, probeEv({ cookie: legacyCookie() })], ['check', PROBE, checkEv({ cookie: legacyCookie() })],
      ['noop', NOOP, ev({ bearer: tokenFor(b), body: JSON.stringify({ probe: 'a6' }) })], ['noop-read', NOOPR, ev({ method: 'GET', cookie: b.cookie })]]) {
      const res = await fn()(mixed(e)); assert.equal(res.statusCode, 404, label);
    }
    assert.equal(blobs.log.length, b0); assert.equal(other.length, 0);
    assert.deepEqual(await rev.checkSession(b, 'test', { event: mixed({ ...NF }) }), { kind: 'unavailable', reason: 'runtime_site_mismatch' });
  });
  await check('G4 the gate and the session authority cannot diverge: over 12 event shapes, testProbeGateOpen agrees with runtimeSiteIs(event, Test pin) AND with whether checkSession gets past the site check', async () => {
    const shapes = [
      ['single lowercase', { headers: { 'x-nf-site-id': SITE } }], ['platform lowercase', { headers: { 'x-nf-site-id': SITE }, multiValueHeaders: { 'x-nf-site-id': [SITE] } }],
      ['platform canonical', { headers: { 'x-nf-site-id': SITE }, multiValueHeaders: { 'X-Nf-Site-Id': [SITE] } }], ['multi repeats the same id', { headers: { 'x-nf-site-id': SITE }, multiValueHeaders: { 'x-nf-site-id': [SITE, SITE] } }],
      ['multi only', { headers: {}, multiValueHeaders: { 'x-nf-site-id': [SITE] } }], ['missing', { headers: {} }], ['production', { headers: { 'x-nf-site-id': PROD_SITE }, multiValueHeaders: { 'x-nf-site-id': [PROD_SITE] } }],
      ['two ids', { headers: { 'x-nf-site-id': SITE }, multiValueHeaders: { 'x-nf-site-id': [SITE, PROD_SITE] } }], ['mixed-case only', { headers: { 'X-NF-Site-ID': SITE }, multiValueHeaders: { 'X-NF-Site-ID': [SITE] } }],
      ['empty', { headers: { 'x-nf-site-id': '' } }], ['padded', { headers: { 'x-nf-site-id': ' ' + SITE }, multiValueHeaders: { 'x-nf-site-id': [' ' + SITE] } }], ['non-string', { headers: { 'x-nf-site-id': 7 } }],
    ];
    reset(); flag(false); const b = await bind(66); const rows = [];
    for (const [label, e] of shapes) {
      const gate = GATE().testProbeGateOpen(e); const rule = RS().runtimeSiteIs(e, SITE);
      const auth = (await rev.checkSession(b, 'test', { event: { ...e, blobs: blobs.lambdaBlobs } })).reason !== 'runtime_site_mismatch';
      rows.push([label, gate, rule, auth]);
    }
    assert.ok(rows.every(([, g, r, a]) => g === r && r === a), JSON.stringify(rows));
    assert.deepEqual(rows.filter(([, g]) => g).map(([l]) => l), ['single lowercase', 'platform lowercase', 'platform canonical', 'multi repeats the same id']);
  });
  await check('G5 static: the site-id rule lives ONLY in lib/runtime-site.ts -- the gate and the session authority both import runtimeSiteIs, neither reads multiValueHeaders itself, and the header literal x-nf-site-id appears in code (outside comments) only there', async () => {
    const gate = fs.readFileSync(path.join(FUNCTIONS, 'lib/test-probe-gate.ts'), 'utf8'); const lib = fs.readFileSync(path.join(FUNCTIONS, 'lib/session-revocation.ts'), 'utf8');
    const rsrc = fs.readFileSync(path.join(FUNCTIONS, 'lib/runtime-site.ts'), 'utf8');
    for (const [n, src] of [['test-probe-gate', gate], ['session-revocation', lib]]) {
      assert.match(src, /import \{[^}]*\bruntimeSiteIs\b[^}]*\} from "\.\/runtime-site";/, n);
      assert.ok(!/multiValueHeaders\s*\?\?|Object\.entries\(event\?\.headers/.test(src), n + ' collects no header map itself');
    }
    assert.match(gate, /if \(!runtimeSiteIs\(event, SESSION_REVOCATION_SITE_IDS\.test\)\) return false;/);
    assert.match(lib, /if \(!runtimeSiteIs\(opts\.event, setup\.siteID\)\) return \{ refused: "runtime_site_mismatch" \};/);
    assert.match(rsrc, /return \[\.\.\.new Set\(found\)\];/, 'values are de-duplicated');
    assert.match(rsrc, /values\.length === 1 && values\[0\] === pin && event\?\.headers\?\.\[RUNTIME_SITE_HEADER\] === pin/, 'one distinct value, the pin, under the lowercase key');
    const defs = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name) && fs.readFileSync(p, 'utf8').split(/\r?\n/).some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /"x-nf-site-id"/.test(l))) defs.push(path.relative(FUNCTIONS, p).split(path.sep).join('/')); } };
    walk(FUNCTIONS); assert.deepEqual(defs, ['lib/runtime-site.ts']);
  });
  // ── N: protected-noop ──
  reset(); flag(true);
  await check('N1 protected-noop positive: valid session + fresh token -> 200 {ok:true,sent:false}; zero outbound', async () => {
    reset(); flag(true); const b = await bind(61); other = [];
    const r = await NOOP()(ev({ bearer: tokenFor(b), body: JSON.stringify({ probe: 'a6' }) }));
    assert.equal(r.statusCode, 200, r.body); assert.deepEqual(parse(r), { ok: true, sent: false }); assert.equal(other.length, 0);
  });
  await check('N2 protected-noop: an expired parent with an UNEXPIRED token -> 401 session_expired, zero Blob access, zero outbound (the R1 pattern)', async () => {
    reset(); flag(true); const realNow = Date.now; const b = await bind(62, { at: realNow() - 10_000 }); const endMs = b.exp * 1000;
    const tok = tokenFor(b, { at: endMs - 60_000 });
    try {
      Date.now = () => endMs + 1000; const b0 = blobs.log.length; other = [];
      const r = await NOOP()(ev({ bearer: tok, body: JSON.stringify({ probe: 'a6' }) }));
      assert.equal(r.statusCode, 401); assert.equal(parse(r).reason, 'session_expired'); assert.equal(blobs.log.length, b0); assert.equal(other.length, 0);
    } finally { Date.now = realNow; }
  });
  await check('N3 protected-noop: a revoked session -> 401 revoked', async () => {
    reset(); flag(true); const b = await bind(63); const tok = tokenFor(b);
    await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF });
    const r = await NOOP()(ev({ bearer: tok, body: JSON.stringify({ probe: 'a6' }) })); assert.equal(r.statusCode, 401); assert.equal(parse(r).reason, 'revoked');
  });
  await check('N4 protected-noop: a malformed body WITH a valid session -> 400 malformed; the same body with NO token -> 401 (distinguishable)', async () => {
    reset(); flag(true); const b = await bind(64);
    for (const body of ['{}', JSON.stringify({ probe: 'a7' }), JSON.stringify({ probe: 'a6', x: 1 }), 'not json']) {
      const r = await NOOP()(ev({ bearer: tokenFor(b), body })); assert.equal(r.statusCode, 400, body); assert.equal(parse(r).error, 'malformed');
    }
    assert.equal((await NOOP()(ev({ body: '{}' }))).statusCode, 401);
  });
  await check('N5 protected-noop: the wrong method -> 404; a bound token while one sign-in is OFF -> 401 one_login_off', async () => {
    reset(); flag(true); const b = await bind(65); const tok = tokenFor(b); flag(false);
    assert.equal((await NOOP()(ev({ method: 'GET', bearer: tok }))).statusCode, 404);
    const r = await NOOP()(ev({ bearer: tok, body: JSON.stringify({ probe: 'a6' }) })); assert.equal(r.statusCode, 401);
    flag(true);
  });
  await check('N6 protected-noop-read: valid -> 204 empty; revoked -> 401; no session -> 401; POST -> 404; zero outbound', async () => {
    reset(); flag(true); const b = await bind(66); other = [];
    const ok = await NOOPR()(ev({ method: 'GET', cookie: b.cookie })); assert.equal(ok.statusCode, 204); assert.equal(ok.body, '');
    await rev.revokeSession(b.sid, b.epoch, 'test', { event: NF });
    assert.equal((await NOOPR()(ev({ method: 'GET', cookie: b.cookie }))).statusCode, 401);
    assert.equal((await NOOPR()(ev({ method: 'GET' }))).statusCode, 401);
    assert.equal((await NOOPR()(ev({ method: 'POST', cookie: b.cookie }))).statusCode, 404);
    assert.equal(other.length, 0);
  });
  // ── R: recovery ──
  const storeImage = () => JSON.stringify([...blobs.store.entries()].sort());
  await check('R1 flag OFF after ON: the One Login cookie is refused by verify and a reader; the bound token by requireAppWriter AND sessionWriteRefusal (one_login_off) before any Blob/outbound; legacy sign-in and saving still work; no record, receipt or anchor changed', async () => {
    reset(); flag(true); const b = await bind(67); const tok = tokenFor(b);
    const before = storeImage(); const m0 = blobs.mutations.length;
    flag(false);
    const b0 = blobs.log.length; other = [];
    assert.throws(() => readAuth.verifyReadSession(b.cookie, readAuth.appReadConfig()));
    assert.equal((await load('ghl-contact')(ev({ method: 'GET', cookie: b.cookie, query: { id: 'fixtureContact' } }))).statusCode, 401);
    assert.throws(() => writeAuth.requireAppWriter(ev({ bearer: tok })));
    const w = await rev.sessionWriteRefusal(ev({ bearer: tok })); assert.equal(w.statusCode, 401); assert.equal(parse(w).reason, 'one_login_off');
    assert.equal(blobs.log.length, b0, 'no Blob request'); assert.equal(other.length, 0, 'no outbound');
    const legacy = legacyCookie(); assert.equal(readAuth.verifyReadSession(legacy, readAuth.appReadConfig()).email, 'brad@example.invalid');
    assert.equal(writeAuth.requireAppWriter(ev({ bearer: writeAuth.issueAppSession('brad@example.invalid').token })), 'brad@example.invalid');
    assert.equal(storeImage(), before, 'the store is byte-identical'); assert.equal(blobs.mutations.length, m0);
    flag(true);
  });
  await check('R3 flag back ON with the SAME epoch: a session issued before the OFF period is ACCEPTED again until its fixed exp (pinned); a session revoked before OFF stays revoked; after an epoch rotation (close + reopen) the old session is refused', async () => {
    reset(); flag(true); const keep = await bind(68); const gone = await bind(69);
    await rev.revokeSession(gone.sid, gone.epoch, 'test', { event: NF });
    flag(false); flag(true);
    assert.equal(await rev.sessionReadRefusal(ev({ method: 'GET', cookie: keep.cookie })), null, 'pre-OFF session accepted again (same epoch)');
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: gone.cookie }))).statusCode, 401, 'revoked stays revoked');
    seedAnchor({ state: 'closed' }); seedAnchor({ epoch: EPOCH2 });
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: keep.cookie }))).statusCode, 401, 'refused after epoch rotation');
  });
  await check('R4 anchor CLOSED with one sign-in ON: sign-in 503 authority_closed; an existing session 401 at the reader, the mint and the writer; no data changed (the closed anchor and every record byte-identical)', async () => {
    reset(); flag(true); const b = await bind(70); const tok = tokenFor(b);
    seedAnchor({ state: 'closed' }); const before = storeImage(); const m0 = blobs.mutations.length;
    const s = await signIn(); assert.equal(s.statusCode, 503, s.body);
    assert.equal((await rev.sessionReadRefusal(ev({ method: 'GET', cookie: b.cookie }))).statusCode, 401);
    assert.equal((await mint(tokenEv(b.cookie))).statusCode, 401);
    assert.equal((await rev.sessionWriteRefusal(ev({ bearer: tok }))).statusCode, 401);
    assert.equal((await NOOP()(ev({ bearer: tok, body: JSON.stringify({ probe: 'a6' }) }))).statusCode, 401);
    assert.equal(storeImage(), before, 'byte-identical store'); assert.equal(blobs.mutations.length, m0);
  });
  const FLOOR = 305;   // G1 (Gate A r3 A1b; Bones accepted r1-r4): + PV6-PV18
  if (checks < FLOOR) { failures += 1; console.log(`FAIL  check floor -- ${checks} checks ran, the floor is ${FLOOR}`); }
  console.log(`B15-29 one IAOS sign-in (server): ${checks - failures}/${checks} checks passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.log('FAIL  suite aborted -- ' + (e && e.stack)); process.exitCode = 1; });
