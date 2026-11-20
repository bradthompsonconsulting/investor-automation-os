/**
 * B15-30 / INV-140 -- local test deals at different stages (offline, in memory; test-only; synthetic and fictional).
 *
 *   Seller "Guide Fixture" (fixtureGuideContact), TWO deals. Both carry, bound to their own opportunity: an approved
 *   ARV (650000, HIGH), a confirmed property identity, transaction assumptions and a seller price (425000). The contact
 *   has NO repair seed, so nothing contact-wide can complete repairs for both deals.
 *     Deal A (OPP_A): Assignment Mode "Standard Minimum", NO repair total. The test records a readiness OVERRIDE through
 *             the page's own control. Expected next step: Estimated Repairs (Underwriting).
 *     Deal B (OPP_B): repair total 40000 on the deal's own Opportunity, NO Assignment Mode. Expected next step:
 *             Assignment Mode (Underwriting). The Assignment Mode write is ACCEPTED HERE (in memory only) so the test
 *             can choose a mode and continue; after it the next step is the offer review.
 *
 *   Seller "Other Fixture" (fixtureOtherContact), ONE deal (OPP_O): everything but the transaction assumptions.
 *          Expected next step: the transaction assumptions (on Seller Call itself). Used for a seller switch and an
 *          in-page focus.
 *   Seller "Arv Fixture" (fixtureArvContact), ONE deal (OPP_V): repairs and Assignment Mode on the deal, property,
 *          transaction and seller price recorded, NO ARV (no approval note, no ARV value). Expected next step: approve
 *          the ARV (Underwriting).
 *
 * `state.gone` (a Set of opportunity ids): deals no longer this contact's -- left out of the pipeline list, and their
 * own read answers 404. B15-30 R1 uses it for "the link names Deal A and A is unavailable".
 *
 * Note writes (the override) and the Assignment Mode write are applied in memory and visible on the next read. Every
 * other write is refused (409 not_sent). Nothing leaves the machine. Deterministic seed timestamps (2026-09-30Z).
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..', '..', '..');
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const { formatArvApprovalNote } = require(path.join(APP, 'src/lib/arv-persist.ts'));
const { formatPropertyIdentityConfirmationNote, formatTransactionAssumptionsNote, formatSellerPricePositionNote } = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));

const CONFIG = getConfig('test');
const IDS = { oppArv: CONFIG.opportunityFacts.arv, oppRepairs: CONFIG.opportunityFacts.repairs, assignmentMode: CONFIG.opportunityFields.assignmentMode };
const G = 'fixtureGuideContact';
const OPP_A = `${G}-deal-a`;
const OPP_B = `${G}-deal-b`;
const O = 'fixtureOtherContact';
const OPP_O = `${O}-deal`;
const V = 'fixtureArvContact';
const OPP_V = `${V}-deal`;
const ARV = 650000;
const DEAL_B_REPAIRS = 40000;
const SELLER_PRICE = 425000;
const ADDRESS = { address1: '77 Guide Ln', city: 'Austin', state: 'TX', postalCode: '78701' };
const DISPLAY_ADDRESS = [ADDRESS.address1, [ADDRESS.city, [ADDRESS.state, ADDRESS.postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
const POLICY_HUMAN = {
  sellingCostPct: '10', closingCost: '2500', monthlyCarry: '500', holdMonths: '5', buyerProfitPct: '15',
  financingEnabled: 'On', financingLtv: '70', financingRate: '12', financingPoints: '2', standardMinimum: '5000', profitSharePct: '25',
};
const POLICY_VALUES = Object.entries(POLICY_HUMAN).map(([k, value]) => ({ id: CONFIG.customValues[k], value }));

function dealNotes(opp, tag, { transaction = true, arv = true } = {}) {
  const n = (id, body) => ({ id: `${tag}-${id}`, body, dateAdded: '2026-09-30T15:00:00.000Z' });
  return [
    ...(arv ? [n('arv', formatArvApprovalNote({ kind: 'approved', amount: ARV, recommendedArv: ARV, revision: 1 }, {
      approvedAt: '2026-09-30T15:00:00.000Z', operator: 'Fixture Operator', opportunityId: opp,
      evidenceState: 'HIGH', reconciliationOutcome: 'RECOMMENDED', acceptedCompCount: 5, searchLevel: 'STANDARD',
      source: { kind: 'PROPSTREAM_COMPARABLE_CSV', version: 'propstream-comparable-csv-v1', fileName: 'fixture-comps.csv', importedAt: '2026-09-30T14:55:00.000Z' },
    }))] : []),
    n('identity', formatPropertyIdentityConfirmationNote({ opportunityId: opp, at: '2026-09-30T15:01:00.000Z', operator: null, status: 'confirmed', address: DISPLAY_ADDRESS })),
    ...(transaction ? [n('transaction', formatTransactionAssumptionsNote({ opportunityId: opp, at: '2026-09-30T15:02:00.000Z', operator: null,
      transactionStructure: { kind: 'value', value: 'Assignment of contract' }, closingPossession: { kind: 'value', value: 'Close in 30 days; vacant at closing' }, titleComplications: { kind: 'none' } }))] : []),
    n('seller-price', formatSellerPricePositionNote({ opportunityId: opp, at: '2026-09-30T15:03:00.000Z', operator: null, kind: 'price', price: SELLER_PRICE })),
  ];
}

/** contact id -> { first, phone, deals: [[oppId, dealName]] } */
const SELLERS = {
  [G]: { first: 'Guide', phone: '+15555550177', deals: [[OPP_A, 'Deal A'], [OPP_B, 'Deal B']] },
  [O]: { first: 'Other', phone: '+15555550178', deals: [[OPP_O, 'Other deal']] },
  [V]: { first: 'Arv', phone: '+15555550179', deals: [[OPP_V, 'Arv deal']] },
};
const CONTACT_OF = Object.fromEntries(Object.entries(SELLERS).flatMap(([c, s]) => s.deals.map(([o]) => [o, c])));

function twoStageDeals() {
  let state;
  /** The deal's own Opportunity fields: [arv, repairs, assignmentMode] (null = absent). */
  const facts = (opp) => {
    if (opp === OPP_A) return [ARV, null, 'Standard Minimum'];
    if (opp === OPP_B) return [ARV, DEAL_B_REPAIRS, state.modes[OPP_B] ?? null];
    if (opp === OPP_O) return [ARV, DEAL_B_REPAIRS, 'Standard Minimum'];
    if (opp === OPP_V) return [null, DEAL_B_REPAIRS, 'Standard Minimum'];
    return [null, null, null];
  };
  const oppFields = (opp, singular) => {
    const v = (id, value, key) => (singular ? { id, fieldValue: value } : { id, [key]: value });
    const [arv, repairs, mode] = facts(opp);
    return [
      ...(arv !== null ? [v(IDS.oppArv, arv, 'fieldValueNumber')] : []),
      ...(repairs !== null ? [v(IDS.oppRepairs, repairs, 'fieldValueNumber')] : []),
      ...(mode !== null ? [v(IDS.assignmentMode, mode, 'fieldValueString')] : []),
    ];
  };
  const row = (id, name) => { const c = CONTACT_OF[id]; return { id, contactId: c, contactName: SELLERS[c].first, opportunityName: name, phone: '', email: '', stageId: 'fixture-stage', customFields: oppFields(id, false) }; };
  const contact = (c) => ({ id: c, firstName: SELLERS[c].first, lastName: 'Fixture', phone: SELLERS[c].phone });
  return {
    G, OPP_A, OPP_B, O, OPP_O, V, OPP_V,
    reset() {
      state = {
        notes: {
          [G]: [{ id: 'g-seed', body: 'Seed note for Guide', dateAdded: '2026-09-30T12:00:00.000Z' }, ...dealNotes(OPP_A, 'da'), ...dealNotes(OPP_B, 'db')],
          [O]: [{ id: 'o-seed', body: 'Seed note for Other', dateAdded: '2026-09-30T12:00:00.000Z' }, ...dealNotes(OPP_O, 'do', { transaction: false })],
          [V]: [{ id: 'v-seed', body: 'Seed note for Arv', dateAdded: '2026-09-30T12:00:00.000Z' }, ...dealNotes(OPP_V, 'dv', { arv: false })],
        },
        modes: {}, created: 0, writes: [], gone: new Set(),
      };
    },
    get state() { return state; },
    contactOf: (o) => CONTACT_OF[o] ?? null,
    write(op, target, args) {
      state.writes.push({ op, target });
      if (op === 'note.create' && SELLERS[target]) {
        state.created += 1;
        state.notes[target].push({ id: `n-created-${state.created}`, body: args.body, dateAdded: new Date().toISOString() });
        return { status: 200, body: { confirmed: true, note: { id: `n-created-${state.created}` } } };
      }
      if (op === 'opportunity.assignmentMode' && target === OPP_B && args && typeof args.value === 'string') {
        state.modes[OPP_B] = args.value;
        return { status: 200, body: { ok: true } };
      }
      return { status: 409, body: { outcome: 'not_sent', error: `fixture: ${op} is not modelled` } };
    },
    answer(req) {
      const ok = (body) => ({ status: 200, body });
      switch (req.kind) {
        case 'notes': return ok({ notes: (state.notes[req.contact] ?? []).map((x) => ({ ...x })) });
        case 'detail': return SELLERS[req.contact] ? ok({ contact: { ...contact(req.contact), ...ADDRESS, customFields: [] } }) : { status: 404, body: { error: 'fixture: unknown contact' } };
        case 'row': return SELLERS[req.contact] ? ok({ ...contact(req.contact), tags: [] }) : { status: 404, body: { error: 'fixture: unknown contact' } };
        case 'opp-read':
          return CONTACT_OF[req.target] && !state.gone.has(req.target) ? ok({ opportunity: { id: req.target, contactId: CONTACT_OF[req.target], customFields: oppFields(req.target, true) } }) : { status: 404, body: { error: 'fixture: unknown opportunity' } };
        case 'ghl-opportunities': return ok({ pipelineId: 'fixture-pipeline', stages: [], opportunities: Object.values(SELLERS).flatMap((s) => s.deals.filter(([id]) => !state.gone.has(id)).map(([id, name]) => row(id, name))) });
        case 'ghl-underwriting-policy': return ok({ values: POLICY_VALUES });
        case 'ghl-contact-conversations': return ok({ messages: [], conversations: [] });
        case 'defs': return ok({ customFields: [] });
        case 'folder': return ok({ customField: { id: 'folder', name: 'Folder', position: 0 } });
        default: return null;
      }
    },
  };
}

module.exports = { twoStageDeals, G, OPP_A, OPP_B, O, OPP_O, V, OPP_V, DEAL_B_REPAIRS };
