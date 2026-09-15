/**
 * One-/Two-Seller signer-cardinality model -- test runner. INV-67 Phase 1
 * (this session). Compiles contract-seller-signing-model.ts standalone,
 * loads the emitted JavaScript, and runs deterministic table-driven cases
 * over every pure function: normalization, the fifteen individual gates,
 * the aggregator, and the Seller 1 resolver. No GHL, no network, no React.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-seller-signing-model-test');
const MODULE = path.join(APP, 'src', 'lib', 'contract-seller-signing-model.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(`npx tsc "${MODULE}" --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const M = require(path.join(TMP, 'contract-seller-signing-model.js'));

const FLOOR = 126;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.log('FAIL  ' + name);
    console.log('      expected: ' + JSON.stringify(expected));
    console.log('      actual:   ' + JSON.stringify(actual));
  }
}
function checkTrue(name, actual) { check(name, actual, true); }
function checkNull(name, actual) { check(name, actual, null); }

/* ==================================================================== */
/* Normalization                                                         */
/* ==================================================================== */

check('normalizeEmail trims and lowercases', M.normalizeEmail('  Jane@Example.COM  '), 'jane@example.com');
check('normalizeEmail is idempotent', M.normalizeEmail(M.normalizeEmail('Jane@Example.COM')), 'jane@example.com');
checkTrue('isValidEmailFormat accepts a plain address', M.isValidEmailFormat('jane@example.com'));
checkTrue('isValidEmailFormat rejects a missing @', M.isValidEmailFormat('jane.example.com') === false);
checkTrue('isValidEmailFormat rejects a missing domain dot', M.isValidEmailFormat('jane@example') === false);
checkTrue('isValidEmailFormat rejects an embedded space', M.isValidEmailFormat('jane doe@example.com') === false);
checkTrue('isValidEmailFormat rejects an empty string', M.isValidEmailFormat('') === false);

check('normalizeNameForComparison trims', M.normalizeNameForComparison('  Jane Doe  '), 'jane doe');
check('normalizeNameForComparison collapses repeated internal whitespace', M.normalizeNameForComparison('Jane    Doe'), 'jane doe');
check('normalizeNameForComparison lowercases', M.normalizeNameForComparison('JANE DOE'), 'jane doe');
checkTrue('namesMatchStrictly: identical after trim/collapse/case', M.namesMatchStrictly('  Jane   Doe ', 'jane doe'));
checkTrue('namesMatchStrictly: punctuation difference is NOT a match (no fuzzy matching)', M.namesMatchStrictly('Jane A. Doe', 'Jane Doe') === false);
checkTrue('namesMatchStrictly: middle name difference is NOT a match', M.namesMatchStrictly('Jane Ann Doe', 'Jane Doe') === false);
checkTrue('namesMatchStrictly: suffix difference is NOT a match', M.namesMatchStrictly('Jane Doe Jr.', 'Jane Doe') === false);
checkTrue('namesMatchStrictly: abbreviation difference is NOT a match', M.namesMatchStrictly('Jane Doe', 'J. Doe') === false);

/* ==================================================================== */
/* Transport derivation                                                  */
/* ==================================================================== */

check('sellerCountTransportValue: one_seller', M.sellerCountTransportValue({ kind: 'one_seller', seller1Capacity: 'individual_own_capacity' }), 'One Seller');
check('sellerCountTransportValue: two_sellers', M.sellerCountTransportValue({ kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: 'x', email: 'x@x.com' }, seller2Capacity: 'individual_own_capacity' }), 'Two Sellers');
check('SELLER_COUNT_ONE_SELLER_VALUE constant', M.SELLER_COUNT_ONE_SELLER_VALUE, 'One Seller');
check('SELLER_COUNT_TWO_SELLERS_VALUE constant', M.SELLER_COUNT_TWO_SELLERS_VALUE, 'Two Sellers');

/* ==================================================================== */
/* Gate 1: seller count disposition                                      */
/* ==================================================================== */

checkNull('checkSellerCountResolved: populated passes', M.checkSellerCountResolved({ kind: 'populated', value: { kind: 'one_seller', seller1Capacity: 'individual_own_capacity' } }));
checkTrue('checkSellerCountResolved: unresolved blocks', typeof M.checkSellerCountResolved({ kind: 'unresolved' }) === 'string');
checkTrue('checkSellerCountResolved: not_applicable blocks', typeof M.checkSellerCountResolved({ kind: 'not_applicable' }) === 'string');

/* ==================================================================== */
/* Seller 1 resolution (gates 2/3/4)                                     */
/* ==================================================================== */

const SELLER1_OK = { contactId: 'contact-1', contactName: 'Jane Seller', email: 'jane.seller@example.com' };
check('resolveSeller1FromOpportunity: happy path', M.resolveSeller1FromOpportunity(SELLER1_OK), { ok: true, contactId: 'contact-1', name: 'Jane Seller', email: 'jane.seller@example.com' });
checkTrue('resolveSeller1FromOpportunity: null opportunity fails, distinct reason', M.resolveSeller1FromOpportunity(null).ok === false && /could not be found/.test(M.resolveSeller1FromOpportunity(null).reason));
checkTrue('resolveSeller1FromOpportunity: blank contactId fails, distinct reason', M.resolveSeller1FromOpportunity({ ...SELLER1_OK, contactId: '' }).ok === false && /No primary Contact is bound/.test(M.resolveSeller1FromOpportunity({ ...SELLER1_OK, contactId: '' }).reason));
checkTrue('resolveSeller1FromOpportunity: blank name fails, distinct reason', M.resolveSeller1FromOpportunity({ ...SELLER1_OK, contactName: '' }).ok === false && /name is missing/.test(M.resolveSeller1FromOpportunity({ ...SELLER1_OK, contactName: '' }).reason));
checkTrue('resolveSeller1FromOpportunity: blank email fails, distinct reason', M.resolveSeller1FromOpportunity({ ...SELLER1_OK, email: '' }).ok === false && /email is missing or invalid/.test(M.resolveSeller1FromOpportunity({ ...SELLER1_OK, email: '' }).reason));
checkTrue('resolveSeller1FromOpportunity: malformed email fails', M.resolveSeller1FromOpportunity({ ...SELLER1_OK, email: 'not-an-email' }).ok === false);
{
  const nullReason = M.checkSeller1Resolved(M.resolveSeller1FromOpportunity(null));
  const blankContactReason = M.checkSeller1Resolved(M.resolveSeller1FromOpportunity({ ...SELLER1_OK, contactId: '' }));
  checkTrue('gate 2 (no bound Contact) and gate 3 (opportunity not found) produce DISTINCT messages, never conflated', nullReason !== blankContactReason);
}
checkNull('checkSeller1Resolved: ok resolution passes', M.checkSeller1Resolved(M.resolveSeller1FromOpportunity(SELLER1_OK)));

/* ==================================================================== */
/* Gates 5/6 and 10/11: signing capacity, shared function, both sellers  */
/* ==================================================================== */

checkNull('checkSigningCapacity: individual_own_capacity passes (Seller 1)', M.checkSigningCapacity('individual_own_capacity', 'Seller 1'));
checkNull('checkSigningCapacity: individual_own_capacity passes (Seller 2)', M.checkSigningCapacity('individual_own_capacity', 'Seller 2'));
checkTrue('checkSigningCapacity: unresolved blocks with a distinct message', /Confirm Seller 1/.test(M.checkSigningCapacity('unresolved', 'Seller 1')));
checkTrue('checkSigningCapacity: unsupported_capacity blocks with a DIFFERENT distinct message', /natural-person-only/.test(M.checkSigningCapacity('unsupported_capacity', 'Seller 1')));
checkTrue('checkSigningCapacity: unresolved and unsupported_capacity never share the same message', M.checkSigningCapacity('unresolved', 'Seller 1') !== M.checkSigningCapacity('unsupported_capacity', 'Seller 1'));
checkTrue('checkSigningCapacity: Seller 1 and Seller 2 labels never collide', M.checkSigningCapacity('unresolved', 'Seller 1') !== M.checkSigningCapacity('unresolved', 'Seller 2'));

/* ==================================================================== */
/* Gates 7/8/9: Seller 2 name, email format, duplicate email             */
/* ==================================================================== */

checkNull('checkSeller2LegalName: non-blank passes', M.checkSeller2LegalName('Jane Doe'));
checkTrue('checkSeller2LegalName: blank blocks', typeof M.checkSeller2LegalName('') === 'string');
checkTrue('checkSeller2LegalName: whitespace-only blocks', typeof M.checkSeller2LegalName('   ') === 'string');

checkNull('checkSeller2EmailFormat: valid passes', M.checkSeller2EmailFormat('jane@example.com'));
checkTrue('checkSeller2EmailFormat: blank blocks with its own message', /required/.test(M.checkSeller2EmailFormat('')));
checkTrue('checkSeller2EmailFormat: malformed blocks with a DIFFERENT message', /valid email/.test(M.checkSeller2EmailFormat('not-an-email')));
checkTrue('checkSeller2EmailFormat: blank vs malformed produce distinct messages', M.checkSeller2EmailFormat('') !== M.checkSeller2EmailFormat('not-an-email'));

checkNull('checkSellerEmailsDistinct: different emails pass', M.checkSellerEmailsDistinct('seller1@example.com', 'seller2@example.com'));
checkTrue('checkSellerEmailsDistinct: identical emails block', typeof M.checkSellerEmailsDistinct('same@example.com', 'same@example.com') === 'string');
checkTrue('checkSellerEmailsDistinct: case-difference duplicate blocks after normalization', typeof M.checkSellerEmailsDistinct('Jane@Example.com', 'jane@example.com') === 'string');
checkTrue('checkSellerEmailsDistinct: whitespace-difference duplicate blocks after normalization', typeof M.checkSellerEmailsDistinct(' jane@example.com ', 'jane@example.com') === 'string');

/* ==================================================================== */
/* Gate 12: printed cardinality                                          */
/* ==================================================================== */

const ONE_SELLER_MODEL = { kind: 'one_seller', seller1Capacity: 'individual_own_capacity' };
const TWO_SELLERS_MODEL = { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: 'Jane Doe', email: 'jane@example.com' }, seller2Capacity: 'individual_own_capacity' };

checkNull('checkPrintedSellerCardinality: one_seller with 1 printed passes', M.checkPrintedSellerCardinality(ONE_SELLER_MODEL, 1));
checkTrue('checkPrintedSellerCardinality: one_seller with 0 printed blocks', typeof M.checkPrintedSellerCardinality(ONE_SELLER_MODEL, 0) === 'string');
checkTrue('checkPrintedSellerCardinality: one_seller with 2 printed blocks', typeof M.checkPrintedSellerCardinality(ONE_SELLER_MODEL, 2) === 'string');
checkNull('checkPrintedSellerCardinality: two_sellers with 2 printed passes', M.checkPrintedSellerCardinality(TWO_SELLERS_MODEL, 2));
checkTrue('checkPrintedSellerCardinality: two_sellers with 1 printed blocks', typeof M.checkPrintedSellerCardinality(TWO_SELLERS_MODEL, 1) === 'string');
checkTrue('checkPrintedSellerCardinality: two_sellers with 3 printed blocks', typeof M.checkPrintedSellerCardinality(TWO_SELLERS_MODEL, 3) === 'string');

/* ==================================================================== */
/* Gate 13: strict printed-name matching, per seller position            */
/* ==================================================================== */

checkNull('checkPrintedSellerNameMatch: exact match after normalization passes', M.checkPrintedSellerNameMatch('Seller 1', 'Jane Doe', 'jane   doe'));
checkTrue('checkPrintedSellerNameMatch: punctuation mismatch fails, states both values', (() => { const r = M.checkPrintedSellerNameMatch('Seller 1', 'Jane A. Doe', 'Jane Doe'); return typeof r === 'string' && r.includes('Jane A. Doe') && r.includes('Jane Doe'); })());
checkTrue('checkPrintedSellerNameMatch: middle-name mismatch fails', typeof M.checkPrintedSellerNameMatch('Seller 2', 'Jane Ann Doe', 'Jane Doe') === 'string');
checkTrue('checkPrintedSellerNameMatch: suffix mismatch fails', typeof M.checkPrintedSellerNameMatch('Seller 1', 'Jane Doe Jr.', 'Jane Doe') === 'string');
checkTrue('checkPrintedSellerNameMatch: abbreviation mismatch fails', typeof M.checkPrintedSellerNameMatch('Seller 1', 'Jane Doe', 'J. Doe') === 'string');
checkTrue('checkPrintedSellerNameMatch: null printed name fails', typeof M.checkPrintedSellerNameMatch('Seller 1', 'Jane Doe', null) === 'string');

/* ==================================================================== */
/* Gates 14/15: Seller Count field provisioning and write/readback       */
/* ==================================================================== */

const SENTINEL = 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED';
checkTrue('checkSellerCountFieldProvisioned: sentinel value blocks', typeof M.checkSellerCountFieldProvisioned(SENTINEL, SENTINEL) === 'string');
checkTrue('checkSellerCountFieldProvisioned: blank id blocks', typeof M.checkSellerCountFieldProvisioned('', SENTINEL) === 'string');
checkNull('checkSellerCountFieldProvisioned: a real, non-sentinel id passes', M.checkSellerCountFieldProvisioned('real-field-id-123', SENTINEL));
checkTrue('checkSellerCountWriteReadbackVerified: false blocks', typeof M.checkSellerCountWriteReadbackVerified(false) === 'string');
checkNull('checkSellerCountWriteReadbackVerified: true passes', M.checkSellerCountWriteReadbackVerified(true));

/* ==================================================================== */
/* Aggregator -- evaluateSellerSigningReadiness                          */
/* ==================================================================== */

function baseInput(overrides) {
  return Object.assign(
    {
      disposition: { kind: 'populated', value: ONE_SELLER_MODEL },
      seller1: M.resolveSeller1FromOpportunity(SELLER1_OK),
      printedSellerSigners: [{ displayName: 'Jane Seller' }],
      sellerCountFieldId: 'real-field-id-123',
      sellerCountFieldSentinel: SENTINEL,
      sellerCountWriteReadbackVerified: true,
    },
    overrides || {},
  );
}

check('evaluateSellerSigningReadiness: full One-Seller happy path is ok:true', M.evaluateSellerSigningReadiness(baseInput()), { ok: true });

{
  const twoSellerSeller1 = M.resolveSeller1FromOpportunity(SELLER1_OK);
  const input = baseInput({
    disposition: { kind: 'populated', value: TWO_SELLERS_MODEL },
    printedSellerSigners: [{ displayName: 'Jane Seller' }, { displayName: 'Jane Doe' }],
  });
  check('evaluateSellerSigningReadiness: full Two-Seller happy path is ok:true', M.evaluateSellerSigningReadiness(input), { ok: true });
}

checkTrue('evaluateSellerSigningReadiness: unresolved count blocks with exactly one reason (nothing else can be evaluated)', (() => {
  const r = M.evaluateSellerSigningReadiness(baseInput({ disposition: { kind: 'unresolved' }, seller1: { ok: false, reason: 'irrelevant' } }));
  return r.ok === false && r.reasons.length === 2; // count-unresolved + seller1-not-ok, both independently reportable, nothing further evaluated
})());

checkTrue('evaluateSellerSigningReadiness: One-Seller path NEVER produces a Seller-2-shaped reason', (() => {
  const r = M.evaluateSellerSigningReadiness(baseInput());
  return r.ok === true; // already proven above; re-asserted here for the specific "no Seller 2 burden" claim
})());

checkTrue('evaluateSellerSigningReadiness: Two-Seller with missing Seller 2 name blocks, distinct reason present', (() => {
  const model = { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: '', email: 'jane@example.com' }, seller2Capacity: 'individual_own_capacity' };
  const r = M.evaluateSellerSigningReadiness(baseInput({ disposition: { kind: 'populated', value: model }, printedSellerSigners: [{ displayName: 'Jane Seller' }, { displayName: 'Jane Doe' }] }));
  return r.ok === false && r.reasons.some((x) => /legal name is required/.test(x));
})());

checkTrue('evaluateSellerSigningReadiness: Two-Seller with duplicate email blocks, distinct reason present', (() => {
  const model = { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: 'Jane Doe', email: SELLER1_OK.email }, seller2Capacity: 'individual_own_capacity' };
  const r = M.evaluateSellerSigningReadiness(baseInput({ disposition: { kind: 'populated', value: model }, printedSellerSigners: [{ displayName: 'Jane Seller' }, { displayName: 'Jane Doe' }] }));
  return r.ok === false && r.reasons.some((x) => /must be different from Seller 1/.test(x));
})());

checkTrue('evaluateSellerSigningReadiness: Seller 1 unresolved capacity blocks', (() => {
  const model = { kind: 'one_seller', seller1Capacity: 'unresolved' };
  const r = M.evaluateSellerSigningReadiness(baseInput({ disposition: { kind: 'populated', value: model } }));
  return r.ok === false && r.reasons.some((x) => /Confirm Seller 1/.test(x));
})());

checkTrue('evaluateSellerSigningReadiness: Seller 1 unsupported capacity blocks, distinct from unresolved', (() => {
  const model = { kind: 'one_seller', seller1Capacity: 'unsupported_capacity' };
  const r = M.evaluateSellerSigningReadiness(baseInput({ disposition: { kind: 'populated', value: model } }));
  return r.ok === false && r.reasons.some((x) => /natural-person-only/.test(x));
})());

checkTrue('evaluateSellerSigningReadiness: printed-count mismatch blocks and skips the name-match sub-check', (() => {
  const r = M.evaluateSellerSigningReadiness(baseInput({ printedSellerSigners: [] }));
  return r.ok === false && r.reasons.some((x) => /names 0 Sellers/.test(x)) && !r.reasons.some((x) => /does not match the printed contract/.test(x));
})());

checkTrue('evaluateSellerSigningReadiness: printed-name mismatch blocks once count agrees', (() => {
  const r = M.evaluateSellerSigningReadiness(baseInput({ printedSellerSigners: [{ displayName: 'Someone Else' }] }));
  return r.ok === false && r.reasons.some((x) => /does not match the printed contract/.test(x));
})());

checkTrue('evaluateSellerSigningReadiness: Seller Count field not provisioned blocks (the illustrated real-world-today scenario)', (() => {
  const r = M.evaluateSellerSigningReadiness(baseInput({ sellerCountFieldId: SENTINEL, sellerCountWriteReadbackVerified: false }));
  return r.ok === false && r.reasons.some((x) => /not yet provisioned/.test(x)) && r.reasons.some((x) => /has not been confirmed by a fresh readback/.test(x));
})());

checkTrue('evaluateSellerSigningReadiness: multiple simultaneous failures are ALL reported together, not just the first', (() => {
  const model = { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: '', email: 'not-an-email' }, seller2Capacity: 'unresolved' };
  const r = M.evaluateSellerSigningReadiness(baseInput({ disposition: { kind: 'populated', value: model }, printedSellerSigners: [{ displayName: 'Jane Seller' }, { displayName: 'Jane Doe' }] }));
  return r.ok === false && r.reasons.length >= 3;
})());

/* ==================================================================== */
/* INV-67 Phase 1 Jess re-gate correction -- canonical/transport split,  */
/* the pre-write gate, and the audit-evidence builder                    */
/* ==================================================================== */

check('evaluateSellerSigningCanonicalReadiness: fully ready input is ok:true', M.evaluateSellerSigningCanonicalReadiness(baseInput()), { ok: true });

checkTrue('evaluateSellerSigningCanonicalReadiness: ok:true EVEN WHEN the Seller Count field is still the sentinel -- canonical is independent of transport', (() => {
  const r = M.evaluateSellerSigningCanonicalReadiness(baseInput({ sellerCountFieldId: SENTINEL, sellerCountWriteReadbackVerified: false }));
  return r.ok === true;
})());

checkTrue('evaluateSellerSigningCanonicalReadiness: still blocks on a genuine model defect (Seller 1 capacity unresolved) regardless of transport state', (() => {
  const model = { kind: 'one_seller', seller1Capacity: 'unresolved' };
  const r = M.evaluateSellerSigningCanonicalReadiness(baseInput({ disposition: { kind: 'populated', value: model } }));
  return r.ok === false && r.reasons.some((x) => /signing capacity/.test(x));
})());

check('evaluateSellerSigningTransportReadiness: field provisioned + readback verified is ok:true', M.evaluateSellerSigningTransportReadiness({ sellerCountFieldId: 'real-field-id-123', sellerCountFieldSentinel: SENTINEL, sellerCountWriteReadbackVerified: true }), { ok: true });

checkTrue('evaluateSellerSigningTransportReadiness: sentinel field id blocks, independent of the model', (() => {
  const r = M.evaluateSellerSigningTransportReadiness({ sellerCountFieldId: SENTINEL, sellerCountFieldSentinel: SENTINEL, sellerCountWriteReadbackVerified: true });
  return r.ok === false && r.reasons.some((x) => /not yet provisioned/.test(x));
})());

checkTrue('evaluateSellerSigningTransportReadiness: provisioned but unverified readback blocks with its own distinct reason', (() => {
  const r = M.evaluateSellerSigningTransportReadiness({ sellerCountFieldId: 'real-field-id-123', sellerCountFieldSentinel: SENTINEL, sellerCountWriteReadbackVerified: false });
  return r.ok === false && r.reasons.length === 1 && /has not been confirmed by a fresh readback/.test(r.reasons[0]);
})());

check('evaluateSellerSigningPreWriteReadiness: a fully-ready input is ok:true', M.evaluateSellerSigningPreWriteReadiness(baseInput()), { ok: true });

checkTrue('evaluateSellerSigningPreWriteReadiness: IGNORES sellerCountWriteReadbackVerified -- ok:true even when passed false (gate 15 is post-write, not pre-write)', (() => {
  const r = M.evaluateSellerSigningPreWriteReadiness(baseInput({ sellerCountWriteReadbackVerified: false }));
  return r.ok === true;
})());

checkTrue('evaluateSellerSigningPreWriteReadiness: STILL blocks on the sentinel field id (gate 14 is pre-write)', (() => {
  const r = M.evaluateSellerSigningPreWriteReadiness(baseInput({ sellerCountFieldId: SENTINEL, sellerCountWriteReadbackVerified: false }));
  return r.ok === false && r.reasons.some((x) => /not yet provisioned/.test(x));
})());

checkTrue('evaluateSellerSigningPreWriteReadiness: STILL blocks on a genuine model defect', (() => {
  const r = M.evaluateSellerSigningPreWriteReadiness(baseInput({ disposition: { kind: 'unresolved' }, seller1: { ok: false, reason: 'irrelevant' } }));
  return r.ok === false;
})());

/* -------------------------------------------------- audit evidence ---- */

function evidenceArgs(overrides) {
  const base = baseInput();
  delete base.sellerCountWriteReadbackVerified;
  return Object.assign(base, { sellerCountWriteReadbackOk: null }, overrides || {});
}

{
  const e = M.buildSellerSigningAuditEvidence(evidenceArgs());
  check('buildSellerSigningAuditEvidence: One-Seller happy path -- sellerCountDiscriminator', e.sellerCountDiscriminator, 'one_seller');
  checkTrue('buildSellerSigningAuditEvidence: One-Seller happy path -- seller1Ok', e.seller1Ok === true);
  check('buildSellerSigningAuditEvidence: One-Seller happy path -- seller1ContactId', e.seller1ContactId, 'contact-1');
  check('buildSellerSigningAuditEvidence: One-Seller happy path -- seller1Capacity', e.seller1Capacity, 'individual_own_capacity');
  check('buildSellerSigningAuditEvidence: One-Seller happy path -- seller2 fields are all null', [e.seller2LegalName, e.seller2NormalizedEmail, e.seller2Capacity], [null, null, null]);
  checkTrue('buildSellerSigningAuditEvidence: One-Seller happy path -- printedPartyConsistencyOk', e.printedPartyConsistencyOk === true);
  check('buildSellerSigningAuditEvidence: One-Seller happy path -- expectedSellerCountTransportValue', e.expectedSellerCountTransportValue, 'One Seller');
  checkTrue('buildSellerSigningAuditEvidence: One-Seller happy path -- canonicalReadinessOk', e.canonicalReadinessOk === true);
  checkTrue('buildSellerSigningAuditEvidence: One-Seller happy path -- sellerCountFieldProvisioned', e.sellerCountFieldProvisioned === true);
  checkNull('buildSellerSigningAuditEvidence: sellerCountWriteReadbackOk is null when no write has been attempted yet', e.sellerCountWriteReadbackOk);
  check('buildSellerSigningAuditEvidence: effectiveDateStatus is always the fixed literal', e.effectiveDateStatus, 'pending_final_acceptance');
  check('buildSellerSigningAuditEvidence: recipientAssignmentStatus is always the fixed literal', e.recipientAssignmentStatus, 'pending_manual_review');
  checkTrue(
    'buildSellerSigningAuditEvidence: with no write attempted yet (sellerCountWriteReadbackOk:null), blockingReasons names ONLY the not-yet-confirmed readback gate -- everything else is genuinely clear',
    e.blockingReasons.length === 1 && /has not been confirmed by a fresh readback/.test(e.blockingReasons[0]),
  );
  check('buildSellerSigningAuditEvidence: sendOccurred is always false', e.sendOccurred, false);
}

{
  // The TRULY fully-ready case: canonical model ready, field provisioned,
  // AND this cycle's own write/readback already confirmed -- only here is
  // blockingReasons genuinely empty.
  const e = M.buildSellerSigningAuditEvidence(evidenceArgs({ sellerCountWriteReadbackOk: true }));
  check('buildSellerSigningAuditEvidence: blockingReasons is empty ONLY once the write/readback is also confirmed', e.blockingReasons, []);
}

{
  const model = { kind: 'two_sellers', seller1Capacity: 'individual_own_capacity', seller2: { legalName: 'John Seller', email: '  John@Example.COM  ' }, seller2Capacity: 'individual_own_capacity' };
  const e = M.buildSellerSigningAuditEvidence(evidenceArgs({
    disposition: { kind: 'populated', value: model },
    printedSellerSigners: [{ displayName: 'Jane Seller' }, { displayName: 'John Seller' }],
  }));
  check('buildSellerSigningAuditEvidence: Two-Seller happy path -- sellerCountDiscriminator', e.sellerCountDiscriminator, 'two_sellers');
  check('buildSellerSigningAuditEvidence: Two-Seller happy path -- seller2LegalName', e.seller2LegalName, 'John Seller');
  check('buildSellerSigningAuditEvidence: seller2NormalizedEmail is normalized (trim + lowercase), never the raw typed value', e.seller2NormalizedEmail, 'john@example.com');
  check('buildSellerSigningAuditEvidence: Two-Seller happy path -- expectedSellerCountTransportValue', e.expectedSellerCountTransportValue, 'Two Sellers');
}

{
  // Transport blocked (sentinel), canonical model fully ready -- the two
  // must NEVER be conflated. "Do not log a successful readiness result
  // when the transport sentinel blocks it; distinguish canonical readiness
  // from transport readiness."
  const e = M.buildSellerSigningAuditEvidence(evidenceArgs({ sellerCountFieldId: SENTINEL }));
  checkTrue('buildSellerSigningAuditEvidence: transport-blocked -- canonicalReadinessOk is STILL true', e.canonicalReadinessOk === true);
  checkTrue('buildSellerSigningAuditEvidence: transport-blocked -- sellerCountFieldProvisioned is false', e.sellerCountFieldProvisioned === false);
  checkTrue('buildSellerSigningAuditEvidence: transport-blocked -- blockingReasons is non-empty (never silently ok)', e.blockingReasons.length > 0);
  checkTrue('buildSellerSigningAuditEvidence: transport-blocked -- the blocking reason names the field-provisioning gate', e.blockingReasons.some((r) => /not yet provisioned/.test(r)));
}

{
  // Canonical model itself broken (unresolved count) -- no seller1/model
  // facts to report; every model-derived field reads as its own "unset".
  const e = M.buildSellerSigningAuditEvidence(evidenceArgs({ disposition: { kind: 'unresolved' }, seller1: { ok: false, reason: 'irrelevant' } }));
  check('buildSellerSigningAuditEvidence: unresolved count -- sellerCountDiscriminator is "unresolved"', e.sellerCountDiscriminator, 'unresolved');
  checkTrue('buildSellerSigningAuditEvidence: unresolved count -- seller1Ok is false', e.seller1Ok === false);
  check('buildSellerSigningAuditEvidence: unresolved count -- seller1Capacity is null (no model to read it from)', e.seller1Capacity, null);
  check('buildSellerSigningAuditEvidence: unresolved count -- expectedSellerCountTransportValue is null', e.expectedSellerCountTransportValue, null);
  checkTrue('buildSellerSigningAuditEvidence: unresolved count -- canonicalReadinessOk is false', e.canonicalReadinessOk === false);
}

{
  // A write WAS attempted and confirmed -- sellerCountWriteReadbackOk
  // reflects the real outcome, folded into the overall blockingReasons too.
  const okEvidence = M.buildSellerSigningAuditEvidence(evidenceArgs({ sellerCountWriteReadbackOk: true }));
  checkTrue('buildSellerSigningAuditEvidence: a confirmed write -- sellerCountWriteReadbackOk true, ok overall (no readback-related reason)', okEvidence.sellerCountWriteReadbackOk === true && okEvidence.blockingReasons.length === 0);

  const failedEvidence = M.buildSellerSigningAuditEvidence(evidenceArgs({ sellerCountWriteReadbackOk: false }));
  checkTrue('buildSellerSigningAuditEvidence: a failed write -- sellerCountWriteReadbackOk false, AND blockingReasons names the readback gate', failedEvidence.sellerCountWriteReadbackOk === false && failedEvidence.blockingReasons.some((r) => /has not been confirmed by a fresh readback/.test(r)));
}

/* -------------------------------------------------- evidence validator */

{
  const e = M.buildSellerSigningAuditEvidence(evidenceArgs());
  check('validateSellerSigningAuditEvidenceValue: round-trips a well-formed evidence object exactly', M.validateSellerSigningAuditEvidenceValue(JSON.parse(JSON.stringify(e))), e);
}
checkNull('validateSellerSigningAuditEvidenceValue: null input fails closed', M.validateSellerSigningAuditEvidenceValue(null));
checkNull('validateSellerSigningAuditEvidenceValue: an array fails closed', M.validateSellerSigningAuditEvidenceValue([]));
checkNull('validateSellerSigningAuditEvidenceValue: a plain string fails closed', M.validateSellerSigningAuditEvidenceValue('not an object'));
{
  const e = M.buildSellerSigningAuditEvidence(evidenceArgs());
  const missingKey = { ...e };
  delete missingKey.blockingReasons;
  checkNull('validateSellerSigningAuditEvidenceValue: missing a required key fails closed', M.validateSellerSigningAuditEvidenceValue(missingKey));
  const extraKey = { ...e, extra: 'unexpected' };
  checkNull('validateSellerSigningAuditEvidenceValue: an extra unexpected key fails closed', M.validateSellerSigningAuditEvidenceValue(extraKey));
  checkNull('validateSellerSigningAuditEvidenceValue: an invalid capacity disposition fails closed', M.validateSellerSigningAuditEvidenceValue({ ...e, seller1Capacity: 'made_up' }));
  checkNull('validateSellerSigningAuditEvidenceValue: sendOccurred:true fails closed (never a valid recorded state)', M.validateSellerSigningAuditEvidenceValue({ ...e, sendOccurred: true }));
  checkNull('validateSellerSigningAuditEvidenceValue: an unrecognized effectiveDateStatus fails closed', M.validateSellerSigningAuditEvidenceValue({ ...e, effectiveDateStatus: 'something_else' }));
  checkNull('validateSellerSigningAuditEvidenceValue: a non-array blockingReasons fails closed', M.validateSellerSigningAuditEvidenceValue({ ...e, blockingReasons: 'not an array' }));
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
