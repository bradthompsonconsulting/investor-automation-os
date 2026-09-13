/**
 * Contract-send READBACK endpoint -- limit-boundary and pagination-honesty
 * proof. B9-08/INV-63 (implementation), B9-10/INV-65 Jess Gate repair
 * round, 2026-09-13 (this test file: the function had NO dedicated test
 * file before this repair round -- the `limit=100` bug this file exists
 * to guard against was never caught because nothing ever invoked the
 * handler and inspected the actual outbound request).
 *
 * OBSERVED directly against the live Test location, 2026-09-13:
 * `GET /proposals/document` returns `422 "limit must not be greater than
 * 21"` for any limit above 21. This harness proves the function never
 * sends more than 21, and is explicit -- never silent -- about the
 * resulting pagination limitation: a single, unpaginated call cannot
 * distinguish "the expected document genuinely does not exist" from "it
 * exists on a page this call never requested."
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-send-readback-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const SOURCES = [
  path.join(APP, 'shared', 'ghl-config.ts'),
  path.join(APP, 'src', 'lib', 'contract-send-model.ts'),
  path.join(APP, 'src', 'lib', 'board9-contract-model.ts'),
  path.join(APP, 'src', 'lib', 'seller-call-outcome.ts'),
  path.join(APP, 'src', 'lib', 'seller-call-readiness-carriers.ts'),
  path.join(APP, 'src', 'lib', 'contract-authorization-model.ts'),
  path.join(APP, 'src', 'lib', 'contract-authorization-carriers.ts'),
  path.join(APP, 'src', 'lib', 'contract-document-model.ts'),
  path.join(APP, 'src', 'lib', 'contract-facts-model.ts'),
  path.join(APP, 'src', 'lib', 'seller-contract-facts-carriers.ts'),
  path.join(APP, 'src', 'lib', 'contract-send-carriers.ts'),
  path.join(APP, 'netlify', 'functions', 'ghl-contract-send-readback.ts'),
];

try {
  execSync(
    'npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') +
    ' --outDir "' + TMP + '" --rootDir "' + APP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const FLOOR = 8;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

process.env.IAOS_ENV = 'test';
process.env.GHL_PRIVATE_API_KEY = 'test-token-not-real';

const READBACK_JS = path.join(TMP, 'netlify', 'functions', 'ghl-contract-send-readback.js');
const CONFIG_JS = path.join(TMP, 'shared', 'ghl-config.js');
const configModule = require(CONFIG_JS);
const testConfig = configModule.getConfig('test');
const readback = require(READBACK_JS);

function makeMockFetch(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    if (i >= responses.length) throw new Error('mock fetch called more times than responses were queued');
    const r = responses[i++];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
  };
  fn.calls = calls;
  return fn;
}

function invoke(payload) {
  return readback.handler({ httpMethod: 'POST', body: JSON.stringify(payload) });
}

function documentRow(overrides) {
  return Object.assign({
    documentId: 'doc-1',
    locationId: testConfig.locationId,
    status: 'sent',
    recipients: [],
    links: [{ createdBy: testConfig.documentsContracts.senderUserId }],
    fillableFields: [{ isRequired: true }],
  }, overrides || {});
}

async function main() {
  /* ------------------------------------------------------------------ */
  /* 1. The function NEVER requests a limit above 21                     */
  /* ------------------------------------------------------------------ */
  {
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ documents: [documentRow({})] }) },
    ]);
    await invoke({ documentId: 'doc-1' });
    const call = global.fetch.calls[0];
    const url = new URL(call.url);
    const requestedLimit = Number(url.searchParams.get('limit'));
    check('exactly one GET call is made', global.fetch.calls.length, 1);
    check('the requested limit is a real, present number', Number.isFinite(requestedLimit), true);
    check('the requested limit is never greater than 21 (the verified live maximum)', requestedLimit <= 21, true);
    check('the requested limit is exactly 21 (the verified supported maximum, not a smaller arbitrary guess)', requestedLimit, 21);
  }

  /* ------------------------------------------------------------------ */
  /* 2. A valid within-limit response remains searchable for the         */
  /*    expected document                                                */
  /* ------------------------------------------------------------------ */
  {
    const manyDocs = [];
    for (let i = 0; i < 20; i++) manyDocs.push(documentRow({ documentId: 'other-doc-' + i }));
    manyDocs.push(documentRow({ documentId: 'expected-doc', status: 'completed', recipients: [{ id: testConfig.documentsContracts.approvedTestContactId, hasCompleted: true }], fillableFields: [{ isRequired: true }] }));
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ documents: manyDocs }) },
    ]);
    const res = await invoke({ documentId: 'expected-doc' });
    const classification = JSON.parse(res.body);
    check('a 21-document response (at the verified limit) still finds the expected document among 21 rows', classification.status, 'accepted');
  }

  /* ------------------------------------------------------------------ */
  /* 3. Absence of the expected document fails closed (never a false     */
  /*    "accepted")                                                      */
  /* ------------------------------------------------------------------ */
  {
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ documents: [documentRow({ documentId: 'some-other-doc' })] }) },
    ]);
    const res = await invoke({ documentId: 'expected-doc-not-present' });
    const classification = JSON.parse(res.body);
    check('the expected document genuinely absent from the (single, unpaginated) response fails closed to ambiguous, never accepted', classification.status, 'ambiguous');
  }

  /* ------------------------------------------------------------------ */
  /* 4. Pagination limitation is explicit, not silently treated as       */
  /*    exhaustive -- this function makes exactly ONE request and never  */
  /*    follows a next-page cursor, even when the response is full       */
  /* ------------------------------------------------------------------ */
  {
    const fullPage = [];
    for (let i = 0; i < 21; i++) fullPage.push(documentRow({ documentId: 'doc-' + i }));
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ documents: fullPage, total: 500 }) },
    ]);
    const res = await invoke({ documentId: 'not-on-this-page' });
    const classification = JSON.parse(res.body);
    check('a full 21-row page (with a much larger declared total) triggers no second, pagination-following request', global.fetch.calls.length, 1);
    check('a document absent from a full, possibly-non-exhaustive page still fails closed to ambiguous -- never silently trusted as "confirmed absent"', classification.status, 'ambiguous');
  }

  cleanup();
  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
  if (checks !== FLOOR) {
    console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}. A case was added or removed without updating FLOOR.`);
    process.exit(2);
  }
  if (failures) { console.error('FAILED'); process.exit(1); }
  console.log('OK');
}

main().catch((e) => { console.error('FATAL: ' + (e && e.stack || e)); cleanup(); process.exit(1); });
