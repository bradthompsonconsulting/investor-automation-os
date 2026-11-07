/**
 * B15-27b two-deal fixture (offline, in memory) -- ONE contact holding TWO
 * Offer Ready deals with COINCIDENT figures, plus a hop contact with two plain
 * deals. Test-only; the shared seller-call-offer-ready-fixture.cjs is not
 * changed (its single-deal suites keep their exact fixture).
 *
 *   A  "Ready" (fixtureTwoDealContact) -- deals OPP1 "Ready deal" and OPP2
 *      "Ready deal 2". Each deal carries the same evidence notes the single-deal
 *      fixture seeds (ARV approval 650000 HIGH, property identity confirmed,
 *      transaction assumptions, seller price 425000), each bound to its own
 *      opportunity, and the same Opportunity fields (ARV 650000, Standard
 *      Minimum, Current Offer). Both deals therefore compute the SAME Max
 *      Supported Offer, so a deal-1 result applied to deal 2 is visible rather
 *      than masked by differing figures (the condition the B15-27 correction
 *      proposal recorded for S1: "likely only with coincident values").
 *   C  "Charlie" (fixtureHopContact) -- two plain deals. Seller Call has no
 *      in-page deal switcher: `chosenId` changes only through the deal picker
 *      and is never reset, so the one rendered route from deal 1 to deal 2 of
 *      the same contact on one mounted page is A/deal 1 -> C (pick a deal) ->
 *      A (picker shown again, since C's choice is not A's) -> pick deal 2.
 *
 * Writes for A are applied to A's in-memory notes / per-deal Current Offer /
 * contact fields and are visible on the next read; C is read-only.
 * Deterministic seed timestamps (2026-09-30Z).
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..', '..', '..');
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const { formatArvApprovalNote } = require(path.join(APP, 'src/lib/arv-persist.ts'));
const {
  formatPropertyIdentityConfirmationNote, formatTransactionAssumptionsNote, formatSellerPricePositionNote,
} = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));

const CONFIG = getConfig('test');
const IDS = {
  currentOffer: CONFIG.opportunityFacts.currentOffer,
  oppArv: CONFIG.opportunityFacts.arv,
  assignmentMode: CONFIG.opportunityFields.assignmentMode,
  contactRepairs: CONFIG.fields.estimatedRepairs,
  lastCallAttempt: CONFIG.fields.lastCallAttempt,
  lastCallAttemptPrecise: CONFIG.fields.lastCallAttemptPrecise,
};

const A = 'fixtureTwoDealContact';
const OPP1 = `${A}-opp`;
const OPP2 = `${A}-opp-2`;
const C = 'fixtureHopContact';
const C_OPP1 = `${C}-opp`;
const C_OPP2 = `${C}-opp-2`;
const FIRST = 'Ready';
const ARV = 650000;
const REPAIRS = 40000;
const SELLER_PRICE = 425000;
const ADDRESS = { address1: '123 Fixture Ln', city: 'Austin', state: 'TX', postalCode: '78701' };
/** Same composition as SellerCallWorkspace.tsx formatAddress(). */
const DISPLAY_ADDRESS = [ADDRESS.address1, [ADDRESS.city, [ADDRESS.state, ADDRESS.postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
const POLICY_HUMAN = {
  sellingCostPct: '10', closingCost: '2500', monthlyCarry: '500', holdMonths: '5', buyerProfitPct: '15',
  financingEnabled: 'On', financingLtv: '70', financingRate: '12', financingPoints: '2', standardMinimum: '5000', profitSharePct: '25',
};
const POLICY_VALUES = Object.entries(POLICY_HUMAN).map(([k, value]) => ({ id: CONFIG.customValues[k], value }));

function dealNotes(opp, tag) {
  const n = (id, body) => ({ id: `${tag}-${id}`, body, dateAdded: '2026-09-30T15:00:00.000Z' });
  return [
    n('arv', formatArvApprovalNote(
      { kind: 'approved', amount: ARV, recommendedArv: ARV, revision: 1 },
      {
        approvedAt: '2026-09-30T15:00:00.000Z', operator: 'Brad Thompson', opportunityId: opp,
        evidenceState: 'HIGH', reconciliationOutcome: 'RECOMMENDED', acceptedCompCount: 5, searchLevel: 'STANDARD',
        source: { kind: 'PROPSTREAM_COMPARABLE_CSV', version: 'propstream-comparable-csv-v1', fileName: 'fixture-comps.csv', importedAt: '2026-09-30T14:55:00.000Z' },
      },
    )),
    n('identity', formatPropertyIdentityConfirmationNote({
      opportunityId: opp, at: '2026-09-30T15:01:00.000Z', operator: null, status: 'confirmed', address: DISPLAY_ADDRESS,
    })),
    n('transaction', formatTransactionAssumptionsNote({
      opportunityId: opp, at: '2026-09-30T15:02:00.000Z', operator: null,
      transactionStructure: { kind: 'value', value: 'Assignment of contract' },
      closingPossession: { kind: 'value', value: 'Close in 30 days; vacant at closing' },
      titleComplications: { kind: 'none' },
    })),
    n('seller-price', formatSellerPricePositionNote({
      opportunityId: opp, at: '2026-09-30T15:03:00.000Z', operator: null, kind: 'price', price: SELLER_PRICE,
    })),
  ];
}

function twoDeals() {
  let state;
  const oppFields = (opp, singular) => {
    const v = (id, value, key) => (singular ? { id, fieldValue: value } : { id, [key]: value });
    const offer = state.currentOffer[opp];
    return [
      v(IDS.oppArv, ARV, 'fieldValueNumber'),
      v(IDS.assignmentMode, 'Standard Minimum', 'fieldValueString'),
      ...(offer === null ? [] : [v(IDS.currentOffer, offer, 'fieldValueNumber')]),
    ];
  };
  const row = (id, contactId, contactName, opportunityName, customFields) => ({ id, contactId, contactName, opportunityName, phone: '', email: '', stageId: 'fixture-stage', customFields });
  const refuse = (status, error) => ({ status, error });
  return {
    name: 'twoDeals', A, OPP1, OPP2, C, C_OPP1, C_OPP2,
    /** `offer1` / `offer2` seed each deal's Current Offer (null = empty). */
    reset({ offer1 = null, offer2 = null } = {}) {
      state = {
        notes: [{ id: 'a-seed', body: `Seed note for ${FIRST}`, dateAdded: '2026-09-30T12:00:00.000Z' }, ...dealNotes(OPP1, 'd1'), ...dealNotes(OPP2, 'd2')],
        currentOffer: { [OPP1]: offer1, [OPP2]: offer2 },
        contactFields: [{ id: IDS.contactRepairs, value: REPAIRS }],
        created: 0,
      };
    },
    get state() { return state; },
    contactOf: (o) => (o === OPP1 || o === OPP2 ? A : o === C_OPP1 || o === C_OPP2 ? C : null),
    precheck(req) {
      if (req.op === 'opportunity.currentOffer') return req.contact === OPP1 || req.contact === OPP2 ? null : refuse(400, `fixture: unknown opportunity ${req.contact}`);
      if (req.op === 'note.create' || req.op === 'contact.lastCallAttempt') return req.contact === A ? null : refuse(400, `fixture: writes are modelled for ${A} only`);
      return refuse(400, `fixture does not model ${req.op}`);
    },
    applyWrite(op, target, args) {
      if (op === 'opportunity.currentOffer') { state.currentOffer[target] = args.value; return { status: 200, body: { confirmed: true } }; }
      if (op === 'note.create') {
        state.created += 1;
        state.notes.push({ id: `a-created-${state.created}`, body: args.body, dateAdded: new Date().toISOString() });
        return { status: 200, body: { confirmed: true, note: { id: `a-created-${state.created}` } } };
      }
      if (op === 'contact.lastCallAttempt') {
        state.contactFields = state.contactFields.filter((f) => f.id !== IDS.lastCallAttempt && f.id !== IDS.lastCallAttemptPrecise);
        state.contactFields.push({ id: IDS.lastCallAttempt, value: args.value.slice(0, 10) }, { id: IDS.lastCallAttemptPrecise, value: args.value });
        return { status: 200, body: { confirmed: true } };
      }
      return { status: 400, body: { error: `fixture does not model ${op}` } };
    },
    answer(req) {
      const ok = (body) => ({ status: 200, body });
      switch (req.kind) {
        case 'notes':
          return ok({ notes: req.contact === A ? state.notes.map((x) => ({ ...x })) : [{ id: 'c-seed', body: 'Seed note for Charlie', dateAdded: '2026-09-30T12:00:00.000Z' }] });
        case 'detail':
          return req.contact === A
            ? ok({ contact: { id: A, firstName: FIRST, lastName: 'Fixture', phone: '+15555550100', ...ADDRESS, customFields: state.contactFields.map((f) => ({ ...f })) } })
            : ok({ contact: { id: C, firstName: 'Charlie', lastName: 'Fixture', phone: '+15555550102', customFields: [] } });
        case 'row':
          return ok({ id: req.contact, firstName: req.contact === A ? FIRST : 'Charlie', lastName: 'Fixture', phone: '+15555550100', tags: [] });
        case 'opp-read':
          if (req.target === OPP1 || req.target === OPP2) return ok({ opportunity: { id: req.target, contactId: A, customFields: oppFields(req.target, true) } });
          if (req.target === C_OPP1 || req.target === C_OPP2) return ok({ opportunity: { id: req.target, contactId: C, customFields: [] } });
          return { status: 404, body: { error: 'fixture: unknown opportunity' } };
        case 'ghl-opportunities':
          return ok({ pipelineId: 'fixture-pipeline', stages: [], opportunities: [
            row(OPP1, A, FIRST, 'Ready deal', oppFields(OPP1, false)),
            row(OPP2, A, FIRST, 'Ready deal 2', oppFields(OPP2, false)),
            row(C_OPP1, C, 'Charlie', 'Charlie deal', []),
            row(C_OPP2, C, 'Charlie', 'Charlie deal 2', []),
          ] });
        case 'ghl-underwriting-policy': return ok({ values: POLICY_VALUES });
        case 'ghl-contact-conversations': return ok({ messages: [], conversations: [] });
        default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
      }
    },
  };
}

module.exports = { twoDeals, A, OPP1, OPP2, C, C_OPP1, C_OPP2 };
