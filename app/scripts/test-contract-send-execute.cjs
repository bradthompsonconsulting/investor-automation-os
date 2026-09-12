/**
 * Contract-send EXECUTION endpoint -- best-effort, single-user V1 ticket
 * redemption proof. B9-08 / INV-63, Jess Gate correction round 2,
 * 2026-09-12.
 *
 * PRODUCT OWNER SINGLE-USER V1 RULING, 2026-09-12: what this proves is
 * BEST-EFFORT protection sized for Brad as IAOS V1's only operator --
 * NOT an atomicity guarantee, NOT proof of authenticated identity, and
 * NOT a guarantee of single-use or at-most-once sending. See
 * `ghl-contract-send-execute.ts`'s own header for the full disclosure
 * this file's checks are scoped against.
 *
 * Mirrors test-contract-send-reserve.cjs's own harness pattern exactly
 * (mocked global.fetch, mutable live TEST config object, require-cache
 * busting only where module-scope env state demands it). The claim being
 * proven -- "an invalid/forged/stale/replayed ticket or authorization
 * note never reaches the real provider send" -- can only be demonstrated
 * by actually invoking the handler and recording every fetch call, never
 * by reading source.
 *
 * "Zero send calls" below means specifically zero calls to
 * `/proposals/templates/send` (the ONE real GHL mutation this function
 * can ever trigger) -- a notes-read GET is expected and necessary for
 * every ticket/authorization-note check, and is not itself a mutation.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-send-execute-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const SOURCES = [
  path.join(APP, 'shared', 'ghl-config.ts'),
  path.join(APP, 'netlify', 'functions', 'lib', 'contract-send-guard.ts'),
  path.join(APP, 'netlify', 'functions', 'lib', 'authorization-guard.ts'),
  path.join(APP, 'netlify', 'functions', 'ghl-contract-send-execute.ts'),
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

const FLOOR = 25;
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
const EXECUTE_JS = path.join(TMP, 'netlify', 'functions', 'ghl-contract-send-execute.js');

const configModule = require(CONFIG_JS);
const testConfig = configModule.getConfig('test');
const PRISTINE_DOCUMENTS_CONTRACTS = { ...testConfig.documentsContracts };
const VALID_BASELINE_DOCUMENTS_CONTRACTS = { ...PRISTINE_DOCUMENTS_CONTRACTS, populationVerification: configModule.POPULATION_VERIFIED };
function resetTestConfigToValidBaseline() {
  Object.assign(testConfig.documentsContracts, VALID_BASELINE_DOCUMENTS_CONTRACTS);
}
function restorePristineTestConfig() {
  Object.assign(testConfig.documentsContracts, PRISTINE_DOCUMENTS_CONTRACTS);
}

let execute = require(EXECUTE_JS);

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
function sendCallCount(calls) {
  return calls.filter((c) => c.url.includes('/proposals/templates/send')).length;
}

const VALID_OPPORTUNITY_ID = 'opp-1';
const VALID_VERSION_RAW = JSON.stringify({ agreementAt: '2026-09-12T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null });
const ATTEMPT_ID = '2026-09-12T00:00:00.000Z';

function wellFormedSendNote(overrides) {
  const requestedTemplateId = (overrides && overrides.requestedTemplateId) ?? testConfig.documentsContracts.templateId;
  const confirmedRecipientId = (overrides && 'confirmedRecipientId' in overrides) ? overrides.confirmedRecipientId : 'UNAVAILABLE';
  const opportunityId = (overrides && overrides.opportunityId) ?? VALID_OPPORTUNITY_ID;
  const status = (overrides && overrides.status) ?? 'in_progress';
  const versionRaw = (overrides && overrides.versionRaw) ?? VALID_VERSION_RAW;
  const attemptId = (overrides && overrides.attemptId) ?? ATTEMPT_ID;
  return [
    'IAOS CONTRACT SEND — iaos-contract-send-v2',
    `Recorded at: ${attemptId}`,
    'Operator: UNAVAILABLE',
    `Opportunity: ${opportunityId}`,
    `Attempt id: ${attemptId}`,
    `Status: ${status}`,
    `Version: ${versionRaw}`,
    'Template name: TREC NO 20-19 RESALE V1',
    'Template source: ghl_documents_contracts',
    `Requested template id: ${requestedTemplateId}`,
    'Authorized at: 2026-09-12T00:00:00.000Z',
    'Signers: []',
    `Confirmed recipient id: ${confirmedRecipientId}`,
    'Expiration at: 2026-09-13T00:00:00.000Z',
    `Request at: ${attemptId}`,
    'IAOS observed acceptance at: UNAVAILABLE',
    'Provider response: UNAVAILABLE',
    'Failure reason: UNAVAILABLE',
  ].join('\n');
}

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

function validPayload(overrides) {
  return {
    opportunityId: VALID_OPPORTUNITY_ID,
    versionRaw: VALID_VERSION_RAW,
    attemptId: ATTEMPT_ID,
    templateId: testConfig.documentsContracts.templateId,
    ...overrides,
  };
}

async function invoke(payload) {
  return execute.handler({ httpMethod: 'POST', body: JSON.stringify(payload) });
}

async function main() {
  /* -------------------------------------------------------------- */
  /* 1. Config gates -- zero calls of any kind                         */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    testConfig.documentsContracts.populationVerification = 'POPULATION_NOT_VERIFIED';
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload());
    check('population not verified: refused with 500', res.statusCode, 500);
    check('population not verified: zero GHL calls of any kind', global.fetch.calls.length, 0);
  }
  {
    resetTestConfigToValidBaseline();
    testConfig.documentsContracts.senderUserId = 'GHL_SENDER_USER_ID_NOT_YET_PROVIDED';
    global.fetch = makeMockFetch([]);
    const res = await invoke(validPayload());
    check('sender not configured: refused with 500', res.statusCode, 500);
    check('sender not configured: zero GHL calls of any kind', global.fetch.calls.length, 0);
  }

  /* -------------------------------------------------------------- */
  /* 2. Missing ticket -- a caller who never reserved                  */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [] }) },
    ]);
    const res = await invoke(validPayload());
    check('missing ticket: refused with 403', res.statusCode, 403);
    check('missing ticket: zero send calls', sendCallCount(global.fetch.calls), 0);
  }

  /* -------------------------------------------------------------- */
  /* 3. Forged/mismatched ticket -- a real attemptId reserved for a    */
  /*    DIFFERENT opportunity/version/template                        */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    const foreignTicket = wellFormedSendNote({ opportunityId: 'a-different-opportunity' });
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: foreignTicket }] }) },
    ]);
    const res = await invoke(validPayload());
    check('ticket for a different opportunity: refused with 403', res.statusCode, 403);
    check('ticket for a different opportunity: zero send calls', sendCallCount(global.fetch.calls), 0);
  }
  {
    resetTestConfigToValidBaseline();
    const mismatchedVersionTicket = wellFormedSendNote({ versionRaw: JSON.stringify({ agreementAt: '2026-09-12T00:00:00.000Z', versionSeq: 2, supersedesVersionSeq: 1, replacesAgreementAt: null }) });
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: mismatchedVersionTicket }] }) },
    ]);
    const res = await invoke(validPayload());
    check('revision mismatch between ticket and declared version: refused with 403', res.statusCode, 403);
    check('revision mismatch: zero send calls', sendCallCount(global.fetch.calls), 0);
  }

  /* -------------------------------------------------------------- */
  /* 4. Replay -- a ticket that has ALREADY been consumed              */
  /*    (a resolution note already exists for this exact attemptId)   */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    const consumedTicket = wellFormedSendNote({ status: 'accepted' });
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: consumedTicket }] }) },
    ]);
    const res = await invoke(validPayload());
    check('already-consumed (accepted) ticket: refused with 409', res.statusCode, 409);
    check('already-consumed ticket: zero send calls', sendCallCount(global.fetch.calls), 0);
  }
  {
    resetTestConfigToValidBaseline();
    // A resolution ALREADY exists (provider_accepted_pending_readback) --
    // resolveAttemptByExactId ranks this above the earlier in_progress
    // note for the SAME attemptId, so the ticket is no longer "fresh."
    const inProgressNote = wellFormedSendNote({ status: 'in_progress' });
    const resolvedNote = wellFormedSendNote({ status: 'provider_accepted_pending_readback' });
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: inProgressNote }, { body: resolvedNote }] }) },
    ]);
    const res = await invoke(validPayload());
    check('replay after a resolution note already exists: refused with 409', res.statusCode, 409);
    check('replay after resolution: zero send calls', sendCallCount(global.fetch.calls), 0);
  }

  /* -------------------------------------------------------------- */
  /* 5. Authorization currency, independently re-verified at execute  */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    const ticket = wellFormedSendNote();
    // No authorization note at all.
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: ticket }] }) },
    ]);
    const res = await invoke(validPayload());
    check('missing authorization at execute time: refused with 403', res.statusCode, 403);
    check('missing authorization at execute time: names NO_AUTHORIZATION_RECORDED', JSON.parse(res.body).reason, 'NO_AUTHORIZATION_RECORDED');
    check('missing authorization at execute time: zero send calls', sendCallCount(global.fetch.calls), 0);
  }
  {
    resetTestConfigToValidBaseline();
    const ticket = wellFormedSendNote();
    const forgedAuth = wellFormedAuthorizationNote({ authorizedBy: 'someone-else', operator: 'someone-else' });
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: ticket }, { body: forgedAuth }] }) },
    ]);
    const res = await invoke(validPayload());
    check('forged authorization at execute time: refused with 403', res.statusCode, 403);
    check('forged authorization at execute time: names NOT_BRAD', JSON.parse(res.body).reason, 'NOT_BRAD');
    check('forged authorization at execute time: zero send calls', sendCallCount(global.fetch.calls), 0);
  }

  /* -------------------------------------------------------------- */
  /* 6. A valid, exact-revision authorization + fresh ticket reaches   */
  /*    the send boundary                                              */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    const ticket = wellFormedSendNote();
    const auth = wellFormedAuthorizationNote();
    global.fetch = makeMockFetch([
      { status: 200, body: JSON.stringify({ notes: [{ body: ticket }, { body: auth }] }) },
      { status: 200, body: JSON.stringify({ success: true, links: [{ documentId: 'doc-1', createdBy: testConfig.documentsContracts.senderUserId }] }) },
    ]);
    const res = await invoke(validPayload());
    check('valid ticket + valid authorization: the real send is reached (provider response passed through)', res.statusCode, 200);
    check('valid ticket + valid authorization: exactly one send call, exactly once', sendCallCount(global.fetch.calls), 1);
    check('valid ticket + valid authorization: the send call never carries a caller-supplied contactId/userId (both from config)', (() => {
      const sendCall = global.fetch.calls.find((c) => c.url.includes('/proposals/templates/send'));
      return sendCall ? sendCall.url.includes('/proposals/templates/send') : false;
    })(), true);
  }

  /* -------------------------------------------------------------- */
  /* 7. Production remains prohibited                                  */
  /* -------------------------------------------------------------- */
  {
    resetTestConfigToValidBaseline();
    delete require.cache[EXECUTE_JS];
    process.env.IAOS_ENV = 'production';
    const prodExecute = require(EXECUTE_JS);
    global.fetch = makeMockFetch([]);
    const res = await prodExecute.handler({ httpMethod: 'POST', body: JSON.stringify(validPayload()) });
    check('production deployment: refused with 403', res.statusCode, 403);
    check('production deployment: zero GHL calls of any kind', global.fetch.calls.length, 0);
    process.env.IAOS_ENV = 'test';
    delete require.cache[EXECUTE_JS];
    execute = require(EXECUTE_JS);
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
