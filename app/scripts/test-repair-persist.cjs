/**
 * Repair Estimation persistence boundary -- test runner. INV-13, extended
 * INV-70 / B9-07A Phase 2, and rewritten Phase 2 correction round 3.
 *
 * Compiles the boundary module to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases against an injected
 * mock client. NO GHL, no network, no fixture, no Production mutation.
 *
 * CORRECTION ROUND 3 REWRITE. This file previously tested TWO boundaries
 * (Contact via `persistApprovedRepairTotal`, and Opportunity via
 * `persistApprovedRepairTotalToOpportunity`). The Contact boundary --
 * function, interface, and its dynamic mock tests -- is DELETED, not
 * merely untested: `contact.estimated_repairs` is now Family 3's
 * read-only legacy fallback/migration input, and no application code may
 * write it (see `test-legacy-repairs-writer-removed.cjs` for the
 * repository-wide proof). This file now tests the ONE remaining boundary,
 * `persistApprovedRepairTotalToOpportunity`, with the SAME dynamic
 * mock-based rigor the deleted Contact tests had -- gate interaction,
 * exactly-once write, member isolation, and both failure modes (a thrown
 * error and a resolved `{ok: false}`) -- which the Opportunity path had
 * NOT previously received (only static source-shape checks and the live
 * inert-proof cycle, recorded in the canonicalization document).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-repair-persist-test');
const SRC = path.join(APP, 'src', 'lib', 'repair-estimation');
const PAGE = path.join(APP, 'src', 'pages', 'UnderwritingWorkspace.tsx');
const DEAL_CALC = path.join(APP, 'src', 'pages', 'DealCalculator.tsx');
const GHL = path.join(APP, 'src', 'lib', 'ghl.ts');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + path.join(SRC, 'persist.ts') +
    '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const compiled = path.join(TMP, 'persist.js');
if (!fs.existsSync(compiled)) {
  console.error('ABORT: expected compiled output at ' + compiled);
  cleanup();
  process.exit(11);
}

const { persistGate, persistApprovedRepairTotalToOpportunity } = require(compiled);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 51;
let failures = 0;
let checks = 0;

function check(name, actual, expected, tol) {
  checks++;
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) <= (tol === undefined ? 1e-6 : tol)
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log('PASS  ' + name);
  } else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

const OPPORTUNITY = 'opportunity_under_test';

const APPROVED = (total, revision) => ({ kind: 'approved', total: total, revision: revision });
const NOT_APPROVED = { kind: 'none' };

/**
 * A client exposing exactly the one member the Opportunity boundary is
 * allowed to use. The Proxy records every property read, so a reach for
 * any other setter -- setEstimatedRepairs, notes.create, a Contact
 * method, anything offer_-shaped -- shows up as a touched key even if the
 * call itself would have thrown.
 */
function mockOpportunityClient(opts) {
  const options = opts || {};
  const touched = [];
  const calls = [];
  const target = {
    setRepairEstimate: function (id, value) {
      calls.push({ id: id, value: value });
      if (options.throws) return Promise.reject(new Error('PUT 500'));
      return Promise.resolve({ ok: options.ok === undefined ? true : options.ok });
    },
  };
  const opportunities = new Proxy(target, {
    get: function (t, prop) {
      if (typeof prop === 'string') touched.push(prop);
      return t[prop];
    },
  });
  return {
    client: { opportunities: opportunities },
    touched: touched,
    calls: calls,
  };
}

// ---- 1. The gate: unapproved state cannot produce a write decision.
{
  check('no approval is blocked', persistGate(NOT_APPROVED, 0, 41000).kind, 'blocked');
  check('no approval names the reason',
    persistGate(NOT_APPROVED, 0, 41000).reason.indexOf('no operator approval') === 0, true);
  check('no approval carries no value', persistGate(NOT_APPROVED, 0, 41000).value, undefined);
}

// ---- 2. The gate: a stale approval cannot write.
{
  const stale = persistGate(APPROVED(41000, 3), 4, 41000);
  check('approval from an earlier revision is blocked', stale.kind, 'blocked');
  check('stale approval explains itself', stale.reason.indexOf('changed after approval') !== -1, true);

  const drifted = persistGate(APPROVED(41000, 3), 3, 46000);
  check('approved total no longer matching is blocked', drifted.kind, 'blocked');
  check('drifted approval explains itself', drifted.reason.indexOf('no longer matches') !== -1, true);
}

// ---- 3. The gate: an invalid amount cannot write.
{
  check('NaN total is blocked', persistGate(APPROVED(Number.NaN, 1), 1, Number.NaN).kind, 'blocked');
  check('Infinity total is blocked', persistGate(APPROVED(Number.POSITIVE_INFINITY, 1), 1, Number.POSITIVE_INFINITY).kind, 'blocked');
  check('negative total is blocked', persistGate(APPROVED(-1, 1), 1, -1).kind, 'blocked');
}

// ---- 4. The gate: a current approval authorizes exactly its own number.
{
  const ok = persistGate(APPROVED(41000, 2), 2, 41000);
  check('current approval is allowed', ok.kind, 'allowed');
  check('allowed value is the approved total', ok.value, 41000);
  check('zero is a legitimate approved total', persistGate(APPROVED(0, 0), 0, 0).kind, 'allowed');
  check('zero allowed value', persistGate(APPROVED(0, 0), 0, 0).value, 0);
}

(async function () {
  // ---- 5. Unapproved -> NO WRITE. Nothing reaches the carrier at all.
  {
    const m = mockOpportunityClient({});
    const r = await persistApprovedRepairTotalToOpportunity(
      m.client, OPPORTUNITY, persistGate(NOT_APPROVED, 0, 41000));
    check('unapproved result is not ok', r.ok, false);
    check('unapproved stage is blocked', r.stage, 'blocked');
    check('unapproved reports nothing written', r.written, false);
    check('unapproved issued no write call', m.calls.length, 0);
    check('unapproved touched no client member', m.touched, []);
  }
  {
    const stale = mockOpportunityClient({});
    const r2 = await persistApprovedRepairTotalToOpportunity(
      stale.client, OPPORTUNITY, persistGate(APPROVED(41000, 1), 2, 41000));
    check('stale approval issued no write call', stale.calls.length, 0);
    check('stale approval stage is blocked', r2.stage, 'blocked');
  }

  // ---- 6. Approved -> WRITE ALLOWED, once, with exactly the approved value.
  {
    const w = mockOpportunityClient({ ok: true });
    const ok = await persistApprovedRepairTotalToOpportunity(
      w.client, OPPORTUNITY, persistGate(APPROVED(41000, 1), 1, 41000));
    check('approved write succeeds', ok.ok, true);
    check('approved write is confirmed (setRepairEstimate already verified the readback internally)', ok.confidence, 'saved');
    check('approved write reports the value', ok.value, 41000);
    check('exactly one write call was issued', w.calls.length, 1);
    check('the write carried the approved opportunity id', w.calls[0].id, OPPORTUNITY);
    check('the write carried the approved total', w.calls[0].value, 41000);
    check('the write carried a number, not a string', typeof w.calls[0].value, 'number');

    // ---- 7. Only the one permitted member is ever touched.
    const unique = w.touched.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    check('only setRepairEstimate was touched', unique, ['setRepairEstimate']);
  }

  // ---- 8. Failure behaviour is explicit, and says whether a write left --
  // BOTH failure modes: a thrown error, and a resolved {ok: false}.
  {
    const putFail = mockOpportunityClient({ throws: true });
    const pf = await persistApprovedRepairTotalToOpportunity(
      putFail.client, OPPORTUNITY, persistGate(APPROVED(41000, 1), 1, 41000));
    check('a thrown write error is not ok', pf.ok, false);
    check('a thrown write error stage is write', pf.stage, 'write');
    check('a thrown write error reports nothing written', pf.written, false);
    check('a thrown write error surfaces the transport error', pf.error.indexOf('PUT 500') !== -1, true);
  }
  {
    const unconfirmed = mockOpportunityClient({ ok: false });
    const uc = await persistApprovedRepairTotalToOpportunity(
      unconfirmed.client, OPPORTUNITY, persistGate(APPROVED(41000, 1), 1, 41000));
    check('a resolved {ok: false} is not ok', uc.ok, false);
    check('a resolved {ok: false} stage is unverified', uc.stage, 'unverified');
    check('a resolved {ok: false} admits a write DID leave (the PUT itself succeeded; only readback confirmation failed)', uc.written, true);
    check('a resolved {ok: false} names the opportunity readback specifically', /opportunity readback/.test(uc.error), true);
  }

  // ---- 9. Static contract checks against the shipped source.
  const stripComments = function (s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  };
  const persistCode = stripComments(fs.readFileSync(path.join(SRC, 'persist.ts'), 'utf8'));
  const pageCode = stripComments(fs.readFileSync(PAGE, 'utf8'));
  const dealCalcCode = stripComments(fs.readFileSync(DEAL_CALC, 'utf8'));
  const ghlCode = stripComments(fs.readFileSync(GHL, 'utf8'));

  check('the Contact boundary function no longer exists in persist.ts', /persistApprovedRepairTotal\(/.test(persistCode.replace(/persistApprovedRepairTotalToOpportunity/g, '')), false);
  check('the Contact boundary interface no longer exists in persist.ts', /RepairPersistGhl\b/.test(persistCode.replace(/RepairPersistGhlOpportunity/g, '')), false);
  check('the ONE remaining boundary reaches no other carrier or write', [
    'setARV', 'setEstimatedRepairs', 'setCallDisposition', 'setCallRouting', 'setDispositionAt',
    'setLastCallAttempt', 'setCallbackDatetime', 'setPropertyNotes', 'getDetail',
    '_putMonetaryField', '_putStringField', 'notes.create', 'offer_', 'workflow',
    'OQnud97MfdxMcTgMVTgf', 'SU4n8ylrXnUm8xDi729R',
  ].filter(function (t) { return persistCode.indexOf(t) !== -1; }), []);
  check('the boundary names exactly one setter',
    (persistCode.match(/setRepairEstimate/g) || []).length, 2);
  check('the boundary issues exactly one write call site',
    (persistCode.match(/client\.opportunities\.setRepairEstimate\(/g) || []).length, 1);

  check('the named setter resolves the opportunity repairs id itself, in ghl.ts',
    /setRepairEstimate:\s*async[\s\S]{0,200}CONFIG\.opportunityFacts\.repairs/.test(ghlCode), true);

  check('UnderwritingWorkspace.tsx (the real, Opportunity-bound flow) calls the Opportunity boundary with no field id of its own',
    pageCode.indexOf('ghl, opportunityId,') !== -1, true);
  check('UnderwritingWorkspace.tsx no longer references the Contact repairs carrier id',
    pageCode.indexOf('ESTIMATED_REPAIRS_ID') !== -1, false);
  check('UnderwritingWorkspace.tsx still makes only its expected client calls',
    (pageCode.match(/ghl\.(contacts|opportunities|notes|underwriting)\.[a-zA-Z_]+/g) || [])
      .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(),
    [
      'ghl.contacts.getDetail',
      'ghl.opportunities.listPipeline',
      'ghl.underwriting.policy',
      'ghl.underwriting.saveUnderwritingFields',
      'ghl.underwriting.setAssignmentMode',
    ]);

  check('DealCalculator.tsx (the standalone scratchpad, no Opportunity context) makes NO repair-persistence call of any kind',
    /persistApprovedRepairTotal|persistGate|setEstimatedRepairs|setRepairEstimate/.test(dealCalcCode), false);

  check('the boundary carries no line, risk or itemization',
    /\blines\b|unpricedRisks|byProvenance|components/.test(persistCode), false);
  check('the approved value is a single number',
    /kind: "allowed"; value: number/.test(fs.readFileSync(path.join(SRC, 'persist.ts'), 'utf8')), true);

  /* The harness itself never touches the real client or the network. */
  const selfCode = fs.readFileSync(__filename, 'utf8');
  check('this harness never imports the real ghl client',
    /require\([^)]*lib[\/\\]ghl/.test(selfCode), false);
  const netNeedles = ['ht' + 'tp://', 'ht' + 'tps://', 'fet' + 'ch(', 'ax' + 'ios', 'node-' + 'fetch'];
  const selfStripped = stripComments(selfCode);
  check('this harness opens no network client',
    netNeedles.filter(function (n) { return selfStripped.indexOf(n) !== -1; }), []);

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
})().catch(function (e) {
  console.error('ABORT: harness threw: ' + (e && e.stack ? e.stack : e));
  cleanup();
  process.exit(12);
});
