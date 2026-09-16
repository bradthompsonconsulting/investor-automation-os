/**
 * INV-67 checkbox-marker / broker-model repair -- Batch 1 of 3. Creates the
 * 48 narrowly-scoped Opportunity custom TEXT fields
 * `src/lib/contract-checkbox-marker-model.ts`'s `CHECKBOX_MARKER_KEYS`
 * requires. Mirrors `inv67-create-contract-projection-fields.cjs`'s (and,
 * before it, `inv70-create-current-offer-field.cjs`'s) proven pattern:
 * READ-ONLY DRY RUN BY DEFAULT, --apply to actually POST, always confirms
 * no clash first, always reads each created field back.
 *
 * Jess Gate correction (live-safety repair, this session) hardens FIVE
 * additional properties beyond the original pattern:
 *
 *   1. HARD LOCATION ALLOWLIST -- `--location` is still required with no
 *      default, but it must additionally equal `APPROVED_TEST_LOCATION_ID`
 *      exactly. The check runs BEFORE the credential file is ever read and
 *      BEFORE any network call -- a mismatched location (Production,
 *      typo, or anything else) refuses immediately. The Production
 *      location id is never present anywhere in this file; the approved
 *      Test id is present ONLY as this one allowlist constant.
 *   2. EXACT-EXISTING vs. CONFLICT, preflighted for ALL 48 specs BEFORE
 *      the first POST. A field that matches on name AND fieldKey AND
 *      dataType AND model AND parentId is `exact_existing` (safe to
 *      reuse, after its own re-verification). Anything else -- a partial
 *      match on only name or only fieldKey, multiple matching records, or
 *      a full identity match whose other properties differ -- is a
 *      `conflict`. If ANY spec conflicts, the WHOLE batch refuses before
 *      creating anything: zero POSTs.
 *   3. READBACK VALIDATION -- every field this script is about to treat
 *      as provisioned (freshly created OR reused exact-existing) is
 *      independently re-read and checked against name/fieldKey/dataType/
 *      model/parentId/id. A mismatch stops immediately with the created
 *      id (if any), expected-vs-actual values, and which fields were
 *      never attempted.
 *   4. UNCONFIRMED-CREATE SAFETY -- a POST response is parsed
 *      defensively; if it is not valid JSON or carries no `id`, this
 *      script reports that GHL may have created a field whose identity it
 *      cannot confirm, and stops -- it never attempts another creation
 *      after an unconfirmed one.
 *   5. Every exit path (full success, preflight conflict, POST failure,
 *      unconfirmed-create, readback transport failure, readback/exact-
 *      existing validation mismatch) prints the full proposed mapping and
 *      the results accumulated so far before the process ends.
 *
 * Pure classification/validation logic (`classifyExistingMatch`,
 * `validateFieldAgainstSpec`, `parsePostResponse`, `planBatch`) is
 * exported for `test-inv67-checkbox-marker-fields-batch1-script.cjs` to
 * exercise directly with synthetic data -- no network, no child process,
 * matching this codebase's established "pure function, testable in
 * isolation" convention. `main()` only runs when this file is executed
 * directly (`require.main === module`), never on `require()`.
 *
 * Usage:
 *   node scripts/inv67-create-checkbox-marker-fields-batch1.cjs --location <id>
 *                                                                --credential-file <path>
 *                                                                [--apply]
 *
 * Jess Gate correction (whole-batch/folder safety repair, this session):
 * there is NO `--only` flag. An earlier version accepted one, letting a
 * caller preflight a single field while 47 others' conflicts went
 * unchecked -- that violated the requirement that ALL 48 specs be
 * preflighted before the first POST. `main()` always calls `planBatch`
 * with the complete, unfiltered `FIELD_SPECS` array; there is no
 * partial-batch or single-field recovery mode in this script. If
 * partial-failure recovery is ever needed, it is a SEPARATELY gated,
 * separately reviewed capability designed after reviewing actual
 * partial-failure evidence -- not pre-authorized here.
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
 * `CHECKBOX_MARKER_KEYS` exactly -- same 48 keys, same order. Verified
 * programmatically at the top of `main()` (throws before any network
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
  // INV-67 Phase 2B narrow correction (Brad-authorized): the authoritative
  // source may now carry MORE keys than this batch's own 48 -- a later phase
  // legitimately adding new, unrelated keys is not drift for THIS script.
  // Only a key THIS script proposes going missing/renamed relative to its
  // own 48 is drift; a strict length/order equality check would (and did)
  // produce a false positive the moment any later phase extended the array.
  const missing = proposed.filter((k) => !authoritative.includes(k));
  if (missing.length > 0) {
    die(
      `FIELD_SPECS names key(s) no longer present in CHECKBOX_MARKER_KEYS: ${JSON.stringify(missing)} -- ` +
      `refusing to run. Update this script's FIELD_SPECS to match the authoritative source before retrying.`,
    );
  }
  console.log(`Verified: this script's 48 FIELD_SPECS keys all exist in CHECKBOX_MARKER_KEYS (the source may carry additional keys added by a later phase; that is not drift for this batch).\n`);
}

/**
 * Classifies one spec's relationship to the existing GHL inventory.
 *   - `{kind:'none'}` -- no existing field matches by name or fieldKey;
 *     safe to create.
 *   - `{kind:'exact_existing', field}` -- EXACTLY one existing field
 *     matches by name-or-fieldKey, and that field ALSO matches dataType
 *     TEXT, model 'opportunity', and the intended parentId. Safe to reuse
 *     -- but only after its own independent re-verification
 *     (`validateFieldAgainstSpec`), never trusted from this listing alone.
 *   - `{kind:'conflict', reasons, field?}` -- anything else: a match on
 *     ONLY name or ONLY fieldKey (not both), more than one existing
 *     record matching this spec's identity, or a single full-identity
 *     match whose dataType/model/parentId differ from what this spec
 *     requires. Never safe to proceed past.
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
 * against the spec it is supposed to satisfy. Used identically for both
 * cases -- an exact-existing field is never trusted without the SAME
 * check a freshly created one gets. `model` and `parentId` are checked
 * strictly, not optionally -- confirmed live (this session) that GHL's
 * customFields list AND single-field GET both always return both.
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
 * Parses a POST response body defensively. GHL is expected to return
 * `{ customField: { id, ... } }` or the field object directly -- either
 * way an `id` MUST be present. A parse failure or a missing id means
 * GHL's own confirmation of what (if anything) was created cannot be
 * trusted -- reported distinctly, never thrown as an unguarded exception.
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
 * The ONE canonical anchor this script resolves its target folder from.
 * Jess Gate correction (whole-batch/folder safety repair, this session):
 * an earlier version fell back to "the first Opportunity-field folder
 * found" when this anchor was missing -- that could silently place all 48
 * fields in the wrong folder. There is no fallback: the anchor must exist
 * exactly once and carry a non-empty `parentId`, or this script refuses
 * before any POST.
 */
const CANONICAL_PARENT_ANCHOR_FIELD_KEY = 'opportunity.arv_after_repair_value';

/**
 * Fail-closed resolution of the target folder. Returns `{ok:true,
 * parentId}` only when the canonical anchor exists EXACTLY once and its
 * `parentId` is a non-empty string; otherwise `{ok:false, reason}` naming
 * exactly which of the three failure conditions applies (missing,
 * duplicated, or blank parentId) -- never a generic message.
 */
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
 * Pure preflight over ALL specs at once -- classifies every one before a
 * single network call for field creation is ever made. Returns
 * `{ok:false, conflicts, plan}` if ANY spec conflicts (the caller must
 * create zero fields, full stop); otherwise `{ok:true, plan}`, one entry
 * per spec tagged `'create'` or `'reuse'`.
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
      console.log(`${String(r.ordinal).padStart(2)}. ${r.key.padEnd(45)} | ${r.name.padEnd(50)} | ${r.fieldKey.padEnd(55)} | ${r.mergeTag.padEnd(60)} | ${r.detail}`);
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
      // Never trust the bulk listing alone -- re-fetch and re-validate this ONE field independently.
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
