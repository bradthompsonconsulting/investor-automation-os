/**
 * INV-67 checkbox-marker / broker-model repair -- Batch 1 of 3. Creates the
 * 48 narrowly-scoped Opportunity custom TEXT fields
 * `src/lib/contract-checkbox-marker-model.ts`'s `CHECKBOX_MARKER_KEYS`
 * requires. Mirrors `inv67-create-contract-projection-fields.cjs`'s (and,
 * before it, `inv70-create-current-offer-field.cjs`'s) proven pattern
 * exactly: READ-ONLY DRY RUN BY DEFAULT, --apply to actually POST, always
 * confirms no name/fieldKey clash first (a re-run never creates a
 * duplicate), always reads each created field back.
 *
 * SCOPE -- this script creates ONLY the 48 marker fields. It does not
 * touch the 11 restructured contract-text keys, the 22 broker-text keys,
 * any retired field, or the Contract Draft Request field -- those are
 * later, separately reviewed batches (2 and 3) and out of THIS script's
 * authorized scope entirely.
 *
 * REPEATED DESTINATIONS -- `lease_residential_mark`, `lease_fixture_mark`,
 * and `possession_leaseback_mark` each get exactly ONE field here, exactly
 * like every other marker. Placing that one field at TWO locations on the
 * Test template (paragraph 4/10 AND paragraph 22) is template-placement
 * work, not a field-creation concern, and is NOT performed by this script
 * or authorized in this phase. See `CHECKBOX_MARKER_REPEATED_TEMPLATE_
 * PLACEMENTS` (`contract-checkbox-marker-model.ts`) for the placement
 * manifest this script's field creation feeds into later.
 *
 * NO LOCATION SELECTOR. --location is required, no default -- this script
 * must never guess which environment it targets, and per this repair's
 * authorization it must never be pointed at anything but IAOS Test.
 *
 * Usage:
 *   node scripts/inv67-create-checkbox-marker-fields-batch1.cjs --location <id>
 *                                                                --credential-file <path>
 *                                                                [--apply]
 *                                                                [--only <key>]
 */
const fs = require('fs');
const path = require('path');

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
 * MUST match `src/lib/contract-checkbox-marker-model.ts`'s
 * `CHECKBOX_MARKER_KEYS` exactly -- same 48 keys, same order. Verified
 * programmatically at the top of `main()` below (throws before any network
 * call if the two ever diverge) rather than trusted by eye alone.
 */
const FIELD_SPECS = [
  { key: 'lease_residential_mark', name: 'Contract Residential Leases Mark' },
  { key: 'lease_fixture_mark', name: 'Contract Fixture Leases Mark' },
  { key: 'lease_nrl_applies_mark', name: 'Contract Natural Resource Leases Applies Mark' },
  { key: 'lease_nrl_delivered_mark', name: 'Contract Natural Resource Leases Delivered Mark' },
  { key: 'lease_nrl_not_delivered_mark', name: 'Contract Natural Resource Leases Not Delivered Mark' },
  { key: 'title_expense_seller_mark', name: 'Contract Title Policy Expense Seller Mark' },
  { key: 'title_expense_buyer_mark', name: 'Contract Title Policy Expense Buyer Mark' },
  { key: 'shortage_not_amended_mark', name: 'Contract Title Shortage Not Amended Mark' },
  { key: 'shortage_amended_mark', name: 'Contract Title Shortage Amended Mark' },
  { key: 'shortage_amended_buyer_mark', name: 'Contract Title Shortage Amended Buyer Mark' },
  { key: 'shortage_amended_seller_mark', name: 'Contract Title Shortage Amended Seller Mark' },
  { key: 'survey_opt1_mark', name: 'Contract Survey Seller Existing Survey Mark' },
  { key: 'survey_opt2_mark', name: 'Contract Survey Buyer New Survey Mark' },
  { key: 'survey_opt3_mark', name: 'Contract Survey Seller New Survey Mark' },
  { key: 'survey_opt1_expense_buyer_mark', name: 'Contract Survey Rejected Expense Buyer Mark' },
  { key: 'survey_opt1_expense_seller_mark', name: 'Contract Survey Rejected Expense Seller Mark' },
  { key: 'poa_is_subject_mark', name: 'Contract POA Is Subject Mark' },
  { key: 'poa_is_not_subject_mark', name: 'Contract POA Is Not Subject Mark' },
  { key: 'sdn_received_mark', name: 'Contract Sellers Disclosure Notice Received Mark' },
  { key: 'sdn_not_received_mark', name: 'Contract Sellers Disclosure Notice Not Received Mark' },
  { key: 'sdn_not_required_mark', name: 'Contract Sellers Disclosure Notice Not Required Mark' },
  { key: 'as_is_plain_mark', name: 'Contract As Is Plain Mark' },
  { key: 'as_is_with_repairs_mark', name: 'Contract As Is With Repairs Mark' },
  { key: 'water_received_mark', name: 'Contract Water Disclosure Received Mark' },
  { key: 'water_not_received_mark', name: 'Contract Water Disclosure Not Received Mark' },
  { key: 'water_exempt_mark', name: 'Contract Water Disclosure Exempt Mark' },
  { key: 'possession_upon_closing_mark', name: 'Contract Possession Upon Closing Mark' },
  { key: 'possession_leaseback_mark', name: 'Contract Possession Leaseback Mark' },
  { key: 'spbb_applies_mark', name: 'Contract Seller Pays Buyer Broker Applies Mark' },
  { key: 'spbb_dollar_mark', name: 'Contract Seller Pays Buyer Broker Dollar Mark' },
  { key: 'spbb_percent_mark', name: 'Contract Seller Pays Buyer Broker Percent Mark' },
  { key: 'bpsb_applies_mark', name: 'Contract Buyer Pays Seller Broker Applies Mark' },
  { key: 'bpsb_dollar_mark', name: 'Contract Buyer Pays Seller Broker Dollar Mark' },
  { key: 'bpsb_percent_mark', name: 'Contract Buyer Pays Seller Broker Percent Mark' },
  { key: 'addenda_sale_of_other_property_mark', name: 'Contract Addendum Sale Of Other Property Mark' },
  { key: 'addenda_lender_appraisal_termination_mark', name: 'Contract Addendum Lender Appraisal Termination Mark' },
  { key: 'addenda_section_1031_exchange_mark', name: 'Contract Addendum Section 1031 Exchange Mark' },
  { key: 'addenda_short_sale_mark', name: 'Contract Addendum Short Sale Mark' },
  { key: 'addenda_hydrostatic_testing_mark', name: 'Contract Addendum Hydrostatic Testing Mark' },
  { key: 'addenda_environmental_assessment_mark', name: 'Contract Addendum Environmental Assessment Mark' },
  { key: 'addenda_lead_based_paint_mark', name: 'Contract Addendum Lead Based Paint Mark' },
  { key: 'addenda_propane_gas_service_area_mark', name: 'Contract Addendum Propane Gas Service Area Mark' },
  { key: 'addenda_seaward_of_gulf_intracoastal_mark', name: 'Contract Addendum Seaward Of Gulf Intracoastal Mark' },
  { key: 'addenda_coastal_area_property_mark', name: 'Contract Addendum Coastal Area Property Mark' },
  { key: 'addenda_poa_membership_mark', name: 'Contract Addendum POA Membership Mark' },
  { key: 'addenda_non_realty_items_mark', name: 'Contract Addendum Non Realty Items Mark' },
  { key: 'addenda_back_up_contract_mark', name: 'Contract Addendum Back Up Contract Mark' },
  { key: 'addenda_mineral_reservation_mark', name: 'Contract Addendum Mineral Reservation Mark' },
].map((s) => ({ ...s, dataType: 'TEXT' }));

/**
 * Fails loud, before any network call, if this script's own FIELD_SPECS
 * ever drifts from the authoritative `CHECKBOX_MARKER_KEYS` -- either
 * missing a key, adding an extra one, reordering, or duplicating one.
 * Reads the TypeScript source directly (regex, not a compile) so this
 * script has zero build-time dependency.
 */
function verifyAgainstAuthoritativeSource() {
  const srcPath = path.join(__dirname, '..', 'src', 'lib', 'contract-checkbox-marker-model.ts');
  const src = fs.readFileSync(srcPath, 'utf8');
  const m = src.match(/export const CHECKBOX_MARKER_KEYS = \[([\s\S]*?)\] as const;/);
  if (!m) die(`could not find CHECKBOX_MARKER_KEYS in ${srcPath} -- refusing to run against a source this script cannot verify.`);
  const authoritative = m[1]
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*"([^"]+)",?\s*$/))
    .filter(Boolean)
    .map((mm) => mm[1]);
  const proposed = FIELD_SPECS.map((s) => s.key);
  if (authoritative.length !== 48) die(`authoritative CHECKBOX_MARKER_KEYS has ${authoritative.length} keys, expected 48 -- STOP, source has drifted since this script was written.`);
  if (JSON.stringify(authoritative) !== JSON.stringify(proposed)) {
    const missing = authoritative.filter((k) => !proposed.includes(k));
    const extra = proposed.filter((k) => !authoritative.includes(k));
    die(
      `FIELD_SPECS has drifted from CHECKBOX_MARKER_KEYS. missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)} -- ` +
      `refusing to run. Update this script's FIELD_SPECS to match the authoritative source exactly before retrying.`,
    );
  }
  console.log(`Verified: this script's 48 FIELD_SPECS keys match CHECKBOX_MARKER_KEYS exactly (same 48, same order).\n`);
}

async function main() {
  verifyAgainstAuthoritativeSource();

  const args = parseArgs(process.argv.slice(2));
  const token = parseEnv(fs.readFileSync(args.credentialFile, 'utf8')).GHL_PRIVATE_API_KEY;
  if (!token) die(`GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}.`);

  const existingOpp = await get(token, `${BASE}/locations/${args.location}/customFields?model=opportunity`);
  const arvField = (existingOpp.customFields ?? []).find((f) => f.fieldKey === 'opportunity.arv_after_repair_value');
  const parentId = arvField ? arvField.parentId : ((existingOpp.customFields ?? []).map((f) => f.parentId).filter(Boolean)[0] ?? null);
  if (!parentId) die('could not resolve an Opportunity Details-shaped folder to create fields in.');

  console.log('Location:', args.location);
  console.log('Resolved parentId (from opportunity.arv_after_repair_value\'s own folder):', parentId);
  console.log('Existing Opportunity custom fields in this location:', (existingOpp.customFields ?? []).length);
  console.log('Field count this batch:', FIELD_SPECS.length, '\n');

  const results = {};
  const rows = [];

  /**
   * Partial-failure safety: EVERY exit path from this function -- the
   * natural end of a fully successful/dry run, a POST failure, or a
   * readback failure after a successful POST -- prints the full proposed
   * mapping and the results accumulated SO FAR before the process ends.
   * A field that was actually created in GHL (POST succeeded) is recorded
   * in `results` immediately on POST success, before readback is even
   * attempted, so a readback failure never hides evidence that a field
   * was created -- it is reported as created-but-unconfirmed, distinctly
   * from never-attempted.
   */
  function printSummaryAndExit(code, closingMessage) {
    console.log('\n--- Proposed mapping (ordinal | key | name | fieldKey | mergeTag | collision) ---');
    for (const r of rows) {
      console.log(`${String(r.ordinal).padStart(2)}. ${r.key.padEnd(45)} | ${r.name.padEnd(50)} | ${r.fieldKey.padEnd(55)} | ${r.mergeTag.padEnd(60)} | ${r.collision}`);
    }
    console.log('\n--- Results (key -> id; dry-run/never-attempted entries absent) ---');
    console.log(JSON.stringify(results, null, 2));
    if (closingMessage) console.log('\n' + closingMessage);
    process.exit(code);
  }

  let ordinal = 0;
  for (const spec of FIELD_SPECS) {
    ordinal++;
    if (args.only && spec.key !== args.only) continue;

    const expectedKey = expectedFieldKey(spec.name);
    const mergeTag = `{{${expectedKey}}}`;
    const clash = (existingOpp.customFields ?? []).find(
      (f) => f.name === spec.name || f.fieldKey === expectedKey,
    );
    const collision = clash ? `CLASH -- existing id ${clash.id}, fieldKey ${clash.fieldKey}, name "${clash.name}"` : 'none';
    rows.push({ ordinal, key: spec.key, name: spec.name, fieldKey: expectedKey, mergeTag, collision });

    if (clash) {
      console.log(`SKIP  ${spec.key.padEnd(45)} -- already exists (id ${clash.id}, fieldKey ${clash.fieldKey})`);
      results[spec.key] = clash.id;
      continue;
    }

    const body = { name: spec.name, dataType: spec.dataType, model: 'opportunity', parentId };

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
      printSummaryAndExit(3, `PARTIAL FAILURE -- stopped after ${spec.key} failed to POST. Everything above "Results" that already carries an id was actually created in GHL; nothing after it in FIELD_SPECS order was attempted.`);
    }
    const created = JSON.parse(postText).customField ?? JSON.parse(postText);
    // Recorded BEFORE readback: a readback failure below must never hide that this field was actually created.
    results[spec.key] = created.id;

    let rb;
    try {
      const readback = await get(token, `${BASE}/locations/${args.location}/customFields/${created.id}`);
      rb = readback.customField ?? readback;
    } catch (e) {
      console.error(`FAIL-READBACK ${spec.key.padEnd(38)} -- created (id ${created.id}) but readback failed: ${e.message}`);
      printSummaryAndExit(4, `PARTIAL FAILURE -- ${spec.key} WAS created in GHL (id ${created.id}) but its readback could not confirm it. Everything above "Results" that carries an id was actually created; nothing after it in FIELD_SPECS order was attempted.`);
    }
    console.log(`CREATE ${spec.key.padEnd(45)} -- id ${created.id}, fieldKey ${rb.fieldKey}, dataType ${rb.dataType}`);
  }

  if (!args.apply) {
    printSummaryAndExit(0, 'DRY RUN -- no POST issued for any field. Re-run with --apply, after Jess/Brad review of this batch, to create.');
  } else {
    printSummaryAndExit(0, 'Next step: paste these ids into app/shared/ghl-config.ts, and update the drift-guard tests accordingly.');
  }
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
