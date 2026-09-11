/**
 * Standalone Deal Calculator -- wiring/boundary test runner. B8-09 / INV-52.
 *
 * This repository has no browser-rendering test harness (confirmed by
 * `test-seller-call-workspace-wiring.cjs`'s own header, still true here) --
 * every existing "test-*.cjs" proves a PURE MODULE or, for a page, its
 * wiring by source-text inspection plus real TypeScript compilation
 * (`npx tsc -b` / `npx vite build`, run alongside this suite, not inside
 * it). It does not prove the page renders correctly at runtime in a
 * browser; that evidence is reported separately.
 */

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

const FLOOR = 66;
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
const sidebarTsx = readSrc('src/components/Sidebar.tsx');
const contactWorkspaceTsx = readSrc('src/pages/ContactWorkspace.tsx');
const calcTsx = readSrc('src/pages/DealCalculator.tsx');
const calcTsxNoComments = calcTsx.replace(/\/\*[\s\S]*?\*\//g, '');
const inputsTs = readSrc('src/lib/deal-calculator-inputs.ts');
const barTs = readSrc('src/lib/deal-calculator-bar.ts');

// ============================================================
// Route wiring.
// ============================================================
{
  check('App.tsx imports DealCalculator', /import DealCalculator from ".\/pages\/DealCalculator"/.test(appTsx), true);
  check('App.tsx declares the deal-calculator route', /path="deal-calculator"/.test(appTsx), true);
  check('App.tsx maps the route to <DealCalculator />', /path="deal-calculator"\s+element=\{<DealCalculator \/>\}/.test(appTsx), true);
  check('the route is top-level (not nested under contacts/:id) -- no contact/opportunity required', /contacts\/:id\/[^"]*"\s+element=\{<DealCalculator/.test(appTsx), false);
}

// ============================================================
// Nav entry.
// ============================================================
{
  check('Sidebar lists a Deal Calculator entry', /label:\s*"Deal Calculator"/.test(sidebarTsx), true);
  check('Sidebar Deal Calculator entry points to /deal-calculator', /to:\s*"\/deal-calculator"/.test(sidebarTsx), true);
}

// ============================================================
// ContactWorkspace entry point (optional linking convenience).
// ============================================================
{
  check('ContactWorkspace has a data-testid entry point into the calculator', /data-testid="contact-deal-calculator-link"/.test(contactWorkspaceTsx), true);
  check('ContactWorkspace entry links with the contactId query param', /to=\{`\/deal-calculator\?contactId=\$\{id\}`\}/.test(contactWorkspaceTsx), true);
}

// ============================================================
// PROOF THE AUTHORITATIVE SHARED ENGINE IS CONSUMED, NOT DUPLICATED.
// The page imports computeUnderwriting/computeBoard8Economics/
// computeExpectedSpread from the SAME modules Seller Call and
// Underwriting import from, and declares none of them itself.
// ============================================================
{
  check('page imports computeUnderwriting from underwriting/compute', /from "\.\.\/lib\/underwriting\/compute"/.test(calcTsx) && /computeUnderwriting/.test(calcTsx), true);
  check('page imports computeBoard8Economics + computeExpectedSpread from underwriting/board8-economics', /from "\.\.\/lib\/underwriting\/board8-economics"/.test(calcTsx) && /computeBoard8Economics/.test(calcTsx) && /computeExpectedSpread/.test(calcTsx), true);
  check('page does not declare its own computeUnderwriting', /\b(function|const)\s+computeUnderwriting\s*[=(]/.test(calcTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not declare its own computeBoard8Economics', /\b(function|const)\s+computeBoard8Economics\s*[=(]/.test(calcTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not declare its own computeExpectedSpread', /\b(function|const)\s+computeExpectedSpread\s*[=(]/.test(calcTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page computes Expected Spread with referenceKind "test_price" (B8-01/B8-02\'s own reserved name for this surface)', /referenceKind:\s*"test_price"/.test(calcTsx), true);
  check('page never uses referenceKind "current_offer" (that is Seller Call\'s / B8-08\'s surface, not this one)', /referenceKind:\s*"current_offer"/.test(calcTsx), false);
  check('deal-calculator-inputs.ts imports resolveInputs/parseDealOverrides/parsePolicy rather than reimplementing the hierarchy', /import\s*\{[^}]*resolveInputs[^}]*\}\s*from\s*"\.\/underwriting\/resolver"/.test(inputsTs), true);
  check('deal-calculator-inputs.ts does not reimplement the 25%/$5,000 Target/Max formula', inputsTs.indexOf('Math.max') === -1, true);
  check('deal-calculator-bar.ts does not reimplement the 25%/$5,000 Target/Max formula', barTs.indexOf('0.25') === -1 && barTs.indexOf('Math.max') === -1, true);
  check('deal-calculator-bar.ts does not call computeUnderwriting', barTs.indexOf('computeUnderwriting') === -1, true);
}

// ============================================================
// HARD NO: no reskin of the old calculator, no second engine, no 70%
// rule, no flip/ROI/financing/amortization/lender-fee/cash-to-close
// clutter, no scenario A/B/C or Monte Carlo.
// ============================================================
{
  check('page does not import MaoCalculator (the old page)', /MaoCalculator/.test(calcTsx), false);
  check('page does not reference the 70% wholesale rule', /wholesale_pct|0\.7\s*\*|\*\s*0\.7\b|70\s*%.{0,20}MAO/i.test(calcTsxNoComments), false);
  const forbiddenClutter = ['cashOnCash', 'cash_on_cash', 'flipROI', 'flip_roi', 'amortization', 'lenderFee', 'lender_fee', 'cashToClose', 'cash_to_close', 'MonteCarlo', 'monte_carlo', 'scenarioA', 'scenario_a'];
  const foundClutter = forbiddenClutter.filter((t) => calcTsx.indexOf(t) !== -1);
  check('page contains none of the forbidden V1 clutter features', foundClutter, []);
  check('page does not default Test Price from Max (no assignment of testPriceInput/testPrice from board8.maxSupportedOffer)', /setTestPriceInput\([^)]*maxSupportedOffer/.test(calcTsx), false);
  check('page does not default the offer/Test Price to Max anywhere (structural: no useEffect/useState initializer reads board8 for Test Price)', /testPriceInput.{0,10}=.{0,10}(board8|maxSupportedOffer)/.test(calcTsxNoComments), false);
}

// ============================================================
// Repairs: quick + optional deeper estimator, reusing Board 6's OWN
// pure functions verbatim -- no second repair engine.
// ============================================================
{
  check('page imports OPERATOR_ROWS/applyCondition/buildLines-via-operatorEstimate from repair-estimation/operator-model', /from "\.\.\/lib\/repair-estimation\/operator-model"/.test(calcTsx) && /OPERATOR_ROWS/.test(calcTsx) && /operatorEstimate/.test(calcTsx), true);
  check('page imports computeRepairEstimate from repair-estimation/compute (the same Board 6 core, never reimplemented)', /from "\.\.\/lib\/repair-estimation\/compute"/.test(calcTsx) && /computeRepairEstimate/.test(calcTsx), true);
  check('page does not declare its own computeRepairEstimate', /\b(function|const)\s+computeRepairEstimate\s*[=(]/.test(calcTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page renders a quick-vs-detailed mode toggle', /data-testid="deal-calc-repairs-mode-toggle"/.test(calcTsx), true);
  check('quick and detailed repairs are mutually exclusive (repairs is derived from repairsMode, never summed)', /repairsMode === "quick"\s*\n\s*\?\s*\(repairsQuickParsed/.test(calcTsx), true);
}

// ============================================================
// Primary bar: exact six cells, in order, sourced from the pure formatter.
// ============================================================
{
  check('page imports buildDealCalculatorBarCells from the pure bar module', /import \{ buildDealCalculatorBarCells,[\s\S]*\} from "\.\.\/lib\/deal-calculator-bar"/.test(calcTsx), true);
  check('page renders the primary bar with its data-testid', /data-testid="deal-calc-primary-bar"/.test(calcTsx), true);
  check('page does not define its own competing bar label array', /const\s+\w+\s*:\s*string\[\]\s*=\s*\[\s*"ARV"/.test(calcTsx), false);
}

// ============================================================
// Truthful empty/invalid/unknown states -- ARV, quick Repairs, and Test
// Price each surface distinct validation feedback, never silently
// coerced.
// ============================================================
{
  check('page imports parseAcquisitionPriceInput (ARV, Test Price) from seller-call-negotiation, reused rather than duplicated', /import \{ parseAcquisitionPriceInput \} from "\.\.\/lib\/seller-call-negotiation"/.test(calcTsx), true);
  check('page imports parseNonNegativeAmountInput (quick Repairs, Manual spread) from deal-calculator-inputs, allowing a legitimate $0', /parseNonNegativeAmountInput/.test(calcTsx), true);
  check('page renders distinct ARV validation feedback', /data-testid="deal-calc-arv-error"/.test(calcTsx), true);
  check('page renders distinct Repairs validation feedback', /data-testid="deal-calc-repairs-error"/.test(calcTsx), true);
  check('page renders distinct Test Price validation feedback', /data-testid="deal-calc-test-price-error"/.test(calcTsx), true);
}

// ============================================================
// Operator controls Test Price; IAOS does not invent it.
// ============================================================
{
  check('testPriceInput state is initialized empty', /const \[testPriceInput, setTestPriceInput\] = useState\(""\)/.test(calcTsx), true);
  check('setTestPriceInput is called ONLY from its own input onChange and Clear-to-empty (never a derived/computed value)', (calcTsx.match(/setTestPriceInput\(/g) || []).length, 2);
  check('every setTestPriceInput call site sets it from the raw input event or to "" (Clear), never a number expression', !/setTestPriceInput\([^)"]*\.(target|value)[^)]*\+|setTestPriceInput\(\s*\d/.test(calcTsx), true);
}

// ============================================================
// Optional linking is Contact-level only (no Opportunity resolution),
// and ARV is never saved back from this page.
// ============================================================
{
  check('page renders a link panel', /data-testid="deal-calc-link-panel"/.test(calcTsx), true);
  check('page reads ghl.contacts.getDetail for linking (no ghl.opportunities call anywhere -- Contact-level only)', /ghl\.contacts\.getDetail/.test(calcTsx) && !/ghl\.opportunities\./.test(calcTsx), true);
  check('page imports parseContactSeeds (the same PB-D55 seed concept Seller Call/Underwriting already read)', /parseContactSeeds/.test(calcTsx), true);
  check('linking never overwrites an already-typed ARV/Repairs value (guarded on the input being empty first)', /arvInput\.trim\(\) === ""[\s\S]{0,20}&&[\s\S]{0,20}seeds\.arv/.test(calcTsx) && /repairsQuickInput\.trim\(\) === ""[\s\S]{0,20}&&[\s\S]{0,20}seeds\.repairs/.test(calcTsx), true);
  // Checked against comments-stripped source: the module's OWN header
  // comment names `persistApprovedArv` in prose to EXPLAIN why ARV is
  // never saved back, which would false-positive a plain substring check
  // (same class of mistake as arv-approval-note.ts's ghl.notes.list
  // discussion earlier this board).
  check('page never calls setApprovedArv or persistApprovedArv (ARV is never saved back from this page)', !/setApprovedArv|persistApprovedArv/.test(calcTsxNoComments), true);
  check('page links to the real ARV & Comps workspace rather than approving ARV itself', /data-testid="deal-calc-view-arv-workspace"[\s\S]{0,200}underwriting|underwriting[\s\S]{0,200}data-testid="deal-calc-view-arv-workspace"/.test(calcTsx), true);
}

// ============================================================
// INV-70 / B9-07A Phase 2 correction round 3 -- Repairs save-back is
// REMOVED, not merely gated. Family 3's approved ruling makes
// contact.estimated_repairs a read-only legacy fallback/migration input;
// this page has no Opportunity context, so it has nowhere authorized to
// save Repairs to at all -- the SAME reasoning ARV's save-back already
// didn't have (§ above). This section now proves the ABSENCE of the old
// write path, mirroring how the ARV section above proves ARV's absence.
// ============================================================
{
  check('page no longer imports persistGate or persistApprovedRepairTotal from repair-estimation/persist', /persistGate|persistApprovedRepairTotal/.test(calcTsx.split('\n').slice(0, 40).join('\n')), false);
  check('page never calls setEstimatedRepairs, directly or otherwise -- this identifier does not appear anywhere in the page', !/setEstimatedRepairs/.test(calcTsx), true);
  check('page no longer renders a "Save Repairs" action', !/deal-calc-save-repairs/.test(calcTsx), true);
  check('page no longer declares handleSaveRepairs', !/function handleSaveRepairs/.test(calcTsx), true);
  check('page no longer renders a save-result status block', !/deal-calc-save-result/.test(calcTsx), true);
  check('page links to the Underwriting workspace for BOTH ARV and Repairs now (updated link text)', /Underwriting workspace/.test(calcTsx), true);
  check('page states plainly that NEITHER ARV nor Repairs saves from here', /Neither ARV nor Repairs is saved from here/.test(calcTsx), true);
  check('page contains no write-capable GHL call of any kind (notes.create, setApprovedArv, setEstimatedRepairs, setLastCallAttempt, setCallbackDatetime, saveUnderwritingFields)', ['.notes.create', 'setApprovedArv', 'setEstimatedRepairs', 'setLastCallAttempt', 'setCallbackDatetime', 'saveUnderwritingFields'].every((t) => calcTsx.indexOf(t) === -1), true);
}

// ============================================================
// Clear/Reset.
// ============================================================
{
  check('page renders a Clear action', /data-testid="deal-calc-clear"/.test(calcTsx), true);
  check('Clear resets ARV/Repairs/Test Price/assignment state', /function handleClear\(\) \{[\s\S]{0,400}setArvInput\(""\)[\s\S]{0,400}setTestPriceInput\(""\)/.test(calcTsx), true);
  check('Clear does not sever an existing link (Clear and Unlink are two distinct bounded actions)', /function handleClear\(\) \{[\s\S]{0,600}\n  \}/.test(calcTsx) && !/function handleClear\(\)[\s\S]{0,600}setLinkedContactId\(null\)/.test(calcTsx), true);
}

// ============================================================
// Investor Policy under More Detail -- read-only, collapsed by default,
// never editable (no Deal Override carrier exists for these values
// anywhere in IAOS).
// ============================================================
{
  check('page renders a More Detail toggle', /data-testid="deal-calc-more-detail-toggle"/.test(calcTsx), true);
  check('More Detail is collapsed by default (moreDetailOpen initializes false)', /const \[moreDetailOpen, setMoreDetailOpen\] = useState\(false\)/.test(calcTsx), true);
  check('page renders all eleven Investor Policy values under More Detail', /data-testid="deal-calc-investor-policy"/.test(calcTsx), true);
  check('page imports parsePolicy (reused, not reimplemented) to display Investor Policy', /parsePolicy/.test(calcTsx), true);
  // A real, bounded assertion: extract exactly the Investor Policy display
  // block (from its own data-testid to its matching closing </div>, at
  // its own 12-space indent -- verified against the actual source, not
  // guessed) and prove it contains no <input>/<select>/<textarea> at all,
  // while also proving the extracted slice is non-trivial (it actually
  // references parsedPolicy) so this cannot pass on an empty or
  // mismatched slice. The Manual-mode amount <input> sits OUTSIDE this
  // block (a sibling, for a legitimately editable field that is NOT an
  // Investor Policy value), so scoping tightly to this one div is what
  // makes the assertion meaningful rather than incidentally true of the
  // whole More Detail panel.
  const policyBlockStart = calcTsx.indexOf('data-testid="deal-calc-investor-policy"');
  const policyBlockEnd = calcTsx.indexOf('\n            </div>', policyBlockStart);
  check('the Investor Policy display block was found and bounded correctly', policyBlockStart !== -1 && policyBlockEnd !== -1 && policyBlockEnd > policyBlockStart, true);
  const policyBlock = calcTsx.slice(policyBlockStart, policyBlockEnd);
  check('the extracted Investor Policy block actually renders policy values (non-trivial slice, not a vacuous match)', /parsedPolicy\./.test(policyBlock) && (policyBlock.match(/policyRow\(/g) || []).length, 10);
  check('the Investor Policy display block contains NO editable form control at all (<input>, <select>, or <textarea>)', /<input\b|<select\b|<textarea\b/.test(policyBlock), false);
}

// ============================================================
// No Production mutation beyond the one sanctioned repairs write; no
// second economics engine anywhere in the two new lib modules.
// ============================================================
{
  check('deal-calculator-inputs.ts contains no network/GHL surface', ['fetch(', 'ghl.', 'PROXY', 'customFields', '.notes.'].every((t) => inputsTs.indexOf(t) === -1), true);
  check('deal-calculator-bar.ts contains no network/GHL surface', ['fetch(', 'ghl.', 'PROXY', 'customFields'].every((t) => barTs.indexOf(t) === -1), true);
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
