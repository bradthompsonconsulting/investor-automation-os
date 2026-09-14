/**
 * INV-67 / B9-12 contract-population repair -- deterministic proof of
 * `contract-ghl-projection-model.ts`. Pure functions and static drift checks
 * only; no GHL, no network.
 *
 * Proves:
 *  1. The plan fails closed when the preview is incomplete, and reproduces
 *     the exact blocking reasons -- no partial plan.
 *  2. The plan fails closed on an unresolved `sellerEquitableInterest`
 *     additional-required-fact even when `previewComplete` itself is true
 *     (the independent gate this module adds -- see its own header).
 *  3. Every one of the 48 keys in `CONTRACT_PROJECTION_FIELD_KEYS` produces
 *     exactly one entry, carrying the document line's own `text` verbatim
 *     (never re-rendered).
 *  4. The four invariant keys and the two reused-current-offer keys are
 *     NEVER present in `CONTRACT_PROJECTION_FIELD_KEYS` -- no duplicate
 *     field, no field for a proven-invariant fact.
 *  5. `reusedCurrentOfferLines` returns exactly the two sales-price document
 *     lines' text, keyed correctly.
 *  6. Drift guard: the 48-key list is IDENTICAL (same set) across this
 *     module, `shared/ghl-config.ts`'s duplicated list, and
 *     `scripts/inv67-create-contract-projection-fields.cjs`'s FIELD_SPECS.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-contract-ghl-projection-test');
const MODEL = path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(
    `npx tsc "${MODEL}" --outDir "${TMP}" --module commonjs --target es2020 --strict`,
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
  buildContractProjectionPlan,
  reusedCurrentOfferLines,
} = require(path.join(TMP, 'contract-ghl-projection-model.js'));

const FLOOR = 32;
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

/** A complete, resolvable preview: every documentLines key + the equitable-interest additional fact populated. */
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
    ...CONTRACT_PROJECTION_FIELD_KEYS
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

/* ==================================================================== */
/* 1. Fail-closed on incomplete preview                                  */
/* ==================================================================== */

{
  const preview = completePreview({ previewComplete: false, blockingReasons: ['Something is unresolved.'] });
  const plan = buildContractProjectionPlan('OPP-1', preview);
  checkTrue('blocked when previewComplete is false', plan.ok === false);
  check('blocked plan carries the exact blocking reasons', plan.ok ? null : plan.blockingReasons, ['Something is unresolved.']);
}

/* ==================================================================== */
/* 2. Independent equitable-interest gate (ruling 9)                     */
/* ==================================================================== */

{
  const preview = completePreview({
    additionalRequiredFacts: [line('sellerEquitableInterest', 'disposition', 'unresolved', null)],
  });
  checkTrue('fixture sanity: previewComplete is true despite unresolved equitable interest', preview.previewComplete === true);
  const plan = buildContractProjectionPlan('OPP-1', preview);
  checkTrue('blocked on unresolved equitable-interest disclosure even though previewComplete is true', plan.ok === false);
  checkTrue(
    'blocking reasons name the equitable-interest gate',
    plan.ok ? false : plan.blockingReasons.some((r) => r.includes('sellerEquitableInterest') && r.includes('pre-contract gate')),
  );
}

/* ==================================================================== */
/* 3. Happy path -- exactly 48 entries, verbatim text                    */
/* ==================================================================== */

{
  const preview = completePreview();
  const plan = buildContractProjectionPlan('OPP-1', preview);
  checkTrue('ok plan on a fully resolved preview', plan.ok === true);
  check('entry count equals CONTRACT_PROJECTION_FIELD_KEYS length', plan.ok ? plan.entries.length : null, CONTRACT_PROJECTION_FIELD_KEYS.length);
  check('entry count is exactly 48', plan.ok ? plan.entries.length : null, 48);
  check('agreementAt carried from preview.version', plan.ok ? plan.agreementAt : null, VERSION.agreementAt);
  check('versionSeq carried from preview.version', plan.ok ? plan.versionSeq : null, VERSION.versionSeq);
  check('opportunityId is the caller-supplied id, not read off the preview', plan.ok ? plan.opportunityId : null, 'OPP-1');

  const byKey = new Map((plan.ok ? plan.entries : []).map((e) => [e.key, e.text]));
  checkTrue('every CONTRACT_PROJECTION_FIELD_KEYS entry is present', CONTRACT_PROJECTION_FIELD_KEYS.every((k) => byKey.has(k)));
  check('text is verbatim from the document line', byKey.get('propertyLegalDescription.lot'), 'value for propertyLegalDescription.lot');
  check('identity.propertyStreetAddress projects its own text', byKey.get('identity.propertyStreetAddress'), '123 Main St');
}

/* ==================================================================== */
/* 4. Not-applicable ("None") lines project their resolved text          */
/* ==================================================================== */

{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.map((l) =>
    l.group === 'leaseDisclosure' && l.field === 'naturalResourceLeases'
      ? { ...l, status: 'not_applicable', text: 'None.' }
      : l,
  );
  const plan = buildContractProjectionPlan('OPP-1', preview);
  checkTrue('ok plan when a field is not_applicable, not unresolved', plan.ok === true);
  const entry = plan.ok ? plan.entries.find((e) => e.key === 'leaseDisclosure.naturalResourceLeases') : null;
  check('not_applicable disposition projects its own resolved "None." text', entry ? entry.text : null, 'None.');
}

/* ==================================================================== */
/* 5. Invariant and reused-current-offer keys are excluded               */
/* ==================================================================== */

checkTrue(
  'no invariant key appears in CONTRACT_PROJECTION_FIELD_KEYS',
  CONTRACT_PROJECTION_INVARIANT_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)),
);
checkTrue(
  'no reused-current-offer key appears in CONTRACT_PROJECTION_FIELD_KEYS',
  CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.every((k) => !CONTRACT_PROJECTION_FIELD_KEYS.includes(k)),
);
check('exactly 4 invariant keys', CONTRACT_PROJECTION_INVARIANT_KEYS.length, 4);
check('exactly 2 reused-current-offer keys', CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.length, 2);
check('48 + 4 + 2 = 54 = the full documentLines count this fixture carries', CONTRACT_PROJECTION_FIELD_KEYS.length + CONTRACT_PROJECTION_INVARIANT_KEYS.length + CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS.length, 54);

/* ==================================================================== */
/* 6. reusedCurrentOfferLines                                            */
/* ==================================================================== */

{
  const preview = completePreview();
  const reused = reusedCurrentOfferLines(preview);
  check('reusedCurrentOfferLines returns exactly the 2 reused keys', reused.map((r) => r.key), [...CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS]);
  check('cashPortion text is carried verbatim', reused.find((r) => r.key === 'salesPrice.cashPortion').text, '$275,000.00');
  check('salesPrice text is carried verbatim', reused.find((r) => r.key === 'salesPrice.salesPrice').text, '$275,000.00');
}
{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.filter((l) => !(l.group === 'salesPrice' && l.field === 'cashPortion'));
  const reused = reusedCurrentOfferLines(preview);
  check('a missing document line reads as null text, never throws', reused.find((r) => r.key === 'salesPrice.cashPortion').text, null);
}

/* ==================================================================== */
/* 7. Integrity guards -- mapping drift / null text despite completeness */
/* ==================================================================== */

{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.filter((l) => !(l.group === 'propertyLegalDescription' && l.field === 'lot'));
  let threw = false;
  try { buildContractProjectionPlan('OPP-1', preview); } catch (e) { threw = /mapping drift/.test(e.message); }
  checkTrue('throws on mapping drift (a projected key with no document line)', threw);
}
{
  const preview = completePreview();
  preview.documentLines = preview.documentLines.map((l) =>
    l.group === 'propertyLegalDescription' && l.field === 'lot' ? { ...l, text: null } : l,
  );
  let threw = false;
  try { buildContractProjectionPlan('OPP-1', preview); } catch (e) { threw = /no text despite previewComplete/.test(e.message); }
  checkTrue('throws when a line has null text despite previewComplete=true', threw);
}

/* ==================================================================== */
/* 8. Drift guard -- shared/ghl-config.ts and the field-creation script  */
/*    duplicate the SAME 48-key set (kept in sync by hand, per each      */
/*    file's own header comment)                                        */
/* ==================================================================== */

{
  const configSrc = fs.readFileSync(path.join(APP, 'shared', 'ghl-config.ts'), 'utf8');
  const configListMatch = configSrc.match(/const CONTRACT_PROJECTION_FIELD_KEYS = \[([\s\S]*?)\] as const;/);
  checkTrue('shared/ghl-config.ts declares CONTRACT_PROJECTION_FIELD_KEYS', !!configListMatch);
  const configKeys = configListMatch
    ? Array.from(configListMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1])
    : [];
  check('shared/ghl-config.ts key set matches contract-ghl-projection-model.ts exactly', [...configKeys].sort(), [...CONTRACT_PROJECTION_FIELD_KEYS].sort());

  const scriptSrc = fs.readFileSync(path.join(APP, 'scripts', 'inv67-create-contract-projection-fields.cjs'), 'utf8');
  const specKeys = Array.from(scriptSrc.matchAll(/\{ key: '([^']+)'/g)).map((m) => m[1]).filter((k) => k !== 'contractDraftRequest');
  check('inv67-create-contract-projection-fields.cjs FIELD_SPECS key set matches exactly', [...specKeys].sort(), [...CONTRACT_PROJECTION_FIELD_KEYS].sort());

  const configFieldsBlockMatch = configSrc.match(/contractProjectionFields: \{([\s\S]*?)\r?\n  \},\r?\n  contractDraftRequest: "GlbJxxrxnvMkwJSRNUwI"/);
  checkTrue('shared/ghl-config.ts TEST.contractProjectionFields block is present with real ids', !!configFieldsBlockMatch);
  const testIdKeys = configFieldsBlockMatch
    ? Array.from(configFieldsBlockMatch[1].matchAll(/"([^"]+)":\s*"[^"]+"/g)).map((m) => m[1])
    : [];
  check('TEST.contractProjectionFields carries an id for every one of the 48 keys', [...testIdKeys].sort(), [...CONTRACT_PROJECTION_FIELD_KEYS].sort());
}

/* ==================================================================== */

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
