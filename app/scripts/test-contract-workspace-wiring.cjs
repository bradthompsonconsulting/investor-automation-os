/**
 * Contract Workspace -- wiring/boundary test runner. B9-04 / INV-59.
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

const APP = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

const FLOOR = 41;
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
  check('ContractWorkspace does not call any other ghl.* namespace than contacts/opportunities/notes', (() => {
    const calls = contractTsxNoComments.match(/ghl\.[a-zA-Z]+\./g) || [];
    return calls.every((c) => c === 'ghl.contacts.' || c === 'ghl.opportunities.' || c === 'ghl.notes.');
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

  check('ghl.notes.create is called exactly once in the whole page (the one checklist write)', (contractTsxNoComments.match(/ghl\.notes\.create\(/g) || []).length, 1);
  check('the one write lives inside handleToggleChecklistItem', /async function handleToggleChecklistItem[\s\S]*?ghl\.notes\.create\(/.test(contractTsxNoComments), true);
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
  check('ContractWorkspace.tsx defines no new formatXxxNote-shaped carrier-write function of its own', /function format[A-Za-z]*Note/.test(contractTsxNoComments), false);
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
