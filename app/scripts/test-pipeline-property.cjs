/**
 * B15-09 (INV-108) -- Pipeline property context.
 *
 * Offline. Compiles the pure join (src/lib/pipeline-property.ts) and runs
 * table-driven cases, then checks the Pipeline wiring by source text,
 * following this repository's convention for UI wiring. Proves: a row shows
 * its contact's property_address; an empty one reads "Property address not
 * recorded."; a failed or lagging contacts read never claims the address is
 * missing; the mailing address can never be substituted; contact links,
 * sorting and stages are unchanged; the page writes nothing.
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

const { indexPropertyAddresses, pipelinePropertyCell, PROPERTY_ADDRESS_NOT_RECORDED, PROPERTY_ADDRESS_UNAVAILABLE } = require(path.join(TMP, 'src/lib/pipeline-property.js'));
fs.rmSync(TMP, { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 24;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

// ============================================================
// The join.
// ============================================================
{
  // Full ContactRow-shaped records: a mailing address is present on every one.
  const contacts = [
    { id: 'c1', propertyAddress: '123 Main St, Austin, TX 78701', address1: '9 Mailing Rd', city: 'Dallas', state: 'TX', postalCode: '75001' },
    { id: 'c2', propertyAddress: '', address1: '9 Mailing Rd', city: 'Dallas', state: 'TX', postalCode: '75001' },
    { id: 'c3', propertyAddress: '   ', address1: '77 Other Ave', city: 'Waco', state: 'TX', postalCode: '76701' },
  ];
  const loaded = { kind: 'loaded', byContactId: indexPropertyAddresses(contacts) };

  check('the contact\'s property_address is shown', pipelinePropertyCell('c1', loaded), { kind: 'address', text: '123 Main St, Austin, TX 78701' });
  check('an empty property_address reads "Property address not recorded."', pipelinePropertyCell('c2', loaded), { kind: 'not_recorded', text: 'Property address not recorded.' });
  check('a whitespace-only property_address is also not recorded', pipelinePropertyCell('c3', loaded), { kind: 'not_recorded', text: 'Property address not recorded.' });
  check('the mailing address is never substituted (empty property_address)', JSON.stringify(pipelinePropertyCell('c2', loaded)).includes('Mailing'), false);
  check('the mailing address is never substituted (blank property_address)', JSON.stringify(pipelinePropertyCell('c3', loaded)).includes('Other Ave'), false);
  check('the index keeps only id -> property_address', [...indexPropertyAddresses(contacts).entries()], [['c1', '123 Main St, Austin, TX 78701'], ['c2', ''], ['c3', '']]);
  check('an opportunity with no contact has no recorded address', pipelinePropertyCell('', loaded), { kind: 'not_recorded', text: PROPERTY_ADDRESS_NOT_RECORDED });
  check('a contact the list did not return is "couldn\'t be loaded", never "not recorded"', pipelinePropertyCell('c9', loaded), { kind: 'unavailable', text: PROPERTY_ADDRESS_UNAVAILABLE });
  check('a failed contacts read is "couldn\'t be loaded", never "not recorded"', pipelinePropertyCell('c1', { kind: 'failed', detail: 'ghl-contacts → 502' }), { kind: 'unavailable', text: "Property address couldn't be loaded." });
  check('while the contacts read is in flight the cell says it is loading', pipelinePropertyCell('c1', { kind: 'loading' }).kind, 'loading');
}

// ============================================================
// Pipeline wiring (source text).
// ============================================================
{
  const raw = fs.readFileSync(path.join(APP, 'src/pages/Pipeline.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const WRITES = /\.(set|save|create|update|delete)[A-Z]\w*\(|notes\.create\(|writeCommand\(|method:\s*"(POST|PUT|PATCH|DELETE)"/;
  const lib = fs.readFileSync(path.join(APP, 'src/lib/pipeline-property.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  check('Pipeline imports the join', /import \{ indexPropertyAddresses, pipelinePropertyCell, type PropertyAddressSource \} from "\.\.\/lib\/pipeline-property";/.test(code), true);
  check('addresses come from the existing contacts read, indexed by contact id', /ghl\.contacts\.listAll\(\)\s*\.then\(\(contacts\) => setAddressSource\(\{ kind: "loaded", byContactId: indexPropertyAddresses\(contacts\) \}\)\)/.test(code), true);
  check('a failed contacts read is caught on its own (the pipeline still renders)', /\.catch\(\(e: Error\) => setAddressSource\(\{ kind: "failed", detail: e\.message \}\)\);\s*\}, \[readRecovered\]\);/.test(code), true);
  check('the pipeline read itself is unchanged', /ghl\.opportunities\.listPipeline\(\)\s*\.then\(\(data\) => \{\s*setStages\(data\.stages\);\s*setOpportunities\(data\.opportunities\);\s*\}\)/.test(code), true);
  check('each row renders the property cell for its contact', /pipelinePropertyCell\(o\.contactId, addressSource\)/.test(code) && /data-testid=\{`pipeline-row-property-\$\{o\.id\}`\}/.test(code) && /\{property\.text\}/.test(code), true);
  check('the opportunity name stays, below the address', /\{o\.opportunityName && \(\s*<div[^>]*>\{o\.opportunityName\}<\/div>\s*\)\}/.test(code), true);
  check('no mailing-address field is read on the page or in the join', /address1|postalCode|\.city\b|\.state\b/.test(code) || /address1|postalCode|\.city\b/.test(lib), false);
  check('the row still links to its contact', /<Link\s+data-testid=\{`pipeline-row-contact-\$\{o\.id\}`\}\s+to=\{`\/contacts\/\$\{o\.contactId\}`\}/.test(code), true);
  check('sorting is unchanged (contact name or stage position only)', /type SortKey = "contactName" \| "stage";/.test(code) && /cmp = \(stagePosition\.get\(a\.stageId\) \?\? 0\) - \(stagePosition\.get\(b\.stageId\) \?\? 0\);/.test(code), true);
  check('the stage badge is unchanged', /<StageBadge name=\{stageName\.get\(o\.stageId\) \?\? "Unknown"\} \/>/.test(code), true);
  check('the column header is unchanged', />\s*Property \/ Opportunity\s*</.test(code), true);
  check('Pipeline stays read-only (no write call)', WRITES.test(code), false);
  check('both reads re-run on read recovery', (code.match(/\}, \[readRecovered\]\);/g) || []).length, 2);
  check('the join module has no I/O', /fetch\(|import /.test(lib), false);
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
