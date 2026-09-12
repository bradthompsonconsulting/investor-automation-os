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

const { currentOfferWriteGate, acceptedPriceFreezeValue, readCurrentOfferFromOpportunity, checkCurrentOfferIntegrity } = require(path.join(TMP, 'current-offer-carrier.js'));
const { formatOutcomeNote, parseOutcomeNote } = require(path.join(TMP, 'seller-call-outcome.js'));

const FLOOR = 56;
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
/* 1b. readCurrentOfferFromOpportunity -- hydration read side        */
/*     (INV-70 / B9-07A Phase 2 correction round 3)                  */
/* -------------------------------------------------------------- */

const FIELD_ID = 'opp-field-under-test';

{
  const v = readCurrentOfferFromOpportunity([{ id: FIELD_ID, type: 'currency', fieldValueNumber: 275000 }], FIELD_ID);
  check('reads a populated NUMERICAL field at fieldValueNumber (list-endpoint shape)', v, 275000);
}
{
  const v = readCurrentOfferFromOpportunity([], FIELD_ID);
  check('absent field (not in the array at all) reads as null, never zero', v, null);
}
{
  const v = readCurrentOfferFromOpportunity([{ id: 'a-different-field', fieldValueNumber: 999 }], FIELD_ID);
  check('a DIFFERENT field id present in the array is never mistaken for the one being read', v, null);
}
{
  const v = readCurrentOfferFromOpportunity([{ id: FIELD_ID, fieldValueNumber: null }], FIELD_ID);
  check('an explicit null fieldValueNumber reads as null', v, null);
}
{
  const v = readCurrentOfferFromOpportunity([{ id: FIELD_ID, fieldValueNumber: '' }], FIELD_ID);
  check('an empty-string fieldValueNumber reads as null', v, null);
}
{
  const v = readCurrentOfferFromOpportunity([{ id: FIELD_ID, fieldValueNumber: '275000' }], FIELD_ID);
  check('a numeric STRING at fieldValueNumber still parses (not strict about JS type at that key)', v, 275000);
}
{
  // Strict about WHICH KEY, deliberately mirroring resolver.ts's own
  // readNumberField discipline -- a value sitting under the SINGULAR-GET
  // shape's `fieldValue` key (rather than the list shape's
  // `fieldValueNumber`) must read as absent, not be coalesced.
  const v = readCurrentOfferFromOpportunity([{ id: FIELD_ID, fieldValue: 275000 }], FIELD_ID);
  check('a value under the WRONG key (fieldValue, the singular-GET shape) is never coalesced -- reads absent', v, null);
}
{
  const v = readCurrentOfferFromOpportunity([{ id: FIELD_ID, fieldValueNumber: 0 }], FIELD_ID);
  check('zero is a real value, not treated as absent', v, 0);
}
{
  const v = readCurrentOfferFromOpportunity([{ id: FIELD_ID, fieldValueNumber: 'not-a-number' }], FIELD_ID);
  check('a non-numeric string never produces NaN -- reads absent instead', v, null);
}

/* -------------------------------------------------------------- */
/* 1c. checkCurrentOfferIntegrity -- standing reconciliation warning */
/*     (Jess Gate clarification, INV-70 / B9-07A Phase 2 round 3     */
/*     follow-up: hydration stays no-fallback; a disagreement        */
/*     between the frozen accepted price and the live Opportunity    */
/*     field must be surfaced explicitly, never silently absorbed.)  */
/* -------------------------------------------------------------- */

{
  const s = checkCurrentOfferIntegrity({ agreementReached: false, acceptedValue: null, opportunityValue: null });
  check('no Accept outcome yet: ok, silent (a merely-negotiating deal is never flagged)', s, { ok: true });
}
{
  const s = checkCurrentOfferIntegrity({ agreementReached: false, acceptedValue: null, opportunityValue: 275000 });
  check('not agreement-reached: ok regardless of the live field value', s, { ok: true });
}
{
  const s = checkCurrentOfferIntegrity({ agreementReached: true, acceptedValue: 275000, opportunityValue: 275000 });
  check('agreement reached, field matches the accepted price: ok', s, { ok: true });
}
{
  const s = checkCurrentOfferIntegrity({ agreementReached: true, acceptedValue: 275000, opportunityValue: null });
  check('agreement reached, field empty: flagged as opportunity_field_empty', s,
    { ok: false, reason: 'opportunity_field_empty', acceptedValue: 275000 });
}
{
  const s = checkCurrentOfferIntegrity({ agreementReached: true, acceptedValue: 275000, opportunityValue: 260000 });
  check('agreement reached, field disagrees: flagged as value_mismatch with both values named', s,
    { ok: false, reason: 'value_mismatch', acceptedValue: 275000, opportunityValue: 260000 });
}
{
  // agreementReached true but acceptedValue null is a malformed/impossible
  // caller state (an Accept outcome always has a real snapshot.currentOffer
  // -- B8-10's own Accept-button gate) -- proven silent (ok:true) rather
  // than fabricating a warning about a value that was never accepted.
  const s = checkCurrentOfferIntegrity({ agreementReached: true, acceptedValue: null, opportunityValue: 260000 });
  check('agreement reached but no accepted value on record (malformed caller state): silent, not fabricated', s, { ok: true });
}
{
  const s = checkCurrentOfferIntegrity({ agreementReached: true, acceptedValue: 275000, opportunityValue: 0 });
  check('zero is a real, distinct value from the accepted price -- flagged as value_mismatch, not treated as empty', s,
    { ok: false, reason: 'value_mismatch', acceptedValue: 275000, opportunityValue: 0 });
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
  // INV-70 / B9-07A Phase 2 correction round 3 -- Agreement Reached now
  // FAILS CLOSED across both required records, in a FIXED ORDER: the
  // Current Offer write/readback must succeed BEFORE the Note is ever
  // attempted. The prior "non-blocking, freeze-happens-after-the-note"
  // design is gone -- these checks prove the reversal, not the old order.
  const pageSrc = fs.readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the page calls acceptedPriceFreezeValue with the snapshot used for the note, not a fresh read',
    /acceptedPriceFreezeValue\(snapshot\.currentOffer\)/.test(pageSrc), true);
  check('the Current Offer write happens BEFORE ghl.notes.create, never after (reversed from the prior design)',
    (() => {
      const noteIdx = pageSrc.indexOf('await ghl.notes.create(contactId, attempt.note)');
      const freezeWriteIdx = pageSrc.indexOf('await ghl.opportunities.setCurrentOffer(screen.opportunity.id, freeze.value)');
      return noteIdx !== -1 && freezeWriteIdx !== -1 && freezeWriteIdx < noteIdx;
    })(),
    true);
  check('a BLOCKED freeze value (acceptedPriceFreezeValue) returns before any write is attempted, never reaching the Note',
    /if \(freeze\.kind === "blocked"\) \{\s*setOutcomeActionError\(`Cannot record acceptance -- \$\{freeze\.reason\}\.`\);\s*return;\s*\}/.test(pageSrc),
    true);
  check('a THROWN error from the Current Offer write returns before the Note is ever attempted',
    /catch \(e: any\) \{\s*setOutcomeActionError\(\s*`Cannot record acceptance -- the accepted price could not be saved[\s\S]{0,120}\);\s*return;\s*\}/.test(pageSrc),
    true);
  check('a result.ok === false from the Current Offer write ALSO returns before the Note is ever attempted (checked identically to a thrown error)',
    /if \(!freezeResult\.ok\) \{\s*setOutcomeActionError\(\s*"Cannot record acceptance -- the accepted price was sent but could not be confirmed[\s\S]{0,80}"\s*,?\s*\);\s*return;\s*\}/.test(pageSrc),
    true);
  check('the soft-warning, non-blocking freeze-write-failure path is REMOVED (no currentOfferWriteState "error" write inside the accept branch\'s old catch)',
    /Agreement Reached was recorded, but freezing Current Offer failed/.test(pageSrc),
    false);
  check('a Note failure (thrown after the Current Offer already succeeded) is surfaced via the SAME outcomeActionError path every other outcome failure already uses -- no special-cased swallow',
    /\} catch \(e: any\) \{\s*setOutcomeActionError\(e\?\.message \?\? "Couldn't record this outcome\."\);\s*\} finally \{/.test(pageSrc),
    true);
}
{
  // Jess Gate clarification follow-up -- the standing reconciliation
  // warning. Not part of the hydration effect (no-fallback rule
  // unchanged): a separate memo, recomputed whenever the accepted
  // outcome or the live Opportunity value changes, rendered wherever the
  // accepted price is already shown.
  const pageSrc = fs.readFileSync(PAGE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the page imports checkCurrentOfferIntegrity from current-offer-carrier',
    /import \{[^}]*checkCurrentOfferIntegrity[^}]*\} from "\.\.\/lib\/current-offer-carrier"/.test(pageSrc), true);
  check('currentOfferIntegrity is derived from latestOutcome and currentOfferFromOpportunity, not re-fetched',
    /const currentOfferIntegrity = useMemo\(\(\) => \{\s*return checkCurrentOfferIntegrity\(\{\s*agreementReached: latestOutcome\?\.kind === "accept",\s*acceptedValue: latestOutcome\?\.kind === "accept" \? latestOutcome\.snapshot\.currentOffer : null,\s*opportunityValue: currentOfferFromOpportunity,\s*\}\);\s*\}, \[latestOutcome, currentOfferFromOpportunity\]\);/.test(pageSrc),
    true);
  check('a mismatch renders a dedicated warning inside the Agreement Reached banner, gated on !currentOfferIntegrity.ok',
    /\{!currentOfferIntegrity\.ok \? \(\s*<div\s*data-testid="current-offer-integrity-warning"/.test(pageSrc),
    true);
  check('the warning names the opportunity_field_empty case explicitly',
    /currentOfferIntegrity\.reason === "opportunity_field_empty"/.test(pageSrc), true);
  check('the warning states the accepted price still governs -- not a request to re-confirm the agreement',
    /this is a reconciliation flag on the queryable field, not a request to re-confirm the agreement/.test(pageSrc), true);
  check('no ok:true integrity status ever renders the warning div (gated strictly on the negative branch)',
    (() => {
      const idx = pageSrc.indexOf('data-testid="current-offer-integrity-warning"');
      const gateIdx = pageSrc.lastIndexOf('{!currentOfferIntegrity.ok ? (', idx);
      return idx !== -1 && gateIdx !== -1 && idx - gateIdx < 80;
    })(),
    true);
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
  check('CURRENT_OFFER_NOT_PROVISIONED sentinel is still exported (kept as the general not-yet-provisioned mechanism, even though both environments now carry a real id)',
    /export const CURRENT_OFFER_NOT_PROVISIONED = "CURRENT_OFFER_FIELD_NOT_YET_PROVISIONED"/.test(configSrc), true);
  // INV-70 Phase 2 correction round 2 created Test's field once Custom
  // Fields write/create scope was granted. INV-70 Phase 3 correction
  // created Production's field the same way once Brad authorized
  // Production provisioning and this credential's use -- see
  // "Phase 3 correction (this revision)" in this document. BOTH
  // environments now carry a real id; neither carries the sentinel.
  const productionBlock = configSrc.slice(configSrc.indexOf('const PRODUCTION'), configSrc.indexOf('const TEST'));
  const testBlock = configSrc.slice(configSrc.indexOf('const TEST'));
  check('TEST.opportunityFacts.currentOffer is a real id, not the sentinel',
    /currentOffer:\s*"7pmvwi6vlu74f5rLOp9M"/.test(testBlock), true);
  check('PRODUCTION.opportunityFacts.currentOffer is now a real id, not the sentinel',
    /currentOffer:\s*"yZgEdTOvppmmCvv8kx9n"/.test(productionBlock), true);
  check('PRODUCTION.opportunityFacts.currentOffer no longer references the sentinel constant',
    /currentOffer:\s*CURRENT_OFFER_NOT_PROVISIONED/.test(productionBlock), false);
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
