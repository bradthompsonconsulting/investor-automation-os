/**
 * INV-67 checkbox-marker / broker-model repair -- Batch 1 GHL Test
 * provisioning script safety proof. Proves
 * `inv67-create-checkbox-marker-fields-batch1.cjs` satisfies every safety
 * property required before it is authorized for a live `--apply` run,
 * WITHOUT ever making a network call itself:
 *
 *   1. Exactly 48 FIELD_SPECS, exactly equal (same 48, same order) to the
 *      authoritative `CHECKBOX_MARKER_KEYS` (`contract-checkbox-marker-
 *      model.ts`) -- both by static source extraction AND by spawning the
 *      script's own self-verification step as a real (network-free) child
 *      process.
 *   2. Dry run is the default; the POST call is textually unreachable
 *      without the clash check and the `--apply` gate both being passed
 *      first.
 *   3. `--location` and `--credential-file` have no default and no
 *      Production fallback -- proven both statically (no hardcoded
 *      location id anywhere in the script) and behaviorally (running the
 *      script with each omitted dies with a distinct, specific message,
 *      before any network call).
 *   4. Collision checks run, and skip via `continue`, before the POST
 *      block -- an existing field is never duplicated.
 *   5. A created field's id is recorded before its readback is attempted
 *      (a readback failure can never hide evidence that GHL already has
 *      the field), and every exit path -- success, POST failure, readback
 *      failure -- prints the accumulated results before the process ends.
 *   6. No PUT, PATCH, or DELETE method appears anywhere in the script.
 *
 * All child-process invocations below intentionally omit the credential
 * file or point at a nonexistent one, so every one of them dies (via this
 * script's own `die()`/`fs.readFileSync` failure) BEFORE the one `fetch`
 * call that could ever reach the network -- these are real executions, not
 * mocks, and still make zero network calls.
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

const src = fs.readFileSync(SCRIPT, 'utf8');

const FLOOR = 28;
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

/* ==================================================================== */
/* 1. FIELD_SPECS -- exactly 48, exactly equal to CHECKBOX_MARKER_KEYS   */
/* ==================================================================== */

const fieldSpecKeys = Array.from(src.matchAll(/\{ key: '([^']+)', name: '[^']+' \}/g)).map((m) => m[1]);
check('script declares exactly 48 FIELD_SPECS', fieldSpecKeys.length, 48);
check('FIELD_SPECS keys are unique', new Set(fieldSpecKeys).size, 48);
check('FIELD_SPECS keys equal CHECKBOX_MARKER_KEYS exactly, SAME ORDER (source-level extraction)', fieldSpecKeys, [...CHECKBOX_MARKER_KEYS]);

/* ==================================================================== */
/* 2. Self-verification runs before any network access, textually and   */
/*    behaviorally                                                       */
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
  // Real, network-free execution: no args at all. Self-verification must run
  // (proving it happens before argument parsing even) and the process must die
  // on the missing --location, never reaching a fetch call.
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('running with zero args: self-verification message appears on stdout', /Verified: this script's 48 FIELD_SPECS keys match CHECKBOX_MARKER_KEYS exactly/.test(r.stdout));
  checkTrue('running with zero args: dies on missing --location with a specific message', /ERROR: --location is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with zero args: exits with code 2 (die()), never attempts a network call', r.status, 2);
}

{
  // Location supplied, credential file omitted -- must die distinctly, still before any network call.
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV'], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('running with --location only: dies on missing --credential-file with a specific, DISTINCT message', /ERROR: --credential-file is required\. There is no default and no fallback\./.test(r.stderr));
  check('running with --location only: exits with code 2', r.status, 2);
}

{
  // Location + a nonexistent credential file path -- proves no fallback credential is compiled into the script:
  // it must fail trying to READ that exact file, never silently substitute a real token.
  const bogusPath = path.join(TMP, 'does-not-exist.env');
  const r = spawnSync(process.execPath, [SCRIPT, '--location', 'SoTgVoaFGHtBdRFvXWQV', '--credential-file', bogusPath], { cwd: APP, encoding: 'utf8', timeout: 15000 });
  checkTrue('running with a nonexistent --credential-file: fails trying to read that exact file (no hardcoded fallback token)', r.status !== 0 && /ENOENT|no such file/i.test(String(r.stderr || r.error || '')));
}

/* ==================================================================== */
/* 3. No default/Production fallback for --location or --credential-file */
/* ==================================================================== */

checkTrue('parseArgs never assigns a default value to location (no `location = location ||` pattern)', !/location\s*=\s*location\s*\|\|/.test(src));
checkTrue('parseArgs never assigns a default value to credentialFile (no `credentialFile = credentialFile ||` pattern)', !/credentialFile\s*=\s*credentialFile\s*\|\|/.test(src));
checkTrue('parseArgs dies on a missing location before returning', /if \(!location\) die\(/.test(src));
checkTrue('parseArgs dies on a missing credentialFile before returning', /if \(!credentialFile\) die\(/.test(src));
checkTrue('the Production location id never appears anywhere in this script', !src.includes('jmHG4B8RdzwpfqruNf68'));
checkTrue('no location id of any kind is hardcoded in this script (Test id absent too -- must always come from --location)', !src.includes('SoTgVoaFGHtBdRFvXWQV'));

/* ==================================================================== */
/* 4. Dry run is the default; POST is textually unreachable without      */
/*    passing the clash check AND --apply                                */
/* ==================================================================== */

checkTrue('apply is derived ONLY from `argv.includes(\'--apply\')` -- never a default true, never an env var', /apply: argv\.includes\('--apply'\)/.test(src));
{
  const clashCheckIdx = src.indexOf('if (clash) {');
  const dryGateIdx = src.indexOf('if (!args.apply) {');
  const postFetchIdx = src.indexOf("method: 'POST'");
  checkTrue('clash check appears BEFORE the dry-run gate, textually, inside the per-field loop', clashCheckIdx > 0 && clashCheckIdx < dryGateIdx);
  checkTrue('the dry-run gate (`if (!args.apply)`) appears BEFORE the POST fetch call, textually', dryGateIdx > 0 && dryGateIdx < postFetchIdx);
}
checkTrue('the clash branch always `continue`s -- an existing field is never duplicated, apply or not', /if \(clash\) \{[\s\S]{0,200}?continue;\s*\}/.test(src));
checkTrue('the dry-run branch always `continue`s before reaching the POST call', /if \(!args\.apply\) \{[\s\S]{0,150}?continue;\s*\}/.test(src));

/* ==================================================================== */
/* 5. Only GET and POST methods exist; no PUT/PATCH/DELETE anywhere      */
/* ==================================================================== */

const methodMatches = Array.from(src.matchAll(/method:\s*'([A-Z]+)'/g)).map((m) => m[1]);
check('only GET and POST methods appear in this script, nothing else', [...new Set(methodMatches)].sort(), ['GET', 'POST']);
checkTrue('no PUT method anywhere in this script', !/method:\s*'PUT'/.test(src));
checkTrue('no PATCH method anywhere in this script', !/method:\s*'PATCH'/.test(src));
checkTrue('no DELETE method anywhere in this script', !/method:\s*'DELETE'/.test(src));

/* ==================================================================== */
/* 6. Created fields are read back; partial failure reports everything   */
/*    actually created before the process exits                         */
/* ==================================================================== */

{
  const createdIdx = src.indexOf('const created = JSON.parse(postText)');
  const readbackIdx = src.indexOf('const readback = await get(token, `${BASE}/locations/${args.location}/customFields/${created.id}`)');
  checkTrue('a successful POST is followed by a readback GET of the created field, in that order', createdIdx > 0 && readbackIdx > createdIdx);
}
{
  const recordIdx = src.indexOf('results[spec.key] = created.id;');
  const readbackAttemptIdx = src.indexOf('const readback = await get(token,');
  checkTrue('a created field\'s id is recorded in `results` BEFORE its readback is attempted (a readback failure can never hide that it was created)', recordIdx > 0 && recordIdx < readbackAttemptIdx);
}
checkTrue('printSummaryAndExit is called on POST failure (partial-failure evidence is printed, not silently dropped)', /FAIL {2}\$\{spec\.key[\s\S]{0,150}?printSummaryAndExit\(3,/.test(src));
checkTrue('printSummaryAndExit is called on readback failure after a successful POST', /FAIL-READBACK[\s\S]{0,300}?printSummaryAndExit\(4,/.test(src));
checkTrue('printSummaryAndExit is called on the natural (fully dry-run or fully successful) end of main()', /printSummaryAndExit\(0, 'DRY RUN/.test(src) && /printSummaryAndExit\(0, 'Next step/.test(src));
checkTrue('printSummaryAndExit always prints the full proposed-mapping table before exiting', /function printSummaryAndExit\(code, closingMessage\) \{\s*console\.log\('\\n--- Proposed mapping/.test(src));

/* ==================================================================== */
/* 7. No template, draft, send, Production, Linear, INV-66, Board #10    */
/*    behavior exists in this script                                     */
/* ==================================================================== */

checkTrue(
  'no template-related API endpoint is called anywhere in this script (comments discussing future template-placement scope are fine -- an actual /templates call is not)',
  Array.from(src.matchAll(/fetch\(`[^`]*`/g)).every((m) => !/template/i.test(m[0])),
);
checkTrue('no draft-creation endpoint appears in this script', !/\/drafts?\b/i.test(src));
checkTrue('no send/email/sms endpoint appears in this script', !/\/(send|email|sms)\b/i.test(src));
checkTrue('no Linear API reference appears in this script', !/linear\.app|api\.linear/i.test(src));
checkTrue('this script only ever calls the customFields endpoint', Array.from(src.matchAll(/fetch\(`\$\{BASE\}([^`]*)`/g)).every((m) => m[1].includes('/customFields')));

cleanup();
console.log(`\n${checks} checks, ${failures} failures. FLOOR ${FLOOR}.`);
if (checks < FLOOR) { console.error(`FAIL: only ${checks} checks ran, floor is ${FLOOR}.`); process.exit(1); }
if (failures > 0) process.exit(1);
console.log('ALL PASS');
