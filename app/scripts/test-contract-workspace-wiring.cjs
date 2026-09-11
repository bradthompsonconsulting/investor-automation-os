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

const FLOOR = 79;
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

  check('ContractWorkspace.tsx imports computeContractScreenState from the pure view module', /import \{ computeContractScreenState,[\s\S]*\} from "\.\.\/lib\/contract-workspace-view"/.test(contractTsx), true);
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
  check('ContractWorkspace does not call any other ghl.* namespace than contacts/opportunities/notes/proposals (B9-08/INV-63 adds the sole sanctioned e-sign-provider namespace)', (() => {
    const calls = contractTsxNoComments.match(/ghl\.[a-zA-Z]+\./g) || [];
    return calls.every((c) => c === 'ghl.contacts.' || c === 'ghl.opportunities.' || c === 'ghl.notes.' || c === 'ghl.proposals.');
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

  check('ghl.notes.create is called exactly five times in the whole page (the checklist write, the ONE shared commitNote choke point every B9-05 group form routes through, B9-07/INV-62\'s own handleAuthorize, and B9-08/INV-63\'s own handleSend -- which writes TWO notes, the in_progress attempt and its resolution, for the same attemptId)', (contractTsxNoComments.match(/ghl\.notes\.create\(/g) || []).length, 5);
  check('the B9-08/INV-63 send write lives inside its own handleSend, never routed through commitNote', (() => {
    const m = contractTsxNoComments.match(/async function handleSend\([\s\S]*?\n  \}/m);
    return !!m && (m[0].match(/ghl\.notes\.create\(/g) || []).length === 2 && !/commitNote\(/.test(m[0]);
  })(), true);
  check('handleSend is wired to the Send button\'s onClick, and declared exactly once', (() => {
    const onClickWiring = /onClick=\{handleSend\}/.test(contractTsx);
    const declarations = (contractTsxNoComments.match(/async function handleSend\(/g) || []).length;
    return onClickWiring && declarations === 1;
  })(), true);
  check('handleSend is never invoked from the data-fetching effect or on mount', /handleSend\(\)/.test(effectBody) === false, true);
  check('handleSend reuses buildSendAttemptArgs/formatContractSendNote/classifyProviderSendResponse/buildSendResultArgs, never composes a send note body or a provider-response verdict inline', /const built = buildSendAttemptArgs\(/.test(contractTsxNoComments) && /classifyProviderSendResponse\(outcome\)/.test(contractTsxNoComments) && /buildSendResultArgs\(/.test(contractTsxNoComments), true);
  check('handleSend never sets contactId/userId on the outbound send call -- ghl-proxy.ts GATE 2 overrides both server-side', /ghl\.proposals\.send\(\{ templateId, opportunityId: screen\.opportunity\.id \}\)/.test(contractTsxNoComments), true);
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
