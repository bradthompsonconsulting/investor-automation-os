/**
 * O1 session-local disposition override -- test runner.
 *
 * Compiles the TypeScript module to a temp directory, loads the emitted
 * JavaScript, and runs deterministic table-driven cases against a FAKE Storage.
 * No GHL, no network, no browser, no fixture. Exits nonzero on any failure.
 *
 * app/package.json sets "type": "module", so the temp directory is given its
 * own package.json declaring commonjs -- same reason as
 * test-underwriting-core.cjs, which this follows.
 *
 * ⚠ PARTIAL VERIFICATION, STATED. This proves the MODULE behaves. It does not
 * prove the Dashboard memo consumes it, which is exactly the exhaustive-deps
 * gap at Dashboard.tsx L462/L526/L535 where a dependency the linter believes
 * spurious is the only thing keeping exclusion #3 session-current. A2 of the
 * Board 4 measurement established there is no live-harness path to a
 * session-local behaviour without making a read-only harness write, which is a
 * larger decision than Board 4. This is the coverage that exists; it is not the
 * coverage anyone should claim.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-disposition-override-test');
const SRC = path.join(APP, 'src', 'lib', 'dispositionOverride.ts');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + SRC + '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const compiled = path.join(TMP, 'dispositionOverride.js');
if (!fs.existsSync(compiled)) {
  console.error('ABORT: expected compiled output at ' + compiled);
  cleanup();
  process.exit(11);
}

const {
  readOverrides, recordOverride, effectiveDisposition, DISPOSITION_OVERRIDE_TTL_MS,
} = require(compiled);

/** Literal call-site count taken from the finished file, never back-filled from a passing run.
 *  21 = ttl(1) + readOverrides(5) + recordOverride(4) + ttl/pruning(5) + effectiveDisposition(6).
 *  Counted by enumerating the check( sites in this file, not from a run's output. */
const FLOOR = 21;

let checksRun = 0;
let failures = 0;
const names = new Set();
function check(name, ok, detail) {
  checksRun++;
  names.add(name);
  if (ok) console.log('PASS  ' + name + '  ' + (detail || ''));
  else { failures++; console.log('FAIL  ' + name + '  ' + (detail || '')); }
}

/** Minimal Storage double. Also usable to simulate a throwing / absent store. */
function fakeStorage(initial) {
  let raw = initial === undefined ? null : initial;
  return {
    getItem: () => raw,
    setItem: (_k, v) => { raw = v; },
    _raw: () => raw,
  };
}
const throwingStorage = {
  getItem() { throw new Error('private mode'); },
  setItem() { throw new Error('private mode'); },
};

const T0 = Date.parse('2026-08-28T12:00:00.000Z');
const TTL = DISPOSITION_OVERRIDE_TTL_MS;

check('ttl-is-five-minutes', TTL === 300000, 'ttl=' + TTL);

// ── readOverrides ──────────────────────────────────────────────────────────
check('read-empty-storage-yields-empty',
  Object.keys(readOverrides(fakeStorage(), T0)).length === 0, 'no key set');

check('read-null-storage-yields-empty',
  Object.keys(readOverrides(null, T0)).length === 0, 'storage null');

check('read-throwing-storage-yields-empty',
  Object.keys(readOverrides(throwingStorage, T0)).length === 0, 'getItem throws');

check('read-malformed-json-yields-empty',
  Object.keys(readOverrides(fakeStorage('{not json'), T0)).length === 0, 'unparseable');

check('read-array-payload-yields-empty',
  Object.keys(readOverrides(fakeStorage('[1,2,3]'), T0)).length === 0, 'array rejected');

// ── recordOverride ─────────────────────────────────────────────────────────
{
  const s = fakeStorage();
  recordOverride(s, 'c1', 'No Answer', new Date(T0).toISOString(), T0);
  const got = readOverrides(s, T0);
  check('record-then-read-roundtrips',
    got.c1 && got.c1.disposition === 'No Answer', JSON.stringify(got.c1 || null));
}
{
  const s = fakeStorage();
  recordOverride(s, '', 'No Answer', new Date(T0).toISOString(), T0);
  recordOverride(s, 'c1', '', new Date(T0).toISOString(), T0);
  check('record-rejects-empty-id-or-disposition',
    Object.keys(readOverrides(s, T0)).length === 0, 'both no-ops');
}
{
  const s = fakeStorage();
  recordOverride(s, 'c1', 'No Answer', new Date(T0).toISOString(), T0);
  recordOverride(s, 'c1', 'Voicemail', new Date(T0 + 1000).toISOString(), T0 + 1000);
  const got = readOverrides(s, T0 + 1000);
  check('record-overwrites-same-contact',
    got.c1.disposition === 'Voicemail', got.c1.disposition);
}
{
  const s = fakeStorage();
  recordOverride(s, 'c1', 'No Answer', new Date(T0).toISOString(), T0);
  recordOverride(s, 'c2', 'Follow Up', new Date(T0).toISOString(), T0);
  check('record-keeps-contacts-independent',
    Object.keys(readOverrides(s, T0)).length === 2, 'two entries');
}

// ── TTL and pruning ────────────────────────────────────────────────────────
{
  const s = fakeStorage();
  recordOverride(s, 'c1', 'No Answer', new Date(T0).toISOString(), T0);
  check('entry-live-just-inside-ttl',
    readOverrides(s, T0 + TTL - 1).c1 !== undefined, 'now = at + ttl - 1ms');
}
{
  const s = fakeStorage();
  recordOverride(s, 'c1', 'No Answer', new Date(T0).toISOString(), T0);
  check('entry-expired-exactly-at-ttl',
    readOverrides(s, T0 + TTL).c1 === undefined, 'now = at + ttl');
}
{
  const s = fakeStorage();
  recordOverride(s, 'old', 'No Answer', new Date(T0).toISOString(), T0);
  recordOverride(s, 'new', 'Voicemail', new Date(T0 + TTL).toISOString(), T0 + TTL);
  const got = readOverrides(s, T0 + TTL + 1);
  check('prune-on-read-drops-only-expired',
    got.old === undefined && got.new !== undefined, 'old dropped, new kept');
  check('prune-on-read-persists-the-pruned-store',
    Object.keys(JSON.parse(s._raw())).length === 1, 'written back');
}
{
  const s = fakeStorage(JSON.stringify({ c1: { disposition: 'No Answer', at: 'not-a-date' } }));
  check('malformed-timestamp-treated-as-expired',
    readOverrides(s, T0).c1 === undefined, 'unparseable at');
}

// ── effectiveDisposition — the NEWER-OF rule ───────────────────────────────
const iso = (ms) => new Date(ms).toISOString();

check('effective-neither-source-yields-null',
  effectiveDisposition('', null, undefined, T0) === null, 'both absent');

check('effective-fetched-only',
  effectiveDisposition('Follow Up', iso(T0), undefined, T0) === 'Follow Up', 'no override');

check('effective-override-only',
  effectiveDisposition('', null, { disposition: 'No Answer', at: iso(T0) }, T0) === 'No Answer',
  'GHL has none yet');

check('effective-override-wins-when-newer',
  effectiveDisposition('Follow Up', iso(T0 - 60000), { disposition: 'No Answer', at: iso(T0) }, T0) === 'No Answer',
  'override newer by 60s');

check('effective-fetched-wins-once-ghl-catches-up',
  effectiveDisposition('No Answer', iso(T0 + 1000), { disposition: 'No Answer', at: iso(T0) }, T0 + 1000) === 'No Answer',
  'durable value newer');

check('effective-expired-override-ignored',
  effectiveDisposition('Follow Up', iso(T0 - 60000), { disposition: 'No Answer', at: iso(T0) }, T0 + TTL) === 'Follow Up',
  'override past ttl');

console.log('');
console.log('checksRun=' + checksRun + ' uniqueNames=' + names.size + ' failures=' + failures + ' floor=' + FLOOR);
cleanup();
if (names.size !== checksRun) { console.log('ABORT — name-collision detected'); process.exit(4); }
if (checksRun !== FLOOR) { console.log('ABORT — expected ' + FLOOR + ' checks, ran ' + checksRun); process.exit(2); }
if (failures > 0) { console.log('DISPOSITION OVERRIDE RED'); process.exit(1); }
console.log('OK');
