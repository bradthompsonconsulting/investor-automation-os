/**
 * INV-98 Board #9 -- offline coverage for the Production proof write scope
 * (`netlify/functions/lib/production-write-scope.ts`), its two write
 * entry points (`ghl-write.ts`, `ghl-executed-artifact-upload.ts`), the
 * readiness pin (`contract-production-readiness.ts`), the minimal
 * contract-facts set, and the manual-send evidence correction.
 *
 * Every GHL request and every Blob call is intercepted and counted. No
 * network, no Netlify, no GHL, no Production access.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

// ---- Blob interception: every connectLambda / getStore / store call counted.
const blob = { connections: 0, stores: 0, reads: 0, writes: 0 };
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return {
    connectLambda: () => { blob.connections++; },
    getStore: () => {
      blob.stores++;
      return {
        async get() { blob.reads++; return null; },
        async getWithMetadata() { blob.reads++; return null; },
        async getMetadata() { blob.reads++; return null; },
        async list() { blob.reads++; return { blobs: [], directories: [] }; },
        async set() { blob.writes++; },
        async setJSON() { blob.writes++; return { modified: true }; },
        async delete() { blob.writes++; },
      };
    },
  };
  return originalLoad.call(this, name, ...rest);
};

// ---- GHL interception: every outbound request counted; the default refuses.
let ghlCalls = [];
let ghlRoute = null;
global.fetch = async (url, init = {}) => {
  ghlCalls.push({ url: String(url), method: init.method || 'GET' });
  if (ghlRoute) return ghlRoute(String(url), init);
  throw new Error('offline: network disabled');
};

process.env.IAOS_ENV = 'production';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';

const G = require('../shared/ghl-config.ts');
const scopeLib = require('../netlify/functions/lib/production-write-scope.ts');
const readiness = require('../netlify/functions/lib/contract-production-readiness.ts');
const auth = require('../netlify/functions/lib/app-write-auth.ts');
const load = (n) => require(path.join(APP, 'src', 'lib', n + '.ts'));

const TEST = G.getConfig('test');
const PRODUCTION = G.getConfig('production'); // the live module object the handlers read
const PRODUCTION_ORIGINAL = JSON.parse(JSON.stringify(PRODUCTION));
const PIN_CONTACT = 'offline-proof-contact';
const PIN_OPP = 'offline-proof-opportunity';
const OTHER_CONTACT = 'offline-real-contact';
const OTHER_OPP = 'offline-real-opportunity';
const FAKE_STAGE = 'offline-under-contract-stage';
// The synthetic fixture committed in PRODUCTION.productionProofScope (verified by read-only GET 2026-09-25).
const COMMITTED_FIXTURE_CONTACT = 'T3t5AZ3Z5lak0BmZawvP';
const COMMITTED_FIXTURE_OPP = '44hLQ4PD4a4HBVLPr4nl';

/** Production config variants. Each is a deep copy; `apply` also mutates the live object for handler checks. */
// `default` is the COMMITTED Production config exactly as it deploys (real
// Under Contract stage, real synthetic-fixture pins, and -- since the INV-98
// enable commit -- BOTH flags ON). Every other state sets stage, pins and
// flags EXPLICITLY -- none inherits the committed values -- so each
// simulates exactly one condition. `disabled` is both flags OFF.
const STATES = {
  default: () => ({}),
  disabled: () => ({ productionProofScope: { enabled: G.PRODUCTION_PROOF_SCOPE_NOT_ENABLED, contactId: PIN_CONTACT, opportunityId: PIN_OPP }, contractProductionEnabled: G.CONTRACT_PRODUCTION_NOT_ENABLED, stages: { underContract: FAKE_STAGE } }),
  enabled_unpinned: () => ({ productionProofScope: { enabled: G.PRODUCTION_PROOF_SCOPE_ENABLED, contactId: G.PRODUCTION_PROOF_CONTACT_NOT_PINNED, opportunityId: G.PRODUCTION_PROOF_OPPORTUNITY_NOT_PINNED }, contractProductionEnabled: G.CONTRACT_PRODUCTION_ENABLED, stages: { underContract: FAKE_STAGE } }),
  pinned_not_enabled: () => ({ productionProofScope: { enabled: G.PRODUCTION_PROOF_SCOPE_NOT_ENABLED, contactId: PIN_CONTACT, opportunityId: PIN_OPP }, contractProductionEnabled: G.CONTRACT_PRODUCTION_ENABLED, stages: { underContract: FAKE_STAGE } }),
  pinned_contracts_disabled: () => ({ productionProofScope: { enabled: G.PRODUCTION_PROOF_SCOPE_ENABLED, contactId: PIN_CONTACT, opportunityId: PIN_OPP }, contractProductionEnabled: G.CONTRACT_PRODUCTION_NOT_ENABLED, stages: { underContract: FAKE_STAGE } }),
  pinned_stage_unprovisioned: () => ({ productionProofScope: { enabled: G.PRODUCTION_PROOF_SCOPE_ENABLED, contactId: PIN_CONTACT, opportunityId: PIN_OPP }, contractProductionEnabled: G.CONTRACT_PRODUCTION_ENABLED, stages: { underContract: G.UNDER_CONTRACT_STAGE_NOT_PROVISIONED } }),
  ready: () => ({ productionProofScope: { enabled: G.PRODUCTION_PROOF_SCOPE_ENABLED, contactId: PIN_CONTACT, opportunityId: PIN_OPP }, contractProductionEnabled: G.CONTRACT_PRODUCTION_ENABLED, stages: { underContract: FAKE_STAGE } }),
};
function variant(state) {
  const c = JSON.parse(JSON.stringify(PRODUCTION_ORIGINAL));
  const o = STATES[state]();
  if (o.productionProofScope) c.productionProofScope = o.productionProofScope;
  if (o.contractProductionEnabled) c.contractProductionEnabled = o.contractProductionEnabled;
  if (o.stages) Object.assign(c.stages, o.stages);
  return c;
}
function applyLive(state) {
  const c = variant(state);
  PRODUCTION.productionProofScope = c.productionProofScope;
  PRODUCTION.contractProductionEnabled = c.contractProductionEnabled;
  PRODUCTION.stages.underContract = c.stages.underContract;
}
const EXPECTED_PRE = {
  disabled: 'PRODUCTION_WRITES_DISABLED',
  enabled_unpinned: 'PRODUCTION_PROOF_NOT_PINNED',
  pinned_not_enabled: 'PRODUCTION_WRITES_DISABLED',
  pinned_contracts_disabled: 'PRODUCTION_CONTRACTS_NOT_READY',
  pinned_stage_unprovisioned: 'PRODUCTION_CONTRACTS_NOT_READY',
};

let checks = 0, failures = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { checks++; console.log('PASS ' + name); },
    (err) => { checks++; failures++; console.log('FAIL ' + name + ' -- ' + (err && err.stack || err)); },
  );
}

// ---- Fixture notes (pinned opportunity unless stated).
const fixture = require('./write-contract-fixture.cjs').contractFixture(load, PIN_OPP);
const factsCarriers = load('seller-contract-facts-carriers');
const noteBody = (n) => n.body;
const REPRESENTATION_BODY = fixture.notes.map(noteBody).find((b) => factsCarriers.parseRepresentationFactsNote(b));
const MINIMAL_NOTES = fixture.notes.filter((n) => !factsCarriers.parseRepresentationFactsNote(n.body));
const AUTH_BODY = load('contract-authorization-carriers').formatBradContractAuthorizationNote(fixture.authorization);
const REQUIRED_SIGNERS = [{ role: 'Seller', displayName: 'Jane Seller' }, { role: 'Buyer', displayName: 'Brad Thompson' }];
function manualSend(opportunityId, extra) {
  const built = load('contract-manual-send-model').buildManualContractSendRecordArgs(Object.assign({
    opportunityId, agreementAt: fixture.version.agreementAt, version: fixture.version, requestAt: '2026-09-24T12:00:00.000Z', expirationAt: null,
    providerDocumentId: 'offline-document', providerDocumentReference: null, providerDocumentRevision: 1, recipients: REQUIRED_SIGNERS,
    authorizedRecord: Object.assign({}, fixture.authorization, { opportunityId }), readbackLocationId: 'offline-location', operator: 'brad', recordedAt: '2026-09-24T12:00:00.000Z',
  }, extra || {}));
  if (!built.ok) throw new Error('manual send fixture: ' + JSON.stringify(built.reasons));
  return built.value;
}
const sendCarriers = load('contract-send-carriers');
const MANUAL_SEND_BODY = sendCarriers.formatContractSendNote(manualSend(PIN_OPP));
const AUTOMATED_SEND_BODY = sendCarriers.formatContractSendNote(Object.assign({}, manualSend(PIN_OPP), { templateSource: 'ghl_documents_contracts', requestedTemplateId: 'offline-template' }));
const outcome = load('seller-call-outcome');
const SNAPSHOT = { sellerPosition: 190000, currentOffer: 190000, targetAcquisitionPrice: 180000, maxSupportedOffer: 200000, expectedSpread: 10000, arv: 300000, repairs: 25000, readinessStatus: 'OFFER_READY' };
const PASS_OUTCOME_BODY = outcome.formatOutcomeNote({ opportunityId: PIN_OPP, at: '2026-09-12T00:00:00.000Z', operator: 'brad', kind: 'pass', reason: 'Seller declined', followUpAt: null, snapshot: SNAPSHOT });

// ---- Valid args for every named ghl-write operation.
const VALID_ARGS = {
  'contact.lastCallAttempt': { value: '2026-09-24T12:00:00.000Z' },
  'contact.callback': { value: null },
  'contact.propertyNotes': { value: 'note' },
  'contact.arv': { value: 250000 },
  'contact.disposition': { value: 'No Answer' },
  'contact.routing': { value: 'Stay in Cold Outreach' },
  'contact.dispositionAt': { value: '2026-09-24T12:00:00.000Z' },
  'contact.occupancy': { value: 'Vacant' },
  'note.create': { body: MINIMAL_NOTES[0].body },
  'task.complete': { taskId: 'offline-task' },
  'opportunity.askingPrice': { value: 200000 },
  'opportunity.arv': { value: 300000 },
  'opportunity.repairs': { value: 25000 },
  'opportunity.currentOffer': { value: 190000 },
  'opportunity.assignmentMode': { value: 'Manual' },
  'opportunity.underContractStage': { agreementAt: fixture.version.agreementAt, version: fixture.version },
  'opportunity.underwriting': { endBuyerMaxPrice: 250000, sellerMAO: 190000, assignmentMode: 'Manual' },
};
const ALLOWED_OPERATIONS = ['note.create', 'opportunity.currentOffer', 'opportunity.underContractStage'];
const pinnedTarget = (op) => (op.startsWith('opportunity.') ? PIN_OPP : PIN_CONTACT);
const otherTarget = (op) => (op.startsWith('opportunity.') ? OTHER_OPP : OTHER_CONTACT);

(async () => {
  // ===== 1. Exhaustiveness: nothing can be silently permitted or unclassified.
  await check('every planWrite case is classified, and no stale entry exists', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify/functions/lib/write-contracts.ts'), 'utf8');
    const cases = [...src.matchAll(/case "([a-z]+\.[A-Za-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(Object.keys(scopeLib.PRODUCTION_OPERATION_SCOPE).sort(), cases);
    assert.deepEqual(Object.keys(VALID_ARGS).sort(), cases);
  });
  await check('exactly three operations are permitted, each pinned', () => {
    const permitted = Object.entries(scopeLib.PRODUCTION_OPERATION_SCOPE).filter(([, v]) => v !== 'refused').map(([k, v]) => k + ':' + v).sort();
    assert.deepEqual(permitted, ['note.create:pinned_contact_note', 'opportunity.currentOffer:pinned_opportunity', 'opportunity.underContractStage:pinned_opportunity']);
  });
  await check('every write-note-guard parser is classified, and no stale entry exists', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify/functions/lib/write-note-guard.ts'), 'utf8');
    const list = src.match(/const parsers:[^\n]*?=\s*\[(parse[^\]]*)\]/)[1];
    const names = list.split(',').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(scopeLib.PRODUCTION_NOTE_SCOPE.map((e) => e.parse.name).sort(), names);
    for (const e of scopeLib.PRODUCTION_NOTE_SCOPE) assert.equal(typeof e.parse, 'function', e.parse.name);
  });
  await check('exactly 20 note parsers are permitted (1 accept outcome + 14 facts parsers covering the 15 facts notes + 5 contract-path)', () => {
    const allowed = scopeLib.PRODUCTION_NOTE_SCOPE.filter((e) => e.allow !== null).map((e) => e.parse.name).sort();
    assert.deepEqual(allowed, [
      'parseAddendaApplicabilityFactsNote', 'parseAttorneyManualFieldDispositionNote', 'parseBradContractAuthorizationNote', 'parseBuyerBusinessConfigFactsNote',
      'parseClosingPossessionFactsNote', 'parseContractSendNote', 'parseEarnestMoneyOptionFactsNote', 'parseExecutedTermsAttestationNote',
      'parseLeaseDisclosureFactsNote', 'parseOutcomeNote', 'parsePartySignerFactsNote', 'parsePropertyConditionFactsNote',
      'parsePropertyLegalDescriptionFactsNote', 'parseSellerEquitableInterestDisclosureNote', 'parseSellerNoticeConfirmationFactsNote', 'parseSellerSigningModelNote',
      'parseSettlementExpenseFactsNote', 'parseSignerMappingAttestationNote', 'parseTitleSurveyFactsNote', 'parseUnderContractNote',
    ]);
  });

  // ===== 2. Pure per-operation matrix.
  for (const op of Object.keys(VALID_ARGS)) {
    await check(`matrix ${op}: Test is always ok (unchanged)`, () => {
      assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(TEST, { operation: op, targetId: otherTarget(op), args: VALID_ARGS[op] }), { ok: true });
    });
    for (const [state, code] of Object.entries(EXPECTED_PRE)) {
      await check(`matrix ${op}: Production ${state} -> ${code}`, () => {
        assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(variant(state), { operation: op, targetId: pinnedTarget(op), args: VALID_ARGS[op] }), { ok: false, code });
      });
    }
    const allowed = ALLOWED_OPERATIONS.includes(op);
    await check(`matrix ${op}: Production ready, pinned target -> ${allowed ? 'ok' : 'OPERATION_NOT_PERMITTED'}`, () => {
      assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(variant('ready'), { operation: op, targetId: pinnedTarget(op), args: VALID_ARGS[op] }), allowed ? { ok: true } : { ok: false, code: 'OPERATION_NOT_PERMITTED' });
    });
    await check(`matrix ${op}: Production ready, unpinned target -> ${allowed ? 'TARGET_NOT_PINNED' : 'OPERATION_NOT_PERMITTED'}`, () => {
      assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(variant('ready'), { operation: op, targetId: otherTarget(op), args: VALID_ARGS[op] }), { ok: false, code: allowed ? 'TARGET_NOT_PINNED' : 'OPERATION_NOT_PERMITTED' });
    });
  }
  await check('unknown operation name is refused in Production', () => {
    assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(variant('ready'), { operation: 'contact.do_not_mail', targetId: PIN_CONTACT, args: { value: true } }), { ok: false, code: 'OPERATION_NOT_PERMITTED' });
  });
  await check('pin placeholders and malformed pins are refused', () => {
    for (const [contactId, opportunityId] of [[G.PRODUCTION_PROOF_CONTACT_NOT_PINNED, PIN_OPP], [PIN_CONTACT, G.PRODUCTION_PROOF_OPPORTUNITY_NOT_PINNED], ['', PIN_OPP], [PIN_CONTACT, 'has/slash'], [PIN_CONTACT, 'x'.repeat(65)]]) {
      const c = variant('ready'); c.productionProofScope = { enabled: G.PRODUCTION_PROOF_SCOPE_ENABLED, contactId, opportunityId };
      assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(c, { operation: 'opportunity.currentOffer', targetId: opportunityId, args: VALID_ARGS['opportunity.currentOffer'] }), { ok: false, code: 'PRODUCTION_PROOF_NOT_PINNED' });
    }
  });

  // ===== 3. Note classification with REAL bodies (ready, pinned contact).
  const ready = variant('ready');
  const noteDecision = (body, target = PIN_CONTACT) => scopeLib.evaluateProductionGhlWriteScope(ready, { operation: 'note.create', targetId: target, args: { body } });
  for (const n of MINIMAL_NOTES) {
    const label = n.body.split(/\r?\n/)[0].slice(0, 48);
    await check('real note permitted on the pinned opportunity: ' + label, () => assert.deepEqual(noteDecision(n.body), { ok: true }));
  }
  await check('real notes: authorization and manual send permitted', () => {
    assert.deepEqual(noteDecision(AUTH_BODY), { ok: true });
    assert.deepEqual(noteDecision(MANUAL_SEND_BODY), { ok: true });
  });
  await check('real notes naming another opportunity -> TARGET_NOT_PINNED', () => {
    const other = require('./write-contract-fixture.cjs').contractFixture(load, OTHER_OPP);
    for (const n of other.notes.filter((x) => !factsCarriers.parseRepresentationFactsNote(x.body))) assert.deepEqual(noteDecision(n.body), { ok: false, code: 'TARGET_NOT_PINNED' });
    assert.deepEqual(noteDecision(sendCarriers.formatContractSendNote(manualSend(OTHER_OPP))), { ok: false, code: 'TARGET_NOT_PINNED' });
  });
  await check('real note on the pinned opportunity but another contact target -> TARGET_NOT_PINNED', () => {
    assert.deepEqual(noteDecision(MINIMAL_NOTES[0].body, OTHER_CONTACT), { ok: false, code: 'TARGET_NOT_PINNED' });
  });
  await check('refused real notes: representation, pass outcome, automated send, plain text, malformed ledger header', () => {
    for (const body of [REPRESENTATION_BODY, PASS_OUTCOME_BODY, AUTOMATED_SEND_BODY, 'Called seller, left voicemail.', 'IAOS UNDER CONTRACT — malformed']) {
      assert.deepEqual(noteDecision(body), { ok: false, code: 'NOTE_NOT_PERMITTED' }, body.slice(0, 40));
    }
  });
  await check('note.create with a non-string body is refused', () => {
    assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(ready, { operation: 'note.create', targetId: PIN_CONTACT, args: { body: 42 } }), { ok: false, code: 'NOTE_NOT_PERMITTED' });
  });

  // ===== 4. Every classification entry, via a marker parser swapped in turn.
  for (const entry of scopeLib.PRODUCTION_NOTE_SCOPE) {
    const original = entry.parse;
    const entryName = original.name;
    const markerRecord = (opp, over) => Object.assign({ opportunityId: opp, kind: 'accept', status: 'accepted', templateSource: 'manual_ghl_upload', slot: 'special_provisions' }, over || {});
    const withMarker = async (record, fn) => {
      entry.parse = (body) => (body === 'MARKER-BODY' ? record : original(body));
      try { await fn(); } finally { entry.parse = original; }
    };
    await check(`marker ${entryName}: ${entry.allow ? 'permitted' : 'refused'} on the pinned opportunity`, () => withMarker(markerRecord(PIN_OPP), () => {
      assert.deepEqual(noteDecision('MARKER-BODY'), entry.allow ? { ok: true } : { ok: false, code: 'NOTE_NOT_PERMITTED' });
    }));
    if (entry.allow) {
      await check(`marker ${entryName}: another opportunity -> TARGET_NOT_PINNED`, () => withMarker(markerRecord(OTHER_OPP), () => {
        assert.deepEqual(noteDecision('MARKER-BODY'), { ok: false, code: 'TARGET_NOT_PINNED' });
      }));
    }
  }
  const predicateCases = [
    ['parseOutcomeNote', { kind: 'pass' }], ['parseOutcomeNote', { kind: 'follow_up' }],
    ['parseContractSendNote', { status: 'in_progress' }], ['parseContractSendNote', { templateSource: 'ghl_documents_contracts' }],
    ['parseAttorneyManualFieldDispositionNote', { slot: 'another_slot' }],
  ];
  for (const [name, over] of predicateCases) {
    await check(`predicate ${name} ${JSON.stringify(over)} -> NOTE_NOT_PERMITTED`, async () => {
      const entry = scopeLib.PRODUCTION_NOTE_SCOPE.find((e) => e.parse.name === name);
      const original = entry.parse;
      entry.parse = (body) => (body === 'MARKER-BODY' ? Object.assign({ opportunityId: PIN_OPP, kind: 'accept', status: 'accepted', templateSource: 'manual_ghl_upload', slot: 'special_provisions' }, over) : original(body));
      try { assert.deepEqual(noteDecision('MARKER-BODY'), { ok: false, code: 'NOTE_NOT_PERMITTED' }); } finally { entry.parse = original; }
    });
  }
  await check('a body recognized by two parsers (one refused) is refused', async () => {
    const allowedEntry = scopeLib.PRODUCTION_NOTE_SCOPE.find((e) => e.parse.name === 'parseUnderContractNote');
    const refusedEntry = scopeLib.PRODUCTION_NOTE_SCOPE.find((e) => e.parse.name === 'parseContractLifecycleNote');
    const [a, r] = [allowedEntry.parse, refusedEntry.parse];
    allowedEntry.parse = (b) => (b === 'MARKER-BODY' ? { opportunityId: PIN_OPP } : a(b));
    refusedEntry.parse = (b) => (b === 'MARKER-BODY' ? { opportunityId: PIN_OPP } : r(b));
    try { assert.deepEqual(noteDecision('MARKER-BODY'), { ok: false, code: 'NOTE_NOT_PERMITTED' }); } finally { allowedEntry.parse = a; refusedEntry.parse = r; }
  });

  // ===== 5. Handlers fail closed BEFORE any Blob access or GHL call.
  const writeHandler = require('../netlify/functions/ghl-write.ts').handler;
  const uploadHandler = require('../netlify/functions/ghl-executed-artifact-upload.ts').handler;
  let seq = 0;
  const writeEvent = (operation, targetId, args) => ({ httpMethod: 'POST', headers: { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ operation, targetId, args, requestId: `scope-${++seq}` }) });
  const uploadEvent = (phase, opportunityId) => ({ httpMethod: 'POST', headers: { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ phase, opportunityId, agreementAt: fixture.version.agreementAt, version: fixture.version, uploadId: 'u1', chunkIndex: 0, chunkCount: 1, totalByteCount: 4, originalFileName: 'x.pdf', expectedFullSha256: 'a'.repeat(64), chunkBase64: 'AAAA' }) });
  const snapshot = () => ({ ...blob, ghl: ghlCalls.length });
  async function assertRefusedClean(label, run, code) {
    await check(label, async () => {
      const before = snapshot();
      const res = await run();
      assert.equal(res.statusCode, 403, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.by, 'iaos-production-write-scope');
      if (code) assert.equal(body.code, code);
      assert.deepEqual(snapshot(), before, 'no Blob access and no GHL call on refusal');
    });
  }
  for (const state of Object.keys(EXPECTED_PRE)) {
    applyLive(state);
    for (const op of Object.keys(VALID_ARGS)) {
      await assertRefusedClean(`handler ghl-write ${op}: Production ${state} refused, zero Blob/GHL`, () => writeHandler(writeEvent(op, pinnedTarget(op), VALID_ARGS[op])), EXPECTED_PRE[state]);
    }
    for (const phase of ['chunk', 'finalize']) {
      await assertRefusedClean(`handler upload ${phase}: Production ${state} refused, zero Blob/GHL`, () => uploadHandler(uploadEvent(phase, PIN_OPP)), EXPECTED_PRE[state]);
    }
  }
  applyLive('ready');
  for (const op of Object.keys(VALID_ARGS)) {
    const allowed = ALLOWED_OPERATIONS.includes(op);
    if (!allowed) await assertRefusedClean(`handler ghl-write ${op}: ready but not permitted, zero Blob/GHL`, () => writeHandler(writeEvent(op, pinnedTarget(op), VALID_ARGS[op])), 'OPERATION_NOT_PERMITTED');
    else await assertRefusedClean(`handler ghl-write ${op}: ready, unpinned target refused, zero Blob/GHL`, () => writeHandler(writeEvent(op, otherTarget(op), VALID_ARGS[op])), 'TARGET_NOT_PINNED');
  }
  await assertRefusedClean('handler ghl-write note.create: ready, refused note kind (representation), zero Blob/GHL', () => writeHandler(writeEvent('note.create', PIN_CONTACT, { body: REPRESENTATION_BODY })), 'NOTE_NOT_PERMITTED');
  await assertRefusedClean('handler ghl-write note.create: ready, plain note, zero Blob/GHL', () => writeHandler(writeEvent('note.create', PIN_CONTACT, { body: 'plain note' })), 'NOTE_NOT_PERMITTED');
  await assertRefusedClean('handler upload chunk: ready, unpinned opportunity, zero Blob/GHL', () => uploadHandler(uploadEvent('chunk', OTHER_OPP)), 'TARGET_NOT_PINNED');
  for (const op of ALLOWED_OPERATIONS) {
    await check(`handler ghl-write ${op}: ready + pinned passes the scope gate (reaches Blob/GHL)`, async () => {
      const before = snapshot();
      const args = op === 'note.create' ? { body: MINIMAL_NOTES[0].body } : VALID_ARGS[op];
      const res = await writeHandler(writeEvent(op, pinnedTarget(op), args));
      const body = JSON.parse(res.body);
      assert.notEqual(body.by, 'iaos-production-write-scope');
      assert.ok(blob.connections > before.connections, 'connectLambda reached after the gate');
    });
  }
  // The boundary's own read-only identity reads: GET opportunity, then GET its contact.
  const ownedBy = (contactId) => (url) => {
    const p = new URL(url).pathname;
    if (p === `/opportunities/${PIN_OPP}`) return new Response(JSON.stringify({ opportunity: { id: PIN_OPP, contactId, locationId: PRODUCTION.locationId, customFields: [] } }), { status: 200 });
    if (p === `/contacts/${contactId}`) return new Response(JSON.stringify({ contact: { id: contactId, locationId: PRODUCTION.locationId, customFields: [] } }), { status: 200 });
    throw new Error('unexpected mocked request ' + p);
  };
  await check('handler upload chunk: ready + pinned opportunity owned by ANOTHER contact refused before any Blob read/write', async () => {
    ghlRoute = ownedBy(OTHER_CONTACT);
    try {
      const before = snapshot();
      const res = await uploadHandler(uploadEvent('chunk', PIN_OPP));
      assert.equal(res.statusCode, 403, res.body);
      assert.equal(JSON.parse(res.body).code, 'TARGET_NOT_PINNED');
      assert.equal(blob.reads, before.reads); assert.equal(blob.writes, before.writes);
      const made = ghlCalls.slice(before.ghl);
      assert.equal(made.length, 2, 'only the two read-only identity GETs');
      assert.ok(made.every((c) => c.method === 'GET'));
    } finally { ghlRoute = null; }
  });
  await check('handler upload chunk: ready + pinned opportunity owned by the pinned contact passes the scope gate', async () => {
    ghlRoute = ownedBy(PIN_CONTACT);
    try {
      const res = await uploadHandler(uploadEvent('chunk', PIN_OPP));
      assert.notEqual(JSON.parse(res.body).by, 'iaos-production-write-scope');
    } finally { ghlRoute = null; }
  });
  applyLive('default');
  await check('live Production config is restored to the committed default (both flags ON, pinned to the real synthetic fixture, real stage)', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(PRODUCTION)), PRODUCTION_ORIGINAL);
    assert.equal(PRODUCTION_ORIGINAL.productionProofScope.enabled, G.PRODUCTION_PROOF_SCOPE_ENABLED);
    assert.equal(PRODUCTION_ORIGINAL.contractProductionEnabled, G.CONTRACT_PRODUCTION_ENABLED);
    assert.equal(PRODUCTION_ORIGINAL.productionProofScope.contactId, COMMITTED_FIXTURE_CONTACT);
    assert.equal(PRODUCTION_ORIGINAL.productionProofScope.opportunityId, COMMITTED_FIXTURE_OPP);
    assert.equal(PRODUCTION_ORIGINAL.stages.underContract, 'bf17076b-3830-4479-94bb-b8af70fe9163');
  });

  // ===== 5b. The COMMITTED config (INV-98 enable commit): BOTH flags ON, pinned to the REAL synthetic fixture.
  // Only the three permitted operations on the pinned ids pass; every other operation, target, note kind and
  // upload is refused before any Blob access or GHL call.
  const fixtureNotes = require('./write-contract-fixture.cjs').contractFixture(load, COMMITTED_FIXTURE_OPP).notes.filter((n) => !factsCarriers.parseRepresentationFactsNote(n.body));
  const committedArgs = (op) => (op === 'note.create' ? { body: fixtureNotes[0].body } : VALID_ARGS[op]);
  const committedTarget = (op) => (op.startsWith('opportunity.') ? COMMITTED_FIXTURE_OPP : COMMITTED_FIXTURE_CONTACT);
  const committedOther = (op) => (op.startsWith('opportunity.') ? OTHER_OPP : OTHER_CONTACT);
  for (const op of Object.keys(VALID_ARGS)) {
    const allowed = ALLOWED_OPERATIONS.includes(op);
    await check(`committed config: ${op} on the REAL pinned fixture -> ${allowed ? 'ok' : 'OPERATION_NOT_PERMITTED'}`, () => {
      assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(PRODUCTION, { operation: op, targetId: committedTarget(op), args: committedArgs(op) }), allowed ? { ok: true } : { ok: false, code: 'OPERATION_NOT_PERMITTED' });
    });
    await check(`committed config: ${op} on ANY other target -> ${allowed ? 'TARGET_NOT_PINNED' : 'OPERATION_NOT_PERMITTED'}`, () => {
      assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(PRODUCTION, { operation: op, targetId: committedOther(op), args: committedArgs(op) }), { ok: false, code: allowed ? 'TARGET_NOT_PINNED' : 'OPERATION_NOT_PERMITTED' });
    });
    if (allowed) await assertRefusedClean(`handler committed config: ghl-write ${op} on another target refused, zero Blob/GHL`, () => writeHandler(writeEvent(op, committedOther(op), committedArgs(op))), 'TARGET_NOT_PINNED');
    else await assertRefusedClean(`handler committed config: ghl-write ${op} on the REAL pinned fixture refused, zero Blob/GHL`, () => writeHandler(writeEvent(op, committedTarget(op), committedArgs(op))), 'OPERATION_NOT_PERMITTED');
  }
  await check('committed config: every minimal-set note naming the REAL pinned opportunity is permitted on the REAL pinned contact', () => {
    assert.equal(fixtureNotes.length, 16);
    for (const n of fixtureNotes) assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(PRODUCTION, { operation: 'note.create', targetId: COMMITTED_FIXTURE_CONTACT, args: { body: n.body } }), { ok: true });
  });
  await assertRefusedClean('handler committed config: a refused note kind (representation) on the REAL pinned contact refused, zero Blob/GHL', () => writeHandler(writeEvent('note.create', COMMITTED_FIXTURE_CONTACT, { body: REPRESENTATION_BODY })), 'NOTE_NOT_PERMITTED');
  await assertRefusedClean('handler committed config: a plain note on the REAL pinned contact refused, zero Blob/GHL', () => writeHandler(writeEvent('note.create', COMMITTED_FIXTURE_CONTACT, { body: 'plain note' })), 'NOTE_NOT_PERMITTED');
  await assertRefusedClean('handler committed config: a permitted note kind naming ANOTHER opportunity refused, zero Blob/GHL', () => writeHandler(writeEvent('note.create', COMMITTED_FIXTURE_CONTACT, { body: MINIMAL_NOTES[0].body })), 'TARGET_NOT_PINNED');
  for (const phase of ['chunk', 'finalize']) {
    await assertRefusedClean(`handler committed config: upload ${phase} for another opportunity refused, zero Blob/GHL`, () => uploadHandler(uploadEvent(phase, OTHER_OPP)), 'TARGET_NOT_PINNED');
  }
  for (const op of ALLOWED_OPERATIONS) {
    await check(`handler committed config: ${op} on the REAL pinned fixture passes the scope gate (reaches Blob/GHL)`, async () => {
      const before = snapshot();
      const res = await writeHandler(writeEvent(op, committedTarget(op), committedArgs(op)));
      assert.notEqual(JSON.parse(res.body).by, 'iaos-production-write-scope');
      assert.ok(blob.connections > before.connections, 'connectLambda reached after the gate');
    });
  }
  const committedOwnedBy = (contactId) => (url) => {
    const p = new URL(url).pathname;
    if (p === `/opportunities/${COMMITTED_FIXTURE_OPP}`) return new Response(JSON.stringify({ opportunity: { id: COMMITTED_FIXTURE_OPP, contactId, locationId: PRODUCTION.locationId, customFields: [] } }), { status: 200 });
    if (p === `/contacts/${contactId}`) return new Response(JSON.stringify({ contact: { id: contactId, locationId: PRODUCTION.locationId, customFields: [] } }), { status: 200 });
    throw new Error('unexpected mocked request ' + p);
  };
  await check('handler committed config: upload for the REAL pinned opportunity owned by ANOTHER contact refused before any Blob read/write', async () => {
    ghlRoute = committedOwnedBy(OTHER_CONTACT);
    try {
      const before = snapshot();
      const res = await uploadHandler(uploadEvent('chunk', COMMITTED_FIXTURE_OPP));
      assert.equal(res.statusCode, 403, res.body); assert.equal(JSON.parse(res.body).code, 'TARGET_NOT_PINNED');
      assert.equal(blob.reads, before.reads); assert.equal(blob.writes, before.writes);
      assert.ok(ghlCalls.slice(before.ghl).every((c) => c.method === 'GET'), 'only read-only identity GETs');
    } finally { ghlRoute = null; }
  });
  await check('handler committed config: upload for the REAL pinned opportunity owned by the REAL pinned contact passes the scope gate', async () => {
    ghlRoute = committedOwnedBy(COMMITTED_FIXTURE_CONTACT);
    try { const res = await uploadHandler(uploadEvent('chunk', COMMITTED_FIXTURE_OPP)); assert.notEqual(JSON.parse(res.body).by, 'iaos-production-write-scope'); } finally { ghlRoute = null; }
  });
  await check('committed config: contract environment passes, and readiness is pinned to the REAL fixture', () => {
    assert.deepEqual(readiness.evaluateContractEnvironment(PRODUCTION), { ok: true, environment: 'production' });
    const r = (contactId, opportunityId) => readiness.evaluateContractProviderEvidenceReadiness({ config: PRODUCTION, contact: { id: contactId }, opportunity: { id: opportunityId, contactId }, operatorEmail: 'brad@example.invalid' });
    assert.deepEqual(r(COMMITTED_FIXTURE_CONTACT, COMMITTED_FIXTURE_OPP), { ok: true });
    const other = r(OTHER_CONTACT, OTHER_OPP);
    assert.equal(other.ok, false); assert.deepEqual(other.reasons.map((x) => x.code), ['PRODUCTION_PROOF_SCOPE_MISMATCH']);
  });

  // ===== 6. Readiness pin (PDF generation, readback, derived notes, transition).
  const evidence = (config, contactId, opportunityId) => readiness.evaluateContractProviderEvidenceReadiness({ config, contact: { id: contactId }, opportunity: { id: opportunityId, contactId }, operatorEmail: 'brad@example.invalid' });
  await check('readiness: Production ready + pinned contact/opportunity -> ok', () => assert.deepEqual(evidence(variant('ready'), PIN_CONTACT, PIN_OPP), { ok: true }));
  await check('readiness: Production ready + another contact/opportunity -> PRODUCTION_PROOF_SCOPE_MISMATCH', () => {
    const r = evidence(variant('ready'), OTHER_CONTACT, OTHER_OPP);
    assert.equal(r.ok, false); assert.deepEqual(r.reasons.map((x) => x.code), ['PRODUCTION_PROOF_SCOPE_MISMATCH']);
  });
  await check('readiness: scope ENABLED but pins still placeholders -> PRODUCTION_PROOF_SCOPE_NOT_PINNED', () => {
    const c = variant('ready'); c.productionProofScope = { enabled: G.PRODUCTION_PROOF_SCOPE_ENABLED, contactId: G.PRODUCTION_PROOF_CONTACT_NOT_PINNED, opportunityId: G.PRODUCTION_PROOF_OPPORTUNITY_NOT_PINNED };
    const r = evidence(c, PIN_CONTACT, PIN_OPP);
    assert.equal(r.ok, false); assert.deepEqual(r.reasons.map((x) => x.code), ['PRODUCTION_PROOF_SCOPE_NOT_PINNED']);
  });
  await check('readiness: scope NOT enabled adds no pin reason (no permanent allowlist; the write gate still refuses every write)', () => {
    const c = variant('ready'); c.productionProofScope = { enabled: G.PRODUCTION_PROOF_SCOPE_NOT_ENABLED, contactId: PIN_CONTACT, opportunityId: PIN_OPP };
    assert.deepEqual(evidence(c, OTHER_CONTACT, OTHER_OPP), { ok: true });
    assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(c, { operation: 'opportunity.underContractStage', targetId: OTHER_OPP, args: VALID_ARGS['opportunity.underContractStage'] }), { ok: false, code: 'PRODUCTION_WRITES_DISABLED' });
  });
  await check('readiness: Test is unchanged (approved Test contact ok, any other refused as before)', () => {
    const approved = TEST.documentsContracts.approvedTestContactId;
    assert.deepEqual(evidence(TEST, approved, 'offline-test-opportunity'), { ok: true });
    const r = evidence(TEST, OTHER_CONTACT, OTHER_OPP);
    assert.deepEqual(r.reasons.map((x) => x.code), ['TEST_CONTACT_MISMATCH']);
  });

  // ===== 7. Minimal contract-facts set, against the REAL currentContractContext.
  const { currentContractContext } = require('../netlify/functions/lib/write-contract-context.ts');
  const contactFixture = { id: PIN_CONTACT, firstName: 'Jane', lastName: 'Seller', email: 'seller@example.com', address1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
  const contextFor = (notes) => currentContractContext({
    opportunity: async () => ({ id: PIN_OPP, contactId: PIN_CONTACT }),
    contact: async () => contactFixture,
    notes: async () => notes,
  }, PIN_OPP);
  await check('minimal set (accept outcome + 15 facts, no representation/buyer override) -> complete projection', async () => {
    assert.equal(MINIMAL_NOTES.length, 16);
    const ctx = await contextFor(MINIMAL_NOTES);
    assert.equal(ctx.projection.ok, true, JSON.stringify(ctx.projection.blockingReasons));
  });
  await check('every minimal-set note is permitted by the write scope', () => {
    for (const n of MINIMAL_NOTES) assert.deepEqual(noteDecision(n.body), { ok: true });
  });
  for (let i = 0; i < MINIMAL_NOTES.length; i++) {
    const label = MINIMAL_NOTES[i].body.split(/\r?\n/)[0].slice(0, 48);
    await check('minimality: removing ' + label + ' blocks generation', async () => {
      const without = MINIMAL_NOTES.filter((_, j) => j !== i);
      let blocked;
      try { blocked = (await contextFor(without)).projection.ok === false; } catch { blocked = true; }
      assert.equal(blocked, true);
    });
  }
  await check('accept outcome with ARV and repairs null still yields a complete projection (no opportunity.arv/repairs write needed)', async () => {
    const nulled = MINIMAL_NOTES.map((n) => (outcome.parseOutcomeNote(n.body) ? { body: outcome.formatOutcomeNote({ opportunityId: PIN_OPP, at: fixture.version.agreementAt, operator: 'brad', kind: 'accept', reason: null, followUpAt: null, snapshot: Object.assign({}, SNAPSHOT, { arv: null, repairs: null }) }) } : n));
    const ctx = await contextFor(nulled);
    assert.equal(ctx.projection.ok, true, JSON.stringify(ctx.projection.blockingReasons));
  });

  // ===== 8. Manual-send evidence correction and compatibility.
  const manualModel = load('contract-manual-send-model');
  await check('manual send builder records the explicit no-GHL-template value, ignoring any caller template identity', () => {
    const v = manualSend(PIN_OPP, { templateName: 'PRODUCTION_SEND_NOT_AUTHORIZED_NO_TEMPLATE_CONFIGURED', requestedTemplateId: 'offline-template' });
    assert.equal(manualModel.MANUAL_SEND_NO_GHL_TEMPLATE, 'NONE_MANUAL_GHL_UPLOAD');
    assert.equal(v.requestedTemplateId, 'NONE_MANUAL_GHL_UPLOAD');
    assert.equal(v.templateName, 'NONE_MANUAL_GHL_UPLOAD');
    assert.equal(v.templateSource, 'manual_ghl_upload');
  });
  await check('manual send note round-trips with the no-template value and never carries the Production placeholder', () => {
    const parsed = sendCarriers.parseContractSendNote(MANUAL_SEND_BODY);
    assert.equal(parsed.requestedTemplateId, 'NONE_MANUAL_GHL_UPLOAD');
    assert.equal(parsed.templateName, 'NONE_MANUAL_GHL_UPLOAD');
    assert.ok(!MANUAL_SEND_BODY.includes('PRODUCTION_SEND_NOT_AUTHORIZED'));
  });
  await check('existing Test manual notes (legacy configured template id/name) still parse unchanged', () => {
    const legacy = Object.assign({}, manualSend(PIN_OPP), { templateName: TEST.documentsContracts.expectedTemplateName, requestedTemplateId: TEST.documentsContracts.templateId });
    const parsed = sendCarriers.parseContractSendNote(sendCarriers.formatContractSendNote(legacy));
    assert.ok(parsed, 'legacy note parses');
    assert.equal(parsed.requestedTemplateId, TEST.documentsContracts.templateId);
    assert.equal(parsed.templateName, TEST.documentsContracts.expectedTemplateName);
    assert.equal(parsed.status, 'accepted');
    assert.equal(parsed.providerResponse.documentId, 'offline-document');
  });
  await check('authorization record still carries the TREC form name (unaffected by the manual-send change)', () => {
    const { CONTRACT_DOCUMENT_TEMPLATE_NAME } = load('contract-document-model');
    assert.equal(fixture.authorization.templateName, CONTRACT_DOCUMENT_TEMPLATE_NAME);
    const parsed = load('contract-authorization-carriers').parseBradContractAuthorizationNote(AUTH_BODY);
    assert.equal(parsed.templateName, CONTRACT_DOCUMENT_TEMPLATE_NAME);
    assert.notEqual(CONTRACT_DOCUMENT_TEMPLATE_NAME, 'NONE_MANUAL_GHL_UPLOAD');
  });
  await check('ContractWorkspace no longer passes a template identity to the manual-send builder', () => {
    const src = fs.readFileSync(path.join(APP, 'src/pages/ContractWorkspace.tsx'), 'utf8');
    const call = src.match(/buildManualContractSendRecordArgs\(\{[\s\S]*?\}\);/)[0];
    assert.ok(!/templateName:|requestedTemplateId:/.test(call));
    assert.ok(/readbackLocationId: runtimeConfig\.locationId/.test(call));
  });

  console.log(`production-write-scope checks=${checks} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
