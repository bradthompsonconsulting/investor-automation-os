/**
 * B15-01 (INV-100) + B15-02 UI slice (INV-102) -- the 2026-10-07 repair
 * policy, with Brad's Option A ruling (2026-10-19).
 *
 * Offline. Compiles the real operator model, repair calculation core, shared
 * RepairEstimateSummary / MiscRepairRow components and the underwriting
 * engine, renders the summary with react-dom/server, and checks page wiring
 * by source text (this repository's convention; no browser harness).
 *
 * Covers: untouched (provisional $20,000), Good / $0 / Misc $0 ending it,
 * what does NOT end it, positive amounts and the Repair auto-select,
 * partially answered and fully answered states, "Known repairs: $X —
 * estimate incomplete" ($0 included), quick -> itemized transfer without
 * double counting, repair-only Clear (description kept, amount reset, no
 * restore), field order, and the downstream repair total through
 * computeUnderwriting plus the unchanged approval/save path.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-b15-01-repair-policy-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/repair-estimation/compute.ts'),
    path.join(APP, 'src/lib/repair-estimation/operator-model.ts'),
    path.join(APP, 'src/components/RepairEstimateSummary.tsx'),
    path.join(APP, 'src/lib/underwriting/compute.ts'),
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
const { computeUnderwriting } = require(path.join(TMP, 'src/lib/underwriting/compute.js'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
fs.rmSync(TMP, { recursive: true, force: true });

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`); }
}
const compute = (lines) => computeRepairEstimate({ lines, property: { squareFeet: null, bathroomCount: null } });
const est = (answers, misc) => M.operatorEstimate(answers, compute, misc);
const render = (r) => renderToStaticMarkup(React.createElement(C.RepairEstimateSummary, { result: r }));
function testIdText(html, id) {
  const m = new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(html);
  return m ? m[1] : null;
}
const rowOf = (s) => M.OPERATOR_ROWS.find((r) => r.system === s);
const cond = (s, c) => M.applyCondition(rowOf(s), c);
const typed = (raw, prev = M.EMPTY_ANSWER) => M.applyAmount(prev, raw);
const shape = (e) => [e.provisional, e.incomplete, e.knownSubtotal, e.total];
const OTHER_ROWS = M.OPERATOR_ROWS.length - 1;

// ── 1. Untouched ─────────────────────────────────────────────────────────────
{
  const e = est({});
  check('1 untouched: provisional $20,000, not incomplete, known $0', shape(e), [true, false, 0, 20000]);
  check('1 untouched: the figure comes from the approved table', M.PROVISIONAL_STARTING_ESTIMATE, 20000);
  const html = render(e);
  check('1 untouched: labelled provisional', testIdText(html, 'repair-total-label'), 'Provisional total');
  check('1 untouched: says it is provisional', testIdText(html, 'repair-estimate-status'), C.PROVISIONAL_NOTICE);
  check('1 untouched: never shown as known', testIdText(html, 'repair-known-subtotal'), '$0');
}

// ── 2. The first explicit answer ends it (Option A) ──────────────────────────
{
  const good = est({ roof: cond('roof', 'good') });
  check('2 Good alone: no provisional, total $0, incomplete', shape(good), [false, true, 0, 0]);
  check('2 Good alone: "Known repairs: $0 — estimate incomplete"', testIdText(render(good), 'repair-estimate-status'), 'Known repairs: $0 — estimate incomplete');
  const zeroTyped = typed('0');
  check('2 $0 typed on an unanswered row keeps Not asked', zeroTyped.condition, 'not_asked');
  check('2 $0 typed: ends the provisional figure, total $0', shape(est({ hvac: zeroTyped })), [false, true, 0, 0]);
  check('2 Misc $0 alone ends it too', shape(est({}, { description: '', amount: '0' })), [false, true, 0, 0]);
  check('2 a positive amount is not required', M.hasExplicitAnswer({ roof: cond('roof', 'good') }), true);
}

// ── 3. What does NOT end it ──────────────────────────────────────────────────
{
  check('3 Misc description alone stays provisional', shape(est({}, { description: 'Gutters\nFence', amount: '' })), [true, false, 0, 20000]);
  check('3 a bare count stays provisional', est({ windows: M.applyQuantity(rowOf('windows'), M.EMPTY_ANSWER, '4') }).total, 20000);
  const bad = est({ roof: typed('abc') });
  check('3 an unreadable amount stays provisional', [bad.provisional, bad.total], [true, 20000]);
  check('3 ...and is still shown unresolved', bad.estimate.unpricedRisks.map((r) => r.id), ['roof']);
  /* Typing $500 selected Repair (an explicit answer); erasing the amount
     leaves Repair with a cleared amount: answered, unresolved, $0 counted. */
  const erased = est({ roof: typed('', typed('500')) });
  check('3 typed-then-erased: Repair stays, amount shown cleared, not provisional',
    [erased.provisional, erased.total, (erased.estimate.unpricedRisks.find((r) => r.id === 'roof')?.reason ?? '').includes('cleared')], [false, 0, true]);
  check('3 explicit empty answers are untouched', est({ roof: { condition: 'not_asked', amount: '', quantity: '', dirty: false } }).total, 20000);
}

// ── 4. Positive amounts ──────────────────────────────────────────────────────
{
  const a = typed('7,250');
  check('4 a positive amount on an unanswered row selects Repair', a.condition, 'repair');
  check('4 ...and is the total', shape(est({ foundation: a })), [false, true, 7250, 7250]);
  check('4 an explicit condition is preserved', typed('9000', cond('roof', 'severe')).condition, 'severe');
  check('4 Good stays Good when edited', typed('400', cond('roof', 'good')).condition, 'good');
  const two = est({ roof: typed('6000'), hvac: cond('hvac', 'repair') });
  check('4 multiple known amounts are summed', two.total, 6000 + rowOf('hvac').repairDefault);
}

// ── 5. Partially and fully answered ──────────────────────────────────────────
{
  const p = est({ roof: cond('roof', 'severe'), hvac: cond('hvac', 'good') });
  check('5 partial: known only, incomplete', shape(p), [false, true, 15000, 15000]);
  check('5 partial: the rest are unknown, never Good',
    p.estimate.unpricedRisks.map((r) => r.id), ['electrical_whole_house', 'electrical_panel', 'plumbing_sewer', 'foundation', 'windows']);
  check('5 partial: status names the known amount', testIdText(render(p), 'repair-estimate-status'), 'Known repairs: $15,000 — estimate incomplete');
  check('5 partial: unanswered rows add nothing', p.unansweredSubtotal, 0);
  const all = {};
  for (const r of M.OPERATOR_ROWS) all[r.system] = cond(r.system, 'good');
  all.roof = cond('roof', 'repair');
  const f = est(all);
  check('5 full: complete, "Repair total"', [shape(f), testIdText(render(f), 'repair-total-label')], [[false, false, 2500, 2500], 'Repair total']);
  check('5 full: no incomplete status', /Known repairs: .* — estimate incomplete/.test(render(f)), false);
}

// ── 6. Quick -> itemized transfer, no double counting ────────────────────────
{
  const moved = M.transferQuickTotal(35000, {}, { description: 'Kitchen', amount: '' });
  check('6 transfer: quick total moves to Misc, description kept', moved, { description: 'Kitchen', amount: '35000' });
  const e = est({}, moved);
  check('6 transfer: total preserved, provisional not added', [e.total, e.provisional], [35000, false]);
  check('6 transfer: incomplete (rows still unknown)', e.incomplete, true);
  check('6 transfer: nothing moves beside existing answers', M.transferQuickTotal(35000, { roof: cond('roof', 'good') }, M.EMPTY_MISC), null);
  check('6 transfer: nothing moves onto an existing Misc amount', M.transferQuickTotal(40000, {}, moved), null);
  check('6 transfer: nothing moves without a quick figure', M.transferQuickTotal(null, {}, M.EMPTY_MISC), null);
  const round = M.transferQuickTotal(35000, {}, moved) ?? moved;
  check('6 round trip: quick -> itemized -> quick -> itemized keeps $35,000', est({}, round).total, 35000);
  check('6 transfer of $0 quick total is an explicit $0', shape(est({}, M.transferQuickTotal(0, {}, M.EMPTY_MISC))), [false, true, 0, 0]);
}

// ── 7. Repair-only Clear ─────────────────────────────────────────────────────
{
  const before = { answers: { roof: cond('roof', 'severe'), hvac: typed('3000') }, misc: { description: 'Gutters\nand fence', amount: '1800' } };
  check('7 before Clear: known amounts', est(before.answers, before.misc).total, 15000 + 3000 + 1800);
  const after = M.clearRepairAnswers(before.misc);
  check('7 Clear: answers reset', after.answers, {});
  check('7 Clear: Misc description kept, amount reset', after.misc, { description: 'Gutters\nand fence', amount: '' });
  const e = est(after.answers, after.misc);
  check('7 Clear: back to the provisional $20,000', shape(e), [true, false, 0, 20000]);
  check('7 Clear: retained text restores no amount', [M.hasExplicitAnswer(after.answers, after.misc), e.estimate.lines.some((l) => l.id === 'misc')], [false, false]);
  const edited = est({}, { description: '', amount: '' });
  check('7 the retained description can be erased', edited.total, 20000);
}

// ── 8. Multi-line Misc description, field order ──────────────────────────────
{
  const e = est({ roof: cond('roof', 'good') }, { description: 'Gutters\n  and fence', amount: '100' });
  check('8 multi-line description is one line in the label', e.estimate.lines.find((l) => l.id === 'misc').label, 'Miscellaneous / Other repairs — Gutters and fence');
  const row = renderToStaticMarkup(React.createElement(C.MiscRepairRow, { misc: { description: 'a\nb', amount: '5' }, onChange: () => {}, testIdPrefix: 'x' }));
  check('8 the description is a textarea', /<textarea[^>]*data-testid="x-description"/.test(row), true);
  check('8 Misc order: Item -> Amount -> Explanation',
    row.indexOf(M.MISC_ROW_LABEL) < row.indexOf('data-testid="x-amount"') && row.indexOf('data-testid="x-amount"') < row.indexOf('data-testid="x-description"'), true);
  const dc = fs.readFileSync(path.join(APP, 'src/pages/DealCalculator.tsx'), 'utf8');
  const i = dc.indexOf('deal-calc-repair-${row.system}-${c}');
  const q = dc.indexOf('deal-calc-repair-${row.system}-quantity');
  const a = dc.indexOf('deal-calc-repair-${row.system}-amount');
  const x = dc.indexOf('deal-calc-repair-${row.system}-unknown');
  check('8 Deal Calculator row order: Condition -> Quantity -> Amount -> Explanation', i > 0 && i < q && q < a && a < x, true);
  const uw = fs.readFileSync(path.join(APP, 'src/pages/UnderwritingWorkspace.tsx'), 'utf8');
  const ui = uw.indexOf('options.map((o) =>'), uq = uw.indexOf('{quantity.label}'), ua = uw.indexOf('placeholder="Known amount"'), ux = uw.indexOf('repair-unanswered-${row.system}');
  check('8 Underwriting row order: Condition -> Quantity -> Amount -> Explanation', ui > 0 && ui < uq && uq < ua && ua < ux, true);
}

// ── 9. Downstream: the repair total the underwriting engine uses ─────────────
{
  const v = (value) => ({ kind: 'value', value, level: 'investor_policy' });
  const mao = (repairs) => {
    const r = computeUnderwriting({
      arv: { kind: 'value', value: 300000 }, repairs: { kind: 'value', value: repairs },
      sellingCostPct: v(0.1), closingCost: v(2500), monthlyCarry: v(1000), holdMonths: v(4),
      buyerProfitPct: v(0.1), financing: { kind: 'off', level: 'investor_policy' },
      assignment: { kind: 'standard' }, standardMinimum: v(5000), profitSharePct: v(0.25),
    });
    return { mao: r.figures.sellerMAO, line: r.breakdown.find((l) => l.label === 'Repairs').amount };
  };
  const untouched = mao(est({}).total);
  const good = mao(est({ roof: cond('roof', 'good') }).total);
  const partial = mao(est({ roof: cond('roof', 'severe') }).total);
  check('9 downstream: untouched deducts the provisional $20,000', untouched.line, -20000);
  check('9 downstream: Good alone deducts $0', good.line, -0);
  check('9 downstream: partial deducts known only', partial.line, -15000);
  check('9 downstream: MAO moves exactly by the repair total', [good.mao - untouched.mao, good.mao - partial.mao], [20000, 15000]);

  const dc = fs.readFileSync(path.join(APP, 'src/pages/DealCalculator.tsx'), 'utf8');
  check('9 DC: itemized repairs are the estimate total', /: detailedEstimate\.total;/.test(dc), true);
  check('9 DC: repairs reach the underwriting inputs', /buildDealCalculatorInputs\(\{\s*arv, repairs,/.test(dc), true);
  check('9 DC: the toggle transfers through the model', dc.includes('onClick={handleRepairsModeToggle}') && dc.includes('transferQuickTotal(quick, repairAnswers, repairMisc)'), true);
  const clearFn = /function handleRepairClear\(\) \{[\s\S]*?\n  \}/.exec(dc)[0];
  check('9 DC: repair Clear uses the model and keeps ARV / Test Price',
    clearFn.includes('clearRepairAnswers(repairMisc)') && !/setArvInput|setTestPriceInput/.test(clearFn), true);
  check('9 DC: repair Clear is a visible control', dc.includes('data-testid="deal-calc-repairs-clear"'), true);
  const uw = fs.readFileSync(path.join(APP, 'src/pages/UnderwritingWorkspace.tsx'), 'utf8');
  check('9 UW: approval carries the estimate total, same gate',
    /const total = result\.total;/.test(uw) && /persistApprovedRepairTotalToOpportunity\(\s*ghl, opportunityId,\s*persistGate\(current, revision, currentTotal\),/.test(uw)
      && (uw.match(/Approve and save repair total/g) || []).length === 1, true);
  check('9 no new category rows', M.OPERATOR_ROWS.map((r) => r.system), ['roof', 'hvac', 'electrical_whole_house', 'electrical_panel', 'plumbing_sewer', 'foundation', 'windows']);
  check('9 other rows count', OTHER_ROWS, 6);
}

console.log(`B15-01 repair policy: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
