/** B7-07 / INV-24 deterministic workspace orchestration and UI contract. */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-arv-workspace-test');
const MODEL = path.join(APP, 'src', 'lib', 'arv-workspace-model.ts');
const UI = path.join(APP, 'src', 'components', 'ArvCompsWorkspace.tsx');
const PAGE = path.join(APP, 'src', 'pages', 'UnderwritingWorkspace.tsx');
const FIXTURE = path.join(APP, 'scripts', 'fixtures', 'propstream-comparable-export.csv');
const sources = [MODEL, path.join(APP, 'src', 'lib', 'arv-reconciliation.ts'), path.join(APP, 'src', 'lib', 'comp-classification.ts'), path.join(APP, 'src', 'lib', 'propstream-comp-csv.ts')];
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
try {
  execSync(`npx tsc ${sources.map((x) => `"${x}"`).join(' ')} --outDir "${TMP}" --module commonjs --target es2022 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const { runArvWorkspace, subjectSeedFromContact } = require(path.join(TMP, 'arv-workspace-model.js'));
const csv = fs.readFileSync(FIXTURE, 'utf8');
const metadata = { fileName: 'Comparable Export.csv', importedAt: '2026-09-04T12:00:00.000Z' };
const subject = { asOfDate: '2026-09-02', propertyType: 'Single Family Residential', squareFeet: 2300, subdivision: 'SUNSET RIDGE PHASE I (CMC)', beds: 4, baths: 2, yearBuilt: 1990 };
const importedIds = ['row-2', 'row-3', 'row-4', 'row-5', 'row-6', 'row-7', 'row-8'];
const assessments = importedIds.map((evidenceId) => ({ evidenceId, marketRelationship: 'LOCAL_COMPETITIVE_MARKET', marketReason: 'Investor confirmed same buyer pool.', transactionReliability: 'CREDIBLE', transactionReason: 'Investor confirmed arm-length sale.' }));

const FLOOR = 49;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

const defs = [
  { id: 'type', fieldKey: 'contact.property_type' }, { id: 'sqft', fieldKey: 'contact.building_sqft' },
  { id: 'beds', fieldKey: 'contact.bedrooms' }, { id: 'baths', fieldKey: 'contact.total_bathrooms' },
  { id: 'year', fieldKey: 'contact.effective_year_built' },
];
const seed = subjectSeedFromContact({ customFields: [
  { id: 'type', value: ' Single Family Residential ' }, { id: 'sqft', value: '2,300' },
  { id: 'beds', value: 4 }, { id: 'baths', value: '2.5' }, { id: 'year', value: 1990 },
] }, defs);
check('existing property type carrier seeds workspace', seed.propertyType, 'Single Family Residential');
check('existing sqft carrier seeds workspace', seed.squareFeet, 2300);
check('existing bedrooms carrier seeds workspace', seed.beds, 4);
check('existing bathrooms carrier seeds workspace', seed.baths, 2.5);
check('existing year carrier seeds workspace', seed.yearBuilt, 1990);
check('missing subdivision carrier remains session-only blank', seed.subdivision, '');
check('invalid sparse values do not guess', subjectSeedFromContact({ customFields: [{ id: 'sqft', value: 'unknown' }] }, defs).squareFeet, null);

const result = runArvWorkspace({ csv, metadata, subject, assessments, level: 'STANDARD' });
check('known CSV imported through B7-04', result.imported.evidence.length, 7);
check('source metadata retained', result.imported.source.fileName, metadata.fileName);
check('search ran through B7-05', result.search !== null, true);
check('three or more comps accepted', result.search.acceptedCount >= 3, true);
check('zero public-record price rejected', result.search.classifications.find((x) => x.evidenceId === 'row-3').disposition, 'REJECTED');
check('oversize comp supporting', result.search.classifications.find((x) => x.evidenceId === 'row-4').disposition, 'SUPPORTING');
check('reconciliation ran through B7-06', result.reconciliation !== null, true);
check('workspace produces categorical evidence', ['HIGH', 'MODERATE', 'LOW', 'INSUFFICIENT'].includes(result.reconciliation.evidenceState), true);
check('workspace exposes preliminary result shape', Object.hasOwn(result.reconciliation, 'recommendedArv'), true);

const structural = runArvWorkspace({ csv: 'bad,headers\n1,2', metadata, subject, assessments: [], level: 'STANDARD' });
check('malformed schema stays visible', structural.imported.issues.some((x) => x.severity === 'error'), true);
check('malformed schema does not classify', structural.search, null);
check('malformed schema does not reconcile', structural.reconciliation, null);

const sparseAssessments = assessments.slice(0, 2);
const needsMore = runArvWorkspace({ csv, metadata, subject, assessments: sparseAssessments, level: 'STANDARD' });
check('insufficient accepted evidence requests Level 2', needsMore.search.outcome, 'LEVEL_2_REQUIRED');
check('Level 2 instruction reaches workspace model', needsMore.search.nextInstruction.includes('PropStream Level 2 EXPANDED search'), true);

const ui = fs.readFileSync(UI, 'utf8');
const page = fs.readFileSync(PAGE, 'utf8');
for (const label of ['Preliminary ARV', 'Evidence state', 'Accepted comps', 'Median sale', 'PPSF cross-check', 'View Comps', 'Approve ARV', 'Override', 'Get More Comps', 'Import PropStream CSV', 'Imported source evidence', 'Reasons:', 'Warnings:']) {
  check(`UI exposes ${label}`, ui.includes(label), true);
}
check('UI exposes manual-review state', ui.includes('Manual review required'), true);
check('UI exposes clear search instruction', ui.includes('arv-search-instruction'), true);
check('UI uses B7-02 handoff', ui.includes('handoffToPropStream(address, browserHandoffEnvironment())'), true);
check('UI uses B7-04 importer', ui.includes('importPropStreamCompCsv(csv'), true);
check('workspace model uses B7-05 engine', fs.readFileSync(MODEL, 'utf8').includes('evaluateCompSearch({'), true);
check('workspace model uses B7-06 engine', fs.readFileSync(MODEL, 'utf8').includes('reconcileAcceptedCompArv({'), true);
check('normal underwriting flow renders workspace', page.includes('<ArvCompsWorkspace contact={contact} />'), true);
check('approval explicitly session-only', ui.includes('Approved ${money(approval.amount)} for this session.'), true);
check('override preserves preliminary amount in session', ui.includes('preliminary ARV was ${money(approval.computed)}'), true);

const executable = ui.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
check('no ARV GHL setter', /setARV|saveUnderwritingFields|_putMonetaryField/.test(executable), false);
check('no local persistence', /localStorage|sessionStorage|indexedDB/.test(executable), false);
check('no PropStream credential handling', /propstream.*(password|username|credential)|(password|username|credential).*propstream/i.test(executable), false);
check('no MAO or offer workspace behavior', /Seller MAO|End-Buyer|openingOffer|offerPrice/.test(executable), false);
check('no repair estimator duplication', /RepairEstimator|computeRepair|repair-estimation/.test(executable), false);
check('no appraisal grid score or weighting', /adjustmentGrid|numericConfidence|similarityWeight/i.test(executable), false);

cleanup();
console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
