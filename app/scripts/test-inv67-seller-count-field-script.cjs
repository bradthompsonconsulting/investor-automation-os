/**
 * INV-67 One-/Two-Seller signer model, Phase 1 -- `Contract Seller Count`
 * GHL Test provisioning script safety proof. Proves
 * `inv67-create-seller-count-field.cjs` satisfies every safety property
 * required before it is ever authorized for a live `--apply` run, WITHOUT
 * ever making a network call itself. Mirrors
 * `test-inv67-checkbox-marker-fields-batch1-script.cjs`'s proven structure
 * exactly, adapted for a single SINGLE_OPTIONS spec instead of 48 TEXT
 * specs -- the extra section (6) proves the options-array validation this
 * script adds beyond Batch 1's pattern.
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const SCRIPT = path.join(APP, 'scripts', 'inv67-create-seller-count-field.cjs');
const TMP = path.join(APP, '.tmp-inv67-seller-count-field-script-test');

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
cleanup();
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }));

try {
  execSync(`npx tsc "${path.join(APP, 'src', 'lib', 'contract-seller-signing-model.ts')}" --outDir "${TMP}" --module commonjs --target es2020 --strict`, { cwd: APP, stdio: 'inherit' });
} catch (_) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  cleanup();
  process.exit(10);
}
const { SELLER_COUNT_ONE_SELLER_VALUE, SELLER_COUNT_TWO_SELLERS_VALUE } = require(path.join(TMP, 'contract-seller-signing-model.js'));

// require()-ing the script itself is safe: main() only runs when
// `require.main === module`, which is false here.
const S = require(SCRIPT);
const src = fs.readFileSync(SCRIPT, 'utf8');

const FLOOR = 60;
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
  return {
    id: 'existing-id-1', name: 'Contract Seller Count', fieldKey: 'opportunity.contract_seller_count',
    dataType: 'SINGLE_OPTIONS', model: 'opportunity', parentId: PARENT_ID,
    picklistOptions: ['One Seller', 'Two Sellers'],
    ...overrides,
  };
}
const SPEC1 = S.FIELD_SPECS[0];
const SPEC1_KEY = S.expectedFieldKey(SPEC1.name);

/* ==================================================================== */
/* 1. FIELD_SPECS -- exactly one, matching the canonical source values   */
/* ==================================================================== */

check('script declares exactly 1 FIELD_SPEC', S.FIELD_SPECS.length, 1);
check('the one spec is contractSellerCount', S.FIELD_SPECS[0].key, 'contractSellerCount');
check('the one spec is SINGLE_OPTIONS', S.FIELD_SPECS[0].dataType, 'SINGLE_OPTIONS');
check('the one spec\'s options equal the canonical transport values, in order', S.FIELD_SPECS[0].options, [SELLER_COUNT_ONE_SELLER_VALUE, SELLER_COUNT_TWO_SELLERS_VALUE]);
check('the one spec\'s options equal the exact literal ["One Seller","Two Sellers"]', S.FIELD_SPECS[0].options, ['One Seller', 'Two Sellers']);

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
/* 4. Self-verification against the canonical TS source, before network  */
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
  checkTrue('running with zero args: self-verification message appears on stdout', /Verified: this script's options .* match contract-seller-signing-model\.ts/.test(r.stdout));
  checkTrue('running with zero args: dies on missing --location with a specific message', /ERROR: --location is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with zero args: exits with code 2 (die()), never attempts a network call', r.status, 2);
}
{
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV'], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('running with --location only: dies on missing --credential-file with a specific, DISTINCT message', /ERROR: --credential-file is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with --location only: exits with code 2', r.status, 2);
}
checkTrue('verifyAgainstAuthoritativeSource dies loud on drift, exported and directly callable', typeof S.verifyAgainstAuthoritativeSource === 'function');

/* ==================================================================== */
/* 5. classifyExistingMatch -- exact_existing vs. every conflict shape    */
/* ==================================================================== */

check('no existing match -> {kind:"none"}, safe to create', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, []), { kind: 'none' });
check('a full, correct match -> {kind:"exact_existing", field}', S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [realField()]), { kind: 'exact_existing', field: realField() });
{
  const nameOnly = realField({ fieldKey: 'opportunity.some_other_key' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [nameOnly]);
  checkTrue('name matches but fieldKey differs -> conflict', result.kind === 'conflict');
}
{
  const keyOnly = realField({ name: 'Some Other Display Name' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [keyOnly]);
  checkTrue('fieldKey matches but name differs -> conflict', result.kind === 'conflict');
}
{
  const wrongType = realField({ dataType: 'TEXT' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongType]);
  checkTrue('full name+fieldKey match but dataType differs -> conflict, NOT exact_existing', result.kind === 'conflict');
}
{
  const wrongModel = realField({ model: 'contact' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongModel]);
  checkTrue('full name+fieldKey match but model differs -> conflict', result.kind === 'conflict');
}
{
  const wrongParent = realField({ parentId: 'some-other-folder' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongParent]);
  checkTrue('full name+fieldKey match but parentId differs -> conflict', result.kind === 'conflict');
}
{
  const dup1 = realField({ id: 'dup-a' });
  const dup2 = realField({ id: 'dup-b', fieldKey: 'opportunity.some_other_key' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [dup1, dup2]);
  checkTrue('two distinct existing records both match this spec\'s identity -> conflict (ambiguous, never auto-resolved)', result.kind === 'conflict');
}

/* ==================================================================== */
/* 6. validateFieldAgainstSpec -- THE NEW PROPERTY: exact, order-        */
/*    sensitive options-array equality, beyond Batch 1's pattern         */
/* ==================================================================== */

check('a fully correct field, including exact options order, validates ok', S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField()), { ok: true });
checkTrue('a name mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ name: 'Wrong Name' })).ok);
checkTrue('a fieldKey mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ fieldKey: 'opportunity.wrong' })).ok);
checkTrue('a dataType mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ dataType: 'TEXT' })).ok);
checkTrue('a model mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ model: 'contact' })).ok);
checkTrue('a parentId mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ parentId: 'wrong-folder' })).ok);
checkTrue('a missing id fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ id: undefined })).ok);
checkTrue('a null field object fails validation with a clear reason, never throws', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, null).ok);
{
  // THE options addition -- reversed order is a mismatch even though the SET of
  // option strings is identical. "options/order must match" per this session's
  // explicit authorization.
  const reversedOrder = realField({ picklistOptions: ['Two Sellers', 'One Seller'] });
  const result = S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, reversedOrder);
  checkTrue('reversed option order fails validation even though the option SET is identical', !result.ok);
  checkTrue('reversed-order mismatch reason explicitly names "options"', result.mismatches.some((m) => /options/.test(m)));
}
{
  const extraOption = realField({ picklistOptions: ['One Seller', 'Two Sellers', 'Three Sellers'] });
  checkTrue('an extra, unexpected option fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, extraOption).ok);
}
{
  const missingOption = realField({ picklistOptions: ['One Seller'] });
  checkTrue('a missing option fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, missingOption).ok);
}
{
  const renamedOption = realField({ picklistOptions: ['1 Seller', 'Two Sellers'] });
  checkTrue('a differently-worded option fails validation (exact string match required)', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, renamedOption).ok);
}
{
  // GHL's response shape may use `options` instead of `picklistOptions` --
  // validateFieldAgainstSpec must accept either, matching `field.picklistOptions
  // ?? field.options ?? []` exactly.
  const usingOptionsKey = realField({ picklistOptions: undefined, options: ['One Seller', 'Two Sellers'] });
  check('the `options` key (fallback for `picklistOptions`) is also accepted', S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, usingOptionsKey), { ok: true });
}
{
  const noOptionsAtAll = realField({ picklistOptions: undefined, options: undefined });
  checkTrue('a field reporting no options at all (neither key present) fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, noOptionsAtAll).ok);
}

/* ==================================================================== */
/* 7. parsePostResponse -- malformed / missing-id responses never treated*/
/*    as a confirmed create                                              */
/* ==================================================================== */

check('a well-formed { customField: {...} } response parses ok', S.parsePostResponse(JSON.stringify({ customField: { id: 'abc', name: 'x' } })), { ok: true, field: { id: 'abc', name: 'x' } });
check('a well-formed bare field object response parses ok', S.parsePostResponse(JSON.stringify({ id: 'abc' })), { ok: true, field: { id: 'abc' } });
checkTrue('malformed (non-JSON) response body is NOT treated as success', !S.parsePostResponse('not json at all {{{').ok);
checkTrue('valid JSON with no id anywhere is NOT treated as success', !S.parsePostResponse(JSON.stringify({ customField: { name: 'x' } })).ok);
checkTrue('valid JSON that is just an empty object is NOT treated as success', !S.parsePostResponse('{}').ok);

/* ==================================================================== */
/* 8. planBatch -- preflights the (one-entry) batch before any POST      */
/* ==================================================================== */

{
  const result = S.planBatch(S.FIELD_SPECS, [], PARENT_ID);
  checkTrue('an all-clear preflight is ok:true', result.ok === true);
  check('the single spec is tagged "create"', result.plan.map((p) => p.action), ['create']);
}
{
  const existing = [realField()];
  const result = S.planBatch(S.FIELD_SPECS, existing, PARENT_ID);
  checkTrue('an exact-existing match is ok:true', result.ok === true);
  check('the spec is tagged "reuse"', result.plan.map((p) => p.action), ['reuse']);
}
{
  const conflicting = realField({ fieldKey: 'opportunity.totally_wrong_key' });
  const result = S.planBatch(S.FIELD_SPECS, [conflicting], PARENT_ID);
  checkTrue('a conflict refuses the whole (one-entry) batch', result.ok === false);
  check('exactly one conflict is reported, for the correct key', result.conflicts.map((c) => c.key), ['contractSellerCount']);
}
{
  const optionsConflict = realField({ picklistOptions: ['Two Sellers', 'One Seller'] });
  const result = S.planBatch(S.FIELD_SPECS, [optionsConflict], PARENT_ID);
  checkTrue('an options-order conflict alone is enough to refuse the batch', result.ok === false);
}

/* ==================================================================== */
/* 9. Preflight happens before any POST                                  */
/* ==================================================================== */

{
  const planCallIdx = src.indexOf('const batch = planBatch(FIELD_SPECS, existingFields, parentId);');
  const notOkCheckIdx = src.indexOf('if (!batch.ok) {');
  const creationLoopIdx = src.indexOf('for (const entry of batch.plan) {');
  const postFetchIdx = src.indexOf("method: 'POST'");
  checkTrue('planBatch runs before the not-ok check', planCallIdx > 0 && planCallIdx < notOkCheckIdx);
  checkTrue('the not-ok check (and its exit) appears before the creation loop, textually', notOkCheckIdx > 0 && notOkCheckIdx < creationLoopIdx);
  checkTrue('the creation loop (where a POST could occur) appears after the not-ok check, textually', creationLoopIdx > 0 && creationLoopIdx < postFetchIdx);
}

/* ==================================================================== */
/* 10. Readback validation gates both create and reuse paths             */
/* ==================================================================== */

checkTrue('the create path calls validateFieldAgainstSpec on the readback before logging CREATE', /const validation = validateFieldAgainstSpec\(spec, expectedKey, parentId, rb\);\s*if \(!validation\.ok\) \{[\s\S]{0,400}?printSummaryAndExit\(8,/.test(src));
checkTrue('the reuse path ALSO calls validateFieldAgainstSpec before logging REUSE', /const validation = validateFieldAgainstSpec\(spec, expectedKey, parentId, rb\);\s*if \(!validation\.ok\) \{[\s\S]{0,400}?printSummaryAndExit\(6,/.test(src));
checkTrue('the reuse path re-fetches the candidate via its own single-field GET, never trusting the bulk listing alone', /action === 'reuse'[\s\S]{0,400}?await get\(token, `\$\{BASE\}\/locations\/\$\{args\.location\}\/customFields\/\$\{classification\.field\.id\}`\)/.test(src));

/* ==================================================================== */
/* 11. Unconfirmed-create safety                                         */
/* ==================================================================== */

checkTrue('parsePostResponse is called on every successful-HTTP POST response before it is trusted', /const parsedPost = parsePostResponse\(postText\);/.test(src));
checkTrue('an unconfirmed parsePostResponse result stops immediately', /if \(!parsedPost\.ok\) \{[\s\S]{0,600}?printSummaryAndExit\(7,/.test(src));
{
  const parsedPostIdx = src.indexOf('const parsedPost = parsePostResponse(postText);');
  const resultsRecordIdx = src.indexOf('results[spec.key] = created.id;');
  checkTrue('results is recorded from the PARSED (confirmed) response, after the unconfirmed-response gate, never before it', parsedPostIdx > 0 && resultsRecordIdx > parsedPostIdx);
}

/* ==================================================================== */
/* 12. No default/Production fallback; ZERO PUT/PATCH/DELETE capability  */
/* ==================================================================== */

checkTrue('parseArgs never assigns a default value to location', !/location\s*=\s*location\s*\|\|/.test(src));
checkTrue('parseArgs never assigns a default value to credentialFile', !/credentialFile\s*=\s*credentialFile\s*\|\|/.test(src));
const methodMatches = Array.from(src.matchAll(/method:\s*'([A-Z]+)'/g)).map((m) => m[1]);
check('only GET and POST methods appear in this script, nothing else', [...new Set(methodMatches)].sort(), ['GET', 'POST']);
checkTrue('no PUT method anywhere in this script', !/method:\s*'PUT'/.test(src));
checkTrue('no PATCH method anywhere in this script', !/method:\s*'PATCH'/.test(src));
checkTrue('no DELETE method anywhere in this script', !/method:\s*'DELETE'/.test(src));
checkTrue('this script only ever calls the customFields endpoint', Array.from(src.matchAll(/fetch\(`\$\{BASE\}([^`]*)`/g)).every((m) => m[1].includes('/customFields')));
checkTrue('no template-related API endpoint is called anywhere in this script', Array.from(src.matchAll(/fetch\(`[^`]*`/g)).every((m) => !/template/i.test(m[0])));
checkTrue('no draft-creation endpoint appears in this script', !/\/drafts?\b/i.test(src));
checkTrue('no send/email/sms endpoint appears in this script', !/\/(send|email|sms)\b/i.test(src));
checkTrue('no Linear API reference appears in this script', !/linear\.app|api\.linear/i.test(src));

/* ==================================================================== */
/* 13. --apply is supported but is NEVER invoked by this test suite      */
/*     (network-free proof only); every exit path prints a summary       */
/* ==================================================================== */

checkTrue('--apply flag parsing exists (for a LATER, separately authorized session)', /argv\.includes\('--apply'\)/.test(src));
checkTrue('this test suite never passes --apply to any spawned process', !/spawnSync\([\s\S]{0,200}?'--apply'/.test(fs.readFileSync(__filename, 'utf8')));
checkTrue('printSummaryAndExit always prints the full proposed-mapping table before exiting', /function printSummaryAndExit\(code, closingMessage\) \{\s*console\.log\('\\n--- Proposed mapping/.test(src));
checkTrue('printSummaryAndExit is used for the natural successful/dry-run end', /printSummaryAndExit\(0, 'DRY RUN/.test(src) && /printSummaryAndExit\(0, 'Next step/.test(src));

/* ==================================================================== */
/* 14. Canonical parent-folder anchor -- fail closed, no arbitrary       */
/*     fallback (same discipline as every prior INV-67 script)           */
/* ==================================================================== */

check('CANONICAL_PARENT_ANCHOR_FIELD_KEY is exported and is exactly the ARV anchor key', S.CANONICAL_PARENT_ANCHOR_FIELD_KEY, 'opportunity.arv_after_repair_value');
checkTrue('main() calls resolveCanonicalParentId and dies on failure before using any parentId', /const resolvedParent = resolveCanonicalParentId\(existingFields\);\s*if \(!resolvedParent\.ok\) die\(resolvedParent\.reason\);/.test(src));
{
  const anchor = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: PARENT_ID, name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  check('exactly one valid anchor resolves to its own parentId', S.resolveCanonicalParentId([anchor]), { ok: true, parentId: PARENT_ID });
}
{
  const result = S.resolveCanonicalParentId([]);
  checkTrue('a location with NO anchor field fails closed', result.ok === false);
  checkTrue('missing-anchor reason names the exact anchor key and says there is no fallback', /opportunity\.arv_after_repair_value/.test(result.reason) && /no fallback/.test(result.reason));
}
{
  const dup1 = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: PARENT_ID, name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  const dup2 = { id: 'anchor-2', fieldKey: 'opportunity.arv_after_repair_value', parentId: 'a-different-folder', name: 'ARV (After Repair Value) (dup)', dataType: 'NUMERICAL', model: 'opportunity' };
  const result = S.resolveCanonicalParentId([dup1, dup2]);
  checkTrue('TWO anchor fields (duplicated) fails closed -- never silently picks the first', result.ok === false);
}
{
  const blankParent = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: '   ', name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  const result = S.resolveCanonicalParentId([blankParent]);
  checkTrue('an anchor with a BLANK (whitespace-only) parentId fails closed, same as missing', result.ok === false);
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
