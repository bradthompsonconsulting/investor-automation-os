/**
 * B15-20b (provisional; B15-20 / INV-129 callback family) -- the Seller Call
 * workspace's scheduled-callback status line: unit and source checks.
 *
 * Unit checks of src/lib/seller-call-callback-status.ts with an injected clock:
 * today, tomorrow, a later date, overdue by minutes, by a day and by days, the
 * exact instant, midnight on both sides, both DST changes (including the
 * repeated hour), a year end, and the non-time states (set but unreadable,
 * none, checking, couldn't be loaded). The process zone is deliberately NOT
 * America/Chicago, to prove the line uses America/Chicago itself -- the zone
 * formatCallbackTime gives the Pass consequence -- and the two always agree.
 * Plus source checks on SellerCallWorkspace.tsx: the line words the SAME
 * resolved value the Pass consequence reads, sits under the header and above
 * the deal bar, and adds no read and no write.
 *
 * NEGATIVE CONTROL: `node scripts/test-seller-call-callback-status.cjs --before=<rev>`
 * checks <rev>'s page (via `git show`) with no status helper and must FAIL
 * (exit 1) -- e.g. --before=aabffe3.
 */
process.env.TZ = 'Pacific/Auckland';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('./harness/ts-loader.cjs');

const APP = path.resolve(__dirname, '..');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Taken from the finished file: 5 single check() call sites + 1 inside the case loop x 21 cases + 1 inside the agreement loop x 4 + 8 source checks = 38. */
const FLOOR = 38;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

let lib;
let page;
if (BEFORE) {
  console.log(`NEGATIVE CONTROL: the Seller Call page from ${BEFORE}; this run must fail.`);
  page = execFileSync('git', ['show', `${BEFORE}:app/src/pages/SellerCallWorkspace.tsx`], { cwd: APP, encoding: 'utf8' });
  let has = true;
  try { execFileSync('git', ['cat-file', '-e', `${BEFORE}:app/src/lib/seller-call-callback-status.ts`], { cwd: APP, stdio: 'ignore' }); } catch { has = false; }
  lib = has ? require('../src/lib/seller-call-callback-status.ts')
    : { callbackStatusLine: () => ({ kind: 'missing', tone: 'missing', text: 'callbackStatusLine is missing' }) };
} else {
  lib = require('../src/lib/seller-call-callback-status.ts');
  page = fs.readFileSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx'), 'utf8');
}
const { formatCallbackTime } = require('../src/lib/callbackWrite.ts');
const { resolveScheduledCallback } = require('../src/lib/call-outcome-copy.ts');
const line = (cb, nowIso, readFailed = false) => lib.callbackStatusLine(cb, new Date(nowIso), readFailed);
const plain = (s) => String(s).replace(/[  ]/g, ' ');

// ── Cases: [name, callback, now, readFailed, expected {kind, tone, text}] ────
// Instants are UTC; the comment gives America/Chicago wall time.
const S = 'Scheduled callback: ';
const CASES = [
  ['later today', { iso: '2026-10-30T19:30:00.000Z' }, '2026-10-30T15:00:00.000Z', false, { kind: 'today', tone: 'info', text: `${S}Today, 2:30 PM` }],           // 2:30 PM CDT; now 10:00 AM
  ['the exact instant is not overdue', { iso: '2026-10-30T15:00:00.000Z' }, '2026-10-30T15:00:00.000Z', false, { kind: 'today', tone: 'info', text: `${S}Today, 10:00 AM` }],
  ['tomorrow', { iso: '2026-10-31T14:00:00.000Z' }, '2026-10-30T15:00:00.000Z', false, { kind: 'tomorrow', tone: 'info', text: `${S}Tomorrow, 9:00 AM` }],       // Sat 9:00 AM CDT
  ['a later date shows weekday and date', { iso: '2026-11-03T15:00:00.000Z' }, '2026-10-30T15:00:00.000Z', false, { kind: 'later', tone: 'info', text: `${S}Tue, Nov 3, 9:00 AM` }], // CST after fall-back
  ['overdue by minutes, today', { iso: '2026-10-30T14:40:00.000Z' }, '2026-10-30T15:00:00.000Z', false, { kind: 'overdue', tone: 'warn', text: `${S}Overdue, was Today, 9:40 AM` }],
  ['overdue since yesterday', { iso: '2026-10-29T21:00:00.000Z' }, '2026-10-30T15:00:00.000Z', false, { kind: 'overdue', tone: 'warn', text: `${S}Overdue, was Yesterday, 4:00 PM` }],
  ['overdue by days', { iso: '2026-10-26T14:00:00.000Z' }, '2026-10-30T15:00:00.000Z', false, { kind: 'overdue', tone: 'warn', text: `${S}Overdue, was Mon, Oct 26, 9:00 AM` }],
  ['midnight: 11:50 PM now, 12:10 AM is tomorrow', { iso: '2026-10-31T05:10:00.000Z' }, '2026-10-31T04:50:00.000Z', false, { kind: 'tomorrow', tone: 'info', text: `${S}Tomorrow, 12:10 AM` }],
  ['midnight: 12:05 AM now, 11:55 PM was yesterday', { iso: '2026-10-31T04:55:00.000Z' }, '2026-10-31T05:05:00.000Z', false, { kind: 'overdue', tone: 'warn', text: `${S}Overdue, was Yesterday, 11:55 PM` }],
  ['DST fall-back eve: Sun 9:00 AM CST is tomorrow', { iso: '2026-11-01T15:00:00.000Z' }, '2026-11-01T03:00:00.000Z', false, { kind: 'tomorrow', tone: 'info', text: `${S}Tomorrow, 9:00 AM` }], // now Sat 10 PM CDT
  ['DST repeated hour: 1:30 AM CST is after 1:40 AM CDT', { iso: '2026-11-01T07:30:00.000Z' }, '2026-11-01T06:40:00.000Z', false, { kind: 'today', tone: 'info', text: `${S}Today, 1:30 AM` }],
  ['DST spring-forward eve: Sun 9:00 AM CDT is tomorrow', { iso: '2027-03-14T14:00:00.000Z' }, '2027-03-14T04:00:00.000Z', false, { kind: 'tomorrow', tone: 'info', text: `${S}Tomorrow, 9:00 AM` }], // now Sat 10 PM CST
  ['DST spring-forward night: 3:30 AM CDT is today', { iso: '2027-03-14T08:30:00.000Z' }, '2027-03-14T07:50:00.000Z', false, { kind: 'today', tone: 'info', text: `${S}Today, 3:30 AM` }], // now 1:50 AM CST
  ['year end: a date in the next year names the year', { iso: '2027-01-04T15:00:00.000Z' }, '2027-01-01T02:00:00.000Z', false, { kind: 'later', tone: 'info', text: `${S}Mon, Jan 4, 2027, 9:00 AM` }], // now Dec 31 8 PM CST
  ['year end: New Year 9:00 AM from Dec 31 evening is tomorrow', { iso: '2027-01-01T15:00:00.000Z' }, '2027-01-01T02:00:00.000Z', false, { kind: 'tomorrow', tone: 'info', text: `${S}Tomorrow, 9:00 AM` }],
  ['set but unreadable (resolver gave iso null)', { iso: null }, '2026-10-30T15:00:00.000Z', false, { kind: 'unreadable', tone: 'warn', text: 'Scheduled callback: set, time unreadable. Check the contact page.' }],
  ['set but not a date', { iso: 'not a date' }, '2026-10-30T15:00:00.000Z', false, { kind: 'unreadable', tone: 'warn', text: 'Scheduled callback: set, time unreadable. Check the contact page.' }],
  ['no callback', null, '2026-10-30T15:00:00.000Z', false, { kind: 'none', tone: 'muted', text: 'No callback scheduled' }],
  ['not yet known for this contact: checking, never another contact\'s value', 'unknown', '2026-10-30T15:00:00.000Z', false, { kind: 'checking', tone: 'muted', text: 'Checking for a scheduled callback…' }],
  ['this contact\'s read failed: couldn\'t be loaded', 'unknown', '2026-10-30T15:00:00.000Z', true, { kind: 'unavailable', tone: 'muted', text: "Callback status couldn't be loaded" }],
  ['a known callback is shown even if a read failed (session value wins)', { iso: '2026-10-30T19:30:00.000Z' }, '2026-10-30T15:00:00.000Z', true, { kind: 'today', tone: 'info', text: `${S}Today, 2:30 PM` }],
];
for (const [name, cb, now, failed, want] of CASES) {
  const got = line(cb, now, failed);
  check(`line: ${name}`, got && got.kind === want.kind && got.tone === want.tone && got.text === want.text, got);
}

// ── Agreement with the Pass consequence (formatCallbackTime) ─────────────────
for (const iso of ['2026-10-30T19:30:00.000Z', '2026-11-03T15:00:00.000Z', '2026-11-01T07:30:00.000Z', '2027-03-14T08:30:00.000Z']) {
  const passTime = plain(formatCallbackTime(iso)).split(', ').pop();            // "Oct 30, 2:30 PM" -> "2:30 PM"
  const statusText = plain(line({ iso }, '2026-10-30T15:00:00.000Z').text);
  check(`the line and the Pass consequence name the same time for ${iso} (${passTime})`, statusText.endsWith(`, ${passTime}`), { statusText, passTime });
}

// ── Single checks ────────────────────────────────────────────────────────────
check('the process zone is not America/Chicago (the line must not depend on it)', Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Chicago', Intl.DateTimeFormat().resolvedOptions().timeZone);
check('the line is plain text (no narrow no-break space)', !/[  ]/.test(line({ iso: '2026-10-30T19:30:00.000Z' }, '2026-10-30T15:00:00.000Z').text));
check('no state invents a time: unreadable, none, checking and unavailable carry no clock time',
  [line({ iso: null }, '2026-10-30T15:00:00.000Z'), line(null, '2026-10-30T15:00:00.000Z'), line('unknown', '2026-10-30T15:00:00.000Z'), line('unknown', '2026-10-30T15:00:00.000Z', true)]
    .every((s) => s && !/\d{1,2}:\d{2}/.test(s.text)));
{
  // The resolver feeding the line: a session value wins; another contact's record is "unknown", never its callback.
  const ids = { precise: 'P', date: 'D' };
  const r = [resolveScheduledCallback('2026-10-31T15:00:00.000Z', [{ id: 'P', value: '2026-10-30T19:30:00.000Z' }], ids),
    resolveScheduledCallback(null, null, ids), resolveScheduledCallback(null, [{ id: 'P', value: 'garbage' }], ids)];
  const got = [line(r[0], '2026-10-30T15:00:00.000Z').text, line(r[1], '2026-10-30T15:00:00.000Z').kind, line(r[2], '2026-10-30T15:00:00.000Z').kind];
  check('fed by the resolver: session wins; no record for this contact is checking; a garbage value is unreadable',
    JSON.stringify(got) === JSON.stringify([`${S}Tomorrow, 10:00 AM`, 'checking', 'unreadable']), got);
}
check('the helper module does no I/O (no fetch, no ghl, no imports)', (() => {
  try { return !/fetch\(|\bghl\.|^import /m.test(fs.readFileSync(path.join(APP, 'src/lib/seller-call-callback-status.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')); } catch { return false; }
})());

// ── Source checks on the page ────────────────────────────────────────────────
const code = page.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const statusAt = code.indexOf('data-testid="seller-call-callback-status"');
check('page imports callbackStatusLine from the helper', /import \{ callbackStatusLine \} from "\.\.\/lib\/seller-call-callback-status";/.test(code));
check('the line words the SAME resolved value the Pass consequence reads (passCallback), with this contact\'s read failure only',
  /const callbackStatus = callbackStatusLine\(passCallback, new Date\(callbackNow\), fetchError !== null\);/.test(code));
check('passCallback still carries the B14-12 isolation guard (session value for THIS contact, record only when it IS this contact)',
  /resolveScheduledCallback\(\s*sessionCallback\?\.contactId === contactId \? sessionCallback\.iso : null,\s*contact\?\.id === contactId \? contact\.customFields : null,/.test(code));
check('the Pass consequence still reads passCallback through formatCallbackTime',
  /sellerCallPassConsequence\(passCallback === "unknown" \? "unknown"\s*: passCallback \? \{ text: passCallback\.iso \? formatCallbackTime\(passCallback\.iso\) : null \} : null\)/.test(code));
check('the line renders its text and state', statusAt > 0 && /data-callback-state=\{callbackStatus\.kind\}/.test(code) && /\{callbackStatus\.text\}/.test(code));
check('placement: after the header (address line), before the voice controls and the sticky deal bar',
  statusAt > code.indexOf('{formatAddress(contact)}') && statusAt < code.indexOf('<SellerCallVoiceControls') && statusAt < code.indexOf('data-testid="seller-call-sticky-bar"'));
check('the deal bar is rendered unchanged', /<DealBar cells=\{dealBarCells\} \/>/.test(code) && (code.match(/<DealBar /g) || []).length === 1);
check('the clock is a display timer only: one 30 s interval, cleared on unmount, and no new GHL call from the line',
  /window\.setInterval\(\(\) => setCallbackNow\(Date\.now\(\)\), 30_000\);\s*return \(\) => window\.clearInterval\(timer\);/.test(code));

console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
