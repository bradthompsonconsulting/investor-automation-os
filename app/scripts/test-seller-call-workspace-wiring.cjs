/**
 * Seller Call Workspace -- wiring/boundary test runner. B8-05 / INV-48.
 *
 * This repository has no browser-rendering test harness (no Playwright
 * spec exists anywhere in it today, confirmed by a repo-wide search
 * before this file was written) -- every existing "test-*.cjs" proves a
 * PURE MODULE, never a rendered page. This harness follows that same
 * convention and its same honest limit: it proves the route, the entry
 * points, and the engine-reuse boundary are WIRED, by reading source text
 * and by real TypeScript compilation of the page module (which fails
 * loudly on a broken import or a route/prop mismatch). It does not prove
 * the page renders correctly at runtime in a browser -- `npx tsc -b` and
 * `npx vite build` (run alongside this suite, not inside it) are the
 * evidence for compiled correctness; a manual/visual check is what
 * proves runtime rendering, and neither substitutes for the other.
 */

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

const FLOOR = 31;
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
const contactWorkspaceTsx = readSrc('src/pages/ContactWorkspace.tsx');
const dashboardTsx = readSrc('src/pages/Dashboard.tsx');
const sellerCallTsx = readSrc('src/pages/SellerCallWorkspace.tsx');
const dealBarTs = readSrc('src/lib/seller-call-deal-bar.ts');

// ============================================================
// Validation item 1 (route resolution) + route wiring.
// ============================================================
{
  check('App.tsx imports SellerCallWorkspace', /import SellerCallWorkspace from ".\/pages\/SellerCallWorkspace"/.test(appTsx), true);
  check('App.tsx declares the seller-call sub-route', /path="contacts\/:id\/seller-call"/.test(appTsx), true);
  check('App.tsx maps the route to <SellerCallWorkspace />', /path="contacts\/:id\/seller-call"\s+element=\{<SellerCallWorkspace \/>\}/.test(appTsx), true);
  check(
    'the seller-call route sits alongside the underwriting sub-route (same Contact-context pattern)',
    /path="contacts\/:id\/underwriting"[\s\S]{0,200}path="contacts\/:id\/seller-call"/.test(appTsx),
    true,
  );
  check(
    'SellerCallWorkspace resolves contact context the SAME way as UnderwritingWorkspace (useParams<{ id: string }>)',
    /useParams<\{ id: string \}>\(\)/.test(sellerCallTsx),
    true,
  );
}

// ============================================================
// Validation item 2: Contact Workspace Start/Resume entry.
// ============================================================
{
  check('ContactWorkspace has a data-testid entry point for the seller call', /data-testid="contact-seller-call-link"/.test(contactWorkspaceTsx), true);
  check('ContactWorkspace entry links to the exact seller-call route', /to=\{`\/contacts\/\$\{id\}\/seller-call`\}/.test(contactWorkspaceTsx), true);
  check('ContactWorkspace entry is labelled Start / Resume', /Start \/ Resume Seller Call/.test(contactWorkspaceTsx), true);
}

// ============================================================
// Dashboard entry point (appropriate existing surface: Follow Up, the
// dashboard's own call-oriented queue).
// ============================================================
{
  check('Dashboard links to the seller-call route', /to=\{`\/contacts\/\$\{c\.id\}\/seller-call`\}/.test(dashboardTsx), true);
  check('Dashboard entry sits in a queue with a Call button (call-oriented section)', /PhoneCall size=\{12\} \/> Call[\s\S]{0,400}\/seller-call/.test(dashboardTsx), true);
}

// ============================================================
// Jess Gate, 2026-09-05: the deal bar and its adjacent Offer Ready
// guardrail must stay visible while the workspace scrolls. Structural
// proof that a sticky wrapper exists, wraps BOTH <DealBar> and
// <ReadinessBadge> in that order (so Offer Ready still renders adjacent
// to the bar, not folded into it as an eighth cell), sets an explicit
// top offset and stacking order, and gives the wrapper an opaque
// background so scrolled content cannot show through.
// ============================================================
{
  const stickyMarker = 'data-testid="seller-call-sticky-bar"';
  check('page declares a dedicated sticky wrapper for the deal bar', sellerCallTsx.indexOf(stickyMarker) !== -1, true);

  const stickyBlockMatch = sellerCallTsx.match(/data-testid="seller-call-sticky-bar"[\s\S]{0,400}/);
  const stickyBlock = stickyBlockMatch ? stickyBlockMatch[0] : '';
  check('sticky wrapper uses position: sticky', /position:\s*"sticky"/.test(stickyBlock), true);
  check('sticky wrapper pins to the top of its scroll container', /top:\s*0/.test(stickyBlock), true);
  check('sticky wrapper sets an explicit stacking order (zIndex)', /zIndex:/.test(stickyBlock), true);
  check('sticky wrapper has an opaque background matching <main> (#0A0E1A), not transparent', /background:\s*"#0A0E1A"/.test(stickyBlock), true);

  const stickyWrapperFull = sellerCallTsx.slice(
    sellerCallTsx.indexOf(stickyMarker),
    sellerCallTsx.indexOf('</div>', sellerCallTsx.indexOf('<ReadinessBadge')) + '</div>'.length,
  );
  check('sticky wrapper contains <DealBar', stickyWrapperFull.indexOf('<DealBar') !== -1, true);
  check('sticky wrapper contains <ReadinessBadge AFTER <DealBar (adjacent, not an eighth cell)',
    stickyWrapperFull.indexOf('<DealBar') !== -1
    && stickyWrapperFull.indexOf('<ReadinessBadge') !== -1
    && stickyWrapperFull.indexOf('<DealBar') < stickyWrapperFull.indexOf('<ReadinessBadge'),
    true);
  check('ReadinessBadge is a sibling element, not a prop of DealBar (still adjacent, not folded in)',
    /<DealBar cells=\{dealBarCells\} \/>/.test(stickyWrapperFull), true);
}

// ============================================================
// Validation items 4/5/9: B8-03 and B8-04 are imported and called;
// nothing here reimplements either engine.
// ============================================================
{
  check('page imports computeBoard8Economics from board8-economics', /import \{ computeBoard8Economics, computeExpectedSpread,[\s\S]*\} from "\.\.\/lib\/underwriting\/board8-economics"/.test(sellerCallTsx), true);
  check('page imports computeOfferReadiness from offer-readiness', /import \{ computeOfferReadiness,[\s\S]*\} from "\.\.\/lib\/underwriting\/offer-readiness"/.test(sellerCallTsx), true);
  check('page imports buildDealBarCells from the pure deal-bar module', /import \{ buildDealBarCells,[\s\S]*\} from "\.\.\/lib\/seller-call-deal-bar"/.test(sellerCallTsx), true);
  check('page never reimplements the 25%/$5,000 Target formula', sellerCallTsx.indexOf('0.25') === -1, true);
  // The page legitimately references the three status literals for DISPLAY
  // (READINESS_STYLE's lookup keys, and equality checks against
  // readiness.effectiveStatus) -- that is reading B8-04's output, not
  // reimplementing it. Reimplementation would mean a second FUNCTION
  // deciding the status; TypeScript itself would reject a local
  // declaration colliding with the imported name, so this asserts the
  // absence directly rather than relying on that as an implicit proof.
  check('page does not declare its own computeOfferReadiness function', /\b(function|const)\s+computeOfferReadiness\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not declare its own computeBoard8Economics function', /\b(function|const)\s+computeBoard8Economics\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('deal-bar module never reimplements the 25%/$5,000 Target formula', dealBarTs.indexOf('0.25') === -1, true);
}

// ============================================================
// Validation item 3: deal-bar ordering/labels come from the one pure
// module (already exhaustively tested in test-seller-call-deal-bar.cjs);
// this only confirms the page does not maintain a second, competing list.
// ============================================================
{
  const pageOwnLabelArray = /const\s+\w+\s*:\s*string\[\]\s*=\s*\[\s*"ARV"/.test(sellerCallTsx);
  check('page does not define its own competing deal-bar label array', pageOwnLabelArray, false);
}

// ============================================================
// No Production mutation / no invented carrier / no write capability:
// this page contains no writer, no PUT-capable GHL call, and no local
// input for Current Offer or Seller Position.
// ============================================================
{
  const forbidden = ['.notes.create', 'setApprovedArv', 'setEstimatedRepairs', 'saveUnderwritingFields', 'setAskingPrice', 'setLastCallAttempt', 'setCallbackDatetime'];
  const found = forbidden.filter((t) => sellerCallTsx.indexOf(t) !== -1);
  check('page contains no write-capable GHL call of any kind', found, []);
  check('page reads only getDetail, listPipeline, and underwriting.policy', {
    getDetail: sellerCallTsx.indexOf('ghl.contacts.getDetail') !== -1,
    listPipeline: sellerCallTsx.indexOf('ghl.opportunities.listPipeline') !== -1,
    policy: sellerCallTsx.indexOf('ghl.underwriting.policy') !== -1,
  }, { getDetail: true, listPipeline: true, policy: true });
  check('page defines no local editable state for Current Offer or Seller Position', /useState[^;]*[Cc]urrentOffer|useState[^;]*[Ss]ellerPosition/.test(sellerCallTsx), false);
}

// ============================================================
// Validation item 6/7 wiring: Expected Spread is computed with the
// explicit "current_offer" reference kind, and its reference price is
// never defaulted to anything but null (no invented carrier/value).
// ============================================================
{
  check('page computes Expected Spread with referenceKind "current_offer"', /referenceKind:\s*"current_offer"/.test(sellerCallTsx), true);
  check('page never supplies a non-null referencePrice (no invented Current Offer value)', /referencePrice:\s*null/.test(sellerCallTsx), true);
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
