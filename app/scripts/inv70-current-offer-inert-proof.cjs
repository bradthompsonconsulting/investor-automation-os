/**
 * INV-70 / B9-07A Phase 3 correction -- write/read/restore inert-proof of
 * the newly created `opportunity.current_offer` Production field, against
 * the ONE record Brad explicitly confirmed safe for this: Production
 * opportunity `1AP9BfFPJ2xYZ0RPTm9U`, the documented stale
 * calculator-test record (already disclaimed by PB-D55 and this
 * document's Family 5 / repairs-migration sections as "a calculator test
 * that persisted, not a real deal").
 *
 * SAFETY BY CONSTRUCTION, NOT OPERATOR DISCIPLINE. This script hardcodes
 * the one confirmed-safe opportunity id below and REFUSES to run against
 * any other id passed via `--opportunity-id` unless it matches exactly --
 * there is no flag that widens this. `--location` must be
 * `jmHG4B8RdzwpfqruNf68` (Production); this script has no Test path,
 * because Test's Current Offer field was already inert-proofed in Phase 2
 * correction round 2 and needs no re-proof.
 *
 * SEQUENCE, EACH STEP GATED ON THE PREVIOUS ONE SUCCEEDING:
 *   1. PRECHECK -- read the opportunity, confirm the field is absent
 *      (key not present in customFields at all -- PB-D24's KEY_ABSENT,
 *      the strictest "empty"). If it is NOT absent, this script ABORTS
 *      before writing anything -- an unexpected non-empty value on a
 *      record we were told is safe is itself a signal to stop, not push
 *      through.
 *   2. WRITE -- PUT a distinctive, obviously-a-test sentinel value
 *      (999999) -- chosen so it could never be mistaken for a real
 *      negotiated price if this script's output is read out of context.
 *   3. VERIFY -- GET readback, confirm the observed value matches exactly
 *      what was sent.
 *   4. RESTORE -- PUT `field_value: ""`, the OBSERVED (not assumed) clear
 *      convention this repo's own asking-price inert-proof already
 *      established (`inert-proof-opp-asking-price-step4.cjs`).
 *   5. FINAL VERIFY -- GET readback again, confirm the field is back to
 *      KEY_ABSENT -- the same strict "empty" precheck required, not
 *      merely "no longer 999999."
 *
 * Any step failing anything short of the strict expected result STOPS the
 * script immediately with a non-zero exit and a clear message -- it never
 * silently continues past an unexpected observation.
 *
 * Usage:
 *   node scripts/inv70-current-offer-inert-proof.cjs --location jmHG4B8RdzwpfqruNf68
 *                                                     --opportunity-id 1AP9BfFPJ2xYZ0RPTm9U
 *                                                     --credential-file <path>
 */
const fs = require('fs');

const BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const CONFIRMED_SAFE_OPPORTUNITY_ID = '1AP9BfFPJ2xYZ0RPTm9U';
const CONFIRMED_LOCATION = 'jmHG4B8RdzwpfqruNf68';
const SENTINEL_VALUE = 999999;

function die(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const location = get('--location');
  const opportunityId = get('--opportunity-id');
  const credentialFile = get('--credential-file');
  if (!location) die('--location is required. There is no default.');
  if (!opportunityId) die('--opportunity-id is required. There is no default.');
  if (!credentialFile) die('--credential-file is required. There is no default.');
  if (location !== CONFIRMED_LOCATION) {
    die(`--location must be the confirmed Production location (${CONFIRMED_LOCATION}). This script has no Test path.`);
  }
  if (opportunityId !== CONFIRMED_SAFE_OPPORTUNITY_ID) {
    die(`--opportunity-id must be the ONE opportunity Brad explicitly confirmed safe (${CONFIRMED_SAFE_OPPORTUNITY_ID}). Refusing to run against any other record.`);
  }
  return { location, opportunityId, credentialFile };
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = parseEnv(fs.readFileSync(args.credentialFile, 'utf8')).GHL_PRIVATE_API_KEY;
  if (!token) die(`GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}.`);

  const { getConfig } = require('./ghl-config-loader.cjs');
  const config = getConfig('production');
  const fieldId = config.opportunityFacts.currentOffer;
  if (!fieldId || fieldId === 'CURRENT_OFFER_FIELD_NOT_YET_PROVISIONED') {
    die('PRODUCTION.opportunityFacts.currentOffer is not yet a real id -- run inv70-create-current-offer-field.cjs --apply first.');
  }
  console.error(`fieldId=${fieldId} opportunityId=${args.opportunityId} locationId=${args.location}`);

  async function get() {
    const res = await fetch(`${BASE}/opportunities/${args.opportunityId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Version: API_VERSION },
    });
    const text = await res.text();
    if (!res.ok) die(`GET opportunity failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    return body.opportunity ?? body;
  }
  async function put(fieldValue) {
    const res = await fetch(`${BASE}/opportunities/${args.opportunityId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Version: API_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customFields: [{ id: fieldId, field_value: fieldValue }] }),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: text };
  }
  function fieldEntry(opp) {
    return (opp.customFields ?? []).find((f) => f.id === fieldId) ?? null;
  }
  function observedValue(entry) {
    if (!entry) return undefined;
    return entry.fieldValue !== undefined ? entry.fieldValue : entry.fieldValueNumber;
  }

  const report = { fieldId, opportunityId: args.opportunityId, locationId: args.location, steps: [] };

  // 1. PRECHECK
  const before = await get();
  const beforeEntry = fieldEntry(before);
  report.steps.push({ step: 'precheck', fieldPresent: beforeEntry !== null, entry: beforeEntry });
  if (beforeEntry !== null) {
    die(`PRECHECK FAILED: opportunity.current_offer is NOT absent on ${args.opportunityId} -- found ${JSON.stringify(beforeEntry)}. Aborting before any write. This is unexpected for a field created moments ago and needs human review before proceeding.`);
  }
  console.error('PRECHECK ok: field is absent (KEY_ABSENT), as expected for a field just created.');

  // 2. WRITE
  const writeRes = await put(SENTINEL_VALUE);
  report.steps.push({ step: 'write', sent: SENTINEL_VALUE, putStatus: writeRes.status, putOk: writeRes.ok });
  if (!writeRes.ok) die(`WRITE FAILED: HTTP ${writeRes.status}: ${writeRes.body.slice(0, 300)}`);
  console.error(`WRITE ok: HTTP ${writeRes.status}`);

  // 3. VERIFY
  const afterWrite = await get();
  const afterWriteEntry = fieldEntry(afterWrite);
  const afterWriteObserved = observedValue(afterWriteEntry);
  const writeMatched = afterWriteEntry !== null && Number(afterWriteObserved) === SENTINEL_VALUE;
  report.steps.push({ step: 'verify_write', entry: afterWriteEntry, observed: afterWriteObserved, matched: writeMatched });
  if (!writeMatched) die(`VERIFY FAILED: expected ${SENTINEL_VALUE}, observed ${JSON.stringify(afterWriteEntry)}. Stopping before restore -- do not assume a clean state.`);
  console.error(`VERIFY ok: observed ${afterWriteObserved}, matches sent ${SENTINEL_VALUE}.`);

  // 4. RESTORE
  const restoreRes = await put('');
  report.steps.push({ step: 'restore', sent: '', putStatus: restoreRes.status, putOk: restoreRes.ok });
  if (!restoreRes.ok) die(`RESTORE FAILED: HTTP ${restoreRes.status}: ${restoreRes.body.slice(0, 300)}. THE FIELD MAY STILL HOLD ${SENTINEL_VALUE} -- human intervention needed.`);
  console.error(`RESTORE ok: HTTP ${restoreRes.status}`);

  // 5. FINAL VERIFY
  const after = await get();
  const afterEntry = fieldEntry(after);
  report.steps.push({ step: 'final_verify', fieldPresent: afterEntry !== null, entry: afterEntry });
  const restoredToOrigin = afterEntry === null;
  report.restoredToOrigin = restoredToOrigin;
  if (!restoredToOrigin) {
    die(`FINAL VERIFY FAILED: field is NOT back to KEY_ABSENT -- found ${JSON.stringify(afterEntry)}. THE RESTORE DID NOT LAND CLEANLY -- human intervention needed, do not consider this inert-proof passed.`);
  }
  console.error('FINAL VERIFY ok: field is back to KEY_ABSENT -- no residual value. Inert-proof PASSED.');

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
