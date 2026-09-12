/**
 * Contract-send RESERVATION endpoint -- server-side fail-closed gate proof.
 * B9-08 / INV-63, Jess Gate correction round, 2026-09-12.
 *
 * This is the first test in this repository to directly invoke a
 * `netlify/functions/*.ts` handler as a function (mocking `global.fetch`
 * and `process.env`), rather than only statically scanning its source.
 * That is deliberate here: the claim being proven -- "zero outbound GHL
 * calls" -- cannot be demonstrated by reading the source; it requires
 * actually calling the handler with a mock fetch that records every
 * invocation and failing the test if one occurs where none should.
 *
 * Compiles ghl-config.ts, contract-send-guard.ts, and
 * ghl-contract-send-reserve.ts together (mirroring test-contract-send-
 * model.cjs's own multi-file compilation pattern). `getConfig("test")`
 * returns the SAME live TEST object every call (verified by reading
 * ghl-config.ts's own source: `getConfig` returns the module-scope
 * PRODUCTION/TEST const directly, never a clone) -- this test exploits
 * that to mutate `documentsContracts` fields between scenarios without
 * needing to reload the module, since the handler's own module-scope
 * `DOCUMENTS_CONTRACTS` binding is a reference to that SAME nested
 * object, not a snapshot.
 *
 * Every mutation this test makes to the shared config object is restored
 * before the next scenario runs (a `try/finally`-shaped sequence, not
 * relying on scenario order for correctness).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-send-reserve-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const SOURCES = [
  path.join(APP, 'shared', 'ghl-config.ts'),
  path.join(APP, 'netlify', 'functions', 'lib', 'contract-send-guard.ts'),
  path.join(APP, 'netlify', 'functions', 'ghl-contract-send-reserve.ts'),
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

const FLOOR = 32;
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

const CONFIG_JS = path.join(TMP, 'shared', 'ghl-config.js');
const RESERVE_JS = path.join(TMP, 'netlify', 'functions', 'ghl-contract-send-reserve.js');

const configModule = require(CONFIG_JS);
const testConfig = configModule.getConfig('test');
// The REAL, currently-committed Test config -- preserved so this test
// restores the live config object to its true on-disk state when it
// finishes, regardless of scenario order or an early failure.
const PRISTINE_DOCUMENTS_CONTRACTS = { ...testConfig.documentsContracts };
// TEST currently carries POPULATION_NOT_VERIFIED for real (Brad has not
// yet completed GHL template field placement -- see ghl-config.ts's own
// doc comment) -- that is exactly the state GATE-style checks 1/1b exist
// to test AGAINST. Every OTHER scenario in this file needs a config that
// WOULD pass those two gates, so it can actually exercise the checks
// further down the handler (contact/template/recipient/conflict) instead
// of being masked by the population gate on every single case. This
// baseline changes nothing about what ships -- it exists only inside
// this test process, and the pristine value is restored at the end.
const VALID_BASELINE_DOCUMENTS_CONTRACTS = { ...PRISTINE_DOCUMENTS_CONTRACTS, populationVerification: configModule.POPULATION_VERIFIED };
function resetTestConfigToValidBaseline() {
  Object.assign(testConfig.documentsContracts, VALID_BASELINE_DOCUMENTS_CONTRACTS);
}
function restorePristineTestConfig() {
  Object.assign(testConfig.documentsContracts, PRISTINE_DOCUMENTS_CONTRACTS);
}

let reserve = require(RESERVE_JS);

/** Records every fetch call as {url, method}; returns canned responses in order; throws if exhausted. */
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

const VALID_OPPORTUNITY_ID = 'opp-1';
const VALID_VERSION_RAW = JSON.stringify({ agreementAt: '2026-09-12T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null });
const ATTEMPT_ID = '2026-09-12T00:00:00.000Z';

function wellFormedInProgressNote(overrides) {
  const requestedTemplateId = (overrides && overrides.requestedTemplateId) ?? testConfig.documentsContracts.templateId;
  const confirmedRecipientId = (overrides && 'confirmedRecipientId' in overrides) ? overrides.confirmedRecipientId : 'UNAVAILABLE';
  const opportunityId = (overrides && overrides.opportunityId) ?? VALID_OPPORTUNITY_ID;
  const status = (overrides && overrides.status) ?? 'in_progress';
  const versionRaw = (overrides && overrides.versionRaw) ?? VALID_VERSION_RAW;
  return [
    'IAOS CONTRACT SEND — iaos-contract-send-v2',
    `Recorded at: ${ATTEMPT_ID}`,
    'Operator: UNAVAILABLE',
    `Opportunity: ${opportunityId}`,
    `Attempt id: ${ATTEMPT_ID}`,
    `Status: ${status}`,
    `Version: ${versionRaw}`,
    'Template name: TREC NO 20-19 RESALE V1',
    'Template source: ghl_documents_contracts',
    `Requested template id: ${requestedTemplateId}`,
    'Authorized at: 2026-09-12T00:00:00.000Z',
    'Signers: []',
    `Confirmed recipient id: ${confirmedRecipientId}`,
    'Expiration at: 2026-09-13T00:00:00.000Z',
    `Request at: ${ATTEMPT_ID}`,
    'IAOS observed acceptance at: UNAVAILABLE',
    'Provider response: UNAVAILABLE',
    'Failure reason: UNAVAILABLE',
  ].join('\n');
}

function validPayload(overrides) {
  return {
    contactId: testConfig.documentsContracts.approvedTestContactId,
    opportunityId: VALID_OPPORTUNITY_ID,
    versionRaw: VALID_VERSION_RAW,
    noteBody: wellFormedInProgressNote(),
    ...overrides,
  };
}

/** A well-formed Brad Contract Authorization note, matching contract-authorization-carriers.ts's exact format -- the durable fact `verifyServerSideAuthorization` reads. */
function wellFormedAuthorizationNote(overrides) {
  const opportunityId = (overrides && overrides.opportunityId) ?? VALID_OPPORTUNITY_ID;
  const authorizedBy = (overrides && overrides.authorizedBy) ?? 'brad';
  const operator = (overrides && 'operator' in overrides) ? overrides.operator : 'brad';
  const versionRaw = (overrides && overrides.versionRaw) ?? VALID_VERSION_RAW;
  const templateName = (overrides && overrides.templateName) ?? testConfig.documentsContracts.expectedTemplateName;
  const at = (overrides && overrides.at) ?? '2026-09-12T00:00:00.000Z';
  return [
    'IAOS BRAD CONTRACT AUTHORIZATION — iaos-brad-contract-authorization-v1',
    `Recorded at: ${at}`,
    `Operator: ${operator === null ? 'UNAVAILABLE' : operator}`,
    `Opportunity: ${opportunityId}`,
    `Authorized by: ${authorizedBy}`,
    `Version: ${versionRaw}`,
    `Template name: ${templateName}`,
    'Template source: ghl_documents_contracts',
    'Document lines: []',
    'Additional required facts: []',
  ].join('\n');
}

async function invoke(payload) {
  return reserve.handler({ httpMethod: 'POST', body: JSON.stringify(payload) });
}

async function main() {
  /* -------------------------------------------------------------- */
  /* 1. Population not verified -- zero outbound GHL calls             */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    testConfig.documentsContracts.populationVerification = 'POPULATION_NOT_VERIFIED';
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload());
    check('population not verified: refused with 500', res.statusCode, 500);
    check('population not verified: zero outbound GHL calls', global.fetch.calls.length, 0);
  }

  /* -------------------------------------------------------------- */
  /* 1b. Sender not configured -- zero outbound GHL calls              */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    testConfig.documentsContracts.senderUserId = 'GHL_SENDER_USER_ID_NOT_YET_PROVIDED';
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload());
    check('sender not configured: refused with 500', res.statusCode, 500);
    check('sender not configured: zero outbound GHL calls', global.fetch.calls.length, 0);
  }

  /* -------------------------------------------------------------- */
  /* 2. Wrong contact -- zero outbound GHL calls                       */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload({ contactId: 'some-other-contact-id-not-approved' }));
    check('wrong contact: refused with 403', res.statusCode, 403);
    check('wrong contact: zero outbound GHL calls', global.fetch.calls.length, 0);
  }

  /* -------------------------------------------------------------- */
  /* 3. Mismatched ledger content -- zero outbound GHL calls           */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload({ noteBody: wellFormedInProgressNote({ requestedTemplateId: 'some-other-template-id' }) }));
    check('mismatched requestedTemplateId: refused with 400', res.statusCode, 400);
    check('mismatched requestedTemplateId: zero outbound GHL calls', global.fetch.calls.length, 0);
  }
  {
    resetTestConfigToValidBaseline();
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload({ noteBody: wellFormedInProgressNote({ confirmedRecipientId: 'a-fabricated-already-confirmed-recipient' }) }));
    check('fabricated confirmedRecipientId on an in_progress note: refused with 400', res.statusCode, 400);
    check('fabricated confirmedRecipientId: zero outbound GHL calls', global.fetch.calls.length, 0);
  }
  {
    // A mismatch against the DECLARED opportunityId/version (pre-existing
    // check) still refuses before any GHL call -- re-confirmed here
    // alongside the new checks, in the SAME harness, for a single source
    // of truth on "this endpoint's refusals never call GHL."
    resetTestConfigToValidBaseline();
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload({ noteBody: wellFormedInProgressNote({ opportunityId: 'a-different-opportunity' }) }));
    check('noteBody opportunityId disagrees with declared opportunityId: refused with 400', res.statusCode, 400);
    check('opportunityId mismatch: zero outbound GHL calls', global.fetch.calls.length, 0);
  }

  /* -------------------------------------------------------------- */
  /* 4. A valid, fully-configured request retains the existing         */
  /*    conflict-check behavior, WITH a real authorization on record   */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    // An existing in_progress note for the SAME opportunity+version is
    // already on record -- the conflict check must fire and the write
    // must never be attempted. A valid authorization note is also
    // present (this scenario is about the CONFLICT check, not
    // authorization -- both notes are read in the SAME GET call).
    const conflictingNote = wellFormedInProgressNote();
    const authNote = wellFormedAuthorizationNote();
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: authNote }, { body: conflictingNote }] }) },
    ]);
    const res = await invoke(validPayload());
    check('valid request, existing conflict: refused with 409', res.statusCode, 409);
    check('valid request, existing conflict: exactly one GHL call (the read), no write attempted', global.fetch.calls.length, 1);
    check('valid request, existing conflict: the one call was a GET (read), never a POST (write)', global.fetch.calls[0].method, 'GET');
  }
  {
    resetTestConfigToValidBaseline();
    // No conflicting note on record, and a valid, exact-revision
    // authorization IS on record -- the reservation should proceed to
    // write, in exactly two calls: GET (read) then POST (write).
    const authNote = wellFormedAuthorizationNote();
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: authNote }] }) },
      { status: 201, body: JSON.stringify({ id: 'note-123' }) },
    ]);
    const res = await invoke(validPayload());
    check('valid request, no conflict, valid authorization: the write succeeds (201 passed through)', res.statusCode, 201);
    check('valid request, no conflict, valid authorization: exactly two GHL calls (read then write)', global.fetch.calls.length, 2);
    check('valid request, no conflict, valid authorization: first call is the GET (read)', global.fetch.calls[0].method, 'GET');
    check('valid request, no conflict, valid authorization: second call is the POST (write)', global.fetch.calls[1].method, 'POST');
  }

  /* -------------------------------------------------------------- */
  /* 4b. Server-side authorization currency, independently verified   */
  /*     (Jess Gate correction round 2) -- zero outbound GHL calls on */
  /*     every refusal, since the write must never be attempted for   */
  /*     an unauthorized/stale/wrong-authorizer caller                */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    // No authorization note at all -- "missing authorization."
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [] }) },
    ]);
    const res = await invoke(validPayload());
    check('missing authorization: refused with 403', res.statusCode, 403);
    check('missing authorization: the refusal names NO_AUTHORIZATION_RECORDED', JSON.parse(res.body).reason, 'NO_AUTHORIZATION_RECORDED');
    check('missing authorization: no write is ever attempted (exactly one call, the read)', global.fetch.calls.length, 1);
  }
  {
    resetTestConfigToValidBaseline();
    // An authorization exists, but for a DIFFERENT (superseded/stale)
    // revision than the one being reserved -- "expired/superseded."
    const staleAuthNote = wellFormedAuthorizationNote({
      versionRaw: JSON.stringify({ agreementAt: '2026-09-12T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null }),
      at: '2026-09-11T00:00:00.000Z',
    });
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: staleAuthNote }] }) },
    ]);
    // The reservation itself declares a NEWER version than the stale authorization covers.
    const newerVersionRaw = JSON.stringify({ agreementAt: '2026-09-12T00:00:00.000Z', versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null });
    const res = await invoke(validPayload({
      versionRaw: newerVersionRaw,
      noteBody: wellFormedInProgressNote({ versionRaw: newerVersionRaw }),
    }));
    check('authorization for a superseded revision: refused with 403', res.statusCode, 403);
    check('authorization for a superseded revision: the refusal names REVISION_CHANGED_OR_SUPERSEDED', JSON.parse(res.body).reason, 'REVISION_CHANGED_OR_SUPERSEDED');
    check('authorization for a superseded revision: no write is ever attempted', global.fetch.calls.length, 1);
  }
  {
    resetTestConfigToValidBaseline();
    // A "forged" authorization -- authorizedBy/operator claim someone
    // other than Brad. V1 permits no other authorizer.
    const forgedAuthNote = wellFormedAuthorizationNote({ authorizedBy: 'someone-else', operator: 'someone-else' });
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: forgedAuthNote }] }) },
    ]);
    const res = await invoke(validPayload());
    check('forged (non-Brad) authorization: refused with 403', res.statusCode, 403);
    check('forged (non-Brad) authorization: the refusal names NOT_BRAD', JSON.parse(res.body).reason, 'NOT_BRAD');
    check('forged (non-Brad) authorization: no write is ever attempted', global.fetch.calls.length, 1);
  }

  /* -------------------------------------------------------------- */
  /* 5. Production remains prohibited                                  */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    delete require.cache[RESERVE_JS];
    process.env.IAOS_ENV = 'production';
    const prodReserve = require(RESERVE_JS);
    global.fetch = makeMockFetch([]);
    const res = await prodReserve.handler({ httpMethod: 'POST', body: JSON.stringify(validPayload()) });
    check('production deployment: refused with 403', res.statusCode, 403);
    check('production deployment: refusal names the test-only boundary', JSON.parse(res.body).by, 'iaos-contract-send-reserve-test-only');
    check('production deployment: zero outbound GHL calls', global.fetch.calls.length, 0);
    process.env.IAOS_ENV = 'test';
    delete require.cache[RESERVE_JS];
    reserve = require(RESERVE_JS);
  }

  /* -------------------------------------------------------------- */
  /* 6. OPTIONS/method guard is untouched by any of the above          */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    global.fetch = makeMockFetch([]);
    const res = await reserve.handler({ httpMethod: 'GET', body: '' });
    check('non-POST method: refused with 405, zero GHL calls', [res.statusCode, global.fetch.calls.length], [405, 0]);
  }

  restorePristineTestConfig();
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

main().catch((e) => { console.error('FATAL: ' + (e && e.stack || e)); restorePristineTestConfig(); cleanup(); process.exit(1); });
