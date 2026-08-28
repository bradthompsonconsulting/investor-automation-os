/**
 * Shared opportunity selection (Board #5 S2a) -- test runner.
 *
 * Compiles selectOpportunity.ts and its type dependencies to a temp
 * directory, loads the emitted JavaScript, and runs deterministic
 * table-driven cases. No GHL, no network, no fixture record.
 *
 * app/package.json sets "type": "module", so the temp directory gets its
 * own package.json declaring commonjs. Without it, Node reads the emitted
 * .js as ESM and require() fails before any test runs. Same mechanism as
 * test-underwriting-resolver.cjs.
 *
 * PROVES S2 PROOF CASE 1 IN FULL, AND ONLY CASE 1.
 *   one candidate auto-selects
 *   MULTIPLE candidates with no explicit selection resolve UNRESOLVED --
 *   never first-candidate-by-default
 *
 * ⚠ CASE 1's MULTI-CANDIDATE HALF EXISTS ONLY HERE, AND MUST. Board #4's
 * close measured 43 Production opportunities across 43 distinct contacts,
 * ZERO holding more than one. awaiting_selection is unreachable by a live
 * browser harness against real data, and manufacturing a second Production
 * opportunity to make a browser test possible is not on the table. This
 * runner is the only place that branch is ever exercised.
 *
 * SCOPE NOTE -- CASES 2-7 ARE NOT HERE.
 * They live in railCells() and in the rail's deal-derivation memo, both
 * inside src/pages/ContactWorkspace.tsx. That module cannot be loaded by a
 * .cjs runner: it is .tsx, it pulls React/lucide/react-router, and it
 * imports src/lib/ghl.ts, whose module scope runs
 * `const CONFIG = getRuntimeConfig()` -- which THROWS unless
 * setRuntimeConfig() ran first. A production seam is required and is NOT
 * authorized; it is proposed in the S2 proof report, not taken here.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-select-opportunity-test');
const SRC = path.join(APP, 'src', 'lib', 'underwriting');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

/* selectOpportunity.ts imports OpportunityRow from ../ghl and two types from
   view-model/resolver-types. tsc follows those imports, so ghl.ts would be
   compiled too -- and its emitted module-scope getRuntimeConfig() call would
   throw on require(). --isolatedModules is not enough; the fix is that the
   ghl import in selectOpportunity.ts is `import type`, which tsc ERASES, so
   no require('../ghl') is emitted. If that import ever loses its `type`
   keyword this runner stops working, which is the intended alarm. */
try {
  execSync(
    'npx tsc "' + path.join(SRC, 'types.ts') + '" "' + path.join(SRC, 'starters.ts') +
    '" "' + path.join(SRC, 'resolver-types.ts') + '" "' + path.join(SRC, 'compute.ts') +
    '" "' + path.join(SRC, 'resolver.ts') + '" "' + path.join(SRC, 'view-model.ts') +
    '" "' + path.join(SRC, 'selectOpportunity.ts') +
    '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

/* WHERE THE EMITTED FILE LANDS IS NOT GUESSED. tsc pulls ghl.ts and
   shared/ghl-config.ts into the program for type information, which raises the
   common rootDir to the app root, so the output nests under
   src/lib/underwriting/ rather than sitting at the top of --outDir. Searching
   for it and refusing on anything other than exactly one match is stable
   against that layout changing again. */
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

const emitted = findEmitted(TMP, 'selectOpportunity.js');
if (emitted.length !== 1) {
  console.error('ABORT: expected exactly one emitted selectOpportunity.js, found ' + emitted.length + '. Nothing tested.');
  cleanup();
  process.exit(11);
}

/* THE MECHANISM'S OWN PRECONDITION, ASSERTED BEFORE THE MODULE IS LOADED.
   selectOpportunity.ts imports OpportunityRow, RawField and SelectedOpportunity
   with `import type`, so tsc ERASES all three and emits a module with no
   require() at all. That is the ONLY reason a .cjs runner can load it: a real
   import of ../ghl would drag in ghl.ts, whose module scope runs
   `const CONFIG = getRuntimeConfig()` and THROWS unless setRuntimeConfig() ran
   first. If a future edit drops a `type` keyword, this check fails loudly here
   instead of the runner dying with an opaque config error. */
const emittedSource = fs.readFileSync(emitted[0], 'utf8');
const runtimeRequires = emittedSource.match(/require\(/g) || [];

let mod;
try {
  mod = require(emitted[0]);
} catch (e) {
  console.error('ABORT: could not load the emitted module -- ' + e.message);
  cleanup();
  process.exit(11);
}

const { opportunitiesForContact, opportunityCandidates, selectOpportunity, readOpportunityNumber } = mod;
for (const [name, fn] of Object.entries({ opportunitiesForContact, opportunityCandidates, selectOpportunity, readOpportunityNumber })) {
  if (typeof fn !== 'function') {
    console.error('ABORT: ' + name + ' is not exported. Nothing tested.');
    cleanup();
    process.exit(11);
  }
}

/* FLOOR -- a literal count of the check() call sites in this file, taken from
   the finished file and never back-filled from a passing run. */
const FLOOR = 33;
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

/* ---- the mechanism's precondition (see the note above the load) ---- */
check('emitted module has NO runtime require() -- type-only imports erased', runtimeRequires.length, 0);

/* Fixture rows. Deliberately not production ids. Only the keys the selection
   rule reads are populated; customFields carries the shapes readOpportunityNumber
   is contracted to accept and reject. */
const row = (id, contactId, opportunityName, contactName) =>
  ({ id, contactId, opportunityName, contactName, phone: '', email: '', stageId: 'stg', customFields: [] });

const CONTACT = 'c-alpha';
const OTHER   = 'c-beta';

/* ---- opportunitiesForContact: the filter ---- */
{
  const all = [row('o1', CONTACT, 'Deal One', 'Alpha'), row('o2', OTHER, 'Deal Two', 'Beta'), row('o3', CONTACT, 'Deal Three', 'Alpha')];
  const mine = opportunitiesForContact(all, CONTACT);
  check('filter keeps only this contact', mine.map((o) => o.id), ['o1', 'o3']);
  check('filter preserves wire order', mine[0].id, 'o1');
  check('filter on a contact with none', opportunitiesForContact(all, 'c-nobody'), []);
  check('filter on an empty list', opportunitiesForContact([], CONTACT), []);
}

/* ---- opportunityCandidates: the display-name fallback ---- */
{
  check('candidates from null is empty', opportunityCandidates(null), []);
  check('candidates from empty is empty', opportunityCandidates([]), []);
  check('name prefers opportunityName',
    opportunityCandidates([row('o1', CONTACT, 'Deal One', 'Alpha')]),
    [{ id: 'o1', name: 'Deal One' }]);
  check('name falls back to contactName',
    opportunityCandidates([row('o1', CONTACT, '', 'Alpha')]),
    [{ id: 'o1', name: 'Alpha' }]);
  check('name falls back to id last',
    opportunityCandidates([row('o1', CONTACT, '', '')]),
    [{ id: 'o1', name: 'o1' }]);
  check('candidates preserve order',
    opportunityCandidates([row('o1', CONTACT, 'A', ''), row('o2', CONTACT, 'B', '')]).map((c) => c.id),
    ['o1', 'o2']);
}

/* ---- selectOpportunity: PB-D55. THE RULE THAT MATTERS. ---- */
{
  const one = [{ id: 'o1', name: 'Deal One' }];
  const two = [{ id: 'o1', name: 'Deal One' }, { id: 'o2', name: 'Deal Two' }];
  const three = [{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }, { id: 'o3', name: 'C' }];

  /* CASE 1, first half -- exactly one auto-selects, with or without a choice. */
  check('one candidate auto-selects', selectOpportunity(one, null), { id: 'o1', name: 'Deal One' });
  check('one candidate auto-selects even with a stale chosenId', selectOpportunity(one, 'o-gone'), { id: 'o1', name: 'Deal One' });

  /* CASE 1, second half -- THE BRANCH NO LIVE HARNESS CAN REACH.
     Two and three candidates with NO explicit choice must resolve to null.
     If this rule ever regresses to candidates[0], these are the only checks
     in the codebase that would notice. */
  check('two candidates, no choice -> UNRESOLVED', selectOpportunity(two, null), null);
  check('three candidates, no choice -> UNRESOLVED', selectOpportunity(three, null), null);
  check('two candidates does NOT default to the first', selectOpportunity(two, null) === two[0], false);
  check('three candidates does NOT default to the first', selectOpportunity(three, null) === three[0], false);

  /* An explicit choice resolves, and only to the chosen one. */
  check('explicit choice resolves', selectOpportunity(two, 'o2'), { id: 'o2', name: 'Deal Two' });
  check('explicit choice picks the named one, not the first', selectOpportunity(three, 'o3'), { id: 'o3', name: 'C' });
  check('unknown chosenId -> UNRESOLVED, not a fallback', selectOpportunity(two, 'o-nope'), null);

  /* Zero candidates is not a selection problem; the caller reports
     no_opportunity from the empty candidate list. */
  check('zero candidates -> null', selectOpportunity([], null), null);
  check('zero candidates with a chosenId -> null', selectOpportunity([], 'o1'), null);
}

/* ---- readOpportunityNumber: the contract duplicated from resolver.ts's
   private readNumberField. Tested here BECAUSE it is a duplicate -- if the
   original ever changes, these are the checks that pin what this copy
   promised. fieldValueNumber ONLY; numeric strings accepted. ---- */
{
  const f = (id, obj) => [Object.assign({ id }, obj)];
  check('reads a number from fieldValueNumber', readOpportunityNumber(f('x', { fieldValueNumber: 165000 }), 'x'), 165000);
  check('accepts a numeric string', readOpportunityNumber(f('x', { fieldValueNumber: '165000' }), 'x'), 165000);
  check('accepts a padded numeric string', readOpportunityNumber(f('x', { fieldValueNumber: ' 165000 ' }), 'x'), 165000);
  check('absent field -> null', readOpportunityNumber([], 'x'), null);
  check('empty string -> null', readOpportunityNumber(f('x', { fieldValueNumber: '' }), 'x'), null);
  check('null -> null', readOpportunityNumber(f('x', { fieldValueNumber: null }), 'x'), null);
  check('undefined key -> null', readOpportunityNumber(f('x', {}), 'x'), null);
  check('non-numeric string -> null', readOpportunityNumber(f('x', { fieldValueNumber: 'abc' }), 'x'), null);
  /* NEVER coalesces across representations -- a value parked on `value` or
     `fieldValue` is NOT read. This is the half of the contract that keeps the
     rail and the resolver reading the same key. */
  check('does NOT read `value`', readOpportunityNumber(f('x', { value: 165000 }), 'x'), null);
  check('does NOT read `fieldValue`', readOpportunityNumber(f('x', { fieldValue: 165000 }), 'x'), null);
  check('zero is a real value, not absence', readOpportunityNumber(f('x', { fieldValueNumber: 0 }), 'x'), 0);
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
