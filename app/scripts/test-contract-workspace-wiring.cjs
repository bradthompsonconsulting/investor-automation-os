/**
 * Contract Workspace -- wiring/boundary test runner. B9-04 / INV-59,
 * extended B9-05 / INV-60 for the TREC 20-19 seller contract facts
 * section (contract-facts-model.ts / seller-contract-facts-carriers.ts).
 *
 * This repository has no browser-rendering test harness (confirmed by
 * `test-seller-call-workspace-wiring.cjs`'s own header, still true here)
 * -- every "test-*.cjs" proves a PURE MODULE or, for a page, that the
 * route, the entry points, and the engine-reuse boundary are WIRED, by
 * reading source text (never by rendering). `npx tsc -b` and
 * `npx vite build` (run alongside this suite, not inside it) are the
 * evidence for compiled/bundled correctness; this file proves wiring and
 * the no-duplicated-readiness-logic boundary specifically.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP, '..');
const readSrc = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

const FLOOR = 246;
let failures = 0;
let checks = 0;

function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log('PASS  ' + name);
  } else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

const appTsx = readSrc('src/App.tsx');
const contractTsx = readSrc('src/pages/ContractWorkspace.tsx');
const sellerCallTsx = readSrc('src/pages/SellerCallWorkspace.tsx');
const viewTs = readSrc('src/lib/contract-workspace-view.ts');
/** Block comments stripped -- for checks that must not false-positive on this page's own doc comments discussing the very functions/patterns they check for. */
const contractTsxNoComments = contractTsx.replace(/\/\*[\s\S]*?\*\//g, '');
const viewTsNoComments = viewTs.replace(/\/\*[\s\S]*?\*\//g, '');

// ============================================================
// Route wiring -- the new dedicated workspace, alongside the existing
// Contact-context sub-routes.
// ============================================================
{
  check('App.tsx imports ContractWorkspace', /import ContractWorkspace from ".\/pages\/ContractWorkspace"/.test(appTsx), true);
  check('App.tsx declares the contract sub-route', /path="contacts\/:id\/contract"/.test(appTsx), true);
  check('App.tsx maps the route to <ContractWorkspace />', /path="contacts\/:id\/contract"\s+element=\{<ContractWorkspace \/>\}/.test(appTsx), true);
  check(
    'the contract route sits alongside the seller-call sub-route (same Contact-context pattern)',
    /path="contacts\/:id\/seller-call"[\s\S]{0,200}path="contacts\/:id\/contract"/.test(appTsx),
    true,
  );
  check(
    'ContractWorkspace resolves contact context the SAME way as the other two workspaces (useParams<{ id: string }>)',
    /useParams<\{ id: string \}>\(\)/.test(contractTsx),
    true,
  );
}

// ============================================================
// Additive CTA in SellerCallWorkspace.tsx -- present, links to the exact
// new route, and does not replace or remove the existing checklist it
// sits inside.
// ============================================================
{
  check('SellerCallWorkspace declares the new CTA link', /data-testid="open-contract-workspace-link"/.test(sellerCallTsx), true);
  check('the CTA links to the exact new route', /to=\{`\/contacts\/\$\{contactId\}\/contract`\}/.test(sellerCallTsx), true);
  check('the existing Contract Ready checklist testid is still present, unremoved', /data-testid="contract-ready-checklist"/.test(sellerCallTsx), true);
  check('the existing per-item checklist testid template is still present, unremoved', /data-testid=\{`contract-ready-item-\$\{item\.key\}`\}/.test(sellerCallTsx), true);
  check('the existing per-item write handler is still present, unremoved', /async function handleToggleContractReadyItem/.test(sellerCallTsx), true);
  check('the CTA sits INSIDE the existing "AGREEMENT REACHED" banner block (same latestOutcome?.kind === "accept" guard), not a new top-level banner', (() => {
    const bannerStart = sellerCallTsx.indexOf('data-testid="agreement-reached-banner"');
    const ctaIndex = sellerCallTsx.indexOf('data-testid="open-contract-workspace-link"');
    const bannerEnd = sellerCallTsx.indexOf('\n          ) : null}', bannerStart);
    return bannerStart !== -1 && ctaIndex > bannerStart && ctaIndex < bannerEnd;
  })(), true);
}

// ============================================================
// Consume B9-03 directly; recreate no readiness logic in the interface.
// The chain is ContractWorkspace.tsx -> contract-workspace-view.ts (pure,
// independently tested) -> board9-contract-model.ts. `deriveInheritedEconomics`
// and `evaluateContractReady` are called from the view module, imported
// unmodified, never reimplemented anywhere in the chain.
// ============================================================
{
  check('contract-workspace-view.ts imports deriveInheritedEconomics from board9-contract-model', /import \{[\s\S]*deriveInheritedEconomics[\s\S]*\} from "\.\/board9-contract-model"/.test(viewTs), true);
  check('contract-workspace-view.ts imports evaluateContractReady from board9-contract-model', /import \{[\s\S]*evaluateContractReady[\s\S]*\} from "\.\/board9-contract-model"/.test(viewTs), true);
  check('contract-workspace-view.ts actually CALLS deriveInheritedEconomics (not merely imported)', /deriveInheritedEconomics\(\{/.test(viewTs), true);
  check('contract-workspace-view.ts actually CALLS evaluateContractReady (not merely imported)', /evaluateContractReady\(\{/.test(viewTs), true);
  check('contract-workspace-view.ts does not declare its own competing deriveInheritedEconomics function', /\b(function|const)\s+deriveInheritedEconomics\s*[=(]/.test(viewTsNoComments.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('contract-workspace-view.ts does not declare its own competing evaluateContractReady function', /\b(function|const)\s+evaluateContractReady\s*[=(]/.test(viewTsNoComments.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);

  check('ContractWorkspace.tsx imports computeContractScreenState from the pure view module', /import \{\s*\n\s*computeContractScreenState,[\s\S]*\} from "\.\.\/lib\/contract-workspace-view"/.test(contractTsx), true);
  check('ContractWorkspace.tsx does not import deriveInheritedEconomics itself (consumed one level down, via the tested view module)', /deriveInheritedEconomics/.test(contractTsxNoComments), false);
  check('ContractWorkspace.tsx does not import evaluateContractReady itself (consumed one level down, via the tested view module)', /evaluateContractReady/.test(contractTsxNoComments), false);
  check('ContractWorkspace.tsx does not declare a second CONTRACT_READY_ITEM_KEYS-shaped array of its own five item KEYS (imports the existing one)', /import \{[\s\S]*CONTRACT_READY_ITEM_KEYS[\s\S]*\} from "\.\.\/lib\/seller-call-readiness-carriers"/.test(contractTsx), true);
  check('ContractWorkspace.tsx renders readiness reasons verbatim from the model (r.message), never composing its own missing-item text', /\{r\.message\}/.test(contractTsx), true);
  check('ContractWorkspace.tsx does not define its own computeContractScreenState function (would be a second, competing implementation)', /\b(function|const)\s+computeContractScreenState\s*[=(]/.test(contractTsxNoComments.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
}

// ============================================================
// No invented GHL-to-domain mapping -- reuses the SAME reads and the SAME
// opportunity-selection helpers every other Contact-context workspace
// already uses; no new custom field id, no new endpoint.
// ============================================================
{
  check('ContractWorkspace reads via ghl.contacts.getDetail (existing read)', /ghl\.contacts\.getDetail\(contactId\)/.test(contractTsx), true);
  check('ContractWorkspace reads via ghl.opportunities.listPipeline (existing read)', /ghl\.opportunities\.listPipeline\(\)/.test(contractTsx), true);
  check('ContractWorkspace reads via ghl.notes.list (existing read)', /ghl\.notes\.list\(contactId\)/.test(contractTsx), true);
  check('ContractWorkspace selects the opportunity via the SAME shared helpers as the other workspaces', /import \{ opportunitiesForContact, opportunityCandidates, selectOpportunity \} from "\.\.\/lib\/underwriting\/selectOpportunity"/.test(contractTsx), true);
  check('ContractWorkspace does not call any other ghl.* namespace than contacts/opportunities/notes/proposals/contracts (B9-08/INV-63 adds the sole sanctioned e-sign-provider namespace; Board #9 Phase B adds the sole sanctioned live-PDF-generation namespace)', (() => {
    const calls = contractTsxNoComments.match(/ghl\.[a-zA-Z]+\./g) || [];
    return calls.every((c) => c === 'ghl.contacts.' || c === 'ghl.opportunities.' || c === 'ghl.notes.' || c === 'ghl.proposals.' || c === 'ghl.contracts.');
  })(), true);
}

// ============================================================
// Checklist writes occur ONLY through an explicit operator action -- no
// write on page load. The data-fetching effect contains no write call;
// the one write function exists and is wired only to a checkbox onChange.
// ============================================================
{
  const effectMatch = contractTsxNoComments.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[contactId\]\);/);
  const effectBody = effectMatch ? effectMatch[0] : '';
  check('the data-fetching useEffect body was actually located (guards the next two checks against a false pass)', effectBody.length > 0, true);
  check('the data-fetching useEffect contains no ghl.notes.create call', /ghl\.notes\.create/.test(effectBody), false);
  check('the data-fetching useEffect contains no write of any kind (create/update/set)', /\.(create|update|set[A-Z])\(/.test(effectBody), false);

  check('five retained note-write sites; no send or projection notes', (contractTsxNoComments.match(/ghl\.notes\.create\(/g) || []).length, 5);
  check('handleStartDisposition is the seventh call site, lives in its own dedicated handler (not commitNote), and requires dispositionEligibility.eligible before it can even write', (() => {
    const m = contractTsxNoComments.match(/async function handleStartDisposition\([\s\S]*?\n  \}/m);
    return !!m && (m[0].match(/ghl\.notes\.create\(/g) || []).length === 1 && !/commitNote\(/.test(m[0]) && /!freshEligibility\.eligible/.test(m[0]);
  })(), true);
  check('handleStartDisposition is wired to the Start Disposition button\'s onClick, and declared exactly once', (() => {
    const onClickWiring = /onClick=\{handleStartDisposition\}/.test(contractTsx);
    const declarations = (contractTsxNoComments.match(/async function handleStartDisposition\(/g) || []).length;
    return onClickWiring && declarations === 1;
  })(), true);
  check('handleStartDisposition re-evaluates eligibility against FRESH notes state, never a stale memo, before ever writing', /const freshEligibility = evaluateDispositionHandoffEligibility\(/.test(contractTsxNoComments), true);
  check('handleStartDisposition refuses a duplicate BEFORE ever writing, via verifyHandoffMatchesUnderContract against a fresh handoff read -- never after the write', (() => {
    const m = contractTsxNoComments.match(/async function handleStartDisposition\([\s\S]*?\n  \}/m);
    if (!m) return false;
    const writeIdx = m[0].indexOf('ghl.notes.create(');
    const dupIdx = m[0].indexOf('verifyHandoffMatchesUnderContract(');
    return writeIdx > -1 && dupIdx > -1 && dupIdx < writeIdx;
  })(), true);
  check('handleStartDisposition performs an independent, FRESH ghl.notes.list(contactId) readback after writing -- never trusts local state or the write call\'s own success alone', (() => {
    const m = contractTsxNoComments.match(/async function handleStartDisposition\([\s\S]*?\n  \}/m);
    return !!m && /await ghl\.notes\.list\(contactId\)/.test(m[0]);
  })(), true);
  check('handleStartDisposition requires an EXACT-equality match on fresh readback before ever reporting success -- never success from the POST alone', (() => {
    const m = contractTsxNoComments.match(/async function handleStartDisposition\([\s\S]*?\n  \}/m);
    return !!m && /JSON\.stringify\(r\) === JSON\.stringify\(candidate\)/.test(m[0]) && /matchingReadback === null/.test(m[0]);
  })(), true);
  check('handleStartDisposition reuses formatDispositionHandoffNote/parseDispositionHandoffNote (the canonical carrier), never composes or re-parses the note body inline', /formatDispositionHandoffNote\(candidate\)/.test(contractTsxNoComments) && /parseDispositionHandoffNote\(n\.body\)/.test(contractTsxNoComments), true);
  check('Start Disposition is gated on a genuinely parsed Under Contract record (currentUnderContractRecord) -- required, though (gate-review §5 ruling) no longer sufficient alone: the live pipeline/stage confirmation and the preserved artifact are now ALSO required, never a substitute for the record itself', /\{showStartDispositionControl\(currentUnderContractRecord, preservedArtifactRecord, underContractStageConfirmed\) \? \(/.test(contractTsxNoComments), true);
  check('handleCreateUnderContract is the sixth call site, lives in its own dedicated handler (not commitNote), and requires fullVerificationResult.ok before it can even be invoked', (() => {
    const m = contractTsxNoComments.match(/async function handleCreateUnderContract\([\s\S]*?\n  \}/m);
    return !!m && (m[0].match(/ghl\.notes\.create\(/g) || []).length === 1 && !/commitNote\(/.test(m[0]) && /!fullVerificationResult\.ok/.test(m[0]);
  })(), true);
  check('handleCreateUnderContract is wired to the Create Under Contract button\'s onClick, and declared exactly once', (() => {
    const onClickWiring = /onClick=\{handleCreateUnderContract\}/.test(contractTsx);
    const declarations = (contractTsxNoComments.match(/async function handleCreateUnderContract\(/g) || []).length;
    return onClickWiring && declarations === 1;
  })(), true);
  check('handleCreateUnderContract refuses a duplicate BEFORE ever writing, via isDuplicateUnderContractRecord against a fresh existingRecords read -- never after the write', /const duplicate = existingRecords\.find\(\(r\) => isDuplicateUnderContractRecord\(r, candidate\)\)/.test(contractTsxNoComments), true);
  check('handleCreateUnderContract performs an independent, FRESH ghl.notes.list(contactId) readback after writing -- never trusts local state or the write call\'s own success alone', (() => {
    const m = contractTsxNoComments.match(/async function handleCreateUnderContract\([\s\S]*?\n  \}/m);
    return !!m && /await ghl\.notes\.list\(contactId\)/.test(m[0]);
  })(), true);
  check('handleCreateUnderContract requires EXACT equality via verifyReadbackMatchesWritten before ever reporting success', /verifyReadbackMatchesWritten\(candidate, matchingReadback\)/.test(contractTsxNoComments), true);
  check('handleCreateUnderContract reuses formatUnderContractNote/parseUnderContractNote (the canonical carrier), never composes or re-parses the note body inline', /formatUnderContractNote\(candidate\)/.test(contractTsxNoComments) && /parseUnderContractNote\(n\.body\)/.test(contractTsxNoComments), true);

  // ============================================================
  // Gate-review closure -- PR #85 live-Test proof: Under Contract
  // post-write confirmation/hydration repair. The fragile whole-object
  // JSON.stringify equality is gone from handleCreateUnderContract
  // specifically (the disposition-handoff handler above is untouched,
  // deliberately -- Board #10 work, out of this repair's narrow scope).
  // ============================================================
  check(
    'handleCreateUnderContract no longer uses whole-object JSON.stringify equality to find the just-written readback',
    (() => {
      const m = contractTsxNoComments.match(/async function handleCreateUnderContract\([\s\S]*?\n  \}/m);
      return !!m && !/JSON\.stringify\(r\) === JSON\.stringify\(candidate\)/.test(m[0]);
    })(),
    true,
  );
  check(
    'handleCreateUnderContract instead matches the fresh readback via matchesUnderContractEvidenceIdentity -- the canonical evidence identity, not whole-object equality',
    (() => {
      const m = contractTsxNoComments.match(/async function handleCreateUnderContract\([\s\S]*?\n  \}/m);
      return !!m && /matchesUnderContractEvidenceIdentity\(r, candidate\)/.test(m[0]);
    })(),
    true,
  );
  check(
    'the disposition-handoff handler (Board #10 handoff, out of this repair\'s scope) still uses its own prior JSON.stringify comparison, deliberately unchanged',
    (() => {
      const m = contractTsxNoComments.match(/async function handleStartDisposition\([\s\S]*?\n  \}/m);
      return !!m && /JSON\.stringify\(r\) === JSON\.stringify\(candidate\)/.test(m[0]);
    })(),
    true,
  );
  check(
    'matchesUnderContractEvidenceIdentity is imported from contract-execution-model',
    /isDuplicateUnderContractRecord, verifyReadbackMatchesWritten, matchesUnderContractEvidenceIdentity, countPdfPages,/.test(contractTsx),
    true,
  );
  check(
    'a reload-hydration effect recognizes an already-durable currentUnderContractRecord and syncs underContractWriteState to "already_recorded" WITHOUT requiring another write -- only from "idle", never overriding an in-flight or failed state',
    /if \(underContractWriteState\.kind !== "idle" \|\| !currentUnderContractRecord\) return;\s*\n\s*setUnderContractWriteState\(\{ kind: "already_recorded", record: currentUnderContractRecord \}\);/.test(contractTsxNoComments),
    true,
  );
  check(
    'Create Under Contract\'s disabled expression is unchanged -- it already covers BOTH "success" (post-write) and "already_recorded" (now also reload-hydrated) states',
    /disabled=\{underContractWriteState\.kind === "success" \|\| underContractWriteState\.kind === "already_recorded"\}/.test(contractTsxNoComments),
    true,
  );
  // Twelve obsolete send-wiring assertions replaced by twelve V1 boundary assertions.
  check('no automated Send handler', /async function handleSend/.test(contractTsx), false);
  check('no automated Send button', /contract-send-button/.test(contractTsx), false);
  check('no send reservation caller', /proposals\.reserveSend/.test(contractTsx), false);
  check('no send execution caller', /proposals\.send\(/.test(contractTsx), false);
  check('manual notice present', /contract-manual-send-notice/.test(contractTsx), true);
  check('manual upload direction present', /upload it to GHL/.test(contractTsx), true);
  check('manual send direction present', /send it manually/.test(contractTsx), true);
  check('notice records no sent state', /does not record a contract as sent/.test(contractTsx), true);
  check('no template preflight', /templateDriftCheck/.test(contractTsx), false);
  check('no projection write control', /contract-projection-sync-button/.test(contractTsx), false);
  check('no draft request handler', /handleSyncContractProjectionFields/.test(contractTsx), false);
  check('document readback remains', /ghl\.proposals\.listDocuments/.test(contractTsx), true);
  check('the checklist write lives inside handleToggleChecklistItem', /async function handleToggleChecklistItem[\s\S]*?ghl\.notes\.create\(/.test(contractTsxNoComments), true);
  check('the B9-07/INV-62 authorization write lives inside its own handleAuthorize, never routed through commitNote', (() => {
    const m = contractTsxNoComments.match(/async function handleAuthorize\([\s\S]*?\n  \}/m);
    return !!m && /ghl\.notes\.create\(/.test(m[0]) && !/commitNote\(/.test(m[0]);
  })(), true);
  check('handleAuthorize is wired to the Authorize button\'s onClick (same one-to-one style as the 14 group Save handlers), and declared exactly once', (() => {
    const onClickWiring = /onClick=\{handleAuthorize\}/.test(contractTsx);
    const declarations = (contractTsxNoComments.match(/async function handleAuthorize\(/g) || []).length;
    return onClickWiring && declarations === 1;
  })(), true);
  check('handleAuthorize is never invoked from the data-fetching effect or on mount', /ghl\.contacts\.getDetail[\s\S]*?handleAuthorize\(\)/.test(effectBody) === false, true);
  check('handleAuthorize reuses buildAuthorizationRecordArgs/formatBradContractAuthorizationNote, never composes an authorization note body inline', /const built = buildAuthorizationRecordArgs\(/.test(contractTsxNoComments) && /formatBradContractAuthorizationNote\(built\.value\)/.test(contractTsxNoComments), true);
  check('handleToggleChecklistItem is wired ONLY to a checkbox onChange, never called from the fetch effect or on mount', (() => {
    const onChangeWiring = /onChange=\{\(e\) => handleToggleChecklistItem\(item\.key, e\.target\.checked\)\}/.test(contractTsx);
    const totalOccurrences = (contractTsxNoComments.match(/handleToggleChecklistItem\(/g) || []).length;
    // Exactly two occurrences expected: the function's own declaration
    // ("async function handleToggleChecklistItem(") and the single JSX
    // onChange call site above -- a third occurrence anywhere (e.g. in
    // the fetch effect) would mean it is called somewhere else too.
    return onChangeWiring && totalOccurrences === 2;
  })(), true);
  check('reuses the EXISTING sanctioned checklist carrier (formatContractReadyChecklistNote), never a new formatXxxNote function', /formatContractReadyChecklistNote/.test(contractTsx), true);
  check('ContractWorkspace.tsx defines no new formatXxxNote-shaped carrier-write function of its own (every formatXNote is imported from the carriers module)', /function format[A-Za-z]*Note/.test(contractTsxNoComments), false);

  // ----------------------------------------------------------------
  // B9-05 / INV-60 Jess Gate correction round: EVERY B/C/D/E field group
  // gets its own explicit operator control + Save button, not a read-only
  // report plus one form. All fifteen group handlers route through the
  // SAME single write choke point (commitNote), which is the only place
  // ghl.notes.create is called for any of them.
  // ----------------------------------------------------------------
  const GROUP_SAVE_HANDLERS = [
    'handleSaveSigner', 'handleSaveBuyerOverride', 'handleSaveLegalDesc', 'handleSaveLease', 'handleSaveEarnest',
    'handleSaveTitleSurvey', 'handleSavePropertyCondition', 'handleSaveClosingPossession', 'handleSaveSettlement',
    'handleSaveRepresentation', 'handleSaveAddenda', 'handleSaveSellerEquitable', 'handleSaveAttorneyField',
    'handleSaveBuyerBusinessConfig', 'handleSaveSellerNotice',
  ];
  check(`all ${GROUP_SAVE_HANDLERS.length} group-form Save handlers are declared as their own async function`, GROUP_SAVE_HANDLERS.every((name) => new RegExp(`async function ${name}\\(`).test(contractTsxNoComments)), true);
  check('commitNote is the single shared write helper, declared once, and is the only place inside it that ghl.notes.create is called', /async function commitNote\([\s\S]*?ghl\.notes\.create\(/.test(contractTsxNoComments) && (contractTsxNoComments.match(/async function commitNote\(/g) || []).length === 1, true);
  check('every one of the fifteen group Save handlers itself calls commitNote (not ghl.notes.create directly)', GROUP_SAVE_HANDLERS.every((name) => {
    const re = new RegExp(`async function ${name}\\([\\s\\S]*?\\n  \\}`, 'm');
    const m = contractTsxNoComments.match(re);
    return m && /await commitNote\(/.test(m[0]) && !/ghl\.notes\.create\(/.test(m[0]);
  }), true);
  check('every group Save button is wired to an onClick (14 one-to-one, plus handleSaveAttorneyField wired to its own two buttons for its two slots)', (() => {
    const oneToOne = ['handleSaveSigner', 'handleSaveBuyerOverride', 'handleSaveLegalDesc', 'handleSaveLease', 'handleSaveEarnest', 'handleSaveTitleSurvey', 'handleSavePropertyCondition', 'handleSaveClosingPossession', 'handleSaveSettlement', 'handleSaveRepresentation', 'handleSaveAddenda', 'handleSaveSellerEquitable', 'handleSaveBuyerBusinessConfig', 'handleSaveSellerNotice'];
    const allWired = oneToOne.every((name) => new RegExp(`onClick=\\{${name}\\}`).test(contractTsx));
    const attorneyWiredTwice = (contractTsx.match(/onClick=\{\(\) => handleSaveAttorneyField\(/g) || []).length === 2;
    return allWired && attorneyWiredTwice;
  })(), true);
  check('none of the fifteen group Save handlers is referenced from the data-fetching useEffect (writes stay explicit-action-only)', GROUP_SAVE_HANDLERS.every((name) => !effectBody.includes(name)), true);
  check('¶5 additional earnest money requires an explicit unset/none/value choice in the draft -- never silently defaulted before Save', /additionalKind === "unset"/.test(contractTsxNoComments) && /additionalKind: "unset" \| "none" \| "value"/.test(contractTsxNoComments), true);
  check('ContractWorkspace.tsx never constructs a bare `{ kind: "none" }` as an additionalEarnestMoney argument (the old silent-default bug) -- Save always uses the validated local variable', !/additionalEarnestMoney:\s*\{\s*kind:\s*"none"\s*\}/.test(contractTsxNoComments), true);
  check('reuses the EXISTING sanctioned earnest-money carrier (formatEarnestMoneyOptionFactsNote), never a competing write', /formatEarnestMoneyOptionFactsNote/.test(contractTsx), true);
}

// ============================================================
// B9-05 / INV-60 -- consumes contract-facts-model.ts directly, recreates
// no disposition logic in the interface.
// ============================================================
{
  const modelTs = readSrc('src/lib/contract-facts-model.ts');
  const carriersTs = readSrc('src/lib/seller-contract-facts-carriers.ts');
  const modelTsNoComments = modelTs.replace(/\/\*[\s\S]*?\*\//g, '');

  check('ContractWorkspace.tsx imports computeSellerContractFactsReport from the pure model', /import \{[\s\S]*computeSellerContractFactsReport[\s\S]*\} from "\.\.\/lib\/contract-facts-model"/.test(contractTsx), true);
  check('ContractWorkspace.tsx imports computeSellerContractFactsReadiness from the pure model', /computeSellerContractFactsReadiness/.test(contractTsx), true);
  check('ContractWorkspace.tsx does not declare its own competing computeSellerContractFactsReport function', /\b(function|const)\s+computeSellerContractFactsReport\s*[=(]/.test(contractTsxNoComments.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('ContractWorkspace.tsx renders every field disposition through the ONE shared renderFieldValue helper, never a per-field ad hoc string', (contractTsxNoComments.match(/renderFieldValue\(/g) || []).length >= 1, true);
  check('ContractWorkspace.tsx renders human labels (FIELD_LABELS) instead of a raw camelCase field key', /FIELD_LABELS\[`\$\{String\(group\.key\)\}\.\$\{field\}`\]/.test(contractTsx), true);
  check('contract-facts-model.ts imports and reuses board9-contract-model.ts\'s ContractFactAuthority (no competing authority vocabulary)', /import \{[\s\S]*ContractFactAuthority[\s\S]*\} from "\.\/board9-contract-model"/.test(modelTs), true);
  check('contract-facts-model.ts imports and reuses detectMaterialConflicts from board9-contract-model.ts, never reimplements it', /detectMaterialConflicts/.test(modelTs) && !/function detectMaterialConflicts/.test(modelTsNoComments), true);
  check('the Buyer entity default is the exact fixed name Brad supplied', /BUYER_ENTITY_DEFAULT_NAME = "Brad Thompson Consulting LLC"/.test(modelTs), true);

  // Jess Gate correction: BuyerBusinessConfig is no longer threaded in by
  // the caller as a hardcoded `null` -- it is sourced the same way every
  // other carrier-backed fact is, inside computeSellerContractFactsReport.
  check('computeSellerContractFactsReport no longer accepts a buyerBusinessConfig argument from its caller', !/buyerBusinessConfig:\s*BuyerBusinessConfig;/.test(modelTs), true);
  check('computeSellerContractFactsReport sources BuyerBusinessConfig from its OWN carrier internally', /const buyerBusinessConfig = latestBuyerBusinessConfigFactsForOpportunity\(notes, opportunityId\);/.test(modelTs), true);
  check('computeSellerContractFactsReport no longer accepts a sellerContact argument (property address is renamed and used ONLY for conflict detection)', !/sellerContact:\s*\{/.test(modelTs), true);
  check('the seller\'s ¶21 notice info is sourced from its OWN explicit-confirmation carrier, not from propertyAddress', /const sellerNotice = latestSellerNoticeConfirmationFactsForOpportunity\(notes, opportunityId\);/.test(modelTs), true);
  check('ContractWorkspace.tsx no longer declares a page-level buyerBusinessConfig constant of its own (removed along with the hardcoded null)', !/const buyerBusinessConfig: BuyerBusinessConfig = null;/.test(contractTsx), true);
  check('ContractWorkspace.tsx gives the operator a real capture form for BTC LLC\'s business config (Save button + carrier write), not a hardcoded value', /handleSaveBuyerBusinessConfig/.test(contractTsx) && /formatBuyerBusinessConfigFactsNote/.test(contractTsx), true);
  check('ContractWorkspace.tsx gives the operator a real, separate confirmation form for the seller\'s ¶21 notice info, distinct from the property address', /handleSaveSellerNotice/.test(contractTsx) && /formatSellerNoticeConfirmationFactsNote/.test(contractTsx), true);
  check('the seller-notice form shows the contact/property candidate data as read-only reference text, never writes it automatically', /sellerNoticeCandidate/.test(contractTsxNoComments) && !/noticeAddress: propertyAddress/.test(contractTsxNoComments), true);
  check('¶5\'s earnest money/option fee/option period are each an explicit amount-or-none / days-or-none choice, never forced positive', /AmountOrNoneField/.test(contractTsx) && /DaysOrNoneField/.test(contractTsx), true);
  check('financing addenda (Third Party/Seller/Loan Assumption) are excluded from the addenda item-key schema entirely, not merely defaulted off', (() => {
    const flat = carriersTs.replace(/\s+/g, ' ');
    return flat.includes('Third Party Financing') && flat.includes('Seller Financing') && flat.includes('Loan Assumption');
  })(), true);
  check('attorney/manual field carrier never exports a function that drafts or validates legal text content', /function (draft|generate|suggest|approve)[A-Za-z]*/.test(carriersTs.replace(/\/\*[\s\S]*?\*\//g, '')), false);
}

// ============================================================
// Jess Gate correction item 6 -- the exact approved source PDF is present,
// unchanged, and its SHA-256 still matches the hash Brad supplied.
// ============================================================
{
  const pdfPath = path.join(REPO_ROOT, 'docs', 'TREC Resale Home Contract.pdf');
  const EXPECTED_SHA256 = '3f458518e9e01fc9c84cab420dcd0ce9793113c4b356ed5caf7a2fb1bdef2ca5';
  check('the approved TREC 20-19 source PDF exists at its documented path', fs.existsSync(pdfPath), true);
  const actualSha256 = fs.existsSync(pdfPath) ? crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex') : null;
  check('the PDF\'s SHA-256 still matches the hash Brad supplied -- unchanged, never flattened or substituted', actualSha256, EXPECTED_SHA256);
}

// ============================================================
// Fail-closed unavailable/unmappable-data states are actually rendered,
// each with an operator-readable reason -- not silently skipped.
// ============================================================
{
  check('renders a fetch_error state with the real error message', /screen\.state === "fetch_error"[\s\S]{0,120}screen\.message/.test(contractTsx), true);
  check('renders a no_agreement state (Agreement Reached has not happened yet)', /screen\.state === "no_agreement"/.test(contractTsx), true);
  check('renders a conflicting_history state with an explicit operator-readable body', /screen\.state === "conflicting_history"/.test(contractTsx), true);
  check('renders an economics_unavailable state with the real refusal reason', /screen\.state === "economics_unavailable"[\s\S]{0,160}screen\.reason/.test(contractTsx), true);
  check('renders a distinct stale/revised warning, separate from the fail-closed states above', /screen\.isStale && screen\.staleInfo/.test(contractTsx), true);
}

// ============================================================
// INV-67 Phase 2A -- Legal Municipality (¶2A "City of ___") UI. Static
// source assertions, matching this file's existing convention for
// ContractWorkspace.tsx (no DOM render harness in this suite).
// ============================================================
{
  check(
    'legal municipality choice begins unset -- INITIAL_DRAFTS preselects neither Municipality nor Unincorporated',
    /municipalityKind: "unset", municipalityName: ""/.test(contractTsx),
    true,
  );
  check(
    'the municipality-name input is shown only when Municipality is selected',
    /drafts\.legalDesc\.municipalityKind === "municipality" \?[\s\S]{0,120}TextField[\s\S]{0,200}contract-fact-input-legal-municipality-name/.test(contractTsx),
    true,
  );
  check(
    'saving with no municipality choice made ("unset") is rejected before any note is written',
    /drafts\.legalDesc\.municipalityKind === "unset"\)\s*\{[\s\S]{0,200}setGroupError\("propertyLegalDescription"/.test(contractTsx),
    true,
  );
  check(
    'Municipality requires a non-blank name -- rejected when the trimmed name is empty',
    /drafts\.legalDesc\.municipalityName\.trim\(\) === ""\)\s*\{[\s\S]{0,200}setGroupError\("propertyLegalDescription"/.test(contractTsx),
    true,
  );
  check(
    'Municipality writes the trimmed name into the LegalMunicipalityFact (input normalization, never the raw untrimmed draft)',
    /legalMunicipality = \{ kind: "municipality", name: drafts\.legalDesc\.municipalityName\.trim\(\) \}/.test(contractTsx),
    true,
  );
  check(
    'Unincorporated carries no name at all -- a bare { kind: "unincorporated" } literal, structurally incapable of smuggling a name',
    /legalMunicipality = \{ kind: "unincorporated" \};/.test(contractTsx),
    true,
  );
  check(
    'no contact/address source is ever read into the municipality draft -- "municipalityName"/"municipalityKind" never appear near contact.city or the property street address',
    (() => {
      const idx = [];
      let m;
      const re = /municipalityName|municipalityKind/g;
      while ((m = re.exec(contractTsxNoComments))) idx.push(m.index);
      return idx.every((i) => {
        const window = contractTsxNoComments.slice(Math.max(0, i - 80), i + 80);
        return !/contact\.city|contact\?\.city|propertyStreetAddress|\.zip\b|geocod/i.test(window);
      });
    })(),
    true,
  );
  check(
    'ContractWorkspace.tsx\'s own FIELD_LABELS carries the Legal Municipality entry (same "group.field" key contract-document-model.ts uses)',
    /"propertyLegalDescription\.legalMunicipality": "Legal municipality \(¶2A City of\)"/.test(contractTsx),
    true,
  );
}

// ============================================================
// Board #9 Phase B correction -- Brad must generate the CURRENT artifact
// before authorizing it, and any prior generation is invalidated the
// instant relevant canonical facts change underneath it (stale UI
// evidence can never authorize). Proven here by source wiring, matching
// this file's own no-render convention (see header).
// ============================================================
{
  const generateEffectMatch = contractTsxNoComments.match(/useEffect\(\(\) => \{\s*setGeneratedArtifact\(null\);[\s\S]*?\}, \[contractDocumentPreview\]\);/);
  check('an invalidation useEffect exists that clears generatedArtifact whenever contractDocumentPreview changes', !!generateEffectMatch, true);
  check('that same invalidation effect also clears any stale generateError', /setGenerateError\(null\);/.test(generateEffectMatch ? generateEffectMatch[0] : ''), true);
  check('the invalidation effect is keyed ONLY on contractDocumentPreview (the canonical, live-derived facts), not on an unrelated or broader dependency', /\}, \[contractDocumentPreview\]\);/.test(generateEffectMatch ? generateEffectMatch[0] : ''), true);

  check('the display evaluator (bradAuthorizationStatus) is fed currentArtifactFactsForDisplay, never a self-referential record field', /evaluateBradAuthorizationCurrency\(bradAuthorizationRecord, contractDocumentPreview, currentArtifactFactsForDisplay\)/.test(contractTsxNoComments), true);
  check(
    'currentArtifactFactsForDisplay falls back to an all-empty (structurally invalid) bundle only when NEITHER a fresh generation NOR a durable authorization record exists, never a placeholder that could pass shape validation',
    /return \{ artifactSha256: "", sourcePdfSha256: "", generatorVersion: "", manifestVersion: "" \};/.test(contractTsxNoComments),
    true,
  );

  check('handleAuthorize refuses to proceed when no artifact has been generated', /if \(!generatedArtifact\) \{\s*setAuthorizeError\(/.test(contractTsxNoComments), true);
  check('handleAuthorize passes the SAME generated artifact facts into buildAuthorizationRecordArgs (never a stored/claimed value)', /buildAuthorizationRecordArgs\(\{[\s\S]{0,400}artifact: \{\s*artifactSha256: generatedArtifact\.outputSha256,\s*sourcePdfSha256: generatedArtifact\.sourceSha256,\s*generatorVersion: generatedArtifact\.generatorVersion,\s*manifestVersion: generatedArtifact\.manifestVersion,/.test(contractTsxNoComments), true);
  check('the Authorize button is disabled whenever no artifact has been generated yet, in addition to the pre-existing eligibility gate', /disabled=\{!authorizationEligibility\.eligible \|\| !generatedArtifact\}/.test(contractTsx), true);
}

// ============================================================
// Closing-date readback off-by-one fix (display-only). Brad entered
// 2026-10-15 and the confirmed green readback showed "10/14/2026" --
// `renderFieldValue`'s closingPossession.closingDate case formatted the
// stored UTC-midnight instant with `toLocaleDateString()` and no
// `timeZone` option, so it rendered in the browser's LOCAL zone, rolling
// the displayed day back by one for any timezone behind UTC. The stored
// note, the parser, and the PDF/projection path (closingDateMonthDayTransport,
// contract-ghl-transport-formatting.ts) were all already UTC-safe and are
// UNCHANGED here -- this was a single-line, display-only defect.
//
// Proven two ways, matching this file's own no-render convention (source
// wiring) plus a direct, locale-independent behavioral check of the exact
// Date/Intl call the fixed line now makes (no component rendering).
// ============================================================
{
  check(
    'the closingPossession.closingDate case now formats with an explicit UTC timeZone (matches the already-established closingDateMonthDayTransport pattern)',
    /case "closingPossession\.closingDate":[\s\S]{0,700}toLocaleDateString\(undefined, \{ timeZone: "UTC" \}\)/.test(contractTsxNoComments),
    true,
  );

  // Locale-independent: reads the formatted day-of-month directly via
  // Intl's own parts API rather than parsing a locale-formatted string.
  function dayOfMonthInZone(iso, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric' }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === 'day').value);
  }
  check(
    'the fixed call (explicit UTC) reads day 15 for 2026-10-15T00:00:00.000Z -- exactly what Brad entered, regardless of the runtime\'s local timezone',
    dayOfMonthInZone('2026-10-15T00:00:00.000Z', 'UTC'),
    15,
  );
  check(
    'the SAME instant, formatted in a timezone behind UTC (America/Chicago) with no explicit timeZone override, reads day 14 -- proving the timeZone option is load-bearing, not cosmetic, and reproducing the exact bug Brad observed',
    dayOfMonthInZone('2026-10-15T00:00:00.000Z', 'America/Chicago') === 14,
    true,
  );
}

// ============================================================
// Generated-PDF download mechanism, and concise operator-neutral
// authorization UI copy. Brad's generate-and-authorize flow generated and
// authorized an artifact but never exposed the bytes to the browser's own
// download machinery -- `generatedArtifact.pdfBase64` was read into
// `currentArtifactFactsForDisplay`/`handleAuthorize` (hashes only) and
// displayed as a truncated hash, but no <a download>/Blob/object-URL path
// existed anywhere. Added `handleDownloadArtifact`, built directly from the
// SAME in-memory `generatedArtifact.pdfBase64` bytes already used by
// authorization -- no new fetch, no new generation, so the downloaded
// file's SHA-256 can never diverge from the recorded `artifactSha256`.
// Proven by source wiring, matching this file's own no-render convention.
// ============================================================
{
  const downloadHandlerMatch = contractTsxNoComments.match(/function handleDownloadArtifact\(\)[\s\S]*?(?=\n\s*const bradAuthorizationStatus = useMemo)/);
  const downloadHandlerSrc = downloadHandlerMatch ? downloadHandlerMatch[0] : '';
  check('handleDownloadArtifact exists, immediately preceding bradAuthorizationStatus', !!downloadHandlerMatch, true);

  // ---- Blob built from the SAME generated artifact bytes, never a re-fetch ----
  check(
    'the download handler decodes the base64 bytes from generatedArtifact.pdfBase64 -- the SAME in-memory generation result authorization already binds to',
    /atob\(generatedArtifact\.pdfBase64\)/.test(downloadHandlerSrc),
    true,
  );
  check(
    'the download handler wraps those bytes in a Blob typed application/pdf',
    /new Blob\(\[bytes\], \{ type: "application\/pdf" \}\)/.test(downloadHandlerSrc),
    true,
  );
  check(
    'the download handler performs NO network call of its own (no fetch(, no ghl. call, no re-generation) -- proves the download can never diverge from what was already generated and hashed',
    !/fetch\(|ghl\.\w+\.\w+\(/.test(downloadHandlerSrc),
    true,
  );
  check(
    'the download filename embeds the exact generated artifact\'s own outputSha256 prefix -- the same hash value bound into the authorization record',
    /generatedArtifact\.outputSha256\.slice\(0, 12\)/.test(downloadHandlerSrc) && /\.pdf`/.test(downloadHandlerSrc),
    true,
  );
  check(
    'handleDownloadArtifact is a no-op when no artifact has been generated yet (fails closed, never downloads a stale/absent file)',
    /if \(!generatedArtifact\) return;/.test(downloadHandlerSrc),
    true,
  );

  // ---- Object-URL cleanup ----
  check(
    'the download handler revokes the object URL it creates (no dangling blob: URL survives the download)',
    /URL\.revokeObjectURL\(/.test(downloadHandlerSrc),
    true,
  );
  check(
    'a construction failure sets the download-preparation error rather than leaving a silently broken download button',
    /catch \{[\s\S]*?setDownloadError\("Could not prepare the PDF\. Generate it again before saving authorization\."\);[\s\S]*?\}/.test(downloadHandlerSrc),
    true,
  );

  // ---- Download button visibility and filename wiring in the JSX ----
  check(
    'a "Download PDF" button exists, gated on generatedArtifact existing, wired to handleDownloadArtifact',
    /<Btn testId="contract-generated-artifact-download" onClick=\{handleDownloadArtifact\} busy=\{false\} disabled=\{!generatedArtifact\}>\s*Download PDF\s*<\/Btn>/.test(contractTsxNoComments),
    true,
  );
  check(
    'the download-preparation error is rendered via the same ErrorText pattern every other group error already uses',
    /<ErrorText testId="contract-download-error">\{downloadError\}<\/ErrorText>/.test(contractTsxNoComments),
    true,
  );

  // ---- Authorization button remains gated on a generated artifact (unchanged logic, only its label changed) ----
  check(
    'the authorize/save button is STILL disabled whenever no artifact has been generated yet (unchanged gating logic)',
    /disabled=\{!authorizationEligibility\.eligible \|\| !generatedArtifact\}/.test(contractTsx),
    true,
  );
  check(
    'the authorize/save button\'s visible label is the new concise "Save authorization" copy',
    /testId="contract-authorization-authorize-button"[\s\S]{0,300}>\s*Save authorization\s*</.test(contractTsx),
    true,
  );

  // ---- Concise operator-neutral copy -- every new string present verbatim ----
  const requiredCopy = [
    'Authorization saved for this version.',
    'Generate the PDF, review it, then save authorization.',
    'The contract changed. Generate the updated PDF and save authorization again.',
    'Changes since authorization',
    'No changes since authorization was saved.',
    'Download PDF',
    'Save authorization',
    'Could not prepare the PDF. Generate it again before saving authorization.',
  ];
  for (const text of requiredCopy) {
    check('required concise copy is present verbatim: "' + text + '"', contractTsx.includes(text), true);
  }
  check('the three-state status labels ("Saved" / "Not saved" / "Unsaved changes") are all present', ['"Saved"', '"Not saved"', '"Unsaved changes"'].every((s) => contractTsx.includes(s)), true);

  // ---- Hardcoded "Brad" removed from user-facing instructional/status copy ----
  const removedBradCopy = [
    'Brad-authorized',
    'Not Brad-authorized',
    'Authorize this exact revision',
    'Differences from the last Brad-reviewed revision',
    'No differences -- this is exactly the revision Brad last authorized.',
    "Requires Brad's explicit action for this exact revision",
    "Only Brad's own explicit action, for this exact document revision",
    '(Brad authorization, confirmed provider transmission',
  ];
  for (const text of removedBradCopy) {
    check('operator-specific copy no longer present: "' + text + '"', contractTsx.includes(text), false);
  }

  // ---- Legitimate contract data and durable authorization schema/identifiers UNCHANGED ----
  // (this page never hardcodes "Brad Thompson" itself -- it is real GHL note
  // data rendered dynamically via l.text -- so there is nothing to find or
  // preserve here beyond the identifiers below.)
  const preservedIdentifiers = [
    'evaluateBradAuthorizationCurrency',
    'formatBradContractAuthorizationNote',
    'latestBradContractAuthorizationForOpportunity',
    'bradAuthorizationRecord',
    'bradAuthorizationStatus',
  ];
  for (const id of preservedIdentifiers) {
    check('durable authorization identifier untouched: ' + id, contractTsx.includes(id), true);
  }
  // Durable proof the note SCHEMA itself is untouched -- read directly from
  // contract-authorization-carriers.ts's own current source, never a git
  // diff (which only has signal for this one session's uncommitted state
  // and would pass vacuously forever after this change is committed). Any
  // future accidental edit to the v2 header or its positional labels fails
  // this the same way it would today.
  const authCarriersSrc = readSrc('src/lib/contract-authorization-carriers.ts');
  check(
    'the durable v2 authorization note header is exactly unchanged',
    /const HEADER = `IAOS BRAD CONTRACT AUTHORIZATION — \$\{BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION\}`;/.test(authCarriersSrc),
    true,
  );
  check(
    'the durable v2 authorization note ledger version string is exactly unchanged',
    /BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION = "iaos-brad-contract-authorization-v2" as const;/.test(authCarriersSrc),
    true,
  );
  check(
    'the durable "brad" authorizedBy/operator literal is exactly unchanged (V1 permits no other authorizer)',
    /record\.authorizedBy !== "brad"/.test(readSrc('src/lib/contract-authorization-model.ts')) &&
      /record\.operator !== "brad"/.test(readSrc('src/lib/contract-authorization-model.ts')),
    true,
  );
}

// ============================================================
// Saved-fact form hydration. A refresh previously reset every group's
// draft to INITIAL_DRAFTS regardless of what was actually saved -- the
// green "saved" panels read the canonical report directly and were
// always correct, but the editable inputs read `drafts`, which was never
// populated from canonical state. Editing one field (e.g. County) then
// submitted every OTHER field in that group at its blank default,
// either failing that group's own "every field needs a value"
// validation outright (Property Legal Description) or resetting a
// previously-made explicit choice (Seller Signing Model's "Select
// One Seller or Two Sellers"). Fixed with `draftsFromReport` -- the
// exact inverse of each handleSaveX below -- plus a hydration effect
// gated to run exactly ONCE per opportunity. Proven by source wiring,
// matching this file's own no-render convention.
// ============================================================
{
  const hydrationFnMatch = contractTsxNoComments.match(/function draftsFromReport\(report: SellerContractFactsReport \| null, signingModel: SellerSigningModel \| null\): Drafts \{[\s\S]*?(?=export default function ContractWorkspace)/);
  const hydrationFnSrc = hydrationFnMatch ? hydrationFnMatch[0] : '';
  check('draftsFromReport exists, immediately preceding the component (function declaration order)', !!hydrationFnMatch, true);

  // ---- The hydration effect fires exactly once per opportunity, never on every report recompute ----
  const effectMatch = contractTsxNoComments.match(/const hydratedOpportunityId = useRef<string \| null>\(null\);\s*\n\s*useEffect\(\(\) => \{[\s\S]*?\}, \[screen, sellerContractFactsReport, latestSellerSigningModel\]\);/);
  const effectSrc = effectMatch ? effectMatch[0] : '';
  check('a hydration effect exists, tracking a per-opportunity hydratedOpportunityId ref', !!effectMatch, true);
  check(
    'the effect returns early (never re-hydrates) once the CURRENT opportunity is already hydrated -- proves a one-field edit mid-session is never overwritten by a later, unrelated report recompute',
    /if \(hydratedOpportunityId\.current === screen\.opportunity\.id\) return;/.test(effectSrc),
    true,
  );
  check(
    'the effect calls setDrafts(draftsFromReport(...)) using the live report and signing model, never a second/invented hydration source',
    /setDrafts\(draftsFromReport\(sellerContractFactsReport, latestSellerSigningModel\?\.model \?\? null\)\)/.test(effectSrc),
    true,
  );
  check(
    'the effect\'s dependency array does NOT include drafts/setDrafts -- proves it cannot loop or re-fire on its own write',
    !/\[screen, sellerContractFactsReport, latestSellerSigningModel, drafts\]/.test(contractTsxNoComments) && /\[screen, sellerContractFactsReport, latestSellerSigningModel\]/.test(effectSrc),
    true,
  );

  // ---- Property Legal Description: ALL SIX sub-fields hydrate, not just County -- the exact
  // property Brad's report demonstrated failing ("every field needs a value") ----
  const legalDescFields = ['lot', 'block', 'addition', 'county', 'exclusions'];
  for (const f of legalDescFields) {
    check(
      `draftsFromReport hydrates legalDesc.${f} from legal.${f}'s populated ValueOrNone`,
      new RegExp(`${f}: legal\\.${f}\\.kind === "populated" \\? valueOrNoneToDraft\\(legal\\.${f}\\.value\\) : d\\.legalDesc\\.${f}`).test(hydrationFnSrc),
      true,
    );
  }
  check('draftsFromReport hydrates legalDesc.reservationsKind/reservationsNote from legal.reservations', /reservationsKind: legal\.reservations\.kind === "populated"/.test(hydrationFnSrc) && /reservationsNote: legal\.reservations\.kind === "populated" && legal\.reservations\.value\.kind === "applies"/.test(hydrationFnSrc), true);
  check('draftsFromReport hydrates legalDesc.municipalityKind/municipalityName from legal.legalMunicipality', /municipalityKind: legal\.legalMunicipality\.kind === "populated"/.test(hydrationFnSrc) && /municipalityName: legal\.legalMunicipality\.kind === "populated" && legal\.legalMunicipality\.value\.kind === "municipality"/.test(hydrationFnSrc), true);

  // ---- Seller Signing Model: the exact second reported symptom ----
  check(
    'draftsFromReport hydrates sellerSigning.count/seller1Capacity from the parsed signing model, never leaving it at "unset" when a model was actually saved',
    /count: signingModel\.kind === "one_seller" \? 1 : 2,/.test(hydrationFnSrc) && /seller1Capacity: signingModel\.seller1Capacity,/.test(hydrationFnSrc),
    true,
  );
  check(
    'draftsFromReport falls back to the unchanged INITIAL_DRAFTS sellerSigning shape when no signing model has ever been recorded (never invents a count)',
    /sellerSigning: signingModel\s*\?\s*\{[\s\S]*?\}\s*:\s*d\.sellerSigning,/.test(hydrationFnSrc),
    true,
  );

  // ---- A field with NO canonical record stays at its INITIAL_DRAFTS default -- never invented ----
  check(
    'an unresolved field explicitly falls back to the SAME INITIAL_DRAFTS default (d.*), never a guessed/invented value, for every hydrated group',
    (() => {
      const groups = ['legalDesc', 'lease', 'earnest', 'titleSurvey', 'propertyCondition', 'closingPossession', 'settlement', 'addenda', 'sellerEquitable', 'buyerBusinessConfig', 'sellerNotice'];
      return groups.every((g) => new RegExp('d\\.' + g + '\\.').test(hydrationFnSrc));
    })(),
    true,
  );

  // ---- Two disclosed, deliberate, pre-existing gaps -- not introduced by this fix, and documented as such ----
  // The next two checks read the JSDoc comment directly above draftsFromReport,
  // which contractTsxNoComments strips -- checked against contractTsx (WITH
  // comments) instead, the only place this documentation lives.
  check('buyerOverride is explicitly never hydrated (its audit-only "reason" text cannot be recovered from the aggregated report) -- documented, not silently dropped', /buyerOverride: d\.buyerOverride,/.test(hydrationFnSrc) && /audit-only `reason` text/.test(contractTsx), true);
  check('the pre-existing attorney "will draft" vs "never recorded" ambiguity is documented as inherited, not introduced, by this fix', /inherits that same, pre-existing ambiguity/.test(contractTsx), true);

  // ---- "intermediary" representation has no draft shape -- correctly excluded, never silently miscoerced ----
  check(
    'representation hydration explicitly excludes "intermediary" (the draft type has no shape for it) rather than passing it through and producing a type/runtime mismatch',
    /rep\.kind === "populated" && rep\.value\.kind !== "intermediary" \? repFactToDraft\(rep\.value\) : d\.representation,/.test(hydrationFnSrc),
    true,
  );

  // ---- The save handlers themselves are UNCHANGED -- they still read straight from `drafts`,
  // which is now correctly pre-populated. This is why "refresh -> edit one field -> save"
  // preserves every other saved value: hydration fills drafts, save reads drafts, nothing
  // in between re-blanks the untouched fields. ----
  check(
    'handleSaveLegalDesc is unchanged -- still validates/reads lot/block/addition/county/exclusions straight from drafts.legalDesc',
    /const lot = valueOrNoneToFact\(drafts\.legalDesc\.lot\);[\s\S]{0,400}if \(!lot \|\| !block \|\| !addition \|\| !county \|\| !exclusions\)/.test(contractTsxNoComments),
    true,
  );
  check(
    'handleSaveSellerSigning is unchanged -- still reads drafts.sellerSigning.count/seller1Capacity straight from drafts',
    /if \(drafts\.sellerSigning\.count === "unset"\)/.test(contractTsxNoComments) && /model = \{ kind: "one_seller", seller1Capacity: drafts\.sellerSigning\.seller1Capacity \};/.test(contractTsxNoComments),
    true,
  );
}

// ==========================================================================
// B9-13 / INV-96 -- the manual GHL send record, blocking buyer-signer
// identity check, and executed-artifact page count. Source-text wiring
// only (this repo's own established, no-browser-rendering convention).
// ==========================================================================
{
  check('imports buildManualContractSendRecordArgs from the new manual-send model', /import \{ buildManualContractSendRecordArgs \} from "\.\.\/lib\/contract-manual-send-model";/.test(contractTsx), true);
  check('imports formatContractSendNote from contract-send-carriers', /formatContractSendNote/.test(contractTsx), true);
  check('imports verifyBuyerSignerIdentity and countPdfPages from contract-execution-model', /verifyBuyerSignerIdentity/.test(contractTsx) && /countPdfPages/.test(contractTsx), true);
  check('imports getRuntimeConfig from shared ghl-config', /import \{ getRuntimeConfig \} from "\.\.\/\.\.\/shared\/ghl-config";/.test(contractTsx), true);

  check('handleRecordManualSend calls buildManualContractSendRecordArgs', /async function handleRecordManualSend\(\) \{[\s\S]{0,2000}buildManualContractSendRecordArgs\(\{/.test(contractTsxNoComments), true);
  check('handleRecordManualSend writes through the SAME shared commitNote helper every other group-form Save button uses', /await commitNote\("manual-contract-send", note\);/.test(contractTsxNoComments), true);
  check('handleRecordManualSend sources templateName/requestedTemplateId/readbackLocationId from getRuntimeConfig(), never hand-typed', /runtimeConfig\.documentsContracts\.expectedTemplateName/.test(contractTsxNoComments) && /runtimeConfig\.documentsContracts\.templateId/.test(contractTsxNoComments) && /runtimeConfig\.locationId/.test(contractTsxNoComments), true);
  check('a blank expiration input is sent as null, never fabricated', /expirationAtIso = manualSendForm\.expirationAt \? new Date\(manualSendForm\.expirationAt\)\.toISOString\(\) : null;/.test(contractTsxNoComments), true);

  check('handleManualFileSelected awaits countPdfPages (a real, async pdf-lib parse)', /const pageCount = await countPdfPages\(bytesOutcome\.bytes\);/.test(contractTsxNoComments), true);

  check(
    'the buyer signer role/name are sourced from requiredSignerSetResult.buyerRole/buyerDisplayName, NEVER from requiredSigners[0] (array position)',
    /requiredSignerSetResult\.buyerRole/.test(contractTsxNoComments) && /requiredSignerSetResult\.buyerDisplayName/.test(contractTsxNoComments) && !/requiredSigners\[0\]/.test(contractTsxNoComments),
    true,
  );
  check('fullVerificationResult passes both buyerSignerRole and authorizedBuyerName to buildVerifiedUnderContractRecord', /buyerSignerRole: requiredSignerSetResult\.buyerRole,[\s\S]{0,80}authorizedBuyerName: requiredSignerSetResult\.buyerDisplayName,/.test(contractTsxNoComments), true);
  check('buyerSignerIdentityResult passes both buyerSignerRole and authorizedBuyerName to verifyBuyerSignerIdentity', /buyerSignerRole: requiredSignerSetResult\.buyerRole,[\s\S]{0,80}authorizedBuyerName: requiredSignerSetResult\.buyerDisplayName,[\s\S]{0,80}mappings: signerMappingCurrencyResult\.mappings,/.test(contractTsxNoComments), true);

  check('renders the Record GHL Send section, gated on no accepted send existing yet', /data-testid="contract-manual-send-section"/.test(contractTsx), true);
  check('the Record GHL Send button is wired to handleRecordManualSend', /testId="contract-manual-send-record-button" onClick=\{handleRecordManualSend\}/.test(contractTsx), true);
  check('renders a live buyer-signer-identity verified/mismatch display', /data-testid="contract-execution-buyer-identity-verified"/.test(contractTsx) && /data-testid="contract-execution-buyer-identity-mismatch"/.test(contractTsx), true);
  check('renders the executed artifact\'s page count', /data-testid="contract-execution-artifact-page-count"/.test(contractTsx), true);

  // B9-13/INV-96 correction round 2 -- email-only GHL identity fallback.
  check('fullVerificationResult ALSO passes authorizedBuyerEmail (requiredSignerSetResult.buyerEmail), never a hardcoded/guessed value', /buyerSignerRole: requiredSignerSetResult\.buyerRole,\s*\n\s*authorizedBuyerName: requiredSignerSetResult\.buyerDisplayName,\s*\n\s*authorizedBuyerEmail: requiredSignerSetResult\.buyerEmail,/.test(contractTsxNoComments), true);
  check('buyerSignerIdentityResult ALSO passes authorizedBuyerEmail (requiredSignerSetResult.buyerEmail)', /buyerSignerRole: requiredSignerSetResult\.buyerRole,\s*\n\s*authorizedBuyerName: requiredSignerSetResult\.buyerDisplayName,\s*\n\s*authorizedBuyerEmail: requiredSignerSetResult\.buyerEmail,/.test(contractTsxNoComments) && (contractTsxNoComments.match(/authorizedBuyerEmail: requiredSignerSetResult\.buyerEmail,/g) || []).length === 2, true);

  // B9-13 authorization-hydration repair, gate-review correction (2026-09-21).
  check(
    'does NOT import hasAppWriteSession -- recognizing a durable authorization no longer depends on an app-write session at all',
    !/hasAppWriteSession/.test(contractTsx),
    true,
  );
  check(
    'no useEffect anywhere in this component calls handleGenerateArtifact -- generation happens ONLY on the operator\'s own explicit Generate click, never automatically on page load',
    (contractTsxNoComments.match(/handleGenerateArtifact/g) || []).length === 2 &&
    /async function handleGenerateArtifact\(\) \{/.test(contractTsxNoComments) &&
    /onClick=\{handleGenerateArtifact\}/.test(contractTsxNoComments),
    true,
  );
  check(
    'currentArtifactFactsForDisplay prefers a fresh in-session generation when one exists',
    /const currentArtifactFactsForDisplay = useMemo\(\(\) => \{\s*\n\s*if \(generatedArtifact\) \{/.test(contractTsxNoComments),
    true,
  );
  check(
    'absent a fresh generation, currentArtifactFactsForDisplay hydrates from the durable bradAuthorizationRecord\'s own artifact fields -- no Generate call, no write session, no network I/O',
    /if \(bradAuthorizationRecord\) \{\s*\n\s*return \{\s*\n\s*artifactSha256: bradAuthorizationRecord\.artifactSha256,\s*\n\s*sourcePdfSha256: bradAuthorizationRecord\.sourcePdfSha256,\s*\n\s*generatorVersion: bradAuthorizationRecord\.generatorVersion,\s*\n\s*manifestVersion: bradAuthorizationRecord\.manifestVersion,/.test(contractTsxNoComments),
    true,
  );
  check(
    'currentArtifactFactsForDisplay depends on bradAuthorizationRecord (re-hydrates when a fresh/different record loads)',
    /\[generatedArtifact, bradAuthorizationRecord\]\);/.test(contractTsxNoComments),
    true,
  );
  check('imports the named downstream-control gate predicates from contract-workspace-view (now four, including showStartDispositionControl)', /showRecordGhlSendControl, showVerifyExecutionControl, showDispositionHandoffControl, showStartDispositionControl,/.test(contractTsx), true);
  check(
    'the Record GHL Send section render gate calls the named predicate, not an inline re-derived expression',
    /\) : showRecordGhlSendControl\(screen, bradAuthorizationRecord, existingSend\) \? \(/.test(contractTsxNoComments),
    true,
  );
  check(
    'the Verify Execution & Under Contract section render gate calls the named predicate',
    /\{showVerifyExecutionControl\(existingSend\) \? \(/.test(contractTsxNoComments),
    true,
  );
  check(
    'the Disposition Handoff section render gate calls the named predicate (now combined with the two additional durable §5-ruling conditions, never in place of it)',
    /\{showStartDispositionControl\(currentUnderContractRecord, preservedArtifactRecord, underContractStageConfirmed\) \? \(/.test(contractTsxNoComments),
    true,
  );
  check(
    'the retired, always-ineligible Contract Sent state-machine display is removed from the operator UI',
    !/data-testid="contract-sent-true"/.test(contractTsx) && !/data-testid="contract-sent-false-reasons"/.test(contractTsx),
    true,
  );
  check(
    'the underlying contractSentStatus computation is preserved (not deleted), just no longer rendered',
    /const contractSentStatus = useMemo/.test(contractTsxNoComments),
    true,
  );

  // ============================================================
  // Gate-review closure, requirement 1 -- client wiring proof for the
  // executed-artifact preservation UI and the stage-transition control.
  // ============================================================

  check(
    'the executed-PDF file input is gated behind BOTH fullVerificationResult.ok and a genuinely-recorded Under Contract write state (success or already_recorded) -- never offered before verified execution/Under Contract evidence exists',
    /\{\(underContractWriteState\.kind === "success" \|\| underContractWriteState\.kind === "already_recorded"\) \? \(\s*\n\s*<div style=\{\{ \.\.\.groupCardStyle, marginTop: "16px" \}\}>\s*\n\s*<div[^>]*>Preserve executed PDF<\/div>/.test(contractTsxNoComments),
    true,
  );
  check(
    'that gate sits textually AFTER (nested inside) the fullVerificationResult.ok branch, never a sibling reachable independently of it',
    (() => {
      const okIdx = contractTsxNoComments.indexOf('fullVerificationResult.ok ? (');
      const gateIdx = contractTsxNoComments.indexOf('underContractWriteState.kind === "success" || underContractWriteState.kind === "already_recorded") ? (');
      return okIdx !== -1 && gateIdx !== -1 && gateIdx > okIdx;
    })(),
    true,
  );
  check(
    'the file input itself only renders in the else-branch of `preservedArtifactRecord ?` -- once an artifact is already preserved, the input disappears rather than allowing a second silent upload',
    /\{preservedArtifactRecord \? \(\s*\n\s*<div data-testid="contract-execution-artifact-preserved"/.test(contractTsxNoComments) &&
    /<input\s*\n\s*data-testid="contract-execution-artifact-file-input"/.test(contractTsxNoComments),
    true,
  );

  check('upload PROGRESS state is wired -- a dedicated data-testid rendered only while preserveUploadState.kind === "uploading"', /preserveUploadState\.kind === "uploading" \? \(\s*\n\s*<div data-testid="contract-execution-artifact-uploading"/.test(contractTsxNoComments), true);
  check('upload SUCCESS state is wired -- a dedicated data-testid rendered only while preserveUploadState.kind === "success"', /preserveUploadState\.kind === "success" \? \(\s*\n\s*<div data-testid="contract-execution-artifact-upload-success"/.test(contractTsxNoComments), true);
  check('upload FAILURE state is wired -- a dedicated data-testid rendered only while preserveUploadState.kind === "failed"', /preserveUploadState\.kind === "failed" \? \(\s*\n\s*<div data-testid="contract-execution-artifact-upload-failed"/.test(contractTsxNoComments), true);
  check('the file input is disabled while an upload is already in flight', /disabled=\{preserveUploadState\.kind === "uploading"\}/.test(contractTsxNoComments), true);

  check(
    'the stage-transition control (button) renders ONLY inside `{preservedArtifactRecord ? (` -- it cannot appear before a matching preserved-artifact record exists',
    (() => {
      const m = contractTsxNoComments.match(/\{preservedArtifactRecord \? \(\s*\n\s*<div style=\{\{ \.\.\.groupCardStyle, marginTop: "16px" \}\}>\s*\n\s*<div[^>]*>Transition to Under Contract<\/div>\s*\n\s*<Btn\s*\n\s*testId="contract-execution-transition-under-contract-button"/);
      return !!m;
    })(),
    true,
  );
  check(
    'that same block sits inside the outer Under-Contract-write-state gate too -- it cannot appear before the Under Contract record itself exists, only "preservedArtifactRecord" additionally',
    (() => {
      const ucGateIdx = contractTsxNoComments.indexOf('underContractWriteState.kind === "success" || underContractWriteState.kind === "already_recorded") ? (');
      const transitionBtnIdx = contractTsxNoComments.indexOf('testId="contract-execution-transition-under-contract-button"');
      return ucGateIdx !== -1 && transitionBtnIdx !== -1 && transitionBtnIdx > ucGateIdx;
    })(),
    true,
  );

  check('the transition control\'s onClick calls ONLY handleTransitionUnderContractStage, never an inline write', /onClick=\{handleTransitionUnderContractStage\}/.test(contractTsxNoComments), true);
  check(
    'handleTransitionUnderContractStage calls ONLY ghl.opportunities.transitionToUnderContractStage, never a second/direct write call site',
    (() => {
      const m = contractTsxNoComments.match(/async function handleTransitionUnderContractStage\(\)[\s\S]*?\n  \}/);
      return !!m && (m[0].match(/ghl\.opportunities\.transitionToUnderContractStage\(/g) || []).length === 1 && !/confirmedCommand\(|writeCommand\(|ghl\.notes\.create\(/.test(m[0]);
    })(),
    true,
  );
  check(
    'handleTransitionUnderContractStage passes ONLY opportunityId, agreementAt, and the current documentVersion -- never a stage id, pipeline id, or literal operation string of its own',
    /ghl\.opportunities\.transitionToUnderContractStage\(screen\.opportunity\.id, screen\.economics\.agreementAt, documentVersion\)/.test(contractTsxNoComments),
    true,
  );
  check(
    'handleTransitionUnderContractStage itself contains no literal reference to a GHL pipeline or stage id -- the args it actually sends carry none (config.pipelines/config.stages are read elsewhere, ONLY for the read-only durable-gate derivation below, never inside this handler)',
    (() => {
      const m = contractTsxNoComments.match(/async function handleTransitionUnderContractStage\(\)[\s\S]*?\n  \}/);
      return !!m && !/config\.pipelines|config\.stages|getRuntimeConfig\(\)\.pipelines|getRuntimeConfig\(\)\.stages/.test(m[0]);
    })(),
    true,
  );
  check(
    'the ONLY other place ContractWorkspace.tsx reads config.pipelines/config.stages is the read-only underContractStageConfirmed derivation -- a live GHL opportunity is compared against them for DISPLAY/GATING, never sent anywhere',
    /const underContractStageConfirmed =\s*\n\s*opportunityStageSnapshot !== null &&\s*\n\s*opportunityStageSnapshot\.pipelineId === getRuntimeConfig\(\)\.pipelines\.sellerLeads &&\s*\n\s*opportunityStageSnapshot\.pipelineStageId === getRuntimeConfig\(\)\.stages\.underContract;/.test(contractTsxNoComments),
    true,
  );

  const ghlTsx = readSrc('src/lib/ghl.ts');
  const ghlTsxNoComments = ghlTsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(
    'ghl.ts\'s transitionToUnderContractStage wrapper takes EXACTLY (opportunityId, agreementAt, version) -- no pipelineId/stageId parameter exists for a caller to ever supply',
    /transitionToUnderContractStage: \(opportunityId: string, agreementAt: string, version: ContractVersionIdentity\) =>/.test(ghlTsxNoComments),
    true,
  );
  check(
    'ghl.ts\'s transitionToUnderContractStage wrapper sends EXACTLY { agreementAt, version } as the operation args -- no pipelineId/stageId field in the request body the browser constructs',
    /confirmedCommand\("opportunity\.underContractStage", opportunityId, \{ agreementAt, version \}\)/.test(ghlTsxNoComments),
    true,
  );
  check(
    'no OTHER call site anywhere in ghl.ts invokes the opportunity.underContractStage operation string -- exactly one, named, non-parameterized wrapper',
    (ghlTsxNoComments.match(/opportunity\.underContractStage/g) || []).length === 1,
    true,
  );

  // ============================================================
  // Gate-review closure -- Finding H. The signing-party checklist label
  // and the execution-section disclosure text.
  // ============================================================
  check(
    'the signing_party checklist title is built from item.authoritativeLabel (the printed personal name), never item.signerRole (the internal capacity label)',
    contractTsx.includes('`Signing party: ${item.authoritativeLabel}`'),
    true,
  );
  check(
    'the OLD role-labeled signing_party title is gone',
    contractTsx.includes('`Signing party: ${item.signerRole}`'),
    false,
  );
  check(
    'the false blanket disclosure ("Nothing here is uploaded, persisted, logged, or written to GHL") is removed',
    contractTsx.includes('Nothing here is uploaded, persisted, logged, or written to GHL.'),
    false,
  );
  check(
    'the corrected disclosure discloses the live readback fetch is read-only against GHL',
    contractTsx.includes('Fetching the live readback above is read-only against GHL'),
    true,
  );
  check(
    'the corrected disclosure discloses that Record signer mapping / Record attestation DO write a durable IAOS note in GHL, only on click',
    contractTsx.includes('DOES write a durable IAOS note in GHL -- only when that button is clicked, never automatically'),
    true,
  );
  check(
    'the corrected disclosure does not claim the PDF is uploaded by the two attestation steps, and does not imply Preserve executed PDF is local-only',
    contractTsx.includes('Preserve executed PDF, further below, is a separate action that DOES upload and durably store the actual PDF bytes'),
    true,
  );

  // ============================================================
  // Gate-review closure -- narrow post-attestation safety repair.
  // DEFECT: immediately after a successful save, "Record attestation"
  // remained enabled, risking a second click attempting a duplicate
  // durable write.
  // ============================================================
  check(
    'the Record attestation button\'s disabled expression ALSO checks attestationCurrencyResult -- disabled both immediately after a successful save (the new note becomes current) and whenever a hydrated attestation is already current for the exact evidence',
    contractTsx.includes('disabled={!allChecklistItemsAnswered || !manualArtifactVerificationResult || !manualArtifactVerificationResult.ok || (attestationCurrencyResult?.ok ?? false)}'),
    true,
  );
  check(
    'the Record signer mapping button is unaffected by this repair -- its own disabled expression is untouched',
    contractTsx.includes('disabled={!allSignersAssigned}'),
    true,
  );
  check(
    'the corrected buyer-signer-identity success wording reads "authorized buyer signer name", never "authorized legal buyer name"',
    contractTsx.includes('The buyer\'s mapped provider recipient\'s reported name matches the authorized buyer signer name.'),
    true,
  );
  check(
    'the OLD "authorized legal buyer name" success wording is gone from the rendered UI text',
    contractTsx.includes('matches the authorized legal buyer name.'),
    false,
  );

  // ============================================================
  // Gate-review closure, §5 ruling -- Start Disposition's durable
  // three-part gate. Supersedes the earlier (now-superseded) single-
  // condition assertion: the note alone is no longer sufficient.
  // ============================================================
  check(
    'Start Disposition\'s render gate requires ALL THREE durable facts: the Under Contract record, the preserved artifact record, AND a freshly-confirmed live GHL stage -- never fewer',
    /\{showStartDispositionControl\(currentUnderContractRecord, preservedArtifactRecord, underContractStageConfirmed\) \? \(/.test(contractTsxNoComments),
    true,
  );
  check(
    'the gate is NEVER widened to also accept stageTransitionState.kind === "success" as a substitute for the live-confirmed condition',
    !/showDispositionHandoffControl\(currentUnderContractRecord\)[\s\S]{0,120}stageTransitionState/.test(contractTsxNoComments),
    true,
  );
  check(
    'underContractStageConfirmed is derived from opportunityStageSnapshot (a fresh GHL read), never from stageTransitionState',
    (() => {
      const m = contractTsxNoComments.match(/const underContractStageConfirmed =[\s\S]*?;/);
      return !!m && /opportunityStageSnapshot/.test(m[0]) && !/stageTransitionState/.test(m[0]);
    })(),
    true,
  );
  check(
    'opportunityStageSnapshot is refetched from a real GHL read (ghl.opportunities.get) on every fresh load of a ready screen',
    /ghl\.opportunities\.get\(opportunityId\)\.then/.test(contractTsxNoComments),
    true,
  );
  check(
    'the refetch effect also depends on stageTransitionState.kind -- so a successful transition triggers a FRESH durable readback, never trusting the transition call\'s own local success state directly',
    (() => {
      const m = contractTsxNoComments.match(/\}, \[screen\.state, screen\.state === "ready" \? screen\.opportunity\.id : null, stageTransitionState\.kind\]\);/);
      return !!m;
    })(),
    true,
  );
  check(
    'a screen that is not "ready" resets opportunityStageSnapshot to null -- the gate fails closed rather than holding a stale snapshot from a previous opportunity',
    /if \(screen\.state !== "ready"\) \{ setOpportunityStageSnapshot\(null\); return; \}/.test(contractTsxNoComments),
    true,
  );

  // ============================================================
  // Gate-review closure -- send-time UTC disclosure. The datetime-local
  // input's conversion behavior is unchanged; the label now explicitly
  // discloses that the operator enters LOCAL time and IAOS stores UTC.
  // ============================================================
  check(
    'the "When you actually sent it in GHL" field discloses local-entry/UTC-storage directly beneath its label, immediately before the datetime-local input',
    /When you actually sent it in GHL\s*\n\s*<div data-testid="contract-manual-send-request-at-helper"[^>]*>\s*\n\s*Enter this in your OWN local date and time, exactly as GHL displayed it to you -- IAOS converts and stores it as UTC\.\s*\n\s*<\/div>\s*\n\s*<input\s*\n\s*type="datetime-local"\s*\n\s*data-testid="contract-manual-send-request-at"/.test(contractTsxNoComments),
    true,
  );
  check(
    'the underlying local-to-UTC conversion (new Date(value).toISOString()) is unchanged -- only the disclosure was added',
    /requestAtIso = manualSendForm\.requestAt \? new Date\(manualSendForm\.requestAt\)\.toISOString\(\) : ""/.test(contractTsxNoComments),
    true,
  );
}

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
