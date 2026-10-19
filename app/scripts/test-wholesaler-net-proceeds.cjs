/**
 * B15-26 (INV-134) first slice -- wholesaler net proceeds on the Deal
 * Calculator (Brad, 2026-10-19).
 *
 * Offline. Compiles the pure module (src/lib/wholesaler-net-proceeds.ts)
 * together with the REAL underwriting engine (compute.ts,
 * board8-economics.ts) and runs table-driven cases, then checks the page and
 * panel wiring by source text, following this repository's convention for
 * UI wiring (no browser rendering harness; see test-deal-calculator-wiring.cjs).
 * Proves: cost ownership (end-buyer costs price the buyer and are never
 * deducted again; wholesaler costs never change the buyer's price);
 * unknown/zero handling (no silent zero, typed 0 and Not applicable are
 * explicit, unknown blocks the net); switching transaction types; earnest
 * money kept out of the net; no GHL read or write; nothing gated.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-wholesaler-net-proceeds-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/wholesaler-net-proceeds.ts'),
    path.join(APP, 'src/lib/underwriting/compute.ts'),
    path.join(APP, 'src/lib/underwriting/board8-economics.ts'),
    path.join(APP, 'src/lib/deal-calculator-inputs.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const net = require(path.join(TMP, 'src/lib/wholesaler-net-proceeds.js'));
const { computeUnderwriting } = require(path.join(TMP, 'src/lib/underwriting/compute.js'));
const { computeBoard8Economics, computeExpectedSpread } = require(path.join(TMP, 'src/lib/underwriting/board8-economics.js'));
const { parseNonNegativeAmountInput } = require(path.join(TMP, 'src/lib/deal-calculator-inputs.js'));
fs.rmSync(TMP, { recursive: true, force: true });
const { computeNetProceeds, netProceedsText, COST_LINES, NET_RESULT_LABEL, EARNEST_MONEY_NOTE } = net;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) { failures++; console.error(`FAIL ${name}${detail === undefined ? '' : ` -- ${detail}`}`); }
}
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
const money = (n) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
const amt = (amount) => ({ kind: 'amount', amount });
const NA = { kind: 'not_applicable' };
const UNKNOWN = { kind: 'unknown' };
const gross = (value) => ({ status: 'calculated', referenceKind: 'test_price', referencePrice: 0, endBuyerMaxPrice: value, expectedSpread: value });
const noGross = { status: 'unavailable', reason: 'no Test Price entered on the standalone calculator' };
const keys = (t) => COST_LINES[t].map((l) => l.key);
const allNa = (t) => Object.fromEntries(keys(t).map((k) => [k, NA]));

// ── 1. Lines per transaction type ────────────────────────────────────────────
check('assignment lines', JSON.stringify(keys('assignment')) === JSON.stringify(['assignment_title_fee', 'legal', 'jv_share', 'marketing']), keys('assignment'));
check('double-close lines', JSON.stringify(keys('double_close')) === JSON.stringify(['purchase_closing', 'resale_closing', 'transactional_funding', 'legal', 'jv_share', 'marketing']), keys('double_close'));
check('JV share and marketing are dollar lines in both', ['assignment', 'double_close'].every((t) => COST_LINES[t].some((l) => l.key === 'jv_share' && l.label.includes('($)')) && COST_LINES[t].some((l) => l.key === 'marketing' && l.label.includes('($)'))));
check('no end-buyer cost line is a wholesaler line', !COST_LINES.double_close.concat(COST_LINES.assignment).some((l) => /end-buyer|selling cost|holding|buyer profit|repairs|financ/i.test(l.label)));
check('result label exact', NET_RESULT_LABEL === 'Estimated net at modeled buyer price');

// ── 2. Unknown / zero handling ───────────────────────────────────────────────
check('no type -> no estimate', computeNetProceeds({ type: null, entries: allNa('double_close'), grossSpread: gross(20000) }).kind === 'no_type');
const fresh = computeNetProceeds({ type: 'double_close', entries: {}, grossSpread: gross(20000) });
check('fresh double close: every line Unknown, no estimate', fresh.kind === 'unknown' && fresh.unknown.length === 6, JSON.stringify(fresh));
check('fresh double close: closing lines named Unknown', fresh.kind === 'unknown' && fresh.unknown.includes('Your closing costs: buying from the seller') && fresh.unknown.includes('Your closing costs: selling to the end buyer'));
const freshA = computeNetProceeds({ type: 'assignment', entries: {}, grossSpread: gross(20000) });
check('fresh assignment: every line Unknown (no silent zero)', freshA.kind === 'unknown' && freshA.unknown.length === 4, JSON.stringify(freshA));
const oneUnknown = computeNetProceeds({ type: 'double_close', entries: { ...allNa('double_close'), resale_closing: UNKNOWN }, grossSpread: gross(20000) });
check('one Unknown line blocks the net', oneUnknown.kind === 'unknown' && oneUnknown.unknown.length === 1 && oneUnknown.unknown[0] === 'Your closing costs: selling to the end buyer', JSON.stringify(oneUnknown));
const zeros = computeNetProceeds({ type: 'assignment', entries: { assignment_title_fee: amt(0), legal: amt(0), jv_share: amt(0), marketing: amt(0) }, grossSpread: gross(12000) });
check('typed 0 is an explicit amount', zeros.kind === 'estimated' && zeros.totalCosts === 0 && zeros.net === 12000, JSON.stringify(zeros));
const nas = computeNetProceeds({ type: 'assignment', entries: allNa('assignment'), grossSpread: gross(12000) });
check('all Not applicable is explicit', nas.kind === 'estimated' && nas.net === 12000, JSON.stringify(nas));
check('no gross -> no estimate even with every cost known', computeNetProceeds({ type: 'assignment', entries: allNa('assignment'), grossSpread: noGross }).kind === 'no_gross');
let threw = false;
try { computeNetProceeds({ type: 'assignment', entries: { ...allNa('assignment'), legal: amt(-5) }, grossSpread: gross(1) }); } catch { threw = true; }
check('negative cost rejected', threw);
threw = false;
try { computeNetProceeds({ type: 'assignment', entries: { ...allNa('assignment'), legal: amt(NaN) }, grossSpread: gross(1) }); } catch { threw = true; }
check('non-finite cost rejected', threw);

// ── 3. Arithmetic and display ────────────────────────────────────────────────
const dc = computeNetProceeds({
  type: 'double_close',
  entries: { purchase_closing: amt(2500), resale_closing: amt(1800), transactional_funding: amt(1500), legal: NA, jv_share: amt(4000), marketing: amt(1200) },
  grossSpread: gross(20000),
});
check('double-close net', dc.kind === 'estimated' && dc.totalCosts === 11000 && dc.net === 9000 && dc.grossSpread === 20000, JSON.stringify(dc));
check('estimated text names label, net, gross and costs', netProceedsText(dc, money) === 'Estimated net at modeled buyer price: $9,000 = gross spread $20,000 - your costs $11,000.', netProceedsText(dc, money));
const below = computeNetProceeds({ type: 'assignment', entries: { ...allNa('assignment'), jv_share: amt(6000) }, grossSpread: gross(3648) });
check('net below zero is shown, not hidden', below.kind === 'estimated' && below.net === -2352 && netProceedsText(below, money).includes('-$2,352 (below zero)'), netProceedsText(below, money));
const negGross = computeNetProceeds({ type: 'assignment', entries: allNa('assignment'), grossSpread: gross(-6352) });
check('negative gross still estimates (gates nothing)', negGross.kind === 'estimated' && negGross.net === -6352);
check('unknown text lists names', netProceedsText(oneUnknown, money) === 'Net not estimated. Unknown: Your closing costs: selling to the end buyer.', netProceedsText(oneUnknown, money));
check('no-type text', netProceedsText({ kind: 'no_type' }, money).startsWith('Net not estimated'));
check('no-gross text', netProceedsText({ kind: 'no_gross' }, money).startsWith('Net not estimated'));

// ── 4. Switching transaction types ───────────────────────────────────────────
const kept = { purchase_closing: amt(3000), resale_closing: amt(2000), transactional_funding: NA, assignment_title_fee: amt(250), legal: amt(500), jv_share: NA, marketing: amt(700) };
const asA = computeNetProceeds({ type: 'assignment', entries: kept, grossSpread: gross(15000) });
check('assignment ignores double-close-only entries', asA.kind === 'estimated' && asA.totalCosts === 250 + 500 + 700, JSON.stringify(asA));
const asDc = computeNetProceeds({ type: 'double_close', entries: kept, grossSpread: gross(15000) });
check('double close ignores assignment-only entries', asDc.kind === 'estimated' && asDc.totalCosts === 3000 + 2000 + 500 + 700, JSON.stringify(asDc));
const back = computeNetProceeds({ type: 'assignment', entries: kept, grossSpread: gross(15000) });
check('switching back is stable', JSON.stringify(back) === JSON.stringify(asA));
const switchedUnknown = computeNetProceeds({ type: 'double_close', entries: allNa('assignment'), grossSpread: gross(15000) });
check('switch to double close: its own closing lines are Unknown', switchedUnknown.kind === 'unknown' && switchedUnknown.unknown.length === 3 && switchedUnknown.unknown.includes('Transactional funding fee'), JSON.stringify(switchedUnknown));

// ── 5. Cost ownership through the REAL engine ────────────────────────────────
const val = (value) => ({ kind: 'value', value, level: 'investor_policy' });
function inputs(closingCost) {
  return {
    arv: { kind: 'value', value: 300000 }, repairs: { kind: 'value', value: 40000 },
    sellingCostPct: val(0.1), closingCost: val(closingCost), monthlyCarry: val(1000), holdMonths: val(4),
    buyerProfitPct: val(0.1), financing: { kind: 'off', level: 'investor_policy' },
    assignment: { kind: 'standard' }, standardMinimum: val(5000), profitSharePct: val(0.25),
  };
}
function grossFor(closingCost, testPrice) {
  const b8 = computeBoard8Economics(computeUnderwriting(inputs(closingCost)));
  return { b8, spread: computeExpectedSpread({ endBuyerMaxPrice: b8.endBuyerMaxPrice, referenceKind: 'test_price', referencePrice: testPrice }) };
}
const base = grossFor(2500, 150000);
const higherBuyerClosing = grossFor(4500, 150000);
check('engine resolves', base.b8.status === 'calculated' && base.spread.status === 'calculated', JSON.stringify(base.spread));
check('end-buyer closing cost reaches gross exactly once', base.spread.expectedSpread - higherBuyerClosing.spread.expectedSpread === 2000, `${base.spread.expectedSpread} vs ${higherBuyerClosing.spread.expectedSpread}`);
const dcEntries = { purchase_closing: amt(2500), resale_closing: amt(2500), transactional_funding: NA, legal: NA, jv_share: NA, marketing: NA };
const n1 = computeNetProceeds({ type: 'double_close', entries: dcEntries, grossSpread: base.spread });
const n2 = computeNetProceeds({ type: 'double_close', entries: dcEntries, grossSpread: higherBuyerClosing.spread });
check('net = gross - wholesaler costs (no second end-buyer deduction)', n1.kind === 'estimated' && n1.net === base.spread.expectedSpread - 5000, JSON.stringify(n1));
check('end-buyer closing change moves net only through gross', n1.kind === 'estimated' && n2.kind === 'estimated' && n1.net - n2.net === 2000);
const before = JSON.stringify(base.b8);
computeNetProceeds({ type: 'double_close', entries: { ...dcEntries, purchase_closing: amt(99999) }, grossSpread: base.spread });
check('wholesaler costs never change Target / Max / buyer price', JSON.stringify(grossFor(2500, 150000).b8) === before);

// ── 6. Earnest money ─────────────────────────────────────────────────────────
check('earnest note: credited, can be lost', /credited at closing/.test(EARNEST_MONEY_NOTE) && /can be lost/.test(EARNEST_MONEY_NOTE) && /Not counted as a cost/.test(EARNEST_MONEY_NOTE));
check('earnest money is not a cost line', !COST_LINES.assignment.concat(COST_LINES.double_close).some((l) => /earnest/i.test(l.label + l.key)));

// ── 6b. F1 (Bones, 2026-10-19): the panel's input conversion, real parser ────
// This file's check() takes a boolean; eq() makes each comparison explicit.
{
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const conv = (raw, notApplicable = false) => net.costEntryFromInput({ notApplicable, raw }, parseNonNegativeAmountInput);
  const p$ = parseNonNegativeAmountInput('$');
  check('F1 the shared parser still reads "$" as 0 (unchanged; why the guard exists)', eq(p$, { kind: 'value', value: 0 }), JSON.stringify(p$));
  for (const raw of ['$', ',', '$, ', ' $ ', '$$,,']) {
    const got = conv(raw);
    check(`F1 punctuation only stays Unknown: ${JSON.stringify(raw)}`, eq(got, UNKNOWN), JSON.stringify(got));
  }
  check('F1 typed 0 is an amount', eq(conv('0'), amt(0)), JSON.stringify(conv('0')));
  check('F1 formatted $0 is an amount', eq(conv('$0'), amt(0)), JSON.stringify(conv('$0')));
  check('F1 nonzero formatted amount', eq(conv('$1,500'), amt(1500)), JSON.stringify(conv('$1,500')));
  check('F1 blank stays Unknown', eq(conv(''), UNKNOWN), JSON.stringify(conv('')));
  check('F1 invalid stays Unknown', eq([conv('abc'), conv('-5'), conv('$-5')], [UNKNOWN, UNKNOWN, UNKNOWN]));
  check('F1 explicit Not applicable wins over any text', eq([conv('$', true), conv('', true), conv('900', true)], [NA, NA, NA]));
  check('F1 no input yet is Unknown', eq(net.costEntryFromInput(undefined, parseNonNegativeAmountInput), UNKNOWN));
  // Bones's scenario: Assignment, every other line N/A, Legal "$" -> no net.
  for (const raw of ['$', ',', '$, ']) {
    const entries = { ...allNa('assignment'), legal: conv(raw) };
    const r = computeNetProceeds({ type: 'assignment', entries, grossSpread: gross(20000) });
    check(`F1 scenario ${JSON.stringify(raw)}: no net estimate, Legal named Unknown`, eq([r.kind, r.unknown], ['unknown', ['Legal / attorney review']]), JSON.stringify(r));
  }
  const ok = computeNetProceeds({ type: 'assignment', entries: { ...allNa('assignment'), legal: conv('$0') }, grossSpread: gross(20000) });
  check('F1 positive control: "$0" still completes the net', eq([ok.kind, ok.net], ['estimated', 20000]), JSON.stringify(ok));
}

// ── 7. Wiring ────────────────────────────────────────────────────────────────
const lib = read('src/lib/wholesaler-net-proceeds.ts');
check('module imports only the ExpectedSpread type', (lib.match(/^import .*$/gm) || []).join('\n') === 'import type { ExpectedSpread } from "./underwriting/board8-economics";');
const panel = read('src/components/NetProceedsPanel.tsx');
check('panel: no GHL, fetch or write', !/\bghl\b|fetch\(|appWriteFetch|notes\.create|localStorage|sessionStorage/.test(panel));
check('panel: no transaction type preselected', panel.includes('useState<TransactionType | null>(null)'));
check('panel: Not applicable control per line', panel.includes('deal-calc-net-${line.key}-na') && panel.includes('Not applicable'));
check('panel: conversion goes through costEntryFromInput with the page parser', panel.includes('return costEntryFromInput(input, parseNonNegativeAmountInput);'));
check('panel: punctuation-only earnest is not an amount', panel.includes('hasAmountDigit(earnestRaw) ? parseNonNegativeAmountInput(earnestRaw)'));
check('module: empty/invalid input is Unknown, never zero', /parsed\.kind === "value" \? \{ kind: "amount", amount: parsed\.value \} : \{ kind: "unknown" \}/.test(lib) && lib.includes('if (!hasAmountDigit(input.raw)) return { kind: "unknown" };'));
check('panel: result rendered as text status', panel.includes('netProceedsText(result, formatWholeDollars)') && panel.includes('role="status"'));
check('panel: earnest money outside the net', panel.includes('EARNEST_MONEY_NOTE') && !/earnest[\s\S]{0,80}computeNetProceeds/.test(panel));
const page = read('src/pages/DealCalculator.tsx');
check('page imports panel', page.includes('import { NetProceedsPanel } from "../components/NetProceedsPanel";'));
check('page passes only the existing Expected Spread', page.includes('<NetProceedsPanel key={netPanelRevision} grossSpread={expectedSpread} />'));
check('Clear resets the panel', /function handleClear\(\) \{[\s\S]*setNetPanelRevision\(\(n\) => n \+ 1\);[\s\S]*\n  \}/.test(page));
check('spread status still built from the engine', page.includes('buildSpreadStatus(') && page.includes('buildDealCalculatorBarCells({ arv, repairs, testPrice, board8, expectedSpread })'));

console.log(`B15-26 net proceeds: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
