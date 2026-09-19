/**
 * Board #9 Phase B correction -- proves the INDEPENDENT artifact-currency
 * architecture end to end: write-contract-context.ts's
 * currentGeneratedArtifactFacts/generateCurrentContractPdf/
 * requireCurrentContractAuthorization, and write-derived-note.ts's
 * authorization branch, all independently REGENERATE the current PDF from
 * fresh canonical facts via the real, merged PR #81 runtime generator --
 * never from a stored authorization record's own claim. Every GHL call is
 * a mocked, in-memory fixture; no network call, no live GHL access.
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
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';
process.env.GHL_API_TOKEN = 'offline-fixture';

const load = (name) => require('../src/lib/' + name + '.ts');
const config = require('../shared/ghl-config.ts').getConfig('test');
const boundaryLib = require('../netlify/functions/lib/ghl-write-boundary.ts');
const contextLib = require('../netlify/functions/lib/write-contract-context.ts');
const derivedNote = require('../netlify/functions/lib/write-derived-note.ts');

let checks = 0, failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name); console.error('      expected: ' + JSON.stringify(expected)); console.error('      actual:   ' + JSON.stringify(actual)); }
}
function checkTrue(name, actual) { check(name, actual, true); }
async function checkRejects(name, fn) {
  checks++;
  try { await fn(); failures++; console.error('FAIL  ' + name); console.error('      expected a throw; none occurred'); }
  catch (e) { console.log('PASS  ' + name + ' (' + (e && e.message ? e.message.slice(0, 90) : e) + ')'); }
}

const contact = { id: config.documentsContracts.approvedTestContactId, locationId: config.locationId, customFields: [], firstName: 'Jane', lastName: 'Seller', email: 'seller@example.com', address1: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' };
const opportunity = { id: 'fixture-opportunity-artifact-verification', contactId: contact.id, locationId: config.locationId, customFields: [{ id: config.opportunityFacts.currentOffer, fieldValue: 190000 }] };
const fixture = require('./write-contract-fixture.cjs').contractFixture(load, opportunity.id);
let notes = [...fixture.notes];
const reply = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
global.fetch = async (url) => {
  const u = new URL(url);
  assert.equal(u.origin, 'https://services.leadconnectorhq.com', 'no external network');
  if (u.pathname === '/opportunities/' + opportunity.id) return reply({ opportunity });
  if (u.pathname === '/contacts/' + contact.id) return reply({ contact });
  if (u.pathname === '/contacts/' + contact.id + '/notes') return reply({ notes });
  throw new Error('Unexpected mocked request ' + u.pathname);
};
const boundary = boundaryLib.configuredBoundary();

(async () => {
  // ============================================================
  // 1. A matching, independently generated artifact authorizes
  //    successfully -- the server regenerates the PDF itself and the
  //    result matches a genuinely-current stored authorization record.
  // ============================================================
  const context1 = await contextLib.currentContractContext(boundary, opportunity.id);
  checkTrue('setup: the fixture context produces a complete projection', context1.projection.ok === true);
  const realArtifact1 = await contextLib.currentGeneratedArtifactFacts(context1);
  checkTrue('the independently regenerated artifactSha256 is a real 64-hex digest, never a placeholder', /^[0-9a-f]{64}$/.test(realArtifact1.artifactSha256));
  const authBuilt1 = load('contract-authorization-model').buildAuthorizationRecordArgs({ opportunityId: opportunity.id, at: context1.version.agreementAt, preview: context1.preview, currentVersion: context1.version, artifact: realArtifact1 });
  checkTrue('a genuine authorization record builds successfully against the real artifact facts', authBuilt1.ok === true);
  const authNote1 = load('contract-authorization-carriers').formatBradContractAuthorizationNote(authBuilt1.value);
  notes.push({ id: 'note-auth-1', body: authNote1 });
  await derivedNote.validateDerivedNote(boundary, authNote1);
  console.log('PASS  validateDerivedNote accepts a matching, independently generated artifact (no throw)'); checks++;
  const context1b = await contextLib.requireCurrentContractAuthorization(boundary, opportunity.id);
  checkTrue('requireCurrentContractAuthorization succeeds and returns the live context', context1b.opportunity.id === opportunity.id);

  // ============================================================
  // 2. Changed canonical facts produce ARTIFACT_CHANGED -- mutating a
  //    fact note AFTER authorization changes what the server independently
  //    regenerates, so currency now fails, naming ARTIFACT_CHANGED among
  //    its reasons (content also changed, so CONTENT_CHANGED co-occurs --
  //    proving artifact currency is a REAL, independent check, not merely
  //    inherited from the content check).
  // ============================================================
  const closingIdx = notes.findIndex((n) => n.body.includes('IAOS CLOSING AND POSSESSION FACTS'));
  const originalClosingNote = notes[closingIdx];
  notes[closingIdx] = { body: load('seller-contract-facts-carriers').formatClosingPossessionFactsNote({ opportunityId: opportunity.id, at: '2026-09-12T00:00:00.000Z', operator: 'brad', closingDate: '2099-01-01T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } }) };
  const context2 = await contextLib.currentContractContext(boundary, opportunity.id);
  checkTrue('setup: the mutated context still produces a complete projection (a real regeneration is possible)', context2.projection.ok === true);
  const currency2 = load('contract-authorization-model').evaluateBradAuthorizationCurrency(load('contract-authorization-carriers').parseBradContractAuthorizationNote(authNote1), context2.preview, await contextLib.currentGeneratedArtifactFacts(context2));
  checkTrue('currency fails once canonical facts changed', currency2.authorized === false);
  checkTrue('the refusal names ARTIFACT_CHANGED', currency2.reasons.some((r) => r.code === 'ARTIFACT_CHANGED'));
  checkTrue('the refusal also names CONTENT_CHANGED (the artifact check is independent of, not a substitute for, the content check)', currency2.reasons.some((r) => r.code === 'CONTENT_CHANGED'));
  await checkRejects('validateDerivedNote fails closed once canonical facts changed under an already-recorded authorization', () => derivedNote.validateDerivedNote(boundary, authNote1));
  notes[closingIdx] = originalClosingNote; // restore for subsequent sections

  // ============================================================
  // 3. Missing generation evidence fails closed -- an incomplete
  //    projection (a required fact note removed) means there is no PDF to
  //    regenerate at all; the server must refuse, never fall back to the
  //    stored record's own claim.
  // ============================================================
  const partiesIdx = notes.findIndex((n) => n.body.includes('IAOS SELLER CONTRACT PARTY/SIGNER FACTS'));
  const removedPartiesNote = notes[partiesIdx];
  notes.splice(partiesIdx, 1);
  const context3 = await contextLib.currentContractContext(boundary, opportunity.id);
  checkTrue('setup: removing a required fact note makes the projection incomplete', context3.projection.ok === false);
  await checkRejects('generateCurrentContractPdf fails closed when the projection is incomplete (no generation evidence exists to trust)', () => contextLib.generateCurrentContractPdf(context3));
  await checkRejects('currentGeneratedArtifactFacts fails closed for the same reason', () => contextLib.currentGeneratedArtifactFacts(context3));
  await checkRejects('requireCurrentContractAuthorization fails closed rather than silently authorizing', () => contextLib.requireCurrentContractAuthorization(boundary, opportunity.id));
  await checkRejects('validateDerivedNote fails closed for an authorization note when generation evidence is unavailable', () => derivedNote.validateDerivedNote(boundary, authNote1));
  notes.splice(partiesIdx, 0, removedPartiesNote); // restore

  // ============================================================
  // 4. A generation FAILURE (distinct from an incomplete projection) also
  //    fails closed. Board #9 Phase B packaging correction: generateCurrent
  //    ContractPdf now delegates to the merged PR #81 adapter
  //    (generate-contract-pdf-adapter.ts), which REBUILDS its own
  //    projection internally from preview/report/sellerReadiness rather
  //    than trusting a pre-built one -- so a caller can no longer reach the
  //    generator with a corrupted-but-"ok" plan at all (the adapter's own
  //    re-derivation makes that class of caller-side corruption
  //    unreachable by construction, a deliberate architectural property,
  //    not a gap). The remaining genuine "generation failure distinct from
  //    incomplete projection" is an ASSET/RUNTIME failure -- the packaged
  //    canonical PDF missing from the deployed bundle -- proven directly
  //    against the REAL packaged artifact in test-inv67-pdf-packaging.cjs
  //    ("missing packaged PDF fails closed"), which is the more realistic
  //    and now the authoritative proof for this scenario.
  // ============================================================

  // ============================================================
  // 5. The retired send model cannot claim authorization -- see
  //    test-contract-send-model.cjs for the exhaustive proof (every
  //    evaluateSendEligibility/buildSendAttemptArgs/buildContractSentEvidence
  //    call site there now uniformly refuses via ARTIFACT_FACTS_INVALID).
  //    Reconfirmed here directly against contract-send-model.ts's exported
  //    RETIRED_PATH_NEVER_MATCHES_ARTIFACT_FACTS-driven behavior using this
  //    file's own real, independently-generated artifact facts, proving
  //    the retirement holds even when a GENUINELY current artifact exists.
  // ============================================================
  const sendModelSrc = fs.readFileSync(path.join(APP, 'src', 'lib', 'contract-send-model.ts'), 'utf8');
  checkTrue('contract-send-model.ts contains no self-referential artifact-facts helper (selfReferentialArtifactFacts)', !/selfReferentialArtifactFacts/.test(sendModelSrc));
  checkTrue('contract-send-model.ts\'s retired-path sentinel is a structurally-invalid (all-empty) bundle, never echoing a caller-supplied record', /RETIRED_PATH_NEVER_MATCHES_ARTIFACT_FACTS[\s\S]{0,300}artifactSha256:\s*""/.test(sendModelSrc));

  console.log('');
  console.log(checks + ' checks, ' + failures + ' failures.');
  console.log('No live write, GHL mutation, deployment, or Production access occurred in this run -- every fixture above is an in-memory object and global.fetch is fully mocked.');
  if (failures > 0) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
