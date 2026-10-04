/**
 * Board 15 / Pass 1 — operator-facing copy that must stay true.
 *
 * Offline, source-text checks, following this repository's convention for UI
 * wiring (see test-seller-call-workspace-wiring.cjs).
 *
 *   F45  The repair-total save copy named the Contact field `estimated_repairs`
 *        ("Saved to estimated_repairs", "...field on this contact"). The
 *        approval actually writes the Opportunity's Repairs carrier through
 *        persistApprovedRepairTotalToOpportunity -> setRepairEstimate
 *        (CONFIG.opportunityFacts.repairs). The partial-save panel printed raw
 *        carrier keys (endBuyerMaxPrice / sellerMAO / assignmentMode).
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

let checks = 0;
let failures = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

// ── F45: where the approved repair total is saved ───────────────────────────
const uw = read('src/pages/UnderwritingWorkspace.tsx');
const ghl = read('src/lib/ghl.ts');

// The facts the copy must match (OBSERVED in code, asserted so the copy
// check below fails if the write target ever moves back).
check('Underwriting approves repairs through the Opportunity-targeted path',
  /persistApprovedRepairTotalToOpportunity/.test(uw), true);
check('setRepairEstimate writes the Opportunity Repairs carrier',
  /setRepairEstimate: async \([\s\S]{0,400}const fieldId = CONFIG\.opportunityFacts\.repairs;/.test(ghl), true);

// Rendered JSX text only: strip comments so doc comments may still name
// the legacy field for history.
const uwRendered = uw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('no rendered Underwriting text names the estimated_repairs field', /estimated_repairs/.test(uwRendered), false);
check('no rendered Underwriting text says the repair total is saved on this contact',
  /field on this contact/.test(uwRendered), false);
check('saving state says the total goes to this deal',
  uw.includes('Saving the repair total to this deal, then reading GHL back…'), true);
check('saved state says the total was saved to this deal',
  uw.includes('Repair total saved to this deal · {money(persistState.result.value)}'), true);
check('unconfirmed state points the operator at the deal, not the contact',
  /Check the\s+deal \(opportunity\) in GHL before relying on it\./.test(uw), true);
check('footer names the opportunity as the destination',
  /Approving saves the TOTAL ONLY to this deal's\s+Repairs field in GHL \(on the opportunity, not the contact\)/.test(uw), true);

// Partial-save panel shows operator labels, not carrier keys.
check('partial-save panel maps carrier keys to operator labels',
  /\{CARRIER_LABEL\[c\.key\] \?\? c\.key\}/.test(uw)
  && /endBuyerMaxPrice: "End-Buyer Maximum Purchase Price"/.test(uw)
  && /sellerMAO:\s+"Seller MAO"/.test(uw)
  && /assignmentMode:\s+"Assignment Mode"/.test(uw), true);
check('partial-save panel no longer renders the bare carrier key',
  /<span style=\{\{ color: "#94A3B8" \}\}>\{c\.key\}<\/span>/.test(uw), false);

console.log(`\nBoard 15 operator copy: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
