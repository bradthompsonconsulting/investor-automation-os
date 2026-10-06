/**
 * Board 15 -- an OFFLINE, in-memory GHL fixture for ONE Seller Call deal that
 * is objectively OFFER_READY, so Confirm Accept can be exercised end to end in
 * the contact-isolation harness.
 *
 * Route to OFFER_READY: the OBJECTIVE one -- all six Offer Readiness
 * categories SUPPORTED, no human approval/override note at all
 * (readinessHumanAction stays { kind: "none" }, so readinessDecisionCurrency
 * and the invalidation effect never engage and the page writes nothing on
 * load). Every evidence note is produced by the app's OWN formatter, so the
 * formats are exact:
 *
 *   deal economics     board8 "calculated" with a calculated Target: ARV on the
 *                      Opportunity (650000), repairs on the Contact seed
 *                      (estimated_repairs 40000), assignment mode "Standard
 *                      Minimum", and all eleven investor-policy Custom Values
 *                      served by ghl-underwriting-policy (PB-D56 starter values,
 *                      human units) -> Max Supported Offer ~$416,830, Target
 *                      ~$397,455.
 *   repairs/condition  repairs resolve from the Contact seed only (no
 *                      opportunity.repair_estimate), i.e. the approval-gated
 *                      side of seed-then-supersede.
 *   ARV                formatArvApprovalNote: APPROVED 650000, Evidence HIGH,
 *                      for this opportunity; the Opportunity ARV field holds the
 *                      same 650000 (what persistApprovedArv writes first).
 *   property identity  formatPropertyIdentityConfirmationNote, status confirmed,
 *                      address == the page's formatAddress(contact).
 *   transaction        formatTransactionAssumptionsNote (three values).
 *   seller price       formatSellerPricePositionNote, price 425000.
 *
 * Server rules mirrored from netlify/functions (the real ones, imported):
 *   - ghl-write opportunity.currentOffer: 409 "Current Offer is frozen or
 *     invalid" once the latest outcome note for the opportunity is an accept
 *     (currentOfferWriteGate, exactly as ghl-write.ts:115).
 *   - ghl-write note.create of an outcome note (write-note-guard.ts): 409 if an
 *     accept is already recorded ("Agreement is already recorded"); an accept
 *     must carry snapshot.currentOffer === the opportunity's Current Offer.
 *   - ghl-write contact.lastCallAttempt: stores last_call_attempt (date part)
 *     and last_call_attempt_precise (ISO) on the contact.
 * A created note is appended to the contact's note list, so a reload sees it.
 *
 * Deterministic: fixed ids, fixed note timestamps (2026-09-30Z), no clock use.
 * Requires the caller to have installed the .ts transpile hook (as the
 * existing browser tests do) before requiring this module.
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..', '..');
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const { formatArvApprovalNote } = require(path.join(APP, 'src/lib/arv-persist.ts'));
const {
  formatPropertyIdentityConfirmationNote, formatTransactionAssumptionsNote, formatSellerPricePositionNote,
} = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));
const { parseOutcomeNote, latestOutcomeNoteForOpportunity } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const { currentOfferWriteGate } = require(path.join(APP, 'src/lib/current-offer-carrier.ts'));

const CONFIG = getConfig('test');
const IDS = {
  currentOffer: CONFIG.opportunityFacts.currentOffer,
  oppArv: CONFIG.opportunityFacts.arv,
  assignmentMode: CONFIG.opportunityFields.assignmentMode,
  contactRepairs: CONFIG.fields.estimatedRepairs,
  lastCallAttempt: CONFIG.fields.lastCallAttempt,
  lastCallAttemptPrecise: CONFIG.fields.lastCallAttemptPrecise,
};

const CONTACT = 'fixtureReadyContact';
const OPP = `${CONTACT}-opp`;
const FIRST = 'Ready';
const ARV = 650000;
const REPAIRS = 40000;
const SELLER_PRICE = 425000;
const ADDRESS = { address1: '123 Fixture Ln', city: 'Austin', state: 'TX', postalCode: '78701' };
/** Same composition as SellerCallWorkspace.tsx formatAddress(). */
const DISPLAY_ADDRESS = [ADDRESS.address1, [ADDRESS.city, [ADDRESS.state, ADDRESS.postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');

/** PB-D56 starter values, in GHL's human units, served as investor policy. */
const POLICY_HUMAN = {
  sellingCostPct: '10', closingCost: '2500', monthlyCarry: '500', holdMonths: '5', buyerProfitPct: '15',
  financingEnabled: 'On', financingLtv: '70', financingRate: '12', financingPoints: '2', standardMinimum: '5000', profitSharePct: '25',
};
const POLICY_VALUES = Object.entries(POLICY_HUMAN).map(([k, value]) => ({ id: CONFIG.customValues[k], value }));

function seedNotes() {
  const n = (id, body) => ({ id, body, dateAdded: '2026-09-30T15:00:00.000Z' });
  return [
    n('ready-n-seed', `Seed note for ${FIRST}`),
    n('ready-n-arv', formatArvApprovalNote(
      { kind: 'approved', amount: ARV, recommendedArv: ARV, revision: 1 },
      {
        approvedAt: '2026-09-30T15:00:00.000Z', operator: 'Brad Thompson', opportunityId: OPP,
        evidenceState: 'HIGH', reconciliationOutcome: 'RECOMMENDED', acceptedCompCount: 5, searchLevel: 'STANDARD',
        source: { kind: 'PROPSTREAM_COMPARABLE_CSV', version: 'propstream-comparable-csv-v1', fileName: 'fixture-comps.csv', importedAt: '2026-09-30T14:55:00.000Z' },
      },
    )),
    n('ready-n-identity', formatPropertyIdentityConfirmationNote({
      opportunityId: OPP, at: '2026-09-30T15:01:00.000Z', operator: null, status: 'confirmed', address: DISPLAY_ADDRESS,
    })),
    n('ready-n-transaction', formatTransactionAssumptionsNote({
      opportunityId: OPP, at: '2026-09-30T15:02:00.000Z', operator: null,
      transactionStructure: { kind: 'value', value: 'Assignment of contract' },
      closingPossession: { kind: 'value', value: 'Close in 30 days; vacant at closing' },
      titleComplications: { kind: 'none' },
    })),
    n('ready-n-seller-price', formatSellerPricePositionNote({
      opportunityId: OPP, at: '2026-09-30T15:03:00.000Z', operator: null, kind: 'price', price: SELLER_PRICE,
    })),
  ];
}

let state;
/** Fresh fixture state. `currentOffer` seeds the Opportunity carrier (null = empty). */
function reset({ currentOffer = null } = {}) {
  state = {
    currentOffer,
    notes: seedNotes(),
    contactFields: [{ id: IDS.contactRepairs, value: REPAIRS }],
    createdNotes: 0,
  };
  return state;
}
reset();

const oppListRow = () => ({
  id: OPP, contactId: CONTACT, contactName: FIRST, opportunityName: `${FIRST} deal`, phone: '', email: '', stageId: 'fixture-stage',
  customFields: [
    { id: IDS.oppArv, fieldValueNumber: ARV },
    { id: IDS.assignmentMode, fieldValueString: 'Standard Minimum' },
    ...(state.currentOffer === null ? [] : [{ id: IDS.currentOffer, fieldValueNumber: state.currentOffer }]),
  ],
});
/** The singular GET shape: every dataType under `fieldValue`. */
const oppSingular = () => ({
  id: OPP, contactId: CONTACT,
  customFields: [
    { id: IDS.oppArv, fieldValue: ARV },
    { id: IDS.assignmentMode, fieldValue: 'Standard Minimum' },
    ...(state.currentOffer === null ? [] : [{ id: IDS.currentOffer, fieldValue: state.currentOffer }]),
  ],
});

function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post && post.operation, target: post && post.targetId, args: post && post.args };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    if ((m = p.match(/^\/opportunities\/([^/?]+)$/))) return { kind: 'opp-read', target: m[1] };
    return { kind: 'proxy-other', path: p };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}

const refuse = (status, error) => ({ status, body: { error } });

function answerWrite(req) {
  const args = req.args || {};
  if (req.op === 'opportunity.currentOffer') {
    if (req.target !== OPP) return refuse(400, `fixture: unknown opportunity ${req.target}`);
    const outcome = latestOutcomeNoteForOpportunity(state.notes, OPP);
    if (currentOfferWriteGate({ value: args.value, agreementAlreadyReached: outcome && outcome.kind === 'accept' }).kind !== 'allowed') {
      return refuse(409, 'Current Offer is frozen or invalid');
    }
    state.currentOffer = args.value;
    return { status: 200, body: { confirmed: true } };
  }
  if (req.op === 'note.create') {
    if (req.target !== CONTACT) return refuse(400, `fixture: unknown contact ${req.target}`);
    const outcome = parseOutcomeNote(args.body);
    if (outcome) {
      if (outcome.opportunityId !== OPP) return refuse(409, 'Write refused or unconfirmed; refresh and inspect before retrying');
      const previous = latestOutcomeNoteForOpportunity(state.notes, OPP);
      if (previous && previous.kind === 'accept') return refuse(409, 'Write refused or unconfirmed; refresh and inspect before retrying'); // server: "Agreement is already recorded"
      if (outcome.kind === 'accept' && (typeof state.currentOffer !== 'number' || state.currentOffer <= 0 || outcome.snapshot.currentOffer !== state.currentOffer)) {
        return refuse(409, 'Write refused or unconfirmed; refresh and inspect before retrying'); // server: "Accepted price must match confirmed Current Offer"
      }
    }
    state.createdNotes += 1;
    const note = { id: `ready-created-${state.createdNotes}`, body: args.body, dateAdded: '2026-10-01T15:00:00.000Z' };
    state.notes.push(note);
    return { status: 200, body: { confirmed: true, note: { id: note.id } } };
  }
  if (req.op === 'contact.lastCallAttempt') {
    if (req.target !== CONTACT || typeof args.value !== 'string') return refuse(400, 'fixture: bad lastCallAttempt');
    state.contactFields = state.contactFields.filter((f) => f.id !== IDS.lastCallAttempt && f.id !== IDS.lastCallAttemptPrecise);
    state.contactFields.push({ id: IDS.lastCallAttempt, value: args.value.slice(0, 10) }, { id: IDS.lastCallAttemptPrecise, value: args.value });
    return { status: 200, body: { confirmed: true } };
  }
  return refuse(400, `fixture does not model ${req.op}`);
}

function answer(req) {
  switch (req.kind) {
    case 'write': return answerWrite(req);
    case 'opp-read':
      if (req.target !== OPP) return refuse(404, 'fixture: unknown opportunity');
      return { status: 200, body: { opportunity: oppSingular() } };
    case 'notes':
      return { status: 200, body: { notes: req.contact === CONTACT ? state.notes.map((x) => ({ ...x })) : [] } };
    case 'detail':
      return { status: 200, body: { contact: { id: req.contact, firstName: FIRST, lastName: 'Fixture', phone: '+15555550100', ...ADDRESS, customFields: state.contactFields.map((f) => ({ ...f })) } } };
    case 'row': return { status: 200, body: { id: req.contact, firstName: FIRST, lastName: 'Fixture', phone: '+15555550100', tags: [] } };
    case 'ghl-opportunities': return { status: 200, body: { pipelineId: 'fixture-pipeline', stages: [], opportunities: [oppListRow()] } };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: POLICY_VALUES } };
    case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
    default: return refuse(404, `fixture does not model ${req.kind}`);
  }
}

module.exports = {
  CONTACT, OPP, FIRST, ARV, REPAIRS, SELLER_PRICE, DISPLAY_ADDRESS, IDS, POLICY_VALUES,
  reset, classify, answer,
  get state() { return state; },
};
