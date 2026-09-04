/**
 * B7-04 / INV-21 — deterministic PropStream comparable CSV import evidence.
 * No network, GHL, persistence, classification, expansion, valuation, or UI.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-propstream-comp-csv-test');
const SRC = path.join(APP, 'src', 'lib', 'propstream-comp-csv.ts');
const FIXTURE = path.join(__dirname, 'fixtures', 'propstream-comparable-export.csv');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
try {
  execSync('npx tsc "' + SRC + '" --outDir "' + TMP + '" --module commonjs --target es2022 --strict', {
    cwd: APP,
    stdio: 'inherit',
  });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const { importPropStreamCompCsv, PROPSTREAM_COMP_IMPORT_VERSION } = require(path.join(TMP, 'propstream-comp-csv.js'));
const csv = fs.readFileSync(FIXTURE, 'utf8');
const metadata = { fileName: 'Comparable Export.csv', importedAt: '2026-09-02T15:08:33.000Z' };
const result = importPropStreamCompCsv(csv, metadata);

const FLOOR = 70;
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

check('known sample imports seven evidence rows', result.evidence.length, 7);
check('known sample has seven property groups', result.propertyGroups.length, 7);
check('known sample has no structural errors', result.issues.filter((x) => x.severity === 'error'), []);
check('source kind retained', result.source.kind, 'PROPSTREAM_COMPARABLE_CSV');
check('source version retained', result.source.version, PROPSTREAM_COMP_IMPORT_VERSION);
check('source filename retained', result.source.fileName, metadata.fileName);
check('source import instant retained', result.source.importedAt, metadata.importedAt);
check('trailing empty export column is framing, not a header', result.source.headers.length, 20);

const first = result.evidence[0];
check('street normalized conservatively', first.address.street, '2632 Valley Creek Trl');
check('city normalized conservatively', first.address.city, 'McKinney');
check('state uppercased', first.address.state, 'TX');
check('zip preserved as text', first.address.postalCode, '75072');
check('formatted address uses existing carrier shape', first.address.formatted, '2632 Valley Creek Trl McKinney, TX 75072');
check('property key is deterministic', first.propertyKey, '2632 valley creek trl|mckinney|tx|75072');
check('MLS provenance explicit', first.saleSource, 'MLS');
check('date normalized to ISO', first.saleDate, '2026-05-21');
check('sale price normalized', first.salePrice, 787360);
check('valid sale price state explicit', first.salePriceState, 'VALID');
check('MLS DOM normalized', first.mlsDaysOnMarket, 3);
check('beds normalized', first.beds, 4);
check('baths normalized', first.baths, 2);
check('sqft normalized', first.squareFeet, 2283);
check('lot sqft normalized', first.lotSquareFeet, 9147);
check('year normalized', first.yearBuilt, 1988);
check('PPSF normalized', first.pricePerSquareFoot, 344.88);
check('pool normalized', first.poolPresent, true);
check('multi-parcel normalized', first.multiParcel, false);
check('distance normalized', first.distanceMiles, 0.14);
check('raw source casing retained', first.raw.City, 'McKinney');

const publicZero = result.evidence[1];
check('Public Record provenance explicit', publicZero.saleSource, 'PUBLIC_RECORD');
check('$0 amount retained numerically', publicZero.salePrice, 0);
check('$0 amount marked unusable', publicZero.salePriceState, 'ZERO');
check('$0 warning emitted', publicZero.issues.some((x) => x.code === 'ZERO_SALE_PRICE'), true);
check('blank MLS DOM stays null', publicZero.mlsDaysOnMarket, null);
check('blank lot sqft stays null', publicZero.lotSquareFeet, null);
check('raw doubled subdivision spaces retained', publicZero.raw.Subdivision, 'SUNSET RIDGE #2  (CMC)');
check('normalized subdivision collapses whitespace', publicZero.subdivision, 'SUNSET RIDGE #2 (CMC)');

const repeat = importPropStreamCompCsv(csv, metadata);
check('same input and metadata are deterministic', repeat, result);

const header = csv.split(/\r?\n/)[0];
const base = csv.split(/\r?\n/)[1];
const conflicting = base.replace('787360', '700000').replace('MLS Sold', 'Public Record Sold');
const duplicateCsv = [header, base, base, conflicting, ''].join('\n');
const duplicateResult = importPropStreamCompCsv(duplicateCsv, metadata);
check('same-property rows are all retained', duplicateResult.evidence.length, 3);
check('same-property rows form one group', duplicateResult.propertyGroups.length, 1);
check('group names all evidence ids', duplicateResult.propertyGroups[0].evidenceIds, ['row-2', 'row-3', 'row-4']);
check('exact repeated evidence is explicit', duplicateResult.propertyGroups[0].repeatedEvidence, [['row-2', 'row-3']]);
check('contradictory sale prices are explicit', duplicateResult.propertyGroups[0].conflicts.find((x) => x.field === 'salePrice').values, [787360, 700000]);
check('contradictory provenance is explicit', duplicateResult.propertyGroups[0].conflicts.find((x) => x.field === 'saleSource').values, ['MLS', 'PUBLIC_RECORD']);

const missingPrice = base.replace(',787360,', ',,');
const unusablePrice = base.replace(',787360,', ',not-a-price,');
const priceResult = importPropStreamCompCsv([header, missingPrice, unusablePrice, ''].join('\n'), metadata);
check('missing price state explicit', priceResult.evidence[0].salePriceState, 'MISSING');
check('missing price issue explicit', priceResult.evidence[0].issues.some((x) => x.code === 'MISSING_SALE_PRICE'), true);
check('unusable price state explicit', priceResult.evidence[1].salePriceState, 'UNUSABLE');
check('unusable price issue explicit', priceResult.evidence[1].issues.some((x) => x.code === 'UNUSABLE_SALE_PRICE'), true);
check('unusable raw price retained', priceResult.evidence[1].raw.Amount, 'not-a-price');

const badDate = base.replace('05/21/2026', '02/30/2026');
const fieldIssueResult = importPropStreamCompCsv([header, badDate.replace(',Yes,', ',Maybe,'), ''].join('\n'), metadata);
check('invalid calendar date does not roll over', fieldIssueResult.evidence[0].saleDate, null);
check('invalid date issue explicit', fieldIssueResult.evidence[0].issues.some((x) => x.code === 'INVALID_DATE'), true);
check('unsupported boolean does not guess', fieldIssueResult.evidence[0].poolPresent, null);
check('unsupported boolean issue explicit', fieldIssueResult.evidence[0].issues.some((x) => x.code === 'INVALID_BOOLEAN'), true);

const malformed = importPropStreamCompCsv('"unclosed', metadata);
check('malformed CSV is a structural error', malformed.issues.some((x) => x.code === 'MALFORMED_CSV' && x.severity === 'error'), true);
check('malformed CSV produces no evidence', malformed.evidence, []);

const missingColumn = importPropStreamCompCsv(csv.replace('Distance,', 'Unsupported,').replace(/,0\.\d+,/g, ',x,'), metadata);
check('missing required column is explicit', missingColumn.issues.some((x) => x.code === 'MISSING_COLUMN' && x.column === 'Distance'), true);
check('unsupported column is preserved and reported', missingColumn.issues.some((x) => x.code === 'UNSUPPORTED_COLUMN' && x.column === 'Unsupported'), true);
check('structural schema error prevents partial normalization', missingColumn.evidence, []);

const extendedHeader = header.replace(/,$/, ',Extra,');
const extendedRow = base.replace(/,$/, ',verbatim extra value,');
const extended = importPropStreamCompCsv([extendedHeader, extendedRow, ''].join('\n'), metadata);
check('unsupported extra column is explicit', extended.issues.some((x) => x.code === 'UNSUPPORTED_COLUMN' && x.column === 'Extra'), true);
check('unsupported extra value is retained raw', extended.evidence[0].raw.Extra, 'verbatim extra value');

const widthMismatch = importPropStreamCompCsv([header, base, base.replace(',0.14,', ',0.14,unexpected,')].join('\n'), metadata);
check('row-width mismatch is explicit', widthMismatch.issues.some((x) => x.code === 'ROW_WIDTH_MISMATCH' && x.rowNumber === 3), true);
check('row-width mismatch prevents partial normalization', widthMismatch.evidence, []);

const quoted = header + '\n"12 Main St, Unit 2",McKinney,TX,75072,Single Family Residential,MLS Sold,2026-05-21,"$787,360",3,4,2,"2,283","9,147",1988,344.88,Yes,"Seller said ""cash""",Test,No,0.14,\n';
const quotedResult = importPropStreamCompCsv(quoted, metadata);
check('quoted comma survives in raw evidence', quotedResult.evidence[0].raw['Street Address'], '12 Main St, Unit 2');
check('quoted currency normalizes strictly', quotedResult.evidence[0].salePrice, 787360);
check('escaped quote survives in raw evidence', quotedResult.evidence[0].raw['Sale Situation'], 'Seller said "cash"');

const source = fs.readFileSync(SRC, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
check('no network call in import seam', /\bfetch\s*\(|XMLHttpRequest|axios/i.test(source), false);
check('no GHL identifiers in import seam', /leadconnector|locationId|customFields|offer_arv/i.test(source), false);
check('no downstream classification or valuation output', /ACCEPTED|SUPPORTING|REJECTED|ARV_EVIDENCE_CONFLICT|median|recommend/i.test(source), false);
check('no persistence mechanism in import seam', /localStorage|sessionStorage|indexedDB|\bPOST\b|\bPUT\b/i.test(source), false);
check('no repair, MAO, or offer calculation in import seam', /repair-estimation|computeRepair|\bmao\b|openingOffer/i.test(source), false);

cleanup();
console.log('');
console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
if (checks !== FLOOR) {
  console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '.');
  process.exit(2);
}
if (failures > 0) {
  console.error('FAILED');
  process.exit(1);
}
console.log('OK');
