/** INV-95 offline handler regressions. Every outbound call is intercepted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
/* Storage correction (PR #131 storage v2): the five write endpoints are modern-runtime
   functions (`export default async (req, context)`) and every ownership record goes through
   the verified adapter over the REAL @netlify/blobs client, here served by the wire harness
   (harness/v2-lambda-compat.cjs). The in-memory `@netlify/blobs` mock, `connectLambda` and
   the Lambda `blobs` event field are gone: `blobs` fields below are ignored, and the old
   "blob store touched" counters are the wire log (every blob request the real SDK made). */
require('./harness/ts-loader.cjs');
const { createCompat, v2Id } = require('./harness/v2-lambda-compat.cjs');
const compat = createCompat();
const { receipts } = compat;
const realBlobs = require('@netlify/blobs');
const APP = path.resolve(__dirname, '..');
const lambdaHeaders = {};      // x-nf-* headers carry no meaning in the modern runtime (the compat layer strips them)
const lambdaBlobs = undefined; // the Lambda blobs field is ignored by the compat layer
/** Every blob request the real SDK has made so far (replaces blobCalls/blobConnections). */
const blob = () => compat.wire.log.length;
/** The whole ownership store, authz/ records included (write receipts now live under authz/receipt/). */
const storeSnapshot = () => compat.wire.keys(compat.S).sort().map((k) => [k, JSON.stringify(compat.wire.json(compat.S, k))]);
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.IAOS_GHL_TOKEN_V2 = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';
// Read authority (lib/app-read-auth.ts): its own settings, never the write ones.
process.env.IAOS_APP_READ_GOOGLE_CLIENT_ID = 'offline-read-client';
process.env.IAOS_APP_READ_SESSION_SECRET = 'offline-read-fixture-only-not-a-real-secret';
process.env.IAOS_APP_READ_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_READ_ALLOWED_ORIGIN = 'https://proof.example.invalid';
const auth = require('../netlify/functions/lib/app-write-auth.ts');
const contracts = require('../netlify/functions/lib/write-contracts.ts');
const { getConfig } = require('../shared/ghl-config.ts');
const config = getConfig('test');
const boundaryLib = {...require('../netlify/functions/lib/ghl-write-boundary.ts'),...require('../netlify/functions/lib/write-receipts.ts')};
/* Storage correction: lockContact() (the old `lock/` key, deleted on release) is gone. Lock v2 lives at
   lock2/<sha256(env:locationId:contactId)> and is never deleted: another writer's in-progress hold is a
   held record; its release is a free record (held -> free). */
const { lockKey: lockKeyV2 } = require('../netlify/functions/lib/contact-lock-v2.ts');
async function holdContactLock(contactId) {
  const key = lockKeyV2('test', config.locationId, contactId);
  const now = Date.now();
  receipts.set(key, { v: 2, state: 'held', holderHash: 'fixture-other-holder', fn: 'ghl-write', opId: null, acquiredAt: new Date(now).toISOString(), holderDeadline: new Date(now + 120000).toISOString(), prevReleasedByHash: null, deployId: compat.DEPLOY_ID });
  return async () => { receipts.set(key, { v: 2, state: 'free', releasedAt: new Date().toISOString(), releasedByHash: 'fixture-other-holder', releasedForOp: null }); };
}
const contact = { id: 'fixture-contact', locationId: config.locationId, customFields: [], tags: [], phone: '+15555550101' };
const opportunity = { id: 'fixture-opportunity', contactId: contact.id, locationId: config.locationId, customFields: [] };
let notes = [], calls = [], writes = 0, omitReadback = false, failContactRead = 0;
const task = { id: 'fixture-task', contactId: contact.id, completed: false };
const reply = data => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
const ghlFake = async (url, init = {}) => {
  const parsed = new URL(url); const pathname = parsed.pathname; const method = init.method || 'GET';
  calls.push({ pathname, method });
  if (failContactRead > 0 && method === 'GET' && pathname === `/contacts/${contact.id}`) { failContactRead--; throw new Error('fixture: GHL contact read unreachable'); }
  assert.equal(parsed.origin, 'https://services.leadconnectorhq.com', 'no external network');
  if (pathname === `/contacts/${contact.id}/notes`) {
    if (method === 'POST') { writes++; const note = { id: `note-${notes.length}`, body: JSON.parse(init.body).body }; notes.push(note); return reply({ note }); }
    return reply({ notes });
  }
  if (pathname === `/contacts/${contact.id}/tasks/${task.id}`) return reply({ task });
  if (pathname === `/contacts/${contact.id}/tasks/${task.id}/completed`) { writes++; task.completed = true; return reply({}); }
  const object = pathname === `/contacts/${contact.id}` ? contact : pathname === `/opportunities/${opportunity.id}` ? opportunity : null;
  if (!object) throw new Error('Unexpected mocked request: ' + pathname);
  if (method === 'PUT') {
    writes++;
    const putBody = JSON.parse(init.body);
    if ('dndSettings' in putBody || 'dnd' in putBody) throw new Error('IAOS must never write DND (B14-12): ' + JSON.stringify(Object.keys(putBody)));
    if (!omitReadback) for (const field of putBody.customFields) {
      object.customFields = object.customFields.filter(f => f.id !== field.id);
      if (field.field_value !== '' && field.field_value !== null) object.customFields.push({ id: field.id, [object === contact ? 'value' : 'fieldValue']: field.field_value });
    }
  }
  return reply(object === contact ? { contact } : { opportunity });
};
/* Installed AFTER createCompat(): blob traffic still reaches the wire through the adapter's own transport;
   any blob URL that does reach global fetch is handed to the wire, everything else is the GHL fake. */
global.fetch = (url, init) => {
  const u = new URL(String(url));
  if (u.origin === compat.wire.EDGE || u.origin === compat.wire.UNCACHED) return compat.wire.fetch(url, init);
  return ghlFake(url, init);
};
const handler = compat.handlerOf(require('../netlify/functions/ghl-write.ts'), 'ghl-write');
const uploadHandler = compat.handlerOf(require('../netlify/functions/ghl-executed-artifact-upload.ts'), 'ghl-executed-artifact-upload');
// Board 15 / PR #126 stacked server PR: a Current Offer write needs a durable
// reservation (current-offer-barrier.ts) before it can be sent.
const barrierHandler = compat.handlerOf(require('../netlify/functions/current-offer-barrier.ts'), 'current-offer-barrier');
/* Board 15 / PR #131: a call result is sent only as the bound result attempt of
   a durable call-log OPERATION (approved lifecycle v3, lib/call-log-barrier.ts).
   An earlier case may have left an operation open: it is first finished through
   the server's own next actions (Check again), with its original derived ids.
   Returns the new operation's result request id. */
const callLogHandler = compat.handlerOf(require('../netlify/functions/call-log-barrier.ts'), 'call-log-barrier');
let openCallLogOp = null;
async function reserveCallLog(result) {
  const headers = { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` };
  const action = async (b) => JSON.parse((await callLogHandler({ blobs: lambdaBlobs, httpMethod: 'POST', headers, body: JSON.stringify(b) })).body);
  for (let i = 0; openCallLogOp && i < 6; i++) {
    const v = await action({ action: 'resume', contactId: contact.id, operationId: openCallLogOp });
    if (v.state !== 'open' || v.next.action !== 'send') break;
    const args = v.next.slot === 'note' ? { body: v.body } : { value: '2026-10-06T12:00:00.000Z' };
    const done = await handler(event(v.next.slot === 'note' ? 'note.create' : 'contact.lastCallAttempt', contact.id, args, v.next.requestId));
    assert.equal(done.statusCode, 200, done.body);
  }
  const op = v2Id(); // Storage correction: operation ids are v2- only
  const res = await action({ action: 'begin', contactId: contact.id, operationId: op, result, body: `Call (reported by Brad in IAOS): ${result}` });
  assert.equal(res.state, 'reserved', JSON.stringify(res));
  openCallLogOp = op;
  return `${op}-result-1`;
}
async function reserveFollowUpCallback(requestId) {
  const steps = [{ step: 'callback', requestId }, { step: 'callback_note', requestId: requestId + '-cbn' }, { step: 'touch', requestId: requestId + '-tch' }, { step: 'note', requestId: requestId + '-out' }];
  const res = await barrierHandler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ action: 'begin', opportunityId: opportunity.id, purpose: 'follow_up', steps }) });
  assert.equal(res.statusCode, 200, res.body);
}
async function reserveOffer(requestId) {
  // A previous case may have left a reservation with never-sent steps: reconcile withdraws them.
  await barrierHandler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ action: 'reconcile', opportunityId: opportunity.id }) });
  const res = await barrierHandler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ action: 'begin', opportunityId: opportunity.id, purpose: 'blur', steps: [{ step: 'offer', requestId }] }) });
  assert.equal(res.statusCode, 200, res.body);
}
let count = 0;
function check(name, fn) { return Promise.resolve().then(fn).then(() => { count++; console.log('PASS ' + name); }); }
let sequence = 0;
// Storage correction: request ids are v2- only (a non-v2 id is refused 400 legacy_id_refused before any I/O).
function event(operation, targetId, args, requestId = `v2-request-${++sequence}`) {
  return { blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ operation, targetId, args, requestId }) };
}
(async () => {

  /* Storage correction: there is no Lambda `blobs` context or connectLambda in the modern runtime.
     The platform's blob context (NETLIFY_BLOBS_CONTEXT, here pointing at the wire) is what the verified
     adapter uses; the old "connectLambda was called" counter is restated as: the write went to the REAL
     SDK's requests against the v2 ownership store on the wire. */
  await check('valid platform blob context initializes real SDK Blob access', async () => {
    const before = compat.wire.log.length;
    const e = event('note.create', contact.id, {body:'Lambda fixture'});
    assert.equal((await handler(e)).statusCode, 200);
    assert.ok(compat.wire.log.slice(before).some((r) => r.store === 'site:' + compat.S), 'the real SDK reached the v2 ownership store');
    let reads = 0;
    const store = realBlobs.getStore({name:'iaos-write-receipts', siteID:'offline-site', token:'offline-blob-fixture', edgeURL:'https://blobs.example.invalid',
      fetch: async (url, init) => {
        assert.equal(new URL(url).origin, 'https://blobs.example.invalid');
        assert.equal(String(init.method).toLowerCase(), 'get');
        reads++;
        return new Response(JSON.stringify({fixture:true}));
      }
    });
    assert.deepEqual(await store.get('fixture', {type:'json'}), {fixture:true});
    assert.equal(reads, 1);
  });
  /* Storage correction: the Lambda-context fail-closed cases are restated against the platform blob
     context the adapter actually reads. A missing/unparseable/incomplete context must refuse the write
     with nothing sent to GHL and nothing written to the ownership store. */
  const goodBlobContext = process.env.NETLIFY_BLOBS_CONTEXT;
  const goodCtx = JSON.parse(Buffer.from(goodBlobContext, 'base64').toString('utf8'));
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64');
  for (const [label, raw] of [
    ['missing', undefined],
    ['invalid base64/JSON', '%%%'],
    ['null JSON', Buffer.from('null').toString('base64')],
    ['missing token', b64({ ...goodCtx, token: undefined })],
    ['missing site', b64({ ...goodCtx, siteID: undefined })],
  ]) await check('blob context fails closed: ' + label, async () => {
    const e = event('note.create', contact.id, {body:'must not write'});
    const before = {writes, store: storeSnapshot()};
    let result;
    try {
      if (raw === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT; else process.env.NETLIFY_BLOBS_CONTEXT = raw;
      result = await handler(e);
    } finally { process.env.NETLIFY_BLOBS_CONTEXT = goodBlobContext; }
    /* Storage correction: was 409 "Write refused or unconfirmed". In v2 the write gate reads the
       authorization records first; an unusable blob context makes them unreadable, so the write is
       refused 503 storage-unavailable before any ownership record or GHL call (plan v6 §8.1). */
    assert.equal(result.statusCode, 503, result.body);
    assert.deepEqual(JSON.parse(result.body), { code: 'storage', error: 'Saving is unavailable: the save records could not be read' });
    assert.deepEqual({writes, store: storeSnapshot()}, before);
  });

  // ============================================================
  // Gate-review closure -- PR #85 unattributable-409 diagnostics. The
  // response shapes/status codes asserted above and below must remain
  // byte-identical; this block additionally proves the new
  // console.error side channel fires on both 409 branches, carries only
  // correlation/error metadata, and never leaks the request body, note
  // contents, or the bearer token.
  // ============================================================
  {
    const originalConsoleError = console.error;
    function captureConsoleError(run) {
      const calls = [];
      console.error = (...args) => { calls.push(args); };
      return Promise.resolve().then(run)
        .finally(() => { console.error = originalConsoleError; })
        .then(() => calls);
    }
    function parsedLog(logCalls) {
      assert.equal(logCalls.length, 1, 'exactly one console.error call, got ' + logCalls.length);
      const [prefix, payload] = logCalls[0];
      assert.equal(prefix, '[ghl-write]');
      return JSON.parse(payload);
    }

    await check('generic Error 409 is logged with correlation/error metadata, response unchanged', async () => {
      const secretNoteBody = 'must-not-appear-in-logs — sensitive note contents';
      const e = event('note.create', contact.id, {body: secretNoteBody}, 'v2-diagnostics-generic-request');
      /* Storage correction: a missing Lambda blobs context no longer exists to provoke the generic
         (non-WriteUncertain) 409; the same catch-all branch is reached by a GHL read that fails
         before anything is sent. */
      failContactRead = 1000;
      const before = {writes, store: storeSnapshot().filter(([k]) => !k.startsWith('authz/admission'))};
      const logCalls = await captureConsoleError(async () => {
        const result = await handler(e).finally(() => { failContactRead = 0; });
        assert.equal(result.statusCode, 409);
        assert.deepEqual(JSON.parse(result.body), {error:'Write refused or unconfirmed; refresh and inspect before retrying'});
      });
      assert.deepEqual({writes, store: storeSnapshot().filter(([k]) => !k.startsWith('authz/admission'))}, before);
      const logged = parsedLog(logCalls);
      assert.equal(logged.requestId, 'v2-diagnostics-generic-request');
      assert.equal(logged.operation, 'note.create');
      assert.equal(logged.isWriteUncertain, false);
      assert.equal(typeof logged.errorName, 'string');
      assert.equal(typeof logged.errorMessage, 'string');
      const serialized = JSON.stringify(logged);
      assert.equal(serialized.includes(secretNoteBody), false);
      assert.equal(serialized.includes(e.headers.authorization), false);
      assert.equal(serialized.toLowerCase().includes('bearer'), false);
    });

    await check('WriteUncertain 409 is logged with correlation/error metadata, response unchanged', async () => {
      const release = await holdContactLock(contact.id);
      const secretValue = 'must-not-appear-in-logs-either';
      const e = event('contact.propertyNotes', contact.id, {value: secretValue}, 'v2-diagnostics-writeuncertain-request');
      const before = writes;
      let logCalls;
      try {
        logCalls = await captureConsoleError(async () => {
          const result = await handler(e);
          assert.equal(result.statusCode, 409);
          const body = JSON.parse(result.body);
          assert.equal(body.outcome, 'indeterminate');
          assert.equal(typeof body.error, 'string');
        });
      } finally { await release(); }
      assert.equal(writes, before);
      const logged = parsedLog(logCalls);
      assert.equal(logged.requestId, 'v2-diagnostics-writeuncertain-request');
      assert.equal(logged.operation, 'contact.propertyNotes');
      assert.equal(logged.isWriteUncertain, true);
      assert.equal(typeof logged.errorName, 'string');
      assert.equal(typeof logged.errorMessage, 'string');
      const serialized = JSON.stringify(logged);
      assert.equal(serialized.includes(secretValue), false);
    });

    await check('successful write logs nothing', async () => {
      const e = event('note.create', contact.id, {body:'quiet success fixture'});
      const logCalls = await captureConsoleError(async () => {
        const result = await handler(e);
        assert.equal(result.statusCode, 200, result.body);
      });
      assert.deepEqual(logCalls, []);
    });
  }

  for (const [label, status, mutate] of [
    ['method', 405, e => { e.httpMethod = 'GET'; }],
    ['auth', 401, e => { delete e.headers.authorization; }],
    ['origin', 403, e => { e.headers.origin = 'https://wrong.example.invalid'; }],
    ['JSON', 400, e => { e.body = '{'; }],
    ['operation', 400, e => {
      e.body = JSON.stringify({operation:'retired',targetId:contact.id,
        requestId:'offline-rejected',args:{}});
    }]
  ]) await check('rejection precedes Lambda/Blob access: ' + label, async () => {
    const e = event('note.create', contact.id, {body:'must not write'});
    delete e.blobs;
    mutate(e);
    const before = [calls.length, writes, blob()];
    assert.equal((await handler(e)).statusCode, status);
    assert.deepEqual([calls.length, writes, blob()], before);
  });

  // Origin failures must not instantiate Blob storage or call GHL.
  const approvedOrigin = process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
  for (const origin of [
    undefined, '', 'null', 'https://wrong.example.invalid',
    approvedOrigin + '.attacker.invalid', approvedOrigin + '/',
    approvedOrigin + '/path', approvedOrigin + '?x=1',
    approvedOrigin + '#fragment', approvedOrigin + ':443',
    'http://proof.example.invalid', 'https://user@proof.example.invalid',
    ' https://proof.example.invalid', approvedOrigin + ', ' + approvedOrigin,
    ['https://proof.example.invalid'], 'not a URL',
    // Gate-review closure, PR #85 deploy-preview origin repair -- sibling
    // Netlify sites, lookalike hostnames, and malformed variants of the
    // deploy-preview pattern must all still refuse.
    'https://deploy-preview-85--iaos-app.netlify.app',
    'https://deploy-preview-85--investor-automation-os.netlify.app',
    'https://deploy-preview-85--iaos-app-test.netlify.app.attacker.invalid',
    'https://deploy-preview-85--iaos-app-test.netlify.app/',
    'https://deploy-preview-85--iaos-app-test.netlify.app:443',
    'http://deploy-preview-85--iaos-app-test.netlify.app',
    'https://deploy-preview-85--iaos-app-testx.netlify.app',
    'https://xdeploy-preview-85--iaos-app-test.netlify.app',
    'https://deploy-preview-0--iaos-app-test.netlify.app',
    'https://deploy-preview-01--iaos-app-test.netlify.app',
    'https://deploy-preview---iaos-app-test.netlify.app',
    'https://deploy-preview-85-iaos-app-test.netlify.app',
    'https://branch-deploy--iaos-app-test.netlify.app',
  ]) {
    /* Storage correction: a Fetch Request (modern runtime) trims optional whitespace around a header
       value and stringifies a non-string one, so ' <approved>' and ['<approved>'] cannot reach the
       handler as written -- the handler would see exactly the approved origin. Those two values are
       still checked against the unchanged origin helper with the raw Lambda-shaped event (the oracle
       the request adapter is pinned to); every other value goes through the real handler as before. */
    if (origin === ' https://proof.example.invalid' || Array.isArray(origin)) {
      await check('Origin rejected (origin helper, raw value): ' + JSON.stringify(origin), async () => {
        const { requireAppWriteOrigin } = require('../netlify/functions/lib/app-write-origin.ts');
        assert.throws(() => requireAppWriteOrigin({ headers: { origin } }), /Write origin refused/);
      });
      continue;
    }
    await check('Origin rejected: ' + JSON.stringify(origin), async () => {
      const e = event('note.create', contact.id, {body:'must not write'});
      if (origin === undefined) delete e.headers.origin;
      else e.headers.origin = origin;
      const before = [calls.length, blob(), writes];
      assert.equal((await handler(e)).statusCode, 403);
      assert.deepEqual([calls.length, blob(), writes], before);
    });
  }

  // ============================================================
  // Gate-review closure -- PR #85 deploy-preview origin repair. The
  // narrow, reusable exception: the `iaos-app-test` site's own deploy
  // previews, Test-only, full end-to-end through the real handler
  // (process.env.IAOS_ENV is already "test" throughout this file).
  // ============================================================
  for (const previewOrigin of [
    'https://deploy-preview-85--iaos-app-test.netlify.app', // the exact PR #85 origin that was observed refused
    'https://deploy-preview-42--iaos-app-test.netlify.app', // a different numeric preview, proving the pattern is reusable, not a one-off literal
  ]) {
    await check('Origin accepted (Test-only deploy preview): ' + previewOrigin, async () => {
      const e = event('note.create', contact.id, { body: 'deploy preview write' });
      e.headers.origin = previewOrigin;
      const before = writes;
      assert.equal((await handler(e)).statusCode, 200);
      assert.equal(writes, before + 1);
    });
    /* Storage correction: the origin exception above is unchanged, but in v2 a write is only ever
       accepted on a PUBLISHED PRODUCTION deploy (write gate). The same request served by an actual
       deploy-preview deployment is refused 403 before anything is sent or stored. */
    await check('Deploy-preview DEPLOYMENT refuses the write (403, nothing sent or stored): ' + previewOrigin, async () => {
      const previewHandler = compat.handlerOf(require('../netlify/functions/ghl-write.ts'), 'ghl-write', { context: 'deploy-preview', published: false });
      const e = event('note.create', contact.id, { body: 'deploy preview write' });
      e.headers.origin = previewOrigin;
      const before = { writes, calls: calls.length, store: storeSnapshot() };
      const res = await previewHandler(e);
      assert.equal(res.statusCode, 403, res.body);
      assert.deepEqual({ writes, calls: calls.length, store: storeSnapshot() }, before);
    });
  }
  /* Storage correction: every id this suite sends is v2- prefixed. A legacy-format (non-v2) request id
     is refused permanently, 400 legacy_id_refused, before any GHL call or blob request. */
  await check('legacy (non-v2) request id refused 400 legacy_id_refused before any I/O', async () => {
    const before = [calls.length, blob(), writes];
    const res = await handler(event('note.create', contact.id, { body: 'legacy id' }, 'request-legacy-format'));
    assert.equal(res.statusCode, 400, res.body);
    assert.deepEqual(JSON.parse(res.body), { error: 'Invalid named write request', code: 'legacy_id_refused' });
    assert.deepEqual([calls.length, blob(), writes], before);
  });

  {
    const { requireAppWriteOrigin, IAOS_APP_TEST_DEPLOY_PREVIEW_ORIGIN } = require('../netlify/functions/lib/app-write-origin.ts');
    const previewOrigin = 'https://deploy-preview-85--iaos-app-test.netlify.app';
    const baseEnv = { IAOS_APP_WRITE_ALLOWED_ORIGIN: approvedOrigin, IAOS_ENV: 'test' };
    const eventWithOrigin = (origin) => ({ headers: { origin } });

    await check('IAOS_APP_TEST_DEPLOY_PREVIEW_ORIGIN matches the exact PR #85 origin', async () => {
      assert.equal(IAOS_APP_TEST_DEPLOY_PREVIEW_ORIGIN.test(previewOrigin), true);
    });
    await check('requireAppWriteOrigin accepts the deploy-preview origin directly when IAOS_ENV=test', async () => {
      requireAppWriteOrigin(eventWithOrigin(previewOrigin), baseEnv); // must not throw
    });
    await check('requireAppWriteOrigin refuses the SAME deploy-preview origin OUTSIDE Test (IAOS_ENV=production)', async () => {
      assert.throws(() => requireAppWriteOrigin(eventWithOrigin(previewOrigin), { ...baseEnv, IAOS_ENV: 'production' }), /Write origin refused/);
    });
    await check('requireAppWriteOrigin refuses the SAME deploy-preview origin when IAOS_ENV is unset', async () => {
      assert.throws(() => requireAppWriteOrigin(eventWithOrigin(previewOrigin), { IAOS_APP_WRITE_ALLOWED_ORIGIN: approvedOrigin }), /Write origin refused/);
    });
    await check('requireAppWriteOrigin still accepts the explicitly configured origin when IAOS_ENV=test (existing behavior fully preserved)', async () => {
      requireAppWriteOrigin(eventWithOrigin(approvedOrigin), baseEnv); // must not throw
    });
  }

  for (const headers of [
    {Origin: approvedOrigin},
    {multi: {Origin:[approvedOrigin, approvedOrigin]}},
    {multi: {origin:[approvedOrigin], Origin:[approvedOrigin]}},
    {multi: {origin:[]}},
  ]) await check('ambiguous Origin refused ' + JSON.stringify(headers), async()=>{
    const e = event('note.create',contact.id,{body:'must not write'});
    /* Storage correction: a Fetch Request has no multiValueHeaders; a repeated Origin header reaches the
       modern-runtime handler as ONE comma-joined value (and an empty list as no Origin at all). The
       multi-value shape is still refused by the unchanged origin helper on the raw Lambda-shaped event
       (the oracle), and the handler is driven with what the runtime would actually deliver. */
    if (headers.multi) {
      const raw = { headers: { origin: approvedOrigin }, multiValueHeaders: headers.multi };
      const { requireAppWriteOrigin } = require('../netlify/functions/lib/app-write-origin.ts');
      assert.throws(() => requireAppWriteOrigin(raw));
      const values = Object.values(headers.multi).flat();
      if (values.length) e.headers.origin = values.join(', '); else delete e.headers.origin;
    }
    else Object.assign(e.headers,headers);
    const before = [calls.length,blob(),writes];
    assert.equal((await handler(e)).statusCode,403);
    assert.deepEqual([calls.length,blob(),writes],before);
  });
  for (const setting of [undefined,'','*','https://*.example.invalid',
    approvedOrigin+'/',approvedOrigin+',https://other.example.invalid']) {
    await check('invalid origin configuration fails closed '+setting,async()=>{
      const e=event('note.create',contact.id,{body:'must not write'});
      if(setting===undefined)delete process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
      else process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN=setting;
      const before=[calls.length,blob(),writes];
      try {
        assert.equal((await handler(e)).statusCode,403);
        assert.deepEqual([calls.length,blob(),writes],before);
      } finally {process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN=approvedOrigin;}
    });
  }
  for(const origin of [approvedOrigin,undefined,'https://wrong.example.invalid']){
    await check('unauthenticated retains 401 with Origin '+origin,async()=>{
      const e=event('note.create',contact.id,{body:'must not write'});
      e.headers=origin?{origin}:{};
      const before=[calls.length,blob(),writes];
      assert.equal((await handler(e)).statusCode,401);
      assert.deepEqual([calls.length,blob(),writes],before);
    });
  }
  await check('approved Origin reaches payload gate without upstream access',async()=>{
    const e=event('note.create',contact.id,{body:'must not write'});
    e.body='{';
    const before=[calls.length,blob(),writes];
    assert.equal((await handler(e)).statusCode,400);
    assert.deepEqual([calls.length,blob(),writes],before);
  });
  await check('capitalized Origin with consistent multi header writes note only',async()=>{
    const e=event('note.create',contact.id,{body:'origin fixture'});
    e.headers.Origin=e.headers.origin; delete e.headers.origin;
    e.multiValueHeaders={Origin:[approvedOrigin]};
    const before=calls.length;
    assert.equal((await handler(e)).statusCode,200);
    assert.deepEqual(calls.slice(before).filter(c=>c.method!=='GET'),
      [{pathname:'/contacts/'+contact.id+'/notes',method:'POST'}]);
  });

  await check('missing configuration fails closed', () => assert.throws(() => auth.appAuthConfig({})));
  await check('authorized application identity verifies', () => assert.equal(auth.requireAppWriter(event('', '', {})), 'brad@example.invalid'));
  await check('expired session refused', () => { const token = auth.issueAppSession('brad@example.invalid', process.env, Date.now() - 1000000).token; assert.throws(() => auth.requireAppWriter({ headers: { authorization: `Bearer ${token}` } })); });
  await check('voice audience refused even with valid app signature', () => {
    const crypto = require('node:crypto'); const parts = auth.issueAppSession('brad@example.invalid').token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url')); claims.aud = 'iaos-voice'; parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url'); parts[2] = crypto.createHmac('sha256', process.env.IAOS_APP_WRITE_SESSION_SECRET).update(parts.slice(0,2).join('.')).digest('base64url');
    assert.throws(() => auth.requireAppWriter({ headers: { authorization: `Bearer ${parts.join('.')}` } }));
  });
  await check('concurrent contact mutation refused until prior operation completes',async()=>{const release=await holdContactLock(contact.id);const before=writes;assert.equal((await handler(event('contact.propertyNotes',contact.id,{value:'blocked'}))).statusCode,409);assert.equal(writes,before);await release();});
  const googleClaims={iss:'https://accounts.google.com',aud:process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID,email:'brad@example.invalid',email_verified:true,exp:Math.floor(Date.now()/1000)+60};
  await check('Google-verified allowlisted application identity',async()=>assert.equal(await auth.googleAppIdentity('synthetic',async()=>reply(googleClaims)),'brad@example.invalid'));
  for(const [field,value] of [['aud','voice-client'],['email','other@example.invalid'],['email_verified',false],['iss','untrusted'],['exp',0]])await check('Google rejects invalid '+field,async()=>assert.rejects(()=>auth.googleAppIdentity('synthetic',async()=>reply({...googleClaims,[field]:value}))));
  const cases = [
    ['contact.lastCallAttempt', {value:'2026-09-18T01:00:00.000Z'}], ['contact.callback',{value:'2026-09-19T01:00:00.000Z'}],
    ['contact.propertyNotes',{value:'synthetic note'}], ['contact.arv',{value:250000}], ['contact.disposition',{value:'No Answer'}],
    ['contact.routing',{value:'Stay in Cold Outreach'}], ['contact.dispositionAt',{value:'2026-09-18T01:00:00.000Z'}], ['contact.occupancy',{value:'Vacant'}],
    ['contact.callLogResult',{value:'Spoke with Seller'}], ['contact.explicitCallback',{value:'2026-09-19T01:00:00.000Z'}],
    ['opportunity.askingPrice',{value:100000}], ['opportunity.arv',{value:250000}], ['opportunity.repairs',{value:25000}],
    ['opportunity.currentOffer',{value:110000}], ['opportunity.assignmentMode',{value:'Standard'}],
    ['opportunity.underwriting',{endBuyerMaxPrice:150000,sellerMAO:130000,assignmentMode:'Standard'}],
    ['note.create',{body:'synthetic operator note'}], ['task.complete',{taskId:task.id}],
  ];
  // Labels come from the governed model, not an invented fixture option.
  const mode = require('../src/lib/underwriting/resolver-types.ts').ASSIGNMENT_MODE_OPTIONS[0][0];
  cases.find(c=>c[0]==='opportunity.assignmentMode')[1].value=mode;
  cases.find(c=>c[0]==='opportunity.underwriting')[1].assignmentMode=mode;
  await check('an unreserved Current Offer write is refused before sending (outcome not_sent, nothing written)', async () => {
    const before = writes;
    const res = await handler(event('opportunity.currentOffer', opportunity.id, {value:110000}));
    assert.equal(res.statusCode, 409); assert.equal(JSON.parse(res.body).outcome, 'not_sent'); assert.equal(writes, before);
  });
  for(const [op,args] of cases) await check('retained '+op, async () => {
    let requestId = `v2-request-${++sequence}`;
    if (op === 'opportunity.currentOffer') await reserveOffer(requestId);
    // PR #126 stacked server PR: the Seller Call Follow-Up callback is reserved-only.
    if (op === 'contact.callback') await reserveFollowUpCallback(requestId);
    // PR #131: the call result is reserved-only (durable call-log ownership).
    if (op === 'contact.callLogResult') requestId = await reserveCallLog(args.value);
    const res=await handler(event(op, op.startsWith('opportunity.')||op.startsWith('contract.')?opportunity.id:contact.id,args,requestId)); assert.equal(res.statusCode,200,res.body); assert.notEqual(JSON.parse(res.body).confirmed,false);
  });
  // B14-12 recording-only call log: the operation-specific boundary.
  await check('call log: contact.callLogResult plans iaos_call_disposition only, for every call-log result', () => {
    assert.deepEqual(contracts.callLogResults, ['No Answer', 'Voicemail', 'Spoke with Seller', 'Follow Up', 'Not Interested', 'Incorrect Number']);
    for (const v of contracts.callLogResults) assert.deepEqual(contracts.planWrite('contact.callLogResult', { value: v }, config).fields.map((f) => f.id), [config.fields.callDisposition], v);
  });
  await check('call log: values outside the call-log list are refused', () => {
    for (const v of ['Requested Appointment', 'Do Not Call', '', 'spoke with seller', 'Long-Term Nurture']) assert.throws(() => contracts.planWrite('contact.callLogResult', { value: v }, config), undefined, JSON.stringify(v));
  });
  await check('call log: nothing can ride along (no routing, no timestamp, no extra key)', () => {
    assert.throws(() => contracts.planWrite('contact.callLogResult', { value: 'No Answer', routing: 'Long-Term Nurture' }, config));
    assert.throws(() => contracts.planWrite('contact.callLogResult', { value: 'No Answer', dispositionAt: '2026-10-02T00:00:00.000Z' }, config));
  });
  await check('explicit callback: the same two callback fields as contact.callback, set or clear, nothing else', () => {
    for (const value of ['2026-10-09T19:30:00.000Z', null]) {
      assert.deepEqual(contracts.planWrite('contact.explicitCallback', { value }, config).fields.map((f) => f.id), contracts.planWrite('contact.callback', { value }, config).fields.map((f) => f.id));
    }
    assert.throws(() => contracts.planWrite('contact.explicitCallback', { value: 'tomorrow' }, config));
    assert.throws(() => contracts.planWrite('contact.explicitCallback', { value: null, note: 'x' }, config));
  });
  // B14-12 Do Not Call, simplified (Brad, 2026-10-04): no reason, no note, no DNC write of any
  // kind. Brad sets Do Not Disturb in GHL itself; IAOS only reads it. The fixture above throws
  // on any PUT carrying dndSettings or dnd. A note shaped like the retired DNC note is now an
  // ordinary note: ghl-write applies no DND check to it.
  await check('Do Not Call: no DNC-specific note handling remains (the retired note text is an ordinary note; no DND read gates it)', async () => {
    const before = notes.length;
    const res = await handler(event('note.create', contact.id, { body: 'Do Not Call (recorded by Brad in IAOS): retired wording\nAt verification, GHL showed calls, SMS and email suppressed.' }));
    assert.equal(res.statusCode, 200, res.body);
    assert.notEqual(JSON.parse(res.body).by, 'iaos-dnc-not-held');
    assert.equal(notes.length, before + 1);
  });
  await check('contact.dnc no longer exists: refused as an unknown operation before any GHL call', async () => {
    const before = calls.length;
    const res = await handler(event('contact.dnc', contact.id, { confirm: 'DO_NOT_CALL' }));
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(calls.length, before);
  });
  await check('call log: the webhook list is unchanged and does not gain Spoke with Seller', () => {
    assert.deepEqual(contracts.dispositions, ['No Answer', 'Voicemail', 'Follow Up', 'Requested Appointment', 'Not Interested', 'Incorrect Number']);
  });
  await check('call log handler: an unreserved call result is refused before sending (not_sent, nothing written)', async () => {
    const before = writes;
    const res = await handler(event('contact.callLogResult', contact.id, { value: 'Not Interested' }));
    assert.equal(res.statusCode, 409); assert.equal(JSON.parse(res.body).outcome, 'not_sent'); assert.equal(writes, before);
  });
  await check('call log handler: the result lands; iaos_call_routing and iaos_disposition_at are not touched', async () => {
    const val = (id) => contact.customFields.find((f) => f.id === id)?.value;
    const before = { routing: val(config.fields.callRouting), at: val(config.fields.dispositionAt) };
    const requestId = await reserveCallLog('Not Interested');
    const res = await handler(event('contact.callLogResult', contact.id, { value: 'Not Interested' }, requestId));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(val(config.fields.callDisposition), 'Not Interested');
    assert.deepEqual({ routing: val(config.fields.callRouting), at: val(config.fields.dispositionAt) }, before);
  });
  await check('existing named operations keep their own rules (contact.disposition still refuses Spoke with Seller)', () => {
    assert.throws(() => contracts.planWrite('contact.disposition', { value: 'Spoke with Seller' }, config));
    assert.deepEqual(contracts.planWrite('contact.dispositionAt', { value: '2026-10-02T00:00:00.000Z' }, config).fields.map((f) => f.id), [config.fields.dispositionAt]);
  });
  const arvNote=require('../src/lib/arv-persist.ts').formatArvApprovalNote({kind:'approved',amount:250000,recommendedArv:250000,revision:3},{approvedAt:'2026-09-04T20:00:00.000Z',operator:'Brad Thompson',opportunityId:opportunity.id,evidenceState:'HIGH',reconciliationOutcome:'RECOMMENDED',acceptedCompCount:4,searchLevel:'STANDARD',source:{kind:'PROPSTREAM_COMPARABLE_CSV',version:'propstream-comparable-csv-v1',fileName:'synthetic.csv',importedAt:'2026-09-04T19:00:00.000Z'}});
  await check('retained ARV approval with existing Brad display name',async()=>{const res=await handler(event('note.create',contact.id,{body:arvNote}));assert.equal(res.statusCode,200,res.body);});
  await check('ARV ledger cannot claim a different amount',async()=>{const before=writes;assert.equal((await handler(event('note.create',contact.id,{body:arvNote.replace('Approved ARV: 250000','Approved ARV: 1')}))).statusCode,409);assert.equal(writes,before);});
  for(const [name,mutate,status] of [
    ['extra envelope field',r=>({...r,method:'PUT'}),400], ['arbitrary operation',r=>({...r,operation:'workflow.execute'}),400],
    ['extra field',r=>({...r,args:{value:'x',pipelineStageId:'injected'}}),400], ['path traversal',r=>({...r,targetId:'../other'}),400],
    ['wrong identity',r=>({...r,targetId:'other-contact'}),409],
  ]) await check('reject '+name,async()=>{const e=event('contact.propertyNotes',contact.id,{value:'x'});e.body=JSON.stringify(mutate(JSON.parse(e.body)));const before=writes;assert.equal((await handler(e)).statusCode,status);assert.equal(writes,before);});
  await check('unauthenticated request makes zero upstream calls',async()=>{const e=event('contact.propertyNotes',contact.id,{value:'x'});e.headers={};const before=calls.length;assert.equal((await handler(e)).statusCode,401);assert.equal(calls.length,before);});
  await check('malformed JSON makes zero upstream calls',async()=>{const e=event('',contact.id,{});e.body='{';const before=calls.length;assert.equal((await handler(e)).statusCode,400);assert.equal(calls.length,before);});
  await check('duplicate request refused before a second write',async()=>{const e=event('note.create',contact.id,{body:'replay fixture'});assert.equal((await handler(e)).statusCode,200);const before=writes;assert.equal((await handler(e)).statusCode,409);assert.equal(writes,before);});


  await check('partial write is explicit and never confirmed',async()=>{omitReadback=true;const res=await handler(event('opportunity.repairs',opportunity.id,{value:999}));assert.equal(JSON.parse(res.body).confirmed,false);omitReadback=false;});
  await check('duplicate readback field rejected',()=>assert.throws(()=>boundaryLib.fieldValue([{id:'x',value:1},{id:'x',value:1}],'x','contact')));
  await check('wrong field representation rejected',()=>assert.throws(()=>boundaryLib.fieldValue([{id:'x',fieldValueNumber:1}],'x','opportunity')));
  // INV-98 Board #9: GHL omits `customFields` on an opportunity with no custom values.
  const oppBoundary=(opp)=>new boundaryLib.GhlBoundary('offline-token',config.locationId,async(url)=>{
    const p=new URL(url).pathname;
    if(p===`/contacts/${contact.id}`)return reply({contact});
    if(p==='/opportunities/omitted-opp')return reply({opportunity:opp});
    throw new Error('Unexpected mocked request: '+p);
  });
  const omitted={id:'omitted-opp',contactId:contact.id,locationId:config.locationId};
  await check('opportunity read: omitted customFields is an empty field list, identity preserved',async()=>{
    const read=await oppBoundary(omitted).opportunity('omitted-opp');
    assert.deepEqual(read.customFields,[]);assert.equal(read.id,'omitted-opp');assert.equal(read.contactId,contact.id);assert.equal(read.locationId,config.locationId);
    assert.deepEqual(boundaryLib.fieldValue(read.customFields,config.opportunityFacts.arv,'opportunity'),{present:false,value:null});
  });
  for(const [label,opp] of [['wrong id',{...omitted,id:'other-opp'}],['wrong location',{...omitted,locationId:'other-location'}],['missing contactId',{id:omitted.id,locationId:config.locationId}],['non-string contactId',{...omitted,contactId:7}]])
    await check('opportunity read with omitted customFields still refuses '+label,()=>assert.rejects(oppBoundary(opp).opportunity('omitted-opp'),/Opportunity identity or field readback is ambiguous/));
  for(const [label,raw] of [['null',null],['an object',{}],['a string','x'],['a number',0],['false',false]])
    await check('opportunity read refuses customFields present as '+label,()=>assert.rejects(oppBoundary({...omitted,customFields:raw}).opportunity('omitted-opp'),/Opportunity identity or field readback is ambiguous/));
  await check('Production contract projection fails closed',()=>assert.throws(()=>contracts.planWrite('contract.projection',{entries:[{key:Object.keys(config.contractProjectionFields)[0],text:'synthetic'}],sellerCount:'One Seller'},getConfig('production'))));
  const fixture = require('./write-contract-fixture.cjs').contractFixture(name=>require('../src/lib/'+name+'.ts'), opportunity.id);
  Object.assign(contact,{firstName:'Jane',lastName:'Seller',email:'seller@example.com',address1:'123 Main St',city:'Austin',state:'TX',postalCode:'78701'});
  opportunity.customFields=opportunity.customFields.filter(f=>f.id!==config.opportunityFacts.currentOffer);
  opportunity.customFields.push({id:config.opportunityFacts.currentOffer,fieldValue:190000});
  // PR #126 stacked server PR: a negotiation-outcome note is sent only under a
  // reservation of its own kind (as the Seller Call page does), then reconciled.
  const parseOutcome = require('../src/lib/seller-call-outcome.ts').parseOutcomeNote;
  const barrierPost = (payload) => barrierHandler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify(payload) });
  for(const note of fixture.notes) await check('retained ledger '+note.body.split(' — ')[0],async()=>{
    const outcome = parseOutcome(note.body);
    let requestId;
    if (outcome) {
      await barrierPost({ action: 'reconcile', opportunityId: opportunity.id });
      const base = `v2-outcome-${++sequence}`;
      const steps = { accept: ['offer', 'note', 'touch'], pass: ['note', 'touch'], follow_up: ['callback', 'callback_note', 'touch', 'note'] }[outcome.kind].map((step) => ({ step, requestId: `${base}-${step}` }));
      const reserved = await barrierPost({ action: 'begin', opportunityId: opportunity.id, purpose: outcome.kind, steps });
      assert.equal(reserved.statusCode, 200, reserved.body);
      requestId = `${base}-note`;
    }
    const res=await handler(event('note.create',contact.id,{body:note.body},requestId));assert.equal(res.statusCode,200,res.body);
    if (outcome) assert.equal(JSON.parse((await barrierPost({ action: 'reconcile', opportunityId: opportunity.id })).body).state, 'clear');
  });
  const context = await require('../netlify/functions/lib/write-contract-context.ts').currentContractContext(boundaryLib.configuredBoundary(),opportunity.id);


  for (const environment of ['test', 'production']) {
    for (const [operation, args] of [
      ['contract.projection', {entries: context.projection.entries,
        sellerCount: context.sellerCount}],
      ['contract.draftRequest', {value: 'Requested'}],
      ['contract.draftRequest', {value: 'Idle'}],
    ]) await check('retired ' + operation + ' refused in ' + environment, async () => {
      process.env.IAOS_ENV = environment;
      const before = {calls: calls.length, writes, store: storeSnapshot().length};
      const response = await handler(event(operation, opportunity.id, args));
      assert.equal(response.statusCode, 400);
      assert.deepEqual({calls: calls.length, writes, store: storeSnapshot().length}, before);
      assert.throws(() => contracts.planWrite(operation, args, getConfig(environment)));
    });
  }
  process.env.IAOS_ENV = 'test';
  await check('canonical projection computation remains available',
    () => assert.equal(context.projection.ok, true));
  // Board #9 Phase B correction: the server now INDEPENDENTLY regenerates
  // the PDF from `context` to verify authorization currency (see
  // write-derived-note.ts / write-contract-context.ts), so a note claiming
  // a synthetic/fabricated artifact hash (the fixture's own placeholder)
  // can never pass. Build this note's claimed artifact facts from a REAL
  // regeneration against the same canonical context the server itself will
  // recompute, so this test still proves genuine end-to-end currency.
  const realArtifactFacts = await require('../netlify/functions/lib/write-contract-context.ts').currentGeneratedArtifactFacts(context);
  const realAuthorization = require('../src/lib/contract-authorization-model.ts').buildAuthorizationRecordArgs({opportunityId: opportunity.id, at: context.version.agreementAt, preview: context.preview, currentVersion: context.version, artifact: realArtifactFacts});
  assert.equal(realAuthorization.ok, true, JSON.stringify(realAuthorization));
  const authorization=require('../src/lib/contract-authorization-carriers.ts').formatBradContractAuthorizationNote(realAuthorization.value);
  await check('retained canonical Brad authorization',async()=>{const res=await handler(event('note.create',contact.id,{body:authorization}));assert.equal(res.statusCode,200,res.body);});
  await check('reject stale authorization content',async()=>{const before=writes;const res=await handler(event('note.create',contact.id,{body:authorization.replace('Jane Seller','Other Seller')}));assert.equal(res.statusCode,409);assert.equal(writes,before);});
  await check('freeze Current Offer after agreement',async()=>{const before=writes;const requestId=`v2-request-${++sequence}`;await reserveOffer(requestId);const res=await handler(event('opportunity.currentOffer',opportunity.id,{value:195000},requestId));assert.equal(res.statusCode,409);assert.equal(JSON.parse(res.body).error,'Current Offer is frozen or invalid');assert.equal(JSON.parse(res.body).outcome,'not_sent');assert.equal(writes,before);});
  const sync={opportunityId:opportunity.id,at:'2026-09-18T01:00:00.000Z',attemptId:'2026-09-18T01:00:00.000Z',operator:'brad',status:'in_progress',version:fixture.version,entriesAttempted:context.projection.entries.length,entriesLanded:context.projection.entries.length,failedKeys:[],currentOfferCrossCheckOk:true,observedStateBeforeWrite:'Idle',intendedToState:'Requested',sentValue:null,observedValue:null,providerStatus:null,failureReason:null,sellerSigningEvidence:{sellerCountDiscriminator:'one_seller',seller1Ok:true,seller1ContactId:contact.id,seller1Capacity:'individual_own_capacity',seller2LegalName:null,seller2NormalizedEmail:null,seller2Capacity:null,printedPartyConsistencyOk:true,expectedSellerCountTransportValue:'One Seller',canonicalReady:true,sellerCountFieldProvisioned:true,sellerCountWriteReadbackOk:true,effectiveDateStatus:'pending_final_acceptance',recipientAssignmentStatus:'pending_manual_review',blockingReasons:[],sendOccurred:false}};
  const syncBody=require('../src/lib/contract-projection-sync-carriers.ts').formatContractProjectionSyncNote(sync);
  await check('retained projection reservation note',async()=>{const res=await handler(event('note.create',contact.id,{body:syncBody}));assert.equal(res.statusCode,200,res.body);});


  const rawProxy=require('../netlify/functions/ghl-proxy.ts').handler;
  // Every allowlist check below runs WITH a valid read session, so it proves
  // the proxy's own boundary; read-auth itself is test-app-read-auth.cjs.
  const readAuth=require('../netlify/functions/lib/app-read-auth.ts');
  const readCookie=readAuth.READ_COOKIE+'='+readAuth.issueReadSession('brad@example.invalid',readAuth.appReadConfig()).token;
  const proxy=(input)=>rawProxy({...input,headers:{...(input.headers||{}),cookie:readCookie}});
  await check('proxy refuses a request with no read session before any GHL call',async()=>{const before=calls.length;const res=await rawProxy({httpMethod:'GET',queryStringParameters:{path:`/contacts/${contact.id}`}});assert.equal(res.statusCode,401);assert.equal(JSON.parse(res.body).by,'iaos-app-read-auth');assert.equal(calls.length,before);});
  await check('proxy refuses an application WRITE session as a read session',async()=>{const before=calls.length;const res=await rawProxy({httpMethod:'GET',headers:{authorization:`Bearer ${auth.issueAppSession('brad@example.invalid').token}`},queryStringParameters:{path:`/contacts/${contact.id}`}});assert.equal(res.statusCode,401);assert.equal(calls.length,before);});
  for(const method of ['POST','PUT','PATCH','DELETE'])await check('generic proxy refuses '+method,async()=>{const before=calls.length;assert.equal((await proxy({httpMethod:method,queryStringParameters:{path:`/contacts/${contact.id}`},body:'{}'})).statusCode,403);assert.equal(calls.length,before);});
  // Encoding metadata alone never turns a bodyless GET into a write.
  for (const suffix of ['', '/notes']) {
    const pathname = '/contacts/' + contact.id + suffix;
    const base = {httpMethod:'GET', queryStringParameters:{path:pathname}};
    for (const body of [undefined, null, '']) {
      for (const flag of [undefined, false, true]) {
        await check('proxy GET ' + suffix + ' empty=' + String(body) +
          ' encoded=' + String(flag), async () => {
          const before = {calls:calls.length, writes, blobCalls: blob()};
          const input = {...base};
          if (body !== undefined) input.body = body;
          if (flag !== undefined) input.isBase64Encoded = flag;
          const result = await proxy(input);
          assert.equal(result.statusCode, 200, result.body);
          assert.deepEqual(calls.slice(before.calls),
            [{pathname, method:'GET'}]);
          assert.equal(writes, before.writes);
          assert.equal(blob(), before.blobCalls);
        });
      }
    }
    async function refused(label, extra) {
      await check('proxy refuses ' + suffix + ' ' + label, async () => {
        const before = {calls:calls.length, writes, blobCalls: blob()};
        const result = await proxy({...base, ...extra});
        assert.equal(result.statusCode, 403, result.body);
        assert.equal(JSON.parse(result.body).by, 'iaos-proxy-allowlist');
        assert.deepEqual({calls:calls.length, writes, blobCalls: blob()}, before);
      });
    }
    for (const body of ['{}', ' ', 'e30=', 'AA==', 0, false, {}, []]) {
      for (const flag of [false, true]) {
        await refused('body=' + JSON.stringify(body) + ' encoded=' + flag,
          {body, isBase64Encoded:flag});
      }
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      for (const flag of [false, true]) {
        await refused(method + ' empty encoded=' + flag,
          {httpMethod:method, body:'', isBase64Encoded:flag});
      }
    }
    for (const key of ['method', 'body', 'locationId']) {
      await refused('extra query ' + key,
        {queryStringParameters:{path:pathname, [key]:'unexpected'}});
    }
    for (const key of ['locationId', 'location_id', 'locationid']) {
      await refused('foreign location ' + key,
        {queryStringParameters:{path:pathname + '?' + key + '=foreign'}});
    }
    await refused('path suffix',
      {queryStringParameters:{path:pathname + '/forbidden'}});
  }
  for (const pathname of ['/proposals/templates/send', '/contacts/x/tasks']) {
    await check('proxy keeps path retired/disallowed ' + pathname, async () => {
      const before = {calls:calls.length, writes, blobCalls: blob()};
      const result = await proxy({httpMethod:'GET', body:'',
        isBase64Encoded:true, queryStringParameters:{path:pathname}});
      assert.equal(result.statusCode, 403);
      assert.deepEqual({calls:calls.length, writes, blobCalls: blob()}, before);
    });
  }
  const {requireWebhook}=require('../netlify/functions/lib/write-webhook-auth.ts');
  await check('root webhook does not inherit app session',()=>assert.throws(()=>requireWebhook(event('', '', {}),'IAOS_PHONE_LOOKUP_WEBHOOK_SECRET')));
  await check('root webhook exact dedicated secret accepted',()=>{requireWebhook({headers:{'x-iaos-secret':'offline-webhook-fixture-only-long-secret'}},'IAOS_PHONE_LOOKUP_WEBHOOK_SECRET',{IAOS_PHONE_LOOKUP_WEBHOOK_SECRET:'offline-webhook-fixture-only-long-secret'});});

  // ============================================================
  // Gate-review closure -- PR #85 live failure. ghl-executed-artifact-
  // upload.ts's own Netlify Blobs initialization, proven against the
  // REAL @netlify/blobs SDK's connectLambda/getStore (the SAME mock this
  // file already uses to prove ghl-write.ts's own Lambda-context
  // handling above -- getStore() here calls the real SDK's getStore for
  // its validation side effect before returning the fixture store, so a
  // missing/malformed Lambda Blobs context genuinely throws exactly as
  // it would in the real Netlify runtime).
  // ============================================================
  {
    const uploadVersion = { agreementAt: '2026-09-06T15:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };
    const uploadPdfBytes = Buffer.from('%PDF-1.4\n' + 'B'.repeat(200) + '\n%%EOF');
    const uploadExpectedFullSha256 = require('node:crypto').createHash('sha256').update(uploadPdfBytes).digest('hex');
    function uploadEvent(body, overrides = {}) {
      return {
        blobs: lambdaBlobs, httpMethod: 'POST',
        headers: { ...lambdaHeaders, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` },
        body: JSON.stringify(body),
        ...overrides,
      };
    }

    /* Storage correction: connectLambda no longer exists (modern runtime). The ordering this source pin
       protected -- the store is initialized from a valid platform context, and only after the request's
       gate -- is restated: no connectLambda/raw getStore( remains, both upload stores are opened through
       the verified adapter, and only after the write gate is entered. */
    await check('artifact upload source: stores are opened through the verified adapter, after the write gate, never raw getStore/connectLambda', () => {
      const src = fs.readFileSync(path.join(APP, 'netlify/functions/ghl-executed-artifact-upload.ts'), 'utf8');
      assert.equal(src.indexOf('connectLambda('), -1, 'connectLambda is gone');
      assert.equal(src.indexOf('getStore('), -1, 'no raw getStore( in the handler');
      const gateIdx = src.indexOf('await inv.gate.enter(');
      const firstStoreIdx = src.indexOf('new VerifiedStore(inv.scope, UPLOADS_STORE)');
      assert.notEqual(gateIdx, -1, 'the write gate must be entered in the handler');
      assert.notEqual(firstStoreIdx, -1, 'the uploads store must be opened through the verified adapter');
      assert.ok(src.indexOf('new VerifiedStore(inv.scope, ARTIFACTS_STORE)') !== -1, 'the artifacts store must be opened through the verified adapter');
      assert.equal(gateIdx < firstStoreIdx, true, 'the write gate must be entered before the first upload store is opened');
    });

    await check('artifact upload: chunk 0 succeeds under a genuinely valid Lambda-compatible environment (real connectLambda + real getStore validation, never only a mocked store)', async () => {
      const before = compat.wire.log.length;
      const res = await uploadHandler(uploadEvent({
        phase: 'chunk', opportunityId: opportunity.id, agreementAt: uploadVersion.agreementAt, version: uploadVersion,
        uploadId: 'boundary-upload-1', chunkIndex: 0, chunkCount: 1, totalByteCount: uploadPdfBytes.length,
        originalFileName: 'executed.pdf', expectedFullSha256: uploadExpectedFullSha256, chunkBase64: uploadPdfBytes.toString('base64'),
      }));
      assert.equal(res.statusCode, 200, res.body);
      /* Storage correction: "connectLambda was invoked" -> the real SDK actually stored the chunk in the uploads store on the wire. */
      assert.ok(compat.wire.log.slice(before).some((r) => r.store === 'site:iaos-executed-artifact-uploads' && r.method === 'PUT'), 'the chunk was stored through the real SDK');
    });

    await check('artifact upload: a missing Lambda Blobs context on chunk 0 is refused safely (503 storage; was 409) -- never an uncaught crash/502, and no chunk is stored', async () => {
      const e = uploadEvent({
        phase: 'chunk', opportunityId: opportunity.id, agreementAt: uploadVersion.agreementAt, version: uploadVersion,
        uploadId: 'boundary-upload-missing-context', chunkIndex: 0, chunkCount: 1, totalByteCount: uploadPdfBytes.length,
        originalFileName: 'executed.pdf', expectedFullSha256: uploadExpectedFullSha256, chunkBase64: uploadPdfBytes.toString('base64'),
      });
      const goodCtx = process.env.NETLIFY_BLOBS_CONTEXT;
      delete process.env.NETLIFY_BLOBS_CONTEXT;
      const beforeLog = compat.wire.log.length;
      const originalConsoleError = console.error;
      const logCalls = [];
      console.error = (...args) => { logCalls.push(args); };
      let res;
      try {
        res = await uploadHandler(e);
      } finally {
        console.error = originalConsoleError;
        process.env.NETLIFY_BLOBS_CONTEXT = goodCtx;
      }
      /* Storage correction: was 409 "Write refused or unconfirmed" with one [ghl-executed-artifact-upload]
         log. In v2 every storing phase enters the write gate first; with no platform blob context its
         authorization records are unreadable, so the chunk is REFUSED 503 storage-unavailable (a gate
         refusal, not a caught error, so the per-upload error log is not reached). Still never a crash/502,
         still nothing stored, and the only diagnostics are the structural storage lines, which carry no
         chunk bytes and no credential. */
      assert.equal(res.statusCode, 503, res.body);
      assert.deepEqual(JSON.parse(res.body), { code: 'storage', error: 'Saving is unavailable: the save records could not be read' });
      assert.equal(compat.wire.log.slice(beforeLog).filter((r) => r.method === 'PUT').length, 0, 'no chunk is stored');
      assert.ok(logCalls.length >= 1, 'the refusal is diagnosable');
      for (const [prefix] of logCalls) assert.equal(prefix, '[iaos-storage]');
      const serialized = JSON.stringify(logCalls);
      assert.equal(serialized.includes(uploadPdfBytes.toString('base64')), false, 'chunk bytes are never logged');
      assert.equal(serialized.toLowerCase().includes('bearer'), false, 'no token/credential is ever logged');
    });
  }

  console.log(`${count} offline boundary checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1;});
