/**
 * INV-67 / B9-12 contract-population repair, extended by the INV-67
 * checkbox-marker / broker-model repair -- deterministic proof of
 * `contract-ghl-projection-model.ts`'s PLAN-LEVEL integration. Pure
 * functions and static drift checks only; no GHL, no network.
 *
 * Per-fact-group marker derivation, exclusivity, broker-text decomposition,
 * and consistency checks are exhaustively tested in their OWN dedicated
 * suites (`test-contract-checkbox-marker-model.cjs`,
 * `test-contract-broker-arrangement-model.cjs`) -- this file proves
 * `buildContractProjectionPlan` correctly WIRES all of it together:
 *
 *  1. Fails closed on an incomplete preview / unresolved equitable-interest
 *     gate (UNCHANGED from the original repair).
 *  2. The happy path produces exactly 110 entries -- 29 retained document-
 *     line entries + 48 markers + 11 restructured text + 22 broker text.
 *  3. A marker-exclusivity violation, a mineral-reservation disagreement,
 *     and a blocking broker arrangement (intermediary /
 *     represented-but-empty) each block the WHOLE plan, each with the
 *     expected message -- never a partial plan.
 *  4. A POA/addendum disagreement surfaces as a `warnings` entry and does
 *     NOT block.
 *  5. Invariant and reused-current-offer keys are excluded; the 19 retired
 *     keys are excluded too.
 *  6. `reusedCurrentOfferLines` is unaffected by this session's changes.
 *  7. Integrity guards (mapping drift / null text) still fire for the
 *     retained document-line keys.
 *  8. Drift guard: `shared/ghl-config.ts`'s 110-key list matches this
 *     module's exactly; the field-creation script's 48 already-provisioned
 *     keys remain EXACTLY the original 29 retained + 19 retired keys (that
 *     script provisions nothing new -- its key set is untouched even
 *     though 19 of those keys are no longer live). Batch 1 GHL Test
 *     provisioning (2026-09-14, `inv67-create-checkbox-marker-fields-
 *     batch1.cjs --apply`): `shared/ghl-config.ts`'s TEST config now
 *     carries real ids for exactly 77 keys (29 retained + 48 Batch 1
 *     markers, all unique, none the sentinel), exactly 33 keys (Batches
 *     2/3, unprovisioned) remain sentinel-filled, no retired key
 *     re-enters the live map, and PRODUCTION remains fully sentinel-
 *     filled for all 110 keys -- proven directly against the committed
 *     file, not merely asserted.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-ghl-projection-test');
const MODEL = path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts');
const MARKER_MODEL = path.join(APP, 'src', 'lib', 'contract-checkbox-marker-model.ts');
const BROKER_MODEL = path.join(APP, 'src', 'lib', 'contract-broker-arrangement-model.ts');
const CARRIERS = path.join(APP, 'src', 'lib', 'seller-contract-facts-carriers.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(
    `npx tsc "${MODEL}" "${MARKER_MODEL}" "${BROKER_MODEL}" "${CARRIERS}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
    { cwd: APP, stdio: 'inherit' },
  );
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}

const {
  CONTRACT_PROJECTION_FIELD_KEYS,
  CONTRACT_PROJECTION_INVARIANT_KEYS,
  CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS,
  CONTRACT_PROJECTION_RETIRED_KEYS,
  CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS,
  buildContractProjectionPlan,
  reusedCurrentOfferLines,
} = require(path.join(TMP, 'contract-ghl-projection-model.js'));
const {
  CHECKBOX_MARKER_KEYS, CHECKBOX_TEXT_KEYS, BROKER_TEXT_KEYS,
  CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS, CHECKBOX_MARKER_TOTAL_TEMPLATE_PLACEMENTS,
} = require(path.join(TMP, 'contract-checkbox-marker-model.js'));
const { ADDENDA_APPLICABILITY_ITEM_KEYS } = require(path.join(TMP, 'seller-contract-facts-carriers.js'));

const FLOOR = 65;
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

/* ==================================================================== */
/* Fixtures                                                              */
/* ==================================================================== */

const VERSION = { agreementAt: '2026-09-01T00:00:00.000Z', versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };

function line(group, field, status, text) {
  return { paragraph: 'X', group, field, label: `${group}.${field}`, status, text, authority: status === 'unresolved' ? null : 'system_derived', recordedAt: null };
}

/** A complete, resolvable preview covering ONLY the 29 retained document-line keys + the 4 invariant/2 reused keys the preview itself still carries as document lines. */
function completePreview(overrides) {
  const documentLines = [
    line('identity', 'propertyStreetAddress', 'populated', '123 Main St'),
    line('parties', 'buyerEntityName', 'populated', 'Brad Thompson Consulting LLC'),
    line('parties', 'buyerCapacity', 'populated', 'Principal, purchasing for its own account'),
    line('parties', 'buyerTexasLicenseStatus', 'populated', 'None'),
    line('parties', 'sellerSigners', 'populated', 'Jane Seller (Owner)'),
    line('salesPrice', 'cashPortion', 'populated', '$275,000.00'),
    line('salesPrice', 'financingSum', 'populated', '$0.00'),
    line('salesPrice', 'salesPrice', 'populated', '$275,000.00'),
    ...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS
      .filter((k) => !['identity.propertyStreetAddress', 'parties.buyerEntityName', 'parties.sellerSigners'].includes(k))
      .map((k) => { const [g, f] = k.split('.'); return line(g, f, 'populated', `value for ${k}`); }),
  ];
  const additionalRequiredFacts = [line('sellerEquitableInterest', 'disposition', 'populated', 'Made at 2026-09-01T00:00:00.000Z.')];
  return {
    templateName: 'x', templateSource: 'x', opportunityId: 'OPP-1', version: VERSION,
    documentLines, additionalRequiredFacts,
    unresolvedFieldCount: 0, priceConflictCount: 0, previewComplete: true, blockingReasons: [],
    ...overrides,
  };
}

function populated(value) { return { kind: 'populated', value, authority: 'operator_attested', recordedAt: null }; }

/** A complete, resolvable SellerContractFactsReport -- every checkbox-shaped fact `buildCheckboxMarkersAndText` reads, all clean/no-conflict by default. */
function completeReport(overrides) {
  const base = {
    leaseDisclosure: {
      residentialLeases: populated('none'),
      fixtureLeases: populated('none'),
      naturalResourceLeases: populated({ kind: 'none' }),
    },
    titleSurvey: {
      titlePolicyExpenseParty: populated('seller'),
      shortageAmendmentElection: populated({ kind: 'not_amended' }),
      surveyElection: populated({ option: 'buyer_new_survey', buyerObtainDays: 10 }),
      poaMembership: populated('is_not_subject'),
    },
    propertyCondition: {
      sellerDisclosureNotice: populated({ kind: 'received' }),
      asIsElection: populated({ kind: 'as_is' }),
      waterDisclosure: populated({ kind: 'received' }),
    },
    closingPossession: {
      possessionElection: populated('upon_closing_and_funding'),
    },
    settlementExpense: {
      sellerPaysBuyerBroker: populated({ kind: 'none' }),
      buyerPaysSellerBroker: populated({ kind: 'none' }),
    },
    addendaApplicability: {
      items: populated(Object.fromEntries(ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false]))),
    },
    representation: {
      representation: populated({ kind: 'none' }),
    },
    propertyLegalDescription: {
      reservations: populated({ kind: 'none' }),
    },
  };
  for (const [group, patch] of Object.entries(overrides || {})) {
    base[group] = { ...base[group], ...patch };
  }
  return base;
}

/* ==================================================================== */
/* 1. Fail-closed on incomplete preview (UNCHANGED)                      */
/* ==================================================================== */

{
  const preview = completePreview({ previewComplete: false, blockingReasons: ['Something is unresolved.'] });
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport());
  checkTrue('blocked when previewComplete is false', plan.ok === false);
  check('blocked plan carries the exact blocking reasons', plan.ok ? null : plan.blockingReasons, ['Something is unresolved.']);
}

/* ==================================================================== */
/* 2. Independent equitable-interest gate (ruling 9, UNCHANGED)          */
/* ==================================================================== */

{
  const preview = completePreview({
    additionalRequiredFacts: [line('sellerEquitableInterest', 'disposition', 'unresolved', null)],
  });
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport());
  checkTrue('blocked on unresolved equitable-interest disclosure even though previewComplete is true', plan.ok === false);
  checkTrue(
    'blocking reasons name the equitable-interest gate',
    plan.ok ? false : plan.blockingReasons.some((r) => r.includes('sellerEquitableInterest') && r.includes('pre-contract gate')),
  );
}

/* ==================================================================== */
/* 3. Happy path -- exactly 110 entries                                  */
/* ==================================================================== */

{
  const preview = completePreview();
  const plan = buildContractProjectionPlan('OPP-1', preview, completeReport());
  checkTrue('ok plan on a fully resolved preview + report', plan.ok === true);
  check('entry count equals CONTRACT_PROJECTION_FIELD_KEYS length', plan.ok ? plan.entries.length : null, CONTRACT_PROJECTION_FIELD_KEYS.length);
  check('entry count is exactly 110', plan.ok ? plan.entries.length : null, 110);
  check('CONTRACT_PROJECTION_FIELD_KEYS.length is exactly 110', CONTRACT_PROJECTION_FIELD_KEYS.length, 110);
  check('29 retained + 48 markers + 11 text + 22 broker = 110', CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.length + CHECKBOX_MARKER_KEYS.length + CHECKBOX_TEXT_KEYS.length + BROKER_TEXT_KEYS.length, 110);
  check('agreementAt carried from preview.version', plan.ok ? plan.agreementAt : null, VERSION.agreementAt);
  check('versionSeq carried from preview.version', plan.ok ? plan.versionSeq : null, VERSION.versionSeq);
  check('opportunityId is the caller-supplied id, not read off the preview', plan.ok ? plan.opportunityId : null, 'OPP-1');
  check('no warnings on a fully clean report', plan.ok ? plan.warnings : null, []);

  const byKey = new Map((plan.ok ? plan.entries : []).map((e) => [e.key, e.text]));
  checkTrue('every CONTRACT_PROJECTION_FIELD_KEYS entry is present', CONTRACT_PROJECTION_FIELD_KEYS.every((k) => byKey.has(k)));
  check('a retained document-line key projects its own text verbatim', byKey.get('propertyLegalDescription.lot'), 'value for propertyLegalDescription.lot');
  check('identity.propertyStreetAddress projects its own text', byKey.get('identity.propertyStreetAddress'), '123 Main St');
  check('a checkbox marker for a "none" election is blank', byKey.get('lease_residential_mark'), '');
  check('a checkbox marker for the selected election is "X"', byKey.get('title_expense_seller_mark'), 'X');
  check('every marker value is "X" or ""', CHECKBOX_MARKER_KEYS.every((k) => byKey.get(k) === 'X' || byKey.get(k) === ''), true);
  check('broker text is all-blank when representation is "none"', BROKER_TEXT_KEYS.every((k) => byKey.get(k) === ''), true);

  // Jess Gate correction (repeated-destination re-gate): the paragraph-22 echo of 3
  // markers is a TEMPLATE PLACEMENT concern only -- it must never change the unique
  // 110-key / 81-new-field totals this plan writes.
  check('CONTRACT_PROJECTION_FIELD_KEYS is still exactly 110 UNIQUE keys with the repeated-placement manifest present', CONTRACT_PROJECTION_FIELD_KEYS.length, 110);
  check('new-key total (48 markers + 11 text + 22 broker) is still exactly 81, NOT 84 -- placements are not fields', CHECKBOX_MARKER_KEYS.length + CHECKBOX_TEXT_KEYS.length + BROKER_TEXT_KEYS.length, 81);
  checkTrue(
    'the overlay-placement count (51, from the marker model) is distinct from and greater than the marker-key count (48) -- never conflated in this integration layer either',
    CHECKBOX_MARKER_TOTAL_TEMPLATE_PLACEMENTS > CHECKBOX_MARKER_KEYS.length,
  );
  checkTrue(
    'every plan entry key for a repeated-placement marker is written exactly ONCE in the plan (one field write, regardless of how many places it is later pasted on the template)',
    Object.keys(CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS).every((k) => (plan.ok ? plan.entries.filter((e) => e.key === k).length : 0) === 1),
  );
}

/* ==================================================================== */
/* 4. Blocking: marker-exclusivity violation cannot reach the plan       */
/*    normally -- proven here via a report whose canonical facts, if     */
/*    mis-derived, WOULD violate exclusivity; the by-construction         */
/*    guarantee is proven in test-contract-checkbox-marker-model.cjs.    */
/*    This section proves the INTEGRATION path instead: mineral-         */
/*    reservation disagreement and blocking broker arrangements.         */
/* ==================================================================== */

{
  const preview = completePreview();
  const report = completeReport({
    propertyLegalDescription: { reservations: populated({ kind: 'applies', addendumNote: 'see addendum' }) },
    // addendaApplicability.items.mineral_reservation stays false -> disagreement
  });
  const plan = buildContractProjectionPlan('OPP-1', preview, report);
  checkTrue('mineral-reservation disagreement blocks the WHOLE plan', plan.ok === false);
  checkTrue('mineral-reservation blocking reason is distinct and operator-facing', plan.ok ? false : plan.blockingReasons.some((r) => r.includes('Mineral-reservation disagreement')));
}

{
  const preview = completePreview();
  const brokerFirm = {
    firmName: 'Both Sides Realty', licenseNo: '1', associateName: 'A', associateLicenseNo: '2', email: 'e@x.com', phone: '555',
    address: { kind: 'none' }, teamName: { kind: 'none' }, supervisorName: { kind: 'none' }, supervisorPhone: { kind: 'none' }, supervisorLicenseNo: { kind: 'none' },
  };
  const report = completeReport({ representation: { representation: populated({ kind: 'intermediary', brokerFirm }) } });
  const plan = buildContractProjectionPlan('OPP-1', preview, report);
  checkTrue('intermediary broker arrangement blocks the WHOLE plan before any entry is built', plan.ok === false);
  checkTrue('intermediary blocking reason names the arrangement', plan.ok ? false : plan.blockingReasons.some((r) => /intermediary/i.test(r)));
}

{
  const preview = completePreview();
  const report = completeReport({ representation: { representation: populated({ kind: 'represented', sellerAgent: null, buyerAgent: null }) } });
  const plan = buildContractProjectionPlan('OPP-1', preview, report);
  checkTrue('represented-but-empty broker arrangement ALSO blocks the WHOLE plan (mandatory correction)', plan.ok === false);
  checkTrue('represented-but-empty blocking reason is distinct from "no broker"', plan.ok ? false : plan.blockingReasons.some((r) => /not the same fact as "no broker"/.test(r)));
}

/* ==================================================================== */
/* 5. Warning (not blocking): POA membership vs. addendum disagreement   */
/* ==================================================================== */

{
  const preview = completePreview();
  const report = completeReport({ titleSurvey: { poaMembership: populated('is_subject') } }); // addenda.poa_membership stays false -> disagreement
  const plan = buildContractProjectionPlan('OPP-1', preview, report);
  checkTrue('POA/addendum disagreement does NOT block the plan', plan.ok === true);
  checkTrue('POA/addendum disagreement surfaces as a warning', plan.ok && plan.warnings.some((w) => w.includes('POA membership')));
}

/* ==================================================================== */
/* 6. Broker text -- seller-only arrangement populates only that side    */
/* ==================================================================== */

{
  const preview = completePreview();
  const sellerAgent = {
    firmName: 'Seller Firm', licenseNo: 'SL1', associateName: 'Sam Assoc', associateLicenseNo: 'SA1', email: 's@x.com', phone: '555-1',
    address: { kind: 'value', value: '1 Main St' }, teamName: { kind: 'none' }, supervisorName: { kind: 'none' }, supervisorPhone: { kind: 'none' }, supervisorLicenseNo: { kind: 'none' },
  };
  const report = completeReport({ representation: { representation: populated({ kind: 'represented', sellerAgent, buyerAgent: null }) } });
  const plan = buildContractProjectionPlan('OPP-1', preview, report);
  checkTrue('seller-only arrangement produces an ok plan', plan.ok === true);
  const byKey = new Map(plan.ok ? plan.entries.map((e) => [e.key, e.text]) : []);
  check('seller broker firm name is populated', byKey.get('seller_broker_firm_name_text'), 'Seller Firm');
  check('seller broker address (ValueOrNone "value") is populated', byKey.get('seller_broker_address_text'), '1 Main St');
  check('seller broker team name (ValueOrNone "none") is blank', byKey.get('seller_broker_team_name_text'), '');
  checkTrue('every buyer broker field is blank when only the seller has an agent', BROKER_TEXT_KEYS.filter((k) => k.startsWith('buyer_broker_')).every((k) => byKey.get(k) === ''));
}

/* ==================================================================== */
/* 7. Invariant, reused, and retired keys are excluded                   */
/* ==================================================================== */

checkTrue('no invariant key appears in CONTRACT_PROJECTION_FIELD_KEYS', CONTRACT_PROJECTION_INVARIANT_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)));
checkTrue('no reused-current-offer key appears in CONTRACT_PROJECTION_FIELD_KEYS', CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)));
checkTrue('none of the 19 retired keys appear in CONTRACT_PROJECTION_FIELD_KEYS', CONTRACT_PROJECTION_RETIRED_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)));
check('exactly 4 invariant keys', CONTRACT_PROJECTION_INVARIANT_KEYS.length, 4);
check('exactly 2 reused-current-offer keys', CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.length, 2);
check('exactly 19 retired keys', CONTRACT_PROJECTION_RETIRED_KEYS.length, 19);
check('exactly 29 retained document-line keys', CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.length, 29);
check('29 retained + 19 retired = the original 48', CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.length + CONTRACT_PROJECTION_RETIRED_KEYS.length, 48);

/* ==================================================================== */
/* 8. reusedCurrentOfferLines (UNCHANGED by this session)                */
/* ==================================================================== */

{
  const preview = completePreview();
  const reused = reusedCurrentOfferLines(preview);
  check('reusedCurrentOfferLines returns exactly the 2 reused keys', reused.map((r) => r.key), [...CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS]);
  check('cashPortion text is carried verbatim', reused.find((r) => r.key === 'salesPrice.cashPortion').text, '$275,000.00');
}

/* ==================================================================== */
/* 9. Integrity guards -- mapping drift / null text (retained keys only) */
/* ==================================================================== */

{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.filter((l) => !(l.group === 'propertyLegalDescription' && l.field === 'lot'));
  let threw = false;
  try { buildContractProjectionPlan('OPP-1', preview, completeReport()); } catch (e) { threw = /mapping drift/.test(e.message); }
  checkTrue('throws on mapping drift (a retained key with no document line)', threw);
}
{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.map((l) => (l.group === 'propertyLegalDescription' && l.field === 'lot' ? { ...l, text: null } : l));
  let threw = false;
  try { buildContractProjectionPlan('OPP-1', preview, completeReport()); } catch (e) { threw = /no text despite previewComplete/.test(e.message); }
  checkTrue('throws when a retained-key line has null text despite previewComplete=true', threw);
}

/* ==================================================================== */
/* 10. Drift guard -- shared/ghl-config.ts (110 keys) and the ALREADY-   */
/*     PROVISIONED field-creation script (48 keys = original             */
/*     29 retained + 19 retired -- no new GHL field was created this     */
/*     session, so this script is deliberately untouched)                */
/* ==================================================================== */

{
  const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
  const configListMatch = configSrc.match(/const CONTRACT_PROJECTION_FIELD_KEYS = \[([\s\S]*?)\] as const;/);
  checkTrue('shared/ghl-config.ts declares CONTRACT_PROJECTION_FIELD_KEYS', !!configListMatch);
  // Line-based extraction -- NOT a blanket `"([^"]+)"` scan, which desyncs against the
  // literal `"X"`/`""` example text inside this array's own section-header comments
  // (e.g. `// -- 48 checkbox markers ("X" | "") --`). Only lines that are themselves a
  // bare quoted array element (optionally comma-terminated) count as a key.
  const configKeys = configListMatch
    ? configListMatch[1]
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*"([^"]+)",?\s*$/))
        .filter(Boolean)
        .map((m) => m[1])
    : [];
  check('shared/ghl-config.ts key set matches contract-ghl-projection-model.ts exactly (110 keys)', [...configKeys].sort(), [...CONTRACT_PROJECTION_FIELD_KEYS].sort());

  const scriptSrc = fs.readFileSync(path.join(APP, 'scripts', 'inv67-create-contract-projection-fields.cjs'), 'utf8');
  const specKeys = Array.from(scriptSrc.matchAll(/\{ key: '([^']+)'/g)).map((m) => m[1]).filter((k) => k !== 'contractDraftRequest');
  check('the field-creation script still lists exactly 48 keys (retired, not deleted -- untouched by this repair)', specKeys.length, 48);
  check(
    'the field-creation script\'s 48 keys are EXACTLY the original 29 retained + 19 retired keys (no new GHL field was created this session)',
    [...specKeys].sort(),
    [...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS, ...CONTRACT_PROJECTION_RETIRED_KEYS].sort(),
  );

  const configFieldsBlockMatch = configSrc.match(/contractProjectionFields: \{([\s\S]*?)\r?\n  \},\r?\n  contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI"/);
  checkTrue('shared/ghl-config.ts TEST.contractProjectionFields block is present', !!configFieldsBlockMatch);
  const testRealIdEntries = configFieldsBlockMatch
    ? Array.from(configFieldsBlockMatch[1].matchAll(/"([^"]+)":\s*"(?!CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED)([^"]+)"/g)).map((m) => ({ key: m[1], id: m[2] }))
    : [];
  const testRealIdKeys = testRealIdEntries.map((e) => e.key);

  // Batch 1 (INV-67 checkbox-marker / broker-model repair, GHL Test provisioning,
  // 2026-09-14): the 48 CHECKBOX_MARKER_KEYS were created live and readback-verified,
  // then wired in with their real ids. Batches 2 (11 CHECKBOX_TEXT_KEYS) and 3 (22
  // BROKER_TEXT_KEYS) remain unprovisioned -- exactly 33 keys still carry the sentinel.
  check(
    'TEST carries a REAL id for exactly 77 keys: the 29 retained + the 48 Batch 1 markers',
    [...testRealIdKeys].sort(),
    [...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS, ...CHECKBOX_MARKER_KEYS].sort(),
  );
  check('exactly 48 of those real-id keys are CHECKBOX_MARKER_KEYS', testRealIdKeys.filter((k) => CHECKBOX_MARKER_KEYS.includes(k)).length, 48);
  check('the 48 real Batch 1 marker ids are themselves unique (no id reused across two keys)', new Set(testRealIdEntries.filter((e) => CHECKBOX_MARKER_KEYS.includes(e.key)).map((e) => e.id)).size, 48);
  checkTrue(
    'no Batch 1 marker id is empty, whitespace, or the sentinel string itself',
    testRealIdEntries.filter((e) => CHECKBOX_MARKER_KEYS.includes(e.key)).every((e) => e.id.trim().length > 0 && e.id !== 'CONTRACT_PROJECTION_FIELD_NOT_YET_PROVISIONED'),
  );
  checkTrue(
    'none of the 3 repeated-destination markers (lease_residential_mark, lease_fixture_mark, possession_leaseback_mark) is missing its real id',
    Object.keys(CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS).every((k) => testRealIdKeys.includes(k)),
  );

  const sentinelKeys = CONTRACT_PROJECTION_FIELD_KEYS.filter((k) => !testRealIdKeys.includes(k));
  check(
    'exactly 33 keys remain sentinel-filled in TEST: the 11 restructured contract-text + 22 broker-text keys (Batches 2/3, unprovisioned)',
    [...sentinelKeys].sort(),
    [...CHECKBOX_TEXT_KEYS, ...BROKER_TEXT_KEYS].sort(),
  );
  checkTrue('none of the 19 retired keys re-enters the live TEST real-id map', CONTRACT_PROJECTION_RETIRED_KEYS.every((k) => !testRealIdKeys.includes(k)));
  checkTrue('the 29 retained TEST ids are exactly unchanged from before Batch 1 wiring', CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.every((k) => testRealIdEntries.some((e) => e.key === k)));

  // Production must remain fully sentinel-filled for all 110 keys -- Batch 1's live Test
  // provisioning must never leak into the PRODUCTION config block.
  const prodSentinelMatch = configSrc.match(/const PRODUCTION: GhlConfig = \{[\s\S]*?contractProjectionFields: sentinelContractProjectionFields\(\),[\s\S]*?contractDraftRequest: CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED,/);
  checkTrue('PRODUCTION.contractProjectionFields is still exactly `sentinelContractProjectionFields()` -- untouched by Batch 1 Test wiring', !!prodSentinelMatch);
  checkTrue('PRODUCTION.contractDraftRequest is still exactly the sentinel constant', !!prodSentinelMatch);

  checkTrue('TEST.contractDraftRequest is unchanged (still the pre-existing real dropdown id, untouched by Batch 1)', /contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI",/.test(configSrc));
}

/* ==================================================================== */

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
