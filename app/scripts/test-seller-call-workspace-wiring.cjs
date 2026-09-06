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

const FLOOR = 104;
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
/** Block comments stripped -- for checks that must not false-positive on this page's own extensive doc comments discussing the very code patterns they check for (e.g. `humanAction:` appearing in prose). */
const sellerCallTsxNoComments = sellerCallTsx.replace(/\/\*[\s\S]*?\*\//g, '');
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
  // Precise multiplication-context check, not a bare substring match: B8-07
  // legitimately uses "0.25" as a CSS rgba() opacity value (copied verbatim
  // from ContactWorkspace.tsx's own comps-helper styling), which a bare
  // substring check would misreport as formula reimplementation.
  check('page never reimplements the 25%/$5,000 Target formula', /[*]\s*0\.25|0\.25\s*[*]/.test(sellerCallTsx), false);
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
// B8-06 / INV-49: Next Best Question is imported and rendered, never
// reimplemented on the page.
// ============================================================
{
  check('page imports computeNextBestQuestion from next-best-question', /import \{ computeNextBestQuestion,[\s\S]*\} from "\.\.\/lib\/underwriting\/next-best-question"/.test(sellerCallTsx), true);
  check('page does not declare its own computeNextBestQuestion function', /\b(function|const)\s+computeNextBestQuestion\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page renders a dedicated Next Best Question panel', /data-testid="next-best-question-panel"/.test(sellerCallTsx), true);
  check('page reads nextBestQuestion.question (not a re-derived string)', /nextBestQuestion\.question/.test(sellerCallTsx), true);
  check('page reads nextBestQuestion.whyItMatters (not a re-derived string)', /nextBestQuestion\.whyItMatters/.test(sellerCallTsx), true);
  check('page no longer joins every reason into one ad hoc objective string (superseded by NBQ)', /readiness\.reasons\.map\(\(r\) => r\.message\)\.join/.test(sellerCallTsx), false);
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
// this page contains no writer and no PUT-capable GHL call. B8-08 /
// INV-51 now DOES define local editable session state for Current Offer
// and Seller Position (superseding the pre-INV-51 "no local input"
// check this file used to assert) -- proven safe below by confirming
// neither is GHL-backed and neither defaults to anything but empty.
// ============================================================
{
  const forbidden = ['.notes.create', 'setApprovedArv', 'setEstimatedRepairs', 'saveUnderwritingFields', 'setAskingPrice', 'setLastCallAttempt', 'setCallbackDatetime'];
  const found = forbidden.filter((t) => sellerCallTsx.indexOf(t) !== -1);
  check('page contains no write-capable GHL call of any kind', found, []);
  check('page reads only getDetail, listPipeline, underwriting.policy, and notes.list (all pre-existing read calls)', {
    getDetail: sellerCallTsx.indexOf('ghl.contacts.getDetail') !== -1,
    listPipeline: sellerCallTsx.indexOf('ghl.opportunities.listPipeline') !== -1,
    policy: sellerCallTsx.indexOf('ghl.underwriting.policy') !== -1,
    notesList: sellerCallTsx.indexOf('ghl.notes.list') !== -1,
  }, { getDetail: true, listPipeline: true, policy: true, notesList: true });
}

// ============================================================
// B8-08 / INV-51: Current Offer and Seller Position are operator-entered
// session state -- IAOS invents/defaults neither, and neither is a GHL
// carrier.
// ============================================================
{
  check('sellerPositionInput state is initialized empty, never from a GHL/derived value', /const \[sellerPositionInput, setSellerPositionInput\] = useState\(""\)/.test(sellerCallTsx), true);
  check('currentOfferInput state is initialized empty, never from a GHL/derived value -- IAOS invents no opening offer', /const \[currentOfferInput, setCurrentOfferInput\] = useState\(""\)/.test(sellerCallTsx), true);
  check('setSellerPositionInput is called ONLY from its own input onChange (exactly one call site)', (sellerCallTsx.match(/setSellerPositionInput\(/g) || []).length, 1);
  check('setCurrentOfferInput is called ONLY from its own input onChange and Cancel (never a derived/computed value)', (sellerCallTsx.match(/setCurrentOfferInput\(/g) || []).length, 2);
  check('every setCurrentOfferInput call site sets it from the raw input event or to "" (Cancel), never a number expression', !/setCurrentOfferInput\([^)"]*\.(target|value)[^)]*\+|setCurrentOfferInput\(\s*\d/.test(sellerCallTsx), true);
  check('Seller Position input carries the negotiation-panel testid', /data-testid="negotiation-seller-position-input"/.test(sellerCallTsx), true);
  check('Current Offer input carries the negotiation-panel testid', /data-testid="negotiation-current-offer-input"/.test(sellerCallTsx), true);
}

// ============================================================
// Jess Gate, 2026-09-06, item 1: no fabricated operator identity anywhere
// on this page. `attemptOverride` must be called with `operator: null`
// (this codebase has no authenticated-operator concept at all), never a
// hardcoded person's name.
// ============================================================
{
  check('page never hardcodes "Brad Thompson" (or any other specific name) as the negotiation override operator', /Brad Thompson/.test(sellerCallTsx), false);
  check('page passes operator: null to attemptOverride -- no fabricated identity', /attemptOverride\(\{[\s\S]{0,200}operator:\s*null/.test(sellerCallTsx), true);
  check('the acknowledged-override banner renders a truthful fallback when operator is null, never blank or a guessed name', /negotiationOverride!\.operator\s*\?\?\s*"an unidentified session actor/.test(sellerCallTsx), true);
}

// ============================================================
// Jess Gate, 2026-09-06, item 2: Seller Position and Current Offer reject
// negative/zero/malformed/NaN/infinite values before they reach
// economics, distinguish empty from invalid with truthful feedback, and
// preserve formatted positive entry.
// ============================================================
{
  check('page imports parseAcquisitionPriceInput from seller-call-negotiation (validation is not reimplemented on the page)', /parseAcquisitionPriceInput/.test(sellerCallTsx) && /from "\.\.\/lib\/seller-call-negotiation"/.test(sellerCallTsx), true);
  check('page no longer defines its own parseMoneyInput (the pre-Jess-Gate parser that let zero/negative through)', /function parseMoneyInput/.test(sellerCallTsx), false);
  check('sellerPosition is null for both empty AND invalid input -- never a non-positive/NaN/infinite value reaches buildDealBarCells', /const sellerPosition = sellerPositionParsed\.kind === "value" \? sellerPositionParsed\.value : null/.test(sellerCallTsx), true);
  check('currentOffer is null for both empty AND invalid input -- never a non-positive/NaN/infinite value reaches computeNegotiationPosition or computeExpectedSpread', /const currentOffer = currentOfferParsed\.kind === "value" \? currentOfferParsed\.value : null/.test(sellerCallTsx), true);
  check('page renders DISTINCT truthful feedback for an invalid Seller Position (not merely "not yet entered")', /data-testid="negotiation-seller-position-error"[\s\S]{0,80}sellerPositionParsed\.reason|sellerPositionParsed\.reason[\s\S]{0,80}data-testid="negotiation-seller-position-error"/.test(sellerCallTsx), true);
  check('page renders DISTINCT truthful feedback for an invalid Current Offer (not merely "not yet entered")', /data-testid="negotiation-current-offer-error"[\s\S]{0,80}currentOfferParsed\.reason|currentOfferParsed\.reason[\s\S]{0,80}data-testid="negotiation-current-offer-error"/.test(sellerCallTsx), true);
  check('the invalid-feedback message renders ONLY when kind is "invalid", never for "empty" (the two are visibly distinguished)', /sellerPositionParsed\.kind === "invalid"/.test(sellerCallTsx) && /currentOfferParsed\.kind === "invalid"/.test(sellerCallTsx), true);
}

// ============================================================
// Jess Gate, 2026-09-06, item 3: the stale header claiming INV-51
// negotiation remains out of scope must be corrected.
// ============================================================
{
  check('page header no longer claims Negotiation (INV-51) remains out of scope (that work is THIS page)', /Negotiation \(INV-51\)[\s\S]{0,40}remain out\s*\n?\s*\* of scope/.test(sellerCallTsx), false);
  check('page header now describes B8-08 / INV-51 as implemented on this page, not deferred', /B8-08.{0,40}INV-51/.test(sellerCallTsx), true);
  check('page header still correctly names the standalone calculator (INV-52) as the one remaining out-of-scope item', /standalone calculator \(INV-52\)/.test(sellerCallTsx), true);
}

// ============================================================
// B8-08 / INV-51: Expected Spread now receives the REAL Current Offer,
// not a hardcoded null -- the exact line the pre-INV-51 comment predicted
// would change.
// ============================================================
{
  check('page passes the real currentOffer into computeExpectedSpread\'s referencePrice', /referencePrice:\s*currentOffer\s*\}/.test(sellerCallTsx), true);
  check('page never hardcodes referencePrice to null anymore (that was the pre-INV-51 waiting state)', /referencePrice:\s*null\s*\}/.test(sellerCallTsx), false);
}

// ============================================================
// B8-08 / INV-51: Target/Max/Spread are consumed from board8, never
// recomputed by the negotiation feature. No second Max Supported Offer
// or Target Acquisition Price formula anywhere on this page.
// ============================================================
{
  check('page imports computeNegotiationPosition/attemptOverride/isOverrideCurrent/requiresOverrideDecision from seller-call-negotiation', /from "\.\.\/lib\/seller-call-negotiation"/.test(sellerCallTsx), true);
  check('page does not declare its own computeNegotiationPosition', /\b(function|const)\s+computeNegotiationPosition\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not declare its own attemptOverride', /\b(function|const)\s+attemptOverride\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page still never reimplements the 25%/$5,000 Target/Max formula (negotiation feature added no new occurrence)', /[*]\s*0\.25|0\.25\s*[*]/.test(sellerCallTsx), false);
  check('negotiation position is derived from board8.maxSupportedOffer via computeNegotiationPosition, not a second Max calculation', /computeNegotiationPosition\(\{\s*currentOffer,\s*board8\s*\}\)/.test(sellerCallTsx), true);
}

// ============================================================
// B8-08 / INV-51: the above-Max override is a DIFFERENT concept from
// offer-readiness.ts's HumanAction -- `readiness`'s own humanAction must
// remain exactly `{ kind: "none" }`, unchanged, and the negotiation
// override must never be threaded into buildOfferReadinessInputs.
// ============================================================
{
  // humanAction is hardcoded inside seller-call-readiness-inputs.ts
  // itself (not the page) -- the correct proof is that the PAGE never
  // overrides it with a competing assignment of its own.
  check('page never assigns readiness.humanAction itself (stays whatever buildOfferReadinessInputs already hardcodes)', /humanAction:/.test(sellerCallTsxNoComments), false);
  const readinessInputsSrc = fs.readFileSync(path.join(APP, 'src/lib/seller-call-readiness-inputs.ts'), 'utf8');
  check('seller-call-readiness-inputs.ts still hardcodes humanAction to none, unchanged by the negotiation feature', /humanAction:\s*\{\s*kind:\s*"none"\s*\}/.test(readinessInputsSrc), true);
  check('NegotiationOverride is never passed into buildOfferReadinessInputs (a distinct concept from Offer Readiness evidence)', /buildOfferReadinessInputs\(\{[\s\S]{0,400}negotiationOverride/.test(sellerCallTsx), false);
}

// ============================================================
// B8-08 / INV-51: the four bounded actions exist, are correctly gated,
// and Keep Negotiating / Review Assumptions / Cancel touch no economics
// state (board8, readiness, expectedSpread setters do not exist to call --
// proven structurally by confirming none of the three handlers calls any
// board8/readiness-mutating function, since none exists on this page at
// all: board8/readiness/expectedSpread are useMemo-derived, never
// setState-backed).
// ============================================================
{
  check('page renders the Keep Negotiating action', /data-testid="negotiation-action-keep-negotiating"/.test(sellerCallTsx), true);
  check('page renders the Review Assumptions action, linking to the existing Underwriting surface', /data-testid="negotiation-action-review-assumptions"[\s\S]{0,120}to=\{`\/contacts\/\$\{contactId\}\/underwriting`\}|to=\{`\/contacts\/\$\{contactId\}\/underwriting`\}[\s\S]{0,200}data-testid="negotiation-action-review-assumptions"/.test(sellerCallTsx), true);
  check('page renders the Cancel action', /data-testid="negotiation-action-cancel"/.test(sellerCallTsx), true);
  check('page renders the Override & Continue action', /data-testid="negotiation-action-override-continue"/.test(sellerCallTsx), true);
  check('Override & Continue is disabled unless BOTH acknowledged AND a non-empty reason are present', /disabled=\{!overrideAcknowledged \|\| overrideReasonDraft\.trim\(\) === ""\}/.test(sellerCallTsx), true);
  check('page renders an explicit acknowledgement checkbox before Override & Continue can be used', /data-testid="negotiation-override-acknowledge-checkbox"/.test(sellerCallTsx), true);
  check('page renders a reason input required before Override & Continue can be used', /data-testid="negotiation-override-reason-input"/.test(sellerCallTsx), true);
  check('handleKeepNegotiating only sets warningDismissed -- touches no board8/readiness/expectedSpread state (none exists to touch: all three are useMemo, not useState)', /function handleKeepNegotiating\(\) \{\s*setWarningDismissed\(true\);\s*\}/.test(sellerCallTsx), true);
  check('handleCancelAboveMax touches no economics figure -- only clears negotiation input/draft/override state', /function handleCancelAboveMax\(\) \{[\s\S]{0,400}\n  \}/.test(sellerCallTsx) && !/function handleCancelAboveMax\(\)[\s\S]{0,400}set(Board8|Readiness|ExpectedSpread)/.test(sellerCallTsx), true);
}

// ============================================================
// B8-08 / INV-51: no hard block on entering an above-Max Current Offer
// (the input is never disabled), and no autonomous/hidden progression
// (an above-Max position always renders SOME visible state -- warning,
// dismissed-but-named, or acknowledged -- never nothing).
// ============================================================
{
  const negotiationInputBlock = sellerCallTsx.slice(sellerCallTsx.indexOf('data-testid="negotiation-current-offer-input"'), sellerCallTsx.indexOf('data-testid="negotiation-current-offer-input"') + 400);
  check('the Current Offer input itself is never disabled (no hard block on typing an above-Max value)', /disabled/.test(negotiationInputBlock), false);
  check('a dismissed above-Max warning still names the exact amount above Max (never fully silent)', /Still \{money\(negotiationPosition\.amountAboveMax\)\} above Max/.test(sellerCallTsx), true);
  check('an acknowledged override still names the amount that was above Max (never silently hidden once granted)', /Overridden — proceeding \{money\(negotiationOverride!\.amountAboveMaxAtOverride\)\} above Max/.test(sellerCallTsx), true);
}

// ============================================================
// Validation item 6/7 wiring: Expected Spread is computed with the
// explicit "current_offer" reference kind. B8-08 / INV-51 superseded the
// pre-INV-51 "referencePrice is always null" behavior this block used to
// assert -- that proof now lives in the dedicated INV-51 checks above
// ("page passes the real currentOffer..." / "page never hardcodes
// referencePrice to null anymore"), which also confirm no invented value
// (referencePrice is fed from operator-entered state, not a literal).
// ============================================================
{
  check('page computes Expected Spread with referenceKind "current_offer"', /referenceKind:\s*"current_offer"/.test(sellerCallTsx), true);
}

// ============================================================
// B8-07 / INV-50: Repairs and ARV/Comps compact entry points reuse
// Board #6/#7's existing systems, never a second engine.
// ============================================================
{
  check('page imports buildOfferReadinessInputs from seller-call-readiness-inputs', /import \{ buildOfferReadinessInputs \} from "\.\.\/lib\/seller-call-readiness-inputs"/.test(sellerCallTsx), true);
  check('page does not declare its own buildOfferReadinessInputs', /\b(function|const)\s+buildOfferReadinessInputs\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);

  check('page renders a dedicated Repairs entry panel', /data-testid="repairs-entry-panel"/.test(sellerCallTsx), true);
  check('Repairs panel links to the existing Underwriting surface (Estimate Repairs)', /data-testid="seller-call-estimate-repairs-link"[\s\S]{0,40}to=\{`\/contacts\/\$\{contactId\}\/underwriting`\}|to=\{`\/contacts\/\$\{contactId\}\/underwriting`\}[\s\S]{0,120}data-testid="seller-call-estimate-repairs-link"/.test(sellerCallTsx), true);

  check('page renders a dedicated ARV & Comps entry panel', /data-testid="arv-comps-entry-panel"/.test(sellerCallTsx), true);
  check('ARV panel offers Get Comps, reusing handoffToPropStream directly', /data-testid="seller-call-get-comps"[\s\S]{0,120}onClick=\{handleGetComps\}|onClick=\{handleGetComps\}[\s\S]{0,120}data-testid="seller-call-get-comps"/.test(sellerCallTsx), true);
  check('ARV panel offers a View / Import Comps link to the existing Underwriting surface', /data-testid="seller-call-view-import-comps"/.test(sellerCallTsx), true);

  check('page imports the PropStream handoff from the existing propstream module', /from "\.\.\/lib\/propstream"/.test(sellerCallTsx), true);
  check('page does not store any PropStream credential (no password/username field)', !/password|username/i.test(sellerCallTsx), true);

  // No second repair or ARV/comp engine: none of Board #6/#7's actual
  // calculation/classification function names appear anywhere on this page.
  const forbiddenEngineCalls = [
    'computeRepairEstimate', 'operatorEstimate', 'classifyComp',
    'reconcileAcceptedCompArv', 'BOARD_7_ARV_POLICY',
  ];
  const foundEngineCalls = forbiddenEngineCalls.filter((t) => sellerCallTsx.indexOf(t) !== -1);
  check('page contains no Board #6 repair-calculation or Board #7 comp/ARV-engine call', foundEngineCalls, []);

  // repairsCondition is now derived from real evidence (via
  // buildOfferReadinessInputs), not the old hardcoded "UNKNOWN" literal
  // for that specific field -- the page must not assign it directly.
  check('page does not hardcode repairsCondition itself (delegates to buildOfferReadinessInputs)', /repairsCondition:\s*"UNKNOWN"/.test(sellerCallTsx), false);
}

// ============================================================
// Jess Gate correction, 2026-09-05: ARV evidence must reach Offer
// Readiness via the EXISTING Board #7 approval ledger (arv-persist.ts),
// read through the strict arv-approval-note.ts parser -- not a new
// carrier, not an inference from the ARV dollar amount, and not a second
// note-parsing implementation on the page itself.
// ============================================================
{
  check('page imports latestArvApprovalForOpportunity from arv-approval-note', /import \{ latestArvApprovalForOpportunity, matchingArvApprovalForOpportunity \} from "\.\.\/lib\/arv-approval-note"/.test(sellerCallTsx), true);
  check('page imports matchingArvApprovalForOpportunity from arv-approval-note (the amount-matched, usable-for-readiness read)', /matchingArvApprovalForOpportunity/.test(sellerCallTsx), true);
  check('page does not declare its own latestArvApprovalForOpportunity', /\b(function|const)\s+latestArvApprovalForOpportunity\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not declare its own matchingArvApprovalForOpportunity', /\b(function|const)\s+matchingArvApprovalForOpportunity\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not reimplement note parsing (no local parseArvApprovalNote function)', /\b(function|const)\s+parseArvApprovalNote\s*[=(]/.test(sellerCallTsx), false);
  check('page never hardcodes arv to null in the readiness call (the exact regression Jess Gate found)', /arv:\s*null,?\s*\n/.test(sellerCallTsx), false);
  check('page passes arvEvidenceState through to buildOfferReadinessInputs using the AMOUNT-MATCHED approval, not the unmatched latest one', /arvEvidenceState:\s*matchedArvApproval\?\.evidenceState/.test(sellerCallTsx), true);
  check('page reads the ledger note\'s evidenceState field, never an ARV dollar amount, to set it', /matchedArvApproval\.evidenceState/.test(sellerCallTsx), true);
}

// ============================================================
// Jess Re-Gate correction, 2026-09-05 (2nd round): the latest ledger
// entry must additionally match the CURRENT authoritative ARV amount
// before its evidence is usable -- a stale entry must never lend
// evidence to a different, later ARV amount. The page must call the
// amount-matching function with `screen.known.arv` as the current
// amount, not merely the recency-only lookup.
// ============================================================
{
  check('page derives a separate matchedArvApproval from matchingArvApprovalForOpportunity, passed the CURRENT known ARV amount', /matchingArvApprovalForOpportunity\(notes,\s*screen\.opportunity\.id,\s*screen\.known\.arv\)/.test(sellerCallTsx), true);
  check('page also derives latestArvLedgerEntry (recency-only, no amount check) for truthful UI text, kept separate from the amount-matched one used for readiness', /latestArvApprovalForOpportunity\(notes,\s*screen\.opportunity\.id\)/.test(sellerCallTsx), true);
  check('page does not pass the unmatched latestArvLedgerEntry into buildOfferReadinessInputs (only the amount-matched one is usable evidence)', /arvEvidenceState:\s*latestArvLedgerEntry/.test(sellerCallTsx), false);
  check('ARV panel text distinguishes "no ledger entry" from "entry exists but does not match this amount" (truthful provenance, not a blanket message)', /does not match this amount; evidence withheld/.test(sellerCallTsx), true);
}

// ============================================================
// Jess Gate correction, 2026-09-05: repairsCondition must be SUPPORTED
// only when the resolved value provably passed IAOS's approval gate
// (Contact-side `estimated_repairs`), not merely because a number is
// present on file (which could be the un-gated Opportunity-side
// `repair_estimate`, B8-02's own finding that it has no writer).
// ============================================================
{
  check('page derives repairsSourceIsApprovalGated from oppValues.repairs.kind, not from known.repairs presence', /repairsSourceIsApprovalGated\s*=\s*oppValues\.repairs\.kind\s*!==\s*"value"/.test(sellerCallTsx), true);
  check('page passes repairsApprovalProven through to buildOfferReadinessInputs', /repairsApprovalProven:\s*pipeline\.repairsSourceIsApprovalGated/.test(sellerCallTsx), true);
  check('page no longer derives repairsCondition from known.repairs !== null alone (that logic now lives only in seller-call-readiness-inputs.ts)', /repairsCondition\s*:\s*Board8EvidenceLevel\s*=\s*args\.known\.repairs\s*!==\s*null\s*\?\s*"SUPPORTED"/.test(sellerCallTsx), false);
  check('Repairs panel text distinguishes an approval-gated total from an unverified one', /repairsSourceIsApprovalGated\s*\?\s*`Approved:/.test(sellerCallTsx), true);
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
