/**
 * Board 15 / Pass 1 — B3 Seller Call content (INV-103, INV-104, INV-105).
 *
 * Offline, source-text checks, following this repository's convention for UI
 * wiring (see test-seller-call-workspace-wiring.cjs). The question engine's
 * behaviour is tested in test-next-best-question.cjs (F34 section) and
 * test-seller-call-conversation-first.cjs; this file checks the page.
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

const page = read('src/pages/SellerCallWorkspace.tsx');
const nbq = read('src/lib/underwriting/next-best-question.ts');

// ── F34: internal underwriting items never read to the seller ──────────────
check('F34 ARV and deal economics are the operator categories',
  /export const OPERATOR_CATEGORIES: readonly MaterialCategory\[\] = \["arv", "deal_economics"\];/.test(nbq), true);
check('F34 the page reads the operator checklist from the same engine',
  /computeOperatorChecklist\(readiness, known, board8\)/.test(page), true);
{
  const cardStart = page.indexOf('data-testid="next-best-question-panel"');
  const checklistAt = page.indexOf('data-testid="operator-underwriting-checklist"');
  const cardEnd = page.indexOf('{/* Board 15 / Pass 1 F34 (INV-103) — the operator\'s underwriting');
  check('F34 the operator checklist renders after (outside) the Suggested Next Question card',
    cardStart !== -1 && cardEnd > cardStart && checklistAt > cardEnd, true);
}
check('F34 the checklist is labelled as not for the seller',
  page.includes('Your underwriting checklist — not for the seller'), true);
check('F34 the card handles "no seller question left"',
  /nextBestQuestion\.kind === "operator_only" \? \(\s*<div data-testid="next-best-question-operator-only"/.test(page), true);
check('F34 the Next objective line handles it too',
  /nextBestQuestion\.kind === "operator_only"\s*\? "Finish your underwriting checklist below — nothing left to ask the seller\."/.test(page), true);

// ── F31 / F36: recorded Current Offer, same carrier on both screens ──────────
const rail = read('src/lib/rail.ts');
const contactPage = read('src/pages/ContactWorkspace.tsx');
check('F31 the rail reads Current Offer through the shared carrier reader',
  /import \{ readCurrentOfferFromOpportunity \} from "\.\/current-offer-carrier";/.test(rail)
    && /const currentOffer = readCurrentOfferFromOpportunity\(opp\.customFields, ids\.currentOffer\);/.test(rail), true);
check('F31 the contact page binds the same carrier id Seller Call uses',
  /currentOffer: RAIL_CONFIG\.opportunityFacts\.currentOffer,/.test(contactPage)
    && /readCurrentOfferFromOpportunity\(opp\.customFields, CONFIG\.opportunityFacts\.currentOffer\)/.test(page), true);
check('F31 the Seller Call deal bar renders the recorded-offer note',
  /\{cell\.value\.note \? \(\s*<span data-testid=\{`deal-bar-note-\$\{cell\.key\}`\}/.test(page), true);
check('F36 no "negotiation carrier" jargon is rendered by the rail or the deal bar',
  /WAITING on negotiation/.test(rail.replace(/\/\*[\s\S]*?\*\//g, '')) || /WAITING on negotiation/.test(read('src/lib/seller-call-deal-bar.ts').replace(/\/\*[\s\S]*?\*\//g, '')), false);

console.log(`\nBoard 15 B3 Seller Call:${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
