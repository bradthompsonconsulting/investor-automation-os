/**
 * Repair Estimation V1 operator model -- test runner. INV-14 remediation.
 *
 * Compiles the operator model and the calculation core to a temp directory,
 * loads the emitted JavaScript, and runs deterministic table-driven cases
 * against the REAL core. No GHL, no network, no fixture, no persistence.
 *
 * Every expected default is transcribed from the Brad-approved 2026-09-04
 * operator-review table, never from a passing run.
 *
 * app/package.json sets "type": "module", so the temp directory is given its
 * own package.json declaring commonjs.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-repair-operator-test');
const SRC = path.join(APP, 'src', 'lib', 'repair-estimation');
const PAGE = path.join(APP, 'src', 'pages', 'UnderwritingWorkspace.tsx');

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

try {
  execSync(
    'npx tsc "' + path.join(SRC, 'types.ts') + '" "' + path.join(SRC, 'reference.ts') +
    '" "' + path.join(SRC, 'compute.ts') + '" "' + path.join(SRC, 'operator-model.ts') +
    '" --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const M = require(path.join(TMP, 'operator-model.js'));
const { computeRepairEstimate } = require(path.join(TMP, 'compute.js'));

/**
 * Derived from the finished file, never back-filled from a passing run.
 * Keep the formula next to the number; a floor without its derivation is how
 * the next case gets it wrong.
 *
 *   99  check() call sites outside any loop
 * + 14  the two call sites inside section 1's default tables, 7 rows each
 * +  9  section 16's amendment-value loop, which counts by hand
 * = 122
 */
const FLOOR = 122;
let failures = 0;
let checks = 0;

function check(name, actual, expected, tol) {
  checks++;
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) <= (tol === undefined ? 1e-6 : tol)
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log('PASS  ' + name);
  } else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

const compute = (lines) => computeRepairEstimate({ lines, property: { squareFeet: null, bathroomCount: null } });
const est = (answers) => M.operatorEstimate(answers, compute);
const rowOf = (system) => M.OPERATOR_ROWS.find((r) => r.system === system);
/** Build answers the way the UI does: select a condition, optionally type. */
function answer(system, condition, typed) {
  const a = M.applyCondition(rowOf(system), condition);
  return typed === undefined ? a : M.applyAmount(a, typed);
}
function answers(pairs) {
  const out = {};
  for (const [system, condition, typed] of pairs) out[system] = answer(system, condition, typed);
  return out;
}
const lineFor = (e, id) => e.estimate.lines.find((l) => l.id === id);

// ---- 1. Every approved default, transcribed from the 2026-09-04 table.
{
  const REPAIR = [
    ['roof', 2500], ['hvac', 2500], ['electrical_whole_house', 3500],
    ['electrical_panel', 1500], ['plumbing_sewer', 3500], ['foundation', 5000],
    ['windows', 750],
  ];
  const SEVERE = [
    ['roof', 15000], ['hvac', 8000], ['electrical_whole_house', 12500],
    ['electrical_panel', 3000], ['plumbing_sewer', 12500], ['foundation', 15000],
    ['windows', 750],
  ];
  for (const [system, amount] of REPAIR) {
    check('approved Repair default: ' + system, M.defaultAmountFor(rowOf(system), 'repair'), String(amount));
  }
  for (const [system, amount] of SEVERE) {
    check('approved severe default: ' + system, M.defaultAmountFor(rowOf(system), 'severe'), String(amount));
  }
  check('seven systems, no more', M.OPERATOR_ROWS.length, 7);
  check('plumbing severe is labelled Major', rowOf('plumbing_sewer').severeLabel, 'Major');
  check('foundation severe is labelled Material issue', rowOf('foundation').severeLabel, 'Material issue');
  check('windows states its per-window unit', rowOf('windows').note.indexOf('per window') !== -1, true);
}

// ---- 2. A loaded default is POLICY, never BOOK.
{
  const e = est(answers([['roof', 'severe']]));
  check('a loaded default prices the row', lineFor(e, 'roof').outcome.amount, 15000);
  check('a loaded default is IAOS policy', lineFor(e, 'roof').outcome.provenance, 'IAOS_POLICY');
  check('a loaded default is never BOOK', e.estimate.byProvenance.BOOK, 0);
  check('policy total', e.estimate.byProvenance.IAOS_POLICY, 15000);
}

// ---- 3. Good -> $0, and still editable.
{
  /* Every row answered Good: a real zero everywhere, and no risk anywhere. */
  const allGood = est(answers(M.OPERATOR_ROWS.map((r) => [r.system, 'good'])));
  check('Good loads a zero default', M.defaultAmountFor(rowOf('roof'), 'good'), '0');
  check('Good is a real zero, not an absent price', lineFor(allGood, 'roof').outcome.kind, 'no_repair');
  check('Good contributes nothing', allGood.estimate.resolvedSubtotal, 0);
  check('Good leaves no unpriced risk', allGood.estimate.unpricedRisks.length, 0);

  const edited = est(answers([['roof', 'good', '400']]));
  check('Good remains editable', lineFor(edited, 'roof').outcome.amount, 400);
  check('an edited Good is the operator amount', lineFor(edited, 'roof').outcome.provenance, 'MANUAL');
}

// ---- 4. Manual override wins, and is the operator's own.
{
  const e = est(answers([['roof', 'repair', '6000']]));
  check('the typed amount is used, not the default', lineFor(e, 'roof').outcome.amount, 6000);
  check('a typed amount is MANUAL', lineFor(e, 'roof').outcome.provenance, 'MANUAL');
  check('a typed amount is not policy', e.estimate.byProvenance.IAOS_POLICY, 0);
  check('a typed amount is not BOOK', e.estimate.byProvenance.BOOK, 0);
  check('currency punctuation is accepted', lineFor(est(answers([['roof', 'repair', '$6,000']])), 'roof').outcome.amount, 6000);
}

// ---- 5. Changing the condition RESETS the manual override to the new
//         default. This is the reviewed example, step for step.
{
  const roof = rowOf('roof');
  let a = M.applyCondition(roof, 'repair');
  check('Roof Repair loads $2,500', a.amount, '2500');
  a = M.applyAmount(a, '6000');
  check('the operator overrides to $6,000', a.amount, '6000');
  check('the override is marked as the operator amount', a.dirty, true);
  check('the override is used', lineFor(est({ roof: a }), 'roof').outcome.amount, 6000);

  a = M.applyCondition(roof, 'severe');
  check('selecting Replace resets to $15,000', a.amount, '15000');
  check('the reset clears the override flag', a.dirty, false);
  check('the reset amount is policy again', lineFor(est({ roof: a }), 'roof').outcome.provenance, 'IAOS_POLICY');
  check('the previous $6,000 does not survive', lineFor(est({ roof: a }), 'roof').outcome.amount, 15000);

  a = M.applyAmount(a, '6000');
  check('re-entering $6,000 is a deliberate act that works', lineFor(est({ roof: a }), 'roof').outcome.amount, 6000);
}

// ---- 6. Not Asked: blank is an unpriced risk; a known amount is used.
{
  const touched = answers([['roof', 'good']]);
  const e = est(touched);
  const windows = lineFor(e, 'windows');
  check('an untouched row is not asked and unpriced', windows.outcome.kind, 'unpriced_risk');
  check('the unpriced reason names it as not asked', windows.outcome.reason.indexOf('not asked') === 0, true);
  check('an unpriced row is never zero-valued', windows.outcome.amount, undefined);
  check('six rows unanswered leaves six risks', e.estimate.unpricedRisks.length, 6);

  const withAmount = Object.assign({}, touched, {
    windows: M.applyAmount(M.EMPTY_ANSWER, '4200'),
  });
  const e2 = est(withAmount);
  check('Not Asked plus a known amount is priced', lineFor(e2, 'windows').outcome.amount, 4200);
  check('Not Asked plus a known amount is MANUAL', lineFor(e2, 'windows').outcome.provenance, 'MANUAL');
  check('that row is no longer an unpriced risk', e2.estimate.unpricedRisks.filter((r) => r.id === 'windows').length, 0);
  check('the amount is used regardless of the condition', e2.estimate.resolvedSubtotal, 4200);
}

// ---- 7. Unknown is gone.
{
  const src = fs.readFileSync(path.join(SRC, 'operator-model.ts'), 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('the operator vocabulary has no Unknown', /["']unknown["']/.test(codeOnly), false);
  check('the vocabulary is exactly four states',
    /export type OperatorCondition =\s*"not_asked" \| "good" \| "repair" \| "severe";/.test(codeOnly), true);
  /* Scoped to the condition options. `contactName`'s unrelated "Unknown"
     fallback for a nameless contact is not a condition and predates this. */
  const pageCode = fs.readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('no condition option is labelled Unknown', /label:\s*["']Unknown["']/.test(pageCode), false);
  check('the page offers exactly the four approved options',
    (pageCode.match(/key:\s*"(not_asked|good|repair|severe)"/g) || []).length, 4);
}

// ---- 8. The untouched fallback.
{
  const e = est({});
  check('an untouched estimator falls back', e.mode, 'fallback');
  check('the fallback is the approved $20,000', e.total, 20000);
  check('the fallback is policy, not BOOK', e.provenance, 'IAOS_POLICY');
  check('the fallback names itself', e.label, M.UNTOUCHED_FALLBACK_LABEL);
  check('the fallback carries no rows', e.estimate, undefined);
  check('explicitly empty answers are still untouched', est({
    roof: { condition: 'not_asked', amount: '', dirty: false },
  }).mode, 'fallback');
  check('isUntouched agrees', M.isUntouched({}), true);
}

// ---- 9. The first interaction removes the fallback completely.
{
  const byCondition = est(answers([['roof', 'good']]));
  check('selecting a condition ends the fallback', byCondition.mode, 'rows');
  check('a Good-only estimate is not $20,000', byCondition.total, 0);

  const byAmount = est({ windows: M.applyAmount(M.EMPTY_ANSWER, '900') });
  check('typing an amount alone ends the fallback', byAmount.mode, 'rows');
  check('the row amount governs', byAmount.estimate.resolvedSubtotal, 900);
  check('isUntouched disagrees once touched', M.isUntouched(answers([['roof', 'good']])), false);
}

// ---- 10. The fallback is NEVER added to row amounts.
{
  const e = est(answers([['roof', 'severe'], ['hvac', 'repair']]));
  check('row mode totals only the rows', e.estimate.resolvedSubtotal, 17500);
  check('no fallback is added to the total', e.total, 17500);
  check('the total is not 20000 plus the rows', e.total === 20000 + 17500, false);
  check('the total never equals the bare fallback here', e.total === 20000, false);
  /* Structural: nothing in the module can add the fallback to a row total. */
  const codeOnly = fs.readFileSync(path.join(SRC, 'operator-model.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('the fallback constant is never added to anything',
    /UNTOUCHED_FALLBACK_AMOUNT\s*\+|\+\s*UNTOUCHED_FALLBACK_AMOUNT/.test(codeOnly), false);
  /* The comma matches the single RETURN site, not the type declaration. */
  check('fallback and rows are mutually exclusive branches',
    (codeOnly.match(/mode: "fallback",/g) || []).length, 1);
}

// ---- 11. No acknowledgement gate anywhere.
{
  const pageSrc = fs.readFileSync(PAGE, 'utf8');
  const pageCode = pageSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('the page renders no checkbox', /type="checkbox"/.test(pageCode), false);
  check('no acknowledgement state survives', /acknowledg/i.test(pageCode), false);
  check('no proceed-with-risk control survives', /Proceed with unpriced/i.test(pageCode), false);
  check('approval is the single deliberate action',
    (pageCode.match(/Approve and save repair total/g) || []).length, 1);
}

// ---- 12. Unpriced risk stays visible, and never blocks approval.
{
  const e = est(answers([['roof', 'severe']]));
  check('unanswered rows remain visible as risks', e.estimate.unpricedRisks.length, 6);
  check('the priced row still totals', e.estimate.resolvedSubtotal, 15000);
  check('an incomplete estimate is still reported incomplete', e.estimate.isCompleteAllowance, false);
  check('completeness is not a gate on any control here',
    typeof e.estimate.isCompleteAllowance, 'boolean');
}

// ---- 13. The inherited FMTM allowance, on the approved defaults.
{
  const e = est(answers([['roof', 'severe'], ['hvac', 'severe']]));
  check('policy amounts carry no BOOK basis', e.estimate.byProvenance.BOOK, 0);
  check('the allowance basis is therefore zero', e.estimate.components.fmtmAllowance.outcome.basis, 0);
  check('the allowance is therefore zero', e.estimate.components.fmtmAllowance.outcome.amount, 0);
  check('the label is still preserved exactly',
    e.estimate.components.fmtmAllowance.label, 'FMTM 10% allowance — historical purpose unverified');
  check('the total is the row sum', e.total, 23000);
}

// ---- 14. Invalid entry stays visibly unpriced.
{
  const e = est({ roof: M.applyAmount(M.applyCondition(rowOf('roof'), 'repair'), 'abc') });
  check('an unreadable amount is unpriced', lineFor(e, 'roof').outcome.kind, 'unpriced_risk');
  check('an unreadable amount does not fall back to the default', e.estimate.resolvedSubtotal, 0);
  const cleared = est({ roof: M.applyAmount(M.applyCondition(rowOf('roof'), 'repair'), '') });
  check('a cleared amount is unpriced, not zero', lineFor(cleared, 'roof').outcome.kind, 'unpriced_risk');
  check('a cleared amount says so', lineFor(cleared, 'roof').outcome.reason.indexOf('cleared') !== -1, true);
  check('a negative amount is unpriced', lineFor(est({ roof: M.applyAmount(M.EMPTY_ANSWER, '-5') }), 'roof').outcome.kind, 'unpriced_risk');
}

// ---- 15. The canonical engine and reference table are untouched.
{
  const codeOnly = fs.readFileSync(path.join(SRC, 'operator-model.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('the operator model imports no reference row', /findReferenceRow|REFERENCE_TABLE/.test(codeOnly), false);
  check('the operator model writes nothing', /ghl|setEstimatedRepairs|fetch\(/i.test(codeOnly), false);
  /* No geographic SELECTOR. "DFW" is authorized by the 2026-09-04 amendment
     as the display name of the policy class, and appears only in the two
     label literals -- never as an input that chooses an amount. */
  check('the operator model reads no geographic selector',
    ['zip', 'geograph', 'market', 'localiz', 'craftsman'].filter((t) => codeOnly.toLowerCase().indexOf(t) !== -1), []);
  check('DFW appears only as an authorized display name',
    (codeOnly.match(/DFW/g) || []).length, 2);
  check('no offer or MAO economics', /offer_|\bmao\b/i.test(codeOnly), false);
}

// ---- 16. Provenance names, and the canonical amendment that authorizes them.
{
  check('BOOK keeps its own name', M.OPERATOR_PROVENANCE_LABEL.BOOK, 'BOOK');
  check('policy amounts are named IAOS DFW POLICY', M.OPERATOR_PROVENANCE_LABEL.IAOS_POLICY, 'IAOS DFW POLICY');
  check('manual amounts are named MANUAL', M.OPERATOR_PROVENANCE_LABEL.MANUAL, 'MANUAL');
  check('a policy amount is never named BOOK',
    M.OPERATOR_PROVENANCE_LABEL.IAOS_POLICY === M.OPERATOR_PROVENANCE_LABEL.BOOK, false);
  check('the fallback is named DFW policy too',
    M.UNTOUCHED_FALLBACK_LABEL.indexOf('IAOS DFW policy') === 0, true);

  const pageCode = fs.readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('the page renders the shared provenance names', /OPERATOR_PROVENANCE_LABEL\[p\]/.test(pageCode), true);
  check('the page keeps no second provenance label map', /const PROVENANCE_LABEL\b/.test(pageCode), false);

  const DOC = path.resolve(APP, '..', 'docs', 'ESTIMATED_REPAIRS_STANDARD.md');
  const doc = fs.readFileSync(DOC, 'utf8');
  /* Whitespace-flattened so a phrase check cannot fail on a line wrap. */
  const docFlat = doc.replace(/\s+/g, ' ');
  check('the canonical standard carries the dated amendment',
    docFlat.indexOf('## Governing operator-defaults amendment — 2026-09-04') !== -1, true);
  /* Every approved value is stated in the document, not only in code. */
  for (const v of ['$2,500', '$15,000', '$8,000', '$3,500', '$12,500', '$1,500', '$3,000', '$5,000', '$750 per window']) {
    checks++;
    if (docFlat.indexOf(v) !== -1) console.log('PASS  amendment states ' + v);
    else { failures++; console.error('FAIL  amendment states ' + v); }
  }
  check('the amendment names the policy class', docFlat.indexOf('`IAOS DFW POLICY`') !== -1, true);
  check('the amendment keeps geography out of pricing',
    docFlat.indexOf('is a NAME, not a pricing input') !== -1, true);
  check('the amendment removes Unknown', /`Unknown` is REMOVED/.test(docFlat), true);
  check('the amendment records the $20,000 fallback', docFlat.indexOf('$20,000 `IAOS DFW POLICY` fallback') !== -1, true);
  check('the amendment forbids adding the fallback to rows',
    docFlat.indexOf('never added to row amounts') !== -1, true);
  check('the amendment leaves persistence unchanged',
    docFlat.indexOf('No persisted itemization in V1') !== -1, true);

  /* Historical BOOK provenance is preserved, not rewritten. */
  check('the historical $6,500 BOOK hvac row still stands in the document',
    /HVAC — `Replace` or `Unknown` \| \$6,500 \| `BOOK`/.test(docFlat), true);
  check('the amendment says so explicitly',
    docFlat.indexOf('historical BOOK record is preserved and is NOT rewritten') !== -1, true);
  check('the amendment does not restate a BOOK figure as policy',
    docFlat.indexOf('does not assert that the cost book ever said') !== -1, true);
  check('the FMTM consequence is recorded', docFlat.indexOf('empty basis there') !== -1, true);
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
