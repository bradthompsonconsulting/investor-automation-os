/**
 * Proof for test-current-offer-barrier.cjs's completion guard (harness only; offline).
 *
 * The suite must exit nonzero when any assertion fails, and when it ends before its completion summary -- in
 * particular when an await never settles, which empties the event loop and would otherwise let Node exit 0.
 * The guard is the process 'exit' event (event-driven, not a timer).
 *
 * Each case runs the REAL suite in a child process. Variants are made in memory from the suite's own text and
 * written next to it (so its relative requires resolve), run, and deleted. No live requests.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUITE = path.join(__dirname, 'test-current-offer-barrier.cjs');
const SUMMARY = /Current Offer durable barrier: (\d+)\/(\d+) checks passed/;
const GUARD_LINE = 'FAIL the suite ended before it finished (a wait never resolved)';
const START = '(async () => {\n';
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const source = fs.readFileSync(SUITE, 'utf8').replace(/\r\n/g, '\n');
const once = (s, a, b) => { if (s.split(a).length !== 2) throw new Error(`anchor not unique: ${a.slice(0, 40)}`); return s.replace(a, b); };
const inject = (line) => once(source, START, START + line + '\n');
function run(label, text) {
  const file = path.join(__dirname, `.exit-guard-${label}-${process.pid}.cjs`);
  fs.writeFileSync(file, text);
  try {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 240_000 });
    const out = `${r.stdout}\n${r.stderr}`; const m = out.match(SUMMARY);
    return { code: r.status, signal: r.signal, summary: m ? `${m[1]}/${m[2]}` : null, guard: out.includes(GUARD_LINE), ms: Date.now() - t0 };
  } finally { fs.rmSync(file, { force: true }); }
}

const assertions = (source.match(/\bawait check\('/g) || []).length;
check('G0 the guarded suite keeps all 45 assertions (await check( call sites) and adds only the guard', assertions === 45 && source.includes("process.on('exit'") && source.includes('finished = true;'), assertions);

const normal = run('normal', source);
check('G1 normal completion: exit 0, summary 45/45, no guard message', normal.code === 0 && normal.summary === '45/45' && !normal.guard, normal);

const failed = run('fail', inject("  await check('injected assertion failure (exit-guard proof)', () => { throw new Error('injected failure'); });"));
check('G2 an assertion failure: exit 1, summary 45/46', failed.code === 1 && failed.summary === '45/46', failed);

const hung = run('hang', inject('  await new Promise(() => {}); // injected: an await that never settles'));
check('G3 an await that never settles (the event loop empties): exit 1, the guard message, no summary', hung.code === 1 && hung.guard && hung.summary === null && hung.signal === null, hung);

const unguarded = once(once(inject('  await new Promise(() => {}); // injected: an await that never settles'),
  "process.on('exit', (code) => { if (!finished && code === 0) { console.error('FAIL the suite ended before it finished (a wait never resolved)'); process.exitCode = 1; } });\n", ''), 'let finished = false;\n', 'let finished = false; void finished;\n');
const control = run('unguarded', unguarded);
check('G4 control: the same unsettled await WITHOUT the guard exits 0 with no summary (the defect the guard closes)', control.code === 0 && control.summary === null && !control.guard, control);

const early = run('early-exit', inject('  process.exit(0); // injected: an exit before the summary'));
check('G5 a premature process.exit(0) before the summary: exit 1, the guard message', early.code === 1 && early.guard && early.summary === null, early);

console.log(`\nCurrent Offer barrier exit guard: ${checks - failures}/${checks} checks passed`);
process.exitCode = failures ? 1 : 0;
