/** Minimal offline test runner shared by the storage-correction suites. A suite that ends early FAILS. */
'use strict';
let count = 0;
let failures = 0;
let finished = false;
/* AbortSignal.timeout timers are unref'd: keep the loop alive while a suite runs (a real socket would). */
const keepAlive = setInterval(() => {}, 1_000);
/* ...but a wait that never resolves still FAILS, by a hard suite timeout. */
const limit = setTimeout(() => { console.error('FAIL the suite did not finish within its time limit (a wait never resolved)'); process.exit(1); }, Number(process.env.IAOS_SUITE_TIMEOUT_MS || 600_000));
const only = process.env.IAOS_ONLY ? new RegExp(process.env.IAOS_ONLY) : null;
process.on('exit', (code) => {
  if (!finished && code === 0) { console.error('FAIL the suite ended before it finished (a wait never resolved)'); process.exitCode = 1; }
});
async function check(name, fn) {
  if (only && !only.test(name)) return;
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n  ') : e)); }
}
function done(label) {
  finished = true;
  clearInterval(keepAlive);
  clearTimeout(limit);
  console.log(`\n${label}: ${count} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
}
module.exports = { check, done };
