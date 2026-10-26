/**
 * Controls for scripts/test-b15-rail-focus.cjs: each mutation breaks the
 * rail clearance fix IN THE DEV SERVER ONLY (no file is touched) and the
 * suite must FAIL, on the checks named below. A mutation that passes, or fails
 * only elsewhere, fails this runner.
 *
 *   off          -- hook not called: focus lands under the rail (the original defect)
 *   static       -- nothing tracked: wrong after resize / rail growth / enabling
 *   nocleanup    -- previous value not restored on exit: padding leaks to other pages
 *   nodisconnect -- ResizeObserver not disconnected on exit: it rewrites main's padding later
 *   nomodisconnect -- MutationObserver not disconnected on exit: same, on DOM changes
 *   nofallback   -- the a0fd10a implementation (always sticky, no reveal): fails the
 *                   clearance rule and the full-visibility check where the rail leaves no room
 *   noreturn     -- once released the rail never sticks again: fails 'rail mode is sticky'
 *   noreveal     -- no focus handling: fails full visibility and the stuck-rail entry
 *   nolistenercleanup -- focus listener left on <main> after exit
 *   pointerreveal -- reveal ignores modality: a pointer click scrolls (Bones 1)
 *   intoview     -- the 5b57be0 reveal (scrollIntoView): scroll calls beyond main.scrollTop (Bones 4)
 *   railjump     -- Tab into the stuck rail moves the page (Spock 1)
 *   nobound      -- the reveal adjusts a control taller than the band (Bones 2)
 *   nomutations  -- enabling / showing a taller control without resize is missed (Bones 3)
 *   nokeep       -- focus left under the rail when sticky returns (Spock 2)
 *   nomodalitycleanup -- keydown listener left on the document after exit
 *
 *   node scripts/test-b15-rail-focus-mutations.cjs
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SUITE = path.join(__dirname, 'test-b15-rail-focus.cjs');
const EXPECT = {
  /* No hook: the rail carries no data-rail-mode, so the mode check fails and the
     suite takes the fallback branch (it never reaches the sticky padding check). */
  off: [/leaves no focused control under the rail/, /rail mode follows the clearance rule/],
  static: [/^(resize|grow) .*scroll-padding-top == padding-top/, /^(resize|grow) .*leaves no focused control under the rail/],
  nocleanup: [/^away \(Deal Calculator\): .*previous value/, /^away again: main's previous scroll padding \(7px\) restored/],
  nodisconnect: [/^away.*(previous value|still no scroll padding|still 7px)/],
  nomodisconnect: [/^away.*(previous value|still no scroll padding|still 7px|restored)/],
  nofallback: [/rail mode follows the clearance rule/, /^height 480x600.*every focused control fully visible/],
  noreturn: [/^(height 480x600 -> 900|ungrown down 480px|fallback -> sticky after return).*rail mode is sticky/],
  noreveal: [/every focused control fully visible/, /^rail entry .*page did not move/],
  nolistenercleanup: [/no focus listener left on <main>/],
  pointerreveal: [/^pointer 480px: the click scrolls nothing/],
  intoview: [/every scroll call moved only <main>, vertically/],
  railjump: [/^rail entry .*page did not move/],
  nobound: [/^oversized .*no custom adjustment for a control that cannot be shown whole/],
  nomutations: [/^no-resize 1440px: (enabled|made visible) with no size change/],
  nokeep: [/^keep high: the focused control is fully visible and clear of the stuck rail/],
  nomodalitycleanup: [/^away: no keydown\/pointerdown modality listener left on the document/],
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
console.log(`\nB15 rail focus mutation controls: ${Object.keys(EXPECT).length - failures}/${Object.keys(EXPECT).length} caught`);
process.exit(failures ? 1 : 0);
