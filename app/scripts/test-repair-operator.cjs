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

/* operator-model.ts imports the approved table as JSON, so the compile needs
   --resolveJsonModule. --rootDir is pinned to src/ so the emitted layout is
   predictable: without it tsc infers a common root from the input files and
   the output paths move when the input list changes. */
const SRC_ROOT = path.join(APP, 'src');
try {
  execSync(
    'npx tsc "' + path.join(SRC, 'types.ts') + '" "' + path.join(SRC, 'reference.ts') +
    '" "' + path.join(SRC, 'compute.ts') + '" "' + path.join(SRC, 'operator-model.ts') +
    '" --outDir "' + TMP + '" --rootDir "' + SRC_ROOT +
    '" --module commonjs --target es2020 --strict --resolveJsonModule --esModuleInterop',
    { cwd: APP, stdio: 'inherit' }
  );
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const OUT_LIB = path.join(TMP, 'lib', 'repair-estimation');
const M = require(path.join(OUT_LIB, 'operator-model.js'));
const { computeRepairEstimate } = require(path.join(OUT_LIB, 'compute.js'));
/* The shipped data file, read directly — the same bytes the module imports. */
const TABLE_PATH = path.join(APP, 'src', 'data', 'approved_repair_table.json');
const TABLE = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));

/**
 * Derived from the finished file, never back-filled from a passing run.
 * Keep the formula next to the number; a floor without its derivation is how
 * the next case gets it wrong.
 *
 *  105  check() call sites outside any loop, sections 1-16
 * + 14  the two call sites inside section 1's per-row loop, 7 rows each
 * +  7  section 1's per-row "canonical row exists" counter, counted by hand
 * +  9  section 16's amendment-value loop, which counts by hand
 * + 93  section 17's check() call sites, B6-F1 -- none inside a loop
 * = 228  (until 2026-10-04)
 * + 10  2026-10-04 itemized-allowances rewrite of sections 2-16 (net):
 *         s2 +1, s4 +1, s6 +3, s8 +3, s13 +1, s14 +1; s9, s10 rewritten
 *         at the same count
 * + 38  section 18's check() call sites (18a 2, 18b 4, 18c 4, 18d 5,
 *         18e 8, 18f 4, 18g 7, 18h 4) -- none inside a loop
 * = 276
 */
const FLOOR = 276;
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

// ---- 1. Every approved default, checked against the CANONICAL AMENDMENT.
//
// The expected values are parsed out of the "Approved V1 operator defaults"
// table in docs/ESTIMATED_REPAIRS_STANDARD.md rather than transcribed here.
// That keeps the drift guard meaningful now that the data file is the source
// of truth: policy document -> data file -> module, each link asserted. A
// value edited in the JSON without a canonical amendment fails this section.
{
  const DOC_PATH = path.resolve(APP, '..', 'docs', 'ESTIMATED_REPAIRS_STANDARD.md');
  const doc = fs.readFileSync(DOC_PATH, 'utf8');
  const section = doc.split('### Approved V1 operator defaults')[1];
  if (section === undefined) {
    console.error('ABORT: the canonical amendment table was not found. Nothing tested.');
    cleanup();
    process.exit(13);
  }
  /** label -> { repair, severe }, straight out of the markdown table. */
  const canon = {};
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*\$([\d,]+)[^|]*\|\s*\$([\d,]+)[^|]*\|\s*$/);
    if (!m) continue;
    canon[m[1]] = { repair: Number(m[2].replace(/,/g, '')), severe: Number(m[3].replace(/,/g, '')) };
  }
  check('the canonical table lists seven systems', Object.keys(canon).length, 7);

  for (const row of M.OPERATOR_ROWS) {
    const expected = canon[row.label];
    checks++;
    if (expected === undefined) {
      failures++;
      console.error('FAIL  canonical row exists for ' + row.label);
      continue;
    }
    console.log('PASS  canonical row exists for ' + row.label);
    check('approved Repair default: ' + row.system,
      M.defaultAmountFor(row, 'repair'), String(expected.repair));
    check('approved severe default: ' + row.system,
      M.defaultAmountFor(row, 'severe'), String(expected.severe));
  }

  /* The data file is what the module loaded — not a second transcription. */
  check('the module rows come from the approved table file',
    JSON.stringify(M.OPERATOR_ROWS), JSON.stringify(TABLE.rows));
  /* 2026-10-04: the fallback value is retired; each unanswered row's
     allowance is its own severeDefault from this same file. */
  check('each unanswered allowance comes from the approved table file',
    M.OPERATOR_ROWS.map((r) => M.unansweredAllowanceFor(r)),
    TABLE.rows.map((r) => (r.system === 'windows' ? null : r.severeDefault)));
  check('the approved table names its authority',
    TABLE._meta.authority.indexOf('ESTIMATED_REPAIRS_STANDARD.md') !== -1, true);
  check('the approved table declares policy provenance',
    TABLE._meta.provenance.indexOf('IAOS DFW POLICY') === 0, true);
  check('the approved table carries exactly the seven systems',
    TABLE.rows.map(function (r) { return r.system; }),
    ['roof', 'hvac', 'electrical_whole_house', 'electrical_panel',
      'plumbing_sewer', 'foundation', 'windows']);
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
  /* 2026-10-04: the answered row is Known Repairs; the five unanswered
     lump-sum rows carry their policy allowances (8,000 + 12,500 + 3,000 +
     12,500 + 15,000 = 51,000), which are policy too. */
  check('the answered row is the known subtotal', e.knownSubtotal, 15000);
  check('policy total', e.estimate.byProvenance.IAOS_POLICY, 15000 + 51000);
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
  /* Only the five unanswered allowances are policy; the typed figure is not. */
  check('a typed amount is not policy', e.estimate.byProvenance.IAOS_POLICY, 51000);
  check('the typed amount is the manual subtotal', e.estimate.byProvenance.MANUAL, 6000);
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

// ---- 6. Not Asked (2026-10-04): a blank lump-sum row carries its approved
//         severe allowance as "condition not confirmed"; the counted Windows
//         row is unresolved (count needed); a known amount is used.
{
  const touched = answers([['roof', 'good']]);
  const e = est(touched);
  const hvac = lineFor(e, 'hvac');
  check('an unanswered row carries its approved severe allowance', hvac.outcome.amount, 8000);
  check('the allowance is a reserve, not an indicated repair', hvac.origin, 'unknown_condition');
  check('the allowance is policy', hvac.outcome.provenance, 'IAOS_POLICY');
  const windows = lineFor(e, 'windows');
  check('an unanswered counted row is unresolved, not priced', windows.outcome.kind, 'unpriced_risk');
  check('the unresolved reason names the condition and the missing count',
    windows.outcome.reason.indexOf('condition not confirmed') === 0 && windows.outcome.reason.indexOf('window count') !== -1, true);
  check('an unpriced row is never zero-valued', windows.outcome.amount, undefined);
  check('only the counted row is unresolved', e.estimate.unpricedRisks.map((r) => r.id), ['windows']);

  const withAmount = Object.assign({}, touched, {
    windows: M.applyAmount(M.EMPTY_ANSWER, '4200'),
  });
  const e2 = est(withAmount);
  check('Not Asked plus a known amount is priced', lineFor(e2, 'windows').outcome.amount, 4200);
  check('Not Asked plus a known amount is MANUAL', lineFor(e2, 'windows').outcome.provenance, 'MANUAL');
  check('that row is no longer an unpriced risk', e2.estimate.unpricedRisks.filter((r) => r.id === 'windows').length, 0);
  check('the amount is used regardless of the condition', e2.knownSubtotal, 4200);
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

// ---- 8. UNTOUCHED (2026-10-04): no blanket fallback. Every row is
//         unanswered, so the six lump-sum rows carry their approved severe
//         allowances and Windows is unresolved:
//         15,000 + 8,000 + 12,500 + 3,000 + 12,500 + 15,000 = 66,000.
{
  const e = est({});
  check('an untouched estimator is the row calculation', e.mode, 'rows');
  check('untouched: known repairs are zero', e.knownSubtotal, 0);
  check('untouched: unanswered allowances are the six severe amounts', e.unansweredSubtotal, 66000);
  check('untouched: the preliminary total is their sum', e.total, 66000);
  check('untouched: the allowances are policy, not BOOK', [e.estimate.byProvenance.IAOS_POLICY, e.estimate.byProvenance.BOOK], [66000, 0]);
  check('untouched: Windows is the one unresolved row', e.estimate.unpricedRisks.map((r) => r.id), ['windows']);
  check('explicitly empty answers are the same as untouched', est({
    roof: { condition: 'not_asked', amount: '', quantity: '', dirty: false },
  }).total, 66000);
  check('isUntouched agrees', M.isUntouched({}), true);
  check('the $20,000 fallback constant is retired from the module', M.UNTOUCHED_FALLBACK_AMOUNT, undefined);
  check('the $20,000 fallback is retired from the approved table', TABLE.untouchedFallbackAmount, undefined);
}

// ---- 9. Answering a row replaces ONLY that row's allowance (rule 3).
{
  const byCondition = est(answers([['roof', 'good']]));
  check('Good replaces the roof allowance with $0', [byCondition.knownSubtotal, byCondition.unansweredSubtotal], [0, 51000]);
  check('a Good-only estimate keeps every other allowance', byCondition.total, 51000);

  const byAmount = est({ windows: M.applyAmount(M.EMPTY_ANSWER, '900') });
  check('a typed amount on the counted row is a known repair', byAmount.knownSubtotal, 900);
  check('the row amount governs, beside the six allowances', byAmount.total, 900 + 66000);
  check('isUntouched disagrees once touched', M.isUntouched(answers([['roof', 'good']])), false);
}

// ---- 10. Never both: no blanket figure exists to add (rule 4).
{
  const e = est(answers([['roof', 'severe'], ['hvac', 'repair']]));
  /* Known 15,000 + 2,500; allowances 12,500 + 3,000 + 12,500 + 15,000. */
  check('known repairs are the answered rows only', e.knownSubtotal, 17500);
  check('answered rows carry no allowance', e.unansweredSubtotal, 43000);
  check('the preliminary total is known plus unanswered', e.total, 60500);
  check('the total is not a fallback plus the rows', e.total === 20000 + 17500, false);
  /* Structural: no fallback exists in the module to add to anything. */
  const codeOnly = fs.readFileSync(path.join(SRC, 'operator-model.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  check('no untouched-fallback identifier survives in code', /UNTOUCHED_FALLBACK|untouchedFallback/.test(codeOnly), false);
  check('no fallback mode survives', /mode: "fallback"/.test(codeOnly), false);
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
  check('the unresolved counted row remains visible', e.estimate.unpricedRisks.length, 1);
  check('the priced row still totals', e.knownSubtotal, 15000);
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
  check('the known subtotal is the answered rows', e.knownSubtotal, 23000);
  check('the total is known plus unanswered, with no FMTM', e.total, 23000 + 43000);
}

// ---- 14. Invalid entry stays visibly unpriced.
{
  const e = est({ roof: M.applyAmount(M.applyCondition(rowOf('roof'), 'repair'), 'abc') });
  check('an unreadable amount is unpriced', lineFor(e, 'roof').outcome.kind, 'unpriced_risk');
  check('an unreadable amount does not fall back to the default', e.knownSubtotal, 0);
  check('an unreadable amount does not take the allowance either', e.unansweredSubtotal, 51000);
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
     as the display name of the policy class, and appears only in the
     provenance label literal -- never as an input that chooses an amount.
     (The second literal was the retired fallback's label, 2026-10-04.) */
  check('the operator model reads no geographic selector',
    ['zip', 'geograph', 'market', 'localiz', 'craftsman'].filter((t) => codeOnly.toLowerCase().indexOf(t) !== -1), []);
  check('DFW appears only as an authorized display name',
    (codeOnly.match(/DFW/g) || []).length, 1);
  check('no offer or MAO economics', /offer_|\bmao\b/i.test(codeOnly), false);
}

// ---- 16. Provenance names, and the canonical amendment that authorizes them.
{
  check('BOOK keeps its own name', M.OPERATOR_PROVENANCE_LABEL.BOOK, 'BOOK');
  check('policy amounts are named IAOS DFW POLICY', M.OPERATOR_PROVENANCE_LABEL.IAOS_POLICY, 'IAOS DFW POLICY');
  check('manual amounts are named MANUAL', M.OPERATOR_PROVENANCE_LABEL.MANUAL, 'MANUAL');
  check('a policy amount is never named BOOK',
    M.OPERATOR_PROVENANCE_LABEL.IAOS_POLICY === M.OPERATOR_PROVENANCE_LABEL.BOOK, false);
  check('an unanswered allowance is named "condition not confirmed"',
    M.UNANSWERED_ALLOWANCE_LABEL, 'condition not confirmed');

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

// ---- 17. B6-F1 (INV-43): the Windows quantity input.
//
// Every expected amount here is derived from the approved table's own windows
// rate, never from a literal typed into this file. If the approved rate moves,
// these cases move with it -- which is the point: the row must multiply the
// SELECTED CONDITION'S approved value and nothing else.
{
  const win = rowOf('windows');
  const winRow = TABLE.rows.filter(function (r) { return r.system === 'windows'; })[0];
  const RATE_REPAIR = winRow.repairDefault;
  const RATE_SEVERE = winRow.severeDefault;
  const roof = rowOf('roof');
  const setQty = (row, a, raw) => M.applyQuantity(row, a, raw);

  // --- 17a. Windows is the counted row, and the rate is the approved one.
  check('windows is the only counted row', Object.keys(M.QUANTITY_ROWS), ['windows']);
  check('the count is labelled # windows', M.QUANTITY_ROWS.windows.label, '# windows');
  check('quantitySpecFor finds exactly one counted row',
    M.OPERATOR_ROWS.filter((r) => M.quantitySpecFor(r) !== undefined).map((r) => r.system),
    ['windows']);
  check('the Repair rate is the approved Repair value', M.unitRateFor(win, 'repair'), RATE_REPAIR);
  check('the severe rate is the approved severe value', M.unitRateFor(win, 'severe'), RATE_SEVERE);
  check('Good declares a zero rate', M.unitRateFor(win, 'good'), 0);
  check('Not asked declares no rate at all', M.unitRateFor(win, 'not_asked'), null);
  /* The contract's own words: no second hard-coded $750 anywhere. Comments
     are stripped first, so the module's prose about the rule does not pass
     the check on the rule's behalf. */
  {
    const strip = (f) => fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    check('the module hard-codes no window rate',
      new RegExp('\\b' + RATE_REPAIR + '\\b').test(strip(path.join(SRC, 'operator-model.ts'))), false);
    check('the page hard-codes no window rate',
      new RegExp('\\b' + RATE_REPAIR + '\\b').test(strip(PAGE)), false);
  }

  // --- 17b. Repair x quantity.
  {
    const a = setQty(win, M.applyCondition(win, 'repair'), '3');
    check('Repair x 3 loads three windows', a.amount, String(3 * RATE_REPAIR));
    const e = est({ windows: a });
    check('Repair x 3 prices the row', lineFor(e, 'windows').outcome.amount, 3 * RATE_REPAIR);
    check('a count-derived amount is IAOS policy',
      lineFor(e, 'windows').outcome.provenance, 'IAOS_POLICY');
    check('a count-derived amount is never MANUAL', e.estimate.byProvenance.MANUAL, 0);
    check('a count-derived amount is never BOOK', e.estimate.byProvenance.BOOK, 0);
  }

  // --- 17c. Replace x quantity -- the reviewed example, 6 x $750 = $4,500.
  {
    const a = setQty(win, M.applyCondition(win, 'severe'), '6');
    check('the severe state is labelled Replace', win.severeLabel, 'Replace');
    check('Replace + 6 windows loads 6 x the approved severe rate',
      a.amount, String(6 * RATE_SEVERE));
    check('and that is $4,500 on the approved table', a.amount, '4500');
    const e = est({ windows: a });
    check('Replace + 6 windows totals $4,500', e.knownSubtotal, 4500);
    check('the count itself is remembered', a.quantity, '6');
    check('a loaded count is not an operator override', a.dirty, false);
  }

  // --- 17d. Known Amount stays editable, and a manual figure governs.
  {
    let a = setQty(win, M.applyCondition(win, 'severe'), '6');
    a = M.applyAmount(a, '5200');
    check('a manual Known Amount overrides the calculated one', a.amount, '5200');
    check('the override is marked as the operator amount', a.dirty, true);
    check('the count survives the override', a.quantity, '6');
    const e = est({ windows: a });
    check('the override is the amount used', lineFor(e, 'windows').outcome.amount, 5200);
    check('the override is MANUAL', lineFor(e, 'windows').outcome.provenance, 'MANUAL');
    check('the override is not policy (only the six allowances are)', e.estimate.byProvenance.IAOS_POLICY, 66000);
  }

  // --- 17e. A count changed AFTER a manual override recalculates over it.
  {
    let a = setQty(win, M.applyCondition(win, 'severe'), '6');
    a = M.applyAmount(a, '5200');
    a = setQty(win, a, '8');
    check('changing the count replaces the manual amount', a.amount, String(8 * RATE_SEVERE));
    check('the manual figure does not survive', a.amount === '5200', false);
    check('the recalculated amount is policy again', a.dirty, false);
    check('the new count stands', a.quantity, '8');
    check('the recalculated amount is what prices the row',
      lineFor(est({ windows: a }), 'windows').outcome.provenance, 'IAOS_POLICY');
  }

  // --- 17f. Condition change recalculates at the SELECTED condition's rate.
  {
    let a = setQty(win, M.applyCondition(win, 'repair'), '6');
    check('Repair + 6 uses the Repair rate', a.amount, String(6 * RATE_REPAIR));
    a = M.applyCondition(win, 'severe', a);
    check('the count survives a Repair -> Replace change', a.quantity, '6');
    check('the amount is recalculated at the severe rate', a.amount, String(6 * RATE_SEVERE));
    a = M.applyAmount(a, '9999');
    a = M.applyCondition(win, 'repair', a);
    check('a condition change clears a manual override', a.dirty, false);
    check('and recalculates at the newly selected rate', a.amount, String(6 * RATE_REPAIR));
    check('the count is still not lost', a.quantity, '6');
    /* The rates are equal in DFW V1. The IMPLEMENTATION must still read the
       selected condition's own value, so this asserts the source rather than
       the coincidence. */
    check('the two rates are read separately, whatever they happen to be',
      M.unitRateFor(win, 'repair') === winRow.repairDefault
        && M.unitRateFor(win, 'severe') === winRow.severeDefault, true);
  }

  // --- 17g. Good clears the count and loads $0.
  {
    let a = setQty(win, M.applyCondition(win, 'severe'), '6');
    a = M.applyCondition(win, 'good', a);
    check('Good clears the count', a.quantity, '');
    check('Good loads $0', a.amount, '0');
    check('Good is not an override', a.dirty, false);
    const line = lineFor(est({ windows: a }), 'windows');
    check('Good is a real zero, not an absent price', line.outcome.kind, 'no_repair');
    check('Good creates no repair charge', est({ windows: a }).knownSubtotal, 0);
    check('Good remains editable', M.applyAmount(a, '400').amount, '400');
  }

  // --- 17h. Not Asked is neutral: no count, no amount, no charge.
  {
    let a = setQty(win, M.applyCondition(win, 'severe'), '6');
    a = M.applyCondition(win, 'not_asked', a);
    check('Not asked clears the count', a.quantity, '');
    check('Not asked loads no amount', a.amount, '');
    const e = est(Object.assign(answers([['roof', 'good']]), { windows: a }));
    check('Not asked creates no repair charge', e.knownSubtotal, 0);
    check('Not asked is an unpriced risk, not a zero',
      lineFor(e, 'windows').outcome.kind, 'unpriced_risk');
    check('and it says it was not asked',
      lineFor(e, 'windows').outcome.reason.indexOf('condition not confirmed') === 0, true);
  }

  // --- 17i. A count is an intentional interaction: the fallback is removed.
  {
    const a = setQty(win, M.applyCondition(win, 'severe'), '6');
    const e = est({ windows: a });
    check('a Windows count is a known repair', e.knownSubtotal, 4500);
    check('no $20,000 fallback exists to be the total', M.UNTOUCHED_FALLBACK_AMOUNT, undefined);
    check('the count calculation sits beside the six allowances, nothing more', e.total, 4500 + 66000);
    check('isUntouched disagrees once a count exists', M.isUntouched({ windows: a }), false);
    /* A count alone, with no condition ever selected, is still an interaction.
       It prices nothing -- there is no approved rate under Not asked -- but it
       must not leave the estimator looking untouched. */
    const bare = M.applyQuantity(win, M.EMPTY_ANSWER, '6');
    check('a bare count is still an interaction', M.isUntouched({ windows: bare }), false);
    check('a bare count prices nothing on its own', bare.amount, '');
  }

  // --- 17j. Blank, zero and unreadable counts.
  {
    check('a blank count parses as blank', M.parseQuantity('').kind, 'blank');
    check('a whole number parses as a value', M.parseQuantity('6').value, 6);
    check('a fractional count is invalid', M.parseQuantity('1.5').kind, 'invalid');
    check('a negative count is invalid', M.parseQuantity('-2').kind, 'invalid');
    check('an unreadable count is invalid', M.parseQuantity('six').kind, 'invalid');

    const blank = M.applyCondition(win, 'severe');
    check('a blank count loads one window, the pre-B6-F1 behaviour',
      blank.amount, String(RATE_SEVERE));
    check('a blank count is not read as zero', blank.amount === '0', false);
    check('and it prices one window', lineFor(est({ windows: blank }), 'windows').outcome.amount, RATE_SEVERE);

    const zero = setQty(win, M.applyCondition(win, 'severe'), '0');
    check('a stated zero count is a real zero', zero.amount, '0');
    check('a stated zero count is no repair', lineFor(est({ windows: zero }), 'windows').outcome.kind, 'no_repair');

    const bad = setQty(win, M.applyCondition(win, 'severe'), '1.5');
    check('an unreadable count loads nothing', bad.amount, '');
    check('an unreadable count keeps what was typed', bad.quantity, '1.5');
    check('an unreadable count leaves the row visibly unpriced',
      lineFor(est({ windows: bad }), 'windows').outcome.kind, 'unpriced_risk');
    check('an unreadable count invents no amount', est({ windows: bad }).knownSubtotal, 0);
  }

  // --- 17k. Every other repair row is untouched by any of this.
  {
    check('an uncounted row has no quantity spec', M.quantitySpecFor(roof), undefined);
    let a = M.applyCondition(roof, 'repair');
    check('an uncounted row carries a blank quantity', a.quantity, '');
    check('an uncounted row still loads its approved default', a.amount, '2500');
    a = M.applyAmount(a, '6000');
    check('an uncounted row still takes a manual override', a.amount, '6000');
    check('and that override is still the operator amount', a.dirty, true);
    a = M.applyCondition(roof, 'severe', a);
    check('an uncounted row still resets on a condition change', a.amount, '15000');
    check('an uncounted row gains no count from the reset', a.quantity, '');
    /* The whole-estimate shape is unchanged for the other six rows. */
    const e = est(answers([['roof', 'severe'], ['hvac', 'repair']]));
    check('the other rows total exactly as before', e.knownSubtotal, 17500);
    check('and leave only Windows unresolved (2026-10-04)', e.estimate.unpricedRisks.length, 1);
  }

  // --- 17l. The surface actually wires it.
  {
    const pageCode = fs.readFileSync(PAGE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    check('the page renders the counted row label', /quantity\.label/.test(pageCode), true);
    check('the page routes a count through applyQuantity',
      /applyQuantity\(row, current, raw\)/.test(pageCode), true);
    check('the page asks the model which rows are counted',
      /quantitySpecFor\(row\)/.test(pageCode), true);
    check('the page hands the previous answer to applyCondition',
      /applyCondition\(row, condition, current\)/.test(pageCode), true);
    check('the count never reaches the amount handler',
      /onQuantity=\{\(raw\) => setAmount/.test(pageCode), false);
    check('no acknowledgement gate crept back in', /type="checkbox"/.test(pageCode), false);
  }

  // --- 17m. The canonical amendment that authorizes all of the above.
  {
    const DOC = path.resolve(APP, '..', 'docs', 'ESTIMATED_REPAIRS_STANDARD.md');
    const docFlat = fs.readFileSync(DOC, 'utf8').replace(/\s+/g, ' ');
    check('the document carries the dated B6-F1 amendment',
      docFlat.indexOf('## Windows quantity input amendment — 2026-09-04') !== -1, true);
    check('the amendment names the field', docFlat.indexOf('`# windows`') !== -1, true);
    check('the amendment states the reviewed example',
      docFlat.indexOf('Six windows at `Replace` therefore loads **$4,500**') !== -1, true);
    check('the amendment forbids assuming the two rates stay equal',
      docFlat.indexOf('never assumed shared') !== -1, true);
    check('the amendment forbids a second copy of the rate',
      docFlat.indexOf('A second hard-coded `$750` anywhere is a defect') !== -1, true);
    check('the amendment keeps persistence unchanged',
      docFlat.indexOf('The count is session state and is not persisted') !== -1, true);
    check('the amendment creates no carrier',
      docFlat.indexOf('no carrier was created for this') !== -1, true);
    check('the superseded sentence is marked, not deleted',
      docFlat.indexOf('No quantity input is authorized by this amendment.') !== -1
        && docFlat.indexOf('SUPERSEDED, in that last sentence only') !== -1, true);
    check('the approved per-window value is unchanged by it',
      docFlat.indexOf('The approved per-window rate stays `$750 per window` in both states') !== -1, true);
  }
}

// ---- 18. Itemized unanswered allowances — Brad, 2026-10-04 (Pass 1 F39/F40).
//          The six cases the ruling asked to be verified, by the numbers.
//          Approved severe amounts (table): roof 15,000, hvac 8,000,
//          electrical whole house 12,500, panel 3,000, plumbing 12,500,
//          foundation 15,000; windows is per window and has no allowance.
{
  const estM = (a, misc) => M.operatorEstimate(a, compute, misc);

  // 18a. Untouched: every row unanswered.
  {
    const e = estM({});
    check('18a untouched: known / unanswered / preliminary', [e.knownSubtotal, e.unansweredSubtotal, e.total], [0, 66000, 66000]);
    check('18a untouched: every lump-sum row is "condition not confirmed"',
      e.estimate.lines.filter((l) => l.origin === 'unknown_condition').map((l) => l.id),
      ['roof', 'hvac', 'electrical_whole_house', 'electrical_panel', 'plumbing_sewer', 'foundation']);
  }

  // 18b. Partially answered: Roof Repair, HVAC Good; the rest unanswered.
  {
    const e = estM(answers([['roof', 'repair'], ['hvac', 'good']]));
    check('18b partial: Repair replaces only the roof allowance', lineFor(e, 'roof').outcome.amount, 2500);
    check('18b partial: Good replaces only the hvac allowance with $0', lineFor(e, 'hvac').outcome.kind, 'no_repair');
    check('18b partial: answered rows are indicated, not reserves',
      [lineFor(e, 'roof').origin, lineFor(e, 'hvac').origin], ['indicated', 'indicated']);
    check('18b partial: known / unanswered / preliminary',
      [e.knownSubtotal, e.unansweredSubtotal, e.total], [2500, 12500 + 3000 + 12500 + 15000, 2500 + 43000]);
  }

  // 18c. Fully answered: every lump-sum row answered, windows counted.
  {
    const a = answers([['roof', 'severe'], ['hvac', 'repair'], ['electrical_whole_house', 'good'],
      ['electrical_panel', 'severe'], ['plumbing_sewer', 'repair'], ['foundation', 'good']]);
    a.windows = M.applyQuantity(rowOf('windows'), M.applyCondition(rowOf('windows'), 'severe'), '4');
    const e = estM(a);
    check('18c full: no unanswered allowance remains', e.unansweredSubtotal, 0);
    check('18c full: known = 15,000 + 2,500 + 0 + 3,000 + 3,500 + 0 + 4 x 750', e.knownSubtotal, 27000);
    check('18c full: preliminary equals known', e.total, 27000);
    check('18c full: nothing unresolved', e.estimate.unpricedRisks.length, 0);
  }

  // 18d. Manual override on an unanswered row and on an answered row.
  {
    const a = { foundation: M.applyAmount(M.EMPTY_ANSWER, '7,250'), roof: answer('roof', 'severe', '9000') };
    const e = estM(a);
    check('18d manual: a typed figure on a Not asked row replaces its allowance', lineFor(e, 'foundation').outcome.amount, 7250);
    check('18d manual: and is MANUAL, indicated',
      [lineFor(e, 'foundation').outcome.provenance, lineFor(e, 'foundation').origin], ['MANUAL', 'indicated']);
    check('18d manual: an override on an answered row is kept', lineFor(e, 'roof').outcome.amount, 9000);
    check('18d manual: allowances remain only for the four untouched lump-sum rows',
      e.unansweredSubtotal, 8000 + 12500 + 3000 + 12500);
    check('18d manual: preliminary = 7,250 + 9,000 + 36,000', e.total, 52250);
  }

  // 18e. Miscellaneous / Other repairs.
  {
    const allGood = answers(M.OPERATOR_ROWS.filter((r) => r.system !== 'windows').map((r) => [r.system, 'good']));
    allGood.windows = M.applyCondition(rowOf('windows'), 'good');
    const blank = estM(allGood, M.EMPTY_MISC);
    check('18e misc: blank by default adds nothing and is no risk', [blank.total, blank.estimate.unpricedRisks.length], [0, 0]);
    check('18e misc: blank creates no line', lineFor(blank, 'misc'), undefined);
    const entered = estM(allGood, { description: 'Gutters and fence', amount: '1,800' });
    check('18e misc: an entered amount is counted once', entered.total, 1800);
    check('18e misc: it is the operator figure (MANUAL), a known repair',
      [lineFor(entered, 'misc').outcome.provenance, entered.knownSubtotal], ['MANUAL', 1800]);
    check('18e misc: the description labels the line', lineFor(entered, 'misc').label, 'Miscellaneous / Other repairs — Gutters and fence');
    const negative = estM(allGood, { description: '', amount: '-50' });
    check('18e misc: a negative amount is unresolved and not counted',
      [lineFor(negative, 'misc').outcome.kind, negative.total], ['unpriced_risk', 0]);
    check('18e misc: it sits below every table row', entered.estimate.lines.map((l) => l.id).indexOf('misc'), M.OPERATOR_ROWS.length);
    check('18e misc: no default amount exists for it', M.EMPTY_MISC, { description: '', amount: '' });
  }

  // 18f. Quantity-dependent row: no allowance without a count.
  {
    const win = rowOf('windows');
    check('18f quantity: the counted row has no unanswered allowance', M.unansweredAllowanceFor(win), null);
    const e = estM({});
    check('18f quantity: unanswered Windows is unresolved, flagged for its count',
      lineFor(e, 'windows').outcome.reason.indexOf('window count') !== -1, true);
    const counted = estM({ windows: M.applyQuantity(win, M.applyCondition(win, 'repair'), '3') });
    check('18f quantity: a stated count prices it at the approved rate', lineFor(counted, 'windows').outcome.amount, 3 * win.repairDefault);
    check('18f quantity: and it leaves the unresolved list', counted.estimate.unpricedRisks.length, 0);
  }

  // 18g. The page shows the three figures, the labels and the misc row.
  {
    const pageCode = fs.readFileSync(PAGE, 'utf8');
    check('18g page: Known repairs / Unanswered allowances / Preliminary total',
      /<span>Known repairs<\/span><span>\{money\(result\.knownSubtotal\)\}<\/span>/.test(pageCode)
        && /<span>Unanswered allowances \(\{UNANSWERED_ALLOWANCE_LABEL\}\)<\/span><span>\{money\(result\.unansweredSubtotal\)\}<\/span>/.test(pageCode)
        && /Preliminary total/.test(pageCode), true);
    check('18g page: the preliminary-policy notice, in the ruling wording',
      pageCode.indexOf('"Preliminary policy allowances — not verified market averages and not confirmed repair needs."') !== -1, true);
    check('18g page: each unanswered row shows its allowance or why it has none',
      /data-testid=\{`repair-unanswered-\$\{row\.system\}`\}/.test(pageCode), true);
    check('18g page: the Miscellaneous row has a description and an amount',
      /data-testid="repair-misc-description"/.test(pageCode) && /data-testid="repair-misc-amount"/.test(pageCode), true);
    check('18g page: a misc edit invalidates approval like any other edit',
      /function commitMisc\(next: MiscAnswer\) \{\s*setMisc\(next\);\s*invalidate\(\);/.test(pageCode), true);
    check('18g page: no fallback branch survives', /mode === "fallback"/.test(pageCode), false);
    check('18g page: approval still persists only the total, through the same path',
      /persistApprovedRepairTotalToOpportunity\(\s*ghl, opportunityId,\s*persistGate\(current, revision, currentTotal\),/.test(pageCode), true);
  }

  // 18h. The canonical standard records the ruling.
  {
    const docFlat = fs.readFileSync(path.resolve(APP, '..', 'docs', 'ESTIMATED_REPAIRS_STANDARD.md'), 'utf8').replace(/\s+/g, ' ');
    check('18h doc: the dated amendment exists',
      docFlat.indexOf('## Itemized unanswered allowances amendment — 2026-10-04') !== -1, true);
    check('18h doc: it retires the $20,000 fallback',
      docFlat.indexOf('The blanket $20,000 untouched fallback is retired') !== -1, true);
    check('18h doc: it forbids invented amounts and quantity assumptions',
      docFlat.indexOf('No amount and no quantity assumption is invented') !== -1, true);
    check('18h doc: it authorizes no new GHL write',
      docFlat.indexOf('No new GHL write is authorized by this amendment.') !== -1, true);
  }
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
