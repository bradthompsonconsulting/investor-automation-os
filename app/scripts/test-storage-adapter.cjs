/**
 * Storage correction (PR #131 plan v6 §2, §14) -- SDK characterization and the
 * verified storage adapter, over the wire harness with the REAL
 * @netlify/blobs 11.1.0 client. Offline.
 *
 * Characterization cases pin the faulty SDK behavior the adapter exists for
 * (F1, F2). If an SDK upgrade changes it, these fail and the adapter is
 * re-reviewed.
 */
'use strict';
process.env.NODE_ENV = 'test';   // the SDK's own retry sleep becomes 1 ms (read at import)
const assert = require('node:assert/strict');
require('./harness/ts-loader.cjs');
const { check, done } = require('./harness/check.cjs');
const { createWire } = require('./harness/blob-wire.cjs');
const blobs = require('@netlify/blobs');
const wire = createWire({ ownershipStores: ['site:iaos-ownership-v2'] });
global.fetch = wire.fetch;
process.env.NETLIFY_BLOBS_CONTEXT = wire.context();
const vs = require('../netlify/functions/lib/verified-store.ts');
const scopeLib = require('../netlify/functions/lib/invocation-scope.ts');
vs.transport.fetch = wire.fetch;
const S = 'iaos-ownership-v2';
const rawStore = (name = S) => blobs.getStore({ name, siteID: wire.SITE, token: 't', edgeURL: wire.EDGE, uncachedEdgeURL: wire.UNCACHED });
const scope = (fn = 'ghl-write') => new scopeLib.InvocationScope(fn);
const store = (sc = scope()) => new vs.VerifiedStore(sc, S);
const putCount = () => wire.count((e) => e.method === 'PUT');
async function rejectsUncertain(p, cls) {
  await assert.rejects(p, (e) => e instanceof vs.StorageUncertain && (cls === undefined || e.cls === cls));
}
function fresh() { wire.clear(); }

(async () => {
  // ── Characterization of the pinned SDK (F1, F2) ─────────────────────────────
  assert.equal(require('@netlify/blobs/package.json').version, '11.1.0', 'SDK pinned exactly');
  for (const status of [401, 403]) {
    await check(`CH-1 SDK: a conditional setJSON answered ${status} reports modified:true (the F1 defect)`, async () => {
      fresh();
      wire.on(wire.put(S), wire.status(status));
      const r = await rawStore().setJSON('k', { a: 1 }, { onlyIfNew: true });
      assert.equal(r.modified, true);
      assert.equal(wire.json(S, 'k'), null, 'nothing was written');
    });
  }
  await check('CH-2 SDK: an exhausted 503 is retried 5 more times with the same headers, then reports modified:true', async () => {
    fresh();
    wire.on(wire.put(S), wire.status(503), 99);
    const r = await rawStore().setJSON('k', { a: 1 }, { onlyIfNew: true });
    assert.equal(r.modified, true);
    assert.equal(putCount(), 6);
  });
  await check('CH-3 SDK: a thrown fetch is retried (no AbortSignal is passed)', async () => {
    fresh();
    let signals = 0;
    const realFetch = global.fetch;
    global.fetch = async (u, init) => { if (init && init.signal) signals++; return realFetch(u, init); };
    wire.on(wire.put(S), wire.reset(), 2);
    try { await rawStore().setJSON('k', { a: 1 }, { onlyIfNew: true }); } finally { global.fetch = realFetch; }
    assert.equal(putCount(), 3);
    assert.equal(signals, 0);
  });
  await check('CH-4 SDK: a 412 is the only modified:false', async () => {
    fresh();
    await rawStore().setJSON('k', { a: 1 }, { onlyIfNew: true });
    const r = await rawStore().setJSON('k', { a: 2 }, { onlyIfNew: true });
    assert.equal(r.modified, false);
  });
  await check('CH-5 SDK: delete is unconditional and retried (F2)', async () => {
    fresh();
    wire.seed(S, 'k', { a: 1 });
    wire.on((req) => req.method === 'DELETE', wire.status(503), 2);
    await rawStore().delete('k');
    assert.equal(wire.count((e) => e.method === 'DELETE'), 3);
    assert.equal(wire.json(S, 'k'), null);
  });
  await check('CH-6 L1-sdk: a delayed raw delete from A removes B\'s newer lock (why v2 never deletes)', async () => {
    fresh();
    wire.seed(S, 'lock/x', { holder: 'A' });
    wire.on((req) => req.method === 'DELETE', wire.before(async () => { wire.seed(S, 'lock/x', { holder: 'B' }); }));
    await rawStore().delete('lock/x');
    assert.equal(wire.json(S, 'lock/x'), null, 'B\'s lock is gone');
  });
  await check('CH-7 SDK: a strong read without uncachedEdgeURL throws BlobsConsistencyError (Lambda context)', async () => {
    fresh();
    const s = blobs.getStore({ name: S, siteID: wire.SITE, token: 't', edgeURL: wire.EDGE });
    await assert.rejects(s.get('k', { consistency: 'strong' }), (e) => e.name === 'BlobsConsistencyError');
  });
  await check('CH-8 SDK: a malformed edge URL throws TypeError before any fetch', async () => {
    fresh();
    const s = blobs.getStore({ name: S, siteID: wire.SITE, token: 't', edgeURL: 'not a url', uncachedEdgeURL: 'not a url' });
    await assert.rejects(s.get('k', { consistency: 'strong' }), (e) => e instanceof TypeError);
    assert.equal(wire.log.length, 0);
  });

  // ── The adapter ────────────────────────────────────────────────────────────
  await check('AD-1 a single 200 with an etag is the only "written"', async () => {
    fresh();
    const r = await store().createOnce('k', { a: 1 });
    assert.equal(r.result, 'written');
    assert.ok(r.etag);
    assert.deepEqual(wire.json(S, 'k'), { a: 1 });
  });
  await check('AD-2 a clean 412 with no ambiguous attempt before it is "conflict"', async () => {
    fresh();
    wire.seed(S, 'k', { a: 0 });
    assert.equal((await store().createOnce('k', { a: 1 })).result, 'conflict');
  });
  for (const status of [401, 403]) {
    await check(`AD-3 ${status} on a conditional write throws StorageUncertain (auth_refused), one fetch, no retry`, async () => {
      fresh();
      wire.on(wire.put(S), wire.status(status), 9);
      await rejectsUncertain(store().createOnce('k', { a: 1 }), 'auth_refused');
      assert.equal(putCount(), 1);
    });
  }
  await check('AD-4 exhausted 5xx: one fetch per SDK call, at most 2 adapter retries, then StorageUncertain', async () => {
    fresh();
    wire.on(wire.put(S), wire.status(503), 99);
    await rejectsUncertain(store().createOnce('k', { a: 1 }), 'server_error');
    assert.equal(putCount(), 3);
  });
  await check('AD-5 a 60 s rate limit never makes the SDK sleep: one fetch per SDK call', async () => {
    fresh();
    wire.on(wire.put(S), wire.rateLimit(Math.floor(Date.now() / 1000) + 60), 99);
    const t0 = Date.now();
    await rejectsUncertain(store().createOnce('k', { a: 1 }), 'rate_limited');
    assert.ok(Date.now() - t0 < 2_000, 'no 60 s sleep');
    assert.equal(putCount(), 3);
  });
  await check('AD-6 applied-then-ack-lost: the retry sees 412 after an ambiguous attempt -> uncertain, never "written" or "conflict"', async () => {
    fresh();
    wire.on(wire.put(S), wire.ackLost());
    await rejectsUncertain(store().createOnce('k', { a: 1 }), 'ack_ambiguous');
    assert.deepEqual(wire.json(S, 'k'), { a: 1 }, 'it did apply');
  });
  await check('AD-7 a 5xx then a 200 on the retry is "written" (the condition proves the first did not apply)', async () => {
    fresh();
    wire.on(wire.put(S), wire.status(503));
    assert.equal((await store().createOnce('k', { a: 1 })).result, 'written');
  });
  await check('AD-8 a hang is aborted at the 2 s request timeout -> uncertain (deadline class)', async () => {
    fresh();
    wire.on(wire.put(S), wire.hang(), 1);
    const sc = scope();
    // only one attempt fits: shrink the cutoff so no retry is attempted
    sc.deadlines.work = Date.now() + 2_100;
    const t0 = Date.now();
    await rejectsUncertain(new vs.VerifiedStore(sc, S).createOnce('k', { a: 1 }), 'deadline');
    assert.ok(Date.now() - t0 < 3_000);
  });
  await check('AD-9 a closed scope or a passed cutoff: zero I/O, uncertain', async () => {
    fresh();
    const sc = scope(); sc.close();
    await rejectsUncertain(new vs.VerifiedStore(sc, S).createOnce('k', { a: 1 }));
    const sc2 = scope(); sc2.deadlines.work = Date.now() - 1;
    await rejectsUncertain(new vs.VerifiedStore(sc2, S).createOnce('k', { a: 1 }));
    assert.equal(wire.log.length, 0);
  });
  await check('AD-10 strong reads: only a real 200/404 on the uncached origin counts', async () => {
    fresh();
    wire.seed(S, 'k', { a: 1 });
    const r = await store().read('k');
    assert.deepEqual(r.data, { a: 1 });
    assert.ok(r.etag);
    assert.equal(await store().read('missing'), null);
    assert.ok(wire.log.every((e) => e.origin === 'uncached'));
    assert.equal(wire.violations.length, 0);
  });
  await check('AD-11 a Lambda context (no uncachedEdgeURL): StrongReadUnavailable, zero fetches, never an eventual fallback', async () => {
    fresh();
    const ctx = JSON.parse(Buffer.from(wire.lambdaContext(), 'base64').toString());
    await assert.rejects(new vs.VerifiedStore(scope(), S, ctx).read('k'), (e) => e instanceof vs.StrongReadUnavailable);
    assert.equal(wire.log.length, 0);
  });
  await check('AD-12 a read answered 403 / 5xx-exhausted / reset is uncertain', async () => {
    fresh();
    wire.on(wire.get(S), wire.status(403));
    await rejectsUncertain(store().read('k'), 'auth_refused');
    wire.on(wire.get(S), wire.status(500), 3);
    await rejectsUncertain(store().read('k'), 'server_error');
    wire.on(wire.get(S), wire.reset(), 3);
    await rejectsUncertain(store().read('k'), 'transport');
  });
  await check('AD-13 writeOnceVerified after an ack-lost create reads the SAME key back and accepts identical content', async () => {
    fresh();
    wire.on(wire.put(S), wire.ackLost());
    const got = await store().writeOnceVerified('k', { a: 1 }, (g) => g.a === 1);
    assert.deepEqual(got, { a: 1 });
  });
  await check('AD-14 writeOnceVerified: different existing content -> RecordMismatch; missing after uncertainty -> uncertain', async () => {
    fresh();
    wire.seed(S, 'k', { a: 2 });
    await assert.rejects(store().writeOnceVerified('k', { a: 1 }, (g) => g.a === 1), (e) => e instanceof vs.RecordMismatch);
    wire.on(wire.put(S), wire.status(503), 3);
    await rejectsUncertain(store().writeOnceVerified('k2', { a: 1 }, (g) => g.a === 1));
  });
  await check('AD-15 the BarrierStore shim: modified:true only when validated, false on a clean conflict, throws otherwise; no unconditional write; no delete', async () => {
    fresh();
    const s = store();
    assert.deepEqual((await s.setJSON('k', { a: 1 }, { onlyIfNew: true })).modified, true);
    assert.deepEqual((await s.setJSON('k', { a: 1 }, { onlyIfNew: true })).modified, false);
    wire.on(wire.put(S), wire.status(401));
    await rejectsUncertain(s.setJSON('k2', { a: 1 }, { onlyIfNew: true }));
    await rejectsUncertain(s.setJSON('k3', { a: 1 }));
    assert.equal(typeof s.delete, 'undefined');
  });
  await check('AD-16 compare-and-swap: a stale etag loses with "conflict"', async () => {
    fresh();
    const s = store();
    await s.createOnce('h', { v: 1 });
    const a = await s.read('h');
    await s.cas('h', { v: 2 }, a.etag);
    assert.equal((await s.cas('h', { v: 3 }, a.etag)).result, 'conflict');
    assert.deepEqual(wire.json(S, 'h'), { v: 2 });
  });
  await check('AD-17 a malformed context: zero fetches, uncertain (never "configured" as proof)', async () => {
    fresh();
    const s = new vs.VerifiedStore(scope(), S, { edgeURL: 'not a url', uncachedEdgeURL: 'not a url', siteID: 'x', token: 'y' });
    assert.equal(s.configured, false);
    await assert.rejects(s.read('k'));
    await assert.rejects(s.createOnce('k', {}));
    assert.equal(wire.log.length, 0);
  });
  await check('AD-18 no ownership record is ever deleted: the ONE delete is discardPendingChunk, refused for the ownership store and for any key that is not a pending upload chunk', async () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../netlify/functions/lib/verified-store.ts'), 'utf8');
    assert.equal((src.match(/\.delete\s*\(/g) || []).length, 1);
    assert.ok(/async discardPendingChunk[\s\S]*?this\.name !== UPLOADS_STORE[\s\S]*?s\.delete\(key\)/.test(src));
    fresh();
    wire.seed(S, 'sessions/o/v/u/chunk-0', { x: 1 });
    assert.equal(await store().discardPendingChunk('sessions/o/v/u/chunk-0'), false, 'ownership store: refused');
    const up = new vs.VerifiedStore(scope(), vs.UPLOADS_STORE);
    wire.seed(vs.UPLOADS_STORE, 'authz/admission', { x: 1 });
    assert.equal(await up.discardPendingChunk('authz/admission'), false, 'not a pending chunk key: refused');
    wire.seed(vs.UPLOADS_STORE, 'sessions/o/v/u/chunk-0', { x: 1 });
    assert.equal(await up.discardPendingChunk('sessions/o/v/u/chunk-0'), true);
    assert.equal(wire.count((e) => e.method === 'DELETE' && e.store === 'site:' + S), 0);
  });
  done('storage adapter');
})();
