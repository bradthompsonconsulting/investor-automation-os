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

const FLOOR = 231;
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
  check('page renders a dedicated Suggested Next Question panel (data-testid unchanged, internal name only)', /data-testid="next-best-question-panel"/.test(sellerCallTsx), true);
  // Jess Gate correction, INV-69 (2026-09-08) -- label-only: the visible
  // heading is "Suggested Next Question" (was "Next Best Question"); the
  // data-testid above and every symbol below (nextBestQuestion.*,
  // computeNextBestQuestion) are unchanged.
  check('the operator-visible label is "Suggested Next Question"', /Suggested Next Question/.test(sellerCallTsx), true);
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
// No Production mutation beyond the exact three sanctioned writes B8-10 /
// INV-53 authorizes. B8-08 / INV-51 defines local editable session state
// for Current Offer and Seller Position (superseding the pre-INV-51 "no
// local input" check this file used to assert). B8-10 / INV-53 is this
// page's FIRST write of any kind -- proven bounded below: exactly
// `ghl.notes.create`, `ghl.contacts.setLastCallAttempt`, and
// `ghl.contacts.setCallbackDatetime` (the last ONLY via the unmodified
// `scheduleCallbackGated`, never called directly), never Board 6/7's
// underwriting/repairs/ARV writers, never Board 4's cold-outreach
// disposition fields.
// ============================================================
{
  // Checked against comment-stripped source: this page's OWN header
  // comment names every one of these by name to EXPLAIN why they are
  // never called from here, which would false-positive a plain
  // source-text substring check (same class of mistake as
  // arv-approval-note.ts's ghl.notes.list discussion earlier this board).
  const forbiddenAlways = [
    'setApprovedArv', 'setEstimatedRepairs', 'saveUnderwritingFields', 'setAskingPrice',
    'setCallDisposition', 'setCallRouting', 'setDispositionAt',
    'iaos_call_disposition', 'iaos_call_routing', 'iaos_disposition_at',
  ];
  const foundForbidden = forbiddenAlways.filter((t) => sellerCallTsxNoComments.indexOf(t) !== -1);
  check('page never calls any writer outside the three sanctioned writes (no underwriting/repairs/ARV write, no Board 4 disposition field)', foundForbidden, []);
  check('page never calls ghl.contacts.setCallbackDatetime directly (only through the unmodified scheduleCallbackGated)', sellerCallTsxNoComments.indexOf('ghl.contacts.setCallbackDatetime') === -1, true);
  check('page imports scheduleCallbackGated from callbackWrite.ts rather than reimplementing the gated callback sequence', /import \{ scheduleCallbackGated \} from "\.\.\/lib\/callbackWrite"/.test(sellerCallTsx), true);
  check('page reads getDetail, listPipeline, underwriting.policy, and notes.list (all pre-existing read calls)', {
    getDetail: sellerCallTsx.indexOf('ghl.contacts.getDetail') !== -1,
    listPipeline: sellerCallTsx.indexOf('ghl.opportunities.listPipeline') !== -1,
    policy: sellerCallTsx.indexOf('ghl.underwriting.policy') !== -1,
    notesList: sellerCallTsx.indexOf('ghl.notes.list') !== -1,
  }, { getDetail: true, listPipeline: true, policy: true, notesList: true });
  check('page writes exactly ghl.notes.create and ghl.contacts.setLastCallAttempt directly, and no other direct write', {
    notesCreate: sellerCallTsx.indexOf('ghl.notes.create') !== -1,
    setLastCallAttempt: sellerCallTsx.indexOf('ghl.contacts.setLastCallAttempt') !== -1,
  }, { notesCreate: true, setLastCallAttempt: true });
}

// ============================================================
// B8-08 / INV-51: Current Offer and Seller Position are operator-entered
// session state -- IAOS invents/defaults neither, and neither is a GHL
// carrier.
// ============================================================
{
  check('sellerPositionInput state is initialized empty, never from a GHL/derived value', /const \[sellerPositionInput, setSellerPositionInput\] = useState\(""\)/.test(sellerCallTsx), true);
  check('currentOfferInput state is initialized empty, never from a GHL/derived value -- IAOS invents no opening offer', /const \[currentOfferInput, setCurrentOfferInput\] = useState\(""\)/.test(sellerCallTsx), true);
  // Jess Gate/Re-Gate corrections, 2026-09-06 added THREE further legitimate
  // call sites to each setter -- the deal-scoped resume-hydration effect
  // below CLEARS both on every genuine opportunity switch, then RESTORES
  // whichever the current deal's own outcome snapshot names. Both are
  // PREVIOUSLY RECORDED operator values (or an explicit empty reset),
  // never an invented or computed one. The exact call-site counts and the
  // no-derived-expression check that follows are what still distinguish
  // "restore what a human already entered for THIS deal" from "IAOS
  // computed a value, or carried another deal's value forward."
  check('setSellerPositionInput is called from exactly three sites: its own input onChange, resume-clear, and resume-restore', (sellerCallTsx.match(/setSellerPositionInput\(/g) || []).length, 3);
  check('setCurrentOfferInput is called from exactly four sites: its own input onChange, Cancel, resume-clear, and resume-restore (never a derived/computed economics value)', (sellerCallTsx.match(/setCurrentOfferInput\(/g) || []).length, 4);
  check('every setCurrentOfferInput call site sets it from the raw input event, "" (Cancel/resume-clear), or the resume decision\'s own restored value -- never a number literal or board8/expectedSpread-derived expression', !/setCurrentOfferInput\([^)"]*\.(target|value)[^)]*\+|setCurrentOfferInput\(\s*\d|setCurrentOfferInput\([^)]*board8|setCurrentOfferInput\([^)]*expectedSpread/.test(sellerCallTsx), true);
  check('Seller Position input carries the negotiation-panel testid', /data-testid="negotiation-seller-position-input"/.test(sellerCallTsx), true);
  check('Current Offer input carries the negotiation-panel testid', /data-testid="negotiation-current-offer-input"/.test(sellerCallTsx), true);
}

// ============================================================
// Jess Re-Gate correction, 2026-09-06: resume hydration/clearing is
// SCOPED TO THE SELECTED OPPORTUNITY, never merely the contact. The
// actual clear/restore DECISION (delayed selection, switching deals,
// rerender-safety, null-stays-empty) is proven deterministically in
// test-seller-call-resume.cjs against the extracted pure function -- this
// section only proves the PAGE actually wires that function in, applies
// its result in the right order (clear, then restore), and touches no
// second Target/Max path.
// ============================================================
{
  check('page imports resolveResumeHydration from the extracted, independently-tested resume module, never reimplementing the decision inline', /import \{ resolveResumeHydration, type DealHydrationRef \} from "\.\.\/lib\/seller-call-resume"/.test(sellerCallTsx), true);
  check('page does not declare its own resolveResumeHydration', /\b(function|const)\s+resolveResumeHydration\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('the deal identity fed to the resume decision is screen.opportunity.id when resolved, null otherwise -- the SAME identity latestOutcome itself is scoped to (PB-D55), never merely contactId', /const currentDealId = \(screen\.state === "resolved" \|\| screen\.state === "unresolved"\) \? screen\.opportunity\.id : null/.test(sellerCallTsx), true);
  check('the resume ref is keyed by opportunity identity (dealId), not contactId', /const dealHydrationRef = useRef<DealHydrationRef>\(\{ dealId: null, hydrated: false \}\)/.test(sellerCallTsx), true);
  check('the resume effect passes the CURRENT live inputs and the CURRENT ref into resolveResumeHydration every render (the pure function, not the page, decides what changes)', /resolveResumeHydration\(\{[\s\S]{0,300}prevRef: dealHydrationRef\.current,[\s\S]{0,300}currentDealId,[\s\S]{0,300}loading,[\s\S]{0,300}sellerPositionInput,[\s\S]{0,300}currentOfferInput,/.test(sellerCallTsx), true);
  check('the page stores the decision\'s nextRef back onto the ref every render (so the NEXT render sees this render\'s outcome)', /dealHydrationRef\.current = decision\.nextRef/.test(sellerCallTsx), true);
  check('the page clears every deal-specific negotiation value (Seller Position, Current Offer, and the above-Max override/draft/warning state) when decision.clear is true, BEFORE either restore field is applied', /if \(decision\.clear\) \{\s*setSellerPositionInput\(""\);\s*setCurrentOfferInput\(""\);\s*setNegotiationOverride\(null\);\s*setOverrideReasonDraft\(""\);\s*setOverrideAcknowledged\(false\);\s*setOverrideActionError\(null\);\s*setWarningDismissed\(false\);\s*\}/.test(sellerCallTsxNoComments), true);
  check('the page applies decision.restoreSellerPosition only when non-null, verbatim -- never re-deciding whether to restore', /if \(decision\.restoreSellerPosition !== null\) \{\s*setSellerPositionInput\(decision\.restoreSellerPosition\);\s*\}/.test(sellerCallTsxNoComments), true);
  check('the page applies decision.restoreCurrentOffer only when non-null, verbatim -- never re-deciding whether to restore', /if \(decision\.restoreCurrentOffer !== null\) \{\s*setCurrentOfferInput\(decision\.restoreCurrentOffer\);\s*\}/.test(sellerCallTsxNoComments), true);
  check('the restore calls are positioned AFTER the clear block in source order (clear, then restore, never the reverse)', sellerCallTsxNoComments.indexOf('if (decision.clear)') !== -1 && sellerCallTsxNoComments.indexOf('if (decision.clear)') < sellerCallTsxNoComments.indexOf('if (decision.restoreSellerPosition'), true);
  check('page imports useRef from react (required for the per-deal hydration guard)', /import \{ useEffect, useMemo, useRef, useState \} from "react"/.test(sellerCallTsx), true);
  check('restored Current Offer needs no separate Expected Spread wiring -- it flows through the SAME computeExpectedSpread useMemo already keyed on currentOffer', /computeExpectedSpread\(\{ endBuyerMaxPrice: board8\.endBuyerMaxPrice, referenceKind: "current_offer", referencePrice: currentOffer \}\)/.test(sellerCallTsx), true);
  check('Target and Max remain sourced from board8 alone -- resume hydration adds no second Target/Max path', /[*]\s*0\.25|0\.25\s*[*]/.test(sellerCallTsx), false);
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
// B8-08 / INV-51, corrected B8-13 / INV-68: the above-Max negotiation
// override is a DIFFERENT concept from offer-readiness.ts's HumanAction,
// and the two must never merge -- the negotiation override must never be
// threaded into buildOfferReadinessInputs. B8-13 gives Offer Ready its OWN
// real humanAction (durable carrier, `readinessHumanAction`); it is
// `negotiationOverride` specifically that stays excluded, not `humanAction`
// itself.
// ============================================================
{
  check('page DOES assign a real readiness.humanAction, from its own B8-13 durable carrier, never from negotiationOverride', /humanAction:\s*readinessHumanAction/.test(sellerCallTsxNoComments), true);
  const readinessInputsSrc = fs.readFileSync(path.join(APP, 'src/lib/seller-call-readiness-inputs.ts'), 'utf8');
  check('seller-call-readiness-inputs.ts no longer hardcodes humanAction to none (B8-13 threads a real caller-supplied value)', /humanAction:\s*\{\s*kind:\s*"none"\s*\}/.test(readinessInputsSrc), false);
  check('NegotiationOverride is never passed into buildOfferReadinessInputs (a distinct concept from Offer Readiness evidence)', /buildOfferReadinessInputs\(\{[\s\S]{0,400}negotiationOverride/.test(sellerCallTsx), false);
}

// ============================================================
// B8-13 / INV-68 — the four Offer Readiness determination carriers are
// actually wired: imported from the new module (never reimplemented),
// fed into buildOfferReadinessInputs as real booleans/humanAction, and
// each has a real UI control writing through ghl.notes.create.
// ============================================================
{
  check('page imports the B8-13 carriers module, never reimplementing its parsing', /from "\.\.\/lib\/seller-call-readiness-carriers"/.test(sellerCallTsx), true);
  check('propertyIdentityConfirmed is derived from currentPropertyIdentityConfirmationForOpportunity, not a second confirmation state', /propertyIdentityConfirmed:\s*propertyIdentityConfirmation !== null/.test(sellerCallTsxNoComments), true);
  check('transactionAssumptionsRecorded is derived from latestTransactionAssumptionsForOpportunity, not a second record', /transactionAssumptionsRecorded:\s*transactionAssumptionsRecord !== null/.test(sellerCallTsxNoComments), true);
  check('sellerPricePositionRecorded is derived from latestSellerPricePositionForOpportunity, not a second record', /sellerPricePositionRecorded:\s*sellerPricePositionRecord !== null/.test(sellerCallTsxNoComments), true);
  check('property identity confirmation is stale-checked against the CURRENT displayed address (formatAddress(contact)), never a stored address', /currentPropertyIdentityConfirmationForOpportunity\(notes, screen\.opportunity\.id, formatAddress\(contact\)\)/.test(sellerCallTsxNoComments), true);

  check('page renders the property identity panel', /data-testid="property-identity-panel"/.test(sellerCallTsx), true);
  check('page renders the transaction assumptions panel', /data-testid="transaction-assumptions-panel"/.test(sellerCallTsx), true);
  check('page renders the seller price position panel', /data-testid="seller-price-position-panel"/.test(sellerCallTsx), true);
  check('page renders the Offer Readiness human-action panel', /data-testid="readiness-human-action-panel"/.test(sellerCallTsx), true);

  check('handleConfirmPropertyIdentity writes through ghl.notes.create using formatPropertyIdentityConfirmationNote', /formatPropertyIdentityConfirmationNote\(\{[\s\S]{0,200}await ghl\.notes\.create/.test(sellerCallTsxNoComments), true);
  check('handleSaveTransactionAssumptions refuses a genuinely blank field rather than silently allowing it', /Each item needs a value, or must be explicitly marked None/.test(sellerCallTsx), true);
  check('handleRecordSellerPricePosition reuses parseAcquisitionPriceInput for the price path, never a second parser', /parseAcquisitionPriceInput\(sellerPricePositionInput\)/.test(sellerCallTsxNoComments), true);
  check('a documented refusal is a first-class recording path, not merely an empty price', /handleRecordSellerPricePosition\("refused"\)/.test(sellerCallTsx), true);

  check('handleReadinessDecision refuses an empty override reason before any write is attempted', /kind === "overridden" && reason === ""/.test(sellerCallTsxNoComments), true);
  check('Approve is only ever attempted when readiness.status is already OFFER_READY (never elevates)', /kind === "approved" && readiness\.status !== "OFFER_READY"/.test(sellerCallTsxNoComments), true);
  check('handleReadinessDecision writes through formatReadinessHumanActionNote, the same carrier as everywhere else', /formatReadinessHumanActionNote\(/.test(sellerCallTsxNoComments), true);

  check('readiness now threads propertyIdentityConfirmed/transactionAssumptionsRecorded/sellerPricePositionRecorded/humanAction into buildOfferReadinessInputs together', /propertyIdentityConfirmed:[\s\S]{0,400}humanAction:\s*readinessHumanAction/.test(sellerCallTsxNoComments), true);
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
  // B8-11 / INV-54 added `overrideWriteBusy` to the disabled condition --
  // the confirm button must also disable while the durable ledger write
  // is outstanding, preventing a double-submit.
  check('Override & Continue is disabled unless BOTH acknowledged AND a non-empty reason are present, AND no write is already in flight', /disabled=\{!overrideAcknowledged \|\| overrideReasonDraft\.trim\(\) === "" \|\| overrideWriteBusy\}/.test(sellerCallTsx), true);
  check('page renders an explicit acknowledgement checkbox before Override & Continue can be used', /data-testid="negotiation-override-acknowledge-checkbox"/.test(sellerCallTsx), true);
  check('page renders a reason input required before Override & Continue can be used', /data-testid="negotiation-override-reason-input"/.test(sellerCallTsx), true);
  check('handleKeepNegotiating only sets warningDismissed -- touches no board8/readiness/expectedSpread state (none exists to touch: all three are useMemo, not useState)', /function handleKeepNegotiating\(\) \{\s*setWarningDismissed\(true\);\s*\}/.test(sellerCallTsx), true);
  check('handleCancelAboveMax touches no economics figure -- only clears negotiation input/draft/override state', /function handleCancelAboveMax\(\) \{[\s\S]{0,400}\n  \}/.test(sellerCallTsx) && !/function handleCancelAboveMax\(\)[\s\S]{0,400}set(Board8|Readiness|ExpectedSpread)/.test(sellerCallTsx), true);
}

// ============================================================
// B8-11 / INV-54: the above-Max override is now DURABLE -- an append-only
// GHL note, written through the same sanctioned `ghl.notes.create()` this
// page already uses for the call-outcome ledger, never a fourth write
// class, and never confused with Offer Readiness's DIFFERENT (and
// unauthorized-to-persist) humanAction/APPROVED/OVERRIDDEN concept.
// ============================================================
{
  check('page imports formatNegotiationOverrideNote and latestNegotiationOverrideNoteForOpportunity from the dedicated override-ledger module, never reimplementing them', /from "\.\.\/lib\/seller-call-negotiation-override-note"/.test(sellerCallTsx) && /formatNegotiationOverrideNote/.test(sellerCallTsx) && /latestNegotiationOverrideNoteForOpportunity/.test(sellerCallTsx), true);
  check('page does not declare its own formatNegotiationOverrideNote', /\b(function|const)\s+formatNegotiationOverrideNote\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not declare its own latestNegotiationOverrideNoteForOpportunity', /\b(function|const)\s+latestNegotiationOverrideNoteForOpportunity\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page derives latestNegotiationOverrideNote scoped to screen.opportunity.id, the SAME PB-D55 identity every other note-ledger read on this page uses', /latestNegotiationOverrideNoteForOpportunity\(notes,\s*screen\.opportunity\.id\)/.test(sellerCallTsx), true);

  check('handleOverrideAndContinue is async (a write now happens before state is set)', /async function handleOverrideAndContinue\(\)/.test(sellerCallTsx), true);
  check('the override confirm button awaits handleOverrideAndContinue rather than firing it synchronously', /onClick=\{\(\) => void handleOverrideAndContinue\(\)\}/.test(sellerCallTsx), true);
  // WRITE-THEN-SET ordering: attemptOverride validates first (unchanged),
  // then ghl.notes.create is awaited, and setNegotiationOverride appears
  // ONLY after that await -- never before it, and never on the catch path.
  const handleOverrideBody = sellerCallTsxNoComments.slice(
    sellerCallTsxNoComments.indexOf('async function handleOverrideAndContinue'),
    sellerCallTsxNoComments.indexOf('async function handleOverrideAndContinue') + 1800,
  );
  check('handleOverrideAndContinue validates via the UNCHANGED attemptOverride before writing anything', /attemptOverride\(\{/.test(handleOverrideBody), true);
  check('handleOverrideAndContinue writes through ghl.notes.create (the same sanctioned write the outcome ledger uses, never a fourth write class)', /await ghl\.notes\.create\(contactId,\s*note\)/.test(handleOverrideBody), true);
  check('setNegotiationOverride is called AFTER the ghl.notes.create await, never before it (durable-then-visible, never the reverse)', handleOverrideBody.indexOf('await ghl.notes.create(contactId, note)') < handleOverrideBody.indexOf('setNegotiationOverride(result.override)'), true);
  check('a successful override write is appended to local notes state immediately (no refetch required for resume to reflect it), mirroring handleRecordOutcome\'s own convention', /setNotes\(\(prev\) => \[\.\.\.\(prev \?\? \[\]\), \{ id: `local-\$\{Date\.now\(\)\}`, body: note, dateAdded: result\.override\.at \}\]\)/.test(sellerCallTsx), true);
  check('a failed override write surfaces a truthful, explicit error via overrideActionError and does NOT set negotiationOverride (no unapproved state shown as granted)', /catch \(e: any\) \{\s*setOverrideActionError\(e\?\.message \?\? "Couldn't record this override/.test(sellerCallTsxNoComments), true);
  check('overrideWriteBusy is set true before the write and cleared in a finally block (cleared on both success and failure)', /setOverrideWriteBusy\(true\)/.test(sellerCallTsx) && /finally \{\s*setOverrideWriteBusy\(false\);\s*\}/.test(sellerCallTsxNoComments), true);

  check('the override note is scoped to screen.opportunity.id (PB-D55), the same identity every other write on this page is scoped to', /formatNegotiationOverrideNote\(\{\s*opportunityId:\s*screen\.opportunity\.id,/.test(sellerCallTsx), true);
  check('the override note carries operator/reason/at verbatim from attemptOverride\'s own result -- no fabricated identity, no recomputed reason', /operator:\s*result\.override\.operator,\s*reason:\s*result\.override\.reason,/.test(sellerCallTsx), true);

  // No new write class: still exactly ghl.notes.create + ghl.contacts.setLastCallAttempt
  // directly (plus scheduleCallbackGated's own unmodified setCallbackDatetime).
  // B8-13 / INV-68 adds four MORE call sites of this SAME sanctioned write
  // (property identity, transaction assumptions, seller price position,
  // the readiness human-action decision) -- more call sites, never a
  // fourth WRITE CLASS: nine total (two outcome-ledger + one negotiation
  // override + six B8-13 readiness carrier call sites -- confirm, withdraw,
  // save transaction assumptions, record seller price, the human-action
  // decision, and the Contract Ready checklist toggle -- Jess Gate,
  // 2026-09-08, added withdraw and the checklist toggle on top of B8-13's
  // original four), all still exactly ghl.notes.create.
  check('page still writes exactly ghl.notes.create and ghl.contacts.setLastCallAttempt directly -- every new B8-13/Jess-Gate write reuses the SAME sanctioned call, not a new one', {
    notesCreate: sellerCallTsx.indexOf('ghl.notes.create') !== -1,
    setLastCallAttempt: sellerCallTsx.indexOf('ghl.contacts.setLastCallAttempt') !== -1,
  }, { notesCreate: true, setLastCallAttempt: true });
  check(
    // Jess Gate correction, second round, 2026-09-08: a tenth call site --
    // the durable-invalidation write inside the write-on-detect effect --
    // is a real, deliberate addition, still exactly ghl.notes.create.
    'ghl.notes.create now has exactly ten call sites in the actual code, never an eleventh',
    (sellerCallTsxNoComments.match(/ghl\.notes\.create\(/g) || []).length, 10,
  );
  const forbiddenAlwaysForOverride = [
    'setApprovedArv', 'setEstimatedRepairs', 'saveUnderwritingFields', 'setAskingPrice',
    'setCallDisposition', 'setCallRouting', 'setDispositionAt',
    'iaos_call_disposition', 'iaos_call_routing', 'iaos_disposition_at',
  ];
  check('the override write introduces none of the forbidden writers/fields (same list the outcome ledger is already proven against)', forbiddenAlwaysForOverride.filter((t) => sellerCallTsxNoComments.indexOf(t) !== -1), []);

  // Never confused with Offer Readiness's DIFFERENT override concept --
  // this is the single most important boundary for this issue.
  check('the override-ledger write path never touches readiness.humanAction or ReadinessResult.effectiveStatus -- Offer Ready\'s own APPROVED/OVERRIDDEN axis remains untouched and unauthorized to persist', !/humanAction/.test(handleOverrideBody) && !/effectiveStatus/.test(handleOverrideBody), true);
}

// ============================================================
// B8-11 / INV-54: the durable override RESUMES the same way Seller
// Position/Current Offer already do -- one shared decision
// (`resolveResumeHydration`), never a second parallel state machine.
// ============================================================
{
  check('page derives latestNegotiationOverrideNote via useMemo, scoped and gated exactly like latestOutcome (notes loaded, screen resolved/unresolved)', /const latestNegotiationOverrideNote = useMemo\(\(\) => \{\s*if \(!notes \|\| !\(screen\.state === "resolved" \|\| screen\.state === "unresolved"\)\) return null;\s*return latestNegotiationOverrideNoteForOpportunity\(notes, screen\.opportunity\.id\);\s*\}, \[notes, screen\]\);/.test(sellerCallTsx), true);
  check('the resume effect passes latestOverrideNote and the LIVE currentOverride into resolveResumeHydration -- the SAME decision that already restores Seller Position/Current Offer, not a second effect', /latestOverrideNote:\s*latestNegotiationOverrideNote,[\s\S]{0,200}currentOverride:\s*negotiationOverride,/.test(sellerCallTsx), true);
  check('the resume effect depends on latestNegotiationOverrideNote (in addition to loading/currentDealId/latestOutcome)', /\}, \[loading, currentDealId, latestOutcome, latestNegotiationOverrideNote\]\);/.test(sellerCallTsx), true);
  check('a restored override is applied via setNegotiationOverride, reconstructing the acknowledgedAboveMax: true literal NegotiationOverride requires -- never persisted redundantly, never a second shape', /setNegotiationOverride\(\{ acknowledgedAboveMax: true, \.\.\.decision\.restoreOverride \}\)/.test(sellerCallTsx), true);
  check('restoring the override is gated on decision.restoreOverride !== null, the SAME non-null convention restoreSellerPosition/restoreCurrentOffer already use', /if \(decision\.restoreOverride !== null\) \{\s*setNegotiationOverride/.test(sellerCallTsxNoComments), true);
  check('the clear-on-identity-change block still resets negotiationOverride to null (unchanged from the Jess Re-Gate correction) -- B8-11 restores it AFTER that clear, in the same order clear-then-restore already established', sellerCallTsxNoComments.indexOf('if (decision.clear)') < sellerCallTsxNoComments.indexOf('if (decision.restoreOverride'), true);
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

// ============================================================
// B8-10 / INV-53: resume context + next objective, reading back through
// seller-call-outcome.ts's own reader, never recomputed.
// ============================================================
{
  check('page imports latestOutcomeNoteForOpportunity and attemptRecordOutcome from seller-call-outcome, never reimplementing them', /from "\.\.\/lib\/seller-call-outcome"/.test(sellerCallTsx) && /latestOutcomeNoteForOpportunity/.test(sellerCallTsx) && /attemptRecordOutcome/.test(sellerCallTsx), true);
  check('page does not declare its own latestOutcomeNoteForOpportunity', /\b(function|const)\s+latestOutcomeNoteForOpportunity\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page does not declare its own attemptRecordOutcome', /\b(function|const)\s+attemptRecordOutcome\s*[=(]/.test(sellerCallTsx.replace(/import[\s\S]*?from\s*"[^"]+";/g, '')), false);
  check('page renders a dedicated resume-context line', /data-testid="seller-call-resume-context"/.test(sellerCallTsx), true);
  check('page renders a dedicated next-objective line', /data-testid="seller-call-next-objective"/.test(sellerCallTsx), true);
  check('the resume line reads latestOutcome.snapshot fields verbatim, never recomputing Target/Max/Spread from ARV/Repairs itself', /latestOutcome\.snapshot\.targetAcquisitionPrice/.test(sellerCallTsx) && /latestOutcome\.snapshot\.maxSupportedOffer/.test(sellerCallTsx) && /latestOutcome\.snapshot\.expectedSpread/.test(sellerCallTsx), true);
}

// ============================================================
// B8-10 / INV-53: Agreement Reached is a SEPARATE surface from Offer
// Ready, never replacing ReadinessBadge, and is gated on the latest
// recorded outcome being `accept` -- never forced, never shown by
// default.
// ============================================================
{
  check('page still renders ReadinessBadge unconditionally on a resolved board8 (Offer Ready untouched by Agreement Reached)', /\{readiness \? <ReadinessBadge readiness=\{readiness\} \/> : null\}/.test(sellerCallTsx), true);
  check('page renders a dedicated Agreement Reached banner', /data-testid="agreement-reached-banner"/.test(sellerCallTsx), true);
  check('the Agreement Reached banner is gated on latestOutcome?.kind === "accept", never rendered unconditionally', /latestOutcome\?\.kind === "accept" \?[\s\S]{0,200}data-testid="agreement-reached-banner"/.test(sellerCallTsx), true);
  check('the banner text explicitly distinguishes Agreement Reached from Under Contract', /not yet Under Contract/.test(sellerCallTsx), true);
  check('page renders a dedicated Contract Ready checklist, separate from the Offer Ready reasons list', /data-testid="contract-ready-checklist"/.test(sellerCallTsx), true);
  check('the Contract Ready checklist names exactly the five SELLER_ACQUISITION_WORKFLOW.md items this page adds as checkboxes (legal owners, closing timeline, occupancy/possession, liens/title, delivery/signing)', (sellerCallTsx.match(/data-testid=\{`contract-ready-item-\$\{item\.key\}`\}/g) || []).length >= 1 && /legal_owners/.test(sellerCallTsx) && /closing_timeline/.test(sellerCallTsx) && /occupancy_possession/.test(sellerCallTsx) && /liens_title/.test(sellerCallTsx) && /delivery_signing/.test(sellerCallTsx), true);
  check('the checklist shows Agreed Price and Property Address as already-known facts, never re-asking them', /Agreed price:/.test(sellerCallTsx) && /Property address:/.test(sellerCallTsx), true);
  // Jess Gate correction, 2026-09-08: the checklist is no longer
  // session-only -- it is durable, scoped to the current agreed price and
  // property address (currentContractReadyChecklistForOpportunity's own
  // exact-match rule).
  check('the checklist is explicitly documented as durable and scoped, not session-only', /durable and scoped to this agreed price and property address/.test(sellerCallTsx), true);
  check('the old session-only claim is gone', /Checklist progress is session-only and does not persist/.test(sellerCallTsx), false);
  check('checklist reads/writes go through the durable carrier, not local useState', /const \[contractChecklist, setContractChecklist\]/.test(sellerCallTsx), false);
  check('checklist checked-state reads contractReadyChecklistRecord, not a local mirror', /checked=\{contractReadyChecklistRecord\?\.items\[item\.key\] \?\? false\}/.test(sellerCallTsxNoComments), true);
  check('checklist onChange writes through handleToggleContractReadyItem (a real ghl.notes.create write), not setContractChecklist', /onChange=\{\(e\) => handleToggleContractReadyItem\(item\.key, e\.target\.checked\)\}/.test(sellerCallTsxNoComments), true);
}

// ============================================================
// Jess Gate correction, 2026-09-08 — the correction-flow wiring itself:
// withdraw, edit/save/cancel, and the stale-decision marker.
// ============================================================
{
  check('property identity has a Withdraw control, shown only when a confirmation exists', /data-testid="withdraw-property-identity"/.test(sellerCallTsx), true);
  check('Withdraw calls handleWithdrawPropertyIdentity, a real write, not a local toggle', /onClick=\{handleWithdrawPropertyIdentity\}/.test(sellerCallTsxNoComments), true);
  check('handleWithdrawPropertyIdentity writes Status: withdrawn at the CURRENT confirmed address, never a different one', /status: "withdrawn", address: propertyIdentityConfirmation\.address/.test(sellerCallTsxNoComments), true);

  check('transaction assumptions has an Edit control, shown only when a record exists', /data-testid="edit-transaction-assumptions"/.test(sellerCallTsx), true);
  check('transaction assumptions has a Cancel control in the form', /data-testid="cancel-transaction-assumptions"/.test(sellerCallTsx), true);
  check('handleEditTransactionAssumptions prefills every field from the current record', /setTransactionStructureInput\(toInput\(transactionAssumptionsRecord\.transactionStructure\)\)/.test(sellerCallTsxNoComments), true);
  check('Cancel writes nothing (no ghl.notes.create in handleCancelEditTransactionAssumptions)', (() => {
    const m = /function handleCancelEditTransactionAssumptions\(\)[\s\S]*?\r?\n  \}\r?\n/.exec(sellerCallTsxNoComments);
    return m ? /ghl\.notes\.create/.test(m[0]) : 'FUNCTION_NOT_FOUND';
  })(), false);

  check('seller price position has an Edit control, shown only when a record exists', /data-testid="edit-seller-price-position"/.test(sellerCallTsx), true);
  check('seller price position has a Cancel control in the form', /data-testid="cancel-seller-price-position"/.test(sellerCallTsx), true);
  check('Cancel writes nothing (no ghl.notes.create in handleCancelEditSellerPricePosition)', (() => {
    const m = /function handleCancelEditSellerPricePosition\(\)[\s\S]*?\r?\n  \}\r?\n/.exec(sellerCallTsxNoComments);
    return m ? /ghl\.notes\.create/.test(m[0]) : 'FUNCTION_NOT_FOUND';
  })(), false);

  check('a stale Offer Readiness decision is marked in the UI, never silently hidden', /data-testid="readiness-human-action-stale"/.test(sellerCallTsx), true);
  check('the stale marker states it no longer authorizes readiness', /no longer authorizes readiness/.test(sellerCallTsx), true);
  check('readinessHumanAction resolves to none when the decision is stale, not just when absent', /readinessHumanActionRecord === null\s*\|\|\s*readinessDecisionCurrency\?\.current === false/.test(sellerCallTsxNoComments), true);
  // Jess Gate correction, second round: 3 occurrences now -- the two
  // decision-write branches (approved/overridden) PLUS the currency-check
  // read (isReadinessDecisionCurrent's own `snapshot:` field), all reading
  // the SAME memoized value, never a second computation of it.
  check('every decision write binds the live evidence snapshot, both approved and overridden branches, and the currency check reads the same value', (sellerCallTsxNoComments.match(/snapshot: liveReadinessEvidenceSnapshot/g) || []).length, 3);
}

// ============================================================
// Jess Gate correction, second round, 2026-09-08 -- the exact gaps named
// in that review: economics inputs in the snapshot, permanent durable
// invalidation with a write-on-detect effect that never gates on its own
// success, direct fact comparison (not existence alone), agreement-scoped
// checklist identity, and legacy v1 display.
// ============================================================
{
  check('pipeline now exposes the resolved UnderwritingInputs (needed for the deal-economics inputs snapshot)', /return \{ result: computeUnderwriting\(inputs\), facts, assignment: inputs\.assignment, inputs, issues, computeError: null, repairsSourceIsApprovalGated \}/.test(sellerCallTsxNoComments), true);
  check('liveReadinessEvidenceSnapshot.dealEconomics includes inputs via buildDealEconomicsInputsSnapshot, in BOTH the calculated and unavailable branches', (sellerCallTsxNoComments.match(/inputs: buildDealEconomicsInputsSnapshot\(pipeline\.inputs\)/g) || []).length, 2);

  check('a durable invalidation-write effect exists', /useEffect\(\(\) => \{[\s\S]{0,2200}formatReadinessDecisionInvalidationNote/.test(sellerCallTsxNoComments), true);
  check('the invalidation effect skips only when already durably invalidated OR nothing needs persisting', /if \(readinessDecisionInvalidatedDurably\) return;[\s\S]{0,900}if \(!mustPersistInvalidation\) return;/.test(sellerCallTsxNoComments), true);
  check('the invalidation write is scoped to the specific decision it invalidates (decisionAt: readinessHumanActionRecord.at)', /decisionAt: readinessHumanActionRecord\.at, reasons,?\s*\}\)/.test(sellerCallTsxNoComments), true);
  check('a failed invalidation write is surfaced to the operator', /data-testid="readiness-invalidation-write-error"/.test(sellerCallTsx), true);
  check('readinessHumanAction (the live gate) does NOT reference the invalidation write\'s busy/error state -- gating never waits on the write succeeding', /const readinessHumanAction: HumanAction = readinessHumanActionRecord === null[\s\S]{0,200}\? \{ kind: "none" \}/.test(sellerCallTsxNoComments) && !/invalidationWriteBusyForAt/.test(sellerCallTsxNoComments.slice(sellerCallTsxNoComments.indexOf('const readinessHumanAction: HumanAction'), sellerCallTsxNoComments.indexOf('const readinessHumanAction: HumanAction') + 200)), true);

  // Jess Gate correction, third round (2026-09-08) -- SESSION-STICKY
  // observed-stale memory, closing a defect found live in Test: without it,
  // a durable-write failure combined with the underlying fact reverting
  // BEFORE that write ever succeeds would silently un-observe the mismatch
  // (readinessDecisionCurrency alone recomputes back to current:true, and
  // nothing durable had landed yet to stop it).
  check('a session-sticky observedStaleForAt flag exists, keyed by decision at', /const \[observedStaleForAt, setObservedStaleForAt\] = useState<Record<string, true>>\(\{\}\);/.test(sellerCallTsxNoComments), true);
  check('the sticky flag is set by its own effect whenever a live mismatch is observed, and only then', /useEffect\(\(\) => \{\s*if \(!readinessHumanActionRecord \|\| !readinessDecisionCurrency\) return;\s*if \(readinessDecisionCurrency\.current === false\) \{\s*setObservedStaleForAt/.test(sellerCallTsxNoComments), true);
  check('readinessHumanAction (the live gate) ALSO goes to none when observedStaleThisSession is true, not only on a live mismatch', /readinessDecisionCurrency\?\.current === false\s*\|\| observedStaleThisSession\s*\?\s*\{ kind: "none" \}/.test(sellerCallTsxNoComments), true);
  check('the invalidation-write effect RETRIES using the sticky flag, not only a live mismatch (mustPersistInvalidation reads observedStaleForAt)', /const mustPersistInvalidation = readinessDecisionCurrency\.current === false\s*\|\| !!observedStaleForAt\[readinessHumanActionRecord\.at\];/.test(sellerCallTsxNoComments), true);
  check('the retry effect depends on observedStaleForAt (re-fires when the sticky flag changes, not only when readinessDecisionCurrency changes)', /\}, \[readinessHumanActionRecord, readinessDecisionCurrency, readinessDecisionInvalidatedDurably, observedStaleForAt, screen, contactId\]\);/.test(sellerCallTsxNoComments), true);

  // Jess Gate correction, third round, fault-injection follow-up
  // (2026-09-08) -- a self-cancellation race found live: the busy guard was
  // `useState` AND its own effect dependency, so setting it re-triggered
  // the effect, whose cleanup cancelled the closure that had JUST started
  // the write, before that write's own promise ever settled -- silently
  // skipping both the success and failure handlers, including the error
  // banner on a genuinely failed write. Fixed by moving the guard to a ref.
  check('the write-busy guard is a ref, not state (does not re-render or re-trigger the effect on its own)', /const invalidationWriteBusyRef = useRef<string \| null>\(null\);/.test(sellerCallTsxNoComments), true);
  check('the busy guard is no longer a dependency of the retry effect (this is what caused the self-cancellation race)', !/\}, \[readinessHumanActionRecord, readinessDecisionCurrency, readinessDecisionInvalidatedDurably, observedStaleForAt, screen, contactId, invalidationWriteBusyForAt\]\);/.test(sellerCallTsxNoComments), true);
  check('no invalidationWriteBusyForAt state remains anywhere in the file', !/invalidationWriteBusyForAt/.test(sellerCallTsxNoComments), true);
  check('no leftover debug console.log instrumentation remains in the invalidation-write effect', !/DEBUG_EFFECT|DEBUG_CALLING_CREATE|DEBUG_THEN|DEBUG_CATCH|DEBUG_FINALLY/.test(sellerCallTsx), true);
  check('when the live facts have already reverted (current !== false) but the sticky flag is set, the write uses a fallback reason naming the earlier-session observation, never an empty reasons array', /reasons = readinessDecisionCurrency\.current === false\s*\? readinessDecisionCurrency\.staleBecause\s*: \["previously observed as a live mismatch earlier this session/.test(sellerCallTsxNoComments), true);
  check('the DISPLAYED stale banner tracks the same two sources as the live gate (current === false OR observedStaleThisSession), not the live comparison alone -- so a reverted-but-not-yet-persisted mismatch still reads STALE on screen', /\(readinessDecisionCurrency\?\.current === false \|\| observedStaleThisSession\) \? \(\s*<div data-testid="readiness-human-action-stale"/.test(sellerCallTsxNoComments), true);
  check('the stale banner names the earlier-session-observation case explicitly (never falls back to an empty staleBecause join) when live currently matches but the sticky flag is still what is holding it stale', /observed as a live mismatch earlier this session; the underlying value matches again/.test(sellerCallTsx), true);

  check('readinessDecisionInvalidatedDurably is checked FIRST/unconditionally in isReadinessDecisionCurrent\'s call, via the durablyInvalidated field', /durablyInvalidated: readinessDecisionInvalidatedDurably/.test(sellerCallTsxNoComments), true);

  check('legacy v1 decisions are read via the DISPLAY-ONLY reader', /latestLegacyReadinessHumanActionV1ForOpportunity/.test(sellerCallTsxNoComments), true);
  check('legacy v1 decisions are rendered with an explicit "cannot authorize readiness" explanation', /predates the current evidence-snapshot system and cannot authorize readiness/.test(sellerCallTsx), true);
  check('legacyReadinessDecision is NEVER referenced inside the readinessHumanAction computation (cannot authorize readiness)', (() => {
    const start = sellerCallTsxNoComments.indexOf('const readinessHumanAction: HumanAction');
    const end = sellerCallTsxNoComments.indexOf(';', start);
    return start >= 0 && end > start ? /legacyReadinessDecision/.test(sellerCallTsxNoComments.slice(start, end)) : 'RANGE_NOT_FOUND';
  })(), false);

  check('the Contract Ready checklist is scoped by the agreement\'s OWN durable identity (latestOutcome.at), not price/address alone', /agreementAt: latestOutcome\.at/.test(sellerCallTsxNoComments), true);
  check('the checklist read passes agreementAt as the primary scope argument', /currentContractReadyChecklistForOpportunity\(\s*notes, screen\.opportunity\.id, latestOutcome\.at, latestOutcome\.snapshot\.currentOffer, formatAddress\(contact\),/.test(sellerCallTsxNoComments), true);
}

// ============================================================
// B8-10 / INV-53: bounded call outcomes -- exactly Accept / Follow-Up /
// Pass, matching SELLER_ACQUISITION_WORKFLOW.md's own three words, and
// each fails closed on its own precondition (checked structurally: the
// confirm button's own `disabled` expression names the precondition).
// ============================================================
{
  check('page renders exactly the three bounded outcome actions (Accept, Follow-Up, Pass), no fourth', {
    accept: /data-testid="call-outcome-accept-toggle"/.test(sellerCallTsx),
    followUp: /data-testid="call-outcome-follow-up-toggle"/.test(sellerCallTsx),
    pass: /data-testid="call-outcome-pass-toggle"/.test(sellerCallTsx),
  }, { accept: true, followUp: true, pass: true });
  // Jess Gate correction, 2026-09-06: Accept must not become available on
  // a Current Offer alone -- Offer Readiness must ALSO be OFFER_READY.
  check('Accept confirm is disabled when no Current Offer has been entered OR Offer Readiness is not OFFER_READY', /disabled=\{recordingOutcome !== null \|\| currentOffer === null \|\| readiness\?\.effectiveStatus !== "OFFER_READY"\}/.test(sellerCallTsx), true);
  check('the Accept gate reads readiness.effectiveStatus, never the raw readiness.status -- a legitimate human OVERRIDDEN result still resolves effectiveStatus to OFFER_READY and must still unlock Accept', /readiness\?\.effectiveStatus !== "OFFER_READY"/.test(sellerCallTsx) && !/readiness\?\.status !== "OFFER_READY"/.test(sellerCallTsx), true);
  check('page renders a truthful not-yet-Offer-Ready explanation distinct from the missing-Current-Offer message', /data-testid="call-outcome-accept-not-ready"/.test(sellerCallTsx), true);
  check('the not-ready explanation only renders when a Current Offer IS present but readiness is not OFFER_READY (never masking the missing-offer message)', /currentOffer === null[\s\S]{0,400}readiness\?\.effectiveStatus !== "OFFER_READY"[\s\S]{0,120}data-testid="call-outcome-accept-not-ready"/.test(sellerCallTsxNoComments), true);
  check('Follow-Up confirm is disabled with no date/time typed', /disabled=\{recordingOutcome !== null \|\| followUpAtInput\.trim\(\) === ""\}/.test(sellerCallTsx), true);
  check('Pass confirm is disabled with no reason typed', /disabled=\{recordingOutcome !== null \|\| passReasonInput\.trim\(\) === ""\}/.test(sellerCallTsx), true);
  check('Follow-Up confirm never reads readiness -- it remains available regardless of Offer Readiness', !/disabled=\{recordingOutcome !== null \|\| followUpAtInput\.trim\(\) === ""[^}]*readiness/.test(sellerCallTsx), true);
  check('Pass confirm never reads readiness -- it remains available regardless of Offer Readiness', !/disabled=\{recordingOutcome !== null \|\| passReasonInput\.trim\(\) === ""[^}]*readiness/.test(sellerCallTsx), true);
  check('a successful outcome write is appended to local notes state immediately (no refetch required for resume to reflect it)', /setNotes\(\(prev\) => \[\.\.\.\(prev \?\? \[\]\), \{ id: `local-\$\{Date\.now\(\)\}`, body: attempt\.note, dateAdded: nowIso \}\]\)/.test(sellerCallTsx), true);
}

// ============================================================
// B8-10 / INV-53: no pipeline-stage read or write anywhere -- moving an
// Opportunity's stage is a HARD NO here (unproven workflow side effects).
// ============================================================
{
  check('page never reads or writes an Opportunity pipeline stage (no stageId reference anywhere)', /stageId/.test(sellerCallTsx), false);
  check('page never calls a stage-move/pipeline-update GHL function', !/setStage|moveStage|updateOpportunityStage|setPipelineStage/.test(sellerCallTsx), true);
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
