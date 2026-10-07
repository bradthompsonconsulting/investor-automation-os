/**
 * Storage correction -- Bones review finding 7: a page is bound to the
 * activation it verified BEFORE edits/saves, never a later one. Executes the REAL
 * client module (src/lib/app-write-session.ts) in Node with a stubbed network.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
const { check, done } = require('./harness/check.cjs');
const MOD = path.join(__dirname, '../src/lib/app-write-session.ts');
let server; let calls;
global.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {} });
  if (String(url).endsWith('/iaos-activation')) {
    if (server.fail) throw new TypeError('network down');
    return new Response(JSON.stringify({ state: 'open', activationId: server.activationId, deployId: 'd1', runtimeDeployId: 'd1' }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
function freshModule() {
  delete require.cache[require.resolve(MOD)];
  const m = require(MOD);
  m.setAppWriteSession({ token: 'tok-1', expiresAt: new Date(Date.now() + 600_000).toISOString() });
  return m;
}
const save = (m) => m.appWriteFetch('/.netlify/functions/ghl-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
const writes = () => calls.filter((c) => c.url.endsWith('/ghl-write'));
const activationReads = () => calls.filter((c) => c.url.endsWith('/iaos-activation'));
const reset = (activationId) => { server = { activationId, fail: false }; calls = []; };

(async () => {
  await check('PB-1 (Bones finding 7) bound under A1; the deployment is reactivated as A2; the page\'s FIRST save echoes A1 (the server then refuses it), never A2', async () => {
    reset('v2-act-A1'); const m = freshModule();
    await m.bindPageActivation();
    server.activationId = 'v2-act-A2';                  // controlled republish/reactivation, no reload
    await save(m);
    assert.equal(writes()[0].headers['X-IAOS-Activation'], 'v2-act-A1');
    assert.equal(activationReads().length, 1, 'never re-read');
  });
  await check('PB-2 the initial activation fetch FAILS, then the deployment is reactivated: saves are refused (reload) and the page never adopts the new activation', async () => {
    reset('v2-act-A1'); server.fail = true; const m = freshModule();
    await m.bindPageActivation();
    server.fail = false; server.activationId = 'v2-act-A2';
    await assert.rejects(save(m), (e) => e instanceof m.AppWritePageStale && e instanceof m.AppWriteSignInRequired);
    await m.bindPageActivation();                       // later sign-ins never rebind
    await assert.rejects(save(m), (e) => e instanceof m.AppWritePageStale);
    assert.equal(writes().length, 0, 'nothing sent');
    assert.equal(activationReads().length, 1, 'no retry');
  });
  await check('PB-3 an UNBOUND page never binds lazily at its first save: refused, nothing sent, no activation read', async () => {
    reset('v2-act-A1'); const m = freshModule();
    await assert.rejects(save(m), (e) => e instanceof m.AppWritePageStale);
    assert.equal(calls.length, 0);
  });
  await check('PB-4 write-session recovery (a new write session) keeps the original binding', async () => {
    reset('v2-act-A1'); const m = freshModule();
    await m.bindPageActivation();
    server.activationId = 'v2-act-A2';
    m.setAppWriteSession({ token: 'tok-2', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await save(m);
    assert.equal(writes()[0].headers['X-IAOS-Activation'], 'v2-act-A1');
    assert.equal(writes()[0].headers.Authorization, 'Bearer tok-2');
  });
  await check('PB-5 a save racing the in-flight binding waits for THAT binding; concurrent binds read once', async () => {
    reset('v2-act-A1'); const m = freshModule();
    const b1 = m.bindPageActivation(); const b2 = m.bindPageActivation();
    const s = save(m);
    await Promise.all([b1, b2, s]);
    assert.equal(activationReads().length, 1);
    assert.equal(writes()[0].headers['X-IAOS-Activation'], 'v2-act-A1');
  });
  await check('PB-6 a closed or mismatched activation at binding time binds nothing (saves refused)', async () => {
    reset('v2-act-A1'); const m = freshModule();
    global.fetch = ((orig) => async (url, init) => (String(url).endsWith('/iaos-activation') ? (calls.push({ url: String(url) }), new Response(JSON.stringify({ state: 'closed', activationId: null, deployId: 'd1', runtimeDeployId: 'd1' }), { status: 200 })) : orig(url, init)))(global.fetch);
    await m.bindPageActivation();
    await assert.rejects(save(m), (e) => e instanceof m.AppWritePageStale);
  });
  await check('PB-7 static: the signed-in shell binds the page once, on the first read sign-in, before any edit', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/components/Layout.tsx'), 'utf8');
    assert.ok(/useEffect\(\(\) => \{ if \(readSignedIn\) void bindPageActivation\(\); \}, \[readSignedIn\]\);/.test(src));
    const lib = fs.readFileSync(MOD, 'utf8');
    assert.ok(!/activationId\(\)/.test(lib), 'no lazy activation read inside appWriteFetch');
  });
  done('page activation binding');
})();
