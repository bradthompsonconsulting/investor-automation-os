/**
 * INV-70 / B9-07A Phase 2 -- creates the ONE new GHL Opportunity custom
 * field Family 5's approved ruling requires: "Current Offer".
 *
 * READ-ONLY DRY RUN BY DEFAULT. Pass --apply to actually POST. Always
 * confirms no name/fieldKey clash first (so a re-run can never create a
 * duplicate), and always reads the field back after creating it.
 *
 * NO LOCATION SELECTOR. --location is a required, explicit argument with
 * no default -- this script must never guess which environment it is
 * pointed at, and per this phase's authorization it must never be run
 * with intent to create anything outside IAOS Test.
 *
 * BLOCKED, 2026-09-11: the credential in `.env.test` has Contacts/
 * Opportunities write scope (proven -- every named writer in
 * app/src/lib/ghl.ts uses it successfully) but returns
 * `HTTP 401 "The token is not authorized for this scope"` on
 * `POST /locations/{id}/customFields` -- Custom Fields write/create is a
 * separate GHL scope this Private Integration token does not carry. This
 * script is committed unexecuted-to-completion so the next attempt (once
 * a sufficiently-scoped credential exists) does not have to be
 * re-derived from scratch.
 *
 * Usage:
 *   node scripts/inv70-create-current-offer-field.cjs --location <id>
 *                                                      --credential-file <path>
 *                                                      [--apply]
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
  return { location, credentialFile, apply: argv.includes('--apply') };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = parseEnv(fs.readFileSync(args.credentialFile, 'utf8')).GHL_PRIVATE_API_KEY;
  if (!token) die(`GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}.`);

  // Resolved live, not hardcoded: the Opportunity Details folder id
  // differs per location, so a future Production provisioning pass (its
  // own, later, separately-authorized decision) can reuse this script
  // unmodified once given that location's own credential and id.
  const existingOpp = await get(token, `${BASE}/locations/${args.location}/customFields?model=opportunity`);
  const folder = (existingOpp.customFields ?? [])
    .map((f) => f.parentId)
    .filter(Boolean);
  // Best-effort: reuse whichever Opportunity-model folder the existing
  // underwriting-output fields (arv_after_repair_value, repair_estimate,
  // etc.) already live in, rather than hardcoding a folder id that is
  // only valid for one specific location.
  const arvField = (existingOpp.customFields ?? []).find((f) => f.fieldKey === 'opportunity.arv_after_repair_value');
  const parentId = arvField ? arvField.parentId : (folder[0] ?? null);
  if (!parentId) die('could not resolve an Opportunity Details-shaped folder to create the field in.');

  const body = { name: 'Current Offer', dataType: 'NUMERICAL', model: 'opportunity', parentId };

  console.log('Location:', args.location);
  console.log('Resolved parentId (from opportunity.arv_after_repair_value\'s own folder):', parentId);
  console.log('Intended create body:', JSON.stringify(body, null, 2));

  const clash = (existingOpp.customFields ?? []).find(
    (f) => f.name === body.name || f.fieldKey === 'opportunity.current_offer',
  );
  if (clash) {
    console.log('\nFIELD ALREADY EXISTS -- not creating a duplicate.');
    console.log(JSON.stringify(clash, null, 2));
    return;
  }

  if (!args.apply) {
    console.log('\nDRY RUN -- no POST issued. Re-run with --apply to create.');
    return;
  }

  const postRes = await fetch(`${BASE}/locations/${args.location}/customFields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Version: API_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const postText = await postRes.text();
  console.log('\nPOST status:', postRes.status);
  console.log('POST body:', postText);
  if (!postRes.ok) process.exit(3);

  const created = JSON.parse(postText).customField ?? JSON.parse(postText);
  console.log('\nCreated field id:', created.id);

  const readback = await get(token, `${BASE}/locations/${args.location}/customFields/${created.id}`);
  console.log('\nReadback:', JSON.stringify(readback.customField ?? readback, null, 2));
  console.log('\nNext step: add this id to app/shared/ghl-config.ts\'s ' +
    'opportunityFacts.currentOffer for this environment, replacing CURRENT_OFFER_NOT_PROVISIONED.');
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
