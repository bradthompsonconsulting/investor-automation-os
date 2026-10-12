/**
 * B15-09 (INV-108) -- startCurrentRead: only the current read reports.
 *
 * Offline. Compiles src/lib/current-read.ts and drives it with deferred
 * promises settled in any order, the way the Pipeline effect uses it (the
 * effect cleanup is the cancel function: React calls it before re-running on
 * a read recovery, and on unmount). The browser-level proof through the real
 * page is test-pipeline-requests.cjs.
 *
 * NEGATIVE CONTROL (in this file): the same scenarios run against the
 * unguarded `.then().catch().finally()` chain the Pipeline used before, and
 * must show it leaking the stale results.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-current-read-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/current-read.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck', '--lib', 'es2020',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}
const { startCurrentRead } = require(path.join(TMP, 'src/lib/current-read.js'));
fs.rmSync(TMP, { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 11;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const settle = () => new Promise((r) => setImmediate(r));
const recorder = (log, tag) => ({ data: (v) => log.push(`${tag}:data:${v}`), error: (e) => log.push(`${tag}:error:${e.message}`), settled: () => log.push(`${tag}:settled`) });

/** The Pipeline's previous effect body, unguarded; returns a cleanup that does nothing (it had none). */
function previousChain(read, on) {
  read().then((v) => on.data(v)).catch((e) => on.error(e)).finally(() => on.settled());
  return () => {};
}

/** A read recovery: the older read is cancelled when the effect re-runs, then both settle in the given order. */
async function recovery(start, settleOrder) {
  const log = [];
  const older = deferred();
  const newer = deferred();
  const cancelOlder = start(() => older.promise, recorder(log, 'older'));
  cancelOlder();
  start(() => newer.promise, recorder(log, 'newer'));
  for (const step of settleOrder) {
    if (step === 'newer-ok') newer.resolve('NEW');
    if (step === 'newer-fail') newer.reject(new Error('newer failed'));
    if (step === 'older-ok') older.resolve('STALE');
    if (step === 'older-fail') older.reject(new Error('older failed'));
    await settle();
  }
  return log;
}

async function unmount(start, outcome) {
  const log = [];
  const only = deferred();
  const cancel = start(() => only.promise, recorder(log, 'left'));
  cancel();
  if (outcome === 'ok') only.resolve('STALE'); else only.reject(new Error('late failure'));
  await settle();
  return log;
}

(async () => {
  // ── The guarded helper ──────────────────────────────────────────────────────
  check('reversed order: the newer read reports; the older success arriving last is ignored',
    await recovery(startCurrentRead, ['newer-ok', 'older-ok']), ['newer:data:NEW', 'newer:settled']);
  check('stale failure: an older failure after the newer success is ignored (no error, no settled)',
    await recovery(startCurrentRead, ['newer-ok', 'older-fail']), ['newer:data:NEW', 'newer:settled']);
  check('an older success while the newer read is pending changes nothing until the newer one settles',
    await recovery(startCurrentRead, ['older-ok', 'newer-ok']), ['newer:data:NEW', 'newer:settled']);
  check('the current read\'s own failure is reported, and a stale success after it is ignored',
    await recovery(startCurrentRead, ['newer-fail', 'older-ok']), ['newer:error:newer failed', 'newer:settled']);
  check('unmount: a success after the cleanup reports nothing (no data, no settled)', await unmount(startCurrentRead, 'ok'), []);
  check('unmount: a failure after the cleanup reports nothing (no error, no settled)', await unmount(startCurrentRead, 'fail'), []);
  {
    const log = [];
    const d = deferred();
    startCurrentRead(() => d.promise, { ...recorder(log, 'cur'), data: () => { throw new Error('render threw'); } });
    d.resolve('X');
    await settle();
    check('as before, a throwing data handler is reported to error, then settled', log, ['cur:error:render threw', 'cur:settled']);
  }
  {
    const log = [];
    const d = deferred();
    startCurrentRead(() => d.promise, { ...recorder(log, 'cur'), error: (e) => log.push(`cur:error:${e instanceof Error}:${e.message}`) });
    d.reject('plain string');
    await settle();
    check('a non-Error rejection reaches error as an Error', log, ['cur:error:true:plain string', 'cur:settled']);
  }

  // ── Negative control: the previous unguarded chain leaks ────────────────────
  check('CONTROL previous chain: the older success arriving last overwrites the newer rows',
    (await recovery(previousChain, ['newer-ok', 'older-ok'])).slice(-2), ['older:data:STALE', 'older:settled']);
  check('CONTROL previous chain: the older failure arriving last replaces them with an error',
    (await recovery(previousChain, ['newer-ok', 'older-fail'])).slice(-2), ['older:error:older failed', 'older:settled']);
  check('CONTROL previous chain: a read finishing after unmount still reports', await unmount(previousChain, 'ok'), ['left:data:STALE', 'left:settled']);

  console.log('');
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
  if (checks !== FLOOR) {
    console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
    process.exit(2);
  }
  if (failures > 0) { console.error('FAILED'); process.exit(1); }
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
