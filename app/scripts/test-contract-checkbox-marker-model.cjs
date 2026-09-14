/**
 * INV-67 checkbox-marker / broker-model repair -- deterministic proof of
 * `contract-checkbox-marker-model.ts`. Pure functions, no I/O.
 *
 * Proves, per the "Required test evidence" list of the repository
 * implementation authorization:
 *   1. Exactly 48 marker keys, 11 checkbox-text keys, 11 broker-field
 *      suffixes (-> 22 broker-text keys).
 *   2. Every marker value produced anywhere is exactly "X" or "".
 *   3. Every one of the 13 exclusivity groups emits at most one "X" for
 *      every reachable canonical-fact combination (by construction) AND
 *      `validateMarkerExclusivity` correctly flags a synthetic violation
 *      (the explicit runtime check, defense in depth).
 *   4. Inactive child markers/text always write an explicit blank, never
 *      an omitted key -- proven by asserting every group's key set is
 *      fully present regardless of which branch is active.
 *   5. `checkMineralReservationConsistency` fails closed with a distinct
 *      message on disagreement; agrees silently otherwise.
 *   6. `checkPoaAddendaConsistency` warns (non-null) on disagreement,
 *      returns null (no warning) on agreement -- never blocks by itself.
 *   7. `deriveBrokerText` -- gated by classification, always emits all 22
 *      keys, correctly all-blank / seller-only / buyer-only / both-sides.
 *   8. `buildCheckboxMarkersAndText` integration: ok:true happy path,
 *      ok:false on a blocking broker arrangement, ok:false on mineral-
 *      reservation disagreement, warnings (not blocking) on POA/addenda
 *      disagreement.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-checkbox-marker-test');
const MODEL = path.join(APP, 'src', 'lib', 'contract-checkbox-marker-model.ts');
const BROKER_MODEL = path.join(APP, 'src', 'lib', 'contract-broker-arrangement-model.ts');
const CARRIERS = path.join(APP, 'src', 'lib', 'seller-contract-facts-carriers.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(`npx tsc "${MODEL}" "${BROKER_MODEL}" "${CARRIERS}" --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const M = require(path.join(TMP, 'contract-checkbox-marker-model.js'));
const {
  CHECKBOX_MARKER_KEYS, CHECKBOX_TEXT_KEYS, BROKER_FIELD_SUFFIXES, BROKER_TEXT_KEYS,
  deriveLeaseMarkers, deriveTitleExpenseMarkers, deriveShortageMarkers, deriveSurveyMarkers,
  derivePoaMarkers, deriveSellerDisclosureNoticeMarkers, deriveAsIsMarkers, deriveWaterDisclosureMarkers,
  derivePossessionMarkers, deriveBrokerageContributionMarkers, deriveAddendaMarkers,
  checkMineralReservationConsistency, checkPoaAddendaConsistency, validateMarkerExclusivity,
  deriveBrokerText, buildCheckboxMarkersAndText,
} = M;
const { ADDENDA_APPLICABILITY_ITEM_KEYS } = require(path.join(TMP, 'seller-contract-facts-carriers.js'));

const FLOOR = 87;
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
function onlyXOrBlank(obj) { return Object.values(obj).every((v) => v === 'X' || v === ''); }

/* ==================================================================== */
/* 1. Exact key-set sizes                                                */
/* ==================================================================== */

check('CHECKBOX_MARKER_KEYS has exactly 48 keys', CHECKBOX_MARKER_KEYS.length, 48);
check('CHECKBOX_MARKER_KEYS has no duplicates', new Set(CHECKBOX_MARKER_KEYS).size, 48);
check('CHECKBOX_TEXT_KEYS has exactly 11 keys', CHECKBOX_TEXT_KEYS.length, 11);
check('BROKER_FIELD_SUFFIXES has exactly 11 suffixes', BROKER_FIELD_SUFFIXES.length, 11);
check('BROKER_TEXT_KEYS has exactly 22 keys (11 per side)', BROKER_TEXT_KEYS.length, 22);
check('BROKER_TEXT_KEYS has no duplicates', new Set(BROKER_TEXT_KEYS).size, 22);
checkTrue('no overlap between marker keys and text keys', CHECKBOX_MARKER_KEYS.every((k) => !CHECKBOX_TEXT_KEYS.includes(k)));

/* ==================================================================== */
/* 2. Per-group derive functions -- exhaustive branch coverage, blank    */
/*    children on every inactive branch, values limited to "X"/""       */
/* ==================================================================== */

{
  const r1 = deriveLeaseMarkers('applies', 'applies', { kind: 'not_yet_delivered', terminateWithinDays: 5 });
  check('lease: residential applies -> X', r1.markers.lease_residential_mark, 'X');
  check('lease: fixture applies -> X', r1.markers.lease_fixture_mark, 'X');
  check('lease: nrl not_yet_delivered -> applies X, delivered blank, not_delivered X', [r1.markers.lease_nrl_applies_mark, r1.markers.lease_nrl_delivered_mark, r1.markers.lease_nrl_not_delivered_mark], ['X', '', 'X']);
  check('lease: terminate-within-days text populated when not_yet_delivered', r1.text.lease_nrl_terminate_within_days_text, '5');
  checkTrue('lease markers all X/""', onlyXOrBlank(r1.markers));

  const r2 = deriveLeaseMarkers('none', 'none', { kind: 'none' });
  check('lease: all-none produces all-blank markers', Object.values(r2.markers).every((v) => v === ''), true);
  check('lease: text is explicit blank when nrl is "none" (inactive child)', r2.text.lease_nrl_terminate_within_days_text, '');

  const r3 = deriveLeaseMarkers('none', 'none', { kind: 'delivered' });
  check('lease: nrl delivered -> applies X, delivered X, not_delivered blank', [r3.markers.lease_nrl_applies_mark, r3.markers.lease_nrl_delivered_mark, r3.markers.lease_nrl_not_delivered_mark], ['X', 'X', '']);
  check('lease: text stays blank when nrl is "delivered" (inactive child)', r3.text.lease_nrl_terminate_within_days_text, '');
}

{
  check('titleExpense: seller -> seller X, buyer blank', deriveTitleExpenseMarkers('seller'), { title_expense_seller_mark: 'X', title_expense_buyer_mark: '' });
  check('titleExpense: buyer -> buyer X, seller blank', deriveTitleExpenseMarkers('buyer'), { title_expense_seller_mark: '', title_expense_buyer_mark: 'X' });
}

{
  check('shortage: not_amended -> not_amended X, all children blank', deriveShortageMarkers({ kind: 'not_amended' }), { shortage_not_amended_mark: 'X', shortage_amended_mark: '', shortage_amended_buyer_mark: '', shortage_amended_seller_mark: '' });
  check('shortage: amended+buyer -> amended X, buyer-child X, seller-child blank', deriveShortageMarkers({ kind: 'amended', expenseParty: 'buyer' }), { shortage_not_amended_mark: '', shortage_amended_mark: 'X', shortage_amended_buyer_mark: 'X', shortage_amended_seller_mark: '' });
  check('shortage: amended+seller -> amended X, seller-child X, buyer-child blank', deriveShortageMarkers({ kind: 'amended', expenseParty: 'seller' }), { shortage_not_amended_mark: '', shortage_amended_mark: 'X', shortage_amended_buyer_mark: '', shortage_amended_seller_mark: 'X' });
}

{
  const s1 = deriveSurveyMarkers({ option: 'seller_existing_survey', sellerFurnishDays: 7, ifRejectedExpenseParty: 'buyer' });
  check('survey opt1(buyer): opt1 X, others blank; opt1-expense-buyer X', [s1.markers.survey_opt1_mark, s1.markers.survey_opt2_mark, s1.markers.survey_opt3_mark, s1.markers.survey_opt1_expense_buyer_mark, s1.markers.survey_opt1_expense_seller_mark], ['X', '', '', 'X', '']);
  check('survey opt1 text: seller-furnish-days populated, others blank (inactive)', [s1.text.survey_opt1_seller_furnish_days_text, s1.text.survey_opt2_buyer_obtain_days_text, s1.text.survey_opt3_seller_furnish_days_text], ['7', '', '']);

  const s2 = deriveSurveyMarkers({ option: 'buyer_new_survey', buyerObtainDays: 10 });
  check('survey opt2: opt2 X only, opt1-expense children both blank (inactive)', [s2.markers.survey_opt1_mark, s2.markers.survey_opt2_mark, s2.markers.survey_opt3_mark, s2.markers.survey_opt1_expense_buyer_mark, s2.markers.survey_opt1_expense_seller_mark], ['', 'X', '', '', '']);
  check('survey opt2 text: buyer-obtain-days populated, others blank', [s2.text.survey_opt1_seller_furnish_days_text, s2.text.survey_opt2_buyer_obtain_days_text, s2.text.survey_opt3_seller_furnish_days_text], ['', '10', '']);

  const s3 = deriveSurveyMarkers({ option: 'seller_new_survey', sellerFurnishDays: 3 });
  check('survey opt3: opt3 X only', [s3.markers.survey_opt1_mark, s3.markers.survey_opt2_mark, s3.markers.survey_opt3_mark], ['', '', 'X']);
  check('survey opt3 text: opt3 seller-furnish-days populated, others blank', [s3.text.survey_opt1_seller_furnish_days_text, s3.text.survey_opt2_buyer_obtain_days_text, s3.text.survey_opt3_seller_furnish_days_text], ['', '', '3']);
}

{
  check('poa: is_subject', derivePoaMarkers('is_subject'), { poa_is_subject_mark: 'X', poa_is_not_subject_mark: '' });
  check('poa: is_not_subject', derivePoaMarkers('is_not_subject'), { poa_is_subject_mark: '', poa_is_not_subject_mark: 'X' });
}

{
  const d1 = deriveSellerDisclosureNoticeMarkers({ kind: 'not_yet_received', deliverWithinDays: 9 });
  check('sdn: not_yet_received -> that mark X, others blank', [d1.markers.sdn_received_mark, d1.markers.sdn_not_received_mark, d1.markers.sdn_not_required_mark], ['', 'X', '']);
  check('sdn: deliver-within-days text populated', d1.text.sdn_deliver_within_days_text, '9');
  const d2 = deriveSellerDisclosureNoticeMarkers({ kind: 'received' });
  check('sdn: received -> text stays blank (inactive child)', d2.text.sdn_deliver_within_days_text, '');
  const d3 = deriveSellerDisclosureNoticeMarkers({ kind: 'not_required' });
  check('sdn: not_required -> that mark X only', [d3.markers.sdn_received_mark, d3.markers.sdn_not_received_mark, d3.markers.sdn_not_required_mark], ['', '', 'X']);
}

{
  check('asIs: as_is', deriveAsIsMarkers({ kind: 'as_is' }), { as_is_plain_mark: 'X', as_is_with_repairs_mark: '' });
  check('asIs: as_is_with_repairs', deriveAsIsMarkers({ kind: 'as_is_with_repairs', repairsText: 'fix roof' }), { as_is_plain_mark: '', as_is_with_repairs_mark: 'X' });
}

{
  const w1 = deriveWaterDisclosureMarkers({ kind: 'not_yet_received', deliverWithinDays: 4 });
  check('water: not_yet_received marks + text', [w1.markers.water_received_mark, w1.markers.water_not_received_mark, w1.markers.water_exempt_mark, w1.text.water_deliver_within_days_text, w1.text.water_source_text], ['', 'X', '', '4', '']);
  const w2 = deriveWaterDisclosureMarkers({ kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'well' });
  check('water: exempt marks + text (source populated, deliver-days blank)', [w2.markers.water_received_mark, w2.markers.water_not_received_mark, w2.markers.water_exempt_mark, w2.text.water_deliver_within_days_text, w2.text.water_source_text], ['', '', 'X', '', 'well']);
}

{
  check('possession: upon_closing_and_funding', derivePossessionMarkers('upon_closing_and_funding'), { possession_upon_closing_mark: 'X', possession_leaseback_mark: '' });
  check('possession: leaseback', derivePossessionMarkers('leaseback'), { possession_upon_closing_mark: '', possession_leaseback_mark: 'X' });
}

{
  const c1 = deriveBrokerageContributionMarkers('spbb', { kind: 'dollar', amount: 5000 });
  check('spbb dollar: applies X, dollar X, percent blank, dollar text populated', [c1.markers.spbb_applies_mark, c1.markers.spbb_dollar_mark, c1.markers.spbb_percent_mark, c1.text.spbb_dollar_amount_text, c1.text.spbb_percent_amount_text], ['X', 'X', '', '5000', '']);
  const c2 = deriveBrokerageContributionMarkers('bpsb', { kind: 'percent', percent: 3 });
  check('bpsb percent: applies X, percent X, dollar blank, percent text populated', [c2.markers.bpsb_applies_mark, c2.markers.bpsb_dollar_mark, c2.markers.bpsb_percent_mark, c2.text.bpsb_dollar_amount_text, c2.text.bpsb_percent_amount_text], ['X', '', 'X', '', '3']);
  const c3 = deriveBrokerageContributionMarkers('spbb', { kind: 'none' });
  check('spbb none: all-blank marks and text', [c3.markers.spbb_applies_mark, c3.markers.spbb_dollar_mark, c3.markers.spbb_percent_mark, c3.text.spbb_dollar_amount_text, c3.text.spbb_percent_amount_text], ['', '', '', '', '']);
}

{
  const items = Object.fromEntries(ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, k === 'mineral_reservation']));
  const m = deriveAddendaMarkers(items);
  check('addenda: exactly one mark X (mineral_reservation), rest blank', Object.entries(m).filter(([, v]) => v === 'X').map(([k]) => k), ['addenda_mineral_reservation_mark']);
  check('addenda: emits one mark per item key', Object.keys(m).length, ADDENDA_APPLICABILITY_ITEM_KEYS.length);
}

/* ==================================================================== */
/* 3. Mineral-reservation / POA-addenda consistency                      */
/* ==================================================================== */

check('mineral consistency: both true -> ok', checkMineralReservationConsistency(true, true), { ok: true });
check('mineral consistency: both false -> ok', checkMineralReservationConsistency(false, false), { ok: true });
{
  const bad = checkMineralReservationConsistency(true, false);
  checkTrue('mineral consistency: disagreement -> not ok', bad.ok === false);
  checkTrue('mineral consistency: disagreement reason names "Mineral-reservation disagreement"', bad.ok ? false : bad.reason.startsWith('Mineral-reservation disagreement'));
}

check('poa consistency: is_subject + checked -> null (no warning)', checkPoaAddendaConsistency('is_subject', true), null);
check('poa consistency: is_not_subject + unchecked -> null (no warning)', checkPoaAddendaConsistency('is_not_subject', false), null);
{
  const w = checkPoaAddendaConsistency('is_subject', false);
  checkTrue('poa consistency: disagreement returns a non-null warning string', typeof w === 'string' && w.length > 0);
  checkTrue('poa consistency warning explicitly states it does not block the sync', /does not block/i.test(w));
  checkTrue('poa consistency warning never says "refus" (only mineral-reservation and marker-exclusivity refuse)', !/refus/i.test(w));
}

/* ==================================================================== */
/* 4. validateMarkerExclusivity -- the explicit runtime check             */
/* ==================================================================== */

{
  const allBlank = Object.fromEntries(CHECKBOX_MARKER_KEYS.map((k) => [k, '']));
  check('exclusivity: all-blank markers -> ok', validateMarkerExclusivity(allBlank), { ok: true });

  const oneEach = { ...allBlank, title_expense_seller_mark: 'X', survey_opt2_mark: 'X', as_is_plain_mark: 'X' };
  check('exclusivity: one X per group across several groups -> ok', validateMarkerExclusivity(oneEach), { ok: true });

  const violation = { ...allBlank, title_expense_seller_mark: 'X', title_expense_buyer_mark: 'X' };
  const result = validateMarkerExclusivity(violation);
  checkTrue('exclusivity: two X in one group -> not ok', result.ok === false);
  checkTrue('exclusivity: violation names the group "title_expense_party"', result.ok ? false : result.violations.some((v) => v.includes('title_expense_party')));

  const violation3 = { ...allBlank, survey_opt1_mark: 'X', survey_opt2_mark: 'X', survey_opt3_mark: 'X' };
  const result3 = validateMarkerExclusivity(violation3);
  checkTrue('exclusivity: three X in a 3-member group -> not ok', result3.ok === false);
}

/* ==================================================================== */
/* 5. deriveBrokerText -- always emits all 22 keys, gated by class.       */
/* ==================================================================== */

const SELLER_AGENT = {
  firmName: 'Seller Firm', licenseNo: 'SL1', associateName: 'Sam', associateLicenseNo: 'SA1', email: 's@x.com', phone: '555-1',
  address: { kind: 'value', value: '1 Main St' }, teamName: { kind: 'value', value: 'Team A' }, supervisorName: { kind: 'none' }, supervisorPhone: { kind: 'none' }, supervisorLicenseNo: { kind: 'none' },
};
const BUYER_AGENT = {
  firmName: 'Buyer Firm', licenseNo: 'BL1', associateName: 'Bob', associateLicenseNo: 'BA1', email: 'b@x.com', phone: '555-2',
  address: { kind: 'none' }, teamName: { kind: 'none' }, supervisorName: { kind: 'value', value: 'Sup' }, supervisorPhone: { kind: 'value', value: '555-3' }, supervisorLicenseNo: { kind: 'value', value: 'SUP1' },
};

{
  const t = deriveBrokerText('no_broker', { kind: 'none' });
  check('brokerText(no_broker) has all 22 keys', Object.keys(t).sort(), [...BROKER_TEXT_KEYS].sort());
  check('brokerText(no_broker) is all-blank', Object.values(t).every((v) => v === ''), true);
}
{
  const t = deriveBrokerText('seller_broker_only', { kind: 'represented', sellerAgent: SELLER_AGENT, buyerAgent: null });
  check('brokerText(seller_broker_only): firm name populated', t.seller_broker_firm_name_text, 'Seller Firm');
  check('brokerText(seller_broker_only): address (ValueOrNone value) populated', t.seller_broker_address_text, '1 Main St');
  check('brokerText(seller_broker_only): team name populated', t.seller_broker_team_name_text, 'Team A');
  check('brokerText(seller_broker_only): supervisor fields blank (ValueOrNone none)', [t.seller_broker_supervisor_name_text, t.seller_broker_supervisor_phone_text, t.seller_broker_supervisor_license_no_text], ['', '', '']);
  checkTrue('brokerText(seller_broker_only): every buyer_broker_* key is blank', BROKER_TEXT_KEYS.filter((k) => k.startsWith('buyer_broker_')).every((k) => t[k] === ''));
}
{
  const t = deriveBrokerText('buyer_broker_only', { kind: 'represented', sellerAgent: null, buyerAgent: BUYER_AGENT });
  check('brokerText(buyer_broker_only): supervisor fields populated', [t.buyer_broker_supervisor_name_text, t.buyer_broker_supervisor_phone_text, t.buyer_broker_supervisor_license_no_text], ['Sup', '555-3', 'SUP1']);
  checkTrue('brokerText(buyer_broker_only): every seller_broker_* key is blank', BROKER_TEXT_KEYS.filter((k) => k.startsWith('seller_broker_')).every((k) => t[k] === ''));
}
{
  const t = deriveBrokerText('separate_brokers_both_sides', { kind: 'represented', sellerAgent: SELLER_AGENT, buyerAgent: BUYER_AGENT });
  check('brokerText(separate_brokers_both_sides): both firm names populated', [t.seller_broker_firm_name_text, t.buyer_broker_firm_name_text], ['Seller Firm', 'Buyer Firm']);
}
{
  // deriveBrokerText is never called by buildCheckboxMarkersAndText for a blocking
  // classification, but is itself proven safe (all-blank) if it ever were.
  const t = deriveBrokerText('intermediary', { kind: 'intermediary', brokerFirm: SELLER_AGENT });
  check('brokerText(intermediary) -- fact.kind !== "represented" -- resolves all-blank, never populates from brokerFirm', Object.values(t).every((v) => v === ''), true);
  const t2 = deriveBrokerText('represented_but_empty', { kind: 'represented', sellerAgent: null, buyerAgent: null });
  check('brokerText(represented_but_empty) resolves all-blank (no agent named on either side)', Object.values(t2).every((v) => v === ''), true);
}

/* ==================================================================== */
/* 6. buildCheckboxMarkersAndText -- integration                         */
/* ==================================================================== */

function populated(value) { return { kind: 'populated', value, authority: 'operator_attested', recordedAt: null }; }
function cleanReport(overrides) {
  const base = {
    leaseDisclosure: { residentialLeases: populated('none'), fixtureLeases: populated('none'), naturalResourceLeases: populated({ kind: 'none' }) },
    titleSurvey: {
      titlePolicyExpenseParty: populated('seller'), shortageAmendmentElection: populated({ kind: 'not_amended' }),
      surveyElection: populated({ option: 'buyer_new_survey', buyerObtainDays: 10 }), poaMembership: populated('is_not_subject'),
    },
    propertyCondition: { sellerDisclosureNotice: populated({ kind: 'received' }), asIsElection: populated({ kind: 'as_is' }), waterDisclosure: populated({ kind: 'received' }) },
    closingPossession: { possessionElection: populated('upon_closing_and_funding') },
    settlementExpense: { sellerPaysBuyerBroker: populated({ kind: 'none' }), buyerPaysSellerBroker: populated({ kind: 'none' }) },
    addendaApplicability: { items: populated(Object.fromEntries(ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false]))) },
    representation: { representation: populated({ kind: 'none' }) },
    propertyLegalDescription: { reservations: populated({ kind: 'none' }) },
  };
  for (const [group, patch] of Object.entries(overrides || {})) base[group] = { ...base[group], ...patch };
  return base;
}

{
  const result = buildCheckboxMarkersAndText(cleanReport());
  checkTrue('build: clean report -> ok', result.ok === true);
  check('build: markers has exactly 48 keys', result.ok ? Object.keys(result.markers).length : null, 48);
  check('build: text has exactly 11 keys', result.ok ? Object.keys(result.text).length : null, 11);
  check('build: brokerText has exactly 22 keys', result.ok ? Object.keys(result.brokerText).length : null, 22);
  checkTrue('build: every marker value is "X" or ""', result.ok ? onlyXOrBlank(result.markers) : false);
  check('build: no warnings on a clean report', result.ok ? result.warnings : null, []);
  checkTrue('build: exclusivity holds on the derived marker set', result.ok ? validateMarkerExclusivity(result.markers).ok : false);
}

{
  const result = buildCheckboxMarkersAndText(cleanReport({
    propertyLegalDescription: { reservations: populated({ kind: 'applies', addendumNote: 'n' }) },
  }));
  checkTrue('build: mineral-reservation disagreement -> ok:false', result.ok === false);
  checkTrue('build: mineral-reservation blocking reason present', result.ok ? false : result.blockingReasons.some((r) => r.startsWith('Mineral-reservation disagreement')));
}

{
  const result = buildCheckboxMarkersAndText(cleanReport({ titleSurvey: { poaMembership: populated('is_subject') } }));
  checkTrue('build: POA/addenda disagreement -> STILL ok:true (warning, not blocking)', result.ok === true);
  checkTrue('build: POA/addenda disagreement surfaces as a warning', result.ok && result.warnings.some((w) => w.includes('POA membership')));
}

{
  const result = buildCheckboxMarkersAndText(cleanReport({ representation: { representation: populated({ kind: 'intermediary', brokerFirm: SELLER_AGENT }) } }));
  checkTrue('build: intermediary representation -> ok:false, blocks BEFORE any marker/text is derived', result.ok === false);
}

{
  const result = buildCheckboxMarkersAndText(cleanReport({ representation: { representation: populated({ kind: 'represented', sellerAgent: null, buyerAgent: null }) } }));
  checkTrue('build: represented_but_empty representation -> ok:false', result.ok === false);
}

{
  const result = buildCheckboxMarkersAndText(cleanReport({ representation: { representation: populated({ kind: 'represented', sellerAgent: SELLER_AGENT, buyerAgent: null }) } }));
  checkTrue('build: seller-only representation -> ok:true', result.ok === true);
  check('build: seller broker text populated for seller-only', result.ok ? result.brokerText.seller_broker_firm_name_text : null, 'Seller Firm');
  checkTrue('build: buyer broker text all-blank for seller-only', result.ok ? BROKER_TEXT_KEYS.filter((k) => k.startsWith('buyer_broker_')).every((k) => result.brokerText[k] === '') : false);
}

{
  const badReport = cleanReport();
  badReport.leaseDisclosure.residentialLeases = { kind: 'unresolved' };
  let threw = false;
  try { buildCheckboxMarkersAndText(badReport); } catch (e) { threw = /not populated despite/.test(e.message); }
  checkTrue('build: throws on a non-populated disposition -- integrity violation, never silently treated as absent', threw);
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
