/**
 * B15-20 (INV-129) -- Contacts Stage and Last call attempt columns (Pass 1
 * F17, narrow slice).
 *
 * Offline, synthetic fixtures. Compiles the pure cell module, checks every
 * state (loading, failed, no loaded deal, one deal, unrecognised stage,
 * several deals; precise / date-only / missing / unreadable attempt, with a
 * non-UTC time zone so a date-only value is proven not to shift a day), then
 * checks the page wiring by source text (repository convention).
 */
process.env.TZ = 'America/Chicago';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-b15-20-contacts-columns-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/contacts-columns.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs', '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  process.exit(10);
}
const K = require(path.join(TMP, 'src/lib/contacts-columns.js'));
fs.rmSync(TMP, { recursive: true, force: true });

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`); }
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');

const STAGES = [{ id: 's-new', name: 'New Lead - Seller' }, { id: 's-sent', name: 'Seller Offer Sent' }, { id: 's-lost', name: 'Lost / Not Interested' }];
const DEALS = [
  { contactId: 'one', stageId: 's-sent' },
  { contactId: 'two', stageId: 's-new' }, { contactId: 'two', stageId: 's-lost' },
  { contactId: 'same', stageId: 's-new' }, { contactId: 'same', stageId: 's-new' },
  { contactId: 'odd', stageId: 'gone' },
  { contactId: 'mix', stageId: 'gone' }, { contactId: 'mix', stageId: 's-new' },
  { contactId: '', stageId: 's-new' },
];
const loaded = { kind: 'loaded', stageNamesByContact: K.indexDealStages(STAGES, DEALS) };

// ── Stage ────────────────────────────────────────────────────────────────────
check('stage: loading', K.stageCell('one', { kind: 'loading' }), { kind: 'loading', text: 'Loading…' });
check('stage: failed read is unavailable, not "no deal"', K.stageCell('one', { kind: 'failed', detail: 'x' }), { kind: 'unavailable', text: "Stage couldn't be loaded" });
check('stage: no loaded deal is said as such', K.stageCell('nobody', loaded), { kind: 'no_loaded_deal', text: 'No Seller Leads deal in the loaded results' });
check('stage: one deal shows its stage', K.stageCell('one', loaded), { kind: 'single', text: 'Seller Offer Sent' });
check('stage: an unlisted stage id is "Stage not recognised"', K.stageCell('odd', loaded), { kind: 'single', text: 'Stage not recognised' });
check('stage: several deals list every stage, none picked', K.stageCell('two', loaded), { kind: 'multiple', text: '2 deals: New Lead - Seller, Lost / Not Interested' });
check('stage: repeated stage is counted, not collapsed away', K.stageCell('same', loaded), { kind: 'multiple', text: '2 deals: New Lead - Seller (2)' });
check('stage: unrecognised and known together', K.stageCell('mix', loaded), { kind: 'multiple', text: '2 deals: Stage not recognised, New Lead - Seller' });
check('stage: a deal without a contact id joins no contact', loaded.stageNamesByContact.has(''), false);
check('stage: closed/lost is shown only as its stage name (no status implied)', K.stageCell('two', loaded).text.includes('won') || K.stageCell('two', loaded).text.includes('status'), false);
check('stage: empty data', K.stageCell('x', { kind: 'loaded', stageNamesByContact: K.indexDealStages([], []) }).kind, 'no_loaded_deal');

// ── Name display casing (display only) ──────────────────────────────────────
const NAMED = [
  { contactId: 'mc', contactName: 'Sean McCormack' },
  { contactId: 'dlc', contactName: ' Ana  de la Cruz ' },
  { contactId: 'agree', contactName: 'Bo Li' }, { contactId: 'agree', contactName: 'Bo Li' },
  { contactId: 'split', contactName: 'Jo Ray' }, { contactId: 'split', contactName: 'JO RAY' },
  { contactId: 'other', contactName: 'Pat Smith - 12 Elm' },
  { contactId: '', contactName: 'Nobody' },
  { contactId: 'blank', contactName: '  ' },
];
const N = K.indexDealContactNames(NAMED);
check('names: the deal-side case is shown when only case differs', K.displayGridName('sean mccormack', N.get('mc')), 'Sean McCormack');
check('names: spacing is normalised, letters unchanged', K.displayGridName('ana de la cruz', N.get('dlc')), 'Ana de la Cruz');
check('names: deals that agree are used', K.displayGridName('bo li', N.get('agree')), 'Bo Li');
check('names: deals that disagree are not used (no pick)', [N.has('split'), K.displayGridName('jo ray', N.get('split'))], [false, 'jo ray']);
check('names: a different name is never shown (letters must match)', K.displayGridName('pat smith', N.get('other')), 'pat smith');
check('names: no deal leaves the list value as returned (never title-cased)', K.displayGridName('neelima bale', N.get('none')), 'neelima bale');
check('names: an empty list name stays empty (Unnamed contact)', K.displayGridName('', N.get('mc')), '');
check('names: deals without a contact id or a name join nothing', [N.has(''), N.has('blank')], [false, false]);

// ── Last call attempt ────────────────────────────────────────────────────────
check('attempt: precise value shows date and time', K.lastCallAttemptText('2026-10-01T15:30:00.000Z', '2026-10-01T00:00:00.000Z'), 'Oct 1, 2026, 10:30 AM');
check('attempt: date-only value is not shifted a day in US time', K.lastCallAttemptText(null, '2026-10-01T00:00:00.000Z'), 'Oct 1, 2026');
check('attempt: an unreadable precise value falls back to the date field', K.lastCallAttemptText('garbage', '2026-10-01T00:00:00.000Z'), 'Oct 1, 2026');
check('attempt: none recorded is said as such, not "not contacted"', K.lastCallAttemptText(null, null), 'No attempt recorded');
check('attempt: an unreadable value is not passed off as missing', K.lastCallAttemptText('garbage', null), 'Unreadable date');
// F2 (Bones): a plain date in the precise carrier never shows an invented time.
check('F2 date-only precise, no fallback: its date, no time, no day shift', K.lastCallAttemptText('2026-10-01', null), 'Oct 1, 2026');
check('F2 date-only precise with a DATE fallback: the DATE fallback', K.lastCallAttemptText('2026-10-01', '2026-10-02T00:00:00.000Z'), 'Oct 2, 2026');
check('F2 midnight-UTC precise with a time still shows its (local) time', K.lastCallAttemptText('2026-10-01T00:00:00.000Z', null), 'Sep 30, 2026, 7:00 PM');
check('F2 precise with a time and an offset', K.lastCallAttemptText('2026-10-01T09:05:00-05:00', null), 'Oct 1, 2026, 9:05 AM');
// F2 follow-up (Bones): an offset's HH:MM is not a clock time.
check('F2b date + GMT offset, no fallback: its stated date, no time, no shift', K.lastCallAttemptText('2026-10-01 GMT+05:00', null), 'Oct 1, 2026');
check('F2b date + GMT offset with a valid DATE fallback: the fallback', K.lastCallAttemptText('2026-10-01 GMT+05:00', '2026-10-01'), 'Oct 1, 2026');
check('F2b date + bare negative offset, no fallback', K.lastCallAttemptText('2026-10-01 -05:00', null), 'Oct 1, 2026');
check('F2b date + offset with a different DATE fallback uses the fallback', K.lastCallAttemptText('2026-10-01 GMT+05:00', '2026-10-02T00:00:00.000Z'), 'Oct 2, 2026');
check('F2b a genuine clock with an offset still shows its time', K.lastCallAttemptText('2026-10-01 14:30 GMT-05:00', null), 'Oct 1, 2026, 2:30 PM');
check('F2b ISO instant with offset still shows its time', K.lastCallAttemptText('2026-10-01T00:00:00+05:00', null), 'Sep 30, 2026, 2:00 PM');
check('F2b impossible calendar date without a clock is unreadable', K.lastCallAttemptText('2026-02-30 GMT+05:00', null), 'Unreadable date');
// F2c (Bones, 635c54e): validate the whole calendar date and clock before formatting.
const U = 'Unreadable date';
check('F2c month 13 is not next January', [K.lastCallAttemptText('2026-13-01 GMT+05:00', null), K.lastCallAttemptText('2026-13-01', null)], [U, U]);
check('F2c month 00 is not last December', [K.lastCallAttemptText('2026-00-01 GMT+05:00', null), K.lastCallAttemptText('2026-00-01', null)], [U, U]);
check('F2c invalid month never overrides a valid fallback', [K.lastCallAttemptText('2026-13-01 GMT+05:00', '2026-10-01'), K.lastCallAttemptText('2026-00-01T10:00:00Z', '2026-10-01T00:00:00.000Z')], ['Oct 1, 2026', 'Oct 1, 2026']);
check('F2c impossible days: Apr 31, Feb 30 with a clock, day 00', [K.lastCallAttemptText('2026-04-31 GMT+05:00', null), K.lastCallAttemptText('2026-02-30 10:00', null), K.lastCallAttemptText('2026-02-30T10:00:00Z', null), K.lastCallAttemptText('2026-10-00', null)], [U, U, U, U]);
check('F2c impossible day with a clock falls back, never rolls forward', K.lastCallAttemptText('2026-02-30T10:00:00Z', '2026-02-28T00:00:00.000Z'), 'Feb 28, 2026');
check('F2c leap years: 2028-02-29 and 2000-02-29 valid', [K.lastCallAttemptText('2028-02-29', null), K.lastCallAttemptText('2000-02-29 GMT+05:00', null), K.lastCallAttemptText(null, '2028-02-29T00:00:00.000Z')], ['Feb 29, 2028', 'Feb 29, 2000', 'Feb 29, 2028']);
check('F2c non-leap Feb 29: 2026 and 2100 invalid', [K.lastCallAttemptText('2026-02-29', null), K.lastCallAttemptText('2100-02-29', null), K.lastCallAttemptText(null, '2026-02-29')], [U, U, U]);
check('F2c leap day with a genuine clock shows its time', K.lastCallAttemptText('2028-02-29T16:00:00Z', null), 'Feb 29, 2028, 10:00 AM');
check('F2c malformed times never roll into another day', [K.lastCallAttemptText('2026-10-01 24:00', null), K.lastCallAttemptText('2026-10-01 25:00', null), K.lastCallAttemptText('2026-10-01T10:60:00Z', null), K.lastCallAttemptText('2026-10-01T10:00:61Z', null)], [U, U, U, U]);
check('F2c malformed time with a valid fallback uses the fallback', K.lastCallAttemptText('2026-10-01 24:00', '2026-09-30T00:00:00.000Z'), 'Sep 30, 2026');
check('F2c an invalid fallback is ignored for a valid date-only precise value', [K.lastCallAttemptText('2026-10-01', '2026-13-01'), K.lastCallAttemptText('2026-10-01 GMT+05:00', '2026-02-30T00:00:00.000Z')], ['Oct 1, 2026', 'Oct 1, 2026']);
check('F2c invalid values on both sides are Unreadable, not missing', K.lastCallAttemptText('2026-13-01', '2026-02-30'), U);
check('F2c a non-ISO value is not trusted to the lenient parser', [K.lastCallAttemptText('Feb 30 2026 10:00', null), K.lastCallAttemptText('Oct 1 2026 5:00 PM', '2026-10-01')], [U, 'Oct 1, 2026']);
// F2d (Bones, 7e96ab0): the WHOLE value must be a supported shape; each slot is checked on its own.
const BONES_F2D = ['2026-10-01Tbad', '2026-10-01T9:xx', '2026-10-01T10', '2026-10-01 nonsense'];
const REJECT = [...BONES_F2D,
  '2026-10-01T9:05', '2026-10-01t10:00', '2026-10-01T10:00:00ZZ', '2026-10-01T10:00+15:00', '2026-10-01T10:00+05:60',
  '2026-10-01T10:00:00.', '2026-10-01 GMT+0500', '2026-10-01 GMT', 'x2026-10-01', '2026-10-01T10:00 extra', '20261001', '2026-1-01'];
check('F2d malformed values read Unreadable in the precise slot', REJECT.map((r) => K.lastCallAttemptText(r, null)), REJECT.map(() => U));
check('F2d malformed values read Unreadable in the fallback slot', REJECT.map((r) => K.lastCallAttemptText(null, r)), REJECT.map(() => U));
check('F2d a malformed fallback never overrides a valid plain precise date', REJECT.map((r) => K.lastCallAttemptText('2026-10-02', r)), REJECT.map(() => 'Oct 2, 2026'));
check('F2d a malformed precise value never overrides a valid fallback', REJECT.map((r) => K.lastCallAttemptText(r, '2026-10-02')), REJECT.map(() => 'Oct 2, 2026'));
const ACCEPT = [
  [' 2026-10-01 ', 'Oct 1, 2026'],
  ['2026-10-01 UTC+00:00', 'Oct 1, 2026'],
  ['2026-10-01T10:00', 'Oct 1, 2026, 10:00 AM'],
  ['2026-10-01 10:00:30', 'Oct 1, 2026, 10:00 AM'],
  ['2026-10-01T10:00:30.123456Z', 'Oct 1, 2026, 5:00 AM'],
  ['2026-10-01T10:00+0530', 'Sep 30, 2026, 11:30 PM'],
  ['2026-10-01 10:00 UTC+14:00', 'Sep 30, 2026, 3:00 PM'],
  ['2026-10-01T10:00-14:00', 'Oct 1, 2026, 7:00 PM'],
];
check('F2d every supported shape at its boundary reads as stated', ACCEPT.map(([r]) => K.lastCallAttemptText(r, null)), ACCEPT.map(([, v]) => v));
// F2e (Bones, dbac926): construction never moves a time or a year.
check('F2e spring-forward gap: 02:30 local on 2026-03-08 does not exist', [K.lastCallAttemptText('2026-03-08 02:30', null), K.lastCallAttemptText('2026-03-08T02:30', null), K.lastCallAttemptText('2026-03-08T02:00:00', null)], [U, U, U]);
check('F2e gap time with a valid DATE fallback uses the fallback', K.lastCallAttemptText('2026-03-08 02:30', '2026-03-08'), 'Mar 8, 2026');
check('F2e neighbours of the gap are real local times', [K.lastCallAttemptText('2026-03-08 01:59', null), K.lastCallAttemptText('2026-03-08 03:30', null), K.lastCallAttemptText('2026-03-08T03:00:00', null)], ['Mar 8, 2026, 1:59 AM', 'Mar 8, 2026, 3:30 AM', 'Mar 8, 2026, 3:00 AM']);
check('F2e explicit-offset and Z instants inside the local gap stay real instants', [K.lastCallAttemptText('2026-03-08T02:30:00Z', null), K.lastCallAttemptText('2026-03-08T02:30-06:00', null)], ['Mar 7, 2026, 8:30 PM', 'Mar 8, 2026, 3:30 AM']);
check('F2e fall-back repeated hour is a real (ambiguous) local time', K.lastCallAttemptText('2026-11-01 01:30', null), 'Nov 1, 2026, 1:30 AM');
check('F2e year 0099 is kept exactly: date, fallback, local clock', [K.lastCallAttemptText('0099-01-01', null), K.lastCallAttemptText(null, '0099-01-01'), K.lastCallAttemptText('0099-06-15 10:00', null)], ['Jan 1, 0099', 'Jan 1, 0099', 'Jun 15, 0099, 10:00 AM']);
check('F2e year 0099 with Z keeps the year (never 1999)', /, 0099, /.test(K.lastCallAttemptText('0099-06-15T12:00:00Z', null)) && !/1999/.test(K.lastCallAttemptText('0099-06-15T12:00:00Z', null)), true);
check('F2e nearby valid years', [K.lastCallAttemptText('1999-01-01', null), K.lastCallAttemptText('0000-01-01', null), K.lastCallAttemptText('0100-01-01', null)], ['Jan 1, 1999', 'Jan 1, 0000', 'Jan 1, 0100']);
check('F2e leap rules for early years', [K.lastCallAttemptText('0099-02-29', null), K.lastCallAttemptText('0096-02-29', null), K.lastCallAttemptText('0000-02-29', null)], [U, 'Feb 29, 0096', 'Feb 29, 0000']);
check('F2e midnight and noon format', [K.lastCallAttemptText('2026-10-01 00:05', null), K.lastCallAttemptText('2026-10-01 12:00', null)], ['Oct 1, 2026, 12:05 AM', 'Oct 1, 2026, 12:00 PM']);

// ── Wiring ───────────────────────────────────────────────────────────────────
const page = read('src/pages/Contacts.tsx');
const labels = [...page.matchAll(/^\s{4}label: "([^"]+)",/gm)].map((m) => m[1]);
check('columns in order', labels, ['Name', 'Phone', 'Email', 'Property Address', 'Stage', 'Last call attempt', 'Date Added']);
check('Stage and Last call attempt are not sortable (no sort semantics invented)',
  /label: "Stage",\n\s+render:/.test(page) && /label: "Last call attempt",\n\s+render:/.test(page), true);
check('skeleton row matches the column count', /\[160, 120, 180, 200, 140, 120, 90\]\.map/.test(page), true);
check('stage read is the existing pipeline read, current read only, re-read on recovery',
  /return startCurrentRead\(\(\) => ghl\.opportunities\.listPipeline\(\), \{\n\s+data: \(p\) => \{\n\s+setStageSource\(\{ kind: "loaded", stageNamesByContact: indexDealStages\(p\.stages, p\.opportunities\) \}\);\n\s+setDealNames\(indexDealContactNames\(p\.opportunities\)\);\n\s+\},\n\s+error: \(e\) => \{\n\s+setStageSource\(\{ kind: "failed", detail: e\.message \}\);\n\s+setDealNames\(new Map\(\)\);/.test(page)
    && (page.match(/\}, \[readRecovered\]\);/g) || []).length === 2, true);
check('a stage-read failure only marks the Stage column unavailable (names fall back to the list value)', page.includes('setStageSource({ kind: "failed", detail: e.message });\n        setDealNames(new Map());'), true);
check('cells render through the pure module', page.includes('stageCell(r.id, ctx.stages)') && page.includes('lastCallAttemptText(r.lastCallAttemptPrecise, r.lastCallAttempt)'), true);
check('names: only the Name cell display changes; sort and search still use the list value',
  page.includes('{displayGridName(r.name, ctx.dealNames.get(r.id)) || <span')
    && page.includes('copy.sort((a, b) => dir * a.name.localeCompare(b.name));')
    && page.includes('r.name.toLowerCase().includes(lc) ||')
    && (page.match(/displayGridName\(/g) || []).length === 1, true);
check('no "last contact" or "not contacted" claim in the new cells', !/Not yet contacted|label: "Last contact"/i.test(page), true);
const ghl = read('src/lib/ghl.ts');
check('grid rows carry the existing attempt fields, both forms',
  ghl.includes('lastCallAttemptPrecise: c.lastCallAttemptPrecise,') && ghl.includes('lastCallAttempt:        c.lastCallAttempt,'), true);
const WRITES = /appWriteFetch\(|ghl\.notes\.create\(|ghl\.contacts\.set[A-Za-z]*\(|ghl\.opportunities\.(update|set)[A-Za-z]*\(/g;
/* F3: pinned from the B15-20 base, origin/main b9a84f2ad1a3a350ebe1ba233220222ebeca0796
   (Contacts had no write call); a constant, never a moving origin/main.
   Derived with the WRITES pattern above from b9a84f2 blob
   app/src/pages/Contacts.tsx c04387a189062cd1b2f7dcef78de98d9e12ca63c.
   SCOPE: a static count of these call patterns in this file -- not proof of
   every possible write path. */
const CONTACTS_WRITES_PINNED_B9A84F2 = 0;
check('no write call added to Contacts (pinned b9a84f2: 0)', (page.match(WRITES) || []).length, CONTACTS_WRITES_PINNED_B9A84F2);
check('cell module has no I/O', !/fetch\(|\bghl\.|import /.test(read('src/lib/contacts-columns.ts').replace(/\/\*[\s\S]*?\*\//g, '')), true);

console.log(`B15-20 contacts columns: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
