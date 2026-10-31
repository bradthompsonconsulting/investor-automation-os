/**
 * B15-20 (INV-129, Pass 1 F20-note) -- the schedule-callback popover's proposed time stays inside calling hours.
 *
 * Unit checks of src/lib/callback-default.ts (clock injected) in America/Chicago, the operator's zone: the next
 * :00/:30 strictly after now, kept inside 9:00 AM - 7:00 PM local (before 9 -> 9:00 same day, after 7 -> 9:00 next
 * day), across month/year ends, a leap day and both DST changes. Plus source checks on CallbackPopover.tsx: an
 * existing callback is still shown unchanged, Save still writes exactly the field, and nothing writes to GHL.
 *
 * NEGATIVE CONTROL: `node scripts/test-callback-default.cjs --before=<rev>` runs the same time checks against
 * <rev>'s ORIGINAL popover default (extracted with `git show`, clock faked) and must FAIL (exit 1) -- e.g.
 * --before=aabffe3, where an evening open proposed 9:00 PM or later.
 */
process.env.TZ = 'America/Chicago';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('./harness/ts-loader.cjs');

const APP = path.resolve(__dirname, '..');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Taken from the finished file: 8 single check() call sites + 1 inside the case loop x 17 cases = 25. */
const FLOOR = 25;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const RealDate = Date;
/** Runs fn with the global clock fixed at `fixed` (for an implementation that reads `new Date()` itself). */
function atClock(fixed, fn) {
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed.getTime()); else super(...a); }
    static now() { return fixed.getTime(); }
  }
  global.Date = FakeDate;
  try { return fn(); } finally { global.Date = RealDate; }
}

let proposed;
if (BEFORE) {
  const src = execFileSync('git', ['show', `${BEFORE}:app/src/components/CallbackPopover.tsx`], { cwd: APP, encoding: 'utf8' });
  const m = src.match(/function defaultCallbackLocalValue\(\): string \{[\s\S]*?\n\}/);
  if (!m) { console.error(`FAILED: no defaultCallbackLocalValue in ${BEFORE}`); process.exit(2); }
  const js = m[0].replace('(): string', '()').replace(/\(n: number\)/g, '(n)');
  const original = new Function(`${js}; return defaultCallbackLocalValue;`)();
  proposed = (now) => atClock(now, () => original());
  console.log(`NEGATIVE CONTROL: the original default from ${BEFORE}; this run must fail.`);
} else {
  const lib = require('../src/lib/callback-default.ts');
  proposed = (now) => atClock(now, () => lib.defaultCallbackLocalValue(now));
}

// local wall time in America/Chicago (process TZ) -> Date
const at = (y, mo, d, h, mi, s = 0) => new RealDate(y, mo - 1, d, h, mi, s, 0);
check('the test clock is America/Chicago (CDT -05:00 in summer, CST -06:00 in winter)',
  at(2026, 7, 1, 12, 0).getTimezoneOffset() === 300 && at(2026, 12, 1, 12, 0).getTimezoneOffset() === 360);

const CASES = [
  ['early morning: 8:10 AM -> 9:00 AM the same day', at(2026, 10, 30, 8, 10), '2026-10-30T09:00'],
  ['just before the window: 8:59 AM -> 9:00 AM', at(2026, 10, 30, 8, 59), '2026-10-30T09:00'],
  ['rounding lands on 9:00 AM: 8:45 AM -> 9:00 AM', at(2026, 10, 30, 8, 45), '2026-10-30T09:00'],
  ['at 9:00 AM sharp -> 9:30 AM (strictly after now, as before)', at(2026, 10, 30, 9, 0), '2026-10-30T09:30'],
  ['midday: 12:10 PM -> 12:30 PM (unchanged rounding)', at(2026, 10, 30, 12, 10), '2026-10-30T12:30'],
  ['6:29 PM -> 6:30 PM', at(2026, 10, 30, 18, 29), '2026-10-30T18:30'],
  ['6:30 PM -> 7:00 PM (the window end is inclusive)', at(2026, 10, 30, 18, 30), '2026-10-30T19:00'],
  ['6:45 PM -> 7:00 PM', at(2026, 10, 30, 18, 45), '2026-10-30T19:00'],
  ['7:00 PM -> 9:00 AM the next day (7:30 PM is outside)', at(2026, 10, 29, 19, 0), '2026-10-30T09:00'],
  ['the Pass 1 case: 8:40 PM -> 9:00 AM the next day (was 9:00 PM)', at(2026, 10, 29, 20, 40), '2026-10-30T09:00'],
  ['late night: 11:50 PM -> 9:00 AM the next day (was 12:00 AM)', at(2026, 10, 29, 23, 50), '2026-10-30T09:00'],
  ['after midnight: 12:10 AM -> 9:00 AM the same day (was 12:30 AM)', at(2026, 10, 30, 0, 10), '2026-10-30T09:00'],
  ['month end + DST fall-back day: Sat Oct 31 9:00 PM -> Sun Nov 1 9:00 AM CST', at(2026, 10, 31, 21, 0), '2026-11-01T09:00'],
  ['on the DST fall-back night: 1:40 AM (repeated hour) -> 9:00 AM', at(2026, 11, 1, 1, 40), '2026-11-01T09:00'],
  ['year end: Dec 31 10:00 PM -> Jan 1 9:00 AM', at(2026, 12, 31, 22, 0), '2027-01-01T09:00'],
  ['DST spring-forward night: Mar 14 2027 1:50 AM (2-3 AM does not exist) -> 9:00 AM CDT', at(2027, 3, 14, 1, 50), '2027-03-14T09:00'],
  ['leap day: Feb 28 2028 8:00 PM -> Feb 29 9:00 AM', at(2028, 2, 28, 20, 0), '2028-02-29T09:00'],
];
for (const [name, now, want] of CASES) {
  let got;
  try { got = proposed(now); } catch (e) { got = `threw ${e.message}`; }
  check(name, got === want, { now: now.toString(), want, got });
}

// property check: a year of instants every 7 minutes
let bad = null;
const start = at(2026, 1, 1, 0, 3).getTime();
for (let t = start; t < start + 366 * 864e5 && !bad; t += 7 * 6e4) {
  const now = new RealDate(t);
  const v = proposed(now);
  const p = new RealDate(v);   // datetime-local value parses as local time
  const h = p.getHours(), mi = p.getMinutes();
  const inWindow = (h > 9 || (h === 9 && mi >= 0)) && (h < 19 || (h === 19 && mi === 0));
  const later = p.getTime() > now.getTime();
  const within1Day = p.getTime() - now.getTime() <= 26 * 36e5;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) || !inWindow || !(mi === 0 || mi === 30) || !later || !within1Day) bad = { now: now.toString(), v };
}
check('for every instant of a year (7-minute steps): a :00/:30 time strictly later, inside 9:00 AM - 7:00 PM, within a day', bad === null, bad);

// source checks on the real popover (current tree)
const pop = fs.readFileSync(path.join(APP, 'src/components/CallbackPopover.tsx'), 'utf8');
const lib = fs.readFileSync(path.join(APP, 'src/lib/callback-default.ts'), 'utf8');
check('an existing callback is still shown unchanged (current ? toDatetimeLocalValue(current) : default)',
  /useState\(current \? toDatetimeLocalValue\(current\) : defaultCallbackLocalValue\(\)\)/.test(pop) && /function toDatetimeLocalValue\(iso: string\): string \{/.test(pop));
check('Save still writes exactly the field value (onSave(new Date(value).toISOString()), once)',
  (pop.match(/onSave\(new Date\(value\)\.toISOString\(\)\)/g) || []).length === 1 && (pop.match(/onSave\(/g) || []).length === 1);
check('the popover takes its default from lib/callback-default.ts (no local copy left)',
  /import \{ defaultCallbackLocalValue \} from "\.\.\/lib\/callback-default";/.test(pop) && !/function defaultCallbackLocalValue/.test(pop));
check('no GHL call or write in the default or the popover', !/\bghl\.|fetch\(|setCallbackDatetime\(/.test(lib) && !/\bghl\.|fetch\(/.test(pop));
const dash = fs.readFileSync(path.join(APP, 'src/pages/Dashboard.tsx'), 'utf8');
const cw = fs.readFileSync(path.join(APP, 'src/pages/ContactWorkspace.tsx'), 'utf8');
check('Dashboard and Contact both use the one shared popover', /import \{ CallbackPopover \} from "\.\.\/components\/CallbackPopover";/.test(dash) && /import \{ CallbackPopover \} from "\.\.\/components\/CallbackPopover";/.test(cw));
check('the window constant is 9 to 19 (9:00 AM - 7:00 PM)', /CALLBACK_WINDOW = \{ startHour: 9, endHour: 19 \} as const/.test(lib));

console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
