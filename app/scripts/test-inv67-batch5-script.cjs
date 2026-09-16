/**
 * INV-67 Phase 2B -- Batch 5 GHL Test provisioning script safety proof.
 * Proves `inv67-create-batch5-fields.cjs` satisfies every safety property
 * required before it is authorized for a live `--apply` run, WITHOUT ever
 * making a network call itself -- the same properties every prior batch's
 * script and suite established, applied to this batch's own 6 specs
 * spanning THREE authoritative source arrays across TWO files:
 *
 *   1. Exactly 6 FIELD_SPECS, each matching its declared authoritative
 *      source array (2 CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS, 1
 *      CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS, 1 CHECKBOX_TEXT_KEYS,
 *      2 CHECKBOX_MARKER_KEYS), the exact authorized names/fieldKeys.
 *   2. `require()`-ing this script never auto-runs `main()`.
 *   3. Hard Test-location allowlist, proven statically and via real,
 *      network-free child-process spawns.
 *   4. Self-verification runs before any network access.
 *   5. `classifyExistingMatch` -- exact_existing vs. every conflict shape.
 *   6. `validateFieldAgainstSpec` -- gates both readback and exact_existing
 *      re-verification.
 *   7. `parsePostResponse` -- malformed/missing-id responses never treated
 *      as a confirmed create.
 *   8. `planBatch` -- preflights ALL 6 specs before any POST; one conflict
 *      refuses the WHOLE batch. A future successful apply, re-run, would
 *      classify all six as reuse -- never a duplicate create.
 *   9. There is no `--only` flag -- the complete, unfiltered batch is
 *      always preflighted together.
 *   10. `resolveCanonicalParentId` fails closed on all three failure
 *       shapes; no arbitrary "first folder" fallback exists.
 *   11. No PUT/PATCH/DELETE; no template/draft/send/Linear/non-
 *       customFields endpoint.
 *   12. Every exit path prints the proposed mapping + results before
 *       exiting.
 *   13. This script does NOT modify any prior batch/Seller Count script,
 *       and declares exactly the 6 authorized keys -- none of the 112
 *       already-provisioned keys, Contract Draft Request, or Contract
 *       Seller Count.
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const SCRIPT = path.join(APP, 'scripts', 'inv67-create-batch5-fields.cjs');
const BATCH4_SCRIPT = path.join(APP, 'scripts', 'inv67-create-transport-only-fields-batch4.cjs');
const SELLER_COUNT_SCRIPT = path.join(APP, 'scripts', 'inv67-create-seller-count-field.cjs');
const TMP = path.join(APP, '.tmp-inv67-batch5-script-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const SOURCES = [
  path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts'),
  path.join(APP, 'src', 'lib', 'contract-checkbox-marker-model.ts'),
  path.join(APP, 'src', 'lib', 'contract-broker-arrangement-model.ts'),
  path.join(APP, 'src', 'lib', 'seller-contract-facts-carriers.ts'),
  path.join(APP, 'src', 'lib', 'contract-ghl-transport-formatting.ts'),
  path.join(APP, 'src', 'lib', 'contract-seller-signing-model.ts'),
];
try {
  execSync('npx tsc ' + SOURCES.map((s) => '"' + s + '"').join(' ') + ` --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}
const { CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS, CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS } = require(path.join(TMP, 'contract-ghl-projection-model.js'));
const { CHECKBOX_MARKER_KEYS, CHECKBOX_TEXT_KEYS } = require(path.join(TMP, 'contract-checkbox-marker-model.js'));

// require()-ing the script itself is safe: main() only runs when
// `require.main === module`, which is false here.
const S = require(SCRIPT);
const src = fs.readFileSync(SCRIPT, 'utf8');

const FLOOR = 101;
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

const PARENT_ID = 'sGP3pbDQFN7fXS62MAgA';
function realField(overrides) {
  return { id: 'existing-id-1', name: 'Contract Legal City', fieldKey: 'opportunity.contract_legal_city', dataType: 'TEXT', model: 'opportunity', parentId: PARENT_ID, ...overrides };
}
const SPEC1 = S.FIELD_SPECS[0]; // propertyLegalDescription.legalMunicipality
const SPEC1_KEY = S.expectedFieldKey(SPEC1.name);

/* ==================================================================== */
/* 1. FIELD_SPECS -- exactly 6, each matching its declared authoritative */
/*    source array, and the exact authorized names/fieldKeys             */
/* ==================================================================== */

const fieldSpecRows = Array.from(src.matchAll(/\{ key: '([^']+)', name: '([^']+)', sourceArray: '([^']+)', sourceFile: '([^']+)' \}/g))
  .map((m) => ({ key: m[1], name: m[2], sourceArray: m[3], sourceFile: m[4] }));
check('script declares exactly 6 FIELD_SPECS', fieldSpecRows.length, 6);
check('FIELD_SPECS keys are unique', new Set(fieldSpecRows.map((r) => r.key)).size, 6);
check('module.exports.FIELD_SPECS also has exactly 6 entries, same order', S.FIELD_SPECS.map((s) => s.key), fieldSpecRows.map((r) => r.key));
check('every FIELD_SPEC is dataType TEXT', S.FIELD_SPECS.map((s) => s.dataType), new Array(6).fill('TEXT'));

check(
  'the exact authorized keys, names, and fieldKeys, in order',
  S.FIELD_SPECS.map((s) => [s.key, s.name, S.expectedFieldKey(s.name)]),
  [
    ['propertyLegalDescription.legalMunicipality', 'Contract Legal City', 'opportunity.contract_legal_city'],
    ['sales_price_amount_text', 'Contract Sales Price Amount Text', 'opportunity.contract_sales_price_amount_text'],
    ['financing_sum_amount_text', 'Contract Financing Sum Amount Text', 'opportunity.contract_financing_sum_amount_text'],
    ['as_is_repairs_text', 'Contract As Is Repairs Text', 'opportunity.contract_as_is_repairs_text'],
    ['district_notices_mark', 'Contract District Notices Mark', 'opportunity.contract_district_notices_mark'],
    ['other_addenda_mark', 'Contract Other Addenda Mark', 'opportunity.contract_other_addenda_mark'],
  ],
);

const transportOnlyKeysInSpec = fieldSpecRows.filter((r) => r.sourceArray === 'CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS').map((r) => r.key);
const retainedKeysInSpec = fieldSpecRows.filter((r) => r.sourceArray === 'CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS').map((r) => r.key);
const markerKeysInSpec = fieldSpecRows.filter((r) => r.sourceArray === 'CHECKBOX_MARKER_KEYS').map((r) => r.key);
const textKeysInSpec = fieldSpecRows.filter((r) => r.sourceArray === 'CHECKBOX_TEXT_KEYS').map((r) => r.key);
check('2 specs claim CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS', transportOnlyKeysInSpec.length, 2);
check('1 spec claims CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS', retainedKeysInSpec.length, 1);
check('2 specs claim CHECKBOX_MARKER_KEYS', markerKeysInSpec.length, 2);
check('1 spec claims CHECKBOX_TEXT_KEYS', textKeysInSpec.length, 1);
checkTrue('both claimed CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS entries actually exist in the authoritative array', transportOnlyKeysInSpec.every((k) => CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.includes(k)));
checkTrue('the claimed CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS entry actually exists in the authoritative array', retainedKeysInSpec.every((k) => CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.includes(k)));
checkTrue('both claimed CHECKBOX_MARKER_KEYS entries actually exist in the authoritative array', markerKeysInSpec.every((k) => CHECKBOX_MARKER_KEYS.includes(k)));
checkTrue('the claimed CHECKBOX_TEXT_KEYS entry actually exists in the authoritative array', textKeysInSpec.every((k) => CHECKBOX_TEXT_KEYS.includes(k)));
checkTrue('none of the 6 keys collides with any pre-existing (Batch 1-4 + 27 retained) key', S.FIELD_SPECS.every((s) => {
  const preExisting = [
    ...CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_KEYS.filter((k) => k !== 'propertyLegalDescription.legalMunicipality'),
    ...CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS.filter((k) => !['sales_price_amount_text', 'financing_sum_amount_text'].includes(k)),
    ...CHECKBOX_MARKER_KEYS.filter((k) => !['district_notices_mark', 'other_addenda_mark'].includes(k)),
    ...CHECKBOX_TEXT_KEYS.filter((k) => k !== 'as_is_repairs_text'),
  ];
  return !preExisting.includes(s.key);
}));
checkTrue('Contract Seller Count is NOT one of the FIELD_SPECS names', !S.FIELD_SPECS.some((s) => s.name === 'Contract Seller Count'));
checkTrue('Contract Draft Request is NOT part of this batch', !src.includes('Contract Draft Request'));
checkTrue('no broker text key ("buyer_broker_"/"seller_broker_") is part of this batch', !/buyer_broker_|seller_broker_/.test(src));

/* ==================================================================== */
/* 2. require() never auto-runs main()                                   */
/* ==================================================================== */

checkTrue('main() auto-run is guarded by require.main === module', /if \(require\.main === module\) \{\s*main\(\)\.catch/.test(src));

/* ==================================================================== */
/* 3. HARD LOCATION ALLOWLIST                                            */
/* ==================================================================== */

check('APPROVED_TEST_LOCATION_ID is exported and equals the approved IAOS Test location', S.APPROVED_TEST_LOCATION_ID, 'SoTgVoaFGHtBdRFvXWQV');
checkTrue('the Production location id never appears anywhere in this script', !src.includes('jmHG4B8RdzwpfqruNf68'));
{
  const mainStart = src.indexOf('async function main()');
  const guardIdx = src.indexOf('if (args.location !== APPROVED_TEST_LOCATION_ID)', mainStart);
  const credReadIdx = src.indexOf('fs.readFileSync(args.credentialFile', mainStart);
  const firstNetworkCallFromMainIdx = src.indexOf('await get(token,', mainStart);
  checkTrue('the location-allowlist guard appears BEFORE the credential file is read, textually', guardIdx > mainStart && guardIdx < credReadIdx);
  checkTrue('the location-allowlist guard appears BEFORE the first network call main() makes, textually', guardIdx > mainStart && guardIdx < firstNetworkCallFromMainIdx);
}
{
  const bogusCred = path.join(TMP, 'nope.env');
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV', '--credential-file', bogusCred], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('approved Test location PASSES the guard: no "Test location only" refusal', !/Test location only/.test(r.stderr));
  checkTrue('approved Test location proceeds to the network boundary: dies on the credential file (ENOENT), not on location', /ENOENT|no such file/i.test(String(r.stderr || r.error || '')));
}
{
  const bogusCred = path.join(TMP, 'nope.env');
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'jmHG4B8RdzwpfqruNf68', '--credential-file', bogusCred], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('Production location id is refused with "Test location only", before any credential read', /Test location only/.test(r.stderr));
  checkTrue('Production location id refusal happens BEFORE the credential file would be read (no ENOENT leaks through)', !/ENOENT/i.test(r.stderr));
  check('Production location id run exits with code 2', r.status, 2);
}
{
  const bogusCred = path.join(TMP, 'nope.env');
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'some-random-typo-location', '--credential-file', bogusCred], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('an arbitrary wrong location is ALSO refused with "Test location only"', /Test location only/.test(r.stderr));
}

/* ==================================================================== */
/* 4. Self-verification runs before any network access                   */
/* ==================================================================== */

checkTrue(
  'verifyAgainstAuthoritativeSource() is called before the first fetch() in main()',
  (() => {
    const mainStart = src.indexOf('async function main()');
    const verifyCallIdx = src.indexOf('verifyAgainstAuthoritativeSource();', mainStart);
    const firstFetchIdx = src.indexOf('await fetch(', mainStart);
    return mainStart >= 0 && verifyCallIdx > mainStart && firstFetchIdx > verifyCallIdx;
  })(),
);
{
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue("running with zero args: self-verification message appears on stdout", /Verified: this script's 6 FIELD_SPECS keys each match their authoritative source array exactly/.test(r.stdout));
  checkTrue('running with zero args: dies on missing --location with a specific message', /ERROR: --location is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with zero args: exits with code 2 (die()), never attempts a network call', r.status, 2);
}
{
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV'], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('running with --location only: dies on missing --credential-file with a specific, DISTINCT message', /ERROR: --credential-file is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with --location only: exits with code 2', r.status, 2);
}
{
  // A deliberately-broken FIELD_SPECS (mismatched key) would be caught by
  // verifyAgainstAuthoritativeSource -- proven directly, not just via the
  // real (correct) FIELD_SPECS passing.
  const badExtract = S.extractStringArray(path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts'), 'CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS');
  checkTrue('extractStringArray reads a real, non-empty array from the authoritative source', Array.isArray(badExtract) && badExtract.length > 0);
  checkTrue('extractStringArray dies (process.exit via die()) on a nonexistent array name', (() => {
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCRIPT)}).extractStringArray(${JSON.stringify(path.join(APP, 'src', 'lib', 'contract-ghl-projection-model.ts'))}, 'DOES_NOT_EXIST')`], { cwd: APP, encoding: 'utf8', timeout: 15000 });
    return /could not find "DOES_NOT_EXIST"/.test(r.stderr) && r.status === 2;
  })());
}

/* ==================================================================== */
/* 5. classifyExistingMatch -- exact_existing vs. every conflict shape    */
/* ==================================================================== */

check('no existing match -> {kind:"none"}, safe to create', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, []), { kind: 'none' });
check('a full, correct match -> {kind:"exact_existing", field}', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [realField()]), { kind: 'exact_existing', field: realField() });
{
  const nameOnly = realField({ fieldKey: 'opportunity.some_other_key' });
  checkTrue('name matches but fieldKey differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [nameOnly]).kind === 'conflict');
}
{
  const keyOnly = realField({ name: 'Some Other Display Name' });
  checkTrue('fieldKey matches but name differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [keyOnly]).kind === 'conflict');
}
checkTrue('full name+fieldKey match but dataType differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [realField({ dataType: 'NUMERICAL' })]).kind === 'conflict');
checkTrue('full name+fieldKey match but model differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [realField({ model: 'contact' })]).kind === 'conflict');
checkTrue('full name+fieldKey match but parentId differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [realField({ parentId: 'some-other-folder' })]).kind === 'conflict');
{
  const dup1 = realField({ id: 'dup-a' });
  const dup2 = realField({ id: 'dup-b', fieldKey: 'opportunity.some_other_key' });
  checkTrue("two distinct existing records both match this spec's identity -> conflict (ambiguous)", S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [dup1, dup2]).kind === 'conflict');
}

/* ==================================================================== */
/* 6. validateFieldAgainstSpec -- gates both readback and exact_existing */
/* ==================================================================== */

check('a fully correct field validates ok', S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField()), { ok: true });
checkTrue('a name mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ name: 'Wrong Name' })).ok);
checkTrue('a fieldKey mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ fieldKey: 'opportunity.wrong' })).ok);
checkTrue('a dataType mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ dataType: 'NUMERICAL' })).ok);
checkTrue('a model mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ model: 'contact' })).ok);
checkTrue('a parentId mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ parentId: 'wrong-folder' })).ok);
checkTrue('a missing id fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ id: undefined })).ok);
checkTrue('a null field object fails validation with a clear reason, never throws', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, null).ok);

/* ==================================================================== */
/* 7. parsePostResponse -- malformed / missing-id responses never treated*/
/*    as a confirmed create                                              */
/* ==================================================================== */

check('a well-formed { customField: {...} } response parses ok', S.parsePostResponse(JSON.stringify({ customField: { id: 'abc', name: 'x' } })), { ok: true, field: { id: 'abc', name: 'x' } });
checkTrue('malformed (non-JSON) response body is NOT treated as success', !S.parsePostResponse('not json at all {{{').ok);
checkTrue('valid JSON with no id anywhere is NOT treated as success', !S.parsePostResponse(JSON.stringify({ customField: { name: 'x' } })).ok);
checkTrue('valid JSON that is just an empty object is NOT treated as success', !S.parsePostResponse('{}').ok);

/* ==================================================================== */
/* 8. planBatch -- preflights ALL 6 specs before any POST; one conflict  */
/*    refuses the WHOLE batch; a future re-run after apply reuses all 6 */
/*    rather than creating duplicates                                    */
/* ==================================================================== */

{
  const result = S.planBatch(S.FIELD_SPECS, [], PARENT_ID);
  checkTrue('an all-clear preflight (no existing matches) is ok:true', result.ok === true);
  check('an all-clear preflight tags every one of the 6 specs "create"', result.plan.map((p) => p.action), new Array(6).fill('create'));
}
{
  const lastSpec = S.FIELD_SPECS[5];
  const conflicting = realField({ name: lastSpec.name, fieldKey: 'opportunity.totally_wrong_key' });
  const result = S.planBatch(S.FIELD_SPECS, [conflicting], PARENT_ID);
  checkTrue('ALL 6 specs are preflighted -- a conflict on spec #6 alone still surfaces', result.ok === false);
  check('exactly one conflict is reported, for the correct (last) key', result.conflicts.map((c) => c.key), [lastSpec.key]);
  check('every one of the 6 specs is still classified in the plan (full preflight, not stopped early)', result.plan.length, 6);
  checkTrue('field #1 is present in the plan even though the conflict is on field #6', result.plan[0].spec.key === S.FIELD_SPECS[0].key);
}
{
  const existing = [realField({ name: S.FIELD_SPECS[0].name, fieldKey: S.expectedFieldKey(S.FIELD_SPECS[0].name) })];
  const result = S.planBatch(S.FIELD_SPECS, existing, PARENT_ID);
  checkTrue('one exact-existing match among otherwise-clean specs is STILL ok:true', result.ok === true);
  check('the exact-existing spec is tagged "reuse"', result.plan[0].action, 'reuse');
}
{
  // Simulates the state immediately after a future successful --apply: all
  // six fields now exist exactly as specified. Re-running the SAME
  // planBatch must classify every one "reuse", never "create" -- proving a
  // re-run can never produce a duplicate field.
  const allSix = S.FIELD_SPECS.map((spec, i) => realField({ id: `existing-id-${i + 1}`, name: spec.name, fieldKey: S.expectedFieldKey(spec.name) }));
  const result = S.planBatch(S.FIELD_SPECS, allSix, PARENT_ID);
  checkTrue('after a future successful apply, re-running planBatch is ok:true', result.ok === true);
  check('every one of the 6 specs classifies "reuse", never "create" -- no duplicate creation is possible', result.plan.map((p) => p.action), new Array(6).fill('reuse'));
}

/* ==================================================================== */
/* 9. NO --only bypass -- always the complete, unfiltered 6-spec batch   */
/* ==================================================================== */

checkTrue('parseArgs contains no --only parsing at all', !/'--only'/.test(src));
checkTrue('the usage comment documents no [--only <key>] flag', !/\[--only <key>\]/.test(src));
checkTrue('there is no `specsToRun` filtering variable anywhere in this script', !/specsToRun/.test(src));
checkTrue('planBatch is called with the literal, complete FIELD_SPECS array, never a filtered subset', src.indexOf('const batch = planBatch(FIELD_SPECS, existingFields, parentId);') > 0);

/* ==================================================================== */
/* 10. Canonical parent-folder anchor -- fail closed, no arbitrary       */
/*     fallback                                                          */
/* ==================================================================== */

check('CANONICAL_PARENT_ANCHOR_FIELD_KEY is exported and is exactly the ARV anchor key', S.CANONICAL_PARENT_ANCHOR_FIELD_KEY, 'opportunity.arv_after_repair_value');
checkTrue('no arbitrary "first folder found" fallback exists anywhere in this script', !/filter\(Boolean\)\[0\]/.test(src) && !/existingFields\.map\(\(f\) => f\.parentId\)/.test(src));
checkTrue('main() calls resolveCanonicalParentId and dies on failure before using any parentId', /const resolvedParent = resolveCanonicalParentId\(existingFields\);\s*if \(!resolvedParent\.ok\) die\(resolvedParent\.reason\);/.test(src));
{
  const anchor = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: PARENT_ID, name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  check('exactly one valid anchor resolves to its own parentId', S.resolveCanonicalParentId([anchor]), { ok: true, parentId: PARENT_ID });
}
checkTrue('a location with NO anchor field fails closed', S.resolveCanonicalParentId([]).ok === false);
{
  const dup1 = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: PARENT_ID, name: 'ARV', dataType: 'NUMERICAL', model: 'opportunity' };
  const dup2 = { id: 'anchor-2', fieldKey: 'opportunity.arv_after_repair_value', parentId: 'other', name: 'ARV dup', dataType: 'NUMERICAL', model: 'opportunity' };
  checkTrue('TWO anchor fields (duplicated) fails closed', S.resolveCanonicalParentId([dup1, dup2]).ok === false);
}
checkTrue('an anchor with a MISSING parentId fails closed', S.resolveCanonicalParentId([{ id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: undefined, name: 'ARV', dataType: 'NUMERICAL', model: 'opportunity' }]).ok === false);
checkTrue('an anchor with a BLANK parentId fails closed', S.resolveCanonicalParentId([{ id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: '   ', name: 'ARV', dataType: 'NUMERICAL', model: 'opportunity' }]).ok === false);
checkTrue('the dry run explicitly logs the resolved canonical parentId', /console\.log\(`Resolved canonical parentId \(from the single required "\$\{CANONICAL_PARENT_ANCHOR_FIELD_KEY\}" anchor\):`, parentId\);/.test(src));

/* ==================================================================== */
/* 11. No PUT/PATCH/DELETE; no template/draft/send/Linear endpoint       */
/* ==================================================================== */

const methodMatches = Array.from(src.matchAll(/method:\s*'([A-Z]+)'/g)).map((m) => m[1]);
check('only GET and POST methods appear in this script, nothing else', [...new Set(methodMatches)].sort(), ['GET', 'POST']);
checkTrue('no PUT method anywhere in this script', !/method:\s*'PUT'/.test(src));
checkTrue('no PATCH method anywhere in this script', !/method:\s*'PATCH'/.test(src));
checkTrue('no DELETE method anywhere in this script', !/method:\s*'DELETE'/.test(src));
checkTrue('no template-related API endpoint is called anywhere in this script', Array.from(src.matchAll(/fetch\(`[^`]*`/g)).every((m) => !/template/i.test(m[0])));
checkTrue('no draft-creation endpoint appears in this script', !/\/drafts?\b/i.test(src));
checkTrue('no send/email/sms endpoint appears in this script', !/\/(send|email|sms)\b/i.test(src));
checkTrue('no Linear API reference appears in this script', !/linear\.app|api\.linear/i.test(src));
checkTrue('this script only ever calls the customFields endpoint', Array.from(src.matchAll(/fetch\(`\$\{BASE\}([^`]*)`/g)).every((m) => m[1].includes('/customFields')));
checkTrue('this script reads the API key only from a --credential-file env var, never a literal', /GHL_PRIVATE_API_KEY/.test(src) && /parseEnv\(fs\.readFileSync\(args\.credentialFile/.test(src));
checkTrue('no base64/JWT-shaped credential blob (40+ contiguous base64 characters) is embedded in this script', !/[A-Za-z0-9+/]{40,}={0,2}/.test(src));

/* ==================================================================== */
/* 12. Every exit path prints the proposed mapping + results before exit */
/* ==================================================================== */

checkTrue("printSummaryAndExit always prints the full proposed-mapping table before exiting", /function printSummaryAndExit\(code, closingMessage\) \{\s*console\.log\('\\n--- Proposed mapping/.test(src));
checkTrue('printSummaryAndExit is used for the natural successful/dry-run end', /printSummaryAndExit\(0, 'DRY RUN/.test(src) && /printSummaryAndExit\(0, 'Next step/.test(src));
{
  const parsedPostIdx = src.indexOf('const parsedPost = parsePostResponse(postText);');
  const resultsRecordIdx = src.indexOf('results[spec.key] = created.id;');
  checkTrue('results is recorded from the PARSED (confirmed) response, after the unconfirmed-response gate', parsedPostIdx > 0 && resultsRecordIdx > parsedPostIdx);
}
checkTrue('an unconfirmed parsePostResponse result stops immediately (printSummaryAndExit(7, ...))', /if \(!parsedPost\.ok\) \{[\s\S]{0,600}?printSummaryAndExit\(7,/.test(src));
checkTrue('a readback mismatch stops immediately (printSummaryAndExit(8, ...))', /READBACK-MISMATCH[\s\S]{0,300}?printSummaryAndExit\(8,/.test(src));

/* ==================================================================== */
/* 13. This script does NOT modify any prior batch/Seller Count script,  */
/*     and this task never applied it                                    */
/* ==================================================================== */

checkTrue('Batch 4 script still exists, untouched by this new sibling script', fs.existsSync(BATCH4_SCRIPT));
const batch4Src = fs.readFileSync(BATCH4_SCRIPT, 'utf8');
checkTrue('Batch 4 script still declares exactly its own original 4 FIELD_SPECS, not 6', (batch4Src.match(/key: '(additional_earnest_money_amount_text|additional_earnest_money_days_text|closing_date_month_day_text|closing_date_year_suffix_text)'/g) || []).length === 4);
checkTrue('Batch 4 script contains none of this batch\'s 6 new keys', !/legalMunicipality|sales_price_amount_text|financing_sum_amount_text|as_is_repairs_text|district_notices_mark|other_addenda_mark/.test(batch4Src));
checkTrue('the Seller Count script still exists, untouched by this batch', fs.existsSync(SELLER_COUNT_SCRIPT));
const sellerCountSrc = fs.readFileSync(SELLER_COUNT_SCRIPT, 'utf8');
checkTrue("the Seller Count script still targets contractSellerCount, not this batch's keys", /contractSellerCount/.test(sellerCountSrc) && !/legalMunicipality/.test(sellerCountSrc));
checkTrue('the Seller Count script still declares exactly 1 FIELD_SPEC, not 6', (sellerCountSrc.match(/key:\s*'contractSellerCount'/g) || []).length === 1);

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
