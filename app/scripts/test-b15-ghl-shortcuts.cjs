/**
 * Board 15 Batch 2 -- verified GHL shortcuts (destinations verified by Jess,
 * 2026-10-07).
 *
 *   B15-07 (INV-106)  "Open Calendars in GHL"  -> /calendars/view
 *
 * Offline, source text, following this repository's convention for UI
 * wiring. Proves each URL is built from the runtime LOCATION_ID next to the
 * existing ghlContactDetailUrl, each link opens in a new tab with no opener
 * or referrer, and nothing is written.
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const WRITES = /\.(set|save|create|update|delete)[A-Z]\w*\(|notes\.create\(|writeCommand\(|method:\s*"(POST|PUT|PATCH|DELETE)"/;

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

const ghlTs = code(read('src/lib/ghl.ts'));
check('LOCATION_ID is the runtime config location', /const CONFIG\s+= getRuntimeConfig\(\);/.test(ghlTs) && /const LOCATION_ID = CONFIG\.locationId;/.test(ghlTs), true);

// -- B15-07 Calendars ------------------------------------------------------
{
  const cal = code(read('src/pages/Calendars.tsx'));
  const card = (cal.match(/<div data-testid="calendar-unavailable"[\s\S]*?<\/details>/) || [''])[0];
  check('ghlCalendarsUrl builds /calendars/view for this location',
    /export function ghlCalendarsUrl\(\): string \{\s*return `https:\/\/app\.gohighlevel\.com\/v2\/location\/\$\{LOCATION_ID\}\/calendars\/view`;\s*\}/.test(ghlTs), true);
  check('Calendars imports the helper', /import \{ ghl, ghlCalendarsUrl, type CalendarEventRow, type CalendarEventsResult \} from "\.\.\/lib\/ghl";/.test(cal), true);
  check('the unavailable card links to it, in a new tab with no opener or referrer',
    /<a\s+data-testid="calendar-open-in-ghl"\s+href=\{ghlCalendarsUrl\(\)\}\s+target="_blank"\s+rel="noopener noreferrer"[\s\S]*?Open Calendars in GHL\s*<\/a>/.test(card), true);
  check('the access-denied explanation and the technical detail are kept',
    /GHL refused IAOS access to calendars for this account\./.test(card) && /Technical detail[\s\S]*\{error\.detail\}/.test(card), true);
  check('the shortcut appears only in the unavailable card (not on a loaded or empty calendar)', (cal.match(/calendar-open-in-ghl/g) || []).length === 1 && card.includes('calendar-open-in-ghl'), true);
  check('denied access is still not presented as an empty calendar', /\) : data\.events\.length === 0 \? \(/.test(cal) && !/No upcoming appointments/.test(card), true);
  check('Calendars writes nothing and opens no window by script', WRITES.test(cal) || /window\.open/.test(cal), false);
}

console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
