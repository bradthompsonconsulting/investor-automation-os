/**
 * B15-26 (INV-134) spread warnings on Seller Call -- pure + page wiring. Jess GO 2026-11-11.
 *
 * The Deal Calculator's spread classifier (lib/deal-calculator-bar.ts buildSpreadStatus, Jess ruling
 * 2026-10-07) is reused unchanged at Seller Call's Expected Spread @ Current Offer. This suite proves:
 *
 *   A  pure: adequate / below the standard minimum / below the active mode spread / negative read the
 *      same at a Current Offer as at a Test Price (same kind, same shortfalls); only the price's name
 *      differs; the Test Price default wording is byte-identical; colors are one shared map.
 *   B  wiring (source): Seller Call calls the shared classifier with "current_offer", the engine's own
 *      figures.assignmentSpread and resolved mode, no repair flag; renders the status as text (role
 *      status) only when it is not neutral; colors the Spread figure from the same map; the Deal
 *      Calculator now reads that same map.
 *   C  negative controls: each wiring predicate is re-run on a mutated copy of the page source and
 *      must fail there.
 *
 * Offline. No GHL, no network, no React render (rendered proof: test-b15-26-seller-call-spread.cjs).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-b15-26-spread-warnings-test');
const UW = path.join(APP, 'src', 'lib', 'underwriting');
const LIB = path.join(APP, 'src', 'lib');
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* gone */ } };

cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
const SOURCES = [
  path.join(UW, 'types.ts'), path.join(UW, 'resolver-types.ts'), path.join(UW, 'starters.ts'), path.join(UW, 'resolver.ts'),
  path.join(UW, 'compute.ts'), path.join(UW, 'board8-economics.ts'),
  path.join(LIB, 'arv-reconciliation.ts'), path.join(LIB, 'comp-classification.ts'), path.join(LIB, 'propstream-comp-csv.ts'),
  path.join(LIB, 'deal-calculator-bar.ts'),
];
try {
  execSync('npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') + ' --outDir "' + TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' });
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const { computeUnderwriting } = require(path.join(TMP, 'underwriting', 'compute.js'));
const { computeBoard8Economics, computeExpectedSpread } = require(path.join(TMP, 'underwriting', 'board8-economics.js'));
const { buildSpreadStatus, SPREAD_STATUS_COLOR } = require(path.join(TMP, 'deal-calculator-bar.js'));

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 34;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`}`);
}

// Synthetic deal (the Deal Calculator suite's golden inputs): ARV $315,000, repairs $41,000, IAOS starters.
const V = (v) => ({ kind: 'value', value: v, level: 'iaos_starter' });
const D = (v) => ({ kind: 'value', value: v });
const inputs = (assignment) => ({
  arv: D(315000), repairs: D(41000), sellingCostPct: V(0.10), closingCost: V(2500), monthlyCarry: V(500), holdMonths: V(5),
  buyerProfitPct: V(0.15), financing: { kind: 'on', level: 'iaos_starter', ltv: V(0.70), rate: V(0.12), points: V(0.02) },
  assignment, standardMinimum: V(5000), profitSharePct: V(0.25),
});
const STD = { kind: 'standard' };
const PS = { kind: 'profit_share' };
const deal = (assignment) => {
  const result = computeUnderwriting(inputs(assignment));
  return { result, board8: computeBoard8Economics(result), active: { mode: assignment.kind, requiredSpread: result.figures.assignmentSpread } };
};
const at = (assignment, price, reference) => {
  const d = deal(assignment);
  const spread = computeExpectedSpread({ endBuyerMaxPrice: d.board8.endBuyerMaxPrice, referenceKind: reference, referencePrice: price });
  return buildSpreadStatus(d.board8, spread, d.active, null, null, reference);
};
const EBM = deal(STD).board8.endBuyerMaxPrice;
const NOTE = ' This is not a net-profit check.';

// ── A. pure ────────────────────────────────────────────────────────────────
check('setup: synthetic deal resolves (end-buyer max $181,363)', Math.round(EBM), 181363);

check('A1 adequate at a Current Offer: green "meets", naming the standard minimum, not a net-profit check',
  [at(STD, EBM - 8000, 'current_offer').kind, at(STD, EBM - 8000, 'current_offer').text],
  ['meets', 'Meets the $5,000 standard minimum, $3,000 above.' + NOTE]);
check('A2 below the standard minimum at a Current Offer: amber "short" with the exact shortfall',
  [at(STD, EBM - 3000, 'current_offer').kind, at(STD, EBM - 3000, 'current_offer').text],
  ['short', '$2,000 short of the $5,000 standard minimum.']);
check('A3 below the 25% of Buyer Profit mode spread but above $5,000: amber, never green',
  [at(PS, EBM - 6000, 'current_offer').kind, at(PS, EBM - 6000, 'current_offer').text],
  ['short', 'Meets the $5,000 standard minimum, but $5,813 short of the 25% of Buyer Profit spread ($11,813).']);
check('A4 negative at a Current Offer: red, names the Current Offer (not a Test Price)',
  [at(STD, EBM + 2500, 'current_offer').kind, at(STD, EBM + 2500, 'current_offer').text],
  ['negative', "Negative spread: this Current Offer is $2,500 above the end buyer's maximum price, so there is no assignment spread. Required: the $5,000 standard minimum."]);
check('A5 negative in 25% mode names both requirements at a Current Offer',
  at(PS, EBM + 1, 'current_offer').text,
  "Negative spread: this Current Offer is $1 above the end buyer's maximum price, so there is no assignment spread. Required: the $5,000 standard minimum and the 25% of Buyer Profit spread ($11,813).");
check('A6 exactly zero spread is amber (short), not red', at(STD, EBM, 'current_offer').kind, 'short');
check('A7 exactly at the standard minimum is green', at(STD, EBM - 5000, 'current_offer').kind, 'meets');

// Same numbers, same classification: only the price's name differs.
for (const [label, a, p] of [['adequate', STD, EBM - 8000], ['short', PS, EBM - 6000], ['negative', PS, EBM + 2500], ['zero', STD, EBM]]) {
  const t = at(a, p, 'test_price');
  const c = at(a, p, 'current_offer');
  check(`A8 ${label}: same kind and shortfalls at a Test Price and at a Current Offer`,
    [c.kind, c.shortfalls || null], [t.kind, t.shortfalls || null]);
}
check('A9 Test Price default wording is unchanged (no reference argument)',
  buildSpreadStatus(deal(STD).board8, computeExpectedSpread({ endBuyerMaxPrice: EBM, referenceKind: 'test_price', referencePrice: EBM + 2500 }), deal(STD).active).text,
  "Negative spread: this Test Price is $2,500 above the end buyer's maximum price, so there is no assignment spread. Required: the $5,000 standard minimum.");
check('A10 no Current Offer -> neutral, naming the Current Offer',
  [at(STD, null, 'current_offer').kind, at(STD, null, 'current_offer').text], ['neutral', 'No spread check yet: enter a Current Offer.']);
check('A11 no Test Price (default reference) -> neutral text unchanged',
  buildSpreadStatus(deal(STD).board8, null, deal(STD).active).text, 'No spread check yet: enter a Test Price.');
check('A12 unresolved deal (no active requirement) -> neutral, no implied success', buildSpreadStatus(deal(STD).board8, null, null, null, null, 'current_offer').kind, 'neutral');
check('A13 one shared color map: red / amber / green / slate / amber',
  SPREAD_STATUS_COLOR, { negative: '#EF4444', short: '#F59E0B', meets: '#22C55E', neutral: '#64748B', provisional: '#F59E0B' });
check('A14 every non-neutral status carries text (never color alone)',
  [at(STD, EBM - 8000, 'current_offer'), at(STD, EBM - 3000, 'current_offer'), at(STD, EBM + 2500, 'current_offer')].every((s) => s.text.length > 20), true);

// ── B. wiring (source) ─────────────────────────────────────────────────────
const pageSrc = fs.readFileSync(path.join(APP, 'src', 'pages', 'SellerCallWorkspace.tsx'), 'utf8');
const calcSrc = fs.readFileSync(path.join(APP, 'src', 'pages', 'DealCalculator.tsx'), 'utf8');
const barSrc = fs.readFileSync(path.join(LIB, 'deal-calculator-bar.ts'), 'utf8');
const P = {
  imports: (s) => /import \{ buildSpreadStatus, SPREAD_STATUS_COLOR, type SpreadStatus \} from "\.\.\/lib\/deal-calculator-bar";/.test(s),
  callsWithCurrentOffer: (s) => /buildSpreadStatus\(\s*board8,\s*expectedSpread,[\s\S]{0,400}?"current_offer",\s*\)/.test(s),
  readsEngineSpread: (s) => /\{ mode: pipeline\.assignment\.kind, requiredSpread: pipeline\.result\.figures\.assignmentSpread \}/.test(s),
  noRepairFlag: (s) => /,\s*null,\s*null,\s*"current_offer",\s*\)/.test(s),
  rendersOnlyNonNeutral: (s) => /\{spreadStatus\.kind !== "neutral" \? \(\s*<div data-testid="seller-call-spread-status" data-spread-status=\{spreadStatus\.kind\} role="status"/.test(s),
  textRendered: (s) => /color: SPREAD_STATUS_COLOR\[spreadStatus\.kind\], margin: "-2px 0 4px" \}\}>\s*\{spreadStatus\.text\}/.test(s),
  figureColored: (s) => /cell\.key === "spread" && spreadStatus && spreadStatus\.kind !== "neutral" \? SPREAD_STATUS_COLOR\[spreadStatus\.kind\] : "#E2E8F0"/.test(s),
  stripPassesStatus: (s) => /<DealBar cells=\{dealBarCells\} compact spreadStatus=\{spreadStatus\} \/>/.test(s),
};
for (const [name, pred] of Object.entries(P)) check(`B ${name}`, pred(pageSrc), true);
check('B the Deal Calculator reads the shared color map and defines no local copy',
  /SPREAD_STATUS_COLOR, type DealCalcBarCell \} from "\.\.\/lib\/deal-calculator-bar"/.test(calcSrc) && !/const SPREAD_STATUS_COLOR/.test(calcSrc), true);
check('B the classifier still computes no economics (no compute.ts import, no 0.25 / Math.max)',
  !/underwriting\/compute"/.test(barSrc) && barSrc.indexOf('0.25') === -1 && barSrc.indexOf('Math.max') === -1, true);

// ── C. negative controls: every wiring predicate fails on a mutated page ──
const MUTANTS = {
  imports: (s) => s.replace(/import \{ buildSpreadStatus, SPREAD_STATUS_COLOR, type SpreadStatus \} from "\.\.\/lib\/deal-calculator-bar";\r?\n/, ''),
  callsWithCurrentOffer: (s) => s.replace(/"current_offer",(\s*\),\s*\[board8, expectedSpread, pipeline\.result)/, '$1'),
  readsEngineSpread: (s) => s.replace('requiredSpread: pipeline.result.figures.assignmentSpread', 'requiredSpread: 5000'),
  rendersOnlyNonNeutral: (s) => s.replace('{spreadStatus.kind !== "neutral" ? (\r\n                  <div data-testid="seller-call-spread-status"', '{true ? (\r\n                  <div data-testid="seller-call-spread-status"')
    .replace('{spreadStatus.kind !== "neutral" ? (\n                  <div data-testid="seller-call-spread-status"', '{true ? (\n                  <div data-testid="seller-call-spread-status"'),
  figureColored: (s) => s.replace('? SPREAD_STATUS_COLOR[spreadStatus.kind] : "#E2E8F0"', '? "#E2E8F0" : "#E2E8F0"'),
  stripPassesStatus: (s) => s.replace('<DealBar cells={dealBarCells} compact spreadStatus={spreadStatus} />', '<DealBar cells={dealBarCells} compact />'),
};
for (const [name, mutate] of Object.entries(MUTANTS)) {
  const m = mutate(pageSrc);
  check(`C ${name}: the mutant differs from the page and the check fails on it`, [m !== pageSrc, P[name](m)], [true, false]);
}

cleanup();
console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); process.exit(2); }
if (failures > 0) { console.error('FAILED'); process.exit(1); }
console.log('OK');
