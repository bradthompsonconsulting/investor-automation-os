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

const { deriveRailDeal, railCells } = rail;
for (const [name, fn] of Object.entries({ deriveRailDeal, railCells })) {
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
   ⚠ PB-D13's 119 + 4N does not apply and was not used. The rail is a structural
   render term, and 4N counts unlocked CONTACT fields against a CONTACT field
   term; §4B unlocks an OPPORTUNITY field and leaves the record row
   display-only, so N stays 4. */
const FLOOR = 77;
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
  /* §4B REPLACES §4A's "offers NO route". IAOS can now write the authoritative
     field, so the branch offers the edit instead of explaining its absence. */
  check('4B opportunity branch OFFERS the edit route', oppAsk.route,
    { kind: 'edit-opportunity-ask', label: 'Edit the Opportunity Ask' });
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
