/**
 * B14-13: Call with AirDroid when AirDroid is not running. The helper starts it, waits a bounded time for exactly one
 * Dialpad, then continues the existing guarded one-click call (and the minimise afterwards). If AirDroid is not ready
 * in time it stops with a clear message (exit 8): no number entered, no click. The lock and the duplicate check come
 * first, so a refused launch starts nothing.
 *
 * Inert and offline. It never touches the real AirDroid, a phone or a call: the program it starts is the fake Dialpad
 * (harness/airdroid-fake/FakeAirDroid.cs), passed only through the test-only -TestLaunchPath / -TestProcessName.
 * Windows desktop session only. It shares the machine-wide Local\IAOS-AirDroid-Dial lock with the other helper
 * suites, so never run two helper suites at once.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '..');
const TOOLS = path.join(REPO, 'tools', 'airdroid-prepare-call');
const HANDLER = path.join(TOOLS, 'IaosAirdroidHandler.ps1');
const PREPARE = path.join(TOOLS, 'PrepareCall.ps1');
const FAKE = 'IaosFakeAirDroid';

if (process.platform !== 'win32') {
  console.log('SKIP all start checks (not Windows; the helper is Windows-only)');
  process.exit(0);
}

const TMP = path.join(APP, '.tmp-airdroid-start-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const AIR_EXE = path.join(TMP, `${FAKE}.exe`);

let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const fresh = (stem) => path.join(TMP, `${stem}-${++n}`);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [])
  .map((l) => { const m = l.match(/^(\S+) (\S+) ?(.*)$/); return { at: Date.parse(m[1]), kind: m[2], text: m[3] }; });
const kinds = (log) => read(log).map((l) => l.kind);
const fakeCount = () => (spawnSync('tasklist', ['/FI', `IMAGENAME eq ${FAKE}.exe`, '/NH'], { encoding: 'utf8' }).stdout || '')
  .split(/\r?\n/).filter((l) => l.startsWith(FAKE)).length;
const killFakes = async () => { spawnSync('taskkill', ['/IM', `${FAKE}.exe`, '/F'], { stdio: 'ignore' }); for (let i = 0; i < 50 && fakeCount(); i += 1) await sleep(100); };

function build(cs, exe) {
  const r = spawnSync('powershell.exe', [...PS, '-Command',
    `Add-Type -TypeDefinition (Get-Content -Raw '${path.join(__dirname, 'harness', 'airdroid-fake', cs)}') ` +
    `-ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly '${exe}' -OutputType WindowsApplication`], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(exe)) { console.error(r.stderr); process.exit(10); }
}
/** One handler launch that may start the fake: its log file and start-up flags go in -TestLaunchArgs. */
function launch(number, { log, flags = [], guard = fresh('guard') + '.json', timeoutSec = 0 } = {}) {
  const args = [HANDLER, `iaos-airdroid:call?number=${number}`, '-NoPause', '-TestProcessName', FAKE, '-GuardFile', guard,
    '-TestLaunchPath', AIR_EXE, '-TestLaunchArgs', [`"${log}"`, '--taskbar', ...flags].join(' ')];
  if (timeoutSec) args.push('-TestReadyTimeoutSec', String(timeoutSec));
  const started = Date.now();
  const r = spawnSync('powershell.exe', [...PS, '-File', ...args], { encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), ms: Date.now() - started, guard };
}

let probe;
function startProbe() {
  const script = path.join(TMP, 'lock-probe.ps1');
  fs.writeFileSync(script, [
    "$m = New-Object System.Threading.Mutex($false, 'Local\\IAOS-AirDroid-Dial')",
    'while ($null -ne ($line = [Console]::In.ReadLine())) {',
    "  try { if ($m.WaitOne(0)) { $m.ReleaseMutex(); [Console]::Out.WriteLine('FREE') } else { [Console]::Out.WriteLine('BUSY') } }",
    "  catch [System.Threading.AbandonedMutexException] { $m.ReleaseMutex(); [Console]::Out.WriteLine('ABANDONED') }",
    '  [Console]::Out.Flush()',
    '}',
  ].join('\n'));
  probe = { child: spawn('powershell.exe', [...PS, '-File', script]), buffer: '', waiting: [] };
  probe.child.stdout.on('data', (d) => {
    probe.buffer += d;
    let i;
    while ((i = probe.buffer.indexOf('\n')) > -1) {
      const answer = probe.buffer.slice(0, i).trim();
      probe.buffer = probe.buffer.slice(i + 1);
      if (answer && probe.waiting.length) probe.waiting.shift()(answer);
    }
  });
}
const lockState = () => new Promise((resolve) => { probe.waiting.push(resolve); probe.child.stdin.write('?\n'); });

(async () => {
  try {
    // ---- Static ----
    {
      const lf = (t) => t.replace(/\r\n/g, '\n');
      const strip = (src) => lf(src).replace(/<#[\s\S]*?#>/g, '').split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
      const prep = strip(fs.readFileSync(PREPARE, 'utf8'));
      const handler = strip(fs.readFileSync(HANDLER, 'utf8'));
      const start = prep.slice(prep.indexOf('if ($StartIfNotRunning'), prep.indexOf('$procs = @(Get-Process'));
      check('static: the handler asks PrepareCall to start AirDroid; duplicate check, then prepare, then dial, all under the lock',
        [/\$prepareExtra = @\('-Automatic', '-StartIfNotRunning'\)/.test(handler),
          handler.indexOf("Invoke-Step 'DialCall.ps1' (@('-GuardOnly')") < handler.indexOf("Invoke-Step 'PrepareCall.ps1' $prepareExtra"),
          handler.indexOf("Invoke-Step 'PrepareCall.ps1' $prepareExtra") < handler.lastIndexOf("Invoke-Step 'DialCall.ps1' $dialExtra")],
        [true, true, true]);
      check('static: the start-up step runs only with -StartIfNotRunning, never with -CheckOnly, only when AirDroid is not running, and a test run never starts the real AirDroid',
        /if \(\$StartIfNotRunning -and -not \$CheckOnly -and \(-not \$TestProcessName -or \$TestLaunchPath\) -and @\(Get-Process -Name \$processName -ErrorAction SilentlyContinue\)\.Count -eq 0\)/.test(prep), true);
      check('static: the wait is bounded (5-180 s, default 60) and only looks: no text set, no click, no keys while waiting',
        [/\[ValidateRange\(5, 180\)\]\[int\]\$ReadyTimeoutSec = 60/.test(prep), /0x000C|0x0201|0x0202|SendKeys|SetForegroundWindow|BringWindowToTop|ShowWindow/.test(start)],
        [true, false]);
      check('static: not ready in time is exit 8 and says no call was placed',
        [/Stop-With 8 "AirDroid was started but was not ready within \$ReadyTimeoutSec seconds/.test(prep), /no call was placed/.test(start)], [true, true]);
      check('static: the real start target is the installed AirDroid.exe; a test launch path needs a test process name',
        [/'AirDroid\\AirDroid\.exe'/.test(start), /if \(-not \$TestProcessName\) \{ Stop-With 8/.test(start)], [true, true]);
    }

    build('FakeAirDroid.cs', AIR_EXE);
    await killFakes();
    startProbe();
    check('setup: lock free and no fake AirDroid running', [await lockState(), fakeCount()], ['FREE', 0]);

    // ---- 1. Not running: started, waited for (window after 1.5 s, Dialpad 2.5 s later), then one click, minimised ----
    let guard1;
    let log1;
    {
      const log = fresh('air') + '.log';
      log1 = log;
      const r = launch('2025550301', { log, flags: ['--window-after=1500', '--dialpad-after=2500'] });
      guard1 = r.guard;
      await sleep(400);
      const k = kinds(log);
      const order = k.filter((x) => ['STARTED', 'READY', 'DIALPAD', 'TEXT', 'CLICK', 'MINIMIZED'].includes(x));
      check('not running: exit 0; started, window, Dialpad, number, ONE click, minimised (in that order)',
        [r.code, order], [0, ['STARTED', 'READY', 'DIALPAD', 'TEXT', 'CLICK', 'MINIMIZED']]);
      check('not running: the click was on the right number, and nothing was typed before the Dialpad appeared',
        [read(log).filter((l) => l.kind === 'CLICK').map((l) => l.text), k.indexOf('TEXT') > k.indexOf('DIALPAD')], [['2025550301'], true]);
      check('not running: says it started AirDroid and that it is ready; still makes no connected-call claim',
        [/AirDroid is not running: starting it and waiting up to 60 seconds/.test(r.out), /AirDroid is ready: one Dialpad found/.test(r.out),
          /CLICK SENT ONCE/.test(r.out), /call (?:is |was )?(?:connected|placed|answered)/i.test(r.out.replace(/whether the call connected/g, ''))],
        [true, true, true, false]);
      check('not running: exactly one AirDroid was started, and it keeps running; lock released', [fakeCount(), await lockState()], [1, 'FREE']);
    }

    // ---- 2. Already running: nothing new is started ----
    {
      const log = log1;   // the fake started in case 1 is still running and writes to its log
      const before = read(log).length;
      const r = launch('2025550302', { log: fresh('unused') + '.log' });
      await sleep(400);
      check('already running: exit 0, no second AirDroid started, no start message', [r.code, fakeCount(), /starting it/.test(r.out)], [0, 1, false]);
      check('already running: one click on the number', read(log).slice(before).filter((l) => l.kind === 'CLICK').map((l) => l.text), ['2025550302']);
    }
    await killFakes();

    // ---- 3. Refusals happen before anything is started ----
    {
      const log = fresh('air') + '.log';
      const dup = launch('2025550301', { log, guard: guard1 });
      check('duplicate within 30 s (exit 10): AirDroid NOT started, nothing typed', [dup.code, fakeCount(), kinds(log)], [10, 0, []]);
      const holder = spawn('powershell.exe', [...PS, '-Command',
        "$m = New-Object System.Threading.Mutex($false, 'Local\\IAOS-AirDroid-Dial'); [void]$m.WaitOne(0); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $m.ReleaseMutex(); [Console]::Out.WriteLine('RELEASED'); [Console]::Out.Flush()"]);
      let hOut = '';
      holder.stdout.on('data', (d) => { hOut += d; });
      const said = async (t) => { for (let i = 0; i < 200 && !hOut.includes(t); i += 1) await sleep(50); return hOut.includes(t); };
      await said('HELD');
      const busy = launch('2025550303', { log });
      check('another call holds the lock (exit 10): AirDroid NOT started, nothing typed', [busy.code, fakeCount(), kinds(log)], [10, 0, []]);
      holder.stdin.write('\n');
      check('lock holder released the lock itself', await said('RELEASED'), true);
    }

    // ---- 4. Started but the Dialpad never opens: bounded wait, clear message, exit 8, no number, no click ----
    {
      const log = fresh('air') + '.log';
      const r = launch('2025550304', { log, flags: ['--no-dialpad'], timeoutSec: 5 });
      await sleep(400);
      check('not ready in time: exit 8 after about the 5 s bound (not sooner, not much later)', [r.code, r.ms >= 5000 && r.ms < 25000], [8, true]);
      check('not ready in time: says AirDroid was not ready, no number was entered and no call was placed',
        [/AirDroid was started but was not ready within 5 seconds: AirDroid is open, but its Dialpad is not/.test(r.out),
          /No number was entered and no call was placed/.test(r.out), /CLICK SENT ONCE/.test(r.out)], [true, true, false]);
      check('not ready in time: nothing typed, no click, nothing minimised; AirDroid left running; lock released',
        [kinds(log).filter((x) => ['TEXT', 'CLICK', 'MINIMIZED'].includes(x)), fakeCount(), await lockState()], [[], 1, 'FREE']);
    }
    await killFakes();

    // ---- 5. CheckOnly never starts AirDroid ----
    {
      const r = spawnSync('powershell.exe', [...PS, '-File', PREPARE, '-Number', '2025550305', '-CheckOnly', '-StartIfNotRunning',
        '-TestProcessName', FAKE, '-TestLaunchPath', AIR_EXE, '-TestLaunchArgs', `"${fresh('air')}.log" --taskbar`], { encoding: 'utf8' });
      check('CheckOnly with -StartIfNotRunning: starts nothing and stops "not running" (exit 3)', [r.status, fakeCount()], [3, 0]);
    }
  } catch (error) {
    failures += 1;
    console.log(`FAIL harness error: ${error && error.stack ? error.stack : error}`);
  } finally {
    if (probe) probe.child.stdin.end();
    spawnSync('taskkill', ['/IM', `${FAKE}.exe`, '/F'], { stdio: 'ignore' });
  }
  await sleep(300);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
