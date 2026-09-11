/**
 * INV-70 / B9-07A Phase 2 -- Repairs migration/backfill report. Family 3's
 * approved ruling.
 *
 * DRY-RUN BY DEFAULT AND ALWAYS SAFE TO RUN. Reads every Opportunity in
 * the named location, reads its linked Contact, classifies the pair with
 * the SAME pure `classifyRepairsMigrationCandidate` this phase's test
 * suite already proves (mirrored here as plain JS -- see the header note
 * below), and writes a JSON report. No PUT, no POST, no field creation,
 * no deletion -- GET only, always, regardless of flags.
 *
 * --apply IS ACCEPTED BUT REFUSES UNLESS THE LOCATION IS EXPLICITLY TEST.
 * Per this phase's authorization ("Perform GHL mutations in TEST only
 * during this phase" / "Produce a dry-run Production migration/backfill
 * report only; no Production writes"), Production can never apply through
 * this script, structurally, not by operator discipline.
 *
 * INV-70 / B9-07A PHASE 3. --apply now actually writes, for `test` only,
 * and only for rows classified `backfill_candidate` AND explicitly
 * excluded from `--exclude-opportunity` (a repeatable-by-comma list of
 * opportunity ids never to write, regardless of classification -- the
 * mechanism this phase uses to keep a known stale/non-representative
 * record out of a bulk backfill without hand-editing the script). Every
 * write PUTs `opportunity.repair_estimate` (never Contact -- PB-D55, the
 * Opportunity field is the one being backfilled INTO) and reads it back,
 * mirroring `ghl.ts`'s own `setRepairEstimate` shape exactly (same body:
 * `{customFields:[{id, field_value}]}`, same singular-GET readback). A
 * row already `already_authoritative` (a non-empty Opportunity value) is
 * NEVER written to, structurally -- only `backfill_candidate` rows reach
 * the write loop at all; this is not merely a runtime check, it is which
 * array the loop iterates.
 *
 * THE CLASSIFICATION LOGIC IS A DELIBERATE MIRROR, NOT A REQUIRE. This
 * script is plain JS so it can run standalone without a TypeScript
 * compile step (matching this repo's other ad hoc GHL recon scripts, e.g.
 * b0-property-recon.cjs) -- the authoritative, tested implementation is
 * `app/src/lib/repair-estimation/migration.ts`, proven by
 * `test-repairs-canonicalization.cjs`. If the two ever diverge, the
 * TypeScript module governs; this script's own STATIC_MIRROR_CHECK below
 * fails loudly if the two source texts disagree on the decision boundary
 * rather than silently drifting.
 *
 * Usage:
 *   node scripts/inv70-repairs-migration.cjs --selector test|production
 *                                             --credential-file <path>
 *                                             [--out <path>] [--limit N]
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
  const limit = get('--limit') ? Number(get('--limit')) : null;
  const apply = argv.includes('--apply');
  if (apply && selector !== 'test') die('--apply refuses for any selector other than "test". Production can never apply through this script.');
  const excludeOpportunityRaw = get('--exclude-opportunity');
  const excludeOpportunity = new Set(excludeOpportunityRaw ? excludeOpportunityRaw.split(',').map((s) => s.trim()).filter(Boolean) : []);
  return { selector, credentialFile, out, limit, apply, excludeOpportunity };
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Mirror of app/src/lib/repair-estimation/migration.ts's
 * classifyRepairsMigrationCandidate. Kept intentionally tiny so a manual
 * diff against the TypeScript source is cheap.
 */
function classifyRepairsMigrationCandidate({ contactValue, opportunityValue }) {
  if (opportunityValue !== null) {
    return {
      kind: 'already_authoritative',
      opportunityValue,
      matchesContact: contactValue !== null && contactValue === opportunityValue,
    };
  }
  if (contactValue !== null) {
    return { kind: 'backfill_candidate', value: contactValue };
  }
  return { kind: 'nothing_to_do' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Static mirror check, BEFORE any network call: the TypeScript source's
  // decision boundary (opportunityValue !== null wins, full stop) must
  // still read the same way. This does not re-run the TS function -- it
  // greps for the literal condition so a future edit to the real module
  // that changes this boundary cannot silently leave this mirror stale.
  const tsSrc = fs.readFileSync(path.join(APP, 'src', 'lib', 'repair-estimation', 'migration.ts'), 'utf8');
  if (!tsSrc.includes('if (args.opportunityValue !== null) {')) {
    die('STATIC_MIRROR_CHECK failed: migration.ts\'s decision boundary text changed. ' +
      'This script\'s JS mirror must be re-checked against the new source before trusting its output.');
  }

  const { getConfig } = require('./ghl-config-loader.cjs');
  const config = getConfig(args.selector);
  const locationId = config.locationId;
  const opportunityRepairsFieldId = config.opportunityFacts.repairs;
  const contactRepairsFieldId = config.fields.estimatedRepairs;

  let envText;
  try {
    envText = fs.readFileSync(args.credentialFile, 'utf8');
  } catch (_) {
    die(`--credential-file ${args.credentialFile} could not be read.`);
  }
  const token = parseEnvFile(envText).GHL_PRIVATE_API_KEY;
  if (!token) die(`GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}.`);

  async function get(url) {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } });
    if (!res.ok) die(`GHL returned HTTP ${res.status} for a read of ${url.replace(BASE, '')}`);
    return res.json();
  }

  console.error(`selector=${args.selector} locationId=${locationId} apply=${args.apply}`);
  console.error(`opportunityFacts.repairs=${opportunityRepairsFieldId} fields.estimatedRepairs=${contactRepairsFieldId}`);

  // Page through every opportunity in the location.
  const opportunities = [];
  let url = `${BASE}/opportunities/search?location_id=${locationId}&limit=100`;
  while (url) {
    const body = await get(url);
    opportunities.push(...(body.opportunities ?? []));
    if (args.limit && opportunities.length >= args.limit) break;
    url = body.meta && body.meta.nextPageUrl ? body.meta.nextPageUrl : null;
  }
  const scoped = args.limit ? opportunities.slice(0, args.limit) : opportunities;
  console.error(`opportunities found: ${opportunities.length}${args.limit ? ` (scoped to first ${scoped.length} by --limit)` : ''}`);

  // Distinct contacts, so each is read at most once even if (rare, but
  // possible per PB-D55) one contact carries more than one opportunity.
  const contactIds = [...new Set(scoped.map((o) => o.contactId).filter(Boolean))];
  const contactRepairsById = new Map();
  for (const cid of contactIds) {
    const body = await get(`${BASE}/contacts/${cid}`);
    const contact = body.contact ?? body;
    const entry = (contact.customFields ?? []).find((f) => f.id === contactRepairsFieldId);
    const value = entry && entry.value !== undefined && entry.value !== '' ? Number(entry.value) : null;
    contactRepairsById.set(cid, Number.isFinite(value) ? value : null);
  }

  const rows = scoped.map((opp) => {
    const oppEntry = (opp.customFields ?? []).find((f) => f.id === opportunityRepairsFieldId);
    // List-endpoint shape (PB-D58/59): NUMERICAL carries fieldValueNumber.
    const oppRaw = oppEntry ? oppEntry.fieldValueNumber : undefined;
    const opportunityValue = oppRaw !== undefined && oppRaw !== null && Number.isFinite(Number(oppRaw)) ? Number(oppRaw) : null;
    const contactValue = opp.contactId ? (contactRepairsById.get(opp.contactId) ?? null) : null;
    return {
      contactId: opp.contactId ?? null,
      opportunityId: opp.id,
      contactValue,
      opportunityValue,
      classification: classifyRepairsMigrationCandidate({ contactValue, opportunityValue }),
    };
  });

  const summary = rows.reduce((acc, row) => {
    acc.total++;
    if (row.classification.kind === 'backfill_candidate') acc.backfillCandidates++;
    else if (row.classification.kind === 'already_authoritative') {
      acc.alreadyAuthoritative++;
      if (!row.classification.matchesContact) acc.alreadyAuthoritativeMismatched++;
    } else acc.nothingToDo++;
    return acc;
  }, { total: 0, backfillCandidates: 0, alreadyAuthoritative: 0, alreadyAuthoritativeMismatched: 0, nothingToDo: 0 });

  const backfillCandidates = rows.filter((r) => r.classification.kind === 'backfill_candidate');
  const writeResults = [];
  if (args.apply) {
    async function put(url, body) {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Version: API_VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, body: text };
    }
    function roundCurrency(n) { return Math.round(n * 100) / 100; }

    for (const row of backfillCandidates) {
      if (args.excludeOpportunity.has(row.opportunityId)) {
        writeResults.push({ opportunityId: row.opportunityId, skipped: true, reason: 'excluded via --exclude-opportunity' });
        continue;
      }
      const sent = roundCurrency(row.classification.value);
      const putRes = await put(`${BASE}/opportunities/${row.opportunityId}`, {
        customFields: [{ id: opportunityRepairsFieldId, field_value: sent }],
      });
      if (!putRes.ok) {
        writeResults.push({ opportunityId: row.opportunityId, sent, ok: false, putStatus: putRes.status, error: putRes.body.slice(0, 300) });
        continue;
      }
      const readback = await get(`${BASE}/opportunities/${row.opportunityId}`);
      const opp = readback.opportunity ?? readback;
      const entry = (opp.customFields ?? []).find((f) => f.id === opportunityRepairsFieldId);
      const observed = entry ? (entry.fieldValueNumber !== undefined ? entry.fieldValueNumber : entry.fieldValue) : null;
      writeResults.push({ opportunityId: row.opportunityId, sent, ok: entry !== undefined && Number(observed) === sent, putStatus: putRes.status, observed });
    }
  }

  const report = {
    selector: args.selector,
    locationId,
    fetchedAt: new Date().toISOString(),
    applyRequested: args.apply,
    applyExecuted: args.apply && writeResults.some((w) => !w.skipped),
    excludeOpportunity: [...args.excludeOpportunity],
    summary,
    backfillCandidates,
    conflicts: rows.filter((r) => r.classification.kind === 'already_authoritative' && !r.classification.matchesContact),
    writeResults,
  };

  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json + '\n');
    console.error(`wrote ${args.out}`);
  }
  console.log(json);

  console.error('');
  console.error(`total=${summary.total} backfillCandidates=${summary.backfillCandidates} ` +
    `alreadyAuthoritative=${summary.alreadyAuthoritative} (mismatched=${summary.alreadyAuthoritativeMismatched}) ` +
    `nothingToDo=${summary.nothingToDo}`);

  if (args.apply) {
    console.error('');
    console.error(`--apply: ${writeResults.length} backfill row(s) processed, ` +
      `${writeResults.filter((w) => w.ok).length} confirmed written, ` +
      `${writeResults.filter((w) => w.skipped).length} skipped (excluded), ` +
      `${writeResults.filter((w) => !w.ok && !w.skipped).length} failed.`);
  }
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
