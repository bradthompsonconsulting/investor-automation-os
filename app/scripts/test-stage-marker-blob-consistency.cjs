/**
 * INV-98 Board #9 Production regression -- the Under Contract stage marker
 * read under a REAL Lambda-compatibility Blob context.
 *
 * Production failure (Sep 30, request 0f843a0d-...): ghl-write's
 * `stageTransitionUnresolved` asked @netlify/blobs for a strong read, and
 * the SDK refused with BlobsConsistencyError because `connectLambda(event)`
 * never supplies an `uncachedEdgeURL`. Every other suite replaces the SDK
 * with an in-memory store that ignores `consistency`, so it never ran.
 *
 * This suite uses the REAL SDK and the REAL connectLambda; only the network
 * (global.fetch) is mocked. It never calls a deployed endpoint.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText,
    filename,
  );

process.env.IAOS_ENV = 'test';
delete process.env.NETLIFY_BLOBS_CONTEXT;

const blobs = require('@netlify/blobs');
const receipts = require('../netlify/functions/lib/write-receipts.ts');

let checks = 0, failures = 0;
async function check(name, fn) {
  checks++;
  try { await fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + ' -- ' + (e && e.message)); }
}

// The Lambda-compatibility event shape Netlify gives a v1 `handler`.
const lambdaEvent = {
  blobs: Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64'),
  headers: { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' },
};

const OPPORTUNITY = 'fixture-opportunity-stage-marker';
const markerKey = receipts.stageTransitionMarkerKey(OPPORTUNITY);
let stored = new Map();
let requests = [];
let failWith = null;
global.fetch = async (url, init = {}) => {
  const u = new URL(url);
  requests.push({ origin: u.origin, path: u.pathname, method: (init.method || 'GET').toLowerCase() });
  assert.equal(u.origin, 'https://blobs.example.invalid', 'no external network');
  if (failWith) return new Response('refused', { status: failWith });
  const key = [...stored.keys()].find((k) => decodeURIComponent(u.pathname).endsWith('/' + k));
  return key ? new Response(JSON.stringify(stored.get(key)), { status: 200 }) : new Response('not found', { status: 404 });
};

(async () => {
  blobs.connectLambda(lambdaEvent);

  await check('the real SDK under connectLambda refuses a strong read with BlobsConsistencyError (reproduces Production)', async () => {
    requests = [];
    await assert.rejects(
      blobs.getStore('iaos-write-receipts').get(markerKey, { type: 'json', consistency: 'strong' }),
      (e) => e && e.name === 'BlobsConsistencyError' && /uncachedEdgeURL/.test(e.message),
    );
    assert.equal(requests.length, 0, 'the SDK refuses before any request');
  });

  await check('stageTransitionUnresolved: no marker -> false, via one default-consistency read (no throw)', async () => {
    stored = new Map(); requests = [];
    assert.equal(await receipts.stageTransitionUnresolved(OPPORTUNITY), false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'get');
  });

  await check('stageTransitionUnresolved: marker present -> true (a held marker still refuses)', async () => {
    stored = new Map([[markerKey, { kind: 'under-contract-stage-transition', claimedAt: '2026-09-30T13:58:03.000Z' }]]); requests = [];
    assert.equal(await receipts.stageTransitionUnresolved(OPPORTUNITY), true);
  });

  await check('stageTransitionUnresolved: any other Blob failure still throws (never read as "no marker")', async () => {
    stored = new Map(); failWith = 401;
    try { await assert.rejects(receipts.stageTransitionUnresolved(OPPORTUNITY), (e) => e && e.name !== 'BlobsConsistencyError'); }
    finally { failWith = null; }
  });

  await check('source: the fallback is taken ONLY for BlobsConsistencyError, and the strong read is still tried first', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'write-receipts.ts'), 'utf8');
    const body = src.slice(src.indexOf('export async function stageTransitionUnresolved'), src.indexOf('export async function claimStageTransition'));
    assert.match(body, /consistency: "strong"/);
    assert.match(body, /if \(e\?\.name !== "BlobsConsistencyError"\) throw e;/);
  });

  await check('source: ghl-write connects the Lambda Blob context before the marker read', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'ghl-write.ts'), 'utf8');
    const connectAt = src.indexOf('connectLambda(event)');
    const markerAt = src.indexOf('stageTransitionUnresolved(request.targetId)');
    assert.ok(connectAt !== -1 && markerAt !== -1 && connectAt < markerAt);
  });

  console.log('');
  console.log('stage-marker-blob-consistency checks=' + checks + ' failures=' + failures);
  console.log('Offline only: real @netlify/blobs SDK, mocked network; no deployed endpoint, GHL or Blob store was contacted.');
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
