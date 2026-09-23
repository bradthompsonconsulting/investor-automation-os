/** SECURITY CONTAINMENT offline checks. Every GHL read handler must refuse
 * before any outbound request. global.fetch is replaced so that ANY outbound
 * call is recorded and fails the check; nothing here reaches a network. */
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
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

process.env.IAOS_ENV = 'test';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';

const outbound = [];
global.fetch = async (url, init) => { outbound.push(String(url)); throw new Error('outbound request attempted: ' + url); };

const { GHL_READ_CONTAINED_FUNCTIONS, GHL_READ_CONTAINMENT_MARKER } = require('../netlify/functions/lib/ghl-read-containment.ts');
const auth = require('../netlify/functions/lib/app-write-auth.ts');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (err) { failed++; console.log('FAIL ' + name + ' -- ' + (err && err.message)); }
}

const EXPECTED = ['ghl-proxy', 'ghl-contacts', 'ghl-contact', 'ghl-opportunities', 'ghl-conversations',
  'ghl-contact-conversations', 'ghl-calendar-events', 'ghl-mailers', 'ghl-underwriting-policy'];

// A valid application session is included on purpose: containment is
// unconditional, so even an authenticated caller must not reach GHL here.
const bearer = 'Bearer ' + auth.issueAppSession('brad@example.invalid').token;
const events = [
  ['GET, no query', { httpMethod: 'GET', headers: {} }],
  ['GET contact list', { httpMethod: 'GET', headers: {}, queryStringParameters: { path: '/contacts' } }],
  ['GET contact record', { httpMethod: 'GET', headers: {}, queryStringParameters: { path: '/contacts/fixture-contact', id: 'fixture-contact' } }],
  ['GET contact notes', { httpMethod: 'GET', headers: {}, queryStringParameters: { path: '/contacts/fixture-contact/notes' } }],
  ['GET opportunity search', { httpMethod: 'GET', headers: {}, queryStringParameters: { path: '/opportunities/search?location_id=x', scope: 'all' } }],
  ['GET with foreign Origin', { httpMethod: 'GET', headers: { origin: 'https://attacker.example.invalid' }, queryStringParameters: { path: '/contacts' } }],
  ['GET with valid app session', { httpMethod: 'GET', headers: { authorization: bearer, origin: 'https://proof.example.invalid' }, queryStringParameters: { path: '/contacts' } }],
  ['OPTIONS preflight', { httpMethod: 'OPTIONS', headers: { origin: 'https://attacker.example.invalid' } }],
  ['POST with body', { httpMethod: 'POST', headers: {}, body: '{}', queryStringParameters: { path: '/contacts' } }],
];

(async () => {
  await check('containment list is exactly the nine reported functions', () => {
    assert.deepEqual([...GHL_READ_CONTAINED_FUNCTIONS], EXPECTED);
  });

  for (const name of EXPECTED) {
    const file = path.join(FUNCTIONS, name + '.ts');
    const source = fs.readFileSync(file, 'utf8');
    await check(name + ': containment is the first statement of the handler', () => {
      const m = source.match(/export const handler = async \(event: any\) => \{\r?\n(?:\s*\/\/[^\n]*\n)*\s*([^\n]*)\n\s*([^\n]*)/);
      assert.ok(m, 'handler not found');
      assert.deepEqual([m[1].trim(), m[2].trim()], ['const contained = ghlReadContained();', 'if (contained) return contained;']);
    });
    await check(name + ': imports the shared containment guard', () => {
      assert.match(source, /^import \{ ghlReadContained \} from "\.\/lib\/ghl-read-containment";\r?$/m);
    });
    const { handler } = require(file);
    for (const [label, event] of events) {
      await check(name + ': ' + label + ' -> 503, no outbound request', async () => {
        const before = outbound.length;
        const res = await handler(structuredClone(event));
        assert.equal(res.statusCode, 503);
        assert.equal(outbound.length, before, 'outbound: ' + outbound.slice(before).join(', '));
        assert.deepEqual(JSON.parse(res.body), { error: 'GHL reads are temporarily unavailable pending read authentication', by: GHL_READ_CONTAINMENT_MARKER });
        assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
        assert.equal(res.headers['Cache-Control'], 'no-store');
      });
    }
  }

  // Regression net: any OTHER function that holds the GHL credential directly
  // must be a reviewed, caller-authenticated (or non-HTTP) surface. A new
  // entry here fails until someone reviews it.
  const reviewed = {
    'ghl-contract-send-readback': /requireAppWriter\(event\)/,
    'ghl-disposition': /x-iaos-secret/,
    'mailer-digest': /buildMailerDigest\(token\)/, // scheduled (netlify.toml); reported for Gatekeeper review
  };
  await check('every other direct GHL-credential function is on the reviewed list', () => {
    const holders = fs.readdirSync(FUNCTIONS).filter(f => f.endsWith('.ts'))
      .filter(f => /leadconnectorhq|GHL_PRIVATE_API_KEY/.test(fs.readFileSync(path.join(FUNCTIONS, f), 'utf8')))
      .map(f => f.slice(0, -3)).filter(n => !EXPECTED.includes(n)).sort();
    assert.deepEqual(holders, Object.keys(reviewed).sort());
    for (const [n, marker] of Object.entries(reviewed)) {
      assert.match(fs.readFileSync(path.join(FUNCTIONS, n + '.ts'), 'utf8'), marker, n);
    }
  });

  await check('no outbound request was attempted by any check', () => assert.deepEqual(outbound, []));
  console.log('GHL read containment: passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
