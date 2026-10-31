/**
 * B15-09 (INV-108) -- Pipeline property context; B15-09a (Jess D3-i ruling,
 * 2026-10-31) -- the native address block first.
 *
 * Offline. Compiles src/lib/pipeline-property.ts and runs table-driven
 * cases, then checks the Pipeline wiring by source text, following this
 * repository's convention for UI wiring. Proves: a row shows its contact's
 * native address block (street required), else the contact's Property
 * Address field, always labelled as the contact's and not confirmed for the
 * deal; a contact with neither says it has no property address on record; a
 * contact with several deals says so on each; a failed or lagging contacts
 * read says the address couldn't be loaded; a mailing address is never used;
 * contact links, sorting, stages and deal counts are unchanged; the page
 * writes nothing; and a superseded contacts read -- late success or late
 * failure -- never overwrites the current one (Bones finding 3).
 *
 * NEGATIVE CONTROL: `node scripts/test-pipeline-property.cjs --before=<rev>`
 * runs the same checks against <rev>'s pipeline-property.ts and Pipeline.tsx
 * (extracted with `git show`) and must FAIL (exit 1) -- e.g. --before=aabffe3,
 * where an imported contact's native address was never shown.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const gitShow = (file) => execFileSync('git', ['show', `${BEFORE}:app/${file}`], { cwd: APP, encoding: 'utf8' });

const TMP = path.join(APP, '.tmp-pipeline-property-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
// The source under test: the working tree, or <rev>'s copy for the negative control.
let SRC_ROOT = APP;
if (BEFORE) {
  SRC_ROOT = path.join(TMP, 'before');
  fs.mkdirSync(path.join(SRC_ROOT, 'src/lib'), { recursive: true });
  fs.writeFileSync(path.join(SRC_ROOT, 'src/lib/pipeline-property.ts'), gitShow('src/lib/pipeline-property.ts'));
  console.log(`NEGATIVE CONTROL: pipeline-property.ts and Pipeline.tsx from ${BEFORE}; this run must fail.`);
}
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(SRC_ROOT, 'src/lib/pipeline-property.ts'),
    '--outDir', path.join(TMP, 'out'), '--rootDir', SRC_ROOT, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const lib = require(path.join(TMP, 'out/src/lib/pipeline-property.js'));
const libRaw = fs.readFileSync(path.join(SRC_ROOT, 'src/lib/pipeline-property.ts'), 'utf8');
const pageRaw = BEFORE ? gitShow('src/pages/Pipeline.tsx') : fs.readFileSync(path.join(APP, 'src/pages/Pipeline.tsx'), 'utf8');
fs.rmSync(TMP, { recursive: true, force: true });
const { indexPropertyAddresses, countDealsByContact, pipelinePropertyCell, loadPropertyAddresses } = lib;
// Absent before B15-09a: the negative control must fail these checks, not crash on them.
const formatNativeAddress = lib.formatNativeAddress ?? (() => 'formatNativeAddress is missing');

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 49;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

const ADDRESS_NOTE = "The contact's property address, not confirmed for this deal";
const FIELD_NOTE = "From the contact's Property Address field, not confirmed for this deal";
const NONE_NOTE = 'The contact has no property address on record.';
const NOT_VERIFIED = 'Property not verified for this deal';
const NATIVE_C1 = '500 Native Imported Rd, Dallas, TX 75001';

// ============================================================
// The cell: what it shows and what it claims. All data is fictional.
// ============================================================
{
  // ContactRow-shaped records. Each also carries a mailing address, which
  // must never be shown (ContactRow has no mailing field today; this proves
  // the index would drop one if it ever arrived).
  const mail = { mailingAddress: '9 Mailing Rd', mailing_city: 'Mailtown', mailing_state: 'OK', mailing_zip: '73001' };
  const contacts = [
    { id: 'c1', address1: '500 Native Imported Rd', city: 'Dallas', state: 'TX', postalCode: '75001', propertyAddress: '123 Main St, Austin, TX 78701', ...mail },
    { id: 'c2', address1: '', city: 'Austin', state: 'TX', postalCode: '78701', propertyAddress: '123 Main St, Austin, TX 78701', ...mail },
    { id: 'c3', address1: '', city: 'Waco', state: 'TX', postalCode: '', propertyAddress: '   ', ...mail },
    { id: 'c4', address1: '', city: '', state: '', postalCode: '', propertyAddress: '', ...mail },
    { id: 'c5', address1: '   ', city: 'Tyler', state: 'TX', postalCode: '75701', propertyAddress: '9 Elm St', ...mail },
  ];
  const loaded = { kind: 'loaded', byContactId: indexPropertyAddresses(contacts) };
  const cell = (id) => pipelinePropertyCell(id, 1, loaded);

  check('the native address block is shown, labelled as the contact\'s property address not confirmed for the deal',
    cell('c1'), { kind: 'contact_address', text: NATIVE_C1, note: ADDRESS_NOTE });
  check('Bones repro (9542868), now ruled: a full native imported address is shown, not reported missing',
    [cell('c1').kind, /no property address|not verified/i.test(cell('c1').text)], ['contact_address', false]);
  check('the native address wins over the Property Address field', /123 Main/.test(JSON.stringify(cell('c1'))), false);
  check('no native street: the Property Address field is the fallback, labelled as that field',
    cell('c2'), { kind: 'contact_field', text: '123 Main St, Austin, TX 78701', note: FIELD_NOTE });
  check('a whitespace-only native street is empty: the field is the fallback', [cell('c5').kind, cell('c5').text], ['contact_field', '9 Elm St']);
  check('a city and state without a street, and a whitespace-only field: no property address on record',
    cell('c3'), { kind: 'no_address', text: NOT_VERIFIED, note: NONE_NOTE });
  check('nothing at all: no property address on record', cell('c4'), { kind: 'no_address', text: NOT_VERIFIED, note: NONE_NOTE });
  check('the mailing address is never substituted', /Mailing|Mailtown|73001/.test(JSON.stringify(['c1', 'c2', 'c3', 'c4', 'c5'].map(cell))), false);
  check('the index keeps only id -> the native line and the trimmed field', [...indexPropertyAddresses(contacts).entries()], [
    ['c1', { native: NATIVE_C1, field: '123 Main St, Austin, TX 78701' }],
    ['c2', { native: '', field: '123 Main St, Austin, TX 78701' }],
    ['c3', { native: '', field: '' }],
    ['c4', { native: '', field: '' }],
    ['c5', { native: '', field: '9 Elm St' }],
  ]);
  check('a deal with no contact makes no claim about the property',
    pipelinePropertyCell('', 0, loaded), { kind: 'no_contact', text: NOT_VERIFIED, note: 'No contact is linked to this deal.' });
  check('a contact the list did not return: couldn\'t be loaded',
    pipelinePropertyCell('c9', 1, loaded), { kind: 'unavailable', text: "Property address couldn't be loaded.", note: null });
  check('a failed contacts read: couldn\'t be loaded',
    pipelinePropertyCell('c1', 1, { kind: 'failed', detail: 'ghl-contacts → 502' }), { kind: 'unavailable', text: "Property address couldn't be loaded.", note: null });
  check('while the contacts read is in flight the cell says it is loading', pipelinePropertyCell('c1', 1, { kind: 'loading' }).kind, 'loading');
  check('every address label says it is not confirmed for this deal', [ADDRESS_NOTE, FIELD_NOTE].map((n) => Object.values(lib).includes(n) && /not confirmed for this deal$/.test(n)), [true, true]);
  check('no label claims the property itself is unknown or "not recorded"', /not recorded|unknown/i.test(JSON.stringify(Object.values(lib).filter((v) => typeof v === 'string'))), false);
}

// ============================================================
// The native one-line format ("street, city, ST zip", the Contact header's shape).
// ============================================================
{
  const f = (address1, city, state, postalCode) => formatNativeAddress({ address1, city, state, postalCode });
  check('full address, unit already in the street (as the importer writes it)', f('12 Oak St Unit 4', 'Austin', 'TX', '78701'), '12 Oak St Unit 4, Austin, TX 78701');
  check('no ZIP', f('12 Oak St', 'Austin', 'TX', ''), '12 Oak St, Austin, TX');
  check('no city', f('12 Oak St', '', 'TX', '78701'), '12 Oak St, TX 78701');
  check('street only', f('12 Oak St', '', '', ''), '12 Oak St');
  check('whitespace is collapsed and trimmed', f('  12   Oak St ', ' Austin ', ' TX', '78701 '), '12 Oak St, Austin, TX 78701');
  check('no street: no native address, whatever else is set', f('', 'Austin', 'TX', '78701'), '');
  check('missing parts (undefined) are treated as empty', formatNativeAddress({ address1: '12 Oak St' }), '12 Oak St');
}

// ============================================================
// Several deals on one contact (Bones finding 2; PB-D55 allows it).
// ============================================================
{
  const opps = [{ id: 'o1', contactId: 'c1' }, { id: 'o2', contactId: 'c1' }, { id: 'o3', contactId: 'c2' }, { id: 'o4', contactId: '' }, { id: 'o5', contactId: 'c3' }, { id: 'o6', contactId: 'c3' }];
  const counts = countDealsByContact(opps);
  check('deals are counted per contact; a deal with no contact is not counted', [...counts.entries()], [['c1', 2], ['c2', 1], ['c3', 2]]);
  const loaded = { kind: 'loaded', byContactId: indexPropertyAddresses([
    { id: 'c1', address1: '1 Native Way', city: 'Austin', state: 'TX', postalCode: '78701', propertyAddress: '' },
    { id: 'c2', address1: '2 Native Way', city: 'Austin', state: 'TX', postalCode: '78701', propertyAddress: '' },
    { id: 'c3', address1: '', city: '', state: '', postalCode: '', propertyAddress: '9 Elm St' },
  ]) };
  const o1 = pipelinePropertyCell('c1', counts.get('c1'), loaded);
  const o2 = pipelinePropertyCell('c1', counts.get('c1'), loaded);
  check('two deals on one contact: each row says the contact has 2 deals', [o1.note, o2.note],
    [`${ADDRESS_NOTE}: this contact has 2 deals in the pipeline`, `${ADDRESS_NOTE}: this contact has 2 deals in the pipeline`]);
  check('two deals on one contact: the value is still the contact\'s address, never presented as the deal\'s', [o1.kind, o2.kind], ['contact_address', 'contact_address']);
  check('two deals on a fallback contact: the field note carries the deal count', pipelinePropertyCell('c3', counts.get('c3'), loaded).note,
    `${FIELD_NOTE}: this contact has 2 deals in the pipeline`);
  check('a single-deal contact gets no multi-deal wording', /deals in the pipeline/.test(pipelinePropertyCell('c2', counts.get('c2'), loaded).note), false);
}

// ============================================================
// Late responses across a read recovery (Bones finding 3). Two reads are
// started the way the page's effect starts them -- the first is cancelled by
// the effect cleanup when the second begins -- and settled out of order.
// ============================================================
async function lateResponseCases() {
  const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
  const settle = () => new Promise((r) => setImmediate(r));
  const shown = (state) => (state.kind === 'loaded' ? pipelinePropertyCell('c1', 1, state).text : state.kind);
  const contact = (address1) => [{ id: 'c1', address1, city: 'Austin', state: 'TX', postalCode: '78701', propertyAddress: '' }];

  async function run(olderOutcome) {
    let state = null;
    const apply = (s) => { state = s; };
    const older = deferred();
    const newer = deferred();
    const cancelOlder = loadPropertyAddresses(() => older.promise, apply);
    cancelOlder(); // recovery re-runs the effect: React calls the old cleanup first
    loadPropertyAddresses(() => newer.promise, apply);
    newer.resolve(contact('20 New Rd'));
    await settle();
    const afterNewer = shown(state);
    if (olderOutcome === 'success') older.resolve(contact('10 Stale Ave'));
    else older.reject(new Error('ghl-contacts → 500'));
    await settle();
    return [afterNewer, shown(state)];
  }

  check('delayed older SUCCESS after a newer success leaves the newer address', await run('success'), ['20 New Rd, Austin, TX 78701', '20 New Rd, Austin, TX 78701']);
  check('delayed older FAILURE after a newer success leaves the newer address', await run('failure'), ['20 New Rd, Austin, TX 78701', '20 New Rd, Austin, TX 78701']);

  {
    let state = null;
    const newer = deferred();
    const older = deferred();
    const cancelOlder = loadPropertyAddresses(() => older.promise, (s) => { state = s; });
    cancelOlder();
    loadPropertyAddresses(() => newer.promise, (s) => { state = s; });
    older.resolve(contact('10 Stale Ave'));
    await settle();
    const whilePending = state.kind;
    newer.reject(new Error('ghl-contacts → 502'));
    await settle();
    check('an older success arriving while the newer read is pending changes nothing; the newer failure then shows', [whilePending, state.kind], ['loading', 'failed']);
  }
  {
    const states = [];
    const only = deferred();
    loadPropertyAddresses(() => only.promise, (s) => states.push(s.kind));
    only.resolve(contact('1 A St'));
    await settle();
    check('an uncancelled read applies loading, then its result', states, ['loading', 'loaded']);
  }
}

// ============================================================
// Pipeline wiring (source text).
// ============================================================
{
  const stripComments = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const code = stripComments(pageRaw);
  const libSrc = stripComments(libRaw);
  const WRITES = /\.(set|save|create|update|delete)[A-Z]\w*\(|notes\.create\(|writeCommand\(|method:\s*"(POST|PUT|PATCH|DELETE)"/;

  check('Pipeline imports the cell helpers and the guarded loader', /import \{[^}]*\bcountDealsByContact\b[^}]*\bloadPropertyAddresses\b[^}]*\bpipelinePropertyCell\b[^}]*\} from "\.\.\/lib\/pipeline-property";/.test(code), true);
  check('the address effect returns the loader\'s cancel as its cleanup', /useEffect\(\(\) => \{\s*return loadPropertyAddresses\(\(\) => ghl\.contacts\.listAll\(\), setAddressSource\);\s*\}, \[readRecovered\]\);/.test(code), true);
  check('no unguarded contacts read remains on the page', (code.match(/ghl\.contacts\.listAll\(\)/g) || []).length === 1 && !/setAddressSource\(\{/.test(code), true);
  check('deal counts come from the loaded opportunities', /const dealsByContact = useMemo\(\(\) => countDealsByContact\(opportunities\), \[opportunities\]\);/.test(code), true);
  check('each row passes its contact, that contact\'s deal count and the address read', /pipelinePropertyCell\(o\.contactId, dealsByContact\.get\(o\.contactId\) \?\? 0, addressSource\)/.test(code), true);
  check('the row renders the value and, beneath it, the note', /\{property\.text\}/.test(code) && /\{property\.note && \(\s*<div data-testid=\{`pipeline-row-property-note-\$\{o\.id\}`\}/.test(code), true);
  check('the native address and the field value are both styled as an address', /property\.kind === "contact_address" \|\| property\.kind === "contact_field" \? \{ color: "#E2E8F0" \}/.test(code), true);
  /* Integration (Batch 3, reviewed by Bones on INV-108): the read now runs through startCurrentRead.
     This keeps the endpoint and response-mapping intent and requires the effect to RETURN the read's
     cleanup. It is not ownership evidence: test-current-read and test-pipeline-requests prove that. */
  check('pipeline keeps the endpoint and stages/opportunities response mapping, and returns the read cleanup', /return startCurrentRead\(\(\) => ghl\.opportunities\.listPipeline\(\), \{\s*data: \(data\) => \{\s*setStages\(data\.stages\);\s*setOpportunities\(data\.opportunities\);\s*\},/.test(code), true);
  check('the opportunity name stays', /\{o\.opportunityName && \(\s*<div[^>]*>\{o\.opportunityName\}<\/div>\s*\)\}/.test(code), true);
  check('the page reads no address field itself; the join accepts exactly id, the four native parts and the Property Address field',
    [/address1|postalCode|mailing|\.city\b|\.state\b/i.test(code),
     (libSrc.match(/export type PropertyAddressContact = \{([^}]*)\}/) || [, ''])[1].split(';').map((s) => s.trim().split(':')[0]).filter(Boolean)],
    [false, ['id', 'address1', 'city', 'state', 'postalCode', 'propertyAddress']]);
  check('no mailing field anywhere in the join module', /mailing/i.test(libSrc), false);
  check('the row still links to its contact', /<Link\s+data-testid=\{`pipeline-row-contact-\$\{o\.id\}`\}\s+to=\{`\/contacts\/\$\{o\.contactId\}`\}/.test(code), true);
  check('sorting is unchanged (contact name or stage position only)', /type SortKey = "contactName" \| "stage";/.test(code) && /cmp = \(stagePosition\.get\(a\.stageId\) \?\? 0\) - \(stagePosition\.get\(b\.stageId\) \?\? 0\);/.test(code), true);
  check('the stage badge is unchanged', /<StageBadge name=\{stageName\.get\(o\.stageId\) \?\? "Unknown"\} \/>/.test(code), true);
  check('the column header is unchanged', />\s*Property \/ Opportunity\s*</.test(code), true);
  check('Pipeline stays read-only (no write call)', WRITES.test(code), false);
  check('both reads re-run on read recovery', (code.match(/\}, \[readRecovered\]\);/g) || []).length, 2);
  check('the join module does no I/O of its own', /fetch\(|import /.test(libSrc), false);
}

lateResponseCases().then(finish, (e) => { console.error(e); process.exit(1); });
function finish() {

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
}
