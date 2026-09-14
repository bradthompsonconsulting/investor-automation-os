/**
 * INV-67 / B9-12 contract-population repair -- creates the 48 narrowly-scoped
 * Opportunity custom fields `src/lib/contract-ghl-projection-model.ts`'s
 * `CONTRACT_PROJECTION_FIELD_KEYS` requires, plus the ONE Contract Draft
 * Request one-shot dropdown field. Mirrors
 * `inv70-create-current-offer-field.cjs`'s proven pattern exactly: READ-ONLY
 * DRY RUN BY DEFAULT, --apply to actually POST, always confirms no
 * name/fieldKey clash first (a re-run never creates a duplicate), always
 * reads each created field back.
 *
 * NO LOCATION SELECTOR. --location is required, no default -- this script
 * must never guess which environment it targets, and per this repair's
 * authorization it must never be pointed at anything but IAOS Test.
 *
 * Usage:
 *   node scripts/inv67-create-contract-projection-fields.cjs --location <id>
 *                                                             --credential-file <path>
 *                                                             [--apply]
 *                                                             [--only <key>]
 */
const fs = require('fs');

const BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

function die(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const location = get('--location');
  if (!location) die('--location is required. There is no default and no fallback.');
  const credentialFile = get('--credential-file');
  if (!credentialFile) die('--credential-file is required. There is no default and no fallback.');
  return { location, credentialFile, apply: argv.includes('--apply'), only: get('--only') };
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function get(token, url) {
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for GET ${url.replace(BASE, '')}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function expectedFieldKey(name) {
  return 'opportunity.' + name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * The 48 projected keys plus the one dropdown control. MUST match
 * `src/lib/contract-ghl-projection-model.ts`'s `CONTRACT_PROJECTION_FIELD_KEYS`
 * exactly (same key set) -- `scripts/test-contract-ghl-projection.cjs`'s
 * drift check enforces this against that module and against
 * `shared/ghl-config.ts`'s own duplicated list.
 */
const FIELD_SPECS = [
  { key: 'identity.propertyStreetAddress', name: 'Contract Property Street Address', dataType: 'TEXT' },
  { key: 'parties.buyerEntityName', name: 'Contract Buyer Entity Name', dataType: 'TEXT' },
  { key: 'parties.sellerSigners', name: 'Contract Seller Signers', dataType: 'TEXT' },
  { key: 'propertyLegalDescription.lot', name: 'Contract Legal Lot', dataType: 'TEXT' },
  { key: 'propertyLegalDescription.block', name: 'Contract Legal Block', dataType: 'TEXT' },
  { key: 'propertyLegalDescription.addition', name: 'Contract Legal Addition', dataType: 'TEXT' },
  { key: 'propertyLegalDescription.county', name: 'Contract Legal County', dataType: 'TEXT' },
  { key: 'propertyLegalDescription.exclusions', name: 'Contract Legal Exclusions', dataType: 'TEXT' },
  { key: 'propertyLegalDescription.reservations', name: 'Contract Legal Reservations', dataType: 'TEXT' },
  { key: 'leaseDisclosure.residentialLeases', name: 'Contract Residential Leases', dataType: 'TEXT' },
  { key: 'leaseDisclosure.fixtureLeases', name: 'Contract Fixture Leases', dataType: 'TEXT' },
  { key: 'leaseDisclosure.naturalResourceLeases', name: 'Contract Natural Resource Leases', dataType: 'TEXT' },
  { key: 'earnestMoneyOption.escrowAgentName', name: 'Contract Escrow Agent Name', dataType: 'TEXT' },
  { key: 'earnestMoneyOption.escrowAgentAddress', name: 'Contract Escrow Agent Address', dataType: 'TEXT' },
  { key: 'earnestMoneyOption.earnestMoney', name: 'Contract Earnest Money', dataType: 'TEXT' },
  { key: 'earnestMoneyOption.optionFee', name: 'Contract Option Fee', dataType: 'TEXT' },
  { key: 'earnestMoneyOption.optionPeriodDays', name: 'Contract Option Period Days', dataType: 'TEXT' },
  { key: 'earnestMoneyOption.additionalEarnestMoney', name: 'Contract Additional Earnest Money', dataType: 'TEXT' },
  { key: 'titleSurvey.titlePolicyExpenseParty', name: 'Contract Title Policy Expense Party', dataType: 'TEXT' },
  { key: 'titleSurvey.titleCompanyName', name: 'Contract Title Company Name', dataType: 'TEXT' },
  { key: 'titleSurvey.shortageAmendmentElection', name: 'Contract Title Shortage Amendment', dataType: 'TEXT' },
  { key: 'titleSurvey.surveyElection', name: 'Contract Survey Election', dataType: 'TEXT' },
  { key: 'titleSurvey.objectionsText', name: 'Contract Title Objections Text', dataType: 'TEXT' },
  { key: 'titleSurvey.objectionsDays', name: 'Contract Title Objections Days', dataType: 'TEXT' },
  { key: 'titleSurvey.poaMembership', name: 'Contract POA Membership', dataType: 'TEXT' },
  { key: 'propertyCondition.sellerDisclosureNotice', name: "Contract Sellers Disclosure Notice", dataType: 'TEXT' },
  { key: 'propertyCondition.asIsElection', name: 'Contract As Is Election', dataType: 'TEXT' },
  { key: 'propertyCondition.serviceContractCap', name: 'Contract Service Contract Cap', dataType: 'TEXT' },
  { key: 'propertyCondition.waterDisclosure', name: 'Contract Water Disclosure', dataType: 'TEXT' },
  { key: 'closingPossession.closingDate', name: 'Contract Closing Date', dataType: 'TEXT' },
  { key: 'closingPossession.possessionElection', name: 'Contract Possession Election', dataType: 'TEXT' },
  { key: 'closingPossession.possessionDetails', name: 'Contract Possession Details', dataType: 'TEXT' },
  { key: 'settlementExpense.sellerCreditCap', name: 'Contract Seller Credit Cap', dataType: 'TEXT' },
  { key: 'settlementExpense.sellerPaysBuyerBroker', name: 'Contract Seller Pays Buyer Broker', dataType: 'TEXT' },
  { key: 'settlementExpense.buyerPaysSellerBroker', name: 'Contract Buyer Pays Seller Broker', dataType: 'TEXT' },
  { key: 'representation.representation', name: 'Contract Broker Representation', dataType: 'TEXT' },
  { key: 'addendaApplicability.items', name: 'Contract Addenda Selected', dataType: 'TEXT' },
  { key: 'addendaApplicability.districtNotices', name: 'Contract District Notices', dataType: 'TEXT' },
  { key: 'noticeContact.buyerNoticeAddress', name: 'Contract Buyer Notice Address', dataType: 'TEXT' },
  { key: 'noticeContact.buyerNoticePhone', name: 'Contract Buyer Notice Phone', dataType: 'TEXT' },
  { key: 'noticeContact.buyerNoticeEmail', name: 'Contract Buyer Notice Email', dataType: 'TEXT' },
  { key: 'noticeContact.buyerSignerName', name: 'Contract Buyer Signer Name', dataType: 'TEXT' },
  { key: 'noticeContact.buyerSignerRole', name: 'Contract Buyer Signer Role', dataType: 'TEXT' },
  { key: 'noticeContact.sellerNoticeAddress', name: 'Contract Seller Notice Address', dataType: 'TEXT' },
  { key: 'noticeContact.sellerNoticePhone', name: 'Contract Seller Notice Phone', dataType: 'TEXT' },
  { key: 'noticeContact.sellerNoticeEmail', name: 'Contract Seller Notice Email', dataType: 'TEXT' },
  { key: 'attorneyManualFields.specialProvisions', name: 'Contract Special Provisions', dataType: 'TEXT' },
  { key: 'attorneyManualFields.otherAddendaText', name: 'Contract Other Addenda Text', dataType: 'TEXT' },
  { key: 'contractDraftRequest', name: 'Contract Draft Request', dataType: 'SINGLE_OPTIONS', options: ['Idle', 'Requested'] },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = parseEnv(fs.readFileSync(args.credentialFile, 'utf8')).GHL_PRIVATE_API_KEY;
  if (!token) die(`GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}.`);

  const existingOpp = await get(token, `${BASE}/locations/${args.location}/customFields?model=opportunity`);
  const arvField = (existingOpp.customFields ?? []).find((f) => f.fieldKey === 'opportunity.arv_after_repair_value');
  const parentId = arvField ? arvField.parentId : ((existingOpp.customFields ?? []).map((f) => f.parentId).filter(Boolean)[0] ?? null);
  if (!parentId) die('could not resolve an Opportunity Details-shaped folder to create fields in.');

  console.log('Location:', args.location);
  console.log('Resolved parentId (from opportunity.arv_after_repair_value\'s own folder):', parentId);
  console.log('Field count:', FIELD_SPECS.length, '\n');

  const results = {};
  for (const spec of FIELD_SPECS) {
    if (args.only && spec.key !== args.only) continue;

    const expectedKey = expectedFieldKey(spec.name);
    const clash = (existingOpp.customFields ?? []).find(
      (f) => f.name === spec.name || f.fieldKey === expectedKey,
    );
    if (clash) {
      console.log(`SKIP  ${spec.key.padEnd(45)} -- already exists (id ${clash.id}, fieldKey ${clash.fieldKey})`);
      results[spec.key] = clash.id;
      continue;
    }

    const body = { name: spec.name, dataType: spec.dataType, model: 'opportunity', parentId };
    if (spec.options) body.options = spec.options;

    if (!args.apply) {
      console.log(`DRY   ${spec.key.padEnd(45)} -- would create: ${JSON.stringify(body)}`);
      continue;
    }

    const postRes = await fetch(`${BASE}/locations/${args.location}/customFields`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: API_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const postText = await postRes.text();
    if (!postRes.ok) {
      console.error(`FAIL  ${spec.key.padEnd(45)} -- POST ${postRes.status}: ${postText.slice(0, 300)}`);
      process.exit(3);
    }
    const created = JSON.parse(postText).customField ?? JSON.parse(postText);
    const readback = await get(token, `${BASE}/locations/${args.location}/customFields/${created.id}`);
    const rb = readback.customField ?? readback;
    console.log(`CREATE ${spec.key.padEnd(45)} -- id ${created.id}, fieldKey ${rb.fieldKey}, dataType ${rb.dataType}` + (spec.options ? `, options ${JSON.stringify(rb.picklistOptions ?? rb.options ?? null)}` : ''));
    results[spec.key] = created.id;
  }

  console.log('\n--- Results (key -> id) ---');
  console.log(JSON.stringify(results, null, 2));

  if (!args.apply) {
    console.log('\nDRY RUN -- no POST issued for any non-clashing field. Re-run with --apply to create.');
  } else {
    console.log('\nNext step: paste these ids into app/shared/ghl-config.ts\'s TEST.contractProjectionFields ' +
      '(all keys except "contractDraftRequest") and TEST.contractDraftRequest, replacing the sentinel.');
  }
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
