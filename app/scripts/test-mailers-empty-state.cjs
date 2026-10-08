/**
 * B15-12 (INV-110), Walkthrough 2 -- the Mailers "No Address" empty state.
 *
 * The page said "Everyone in a mail cadence has an address on file." when
 * nothing was listed. The digest the page reads is built from mailer TASKS
 * only (netlify/functions/lib/mailer-shared.ts): it carries no enrolment
 * data, so an empty No Address list cannot tell "no enrolled contacts" from
 * "everyone enrolled has an address". The wording is now neutral, as ruled:
 * "No contacts missing an address were found."
 *
 * Offline, source text, following this repository's convention for UI
 * wiring. Copy only: the condition, the other lists, the reads and the
 * completion action are unchanged.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 8;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

const page = code(read('src/pages/Mailers.tsx'));
const shared = code(read('netlify/functions/lib/mailer-shared.ts'));

check('the empty No Address state uses the neutral wording',
  /\{digest\.noAddress\.length === 0 \? \(\s*<div data-testid="mailers-no-address-empty"[^>]*>\s*No contacts missing an address were found\.\s*<\/div>/.test(page), true);
check('the enrolment claim is gone', /mail cadence|Everyone in/.test(page), false);
check('the No Address list itself is unchanged (rows from digest.noAddress)', /\{digest\.noAddress\.map\(\(r\) => \(/.test(page) && /\{digest\.noAddress\.length\}/.test(page), true);
check('the other empty states are unchanged',
  ['emptyLabel="Nothing due this week."', 'emptyLabel="No business-flagged contacts due this week."', 'emptyLabel="Nothing overdue."'].every((s) => page.includes(s)), true);
check('the page still makes only its two existing GHL calls: the digest read and the task completion',
  (page.match(/ghl\.\w+\.\w+\(/g) || []).sort(), ['ghl.mailers.completeTask(', 'ghl.mailers.list(']);
{
  // Why the wording must be neutral: the digest has no enrolment field.
  const digestType = (shared.match(/export interface MailerDigest \{([\s\S]*?)\n\}/) || ['', ''])[1];
  const fields = [...digestType.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  check('the digest the page reads carries no enrolment data (revisit the wording if this changes)', fields,
    ['weekStartCT', 'weekEndCT', 'thisWeekReady', 'thisWeekBusiness', 'overdue', 'noAddress', 'totals']);
  check('No Address is built from incomplete mailer tasks without an address, not from enrolment',
    /const noAddress = incomplete\.filter\(\(r\) => !r\.hasAddress\);/.test(shared) && !/enrol|enroll|cadence/i.test(shared), true);
}
check('the Batch 5 week window is untouched', /const daysToFriday = \(5 - dayOfWeek\(today\) \+ 7\) % 7;/.test(shared), true);

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
