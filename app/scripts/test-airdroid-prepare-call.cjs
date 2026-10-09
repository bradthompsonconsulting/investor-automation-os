/**
 * B14-13 — AirDroid Call launch link (iaos-airdroid:call).
 *
 * Offline. Compiles the pure link builder (app/src/lib/airdroid-prepare-call.ts)
 * and checks which seller numbers produce a link and exactly what the link is.
 * On Windows it also runs the helper's link handler in -ParseOnly mode, which
 * touches nothing (no AirDroid, no registry), to prove the browser side and the
 * helper side agree. Elsewhere (CI on Ubuntu) that part is skipped and reported.
 *
 * The Make Call step (tools/airdroid-prepare-call/DialCall.ps1) is checked
 * statically on every platform (one click, recheck first, no keystrokes, no
 * AirDroid file reads, handler order), and on Windows its number validation
 * and duplicate guard run with -GuardOnly against a temporary guard file. No
 * check here touches AirDroid, clicks anything or places a call.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '..');
const TMP = path.join(APP, '.tmp-airdroid-prepare-call-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'src/lib/airdroid-prepare-call.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}

const lib = require(path.join(TMP, 'src/lib/airdroid-prepare-call.js'));
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const LINK = 'iaos-airdroid:call?number=2025550147';
const accepted = [
  ['10 digits', '2025550147'],
  ['dashed', '202-555-0147'],
  ['parenthesised', '(202) 555-0147'],
  ['dotted', '202.555.0147'],
  ['+1 E.164', '+12025550147'],
  ['1 prefix', '1 202 555 0147'],
];
for (const [name, raw] of accepted) check(`link: ${name}`, lib.airdroidCallLink(raw), LINK);

const refused = [
  ['empty', ''],
  ['null', null],
  ['undefined', undefined],
  ['7 digits', '555-0147'],
  ['11 digits not starting 1', '22025550147'],
  ['UK number', '+44 20 7946 0958'],
  ['area code starts 0', '0025550147'],
  ['area code starts 1', '1025550147x'],
  ['exchange starts 1', '2021550147'],
  ['exchange starts 0', '2020550147'],
];
for (const [name, raw] of refused) check(`no link: ${name}`, lib.airdroidCallLink(raw), null);
check('scheme constant', lib.AIRDROID_LINK_SCHEME, 'iaos-airdroid');
check('digits helper', lib.airdroidCallDigits('+1 (202) 555-0147'), '2025550147');

// The source must stay navigation-only: no fetch, no GHL client, no write helpers.
const src = fs.readFileSync(path.join(APP, 'src/lib/airdroid-prepare-call.ts'), 'utf8');
check('builder makes no network or write calls', /\bfetch\(|ghl\.|appWriteFetch|writeCommand|XMLHttpRequest/.test(src), false);

// Helper side, Windows only: the handler's own parser must agree with the builder, touching nothing.
const handler = path.join(REPO, 'tools', 'airdroid-prepare-call', 'IaosAirdroidHandler.ps1');
if (process.platform === 'win32') {
  function parse(uri) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', handler, '-ParseOnly', uri], { encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '').trim() };
  }
  check('handler parses the builder link', parse(LINK), { code: 0, out: 'PARSED 2025550147' });
  check('handler accepts trailing slash', parse(`${LINK}/`), { code: 0, out: 'PARSED 2025550147' });
  for (const bad of [
    'iaos-airdroid:call?number=555014',
    'iaos-airdroid:call?number=2025550147&dial=1',
    'iaos-airdroid:prepare?number=2025550147',
    'iaos-airdroid:call?number=1025550147',
    'iaos-airdroid:call?number=2025550147%26x',
    'iaos-airdroid:call?number=2025550147;calc',
    'other:call?number=2025550147',
    '',
  ]) check(`handler refuses ${JSON.stringify(bad)}`, parse(bad), { code: 20, out: 'REFUSED' });
} else {
  console.log('SKIP handler parse checks (not Windows; the handler is Windows-only)');
}

// Make Call step (DialCall.ps1): static shape, all platforms. Nothing here runs against AirDroid.
const dialPath = path.join(REPO, 'tools', 'airdroid-prepare-call', 'DialCall.ps1');
const dial = fs.readFileSync(dialPath, 'utf8');
const dialCode = dial.replace(/<#[\s\S]*?#>/g, '').split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
const handlerSrc = fs.readFileSync(handler, 'utf8');
check('dial: exactly one button-down and one button-up message, no retry loop around them',
  [(dialCode.match(/0x0201/g) || []).length, (dialCode.match(/0x0202/g) || []).length, /\b(?:for|while|do|foreach)\b[^\n]*\n?[^\n]*0x0201/.test(dialCode)], [1, 1, false]);
check('dial: never presses Enter or End Call, never sends keystrokes',
  /0x0100|0x0101|SendKeys|keybd_event|SendInput|VK_RETURN|End Call/i.test(dialCode), false);
check('dial: never reads AirDroid configuration or log files',
  /AppData\\Roaming\\AirDroid|\.ini\b|\.config\b|AirDroid[^\n]*\.log|ProgramData/i.test(dialCode), false);
{
  // The final recheck must sit between the panel recheck and the click, not only in the earlier Dialpad lookup.
  const recheck = dialCode.slice(dialCode.indexOf('$same = '), dialCode.indexOf('0x0201'));
  check('dial: the panel and then the exact number are rechecked immediately before the click',
    dialCode.indexOf('$same = ') > -1 && /if \(-not \$ok\) \{ Stop-With 9/.test(recheck) && /GetText\(\$field\) -cne \$Number\) \{ Stop-With 9/.test(recheck), true);
}
check('dial: the dial is recorded for the duplicate guard before the click',
  dialCode.indexOf('Set-Content -LiteralPath $GuardFile') > -1 && dialCode.indexOf('Set-Content -LiteralPath $GuardFile') < dialCode.indexOf('0x0201'), true);
check('dial: one dial at a time (named mutex, no wait)', /Mutex\(\$false, 'Local\\IAOS-AirDroid-Dial'\)/.test(dialCode) && /WaitOne\(0\)/.test(dialCode), true);
check('handler: DialCall runs only after PrepareCall exits 0, with the same parsed digits',
  /PrepareCall\.ps1'\) -Number \$number\s*\n\$code = \$LASTEXITCODE\s*\nif \(\$code -eq 0\) \{\s*\n\s*& powershell\.exe [^\n]*'DialCall\.ps1'\) -Number \$number/.test(handlerSrc), true);

// Duplicate guard and number validation, Windows only. -GuardOnly never looks at AirDroid; the guard file is temporary.
if (process.platform === 'win32') {
  const guard = path.join(TMP, 'last-dial.json');
  function runDial(args) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', dialPath, ...args], { encoding: 'utf8' });
    return r.status;
  }
  const writeGuard = (number, secondsAgo) => fs.writeFileSync(guard, JSON.stringify({ number, at: new Date(Date.now() - secondsAgo * 1000).toISOString() }));
  check('dial: invalid number refused before anything else (exit 2)', ['', '555', '1025550147', '2025550147;calc'].map((n) => runDial(['-Number', n, '-GuardOnly', '-GuardFile', guard])), [2, 2, 2, 2]);
  check('dial guard: no previous dial -> allowed', runDial(['-Number', '2025550147', '-GuardOnly', '-GuardFile', guard]), 0);
  writeGuard('2025550147', 5);
  check('dial guard: same number 5s ago -> duplicate refused (exit 10)', runDial(['-Number', '2025550147', '-GuardOnly', '-GuardFile', guard]), 10);
  check('dial guard: a different number 5s ago -> allowed', runDial(['-Number', '2145550101', '-GuardOnly', '-GuardFile', guard]), 0);
  writeGuard('2025550147', 45);
  check('dial guard: same number 45s ago -> allowed', runDial(['-Number', '2025550147', '-GuardOnly', '-GuardFile', guard]), 0);
  fs.writeFileSync(guard, 'not json');
  check('dial guard: unreadable record does not block', runDial(['-Number', '2025550147', '-GuardOnly', '-GuardFile', guard]), 0);
} else {
  console.log('SKIP dial guard checks (not Windows; the helper is Windows-only)');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
