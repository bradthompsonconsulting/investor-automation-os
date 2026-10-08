/**
 * B15-09 (INV-108) -- Pipeline property context.
 *
 * Offline. Compiles src/lib/pipeline-property.ts and runs table-driven
 * cases, then checks the Pipeline wiring by source text, following this
 * repository's convention for UI wiring. Proves: a row shows its contact's
 * Property Address field, always labelled as a contact field not confirmed
 * for the deal; a contact with several deals says so on each; an empty
 * field is reported as an empty field, never as "no property address"; a
 * failed or lagging contacts read says the address couldn't be loaded;
 * neither the native contact address nor a mailing address is ever used;
 * contact links, sorting and stages are unchanged; the page writes nothing.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-pipeline-property-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/pipeline-property.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const lib = require(path.join(TMP, 'src/lib/pipeline-property.js'));
const { indexPropertyAddresses, countDealsByContact, pipelinePropertyCell } = lib;
fs.rmSync(TMP, { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 30;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

const FIELD_NOTE = "From the contact's Property Address field, not confirmed for this deal";
const NOT_VERIFIED = 'Property not verified for this deal';

// ============================================================
// The cell: what it shows and what it claims.
// ============================================================
{
  // ContactRow-shaped records. Every one also carries a native (PropStream-
  // imported) address and a mailing address, which must never be shown.
  const contacts = [
    { id: 'c1', propertyAddress: '123 Main St, Austin, TX 78701', address1: '500 Native Imported Rd', city: 'Dallas', state: 'TX', postalCode: '75001', mailingAddress: '9 Mailing Rd' },
    { id: 'c2', propertyAddress: '', address1: '500 Native Imported Rd', city: 'Dallas', state: 'TX', postalCode: '75001', mailingAddress: '9 Mailing Rd' },
    { id: 'c3', propertyAddress: '   ', address1: '77 Other Ave', city: 'Waco', state: 'TX', postalCode: '76701', mailingAddress: '9 Mailing Rd' },
  ];
  const loaded = { kind: 'loaded', byContactId: indexPropertyAddresses(contacts) };

  check('the field value is shown, labelled as a contact field not confirmed for the deal',
    pipelinePropertyCell('c1', 1, loaded), { kind: 'contact_field', text: '123 Main St, Austin, TX 78701', note: FIELD_NOTE });
  check('an empty field is reported as an empty field, not as a missing property',
    pipelinePropertyCell('c2', 1, loaded), { kind: 'field_empty', text: NOT_VERIFIED, note: "The contact's Property Address field is empty." });
  check('a whitespace-only field is also an empty field', pipelinePropertyCell('c3', 1, loaded).kind, 'field_empty');
  check('Bones repro: a full native imported address with a blank field never reads as "not recorded"',
    /not recorded|no property address/i.test(JSON.stringify(pipelinePropertyCell('c2', 1, loaded))), false);
  check('the native imported address is never substituted', /Native Imported|Other Ave|Dallas|Waco/.test(JSON.stringify([pipelinePropertyCell('c2', 1, loaded), pipelinePropertyCell('c3', 1, loaded)])), false);
  check('the mailing address is never substituted', /Mailing/.test(JSON.stringify([1, 2, 3].map((n) => pipelinePropertyCell(`c${n}`, 1, loaded)))), false);
  check('the index keeps only id -> Property Address field', [...indexPropertyAddresses(contacts).entries()], [['c1', '123 Main St, Austin, TX 78701'], ['c2', ''], ['c3', '']]);
  check('a deal with no contact makes no claim about the property',
    pipelinePropertyCell('', 0, loaded), { kind: 'no_contact', text: NOT_VERIFIED, note: 'No contact is linked to this deal.' });
  check('a contact the list did not return: couldn\'t be loaded',
    pipelinePropertyCell('c9', 1, loaded), { kind: 'unavailable', text: "Property address couldn't be loaded.", note: null });
  check('a failed contacts read: couldn\'t be loaded',
    pipelinePropertyCell('c1', 1, { kind: 'failed', detail: 'ghl-contacts → 502' }), { kind: 'unavailable', text: "Property address couldn't be loaded.", note: null });
  check('while the contacts read is in flight the cell says it is loading', pipelinePropertyCell('c1', 1, { kind: 'loading' }).kind, 'loading');
  check('no state of the cell claims a property address is absent', /not recorded/i.test(JSON.stringify(Object.values(lib).filter((v) => typeof v === 'string'))), false);
}

// ============================================================
// Several deals on one contact (Bones finding 2; PB-D55 allows it).
// ============================================================
{
  const opps = [{ id: 'o1', contactId: 'c1' }, { id: 'o2', contactId: 'c1' }, { id: 'o3', contactId: 'c2' }, { id: 'o4', contactId: '' }];
  const counts = countDealsByContact(opps);
  check('deals are counted per contact; a deal with no contact is not counted', [...counts.entries()], [['c1', 2], ['c2', 1]]);
  const loaded = { kind: 'loaded', byContactId: indexPropertyAddresses([{ id: 'c1', propertyAddress: '123 Main St' }, { id: 'c2', propertyAddress: '9 Elm St' }]) };
  const o1 = pipelinePropertyCell('c1', counts.get('c1'), loaded);
  const o2 = pipelinePropertyCell('c1', counts.get('c1'), loaded);
  check('two deals on one contact: each row says the contact has 2 deals', [o1.note, o2.note],
    [`${FIELD_NOTE}: this contact has 2 deals in the pipeline`, `${FIELD_NOTE}: this contact has 2 deals in the pipeline`]);
  check('two deals on one contact: the value is still the contact field, never presented as the deal\'s', [o1.kind, o2.kind], ['contact_field', 'contact_field']);
  check('a single-deal contact gets no multi-deal wording', /deals in the pipeline/.test(pipelinePropertyCell('c2', counts.get('c2'), loaded).note), false);
}

// ============================================================
// Pipeline wiring (source text).
// ============================================================
{
  const raw = fs.readFileSync(path.join(APP, 'src/pages/Pipeline.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const WRITES = /\.(set|save|create|update|delete)[A-Z]\w*\(|notes\.create\(|writeCommand\(|method:\s*"(POST|PUT|PATCH|DELETE)"/;
  const libSrc = fs.readFileSync(path.join(APP, 'src/lib/pipeline-property.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  check('Pipeline imports the cell helpers', /import \{[^}]*\bcountDealsByContact\b[^}]*\bpipelinePropertyCell\b[^}]*\} from "\.\.\/lib\/pipeline-property";/.test(code), true);
  check('deal counts come from the loaded opportunities', /const dealsByContact = useMemo\(\(\) => countDealsByContact\(opportunities\), \[opportunities\]\);/.test(code), true);
  check('each row passes its contact, that contact\'s deal count and the address read', /pipelinePropertyCell\(o\.contactId, dealsByContact\.get\(o\.contactId\) \?\? 0, addressSource\)/.test(code), true);
  check('the row renders the value and, beneath it, the note', /\{property\.text\}/.test(code) && /\{property\.note && \(\s*<div data-testid=\{`pipeline-row-property-note-\$\{o\.id\}`\}/.test(code), true);
  check('the pipeline read itself is unchanged', /ghl\.opportunities\.listPipeline\(\)\s*\.then\(\(data\) => \{\s*setStages\(data\.stages\);\s*setOpportunities\(data\.opportunities\);\s*\}\)/.test(code), true);
  check('the opportunity name stays', /\{o\.opportunityName && \(\s*<div[^>]*>\{o\.opportunityName\}<\/div>\s*\)\}/.test(code), true);
  check('no native or mailing address field is read on the page or in the join', /address1|postalCode|mailing|\.city\b|\.state\b/i.test(code) || /address1|postalCode|mailing|\.city\b/i.test(libSrc), false);
  check('the row still links to its contact', /<Link\s+data-testid=\{`pipeline-row-contact-\$\{o\.id\}`\}\s+to=\{`\/contacts\/\$\{o\.contactId\}`\}/.test(code), true);
  check('sorting is unchanged (contact name or stage position only)', /type SortKey = "contactName" \| "stage";/.test(code) && /cmp = \(stagePosition\.get\(a\.stageId\) \?\? 0\) - \(stagePosition\.get\(b\.stageId\) \?\? 0\);/.test(code), true);
  check('the stage badge is unchanged', /<StageBadge name=\{stageName\.get\(o\.stageId\) \?\? "Unknown"\} \/>/.test(code), true);
  check('the column header is unchanged', />\s*Property \/ Opportunity\s*</.test(code), true);
  check('Pipeline stays read-only (no write call)', WRITES.test(code), false);
  check('both reads re-run on read recovery', (code.match(/\}, \[readRecovered\]\);/g) || []).length, 2);
  check('the join module does no I/O', /fetch\(|import /.test(libSrc), false);
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
