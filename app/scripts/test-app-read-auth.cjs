/** SECURITY -- application read authentication, offline. global.fetch is
 * replaced for the whole run: GHL, Google and every IAOS function call are
 * fixtures, and any unexpected outbound request fails a check. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
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
  for (const k of [...Object.keys(READ_ENV), ...Object.keys(WRITE_ENV), 'IAOS_VOICE_SESSION_SECRET']) delete process.env[k];
  Object.assign(process.env, READ_ENV, WRITE_ENV, { IAOS_ENV: deployment, GHL_PRIVATE_API_KEY: 'offline-fixture' }, overrides);
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
}
setEnv('test');

// ---- outbound fixture ------------------------------------------------------
let outbound = [];
let route = null;
global.fetch = async (url, init = {}) => {
  outbound.push({ url: String(url), method: init.method || 'GET' });
  if (outbound.length > 200) throw new Error('runaway outbound loop');
  if (route) return route(String(url), init);
  throw new Error('unexpected outbound request: ' + url);
};
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const readAuth = require('../netlify/functions/lib/app-read-auth.ts');
const writeAuth = require('../netlify/functions/lib/app-write-auth.ts');
const operatorAuth = require('../netlify/functions/lib/operator-auth.ts');
const { getConfig, projectRuntimeConfig, setRuntimeConfig } = require('../shared/ghl-config.ts');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + ' -- ' + (err && err.message)); }
}
const NINE = ['ghl-proxy', 'ghl-contacts', 'ghl-contact', 'ghl-opportunities', 'ghl-conversations',
  'ghl-contact-conversations', 'ghl-calendar-events', 'ghl-mailers', 'ghl-underwriting-policy'];
const PARAMS = {
  'ghl-proxy': { path: '/contacts/fixture-contact' },
  'ghl-contact': { id: 'fixture-contact' },
  'ghl-contact-conversations': { id: 'fixture-contact' },
};
// Some libs (mailer-shared, contact-parse) resolve IAOS_ENV once at module
// load, exactly as a deployed function does. A deployment runs ONE env per
// process; this suite switches env in one process, so it reloads every
// function module to model a fresh deployment.
function loadHandler(name) {
  for (const key of Object.keys(require.cache)) if (key.startsWith(FUNCTIONS)) delete require.cache[key];
  return require(path.join(FUNCTIONS, name + '.ts')).handler;
}
const cookieFor = (token) => readAuth.READ_COOKIE + '=' + token;
const sessionFor = (deployment, email = 'brad@example.invalid') => {
  setEnv(deployment);
  return readAuth.issueReadSession(email, readAuth.appReadConfig()).token;
};
function forge(claims, secret = READ_ENV.IAOS_APP_READ_SESSION_SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = require('node:crypto').createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
  return `${h}.${p}.${sig}`;
}
function assertNoCors(res) {
  const headers = res.headers || {};
  for (const k of Object.keys(headers)) assert.ok(!/^access-control-/i.test(k), 'CORS header present: ' + k);
}

(async () => {
  // ---- 1. configuration ----------------------------------------------------
  await check('complete read configuration is accepted', () => { setEnv('test'); readAuth.appReadConfig(); });
  for (const key of Object.keys(READ_ENV)) {
    await check('missing ' + key + ' is unconfigured', () => {
      setEnv('test', { [key]: undefined });
      assert.throws(() => readAuth.appReadConfig(), readAuth.ReadAuthUnconfigured);
    });
  }
  const badConfigs = {
    'secret shorter than 32': { IAOS_APP_READ_SESSION_SECRET: 'short' },
    'secret equal to the write secret': { IAOS_APP_READ_SESSION_SECRET: WRITE_ENV.IAOS_APP_WRITE_SESSION_SECRET },
    'secret equal to the voice secret': { IAOS_VOICE_SESSION_SECRET: READ_ENV.IAOS_APP_READ_SESSION_SECRET },
    'http origin': { IAOS_APP_READ_ALLOWED_ORIGIN: 'http://proof.example.invalid' },
    'origin with a path': { IAOS_APP_READ_ALLOWED_ORIGIN: 'https://proof.example.invalid/' },
    'wildcard origin': { IAOS_APP_READ_ALLOWED_ORIGIN: 'https://*.example.invalid' },
    'malformed email': { IAOS_APP_READ_BRAD_EMAILS: 'not-an-email' },
    'missing IAOS_ENV': { IAOS_ENV: undefined },
    'unknown IAOS_ENV': { IAOS_ENV: 'staging' },
  };
  for (const [label, overrides] of Object.entries(badConfigs)) {
    await check('unconfigured: ' + label, () => { setEnv('test', overrides); assert.throws(() => readAuth.appReadConfig(), readAuth.ReadAuthUnconfigured); });
  }
  await check('read configuration needs no IAOS_APP_WRITE_* setting', () => {
    setEnv('production', Object.fromEntries(Object.keys(WRITE_ENV).map(k => [k, undefined])));
    readAuth.appReadConfig();
  });

  // ---- 2. session tokens ---------------------------------------------------
  setEnv('test');
  const config = readAuth.appReadConfig();
  const now = Date.parse('2026-09-23T12:00:00Z');
  const issued = readAuth.issueReadSession('Brad@Example.Invalid', config, now);
  await check('issued session verifies and lasts exactly 8 hours', () => {
    const v = readAuth.verifyReadSession(issued.token, config, now);
    assert.equal(v.email, 'brad@example.invalid');
    assert.equal(Date.parse(v.expiresAt) - now, 8 * 3600 * 1000);
    assert.equal(readAuth.READ_SESSION_SECONDS, 28800);
  });
  await check('an unlisted email cannot be issued a session', () => assert.throws(() => readAuth.issueReadSession('other@example.invalid', config, now), readAuth.ReadAuthRefused));
  const iat = Math.floor(now / 1000);
  const base = { iss: 'iaos', aud: 'iaos-app-read', env: 'test', sub: 'brad@example.invalid', iat, exp: iat + 28800 };
  const refusedTokens = {
    'expired at 8 hours': [issued.token, now + 28800 * 1000],
    'tampered payload': [issued.token.replace(/\.([^.]+)\./, (m, p) => '.' + Buffer.from(JSON.stringify({ ...base, sub: 'x@example.invalid' })).toString('base64url') + '.'), now],
    'wrong secret': [forge(base, 'a-completely-different-secret-of-32-plus-chars'), now],
    'write audience': [forge({ ...base, aud: 'iaos-app-write' }), now],
    'voice audience': [forge({ ...base, aud: 'iaos-voice' }), now],
    'production env claim on a test deployment': [forge({ ...base, env: 'production' }), now],
    'lifetime other than 8 hours': [forge({ ...base, exp: iat + 3600 }), now],
    'issued in the future': [forge({ ...base, iat: iat + 3600, exp: iat + 3600 + 28800 }), now],
    'alg none': [forge(base, READ_ENV.IAOS_APP_READ_SESSION_SECRET, { alg: 'none', typ: 'JWT' }), now],
    'email removed from allowlist': [forge({ ...base, sub: 'former@example.invalid' }), now],
    'malformed': ['not.a.token.at.all', now],
  };
  for (const [label, [token, at]] of Object.entries(refusedTokens)) {
    await check('refused session: ' + label, () => assert.throws(() => readAuth.verifyReadSession(token, config, at), readAuth.ReadAuthRefused));
  }
  await check('the write authority refuses a read session', () => {
    assert.throws(() => writeAuth.requireAppWriter({ headers: { authorization: 'Bearer ' + issued.token } }, process.env, now));
  });
  await check('the voice authority refuses a read session', () => {
    process.env.IAOS_VOICE_SESSION_SECRET = 'offline-voice-fixture-only-not-a-real-secret';
    process.env.IAOS_VOICE_BRAD_EMAILS = 'brad@example.invalid';
    assert.throws(() => operatorAuth.verifyOperatorSession(issued.token, now));
    setEnv('test');
  });
  await check('the read authority refuses a write session, as bearer or as cookie', () => {
    const write = writeAuth.issueAppSession('brad@example.invalid', process.env, now).token;
    assert.throws(() => readAuth.requireAppReader({ headers: { authorization: 'Bearer ' + write } }, process.env, now), readAuth.ReadAuthRefused);
    assert.throws(() => readAuth.requireAppReader({ headers: { cookie: cookieFor(write) } }, process.env, now), readAuth.ReadAuthRefused);
  });

  // ---- 3. cookie handling ----------------------------------------------------
  await check('cookie is found among other cookies, in any header case', () => {
    assert.equal(readAuth.readSessionToken({ headers: { Cookie: 'a=1; ' + cookieFor('tok') + '; b=2' } }), 'tok');
    assert.equal(readAuth.readSessionToken({ multiValueHeaders: { cookie: [cookieFor('tok')] } }), 'tok');
  });
  for (const [label, event] of Object.entries({
    'no cookie': { headers: {} },
    'other cookies only': { headers: { cookie: 'iaos_read=tok; x=1' } },
    'two different read cookies': { headers: { cookie: cookieFor('one') + '; ' + cookieFor('two') } },
    'conflicting multi-value cookies': { headers: { cookie: cookieFor('one') }, multiValueHeaders: { cookie: [cookieFor('two')] } },
    'empty read cookie': { headers: { cookie: readAuth.READ_COOKIE + '=' } },
  })) {
    await check('cookie refused: ' + label, () => assert.throws(() => readAuth.readSessionToken(event), readAuth.ReadAuthRefused));
  }
  await check('session cookie attributes are exact', () => {
    assert.equal(readAuth.readSessionCookie('tok'), '__Host-iaos_read=tok; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict');
    assert.equal(readAuth.clearedReadSessionCookie(), '__Host-iaos_read=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
  });

  // ---- 4. the nine routes ------------------------------------------------------
  for (const name of NINE) {
    const source = fs.readFileSync(path.join(FUNCTIONS, name + '.ts'), 'utf8');
    await check(name + ': read-auth is the first statement of the handler', () => {
      const m = source.match(/export const handler = async \(event: any\) => \{\r?\n(?:\s*\/\/[^\n]*\n)*\s*([^\n]*)\n\s*([^\n]*)/);
      assert.ok(m, 'handler not found');
      assert.deepEqual([m[1].trim(), m[2].trim()], ['const refused = readAuthRefusal(event);', 'if (refused) return refused;']);
    });
    await check(name + ': no wildcard CORS and no containment left in source', () => {
      assert.doesNotMatch(source, /Access-Control-Allow-Origin/);
      assert.doesNotMatch(source, /ghl-read-containment|ghlReadContained/);
    });
    setEnv('test');
    const handler = loadHandler(name);
    const q = PARAMS[name] || {};
    const testCookie = sessionFor('test');
    const cases = {
      'no cookie': [{ httpMethod: 'GET', headers: {}, queryStringParameters: q }, 401],
      'invalid cookie': [{ httpMethod: 'GET', headers: { cookie: cookieFor('x.y.z') }, queryStringParameters: q }, 401],
      'write bearer only': [{ httpMethod: 'GET', headers: { authorization: 'Bearer ' + writeAuth.issueAppSession('brad@example.invalid').token }, queryStringParameters: q }, 401],
      'OPTIONS preflight without session': [{ httpMethod: 'OPTIONS', headers: { origin: 'https://attacker.example.invalid' } }, 401],
    };
    for (const [label, [event, status]] of Object.entries(cases)) {
      await check(name + ': ' + label + ' -> ' + status + ', no outbound request', async () => {
        outbound = []; route = null; setEnv('test');
        const res = await handler(event);
        assert.equal(res.statusCode, status);
        assert.equal(JSON.parse(res.body).by, 'iaos-app-read-auth');
        assert.deepEqual(outbound, []);
        assertNoCors(res);
      });
    }
    await check(name + ': a valid TEST session is refused by a PRODUCTION deployment', async () => {
      outbound = []; route = null; setEnv('production');
      const res = await handler({ httpMethod: 'GET', headers: { cookie: cookieFor(testCookie) }, queryStringParameters: q });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(outbound, []);
    });
    await check(name + ': missing read configuration -> 503, no outbound request', async () => {
      outbound = []; route = null; setEnv('test', { IAOS_APP_READ_SESSION_SECRET: undefined });
      const res = await handler({ httpMethod: 'GET', headers: { cookie: cookieFor(testCookie) }, queryStringParameters: q });
      assert.equal(res.statusCode, 503);
      assert.equal(JSON.parse(res.body).by, 'iaos-app-read-unconfigured');
      assert.deepEqual(outbound, []);
      assertNoCors(res);
    });
    await check(name + ': a valid session reaches the handler, with no CORS grant', async () => {
      outbound = []; setEnv('test'); route = () => ok({});
      const res = await handler({ httpMethod: 'GET', headers: { cookie: cookieFor(testCookie) }, queryStringParameters: q });
      assert.ok(outbound.length > 0, 'expected the authorized request to reach the GHL fixture');
      assert.notEqual(JSON.parse(res.body || 'null')?.by, 'iaos-app-read-auth');
      assertNoCors(res);
      route = null;
    });
  }

  // ---- 5. location separation --------------------------------------------------
  const TEST_LOC = getConfig('test').locationId, PROD_LOC = getConfig('production').locationId;
  await check('Test and Production location ids differ (fixture sanity)', () => assert.notEqual(TEST_LOC, PROD_LOC));
  for (const [deployment, own, other] of [['test', TEST_LOC, PROD_LOC], ['production', PROD_LOC, TEST_LOC]]) {
    await check(deployment + ': authorized reads never name the other location', async () => {
      const cookie = cookieFor(sessionFor(deployment));
      const seen = [];
      for (const name of NINE) {
        setEnv(deployment);
        const handler = loadHandler(name);
        outbound = []; route = () => ok({});
        await handler({ httpMethod: 'GET', headers: { cookie }, queryStringParameters: PARAMS[name] || {} });
        seen.push(...outbound.map(o => o.url));
      }
      route = null;
      assert.ok(seen.some(u => u.includes(own)), 'no request named this deployment\'s own location');
      assert.ok(!seen.some(u => u.includes(other)), 'a request named the other location');
    });
    await check(deployment + ': proxy refuses a request naming the other location', async () => {
      setEnv(deployment);
      const proxy = loadHandler('ghl-proxy');
      outbound = []; route = null;
      const res = await proxy({ httpMethod: 'GET', headers: { cookie: cookieFor(sessionFor(deployment)) }, queryStringParameters: { path: `/opportunities/pipelines?locationId=${other}` } });
      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(res.body).by, 'iaos-proxy-allowlist');
      assert.deepEqual(outbound, []);
    });
  }
  await check('production: documents gate stays Test-only for an authorized session', async () => {
    setEnv('production');
    const proxy = loadHandler('ghl-proxy');
    outbound = []; route = null;
    const res = await proxy({ httpMethod: 'GET', headers: { cookie: cookieFor(sessionFor('production')) }, queryStringParameters: { path: `/proposals/templates?locationId=${PROD_LOC}` } });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).by, 'iaos-proxy-documents-contracts-test-only');
    assert.deepEqual(outbound, []);
  });

  // ---- 6. session endpoint -------------------------------------------------------
  const session = require('../netlify/functions/app-read-session.ts').handler;
  const ORIGIN = READ_ENV.IAOS_APP_READ_ALLOWED_ORIGIN;
  const googleSays = (claims) => (url) => {
    assert.ok(url.startsWith('https://oauth2.googleapis.com/tokeninfo?id_token='), 'unexpected ' + url);
    return ok({ iss: 'https://accounts.google.com', aud: READ_ENV.IAOS_APP_READ_GOOGLE_CLIENT_ID, email: 'brad@example.invalid', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600), ...claims });
  };
  const post = (headers, body = { googleIdToken: 'google-fixture' }) => session({ httpMethod: 'POST', headers, body: JSON.stringify(body) });
  await check('session endpoint: unconfigured -> 503 for every method', async () => {
    setEnv('test', { IAOS_APP_READ_BRAD_EMAILS: undefined });
    for (const httpMethod of ['GET', 'POST', 'DELETE']) assert.equal((await session({ httpMethod, headers: { origin: ORIGIN } })).statusCode, 503);
  });
  await check('session endpoint: GET without a session reports signed out', async () => {
    setEnv('test');
    const res = await session({ httpMethod: 'GET', headers: {} });
    assert.deepEqual(JSON.parse(res.body), { clientId: 'offline-read-client', signedIn: false, expiresAt: null });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });
  await check('session endpoint: GET with a session reports expiry only -- no token, no email', async () => {
    setEnv('test');
    const token = sessionFor('test');
    const res = await session({ httpMethod: 'GET', headers: { cookie: cookieFor(token) } });
    const body = JSON.parse(res.body);
    assert.equal(body.signedIn, true);
    assert.deepEqual(Object.keys(body).sort(), ['clientId', 'expiresAt', 'signedIn']);
    assert.ok(!res.body.includes(token) && !res.body.includes('brad@'));
  });
  for (const [label, headers] of Object.entries({
    'no Origin': {}, 'foreign Origin': { origin: 'https://attacker.example.invalid' },
    'deploy-preview Origin': { origin: 'https://deploy-preview-93--iaos-app-test.netlify.app' },
  })) {
    await check('session endpoint: POST with ' + label + ' -> 401, no Google call, no cookie', async () => {
      setEnv('test'); outbound = []; route = googleSays({});
      const res = await post(headers);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(outbound, []);
      assert.equal(res.headers['Set-Cookie'], undefined);
      route = null;
    });
  }
  for (const [label, claims] of Object.entries({
    'the WRITE client id': { aud: WRITE_ENV.IAOS_APP_WRITE_GOOGLE_CLIENT_ID },
    'an unverified email': { email_verified: 'false' },
    'an unlisted email': { email: 'other@example.invalid' },
    'an expired Google token': { exp: '1' },
  })) {
    await check('session endpoint: Google token for ' + label + ' -> 401, no cookie', async () => {
      setEnv('test'); outbound = []; route = googleSays(claims);
      const res = await post({ origin: ORIGIN });
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers['Set-Cookie'], undefined);
      route = null;
    });
  }
  await check('session endpoint: extra body fields are refused', async () => {
    setEnv('test'); outbound = []; route = googleSays({});
    assert.equal((await post({ origin: ORIGIN }, { googleIdToken: 'g', email: 'brad@example.invalid' })).statusCode, 401);
    assert.deepEqual(outbound, []); route = null;
  });
  await check('session endpoint: valid sign-in sets the exact cookie; the body carries no token', async () => {
    setEnv('test'); outbound = []; route = googleSays({});
    const res = await post({ origin: ORIGIN });
    route = null;
    assert.equal(res.statusCode, 200);
    const setCookie = res.headers['Set-Cookie'];
    const m = setCookie.match(/^__Host-iaos_read=([^;]+); Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict$/);
    assert.ok(m, 'cookie attributes: ' + setCookie);
    assert.ok(!res.body.includes(m[1]), 'token leaked into the body');
    assert.deepEqual(Object.keys(JSON.parse(res.body)).sort(), ['expiresAt', 'signedIn']);
    assert.equal(readAuth.verifyReadSession(m[1], readAuth.appReadConfig()).email, 'brad@example.invalid');
    assert.equal(outbound.length, 1);
  });
  await check('session endpoint: DELETE needs the exact Origin, then clears the cookie', async () => {
    setEnv('test');
    assert.equal((await session({ httpMethod: 'DELETE', headers: { origin: 'https://attacker.example.invalid' } })).statusCode, 403);
    const res = await session({ httpMethod: 'DELETE', headers: { origin: ORIGIN } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Set-Cookie'], '__Host-iaos_read=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
  });
  await check('session endpoint: other methods -> 405', async () => { setEnv('test'); assert.equal((await session({ httpMethod: 'PUT', headers: { origin: ORIGIN } })).statusCode, 405); });
  await check('sign-out limitation is stated where the session is defined', () => {
    const lib = fs.readFileSync(path.join(FUNCTIONS, 'lib', 'app-read-auth.ts'), 'utf8');
    assert.match(lib, /copied elsewhere stays valid until its own expiry/);
    assert.match(lib, /server-side revocation list/);
  });

  // ---- 7. browser: refusal detection and write/readback outcomes -----------------
  setEnv('test');
  setRuntimeConfig(projectRuntimeConfig(getConfig('test')));
  const readSession = require('../src/lib/read-session.ts');
  require('../src/lib/app-write-session.ts').setAppWriteSession({ token: 'write-fixture', expiresAt: new Date(Date.now() + 600000).toISOString() });
  const { ghl } = require('../src/lib/ghl.ts');
  const REFUSED_401 = { error: 'Sign in to read IAOS data', by: 'iaos-app-read-auth' };
  const UNCONFIGURED_503 = { error: 'x', by: 'iaos-app-read-unconfigured' };
  await check('only a MARKED 401/503 is a read-auth refusal; an upstream GHL 401/503 is not', async () => {
    assert.equal(await readSession.isReadAuthRefusal(ok(REFUSED_401, 401)), true);
    assert.equal(await readSession.isReadAuthRefusal(ok(UNCONFIGURED_503, 503)), true);
    assert.equal(await readSession.isReadAuthRefusal(ok({ message: 'Invalid JWT' }, 401)), false);
    assert.equal(await readSession.isReadAuthRefusal(ok({ message: 'unavailable' }, 503)), false);
    assert.equal(await readSession.isReadAuthRefusal(ok(REFUSED_401, 403)), false);
  });
  await check('a read refused for sign-in throws ReadUnavailableError', async () => {
    route = () => ok(REFUSED_401, 401);
    await assert.rejects(() => ghl.notes.list('fixture-contact'), (e) => e instanceof readSession.ReadUnavailableError);
    route = null;
  });
  await check('an upstream GHL 401 is NOT reported as a sign-in problem', async () => {
    route = () => ok({ message: 'Invalid JWT' }, 401);
    await assert.rejects(() => ghl.notes.list('fixture-contact'), (e) => !(e instanceof readSession.ReadUnavailableError) && /401/.test(e.message));
    route = null;
  });

  const ARV = getConfig('test').opportunityFacts.arv;
  const OPP = 'fixture-opportunity';
  const oppWith = (value, id = OPP) => ({ id, locationId: TEST_LOC, contactId: 'fixture-contact', customFields: [{ id: ARV, fieldValue: value }] });
  function writeScenario({ write, read }) {
    let writes = 0, reads = 0;
    route = (url) => {
      if (url === '/.netlify/functions/ghl-write') { writes++; return write(); }
      if (url.startsWith('/.netlify/functions/ghl-proxy?path=')) { reads++; return read(); }
      throw new Error('unexpected ' + url);
    };
    return () => ({ writes, reads });
  }
  const confirmed = (value = 250000, id = OPP) => () => ok({ confirmed: true, readback: oppWith(value, id), results: [{ id: ARV, landed: true }] });
  await check('write confirmed, readback available: verified against the readback', async () => {
    const n = writeScenario({ write: confirmed(), read: () => ok({ opportunity: oppWith(250000) }) });
    assert.deepEqual(await ghl.opportunities.setApprovedArv(OPP, 250000), { ok: true, putStatus: 200, sent: 250000, observed: 250000 });
    assert.deepEqual(n(), { writes: 1, reads: 1 });
  });
  await check('write CONFIRMED, readback refused for sign-in: not shown as failed (server readback used)', async () => {
    writeScenario({ write: confirmed(), read: () => ok(REFUSED_401, 401) });
    assert.deepEqual(await ghl.opportunities.setApprovedArv(OPP, 250000), { ok: true, putStatus: 200, sent: 250000, observed: 250000 });
  });
  await check('write CONFIRMED, read sign-in unconfigured (503): not shown as failed', async () => {
    writeScenario({ write: confirmed(), read: () => ok(UNCONFIGURED_503, 503) });
    assert.equal((await ghl.opportunities.setApprovedArv(OPP, 250000)).ok, true);
  });
  await check('write answered but NOT landed, readback refused: reported as not landed, never saved', async () => {
    writeScenario({ write: () => ok({ confirmed: false, readback: oppWith(1), results: [{ id: ARV, landed: false }] }), read: () => ok(REFUSED_401, 401) });
    assert.deepEqual(await ghl.opportunities.setApprovedArv(OPP, 250000), { ok: false, putStatus: 200, sent: 250000, observed: 1 });
  });
  await check('write UNCERTAIN (indeterminate), readback refused: throws, never claims saved', async () => {
    const n = writeScenario({ write: () => ok({ outcome: 'indeterminate', error: 'Write submitted; readback unavailable' }, 409), read: () => ok(REFUSED_401, 401) });
    await assert.rejects(() => ghl.opportunities.setApprovedArv(OPP, 250000), (e) => e instanceof readSession.ReadUnavailableError && /NOT confirmed/.test(e.message));
    assert.deepEqual(n(), { writes: 1, reads: 1 });
  });
  await check('write confirmed for a DIFFERENT opportunity, readback refused: treated as uncertain', async () => {
    writeScenario({ write: confirmed(250000, 'some-other-opportunity'), read: () => ok(REFUSED_401, 401) });
    await assert.rejects(() => ghl.opportunities.setApprovedArv(OPP, 250000), (e) => e instanceof readSession.ReadUnavailableError);
  });
  await check('write confirmed, upstream GHL 401 on readback: an ordinary readback failure, not sign-in', async () => {
    writeScenario({ write: confirmed(), read: () => ok({ message: 'Invalid JWT' }, 401) });
    await assert.rejects(() => ghl.opportunities.setApprovedArv(OPP, 250000), (e) => !(e instanceof readSession.ReadUnavailableError) && /readback → 401/.test(e.message));
  });
  await check('write refused: throws before any readback', async () => {
    const n = writeScenario({ write: () => ok({ error: 'Write refused or unconfirmed' }, 409), read: () => ok({}) });
    await assert.rejects(() => ghl.opportunities.setApprovedArv(OPP, 250000), /PUT → 409/);
    assert.deepEqual(n(), { writes: 1, reads: 0 });
  });
  await check('multi-field underwriting write CONFIRMED, readback refused: all three carriers landed', async () => {
    const ids = getConfig('test').opportunityFields;
    const mode = require('../src/lib/underwriting/resolver-types.ts').ASSIGNMENT_MODE_OPTIONS[0][0];
    const opp = { id: OPP, locationId: TEST_LOC, contactId: 'fixture-contact', customFields: [
      { id: ids.endBuyerMaxPrice, fieldValue: 200000 }, { id: ids.sellerMAO, fieldValue: 150000 }, { id: ids.assignmentMode, fieldValue: mode }] };
    writeScenario({ write: () => ok({ confirmed: true, readback: opp }), read: () => ok(REFUSED_401, 401) });
    const r = await ghl.underwriting.saveUnderwritingFields(OPP, { endBuyerMaxPrice: 200000, sellerMAO: 150000, assignmentMode: mode });
    assert.equal(r.ok, true); assert.equal(r.landed, 3);
  });
  route = null;
  await check('all six opportunity writers use the shared readback, and ghl.ts has no raw fetch', () => {
    const src = fs.readFileSync(path.join(APP, 'src', 'lib', 'ghl.ts'), 'utf8');
    for (const w of ['setAskingPrice', 'setApprovedArv', 'setRepairEstimate', 'setCurrentOffer', 'saveUnderwritingFields', 'setAssignmentMode']) {
      assert.match(src, new RegExp(`await readbackOpportunity\\("${w}", opportunityId, putRes\\)`), w);
    }
    assert.doesNotMatch(src, /(^|[^A-Za-z])fetch\(/m);
  });

  // ---- 7b. PR #93 review corrections: confirmed writes whose readback is refused --
  // DispositionControl reads back through confirmCarriers -> ghl.contacts.getDetail,
  // so the error TYPE it receives is what decides saved_unverified vs failure.
  await check('getDetail (DispositionControl readback) throws ReadUnavailableError on a marked refusal', async () => {
    route = () => ok(REFUSED_401, 401);
    await assert.rejects(() => ghl.contacts.getDetail('fixture-contact'), (e) => e instanceof readSession.ReadUnavailableError);
    route = () => ok({ message: 'Invalid JWT' }, 401);
    await assert.rejects(() => ghl.contacts.getDetail('fixture-contact'), (e) => !(e instanceof readSession.ReadUnavailableError));
    route = null;
  });
  const disp = fs.readFileSync(path.join(APP, 'src', 'components', 'DispositionControl.tsx'), 'utf8').replace(/\r\n/g, '\n');
  await check('DispositionControl imports ReadUnavailableError', () => assert.match(disp, /import \{ ReadUnavailableError \} from "\.\.\/lib\/read-session";/));
  await check('DispositionControl record path: refused readback after confirmed writes -> saved_unverified, bell withheld', () => {
    assert.match(disp, /await ghl\.contacts\.setCallDisposition\(contactId, label\);[\s\S]*?try \{ confirmed = await confirmCarriers\(contactId, required\); \}\s*catch \(e\) \{\s*if \(!\(e instanceof ReadUnavailableError\)\) throw e;\s*setSubmit\(\{\s*status: "saved_unverified", label,[\s\S]*?\}\);\s*return;[^\n]*\n\s*\}\s*if \(!confirmed\.ok\)/);
  });
  await check('DispositionControl routing path: refused readback after confirmed write -> saved_unverified, prompt closed', () => {
    assert.match(disp, /await ghl\.contacts\.setCallRouting\(contactId, ROUTING_LTN\);[\s\S]*?\} catch \(e\) \{\s*if \(!\(e instanceof ReadUnavailableError\)\) throw e;\s*setRouting\(\{ status: "saved_unverified", message: [^\n]*\n\s*setPromptOpen\(false\);\s*return;/);
  });
  await check('DispositionControl message: confirmed, not verifiable, sign in to reads and reload, do not retry', () => {
    const m = disp.match(/const VERIFY_UNAVAILABLE = "([^"]*)";/);
    assert.ok(m, 'VERIFY_UNAVAILABLE not found');
    assert.match(m[1], /can't be verified/); assert.match(m[1], /Sign in to reads and reload/); assert.match(m[1], /do not retry/);
    assert.match(disp, /Saved -- IAOS confirmed the write, but it \$\{VERIFY_UNAVAILABLE\}/);
    assert.match(disp, /Routing saved -- IAOS confirmed the move to Long-Term Nurture, but it \$\{VERIFY_UNAVAILABLE\}/);
  });
  await check('DispositionControl keeps its existing uncertain/failed-write handling', () => {
    assert.match(disp, /\} catch \(e\) \{\s*setSubmit\(\{ status: "partial", label, message: `\$\{\(e as Error\)\.message\}\. Nothing was signalled to GHL\.` \}\);/);
    assert.match(disp, /setRouting\(\{ status: "failed", stage: "write", message: \(e as Error\)\.message \}\);/);
    assert.match(disp, /setRouting\(\{ status: "failed", stage: "readback", message: "GHL did not confirm the new routing\." \}\);/);
  });
  await check('DispositionControl renders saved_unverified in amber, with no Retry', () => {
    assert.match(disp, /data-testid="disposition-saved-unverified" style=\{\{ color: "#F59E0B" \}\}/);
    const block = disp.slice(disp.indexOf('routing.status === "saved_unverified" ?'), disp.indexOf('routing.status === "done" ?'));
    assert.match(block, /data-testid="routing-saved-unverified"/);
    assert.doesNotMatch(block, /routing-retry|moveToLtn/);
  });
  const cw = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8').replace(/\r\n/g, '\n');
  await check('Create Under Contract stays disabled, and its handler refuses, in saved_unverified', () => {
    assert.match(cw, /onClick=\{handleCreateUnderContract\}\s*busy=\{underContractWriteState\.kind === "busy"\}\s*disabled=\{!preservedArtifactRecord \|\| underContractWriteState\.kind === "saved_unverified"\}/);
    assert.match(cw, /async function handleCreateUnderContract\(\) \{[\s\S]*?if \(underContractWriteState\.kind === "saved_unverified"\) return;\s*setUnderContractWriteState\(\{ kind: "busy" \}\);/);
  });
  await check('Start Disposition stays disabled, and its handler refuses, in saved_unverified', () => {
    assert.match(cw, /onClick=\{handleStartDisposition\}\s*busy=\{dispositionWriteState\.kind === "busy"\}\s*disabled=\{!dispositionEligibility \|\| !dispositionEligibility\.eligible \|\| dispositionWriteState\.kind === "saved_unverified"\}/);
    assert.match(cw, /async function handleStartDisposition\(\) \{\s*if \(screen\.state !== "ready" \|\| !documentVersion \|\| !notes\) return;\s*if \(dispositionWriteState\.kind === "saved_unverified"\) return;[^\n]*\n\s*setDispositionWriteState\(\{ kind: "busy" \}\);/);
  });
  await check('app-read-auth.ts carries no unused Google import; the session endpoint still verifies with it', () => {
    assert.doesNotMatch(fs.readFileSync(path.join(FUNCTIONS, 'lib', 'app-read-auth.ts'), 'utf8'), /google-identity|verifyGoogleIdToken/);
    const sessionSrc = fs.readFileSync(path.join(FUNCTIONS, 'app-read-session.ts'), 'utf8');
    assert.match(sessionSrc, /import \{ verifyGoogleIdToken \} from "\.\/lib\/google-identity";/);
    assert.match(sessionSrc, /await verifyGoogleIdToken\(body\.googleIdToken, config\.clientId, config\.emails\)/);
  });

  // ---- 8. browser: no credential in storage, messages or logs ---------------------
  await check('Contract Workspace: a confirmed note whose readback is refused is saved_unverified, never failed', () => {
    const src = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8');
    for (const setter of ['setUnderContractWriteState', 'setDispositionWriteState']) {
      assert.match(src, new RegExp(`if \\(e instanceof ReadUnavailableError\\) \\{\\s*${setter}\\(\\{ kind: "saved_unverified"`), setter);
    }
    assert.match(src, /data-testid="contract-execution-under-contract-saved-unverified"/);
    assert.match(src, /data-testid="disposition-handoff-saved-unverified"/);
  });
  for (const rel of ['src/lib/read-session.ts', 'src/components/ReadAccess.tsx', 'public/app-read-login.js', 'netlify/functions/app-read-session.ts', 'netlify/functions/lib/app-read-auth.ts']) {
    await check(rel + ': no browser storage and no logging', () => {
      const src = fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
    });
  }
  await check('the sign-in popup tells its opener only that sign-in finished', () => {
    const src = fs.readFileSync(path.join(APP, 'public', 'app-read-login.js'), 'utf8');
    const posts = src.match(/postMessage\([^)]*\)/g) || [];
    assert.deepEqual(posts, ['postMessage({ type: "iaos-app-read-signed-in" }, location.origin)']);
  });
  await check('the read gate re-checks with the server instead of trusting the popup message', () => {
    const src = fs.readFileSync(path.join(APP, 'src', 'components', 'ReadAccess.tsx'), 'utf8');
    assert.match(src, /event\.origin !== location\.origin/);
    assert.match(src, /event\.source !== popup\.current/);
    assert.match(src, /void check\(\);/);
  });
  await check('the routed pages mount inside the read gate', () => {
    const src = fs.readFileSync(path.join(APP, 'src', 'components', 'Layout.tsx'), 'utf8');
    assert.match(src, /<ReadAccess>\s*<Outlet \/>\s*<\/ReadAccess>/);
  });
  await check('no unreviewed function holds the GHL credential', () => {
    const reviewed = ['ghl-contract-send-readback', 'ghl-disposition', 'mailer-digest'];
    const holders = fs.readdirSync(FUNCTIONS).filter(f => f.endsWith('.ts'))
      .filter(f => /leadconnectorhq|GHL_PRIVATE_API_KEY/.test(fs.readFileSync(path.join(FUNCTIONS, f), 'utf8')))
      .map(f => f.slice(0, -3)).filter(n => !NINE.includes(n)).sort();
    assert.deepEqual(holders, reviewed);
  });

  console.log('App read auth: passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
