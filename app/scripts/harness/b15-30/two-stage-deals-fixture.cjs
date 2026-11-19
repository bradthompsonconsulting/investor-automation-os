/**
 * B15-30 / INV-140 -- two local test deals for the SAME seller at different stages (offline, in memory; test-only).
 *
 *   Seller "Guide Fixture" (fixtureGuideContact), two deals. Both carry, bound to their own opportunity: an approved ARV
 *   (650000, HIGH), a confirmed property identity, transaction assumptions and a seller price (425000). The contact has
 *   NO repair seed, so nothing contact-wide can complete repairs for both deals.
 *
 *   Deal A (OPP_A "Deal A"): Assignment Mode "Standard Minimum", NO repair total. The test records a readiness
 *          OVERRIDE through the page's own control. Expected next step: Estimated Repairs (Underwriting) -- the
 *          override never replaces an input.
 *   Deal B (OPP_B "Deal B"): repair total 40000 saved on the deal's own Opportunity, NO Assignment Mode. Expected next
 *          step: Assignment Mode (Underwriting).
 *
 * Note writes (the override the test records) are applied to the in-memory notes and visible on the next read. Every
 * other write is refused (409 not_sent). Deterministic seed timestamps (2026-09-30Z). Synthetic and fictional.
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

function dealNotes(opp, tag) {
  const n = (id, body) => ({ id: `${tag}-${id}`, body, dateAdded: '2026-09-30T15:00:00.000Z' });
  return [
    n('arv', formatArvApprovalNote({ kind: 'approved', amount: ARV, recommendedArv: ARV, revision: 1 }, {
      approvedAt: '2026-09-30T15:00:00.000Z', operator: 'Fixture Operator', opportunityId: opp,
      evidenceState: 'HIGH', reconciliationOutcome: 'RECOMMENDED', acceptedCompCount: 5, searchLevel: 'STANDARD',
      source: { kind: 'PROPSTREAM_COMPARABLE_CSV', version: 'propstream-comparable-csv-v1', fileName: 'fixture-comps.csv', importedAt: '2026-09-30T14:55:00.000Z' },
    })),
    n('identity', formatPropertyIdentityConfirmationNote({ opportunityId: opp, at: '2026-09-30T15:01:00.000Z', operator: null, status: 'confirmed', address: DISPLAY_ADDRESS })),
    n('transaction', formatTransactionAssumptionsNote({ opportunityId: opp, at: '2026-09-30T15:02:00.000Z', operator: null,
      transactionStructure: { kind: 'value', value: 'Assignment of contract' }, closingPossession: { kind: 'value', value: 'Close in 30 days; vacant at closing' }, titleComplications: { kind: 'none' } })),
    n('seller-price', formatSellerPricePositionNote({ opportunityId: opp, at: '2026-09-30T15:03:00.000Z', operator: null, kind: 'price', price: SELLER_PRICE })),
  ];
}

function twoStageDeals() {
  let state;
  const oppFields = (opp, singular) => {
    const v = (id, value, key) => (singular ? { id, fieldValue: value } : { id, [key]: value });
    return opp === OPP_A
      ? [v(IDS.oppArv, ARV, 'fieldValueNumber'), v(IDS.assignmentMode, 'Standard Minimum', 'fieldValueString')]
      : [v(IDS.oppArv, ARV, 'fieldValueNumber'), v(IDS.oppRepairs, DEAL_B_REPAIRS, 'fieldValueNumber')];
  };
  const row = (id, name) => ({ id, contactId: G, contactName: 'Guide', opportunityName: name, phone: '', email: '', stageId: 'fixture-stage', customFields: oppFields(id, false) });
  return {
    G, OPP_A, OPP_B,
    reset() { state = { notes: [{ id: 'g-seed', body: 'Seed note for Guide', dateAdded: '2026-09-30T12:00:00.000Z' }, ...dealNotes(OPP_A, 'da'), ...dealNotes(OPP_B, 'db')], created: 0 }; },
    get state() { return state; },
    contactOf: (o) => (o === OPP_A || o === OPP_B ? G : null),
    write(op, target, args) {
      if (op === 'note.create' && target === G) {
        state.created += 1;
        state.notes.push({ id: `g-created-${state.created}`, body: args.body, dateAdded: new Date().toISOString() });
        return { status: 200, body: { confirmed: true, note: { id: `g-created-${state.created}` } } };
      }
      return { status: 409, body: { outcome: 'not_sent', error: `fixture: ${op} is not modelled` } };
    },
    answer(req) {
      const ok = (body) => ({ status: 200, body });
      switch (req.kind) {
        case 'notes': return ok({ notes: req.contact === G ? state.notes.map((x) => ({ ...x })) : [] });
        case 'detail': return ok({ contact: { id: G, firstName: 'Guide', lastName: 'Fixture', phone: '+15555550177', ...ADDRESS, customFields: [] } });
        case 'row': return ok({ id: G, firstName: 'Guide', lastName: 'Fixture', phone: '+15555550177', tags: [] });
        case 'opp-read':
          return req.target === OPP_A || req.target === OPP_B ? ok({ opportunity: { id: req.target, contactId: G, customFields: oppFields(req.target, true) } }) : { status: 404, body: { error: 'fixture: unknown opportunity' } };
        case 'ghl-opportunities': return ok({ pipelineId: 'fixture-pipeline', stages: [], opportunities: [row(OPP_A, 'Deal A'), row(OPP_B, 'Deal B')] });
        case 'ghl-underwriting-policy': return ok({ values: POLICY_VALUES });
        case 'ghl-contact-conversations': return ok({ messages: [], conversations: [] });
        case 'defs': return ok({ customFields: [] });
        case 'folder': return ok({ customField: { id: 'folder', name: 'Folder', position: 0 } });
        default: return null;
      }
    },
  };
}

module.exports = { twoStageDeals, G, OPP_A, OPP_B, DEAL_B_REPAIRS };
