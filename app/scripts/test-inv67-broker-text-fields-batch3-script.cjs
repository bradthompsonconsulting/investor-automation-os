/**
 * INV-67 checkbox-marker / broker-model repair -- Batch 3 GHL Test
 * provisioning script safety proof. Proves
 * `inv67-create-broker-text-fields-batch3.cjs` satisfies every safety
 * property required before it is authorized for a live `--apply` run,
 * WITHOUT ever making a network call itself -- the same properties Batch
 * 1/2's scripts and suites established, applied to this batch's own 22
 * `BROKER_TEXT_KEYS` specs:
 *
 *   1. Exactly 22 FIELD_SPECS, exactly equal (same 22, same order) to the
 *      authoritative `BROKER_TEXT_KEYS` (derived from the same 11
 *      `BROKER_FIELD_SUFFIXES` on both sides).
 *   2. `require()`-ing this script never auto-runs `main()`.
 *   3. Hard Test-location allowlist, proven statically and via real,
 *      network-free child-process spawns.
 *   4. Self-verification runs before any network access.
 *   5. `classifyExistingMatch` -- exact_existing vs. every conflict shape.
 *   6. `validateFieldAgainstSpec` -- gates both readback and exact_existing
 *      re-verification.
 *   7. `parsePostResponse` -- malformed/missing-id responses never treated
 *      as a confirmed create.
 *   8. `planBatch` -- preflights ALL 22 specs before any POST; one
 *      conflict refuses the WHOLE batch.
 *   9. There is no `--only` flag -- the complete, unfiltered batch is
 *      always preflighted together.
 *   10. `resolveCanonicalParentId` fails closed on all three failure
 *       shapes; no arbitrary "first folder" fallback exists.
 *   11. No PUT/PATCH/DELETE; no template/draft/send/Linear/non-
 *       customFields endpoint.
 *   12. Every exit path prints the proposed mapping + results before
 *       exiting.
 *   13. This script does NOT modify Batch 1's or Batch 2's script files.
 *   14. PAGE-11 MODEL BOUNDARIES: no city/state/ZIP field, no
 *       intermediary field, no paragraph-8 field, Team Name and
 *       Licensed Supervisor Phone are both present on both sides, a
 *       missing broker side leaves all 11 of that side's fields blank
 *       by construction (proven at the derivation-model level in
 *       test-contract-checkbox-marker-model.cjs; re-confirmed here that
 *       no extra/invented field exists in this script's own spec list).
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const SCRIPT = path.join(APP, 'scripts', 'inv67-create-broker-text-fields-batch3.cjs');
const BATCH1_SCRIPT = path.join(APP, 'scripts', 'inv67-create-checkbox-marker-fields-batch1.cjs');
const BATCH2_SCRIPT = path.join(APP, 'scripts', 'inv67-create-checkbox-text-fields-batch2.cjs');
const TMP = path.join(APP, '.tmp-inv67-batch3-script-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(`npx tsc "${path.join(APP, 'src', 'lib', 'contract-checkbox-marker-model.ts')}" --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}
const { BROKER_TEXT_KEYS, BROKER_FIELD_SUFFIXES } = require(path.join(TMP, 'contract-checkbox-marker-model.js'));

// require()-ing the script itself is safe: main() only runs when
// `require.main === module`, which is false here.
const S = require(SCRIPT);
const src = fs.readFileSync(SCRIPT, 'utf8');

const FLOOR = 85;
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
  return { id: 'existing-id-1', name: 'Contract Seller Broker Firm Name', fieldKey: 'opportunity.contract_seller_broker_firm_name', dataType: 'TEXT', model: 'opportunity', parentId: PARENT_ID, ...overrides };
}
const SPEC1 = S.FIELD_SPECS[0]; // seller_broker_firm_name_text
const SPEC1_KEY = S.expectedFieldKey(SPEC1.name);

/* ==================================================================== */
/* 1. FIELD_SPECS -- exactly 22, exactly equal to BROKER_TEXT_KEYS       */
/* ==================================================================== */

const fieldSpecKeys = Array.from(src.matchAll(/\{ key: '([^']+)', name: '[^']+' \}/g)).map((m) => m[1]);
check('script declares exactly 22 FIELD_SPECS', fieldSpecKeys.length, 22);
check('FIELD_SPECS keys are unique', new Set(fieldSpecKeys).size, 22);
check('FIELD_SPECS keys equal BROKER_TEXT_KEYS exactly, SAME ORDER (source-level extraction)', fieldSpecKeys, [...BROKER_TEXT_KEYS]);
check('module.exports.FIELD_SPECS also has exactly 22 keys, same order', S.FIELD_SPECS.map((s) => s.key), [...BROKER_TEXT_KEYS]);
check('the first 11 keys are the seller_broker_ side, in BROKER_FIELD_SUFFIXES order', fieldSpecKeys.slice(0, 11), BROKER_FIELD_SUFFIXES.map((s) => `seller_broker_${s}_text`));
check('the last 11 keys are the buyer_broker_ side, in BROKER_FIELD_SUFFIXES order', fieldSpecKeys.slice(11), BROKER_FIELD_SUFFIXES.map((s) => `buyer_broker_${s}_text`));

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
  checkTrue('running with zero args: self-verification message appears on stdout', /Verified: this script's 22 FIELD_SPECS keys match BROKER_TEXT_KEYS exactly/.test(r.stdout));
  checkTrue('running with zero args: dies on missing --location with a specific message', /ERROR: --location is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with zero args: exits with code 2 (die()), never attempts a network call', r.status, 2);
}
{
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV'], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('running with --location only: dies on missing --credential-file with a specific, DISTINCT message', /ERROR: --credential-file is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with --location only: exits with code 2', r.status, 2);
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
{
  const wrongType = realField({ dataType: 'NUMERICAL' });
  checkTrue('full name+fieldKey match but dataType differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongType]).kind === 'conflict');
}
{
  const wrongModel = realField({ model: 'contact' });
  checkTrue('full name+fieldKey match but model differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongModel]).kind === 'conflict');
}
{
  const wrongParent = realField({ parentId: 'some-other-folder' });
  checkTrue('full name+fieldKey match but parentId differs -> conflict', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongParent]).kind === 'conflict');
}
{
  const dup1 = realField({ id: 'dup-a' });
  const dup2 = realField({ id: 'dup-b', fieldKey: 'opportunity.some_other_key' });
  checkTrue('two distinct existing records both match this spec\'s identity -> conflict (ambiguous)', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [dup1, dup2]).kind === 'conflict');
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
/* 8. planBatch -- preflights ALL 22 specs before any POST; one conflict */
/*    refuses the WHOLE batch                                            */
/* ==================================================================== */

{
  const result = S.planBatch(S.FIELD_SPECS, [], PARENT_ID);
  checkTrue('an all-clear preflight (no existing matches) is ok:true', result.ok === true);
  check('an all-clear preflight tags every one of the 22 specs "create"', result.plan.map((p) => p.action), new Array(22).fill('create'));
}
{
  const conflicting = realField({ name: S.FIELD_SPECS[21].name, fieldKey: 'opportunity.totally_wrong_key' }); // last spec
  const result = S.planBatch(S.FIELD_SPECS, [conflicting], PARENT_ID);
  checkTrue('ALL 22 specs are preflighted -- a conflict on spec #22 alone still surfaces', result.ok === false);
  check('exactly one conflict is reported, for the correct (last) key', result.conflicts.map((c) => c.key), [S.FIELD_SPECS[21].key]);
  check('every one of the 22 specs is still classified in the plan (full preflight, not stopped early)', result.plan.length, 22);
  checkTrue('field #1 is present in the plan even though the conflict is on field #22', result.plan[0].spec.key === S.FIELD_SPECS[0].key);
}
{
  const existing = [realField({ name: S.FIELD_SPECS[0].name, fieldKey: S.expectedFieldKey(S.FIELD_SPECS[0].name) })];
  const result = S.planBatch(S.FIELD_SPECS, existing, PARENT_ID);
  checkTrue('one exact-existing match among otherwise-clean specs is STILL ok:true', result.ok === true);
  check('the exact-existing spec is tagged "reuse"', result.plan[0].action, 'reuse');
}

/* ==================================================================== */
/* 9. NO --only bypass -- always the complete, unfiltered 22-spec batch  */
/* ==================================================================== */

checkTrue('parseArgs contains no --only parsing at all', !/'--only'/.test(src));
checkTrue('the usage comment documents no [--only <key>] flag', !/\[--only <key>\]/.test(src));
checkTrue('there is no `specsToRun` filtering variable anywhere in this script', !/specsToRun/.test(src));
{
  const planCallIdx = src.indexOf('const batch = planBatch(FIELD_SPECS, existingFields, parentId);');
  checkTrue('planBatch is called with the literal, complete FIELD_SPECS array, never a filtered subset', planCallIdx > 0);
}

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
{
  const noParent = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: undefined, name: 'ARV', dataType: 'NUMERICAL', model: 'opportunity' };
  checkTrue('an anchor with a MISSING parentId fails closed', S.resolveCanonicalParentId([noParent]).ok === false);
}
{
  const blankParent = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: '   ', name: 'ARV', dataType: 'NUMERICAL', model: 'opportunity' };
  checkTrue('an anchor with a BLANK parentId fails closed', S.resolveCanonicalParentId([blankParent]).ok === false);
}
checkTrue('the dry run explicitly logs the resolved canonical parentId', /console\.log\(`Resolved canonical parentId \(from the single required "\$\{CANONICAL_PARENT_ANCHOR_FIELD_KEY\}" anchor\):`, parentId\);/.test(src));

/* ==================================================================== */
/* 11. No PUT/PATCH/DELETE; no template/draft/send/Linear endpoint       */
/* ==================================================================== */

const methodMatches = Array.from(src.matchAll(/method:\s*'([A-Z]+)'/g)).map((m) => m[1]);
check('only GET and POST methods appear in this script, nothing else', [...new Set(methodMatches)].sort(), ['GET', 'POST']);
checkTrue('no PUT method anywhere in this script', !/method:\s*'PUT'/.test(src));
checkTrue('no PATCH method anywhere in this script', !/method:\s*'PATCH'/.test(src));
checkTrue('no DELETE method anywhere in this script', !/method:\s*'DELETE'/.test(src));
checkTrue(
  'no template-related API endpoint is called anywhere in this script',
  Array.from(src.matchAll(/fetch\(`[^`]*`/g)).every((m) => !/template/i.test(m[0])),
);
checkTrue('no draft-creation endpoint appears in this script', !/\/drafts?\b/i.test(src));
checkTrue('no send/email/sms endpoint appears in this script', !/\/(send|email|sms)\b/i.test(src));
checkTrue('no Linear API reference appears in this script', !/linear\.app|api\.linear/i.test(src));
checkTrue('this script only ever calls the customFields endpoint', Array.from(src.matchAll(/fetch\(`\$\{BASE\}([^`]*)`/g)).every((m) => m[1].includes('/customFields')));

/* ==================================================================== */
/* 12. Every exit path prints the proposed mapping + results before exit */
/* ==================================================================== */

checkTrue('printSummaryAndExit always prints the full proposed-mapping table before exiting', /function printSummaryAndExit\(code, closingMessage\) \{\s*console\.log\('\\n--- Proposed mapping/.test(src));
checkTrue('printSummaryAndExit is used for the natural successful/dry-run end', /printSummaryAndExit\(0, 'DRY RUN/.test(src) && /printSummaryAndExit\(0, 'Next step/.test(src));
{
  const parsedPostIdx = src.indexOf('const parsedPost = parsePostResponse(postText);');
  const resultsRecordIdx = src.indexOf('results[spec.key] = created.id;');
  checkTrue('results is recorded from the PARSED (confirmed) response, after the unconfirmed-response gate', parsedPostIdx > 0 && resultsRecordIdx > parsedPostIdx);
}
checkTrue('an unconfirmed parsePostResponse result stops immediately (printSummaryAndExit(7, ...))', /if \(!parsedPost\.ok\) \{[\s\S]{0,600}?printSummaryAndExit\(7,/.test(src));
checkTrue('a readback mismatch stops immediately (printSummaryAndExit(8, ...))', /READBACK-MISMATCH[\s\S]{0,300}?printSummaryAndExit\(8,/.test(src));

/* ==================================================================== */
/* 13. This script does NOT modify Batch 1's or Batch 2's scripts        */
/* ==================================================================== */

checkTrue('Batch 1\'s script file still exists, untouched by this batch', fs.existsSync(BATCH1_SCRIPT));
checkTrue('Batch 2\'s script file still exists, untouched by this batch', fs.existsSync(BATCH2_SCRIPT));
const batch1Src = fs.readFileSync(BATCH1_SCRIPT, 'utf8');
const batch2Src = fs.readFileSync(BATCH2_SCRIPT, 'utf8');
checkTrue('Batch 1\'s script still targets CHECKBOX_MARKER_KEYS (48 specs), not repurposed', /CHECKBOX_MARKER_KEYS/.test(batch1Src) && (batch1Src.match(/\{ key: '[^']+', name: '[^']+' \}/g) || []).length === 48);
checkTrue('Batch 2\'s script still targets CHECKBOX_TEXT_KEYS (11 specs), not repurposed', /CHECKBOX_TEXT_KEYS/.test(batch2Src) && (batch2Src.match(/\{ key: '[^']+', name: '[^']+' \}/g) || []).length === 11);

/* ==================================================================== */
/* 14. Page-11 model boundaries: no city/state/ZIP, no intermediary, no  */
/*     paragraph-8 field; Team Name and Supervisor Phone both present    */
/* ==================================================================== */

checkTrue('no city field exists anywhere in this script\'s specs', !fieldSpecKeys.some((k) => /\bcity\b/i.test(k)) && !S.FIELD_SPECS.some((s) => /\bcity\b/i.test(s.name)));
checkTrue('no state field exists anywhere in this script\'s specs', !fieldSpecKeys.some((k) => /\bstate\b/i.test(k)) && !S.FIELD_SPECS.some((s) => /\bstate\b/i.test(s.name)));
checkTrue('no zip field exists anywhere in this script\'s specs', !fieldSpecKeys.some((k) => /\bzip\b/i.test(k)) && !S.FIELD_SPECS.some((s) => /\bzip\b/i.test(s.name)));
checkTrue('exactly one address field per side (no split), matching the single TREC page-11 Address blank', fieldSpecKeys.filter((k) => /address/i.test(k)).length === 2);
checkTrue('no intermediary field exists anywhere in this script', !fieldSpecKeys.some((k) => /intermediary/i.test(k)) && !S.FIELD_SPECS.some((s) => /intermediary/i.test(s.name)));
checkTrue('no paragraph-8 / representation-conflict field exists anywhere in this script', !fieldSpecKeys.some((k) => /paragraph_?8|para8|representation/i.test(k)));
checkTrue('Team Name is present on both sides', fieldSpecKeys.includes('seller_broker_team_name_text') && fieldSpecKeys.includes('buyer_broker_team_name_text'));
checkTrue('Licensed Supervisor Phone is present on both sides', fieldSpecKeys.includes('seller_broker_supervisor_phone_text') && fieldSpecKeys.includes('buyer_broker_supervisor_phone_text'));
check('exactly 11 seller_broker_ keys and 11 buyer_broker_ keys -- a missing broker side is a UI/derivation-layer concern (all-blank text), not a field-count concern here', [fieldSpecKeys.filter((k) => k.startsWith('seller_broker_')).length, fieldSpecKeys.filter((k) => k.startsWith('buyer_broker_')).length], [11, 11]);

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
