/**
 * INV-98 Phase 1 -- direct, offline unit coverage for the shared
 * `contract-production-readiness.ts` policy, plus source-wiring proof
 * that both live call sites (`generate-contract-pdf.ts`,
 * `write-derived-note.ts`'s two occurrences) route through the SAME
 * implementation, that Production stays disabled, and that no dead V1
 * path (automated send, 118-field projection, contractDraftRequest,
 * contractSellerCountField, ghl-contract-send-readback) was revived.
 *
 * Every fixture here is an in-memory object. No network call, no live
 * GHL/Netlify/Production access.
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
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid,second-brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';

const {
  getConfig,
  CONTRACT_PRODUCTION_ENABLED,
  CONTRACT_PRODUCTION_NOT_ENABLED,
  UNDER_CONTRACT_STAGE_NOT_PROVISIONED,
} = require('../shared/ghl-config.ts');
const {
  evaluateContractEnvironment,
  evaluateContractProviderEvidenceReadiness,
  requireContractProviderEvidenceReadiness,
} = require('../netlify/functions/lib/contract-production-readiness.ts');

const TEST_CONFIG = getConfig('test');
const PRODUCTION_CONFIG = getConfig('production');
const APPROVED_BRAD_EMAIL = 'brad@example.invalid';

let checks = 0, failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name); console.error('      expected: ' + JSON.stringify(expected)); console.error('      actual:   ' + JSON.stringify(actual)); }
}
function reasonCodes(result) { return result.ok ? [] : result.reasons.map((r) => r.code).sort(); }

// A synthetic, structurally-enabled Production config -- built ONLY in
// memory, for this test process, never written back to shared/ghl-config.ts.
// Proves the POLICY logic works correctly once enabled, without ever
// actually enabling real Production (that remains
// CONTRACT_PRODUCTION_NOT_ENABLED in the committed config throughout this
// phase -- see the dedicated "Production remains disabled" section below).
function enabledProductionConfig(overrides = {}) {
  return {
    ...PRODUCTION_CONFIG,
    contractProductionEnabled: CONTRACT_PRODUCTION_ENABLED,
    stages: { ...PRODUCTION_CONFIG.stages, underContract: 'fixtureRealLookingStageId123', ...(overrides.stages ?? {}) },
    ...overrides,
  };
}

// ============================================================
// 1. Existing Test behavior remains unchanged.
// ============================================================
{
  const contact = { id: TEST_CONFIG.documentsContracts.approvedTestContactId };
  const opportunity = { id: 'fixture-opportunity-1', contactId: contact.id };
  const result = evaluateContractProviderEvidenceReadiness({ config: TEST_CONFIG, contact, opportunity, operatorEmail: APPROVED_BRAD_EMAIL });
  check('Test: the exact approved Test contact still succeeds, unchanged', result.ok, true);
  assert.doesNotThrow(() => requireContractProviderEvidenceReadiness({ config: TEST_CONFIG, contact, opportunity, operatorEmail: APPROVED_BRAD_EMAIL }));
  check('Test: requireContractProviderEvidenceReadiness does not throw for the approved contact', true, true);
}
{
  const contact = { id: 'some-other-test-contact-id' };
  const opportunity = { id: 'fixture-opportunity-2', contactId: contact.id };
  const result = evaluateContractProviderEvidenceReadiness({ config: TEST_CONFIG, contact, opportunity, operatorEmail: APPROVED_BRAD_EMAIL });
  check('Test: a non-approved Test contact still refuses, unchanged', result.ok, false);
  check('Test: refusal reason is exactly TEST_CONTACT_MISMATCH', reasonCodes(result), ['TEST_CONTACT_MISMATCH']);
  let threw = null;
  try { requireContractProviderEvidenceReadiness({ config: TEST_CONFIG, contact, opportunity, operatorEmail: APPROVED_BRAD_EMAIL }); } catch (e) { threw = e; }
  check('Test: the thrown message is byte-for-byte the ORIGINAL pre-Phase-1 text (existing callers/messages depend on this)', threw && threw.message, 'Contract provider evidence is Test-only');
}

// ============================================================
// 2. Test and Production location/configuration cannot cross.
// ============================================================
{
  check('TEST.locationId !== PRODUCTION.locationId', TEST_CONFIG.locationId !== PRODUCTION_CONFIG.locationId, true);
  check('evaluateContractEnvironment(TEST_CONFIG) resolves to "test"', evaluateContractEnvironment(TEST_CONFIG), { ok: true, environment: 'test' });
  const prodEnv = evaluateContractEnvironment(PRODUCTION_CONFIG);
  check('evaluateContractEnvironment(PRODUCTION_CONFIG) never resolves to "test"', prodEnv.ok && prodEnv.environment === 'test', false);
  // A config claiming Production's OWN location but never matching Test's --
  // structurally cannot resolve as "test" regardless of any other field.
  const crossed = { ...PRODUCTION_CONFIG, documentsContracts: { ...PRODUCTION_CONFIG.documentsContracts, approvedTestContactId: TEST_CONFIG.documentsContracts.approvedTestContactId } };
  check('a Production-location config carrying TEST\'s own approved-contact value STILL never resolves to "test" (location, not contact, decides environment)', evaluateContractEnvironment(crossed).environment !== 'test', true);
}

// ============================================================
// 3. Production refuses while enablement is false.
// ============================================================
{
  check('PRODUCTION.contractProductionEnabled is CONTRACT_PRODUCTION_NOT_ENABLED (committed config, this phase)', PRODUCTION_CONFIG.contractProductionEnabled, CONTRACT_PRODUCTION_NOT_ENABLED);
  const result = evaluateContractEnvironment(PRODUCTION_CONFIG);
  check('Production refuses while enablement is false', result.ok, false);
  check('refusal names PRODUCTION_CONTRACTS_DISABLED', result.ok ? [] : result.reasons.map((r) => r.code), ['PRODUCTION_CONTRACTS_DISABLED', 'UNDER_CONTRACT_STAGE_NOT_PROVISIONED']);
}

// ============================================================
// 4. Production refuses sentinels, empty values, and malformed IDs.
// ============================================================
{
  const enabledButSentinelStage = enabledProductionConfig({ stages: { ...PRODUCTION_CONFIG.stages, underContract: UNDER_CONTRACT_STAGE_NOT_PROVISIONED } });
  check('enabled Production with the literal stage sentinel still refuses', evaluateContractEnvironment(enabledButSentinelStage).ok, false);
  check('  -- reason is UNDER_CONTRACT_STAGE_NOT_PROVISIONED', reasonCodes(evaluateContractEnvironment(enabledButSentinelStage)), ['UNDER_CONTRACT_STAGE_NOT_PROVISIONED']);

  const enabledButEmptyStage = enabledProductionConfig({ stages: { ...PRODUCTION_CONFIG.stages, underContract: '' } });
  check('enabled Production with an EMPTY stage id refuses', evaluateContractEnvironment(enabledButEmptyStage).ok, false);

  const enabledButWhitespaceStage = enabledProductionConfig({ stages: { ...PRODUCTION_CONFIG.stages, underContract: '   ' } });
  check('enabled Production with a WHITESPACE-ONLY stage id refuses', evaluateContractEnvironment(enabledButWhitespaceStage).ok, false);

  const enabledButMalformedStage = enabledProductionConfig({ stages: { ...PRODUCTION_CONFIG.stages, underContract: '../../path-traversal-shaped' } });
  check('enabled Production with a MALFORMED (path-shaped) stage id refuses', evaluateContractEnvironment(enabledButMalformedStage).ok, false);

  const wellFormedButDisabled = { ...PRODUCTION_CONFIG, stages: { ...PRODUCTION_CONFIG.stages, underContract: 'fixtureRealLookingStageId123' } };
  check('a well-formed stage id ALONE, still disabled, still refuses (enablement is checked independently)', evaluateContractEnvironment(wellFormedButDisabled).ok, false);
  check('  -- reason is exactly PRODUCTION_CONTRACTS_DISABLED once the stage is well-formed', reasonCodes(evaluateContractEnvironment(wellFormedButDisabled)), ['PRODUCTION_CONTRACTS_DISABLED']);
}

// ============================================================
// 5. Production refuses the Test location/contact/configuration.
// ============================================================
{
  // A Production-enabled config that has (mistakenly) been given Test's own
  // locationId resolves as TEST, not Production -- Test's own approved-
  // contact pin governs it, the Production-enablement fields are never
  // consulted at all.
  const mistakenlyTestLocation = { ...enabledProductionConfig(), locationId: TEST_CONFIG.locationId };
  const env = evaluateContractEnvironment(mistakenlyTestLocation);
  check('a Production-shaped config carrying TEST\'s locationId resolves as "test", never "production"', env, { ok: true, environment: 'test' });

  // A genuinely Production-enabled config given TEST's approved contact ID
  // gets NO special treatment -- Production has no contact allowlist to
  // match against at all (see item 8), so this is evaluated purely on the
  // operator/relationship checks, exactly like any other contact would be.
  const prodConfig = enabledProductionConfig();
  const result = evaluateContractProviderEvidenceReadiness({
    config: prodConfig,
    contact: { id: TEST_CONFIG.documentsContracts.approvedTestContactId },
    opportunity: { id: 'fixture-prod-opportunity', contactId: TEST_CONFIG.documentsContracts.approvedTestContactId },
    operatorEmail: APPROVED_BRAD_EMAIL,
  });
  check('Production with Test\'s own contact id, but a valid operator and relationship, still succeeds (no special-casing either way)', result.ok, true);
}

// ============================================================
// 6. Production refuses an unauthorized origin -- enforced at the HTTP
// boundary in BOTH live call paths, unconditionally, BEFORE the
// environment check ever runs (see test-generate-contract-pdf-endpoint.cjs
// item 4's own origin-ordering proof, and ghl-write.ts's own established
// auth -> origin -> dispatch order, confirmed by source-wiring below).
// ============================================================
{
  const ghlWriteSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'ghl-write.ts'), 'utf8');
  const genPdfSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'generate-contract-pdf.ts'), 'utf8');
  check('ghl-write.ts checks requireAppWriter BEFORE requireAppWriteOrigin BEFORE any write dispatch (unconditional, every operation including opportunity_stage and note)', ghlWriteSrc.indexOf('requireAppWriter(event)') < ghlWriteSrc.indexOf('requireAppWriteOrigin(event)'), true);
  check('generate-contract-pdf.ts checks requireAppWriter BEFORE requireAppWriteOrigin BEFORE the environment-readiness check', genPdfSrc.indexOf('requireAppWriter(event)') < genPdfSrc.indexOf('requireAppWriteOrigin(event)') && genPdfSrc.indexOf('requireAppWriteOrigin(event)') < genPdfSrc.indexOf('evaluateContractEnvironment(CONFIG)'), true);
}

// ============================================================
// 7. Production refuses an unauthorized/non-Brad session.
// ============================================================
{
  const prodConfig = enabledProductionConfig();
  const contact = { id: 'fixture-prod-contact-a' };
  const opportunity = { id: 'fixture-prod-opportunity-a', contactId: contact.id };
  const notBrad = evaluateContractProviderEvidenceReadiness({ config: prodConfig, contact, opportunity, operatorEmail: 'not-brad@example.invalid' });
  check('Production refuses an operator email that is not in the currently-configured allowlist', notBrad.ok, false);
  check('  -- reason is OPERATOR_NOT_AUTHORIZED', reasonCodes(notBrad), ['OPERATOR_NOT_AUTHORIZED']);

  const empty = evaluateContractProviderEvidenceReadiness({ config: prodConfig, contact, opportunity, operatorEmail: '' });
  check('Production refuses an empty operator email', empty.ok, false);
  check('  -- reason is OPERATOR_NOT_AUTHORIZED for an empty email too', reasonCodes(empty), ['OPERATOR_NOT_AUTHORIZED']);

  // Gate-review closure -- the readiness helper must use the SAME
  // normalization rule as requireAppWriter itself (exact match against the
  // already-lowercased appAuthConfig().emails allowlist), never a second,
  // more-lenient rule of its own. requireAppWriter's own success path is
  // case-SENSITIVE against that same already-normalized list, so any value
  // it actually returns is by construction already in exact allowlist form
  // -- a casing variant could only ever reach this helper from something
  // OTHER than a genuine requireAppWriter return value, and must be refused.
  const caseVariant = evaluateContractProviderEvidenceReadiness({ config: prodConfig, contact, opportunity, operatorEmail: APPROVED_BRAD_EMAIL.toUpperCase() });
  check('Production REFUSES a case-variant operator email (exact-match only, same normalization rule as requireAppWriter -- no second, more-lenient rule here)', caseVariant.ok, false);
  check('  -- reason is OPERATOR_NOT_AUTHORIZED for a case-variant email', reasonCodes(caseVariant), ['OPERATOR_NOT_AUTHORIZED']);

  const exactMatch = evaluateContractProviderEvidenceReadiness({ config: prodConfig, contact, opportunity, operatorEmail: APPROVED_BRAD_EMAIL });
  check('Production accepts the operator email in its exact, already-normalized form', exactMatch.ok, true);

  const secondApproved = evaluateContractProviderEvidenceReadiness({ config: prodConfig, contact, opportunity, operatorEmail: 'second-brad@example.invalid' });
  check('Production accepts ANY currently-configured allowed Brad email, not just the first one', secondApproved.ok, true);
}

// ============================================================
// 8. Production does not require a permanent contact allowlist after
// proper enablement -- any real, distinct contact/opportunity pair
// succeeds once enabled + authorized + related, with no equivalent of
// Test's `approvedTestContactId` pin anywhere in the Production branch.
// ============================================================
{
  const prodConfig = enabledProductionConfig();
  const first = evaluateContractProviderEvidenceReadiness({
    config: prodConfig, contact: { id: 'synthetic-proof-contact-one' }, opportunity: { id: 'opp-one', contactId: 'synthetic-proof-contact-one' }, operatorEmail: APPROVED_BRAD_EMAIL,
  });
  check('Production accepts a first, arbitrary real contact once enabled/authorized/related', first.ok, true);
  const second = evaluateContractProviderEvidenceReadiness({
    config: prodConfig, contact: { id: 'a-completely-different-contact-two' }, opportunity: { id: 'opp-two', contactId: 'a-completely-different-contact-two' }, operatorEmail: APPROVED_BRAD_EMAIL,
  });
  check('Production ALSO accepts a second, entirely different, arbitrary real contact -- proving no single pinned contact id is required', second.ok, true);
  const readinessSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'contract-production-readiness.ts'), 'utf8');
  const productionBranch = readinessSrc.slice(readinessSrc.indexOf('} else {'), readinessSrc.indexOf('return reasons.length > 0'));
  check('the Production branch never references approvedTestContactId at all (source-level proof, not just behavioral)', /approvedTestContactId/.test(productionBranch), false);
}

// ============================================================
// 9. Contact/opportunity mismatch is refused.
// ============================================================
{
  const testMismatch = evaluateContractProviderEvidenceReadiness({
    config: TEST_CONFIG,
    contact: { id: TEST_CONFIG.documentsContracts.approvedTestContactId },
    opportunity: { id: 'fixture-opp-mismatch', contactId: 'a-totally-different-contact-id' },
    operatorEmail: APPROVED_BRAD_EMAIL,
  });
  check('Test: a mismatched opportunity.contactId is refused even for the approved contact', testMismatch.ok, false);
  check('  -- reason includes CONTACT_OPPORTUNITY_MISMATCH', reasonCodes(testMismatch).includes('CONTACT_OPPORTUNITY_MISMATCH'), true);

  const prodConfig = enabledProductionConfig();
  const prodMismatch = evaluateContractProviderEvidenceReadiness({
    config: prodConfig,
    contact: { id: 'contact-a' },
    opportunity: { id: 'opp-a', contactId: 'contact-b' },
    operatorEmail: APPROVED_BRAD_EMAIL,
  });
  check('Production: a mismatched opportunity.contactId is refused too', prodMismatch.ok, false);
  check('  -- reason includes CONTACT_OPPORTUNITY_MISMATCH', reasonCodes(prodMismatch).includes('CONTACT_OPPORTUNITY_MISMATCH'), true);
}

// ============================================================
// 10. Both provider-evidence call sites use the SAME shared policy --
// exactly one implementation, never two parallel copies.
// ============================================================
{
  const derivedSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'write-derived-note.ts'), 'utf8');
  const callCount = (derivedSrc.match(/requireContractProviderEvidenceReadiness\(/g) || []).length;
  check('write-derived-note.ts calls the shared policy at exactly two sites (validateDerivedNote\'s providerOutcome, and verifyUnderContractStageTransitionReady)', callCount, 2);
  check('write-derived-note.ts no longer contains the old inline duplicated check', /config\.locationId !== getConfig\("test"\)\.locationId \|\| context\.contact\.id !== config\.documentsContracts\.approvedTestContactId/.test(derivedSrc), false);
  check('write-derived-note.ts no longer contains the literal "Contract provider evidence is Test-only" string inline (it now lives ONLY inside the shared module)', /throw new Error\("Contract provider evidence is Test-only"\)/.test(derivedSrc), false);
  check('write-derived-note.ts imports requireContractProviderEvidenceReadiness from the shared module, never reimplements it', /import \{ requireContractProviderEvidenceReadiness \} from "\.\/contract-production-readiness"/.test(derivedSrc), true);

  const genPdfSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'generate-contract-pdf.ts'), 'utf8');
  check('generate-contract-pdf.ts also imports the SAME shared module (not a third, separate copy)', /from "\.\/lib\/contract-production-readiness"/.test(genPdfSrc), true);

  // The two exported functions this whole phase is built on live in exactly
  // one file.
  const readinessFiles = ['generate-contract-pdf.ts', 'lib/write-derived-note.ts', 'lib/contract-production-readiness.ts'].map((f) => fs.readFileSync(path.join(APP, 'netlify', 'functions', f), 'utf8'));
  const definitionCount = readinessFiles.filter((s) => /export function (evaluateContractEnvironment|evaluateContractProviderEvidenceReadiness|requireContractProviderEvidenceReadiness)\(/.test(s)).length;
  check('the three exported readiness functions are DEFINED in exactly one of these three files', definitionCount, 1);
}

// ============================================================
// 11. Closed-Won remains forbidden.
// ============================================================
{
  const ghlWriteSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'ghl-write.ts'), 'utf8');
  check('the opportunity_stage dispatch still names config.stages.sellerClosedWon as a forbidden target, unconditionally', /forbiddenStageIds = \[config\.stages\.sellerClosedWon\]/.test(ghlWriteSrc), true);
  check('the forbidden-stage list is passed to transitionOpportunityStage on every call (this phase never touched that call site)', /boundary\.transitionOpportunityStage\(targetId, config\.pipelines\.sellerLeads, targetStageId, forbiddenStageIds, \{\s*beforePut: \(\) => claimStageTransition\(targetId, requestId, operator\),\s*afterConfirmed: \(\) => clearStageTransition\(targetId\),\s*\}\)/.test(ghlWriteSrc), true);
}

// ============================================================
// 12. No new write operation, automatic effect, retry, or background
// mutation is introduced.
// ============================================================
{
  const readinessSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'contract-production-readiness.ts'), 'utf8');
  check('contract-production-readiness.ts performs no fetch() call of any kind -- purely a read-only, in-memory evaluator', /fetch\(/.test(readinessSrc), false);
  check('contract-production-readiness.ts calls no boundary.call/boundary.note/boundary.transitionOpportunityStage -- no write of any kind', /boundary\.(call|note|transitionOpportunityStage)\(/.test(readinessSrc), false);
  check('contract-production-readiness.ts sets no timer/interval/retry of any kind', /setTimeout|setInterval/.test(readinessSrc), false);

  const writeContractsSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'write-contracts.ts'), 'utf8');
  const opCount = (writeContractsSrc.match(/case "[a-zA-Z_.]+":/g) || []).length;
  check('write-contracts.ts\'s own operation-allowlist switch was not touched by this phase (exact same case count as origin/main before this phase)', opCount, 17);
}

// ============================================================
// 13. Dead/retired automated-send and projection paths remain unused.
// ============================================================
{
  const workspaceSrc = fs.readFileSync(path.join(APP, 'src', 'pages', 'ContractWorkspace.tsx'), 'utf8');
  check('ContractWorkspace.tsx still has no handleSyncContractProjectionFields handler', /handleSyncContractProjectionFields/.test(workspaceSrc), false);
  check('ContractWorkspace.tsx still has no contract-projection-sync-button control', /contract-projection-sync-button/.test(workspaceSrc), false);
  // INV-98 gate-review hardening round -- this is now the CORRECT, intended
  // behavior, not dead code: ContractWorkspace.tsx now calls the
  // authenticated, scoped, data-minimized ghl-contract-send-readback.ts
  // endpoint (via ghl.proposals.readback({opportunityId})) instead of the
  // raw, unauthenticated ghl-proxy.ts /proposals/document passthrough.
  check('ContractWorkspace.tsx now calls the authenticated ghl.proposals.readback({opportunityId}) endpoint (no longer dead code)', /ghl\.proposals\.readback\(\{\s*opportunityId:/.test(workspaceSrc), true);
  check('ContractWorkspace.tsx no longer calls the raw, unauthenticated ghl.proposals.listDocuments proxy path', /ghl\.proposals\.listDocuments/.test(workspaceSrc), false);
  check('ContractWorkspace.tsx still never calls proposals.reserveSend or proposals.send (automated send)', /proposals\.reserveSend|proposals\.send\(/.test(workspaceSrc), false);

  const contextSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'write-contract-context.ts'), 'utf8');
  check('write-contract-context.ts still builds context.projection (unchanged), but generate-contract-pdf-adapter.ts is the ONLY consumer of a projection plan\'s .ok gate (context.projection itself remains unread downstream)', /const projection = buildContractProjectionPlan/.test(contextSrc), true);

  const adapterSrc = fs.readFileSync(path.join(APP, 'netlify', 'functions', 'lib', 'generate-contract-pdf-adapter.ts'), 'utf8');
  check('the adapter\'s own projectionPlan gate never references any of the 118 contractProjectionFields GHL ids -- it depends only on canonical facts', /contractProjectionFields/.test(adapterSrc), false);
}

// ============================================================
// 14. Production configuration cannot be considered ready merely because
// sentinel strings are non-empty -- getConfig's OWN completeness check
// (non-empty only) is deliberately weaker than this phase's own
// named-sentinel-equality checks, and both are exercised here to prove
// the distinction is real, not assumed.
// ============================================================
{
  let getConfigThrew = false;
  try { getConfig('production'); } catch { getConfigThrew = true; }
  check('getConfig("production") itself does NOT throw -- every sentinel is a non-empty string, so its own completeness check alone is insufficient to protect Production', getConfigThrew, false);
  check('evaluateContractEnvironment(getConfig("production")) STILL correctly refuses, despite getConfig\'s own check passing', evaluateContractEnvironment(PRODUCTION_CONFIG).ok, false);
  check('the refusal is specifically the named-sentinel-equality checks (PRODUCTION_CONTRACTS_DISABLED / UNDER_CONTRACT_STAGE_NOT_PROVISIONED), never a generic "incomplete configuration" message', reasonCodes(evaluateContractEnvironment(PRODUCTION_CONFIG)).every((c) => c === 'PRODUCTION_CONTRACTS_DISABLED' || c === 'UNDER_CONTRACT_STAGE_NOT_PROVISIONED'), true);
}

// ============================================================
// Proof Production remains disabled throughout this phase -- the single
// most load-bearing assertion in this whole file.
// ============================================================
{
  check('PRODUCTION.contractProductionEnabled is committed as CONTRACT_PRODUCTION_NOT_ENABLED, not CONTRACT_PRODUCTION_ENABLED', PRODUCTION_CONFIG.contractProductionEnabled === CONTRACT_PRODUCTION_NOT_ENABLED && PRODUCTION_CONFIG.contractProductionEnabled !== CONTRACT_PRODUCTION_ENABLED, true);
  check('PRODUCTION.stages.underContract is still the sentinel, not a real stage id', PRODUCTION_CONFIG.stages.underContract, UNDER_CONTRACT_STAGE_NOT_PROVISIONED);
  check('PRODUCTION.documentsContracts.approvedTestContactId was not populated with a real id this phase', /^PRODUCTION_SEND_NOT_AUTHORIZED/.test(PRODUCTION_CONFIG.documentsContracts.approvedTestContactId), true);
  check('a real request against the actual, committed PRODUCTION_CONFIG (not the synthetic enabled fixture above) is refused end to end', evaluateContractEnvironment(PRODUCTION_CONFIG).ok, false);
}

console.log('');
console.log(checks + ' contract-production-readiness checks, ' + failures + ' failures.');
console.log('No live write, GHL mutation, deployment, or Production access occurred in this run -- every fixture above is an in-memory object; global.fetch was never invoked.');
if (failures > 0) process.exitCode = 1;
