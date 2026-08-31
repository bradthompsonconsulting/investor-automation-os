/**
 * The persistent call rail (Board #5 S2d seam) -- test runner.
 *
 * Compiles src/lib/rail.ts and its dependencies to a temp directory, loads the
 * emitted JavaScript, and runs deterministic table-driven cases. No GHL, no
 * network, no fixture record, no browser.
 *
 * app/package.json sets "type": "module", so the temp directory gets its own
 * package.json declaring commonjs. Same mechanism as
 * test-underwriting-resolver.cjs and test-select-opportunity.cjs.
 *
 * PROVES S2 PROOF CASES 2-7, plus the money format.
 *   2  Opportunity Ask present  -> Opportunity value wins, provenance Opportunity
 *   3  Opportunity Ask absent + Contact Ask present -> Contact value wins,
 *      provenance "Contact fallback"
 *   4  both absent -> explicit no-ask state; never zero, blank or dash
 *   5  Seller MAO present -> Opportunity value
 *   6  Seller MAO absent -> explicit not-yet-approved state, NO contact fallback
 *   7  Position and Investor Offer keep their waiting strings in EVERY state
 *   +  money format: a present value renders "$210,000" -- symbol, separator,
 *      no decimals
 *
 * CASE 1 IS NOT HERE. It lives in test-select-opportunity.cjs, against the
 * shared selection module. The rail's use of that rule -- selectOpportunity
 * called with a HARD null choice -- is exercised here through the
 * awaiting_selection cases.
 *
 * ⚠ WHAT THIS RUNNER CANNOT DO. It exercises post-seam code only. It cannot
 * compare rail.ts against the pre-seam implementation that lived inside
 * ContactWorkspace.tsx, so it is not evidence of S2d's behaviour preservation
 * -- that rests on S2d's correspondence argument and, finally, on the live
 * harness after deploy. Nor does it touch the JSX: that a RailCellView reaches
 * the DOM with the right testids is the live harness's job.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-rail-test');
const LIB = path.join(APP, 'src', 'lib');
const UW  = path.join(LIB, 'underwriting');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + path.join(UW, 'types.ts') + '" "' + path.join(UW, 'starters.ts') +
    '" "' + path.join(UW, 'resolver-types.ts') + '" "' + path.join(UW, 'compute.ts') +
    '" "' + path.join(UW, 'resolver.ts') + '" "' + path.join(UW, 'view-model.ts') +
    '" "' + path.join(UW, 'selectOpportunity.ts') + '" "' + path.join(LIB, 'rail.ts') +
    '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

/* tsc pulls ghl.ts and shared/ghl-config.ts into the program for TYPE
   information, which raises the common rootDir, so the emitted tree nests.
   Search rather than guess, and refuse on anything but exactly one match. */
function findEmitted(dir, name) {
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === name) hits.push(p);
    }
  })(dir);
  return hits;
}

const emitted = findEmitted(TMP, 'rail.js');
if (emitted.length !== 1) {
  console.error('ABORT: expected exactly one emitted rail.js, found ' + emitted.length + '. Nothing tested.');
  cleanup();
  process.exit(11);
}

/* THE GUARD THAT MATTERS HERE, AND IT IS NOT S2a's.
   selectOpportunity.js legitimately emits ZERO requires because all three of
   its imports are type-only. rail.js is different: it genuinely requires
   resolver and selectOpportunity at runtime, so "no requires" would be a false
   standard that this module could never meet.
   THE REAL HAZARD IS ghl. rail.ts imports OpportunityRow from ./ghl with
   `import type`, so tsc erases it. If that `type` keyword is ever dropped, the
   emitted file requires ghl.js, whose module scope runs
   `const CONFIG = getRuntimeConfig()` and THROWS unless setRuntimeConfig() ran
   first -- killing this runner with an opaque config error instead of a clear
   one. Guard the hazard, not a proxy for it. */
const emittedSource = fs.readFileSync(emitted[0], 'utf8');
const requiredPaths = (emittedSource.match(/require\(["'][^"']+["']\)/g) || [])
  .map((r) => r.replace(/^require\(["']/, '').replace(/["']\)$/, ''));
const ghlRequires = requiredPaths.filter((p) => /(^|\/)ghl(-config)?$/.test(p));

let rail;
try {
  rail = require(emitted[0]);
} catch (e) {
  console.error('ABORT: could not load the emitted module -- ' + e.message);
  cleanup();
  process.exit(11);
}

const { deriveRailDeal, railCells, railAuthorityReconciled, contactAskAuthority } = rail;
for (const [name, fn] of Object.entries({ deriveRailDeal, railCells, railAuthorityReconciled, contactAskAuthority })) {
  if (typeof fn !== 'function') {
    console.error('ABORT: ' + name + ' is not exported. Nothing tested.');
    cleanup();
    process.exit(11);
  }
}

/* FLOOR -- a literal count of the check() call sites in this file, taken from
   the finished file and never back-filled from a passing run.

   Board #5 §4B: 74 -> 77. Derived, not observed:
     -1  RETIRED  the §4A mutual-exclusion invariant, whose predicate §4B made
                  structurally unsatisfiable (see the note at its old site).
     +4  NEW      opportunityId carried · multi-candidate exposes no id ·
                  no cell value is a function · error state offers no edit route.
      0  the §4A opportunity-branch route assertion was REPLACED and its
         authority-note assertion INVERTED -- both remain one call each.
   Board #5 §4C: 77 -> 87. COUNTED FROM THIS FILE, not proposed and not
   back-filled. The costing proposed 88; the eleventh candidate --
   "origination keeps the contact route as secondary" -- was DROPPED during the
   build as vacuous: the contact branch's route is already asserted by
   '4A contact branch OFFERS the route' and its editor by
   '4C contact-fallback branch offers origination with NO seed', so a third
   check asserting both exist could not fail independently of them.
      0  REPLACED  the §4B route assertion became the §4C `editor` assertion.
     +5  origination shape: no navigation route on the Opportunity branch ·
         contact-fallback offers origination with seed:null · resolved-with-no-
         ask still offers it · only a resolved deal exposes an editor ·
         the ask cell's field set is exactly these eight.
     +5  the authority predicate: reconciled on exact match · not reconciled
         while the Contact fallback governs · not reconciled on a DIFFERENT
         value (third-party overtake, fails safe) · not reconciled in any
         unresolved state · null confirmedWrite reconciles vacuously.
   ⚠ PB-D13's 119 + 4N does not apply and was not used. The rail is a structural
   render term, and 4N counts unlocked CONTACT fields against a CONTACT field
   term; §4B/§4C unlock an OPPORTUNITY field and leave the record row
   display-only, so N stays 4.
   Board #5 §4D: 87 -> 94. COUNTED FROM THIS FILE. The costing proposed +10;
   THREE candidates were dropped during the build as vacuous, on the same rule
   that dropped §4C's eleventh:
     +7  CASE 8, the seven-way contactAskAuthority mapping -- one call site per
         situation, each pinning the COMPLETE {token,label} pair:
         resolved+Opportunity Ask · resolved+Contact Ask · resolved+no Ask ·
         loading · error · awaiting_selection · no_opportunity.
     -1  DROPPED  "the label set across all seven is exactly 5 distinct strings"
     -1  DROPPED  "the token set across all seven is exactly 7 distinct strings"
     -1  DROPPED  "every label begins 'Contact Asking Price — '"
   ⚠ WHY ALL THREE WENT. The seven checks above pin the complete return value
   for every one of the seven inputs -- that IS the function's entire tested
   domain. Any mutation that changes a label, collapses two tokens, or renames
   the prefix must break at least one of the seven, so none of the three could
   fail INDEPENDENTLY of them. They were intent-documentation wearing a check()
   call, and intent belongs in a comment; the asymmetry they were meant to
   record is stated on contactAskAuthority itself and in CASE 8's header.
   ⚠ NOT re-added, dropped earlier during costing: "the 'no value' label is
   unreachable while the contact carrier holds a value" -- implied by the
   resolved+Contact Ask check.
   ⚠ The seven state PRECONDITIONS in CASE 8 are HARD ABORTS, not check() sites
   -- harness preconditions, not mapping invariants. The floor stays 94. */
const FLOOR = 94;
let checks = 0;
let failures = 0;

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

/* ---- fixture identifiers. Deliberately not production ids. ---- */
const IDS = {
  oppFacts:     { arv: 'o-arv', repairs: 'o-rep', askingPrice: 'o-ask', assignmentMode: 'o-mode' },
  contactSeeds: { arv: 'c-arv', repairs: 'c-rep', askingPrice: 'c-ask' },
  sellerMAO:    'o-mao',
};

const CONTACT = 'contact-1';

/** An opportunity row. Opportunity custom fields carry fieldValueNumber. */
function opp(fields) {
  return {
    id: 'opp-1', contactId: CONTACT, contactName: 'Alpha Seller',
    opportunityName: 'Alpha Deal', phone: '', email: '', stageId: 'stg',
    customFields: Object.entries(fields).map(([id, n]) => ({ id, fieldValueNumber: n })),
  };
}
/** A contact detail record. Contact custom fields carry `value`. */
function detail(fields) {
  return { customFields: Object.entries(fields).map(([id, n]) => ({ id, value: n })) };
}
/** The resolved happy path, varied per case. */
function derive(oppFields, contactFields) {
  return deriveRailDeal({
    opps: [opp(oppFields)],
    oppsError: null,
    detail: contactFields === null ? null : detail(contactFields),
    detailLoading: false,
    ids: IDS,
  });
}
const cellOf = (deal, key) => railCells(deal).find((c) => c.key === key);

/* ---- the emitted module's loading hazard ---- */
check('no emitted require() resolves to ghl', ghlRequires, []);
check('rail.js DOES require its real runtime deps', requiredPaths.filter((p) => /resolver$|selectOpportunity$/.test(p)).length, 2);

/* ================= CASE 2 -- Opportunity Ask wins ================= */
{
  // Both present. The Opportunity value must win; the contact value must not
  // appear anywhere in the cell.
  const deal = derive({ 'o-ask': 210000 }, { 'c-ask': 175000 });
  const cell = cellOf(deal, 'seller-ask');
  check('case2 deal resolves', deal.state, 'resolved');
  check('case2 ask value is the OPPORTUNITY value', deal.ask, { value: 210000, source: 'opportunity' });
  check('case2 provenance says Opportunity', cell.provenance, 'Opportunity · Alpha Deal');
  check('case2 renders the opportunity figure', cell.primary, '$210,000');
  check('case2 tone is a value, not waiting', cell.tone, 'value');
  check('case2 the contact figure appears nowhere', cell.primary.includes('175'), false);
}

/* ===== Board #5 §4A -- ASYMMETRIC DISCLOSURE, BOTH BRANCHES =====
   ⚠ THE OPPORTUNITY BRANCH IS OFFLINE-ONLY AND CANNOT BE OTHERWISE. Measured
   2026-08-29: 0 of 43 Production opportunities carry opportunity.asking_price,
   confirmed by two independent readers (the ghl-opportunities list and the
   singular GET). So no fixture reaches it, and manufacturing Production data
   to get a branch is forbidden -- the same ruling as awaiting_selection. These
   are the ONLY assertions that will ever exercise it. */
{
  const oppSourced = derive({ 'o-ask': 210000, 'o-mao': 165000 }, { 'c-ask': 175000 });
  const oppAsk = cellOf(oppSourced, 'seller-ask');
  check('4A opportunity branch names the selected deal', oppAsk.provenance, 'Opportunity · Alpha Deal');
  /* §4C — the edit affordance moved OUT of `route` and into `editor`. route
     means navigate-away; editor means edit-in-place. §4B had one field
     carrying both verbs, which origination made unsurvivable. */
  check('4C opportunity branch offers the SEEDED in-place editor', oppAsk.editor,
    { kind: 'edit-opportunity-ask', label: 'Edit the Opportunity Ask', seed: 210000 });
  /* §4B INVERTS §4A's "says why there is no route". The note existed because
     there was nothing to offer; there now is, so it must be GONE rather than
     left sitting beside the affordance it contradicts. */
  check('4B opportunity branch no longer carries an authority note',
    oppAsk.authorityNote, null);
  check('4A mao provenance also names the deal', cellOf(oppSourced, 'seller-mao').provenance, 'Opportunity · Alpha Deal');
  check('4A mao offers no route either', cellOf(oppSourced, 'seller-mao').route, null);

  const contactSourced = derive({}, { 'c-ask': 175000 });
  const conAsk = cellOf(contactSourced, 'seller-ask');
  check('4A contact branch states WHY the contact value governs',
    conAsk.provenance, 'Contact fallback — no Opportunity Ask');
  check('4A contact branch OFFERS the route', conAsk.route,
    { kind: 'contact-record', label: 'Edit on the Contact in GHL' });
  check('4A contact branch adds no authority note', conAsk.authorityNote, null);

  /* ⚠ §4A's mutual-exclusion invariant was RETIRED HERE by §4B, deliberately,
     and is not to be reinstated. §4B removed the final authorityNote-producing
     rail state, so the predicate "some cell has BOTH a route and a note" became
     structurally unsatisfiable — no input could make it fail. Retaining it
     would have left a vacuous gate incapable of changing the decision, and
     keeping an artificial note alive merely to feed it would have been worse.
     The FIELD survives in RailCellView as the mechanism for future no-route
     explanatory states; only the assertion is gone. The dormant-field guards
     at :217 and :225 below are NOT part of this retirement and stay. */
  // Waiting states disclose nothing and route nowhere.
  const noOpp = deriveRailDeal({ opps: [], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS });
  check('4A waiting states carry no route', cellOf(noOpp, 'seller-ask').route, null);
  check('4A waiting states carry no authority note', cellOf(noOpp, 'seller-ask').authorityNote, null);
  check('4A carrier-less cells carry no route', cellOf(oppSourced, 'seller-position').route, null);

  /* ── §4B — THE FOUR NEW GUARDS ─────────────────────────────────────────── */

  /* The id the editor writes to. It rides on the deal read, not on a cell:
     RailCellView stays free of ids and handles so railCells remains purely
     derived and assertable. */
  check('4B resolved deal carries the selected opportunityId',
    oppSourced.state === 'resolved' ? oppSourced.opportunityId : null, 'opp-1');

  /* ⚠ THE HIGHEST-CONSEQUENCE GUARD IN THIS TRANCHE. A wrong id here writes an
     Ask onto somebody else's deal. PB-D55 forbids assuming the first candidate
     is the deal, and deriveRailDeal calls selectOpportunity with a HARD null
     choice — so with more than one candidate the rail does not resolve AT ALL
     and therefore exposes NO id to write to. The protection is structural: the
     editor cannot target an unchosen deal because no target exists. */
  {
    const many = deriveRailDeal({
      opps: [opp({ 'o-ask': 210000 }), { ...opp({ 'o-ask': 999000 }), id: 'opp-2' }],
      oppsError: null, detail: detail({}), detailLoading: false, ids: IDS,
    });
    check('4B multi-candidate exposes NO opportunityId to write to',
      [many.state, 'opportunityId' in many], ['awaiting_selection', false]);
  }

  /* The purity constraint, machine-checked rather than trusted to review. A
     function anywhere in a cell would make these structural assertions
     meaningless and would take the offline seam with it — the save path lives
     in the component, and this is what keeps it there. */
  {
    const everyCell = [oppSourced, contactSourced, noOpp,
      deriveRailDeal({ opps: null, oppsError: 'boom', detail: null, detailLoading: false, ids: IDS }),
    ].flatMap((d) => railCells(d));
    const functionsFound = everyCell.flatMap((c) =>
      Object.entries(c).filter(([, v]) => typeof v === 'function').map(([k]) => k));
    check('4B no rail cell value is a function', functionsFound, []);
  }

  /* A failed read must not offer to edit. The error state already asserts its
     own `state`; nothing asserted its route, and an error branch that handed
     over an editor would be offering to write against a deal it could not read. */
  {
    const errored = deriveRailDeal({ opps: null, oppsError: 'boom', detail: null, detailLoading: false, ids: IDS });
    check('4B error state offers no edit route', cellOf(errored, 'seller-ask').route, null);
  }

  /* ===== Board #5 §4C — ORIGINATION + THE AUTHORITY PREDICATE ========== */

  /* The only hop IAOS has reaches the CONTACT record, which in this branch is
     NOT the authoritative field. Offering it here would send Brad to edit a
     value that is being ignored -- the §4A failure exactly. */
  check('4C opportunity branch offers no NAVIGATION route', oppAsk.route, null);

  /* ⚠ seed:null IS THE SHADOW-COPY GUARD. If origination seeded from the
     CONTACT ask, the draft would open on the fallback number and one Enter
     would write an Opportunity Ask EQUAL to the Contact Ask -- a synchronized
     shadow copy made by the UI, the one prohibited outcome. */
  check('4C contact-fallback branch offers origination with NO seed', conAsk.editor,
    { kind: 'set-opportunity-ask', label: 'Set Opportunity Ask', seed: null });

  {
    const bare = derive({}, {});
    check('4C resolved with no ask anywhere still offers origination',
      cellOf(bare, 'seller-ask').editor,
      { kind: 'set-opportunity-ask', label: 'Set Opportunity Ask', seed: null });
  }

  {
    /* ⚠ THE NO-TARGET-GUESSING GUARD. awaiting_selection is the one that
       matters: PB-D55 forbids assuming the first candidate is the deal, and an
       editor offered there would write an Ask onto an unchosen Opportunity. */
    const unresolved = {
      loading:            deriveRailDeal({ opps: null, oppsError: null, detail: null, detailLoading: true, ids: IDS }),
      error:              deriveRailDeal({ opps: null, oppsError: 'boom', detail: null, detailLoading: false, ids: IDS }),
      no_opportunity:     deriveRailDeal({ opps: [], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS }),
      awaiting_selection: deriveRailDeal({ opps: [opp({}), { ...opp({}), id: 'opp-2' }], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS }),
    };
    const offering = Object.entries(unresolved)
      .filter(([, d]) => railCells(d).some((c) => c.editor !== null))
      .map(([k]) => k);
    check('4C only a resolved deal exposes an editor', offering, []);
  }

  /* Not an atomicity proof -- atomicity is structural: one switch arm emits
     every field together. This catches a field being ADDED to RailCellView and
     left unasserted, which no per-field check can see. */
  check('4C the ask cell is exactly these fields, both branches',
    [Object.keys(oppAsk).sort(), Object.keys(conAsk).sort()],
    [['authorityNote','editor','key','label','primary','provenance','route','tone'],
     ['authorityNote','editor','key','label','primary','provenance','route','tone']]);

  /* ── §4C the authority predicate ──────────────────────────────────────── */
  {
    const oppDeal = derive({ 'o-ask': 987654.32 }, { 'c-ask': 175000 });
    const conDeal = derive({}, { 'c-ask': 175000 });
    const amb = deriveRailDeal({ opps: [opp({}), { ...opp({}), id: 'opp-2' }], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS });
    const errDeal = deriveRailDeal({ opps: null, oppsError: 'boom', detail: null, detailLoading: false, ids: IDS });

    check('4C reconciled when the Opportunity carries exactly the confirmed write',
      railAuthorityReconciled(oppDeal, 987654.32), true);
    /* The warning-on case: the write landed but resolved state still shows the
       Contact fallback governing. */
    check('4C NOT reconciled while the Contact fallback still governs',
      railAuthorityReconciled(conDeal, 987654.32), false);
    /* ⚠ Third-party overtake. Fails SAFE -- keeps warning, because our write
       is genuinely not what governs. A known false positive, named. */
    check('4C NOT reconciled when the Opportunity carries a DIFFERENT value',
      railAuthorityReconciled(derive({ 'o-ask': 111111.11 }, {}), 987654.32), false);
    check('4C NOT reconciled in any unresolved state',
      [railAuthorityReconciled(amb, 987654.32), railAuthorityReconciled(errDeal, 987654.32)],
      [false, false]);
    /* No write to reconcile means nothing to warn about. */
    check('4C no confirmed write means nothing to reconcile',
      [railAuthorityReconciled(conDeal, null), railAuthorityReconciled(amb, null)], [true, true]);
  }
}

/* ================= CASE 3 -- Contact fallback, disclosed ================= */
{
  const deal = derive({}, { 'c-ask': 175000 });
  const cell = cellOf(deal, 'seller-ask');
  check('case3 ask value is the CONTACT value', deal.ask, { value: 175000, source: 'contact' });
  check('case3 provenance says Contact fallback', cell.provenance, 'Contact fallback — no Opportunity Ask');
  check('case3 renders the contact figure', cell.primary, '$175,000');
  check('case3 tone is a value', cell.tone, 'value');
  // ⚠ The disclosure is the whole safety property. A contact value must never
  // be labelled Opportunity.
  check('case3 provenance is NOT Opportunity', cell.provenance.startsWith('Opportunity'), false);
}

/* ================= CASE 4 -- both absent ================= */
{
  const deal = derive({}, {});
  const cell = cellOf(deal, 'seller-ask');
  check('case4 ask is null', deal.ask, null);
  check('case4 states what is missing', cell.primary, 'no ask on Opportunity or Contact');
  check('case4 tone is waiting', cell.tone, 'waiting');
  check('case4 no provenance to disclose', cell.provenance, null);
  check('case4 never renders a zero', cell.primary.includes('0'), false);
  check('case4 never renders a dash', cell.primary.includes('—'), false);
  check('case4 is not blank', cell.primary.length > 0, true);
  // Contact record entirely absent is the same honest state, not a crash.
  const noDetail = derive({}, null);
  check('case4 null detail also yields no ask', noDetail.ask, null);
  check('case4 null detail states the same thing', cellOf(noDetail, 'seller-ask').primary, 'no ask on Opportunity or Contact');
}

/* ================= CASE 5 -- Seller MAO present ================= */
{
  const deal = derive({ 'o-ask': 210000, 'o-mao': 165000 }, {});
  const cell = cellOf(deal, 'seller-mao');
  check('case5 mao is the opportunity value', deal.mao, 165000);
  check('case5 renders the figure', cell.primary, '$165,000');
  check('case5 provenance says Opportunity', cell.provenance, 'Opportunity · Alpha Deal');
  check('case5 tone is a value', cell.tone, 'value');
}

/* ================= CASE 6 -- Seller MAO absent ================= */
{
  // A contact-side value at the SAME id must not be picked up: MAO has no
  // contact fallback and this is the check that says so.
  const deal = derive({ 'o-ask': 210000 }, { 'c-ask': 175000, 'o-mao': 165000 });
  const cell = cellOf(deal, 'seller-mao');
  check('case6 mao is null', deal.mao, null);
  check('case6 states not yet approved', cell.primary, 'not yet approved — run Underwriting');
  check('case6 tone is waiting', cell.tone, 'waiting');
  check('case6 no provenance', cell.provenance, null);
  check('case6 NO contact fallback -- 165000 is not picked up', cell.primary.includes('165'), false);
  check('case6 never renders a zero', cell.primary.includes('0'), false);
  // Absence and a stored zero are different facts. 0 is a value.
  const zero = derive({ 'o-mao': 0 }, {});
  check('case6 a stored 0 is a VALUE, not absence', cellOf(zero, 'seller-mao').primary, '$0');
  check('case6 a stored 0 carries Opportunity provenance', cellOf(zero, 'seller-mao').provenance, 'Opportunity · Alpha Deal');
}

/* ================= CASE 7 -- the two carrier-less cells ================= */
{
  const POSITION = 'WAITING on negotiation carrier';
  const OFFER    = 'WAITING on negotiation semantics / carrier contract';
  const states = {
    loading:            deriveRailDeal({ opps: null, oppsError: null, detail: null, detailLoading: true, ids: IDS }),
    error:              deriveRailDeal({ opps: null, oppsError: 'boom', detail: null, detailLoading: false, ids: IDS }),
    no_opportunity:     deriveRailDeal({ opps: [], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS }),
    awaiting_selection: deriveRailDeal({ opps: [opp({}), { ...opp({}), id: 'opp-2' }], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS }),
    resolved:           derive({ 'o-ask': 210000, 'o-mao': 165000 }, {}),
  };
  /* UNROLLED DELIBERATELY. A loop here would run ten checks from two call
     sites, so FLOOR could no longer be a literal count of call sites -- and a
     silently deleted state would still satisfy it. One line per assertion
     keeps the floor meaningful. */
  check('case7 loading: position keeps its carrier state', cellOf(states.loading, 'seller-position').primary, POSITION);
  check('case7 loading: offer keeps its carrier state', cellOf(states.loading, 'investor-offer').primary, OFFER);
  check('case7 error: position keeps its carrier state', cellOf(states.error, 'seller-position').primary, POSITION);
  check('case7 error: offer keeps its carrier state', cellOf(states.error, 'investor-offer').primary, OFFER);
  check('case7 no_opportunity: position keeps its carrier state', cellOf(states.no_opportunity, 'seller-position').primary, POSITION);
  check('case7 no_opportunity: offer keeps its carrier state', cellOf(states.no_opportunity, 'investor-offer').primary, OFFER);
  check('case7 awaiting_selection: position keeps its carrier state', cellOf(states.awaiting_selection, 'seller-position').primary, POSITION);
  check('case7 awaiting_selection: offer keeps its carrier state', cellOf(states.awaiting_selection, 'investor-offer').primary, OFFER);
  check('case7 resolved: position keeps its carrier state', cellOf(states.resolved, 'seller-position').primary, POSITION);
  check('case7 resolved: offer keeps its carrier state', cellOf(states.resolved, 'investor-offer').primary, OFFER);
  check('case7 position is always waiting tone', cellOf(states.resolved, 'seller-position').tone, 'waiting');
  check('case7 offer is always waiting tone', cellOf(states.resolved, 'investor-offer').tone, 'waiting');
  check('case7 position never discloses a provenance', cellOf(states.resolved, 'seller-position').provenance, null);

  // The rail states, in passing -- these are what the Ask/MAO cells say when
  // there is nothing to resolve yet.
  check('loading state names itself', states.loading.state, 'loading');
  check('loading ask cell reads reading Opportunity', cellOf(states.loading, 'seller-ask').primary, 'reading Opportunity…');
  check('error state carries the message', cellOf(states.error, 'seller-ask').primary, 'Opportunity read failed — boom');
  check('no_opportunity is its own state, not a late number', cellOf(states.no_opportunity, 'seller-ask').primary, 'no Opportunity on this contact');
  check('awaiting_selection names the count', cellOf(states.awaiting_selection, 'seller-ask').primary, '2 Opportunities — select one in Underwriting');
  check('awaiting_selection did NOT pick the first opportunity', states.awaiting_selection.state, 'awaiting_selection');
  check('cells are always four, in order', railCells(states.resolved).map((c) => c.key),
    ['seller-ask', 'seller-mao', 'seller-position', 'investor-offer']);
}

/* ===== CASE 8 -- §4D contactAskAuthority: the SEVEN-way mapping, exhaustive =====

   THIS IS WHERE THE MAPPING IS PROVEN. Four of the seven situations are
   UNREACHABLE in Production -- loading, error, awaiting_selection, and
   resolved-with-an-Opportunity-Ask (0 of 43 opportunities carry one, measured
   twice). No live harness can exercise them, so an offline, table-driven proof
   is the only proof they will ever get, and it has to be exhaustive here.

   UNROLLED DELIBERATELY, per this file's rule at the CASE 7 note: one call site
   per assertion, so FLOOR stays a literal count of call sites and a silently
   deleted situation cannot still satisfy it.

   Each check pins the COMPLETE {token,label} pair, which is why the three
   set-shape candidates from the costing are not here -- see the FLOOR
   derivation for which were dropped and why. */
{
  const askAuth = (deal) => contactAskAuthority(deal);
  const UNDETERMINED = 'Contact Asking Price — authority not determined';

  const s_loading            = deriveRailDeal({ opps: null, oppsError: null, detail: null, detailLoading: true, ids: IDS });
  const s_error              = deriveRailDeal({ opps: null, oppsError: 'boom', detail: null, detailLoading: false, ids: IDS });
  const s_no_opportunity     = deriveRailDeal({ opps: [], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS });
  const s_awaiting_selection = deriveRailDeal({ opps: [opp({}), { ...opp({}), id: 'opp-2' }], oppsError: null, detail: detail({}), detailLoading: false, ids: IDS });
  const s_opp_ask            = derive({ 'o-ask': 210000 }, { 'c-ask': 175000 }); // Opportunity wins
  const s_contact_ask        = derive({}, { 'c-ask': 175000 });                  // Contact fallback governs
  const s_resolved_no_ask    = derive({}, {});                                   // resolved, neither carrier

  // Preconditions, not assertions: if these five states are not what we think,
  // the seven checks below would be asserting about the wrong inputs.
  for (const [nm, d, want] of [
    ['loading', s_loading, 'loading'],
    ['error', s_error, 'error'],
    ['no_opportunity', s_no_opportunity, 'no_opportunity'],
    ['awaiting_selection', s_awaiting_selection, 'awaiting_selection'],
    ['opp_ask', s_opp_ask, 'resolved'],
    ['contact_ask', s_contact_ask, 'resolved'],
    ['resolved_no_ask', s_resolved_no_ask, 'resolved'],
  ]) {
    if (d.state !== want) {
      console.error('ABORT: case8 fixture ' + nm + ' is state ' + d.state + ', expected ' + want + '. Nothing proven.');
      cleanup();
      process.exit(11);
    }
  }

  check('case8 resolved + Opportunity Ask -> not authoritative', askAuth(s_opp_ask),
    { token: 'opportunity', label: 'Contact Asking Price — fallback / not authoritative' });
  check('case8 resolved + Contact Ask -> governing fallback', askAuth(s_contact_ask),
    { token: 'contact', label: 'Contact Asking Price — governing fallback' });
  check('case8 resolved + no Ask on either carrier -> no value', askAuth(s_resolved_no_ask),
    { token: 'resolved_no_ask', label: 'Contact Asking Price — no value' });
  check('case8 loading -> authority not determined', askAuth(s_loading),
    { token: 'loading', label: UNDETERMINED });
  check('case8 error -> authority not determined', askAuth(s_error),
    { token: 'error', label: UNDETERMINED });
  check('case8 awaiting_selection -> authority not determined', askAuth(s_awaiting_selection),
    { token: 'awaiting_selection', label: UNDETERMINED });
  /* NOT "governing fallback". There is nothing to fall back FROM with no
     Opportunity, and this label is correct whether or not the contact carrier
     holds a value -- which is why the live check for this state deliberately
     does not assert on the displayed value. */
  check('case8 no_opportunity -> contact value only', askAuth(s_no_opportunity),
    { token: 'no_opportunity', label: 'Contact Asking Price — contact value only' });
}

/* ================= MONEY FORMAT ================= */
{
  const askPrimary = (n) => cellOf(derive({ 'o-ask': n }, {}), 'seller-ask').primary;
  check('money 210000 -> $210,000', askPrimary(210000), '$210,000');
  check('money 950 -> no separator', askPrimary(950), '$950');
  check('money 1000 -> separator appears', askPrimary(1000), '$1,000');
  check('money 1234567 -> two separators', askPrimary(1234567), '$1,234,567');
  check('money 210000.4 rounds down, no decimals', askPrimary(210000.4), '$210,000');
  check('money 210000.6 rounds up, no decimals', askPrimary(210000.6), '$210,001');
  check('money 0 -> $0', askPrimary(0), '$0');
  check('money never shows a decimal point', askPrimary(210000.49).includes('.'), false);
}

cleanup();

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
