/**
 * B15-29 (INV-137) one IAOS sign-in -- BROWSER saving module (src/lib/app-write-session.ts) with the REAL server
 * handlers, offline, in Node, on a simulated clock. Design r5 (conditional-write authority) + r6 (fixed 30-day
 * session, persistent cookie, no renewal, authorization seam).
 *
 * The module's own fetch calls are answered by the REAL server code in this process: app-read-session (Google sign-in
 * with a tokeninfo fixture, status + handle), app-write-token, app-signout, a reader (readAuthRefusal +
 * sessionReadRefusal, as every GHL reader runs them) and, for every save, the REAL per-save checks a writer runs
 * first (requireAppWriter + sessionWriteRefusal, Variant S). The store is the in-memory fake Lambda Blobs API.
 * A "device" is a browser cookie jar that honours Set-Cookie Max-Age: closing the browser drops everything in memory
 * (saving tokens) and keeps only cookies that were persistent and are not expired. Time is a simulated clock
 * (Date.now) shared by browser and server code, so 30 days run in seconds. There is no BroadcastChannel,
 * localStorage or sessionStorage in this process.
 *
 *   C0  no browser storage / channel
 *   C1  flag off: exactly the previous behaviour
 *   C2  first save gets its token automatically; concurrent saves share one token request
 *   C3  45-minute call: every save sent exactly once; renewals silent and bounded
 *   C4  one Google sign-in -> reads + writes across a simulated 29-day span (incl. a 45-minute call), the browser
 *       closed every night, zero prompts, tokens renewed silently, never a second sign-in      [demonstration a + c]
 *   C5  at 30 days + 1 s every read, write and mint is refused -> sign in again; no request on the way extended exp [b]
 *   C6  closing the browser: the persisted cookie alone keeps the operator signed in                                 [c]
 *   C7  two devices are independent: Sign out on device 1 leaves device 2 working                                   [d]
 *   C8  cross-tab: tab A's confirmed Sign out refuses tab B's next read, write and mint; L2                          [e]
 *   C9  expired / revoked / epoch-rotated / wrong-store / allowlist-removed credentials cannot authorize writes     [f]
 *   C10 store unavailable: paused before send / returned once, never re-sent, never a sign-in prompt
 *   C11 Sign out on THIS page pauses at the click; malformed token answers refused before send
 *   C12 the session's last minutes: the token is capped at the session end and still used; never re-sent
 *   C13 r4 (Bones R3-2) session replacement: A->A and A->B deliberate re-login discard the cached AND pending saving
 *       token synchronously, no save until the new session is confirmed, then a fresh mint under the NEW session;
 *       a pending old mint resolving after the replacement is discarded; logout after replacement revokes the new
 *       session; the status answer's non-secret operator / session tags tell A->A from A->B
 *   R1-R5 login experience reminders: the server's absolute expiry (never moved by any request), the 5-day / 1-day
 *       checkpoints, the capped next-checkpoint timer, Remind Me Later keyed by expiry + checkpoint (memory fallback),
 *       and a reminder module that sends nothing
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
const SITE = '07ca1f1a-60fd-4229-a076-528970957912';   // the PINNED Test site
const EPOCH = 'fixture-epoch-0001';
const DAY = 24 * 3600_000;
const ENV = {
  IAOS_ENV: 'test',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid,second@example.invalid',
  IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid,second@example.invalid',
  IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
  GHL_PRIVATE_API_KEY: 'offline-fixture',
};
Object.assign(process.env, ENV);
delete process.env.IAOS_VOICE_SESSION_SECRET;

// ---- simulated clock shared by browser and server code ----
const realNow = Date.now;
let T = realNow.call(Date);
Date.now = () => T;
const advance = (ms) => { T += ms; };
// deterministic PRNG (save minutes)
let seed = 0x2915;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ---- no browser storage or channel exists here ----
if (typeof globalThis.BroadcastChannel !== 'undefined') delete globalThis.BroadcastChannel;
const window = new EventTarget();
global.window = window;
const events = [];
for (const name of ['iaos-read-session-lost', 'iaos-session-unavailable']) window.addEventListener(name, () => events.push(name));

const cfg = require(path.join(APP, 'shared/ghl-config.ts'));
const readAuth = require(path.join(FUNCTIONS, 'lib/app-read-auth.ts'));
const writeAuth = require(path.join(FUNCTIONS, 'lib/app-write-auth.ts'));
const rev = require(path.join(FUNCTIONS, 'lib/session-revocation.ts'));
cfg.getConfig('test').supplementalReadBudget = { enabled: cfg.SUPPLEMENTAL_READ_BUDGET_DISABLED, budgetId: 'offline-disabled', ceiling: 0 };
const blobs = createFakeBlobs({ siteID: SITE, clock: () => T });
// Bones HOLD on 3311102: the anchor lives in its own never-restored store (session-revocation.ts SESSION_AUTHORITY_STORE).
const ANCHOR_STORE = 'iaos-session-authority';
const ANCHOR_KEY = 'authority';
const anchorText = (epoch = EPOCH) => JSON.stringify({ env: 'test', epoch, kind: 'iaos-session-revocation-authority', siteID: SITE, state: 'open', v: 1 });
const seedAnchor = (epoch) => blobs.put(ANCHOR_STORE, ANCHOR_KEY, anchorText(epoch));
seedAnchor();
const basePayload = () => ({ ...cfg.projectRuntimeConfig(cfg.getConfig('test'), 'test'), repairApproval: { active: false } });
const setFlag = (on) => {
  cfg.getConfig('test').oneLogin = on ? cfg.ONE_LOGIN_ENABLED : cfg.ONE_LOGIN_DISABLED;
  cfg.setRuntimeConfig(on ? { ...basePayload(), oneLogin: { active: true } } : basePayload());
};
const H = {
  session: require(path.join(FUNCTIONS, 'app-read-session.ts')).handler,
  token: require(path.join(FUNCTIONS, 'app-write-token.ts')).handler,
  signout: require(path.join(FUNCTIONS, 'app-signout.ts')).handler,
};

// ---- devices: a browser cookie jar honouring Max-Age ----
const newDevice = (name) => ({ name, cookie: null, cookieExp: null, persistent: false });
let D = newDevice('laptop');
function storeCookie(dev, setCookie) {
  if (!setCookie) return;
  const m = /^__Host-iaos_read=([^;]*)(.*)$/.exec(setCookie);
  if (!m) return;
  const age = /;\s*Max-Age=(-?\d+)/i.exec(m[2]);
  dev.cookie = m[1]; dev.persistent = !!age; dev.cookieExp = age ? T + Number(age[1]) * 1000 : null;
  if (age && Number(age[1]) <= 0) dev.cookie = null;
}
const cookieOf = (dev) => (dev.cookie && (dev.cookieExp === null || T < dev.cookieExp) ? dev.cookie : null);
/** Closing the browser: memory (the saving token) is gone; only a persistent, unexpired cookie survives. */
function closeBrowser(dev, S) { if (!dev.persistent) dev.cookie = null; S.clearAppWriteToken(); }
const sidOf = (dev) => JSON.parse(Buffer.from(dev.cookie.split('.')[1], 'base64url')).sid;
const sessionEnd = (dev) => JSON.parse(Buffer.from(dev.cookie.split('.')[1], 'base64url')).exp * 1000;

// ---- request log + routing ----
let log = [];
let googleSignIns = 0;
let tokenMode = 'real';      // 'real' | 'network' | 'bad-lifetime' | 'no-token' | 'hold'
let held = null;
let writeStore = [];
const lambda = (headers) => ({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-nf-site-id': SITE, ...headers });
let googleEmail = 'brad@example.invalid';
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (blobs.handles(u)) return blobs.fetch(url, init);
  if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    return new Response(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'offline-read-client', email: googleEmail, email_verified: 'true', exp: String(Math.floor(T / 1000) + 600) }), { status: 200 });
  }
  const headers = {};
  new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
  const dev = init.device || D;
  const event = { httpMethod: String(init.method || 'GET').toUpperCase(), headers: lambda(headers), body: init.body || '', blobs: blobs.lambdaBlobs };
  const c = cookieOf(dev); if (c) event.headers.cookie = `${readAuth.READ_COOKIE}=${c}`;
  const fn = u.replace('/.netlify/functions/', '');
  const entry = { kind: fn, dev: dev.name, at: T }; log.push(entry);
  let res;
  if (fn === 'app-read-session') { res = await H.session(event); storeCookie(dev, res.headers['Set-Cookie']); }
  else if (fn === 'app-signout') res = await H.signout(event);
  else if (fn === 'app-write-token') {
    if (tokenMode === 'network') throw new TypeError('Failed to fetch');
    if (tokenMode === 'bad-lifetime') return new Response(JSON.stringify({ token: 'x.y.z', expiresAt: 'x', expiresInSeconds: 3600 }), { status: 200 });
    if (tokenMode === 'no-token') return new Response(JSON.stringify({ expiresInSeconds: 900 }), { status: 200 });
    if (tokenMode === 'hold') await new Promise((r) => { held = r; });
    res = await H.token(event); entry.setCookie = res.headers['Set-Cookie'];
  } else if (fn === 'ghl-write') {
    const body = JSON.parse(init.body); entry.id = body.id; entry.auth = headers.authorization;
    try { writeAuth.requireAppWriter(event); } catch { entry.status = 401; return new Response(JSON.stringify({ error: 'Application write sign-in required' }), { status: 401 }); }
    res = await rev.sessionWriteRefusal(event);
    if (res) entry.reason = JSON.parse(res.body).reason;
    else { writeStore.push(body.id); res = { statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) }; }
  } else if (fn === 'ghl-contact') {
    res = readAuth.readAuthRefusal(event) || await rev.sessionReadRefusal(event) || { statusCode: 200, headers: {}, body: JSON.stringify({ contact: { id: 'fixture' } }) };
    if (res.statusCode !== 200) entry.reason = JSON.parse(res.body).reason || JSON.parse(res.body).by;
  } else throw new Error('unexpected request ' + u);
  entry.status = res.statusCode;
  return new Response(res.body, { status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers || {}).filter(([k]) => k !== 'Set-Cookie')) });
};

const loadSavingModule = () => {
  const p = path.join(APP, 'src/lib/app-write-session.ts');
  delete require.cache[p];
  return require(p);
};
const S = loadSavingModule();
const R = require(path.join(APP, 'src/lib/read-session.ts'));
let saveN = 0;
/** One operator save: one click = one call. Returns 'sent:<status>' or 'refused:<message>'. Never retries. */
async function save(mod = S, device = D) {
  const id = `save-${++saveN}`;
  // The module's own token request carries no device: the device in use is the one this save runs on.
  const previous = D; D = device;
  try { const r = await mod.appWriteFetch('/.netlify/functions/ghl-write', { method: 'POST', device, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { id, out: `sent:${r.status}` }; }
  catch (e) { return { id, out: e instanceof mod.AppWriteSignInRequired ? `refused:${e.message}` : `error:${e.message}` }; }
  finally { D = previous; }
}
const read = async (device = D) => (await R.readFetch('/.netlify/functions/ghl-contact', { device })).status;
async function googleSignIn(device = D) {
  googleSignIns += 1;
  const r = await fetch('/.netlify/functions/app-read-session', { method: 'POST', device, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ googleIdToken: 'fixture-google-token' }) });
  assert.equal(r.status, 200, 'fixture sign-in');
}
async function statusOf(device = D) { const r = await fetch('/.netlify/functions/app-read-session', { device }); return { status: r.status, body: await r.json() }; }
async function signOutFrom(device = D) {
  const st = await statusOf(device);
  const r = await fetch('/.netlify/functions/app-signout', { method: 'POST', device, headers: { 'Content-Type': 'application/json', 'X-IAOS-Session': 'sign-out' }, body: JSON.stringify({ handle: st.body.handle }) });
  return { status: r.status, body: await r.json() };
}
const writes = () => log.filter((e) => e.kind === 'ghl-write');
const tokens = () => log.filter((e) => e.kind === 'app-write-token');
const noDuplicateWrites = () => { const ids = writes().map((w) => w.id); assert.equal(new Set(ids).size, ids.length, 'a save was sent twice: ' + ids.join(',')); };

let checks = 0, failures = 0;
async function check(name, fn) {
  checks += 1;
  try { await fn(); console.log('PASS  ' + name); }
  catch (err) { failures += 1; console.log('FAIL  ' + name + ' -- ' + (err && err.message)); }
}
const resetAll = async ({ signIn = true } = {}) => {
  log = []; events.length = 0; blobs.reset(); seedAnchor(); tokenMode = 'real'; writeStore = []; S.clearAppWriteToken(); S.resumeAppWriteAccess(); S.confirmAppWriteSession();
  googleEmail = 'brad@example.invalid';
  process.env.IAOS_APP_WRITE_BRAD_EMAILS = ENV.IAOS_APP_WRITE_BRAD_EMAILS;
  D = newDevice('laptop'); googleSignIns = 0;
  if (signIn) { await googleSignIn(); log = []; }
};

(async () => {
  await check('C0 no BroadcastChannel, localStorage or sessionStorage exists in this process, and the saving module / gate use none', async () => {
    for (const g of ['BroadcastChannel', 'localStorage', 'sessionStorage', 'indexedDB']) assert.equal(typeof globalThis[g], 'undefined', g);
    const src = fs.readFileSync(path.join(APP, 'src/lib/app-write-session.ts'), 'utf8') + fs.readFileSync(path.join(APP, 'src/components/OneLoginAccess.tsx'), 'utf8');
    assert.ok(!/BroadcastChannel|localStorage|sessionStorage|indexedDB/.test(src));
  });

  // ---------------------------------------------------------------- C1 off
  setFlag(false); await resetAll({ signIn: false });
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
  setFlag(true); await resetAll();
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
  await resetAll();
  await check('C3 a 45-minute seller call, a save every 30 s: all 90 sent exactly once with a live token; 4 silent renewals (t=0, 14, 28, 42 min); one identity notification; never a cookie change', async () => {
    let notifications = 0; const off = S.subscribeAppWriteSession(() => { notifications += 1; });
    const start = T; const outs = []; const cookie = D.cookie;
    for (let i = 0; i < 90; i += 1) { outs.push((await save()).out); advance(30_000); }
    off();
    assert.ok(outs.every((o) => o === 'sent:200'), JSON.stringify(outs.filter((o) => o !== 'sent:200')));
    assert.equal(writes().length, 90); noDuplicateWrites();
    assert.deepEqual(tokens().map((t) => (t.at - start) / 60_000), [0, 14, 28, 42]);
    assert.equal(notifications, 1, 'renewal under the same operator is silent');
    assert.equal(D.cookie, cookie, 'renewing the saving token never touches the session');
    assert.ok(tokens().every((t) => t.setCookie === undefined));
  });

  // ---------------------------------------------------------------- C4 29 days
  await resetAll();
  await check('C4 [a][c] ONE Google sign-in -> reads and saves across a simulated 29-day span (8-hour days, saves and reads at random minutes, a 45-minute call on day 3, the browser closed every night): zero refusals, zero sign-in prompts, tokens renewed silently, still exactly one sign-in', async () => {
    const signInAt = T; const cookieAtSignIn = D.cookie; const outs = []; const reads = [];
    for (let day = 0; day < 29; day += 1) {
      T = signInAt + day * DAY + 3600_000;                           // the working day starts
      const minutes = Array.from({ length: 12 }, () => Math.floor(rand() * 480)).sort((a, b) => a - b);
      let last = 0;
      for (const m of minutes) { advance((m - last) * 60_000); last = m; outs.push((await save()).out); reads.push(await read()); }
      if (day === 3) { for (let i = 0; i < 45; i += 1) { outs.push((await save()).out); advance(60_000); } }
      closeBrowser(D, S);                                            // night: the browser is closed
    }
    assert.ok(T - signInAt > 28 * DAY && T - signInAt < 29 * DAY, 'spanned 28-29 days');
    assert.ok(outs.length >= 29 * 12 + 45);
    assert.ok(outs.every((o) => o === 'sent:200'), JSON.stringify(outs.filter((o) => o !== 'sent:200').slice(0, 3)));
    assert.ok(reads.every((s) => s === 200), JSON.stringify(reads.filter((s) => s !== 200).slice(0, 3)));
    noDuplicateWrites();
    assert.equal(googleSignIns, 1, 'one Google sign-in for the whole span');
    assert.deepEqual(events, [], 'no sign-in prompt or outage signal ever fired');
    assert.ok(tokens().length >= 29, `tokens renewed silently: ${tokens().length}`);
    assert.ok(tokens().every((t) => t.status === 200));
    assert.equal(D.cookie, cookieAtSignIn, 'the session cookie was never re-issued (no extension)');
  });

  // ---------------------------------------------------------------- C5 day 30
  await check('C5 [b] the session ends at EXACTLY 30 days: 20 mints and saves in the last 10 minutes never extend it; at 30 days + 1 s every read, save and mint is refused and the read gate is signalled (sign in again)', async () => {
    const endMs = sessionEnd(D);
    T = endMs - 10 * 60_000;
    for (let i = 0; i < 20; i += 1) { S.clearAppWriteToken(); assert.equal((await save()).out, 'sent:200'); advance(25_000); }
    assert.equal(sessionEnd(D), endMs, 'exp unchanged after 20 mints (cookie never re-issued)');
    T = endMs + 1000; events.length = 0;
    D.cookieExp = null;        // even if a browser kept sending the cookie, the SERVER refuses it
    const n = writes().length;
    assert.equal(await read(), 401);
    const r = await save();
    assert.ok(r.out === 'sent:401' || r.out.startsWith('refused:Saving paused: your IAOS sign-in has ended.'), r.out);
    S.clearAppWriteToken();
    const r2 = await save();
    assert.ok(r2.out.startsWith('refused:Saving paused: your IAOS sign-in has ended.'), r2.out);
    assert.ok(writes().length - n <= 1 && writes().slice(n).every((w) => w.status === 401));
    assert.equal(tokens()[tokens().length - 1].status, 401);
    assert.ok(events.includes('iaos-read-session-lost'));
    assert.equal((await statusOf()).body.state, 'signed_out');
  });
  await check('C5b after signing in again (a NEW 30-day session) the operator\'s next save is sent once; nothing earlier was re-sent', async () => {
    await googleSignIn(); S.clearAppWriteToken();
    const r = await save(); assert.equal(r.out, 'sent:200'); noDuplicateWrites();
    assert.equal(googleSignIns, 2);
    assert.equal(sessionEnd(D) - T, 30 * DAY);
  });

  // ---------------------------------------------------------------- C6 browser close
  await resetAll();
  await check('C6 [c] closing the browser does NOT sign out: the cookie is persistent (Max-Age = time left to the fixed 30-day expiry); a fresh browser with only that cookie reads and saves with no sign-in', async () => {
    assert.ok(D.persistent && D.cookieExp - T === 30 * DAY, 'Max-Age = 30 days at sign-in');
    assert.equal((await save()).out, 'sent:200');
    closeBrowser(D, S); advance(10 * 3600_000);
    const S2 = loadSavingModule();       // a new page load: fresh module state
    assert.equal((await statusOf()).body.state, 'signed_in');
    assert.equal(await read(), 200);
    assert.equal((await save(S2)).out, 'sent:200');
    assert.equal(googleSignIns, 1);
  });

  // ---------------------------------------------------------------- C7 two devices
  await resetAll();
  await check('C7 [d] two devices: each Google sign-in is its own session; Sign out on device 1 refuses device 1 and leaves device 2 reading and saving', async () => {
    const laptop = D; const phone = newDevice('phone');
    await googleSignIn(phone);
    assert.notEqual(sidOf(laptop), sidOf(phone));
    const Sphone = loadSavingModule();
    assert.equal((await save(S, laptop)).out, 'sent:200'); assert.equal((await save(Sphone, phone)).out, 'sent:200');
    const so = await signOutFrom(laptop); assert.equal(so.status, 200); assert.equal(so.body.state, 'revoked');
    assert.equal(await read(laptop), 401);
    const l = await save(S, laptop); assert.equal(l.out, 'sent:401');
    assert.equal(await read(phone), 200);
    assert.equal((await save(Sphone, phone)).out, 'sent:200');
    Sphone.clearAppWriteToken(); assert.equal((await save(Sphone, phone)).out, 'sent:200', 'device 2 mints again');
    assert.equal((await statusOf(phone)).body.state, 'signed_in');
  });

  // ---------------------------------------------------------------- C8 cross-tab
  await resetAll();
  await check('C8 [e] cross-tab within ONE session: tab B holds a token; tab A\'s confirmed Sign out -> tab B\'s next save is refused at the writer (401 revoked, not re-sent), its next mint and read are refused; no channel exists', async () => {
    const tabB = loadSavingModule();
    assert.equal((await save(tabB)).out, 'sent:200');
    const so = await signOutFrom(D); assert.equal(so.status, 200);
    const r = await save(tabB);
    assert.equal(r.out, 'sent:401'); assert.equal(writes()[writes().length - 1].reason, 'revoked');
    const n = writes().length;
    const r2 = await save(tabB);
    assert.ok(r2.out.startsWith('refused:Saving paused: your IAOS sign-in has ended.'), r2.out);
    assert.equal(writes().length, n); noDuplicateWrites();
    assert.equal(tokens()[tokens().length - 1].status, 401);
    assert.equal(await read(), 401);
    assert.equal((await statusOf()).body.state, 'revoked');
  });
  await check('C8b L2: a save whose writer check passed BEFORE the Sign out completes; the next one with the same token is refused', async () => {
    await resetAll(); assert.equal((await save()).out, 'sent:200');
    const event = { headers: lambda({ authorization: writes()[0].auth }), blobs: blobs.lambdaBlobs };
    const admitted = await rev.sessionWriteRefusal(event);
    assert.equal((await signOutFrom(D)).status, 200);
    assert.equal(admitted, null);
    assert.equal((await rev.sessionWriteRefusal(event)).statusCode, 401);
  });

  // ---------------------------------------------------------------- C9 credentials that must not authorize
  for (const [label, prep, want] of [
    ['an expired session (30 days + 1 s)', async () => { T += 30 * DAY + 1000; D.cookieExp = null; }, 'sign-in-ended'],
    ['a revoked session', async () => { await signOutFrom(D); }, 'sign-in-ended'],
    ['an epoch-rotated anchor (operator restore rotation)', async () => { seedAnchor('fixture-epoch-0002-rotated'); }, 'sign-in-ended'],
    ['a wrong / empty store', async () => { blobs.reset(); seedAnchor(); }, 'sign-in-ended'],
    ['a restored ACTIVE record with a rotated anchor', async () => { const k = rev.sessionKey('test', sidOf(D)); const snap = blobs.get('iaos-write-receipts', k); await signOutFrom(D); blobs.reset(); seedAnchor('fixture-epoch-0003-restored'); blobs.store.set(`${SITE}|site:iaos-write-receipts|${k}`, snap); }, 'sign-in-ended'],
    ['an operator removed from the saving allowlist', async () => { process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'someone-else@example.invalid'; }, 'refused'],
  ]) {
    await check(`C9 [f] ${label}: the held token AND a fresh mint cannot authorize a save; nothing is applied`, async () => {
      await resetAll(); assert.equal((await save()).out, 'sent:200'); const applied = writeStore.length;
      await prep();
      const heldSave = await save();
      assert.ok(heldSave.out === 'sent:401' || heldSave.out === 'sent:403' || heldSave.out.startsWith('refused:'), heldSave.out);
      S.clearAppWriteToken();
      const fresh = await save();
      assert.ok(fresh.out.startsWith('refused:') || fresh.out === 'sent:401' || fresh.out === 'sent:403', fresh.out);
      if (want === 'sign-in-ended') assert.ok(fresh.out.startsWith('refused:Saving paused: your IAOS sign-in has ended.'), fresh.out);
      assert.equal(writeStore.length, applied, 'nothing applied'); noDuplicateWrites();
      process.env.IAOS_APP_WRITE_BRAD_EMAILS = ENV.IAOS_APP_WRITE_BRAD_EMAILS;
    });
  }

  // ---------------------------------------------------------------- C10 unavailable
  await resetAll();
  await check('C10 store unavailable at token issue -> 503 -> "Saving paused: IAOS can\'t confirm..." before sending; the unavailable event fires; NOT the sign-in event', async () => {
    blobs.rule({ method: 'PUT', status: 500 });
    const r = await save();
    assert.equal(r.out, `refused:${S.SAVE_UNAVAILABLE_MESSAGE}`); assert.equal(writes().length, 0);
    assert.deepEqual(events, ['iaos-session-unavailable']);
  });
  await check('C10b store unavailable at the WRITE check -> the 503 is returned once and never re-sent; the store recovers -> the next save is sent', async () => {
    events.length = 0; assert.equal((await save()).out, 'sent:200');
    blobs.rule({ method: 'PUT', status: 503 });
    const r = await save(); assert.equal(r.out, 'sent:503');
    assert.ok(events.includes('iaos-session-unavailable') && !events.includes('iaos-read-session-lost'));
    const r2 = await save(); assert.equal(r2.out, 'sent:200'); noDuplicateWrites();
    assert.equal(writeStore.length, 2);
  });

  // ---------------------------------------------------------------- C11 sign out on this page / malformed
  await resetAll();
  await check('C11 Sign out on THIS page pauses saving at the click with ZERO requests', async () => {
    assert.equal((await save()).out, 'sent:200');
    S.pauseAppWriteForSignOut(); log = [];
    const r = await save();
    assert.equal(r.out, `refused:${S.SAVE_SIGNED_OUT_MESSAGE}`); assert.equal(log.length, 0);
  });
  await check('C11b a token request IN FLIGHT when Sign out is clicked: its token is never used and the save is never sent', async () => {
    S.resumeAppWriteAccess(); S.confirmAppWriteSession(); S.clearAppWriteToken(); log = []; tokenMode = 'hold';
    const p = save();
    await new Promise((r) => setImmediate(r));
    S.pauseAppWriteForSignOut(); tokenMode = 'real'; held();
    const r = await p;
    assert.ok(r.out.startsWith('refused:Saving paused:'), r.out); assert.equal(writes().length, 0);
  });
  await check('C11c only an explicit sign-in resumes (r4: once the read gate confirms the session); the next save is sent once', async () => {
    S.resumeAppWriteAccess(); log = [];
    assert.equal((await save()).out, `refused:${S.SAVE_CONFIRMING_MESSAGE}`, 'not before the new session is confirmed'); assert.equal(log.length, 0);
    S.confirmAppWriteSession(); const r = await save(); assert.equal(r.out, 'sent:200'); noDuplicateWrites();
  });
  for (const [label, mode] of [['a network failure', 'network'], ['a lifetime above 900 s', 'bad-lifetime'], ['no token in the answer', 'no-token']]) {
    await check(`C11d ${label} at token issue -> refused before sending, exactly one token request for this save, no retry`, async () => {
      await resetAll(); tokenMode = mode;
      const r = await save();
      assert.equal(r.out, `refused:${S.SAVE_UNAVAILABLE_MESSAGE}`); assert.equal(tokens().length, 1); assert.equal(writes().length, 0);
    });
  }

  // ---------------------------------------------------------------- C12 last minutes
  await resetAll();
  await check('C12 the session\'s last 40 seconds: the minted token is capped at the session end (pexp = exp) and still used for that save; after the end it is refused at the writer (session_expired) and the save is not re-sent', async () => {
    const endMs = sessionEnd(D);
    T = endMs - 40_000;
    assert.equal((await save()).out, 'sent:200');
    const lastToken = writes()[writes().length - 1].auth.slice(7);
    assert.equal(JSON.parse(Buffer.from(lastToken.split('.')[1], 'base64url')).pexp * 1000, endMs);
    T = endMs + 5_000; D.cookieExp = null;
    const n = writes().length; const r = await save();
    assert.ok(r.out === 'sent:401' || r.out.startsWith('refused:Saving paused'), r.out);
    if (r.out === 'sent:401') assert.equal(writes()[writes().length - 1].reason, 'session_expired');
    assert.ok(writes().length - n <= 1); noDuplicateWrites();
  });

  // ---------------------------------------------------------------- C13 session replacement (r4, Bones R3-2)
  const tokSid = (auth) => JSON.parse(Buffer.from(auth.slice(7).split('.')[1], 'base64url')).sid;
  const tokSub = (auth) => JSON.parse(Buffer.from(auth.slice(7).split('.')[1], 'base64url')).sub;
  /** What the read gate does on a deliberate sign-in: popup message -> resumeAppWriteAccess(); then the status check confirms. */
  async function deliberateSignIn(email = 'brad@example.invalid', { confirm = true } = {}) {
    S.resumeAppWriteAccess();                          // synchronous, at the popup message (before any request)
    googleEmail = email; await googleSignIn(); googleEmail = 'brad@example.invalid';
    if (confirm) { const st = await statusOf(); assert.equal(st.body.state, 'signed_in'); S.confirmAppWriteSession(); return st.body; }
    return null;
  }
  await resetAll();
  await check('C13 A->A Log In Again: the cached token is discarded at once; no save until the new session is confirmed; then a FRESH mint under the NEW session -- the old token is never sent again', async () => {
    assert.equal((await save()).out, 'sent:200');
    const oldAuth = writes()[0].auth; const oldSid = tokSid(oldAuth); const before = await statusOf();
    S.resumeAppWriteAccess(); log = [];
    assert.equal(S.appWriteIdentity().operator, null, 'the cached token is gone synchronously');
    assert.equal((await save()).out, `refused:${S.SAVE_CONFIRMING_MESSAGE}`); assert.equal(log.length, 0, 'nothing sent while confirming');
    await googleSignIn(); const st = await statusOf(); S.confirmAppWriteSession();
    assert.equal(st.body.operator, before.body.operator, 'same operator tag'); assert.notEqual(st.body.session, before.body.session, 'a new session tag');
    log = []; const r = await save();
    assert.equal(r.out, 'sent:200'); assert.equal(tokens().length, 1, 'a fresh mint');
    assert.notEqual(writes()[0].auth, oldAuth); assert.equal(tokSid(writes()[0].auth), sidOf(D)); assert.notEqual(tokSid(writes()[0].auth), oldSid);
  });
  await resetAll();
  await check('C13b a PENDING mint started under the OLD session that resolves AFTER the replacement is discarded (never adopted, never used); the save is not sent; the next save mints under the new session', async () => {
    S.clearAppWriteToken(); log = []; tokenMode = 'hold';
    const p = save();                                  // its mint request carries the OLD cookie
    await new Promise((r) => setImmediate(r));
    const oldSid = sidOf(D);
    S.resumeAppWriteAccess();                          // the popup message: replacement begins
    tokenMode = 'real'; await googleSignIn();          // the new session's cookie replaces the old one
    held();                                            // the old mint answers now, with an OLD-session token
    const r = await p;
    assert.ok(r.out.startsWith('refused:Saving paused:'), r.out); assert.equal(writes().length, 0);
    assert.equal(S.appWriteIdentity().operator, null, 'the late old token was not adopted');
    S.confirmAppWriteSession(); log = [];
    assert.equal((await save()).out, 'sent:200'); assert.equal(tokSid(writes()[0].auth), sidOf(D)); assert.notEqual(sidOf(D), oldSid);
  });
  await resetAll();
  await check('C13c A->B (a different account): the operator tag changes, the previous operator\'s token is never sent, the identity becomes B (generation changes), and B\'s save carries B\'s new session', async () => {
    assert.equal((await save()).out, 'sent:200'); const a = await statusOf(); const genA = S.appWriteIdentity().generation;
    const b = await deliberateSignIn('second@example.invalid');
    assert.notEqual(b.operator, a.body.operator); assert.notEqual(b.session, a.body.session);
    log = []; assert.equal((await save()).out, 'sent:200');
    assert.equal(tokSub(writes()[0].auth), 'second@example.invalid'); assert.equal(tokSid(writes()[0].auth), sidOf(D));
    const id = S.appWriteIdentity(); assert.equal(id.operator, 'second@example.invalid'); assert.equal(id.lastOperator, 'second@example.invalid'); assert.ok(id.generation > genA);
  });
  await check('C13d logout AFTER the replacement revokes the NEW session (the handle comes from the new status answer): its token is refused next; the old session was left to expire (still active, not revoked)', async () => {
    const newSid = sidOf(D); assert.equal((await save()).out, 'sent:200');
    const so = await signOutFrom(); assert.equal(so.status, 200);
    assert.equal(blobs.get('iaos-write-receipts', rev.sessionKey('test', newSid)).text, rev.sessionRecordText('test', EPOCH, newSid, 'revoked'));
    const r = await save(); assert.ok(r.out === 'sent:401' || r.out.startsWith('refused:'), r.out);
    if (r.out === 'sent:401') assert.equal(writes()[writes().length - 1].reason, 'revoked');
    const actives = blobs.keys().filter((k) => k.includes('session/')).map((k) => blobs.store.get(k).text).filter((t) => t.includes('"active"'));
    assert.equal(actives.length, 1, 'the replaced (A) session is still active -- left to expire');
  });
  await resetAll();
  await check('C13e a session replaced in ANOTHER tab (the gate sees a new session tag): replaceAppWriteSession discards the cached token; after confirmation the next save mints under the new session', async () => {
    assert.equal((await save()).out, 'sent:200'); const oldAuth = writes()[0].auth;
    await googleSignIn();                              // another tab signed in again: the shared cookie changed
    S.replaceAppWriteSession(); log = [];
    assert.equal((await save()).out, `refused:${S.SAVE_CONFIRMING_MESSAGE}`); assert.equal(log.length, 0);
    S.confirmAppWriteSession(); assert.equal((await save()).out, 'sent:200');
    assert.notEqual(writes()[0].auth, oldAuth); assert.equal(tokSid(writes()[0].auth), sidOf(D));
  });
  await resetAll();
  await check('C13f (Bones probe-relogin model) a cached previous-session token + the popup resume + confirmation: the cached token is NOT sent; exactly one fresh mint', async () => {
    const old = writeAuth.issueBoundAppSession('brad@example.invalid', { env: 'test', sid: Buffer.alloc(16, 9).toString('base64url'), pexp: Math.floor(T / 1000) + 3600, epoch: EPOCH, aetag: '"a"', setag: '"s"' });
    S.setAppWriteSession({ token: old.token, expiresAt: new Date(T + 600_000).toISOString() });
    S.resumeAppWriteAccess(); S.confirmAppWriteSession(); log = [];
    assert.equal((await save()).out, 'sent:200');
    assert.notEqual(writes()[0].auth, `Bearer ${old.token}`); assert.equal(tokens().length, 1);
  });

  // ---------------------------------------------------------------- R reminders (login experience, spec §3)
  // The reminder module is pure: its only input is the SERVER's absolute expiry from the status answer.
  const RM = require(path.join(APP, 'src/lib/session-reminder.ts'));
  await resetAll();
  const serverExpiry = async () => Date.parse((await statusOf()).body.expiresAt);
  await check('R1 the status answer carries the absolute expiry = Google sign-in + exactly 30 days; 60 status checks, mints and saves across 26 days never move it (nothing the page does extends it)', async () => {
    const signedInAt = T; const exp = await serverExpiry();
    assert.equal(exp, Math.floor(signedInAt / 1000) * 1000 + 30 * DAY);
    for (let i = 0; i < 60; i += 1) { advance(10.4 * 3600_000); if (i % 3 === 0) assert.equal((await save()).out, 'sent:200'); assert.equal(await serverExpiry(), exp); }
    assert.ok(log.every((e) => !e.setCookie), 'a request set a cookie');
  });
  await check('R2 checkpoints from the server expiry: nothing before T5; 5 days at T5 up to T1; 1 day at T1 up to the expiry; nothing at/after the expiry (only the latest due checkpoint)', async () => {
    const exp = await serverExpiry(); const T5 = exp - 5 * DAY, T1 = exp - DAY;
    const at = (t) => RM.dueReminder(exp, t);
    assert.deepEqual([at(exp - 30 * DAY), at(T5 - 1), at(T5), at(T5 + 1), at(T1 - 1), at(T1), at(exp - 1), at(exp), at(exp + 1000)],
      [null, null, 5, 5, 5, 1, 1, null, null]);
    assert.equal(RM.reminderMessage(5), 'Your IAOS session expires within 5 days. Log in again now to keep your workflow uninterrupted.');
    assert.equal(RM.reminderMessage(1), 'Your IAOS session expires within 24 hours. Log in again now to keep your workflow uninterrupted.');
  });
  await check('R2b r4 the wording never overstates the time left: across every instant from T5 to the expiry the stated bound ("within N days" / "within 24 hours") is >= the real time left and N is the tightest whole-day bound', async () => {
    const exp = await serverExpiry();
    for (let t = exp - 5 * DAY; t < exp; t += 47 * 60_000) {
      const due = RM.dueReminder(exp, t); const msg = RM.reminderMessage(due, exp - t); const left = exp - t;
      if (due === 1) { assert.match(msg, /expires within 24 hours\./); assert.ok(left <= DAY); continue; }
      const n = Number(/expires within (\d) days\./.exec(msg)[1]);
      assert.ok(left <= n * DAY && left > (n - 1) * DAY, `${msg} with ${left / DAY} days left`);
    }
    assert.equal(RM.reminderMessage(5, exp - (exp - DAY - 5000)), 'Your IAOS session expires within 2 days. Log in again now to keep your workflow uninterrupted.', 'a late visit just before T1');
  });
  await check('R3 the next-checkpoint timer lands exactly on T5 / T1 / the expiry and is capped at one day (never a setTimeout overflow)', async () => {
    const exp = await serverExpiry(); const T5 = exp - 5 * DAY, T1 = exp - DAY;
    assert.equal(RM.nextReminderDelay(exp, exp - 30 * DAY), DAY);
    assert.equal(RM.nextReminderDelay(exp, T5 - 2000), 2000);
    assert.equal(RM.nextReminderDelay(exp, T5), DAY);
    assert.equal(RM.nextReminderDelay(exp, T1 - 7), 7);
    assert.equal(RM.nextReminderDelay(exp, exp - 5), 5);
    assert.equal(RM.nextReminderDelay(exp, exp), null);
    for (let t = exp - 30 * DAY; t < exp; t += 3.7 * 3600_000) { const d = RM.nextReminderDelay(exp, t); assert.ok(d > 0 && d <= RM.REMINDER_MAX_TIMER_MS && d < 2 ** 31 - 1, String(d)); }
  });
  await check('R4 Remind Me Later is keyed by this session expiry + checkpoint: the other checkpoint and a NEW session are not dismissed; memory fallback with no storage (this process) and with a throwing storage', async () => {
    const exp = await serverExpiry();
    assert.equal(typeof window.localStorage, 'undefined');
    assert.equal(RM.reminderDismissed(exp, 5), false); RM.dismissReminder(exp, 5);
    assert.equal(RM.reminderDismissed(exp, 5), true); assert.equal(RM.reminderDismissed(exp, 1), false);
    assert.equal(RM.reminderDismissed(exp + 30 * DAY, 5), false);
    window.localStorage = { get length() { throw new Error('denied'); }, getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    try { RM.dismissReminder(exp, 1); assert.equal(RM.reminderDismissed(exp, 1), true); } finally { delete window.localStorage; }
  });
  await check('R4b with working storage the record holds only the expiry instant + checkpoint (no token, sid, email or handle) and older sessions\' records are dropped', async () => {
    const exp = await serverExpiry(); const map = new Map([[RM.reminderKey(exp - 30 * DAY, 1), '1'], ['unrelated', 'x']]);
    window.localStorage = { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
    try {
      RM.dismissReminder(exp + 1000, 5);
      assert.deepEqual([...map.keys()].sort(), ['iaos.session-reminder.dismissed.' + new Date(exp + 1000).toISOString() + '.5d', 'unrelated'].sort());
      const all = [...map.entries()].join('|');
      assert.ok(!all.includes(D.cookie) && !all.includes(sidOf(D)) && !all.includes('brad@'), all);
    } finally { delete window.localStorage; }
  });
  await check('R5 the reminder module sends nothing and touches no session: no fetch, no endpoint, no cookie, no saving-module call', async () => {
    const src = fs.readFileSync(path.join(APP, 'src/lib/session-reminder.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.ok(!/fetch|XMLHttpRequest|sendBeacon|netlify\/functions|document\.cookie|import /.test(src));
  });

  Date.now = realNow; setFlag(false);
  const FLOOR = 41;
  if (checks < FLOOR) { failures += 1; console.log(`FAIL  check floor -- ${checks} checks ran, the floor is ${FLOOR}`); }
  console.log(`B15-29 one IAOS sign-in (client): ${checks - failures}/${checks} checks passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.log('FAIL  suite aborted -- ' + (e && e.stack)); process.exitCode = 1; });
