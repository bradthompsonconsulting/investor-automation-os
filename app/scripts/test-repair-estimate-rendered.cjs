/**
 * Board 15 / PR #124 review (Jess ruling, 2026-10-04) — RENDERED regression
 * coverage for the itemized repair estimate.
 *
 * Offline. Compiles the real operator model, calculation core and the shared
 * RepairEstimateSummary / MiscRepairRow components, then renders them with
 * react-dom/server (the same pattern as test-seller-call-voice-controls.cjs)
 * from estimates built exactly the way both pages build them. Both the
 * Underwriting estimator and the Deal Calculator's itemized mode render these
 * same components (asserted by source at the end).
 *
 *   1. Itemized, nothing answered (2026-10-07 policy, superseding the
 *      2026-10-04 $66,000): Known $0, the provisional $20,000 starting
 *      estimate, Provisional total $20,000, said to be provisional.
 *   2. Miscellaneous uses the same operator model and is counted once.
 *   3. Possible whole-house electrical / panel overlap is shown beside the
 *      preliminary total, unconfirmed, nothing deducted -- and not shown when
 *      only one of the two carries an amount.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-repair-estimate-rendered-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/repair-estimation/compute.ts'),
    path.join(APP, 'src/lib/repair-estimation/operator-model.ts'),
    path.join(APP, 'src/components/RepairEstimateSummary.tsx'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs', '--target', 'es2020',
    '--strict', '--skipLibCheck', '--jsx', 'react-jsx', '--resolveJsonModule', '--esModuleInterop',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  process.exit(10);
}

const M = require(path.join(TMP, 'src/lib/repair-estimation/operator-model.js'));
const { computeRepairEstimate } = require(path.join(TMP, 'src/lib/repair-estimation/compute.js'));
const C = require(path.join(TMP, 'src/components/RepairEstimateSummary.js'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

const compute = (lines) => computeRepairEstimate({ lines, property: { squareFeet: null, bathroomCount: null } });
const est = (answers, misc) => M.operatorEstimate(answers, compute, misc);
const render = (result) => renderToStaticMarkup(React.createElement(C.RepairEstimateSummary, { result }));
/** Text inside the element carrying data-testid=id (first match). */
function testIdText(html, id) {
  const m = new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(html);
  return m ? m[1] : null;
}
const rowOf = (system) => M.OPERATOR_ROWS.find((r) => r.system === system);
const answer = (system, condition) => M.applyCondition(rowOf(system), condition);

// ── 1. Itemized mode, nothing answered ──────────────────────────────────────
{
  const html = render(est({}));
  check('1 untouched: Known repairs renders $0', testIdText(html, 'repair-known-subtotal'), '$0');
  check('1 untouched: no provisional reserve is rendered', testIdText(html, 'repair-provisional-estimate'), null);
  check('1 untouched: the total renders $0', testIdText(html, 'repair-preliminary-total'), '$0');
  check('1 untouched: the total is labelled incomplete', testIdText(html, 'repair-total-label'), 'Known repairs — estimate incomplete (excludes 7 unknown or unresolved)');
  check('1 untouched: it says estimate incomplete', testIdText(html, 'repair-estimate-status'), 'Known repairs: $0 — estimate incomplete');
  check('1 untouched: the preliminary-policy notice renders', html.includes(C.PRELIMINARY_ALLOWANCE_NOTICE), true);
  check('1 untouched: unanswered rows are visibly unknown', /data-testid="repair-unresolved"/.test(html), true);
}

// ── 2. Miscellaneous, same operator model, counted once ─────────────────────
{
  const allGood = {};
  for (const r of M.OPERATOR_ROWS) allGood[r.system] = answer(r.system, 'good');
  const html = render(est(allGood, { description: 'Gutters', amount: '1,800' }));
  check('2 misc: counted once in Known repairs', testIdText(html, 'repair-known-subtotal'), '$1,800');
  check('2 misc: counted once in the Preliminary total', testIdText(html, 'repair-preliminary-total'), '$1,800');
  const blank = render(est(allGood, M.EMPTY_MISC));
  check('2 misc: blank adds nothing', testIdText(blank, 'repair-preliminary-total'), '$0');
  const rowHtml = renderToStaticMarkup(React.createElement(C.MiscRepairRow, {
    misc: { description: '', amount: '' }, onChange: () => {}, testIdPrefix: 'deal-calc-repair-misc',
  }));
  check('2 misc: the row renders its label, description and amount inputs',
    rowHtml.includes(M.MISC_ROW_LABEL) && /data-testid="deal-calc-repair-misc-description"/.test(rowHtml) && /data-testid="deal-calc-repair-misc-amount"/.test(rowHtml), true);
  const unpriced = render(est(allGood, { description: '', amount: '-5' }));
  check('2 misc: a negative amount is shown unresolved, not counted',
    [testIdText(unpriced, 'repair-preliminary-total'), /data-testid="repair-unresolved-misc"/.test(unpriced)], ['$0', true]);
}

// ── 3. Possible electrical overlap beside the total ─────────────────────────
{
  /* 2026-10-07: untouched carries no per-row amounts, so the overlap needs
     both electrical rows answered with amounts. */
  const untouched = render(est({ electrical_whole_house: answer('electrical_whole_house', 'severe'), electrical_panel: answer('electrical_panel', 'repair') }));
  check('3 overlap: not shown untouched (no per-row amounts)', render(est({})).includes(C.ELECTRICAL_OVERLAP_NOTE), false);
  check('3 overlap: worded as unconfirmed with nothing deducted',
    /Unconfirmed — nothing has been deducted\./.test(C.ELECTRICAL_OVERLAP_NOTE) && /may cover/.test(C.ELECTRICAL_OVERLAP_NOTE), true);
  check('3 overlap: the total is NOT reduced for it', testIdText(untouched, 'repair-preliminary-total'), '$14,000');
  const both = render(est({ electrical_whole_house: answer('electrical_whole_house', 'severe'), electrical_panel: answer('electrical_panel', 'repair') }));
  check('3 overlap: shown when both electrical rows are answered with amounts', both.includes(C.ELECTRICAL_OVERLAP_NOTE), true);
  const panelGood = render(est({ electrical_panel: answer('electrical_panel', 'good') }));
  check('3 overlap: not shown when the panel is answered Good ($0)', panelGood.includes(C.ELECTRICAL_OVERLAP_NOTE), false);
  {
    const i = untouched.indexOf('data-testid="repair-preliminary-total"');
    const j = untouched.indexOf('data-testid="repair-electrical-overlap"');
    const k = untouched.indexOf('data-testid="repair-preliminary-notice"');
    check('3 overlap: rendered directly after the preliminary total', i !== -1 && j > i && k > j, true);
  }
}

// ── Both pages render these shared components (source text) ─────────────────
{
  const uw = fs.readFileSync(path.join(APP, 'src/pages/UnderwritingWorkspace.tsx'), 'utf8');
  const dc = fs.readFileSync(path.join(APP, 'src/pages/DealCalculator.tsx'), 'utf8');
  check('pages: Underwriting renders RepairEstimateSummary and MiscRepairRow',
    /<RepairEstimateSummary result=\{result\} \/>/.test(uw) && /<MiscRepairRow misc=\{misc\} onChange=\{commitMisc\} \/>/.test(uw), true);
  check('pages: the Deal Calculator renders the same two components in itemized mode',
    /<RepairEstimateSummary result=\{detailedEstimate\} \/>/.test(dc) && /<MiscRepairRow\s+misc=\{repairMisc\}/.test(dc), true);
  check('pages: the Deal Calculator passes Miscellaneous into the same operatorEstimate',
    /operatorEstimate\(repairAnswers, \(lines\) => computeRepairEstimate\(\{[^)]*\}\), repairMisc\)/.test(dc), true);
  check('pages: itemized mode uses the estimate at once (no untouched-null rule)',
    /: detailedEstimate\.total;/.test(dc) && !/isUntouched\(repairAnswers\) \? null/.test(dc), true);
  check('pages: quick entry is still the default', /useState<"quick" \| "detailed">\("quick"\)/.test(dc), true);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nRepair estimate rendered checks: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
