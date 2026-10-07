/**
 * INV-98 Board #9 Production regression -- the Under Contract stage marker
 * and Blob read consistency.
 *
 * Production failure (Sep 30, request 0f843a0d-...): ghl-write's
 * `stageTransitionUnresolved` asked @netlify/blobs for a strong read, and
 * the SDK refused with BlobsConsistencyError because `connectLambda(event)`
 * never supplies an `uncachedEdgeURL`. The pre-v2 repair fell back to an
 * EVENTUAL read for that one error.
 *
 * Storage correction (PR #131 plan v6 §2, §4): the eventual fallback is
 * REMOVED. ghl-write is a modern-runtime function (the platform supplies an
 * uncachedEdgeURL), the marker is stage marker v2 in `iaos-ownership-v2`, and
 * its read is STRONG through the verified adapter: an unavailable strong read
 * fails closed (throws), never "no marker". This suite keeps the Production
 * reproduction (characterization of the SDK) and restates the rest for v2.
 *
 * Real SDK, network mocked by the wire harness. It never calls a deployed endpoint.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
const { createWire } = require('./harness/blob-wire.cjs');
const APP = path.resolve(__dirname, '..');
process.env.IAOS_ENV = 'test';
const wire = createWire({ ownershipStores: ['site:iaos-ownership-v2'] });
global.fetch = wire.fetch;
const blobs = require('@netlify/blobs');
const vs = require('../netlify/functions/lib/verified-store.ts');
vs.transport.fetch = wire.fetch;
const { InvocationScope } = require('../netlify/functions/lib/invocation-scope.ts');
const sm = require('../netlify/functions/lib/stage-marker-v2.ts');
const { getConfig } = require('../shared/ghl-config.ts');

let checks = 0, failures = 0;
async function check(name, fn) {
  checks++;
  try { await fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + ' -- ' + (e && e.message)); }
}
const OPPORTUNITY = 'fixture-opportunity-stage-marker';
const markerKey = sm.stageMarkerKey('test', getConfig('test').locationId, OPPORTUNITY);
const modernCtx = JSON.parse(Buffer.from(wire.context(), 'base64').toString());
const lambdaCtx = JSON.parse(Buffer.from(wire.lambdaContext(), 'base64').toString());
const store = (ctx = modernCtx) => new vs.VerifiedStore(new InvocationScope('ghl-write'), vs.OWNERSHIP_STORE, ctx);

(async () => {
  await check('the real SDK under a Lambda context (no uncachedEdgeURL) refuses a strong read with BlobsConsistencyError (reproduces Production)', async () => {
    const before = wire.log.length;
    const s = blobs.getStore({ name: 'iaos-write-receipts', siteID: wire.SITE, token: 't', edgeURL: wire.EDGE });
    await assert.rejects(s.get(markerKey, { type: 'json', consistency: 'strong' }), (e) => e && e.name === 'BlobsConsistencyError' && /uncachedEdgeURL/.test(e.message));
    assert.equal(wire.log.length, before, 'the SDK refuses before any request');
  });
  await check('v2: under a Lambda context the marker read FAILS CLOSED (throws) -- never an eventual read, never "no marker"', async () => {
    const before = wire.log.length;
    await assert.rejects(sm.stageMarkerUnresolved(store(lambdaCtx), markerKey), (e) => e instanceof vs.StrongReadUnavailable);
    assert.equal(wire.log.length, before);
  });
  await check('v2: no marker -> false, via ONE strong read on the uncached origin', async () => {
    wire.clear();
    assert.equal(await sm.stageMarkerUnresolved(store(), markerKey), false);
    assert.equal(wire.log.length, 1); assert.equal(wire.log[0].origin, 'uncached'); assert.equal(wire.log[0].method, 'GET');
  });
  await check('v2: an unresolved marker -> true (a held marker still refuses); a resolved one -> false', async () => {
    wire.clear();
    wire.seed(vs.OWNERSHIP_STORE, markerKey, { v: 2, state: 'unresolved', attemptHash: 'h', claimedAt: '2026-09-30T13:58:03.000Z' });
    assert.equal(await sm.stageMarkerUnresolved(store(), markerKey), true);
    wire.seed(vs.OWNERSHIP_STORE, markerKey, { v: 2, state: 'resolved', attemptHash: 'h', resolvedAt: 'x' });
    assert.equal(await sm.stageMarkerUnresolved(store(), markerKey), false);
  });
  await check('v2: any other Blob failure throws (never read as "no marker")', async () => {
    wire.clear();
    wire.on(wire.get(vs.OWNERSHIP_STORE), wire.status(401), 9);
    await assert.rejects(sm.stageMarkerUnresolved(store(), markerKey), (e) => e instanceof vs.StorageUncertain);
  });
  await check('source: no eventual fallback anywhere -- the marker read is strong only', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'stage-marker-v2.ts'), 'utf8');
    assert.ok(!/BlobsConsistencyError/.test(src));
    assert.ok(!/consistency:\s*"eventual"/.test(fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'verified-store.ts'), 'utf8')));
  });
  await check('source: ghl-write reads the marker (strongly) only after the write gate, before any GHL call', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'ghl-write.ts'), 'utf8');
    const gateAt = src.indexOf('await inv.gate.enter(');
    const markerAt = src.indexOf('stageMarkerUnresolved(store, markerKey)');
    const boundaryAt = src.indexOf('const boundary = boundaryFor(inv);');
    assert.ok(gateAt !== -1 && markerAt !== -1 && boundaryAt !== -1 && gateAt < markerAt && markerAt < boundaryAt);
    assert.ok(!/connectLambda/.test(src));
  });
  console.log('');
  console.log('stage-marker-blob-consistency checks=' + checks + ' failures=' + failures);
  console.log('Offline only: real @netlify/blobs SDK, mocked network; no deployed endpoint, GHL or Blob store was contacted.');
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
