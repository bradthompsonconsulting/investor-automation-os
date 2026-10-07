/**
 * Real Blob SDK; only HTTP transport is intercepted. No live requests.
 *
 * Storage correction (PR #131 plan v6 §5): ghl-disposition is a modern-runtime
 * function. The Lambda-era bootstrap this suite used to pin (`connectLambda`
 * plus its negative control) no longer exists: the platform supplies
 * NETLIFY_BLOBS_CONTEXT, and ownership reads must be STRONG (uncachedEdgeURL).
 * The same properties are restated for v2:
 *   - every refusal before the write gate makes ZERO blob requests;
 *   - a missing, malformed or Lambda-only (no uncachedEdgeURL) context refuses
 *     with no GHL write;
 *   - the real SDK path: lock v2 acquire, admission tickets, note, then the
 *     attempt, then an owner-proven lock release -- and NO delete anywhere;
 *   - an attempt failure stays non-2xx and a retry does not duplicate the note;
 *   - a held lock refuses without a note or attempt, and is never released.
 */
'use strict';
const assert = require('node:assert/strict');
const { setupV2Env } = require('./harness/v2-env.cjs');
const env = setupV2Env();
const { getConfig } = require('../shared/ghl-config.ts');
process.env.IAOS_WEBHOOK_SECRET = 'offline-disposition-secret';
const mod = require('../netlify/functions/ghl-disposition.ts');
const S = env.S;
const contact = { id: 'fixture-contact', locationId: getConfig('test').locationId, customFields: [] };
const notes = []; const calls = [];
let failAttempt = false;
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
env.hooks.ghlFetch = async (url, init = {}) => {
  const u = new URL(url), method = (init.method || 'GET').toUpperCase();
  calls.push({ origin: u.origin, path: u.pathname, method });
  assert.equal(u.origin, 'https://services.leadconnectorhq.com');
  if (u.pathname === '/contacts/' + contact.id + '/notes') {
    if (method === 'POST') notes.push({ id: 'note-' + notes.length, body: JSON.parse(init.body).body, dateAdded: new Date().toISOString() });
    else assert.equal(method, 'GET');
    return reply(method === 'POST' ? { note: notes.at(-1) } : { notes });
  }
  assert.equal(u.pathname, '/contacts/' + contact.id);
  if (method === 'PUT') {
    if (failAttempt) return reply({}, 400);
    contact.customFields = JSON.parse(init.body).customFields.map((f) => ({ id: f.id, value: f.field_value }));
  } else assert.equal(method, 'GET');
  return reply({ contact });
};
const event = () => ({ fn: 'ghl-disposition', httpMethod: 'POST', headers: { 'x-iaos-secret': process.env.IAOS_WEBHOOK_SECRET }, body: JSON.stringify({ customData: { contact_id: contact.id, disposition: 'No Answer', duration: '5' } }) });
const handler = (e) => env.invoke(mod, e);
const blobRequests = () => env.wire.log.length;
const ghlWrites = () => calls.filter((c) => c.method !== 'GET');
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS ' + name); }

(async () => {
  for (const [name, status, change] of [
    ['method', 405, (e) => { e.httpMethod = 'GET'; e.body = undefined; }],
    ['auth', 401, (e) => { delete e.headers['x-iaos-secret']; }],
    ['JSON', 400, (e) => { e.body = '{'; }],
    ['payload', 403, (e) => { e.body = JSON.stringify({ customData: { contact_id: contact.id, disposition: 'Trigger Workflow' } }); }],
    ['location', 403, () => { contact.locationId = 'foreign'; }],
  ]) await check(name + ' refused before any Blob access', async () => {
    const e = event(); const before = blobRequests(); const gBefore = ghlWrites().length;
    change(e);
    assert.equal((await handler(e)).statusCode, status);
    assert.equal(blobRequests(), before, 'zero blob requests');
    assert.equal(ghlWrites().length, gBefore);
    contact.locationId = getConfig('test').locationId;
  });
  const saved = process.env.NETLIFY_BLOBS_CONTEXT;
  for (const [name, ctx] of [
    ['missing', undefined],
    ['malformed', '%%%'],
    ['missing token', Buffer.from(JSON.stringify({ edgeURL: env.wire.EDGE, uncachedEdgeURL: env.wire.UNCACHED, siteID: env.wire.SITE })).toString('base64')],
    ['Lambda-only (no uncachedEdgeURL: no strong reads)', env.wire.lambdaContext()],
  ]) await check(name + ' context refuses without writes', async () => {
    if (ctx === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT; else process.env.NETLIFY_BLOBS_CONTEXT = ctx;
    const g = ghlWrites().length;
    try {
      const r = await handler(event());
      assert.notEqual(r.statusCode, 200);
      assert.equal(ghlWrites().length, g, 'no GHL write');
      assert.equal(notes.length, 0);
    } finally { process.env.NETLIFY_BLOBS_CONTEXT = saved; }
  });
  await check('real SDK: lock v2 acquire, admitted note then attempt, owner-proven release -- and no delete anywhere', async () => {
    const before = env.wire.log.length;
    assert.equal((await handler(event())).statusCode, 200);
    assert.deepEqual(ghlWrites().map((c) => c.method), ['POST', 'PUT']);
    const mine = env.wire.log.slice(before);
    assert.equal(mine.filter((x) => x.method === 'DELETE').length, 0, 'no DELETE');
    const lockKeys = env.wire.keys(S).filter((k) => k.startsWith('lock2/'));
    assert.equal(lockKeys.length, 1);
    assert.equal(env.wire.json(S, lockKeys[0]).state, 'free', 'released by compare-and-swap, not deleted');
    assert.deepEqual(Object.keys(env.admission().tickets), [], 'both tickets settled');
    assert.equal(notes.length, 1); assert.equal(contact.customFields.length, 2);
    assert.equal(env.wire.violations.length, 0, 'no ownership read on the cached origin');
  });
  await check('attempt failure remains non-2xx; retry does not duplicate note', async () => {
    failAttempt = true;
    assert.equal((await handler(event())).statusCode, 502);
    assert.equal(notes.length, 1);
    failAttempt = false;
    /* Storage correction: a GHL 400 on the attempt is an UNCERTAIN send (its admission ticket stays
       `uncertain` and blocks overlapping last-touch writes on this contact), so the retry's attempt is
       refused until that is resolved -- the note is still never duplicated. */
    const retry = await handler(event());
    assert.notEqual(retry.statusCode, 200);
    assert.equal(notes.length, 1);
  });
  await check('a held lock refuses without note or attempt and is not released', async () => {
    env.reset(); notes.length = 0; contact.customFields = [];
    const key = env.wire.keys(S).find((k) => k.startsWith('lock2/')) || require('../netlify/functions/lib/contact-lock-v2.ts').lockKey('test', getConfig('test').locationId, contact.id);
    env.wire.seed(S, key, { v: 2, state: 'held', holderHash: 'someone-else', fn: 'ghl-write', opId: null, acquiredAt: new Date().toISOString(), holderDeadline: new Date(Date.now() + 60_000).toISOString(), prevReleasedByHash: null, deployId: env.DEPLOY_ID });
    const g = ghlWrites().length;
    assert.equal((await handler(event())).statusCode, 409);
    assert.equal(env.wire.json(S, key).holderHash, 'someone-else', 'not released');
    assert.equal(ghlWrites().length, g); assert.equal(notes.length, 0);
  });
  console.log(count + ' real-SDK disposition context checks passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
