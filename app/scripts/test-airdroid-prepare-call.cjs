/**
 * B14-13 — AirDroid Call launch link (iaos-airdroid:call).
 *
 * Offline. Compiles the pure link builder (app/src/lib/airdroid-prepare-call.ts)
 * and checks which seller numbers produce a link and exactly what the link is.
 * On Windows it also runs the helper's link handler in -ParseOnly mode, which
 * touches nothing (no AirDroid, no registry), to prove the browser side and the
 * helper side agree. Elsewhere (CI on Ubuntu) that part is skipped and reported.
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

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
