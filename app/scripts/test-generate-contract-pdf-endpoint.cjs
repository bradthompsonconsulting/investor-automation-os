/**
 * Board #9 Phase B security gate -- generate-contract-pdf.ts's own HTTP
 * boundary: exact Origin enforcement (the same PR #78 requireAppWriteOrigin
 * helper every other Board #9 write/generate surface uses), authentication,
 * Test-location restriction, and no-store caching on every response. Every
 * GHL call is a mocked, in-memory fixture; no network call, no live GHL
 * access.
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
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';

const load = (name) => require('../src/lib/' + name + '.ts');
const config = require('../shared/ghl-config.ts').getConfig('test');
const auth = require('../netlify/functions/lib/app-write-auth.ts');
const { handler } = require('../netlify/functions/generate-contract-pdf.ts');

let checks = 0, failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name); console.error('      expected: ' + JSON.stringify(expected)); console.error('      actual:   ' + JSON.stringify(actual)); }
}

const contact = { id: config.documentsContracts.approvedTestContactId, locationId: config.locationId, customFields: [], firstName: 'Jane', lastName: 'Seller', email: 'seller@example.com', address1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
const opportunity = { id: 'fixture-opportunity-endpoint-security', contactId: contact.id, locationId: config.locationId, customFields: [{ id: config.opportunityFacts.currentOffer, fieldValue: 190000 }] };
const fixture = require('./write-contract-fixture.cjs').contractFixture(load, opportunity.id);
const notes = [...fixture.notes];
const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
let calls = 0;
global.fetch = async (url) => {
  calls++;
  const u = new URL(url);
  assert.equal(u.origin, 'https://services.leadconnectorhq.com', 'no external network');
  if (u.pathname === '/opportunities/' + opportunity.id) return reply({ opportunity });
  if (u.pathname === '/contacts/' + contact.id) return reply({ contact });
  if (u.pathname === '/contacts/' + contact.id + '/notes') return reply({ notes });
  throw new Error('Unexpected mocked request ' + u.pathname);
};

const approvedOrigin = process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
function validToken() { return auth.issueAppSession('brad@example.invalid').token; }
function event(overrides) {
  return Object.assign(
    {
      httpMethod: 'POST',
      headers: { origin: approvedOrigin, authorization: `Bearer ${validToken()}` },
      body: JSON.stringify({ opportunityId: opportunity.id }),
    },
    overrides || {},
  );
}

(async () => {
  // ============================================================
  // 1/2. Exact-Origin enforcement (item 1/2) -- reuses the SAME PR #78
  // requireAppWriteOrigin helper; every wrong/missing/malformed/ambiguous
  // Origin is refused BEFORE any GHL access or PDF generation (calls stays
  // at 0 for every case below).
  // ============================================================
  for (const origin of [
    undefined, '', 'null', 'https://wrong.example.invalid',
    approvedOrigin + '.attacker.invalid', approvedOrigin + '/',
    approvedOrigin + '/path', approvedOrigin + '?x=1',
    approvedOrigin + '#fragment', approvedOrigin + ':443',
    'http://proof.example.invalid', 'https://user@proof.example.invalid',
    ' https://proof.example.invalid', approvedOrigin + ', ' + approvedOrigin,
    ['https://proof.example.invalid'], 'not a URL',
  ]) {
    const before = calls;
    const e = event();
    if (origin === undefined) delete e.headers.origin;
    else e.headers.origin = origin;
    const res = await handler(e);
    check('Origin rejected before any GHL access: ' + JSON.stringify(origin), res.statusCode, 403);
    check('  -- zero GHL calls occurred: ' + JSON.stringify(origin), calls, before);
  }
  for (const headers of [
    { multi: { Origin: [approvedOrigin, approvedOrigin] } },
    { multi: { origin: [approvedOrigin], Origin: [approvedOrigin] } },
    { multi: { origin: [] } },
  ]) {
    const before = calls;
    const e = event();
    e.multiValueHeaders = headers.multi;
    const res = await handler(e);
    check('ambiguous Origin refused before any GHL access ' + JSON.stringify(headers), res.statusCode, 403);
    check('  -- zero GHL calls occurred (ambiguous)', calls, before);
  }
  for (const setting of [undefined, '', '*', 'https://*.example.invalid', approvedOrigin + '/', approvedOrigin + ',https://other.example.invalid']) {
    const before = calls;
    if (setting === undefined) delete process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
    else process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = setting;
    try {
      const res = await handler(event());
      check('invalid origin configuration fails closed ' + setting, res.statusCode, 403);
      check('  -- zero GHL calls occurred (misconfigured)', calls, before);
    } finally { process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = approvedOrigin; }
  }

  // ============================================================
  // 3. Unauthenticated requests remain 401, regardless of Origin.
  // ============================================================
  for (const origin of [approvedOrigin, undefined, 'https://wrong.example.invalid']) {
    const before = calls;
    const e = event({ headers: origin ? { origin } : {} });
    const res = await handler(e);
    check('unauthenticated retains 401 with Origin ' + origin, res.statusCode, 401);
    check('  -- zero GHL calls occurred (unauthenticated)', calls, before);
  }

  // ============================================================
  // 4. Valid authentication with an invalid Origin returns 403, never a
  //    401 masquerading as an Origin failure or vice-versa -- auth and
  //    Origin are independent gates, both must pass.
  // ============================================================
  {
    const before = calls;
    const res = await handler(event({ headers: { origin: 'https://wrong.example.invalid', authorization: `Bearer ${validToken()}` } }));
    check('valid auth + wrong Origin is 403 (not 401 -- auth itself was fine)', res.statusCode, 403);
    check('  -- zero GHL calls occurred', calls, before);
  }

  // ============================================================
  // 5/6. Cache-Control: no-store on EVERY response -- success, every
  // failure mode, and the OPTIONS preflight -- so the PDF/evidence can
  // never be cached by the browser, a CDN, or the function response layer.
  // ============================================================
  check('OPTIONS preflight carries Cache-Control: no-store', (await handler({ httpMethod: 'OPTIONS', headers: {} })).headers['Cache-Control'], 'no-store');
  check('405 (wrong method) carries Cache-Control: no-store', (await handler({ httpMethod: 'GET', headers: {} })).headers['Cache-Control'], 'no-store');
  check('401 (unauthenticated) carries Cache-Control: no-store', (await handler(event({ headers: { origin: approvedOrigin } }))).headers['Cache-Control'], 'no-store');
  check('403 (wrong Origin) carries Cache-Control: no-store', (await handler(event({ headers: { origin: 'https://wrong.example.invalid', authorization: `Bearer ${validToken()}` } }))).headers['Cache-Control'], 'no-store');
  {
    const before = calls;
    const res = await handler(event({ body: '{' }));
    check('400 (malformed body) carries Cache-Control: no-store', res.headers['Cache-Control'], 'no-store');
    check('  -- 400 occurs before any GHL access', calls, before);
    check('  -- 400 status itself', res.statusCode, 400);
  }
  check('Access-Control-Allow-Origin is the exact configured origin, never a wildcard', (await handler({ httpMethod: 'OPTIONS', headers: {} })).headers['Access-Control-Allow-Origin'], approvedOrigin);

  // The one genuine success path, to prove 200 ALSO carries no-store and
  // that Origin/auth/location all pass together for a real request.
  {
    const res = await handler(event());
    check('a fully valid request (right auth, right Origin, Test location) succeeds', res.statusCode, 200);
    check('the success response carries Cache-Control: no-store', res.headers['Cache-Control'], 'no-store');
    const body = JSON.parse(res.body);
    check('the success response carries real generator evidence, not a placeholder', /^[0-9a-f]{64}$/.test(body.evidence.outputSha256), true);
  }

  // ============================================================
  // 7. Test-location restriction remains intact -- confirmed both by the
  // static guard's presence (this codebase's own established convention
  // for endpoints whose LOCATION_ID/TEST_LOCATION_ID are resolved once at
  // module load, e.g. ghl-contract-send-readback.ts, rather than
  // per-request -- see that file's own test for the same pattern) and by
  // this file's own successful request above only succeeding because this
  // test process's IAOS_ENV='test' resolves to the SAME location as
  // getConfig('test').
  // ============================================================
  const endpointSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'generate-contract-pdf.ts'), 'utf8');
  check('the Test-location guard is present and returns 403 for a non-Test location', /LOCATION_ID !== TEST_LOCATION_ID\)\s*\{\s*return json\(403,/.test(endpointSrc), true);
  check('the Test-location guard runs BEFORE any body parsing or GHL access (textually precedes the JSON.parse call)', endpointSrc.indexOf('LOCATION_ID !== TEST_LOCATION_ID') < endpointSrc.indexOf('JSON.parse(event.body'), true);
  check('requireAppWriteOrigin is imported from the shared PR #78 helper, never reimplemented', /import \{ requireAppWriteOrigin \} from "\.\/lib\/app-write-origin"/.test(endpointSrc), true);
  check('the Origin check textually precedes the Test-location check (auth -> Origin -> location -> body -> GHL, matching ghl-write.ts\'s own established order)', endpointSrc.indexOf('requireAppWriteOrigin(event)') < endpointSrc.indexOf('LOCATION_ID !== TEST_LOCATION_ID'), true);

  console.log('');
  console.log(checks + ' checks, ' + failures + ' failures.');
  console.log('No live write, GHL mutation, deployment, or Production access occurred in this run -- every fixture above is an in-memory object and global.fetch is fully mocked.');
  if (failures > 0) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
