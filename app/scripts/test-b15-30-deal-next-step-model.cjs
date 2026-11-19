/**
 * B15-30 / INV-140 -- unit checks of lib/deal-next-step.ts (the pure step model). Offline, synthetic.
 * The readiness results are built with the REAL buildOfferReadinessInputs + computeOfferReadiness, so a category's
 * level means exactly what Seller Call means by it; the seller-price refusal is read with the REAL carrier reader.
 *
 *   M1  order: each step is chosen exactly when every earlier step is done
 *   M2  every category level: UNKNOWN and PRELIMINARY are not done, SUPPORTED is
 *   M3  an override with repairs or Assignment Mode missing names THAT input, never the offer review
 *   M4  every input in + override: the offer review is named, as Brad's decision; it is never "done"
 *   M5  completed steps are skipped and counted
 *   M6  a recorded seller-price REFUSAL counts as addressed (real carrier -> readiness)
 *   M7  loading, a failed read or an unread deal field never yields a step (no silent skip)
 *   M8  missing Investor Policy values: an honest GHL step with no IAOS link; PRELIMINARY economics too
 *   M9  a repair total on the deal's own Opportunity completes repairs even while readiness reads repairs UNKNOWN
 *   M10 every label names its destination
 */
'use strict';
const path = require('node:path');
require('./harness/ts-loader.cjs');
const APP = path.resolve(__dirname, '..');
const M = require(path.join(APP, 'src/lib/deal-next-step.ts'));
const { buildOfferReadinessInputs } = require(path.join(APP, 'src/lib/seller-call-readiness-inputs.ts'));
const { computeOfferReadiness } = require(path.join(APP, 'src/lib/underwriting/offer-readiness.ts'));
const C = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));

let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : ` -- ${JSON.stringify(detail).slice(0, 400)}`}`); }

const CALC = { status: 'calculated', endBuyerMaxPrice: 400000, requiredBuyerProfit: 60000, maxSupportedOffer: 300000, standardMinimumAssignmentSpread: 5000, standardMinimumLevel: 'SUPPORTED',
  target: { status: 'calculated', targetWholesaleProfit: 10000, targetAcquisitionPrice: 290000, buyerProfitSharePct: 25 } };
const MISSING = (...m) => ({ status: 'unavailable', reason: 'underlying underwriting has not resolved', missing: m });
const HA = { none: { kind: 'none' }, over: { kind: 'overridden', at: '2026-11-19T15:00:00.000Z', operator: 'UNAVAILABLE', reason: 'fixture override' } };
/** A readiness result from the real engine. Defaults: everything supported. */
const readiness = ({ repairs = 40000, repairsApproved = true, economics = CALC, arvEvidence = 'HIGH', identity = true, ta = true, price = true, human = HA.none } = {}) =>
  computeOfferReadiness(buildOfferReadinessInputs({ known: { arv: 650000, repairs, askingPrice: null }, dealEconomics: economics, repairsApprovalProven: repairsApproved,
    arvEvidenceState: arvEvidence, propertyIdentityConfirmed: identity, transactionAssumptionsRecorded: ta, sellerPricePositionRecorded: price, humanAction: human }));
const state = (o = {}) => ({ records: 'ready', readiness: readiness(o), economics: o.economics ?? CALC, dealRepairsRecorded: o.dealRepairs ?? false, dealAssignmentModeRecorded: o.dealMode ?? true });
const stepOf = (s) => { const r = M.nextDealStep(s); return r.kind === 'step' ? r.step.id : r.kind; };

// M1 order
const order = [
  ['property', state({ identity: false })],
  ['repairs', state({ repairs: null, economics: MISSING('repairs') })],
  ['arv', state({ arvEvidence: null })],
  ['assignment_mode', state({ economics: MISSING('assignmentMode'), dealMode: false })],
  ['policy', state({ economics: MISSING('sellingCostPct') })],
  ['transaction', state({ ta: false })],
  ['seller_price', state({ price: false })],
  ['offer_review', state()],
];
const got1 = order.map(([, s]) => stepOf(s));
check('M1 each step is chosen exactly when every earlier step is done (property, repairs, ARV, Assignment Mode, policy, transaction, seller price, offer review)', JSON.stringify(got1) === JSON.stringify(order.map(([id]) => id)), got1);
check('M1 with several open, the FIRST in order is named (property before repairs and ARV)', stepOf(state({ identity: false, repairs: null, economics: MISSING('repairs'), arvEvidence: null })) === 'property');

// M2 category levels
const r2 = readiness({ arvEvidence: 'LOW' });
check('M2 a PRELIMINARY category (ARV on LOW evidence) is not done', r2.categories.arv !== 'SUPPORTED' && stepOf(state({ arvEvidence: 'LOW' })) === 'arv', r2.categories.arv);
check('M2 an UNKNOWN category (no seller price) is not done; SUPPORTED everywhere reaches the offer review', stepOf(state({ price: false })) === 'seller_price' && stepOf(state()) === 'offer_review');

// M3 override never completes an input
const o3a = state({ repairs: null, economics: MISSING('repairs'), human: HA.over });
const o3b = state({ economics: MISSING('assignmentMode'), dealMode: false, human: HA.over });
check('M3 override recorded (readiness reads OFFER_READY) + repairs missing: the next step is Estimated Repairs, not the offer review', o3a.readiness.effectiveStatus === 'OFFER_READY' && stepOf(o3a) === 'repairs', { eff: o3a.readiness.effectiveStatus, step: stepOf(o3a) });
check('M3 override recorded + Assignment Mode missing: the next step is Assignment Mode, not the offer review', stepOf(o3b) === 'assignment_mode');
check('M3 the override is acknowledged in the reason, which says it does not replace the input', /override does not replace/i.test(M.nextDealStep(o3a).step.reason));

// M4 offer review is Brad's decision
const o4 = M.nextDealStep(state({ human: HA.over }));
check('M4 every input in + override: the offer review is named as Brad\'s decision', o4.kind === 'step' && o4.step.id === 'offer_review' && /your decision/i.test(o4.step.reason) && /your decision/i.test(o4.step.label), o4);
check('M4 the offer review is never counted done (7 of 8 at most)', o4.done === 7 && o4.total === 8, { done: o4.done, total: o4.total });

// M5 skip and count
const o5 = M.nextDealStep(state({ ta: false }));
check('M5 completed steps are skipped (transaction is next) and counted (6 of 8 done)', o5.step.id === 'transaction' && o5.done === 6 && o5.total === 8, { id: o5.step.id, done: o5.done });

// M6 refusal counts
const refusal = C.formatSellerPricePositionNote({ opportunityId: 'opp-x', at: '2026-11-19T15:00:00.000Z', operator: null, kind: 'refused' });
const rec = C.latestSellerPricePositionForOpportunity([{ id: 'n1', body: refusal, dateAdded: '2026-11-19T15:00:00.000Z' }], 'opp-x');
check('M6 a recorded seller-price refusal is a record (real carrier) and the seller-price step is then skipped', rec !== null && stepOf(state({ price: rec !== null })) === 'offer_review', rec);

// M7 never a silent skip
const loading = M.nextDealStep({ records: 'loading', readiness: null, economics: null, dealRepairsRecorded: null, dealAssignmentModeRecorded: null });
const unreadable = M.nextDealStep({ records: 'unreadable', readiness: readiness(), economics: CALC, dealRepairsRecorded: true, dealAssignmentModeRecorded: true });
const unread = M.nextDealStep({ ...state(), dealRepairsRecorded: null });
check('M7 loading -> "checking"; a failed read -> "unreadable"; an unread deal field -> "checking": never a step', loading.kind === 'checking' && unreadable.kind === 'unreadable' && unread.kind === 'checking', { loading: loading.kind, unreadable: unreadable.kind, unread: unread.kind });

// M8 GHL policy step
const o8 = M.nextDealStep(state({ economics: MISSING('sellingCostPct', 'closingCost') }));
const o8b = M.nextDealStep(state({ economics: { ...CALC, target: { status: 'unavailable', reason: 'standard minimum is not configured' } } }));
check('M8 missing Investor Policy values: a GHL step naming them, with no IAOS link', o8.step.id === 'policy' && o8.step.destination.kind === 'ghl' && /sellingCostPct, closingCost/.test(o8.step.reason), o8.step);
check('M8 economics PRELIMINARY (Target not calculable): the policy step with the engine\'s own reason', o8b.step.id === 'policy' && /standard minimum is not configured/.test(o8b.step.reason), o8b.step);

// M9 deal-level repairs (Captain decision 2026-11-19)
const o9 = state({ repairsApproved: false, dealRepairs: true });
check('M9 a repair total on the deal\'s own Opportunity completes repairs while readiness still reads repairs UNKNOWN', o9.readiness.categories.repairs_condition === 'UNKNOWN' && stepOf(o9) !== 'repairs', { cat: o9.readiness.categories.repairs_condition, step: stepOf(o9) });

// M10 labels
const labels = order.map(([, s]) => M.nextDealStep(s).step);
check('M10 every label names its destination: (Underwriting), (Seller Call) or GHL, matching the destination kind',
  labels.every((s) => (s.destination.kind === 'underwriting' && /\(Underwriting\)$/.test(s.label)) || (s.destination.kind === 'seller_call' && /\(Seller Call\)$/.test(s.label)) || (s.destination.kind === 'ghl' && /in GHL$/.test(s.label))), labels.map((s) => s.label));

const FLOOR = 16;
console.log(`\nB15-30 deal next-step model: ${checks - failures}/${checks} checks passed`);
if (checks < FLOOR) { console.log(`FAIL  only ${checks} checks ran (floor ${FLOOR})`); process.exit(1); }
process.exit(failures === 0 ? 0 : 1);
