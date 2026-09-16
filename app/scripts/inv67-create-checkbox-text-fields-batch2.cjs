/**
 * INV-67 checkbox-marker / broker-model repair -- Batch 2 of 3. Creates
 * the 11 narrowly-scoped Opportunity custom TEXT fields
 * `src/lib/contract-checkbox-marker-model.ts`'s `CHECKBOX_TEXT_KEYS`
 * requires -- the free-text blanks embedded inside checkbox groups (day
 * counts, dollar/percent amounts, water source). Mirrors Batch 1's
 * (`inv67-create-checkbox-marker-fields-batch1.cjs`) hardened
 * architecture exactly -- that script is NOT modified by this one; this
 * is a new, sibling script for a different 11-key spec set.
 *
 * READ-ONLY DRY RUN BY DEFAULT, `--apply` required to POST (a later,
 * separately authorized phase -- not used by this dry-run task). Hard
 * Test-location allowlist, fail-closed canonical-anchor `parentId`
 * resolution, the complete unfiltered 11-spec batch always preflighted
 * before any POST (no `--only`, no partial-selection option), exact-
 * existing vs. conflict classification, readback validation on both
 * create and reuse paths, unconfirmed-create safety, and full partial-
 * failure/results reporting on every exit path -- all identical in kind
 * to Batch 1's, applied to this batch's own 11 specs.
 *
 * NO LOCATION SELECTOR. --location is required, no default -- and must
 * equal the approved IAOS Test location exactly (see
 * `APPROVED_TEST_LOCATION_ID` below) or this script refuses before
 * reading any credential file or making any network call.
 *
 * Usage:
 *   node scripts/inv67-create-checkbox-text-fields-batch2.cjs --location <id>
 *                                                              --credential-file <path>
 *                                                              [--apply]
 *
 * There is NO `--only` flag -- the complete, unfiltered 11-spec batch is
 * always preflighted together, exactly like Batch 1.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

/**
 * The ONLY location this script will ever act against. An allowlist
 * safety constant, NOT a default -- `--location` must still be passed
 * explicitly on every invocation, and it must equal this exactly. The
 * Production location id is never present anywhere in this file.
 */
const APPROVED_TEST_LOCATION_ID = 'SoTgVoaFGHtBdRFvXWQV';

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

function expectedFieldKey(name) {
  return 'opportunity.' + name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * MUST match `src/lib/contract-checkbox-marker-model.ts`'s
 * `CHECKBOX_TEXT_KEYS` exactly -- same 11 keys, same order. Verified
 * programmatically at the top of `main()` (throws before any network
 * call if the two ever diverge) rather than trusted by eye alone. Display
 * names are PROPOSED, not yet approved -- deterministic, "Contract ..."
 * prefixed, and consistent with the sibling Batch 1 marker field each one
 * supplies free text for (e.g. `survey_opt1_seller_furnish_days_text`
 * pairs with Batch 1's already-provisioned "Contract Survey Seller
 * Existing Survey Mark").
 */
const FIELD_SPECS = [
  { key: 'lease_nrl_terminate_within_days_text', name: 'Contract Natural Resource Leases Terminate Within Days' },
  { key: 'survey_opt1_seller_furnish_days_text', name: 'Contract Survey Seller Existing Survey Furnish Days' },
  { key: 'survey_opt2_buyer_obtain_days_text', name: 'Contract Survey Buyer New Survey Obtain Days' },
  { key: 'survey_opt3_seller_furnish_days_text', name: 'Contract Survey Seller New Survey Furnish Days' },
  { key: 'sdn_deliver_within_days_text', name: 'Contract Sellers Disclosure Notice Deliver Within Days' },
  { key: 'water_deliver_within_days_text', name: 'Contract Water Disclosure Deliver Within Days' },
  { key: 'water_source_text', name: 'Contract Water Disclosure Source' },
  { key: 'spbb_dollar_amount_text', name: 'Contract Seller Pays Buyer Broker Dollar Amount' },
  { key: 'spbb_percent_amount_text', name: 'Contract Seller Pays Buyer Broker Percent Amount' },
  { key: 'bpsb_dollar_amount_text', name: 'Contract Buyer Pays Seller Broker Dollar Amount' },
  { key: 'bpsb_percent_amount_text', name: 'Contract Buyer Pays Seller Broker Percent Amount' },
].map((s) => ({ ...s, dataType: 'TEXT' }));

/**
 * Fails loud, before any network call, if this script's own FIELD_SPECS
 * ever drifts from the authoritative `CHECKBOX_TEXT_KEYS`. Reads the
 * TypeScript source directly (regex, not a compile) so this script has
 * zero build-time dependency.
 */
function verifyAgainstAuthoritativeSource() {
  const srcPath = path.join(__dirname, '..', 'src', 'lib', 'contract-checkbox-marker-model.ts');
  const src = fs.readFileSync(srcPath, 'utf8');
  const m = src.match(/export const CHECKBOX_TEXT_KEYS = \[([\s\S]*?)\] as const;/);
  if (!m) die(`could not find CHECKBOX_TEXT_KEYS in ${srcPath} -- refusing to run against a source this script cannot verify.`);
  const authoritative = m[1]
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*"([^"]+)",?\s*$/))
    .filter(Boolean)
    .map((mm) => mm[1]);
  const proposed = FIELD_SPECS.map((s) => s.key);
  // INV-67 Phase 2B narrow correction (Brad-authorized): the authoritative
  // source may now carry MORE keys than this batch's own 11 -- a later phase
  // legitimately adding new, unrelated keys is not drift for THIS script.
  // Only a key THIS script proposes going missing/renamed relative to its
  // own 11 is drift; a strict length/order equality check would (and did)
  // produce a false positive the moment any later phase extended the array.
  const missing = proposed.filter((k) => !authoritative.includes(k));
  if (missing.length > 0) {
    die(
      `FIELD_SPECS names key(s) no longer present in CHECKBOX_TEXT_KEYS: ${JSON.stringify(missing)} -- ` +
      `refusing to run. Update this script's FIELD_SPECS to match the authoritative source before retrying.`,
    );
  }
  console.log(`Verified: this script's 11 FIELD_SPECS keys all exist in CHECKBOX_TEXT_KEYS (the source may carry additional keys added by a later phase; that is not drift for this batch).\n`);
}

/**
 * The ONE canonical anchor this script resolves its target folder from --
 * identical discipline to Batch 1: the anchor must exist exactly once and
 * carry a non-empty `parentId`, or this script refuses before any POST.
 * No fallback to an arbitrary folder.
 */
const CANONICAL_PARENT_ANCHOR_FIELD_KEY = 'opportunity.arv_after_repair_value';

function resolveCanonicalParentId(existingFields) {
  const matches = existingFields.filter((f) => f.fieldKey === CANONICAL_PARENT_ANCHOR_FIELD_KEY);
  if (matches.length === 0) {
    return {
      ok: false,
      reason: `canonical anchor field "${CANONICAL_PARENT_ANCHOR_FIELD_KEY}" was not found among this location's Opportunity custom fields. Refusing -- there is no fallback to an arbitrary folder.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `canonical anchor field "${CANONICAL_PARENT_ANCHOR_FIELD_KEY}" exists ${matches.length} times (ids: ${matches.map((f) => f.id).join(', ')}) -- ambiguous, refusing rather than guessing which one is authoritative.`,
    };
  }
  const anchor = matches[0];
  if (typeof anchor.parentId !== 'string' || anchor.parentId.trim() === '') {
    return {
      ok: false,
      reason: `canonical anchor field "${CANONICAL_PARENT_ANCHOR_FIELD_KEY}" (id ${anchor.id}) has no usable parentId (got ${JSON.stringify(anchor.parentId)}). Refusing.`,
    };
  }
  return { ok: true, parentId: anchor.parentId };
}

/**
 * Classifies one spec's relationship to the existing GHL inventory --
 * identical logic to Batch 1's `classifyExistingMatch`. `{kind:'none'}`
 * (no match, safe to create), `{kind:'exact_existing', field}` (name AND
 * fieldKey AND dataType AND model AND parentId all agree -- safe to
 * reuse, after independent re-verification), or `{kind:'conflict',
 * reasons, field?}` (a partial match, multiple matching records, or a
 * full identity match whose other properties differ).
 */
function classifyExistingMatch(spec, expectedKey, parentId, existingFields) {
  const nameMatches = existingFields.filter((f) => f.name === spec.name);
  const keyMatches = existingFields.filter((f) => f.fieldKey === expectedKey);
  const matchingIds = new Set([...nameMatches, ...keyMatches].map((f) => f.id));
  if (matchingIds.size === 0) return { kind: 'none' };
  if (matchingIds.size > 1) {
    return {
      kind: 'conflict',
      reasons: [`${matchingIds.size} distinct existing fields match this spec by name or fieldKey (ids: ${[...matchingIds].join(', ')}) -- ambiguous, refusing.`],
    };
  }
  const onlyId = [...matchingIds][0];
  const candidate = existingFields.find((f) => f.id === onlyId);
  const matchedByName = candidate.name === spec.name;
  const matchedByKey = candidate.fieldKey === expectedKey;
  if (!(matchedByName && matchedByKey)) {
    return {
      kind: 'conflict',
      field: candidate,
      reasons: [
        matchedByName
          ? `name matches ("${spec.name}") but fieldKey differs: expected "${expectedKey}", existing field (id ${candidate.id}) has "${candidate.fieldKey}"`
          : `fieldKey matches ("${expectedKey}") but name differs: expected "${spec.name}", existing field (id ${candidate.id}) has "${candidate.name}"`,
      ],
    };
  }
  const identityValidation = validateFieldAgainstSpec(spec, expectedKey, parentId, candidate);
  if (!identityValidation.ok) {
    return { kind: 'conflict', field: candidate, reasons: identityValidation.mismatches };
  }
  return { kind: 'exact_existing', field: candidate };
}

/**
 * Validates a field object (either just-created-and-read-back, or an
 * `exact_existing` candidate re-verified via its own single-field GET)
 * against the spec it is supposed to satisfy -- identical discipline to
 * Batch 1: `model` and `parentId` are checked strictly, confirmed live
 * (Batch 1 session) that GHL's customFields list AND single-field GET
 * both always return both.
 */
function validateFieldAgainstSpec(spec, expectedKey, parentId, field) {
  const mismatches = [];
  if (!field || typeof field !== 'object') return { ok: false, mismatches: ['field object missing or not an object'] };
  if (field.name !== spec.name) mismatches.push(`name: expected "${spec.name}", got "${field.name}"`);
  if (field.fieldKey !== expectedKey) mismatches.push(`fieldKey: expected "${expectedKey}", got "${field.fieldKey}"`);
  if (field.dataType !== spec.dataType) mismatches.push(`dataType: expected "${spec.dataType}", got "${field.dataType}"`);
  if (field.model !== 'opportunity') mismatches.push(`model: expected "opportunity", got "${field.model}"`);
  if (field.parentId !== parentId) mismatches.push(`parentId: expected "${parentId}", got "${field.parentId}"`);
  if (!field.id) mismatches.push('id: missing');
  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}

/**
 * Parses a POST response body defensively -- identical to Batch 1's
 * `parsePostResponse`. A parse failure or a missing id means GHL's own
 * confirmation of what (if anything) was created cannot be trusted --
 * reported distinctly, never thrown as an unguarded exception.
 */
function parsePostResponse(postText) {
  let parsed;
  try {
    parsed = JSON.parse(postText);
  } catch (e) {
    return { ok: false, reason: `response body is not valid JSON: ${e.message}` };
  }
  const field = (parsed && typeof parsed === 'object' && parsed.customField) ? parsed.customField : parsed;
  if (!field || typeof field !== 'object' || !field.id) {
    return { ok: false, reason: `response JSON parsed but carries no usable "id" field (${JSON.stringify(parsed).slice(0, 200)})` };
  }
  return { ok: true, field };
}

/**
 * Pure preflight over ALL 11 specs at once -- classifies every one before
 * a single network call for field creation is ever made. Returns
 * `{ok:false, conflicts, plan}` if ANY spec conflicts (zero creates, full
 * stop); otherwise `{ok:true, plan}`, one entry per spec tagged
 * `'create'` or `'reuse'`.
 */
function planBatch(specs, existingFields, parentId) {
  const plan = [];
  const conflicts = [];
  for (const spec of specs) {
    const expectedKey = expectedFieldKey(spec.name);
    const classification = classifyExistingMatch(spec, expectedKey, parentId, existingFields);
    if (classification.kind === 'conflict') {
      conflicts.push({ key: spec.key, name: spec.name, reasons: classification.reasons });
      plan.push({ spec, expectedKey, action: 'conflict', classification });
      continue;
    }
    plan.push({ spec, expectedKey, action: classification.kind === 'exact_existing' ? 'reuse' : 'create', classification });
  }
  return conflicts.length > 0 ? { ok: false, conflicts, plan } : { ok: true, plan };
}

module.exports = {
  APPROVED_TEST_LOCATION_ID,
  FIELD_SPECS,
  CANONICAL_PARENT_ANCHOR_FIELD_KEY,
  expectedFieldKey,
  verifyAgainstAuthoritativeSource,
  classifyExistingMatch,
  validateFieldAgainstSpec,
  parsePostResponse,
  resolveCanonicalParentId,
  planBatch,
};

async function main() {
  verifyAgainstAuthoritativeSource();

  const args = parseArgs(process.argv.slice(2));

  // HARD LOCATION ALLOWLIST -- before credential reading, before any network access.
  if (args.location !== APPROVED_TEST_LOCATION_ID) {
    die(`Test location only. --location must equal the approved IAOS Test location (${APPROVED_TEST_LOCATION_ID}); got "${args.location}". Refusing before reading any credential file or making any network call.`);
  }

  const token = parseEnv(fs.readFileSync(args.credentialFile, 'utf8')).GHL_PRIVATE_API_KEY;
  if (!token) die(`GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}.`);

  const existingOpp = await get(token, `${BASE}/locations/${args.location}/customFields?model=opportunity`);
  const existingFields = existingOpp.customFields ?? [];

  const resolvedParent = resolveCanonicalParentId(existingFields);
  if (!resolvedParent.ok) die(resolvedParent.reason);
  const parentId = resolvedParent.parentId;

  console.log('Location:', args.location, '(verified == approved Test location)');
  console.log(`Resolved canonical parentId (from the single required "${CANONICAL_PARENT_ANCHOR_FIELD_KEY}" anchor):`, parentId);
  console.log('Existing Opportunity custom fields in this location:', existingFields.length);
  console.log('Field count this batch (always the complete FIELD_SPECS -- no partial-batch mode):', FIELD_SPECS.length, '\n');

  const batch = planBatch(FIELD_SPECS, existingFields, parentId);
  const rows = batch.plan.map((p, i) => ({
    ordinal: i + 1,
    key: p.spec.key,
    name: p.spec.name,
    fieldKey: p.expectedKey,
    mergeTag: `{{${p.expectedKey}}}`,
    action: p.action,
    detail: p.action === 'conflict' ? `CONFLICT -- ${p.classification.reasons.join('; ')}` : p.action === 'reuse' ? `exact existing id ${p.classification.field.id}` : 'none, will create',
  }));
  const results = {};

  function printSummaryAndExit(code, closingMessage) {
    console.log('\n--- Proposed mapping (ordinal | key | name | fieldKey | mergeTag | action) ---');
    for (const r of rows) {
      console.log(`${String(r.ordinal).padStart(2)}. ${r.key.padEnd(45)} | ${r.name.padEnd(55)} | ${r.fieldKey.padEnd(60)} | ${r.mergeTag.padEnd(65)} | ${r.detail}`);
    }
    console.log('\n--- Results (key -> id; dry-run/never-attempted entries absent) ---');
    console.log(JSON.stringify(results, null, 2));
    if (closingMessage) console.log('\n' + closingMessage);
    process.exit(code);
  }

  if (!batch.ok) {
    console.error(`PREFLIGHT CONFLICTS -- ${batch.conflicts.length} of ${FIELD_SPECS.length} specs conflict. Creating ZERO fields.`);
    for (const c of batch.conflicts) console.error(`  CONFLICT ${c.key}: ${c.reasons.join('; ')}`);
    printSummaryAndExit(5, 'PREFLIGHT REFUSED THE WHOLE BATCH -- one or more specs conflict with the existing GHL inventory. Zero fields were created. Resolve the conflicts (or correct FIELD_SPECS if it has drifted) and re-run.');
  }

  for (const entry of batch.plan) {
    const { spec, expectedKey, action, classification } = entry;

    if (action === 'reuse') {
      let rb;
      try {
        const readback = await get(token, `${BASE}/locations/${args.location}/customFields/${classification.field.id}`);
        rb = readback.customField ?? readback;
      } catch (e) {
        printSummaryAndExit(6, `PARTIAL FAILURE -- re-verification GET for the EXACT EXISTING candidate for ${spec.key} (id ${classification.field.id}) failed: ${e.message}. Refusing to treat it as safely provisioned. Nothing after ${spec.key} in FIELD_SPECS order was attempted.`);
      }
      const validation = validateFieldAgainstSpec(spec, expectedKey, parentId, rb);
      if (!validation.ok) {
        printSummaryAndExit(6, `EXACT EXISTING field for ${spec.key} (id ${classification.field.id}) failed re-verification: ${validation.mismatches.join('; ')}. Refusing to treat it as safely provisioned. Nothing after ${spec.key} in FIELD_SPECS order was attempted.`);
      }
      console.log(`REUSE ${spec.key.padEnd(45)} -- verified existing id ${rb.id}, fieldKey ${rb.fieldKey}, dataType ${rb.dataType}`);
      results[spec.key] = rb.id;
      continue;
    }

    // action === 'create'
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

    const parsedPost = parsePostResponse(postText);
    if (!parsedPost.ok) {
      console.error(`UNCONFIRMED-CREATE ${spec.key.padEnd(33)} -- POST returned HTTP ${postRes.status} but ${parsedPost.reason}`);
      printSummaryAndExit(7, `PARTIAL FAILURE -- POST for ${spec.key} returned HTTP ${postRes.status} (success), but GHL may have created a field whose identity IAOS cannot confirm from the response body. Stopping immediately -- no further creation attempted. Everything above "Results" that already carries an id was CONFIRMED created; ${spec.key} is NOT in that list despite possibly existing in GHL now. Nothing after ${spec.key} in FIELD_SPECS order was attempted.`);
    }
    const created = parsedPost.field;
    results[spec.key] = created.id;

    let rb;
    try {
      const readback = await get(token, `${BASE}/locations/${args.location}/customFields/${created.id}`);
      rb = readback.customField ?? readback;
    } catch (e) {
      console.error(`FAIL-READBACK ${spec.key.padEnd(38)} -- created (id ${created.id}) but readback failed: ${e.message}`);
      printSummaryAndExit(4, `PARTIAL FAILURE -- ${spec.key} WAS created in GHL (id ${created.id}) but its readback could not confirm it. Everything above "Results" that carries an id was actually created; nothing after it in FIELD_SPECS order was attempted.`);
    }

    const validation = validateFieldAgainstSpec(spec, expectedKey, parentId, rb);
    if (!validation.ok) {
      console.error(`READBACK-MISMATCH ${spec.key.padEnd(34)} -- created (id ${created.id}) but readback mismatches: ${validation.mismatches.join('; ')}`);
      printSummaryAndExit(8, `PARTIAL FAILURE -- ${spec.key} WAS created in GHL (id ${created.id}) but its readback does not match the intended spec: ${validation.mismatches.join('; ')}. Everything above "Results" that carries an id was actually created; nothing after ${spec.key} in FIELD_SPECS order was attempted.`);
    }
    console.log(`CREATE ${spec.key.padEnd(45)} -- id ${rb.id}, fieldKey ${rb.fieldKey}, dataType ${rb.dataType} -- readback verified`);
  }

  if (!args.apply) {
    printSummaryAndExit(0, 'DRY RUN -- no POST issued for any field. Re-run with --apply, after Jess/Brad review of this batch, to create.');
  } else {
    printSummaryAndExit(0, 'Next step: paste these ids into app/shared/ghl-config.ts, and update the drift-guard tests accordingly.');
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
}
