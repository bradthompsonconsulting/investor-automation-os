/**
 * AirDroid call eligibility -- the read-only function, offline.
 * Scope: IAOS_AIRDROID_CALL_ELIGIBILITY_AMENDED_SCOPE_2026-10-16.md §3 and §6 B.
 *
 * global.fetch is replaced for the whole run: every outbound request is
 * recorded and answered by a fixture, and an unexpected one fails. No GHL,
 * provider or network call is made. Read-auth cases mirror the nine read
 * routes in test-app-read-auth.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
const SOURCE = path.join(FUNCTIONS, 'call-eligibility.ts');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    for (const ext of ['.ts', '.tsx']) {
      const candidate = path.resolve(path.dirname(parent.filename), name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

const READ_ENV = {
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_READ_ALLOWED_ORIGIN: 'https://proof.example.invalid',
};
const WRITE_ENV = {
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-write-client',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-fixture-only-not-a-real-secret',
  IAOS_APP_WRITE_BRAD_EMAILS: 'brad@example.invalid',
  IAOS_APP_WRITE_ALLOWED_ORIGIN: 'https://proof.example.invalid',
};
function setEnv(deployment, overrides = {}) {
  for (const k of [...Object.keys(READ_ENV), ...Object.keys(WRITE_ENV), 'IAOS_VOICE_SESSION_SECRET', 'IAOS_ENV', 'GHL_PRIVATE_API_KEY']) delete process.env[k];
  Object.assign(process.env, READ_ENV, WRITE_ENV, { IAOS_ENV: deployment, GHL_PRIVATE_API_KEY: 'offline-fixture' }, overrides);
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
}
setEnv('test');

let outbound = [];
let route = null;
global.fetch = async (url, init = {}) => {
  outbound.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
  if (route) return route(String(url), init);
  throw new Error('unexpected outbound request: ' + url);
};
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const readAuth = require(path.join(FUNCTIONS, 'lib', 'app-read-auth.ts'));
const writeAuth = require(path.join(FUNCTIONS, 'lib', 'app-write-auth.ts'));
const { getConfig } = require(path.join(APP, 'shared', 'ghl-config.ts'));
function loadHandler() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(FUNCTIONS)) delete require.cache[key];
  return require(SOURCE);
}

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + ' -- ' + (err && err.message)); }
}

const ID = 'NAGtUZ9aOE5C1GatJzpT';
const TEST = getConfig('test');
const PROD = getConfig('production');
const cookieFor = (token) => readAuth.READ_COOKIE + '=' + token;
const sessionFor = (deployment) => { setEnv(deployment); return readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token; };
const goodContact = (location = TEST.locationId) => ({ contact: { id: ID, locationId: location, phone: '+12025550147', customFields: [] } });
const assertNoCors = (res) => { for (const k of Object.keys(res.headers || {})) assert.ok(!/^access-control-/i.test(k), 'CORS header ' + k); };

(async () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  // ---- read authority ------------------------------------------------------
  await check('read-auth is the first statement of the handler', () => {
    const m = source.match(/export const handler = async \(event: any\) => \{\r?\n(?:\s*\/\/[^\n]*\n)*\s*([^\n]*)\n\s*([^\n]*)/);
    assert.ok(m, 'handler not found');
    assert.deepEqual([m[1].trim(), m[2].trim()], ['const refused = readAuthRefusal(event);', 'if (refused) return refused;']);
  });
  setEnv('test');
  const testCookie = sessionFor('test');
  const q = { contactId: ID };
  const refusals = {
    'no cookie': [{ httpMethod: 'GET', headers: {}, queryStringParameters: q }, 401],
    'invalid cookie': [{ httpMethod: 'GET', headers: { cookie: cookieFor('x.y.z') }, queryStringParameters: q }, 401],
    'write bearer only': [{ httpMethod: 'GET', headers: { authorization: 'Bearer ' + writeAuth.issueAppSession('brad@example.invalid').token }, queryStringParameters: q }, 401],
    'OPTIONS preflight without session': [{ httpMethod: 'OPTIONS', headers: { origin: 'https://attacker.example.invalid' } }, 401],
  };
  for (const [label, [event, status]] of Object.entries(refusals)) {
    await check(label + ' -> ' + status + ', no outbound request', async () => {
      outbound = []; route = () => ok(goodContact()); setEnv('test');
      const res = await loadHandler().handler(event);
      assert.equal(res.statusCode, status);
      assert.equal(JSON.parse(res.body).by, 'iaos-app-read-auth');
      assert.deepEqual(outbound, []);
      assertNoCors(res);
    });
  }
  await check('a valid TEST session is refused by a PRODUCTION deployment, no outbound request', async () => {
    outbound = []; route = () => ok(goodContact()); setEnv('production');
    const res = await loadHandler().handler({ httpMethod: 'GET', headers: { cookie: cookieFor(testCookie) }, queryStringParameters: q });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(outbound, []);
  });
  await check('missing read configuration -> 503, no outbound request', async () => {
    outbound = []; route = () => ok(goodContact()); setEnv('test', { IAOS_APP_READ_SESSION_SECRET: undefined });
    const res = await loadHandler().handler({ httpMethod: 'GET', headers: { cookie: cookieFor(testCookie) }, queryStringParameters: q });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(outbound, []);
  });

  const call = async (params, deployment = 'test', overrides = {}) => {
    const cookie = cookieFor(sessionFor(deployment));
    setEnv(deployment, overrides);
    return loadHandler().handler({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: params });
  };

  // ---- request discipline ----------------------------------------------------
  for (const [label, params] of [['missing contactId', {}], ['contactId with a path', { contactId: '../locations/x' }], ['contactId too long', { contactId: 'a'.repeat(65) }]]) {
    await check(label + ' -> 400, no outbound request', async () => {
      outbound = []; route = () => ok(goodContact());
      const res = await call(params);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(outbound, []);
    });
  }
  await check('POST -> 405, no outbound request', async () => {
    outbound = []; route = () => ok(goodContact());
    const cookie = cookieFor(sessionFor('test'));
    const res = await loadHandler().handler({ httpMethod: 'POST', headers: { cookie }, queryStringParameters: q, body: '{}' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(outbound, []);
  });
  await check('an authorized check makes exactly ONE GET to /contacts/{id}, with no body, and answers eligible with the bound fields', async () => {
    outbound = []; route = () => ok(goodContact());
    const res = await call(q);
    assert.equal(res.statusCode, 200);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].method, 'GET');
    assert.equal(outbound[0].url, `https://services.leadconnectorhq.com/contacts/${ID}`);
    assert.equal(outbound[0].body, undefined);
    const body = JSON.parse(res.body);
    assert.deepEqual(Object.keys(body).sort(), ['contactId', 'decision', 'phoneDigits', 'readAt']);
    assert.deepEqual([body.decision, body.contactId, body.phoneDigits], ['eligible', ID, '2025550147']);
    assert.ok(Number.isFinite(Date.parse(body.readAt)));
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assertNoCors(res);
  });
  await check('the rule is applied: Call suppressed in GHL -> suppressed', async () => {
    outbound = []; route = () => ok({ contact: { ...goodContact().contact, dndSettings: { Call: { status: 'active' } } } });
    const body = JSON.parse((await call(q)).body);
    assert.deepEqual([body.decision, body.phoneDigits], ['suppressed', null]);
  });
  await check('Production deployment binds the Production location: a Test-location contact -> mismatch', async () => {
    outbound = []; route = () => ok(goodContact(TEST.locationId));
    const body = JSON.parse((await call(q, 'production')).body);
    assert.equal(body.decision, 'mismatch');
    route = () => ok(goodContact(PROD.locationId));
    assert.equal(JSON.parse((await call(q, 'production')).body).decision, 'eligible');
  });

  // ---- provider failures are unknown, never eligible -------------------------
  const failures = {
    'GHL 404': () => ok({ message: 'not found' }, 404),
    'GHL 500': () => ok({ message: 'boom' }, 500),
    'GHL 401': () => ok({ message: 'unauthorized' }, 401),
    'invalid JSON': () => new Response('not json', { status: 200 }),
    'no contact object': () => ok({ something: 'else' }),
    'fetch throws': () => { throw new Error('network down'); },
  };
  for (const [label, fixture] of Object.entries(failures)) {
    await check(label + ' -> 200 with decision unknown', async () => {
      outbound = []; route = fixture;
      const res = await call(q);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.deepEqual([body.decision, body.contactId, body.phoneDigits], ['unknown', ID, null]);
      assert.equal(outbound.length, 1);
    });
  }
  await check('the provider read is bounded at 5 s: a stalled GHL read -> unknown after the timeout', async () => {
    outbound = [];
    route = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const t0 = Date.now();
    const res = await call(q);
    const elapsed = Date.now() - t0;
    assert.equal(JSON.parse(res.body).decision, 'unknown');
    assert.ok(elapsed >= 4900 && elapsed < 7000, 'elapsed ' + elapsed);
    assert.equal(loadHandler().PROVIDER_TIMEOUT_MS, 5000);
  });
  await check('T5: the 5 s bound also covers reading the body: a 200 whose body stalls -> unknown after the timeout, with no second GET', async () => {
    outbound = [];
    // Emulates fetch's documented behaviour: aborting the request's signal errors the response body stream.
    route = (url, init) => {
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"contact":'));
        init.signal.addEventListener('abort', () => controller.error(new Error('aborted')));
      } });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const t0 = Date.now();
    const res = await call(q);
    const elapsed = Date.now() - t0;
    assert.equal(JSON.parse(res.body).decision, 'unknown');
    assert.ok(elapsed >= 4900 && elapsed < 7000, 'elapsed ' + elapsed);
    assert.equal(outbound.length, 1);
  });
  await check('missing IAOS_ENV -> refused (401 by read auth, or 503), no outbound request', async () => {
    outbound = []; route = () => ok(goodContact());
    const cookie = cookieFor(sessionFor('test'));
    setEnv('test');
    delete process.env.IAOS_ENV;
    // Read auth also needs IAOS_ENV, so it refuses first; either way nothing leaves and nothing is eligible.
    const res = await loadHandler().handler({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: q });
    assert.ok([401, 503].includes(res.statusCode), String(res.statusCode));
    assert.deepEqual(outbound, []);
  });
  await check('missing GHL credential -> 503 unknown, no outbound request', async () => {
    outbound = []; route = () => ok(goodContact());
    const res = await call(q, 'test', { GHL_PRIVATE_API_KEY: undefined });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).decision, 'unknown');
    assert.deepEqual(outbound, []);
  });

  // ---- source pins: read-only --------------------------------------------------
  await check('source pin: no write path, Blob, write boundary or mutating method', () => {
    assert.doesNotMatch(source, /ghl-write|write-boundary|configuredBoundary|@netlify\/blobs|getStore|method:\s*"(?:PUT|POST|DELETE|PATCH)"/);
    assert.match(source, /method: "GET"/);
    assert.doesNotMatch(source, /Access-Control-Allow-Origin/);
  });

  console.log(`\nCall eligibility endpoint: passed=${passed} failed=${failed}`);
  process.exitCode = failed ? 1 : 0;
})();
