/**
 * INV-70 / B9-07A Phase 2 -- deterministic proof of Family 3's approved
 * ruling: Opportunity-first repairs, Contact fallback, and migration
 * conflict handling. Mocks and pure functions only; no GHL, no network.
 *
 * Three things are proven here:
 *  1. resolveDealFacts (unchanged, resolver.ts) already reads Opportunity
 *     first and Contact only as a fallback -- this was always PB-D55's
 *     design; what was missing was a writer, which is proven separately
 *     in test-repair-persist.cjs's now-63-check suite.
 *  2. classifyRepairsMigrationCandidate (migration.ts, new this phase)
 *     never proposes overwriting a non-empty Opportunity value, and
 *     reports a mismatch rather than silently choosing between two
 *     disagreeing non-empty values.
 *  3. summarizeRepairsMigration aggregates a batch of rows into the
 *     exact counts a migration report needs, without deciding anything
 *     beyond what each row's own classification already decided.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-repairs-canonicalization-test');
const RESOLVER = path.join(APP, 'src', 'lib', 'underwriting', 'resolver.ts');
const MIGRATION = path.join(APP, 'src', 'lib', 'repair-estimation', 'migration.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(
    `npx tsc "${RESOLVER}" "${MIGRATION}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const { resolveDealFacts } = require(path.join(TMP, 'underwriting', 'resolver.js'));
const { classifyRepairsMigrationCandidate, summarizeRepairsMigration } = require(path.join(TMP, 'repair-estimation', 'migration.js'));

const FLOOR = 22;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

/* -------------------------------------------------------------- */
/* 1. Opportunity-first repairs / Contact fallback                  */
/* -------------------------------------------------------------- */

const RESOLVED_MODE = { kind: 'value', value: 'standard', level: 'deal_override' };
function opp(repairsValue) {
  return {
    arv: { kind: 'value', value: 500000 },
    repairs: repairsValue === null ? { kind: 'unresolved', reason: 'absent on the opportunity' } : { kind: 'value', value: repairsValue },
    askingPrice: null,
    assignmentMode: RESOLVED_MODE,
    manualSpread: null,
  };
}
function contactSeeds(repairsValue) {
  return { arv: null, repairs: repairsValue, askingPrice: null };
}

{
  const facts = resolveDealFacts(opp(30000), contactSeeds(99999));
  check('Opportunity-first: Opportunity value wins when both present', facts.repairs, { kind: 'value', value: 30000 });
}
{
  const facts = resolveDealFacts(opp(30000), contactSeeds(null));
  check('Opportunity-first: Opportunity value used when Contact absent', facts.repairs, { kind: 'value', value: 30000 });
}
{
  const facts = resolveDealFacts(opp(null), contactSeeds(45000));
  check('Contact fallback: Contact seed used when Opportunity absent', facts.repairs, { kind: 'value', value: 45000 });
}
{
  const facts = resolveDealFacts(opp(null), contactSeeds(null));
  check('Both absent: repairs unresolved, reason names both carriers', facts.repairs.kind, 'unresolved');
  check('Both absent: reason mentions the opportunity', /opportunity/.test(facts.repairs.reason), true);
  check('Both absent: reason mentions the contact', /contact/.test(facts.repairs.reason), true);
}
{
  // Zero is a real, meaningful repairs figure (a deal genuinely needing no
  // repairs) and must not be treated as absent -- the seed helper checks
  // `opp.kind === "value"`, not truthiness, so this is a real risk to prove.
  const facts = resolveDealFacts(opp(0), contactSeeds(50000));
  check('Zero on the Opportunity is authoritative, not treated as absent', facts.repairs, { kind: 'value', value: 0 });
}

/* -------------------------------------------------------------- */
/* 2. Migration classification -- never overwrite, never choose     */
/* -------------------------------------------------------------- */

{
  const c = classifyRepairsMigrationCandidate({ contactValue: 40000, opportunityValue: null });
  check('backfill candidate: Opportunity empty, Contact populated', c, { kind: 'backfill_candidate', value: 40000 });
}
{
  const c = classifyRepairsMigrationCandidate({ contactValue: null, opportunityValue: null });
  check('nothing to do: both empty', c, { kind: 'nothing_to_do' });
}
{
  const c = classifyRepairsMigrationCandidate({ contactValue: 40000, opportunityValue: 40000 });
  check('already authoritative, values agree: no write proposed', c.kind, 'already_authoritative');
  check('already authoritative, values agree: matchesContact true', c.matchesContact, true);
}
{
  // THE conflict case this document's safety rule names explicitly: two
  // non-empty values that disagree. The function must never pick one --
  // it reports the mismatch and proposes NO write, because the Opportunity
  // is already authoritative regardless of what Contact holds.
  const c = classifyRepairsMigrationCandidate({ contactValue: 25000, opportunityValue: 40000 });
  check('conflict: already authoritative even when values disagree', c.kind, 'already_authoritative');
  check('conflict: the Opportunity value is reported, never the Contact one', c.opportunityValue, 40000);
  check('conflict: matchesContact is false, flagged not silently resolved', c.matchesContact, false);
}
{
  const c = classifyRepairsMigrationCandidate({ contactValue: 0, opportunityValue: null });
  check('zero Contact value is a real backfill candidate, not treated as absent', c, { kind: 'backfill_candidate', value: 0 });
}
{
  const c = classifyRepairsMigrationCandidate({ contactValue: null, opportunityValue: 0 });
  check('zero Opportunity value is authoritative, not treated as absent', c, { kind: 'already_authoritative', opportunityValue: 0, matchesContact: false });
}

/* -------------------------------------------------------------- */
/* 3. Batch summary                                                  */
/* -------------------------------------------------------------- */

{
  const rows = [
    { contactId: 'c1', opportunityId: 'o1', contactValue: 10000, opportunityValue: null, classification: classifyRepairsMigrationCandidate({ contactValue: 10000, opportunityValue: null }) },
    { contactId: 'c2', opportunityId: 'o2', contactValue: null, opportunityValue: null, classification: classifyRepairsMigrationCandidate({ contactValue: null, opportunityValue: null }) },
    { contactId: 'c3', opportunityId: 'o3', contactValue: 5000, opportunityValue: 5000, classification: classifyRepairsMigrationCandidate({ contactValue: 5000, opportunityValue: 5000 }) },
    { contactId: 'c4', opportunityId: 'o4', contactValue: 5000, opportunityValue: 9000, classification: classifyRepairsMigrationCandidate({ contactValue: 5000, opportunityValue: 9000 }) },
  ];
  const summary = summarizeRepairsMigration(rows);
  check('summary total', summary.total, 4);
  check('summary backfillCandidates', summary.backfillCandidates, 1);
  check('summary alreadyAuthoritative', summary.alreadyAuthoritative, 2);
  check('summary alreadyAuthoritativeMismatched (the conflict count)', summary.alreadyAuthoritativeMismatched, 1);
  check('summary nothingToDo', summary.nothingToDo, 1);
  // No write is ever proposed for a mismatched row -- the summary counts
  // it, it does not resolve it. Proven by construction: summarizeRepairsMigration
  // has no write-producing branch at all, only counters.
  check('summary function source contains no write call', !/ghl\.|fetch\(|PUT|POST/.test(fs.readFileSync(MIGRATION, 'utf8')), true);
}

cleanup();
console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) {
  console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}. A case was added or removed without updating FLOOR.`);
  process.exit(2);
}
if (failures) { console.error('FAILED'); process.exit(1); }
console.log('OK');
