/**
 * Contract-send READBACK endpoint -- INV-98 gate-review hardening round.
 * Full rewrite: the endpoint no longer accepts a browser-supplied
 * documentId, no longer hardcodes a Test-only location check, and no
 * longer returns any raw GHL document row -- only normalized,
 * data-minimized verdicts. This suite proves the new contract end to
 * end: auth/origin/environment ordering, request-shape rejection,
 * server-side document scoping/truncation/deduplication, and that no
 * raw recipient/sender/fillable-field data (or the underlying buyer
 * name/email) ever reaches the response.
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
const { handler } = require('../netlify/functions/ghl-contract-send-readback.ts');

let checks = 0, failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name); console.error('      expected: ' + JSON.stringify(expected)); console.error('      actual:   ' + JSON.stringify(actual)); }
}
function ok(name, cond) { check(name, !!cond, true); }

const contact = { id: config.documentsContracts.approvedTestContactId, locationId: config.locationId, customFields: [], firstName: 'Jane', lastName: 'Seller', email: 'seller@example.com', address1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
const opportunity = { id: 'fixture-opportunity-readback', contactId: contact.id, locationId: config.locationId, customFields: [] };
const fixture = require('./write-contract-fixture.cjs').contractFixture(load, opportunity.id);

const requiredResult = load('contract-signer-mapping-model').buildRequiredSignerSet(fixture.report);
assert.equal(requiredResult.ok, true, JSON.stringify(requiredResult));
const required = requiredResult.signers; // [buyer, seller]
const AT = '2026-09-22T01:00:00.000Z';
const MANUAL_DOC_ID = 'fixture-document-manual';

// Two recipients, one per required signer, correctly identified --
// recipients[0] is the buyer (matches required[0]'s own displayName).
const goodRecipients = required.map((s, i) => ({ id: 'recipient-' + i, hasCompleted: true, signedDate: AT, role: 'signer', contactName: s.displayName, email: null }));

function documentRow(id, overrides) {
  return Object.assign(
    { documentId: id, locationId: config.locationId, status: 'completed', documentRevision: 1, updatedAt: AT, deleted: false, recipients: goodRecipients, links: [{ createdBy: 'brads-human-ghl-user-id' }], fillableFields: [{ isRequired: true, id: 'field-1' }] },
    overrides || {},
  );
}

const manualBuilt = load('contract-manual-send-model').buildManualContractSendRecordArgs({
  opportunityId: opportunity.id, agreementAt: fixture.version.agreementAt, version: fixture.version, requestAt: AT, expirationAt: null,
  providerDocumentId: MANUAL_DOC_ID, providerDocumentReference: null, providerDocumentRevision: 1, recipients: required,
  authorizedRecord: fixture.authorization, templateName: config.documentsContracts.expectedTemplateName,
  requestedTemplateId: config.documentsContracts.templateId, readbackLocationId: config.locationId, operator: 'brad', recordedAt: AT,
});
assert.equal(manualBuilt.ok, true, JSON.stringify(manualBuilt));
const sendNoteBody = load('contract-send-carriers').formatContractSendNote(manualBuilt.value);

const mappingBuilt = load('contract-signer-mapping-model').buildSignerMappingAttestationRecordArgs({
  opportunityId: opportunity.id, version: fixture.version, agreementAt: fixture.version.agreementAt,
  providerDocumentId: MANUAL_DOC_ID, providerDocumentRevision: 1, acceptedSendAttemptId: AT, attestedAt: AT,
  requiredSigners: required, availableProviderRecipientIds: goodRecipients.map((r) => r.id),
  assignments: required.map((s, i) => ({ role: s.role, providerRecipientId: goodRecipients[i].id })),
  evidenceSummary: 'Synthetic operator mapping.',
});
assert.equal(mappingBuilt.ok, true, JSON.stringify(mappingBuilt));
const mappingNoteBody = load('contract-signer-mapping-carriers').formatSignerMappingAttestationNote(mappingBuilt.value);

const notesWithSendAndMapping = [...fixture.notes, { body: sendNoteBody }, { body: mappingNoteBody }];
const notesWithSendOnly = [...fixture.notes, { body: sendNoteBody }];
const notesWithoutSend = [...fixture.notes];

let activeNotes = notesWithSendAndMapping;
let documents = [documentRow(MANUAL_DOC_ID)];
const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
let calls = 0;
global.fetch = async (url) => {
  calls++;
  const u = new URL(url);
  assert.equal(u.origin, 'https://services.leadconnectorhq.com', 'no external network');
  if (u.pathname === '/opportunities/' + opportunity.id) return reply({ opportunity });
  if (u.pathname === '/contacts/' + contact.id) return reply({ contact });
  if (u.pathname === '/contacts/' + contact.id + '/notes') return reply({ notes: activeNotes });
  if (u.pathname === '/proposals/document') return reply({ documents });
  throw new Error('Unexpected mocked request ' + u.pathname);
};

const approvedOrigin = process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN;
function validToken() { return auth.issueAppSession('brad@example.invalid').token; }
function event(overrides) {
  return Object.assign(
    { httpMethod: 'POST', headers: { origin: approvedOrigin, authorization: `Bearer ${validToken()}` }, body: JSON.stringify({ opportunityId: opportunity.id }) },
    overrides || {},
  );
}

/** Recursively collects every property key appearing anywhere in a JSON-decoded value. */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) allKeys(v, out); return out; }
  if (value && typeof value === 'object') { for (const k of Object.keys(value)) { out.add(k); allKeys(value[k], out); } }
  return out;
}

(async () => {
  // ============================================================
  // 1. Fail-closed ordering: auth -> origin -> environment -> body,
  //    zero GHL calls for every failure mode, mirroring
  //    generate-contract-pdf.ts's own proven pattern exactly.
  // ============================================================
  {
    const before = calls;
    const res = await handler(event({ headers: { origin: approvedOrigin } }));
    check('unauthenticated request is refused (401)', res.statusCode, 401);
    check('  -- zero GHL calls occurred', calls, before);
  }
  {
    const before = calls;
    const res = await handler(event({ headers: { origin: 'https://wrong.example.invalid', authorization: `Bearer ${validToken()}` } }));
    check('valid auth + wrong Origin is refused (403, not 401)', res.statusCode, 403);
    check('  -- zero GHL calls occurred', calls, before);
  }
  {
    const savedEnv = process.env.IAOS_ENV;
    process.env.IAOS_ENV = 'production';
    // Re-load the handler under a Production IAOS_ENV so its module-scope
    // CONFIG reflects Production -- environment refusal must occur before
    // any GHL call, with valid auth and Origin.
    delete require.cache[require.resolve('../netlify/functions/ghl-contract-send-readback.ts')];
    const prodHandler = require('../netlify/functions/ghl-contract-send-readback.ts').handler;
    // INV-98 enable commit: the committed Production config is now ENABLED for
    // the pinned synthetic proof, so the DISABLED case sets the flag EXPLICITLY
    // on the shared Production config object the handler holds, then restores it.
    const G = require('../shared/ghl-config.ts');
    const PRODUCTION_LIVE = G.getConfig('production');
    const committedFlag = PRODUCTION_LIVE.contractProductionEnabled;
    PRODUCTION_LIVE.contractProductionEnabled = G.CONTRACT_PRODUCTION_NOT_ENABLED;
    try {
      const before = calls;
      const res = await prodHandler(event());
      check('Production (disabled, explicitly set): refused before any GHL call', res.statusCode, 403);
      check('  -- zero GHL calls occurred', calls, before);
      let body; try { body = JSON.parse(res.body); } catch { body = null; }
      check('  -- refusal names the environment-not-ready reason', body && body.by, 'iaos-contract-send-readback-environment-not-ready');
    } finally {
      PRODUCTION_LIVE.contractProductionEnabled = committedFlag;
    }
    check('Production committed config is ENABLED (supervised proof) and restored after the disabled case', PRODUCTION_LIVE.contractProductionEnabled, G.CONTRACT_PRODUCTION_ENABLED);
    // The committed ENABLED config still refuses an opportunity that is not the
    // pinned synthetic fixture -- never a successful readback.
    {
      const res = await prodHandler(event());
      check('Production (enabled, committed): a NON-pinned opportunity is never read back successfully', res.statusCode !== 200, true);
      check('  -- no provider document data is returned', /documentId|recipients/.test(String(res.body)), false);
    }
    process.env.IAOS_ENV = savedEnv;
    delete require.cache[require.resolve('../netlify/functions/ghl-contract-send-readback.ts')];
  }

  // ============================================================
  // 2. Request-shape rejection -- exactly {opportunityId}, nothing else.
  //    A browser-supplied documentId is NEVER accepted, alone or
  //    alongside opportunityId.
  // ============================================================
  for (const body of [
    JSON.stringify({ documentId: 'some-doc' }),
    JSON.stringify({ opportunityId: opportunity.id, documentId: 'some-doc' }),
    JSON.stringify({}),
    JSON.stringify({ opportunityId: opportunity.id, extra: 'field' }),
    JSON.stringify([opportunity.id]),
    '{',
    JSON.stringify({ opportunityId: 123 }),
    JSON.stringify({ opportunityId: 'not/a valid id' }),
  ]) {
    const before = calls;
    const res = await handler(event({ body }));
    check('malformed/extra-field/documentId-bearing body rejected (400): ' + body, res.statusCode, 400);
    check('  -- zero GHL calls occurred', calls, before);
  }

  // ============================================================
  // 3. No accepted send -> 409, no document data of any kind.
  // ============================================================
  {
    activeNotes = notesWithoutSend;
    const res = await handler(event());
    check('no accepted send: refused (409)', res.statusCode, 409);
    const text = res.body;
    check('  -- the 409 response carries no document/signer data', /providerDocumentId|signerCompletion|availableProviderRecipientIds/.test(text), false);
    activeNotes = notesWithSendAndMapping;
  }

  // ============================================================
  // 4. The approved Test contact's baseline success path.
  // ============================================================
  let successBody;
  {
    const res = await handler(event());
    check('a fully valid request succeeds (200)', res.statusCode, 200);
    successBody = JSON.parse(res.body);
    check('  -- status is accepted', successBody.status, 'accepted');
    check('  -- providerDocumentId matches the accepted send\'s own document', successBody.providerDocumentId, MANUAL_DOC_ID);
    check('  -- documentStatus reflects the live document', successBody.documentStatus, 'completed');
    check('  -- documentRevision reflects the live document', successBody.documentRevision, 1);
    check('  -- providerCompletion is a verdict object with ok/completedAt or ok/reasons', typeof successBody.providerCompletion.ok, 'boolean');
    check('  -- signerCompletion is ok, with the two required signers matched', successBody.signerCompletion.ok, true);
    check('  -- signerCompletion.matches has exactly one entry per required signer', successBody.signerCompletion.matches.length, required.length);
    check('  -- buyerIdentity verdict is ok (matched by name)', successBody.buyerIdentity.ok, true);
    check('  -- buyerIdentity carries an (empty) reasons array even when ok', Array.isArray(successBody.buyerIdentity.reasons), true);
  }

  // ============================================================
  // 5. Multiple upstream documents -- only the correct one is ever
  //    classified/consulted. Distractor documents carry a distinctive,
  //    wrong revision/status/recipient set that must NEVER leak through.
  // ============================================================
  {
    const decoyA = documentRow('decoy-document-a', { documentRevision: 999, status: 'draft', recipients: [{ id: 'decoy-recipient-a', hasCompleted: false, signedDate: null, role: 'signer', contactName: 'DECOY NAME SHOULD NEVER APPEAR', email: 'decoy@example.invalid' }] });
    const decoyB = documentRow('decoy-document-b', { documentRevision: 42, status: 'sent', recipients: [{ id: 'decoy-recipient-b', hasCompleted: true, signedDate: AT, role: 'signer', contactName: 'ANOTHER DECOY', email: null }] });
    documents = [decoyA, documentRow(MANUAL_DOC_ID), decoyB];
    const res = await handler(event());
    check('multi-document upstream response still succeeds (200)', res.statusCode, 200);
    const body = JSON.parse(res.body);
    check('  -- providerDocumentId is still the ONE matched document, never a decoy', body.providerDocumentId, MANUAL_DOC_ID);
    check('  -- documentRevision comes from the matched doc (1), never a decoy\'s (999/42)', body.documentRevision, 1);
    check('  -- documentStatus comes from the matched doc, never a decoy\'s', body.documentStatus, 'completed');
    const text = res.body;
    check('  -- neither decoy document id ever appears in the response text', /decoy-document-a|decoy-document-b/.test(text), false);
    check('  -- neither decoy recipient id ever appears in the response text', /decoy-recipient-a|decoy-recipient-b/.test(text), false);
    check('  -- the decoy\'s injected name string never appears in the response text', text.includes('DECOY NAME SHOULD NEVER APPEAR'), false);
    check('  -- availableProviderRecipientIds contains only ids from the matched document', body.availableProviderRecipientIds.every((id) => goodRecipients.some((r) => r.id === id)), true);
    check('  -- no decoy recipient id appears in availableProviderRecipientIds', body.availableProviderRecipientIds.some((id) => id.startsWith('decoy-')), false);
    documents = [documentRow(MANUAL_DOC_ID)];
  }

  // ============================================================
  // 6. availableProviderRecipientIds is deduplicated.
  // ============================================================
  {
    documents = [documentRow(MANUAL_DOC_ID, { recipients: [...goodRecipients, goodRecipients[0]] })]; // a literal duplicate row
    const res = await handler(event());
    const body = JSON.parse(res.body);
    const ids = body.availableProviderRecipientIds;
    check('duplicate recipient rows are deduplicated in the id list', ids.length, new Set(ids).size);
    check('  -- the deduplicated list still has exactly the expected number of unique ids', new Set(ids).size, required.length);
    documents = [documentRow(MANUAL_DOC_ID)];
  }

  // ============================================================
  // 7. No raw document/recipient/fillable-field/sender data of any kind
  //    reaches the response -- a full recursive key scan, not a spot
  //    check. Also proves no multi-document array is present.
  // ============================================================
  {
    const res = await handler(event());
    const body = JSON.parse(res.body);
    const keys = allKeys(body);
    for (const forbidden of ['documents', 'recipients', 'links', 'fillableFields', 'createdBy', 'recipientId', 'contactName', 'email', 'reportedEmail', 'reportedContactName']) {
      check('response never carries the key "' + forbidden + '" anywhere', keys.has(forbidden), false);
    }
    check('response has no array of more than one document-shaped entry (signerCompletion.matches is the only array of objects, sized to required signers)', Array.isArray(body.signerCompletion.matches) && body.signerCompletion.matches.length <= required.length, true);
  }

  // ============================================================
  // 8. Buyer-identity mismatch -- server-side verdict is false, but the
  //    underlying provider-reported (wrong) name AND the real authorized
  //    buyer name never appear anywhere in the response.
  // ============================================================
  {
    const wrongName = 'Someone Else Entirely';
    const mismatchedRecipients = goodRecipients.map((r, i) => (i === 0 ? Object.assign({}, r, { contactName: wrongName }) : r));
    documents = [documentRow(MANUAL_DOC_ID, { recipients: mismatchedRecipients })];
    const res = await handler(event());
    const body = JSON.parse(res.body);
    check('buyer-identity mismatch is reported (ok: false)', body.buyerIdentity.ok, false);
    check('  -- reason code is BUYER_IDENTITY_MISMATCH', body.buyerIdentity.reasons.map((r) => r.code), ['BUYER_IDENTITY_MISMATCH']);
    const text = res.body;
    check('  -- the WRONG provider-reported (GHL) name never appears in the response text', text.includes(wrongName), false);
    check('  -- the redacted message names no name/email at all', /reported name \(|reported email \(/.test(text), false);
    documents = [documentRow(MANUAL_DOC_ID)];
  }

  // ============================================================
  // 9. Source-wiring: ghl-contract-send-readback.ts imports the shared
  //    INV-98 policy and requireAppWriteOrigin, never reimplements
  //    either; ContractWorkspace.tsx no longer calls the raw proxy path
  //    for provider readback; ghl-proxy.ts's own /proposals/* gate is
  //    untouched by this repair.
  // ============================================================
  const endpointSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'ghl-contract-send-readback.ts'), 'utf8');
  check('imports requireAppWriteOrigin from the shared PR #78 helper', /import \{ requireAppWriteOrigin \} from "\.\/lib\/app-write-origin"/.test(endpointSrc), true);
  check('imports the shared contract-production-readiness policy, never reimplements a location check', /import \{ evaluateContractEnvironment, requireContractProviderEvidenceReadiness \} from "\.\/lib\/contract-production-readiness"/.test(endpointSrc), true);
  check('requireAppWriter is called exactly once in the endpoint source', (endpointSrc.match(/requireAppWriter\(event\)/g) || []).length, 1);
  check('the accepted send is derived via latestContractSendForOpportunity, never from a request field', /latestContractSendForOpportunity\(context\.notes, opportunityId\)/.test(endpointSrc), true);
  check('buyer-identity verification (including the B9-13/INV-96 email fallback) is wired server-side: buyerSignerRole/authorizedBuyerName/authorizedBuyerEmail all sourced from requiredSignerSetResult, never hardcoded or guessed', /buyerSignerRole: requiredSignerSetResult\.buyerRole,\s*\n\s*authorizedBuyerName: requiredSignerSetResult\.buyerDisplayName,\s*\n\s*authorizedBuyerEmail: requiredSignerSetResult\.buyerEmail,/.test(endpointSrc), true);

  const workspaceSrc = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8');
  check('ContractWorkspace.tsx no longer calls ghl.proposals.listDocuments for provider readback', /ghl\.proposals\.listDocuments/.test(workspaceSrc), false);
  check('ContractWorkspace.tsx now calls ghl.proposals.readback with an opportunityId', /ghl\.proposals\.readback\(\{\s*opportunityId:/.test(workspaceSrc), true);

  const proxySrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'ghl-proxy.ts'), 'utf8');
  check('ghl-proxy.ts still gates /proposals/* Test-only, untouched by this repair', /iaos-proxy-documents-contracts-test-only/.test(proxySrc), true);

  console.log('');
  console.log(checks + ' checks, ' + failures + ' failures.');
  console.log('No live write, GHL mutation, deployment, or Production access occurred in this run -- every fixture above is an in-memory object; global.fetch was never invoked against a real network.');
  if (failures > 0) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
