/**
 * INV-67 checkbox-marker / broker-model repair -- Batch 1 GHL Test
 * provisioning script safety proof. Proves
 * `inv67-create-checkbox-marker-fields-batch1.cjs` satisfies every safety
 * property required before it is authorized for a live `--apply` run,
 * WITHOUT ever making a network call itself.
 *
 * Jess Gate correction (live-safety repair, this session) extends the
 * original suite with:
 *   9.  The hard Test-location allowlist -- the approved id passes the
 *       guard (proceeds to the network boundary, i.e. as far as reading
 *       the credential file); any other id (including Production's own)
 *       is refused BEFORE the credential file is ever read.
 *   10. `planBatch` preflights ALL specs before any POST, and refuses the
 *       WHOLE batch (zero creates) if even one spec conflicts.
 *   11. `classifyExistingMatch` distinguishes `exact_existing` (safe to
 *       reuse, after its own re-verification) from every shape of
 *       `conflict`: name-only match, fieldKey-only match, multiple
 *       matching records, and a full identity match whose dataType/
 *       model/parentId differ.
 *   12. `validateFieldAgainstSpec` -- the SAME function gates both a
 *       freshly created field's readback and an `exact_existing`
 *       candidate's re-verification -- catches every one of those
 *       mismatch shapes plus a missing id.
 *   13. `parsePostResponse` treats malformed JSON and JSON with no usable
 *       `id` as distinctly unconfirmed, never silently treated as success.
 *
 * Jess Gate correction (whole-batch/folder safety repair, this session)
 * extends the suite further with:
 *   14. There is no `--only` flag anywhere in this script -- an earlier
 *       version let a caller preflight one field while 47 others'
 *       conflicts went unchecked. `main()` always calls `planBatch` with
 *       the complete, unfiltered `FIELD_SPECS` -- proven both statically
 *       (no `--only` parsing exists) and by construction (a conflict on
 *       spec #1 is caught even when only spec #48 would otherwise have
 *       been "run").
 *   15. `resolveCanonicalParentId` fails closed on all three ways the
 *       canonical `opportunity.arv_after_repair_value` anchor can be
 *       unusable -- missing, duplicated, or present with no (or a blank)
 *       `parentId` -- and there is no fallback to "the first Opportunity
 *       folder found."
 *
 * The pure classification/validation/planning functions are exercised
 * directly (via `require`, `main()` never auto-runs on require -- guarded
 * by `require.main === module`) with synthetic data -- no network calls.
 * The location-allowlist and self-verification properties are ALSO
 * proven via real, network-free child-process spawns (they die before the
 * one `fetch` call that could ever reach the network).
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const SCRIPT = path.join(APP, 'scripts', 'inv67-create-checkbox-marker-fields-batch1.cjs');
const TMP = path.join(APP, '.tmp-inv67-batch1-script-test');

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
const { CHECKBOX_MARKER_KEYS } = require(path.join(TMP, 'contract-checkbox-marker-model.js'));

// require()-ing the script itself is safe: main() only runs when
// `require.main === module`, which is false here.
const S = require(SCRIPT);
const src = fs.readFileSync(SCRIPT, 'utf8');

const FLOOR = 111;
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
  return { id: 'existing-id-1', name: 'Contract Residential Leases Mark', fieldKey: 'opportunity.contract_residential_leases_mark', dataType: 'TEXT', model: 'opportunity', parentId: PARENT_ID, ...overrides };
}
const SPEC1 = S.FIELD_SPECS[0]; // lease_residential_mark
const SPEC1_KEY = S.expectedFieldKey(SPEC1.name);

/* ==================================================================== */
/* 1. FIELD_SPECS -- exactly 48, exactly equal to CHECKBOX_MARKER_KEYS   */
/* ==================================================================== */

// INV-67 Phase 2B added 2 new markers (district_notices_mark, other_addenda_mark)
// to CHECKBOX_MARKER_KEYS, unrelated to this batch's own original 48. This
// script's FIELD_SPECS is a SUBSET of the (now-larger) authoritative array,
// never required to equal it exactly -- see the Brad-authorized narrow fix to
// `verifyAgainstAuthoritativeSource` in the script itself.
const PRE_PHASE_2B_MARKER_KEYS = CHECKBOX_MARKER_KEYS.filter((k) => k !== 'district_notices_mark' && k !== 'other_addenda_mark');
const fieldSpecKeys = Array.from(src.matchAll(/\{ key: '([^']+)', name: '[^']+' \}/g)).map((m) => m[1]);
check('script declares exactly 48 FIELD_SPECS', fieldSpecKeys.length, 48);
check('FIELD_SPECS keys are unique', new Set(fieldSpecKeys).size, 48);
check('FIELD_SPECS keys equal the ORIGINAL 48 CHECKBOX_MARKER_KEYS exactly, SAME ORDER (source-level extraction; Phase 2B\'s 2 new markers excluded)', fieldSpecKeys, [...PRE_PHASE_2B_MARKER_KEYS]);
check('module.exports.FIELD_SPECS also has exactly 48 keys, same order', S.FIELD_SPECS.map((s) => s.key), [...PRE_PHASE_2B_MARKER_KEYS]);
checkTrue('every one of this script\'s 48 keys is present in the (now-larger) authoritative CHECKBOX_MARKER_KEYS', fieldSpecKeys.every((k) => CHECKBOX_MARKER_KEYS.includes(k)));

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
  // The first fetch() call REACHABLE FROM main()'s own body -- not `get()`'s own
  // definition (which textually precedes main() but is only a helper, never called
  // before the guard) -- is the `await get(token, ...)` call inside main() itself.
  const firstNetworkCallFromMainIdx = src.indexOf('await get(token,', mainStart);
  checkTrue('the location-allowlist guard appears BEFORE the credential file is read, textually', guardIdx > mainStart && guardIdx < credReadIdx);
  checkTrue('the location-allowlist guard appears BEFORE the first network call main() makes, textually', guardIdx > mainStart && guardIdx < firstNetworkCallFromMainIdx);
}
{
  // Real, network-free execution: the approved Test location passes the guard and
  // proceeds all the way to attempting to read the (nonexistent) credential file --
  // i.e. it reaches the network boundary, never dying on the location check itself.
  const bogusCred = path.join(TMP, 'nope.env');
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV', '--credential-file', bogusCred], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('approved Test location PASSES the guard: no "Test location only" refusal', !/Test location only/.test(r.stderr));
  checkTrue('approved Test location proceeds to the network boundary: dies on the credential file (ENOENT), not on location', /ENOENT|no such file/i.test(String(r.stderr || r.error || '')));
}
{
  // Any other location -- including Production's own id -- must be refused BEFORE
  // the credential file is ever touched, proven by pointing at a path that does not
  // exist: if the script got as far as reading it, the error would be ENOENT, not
  // the location message.
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
  checkTrue('running with zero args: self-verification message appears on stdout', /Verified: this script's 48 FIELD_SPECS keys all exist in CHECKBOX_MARKER_KEYS/.test(r.stdout));
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
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [nameOnly]);
  checkTrue('name matches but fieldKey differs -> conflict', result.kind === 'conflict');
  checkTrue('name-only-match conflict reason names both the name match and the fieldKey difference', /name matches/.test(result.reasons[0]) && /fieldKey differs/.test(result.reasons[0]));
}
{
  const keyOnly = realField({ name: 'Some Other Display Name' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [keyOnly]);
  checkTrue('fieldKey matches but name differs -> conflict', result.kind === 'conflict');
  checkTrue('fieldKey-only-match conflict reason names both the fieldKey match and the name difference', /fieldKey matches/.test(result.reasons[0]) && /name differs/.test(result.reasons[0]));
}
{
  const wrongType = realField({ dataType: 'NUMERICAL' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongType]);
  checkTrue('full name+fieldKey match but dataType differs -> conflict, NOT exact_existing', result.kind === 'conflict');
  checkTrue('dataType-mismatch conflict reason names the dataType difference', result.reasons.some((r) => /dataType/.test(r)));
}
{
  const wrongModel = realField({ model: 'contact' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongModel]);
  checkTrue('full name+fieldKey match but model differs -> conflict', result.kind === 'conflict');
  checkTrue('model-mismatch conflict reason names the model difference', result.reasons.some((r) => /model/.test(r)));
}
{
  const wrongParent = realField({ parentId: 'some-other-folder' });
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [wrongParent]);
  checkTrue('full name+fieldKey match but parentId differs -> conflict', result.kind === 'conflict');
  checkTrue('parentId-mismatch conflict reason names the parentId difference', result.reasons.some((r) => /parentId/.test(r)));
}
{
  const dup1 = realField({ id: 'dup-a' });
  const dup2 = realField({ id: 'dup-b', fieldKey: 'opportunity.some_other_key' }); // matches by name only, still counts as a distinct matching record
  const result = S.classifyExistingMatch(SPEC1, SPEC1_KEY, PARENT_ID, [dup1, dup2]);
  checkTrue('two distinct existing records both match this spec\'s identity -> conflict (ambiguous, never auto-resolved)', result.kind === 'conflict');
  checkTrue('duplicate-match conflict reason states how many records matched', /2 distinct existing fields match/.test(result.reasons[0]));
}

/* ==================================================================== */
/* 6. validateFieldAgainstSpec -- gates both readback and exact_existing */
/*    re-verification, catches every mismatch shape                      */
/* ==================================================================== */

check('a fully correct field validates ok', S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField()), { ok: true });
checkTrue('a name mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ name: 'Wrong Name' })).ok);
checkTrue('a fieldKey mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ fieldKey: 'opportunity.wrong' })).ok);
checkTrue('a dataType mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ dataType: 'NUMERICAL' })).ok);
checkTrue('a model mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ model: 'contact' })).ok);
checkTrue('a parentId mismatch fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ parentId: 'wrong-folder' })).ok);
checkTrue('a missing id fails validation', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ id: undefined })).ok);
checkTrue('a null field object fails validation with a clear reason, never throws', !S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, null).ok);
{
  const result = S.validateFieldAgainstSpec(SPEC1, SPEC1_KEY, PARENT_ID, realField({ name: 'Wrong Name', dataType: 'NUMERICAL' }));
  check('multiple simultaneous mismatches are ALL reported, not just the first', result.mismatches.length, 2);
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
checkTrue('malformed-response reason mentions it is not valid JSON', /not valid JSON/.test(S.parsePostResponse('{{{').reason));
checkTrue('missing-id reason mentions no usable id', /no usable "id"/.test(S.parsePostResponse('{}').reason));

/* ==================================================================== */
/* 8. planBatch -- preflights ALL specs before any POST; one conflict    */
/*    refuses the WHOLE batch                                            */
/* ==================================================================== */

{
  const specs = S.FIELD_SPECS.slice(0, 3);
  const result = S.planBatch(specs, [], PARENT_ID);
  checkTrue('an all-clear preflight (no existing matches at all) is ok:true', result.ok === true);
  check('an all-clear preflight tags every spec "create"', result.plan.map((p) => p.action), ['create', 'create', 'create']);
}
{
  const specs = S.FIELD_SPECS.slice(0, 3);
  const existing = [realField({ name: specs[0].name, fieldKey: S.expectedFieldKey(specs[0].name) })];
  const result = S.planBatch(specs, existing, PARENT_ID);
  checkTrue('one exact-existing match among otherwise-clean specs is STILL ok:true', result.ok === true);
  check('the exact-existing spec is tagged "reuse", the rest "create"', result.plan.map((p) => p.action), ['reuse', 'create', 'create']);
}
{
  const specs = S.FIELD_SPECS.slice(0, 48);
  const conflicting = realField({ name: specs[47].name, fieldKey: 'opportunity.totally_wrong_key' }); // name-only match for the LAST spec
  const result = S.planBatch(specs, [conflicting], PARENT_ID);
  checkTrue('ALL 48 specs are preflighted -- a conflict on spec #48 alone still surfaces', result.ok === false);
  check('exactly one conflict is reported, for the correct key', result.conflicts.map((c) => c.key), [specs[47].key]);
  checkTrue('every one of the other 47 non-conflicting specs is STILL classified in the plan (full preflight, not stopped early)', result.plan.length === 48);
  checkTrue('a conflict ANYWHERE in the batch means the WHOLE batch is ok:false (zero creates)', result.ok === false);
}
{
  // A conflict on the FIRST spec must not short-circuit before the LAST spec is classified.
  const specs = S.FIELD_SPECS.slice(0, 5);
  const conflicting = realField({ name: specs[0].name, fieldKey: 'opportunity.totally_wrong_key' });
  const result = S.planBatch(specs, [conflicting], PARENT_ID);
  check('every spec, including the ones after the conflicting one, is still classified', result.plan.length, 5);
  checkTrue('the plan entry for the conflicting spec is itself tagged "conflict"', result.plan[0].action === 'conflict');
}

/* ==================================================================== */
/* 9. Preflight happens before any POST; a batch-level refusal creates   */
/*    zero fields -- proven both structurally and at the entry point     */
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
checkTrue('the not-ok branch exits (never falls through to the creation loop)', /if \(!batch\.ok\) \{[\s\S]{0,400}?printSummaryAndExit\(5,/.test(src));

/* ==================================================================== */
/* 10. Readback validation gates both create and reuse paths             */
/* ==================================================================== */

checkTrue('the create path calls validateFieldAgainstSpec on the readback before logging CREATE', /const validation = validateFieldAgainstSpec\(spec, expectedKey, parentId, rb\);\s*if \(!validation\.ok\) \{[\s\S]{0,400}?printSummaryAndExit\(8,/.test(src));
checkTrue('the reuse path ALSO calls validateFieldAgainstSpec before logging REUSE -- an exact_existing field is never trusted without re-verification', /const validation = validateFieldAgainstSpec\(spec, expectedKey, parentId, rb\);\s*if \(!validation\.ok\) \{[\s\S]{0,400}?printSummaryAndExit\(6,/.test(src));
checkTrue('the reuse path re-fetches the candidate via its own single-field GET, never trusting the bulk listing alone', /action === 'reuse'[\s\S]{0,400}?await get\(token, `\$\{BASE\}\/locations\/\$\{args\.location\}\/customFields\/\$\{classification\.field\.id\}`\)/.test(src));

/* ==================================================================== */
/* 11. Unconfirmed-create safety                                         */
/* ==================================================================== */

checkTrue('parsePostResponse is called on every successful-HTTP POST response before it is trusted', /const parsedPost = parsePostResponse\(postText\);/.test(src));
checkTrue('an unconfirmed parsePostResponse result stops immediately and never attempts another creation', /if \(!parsedPost\.ok\) \{[\s\S]{0,600}?printSummaryAndExit\(7,/.test(src));
checkTrue('the unconfirmed-create message explicitly says GHL may have created a field IAOS cannot confirm', /GHL may have created a field whose identity IAOS cannot confirm/.test(src));
{
  const parsedPostIdx = src.indexOf('const parsedPost = parsePostResponse(postText);');
  const resultsRecordIdx = src.indexOf('results[spec.key] = created.id;');
  checkTrue('results is recorded from the PARSED (confirmed) response, after the unconfirmed-response gate, never before it', parsedPostIdx > 0 && resultsRecordIdx > parsedPostIdx);
}

/* ==================================================================== */
/* 12. No default/Production fallback; no PUT/PATCH/DELETE               */
/* ==================================================================== */

checkTrue('parseArgs never assigns a default value to location', !/location\s*=\s*location\s*\|\|/.test(src));
checkTrue('parseArgs never assigns a default value to credentialFile', !/credentialFile\s*=\s*credentialFile\s*\|\|/.test(src));
const methodMatches = Array.from(src.matchAll(/method:\s*'([A-Z]+)'/g)).map((m) => m[1]);
check('only GET and POST methods appear in this script, nothing else', [...new Set(methodMatches)].sort(), ['GET', 'POST']);
checkTrue('no PUT method anywhere in this script', !/method:\s*'PUT'/.test(src));
checkTrue('no PATCH method anywhere in this script', !/method:\s*'PATCH'/.test(src));
checkTrue('no DELETE method anywhere in this script', !/method:\s*'DELETE'/.test(src));

/* ==================================================================== */
/* 13. No template, draft, send, Linear, non-customFields endpoint       */
/* ==================================================================== */

checkTrue('no template-related API endpoint is called anywhere in this script', Array.from(src.matchAll(/fetch\(`[^`]*`/g)).every((m) => !/template/i.test(m[0])));
checkTrue('no draft-creation endpoint appears in this script', !/\/drafts?\b/i.test(src));
checkTrue('no send/email/sms endpoint appears in this script', !/\/(send|email|sms)\b/i.test(src));
checkTrue('no Linear API reference appears in this script', !/linear\.app|api\.linear/i.test(src));
checkTrue('this script only ever calls the customFields endpoint', Array.from(src.matchAll(/fetch\(`\$\{BASE\}([^`]*)`/g)).every((m) => m[1].includes('/customFields')));

/* ==================================================================== */
/* 14. Every exit path prints the proposed mapping + results before exit */
/* ==================================================================== */

checkTrue('printSummaryAndExit always prints the full proposed-mapping table before exiting', /function printSummaryAndExit\(code, closingMessage\) \{\s*console\.log\('\\n--- Proposed mapping/.test(src));
checkTrue('printSummaryAndExit is used for the natural successful/dry-run end', /printSummaryAndExit\(0, 'DRY RUN/.test(src) && /printSummaryAndExit\(0, 'Next step/.test(src));

/* ==================================================================== */
/* 15. NO --only bypass -- main() always preflights the complete,        */
/*     unfiltered FIELD_SPECS                                            */
/* ==================================================================== */

checkTrue('parseArgs contains no --only parsing at all', !/'--only'/.test(src) && !/get\('--only'\)/.test(src));
checkTrue('the returned args object from parseArgs carries no `only` field', !/return \{ location, credentialFile, apply: argv\.includes\('--apply'\), only:/.test(src));
checkTrue('the usage comment documents no [--only <key>] flag', !/\[--only <key>\]/.test(src));
checkTrue('there is no `specsToRun` filtering variable anywhere in this script', !/specsToRun/.test(src));
{
  const planCallIdx = src.indexOf('const batch = planBatch(');
  checkTrue('planBatch is called with the literal, complete FIELD_SPECS array, never a filtered subset', src.slice(planCallIdx, planCallIdx + 80).includes('planBatch(FIELD_SPECS, existingFields, parentId)'));
}
{
  // Behavioral proof at the pure-function level (the level main() itself calls):
  // a conflict on the LAST spec (#48) still surfaces when planBatch is given the
  // complete 48-spec array -- there is no code path that could ever narrow this to
  // one field and skip preflighting the rest.
  const specs = S.FIELD_SPECS; // all 48, exactly as main() would pass them
  const conflictingOnLast = realField({ name: specs[47].name, fieldKey: 'opportunity.totally_wrong_key' });
  const result = S.planBatch(specs, [conflictingOnLast], PARENT_ID);
  checkTrue('a conflict on field #48 (of a full 48-spec batch) still blocks the WHOLE batch, including field #1', result.ok === false && result.plan.length === 48);
  check('the conflict is attributed to the correct (last) key', result.conflicts.map((c) => c.key), [specs[47].key]);
  checkTrue('field #1 is present in the plan (fully preflighted) even though the conflict is on field #48', result.plan[0].spec.key === specs[0].key && result.plan[0].action !== undefined);
}
{
  // No live network call needed: any invocation of this script (--only removed)
  // reaches main() with exactly one specs array in scope for planBatch -- FIELD_SPECS
  // itself. Confirm no alternate, narrower array literal is ever constructed for it.
  const mainStart = src.indexOf('async function main()');
  const mainBody = src.slice(mainStart);
  checkTrue('main()\'s body constructs no filtered specs array (no .filter( call operating on FIELD_SPECS)', !/FIELD_SPECS\.filter\(/.test(mainBody));
}

/* ==================================================================== */
/* 16. Canonical parent-folder anchor -- fail closed, no arbitrary       */
/*     fallback                                                          */
/* ==================================================================== */

check('CANONICAL_PARENT_ANCHOR_FIELD_KEY is exported and is exactly the ARV anchor key', S.CANONICAL_PARENT_ANCHOR_FIELD_KEY, 'opportunity.arv_after_repair_value');
checkTrue('no arbitrary "first folder found" fallback exists anywhere in this script', !/filter\(Boolean\)\[0\]/.test(src) && !/existingFields\.map\(\(f\) => f\.parentId\)/.test(src));
checkTrue('main() calls resolveCanonicalParentId and dies on failure before using any parentId', /const resolvedParent = resolveCanonicalParentId\(existingFields\);\s*if \(!resolvedParent\.ok\) die\(resolvedParent\.reason\);/.test(src));

{
  const anchor = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: PARENT_ID, name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  check('exactly one valid anchor resolves to its own parentId', S.resolveCanonicalParentId([anchor]), { ok: true, parentId: PARENT_ID });
  check('the anchor is found regardless of position in the existing-fields array', S.resolveCanonicalParentId([realField(), anchor, realField({ id: 'x2' })]), { ok: true, parentId: PARENT_ID });
}
{
  const result = S.resolveCanonicalParentId([]); // no fields at all
  checkTrue('a location with NO anchor field fails closed', result.ok === false);
  checkTrue('missing-anchor reason names the exact anchor key and says there is no fallback', /opportunity\.arv_after_repair_value/.test(result.reason) && /no fallback/.test(result.reason));
}
{
  const result = S.resolveCanonicalParentId([realField({ name: 'Unrelated Field', fieldKey: 'opportunity.something_else' })]); // fields exist, but not the anchor
  checkTrue('a location with OTHER fields but no matching anchor still fails closed', result.ok === false);
}
{
  const dup1 = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: PARENT_ID, name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  const dup2 = { id: 'anchor-2', fieldKey: 'opportunity.arv_after_repair_value', parentId: 'a-different-folder', name: 'ARV (After Repair Value) (dup)', dataType: 'NUMERICAL', model: 'opportunity' };
  const result = S.resolveCanonicalParentId([dup1, dup2]);
  checkTrue('TWO anchor fields (duplicated) fails closed -- never silently picks the first', result.ok === false);
  checkTrue('duplicate-anchor reason states how many were found and lists both ids', /2 times/.test(result.reason) && /anchor-1/.test(result.reason) && /anchor-2/.test(result.reason));
}
{
  const noParent = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: undefined, name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  const result = S.resolveCanonicalParentId([noParent]);
  checkTrue('an anchor with a MISSING parentId fails closed', result.ok === false);
  checkTrue('missing-parentId reason names the anchor id', /anchor-1/.test(result.reason));
}
{
  const blankParent = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: '   ', name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  const result = S.resolveCanonicalParentId([blankParent]);
  checkTrue('an anchor with a BLANK (whitespace-only) parentId fails closed, same as missing', result.ok === false);
}
{
  const nonStringParent = { id: 'anchor-1', fieldKey: 'opportunity.arv_after_repair_value', parentId: 12345, name: 'ARV (After Repair Value)', dataType: 'NUMERICAL', model: 'opportunity' };
  const result = S.resolveCanonicalParentId([nonStringParent]);
  checkTrue('an anchor with a non-string parentId fails closed', result.ok === false);
}
{
  // The dry-run must REPORT the resolved parentId, not just use it silently.
  checkTrue('the dry run explicitly logs the resolved canonical parentId', /console\.log\(`Resolved canonical parentId \(from the single required "\$\{CANONICAL_PARENT_ANCHOR_FIELD_KEY\}" anchor\):`, parentId\);/.test(src));
}
{
  // End-to-end (still network-free): approved location + a nonexistent credential
  // file reaches the point of attempting to read that file -- i.e. it passes the
  // location guard and would go on to resolve the anchor and plan all 48, proving
  // there is no location- or anchor-related early exit that bypasses the rest of
  // the pipeline for a valid setup. (The anchor/parentId resolution itself cannot
  // be reached without a real network call, which this suite never makes --
  // resolveCanonicalParentId's own unit tests above cover its behavior directly.)
  const bogusCred = path.join(TMP, 'nope2.env');
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV', '--credential-file', bogusCred], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('approved Test location + (eventually) a valid anchor is the only path that reaches the network boundary -- proven by reaching the credential-read failure, not a location or --only related refusal', /ENOENT|no such file/i.test(String(r.stderr || r.error || '')) && !/Test location only/.test(r.stderr));
}

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
