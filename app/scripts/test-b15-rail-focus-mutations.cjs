/**
 * Controls for scripts/test-b15-rail-focus.cjs: each mutation breaks the
 * rail scroll-padding fix IN THE DEV SERVER ONLY (no file is touched) and the
 * suite must FAIL, on the checks named below. A mutation that passes, or fails
 * only elsewhere, fails this runner.
 *
 *   off          -- hook not called: focus lands under the rail (the original defect)
 *   static       -- padding set once, never tracked: wrong after resize / rail growth
 *   nocleanup    -- previous value not restored on exit: padding leaks to other pages
 *   nodisconnect -- observer not disconnected on exit: it rewrites main's padding later
 *
 *   node scripts/test-b15-rail-focus-mutations.cjs
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SUITE = path.join(__dirname, 'test-b15-rail-focus.cjs');
const EXPECT = {
  off: [/leaves no focused control under the rail/, /scroll-padding-top == padding-top/],
  static: [/^(resize|grow) .*scroll-padding-top == padding-top/, /^(resize|grow) .*leaves no focused control under the rail/],
  nocleanup: [/^away \(Deal Calculator\): .*previous value/, /^away again: main's previous scroll padding \(7px\) restored/],
  nodisconnect: [/^away.*(previous value|still no scroll padding|still 7px)/],
};

let failures = 0;
for (const [name, patterns] of Object.entries(EXPECT)) {
  const r = spawnSync(process.execPath, [SUITE], { env: { ...process.env, RAIL_FOCUS_MUTATION: name }, encoding: 'utf8', timeout: 14 * 60_000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const failed = out.split('\n').filter((l) => l.startsWith('FAIL  ')).map((l) => l.slice(6));
  const applied = out.includes(`PASS  mutation ${name} applied in the dev server`);
  const summary = (out.match(/checks passed/) ? out.split('\n').find((l) => l.includes('checks passed')) : '(no summary)').trim();
  const missing = patterns.filter((p) => !failed.some((f) => p.test(f)));
  const ok = r.status === 1 && applied && missing.length === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  mutation ${name}: suite exit ${r.status}, applied ${applied}, ${failed.length} failing checks${missing.length ? `, expected failures NOT seen: ${missing.join(' ')}` : ''}`);
  console.log(`      ${summary}`);
  for (const f of failed.slice(0, 6)) console.log(`      FAIL ${f.slice(0, 160)}`);
  if (failed.length > 6) console.log(`      ... ${failed.length - 6} more`);
}
console.log(`\nB15 rail focus mutation controls: ${4 - failures}/4 caught`);
process.exit(failures ? 1 : 0);
