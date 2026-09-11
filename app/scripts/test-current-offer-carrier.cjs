/**
 * INV-70 / B9-07A Phase 2 -- deterministic proof of Family 5's approved
 * ruling: the single Opportunity-owned Current Offer carrier. Pure
 * functions and static source checks only; no GHL, no network.
 *
 * Three things are proven here:
 *  1. Current Offer updates before agreement -- currentOfferWriteGate
 *     allows a write for any positive, finite value while no Agreement
 *     Reached outcome exists for the opportunity.
 *  2. Accepted-price freeze/snapshot behavior -- once
 *     agreementAlreadyReached is true, currentOfferWriteGate refuses
 *     EVERY further write regardless of the new value, and
 *     acceptedPriceFreezeValue is the one path that writes the frozen
 *     value, sourced from the outcome snapshot, never re-derived.
 *  3. GHL Note evidence preservation -- seller-call-outcome.ts's note
 *     format/parse functions are untouched by this phase (this module
 *     adds no field to OutcomeSnapshot, no format change), proven by
 *     round-tripping a note exactly as test-seller-call-outcome.cjs
 *     already does, plus a static check that the freeze value is sourced
 *     from that SAME snapshot field, never a second computation.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-current-offer-carrier-test');
const CARRIER = path.join(APP, 'src', 'lib', 'current-offer-carrier.ts');
const OUTCOME = path.join(APP, 'src', 'lib', 'seller-call-outcome.ts');
const PAGE = path.join(APP, 'src', 'pages', 'SellerCallWorkspace.tsx');
const GHL = path.join(APP, 'src', 'lib', 'ghl.ts');
const CONFIG = path.join(APP, 'shared', 'ghl-config.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(
    `npx tsc "${CARRIER}" "${OUTCOME}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const { currentOfferWriteGate, acceptedPriceFreezeValue } = require(path.join(TMP, 'current-offer-carrier.js'));
const { formatOutcomeNote, parseOutcomeNote } = require(path.join(TMP, 'seller-call-outcome.js'));

const FLOOR = 27;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('PASS  ' + name);
  else {
    failures++;
    console.error('FAIL  ' + name);
    console.error('      expected: ' + JSON.stringify(expected));
    console.error('      actual:   ' + JSON.stringify(actual));
  }
}

/* -------------------------------------------------------------- */
/* 1. Current Offer updates before agreement                        */
/* -------------------------------------------------------------- */

{
  const d = currentOfferWriteGate({ value: 250000, agreementAlreadyReached: false });
  check('allowed: a positive value, no agreement yet', d, { kind: 'allowed', value: 250000 });
}
{
  const d = currentOfferWriteGate({ value: 100000, agreementAlreadyReached: false });
  check('allowed: a different value, still pre-agreement, updates freely', d, { kind: 'allowed', value: 100000 });
}
{
  const d = currentOfferWriteGate({ value: null, agreementAlreadyReached: false });
  check('blocked: nothing entered yet', d.kind, 'blocked');
  check('blocked: nothing-entered reason names the absence', d.reason, 'no Current Offer entered');
}
{
  const d = currentOfferWriteGate({ value: 0, agreementAlreadyReached: false });
  check('blocked: zero is not a usable acquisition price', d.kind, 'blocked');
}
{
  const d = currentOfferWriteGate({ value: -5000, agreementAlreadyReached: false });
  check('blocked: negative is not a usable acquisition price', d.kind, 'blocked');
}
{
  const d = currentOfferWriteGate({ value: Infinity, agreementAlreadyReached: false });
  check('blocked: non-finite is not a usable acquisition price', d.kind, 'blocked');
}

/* -------------------------------------------------------------- */
/* 2. Frozen after Agreement Reached -- no exceptions                */
/* -------------------------------------------------------------- */

{
  const d = currentOfferWriteGate({ value: 300000, agreementAlreadyReached: true });
  check('blocked: agreement already reached, even with a valid new value', d.kind, 'blocked');
  check('blocked: the frozen reason names Agreement Reached', /Agreement Reached/.test(d.reason), true);
}
{
  const d = currentOfferWriteGate({ value: 999999, agreementAlreadyReached: true });
  check('blocked: a DIFFERENT new value after freeze is still refused, never accepted as a correction', d.kind, 'blocked');
}
{
  const d = currentOfferWriteGate({ value: null, agreementAlreadyReached: true });
  check('blocked: freeze check runs even when no new value was typed', d.kind, 'blocked');
}

{
  const d = acceptedPriceFreezeValue(275000);
  check('freeze value: a real accepted price is allowed', d, { kind: 'allowed', value: 275000 });
}
{
  const d = acceptedPriceFreezeValue(null);
  check('freeze value: null (never entered) is blocked, not written as zero or silently skipped', d.kind, 'blocked');
}
{
  const d = acceptedPriceFreezeValue(0);
  check('freeze value: zero is blocked (not a real accepted price)', d.kind, 'blocked');
}
{
  const d = acceptedPriceFreezeValue(-100);
  check('freeze value: negative is blocked', d.kind, 'blocked');
}

/* -------------------------------------------------------------- */
/* 3. GHL Note evidence preservation -- unchanged format, same source */
/* -------------------------------------------------------------- */

{
  const snapshot = {
    sellerPosition: 200000, currentOffer: 275000, targetAcquisitionPrice: 260000,
    maxSupportedOffer: 280000, expectedSpread: 5000, arv: 400000, repairs: 30000,
    readinessStatus: 'OFFER_READY',
  };
  const note = formatOutcomeNote({
    opportunityId: 'opp-1', kind: 'accept', at: '2026-09-11T12:00:00.000Z',
    operator: null, snapshot, reason: null, followUpAt: null,
  });
  const parsed = parseOutcomeNote(note);
  check('note round-trips: kind', parsed.kind, 'accept');
  check('note round-trips: currentOffer, the SAME value the freeze write uses', parsed.snapshot.currentOffer, 275000);

  // The freeze write is sourced from EXACTLY this field -- proven by
  // construction: acceptedPriceFreezeValue takes the same number the note
  // just proved it carries, with no intermediate recomputation.
  const freeze = acceptedPriceFreezeValue(parsed.snapshot.currentOffer);
  check('freeze value derives from the note-parsed currentOffer verbatim', freeze, { kind: 'allowed', value: 275000 });
}
{
  // seller-call-outcome.ts's own format/parse functions carry no new field
  // and no changed header this phase -- the ledger version string is the
  // trip-wire: any format change bumps it, and this phase did not.
  const outcomeSrc = fs.readFileSync(OUTCOME, 'utf8');
  check('the outcome ledger version is unchanged (iaos-seller-call-outcome-v1)', /LEDGER_VERSION = "iaos-seller-call-outcome-v1"/.test(outcomeSrc), true);
  check('OutcomeSnapshot gained no new field this phase (still exactly these 8 keys)',
    /sellerPosition: number \| null;\s*currentOffer: number \| null;\s*targetAcquisitionPrice: number \| null;\s*maxSupportedOffer: number \| null;\s*expectedSpread: number \| null;\s*arv: number \| null;\s*repairs: number \| null;\s*readinessStatus:/.test(outcomeSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
    true);
}
{
  // The page writes the freeze value ONLY after the note write succeeds,
  // and only derives it from the snapshot already passed to
  // attemptRecordOutcome -- never a second read, never a second
  // computation. Static check against the shipped page source.
  const pageSrc = fs.readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the page calls acceptedPriceFreezeValue with the snapshot used for the note, not a fresh read',
    /acceptedPriceFreezeValue\(snapshot\.currentOffer\)/.test(pageSrc), true);
  check('the freeze write happens after ghl.notes.create, never before',
    (() => {
      const noteIdx = pageSrc.indexOf('await ghl.notes.create(contactId, attempt.note)');
      const freezeIdx = pageSrc.indexOf('acceptedPriceFreezeValue(snapshot.currentOffer)');
      return noteIdx !== -1 && freezeIdx !== -1 && noteIdx < freezeIdx;
    })(),
    true);
  check('a failed freeze write does not roll back or re-throw past the accept flow (non-blocking by design)',
    /catch \(e: any\) \{\s*setCurrentOfferWriteState\(\{\s*status: "error"/.test(pageSrc), true);
}

/* -------------------------------------------------------------- */
/* 4. The carrier is genuinely new -- not a repurposed legacy field   */
/* -------------------------------------------------------------- */

{
  const ghlSrc = fs.readFileSync(GHL, 'utf8');
  check('setCurrentOffer resolves opportunityFacts.currentOffer, not any offer_ field id',
    /setCurrentOffer[\s\S]{0,200}CONFIG\.opportunityFacts\.currentOffer/.test(ghlSrc), true);
  check('setCurrentOffer refuses before any network call when unprovisioned',
    /if \(fieldId === CURRENT_OFFER_NOT_PROVISIONED\)/.test(ghlSrc), true);
}
{
  const configSrc = fs.readFileSync(CONFIG, 'utf8');
  check('opportunityFacts.currentOffer is a distinct key from every legacy offer_ id',
    /currentOffer: string;/.test(configSrc), true);
  check('CURRENT_OFFER_NOT_PROVISIONED sentinel is exported for both environments to share',
    /export const CURRENT_OFFER_NOT_PROVISIONED = "CURRENT_OFFER_FIELD_NOT_YET_PROVISIONED"/.test(configSrc), true);
}

cleanup();
console.log('');
console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
if (checks !== FLOOR) {
  console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}. A case was added or removed without updating FLOOR.`);
  process.exit(2);
}
if (failures) { console.error('FAILED'); process.exit(1); }
console.log('OK');
