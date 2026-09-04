/** B7-06 / INV-23 deterministic conservative ARV reconciliation evidence. */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-arv-reconciliation-test');
const SOURCES = [
  path.join(APP, 'src', 'lib', 'arv-reconciliation.ts'),
  path.join(APP, 'src', 'lib', 'comp-classification.ts'),
  path.join(APP, 'src', 'lib', 'propstream-comp-csv.ts'),
];
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
try {
  execSync(`npx tsc ${SOURCES.map((x) => `"${x}"`).join(' ')} --outDir "${TMP}" --module commonjs --target es2022 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const { BOARD_7_ARV_POLICY, reconcileAcceptedCompArv } = require(path.join(TMP, 'arv-reconciliation.js'));
const acceptedClassification = (id) => ({ evidenceId: id, disposition: 'ACCEPTED', reasons: ['test accepted'], warnings: [] });
const supportingClassification = (id) => ({ evidenceId: id, disposition: 'SUPPORTING', reasons: ['test supporting'], warnings: [] });
const evidence = (id, salePrice, ppsf, classification = acceptedClassification(id), extra = {}) => ({
  comp: {
    evidenceId: id,
    salePrice,
    salePriceState: salePrice > 0 ? 'VALID' : 'ZERO',
    pricePerSquareFoot: ppsf,
  },
  classification,
  ...extra,
});
const run = (items, overrides = {}) => reconcileAcceptedCompArv({
  subjectLivingSquareFeet: 2000,
  searchLevel: 'STANDARD',
  evidence: items,
  ...overrides,
});

const FLOOR = 51;
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

check('accepted minimum constant', BOARD_7_ARV_POLICY.minimumAcceptedCompCount, 3);
check('reconciliation threshold constant', BOARD_7_ARV_POLICY.reconciliationThresholdPercent, 5);
check('rounding increment is whole-dollar only', BOARD_7_ARV_POLICY.conservativeRoundingIncrementDollars, 1);

const oddMedian = run([
  evidence('high', 330000, 160),
  evidence('low', 290000, 140),
  evidence('middle', 310000, 150),
]);
check('odd sold prices use median', oddMedian.primaryMedianSoldPrice, 310000);
check('odd PPSF uses median', oddMedian.medianAcceptedPricePerSquareFoot, 150);
check('PPSF cross-check multiplies subject sqft', oddMedian.pricePerSquareFootCrossCheck, 300000);
check('within threshold recommends', oddMedian.outcome, 'RECOMMENDED');
check('within threshold chooses lower', oddMedian.recommendedArv, 300000);
check('standard sufficient evidence is HIGH', oddMedian.evidenceState, 'HIGH');
check('successful result needs no manual review', oddMedian.manualReviewRequired, false);

const evenMedian = run([
  evidence('a', 280000, 140),
  evidence('b', 300000, 145),
  evidence('c', 320000, 155),
  evidence('d', 340000, 160),
]);
check('even sold prices average middle pair only', evenMedian.primaryMedianSoldPrice, 310000);
check('even PPSF averages middle pair only', evenMedian.medianAcceptedPricePerSquareFoot, 150);

const boundary = run([
  evidence('a', 300000, 150),
  evidence('b', 315000, 150),
  evidence('c', 315000, 150),
]);
check('exact 5 percent divergence', boundary.divergencePercent, 5);
check('exact 5 percent is reconciled', boundary.outcome, 'RECOMMENDED');
check('exact boundary selects lower', boundary.recommendedArv, 300000);

const conflict = run([
  evidence('a', 330000, 150),
  evidence('b', 330000, 150),
  evidence('c', 330000, 150),
]);
check('over 5 percent conflicts', conflict.outcome, 'ARV EVIDENCE CONFLICT');
check('conflict has no recommendation', conflict.recommendedArv, null);
check('conflict requires manual review', conflict.manualReviewRequired, true);
check('conflict evidence is LOW', conflict.evidenceState, 'LOW');
check('conflict does not average methods', conflict.reasons[0].includes('not averaged'), true);

const rangeGuard = run([
  evidence('a', 300000, 147.5),
  evidence('b', 300000, 147.5),
  evidence('c', 400000, 147.5),
]);
check('range minimum retained', rangeGuard.supportedSaleRange.minimum, 300000);
check('range maximum retained', rangeGuard.supportedSaleRange.maximum, 400000);
check('below-range lower indication clamps up', rangeGuard.recommendedArv, 300000);
check('guardrail never recommends outside range', rangeGuard.recommendedArv >= rangeGuard.supportedSaleRange.minimum && rangeGuard.recommendedArv <= rangeGuard.supportedSaleRange.maximum, true);

const rounded = run([
  evidence('a', 290000, 149.99995),
  evidence('b', 300000, 149.99995),
  evidence('c', 300000, 149.99995),
]);
check('raw cross-check preserves calculation', rounded.pricePerSquareFootCrossCheck, 299999.9);
check('conservative rounding floors', rounded.recommendedArv, 299999);
check('rounding never rounds upward', rounded.recommendedArv <= rounded.pricePerSquareFootCrossCheck, true);

const expanded = run([
  evidence('a', 300000, 150), evidence('b', 300000, 150), evidence('c', 300000, 150),
], { searchLevel: 'EXPANDED' });
check('expanded sufficient evidence is MODERATE', expanded.evidenceState, 'MODERATE');

const insufficient = run([evidence('a', 300000, 150), evidence('b', 300000, 150)]);
check('two accepted comps insufficient', insufficient.outcome, 'INSUFFICIENT EVIDENCE');
check('insufficient evidence state exact', insufficient.evidenceState, 'INSUFFICIENT');
check('insufficient has no recommendation', insufficient.recommendedArv, null);
check('insufficient requires manual review', insufficient.manualReviewRequired, true);

const missingPpsf = run([
  evidence('a', 300000, 150), evidence('b', 300000, null), evidence('c', 300000, null),
]);
check('fewer than three usable PPSF insufficient', missingPpsf.outcome, 'INSUFFICIENT EVIDENCE');
check('missing PPSF reason explicit', missingPpsf.reasons.some((x) => x.includes('usable positive PPSF')), true);

const supportingIgnored = run([
  evidence('a', 300000, 150),
  evidence('b', 300000, 150),
  evidence('c', 300000, 150),
  evidence('supporting', 999999, 999, supportingClassification('supporting')),
]);
check('supporting comp excluded from accepted ids', supportingIgnored.acceptedEvidenceIds, ['a', 'b', 'c']);
check('supporting anomaly cannot move median', supportingIgnored.primaryMedianSoldPrice, 300000);

const outlier = run([
  evidence('a', 300000, 150),
  evidence('b', 300000, 150),
  evidence('c', 900000, 450, acceptedClassification('c'), { materialOutlierReason: 'Verified duplicate deed transfer.' }),
]);
check('flagged outlier stops recommendation', outlier.outcome, 'OUTLIER REVIEW REQUIRED');
check('flagged outlier requires manual review', outlier.manualReviewRequired, true);
check('flagged outlier has no recommendation', outlier.recommendedArv, null);
check('flagged outlier evidence is LOW', outlier.evidenceState, 'LOW');
check('outlier id retained', outlier.flaggedOutliers[0].evidenceId, 'c');
check('outlier reason retained', outlier.flaggedOutliers[0].reason, 'Verified duplicate deed transfer.');
check('outlier reason says no ARV', outlier.reasons[0].includes('No ARV is recommended'), true);

const invalidSubject = run([
  evidence('a', 300000, 150), evidence('b', 300000, 150), evidence('c', 300000, 150),
], { subjectLivingSquareFeet: 0 });
check('invalid subject sqft is insufficient', invalidSubject.outcome, 'INSUFFICIENT EVIDENCE');
check('invalid subject sqft reason explicit', invalidSubject.reasons.some((x) => x.includes('Subject living square footage')), true);

const source = fs.readFileSync(SOURCES[0], 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
check('no numeric score or weighted precision', /score|confidence\s*:\s*number|weight(ed|ing)?/i.test(source), false);
check('no feature dollar adjustment', /adjustedPrice|adjustmentGrid|featureDollar/i.test(source), false);
check('no regression or appraisal claim', /regression|appraisal/i.test(source), false);
check('no MAO or offer calculation', /\bmao\b|openingOffer|sellerOffer/i.test(source), false);
check('no persistence network or Production', /localStorage|sessionStorage|indexedDB|\bfetch\s*\(|XMLHttpRequest|\bPOST\b|\bPUT\b|leadconnector/i.test(source), false);
check('no workspace UI or repair behavior', /React|Workspace|repair-estimation|computeRepair/i.test(source), false);

cleanup();
console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
