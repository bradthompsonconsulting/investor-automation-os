/**
 * INV-98 Board #9 -- offline coverage for the GET-only, read-session-
 * protected Documents & Contracts capability function
 * (`netlify/functions/ghl-documents-capability.ts`).
 *
 * global.fetch is replaced for the whole run; every outbound request is
 * recorded and none leaves the process. No deployed endpoint is called.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const FUNCTION = path.join(APP, 'netlify', 'functions', 'ghl-documents-capability.ts');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
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
const FIXTURE_TOKEN = 'offline-fixture-ghl-key-DO-NOT-ECHO';
function setEnv(deployment, overrides = {}) {
  for (const k of Object.keys(process.env)) if (k.startsWith('IAOS_APP_') || k === 'IAOS_VOICE_SESSION_SECRET') delete process.env[k];
  Object.assign(process.env, READ_ENV, { IAOS_ENV: deployment, GHL_PRIVATE_API_KEY: FIXTURE_TOKEN }, overrides);
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
}

let outbound = [];
let route = null;
global.fetch = async (url, init = {}) => {
  outbound.push({ url: String(url), init });
  if (route) return route(String(url), init);
  throw new Error('unexpected outbound request');
};
const respond = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function loadHandler() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(APP, 'netlify')) || key.startsWith(path.join(APP, 'shared'))) delete require.cache[key];
  return require(FUNCTION).handler;
}
function readAuth() { return require(path.join(APP, 'netlify', 'functions', 'lib', 'app-read-auth.ts')); }
function sessionEvent(method = 'GET') {
  const auth = readAuth();
  const token = auth.issueReadSession('brad@example.invalid', auth.appReadConfig()).token;
  return { httpMethod: method, headers: { cookie: auth.READ_COOKIE + '=' + token } };
}

let passed = 0, failed = 0;
async function check(name, fn) {
  outbound = []; route = null;
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + ' -- ' + (err && err.message)); }
}

(async () => {
  await check('missing IAOS_ENV fails closed at load', () => {
    setEnv('test', { IAOS_ENV: undefined });
    assert.throws(() => loadHandler());
    assert.equal(outbound.length, 0);
  });

  for (const deployment of ['test', 'production']) {
    await check(`${deployment}: unconfigured read sign-in answers 503 with no outbound request`, async () => {
      setEnv(deployment, { IAOS_APP_READ_SESSION_SECRET: undefined });
      const res = await loadHandler()({ httpMethod: 'GET', headers: {} });
      assert.equal(res.statusCode, 503);
      assert.equal(outbound.length, 0);
    });
    await check(`${deployment}: no read session answers 401 with no outbound request`, async () => {
      setEnv(deployment);
      const res = await loadHandler()({ httpMethod: 'GET', headers: {} });
      assert.equal(res.statusCode, 401);
      assert.equal(outbound.length, 0);
    });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      await check(`${deployment}: ${method} with a valid read session answers 405 with no outbound request`, async () => {
        setEnv(deployment);
        const handler = loadHandler();
        const res = await handler(sessionEvent(method));
        assert.equal(res.statusCode, 405);
        assert.equal(outbound.length, 0);
      });
    }
    await check(`${deployment}: missing GHL_PRIVATE_API_KEY answers 500 with no outbound request`, async () => {
      setEnv(deployment, { GHL_PRIVATE_API_KEY: undefined });
      const handler = loadHandler();
      const res = await handler(sessionEvent());
      assert.equal(res.statusCode, 500);
      assert.equal(outbound.length, 0);
    });
    await check(`${deployment}: GET makes exactly ONE GET to /proposals/document for the configured location, limit=1, Version v3`, async () => {
      setEnv(deployment);
      const handler = loadHandler();
      const { getConfig } = require(path.join(APP, 'shared', 'ghl-config.ts'));
      route = () => respond({ documents: [] });
      const res = await handler(sessionEvent());
      assert.equal(res.statusCode, 200);
      assert.equal(outbound.length, 1);
      const url = new URL(outbound[0].url);
      assert.equal(url.origin, 'https://services.leadconnectorhq.com');
      assert.equal(url.pathname, '/proposals/document');
      assert.deepEqual([...url.searchParams.keys()].sort(), ['limit', 'locationId']);
      assert.equal(url.searchParams.get('locationId'), getConfig(deployment).locationId);
      assert.equal(url.searchParams.get('limit'), '1');
      assert.equal(outbound[0].init.method, 'GET');
      assert.equal(outbound[0].init.body, undefined);
      assert.equal(outbound[0].init.headers.Version, 'v3');
      assert.equal(outbound[0].init.headers.Authorization, 'Bearer ' + FIXTURE_TOKEN);
    });
  }

  await check('production: works with NO IAOS_APP_WRITE_* setting at all', async () => {
    setEnv('production');
    for (const k of Object.keys(process.env)) if (k.startsWith('IAOS_APP_WRITE_')) delete process.env[k];
    const handler = loadHandler();
    route = () => respond({ documents: [] });
    const res = await handler(sessionEvent());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { httpStatus: 200, documentsArrayPresent: true });
  });

  await check('response carries ONLY httpStatus and documentsArrayPresent -- never document data or credential material', async () => {
    setEnv('production');
    const handler = loadHandler();
    const sensitive = { documents: [{ documentId: 'doc-secret-id-123', name: 'Seller Jane Contract', recipients: [{ email: 'jane@example.invalid' }], links: [{ url: 'https://sign.example.invalid/x' }] }], total: 1 };
    route = () => respond(sensitive);
    const res = await handler(sessionEvent());
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(Object.keys(body).sort(), ['documentsArrayPresent', 'httpStatus']);
    assert.deepEqual(body, { httpStatus: 200, documentsArrayPresent: true });
    for (const needle of ['doc-secret-id-123', 'Seller Jane', 'jane@example.invalid', 'sign.example.invalid', FIXTURE_TOKEN, 'Bearer']) {
      assert.ok(!res.body.includes(needle), 'response leaked: ' + needle);
      assert.ok(!JSON.stringify(res.headers).includes(needle), 'headers leaked: ' + needle);
    }
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });

  const cases = [
    ['provider 401 (scope not granted)', () => respond({ message: 'The token is not authorized for this scope' }, 401), { httpStatus: 401, documentsArrayPresent: false }],
    ['provider 403', () => respond({ message: 'forbidden' }, 403), { httpStatus: 403, documentsArrayPresent: false }],
    ['provider 200 without a documents array', () => respond({ data: [] }), { httpStatus: 200, documentsArrayPresent: false }],
    ['provider 200 with non-JSON body', () => respond('not json'), { httpStatus: 200, documentsArrayPresent: false }],
  ];
  for (const [label, providerRoute, expected] of cases) {
    await check('reports ' + label + ' as status only', async () => {
      setEnv('production');
      const handler = loadHandler();
      route = providerRoute;
      const res = await handler(sessionEvent());
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), expected);
      assert.ok(!res.body.includes('authorized for this scope'), 'provider body must never be echoed');
      assert.equal(outbound.length, 1);
    });
  }

  await check('network failure answers 502 with no provider or credential detail', async () => {
    setEnv('production');
    const handler = loadHandler();
    route = () => { throw new Error('ECONNRESET ' + FIXTURE_TOKEN); };
    const res = await handler(sessionEvent());
    assert.equal(res.statusCode, 502);
    assert.ok(!res.body.includes(FIXTURE_TOKEN));
    assert.ok(!res.body.includes('ECONNRESET'));
  });

  await check('source: GET is the only outbound method and the module has no write capability', () => {
    const src = fs.readFileSync(FUNCTION, 'utf8');
    assert.ok(/method: "GET"/.test(src));
    assert.ok(!/"(POST|PUT|PATCH|DELETE)"/.test(src), 'no write verb anywhere in the function');
    assert.ok(!/getStore|connectLambda|requireAppWriter/.test(src), 'no Blob access and no write authority');
  });

  console.log(`ghl-documents-capability passed=${passed} failed=${failed}`);
  process.exitCode = failed ? 1 : 0;
})();
