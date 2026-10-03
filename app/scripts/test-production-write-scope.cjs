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
// The store is an in-memory map honouring `onlyIfNew`, so the contact lock and
// the write claim behave as they do in Netlify Blobs. `events` interleaves
// every Blob and GHL call in order.
const blob = { connections: 0, stores: 0, reads: 0, writes: 0 };
const blobData = new Map();
const events = [];
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return {
    connectLambda: () => { blob.connections++; },
    getStore: (storeName) => {
      blob.stores++;
      const k = (key) => `${storeName}:${key}`;
      return {
        async get(key) { blob.reads++; const v = blobData.get(k(key)); return v === undefined ? null : v; },
        async getWithMetadata() { blob.reads++; return null; },
        async getMetadata() { blob.reads++; return null; },
        async list() { blob.reads++; return { blobs: [], directories: [] }; },
        async set(key, value) { blob.writes++; events.push({ kind: 'blob.set', key }); blobData.set(k(key), value); },
        async setJSON(key, value, opts) {
          blob.writes++;
          if (opts && opts.onlyIfNew && blobData.has(k(key))) { events.push({ kind: 'blob.setJSON.exists', key }); return { modified: false }; }
          events.push({ kind: 'blob.setJSON', key }); blobData.set(k(key), value); return { modified: true };
        },
        async delete(key) { blob.writes++; events.push({ kind: 'blob.delete', key }); blobData.delete(k(key)); },
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
  events.push({ kind: 'ghl', method: init.method || 'GET', path: new URL(String(url)).pathname, body: init.body });
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
// Board #9 enable commit -- BOTH flags ON). Every other state sets stage,
// pins and flags EXPLICITLY -- none inherits the committed values -- so each
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
  // B14-12: the Board #9 matrix tests Board #9 alone, so the call-log class is
  // OFF in every variant unless a check switches it on itself.
  if (state !== 'default') c.productionCallLog = G.PRODUCTION_CALL_LOG_DISABLED;   // 'default' = the committed config, unchanged
  return c;
}
function applyLive(state) {
  const c = variant(state);
  PRODUCTION.productionProofScope = c.productionProofScope;
  PRODUCTION.contractProductionEnabled = c.contractProductionEnabled;
  PRODUCTION.stages.underContract = c.stages.underContract;
  PRODUCTION.productionCallLog = c.productionCallLog;
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
  'contact.callLogResult': { value: 'Spoke with Seller' },
  'contact.explicitCallback': { value: '2026-10-09T19:30:00.000Z' },
  'contact.occupancy': { value: 'Vacant' },
  'note.create': { body: MINIMAL_NOTES[0].body },
  'task.complete': { taskId: 'offline-task' },
  'opportunity.askingPrice': { value: 200000 },
  'opportunity.arv': { value: 485000 },
  'opportunity.repairs': { value: 52000 },
  'opportunity.currentOffer': { value: 190000 },
  'opportunity.assignmentMode': { value: 'Manual' },
  'opportunity.underContractStage': { agreementAt: fixture.version.agreementAt, version: fixture.version },
  'opportunity.underwriting': { endBuyerMaxPrice: 250000, sellerMAO: 190000, assignmentMode: 'Manual' },
};
const ALLOWED_OPERATIONS = ['contact.lastCallAttempt', 'note.create', 'opportunity.arv', 'opportunity.currentOffer', 'opportunity.repairs', 'opportunity.underContractStage'];
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
  await check('exactly six operations are permitted, each pinned', () => {
    const permitted = Object.entries(scopeLib.PRODUCTION_OPERATION_SCOPE).filter(([, v]) => v !== 'refused').map(([k, v]) => k + ':' + v).sort();
    assert.deepEqual(permitted, [
      'contact.lastCallAttempt:pinned_contact', 'note.create:pinned_contact_note',
      'opportunity.arv:pinned_opportunity_value', 'opportunity.currentOffer:pinned_opportunity',
      'opportunity.repairs:pinned_opportunity_value', 'opportunity.underContractStage:pinned_opportunity',
    ]);
    assert.deepEqual({ ...scopeLib.PRODUCTION_PINNED_VALUES }, { 'opportunity.arv': 485000, 'opportunity.repairs': 52000 });
    assert.deepEqual([...scopeLib.PRODUCTION_PAIRED_OPERATIONS].sort(), ['contact.lastCallAttempt', 'opportunity.arv', 'opportunity.repairs']);
  });
  await check('every write-note-guard parser is classified, and no stale entry exists', () => {
    const src = fs.readFileSync(path.join(APP, 'netlify/functions/lib/write-note-guard.ts'), 'utf8');
    const list = src.match(/const parsers:[^\n]*?=\s*\[(parse[^\]]*)\]/)[1];
    const names = list.split(',').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(scopeLib.PRODUCTION_NOTE_SCOPE.map((e) => e.parse.name).sort(), names);
    for (const e of scopeLib.PRODUCTION_NOTE_SCOPE) assert.equal(typeof e.parse, 'function', e.parse.name);
  });
  await check('exactly 23 note parsers are permitted (20 contract-path + readiness OVERRIDE + ARV OVERRIDE + disposition handoff)', () => {
    const allowed = scopeLib.PRODUCTION_NOTE_SCOPE.filter((e) => e.allow !== null).map((e) => e.parse.name).sort();
    assert.deepEqual(allowed, [
      'parseAddendaApplicabilityFactsNote', 'parseArvApprovalNote', 'parseAttorneyManualFieldDispositionNote', 'parseBradContractAuthorizationNote', 'parseBuyerBusinessConfigFactsNote',
      'parseClosingPossessionFactsNote', 'parseContractSendNote', 'parseDispositionHandoffNote', 'parseEarnestMoneyOptionFactsNote', 'parseExecutedTermsAttestationNote',
      'parseLeaseDisclosureFactsNote', 'parseOutcomeNote', 'parsePartySignerFactsNote', 'parsePropertyConditionFactsNote',
      'parsePropertyLegalDescriptionFactsNote', 'parseReadinessHumanActionNote', 'parseSellerEquitableInterestDisclosureNote', 'parseSellerNoticeConfirmationFactsNote', 'parseSellerSigningModelNote',
      'parseSettlementExpenseFactsNote', 'parseSignerMappingAttestationNote', 'parseTitleSurveyFactsNote', 'parseUnderContractNote',
    ]);
  });
  await check('still refused: approved readiness decisions, invalidations, the Contract Ready checklist and every Board #8 evidence note', () => {
    const refused = scopeLib.PRODUCTION_NOTE_SCOPE.filter((e) => e.allow === null).map((e) => e.parse.name);
    for (const name of ['parseReadinessDecisionInvalidationNote', 'parseContractReadyChecklistNote', 'parsePropertyIdentityConfirmationNote', 'parseTransactionAssumptionsNote', 'parseSellerPricePositionNote', 'parseNegotiationOverrideNote', 'parseContractLifecycleNote']) assert.ok(refused.includes(name), name);
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
    const markerKind = entryName === 'parseReadinessHumanActionNote' ? 'overridden' : 'accept';
    const markerRecord = (opp, over) => Object.assign({ opportunityId: opp, contactId: PIN_CONTACT, kind: markerKind, status: 'accepted', templateSource: 'manual_ghl_upload', slot: 'special_provisions', decision: 'OVERRIDE', approvedArv: 485000 }, over || {});
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
    ['parseReadinessHumanActionNote', { kind: 'approved' }],
    ['parseArvApprovalNote', { decision: 'APPROVED' }],
    ['parseArvApprovalNote', { approvedArv: 485000.01 }],
    ['parseArvApprovalNote', { approvedArv: 485001 }],
    ['parseArvApprovalNote', { approvedArv: '485000' }],
  ];
  for (const [name, over] of predicateCases) {
    await check(`predicate ${name} ${JSON.stringify(over)} -> NOTE_NOT_PERMITTED`, async () => {
      const entry = scopeLib.PRODUCTION_NOTE_SCOPE.find((e) => e.parse.name === name);
      const original = entry.parse;
      const base = { opportunityId: PIN_OPP, kind: name === 'parseReadinessHumanActionNote' ? 'overridden' : 'accept', status: 'accepted', templateSource: 'manual_ghl_upload', slot: 'special_provisions', decision: 'OVERRIDE', approvedArv: 485000 };
      entry.parse = (body) => (body === 'MARKER-BODY' ? Object.assign(base, over) : original(body));
      try { assert.deepEqual(noteDecision('MARKER-BODY'), { ok: false, code: 'NOTE_NOT_PERMITTED' }); } finally { entry.parse = original; }
    });
  }
  await check('disposition handoff naming the pinned opportunity but ANOTHER contact -> TARGET_NOT_PINNED', async () => {
    const entry = scopeLib.PRODUCTION_NOTE_SCOPE.find((e) => e.parse.name === 'parseDispositionHandoffNote');
    const original = entry.parse;
    entry.parse = (body) => (body === 'MARKER-BODY' ? { opportunityId: PIN_OPP, contactId: OTHER_CONTACT } : original(body));
    try { assert.deepEqual(noteDecision('MARKER-BODY'), { ok: false, code: 'TARGET_NOT_PINNED' }); } finally { entry.parse = original; }
  });
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
  // ===== 5c. Walkthrough allowances: strict values, real note bodies, paired ownership.
  const valueDecision = (op, targetId, value) => scopeLib.evaluateProductionGhlWriteScope(ready, { operation: op, targetId, args: { value } });
  for (const [op, pinned] of [['opportunity.arv', 485000], ['opportunity.repairs', 52000]]) {
    await check(`${op}: pinned opportunity with exactly ${pinned} -> ok`, () => assert.deepEqual(valueDecision(op, PIN_OPP, pinned), { ok: true }));
    await check(`${op}: any other value is refused (near, string, null, the other field's value)`, () => {
      for (const v of [pinned + 0.01, pinned - 1, pinned + 1, String(pinned), null, undefined, op === 'opportunity.arv' ? 52000 : 485000]) {
        assert.deepEqual(valueDecision(op, PIN_OPP, v), { ok: false, code: 'OPERATION_NOT_PERMITTED' }, JSON.stringify(v));
      }
    });
    await check(`${op}: another opportunity -> TARGET_NOT_PINNED`, () => assert.deepEqual(valueDecision(op, OTHER_OPP, pinned), { ok: false, code: 'TARGET_NOT_PINNED' }));
  }

  // Real readiness decision and ARV approval note bodies.
  const readinessCarriers = load('seller-call-readiness-carriers');
  const DEAL_INPUTS = { sellingCostPct: null, closingCost: null, monthlyCarry: null, holdMonths: null, buyerProfitPct: null, standardMinimum: null, profitSharePct: null, assignmentMode: 'unresolved', assignmentAmount: null, financingKind: 'unresolved', financingLtv: null, financingRate: null, financingPoints: null };
  const BLANK_SNAPSHOT = {
    propertyIdentity: { confirmed: false, address: null }, repairsCondition: { amount: null, approved: false }, arv: { amount: null, evidenceState: null },
    dealEconomics: { status: 'unavailable', maxSupportedOffer: null, targetStatus: null, targetValue: null, inputs: DEAL_INPUTS },
    transactionAssumptions: null, sellerPricePosition: null,
  };
  const readinessNote = (kind, opportunityId) => readinessCarriers.formatReadinessHumanActionNote(kind === 'overridden'
    ? { opportunityId, at: '2026-09-29T12:00:00.000Z', operator: null, kind, reason: 'INV-98 pinned synthetic walkthrough', snapshot: BLANK_SNAPSHOT }
    : { opportunityId, at: '2026-09-29T12:00:00.000Z', operator: null, kind, reason: null, snapshot: BLANK_SNAPSHOT });
  const OVERRIDE_BODY = readinessNote('overridden', PIN_OPP);
  await check('real readiness note: the fixture snapshot round-trips (the body is a genuine ledger entry)', () => {
    const parsed = readinessCarriers.parseReadinessHumanActionNote(OVERRIDE_BODY);
    assert.ok(parsed, 'parses'); assert.equal(parsed.kind, 'overridden'); assert.equal(parsed.opportunityId, PIN_OPP);
  });
  await check('real readiness note: OVERRIDDEN on the pinned opportunity -> ok', () => assert.deepEqual(noteDecision(OVERRIDE_BODY), { ok: true }));
  await check('real readiness note: OVERRIDDEN naming another opportunity -> TARGET_NOT_PINNED', () => assert.deepEqual(noteDecision(readinessNote('overridden', OTHER_OPP)), { ok: false, code: 'TARGET_NOT_PINNED' }));
  await check('real readiness note: OVERRIDDEN written to another contact -> TARGET_NOT_PINNED', () => assert.deepEqual(noteDecision(OVERRIDE_BODY, OTHER_CONTACT), { ok: false, code: 'TARGET_NOT_PINNED' }));
  await check('real readiness note: APPROVED -> NOTE_NOT_PERMITTED', () => assert.deepEqual(noteDecision(readinessNote('approved', PIN_OPP)), { ok: false, code: 'NOTE_NOT_PERMITTED' }));
  await check('real readiness invalidation note -> NOTE_NOT_PERMITTED', () => {
    const body = readinessCarriers.formatReadinessDecisionInvalidationNote({ opportunityId: PIN_OPP, at: '2026-09-29T12:05:00.000Z', operator: null, decisionAt: '2026-09-29T12:00:00.000Z', reasons: ['evidence changed'] });
    assert.deepEqual(noteDecision(body), { ok: false, code: 'NOTE_NOT_PERMITTED' });
  });
  const arvPersist = load('arv-persist');
  const arvProvenance = (opportunityId) => ({ approvedAt: '2026-09-29T12:10:00.000Z', operator: 'Brad Thompson', opportunityId, evidenceState: 'INSUFFICIENT', reconciliationOutcome: 'INSUFFICIENT EVIDENCE', acceptedCompCount: 0, searchLevel: 'STANDARD', source: { kind: 'PROPSTREAM_COMPARABLE_CSV', version: 'propstream-comparable-csv-v1', fileName: 'offline-synthetic.csv', importedAt: '2026-09-29T12:09:00.000Z' } });
  const arvNote = (approval, opportunityId) => arvPersist.formatArvApprovalNote(approval, arvProvenance(opportunityId));
  const ARV_OVERRIDE_BODY = arvNote({ kind: 'overridden', amount: 485000, recommendedArv: null, revision: 1 }, PIN_OPP);
  await check('real ARV note: OVERRIDE 485000 on the pinned opportunity -> ok', () => assert.deepEqual(noteDecision(ARV_OVERRIDE_BODY), { ok: true }));
  await check('real ARV note: OVERRIDE of any other amount -> NOTE_NOT_PERMITTED', () => {
    for (const amount of [485001, 484999, 485000.5]) assert.deepEqual(noteDecision(arvNote({ kind: 'overridden', amount, recommendedArv: null, revision: 1 }, PIN_OPP)), { ok: false, code: 'NOTE_NOT_PERMITTED' }, String(amount));
  });
  await check('real ARV note: APPROVED (even at 485000) -> NOTE_NOT_PERMITTED', () => {
    assert.deepEqual(noteDecision(arvNote({ kind: 'approved', amount: 485000, recommendedArv: 485000, revision: 1 }, PIN_OPP)), { ok: false, code: 'NOTE_NOT_PERMITTED' });
  });
  await check('real ARV note: OVERRIDE 485000 naming another opportunity -> TARGET_NOT_PINNED', () => {
    assert.deepEqual(noteDecision(arvNote({ kind: 'overridden', amount: 485000, recommendedArv: null, revision: 1 }, OTHER_OPP)), { ok: false, code: 'TARGET_NOT_PINNED' });
  });

  // Paired ownership, pure.
  const SELLER_LEADS = PRODUCTION.pipelines.sellerLeads;
  const pinnedOpp = (over) => Object.assign({ id: PIN_OPP, contactId: PIN_CONTACT, pipelineId: SELLER_LEADS }, over || {});
  await check('ownership: Test deployment is always ok and never requires the check', () => {
    assert.deepEqual(scopeLib.evaluateProductionPairedOwnership(TEST, null), { ok: true });
    for (const op of scopeLib.PRODUCTION_PAIRED_OPERATIONS) assert.equal(scopeLib.requiresProductionPairedOwnership(TEST, op), false);
  });
  await check('ownership: required in Production for exactly the three paired operations', () => {
    for (const op of Object.keys(VALID_ARGS)) assert.equal(scopeLib.requiresProductionPairedOwnership(ready, op), ['contact.lastCallAttempt', 'opportunity.arv', 'opportunity.repairs'].includes(op), op);
  });
  await check('ownership: a disabled config refuses with PRODUCTION_WRITES_DISABLED', () => {
    assert.deepEqual(scopeLib.evaluateProductionPairedOwnership(variant('disabled'), pinnedOpp()), { ok: false, code: 'PRODUCTION_WRITES_DISABLED' });
  });
  await check('ownership: the exact pinned pair in Seller Leads -> ok', () => assert.deepEqual(scopeLib.evaluateProductionPairedOwnership(ready, pinnedOpp()), { ok: true }));
  await check('ownership: wrong opportunity id, another owner, another pipeline, missing fields or no read -> TARGET_NOT_PINNED', () => {
    for (const o of [pinnedOpp({ id: OTHER_OPP }), pinnedOpp({ contactId: OTHER_CONTACT }), pinnedOpp({ pipelineId: 'offline-other-pipeline' }), { id: PIN_OPP }, null, undefined]) {
      assert.deepEqual(scopeLib.evaluateProductionPairedOwnership(ready, o), { ok: false, code: 'TARGET_NOT_PINNED' }, JSON.stringify(o));
    }
  });

  // Paired ownership and the full write path, through the ghl-write handler.
  const F = { arv: PRODUCTION.opportunityFacts.arv, repairs: PRODUCTION.opportunityFacts.repairs, lca: PRODUCTION.fields.lastCallAttempt, lcaPrecise: PRODUCTION.fields.lastCallAttemptPrecise };
  function makeGhlWorld(opts = {}) {
    const world = {
      opportunity: { id: PIN_OPP, locationId: PRODUCTION.locationId, contactId: opts.owner || PIN_CONTACT, pipelineId: opts.pipelineId || SELLER_LEADS, pipelineStageId: opts.stageId, customFields: (opts.oppFields || []).slice() },
      contacts: {
        [PIN_CONTACT]: Object.assign({ id: PIN_CONTACT, locationId: PRODUCTION.locationId, customFields: [] }, opts.contactExtra || {}),
        [OTHER_CONTACT]: { id: OTHER_CONTACT, locationId: PRODUCTION.locationId, customFields: [] },
      },
      notes: (opts.notes || []).map((n, i) => ({ id: `seed-note-${i}`, body: n.body })),
    };
    let oppGets = 0, noteSeq = 0;
    const res = (status, body) => new Response(JSON.stringify(body), { status });
    const apply = (list, fields, valueKey) => {
      for (const f of fields) {
        const i = list.findIndex((x) => x.id === f.id);
        if (i >= 0) list.splice(i, 1);
        if (f.field_value !== '' && f.field_value !== null) list.push({ id: f.id, [valueKey]: f.field_value });
      }
    };
    world.route = async (url, init) => {
      const u = new URL(url); const method = init.method || 'GET'; const p = u.pathname;
      if (p === `/opportunities/${PIN_OPP}`) {
        if (method === 'GET') {
          oppGets++;
          if (opts.failOppGetAt && oppGets >= opts.failOppGetAt) return res(500, { message: 'unavailable' });
          // Ownership that changes between reads: the Nth opportunity GET reports ownerSequence[N-1] (the last entry repeats).
          if (opts.ownerSequence) world.opportunity.contactId = opts.ownerSequence[Math.min(oppGets, opts.ownerSequence.length) - 1];
          const copy = JSON.parse(JSON.stringify(world.opportunity));
          // Live GHL omits `customFields` entirely while an opportunity has no custom values.
          if (opts.omitEmptyOppFields && copy.customFields.length === 0) delete copy.customFields;
          if (Object.prototype.hasOwnProperty.call(opts, 'oppCustomFieldsRaw')) copy.customFields = opts.oppCustomFieldsRaw;
          return res(200, { opportunity: copy });
        }
        if (method === 'PUT') {
          if (opts.putFails === 'throw') throw new Error('socket hang up');
          if (opts.putFails === 'status') return res(500, { message: 'boom' });
          if (!opts.putNotApplied) apply(world.opportunity.customFields, JSON.parse(init.body).customFields, 'fieldValue');
          if (opts.readbackFails) opts.failOppGetAt = oppGets + 1;
          return res(200, { succeded: true });
        }
      }
      const c = p.match(/^\/contacts\/([^/]+)$/);
      if (c && world.contacts[c[1]]) {
        if (method === 'GET') return res(200, { contact: JSON.parse(JSON.stringify(world.contacts[c[1]])) });
        if (method === 'PUT') {
          if (opts.putFails === 'throw') throw new Error('socket hang up');
          if (!opts.putNotApplied) apply(world.contacts[c[1]].customFields, JSON.parse(init.body).customFields, 'value');
          // The write lands in GHL but the response is lost: the true indeterminate case.
          if (opts.contactPutAppliedThenThrow) throw new Error('response lost after the write landed');
          return res(200, { succeded: true });
        }
      }
      const n = p.match(/^\/contacts\/([^/]+)\/notes$/);
      if (n && n[1] === PIN_CONTACT) {
        if (method === 'GET') return res(200, { notes: world.notes });
        if (method === 'POST') { const note = { id: `offline-note-${++noteSeq}`, body: JSON.parse(init.body).body }; world.notes.push(note); return res(200, { note }); }
      }
      throw new Error('unexpected mocked request ' + method + ' ' + p);
    };
    return world;
  }
  // requestId must satisfy ghl-write's identifier() rule; labels are sanitized, never widened.
  const fixedEvent = (operation, targetId, args, requestId) => ({ httpMethod: 'POST', headers: { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, authorization: `Bearer ${auth.issueAppSession('brad@example.invalid').token}` }, body: JSON.stringify({ operation, targetId, args, requestId: requestId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) }) });
  /** Runs one handler call against a mocked world and returns the response plus the ordered events it produced. */
  async function runWorld(world, event) {
    const start = events.length;
    ghlRoute = world.route;
    try {
      const res = await writeHandler(event);
      return { res, body: JSON.parse(res.body), ev: events.slice(start) };
    } finally { ghlRoute = null; }
  }
  const isLockKey = (e) => typeof e.key === 'string' && e.key.startsWith('lock/');
  const claims = (ev) => ev.filter((e) => e.kind === 'blob.setJSON' && !isLockKey(e));
  const puts = (ev) => ev.filter((e) => e.kind === 'ghl' && (e.method === 'PUT' || e.method === 'POST'));
  const lockReleased = (ev) => ev.some((e) => e.kind === 'blob.setJSON' && isLockKey(e)) && ev.some((e) => e.kind === 'blob.delete' && isLockKey(e));
  const noLockHeld = () => ![...blobData.keys()].some((k) => k.includes(':lock/'));

  const FIELD_CASES = [
    ['opportunity.arv', PIN_OPP, 485000, `/opportunities/${PIN_OPP}`, [{ id: F.arv, field_value: 485000 }]],
    ['opportunity.repairs', PIN_OPP, 52000, `/opportunities/${PIN_OPP}`, [{ id: F.repairs, field_value: 52000 }]],
    ['contact.lastCallAttempt', PIN_CONTACT, '2026-09-29T12:00:00.000Z', `/contacts/${PIN_CONTACT}`, [{ id: F.lca, field_value: '2026-09-29T12:00:00.000Z' }, { id: F.lcaPrecise, field_value: '2026-09-29T12:00:00.000Z' }]],
  ];
  for (const [op, target, value, putPath, expectedFields] of FIELD_CASES) {
    await check(`handler ${op}: success -- ownership read under the lock BEFORE the claim, one PUT, confirmed readback, lock released`, async () => {
      const world = makeGhlWorld();
      const { res, body, ev } = await runWorld(world, fixedEvent(op, target, { value }, `ok-${op}`));
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(body.confirmed, true);
      const p = puts(ev);
      assert.equal(p.length, 1); assert.equal(p[0].path, putPath);
      assert.deepEqual(JSON.parse(p[0].body).customFields.map(({ id, field_value }) => ({ id, field_value })), expectedFields);
      const lockAt = ev.findIndex((e) => e.kind === 'blob.setJSON' && isLockKey(e));
      const claimAt = ev.findIndex((e) => e.kind === 'blob.setJSON' && !isLockKey(e));
      const oppReadsUnderLock = ev.map((e, i) => ({ e, i })).filter(({ e, i }) => i > lockAt && i < claimAt && e.kind === 'ghl' && e.method === 'GET' && e.path === `/opportunities/${PIN_OPP}`);
      assert.ok(lockAt >= 0 && claimAt > lockAt, 'lock precedes claim');
      assert.ok(oppReadsUnderLock.length >= 1, 'the pinned opportunity is read under the lock before the claim');
      assert.ok(ev.findIndex((e) => e.kind === 'ghl' && e.method === 'PUT') > claimAt, 'PUT only after the claim');
      assert.ok(lockReleased(ev) && noLockHeld(), 'lock released');
    });
    for (const [label, opts] of [['owned by ANOTHER contact', { owner: OTHER_CONTACT }], ['in ANOTHER pipeline', { pipelineId: 'offline-other-pipeline' }]]) {
      await check(`handler ${op}: pinned opportunity ${label} -> 403 TARGET_NOT_PINNED, no claim, no PUT, lock released`, async () => {
        const world = makeGhlWorld(opts);
        // For an opportunity-targeted write the lock is taken on the opportunity's recorded owner.
        const { res, body, ev } = await runWorld(world, fixedEvent(op, target, { value }, `own-${op}-${label}`));
        assert.equal(res.statusCode, 403, res.body);
        assert.equal(body.by, 'iaos-production-write-scope'); assert.equal(body.code, 'TARGET_NOT_PINNED');
        assert.equal(claims(ev).length, 0, 'no write claim'); assert.equal(puts(ev).length, 0, 'no PUT');
        assert.ok(ev.filter((e) => e.kind === 'ghl').every((e) => e.method === 'GET'), 'only read-only GETs');
        assert.ok(lockReleased(ev) && noLockHeld(), 'lock released');
      });
    }
  }
  // INV-98 Board #9 first-write 409 (2026-09-29): the pinned Production
  // opportunity had no custom values, so GHL's GET omitted `customFields`
  // and the boundary refused it as ambiguous before the lock. Omission is an
  // empty field list; identity, ownership and malformed values still refuse.
  for (const [op, value] of [['opportunity.arv', 485000], ['opportunity.repairs', 52000]]) {
    await check(`${op}: GET omits customFields on a new opportunity -> 200, one PUT, confirmed readback, lock released`, async () => {
      const world = makeGhlWorld({ omitEmptyOppFields: true });
      const { res, body, ev } = await runWorld(world, fixedEvent(op, PIN_OPP, { value }, `omitted-${op}`));
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(body.confirmed, true);
      assert.equal(puts(ev).length, 1); assert.equal(claims(ev).length, 1);
      assert.equal(world.opportunity.customFields.find((f) => f.id === (op === 'opportunity.arv' ? F.arv : F.repairs)).fieldValue, value);
      assert.ok(lockReleased(ev) && noLockHeld(), 'lock released');
    });
    for (const [label, opts] of [['owned by ANOTHER contact', { owner: OTHER_CONTACT }], ['in ANOTHER pipeline', { pipelineId: 'offline-other-pipeline' }]]) {
      await check(`${op}: GET omits customFields AND the pinned opportunity is ${label} -> 403 TARGET_NOT_PINNED, no claim, no PUT`, async () => {
        const world = makeGhlWorld(Object.assign({ omitEmptyOppFields: true }, opts));
        const { res, body, ev } = await runWorld(world, fixedEvent(op, PIN_OPP, { value }, `omitted-own-${op}-${label}`));
        assert.equal(res.statusCode, 403, res.body);
        assert.equal(body.code, 'TARGET_NOT_PINNED');
        assert.equal(claims(ev).length, 0); assert.equal(puts(ev).length, 0);
        assert.ok(noLockHeld(), 'no lock left held');
      });
    }
    for (const [label, raw] of [['null', null], ['an object', {}], ['a string', 'x'], ['a number', 0]]) {
      await check(`${op}: customFields present but ${label} -> still refused as ambiguous (409), no claim, no PUT, no lock held`, async () => {
        const world = makeGhlWorld({ oppCustomFieldsRaw: raw });
        const { res, body, ev } = await runWorld(world, fixedEvent(op, PIN_OPP, { value }, `malformed-${op}-${label}`));
        assert.equal(res.statusCode, 409, res.body);
        assert.deepEqual(body, { error: 'Write refused or unconfirmed; refresh and inspect before retrying' });
        assert.equal(claims(ev).length, 0); assert.equal(puts(ev).length, 0);
        assert.ok(noLockHeld(), 'no lock left held');
      });
    }
  }
  // Bones REVISE item 1: the lock is always the CONFIGURED pinned contact's,
  // whatever owner the first (unlocked) read reports; ownership is then
  // re-proven under that lock before any claim or PUT.
  const { digest: boundaryDigest } = require('../netlify/functions/lib/ghl-write-boundary.ts');
  const PINNED_LOCK_KEY = 'lock/' + boundaryDigest(PRODUCTION.locationId + PIN_CONTACT);
  const OTHER_LOCK_KEY = 'lock/' + boundaryDigest(PRODUCTION.locationId + OTHER_CONTACT);
  const lockKeysTaken = (ev) => ev.filter((e) => e.kind === 'blob.setJSON' && isLockKey(e)).map((e) => e.key);
  for (const [op, value] of [['opportunity.arv', 485000], ['opportunity.repairs', 52000]]) {
    await check(`${op}: first read says ANOTHER owner, locked re-read says the pinned contact -> the PINNED contact's lock is taken, ownership passes, one PUT`, async () => {
      const world = makeGhlWorld({ ownerSequence: [OTHER_CONTACT, PIN_CONTACT] });
      const { res, body, ev } = await runWorld(world, fixedEvent(op, PIN_OPP, { value }, `owner-flip-in-${op}`));
      assert.equal(res.statusCode, 200, res.body); assert.equal(body.confirmed, true);
      assert.deepEqual(lockKeysTaken(ev), [PINNED_LOCK_KEY], 'exactly the pinned contact lock, never the first-read owner');
      assert.ok(!lockKeysTaken(ev).includes(OTHER_LOCK_KEY));
      assert.equal(puts(ev).length, 1); assert.ok(lockReleased(ev) && noLockHeld());
    });
    await check(`${op}: first read says the pinned contact, locked re-read says ANOTHER owner -> pinned lock taken, 403 TARGET_NOT_PINNED, no claim, no PUT`, async () => {
      const world = makeGhlWorld({ ownerSequence: [PIN_CONTACT, OTHER_CONTACT] });
      const { res, body, ev } = await runWorld(world, fixedEvent(op, PIN_OPP, { value }, `owner-flip-out-${op}`));
      assert.equal(res.statusCode, 403, res.body); assert.equal(body.code, 'TARGET_NOT_PINNED');
      assert.deepEqual(lockKeysTaken(ev), [PINNED_LOCK_KEY]);
      assert.equal(claims(ev).length, 0); assert.equal(puts(ev).length, 0);
      assert.ok(lockReleased(ev) && noLockHeld());
    });
    await check(`${op}: owned by another contact on every read -> the lock is still the PINNED contact's, then 403`, async () => {
      const world = makeGhlWorld({ owner: OTHER_CONTACT });
      const { res, ev } = await runWorld(world, fixedEvent(op, PIN_OPP, { value }, `owner-other-${op}`));
      assert.equal(res.statusCode, 403, res.body);
      assert.deepEqual(lockKeysTaken(ev), [PINNED_LOCK_KEY]);
    });
  }
  await check('lock target in Test is unchanged: the paired-lock rule never applies outside Production', () => {
    for (const op of ['opportunity.arv', 'opportunity.repairs', 'opportunity.currentOffer']) assert.equal(scopeLib.requiresProductionPairedOwnership(TEST, op), false, op);
    const src = fs.readFileSync(path.join(APP, 'netlify/functions/ghl-write.ts'), 'utf8');
    assert.ok(/lockContact\(pairedProduction && isOpportunityTargeted \? config\.productionProofScope\.contactId : contactId\)/.test(src), 'every other case still locks the target-derived contact');
  });

  await check('handler contact.lastCallAttempt: the pinned opportunity cannot be read -> 409, no claim, no PUT, lock released', async () => {
    const world = makeGhlWorld({ failOppGetAt: 1 });
    const { res, ev } = await runWorld(world, fixedEvent('contact.lastCallAttempt', PIN_CONTACT, { value: '2026-09-29T12:00:00.000Z' }, 'lca-oppfail'));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(claims(ev).length, 0); assert.equal(puts(ev).length, 0);
    assert.ok(lockReleased(ev) && noLockHeld());
  });
  await check('handler opportunity.arv: the locked re-read fails -> 409, no claim, no PUT, lock released', async () => {
    const world = makeGhlWorld({ failOppGetAt: 2 });
    const { res, ev } = await runWorld(world, fixedEvent('opportunity.arv', PIN_OPP, { value: 485000 }, 'arv-reread-fail'));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(claims(ev).length, 0); assert.equal(puts(ev).length, 0);
    assert.ok(lockReleased(ev) && noLockHeld());
  });
  for (const [label, value, status] of [['485000.01', 485000.01, 403], ['485001', 485001, 403], ['52000 (the repairs value)', 52000, 403], ['the string "485000"', '485000', 400]]) {
    await check(`handler opportunity.arv ${label}: refused before connectLambda, the lock, any claim or GHL call (HTTP ${status})`, async () => {
      const world = makeGhlWorld(); const before = snapshot();
      const { res, ev } = await runWorld(world, fixedEvent('opportunity.arv', PIN_OPP, { value }, `bad-arv-${label}`));
      assert.equal(res.statusCode, status, res.body);
      if (status === 403) assert.equal(JSON.parse(res.body).code, 'OPERATION_NOT_PERMITTED');
      assert.equal(ev.length, 0, 'no Blob or GHL event'); assert.equal(blob.connections, before.connections);
    });
  }
  await check('handler opportunity.repairs 52000.5: refused OPERATION_NOT_PERMITTED, no Blob/GHL', async () => {
    const world = makeGhlWorld();
    const { res, ev } = await runWorld(world, fixedEvent('opportunity.repairs', PIN_OPP, { value: 52000.5 }, 'bad-rep'));
    assert.equal(res.statusCode, 403); assert.equal(JSON.parse(res.body).code, 'OPERATION_NOT_PERMITTED'); assert.equal(ev.length, 0);
  });
  // Readback and recovery.
  await check('readback: PUT accepted but the value did not land -> 200 confirmed:false (never reported as saved)', async () => {
    const world = makeGhlWorld({ putNotApplied: true });
    const { res, body } = await runWorld(world, fixedEvent('opportunity.arv', PIN_OPP, { value: 485000 }, 'rb-miss'));
    assert.equal(res.statusCode, 200); assert.equal(body.confirmed, false);
    assert.deepEqual(body.results, [{ id: F.arv, landed: false }]);
  });
  await check('readback: PUT accepted but the readback GET fails -> 409 indeterminate, lock released', async () => {
    const world = makeGhlWorld({ readbackFails: true });
    const { res, body, ev } = await runWorld(world, fixedEvent('opportunity.repairs', PIN_OPP, { value: 52000 }, 'rb-fail'));
    assert.equal(res.statusCode, 409); assert.equal(body.outcome, 'indeterminate');
    assert.equal(puts(ev).length, 1); assert.ok(lockReleased(ev) && noLockHeld());
  });
  await check('recovery: a PUT with no HTTP response -> 409 indeterminate, exactly one PUT, never retried', async () => {
    const world = makeGhlWorld({ putFails: 'throw' });
    const { res, body, ev } = await runWorld(world, fixedEvent('opportunity.arv', PIN_OPP, { value: 485000 }, 'rec-throw'));
    assert.equal(res.statusCode, 409); assert.equal(body.outcome, 'indeterminate');
    assert.equal(puts(ev).length, 1); assert.ok(lockReleased(ev) && noLockHeld());
  });
  await check('recovery: a rejected PUT (HTTP 500) -> 409 indeterminate, exactly one PUT', async () => {
    const world = makeGhlWorld({ putFails: 'status' });
    const { res, body, ev } = await runWorld(world, fixedEvent('opportunity.repairs', PIN_OPP, { value: 52000 }, 'rec-500'));
    assert.equal(res.statusCode, 409); assert.equal(body.outcome, 'indeterminate'); assert.equal(puts(ev).length, 1);
  });
  await check('recovery: repeating a completed requestId -> 409 indeterminate and NO second PUT (the claim holds)', async () => {
    const world = makeGhlWorld();
    const first = await runWorld(world, fixedEvent('opportunity.arv', PIN_OPP, { value: 485000 }, 'dup-1'));
    assert.equal(first.res.statusCode, 200);
    const again = await runWorld(world, fixedEvent('opportunity.arv', PIN_OPP, { value: 485000 }, 'dup-1'));
    assert.equal(again.res.statusCode, 409); assert.equal(again.body.outcome, 'indeterminate');
    assert.equal(puts(again.ev).length, 0); assert.ok(noLockHeld());
  });
  await check('recovery: a held contact lock refuses the write before any claim or PUT', async () => {
    const world = makeGhlWorld();
    const { digest } = require('../netlify/functions/lib/ghl-write-boundary.ts');
    const lockKey = 'iaos-write-receipts:lock/' + digest(PRODUCTION.locationId + PIN_CONTACT);
    blobData.set(lockKey, { claimedAt: 'held' });
    try {
      const { res, body, ev } = await runWorld(world, fixedEvent('contact.lastCallAttempt', PIN_CONTACT, { value: '2026-09-29T12:00:00.000Z' }, 'held-lock'));
      assert.equal(res.statusCode, 409); assert.equal(body.outcome, 'indeterminate');
      assert.equal(claims(ev).length, 0); assert.equal(puts(ev).length, 0);
      assert.ok(blobData.has(lockKey), 'a lock held by another write is never removed');
    } finally { blobData.delete(lockKey); }
  });
  // The two walkthrough notes through the handler (real bodies, real ledger guard).
  await check('handler note.create: OVERRIDDEN readiness note on the pinned pair -> 200, created and read back', async () => {
    const world = makeGhlWorld();
    const { res, body, ev } = await runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: OVERRIDE_BODY }, 'note-ready'));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(world.notes.length, 1); assert.equal(world.notes[0].body, OVERRIDE_BODY);
    assert.ok(body.note && body.note.id); assert.ok(lockReleased(ev) && noLockHeld());
  });
  await check('handler note.create: ARV OVERRIDE 485000 once the opportunity ARV is confirmed at 485000 -> 200', async () => {
    const world = makeGhlWorld({ oppFields: [{ id: F.arv, fieldValue: 485000 }] });
    const { res } = await runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: ARV_OVERRIDE_BODY }, 'note-arv'));
    assert.equal(res.statusCode, 200, res.body); assert.equal(world.notes.length, 1);
  });
  await check('handler note.create: ARV OVERRIDE 485000 while the opportunity ARV is NOT 485000 -> refused by the ledger guard, nothing written', async () => {
    const world = makeGhlWorld({ oppFields: [{ id: F.arv, fieldValue: 300000 }] });
    const { res, ev } = await runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: ARV_OVERRIDE_BODY }, 'note-arv-mismatch'));
    assert.equal(res.statusCode, 409, res.body); assert.equal(world.notes.length, 0); assert.equal(puts(ev).length, 0);
  });
  await check('handler note.create: APPROVED readiness note -> 403 NOTE_NOT_PERMITTED before any Blob/GHL', async () => {
    const world = makeGhlWorld();
    const { res, ev } = await runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: readinessNote('approved', PIN_OPP) }, 'note-approved'));
    assert.equal(res.statusCode, 403); assert.equal(JSON.parse(res.body).code, 'NOTE_NOT_PERMITTED'); assert.equal(ev.length, 0);
  });
  await check('handler note.create: OVERRIDDEN readiness note written to ANOTHER contact -> 403 TARGET_NOT_PINNED before any Blob/GHL', async () => {
    const world = makeGhlWorld();
    const { res, ev } = await runWorld(world, fixedEvent('note.create', OTHER_CONTACT, { body: OVERRIDE_BODY }, 'note-other-contact'));
    assert.equal(res.statusCode, 403); assert.equal(JSON.parse(res.body).code, 'TARGET_NOT_PINNED'); assert.equal(ev.length, 0);
  });

  // Confirm Accept recovery: the accept note lands, the final lastCallAttempt
  // write fails, a fresh reload still recognizes Agreement Reached, and no
  // retry can create a second accept note.
  await check('Confirm Accept recovery: accept saved + lastCallAttempt fails -> reload shows Agreement Reached; a retry cannot duplicate the accept', async () => {
    const CURRENT_OFFER = PRODUCTION.opportunityFacts.currentOffer;
    const opts = { oppFields: [{ id: CURRENT_OFFER, fieldValue: SNAPSHOT.currentOffer }] };
    const world = makeGhlWorld(opts);
    const acceptAt = '2026-09-29T13:00:00.000Z';
    const acceptBody = outcome.formatOutcomeNote({ opportunityId: PIN_OPP, at: acceptAt, operator: 'brad', kind: 'accept', reason: null, followUpAt: null, snapshot: SNAPSHOT });

    // 1. The accept note is saved (Confirm Accept's second write).
    const saved = await runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: acceptBody }, 'recovery-accept'));
    assert.equal(saved.res.statusCode, 200, saved.res.body);
    assert.equal(world.notes.length, 1);

    // 2. Confirm Accept's final write, lastCallAttempt, fails with no response.
    opts.putFails = 'throw';
    const lca = await runWorld(world, fixedEvent('contact.lastCallAttempt', PIN_CONTACT, { value: acceptAt }, 'recovery-lca'));
    assert.equal(lca.res.statusCode, 409, lca.res.body);
    assert.equal(lca.body.outcome, 'indeterminate');
    assert.equal(puts(lca.ev).length, 1, 'the failed PUT was attempted exactly once, not retried');
    assert.ok(noLockHeld(), 'lock released after the failure');
    delete opts.putFails;

    // 3. A fresh reload (notes read back from GHL) recognizes Agreement Reached.
    const reloaded = world.notes.map((n) => ({ body: n.body }));
    const latest = outcome.latestOutcomeNoteForOpportunity(reloaded, PIN_OPP);
    assert.equal(latest && latest.kind, 'accept');
    const view = load('contract-workspace-view').computeContractScreenState({
      loading: false, fetchError: null,
      candidates: [{ id: PIN_OPP, name: 'IAOS PROOF synthetic' }], selected: { id: PIN_OPP, name: 'IAOS PROOF synthetic' },
      notes: reloaded, propertyAddress: '742 Evergreen Terrace, Austin, TX 78701',
    });
    assert.equal(view.state, 'ready', 'Contract Workspace shows Agreement Reached after the reload: ' + JSON.stringify(view));
    assert.equal(view.agreedPrice, SNAPSHOT.currentOffer);

    // 4. Retries cannot create a second accept note -- neither the identical
    //    body (a blind retry) nor a fresh Confirm Accept with a new timestamp.
    const retrySame = await runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: acceptBody }, 'recovery-retry-same'));
    const freshBody = outcome.formatOutcomeNote({ opportunityId: PIN_OPP, at: '2026-09-29T13:05:00.000Z', operator: 'brad', kind: 'accept', reason: null, followUpAt: null, snapshot: SNAPSHOT });
    const retryFresh = await runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: freshBody }, 'recovery-retry-fresh'));
    for (const r of [retrySame, retryFresh]) {
      assert.equal(r.res.statusCode, 409, r.res.body);
      assert.equal(puts(r.ev).length, 0, 'no note POST');
      assert.equal(claims(r.ev).length, 0, 'refused before the write claim');
    }
    assert.equal(world.notes.length, 1, 'still exactly one accept note');
    assert.ok(noLockHeld());

    // 5. The recovery step itself -- retrying only lastCallAttempt -- succeeds.
    const lcaRetry = await runWorld(world, fixedEvent('contact.lastCallAttempt', PIN_CONTACT, { value: acceptAt }, 'recovery-lca-retry'));
    assert.equal(lcaRetry.res.statusCode, 200, lcaRetry.res.body);
    assert.equal(lcaRetry.body.confirmed, true);
  });

  // Bones REVISE item 2, end to end: Seller Call's OWN write sequence and
  // recovery (src/lib/seller-call-accept-writes.ts -- the functions the page
  // calls) driven against the real ghl-write handler, enabled + pinned.
  const acceptWrites = load('seller-call-accept-writes');
  const pageClient = (world, tag) => {
    let n = 0;
    const call = async (op, target, args) => runWorld(world, fixedEvent(op, target, args, `${tag}-${++n}`));
    return {
      setCurrentOffer: async (id, value) => { const r = await call('opportunity.currentOffer', id, { value }); if (r.res.statusCode !== 200) throw new Error(r.body.error || 'refused'); return { ok: r.body.confirmed === true }; },
      createNote: async (id, body) => { const r = await call('note.create', id, { body }); if (r.res.statusCode !== 200) throw new Error(r.body.error || 'refused'); return r.body; },
      setLastCallAttempt: async (id, iso) => { const r = await call('contact.lastCallAttempt', id, { value: iso }); if (r.res.statusCode !== 200 || r.body.confirmed === false) throw new Error(r.body.error || 'Write was not confirmed'); return r.body; },
      readLastCallFields: async (id) => world.contacts[id].customFields.map((f) => ({ id: f.id, value: f.value })),
    };
  };
  const LCA_IDS = { date: F.lca, precise: F.lcaPrecise };
  const pageRecover = (world, tag, pending, now) => acceptWrites.recoverLastCallAttempt(pageClient(world, tag), { contactId: PIN_CONTACT, pendingTimestamp: pending, now, fieldIds: LCA_IDS });
  const pageAccept = (world, tag, at) => acceptWrites.runConfirmAcceptWrites(pageClient(world, tag), {
    contactId: PIN_CONTACT, opportunityId: PIN_OPP, offerValue: SNAPSHOT.currentOffer, at,
    note: outcome.formatOutcomeNote({ opportunityId: PIN_OPP, at, operator: 'brad', kind: 'accept', reason: null, followUpAt: null, snapshot: SNAPSHOT }),
  });
  await check('Seller Call path (real handler): Current Offer + accept note land, lastCallAttempt fails -> "Acceptance recorded", Confirm Accept no longer offered; timestamp recovery reads, finds nothing, writes a fresh one', async () => {
    const opts = {};
    const world = makeGhlWorld(opts);
    opts.putFails = undefined;
    // Only the CONTACT PUT fails; the opportunity PUT must succeed.
    const origRoute = world.route;
    world.route = async (url, init) => {
      const p = new URL(url).pathname;
      if ((init.method || 'GET') === 'PUT' && p === `/contacts/${PIN_CONTACT}` && opts.contactPutFails) throw new Error('socket hang up');
      return origRoute(url, init);
    };
    opts.contactPutFails = true;
    const at = '2026-09-29T14:00:00.000Z';
    const result = await pageAccept(world, 'page-accept', at);
    assert.equal(result.stage, 'timestamp_failed', JSON.stringify(result));
    assert.equal(result.acceptanceRecorded, true);
    assert.ok(/^Acceptance recorded\./.test(result.message));
    assert.equal(world.opportunity.customFields.find((f) => f.id === PRODUCTION.opportunityFacts.currentOffer).fieldValue, SNAPSHOT.currentOffer, 'Current Offer landed');
    assert.equal(world.notes.length, 1, 'accept note landed');
    const reloadedKind = outcome.latestOutcomeNoteForOpportunity(world.notes, PIN_OPP).kind;
    assert.equal(reloadedKind, 'accept');
    assert.equal(acceptWrites.confirmAcceptOffered(reloadedKind), false, 'the page no longer offers Confirm Accept');
    // Were it pressed anyway, the server refuses at the FIRST write: the
    // Current Offer is frozen once an accept exists, so no second note is
    // ever attempted.
    const notesBefore = world.notes.length;
    const again = await pageAccept(world, 'page-accept-again', '2026-09-29T14:01:00.000Z');
    assert.equal(again.stage, 'offer_failed', JSON.stringify(again));
    assert.equal(again.acceptanceRecorded, false);
    assert.equal(world.notes.length, notesBefore, 'still exactly one accept note');
    // Recovery: read first -- nothing landed -- then one fresh write, which now succeeds.
    opts.contactPutFails = false;
    const now = '2026-09-29T14:05:00.000Z';
    const rec = await pageRecover(world, 'page-recover', result.pendingTimestamp, now);
    assert.deepEqual(rec, { kind: 'written', at: now });
    assert.equal(world.contacts[PIN_CONTACT].customFields.find((f) => f.id === F.lcaPrecise).value, now);
    assert.ok(noLockHeld());
  });
  await check('Seller Call path (real handler): the timestamp write LANDED but its response was lost -> recovery reads it back and writes NOTHING', async () => {
    const world = makeGhlWorld({ contactPutAppliedThenThrow: true });
    const at = '2026-09-29T15:00:00.000Z';
    const result = await pageAccept(world, 'page-lost', at);
    assert.equal(result.stage, 'timestamp_failed', JSON.stringify(result));
    assert.equal(world.contacts[PIN_CONTACT].customFields.find((f) => f.id === F.lcaPrecise).value, at, 'the write actually landed');
    const startEvents = events.length;
    const rec = await pageRecover(world, 'page-lost-recover', result.pendingTimestamp, '2026-09-29T15:05:00.000Z');
    assert.deepEqual(rec, { kind: 'confirmed', at, reason: 'pending_landed' });
    assert.equal(events.length, startEvents, 'no write request at all -- readback only');
    assert.ok(noLockHeld());
  });
  await check('Seller Call path (real handler): T0 fails; the T1 recovery write LANDS but loses its response -> T1 stays pending; the next recovery reads T1 in BOTH fields and makes zero requests', async () => {
    const opts = {};
    const world = makeGhlWorld(opts);
    const origRoute = world.route;
    world.route = async (url, init) => {
      if ((init.method || 'GET') === 'PUT' && new URL(url).pathname === `/contacts/${PIN_CONTACT}` && opts.contactPutFails) throw new Error('socket hang up');
      return origRoute(url, init);
    };
    opts.contactPutFails = true;
    const T0 = '2026-09-29T16:00:00.000Z', T1 = '2026-09-29T16:05:00.000Z', T2 = '2026-09-29T16:10:00.000Z';
    const accept = await pageAccept(world, 'page-t0', T0);
    assert.equal(accept.stage, 'timestamp_failed'); assert.equal(accept.pendingTimestamp, T0);
    opts.contactPutFails = false; opts.contactPutAppliedThenThrow = true;
    const first = await pageRecover(world, 'page-t1', accept.pendingTimestamp, T1);
    assert.equal(first.kind, 'write_unconfirmed', JSON.stringify(first));
    assert.equal(first.pendingTimestamp, T1, 'the attempted T1 is kept as pending');
    const lca = world.contacts[PIN_CONTACT].customFields;
    assert.equal(lca.find((f) => f.id === F.lca).value, T1); assert.equal(lca.find((f) => f.id === F.lcaPrecise).value, T1, 'T1 landed in both fields');
    opts.contactPutAppliedThenThrow = false;
    const startEvents = events.length;
    const second = await pageRecover(world, 'page-t2', first.pendingTimestamp, T2);
    assert.deepEqual(second, { kind: 'confirmed', at: T1, reason: 'pending_landed' });
    assert.equal(events.length, startEvents, 'zero additional requests of any kind');
    assert.ok(noLockHeld());
  });

  // ===== 5d. Bones REVISE item 4: a real canonical disposition handoff
  // through the ghl-write handler under simulated ENABLED Production config.
  // The executed-contract chain is built with the same model builders the
  // ledger suite uses (manual send, as Production requires), pinned ids,
  // real preserved-artifact bytes in Blobs, and the live Under Contract stage.
  const H_AT = '2026-09-18T01:00:00.000Z';
  const H_DOC = 'offline-document';
  const requiredSet = load('contract-signer-mapping-model').buildRequiredSignerSet(fixture.report);
  assert.equal(requiredSet.ok, true, JSON.stringify(requiredSet));
  const hRequired = requiredSet.signers;
  const hRecipients = hRequired.map((s, i) => ({ id: i === 0 ? PIN_CONTACT : 'offline-recipient-' + i, hasCompleted: true, signedDate: H_AT, role: 'signer', contactName: s.displayName }));
  const hDocuments = [{ documentId: H_DOC, locationId: PRODUCTION.locationId, status: 'completed', documentRevision: 1, updatedAt: H_AT, deleted: false, recipients: hRecipients, links: [{ createdBy: PRODUCTION.documentsContracts.senderUserId }], fillableFields: [{ isRequired: true }] }];
  const hOutcome = () => ({ kind: 'http_response', status: 200, body: { documents: hDocuments } });
  const hSend = manualSend(PIN_OPP, { recipients: hRequired });
  const hMapping = load('contract-signer-mapping-model').buildSignerMappingAttestationRecordArgs({ opportunityId: PIN_OPP, version: fixture.version, agreementAt: fixture.version.agreementAt, providerDocumentId: H_DOC, providerDocumentRevision: 1, acceptedSendAttemptId: hSend.attemptId, attestedAt: H_AT, requiredSigners: hRequired, availableProviderRecipientIds: hRecipients.map((r) => r.id), assignments: hRequired.map((s, i) => ({ role: s.role, providerRecipientId: hRecipients[i].id })), evidenceSummary: 'Synthetic operator mapping' });
  assert.equal(hMapping.ok, true, JSON.stringify(hMapping));
  const H_BYTES = Buffer.from('%PDF-1.4 synthetic offline fixture');
  const H_HASH = require('node:crypto').createHash('sha256').update(H_BYTES).digest('hex');
  const hChecklist = load('contract-executed-terms-attestation-model').buildExecutedTermsChecklist({ agreement: { price: 190000, propertyAddress: '123 Main St, Austin, TX, 78701', parties: [] }, buyerIdentity: 'BTC LLC', expectedSigners: hRequired });
  const hAttestation = load('contract-executed-terms-attestation-model').buildExecutedTermsAttestationRecordArgs({ opportunityId: PIN_OPP, version: fixture.version, agreementAt: fixture.version.agreementAt, providerDocumentId: H_DOC, providerDocumentRevision: 1, selectedArtifactSha256: H_HASH, attestedAt: H_AT, requiredItems: hChecklist, responses: hChecklist.map((i) => ({ kind: i.kind, signerRole: i.signerRole, result: 'MATCHES' })), evidenceSummary: 'Synthetic visual comparison' });
  assert.equal(hAttestation.ok, true, JSON.stringify(hAttestation));
  const lifecycleModel = load('contract-lifecycle-model');
  const hObserved = lifecycleModel.buildProviderObservationRecordFromReadback({ opportunityId: PIN_OPP, version: fixture.version, expectedDocumentId: H_DOC, expectedLocationId: PRODUCTION.locationId, acceptedSend: hSend, outcome: hOutcome(), iaosObservedAt: H_AT, evidenceSummary: 'Synthetic provider evidence', relatedPriorRecordId: null });
  assert.equal(hObserved.ok, true, JSON.stringify(hObserved));
  const executionModel = load('contract-execution-model');
  const hRows = executionModel.extractProviderSignerRowsFromListDocumentsBody({ body: { documents: hDocuments }, expectedDocumentId: H_DOC, expectedLocationId: PRODUCTION.locationId });
  assert.equal(hRows.ok, true, JSON.stringify(hRows));
  const hExecution = executionModel.buildVerifiedUnderContractRecord({ opportunityId: PIN_OPP, agreementAt: fixture.version.agreementAt, version: fixture.version, acceptedSend: hSend, requiredSigners: hRequired, buyerSignerRole: requiredSet.buyerRole, authorizedBuyerName: requiredSet.buyerDisplayName, authorizedBuyerEmail: requiredSet.buyerEmail, signerMappingAttestation: hMapping.value, providerRecipients: hRows.rows, lifecycleHistory: [hObserved.value], manualArtifactOutcome: { kind: 'selected', sha256: H_HASH, fileName: 'fixture.pdf', mimeType: 'application/pdf', pageCount: 5 }, selectedForDocumentId: H_DOC, selectedForVersion: fixture.version, executedTermsAttestation: hAttestation.value, iaosVerifiedAt: H_AT, evidenceSummary: 'Synthetic joint verification', relatedPriorRecordId: null });
  assert.equal(hExecution.ok, true, JSON.stringify(hExecution));
  const H_BLOB_KEY = 'offline-executed-artifact-key';
  const hArtifactNote = { body: load('contract-executed-artifact-carriers').formatPreservedExecutedArtifactNote({ opportunityId: PIN_OPP, at: H_AT, operator: 'brad', agreementAt: fixture.version.agreementAt, version: fixture.version, originalFileName: 'fixture.pdf', byteCount: H_BYTES.byteLength, sha256: H_HASH, pageCount: 5, providerDocumentId: H_DOC, uploadedAt: H_AT, blobKey: H_BLOB_KEY }) };
  const hChainNotes = [
    ...fixture.notes.map((n) => ({ body: n.body })),
    { body: sendCarriers.formatContractSendNote(hSend) },
    { body: load('contract-signer-mapping-carriers').formatSignerMappingAttestationNote(hMapping.value) },
    { body: load('contract-executed-terms-attestation-carriers').formatExecutedTermsAttestationNote(hAttestation.value) },
    { body: load('contract-lifecycle-carriers').formatContractLifecycleNote(hObserved.value) },
    { body: load('contract-execution-carriers').formatUnderContractNote(hExecution.value) },
    hArtifactNote,
  ];
  const acceptSnapshot = fixture.notes.map((n) => outcome.parseOutcomeNote(n.body)).find((r) => r && r.kind === 'accept').snapshot;
  const H_CONTACT_EXTRA = { firstName: 'Jane', lastName: 'Seller', email: 'seller@example.com', address1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
  const hReport = fixture.report;
  const hBuilt = load('contract-disposition-handoff-model').buildDispositionHandoffRecordArgs({ handoffId: 'offline-handoff', createdAt: H_AT, opportunityId: PIN_OPP, contactId: PIN_CONTACT, agreementAt: fixture.version.agreementAt, version: fixture.version, eligibility: { eligible: true }, underContract: hExecution.value, propertyAddress: { kind: 'populated', value: '123 Main St, Austin, TX, 78701', authority: 'operator_attested', recordedAt: null }, propertyLegalDescription: hReport.propertyLegalDescription, sellerContractPrice: acceptSnapshot.currentOffer, approvedArv: acceptSnapshot.arv === null ? null : { amount: acceptSnapshot.arv, approvalEvidenceState: null, approvalDecision: null, approvedAt: null }, approvedRepairs: acceptSnapshot.repairs, closingDate: hReport.closingPossession.closingDate, possessionDetails: hReport.closingPossession.possessionDetails, accessShowingInformation: { kind: 'unresolved' }, sellerContact: { noticeAddress: hReport.noticeContact.sellerNoticeAddress, noticePhone: hReport.noticeContact.sellerNoticePhone, noticeEmail: hReport.noticeContact.sellerNoticeEmail }, requiredSigners: hRequired, documentReferences: [], documentReferencesNote: 'No upstream reference carrier', evidenceSummary: 'Synthetic canonical handoff' });
  assert.equal(hBuilt.ok, true, JSON.stringify(hBuilt));
  const handoffCarriers = load('contract-disposition-handoff-carriers');
  const HANDOFF_BODY = handoffCarriers.formatDispositionHandoffNote(hBuilt.value);
  const hWorld = (over = {}) => makeGhlWorld(Object.assign({ stageId: PRODUCTION.stages.underContract, contactExtra: H_CONTACT_EXTRA, notes: hChainNotes }, over));
  const withArtifactBytes = async (bytes, fn) => {
    const key = 'iaos-executed-artifacts:' + H_BLOB_KEY;
    if (bytes === null) blobData.delete(key); else blobData.set(key, bytes);
    try { return await fn(); } finally { blobData.delete(key); }
  };
  const notePosts = (ev) => ev.filter((e) => e.kind === 'ghl' && e.method === 'POST');
  const handoffRefused = async (label, world, body, bytes = H_BYTES) => {
    await check('Production handoff refused: ' + label + ' (409, no note POST, no claim)', async () => {
      const r = await withArtifactBytes(bytes, () => runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body }, 'handoff-' + label)));
      assert.equal(r.res.statusCode, 409, r.res.body);
      assert.equal(notePosts(r.ev).length, 0, 'no note POST'); assert.equal(claims(r.ev).length, 0, 'no claim');
      assert.ok(noLockHeld());
    });
  };
  await check('Production handoff: the live config is enabled, pinned and in the real handler path (sanity)', () => {
    assert.equal(PRODUCTION.productionProofScope.enabled, G.PRODUCTION_PROOF_SCOPE_ENABLED);
    assert.equal(PRODUCTION.contractProductionEnabled, G.CONTRACT_PRODUCTION_ENABLED);
    assert.deepEqual(noteDecision(HANDOFF_BODY), { ok: true });
  });
  await check('Production handoff success: canonical handoff accepted, POSTed once and read back exactly', async () => {
    const world = hWorld();
    const r = await withArtifactBytes(H_BYTES, () => runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: HANDOFF_BODY }, 'handoff-success')));
    assert.equal(r.res.statusCode, 200, r.res.body);
    assert.equal(notePosts(r.ev).length, 1);
    const created = world.notes.filter((n) => n.body === HANDOFF_BODY);
    assert.equal(created.length, 1, 'the exact handoff body is now in GHL notes');
    assert.equal(r.body.note.id, created[0].id, 'the response names the read-back note');
    assert.ok(lockReleased(r.ev) && noLockHeld());
  });
  await check('Production handoff: a duplicate of an existing canonical handoff is refused (409, no POST)', async () => {
    const world = hWorld({ notes: [...hChainNotes, { body: HANDOFF_BODY }] });
    const r = await withArtifactBytes(H_BYTES, () => runWorld(world, fixedEvent('note.create', PIN_CONTACT, { body: HANDOFF_BODY }, 'handoff-duplicate')));
    assert.equal(r.res.statusCode, 409, r.res.body); assert.equal(notePosts(r.ev).length, 0);
    assert.equal(world.notes.filter((n) => n.body === HANDOFF_BODY).length, 1);
  });
  await handoffRefused('preserved-artifact note missing', hWorld({ notes: hChainNotes.filter((n) => n !== hArtifactNote) }), HANDOFF_BODY);
  await handoffRefused('artifact bytes missing from Blobs', hWorld(), HANDOFF_BODY, null);
  const H_CORRUPTED = Buffer.from(H_BYTES); H_CORRUPTED[H_CORRUPTED.length - 1] ^= 0xff; // same length, one byte flipped -> hash check
  await handoffRefused('artifact bytes corrupted (same length, SHA-256 differs)', hWorld(), HANDOFF_BODY, H_CORRUPTED);
  await handoffRefused('artifact byte count differs', hWorld(), HANDOFF_BODY, Buffer.concat([H_BYTES, Buffer.from(' ')]));
  await handoffRefused('opportunity still in Seller Offer Sent (wrong stage)', hWorld({ stageId: PRODUCTION.stages.sellerOfferSent }), HANDOFF_BODY);
  await handoffRefused('opportunity in Seller Closed-Won (wrong stage)', hWorld({ stageId: PRODUCTION.stages.sellerClosedWon }), HANDOFF_BODY);
  const hRescission = lifecycleModel.buildRescissionRecord({ opportunityId: PIN_OPP, version: fixture.version, reason: 'Synthetic rescission', authorizedBy: 'brad', authorizedAt: '2026-09-18T02:00:00.000Z', acceptedSend: hSend, iaosObservedAt: '2026-09-18T02:00:00.000Z', evidenceSummary: 'Synthetic rescission', relatedPriorRecordId: null });
  assert.equal(hRescission.ok, true, JSON.stringify(hRescission));
  await handoffRefused('a Rescission lifecycle record exists (stale lifecycle)', hWorld({ notes: [...hChainNotes, { body: load('contract-lifecycle-carriers').formatContractLifecycleNote(hRescission.value) }] }), HANDOFF_BODY);
  await handoffRefused('a newer accepted agreement supersedes it (stale agreement)', hWorld({ notes: [...hChainNotes, { body: outcome.formatOutcomeNote({ opportunityId: PIN_OPP, at: '2026-09-18T03:00:00.000Z', operator: 'brad', kind: 'accept', reason: null, followUpAt: null, snapshot: acceptSnapshot }) }] }), HANDOFF_BODY);
  for (const [label, altered] of [
    ['snapshot price altered', { ...hBuilt.value, sellerContractPrice: hBuilt.value.sellerContractPrice + 1 }],
    ['snapshot repairs altered', { ...hBuilt.value, approvedRepairs: hBuilt.value.approvedRepairs + 1 }],
    ['snapshot property address altered', { ...hBuilt.value, propertyAddress: { ...hBuilt.value.propertyAddress, value: '124 Main St, Austin, TX, 78701' } }],
  ]) await handoffRefused(label, hWorld(), handoffCarriers.formatDispositionHandoffNote(altered));
  await check('Production handoff naming another contact -> 403 TARGET_NOT_PINNED at the scope gate, before any Blob/GHL access', async () => {
    const r = await runWorld(hWorld(), fixedEvent('note.create', PIN_CONTACT, { body: handoffCarriers.formatDispositionHandoffNote({ ...hBuilt.value, contactId: OTHER_CONTACT }) }, 'handoff-foreign-contact'));
    assert.equal(r.res.statusCode, 403); assert.equal(r.body.code, 'TARGET_NOT_PINNED'); assert.equal(r.ev.length, 0);
  });

  // ===== 5e. Bones REVISE item 3: sign-in and origin for all six allowances
  // under simulated ENABLED Production config. Every refusal must happen
  // before connectLambda, any Blob access or any GHL call.
  const ALLOWANCE_REQUESTS = [
    ['opportunity.arv 485000', 'opportunity.arv', PIN_OPP, { value: 485000 }],
    ['opportunity.repairs 52000', 'opportunity.repairs', PIN_OPP, { value: 52000 }],
    ['contact.lastCallAttempt', 'contact.lastCallAttempt', PIN_CONTACT, { value: '2026-09-29T12:00:00.000Z' }],
    ['readiness OVERRIDE note', 'note.create', PIN_CONTACT, { body: OVERRIDE_BODY }],
    ['ARV OVERRIDE 485000 note', 'note.create', PIN_CONTACT, { body: ARV_OVERRIDE_BODY }],
    ['canonical disposition handoff note', 'note.create', PIN_CONTACT, { body: HANDOFF_BODY }],
  ];
  const { createHmac } = require('node:crypto');
  const BRAD = 'brad@example.invalid';
  const validToken = () => auth.issueAppSession(BRAD).token;
  const signWith = (secret, claims) => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
  };
  const nowS = () => Math.floor(Date.now() / 1000);
  const tamperedToken = () => { const [h, , s] = validToken().split('.'); const p = Buffer.from(JSON.stringify({ iss: 'iaos', aud: 'iaos-app-write', sub: 'other@example.invalid', iat: nowS(), exp: nowS() + 900 })).toString('base64url'); return `${h}.${p}.${s}`; };
  const AUTH_CASES = [
    ['no Authorization header', (h) => { delete h.authorization; }],
    ['empty bearer', (h) => { h.authorization = 'Bearer '; }],
    ['non-bearer scheme', (h) => { h.authorization = 'Basic ' + Buffer.from('brad:pw').toString('base64'); }],
    ['malformed token', (h) => { h.authorization = 'Bearer not-a-token'; }],
    ['payload tampered after signing', (h) => { h.authorization = 'Bearer ' + tamperedToken(); }],
    ['signed with another secret', (h) => { h.authorization = 'Bearer ' + signWith('another-offline-secret-that-is-long-enough-32', { iss: 'iaos', aud: 'iaos-app-write', sub: BRAD, iat: nowS(), exp: nowS() + 900 }); }],
    ['expired session', (h) => { h.authorization = 'Bearer ' + auth.issueAppSession(BRAD, process.env, Date.now() - 16 * 60 * 1000).token; }],
    ['wrong audience (e.g. a voice session)', (h) => { h.authorization = 'Bearer ' + signWith(process.env.IAOS_APP_WRITE_SESSION_SECRET, { iss: 'iaos', aud: 'iaos-voice', sub: BRAD, iat: nowS(), exp: nowS() + 900 }); }],
    ['disallowed identity (validly signed, not on the allowlist)', (h) => { h.authorization = 'Bearer ' + auth.issueAppSession('other@example.invalid', { ...process.env, IAOS_APP_WRITE_BRAD_EMAILS: 'other@example.invalid' }).token; }],
  ];
  const approved = process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
  const ORIGIN_CASES = [
    ['no Origin header', undefined], ['null origin', 'null'], ['wrong origin', 'https://wrong.example.invalid'],
    ['lookalike suffix', approved + '.attacker.invalid'], ['trailing slash', approved + '/'], ['plain http', approved.replace('https://', 'http://')],
    ['explicit port', approved + ':443'], ['Test deploy-preview origin (refused outside Test)', 'https://deploy-preview-85--iaos-app-test.netlify.app'],
  ];
  const refusalEvent = (op, target, args, mutateHeaders) => {
    const e = fixedEvent(op, target, args, 'auth-' + op);
    mutateHeaders(e.headers);
    return e;
  };
  for (const [label, op, target, args] of ALLOWANCE_REQUESTS) {
    await check(`sign-in/origin control: ${label} with a valid session and approved origin passes both gates`, async () => {
      const before = blob.connections;
      const res = await writeHandler(fixedEvent(op, target, args, 'auth-control-' + label));
      assert.notEqual(res.statusCode, 401, res.body);
      assert.ok(!/sign-in required|origin refused/i.test(res.body), res.body);
      assert.ok(blob.connections > before, 'past both gates: connectLambda reached');
    });
    for (const [caseLabel, mutate] of AUTH_CASES) {
      await check(`sign-in refused: ${label} -- ${caseLabel} -> 401, zero Lambda/Blob/GHL`, async () => {
        const before = { conn: blob.connections, stores: blob.stores, reads: blob.reads, writes: blob.writes, ghl: ghlCalls.length, ev: events.length };
        const res = await writeHandler(refusalEvent(op, target, args, mutate));
        assert.equal(res.statusCode, 401, res.body);
        assert.deepEqual({ conn: blob.connections, stores: blob.stores, reads: blob.reads, writes: blob.writes, ghl: ghlCalls.length, ev: events.length }, before);
      });
    }
    for (const [caseLabel, origin] of ORIGIN_CASES) {
      await check(`origin refused: ${label} -- ${caseLabel} -> 403, zero Lambda/Blob/GHL`, async () => {
        const before = { conn: blob.connections, stores: blob.stores, reads: blob.reads, writes: blob.writes, ghl: ghlCalls.length, ev: events.length };
        const res = await writeHandler(refusalEvent(op, target, args, (h) => { if (origin === undefined) delete h.origin; else h.origin = origin; }));
        assert.equal(res.statusCode, 403, res.body);
        assert.equal(JSON.parse(res.body).error, 'Application write origin refused');
        assert.deepEqual({ conn: blob.connections, stores: blob.stores, reads: blob.reads, writes: blob.writes, ghl: ghlCalls.length, ev: events.length }, before);
      });
    }
  }

  applyLive('default');
  await check('live Production config is restored to the committed default (both flags ON, pinned to the real synthetic fixture, real stage)', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(PRODUCTION)), PRODUCTION_ORIGINAL);
    assert.equal(PRODUCTION_ORIGINAL.productionProofScope.enabled, G.PRODUCTION_PROOF_SCOPE_ENABLED);
    assert.equal(PRODUCTION_ORIGINAL.contractProductionEnabled, G.CONTRACT_PRODUCTION_ENABLED);
    assert.equal(PRODUCTION_ORIGINAL.productionProofScope.contactId, COMMITTED_FIXTURE_CONTACT);
    assert.equal(PRODUCTION_ORIGINAL.productionProofScope.opportunityId, COMMITTED_FIXTURE_OPP);
    assert.equal(PRODUCTION_ORIGINAL.stages.underContract, 'bf17076b-3830-4479-94bb-b8af70fe9163');
  });

  // ===== 5b. The COMMITTED config (INV-98 Board #9 enable commit): BOTH flags ON, pinned to the REAL synthetic
  // fixture. Only the six permitted operations on the pinned ids pass the scope gate; every other operation,
  // target, note kind and upload is refused before any Blob access or GHL call. (The disabled refusal matrix is
  // exercised above through the explicit `disabled` state.)
  const fixtureNotes = require('./write-contract-fixture.cjs').contractFixture(load, COMMITTED_FIXTURE_OPP).notes.filter((n) => !factsCarriers.parseRepresentationFactsNote(n.body));
  const committedArgs = (op) => (op === 'note.create' ? { body: fixtureNotes[0].body } : VALID_ARGS[op]);
  const committedTarget = (op) => (op.startsWith('opportunity.') ? COMMITTED_FIXTURE_OPP : COMMITTED_FIXTURE_CONTACT);
  const committedOther = (op) => (op.startsWith('opportunity.') ? OTHER_OPP : OTHER_CONTACT);
  // B14-12: the committed config also ENABLES the call-log class, which opens exactly these three
  // operations for ANY contact (call-log and callback NOTES are covered by the call-log section below).
  const CALL_LOG_OPEN = ['contact.callLogResult', 'contact.lastCallAttempt', 'contact.explicitCallback'];
  for (const op of Object.keys(VALID_ARGS)) {
    if (CALL_LOG_OPEN.includes(op)) {
      await check(`committed config: ${op} is open to ANY contact through the B14-12 call-log class`, () => {
        for (const target of [committedTarget(op), committedOther(op)]) assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(PRODUCTION, { operation: op, targetId: target, args: committedArgs(op) }), { ok: true }, target);
      });
      await check(`handler committed config: ghl-write ${op} on another contact passes the scope gate (call-log class)`, async () => {
        const before = snapshot();
        const res = await writeHandler(writeEvent(op, committedOther(op), committedArgs(op)));
        assert.notEqual(JSON.parse(res.body).by, 'iaos-production-write-scope', res.body);
        assert.ok(blob.connections > before.connections, 'connectLambda reached after the gate');
      });
      continue;
    }
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
  await check('committed config: ARV and repairs pass only at exactly 485000 / 52000 on the REAL pinned opportunity', () => {
    for (const [op, v] of [['opportunity.arv', 485001], ['opportunity.arv', '485000'], ['opportunity.repairs', 52001]]) {
      assert.deepEqual(scopeLib.evaluateProductionGhlWriteScope(PRODUCTION, { operation: op, targetId: COMMITTED_FIXTURE_OPP, args: { value: v } }), { ok: false, code: 'OPERATION_NOT_PERMITTED' }, `${op} ${JSON.stringify(v)}`);
    }
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

  // ===== B14-12 — Production call-log permission class (default DISABLED).
  {
    const callLogOn = (state) => ({ ...variant(state), productionCallLog: G.PRODUCTION_CALL_LOG_ENABLED });
    const decide = (cfg, operation, targetId, args) => scopeLib.evaluateProductionGhlWriteScope(cfg, { operation, targetId, args });
    const NOTE = (r, notes) => 'Call (reported by Brad in IAOS): ' + r + (notes ? '\n' + notes : '');
    const RESULTS = ['No Answer', 'Voicemail', 'Spoke with Seller', 'Follow Up', 'Not Interested', 'Incorrect Number'];

    await check('call log: committed config is ENABLED in Production and documentation-only DISABLED in Test', () => {
      assert.equal(PRODUCTION_ORIGINAL.productionCallLog, G.PRODUCTION_CALL_LOG_ENABLED);
      assert.equal(TEST.productionCallLog, G.PRODUCTION_CALL_LOG_DISABLED);
      assert.notEqual(G.PRODUCTION_CALL_LOG_DISABLED, G.PRODUCTION_CALL_LOG_ENABLED);
    });
    await check('call log: DISABLED -> every operation decides exactly as before, in every Board #9 state', () => {
      for (const state of [...Object.keys(EXPECTED_PRE), 'ready']) {
        const off = variant(state);
        for (const op of Object.keys(VALID_ARGS)) for (const target of [pinnedTarget(op), otherTarget(op)]) {
          assert.deepEqual(decide(off, op, target, VALID_ARGS[op]), decide({ ...off, productionCallLog: 'anything-else' }, op, target, VALID_ARGS[op]), op + ' ' + state);
        }
        assert.equal(decide(off, 'contact.callLogResult', OTHER_CONTACT, { value: 'No Answer' }).ok, false, state);
      }
    });
    for (const state of [...Object.keys(EXPECTED_PRE), 'ready']) {
      await check('call log ENABLED (' + state + '): result, last touch and the EXPLICIT callback allowed for ANY contact, independent of Board #9; generic contact.callback still refused', () => {
        const on = callLogOn(state);
        for (const target of [OTHER_CONTACT, PIN_CONTACT]) {
          for (const r of RESULTS) assert.deepEqual(decide(on, 'contact.callLogResult', target, { value: r }), { ok: true }, r);
          assert.deepEqual(decide(on, 'contact.lastCallAttempt', target, { value: '2026-10-02T12:00:00.000Z' }), { ok: true });
          assert.deepEqual(decide(on, 'contact.explicitCallback', target, { value: '2026-10-09T19:30:00.000Z' }), { ok: true });
          assert.deepEqual(decide(on, 'contact.explicitCallback', target, { value: null }), { ok: true });
          assert.equal(decide(on, 'contact.callback', target, { value: '2026-10-09T19:30:00.000Z' }).ok, false, 'generic contact.callback');
          assert.equal(decide(on, 'contact.callback', target, { value: null }).ok, false, 'generic contact.callback clear');
        }
      });
    }
    await check('call log ENABLED: exact call-log notes and callback notes allowed for any contact', () => {
      const on = callLogOn('disabled');
      for (const r of RESULTS) {
        assert.deepEqual(decide(on, 'note.create', OTHER_CONTACT, { body: NOTE(r) }), { ok: true }, r);
        assert.deepEqual(decide(on, 'note.create', OTHER_CONTACT, { body: NOTE(r, 'Wants 30 days.\nAsk about roof.') }), { ok: true }, r);
      }
      assert.deepEqual(decide(on, 'note.create', OTHER_CONTACT, { body: NOTE('Spoke with Seller', 'x'.repeat(4000)) }), { ok: true });
      for (const body of ['Callback scheduled for Oct 9, 2:30 PM', 'Callback scheduled for Oct 12, 10:00\u202fAM']) assert.deepEqual(decide(on, 'note.create', OTHER_CONTACT, { body }), { ok: true }, body);
    });
    await check('call log ENABLED: every other note is still refused for a non-pinned contact', () => {
      const on = callLogOn('ready');
      for (const body of [
        'plain operator note', 'Call: No Answer — 10s', NOTE('Requested Appointment'), NOTE('Do Not Call'), NOTE('no answer'),
        'Call (reported by Brad in IAOS):  No Answer', ' ' + NOTE('No Answer'), NOTE('No Answer') + ' — callback scheduled for Oct 6, 10:00 AM',
        NOTE('No Answer', '   '), NOTE('Spoke with Seller', 'x'.repeat(4001)), 'Callback scheduled for tomorrow', 'Callback scheduled for Oct 9, 2:30 PM extra',
        PASS_OUTCOME_BODY, MINIMAL_NOTES[0].body,
      ]) assert.equal(decide(on, 'note.create', OTHER_CONTACT, { body }).ok, false, JSON.stringify(body).slice(0, 80));
    });
    await check('call log ENABLED: nothing else opens — routing, trigger timestamp, old disposition, Board #9 and other ops decide exactly as when disabled', () => {
      for (const state of [...Object.keys(EXPECTED_PRE), 'ready']) {
        const off = variant(state), on = callLogOn(state);
        for (const op of Object.keys(VALID_ARGS)) {
          if (['contact.callLogResult', 'contact.lastCallAttempt', 'contact.explicitCallback'].includes(op)) continue;
          for (const target of [pinnedTarget(op), otherTarget(op)]) {
            if (op === 'note.create') continue;      // notes: covered by the exact-pattern checks above
            assert.deepEqual(decide(on, op, target, VALID_ARGS[op]), decide(off, op, target, VALID_ARGS[op]), op + ' ' + state);
          }
        }
        for (const op of ['contact.routing', 'contact.dispositionAt', 'contact.disposition']) assert.equal(decide(on, op, OTHER_CONTACT, VALID_ARGS[op]).ok, false, op);
        assert.deepEqual(decide(on, 'note.create', PIN_CONTACT, { body: PASS_OUTCOME_BODY }), decide(off, 'note.create', PIN_CONTACT, { body: PASS_OUTCOME_BODY }));
      }
    });
    await check('call log: paired-ownership check skipped only for a call-log last touch on a non-pinned contact', () => {
      const on = callLogOn('ready'), off = variant('ready');
      assert.equal(scopeLib.requiresProductionPairedOwnership(on, 'contact.lastCallAttempt', OTHER_CONTACT), false);
      assert.equal(scopeLib.requiresProductionPairedOwnership(on, 'contact.lastCallAttempt', PIN_CONTACT), true);
      assert.equal(scopeLib.requiresProductionPairedOwnership(off, 'contact.lastCallAttempt', OTHER_CONTACT), true);
      assert.equal(scopeLib.requiresProductionPairedOwnership(on, 'opportunity.arv', PIN_OPP), true);
      assert.equal(scopeLib.requiresProductionPairedOwnership(on, 'contact.lastCallAttempt'), true);
      assert.equal(scopeLib.requiresProductionPairedOwnership(TEST, 'contact.lastCallAttempt', OTHER_CONTACT), false);
    });

    // Handler: the live module config, call log ENABLED with Board #9 DISABLED.
    const savedCallLog = PRODUCTION.productionCallLog;
    applyLive('disabled');
    PRODUCTION.productionCallLog = G.PRODUCTION_CALL_LOG_ENABLED;
    try {
      for (const [op, args] of [
        ['contact.callLogResult', { value: 'Spoke with Seller' }], ['contact.lastCallAttempt', VALID_ARGS['contact.lastCallAttempt']],
        ['contact.explicitCallback', { value: '2026-10-09T19:30:00.000Z' }], ['note.create', { body: NOTE('Spoke with Seller', 'Wants 30 days.') }],
      ]) {
        await check('handler ghl-write ' + op + ': call log ENABLED, non-pinned contact passes the scope gate (reaches Blob/GHL)', async () => {
          const before = snapshot();
          const res = await writeHandler(writeEvent(op, OTHER_CONTACT, args));
          assert.notEqual(JSON.parse(res.body).by, 'iaos-production-write-scope', res.body);
          assert.ok(blob.connections > before.connections, 'connectLambda reached after the gate');
        });
      }
      for (const [op, args] of [['contact.routing', VALID_ARGS['contact.routing']], ['contact.dispositionAt', VALID_ARGS['contact.dispositionAt']], ['note.create', { body: 'plain note' }], ['contact.callback', { value: '2026-10-09T19:30:00.000Z' }], ['note.create', { body: PASS_OUTCOME_BODY }]]) {
        await assertRefusedClean('handler ghl-write ' + op + ': call log ENABLED still refuses it, zero Blob/GHL', () => writeHandler(writeEvent(op, OTHER_CONTACT, args)));
      }
    } finally {
      PRODUCTION.productionCallLog = savedCallLog;
    }
    {
      const saved = PRODUCTION.productionCallLog;
      PRODUCTION.productionCallLog = G.PRODUCTION_CALL_LOG_DISABLED;
      try {
        await assertRefusedClean('handler ghl-write contact.callLogResult: call log DISABLED refused, zero Blob/GHL', () => writeHandler(writeEvent('contact.callLogResult', OTHER_CONTACT, { value: 'Spoke with Seller' })));
      } finally { PRODUCTION.productionCallLog = saved; }
    }
    await check('handler ghl-write contact.callLogResult: the COMMITTED Production config (ENABLED) passes the scope gate for a real contact', async () => {
      const saved = PRODUCTION.productionCallLog;
      PRODUCTION.productionCallLog = PRODUCTION_ORIGINAL.productionCallLog;
      try {
        const before = snapshot();
        const res = await writeHandler(writeEvent('contact.callLogResult', OTHER_CONTACT, { value: 'Spoke with Seller' }));
        assert.notEqual(JSON.parse(res.body).by, 'iaos-production-write-scope', res.body);
        assert.ok(blob.connections > before.connections, 'connectLambda reached after the gate');
      } finally {
        PRODUCTION.productionCallLog = saved;
      }
    });
  }
  // ===== B14-12 — Production Do Not Call class (own flag; DISABLED). IAOS never writes DND:
  // the class opens ONLY the exact Do Not Call note (which ghl-write further accepts only
  // while the contact's GHL calls, SMS and email read back suppressed).
  {
    const decide = (cfg, operation, targetId, args) => scopeLib.evaluateProductionGhlWriteScope(cfg, { operation, targetId, args });
    const dncOn = (state) => ({ ...variant(state), productionDnc: G.PRODUCTION_DNC_ENABLED });
    const NOTE = 'Do Not Call (recorded by Brad in IAOS): Seller asked us not to contact them again.\nAt verification, GHL showed calls, SMS and email suppressed.';
    await check('dnc: committed config is DISABLED in both environments', () => {
      assert.equal(PRODUCTION_ORIGINAL.productionDnc, G.PRODUCTION_DNC_DISABLED);
      assert.equal(TEST.productionDnc, G.PRODUCTION_DNC_DISABLED);
      assert.notEqual(G.PRODUCTION_DNC_DISABLED, G.PRODUCTION_DNC_ENABLED);
    });
    await check('dnc: there is no DND write operation to permit (contact.dnc is not a planWrite case)', () => {
      assert.equal(Object.prototype.hasOwnProperty.call(scopeLib.PRODUCTION_OPERATION_SCOPE, 'contact.dnc'), false);
    });
    await check('dnc: DISABLED -> the Do Not Call note is refused for a non-pinned contact in every Board #9 state', () => {
      for (const state of [...Object.keys(EXPECTED_PRE), 'ready']) assert.equal(decide(variant(state), 'note.create', OTHER_CONTACT, { body: NOTE }).ok, false, state);
    });
    for (const state of [...Object.keys(EXPECTED_PRE), 'ready']) {
      await check('dnc ENABLED (' + state + '): only the exact Do Not Call note is opened, for ANY contact, independent of Board #9 and the call-log class', () => {
        const on = dncOn(state);
        for (const target of [OTHER_CONTACT, PIN_CONTACT]) assert.deepEqual(decide(on, 'note.create', target, { body: NOTE }), { ok: true });
        assert.equal(decide(on, 'contact.callLogResult', OTHER_CONTACT, { value: 'No Answer' }).ok, false, 'call-log op not opened by the DNC class');
      });
    }
    await check('dnc ENABLED: near-miss notes and every operation decide exactly as when disabled', () => {
      for (const state of [...Object.keys(EXPECTED_PRE), 'ready']) {
        const off = variant(state), on = dncOn(state);
        for (const op of Object.keys(VALID_ARGS)) for (const target of [pinnedTarget(op), otherTarget(op)]) {
          assert.deepEqual(decide(on, op, target, VALID_ARGS[op]), decide(off, op, target, VALID_ARGS[op]), op + ' ' + state);
        }
        for (const body of ['plain note', NOTE.replace('At verification, GHL showed calls, SMS and email suppressed.', 'Suppressed in GHL: calls, SMS and email.'), NOTE + '\nextra',
          'Do Not Call (recorded by Brad in IAOS): \nAt verification, GHL showed calls, SMS and email suppressed.']) {
          assert.deepEqual(decide(on, 'note.create', OTHER_CONTACT, { body }), decide(off, 'note.create', OTHER_CONTACT, { body }), body);
        }
      }
    });
    const savedDnc = PRODUCTION.productionDnc;
    applyLive('disabled');
    PRODUCTION.productionDnc = G.PRODUCTION_DNC_ENABLED;
    try {
      await check('handler ghl-write note.create (Do Not Call note): DNC ENABLED, non-pinned contact passes the scope gate (reaches Blob/GHL)', async () => {
        const before = snapshot();
        const res = await writeHandler(writeEvent('note.create', OTHER_CONTACT, { body: NOTE }));
        assert.notEqual(JSON.parse(res.body).by, 'iaos-production-write-scope', res.body);
        assert.ok(blob.connections > before.connections, 'connectLambda reached after the gate');
      });
    } finally {
      PRODUCTION.productionDnc = savedDnc;
    }
    await assertRefusedClean('handler ghl-write note.create (Do Not Call note): DNC DISABLED refused, zero Blob/GHL', () => writeHandler(writeEvent('note.create', OTHER_CONTACT, { body: NOTE })));
    applyLive('default');
  }
  console.log(`production-write-scope checks=${checks} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
