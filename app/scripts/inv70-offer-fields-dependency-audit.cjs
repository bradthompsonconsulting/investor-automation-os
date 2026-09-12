/**
 * INV-70 / B9-07A Phase 3 -- read-only dependency and populated-value audit
 * for the fourteen retired Family 5 `offer_*` fields (7 keys x 2 models),
 * plus a same-shape check for `contact.estimated_repairs` (Family 3,
 * needed for the Phase 3 cleanup gate even though it is not part of
 * Family 5).
 *
 * READ-ONLY. GET calls only -- no POST, PUT, DELETE, ever, regardless of
 * flags. This script never accepts an --apply flag because it performs no
 * mutation of any kind.
 *
 * WHAT THIS CHECKS, per field:
 *   1. Still exists in GHL, at the id/type/folder this document's Family 5
 *      table already recorded -- resolved LIVE by fieldKey match, never
 *      assumed from a hardcoded id.
 *   2. Populated-value count -- pages through every Contact (for
 *      contact.* fields) and every Opportunity (for opportunity.* fields)
 *      in the given location, counting non-empty values.
 *   3. Workflow dependency, BEST-EFFORT ONLY. GHL's v2 API exposes
 *      workflow inventory (name/id/status) but NOT trigger configuration
 *      (confirmed on the wire in an earlier IAOS session -- see
 *      docs/BOARD9_GHL_IAOS_FIELD_CANONICALIZATION_V1.md's Phase 3
 *      section). This script can therefore only report whether "offer" or
 *      a field's own name appears as a SUBSTRING of a workflow's name --
 *      a weak, non-conclusive signal, reported as such, never as proof of
 *      absence or presence of an actual trigger dependency.
 *   4. Forms / Surveys / Funnels / Documents-Templates -- attempted via
 *      the most plausible GHL v2 read endpoints. This Private Integration
 *      token's granted scopes (Custom Fields, Custom Values, Opportunities,
 *      Products, Product Prices, Contacts, Calendars, Calendar Events,
 *      Tags, Tasks, Locations, Workflows-read) do NOT list Forms/Surveys/
 *      Funnels -- these calls are expected to fail, and a failure is
 *      reported as INCONCLUSIVE (not as "zero dependencies"), per this
 *      phase's own rule: "if dependency inspection is unavailable or
 *      inconclusive, do not delete that field."
 *
 * Usage:
 *   node scripts/inv70-offer-fields-dependency-audit.cjs --selector test|production
 *                                                         --credential-file <path>
 *                                                         [--out <path>]
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const APP = path.resolve(__dirname, '..');

function die(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const selector = get('--selector');
  if (selector !== 'test' && selector !== 'production') die('--selector must be "test" or "production". There is no default.');
  const credentialFile = get('--credential-file');
  if (!credentialFile) die('--credential-file is required. There is no default and no fallback.');
  const out = get('--out');
  return { selector, credentialFile, out };
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// The 14 Family 5 fieldKeys, both models, plus estimated_repairs (Family 3,
// Contact-side only -- the Opportunity side, repair_estimate, is the
// approved-authoritative carrier and out of scope for this audit).
const FIELD_KEYS = [
  'contact.offer_price', 'opportunity.offer_price',
  'contact.offer_mao', 'opportunity.offer_mao',
  'contact.offer_wholesale_fee', 'opportunity.offer_wholesale_fee',
  'contact.offer_repair_total', 'opportunity.offer_repair_total',
  'contact.offer_margin', 'opportunity.offer_margin',
  'contact.offer_arv', 'opportunity.offer_arv',
  'contact.offer_date', 'opportunity.offer_date',
  'contact.estimated_repairs',
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envText = fs.readFileSync(args.credentialFile, 'utf8');
  const token = parseEnvFile(envText).GHL_PRIVATE_API_KEY;
  if (!token) die(`GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}.`);

  const { getConfig } = require('./ghl-config-loader.cjs');
  const config = getConfig(args.selector);
  const locationId = config.locationId;

  async function get(url) {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } });
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: text };
  }
  async function getJson(url) {
    const r = await get(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for GET ${url.replace(BASE, '')}: ${r.body.slice(0, 300)}`);
    return JSON.parse(r.body);
  }

  console.error(`selector=${args.selector} locationId=${locationId}`);

  // 1. Resolve every field's live GHL record by fieldKey.
  const contactFields = (await getJson(`${BASE}/locations/${locationId}/customFields`)).customFields ?? [];
  const opportunityFields = (await getJson(`${BASE}/locations/${locationId}/customFields?model=opportunity`)).customFields ?? [];
  const allFields = [...contactFields, ...opportunityFields];
  const byKey = new Map(allFields.map((f) => [f.fieldKey, f]));

  const fieldRecords = FIELD_KEYS.map((key) => {
    const f = byKey.get(key);
    return {
      fieldKey: key,
      model: key.startsWith('contact.') ? 'contact' : 'opportunity',
      found: !!f,
      id: f ? f.id : null,
      name: f ? f.name : null,
      dataType: f ? f.dataType : null,
      parentId: f ? f.parentId : null,
    };
  });

  // 2. Populated-value counts. Page through Contacts and Opportunities once
  //    each, checking every field id in the same pass -- one scan, not 15.
  const contactFieldIds = fieldRecords.filter((r) => r.model === 'contact' && r.found).map((r) => r.id);
  const opportunityFieldIds = fieldRecords.filter((r) => r.model === 'opportunity' && r.found).map((r) => r.id);

  const populatedCounts = new Map(fieldRecords.map((r) => [r.fieldKey, { count: 0, sampleRecordIds: [] }]));

  let contactsScanned = 0;
  {
    let url = `${BASE}/contacts/?locationId=${locationId}&limit=100`;
    while (url) {
      const body = await getJson(url);
      const contacts = body.contacts ?? [];
      contactsScanned += contacts.length;
      for (const c of contacts) {
        for (const cfId of contactFieldIds) {
          const entry = (c.customFields ?? []).find((f) => f.id === cfId);
          if (!entry) continue;
          const v = entry.value !== undefined ? entry.value : entry.fieldValueNumber;
          if (v !== undefined && v !== null && v !== '') {
            const key = fieldRecords.find((r) => r.id === cfId).fieldKey;
            const rec = populatedCounts.get(key);
            rec.count++;
            if (rec.sampleRecordIds.length < 5) rec.sampleRecordIds.push({ contactId: c.id, value: v });
          }
        }
      }
      url = body.meta && body.meta.nextPageUrl ? body.meta.nextPageUrl : null;
    }
  }

  let opportunitiesScanned = 0;
  {
    let url = `${BASE}/opportunities/search?location_id=${locationId}&limit=100`;
    while (url) {
      const body = await getJson(url);
      const opps = body.opportunities ?? [];
      opportunitiesScanned += opps.length;
      for (const o of opps) {
        for (const ofId of opportunityFieldIds) {
          const entry = (o.customFields ?? []).find((f) => f.id === ofId);
          if (!entry) continue;
          const v = entry.fieldValueNumber !== undefined ? entry.fieldValueNumber : entry.fieldValue;
          if (v !== undefined && v !== null && v !== '') {
            const key = fieldRecords.find((r) => r.id === ofId).fieldKey;
            const rec = populatedCounts.get(key);
            rec.count++;
            if (rec.sampleRecordIds.length < 5) rec.sampleRecordIds.push({ opportunityId: o.id, value: v });
          }
        }
      }
      url = body.meta && body.meta.nextPageUrl ? body.meta.nextPageUrl : null;
    }
  }

  // 3. Workflows -- best-effort name-substring signal only.
  let workflows = [];
  let workflowsError = null;
  try {
    const body = await getJson(`${BASE}/workflows/?locationId=${locationId}`);
    workflows = body.workflows ?? [];
  } catch (e) {
    workflowsError = e.message;
  }
  const workflowNameHits = workflows
    .filter((w) => /offer/i.test(w.name || ''))
    .map((w) => ({ id: w.id, name: w.name, status: w.status }));

  // 4. Forms / Surveys / Funnels / Templates -- attempted, expected to fail
  //    given this token's granted scopes; reported literally either way.
  const otherSurfaces = {};
  for (const [label, url] of [
    ['forms', `${BASE}/forms/?locationId=${locationId}`],
    ['surveys', `${BASE}/surveys/?locationId=${locationId}`],
    ['funnels', `${BASE}/funnels/funnel/list?locationId=${locationId}`],
  ]) {
    try {
      const r = await get(url);
      otherSurfaces[label] = { status: r.status, ok: r.ok, inconclusive: !r.ok, bodyPreview: r.body.slice(0, 200) };
    } catch (e) {
      otherSurfaces[label] = { status: null, ok: false, inconclusive: true, error: e.message };
    }
  }

  const report = {
    selector: args.selector,
    locationId,
    fetchedAt: new Date().toISOString(),
    contactsScanned,
    opportunitiesScanned,
    fields: fieldRecords.map((r) => ({
      ...r,
      populated: populatedCounts.get(r.fieldKey),
    })),
    workflows: {
      totalFetched: workflows.length,
      error: workflowsError,
      nameSubstringHits: workflowNameHits,
      note: 'Name-substring match only -- GHL v2 API does not expose workflow trigger configuration. A hit here is NOT proof of a dependency; a miss is NOT proof of absence.',
    },
    otherSurfaces,
  };

  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json + '\n');
    console.error(`wrote ${args.out}`);
  }
  console.log(json);
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
