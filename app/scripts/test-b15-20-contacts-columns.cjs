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

// ── Wiring ───────────────────────────────────────────────────────────────────
const page = read('src/pages/Contacts.tsx');
const labels = [...page.matchAll(/^\s{4}label: "([^"]+)",/gm)].map((m) => m[1]);
check('columns in order', labels, ['Name', 'Phone', 'Email', 'Property Address', 'Stage', 'Last call attempt', 'Date Added']);
check('Stage and Last call attempt are not sortable (no sort semantics invented)',
  /label: "Stage",\n\s+render:/.test(page) && /label: "Last call attempt",\n\s+render:/.test(page), true);
check('skeleton row matches the column count', /\[160, 120, 180, 200, 140, 120, 90\]\.map/.test(page), true);
check('stage read is the existing pipeline read, current read only, re-read on recovery',
  /return startCurrentRead\(\(\) => ghl\.opportunities\.listPipeline\(\), \{\n\s+data: \(p\) => setStageSource\(\{ kind: "loaded", stageNamesByContact: indexDealStages\(p\.stages, p\.opportunities\) \}\),\n\s+error: \(e\) => setStageSource\(\{ kind: "failed", detail: e\.message \}\),/.test(page)
    && (page.match(/\}, \[readRecovered\]\);/g) || []).length === 2, true);
check('a stage-read failure only marks the Stage column unavailable', page.includes('error: (e) => setStageSource({ kind: "failed", detail: e.message })'), true);
check('cells render through the pure module', page.includes('stageCell(r.id, ctx.stages)') && page.includes('lastCallAttemptText(r.lastCallAttemptPrecise, r.lastCallAttempt)'), true);
check('no "last contact" or "not contacted" claim in the new cells', !/Not yet contacted|label: "Last contact"/i.test(page), true);
const ghl = read('src/lib/ghl.ts');
check('grid rows carry the existing attempt fields, both forms',
  ghl.includes('lastCallAttemptPrecise: c.lastCallAttemptPrecise,') && ghl.includes('lastCallAttempt:        c.lastCallAttempt,'), true);
const WRITES = /appWriteFetch\(|ghl\.notes\.create\(|ghl\.contacts\.set[A-Za-z]*\(|ghl\.opportunities\.(update|set)[A-Za-z]*\(/g;
const base = execFileSync('git', ['show', 'origin/main:app/src/pages/Contacts.tsx'], { cwd: APP, encoding: 'utf8' });
check('no write call added to Contacts', (page.match(WRITES) || []).length, (base.match(WRITES) || []).length);
check('cell module has no I/O', !/fetch\(|\bghl\.|import /.test(read('src/lib/contacts-columns.ts').replace(/\/\*[\s\S]*?\*\//g, '')), true);

console.log(`B15-20 contacts columns: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
