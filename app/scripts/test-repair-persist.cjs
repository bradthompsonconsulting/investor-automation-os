/**
 * Repair Estimation V1 persistence boundary -- test runner. INV-13.
 *
 * Compiles the boundary module to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases against an injected
 * mock client. NO GHL, no network, no fixture, no Production mutation: the
 * real `ghl` client is never imported here, and the mock's contacts object is
 * a Proxy that records EVERY property touched, so "no prohibited side effect"
 * is measured rather than asserted.
 *
 * app/package.json sets "type": "module", so the temp directory is given its
 * own package.json declaring commonjs.
 *
 * The readback field id under test is deliberately opaque. That the real
 * wiring addresses `estimated_repairs` and nothing else is proved by the
 * static checks in section 8, against the shipped source.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-repair-persist-test');
const SRC = path.join(APP, 'src', 'lib', 'repair-estimation');
const PAGE = path.join(APP, 'src', 'pages', 'UnderwritingWorkspace.tsx');
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

const { persistGate, persistApprovedRepairTotal } = require(compiled);

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 60;
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

const CONTACT = 'contact_under_test';
const FIELD = 'field_under_test';
const NO_SLEEP = () => Promise.resolve();

const APPROVED = (total, revision) => ({ kind: 'approved', total: total, revision: revision });
const NOT_APPROVED = { kind: 'none' };

/**
 * A client exposing exactly the two members the boundary is allowed to use.
 * The Proxy records every property read, so a reach for any other setter --
 * setARV, notes.create, an opportunity method, anything offer_-shaped --
 * shows up as a touched key even if the call itself would have thrown.
 */
function mockClient(opts) {
  const options = opts || {};
  const touched = [];
  const puts = [];
  let reads = 0;
  const target = {
    setEstimatedRepairs: function (id, value) {
      puts.push({ id: id, value: value });
      return options.putThrows
        ? Promise.reject(new Error('PUT 500'))
        : Promise.resolve({});
    },
    getDetail: function (id) {
      reads++;
      if (options.readback === 'throw') return Promise.reject(new Error('GET 502'));
      if (options.readback === 'absent') return Promise.resolve({ customFields: [] });
      if (options.readback === 'mismatch') {
        return Promise.resolve({ customFields: [{ id: FIELD, value: 999 }] });
      }
      return Promise.resolve({ customFields: [{ id: id === CONTACT ? FIELD : FIELD, value: options.stored }] });
    },
  };
  const contacts = new Proxy(target, {
    get: function (t, prop) {
      if (typeof prop === 'string') touched.push(prop);
      return t[prop];
    },
  });
  return {
    client: { contacts: contacts },
    touched: touched,
    puts: puts,
    readCount: function () { return reads; },
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

// ---- 5. Unapproved -> NO WRITE. Nothing reaches the carrier at all.
(async function () {
  const m = mockClient({ stored: 41000 });
  const r = await persistApprovedRepairTotal(
    m.client, CONTACT, FIELD, persistGate(NOT_APPROVED, 0, 41000), NO_SLEEP);
  check('unapproved result is not ok', r.ok, false);
  check('unapproved stage is blocked', r.stage, 'blocked');
  check('unapproved reports nothing written', r.written, false);
  check('unapproved issued no PUT', m.puts.length, 0);
  check('unapproved issued no read', m.readCount(), 0);
  check('unapproved touched no client member', m.touched, []);

  const stale = mockClient({ stored: 41000 });
  const r2 = await persistApprovedRepairTotal(
    stale.client, CONTACT, FIELD, persistGate(APPROVED(41000, 1), 2, 41000), NO_SLEEP);
  check('stale approval issued no PUT', stale.puts.length, 0);
  check('stale approval stage is blocked', r2.stage, 'blocked');

  const drift = mockClient({ stored: 41000 });
  await persistApprovedRepairTotal(
    drift.client, CONTACT, FIELD, persistGate(APPROVED(41000, 1), 1, 46000), NO_SLEEP);
  check('drifted approval issued no PUT', drift.puts.length, 0);

  // ---- 6. Approved -> WRITE ALLOWED, once, with exactly the approved value.
  const w = mockClient({ stored: 41000 });
  const ok = await persistApprovedRepairTotal(
    w.client, CONTACT, FIELD, persistGate(APPROVED(41000, 1), 1, 41000), NO_SLEEP);
  check('approved write succeeds', ok.ok, true);
  check('approved write is confirmed by readback', ok.confidence, 'saved');
  check('approved write reports the value', ok.value, 41000);
  check('exactly one PUT was issued', w.puts.length, 1);
  check('the PUT carried the approved contact', w.puts[0].id, CONTACT);
  check('the PUT carried the approved total', w.puts[0].value, 41000);
  check('the PUT carried a number, not a string', typeof w.puts[0].value, 'number');
  check('readback ran once when it matched immediately', w.readCount(), 1);

  // ---- 7. Only the two permitted members are ever touched.
  const unique = w.touched.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  check('only setEstimatedRepairs and getDetail were touched', unique, ['getDetail', 'setEstimatedRepairs']);

  // ---- 8. Failure behaviour is explicit, and says whether a write left.
  const putFail = mockClient({ putThrows: true });
  const pf = await persistApprovedRepairTotal(
    putFail.client, CONTACT, FIELD, persistGate(APPROVED(41000, 1), 1, 41000), NO_SLEEP);
  check('PUT failure is not ok', pf.ok, false);
  check('PUT failure stage is write', pf.stage, 'write');
  check('PUT failure reports nothing written', pf.written, false);
  check('PUT failure surfaces the transport error', pf.error.indexOf('PUT 500') !== -1, true);
  check('PUT failure attempted no readback', putFail.readCount(), 0);

  const readFail = mockClient({ readback: 'throw' });
  const rf = await persistApprovedRepairTotal(
    readFail.client, CONTACT, FIELD, persistGate(APPROVED(41000, 1), 1, 41000), NO_SLEEP);
  check('unreadable GHL is not ok', rf.ok, false);
  check('unreadable GHL stage is unverified', rf.stage, 'unverified');
  check('unverified admits a write did leave', rf.written, true);
  check('unverified surfaces the read error', rf.error.indexOf('GET 502') !== -1, true);
  check('unverified bounded the poll at three', readFail.readCount(), 3);
  check('unverified never repeated the PUT', readFail.puts.length, 1);

  const mismatch = mockClient({ readback: 'mismatch' });
  const mm = await persistApprovedRepairTotal(
    mismatch.client, CONTACT, FIELD, persistGate(APPROVED(41000, 1), 1, 41000), NO_SLEEP);
  check('a completed read that never matched is ok-but-unconfirmed', mm.ok, true);
  check('mismatch confidence is unconfirmed', mm.confidence, 'unconfirmed');
  check('mismatch bounded the poll at three', mismatch.readCount(), 3);
  check('mismatch never repeated the PUT', mismatch.puts.length, 1);

  const absent = mockClient({ readback: 'absent' });
  const ab = await persistApprovedRepairTotal(
    absent.client, CONTACT, FIELD, persistGate(APPROVED(41000, 1), 1, 41000), NO_SLEEP);
  check('a missing field is not treated as saved', ab.confidence, 'unconfirmed');
  check('missing field never repeated the PUT', absent.puts.length, 1);

  // ---- 9. Static contract checks against the shipped source.
  const stripComments = function (s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  };
  const persistCode = stripComments(fs.readFileSync(path.join(SRC, 'persist.ts'), 'utf8'));
  const pageCode = stripComments(fs.readFileSync(PAGE, 'utf8'));
  const ghlCode = stripComments(fs.readFileSync(GHL, 'utf8'));

  /* No other write is reachable from the boundary, and no carrier id is
     hardcoded in it -- the id it uses for the readback arrives as a parameter. */
  const forbidden = [
    'setARV', 'setCallDisposition', 'setCallRouting', 'setDispositionAt',
    'setLastCallAttempt', 'setCallbackDatetime', 'setPropertyNotes',
    '_putMonetaryField', '_putStringField', 'notes', 'opportunities',
    'offer_', 'workflow', 'OQnud97MfdxMcTgMVTgf', 'SU4n8ylrXnUm8xDi729R',
  ];
  const hits = forbidden.filter(function (t) { return persistCode.indexOf(t) !== -1; });
  check('the boundary reaches no other carrier or write', hits, []);

  check('the boundary names exactly one setter',
    (persistCode.match(/setEstimatedRepairs/g) || []).length, 2);
  check('the boundary issues exactly one PUT call site',
    (persistCode.match(/client\.contacts\.setEstimatedRepairs\(/g) || []).length, 1);

  /* The destination is the existing estimated_repairs carrier: the named
     setter resolves its own id, and the page hands that same id to the
     readback rather than inventing one. */
  check('the named setter resolves the estimated_repairs id itself',
    /setEstimatedRepairs:\s*\(contactId: string, value: number \| ""\) =>\s*ghl\.contacts\._putMonetaryField\(contactId, ESTIMATED_REPAIRS_ID, value\)/.test(ghlCode), true);
  check('ESTIMATED_REPAIRS_ID is the configured carrier, not a literal',
    /export const ESTIMATED_REPAIRS_ID = CONFIG\.fields\.estimatedRepairs/.test(ghlCode), true);
  check('the page hands the same carrier id to the readback',
    pageCode.indexOf('ghl, contactId, ESTIMATED_REPAIRS_ID,') !== -1, true);

  /* INV-13 added no new direct client call to the page: the persist path goes
     through the boundary module. These five are the pre-existing set. */
  const ghlCalls = (pageCode.match(/ghl\.(contacts|opportunities|notes|underwriting)\.[a-zA-Z_]+/g) || [])
    .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  check('the page still makes only its pre-existing client calls', ghlCalls, [
    'ghl.contacts.getDetail',
    'ghl.opportunities.listPipeline',
    'ghl.underwriting.policy',
    'ghl.underwriting.saveUnderwritingFields',
    'ghl.underwriting.setAssignmentMode',
  ]);

  /* Total only. No itemization is handed to the boundary or the carrier. */
  check('the boundary carries no line, risk or itemization',
    /\blines\b|unpricedRisks|byProvenance|components/.test(persistCode), false);
  check('the approved value is a single number',
    /kind: "allowed"; value: number/.test(fs.readFileSync(path.join(SRC, 'persist.ts'), 'utf8')), true);

  /* The harness itself never touches the real client or the network. */
  const selfCode = fs.readFileSync(__filename, 'utf8');
  check('this harness never imports the real ghl client',
    /require\([^)]*lib[\/\\]ghl/.test(selfCode), false);
  /* Needles are split so this check cannot match its own source and report a
     false positive, which is exactly what a single regex literal did here. */
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
