/**
 * B15-04 -- creates the five property-address Opportunity TEXT fields of the
 * first property-answer slice in GHL TEST ONLY (Brad's Test authorization,
 * 2026-10-17). Mirrors scripts/inv70-create-current-offer-field.cjs.
 *
 * DRY RUN BY DEFAULT (1 GET). --apply runs the fixed sequence, at most 12
 * requests, each exactly once, no retry:
 *   1  GET  /locations/{loc}/customFields?model=opportunity   pre-check
 *   2-6 POST /locations/{loc}/customFields                     one per field, in order
 *   7-11 GET /locations/{loc}/customFields/{id}                readback per field
 *   12 GET  /locations/{loc}/customFields?model=opportunity   independent join verification
 * STOP (no further request) on: a location other than Test; a name or fieldKey
 * clash; the Seller Reason anchor missing, duplicated or not in the expected
 * folder; any non-2xx; a readback whose name, fieldKey, dataType, model or
 * parentId differs from what was requested.
 *
 * The journal (--journal, exclusive create) holds statuses, ids, names, keys and
 * types only -- never the credential or a response body.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const TEST_LOCATION = 'SoTgVoaFGHtBdRFvXWQV';
const FOLDER = 'sGP3pbDQFN7fXS62MAgA';           // Opportunity Details (Test), Seller Reason's own folder
const SELLER_REASON_ID = 'zqGxQc7nAspWmYglR2Qk';
const FIELDS = [
  { config: 'propertyStreet', name: 'Property Street', fieldKey: 'opportunity.property_street' },
  { config: 'propertyUnit', name: 'Property Unit', fieldKey: 'opportunity.property_unit' },
  { config: 'propertyCity', name: 'Property City', fieldKey: 'opportunity.property_city' },
  { config: 'propertyState', name: 'Property State', fieldKey: 'opportunity.property_state' },
  { config: 'propertyZip', name: 'Property Zip', fieldKey: 'opportunity.property_zip' },
];
const MAX_REQUESTS = 12;

function die(msg, code = 2) { console.error('STOP: ' + msg); process.exit(code); }
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const location = arg('--location'); const cred = arg('--credential-file'); const journalDir = arg('--journal');
  const apply = process.argv.includes('--apply');
  if (location !== TEST_LOCATION) die(`--location must be the Test location ${TEST_LOCATION}`);
  if (!cred || !journalDir) die('--credential-file and --journal are required');
  const m = fs.readFileSync(cred, 'utf8').match(/^GHL_PRIVATE_API_KEY=(.*)$/m);
  if (!m || !m[1].trim()) die('GHL_PRIVATE_API_KEY not found in the credential file');
  const token = m[1].trim().replace(/^["']|["']$/g, '');
  fs.mkdirSync(journalDir, { recursive: true });
  const fd = fs.openSync(path.join(journalDir, apply ? 'b15-04-fields-apply.jsonl' : 'b15-04-fields-dryrun.jsonl'), 'wx');
  const line = (o) => { fs.writeSync(fd, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'); fs.fsyncSync(fd); };
  let sent = 0;
  async function req(method, p, body) {
    if (++sent > MAX_REQUESTS) die('request budget exceeded');
    line({ event: 'ATTEMPT', n: sent, method, path: p });
    const res = await fetch(BASE + p, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, Version: VERSION, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    line({ event: 'RESPONSE', n: sent, status: res.status });
    if (!res.ok) { line({ event: 'STOP', reason: `HTTP ${res.status}` }); die(`HTTP ${res.status} on ${method} ${p}`, 3); }
    return JSON.parse(text);
  }
  const list = async () => (await req('GET', `/locations/${location}/customFields?model=opportunity`)).customFields ?? [];
  line({ event: 'START', apply, location, folder: FOLDER, fields: FIELDS.map((f) => f.name) });

  const before = await list();
  const anchor = before.filter((f) => f.id === SELLER_REASON_ID);
  const clashes = before.filter((f) => FIELDS.some((x) => x.name === f.name || x.fieldKey === f.fieldKey)).map((f) => ({ id: f.id, name: f.name, fieldKey: f.fieldKey }));
  line({ event: 'PRECHECK', totalFields: before.length, anchorFound: anchor.length, anchorParent: anchor[0]?.parentId ?? null, clashes });
  if (anchor.length !== 1 || anchor[0].parentId !== FOLDER || anchor[0].name !== 'Seller Reason') die('Seller Reason anchor missing or not in the expected folder');
  if (clashes.length) die('a field with one of these names or keys already exists: ' + JSON.stringify(clashes));
  if (!apply) { line({ event: 'END', verdict: 'DRY_RUN_OK' }); console.log(`DRY RUN OK: ${before.length} opportunity fields; anchor in ${FOLDER}; no clash. Re-run with --apply.`); return; }

  const created = [];
  for (const f of FIELDS) {
    const r = await req('POST', `/locations/${location}/customFields`, { name: f.name, dataType: 'TEXT', model: 'opportunity', parentId: FOLDER });
    const c = r.customField ?? r;
    line({ event: 'CREATED', name: f.name, id: c.id ?? null, fieldKey: c.fieldKey ?? null, dataType: c.dataType ?? null });
    if (typeof c.id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(c.id)) die('created field has no well-formed id');
    created.push({ ...f, id: c.id });
  }
  for (const f of created) {
    const r = await req('GET', `/locations/${location}/customFields/${f.id}`);
    const c = r.customField ?? r;
    const checks = { id: c.id === f.id, name: c.name === f.name, fieldKey: c.fieldKey === f.fieldKey, dataType: c.dataType === 'TEXT', model: c.model === 'opportunity', parentId: c.parentId === FOLDER };
    line({ event: 'READBACK', name: f.name, id: f.id, checks });
    if (!Object.values(checks).every(Boolean)) die(`readback mismatch for ${f.name}: ${JSON.stringify(checks)}`, 4);
  }
  const after = await list();
  const join = created.map((f) => { const hits = after.filter((x) => x.id === f.id); return { name: f.name, id: f.id, present: hits.length === 1, fieldKey: hits[0]?.fieldKey === f.fieldKey, parentId: hits[0]?.parentId === FOLDER }; });
  const anchorAfter = after.filter((x) => x.id === SELLER_REASON_ID && x.parentId === FOLDER).length === 1;
  line({ event: 'VERIFY', totalBefore: before.length, totalAfter: after.length, join, anchorAfter });
  // The list's total is recorded, not relied on: the UI and this list have disagreed before (170 vs 160, unexplained).
  if (!join.every((j) => j.present && j.fieldKey && j.parentId) || !anchorAfter) die('independent verification failed', 5);
  line({ event: 'END', verdict: 'FIELDS_CREATED', requests: sent });
  fs.closeSync(fd);
  console.log(JSON.stringify({ verdict: 'FIELDS_CREATED', requests: sent, ids: Object.fromEntries(created.map((f) => [f.config, f.id])) }, null, 2));
}
main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
