/**
 * B15-30 Previous / Next (Captain 2026-11-20) -- two local test deals for ONE seller, resumed partway (offline, in
 * memory; test-only; synthetic and fictional).
 *
 *   Seller "Nav Fixture" (fixtureNavContact), two deals. Both carry, bound to their own opportunity: an approved ARV
 *   (HIGH), a confirmed property identity and transaction assumptions; on the Opportunity an ARV, a repair total and an
 *   Assignment Mode; Investor Policy is complete.
 *     Deal A (OPP_A): ALSO a seller price -- every input recorded: resumed at "7 of 8 steps done", the offer review next.
 *     Deal B (OPP_B): NO seller price -- resumed at "6 of 8 steps done", the seller's price position next.
 *
 *     Deal C (OPP_C, "Probe deal") -- the IAOS Test Probe state (Captain 2026-11-20): Agreement Reached at $415,000 and its
 *            Contract Ready checklist COMPLETE, Current Offer EMPTY, and no seller's price recorded (which is why the
 *            release's Guided Next sent Brad to the seller's price). Expected: "Next: open Contract Ready".
 *
 * EVERY write is refused (409 not_sent) and counted: navigation must make none.
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..', '..', '..');
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const { formatArvApprovalNote } = require(path.join(APP, 'src/lib/arv-persist.ts'));
const { formatPropertyIdentityConfirmationNote, formatTransactionAssumptionsNote, formatSellerPricePositionNote, formatContractReadyChecklistNote } = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));
const { formatOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));

const CONFIG = getConfig('test');
const N = 'fixtureNavContact';
const OPP_A = `${N}-deal-a`;
const OPP_B = `${N}-deal-b`;
const OPP_C = `${N}-deal-c`;
const AGREED = 415000;
const ADDRESS = { address1: '9 Navigation Way', city: 'Austin', state: 'TX', postalCode: '78704' };
const DISPLAY = '9 Navigation Way, Austin, TX, 78704';
const POLICY = Object.entries({ sellingCostPct: '10', closingCost: '2500', monthlyCarry: '500', holdMonths: '5', buyerProfitPct: '15', financingEnabled: 'On',
  financingLtv: '70', financingRate: '12', financingPoints: '2', standardMinimum: '5000', profitSharePct: '25' }).map(([k, value]) => ({ id: CONFIG.customValues[k], value }));

function dealNotes(opp, tag, { sellerPrice }) {
  const n = (id, body, at) => ({ id: `${tag}-${id}`, body, dateAdded: at });
  return [
    n('arv', formatArvApprovalNote({ kind: 'approved', amount: 650000, recommendedArv: 650000, revision: 1 }, {
      approvedAt: '2026-11-18T15:00:00.000Z', operator: 'Fixture Operator', opportunityId: opp, evidenceState: 'HIGH', reconciliationOutcome: 'RECOMMENDED',
      acceptedCompCount: 5, searchLevel: 'STANDARD', source: { kind: 'PROPSTREAM_COMPARABLE_CSV', version: 'propstream-comparable-csv-v1', fileName: 'fixture-comps.csv', importedAt: '2026-11-18T14:55:00.000Z' },
    }), '2026-11-18T15:00:00.000Z'),
    n('identity', formatPropertyIdentityConfirmationNote({ opportunityId: opp, at: '2026-11-18T15:01:00.000Z', operator: null, status: 'confirmed', address: DISPLAY }), '2026-11-18T15:01:00.000Z'),
    n('transaction', formatTransactionAssumptionsNote({ opportunityId: opp, at: '2026-11-18T15:02:00.000Z', operator: null,
      transactionStructure: { kind: 'value', value: 'Assignment of contract' }, closingPossession: { kind: 'value', value: 'Close in 30 days; vacant at closing' }, titleComplications: { kind: 'none' } }), '2026-11-18T15:02:00.000Z'),
    ...(sellerPrice ? [n('price', formatSellerPricePositionNote({ opportunityId: opp, at: '2026-11-18T15:03:00.000Z', operator: null, kind: 'price', price: 425000 }), '2026-11-18T15:03:00.000Z')] : []),
  ];
}

/** Deal C: the agreement and its complete checklist, bound to the agreement's own timestamp, price and address. */
function agreementNotes(opp) {
  const at = '2026-11-19T17:00:00.000Z';
  return [
    { id: 'nc-accept', dateAdded: at, body: formatOutcomeNote({ opportunityId: opp, kind: 'accept', at, operator: null, followUpAt: null, reason: null,
      snapshot: { sellerPosition: null, currentOffer: AGREED, targetAcquisitionPrice: null, maxSupportedOffer: null, expectedSpread: null, arv: 650000, repairs: 40000, readinessStatus: 'OFFER_READY' } }) },
    { id: 'nc-checklist', dateAdded: '2026-11-19T17:30:00.000Z', body: formatContractReadyChecklistNote({ opportunityId: opp, at: '2026-11-19T17:30:00.000Z', operator: null, agreementAt: at,
      agreedPrice: AGREED, propertyAddress: DISPLAY, items: { legal_owners: true, closing_timeline: true, occupancy_possession: true, liens_title: true, delivery_signing: true } }) },
  ];
}

function navDeals() {
  const notes = [{ id: 'nav-seed', body: 'Seed note for Nav', dateAdded: '2026-11-18T12:00:00.000Z' }, ...dealNotes(OPP_A, 'na', { sellerPrice: true }), ...dealNotes(OPP_B, 'nb', { sellerPrice: false }),
    ...dealNotes(OPP_C, 'nc', { sellerPrice: false }), ...agreementNotes(OPP_C)];
  const oppFields = (singular) => {
    const v = (id, value, key) => (singular ? { id, fieldValue: value } : { id, [key]: value });
    return [v(CONFIG.opportunityFacts.arv, 650000, 'fieldValueNumber'), v(CONFIG.opportunityFacts.repairs, 40000, 'fieldValueNumber'), v(CONFIG.opportunityFields.assignmentMode, 'Standard Minimum', 'fieldValueString')];
  };
  const contact = { id: N, firstName: 'Nav', lastName: 'Fixture', phone: '+15555550191' };
  return {
    N, OPP_A, OPP_B, OPP_C,
    contactOf: (o) => (o === OPP_A || o === OPP_B || o === OPP_C ? N : null),
    answer(req) {
      const ok = (body) => ({ status: 200, body });
      switch (req.kind) {
        case 'notes': return ok({ notes: req.contact === N ? notes.map((x) => ({ ...x })) : [] });
        case 'detail': return ok({ contact: { ...contact, ...ADDRESS, customFields: [] } });
        case 'row': return ok({ ...contact, tags: [] });
        case 'opp-read': return req.target === OPP_A || req.target === OPP_B || req.target === OPP_C ? ok({ opportunity: { id: req.target, contactId: N, customFields: oppFields(true) } }) : { status: 404, body: { error: 'unknown' } };
        case 'ghl-opportunities': return ok({ pipelineId: 'p', stages: [], opportunities: [OPP_A, OPP_B, OPP_C].map((id, i) => ({ id, contactId: N, contactName: 'Nav', opportunityName: ['Deal A', 'Deal B', 'Probe deal'][i], phone: '', email: '', stageId: 's', customFields: oppFields(false) })) });
        case 'ghl-underwriting-policy': return ok({ values: POLICY });
        case 'ghl-contact-conversations': return ok({ messages: [], conversations: [] });
        case 'defs': return ok({ customFields: [] });
        case 'folder': return ok({ customField: { id: 'folder', name: 'Folder', position: 0 } });
        default: return null;
      }
    },
  };
}

module.exports = { navDeals, N, OPP_A, OPP_B, OPP_C, AGREED };
