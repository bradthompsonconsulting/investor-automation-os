/**
 * Controls for scripts/test-b15-06-seller-call-focus.cjs: each mutation breaks
 * the Seller Call focus fix or the Notes panel IN THE DEV SERVER ONLY (no file
 * is touched) and the suite must FAIL, on the checks named below. A mutation
 * that passes, or fails only elsewhere, fails this runner.
 *
 *   off            -- hook not called on Seller Call: focus lands under the bar (the defect)
 *   nopinned       -- side column not pinned: Tab into the sticky script / Notes moves the page
 *   static         -- nothing tracked: the bar's growth is missed
 *   nocleanup      -- main's previous scroll padding not restored on exit
 *   nofallback     -- always sticky, no reveal: the grown bar keeps covering focus
 *   noreveal       -- no focus handling (no reveal, no put-back)
 *   railjump       -- no put-back for focus entering the stuck bar
 *   nopinnedreveal -- no put-back for focus entering a pinned region
 *   nokeep         -- focus not kept clear when sticky returns
 *   nomodalitycleanup -- the keydown listener is left on the document
 *   notesopen      -- Notes starts open
 *   notesstale     -- the panel shows notes before THIS contact's load completed
 *   nofocusreturn  -- closing Notes does not return focus to the Notes button
 *
 *   node scripts/test-b15-06-seller-call-focus-mutations.cjs
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SUITE = path.join(__dirname, 'test-b15-06-seller-call-focus.cjs');
const EXPECT = {
  off: [/leaves no focused control under the bar/, /bar mode follows the clearance rule/],
  nopinned: [/entering the sticky side column moves nothing/],
  static: [/^1440x900 grown past the room: bar mode follows the clearance rule/, /^1440x900 a control taller than the room: the bar scrolls/],
  nocleanup: [/^cleanup: away from Seller Call, main's previous scroll padding/],
  nofallback: [/^1440x900 grown past the room: bar mode follows the clearance rule/, /^1440x900 grown past the room: .*every focused control fully visible/],
  noreveal: [/entering the stuck bar moves nothing/],
  railjump: [/entering the stuck bar moves nothing/],
  nopinnedreveal: [/entering the sticky side column moves nothing/],
  nokeep: [/^1440x900 tall control removed: sticky returns and the keyboard-focused control/],
  nomodalitycleanup: [/^cleanup: no keydown\/pointerdown modality listener left on the document/],
  notesopen: [/^notes: starts closed/],
  notesstale: [/^notes isolation: while the next contact loads/],
  nofocusreturn: [/focus returns to the Notes button/],
};

let failures = 0;
for (const [name, patterns] of Object.entries(EXPECT)) {
  const r = spawnSync(process.execPath, [SUITE], { env: { ...process.env, SC_FOCUS_MUTATION: name }, encoding: 'utf8', timeout: 16 * 60_000 });
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
console.log(`\nB15-06 Seller Call focus mutation controls: ${Object.keys(EXPECT).length - failures}/${Object.keys(EXPECT).length} caught`);
process.exit(failures ? 1 : 0);
