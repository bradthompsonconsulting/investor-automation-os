/**
 * B7-09 / INV-26 — ARV valuation evidence snapshots and versions.
 *
 * Compiles the snapshot model together with the REAL B7-04/B7-05/B7-06
 * modules, runs two sequential valuation cycles from two deterministic CSV
 * fixtures, and asserts INV-26's acceptance directly: two runs can be
 * inspected independently, and the earlier run's evidence survives the later
 * one intact.
 *
 * No GHL, no network, no Production, no fixture record, no clock. Every time
 * value is supplied by this file, so the whole run is a pure function of the
 * repository and can be asserted for byte equality rather than approximated.
 *
 * app/package.json sets "type": "module", so the temp directory is given its
 * own package.json declaring commonjs.
 *
 * ⚠ RUN IT DIRECTLY: `node app/scripts/test-arv-snapshot.cjs`. No
 * app/package.json script is added, deliberately -- B7-08 Tranche 2 is in
 * flight against that file and a convenience entry is not worth a collision.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-arv-snapshot-test');
const LIB = path.join(APP, 'src', 'lib');
const MODEL = path.join(LIB, 'arv-evidence-snapshot.ts');
const FIXTURE_1 = path.join(APP, 'scripts', 'fixtures', 'propstream-comparable-export.csv');
const FIXTURE_2 = path.join(APP, 'scripts', 'fixtures', 'propstream-comparable-export-refresh.csv');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

const sources = [
  MODEL,
  path.join(LIB, 'arv-workspace-model.ts'),
  path.join(LIB, 'arv-reconciliation.ts'),
  path.join(LIB, 'comp-classification.ts'),
  path.join(LIB, 'propstream-comp-csv.ts'),
];
try {
  execSync(`npx tsc ${sources.map((x) => `"${x}"`).join(' ')} --outDir "${TMP}" --module commonjs --target es2022 --strict`,
    { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const S = require(path.join(TMP, 'arv-evidence-snapshot.js'));
const { runArvWorkspace } = require(path.join(TMP, 'arv-workspace-model.js'));

/**
 * Derived from the finished file, never back-filled from a passing run.
 *
 * 149  check()/throws() call sites, counted from the finished file. None is
 *       inside a loop: every assertion in this harness is written out.
 * = 149
 */
const FLOOR = 149;
let checks = 0;
let failures = 0;

function check(name, actual, expected) {
  checks++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log('PASS  ' + name);
  } else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}
function throws(name, fn, fragment) {
  checks++;
  try {
    fn();
    failures++;
    console.error('FAIL  ' + name + ' — did not throw');
  } catch (e) {
    if (String(e.message).indexOf(fragment) !== -1) console.log('PASS  ' + name);
    else {
      failures++;
      console.error('FAIL  ' + name + ' — wrong message: ' + e.message);
    }
  }
}

// ── deterministic inputs ────────────────────────────────────────────────────
const csv1 = fs.readFileSync(FIXTURE_1, 'utf8');
const csv2 = fs.readFileSync(FIXTURE_2, 'utf8');

const subject1 = {
  asOfDate: '2026-09-02', propertyType: 'Single Family Residential', squareFeet: 2300,
  subdivision: 'SUNSET RIDGE PHASE I (CMC)', beds: 4, baths: 2, yearBuilt: 1990,
};
/* Run 2 re-states the subject after the operator corrected square footage. The
   subject is snapshotted per run precisely so a correction cannot retroactively
   rewrite what the earlier valuation was computed against. */
const subject2 = { ...subject1, asOfDate: '2026-10-15', squareFeet: 2350 };

const assess = (ids) => ids.map((evidenceId) => ({
  evidenceId,
  marketRelationship: 'LOCAL_COMPETITIVE_MARKET',
  marketReason: 'Investor confirmed same buyer pool.',
  transactionReliability: 'CREDIBLE',
  transactionReason: 'Investor confirmed arm-length sale.',
}));
const ids1 = ['row-2', 'row-3', 'row-4', 'row-5', 'row-6', 'row-7', 'row-8'];
const ids2 = ['row-2', 'row-3', 'row-4', 'row-5', 'row-6', 'row-7', 'row-8'];

const meta1 = { fileName: 'Comparable Export.csv', importedAt: '2026-09-04T12:00:00.000Z' };
const meta2 = { fileName: 'Comparable Export (refresh).csv', importedAt: '2026-10-15T09:30:00.000Z' };

const run1 = runArvWorkspace({ csv: csv1, metadata: meta1, subject: subject1, assessments: assess(ids1), level: 'STANDARD' });
const run2 = runArvWorkspace({ csv: csv2, metadata: meta2, subject: subject2, assessments: assess(ids2), level: 'EXPANDED' });

const artifact1 = [{
  kind: 'COMPLETE_ANALYSIS_PDF', fileName: 'Complete Analysis 2026-09-04.pdf',
  byteLength: 184320, fingerprint: null,
  note: 'Retained for audit. Not parsed; no field extracted from it.',
}];

// ── 1. First cycle creates version 1. ───────────────────────────────────────
let ledger = S.createLedger('contact:FIXTURE-SUBJECT');
check('a new ledger carries the schema tag', ledger.schema, 'iaos-valuation-ledger-v1');
check('a new ledger has no snapshots', ledger.snapshots.length, 0);
check('a new ledger has no decisions', ledger.decisions.length, 0);
throws('a ledger refuses an empty subject key', () => S.createLedger('  '), 'subject key');

const afterV1 = S.appendValuation(ledger, {
  run: run1, subject: subject1, assessments: assess(ids1),
  capturedAt: '2026-09-04T12:05:00.000Z', sourceArtifacts: artifact1,
});
check('the first cycle creates version 1', afterV1.snapshots.length, 1);
check('version numbering is 1-based', afterV1.snapshots[0].version, 1);
check('append returns a new ledger, leaving the original empty', ledger.snapshots.length, 0);
check('the snapshot carries the importer contract version', afterV1.snapshots[0].source.version, 'propstream-comparable-csv-v1');
throws('a snapshot refuses to invent its own capture time', () =>
  S.appendValuation(ledger, { run: run1, subject: subject1, assessments: [], capturedAt: '' }), 'capturedAt is required');

// ── 2. Second cycle creates version 2. ──────────────────────────────────────
const afterV2 = S.appendValuation(afterV1, {
  run: run2, subject: subject2, assessments: assess(ids2),
  capturedAt: '2026-10-15T09:35:00.000Z',
});
check('the refresh creates a second version', afterV2.snapshots.length, 2);
check('the second version is numbered 2', afterV2.snapshots[1].version, 2);
check('versions are distinct records', afterV2.snapshots[0].version !== afterV2.snapshots[1].version, true);
check('the ledger before the refresh still holds exactly one version', afterV1.snapshots.length, 1);

// ── 3. Version 1 remains byte- and logically recoverable after version 2. ───
const v1Before = JSON.parse(JSON.stringify(afterV1.snapshots[0]));
const v1After = S.snapshotAt(afterV2, 1);
check('version 1 is still retrievable by version number', v1After.version, 1);
check('version 1 is LOGICALLY unchanged after version 2 exists', v1After, v1Before);
check('version 1 is BYTE-identical after version 2 exists',
  S.stableStringify(v1After), S.stableStringify(v1Before));
check('version 1 keeps its fingerprint', v1After.fingerprint, v1Before.fingerprint);
check('the two versions fingerprint differently', afterV2.snapshots[0].fingerprint !== afterV2.snapshots[1].fingerprint, true);
check('every snapshot verifies against its own fingerprint', S.verifyLedger(afterV2), []);

/* Structural immutability, not a promise. A frozen record cannot be edited by
   a careless caller, which is the guarantee INV-26 actually needs. */
check('a snapshot is frozen', Object.isFrozen(v1After), true);
check('its comps array is frozen', Object.isFrozen(v1After.comps), true);
check('a nested comp is frozen', Object.isFrozen(v1After.comps[0]), true);
check('its reconciliation is frozen', Object.isFrozen(v1After.reconciliation), true);
check('the ledger itself is frozen', Object.isFrozen(afterV2), true);
check('the snapshots array is frozen', Object.isFrozen(afterV2.snapshots), true);

const recommendedBefore = v1After.reconciliation.recommendedArv;
try { v1After.reconciliation.recommendedArv = 1; } catch (_) { /* strict mode throws; either way the value must hold */ }
check('a write to historical evidence does not take', S.snapshotAt(afterV2, 1).reconciliation.recommendedArv, recommendedBefore);
try { afterV2.snapshots.push({}); } catch (_) { /* as above */ }
check('history cannot be appended to in place', S.snapshotAt(afterV2, 1).version, 1);
check('the version count is unchanged by the attempt', afterV2.snapshots.length, 2);

// ── 4. Source/import metadata stays with the right version. ─────────────────
check('version 1 keeps its own source file name', S.snapshotAt(afterV2, 1).source.fileName, 'Comparable Export.csv');
check('version 2 keeps its own source file name', S.snapshotAt(afterV2, 2).source.fileName, 'Comparable Export (refresh).csv');
check('version 1 keeps its own import instant', S.snapshotAt(afterV2, 1).source.importedAt, '2026-09-04T12:00:00.000Z');
check('version 2 keeps its own import instant', S.snapshotAt(afterV2, 2).source.importedAt, '2026-10-15T09:30:00.000Z');
check('version 1 keeps its own capture instant', S.snapshotAt(afterV2, 1).capturedAt, '2026-09-04T12:05:00.000Z');
check('version 2 keeps its own capture instant', S.snapshotAt(afterV2, 2).capturedAt, '2026-10-15T09:35:00.000Z');
check('the two source metadata blocks are not shared', S.snapshotAt(afterV2, 1).source.fileName !== S.snapshotAt(afterV2, 2).source.fileName, true);

/* Retained source artifacts: kept for audit, never parsed. */
check('version 1 retains its source artifact', S.snapshotAt(afterV2, 1).sourceArtifacts.length, 1);
check('the retained artifact names its kind', S.snapshotAt(afterV2, 1).sourceArtifacts[0].kind, 'COMPLETE_ANALYSIS_PDF');
check('the retained artifact is a reference, not extracted fields',
  Object.keys(S.snapshotAt(afterV2, 1).sourceArtifacts[0]).sort(),
  ['byteLength', 'fileName', 'fingerprint', 'kind', 'note']);
check('a version with no artifact carries an empty list, never undefined', S.snapshotAt(afterV2, 2).sourceArtifacts, []);

// ── 5. Subject facts stay with the right version. ──────────────────────────
check('version 1 keeps the subject square footage it was computed against', S.snapshotAt(afterV2, 1).subject.squareFeet, 2300);
check('version 2 keeps the corrected square footage', S.snapshotAt(afterV2, 2).subject.squareFeet, 2350);
check('a later subject correction does not rewrite version 1', S.snapshotAt(afterV2, 1).subject.squareFeet !== S.snapshotAt(afterV2, 2).subject.squareFeet, true);
check('version 1 keeps its own as-of date', S.snapshotAt(afterV2, 1).subject.asOfDate, '2026-09-02');
check('version 2 keeps its own as-of date', S.snapshotAt(afterV2, 2).subject.asOfDate, '2026-10-15');
check('version 1 keeps the subdivision fact', S.snapshotAt(afterV2, 1).subject.subdivision, 'SUNSET RIDGE PHASE I (CMC)');

// ── 6. Comp dispositions stay with the right version. ──────────────────────
const v1 = S.snapshotAt(afterV2, 1);
const v2 = S.snapshotAt(afterV2, 2);
const tally = (s) => {
  const t = { ACCEPTED: 0, SUPPORTING: 0, REJECTED: 0 };
  for (const c of s.search.classifications) t[c.disposition]++;
  return t;
};
check('version 1 preserved every comp it considered', v1.comps.length, run1.imported.evidence.length);
check('version 2 preserved every comp it considered', v2.comps.length, run2.imported.evidence.length);
check('version 1 holds one classification per comp', v1.search.classifications.length, v1.comps.length);
check('version 2 holds one classification per comp', v2.search.classifications.length, v2.comps.length);
check('version 1 dispositions match its own run', tally(v1), tally({ search: run1.search }));
check('version 2 dispositions match its own run', tally(v2), tally({ search: run2.search }));
check('version 1 accepted count is its own', v1.search.acceptedCount, run1.search.acceptedCount);
check('version 2 accepted count is its own', v2.search.acceptedCount, run2.search.acceptedCount);
check('version 1 keeps the operator assessments that produced its dispositions', v1.assessments.length, ids1.length);
check('version 2 keeps its own operator assessments', v2.assessments.length, ids2.length);
check('version 1 keeps its import issues', Array.isArray(v1.importIssues), true);
check('version 1 keeps its duplicate-property grouping', v1.propertyGroups, run1.imported.propertyGroups);
check('version 1 keeps the exact headers it imported', v1.source.headers, run1.imported.source.headers);
check('version 2 keeps its own row count', v2.source.rowCount, run2.imported.source.rowCount);
check('a comp disposition carries the reasons behind it', v1.search.classifications[0].reasons.length > 0, true);

// ── 7. Search level stays with the right version. ──────────────────────────
check('version 1 records the STANDARD search it ran', v1.search.level, 'STANDARD');
check('version 2 records the EXPANDED search it ran', v2.search.level, 'EXPANDED');
check('the levels are not shared between versions', v1.search.level !== v2.search.level, true);
check('version 1 keeps its own search outcome', v1.search.outcome, run1.search.outcome);
check('version 2 keeps its own search outcome', v2.search.outcome, run2.search.outcome);

// ── 8. Median sale and median PPSF stay with the right version. ────────────
check('version 1 keeps its median sold indication', v1.reconciliation.primaryMedianSoldPrice, run1.reconciliation.primaryMedianSoldPrice);
check('version 2 keeps its median sold indication', v2.reconciliation.primaryMedianSoldPrice, run2.reconciliation.primaryMedianSoldPrice);
check('version 1 keeps its median accepted PPSF', v1.reconciliation.medianAcceptedPricePerSquareFoot, run1.reconciliation.medianAcceptedPricePerSquareFoot);
check('version 2 keeps its median accepted PPSF', v2.reconciliation.medianAcceptedPricePerSquareFoot, run2.reconciliation.medianAcceptedPricePerSquareFoot);
check('version 1 keeps its PPSF cross-check', v1.reconciliation.pricePerSquareFootCrossCheck, run1.reconciliation.pricePerSquareFootCrossCheck);
check('version 1 keeps its supported sale range', v1.reconciliation.supportedSaleRange, run1.reconciliation.supportedSaleRange);

// ── 9. Recommended ARV stays with the right version. ───────────────────────
check('version 1 keeps its recommended ARV', v1.reconciliation.recommendedArv, run1.reconciliation.recommendedArv);
check('version 2 keeps its recommended ARV', v2.reconciliation.recommendedArv, run2.reconciliation.recommendedArv);
check('version 1 keeps its accepted evidence ids', v1.reconciliation.acceptedEvidenceIds, run1.reconciliation.acceptedEvidenceIds);
check('version 1 keeps the reasons behind its result', v1.reconciliation.reasons, run1.reconciliation.reasons);

// ── 10. Evidence state stays with the right version. ───────────────────────
check('version 1 keeps its evidence state', v1.reconciliation.evidenceState, run1.reconciliation.evidenceState);
check('version 2 keeps its evidence state', v2.reconciliation.evidenceState, run2.reconciliation.evidenceState);
check('version 1 keeps its outcome', v1.reconciliation.outcome, run1.reconciliation.outcome);
check('version 2 keeps its outcome', v2.reconciliation.outcome, run2.reconciliation.outcome);
check('version 1 keeps its manual-review flag', v1.reconciliation.manualReviewRequired, run1.reconciliation.manualReviewRequired);

// ── 11-12. Approval, override, approver and time stay with the right version.
let decided = S.recordDecision(afterV2, {
  version: 1, kind: 'APPROVED', amount: 640000,
  decidedBy: 'Brad Thompson', decidedAt: '2026-09-04T12:10:00.000Z',
});
check('a decision is recorded against version 1', S.decisionsFor(decided, 1).length, 1);
check('version 2 has no decision of its own yet', S.decisionsFor(decided, 2).length, 0);
check('the decision names the approved amount', S.effectiveDecision(decided, 1).amount, 640000);
check('the decision names who made it', S.effectiveDecision(decided, 1).decidedBy, 'Brad Thompson');
check('the decision carries when it was made', S.effectiveDecision(decided, 1).decidedAt, '2026-09-04T12:10:00.000Z');
check('an approval is not an override', S.effectiveDecision(decided, 1).kind, 'APPROVED');
check('an approval carries no override reason', S.effectiveDecision(decided, 1).overrideReason, null);
check('the decision records what IAOS recommended at the time',
  S.effectiveDecision(decided, 1).recommendedAtDecision, v1.reconciliation.recommendedArv);
check('recording a decision does not touch the snapshot', S.stableStringify(S.snapshotAt(decided, 1)), S.stableStringify(v1Before));

decided = S.recordDecision(decided, {
  version: 2, kind: 'OVERRIDDEN', amount: 655000, overrideReason: 'Two accepted comps sold before the roof was replaced.',
  decidedBy: 'Brad Thompson', decidedAt: '2026-10-15T09:40:00.000Z',
});
check('version 2 carries its own decision', S.decisionsFor(decided, 2).length, 1);
check('version 1 still carries exactly its own', S.decisionsFor(decided, 1).length, 1);
check('the override amount belongs to version 2', S.effectiveDecision(decided, 2).amount, 655000);
check('version 1 approval is untouched by the version 2 override', S.effectiveDecision(decided, 1).amount, 640000);
check('the override states its reason', S.effectiveDecision(decided, 2).overrideReason, 'Two accepted comps sold before the roof was replaced.');
check('the override records the recommendation it departed from',
  S.effectiveDecision(decided, 2).recommendedAtDecision, v2.reconciliation.recommendedArv);
check('decisions are globally ordered', S.decisionHistory(decided).map((d) => d.sequence), [1, 2]);

/* Re-deciding appends and never edits — INV-25 decision 4 applied to the
   evidence side: the current figure may be replaced, the history may not. */
decided = S.recordDecision(decided, {
  version: 1, kind: 'OVERRIDDEN', amount: 648500, overrideReason: 'Corrected after the appraisal came in.',
  decidedBy: 'Brad Thompson', decidedAt: '2026-11-02T14:00:00.000Z',
});
check('re-deciding version 1 appends rather than editing', S.decisionsFor(decided, 1).length, 2);
check('the original approval is still readable', S.decisionsFor(decided, 1)[0].amount, 640000);
check('the original approval keeps its own time', S.decisionsFor(decided, 1)[0].decidedAt, '2026-09-04T12:10:00.000Z');
check('the later override is what now stands', S.effectiveDecision(decided, 1).amount, 648500);
check('the effective decision is the last recorded', S.effectiveDecision(decided, 1).sequence, 3);
check('the version 2 decision is unaffected', S.effectiveDecision(decided, 2).amount, 655000);

throws('a decision refuses a version that does not exist',
  () => S.recordDecision(decided, { version: 9, kind: 'APPROVED', amount: 1, decidedBy: 'x', decidedAt: 'y' }), 'no valuation version 9');
throws('an override refuses to omit its reason',
  () => S.recordDecision(decided, { version: 1, kind: 'OVERRIDDEN', amount: 1, decidedBy: 'x', decidedAt: 'y' }), 'must state its reason');
throws('a decision refuses a non-positive amount',
  () => S.recordDecision(decided, { version: 1, kind: 'APPROVED', amount: 0, decidedBy: 'x', decidedAt: 'y' }), 'positive finite amount');
throws('a decision refuses to omit who made it',
  () => S.recordDecision(decided, { version: 1, kind: 'APPROVED', amount: 1, decidedBy: '  ', decidedAt: 'y' }), 'name who made it');

// ── 13. Refresh does not overwrite prior evidence — the acceptance test. ────
const v1AtApproval = S.stableStringify(S.snapshotAt(decided, 1));
const refreshed = S.appendValuation(decided, {
  run: run2, subject: subject2, assessments: assess(ids2), capturedAt: '2026-11-20T08:00:00.000Z',
});
check('a third refresh creates version 3', refreshed.snapshots.length, 3);
check('version 1 evidence is byte-identical after the refresh', S.stableStringify(S.snapshotAt(refreshed, 1)), v1AtApproval);
check('version 1 approval history survives the refresh', S.decisionsFor(refreshed, 1).length, 2);
check('the original approved amount is still recoverable', S.decisionsFor(refreshed, 1)[0].amount, 640000);
check('version 2 evidence survives the refresh too', S.stableStringify(S.snapshotAt(refreshed, 2)), S.stableStringify(S.snapshotAt(decided, 2)));
check('every fingerprint still verifies after the refresh', S.verifyLedger(refreshed), []);
check('the ledger held before the refresh is itself unchanged', decided.snapshots.length, 2);

/* Round-trip: the evidence survives leaving the process entirely. */
const wire = S.serializeLedger(refreshed);
const restored = S.deserializeLedger(wire);
check('a serialized ledger round-trips byte-exactly', S.serializeLedger(restored), wire);
check('version 1 survives serialization', S.stableStringify(S.snapshotAt(restored, 1)), v1AtApproval);
check('decisions survive serialization', S.decisionHistory(restored).length, 3);
check('a restored ledger still verifies', S.verifyLedger(restored), []);
check('a restored ledger is frozen', Object.isFrozen(restored), true);
throws('a foreign payload is refused, not half-loaded',
  () => S.deserializeLedger('{"schema":"something-else","subjectKey":"x","snapshots":[],"decisions":[]}'), 'unknown ledger schema');
throws('malformed text is refused', () => S.deserializeLedger('not json'), 'not valid JSON');

/* A tampered snapshot is visible rather than silent. */
const tampered = JSON.parse(wire);
tampered.snapshots[0].reconciliation.recommendedArv = 999999;
check('an edited snapshot fails its fingerprint', S.verifyLedger(S.deserializeLedger(JSON.stringify(tampered))), [1]);

/* Explanation: why this version produced this result. */
const why = S.explainVersion(refreshed, 1);
check('an explanation names the version', why[0].indexOf('Version 1') === 0, true);
check('an explanation names the source file', why.some((l) => l.indexOf('Comparable Export.csv') !== -1), true);
check('an explanation names the search level', why.some((l) => l.indexOf('Search level: STANDARD') !== -1), true);
check('an explanation names the dispositions', why.some((l) => l.indexOf('accepted,') !== -1), true);
check('an explanation names the recommendation', why.some((l) => l.indexOf('Recommended ARV:') !== -1), true);
check('an explanation names the retained artifact', why.some((l) => l.indexOf('Retained artifact:') !== -1), true);
check('an explanation reports both decisions', why.filter((l) => l.indexOf('by Brad Thompson') !== -1).length, 2);
check('an explanation says which one stands', why.some((l) => l.indexOf('Effective now:') !== -1), true);
check('an unknown version explains itself rather than throwing', S.explainVersion(refreshed, 42), ['No valuation version 42 exists.']);

// ── 14. No GHL carrier explosion, and no B7-08 duplication. ────────────────
{
  const src = fs.readFileSync(MODEL, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('the model imports no GHL client', /from\s+["'][^"']*ghl["']/.test(codeOnly), false);
  check('the model names no custom-field id', /["'][A-Za-z0-9]{20}["']/.test(codeOnly), false);
  check('the model opens no network client', /fetch\(|XMLHttpRequest|axios/.test(codeOnly), false);
  check('the model touches no browser storage', /localStorage|sessionStorage|indexedDB/.test(codeOnly), false);
  check('the model reads no clock', /Date\.now|new Date\(/.test(codeOnly), false);
  check('the model implements no approved-ARV writer', /setApprovedArv|setARV|saveUnderwritingFields/.test(codeOnly), false);
  check('the model implements no GHL note ledger', /notes\.create|noteBody/.test(codeOnly), false);
  check('the model carries no offer or MAO economics', /offer_|\bmao\b/i.test(codeOnly), false);
  check('the model creates no per-comp carrier', /customField|fieldKey|field_value/.test(codeOnly), false);
  check('the model stores no PropStream credential', /password|username|apiKey|credential/i.test(codeOnly), false);
  check('the model parses no PDF', /pdf/i.test(codeOnly.replace(/COMPLETE_ANALYSIS_PDF/g, '')), false);
}

// ── 15. Existing reconciliation behaviour is unchanged. ────────────────────
{
  /* The snapshot must be a faithful carrier, never a second engine: what the
     ledger reports for a run is exactly what B7-06 produced for it. */
  check('the snapshot reports the reconciliation verbatim',
    S.stableStringify(S.snapshotAt(refreshed, 1).reconciliation), S.stableStringify(run1.reconciliation));
  check('the snapshot reports the search result verbatim',
    S.stableStringify(S.snapshotAt(refreshed, 1).search), S.stableStringify(run1.search));
  check('the snapshot reports the comps verbatim',
    S.stableStringify(S.snapshotAt(refreshed, 1).comps), S.stableStringify(run1.imported.evidence));
  /* Re-running the same inputs after all this snapshotting produces the same
     answer: nothing in this module perturbed the engines it wraps. */
  const rerun = runArvWorkspace({ csv: csv1, metadata: meta1, subject: subject1, assessments: assess(ids1), level: 'STANDARD' });
  check('re-running run 1 reproduces its reconciliation exactly',
    S.stableStringify(rerun.reconciliation), S.stableStringify(run1.reconciliation));
  check('re-running run 1 reproduces its classifications exactly',
    S.stableStringify(rerun.search), S.stableStringify(run1.search));

  const modelSrc = fs.readFileSync(MODEL, 'utf8');
  check('the model defines no median of its own', /function median|const median\s*=/.test(modelSrc), false);
  check('the model sorts nothing into a middle element', /\.sort\([^)]*\)\s*\[/.test(modelSrc), false);
  check('the model derives no ARV of its own', /recommendedArv\s*=/.test(modelSrc), false);
}

cleanup();

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
