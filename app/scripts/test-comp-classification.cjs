/** B7-05 / INV-22 deterministic classification and bounded expansion evidence. */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-comp-classification-test');
const CLASSIFIER = path.join(APP, 'src', 'lib', 'comp-classification.ts');
const IMPORTER = path.join(APP, 'src', 'lib', 'propstream-comp-csv.ts');
const FIXTURE = path.join(__dirname, 'fixtures', 'propstream-comparable-export.csv');
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
try {
  execSync(`npx tsc "${CLASSIFIER}" "${IMPORTER}" --outDir "${TMP}" --module commonjs --target es2022 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const { importPropStreamCompCsv } = require(path.join(TMP, 'propstream-comp-csv.js'));
const {
  BOARD_7_COMP_POLICY,
  LEVEL_2_PROPSTREAM_INSTRUCTION,
  classifyComp,
  evaluateCompSearch,
} = require(path.join(TMP, 'comp-classification.js'));
const csv = fs.readFileSync(FIXTURE, 'utf8');
const imported = importPropStreamCompCsv(csv, { fileName: 'Comparable Export.csv', importedAt: '2026-09-02T15:08:33.000Z' });
const sample = imported.evidence[0];
const subject = {
  asOfDate: '2026-09-02',
  propertyType: 'Single Family Residential',
  squareFeet: 2300,
  subdivision: 'SUNSET RIDGE PHASE I (CMC)',
  beds: 3,
  baths: 2,
  yearBuilt: 1990,
  poolPresent: false,
};
const credible = (evidenceId, overrides = {}) => ({
  evidenceId,
  marketRelationship: 'LOCAL_COMPETITIVE_MARKET',
  marketReason: 'Same local buyer pool confirmed by the investor.',
  transactionReliability: 'CREDIBLE',
  transactionReason: 'Arm-length market sale confirmed by the investor.',
  ...overrides,
});
const clone = (id, overrides = {}) => ({ ...sample, evidenceId: id, ...overrides });

const FLOOR = 58;
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

check('standard recency constant', BOARD_7_COMP_POLICY.standardRecencyMonths, 6);
check('standard sqft constant', BOARD_7_COMP_POLICY.standardSquareFootTolerancePercent, 15);
check('expanded recency constant', BOARD_7_COMP_POLICY.expandedRecencyMonths, 12);
check('expanded sqft constant', BOARD_7_COMP_POLICY.expandedSquareFootTolerancePercent, 20);
check('accepted target constant', BOARD_7_COMP_POLICY.targetAcceptedCompCount, 3);

const accepted = classifyComp(subject, sample, credible(sample.evidenceId), 'STANDARD');
check('accepted disposition', accepted.disposition, 'ACCEPTED');
check('accepted has human reason', accepted.reasons.length > 0, true);
check('accepted reason names Level 1', accepted.reasons[0].includes('Level 1 STANDARD'), true);
check('bed difference warning', accepted.warnings.some((x) => x.startsWith('Bedroom difference:')), true);
check('age difference warning', accepted.warnings.some((x) => x.startsWith('Age difference:')), true);
check('pool difference warning', accepted.warnings.some((x) => x.startsWith('Pool difference:')), true);
check('sqft difference warning', accepted.warnings.some((x) => x.startsWith('Square-footage difference:')), true);
check('warnings forbid dollar adjustment', accepted.warnings.every((x) => x.includes('No dollar adjustment applied.')), true);

const old = clone('old', { saleDate: '2025-01-01' });
const supporting = classifyComp(subject, old, credible('old'), 'STANDARD');
check('supporting disposition', supporting.disposition, 'SUPPORTING');
check('supporting reason names recency', supporting.reasons.some((x) => x.includes('6-month recency')), true);

const wrongType = clone('wrong-type', { propertyType: 'Condominium' });
const rejected = classifyComp(subject, wrongType, credible('wrong-type'), 'STANDARD');
check('rejected disposition', rejected.disposition, 'REJECTED');
check('rejected reason names type', rejected.reasons.some((x) => x.includes('property type differs')), true);

const unreliable = clone('unreliable');
const unreliableResult = classifyComp(subject, unreliable, credible('unreliable', {
  transactionReliability: 'UNRELIABLE',
  transactionReason: 'Related-party transfer shown in source evidence.',
}), 'STANDARD');
check('unreliable transaction rejected', unreliableResult.disposition, 'REJECTED');
check('unreliable reason preserved', unreliableResult.reasons.some((x) => x.includes('Related-party transfer')), true);

const zero = imported.evidence[1];
const zeroResult = classifyComp(subject, zero, credible(zero.evidenceId), 'STANDARD');
check('zero transaction rejected', zeroResult.disposition, 'REJECTED');
check('zero transaction reason explicit', zeroResult.reasons.some((x) => x.includes('zero')), true);

const anomaly = clone('anomaly');
const anomalyResult = classifyComp(subject, anomaly, credible('anomaly', { obviousAnomaly: 'Duplicate deed record conflicts with verified closing.' }), 'STANDARD');
check('obvious anomaly rejected', anomalyResult.disposition, 'REJECTED');
check('obvious anomaly reason preserved', anomalyResult.reasons.some((x) => x.includes('Duplicate deed record')), true);

const future = clone('future', { saleDate: '2026-10-01' });
const futureResult = classifyComp(subject, future, credible('future'), 'STANDARD');
check('future sale rejected as anomaly', futureResult.disposition, 'REJECTED');
check('future date reason explicit', futureResult.reasons.some((x) => x.includes('after the as-of date')), true);

const unknownMarket = clone('unknown-market');
const unknownMarketResult = classifyComp(subject, unknownMarket, credible('unknown-market', {
  marketRelationship: 'UNKNOWN',
  marketReason: 'Buyer-pool relationship has not been reviewed.',
}), 'STANDARD');
check('unknown primary market rejected', unknownMarketResult.disposition, 'REJECTED');
check('unknown market reason preserved', unknownMarketResult.reasons.some((x) => x.includes('not been reviewed')), true);

const noProvenance = clone('no-provenance');
const noProvenanceResult = classifyComp(subject, noProvenance, credible('no-provenance', {
  marketReason: '',
  transactionReason: '',
}), 'STANDARD');
check('missing assessment provenance rejected', noProvenanceResult.disposition, 'REJECTED');
check('missing market provenance explicit', noProvenanceResult.reasons.some((x) => x.includes('market assessment has no human-readable provenance')), true);
check('missing transaction provenance explicit', noProvenanceResult.reasons.some((x) => x.includes('transaction assessment has no human-readable provenance')), true);

const notClosed = clone('not-closed', { saleSource: 'UNSUPPORTED', status: 'Pending' });
const notClosedResult = classifyComp(subject, notClosed, credible('not-closed'), 'STANDARD');
check('non-closed transaction rejected', notClosedResult.disposition, 'REJECTED');

const missingAssessment = evaluateCompSearch({ subject, candidates: [clone('no-assessment')], assessments: [], level: 'STANDARD' });
check('missing assessment rejected', missingAssessment.classifications[0].disposition, 'REJECTED');
check('missing assessment reason explicit', missingAssessment.classifications[0].reasons[0], 'Required market and transaction assessment is missing.');

const three = ['a', 'b', 'c'].map((id) => clone(id));
const threeAssessments = three.map((x) => credible(x.evidenceId));
const level1Stop = evaluateCompSearch({ subject, candidates: three, assessments: threeAssessments, level: 'STANDARD' });
check('Level 1 accepted count', level1Stop.acceptedCount, 3);
check('Level 1 stop outcome', level1Stop.outcome, 'STANDARD');
check('Level 1 has no next instruction', level1Stop.nextInstruction, null);
check('Level 1 does not require manual review', level1Stop.manualReviewRequired, false);

const two = three.slice(0, 2);
const level2Required = evaluateCompSearch({ subject, candidates: two, assessments: threeAssessments.slice(0, 2), level: 'STANDARD' });
check('under target requests Level 2', level2Required.outcome, 'LEVEL_2_REQUIRED');
check('exact Level 2 instruction returned', level2Required.nextInstruction, LEVEL_2_PROPSTREAM_INSTRUCTION);
check('instruction says 12 months', LEVEL_2_PROPSTREAM_INSTRUCTION.includes('within 12 months'), true);
check('instruction says +/-20%', LEVEL_2_PROPSTREAM_INSTRUCTION.includes('+/-20%'), true);
check('instruction says same type', LEVEL_2_PROPSTREAM_INSTRUCTION.includes('same fundamental property type'), true);
check('instruction says immediate area', LEVEL_2_PROPSTREAM_INSTRUCTION.includes('immediate competitive area'), true);
check('instruction stops after Level 2', LEVEL_2_PROPSTREAM_INSTRUCTION.includes('Stop automatic expansion after Level 2'), true);

const expandedSubject = { ...subject, subdivision: 'Different subdivision' };
const expandedCandidates = ['e1', 'e2', 'e3'].map((id) => clone(id, { saleDate: '2025-10-01', squareFeet: 2700 }));
const expandedAssessments = expandedCandidates.map((x) => credible(x.evidenceId, {
  marketRelationship: 'IMMEDIATE_COMPETITIVE_AREA',
  marketReason: 'Immediate competitive area confirmed by the investor.',
}));
const expandedStop = evaluateCompSearch({ subject: expandedSubject, candidates: expandedCandidates, assessments: expandedAssessments, level: 'EXPANDED' });
check('Level 2 accepts expanded criteria', expandedStop.acceptedCount, 3);
check('Level 2 stop outcome', expandedStop.outcome, 'EXPANDED');
check('Level 2 successful stop has no instruction', expandedStop.nextInstruction, null);

const limited = evaluateCompSearch({ subject, candidates: two, assessments: threeAssessments.slice(0, 2), level: 'EXPANDED' });
check('insufficient Level 2 outcome exact', limited.outcome, 'LIMITED COMP EVIDENCE');
check('insufficient Level 2 manual review', limited.manualReviewRequired, true);
check('insufficient Level 2 stops expansion', limited.nextInstruction, null);
check('insufficient message exact label', limited.message.startsWith('LIMITED COMP EVIDENCE:'), true);
check('insufficient message says stop', limited.message.includes('Stop automatic expansion'), true);

const source = fs.readFileSync(CLASSIFIER, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
check('no numeric score', /score|confidence\s*:\s*number|100-point/i.test(source), false);
check('no valuation calculation', /median|ARV_EVIDENCE_CONFLICT|reconciliation/i.test(source), false);
check('no dollar adjustment engine', /adjustmentGrid|adjustedPrice|featureDollar/i.test(source), false);
check('no automated neighborhood intelligence', /geocode|census|neighborhoodApi/i.test(source), false);
check('no persistence or network', /localStorage|sessionStorage|indexedDB|\bfetch\s*\(|XMLHttpRequest|\bPOST\b|\bPUT\b/i.test(source), false);
check('no repair MAO or offer behavior', /repair-estimation|computeRepair|\bmao\b|openingOffer/i.test(source), false);

cleanup();
console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
