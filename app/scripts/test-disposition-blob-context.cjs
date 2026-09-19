/** Real Blob SDK; only HTTP transport is intercepted. No live requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
const mutant = process.argv.includes('--without-initialization');
Module._extensions['.ts'] = (mod, filename) => {
  let source = fs.readFileSync(filename, 'utf8');
  if (mutant && filename.endsWith('ghl-disposition.ts')) {
    assert.equal(source.split('connectLambda(event);').length, 2);
    source = source.replace('connectLambda(event);', '');
  }
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    esModuleInterop: true
  }}).outputText, filename);
};
process.env.IAOS_ENV = 'test';
process.env.IAOS_WEBHOOK_SECRET = 'offline-disposition-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-ghl-token';
delete process.env.NETLIFY_BLOBS_CONTEXT;
delete globalThis.netlifyBlobsContext;
const { getConfig } = require('../shared/ghl-config.ts');
const { connectLambda } = require('@netlify/blobs');
const { handler } = require('../netlify/functions/ghl-disposition.ts');
const contact = { id: 'fixture-contact', locationId: getConfig('test').locationId,
  customFields: [] };
const notes = [], blobs = new Map(), calls = [];
let failAttempt = false;
const reply = data => new Response(JSON.stringify(data), { status: 200 });
global.fetch = async (url, init = {}) => {
  const u = new URL(url), method = (init.method || 'GET').toUpperCase();
  calls.push({ origin: u.origin, path: u.pathname, method });
  if (u.origin === 'https://blobs.example.invalid') {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer offline-blob-token');
    if (method === 'PUT') {
      assert.equal(headers.get('if-none-match'), '*');
      if (blobs.has(u.pathname)) return new Response(null, { status: 412 });
      blobs.set(u.pathname, init.body);
      return new Response(null, { status: 200 });
    }
    assert.equal(method, 'DELETE');
    blobs.delete(u.pathname);
    return new Response(null, { status: 204 });
  }
  assert.equal(u.origin, 'https://services.leadconnectorhq.com');
  if (u.pathname === '/contacts/' + contact.id + '/notes') {
    if (method === 'POST') notes.push({ id: 'note-' + notes.length,
      body: JSON.parse(init.body).body, dateAdded: new Date().toISOString() });
    else assert.equal(method, 'GET');
    return reply(method === 'POST' ? { note: notes.at(-1) } : { notes });
  }
  assert.equal(u.pathname, '/contacts/' + contact.id);
  if (method === 'PUT') {
    if (failAttempt) return new Response('{}', { status: 400 });
    contact.customFields = JSON.parse(init.body).customFields.map(f =>
      ({ id: f.id, value: f.field_value }));
  } else assert.equal(method, 'GET');
  return reply({ contact });
};
function event() {
  return { httpMethod: 'POST', headers: {
    'x-iaos-secret': process.env.IAOS_WEBHOOK_SECRET,
    'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy'
  }, blobs: Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid',
    token: 'offline-blob-token' })).toString('base64'),
  body: JSON.stringify({ customData: { contact_id: contact.id,
    disposition: 'No Answer', duration: '5' } }) };
}
let count = 0;
async function check(name, fn) {
  await fn(); count++; console.log('PASS ' + name);
}
(async () => {
  if (mutant) {
    const result = await handler(event());
    assert.equal(result.statusCode, 200, 'real SDK requires Lambda initialization');
    return;
  }
  await check('negative control fails without initialization in fresh process', () => {
    const result = spawnSync(process.execPath, [__filename,
      '--without-initialization'], { encoding: 'utf8' });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    console.log('negative-control exit=' + result.status);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /real SDK requires Lambda initialization/);
    assert.match(result.stderr, /409 !== 200/);
  });
  for (const [name, status, change] of [
    ['method', 405, e => { e.httpMethod = 'GET'; }],
    ['auth', 401, e => { delete e.headers['x-iaos-secret']; }],
    ['JSON', 400, e => { e.body = '{'; }],
    ['payload', 403, e => { e.body = JSON.stringify({customData:{
      contact_id:contact.id, disposition:'Trigger Workflow'}}); }],
    ['location', 403, () => { contact.locationId = 'foreign'; }]
  ]) await check(name + ' refused before context or Blob access', async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    const e = event(), before = calls.length;
    change(e);
    assert.equal((await handler(e)).statusCode, status);
    assert.equal(process.env.NETLIFY_BLOBS_CONTEXT, undefined);
    assert(calls.slice(before).every(c => c.method === 'GET' &&
      c.origin === 'https://services.leadconnectorhq.com'));
    contact.locationId = getConfig('test').locationId;
  });
  for (const [name, change] of [
    ['missing', e => { delete e.blobs; }],
    ['malformed', e => { e.blobs = '%%%'; }],
    ['missing token', e => { e.blobs = Buffer.from(JSON.stringify({
      url:'https://blobs.example.invalid'})).toString('base64'); }],
    ['missing site', e => { delete e.headers['x-nf-site-id']; }]
  ]) await check(name + ' context refuses without writes', async () => {
    connectLambda(event()); // Bad invocation must not reuse prior context.
    const e = event(), before = calls.length;
    change(e);
    assert.equal((await handler(e)).statusCode, 409);
    assert(calls.slice(before).every(c => c.method === 'GET'));
    assert.equal(notes.length, 0); assert.equal(blobs.size, 0);
  });
  await check('real SDK acquires/releases lock and completes note then attempt', async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    const before = calls.length;
    assert.equal((await handler(event())).statusCode, 200);
    assert.deepEqual(calls.slice(before).filter(c => c.method !== 'GET')
      .map(c => c.method), ['PUT', 'POST', 'PUT', 'DELETE']);
    assert.equal(notes.length, 1); assert.equal(blobs.size, 0);
    assert.equal(contact.customFields.length, 2);
  });
  await check('attempt failure remains non-2xx; retry does not duplicate note', async () => {
    failAttempt = true;
    assert.equal((await handler(event())).statusCode, 502);
    assert.equal(notes.length, 1); assert.equal(blobs.size, 0);
    failAttempt = false;
    assert.equal((await handler(event())).statusCode, 200);
    assert.equal(notes.length, 1); assert.equal(blobs.size, 0);
  });
  await check('existing lock refuses without note or attempt and is not released', async () => {
    const key = calls.find(c => c.origin === 'https://blobs.example.invalid').path;
    blobs.set(key, 'existing');
    const before = calls.length;
    assert.equal((await handler(event())).statusCode, 409);
    assert.equal(blobs.get(key), 'existing');
    assert(calls.slice(before).filter(c => c.method !== 'GET')
      .every(c => c.origin === 'https://blobs.example.invalid' && c.method === 'PUT'));
    assert.equal(notes.length, 1);
  });
  console.log(count + ' real-SDK disposition context checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
